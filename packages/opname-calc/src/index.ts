/**
 * @scarnergy/opname-calc — shared, dependency-free opname primitives.
 *
 * Phase 1 scope: unit + geometry primitives only (behaviour-preserving move of
 * math that was duplicated across mobile and web). The authoritative NTA 8800
 * engine (Rc/U/HT/U_eq/label) lands here in later phases per
 * docs/CALC_ARCHITECTURE_PLAN.md.
 */

export * from './units';
export * from './geometry';
export * from './thickness';
export * from './vabi';
export * from './nta';
