-- =====================================================================
-- Round 65 — best-guess closures on R63/R64 deferred items.
--
-- ---------------------------------------------------------------------
-- 1. MARKET_TURNOVER active_count tight definition
-- ---------------------------------------------------------------------
-- User notes 2026-05-22 batch 5: "active listings should be a count of
-- that snapshot in time that are in the market during that month, not
-- a trailing twelve month total. It should be like 120 listings
-- matching what our inventory analysis shows for the most recent month."
--
-- Investigation: the broad "ever listed and not yet sold/withdrawn"
-- count from cm_dialysis_market_turnover_m returned 514. The tight
-- "actively marketed" count from cm_dialysis_active_listings_q returned
-- 95 — much closer to the user's ~120 expectation. Difference is the
-- `is_active=true OR status IN ('active','available','for sale',
-- 'under contract','draft-commenced','superseded')` filter.
--
-- R65 applies the same tight filter to cm_dialysis_market_turnover_m
-- so the chart's "active inventory" bar matches the Inventory Backlog
-- chart and the user's mental model.
--
-- Post-fix verification (2026-03-31, dia):
--   active_count        514 → 95
--   months_of_supply   ~41 → 7.5  (much more realistic for dia market)
--
-- (Gov side unchanged. Gov "active" already means leases currently in
-- effect — the lease_effective + lease_expiration filter is already
-- tight. Gov has no "actively marketed for sale" concept; sales are
-- opportunistic on long-tenured GSA leases.)
--
-- Replay:
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
         AND (al.is_active = true
              OR (lower(COALESCE(al.status, ''::character varying)::text) = ANY
                  (ARRAY['active','available','for sale','under contract','draft-commenced','superseded'])))
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
--
-- ---------------------------------------------------------------------
-- 2. AVAIL_MKT_SIZE brand-compliant colors
-- ---------------------------------------------------------------------
-- User notes 2026-05-22 batch 5: "Color scheme doesn't match the brand
-- standards."
--
-- Pre-R65 colors on available_market_size_combo:
--   count_total          sky    #62B5E5 ✓ (brand)
--   count_core_10plus    sage   #4CB582 ✗ (off-brand)
--   avg_cap_total        navy   #003DA5 ✓ (brand)
--   avg_cap_core_10plus  amber  #D97706 ✗ (off-brand)
--
-- R65 realigns the off-brand colors:
--   count_core_10plus    nm_pale fill (#E0E8F4) + nm_sky border — brand-compliant cohort overlay
--   avg_cap_core_10plus  nm_navy DASHED line — same color as total, style differentiates
--
-- Same color + line style for cohort overlays is a brand convention
-- already used in R35 P2 dom_price_change_active.
--
-- (Code-only; no Supabase change.)
--
-- ---------------------------------------------------------------------
-- STILL DEFERRED (need user input or post-deploy verification)
-- ---------------------------------------------------------------------
-- • Tenant donuts "missing": data + chart XML confirmed present.
--   R61+R63 schema fixes should have eliminated Excel recovery
--   stripping. Verify in fresh post-R65 export.
-- • Inventory_Backlog legend mismatch: my inspection shows correct
--   labels + colors. Screenshot from user would help diagnose what
--   doesn't match.
--
-- ---------------------------------------------------------------------
-- LOCAL VERIFICATION
-- ---------------------------------------------------------------------
-- 161 CM injector tests pass. Existing available_market_size_combo
-- test updated for the new brand-compliant colors + dashed cohort line.
-- Full suite 382/2 (2 unrelated pre-existing).
--
-- ---------------------------------------------------------------------
-- POST-DEPLOY TEST PLAN
-- ---------------------------------------------------------------------
-- 1. Download fresh dia + gov exports
-- 2. Data_Market_Turnover (dia): active-listings back bar reads
--    ~95-100 (was ~514). Months-of-supply line reads ~7-8 months
--    (was ~41). Annual sales rate bar unchanged.
-- 3. Data_Market_Turnover (gov): unchanged — gov "active" is already
--    the tight GSA-lease-in-effect count.
-- 4. Data_Avail_Mkt_Size: 2 bars (sky + pale-sky) + 2 lines (both navy,
--    second is dashed). All 4 series brand-compliant.
-- 5. All other charts unchanged.
-- =====================================================================
