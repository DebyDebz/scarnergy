-- ============================================================
-- SCARNERGY v2.0 — Migration 022: Soft-delete for sessions & buildings
-- Replaces hard delete (which cascaded away measurements) with an
-- is_active flag. Soft-deleted rows are hidden by the summary views,
-- so they disappear from every list while their data is preserved.
-- Buildings already have is_active (003); sessions get it here.
-- ============================================================

-- ─── 1. Add is_active to inspection_sessions ─────────────────────────────
ALTER TABLE inspection_sessions
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Mirror idx_sessions_status, scoped to live rows.
CREATE INDEX IF NOT EXISTS idx_sessions_active
  ON inspection_sessions (org_id, status) WHERE is_active;

-- ─── 2. Recreate summary views with is_active filtering ──────────────────
-- session_summary: hide soft-deleted sessions AND sessions whose building
-- was soft-deleted (replicates the old cascade-hide without data loss).

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

-- building_summary: hide soft-deleted buildings; don't count soft-deleted
-- sessions in session_count / last_inspection_at.

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

-- Recreating the views drops their grants; restore read access (mirrors 007/012).
GRANT SELECT ON session_summary  TO authenticated, anon, service_role;
GRANT SELECT ON building_summary TO authenticated, anon, service_role;

-- ─── 3. Drop the now-unused hard-delete policy (from 021) ────────────────
-- We no longer hard-delete sessions; soft-delete uses the existing
-- "sessions: update own or privileged" UPDATE policy.
DROP POLICY IF EXISTS "sessions: delete — admins only" ON inspection_sessions;
