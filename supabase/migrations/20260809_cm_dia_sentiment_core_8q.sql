-- ============================================================================
-- CM chart feedback item #5 (B3) — sentiment CORE lines on a trailing-8q window
-- Target: Dialysis_DB (zqzrriwuavgrquhisnoa)
-- ============================================================================
-- The 10+/8+ yr "core" sentiment lines die mid-2025: core (long-term) closings
-- nearly stopped, so the trailing single-quarter core sample is n~1-3 and the
-- >=5 density gate NULLs it. A thin cohort needs a LONGER window to say
-- anything. This adds TRAILING-8-QUARTER core columns (the chart binds to
-- these), gated at >=5 over the 8-quarter closing window; NULL only when even
-- the 8-qtr core n < 5.
--
-- Adds two columns at the END of the SELECT (append-only per the CREATE OR
-- REPLACE rule): pct_price_change_long_term_8q, last_ask_cap_long_term_8q.
-- Existing single-quarter columns are preserved unchanged. The trailing window
-- is computed over a contiguous quarter SPINE (so a zero-sale quarter counts as
-- 0 in the window, not a skipped calendar quarter), then joined back so only
-- real quarters are emitted. Additive/reversible. Live immediately.
-- ============================================================================

CREATE OR REPLACE VIEW cm_dialysis_seller_sentiment_q AS
WITH closed_sales AS (
  SELECT s.sale_id, s.property_id, s.sale_date,
         (date_trunc('quarter', s.sale_date::timestamptz) + '3 mons -1 days'::interval)::date AS period_end,
         s.sold_price,
         s.firm_term_years_at_sale AS firm_term_years,
         (SELECT CASE
                   WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price THEN true
                   WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL THEN false
                   ELSE NULL::boolean END
            FROM available_listings al
           WHERE al.sale_transaction_id = s.sale_id
             AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
             AND COALESCE(al.status, ''::varchar)::text !~~* '%supersed%'
           LIMIT 1) AS had_price_change,
         (SELECT al.last_cap_rate
            FROM available_listings al
           WHERE al.sale_transaction_id = s.sale_id
             AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
             AND COALESCE(al.status, ''::varchar)::text !~~* '%supersed%'
           LIMIT 1) AS last_cap_rate
  FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0
    AND NOT COALESCE(s.exclude_from_market_metrics, false)
),
per_q AS (
  SELECT period_end,
         count(*) AS n_all,
         count(*) FILTER (WHERE firm_term_years >= 8) AS n_long_term,
         -- single-quarter numerators/denominators (existing columns)
         count(*) FILTER (WHERE had_price_change IS NOT NULL) AS all_known_denom,
         count(*) FILTER (WHERE had_price_change) AS all_chg_num,
         count(*) FILTER (WHERE had_price_change IS NOT NULL AND firm_term_years >= 8) AS core_known_denom,
         count(*) FILTER (WHERE had_price_change AND firm_term_years >= 8) AS core_chg_num,
         count(last_cap_rate) AS cap_all_cnt,
         sum(last_cap_rate) AS cap_all_sum,
         count(last_cap_rate) FILTER (WHERE firm_term_years >= 8) AS cap_core_cnt,
         sum(last_cap_rate) FILTER (WHERE firm_term_years >= 8) AS cap_core_sum,
         avg(last_cap_rate) AS cap_all_avg,
         avg(last_cap_rate) FILTER (WHERE firm_term_years >= 8) AS cap_core_avg
  FROM closed_sales
  GROUP BY period_end
),
spine AS (
  SELECT (date_trunc('quarter', g.d) + '3 mons -1 days'::interval)::date AS period_end
  FROM generate_series((SELECT date_trunc('quarter', min(period_end))::timestamptz FROM per_q),
                       (SELECT max(period_end)::timestamptz FROM per_q),
                       '3 months'::interval) g(d)
),
joined AS (
  SELECT sp.period_end,
         COALESCE(pq.core_chg_num, 0)   AS core_chg_num,
         COALESCE(pq.core_known_denom, 0) AS core_known_denom,
         COALESCE(pq.cap_core_sum, 0)   AS cap_core_sum,
         COALESCE(pq.cap_core_cnt, 0)   AS cap_core_cnt
  FROM spine sp
  LEFT JOIN per_q pq ON pq.period_end = sp.period_end
),
rolled AS (
  SELECT period_end,
         sum(core_chg_num)     OVER w8 AS chg8,
         sum(core_known_denom) OVER w8 AS denom8,
         sum(cap_core_sum)     OVER w8 AS capsum8,
         sum(cap_core_cnt)     OVER w8 AS capcnt8
  FROM joined
  WINDOW w8 AS (ORDER BY period_end ROWS BETWEEN 7 PRECEDING AND CURRENT ROW)
)
SELECT pq.period_end,
       'all'::text AS subspecialty,
       pq.n_all,
       pq.n_long_term,
       CASE WHEN pq.all_known_denom >= 5
            THEN pq.all_chg_num::numeric / NULLIF(pq.all_known_denom, 0)::numeric END AS pct_price_change_all,
       CASE WHEN pq.core_known_denom >= 5
            THEN pq.core_chg_num::numeric / NULLIF(pq.core_known_denom, 0)::numeric END AS pct_price_change_long_term,
       (CASE WHEN pq.cap_all_cnt  >= 5 THEN pq.cap_all_avg  END)::numeric(8,5) AS last_ask_cap_all,
       (CASE WHEN pq.cap_core_cnt >= 5 THEN pq.cap_core_avg END)::numeric(8,5) AS last_ask_cap_long_term,
       -- B3 trailing-8-quarter core columns (the chart binds to these)
       CASE WHEN r.denom8 >= 5
            THEN r.chg8::numeric / NULLIF(r.denom8, 0)::numeric END AS pct_price_change_long_term_8q,
       (CASE WHEN r.capcnt8 >= 5 THEN r.capsum8 / NULLIF(r.capcnt8, 0) END)::numeric(8,5) AS last_ask_cap_long_term_8q
