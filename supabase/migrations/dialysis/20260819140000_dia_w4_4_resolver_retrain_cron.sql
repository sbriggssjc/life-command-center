-- ============================================================================
-- W4.4 (2026-07-31): nightly resolver retrain cron.
--
-- Runs on Dialysis_DB (zqzrriwuavgrquhisnoa) — the project that has pg_cron +
-- pg_net AND holds the w41-corpus-export + w44-retrain-tick edge functions and
-- gov/dia/ops creds. Mirrors the sf-files-stage-queued-15m pattern: pg_cron
-- net.http_post to an edge function under X-PA-Webhook-Secret (hardcoded inline —
-- same secret + project as the existing sf-files crons). NEVER GitHub Actions.
--
-- w44-retrain-tick (in-sequence): refresh corpus (w41-corpus-export?action=export)
-- → POST the Railway resolver /train for owner_owner/owner_sf/contact → record +
-- alarm via the ops RPC lcc_record_resolver_retrain. A failed corpus refresh does
-- NOT train (the edge fn enforces order). Nightly 07:30 UTC (after the 03:xx gov +
-- 05:00 LCC owner-contact pulls, so the day's sf_link_review verdicts are in the
-- corpus).
--
-- ⚠️ Until the w44-retrain-tick function is DEPLOYED and RESOLVER_URL is set on the
-- Dialysis_DB edge secrets, this POST 404s / the tick opens a (deduped)
-- resolver_retrain_failure alert — harmless, and the honest cue that setup is
-- incomplete (mirrors the W2.5 flush crons that 404 until their handler ships, and
-- the SAM cron that no-ops until its key is set). See
-- docs/resolver/RUNBOOK_railway_resolver_service.md §7 (operator steps).
--
-- Idempotent (cron.schedule upserts by name). REVERSAL:
--   SELECT cron.unschedule('w44-resolver-retrain-nightly');
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('w44-resolver-retrain-nightly'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'w44-resolver-retrain-nightly',
      '30 7 * * *',
      $cron$
      select net.http_post(
        url := 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/w44-retrain-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-PA-Webhook-Secret', 'f276b9065a855ed500f39eb55eb31721073863498fcf28b7'
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END $$;
