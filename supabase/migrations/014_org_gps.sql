-- Migration 014: Add GPS coordinates to organisations
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS latitude  NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6);
