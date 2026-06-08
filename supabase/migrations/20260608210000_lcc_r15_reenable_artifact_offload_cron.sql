-- ============================================================================
-- R15 Unit 1 — durably re-enable the artifact-offload cron (LCC Opps)
--
-- WHY THE CRON WAS MISSING (root cause, grounded 2026-06-08):
-- It was not lost to a branch reset — it was DELIBERATELY unscheduled by
-- migration 20260529160000_lcc_disable_artifact_offload_crons.sql. That earlier
-- round had bumped the offload to every 5 minutes (migration 20260529150000);
-- on the small LCC Opps compute tier (max_connections=60) that job — which
-- pulls multi-MB inline_data blobs out of the DB on every tick — combined with
-- a CoStar-capture burst to exhaust the connection budget and take the origin
-- read-unavailable (HTTP 522) until a manual restart. So 20260529160000 turned
-- the offload OFF (every-5-min variant) and left no offload cron running.
--
-- Consequence by 2026-06-08: staged_intake_artifacts grew to ~9.5 GB (86% of
-- LCC Opps), 1,400+ artifacts still holding ~9 GB of base64 inline_data with
-- ZERO offloaded, and the DB crossed the disk-pressure warn threshold (11 GB)
-- toward the ~13 GB read-only ceiling. LCC AUTH lives on this DB, so disk-full
-- here = total sign-in lockout (the documented 2026-05-29 outage class), making
-- this HIGH severity rather than a degraded feature.
--
-- WHAT THIS MIGRATION DOES:
-- Re-enables `lcc-artifact-offload` at the ORIGINAL GENTLE cadence — every
-- 10 minutes (2-59/10), limit=15, grace_minutes=15 — NOT the every-5-minute
-- cadence that caused the connection incident. Each tick is time-budgeted
-- (~7s) under the function limit and offloads at most 15 rows, so the binding
-- constraint is well within the tier's budget. This supersedes the disable
-- migration as the live source of truth and makes the live re-schedule applied
-- during the R15 session durable (so a future migration replay or environment
-- rebuild cannot silently leave the offload off again).
--
-- The handler (api/admin.js handleArtifactOffload) is idempotent and
-- non-destructive on partial failure: it uploads to lcc-om-uploads with
-- x-upsert to a deterministic per-row path, then PATCHes
-- storage_path/inline_data guarded on storage_path IS NULL. Readers
-- (intake-extractor getArtifactBytes + the download handler) fall back to
-- storage_path, so the offload is transparent.
--
-- DELIBERATELY NOT re-enabled here: the finalize-watch cron
-- (lcc-artifact-offload-finalize-watch, migration 20260529150000) that
-- auto-schedules a one-shot VACUUM FULL. VACUUM FULL takes an ACCESS EXCLUSIVE
-- lock on a ~9.5 GB table and must run in a quiet window under human control,
-- AFTER the inline backlog has drained — it is a documented MANUAL runbook step
-- for Scott (see CLAUDE.md "R15 — artifact-offload + disk runbook"), not an
-- auto-fired job. Idempotent: unschedule-then-schedule.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq). The /api/artifact-offload route is
-- already deployed (handler is dormant unless invoked), so this cron is safe to
-- (re)apply at any time — crons after routes.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Re-enable the offload at the GENTLE cadence (every 10 min, not every 5).
    begin perform cron.unschedule('lcc-artifact-offload'); exception when others then null; end;
    perform cron.schedule(
      'lcc-artifact-offload',
      '2-59/10 * * * *',
      $cmd$select public.lcc_cron_post('/api/artifact-offload?limit=15&grace_minutes=15', '{}'::jsonb, 'vercel')$cmd$
    );

    -- Belt-and-suspenders: ensure the every-5-minute finalize-watch / vacuum-run
    -- jobs that caused the connection incident stay OFF. VACUUM FULL is a manual
    -- runbook step, not an auto-fired cron (see header).
    begin perform cron.unschedule('lcc-artifact-offload-finalize-watch'); exception when others then null; end;
    begin perform cron.unschedule('lcc-artifact-vacuum-run');             exception when others then null; end;
  end if;
end $$;
