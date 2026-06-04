/**
 * Tests for the thickness / depth calculation (lib/thickness).
 *
 * A laser only returns distance-to-surface, so thickness is always derived from
 * two distances: a front/back face pair (point mode) or a min/max sweep
 * (continuous mode). Pure functions — no react-native, no supabase — so they run
 * directly under ts-jest.
 *
 * Run: npx jest __tests__/thickness.test.ts
 */

import {
  thicknessFromFaces,
  addSweepSample,
  thicknessFromSweep,
  isUsableThickness,
  EMPTY_SWEEP,
  MIN_SWEEP_SAMPLES,
  MIN_SWEEP_SPREAD_MM,
  MIN_THICKNESS_MM,
} from "../lib/thickness";

// Fold a list of samples into a sweep, marked active so it mirrors a live sweep.
const sweepOf = (...samples: number[]) =>
  samples.reduce(addSweepSample, { ...EMPTY_SWEEP, active: true });

describe("point mode — thicknessFromFaces", () => {
  it("returns the absolute difference of the two faces", () => {
    expect(thicknessFromFaces(2000, 2300)).toBe(300);
  });

  it("is order-independent (back can be nearer than front)", () => {
    expect(thicknessFromFaces(2300, 2000)).toBe(300);
  });

  it("yields 0 for identical faces", () => {
    expect(thicknessFromFaces(2000, 2000)).toBe(0);
  });
});

describe("isUsableThickness", () => {
  it("rejects a ~0 difference (same face measured twice)", () => {
    expect(isUsableThickness(0)).toBe(false);
    expect(isUsableThickness(MIN_THICKNESS_MM - 0.5)).toBe(false);
  });

  it("accepts a real thickness", () => {
    expect(isUsableThickness(300)).toBe(true);
  });

  it("rejects non-finite values", () => {
    expect(isUsableThickness(Infinity)).toBe(false);
    expect(isUsableThickness(NaN)).toBe(false);
  });
});

describe("continuous mode — sweep accumulation", () => {
  it("tracks running min/max and sample count", () => {
    const s = sweepOf(2100, 2000, 2400, 2300);
    expect(s.min_mm).toBe(2000);
    expect(s.max_mm).toBe(2400);
    expect(s.samples).toBe(4);
  });

  it("computes thickness as max − min for a valid sweep", () => {
    // 6 samples spanning 2000..2400 → 400mm thickness
    const s = sweepOf(2000, 2050, 2150, 2250, 2350, 2400);
    expect(thicknessFromSweep(s)).toBe(400);
  });

  it("rejects a sweep with too few samples", () => {
    const s = sweepOf(2000, 2400); // big spread but only 2 samples
    expect(s.samples).toBeLessThan(MIN_SWEEP_SAMPLES);
    expect(thicknessFromSweep(s)).toBeNull();
  });

  it("rejects a sweep that never crossed the edge (flat)", () => {
    const s = sweepOf(2000, 2001, 2000, 2002, 2001, 2000); // spread < MIN_SWEEP_SPREAD_MM
    expect(s.max_mm - s.min_mm).toBeLessThan(MIN_SWEEP_SPREAD_MM);
    expect(thicknessFromSweep(s)).toBeNull();
  });

  it("rejects an empty sweep (non-finite spread)", () => {
    expect(thicknessFromSweep(EMPTY_SWEEP)).toBeNull();
  });
});
