// Shared AppSheet-sourced "everything needed to export a building" fetch —
// used by the VABI XML export route and the print report page, both of
// which need the exact same building/zones/elements/openings/rekenzones/org/
// session shapes AppsheetBuildingDetail already assembles inline. Kept as a
// separate helper rather than refactoring that already-verified page, so
// this is purely additive.

import { appsheetFind } from '@/lib/appsheet/client';
import {
  mapObjectenRow, mapBedrijvenRow, mapVerdiepingRow, mapRekenzoneRow,
  mapGevelRow, mapDakRow, mapVloerRow, mapInstallatieRow, mapTransparantDeelRow,
  firstZoneIdForRekenzone, escapeForSelector,
} from '@/lib/appsheet/mappers';
import type { Building, Zone, Rekenzone, BuildingElement, Opening } from '@/lib/types';

export interface AppsheetBuildingBundle {
  building: Building;
  org: { name: string | null };
  session: { building_address: string; building_city: string; inspector_name: string; started_at: string | null };
  zones: Zone[];
  elements: BuildingElement[];
  openings: Opening[];
  rekenzones: Rekenzone[];
}

export async function fetchAppsheetBuildingBundle(objectId: string): Promise<AppsheetBuildingBundle | null> {
  const idFilter = escapeForSelector(objectId);
  const [
    objectenResult, bagResult, verdiepingenResult, rekenzonesResult,
    gevelsResult, dakenResult, vloerenResult, installatiesResult, openingenResult,
    inspecteursResult,
  ] = await Promise.all([
    appsheetFind('Objecten', `FILTER(Objecten, [Object ID] = "${idFilter}")`),
    appsheetFind('BAG Data', `FILTER("BAG Data", [Object ID] = "${idFilter}")`),
    appsheetFind('Verdiepingen', `FILTER(Verdiepingen, [Object ID] = "${idFilter}")`),
    appsheetFind('Rekenzones', `FILTER(Rekenzones, [Object ID] = "${idFilter}")`),
    appsheetFind('Gevels', `FILTER(Gevels, [Object ID virtual] = "${idFilter}")`),
    appsheetFind('Daken', `FILTER(Daken, [Object ID virtual] = "${idFilter}")`),
    appsheetFind('Vloeren', `FILTER(Vloeren, [Object ID virtual] = "${idFilter}")`),
    appsheetFind('Installaties', `FILTER(Installaties, [Object ID virtual] = "${idFilter}")`),
    appsheetFind('Transparante_Delen', `FILTER(Transparante_Delen, [Object ID virtual] = "${idFilter}")`),
    appsheetFind('Inspecteurs'),
  ]);

  const row = Array.isArray(objectenResult) ? objectenResult[0] : undefined;
  if (!row) return null;

  const bagRow = Array.isArray(bagResult) ? bagResult[0] : undefined;
  const building = mapObjectenRow(row, bagRow);

  let org: { name: string | null } = { name: null };
  if (building.org_id) {
    const bedrijfIdFilter = escapeForSelector(building.org_id);
    const bedrijvenResult = await appsheetFind('Bedrijven', `FILTER(Bedrijven, [Bedrijf ID] = "${bedrijfIdFilter}")`);
    const bedrijfRow = Array.isArray(bedrijvenResult) ? bedrijvenResult[0] : undefined;
    if (bedrijfRow) org = { name: mapBedrijvenRow(bedrijfRow).name };
  }

  const inspecteurNameById = new Map(
    (Array.isArray(inspecteursResult) ? inspecteursResult : [])
      .map((r: Record<string, unknown>) => [String(r['Inspecteur ID']), String(r['Inspecteur Naam'] ?? '')])
  );
  const opnameDatum = String(row['Opname Datum'] ?? '');
  const opnameTijd = String(row['Opname Tijd'] ?? '');
  const session = {
    building_address: building.address_unresolved ? 'Address not yet resolved' : `${building.street} ${building.house_number}`.trim(),
    building_city: building.address_unresolved ? '' : building.city,
    inspector_name: inspecteurNameById.get(String(row['Inspecteur'] ?? '')) ?? '—',
    started_at: opnameDatum ? `${opnameDatum} ${opnameTijd}`.trim() : null,
  };

  const rekenzoneRows: Record<string, unknown>[] = Array.isArray(rekenzonesResult) ? rekenzonesResult : [];
  const rekenzones: Rekenzone[] = rekenzoneRows.map(mapRekenzoneRow);
  const zoneIdByRekenzone = new Map<string, string>(
    rekenzoneRows.map(r => [String(r['Rekenzone ID'] ?? ''), firstZoneIdForRekenzone(r)])
  );

  const zones: Zone[] = (Array.isArray(verdiepingenResult) ? verdiepingenResult : []).map(mapVerdiepingRow);

  const gevels = (Array.isArray(gevelsResult) ? gevelsResult : []).map(mapGevelRow);
  const daken = (Array.isArray(dakenResult) ? dakenResult : []).map((r: Record<string, unknown>) =>
    mapDakRow(r, zoneIdByRekenzone.get(String(r['Rekenzone ID'] ?? '')) ?? ''));
  const vloeren = (Array.isArray(vloerenResult) ? vloerenResult : []).map((r: Record<string, unknown>) =>
    mapVloerRow(r, zoneIdByRekenzone.get(String(r['Rekenzone ID'] ?? '')) ?? ''));
  const installaties = (Array.isArray(installatiesResult) ? installatiesResult : []).map((r: Record<string, unknown>) =>
    mapInstallatieRow(r, zoneIdByRekenzone.get(String(r['Rekenzone ID'] ?? '')) ?? ''));
  const elements: BuildingElement[] = [...gevels, ...daken, ...vloeren, ...installaties];

  const openings: Opening[] = (Array.isArray(openingenResult) ? openingenResult : []).map(mapTransparantDeelRow);

  return { building, org, session, zones, elements, openings, rekenzones };
}
