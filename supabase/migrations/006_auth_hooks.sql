-- ============================================================
-- SCARNERGY v2.0 — Migration 006: Auth JWT Hook
-- Injects org_id and user_role into every JWT at sign-in.
-- This is what makes auth.user_org_id() work in RLS policies.
-- ============================================================

-- This function is called by Supabase Auth on every token issue/refresh.
-- It reads the user's profile and adds org_id + user_role to the JWT.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims     JSONB;
  profile    RECORD;
BEGIN
  -- Get current claims from the event
  claims := event -> 'claims';

  -- Look up the user's profile (org_id and role)
  SELECT org_id, role, full_name, is_active
  INTO profile
  FROM public.user_profiles
  WHERE id = (event ->> 'user_id')::UUID;

  IF NOT FOUND OR NOT profile.is_active THEN
    -- User has no profile or is deactivated — deny access
    RETURN jsonb_set(claims, '{org_id}', 'null');
  END IF;

  -- Inject org_id and user_role into claims
  claims := jsonb_set(claims, '{org_id}',    to_jsonb(profile.org_id::TEXT));
  claims := jsonb_set(claims, '{user_role}', to_jsonb(profile.role::TEXT));
  claims := jsonb_set(claims, '{full_name}', to_jsonb(profile.full_name));

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Grant the hook permission to read user_profiles
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- ─── REGISTER THE HOOK IN SUPABASE ───────────────────────────────────────
-- NOTE: After running this migration, you must also set the hook in the
-- Supabase Dashboard under Authentication > Hooks > Custom Access Token.
-- Hook function: public.custom_access_token_hook

-- ─── AUTO-CREATE PROFILE ON SIGN-UP ──────────────────────────────────────
-- This trigger fires after a new user registers via Supabase Auth.
-- The org_id must be passed as user metadata during sign-up:
--   supabase.auth.signUp({ email, password, options: { data: { org_id, full_name } } })

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, org_id, full_name, role)
  VALUES (
    NEW.id,
    (NEW.raw_user_meta_data ->> 'org_id')::UUID,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data ->> 'role')::user_role, 'inspector')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
