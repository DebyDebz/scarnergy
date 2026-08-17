import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '../../_auth';
import { appsheetFind, AppSheetConfigError } from '@/lib/appsheet/client';
import { mapObjectenToSessionSummary, parseAppsheetDateTime } from '@/lib/appsheet/mappers';

// Mirrors web/app/(dashboard)/dashboard/page.tsx's AppsheetDashboardPage —
// same active-session derivation (via mapObjectenToSessionSummary) and the
// same real Metingen-backed measurements count. Kept as one aggregate call
// rather than three separate mobile proxy round-trips so the mobile
// dashboard's stats and recent-sessions list are always computed from the
// exact same Objecten/Metingen snapshot.
export async function GET(req: NextRequest) {
  const { user } = await getAuthFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [objectenResult, inspecteursResult, metingenResult] = await Promise.all([
      appsheetFind('Objecten'),
      appsheetFind('Inspecteurs'),
      appsheetFind('Metingen'),
    ]);
    const inspecteurNameById = new Map(
      (Array.isArray(inspecteursResult) ? inspecteursResult : [])
        .map((r: Record<string, unknown>) => [String(r['Inspecteur ID']), String(r['Inspecteur Naam'] ?? '')])
    );
    const allSessions = (Array.isArray(objectenResult) ? objectenResult : [])
      .map((row: Record<string, unknown>) => mapObjectenToSessionSummary(row, inspecteurNameById));
    const activeSessions = allSessions.filter(s => s.status === 'active').length;
    const recentSessions = [...allSessions]
      .sort((a, b) =>
        (parseAppsheetDateTime(b.started_at)?.getTime() ?? 0) - (parseAppsheetDateTime(a.started_at)?.getTime() ?? 0)
      )
      .slice(0, 5);

    const todayISODate = new Date().toISOString().slice(0, 10);
    const measurementsToday = (Array.isArray(metingenResult) ? metingenResult : [])
      .filter((r: Record<string, unknown>) => parseAppsheetDateTime(r['Tijdstip'])?.toISOString().slice(0, 10) === todayISODate)
      .length;

    return NextResponse.json({
      activeSessions,
      totalBuildings: Array.isArray(objectenResult) ? objectenResult.length : 0,
      measurementsToday,
      recentSessions,
    });
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
