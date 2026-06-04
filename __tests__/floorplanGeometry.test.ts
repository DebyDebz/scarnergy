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

import { projectOnImage, fitToInner, Pt, Seg } from "../lib/floorplanGeometry";

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
