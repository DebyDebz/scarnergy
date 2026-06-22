-- ─── FIX: close_inspection_session NULL anomaly_count ─────────────────────
--
-- Bug: SUM(is_anomaly::INT) returns NULL when a session has zero (non-deleted)
-- measurements. The UPDATE then assigns anomaly_count = NULL, which violates
-- the NOT NULL constraint on inspection_sessions.anomaly_count and makes
-- "Complete Session" fail for any session with no measurements yet.
--
-- Fix: COALESCE the aggregates to 0 so an empty session closes with counts = 0.
-- Behaviour is otherwise identical to the function in 0071_views_functions.sql.

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

  SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(is_anomaly::INT), 0)
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
