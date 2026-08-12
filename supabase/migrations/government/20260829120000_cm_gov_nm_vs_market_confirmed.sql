-- ============================================================================
-- CM gov NM-vs-Market — confirmed-cap, single-pass correction (in place).
-- Target: Government (scknotsqkcheojiaewwh).  Additive to the column contract
-- (append-only) / reversible.  Live immediately (CM export reads views per
-- request, no-store).  GOV-ONLY — dia's cm_dia_nm_vs_market_m is untouched.
-- ============================================================================
-- Motivation (2026-08-29 value-prop chart-story review).  The shipped
-- cm_gov_nm_vs_market_m told an UNFAVORABLE Northmarq story in 2025-26 for two
-- reasons that are DATA ARTIFACTS, not execution:
--   1) It pooled cap_rate_quality='rolled_forward_escalated' caps — these are
--      projected rent / price, NOT confirmed transaction caps.  Two such NM
--      deals (Peoria IL 2025-03 8.48%, Hillside/Chicago 2025-04 9.93%) lifted
--      the trailing NM average by ~70 bps.  Scott's ask: "true, confirmed cap
--      rate and not just rents."
--   2) It applied a SECOND smoothing pass — a 5-quarter centered window
--      (ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING) on TOP of the 24-month TTM
--      average — which lags heavily and bleeds late deals backward across the
--      whole curve.
--
-- This migration REDEFINES the same view (same charted column names/order/types
-- so the CM export + native chart binding are unchanged) with:
--   • CONFIRMED caps only — drop 'implausible_unverified' AND
--     'rolled_forward_escalated' (projected-rent) from the cap pool.
--   • SINGLE-PASS 24-month TTM simple average (the extra centered window is gone).
--   • APPENDS reference columns (uncharted, like the ttm12 pair):
--       nm_cap_wtd / market_cap_wtd  = 24-mo DOLLAR-weighted (so a $0.2M and a
--                                      $20M deal don't count the same),
--       briggs_cap_ew                = Team Briggs (%Briggs% listing/purchasing
--                                      broker) 24-mo equal-weight.
--   • ttm12 columns are RETAINED (now confirmed-cap 12-mo, reference only).
--
-- Same 0.04-0.12 band, exclude_from_market_metrics guard, and n>=3 gate as before.
-- charted lines stay nm_cap_rate / market_cap_rate (columns C/D on Data_NM_vs_Market).
-- REVERSE: re-run the prior body from 20260809_cm_gov_nm_vs_market_trailing_24mo_ref.sql.
-- ============================================================================

-- Clean up the exploratory standalone view from the review session (if present).
DROP VIEW IF EXISTS cm_gov_nm_vs_market_confirmed_m;

CREATE OR REPLACE VIEW cm_gov_nm_vs_market_m AS
WITH spine AS (
  SELECT DISTINCT period_end, subspecialty FROM cm_gov_market_quarterly_master_m_mat
),
sales AS (
  SELECT s.sale_date, s.sold_price,
         -- CONFIRMED caps only: drop implausible AND projected-rent-derived
         CASE WHEN s.cap_rate_quality IN ('implausible_unverified','rolled_forward_escalated')
              THEN NULL ELSE s.sold_cap_rate END AS cap,
         COALESCE(s.is_northmarq, false) AS is_nm,
         (s.listing_broker ILIKE '%Briggs%' OR s.purchasing_broker ILIKE '%Briggs%') AS is_briggs
  FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL AND s.sold_price > 0
    AND NOT COALESCE(s.exclude_from_market_metrics, false)
),
ttm AS (
  SELECT sp.period_end, sp.subspecialty,
    avg(sl.cap) FILTER (WHERE sl.is_nm     AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS nm_avg,
    avg(sl.cap) FILTER (WHERE NOT sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS mkt_avg,
    avg(sl.cap) FILTER (WHERE sl.is_briggs AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS briggs_avg,
    sum(sl.sold_price * sl.cap) FILTER (WHERE sl.is_nm     AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS nm_wsum,
    sum(sl.sold_price)          FILTER (WHERE sl.is_nm     AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS nm_psum,
    sum(sl.sold_price * sl.cap) FILTER (WHERE NOT sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS mkt_wsum,
    sum(sl.sold_price)          FILTER (WHERE NOT sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS mkt_psum,
    count(*) FILTER (WHERE sl.is_nm     AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS nm_n,
    count(*) FILTER (WHERE NOT sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS mkt_n,
    count(*) FILTER (WHERE sl.is_briggs AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS briggs_n,
    -- 12-month TTM subset (reference, uncharted), confirmed caps
    avg(sl.cap) FILTER (WHERE sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12
                        AND sl.sale_date > (sp.period_end - '1 year'::interval)::date) AS nm_avg12,
    avg(sl.cap) FILTER (WHERE NOT sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12
                        AND sl.sale_date > (sp.period_end - '1 year'::interval)::date) AS mkt_avg12,
    count(*) FILTER (WHERE sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12
                     AND sl.sale_date > (sp.period_end - '1 year'::interval)::date) AS nm_n12,
    count(*) FILTER (WHERE NOT sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12
                     AND sl.sale_date > (sp.period_end - '1 year'::interval)::date) AS mkt_n12
  FROM spine sp
  LEFT JOIN sales sl
    ON sl.sale_date >  (sp.period_end - '2 years'::interval)::date
   AND sl.sale_date <= sp.period_end
  GROUP BY sp.period_end, sp.subspecialty
)
SELECT ttm.period_end, ttm.subspecialty,
  -- charted lines (single-pass 24-mo simple avg, confirmed caps, n>=3 gate)
  CASE WHEN ttm.nm_n  >= 3 THEN ttm.nm_avg  END AS nm_cap_rate,
  CASE WHEN ttm.mkt_n >= 3 THEN ttm.mkt_avg END AS market_cap_rate,
  -- 24-mo dollar-weighted (reference)
  CASE WHEN ttm.nm_n  >= 3 THEN ttm.nm_wsum  / NULLIF(ttm.nm_psum,  0) END AS nm_cap_wtd,
  CASE WHEN ttm.mkt_n >= 3 THEN ttm.mkt_wsum / NULLIF(ttm.mkt_psum, 0) END AS market_cap_wtd,
  ttm.nm_n, ttm.mkt_n,
  -- 12-mo TTM simple avg (reference, uncharted), confirmed caps
  CASE WHEN ttm.nm_n12  >= 3 THEN ttm.nm_avg12  END AS nm_cap_ttm12,
  CASE WHEN ttm.mkt_n12 >= 3 THEN ttm.mkt_avg12 END AS market_cap_ttm12,
  -- Team Briggs 24-mo equal-weight (reference, uncharted) — appended
  CASE WHEN ttm.briggs_n >= 3 THEN ttm.briggs_avg END AS briggs_cap_ew,
  ttm.briggs_n
FROM ttm;

COMMENT ON VIEW cm_gov_nm_vs_market_m IS
  'NM vs Market TTM cap (gov). 2026-08-29: CONFIRMED-CAP SINGLE-PASS basis. '
  'Cap pool excludes implausible_unverified AND rolled_forward_escalated (projected-rent) — '
  'confirmed transaction caps only. nm_cap_rate/market_cap_rate = single-pass trailing-24-month '
  'SIMPLE averages (0.04-0.12, market excludes Northmarq); the prior 5-quarter centered smoothing '
  'pass is REMOVED. *_wtd = 24-mo dollar-weighted (reference). nm_cap_ttm12/market_cap_ttm12 = '
  '12-mo TTM simple averages (reference, uncharted). briggs_cap_ew = Team Briggs (%Briggs% broker) '
  '24-mo equal-weight (reference). nm_n/mkt_n/briggs_n = 24-mo counts.';
