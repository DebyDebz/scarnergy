import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from './types';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}

// NOT @supabase/ssr's createServerClient — that ties the client to the
// incoming request's cookies, and once a Supabase session cookie exists it
// silently uses that session's own access token for every .from() call
// instead of the service-role key, regardless of which key you hand it as
// the second argument. That downgrades "service role, bypasses RLS" to
// "acts as whoever's browser happened to be making the request" — broke
// approve/reject and request-access here as soon as they were called from
// an already-logged-in admin's tab. Plain supabase-js with no session
// storage has no cookie state to hijack, so the service-role key always
// acts as service-role.
export async function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
