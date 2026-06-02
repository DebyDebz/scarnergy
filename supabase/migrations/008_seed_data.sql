-- ============================================================
-- SCARNERGY v2.0 — Development Seed Data
-- Run AFTER all migrations. Creates realistic Dutch test data.
-- DO NOT run in production.
-- ============================================================

-- ─── ORGANISATIONS ───────────────────────────────────────────────────────

INSERT INTO organisations (id, name, kvk_number, address, city, postal_code, email, phone) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Krontiva Energie Advies BV', '12345678', 'Herengracht 182', 'Amsterdam', '1016 BR', 'info@krontiva.nl', '+31 20 123 4567'),
  ('00000000-0000-0000-0000-000000000002', 'EnergieScan Nederland', '87654321', 'Coolsingel 40', 'Rotterdam', '3011 AD', 'info@energiescan.nl', '+31 10 234 5678');

-- ─── DEV BYPASS USER ─────────────────────────────────────────────────────
-- Matches the hardcoded DEV_JWT in scarnergy-app/_layout.tsx and .env
-- sub = 00000000-0000-0000-0000-000000000000
-- org_id = 00000000-0000-0000-0000-000000000001  role = admin
-- Required so session/measurement INSERTs satisfy the FK to user_profiles.

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at,
  aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'dev@scarnergy.test',
  '$2a$10$devbypassplaceholderpasswordhashXXXXXXXXXXXXXXXX', -- never used (bypass auth)
  NOW(),
  'authenticated', 'authenticated',
  '{"provider":"email","providers":["email"]}',
  '{"org_id":"00000000-0000-0000-0000-000000000001","full_name":"Dev User","role":"admin"}',
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_profiles (id, org_id, role, full_name, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'admin',
  'Dev User',
  true
)
ON CONFLICT (id) DO NOTHING;

-- ─── NOTE: Real users must be created via Supabase Auth.
-- supabase auth admin create-user \
--   --email inspector@krontiva.nl \
--   --password TestPassword123! \
--   --user-metadata '{"org_id":"00000000-0000-0000-0000-000000000001","full_name":"Jan de Vries","role":"inspector"}'
--
-- supabase auth admin create-user \
--   --email admin@krontiva.nl \
--   --password TestPassword123! \
--   --user-metadata '{"org_id":"00000000-0000-0000-0000-000000000001","full_name":"Karin Bakker","role":"admin"}'

-- ─── BUILDINGS ────────────────────────────────────────────────────────────

INSERT INTO buildings (id, org_id, reference_code, bag_id, street, house_number, postal_code, city, building_type, construction_year, gross_floor_area_m2, num_floors)
VALUES
  (
    'b0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'BLD-2026-001',
    '0363100012165205',
    'Jordaanstraat', '14',
    '1016 ZZ', 'Amsterdam',
    'residential_single', 1923, 95.0, 3
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'BLD-2026-002',
    '0599100000123456',
    'Bergselaan', '47A',
    '3037 EG', 'Rotterdam',
    'residential_multi', 1965, 312.0, 4
  ),
  (
    'b0000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'BLD-2026-003',
    '0345100000099876',
    'Utrechtsestraat', '8',
    '3512 AB', 'Utrecht',
    'residential_single', 1987, 128.5, 2
  );

-- ─── BLE DEVICES ─────────────────────────────────────────────────────────

INSERT INTO ble_devices (id, org_id, device_type, mac_address, nickname, firmware_version, is_active)
VALUES
  (
    'd0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'bosch_glm50c',
    'AA:BB:CC:DD:EE:01',
    'GLM-01 (Jan)',
    '2.3.1',
    true
  ),
  (
    'd0000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'bosch_glm50c',
    'AA:BB:CC:DD:EE:02',
    'GLM-02 (Karin)',
    '2.3.1',
    true
  );

-- ─── ZONES ───────────────────────────────────────────────────────────────

INSERT INTO zones (id, org_id, building_id, zone_code, name, floor_level, gross_area_m2, ceiling_height_m, is_heated)
VALUES
  -- Amsterdam building zones
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Z01', 'Begane grond',     0, 32.0, 2.80, true),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Z02', 'Eerste verdieping', 1, 32.0, 2.75, true),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Z03', 'Tweede verdieping', 2, 31.0, 2.60, true),
  -- Rotterdam building zones
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Z01', 'Appartement 1 (BG)',  0, 78.0, 2.70, true),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Z02', 'Appartement 2 (1e)', 1, 78.0, 2.70, true);

-- ─── BUILDING ELEMENTS ────────────────────────────────────────────────────
-- Sample walls, roof, floor for building 1 / zone 1

INSERT INTO building_elements (id, org_id, zone_id, element_type, name, orientation_deg, rc_value, construction_type)
VALUES
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gevel',  'Voorgevel (Noord)', 0.0,   1.5,  'Spouwmuur 1923'),
  ('e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gevel',  'Achtergevel (Zuid)', 180.0, 1.5,  'Spouwmuur 1923'),
  ('e0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gevel',  'Zijgevel (West)',    270.0, 1.5,  'Spouwmuur 1923'),
  ('e0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'vloer',  'Begane grond vloer', NULL,  1.2,  'Houten balken vloer'),
  ('e0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'dak',    'Hellend dak',        NULL,  2.8,  'Houten kap met glaswol'),
  ('e0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'installatie', 'CV-ketel Intergas', NULL, NULL, NULL);

UPDATE building_elements SET
  installation_type = 'CV-ketel',
  fuel_type         = 'Gas',
  efficiency        = 0.93,
  capacity_kw       = 28,
  year_installed    = 2015
WHERE id = 'e0000000-0000-0000-0000-000000000006';

-- ─── OPENINGS (windows for north facade) ─────────────────────────────────

INSERT INTO openings (id, org_id, element_id, opening_type, name, width_mm, height_mm, glazing_type, u_value_total)
VALUES
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'window', 'Voorraam links',  1200, 1400, 'HR++',  1.1),
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'window', 'Voorraam rechts', 1200, 1400, 'HR++',  1.1),
  ('f0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'door',   'Voordeur',        950,  2100, NULL,    2.0);

-- ─── VERIFY SEED DATA ─────────────────────────────────────────────────────

DO $$
DECLARE
  v_orgs     INTEGER;
  v_bldgs    INTEGER;
  v_zones    INTEGER;
  v_elements INTEGER;
  v_openings INTEGER;
  v_devices  INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_orgs     FROM organisations;
  SELECT COUNT(*) INTO v_bldgs    FROM buildings;
  SELECT COUNT(*) INTO v_zones    FROM zones;
  SELECT COUNT(*) INTO v_elements FROM building_elements;
  SELECT COUNT(*) INTO v_openings FROM openings;
  SELECT COUNT(*) INTO v_devices  FROM ble_devices;

  RAISE NOTICE '─────────────────────────────────────────────';
  RAISE NOTICE 'SCARNERGY Seed Data Loaded:';
  RAISE NOTICE '  Organisations:      %', v_orgs;
  RAISE NOTICE '  Buildings:          %', v_bldgs;
  RAISE NOTICE '  Zones:              %', v_zones;
  RAISE NOTICE '  Building elements:  %', v_elements;
  RAISE NOTICE '  Openings:           %', v_openings;
  RAISE NOTICE '  BLE devices:        %', v_devices;
  RAISE NOTICE '─────────────────────────────────────────────';
END $$;
