-- ============================================================
-- SCARNERGY v2.0 — Migration 009: View Updates
--
-- 1. Fixes recent_measurements to LEFT JOIN ble_devices so
--    web-entered measurements (device_id = NULL) appear too.
-- 2. Adds anomaly_feed view for the Anomalies dashboard page.
-- ============================================================

-- ─── FIX recent_measurements ────────────────────────────────────────────────
-- Change the ble_devices JOIN from INNER to LEFT JOIN so measurements that
-- arrive via the web UI (no physical device, device_id IS NULL) are included.

DROP VIEW IF EXISTS recent_measurements CASCADE;
CREATE VIEW recent_measurements AS
SELECT
  m.*,
  COALESCE(bd.nickname, 'web')              AS device_nickname,
  be.name                                   AS element_name,
  z.name                                    AS zone_name,
  b.street || ' ' || b.house_number        AS building_address
FROM measurements           m
JOIN  inspection_sessions   s  ON s.id  = m.session_id
JOIN  buildings             b  ON b.id  = s.building_id
LEFT JOIN ble_devices       bd ON bd.id = m.device_id
LEFT JOIN building_elements be ON be.id = m.element_id
LEFT JOIN zones             z  ON z.id  = be.zone_id
WHERE m.is_deleted = FALSE;

-- ─── anomaly_feed ────────────────────────────────────────────────────────────
-- Org-wide view of all anomalous measurements with full context.
-- RLS on the measurements table automatically scopes rows to the caller's org.

DROP VIEW IF EXISTS anomaly_feed CASCADE;
CREATE VIEW anomaly_feed AS
SELECT
  m.id,
  m.org_id,
  m.session_id,
  m.element_id,
  m.device_id,
  m.measured_at,
  m.value_mm,
  m.unit,
  m.is_anomaly,
  m.anomaly_score,
  m.classifier_label,
  m.validation_message,
  m.ingestion_path,
  s.session_code,
  b.id                                                  AS building_id,
  b.street || ' ' || b.house_number || ', ' || b.city  AS building_address,
  COALESCE(bd.nickname, 'web')                          AS device_nickname,
  be.name                                               AS element_name,
  z.name                                                AS zone_name,
  up.full_name                                          AS inspector_name
FROM measurements           m
JOIN  inspection_sessions   s  ON s.id  = m.session_id
JOIN  buildings             b  ON b.id  = s.building_id
JOIN  user_profiles         up ON up.id = s.inspector_id
LEFT JOIN ble_devices       bd ON bd.id = m.device_id
LEFT JOIN building_elements be ON be.id = m.element_id
LEFT JOIN zones             z  ON z.id  = be.zone_id
WHERE m.is_anomaly = TRUE
  AND m.is_deleted = FALSE;

-- ─── GRANTS ──────────────────────────────────────────────────────────────────
GRANT SELECT ON recent_measurements TO authenticated, anon;
GRANT SELECT ON anomaly_feed        TO authenticated, anon;
