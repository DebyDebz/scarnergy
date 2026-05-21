# Scarnergy v2 — Session Fixes, Storage API Setup & Verification Guide

_Last updated: 2026-05-20_

---

## Overview

This document covers every change made during the rejig session: three critical runtime bugs fixed in the mobile app, four UX enhancements to the BLE inspection flow, and the complete Supabase Storage API bring-up. The final section is a step-by-step verification checklist — run it top to bottom to confirm the full stack is working.

---

## Part 1 — Critical Bug Fixes (Mobile App)

### Fix 1 · `inspect.tsx` — `client_timestamp` column does not exist

**File:** `scarnergy-app/app/tabs/sessions/inspect.tsx`

**Symptom:** Tapping "Save" on an element inspection form silently failed. PostgREST returned HTTP 400.

**Root cause:** The measurement INSERT rows included `client_timestamp: now`, but the `measurements` table has no such column.

**Fix:** Removed `client_timestamp` from the rows map.

```ts
// BEFORE (broken)
const rows = slots.filter(...).map(s => ({
  ...
  client_timestamp: now,   // ← column does not exist
}));

// AFTER (fixed)
const rows = slots.filter(...).map(s => ({
  id: clientUUID(),
  measured_at: now,
  org_id: profile.org_id,
  session_id: sessionId,
  device_id: resolvedDeviceId,
  inspector_id: profile.id,
  element_id: element.id,
  value_mm: update[s.key] as number,
  unit: "mm",
  is_anomaly: false,
  is_deleted: false,
  measurement_type: s.key.replace("_mm", ""),
  ingestion_path: "mobile",
  // client_timestamp REMOVED
}));
```

---

### Fix 2 · `[id].tsx` — `paused_at` column does not exist

**File:** `scarnergy-app/app/tabs/sessions/[id].tsx`

**Symptom:** Tapping the Pause button crashed the session update silently.

**Root cause:** The pause handler included `paused_at: new Date().toISOString()` but the `inspection_sessions` table has no `paused_at` column.

**Fix:**
```ts
// BEFORE (broken)
update({ status: "paused", paused_at: new Date().toISOString() });

// AFTER (fixed)
update({ status: "paused" });
```

---

### Fix 3 · `useBLEDevice.ts` — Battery level overwritten to 0%

**File:** `scarnergy-app/hooks/useBLEDevice.ts`

**Symptom:** Battery level displayed as 0% even after a real trigger-press reading that included battery data.

**Root cause:** The continuous heartbeat packet format encodes `battery_level = 0`. The handler called `setBatteryLevel(m.battery_level)` for every packet, including heartbeats, which wiped out the real reading.

**Fix:**
```ts
// BEFORE (broken)
setBatteryLevel(m.battery_level);

// AFTER (fixed)
if (m.battery_level > 0) setBatteryLevel(m.battery_level);
```

---

## Part 2 — UX Enhancements (BLE Inspection Flow)

### Enhancement 1 · `inspect.tsx` — Live GLM preview + flash feedback

**File:** `scarnergy-app/app/tabs/sessions/inspect.tsx`

Changes made:

- **Live preview strip** — when a slot is active and the GLM is connected, the current streaming value shows in real-time inside the slot card.
- **Flash on capture** — after a trigger-press or Capture tap, the slot card flashes green for 1.5 s and shows "✓ Captured from GLM".
- **Capture button always visible** — previously only showed when `activeSlot` was set; now shows whenever the GLM is connected.
- **Context-aware hint text:**
  - GATT mode active (`cmdEnabled = true`): "Slot armed — press the GLM trigger to auto-fill"
  - Fallback mode: "Tap Capture above, or type manually"

New styles added: `slotCardFlash`, `livePreview`, `livePreviewLabel`, `livePreviewValue`, `livePreviewMode`, `flashLabel`.

---

### Enhancement 2 · `device.tsx` — Streaming vs Trigger-press distinction

**File:** `scarnergy-app/app/tabs/device.tsx`

The last-measurement card now shows:

| Packet type | Card colour | Badge label |
|-------------|-------------|-------------|
| Continuous heartbeat | Blue (`#EBF5FB`) | `● STREAMING` |
| Trigger-press | Green (`#EAFAF1`) | `✓ CAPTURED` |

