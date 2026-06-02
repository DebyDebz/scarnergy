-- ============================================================
-- SCARNERGY v2.0 — Migration 012: Recovery
-- Completes what 002_core_schema.sql never finished.
-- root cause: `user_profiles` references auth.users which did
-- not exist when docker-entrypoint-initdb.d ran (GoTrue hadn't
-- started yet).  ON_ERROR_STOP=1 aborted psql, so every
-- migration from user_profiles onward was skipped.
-- ============================================================

-- ─── 002 remainder: function + user_profiles + ble_devices ───────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organisations_updated_at
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  role          user_role NOT NULL DEFAULT 'inspector',
  full_name     TEXT NOT NULL,
  phone         TEXT,
  avatar_url    TEXT,
  certifications JSONB NOT NULL DEFAULT '[]',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_org  ON user_profiles(org_id);
CREATE INDEX idx_user_profiles_role ON user_profiles(org_id, role);

CREATE TABLE ble_devices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  device_type       device_type NOT NULL DEFAULT 'bosch_glm50c',
  mac_address       TEXT NOT NULL,
  serial_number     TEXT,
  nickname          TEXT,
  firmware_version  TEXT,
  battery_level     SMALLINT CHECK (battery_level BETWEEN 0 AND 100),
  last_connected_at TIMESTAMPTZ,
  last_measurement_at TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, mac_address)
);

CREATE INDEX idx_ble_devices_org ON ble_devices(org_id);
CREATE INDEX idx_ble_devices_mac ON ble_devices(mac_address);

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER ble_devices_updated_at
  BEFORE UPDATE ON ble_devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 003: buildings, zones, building_elements, openings ──────────────────

CREATE TABLE buildings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  reference_code        TEXT,
  bag_id                TEXT,
  description           TEXT,
  street                TEXT NOT NULL,
  house_number          TEXT NOT NULL,
  house_number_addition TEXT,
  postal_code           TEXT NOT NULL,
  city                  TEXT NOT NULL,
  municipality          TEXT,
  province              TEXT,
  country               TEXT NOT NULL DEFAULT 'NL',
  latitude              NUMERIC(10, 7),
  longitude             NUMERIC(10, 7),
  building_type         building_type NOT NULL DEFAULT 'residential_single',
  construction_year     SMALLINT CHECK (construction_year BETWEEN 1400 AND 2100),
  year_class            construction_year_class,
  gross_floor_area_m2   NUMERIC(10,2),
  num_floors            SMALLINT,
  num_units             SMALLINT,
  nta_building_category TEXT,
  compactness_factor    NUMERIC(6,4),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  notes                 TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_by            UUID REFERENCES user_profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_buildings_org      ON buildings(org_id);
CREATE INDEX idx_buildings_postal   ON buildings(postal_code);
CREATE INDEX idx_buildings_bag      ON buildings(bag_id);
CREATE INDEX idx_buildings_location ON buildings(latitude, longitude);
CREATE INDEX idx_buildings_name     ON buildings USING gin(description gin_trgm_ops);

CREATE TABLE zones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  building_id       UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  zone_code         TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  floor_level       SMALLINT NOT NULL DEFAULT 0,
  gross_area_m2     NUMERIC(10,2),
  net_area_m2       NUMERIC(10,2),
  volume_m3         NUMERIC(10,2),
  ceiling_height_m  NUMERIC(6,3),
  zone_function     TEXT,
  is_heated         BOOLEAN NOT NULL DEFAULT TRUE,
  is_cooled         BOOLEAN NOT NULL DEFAULT FALSE,
  setpoint_heating  NUMERIC(5,2),
  setpoint_cooling  NUMERIC(5,2),
  energy_label      energy_label,
  primary_energy_demand NUMERIC(10,2),
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(building_id, zone_code)
);

CREATE INDEX idx_zones_org      ON zones(org_id);
CREATE INDEX idx_zones_building ON zones(building_id);

