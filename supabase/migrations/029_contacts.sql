-- ============================================================
-- SCARNERGY v2.0 — Migration 029: building contacts
-- Closes the "Contactpersoon" gap identified when adding the
-- AppSheet <-> ScanergyV2 data-source toggle: ScanergyV2 had no
-- equivalent to AppSheet's Contactpersoon sheet, so contact info
-- was silently omitted whenever the toggle pointed at this side.
-- See docs/CONTACTPERSOON_DATA_ANALYSIS.md §4 for the field mapping
-- this table follows.
--
-- A contact belongs to a building (1:1, matching Objecten.Contactpersoon
-- ID in the source data), not directly to a company — org_id is
-- standard tenant scoping, building_id is the relationship that
-- actually matters for "who do I call about this building".
-- ============================================================

CREATE TYPE contact_role AS ENUM ('eigenaar', 'huurder', 'beheerder', 'opdrachtgever');

CREATE TABLE contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  building_id  UUID REFERENCES buildings(id) ON DELETE CASCADE,
  legacy_id    TEXT,                          -- AppSheet `Contactpersoon ID`, kept for traceability during coexistence; not the PK
  full_name    TEXT NOT NULL,
  phone        TEXT,                          -- normalized on import; source has mixed string/float/"(blank)" formats, see analysis doc §3
  email        TEXT,
  role         contact_role,                  -- source enforces nothing (55/90 rows unset in AppSheet) — nullable here too
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contacts_org ON contacts(org_id);
CREATE INDEX idx_contacts_building ON contacts(building_id);
CREATE UNIQUE INDEX idx_contacts_legacy_id ON contacts(legacy_id) WHERE legacy_id IS NOT NULL;

CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts: see own org"
  ON contacts FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY "contacts: insert own org"
  ON contacts FOR INSERT
  WITH CHECK (org_id = public.user_org_id());

CREATE POLICY "contacts: update own org"
  ON contacts FOR UPDATE
  USING (org_id = public.user_org_id());

CREATE POLICY "contacts: delete — admins only"
  ON contacts FOR DELETE
  USING (org_id = public.user_org_id() AND public.is_privileged());

-- 005's blanket grant predates this table; grant explicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO authenticated;
