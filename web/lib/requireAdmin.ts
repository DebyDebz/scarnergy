import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

// Cookie-session admin gate for dashboard API routes — same check
// web/middleware.ts already does for the ADMIN_ONLY page paths, but the
// middleware's matcher explicitly excludes `api/`, so routes never got this
// check of their own. `/api/organisations` and `/api/users/invite` had none
// at all before this; the mobile AppSheet routes have their own equivalent
// (getAuthFromRequest + a local requireAdmin) using Bearer tokens instead of
// cookies, since mobile has no browser session — this is the cookie-based
// counterpart for web dashboard routes.
export async function requireAdmin(): Promise<{ userId: string } | { error: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const profileResult = await (supabase.from('user_profiles') as any)
    .select('role')
    .eq('id', user.id)
    .single() as unknown as { data: { role: string } | null };
  if (profileResult.data?.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { userId: user.id };
}
