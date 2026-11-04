/**
 * NTA 8800 calc-field helpers (GAP W2 / calc Phase 2 groundwork).
 *
 * Backs the migration-024 columns. Only geometry/plumbing lives here — the
 * licensed forfait VALUES (NTA 8800 / ISSO 82.1 tables) are gated on the
 * calc-owner transcription (docs/CALC_TASK_CHECKLIST.md Phase 2) and are NOT
 * invented here.
 */

import { r2 } from './units';

/** §2.1 forfait floor-construction thickness when not measured. */
export const DIKTE_VLOERCONSTRUCTIE_FORFAIT_MM = 300;

/**
 * §2.1 Rekenhoogte for a gevel: the manual override wins; otherwise the
 * measured (room) height plus the floor-construction thickness, defaulting
 * to the 300 mm forfait when no thickness was recorded.
 */
export function rekenhoogte(
  hoogteM: number | null | undefined,
  dikteVloerconstructieMm: number | null | undefined,
  overrideM?: number | null,
): number | null {
  if (overrideM != null) return r2(overrideM);
  if (hoogteM == null) return null;
  const dikte = dikteVloerconstructieMm ?? DIKTE_VLOERCONSTRUCTIE_FORFAIT_MM;
  return r2(hoogteM + dikte / 1000);
}

export type WarmtecapKlasse = 'licht' | 'zwaar';
export type PlafondType = 'gesloten' | 'open' | 'overig';

/**
 * §1.3 Interne warmtecapaciteit lookup (kJ/m²K) per class combination.
 *
 * The numeric values come from licensed NTA 8800 / ISSO 82.1 forfait tables
 * that are not in this repo — transcribing them is the calc Phase 2 gate with
 * the AppSheet owner. Until then every combination is null and the UI renders
 * an em dash; fill in this table (and its unit test) when the values land.
 */
const WARMTECAP_KJ_M2K: Record<string, number | null> = {
  'licht|licht|gesloten': null,
  'licht|licht|open': null,
  'licht|licht|overig': null,
  'licht|zwaar|gesloten': null,
  'licht|zwaar|open': null,
  'licht|zwaar|overig': null,
  'zwaar|licht|gesloten': null,
  'zwaar|licht|open': null,
  'zwaar|licht|overig': null,
  'zwaar|zwaar|gesloten': null,
  'zwaar|zwaar|open': null,
  'zwaar|zwaar|overig': null,
};

/** Derived kJ/m²K for a storey; null while any input or the forfait table is missing. */
export function warmtecapKJm2K(
  vloerKlasse: string | null | undefined,
  gevelKlasse: string | null | undefined,
  plafondType: string | null | undefined,
): number | null {
  if (!vloerKlasse || !gevelKlasse || !plafondType) return null;
  return WARMTECAP_KJ_M2K[`${vloerKlasse}|${gevelKlasse}|${plafondType}`] ?? null;
}

export type RcSource = 'documented' | 'observed' | 'buildyear_forfait';

/** §6 short display label for an Rc provenance value. */
export function rcSourceLabel(source: string | null | undefined): string | null {
  switch (source) {
    case 'documented':        return 'documented';
    case 'observed':          return 'observed';
    case 'buildyear_forfait': return 'forfait';
    default:                  return null;
  }
}
