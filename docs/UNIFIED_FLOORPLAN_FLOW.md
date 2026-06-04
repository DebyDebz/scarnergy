# Unified Floor-Plan Flow — Image Upload + Manual Draw

**Status:** code complete, type-clean, backend-verified (live). On-device pass (Layer C) pending.
**Scope:** mobile inspection app (`app/`, `components/inspection/`, `lib/`). No DB schema changes.

---

## 1. Problem

The inspection setup had **two divergent floor-plan paths**:

- **Manual draw** walked discrete stages: draw → zones → grid (scale) → place elements.
- **Image upload** bundled three steps into one component (pick image → trace → set scale
  inline) and then **skipped Zone Definition and Grid Analysis**, jumping straight to a
  read-only viewer.

So the two entry modes had different stage orders, captured scale in different places, and
only one of them ever showed zone definition. The goal: **image upload and manual drawing
must follow the same flow**, end to end, still connected to the existing backend/database,
without losing any existing functionality or design.

### Canonical flow (target)
`1 Check → 2 Create → 3 Zones → 4 Grid/Scale → 5 Place Elements → 6 Measure`
(matches the `flow_stage` semantics documented in migration `0074_floor_plan_grid.sql`.)

---

## 2. Solution

Both entry modes now converge on **one pipeline**. Image presence is just an optional
background on the same canvas — it never changes which stage you're in.

```
        ┌─ upload image (camera/library) ─┐
Stage 2 ┤                                 ├─► same zone row {floor_plan_points, image_url?}
(Create)└─ skip image → draw on grid ─────┘
                       │
Stage 3 Zones ─────────┤  ZoneManager (identical)
Stage 4 Grid ──────────┤  GridCanvas — shows image if present, else blank grid;
                       │  writes floor_plan_scale_m for BOTH
Stage 5 Place ─────────┤  ElementPlacer (identical)
Stage 6 Measure ───────┘  inspect.tsx — BLE / manual (identical)
```

The single pivot is **scale ownership**: scale is now written *only* by Grid Analysis, so a
zone "having scale" cleanly distinguishes "needs gridding" from "gridded" for both modes.

---

## 3. What changed (by phase)

### Phase 1 — Grid Analysis became image-aware
`components/inspection/GridCanvas.tsx`
- Renders the uploaded photo (`resizeMode="contain"`) behind the outline when a zone has
  `floor_plan_image_url`; projects the outline through the same contain transform so it lands
  on the room. Falls back to the original bbox-fit for blank (manual) zones — **no regression**.
- Remains the sole writer of `floor_plan_scale_m`.

### Phase 2 — Stage 2 unified
`components/inspection/FloorPlanImageUpload.tsx`
- Removed the inline scale step (old step 3) and all its state/validation/styles.
- Both image and no-image paths now end Stage 2 with a single **Save →**, writing only
  `floor_plan_points` (+ `floor_plan_image_url` when an image was uploaded). No scale here.
- Preserved: image picker, camera/library/skip, polygon tracing, auto-detect, new-zone creation.

### Phase 3 — Unified routing
`app/tabs/sessions/flow.tsx`
- Removed the "image + scale → viewer" shortcut that bypassed Grid Analysis.
- Routing now gates purely on data (`hasPoints` / `hasScale` / `hasElems`), identical for both
  modes. Supervisor-pre-configured zones (which carry points + scale + image) land on the same
  image-backed grid as everyone else — the grid *is* the plan review.
- Progress bar unified to the four setup steps. The Stage-6 `FloorPlanViewer` branch is left
  intact but no longer auto-entered (harmless, reusable).

### Phase 4A — Shared geometry + tests
`lib/floorplanGeometry.ts` (new), `components/inspection/{GridCanvas,FloorPlanViewer}.tsx`
- Extracted the projection math (`projectOnImage`, `fitToInner`) into one pure, dependency-free
  module imported by both components — guarantees the outline projects identically wherever it's
  drawn, and makes the math unit-testable (mirrors the `hooks/bleDecoder` pattern).
- `__tests__/floorplanGeometry.test.ts` covers ring-closing, contain-fit centering, in-bounds,
  and translation/scale invariance.

