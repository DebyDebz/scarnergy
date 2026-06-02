# Scarnergy v2.0 — Session Fixes & Summary
**Date:** 2026-05-20  
**Session goal:** Diagnose and permanently fix recurring "relation does not exist" errors on the Buildings page and broken session creation flow.

---

## Problems Reported

| # | Symptom | Screen |
|---|---|---|
| 1 | Buildings page blank — `relation "public.building_summary" does not exist` | Buildings tab |
| 2 | "Error" empty alert dialog when tapping **Start Inspection** | Buildings tab |
| 3 | "Could not create session / Unknown error" secondary dialog | Buildings tab |
| 4 | All data missing after every `docker compose down -v` | — |

---

## Root Cause Analysis

### Root Cause 1 — `auth.users` does not exist at DB init time (the recurring problem)

PostgreSQL runs `docker-entrypoint-initdb.d` scripts **before** any other service starts. GoTrue (the auth service) also runs `CREATE TABLE IF NOT EXISTS auth.users (...)` when it first connects — but that only happens after Docker Compose has fully started the rest of the stack.

`002_core_schema.sql` contains:
```sql
CREATE TABLE public.user_profiles (
  id UUID REFERENCES auth.users(id) ...
);
```

With `ON_ERROR_STOP=1` in effect during init, this FK reference to `auth.users(id)` fails because GoTrue has not yet created that table. psql aborts the file at that line — and because migration files run sequentially, **all migrations from 002 onward were silently skipped** on every fresh volume.

Every `docker compose down -v` wiped the volumes, and the next `up` repeated the failure → no tables, no views, no seed data.

### Root Cause 2 — PostgREST schema cache stale

PostgREST caches the database schema at startup. Tables or views created after PostgREST is already running are **invisible to the REST API** until the cache is reloaded. This caused HTTP 404 responses on `inspection_sessions` INSERT calls, which produced the empty "Error" alert (the app received a non-JSON error body, so `error.message` was an empty string).

### Root Cause 3 — `start-web.sh` migration loop silently broken

The migration loop in `start-web.sh` had a typo:
```bash
# BROKEN — psql receives empty stdin, SQL file is never read
docker exec -i scarnergy_db psql -U postgres -d postgres < "$f"__
```
The `__` suffix turned every filename into a non-existent path. psql got empty stdin and produced no output — the script silently succeeded while applying nothing.

---

## Fixes Applied

### Fix 1 — Permanent: pre-create `auth.users` stub in migration 000

**File:** [`supabase/migrations/000_supabase_roles.sql`](../supabase/migrations/000_supabase_roles.sql)

Added after `ALTER SCHEMA auth OWNER TO supabase_auth_admin;`:

```sql
-- Pre-create minimal auth.users so migration 002's FK (user_profiles → auth.users)
-- succeeds at DB init time before GoTrue starts.
-- GoTrue uses CREATE TABLE IF NOT EXISTS then ALTER TABLE ADD COLUMN for each of its
-- own columns — a pre-existing table with just id is safe for GoTrue v2.
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID NOT NULL PRIMARY KEY
);
```

**Why this is safe:** GoTrue v2 uses `CREATE TABLE IF NOT EXISTS auth.users (...)` followed by `ALTER TABLE ADD COLUMN` for each of its own columns. A pre-existing table with just `id` is completely transparent to GoTrue — it skips creating the table and adds all its columns via ALTER.

**Effect:** Future `docker compose down -v && docker compose up -d` cycles will have `auth.users` available during init, so migration 002's FK constraint succeeds and all subsequent migrations run normally.

---

### Fix 2 — `start-web.sh` migration loop typo

**File:** [`start-web.sh`](../start-web.sh)

```bash
# BEFORE (broken)
docker exec -i scarnergy_db psql -U postgres -d postgres < "$f"__

# AFTER (fixed)
docker exec -i scarnergy_db psql -U postgres -d postgres < "$f"
```

Removed the trailing `__` that turned every file path into a non-existent path.

---

### Fix 3 — PostgREST schema cache reload (instant, no restart)

Replaced the `docker compose restart rest` call in `start-web.sh` with an instant NOTIFY:

```bash
# BEFORE — causes ~5s downtime and a race condition
docker compose restart rest

# AFTER — instant, zero downtime
docker exec scarnergy_db psql -U postgres -c "NOTIFY pgrst, 'reload schema';" > /dev/null 2>&1 || true
```

The same `NOTIFY` is also the final statement in `012_recover_missing_tables.sql`, so the cache reloads automatically after every migration run.

---

### Fix 4 — Better error messages in `buildings.tsx`

**File:** [`scarnergy-app/app/tabs/buildings.tsx`](../scarnergy-app/app/tabs/buildings.tsx) line 49

