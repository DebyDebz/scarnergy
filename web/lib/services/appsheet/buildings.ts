import type { BuildingService } from '../types';
import { mapObjectenRow, escapeForSelector } from '@/lib/appsheet/mappers';

// AppSheet-side "Objecten" -> Building, joined with "BAG Data" (via
// Object ID). Calls the server-side proxy at
// web/app/api/appsheet/[table]/route.ts — never the AppSheet API directly
// from a client component. Field mapping (incl. the construction_year/
// gross_floor_area_m2 BAG Data join and the address parse) lives in
// lib/appsheet/mappers.ts, shared with the server-component pages that call
// AppSheet directly.
function appsheetFindProxy(table: string, selector?: string) {
  return fetch(`/api/appsheet/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selector }),
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `AppSheet proxy call to "${table}" failed (${res.status})`);
    }
    return res.json();
  });
}

async function fetchBagDataByObjectId(objectId?: string): Promise<Map<string, Record<string, unknown>>> {
  const selector = objectId
    ? `FILTER("BAG Data", [Object ID] = "${escapeForSelector(objectId)}")`
    : undefined;
  const result = await appsheetFindProxy('BAG Data', selector);
  const rows: Record<string, unknown>[] = Array.isArray(result) ? result : [];
  return new Map(rows.map((r) => [String(r['Object ID']), r]));
}

export const appsheetBuildingService: BuildingService = {
  async list(orgId) {
    const [objectenResult, bagByObjectId] = await Promise.all([
      appsheetFindProxy(
        'Objecten',
        orgId ? `FILTER(Objecten, [Bedrijfs ID] = "${escapeForSelector(orgId)}")` : undefined
      ),
      fetchBagDataByObjectId(),
    ]);
    const rows: Record<string, unknown>[] = Array.isArray(objectenResult) ? objectenResult : [];
    return rows.map((row) => mapObjectenRow(row, bagByObjectId.get(String(row['Object ID']))));
  },

  async get(id) {
    const [objectenResult, bagByObjectId] = await Promise.all([
      appsheetFindProxy('Objecten', `FILTER(Objecten, [Object ID] = "${escapeForSelector(id)}")`),
      fetchBagDataByObjectId(id),
    ]);
    const row = Array.isArray(objectenResult) ? objectenResult[0] : undefined;
    return row ? mapObjectenRow(row, bagByObjectId.get(String(row['Object ID']))) : null;
  },
};
