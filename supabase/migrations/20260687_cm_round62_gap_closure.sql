-- =====================================================================
-- Round 62 — gap closure on user notes 2026-05-22 batch 4 items that
-- R58-R61 missed or only partially addressed.
--
-- A close re-read of the user's batch-4 notes word doc surfaced 5
-- specific items still open after R58→R61 deploy. R62 ships fixes for
-- the ones that have clear direction; documents the rest as
-- waiting-for-verification.
--
-- ---------------------------------------------------------------------
-- 1. MARKET_TURNOVER — switch front bar to monthly clear pace
-- ---------------------------------------------------------------------
-- User direction explicit:
--   "the monthly figures for sales should be the TTM sales count/12
--   so we show the rate at which the current outstanding inventory
--   clears the market monthly (total listings available for sale
--   during that month against the average monthly sold rate for the
--   prior 12 months)."
--
-- R55 wired the front bar to annual_sales_rate (= raw TTM count, ~150
-- dia). R62 reverts that decision: front bar now reads from a
-- monthly_clear_pace helper col (= annual_sales_rate / 12, ~12.5 dia).
-- Helper computed at chart-build time so the data tab keeps both
-- figures available. Y-axis title updated to "Listings / monthly
-- sales rate".
--
-- ---------------------------------------------------------------------
-- 2. ACTIVE_CAP_QUART — band-filtered sample gate
-- ---------------------------------------------------------------------
-- User: "the quartile does not appear to be a statistical calculation
-- that matches the formula in our Excel/PDF as it move almost
-- identically with the median/other datasets."
--
-- Same root cause as R54 Cap_Quartile, just on the active-listings
-- view (cm_dialysis_asking_cap_quartiles_active_m). The HAVING gate
-- was counting non-null cap rates without the band filter — periods
-- where most cap rates were outside the sane 4-12% band passed the
-- HAVING but produced degenerate percentiles from the ≤4 remaining
-- band samples.
--
-- Fix: tighten HAVING to count only band-filtered samples, matching
-- the percentile_cont's own filter.
--
-- Replay:
CREATE OR REPLACE VIEW public.cm_dialysis_asking_cap_quartiles_active_m AS
  SELECT period_end,
         'all'::text AS subspecialty,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
           FILTER (WHERE last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS upper_q_total,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
           FILTER (WHERE last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS lower_q_total,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
           FILTER (WHERE is_core_10plus AND last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS upper_q_core,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY (last_cap_rate::double precision))
           FILTER (WHERE is_core_10plus AND last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) AS lower_q_core
    FROM cm_dialysis_active_listings_m
   GROUP BY period_end
  HAVING count(*) FILTER (WHERE last_cap_rate >= 0.04 AND last_cap_rate <= 0.12) >= 4
   ORDER BY period_end;
-- (No gov mirror — gov doesn't have cm_gov_asking_cap_quartiles_active.)
--
-- ---------------------------------------------------------------------
-- 3. VAL_INDEX — trim to 2013
-- ---------------------------------------------------------------------
-- User: "Data swings wildly in the 2010-12 set, suggesting a lack of
-- real data that skews the entire chart."
--
-- Code-only — add valuation_index: 2013 to MIN_YEAR_BY_TEMPLATE.
-- 2013 is past the noisy small-sample 2010-12 window.
--
-- ---------------------------------------------------------------------
-- 4. YOY_CHANGE — trim to 2005
-- ---------------------------------------------------------------------
-- User: "Big changes in 2002 and 2004 time frame."
--
-- Same R47 false-alarm pattern (2003-2004 had 4-12 sales/yr).
-- Code-only — add yoy_volume_change: 2005 to MIN_YEAR_BY_TEMPLATE.
--
-- ---------------------------------------------------------------------
-- 5. BUYER_POOL_M — quarter labels on monthly cadence chart
-- ---------------------------------------------------------------------
-- User: "Data_Buyer_Pool_M: X-axis quarter labeling issue (showing
-- in months)."
--
-- R58 had treated buyer_pool_monthly_count as monthly cadence (via
-- the monthly_count suffix special case). User wants quarter labels
-- universally. R62 removes the monthly_count special case so this
-- chart gets quarter labels. To avoid "Q1 '24, Q1 '24, Q1 '24..."
-- duplicates on the 3 monthly bars per quarter, formatQuarterLabel
-- now emits a label only on end-of-quarter rows (Mar/Jun/Sep/Dec);
-- other months get an empty label. Excel renders one quarter label
-- per 3 bars.
--
-- ---------------------------------------------------------------------
-- WHAT'S STILL OPEN (waiting for fresh post-R62 export to verify)
-- ---------------------------------------------------------------------
-- • Bid_Ask "doesn't match style" — R50 + R61 schema fix may
--   resolve once recoverable-errors warning is gone. Verify visual
--   in fresh export.
-- • Tenant donuts "missing the chart" — R61 schema fix expected to
--   restore them (Excel was likely stripping during recovery).
-- • NM cap "not smooth like Excel/PDF" — R48 applied 5-mo MA.
--   User still says not smooth enough. Consider widening to 7-mo
--   or 12-mo centered MA if persists.
-- • Avail_Mkt_Size "color scheme doesn't match brand" — needs
--   inspection of the brand standards + the chart's current colors.
-- • Sold_Cap_by_Term / Ask_Cap_by_Term "data missing before 2014" —
--   R47 already trimmed these to 2005. May persist as a visual
--   artifact (sparse 2005-2010 data); could bump trim if user
--   confirms.
--
-- ---------------------------------------------------------------------
-- LOCAL VERIFICATION
-- ---------------------------------------------------------------------
-- 161 CM injector tests pass (was 161 after R61, since R62 also
-- updated 1 existing test); R62 doesn't add a new test but updates
-- the R55 market_turnover test for the monthly-pace helper. Full
-- suite 382/2 (2 unrelated pre-existing).
--
-- ---------------------------------------------------------------------
-- POST-DEPLOY TEST PLAN
-- ---------------------------------------------------------------------
-- 1. Download fresh dia + gov exports
-- 2. Data_Market_Turnover: front bar values ~12-15 (monthly sales
--    rate), NOT ~150 (annual rate). New "Monthly Sales Rate" column
--    in data tab.
-- 3. Data_Active_Cap_Quart: bands visibly asymmetric (Q3-Med ≠
--    Med-Q1 across periods); early-period NULL rows where samples
--    were too thin in the 4-12% band.
-- 4. Data_Val_Index: chart x-axis starts at 1Q-2013, no more wild
--    2010-12 swings.
-- 5. Data_YOY_Change: chart x-axis starts at 1Q-2005, no more
--    2002/2004 spikes.
-- 6. Data_Buyer_Pool_M: x-axis shows quarter labels ("Q1 '24") on
--    every 3rd bar instead of monthly labels on every bar.
-- 7. All other charts unchanged.
-- =====================================================================
