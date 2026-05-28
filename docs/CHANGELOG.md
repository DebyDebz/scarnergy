# Scarnergy v2.0 — Changelog

Chronological record of every significant feature added and problem solved across the project.

---

## 2026-05-26 — Web Admin UI Color Unification

**Problem:** The web admin panel (`web/`) used Tailwind's default `indigo` and `purple` palette, which clashed with the mobile app's dark navy blue brand color (`#1E3A5F`).

**Solution:**
- Extended `web/tailwind.config.ts` to override the entire `indigo` and `purple` Tailwind color scales with a custom navy-blue palette derived from the mobile app's primary `#1E3A5F`. All existing class names (`indigo-600`, `indigo-100`, `purple-700`, etc.) remained unchanged — only the rendered colors changed.
- Replaced two hardcoded hex values `#6366f1` (stock Tailwind indigo-500) in `web/components/charts/MeasurementChart.tsx` with `#1E3A5F`.

**Files changed:**
- `web/tailwind.config.ts`
- `web/components/charts/MeasurementChart.tsx`

---

## 2026-05-25 — Session Inspect, BLE Improvements, Auth Updates (Mobile)

**Features added:**
- **Session inspect screen** (`scarnergy-app/app/tabs/sessions/inspect.tsx`): refactored and slimmed down; cleaner layout with BLE measurement display.
- **Sessions list** (`sessions/index.tsx`): improved session card display and load-more behaviour.
- **Session detail** (`sessions/[id].tsx`): tightened UI, removed dead code paths.
- **Buildings screen**: minor display improvements.
- **Device screen** (`device.tsx`): removed redundant logic, simplified BLE state handling.
- **Supabase client** (`lib/supabase.ts`): added missing config fields.
- **Auth store** (`store/authStore.ts`): improved session persistence and sign-out reliability; fixed edge case where stale auth state persisted across app restarts.

**Files changed:** `app/tabs/buildings.tsx`, `app/tabs/device.tsx`, `app/tabs/sessions/[id].tsx`, `app/tabs/sessions/_layout.tsx`, `app/tabs/sessions/index.tsx`, `app/tabs/sessions/inspect.tsx`, `lib/supabase.ts`, `store/authStore.ts`

---

## 2026-05-25 — Web Admin Panel — Full Feature Build

**Features added:**

### Dashboard
- Replaced "Recent measurements" widget with a "Recent organizations" accordion panel — click any org to expand inline measurements without navigating away.
- Live session count KPI card.

### Measurements page (new)
- Real-time polling every 10 s via the `recent_measurements` view.
- New rows highlighted green with a **NEW** badge.
- Workaround for TimescaleDB hypertable incompatibility with Supabase Realtime (polling used instead of websocket subscription).
- Filter bar: search by session UUID, building, date range.

### Organizations
- Listing page (`/organizations`): clickable cards navigate to org detail.
- Detail page (`/organizations/[id]`): shows all linked users with role badges, all linked buildings with navigation links.
- Create form expanded: company name, full address, GPS lat/lng, supervisor/inspector assignment (searchable checkbox list), building assignment (searchable checkbox list).

### Sessions
- Detail page (`/sessions/[id]`): added collapsible **Zones & Elements** section matching the buildings page UI; building address is a link to `/buildings/[id]`.

### Buildings
- New building form with address, energy label, GPS fields.
- `/buildings/[id]` detail page: shows zones, elements, and linked sessions.

### Users page (new)
- Lists all user profiles with role and active status.
- Inline role change (dropdown), invite new user form, toggle active/inactive.

### Devices page (new)
- BLE device registry: lists all registered GLM 50C devices with MAC address, firmware, last-seen timestamp.
- Register new device form.

### System page (new)
- Infrastructure health check panel (Kong, auth, DB, Realtime, Storage, AI server) with live status indicators.
- Total measurements counter.

### Navigation
- Sidebar rebuilt with all pages: Dashboard, Sessions, Buildings, Measurements, Organizations, Users, Devices, System.
- System page removed from sidebar nav (accessible by direct URL).
- TopBar added with user avatar and org display.

### Auth
- Login page (`/auth/login`) with email/password form and Supabase session handling.
- Middleware protecting all dashboard routes; unauthenticated requests redirect to `/auth/login`.

**Problems solved:**
- TimescaleDB hypertable blocks Supabase Realtime — solved with 10 s polling on the `recent_measurements` view.
- GoTrue auth compatibility — migration `013_fix_auth_users_gotrue_compat.sql` fixes schema conflicts between the self-hosted GoTrue and Supabase's expected `auth.users` structure.

**Database migrations added:**
- `013_fix_auth_users_gotrue_compat.sql` — GoTrue compatibility fix.
- `014_org_gps.sql` — Added `latitude` and `longitude` columns to `organisations`.

**Infrastructure:**
- `infrastructure/docker-compose.yml` updated with correct service dependencies and port bindings.
- `web/Dockerfile.dev` added for containerised development.

---

## 2026-05-21 — BLE GLM 50C Decode Fix + Storage Setup

