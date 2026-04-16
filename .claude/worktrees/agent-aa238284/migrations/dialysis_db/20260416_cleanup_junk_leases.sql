-- ============================================================
-- Migration: cleanup_junk_leases
-- Applied: 2026-04-16 to Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Purpose: Remove duplicate/orphan lease records that cause
--          v_property_detail fan-out and clutter the Rent Roll tab.
-- Junk criteria:
--   1. status = 'inactive_bad_import'
--   2. All key fields NULL (tenant, lease_start, lease_expiration, rent, annual_rent)
-- Results: 7,880 leases deleted, 5,851 escalations deleted
-- ============================================================

DO $$
DECLARE
  v_esc_deleted  bigint;
  v_lease_deleted bigint;
BEGIN
  -- Step 1: Identify all junk lease_ids
  CREATE TEMP TABLE _junk_leases AS
  SELECT lease_id
  FROM leases
  WHERE status = 'inactive_bad_import'
     OR (tenant IS NULL
         AND lease_start IS NULL
         AND lease_expiration IS NULL
         AND rent IS NULL
         AND annual_rent IS NULL);

  -- Step 2: Delete escalations for junk leases
  DELETE FROM lease_escalations
  WHERE lease_id IN (SELECT lease_id FROM _junk_leases);
  GET DIAGNOSTICS v_esc_deleted = ROW_COUNT;

  -- Step 3: Delete the junk leases themselves
  DELETE FROM leases
  WHERE lease_id IN (SELECT lease_id FROM _junk_leases);
  GET DIAGNOSTICS v_lease_deleted = ROW_COUNT;

  -- Step 4: Report
  RAISE NOTICE 'Junk lease cleanup complete: % escalations deleted, % leases deleted',
    v_esc_deleted, v_lease_deleted;

  DROP TABLE _junk_leases;
END $$;
