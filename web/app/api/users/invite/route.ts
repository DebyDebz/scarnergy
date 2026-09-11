import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { requireAdmin } from '@/lib/requireAdmin';
import { generatePassword } from '@/lib/generatePassword';
import { sendEmail, credentialsEmail } from '@/lib/email';

export async function POST(req: NextRequest) {
  // Previously reachable by anyone — web/middleware.ts's ADMIN_ONLY check
  // only protects the /users page, not this API route (matcher excludes
  // api/ entirely). Admin-gated same as the AppSheet mobile routes.
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  const { email, full_name, role, org_id } = await req.json();

  const serviceClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Generates and emails a temporary password directly rather than
  // Supabase's inviteUserByEmail magic link, so the new user gets working
  // credentials in one email instead of a separate "set your password" step.
  const password = generatePassword();

  const { data, error } = await serviceClient.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name, role, org_id },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // createUser's email_confirm flag is unreliable on this self-hosted
  // GoTrue instance — it silently leaves some accounts unconfirmed, which
  // then fail sign-in with "Invalid login credentials" despite the correct
  // password. A follow-up updateUserById with the same flag confirms them
  // deterministically (verified directly against the auth server).
  await serviceClient.auth.admin.updateUserById(data.user.id, { email_confirm: true });

  await (serviceClient.from('user_profiles') as any).upsert({
    id: data.user.id,
    org_id,
    role,
    full_name,
    is_active: true,
    status: 'approved',
  });

  await sendEmail({
    to: email,
    subject: 'Your Scarnergy account credentials',
    html: credentialsEmail(full_name, email, password),
  });

  return NextResponse.json({ ok: true });
}
