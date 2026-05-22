-- =====================================================================
-- Round 55 — Market_Turnover full restructure per user direction.
-- User notes 2026-05-22 batch 3:
--   "I think we show a total number of listings on the market on a
--   bar, the annualized rate at which sales are occurring monthly on
--   another bar in front of the inventory bar, and then the line is
--   the number of months that it would take to sell all of the
--   inventory available during that month at the current rate we are
--   seeing transactions occur. Let's make sure that the axises are
--   labeled too so we can easily see what is happening in the chart."
--
-- R50 had this as a single-bar + single-line chart (monthly clear pace
-- bars + turnover rate line). R55 makes it the 3-series visualization
-- the user asked for.
--
-- ---------------------------------------------------------------------
-- SHAPE CHANGES
-- ---------------------------------------------------------------------
-- Both verticals' turnover views (cm_dialysis_market_turnover_m and
-- cm_gov_market_turnover_m) extended with 3 new columns:
--   • active_count       — total listings on market (back bar)
--   • annual_sales_rate  — TTM sales count (front bar)
--   • months_of_supply   — active_count * 12 / ttm_sales (line)
--
-- The R50 columns (ttm_sales_count, market_universe, turnover_rate) are
-- preserved for backward compat with any downstream consumer that's
-- still reading them.
--
-- The chart spec at api/_shared/cm-native-chart-injector.js
-- case 'market_turnover' now emits a 3-series combo:
--   Bar (back, pale sky #E0E8F4 with sky border) — Active Listings
--   Bar (front, navy)                            — Annual Sales Rate
--   Line (gray)                                  — Months of Supply
--
-- The bars use barOverlap=100 so the front sales bar sits IN FRONT of
-- the back inventory bar at the same x-tick (matches user direction
-- "in front of the inventory bar"). Dual axis:
--   Left  — integer count (listings + sales)
--   Right — months (1-decimal "X.X mo")
-- Both axes labeled via buildComboChartXml's new yLeftAxisTitle /
-- yRightAxisTitle parameters.
--
-- ---------------------------------------------------------------------
-- BACKWARD COMPATIBILITY
-- ---------------------------------------------------------------------
-- If a vertical's view hasn't been extended with the new columns yet
-- (rolling deploy / legacy catalogs), the chart spec falls back to the
-- R50 shape (monthly clear pace bar + turnover rate line) so the
-- chart still renders. No silent breakage.
--
-- ---------------------------------------------------------------------
-- INFRA: combo builder additions
-- ---------------------------------------------------------------------
-- buildComboChartXml in cm-native-chart-injector.js gained 3 new spec
-- knobs:
--   • spec.barOverlap     — explicit override (defaults: stacked=100,
--                            clustered=-20). Set to 100 to place a
--                            front bar in front of a back bar.
--   • spec.yLeftAxisTitle  — rotated text on the left value axis.
--   • spec.yRightAxisTitle — rotated text on the right value axis.
--
-- Backward compatible — existing combo specs that don't set these
-- behave exactly as before.
--
-- ---------------------------------------------------------------------
-- REPLAY (dia)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_market_turnover_m AS
 WITH months AS (
   SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2014-01-01'::date::timestamp with time zone,
                        cm_last_completed_quarter_end()::timestamp with time zone,
                        '1 mon'::interval) g(d)
 ), base AS (
   SELECT m.period_end,
     ( SELECT count(*) FROM sales_transactions s
       WHERE s.sale_date > (m.period_end - '1 year'::interval)::date
         AND s.sale_date <= m.period_end
         AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric
         AND NOT COALESCE(s.exclude_from_market_metrics, false)
     ) AS ttm_sales,
     ( SELECT count(*) FROM available_listings al
       WHERE al.listing_date IS NOT NULL
         AND al.listing_date <= m.period_end
         AND (al.sold_date IS NULL OR al.sold_date > m.period_end)
         AND (al.off_market_date IS NULL OR al.off_market_date > m.period_end)
     ) AS active_count
   FROM months m
 )
 SELECT base.period_end,
        'all'::text AS subspecialty,
        base.ttm_sales AS ttm_sales_count,
        base.active_count + base.ttm_sales AS market_universe,
        base.ttm_sales::numeric / NULLIF(base.active_count + base.ttm_sales, 0)::numeric AS turnover_rate,
        base.active_count,
        base.ttm_sales AS annual_sales_rate,
        CASE WHEN base.ttm_sales > 0
             THEN base.active_count::numeric * 12::numeric / base.ttm_sales::numeric
             ELSE NULL::numeric
        END AS months_of_supply
   FROM base
  ORDER BY base.period_end;
-- Gov mirror SQL: supabase/migrations/government/<TODO>_cm_round55_gov_turnover.sql
--
-- ---------------------------------------------------------------------
-- VERIFICATION
-- ---------------------------------------------------------------------
-- 149 CM injector tests pass (was 146 after R54). 3 new R55 tests:
--   • market_turnover with R55 view cols renders 2-bar+1-line combo
--   • market_turnover falls back to R50 shape when R55 cols missing
--   • buildComboChartXml emits axis titles + barOverlap
-- Full suite 370/2 (2 unrelated pre-existing).
--
-- Sample dia data (2026-03-31): active=516, annual_sales=153,
-- months_of_supply=40.5 — chart axes will reflect those magnitudes.
--
-- ---------------------------------------------------------------------
-- POST-DEPLOY TEST PLAN
-- ---------------------------------------------------------------------
-- 1. Download fresh dia + gov exports
-- 2. Open Data_Market_Turnover — should now show:
--    • Pale sky back bar (active inventory ~500 dialysis, varies gov)
--    • Navy front bar (annual sales rate ~150 dialysis)
--    • Gray line on right axis (months of supply ~40 mo dialysis)
--    • Left axis labeled "Listings / annual sales (count)"
--    • Right axis labeled "Months of supply"
-- 3. Data tab gains 3 new columns: Active Listings, Annual Sales Rate,
--    Months of Supply
--
-- ---------------------------------------------------------------------
-- WHAT'S NEXT
-- ---------------------------------------------------------------------
-- R56: Core_Cap_Dot point-in-time lease_end correction
--      + Avail_Cap_Dot title "Firm Term" → "Lease Term" for dia
--      + Pace_Cap_Expand YOY pace line
-- R57: Legend/data-label correctness pass for Cap_Avg, Returns_Idx,
--      Cost_Capital "4.73% in legend" complaints
-- =====================================================================
