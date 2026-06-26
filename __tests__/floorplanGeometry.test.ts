/**
 * Tests for the shared floor-plan projection geometry (lib/floorplanGeometry).
 *
 * This is the math the image overlay rests on: GridCanvas and FloorPlanViewer
 * both import these functions, so a single passing suite guarantees the outline
 * projects identically wherever it is drawn. Pure functions — no react-native,
 * no supabase — so they run directly under ts-jest.
 *
 * Run: npx jest __tests__/floorplanGeometry.test.ts
 */

import {
  projectOnImage, fitToInner, imageOffsets, projectGridRect, unprojectPoint,
  gridLengthMeters, Pt, Seg,
} from "../lib/floorplanGeometry";

const CANVAS = 300;
const PADDING = 12;

// A simple unit square outline (normalised 0..1).
const SQUARE: Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

// Largest coordinate touched by any segment endpoint.
const maxCoord = (segs: Seg[]) =>
  Math.max(...segs.flatMap(s => [s.x1, s.y1, s.x2, s.y2]));
const minCoord = (segs: Seg[]) =>
  Math.min(...segs.flatMap(s => [s.x1, s.y1, s.x2, s.y2]));

describe("projectOnImage", () => {
  it("returns [] for fewer than 3 points or unknown dims", () => {
    expect(projectOnImage([{ x: 0, y: 0 }, { x: 1, y: 1 }], { w: 100, h: 100 }, CANVAS)).toEqual([]);
    expect(projectOnImage(SQUARE, { w: 0, h: 0 }, CANVAS)).toEqual([]);
    expect(projectOnImage(null, { w: 100, h: 100 }, CANVAS)).toEqual([]);
  });

  it("closes the ring: one segment per point, last connects to first", () => {
    const segs = projectOnImage(SQUARE, { w: 100, h: 100 }, CANVAS);
    expect(segs).toHaveLength(SQUARE.length);
    const last = segs[segs.length - 1];
    expect({ x: last.x2, y: last.y2 }).toEqual({ x: segs[0].x1, y: segs[0].y1 });
  });

  it("square image: no letterbox, points scale by CANVAS", () => {
    const segs = projectOnImage(SQUARE, { w: 100, h: 100 }, CANVAS);
    // contain-fit of a square into a square => offX/offY = 0, scale = CANVAS.
    expect(minCoord(segs)).toBeCloseTo(0);
    expect(maxCoord(segs)).toBeCloseTo(CANVAS);
  });

  it("landscape image: letterboxed vertically, stays within canvas", () => {
    // 200x100 image contain-fit into 300 square => scale 1.5, drawn height 150,
    // centred => offY = 75. A full-width outline traced on that letterboxed image
    // spans normalised y in [0, 0.5] (drawnHeight/canvas = 150/300), so it maps
    // back inside [0, CANVAS].
    const outline: Pt[] = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0, y: 0.5 },
    ];
    const segs = projectOnImage(outline, { w: 200, h: 100 }, CANVAS);
    expect(minCoord(segs)).toBeGreaterThanOrEqual(0);
    expect(maxCoord(segs)).toBeLessThanOrEqual(CANVAS);
    const ys = segs.flatMap(s => [s.y1, s.y2]);
    expect(Math.min(...ys)).toBeCloseTo(75);   // offY
    expect(Math.max(...ys)).toBeCloseTo(225);  // offY + 0.5 * CANVAS
  });
});

describe("fitToInner", () => {
  it("returns [] for fewer than 3 points", () => {
    expect(fitToInner([{ x: 0, y: 0 }, { x: 1, y: 1 }], CANVAS, PADDING)).toEqual([]);
    expect(fitToInner(null, CANVAS, PADDING)).toEqual([]);
  });

  it("fits the bbox inside the padded inner area", () => {
    const segs = fitToInner(SQUARE, CANVAS, PADDING);
    expect(minCoord(segs)).toBeGreaterThanOrEqual(PADDING - 1e-6);
    expect(maxCoord(segs)).toBeLessThanOrEqual(CANVAS - PADDING + 1e-6);
  });

  it("is translation/scale invariant (square at any offset fills inner area)", () => {
    const shifted: Pt[] = SQUARE.map(p => ({ x: p.x * 0.5 + 0.25, y: p.y * 0.5 + 0.25 }));
    const a = fitToInner(SQUARE, CANVAS, PADDING);
    const b = fitToInner(shifted, CANVAS, PADDING);
    // Same shape (square) => same fitted geometry regardless of original scale/offset.
    expect(maxCoord(b)).toBeCloseTo(maxCoord(a));
    expect(minCoord(b)).toBeCloseTo(minCoord(a));
  });
});

