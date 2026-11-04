/**
 * Pure thickness / depth calculation helpers for the Bosch GLM measurement flow.
 *
 * A laser rangefinder only ever returns a single distance-to-surface, so the
 * thickness (or depth) of an element must be derived from TWO distances measured
 * from the SAME fixed origin. Two capture modes are supported:
 *
 *   • Point (trigger-press) : one reading on the front face, one on the back face.
 *       thickness = | back − front |
 *   • Continuous (sweep)    : the laser is swept across the edge and we keep the
 *       running min/max of the stream.
 *       thickness = max − min
 *
 * All values are in millimetres, matching `value_mm` everywhere else in the app.
 * These functions are React-free so they can be unit-tested in isolation
 * (mirrors the bleDecoder / floorplanGeometry pattern).
 */

/** Minimum plausible thickness (mm). Below this the two faces are treated as identical. */
export const MIN_THICKNESS_MM = 1;
/** A continuous sweep must produce at least this many samples to be trusted. */
export const MIN_SWEEP_SAMPLES = 5;
/** …and span at least this range, otherwise the sweep never crossed the edge. */
export const MIN_SWEEP_SPREAD_MM = 5;

export interface SweepState {
  active:  boolean;
  min_mm:  number;   // Infinity  when empty
  max_mm:  number;   // -Infinity when empty
  samples: number;
}

export const EMPTY_SWEEP: SweepState = { active: false, min_mm: Infinity, max_mm: -Infinity, samples: 0 };

/** Point mode: thickness from a front-face and back-face distance (mm, same origin). */
export function thicknessFromFaces(front_mm: number, back_mm: number): number {
  return Math.abs(back_mm - front_mm);
}

/** Fold one streamed sample into a sweep accumulator. Returns a new SweepState. */
export function addSweepSample(s: SweepState, value_mm: number): SweepState {
  return {
    active:  s.active,
    min_mm:  Math.min(s.min_mm, value_mm),
    max_mm:  Math.max(s.max_mm, value_mm),
    samples: s.samples + 1,
  };
}

/**
 * Continuous mode: thickness from a completed sweep (max − min).
 * Returns null when the sweep is too short / too flat to be a real front-to-back pass.
 */
export function thicknessFromSweep(s: SweepState): number | null {
  const spread = s.max_mm - s.min_mm;
  if (s.samples < MIN_SWEEP_SAMPLES || !isFinite(spread) || spread < MIN_SWEEP_SPREAD_MM) return null;
  return spread;
}

/** Whether a face-pair difference is a usable thickness (rejects ~0 / non-finite). */
export function isUsableThickness(mm: number): boolean {
  return isFinite(mm) && mm >= MIN_THICKNESS_MM;
}