Battery % in the meta line is hidden when `battery_level = 0` (heartbeat packets).

---

## Part 3 — Supabase Storage API Setup

### Problem Summary

The `supabase/storage-api` container would not stay running. Two separate issues blocked it:

1. **Migration crash on restart** — `postgres-migrations` uses array-index lookups (`appliedMigrations[migration.id]`). Because the migrations table had rows starting at `id=2`, `appliedMigrations[18]` evaluated to `undefined` → migration 18 was re-run → duplicate primary key crash.

2. **"relation 'buckets' does not exist" at runtime** — Inside every request, the storage-api calls `set_config('role', 'service_role', true)`. In PostgreSQL this is equivalent to `SET LOCAL ROLE service_role`. The `service_role` database role had no `USAGE` privilege on the `storage` schema and no `search_path` that included `storage`, so every query against `buckets` / `objects` failed.

---

### Step-by-Step: How the Storage API Was Made to Work

#### Step 1 — Correct image version

Use `supabase/storage-api:v0.46.4` (not v0.43.11 whose migrations conflict with the v0.46.4 schema).

In `infrastructure/docker-compose.yml`:
```yaml
storage:
  image: supabase/storage-api:v0.46.4
  ports:
    - "5001:5000"      # port 5000 is taken by macOS Control Center
```

#### Step 2 — Trust auth rule for `supabase_storage_admin`

The Node.js `pg` driver in the storage-api image cannot negotiate SCRAM-SHA-256 over TCP with PostgreSQL 15. Add a trust rule to `pg_hba.conf` inside the DB container.

```bash
docker exec scarnergy_db bash -c \
  "echo 'host all supabase_storage_admin all trust' >> /var/lib/postgresql/data/pg_hba.conf"
docker exec scarnergy_db psql -U postgres -c "SELECT pg_reload_conf();"
```

#### Step 3 — Create `supabase_storage_admin` role

```sql
DO $$ BEGIN
  CREATE ROLE supabase_storage_admin NOINHERIT LOGIN PASSWORD 'postgres' SUPERUSER;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER ROLE supabase_storage_admin SUPERUSER;
ALTER ROLE supabase_storage_admin SET search_path TO storage;
ALTER SCHEMA storage OWNER TO supabase_storage_admin;
```

#### Step 4 — First startup: let the storage-api run its migrations

```bash
docker compose -f infrastructure/docker-compose.yml up -d storage
# Wait ~10 seconds for migrations to complete
docker logs scarnergy_storage | tail -5
# Should end with: "Server listening at http://0.0.0.0:5000"
```

At this point `storage.migrations` has rows with `id` values starting at 2.

#### Step 5 — Fix the migration index alignment

The `postgres-migrations` library looks up `appliedMigrations[migration.id]`. With rows starting at id=2, it thinks migrations 18 and 19 are unapplied (array index 18 is undefined). Insert the two missing anchor rows:

```sql
INSERT INTO storage.migrations (id, name, hash, executed_at) VALUES
  (0, 'create-migrations-table', 'e18db593bcde2aca2a408c4d1100f6abba2195df', NOW()),
  (1, 'initialmigration',        '6ab16121fbaa08bbd11b712d05f358f9b555d777', NOW())
ON CONFLICT (id) DO NOTHING;
```

#### Step 6 — Grant storage schema access to JWT roles

`set_config('role', 'service_role', true)` inside a transaction **changes the PostgreSQL session role** to `service_role`. That role has no access to the `storage` schema by default.

```sql
-- USAGE on schema
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

-- All existing tables/sequences/functions
GRANT ALL ON ALL TABLES    IN SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA storage TO anon, authenticated, service_role;

-- Default privileges for tables created in the future
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- search_path so bare table names resolve without schema prefix
ALTER ROLE anon          SET search_path TO storage, public, extensions;
ALTER ROLE authenticated SET search_path TO storage, public, extensions;
ALTER ROLE service_role  SET search_path TO storage, public, extensions;
```

