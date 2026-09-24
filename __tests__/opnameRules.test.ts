import {
  floorPerimeterM, glassRatio, classifyGlazedDoor, GLAZED_DOOR_WINDOW_RATIO,
} from "../packages/opname-calc/src/rules";

describe("floorPerimeterM — internal circumference on the envelope boundary", () => {
  const walls = [
    { length_mm: 4200, description: "Buitenlucht" },
    { length_mm: 3100, description: "Aangrenzende onverwarmde ruimte" },
    { length_mm: 4200, description: "Aangrenzende verwarmde ruimte" },   // inside the envelope: excluded
    { length_mm: 3100, description: "Kruipruimte" },                     // not a boundary wall: excluded
    { length_mm: null, description: "Buitenlucht" },                     // unmeasured: excluded
  ];
  test("sums only outside-air and unheated-space walls, in metres", () => {
    expect(floorPerimeterM(walls, 0)).toBe(7.3);
  });
  test("applies to ground and basement floors only", () => {
    expect(floorPerimeterM(walls, -1)).toBe(7.3);
    expect(floorPerimeterM(walls, 1)).toBeNull();
    expect(floorPerimeterM(walls, null)).toBeNull();
  });
  test("null when nothing qualifies yet", () => {
    expect(floorPerimeterM([{ length_mm: 4000, description: "Aangrenzende verwarmde ruimte" }], 0)).toBeNull();
    expect(floorPerimeterM([], 0)).toBeNull();
  });
});

describe("glazed door — 65 % rule", () => {
  test("ratio is glass area over door area", () => {
    expect(glassRatio(1000, 2000, 500, 1000)).toBeCloseTo(0.25);
    expect(glassRatio(0, 2000, 500, 1000)).toBeNull();
  });
  test("below 65 % → split into door + window; 65 % and above → window", () => {
    expect(classifyGlazedDoor(0.64)).toBe("split");
    expect(classifyGlazedDoor(0.65)).toBe("window");
    expect(classifyGlazedDoor(0.9)).toBe("window");
    expect(GLAZED_DOOR_WINDOW_RATIO).toBe(0.65);
  });
});
