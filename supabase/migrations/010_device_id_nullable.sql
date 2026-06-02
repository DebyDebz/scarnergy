-- ============================================================
-- SCARNERGY v2.0 — Migration 010: Nullable device_id on measurements
-- Web-entered and manually-typed measurements have no physical BLE
-- device — allow device_id to be NULL.  Migration 009 already
-- updated the recent_measurements view (LEFT JOIN) in anticipation
-- of this change.
-- ============================================================

ALTER TABLE measurements ALTER COLUMN device_id DROP NOT NULL;
