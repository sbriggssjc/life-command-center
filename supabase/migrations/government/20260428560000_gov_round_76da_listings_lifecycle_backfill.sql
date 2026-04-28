-- ============================================================================
-- Round 76da — listings lifecycle date backfill (gov)
--
-- Same pattern as dia, adapted to gov schema:
--   - listing_status text (not is_active boolean)
--   - first_seen_at, last_seen_at timestamptz
--   - asking_price (not last_price)
--   - exclude_from_listing_metrics boolean already exists
--
-- Pre-state: 254 total, 188 active, 61 inactive without off_market_date,
-- 118 active without listing_date.
--
-- Post-state: 0 active without listing_date, 0 inactive without
-- off_market_date. view_today=106; gap to active=188 is the second-tier
-- cleanup (some active rows have past off_market_date or
-- exclude_from_listing_metrics=true) tracked separately.
-- ============================================================================

-- Pull off_market_date from linked sales_transactions
UPDATE public.available_listings al
   SET off_market_date = st.sale_date,
       off_market_reason = COALESCE(off_market_reason, 'sold')
  FROM public.sales_transactions st
 WHERE al.property_id = st.property_id
   AND COALESCE(al.listing_status,'active') <> 'active'
   AND al.off_market_date IS NULL
   AND st.sale_date IS NOT NULL
   AND st.sale_date >= al.listing_date
   AND st.sale_date <= COALESCE(al.last_seen_at::date, CURRENT_DATE);

UPDATE public.available_listings
   SET off_market_date = last_seen_at::date,
       off_market_reason = COALESCE(off_market_reason, 'unverified_assumed_off')
 WHERE COALESCE(listing_status,'active') <> 'active'
   AND off_market_date IS NULL AND last_seen_at IS NOT NULL;

UPDATE public.available_listings
   SET off_market_date = CURRENT_DATE,
       off_market_reason = COALESCE(off_market_reason, 'unverified_assumed_off')
 WHERE COALESCE(listing_status,'active') <> 'active' AND off_market_date IS NULL;

UPDATE public.available_listings
   SET listing_date = COALESCE(listing_date, first_seen_at::date, created_at::date, last_seen_at::date, CURRENT_DATE)
 WHERE COALESCE(listing_status,'active') = 'active' AND listing_date IS NULL;

UPDATE public.available_listings
   SET verification_due_at = public.lcc_compute_verification_due_at(listing_date, last_verified_at)
 WHERE COALESCE(listing_status,'active') = 'active' AND verification_due_at IS NULL;

CREATE OR REPLACE FUNCTION public.v_listings_on_market_at(target_date date)
RETURNS TABLE(listing_id uuid, property_id bigint, listing_date date, off_market_date date,
              asking_price numeric, cap_rate numeric, status_at_target text)
LANGUAGE sql STABLE AS $$
  WITH per_listing_state_at AS (
    SELECT DISTINCT ON (h.listing_id) h.listing_id, h.status, h.asking_price, h.cap_rate
    FROM public.listing_status_history h
    WHERE h.effective_at <= (target_date + interval '1 day')
    ORDER BY h.listing_id, h.effective_at DESC
  )
  SELECT al.listing_id, al.property_id, al.listing_date, al.off_market_date,
         COALESCE(s.asking_price, al.asking_price),
         COALESCE(s.cap_rate, al.asking_cap_rate),
         COALESCE(s.status, 'active')
  FROM public.available_listings al
  LEFT JOIN per_listing_state_at s ON s.listing_id = al.listing_id
  WHERE al.listing_date IS NOT NULL
    AND al.listing_date <= target_date
    AND (al.off_market_date IS NULL OR al.off_market_date > target_date)
    AND COALESCE(al.exclude_from_listing_metrics, false) IS FALSE
    AND (target_date < CURRENT_DATE OR COALESCE(al.listing_status,'active') = 'active')
    AND COALESCE(s.status, 'active') NOT IN ('off_market','withdrawn','expired','sold');
$$;
