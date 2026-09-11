-- 036_fix_energy_label_no_data.sql
-- compute_zone_energy_label returned 'G' (the worst possible label) for a
-- zone with NO Rc data whatsoever, not just for a zone with genuinely poor
-- insulation. v_total_rc := COALESCE(v_wall_rc,0) + COALESCE(v_roof_rc,0) +
-- COALESCE(v_floor_rc,0) collapses "unmeasured" and "measured at zero" to
-- the same value, and every WHEN branch falls through to ELSE 'G' at 0.
--
-- This is most visible for AppSheet-materialized zones: AppSheet has no
-- Rc/U/efficiency columns to map (see web/lib/appsheet/mappers.ts), so a
-- zone whose elements were pulled in via materialize-element and never
-- manually measured has rc_value NULL on every element — session-close then
-- silently stamps it 'G' and app/tabs/sessions/results.tsx renders that as
-- a real computed hero label, even though "No label computed yet" is
-- already the screen's correct empty state for exactly this situation.
-- Recomputing with no Rc data at all should return to that empty state
-- (energy_label = NULL), not fabricate a worst-case label.

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

  -- No Rc measured anywhere for this zone (e.g. an AppSheet-materialized
  -- zone never manually measured) — nothing to compute a label from.
  -- Clear any stale label rather than fabricating a worst-case one.
  IF v_wall_rc IS NULL AND v_roof_rc IS NULL AND v_floor_rc IS NULL THEN
    UPDATE zones SET energy_label = NULL, updated_at = NOW() WHERE id = p_zone_id;
    RETURN NULL;
  END IF;

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