describe("imageOffsets", () => {
  it("square image => no letterbox", () => {
    expect(imageOffsets({ w: 100, h: 100 }, CANVAS)).toEqual({ offX: 0, offY: 0 });
  });
  it("landscape image => vertical letterbox only", () => {
    // 200x100 contain-fit into 300 => scale 1.5, drawn 300x150, centred offY=75.
    expect(imageOffsets({ w: 200, h: 100 }, CANVAS)).toEqual({ offX: 0, offY: 75 });
  });
  it("portrait image => horizontal letterbox only", () => {
    expect(imageOffsets({ w: 100, h: 200 }, CANVAS)).toEqual({ offX: 75, offY: 0 });
  });
  it("zero dims => no offset (safe fallback)", () => {
    expect(imageOffsets({ w: 0, h: 0 }, CANVAS)).toEqual({ offX: 0, offY: 0 });
  });
});

describe("projectGridRect / unprojectPoint", () => {
  const rect = { x: 0.2, y: 0.3, w: 0.1, h: 0.05 };

  it("blank-zone ({0,0} offsets) reduces to grid_* * canvas", () => {
    expect(projectGridRect(rect, CANVAS)).toEqual({ x: 60, y: 90, w: 30, h: 15 });
  });

  it("image offsets shift position but not size", () => {
    const off = imageOffsets({ w: 200, h: 100 }, CANVAS); // offY = 75
    const r = projectGridRect(rect, CANVAS, off);
    expect(r).toEqual({ x: 60, y: 90 + 75, w: 30, h: 15 });
  });

  it("projects an element onto the SAME frame as its outline point", () => {
    // A point shared by the outline and an element's top-left must land in the
    // same canvas px under both projections — this is the alignment guarantee.
    const dims = { w: 200, h: 100 };
    const shared: Pt = { x: 0.2, y: 0.3 };
    const [seg] = projectOnImage(
      [shared, { x: 0.9, y: 0.3 }, { x: 0.9, y: 0.5 }], dims, CANVAS,
    );
    const r = projectGridRect({ ...shared, w: 0.1, h: 0.05 }, CANVAS, imageOffsets(dims, CANVAS));
    expect(r.x).toBeCloseTo(seg.x1);
    expect(r.y).toBeCloseTo(seg.y1);
  });

  it("unprojectPoint inverts the position half (round-trip)", () => {
    const off = imageOffsets({ w: 100, h: 250 }, CANVAS);
    const px = projectGridRect(rect, CANVAS, off);
    const back = unprojectPoint({ x: px.x, y: px.y }, CANVAS, off);
    expect(back.x).toBeCloseTo(rect.x);
    expect(back.y).toBeCloseTo(rect.y);
  });
});

describe("gridLengthMeters", () => {
  it("scales a grid fraction by metres-across-canvas", () => {
    expect(gridLengthMeters(0.5, 8)).toBeCloseTo(4);
    expect(gridLengthMeters(0.1, 12)).toBeCloseTo(1.2);
  });
  it("returns null for missing or non-finite inputs", () => {
    expect(gridLengthMeters(null, 8)).toBeNull();
    expect(gridLengthMeters(0.5, null)).toBeNull();
    expect(gridLengthMeters(0.5, Infinity)).toBeNull();
    expect(gridLengthMeters(undefined, undefined)).toBeNull();
  });
  it("round-trips with two-point calibration (scaleM = R·CANVAS/d)", () => {
    // Two points d=150 canvas px apart known to be R=6 m → scaleM=12 m across canvas.
    const d = 150, R = 6;
    const scaleM = (R * CANVAS) / d;
    expect(scaleM).toBeCloseTo(12);
    // An element of that same pixel length reads back as R metres.
    expect(gridLengthMeters(d / CANVAS, scaleM)).toBeCloseTo(R);
  });
});
