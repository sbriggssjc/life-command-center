-- ============================================================================
-- CM gov NM-vs-Market — CONFIRMED-CAP, SINGLE-PASS variant.  Target: Government
-- (scknotsqkcheojiaewwh).  Additive / reversible (DROP VIEW).  Live immediately
-- (CM export reads views per request, no-store).
-- ============================================================================
-- Motivation (2026-08-29 chart-story review):  the shipped cm_gov_nm_vs_market_m
-- tells an UNFAVORABLE Northmarq story in 2025-26 for two reasons that are data
-- artifacts, not performance:
--   1) It pools cap_rate_quality='rolled_forward_escalated' caps (projected rent
--      / price, NOT confirmed transaction caps).  Two such deals — Peoria IL
--      2025-03 (8.48%) and Hillside/Chicago 2025-04 (9.93%) — single-handedly
--      lifted the NM trailing average by ~70 bps.  Scott's ask: "true, confirmed
--      cap rate and not just rents."
--   2) It applies a SECOND smoothing pass (a 5-quarter centered window ROWS
--      BETWEEN 2 PRECEDING AND 2 FOLLOWING) on TOP of the 24-month TTM average,
--      which lags heavily and bleeds late deals backward across the whole curve.
--
-- This view is the corrected basis for the value-prop chart:
--   • CONFIRMED caps only  — drop 'implausible_unverified' AND
--     'rolled_forward_escalated' (projected-rent) from the cap pool.  Keeps
--     stated_only / market_implied / om_pro_forma / source-reported.
--   • SINGLE-PASS 24-month TTM simple average (no extra 5-quarter window).
--   • Both weightings: equal-weight (nm_cap_ew) AND dollar-weight (nm_cap_wtd),
--     so a $0.2M deal and a $20M deal don't count the same.
--   • A distinct Team Briggs line (briggs_cap_ew) — %Briggs% listing/purchasing
--     broker — for the Briggs-highlighted cut.
--   • min-3 gate per line so a 1-2 deal window never prints a headline number.
--
-- Same 0.04-0.12 band and exclude_from_market_metrics guard as the shipped view.
-- The shipped cm_gov_nm_vs_market_m is LEFT IN PLACE; the export can point at
-- whichever it prefers.
-- ============================================================================

CREATE OR REPLACE VIEW cm_gov_nm_vs_market_confirmed_m AS
WITH spine AS (
  SELECT DISTINCT period_end, subspecialty FROM cm_gov_market_quarterly_master_m_mat
),
sales AS (
  SELECT s.sale_date, s.sold_price,
         -- CONFIRMED caps only: drop implausible AND projected-rent-derived
         CASE WHEN s.cap_rate_quality IN ('implausible_unverified','rolled_forward_escalated')
              THEN NULL ELSE s.sold_cap_rate END AS cap,
         COALESCE(s.is_northmarq,false) AS is_nm,
         (s.listing_broker ILIKE '%Briggs%' OR s.purchasing_broker ILIKE '%Briggs%') AS is_briggs
  FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL AND s.sold_price > 0
    AND NOT COALESCE(s.exclude_from_market_metrics,false)
),
ttm AS (
  SELECT sp.period_end, sp.subspecialty,
    avg(sl.cap) FILTER (WHERE sl.is_nm     AND sl.cap BETWEEN 0.04 AND 0.12) AS nm_avg,
    avg(sl.cap) FILTER (WHERE NOT sl.is_nm AND sl.cap BETWEEN 0.04 AND 0.12) AS mkt_avg,
    avg(sl.cap) FILTER (WHERE sl.is_briggs AND sl.cap BETWEEN 0.04 AND 0.12) AS briggs_avg,
    sum(sl.sold_price*sl.cap) FILTER (WHERE sl.is_nm     AND sl.cap BETWEEN 0.04 AND 0.12) AS nm_wsum,
    sum(sl.sold_price)        FILTER (WHERE sl.is_nm     AND sl.cap BETWEEN 0.04 AND 0.12) AS nm_psum,
    sum(sl.sold_price*sl.cap) FILTER (WHERE NOT sl.is_nm AND sl.cap BETWEEN 0.04 AND 0.12) AS mkt_wsum,
    sum(sl.sold_price)        FILTER (WHERE NOT sl.is_nm AND sl.cap BETWEEN 0.04 AND 0.12) AS mkt_psum,
    count(*) FILTER (WHERE sl.is_nm     AND sl.cap BETWEEN 0.04 AND 0.12) AS nm_n,
    count(*) FILTER (WHERE NOT sl.is_nm AND sl.cap BETWEEN 0.04 AND 0.12) AS mkt_n,
    count(*) FILTER (WHERE sl.is_briggs AND sl.cap BETWEEN 0.04 AND 0.12) AS briggs_n
  FROM spine sp
  LEFT JOIN sales sl
    ON sl.sale_date >  (sp.period_end - '2 years'::interval)::date
   AND sl.sale_date <= sp.period_end
  GROUP BY sp.period_end, sp.subspecialty
)
SELECT period_end, subspecialty,
  CASE WHEN nm_n     >= 3 THEN nm_avg END                      AS nm_cap_ew,
  CASE WHEN nm_n     >= 3 THEN nm_wsum  / NULLIF(nm_psum, 0) END  AS nm_cap_wtd,
  CASE WHEN mkt_n    >= 3 THEN mkt_avg END                     AS market_cap_ew,
  CASE WHEN mkt_n    >= 3 THEN mkt_wsum / NULLIF(mkt_psum, 0) END AS market_cap_wtd,
  CASE WHEN briggs_n >= 3 THEN briggs_avg END                 AS briggs_cap_ew,
  nm_n, mkt_n, briggs_n
FROM ttm;

COMMENT ON VIEW cm_gov_nm_vs_market_confirmed_m IS
  'NM vs Market TTM cap (gov), CONFIRMED-CAP SINGLE-PASS variant (2026-08-29). '
  'Cap pool excludes implausible_unverified AND rolled_forward_escalated (projected-rent) '
  'caps — confirmed transaction caps only. 24-month trailing SIMPLE average, NO extra '
  'centered smoothing window. nm_cap_ew/market_cap_ew = equal-weight; *_wtd = dollar-weight; '
  'briggs_cap_ew = Team Briggs (%Briggs% broker) equal-weight. min-3 gate per line. '
  'Companion to cm_gov_nm_vs_market_m (left in place). REVERSE: DROP VIEW.';
