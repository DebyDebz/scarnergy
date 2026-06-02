# Scarnergy v2.0 — Session Summary
**Date:** 2026-05-20  
**Purpose:** Handoff document — pick up the next session from exactly here.

---

## What This Project Is

**Scarnergy v2.0** is a mobile-first building energy audit platform for Dutch inspectors (NTA 8800 standard).

- **Mobile app:** Expo React Native (iOS + Android + web), Expo Router v6, Zustand, Supabase JS v2
- **Backend:** Self-hosted Docker Compose stack — Kong gateway, GoTrue auth, PostgREST API, PostgreSQL 15 + TimescaleDB, Supabase Realtime, Mosquitto MQTT, FastAPI AI server, Grafana, Metabase
- **Measurement device:** Bosch GLM 50C Bluetooth laser distance meter — BLE GATT, two packet types
- **Key UUIDs (dev bypass):**
  - Dev user:  `00000000-0000-0000-0000-000000000000`
  - Dev org:   `00000000-0000-0000-0000-000000000001`
- **DEV_BYPASS_AUTH = true** hardcoded in `scarnergy-app/app/_layout.tsx` line 39 — must be `false` before App Store release

---

## Current Infrastructure State

### Docker Stack (all running on the Mac at `192.168.10.13`)

| Container | Port | Status |
|---|---|---|
| `scarnergy_kong` | 54321 (API gateway) | healthy |
| `scarnergy_db` | 54322 (postgres direct) | healthy |
| `scarnergy_studio` | 54323 (Supabase Studio) | unhealthy (UI only, non-critical) |
| `scarnergy_auth` | 9999 | running |
| `scarnergy_rest` | 3000 (internal) | running |
| `scarnergy_realtime` | 4000 (internal) | running |
| `scarnergy_mqtt` | 1883 / 9001 | running |
| `scarnergy_ai` | 8001 | running |
| `scarnergy_grafana` | 3001 | running |
| `scarnergy_metabase` | 13002 | running |

**Important:** Metabase was configured against the same postgres instance (`scarnergy_db`). Its tables coexist in the `public` schema alongside Scarnergy tables. This is messy but working — do not `DROP TABLE` anything without checking `pg_tables` first.

### Database — Migrations Applied

All 10 migrations ran successfully:

```
001_extensions.sql       — pg_trgm, timescaledb, pgcrypto
002_core_schema.sql      — organisations, user_profiles, ble_devices, ENUMs
003_building_hierarchy.sql — buildings, zones, building_elements, openings
004_sessions_measurements.sql — inspection_sessions, measurements (hypertable), sync_queue
005_rls_policies.sql     — RLS on all tables, auth helper functions
006_auth_hooks.sql       — custom_access_token_hook, Realtime role grants
006_realtime.sql         — ALTER PUBLICATION to add tables
007_views.sql            — session_summary, building_summary, recent_measurements
007_views_functions.sql  — close_inspection_session RPC
009_views_update.sql     — rebuilt session_summary + building_summary with LEFT JOINs
010_device_id_nullable.sql — measurements.device_id made nullable
```

### Seed Data (in DB)

```
Organisations : 2  (Krontiva Energie Advies BV + EnergieScan Nederland)
Buildings     : 3  (Amsterdam, Rotterdam, Utrecht — all org_id 00…001)
Zones         : 5  (3 for Amsterdam building, 2 for Rotterdam)
Elements      : 6  (gevels, vloer, dak, installatie for Amsterdam/Begane grond)
BLE Devices   : 2  (GLM-01 + GLM-02 registered)
Sessions      : 2  (created during testing, status = active)
```

**To reset the DB to clean seed state:**
```bash
docker exec -i scarnergy_db psql -U postgres -d postgres -c \
  "DELETE FROM measurements; DELETE FROM inspection_sessions;"
```
Do NOT drop the tables — just delete rows. Migrations are already applied.

---

## Current App State

### What Works End-to-End

