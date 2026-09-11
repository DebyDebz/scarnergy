import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

// Verdieping/zone edit (GAP W2): Hoogte, GebruiksOppervlakte, Notities.
// Same whitelist pattern as /api/elements/[id]; RLS scopes the update to the
// caller's org. The storey's plafond/warmtecapaciteit fields live on the
// zone's vloer element and go through /api/elements/[id].
const ZONE_FIELDS = ['ceiling_height_m', 'gross_area_m2', 'description'] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  const update: Record<string, unknown> = {};
  for (const key of ZONE_FIELDS) {
    if (key in body && body[key] !== undefined) {
      update[key] = body[key];
    }
  }

  if (Object.keys(update).length > 0) {
    const { error } = await (supabase.from('zones') as any)
      .update(update)
      .eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
