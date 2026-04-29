-- ============================================================
-- SCARNERGY v2.0 — Migration 001: Extensions
-- Run first. All other migrations depend on these.
-- ============================================================

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Full-text search trigrams (building name search)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Query performance statistics
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Time-series data (measurements hypertable)
CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;

-- Geospatial (building locations)
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Vector similarity (future: AI embeddings)
CREATE EXTENSION IF NOT EXISTS "vector";

-- Supabase Auth hook (required for JWT org_id claim)
CREATE EXTENSION IF NOT EXISTS "pg_net";
