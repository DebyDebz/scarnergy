/**
 * Floor-plan auto-detection client.
 *
 * Sends a picked image to the AI server's OpenCV detector and returns a
 * normalised, best-effort detection of room boundary polygon(s) and elements
 * (walls/doors/windows). Results are *drafts* — the inspector reviews and edits
 * them in the existing wizard. Detection never blocks the manual flow: any
 * failure (server down, undecodable image, timeout) resolves to a friendly
 * error the caller can show before falling back to manual tracing.
 */

const AI_SERVER_URL = process.env.EXPO_PUBLIC_AI_SERVER_URL;
const DETECT_TIMEOUT_MS = 25000;

// ── Server response shapes (mirror ai_server/cv/floorplan.py) ────────────────
export interface DetectedPoint { x: number; y: number }

export interface DetectedElement {
  kind: 'wall' | 'door' | 'window';
  // Segment endpoints, normalised 0..1 (a polygon edge for walls; an opening
  // sub-segment on an edge for doors/windows).
  x1: number; y1: number; x2: number; y2: number;
}

export interface DetectedRoom {
  polygon: DetectedPoint[];
  elements: DetectedElement[];
}

export interface FloorPlanDetection {
  image_w: number;
  image_h: number;
  confidence: number;
  rooms: DetectedRoom[];
}

export type DetectMode = 'boundary' | 'full';

/** Thrown when detection could not run; caller should fall back to manual. */
export class DetectionUnavailableError extends Error {}

/**
 * Run auto-detection on a local image URI. Returns the parsed detection or
 * throws DetectionUnavailableError with a user-facing message.
 */
export async function detectFloorPlan(
  imageUri: string,
  opts: { mode?: DetectMode; mimeType?: string } = {},
): Promise<FloorPlanDetection> {
  if (!AI_SERVER_URL) {
    throw new DetectionUnavailableError(
      'Auto-detect is not configured (EXPO_PUBLIC_AI_SERVER_URL is unset).',
    );
  }
  const mode: DetectMode = opts.mode ?? 'full';
  const ext = imageUri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mime = opts.mimeType ?? (ext === 'png' ? 'image/png' : 'image/jpeg');

  const form = new FormData();
  // React Native FormData file shape
  form.append('file', { uri: imageUri, name: `floor_plan.${ext}`, type: mime } as any);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${AI_SERVER_URL}/floorplan/detect?mode=${mode}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch (e: any) {
    throw new DetectionUnavailableError(
      e?.name === 'AbortError'
        ? 'Auto-detect timed out. Trace the outline manually instead.'
        : 'Could not reach the detection service. Trace the outline manually.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new DetectionUnavailableError(
      `Auto-detect failed (${res.status}). Trace the outline manually.`,
    );
  }
  const data = (await res.json()) as FloorPlanDetection & { error?: string };
  if (!data || !Array.isArray(data.rooms)) {
    throw new DetectionUnavailableError('Auto-detect returned no usable result.');
  }
  return data;
}

// ── Hand-sketch door/window symbols (PaintCanvas tap-to-place) ────────────────
// Distinct from CV-detected elements: these come from an explicit tap by the
// inspector (kind is certain, not inferred from an ink gap), normalised 0..1 in
// the same canvas-relative frame as floor_plan_points / DetectedElement
// endpoints, so they merge into a room's elements without any extra transform.
export interface SketchSymbol {
  kind: 'door' | 'window';
  x: number; y: number;   // centre
  angle: number;          // degrees, 0 = horizontal
  length: number;         // normalised 0..1
}

/** Convert placed symbols into the same DetectedElement shape the CV pipeline
 * emits, so elementsToDrafts (and any CV-detected wall/opening elements) can be
 * merged with these directly. */
export function sketchSymbolsToElements(symbols: SketchSymbol[]): DetectedElement[] {
  return symbols.map(s => {
    const rad = (s.angle * Math.PI) / 180;
    const hx = (s.length / 2) * Math.cos(rad);
    const hy = (s.length / 2) * Math.sin(rad);
    return { kind: s.kind, x1: s.x - hx, y1: s.y - hy, x2: s.x + hx, y2: s.y + hy };
  });
}

// ── Mapping detected elements -> building_elements draft rows ─────────────────
// element_type enum: gevel (wall), transparant_deel (door/window — door vs window
// is distinguished by the `name` prefix, per ElementPlacer's dbRowToElementType).
export interface ElementDraft {
  org_id: string;
  zone_id: string;
  element_type: 'gevel' | 'transparant_deel';
  name: string;
  orientation_deg: number;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
  grid_rotation: number;
  sort_order: number;
  is_active: true;
  is_complete: false;
}

// Canvas geometry — must match ElementPlacer / FloorPlanReview.
const CANVAS = 300;

// On-canvas thickness (px) per element kind — matches the manual palette sizes.
// Stored normalised (px / CANVAS) so it renders to the same on-canvas thickness.
const THICKNESS: Record<DetectedElement['kind'], number> = { wall: 8, window: 10, door: 12 };

/**
 * Convert a detected room's elements into building_elements insert rows.
 *
 * grid_* are stored in the SAME normalised, image-relative frame as the room's
 * polygon (`floor_plan_points`): detected endpoints are already px/max(w,h), so
 * we keep them as-is and express each segment as the rotated rectangle the UI
 * expects (top-left, width=length, height=thickness, angle). The render side
 * (FloorPlanReview / ElementPlacer) projects grid_* through the image's
 * contain-fit offsets — the identical transform applied to the outline — so
 * walls land on the polygon edges and openings on the walls, on the photo, by
 * construction. Names are 1-indexed per kind ("Wall-01", "Door-01",
 * "Window-01"); the "Door"/"Window" prefix drives the UI mapping.
 */
export function elementsToDrafts(
  room: DetectedRoom,
  zoneId: string,
  orgId: string,
): ElementDraft[] {
  const round4 = (v: number) => parseFloat(v.toFixed(4));
  const minLen = 4 / CANVAS; // ~4px floor, in normalised units

  const counts = { wall: 0, door: 0, window: 0 };
  return room.elements.map((el, i) => {
    counts[el.kind] += 1;
    const n = String(counts[el.kind]).padStart(2, '0');
    const isWall = el.kind === 'wall';
    const label = isWall ? 'Wall' : el.kind === 'door' ? 'Door' : 'Window';

    // Endpoints already normalised image-relative (uniform px/max scale), so the
    // centre, length and angle are computed directly in that frame.
    const cx = (el.x1 + el.x2) / 2, cy = (el.y1 + el.y2) / 2;
    const length = Math.max(Math.hypot(el.x2 - el.x1, el.y2 - el.y1), minLen);
    const thick = THICKNESS[el.kind] / CANVAS;
    const angle = Math.round((Math.atan2(el.y2 - el.y1, el.x2 - el.x1) * 180) / Math.PI);

    return {
      org_id: orgId,
      zone_id: zoneId,
      element_type: isWall ? 'gevel' : 'transparant_deel',
      name: `${label}-${n}`,
      orientation_deg: ((angle % 360) + 360) % 360,
      // Top-left of the unrotated rect (renderer rotates around centre).
      grid_x: round4(cx - length / 2),
      grid_y: round4(cy - thick / 2),
      grid_w: round4(length),
      grid_h: round4(thick),
      grid_rotation: angle,
      sort_order: i,
      is_active: true,
      is_complete: false,
    };
  });
}
