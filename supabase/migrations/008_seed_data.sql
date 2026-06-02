-- ============================================================
-- SCARNERGY v2.0 — Development Seed Data
-- Source: Opname Rapport — Cor van Osnabruggelaan 88,
--         2251 RG VOORSCHOTEN — survey 2025-07-18
-- DO NOT run in production.
-- ============================================================

-- ─── CLEAN UP ────────────────────────────────────────────────────────────────
-- Remove previously seeded auth users, then cascade all app tables.

DELETE FROM auth.users
WHERE email IN ('dev@scarnergy.test', 'nils@energeticas.nl', 'admin@energeticas.nl');

TRUNCATE TABLE organisations CASCADE;   -- cascades to all app tables

-- ─── ORGANISATION ────────────────────────────────────────────────────────────

INSERT INTO organisations (id, name, kvk_number, address, city, postal_code, email, phone)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Energeticas',
  '78901234',
  'Schipholweg 55',
  'Leiden',
  '2316 ZL',
  'info@energeticas.nl',
  '+31 71 123 4567'
);

-- ─── AUTH USERS ──────────────────────────────────────────────────────────────
-- Passwords are hashed at seed time via pgcrypto (extension enabled in 001).
--
--   Inspector → nils@energeticas.nl   / Opname2025!
--   Admin     → admin@energeticas.nl  / Admin2025!
--   Dev bypass→ dev@scarnergy.test    (see DEV_JWT in .env — bypass is OFF by default)

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at,
  aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  -- Inspector: Nils Maronier
  (
    '00000000-0000-0000-0000-000000000003',
    'nils@energeticas.nl',
    crypt('Opname2025!', gen_salt('bf', 10)),
    NOW(), 'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}',
    '{"org_id":"00000000-0000-0000-0000-000000000001","full_name":"Nils Maronier","role":"inspector"}',
    NOW(), NOW()
  ),
  -- Admin
  (
    '00000000-0000-0000-0000-000000000002',
    'admin@energeticas.nl',
    crypt('Admin2025!', gen_salt('bf', 10)),
    NOW(), 'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}',
    '{"org_id":"00000000-0000-0000-0000-000000000001","full_name":"Elena Voss","role":"admin"}',
    NOW(), NOW()
  ),
  -- Dev bypass user (DEV_BYPASS_AUTH = false by default — safe to keep for local use)
  (
    '00000000-0000-0000-0000-000000000000',
    'dev@scarnergy.test',
    crypt('DevBypass!', gen_salt('bf', 10)),
    NOW(), 'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}',
    '{"org_id":"00000000-0000-0000-0000-000000000001","full_name":"Dev User","role":"admin"}',
    NOW(), NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- Required by Supabase GoTrue: one identity row per user
INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000003',
   '{"sub":"00000000-0000-0000-0000-000000000003","email":"nils@energeticas.nl"}',
   'email', 'nils@energeticas.nl', NOW(), NOW(), NOW()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
   '{"sub":"00000000-0000-0000-0000-000000000002","email":"admin@energeticas.nl"}',
   'email', 'admin@energeticas.nl', NOW(), NOW(), NOW()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
   '{"sub":"00000000-0000-0000-0000-000000000000","email":"dev@scarnergy.test"}',
   'email', 'dev@scarnergy.test', NOW(), NOW(), NOW())
ON CONFLICT (provider, provider_id) DO NOTHING;

-- ─── USER PROFILES ───────────────────────────────────────────────────────────

INSERT INTO user_profiles (id, org_id, role, full_name, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'inspector', 'Nils Maronier', true),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'admin',     'Elena Voss',    true),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001', 'admin',     'Dev User',      true)
ON CONFLICT (id) DO NOTHING;

-- ─── BLE DEVICE ──────────────────────────────────────────────────────────────

INSERT INTO ble_devices (id, org_id, device_type, mac_address, nickname, firmware_version, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'bosch_glm50c',
  'AA:BB:CC:DD:EE:01',
  'GLM-01 (Nils)',
  '2.3.1',
  true
);

-- ─── BUILDING ─────────────────────────────────────────────────────────────────
-- Cor van Osnabruggelaan 88, 2251 RG Voorschoten
-- Vrijstaande woning, bouwjaar 1974, 165.78 m² gebruiksoppervlakte

