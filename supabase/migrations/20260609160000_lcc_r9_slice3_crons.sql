-- R9 Slice 3 crons (2026-06-09) — APPLY POST-DEPLOY ONLY.
-- ===========================================================================
-- ⚠️ DEPLOY ORDERING (the artifact-offload / "cron + endpoint go live together"
-- rule): the classify cron POSTs to /api/chain-classify-tick, which 404s until
-- api/admin.js + server.js ship on the Railway redeploy of merged `main`.
-- DO NOT apply this migration ahead of that deploy. Verify post-deploy with a
-- GET dry-run (`/api/chain-classify-tick`) before relying on the cron.
--
-- Two crons:
--   * lcc-r9-chain-classify  (every 6h) — drains the developer classifier
--     (Signal A named_developer; mint-or-find via ensureEntityLink, tag
--     behavioral_override='developer'). limit=25/tick; the self-excluding view
--     makes it idempotent and self-draining (~193 mint-required clear over a
--     few ticks, then it just classifies new developer_name arrivals).
--   * lcc-r9-chain-reconcile (daily 04:35 UTC) — completes open
--     trace_ownership_to_developer research_tasks whose property is now
--     chain_complete. Pure SQL (no route dependency), but registered here with
--     its sibling for one coherent post-deploy step.
-- Distinct dollar-quote tags (the R6 nested-$$ cron lesson).

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-r9-chain-classify') THEN
      PERFORM cron.unschedule('lcc-r9-chain-classify');
    END IF;
    PERFORM cron.schedule('lcc-r9-chain-classify', '15 */6 * * *',
      $job$SELECT public.lcc_cron_post('/api/chain-classify-tick?limit=25', '{}'::jsonb, 'vercel')$job$);

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-r9-chain-reconcile') THEN
      PERFORM cron.unschedule('lcc-r9-chain-reconcile');
    END IF;
    PERFORM cron.schedule('lcc-r9-chain-reconcile', '35 4 * * *',
      $job$SELECT public.lcc_reconcile_chain_research_tasks(1000)$job$);
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule lcc-r9-chain-classify / -reconcile manually.';
  END IF;
END
$cron$;
