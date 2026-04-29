-- ============================================================
-- SCARNERGY v2.0 — Migration 007: Views & Helper Functions
-- Convenience views that the mobile app and dashboards query.
-- ============================================================

-- ─── VIEW: building_summary ────────────────────────────────────────────
-- One row per building with zone/element/session counts

CREATE VIEW building_summary AS
SELECT
  b.id,
  b.org_id,
  b.reference_code,
  b.street || ' ' || b.house_number || COALESCE(' ' || b.house_number_addition, '') AS full_address,
  b.city,
  b.postal_code,
  b.building_type,
  b.construction_year,
  b.gross_floor_area_m2,
  COUNT(DISTINCT z.id)   AS zone_count,
  COUNT(DISTINCT e.id)   AS element_count,
  COUNT(DISTINCT s.id)   AS session_count,
  MAX(s.started_at)      AS last_inspection_at,
  (SELECT energy_label FROM zones
   WHERE building_id = b.id AND energy_label IS NOT NULL
   ORDER BY updated_at DESC LIMIT 1) AS latest_energy_label
FROM buildings b
LEFT JOIN zones z               ON z.building_id = b.id AND z.is_active
LEFT JOIN building_elements e   ON e.zone_id = z.id AND e.is_active
LEFT JOIN inspection_sessions s ON s.building_id = b.id
WHERE b.is_active
GROUP BY b.id;

-- ─── VIEW: session_summary ─────────────────────────────────────────────

CREATE VIEW session_summary AS
SELECT
  s.id,
  s.org_id,
  s.session_code,
  s.status,
  s.started_at,
  s.completed_at,
  s.duration_seconds,
  s.total_measurements,
  s.anomaly_count,
  s.completion_pct,
  s.sync_status,
  up.full_name           AS inspector_name,
  b.street || ' ' || b.house_number AS building_address,
  b.city                 AS building_city,
  b.postal_code          AS building_postal_code
FROM inspection_sessions s
JOIN user_profiles up ON up.id = s.inspector_id
JOIN buildings b      ON b.id  = s.building_id;

-- ─── VIEW: inspector_dashboard ─────────────────────────────────────────

CREATE VIEW inspector_dashboard AS
SELECT
  up.id            AS inspector_id,
  up.org_id,
  up.full_name,
  up.role,
  COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'active')    AS active_sessions,
  COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'completed') AS completed_sessions,
  COUNT(m.id)                                                 AS total_measurements,
  SUM(m.is_anomaly::INT)                                      AS total_anomalies,
  MAX(m.measured_at)                                          AS last_measurement_at,
  up.last_seen_at
FROM user_profiles up
LEFT JOIN inspection_sessions s ON s.inspector_id = up.id
LEFT JOIN measurements m        ON m.inspector_id = up.id
  AND m.measured_at > NOW() - INTERVAL '30 days'
  AND NOT m.is_deleted
WHERE up.role = 'inspector'
GROUP BY up.id;

-- ─── VIEW: recent_measurements_with_context ───────────────────────────
-- Used by the mobile app's live measurement feed

CREATE VIEW recent_measurements AS
SELECT
  m.measured_at,
  m.id,
  m.org_id,
  m.value_mm,
  m.unit,
  m.measurement_type,
  m.is_anomaly,
  m.anomaly_score,
  m.validation_result,
  m.ingestion_path,
  m.session_id,
  m.device_id,
  d.nickname        AS device_nickname,
  d.mac_address     AS device_mac,
  e.name            AS element_name,
  e.element_type,
  z.name            AS zone_name,
  b.street || ' ' || b.house_number AS building_address
FROM measurements m
JOIN ble_devices d          ON d.id = m.device_id
LEFT JOIN building_elements e ON e.id = m.element_id
LEFT JOIN zones z           ON z.id = e.zone_id
LEFT JOIN buildings b       ON b.id = z.building_id
WHERE NOT m.is_deleted
ORDER BY m.measured_at DESC;

-- ─── FUNCTION: compute zone energy label ──────────────────────────────
-- Called by the Edge Function and can also be called directly via RPC

CREATE OR REPLACE FUNCTION compute_zone_energy_label(p_zone_id UUID)
RETURNS energy_label
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_label energy_label;
  v_total_rc NUMERIC;
  v_wall_rc  NUMERIC;
  v_roof_rc  NUMERIC;
  v_floor_rc NUMERIC;
  v_window_u NUMERIC;
  v_install_eff NUMERIC;
