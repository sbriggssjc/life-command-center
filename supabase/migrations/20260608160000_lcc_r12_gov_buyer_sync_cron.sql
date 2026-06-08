-- ============================================================================
-- R12 Unit 2 — government_buyer → Salesforce Opportunity push cron (LCC Opps)
--
-- Schedules the `api/admin.js handleGovBuyerSync` worker (route
-- /api/gov-buyer-sync) that reads `ready_to_sync` rows from
-- v_lcc_government_buyer_sync_health, creates the SF Opportunity on the mapped
-- PARENT account, and writes the returned id back to bd_opportunities.sf_opp_id.
-- Effect-first + idempotent on bd_opportunities.id — safe to run on a schedule
-- and safe to overlap (re-reads sf_opp_id immediately before each write).
--
-- ⚠️ DEPLOY ORDERING (artifact-offload rule): /api/gov-buyer-sync 404s until the
-- handler ships on the Railway redeploy of merged `main`. DO NOT apply this
-- migration before the redeploy is live — a pre-deploy tick would just log a
-- pg_net 404. Apply AFTER confirming the route with a GET dry-run.
--
-- Cadence: hourly at :20. Volume is tiny (a handful of open government_buyer
-- opps at a time), so hourly is ample; ready_to_sync rows clear on the first
-- tick after a parent gets mapped. Until the Power Automate flow implements a
-- `create_opportunity` case, the worker is an honest no-op (every row stays
-- ready_to_sync), so the cron costs nothing but a heartbeat.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq) — AFTER the Railway deploy.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('lcc-gov-buyer-sync'); exception when others then null; end;
    perform cron.schedule(
      'lcc-gov-buyer-sync',
      '20 * * * *',
      $cmd$select public.lcc_cron_post('/api/gov-buyer-sync?limit=25', '{}'::jsonb, 'vercel')$cmd$
    );
  end if;
end $$;
