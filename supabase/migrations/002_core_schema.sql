-- ============================================================
-- SCARNERGY v2.0 — Migration 002: Core Schema
-- Organisations, Users, Roles, Devices
-- ============================================================

-- ─── ENUMS ────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('inspector', 'supervisor', 'admin', 'service_role');
CREATE TYPE building_type AS ENUM (
  'residential_single', 'residential_multi', 'apartment',
  'office', 'retail', 'industrial', 'mixed_use', 'other'
);
CREATE TYPE construction_year_class AS ENUM (
  'pre_1945', '1945_1974', '1975_1991', '1992_2005',
  '2006_2014', '2015_2020', 'post_2020'
);
CREATE TYPE energy_label AS ENUM ('A++++', 'A+++', 'A++', 'A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G');
CREATE TYPE element_type AS ENUM (
  'gevel',           -- wall / facade
  'dak',             -- roof
  'vloer',           -- floor
  'installatie',     -- installation / HVAC
  'transparant_deel' -- window / door opening
);
CREATE TYPE measurement_unit AS ENUM ('mm', 'cm', 'm', 'deg', 'percent');
CREATE TYPE session_status AS ENUM ('active', 'paused', 'completed', 'cancelled');
CREATE TYPE sync_status AS ENUM ('pending', 'synced', 'conflict', 'failed');
CREATE TYPE device_type AS ENUM ('bosch_glm50c', 'bosch_glm100c', 'other');
CREATE TYPE validation_result AS ENUM ('pass', 'anomaly', 'warning', 'error');

-- ─── ORGANISATIONS ────────────────────────────────────────────────────────

CREATE TABLE organisations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  kvk_number    TEXT UNIQUE,                    -- Dutch Chamber of Commerce number
  address       TEXT,
  city          TEXT,
  postal_code   TEXT,
  country       TEXT NOT NULL DEFAULT 'NL',
  email         TEXT,
  phone         TEXT,
  logo_url      TEXT,
  settings      JSONB NOT NULL DEFAULT '{}',   -- org-level config (units, locale, etc.)
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organisations_name ON organisations USING gin(name gin_trgm_ops);
CREATE INDEX idx_organisations_kvk ON organisations(kvk_number);

-- ─── USER PROFILES (extends Supabase auth.users) ─────────────────────────

CREATE TABLE user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  role          user_role NOT NULL DEFAULT 'inspector',
  full_name     TEXT NOT NULL,
  phone         TEXT,
  avatar_url    TEXT,
  certifications JSONB NOT NULL DEFAULT '[]',  -- NTA 8800 cert numbers, expiry dates
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_org ON user_profiles(org_id);
CREATE INDEX idx_user_profiles_role ON user_profiles(org_id, role);

-- ─── BLE DEVICES ──────────────────────────────────────────────────────────

CREATE TABLE ble_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  device_type     device_type NOT NULL DEFAULT 'bosch_glm50c',
  mac_address     TEXT NOT NULL,
  serial_number   TEXT,
  nickname        TEXT,                        -- "GLM-01", "Red Laser", etc.
  firmware_version TEXT,
  battery_level   SMALLINT CHECK (battery_level BETWEEN 0 AND 100),
  last_connected_at TIMESTAMPTZ,
  last_measurement_at TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(org_id, mac_address)
);

CREATE INDEX idx_ble_devices_org ON ble_devices(org_id);
CREATE INDEX idx_ble_devices_mac ON ble_devices(mac_address);

-- ─── TRIGGER: auto-update updated_at ──────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organisations_updated_at   BEFORE UPDATE ON organisations   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_profiles_updated_at   BEFORE UPDATE ON user_profiles   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER ble_devices_updated_at     BEFORE UPDATE ON ble_devices     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
