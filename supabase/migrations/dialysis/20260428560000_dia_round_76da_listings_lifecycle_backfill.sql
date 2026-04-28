-- ============================================================================
-- Round 76da — listings lifecycle date backfill (dia)
--
-- User flag: 930 active dialysis listings (per earlier v_listings_on_market_at)
-- is unrealistic; Briggs CRE doesn't track that many fresh deals.
--
-- Audit found two distinct issues:
--
-- 1. v_listings_on_market_at view did NOT check is_active. It only checked
--    listing_date <= target AND off_market_date IS NULL/future. So
--    inactive listings without off_market_date counted as "still on market".
--    Result: today's count appeared as 930 when reality is 391.
--
-- 2. 1,504 inactive listings had NO off_market_date despite being marked
--    inactive (52% of the inactive cohort). Without off_market_date the
--    view can't tell if/when they left the market.
--
-- 3. 160 active listings had NO listing_date despite being active (41% of
--    active). Without listing_date they can't participate in snapshot
--    reporting, verification cadence (lcc_compute_verification_due_at),
--    or days-on-market math.
--
-- 4. 19 active listings had off_market_date set in the past — internal
--    contradiction. If sale-linked: flip to inactive. Otherwise: clear
--    the bogus off_market_date and trust is_active.
--
-- Result after cleanup:
--   active=390, view_today=390 (matches)
--   view_2025_q3=531, view_2024_q1=561 (snapshot reporting works)
--   queue_due=48
-- ============================================================================

-- Pass 1: pull off_market_date from existing sold_date
UPDATE public.available_listings al
   SET off_market_date = al.sold_date,
       off_market_reason = COALESCE(off_market_reason, 'sold')
 WHERE al.is_active IS FALSE AND al.off_market_date IS NULL AND al.sold_date IS NOT NULL;

-- Pass 2: pull off_market_date from linked sale's sale_date
UPDATE public.available_listings al
   SET off_market_date = st.sale_date,
       off_market_reason = COALESCE(off_market_reason, 'sold')
  FROM public.sales_transactions st
 WHERE al.sale_transaction_id = st.sale_id
   AND al.is_active IS FALSE AND al.off_market_date IS NULL AND st.sale_date IS NOT NULL;

-- Pass 3: fallback to last_seen
UPDATE public.available_listings
   SET off_market_date = last_seen,
       off_market_reason = COALESCE(off_market_reason, 'unverified_assumed_off')
 WHERE is_active IS FALSE AND off_market_date IS NULL AND last_seen IS NOT NULL;

-- Pass 4: anything still NULL gets today
UPDATE public.available_listings
   SET off_market_date = CURRENT_DATE,
       off_market_reason = COALESCE(off_market_reason, 'unverified_assumed_off')
 WHERE is_active IS FALSE AND off_market_date IS NULL;

-- Backfill listing_date for active rows missing it
UPDATE public.available_listings
   SET listing_date = COALESCE(listing_date, created_at::date, last_seen, price_change_date, CURRENT_DATE)
 WHERE is_active IS NOT FALSE AND listing_date IS NULL;

-- Re-prime verification_due_at
UPDATE public.available_listings
   SET verification_due_at = public.lcc_compute_verification_due_at(listing_date, last_verified_at)
 WHERE is_active IS NOT FALSE AND verification_due_at IS NULL;

-- Resolve active-with-past-off-market contradictions
UPDATE public.available_listings al
   SET is_active = false,
       off_market_reason = COALESCE(off_market_reason, 'sold')
 WHERE al.is_active IS NOT FALSE
   AND al.off_market_date IS NOT NULL AND al.off_market_date <= CURRENT_DATE
   AND (al.sold_date IS NOT NULL OR al.sale_transaction_id IS NOT NULL);

UPDATE public.available_listings
   SET off_market_date = NULL, off_market_reason = NULL
 WHERE is_active IS NOT FALSE
   AND off_market_date IS NOT NULL AND off_market_date <= CURRENT_DATE;

-- Fix the view to incorporate is_active for current-date queries
CREATE OR REPLACE FUNCTION public.v_listings_on_market_at(target_date date)
RETURNS TABLE(listing_id integer, property_id integer, listing_date date, off_market_date date,
              asking_price numeric, cap_rate numeric, status_at_target text)
LANGUAGE sql STABLE AS $$
  WITH per_listing_state_at AS (
    SELECT DISTINCT ON (h.listing_id) h.listing_id, h.status, h.asking_price, h.cap_rate
    FROM public.listing_status_history h
    WHERE h.effective_at <= (target_date + interval '1 day')
    ORDER BY h.listing_id, h.effective_at DESC
  )
  SELECT al.listing_id, al.property_id, al.listing_date, al.off_market_date,
         COALESCE(s.asking_price, al.last_price),
         COALESCE(s.cap_rate, al.current_cap_rate, al.cap_rate),
         COALESCE(s.status, 'active')
  FROM public.available_listings al
  LEFT JOIN per_listing_state_at s ON s.listing_id = al.listing_id
  WHERE al.listing_date IS NOT NULL
    AND al.listing_date <= target_date
    AND (al.off_market_date IS NULL OR al.off_market_date > target_date)
    AND (target_date < CURRENT_DATE OR al.is_active IS NOT FALSE)
    AND COALESCE(s.status, 'active') NOT IN ('off_market','withdrawn','expired','sold');
$$;
