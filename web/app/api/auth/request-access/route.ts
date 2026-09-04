import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Self-serve "join an existing organisation" signup — distinct from
// /api/auth/signup (which creates a brand-new org + its first admin).
// Same trust-boundary shape as that route and /api/users/invite: this
// never touches the public supabase.auth.signUp() API (client-controlled
// metadata), it creates the auth user with the service-role client and
// does its own explicit user_profiles upsert. The account is created
// with is_active: false, status: 'pending' — custom_access_token_hook()
// (migration 006) already nulls org_id in the JWT whenever is_active is
// false, so the account genuinely cannot read/write any org data until
// an admin approves it via /api/users/[id]/approve. Role is hardcoded to
// 'inspector', same reasoning as migration 032 — an admin can promote
// after approval via the existing ChangeRoleButton.
export async function POST(req: NextRequest) {
  const { orgId, fullName, email, password } = await req.json().catch(() => ({}));

  if (!orgId?.trim()) {
    return NextResponse.json({ error: 'Please select your organisation' }, { status: 400 });
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

  const serviceClient = await createServiceClient();

  const orgResult = await serviceClient.from('organisations').select('id').eq('id', orgId).single();
  if (orgResult.error || !orgResult.data) {
    return NextResponse.json({ error: 'Unknown organisation' }, { status: 400 });
  }

  // handle_new_user() (migration 006) fires on this insert and writes its
  // own user_profiles row using org_id straight out of user_metadata —
  // org_id is NOT NULL, so leaving it out of metadata makes that trigger
  // insert fail (and takes the whole createUser call down with it). Role
  // is deliberately omitted: migration 032 hardcodes the trigger's role to
  // 'inspector' regardless of metadata, and our own upsert below overwrites
  // this row anyway to set is_active/status.
  const userResult = await serviceClient.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: fullName.trim(), org_id: orgId },
  });
  if (userResult.error || !userResult.data.user) {
    return NextResponse.json({ error: userResult.error?.message ?? 'Could not create user' }, { status: 400 });
  }

  const profileResult = await (serviceClient.from('user_profiles') as any).upsert({
    id: userResult.data.user.id,
    org_id: orgId,
    role: 'inspector',
    full_name: fullName.trim(),
    is_active: false,
    status: 'pending',
  });
  if (profileResult.error) {
    return NextResponse.json({ error: profileResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
