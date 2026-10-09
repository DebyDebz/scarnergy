import {
  floorPerimeterM, glassRatio, classifyGlazedDoor, GLAZED_DOOR_WINDOW_RATIO,
  rcFromInsulation, INSULATION_LAMBDA_W_PER_MK, MAX_MEASUREMENT_VARIATION, roofSlopeLengthM,
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

describe("insulation Rc formula (recorded, not yet applied)", () => {
  test("Rc = d/0.045 + Rad with thickness rounded to 0.1 m", () => {
    // 90 mm → 0.1 m → 0.1/0.045 = 2.222… + Rad 0.17
    expect(rcFromInsulation(90, 0.17)).toBeCloseTo(2.392, 3);
    // 140 mm → 0.1 m (0.14 rounds down)
    expect(rcFromInsulation(140, 0)).toBeCloseTo(2.222, 3);
    expect(INSULATION_LAMBDA_W_PER_MK).toBe(0.045);
  });
});

test("3 % is the maximum measurement variation", () => {
  expect(MAX_MEASUREMENT_VARIATION).toBe(0.03);
});

describe("roofSlopeLengthM — slope from ridge height and angle", () => {
  test("height / sin(angle), 2 decimals", () => {
    expect(roofSlopeLengthM(2.5, 30)).toBe(5);
    expect(roofSlopeLengthM(3, 45)).toBeCloseTo(4.24, 2);
  });
  test("null for flat, vertical or missing", () => {
    expect(roofSlopeLengthM(2.5, 0)).toBeNull();
    expect(roofSlopeLengthM(2.5, 90)).toBeNull();
    expect(roofSlopeLengthM(null, 30)).toBeNull();
  });
});
