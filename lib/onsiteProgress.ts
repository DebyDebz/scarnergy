// Progress through the on-site part of the client's flow (2026-10-31):
// facade photos → floor plan + rekenzones → heights/roof angles/floors →
// windows and walls with their photos → installations.
// Status only: the order is a guide, never enforced (Nils, 2026-10-05).

export type OnsiteStepKey = "facades" | "plan" | "dimensions" | "openings" | "installations";

export interface OnsiteInput {
  facadePhotoCount: number;
  zones: { floor_plan_points: unknown[] | null; floor_plan_image_url: string | null; rekenzone_id: string | null }[];
  rekenzoneCount: number;
  elements: {
    element_type: string;
    height_mm: number | null;
    length_mm: number | null;
    width_mm: number | null;
    tilt_deg: number | null;
    nokhoogte_m: number | null;
    is_complete: boolean;
    photo_urls: string[] | null;
  }[];
}

export interface OnsiteStep {
  key: OnsiteStepKey;
  title: string;
  status: string;
  done: boolean;
}

export const FACADE_PHOTO_TOTAL = 5; // four facades + entrance with house number

const hasPhoto = (e: { photo_urls: string[] | null }) => (e.photo_urls?.length ?? 0) > 0;

export function onsiteSteps(input: OnsiteInput): OnsiteStep[] {
  const { facadePhotoCount, zones, rekenzoneCount, elements } = input;

  const planned = zones.filter(z => (z.floor_plan_points?.length ?? 0) >= 3 || !!z.floor_plan_image_url).length;
  const zonesAssigned = zones.length > 0 && (rekenzoneCount === 0 || zones.every(z => !!z.rekenzone_id));

  // Heights of walls, angle (or ridge height) of roofs, floor sizes.
  const dimensional = elements.filter(e => ["gevel", "dak", "vloer"].includes(e.element_type));
  const measured = dimensional.filter(e => {
    if (e.element_type === "gevel") return e.height_mm != null;
    if (e.element_type === "dak") return e.tilt_deg != null || e.nokhoogte_m != null;
    return e.length_mm != null && e.width_mm != null;
  }).length;

  const shell = elements.filter(e => e.element_type === "gevel" || e.element_type === "transparant_deel");
  const windows = shell.filter(e => e.element_type === "transparant_deel").length;
  const shellDone = shell.filter(e => e.is_complete && hasPhoto(e)).length;

  const installations = elements.filter(e => e.element_type === "installatie");

  return [
    {
      key: "facades",
      title: "Facade photos",
      status: `${Math.min(facadePhotoCount, FACADE_PHOTO_TOTAL)} / ${FACADE_PHOTO_TOTAL} taken`,
      done: facadePhotoCount >= FACADE_PHOTO_TOTAL,
    },
    {
      key: "plan",
      title: "Floor plan + rekenzones",
      status: zones.length === 0
        ? "Not started"
        : `${planned} / ${zones.length} floor${zones.length === 1 ? "" : "s"} drawn · ${rekenzoneCount} rekenzone${rekenzoneCount === 1 ? "" : "s"}`,
      done: zones.length > 0 && planned === zones.length && zonesAssigned,
    },
    {
      key: "dimensions",
      title: "Wall heights, roof angles, floors",
      status: dimensional.length === 0 ? "No walls, roofs or floors yet" : `${measured} / ${dimensional.length} measured`,
      done: dimensional.length > 0 && measured === dimensional.length,
    },
    {
      key: "openings",
      title: "Windows + walls, with photos",
      status: shell.length === 0
        ? "None yet"
        : `${shellDone} / ${shell.length} complete with photo · ${windows} window${windows === 1 ? "" : "s"}/door${windows === 1 ? "" : "s"}`,
      done: windows > 0 && shellDone === shell.length,
    },
    {
      key: "installations",
      title: "Installations",
      status: installations.length === 0
        ? "If you find any, add them"
        : `${installations.filter(e => e.is_complete).length} / ${installations.length} complete`,
      // Optional step: only "done" once something was captured and finished.
      done: installations.length > 0 && installations.every(e => e.is_complete),
    },
  ];
}
