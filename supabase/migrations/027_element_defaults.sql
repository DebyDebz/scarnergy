-- ============================================================
-- SCARNERGY v2.0 — Migration 027: element defaults (GAP W4)
-- "Sla op als Standaard" for element edit forms (AppSheet parity,
-- primarily Transparante Delen): one saved default payload per
-- element kind per organisation, applied from the add/edit form.
-- Purely additive.
-- ============================================================

CREATE TABLE element_defaults (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  element_kind TEXT NOT NULL,                 -- e.g. 'transparant_deel', 'gevel'
  payload      JSONB NOT NULL DEFAULT '{}',   -- whitelisted form values
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, element_kind)
);

CREATE INDEX idx_element_defaults_org ON element_defaults(org_id);

CREATE TRIGGER element_defaults_updated_at BEFORE UPDATE ON element_defaults
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE element_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "element_defaults: see own org"
  ON element_defaults FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY "element_defaults: insert own org"
  ON element_defaults FOR INSERT
  WITH CHECK (org_id = public.user_org_id());

CREATE POLICY "element_defaults: update own org"
  ON element_defaults FOR UPDATE
  USING (org_id = public.user_org_id());

CREATE POLICY "element_defaults: delete — admins only"
  ON element_defaults FOR DELETE
  USING (org_id = public.user_org_id() AND public.is_privileged());

-- 005's blanket grant predates this table; grant explicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON element_defaults TO authenticated;
