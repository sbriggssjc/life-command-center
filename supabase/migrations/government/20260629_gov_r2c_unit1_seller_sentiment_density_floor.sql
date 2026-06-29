-- R2-C Unit 1 (gov) — seller-sentiment cohort density floor 3 -> 5.
--
-- Grounded live 2026-06-29 (gov scknotsqkcheojiaewwh): the long-term (6+ firm
-- term) and "all" price-change cohorts dive to a hard 0.0000 in the thin recent
-- tail — e.g. 2026-03 shows pct_price_change_all = pct_price_change_long_term =
-- 0.0000 at n_long_term = 1, and 2025-02 a mid-series 0/15 — because the >= 3
-- floor lets a 0/3+ render as a confident zero. Raising the floor to 5 gaps the
-- single-/few-sale tail (NULL) while keeping well-sampled readings. The
-- last-ask-cap cohorts (smoothed averages) do not hit zero; their floor is
-- raised in step so a 1-2 sale average doesn't masquerade as a reading.
--
-- cm_gov_seller_sentiment_q derives directly from this view (a month-3/6/9/12
-- filter), so it inherits the fix; no separate quarterly change is needed.
--
-- The inner sales pull is written as SELECT * over the same predicate the live
-- view used (comp_scope <> 'market_offuniverse' AND exclude_from_market_metrics
-- IS NOT TRUE) — the view's output columns are defined by the final SELECT.
--
-- Reversible: restore the >= 3 gates.

CREATE OR REPLACE VIEW public.cm_gov_seller_sentiment_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2001-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), closed_sales AS (
         SELECT s.sale_id,
            s.sale_date,
            s.last_cap_rate,
            s.had_price_change,
            COALESCE(s.firm_term_years_at_sale, ( SELECT l.firm_term_years
                   FROM leases l
                  WHERE l.property_id = s.property_id AND l.expiration_date >= s.sale_date AND (l.commencement_date IS NULL OR l.commencement_date <= s.sale_date)
                  ORDER BY l.expiration_date DESC
                 LIMIT 1)) AS firm_term_years
           FROM ( SELECT *
                   FROM sales_transactions
                  WHERE comp_scope IS DISTINCT FROM 'market_offuniverse'::text AND exclude_from_market_metrics IS NOT TRUE) s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric
        ), ttm_pairs AS (
         SELECT m.period_end,
            cs.sale_id,
            cs.last_cap_rate,
            cs.had_price_change,
            cs.firm_term_years
           FROM month_anchors m
             LEFT JOIN closed_sales cs ON cs.sale_date > (m.period_end - '1 year'::interval)::date AND cs.sale_date <= m.period_end
        ), agg AS (
         SELECT ttm_pairs.period_end,
            count(ttm_pairs.last_cap_rate) AS n_all,
            count(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 6::numeric) AS n_long_term,
            count(ttm_pairs.sale_id) AS cnt_all,
            count(ttm_pairs.sale_id) FILTER (WHERE ttm_pairs.firm_term_years >= 6::numeric) AS cnt_lt,
            count(*) FILTER (WHERE ttm_pairs.had_price_change)::numeric / NULLIF(count(ttm_pairs.sale_id), 0)::numeric AS pct_pc_all_raw,
            count(*) FILTER (WHERE ttm_pairs.had_price_change AND ttm_pairs.firm_term_years >= 6::numeric)::numeric / NULLIF(count(ttm_pairs.sale_id) FILTER (WHERE ttm_pairs.firm_term_years >= 6::numeric), 0)::numeric AS pct_pc_lt_raw,
            avg(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.last_cap_rate >= 0.04 AND ttm_pairs.last_cap_rate <= 0.12) AS cap_all_raw,
            avg(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.last_cap_rate >= 0.04 AND ttm_pairs.last_cap_rate <= 0.12 AND ttm_pairs.firm_term_years >= 6::numeric) AS cap_lt_raw
           FROM ttm_pairs
          GROUP BY ttm_pairs.period_end
        ), gated AS (
         SELECT agg.period_end,
            agg.n_all,
            agg.n_long_term,
                CASE
                    WHEN agg.cnt_all >= 5 THEN agg.pct_pc_all_raw
                    ELSE NULL::numeric
                END AS pct_price_change_all,
                CASE
                    WHEN agg.cnt_lt >= 5 THEN agg.pct_pc_lt_raw
                    ELSE NULL::numeric
                END AS pct_price_change_long_term,
                CASE
                    WHEN agg.n_all >= 5 THEN agg.cap_all_raw
                    ELSE NULL::numeric
                END AS cap_all_g,
                CASE
                    WHEN agg.n_long_term >= 5 THEN agg.cap_lt_raw
                    ELSE NULL::numeric
                END AS cap_lt_g
           FROM agg
        )
 SELECT period_end,
    'all'::text AS subspecialty,
    n_all,
    n_long_term,
    pct_price_change_all,
    pct_price_change_long_term,
    (avg(cap_all_g) OVER w)::numeric(8,5) AS last_ask_cap_all,
    (avg(cap_lt_g) OVER w)::numeric(8,5) AS last_ask_cap_long_term
   FROM gated
  WINDOW w AS (ORDER BY period_end ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING)
  ORDER BY period_end;
