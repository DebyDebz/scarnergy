import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const profileResult = await (supabase.from('user_profiles') as any)
    .select('role')
    .eq('id', user.id)
    .single() as unknown as { data: { role: string } | null };

  if (!profileResult.data || profileResult.data.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const buildingResult = await (supabase.from('buildings') as any)
    .select('org_id')
    .eq('id', params.id)
    .single() as unknown as { data: { org_id: string } | null };

  if (!buildingResult.data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const orgId = buildingResult.data.org_id;

  // Collect storage paths before the DB delete — cascades remove the DB rows
  // (zones/elements/openings/sessions/measurements/rekenzones/facade photos)
  // but not the underlying Storage objects, which must be removed separately.
  const zonesResult = await (supabase.from('zones') as any)
    .select('id')
    .eq('building_id', params.id) as unknown as { data: { id: string }[] | null };

  const floorPlanPaths: string[] = [];
  for (const zone of zonesResult.data ?? []) {
    const { data: files } = await supabase.storage
      .from('floor-plans')
      .list(`${params.id}/${zone.id}`);
    for (const file of files ?? []) {
      floorPlanPaths.push(`${params.id}/${zone.id}/${file.name}`);
    }
  }

  const { data: facadeFiles } = await supabase.storage
    .from('facade-photos')
    .list(`${orgId}/${params.id}`);
  const facadePaths = (facadeFiles ?? []).map((f) => `${orgId}/${params.id}/${f.name}`);

  // Hard delete: FK cascades remove every dependent row (zones, elements,
  // openings, inspection sessions, measurements, rekenzones, facade photos),
  // so the building disappears from both the web dashboard and mobile app.
  const { error } = await (supabase.from('buildings') as any)
    .delete()
    .eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (floorPlanPaths.length) {
    await supabase.storage.from('floor-plans').remove(floorPlanPaths);
  }
  if (facadePaths.length) {
    await supabase.storage.from('facade-photos').remove(facadePaths);
  }

  return NextResponse.json({ ok: true });
}
