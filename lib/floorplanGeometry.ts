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
  const cs = canvas / Math.max(dims.w, dims.h);
  const offX = (canvas - dims.w * cs) / 2;
  const offY = (canvas - dims.h * cs) / 2;
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
