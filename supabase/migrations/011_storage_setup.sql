-- ============================================================
-- SCARNERGY v2.0 — Migration 011: Storage schema grants
-- supabase_storage_admin is created by Supabase init — we only
-- add the grants and default privileges that our app needs.
-- ============================================================

-- Schema usage for JWT roles
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

-- Search-path defaults
ALTER ROLE anon          SET search_path TO storage, public, extensions;
ALTER ROLE authenticated SET search_path TO storage, public, extensions;
ALTER ROLE service_role  SET search_path TO storage, public, extensions;

-- Default privileges for tables created by the storage-api after startup
DO $$ BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
    GRANT ALL ON TABLES    TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
    GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
    GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Grant on any objects that already exist (idempotent)
DO $$ BEGIN
  GRANT ALL ON ALL TABLES    IN SCHEMA storage TO anon, authenticated, service_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated, service_role;
  GRANT ALL ON ALL FUNCTIONS IN SCHEMA storage TO anon, authenticated, service_role;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
