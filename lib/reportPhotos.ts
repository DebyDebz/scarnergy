import { supabase } from "./supabase";
import type { ReportPhoto } from "./sessionReport";

// Facade photos inlined as data URIs for the PDF report: expo-print renders
// offline HTML, so signed URLs alone may not load before the page is printed.

const FACADE_LABELS: Record<string, string> = {
  voor: "Front facade", achter: "Rear facade", links: "Left facade", rechts: "Right facade",
  entree: "Entrance + house number",
};
const ORDER = ["voor", "achter", "links", "rechts", "entree"];

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Best effort: a photo that can't be fetched is left out, never fails the report. */
export async function loadFacadePhotosForReport(buildingId: string): Promise<ReportPhoto[]> {
  const { data } = await (supabase.from("building_facade_photos") as any)
    .select("direction, photo_url")
    .eq("building_id", buildingId);
  const rows = ((data ?? []) as { direction: string; photo_url: string }[])
    .sort((a, b) => ORDER.indexOf(a.direction) - ORDER.indexOf(b.direction));

  const out = await Promise.all(rows.map(async (r): Promise<ReportPhoto | null> => {
    try {
      const { data: signed } = await supabase.storage.from("facade-photos").createSignedUrl(r.photo_url, 600);
      if (!signed?.signedUrl) return null;
      const res = await fetch(signed.signedUrl);
      if (!res.ok) return null;
      return { label: FACADE_LABELS[r.direction] ?? r.direction, src: await blobToDataUri(await res.blob()) };
    } catch {
      return null;
    }
  }));
  return out.filter((p): p is ReportPhoto => p !== null);
}