FROM per_q pq
JOIN rolled r ON r.period_end = pq.period_end
WHERE pq.n_all > 0
ORDER BY pq.period_end;

COMMENT ON VIEW cm_dialysis_seller_sentiment_q IS
  'Seller sentiment (quarterly). *_long_term = single-quarter core (firm_term>=8yr, thin). *_long_term_8q = trailing-8-quarter core (the charted core lines), gated >=5 over the 8q window so a thin cohort still reads. CM feedback item #5 (2026-08).';

-- ----------------------------------------------------------------------------
-- The CHARTED sentiment reads the MONTHLY view (cm_dialysis_seller_sentiment_m),
-- so the trailing-8-quarter (= trailing 24-month) core columns must live there
-- too. Core = firm_term >= 10yr in the monthly view. Same append-only contract:
-- pct_price_change_long_term_8q + last_ask_cap_long_term_8q at the END. NULL
-- only when the 24-month core n < 5. The chart's core series bind to these.
CREATE OR REPLACE VIEW cm_dialysis_seller_sentiment_m AS
WITH month_anchors AS (
  SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
  FROM generate_series('2001-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
),
closed_sales AS (
  SELECT s.sale_id, s.property_id, s.sale_date, s.sold_price, s.firm_term_years_at_sale AS firm_term_years,
         (SELECT CASE WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price THEN true
                      WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL THEN false ELSE NULL::boolean END
            FROM available_listings al WHERE al.sale_transaction_id = s.sale_id AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
              AND COALESCE(al.status, ''::varchar)::text !~~* '%supersed%' LIMIT 1) AS had_price_change,
         (SELECT al.last_cap_rate FROM available_listings al WHERE al.sale_transaction_id = s.sale_id AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
              AND COALESCE(al.status, ''::varchar)::text !~~* '%supersed%' LIMIT 1) AS last_cap_rate
  FROM sales_transactions s WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0 AND NOT COALESCE(s.exclude_from_market_metrics, false)
),
ttm_pairs AS (
  SELECT m.period_end, cs.firm_term_years, cs.had_price_change, cs.last_cap_rate
  FROM month_anchors m LEFT JOIN closed_sales cs ON cs.sale_date > (m.period_end - '1 year'::interval)::date AND cs.sale_date <= m.period_end
),
agg AS (
  SELECT ttm_pairs.period_end,
    count(ttm_pairs.last_cap_rate) AS n_all,
    count(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10) AS n_long_term,
    CASE WHEN count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL) >= 5 THEN count(*) FILTER (WHERE ttm_pairs.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL),0)::numeric END AS pct_pc_all,
    CASE WHEN count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL AND ttm_pairs.firm_term_years >= 10) >= 5 THEN count(*) FILTER (WHERE ttm_pairs.had_price_change AND ttm_pairs.firm_term_years >= 10)::numeric / NULLIF(count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL AND ttm_pairs.firm_term_years >= 10),0)::numeric END AS pct_pc_lt,
    CASE WHEN count(ttm_pairs.last_cap_rate) >= 5 THEN avg(ttm_pairs.last_cap_rate) END AS cap_all_raw,
    CASE WHEN count(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10) >= 5 THEN avg(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10) END AS cap_lt_raw
  FROM ttm_pairs GROUP BY ttm_pairs.period_end
),
ttm24 AS (
  SELECT m.period_end,
    count(*) FILTER (WHERE cs.had_price_change IS NOT NULL AND cs.firm_term_years >= 10) AS core_denom24,
    count(*) FILTER (WHERE cs.had_price_change AND cs.firm_term_years >= 10) AS core_num24,
    count(cs.last_cap_rate) FILTER (WHERE cs.firm_term_years >= 10) AS core_cap_cnt24,
    avg(cs.last_cap_rate) FILTER (WHERE cs.firm_term_years >= 10) AS core_cap_avg24
  FROM month_anchors m LEFT JOIN closed_sales cs ON cs.sale_date > (m.period_end - '2 years'::interval)::date AND cs.sale_date <= m.period_end
  GROUP BY m.period_end
)
SELECT agg.period_end, 'all'::text AS subspecialty, agg.n_all, agg.n_long_term,
    agg.pct_pc_all AS pct_price_change_all,
    agg.pct_pc_lt AS pct_price_change_long_term,
    (avg(agg.cap_all_raw) OVER w)::numeric(8,5) AS last_ask_cap_all,
    (avg(agg.cap_lt_raw) OVER w)::numeric(8,5) AS last_ask_cap_long_term,
    CASE WHEN t24.core_denom24 >= 5 THEN t24.core_num24::numeric / NULLIF(t24.core_denom24,0)::numeric END AS pct_price_change_long_term_8q,
    (CASE WHEN t24.core_cap_cnt24 >= 5 THEN t24.core_cap_avg24 END)::numeric(8,5) AS last_ask_cap_long_term_8q
FROM agg JOIN ttm24 t24 ON t24.period_end = agg.period_end
WINDOW w AS (ORDER BY agg.period_end ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING)
ORDER BY agg.period_end;
