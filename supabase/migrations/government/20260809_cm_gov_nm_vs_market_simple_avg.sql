-- ============================================================================
-- CM chart feedback item #4 (B1/B2) — gov NM vs Market cap: consistent SIMPLE-avg
-- Target: Government (scknotsqkcheojiaewwh)
-- ============================================================================
-- Mirror of the dia fix. gov's NM leg was ALREADY a simple average, but its
-- MARKET leg pulled cm_gov_cap_ttm_m.ttm_weighted_cap_rate — a DOLLAR-WEIGHTED,
-- WHOLE-market TTM (not Northmarq-excluded). So the two plotted legs still used
-- inconsistent bases (simple NM vs weighted whole-market).
--
-- Fix: both legs = SIMPLE TTM average of qualifying caps (0.04-0.12 band, 2-yr
-- TTM). market_cap_rate now EXCLUDES Northmarq deals (non-NM = market). The
-- dollar-weighted equivalents are kept as nm_cap_wtd / market_cap_wtd (audit,
-- not charted); nm_n / mkt_n exposed for gating + the display_from registry.
-- gov non-NM sample is dense (68-216 sales/yr) so the 2-yr TTM easily clears
-- the n>=3 gate. Additive/reversible CREATE OR REPLACE VIEW; revert = restore
-- the prior body (market from cm_gov_cap_ttm_m). Live immediately.
-- ============================================================================

CREATE OR REPLACE VIEW cm_gov_nm_vs_market_m AS
WITH spine AS (
  SELECT DISTINCT period_end, subspecialty FROM cm_gov_market_quarterly_master_m_mat
),
sales AS (
  SELECT s.sale_date,
         s.sold_price,
         CASE WHEN s.cap_rate_quality = 'implausible_unverified' THEN NULL ELSE s.sold_cap_rate END AS cap,
         COALESCE(s.is_northmarq, false) AS is_nm
  FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL
    AND s.sold_price > 0
    AND NOT COALESCE(s.exclude_from_market_metrics, false)
),
ttm AS (
  SELECT sp.period_end, sp.subspecialty,
         avg(sl.cap) FILTER (WHERE sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS nm_avg,
         avg(sl.cap) FILTER (WHERE NOT sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS mkt_avg,
         sum(sl.sold_price * sl.cap) FILTER (WHERE sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS nm_wsum,
         sum(sl.sold_price)          FILTER (WHERE sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS nm_psum,
         sum(sl.sold_price * sl.cap) FILTER (WHERE NOT sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS mkt_wsum,
         sum(sl.sold_price)          FILTER (WHERE NOT sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS mkt_psum,
         count(*) FILTER (WHERE sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS nm_n,
         count(*) FILTER (WHERE NOT sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS mkt_n
  FROM spine sp
  LEFT JOIN sales sl
    ON sl.sale_date > (sp.period_end - '2 years'::interval)::date
   AND sl.sale_date <= sp.period_end
  GROUP BY sp.period_end, sp.subspecialty
),
gated AS (
  SELECT ttm.period_end, ttm.subspecialty,
         CASE WHEN ttm.nm_n  >= 3 THEN ttm.nm_avg  END AS nm_g,
         CASE WHEN ttm.mkt_n >= 3 THEN ttm.mkt_avg END AS mkt_g,
         CASE WHEN ttm.nm_n  >= 3 THEN ttm.nm_wsum  / NULLIF(ttm.nm_psum,  0) END AS nm_wg,
         CASE WHEN ttm.mkt_n >= 3 THEN ttm.mkt_wsum / NULLIF(ttm.mkt_psum, 0) END AS mkt_wg,
         ttm.nm_n, ttm.mkt_n
  FROM ttm
)
SELECT g.period_end, g.subspecialty,
       avg(g.nm_g)  OVER w AS nm_cap_rate,      -- SIMPLE avg (charted)
       avg(g.mkt_g) OVER w AS market_cap_rate,  -- SIMPLE avg, NM-excluded (charted)
       avg(g.nm_wg)  OVER w AS nm_cap_wtd,       -- $-weighted (reference)
       avg(g.mkt_wg) OVER w AS market_cap_wtd,   -- $-weighted (reference)
       g.nm_n, g.mkt_n
FROM gated g
WINDOW w AS (PARTITION BY g.subspecialty ORDER BY g.period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING);

COMMENT ON VIEW cm_gov_nm_vs_market_m IS
  'NM vs Market TTM cap (gov). Both legs SIMPLE averages of qualifying caps (0.04-0.12, 2-yr TTM); market excludes Northmarq deals. *_wtd = dollar-weighted equivalents (reference, not charted). nm_n/mkt_n = TTM qualifying counts. CM feedback item #4 (2026-08).';
