-- ─── NTA 8800 / Opname Rapport Compliance Fields ─────────────────────────────
-- Adds the qualitative fields required for VABI XML export and the Opname Rapport
-- that were missing from the initial schema.

-- ── Openings (TransparanteDelen) ─────────────────────────────────────────────
ALTER TABLE openings
  ADD COLUMN IF NOT EXISTS thermisch_onderbroken BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS overstek_m            NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS belemmering           TEXT;

COMMENT ON COLUMN openings.thermisch_onderbroken IS 'Whether the window/door frame has a thermal break (thermisch onderbroken kozijn)';
COMMENT ON COLUMN openings.overstek_m            IS 'Horizontal overhang depth above the opening in metres (overstek)';
COMMENT ON COLUMN openings.belemmering           IS 'External obstruction description (neighbouring building, trees, etc.)';

-- ── Building Elements ─────────────────────────────────────────────────────────
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS nokhoogte_m  NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS bodemisolatie BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS brand        TEXT,
  ADD COLUMN IF NOT EXISTS model_nr     TEXT,
  ADD COLUMN IF NOT EXISTS cv_klasse    TEXT;

COMMENT ON COLUMN building_elements.nokhoogte_m   IS 'Dak: ridge height in metres (nokhoogte), measured from eave level to ridge';
COMMENT ON COLUMN building_elements.bodemisolatie  IS 'Vloer: soil/ground insulation present (bodemisolatie)';
COMMENT ON COLUMN building_elements.brand          IS 'Installatie: manufacturer / brand name (merk)';
COMMENT ON COLUMN building_elements.model_nr       IS 'Installatie: model number or product name (model)';
COMMENT ON COLUMN building_elements.cv_klasse      IS 'Installatie: Dutch boiler comfort class (CW3/CW4/CW5/CW6)';
