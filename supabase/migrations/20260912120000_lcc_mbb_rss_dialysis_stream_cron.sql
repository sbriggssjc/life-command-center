-- ============================================================================
-- MB-b — point the dialysis lane's P-RSS cron at the new `dialysis` RSS
-- stream (supabase/functions/briefing-intel-snapshot/index.ts RSS_FEEDS),
-- instead of the generic `healthcare` stream that carries no dialysis
-- content most days (spec §9 "MB-a3 reconcile" addendum: "P-RSS: Ollama
-- reachable from Railway, 0 facts — the healthcare stream has no dialysis
-- content, so P-RSS value depends on lane-specific feeds").
--
-- Additive only: the tick handler (market-brief-rss-tick.js) already reads
-- `?stream=` on the request body/query (defaulting to 'healthcare' when
-- absent), so this migration changes NOTHING but the cron.job command —
-- an operator hitting the endpoint directly with no `stream` still gets the
-- old default, unchanged.
--
-- REVERSAL RUNBOOK: re-run the block below with 'healthcare' in place of
-- 'dialysis' in the lcc_cron_post payload (restores the MB-a2 command
-- verbatim), or `SELECT cron.unschedule('lcc-market-brief-rss');` and
-- re-apply 20260911180000_lcc_mba_market_brief_producers.sql's cron block.
-- ============================================================================

DO $cronblock$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-market-brief-rss') THEN
    PERFORM cron.unschedule('lcc-market-brief-rss');
  END IF;

  PERFORM cron.schedule(
    'lcc-market-brief-rss',
    '10 10 * * *',
    $$SELECT public.lcc_cron_post('/api/market-brief-rss-tick', '{"trigger_source":"cron","lane":"dialysis","stream":"dialysis"}'::jsonb, 'railway');$$
  );
END
$cronblock$;