CREATE TABLE building_elements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  zone_id           UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  element_type      element_type NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  length_mm         NUMERIC(10,2),
  width_mm          NUMERIC(10,2),
  height_mm         NUMERIC(10,2),
  area_m2           NUMERIC(10,2),
  orientation_deg   NUMERIC(6,2),
  tilt_deg          NUMERIC(6,2),
  rc_value          NUMERIC(8,4),
  u_value           NUMERIC(8,4),
  lambda_value      NUMERIC(8,4),
  insulation_thickness_mm NUMERIC(8,2),
  construction_type TEXT,
  insulation_type   TEXT,
  finish_type       TEXT,
  installation_type TEXT,
  fuel_type         TEXT,
  efficiency        NUMERIC(6,4),
  capacity_kw       NUMERIC(10,2),
  year_installed    SMALLINT,
  photo_urls        TEXT[] NOT NULL DEFAULT '{}',
  is_complete       BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_elements_org  ON building_elements(org_id);
CREATE INDEX idx_elements_zone ON building_elements(zone_id);
CREATE INDEX idx_elements_type ON building_elements(zone_id, element_type);

CREATE TABLE openings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  element_id        UUID NOT NULL REFERENCES building_elements(id) ON DELETE CASCADE,
  opening_type      TEXT NOT NULL DEFAULT 'window',
  name              TEXT,
  width_mm          NUMERIC(10,2),
  height_mm         NUMERIC(10,2),
  area_m2           NUMERIC(10,2),
  glazing_type      TEXT,
  frame_type        TEXT,
  g_value           NUMERIC(6,4),
  u_value_frame     NUMERIC(8,4),
  u_value_glass     NUMERIC(8,4),
  u_value_total     NUMERIC(8,4),
  has_shading       BOOLEAN NOT NULL DEFAULT FALSE,
  shading_type      TEXT,
  shading_factor    NUMERIC(6,4),
  photo_urls        TEXT[] NOT NULL DEFAULT '{}',
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_openings_org     ON openings(org_id);
CREATE INDEX idx_openings_element ON openings(element_id);

CREATE TRIGGER buildings_updated_at
  BEFORE UPDATE ON buildings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER zones_updated_at
  BEFORE UPDATE ON zones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER building_elements_updated_at
  BEFORE UPDATE ON building_elements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER openings_updated_at
  BEFORE UPDATE ON openings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 004: inspection_sessions, measurements hypertable, sync_queue ───────

CREATE TABLE inspection_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  building_id     UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  inspector_id    UUID NOT NULL REFERENCES user_profiles(id),
  supervisor_id   UUID REFERENCES user_profiles(id),
  session_code    TEXT NOT NULL,
  status          session_status NOT NULL DEFAULT 'active',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at       TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  duration_seconds INTEGER,
  total_measurements  INTEGER NOT NULL DEFAULT 0,
  anomaly_count       INTEGER NOT NULL DEFAULT 0,
  completion_pct      NUMERIC(5,2),
  outdoor_temp_c      NUMERIC(5,2),
  weather_description TEXT,
  sync_status     sync_status NOT NULL DEFAULT 'pending',
  last_synced_at  TIMESTAMPTZ,
  offline_duration_seconds INTEGER NOT NULL DEFAULT 0,
  report_url      TEXT,
  report_generated_at TIMESTAMPTZ,
  notes           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE inspection_sessions_seq START 1;

