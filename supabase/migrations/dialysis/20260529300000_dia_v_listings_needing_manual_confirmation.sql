-- ============================================================================
-- Dia — v_listings_needing_manual_confirmation (on-market manual follow-up)
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- 2026-05-29 Priority-2 (monitoring manual-follow-up loop). The
-- availability-checker parks "looks-sold" listings as
-- off_market_reason='unverified_assumed_off'; the :45 promotion sweep promotes
-- the ones with a deed match to sold. The rest (no deed match, or aged out of
-- the 90-day sweep window) had NO surface for a human to action — they sat in
-- limbo. This view powers the "Listings Needing Confirmation" panel:
--   * surfaces each unverified_assumed_off listing with its evidence + age,
--   * resolves the nearest LIVE sale on the property (±3y / +180d) as a
--     candidate so a human can one-click confirm-sold with the real close date,
--   * buckets each row: sale_match_promote / aged_needs_research / awaiting_sweep.
-- The panel's actions write through admin.js handleResolveListingConfirmation ->
-- lcc_record_listing_check(method='manual_user', verified_by=user.id).
-- ============================================================================

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
