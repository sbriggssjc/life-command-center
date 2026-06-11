-- ============================================================================
-- Phase 2 Slice 2f — On Market ingest rides the durable frontier cursor (LCC Opps)
-- 2026-06-11
--
-- The legacy ingest cron (`lcc-folder-feed`, `/api/folder-feed-tick?limit_folders=8`)
-- restarted its BFS from the roots every tick (queue = rootList.slice()) and was
-- bounded to 8 folders, so it only ever re-walked the top On Market folders and
-- never descended to the deep subfolders where 71 OMs sat stuck in
-- folder_feed_seen.status='seen' (deferred). This is the same no-cursor bug
-- Slice 2d fixed for ENRICH — the INGEST path is now migrated onto the same
-- folder_feed_frontier cursor (which already carries a `mode` column).
--
-- Changes:
--   • RETIRE `lcc-folder-feed` — the cursorless limit_folders=8 ingest tick is
--     superseded by the frontier crawl below.
--   • SCHEDULE `lcc-folder-feed-crawl-ingest` — drives the worker in FRONTIER
--     mode for the On Market (ingest) roots (`&mode=ingest`). Each tick pops a
--     bounded set of pending frontier folders, descends one BFS level, and stages
--     OMs via the SAME stageOmIntake ingest path. Successive ticks descend the
--     whole tree; the deferred 'seen' rows re-stage once the frontier reaches
--     their folder. ONE mode per tick keeps the ingest budget separate from the
--     enrich crawl (Slice 2a.1 lesson).
--
-- The enrich crawl (`lcc-folder-feed-crawl`, mode unset → enrich default) is
-- UNCHANGED. Cadence is GENTLE (the artifact-offload lesson) and offset from the
-- enrich crawl (:10/:40) to :00/:30 so the two folder-feed workers don't contend.
--
-- The endpoint no-ops until SHAREPOINT_LIST_URL is set and 404s until intake.js
-- ships on Railway, so apply order is irrelevant — verify post-deploy with a GET
-- dry-run (same posture as lcc-folder-feed / lcc-artifact-offload).
--
-- No schema migration is required: folder_feed_frontier already allows
-- mode='ingest' and folder_feed_seen already allows status='skipped'.
--
-- Idempotent (unschedule-then-schedule). Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Retire the legacy cursorless ingest tick (re-walked roots, bounded to 8).
    BEGIN PERFORM cron.unschedule('lcc-folder-feed');               EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('lcc-folder-feed-crawl-ingest');  EXCEPTION WHEN OTHERS THEN NULL; END;

    -- On Market ingest now rides the frontier cursor (mode=ingest).
    PERFORM cron.schedule(
      'lcc-folder-feed-crawl-ingest',
      '0,30 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/folder-feed-tick?source=frontier&mode=ingest&limit_folders=10', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
