#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DB gate (GAP M8): apply the FULL migration chain to a fresh Postgres and run
# the RLS test suite. Used by CI (db job, supabase/postgres service) and
# locally:
#
#   DATABASE_URL=postgres://postgres:postgres@localhost:5499/postgres \
#     bash scripts/db_check.sh
#
# Fails on: any migration error (ON_ERROR_STOP) · any FAIL line from
# supabase/migrations/rls_tests.sql · rls_tests not reaching its final test.
# Migrations apply in C-locale filename order (skip_* and rls_tests excluded),
# matching the manual migration loop.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?Set DATABASE_URL to a fresh Postgres (supabase/postgres image)}"

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)

# ── CI shim ──────────────────────────────────────────────────────────────────
# A bare supabase/postgres image has the roles but not GoTrue's auth.jwt()/
# auth.uid() (created when the full stack initialises). Recreate them exactly
# as Supabase defines them: reading the request.jwt.claims GUC — which is also
# what rls_tests.sql sets. Idempotent; harmless on a full stack.
echo "── Preparing auth shim ──"
"${PSQL[@]}" <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
-- Minimal GoTrue-shaped auth.users (real stack: created/managed by GoTrue).
-- Covers every column migrations 002/006/008/013 touch.
CREATE TABLE IF NOT EXISTS auth.users (
  instance_id            uuid,
  id                     uuid PRIMARY KEY,
  email                  text,
  encrypted_password     text,
  email_confirmed_at     timestamptz,
  aud                    text,
  role                   text,
  raw_app_meta_data      jsonb,
  raw_user_meta_data     jsonb,
  confirmation_token     text,
  recovery_token         text,
  email_change_token_new text,
  email_change           text,
  created_at             timestamptz,
  updated_at             timestamptz,
  is_sso_user            boolean DEFAULT false,
  is_anonymous           boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS auth.identities (
  id              uuid PRIMARY KEY,
  user_id         uuid,
  identity_data   jsonb,
  provider        text,
  provider_id     text,
  last_sign_in_at timestamptz,
  created_at      timestamptz,
  updated_at      timestamptz,
  UNIQUE (provider, provider_id)
);
-- Minimal storage schema (real stack: created by the storage-api service).
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text, public boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, owner uuid,
  metadata jsonb, created_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
SQL

echo "── Applying migrations ──"
for f in $(LC_ALL=C ls supabase/migrations/*.sql | grep -v -e '/skip_' -e '/rls_tests.sql'); do
  echo "  $f"
  "${PSQL[@]}" -f "$f"
done

echo "── Running RLS tests ──"
OUT=$(psql "$DATABASE_URL" -f supabase/migrations/rls_tests.sql 2>&1) || {
  echo "$OUT"; echo "✗ rls_tests.sql errored"; exit 1;
}
echo "$OUT"

if echo "$OUT" | grep -q "FAIL:"; then
  echo "✗ RLS test reported FAIL:"; exit 1
fi
# Sanity: the suite must actually have run to its end, not silently no-oped.
if ! echo "$OUT" | grep -q "RLS suite completed"; then
  echo "✗ rls_tests.sql did not reach its summary — suite incomplete"; exit 1
fi

echo "✓ migrations + RLS tests green"
