-- ============================================================================
-- Disable the artifact-offload crons (LCC Opps) — incident follow-up
--
-- 2026-05-29, second incident: the lcc-artifact-offload cron had been bumped
-- to every 5 minutes (migration 20260529150000). On the small LCC Opps compute
-- tier (max_connections=60), that job — which pulls multi-MB inline_data blobs
-- out of the DB on every tick — combined with a concurrent CoStar-capture
-- burst, geocode, and the other crons to exhaust the instance's
-- connection/resource budget. The origin stopped responding (HTTP 522 on
-- /auth/v1/user and /rest/v1/*), taking down the app and the Chrome connector
-- until a manual database restart.
--
-- This was NOT a disk problem (DB ~7.4 GB, read_only=off, well under the
-- ~13 GB read-only ceiling). The artifact offload is therefore NOT urgent and
-- is being switched off until it can be redesigned to be gentle on this tier
-- (small batches, off-peak, and/or a DB-local edge function instead of
-- round-tripping multi-MB blobs through Vercel) — and/or the compute tier is
-- raised.
--
-- This migration unschedules the offending crons so they stay off and a future
-- re-apply of migrations 20260529130000 / 140000 / 150000 on a fresh
-- environment cannot silently resurrect the every-5-minute job. Idempotent:
-- the unschedule calls no-op if the jobs are already absent.
--
-- The handler (api/admin.js handleArtifactOffload, /api/admin?_route=
-- artifact-offload) is intentionally LEFT in place — it's dormant unless
-- explicitly invoked, and is reusable if/when the offload is reintroduced on a
-- gentle schedule.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('lcc-artifact-offload');                exception when others then null; end;
    begin perform cron.unschedule('lcc-artifact-offload-finalize-watch'); exception when others then null; end;
    -- The one-shot VACUUM job is only ever created transiently by the finalize
    -- watcher; drop it too if it happens to be present.
    begin perform cron.unschedule('lcc-artifact-vacuum-run');             exception when others then null; end;
  end if;
end $$;