BEGIN
  -- Aggregate thermal values per element type for this zone
  SELECT
    AVG(CASE WHEN element_type = 'gevel'  THEN rc_value END),
    AVG(CASE WHEN element_type = 'dak'    THEN rc_value END),
    AVG(CASE WHEN element_type = 'vloer'  THEN rc_value END),
    AVG(CASE WHEN element_type = 'installatie' THEN efficiency END)
  INTO v_wall_rc, v_roof_rc, v_floor_rc, v_install_eff
  FROM building_elements
  WHERE zone_id = p_zone_id AND is_active;

  SELECT AVG(o.u_value_total)
  INTO v_window_u
  FROM openings o
  JOIN building_elements e ON e.id = o.element_id
  WHERE e.zone_id = p_zone_id AND e.element_type = 'gevel' AND o.is_active;

  -- Simplified NTA 8800-inspired label assignment
  -- (Full implementation uses primary energy demand in kWh/m²·yr)
  v_total_rc := COALESCE(v_wall_rc, 0) +
                COALESCE(v_roof_rc, 0) +
                COALESCE(v_floor_rc, 0);

  v_label := CASE
    WHEN v_total_rc >= 12 AND COALESCE(v_window_u, 2) <= 0.8  THEN 'A++++'
    WHEN v_total_rc >= 9  AND COALESCE(v_window_u, 2) <= 1.0  THEN 'A+++'
    WHEN v_total_rc >= 7  AND COALESCE(v_window_u, 2) <= 1.2  THEN 'A++'
    WHEN v_total_rc >= 5  AND COALESCE(v_window_u, 2) <= 1.5  THEN 'A+'
    WHEN v_total_rc >= 3.5                                     THEN 'A'
    WHEN v_total_rc >= 2.5                                     THEN 'B'
    WHEN v_total_rc >= 1.5                                     THEN 'C'
    WHEN v_total_rc >= 1.0                                     THEN 'D'
    WHEN v_total_rc >= 0.5                                     THEN 'E'
    WHEN v_total_rc >  0                                       THEN 'F'
    ELSE 'G'
  END;

  -- Update the zone's energy label
  UPDATE zones SET energy_label = v_label, updated_at = NOW()
  WHERE id = p_zone_id;

  RETURN v_label;
END;
$$;

-- ─── FUNCTION: close inspection session ───────────────────────────────

CREATE OR REPLACE FUNCTION close_inspection_session(p_session_id UUID)
RETURNS inspection_sessions
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session inspection_sessions;
  v_duration INTEGER;
  v_total    INTEGER;
  v_anomalies INTEGER;
  v_elements  INTEGER;
  v_complete  INTEGER;
BEGIN
  -- Get session
  SELECT * INTO v_session FROM inspection_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found: %', p_session_id; END IF;
  IF v_session.status != 'active' THEN RAISE EXCEPTION 'Session is not active'; END IF;

  -- Compute duration
  v_duration := EXTRACT(EPOCH FROM (NOW() - v_session.started_at))::INTEGER;

  -- Compute measurement totals
  SELECT COUNT(*), SUM(is_anomaly::INT)
  INTO v_total, v_anomalies
  FROM measurements
  WHERE session_id = p_session_id AND NOT is_deleted;

  -- Compute completion % (elements with at least one measurement / total elements)
  SELECT
    COUNT(DISTINCT be.id),
    COUNT(DISTINCT m.element_id)
  INTO v_elements, v_complete
  FROM building_elements be
  JOIN zones z ON z.building_id = v_session.building_id
  LEFT JOIN measurements m ON m.element_id = be.id AND m.session_id = p_session_id
  WHERE be.zone_id = z.id AND be.is_active;

  -- Close session
  UPDATE inspection_sessions SET
    status            = 'completed',
    completed_at      = NOW(),
    duration_seconds  = v_duration,
    total_measurements = v_total,
    anomaly_count     = v_anomalies,
    completion_pct    = CASE WHEN v_elements > 0
                          THEN ROUND((v_complete::NUMERIC / v_elements * 100), 2)
                          ELSE 0 END,
    updated_at        = NOW()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;