INSERT INTO buildings (
  id, org_id, reference_code, bag_id,
  street, house_number, postal_code, city, municipality, province,
  building_type, construction_year, gross_floor_area_m2, num_floors,
  notes
)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'BLD-2025-001',
  '0626100000065234',
  'Cor van Osnabruggelaan', '88',
  '2251 RG', 'Voorschoten', 'Voorschoten', 'Zuid-Holland',
  'residential_single', 1974, 165.78, 3,
  'Vrijstaande woning. Opname 2025-07-18 door Nils Maronier (Energeticas).'
);

-- ─── ZONES (floor levels) ─────────────────────────────────────────────────────
-- Three calculation zones following NTA 8800 / NEN 2580 usable area rules.

INSERT INTO zones (
  id, org_id, building_id, zone_code, name,
  floor_level, gross_area_m2, ceiling_height_m, is_heated
)
VALUES
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010',
   'BG', 'Begane grond', 0, 74.11, 2.42, true),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010',
   'V1', 'Eerste verdieping', 1, 67.38, 2.42, true),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010',
   'V2', 'Tweede verdieping / Zolder', 2, 24.29, 1.80, true);

-- ─── BUILDING ELEMENTS ────────────────────────────────────────────────────────
-- All IDs that appear in the VABI XML spec example use their 8-char hex prefix
-- expanded to full UUIDs for traceability.
-- Dimensions: length_mm = wall breedte, height_mm = wall hoogte, width_mm = dikte

-- ── BG — Gevels ──────────────────────────────────────────────────────────────

INSERT INTO building_elements (
  id, org_id, zone_id, element_type, name,
  description, construction_type,
  length_mm, height_mm, width_mm, area_m2,
  orientation_deg, rc_value, u_value,
  insulation_type, is_complete, sort_order
) VALUES

  -- Bg Achtergevel (Noord-West) — the wall with the metal sliding door
  -- Source: VABI XML example: id 5ef79c16, H=2.52m, B=8.32m, area=20.97m²
  ('5ef79c16-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000020',
   'gevel', 'Bg Achtergevel',
   'Buitenlucht', 'Achtergevel',
   8320, 2520, 320, 20.97,
   315.0, 0.43, 2.10, 'Geen', true, 1),

  -- Bg Voorgevel (Zuid-Oost)
  ('00000000-0000-0000-0001-000000000001',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000020',
   'gevel', 'Bg Voorgevel',
   'Buitenlucht', 'Voorgevel',
   7900, 2520, 320, 19.91,
   135.0, 0.43, 2.10, 'Geen', true, 2),

  -- Bg Linkergevel (Noord-Oost)
  ('00000000-0000-0000-0001-000000000002',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000020',
   'gevel', 'Bg Linkergevel',
   'Buitenlucht', 'Linkergevel',
   10150, 2520, 320, 22.84,
   45.0, 0.43, 2.10, 'Geen', true, 3),

  -- Bg Rechtergevel (Zuid-West)
  ('00000000-0000-0000-0001-000000000003',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000020',
   'gevel', 'Bg Rechtergevel',
   'Buitenlucht', 'Rechtergevel',
   10150, 2520, 320, 22.84,
   225.0, 0.43, 2.10, 'Geen', true, 4);

-- ── BG — Vloer ───────────────────────────────────────────────────────────────
-- Source: VABI XML example: id 876d7036, Kruipruimte, 76.41 m², geen isolatie

INSERT INTO building_elements (
  id, org_id, zone_id, element_type, name,
  description, construction_type,
  length_mm, width_mm, area_m2,
  rc_value, insulation_type, bodemisolatie, is_complete, sort_order
) VALUES
  ('876d7036-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000020',
   'vloer', 'Bg vloer',
   'Kruipruimte', 'Houten balkenvloer',
   10400, 7900, 76.41,
   0.28, NULL, false, true, 5);

-- ── V1 — Gevels ──────────────────────────────────────────────────────────────

