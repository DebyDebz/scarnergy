/**
 * VABI XML generation for web API routes.
 *
 * The builder itself lives in @scarnergy/opname-calc (shared verbatim with the
 * mobile app — Phase 1 exporter collapse; locked by the mobile golden test).
 * This module only re-exports it under this route's historical import path and
 * type names.
 */

export {
  buildVabiXml,
  esc, r2, toCardinal, floorId, floorName,
  openingTypeVabi, frameMatVabi, glazingVabi, installTypeVabi,
  gevelpositie, grenztAan, dakType,
} from '@scarnergy/opname-calc';

export type {
  VabiSessionInfo as VabiSession,
  VabiBuildingInfo as VabiBuilding,
  VabiOrgInfo as VabiOrg,
  VabiRekenzone,
} from '@scarnergy/opname-calc';
