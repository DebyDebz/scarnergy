-- ============================================================
-- SCARNERGY v2.0 — Migration 000: Supabase DB Roles & Schemas
-- MUST run first. Creates all roles that GoTrue, PostgREST,
-- and Realtime expect to find when they connect to the DB.
-- ============================================================

-- ─── SCHEMAS ──────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS _realtime;
CREATE SCHEMA IF NOT EXISTS graphql_public;

-- ─── ROLES ────────────────────────────────────────────────────────────────

-- Anonymous (unauthenticated) API access
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Authenticated user session role
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PostgREST connects as this role and switches to anon/authenticated
DO $$ BEGIN
  CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'ytNHPVpcpFwwaZujezJmFXKi';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- GoTrue connects as this role to manage auth.users
DO $$ BEGIN
  CREATE ROLE supabase_auth_admin NOINHERIT LOGIN PASSWORD 'ytNHPVpcpFwwaZujezJmFXKi';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Realtime connects as this role
DO $$ BEGIN
  CREATE ROLE supabase_admin NOINHERIT LOGIN PASSWORD 'ytNHPVpcpFwwaZujezJmFXKi' SUPERUSER;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Service-role bypasses RLS
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Supabase Studio / postgres-meta
DO $$ BEGIN
  CREATE ROLE supabase NOINHERIT LOGIN PASSWORD 'ytNHPVpcpFwwaZujezJmFXKi' SUPERUSER;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Realtime admin
DO $$ BEGIN
  CREATE ROLE supabase_realtime_admin NOINHERIT LOGIN PASSWORD 'ytNHPVpcpFwwaZujezJmFXKi';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── ROLE MEMBERSHIP ──────────────────────────────────────────────────────

GRANT anon        TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role  TO authenticator;
GRANT anon          TO supabase_auth_admin;
GRANT authenticated TO supabase_auth_admin;

-- ─── SCHEMA OWNERSHIP & GRANTS ────────────────────────────────────────────

ALTER SCHEMA auth        OWNER TO supabase_auth_admin;
ALTER SCHEMA extensions  OWNER TO postgres;
ALTER SCHEMA storage     OWNER TO postgres;

-- Storage API connects as this role
DO $$ BEGIN
  CREATE ROLE supabase_storage_admin NOINHERIT LOGIN PASSWORD 'ytNHPVpcpFwwaZujezJmFXKi';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Pre-create auth.users with ALL columns that GoTrue v2 expects so its init migration
-- (00_init_auth_schema.up.sql) can create its indexes without error.
-- GoTrue runs CREATE TABLE IF NOT EXISTS (skips because table exists) then immediately
-- CREATE INDEX on instance_id/email — those indexes require the columns to be present.
CREATE TABLE IF NOT EXISTS auth.users (
  id                    UUID         NOT NULL PRIMARY KEY,
  instance_id           UUID,
  aud                   VARCHAR(255),
  "role"                VARCHAR(255),
  email                 VARCHAR(255) UNIQUE,
  encrypted_password    VARCHAR(255),
  confirmed_at          TIMESTAMPTZ,
  invited_at            TIMESTAMPTZ,
  confirmation_token    VARCHAR(255),
  confirmation_sent_at  TIMESTAMPTZ,
  recovery_token        VARCHAR(255),
  recovery_sent_at      TIMESTAMPTZ,
  email_change_token    VARCHAR(255),
  email_change          VARCHAR(255),
  email_change_sent_at  TIMESTAMPTZ,
  last_sign_in_at       TIMESTAMPTZ,
  raw_app_meta_data     JSONB,
  raw_user_meta_data    JSONB,
  is_super_admin        BOOL,
  created_at            TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ
);
ALTER TABLE auth.users OWNER TO supabase_auth_admin;
ALTER SCHEMA _realtime   OWNER TO supabase_realtime_admin;
ALTER SCHEMA graphql_public OWNER TO postgres;

GRANT USAGE ON SCHEMA public          TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions      TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth            TO anon, authenticated, service_role, supabase_auth_admin;
GRANT USAGE ON SCHEMA _realtime       TO supabase_realtime_admin, supabase_admin;

GRANT ALL ON SCHEMA public   TO postgres, supabase_admin, service_role, supabase_auth_admin;
GRANT ALL ON SCHEMA auth     TO supabase_auth_admin, postgres;
GRANT ALL ON SCHEMA _realtime TO supabase_realtime_admin, supabase_admin;

-- ─── DEFAULT PRIVILEGES ───────────────────────────────────────────────────

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES    TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON ROUTINES  TO postgres, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;

-- ─── DEFAULT SEARCH PATHS ────────────────────────────────────────────────────
-- GoTrue queries auth tables without schema prefix, so auth must be in the path.

ALTER ROLE supabase_auth_admin SET search_path TO auth, public;

-- ─── POSTGRES USER GRANTS ─────────────────────────────────────────────────

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public   TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth     TO supabase_auth_admin;

-- Storage admin needs full access to its schema and DB
GRANT CONNECT, CREATE ON DATABASE postgres TO supabase_storage_admin;
ALTER SCHEMA storage OWNER TO supabase_storage_admin;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
GRANT ALL ON SCHEMA public  TO supabase_storage_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES    TO supabase_storage_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON SEQUENCES TO supabase_storage_admin;
