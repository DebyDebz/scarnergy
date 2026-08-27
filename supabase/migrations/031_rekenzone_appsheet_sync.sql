-- ============================================================
-- SCARNERGY v2.0 — Migration 031: Rekenzone <-> AppSheet correlation
-- Migration 030 gave zones/building_elements/openings an appsheet_row_key
-- to make session-close idempotent (Edit an existing AppSheet row instead
-- of Add-ing a dupe). Dak/Vloer/Installatie link to AppSheet via a
-- Rekenzone ID rather than a Verdieping ID, and rekenzones had no such
-- column at all — this closes that gap so the same find-or-create pattern
-- works for the Rekenzone parent link too.
-- ============================================================

ALTER TABLE rekenzones ADD COLUMN IF NOT EXISTS appsheet_row_key TEXT;
