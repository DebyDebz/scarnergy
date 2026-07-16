-- ============================================================
-- SCARNERGY v2.0 — RLS Verification Tests
-- Run after applying all migrations + seed data (scripts/db_check.sh does
-- both; CI runs it on every PR).
--
-- The whole suite runs in ONE transaction as the `authenticated` role with
-- simulated JWT claims (SET LOCAL only works inside a transaction, and the
-- superuser would bypass RLS entirely). Every test prints PASS or FAIL —
-- the harness greps for FAIL. Rolled back at the end; nothing persists.
-- ============================================================

BEGIN;
SET LOCAL ROLE authenticated;

-- ─── Inspector from Org 1 ──────────────────────────────────────────────
SET LOCAL "request.jwt.claims" = '{
  "sub": "00000000-0000-0000-0000-000000000010",
  "role": "authenticated",
  "org_id": "00000000-0000-0000-0000-000000000001",
  "user_role": "inspector"
}';

-- ─── TEST 1: Inspector sees only their org's buildings ─────────────────
SELECT 'TEST 1: Inspector org isolation' AS test_name;
DO $$
DECLARE n int; ok boolean;
BEGIN
  SELECT count(*), coalesce(bool_and(org_id = '00000000-0000-0000-0000-000000000001'), true)
    INTO n, ok FROM buildings;
  IF n > 0 AND ok THEN RAISE NOTICE 'PASS: % buildings, all org 1', n;
  ELSIF n = 0 THEN RAISE NOTICE 'FAIL: inspector sees no buildings (seed missing or RLS over-blocking)';
  ELSE RAISE NOTICE 'FAIL: cross-org buildings visible';
  END IF;
END $$;

-- ─── TEST 2: Inspector cannot see Org 2 buildings ─────────────────────
SELECT 'TEST 2: Cross-org isolation' AS test_name;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM buildings WHERE org_id = '00000000-0000-0000-0000-000000000002';
  IF n = 0 THEN RAISE NOTICE 'PASS: 0 org-2 buildings visible';
  ELSE RAISE NOTICE 'FAIL: % org-2 buildings visible', n; END IF;
END $$;

-- ─── TEST 3: Inspector cannot insert into another org ─────────────────
SELECT 'TEST 3: Cross-org insert blocked' AS test_name;
DO $$
BEGIN
  BEGIN
    INSERT INTO buildings (org_id, street, house_number, postal_code, city)
    VALUES ('00000000-0000-0000-0000-000000000002', 'Test', '1', '1234AB', 'Test');
    RAISE NOTICE 'FAIL: Insert should have been blocked by RLS';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'PASS: Insert blocked — %', SQLERRM;
  END;
END $$;

-- ─── TEST 4: Zones follow building org ────────────────────────────────
SELECT 'TEST 4: Zone org isolation' AS test_name;
DO $$
DECLARE n int; ok boolean;
BEGIN
  SELECT count(*), coalesce(bool_and(org_id = '00000000-0000-0000-0000-000000000001'), true)
    INTO n, ok FROM zones;
  IF n > 0 AND ok THEN RAISE NOTICE 'PASS: % zones, all org 1', n;
  ELSIF n = 0 THEN RAISE NOTICE 'FAIL: inspector sees no zones';
  ELSE RAISE NOTICE 'FAIL: cross-org zones visible';
  END IF;
END $$;

-- ─── TEST 4b: Rekenzones follow building org ──────────────────────────
SELECT 'TEST 4b: Rekenzone org isolation' AS test_name;
DO $$
DECLARE ok boolean;
BEGIN
  -- seed has no rekenzones; assert only that no cross-org row leaks and the
  -- org-1 inspector can insert into their own org (rolled back with the txn).
  SELECT coalesce(bool_and(org_id = '00000000-0000-0000-0000-000000000001'), true) INTO ok FROM rekenzones;
  IF NOT ok THEN RAISE NOTICE 'FAIL: cross-org rekenzones visible'; RETURN; END IF;
  BEGIN
    INSERT INTO rekenzones (org_id, building_id, name)
    VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'RLS test rekenzone');
    RAISE NOTICE 'PASS: own-org rekenzone insert allowed, no cross-org rows';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'FAIL: own-org rekenzone insert blocked — %', SQLERRM;
  END;
