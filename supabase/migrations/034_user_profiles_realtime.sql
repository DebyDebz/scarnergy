-- ============================================================
-- SCARNERGY v2.0 — Migration 034: realtime for pending signup notifications
-- The admin notification bell (033_pending_user_status.sql) needs to update
-- live while an admin is already sitting on a dashboard page, not just on
-- next page load — same pattern as measurements/inspection_sessions
-- (006_auth_hooks.sql). RLS ("profiles: see own org users") already scopes
-- what an admin's realtime subscription can receive to their own org, so
-- this doesn't widen access, only how fast a permitted change is seen.
-- ============================================================

ALTER TABLE user_profiles REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE user_profiles;
