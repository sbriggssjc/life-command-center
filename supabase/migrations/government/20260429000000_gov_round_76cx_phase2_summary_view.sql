-- ============================================================================
-- Round 76cx — Phase 2 (gov): listing verification summary + detail views.
-- Same shape as the dia version, adapted to gov's available_listings columns:
--   listing_status text (not is_active boolean)
--   asking_price (not last_price)
--   first_seen_at, last_seen_at timestamptz (not last_seen date)
--   exclude_from_listing_metrics
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
    WHERE v.verified_at >= now() - INTERVAL '7 days')         AS verifications_last_7d
FROM public.available_listings al;

CREATE OR REPLACE VIEW public.v_listing_verification_detail AS
WITH last_verif AS (
  SELECT DISTINCT ON (listing_id)
    listing_id, verified_at, method, check_result, source_url
  FROM public.listing_verification_history
  ORDER BY listing_id, verified_at DESC
),
last_status AS (
  SELECT DISTINCT ON (listing_id)
    listing_id, status AS last_status, effective_at AS last_status_change_at, source AS last_status_source
  FROM public.listing_status_history
  ORDER BY listing_id, effective_at DESC
)
SELECT
  al.listing_id,
  al.property_id,
  p.address,
  p.city,
  p.state,
  al.listing_date,
  al.off_market_date,
  al.listing_status,
  al.source_url AS listing_url,
  al.asking_price,
  al.asking_cap_rate AS cap_rate,
  al.last_verified_at,
  al.verification_due_at,
  EXTRACT(EPOCH FROM (al.verification_due_at - now()))::bigint / 86400 AS days_until_due,
  al.verification_priority,
  COALESCE(al.consecutive_check_failures, 0) AS consecutive_check_failures,
  al.off_market_reason,
  lv.verified_at        AS last_verification_at,
  lv.method             AS last_verification_method,
  lv.check_result       AS last_verification_result,
  lv.source_url         AS last_verification_url,
  ls.last_status,
  ls.last_status_change_at,
  ls.last_status_source
FROM public.available_listings al
LEFT JOIN public.properties p ON p.property_id = al.property_id
LEFT JOIN last_verif lv ON lv.listing_id = al.listing_id
LEFT JOIN last_status ls ON ls.listing_id = al.listing_id
WHERE COALESCE(al.listing_status, 'active') = 'active'
   OR al.off_market_date >= (now() - INTERVAL '90 days')::date;

COMMENT ON VIEW public.v_listing_verification_summary IS
  'Round 76cx Phase 2: gov dashboard verification digest.';
COMMENT ON VIEW public.v_listing_verification_detail IS
  'Round 76cx Phase 2: gov per-listing detail. Includes recently-off-market listings (within 90 days).';
