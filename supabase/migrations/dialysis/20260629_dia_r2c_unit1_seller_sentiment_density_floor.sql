-- R2-C Unit 1 (dia) — seller-sentiment cohort density floor 3 -> 5.
--
-- The dia seller-sentiment price-change + last-ask-cap cohorts (the "long_term"
-- 10+ firm-term subset and the "all" cohort) are thin in the recent tail, where
-- a 0/N (N small) renders as a confident hard 0% and a 1-2 sale cap average
-- masquerades as a reading. The monthly view already gated at >= 3; the
-- quarterly view had NO floor at all (0/N -> hard 0). This raises the monthly
-- floor to 5 and adds the same 5-sample floor to the quarterly view, so thin
-- cohorts GAP (NULL) instead of diving to 0. Charts render NULL as a gap.
--
-- Reversible: restore the prior bodies (monthly >= 3 floor; quarterly no floor).

-- Monthly (was >= 3 on all four cohort gates).
CREATE OR REPLACE VIEW public.cm_dialysis_seller_sentiment_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2001-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), closed_sales AS (
         SELECT s.sale_id,
            s.property_id,
            s.sale_date,
            s.sold_price,
            s.firm_term_years_at_sale AS firm_term_years,
            ( SELECT
                        CASE
                            WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price THEN true
                            WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL THEN false
                            ELSE NULL::boolean
                        END AS "case"
                   FROM available_listings al
                  WHERE al.sale_transaction_id = s.sale_id AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text AND COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text
                 LIMIT 1) AS had_price_change,
            ( SELECT al.last_cap_rate
                   FROM available_listings al
                  WHERE al.sale_transaction_id = s.sale_id AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text AND COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text
                 LIMIT 1) AS last_cap_rate
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)
        ), ttm_pairs AS (
         SELECT m.period_end,
            cs.firm_term_years,
            cs.had_price_change,
            cs.last_cap_rate
           FROM month_anchors m
             LEFT JOIN closed_sales cs ON cs.sale_date > (m.period_end - '1 year'::interval)::date AND cs.sale_date <= m.period_end
        ), agg AS (
         SELECT ttm_pairs.period_end,
            count(ttm_pairs.last_cap_rate) AS n_all,
            count(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10::numeric) AS n_long_term,
                CASE
                    WHEN count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL) >= 5 THEN count(*) FILTER (WHERE ttm_pairs.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL), 0)::numeric
                    ELSE NULL::numeric
                END AS pct_pc_all,
                CASE
                    WHEN count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL AND ttm_pairs.firm_term_years >= 10::numeric) >= 5 THEN count(*) FILTER (WHERE ttm_pairs.had_price_change AND ttm_pairs.firm_term_years >= 10::numeric)::numeric / NULLIF(count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL AND ttm_pairs.firm_term_years >= 10::numeric), 0)::numeric
                    ELSE NULL::numeric
                END AS pct_pc_lt,
                CASE
                    WHEN count(ttm_pairs.last_cap_rate) >= 5 THEN avg(ttm_pairs.last_cap_rate)
                    ELSE NULL::numeric
                END AS cap_all_raw,
                CASE
                    WHEN count(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10::numeric) >= 5 THEN avg(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10::numeric)
                    ELSE NULL::numeric
                END AS cap_lt_raw
           FROM ttm_pairs
          GROUP BY ttm_pairs.period_end
        )
 SELECT agg.period_end,
    'all'::text AS subspecialty,
    agg.n_all,
    agg.n_long_term,
    agg.pct_pc_all AS pct_price_change_all,
    agg.pct_pc_lt AS pct_price_change_long_term,
    (avg(agg.cap_all_raw) OVER w)::numeric(8,5) AS last_ask_cap_all,
    (avg(agg.cap_lt_raw) OVER w)::numeric(8,5) AS last_ask_cap_long_term
   FROM agg
  WINDOW w AS (ORDER BY agg.period_end ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING)
  ORDER BY agg.period_end;

-- Quarterly (previously NO density floor; add the same >= 5 gate so 0/N gaps).
CREATE OR REPLACE VIEW public.cm_dialysis_seller_sentiment_q AS
 WITH closed_sales AS (
         SELECT s.sale_id,
            s.property_id,
            s.sale_date,
            (date_trunc('quarter'::text, s.sale_date::timestamp with time zone) + '3 mons -1 days'::interval)::date AS period_end,
            s.sold_price,
            s.firm_term_years_at_sale AS firm_term_years,
            ( SELECT
                        CASE
                            WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price THEN true
                            WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL THEN false
                            ELSE NULL::boolean
                        END AS "case"
                   FROM available_listings al
                  WHERE al.sale_transaction_id = s.sale_id AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text AND COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text
                 LIMIT 1) AS had_price_change,
            ( SELECT al.last_cap_rate
                   FROM available_listings al
                  WHERE al.sale_transaction_id = s.sale_id AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text AND COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text
                 LIMIT 1) AS last_cap_rate
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)
        )
 SELECT closed_sales.period_end,
    'all'::text AS subspecialty,
    count(*) AS n_all,
    count(*) FILTER (WHERE closed_sales.firm_term_years >= 8::numeric) AS n_long_term,
    CASE WHEN count(*) FILTER (WHERE closed_sales.had_price_change IS NOT NULL) >= 5
         THEN count(*) FILTER (WHERE closed_sales.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE closed_sales.had_price_change IS NOT NULL), 0)::numeric
         ELSE NULL::numeric END AS pct_price_change_all,
    CASE WHEN count(*) FILTER (WHERE closed_sales.had_price_change IS NOT NULL AND closed_sales.firm_term_years >= 8::numeric) >= 5
         THEN count(*) FILTER (WHERE closed_sales.had_price_change AND closed_sales.firm_term_years >= 8::numeric)::numeric / NULLIF(count(*) FILTER (WHERE closed_sales.had_price_change IS NOT NULL AND closed_sales.firm_term_years >= 8::numeric), 0)::numeric
         ELSE NULL::numeric END AS pct_price_change_long_term,
    (CASE WHEN count(closed_sales.last_cap_rate) >= 5
         THEN avg(closed_sales.last_cap_rate) ELSE NULL END)::numeric(8,5) AS last_ask_cap_all,
    (CASE WHEN count(closed_sales.last_cap_rate) FILTER (WHERE closed_sales.firm_term_years >= 8::numeric) >= 5
         THEN avg(closed_sales.last_cap_rate) FILTER (WHERE closed_sales.firm_term_years >= 8::numeric) ELSE NULL END)::numeric(8,5) AS last_ask_cap_long_term
   FROM closed_sales
  GROUP BY closed_sales.period_end
 HAVING count(*) > 0
  ORDER BY closed_sales.period_end;
