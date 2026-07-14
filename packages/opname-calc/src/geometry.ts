/**
 * Dependency-free geometry / aggregation primitives shared by both apps.
 *
 * Moved verbatim (behaviour-preserving) from:
 *   - mobile  lib/vabiExport.ts   (toCardinal, floorId, floorName)
 *   - web     lib/vabiXml.ts      (toCardinal, floorId, floorName)
 *   - web     lib/calc.ts         (openingArea, totalZoneArea, areaByFloor)
 *
 * These use structural (duck-typed) inputs so the package stays free of any
 * app-specific Supabase types.
 */

import { mmToM, r2 } from './units';

// ── Orientation ───────────────────────────────────────────────────────────────

/** Degrees → Dutch cardinal label (VABI Orientatie convention). Null → ''. */
export function toCardinal(deg: number | null | undefined): string {
  if (deg == null) return '';
  const d = ((deg % 360) + 360) % 360;
  const dirs = [
    'Noord', 'Noord-Oost', 'Oost', 'Zuid-Oost',
    'Zuid', 'Zuid-West', 'West', 'Noord-West',
  ];
  return dirs[Math.round(d / 45) % 8];
}

// ── Floor levels ────────────────────────────────────────────────────────────

/** Floor-level number → VABI Verdieping id (0 → 'Bg', n → 'Vn'). */
export function floorId(level: number): string {
  return level === 0 ? 'Bg' : `V${level}`;
}

/** Floor-level number → Dutch display name. */
export function floorName(level: number): string {
  if (level === 0) return 'Begane grond';
  if (level === 1) return 'Eerste verdieping';
  if (level === 2) return 'Tweede verdieping / zolder';
  return `Verdieping ${level}`;
}

// ── Opening area ──────────────────────────────────────────────────────────────

/** Minimal shape needed to derive an opening's area. */
export interface OpeningLike {
  area_m2?: number | null;
  height_mm?: number | null;
  width_mm?: number | null;
}

/**
 * Opening area in m²: use the stored value, otherwise derive from height × width
 * (mirrors the VABI export fallback exactly).
 */
export function openingArea(o: OpeningLike | null | undefined): number | null {
  if (!o) return null;
  if (o.area_m2 != null) return Number(o.area_m2.toFixed(2));
  const h = mmToM(o.height_mm);
  const w = mmToM(o.width_mm);
  return h != null && w != null ? Number((h * w).toFixed(2)) : null;
}

// ── Floor-area aggregation ────────────────────────────────────────────────────

/** Minimal shape needed to aggregate zone floor areas. */
export interface ZoneLike {
  floor_level: number;
  gross_area_m2?: number | null;
}

/** Sum of gross floor area across all zones. */
export function totalZoneArea(zones: ZoneLike[]): number {
  return zones.reduce((sum, z) => sum + (z.gross_area_m2 ?? 0), 0);
}

// ── Roof area breakdown (AppSheet "Totaal Oppervlakte Gaten" / "Netto Dakoppervlak") ──

/** Minimal shape of a dak / dakkapel element for roof-area math. */
export interface RoofLike {
  length_mm?: number | null;
  width_mm?: number | null;
}

/**
 * Dakkapel footprint in m² (breedte × diepte), using the same per-dimension
 * r2 rounding the VABI export applies to dakkapel Breedte/Diepte.
 */
export function dakkapelFootprint(dk: RoofLike): number | null {
  const b = dk.width_mm  != null ? r2(dk.width_mm  / 1000) : null;
  const d = dk.length_mm != null ? r2(dk.length_mm / 1000) : null;
  return b != null && d != null ? r2(b * d) : null;
}

export interface RoofAreaBreakdown {
  /** Bruto = lengte × breedte (VABI <BrutoOppervlakte> formula), null when dims missing. */
  bruto: number | null;
  /** Totaal oppervlakte gaten: sum of opening areas in the roof plane. */
  gaten: number;
  /** Sum of dakkapel footprints on this roof. */
  dakkapellen: number;
  /** Netto dakoppervlak = bruto − gaten − dakkapellen (clamped ≥ 0). */
  netto: number | null;
}

/**
 * Roof area breakdown per the AppSheet reference: bruto (same math as the VABI
 * export's <BrutoOppervlakte>), total opening ("gaten") area, dakkapel
 * footprints, and the resulting netto dakoppervlak. Single source of truth —
 * web UI, print report and future engine phases use this rather than
 * re-deriving it.
 */
export function roofAreaBreakdown(
  dak: RoofLike,
  openings: OpeningLike[] = [],
  dakkapellen: RoofLike[] = [],
): RoofAreaBreakdown {
  const lengte  = dak.length_mm != null ? r2(dak.length_mm / 1000) : null;
  const breedte = dak.width_mm  != null ? r2(dak.width_mm  / 1000) : null;
  const bruto   = lengte != null && breedte != null ? r2(lengte * breedte) : null;

  const gaten = r2(openings.reduce((s, o) => s + (openingArea(o) ?? 0), 0)) ?? 0;
  const dkSum = r2(dakkapellen.reduce((s, dk) => s + (dakkapelFootprint(dk) ?? 0), 0)) ?? 0;

  const netto = bruto != null ? r2(Math.max(0, bruto - gaten - dkSum)) : null;
  return { bruto, gaten, dakkapellen: dkSum, netto };
}

export interface FloorAreaRow {
  level: number;
  name: string;
  area: number;
}

/** Per-floor-level gross-area totals, sorted by level. */
export function areaByFloor(zones: ZoneLike[]): FloorAreaRow[] {
  const byLevel = zones.reduce<Record<number, number>>((acc, z) => {
    acc[z.floor_level] = (acc[z.floor_level] ?? 0) + (z.gross_area_m2 ?? 0);
    return acc;
  }, {});
  return Object.entries(byLevel)
    .map(([lvl, area]) => ({ level: Number(lvl), name: floorName(Number(lvl)), area }))
    .sort((a, b) => a.level - b.level);
}
