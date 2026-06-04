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

  // Soft-delete: flag inactive instead of hard-deleting, so the building's
  // zones/sessions/measurements aren't cascade-wiped. Hidden everywhere by
  // the summary views' is_active filter.
  const { error } = await (supabase.from('buildings') as any)
    .update({ is_active: false })
    .eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