**Problem:** The Bosch GLM 50C laser distance meter sends two BLE packet types on trigger press. The app was decoding the wrong one (the intermediate "aim" packet), causing spurious/zero measurements to be stored instead of the final confirmed distance.

**Solution:**
- Identified the two packet structures via packet log panel:
  - Aim packet: `0x02` prefix, emitted continuously while laser is aimed.
  - Trigger-release packet: `0x01` prefix with `0x42` flag byte, emitted once on button release.
- `useBLEDevice.ts`: store `lastTriggerMeasurement` — only commit readings from `0x01 / 0x42` packets.
- `CMD_ENABLE` write changed from write-without-response to write-with-response to confirm GLM activation.
- Added 1 500 ms aim guard: ignore aim packets within 1.5 s of the last trigger reading to prevent double-capture.
- Device screen now displays measurement in metres with 3 decimal places.
- Packet log debug panel added to Device screen for live packet inspection.

**Files changed:** `scarnergy-app/hooks/useBLEDevice.ts`, `scarnergy-app/app/tabs/device.tsx`

### Storage API Setup
**Problem:** `supabase/storage-api` container (`v0.46.4`) failed to start — port conflict, trust-auth misconfiguration, migration ID misalignment, missing role `search_path` grants, and the `inspection-photos` bucket did not exist.

**Solution:**
- Migration `011_storage_setup.sql`: correct port to 5001, set trust auth, align migration IDs, grant role `search_path`, create `inspection-photos` bucket with public read policy.
- Migration `012_recover_missing_tables.sql`: recovered any tables lost from partial earlier migration runs.

**Docs added to `docs/`:**
- `ARCHITECTURE.md` — full system architecture diagram and service map.
- `PROCESS_FLOW.md` — end-to-end data flow from BLE trigger to Supabase storage.
- `RESOLUTION_LOG.md` — detailed issue log for the May 2026 fix session.
- `SESSION_2026-05-20_FIXES.md` — session handoff notes for 2026-05-20.
- `SESSION_2026-05-21_BLE_FIX.md` — detailed BLE fix session notes.
- `SESSION_FIXES_AND_VERIFICATION.md` — verification checklist post-fix.
- `SESSION_SUMMARY.md` — high-level project handoff summary.
- `USER_GUIDE.md` — inspector user guide for the mobile app.
- `Bosch_GLM_50C_User_Guide.md` — device-specific BLE protocol reference.

---

## 2026-05-20 — Initial Infrastructure & Schema Recovery

**Problem:** Fresh clone of the repo had no working infrastructure — database migrations had not been applied, PostgREST had a stale schema cache, the Supabase URL was hardcoded to `localhost` instead of the Mac's LAN IP, and the dev bypass user was missing from `auth.users`.

**Solution:**
1. Applied all migrations (`001`–`010`) in order via `docker exec -i scarnergy_db psql`.
2. Ran seed data (`008_seed_data.sql`) — 2 orgs, 3 buildings, 5 zones, 6 elements, 2 BLE devices.
3. Updated Supabase URL in mobile app and web app to `http://192.168.10.13:54321`.
4. Inserted dev bypass user (`00000000-…-000`) into `auth.users` and `user_profiles`.
5. Reloaded PostgREST schema cache via `NOTIFY pgrst, 'reload schema'`.
6. Verified all 11 Scarnergy tables appeared in PostgREST OpenAPI spec.

**Stack confirmed running:**

| Container | Port | Role |
|---|---|---|
| `scarnergy_kong` | 54321 | API gateway |
| `scarnergy_db` | 54322 | PostgreSQL 15 + TimescaleDB |
| `scarnergy_studio` | 54323 | Supabase Studio |
| `scarnergy_auth` | 9999 | GoTrue auth |
| `scarnergy_rest` | 3000 | PostgREST |
| `scarnergy_realtime` | 4000 | Supabase Realtime |
| `scarnergy_storage` | 5001 | Storage API |
| `scarnergy_ai` | 8000 | FastAPI anomaly detection |
| `scarnergy_mqtt` | 1883 | Mosquitto MQTT |
| `scarnergy_web` | 3003 | Next.js 14 web admin |

---

## Initial Project Setup

**Mobile app (`scarnergy-app/`):**
- Expo React Native (iOS + Android), Expo Router v6, Zustand for state, Supabase JS v2.
- Screens: Home (KPI dashboard), Buildings list, Sessions list/detail/inspect, Device (BLE).
- BLE integration with Bosch GLM 50C via `react-native-ble-plx`.
- Offline sync queue (`hooks/useSyncQueue.ts`) for measurements captured without connectivity.
- NTA 8800 energy label support on buildings and zones.

**Web admin (`web/`):**
- Next.js 14 (App Router), Tailwind CSS, TypeScript.
- Served on port 3003, proxied through Kong on port 54321.
- Supabase server client with cookie-based auth via `@supabase/ssr`.

**Infrastructure:**
- Self-hosted Docker Compose stack (Kong, GoTrue, PostgREST, PostgreSQL + TimescaleDB, Realtime, Storage, MQTT, AI server).
- Kong as API gateway with JWT validation on all Supabase routes.
- FastAPI AI server for anomaly detection on measurement streams (ONNX model).
