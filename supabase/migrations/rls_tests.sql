-- ============================================================
-- SCARNERGY v2.0 — RLS Verification Tests
-- Run these after applying all migrations and seed data.
-- All tests should pass (return expected results).
-- ============================================================

-- ─── Setup: create test JWT claims ────────────────────────────────────
-- These simulate what the JWT hook injects for different users.

-- Test as inspector from Org 1
SET LOCAL "request.jwt.claims" = '{
  "sub": "00000000-0000-0000-0000-000000000010",
  "role": "authenticated",
  "org_id": "00000000-0000-0000-0000-000000000001",
  "user_role": "inspector"
}';

-- ─── TEST 1: Inspector sees only their org's buildings ─────────────────
SELECT 'TEST 1: Inspector org isolation' AS test_name;
SELECT COUNT(*) AS visible_buildings,
       bool_and(org_id = '00000000-0000-0000-0000-000000000001') AS all_from_correct_org
FROM buildings;
-- Expected: all rows have org_id = Org 1

-- ─── TEST 2: Inspector cannot see Org 2 buildings ─────────────────────
SELECT 'TEST 2: Cross-org isolation' AS test_name;
SELECT COUNT(*) AS should_be_zero
FROM buildings
WHERE org_id = '00000000-0000-0000-0000-000000000002';
-- Expected: 0

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
SELECT COUNT(*) AS visible_zones,
       bool_and(org_id = '00000000-0000-0000-0000-000000000001') AS all_correct_org
FROM zones;

-- ─── TEST 5: Measurements scoped to inspector ─────────────────────────
-- (no measurements exist yet, but the policy should allow select)
SELECT 'TEST 5: Measurements table accessible' AS test_name;
SELECT COUNT(*) AS measurement_count FROM measurements;

-- ─── TEST 6: Audit log blocked for non-admin ──────────────────────────
SELECT 'TEST 6: Audit log blocked for inspector' AS test_name;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM audit_log LIMIT 1;
    RAISE NOTICE 'FAIL: Inspector should not see audit_log';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'PASS: Audit log blocked for inspector — %', SQLERRM;
  END;
END $$;

-- ─── Switch to admin role ──────────────────────────────────────────────
SET LOCAL "request.jwt.claims" = '{
  "sub": "00000000-0000-0000-0000-000000000011",
  "role": "authenticated",
  "org_id": "00000000-0000-0000-0000-000000000001",
  "user_role": "admin"
}';

-- ─── TEST 7: Admin can see all sessions in their org ──────────────────
SELECT 'TEST 7: Admin sees all org sessions' AS test_name;
SELECT COUNT(*) AS sessions_visible FROM inspection_sessions;

-- ─── TEST 8: Admin cannot see other org's data ────────────────────────
SELECT 'TEST 8: Admin cross-org isolation' AS test_name;
SELECT COUNT(*) AS should_be_zero
FROM buildings
WHERE org_id = '00000000-0000-0000-0000-000000000002';

-- ─── TEST 9: Continuous aggregate view ────────────────────────────────
SELECT 'TEST 9: Hourly aggregate view accessible' AS test_name;
SELECT COUNT(*) FROM measurements_hourly;

-- ─── TEST 10: Energy label function ───────────────────────────────────
SELECT 'TEST 10: Energy label computation' AS test_name;
SELECT compute_zone_energy_label('z0000000-0000-0000-0000-000000000001') AS energy_label;
-- Expected: some label based on seed data RC values

-- ─── Summary ──────────────────────────────────────────────────────────
SELECT '─────────────────────────────────────────────' AS divider;
SELECT 'All RLS tests completed. Review PASS/FAIL above.' AS summary;
SELECT '─────────────────────────────────────────────' AS divider;
