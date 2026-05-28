# Scarnergy v2.0 — Inspection Flow
**Built:** 2026-05-26

---

## Overview

When an inspector taps **Start Inspection** on a building, the app now runs a 6-stage guided wizard before landing on the measurement screen. This document describes every stage, the data model behind it, and how the pieces connect end-to-end.

```
Buildings screen
    └─ Start Inspection
           │
           ▼
    flow.tsx (wizard)
    ├── Stage 1  Check      ─ does pre-existing data exist?
    ├── Stage 2  Draw       ─ point-to-point polygon drawing per zone
    ├── Stage 3  Zones      ─ name zones, add more, re-draw any polygon
    ├── Stage 4  Grid       ─ overlay polygon on calibrated grid, set scale
    ├── Stage 5  Elements   ─ drag-and-drop walls/doors/windows/etc onto grid
    └── (save & navigate)
           │
           ▼
    [id].tsx  (existing session detail + measurement screen)
```

---

## Stage 1 — Entry Check

**File:** `app/tabs/sessions/flow.tsx` (mount effect)

On launch, the wizard queries the database for the building:

```sql
SELECT zones.*, building_elements.id
FROM   zones
JOIN   building_elements ON building_elements.zone_id = zones.id
WHERE  zones.building_id = $buildingId
AND    zones.is_active = true
```

| Result | Action |
|---|---|
| Zones exist **and** elements exist | Jump to Stage 4 (Grid Analysis) |
| Zones exist, no elements | Jump to Stage 3 (Zone Manager) |
| No zones | Go to Stage 2 (Draw Floor Plan) |

The current stage is always written back to `inspection_sessions.flow_stage` so the wizard resumes from the correct point if the app is closed mid-flow.

---

## Stage 2 — Floor Plan Drawing

**File:** `components/inspection/DrawingCanvas.tsx`

The inspector draws a polygon outline for the current zone using point-to-point tapping on a 300×300 SVG canvas.

### How it works
1. Each tap on the canvas adds a vertex (blue circle)
2. After 3+ vertices, the polygon fills with a light navy tint
3. Tap within 24px of the first vertex → polygon auto-closes
4. "Close Shape" button also available once ≥ 3 points exist
5. Undo removes the last vertex; Reset clears all

### Save
Points are **normalized to 0–1** relative to canvas dimensions before being saved:
```typescript
{ x: tapX / 300, y: tapY / 300 }
```
Stored in `zones.floor_plan_points` as a JSONB array:
```json
[{"x":0.12,"y":0.08},{"x":0.85,"y":0.08},{"x":0.85,"y":0.92},{"x":0.12,"y":0.92}]
```
After save → advances to Stage 3.

---

## Stage 3 — Zone Management

**File:** `components/inspection/ZoneManager.tsx`

Shows a list of all zones for the building. Each zone card displays:
- A 60×60 polygon thumbnail (SVG miniature of the drawn plan)
- Zone name
- Status: "Floor plan drawn" (green) or "No floor plan yet" (amber)
- Draw / Redraw button

### Adding a zone
1. Tap **+ Add Zone** → inline name input appears
2. Submit → `INSERT INTO zones (org_id, building_id, zone_code, name, floor_level)` where `zone_code` is auto-incremented (`Z01`, `Z02`, …)
3. Immediately transitions to Stage 2 with the new zone selected
4. After drawing, returns to Stage 3 list

### Advancing
The "Continue →" button is enabled once at least one zone has a saved floor plan. It leads to Stage 4.

---

## Stage 4 — Grid Analysis

**File:** `components/inspection/GridCanvas.tsx`

Renders the zone's saved polygon on a 300×300 calibrated grid (20px cell size). If the session has multiple zones, a tab bar lets the inspector switch between them.

### Scale setting
The inspector enters the real-world width of the zone in metres (e.g., `5`). This converts the grid into a spatial reference:
```
cell size in metres = enteredWidth / (INNER_PX / 20)
```
Saved to `zones.floor_plan_scale_m`.

Tapping **Confirm Grid →** saves all zone scales and advances to Stage 5.

---

## Stage 5 — Element Placement

**File:** `components/inspection/ElementPlacer.tsx`

The inspector populates the floor plan with structural elements by tapping a palette chip and dragging to position.

### Element types

| Palette label | DB `element_type` | Visual |
|---|---|---|
| Wall | `gevel` | Thin navy rectangle |
| Door | `transparant_deel` | Rectangle + arc swing |
| Window | `transparant_deel` | Rectangle with hash lines |
| Roof | `dak` | Rectangle with diagonal hatch |
| Floor | `vloer` | Rectangle with dotted pattern |
| Install | `installatie` | Yellow square with ⚙ |

