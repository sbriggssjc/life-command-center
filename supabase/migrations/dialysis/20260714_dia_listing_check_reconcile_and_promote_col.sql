-- ============================================================================
-- Dia — reconcile listing history CHECKs + expose exclude flag on the
--        manual-confirmation view (availability-promotion-sweep age-decoupling)
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL, zqzrriwuavgrquhisnoa)
--
-- 2026-07-14. The availability-promotion-sweep promotes a listing to Sold via
-- lcc_record_listing_check(), which passes its single p_method to BOTH
-- listing_verification_history.method (lvh_method_check) AND
-- listing_status_history.source (lsh_source_check). The two CHECKs disagreed on
-- the "imported from a sale" label — lvh had 'sold_imported', lsh had
-- 'sale_imported' — so the only method values valid for both were
-- auto_scrape / manual_user / sidebar_capture, forcing a confirmed sale-match
-- promotion to masquerade as 'auto_scrape'.
--
-- This migration:
--   1. Widens BOTH CHECKs so each accepts the other's label ('sale_imported'
--      added to lvh, 'sold_imported' added to lsh) — additive/widening, so it
--      never fails validation on existing rows and is safe to apply before the
--      JS writer ships. The sweep now labels sale-from-match rows honestly as
--      'sale_imported' instead of a generic 'auto_scrape'.
--   2. Appends exclude_from_listing_metrics to
--      v_listings_needing_manual_confirmation so the sweep can keep guarding
--      out test / soft-deleted rows while driving off the view's classification
--      (append-only column; existing consumers unaffected).
-- Reversible: re-create the prior CHECKs / re-run the prior view body.
-- ============================================================================

-- 1. Reconcile the two history CHECKs (widen — accept both semantic labels).
ALTER TABLE public.listing_verification_history DROP CONSTRAINT IF EXISTS lvh_method_check;
ALTER TABLE public.listing_verification_history ADD CONSTRAINT lvh_method_check
  CHECK (method = ANY (ARRAY['auto_scrape','manual_user','sidebar_capture','sold_imported','sale_imported']));

ALTER TABLE public.listing_status_history DROP CONSTRAINT IF EXISTS lsh_source_check;
ALTER TABLE public.listing_status_history ADD CONSTRAINT lsh_source_check
  CHECK (source IS NULL OR source = ANY (
    ARRAY['auto_scrape','sidebar_capture','manual_user','sale_imported','matcher_inferred','seed_import','sold_imported']));

-- 2. Append exclude_from_listing_metrics to the manual-confirmation view.
--    (CREATE OR REPLACE VIEW is append-only for columns — new column LAST.)
CREATE OR REPLACE VIEW public.v_listings_needing_manual_confirmation AS
SELECT
  al.listing_id, al.property_id,
  p.address, p.city, p.state, COALESCE(p.tenant, p.operator::varchar) AS tenant_operator,
  al.last_price AS ask_price, al.seller_name, al.listing_broker,
  COALESCE(al.listing_url, al.url) AS listing_url,
  al.status, al.off_market_reason, al.off_market_date,
  (CURRENT_DATE - al.off_market_date) AS days_since_off_market,
  al.consecutive_check_failures, al.last_verified_at,
  ss.sale_id    AS candidate_sale_id,
  ss.sale_date  AS candidate_sale_date,
  ss.sold_price AS candidate_sold_price,
  CASE
    WHEN ss.sale_id IS NOT NULL THEN 'sale_match_promote'
    WHEN al.off_market_date < CURRENT_DATE - INTERVAL '90 days' THEN 'aged_needs_research'
    ELSE 'awaiting_sweep'
  END AS confirmation_state,
  al.exclude_from_listing_metrics
FROM public.available_listings al
LEFT JOIN public.properties p ON p.property_id = al.property_id
LEFT JOIN LATERAL (
  SELECT s.sale_id, s.sale_date, s.sold_price
  FROM public.sales_transactions s
  WHERE s.property_id = al.property_id AND s.transaction_state='live' AND s.sale_date IS NOT NULL
    AND s.sale_date BETWEEN al.off_market_date - INTERVAL '3 years' AND al.off_market_date + INTERVAL '180 days'
  ORDER BY abs(s.sale_date - al.off_market_date) LIMIT 1
) ss ON true
WHERE al.off_market_reason = 'unverified_assumed_off'
ORDER BY (ss.sale_id IS NOT NULL) DESC, al.off_market_date ASC;

GRANT SELECT ON public.v_listings_needing_manual_confirmation TO anon, authenticated, service_role;
