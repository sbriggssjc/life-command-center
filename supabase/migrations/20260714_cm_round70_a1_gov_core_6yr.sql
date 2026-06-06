-- Migration: gov — Round 70 Layer A1: gov "core" cohort = firm_term_years >= 6
-- Project: government (scknotsqkcheojiaewwh). Applied live + committed (CM views
-- are read per-request, no deploy needed).
--
-- Scott (June-6 review): "for government, our core definition is 6+ years of
-- firm term as the cohort, not 10+." The gov core-overlay cohort is the
-- cap_10plus_* columns in cm_gov_market_quarterly (+ _master_m), which drive
-- the core average-cap line and pace_core (cost_of_capital mapper -> pace).
-- Only the firm-term FILTER changes (>10 / >=10 -> >=6). Column NAMES are kept
-- (cap_10plus_year / cap_10plus etc.) so the cost_of_capital/pace_core mapper
-- and the _mat consumer keep working with no JS redeploy; the names are now a
-- documented misnomer for "core (6+ firm yr)".
--
-- NOT touched (deliberate, matching Scott's exact enumeration of "core"
-- consumers = dots / avail-market core avg / core asking quartiles):
--   * cm_gov_core_cap_dot_q              -- already firm_term_years >= 6.
--   * the gov cap-by-term LADDER          -- reads the separate
--     cm_gov_cap_by_term view; its <5 / 5-10 / 10+ buckets are unaffected.
--   * cm_gov_net_lease_spread_q (10+ NM)  -- "long-term NM spread", not "core".
--   * cm_gov_seller_sentiment_m (10+ LT)  -- "long-term sentiment", not "core".
--
-- Before/after receipt (gov, subspecialty=all, raw core cohort n / avg cap;
-- the view's own n>=3 render gate is a separate Layer-B depth item):
--   2024-03-31:  >10  n=2 avg 6.56%   ->   >=6  n=4 avg 6.93%
--   2024-06-30:  >10  n=2 avg 7.23%   ->   >=6  n=5 avg 7.23%
--   2024-12-31:  >10  n=2 avg 7.65%   ->   >=6  n=3 avg 7.52%
--   2025-12-31:  >10  n=0 (null)      ->   >=6  n=1 avg 8.00%
--
-- Reproducible in filename order: the base views are created by their earlier
-- migrations; this patch flips only the core-cohort firm-term predicate, so the
-- SELECT list (column order/names/types) is unchanged and dependents are safe.
-- Idempotent: re-running finds no >10/>=10 core predicate to replace (no-op).

DO $r70a1$
DECLARE d text;
BEGIN
  -- Quarterly view (feeds cm_gov_cap_quartile_q + realCharts gov core consumers)
  d := pg_get_viewdef('public.cm_gov_market_quarterly'::regclass);
  d := replace(d,
        'expanded.firm_term_years > (10)::numeric',
        'expanded.firm_term_years >= (6)::numeric');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_market_quarterly AS ' || d;

  -- Monthly master_m view (the view the gov export fetches for pace_core etc.)
  d := pg_get_viewdef('public.cm_gov_market_quarterly_master_m'::regclass);
  d := replace(d,
        'ttm_per_month.firm_term_years >= (10)::numeric',
        'ttm_per_month.firm_term_years >= (6)::numeric');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_market_quarterly_master_m AS ' || d;
END $r70a1$;

-- Parity: the _mat reads cap_10plus from the master_m view above.
REFRESH MATERIALIZED VIEW public.cm_gov_market_quarterly_master_m_mat;
