-- UW#7 (2026-06-21): developer resolution from the ownership chain — LCC Opps.
--
-- The developer-chain-resolve worker writes gov.properties.developer THROUGH the
-- provenance gate (shouldWriteField -> lcc_merge_field) tagged source='chain_resolution'.
-- Register that source in field_source_priority so:
--   (1) the write is ranked (priority 30 — DERIVED-but-confident: below
--       manual_decision/edit=1, recorded_deed=3, county_records=10, gsa_lessor=20,
--       but ABOVE the aggregators costar/rca=50 and om_extraction=60), and
--   (2) v_field_provenance_unranked stays at 0 (no drift) for the one field it writes.
--
-- enforce_mode='record_only' — chain_resolution NEVER blocks/clobbers; the worker
-- additionally guards the write to developer IS NULL (fill-blanks), so a curated
-- developer is always preserved. Additive + idempotent (ON CONFLICT DO NOTHING).

BEGIN;

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
VALUES
  ('gov.properties', 'developer', 'chain_resolution', 30, 0,
   'record_only',
   'UW#7 ownership-chain origin (BTS-by-construction or explicit development entity). '
   || 'Worker writes fill-blanks (developer IS NULL) only; never clobbers a curated developer.')
ON CONFLICT (target_table, field_name, source) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- Gentle daily cron — drains a capped batch of queued
-- trace_ownership_to_developer tasks through the worker. NO-OPS until the
-- endpoint ships on the Railway redeploy (POST 404s gracefully — same posture as
-- lcc-folder-feed / lcc-artifact-offload). Runs at 05:40, AFTER the R6 chain
-- research-task generator (05:10) so newly-queued tasks are present. The worker
-- reads gov.ownership_history directly (not the owner-facts mirror), so it does
-- NOT depend on the 04:50/55 mirror refresh.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-uw7-developer-chain')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-uw7-developer-chain');
    PERFORM cron.schedule(
      'lcc-uw7-developer-chain',
      '40 5 * * *',
      $cron$SELECT public.lcc_cron_post('/api/developer-chain-resolve-tick?domain=gov&limit=25', '{}'::jsonb, 'vercel')$cron$
    );
  END IF;
END $$;
