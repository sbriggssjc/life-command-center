-- ============================================================================
-- CM Export Audit fixes — Government DB (scknotsqkcheojiaewwh)
-- 2026-08-07
--
-- The CM export sheet templates are SHARED across verticals, so the same
-- monthly-vs-quarterly schema drift (audit PART 1 item 3) that nulled the
-- dialysis Data_Returns_Idx / Data_Val_Index columns also affected gov. Two
-- append-only view edits:
--   * cm_gov_returns_indexes_m: add leveraged_return_low / leveraged_return_high
--     (the _m view emitted only cash_return + leveraged_return_mid).
--   * cm_gov_valuation_index_m: add n_sales (alias of ttm_n) — the template's
--     "N Sales (Q)" column read `n_sales`, absent from the _m view.
-- gov has no asking_cap_by_term_m / active_listings_m / rent_box_q views, so
-- items 4 & 5 are dialysis-only.
--
-- Both edits keep every existing column in place and only APPEND at the end
-- (Postgres 42P16 append-only rule). Reversible via git-history definition.
-- ============================================================================

CREATE OR REPLACE VIEW cm_gov_returns_indexes_m AS
WITH raw AS (
  SELECT m.period_end, m.subspecialty,
         CASE WHEN band_n.n >= 4
              THEN ((0.5 * m.avg_cap_rate_ttm)::double precision
                    + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision)
                    + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision))::numeric
              ELSE NULL::numeric END AS cash_return,
         CASE WHEN band_n.n >= 4 AND m.low_loan_constant IS NOT NULL AND m.high_loan_constant IS NOT NULL
              THEN ((((0.5 * m.avg_cap_rate_ttm)::double precision
                    + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision)
                    + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision))
                    - (((m.low_loan_constant + m.high_loan_constant) / 2.0) * 0.5)::double precision) / 0.5::double precision)::numeric
              ELSE NULL::numeric END AS leveraged_return_mid,
         CASE WHEN band_n.n >= 4 AND m.high_loan_constant IS NOT NULL
              THEN ((((0.5 * m.avg_cap_rate_ttm)::double precision
                    + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision)
                    + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision))
                    - (m.high_loan_constant * 0.5)::double precision) / 0.5::double precision)::numeric
              ELSE NULL::numeric END AS leveraged_return_low,
         CASE WHEN band_n.n >= 4 AND m.low_loan_constant IS NOT NULL
              THEN ((((0.5 * m.avg_cap_rate_ttm)::double precision
                    + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision)
                    + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision))
                    - (m.low_loan_constant * 0.5)::double precision) / 0.5::double precision)::numeric
              ELSE NULL::numeric END AS leveraged_return_high
  FROM cm_gov_market_quarterly_master_m_mat m
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM sales_transactions s
    WHERE s.sale_date IS NOT NULL
      AND s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
      AND s.sold_cap_rate >= 0.04 AND s.sold_cap_rate <= 0.12
      AND NOT COALESCE(s.exclude_from_market_metrics, false)
      AND (s.transaction_type IS NULL OR s.transaction_type = ANY (ARRAY['Investment'::text,'Resale'::text,'brokered'::text,'direct'::text,'Owner-User'::text,'Build-to-Suit'::text]))
  ) band_n ON true
)
SELECT period_end, subspecialty, cash_return, leveraged_return_mid, leveraged_return_low, leveraged_return_high
FROM raw ORDER BY subspecialty, period_end;

CREATE OR REPLACE VIEW cm_gov_valuation_index_m AS
WITH g AS MATERIALIZED (
  SELECT period_end, subspecialty, avg_rent_psf, avg_expenses_psf, avg_noi_psf, avg_cap_rate,
         valuation_index, ttm_n, n_with_noi_ttm, n_with_cap_ttm
  FROM cm_gov_valuation_index_gsa_m
), k AS (
  SELECT ((SELECT avg(g2.valuation_index) FROM g g2 WHERE g2.period_end >= '2013-01-01' AND g2.period_end <= '2013-12-31')
          / NULLIF((SELECT avg(mc.valuation_index) FROM cm_gov_valuation_index_master_curated mc WHERE mc.period_end >= '2013-01-01' AND mc.period_end <= '2013-12-31'), 0)) AS k
), unified AS (
  SELECT mc.period_end, 'all'::text AS subspecialty, mc.avg_rent_psf, mc.avg_expenses_psf,
         (mc.avg_rent_psf - mc.avg_expenses_psf) AS avg_noi_psf, mc.avg_cap_rate,
         (mc.valuation_index * (SELECT k.k FROM k)) AS valuation_index,
         NULL::bigint AS ttm_n, NULL::bigint AS n_with_noi_ttm, NULL::bigint AS n_with_cap_ttm, 'master_curated'::text AS source
  FROM cm_gov_valuation_index_master_curated mc WHERE mc.period_end < '2013-01-01'
  UNION ALL
  SELECT g.period_end, g.subspecialty, g.avg_rent_psf, g.avg_expenses_psf, g.avg_noi_psf, g.avg_cap_rate,
         g.valuation_index, g.ttm_n, g.n_with_noi_ttm, g.n_with_cap_ttm, 'gsa_computed'::text AS source
  FROM g WHERE g.valuation_index IS NOT NULL
)
SELECT period_end, subspecialty, avg_rent_psf, avg_expenses_psf, avg_noi_psf, avg_cap_rate, valuation_index,
       ttm_n, n_with_noi_ttm, n_with_cap_ttm,
       CASE WHEN lag(valuation_index, 12) OVER w IS NOT NULL AND lag(valuation_index, 12) OVER w <> 0
            THEN (valuation_index / lag(valuation_index, 12) OVER w) - 1 ELSE NULL::numeric END AS yoy_change_pct,
       (100 * valuation_index / NULLIF((SELECT u.valuation_index FROM unified u WHERE u.valuation_index IS NOT NULL ORDER BY u.period_end LIMIT 1), 0)) AS valuation_index_rebased,
       source,
       ttm_n AS n_sales
FROM unified
WINDOW w AS (ORDER BY period_end)
ORDER BY period_end;
