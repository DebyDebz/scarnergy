import { supabase } from "./supabase";

export type OpeningType = "door" | "window";

export interface OpeningToSave {
  type: OpeningType;
  widthMm: number;
  heightMm: number;
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

export const OPENING_TYPE_LABEL: Record<OpeningType, string> = { window: "Window", door: "Door" };

export function clientUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Persists scanned/measured openings the same way the manual inspect flow does:
 * one `building_elements` row (transparant_deel) per opening, a linked `openings`
 * row, and width + height `measurements` rows tagged `ingestion_path: "mobile"`.
 *
 * Shared by the LiDAR (RoomPlan) and AR (ARKit) capture screens so both write
 * identical rows and the calc pipeline can't tell them apart.
 */
export async function saveOpenings(items: OpeningToSave[], ctx: SaveOpeningsContext): Promise<number> {
  const now = new Date().toISOString();
  let saved = 0;

  for (const item of items) {
    const label = `${OPENING_TYPE_LABEL[item.type]} (${ctx.source})`;

    const { data: element, error: elErr } = await supabase
      .from("building_elements")
      .insert({
        org_id: ctx.orgId,
        zone_id: ctx.zoneId,
        element_type: "transparant_deel",
        name: label,
        width_mm: item.widthMm,
        height_mm: item.heightMm,
        is_complete: true,
      })
      .select("id")
      .single();
    if (elErr) throw elErr;

    const { error: opErr } = await supabase.from("openings").insert({
      org_id: ctx.orgId,
      element_id: element.id,
      opening_type: item.type,
      width_mm: item.widthMm,
      height_mm: item.heightMm,
    });
    if (opErr) throw opErr;

    const base = {
      measured_at: now, org_id: ctx.orgId, session_id: ctx.sessionId, device_id: null,
      inspector_id: ctx.inspectorId, element_id: element.id, unit: "mm",
      is_anomaly: false, is_deleted: false, ingestion_path: "mobile",
    };
    const { error: mErr } = await supabase.from("measurements").insert([
      { ...base, id: clientUUID(), value_mm: item.widthMm, measurement_type: "width" },
      { ...base, id: clientUUID(), value_mm: item.heightMm, measurement_type: "height" },
    ]);
    if (mErr) throw mErr;

    saved += 1;
  }
  return saved;
}
