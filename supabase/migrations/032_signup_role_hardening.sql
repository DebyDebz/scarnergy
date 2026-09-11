-- ============================================================
-- SCARNERGY v2.0 — Migration 032: stop trusting client-supplied role
-- handle_new_user() (006_auth_hooks.sql) read `role` straight out of
-- auth.users.raw_user_meta_data, defaulting to 'inspector' only when
-- absent. raw_user_meta_data is fully client-controlled on a public
-- supabase.auth.signUp() call (the anon key is public) — so anyone could
-- call signUp({ email, password, options: { data: { role: 'admin',
-- org_id: '<any-uuid>' } } }) directly and be granted admin today,
-- independent of any UI this app offers.
--
-- Fix: always insert 'inspector' regardless of metadata. The only two
-- paths that legitimately need a non-inspector role (admin invite via
-- /api/users/invite, and the new self-serve org-signup route) both already
-- do their own EXPLICIT service-role upsert into user_profiles right after
-- the auth.users row is created — that upsert runs after this trigger and
-- overwrites whatever it set, so real admin/supervisor provisioning is
-- completely unaffected by this change.
-- ============================================================

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
    'inspector'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
