-- ============================================================================
-- Round 76ay — Government dashboard duplicate suppression
--
-- Same audit pattern: 303 portfolio + ~600 multi-buyer dup groups visible
-- in v_sales_comps and 16 in v_available_listings.
--
-- Gov v_sales_comps already filters on exclude_from_market_metrics — just
-- mark dups + refresh. Gov v_available_listings already filters on
-- exclude_from_listing_metrics — same approach.
-- ============================================================================

-- ── 1. Sales dashboard dedup ───────────────────────────────────────────────
WITH dup_groups AS (
  SELECT property_id, sale_date FROM public.sales_transactions
  WHERE property_id IS NOT NULL AND sale_date IS NOT NULL
    AND COALESCE(exclude_from_market_metrics, FALSE) = FALSE
  GROUP BY 1, 2 HAVING COUNT(*) > 1
),
ranked AS (
  SELECT s.sale_id,
    ROW_NUMBER() OVER (
      PARTITION BY s.property_id, s.sale_date
      ORDER BY
        ((s.buyer IS NOT NULL)::int + (s.seller IS NOT NULL)::int + (s.sold_price IS NOT NULL)::int) DESC,
        s.sold_price DESC NULLS LAST,
        s.sale_id::text
    ) AS rn
  FROM public.sales_transactions s
  JOIN dup_groups dg USING (property_id, sale_date)
)
UPDATE public.sales_transactions st SET exclude_from_market_metrics = TRUE
  FROM ranked r WHERE st.sale_id = r.sale_id AND r.rn > 1;

-- ── 2. Listings dashboard dedup ────────────────────────────────────────────
WITH ranked AS (
  SELECT al.listing_id, al.property_id,
    ROW_NUMBER() OVER (
      PARTITION BY al.property_id
      ORDER BY
        (CASE WHEN al.listing_status = 'Active' THEN 0
              WHEN al.listing_status IS NULL THEN 1
              WHEN al.listing_status = 'superseded' THEN 2 ELSE 3 END),
        al.listing_date DESC NULLS LAST,
        al.last_seen_at DESC NULLS LAST,
        ((al.asking_price IS NOT NULL)::int + (al.annual_rent IS NOT NULL)::int +
         (al.listing_broker IS NOT NULL)::int + (al.square_feet IS NOT NULL)::int) DESC,
        al.listing_id::text
    ) AS rn
  FROM public.available_listings al
  WHERE COALESCE(al.exclude_from_listing_metrics, FALSE) = FALSE
    AND al.property_id IS NOT NULL
)
UPDATE public.available_listings al
   SET exclude_from_listing_metrics = TRUE,
       listing_exclusion_reason = COALESCE(al.listing_exclusion_reason,
         'Round 76ay: dedup — sibling listing on same property kept as canonical')
  FROM ranked r
 WHERE al.listing_id = r.listing_id AND r.rn > 1;

REFRESH MATERIALIZED VIEW public.v_sales_comps;
REFRESH MATERIALIZED VIEW public.v_available_listings;
