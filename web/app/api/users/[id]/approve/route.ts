import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/requireAdmin';
import { createServiceClient } from '@/lib/supabase-server';
import { sendEmail, approvedEmail } from '@/lib/email';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  const supabase = await createServiceClient();

  const { data: profile, error } = await (supabase.from('user_profiles') as any)
    .update({ status: 'approved', is_active: true })
    .eq('id', params.id)
    .select('full_name')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: authUser } = await supabase.auth.admin.getUserById(params.id);
  if (authUser?.user?.email) {
    await sendEmail({
      to: authUser.user.email,
      subject: 'Your Scarnergy account has been approved',
      html: approvedEmail(profile?.full_name ?? 'there'),
    });
  }

  return NextResponse.json({ ok: true });
}