CREATE OR REPLACE FUNCTION generate_session_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.session_code = 'INS-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
                     LPAD(nextval('inspection_sessions_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_session_code
  BEFORE INSERT ON inspection_sessions
  FOR EACH ROW
  WHEN (NEW.session_code IS NULL OR NEW.session_code = '')
  EXECUTE FUNCTION generate_session_code();

CREATE INDEX idx_sessions_org       ON inspection_sessions(org_id);
CREATE INDEX idx_sessions_building  ON inspection_sessions(building_id);
CREATE INDEX idx_sessions_inspector ON inspection_sessions(inspector_id);
CREATE INDEX idx_sessions_status    ON inspection_sessions(org_id, status);
CREATE INDEX idx_sessions_started   ON inspection_sessions(started_at DESC);

CREATE TABLE measurements (
  measured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  session_id        UUID NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  device_id         UUID NOT NULL REFERENCES ble_devices(id),
  inspector_id      UUID NOT NULL REFERENCES user_profiles(id),
  element_id        UUID REFERENCES building_elements(id),
  opening_id        UUID REFERENCES openings(id),
  value_mm          NUMERIC(12,4) NOT NULL,
  unit              measurement_unit NOT NULL DEFAULT 'mm',
  measurement_type  TEXT,
  raw_ble_bytes     BYTEA,
  anomaly_score     NUMERIC(8,6),
  is_anomaly        BOOLEAN NOT NULL DEFAULT FALSE,
  classifier_label  TEXT,
  classifier_confidence NUMERIC(6,4),
  validation_result validation_result,
  validation_message TEXT,
  validated_at      TIMESTAMPTZ,
  session_mean_mm   NUMERIC(12,4),
  session_std_mm    NUMERIC(12,4),
  session_count     INTEGER,
  ingestion_path    TEXT NOT NULL DEFAULT 'mobile',
  client_timestamp  TIMESTAMPTZ,
  sync_status       sync_status NOT NULL DEFAULT 'synced',
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at        TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (measured_at, id)
);

SELECT create_hypertable('measurements', 'measured_at',
  chunk_time_interval => INTERVAL '1 week',
  if_not_exists => TRUE
);

-- Retention policy only — compression skipped in dev (TimescaleDB FK segmentby
-- constraint prevents enabling it without dropping all FKs on measurements)
SELECT add_retention_policy('measurements', INTERVAL '10 years');

CREATE INDEX idx_measurements_org_time  ON measurements(org_id, measured_at DESC);
CREATE INDEX idx_measurements_session   ON measurements(session_id, measured_at DESC);
CREATE INDEX idx_measurements_device    ON measurements(device_id, measured_at DESC);
CREATE INDEX idx_measurements_inspector ON measurements(inspector_id, measured_at DESC);
CREATE INDEX idx_measurements_element   ON measurements(element_id, measured_at DESC)
  WHERE element_id IS NOT NULL;
CREATE INDEX idx_measurements_anomaly   ON measurements(org_id, is_anomaly, measured_at DESC)
  WHERE is_anomaly = TRUE;

CREATE MATERIALIZED VIEW measurements_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', measured_at) AS bucket,
  org_id,
  device_id,
  element_id,
  COUNT(*)        AS measurement_count,
  AVG(value_mm)   AS avg_mm,
  MIN(value_mm)   AS min_mm,
  MAX(value_mm)   AS max_mm,
  STDDEV(value_mm) AS stddev_mm,
  SUM(is_anomaly::INT) AS anomaly_count,
  AVG(anomaly_score)   AS avg_anomaly_score
FROM measurements
WHERE is_deleted = FALSE
GROUP BY 1, 2, 3, 4
WITH NO DATA;

SELECT add_continuous_aggregate_policy('measurements_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '30 minutes',
  schedule_interval => INTERVAL '30 minutes'
);

CREATE TABLE sync_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  inspector_id    UUID NOT NULL REFERENCES user_profiles(id),
  table_name      TEXT NOT NULL,
  record_id       UUID NOT NULL,
  operation       TEXT NOT NULL,
  payload         JSONB NOT NULL,
  client_timestamp TIMESTAMPTZ NOT NULL,
  server_timestamp TIMESTAMPTZ,
  sync_status     sync_status NOT NULL DEFAULT 'pending',
  retry_count     SMALLINT NOT NULL DEFAULT 0,
  error_message   TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_queue_inspector ON sync_queue(inspector_id, sync_status);
CREATE INDEX idx_sync_queue_pending   ON sync_queue(org_id, sync_status, client_timestamp)
  WHERE sync_status = 'pending';

-- audit_log omitted: Metabase occupies "public"."audit_log" in this shared DB
-- The "audit: admins only" RLS policy below is also omitted for the same reason

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON inspection_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 005: RLS policies ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION auth.user_org_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt() ->> 'org_id')::UUID;
$$;

CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS user_role LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt() ->> 'user_role')::user_role;
$$;

