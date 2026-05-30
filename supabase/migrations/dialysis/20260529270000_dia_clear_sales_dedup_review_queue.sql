-- ============================================================================
-- Dia — Clear the medium-confidence sales dedup review queue (human-reviewed)
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- 2026-05-29: v_sales_dedup_review surfaced ~46 medium-confidence near-duplicate
-- live sale pairs (price within 5%, within 45 days) that the high-confidence
-- cross-month cleanup (±$1k) intentionally left for human review. Manual review
-- confirmed ALL are genuine cross-source duplicates of the same sale — the
-- recurring pattern is a CoStar month-only date (1st-of-month) + price/source
-- variance vs a precise-dated CSV/excel/deed row on the SAME property within ~a
-- month. For this asset class a property does not double-trade within a month at
-- within-5%, so these are duplicate-recordings, not distinct transactions.
--
-- Supersedes the losers (survivor by the standard source-priority order, then
-- sale_id); the 20260529170000 invariant trigger then auto-excludes them from
-- market metrics. Reversible via sales_dedup_review_cleared_20260529.
-- Applied live 2026-05-29: 44 superseded; review queue -> 0.
--
-- Note: the recurring sales_dedup_tick Pass 2 is deliberately kept at the tight
-- ±$1k tolerance (per "keep NM/SJC strict"); the 1-5% band continues to land in
-- v_sales_dedup_review for periodic human review rather than auto-merge.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sales_dedup_review_cleared_20260529 (
  sale_id integer PRIMARY KEY, old_transaction_state text, survivor_id integer,
  changed_at timestamptz DEFAULT now());

WITH live AS (
  SELECT sale_id, property_id, sold_price, sale_date,
    (CASE WHEN data_source LIKE 'county_deed:%' THEN 1 WHEN data_source='excel_master' THEN 2
          WHEN data_source='sjc_track_record_v2' THEN 3 WHEN data_source='historical_csv_import' THEN 4
          WHEN data_source='costar_export' THEN 5 WHEN data_source='costar_sidebar' THEN 6
          WHEN data_source='rca_sidebar_manual_bootstrap' THEN 7 WHEN data_source IS NULL THEN 8 ELSE 10 END) AS prio
  FROM public.sales_transactions
  WHERE transaction_state='live' AND exclude_from_market_metrics IS NOT TRUE AND sold_price>0
),
losers AS (
  SELECT b.sale_id AS loser_id, (array_agg(a.sale_id ORDER BY a.prio, a.sale_id))[1] AS survivor_id
  FROM live b JOIN live a
    ON a.property_id=b.property_id AND a.sale_id<>b.sale_id
   AND abs(a.sold_price-b.sold_price) <= 0.05*GREATEST(a.sold_price,b.sold_price)
   AND abs(a.sale_date-b.sale_date) <= 45
   AND (a.prio<b.prio OR (a.prio=b.prio AND a.sale_id<b.sale_id))
  GROUP BY b.sale_id
),
snap AS (INSERT INTO public.sales_dedup_review_cleared_20260529 (sale_id, old_transaction_state, survivor_id)
         SELECT loser_id,'live',survivor_id FROM losers ON CONFLICT DO NOTHING RETURNING 1)
UPDATE public.sales_transactions s SET transaction_state='duplicate_superseded', dedup_group_id=l.survivor_id, updated_at=now()
  FROM losers l WHERE s.sale_id=l.loser_id;

REFRESH MATERIALIZED VIEW public.v_sales_comps;
REFRESH MATERIALIZED VIEW public.mv_property_value_signal;