#### Step 7 — Create the `inspection-photos` bucket

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-photos',
  'inspection-photos',
  false,
  52428800,
  ARRAY['image/jpeg','image/png','image/webp','image/heic']
)
ON CONFLICT (id) DO NOTHING;
```

#### Step 8 — Reload Kong to pick up the storage route

```bash
docker exec scarnergy_kong kong reload
```

All steps 3–7 are documented in `supabase/migrations/011_storage_setup.sql` for reproducibility.

---

## Part 4 — Complete Verification Checklist

Run these checks in order. Every check should pass before moving to the next section.

---

### 4.1 · Infrastructure Health

```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | grep scarnergy
```

**Expected:** All containers show `Up` (not `Restarting`). Key services:

| Container | Expected status |
|-----------|----------------|
| `scarnergy_db` | Up (healthy) |
| `scarnergy_kong` | Up (healthy) |
| `scarnergy_storage` | Up |
| `scarnergy_auth` | Up |
| `scarnergy_rest` | Up |
| `scarnergy_realtime` | Up |

---

### 4.2 · Database Connectivity

```bash
docker exec scarnergy_db psql -U postgres -c "\dt public.*" | grep -E "inspection_sessions|measurements|elements|ble_devices"
```

**Expected:** Tables `inspection_sessions`, `measurements`, `elements`, `ble_devices` all listed.

---

### 4.3 · PostgREST API

```bash
curl -s http://localhost:54321/rest/v1/inspection_sessions \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA1MTIxODgwMH0.awrZCFEvvrU75SNxtv2Lb3AK4PO7_AQu7oWoz23Z9eM" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA1MTIxODgwMH0.awrZCFEvvrU75SNxtv2Lb3AK4PO7_AQu7oWoz23Z9eM"
```

**Expected:** JSON array (may be empty `[]` if no sessions yet, but NOT an error object).

---

### 4.4 · Storage API — Bucket List

```bash
curl -s http://localhost:54321/storage/v1/bucket \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA1MTIxODgwMH0.awrZCFEvvrU75SNxtv2Lb3AK4PO7_AQu7oWoz23Z9eM" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA1MTIxODgwMH0.awrZCFEvvrU75SNxtv2Lb3AK4PO7_AQu7oWoz23Z9eM"
```

**Expected:**
```json
[{"id":"inspection-photos","name":"inspection-photos","public":false,...}]
```

---

### 4.5 · Storage API — Upload a Test File

```bash
echo "test" | curl -s -X POST \
  "http://localhost:54321/storage/v1/object/inspection-photos/test/verify.txt" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA1MTIxODgwMH0.awrZCFEvvrU75SNxtv2Lb3AK4PO7_AQu7oWoz23Z9eM" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA1MTIxODgwMH0.awrZCFEvvrU75SNxtv2Lb3AK4PO7_AQu7oWoz23Z9eM" \
  -H "Content-Type: text/plain" \
  --data-binary @-
