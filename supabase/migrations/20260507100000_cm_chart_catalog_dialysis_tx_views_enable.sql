-- Tier 2 items 4-7 of 8: enable 4 transaction-level templates for dialysis.
-- Companion to DialysisProject migration 20260507100000_cm_dialysis_tx_views
-- which adds the underlying views to the Dialysis_DB project:
--   cm_dialysis_dom_pct_ask_q
--   cm_dialysis_bid_ask_spread_q
--   cm_dialysis_seller_sentiment_q
--   cm_dialysis_cap_by_term_q
--
-- After this PR + the Dialysis-side merge, dialysis Tier 2 progress is
-- 7 of 8: all transaction-level + macro views shipped, only valuation_index
-- remains deferred (needs a different formula since dia.sales_transactions
-- lacks gov's noi_psf / sf_leased columns).

UPDATE public.cm_chart_catalog
SET applies_to_verticals = ARRAY(
  SELECT DISTINCT v
  FROM unnest(applies_to_verticals || ARRAY['dialysis']) v
  ORDER BY v
)
WHERE chart_template_id IN (
  'dom_and_pct_of_ask',
  'bid_ask_spread',
  'seller_sentiment',
  'cap_rate_by_lease_term'
);
