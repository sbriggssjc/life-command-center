-- ============================================================================
-- Round 76et-E (gov): mirror of the dia migration in this round. Adds
-- cron_timer_advances_* and evidence_verifications_* breakout columns to
-- v_listing_verification_summary so the dashboard card can show how much
-- of the cadence is real verification vs the cron's no-news timer advance.
--
-- See dia_v_listing_verification_summary_breakout_inferred.sql for the
-- full rationale.
--
-- Gov differences from dia (already present in the original Phase 2 view):
--   - filters on listing_status='active' (not is_active)
--   - filters on exclude_from_listing_metrics=false
-- ============================================================================

CREATE OR REPLACE VIEW public.v_listing_verification_summary AS
SELECT
  COUNT(*) FILTER (WHERE COALESCE(al.listing_status,'active') = 'active'
                     AND COALESCE(al.exclude_from_listing_metrics, false) IS FALSE)
    AS total_active_listings,
  COUNT(*) FILTER (
    WHERE COALESCE(al.listing_status,'active') = 'active'
      AND al.verification_due_at IS NOT NULL
      AND al.verification_due_at <= now()
  )                                                           AS due_for_verification,
  COUNT(*) FILTER (
    WHERE COALESCE(al.listing_status,'active') = 'active'
      AND (
        (al.last_verified_at IS NOT NULL AND al.last_verified_at < now() - INTERVAL '30 days')
        OR
        (al.last_verified_at IS NULL AND al.listing_date < (now() - INTERVAL '30 days')::date)
      )
  )                                                           AS overdue_30d,
  COUNT(*) FILTER (
    WHERE COALESCE(al.listing_status,'active') = 'active'
      AND (
        (al.last_verified_at IS NOT NULL AND al.last_verified_at < now() - INTERVAL '90 days')
        OR
        (al.last_verified_at IS NULL AND al.listing_date < (now() - INTERVAL '90 days')::date)
      )
  )                                                           AS overdue_90d,
  COUNT(*) FILTER (
    WHERE COALESCE(al.listing_status,'active') = 'active'
      AND al.last_verified_at IS NULL
  )                                                           AS never_verified,
  COUNT(*) FILTER (
    WHERE COALESCE(al.listing_status,'active') = 'active'
      AND COALESCE(al.consecutive_check_failures, 0) >= 2
  )                                                           AS broken_url_count,
  (SELECT COUNT(*) FROM public.listing_status_history h
    WHERE h.effective_at >= now() - INTERVAL '7 days')        AS recent_status_changes_7d,
  (SELECT COUNT(*) FROM public.listing_verification_history v
    WHERE v.verified_at >= now() - INTERVAL '24 hours')       AS verifications_last_24h,
  (SELECT COUNT(*) FROM public.listing_verification_history v
    WHERE v.verified_at >= now() - INTERVAL '7 days')         AS verifications_last_7d,
  -- New in 76et-E: cron-timer-advance vs evidence breakout.
  (SELECT COUNT(*) FROM public.listing_verification_history v
    WHERE v.verified_at >= now() - INTERVAL '24 hours'
      AND v.method = 'auto_scrape'
      AND v.check_result = 'inferred_active')                 AS cron_timer_advances_24h,
  (SELECT COUNT(*) FROM public.listing_verification_history v
    WHERE v.verified_at >= now() - INTERVAL '7 days'
      AND v.method = 'auto_scrape'
      AND v.check_result = 'inferred_active')                 AS cron_timer_advances_7d,
  (SELECT COUNT(*) FROM public.listing_verification_history v
    WHERE v.verified_at >= now() - INTERVAL '24 hours'
      AND NOT (v.method = 'auto_scrape' AND v.check_result = 'inferred_active'))
                                                              AS evidence_verifications_24h,
  (SELECT COUNT(*) FROM public.listing_verification_history v
    WHERE v.verified_at >= now() - INTERVAL '7 days'
      AND NOT (v.method = 'auto_scrape' AND v.check_result = 'inferred_active'))
                                                              AS evidence_verifications_7d
FROM public.available_listings al;

COMMENT ON VIEW public.v_listing_verification_summary IS
  'Round 76cx Phase 2 + 76et-E (gov): dashboard verification digest.
   evidence_verifications_* counts real checks (sidebar/manual/sold-imported,
   plus cron ticks that determined sold/off_market/price_changed/unreachable).
   cron_timer_advances_* counts cron ticks where no sale evidence was found
   and the timer was just advanced (check_result=inferred_active).
   verifications_last_* equals the sum of these two breakouts.';
