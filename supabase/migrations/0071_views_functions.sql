-- ============================================================
-- SCARNERGY v2.0 — Migration 007a: Additional Views & Helper Functions
-- inspector_dashboard view + RPC functions.
-- (building_summary, session_summary, recent_measurements are in 007_views.sql)
-- ============================================================

-- ─── VIEW: inspector_dashboard ─────────────────────────────────────────

DROP VIEW IF EXISTS inspector_dashboard CASCADE;
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

GRANT SELECT ON inspector_dashboard TO authenticated, anon;

-- ─── FUNCTION: compute zone energy label ──────────────────────────────

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
  SELECT * INTO v_session FROM inspection_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found: %', p_session_id; END IF;
  IF v_session.status != 'active' THEN RAISE EXCEPTION 'Session is not active'; END IF;

  v_duration := EXTRACT(EPOCH FROM (NOW() - v_session.started_at))::INTEGER;

  SELECT COUNT(*), SUM(is_anomaly::INT)
  INTO v_total, v_anomalies
  FROM measurements
  WHERE session_id = p_session_id AND NOT is_deleted;

  SELECT
    COUNT(DISTINCT be.id),
    COUNT(DISTINCT m.element_id)
  INTO v_elements, v_complete
  FROM building_elements be
  JOIN zones z ON z.building_id = v_session.building_id
  LEFT JOIN measurements m ON m.element_id = be.id AND m.session_id = p_session_id
  WHERE be.zone_id = z.id AND be.is_active;

  UPDATE inspection_sessions SET
    status             = 'completed',
    completed_at       = NOW(),
    duration_seconds   = v_duration,
    total_measurements = v_total,
    anomaly_count      = v_anomalies,
    completion_pct     = CASE WHEN v_elements > 0
                           THEN ROUND((v_complete::NUMERIC / v_elements * 100), 2)
                           ELSE 0 END,
    updated_at         = NOW()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;
