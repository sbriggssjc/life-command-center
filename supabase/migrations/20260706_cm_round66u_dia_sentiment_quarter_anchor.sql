-- Migration: cm_dialysis_seller_sentiment_m — R66u anchor on completed quarter
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa). Applied to prod 2026-06-02.
--
-- The view anchored month_anchors on CURRENT_DATE, so it extended into the
-- in-progress quarter and, combined with the +/-3-month forward smoothing,
-- the trailing 1-2 quarters of the cap lines could null/wobble as the date
-- advances past the latest sales. Every gov CM view anchors on
-- cm_last_completed_quarter_end() instead. This aligns dia to that convention
-- so the series ends cleanly at the report quarter. Logic otherwise unchanged
-- (still uses firm_term_years_at_sale; n>=3 gates; +/-3 smoothing).

CREATE OR REPLACE VIEW public.cm_dialysis_seller_sentiment_m AS
 WITH month_anchors AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2001-01-01'::date::timestamptz,
                        cm_last_completed_quarter_end()::timestamptz,
                        '1 mon'::interval) g(d)
 ), closed_sales AS (
   SELECT s.sale_id, s.property_id, s.sale_date, s.sold_price,
     s.firm_term_years_at_sale AS firm_term_years,
     ( SELECT CASE
                WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price THEN true
                WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL THEN false
                ELSE NULL::boolean END
       FROM available_listings al WHERE al.sale_transaction_id = s.sale_id LIMIT 1) AS had_price_change,
     ( SELECT al.last_cap_rate FROM available_listings al WHERE al.sale_transaction_id = s.sale_id LIMIT 1) AS last_cap_rate
   FROM sales_transactions s
   WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric
     AND NOT COALESCE(s.exclude_from_market_metrics, false)
 ), ttm_pairs AS (
   SELECT m.period_end, cs.firm_term_years, cs.had_price_change, cs.last_cap_rate
   FROM month_anchors m
   LEFT JOIN closed_sales cs ON cs.sale_date > (m.period_end - '1 year'::interval)::date AND cs.sale_date <= m.period_end
 ), agg AS (
   SELECT ttm_pairs.period_end,
     count(ttm_pairs.last_cap_rate) AS n_all,
     count(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10::numeric) AS n_long_term,
     CASE WHEN count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL) >= 3
          THEN count(*) FILTER (WHERE ttm_pairs.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL), 0)::numeric
          ELSE NULL::numeric END AS pct_pc_all,
     CASE WHEN count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL AND ttm_pairs.firm_term_years >= 10::numeric) >= 3
          THEN count(*) FILTER (WHERE ttm_pairs.had_price_change AND ttm_pairs.firm_term_years >= 10::numeric)::numeric / NULLIF(count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL AND ttm_pairs.firm_term_years >= 10::numeric), 0)::numeric
          ELSE NULL::numeric END AS pct_pc_lt,
     CASE WHEN count(ttm_pairs.last_cap_rate) >= 3 THEN avg(ttm_pairs.last_cap_rate) ELSE NULL::numeric END AS cap_all_raw,
     CASE WHEN count(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10::numeric) >= 3
          THEN avg(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10::numeric) ELSE NULL::numeric END AS cap_lt_raw
   FROM ttm_pairs GROUP BY ttm_pairs.period_end
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
