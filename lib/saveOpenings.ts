import { supabase } from "./supabase";

export type OpeningType = "door" | "window" | "wall";

export interface OpeningToSave {
  type: OpeningType;
  /** For a wall this is its length along the room. */
  widthMm: number;
  heightMm: number;
  /** True when the inspector overwrote the detected dimensions with GLM laser readings. */
  confirmedByLaser?: boolean;
}

/** Where the dimensions came from — appended to the element name so it's auditable later. */
export type OpeningSource = "LiDAR" | "AR";

export interface SaveOpeningsContext {
  sessionId: string;
  zoneId: string;
  orgId: string;
  inspectorId: string;
  source: OpeningSource;
}

export const OPENING_TYPE_LABEL: Record<OpeningType, string> = { window: "Window", door: "Door", wall: "Wall" };

export function clientUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Whether a captured item's dimensions are within the calc owner's 3 % maximum
 * variation: LiDAR (~1 %) and laser-confirmed values are; camera-only AR
 * (~2–5 %) is not. Items outside it are saved as NOT complete so they surface
 * as still needing a laser measurement in the inspect flow.
 */
export function meetsTolerance(item: OpeningToSave, source: OpeningSource): boolean {
  return source === "LiDAR" || !!item.confirmedByLaser;
}

/**
 * Persists scanned/measured surfaces the same way the manual inspect flow does.
 *   - door/window: a `building_elements` row (transparant_deel), a linked
 *     `openings` row, and width + height `measurements`
 *   - wall: a `building_elements` row (gevel, length + height) and length +
 *     height `measurements`
 * All tagged `ingestion_path: "mobile"`. Shared by the LiDAR (RoomPlan) and AR
 * (ARKit) capture screens so both write identical rows.
 */
export async function saveOpenings(items: OpeningToSave[], ctx: SaveOpeningsContext): Promise<number> {
  const now = new Date().toISOString();
  let saved = 0;
  let wallIndex = 0;

  for (const item of items) {
    // Provenance lives in the name so the calc owner can later tell a raw
    // RoomPlan/ARKit estimate from one the inspector confirmed with the laser.
    const provenance = item.confirmedByLaser ? `${ctx.source} · laser` : ctx.source;
    const isWall = item.type === "wall";
    const label = isWall
      ? `Wall ${++wallIndex} (${provenance})`
      : `${OPENING_TYPE_LABEL[item.type]} (${provenance})`;
    const complete = meetsTolerance(item, ctx.source);

    const { data: element, error: elErr } = await supabase
      .from("building_elements")
      .insert(isWall
        ? {
            org_id: ctx.orgId, zone_id: ctx.zoneId, element_type: "gevel", name: label,
            length_mm: item.widthMm, height_mm: item.heightMm, is_complete: complete,
          }
        : {
            org_id: ctx.orgId, zone_id: ctx.zoneId, element_type: "transparant_deel", name: label,
            width_mm: item.widthMm, height_mm: item.heightMm, is_complete: complete,
          })
      .select("id")
      .single();
    if (elErr) throw elErr;

    if (!isWall) {
      const { error: opErr } = await supabase.from("openings").insert({
        org_id: ctx.orgId,
        element_id: element.id,
        opening_type: item.type,
        width_mm: item.widthMm,
        height_mm: item.heightMm,
      });
      if (opErr) throw opErr;
    }

    const base = {
      measured_at: now, org_id: ctx.orgId, session_id: ctx.sessionId, device_id: null,
      inspector_id: ctx.inspectorId, element_id: element.id, unit: "mm",
      is_anomaly: false, is_deleted: false, ingestion_path: "mobile",
    };
    const { error: mErr } = await supabase.from("measurements").insert([
      { ...base, id: clientUUID(), value_mm: item.widthMm, measurement_type: isWall ? "length" : "width" },
      { ...base, id: clientUUID(), value_mm: item.heightMm, measurement_type: "height" },
    ]);
    if (mErr) throw mErr;

    saved += 1;
  }
  return saved;
}
