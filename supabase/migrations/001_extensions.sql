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

-- Geospatial (building locations) — requires postgis-enabled image
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS "postgis"; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'postgis not available, skipping'; END $$;

-- Vector similarity (future: AI embeddings) — requires pgvector
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS "vector"; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'vector not available, skipping'; END $$;

-- Supabase Auth hook — requires pg_net
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS "pg_net"; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'pg_net not available, skipping'; END $$;
