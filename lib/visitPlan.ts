// "Before the visit" data for a new object (client flow, 2026-10-31):
// required — woning or utility, postcode + number, inspector, visit date/time;
// preferred — type and position, contact person, orientation; and the question
// whether standard parts should be created up front.

export type UseClass = "woning" | "utiliteit";

export const USE_CLASSES: { value: UseClass; label: string }[] = [
  { value: "woning",    label: "Woning (dwelling)" },
  { value: "utiliteit", label: "Utility building" },
];

// building_type enum values per use class, with the labels an inspector recognises.
export const BUILDING_TYPES_BY_CLASS: Record<UseClass, { value: string; label: string }[]> = {
  woning: [
    { value: "residential_single", label: "House (single-family)" },
    { value: "residential_multi",  label: "Multi-family building" },
    { value: "apartment",          label: "Apartment" },
  ],
  utiliteit: [
    { value: "office",     label: "Office" },
    { value: "retail",     label: "Shop / retail" },
    { value: "industrial", label: "Industrial" },
    { value: "mixed_use",  label: "Mixed use" },
    { value: "other",      label: "Other" },
  ],
};

export function useClassOf(buildingType: string): UseClass {
  return BUILDING_TYPES_BY_CLASS.woning.some(t => t.value === buildingType) ? "woning" : "utiliteit";
}

// "Type and position": where the unit sits relative to its neighbours. Decides
// which walls are exterior walls when standard parts are created.
export type Position =
  | "vrijstaand" | "twee_onder_een_kap" | "hoekwoning" | "tussenwoning"
  | "appartement_tussen" | "appartement_hoek" | "other";

export const POSITIONS: { value: Position; label: string }[] = [
  { value: "vrijstaand",         label: "Detached" },
  { value: "twee_onder_een_kap", label: "Semi-detached" },
  { value: "hoekwoning",         label: "End of terrace (corner)" },
  { value: "tussenwoning",       label: "Mid-terrace" },
  { value: "appartement_hoek",   label: "Apartment, corner" },
  { value: "appartement_tussen", label: "Apartment, in between" },
  { value: "other",              label: "Other / unknown" },
];

// Orientation = the compass direction the front facade faces (0 = north),
// the same degree convention the VABI export's <Orientatie> uses.
export const ORIENTATIONS: { value: string; label: string; deg: number }[] = [
  { value: "N",  label: "North",      deg: 0 },
  { value: "NE", label: "North-east", deg: 45 },
  { value: "E",  label: "East",       deg: 90 },
  { value: "SE", label: "South-east", deg: 135 },
  { value: "S",  label: "South",      deg: 180 },
  { value: "SW", label: "South-west", deg: 225 },
  { value: "W",  label: "West",       deg: 270 },
  { value: "NW", label: "North-west", deg: 315 },
];

export function orientationDeg(value: string | null | undefined): number | null {
  return ORIENTATIONS.find(o => o.value === value)?.deg ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Date + time as typed on site ("31-10-2026", "14:30") → Date, or null if invalid. */
export function parseVisitDateTime(date: string, time: string): Date | null {
  const d = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*$/.exec(date);
  const t = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(time);
  if (!d || !t) return null;
  const [day, month, year] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];
  if (hour > 23 || minute > 59) return null;
  const out = new Date(year, month - 1, day, hour, minute);
  // Reject roll-overs like 31-02.
  if (out.getFullYear() !== year || out.getMonth() !== month - 1 || out.getDate() !== day) return null;
  return out;
}

export function formatVisitDate(d: Date): string {
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function formatVisitTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface StandardPart {
  element_type: "gevel" | "vloer" | "dak";
  name: string;
  orientation_deg: number | null;
}

/**
 * The standard parts for a new object: its exterior walls, ground floor and
 * roof, ready to measure. Party walls are left out (mid-terrace: both sides;
 * semi-detached / corner: we don't know which side, so both are created and
 * the inspector deletes one). Apartments in between get no roof or floor, as
 * those usually adjoin other units.
 *
 * Wall orientation follows from the front facade: standing in front of the
 * building looking at it, the left facade faces front + 90°, the right
 * facade front − 90°.
 */
export function standardParts(position: Position | null, frontDeg: number | null): StandardPart[] {
  const at = (offset: number) => (frontDeg == null ? null : (frontDeg + offset + 360) % 360);
  const walls: StandardPart[] = [
    { element_type: "gevel", name: "Voorgevel",   orientation_deg: at(0) },
    { element_type: "gevel", name: "Achtergevel", orientation_deg: at(180) },
  ];
  if (position !== "tussenwoning" && position !== "appartement_tussen") {
    walls.push(
      { element_type: "gevel", name: "Linkergevel",  orientation_deg: at(90) },
      { element_type: "gevel", name: "Rechtergevel", orientation_deg: at(270) },
    );
  }
  if (position === "appartement_tussen" || position === "appartement_hoek") return walls;
  return [
    ...walls,
    { element_type: "vloer", name: "Begane grondvloer", orientation_deg: null },
    { element_type: "dak",   name: "Dak",               orientation_deg: null },
  ];
}