CREATE OR REPLACE FUNCTION auth.user_profile_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION auth.is_privileged()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT auth.user_role() IN ('admin', 'supervisor', 'service_role');
$$;

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

CREATE POLICY "orgs: users see own org"   ON organisations FOR SELECT USING (id = auth.user_org_id());
CREATE POLICY "orgs: admins can update"   ON organisations FOR UPDATE USING (id = auth.user_org_id() AND auth.is_privileged());
CREATE POLICY "profiles: see own org users" ON user_profiles FOR SELECT USING (id = auth.uid() OR org_id = auth.user_org_id());
CREATE POLICY "profiles: insert own profile" ON user_profiles FOR INSERT WITH CHECK (id = auth.user_profile_id() AND org_id = auth.user_org_id());
CREATE POLICY "profiles: update own profile" ON user_profiles FOR UPDATE USING ((id = auth.user_profile_id()) OR (org_id = auth.user_org_id() AND auth.is_privileged()));
CREATE POLICY "devices: see own org devices" ON ble_devices FOR SELECT USING (org_id = auth.user_org_id());
CREATE POLICY "devices: insert own org"      ON ble_devices FOR INSERT WITH CHECK (org_id = auth.user_org_id());
CREATE POLICY "devices: update own org"      ON ble_devices FOR UPDATE USING (org_id = auth.user_org_id());
CREATE POLICY "buildings: see own org"       ON buildings FOR SELECT USING (org_id = auth.user_org_id());
CREATE POLICY "buildings: insert own org"    ON buildings FOR INSERT WITH CHECK (org_id = auth.user_org_id());
CREATE POLICY "buildings: update own org"    ON buildings FOR UPDATE USING (org_id = auth.user_org_id());
CREATE POLICY "buildings: delete — admins only" ON buildings FOR DELETE USING (org_id = auth.user_org_id() AND auth.is_privileged());
CREATE POLICY "zones: see own org"           ON zones FOR SELECT USING (org_id = auth.user_org_id());
CREATE POLICY "zones: insert own org"        ON zones FOR INSERT WITH CHECK (org_id = auth.user_org_id());
CREATE POLICY "zones: update own org"        ON zones FOR UPDATE USING (org_id = auth.user_org_id());
CREATE POLICY "zones: delete — admins only"  ON zones FOR DELETE USING (org_id = auth.user_org_id() AND auth.is_privileged());
CREATE POLICY "elements: see own org"        ON building_elements FOR SELECT USING (org_id = auth.user_org_id());
CREATE POLICY "elements: insert own org"     ON building_elements FOR INSERT WITH CHECK (org_id = auth.user_org_id());
CREATE POLICY "elements: update own org"     ON building_elements FOR UPDATE USING (org_id = auth.user_org_id());
CREATE POLICY "elements: delete — admins only" ON building_elements FOR DELETE USING (org_id = auth.user_org_id() AND auth.is_privileged());
CREATE POLICY "openings: see own org"        ON openings FOR SELECT USING (org_id = auth.user_org_id());
CREATE POLICY "openings: insert own org"     ON openings FOR INSERT WITH CHECK (org_id = auth.user_org_id());
CREATE POLICY "openings: update own org"     ON openings FOR UPDATE USING (org_id = auth.user_org_id());
CREATE POLICY "openings: delete — admins only" ON openings FOR DELETE USING (org_id = auth.user_org_id() AND auth.is_privileged());
CREATE POLICY "sessions: inspector sees own"    ON inspection_sessions FOR SELECT USING (org_id = auth.user_org_id() AND (inspector_id = auth.user_profile_id() OR auth.is_privileged()));
CREATE POLICY "sessions: inspector inserts own" ON inspection_sessions FOR INSERT WITH CHECK (org_id = auth.user_org_id() AND inspector_id = auth.user_profile_id());
CREATE POLICY "sessions: update own or privileged" ON inspection_sessions FOR UPDATE USING (org_id = auth.user_org_id() AND (inspector_id = auth.user_profile_id() OR auth.is_privileged()));
CREATE POLICY "measurements: inspector sees own"    ON measurements FOR SELECT USING (org_id = auth.user_org_id() AND (inspector_id = auth.user_profile_id() OR auth.is_privileged()));
CREATE POLICY "measurements: inspector inserts own" ON measurements FOR INSERT WITH CHECK (org_id = auth.user_org_id() AND inspector_id = auth.user_profile_id());
CREATE POLICY "sync: inspector sees own queue" ON sync_queue FOR SELECT USING (org_id = auth.user_org_id() AND (inspector_id = auth.user_profile_id() OR auth.is_privileged()));
CREATE POLICY "sync: inspector inserts own"    ON sync_queue FOR INSERT WITH CHECK (org_id = auth.user_org_id() AND inspector_id = auth.user_profile_id());
CREATE POLICY "sync: inspector updates own"    ON sync_queue FOR UPDATE USING (org_id = auth.user_org_id() AND inspector_id = auth.user_profile_id());

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
REVOKE DELETE ON organisations, user_profiles, audit_log FROM authenticated;
GRANT USAGE ON SCHEMA auth TO authenticator, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;

