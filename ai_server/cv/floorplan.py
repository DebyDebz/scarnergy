"""
Floor-plan detection — classical computer vision (OpenCV).

Detects, from a floor-plan image, a best-effort:
  - zone boundary polygon(s) / room segmentation
  - elements: walls, doors, windows

The output is intentionally *approximate*. Inputs range from clean line
drawings to scans, photos of paper plans, and hand-drawn sketches, so the
pipeline favours robustness and graceful degradation over precision: every
stage that finds nothing returns empties rather than raising, and the caller
treats results as editable drafts.

Coordinates are normalised to 0..1 using a single uniform scale (divide both
axes by max(w, h)) so the aspect ratio is preserved — matching the app's
convention where stored points are re-fitted by their bounding box.

These are pure functions (no FastAPI) so they can be unit-tested directly:
    python -m ai_server.cv.floorplan path/to/plan.jpg
"""

from __future__ import annotations

from typing import Optional, TypedDict
import numpy as np
import cv2


# ── Output shapes ────────────────────────────────────────────────────────────
class Point(TypedDict):
    x: float
    y: float


class Element(TypedDict):
    kind: str          # "wall" | "door" | "window"
    # Segment endpoints, normalised 0..1 (uniform scale, aspect-preserving).
    # Walls are a polygon edge; doors/windows are an opening sub-segment on an edge.
    x1: float
    y1: float
    x2: float
    y2: float


class Room(TypedDict):
    polygon: list[Point]
    elements: list[Element]


class DetectResult(TypedDict):
    image_w: int
    image_h: int
    confidence: float
    rooms: list[Room]


# ── Tunables ─────────────────────────────────────────────────────────────────
MAX_DIM          = 1600    # downscale very large images before processing
MIN_ROOM_FRAC    = 0.01    # ignore regions smaller than 1% of the image area
MIN_BOUNDARY_FRAC = 0.05   # boundary contour must cover at least 5% of the image
APPROX_EPS_FRAC  = 0.01    # room polygon simplification tolerance (fraction of perimeter)
BOUNDARY_EPS_FRAC = 0.03   # boundary simplification — looser, collapses to real corners
EDGE_MIN_LEN_FRAC = 0.03   # ignore polygon edges shorter than this (fraction of max dim)
OPENING_MIN_FRAC  = 0.015  # a wall-ink gap shorter than this (fraction of max dim) is ignored
DOOR_MAX_FRAC     = 0.06   # gaps up to this (fraction of max dim) are doors; wider -> windows
WINDOW_MAX_FRAC   = 0.30   # gaps wider than this are treated as missing wall, not an opening
INK_BAND_FRAC     = 0.012  # half-thickness of the band sampled perpendicular to an edge
MAX_OPENINGS_EDGE = 4      # cap openings per edge to keep drafts manageable


