# Scarnergy v2.0 — Resolution Log

Detailed record of every issue identified and resolved during the May 2026 audit and fix session.

---

## Issue 1 — Database Schema Never Applied

**Symptom:** Sessions list showed nothing; buildings list showed nothing; all API calls returned `404 Not Found` for Scarnergy tables.

**Root cause:** The PostgreSQL migrations had only been partially applied. Migration 002 ran only partially (ENUMs + `organisations` table created; `user_profiles` and `ble_devices` failed because the migration script does not use `IF NOT EXISTS` guards on object creation — the first `CREATE TABLE` failure mid-file stopped the rest). Migrations 003–010 and the seed data had never run at all. PostgREST had a stale schema cache that did not expose the new tables even after they were created.

**Resolution:**
1. Diagnosed by querying `pg_tables` directly via `docker exec scarnergy_db psql`
2. Ran each migration file in order (001–010) using `docker exec -i scarnergy_db psql -U postgres -d postgres < NNN_file.sql`
3. Ran `supabase/migrations/008_seed_data.sql` to insert test organisations, users, buildings, zones, elements
4. Sent `NOTIFY pgrst, 'reload schema'` to PostgreSQL and restarted `scarnergy_rest` container
5. Verified all 11 Scarnergy tables appeared in the PostgREST OpenAPI spec

**Resulting state:**
- 2 organisations, 3 buildings (Amsterdam, Rotterdam, Utrecht), 5 zones, 6 building elements, 2 BLE devices
- Dev bypass user (`00000000-…-000`) in `auth.users` and `user_profiles` with `org_id = 00000000-…-001`
- All RLS policies active; dev JWT passes all policy checks

**Files involved:** `supabase/migrations/001–010_*.sql`, `supabase/migrations/008_seed_data.sql`

---

## Issue 2 — Wrong Supabase URL (localhost/old IP hardcoded)

**Symptom:** App showed "Network request failed / Network request timed out" on all API calls when running on a native iOS/Android device. Web browser worked fine.

**Root cause — two separate problems:**

**2a.** `scarnergy-app/.env` had `EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321`. `localhost` on a native device resolves to the device's own loopback, not the Mac running the Docker stack.

**2b.** `scarnergy-app/.env` had `EXPO_PUBLIC_SUPABASE_URL=http://192.168.10.3:54321` — an old/wrong LAN IP. The actual Mac LAN IP detected was `192.168.10.13`.

**Resolution:**
1. Used `ipconfig getifaddr en0` to identify the current Mac LAN IP as `192.168.10.13`
2. Updated `scarnergy-app/.env`:
   - `EXPO_PUBLIC_SUPABASE_URL=http://192.168.10.13:54321`
   - `EXPO_PUBLIC_AI_SERVER_URL=http://192.168.10.13:8001`
3. Restarted Metro with `--clear` so the bundle was rebuilt with the new URLs

**Permanent fix (Issue 2c — future IP changes):** See Issue 8 below.

**Files changed:** `scarnergy-app/.env`

---

## Issue 3 — BLE f0 Service Causing Immediate Disconnect

**Symptom:** After connecting the GLM 50C, the app immediately disconnected. Console showed `WARN [BLE] Monitor error (f0/f1): ...`, `Monitor error (f0/f2): ...`, `Monitor error (f0/f4): ...` followed by a disconnect event.

**Root cause:** The original `useBLEDevice.ts` had a loop that subscribed to every notifiable characteristic on every discovered service. The Bosch GLM 50C has a proprietary `f0` service. When the app attempted to enable CCCDs on the `f0` characteristics, the GLM rejected these writes and dropped the BLE connection.

**Resolution:** Replaced the subscribe-to-all loop with a single targeted subscription to the one characteristic that carries all measurement data:
```typescript
connected.monitorCharacteristicForService(GLM_SERVICE_UUID, GLM_CHAR_UUID, callback);
// GLM_SERVICE_UUID = "02a6c0d0-0451-4000-b000-fb3210111989"  (d0)
// GLM_CHAR_UUID    = "02a6c0d1-0451-4000-b000-fb3210111989"  (d1)
```

**File changed:** `scarnergy-app/hooks/useBLEDevice.ts`

---

## Issue 4 — CMD_ENABLE Not Being Written (Trigger-Press Mode Never Activating)

**Symptom:** BLE connected successfully and packets were received, but they were all 4-byte continuous heartbeats (580.0mm at 2Hz). Pressing the GLM trigger produced no BLE event visible to the app.

