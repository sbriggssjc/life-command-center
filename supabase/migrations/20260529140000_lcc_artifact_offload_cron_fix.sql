-- ============================================================================
-- Fix: lcc-artifact-offload cron — call the ?_route= form directly (LCC Opps)
--
-- The original cron (migration 20260529130000) called the /api/artifact-offload
-- rewrite, but post-deploy verification showed that path returning 404 while
-- the underlying /api/admin?_route=artifact-offload route returned 200. Several
-- existing crons already call the ?_route= form directly (dia-link-provenance-
-- replay, merge-log-reconcile, generate-research-tasks), so point this cron at
-- it too and drop the dependency on the vercel.json rewrite resolving.
--
-- (Companion to the api/admin.js fix that adds the missing fetchWithTimeout
-- import — without it every offload attempt errored "fetchWithTimeout is not
-- defined" and reclaimed nothing.)
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
      $cmd$select public.lcc_cron_post('/api/admin?_route=artifact-offload&limit=15&grace_minutes=15', '{}'::jsonb, 'vercel')$cmd$
    );
  end if;
end $$;
