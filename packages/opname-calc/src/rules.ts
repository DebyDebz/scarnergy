/**
 * Opname rules supplied by the calc owner (2026-09-24), per ISSO 82.1 / 75.1.
 * Pure functions so mobile and web apply them identically.
 */

/** Wall "Adjacent to" values that sit on the thermal envelope boundary. */
export const ENVELOPE_BOUNDARY_ADJACENCIES = ['Buitenlucht', 'Aangrenzende onverwarmde ruimte'] as const;

export interface PerimeterWall {
  length_mm: number | null | undefined;
  /** gevel "Adjacent to" (building_elements.description) */
  description: string | null | undefined;
}

/**
 * Floor perimeter (m): the internal circumference of the floor where it adjoins
 * outside air or an unheated space outside the thermal envelope. Applies to
 * ground floors and basement floors (floor_level <= 0) that are part of the
 * calculation zone. Computed as the sum of the zone's wall lengths whose
 * adjacency is on the envelope boundary. Returns null when the floor level
 * doesn't qualify or no qualifying wall has a length yet.
 */
export function floorPerimeterM(walls: PerimeterWall[], floorLevel: number | null | undefined): number | null {
  if (floorLevel == null || floorLevel > 0) return null;
  const qualifying = walls.filter(w =>
    w.length_mm != null && w.length_mm > 0 &&
    (ENVELOPE_BOUNDARY_ADJACENCIES as readonly string[]).includes(w.description ?? ''));
  if (qualifying.length === 0) return null;
  return Math.round(qualifying.reduce((s, w) => s + (w.length_mm as number), 0)) / 1000;
}

/**
 * Door with glass panel: below 65 % glass it is split into a door and a
 * window (the glass panel); at 65 % or more the whole element is a window.
 * The calc owner phrased the boundary as "less than 65 % → split, more than
 * 65 % → window"; exactly 65 % is treated as a window.
 */
export const GLAZED_DOOR_WINDOW_RATIO = 0.65;

export type GlazedDoorClass = 'split' | 'window';

export function glassRatio(
  doorWidthMm: number, doorHeightMm: number, glassWidthMm: number, glassHeightMm: number,
): number | null {
  if (!(doorWidthMm > 0 && doorHeightMm > 0 && glassWidthMm > 0 && glassHeightMm > 0)) return null;
  return (glassWidthMm * glassHeightMm) / (doorWidthMm * doorHeightMm);
}

export function classifyGlazedDoor(ratio: number): GlazedDoorClass {
  return ratio >= GLAZED_DOOR_WINDOW_RATIO ? 'window' : 'split';
}
