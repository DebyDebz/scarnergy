/**
 * Pure floor-plan projection geometry — shared by the render-time components
 * (GridCanvas, FloorPlanViewer) so the outline is projected identically wherever
 * it is drawn. Extracted into a dependency-free module (no react-native / no
 * supabase) so the math can be unit-tested in isolation, mirroring the
 * hooks/bleDecoder pattern.
 *
 * Coordinate contract: floor_plan_points are stored normalised. For image-backed
 * zones they are image-relative (px / max(imageW, imageH)); for blank-canvas
 * zones they are an arbitrary normalised outline that is bbox-fit to the canvas.
 */

export interface Pt { x: number; y: number }
export interface Seg { x1: number; y1: number; x2: number; y2: number }
export interface GridRect { x: number; y: number; w: number; h: number }
export interface Offsets { offX: number; offY: number }

/**
 * Contain-fit letterbox offsets for an image of intrinsic `dims` shown
 * `resizeMode="contain"` inside a square canvas. This is the single source of
 * the px offset that both the outline projection and the element projection use,
 * so geometry authored against the image (outline, placed elements, grid clip)
 * all share one coordinate frame and stays aligned on the photo.
 */
export function imageOffsets(dims: { w: number; h: number }, canvas: number): Offsets {
  if (!dims.w || !dims.h) return { offX: 0, offY: 0 };
  const cs = canvas / Math.max(dims.w, dims.h);
  return { offX: (canvas - dims.w * cs) / 2, offY: (canvas - dims.h * cs) / 2 };
}

/**
 * Project an element's stored grid rect into canvas-space px. Element grid_*
 * live in the SAME normalised frame as floor_plan_points — image-relative when
 * the zone has an image (so they land on the photo), or a raw canvas fraction
 * for blank zones (offsets {0,0}). Width/height scale by `canvas`; position is
 * shifted by the contain-fit letterbox so an element sits exactly where its
 * outline does. With {0,0} offsets this reduces to the previous `grid_* * canvas`.
 */
export function projectGridRect(
  rect: GridRect,
  canvas: number,
  offsets: Offsets = { offX: 0, offY: 0 },
): { x: number; y: number; w: number; h: number } {
  return {
    x: offsets.offX + rect.x * canvas,
    y: offsets.offY + rect.y * canvas,
    w: rect.w * canvas,
    h: rect.h * canvas,
  };
}

/**
 * Real-world length (metres) of an element from its stored grid extent and the
 * zone's scale. `floor_plan_scale_m` is metres across the full canvas width and
 * `grid_w`/`grid_h` are fractions of that width, so length = extent * scaleM.
 * Returns null when either input is missing. Used to pre-fill / suggest element
 * measurements derived from the calibrated plan.
 */
export function gridLengthMeters(
  gridExtent: number | null | undefined,
  scaleM: number | null | undefined,
): number | null {
  if (gridExtent == null || scaleM == null || !isFinite(gridExtent) || !isFinite(scaleM)) return null;
  return gridExtent * scaleM;
}

/** Inverse of the position half of projectGridRect (canvas px → stored fraction). */
export function unprojectPoint(
  pt: Pt,
  canvas: number,
  offsets: Offsets = { offX: 0, offY: 0 },
): Pt {
  return { x: (pt.x - offsets.offX) / canvas, y: (pt.y - offsets.offY) / canvas };
}

/** Close a ring of points into edge segments (last point connects back to first). */
function toSegments(mapped: Pt[]): Seg[] {
  return mapped.map((p, i) => {
    const n = mapped[(i + 1) % mapped.length];
    return { x1: p.x, y1: p.y, x2: n.x, y2: n.y };
  });
}

/**
 * Image-anchored projection to canvas-space POINTS. Points are image-relative, so
 * mapping them through the SAME `resizeMode="contain"` transform as the displayed
 * image places the outline exactly on the room in the picture. Needs the image's
 * intrinsic size (learned from Image.onLoad). Returns [] when inputs insufficient.
 */
export function projectPointsOnImage(
  points: Pt[] | null | undefined,
  dims: { w: number; h: number },
  canvas: number,
): Pt[] {
  if (!points || points.length < 3 || !dims.w || !dims.h) return [];
  const { offX, offY } = imageOffsets(dims, canvas);
  return points.map(p => ({ x: offX + p.x * canvas, y: offY + p.y * canvas }));
}

/**
 * Bbox-fit projection to canvas-space POINTS (no background image). Fits the
 * outline's bounding box into the canvas inner area (canvas minus `padding` on
 * each side), preserving aspect ratio and centring. Returns [] when insufficient.
 */
export function fitPointsToInner(
  points: Pt[] | null | undefined,
  canvas: number,
  padding: number,
): Pt[] {
  if (!points || points.length < 3) return [];
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const inner = canvas - padding * 2;
  const rX = maxX - minX || 1, rY = maxY - minY || 1;
  const scale = Math.min(inner / rX, inner / rY);
  const offX  = padding + (inner - rX * scale) / 2;
  const offY  = padding + (inner - rY * scale) / 2;
  return points.map(p => ({ x: offX + (p.x - minX) * scale, y: offY + (p.y - minY) * scale }));
}

/**
 * Image-anchored projection. Returns the outline as edge segments. Thin wrapper
 * over projectPointsOnImage so points (for clip paths) and segments (for stroked
 * edges) stay in exact agreement.
 */
export function projectOnImage(
  points: Pt[] | null | undefined,
  dims: { w: number; h: number },
  canvas: number,
): Seg[] {
  return toSegments(projectPointsOnImage(points, dims, canvas));
}

/**
 * Bbox-fit projection. Returns the outline as edge segments (see projectOnImage).
 */
export function fitToInner(
  points: Pt[] | null | undefined,
  canvas: number,
  padding: number,
): Seg[] {
  return toSegments(fitPointsToInner(points, canvas, padding));
}