**Root cause:** `CMD_ENABLE` (`C0 55 02 01 00 1A`) must be written to the d0/d1 characteristic after subscribing. The original code wrote it once without retry or delay. Some GLM firmware variants reject the first write if the GATT stack has not settled.

**Resolution:** Retry logic with increasing backoff:
```typescript
for (let attempt = 1; attempt <= 3 && !cmdOk; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 400 * attempt)); // 400, 800, 1200 ms
  cmdOk = await writeGatt(connected, GLM_SERVICE_UUID, GLM_CHAR_UUID, CMD_ENABLE);
}
```

The `cmdEnabled` boolean is now exposed in the return value and displayed on the Device screen as "Active ✓" or "Fallback (continuous)".

**File changed:** `scarnergy-app/hooks/useBLEDevice.ts`, `scarnergy-app/app/tabs/device.tsx`

---

## Issue 5 — Continuous Heartbeat Firing Before Trigger Press (GAP-1)

**Symptom:** Tapping the 📏 button to arm a slot and then pressing the GLM trigger sometimes filled the slot with a random continuous heartbeat value instead of the deliberate measurement.

**Root cause:** `pendingMeasurementRef=true` armed the slot for the _next_ BLE packet. But the GLM sends continuous heartbeats at ~2Hz, so a heartbeat always arrived before the trigger-press indication.

**Resolution:** Two-path dispatch logic based on packet type:
```typescript
if (!m.is_continuous) {
  // Trigger-press indication — always dispatch (user intent is unambiguous)
  pendingMeasurementRef.current = false;
  onMeasurementRef.current?.(m);
} else if (pendingMeasurementRef.current) {
  // Continuous heartbeat — only dispatch when explicitly armed (fallback mode)
  pendingMeasurementRef.current = false;
  onMeasurementRef.current?.(m);
}
```

**File changed:** `scarnergy-app/hooks/useBLEDevice.ts`

---

## Issue 6 — Stale activeSlotRef Race Condition (GAP-2)

**Symptom:** Tapping the 📏 icon to activate a slot, then immediately pressing the GLM trigger, sometimes filled the wrong slot or no slot.

**Root cause:** `activeSlotRef.current` was updated via `useEffect(() => { activeSlotRef.current = activeSlot; }, [activeSlot])`. React batches state updates, so the ref update happened on the _next render cycle_, not synchronously. BLE callbacks arriving in the same tick read the stale null value.

**Resolution:** Replaced the effect-driven ref sync with a synchronous helper:
```typescript
const setActiveSlotSync = useCallback((slot: SlotKey | null) => {
  activeSlotRef.current = slot;  // immediate, synchronous
  setActiveSlot(slot);           // async React state for UI
}, []);
```
All calls to `setActiveSlot` replaced with `setActiveSlotSync`.

**File changed:** `scarnergy-app/app/tabs/sessions/inspect.tsx`

---

## Issue 7 — Realtime WebSocket Auth Missing on Web (GAP-4)

**Symptom:** On the web browser build, the live measurements feed in Session Detail never updated when new measurements were saved, even though the REST API calls worked fine.

**Root cause:** `lib/supabase.web.ts` was missing `supabase.realtime.setAuth(DEV_JWT)`. Supabase Realtime uses a separate WebSocket connection that does not go through the `global.fetch` override used for REST calls. Without the token set, the WebSocket connected unauthenticated, and RLS blocked the `postgres_changes` subscription.

**Resolution:** Added to `lib/supabase.web.ts`:
```typescript
if (DEV_JWT) {
  supabase.realtime.setAuth(DEV_JWT);
}
```
The same call already existed in `lib/supabase.ts` (native). This is now consistent on both platforms.

**File changed:** `scarnergy-app/lib/supabase.web.ts`

---

## Issue 8 — Hardcoded IP Breaks on DHCP Renewal (Permanent Fix)

**Symptom:** After a router DHCP lease renewal, the Mac gets a new LAN IP. All native device connections fail until a developer manually finds the new IP and updates `scarnergy-app/.env` in two or more places.

**Root cause:** The Expo app bundles `EXPO_PUBLIC_*` variables at Metro build time. These were hardcoded to a specific IP with no mechanism to update them automatically.

