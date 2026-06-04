# Phase 4 — Layer C: On-Device Walkthrough

The unified floor-plan flow (image upload + manual draw share one pipeline) is
verified statically (Layer A) and against the live backend (Layer B). Layer C is
the only part that needs a real device: UI rendering, gestures, and BLE.

## Setup
- Run a **dev build** (image picker needs native modules — *not* Expo Go):
  ```bash
  npm start        # Expo on :8085, auto-detects dev IP
  ```
- After each scenario, confirm the rows it produced with the read-only smoke:
  ```bash
  bash scripts/phase4_backend_smoke.sh        # read-only, no JWT needed
  ```

## Unified flow (target)
Stage 2 Create → 3 Zones → 4 Grid → 5 Place → 6 Measure — identical for both
entry modes; the only difference is whether a background image is shown.

---

## C1 — Manual mode (regression: must behave as before)
- [ ] Start inspection → **Draw without image**
- [ ] Trace a polygon; first point closes the shape
- [ ] **Save →** (no scale step appears)
- [ ] Zone Manager → Continue
- [ ] Grid Analysis: **blank grid**, bbox-fit outline, enter width → Confirm
- [ ] Element Placer: drop wall/door/window, snap to grid
- [ ] Measure an element (BLE or manual entry) → save
- [ ] ✅ Behaves the same as before this work

## C2 — Image mode (the new unified path)
- [ ] Start → **Take Photo** / **Choose from Library** (use `img/IMG_*.jpeg`)
- [ ] Trace the outline on the photo
- [ ] **Save →** — confirm **no inline scale screen** (was step 3, now removed)
- [ ] Zone Manager → Continue
- [ ] Grid Analysis: **photo shown behind the outline, correctly aligned**; grid + scale labels on top; enter width → Confirm
- [ ] Place elements → Measure
- [ ] ✅ Same stage sequence as C1; only difference is the image background

## C2b — Stage 3 sub-region backdrop
- [ ] In a building with **one** zone already drawn, add a **second** zone and tap Draw
- [ ] The first (largest) zone's outline shows as a **faint dashed backdrop** on the draw canvas
- [ ] Trace the new zone *inside* that backdrop → it reads as a sub-region of the main shape
- [ ] ✅ Backdrop appears in blank-canvas (manual) mode; absent when tracing on an uploaded image (expected)

## C6b — Stage 6 on-grid measurement (Plan view)
- [ ] Open a session whose zone has placed elements → session detail shows the **Floor Plan** card at the top of the element list
- [ ] Elements render at their grid positions; image-upload zones show the photo behind them
- [ ] Tap an element **on the plan** → measurement screen opens for that element
- [ ] Capture a value (BLE or manual) → return → the value appears as an **on-plan chip** next to that element, border turns green when complete
- [ ] "Measured: n/total" + grid-cell scale show below the plan
- [ ] ✅ Captured measurements display on the grid next to their element

## C3 — Auto-detect
- [ ] Upload image → **✨ Auto-detect outline**
- [ ] Review auto-created zone(s) + draft elements
- [ ] Grid → Place → Measure
- [ ] ✅ Detected zones pass through Grid like everyone else

## C4 — Mixed building
- [ ] One manual zone + one image zone in the same building
- [ ] Grid Analysis shows both as tabs; manual = blank grid, image = photo-backed
- [ ] ✅ Both render correctly, no cross-contamination

## C5 — Resume
- [ ] Kill the app mid-flow at Stage 2, 3, 4, 5 (separate runs)
- [ ] Reopen → lands on the correct stage for **both** modes
- [ ] ✅ No Stage-6 "View Floor Plan" detour (shortcut removed); image zones resume through Grid like manual ones

## C6 — Error paths
- [ ] AI server unreachable → friendly fallback to manual tracing (no crash)
- [ ] Network drop mid-upload → upload-failed alert, flow does **not** falsely advance
- [ ] ✅ Errors surface clearly

---

## Row verification (after device runs)
```bash
bash scripts/phase4_backend_smoke.sh   # confirms columns/bucket/endpoint live
```
Per real zone created on-device, expect:
- `zones.floor_plan_points` set (both modes)
- `zones.floor_plan_image_url` set (image mode only), object present in `floor-plans` bucket
- `zones.floor_plan_scale_m` set by GridCanvas (both modes)
- `building_elements` rows with `grid_*` populated
- `measurements` rows linked to the element + session

## Exit criteria
- C1 identical to pre-change behavior
- C2–C6 pass
- Spot-checked DB rows match the table above
