-- ============================================================================
-- Stage B Unit 0 — cap_rate_event_type += 'valuation' (GOVERNMENT)
-- 2026-06-11 · written, NOT applied · APPLY THIS BEFORE the ledger-boundary file
--
-- Extracted BOV/Master economic caps live in cap_rate_history (the #64 ledger)
-- as a NON-sale event so the reported sale-cohorts (which select event_type=
-- 'sale') never count them. 'valuation' is that non-sale type. Enum widen only;
-- the CHECK + view guard ride in the companion 'cap_rate_ledger_boundary' file,
-- which is why the value add is isolated here (a new enum value cannot be USED in
-- the same transaction it is added in).
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'cap_rate_event_type' AND e.enumlabel = 'valuation'
  ) THEN
    ALTER TYPE cap_rate_event_type ADD VALUE 'valuation';
  END IF;
END$$;
