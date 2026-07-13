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

import { mmToM } from './units';

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
