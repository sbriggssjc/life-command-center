-- ============================================================================
-- Gov — v_listings_needing_manual_confirmation (on-market manual follow-up)
--
-- Target: government Supabase (GOV_SUPABASE_URL)
-- Gov mirror of the dia view of the same date. Gov columns differ
-- (listing_status, asking_price, source_url/tracked_urls jsonb, tenant_agency).
-- See the dia file header for the rationale. sale_id is uuid; the LATERAL match
-- and bucketing are identical.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_listings_needing_manual_confirmation AS
SELECT
  al.listing_id, al.property_id,
  COALESCE(al.address, p.address) AS address,
  COALESCE(al.city, p.city) AS city,
  COALESCE(al.state, p.state) AS state,
  COALESCE(al.tenant_agency, p.agency) AS tenant_operator,
  al.asking_price AS ask_price, al.seller_name, al.listing_broker,
  COALESCE(al.source_url, al.tracked_urls->>0) AS listing_url,
  al.listing_status AS status, al.off_market_reason, al.off_market_date,
  (CURRENT_DATE - al.off_market_date) AS days_since_off_market,
  al.consecutive_check_failures, al.last_verified_at,
  ss.sale_id    AS candidate_sale_id,
  ss.sale_date  AS candidate_sale_date,
  ss.sold_price AS candidate_sold_price,
  CASE
    WHEN ss.sale_id IS NOT NULL THEN 'sale_match_promote'
    WHEN al.off_market_date < CURRENT_DATE - INTERVAL '90 days' THEN 'aged_needs_research'
    ELSE 'awaiting_sweep'
  END AS confirmation_state
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
