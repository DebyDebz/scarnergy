-- ============================================================
-- SCARNERGY v2.0 — Migration 030: AppSheet <-> mobile correlation
-- Lets a mobile-created "shadow" building be traced back to the AppSheet
-- Objecten row it was materialized from, and lets a session-close AppSheet
-- export be idempotent (Edit an existing row instead of Add-ing a dupe).
-- ============================================================

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS appsheet_object_id TEXT UNIQUE;
ALTER TABLE zones ADD COLUMN IF NOT EXISTS appsheet_row_key TEXT;
ALTER TABLE building_elements ADD COLUMN IF NOT EXISTS appsheet_row_key TEXT;
ALTER TABLE openings ADD COLUMN IF NOT EXISTS appsheet_row_key TEXT;
