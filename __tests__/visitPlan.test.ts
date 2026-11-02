import { parseVisitDateTime, formatVisitDate, formatVisitTime, standardParts, orientationDeg, useClassOf } from "../lib/visitPlan";
import { onsiteSteps } from "../lib/onsiteProgress";

test("visit date/time parses Dutch input and rejects nonsense", () => {
  const d = parseVisitDateTime("31-10-2026", "14:30")!;
  expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 31, 14, 30]);
  expect(parseVisitDateTime("1/2/2027", "9.05")).not.toBeNull();
  expect(parseVisitDateTime("31-02-2026", "10:00")).toBeNull();
  expect(parseVisitDateTime("31-10-2026", "24:00")).toBeNull();
  expect(parseVisitDateTime("2026-10-31", "10:00")).toBeNull();
  expect(formatVisitDate(d)).toBe("31-10-2026");
  expect(formatVisitTime(d)).toBe("14:30");
});

test("use class follows building type", () => {
  expect(useClassOf("apartment")).toBe("woning");
  expect(useClassOf("office")).toBe("utiliteit");
});

test("standard parts: detached house gets four oriented walls, floor and roof", () => {
  const parts = standardParts("vrijstaand", orientationDeg("S"));
  expect(parts.map(p => p.name)).toEqual(["Voorgevel", "Achtergevel", "Linkergevel", "Rechtergevel", "Begane grondvloer", "Dak"]);
  // Front faces south → rear north, left (seen from the street) west, right east.
  expect(parts.slice(0, 4).map(p => p.orientation_deg)).toEqual([180, 0, 270, 90]);
});

test("standard parts: mid-terrace drops party walls, in-between apartment also floor/roof", () => {
  expect(standardParts("tussenwoning", null).map(p => p.name)).toEqual(["Voorgevel", "Achtergevel", "Begane grondvloer", "Dak"]);
  expect(standardParts("appartement_tussen", 0).map(p => p.element_type)).toEqual(["gevel", "gevel"]);
  expect(standardParts(null, null).every(p => p.orientation_deg === null)).toBe(true);
});

const el = (o: Partial<Parameters<typeof onsiteSteps>[0]["elements"][number]>) => ({
  element_type: "gevel", height_mm: null, length_mm: null, width_mm: null, tilt_deg: null,
  nokhoogte_m: null, is_complete: false, photo_urls: [], ...o,
});

test("on-site progress follows the five steps", () => {
  const empty = onsiteSteps({ facadePhotoCount: 0, zones: [], rekenzoneCount: 0, elements: [] });
  expect(empty.map(s => s.key)).toEqual(["facades", "plan", "dimensions", "openings", "installations"]);
  expect(empty.every(s => !s.done)).toBe(true);

  const steps = onsiteSteps({
    facadePhotoCount: 5,
    zones: [{ floor_plan_points: [1, 2, 3], floor_plan_image_url: null, rekenzone_id: "r1" }],
    rekenzoneCount: 1,
    elements: [
      el({ height_mm: 2600, is_complete: true, photo_urls: ["a.jpg"] }),
      el({ element_type: "dak", tilt_deg: 45 }),
      el({ element_type: "vloer", length_mm: 5000, width_mm: 8000 }),
      el({ element_type: "transparant_deel", is_complete: true, photo_urls: ["b.jpg"] }),
      el({ element_type: "installatie", is_complete: false }),
    ],
  });
  expect(steps.map(s => s.done)).toEqual([true, true, true, true, false]);
  expect(steps[3].status).toBe("2 / 2 complete with photo · 1 window/door");
  expect(steps[4].status).toBe("0 / 1 complete");
});

test("floor plan step waits until every floor is in a rekenzone", () => {
  const [, plan] = onsiteSteps({
    facadePhotoCount: 0,
    zones: [{ floor_plan_points: [1, 2, 3], floor_plan_image_url: null, rekenzone_id: null }],
    rekenzoneCount: 1,
    elements: [],
  });
  expect(plan.done).toBe(false);
});
