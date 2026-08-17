import { createServerClient } from '@supabase/ssr';
import { createClient } from '@/lib/supabase-server';
import type { User, SupabaseClient } from '@supabase/supabase-js';

// Resolves the requesting user (and a Supabase client authenticated as
// them, for role lookups) for the AppSheet routes. The web dashboard sends
// cookies (createClient() below); the mobile app is a separate origin with
// no cookie jar and instead sends `Authorization: Bearer <access_token>`
// (the user's own Supabase session token — never the AppSheet
// ApplicationAccessKey, which stays server-only in lib/appsheet/client.ts).
// The bearer token is forwarded as this client's global auth header so
// `.from()` queries (e.g. the user_profiles role lookup below) run under
// that user's RLS policies, not the anon role's.
export async function getAuthFromRequest(req: Request): Promise<{ user: User | null; supabase: SupabaseClient }> {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (bearer) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: { getAll: () => [], setAll: () => {} },
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      }
    );
    const { data: { user } } = await supabase.auth.getUser(bearer);
    return { user, supabase };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { user, supabase };
}
