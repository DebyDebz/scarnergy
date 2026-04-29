-- ============================================================
-- SCARNERGY v2.0 — Migration 003: NTA 8800 Building Hierarchy
-- Buildings → Zones → Elements → Openings
-- ============================================================

-- ─── BUILDINGS (Objecten) ─────────────────────────────────────────────────

CREATE TABLE buildings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

  -- Identification
  reference_code        TEXT,                  -- Internal reference (e.g. "BLD-2024-001")
  bag_id                TEXT,                  -- Dutch BAG (Basisregistratie Adressen) ID
  description           TEXT,

  -- Address
  street                TEXT NOT NULL,
  house_number          TEXT NOT NULL,
  house_number_addition TEXT,
  postal_code           TEXT NOT NULL,
  city                  TEXT NOT NULL,
  municipality          TEXT,
  province              TEXT,
  country               TEXT NOT NULL DEFAULT 'NL',

  -- Geolocation
  location              GEOMETRY(POINT, 4326), -- PostGIS point (lon, lat)

  -- Classification
  building_type         building_type NOT NULL DEFAULT 'residential_single',
  construction_year     SMALLINT CHECK (construction_year BETWEEN 1400 AND 2100),
  year_class            construction_year_class,
  gross_floor_area_m2   NUMERIC(10,2),
  num_floors            SMALLINT,
  num_units             SMALLINT,

  -- NTA 8800 specific
  nta_building_category TEXT,                  -- Woningtype code per NTA 8800
  compactness_factor    NUMERIC(6,4),          -- A/V ratio

  -- Status
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  notes                 TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_by            UUID REFERENCES user_profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_buildings_org ON buildings(org_id);
CREATE INDEX idx_buildings_postal ON buildings(postal_code);
CREATE INDEX idx_buildings_bag ON buildings(bag_id);
CREATE INDEX idx_buildings_location ON buildings USING GIST(location);
CREATE INDEX idx_buildings_name ON buildings USING gin(description gin_trgm_ops);

-- ─── CALCULATION ZONES (Rekenzones) ──────────────────────────────────────

CREATE TABLE zones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  building_id       UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,

  -- NTA 8800 zone identification
  zone_code         TEXT NOT NULL,             -- e.g. "Z01", "Z02"
  name              TEXT NOT NULL,             -- e.g. "Begane grond", "Eerste verdieping"
  description       TEXT,

  -- Physical properties
  floor_level       SMALLINT NOT NULL DEFAULT 0,  -- 0 = ground floor
  gross_area_m2     NUMERIC(10,2),
  net_area_m2       NUMERIC(10,2),
  volume_m3         NUMERIC(10,2),
  ceiling_height_m  NUMERIC(6,3),

  -- NTA 8800 classification
  zone_function     TEXT,                      -- verblijfsgebied, verkeersgebied, etc.
  is_heated         BOOLEAN NOT NULL DEFAULT TRUE,
  is_cooled         BOOLEAN NOT NULL DEFAULT FALSE,
  setpoint_heating  NUMERIC(5,2),             -- °C
  setpoint_cooling  NUMERIC(5,2),             -- °C

  -- Calculated
  energy_label      energy_label,             -- derived from inspection
  primary_energy_demand NUMERIC(10,2),        -- kWh/m²·yr (NTA 8800 output)

  sort_order        SMALLINT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(building_id, zone_code)
);

CREATE INDEX idx_zones_org ON zones(org_id);
CREATE INDEX idx_zones_building ON zones(building_id);

-- ─── BUILDING ELEMENTS ────────────────────────────────────────────────────
-- Unified table for: Gevels, Daken, Vloeren, Installaties
-- Discriminated by element_type

CREATE TABLE building_elements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  zone_id           UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,

  element_type      element_type NOT NULL,
  name              TEXT NOT NULL,             -- e.g. "Noordgevel", "Plat dak 1"
  description       TEXT,

  -- Shared dimensions (filled by BLE measurements)
  length_mm         NUMERIC(10,2),
  width_mm          NUMERIC(10,2),
  height_mm         NUMERIC(10,2),
  area_m2           NUMERIC(10,2),             -- computed or measured

  -- Orientation (walls/roofs)
  orientation_deg   NUMERIC(6,2),             -- 0=N, 90=E, 180=S, 270=W
  tilt_deg          NUMERIC(6,2),             -- 0=horizontal, 90=vertical

  -- Thermal properties (NTA 8800)
  rc_value          NUMERIC(8,4),             -- m²·K/W (insulation resistance)
  u_value           NUMERIC(8,4),             -- W/(m²·K) (heat transfer coefficient)
  lambda_value      NUMERIC(8,4),             -- W/(m·K) (thermal conductivity)
  insulation_thickness_mm NUMERIC(8,2),

  -- Construction details
  construction_type TEXT,                      -- "Spouwmuur", "Houten vloer", etc.
  insulation_type   TEXT,                      -- "Glaswol", "Spouwvulling", etc.
  finish_type       TEXT,

  -- Installation-specific (when element_type = 'installatie')
  installation_type TEXT,                      -- "CV-ketel", "Warmtepomp", etc.
  fuel_type         TEXT,                      -- "Gas", "Elektriciteit", etc.
  efficiency        NUMERIC(6,4),             -- seasonal efficiency (SPF, η)
  capacity_kw       NUMERIC(10,2),
  year_installed    SMALLINT,

  -- Photos (Supabase Storage paths)
  photo_urls        TEXT[] NOT NULL DEFAULT '{}',

  -- Status
  is_complete       BOOLEAN NOT NULL DEFAULT FALSE,  -- all required measurements taken
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_elements_org ON building_elements(org_id);
CREATE INDEX idx_elements_zone ON building_elements(zone_id);
CREATE INDEX idx_elements_type ON building_elements(zone_id, element_type);

-- ─── OPENINGS (Transparante Delen) ───────────────────────────────────────
-- Windows and doors — child of building_elements (walls only)

CREATE TABLE openings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  element_id        UUID NOT NULL REFERENCES building_elements(id) ON DELETE CASCADE,

  opening_type      TEXT NOT NULL DEFAULT 'window',  -- 'window', 'door', 'skylight'
  name              TEXT,

  -- BLE-measured dimensions
  width_mm          NUMERIC(10,2),
  height_mm         NUMERIC(10,2),
  area_m2           NUMERIC(10,2),

  -- Glazing properties (NTA 8800)
  glazing_type      TEXT,                      -- "HR++", "HR+++", "Enkel", "Dubbel"
  frame_type        TEXT,                      -- "Aluminium", "Kunststof", "Hout"
  g_value           NUMERIC(6,4),             -- solar energy transmittance
  u_value_frame     NUMERIC(8,4),             -- W/(m²·K) frame
  u_value_glass     NUMERIC(8,4),             -- W/(m²·K) glass
  u_value_total     NUMERIC(8,4),             -- W/(m²·K) combined

  -- Shading
  has_shading       BOOLEAN NOT NULL DEFAULT FALSE,
  shading_type      TEXT,                      -- "Zonwering", "Overstekken", etc.
  shading_factor    NUMERIC(6,4),

  photo_urls        TEXT[] NOT NULL DEFAULT '{}',
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_openings_org ON openings(org_id);
CREATE INDEX idx_openings_element ON openings(element_id);

-- ─── TRIGGERS ────────────────────────────────────────────────────────────

CREATE TRIGGER buildings_updated_at        BEFORE UPDATE ON buildings         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER zones_updated_at            BEFORE UPDATE ON zones             FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER building_elements_updated_at BEFORE UPDATE ON building_elements FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER openings_updated_at         BEFORE UPDATE ON openings          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
