import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '../../_auth';
import { AppSheetConfigError } from '@/lib/appsheet/client';
import { materializeBuilding, materializeSession, MaterializeNotFoundError } from '@/lib/appsheet/materializeBuilding';

// Lets an inspector draw a floor plan from scratch on an AppSheet-sourced
// building that has no zones recorded yet (see /tabs/sessions/appsheet-detail's
// "No floor data recorded" empty state) — materializes the Supabase shadow
// building + an active session, exactly like tabs/buildings.tsx's own "Start
// Inspection" button, so /tabs/sessions/flow (drawing/BLE, all Supabase-only)
// runs completely unmodified against it.
export async function POST(req: NextRequest) {
  const { user, supabase } = await getAuthFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const objectId: string | undefined = typeof body?.objectId === 'string' ? body.objectId : undefined;
  if (!objectId) return NextResponse.json({ error: 'objectId is required' }, { status: 400 });

  const profileResult = await (supabase.from('user_profiles') as any)
    .select('org_id')
    .eq('id', user.id)
    .single() as unknown as { data: { org_id: string } | null };
  const orgId = profileResult.data?.org_id;
  if (!orgId) return NextResponse.json({ error: 'No organisation on profile' }, { status: 403 });

  try {
    const buildingId = await materializeBuilding(supabase, orgId, objectId);
    const sessionId = await materializeSession(supabase, orgId, buildingId, user.id);
    return NextResponse.json({ buildingId, sessionId });
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
