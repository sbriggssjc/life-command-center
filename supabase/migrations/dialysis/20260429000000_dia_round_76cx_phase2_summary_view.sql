-- ============================================================================
-- Round 76cx — Phase 2 (dia): listing verification summary view + per-property
-- detail view powering the dashboard widget and the property-detail panel.
--
-- v_listing_verification_summary returns a single-row dashboard digest:
--   total_active_listings, due_for_verification, overdue_30d, overdue_90d,
--   never_verified, recent_status_changes_7d, broken_url_count,
--   verifications_last_24h, verifications_last_7d.
--
-- v_listing_verification_detail returns per-listing detail for the property-
-- detail panel: includes listing_id, property_id, address, status, last_verified,
-- verification_due, days_until_due (negative = overdue), consecutive_failures,
-- last_verification_method, last_verification_result, last_status_change.
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
  al.is_active,
  al.listing_url,
  al.url,
  al.last_price AS asking_price,
  COALESCE(al.current_cap_rate, al.cap_rate) AS cap_rate,
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
WHERE COALESCE(al.is_active, true) IS TRUE
   OR al.off_market_date >= (now() - INTERVAL '90 days')::date;

COMMENT ON VIEW public.v_listing_verification_summary IS
  'Round 76cx Phase 2: single-row digest powering the dashboard verification widget.';
COMMENT ON VIEW public.v_listing_verification_detail IS
  'Round 76cx Phase 2: per-listing detail for the property-detail verification panel. Includes recently-off-market listings (within 90 days) so the panel can show context after a sale.';