| Feature | Status | Notes |
|---|---|---|
| Dashboard loads with stats | ✅ Working | Shows buildings=3, sessions=N, measurements=N |
| Buildings list | ✅ Working | Shows 3 buildings with zone/element counts |
| Session list | ✅ Working | Lists all sessions for dev org |
| Create new session | ✅ Working | Inserts, auto-generates INS-YYYY-NNNN code |
| Session detail: zones | ✅ Working | Shows Begane grond, Eerste verdieping, Tweede verdieping for Amsterdam |
| Session detail: elements | ✅ Working | Shows 5 elements in Begane grond |
| Inspect screen: manual entry | ✅ Working | Type value, auto-converts metres→mm |
| Inspect screen: save measurements | ✅ Working | UPDATE building_elements + INSERT measurements |
| Live measurement feed | ✅ Working | Realtime subscription on session_summary |
| BLE scan + connect | ✅ Working | Scans for GLM name / d0 service UUID |
| BLE trigger-press capture | ✅ Fixed (see below) | Requires CMD_ENABLE to succeed |
| Auto IP detection | ✅ Working | prestart hook updates .env before Metro |
| 29 unit tests | ✅ Passing | `cd scarnergy-app && npm test` |

### What Is Not Yet Tested / Potentially Incomplete

| Feature | Status | Notes |
|---|---|---|
| Photo capture + upload | ⚠️ Untested | expo-image-picker, Supabase Storage bucket `inspection-photos` — bucket may not exist yet |
| Complete Session (RPC) | ⚠️ Untested | `close_inspection_session` RPC exists; edge function `session_close` will 404 in local dev |
| XML export | ⚠️ Untested | Code is written; needs a completed session with measurements |
| Floor plan view | ⚠️ Placeholder | `app/tabs/sessions/floorplan.tsx` exists but SVG content is not linked to real data |
| AI anomaly detection | ⚠️ Untested | `scarnergy_ai` container is running but integration in inspect.tsx not verified |
| Offline sync queue | ⚠️ Untested | `useSyncQueue.ts` exists; needs a test with network disabled |
| Production auth (real login) | ⚠️ Not done | `DEV_BYPASS_AUTH=true` hardcoded; `custom_access_token_hook` not registered in GoTrue |
| MQTT WebSocket in app | ⚠️ Not connected | BLE bridge exists but app-side MQTT subscription not visible in tabs |

---

## All Fixes Made This Session

| # | Problem | Fix |
|---|---|---|
| 1 | DB schema never applied — all tables missing | Ran migrations 001–010 + seed data via `docker exec psql` |
| 2 | PostgREST 404 on all Scarnergy tables | `NOTIFY pgrst, 'reload schema'` + restart `scarnergy_rest` |
| 3 | Wrong IP (`192.168.10.3` / `localhost`) in `scarnergy-app/.env` | Updated to `192.168.10.13:54321` |
| 4 | BLE immediate disconnect (f0 service CCCD) | Subscribe only to d0/d1 — removed subscribe-to-all loop |
| 5 | CMD_ENABLE failing silently (trigger-press never activated) | Added 3-retry loop with 400/800/1200ms backoff |
| 6 | Heartbeat filling slot before trigger press | Two-path dispatch: trigger packets always fire; heartbeats only when armed |
| 7 | `activeSlotRef` stale in same tick as tap | `setActiveSlotSync()` helper — updates ref synchronously before state |
| 8 | Realtime dead on web | Added `supabase.realtime.setAuth(DEV_JWT)` to `lib/supabase.web.ts` |
| 9 | Dashboard stats all zero | Added `org_id` filters + `if (!profile) return` guard + `useEffect([profile])` |
| 10 | `device_id NOT NULL` broke saves without GLM | Migration 010 already written — just needed to be applied |
| 11 | IP breaks on DHCP renewal | `scripts/detect-dev-ip.sh` + `prestart` npm hook + integrated into `start-web.sh` |

---

## Key Files — Quick Reference

