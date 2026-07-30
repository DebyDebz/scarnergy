-- Clear all operational/inspection data, keeping only accounts and organisations.
--
-- KEPT:   organisations, user_profiles, auth.* (Supabase-managed login accounts)
-- WIPED:  everything derived from inspection work — buildings, zones, elements,
--         openings, rekenzones, element_defaults, sessions, measurements,
--         sync_queue, audit_log, ble_devices, building_facade_photos.
--
-- Run against: whatever POSTGRES_HOST/SUPABASE_URL your current .env points to
-- (at authoring time: 212.69.86.210). Confirm you're on the intended host
-- before executing (`\conninfo` in psql, or check the Supabase project URL).
--
-- IMPORTANT — take a backup first, e.g.:
--   pg_dump "$POSTGRES_URL" -F c -f pre_wipe_backup.dump
--
-- NOTE: this only clears database rows. It does NOT remove files already
-- uploaded to Supabase Storage (floor plan images, facade photos). Clear
-- those buckets separately via the Supabase dashboard/Storage API if needed.

BEGIN;

-- Child-most tables first (harmless either way since CASCADE is used, but
-- kept in dependency order for readability).
TRUNCATE TABLE
  audit_log,
  sync_queue,
  measurements,
  inspection_sessions,
  building_facade_photos,
  openings,
  element_defaults,
  rekenzones,
  building_elements,
  zones,
  ble_devices,
  buildings
CASCADE;

-- Explicitly NOT touched: organisations, user_profiles, auth.users, auth.identities, auth.sessions, etc.

COMMIT;

-- Sanity check after running:
-- SELECT 'organisations' t, count(*) FROM organisations
-- UNION ALL SELECT 'user_profiles', count(*) FROM user_profiles
-- UNION ALL SELECT 'buildings', count(*) FROM buildings
-- UNION ALL SELECT 'zones', count(*) FROM zones
-- UNION ALL SELECT 'measurements', count(*) FROM measurements;
