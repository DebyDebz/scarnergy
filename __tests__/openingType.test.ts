import { openingTypeVabi } from "../packages/opname-calc/src/vabi";

describe("openingTypeVabi — door with glass panel (two linked rows)", () => {
  test("plain door and window", () => {
    expect(openingTypeVabi("door")).toBe("Deur");
    expect(openingTypeVabi("window")).toBe("Raam");
  });
  test("glazed door exports as a door, its glass panel row as glass", () => {
    expect(openingTypeVabi("glazed_door")).toBe("Deur");
    expect(openingTypeVabi("door_glass")).toBe("Raam");
  });
  test("skylight and unknown fall back to glass", () => {
    expect(openingTypeVabi("skylight")).toBe("Raam");
    expect(openingTypeVabi(null)).toBe("Raam");
  });
});
