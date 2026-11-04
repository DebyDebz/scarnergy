/**
 * Best-effort export of a building's current zone/gevel/opening dimensions to
 * AppSheet, IF that building was originally sourced from AppSheet
 * (buildings.appsheet_object_id set — see the "materialize" step in
 * tabs/buildings.tsx). Supabase is always the write of record; this never
 * blocks or reverts a caller's own save on failure.
 *
 * Extracted from app/tabs/sessions/[id].tsx (session-close sync) so any save
 * flow that touches zones for an AppSheet-linked building — e.g. the floor
 * plan draw/save screen — can push the same update, instead of only
 * happening at session close.
 */
import { Alert } from "react-native";
import { supabase, Zone, BuildingElement, BuildingFacadePhoto } from "./supabase";
import { pushSessionResultsToAppsheet } from "./appsheetProxy";

export type AppsheetSyncSummary =
  | { linked: false }
  | { linked: true; total: number; added: number; edited: number; skipped: number; failed: number }
  | { linked: true; error: string };

export async function syncToAppsheetIfLinked(
  buildingId: string,
  sessionNotes?: string | null,
): Promise<AppsheetSyncSummary> {
  const buildingRes = await (supabase.from("buildings") as any)
    .select("appsheet_object_id")
    .eq("id", buildingId)
    .maybeSingle();
  if (!buildingRes.data?.appsheet_object_id) return { linked: false };

  try {
    const zonesRes = await supabase.from("zones").select("*").eq("building_id", buildingId).eq("is_active", true);
    const zoneIds = (zonesRes.data ?? []).map((z: Zone) => z.id);
    const elementsRes = zoneIds.length
      ? await supabase.from("building_elements").select("*").in("zone_id", zoneIds).eq("is_active", true)
      : { data: [] };
    const elementIds = Array.from(new Set((elementsRes.data ?? []).map((e: BuildingElement) => e.id)));
    const openingsRes = elementIds.length
      ? await supabase.from("openings").select("*").in("element_id", elementIds).eq("is_active", true)
      : { data: [] };
    const openings = openingsRes.data ?? [];

    const facadePhotosRes = await supabase
      .from("building_facade_photos").select("direction, photo_url").eq("building_id", buildingId);
    const facadePhotos = ((facadePhotosRes.data ?? []) as Pick<BuildingFacadePhoto, "direction" | "photo_url">[])
      .map(p => ({ direction: p.direction, photo_url: p.photo_url }));

    const results = await pushSessionResultsToAppsheet({
      buildingId,
      zones: zonesRes.data ?? [],
      elements: elementsRes.data ?? [],
      openings,
      facadePhotos,
      sessionNotes,
    });
    const failed = results.filter(r => r.status === "failed");
    if (failed.length) {
      console.warn("[AppSheet sync] some rows failed:", failed);
    }
    return {
      linked: true,
      total: results.length,
      added: results.filter(r => r.status === "added").length,
      edited: results.filter(r => r.status === "edited").length,
      skipped: results.filter(r => r.status === "skipped").length,
      failed: failed.length,
    };
  } catch (e: any) {
    console.warn("[AppSheet sync] export failed:", e.message);
    Alert.alert("Saved locally", "Your session is saved, but syncing results to AppSheet failed. You can retry later.");
    return { linked: true, error: e.message as string };
  }
}
