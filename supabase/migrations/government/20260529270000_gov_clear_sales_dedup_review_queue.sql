-- ============================================================================
-- Gov — Clear the medium-confidence sales dedup review queue (human-reviewed)
--
-- Target: government Supabase (GOV_SUPABASE_URL)
-- Gov mirror of the dia migration of the same date (sale_id is uuid). Manual
-- review confirmed all ~32 gov pairs are genuine cross-source duplicates
-- (costar_sidebar month-only date vs excel_master precise date, same property,
-- within 5% / 45 days). Applied live 2026-05-29: 34 superseded; queue -> 0.
-- Reversible via sales_dedup_review_cleared_20260529. gov v_sales_comps is a
-- live view (no refresh needed); the overview KPI matview is refreshed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sales_dedup_review_cleared_20260529 (
  sale_id uuid PRIMARY KEY, old_transaction_state text, survivor_id uuid,
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
  SELECT b.sale_id AS loser_id, (array_agg(a.sale_id ORDER BY a.prio, a.sale_id::text))[1] AS survivor_id
  FROM live b JOIN live a
    ON a.property_id=b.property_id AND a.sale_id<>b.sale_id
   AND abs(a.sold_price-b.sold_price) <= 0.05*GREATEST(a.sold_price,b.sold_price)
   AND abs(a.sale_date-b.sale_date) <= 45
   AND (a.prio<b.prio OR (a.prio=b.prio AND a.sale_id::text<b.sale_id::text))
  GROUP BY b.sale_id
),
snap AS (INSERT INTO public.sales_dedup_review_cleared_20260529 (sale_id, old_transaction_state, survivor_id)
         SELECT loser_id,'live',survivor_id FROM losers ON CONFLICT DO NOTHING RETURNING 1)
UPDATE public.sales_transactions s SET transaction_state='duplicate_superseded', updated_at=now()
  FROM losers l WHERE s.sale_id=l.loser_id;

REFRESH MATERIALIZED VIEW public.mv_gov_overview_stats;