**Resolution:** Created `scarnergy-app/scripts/detect-dev-ip.sh`:
- Detects current LAN IP (macOS: `ipconfig getifaddr en0/en1`, Linux: `hostname -I`)
- Verifies Supabase responds on port 54321 at that IP (confirms it's the right host)
- Rewrites only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_AI_SERVER_URL` in `scarnergy-app/.env`
- Is idempotent — no-op when IP is already correct
- Prints a clear before/after report

Wired into `package.json` as `prestart`:
```json
"prestart": "bash scripts/detect-dev-ip.sh",
"start:clear": "bash scripts/detect-dev-ip.sh && expo start --clear",
```

Also integrated into `start-web.sh` (Step 5.5) so the full-stack launcher also auto-detects the IP.

**Key design decision:** Only `scarnergy-app/.env` is updated. The Docker stack uses internal container DNS (`kong:8000`) and is unaffected by the IP change. Root `.env` IP values are only used for `API_EXTERNAL_URL` (CORS / redirect URLs) which are non-critical for dev.

**Files created/changed:** `scarnergy-app/scripts/detect-dev-ip.sh`, `scarnergy-app/package.json`, `start-web.sh`

---

## Issue 9 — Dashboard Stats Ignoring org_id Filter

**Symptom:** Dashboard stats (Active Sessions, Buildings, Measurements) showed 0 even after the database was populated.

**Root cause:** All four queries in `app/tabs/index.tsx` were missing `.eq("org_id", profile.org_id)` filters. Without these, RLS returned 0 rows (the policy blocks cross-org reads), and the queries fired before `profile` was populated.

**Resolution:**
1. Added `if (!profile) return;` guard at the start of `load()`
2. Added `eq("org_id", profile.org_id)` to all four queries
3. Changed `useEffect(load, [])` to `useEffect(load, [profile])` so stats reload once the profile is available (important for the DEV_BYPASS_AUTH path where the profile is set after mount)

**File changed:** `scarnergy-app/app/tabs/index.tsx`

---

## Issue 10 — measurements.device_id NOT NULL Broke Manual Entries

**Symptom:** Attempting to save measurements from the inspect screen when no GLM was connected resulted in a PostgreSQL NOT NULL constraint violation.

**Root cause:** `measurements.device_id` was defined `NOT NULL REFERENCES ble_devices(id)`. Web-entered and manually-typed measurements have no associated physical device.

**Resolution:** Migration 010:
```sql
ALTER TABLE measurements ALTER COLUMN device_id DROP NOT NULL;
```
The inspect screen code already had a fallback — it queries for any active org BLE device, and passes `null` if none is found.

**File changed:** `supabase/migrations/010_device_id_nullable.sql` (already in codebase, just needed to be applied)

---

## Summary Table

| # | Category | What broke | Root cause | Status |
|---|---|---|---|---|
| 1 | Database | All tables missing | Migrations never run | ✅ Fixed |
| 2 | Network | All API calls failing on native device | Wrong/localhost IP in .env | ✅ Fixed |
| 3 | BLE | Immediate disconnect on connect | f0 service CCCD subscribe caused GLM reject | ✅ Fixed |
| 4 | BLE | Trigger-press mode never activated | CMD_ENABLE not retried | ✅ Fixed |
| 5 | BLE | Wrong value captured in slot | Heartbeat fired before trigger press | ✅ Fixed |
| 6 | UI | Wrong slot filled on fast tap+press | activeSlotRef updated async, not sync | ✅ Fixed |
| 7 | Realtime | Live feed dead on web | Realtime WebSocket missing auth token | ✅ Fixed |
| 8 | Config | IP breaks on DHCP renewal | IP hardcoded in multiple .env places | ✅ Fixed |
| 9 | Dashboard | Stats showed 0 | Missing org_id filters + profile timing | ✅ Fixed |
| 10 | Database | Save fails without GLM connected | device_id NOT NULL constraint | ✅ Fixed |

---

## TDD Test Coverage

Created `scarnergy-app/__tests__/bleDecoder.test.ts` with 29 tests validating the BLE packet decoder and dispatch logic without any React or native dependencies:

- `decodePacket` — 16 tests (4-byte heartbeat, 8-byte trigger-press, edge cases, boundary values)
- `shouldDispatch` — 4 tests (validates the trigger-press-always / heartbeat-only-when-armed rule)
- `selectSlot` — 9 tests (active slot, first-unfilled fallback, race condition regression)

All 29 tests pass. Run with: `cd scarnergy-app && npm test`
