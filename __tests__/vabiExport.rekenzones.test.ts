/**
 * VABI export — rekenzone grouping (GAP W4).
 *
 * The legacy no-rekenzones document is locked byte-identically by
 * vabiExport.golden.test.ts; the equivalence test here asserts the guarantee
 * that lock relies on directly. The grouping tests cover the new multi-
 * <Rekenzone> output: one block per rekenzone (letter ids in sort order),
 * zones/elements bucketed via zone.rekenzone_id / element.zone_id, unassigned
 * leftovers in a trailing "Overige zones" block, installaties staying at
 * project level, and dakkapellen following their parent dak.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildVabiXml } from '../packages/opname-calc/src';
import type {
  VabiElement,
  VabiOpening,
  VabiRekenzone,
  VabiZone,
} from '../packages/opname-calc/src';

const session = {
  id: 'sess-1',
  session_code: 'INS-2026-0002',
  status: 'completed',
  started_at: '2026-05-20T09:00:00.000Z',
  inspector_name: 'Jan de Vries',
  building_address: 'Jordaanstraat 14',
  building_city: '1016 ZZ Amsterdam',
  building_id: 'bld-1',
};
const org = { name: 'Krontiva' };
const building = { construction_year: 1974, building_type: 'Vrijstaande woning' };

const rekenzones: VabiRekenzone[] = [
  { id: 'rz-b', name: 'Aanbouw', sort_order: 1 },
  { id: 'rz-a', name: 'Woning', sort_order: 0 }, // out of order on purpose
];

const zonesFor = (rzA: string | null, rzB: string | null): VabiZone[] => [
  { id: 'z0', floor_level: 0, gross_area_m2: 74.11, rekenzone_id: rzA },
  { id: 'z1', floor_level: 1, gross_area_m2: 67.38, rekenzone_id: rzB },
];

const elements: VabiElement[] = [
  { id: 'g1', name: 'Voorgevel (Noord)', element_type: 'gevel', zone_id: 'z0',
    construction_type: 'voorgevel', length_mm: 8320, height_mm: 2520,
    area_m2: 20.97, orientation_deg: 315 },
  { id: 'v1', name: 'Bg vloer', element_type: 'vloer', zone_id: 'z0',
    construction_type: 'kruipruimte', area_m2: 76.41, rc_value: 0.15 },
  { id: 'd1', name: 'Hellend dak', element_type: 'dak', zone_id: 'z1',
    construction_type: 'hellend', length_mm: 7570, width_mm: 10400,
    area_m2: 69.36, orientation_deg: 45, tilt_deg: 55, rc_value: 0.86 },
  { id: 'dk1', name: 'Rechts', element_type: 'dakkapel', zone_id: 'z1',
    parent_element_id: 'd1', width_mm: 3210, length_mm: 1620, height_mm: 2430 },
  { id: 'i1', name: 'Atag E325EC', element_type: 'installatie', zone_id: 'z0',
    installation_type: 'verwarming', brand: 'Atag', model_nr: 'E325EC CW5',
    fuel_type: 'gas', efficiency: 0.925, capacity_kw: 25 },
];

const openings: VabiOpening[] = [
  { id: 'o1', element_id: 'g1', opening_type: 'window', width_mm: 2430,
    height_mm: 2390, area_m2: 5.81, glazing_type: 'dubbel', frame_type: 'metaal',
    has_shading: true, shading_type: 'Knikarmscherm',
    thermisch_onderbroken: false, overstek_m: 0 },
];

// Pin the clock — buildVabiXml stamps aanmaakdatum with new Date().
const build = (zones: VabiZone[], rz?: VabiRekenzone[]) => {
  jest.useFakeTimers().setSystemTime(new Date('2026-05-20T12:00:00.000Z'));
  try {
    return rz === undefined
      ? buildVabiXml(session, org, building, zones, elements, openings)
      : buildVabiXml(session, org, building, zones, elements, openings, rz);
  } finally {
    jest.useRealTimers();
  }
};

const blockOf = (xml: string, id: string): string => {
  const start = xml.indexOf(`<Rekenzone id="${id}">`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = xml.indexOf('</Rekenzone>', start);
  return xml.slice(start, end);
};

describe('VABI export — rekenzone grouping', () => {
  it('is byte-identical to the legacy document when nothing is grouped', () => {
    const legacy = build(zonesFor(null, null));
    const emptyList = build(zonesFor(null, null), []);
    const listButUnassigned = build(zonesFor(null, null), rekenzones);
    expect(emptyList).toBe(legacy);
    expect(listButUnassigned).toBe(legacy);
    expect(legacy).toContain('<Rekenzone id="A">');
    expect(legacy).toContain('<Naam>Zone A - Volledig woning</Naam>');
  });

  it('emits one block per rekenzone, in sort order, with bucketed content', () => {
    const xml = build(zonesFor('rz-a', 'rz-b'), rekenzones);

    // sort_order wins over array order: Woning (0) = A, Aanbouw (1) = B
    const a = blockOf(xml, 'A');
    const b = blockOf(xml, 'B');
    expect(xml.indexOf('<Rekenzone id="A">')).toBeLessThan(xml.indexOf('<Rekenzone id="B">'));
    expect(a).toContain('<Naam>Woning</Naam>');
    expect(b).toContain('<Naam>Aanbouw</Naam>');
    expect(xml.match(/<Rekenzone id=/g)).toHaveLength(2);

    // Gebruiksoppervlakte per block = sum of its zones only
    expect(a).toContain('<Gebruiksoppervlakte>74.11</Gebruiksoppervlakte>');
    expect(b).toContain('<Gebruiksoppervlakte>67.38</Gebruiksoppervlakte>');

    // Verdiepingen split per block
    expect(a).toContain('<Naam>Begane grond</Naam>');
    expect(b).toContain('<Naam>Eerste verdieping</Naam>');
    expect(a).not.toContain('Eerste verdieping');

    // elements follow their zone
    expect(a).toContain('<Gevel id="g1">');
    expect(b).not.toContain('<Gevel id="g1">');
    expect(a).toContain('<Vloer id="v1">');
    expect(b).toContain('<Dak id="d1">');
    expect(a).not.toContain('<Dak id="d1">');

    // dakkapel stays nested under its parent dak
    expect(b).toContain('<Dakkapel id="dk1">');

    // installaties remain a single project-level section
    expect(xml.match(/<Installaties>/g)).toHaveLength(1);
    expect(xml).toContain('<Installatie id="i1">');
    expect(a).not.toContain('<Installatie');
    expect(b).not.toContain('<Installatie');
  });

  it('collects unassigned zones and their elements in a trailing "Overige zones" block', () => {
    const xml = build(zonesFor('rz-a', null), rekenzones);

    const a = blockOf(xml, 'A');
    const b = blockOf(xml, 'B'); // Aanbouw has no zones/elements → skipped; B = leftovers
    expect(xml.match(/<Rekenzone id=/g)).toHaveLength(2);
    expect(xml).not.toContain('<Naam>Aanbouw</Naam>');
    expect(a).toContain('<Naam>Woning</Naam>');
    expect(b).toContain('<Naam>Overige zones</Naam>');
    expect(b).toContain('<Gebruiksoppervlakte>67.38</Gebruiksoppervlakte>');
    expect(b).toContain('<Dak id="d1">');
    expect(xml.indexOf('<Naam>Woning</Naam>')).toBeLessThan(xml.indexOf('<Naam>Overige zones</Naam>'));
  });

  it('matches the grouped golden snapshot and writes the fixture', () => {
    const xml = build(zonesFor('rz-a', 'rz-b'), rekenzones);
    expect(xml).toMatchSnapshot();

    const dir = path.join(__dirname, 'fixtures');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'vabi.rekenzones.golden.xml'), xml);
    expect(xml.length).toBeGreaterThan(0);
  });
});
