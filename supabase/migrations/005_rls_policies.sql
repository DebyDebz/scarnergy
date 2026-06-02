-- ============================================================
-- SCARNERGY v2.0 — Migration 005: Row-Level Security
-- Multi-tenancy enforced at the database engine level.
-- Even a bug in application code cannot bypass tenant isolation.
-- ============================================================

-- ─── HELPER FUNCTIONS ────────────────────────────────────────────────────

-- Get the current user's org_id from their JWT
CREATE OR REPLACE FUNCTION auth.user_org_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt() ->> 'org_id')::UUID;
$$;

-- Get the current user's role from their JWT
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS user_role LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt() ->> 'user_role')::user_role;
$$;

-- Get the current user's profile ID
CREATE OR REPLACE FUNCTION auth.user_profile_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT auth.uid();
$$;

-- Check if current user is admin or supervisor
CREATE OR REPLACE FUNCTION auth.is_privileged()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT auth.user_role() IN ('admin', 'supervisor', 'service_role');
$$;

-- ─── ENABLE RLS ON ALL TABLES ────────────────────────────────────────────

ALTER TABLE organisations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ble_devices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE buildings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE zones               ENABLE ROW LEVEL SECURITY;
ALTER TABLE building_elements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE openings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_queue          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           ENABLE ROW LEVEL SECURITY;

-- ─── ORGANISATIONS ───────────────────────────────────────────────────────
-- Users can only see their own organisation

CREATE POLICY "orgs: users see own org"
  ON organisations FOR SELECT
  USING (id = auth.user_org_id());

CREATE POLICY "orgs: admins can update"
  ON organisations FOR UPDATE
  USING (id = auth.user_org_id() AND auth.is_privileged());

-- ─── USER PROFILES ───────────────────────────────────────────────────────

CREATE POLICY "profiles: see own org users"
  ON user_profiles FOR SELECT
  USING (id = auth.uid() OR org_id = auth.user_org_id());

CREATE POLICY "profiles: insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (id = auth.user_profile_id() AND org_id = auth.user_org_id());

CREATE POLICY "profiles: update own profile"
  ON user_profiles FOR UPDATE
  USING (
    -- Users can update themselves; admins can update anyone in their org
    (id = auth.user_profile_id())
    OR
    (org_id = auth.user_org_id() AND auth.is_privileged())
  );

-- ─── BLE DEVICES ─────────────────────────────────────────────────────────

CREATE POLICY "devices: see own org devices"
  ON ble_devices FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "devices: insert own org"
  ON ble_devices FOR INSERT
  WITH CHECK (org_id = auth.user_org_id());

CREATE POLICY "devices: update own org"
  ON ble_devices FOR UPDATE
  USING (org_id = auth.user_org_id());

-- ─── BUILDINGS ───────────────────────────────────────────────────────────

CREATE POLICY "buildings: see own org"
  ON buildings FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "buildings: insert own org"
  ON buildings FOR INSERT
  WITH CHECK (org_id = auth.user_org_id());

CREATE POLICY "buildings: update own org"
  ON buildings FOR UPDATE
  USING (org_id = auth.user_org_id());

CREATE POLICY "buildings: delete — admins only"
  ON buildings FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.is_privileged());

-- ─── ZONES ───────────────────────────────────────────────────────────────

CREATE POLICY "zones: see own org"
  ON zones FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "zones: insert own org"
  ON zones FOR INSERT
  WITH CHECK (org_id = auth.user_org_id());

CREATE POLICY "zones: update own org"
  ON zones FOR UPDATE
  USING (org_id = auth.user_org_id());

CREATE POLICY "zones: delete — admins only"
  ON zones FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.is_privileged());

-- ─── BUILDING ELEMENTS ───────────────────────────────────────────────────

CREATE POLICY "elements: see own org"
  ON building_elements FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "elements: insert own org"
  ON building_elements FOR INSERT
  WITH CHECK (org_id = auth.user_org_id());

CREATE POLICY "elements: update own org"
  ON building_elements FOR UPDATE
  USING (org_id = auth.user_org_id());

CREATE POLICY "elements: delete — admins only"
  ON building_elements FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.is_privileged());

-- ─── OPENINGS ────────────────────────────────────────────────────────────

CREATE POLICY "openings: see own org"
  ON openings FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "openings: insert own org"
  ON openings FOR INSERT
  WITH CHECK (org_id = auth.user_org_id());

CREATE POLICY "openings: update own org"
  ON openings FOR UPDATE
  USING (org_id = auth.user_org_id());

CREATE POLICY "openings: delete — admins only"
  ON openings FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.is_privileged());

-- ─── INSPECTION SESSIONS ─────────────────────────────────────────────────
-- Inspectors: only their own sessions
-- Supervisors/Admins: all sessions in their org

CREATE POLICY "sessions: inspector sees own"
  ON inspection_sessions FOR SELECT
  USING (
    org_id = auth.user_org_id()
    AND (
      inspector_id = auth.user_profile_id()
      OR auth.is_privileged()
    )
  );

CREATE POLICY "sessions: inspector inserts own"
  ON inspection_sessions FOR INSERT
  WITH CHECK (
    org_id = auth.user_org_id()
    AND inspector_id = auth.user_profile_id()
  );

CREATE POLICY "sessions: update own or privileged"
  ON inspection_sessions FOR UPDATE
  USING (
    org_id = auth.user_org_id()
    AND (
      inspector_id = auth.user_profile_id()
      OR auth.is_privileged()
    )
  );

-- ─── MEASUREMENTS ────────────────────────────────────────────────────────
-- Inspectors: only measurements from their own sessions
-- Supervisors/Admins: all measurements in their org

CREATE POLICY "measurements: inspector sees own"
  ON measurements FOR SELECT
  USING (
    org_id = auth.user_org_id()
    AND (
      inspector_id = auth.user_profile_id()
      OR auth.is_privileged()
    )
  );

CREATE POLICY "measurements: inspector inserts own"
  ON measurements FOR INSERT
  WITH CHECK (
    org_id = auth.user_org_id()
    AND inspector_id = auth.user_profile_id()
  );

-- Measurements are immutable — no UPDATE policy
-- Use is_deleted flag instead

-- ─── SYNC QUEUE ──────────────────────────────────────────────────────────

CREATE POLICY "sync: inspector sees own queue"
  ON sync_queue FOR SELECT
  USING (
    org_id = auth.user_org_id()
    AND (
      inspector_id = auth.user_profile_id()
      OR auth.is_privileged()
    )
  );

CREATE POLICY "sync: inspector inserts own"
  ON sync_queue FOR INSERT
  WITH CHECK (
    org_id = auth.user_org_id()
    AND inspector_id = auth.user_profile_id()
  );

CREATE POLICY "sync: inspector updates own"
  ON sync_queue FOR UPDATE
  USING (
    org_id = auth.user_org_id()
    AND inspector_id = auth.user_profile_id()
  );

-- ─── AUDIT LOG ───────────────────────────────────────────────────────────

CREATE POLICY "audit: admins only"
  ON audit_log FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'admin');

-- Audit log is append-only — no UPDATE or DELETE policies

-- ─── SERVICE ROLE BYPASS ────────────────────────────────────────────────
-- The service_role key bypasses RLS automatically in Supabase.
-- The following grants ensure the anon and authenticated roles
-- have the minimum required privileges.

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
REVOKE DELETE ON organisations, user_profiles, audit_log FROM authenticated;

-- PostgREST switches to anon/authenticated roles to execute queries.
-- Those roles must be able to call auth.* helper functions used in RLS policies.
GRANT USAGE ON SCHEMA auth TO authenticator, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;
