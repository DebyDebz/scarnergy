import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

// "Sla op als Standaard" (GAP W4): one saved default payload per element kind
// per org. GET ?kind=… reads it, PUT { element_kind, payload } upserts it.
// RLS scopes both to the caller's org; the payload is stored as-is and
// re-filtered through the element/opening whitelists when applied+saved.

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const kind = req.nextUrl.searchParams.get('kind');
  if (!kind) return NextResponse.json({ error: 'kind is required' }, { status: 400 });

  const { data } = await (supabase.from('element_defaults') as any)
    .select('payload, updated_at')
    .eq('element_kind', kind)
    .maybeSingle();

  return NextResponse.json({ payload: data?.payload ?? null, updated_at: data?.updated_at ?? null });
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const kind = body?.element_kind;
  const payload = body?.payload;
  if (typeof kind !== 'string' || !kind || payload == null || typeof payload !== 'object') {
    return NextResponse.json({ error: 'element_kind and payload are required' }, { status: 400 });
  }

  const profileRes = await (supabase.from('user_profiles') as any)
    .select('org_id')
    .eq('id', user.id)
    .single() as unknown as { data: { org_id: string } | null };
  if (!profileRes.data) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { error } = await (supabase.from('element_defaults') as any)
    .upsert(
      { org_id: profileRes.data.org_id, element_kind: kind, payload },
      { onConflict: 'org_id,element_kind' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
