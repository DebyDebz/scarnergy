/**
 * Display labels for building element types.
 *
 * The enum VALUES stored in the database stay Dutch (`gevel`, `dak`, …) so the
 * backend and the VABI export are unaffected. These are the English labels shown
 * to the user wherever an element type is rendered (badges, list rows, headers).
 *
 * Use `elementTypeLabel()` rather than reading the map directly so unknown /
 * future enum values fall back gracefully to the raw value.
 */
export const TYPE_LABELS: Record<string, string> = {
  // Dutch schema enum values
  gevel: "Wall",
  dak: "Roof",
  dakkapel: "Dormer",
  vloer: "Floor",
  transparant_deel: "Window/Door",
  installatie: "Installation",
  // English fallbacks
  wall: "Wall",
  floor: "Floor",
  ceiling: "Ceiling",
  roof: "Roof",
  window: "Window",
  door: "Door",
};

/** English display label for an element type, falling back to the raw value. */
export function elementTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}
