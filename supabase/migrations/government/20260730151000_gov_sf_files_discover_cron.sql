-- ============================================================================
-- 2026-07-30 — W3.7b: server-side SF file DISCOVER cron (Government)
-- Government DB (ref scknotsqkcheojiaewwh)
--
-- ⚠️ APPLY-AFTER-DEPLOY. This schedules the intake-salesforce-files edge
-- function's NEW ?action=discover. Apply ONLY after that edge function has been
-- redeployed with the discover action (deploy-ordering doctrine: the caller must
-- exist before the schedule points at it). Applying earlier would POST to an
-- action the deployed function doesn't yet know (HTTP 400) every hour.
--
-- discover sweeps ContentDocumentLink/ContentVersion for staged Comp/Listing/Deal
-- records and records new files into sf_files (ingestion_status='discovered').
-- The existing sf-files fetch + stage-queued chain then stores + extracts them.
-- It is a clean no-op (200, configured:false) until the SF Connected App creds
-- (SF_INSTANCE_URL/SF_CLIENT_ID/SF_CLIENT_SECRET) are set on the edge env, so a
-- premature schedule is harmless once the action exists.
--
-- Idempotent (cron.schedule upserts by name). Reversible: cron.unschedule.
-- ============================================================================
SELECT cron.schedule(
  'sf-files-discover-hourly',
  '35 * * * *',
  $cron$
  select net.http_post(
    url := 'https://scknotsqkcheojiaewwh.supabase.co/functions/v1/intake-salesforce-files?action=discover',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-PA-Webhook-Secret', 'f276b9065a855ed500f39eb55eb31721073863498fcf28b7'
    ),
    body := jsonb_build_object('vertical', 'gov', 'object_types', jsonb_build_array('listing','deal'), 'limit', 500)
  );
  $cron$
);
