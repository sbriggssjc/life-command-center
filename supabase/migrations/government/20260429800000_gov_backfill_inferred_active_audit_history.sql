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