### Interaction
- **Tap palette chip** → places element at grid center
- **Drag element** → moves freely, snaps to 20px grid on release
- **Tap to select** → shows Rename / Rotate / Delete action bar
- **Rotate** → 45° increment rotation
- **Double-tap label** → rename modal
- Elements are auto-labelled: `Wall-01`, `Door-02`, `Window-01`, …

### Save
On **Save & Continue →**:
```typescript
INSERT INTO building_elements (
  org_id, zone_id, element_type, name,
  orientation_deg,
  grid_x, grid_y, grid_w, grid_h, grid_rotation,
  sort_order
)
```
`grid_x / grid_y / grid_w / grid_h` are normalized 0–1 (position relative to the 300×300 canvas). `orientation_deg` mirrors `grid_rotation` for compatibility with the existing measurement flow.

After all elements across all zones are saved, `inspection_sessions.flow_stage` is set to `6` and the inspector is navigated to the existing `[id].tsx` session screen.

---

## Stage 6 — Measurement (Existing Screens)

**Files:** `app/tabs/sessions/[id].tsx`, `app/tabs/sessions/inspect.tsx`

No changes were made to these screens. The elements placed in Stage 5 appear in the zone element list. The inspector:
1. Selects a zone chip
2. Selects an element (Wall-01, Door-01, etc.)
3. Taps **Inspect** → `inspect.tsx` opens
4. Takes a BLE laser measurement (or enters manually)
5. Measurement is saved to the `measurements` hypertable with `element_id`, `session_id`, `inspector_id`, `value_mm`

The existing `floorplan.tsx` zone overview remains available via the floor plan icon in the session header.

---

## Database Schema Added (Migration 015)

```sql
-- zones
ALTER TABLE zones
  ADD COLUMN floor_plan_points  JSONB,        -- [{x,y}] normalized 0-1
  ADD COLUMN floor_plan_scale_m NUMERIC(10,4); -- inspector-set real-world width in metres

-- building_elements
ALTER TABLE building_elements
  ADD COLUMN grid_x        NUMERIC(10,4), -- normalized 0-1
  ADD COLUMN grid_y        NUMERIC(10,4),
  ADD COLUMN grid_w        NUMERIC(10,4),
  ADD COLUMN grid_h        NUMERIC(10,4),
  ADD COLUMN grid_rotation NUMERIC(6,2) DEFAULT 0;

-- inspection_sessions
ALTER TABLE inspection_sessions
  ADD COLUMN flow_stage SMALLINT NOT NULL DEFAULT 1;
```

No existing columns were modified. All new columns are nullable (except `flow_stage` which defaults to `1`). No new RLS policies were needed — existing `org_id`-based policies cover all new columns.

---

## File Map

| File | Role |
|---|---|
| `supabase/migrations/015_floor_plan_grid.sql` | Schema additions |
| `app/tabs/sessions/flow.tsx` | Wizard shell — owns stage state |
| `components/inspection/DrawingCanvas.tsx` | Stage 2 SVG polygon drawing |
| `components/inspection/ZoneManager.tsx` | Stage 3 zone list + creation |
| `components/inspection/GridCanvas.tsx` | Stage 4 grid overlay + scale |
| `components/inspection/ElementPlacer.tsx` | Stage 5 drag-and-drop placement |
| `app/tabs/sessions/_layout.tsx` | Added `flow` screen to Stack |
| `app/tabs/buildings.tsx` | Navigation target changed to `flow?id=…&buildingId=…` |
| `lib/supabase.ts` | Added new fields to `Zone`, `BuildingElement`, `InspectionSession` interfaces |

---

## Stage Skip Logic

| Condition at session start | Behaviour |
|---|---|
| No zones, no elements | Full wizard: Stages 2 → 3 → 4 → 5 |
| Zones exist, no elements | Start at Stage 3, then 4 → 5 |
| Zones + elements exist | Start at Stage 4 (Grid), then 5 |

This allows an admin to pre-configure buildings via the web panel (create zones and elements) so field inspectors skip directly to confirming the grid and measuring.

---

## Resume After Interruption

`inspection_sessions.flow_stage` is written on every stage advance. If the app is closed mid-wizard and the inspector re-opens the session from the Sessions list, `flow.tsx` reads the persisted stage from the DB and resumes from the correct point.

*(The Sessions list currently links to `[id].tsx` — a future improvement is to detect `flow_stage < 6` and redirect back to `flow.tsx` automatically.)*
