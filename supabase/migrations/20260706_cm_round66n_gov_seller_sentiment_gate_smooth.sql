-- Migration: cm_gov_seller_sentiment_m — R66n gate + smooth the cap lines
-- Project: government (scknotsqkcheojiaewwh). Applied to prod 2026-06-02.
--
-- CHART: "Supply Side: Seller Sentiment & Confidence" (tab Data_Sentiment).
--   Left axis cap-rate lines: Last Ask Cap (all) navy / Last Ask Cap (10+ yr)
--   light-blue. Right axis bars: Price Chg % (all) green / (10+ yr) purple.
--
-- WHAT THIS FIXES (the "missing data from several periods" complaint, partially):
--   The "Last Ask Cap (10+ yr)" line was an UNGATED average over a very thin
--   long-term cohort (n_long_term = 0-9/qtr, dropping to 0-1 in 2025-26), so it
--   showed noisy 1-2-sale points and gapped erratically. This adds an n>=3 gate
--   on the long-term cap line (blank honestly where too thin) and a +/-2-month
--   centered smoothing on BOTH cap lines so they read cleanly.
--
-- WHAT THIS DOES NOT FIX (genuine data-capture gap — flagged for a data prompt):
--   The Price Chg % bars are driven by had_price_change, which is populated for
--   only ~1-2% of gov sales (0-5 TRUE per YEAR out of 200-360), and the
--   alternative listing signals (pct_of_initial, bid_ask_spread) cover only
--   ~5-10% of sales — all concentrated in the NM-brokered / CoStar-captured
--   subset, essentially absent before ~2018. The bars therefore read near-zero
--   pre-2018 and get thin-denominator-noisy in the low-volume recent quarters.
--   Filling them in requires capturing listing price-change / initial-ask
--   history for the broader sale universe; it cannot be synthesized in a view.
--   The 10+ cohort is likewise genuinely sparse (the gov market has few
--   long-remaining-term sales recently), independent of the term resolver.
--
-- Column names/order/types preserved so CREATE OR REPLACE is non-breaking.

CREATE OR REPLACE VIEW public.cm_gov_seller_sentiment_m AS
 WITH month_anchors AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2001-01-01'::date::timestamptz,
                        cm_last_completed_quarter_end()::timestamptz,
                        '1 mon'::interval) g(d)
 ), closed_sales AS (
   SELECT s.sale_id,
     s.sale_date,
     s.last_cap_rate,
     s.had_price_change,
     ( SELECT l.firm_term_years
         FROM leases l
        WHERE l.property_id = s.property_id
          AND l.expiration_date >= s.sale_date
          AND (l.commencement_date IS NULL OR l.commencement_date <= s.sale_date)
        ORDER BY l.expiration_date DESC
        LIMIT 1) AS firm_term_years
   FROM sales_transactions s
   WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric
 ), ttm_pairs AS (
   SELECT m.period_end, cs.sale_id, cs.last_cap_rate, cs.had_price_change, cs.firm_term_years
   FROM month_anchors m
   LEFT JOIN closed_sales cs ON cs.sale_date > (m.period_end - '1 year'::interval)::date
                            AND cs.sale_date <= m.period_end
 ), agg AS (
   SELECT period_end,
     count(last_cap_rate) AS n_all,
     count(last_cap_rate) FILTER (WHERE firm_term_years >= 8::numeric) AS n_long_term,
     count(*) FILTER (WHERE had_price_change)::numeric / NULLIF(count(sale_id), 0)::numeric AS pct_price_change_all,
     count(*) FILTER (WHERE had_price_change AND firm_term_years >= 8::numeric)::numeric
       / NULLIF(count(sale_id) FILTER (WHERE firm_term_years >= 8::numeric), 0)::numeric AS pct_price_change_long_term,
     avg(last_cap_rate) FILTER (WHERE last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS cap_all_raw,
     avg(last_cap_rate) FILTER (WHERE last_cap_rate >= 0.04 AND last_cap_rate <= 0.12 AND firm_term_years >= 8::numeric) AS cap_lt_raw
   FROM ttm_pairs
   GROUP BY period_end
 ), gated AS (
   SELECT period_end, n_all, n_long_term, pct_price_change_all, pct_price_change_long_term,
     CASE WHEN n_all      >= 3 THEN cap_all_raw END AS cap_all_g,
     CASE WHEN n_long_term >= 3 THEN cap_lt_raw  END AS cap_lt_g
   FROM agg
 )
 SELECT period_end,
   'all'::text AS subspecialty,
   n_all,
   n_long_term,
   pct_price_change_all,
   pct_price_change_long_term,
   (avg(cap_all_g) OVER w)::numeric(8,5) AS last_ask_cap_all,
   (avg(cap_lt_g)  OVER w)::numeric(8,5) AS last_ask_cap_long_term
 FROM gated
 WINDOW w AS (ORDER BY period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING)
 ORDER BY period_end;
