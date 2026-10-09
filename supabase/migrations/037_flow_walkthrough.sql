-- ============================================================
-- SCARNERGY v2.0 — Migration 037: flow walkthrough (Nils, 2026-10-05)
-- Purely additive.
-- ============================================================

-- 1. An element may belong to a different rekenzone than its floor (e.g. one
--    room with air conditioning on an otherwise ordinary floor). NULL = follow
--    the floor's rekenzone, which keeps today's behaviour for every row.
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS rekenzone_id UUID REFERENCES rekenzones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_elements_rekenzone ON building_elements(rekenzone_id);
COMMENT ON COLUMN building_elements.rekenzone_id IS
  'Explicit rekenzone override; NULL = inherit from zones.rekenzone_id';

-- 2. Photo roles: which photos are situational vs close-up (glass detail,
--    crawl-space hatch). Keyed by the storage path / URI in photo_urls.
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS photo_roles JSONB NOT NULL DEFAULT '{}';
COMMENT ON COLUMN building_elements.photo_roles IS
  'photo path -> role (situational | detail | crawlspace)';

-- 3. Planned visit date/time, so the inspector's list reads chronologically.
ALTER TABLE inspection_sessions
  ADD COLUMN IF NOT EXISTS planned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_sessions_planned ON inspection_sessions(planned_at);

-- session_summary selects s.* but a view's column list is fixed at creation,
-- so it must be recreated to expose planned_at (same body as migration 022).
DROP VIEW IF EXISTS session_summary CASCADE;
CREATE VIEW session_summary AS
SELECT
  s.*,
  up.full_name                              AS inspector_name,
  b.street || ' ' || b.house_number        AS building_address,
  b.city                                    AS building_city
FROM inspection_sessions s
JOIN user_profiles up ON up.id = s.inspector_id
JOIN buildings     b  ON b.id  = s.building_id
WHERE s.is_active = TRUE
  AND b.is_active = TRUE;
GRANT SELECT ON session_summary TO authenticated, anon, service_role;

-- 4. Entrance photo with the house number (proof of presence).
ALTER TABLE building_facade_photos DROP CONSTRAINT IF EXISTS building_facade_photos_direction_check;
ALTER TABLE building_facade_photos
  ADD CONSTRAINT building_facade_photos_direction_check
  CHECK (direction IN ('voor','achter','links','rechts','entree'));
COMMENT ON COLUMN building_facade_photos.direction IS
  'voor (front), achter (rear), links (left), rechts (right), entree (entrance with house number)';
