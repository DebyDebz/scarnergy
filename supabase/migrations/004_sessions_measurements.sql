-- ============================================================
-- SCARNERGY v2.0 — Migration 004: Sessions & Measurements
-- Inspection sessions + TimescaleDB measurements hypertable
-- ============================================================

-- ─── INSPECTION SESSIONS ──────────────────────────────────────────────────

CREATE TABLE inspection_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  building_id     UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  inspector_id    UUID NOT NULL REFERENCES user_profiles(id),
  supervisor_id   UUID REFERENCES user_profiles(id),

  -- Session metadata
  session_code    TEXT NOT NULL,               -- auto-generated, e.g. "INS-2026-0042"
  status          session_status NOT NULL DEFAULT 'active',

  -- Timing
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at       TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  duration_seconds INTEGER,                    -- computed on close

  -- Quality metrics
  total_measurements  INTEGER NOT NULL DEFAULT 0,
  anomaly_count       INTEGER NOT NULL DEFAULT 0,
  completion_pct      NUMERIC(5,2),            -- 0-100%, computed on close

  -- Weather at time of inspection (affects energy calc)
  outdoor_temp_c      NUMERIC(5,2),
  weather_description TEXT,

  -- Offline / sync
  sync_status     sync_status NOT NULL DEFAULT 'pending',
  last_synced_at  TIMESTAMPTZ,
  offline_duration_seconds INTEGER NOT NULL DEFAULT 0,

  -- Report
  report_url      TEXT,                        -- Supabase Storage path
  report_generated_at TIMESTAMPTZ,

  notes           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-generate session code: INS-YYYY-NNNN
CREATE SEQUENCE inspection_sessions_seq START 1;

