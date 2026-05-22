-- =====================================================================
-- Round 50 — Bucket C chart-type restructures vs master.
-- User notes 2026-05-21 (refined 2026-05-22 via AskUserQuestion):
-- 4 charts where the dialysis export visual shape didn't match the
-- master Excel/PDF deliverable. Restructure each to match the master
-- chart on Dialysis Comp Work MASTER.xlsx.
--
-- Supabase changes applied via MCP (live on prod, replayed below for
-- forward-recovery if the database ever needs to be rebuilt).
-- Code changes shipped in commit
-- claude/cm-round50-bucket-c-restructure (PR open).
--
-- ---------------------------------------------------------------------
-- USER DIRECTION (2026-05-22)
-- ---------------------------------------------------------------------
-- Q1 Bid_Ask:           "Bid ask shows the spread in bars/lines with
--                        drop down lines above the last asking cap TTM.
--                        See the chart in the master dialysis."
-- Q2 Avail_by_Term:     "Adjust dot colors to match master, Pin
--                        right-axis range (cap %), Diamond markers
--                        instead of circles"
-- Q3 Inventory_Backlog: "Add Net-to-Market line (helper column)"
-- Q4 Market_Turnover:   "There's a chart, untitled, at the bottom of
--                        the tab 'Market Size' in our Dialysis Master."
--
-- ---------------------------------------------------------------------
-- 1. Data_Bid_Ask — stacked line + up-down bars matching master chart7
-- ---------------------------------------------------------------------
-- Master chart7 (Dialysis Comp Work MASTER.xlsx > Charts tab) is a
-- stacked-line chart with chart-level <c:upDownBars/>:
--   Series 0 (bottom): Last Ask Cap (TTM)   — sky line
--   Series 1 (top):    Bid-Ask Spread       — navy, stacked above s0
--   <c:upDownBars/>:   gray bars between the two stacked lines
--
-- Visually: the bottom sky line is the asking cap; the gray drop-down
-- bars climb from the sky line up to the spread on top of it, giving
-- the "spread band above the last asking cap" the user described.
--
-- CODE: cm-native-chart-injector.js — case 'bid_ask_spread' +
--       'bid_ask_spread_monthly' both rewritten to multi-line with
--       lineGrouping='stacked' + upDownBars=true. buildMultiLineChartXml
--       extended with those two flags (backward-compat default
--       lineGrouping='standard', upDownBars=false).
--
-- VIEW (dia): cm_dialysis_bid_ask_spread_q rebuilt to emit
--             avg_last_ask_cap with the same TTM (sold_date within
--             1-year window) and >=5 sample sanity gate the monthly
--             view already used. Quarterly + monthly cadences now
--             formula-consistent.
--
-- VIEW (gov): cm_gov_bid_ask_spread_q rebuilt to source from
--             cm_gov_market_quarterly_master_m_mat (which carries
--             avg_last_ask_cap) instead of cm_gov_market_quarterly
--             (which didn't). Same >=5 sample TTM gate.
--
-- Backward-compat: if a view layout drops avg_last_ask_cap (legacy
-- catalog, custom vertical), the spec gracefully degrades to a single
-- spread line — no breakage.
--
-- Replay (dia):
CREATE OR REPLACE VIEW public.cm_dialysis_bid_ask_spread_q AS
 WITH quarter_anchors AS (
         SELECT DISTINCT (date_trunc('quarter'::text, available_listings.sold_date::timestamp with time zone) + '3 mons -1 days'::interval)::date AS period_end
           FROM available_listings
          WHERE available_listings.sold_date IS NOT NULL
        ), ttm_sold AS (
         SELECT q.period_end,
                CASE
                    WHEN al.last_cap_rate IS NOT NULL AND al.cap_rate IS NOT NULL THEN abs(al.last_cap_rate - al.cap_rate)
                    ELSE NULL::numeric
                END AS bid_ask_spread_bps,
                CASE
                    WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price THEN true
                    WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL THEN false
                    ELSE NULL::boolean
                END AS had_price_change,
                al.last_cap_rate AS last_ask_cap
           FROM quarter_anchors q
             JOIN available_listings al ON al.sold_date > (q.period_end - '1 year'::interval)::date AND al.sold_date <= q.period_end
        ), agg AS (
         SELECT ttm_sold.period_end,
                count(*) FILTER (WHERE ttm_sold.bid_ask_spread_bps IS NOT NULL) AS n_with_spread,
                avg(ttm_sold.bid_ask_spread_bps)::numeric(8,5) AS avg_bid_ask_spread,
                count(*) FILTER (WHERE ttm_sold.had_price_change IS NOT NULL) AS n_with_pricing,
                count(*) FILTER (WHERE ttm_sold.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE ttm_sold.had_price_change IS NOT NULL), 0)::numeric AS pct_price_change,
                avg(ttm_sold.last_ask_cap) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12)::numeric(8,5) AS avg_last_ask_cap_raw,
                count(*) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12) AS n_with_last_cap
           FROM ttm_sold
          GROUP BY ttm_sold.period_end
        )
 SELECT period_end,
        'all'::text AS subspecialty,
        n_with_spread,
        avg_bid_ask_spread,
        n_with_pricing,
        pct_price_change,
        CASE WHEN n_with_last_cap >= 5 THEN avg_last_ask_cap_raw ELSE NULL::numeric(8,5) END AS avg_last_ask_cap
   FROM agg
  ORDER BY period_end;

