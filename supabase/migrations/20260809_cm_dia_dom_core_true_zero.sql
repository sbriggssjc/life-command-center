-- ============================================================================
-- CM chart feedback item #10 (B4) — Active DOM core % price change: true 0 vs null
-- Target: Dialysis_DB (zqzrriwuavgrquhisnoa)
-- ============================================================================
-- The core active % price-change line went NULL Aug-Nov 2025 (the line "dies").
-- Root cause: the gate required denom_core_raw >= 16 AND denom_core_history_raw
-- >= 1. Those months had 12-15 core listings with known price-change status
-- (a real cohort, pct ~7-8%) but fell UNDER the 16 size floor, so they were
-- NULLed even though the data existed. The history>=1 clause also NULLed a
-- genuine zero (a true 0% is information, not missing data).
--
-- Fix (per feedback): emit pct_price_change_core whenever the core cohort meets
-- the size floor of >= 5 known-status listings — including a true 0% when no
-- changes occurred; NULL only BELOW the floor (gap-skipped by the chart). The
-- denom_core_history_raw requirement is dropped.
--
-- Additive/reversible CREATE OR REPLACE VIEW (append-only column list unchanged).
-- Revert = restore the >=16 AND history>=1 gate. Live immediately.
-- ============================================================================

CREATE OR REPLACE VIEW cm_dialysis_dom_price_change_active_m AS
WITH raw AS (
  SELECT a.period_end,
         avg(a.days_on_market) FILTER (WHERE a.days_on_market >= 0 AND a.days_on_market <= 730) AS dom_total_raw,
         avg(a.days_on_market) FILTER (WHERE a.is_core_10plus AND a.days_on_market >= 0 AND a.days_on_market <= 730) AS dom_core_raw,
         count(*) FILTER (WHERE a.had_price_change)::numeric
           / NULLIF(count(*) FILTER (WHERE a.had_price_change IS NOT NULL), 0)::numeric AS pct_total_raw,
         count(*) FILTER (WHERE a.had_price_change AND a.is_core_10plus)::numeric
           / NULLIF(count(*) FILTER (WHERE a.had_price_change IS NOT NULL AND a.is_core_10plus), 0)::numeric AS pct_core_raw,
         count(*) FILTER (WHERE a.had_price_change IS NOT NULL AND a.is_core_10plus) AS denom_core_raw,
         count(*) FILTER (WHERE a.is_core_10plus
                            AND (a.had_price_change
                                 OR (a.initial_price IS NOT NULL AND a.last_price IS NOT NULL AND a.initial_price <> a.last_price))) AS denom_core_history_raw
  FROM cm_dialysis_active_listings_m a
  GROUP BY a.period_end
  HAVING count(*) >= 8
)
SELECT raw.period_end,
       'all'::text AS subspecialty,
       avg(raw.dom_total_raw) OVER w AS avg_dom_total,
       avg(raw.dom_core_raw)  OVER w AS avg_dom_core,
       raw.pct_total_raw AS pct_price_change_total,
       -- B4: emit the true rate (0 included) once the core cohort clears the
       -- size floor of 5; NULL only below the floor. Was: >=16 AND history>=1.
       CASE WHEN raw.denom_core_raw >= 5 THEN raw.pct_core_raw ELSE NULL::numeric END AS pct_price_change_core
FROM raw
WINDOW w AS (ORDER BY raw.period_end ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING)
ORDER BY raw.period_end;

COMMENT ON VIEW cm_dialysis_dom_price_change_active_m IS
  'Active DOM + % price change (total/core). pct_price_change_core emitted when the core cohort has >=5 known-status listings (true 0 included); NULL below the floor (gap-skipped). CM feedback item #10 (2026-08).';
