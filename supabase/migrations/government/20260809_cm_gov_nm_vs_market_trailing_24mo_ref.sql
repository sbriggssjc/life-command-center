-- ============================================================================
-- CM chart fixes round 3, item 6 — gov NM vs Market: append 12-month TTM
-- reference columns. Target: Government (scknotsqkcheojiaewwh)
-- ============================================================================
-- gov's charted nm_cap_rate/market_cap_rate are ALREADY trailing-24-month simple
-- averages (see 20260809_cm_gov_nm_vs_market_simple_avg.sql), so item 6's charted
-- basis is already satisfied here. This migration only APPENDS the 12-month TTM
-- simple averages as reference columns (nm_cap_ttm12 / market_cap_ttm12,
-- uncharted) so the Data_NM_vs_Market sheet carries the same reference columns as
-- dia. Additive/reversible; live immediately.
-- ============================================================================

CREATE OR REPLACE VIEW cm_gov_nm_vs_market_m AS
WITH spine AS (
  SELECT DISTINCT period_end, subspecialty FROM cm_gov_market_quarterly_master_m_mat
),
sales AS (
  SELECT s.sale_date, s.sold_price,
         CASE WHEN s.cap_rate_quality = 'implausible_unverified' THEN NULL ELSE s.sold_cap_rate END AS cap,
         COALESCE(s.is_northmarq, false) AS is_nm
  FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL AND s.sold_price > 0
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
         count(*) FILTER (WHERE NOT sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS mkt_n,
         -- 12-month TTM subset of the 24-month join window (reference, uncharted)
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
         CASE WHEN ttm.nm_n12  >= 3 THEN ttm.nm_avg12  END AS nm_g12,
         CASE WHEN ttm.mkt_n12 >= 3 THEN ttm.mkt_avg12 END AS mkt_g12,
         ttm.nm_n, ttm.mkt_n
  FROM ttm
)
SELECT g.period_end, g.subspecialty,
       avg(g.nm_g)  OVER w AS nm_cap_rate,
       avg(g.mkt_g) OVER w AS market_cap_rate,
       avg(g.nm_wg)  OVER w AS nm_cap_wtd,
       avg(g.mkt_wg) OVER w AS market_cap_wtd,
       g.nm_n, g.mkt_n,
       avg(g.nm_g12)  OVER w AS nm_cap_ttm12,
       avg(g.mkt_g12) OVER w AS market_cap_ttm12
FROM gated g
WINDOW w AS (PARTITION BY g.subspecialty ORDER BY g.period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING);

COMMENT ON VIEW cm_gov_nm_vs_market_m IS
  'NM vs Market TTM cap (gov). nm_cap_rate/market_cap_rate = trailing-24-month SIMPLE averages (0.04-0.12, market excludes Northmarq) — round-3 item 6. *_wtd = 24-mo dollar-weighted (reference). nm_cap_ttm12/market_cap_ttm12 = 12-mo TTM simple averages (reference, uncharted). nm_n/mkt_n = 24-mo counts.';