-- Replay (gov) is in the parallel migration:
-- supabase/migrations/government/<TODO>_cm_round50_gov_bid_ask_q.sql
-- (gov DB is project scknotsqkcheojiaewwh; this file targets dia DB
-- per migration-folder convention).
--
-- ---------------------------------------------------------------------
-- 2. Data_Inventory_Backlog — combo bar+bar+line w/ Net-to-Market helper
-- ---------------------------------------------------------------------
-- Master chart8 (Dialysis Comp Work MASTER.xlsx > Charts tab) is a
-- 3-series combo:
--   Bar 1 (sky):    No. Added to Market (TTM)
--   Bar 2 (navy):   No. Sold (TTM)
--   Line (gray):    Net to Market = Added − Sold
--
-- The Net line tells the inventory-direction story: positive = listings
-- accumulating; negative = inventory shrinking faster than it can be
-- replenished. Master computes it inline; we use R34 P8.5 helperCol
-- infrastructure to compute it at chart-build time (no view changes
-- needed — both added_ttm + sold_ttm already in cm_*_inventory_backlog_m
-- views for both verticals).
--
-- CODE: cm-native-chart-injector.js — case 'inventory_backlog' rewritten
--       from 'clustered-bar' (2 bars only) to 'combo' with sharedAxis=true
--       so the line uses the same integer-count axis as the bars (no
--       separate right axis). helperCols=[net_ttm] declared.
--
-- VIEW: none. Helper col writes to the export at runtime via
--       cm-excel-export.js helperCol writer.
--
-- ---------------------------------------------------------------------
-- 3. Data_Market_Turnover — combo bar+line matching master chart31
-- ---------------------------------------------------------------------
-- Master Market Size tab chart31 (anchor rows 159-194, the chart at the
-- bottom of the tab the user pointed to) is a 4-series combo:
--   Bar 1 (cohort): Total Monthly Clear Pace  (col K)
--   Bar 2 (cohort): 10+ Year Monthly Clear Pace (col U)
--   Line 1:         Total Inventory Backlog   (col L)
--   Line 2:         10+ Year Inventory Backlog (col V)
--
-- Dialysis doesn't have a "10+ Year cohort" decomposition in the
-- turnover view (cm_dialysis_market_turnover_m), and our market_universe
-- is a near-constant total (count of all dialysis facilities ~3500).
-- So we plot the two most informative series we DO have, in the same
-- combo bar+line shape:
--   Bar (sky):   Monthly Clear Pace = ttm_sales_count / 12
--                (helper col added at chart-build time)
--   Line (navy): Turnover Rate (right axis, %)
--
-- This preserves the master's "bars for absolute activity + line for
-- the rate overlay" structural shape while staying faithful to the data
-- we have. Future enhancement (R-cohort): add 10+ year cohort
-- decomposition to the turnover view to fully replicate the 4-series
-- structure if dialysis ever gains lease-term cohort columns.
--
-- CODE: cm-native-chart-injector.js — case 'market_turnover' rewritten
--       from singleSeries('line', ...) to combo with helperCols=[
--       monthly_clear_pace], dual axis (left=integer count, right=%).
--
-- VIEW: none.
--
-- ---------------------------------------------------------------------
-- 4. Data_Avail_by_Term_Summary — master-aligned dot colors + axis pin
-- ---------------------------------------------------------------------
-- Master Market Size tab chart26 is a bar + 5-scatter combo:
--   Bar (pale fill + navy border): Bucket count (No. Available, col C)
--   Dot (navy):                    Avg Price (col D) — left axis $
--   Dot (teal):                    Avg Cap (col E) — right axis %
--   Dot (purple):                  Upper Quartile (col F) — right axis
--   Dot (sky):                     Lower Quartile (col G) — right axis
--
-- Our export had:
--   Bar (sky):    Avg Price (col C) — left axis $
--   Dot (navy):   Avg Cap (col D) — right axis %
--   Dot (purple): Upper Quartile (col E)
--   Dot (gray):   Lower Quartile (col G)
--   Dot (sage):   Median (col F) — master doesn't include Median
--
-- User direction (2026-05-22): "Adjust dot colors to match master, Pin
-- right-axis range (cap %), Diamond markers instead of circles." Master
-- uses circle markers but user prefers diamond — diamond reads as more
-- distinct from the bar fill in tight Excel previews; honor user
-- preference. User did NOT say drop the Median dot, so we keep it.
--
-- R50 color changes:
--   Avg Cap        navy   → aquamarine #00B1B0 (matches master teal)
--   Upper Quartile purple (unchanged) #7E6BAD
--   Lower Quartile gray   → sky #62B5E5 (matches master)
--   Median         sage   (unchanged) #4CB582 (no master analog)
--
-- R50 axis pin:
--   yRightRange = { min: 0.04, max: 0.12 } (CAP_RATE_DOT_RANGE,
--                  matches Core_Cap_Dot + Avail_Cap_Dot)
--   yLeftNumFmt = VAL_FMT_CURRENCY ($ on price bars)
--
-- CODE: cm-native-chart-injector.js — case 'available_by_term_summary'
--       updated with new colors + yRightRange/yRightNumFmt/yLeftNumFmt.
--
-- VIEW: none.
--
-- ---------------------------------------------------------------------
-- LOCAL VERIFICATION
-- ---------------------------------------------------------------------
-- 137 CM tests pass (up from 132 in R48). Full suite 358 pass / 2
-- unrelated pre-existing failures (availability-checker-parsers + raw
-- write guardrail; same as R47/R48).
--
-- New R50 tests (test/cm-native-chart-injector.test.mjs):
--   • bid_ask_spread R50 — stacked line + up-down bars when last_ask present
--   • bid_ask_spread (quarterly) gracefully degrades when last_ask missing
--   • bid_ask_spread_monthly R50 — same stacked-line restructure as quarterly
--   • inventory_backlog R50 — combo bar+bar+net line via helper col
--   • available_by_term_summary R50 — master-aligned aquamarine/sky dots + right-axis pin
--   • market_turnover R50 — combo bar+line with monthly clear pace helper
--   • buildMultiLineChartXml emits stacked grouping + upDownBars when requested
--   • buildMultiLineChartXml default keeps standard grouping (no upDownBars)
--   • injectNativeCharts renders stacked-line + upDownBars end-to-end
--
-- ---------------------------------------------------------------------
-- POST-DEPLOY TEST PLAN
-- ---------------------------------------------------------------------
-- 1. Download fresh dia + gov exports.
-- 2. Open Data_Bid_Ask — should show:
--    • Bottom sky line tracking ~6-7% last-asking-cap
--    • Gray drop-down bars above the sky line, height = spread
--    • Top navy line at sky+spread (~6.5-8% for dia, ~7-9% for gov)
-- 3. Open Data_Inventory_Backlog — should show:
--    • 2 bars per period (sky added + navy sold)
--    • Gray line tracing the Net to Market (added − sold)
--    • Helper column G "Net to Market (TTM)" visible in data tab
-- 4. Open Data_Market_Turnover — should show:
--    • Sky bars for Monthly Clear Pace (helper col F)
--    • Navy line for Turnover Rate on right % axis
--    • Helper column F "Monthly Clear Pace" visible in data tab
-- 5. Open Data_Avail_by_Term_Summary — should show:
--    • Sky bars for Avg Price ($, left axis)
--    • Aquamarine/purple/sky/sage diamond dots on right axis (4-12%)
--    • Right axis labeled as percent
--
-- ---------------------------------------------------------------------
-- WHAT'S NEXT
-- ---------------------------------------------------------------------
-- R-backfill (still deferred): external source-data ingestion for
--   pre-2003 dia comps. User confirmed worth exploring. Separate task —
--   requires data agreement (RCA / CoStar / broker memory) + ingestion
--   pipeline + provenance + model versioning per
--   C:\Users\scott\DialysisProject\CLAUDE.md ground rules.
--
-- R-cohort (deferred): Add 10+ year cohort decomposition to
--   cm_dialysis_market_turnover_m so the chart can match master
--   chart31's full 4-series shape (Total + 10+ Year bars/lines). Not
--   ground-truth in dialysis where facilities don't have firm lease
--   terms; would require synthetic cohort definition.
-- =====================================================================