-- ─── 006: auth JWT hook + new-user trigger ────────────────────────────────

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  claims  JSONB;
  profile RECORD;
BEGIN
  claims := event -> 'claims';
  SELECT org_id, role, full_name, is_active INTO profile
  FROM public.user_profiles WHERE id = (event ->> 'user_id')::UUID;
  IF NOT FOUND OR NOT profile.is_active THEN
    RETURN jsonb_set(claims, '{org_id}', 'null');
  END IF;
  claims := jsonb_set(claims, '{org_id}',    to_jsonb(profile.org_id::TEXT));
  claims := jsonb_set(claims, '{user_role}', to_jsonb(profile.role::TEXT));
  claims := jsonb_set(claims, '{full_name}', to_jsonb(profile.full_name));
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_profiles (id, org_id, full_name, role)
  VALUES (
    NEW.id,
    (NEW.raw_user_meta_data ->> 'org_id')::UUID,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data ->> 'role')::user_role, 'inspector')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── 006-realtime: replica identity + publication ─────────────────────────

ALTER TABLE measurements        REPLICA IDENTITY FULL;
ALTER TABLE inspection_sessions REPLICA IDENTITY FULL;

DO $$ BEGIN
  CREATE PUBLICATION supabase_realtime;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE measurements;
ALTER PUBLICATION supabase_realtime ADD TABLE inspection_sessions;

-- ─── 007: views ───────────────────────────────────────────────────────────

DROP VIEW IF EXISTS session_summary CASCADE;
CREATE VIEW session_summary AS
SELECT
  s.*,
  up.full_name                        AS inspector_name,
  b.street || ' ' || b.house_number  AS building_address,
  b.city                              AS building_city
FROM inspection_sessions s
JOIN user_profiles up ON up.id = s.inspector_id
JOIN buildings     b  ON b.id  = s.building_id;

DROP VIEW IF EXISTS building_summary CASCADE;
CREATE VIEW building_summary AS
SELECT
  b.*,
  b.street || ' ' || b.house_number || ', ' || b.postal_code || ' ' || b.city AS full_address,
  COUNT(DISTINCT z.id)   AS zone_count,
  COUNT(DISTINCT be.id)  AS element_count,
  COUNT(DISTINCT s.id)   AS session_count,
  MAX(s.started_at)      AS last_inspection_at,
  (
    SELECT z2.energy_label
    FROM   zones z2
    WHERE  z2.building_id = b.id AND z2.energy_label IS NOT NULL
    ORDER  BY z2.updated_at DESC
    LIMIT  1
  )                      AS latest_energy_label
FROM buildings            b
LEFT JOIN zones           z  ON z.building_id  = b.id  AND z.is_active  = TRUE
LEFT JOIN building_elements be ON be.zone_id   = z.id  AND be.is_active = TRUE
LEFT JOIN inspection_sessions s ON s.building_id = b.id
GROUP BY b.id;

