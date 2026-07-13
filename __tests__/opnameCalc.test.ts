/**
 * Unit tests for the shared @scarnergy/opname-calc primitives.
 * Imports the source directly so behaviour is locked at the source of truth.
 */
import {
  mmToM, r2, fmtMeters, fmtArea, fmtEfficiencyPct,
  toCardinal, floorId, floorName, openingArea, totalZoneArea, areaByFloor,
} from '../packages/opname-calc/src';

describe('units', () => {
  it('mmToM converts and rounds to 2 dp, null-safe', () => {
    expect(mmToM(2430)).toBe(2.43);
    expect(mmToM(2436)).toBe(2.44);
    expect(mmToM(null)).toBeNull();
    expect(mmToM(undefined)).toBeNull();
  });
  it('r2 rounds to 2 dp, null-safe', () => {
    expect(r2(5.808)).toBe(5.81);
    expect(r2(null)).toBeNull();
  });
  it('formatters', () => {
    expect(fmtMeters(2.4)).toBe('2.40 m');
    expect(fmtMeters(null)).toBe('—');
    expect(fmtArea(12.5)).toBe('12.5 m²');
    expect(fmtEfficiencyPct(0.925)).toBe('93%');
    expect(fmtEfficiencyPct(null)).toBe('—');
  });
});

describe('geometry', () => {
  it('toCardinal maps degrees to Dutch cardinals', () => {
    expect(toCardinal(0)).toBe('Noord');
    expect(toCardinal(45)).toBe('Noord-Oost');
    expect(toCardinal(315)).toBe('Noord-West');
    expect(toCardinal(360)).toBe('Noord');
    expect(toCardinal(-45)).toBe('Noord-West');
    expect(toCardinal(null)).toBe('');
  });
  it('floorId / floorName', () => {
    expect(floorId(0)).toBe('Bg');
    expect(floorId(2)).toBe('V2');
    expect(floorName(0)).toBe('Begane grond');
    expect(floorName(1)).toBe('Eerste verdieping');
    expect(floorName(2)).toBe('Tweede verdieping / zolder');
    expect(floorName(5)).toBe('Verdieping 5');
  });
  it('openingArea uses stored value then falls back to h×w', () => {
    expect(openingArea({ area_m2: 5.81 })).toBe(5.81);
    expect(openingArea({ height_mm: 2390, width_mm: 2430 })).toBe(5.81); // 2.39 × 2.43
    expect(openingArea({ height_mm: 2390 })).toBeNull();
    expect(openingArea(null)).toBeNull();
  });
  it('totalZoneArea / areaByFloor aggregate correctly', () => {
    const zones = [
      { floor_level: 0, gross_area_m2: 74.11 },
      { floor_level: 1, gross_area_m2: 67.38 },
      { floor_level: 0, gross_area_m2: 10 },
    ];
    expect(totalZoneArea(zones)).toBeCloseTo(151.49, 2);
    const rows = areaByFloor(zones);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ level: 0, name: 'Begane grond', area: 84.11 });
    expect(rows[1].level).toBe(1);
  });
});
