import type { OrganisationService } from '../types';
import { mapBedrijvenRow, escapeForSelector } from '@/lib/appsheet/mappers';

// AppSheet-side "Bedrijven" -> Organisation. Calls the server-side proxy at
// web/app/api/appsheet/[table]/route.ts — never the AppSheet API directly
// from a client component (the ApplicationAccessKey stays server-side; see
// web/lib/appsheet/client.ts). Field mapping confirmed against a live
// response (2 rows: Energeticas, Krontiva) — see lib/appsheet/mappers.ts.
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

export const appsheetOrganisationService: OrganisationService = {
  async list() {
    const result = await appsheetFindProxy('Bedrijven');
    return Array.isArray(result) ? result.map(mapBedrijvenRow) : [];
  },
  async get(id) {
    const result = await appsheetFindProxy(
      'Bedrijven',
      `FILTER(Bedrijven, [Bedrijf ID] = "${escapeForSelector(id)}")`
    );
    const row = Array.isArray(result) ? result[0] : undefined;
    return row ? mapBedrijvenRow(row) : null;
  },
};
