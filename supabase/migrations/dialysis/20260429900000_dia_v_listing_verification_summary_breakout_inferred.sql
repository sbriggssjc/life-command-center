-- ============================================================================
-- Round 76et-E (dia): break out cron-timer-advance vs evidence-based
-- verifications in v_listing_verification_summary.
--
-- After Round 76et-C (e5f30a1) introduced 'inferred_active' as the
-- audit-honest tag for cron ticks that found no sale evidence, and
-- Round 76et-D (f76d601) backfilled historical rows, the
-- listing_verification_history table now distinguishes:
--
--   1. EVIDENCE verifications: a real check happened —
--        - method='sidebar_capture'  user clicked Verify in the sidebar
--        - method='manual_user'      user clicked from a dashboard
--        - method='sold_imported'    sales transaction triggered
--        - method='auto_scrape' AND check_result IN ('sold','off_market',
--          'price_changed','unreachable')  the cron found something
--
--   2. CRON TIMER ADVANCES: the cron found no sale evidence and just
--      pushed last_verified_at forward —
--        - method='auto_scrape' AND check_result='inferred_active'
--
-- The summary card surfaces a single 'verifications/7d' number today;
-- this view extension lets the UI show 'evidence/7d · cron-only/7d'
-- so users can see how much of the cadence is real verification vs.
-- the cron's no-news pat-on-the-head.
--
-- Existing columns unchanged so prior consumers stay green:
--   verifications_last_24h, verifications_last_7d still equal
--   evidence_verifications_* + cron_timer_advances_* (after the
--   76et-D backfill landed; before that, prior 'still_available' rows
--   from auto_scrape were folded into the total but couldn't be
--   broken out).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_listing_verification_summary AS
SELECT
  COUNT(*) FILTER (WHERE COALESCE(al.is_active, true) IS TRUE)
    AS total_active_listings,
  COUNT(*) FILTER (
    WHERE COALESCE(al.is_active, true) IS TRUE
      AND al.verification_due_at IS NOT NULL
      AND al.verification_due_at <= now()
  )                                                           AS due_for_verification,
  COUNT(*) FILTER (
    WHERE COALESCE(al.is_active, true) IS TRUE
      AND (
        (al.last_verified_at IS NOT NULL AND al.last_verified_at < now() - INTERVAL '30 days')
        OR
        (al.last_verified_at IS NULL AND al.listing_date < (now() - INTERVAL '30 days')::date)
      )
  )                                                           AS overdue_30d,
  COUNT(*) FILTER (
    WHERE COALESCE(al.is_active, true) IS TRUE
      AND (
        (al.last_verified_at IS NOT NULL AND al.last_verified_at < now() - INTERVAL '90 days')
        OR
        (al.last_verified_at IS NULL AND al.listing_date < (now() - INTERVAL '90 days')::date)
      )
  )                                                           AS overdue_90d,
  COUNT(*) FILTER (
    WHERE COALESCE(al.is_active, true) IS TRUE
      AND al.last_verified_at IS NULL
  )                                                           AS never_verified,
  COUNT(*) FILTER (
    WHERE COALESCE(al.is_active, true) IS TRUE
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
  'Round 76cx Phase 2 + 76et-E: dashboard verification digest.
   evidence_verifications_* counts real checks (sidebar/manual/sold-imported,
   plus cron ticks that determined sold/off_market/price_changed/unreachable).
   cron_timer_advances_* counts cron ticks where no sale evidence was found
   and the timer was just advanced (check_result=inferred_active).
   verifications_last_* equals the sum of these two breakouts.';
