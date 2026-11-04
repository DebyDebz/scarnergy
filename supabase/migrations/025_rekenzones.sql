-- ============================================================
-- SCARNERGY v2.0 — Migration 025: Rekenzones (GAP W4, option a)
-- Calculation-zone grouping layer ABOVE zones (zones == floors).
-- A rekenzone like "A met airco" groups multiple zones/floors;
-- elements roll up via element.zone_id → zone.rekenzone_id.
-- Purely additive: existing zones keep rekenzone_id = NULL and all
-- current behaviour (incl. VABI export) is unchanged for them.
-- ============================================================

-- ─── REKENZONES ────────────────────────────────────────────────────────────

CREATE TABLE rekenzones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  building_id UUID NOT NULL REFERENCES buildings(id)     ON DELETE CASCADE,

  name        TEXT NOT NULL,                 -- e.g. "A met airco"
  description TEXT,
  notes       TEXT,                          -- AppSheet "Notities"

  sort_order  SMALLINT NOT NULL DEFAULT 0,
  is_active   BOOLEAN  NOT NULL DEFAULT TRUE,
  metadata    JSONB    NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(building_id, name)
);

CREATE INDEX idx_rekenzones_org      ON rekenzones(org_id);
CREATE INDEX idx_rekenzones_building ON rekenzones(building_id);

CREATE TRIGGER rekenzones_updated_at BEFORE UPDATE ON rekenzones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── ZONES → REKENZONE LINK ────────────────────────────────────────────────
-- Deleting a rekenzone un-groups its zones rather than deleting them.

ALTER TABLE zones ADD COLUMN rekenzone_id UUID REFERENCES rekenzones(id) ON DELETE SET NULL;
CREATE INDEX idx_zones_rekenzone ON zones(rekenzone_id);

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE rekenzones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rekenzones: see own org"
  ON rekenzones FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY "rekenzones: insert own org"
  ON rekenzones FOR INSERT
  WITH CHECK (org_id = public.user_org_id());

CREATE POLICY "rekenzones: update own org"
  ON rekenzones FOR UPDATE
  USING (org_id = public.user_org_id());

CREATE POLICY "rekenzones: delete — admins only"
  ON rekenzones FOR DELETE
  USING (org_id = public.user_org_id() AND public.is_privileged());

-- 005's blanket grant predates this table; grant explicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON rekenzones TO authenticated;
