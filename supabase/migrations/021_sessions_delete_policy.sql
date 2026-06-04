-- Allow admins/supervisors to delete inspection sessions.
-- Measurements and other child rows are removed automatically via
-- ON DELETE CASCADE foreign keys (see 004_sessions_measurements.sql,
-- 012_recover_missing_tables.sql); cascaded deletes bypass child RLS.

DROP POLICY IF EXISTS "sessions: delete — admins only" ON inspection_sessions;

CREATE POLICY "sessions: delete — admins only"
  ON inspection_sessions FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.is_privileged()
  );
