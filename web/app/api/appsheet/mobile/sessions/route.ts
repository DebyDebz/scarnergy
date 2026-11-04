import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '../../_auth';
import { appsheetFind, AppSheetConfigError } from '@/lib/appsheet/client';
import { mapObjectenToSessionSummary, escapeForSelector } from '@/lib/appsheet/mappers';

// Mirrors web/app/(dashboard)/sessions/page.tsx's AppSheet branch: each
// Objecten row is treated as one pseudo-session (see mapObjectenToSessionSummary
// for why). Mobile has no server component to run this in, hence this proxy —
// same shape the web dashboard already renders, so the mobile sessions list
// and the web sessions page never drift apart.
export async function GET(req: NextRequest) {
  const { user } = await getAuthFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const buildingId = req.nextUrl.searchParams.get('buildingId');

  try {
    const [objectenResult, inspecteursResult] = await Promise.all([
      appsheetFind(
        'Objecten',
        buildingId ? `FILTER(Objecten, [Object ID] = "${escapeForSelector(buildingId)}")` : undefined
      ),
      appsheetFind('Inspecteurs'),
    ]);
    const inspecteurNameById = new Map(
      (Array.isArray(inspecteursResult) ? inspecteursResult : [])
        .map((r: Record<string, unknown>) => [String(r['Inspecteur ID']), String(r['Inspecteur Naam'] ?? '')])
    );
    const sessions = (Array.isArray(objectenResult) ? objectenResult : [])
      .map((row: Record<string, unknown>) => mapObjectenToSessionSummary(row, inspecteurNameById));
    return NextResponse.json({ sessions });
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
