import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '../../_auth';
import { appsheetFind, AppSheetConfigError } from '@/lib/appsheet/client';
import { mapObjectenRow } from '@/lib/appsheet/mappers';

// Mobile-facing AppSheet reads/writes live under mobile/ rather than the
// dashboard's [table] proxy: the dashboard proxy's write actions are
// admin-gated (org/user management), but inspectors — not just admins —
// need to read buildings and materialize/close sessions from the field.
// Mapping stays server-side (mapObjectenRow) so the mobile app never needs
// its own copy of lib/appsheet/mappers.ts.

function toBuildingSummary(row: Record<string, unknown>, bagRow: Record<string, unknown> | undefined) {
  const building = mapObjectenRow(row, bagRow);
  return {
    ...building,
    full_address: `${building.street} ${building.house_number}, ${building.postal_code} ${building.city}`.trim(),
    zone_count: 0,
    element_count: 0,
    session_count: 0,
    last_inspection_at: null,
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

  const existing = await (supabase.from('buildings') as any)
    .select('id')
    .eq('appsheet_object_id', objectId)
    .maybeSingle() as unknown as { data: { id: string } | null };
  if (existing.data) {
    return NextResponse.json({ id: existing.data.id });
  }

  let objectenRow: Record<string, unknown> | undefined;
  let bagRow: Record<string, unknown> | undefined;
  try {
    const [objectenResult, bagResult] = await Promise.all([
      appsheetFind('Objecten', `FILTER(Objecten, [Object ID] = "${objectId}")`),
      appsheetFind('BAG Data', `FILTER("BAG Data", [Object ID] = "${objectId}")`),
    ]);
    objectenRow = Array.isArray(objectenResult) ? objectenResult[0] : undefined;
    bagRow = Array.isArray(bagResult) ? bagResult[0] : undefined;
  } catch (err) {
    if (err instanceof AppSheetConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unknown AppSheet error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (!objectenRow) {
    return NextResponse.json({ error: `No AppSheet building found for objectId "${objectId}"` }, { status: 404 });
  }

  const building = mapObjectenRow(objectenRow, bagRow);
  const buildingType = building.building_type === 'Woning' ? 'residential_single' : 'other';

  const inserted = await (supabase.from('buildings') as any)
    .insert({
      org_id: orgId,
      appsheet_object_id: objectId,
      reference_code: building.reference_code,
      street: building.street || 'Unknown',
      house_number: building.house_number || '',
      postal_code: building.postal_code || '',
      city: building.city || 'Unknown',
      building_type: buildingType,
      construction_year: building.construction_year || null,
      gross_floor_area_m2: building.gross_floor_area_m2 || null,
    })
    .select('id')
    .single() as unknown as { data: { id: string } | null; error: { message: string } | null };

  if (inserted.error || !inserted.data) {
    return NextResponse.json({ error: inserted.error?.message ?? 'Failed to materialize building' }, { status: 500 });
  }
  return NextResponse.json({ id: inserted.data.id });
}
