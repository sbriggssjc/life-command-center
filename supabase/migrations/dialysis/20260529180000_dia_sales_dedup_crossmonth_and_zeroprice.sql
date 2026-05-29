-- ============================================================================
-- Dia — Sales comps: catch cross-month duplicate sales + zero-price gap
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Follow-ups from the 2026-05-29 comps review (data + display):
--
-- #2 zero-price gap: sales_needs_review_tick() tagged only `sold_price IS NULL`
--    as needs_review, missing `sold_price = 0`. Widen to COALESCE(...) <= 0 so a
--    zero-price live row (a price gap, not a comp) is excluded going forward.
--
-- #1 dedup false-negatives: the 15-min sales-dedup-tick keys on
--    (property, price±$1k, calendar-MONTH), so it MISSES genuine duplicates that
--    cross a month boundary — common because CoStar reports month-only sale
--    dates (1st-of-month) while the CSV/deed source carries the precise date,
--    landing the same sale in two month buckets. Confirmed genuine dups by
--    sampling (same property, identical price, ~30-45 days apart, two sources).
--    This migration supersedes the high-confidence subset: same property,
--    price within $1k (the system's existing tolerance), within 60 days.
--    Survivor = existing source-priority order, then lowest sale_id. Losers are
--    tagged duplicate_superseded (the 20260529170000 invariant trigger then
--    auto-sets exclude_from_market_metrics) with dedup_group_id -> survivor.
--    Reversible via snapshot. Medium-confidence pairs (price drift 0.5-5%) are
--    intentionally NOT auto-merged — left for human review.
-- Applied live 2026-05-29: 39 rows superseded; 0 exact cross-month dups remain.
-- ============================================================================

BEGIN;

-- #2 — zero-price gap (dia tick signature: rows_reclassified, run_at)
CREATE OR REPLACE FUNCTION public.sales_needs_review_tick()
 RETURNS TABLE(rows_reclassified bigint, run_at timestamp with time zone)
 LANGUAGE plpgsql AS $function$
DECLARE v_n BIGINT := 0;
BEGIN
  WITH patched AS (
    UPDATE public.sales_transactions
       SET transaction_state = 'needs_review', updated_at = now()
     WHERE transaction_state = 'live' AND COALESCE(sold_price,0) <= 0   -- was: sold_price IS NULL
    RETURNING sale_id
  )
  SELECT COUNT(*) INTO v_n FROM patched;
  RETURN QUERY SELECT v_n, now();
END; $function$;

SELECT public.sales_needs_review_tick();

-- #1 — one-time cross-month duplicate supersede (high-confidence tier)
CREATE TABLE IF NOT EXISTS public.sales_dedup_falseneg_backfill_20260529 (
  sale_id integer PRIMARY KEY, old_transaction_state text, survivor_id integer,
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
   SET transaction_state='duplicate_superseded', dedup_group_id = l.survivor_id, updated_at=now()
  FROM losers l WHERE s.sale_id = l.loser_id;

-- Refresh the dia comp matviews so the supersedes are reflected immediately.
REFRESH MATERIALIZED VIEW public.v_sales_comps;
REFRESH MATERIALIZED VIEW public.mv_property_value_signal;

COMMIT;

-- Follow-ups (not in this migration): (a) make the 15-min sales-dedup-tick catch
-- cross-month dups going forward (proximity instead of month bucket); (b) review
-- the medium-confidence (price drift 0.5-5%) residual pairs.
