import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '../../_auth';
import { appsheetFind, AppSheetConfigError } from '@/lib/appsheet/client';
import { mapObjectenToSessionSummary, escapeForSelector } from '@/lib/appsheet/mappers';
import { fetchAppsheetBuildingBundle } from '@/lib/appsheet/buildingBundle';

// Mobile detail view for one AppSheet pseudo-session (see mapObjectenToSessionSummary
// for why an Objecten row IS the session). Reuses the same building-bundle fetch
// the VABI export/print report already rely on for zones/elements/openings, plus
// the sessions list's own summary mapper for status/code/dates, so this screen
// can never drift from what /tabs/sessions already shows for the row.
export async function GET(req: NextRequest) {
  const { user } = await getAuthFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const objectId = req.nextUrl.searchParams.get('objectId');
  if (!objectId) return NextResponse.json({ error: 'objectId is required' }, { status: 400 });

  try {
    const [objectenResult, inspecteursResult, bundle] = await Promise.all([
      appsheetFind('Objecten', `FILTER(Objecten, [Object ID] = "${escapeForSelector(objectId)}")`),
      appsheetFind('Inspecteurs'),
      fetchAppsheetBuildingBundle(objectId),
    ]);
    const row = Array.isArray(objectenResult) ? objectenResult[0] : undefined;
    if (!row || !bundle) {
      return NextResponse.json({ error: `No AppSheet session found for objectId "${objectId}"` }, { status: 404 });
    }

    const inspecteurNameById = new Map(
      (Array.isArray(inspecteursResult) ? inspecteursResult : [])
        .map((r: Record<string, unknown>) => [String(r['Inspecteur ID']), String(r['Inspecteur Naam'] ?? '')])
    );
    const session = mapObjectenToSessionSummary(row, inspecteurNameById);

    return NextResponse.json({
      session,
      zones: bundle.zones,
      elements: bundle.elements,
      openings: bundle.openings,
      rekenzones: bundle.rekenzones,
    });
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
