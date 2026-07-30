-- ============================================================================
-- 2026-07-30 — W3.7b: server-side SF file DISCOVER cron (Dialysis_DB)
-- Dialysis_DB (ref zqzrriwuavgrquhisnoa)
--
-- ⚠️ APPLY-AFTER-DEPLOY. Mirror of the government discover cron. Schedules the
-- intake-salesforce-files edge function's NEW ?action=discover; apply ONLY after
-- that edge function is redeployed with the discover action (deploy-ordering).
--
-- discover sweeps ContentDocumentLink/ContentVersion for staged Comp/Listing/Deal
-- records and records new files into sf_files (ingestion_status='discovered').
-- fetch + stage-queued then store + extract. Clean no-op (200, configured:false)
-- until the SF Connected App creds are set on the dia edge env.
--
-- NOTE on dia: its sf_comp_staging rows currently carry no sf_listing_id/sf_deal_id,
-- so listing/deal-attached files won't be reachable through the comp→listing
-- traversal yet; discovering them still populates the sf_files corpus for when
-- comp↔listing linkage grows. Idempotent (upsert by name); reversible (unschedule).
-- ============================================================================
SELECT cron.schedule(
  'sf-files-discover-hourly',
  '35 * * * *',
  $cron$
  select net.http_post(
    url := 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/intake-salesforce-files?action=discover',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-PA-Webhook-Secret', 'f276b9065a855ed500f39eb55eb31721073863498fcf28b7'
    ),
    body := jsonb_build_object('vertical', 'dia', 'object_types', jsonb_build_array('listing','deal'), 'limit', 500)
  );
  $cron$
);
