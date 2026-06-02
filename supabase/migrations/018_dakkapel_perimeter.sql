-- ─── Dakkapel entity type + parent link + gevel thickness / perimeter fields ──
-- Required for NTA 8800 compliant VABI XML output:
--   - Dakkapellen nested under Daken (parent_element_id links dakkapel → dak)
--   - DikteVloerBoven/Onder and DikteAangrezendemuren correct gevel dimensions
--   - Perimeter drives the linear thermal transmittance (Ψ-value) calculation

-- Extend the element_type enum with dakkapel
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'dakkapel'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'element_type')
  ) THEN
    ALTER TYPE element_type ADD VALUE 'dakkapel' AFTER 'dak';
  END IF;
END $$;

-- Parent element link — used exclusively for dakkapel → parent dak association
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS parent_element_id UUID
    REFERENCES building_elements(id) ON DELETE CASCADE;

-- Gevel thickness corrections for NTA 8800 height / width calculation
--   Berekende hoogte = Originele hoogte + dikte_vloer_boven + dikte_vloer_onder
--   Berekende breedte = Originele breedte + dikte_muren
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS dikte_vloer_boven_mm NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS dikte_vloer_onder_mm NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS dikte_muren_mm       NUMERIC(6,2);

-- Thermal bridge perimeter for vloer/gevel floor-wall junctions
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS perimeter_m NUMERIC(8,3);

CREATE INDEX IF NOT EXISTS idx_elements_parent ON building_elements(parent_element_id)
  WHERE parent_element_id IS NOT NULL;

COMMENT ON COLUMN building_elements.parent_element_id     IS 'dakkapel: UUID of parent dak element';
COMMENT ON COLUMN building_elements.dikte_vloer_boven_mm  IS 'Floor thickness above (mm) — gevel height correction';
COMMENT ON COLUMN building_elements.dikte_vloer_onder_mm  IS 'Floor thickness below (mm) — gevel height correction';
COMMENT ON COLUMN building_elements.dikte_muren_mm        IS 'Adjacent wall thickness (mm) — gevel width correction';
COMMENT ON COLUMN building_elements.perimeter_m           IS 'Thermal bridge perimeter length (m)';
