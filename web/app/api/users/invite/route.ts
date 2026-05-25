import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';

export async function POST(req: NextRequest) {
  const { email, full_name, role, org_id } = await req.json();

  const serviceClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name, role, org_id },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await (serviceClient.from('user_profiles') as any).upsert({
    id: data.user.id,
    org_id,
    role,
    full_name,
    is_active: true,
  });

  return NextResponse.json({ ok: true });
}