```

**Expected:** `{"Key":"inspection-photos/test/verify.txt"}` (or similar success JSON, no error).

---

### 4.6 · BLE Unit Tests

```bash
cd /Users/dh3rbie/Documents/ScanergyV2/scarnergy-app
npm test
```

**Expected:**
```
Tests:       29 passed, 29 total
Test Suites: 1 passed, 1 total
```

All 29 tests must pass, including:
- `[FIX] trigger-press packet always dispatches regardless of pendingArmed`
- `[FIX] continuous heartbeat does NOT dispatch when pendingArmed = false`
- `[FIX] activeSlot overrides fallback even when that slot is already filled`

---

### 4.7 · Expo App Startup

```bash
cd /Users/dh3rbie/Documents/ScanergyV2/scarnergy-app
npx expo start
```

**Expected:** Metro bundler starts, QR code shown. App loads on device/simulator with no red error screen.

---

### 4.8 · App — Session Save (Pause Fix Verification)

1. Open the app and navigate to an existing session (or create one).
2. Tap **Pause** on the session detail screen.
3. Confirm the status badge changes to "Paused" without an error toast.

**What was broken before:** `paused_at` column did not exist → update failed silently.

---

### 4.9 · App — Element Measurement Save (client_timestamp Fix Verification)

1. Open a session and tap on any element (e.g., a wall/gevel).
2. Enter a value manually in any measurement slot (e.g., `2500` mm).
3. Tap **Save**.
4. Confirm the measurement is saved (slot shows the saved value on return).

**What was broken before:** `client_timestamp` column did not exist → INSERT failed silently.

---

### 4.10 · BLE GLM 50C — Real-time Measurement Flow

_Requires a Bosch GLM 50C device (or skip to verify UI only)._

1. Go to the **Device** tab and tap **Scan for GLM 50C**.
2. Once connected, confirm:
   - Status dot turns green, device name appears.
   - Battery % shows (if previously triggered).
   - **BLE packets received** counter increments with each measurement.
   - **Trigger-press GATT mode** shows "Active ✓" if CMD_ENABLE succeeded, or "Fallback (continuous)" if not.
3. Point the GLM at a surface and pull the trigger.
4. Confirm the last-measurement card updates with a **green** "✓ CAPTURED" badge and the distance in mm.
5. Navigate to an element inspection form, tap the 📏 icon to arm a slot.
6. Pull the GLM trigger — the slot should auto-fill with the measured value and flash green briefly.

**What was fixed:** Battery level no longer resets to 0% from heartbeat packets. Trigger-press vs streaming are visually distinct.

---

### 4.11 · Full Round-trip: Measurement to Database

After step 4.10, verify the measurement actually reached the database:

```bash
docker exec scarnergy_db psql -U postgres -c \
  "SELECT value_mm, measurement_type, ingestion_path, measured_at
   FROM measurements
   ORDER BY measured_at DESC
   LIMIT 5;"
```

**Expected:** Rows with real `value_mm` values, `ingestion_path = 'mobile'`, timestamps from the past few minutes.

---

## Quick Re-run After `docker compose down -v`

If the database volume is wiped, the storage API needs re-initialisation. Run in order:

```bash
# 1. Start everything except storage
docker compose -f infrastructure/docker-compose.yml up -d db kong auth rest realtime mqtt grafana metabase studio meta inbucket

# 2. Wait for DB to be healthy
docker compose -f infrastructure/docker-compose.yml exec db pg_isready -U postgres

# 3. Apply storage role setup
docker exec scarnergy_db psql -U postgres -f /docker-entrypoint-initdb.d/011_storage_setup.sql

# 4. Add pg_hba trust rule (if not already there)
docker exec scarnergy_db bash -c \
  "grep -q 'supabase_storage_admin' /var/lib/postgresql/data/pg_hba.conf || \
   echo 'host all supabase_storage_admin all trust' >> /var/lib/postgresql/data/pg_hba.conf"
docker exec scarnergy_db psql -U postgres -c "SELECT pg_reload_conf();"

# 5. Start the storage API (runs migrations, creates schema)
docker compose -f infrastructure/docker-compose.yml up -d storage
sleep 12

# 6. Fix migration index alignment
docker exec scarnergy_db psql -U postgres -c "
INSERT INTO storage.migrations (id, name, hash, executed_at) VALUES
  (0, 'create-migrations-table', 'e18db593bcde2aca2a408c4d1100f6abba2195df', NOW()),
  (1, 'initialmigration',        '6ab16121fbaa08bbd11b712d05f358f9b555d777', NOW())
ON CONFLICT (id) DO NOTHING;"

# 7. Grant JWT role access (storage tables now exist)
docker exec scarnergy_db psql -U postgres -c "
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA storage TO anon, authenticated, service_role;"

# 8. Create inspection-photos bucket
docker exec scarnergy_db psql -U postgres -c "
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('inspection-photos','inspection-photos',false,52428800,
        ARRAY['image/jpeg','image/png','image/webp','image/heic'])
ON CONFLICT (id) DO NOTHING;"

# 9. Restart storage container so it picks up the newly-granted permissions
docker compose -f infrastructure/docker-compose.yml restart storage
sleep 8

# 10. Verify
curl -s http://localhost:54321/storage/v1/bucket \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA1MTIxODgwMH0.awrZCFEvvrU75SNxtv2Lb3AK4PO7_AQu7oWoz23Z9eM" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjA1MTIxODgwMH0.awrZCFEvvrU75SNxtv2Lb3AK4PO7_AQu7oWoz23Z9eM"
# Expected: [{"id":"inspection-photos",...}]
```
