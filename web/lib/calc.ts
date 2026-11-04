/**
 * Shared derived-value calculations for the admin dashboard.
 *
 * The geometry/unit primitives now live in the cross-app package
 * @scarnergy/opname-calc (single source of truth shared with the mobile app).
 * This module re-exports them so existing web imports (`@/lib/calc`) keep working
 * unchanged, and adds any web-only display sugar on top.
 *
 * See docs/CALC_ARCHITECTURE_PLAN.md.
 */

export {
  mmToM,
  fmtMeters,
  fmtArea,
  fmtEfficiencyPct,
  openingArea,
  totalZoneArea,
  areaByFloor,
} from '@scarnergy/opname-calc';

export type { FloorAreaRow } from '@scarnergy/opname-calc';
