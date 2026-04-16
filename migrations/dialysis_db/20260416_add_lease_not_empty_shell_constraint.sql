-- ============================================================
-- Migration: add_lease_not_empty_shell_constraint
-- Applied: 2026-04-16 to Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Purpose: Prevent future inserts of completely empty lease shells.
--          At least one of tenant, lease_start, rent, or annual_rent
--          must be non-null for a lease record to be valid.
--          Also blocks the known-bad 'inactive_bad_import' status.
-- ============================================================

-- Constraint 1: No empty shells
ALTER TABLE leases
ADD CONSTRAINT chk_lease_not_empty_shell
CHECK (
  tenant IS NOT NULL
  OR lease_start IS NOT NULL
  OR rent IS NOT NULL
  OR annual_rent IS NOT NULL
);

-- Constraint 2: Block the bad import status from ever returning
ALTER TABLE leases
ADD CONSTRAINT chk_lease_status_not_bad_import
CHECK (status IS DISTINCT FROM 'inactive_bad_import');
