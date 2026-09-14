-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

-- ============================================================================
-- Round 76et-D (gov): backfill historical auto-scrape rows from
-- 'still_available' to 'inferred_active'
--
-- Mirror of the dia migration in this round. See that file for the full
-- rationale. Same scope, same idempotency, same intentional non-reversion
-- of historical available_listings side effects.
-- ============================================================================

DO $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.listing_verification_history
     SET check_result = 'inferred_active'
   WHERE method       = 'auto_scrape'
     AND check_result = 'still_available';

  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE '[gov/76et-D] relabeled % auto_scrape still_available rows -> inferred_active', affected;
END;
$$;
