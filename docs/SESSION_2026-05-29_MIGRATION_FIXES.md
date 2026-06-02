# Migration Fix Session — 2026-05-29

Goal: get `npx supabase start` running cleanly from scratch on CLI v2.102.0 / Postgres 15.

---

## Error 1 — Invalid `db.major_version`

**Error:** `Failed reading config: Invalid db.major_version: 16`

**Cause:** Supabase CLI v2.x does not ship a local Postgres 16 image. The config was set to 16.

**Fix:** `supabase/config.toml` — changed `major_version = 16` → `major_version = 15`.

---

## Error 2 — Superuser role creation in `roles.sql`

**Error:** `must be superuser to create superusers (SQLSTATE 42501)` — triggered by `CREATE ROLE supabase_admin ... SUPERUSER` in `roles.sql`.

**Cause:** `000_supabase_roles.sql` had been placed in the migrations folder. It was moved to `supabase/roles.sql`, but `roles.sql` also doesn't execute with superuser rights in CLI v2.x. The entire file was recreating Supabase's internal infrastructure roles (`anon`, `authenticated`, `supabase_admin`, etc.) that Supabase already creates during its own init.

**Fix:** Emptied `supabase/roles.sql` — Supabase manages all internal roles automatically.

---

## Error 3 — TimescaleDB Apache license restrictions

**Error:** `function "add_compression_policy" is not supported under the current "apache" license` / `functionality not supported under the current "apache" license` (continuous aggregates).

**Cause:** The local Supabase dev stack ships TimescaleDB with the Apache 2.0 license. `add_compression_policy`, `add_retention_policy`, and `CREATE MATERIALIZED VIEW WITH (timescaledb.continuous)` all require the Timescale proprietary license (TSL).

**Fix:** Wrapped all three in `DO $$ BEGIN ... EXCEPTION WHEN OTHERS THEN NULL; END $$` blocks. DDL inside continuous aggregates was wrapped via `EXECUTE $sql$ ... $sql$` since DDL can't run directly inside a DO block. Applied to both `004_sessions_measurements.sql` and `012_recover_missing_tables.sql`.

---

## Error 4 — Helper functions in the `auth` schema

**Error:** `permission denied for schema auth (SQLSTATE 42501)` — on `CREATE OR REPLACE FUNCTION auth.user_org_id()`.

**Cause:** Migrations run as the `postgres` user which does not have CREATE rights on the `auth` schema (owned by `supabase_auth_admin`). The RLS helper functions (`user_org_id`, `user_role`, `user_profile_id`, `is_privileged`) were incorrectly placed in the `auth` schema.

**Fix:** Moved all four functions to the `public` schema and updated every call site in `005_rls_policies.sql` and `012_recover_missing_tables.sql` with `sed` + `replace_all`.

---

## Error 5 — Duplicate migration version prefixes

**Error:** `duplicate key value violates unique constraint "schema_migrations_pkey"` — Key (version)=(006) already exists.

**Cause:** Two files shared the `006_` prefix (`006_auth_hooks.sql`, `006_realtime.sql`) and two shared `007_` (`007_views.sql`, `007_views_functions.sql`). Supabase uses the numeric prefix as the primary key in `supabase_migrations.schema_migrations`.

**Fix:**
- Merged `006_realtime.sql` content into `006_auth_hooks.sql`; renamed original to `skip_006_realtime.sql`.
- Extracted unique content from `007_views_functions.sql` (the `inspector_dashboard` view + two RPC functions not in `007_views.sql`) into a new `0071_views_functions.sql`; renamed original to `skip_007_views_functions.sql`.
- Note: suffixes like `007a`, `007b` look distinct but Supabase CLI extracts version as **leading digits only**, so `007a` → version `007`. 4-digit prefixes (`0071`, `0072`, etc.) are required for sub-versions.

---

## Error 6 — NTA8800 columns missing at seed time

**Error:** `column "bodemisolatie" of relation "building_elements" does not exist` / `column "flow_stage" of relation "inspection_sessions" does not exist`.

**Cause:** `008_seed_data.sql` references columns added in `017_nta8800_fields.sql` and `015_floor_plan_grid.sql`, which ran after the seed due to higher numeric prefixes. Additionally, Supabase CLI only applies migrations with versions higher than the last-recorded one — so even renaming to `003a_` was insufficient when earlier migrations were already in the tracking table.

**Fix:** Renamed the column-adding migrations to `0072_nta8800_fields.sql`, `0073_floor_plan_image.sql`, and `0074_floor_plan_grid.sql` — all sort before `008_` in the file system while having numeric versions between `007` and `008`.

---

## Error 7 — Opening UUID used as element_id in measurements

**Error:** `insert or update on table "_hyper_1_1_chunk" violates foreign key constraint` — `element_id=bfa5a2d7` not present in `building_elements`.

**Cause:** `bfa5a2d7-0000-0000-0000-000000000001` is the UUID of an **opening** (a sliding door), not a building element. The measurements seed used it as `element_id` which references `building_elements`.

**Fix:** Replaced the two affected measurement rows in `008_seed_data.sql` to reference the parent wall element `5ef79c16-0000-0000-0000-000000000001` (Bg Achtergevel) instead.

---

## Error 8 — Superuser role creation in migration 011 / 012

**Error:** `must be superuser to create superusers` — `CREATE ROLE supabase_storage_admin ... SUPERUSER` in `011_storage_setup.sql` and `012_recover_missing_tables.sql`.

**Fix:** Removed role creation and `ALTER ROLE ... SUPERUSER` lines entirely. `supabase_storage_admin` is created by Supabase init. Kept only the `GRANT USAGE`, `ALTER ROLE SET search_path`, and `ALTER DEFAULT PRIVILEGES` statements, with the latter wrapped in exception handlers (requires role membership not available to `postgres`).

---

## Error 9 — Migration 012 re-creates all objects from scratch

**Error:** `trigger "organisations_updated_at" for relation "organisations" already exists` / `relation "inspection_sessions_seq" already exists` / `policy "devices: insert own org" already exists`.

**Cause:** `012_recover_missing_tables.sql` is a recovery migration written to re-run everything from migrations 001–011 in case of a prior failure. On a clean install all objects already exist.

**Fix:** Applied bulk idempotency transforms:
- `CREATE TABLE` → `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX` → `CREATE INDEX IF NOT EXISTS`
- `CREATE SEQUENCE` → `CREATE SEQUENCE IF NOT EXISTS`
- `CREATE TRIGGER` → `CREATE OR REPLACE TRIGGER` (available Postgres 14+)
- `CREATE POLICY` → prefixed each with `DROP POLICY IF EXISTS` via Python script
- `ON CONFLICT (id) DO NOTHING` → `ON CONFLICT DO NOTHING` (handles all unique constraints, not just PK)
- `ALTER PUBLICATION supabase_realtime ADD TABLE` → wrapped in `DO ... EXCEPTION WHEN OTHERS THEN NULL`
