import { DEMO_TOUR_STEPS, clampTourStep, isDemoSession } from "../lib/demoTour";

describe("demo walkthrough steps", () => {
  test("ids are unique and every step has text", () => {
    const ids = DEMO_TOUR_STEPS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of DEMO_TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
      expect(s.see.length).toBeGreaterThan(0);
    }
  });

  test("targets name only elements and floors that exist in the seeded demo house", () => {
    // Keep in sync with the Demostraat 1 seed (metadata.demo = 'nils-2026-10').
    const seededElements = new Set([
      "Voorgevel BG", "Achtergevel BG", "Linkergevel BG (buren)", "Rechtergevel BG (buren)",
      "Vloer BG", "Raam woonkamer", "Voordeur met glas", "Achterpui", "Close-in boiler keuken",
      "Voorgevel 1e", "Achtergevel 1e (slaapkamer airco)", "Linkergevel 1e (buren)", "Rechtergevel 1e (buren)",
      "Raam slaapkamer voor", "Raam slaapkamer achter", "Airco slaapkamer",
      "Dakvlak voor", "Dakvlak achter", "Dakkapel achter", "CV-ketel",
    ]);
    const seededFloors = new Set(["Begane grond", "Eerste verdieping", "Zolder"]);
    for (const s of DEMO_TOUR_STEPS) {
      if (s.target.kind === "element") expect(seededElements).toContain(s.target.name);
      if (s.target.kind === "session" && s.target.zone) expect(seededFloors).toContain(s.target.zone);
    }
  });
});

test("clampTourStep keeps the step in range", () => {
  expect(clampTourStep(-1)).toBe(0);
  expect(clampTourStep(3)).toBe(3);
  expect(clampTourStep(999)).toBe(DEMO_TOUR_STEPS.length - 1);
  expect(clampTourStep(Number.NaN)).toBe(0);
});

test("isDemoSession only for inspections tagged as demo", () => {
  expect(isDemoSession({ demo: "nils-2026-10" })).toBe(true);
  expect(isDemoSession({})).toBe(false);
  expect(isDemoSession({ demo: "" })).toBe(false);
  expect(isDemoSession(null)).toBe(false);
  expect(isDemoSession(undefined)).toBe(false);
});
