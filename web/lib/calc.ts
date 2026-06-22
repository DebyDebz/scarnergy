/**
 * Shared derived-value calculations for the admin dashboard.
 *
 * Single source of truth for the geometry/aggregation math that previously
 * lived only inside the VABI export (lib/vabiXml.ts) and the print pages.
 * Keeping it here lets the dashboard, print views and XML export stay in sync.
 */

import type { Opening, Zone } from './types';
import { floorName } from './vabiXml';

// ── Unit conversion ──────────────────────────────────────────────────────────

/** Millimetres → metres, rounded to 2 decimals. Null-safe. */
export function mmToM(mm: number | null | undefined): number | null {
  return mm != null ? Number((mm / 1000).toFixed(2)) : null;
}

/** Format a metre value for display, e.g. `2.40 m`. */
export function fmtMeters(m: number | null | undefined): string {
  return m != null ? `${m.toFixed(2)} m` : '—';
}

/** Format a square-metre value, e.g. `12.5 m²`. */
export function fmtArea(m2: number | null | undefined): string {
  return m2 != null ? `${Number(m2.toFixed(2))} m²` : '—';
}

// ── Element efficiency ───────────────────────────────────────────────────────

/** Stored efficiency is a 0–1 fraction; show as a whole percentage. */
export function fmtEfficiencyPct(efficiency: number | null | undefined): string {
  return efficiency != null ? `${(Number(efficiency) * 100).toFixed(0)}%` : '—';
}

// ── Opening area ─────────────────────────────────────────────────────────────

/**
 * Opening area in m²: use the stored value, otherwise derive it from
 * height × width (mirrors the VABI export fallback in lib/vabiXml.ts).
 */
export function openingArea(o: Opening | null | undefined): number | null {
  if (!o) return null;
  if (o.area_m2 != null) return Number(o.area_m2.toFixed(2));
  const h = mmToM(o.height_mm);
  const w = mmToM(o.width_mm);
  return h != null && w != null ? Number((h * w).toFixed(2)) : null;
}

// ── Floor area aggregation ───────────────────────────────────────────────────

/** Sum of gross floor area across all zones. */
export function totalZoneArea(zones: Zone[]): number {
  return zones.reduce((sum, z) => sum + (z.gross_area_m2 ?? 0), 0);
}

export interface FloorAreaRow {
  level: number;
  name: string;
  area: number;
}

/** Per-floor-level gross area totals, sorted by level. */
export function areaByFloor(zones: Zone[]): FloorAreaRow[] {
  const byLevel = zones.reduce<Record<number, number>>((acc, z) => {
    acc[z.floor_level] = (acc[z.floor_level] ?? 0) + (z.gross_area_m2 ?? 0);
    return acc;
  }, {});
  return Object.entries(byLevel)
    .map(([lvl, area]) => ({ level: Number(lvl), name: floorName(Number(lvl)), area }))
    .sort((a, b) => a.level - b.level);
}