CREATE OR REPLACE FUNCTION generate_session_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.session_code = 'INS-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
                     LPAD(nextval('inspection_sessions_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_session_code
  BEFORE INSERT ON inspection_sessions
  FOR EACH ROW
  WHEN (NEW.session_code IS NULL OR NEW.session_code = '')
  EXECUTE FUNCTION generate_session_code();

CREATE INDEX idx_sessions_org ON inspection_sessions(org_id);
CREATE INDEX idx_sessions_building ON inspection_sessions(building_id);
CREATE INDEX idx_sessions_inspector ON inspection_sessions(inspector_id);
CREATE INDEX idx_sessions_status ON inspection_sessions(org_id, status);
CREATE INDEX idx_sessions_started ON inspection_sessions(started_at DESC);

-- ─── MEASUREMENTS (TimescaleDB Hypertable) ────────────────────────────────

CREATE TABLE measurements (
  -- Time column MUST be first for TimescaleDB
  measured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  session_id        UUID NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  device_id         UUID NOT NULL REFERENCES ble_devices(id),
  inspector_id      UUID NOT NULL REFERENCES user_profiles(id),

  -- What is being measured
  element_id        UUID REFERENCES building_elements(id),
  opening_id        UUID REFERENCES openings(id),

  -- The measurement
  value_mm          NUMERIC(12,4) NOT NULL,   -- always stored in mm
  unit              measurement_unit NOT NULL DEFAULT 'mm',
  measurement_type  TEXT,                      -- wall_height, wall_width, roof_length, etc.
                                               -- populated by ML classifier

  -- Raw BLE packet (for debugging / re-processing)
  raw_ble_bytes     BYTEA,

  -- On-device AI validation results
  anomaly_score     NUMERIC(8,6),             -- 0.0–1.0 (Isolation Forest score)
  is_anomaly        BOOLEAN NOT NULL DEFAULT FALSE,
  classifier_label  TEXT,                      -- ML-predicted measurement type
  classifier_confidence NUMERIC(6,4),

  -- Server-side validation
  validation_result validation_result,
  validation_message TEXT,
  validated_at      TIMESTAMPTZ,

  -- Session statistics at time of measurement (for ML features)
  session_mean_mm   NUMERIC(12,4),
  session_std_mm    NUMERIC(12,4),
  session_count     INTEGER,

  -- Ingestion path tracking
  ingestion_path    TEXT NOT NULL DEFAULT 'mobile', -- 'mobile', 'python_bridge', 'esp32'

  -- Offline sync
  client_timestamp  TIMESTAMPTZ,              -- original device timestamp (GDPR audit trail)
  sync_status       sync_status NOT NULL DEFAULT 'synced',

  -- Soft delete
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at        TIMESTAMPTZ,

  metadata          JSONB NOT NULL DEFAULT '{}',

  PRIMARY KEY (measured_at, id)
);

-- Convert to TimescaleDB hypertable (partition by measured_at, 1 week chunks)
SELECT create_hypertable('measurements', 'measured_at',
  chunk_time_interval => INTERVAL '1 week',
  if_not_exists => TRUE
);

-- Compression policy: compress chunks older than 30 days
SELECT add_compression_policy('measurements', INTERVAL '30 days');

-- Retention policy: keep data for 10 years (GDPR compliance window)
SELECT add_retention_policy('measurements', INTERVAL '10 years');

-- Indexes (TimescaleDB recommends covering indexes per query pattern)
CREATE INDEX idx_measurements_org_time    ON measurements(org_id, measured_at DESC);
CREATE INDEX idx_measurements_session     ON measurements(session_id, measured_at DESC);
CREATE INDEX idx_measurements_device      ON measurements(device_id, measured_at DESC);
CREATE INDEX idx_measurements_inspector   ON measurements(inspector_id, measured_at DESC);
CREATE INDEX idx_measurements_element     ON measurements(element_id, measured_at DESC)
  WHERE element_id IS NOT NULL;
CREATE INDEX idx_measurements_anomaly     ON measurements(org_id, is_anomaly, measured_at DESC)
  WHERE is_anomaly = TRUE;

-- ─── CONTINUOUS AGGREGATE: hourly stats per org + device ──────────────────

CREATE MATERIALIZED VIEW measurements_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', measured_at)           AS bucket,
  org_id,
  device_id,
  element_id,
  COUNT(*)                                      AS measurement_count,
  AVG(value_mm)                                 AS avg_mm,
  MIN(value_mm)                                 AS min_mm,
  MAX(value_mm)                                 AS max_mm,
  STDDEV(value_mm)                              AS stddev_mm,
  SUM(is_anomaly::INT)                          AS anomaly_count,
  AVG(anomaly_score)                            AS avg_anomaly_score
FROM measurements
WHERE is_deleted = FALSE
GROUP BY 1, 2, 3, 4
WITH NO DATA;

-- Refresh policy: update hourly aggregate every 30 minutes
SELECT add_continuous_aggregate_policy('measurements_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '30 minutes',
  schedule_interval => INTERVAL '30 minutes'
);

-- ─── SYNC QUEUE (for offline-first conflict tracking) ─────────────────────

CREATE TABLE sync_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  inspector_id    UUID NOT NULL REFERENCES user_profiles(id),

  table_name      TEXT NOT NULL,               -- 'measurements', 'building_elements', etc.
  record_id       UUID NOT NULL,
  operation       TEXT NOT NULL,               -- 'INSERT', 'UPDATE', 'DELETE'
  payload         JSONB NOT NULL,

  client_timestamp TIMESTAMPTZ NOT NULL,
  server_timestamp TIMESTAMPTZ,

  sync_status     sync_status NOT NULL DEFAULT 'pending',
  retry_count     SMALLINT NOT NULL DEFAULT 0,
  error_message   TEXT,

  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_queue_inspector ON sync_queue(inspector_id, sync_status);
CREATE INDEX idx_sync_queue_pending   ON sync_queue(org_id, sync_status, client_timestamp)
  WHERE sync_status = 'pending';

-- ─── AUDIT LOG (GDPR Article 30) ─────────────────────────────────────────

CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID REFERENCES organisations(id),
  user_id         UUID REFERENCES user_profiles(id),

  action          TEXT NOT NULL,               -- 'measurement.created', 'building.updated', etc.
  table_name      TEXT,
  record_id       UUID,
  old_values      JSONB,
  new_values      JSONB,

  ip_address      INET,
  user_agent      TEXT,
  request_id      TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Create partitions for current and next year
CREATE TABLE audit_log_2026 PARTITION OF audit_log
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE audit_log_2027 PARTITION OF audit_log
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE INDEX idx_audit_log_org    ON audit_log(org_id, created_at DESC);
CREATE INDEX idx_audit_log_user   ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_log_record ON audit_log(table_name, record_id, created_at DESC);

-- ─── TRIGGERS ────────────────────────────────────────────────────────────

CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON inspection_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
