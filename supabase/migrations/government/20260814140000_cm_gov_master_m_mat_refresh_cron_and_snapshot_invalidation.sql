-- CM gov capital-markets staleness fix (2026-08-14)
-- Applied live to the Government project (scknotsqkcheojiaewwh).
--
-- ROOT CAUSE
-- `cm_gov_market_quarterly_master_m_mat` is a MATERIALIZED view with no refresh
-- schedule (only migrations ever REFRESHed it). It was frozen at 2026-03-31 (Q1)
-- while the live plain view `cm_gov_market_quarterly_master_m` and the underlying
-- `sales_transactions` had advanced to 2026-06-30 (Q2). Every per-template
-- `cm_gov_*_m` view (cap_ttm_m, volume_ttm_m, nm_vs_market_m, net_lease_spread_m,
-- avg_deal_m, count_ttm_m, cap_quartile_m, bid_ask_spread_m, cost_of_capital_m,
-- dom_pct_ask_m, returns_indexes_m, yoy_change_m, …) reads the stale mat — so ~15
-- monthly TTM charts + the export's Data_* tabs showed Q1 data under a Q2 title.
-- dia is unaffected: `cm_dialysis_market_quarterly_master_m` is a plain (live)
-- view, no mat.
--
-- The frozen `cm_report_snapshots` packets (served to BOTH the in-app CM display
-- and the workbook export via buildOrFetchPacket) were built 2026-08-10 off the
-- stale mat, and additionally carried 4 empty charts (cpi_vs_renewal_cagr,
-- lease_renewal_rate, lease_termination_rate, renewal_rent_growth) whose views now
-- return data.
--
-- FIX (DB half; the packet-layer code half lives in api/capital-markets.js +
-- api/_shared/cm-chart-image-renderer.js):
--   1. Schedule a recurring CONCURRENT refresh of the mat so it can never silently
--      fall a quarter behind again. The mat carries a UNIQUE index on
--      (subspecialty, period_end), so CONCURRENTLY is safe + non-blocking. The
--      immediate one-time refresh was run out-of-band (mat now reaches 2026-06-30);
--      pg_cron keeps it current.
--   2. Invalidate the stale frozen gov packets so the next fetch rebuilds them live
--      off the fresh mat (repopulating the empty charts, advancing to Q2).
--      buildOrFetchPacket rebuilds + re-freezes automatically when no row exists.
--      Reversible: deleted rows are snapshotted first.

SELECT cron.schedule(
  'cm-gov-master-m-mat-refresh',
  '40 8 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.cm_gov_market_quarterly_master_m_mat$$
);

CREATE TABLE IF NOT EXISTS public._cm_report_snapshots_backup_20260814 AS
  SELECT * FROM public.cm_report_snapshots
   WHERE vertical = 'gov' AND fiscal_quarter IN ('Q1-2026', 'Q2-2026');

DELETE FROM public.cm_report_snapshots
 WHERE vertical = 'gov' AND fiscal_quarter IN ('Q1-2026', 'Q2-2026');

-- REVERSAL RUNBOOK
--   SELECT cron.unschedule('cm-gov-master-m-mat-refresh');
--   INSERT INTO public.cm_report_snapshots
--     SELECT * FROM public._cm_report_snapshots_backup_20260814
--     ON CONFLICT (vertical, fiscal_quarter) DO NOTHING;