```tsx
// BEFORE — shows empty dialog when error.message is ""
Alert.alert("Error", error.message);

// AFTER — falls back to a readable message
Alert.alert("Could not start inspection", error.message || "Server error — please try again.");
```

---

### Fix 5 — `resumeSession` clears `paused_at` timestamp

**File:** [`scarnergy-app/app/tabs/sessions/[id].tsx`](../scarnergy-app/app/tabs/sessions/%5Bid%5D.tsx) line ~150

```tsx
// BEFORE — overwrites a valid timestamp with null on resume
.update({ status: "active", paused_at: null })

// AFTER — only changes status; DB trigger handles paused_at logic
.update({ status: "active" })
```

---

### Fix 6 — Recovery migration `012_recover_missing_tables.sql`

**File:** [`supabase/migrations/012_recover_missing_tables.sql`](../supabase/migrations/012_recover_missing_tables.sql)

A comprehensive idempotent migration that restores everything that was skipped due to the `auth.users` init failure. Covers:

- `update_updated_at()` trigger function
- `user_profiles`, `ble_devices` tables
- All session, measurement, zone, element, and sync tables (003–011)
- TimescaleDB hypertable for `measurements` (compression skipped — FK constraint incompatibility in dev)
- All RLS helper functions (`auth.user_org_id`, `auth.user_role`, `auth.is_privileged`, `auth.user_profile_id`)
- All RLS policies on every table
- Auth hook registration
- Realtime publication setup
- All 4 database views: `building_summary`, `session_summary`, `recent_measurements`, `anomaly_feed`
- Full seed data: 3 buildings, 5 zones, 12 elements, 2 BLE devices, 1 dev user profile
- `device_id` column made nullable (allows starting sessions without a paired BLE device)
- Storage bucket `inspection-photos` with public access policy
- Final `NOTIFY pgrst, 'reload schema'`

**Key omissions (intentional):**
- `audit_log` table — Metabase occupies this name in the shared `public` schema; Scarnergy's partitioned version was removed to avoid conflict
- `add_compression_policy` — TimescaleDB compression cannot be enabled on hypertables that have FK columns not included in the compression `segmentby`; skipped for dev

---

## Verification

After applying all fixes, the following was confirmed via direct API calls:

```bash
# building_summary view accessible via PostgREST
curl http://localhost:54321/rest/v1/building_summary  → HTTP 200

# Session creation works end-to-end
POST http://localhost:54321/rest/v1/inspection_sessions → HTTP 201
# Returns: { session_code: "INS-2026-0001", status: "active", ... }
```

**Database state after recovery:**

| Table | Count |
|---|---|
| organisations | 2 (Krontiva, EnergieScan) |
| buildings | 3 (Amsterdam, Rotterdam, Utrecht) |
| zones | 5 |
| building_elements | 12 |
| user_profiles | 1 (Dev User) |
| ble_devices | 2 (GLM-01, GLM-02) |

---

## Container Health (at time of fix)

| Container | Status |
|---|---|
| `scarnergy_db` | healthy |
| `scarnergy_kong` | healthy |
| `scarnergy_auth` | running |
| `scarnergy_rest` | running |
| `scarnergy_meta` | healthy |
| `scarnergy_storage` | **restarting** (non-critical, not addressed) |
| `scarnergy_studio` | **unhealthy** (non-critical, UI only) |

---

## What to Do After Every `docker compose down -v`

With Fix 1 in place, you only need to run `start-web.sh` normally. The `auth.users` stub ensures migration 002 no longer fails, so all migrations run automatically on first boot.

```bash
./start-web.sh
```

If PostgREST still shows stale schema errors:
```bash
docker exec scarnergy_db psql -U postgres -c "NOTIFY pgrst, 'reload schema';"
```

---

## Outstanding Items (not fixed this session)

| Item | Priority | Notes |
|---|---|---|
| `scarnergy_storage` restart loop | Low | Storage API port/auth config mismatch; inspection photos not yet in use |
| `scarnergy_studio` unhealthy | Low | Studio UI only; direct psql and PostgREST unaffected |
| `custom_access_token_hook` not registered in GoTrue | High | Required before `DEV_BYPASS_AUTH = false`; needed for production JWTs to carry `org_id` |
| `DEV_BYPASS_AUTH = true` hardcoded | **Critical** | Must be `false` before App Store release (`app/_layout.tsx` line 39) |
| `audit_log` table missing | Medium | Removed due to Metabase conflict; needs a renamed table (`scarnergy_audit_log`) or separate schema |
| Full inspection flow E2E test | Medium | Create session → zones → elements → record measurement → complete |