DROP VIEW IF EXISTS recent_measurements CASCADE;
CREATE VIEW recent_measurements AS
SELECT
  m.*,
  COALESCE(bd.nickname, 'web')       AS device_nickname,
  be.name                            AS element_name,
  z.name                             AS zone_name,
  b.street || ' ' || b.house_number AS building_address
FROM measurements           m
JOIN  inspection_sessions   s  ON s.id  = m.session_id
JOIN  buildings             b  ON b.id  = s.building_id
LEFT JOIN ble_devices       bd ON bd.id = m.device_id
LEFT JOIN building_elements be ON be.id = m.element_id
LEFT JOIN zones             z  ON z.id  = be.zone_id
WHERE m.is_deleted = FALSE;

GRANT SELECT ON session_summary     TO authenticated, anon;
GRANT SELECT ON building_summary    TO authenticated, anon;
GRANT SELECT ON recent_measurements TO authenticated, anon;

-- ─── 008: seed data ───────────────────────────────────────────────────────

INSERT INTO organisations (id, name, kvk_number, address, city, postal_code, email, phone)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Krontiva Energie Advies BV', '12345678', 'Herengracht 182', 'Amsterdam', '1016 BR', 'info@krontiva.nl', '+31 20 123 4567'),
  ('00000000-0000-0000-0000-000000000002', 'EnergieScan Nederland', '87654321', 'Coolsingel 40', 'Rotterdam', '3011 AD', 'info@energiescan.nl', '+31 10 234 5678')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'dev@scarnergy.test',
  '$2a$10$devbypassplaceholderpasswordhashXXXXXXXXXXXXXXXX',
  NOW(), 'authenticated', 'authenticated',
  '{"provider":"email","providers":["email"]}',
  '{"org_id":"00000000-0000-0000-0000-000000000001","full_name":"Dev User","role":"admin"}',
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO user_profiles (id, org_id, role, full_name, is_active)
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001', 'admin', 'Dev User', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO buildings (id, org_id, reference_code, bag_id, street, house_number, postal_code, city, building_type, construction_year, gross_floor_area_m2, num_floors)
VALUES
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'BLD-2026-001', '0363100012165205', 'Jordaanstraat', '14',  '1016 ZZ', 'Amsterdam', 'residential_single', 1923, 95.0,  3),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'BLD-2026-002', '0599100000123456', 'Bergselaan',    '47A', '3037 EG', 'Rotterdam', 'residential_multi',  1965, 312.0, 4),
  ('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'BLD-2026-003', '0345100000099876', 'Utrechtsestraat','8',  '3512 AB', 'Utrecht',   'residential_single', 1987, 128.5, 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ble_devices (id, org_id, device_type, mac_address, nickname, firmware_version, is_active)
VALUES
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'bosch_glm50c', 'AA:BB:CC:DD:EE:01', 'GLM-01 (Jan)',   '2.3.1', true),
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'bosch_glm50c', 'AA:BB:CC:DD:EE:02', 'GLM-02 (Karin)', '2.3.1', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO zones (id, org_id, building_id, zone_code, name, floor_level, gross_area_m2, ceiling_height_m, is_heated)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Z01', 'Begane grond',        0, 32.0, 2.80, true),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Z02', 'Eerste verdieping',   1, 32.0, 2.75, true),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Z03', 'Tweede verdieping',   2, 31.0, 2.60, true),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Z01', 'Appartement 1 (BG)', 0, 78.0, 2.70, true),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Z02', 'Appartement 2 (1e)', 1, 78.0, 2.70, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO building_elements (id, org_id, zone_id, element_type, name, orientation_deg, rc_value, construction_type)
VALUES
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gevel',      'Voorgevel (Noord)',  0.0,   1.5, 'Spouwmuur 1923'),
  ('e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gevel',      'Achtergevel (Zuid)', 180.0, 1.5, 'Spouwmuur 1923'),
  ('e0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gevel',      'Zijgevel (West)',    270.0, 1.5, 'Spouwmuur 1923'),
  ('e0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'vloer',      'Begane grond vloer', NULL,  1.2, 'Houten balken vloer'),
  ('e0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'dak',        'Hellend dak',        NULL,  2.8, 'Houten kap met glaswol'),
  ('e0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'installatie','CV-ketel Intergas',  NULL,  NULL, NULL)
ON CONFLICT (id) DO NOTHING;

UPDATE building_elements SET installation_type='CV-ketel', fuel_type='Gas', efficiency=0.93, capacity_kw=28, year_installed=2015
WHERE id = 'e0000000-0000-0000-0000-000000000006';

INSERT INTO openings (id, org_id, element_id, opening_type, name, width_mm, height_mm, glazing_type, u_value_total)
VALUES
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'window', 'Voorraam links',  1200, 1400, 'HR++', 1.1),
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'window', 'Voorraam rechts', 1200, 1400, 'HR++', 1.1),
  ('f0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'door',   'Voordeur',        950,  2100, NULL,   2.0)
ON CONFLICT (id) DO NOTHING;

-- ─── 009: updated views (anomaly_feed) ───────────────────────────────────

DROP VIEW IF EXISTS anomaly_feed CASCADE;
CREATE VIEW anomaly_feed AS
SELECT
  m.id, m.org_id, m.session_id, m.element_id, m.device_id,
  m.measured_at, m.value_mm, m.unit, m.is_anomaly, m.anomaly_score,
  m.classifier_label, m.validation_message, m.ingestion_path,
  s.session_code,
  b.id AS building_id,
  b.street || ' ' || b.house_number || ', ' || b.city AS building_address,
  COALESCE(bd.nickname, 'web') AS device_nickname,
  be.name  AS element_name,
  z.name   AS zone_name,
  up.full_name AS inspector_name
FROM measurements           m
JOIN  inspection_sessions   s  ON s.id  = m.session_id
JOIN  buildings             b  ON b.id  = s.building_id
JOIN  user_profiles         up ON up.id = s.inspector_id
LEFT JOIN ble_devices       bd ON bd.id = m.device_id
LEFT JOIN building_elements be ON be.id = m.element_id
LEFT JOIN zones             z  ON z.id  = be.zone_id
WHERE m.is_anomaly = TRUE AND m.is_deleted = FALSE;

GRANT SELECT ON anomaly_feed TO authenticated, anon;

-- ─── 010: device_id nullable ──────────────────────────────────────────────

ALTER TABLE measurements ALTER COLUMN device_id DROP NOT NULL;

-- ─── 011 (storage roles / grants — idempotent) ───────────────────────────

DO $$ BEGIN
  CREATE ROLE supabase_storage_admin NOINHERIT LOGIN PASSWORD 'postgres' SUPERUSER;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER ROLE supabase_storage_admin SUPERUSER;
ALTER ROLE supabase_storage_admin SET search_path TO storage;

DO $$ BEGIN
  ALTER SCHEMA storage OWNER TO supabase_storage_admin;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

GRANT USAGE  ON SCHEMA storage TO anon, authenticated, service_role;
GRANT CREATE ON SCHEMA storage TO supabase_storage_admin;

ALTER ROLE anon          SET search_path TO storage, public, extensions;
ALTER ROLE authenticated SET search_path TO storage, public, extensions;
ALTER ROLE service_role  SET search_path TO storage, public, extensions;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

DO $$
BEGIN
  GRANT ALL ON ALL TABLES    IN SCHEMA storage TO anon, authenticated, service_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated, service_role;
  GRANT ALL ON ALL FUNCTIONS IN SCHEMA storage TO anon, authenticated, service_role;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ─── Reload PostgREST schema cache ───────────────────────────────────────────
-- PostgREST caches the DB schema at startup. When migrations create new tables
-- or views while PostgREST is already running, it needs a signal to reload.
-- This NOTIFY is instant and requires no container restart.
NOTIFY pgrst, 'reload schema';
