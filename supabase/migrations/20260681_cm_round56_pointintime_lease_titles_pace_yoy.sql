-- =====================================================================
-- Round 56 — three fixes from user notes 2026-05-22 batch 3.
--
-- ---------------------------------------------------------------------
-- 1. CORE_CAP_DOT — point-in-time lease_expiration lookup
-- ---------------------------------------------------------------------
-- User: "Are we accidentally overcounting sales because we're pulling
-- in the newest and extended lease expiration dates? We only want the
-- expiration dates for sales that we had at the time of the sale."
--
-- Old query for firm_term_years picked the lease record with the
-- latest lease_expiration among rows whose lease_start <= sale_date.
-- Bug: if a lease was extended/amended AFTER the sale (a new lease
-- row or in-place update with a later expiration), the algorithm
-- applied that later expiration to the already-closed sale, inflating
-- its firm_term and pulling it into the "long firm term" cohort.
--
-- New logic adds point-in-time gates:
--   • COALESCE(effective_date, lease_start, sale_date) <= sale_date
--     — record was effective at-or-before sale_date
--   • superseded_at IS NULL OR superseded_at > sale_date
--     — record was not yet replaced by a newer amendment
-- Tie-break by COALESCE(effective_date, lease_start) DESC so the
-- most-recent point-in-time-active record wins (not the longest-term).
--
-- Pre-fix vs post-fix audit: 42 of 880 long-firm dia sales (4.8%) were
-- overcounted; avg term diff 0.35 yrs.
--
-- Replay (dia):
CREATE OR REPLACE VIEW public.cm_dialysis_core_cap_rate_dots AS
 SELECT s.sale_date,
        COALESCE(s.cap_rate, s.calculated_cap_rate, s.stated_cap_rate) AS cap_rate,
        ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone
                                  - s.sale_date::timestamp without time zone) / (86400.0 * 365.25)
            FROM leases l
           WHERE l.property_id = s.property_id
             AND l.lease_expiration IS NOT NULL
             AND l.lease_expiration >= s.sale_date
             AND (l.lease_start IS NULL OR l.lease_start <= s.sale_date)
             AND COALESCE(l.effective_date, l.lease_start, s.sale_date) <= s.sale_date
             AND (l.superseded_at IS NULL OR l.superseded_at::date > s.sale_date)
           ORDER BY COALESCE(l.effective_date, l.lease_start) DESC NULLS LAST,
                    l.lease_expiration DESC
           LIMIT 1
        ) AS firm_term_years,
        s.is_northmarq,
        s.sold_price
   FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL
    AND s.sold_price IS NOT NULL
    AND s.sold_price > 0::numeric
    AND NOT COALESCE(s.exclude_from_market_metrics, false);
-- Gov mirror (slightly different column names — expiration_date /
-- commencement_date, and gov stores firm_term_years on the lease record):
-- applied to government Supabase project; see
-- supabase/migrations/government/<TODO>_cm_round56_gov_core_cap_pit.sql.
--
-- ---------------------------------------------------------------------
-- 2. AVAIL_CAP_DOT — "Firm Term" → "Lease Term" title for dia
-- ---------------------------------------------------------------------
-- User: "Firm term label in the dialysis chart title, should just be
-- lease term — firm term is for government only."
--
-- Code-only fix in api/_shared/cm-excel-export.js: added
-- NAME_OVERRIDES_BY_VERTICAL map that patches chart.name based on
-- vertical at the entry to buildCapitalMarketsWorkbook. Patching
-- chart.name once lets the override flow into tab title, page header,
-- chart <c:title>, and the Index row consistently without per-callsite
-- plumbing. Catalog row stays unchanged (one row, two verticals).
--
-- Gov chart name preserved as "Available Deals — Asking Cap vs Firm Term".
-- Dia chart name becomes "Available Deals — Asking Cap vs Lease Term".
--
-- (The LCC app's axis-title text was already corrected in R33 — gov uses
-- "Firm Lease Term (Years)", dia uses "Lease Term (Years)". This R56
-- change brings the export's chart title into parity.)
--
-- ---------------------------------------------------------------------
-- 3. PACE_CAP_EXPAND — add YOY pace-of-change line
-- ---------------------------------------------------------------------
-- User: "We also have a YOY pace of change line in our Excel/PDF
-- version that is missing from this one."
--
-- The synthetic composer (api/capital-markets.js
-- pace_of_cap_rate_expansion) was already computing a `pace_cost`
-- field — the YoY change in cost-of-capital (mortgage_30y_rate, with
-- treasury_10y_yield as fallback). But the data tab's CHART_COLUMNS
-- dropped it AND the chart spec only plotted pace_all + pace_core
-- bars. R56 wires the deferred 3rd series:
--
--   • CHART_COLUMNS gains a `pace_cost` column ("Pace — Cost of Capital (YoY)").
--   • Chart spec converts from `clustered-bar` to `combo`:
--       Bar (navy):  pace_all
--       Bar (sky):   pace_core
--       Line (amber #D97706): pace_cost
--     sharedAxis=true because all 3 are in the same %bps units.
--
-- Graceful fallback: if pace_cost isn't in the cols (legacy view),
-- spec falls back to the pre-R56 2-bar clustered-bar shape.
--
-- ---------------------------------------------------------------------
-- LOCAL VERIFICATION
-- ---------------------------------------------------------------------
-- 152 CM injector tests pass (was 149 after R55); 3 new R56 tests:
--   • pace_of_cap_rate_expansion falls back to 2-bar when pace_cost missing
--   • R56: pace_of_cap_rate_expansion adds pace_cost YOY line
--   • R56: NAME_OVERRIDES dia gets Lease Term, gov keeps Firm Term
-- Full suite 373/2 (2 unrelated pre-existing).
--
-- ---------------------------------------------------------------------
-- POST-DEPLOY TEST PLAN
-- ---------------------------------------------------------------------
-- 1. Download fresh dia + gov exports.
-- 2. Data_Core_Cap_Dot — re-count of dia "long firm term" dots should
--    drop by ~42 vs prior export (sales whose lease was extended
--    post-sale will now correctly show shorter firm_term and fall out
--    of the cohort filter).
-- 3. Data_Avail_Cap_Dot — chart <c:title>, page header, and Data_*
--    tab title for dia all read "Available Deals — Asking Cap vs
--    Lease Term" (was "vs Firm Term"). Gov export unchanged.
-- 4. Data_Pace_Cap_Expand — visible amber line for "Pace — Cost of
--    Capital (YoY)" overlaying the 2 existing pace bars. New
--    "Pace — Cost of Capital (YoY)" column in the data tab.
--
-- ---------------------------------------------------------------------
-- WHAT'S NEXT
-- ---------------------------------------------------------------------
-- R57: Legend / data-label correctness pass for the "4.73% in legend"
--      complaints across Cap_Avg / Returns_Idx / Cost_Capital
--      (likely R37 P3 trough annotations now stale after R54's
--      Cap_Quartile gate but still showing pre-R54 numbers)
-- R-backfill: still deferred (external data agreement first)
-- =====================================================================