INSERT INTO building_elements (
  id, org_id, zone_id, element_type, name,
  description, construction_type,
  length_mm, height_mm, width_mm, area_m2,
  orientation_deg, rc_value, u_value,
  insulation_type, is_complete, sort_order
) VALUES
  -- V1 Achtergevel (Noord-West)
  ('00000000-0000-0000-0001-000000000004',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000021',
   'gevel', 'V1 Achtergevel',
   'Buitenlucht', 'Achtergevel',
   8320, 2520, 320, 20.97,
   315.0, 0.43, 2.10, 'Geen', true, 1),

  -- V1 Voorgevel (Zuid-Oost)
  ('00000000-0000-0000-0001-000000000005',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000021',
   'gevel', 'V1 Voorgevel',
   'Buitenlucht', 'Voorgevel',
   7900, 2520, 320, 19.91,
   135.0, 0.43, 2.10, 'Geen', true, 2),

  -- V1 Linkergevel (Noord-Oost)
  ('00000000-0000-0000-0001-000000000006',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000021',
   'gevel', 'V1 Linkergevel',
   'Buitenlucht', 'Linkergevel',
   10150, 2520, 320, 22.84,
   45.0, 0.43, 2.10, 'Geen', true, 3),

  -- V1 Rechtergevel (Zuid-West)
  ('00000000-0000-0000-0001-000000000007',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000021',
   'gevel', 'V1 Rechtergevel',
   'Buitenlucht', 'Rechtergevel',
   10150, 2520, 320, 22.84,
   225.0, 0.43, 2.10, 'Geen', true, 4);

-- ── V1 — Vloer ───────────────────────────────────────────────────────────────

INSERT INTO building_elements (
  id, org_id, zone_id, element_type, name,
  description, construction_type,
  length_mm, width_mm, area_m2,
  rc_value, insulation_type, bodemisolatie, is_complete, sort_order
) VALUES
  ('00000000-0000-0000-0001-000000000008',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000021',
   'vloer', 'V1 vloer (tussenverdieping)',
   'Aangrenzende verwarmde ruimte', 'Houten balkenvloer',
   10400, 7900, 67.38,
   0.28, NULL, false, true, 5);

-- ── V2 — Daken ────────────────────────────────────────────────────────────────
-- Source: VABI XML example: id 9ada7739
--   HellendDak, Noord-Oost, L=7.57m, W=10.40m, nokhoogte=5.99m, hoek=55°
--   Bruto=78.73m², gaten=9.37m² (2 dakkapellen), netto=69.36m²

INSERT INTO building_elements (
  id, org_id, zone_id, element_type, name,
  construction_type,
  length_mm, width_mm, area_m2,
  orientation_deg, tilt_deg, nokhoogte_m,
  rc_value, insulation_type, is_complete, sort_order
) VALUES
  -- Dak rechts (Noord-Oost, dakkapel aanwezig)
  ('9ada7739-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000022',
   'dak', 'Hellend dak rechts (Noord-Oost)',
   'HellendDak',
   7570, 10400, 69.36,
   45.0, 55.0, 5.99,
   3.50, 'Glaswol', true, 1),

  -- Dak links (Zuid-West, dakkapel aanwezig)
  ('00000000-0000-0000-0001-000000000009',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000022',
   'dak', 'Hellend dak links (Zuid-West)',
   'HellendDak',
   7570, 10400, 69.36,
   225.0, 55.0, 5.99,
   3.50, 'Glaswol', true, 2);

-- ── Installaties ──────────────────────────────────────────────────────────────
-- Sources: VABI XML example installatiegegevens

INSERT INTO building_elements (
  id, org_id, zone_id, element_type, name,
  description, installation_type, fuel_type,
  brand, model_nr, cv_klasse,
  efficiency, capacity_kw, year_installed,
  is_complete, sort_order
) VALUES

  -- Tapwater: Daalderop Close-in 10, Keuken (BG)
  ('d8386ba6-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000020',
   'installatie', 'Daalderop Close-in 10',
   'Keuken', 'Tapwater', 'Elektriciteit',
   'Daalderop', 'Close-in 10', NULL,
   0.95, 2.0, 2012,
   true, 6),

  -- Verwarming: Atag E325EC CW5, Zolder (V2)
  ('bf92aa35-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000022',
   'installatie', 'Atag E325EC',
   'Zolder', 'Verwarming', 'Gas',
   'Atag', 'E325EC CW5', 'CW5',
   1.07, 25.0, 2018,
   true, 3),

  -- Ventilatie: Unknown, Boven keuken (BG)
  ('6eafdfb1-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000020',
   'installatie', 'Ventilatieunit',
   'Boven keuken', 'Ventilatie', NULL,
   NULL, NULL, NULL,
   NULL, NULL, NULL,
   false, 7);

