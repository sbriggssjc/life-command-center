-- ============================================================================
-- ORE multi-signal reconciliation — the PURE-DB maintenance crons.
-- LCC Opps. Additive · reversible (unschedule the two jobs → zero trace).
-- ----------------------------------------------------------------------------
-- Two SAFE, pure-DB crons ship now:
--   1. lcc-owner-evidence-cache-refresh (hourly :34) — keeps the resolver's
--      candidate universe fresh (the R7 cache pattern; a stalled refresh only
--      costs YIELD, never correctness).
--   2. lcc-owner-reconcile-seed (daily 06:20) — the "owner touched → reconcile"
--      producer: enqueues owners whose evidence changed recently, WITHOUT a
--      hot-path trigger (the R7 connection-budget lesson).
--
-- The DRAIN worker cron (which CONSOLIDATES entities via lcc_merge_entity) is
-- deliberately NOT scheduled here — a consequential auto-merge must run a capped
-- gated dry-run → capped real drain first (the owner-deed-autofix / UW#2 posture).
-- Schedule `lcc-owner-reconcile-engine` (POST /api/owner-reconcile-engine-tick)
-- only AFTER that gate, e.g.:
--   SELECT cron.schedule('lcc-owner-reconcile-engine', '50 6 * * *',
--     $$SELECT public.lcc_cron_post('/api/owner-reconcile-engine-tick?source=queue&limit=100', '{}'::jsonb, 'vercel')$$);
-- ============================================================================

SELECT cron.unschedule('lcc-owner-evidence-cache-refresh')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-owner-evidence-cache-refresh');
SELECT cron.schedule('lcc-owner-evidence-cache-refresh', '34 * * * *',
  $$SELECT public.lcc_refresh_owner_evidence_cache();$$);

SELECT cron.unschedule('lcc-owner-reconcile-seed')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-owner-reconcile-seed');
SELECT cron.schedule('lcc-owner-reconcile-seed', '20 6 * * *',
  $$SELECT public.lcc_seed_owner_reconcile_queue(interval '2 days', 500);$$);
