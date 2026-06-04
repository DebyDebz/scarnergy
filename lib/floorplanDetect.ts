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

// Canvas geometry — must match ElementPlacer / FloorPlanViewer.
const CANVAS = 300;
const PADDING = 12;
const INNER = CANVAS - PADDING * 2;

// On-canvas thickness (px) per element kind — matches the manual palette sizes.
const THICKNESS: Record<DetectedElement['kind'], number> = { wall: 8, window: 10, door: 12 };

/**
 * Convert a detected room's elements into building_elements insert rows.
 *
 * ElementPlacer renders the boundary polygon re-fit to the canvas (bbox -> INNER,
 * centred via `fitLines`) and renders elements at `grid_* * CANVAS` rotated around
 * their centre. Detected elements are segment endpoints in the same normalised
 * space as the polygon, so we apply the *same* fit transform to both endpoints,
 * then express the segment as the rotated rectangle ElementPlacer expects
 * (centre, length, angle). Walls land on the polygon edges and openings on the
 * walls — aligned by construction. Names are 1-indexed per kind ("Wall-01",
 * "Door-01", "Window-01"); the "Door"/"Window" prefix drives the UI mapping.
 */
export function elementsToDrafts(
  room: DetectedRoom,
  zoneId: string,
  orgId: string,
): ElementDraft[] {
  const xs = room.polygon.map(p => p.x);
  const ys = room.polygon.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rX = maxX - minX || 1, rY = maxY - minY || 1;
  const scale = Math.min(INNER / rX, INNER / rY);
  const offX = PADDING + (INNER - rX * scale) / 2;
  const offY = PADDING + (INNER - rY * scale) / 2;
  const fit = (x: number, y: number) => ({
    x: offX + (x - minX) * scale,
    y: offY + (y - minY) * scale,
  });
  const round4 = (v: number) => parseFloat(v.toFixed(4));

  const counts = { wall: 0, door: 0, window: 0 };
  return room.elements.map((el, i) => {
    counts[el.kind] += 1;
    const n = String(counts[el.kind]).padStart(2, '0');
    const isWall = el.kind === 'wall';
    const label = isWall ? 'Wall' : el.kind === 'door' ? 'Door' : 'Window';

    const a = fit(el.x1, el.y1);
    const b = fit(el.x2, el.y2);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const length = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 4);
    const thick = THICKNESS[el.kind];
    const angle = Math.round((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);

    return {
      org_id: orgId,
      zone_id: zoneId,
      element_type: isWall ? 'gevel' : 'transparant_deel',
      name: `${label}-${n}`,
      orientation_deg: ((angle % 360) + 360) % 360,
      // Top-left of the unrotated rect (ElementPlacer rotates around centre).
      grid_x: round4((cx - length / 2) / CANVAS),
      grid_y: round4((cy - thick / 2) / CANVAS),
      grid_w: round4(length / CANVAS),
      grid_h: round4(thick / CANVAS),
      grid_rotation: angle,
      sort_order: i,
      is_active: true,
      is_complete: false,
    };
  });
}