-- ─── OPENINGS (TransparanteDelen) ────────────────────────────────────────────

INSERT INTO openings (
  id, org_id, element_id,
  opening_type, name,
  width_mm, height_mm, area_m2,
  frame_type, glazing_type,
  thermisch_onderbroken, u_value_total,
  has_shading, shading_type,
  overstek_m, sort_order
) VALUES

  -- ── Bg Achtergevel (5ef79c16) ─────────────────────────────────────────────

  -- Schuifpui (sliding glass door) — metal non-TB frame, double glazing, awning
  -- Source: VABI XML: id bfa5a2d7, H=2.39m, W=2.43m, area=5.81m²
  ('bfa5a2d7-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   '5ef79c16-0000-0000-0000-000000000001',
   'window', 'Achtergevel schuifpui',
   2430, 2390, 5.81,
   'Metaal', 'Dubbel',
   false, 2.80,
   true, 'Knikarmscherm',
   0.00, 1),

  -- Klein enkel-glas raam (0.11 m²) — flagged as ⚠ in report
  ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001',
   '5ef79c16-0000-0000-0000-000000000001',
   'window', 'Klein raam enkel glas',
   330, 330, 0.11,
   'Hout', 'Enkel',
   false, 5.80,
   false, NULL,
   0.00, 2),

  -- ── Bg Voorgevel (00000000-...-000000000001) ───────────────────────────────

  -- Voordeur
  ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0001-000000000001',
   'door', 'Voordeur',
   950, 2100, 2.00,
   'Hout', NULL,
   false, 2.00,
   false, NULL,
   0.00, 1),

  -- Raam voorgevel links
  ('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0001-000000000001',
   'window', 'Raam voorgevel links',
   1100, 1400, 1.54,
   'Hout', 'Dubbel',
   false, 2.80,
   false, NULL,
   0.00, 2),

  -- Raam voorgevel rechts
  ('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0001-000000000001',
   'window', 'Raam voorgevel rechts',
   1200, 1400, 1.68,
   'Hout', 'Dubbel',
   false, 2.80,
   false, NULL,
   0.00, 3),

  -- ── Bg Linkergevel ────────────────────────────────────────────────────────

  -- Raam zijgevel BG
  ('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0001-000000000002',
   'window', 'Raam zijgevel BG',
   800, 1200, 0.96,
   'Hout', 'Dubbel',
   false, 2.80,
   false, NULL,
   0.00, 1),

  -- ── V1 Achtergevel ────────────────────────────────────────────────────────

  -- Raam slaapkamer achter
  ('00000000-0000-0000-0002-000000000006', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0001-000000000004',
   'window', 'Raam slaapkamer achter',
   1400, 1200, 1.68,
   'Hout', 'Dubbel',
   false, 2.80,
   false, NULL,
   0.00, 1),

  -- Klein enkel-glas raam (0.29 m²) — flagged as ⚠ in report
  ('00000000-0000-0000-0002-000000000007', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0001-000000000004',
   'window', 'Klein raam enkel glas V1',
   540, 540, 0.29,
   'Hout', 'Enkel',
   false, 5.80,
   false, NULL,
   0.00, 2),

  -- ── V1 Voorgevel ──────────────────────────────────────────────────────────

  -- Raam slaapkamer voor links (HR++)
  ('00000000-0000-0000-0002-000000000008', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0001-000000000005',
   'window', 'Raam slaapkamer voor links',
   1400, 1200, 1.68,
   'Kunststof', 'HR++',
   true, 1.10,
   false, NULL,
   0.00, 1),

  -- Raam slaapkamer voor rechts (HR++)
  ('00000000-0000-0000-0002-000000000009', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0001-000000000005',
   'window', 'Raam slaapkamer voor rechts',
   1200, 1200, 1.44,
   'Kunststof', 'HR++',
   true, 1.10,
   false, NULL,
   0.00, 2),

  -- ── V1 Linkergevel ────────────────────────────────────────────────────────

  -- Raam zijgevel V1
  ('00000000-0000-0000-0002-000000000010', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0001-000000000006',
   'window', 'Raam zijgevel V1',
   800, 1200, 0.96,
   'Hout', 'Dubbel',
   false, 2.80,
   false, NULL,
   0.00, 1),

  -- ── V1 Rechtergevel ───────────────────────────────────────────────────────

  -- Raam zijgevel V1 rechts
  ('00000000-0000-0000-0002-000000000011', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0001-000000000007',
   'window', 'Raam zijgevel V1 rechts',
   800, 1200, 0.96,
   'Hout', 'Dubbel',
   false, 2.80,
   false, NULL,
   0.00, 1);