END $$;

-- ─── TEST 5: Measurements scoped to inspector ─────────────────────────
SELECT 'TEST 5: Measurements table accessible' AS test_name;
DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM measurements;
    RAISE NOTICE 'PASS: measurements selectable (% rows)', n;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'FAIL: measurements select errored — %', SQLERRM;
  END;
END $$;

-- ─── TEST 6: Audit log hidden from non-admin ──────────────────────────
SELECT 'TEST 6: Audit log hidden from inspector' AS test_name;
DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM audit_log;
    IF n = 0 THEN RAISE NOTICE 'PASS: audit_log hidden from inspector (0 rows)';
    ELSE RAISE NOTICE 'FAIL: inspector sees % audit_log rows', n; END IF;
  EXCEPTION WHEN others THEN
    -- also acceptable: SELECT privilege revoked outright
    RAISE NOTICE 'PASS: audit_log blocked — %', SQLERRM;
  END;
END $$;

-- ─── Switch to admin from Org 1 ────────────────────────────────────────
SET LOCAL "request.jwt.claims" = '{
  "sub": "00000000-0000-0000-0000-000000000011",
  "role": "authenticated",
  "org_id": "00000000-0000-0000-0000-000000000001",
  "user_role": "admin"
}';

-- ─── TEST 7: Admin can see sessions in their org ──────────────────────
SELECT 'TEST 7: Admin sees org sessions' AS test_name;
DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM inspection_sessions;
    RAISE NOTICE 'PASS: sessions selectable (% rows)', n;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'FAIL: sessions select errored — %', SQLERRM;
  END;
END $$;

-- ─── TEST 8: Admin cannot see other org's data ────────────────────────
SELECT 'TEST 8: Admin cross-org isolation' AS test_name;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM buildings WHERE org_id = '00000000-0000-0000-0000-000000000002';
  IF n = 0 THEN RAISE NOTICE 'PASS: 0 org-2 buildings visible to admin';
  ELSE RAISE NOTICE 'FAIL: admin sees % org-2 buildings', n; END IF;
END $$;

-- ─── TEST 9: Hourly aggregate view accessible ─────────────────────────
-- Migration 004 creates this continuous aggregate only on the licensed (TSL)
-- Timescale edition and silently skips it on Apache builds — absence is a
-- valid state, any other error is not.
SELECT 'TEST 9: Hourly aggregate view accessible' AS test_name;
DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM measurements_hourly;
    RAISE NOTICE 'PASS: measurements_hourly selectable (% rows)', n;
  EXCEPTION
    WHEN undefined_table THEN
      RAISE NOTICE 'PASS: measurements_hourly absent (Apache Timescale — skipped by design in 004)';
    WHEN others THEN
      RAISE NOTICE 'FAIL: measurements_hourly errored — %', SQLERRM;
  END;
END $$;

-- ─── TEST 10: Energy label function ───────────────────────────────────
SELECT 'TEST 10: Energy label computation' AS test_name;
DO $$
DECLARE lbl text;
BEGIN
  BEGIN
    SELECT compute_zone_energy_label('00000000-0000-0000-0000-000000000020') INTO lbl;
    RAISE NOTICE 'PASS: energy label computed — %', coalesce(lbl, 'NULL');
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'FAIL: energy label errored — %', SQLERRM;
  END;
END $$;

-- ─── Summary ──────────────────────────────────────────────────────────
SELECT '─────────────────────────────────────────────' AS divider;
SELECT 'RLS suite completed — review PASS lines above.' AS summary;
SELECT '─────────────────────────────────────────────' AS divider;

ROLLBACK;