# ── Helpers ──────────────────────────────────────────────────────────────────
def _decode(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    return img


def _downscale(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    longest = max(h, w)
    if longest <= MAX_DIM:
        return img
    s = MAX_DIM / longest
    return cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)


def _order_quad(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as [top-left, top-right, bottom-right, bottom-left]."""
    pts = pts.reshape(4, 2).astype("float32")
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([
        pts[np.argmin(s)],   # top-left  (smallest x+y)
        pts[np.argmin(d)],   # top-right (smallest x-y)
        pts[np.argmax(s)],   # bottom-right
        pts[np.argmax(d)],   # bottom-left
    ], dtype="float32")


def _maybe_deskew(gray: np.ndarray) -> np.ndarray:
    """If a strong 4-corner 'page' contour dominates the frame, warp it flat.

    Helps photos of paper plans. Skipped when no clear quad covers most of the
    frame (clean exports / scans), so it never distorts already-flat inputs.
    """
    h, w = gray.shape
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return gray
    biggest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(biggest) < 0.5 * w * h:
        return gray
    peri = cv2.arcLength(biggest, True)
    quad = cv2.approxPolyDP(biggest, 0.02 * peri, True)
    if len(quad) != 4:
        return gray
    src = _order_quad(quad)
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype="float32")
    m = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(gray, m, (w, h))


def _binarise(gray: np.ndarray) -> np.ndarray:
    """Return a binary image where walls/lines are white (255) on black.

    CLAHE + adaptive threshold handles uneven lighting and shadows from photos;
    works on scans and clean drawings too.
    """
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    eq = clahe.apply(gray)
    eq = cv2.medianBlur(eq, 3)
    # Lines are dark -> THRESH_BINARY_INV makes them white.
    binary = cv2.adaptiveThreshold(
        eq, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 10
    )
    # Close small gaps so wall runs are connected.
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
    return binary


def _normaliser(w: int, h: int):
    scale = float(max(w, h))
    return lambda x, y: (round(x / scale, 4), round(y / scale, 4))


# ── Stage: boundary ──────────────────────────────────────────────────────────
def _largest_polygon(binary: np.ndarray) -> Optional[np.ndarray]:
    h, w = binary.shape
    # Close gaps so the outer wall outline becomes one solid blob, then take its
    # convex outer contour. A light close (not a heavy dilate) avoids the jagged
    # double-edge that adaptive threshold leaves around thick wall strokes.
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Primary: largest external contour, when it's a sensible size and not a
    # frame-filling "leak". A larger epsilon collapses noisy edges to the real
    # corners (a rectangular room -> ~4 points) while preserving concavity.
    if contours:
        biggest = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(biggest)
        if MIN_BOUNDARY_FRAC * w * h <= area <= 0.95 * w * h:
            peri = cv2.arcLength(biggest, True)
            poly = cv2.approxPolyDP(biggest, BOUNDARY_EPS_FRAC * peri, True)
            if len(poly) >= 3:
                return poly.reshape(-1, 2)

    # Fallback: when the outer wall has a large opening (window/door) the contour
    # leaks or collapses to a thin "C". The convex hull of all wall ink is robust
    # to such gaps and still yields a clean enclosing polygon.
    pts = cv2.findNonZero(closed)
    if pts is not None and len(pts) > 10:
        hull = cv2.convexHull(pts)
        if cv2.contourArea(hull) >= MIN_BOUNDARY_FRAC * w * h:
            peri = cv2.arcLength(hull, True)
            poly = cv2.approxPolyDP(hull, BOUNDARY_EPS_FRAC * peri, True)
            if len(poly) >= 3:
                return poly.reshape(-1, 2)
    return None


# ── Stage: rooms ─────────────────────────────────────────────────────────────
def _segment_rooms(binary: np.ndarray) -> list[np.ndarray]:
    """Split interior space into room polygons via connected components.

    Walls are white in `binary`; interior space is the black background. We
    label connected black regions, drop the outside-the-building region and
    tiny slivers, and return one simplified polygon per remaining region.
    """
    h, w = binary.shape
    # Bridge door/window gaps in walls so adjacent rooms separate into distinct
    # components. Kernel scales with image size to span a typical doorway; kept
    # modest so it doesn't swallow narrow rooms.
    k = max(3, int(round(0.05 * max(w, h))) | 1)  # odd kernel ~5% of max dim — spans a doorway
    walls = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8), iterations=2)
    walls = cv2.dilate(walls, np.ones((3, 3), np.uint8), iterations=1)
    interior = cv2.bitwise_not(walls)  # rooms become white

    num, labels, stats, _ = cv2.connectedComponentsWithStats(interior, connectivity=4)
    polygons: list[np.ndarray] = []
    img_area = w * h
    for i in range(1, num):  # 0 is background of `interior` (i.e. the walls)
        area = stats[i, cv2.CC_STAT_AREA]
        if area < MIN_ROOM_FRAC * img_area:
            continue
        # Skip the region that touches all four borders by a wide margin — that's
        # the space *outside* the building, not a room.
        x, y, bw, bh = stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP], \
            stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
        if bw > 0.97 * w and bh > 0.97 * h:
            continue
        mask = (labels == i).astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        c = max(contours, key=cv2.contourArea)
        peri = cv2.arcLength(c, True)
        poly = cv2.approxPolyDP(c, APPROX_EPS_FRAC * peri, True).reshape(-1, 2)
        if len(poly) >= 3:
            polygons.append(poly)
    return polygons


# ── Stage: elements (derived from each room's polygon) ───────────────────────
def _ink_coverage(binary: np.ndarray, a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    """Sample wall-ink presence along edge A→B.

    Walks N points from A to B and, at each, checks a short perpendicular band
    (±t px) for any wall ink. Returns a boolean array: True where the wall is
    solid, False where it's a gap (an opening). Robust to the polygon edge not
    sitting exactly on the wall stroke.
    """
    h, w = binary.shape
    length = float(np.hypot(*(b - a)))
    n = max(2, int(length))
    ts = np.linspace(0.0, 1.0, n)
    pts = a[None, :] + ts[:, None] * (b - a)[None, :]
    # unit perpendicular
    d = b - a
    ln = np.hypot(*d) or 1.0
    perp = np.array([-d[1], d[0]]) / ln
    offsets = np.linspace(-t, t, max(3, int(t) * 2 + 1))
    solid = np.zeros(n, dtype=bool)
    for o in offsets:
        sp = pts + perp[None, :] * o
        xs = np.clip(sp[:, 0].round().astype(int), 0, w - 1)
        ys = np.clip(sp[:, 1].round().astype(int), 0, h - 1)
        solid |= binary[ys, xs] > 0
    return solid


def _room_elements(binary: np.ndarray, poly_px: np.ndarray, norm) -> list[Element]:
    """Derive wall + opening elements from a room polygon.

    Walls are the polygon edges (so they align with the outline exactly).
    Doors/windows are gaps in the wall ink found by sampling along each edge.
    Everything is returned as normalised segment endpoints.
    """
    h, w = binary.shape
    maxd = float(max(w, h))
    edge_min = EDGE_MIN_LEN_FRAC * maxd
    band = max(2.0, INK_BAND_FRAC * maxd)
    elements: list[Element] = []
    n = len(poly_px)

    def seg(kind: str, p1: np.ndarray, p2: np.ndarray) -> Element:
        x1, y1 = norm(float(p1[0]), float(p1[1]))
        x2, y2 = norm(float(p2[0]), float(p2[1]))
        return Element(kind=kind, x1=x1, y1=y1, x2=x2, y2=y2)

    for i in range(n):
        a = poly_px[i].astype(np.float64)
        b = poly_px[(i + 1) % n].astype(np.float64)
        length = float(np.hypot(*(b - a)))
        if length < edge_min:
            continue
        # Wall = the whole edge.
        elements.append(seg("wall", a, b))

        # Openings = contiguous gaps (no ink) along the edge.
        solid = _ink_coverage(binary, a, b, band)
        m = len(solid)
        openings = 0
        j = 0
        while j < m and openings < MAX_OPENINGS_EDGE:
            if not solid[j]:
                k = j
                while k < m and not solid[k]:
                    k += 1
                gap_len = (k - j) / m * length
                # ignore the polygon's own corner gaps (very short) and full
                # missing walls (very long, likely a detection artefact)
                if OPENING_MIN_FRAC * maxd <= gap_len <= WINDOW_MAX_FRAC * maxd:
                    t0, t1 = j / m, k / m
                    p1 = a + (b - a) * t0
                    p2 = a + (b - a) * t1
                    kind = "door" if gap_len <= DOOR_MAX_FRAC * maxd else "window"
                    elements.append(seg(kind, p1, p2))
                    openings += 1
                j = k
            else:
                j += 1
    return elements


# ── Public entry point ───────────────────────────────────────────────────────
def detect(image_bytes: bytes, mode: str = "full") -> DetectResult:
    """Run the detection pipeline. `mode` is "boundary" or "full"."""
    img = _downscale(_decode(image_bytes))
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = _maybe_deskew(gray)
    binary = _binarise(gray)
    norm = _normaliser(w, h)

    rooms: list[Room] = []

    if mode == "boundary":
        poly = _largest_polygon(binary)
        if poly is not None:
            rooms.append(Room(
                polygon=[Point(x=norm(px, py)[0], y=norm(px, py)[1]) for px, py in poly],
                elements=[],
            ))
        confidence = 0.6 if rooms else 0.0
        return DetectResult(image_w=w, image_h=h, confidence=confidence, rooms=rooms)

    # full mode: segment rooms, detect elements per room (fall back to boundary).
    room_polys = _segment_rooms(binary)
    if not room_polys:
        poly = _largest_polygon(binary)
        if poly is not None:
            room_polys = [poly]

    # Elements are derived per room from its own polygon (walls = edges, openings
    # = ink gaps along edges), so they align with the outline by construction and
    # don't pick up grid/text noise.
    for poly in room_polys:
        rooms.append(Room(
            polygon=[Point(x=norm(px, py)[0], y=norm(px, py)[1]) for px, py in poly],
            elements=_room_elements(binary, poly, norm),
        ))

    # Coarse confidence: more rooms with clean polygons -> higher.
    confidence = 0.0
    if rooms:
        avg_pts = np.mean([len(r["polygon"]) for r in rooms])
        confidence = round(min(0.9, 0.4 + 0.1 * len(rooms) - max(0, (avg_pts - 8)) * 0.02), 2)
    return DetectResult(image_w=w, image_h=h, confidence=confidence, rooms=rooms)


# ── CLI for quick local testing ──────────────────────────────────────────────
if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("usage: python -m ai_server.cv.floorplan <image> [boundary|full]")
        raise SystemExit(2)
    path = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "full"
    with open(path, "rb") as f:
        data = f.read()
    result = detect(data, mode)
    summary = {
        "image_w": result["image_w"],
        "image_h": result["image_h"],
        "confidence": result["confidence"],
        "rooms": len(result["rooms"]),
        "elements_per_room": [len(r["elements"]) for r in result["rooms"]],
    }
    print(json.dumps(summary, indent=2))
