-- T4c Item 3 follow-up (Scott, 2026-06-24): make the dia DOM-of-sold series
-- OBSERVED-ONLY. Applied live to dia (zqzrriwuavgrquhisnoa).
--
-- DOM computed from an imputed/sale-anchored on-market date is circular (it just
-- returns the offset), so cm_dialysis_dom_pct_ask_m/_q now exclude every imputed
-- on_market_date source: sale_anchor_est_175, synth_sale_minus_median_dom*,
-- synth_sale_minus_median_dom_held (NOT LIKE 'synth%'/'sale_anchor%'), plus the
-- existing data_source='synthetic_from_sale' exclusion. Kept: genuinely-observed
-- on-market dates (sf_on_market_date, costar_days_on_market, unestablished_historical
-- / real captured listing dates).
--
-- Evidence (live, 2026-06-24): the dropped sources sit at the 175-day offset
-- (synth_sale_minus_median_dom_held sd 0 / all 175; sale_anchor_est_175 91% exactly
-- 175); the kept set (unestablished_historical, 785) shows a natural spread
-- (avg 478, sd 738, 432 distinct DOM values). After the fix the series reflects
-- observed time-to-sell (recent avg ~241d monthly / ~288d quarterly) instead of the
-- imputed 175. Population thins to the observed set; the existing n_sales>=10 density
-- floor + gap-honest rendering keep thin periods as honest NULL gaps (78 monthly / 26
-- quarterly non-null periods since 2020) rather than padding with imputed 175s.
--
-- _m already carried the n_sales>=10 floor + 5-month smoothing; _q previously had
-- NEITHER and now gains the same floor (gap-honest). gov DOM
-- (cm_gov_dom_pct_ask_m/_q) reads sales_transactions reported DOM (avg 232, sd 175,
-- 385 distinct, no constant-offset spike) — no sale-anchored exposure, intentionally
-- NOT touched.
--
-- REVERT: re-create the prior bodies without the two
-- COALESCE(on_market_date_source,'') !~~ 'synth%'/'sale_anchor%' predicates
-- (and drop the new _q n_sales>=10 gate).

CREATE OR REPLACE VIEW public.cm_dialysis_dom_pct_ask_m AS
WITH month_anchors AS (
  SELECT (date_trunc('month', g.d) + interval '1 mon -1 days')::date AS period_end
  FROM generate_series('2001-01-01'::date::timestamptz, CURRENT_DATE::timestamptz, interval '1 mon') g(d)
), sold AS (
  SELECT m.period_end,
    al.sold_date - al.on_market_date AS dom,
    CASE WHEN al.initial_price > 0::numeric AND al.sold_price > 0::numeric
         THEN al.sold_price / al.initial_price ELSE NULL::numeric END AS ratio
  FROM month_anchors m
  LEFT JOIN available_listings al
    ON COALESCE(al.status,''::text::character varying)::text !~~* '%supersed%'::text
   AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text
   AND COALESCE(al.on_market_date_source,''::text) !~~ 'synth%'::text
   AND COALESCE(al.on_market_date_source,''::text) !~~ 'sale_anchor%'::text
   AND al.sold_date > (m.period_end - '1 year'::interval)::date
   AND al.sold_date <= m.period_end
   AND al.on_market_date IS NOT NULL
   AND al.sold_price IS NOT NULL AND al.sold_price > 0::numeric
), agg AS (
  SELECT period_end,
    count(*) FILTER (WHERE dom >= 0 AND dom <= 730) AS n_sales,
    avg(dom) FILTER (WHERE dom >= 0 AND dom <= 730) AS avg_dom_raw,
    avg(ratio) FILTER (WHERE ratio IS NOT NULL AND ratio >= 0.5 AND ratio < 1.0) AS pct_raw,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (dom::double precision))
      FILTER (WHERE dom >= 0 AND dom <= 730) AS mdom_raw,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (ratio::double precision))
      FILTER (WHERE ratio IS NOT NULL AND ratio >= 0.5 AND ratio < 1.0) AS mpct_raw
  FROM sold GROUP BY period_end
), gated AS (
  SELECT period_end, n_sales,
    CASE WHEN n_sales >= 10 THEN avg_dom_raw ELSE NULL::numeric END AS dom_g,
    CASE WHEN n_sales >= 10 THEN pct_raw ELSE NULL::numeric END AS pct_g,
    CASE WHEN n_sales >= 10 THEN mdom_raw ELSE NULL::double precision END AS mdom_g,
    CASE WHEN n_sales >= 10 THEN mpct_raw ELSE NULL::double precision END AS mpct_g
  FROM agg
)
SELECT period_end, 'all'::text AS subspecialty, n_sales,
  (avg(dom_g) OVER w)::numeric(10,1) AS avg_dom,
  (avg(pct_g) OVER w)::numeric(8,5) AS pct_of_ask,
  (avg(mdom_g) OVER w)::numeric(10,1) AS median_dom,
  (avg(mpct_g) OVER w)::numeric(8,5) AS median_pct_of_ask
FROM gated
WINDOW w AS (ORDER BY period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING)
ORDER BY period_end;

CREATE OR REPLACE VIEW public.cm_dialysis_dom_pct_ask_q AS
WITH quarter_anchors AS (
  SELECT DISTINCT (date_trunc('quarter', sold_date::timestamptz) + '3 mons -1 days'::interval)::date AS period_end
  FROM available_listings
  WHERE sold_date IS NOT NULL AND data_source IS DISTINCT FROM 'synthetic_from_sale'::text
    AND on_market_date IS NOT NULL AND last_price IS NOT NULL AND last_price > 0::numeric
    AND sold_price IS NOT NULL AND sold_price > 0::numeric
), ttm_sold_filtered AS (
  SELECT q.period_end,
    al.sold_date - al.on_market_date AS days_on_market,
    al.sold_price / NULLIF(al.last_price, 0::numeric) AS pct_of_ask
  FROM quarter_anchors q
  JOIN available_listings al
    ON COALESCE(al.status,''::text::character varying)::text !~~* '%supersed%'::text
   AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text
   AND COALESCE(al.on_market_date_source,''::text) !~~ 'synth%'::text
   AND COALESCE(al.on_market_date_source,''::text) !~~ 'sale_anchor%'::text
   AND al.sold_date > (q.period_end - '1 year'::interval)::date
   AND al.sold_date <= q.period_end
   AND al.on_market_date IS NOT NULL
   AND al.last_price IS NOT NULL AND al.last_price > 0::numeric
   AND al.sold_price IS NOT NULL AND al.sold_price > 0::numeric
   AND (al.sold_date - al.on_market_date) >= 0 AND (al.sold_date - al.on_market_date) <= 1095
   AND (al.sold_price::numeric / al.last_price::numeric) >= 0.50
   AND (al.sold_price::numeric / al.last_price::numeric) <= 1.50
), agg AS (
  SELECT period_end, count(*) AS n_sales,
    avg(days_on_market)::numeric(10,1) AS avg_dom_raw,
    avg(pct_of_ask)::numeric(8,5) AS pct_raw
  FROM ttm_sold_filtered GROUP BY period_end
)
SELECT period_end, 'all'::text AS subspecialty, n_sales,
  (CASE WHEN n_sales >= 10 THEN avg_dom_raw ELSE NULL::numeric END)::numeric(10,1) AS avg_dom,
  (CASE WHEN n_sales >= 10 THEN pct_raw ELSE NULL::numeric END)::numeric(8,5) AS pct_of_ask
FROM agg ORDER BY period_end;
