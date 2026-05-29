-- ============================================================================
-- Gov — Sales comps: dedup review queue
--
-- Target: government Supabase (GOV_SUPABASE_URL)
--
-- 2026-05-29 comps-review. Gov needs NO rent-at-sale change: gov v_sales_comps
-- already exposes gross_rent captured at the sale (not a projection), so it is
-- already "rent at sale". This migration only adds the dedup review queue —
-- medium-confidence near-duplicate live sale pairs (price within 5%, within 45
-- days) that the 20260529180000 high-confidence cleanup did NOT auto-merge, for
-- human review. Applied live 2026-05-29: 32 pairs.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_sales_dedup_review AS
WITH live AS (
  SELECT sale_id, property_id, sold_price, sale_date, data_source
  FROM sales_transactions
  WHERE transaction_state='live' AND exclude_from_market_metrics IS NOT TRUE AND sold_price>0
)
SELECT a.property_id,
       a.sale_id AS sale_id_a, a.sale_date AS date_a, a.sold_price AS price_a, a.data_source AS src_a,
       b.sale_id AS sale_id_b, b.sale_date AS date_b, b.sold_price AS price_b, b.data_source AS src_b,
       abs(b.sale_date - a.sale_date) AS days_apart,
       round(abs(a.sold_price - b.sold_price) / GREATEST(a.sold_price, b.sold_price) * 100, 2) AS price_diff_pct
FROM live a JOIN live b
  ON a.property_id = b.property_id AND a.sale_id < b.sale_id
 AND abs(a.sold_price - b.sold_price) <= 0.05 * GREATEST(a.sold_price, b.sold_price)
 AND abs(a.sale_date - b.sale_date) <= 45
ORDER BY a.property_id, days_apart;
