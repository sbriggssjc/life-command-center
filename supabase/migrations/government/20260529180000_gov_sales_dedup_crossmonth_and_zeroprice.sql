-- ============================================================================
-- Gov — Sales comps: catch cross-month duplicate sales + zero-price gap
--
-- Target: government Supabase (GOV_SUPABASE_URL)
-- Gov mirror of the dia migration of the same date; see that file's header.
-- Gov tick signature includes ownership_stub_reclassified (gov has stubs).
-- Applied live 2026-05-29: tick cleared 2 zero-price rows; 29 cross-month dups
-- superseded; 0 exact cross-month dups remain.
-- ============================================================================

BEGIN;

-- #2 — zero-price gap (gov tick signature: rows_reclassified, ownership_stub_reclassified, run_at)
CREATE OR REPLACE FUNCTION public.sales_needs_review_tick()
 RETURNS TABLE(rows_reclassified bigint, ownership_stub_reclassified bigint, run_at timestamp with time zone)
 LANGUAGE plpgsql AS $function$
DECLARE v_nr BIGINT := 0; v_st BIGINT := 0;
BEGIN
  WITH patched AS (
    UPDATE public.sales_transactions SET transaction_state='ownership_stub', updated_at=now()
     WHERE transaction_state='live' AND COALESCE(data_source,'') LIKE 'ownership_change_stub%'
    RETURNING sale_id
  ) SELECT COUNT(*) INTO v_st FROM patched;
  WITH patched AS (
    UPDATE public.sales_transactions SET transaction_state='needs_review', updated_at=now()
     WHERE transaction_state='live'
       AND COALESCE(sold_price,0) <= 0          -- was: sold_price IS NULL (missed price=0)
       AND COALESCE(data_source,'') NOT LIKE 'ownership_change_stub%'
    RETURNING sale_id
  ) SELECT COUNT(*) INTO v_nr FROM patched;
  RETURN QUERY SELECT v_nr, v_st, now();
END; $function$;

SELECT public.sales_needs_review_tick();

-- #1 — one-time cross-month duplicate supersede (high-confidence tier). gov sale_id is uuid.
CREATE TABLE IF NOT EXISTS public.sales_dedup_falseneg_backfill_20260529 (
  sale_id uuid PRIMARY KEY, old_transaction_state text, survivor_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

WITH live AS (
  SELECT sale_id, property_id, sold_price, sale_date,
    (CASE COALESCE(data_source,'zzz')
       WHEN 'county_deed' THEN 1 WHEN 'excel_master' THEN 2 WHEN 'sjc_track_record' THEN 3
       WHEN 'historical_csv_import' THEN 4 WHEN 'costar_export' THEN 5 WHEN 'costar_sidebar' THEN 6
       WHEN 'rca_sidebar' THEN 7 ELSE 8 END) AS prio
  FROM sales_transactions
  WHERE transaction_state='live' AND exclude_from_market_metrics IS NOT TRUE AND sold_price > 0
),
losers AS (
  SELECT b.sale_id AS loser_id,
         (array_agg(a.sale_id ORDER BY a.prio, a.sale_id))[1] AS survivor_id
  FROM live b JOIN live a
    ON a.property_id = b.property_id AND a.sale_id <> b.sale_id
   AND abs(a.sold_price - b.sold_price) <= 1000
   AND abs(a.sale_date - b.sale_date) <= 60
   AND (a.prio < b.prio OR (a.prio = b.prio AND a.sale_id < b.sale_id))
  GROUP BY b.sale_id
),
snap AS (
  INSERT INTO public.sales_dedup_falseneg_backfill_20260529 (sale_id, old_transaction_state, survivor_id)
  SELECT l.loser_id, 'live', l.survivor_id FROM losers l
  ON CONFLICT (sale_id) DO NOTHING RETURNING 1
)
UPDATE sales_transactions s
   SET transaction_state='duplicate_superseded', updated_at=now()
  FROM losers l WHERE s.sale_id = l.loser_id;

-- gov v_sales_comps is now a live regular view (converted 2026-05-29) — no refresh
-- needed. Refresh the overview KPI matview so the supersedes are reflected.
REFRESH MATERIALIZED VIEW public.mv_gov_overview_stats;

COMMIT;