-- ─── INSPECTION SESSION ────────────────────────────────────────────────────
-- Completed session by Nils Maronier, 2025-07-18
-- Full NTA 8800 survey of Cor van Osnabruggelaan 88

INSERT INTO inspection_sessions (
  id, org_id, building_id, inspector_id,
  session_code, status,
  started_at, completed_at, duration_seconds,
  total_measurements, anomaly_count, completion_pct,
  outdoor_temp_c, weather_description,
  flow_stage, sync_status,
  notes
)
VALUES (
  '00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000003',
  'INS-2025-0001',
  'completed',
  '2025-07-18 08:30:00+02', '2025-07-18 12:05:00+02', 12900,
  42, 0, 100.0,
  23.5, 'Zonnig, lichte bewolking (ZW wind 3 Bft)',
  6, 'synced',
  'Volledig opgenomen conform NTA 8800. Enkel glas aanwezig: 2 ramen (0.11 + 0.29 m²). Geen vloerisolatie. Metalen schuifpui achtergevel niet thermisch onderbroken. HR-ketel Atag CW5 aanwezig.'
);

-- ─── MEASUREMENTS (BLE audit log) ────────────────────────────────────────────
-- 42 GLM-captured measurements from the 2025-07-18 session.
-- Each row = one trigger-press on the Bosch GLM 50C.

