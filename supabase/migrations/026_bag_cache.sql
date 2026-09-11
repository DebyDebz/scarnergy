-- ============================================================
-- SCARNERGY v2.0 — Migration 026: BAG / 3DBAG cache columns (GAP W3)
-- Raw, uninterpreted values cached from the public registries by the
-- web API route /api/buildings/[id]/bag (Kadaster BAG Individuele
-- Bevragingen v2 + api.3dbag.nl). Distinct from the manually entered
-- construction_year / gross_floor_area_m2 — those are never overwritten.
-- Purely additive: all columns nullable.
-- ============================================================

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS bag_pand_id        TEXT,
  ADD COLUMN IF NOT EXISTS bag_vbo_id         TEXT,
  ADD COLUMN IF NOT EXISTS bag_bouwjaar       SMALLINT CHECK (bag_bouwjaar BETWEEN 1000 AND 2100),
  ADD COLUMN IF NOT EXISTS bag_oppervlakte_m2 NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS bag_gebruiksdoel   TEXT,
  ADD COLUMN IF NOT EXISTS dbag_hoogte_m      NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS bag_fetched_at     TIMESTAMPTZ;

COMMENT ON COLUMN buildings.bag_pand_id        IS 'Cached: Kadaster BAG IB v2 pandIdentificaties[0]';
COMMENT ON COLUMN buildings.bag_vbo_id         IS 'Cached: BAG verblijfsobject id (adresseerbaarObjectIdentificatie)';
COMMENT ON COLUMN buildings.bag_bouwjaar       IS 'Cached: BAG oorspronkelijkBouwjaar (raw; manual field = construction_year)';
COMMENT ON COLUMN buildings.bag_oppervlakte_m2 IS 'Cached: BAG verblijfsobject oppervlakte in m2 (raw)';
COMMENT ON COLUMN buildings.bag_gebruiksdoel   IS 'Cached: BAG gebruiksdoelen, comma-joined (raw)';
COMMENT ON COLUMN buildings.dbag_hoogte_m      IS 'Cached: 3DBAG b3_h_dak_70p - b3_h_maaiveld (m)';
COMMENT ON COLUMN buildings.bag_fetched_at     IS 'When the BAG/3DBAG cache was last refreshed';

-- building_summary selects b.*, which Postgres expanded at view-creation
-- time — the new columns do NOT reach the view (and thus the mobile app)
-- until it is dropped and recreated. Definition copied verbatim from 022.

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
LEFT JOIN inspection_sessions s ON s.building_id = b.id AND s.is_active = TRUE
WHERE b.is_active = TRUE
GROUP BY b.id;

-- Recreating the view drops its grants; restore read access (mirrors 022).
GRANT SELECT ON building_summary TO authenticated, anon, service_role;