---

## 4. Backend / database — connected & verified

No schema migration was required; everything the flow needs already existed:

| Concern | Backing | Verified |
|--------|---------|----------|
| Polygon / scale / image | `zones.floor_plan_points`, `floor_plan_scale_m`, `floor_plan_image_url` | ✅ |
| Image storage | `floor-plans` public bucket + RLS (migration 020) | ✅ upload + public read |
| Element grid coords | `building_elements.grid_x/y/w/h/rotation` | ✅ |
| Measurement | `inspection_sessions` + `measurements` (inspector-scoped RLS) | ✅ |
| Auto-detect | AI server `POST /floorplan/detect` | ✅ 200 on sample |
| Stage resume | `inspection_sessions.flow_stage` | ✅ |

Verified against the **live** instance (`212.69.86.210`) as an authenticated dev user, with RLS
enforced and full self-cleanup (0 orphans). Tool: `scripts/phase4_backend_smoke.sh`
(read-only by default; `--login EMAIL PASS --write` for the full path).

---

## 5. Verification summary

| Layer | What | Result |
|-------|------|--------|
| A — Static | tsc on touched files; geometry unit tests | clean; **13/13** |
| B — Backend | live write path (Stages 2/4/5/6) + cleanup | **15/15**, 0 orphans |
| C — On-device | UI / gestures / BLE walkthrough (C1–C6) | pending — see `docs/PHASE4_LAYER_C_CHECKLIST.md` |

Note: jest/ts-jest aren't installed in the dev shell, so Layer A was confirmed by transpiling
the real module with `tsc` and asserting via Node; the `.test.ts` runs under jest in CI.

---

## 6. Files touched

| File | Change |
|------|--------|
| `components/inspection/GridCanvas.tsx` | image background + shared projection |
| `components/inspection/FloorPlanImageUpload.tsx` | removed inline scale step; single Save |
| `app/tabs/sessions/flow.tsx` | unified routing; removed viewer shortcut |
| `components/inspection/FloorPlanViewer.tsx` | use shared geometry module |
| `lib/floorplanGeometry.ts` | **new** — pure projection math |
| `__tests__/floorplanGeometry.test.ts` | **new** — geometry tests |
| `scripts/phase4_backend_smoke.sh` | **new** — backend smoke (read-only default) |
| `docs/PHASE4_LAYER_C_CHECKLIST.md` | **new** — on-device checklist |

---

## 7. Preserved (no functionality/design lost)
- Both entry buttons (Take Photo / Library / Draw without image) remain.
- Manual path is behavior-identical to before.
- Auto-detect, new-zone creation, polygon tracing, multi-zone tabs, BLE/manual measurement —
  all unchanged.
- Supervisor "review the plan" need is now met by the image-backed Grid Analysis.

## 8. Spec-conformance gap closures (2026-06-04)

Two stages were flagged as partial against the canonical flow spec and then addressed:

- **Stage 3 — sub-regions within the main shape.** When drawing a zone, the largest
  already-drawn polygon is shown as a faint **backdrop** in the draw canvas
  (`FloorPlanImageUpload` `backdropPoints`, wired from `flow.tsx`), so zones are traced as
  sub-regions within the main floor-plan outline. No schema change. *Backdrop renders in
  blank-canvas (manual) mode where points share the px/CANVAS normalisation; zones remain
  independent rows (no hard containment enforcement).*
- **Stage 6 — measurement on the grid.** New read-only `FloorPlanReview` component renders the
  zone grid + placed elements at their `grid_*` positions with each element's captured value as
  an on-plan chip; tapping an element opens the measurement screen. Embedded as the element-list
  header in session detail (`[id].tsx`). *Values appear on the plan after capture (refreshed on
  screen focus); live-during-capture readout still happens on the per-element screen.*

## 9. Remaining / optional
- **Layer C** on-device walkthrough (C1–C6), now including the Stage 3 backdrop and Stage 6
  on-grid review.
- Optional: clean removal of the now-dead Stage-6 `FloorPlanViewer` branch in `flow.tsx`.
- Optional: hard containment validation for sub-region zones; live BLE readout overlaid on the
  plan during capture.
