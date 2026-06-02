-- ============================================================
-- SCARNERGY v2.0 — Migration 015: Floor Plan & Grid Positioning
-- Adds per-zone polygon storage, real-world scale, per-element
-- grid coordinates, and wizard stage tracking on sessions.
-- ============================================================

-- ─── ZONES: floor plan polygon + scale ───────────────────────
-- floor_plan_points: normalized 0-1 coords, e.g. [{"x":0.1,"y":0.2},...]
-- floor_plan_scale_m: inspector-entered real-world width in metres
ALTER TABLE zones
  ADD COLUMN IF NOT EXISTS floor_plan_points JSONB,
  ADD COLUMN IF NOT EXISTS floor_plan_scale_m NUMERIC(10,4);

-- ─── BUILDING ELEMENTS: grid position ────────────────────────
-- All values normalized 0-1 relative to the zone's canvas bounds.
-- grid_rotation: 0-315 in 45° increments.
ALTER TABLE building_elements
  ADD COLUMN IF NOT EXISTS grid_x        NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS grid_y        NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS grid_w        NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS grid_h        NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS grid_rotation NUMERIC(6,2) DEFAULT 0;

-- ─── INSPECTION SESSIONS: wizard stage ───────────────────────
-- Persisted so the inspector can resume after crash/close.
-- 1=check, 2=draw, 3=zones, 4=grid, 5=elements, 6=measure
ALTER TABLE inspection_sessions
  ADD COLUMN IF NOT EXISTS flow_stage SMALLINT NOT NULL DEFAULT 1;
