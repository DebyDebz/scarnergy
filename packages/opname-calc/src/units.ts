/**
 * Unit conversion + rounding primitives.
 *
 * Moved verbatim from the three places that each had their own copy:
 *   - mobile  lib/vabiExport.ts   (r2)
 *   - web     lib/vabiXml.ts      (r2)
 *   - web     lib/calc.ts         (mmToM, fmtMeters, fmtArea, fmtEfficiencyPct)
 *
 * Rounding contract preserved exactly: 2-decimal display rounding via Number(x.toFixed(2)).
 */

/** Millimetres → metres, rounded to 2 decimals. Null-safe. */
export function mmToM(mm: number | null | undefined): number | null {
  return mm != null ? Number((mm / 1000).toFixed(2)) : null;
}

/** Round a number to 2 decimals; null-safe (the VABI-export `r2` helper). */
export function r2(n: number | null | undefined): number | null {
  return n != null ? Number(n.toFixed(2)) : null;
}

/** Format a metre value for display, e.g. `2.40 m`. */
export function fmtMeters(m: number | null | undefined): string {
  return m != null ? `${m.toFixed(2)} m` : '—';
}

/** Format a square-metre value, e.g. `12.5 m²`. */
export function fmtArea(m2: number | null | undefined): string {
  return m2 != null ? `${Number(m2.toFixed(2))} m²` : '—';
}

/** Stored efficiency is a 0–1 fraction; show as a whole percentage. */
export function fmtEfficiencyPct(efficiency: number | null | undefined): string {
  return efficiency != null ? `${(Number(efficiency) * 100).toFixed(0)}%` : '—';
}
