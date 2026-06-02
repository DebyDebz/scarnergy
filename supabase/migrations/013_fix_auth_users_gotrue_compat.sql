-- ============================================================
-- SCARNERGY v2.0 — Migration 013: GoTrue compatibility fixes
-- ============================================================
-- GoTrue v2 requires specific defaults in auth.users that plain
-- SQL INSERTs miss. This migration:
--   1. Fixes handle_new_user trigger to skip insert when org_id
--      is missing (e.g. GoTrue admin API calls without metadata)
--   2. Adds web admin users with fully GoTrue-compatible rows
--   3. Sets default values so GoTrue can scan all token columns
-- ============================================================

-- ─── 1. Fix handle_new_user trigger ──────────────────────────
-- GoTrue admin API creates users without org_id in user_metadata.
-- Previously the trigger crashed with NOT NULL violation.
-- Now we only create the profile when org_id is supplied.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.raw_user_meta_data ->> 'org_id') IS NOT NULL THEN
    INSERT INTO public.user_profiles (id, org_id, full_name, role)
    VALUES (
      NEW.id,
      (NEW.raw_user_meta_data ->> 'org_id')::UUID,
      COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
      COALESCE((NEW.raw_user_meta_data ->> 'role')::user_role, 'inspector')
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 2. Fix existing auth.users rows for GoTrue compatibility ─
-- GoTrue Go driver cannot scan NULL into string fields. All token
-- columns and instance_id must have non-null defaults.

UPDATE auth.users
SET
  instance_id             = COALESCE(instance_id, '00000000-0000-0000-0000-000000000000'),
  confirmation_token      = COALESCE(confirmation_token, ''),
  recovery_token          = COALESCE(recovery_token, ''),
  email_change_token_new  = COALESCE(email_change_token_new, ''),
  email_change            = COALESCE(email_change, ''),
  raw_app_meta_data       = COALESCE(raw_app_meta_data, '{"provider":"email","providers":["email"]}'::jsonb),
  raw_user_meta_data      = COALESCE(raw_user_meta_data, '{}'::jsonb)
WHERE instance_id IS NULL
   OR confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change_token_new IS NULL
   OR email_change IS NULL;

-- ─── 3. Web admin users ───────────────────────────────────────
-- These accounts are used to sign into the Next.js admin portal.
-- Password: Scarnergy2025!  (bcrypt 10 rounds)
-- All token fields are empty strings (not NULL) to satisfy GoTrue.

INSERT INTO auth.users (
  instance_id, id, email, encrypted_password,
  email_confirmed_at,
  aud, role,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  created_at, updated_at,
  is_sso_user, is_anonymous
)
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '43991b58-9c48-48a5-9088-223e116105d6',
    'admin@krontiva.nl',
    crypt('Scarnergy2025!', gen_salt('bf', 10)),
    NOW(),
    'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}',
    '{"org_id":"00000000-0000-0000-0000-000000000001","full_name":"Karin Bakker","role":"admin"}',
    '', '', '', '',
    NOW(), NOW(),
    false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '449e4116-9283-47b5-81d8-e6383d914aea',
    'supervisor@krontiva.nl',
    crypt('Scarnergy2025!', gen_salt('bf', 10)),
    NOW(),
    'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}',
    '{"org_id":"00000000-0000-0000-0000-000000000001","full_name":"Pieter van Dam","role":"supervisor"}',
    '', '', '', '',
    NOW(), NOW(),
    false, false
  )
ON CONFLICT (id) DO UPDATE SET
  encrypted_password     = EXCLUDED.encrypted_password,
  instance_id            = EXCLUDED.instance_id,
  confirmation_token     = EXCLUDED.confirmation_token,
  recovery_token         = EXCLUDED.recovery_token,
  email_change_token_new = EXCLUDED.email_change_token_new,
  email_change           = EXCLUDED.email_change,
  raw_app_meta_data      = EXCLUDED.raw_app_meta_data,
  raw_user_meta_data     = EXCLUDED.raw_user_meta_data,
  updated_at             = NOW();

INSERT INTO auth.identities (
  id, provider_id, user_id,
  identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
VALUES
  (
    gen_random_uuid(),
    '43991b58-9c48-48a5-9088-223e116105d6',
    '43991b58-9c48-48a5-9088-223e116105d6',
    '{"sub":"43991b58-9c48-48a5-9088-223e116105d6","email":"admin@krontiva.nl","email_verified":true,"phone_verified":false}'::jsonb,
    'email', NOW(), NOW(), NOW()
  ),
  (
    gen_random_uuid(),
    '449e4116-9283-47b5-81d8-e6383d914aea',
    '449e4116-9283-47b5-81d8-e6383d914aea',
    '{"sub":"449e4116-9283-47b5-81d8-e6383d914aea","email":"supervisor@krontiva.nl","email_verified":true,"phone_verified":false}'::jsonb,
    'email', NOW(), NOW(), NOW()
  )
ON CONFLICT (provider, provider_id) DO NOTHING;

INSERT INTO user_profiles (id, org_id, role, full_name, is_active)
VALUES
  ('43991b58-9c48-48a5-9088-223e116105d6', '00000000-0000-0000-0000-000000000001', 'admin',      'Karin Bakker',  true),
  ('449e4116-9283-47b5-81d8-e6383d914aea', '00000000-0000-0000-0000-000000000001', 'supervisor', 'Pieter van Dam', true)
ON CONFLICT (id) DO NOTHING;
