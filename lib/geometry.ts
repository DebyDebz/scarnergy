// Ray-casting algorithm: returns true if (px, py) is inside the polygon
// defined by `points` (pixel-space, not normalized).
export function isPointInPolygon(
  px: number,
  py: number,
  points: { x: number; y: number }[],
): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
