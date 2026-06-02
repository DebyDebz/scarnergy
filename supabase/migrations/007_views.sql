-- ============================================================
-- SCARNERGY v2.0 — Migration 007: Convenience Views
-- Denormalised views used by the mobile app and dashboards.
-- ============================================================

-- ─── SESSION SUMMARY ─────────────────────────────────────────────────────
-- Extends inspection_sessions with inspector name + building address.
-- Used by: app/tabs/sessions/index.tsx, sessions/[id].tsx, tabs/index.tsx

DROP VIEW IF EXISTS session_summary CASCADE;
CREATE VIEW session_summary AS
SELECT
  s.*,
  up.full_name                              AS inspector_name,
  b.street || ' ' || b.house_number        AS building_address,
  b.city                                    AS building_city
FROM inspection_sessions s
JOIN user_profiles up ON up.id = s.inspector_id
JOIN buildings     b  ON b.id  = s.building_id;

-- ─── BUILDING SUMMARY ────────────────────────────────────────────────────
-- Extends buildings with zone/element/session counts and latest energy label.
-- Typed as BuildingSummary in lib/supabase.ts.

DROP VIEW IF EXISTS building_summary CASCADE;
CREATE VIEW building_summary AS
SELECT
  b.*,
  b.street || ' ' || b.house_number || ', ' || b.postal_code || ' ' || b.city
                                            AS full_address,
  COUNT(DISTINCT z.id)                      AS zone_count,
  COUNT(DISTINCT be.id)                     AS element_count,
  COUNT(DISTINCT s.id)                      AS session_count,
  MAX(s.started_at)                         AS last_inspection_at,
  (
    SELECT z2.energy_label
    FROM   zones z2
    WHERE  z2.building_id = b.id AND z2.energy_label IS NOT NULL
    ORDER  BY z2.updated_at DESC
    LIMIT  1
  )                                         AS latest_energy_label
FROM buildings            b
LEFT JOIN zones           z  ON z.building_id  = b.id  AND z.is_active  = TRUE
LEFT JOIN building_elements be ON be.zone_id   = z.id  AND be.is_active = TRUE
LEFT JOIN inspection_sessions s ON s.building_id = b.id
GROUP BY b.id;

-- ─── RECENT MEASUREMENTS ─────────────────────────────────────────────────
-- Extends measurements with device nickname, element name, zone name,
-- and building address. Typed as RecentMeasurement in lib/supabase.ts.

DROP VIEW IF EXISTS recent_measurements CASCADE;
CREATE VIEW recent_measurements AS
SELECT
  m.*,
  bd.nickname                               AS device_nickname,
  be.name                                   AS element_name,
  z.name                                    AS zone_name,
  b.street || ' ' || b.house_number        AS building_address
FROM measurements         m
JOIN ble_devices          bd ON bd.id = m.device_id
JOIN inspection_sessions  s  ON s.id  = m.session_id
JOIN buildings            b  ON b.id  = s.building_id
LEFT JOIN building_elements be ON be.id = m.element_id
LEFT JOIN zones           z  ON z.id   = be.zone_id
WHERE m.is_deleted = FALSE;

-- ─── GRANTS ──────────────────────────────────────────────────────────────
-- Recreating a view drops its grants. Re-apply them here so a fresh stack
-- gets the same permissions as migration 005 gave to the base tables.

GRANT SELECT ON session_summary     TO authenticated, anon;
GRANT SELECT ON building_summary    TO authenticated, anon;
GRANT SELECT ON recent_measurements TO authenticated, anon;
