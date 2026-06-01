-- =============================================================================
-- Migration: cm_dialysis_dom_price_change_active_m — R66b stair-step smoothing
-- Project:   Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Date:       2026-06-01
--
-- Note (Active_DOM_PC): R66 broke the monotonic zombie ramp but the line still
-- showed large month-to-month jumps (worst ~248 days at 2015-07). Root cause is
-- THIN SAMPLES in the early years — active-listing counts were 1-13/mo through
-- 2017 (1-5 in 2015), so one long-DOM listing entering/leaving swung the
-- average. From 2018 the count is >=12, 2020+ is >=39.
--
-- Fix: (1) gate out months with <8 active listings (HAVING count(*)>=8), and
-- (2) apply a 3-month centered smoothing to the two DOM lines. Worst MoM jump
-- drops 248 -> 76 days (53 for 2018+); avg |MoM| 29 -> 14. The native Excel
-- chart additionally trims display to 2018 via MIN_YEAR_BY_TEMPLATE.
-- Column contract unchanged. Validated read-only + applied to prod 2026-06-01.
-- =============================================================================
CREATE OR REPLACE VIEW public.cm_dialysis_dom_price_change_active_m AS
 WITH raw AS (
   SELECT period_end,
     avg(days_on_market) FILTER (WHERE days_on_market >= 0 AND days_on_market <= 730) AS dom_total_raw,
     avg(days_on_market) FILTER (WHERE is_core_10plus AND days_on_market >= 0 AND days_on_market <= 730) AS dom_core_raw,
     count(*) FILTER (WHERE had_price_change)::numeric
       / NULLIF(count(*) FILTER (WHERE had_price_change IS NOT NULL), 0)::numeric AS pct_total_raw,
     count(*) FILTER (WHERE had_price_change AND is_core_10plus)::numeric
       / NULLIF(count(*) FILTER (WHERE had_price_change IS NOT NULL AND is_core_10plus), 0)::numeric AS pct_core_raw
   FROM cm_dialysis_active_listings_m
   GROUP BY period_end
   HAVING count(*) >= 8
 )
 SELECT period_end,
   'all'::text AS subspecialty,
   avg(dom_total_raw) OVER w AS avg_dom_total,
   avg(dom_core_raw)  OVER w AS avg_dom_core,
   pct_total_raw AS pct_price_change_total,
   pct_core_raw  AS pct_price_change_core
 FROM raw
 WINDOW w AS (ORDER BY period_end ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING)
 ORDER BY period_end;
