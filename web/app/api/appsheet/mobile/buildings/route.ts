import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '../../_auth';
import { appsheetFind, AppSheetConfigError } from '@/lib/appsheet/client';
import { mapObjectenRow, objectenSessionStatus, countRelatedIds } from '@/lib/appsheet/mappers';
import { materializeBuilding, MaterializeNotFoundError } from '@/lib/appsheet/materializeBuilding';

// Mobile-facing AppSheet reads/writes live under mobile/ rather than the
// dashboard's [table] proxy: the dashboard proxy's write actions are
// admin-gated (org/user management), but inspectors — not just admins —
// need to read buildings and materialize/close sessions from the field.
// Mapping stays server-side (mapObjectenRow) so the mobile app never needs
// its own copy of lib/appsheet/mappers.ts.

// AppSheet has no energy-label equivalent at all, so that stays defaulted.
// Zone/element counts and session/last-inspected mirror the web buildings
// list (see toBuildingSummary in web/app/(dashboard)/buildings/page.tsx) —
// same countRelatedIds/objectenSessionStatus helpers, no extra Find call.
function toBuildingSummary(row: Record<string, unknown>, bagRow: Record<string, unknown> | undefined) {
  const building = mapObjectenRow(row, bagRow);
  const { completedAt } = objectenSessionStatus(row);
  return {
    ...building,
    full_address: building.address_unresolved
      ? 'Address not yet resolved'
      : `${building.street} ${building.house_number}, ${building.postal_code} ${building.city}`.trim(),
    zone_count: countRelatedIds(row['Related Verdiepingen']),
    element_count: countRelatedIds(row['Related Gevels']) + countRelatedIds(row['Related Dakens'])
      + countRelatedIds(row['Related Vloerens']) + countRelatedIds(row['Related Installaties']),
    session_count: 1,
    last_inspection_at: completedAt,
    latest_energy_label: null,
  };
}

export async function GET(req: NextRequest) {
  const { user } = await getAuthFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [objectenResult, bagResult] = await Promise.all([
      appsheetFind('Objecten'),
      appsheetFind('BAG Data'),
    ]);
    const bagByObjectId = new Map(
      (Array.isArray(bagResult) ? bagResult : []).map((r: Record<string, unknown>) => [String(r['Object ID']), r])
    );
    const buildings = (Array.isArray(objectenResult) ? objectenResult : [])
      .map((row: Record<string, unknown>) => toBuildingSummary(row, bagByObjectId.get(String(row['Object ID']))));
    return NextResponse.json({ buildings });
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// AppSheet buildings (Objecten) have no Supabase row backing them — but
// every mobile inspection write (sessions/zones/elements) is FK-anchored to
// a real `buildings.id` uuid. This creates (or returns, if one already
// exists) a "shadow" Supabase buildings row correlated via
// `appsheet_object_id`, so the existing session/zone/element flow works
// completely unmodified against it. Idempotent: repeat calls for the same
// objectId return the same shadow row rather than creating duplicates.
export async function POST(req: NextRequest) {
  const { user, supabase } = await getAuthFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body?.action !== 'materialize') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  const objectId: string | undefined = typeof body?.objectId === 'string' ? body.objectId : undefined;
  if (!objectId) {
    return NextResponse.json({ error: 'objectId is required' }, { status: 400 });
  }

  const profileResult = await (supabase.from('user_profiles') as any)
    .select('org_id')
    .eq('id', user.id)
    .single() as unknown as { data: { org_id: string } | null };
  const orgId = profileResult.data?.org_id;
  if (!orgId) return NextResponse.json({ error: 'No organisation on profile' }, { status: 403 });

  try {
    const id = await materializeBuilding(supabase, orgId, objectId);
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof MaterializeNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
