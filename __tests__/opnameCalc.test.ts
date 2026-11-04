/**
 * Unit tests for the shared @scarnergy/opname-calc primitives.
 * Imports the source directly so behaviour is locked at the source of truth.
 */
import {
  mmToM, r2, fmtMeters, fmtArea, fmtEfficiencyPct,
  toCardinal, floorId, floorName, openingArea, totalZoneArea, areaByFloor,
  rekenhoogte, warmtecapKJm2K, rcSourceLabel, DIKTE_VLOERCONSTRUCTIE_FORFAIT_MM,
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

// ── Roof area breakdown (W1: Totaal Oppervlakte Gaten / Netto Dakoppervlak) ──

import { roofAreaBreakdown, dakkapelFootprint } from '../packages/opname-calc/src';

describe('roofAreaBreakdown', () => {
  const dak = { length_mm: 7570, width_mm: 10400 }; // 7.57 × 10.4 = 78.73 (VABI bruto)

  it('bruto matches the VABI <BrutoOppervlakte> formula', () => {
    expect(roofAreaBreakdown(dak).bruto).toBeCloseTo(78.73, 2);
    expect(roofAreaBreakdown({}).bruto).toBeNull();
  });

  it('netto = bruto − gaten − dakkapel footprints', () => {
    const openings = [{ height_mm: 1000, width_mm: 1000 }];        // 1.00 gaten
    const dakkapellen = [{ width_mm: 3210, length_mm: 1620 }];     // 3.21 × 1.62 = 5.20
    const b = roofAreaBreakdown(dak, openings, dakkapellen);
    expect(b.gaten).toBeCloseTo(1.0, 2);
    expect(b.dakkapellen).toBeCloseTo(5.2, 2);
    expect(b.netto).toBeCloseTo(78.73 - 1.0 - 5.2, 2);
  });

  it('clamps netto at zero and handles missing dims', () => {
    const tiny = { length_mm: 1000, width_mm: 1000 }; // 1.00 bruto
    const b = roofAreaBreakdown(tiny, [{ height_mm: 2000, width_mm: 2000 }]);
    expect(b.netto).toBe(0);
    expect(dakkapelFootprint({})).toBeNull();
  });
});

describe('nta — §2.1 rekenhoogte', () => {
  it('applies the 300 mm forfait when no floor-construction thickness is recorded', () => {
    expect(DIKTE_VLOERCONSTRUCTIE_FORFAIT_MM).toBe(300);
    expect(rekenhoogte(2.52, null)).toBe(2.82);
    expect(rekenhoogte(2.52, undefined)).toBe(2.82);
  });

  it('uses the measured thickness when present', () => {
    expect(rekenhoogte(2.52, 250)).toBe(2.77);
    expect(rekenhoogte(2.5, 0)).toBe(2.5); // measured 0 is a value, not "missing"
  });

  it('manual override wins over any computation', () => {
    expect(rekenhoogte(2.52, 250, 3.1)).toBe(3.1);
    expect(rekenhoogte(null, null, 3.1)).toBe(3.1);
  });

  it('returns null without a height or override', () => {
    expect(rekenhoogte(null, 300)).toBeNull();
    expect(rekenhoogte(undefined, null, null)).toBeNull();
  });
});

describe('nta — §1.3 warmtecapaciteit', () => {
  it('is null while any class input is missing', () => {
    expect(warmtecapKJm2K(null, 'zwaar', 'gesloten')).toBeNull();
    expect(warmtecapKJm2K('licht', null, 'gesloten')).toBeNull();
    expect(warmtecapKJm2K('licht', 'zwaar', null)).toBeNull();
  });

  it('is null for every combination until the licensed forfait table is transcribed (Phase 2 gate)', () => {
    // When the NTA 8800 / ISSO 82.1 values land, replace these with the real numbers.
    for (const v of ['licht', 'zwaar']) {
      for (const g of ['licht', 'zwaar']) {
        for (const p of ['gesloten', 'open', 'overig']) {
          expect(warmtecapKJm2K(v, g, p)).toBeNull();
        }
      }
    }
    expect(warmtecapKJm2K('onbekend', 'zwaar', 'gesloten')).toBeNull();
  });
});

describe('nta — §6 rc_source labels', () => {
  it('maps the three provenance values and rejects unknowns', () => {
    expect(rcSourceLabel('documented')).toBe('documented');
    expect(rcSourceLabel('observed')).toBe('observed');
    expect(rcSourceLabel('buildyear_forfait')).toBe('forfait');
    expect(rcSourceLabel('anything_else')).toBeNull();
    expect(rcSourceLabel(null)).toBeNull();
  });
});
