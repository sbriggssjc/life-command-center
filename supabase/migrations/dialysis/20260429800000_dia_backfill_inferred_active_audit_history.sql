-- ============================================================================
-- Round 76et-D (dia): backfill historical auto-scrape rows from
-- 'still_available' to 'inferred_active'
--
-- Round 76et-C added 'inferred_active' as a narrower attestation than
-- 'still_available' for the auto-scrape cron's no-sale-match path. Going
-- forward, every cron tick that finds no sale evidence records
-- 'inferred_active'. This migration relabels the historical rows so the
-- audit trail uses the same vocabulary across past + future cron runs.
--
-- Scope:
--   - listing_verification_history rows where method='auto_scrape' AND
--     check_result='still_available'.
--   - Other check_results from auto_scrape ('sold', 'unreachable', etc.)
--     stay as-is — those reflect what the cron actually determined.
--   - Sidebar / manual_user / sold_imported rows stay as-is — those
--     methods can legitimately verify URL reachability so 'still_available'
--     is the right tag.
--
-- Side effects on available_listings (consecutive_check_failures = 0,
-- is_active = true) from each historical cron tick are NOT reverted —
-- we don't have the data to reconstruct what the counters should have
-- been before each tick. Only the audit history label changes.
--
-- Safe to re-run: WHERE clause excludes already-relabeled rows.
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
  RAISE NOTICE '[dia/76et-D] relabeled % auto_scrape still_available rows -> inferred_active', affected;
END;
$$;
