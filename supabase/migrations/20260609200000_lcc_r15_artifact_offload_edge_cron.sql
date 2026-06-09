-- ============================================================================
-- R15 — accelerated DB-local artifact offload (LCC Opps)
--
-- Supersedes the Railway-round-trip offload cron from
-- 20260608210000_lcc_r15_reenable_artifact_offload_cron.sql with the in-region
-- Supabase Edge Function `artifact-offload`
-- (supabase/functions/artifact-offload/index.ts).
--
-- WHY: the Vercel/Railway handler round-trips every multi-MB blob DB → Railway →
-- Storage, so it is time-budgeted to ~2 large files/tick and, when run
-- frequently, exhausted the small-tier connection budget (the 2026-05-29
-- incident that disabled the every-5-min cron). The Edge Function does the same
-- offload IN-REGION (DB + Storage both on Supabase), so the bytes never leave
-- the Supabase network: it offloads ~20 large files per 60s invocation while
-- staying gentle (strictly serial, 150ms inter-row pause, PostgREST pooling, no
-- raw connection fan-out). This is exactly the "DB-local edge function instead
-- of round-tripping multi-MB blobs through Vercel" redesign that the disable
-- migration (20260529160000) called for.
--
-- Beyond clearing the legacy backlog, the faster drain keeps the TOAST
-- free-list populated so new inline inflow REUSES freed space instead of
-- extending the table — it halts physical growth even before the (deferred,
-- manual) VACUUM FULL returns the space to the OS.
--
-- Cadence: every 10 minutes, limit 40 (the 60s edge budget caps it at ~20 large
-- files/tick regardless). For a faster ONE-SHOT backlog drain, invoke the
-- function directly with a higher cadence under monitoring — do NOT make the
-- steady cron more frequent (the every-5-min Railway variant is what caused the
-- connection incident; this edge path is gentler but the cadence rule stands).
--
-- The legacy Railway handler (api/admin.js handleArtifactOffload,
-- /api/artifact-offload) is LEFT deployed as a manual fallback; only its CRON is
-- retired here. The finalize-watch / vacuum-run jobs stay OFF — VACUUM FULL is a
-- manual runbook step gated on disk provisioning (see CLAUDE.md "R15").
--
-- Deploy ordering: the `artifact-offload` Edge Function must be deployed before
-- this cron fires (crons after routes). lcc_cron_post just gets a 404 until the
-- function exists, so applying this ahead of a deploy is harmless.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq). Idempotent: unschedule-then-schedule.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Retire the Railway round-trip offload cron (superseded by the edge path).
    begin perform cron.unschedule('lcc-artifact-offload'); exception when others then null; end;

    -- Schedule the in-region edge drainer.
    begin perform cron.unschedule('lcc-artifact-offload-edge'); exception when others then null; end;
    perform cron.schedule(
      'lcc-artifact-offload-edge',
      '*/10 * * * *',
      $cmd$select public.lcc_cron_post('/artifact-offload', '{"limit":40}'::jsonb, 'edge')$cmd$
    );

    -- Keep the every-5-min-incident jobs OFF; VACUUM FULL stays manual.
    begin perform cron.unschedule('lcc-artifact-offload-finalize-watch'); exception when others then null; end;
    begin perform cron.unschedule('lcc-artifact-vacuum-run');             exception when others then null; end;
  end if;
end $$;
