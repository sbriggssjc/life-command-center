-- =====================================================================
-- Round 54 — Cap_Quartile sample-size gate + Inventory_Backlog
-- Sold-below-zero restructure. From user notes 2026-05-22 batch 3.
--
-- ---------------------------------------------------------------------
-- 1. CAP_QUARTILE — re-verify R48's "real percentile" conclusion
-- ---------------------------------------------------------------------
-- User said: "data labels in the legend...are all the same number —
-- honestly a number that doesn't make sense for the time period; cap
-- rates in 2005 were no where near a 4.73% cap rate even on the lower
-- quartile" and "the bands move in perfect proportion to the median".
--
-- R48 verified the SQL uses real percentile_cont(0.25/0.50/0.75) and
-- concluded the IQR was just narrow — but missed that early-period
-- TTM windows contain only 0-3 cap-rate samples in the 4-12% sane band.
-- With n=1 the percentile output degenerates: Q1=Med=Q3=that single
-- 4.73% value. That's exactly what the user was seeing in 2005.
--
-- Per-month band-filtered sample counts:
--   2005-01 to 2005-12: 0-1 sample → all quartiles degenerate to one number
--   2006-01 to 2006-06: 1-3 samples → still ill-defined
--   2006-07 onward:     4+ samples → quartiles become statistically meaningful
--
-- Fix: wrap cm_dialysis_cap_quartile_m + cm_gov_cap_quartile_m to NULL
-- out Q1/Med/Q3 when fewer than 4 cap-rate samples exist in the TTM
-- window's 4-12% band. LATERAL subquery counts from sales_transactions
-- because master_m doesn't expose the band-filtered count as a column.
-- Also bump MIN_YEAR_BY_TEMPLATE['cap_rate_top_bottom_quartile'] from
-- 2005 to 2007 so the visible chart starts where data is dense.
--
-- Replay (dia):
CREATE OR REPLACE VIEW public.cm_dialysis_cap_quartile_m AS
  SELECT m.period_end,
         m.subspecialty,
         CASE WHEN band_n.n >= 4 THEN m.upper_quartile_cap_ttm
              ELSE NULL::numeric END AS top_quartile,
         CASE WHEN band_n.n >= 4 THEN m.lower_quartile_cap_ttm
              ELSE NULL::numeric END AS bottom_quartile,
         CASE WHEN band_n.n >= 4 THEN m.median_quartile_cap_ttm
              ELSE NULL::numeric END AS median
    FROM cm_dialysis_market_quarterly_master_m m
    LEFT JOIN LATERAL (
      SELECT count(*) AS n
        FROM sales_transactions s
       WHERE s.sale_date IS NOT NULL
         AND s.sale_date > (m.period_end - INTERVAL '1 year')::date
         AND s.sale_date <= m.period_end
         AND COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate) >= 0.04
         AND COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate) <= 0.12
         AND NOT COALESCE(s.exclude_from_market_metrics, false)
         AND (s.transaction_type IS NULL OR s.transaction_type = ANY (ARRAY['Investment','Resale']))
    ) band_n ON true;
-- Gov DDL applied to the government Supabase project; mirror SQL in
-- supabase/migrations/government/<TODO>_cm_round54_gov_cap_quartile_gate.sql.
--
-- ---------------------------------------------------------------------
-- 2. INVENTORY_BACKLOG — Sold renders below zero
-- ---------------------------------------------------------------------
-- User direction: "The No Sold category should be counting as a number
-- removed from the market and go below the 0 on the same plane as the
-- count for those added so that we can visualize the movement in the
-- market better."
--
-- R50 made Added + Sold both positive on a clustered bar with a Net
-- line overlay. R54 swaps the Sold bar to read from a NEW `sold_neg`
-- helper column (= -sold_ttm) so the bar renders below zero. Data tab
-- still has the original positive sold_ttm column for users reading
-- numbers; only the chart renders the negated value.
--
-- Code-only change in api/_shared/cm-native-chart-injector.js
-- inventory_backlog case. helperCols = [net_ttm, sold_neg]; the Sold
-- bar's valCol points at sold_neg's letter (auto-shifted by the R53
-- period_label wrapper when present).
--
-- ---------------------------------------------------------------------
-- 3. TENANT DONUT EMPTY — deferred to post-R53 verification
-- ---------------------------------------------------------------------
-- User reported "Data_Avail_Tenant_Count: Missing the chart" and same
-- for Vol donut. Direct inspection of the fresh 2026-05-22 export
-- shows the donut chart XML IS present AND the 4 tenant rows ARE
-- populated correctly in the data tab. Most likely the visible
-- "missing chart" was an Excel-recovery side-effect of the qQ-yyyy
-- corruption from R53 (the file opened with recoverable-errors
-- warnings; Excel may have stripped some charts during recovery).
-- R54 doesn't ship a donut fix; will re-check after R53 deploys
-- and the recoverable-errors warning is gone.
--
-- ---------------------------------------------------------------------
-- LOCAL VERIFICATION
-- ---------------------------------------------------------------------
-- 146 CM injector tests pass. The R50 inventory_backlog test was
-- updated to assert the new sold_neg helper col and the Sold bar's
-- shifted valCol; the R53 wrapper test was updated for the 3-helper
-- arrangement (period_label + net_ttm + sold_neg) and the I-column
-- Sold position. Full suite 367 pass / 2 unrelated pre-existing.
--
-- ---------------------------------------------------------------------
-- POST-DEPLOY VERIFICATION
-- ---------------------------------------------------------------------
-- 1. Download fresh dia + gov exports
-- 2. Open Data_Cap_Quartile — early 2005 rows show empty quartile cells
--    in the data tab; the chart x-axis starts at 1Q-2007; the visible
--    chart shows real asymmetric IQR (Q3-Med ≠ Med-Q1 across periods)
-- 3. Open Data_Inventory_Backlog — Added bars go UP from 0, Sold bars
--    go DOWN from 0 (negative), gray Net line tracks above/below 0;
--    new "No. Sold (chart)" helper column visible in data tab
-- 4. Open Data_Avail_Tenant_CountD / Data_Avail_Tenant_VolD — chart
--    should render (qQ-yyyy corruption gone after R53)
--
-- ---------------------------------------------------------------------
-- WHAT'S NEXT
-- ---------------------------------------------------------------------
-- R55: Market_Turnover restructure (3 series — total listings bar +
--      monthly clear pace bar in front + months-of-supply line) and
--      labeled axes
-- R56: Core_Cap_Dot point-in-time lease_end correction
--      + Avail_Cap_Dot title "Firm Term" → "Lease Term" for dia
--      + Pace_Cap_Expand YOY pace line
-- R57: Legend/data-label correctness pass (the "4.73% in legend"
--      complaints on Cap_Avg / Returns_Idx / Cost_Capital are likely
--      R37 P3 annotations that the user is conflating with the legend;
--      audit and rewire)
-- =====================================================================
