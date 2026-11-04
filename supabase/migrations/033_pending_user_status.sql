-- ============================================================
-- SCARNERGY v2.0 — Migration 033: pending signup approval status
-- Adds a `status` column to user_profiles so admins can distinguish a
-- brand-new self-service "request access to an org" signup (status =
-- 'pending') from a real employee an admin has deliberately deactivated
-- (is_active = false, status stays 'approved'). Both already end up
-- locked out of org data today via custom_access_token_hook() (006) —
-- it nulls org_id in the JWT whenever is_active is false, which every RLS
-- policy keys off — so `status` is purely a UI/notification concern, not
-- a new security boundary. New pending rows keep is_active = false so
-- they inherit that existing lockout for free until an admin approves.
-- ============================================================

ALTER TABLE user_profiles
  ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected'));
