-- CM final closeout T11 (2026-06-28) — align the NM-vs-market "market" line to
-- the SAME basis as the headline Cap-TTM-Avg (cm_gov_cap_ttm_m.ttm_weighted_cap_rate)
-- so the two charts move together. Previously market_cap_rate was a DIVERGENT basis
-- (2-yr window, brokered-non-NM only, +5-period centered smoothing) which is why it
-- didn't track the main cap chart. Now market_cap_rate IS the headline TTM avg cap
-- (1-yr TTM, all market deals, n>=10 gate). The NM line keeps its NM-attribution
-- computation (2-yr NM avg, n>=3 gate, 5-period smoothed). Verified live: market
-- now equals the headline exactly at every spot period (e.g. 2026-03 = 0.0799).
-- Applied live to gov (scknotsqkcheojiaewwh). Reversible: restore the prior body
-- (2-yr brokered-non-NM mkt_avg). Column shape unchanged.
CREATE OR REPLACE VIEW public.cm_gov_nm_vs_market_m AS
WITH spine AS (
  SELECT DISTINCT period_end, subspecialty FROM cm_gov_market_quarterly_master_m_mat
), sales AS (
  SELECT s.sale_date,
    CASE WHEN s.cap_rate_quality = 'implausible_unverified' THEN NULL::numeric ELSE s.sold_cap_rate END AS cap,
    COALESCE(s.is_northmarq, false) AS is_nm
  FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)
), ttm AS (
  SELECT sp.period_end, sp.subspecialty,
    avg(sl.cap) FILTER (WHERE sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS nm_avg,
    count(*) FILTER (WHERE sl.is_nm AND sl.cap >= 0.04 AND sl.cap <= 0.12) AS nm_n
  FROM spine sp
  LEFT JOIN sales sl ON sl.sale_date > (sp.period_end - interval '2 years')::date AND sl.sale_date <= sp.period_end
  GROUP BY sp.period_end, sp.subspecialty
), gated AS (
  SELECT period_end, subspecialty,
    CASE WHEN nm_n >= 3 THEN nm_avg ELSE NULL::numeric END AS nm_gated
  FROM ttm
)
SELECT g.period_end, g.subspecialty,
  avg(g.nm_gated) OVER w AS nm_cap_rate,
  cm.ttm_weighted_cap_rate AS market_cap_rate
FROM gated g
LEFT JOIN cm_gov_cap_ttm_m cm ON cm.period_end = g.period_end AND cm.subspecialty = g.subspecialty
WINDOW w AS (PARTITION BY g.subspecialty ORDER BY g.period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING);
