-- CM final closeout T7-U2 (2026-06-28) — extend the shared gov market master
-- window 2001-01 -> 1997-01 so the gov RETURNS INDEX (cm_gov_returns_indexes_m,
-- chart cash_leveraged_returns) reaches back to ~1997. Applied live to the gov DB
-- (scknotsqkcheojiaewwh) + REFRESHed the materialized cm_gov_market_quarterly_master_m_mat.
--
-- Consumer audit (1997-2000 gov data is DENSE: n=27-48 sales/TTM, cap 12/12 non-null):
--   * cash_leveraged_returns (returns index) -> extends to 1997 (the intended change)
--   * volume_ttm / count_ttm / avg_deal / cap_ttm / nm_vs_market -> CLAMPED back to
--     2001 in cm-native-chart-injector.js MIN_YEAR_BY_TEMPLATE (no scope-creep on the
--     other established gov charts; clamp is a no-op for dia/natl which start >= 2001).
--   * cap_by_credit (2000), cap_quartile (2007), yoy (2005), net_lease_spread (2002),
--     bid_ask (density), dom_pct_ask (2018), cost_of_capital (density) -> already
--     gated by their own static/density floors, unaffected.
--
-- Reversible: replace '1997-01-01' back to '2001-01-01' + REFRESH.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_viewdef('public.cm_gov_market_quarterly_master_m'::regclass, true);
  IF position('''1997-01-01''::date' IN d) > 0 THEN
    RAISE NOTICE 'already 1997'; RETURN;
  END IF;
  d := replace(d, '''2001-01-01''::date', '''1997-01-01''::date');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_market_quarterly_master_m AS ' || d;
END $$;
REFRESH MATERIALIZED VIEW public.cm_gov_market_quarterly_master_m_mat;
