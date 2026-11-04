-- ============================================================
-- SCARNERGY v2.0 — Migration 028: Energy label history (GAP W8, Phase 8)
-- One row per closed session that had its energy label (re)computed via
-- the energy_label_estimate edge function. Building-level only — the
-- edge function's worst-zone rollup, not a per-zone log. Feeds the
-- historical trend chart on the web building detail page.
-- ============================================================

CREATE TABLE energy_label_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organisations(id)       ON DELETE CASCADE,
  building_id  UUID NOT NULL REFERENCES buildings(id)           ON DELETE CASCADE,
  session_id   UUID NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,

  energy_label energy_label NOT NULL,
  computed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE(session_id)
);

CREATE INDEX idx_energy_label_snapshots_org      ON energy_label_snapshots(org_id);
CREATE INDEX idx_energy_label_snapshots_building ON energy_label_snapshots(building_id, computed_at);

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE energy_label_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "energy_label_snapshots: see own org"
  ON energy_label_snapshots FOR SELECT
  USING (org_id = public.user_org_id());

CREATE POLICY "energy_label_snapshots: insert own org"
  ON energy_label_snapshots FOR INSERT
  WITH CHECK (org_id = public.user_org_id());

-- 005's blanket grant predates this table; grant explicitly.
GRANT SELECT, INSERT ON energy_label_snapshots TO authenticated;
