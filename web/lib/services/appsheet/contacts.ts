import type { ContactService } from '../types';
import { mapContactpersoonRow, escapeForSelector } from '@/lib/appsheet/mappers';

// AppSheet-side "Contactpersoon" -> Contact, per
// docs/CONTACTPERSOON_DATA_ANALYSIS.md §1/§4. Calls the server proxy at
// /api/appsheet/[table] (never the AppSheet API directly from a client
// component — the ApplicationAccessKey stays server-side, see
// web/lib/appsheet/client.ts).
//
// The relationship is Objecten.Contactpersoon ID -> Contactpersoon, so
// listByBuilding resolves via the building's Objecten row, not a
// building_id column (that FK doesn't exist on this side). `buildingId`
// here must be an AppSheet Object ID (confirmed field name, see
// lib/appsheet/mappers.ts) — not a ScanergyV2 building UUID.
async function appsheetFindProxy(table: string, selector?: string) {
  const res = await fetch(`/api/appsheet/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selector }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `AppSheet proxy call to "${table}" failed (${res.status})`);
  }
  return res.json();
}

export const appsheetContactService: ContactService = {
  async listByBuilding(buildingId) {
    const objectenResult = await appsheetFindProxy(
      'Objecten',
      `FILTER(Objecten, [Object ID] = "${escapeForSelector(buildingId)}")`
    );
    const objectRow = Array.isArray(objectenResult) ? objectenResult[0] : undefined;
    const contactId = objectRow?.['Contactpersoon ID'];
    if (!contactId) return [];

    const contactResult = await appsheetFindProxy(
      'Contactpersoon',
      `FILTER(Contactpersoon, [Contactpersoon ID] = "${escapeForSelector(String(contactId))}")`
    );
    const contactRow = Array.isArray(contactResult) ? contactResult[0] : undefined;
    return contactRow ? [mapContactpersoonRow(contactRow)] : [];
  },

  async get(id) {
    const result = await appsheetFindProxy(
      'Contactpersoon',
      `FILTER(Contactpersoon, [Contactpersoon ID] = "${escapeForSelector(id)}")`
    );
    const row = Array.isArray(result) ? result[0] : undefined;
    return row ? mapContactpersoonRow(row) : null;
  },
};
