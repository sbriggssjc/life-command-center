-- CM gov capital-markets: keep the master_m materialized cache current (2026-08-14)
-- Applied live to the Government project (scknotsqkcheojiaewwh).
--
-- ROOT CAUSE (data half)
-- `cm_gov_market_quarterly_master_m_mat` is a MATERIALIZED view with no refresh
-- schedule (only migrations ever REFRESHed it). It was frozen at 2026-03-31 (Q1)
-- while the live plain view `cm_gov_market_quarterly_master_m` and the underlying
-- `sales_transactions` had advanced to 2026-06-30 (Q2). Every per-template
-- `cm_gov_*_m` view reads the stale mat, so ~15 monthly TTM charts + the export's
-- Data_* tabs showed Q1 data under a Q2 title. dia is unaffected:
-- `cm_dialysis_market_quarterly_master_m` is a plain (live) view, no mat.
--
-- FIX (this migration): schedule a recurring CONCURRENT refresh of the mat so it
-- can never silently fall a quarter behind again. The mat carries a UNIQUE index
-- on (subspecialty, period_end), so CONCURRENTLY is safe and non-blocking.
-- cron.schedule is idempotent by jobname (re-running updates the schedule).
--
-- NOTE: this migration deliberately does NOT touch cm_report_snapshots. The frozen
-- packet is the serving layer for both the in-app CM display and the workbook
-- export; deleting a snapshot forces a live rebuild on the request path, and the
-- gov live packet build is heavy enough that a request-time rebuild can time out
-- and freeze a degraded packet (dropped/empty charts). Snapshot freshness must be
-- driven by a reliable OFF-request rebuild (see the packet-refresh follow-up), not
-- by cache invalidation.

SELECT cron.schedule(
  'cm-gov-master-m-mat-refresh',
  '40 8 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.cm_gov_market_quarterly_master_m_mat$$
);

-- REVERSAL: SELECT cron.unschedule('cm-gov-master-m-mat-refresh');
