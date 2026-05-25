import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import type { Role } from '@/lib/types';

const VALID_ROLES: Role[] = ['inspector', 'supervisor', 'admin'];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { role } = await req.json();

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const supabase = await createServiceClient();
  const { error } = await (supabase.from('user_profiles') as any).update({ role }).eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