```
scarnergy-app/
├── app/
│   ├── _layout.tsx                  ← DEV_BYPASS_AUTH flag (line 39), profile injection
│   ├── tabs/
│   │   ├── index.tsx                ← Dashboard (stats queries now org-filtered)
│   │   ├── buildings.tsx            ← Building list (building_summary view)
│   │   ├── device.tsx               ← BLE scan/status UI
│   │   └── sessions/
│   │       ├── index.tsx            ← Session list + create modal
│   │       ├── [id].tsx             ← Session detail, zone picker, element list
│   │       ├── inspect.tsx          ← Element inspector, BLE slot fill, save
│   │       └── floorplan.tsx        ← Floor plan (placeholder)
├── hooks/
│   ├── useBLEDevice.ts              ← GLM 50C BLE protocol, CMD_ENABLE retry
│   ├── useBLEDevice.web.ts          ← Web stub
│   ├── useLiveMeasurements.ts       ← Realtime subscription
│   ├── useSyncQueue.ts              ← Offline queue
│   └── bleDecoder.ts                ← Pure decoder (tested)
├── lib/
│   ├── supabase.ts                  ← Native client (devFetch, SecureStore, setAuth)
│   ├── supabase.web.ts              ← Web client (localStorage, setAuth)
│   └── BLEContext.tsx               ← React context over useBLEDevice
├── store/
│   └── authStore.ts                 ← Zustand: session, user, profile
├── scripts/
│   └── detect-dev-ip.sh             ← Auto-detects LAN IP, rewrites .env
├── __tests__/
│   └── bleDecoder.test.ts           ← 29 unit tests, all passing
├── .env                             ← EXPO_PUBLIC_* vars (auto-updated by script)
└── package.json                     ← prestart hook wired to detect-dev-ip.sh

supabase/
└── migrations/
    ├── 001–010_*.sql                ← All applied ✅
    └── 008_seed_data.sql            ← Applied ✅

infrastructure/
└── docker-compose.yml               ← All 12 containers defined

docs/
├── ARCHITECTURE.md                  ← System design, DB schema, BLE protocol, security
├── PROCESS_FLOW.md                  ← All user flows with code-level detail
├── USER_GUIDE.md                    ← End-user step-by-step guide
├── RESOLUTION_LOG.md                ← 10 issues, root causes, code snippets
└── SESSION_SUMMARY.md               ← This file
```

---

## How to Start the App for the Next Session

```bash
# 1. Ensure Docker stack is running (on the server machine)
cd /Users/dh3rbie/Documents/ScanergyV2/infrastructure
docker compose ps                    # all should be Up

# 2. Start Metro (from scarnergy-app/)
cd /Users/dh3rbie/Documents/ScanergyV2/scarnergy-app
npm start
# prestart auto-detects IP and updates .env before Metro launches

# 3. If IP changed or you want a clean bundle:
npm run start:clear

# 4. On native device: open Expo Go → scan QR, or press 'i' for iOS simulator

# 5. Verify DB is live (optional sanity check):
curl -s -H "apikey: $ANON_KEY" http://192.168.10.13:54321/rest/v1/buildings?select=city | python3 -m json.tool
```

**ANON_KEY** (for curl tests):
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwNTEyMTg4MDB9.r0GAZmnw3PcxO23v52N13u52lmWHIUYQ4LcaqcYd4b8
```

**DEV_JWT** (authenticated, admin, org 00…001):
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJvcmdfaWQiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEiLCJ1c2VyX3JvbGUiOiJhZG1pbiIsImV4cCI6MjA1MTIxODgwMH0.c6Kl97jKbtxXLNITGUsGotQgbrvDK1KV_ta_5tePGQc
```

---

## Recommended Next Steps (Priority Order)

1. **Test BLE end-to-end on a real device** — power on GLM, scan, connect, take a measurement, verify it fills a slot and saves to DB. This is the core user value proposition and has not been confirmed working on real hardware since the fixes.

2. **Create `inspection-photos` Storage bucket** — photo capture is coded but the Supabase Storage bucket does not exist. Create via Studio at `http://192.168.10.13:54323` or via SQL:
   ```sql
   INSERT INTO storage.buckets (id, name, public) VALUES ('inspection-photos', 'inspection-photos', false);
   ```

3. **Test Complete Session flow** — create a session, fill all element slots, tap "✓ Complete Session", verify the `close_inspection_session` RPC runs without error and status flips to `completed`.

4. **Test XML export** — from a completed session, tap Export XML, verify the output contains all zones/elements/measurements.

5. **Register `custom_access_token_hook`** in GoTrue — required for production JWTs to carry `org_id`. Go to Supabase Studio → Authentication → Hooks → Add hook: function `auth.custom_access_token_hook`. Without this, real user login will work but RLS will block everything.

6. **Fix `scarnergy_studio` unhealthy** — check `docker logs scarnergy_studio` and investigate. Non-critical for mobile app but useful for DB admin.

7. **Floorplan screen** — `app/tabs/sessions/floorplan.tsx` is a placeholder. Needs SVG zone rendering linked to real building element positions.

8. **Set `DEV_BYPASS_AUTH=false`** when real user accounts are ready — then test the full sign-in → JWT → RLS chain.
