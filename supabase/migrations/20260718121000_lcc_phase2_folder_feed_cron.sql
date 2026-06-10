-- ============================================================================
-- Phase 2 — schedule the folder-feed tick (LCC Opps)
-- 2026-06-09 (intelligence-hub architecture, Phase 2, Slice 1)
--
-- Walks a bounded set of Team Briggs SharePoint folders, stages new/changed
-- OM/flyer PDFs through the SAME stageOmIntake promoter as the email channel,
-- and records what it saw in folder_feed_seen (DB-only — nothing written into
-- the team tree). See api/_handlers/folder-feed.js.
--
-- Cadence: every 30 minutes — GENTLE, per the artifact-offload lesson (the
-- every-5-min variant exhausted the 60-connection LCC Opps tier). The worker is
-- time-budgeted (~22s) and bounded (limit_folders), so each tick is light. With
-- SHAREPOINT_LIST_URL unset the endpoint no-ops, so this cron is harmless until
-- the PA "List folder" flow is wired — apply order is irrelevant.
--
-- The endpoint 404s on Railway until api/intake.js (+ the folder-feed handler)
-- ships, so verify post-deploy with a GET dry-run before relying on the cron —
-- same go-live posture as lcc-artifact-offload.
--
-- Idempotent (unschedule-then-schedule). Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-folder-feed');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Vercel/Railway target: lcc_cron_post POSTs to <base>/api/folder-feed-tick
    -- with Authorization: Bearer <vault.lcc_api_key>. POST = drain. The folder
    -- roots come from FOLDER_FEED_ROOTS (env) or the handler defaults; bound the
    -- per-tick work with limit_folders in the query string.
    PERFORM cron.schedule(
      'lcc-folder-feed',
      '*/30 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/folder-feed-tick?limit_folders=8', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
