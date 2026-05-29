-- ============================================================================
-- staged_intake_artifacts inline_data → Storage offload cron (LCC Opps)
--
-- Follow-up to the 2026-05-29 disk-full / read-only sign-in outage. After
-- sf_sync_log was reclaimed, staged_intake_artifacts (~6 GB) became the
-- largest consumer on LCC Opps: large email/copilot OM files are stored as
-- base64 in `inline_data` at ingest (no storage_path). This cron drains
-- those bytes to the lcc-om-uploads Storage bucket and clears inline_data,
-- PRESERVING the file — transparent to readers (extractor + download handler
-- fall back to storage_path).
--
-- Worker: api/admin.js handleArtifactOffload, exposed as
-- /api/artifact-offload (GET = dry-run, POST = drain). The handler is
-- idempotent and non-destructive on partial failure (uploads with
-- x-upsert to a deterministic per-row path, then PATCHes
-- storage_path/inline_data guarded on storage_path IS NULL), so running it
-- on a schedule is safe even if a tick fails or overlaps.
--
-- Cadence: every 10 minutes at :02. At limit=15/tick (time-budgeted under
-- the Vercel function limit) the ~1k large inline rows drain in ~11h; small
-- text/email-body artifacts clear far faster. Afterwards the cron just
-- offloads new inline artifacts shortly after they arrive, capping growth.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('lcc-artifact-offload'); exception when others then null; end;
    perform cron.schedule(
      'lcc-artifact-offload',
      '2-59/10 * * * *',
      $cmd$select public.lcc_cron_post('/api/artifact-offload?limit=15&grace_minutes=15', '{}'::jsonb, 'vercel')$cmd$
    );
  end if;
end $$;
