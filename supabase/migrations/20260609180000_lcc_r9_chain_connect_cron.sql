-- R9 follow-up (2026-06-09): chain-connect cron — drive the connect drain.
-- ===========================================================================
-- The chain-connection worker (api/admin.js handleChainConnectTick ->
-- /api/chain-connect-tick) had NO cron after the R9 close-out: the classify
-- and reconcile crons landed in 20260609160000, but connect was left manual.
-- The chain-property universe is gov ~3,047 / dia ~574 incomplete-chain rows;
-- at a manual 10/tick it never drains. This registers the missing cron.
--
-- DEPLOY ORDERING: SAFE TO APPLY IMMEDIATELY. Unlike the classify cron, the
-- /api/chain-connect-tick route is ALREADY LIVE (shipped in the R9 Slice 2/3
-- Railway deploy), so there is no endpoint-404 hold here. The ledger cursor
-- (lcc_chain_connection_log) makes every re-tick idempotent and the worker is
-- wall-clock budgeted (CHAIN_TICK_BUDGET_MS, default 20s), so a stalled or
-- overlapping tick only ever costs latency, never correctness.
--
-- Cadence: every 30 min, domain=both & limit=10 per domain (= up to 10 dia +
-- 10 gov properties per tick). limit=10 is the proven-safe batch — limit=25
-- through the lcc_cron_post -> pg_net -> Vercel proxy hit gateway timeouts
-- during R9 testing. domain=both halves the wall-clock drain time vs single-
-- domain ticks; the 20s budget guard stops cleanly between properties if a
-- both-domain tick runs long (a logged property is always fully walked, so a
-- budget cut never half-connects a property — see handleChainConnectTick).
--
-- Distinct dollar-quote tag (the R6 nested-$$ cron lesson).
-- DB-safety: additive, idempotent (unschedule-then-schedule), no auth-schema
-- contact, no long locks.

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-r9-chain-connect') THEN
      PERFORM cron.unschedule('lcc-r9-chain-connect');
    END IF;
    PERFORM cron.schedule('lcc-r9-chain-connect', '*/30 * * * *',
      $job$SELECT public.lcc_cron_post('/api/chain-connect-tick?domain=both&limit=10', '{}'::jsonb, 'vercel')$job$);
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule lcc-r9-chain-connect manually.';
  END IF;
END
$cron$;
