-- =====================================================================
-- Round 64 — pick up R63's deferred items that don't need user input.
--
-- ---------------------------------------------------------------------
-- 1. VOLUME_TTM peak/trough/last labels + $X.XXB y-axis format
-- ---------------------------------------------------------------------
-- User notes 2026-05-22 batch 5:
--   "Data_Volume_TTM: Missing high, low and most recent data labels"
--   "Let's adjust the y-axis label formats to show $1.80B or similar"
--
-- Root cause #1: the volume_ttm_by_quarter case in
-- cm-native-chart-injector.js never set annotateKey / annotateFmt,
-- so R37 P3 peak/trough/last annotations never fired on this template.
--
-- Root cause #2: y-axis used VAL_FMT_CURRENCY ($#,##0) which renders
-- ~$1.5B as "$1,500,000,000" — long and hard to read.
--
-- Fix: add annotateKey='volume_dollars' + annotateFmt='currency_b'.
-- New format VAL_FMT_CURRENCY_B = '$#,##0.00,,,"B"_);[Red]($#,##0.00,,,"B")'
-- renders billions with 2 decimals. New formatter fmtCurrencyBNative
-- mirrors that for annotation bubbles.
--
-- ---------------------------------------------------------------------
-- 2. AVG_DEAL_SIZE y-axis $7.0M format
-- ---------------------------------------------------------------------
-- User: "Let's adjust the y-axis labels so that they are formatted in
-- the same $7.0M style in the labels."
--
-- Old: VAL_FMT_CURRENCY ($#,##0). New: VAL_FMT_CURRENCY_M_1DP
-- ($#,##0.0,,"M") renders "$7.0M". Annotation formatter already used
-- currency_m; only the y-axis numFmt changes.
--
-- ---------------------------------------------------------------------
-- 3. AVAIL_BY_TERM_SUMMARY left-axis $X.XM format
-- ---------------------------------------------------------------------
-- User: "lets adjust the number formatting of the x-axis to show $x.xM"
--
-- (User said "x-axis" but the price axis is actually the LEFT VALUE
-- axis — the cat axis is term-bucket text. yLeftNumFmt: VAL_FMT_CURRENCY
-- → VAL_FMT_CURRENCY_M_1DP. Avg Price for dia chairs is $1.5-5M;
-- single-decimal millions is the right granularity.)
--
-- ---------------------------------------------------------------------
-- 4. NM_VS_MARKET — widen smoothing from 5-mo to 9-mo
-- ---------------------------------------------------------------------
-- User notes batch 5 (3rd time complaining): "NM cap rate does not
-- match the smoothness of the line that is in our Excel/PDF versions
-- suggesting a data issue."
--
-- R48 introduced a 5-mo centered MA on the NM line because the small
-- TTM sample (8-30 NM sales per window) caused 30-50 bps swings on
-- single-sale entry/exit. 5-mo wasn't enough. R64 widens to 9-mo
-- (ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING) to match the cycle-level
-- smoothness the user expects.
--
-- Trade-off: ~4-month lag on detecting real market inflections
-- (vs R48's ~2-month). User confirmed in R49 that smoothness > recency
-- for this chart context.
--
-- Replay (dia):
CREATE OR REPLACE VIEW public.cm_dialysis_nm_vs_market_m AS
  SELECT period_end, subspecialty,
         avg(nm_avg_cap_ttm) OVER w AS nm_cap_rate,
         non_nm_avg_cap_ttm AS market_cap_rate
    FROM cm_dialysis_market_quarterly_master_m
   WINDOW w AS (PARTITION BY subspecialty
                  ORDER BY period_end
                  ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING);
-- (Gov mirror applied to gov project — same pattern.)
--
-- ---------------------------------------------------------------------
-- 5. SOLD_CAP_BY_TERM — widen smoothing from 5-mo to 9-mo
-- ---------------------------------------------------------------------
-- User notes batch 5 (4th time complaining): "Chart lines are all over
-- the place suggesting a data issue, the charts in our Excel/PDF
-- versions do not move this erratically."
--
-- R48 used 5-mo. 2024 dia cohort samples are tiny (10-30 per TTM
-- after the year-over-year volume drop), so 5-mo wasn't enough.
-- Widen to 9-mo for smoother cycle-level trends.
--
-- Replay (dia):
CREATE OR REPLACE VIEW public.cm_dialysis_sold_cap_by_term_dot AS
 WITH base AS (
   SELECT period_end, subspecialty,
          cap_12plus_year AS cap_12plus,
          cap_8to12_year  AS cap_8to12,
          cap_6to8_year   AS cap_6to8,
          cap_5orless_year AS cap_5orless
     FROM cm_dialysis_market_quarterly_master_m
 )
 SELECT period_end, subspecialty,
        avg(cap_12plus)  OVER w AS cap_12plus,
        avg(cap_8to12)   OVER w AS cap_8to12,
        avg(cap_6to8)    OVER w AS cap_6to8,
        avg(cap_5orless) OVER w AS cap_5orless
   FROM base
  WINDOW w AS (PARTITION BY subspecialty
                 ORDER BY period_end
                 ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING);
--
-- ---------------------------------------------------------------------
-- STILL DEFERRED (need user input)
-- ---------------------------------------------------------------------
-- • Market_Turnover active_listings semantic — current view returns
--   ~514 (snapshot of all active listings); user says "should be ~120
--   matching inventory analysis". Need definition: listings in past
--   N months? Listings with active marketing only?
-- • Tenant donuts "missing" — data + chart XML are confirmed present.
--   R61+R63 schema fixes should have resolved Excel recovery
--   stripping. Verify in fresh post-R64 export.
-- • Inventory_Backlog legend label/color mismatch — my inspection
--   shows correct labels + colors. Screenshot from user would help
--   diagnose what doesn't match.
-- • Avail_Mkt_Size brand color check — defer to dedicated brand pass
--   if user re-flags.
--
-- ---------------------------------------------------------------------
-- LOCAL VERIFICATION
-- ---------------------------------------------------------------------
-- 161 CM injector tests pass. R38 test updated for new B-format on
-- volume_ttm_by_quarter. Full suite 382/2 (2 unrelated pre-existing).
--
-- ---------------------------------------------------------------------
-- POST-DEPLOY TEST PLAN
-- ---------------------------------------------------------------------
-- 1. Download fresh dia + gov exports
-- 2. Data_Volume_TTM: y-axis reads "$1.80B" style; high/low/most-recent
--    callouts visible on the line
-- 3. Data_Avg_Deal_Size: y-axis reads "$7.0M" style
-- 4. Data_Avail_by_Term_Summary: left axis reads "$X.XM" instead of
--    "$3,450,000"
-- 5. Data_NM_vs_Market: NM line significantly smoother (9-mo vs 5-mo
--    MA); ~4-month lag on real inflections
-- 6. Data_Sold_Cap_by_Term: cohort lines smoother through 2024 sparse
--    period
-- =====================================================================
