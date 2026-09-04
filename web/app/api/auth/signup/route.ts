import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';

// Self-serve sign-up — but scoped to "create a brand-new organisation and
// become its first admin", not "join an existing org". Joining an existing
// org already has a working, admin-initiated path (/api/users/invite) —
// a self-serve "pick any org_id" flow would mean trusting a client-supplied
// org_id to grant RLS-scoped read access to that org's data, which is
// exactly the privilege-boundary problem migration 032 closed for
// supabase.auth.signUp()'s metadata. This route never touches that public
// signUp() API at all — it creates the org and the user directly with the
// service-role client, then does its own explicit user_profiles upsert
// (same proven shape as /api/users/invite/route.ts), so it never depends
// on trusting anything the client sends beyond the org name / user's own
// name+email+password.
export async function POST(req: NextRequest) {
  const { orgName, fullName, email, password } = await req.json().catch(() => ({}));

  if (!orgName?.trim()) {
    return NextResponse.json({ error: 'Organisation name is required' }, { status: 400 });
  }
  if (!fullName?.trim()) {
    return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
  }
  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const serviceClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const orgResult = await (serviceClient.from('organisations') as any)
    .insert({ name: orgName.trim(), settings: {} })
    .select('id')
    .single();
  if (orgResult.error) {
    return NextResponse.json({ error: orgResult.error.message }, { status: 500 });
  }
  const orgId = orgResult.data.id;

  // service-role admin.createUser, NOT the public signUp() API — this is
  // exactly what keeps org_id/role assignment out of client-controlled
  // metadata (see migration 032's comment). email_confirm: true because
  // this is a direct self-serve signup, not an admin inviting a third
  // party — there's no one else's inbox to verify ownership of.
  const userResult = await serviceClient.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: fullName.trim() },
  });
  if (userResult.error || !userResult.data.user) {
    // Roll back the org so a failed signup doesn't leave an orphaned,
    // user-less organisation behind.
    await (serviceClient.from('organisations') as any).delete().eq('id', orgId);
    return NextResponse.json({ error: userResult.error?.message ?? 'Could not create user' }, { status: 400 });
  }

  const profileResult = await (serviceClient.from('user_profiles') as any).upsert({
    id: userResult.data.user.id,
    org_id: orgId,
    role: 'admin',
    full_name: fullName.trim(),
    is_active: true,
    status: 'approved',
  });
  if (profileResult.error) {
    return NextResponse.json({ error: profileResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
