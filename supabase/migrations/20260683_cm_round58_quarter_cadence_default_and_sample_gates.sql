-- =====================================================================
-- Round 58 — universal axis-label regression + R54-style sample gates
-- for Cap_Avg / Returns_Idx / Cost_Capital.
-- User notes 2026-05-22 batch 4 (post-R57 deploy).
--
-- ---------------------------------------------------------------------
-- BUG #1 — "Date x-axis and not quarters" universally
-- ---------------------------------------------------------------------
-- User flagged across nearly every chart: "Date x-axis and not quarters"
-- / "labeled in months now and we want quarters" / "month naming instead
-- of quarters".
--
-- Direct inspection of the fresh export found the period_label helper
-- col IS being written, but with MONTHLY labels ("Jan '07", "Feb '07"
-- ...) instead of quarter labels.
--
-- Root cause: R53's `detectMonthlyCadence` used row-spacing as the
-- heuristic. Most underlying views are monthly (_m views with ~30-day
-- row gaps), so the heuristic always fired as "monthly" — even for
-- charts the user expects to display QUARTER labels.
--
-- The chart-template-id naming convention already distinguishes monthly
-- variants explicitly (bid_ask_spread_monthly, dom_and_pct_of_ask_monthly,
-- seller_sentiment_monthly, buyer_pool_monthly_count). R58 inverts the
-- detection logic to use that naming instead:
--   • _monthly$ suffix → monthly labels ("Mar '24")
--   • monthly_count$ suffix → monthly labels (buyer_pool_monthly_count)
--   • Everything else → quarter labels ("Q1 '24")
--
-- Code-only fix in api/_shared/cm-native-chart-injector.js
-- detectMonthlyCadence() + the wrapper call that passes
-- args.chart_template_id instead of args.rows.
--
-- ---------------------------------------------------------------------
-- BUG #2 — Cap_Avg / Returns_Idx / Cost_Capital still show "4.73%"
-- ---------------------------------------------------------------------
-- R54 added a sample-count gate to cm_dialysis_cap_quartile_m only.
-- The same degenerate single-sample issue affects three other views
-- that read avg_cap_rate_ttm from the same master_m view:
--   • cm_dialysis_cap_ttm_m (Data_Cap_Avg)
--   • cm_dialysis_cost_of_capital_m (Data_Cost_Capital)
--   • cm_dialysis_returns_indexes_m (Data_Returns_Idx)
-- For 2005-Jan-Apr each has only 1 cap-rate sample in the 4-12% sane
-- band → avg = that single 4.73% value → flagged correctly as
-- implausibly low.
--
-- Fix: replicate R54's LATERAL band-filtered count + n>=4 gate on
-- avg_cap_rate_ttm / cap_10plus_year. Same pattern, same dial.
-- Applied to both verticals (dia + gov).
--
-- Replay (dia cap_ttm_m):
CREATE OR REPLACE VIEW public.cm_dialysis_cap_ttm_m AS
  SELECT m.period_end, m.subspecialty,
         CASE WHEN band_n.n >= 4 THEN m.avg_cap_rate_ttm
              ELSE NULL::numeric END AS ttm_weighted_cap_rate
    FROM cm_dialysis_market_quarterly_master_m m
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM sales_transactions s
       WHERE s.sale_date IS NOT NULL
         AND s.sale_date > (m.period_end - INTERVAL '1 year')::date
         AND s.sale_date <= m.period_end
         AND COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate) >= 0.04
         AND COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate) <= 0.12
         AND NOT COALESCE(s.exclude_from_market_metrics, false)
         AND (s.transaction_type IS NULL OR s.transaction_type = ANY (ARRAY['Investment','Resale']))
    ) band_n ON true;
-- (cost_of_capital_m and returns_indexes_m get the same wrap — see
-- the deployed migration; both verticals; gov view sources from
-- cm_gov_market_quarterly_master_m_mat instead of master_m.)
--
-- ---------------------------------------------------------------------
-- WHAT'S DEFERRED TO R59+
-- ---------------------------------------------------------------------
-- Other items from this batch 4 not addressed in R58:
--   • Recoverable-errors warning when opening Excel — XML diagnostic
--     didn't surface obvious malformation; deeper investigation needed
--   • Volume_TTM Aug-Sept 2024 cliff ($1.5B → $400M) — investigate
--     whether single-deal TTM rolloff or a formula issue
--   • Volume_Quarterly Jul 2023 spike — possible duplicate data
--   • Cap_Quartile bands still look symmetric visually — y-axis
--     tightening or chart-type change needed (data IS asymmetric per
--     R54 verification)
--   • Inventory_Backlog legend label/color mismatch + chart title text
--   • Pace_Cap_Expand x-axis position (push below 0 to show neg bars)
--   • Tenant donuts "missing" — re-verify in post-R58 export
--   • Avail_by_Term_Summary callouts + tighter cap axis
--   • Bid_Ask 2015-2016 jump — data quality investigation
--   • Avg_Deal_Size Jun 2006 spike — data quality investigation
--
-- ---------------------------------------------------------------------
-- LOCAL VERIFICATION
-- ---------------------------------------------------------------------
-- 157 CM injector tests pass (was 154 after R57); 3 new R58 tests:
--   • R58: quarterly chart with monthly underlying view emits Q-labels
--   • R58: explicitly-monthly template still emits Month labels
--   • R58: buyer_pool_monthly_count edge case
-- Full suite 378/2 (2 unrelated pre-existing).
--
-- ---------------------------------------------------------------------
-- POST-DEPLOY TEST PLAN
-- ---------------------------------------------------------------------
-- 1. Download fresh dia + gov exports
-- 2. Every chart x-axis with date data reads "Q1 '24" / "Q2 '24"
--    NOT "Jan '07" / "Feb '07"
-- 3. The 4 explicitly-monthly tabs keep month labels:
--    Data_Bid_Ask_Monthly, Data_DOM_Ask_Monthly,
--    Data_Sentiment_Monthly, Data_Buyer_Pool_M
-- 4. Data_Cap_Avg / Data_Returns_Idx / Data_Cost_Capital — early
--    2005 rows blank in the chart and Data tab (NULL gate);
--    chart x-axis starts at first dense year (2007 per R47).
-- =====================================================================