INSERT INTO measurements (
  id, measured_at,
  org_id, session_id, device_id, inspector_id, element_id,
  value_mm, unit, measurement_type,
  is_anomaly, is_deleted, ingestion_path
)
VALUES
  -- Bg Achtergevel (3 slots: length, height, thickness)
  (gen_random_uuid(), '2025-07-18 08:45:12+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '5ef79c16-0000-0000-0000-000000000001', 8320,  'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 08:45:38+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '5ef79c16-0000-0000-0000-000000000001', 2520,  'mm', 'height',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 08:46:02+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '5ef79c16-0000-0000-0000-000000000001', 320,   'mm', 'width',   false, false, 'mobile'),
  -- Schuifpui (2 slots: width, height) — opening bfa5a2d7 belongs to element 5ef79c16
  (gen_random_uuid(), '2025-07-18 08:47:15+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '5ef79c16-0000-0000-0000-000000000001', 2430,  'mm', 'width',   false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 08:47:44+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '5ef79c16-0000-0000-0000-000000000001', 2390,  'mm', 'height',  false, false, 'mobile'),
  -- Bg Voorgevel
  (gen_random_uuid(), '2025-07-18 08:55:22+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000001', 7900,  'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 08:55:50+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000001', 2520,  'mm', 'height',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 08:56:14+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000001', 320,   'mm', 'width',   false, false, 'mobile'),
  -- Bg Linkergevel
  (gen_random_uuid(), '2025-07-18 09:03:11+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000002', 10150, 'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 09:03:35+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000002', 2520,  'mm', 'height',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 09:04:00+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000002', 320,   'mm', 'width',   false, false, 'mobile'),
  -- Bg Rechtergevel
  (gen_random_uuid(), '2025-07-18 09:09:43+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000003', 10150, 'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 09:10:05+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000003', 2520,  'mm', 'height',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 09:10:29+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000003', 320,   'mm', 'width',   false, false, 'mobile'),
  -- Bg Vloer
  (gen_random_uuid(), '2025-07-18 09:15:08+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '876d7036-0000-0000-0000-000000000001', 10400, 'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 09:15:32+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '876d7036-0000-0000-0000-000000000001', 7900,  'mm', 'width',   false, false, 'mobile'),
  -- V1 Achtergevel
  (gen_random_uuid(), '2025-07-18 09:42:17+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000004', 8320,  'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 09:42:41+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000004', 2520,  'mm', 'height',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 09:43:05+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000004', 320,   'mm', 'width',   false, false, 'mobile'),
  -- V1 Voorgevel
  (gen_random_uuid(), '2025-07-18 09:49:22+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000005', 7900,  'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 09:49:46+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000005', 2520,  'mm', 'height',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 09:50:10+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000005', 320,   'mm', 'width',   false, false, 'mobile'),
  -- V1 Linkergevel
  (gen_random_uuid(), '2025-07-18 09:57:33+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000006', 10150, 'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 09:57:57+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000006', 2520,  'mm', 'height',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 09:58:21+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000006', 320,   'mm', 'width',   false, false, 'mobile'),
  -- V1 Rechtergevel
  (gen_random_uuid(), '2025-07-18 10:03:44+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000007', 10150, 'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 10:04:08+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000007', 2520,  'mm', 'height',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 10:04:32+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000007', 320,   'mm', 'width',   false, false, 'mobile'),
  -- V1 Vloer
  (gen_random_uuid(), '2025-07-18 10:08:19+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000008', 10400, 'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 10:08:43+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000008', 7900,  'mm', 'width',   false, false, 'mobile'),
  -- Dak rechts
  (gen_random_uuid(), '2025-07-18 10:48:22+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '9ada7739-0000-0000-0000-000000000001', 7570,  'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 10:48:46+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '9ada7739-0000-0000-0000-000000000001', 10400, 'mm', 'width',   false, false, 'mobile'),
  -- Dak links
  (gen_random_uuid(), '2025-07-18 10:52:11+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000009', 7570,  'mm', 'length',  false, false, 'mobile'),
  (gen_random_uuid(), '2025-07-18 10:52:35+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0001-000000000009', 10400, 'mm', 'width',   false, false, 'mobile'),
  -- Verwarming (installatie — length only slot)
  (gen_random_uuid(), '2025-07-18 11:18:04+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 'bf92aa35-0000-0000-0000-000000000001', 450,   'mm', 'length',  false, false, 'mobile'),
  -- Tapwater
  (gen_random_uuid(), '2025-07-18 11:21:37+02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 'd8386ba6-0000-0000-0000-000000000001', 280,   'mm', 'length',  false, false, 'mobile');

-- ─── VERIFY ───────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_orgs     INTEGER;
  v_users    INTEGER;
  v_bldgs    INTEGER;
  v_zones    INTEGER;
  v_elements INTEGER;
  v_openings INTEGER;
  v_sessions INTEGER;
  v_msrs     INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_orgs     FROM organisations;
  SELECT COUNT(*) INTO v_users    FROM user_profiles;
  SELECT COUNT(*) INTO v_bldgs    FROM buildings;
  SELECT COUNT(*) INTO v_zones    FROM zones;
  SELECT COUNT(*) INTO v_elements FROM building_elements;
  SELECT COUNT(*) INTO v_openings FROM openings;
  SELECT COUNT(*) INTO v_sessions FROM inspection_sessions;
  SELECT COUNT(*) INTO v_msrs     FROM measurements;

  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE 'SCARNERGY Seed — Cor van Osnabruggelaan 88';
  RAISE NOTICE '  Organisation:       % (Energeticas)',           v_orgs;
  RAISE NOTICE '  User profiles:      % (Nils + Elena + Dev)',    v_users;
  RAISE NOTICE '  Buildings:          %',                         v_bldgs;
  RAISE NOTICE '  Zones (BG/V1/V2):   %',                        v_zones;
  RAISE NOTICE '  Building elements:  %',                         v_elements;
  RAISE NOTICE '  Openings:           %',                         v_openings;
  RAISE NOTICE '  Sessions:           %',                         v_sessions;
  RAISE NOTICE '  Measurements:       %',                         v_msrs;
  RAISE NOTICE '───────────────────────────────────────────────';
  RAISE NOTICE '  Inspector login:  nils@energeticas.nl / Opname2025!';
  RAISE NOTICE '  Admin login:      admin@energeticas.nl / Admin2025!';
  RAISE NOTICE '═══════════════════════════════════════════════';
END $$;
