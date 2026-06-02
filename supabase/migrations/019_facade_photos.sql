-- ─── Building facade photos (Gevel Foto's buitenzijde) ───────────────────────
-- Section 2 of the Opname Rapport requires one exterior photo per façade
-- direction. Photos are building-level (persist across sessions) but may
-- reference the session during which they were captured.

CREATE TABLE IF NOT EXISTS building_facade_photos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organisations(id)        ON DELETE CASCADE,
  building_id UUID        NOT NULL REFERENCES buildings(id)            ON DELETE CASCADE,
  session_id  UUID                 REFERENCES inspection_sessions(id)  ON DELETE SET NULL,
  direction   TEXT        NOT NULL CHECK (direction IN ('voor','achter','links','rechts')),
  photo_url   TEXT        NOT NULL,   -- Supabase Storage path
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facade_photos_building ON building_facade_photos(building_id);
CREATE INDEX IF NOT EXISTS idx_facade_photos_org      ON building_facade_photos(org_id);

-- Only one photo per direction per building (upsert pattern on mobile)
CREATE UNIQUE INDEX IF NOT EXISTS uq_facade_direction
  ON building_facade_photos(building_id, direction);

COMMENT ON TABLE building_facade_photos IS
  'One exterior photo per façade direction (voor/achter/links/rechts) per building.';
COMMENT ON COLUMN building_facade_photos.direction IS
  'Façade direction: voor (front), achter (rear), links (left gable), rechts (right gable)';
COMMENT ON COLUMN building_facade_photos.photo_url IS
  'Supabase Storage path: facade-photos/{org_id}/{building_id}/{direction}_{timestamp}.jpg';

-- Row-level security
ALTER TABLE building_facade_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "facade_photos_org_member"
  ON building_facade_photos
  FOR ALL
  USING  (org_id = public.user_org_id())
  WITH CHECK (org_id = public.user_org_id());
