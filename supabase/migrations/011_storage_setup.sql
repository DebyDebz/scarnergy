-- ============================================================
-- SCARNERGY v2.0 — Migration 011: Supabase Storage API Setup
-- Sets up the supabase_storage_admin role, grants, and
-- search_path defaults required for supabase/storage-api.
--
-- NOTE: Run this BEFORE starting the storage-api container.
-- The storage-api will create storage.buckets / storage.objects
-- at startup; ALTER DEFAULT PRIVILEGES ensures those tables
-- are immediately accessible by the JWT roles.
-- ============================================================

-- ─── Role ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE ROLE supabase_storage_admin NOINHERIT LOGIN PASSWORD 'postgres' SUPERUSER;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER ROLE supabase_storage_admin SUPERUSER;
ALTER ROLE supabase_storage_admin SET search_path TO storage;

-- ─── Storage schema ownership ─────────────────────────────────────────────────
ALTER SCHEMA storage OWNER TO supabase_storage_admin;

-- ─── Schema USAGE for JWT roles ──────────────────────────────────────────────
GRANT USAGE  ON SCHEMA storage TO anon, authenticated, service_role;
GRANT CREATE ON SCHEMA storage TO supabase_storage_admin;

-- ─── Search-path defaults so SET LOCAL ROLE <jwt_role> finds storage tables ──
ALTER ROLE anon          SET search_path TO storage, public, extensions;
ALTER ROLE authenticated SET search_path TO storage, public, extensions;
ALTER ROLE service_role  SET search_path TO storage, public, extensions;

-- ─── Default privileges (applies to tables created AFTER this runs) ──────────
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ─── Grant on existing objects (idempotent: no-op when schema is empty) ──────
DO $$
BEGIN
  GRANT ALL ON ALL TABLES    IN SCHEMA storage TO anon, authenticated, service_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated, service_role;
  GRANT ALL ON ALL FUNCTIONS IN SCHEMA storage TO anon, authenticated, service_role;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ─── pg_hba trust entry for supabase_storage_admin ───────────────────────────
-- The storage-api Node.js pg driver uses SCRAM-SHA-256 by default on pg15.
-- Trust auth bypasses the authentication handshake for this role.
-- This is inserted into pg_hba.conf once, at DB init time.
-- (The actual pg_hba.conf is managed in docker-compose via the db command flags;
--  this comment documents the required rule added manually.)
--
-- host all supabase_storage_admin all trust   ← add to pg_hba.conf

-- ─── storage.migrations alignment note ───────────────────────────────────────
-- After the storage-api first starts, its migrations table begins at id=2.
-- The postgres-migrations library uses array-index lookups, so ids 0 and 1
-- must exist to keep indices aligned. Run this AFTER the storage-api's first
-- startup (when storage.migrations already exists):
--
-- INSERT INTO storage.migrations (id, name, hash, executed_at) VALUES
--   (0, 'create-migrations-table', 'e18db593bcde2aca2a408c4d1100f6abba2195df', NOW()),
--   (1, 'initialmigration',        '6ab16121fbaa08bbd11b712d05f358f9b555d777', NOW())
-- ON CONFLICT (id) DO NOTHING;
