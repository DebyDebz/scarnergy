-- ============================================================
-- SCARNERGY v2.0 — Migration 016: Fix Sequence Permissions
--
-- GRANT ON ALL SEQUENCES is point-in-time and missed sequences
-- created in the same migration batch. Explicitly re-grant and
-- set default privileges so future sequences are covered too.
-- Fixes: "permission denied for sequence inspection_sessions_seq"
-- which blocked the "Start Inspection" button in the mobile app.
-- ============================================================

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon;
