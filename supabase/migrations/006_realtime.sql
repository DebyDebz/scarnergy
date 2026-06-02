-- ============================================================
-- SCARNERGY v2.0 — Migration 006: Supabase Realtime
-- Enable postgres_changes on measurements for live dashboard.
-- TimescaleDB hypertables require REPLICA IDENTITY FULL so
-- the logical replication slot can see the full row on INSERT.
-- ============================================================

ALTER TABLE measurements        REPLICA IDENTITY FULL;
ALTER TABLE inspection_sessions REPLICA IDENTITY FULL;

-- Create the publication if it doesn't already exist
-- (Supabase Cloud creates it automatically; self-hosted may not)
DO $$ BEGIN
  CREATE PUBLICATION supabase_realtime;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE measurements;
ALTER PUBLICATION supabase_realtime ADD TABLE inspection_sessions;
