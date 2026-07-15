/**
 * GOLDEN regression oracle for the VABI XML export.
 *
 * Captures the exact current output of buildVabiXml against a representative
 * dataset (all element types: gevel+openings, vloer, dak+dakkapel, installatie).
 * The Phase 1 shared-core refactor must keep this snapshot byte-identical — if
 * the merged builder changes output, this test fails and forces a conscious diff
 * review. Also writes the XML to __tests__/fixtures/ for human inspection.
 *
 * See docs/CALC_TASK_CHECKLIST.md (Phase 0.4 / Phase 1.5).
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildVabiXml } from '../packages/opname-calc/src';
import type { BuildingElement, Opening, Zone } from '../lib/supabase';

const session = {
  id: 'sess-1',
  session_code: 'INS-2026-0001',
  status: 'completed',
  started_at: '2026-05-20T09:00:00.000Z',
  inspector_name: 'Jan de Vries',
  building_address: 'Jordaanstraat 14',
  building_city: '1016 ZZ Amsterdam',
  building_id: 'bld-1',
};
const org = { name: 'Krontiva' };
const building = { construction_year: 1974, building_type: 'Vrijstaande woning' };

const zones: Zone[] = [
  {
    id: 'z0', building_id: 'bld-1', zone_code: 'Z01', name: 'Begane grond',
    floor_level: 0, gross_area_m2: 74.11, energy_label: null, rekenzone_id: null, is_active: true,
    floor_plan_points: null, floor_plan_scale_m: null, floor_plan_image_url: null,
  },
  {
    id: 'z1', building_id: 'bld-1', zone_code: 'Z02', name: 'Eerste verdieping',
    floor_level: 1, gross_area_m2: 67.38, energy_label: null, rekenzone_id: null, is_active: true,
    floor_plan_points: null, floor_plan_scale_m: null, floor_plan_image_url: null,
  },
];

const el = (o: Partial<BuildingElement>): BuildingElement => ({
  id: 'e', zone_id: 'z0', element_type: 'gevel', name: 'x', description: null,
  length_mm: null, width_mm: null, height_mm: null, area_m2: null,
  orientation_deg: null, tilt_deg: null, rc_value: null, u_value: null,
  lambda_value: null, insulation_thickness_mm: null, construction_type: null,
  insulation_type: null, finish_type: null, installation_type: null, fuel_type: null,
  efficiency: null, capacity_kw: null, year_installed: null, nokhoogte_m: null,
  bodemisolatie: false, brand: null, model_nr: null, cv_klasse: null,
  parent_element_id: null, perimeter_m: null, dikte_vloer_boven_mm: null,
  dikte_vloer_onder_mm: null, dikte_muren_mm: null, photo_urls: [],
  is_complete: true, is_active: true, sort_order: 0, notes: null,
  grid_x: null, grid_y: null, grid_w: null, grid_h: null, grid_rotation: null,
  ...o,
});

const elements: BuildingElement[] = [
  el({ id: 'g1', element_type: 'gevel', name: 'Voorgevel (Noord)', construction_type: 'voorgevel',
       length_mm: 8320, height_mm: 2520, area_m2: 20.97, orientation_deg: 315,
       perimeter_m: 8.1, dikte_vloer_boven_mm: 100, dikte_muren_mm: 220 }),
  el({ id: 'v1', element_type: 'vloer', name: 'Bg vloer', construction_type: 'kruipruimte',
       area_m2: 76.41, insulation_type: null, bodemisolatie: false, rc_value: 0.15 }),
  el({ id: 'd1', element_type: 'dak', name: 'Hellend dak', construction_type: 'hellend',
       length_mm: 7570, width_mm: 10400, area_m2: 69.36, orientation_deg: 45,
       tilt_deg: 55, nokhoogte_m: 5.99, rc_value: 0.86 }),
  el({ id: 'dk1', element_type: 'dakkapel', name: 'Rechts', parent_element_id: 'd1',
       width_mm: 3210, length_mm: 1620, height_mm: 2430 }),
  el({ id: 'i1', element_type: 'installatie', name: 'Atag E325EC', installation_type: 'verwarming',
       brand: 'Atag', model_nr: 'E325EC CW5', cv_klasse: 'CW5', fuel_type: 'gas',
       efficiency: 0.925, capacity_kw: 25, description: 'Zolder' }),
];

const openings: Opening[] = [
  {
    id: 'o1', org_id: 'org1', element_id: 'g1', opening_type: 'window', name: 'Raam 1',
    width_mm: 2430, height_mm: 2390, area_m2: 5.81, glazing_type: 'dubbel',
    frame_type: 'metaal', g_value: null, u_value_frame: null, u_value_glass: null,
    u_value_total: 2.8, has_shading: true, shading_type: 'Knikarmscherm', shading_factor: null,
    thermisch_onderbroken: false, overstek_m: 0, belemmering: null, notes: null,
  },
];

describe('VABI export — golden output', () => {
  // Pin the clock: buildVabiXml stamps aanmaakdatum with new Date(), so freeze
  // it for a deterministic snapshot that does not drift day-to-day. Must be set
  // before buildVabiXml runs, so build xml inside beforeAll.
  let xml = '';
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-20T12:00:00.000Z'));
    xml = buildVabiXml(session, org, building, zones, elements, openings);
    jest.useRealTimers();
  });

  it('matches the golden snapshot', () => {
    expect(xml).toMatchSnapshot();
  });

  it('writes the fixture file for human diffing', () => {
    const dir = path.join(__dirname, 'fixtures');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'vabi.mobile.golden.xml'), xml);
    expect(xml.length).toBeGreaterThan(0);
  });
});
