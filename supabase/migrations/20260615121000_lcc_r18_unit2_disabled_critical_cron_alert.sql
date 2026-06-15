-- ============================================================================
-- R18 Unit 2 — alert when a CRITICAL maintenance cron is disabled (LCC Opps)
--
-- Root cause of the June 2026 staged_intake_artifacts bloat: the
-- artifact-offload cron was deliberately DISABLED after a connection-exhaustion
-- incident and silently stayed off while the backlog grew to ~9.85 GB — nothing
-- flagged it. The hourly `lcc-cron-health-check` watches for run FAILURES, not
-- for jobs that are switched OFF (cron.job.active=false) or missing entirely.
-- A disabled maintenance/retention job is therefore a blind spot that can fill
-- the disk and (because auth lives on LCC Opps) lock out ALL sign-in.
--
-- This closes the blind spot: a small allowlist of CRITICAL maintenance crons
-- whose absence causes silent bloat / disk risk is checked every tick. Any
-- allowlisted job that is MISSING or active=false opens a
-- `maintenance_cron_disabled` alert in lcc_health_alerts (severity warn, one
-- open per jobname, idempotent); it auto-resolves when the job is active again.
-- This makes "a disabled prune/offload" loud instead of silent — exactly what
-- would have caught the June bloat weeks earlier.
--
-- Conservative by design: ONLY maintenance/retention/offload jobs are watched.
-- A deliberately-disabled FEATURE cron must not alert, so it is not allowlisted.
--
-- Wiring: rather than add a brand-new cron (which would itself be a watcher that
-- could be silently disabled — the very failure mode we are closing), the check
-- is folded into the EXISTING, proven `lcc-cron-health-check` (hourly :15). The
-- cron command now runs both functions. This migration sorts after the original
-- monitor migration (20260428180000), so on a full replay it re-establishes the
-- combined command last.
--
-- Additive (new function + alert rows only); DB-only, no Railway dependency.
-- Idempotent (CREATE OR REPLACE + unschedule-then-schedule).
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

create or replace function public.lcc_check_disabled_critical_crons()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new      int := 0;
  v_resolved int := 0;
  v_down     jsonb;
begin
  -- The allowlist: maintenance / retention / offload jobs whose absence causes
  -- silent bloat or disk-pressure risk. Keep it to maintenance jobs ONLY — a
  -- deliberately-disabled feature cron should never alert here. Add a job here
  -- when (and only when) its being-off would let a table grow unbounded.
  with allow(jobname) as (
    values
      ('lcc-artifact-offload-edge'),          -- drains staged_intake_artifacts inline_data → Storage
      ('sf-sync-log-prune'),                  -- bounds sf_sync_log row count
      ('field-provenance-prune'),             -- bounds field_provenance
      ('lcc-context-packet-prune'),           -- bounds context_packets
      ('lcc-staged-intake-artifacts-prune'),  -- bounds staged_intake_artifacts
      ('lcc-disk-health-check'),              -- the disk-pressure early warning itself
      ('lcc-pg-net-response-cleanup')         -- bounds net._http_response
  ),
  state as (
    select a.jobname,
           count(j.jobid) = 0               as is_missing,
           coalesce(bool_or(j.active), false) as any_active,
           max(j.schedule)                  as schedule
      from allow a
      left join cron.job j on j.jobname = a.jobname
     group by a.jobname
  ),
  down as (
    select jobname,
           case when is_missing then 'missing' else 'inactive' end as reason,
           schedule
      from state
     where is_missing or not any_active
  ),
  -- Open a warn alert for any down job that has no open alert yet.
  ins as (
    insert into public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    select 'maintenance_cron_disabled', d.jobname, 'warn',
           'Critical maintenance cron ' || d.jobname || ' is ' ||
             case when d.reason = 'missing'
                  then 'MISSING (not scheduled)'
                  else 'DISABLED (active=false)' end ||
             '. While it is off, its table can grow unbounded — disk-full puts ' ||
             'LCC Opps read-only and locks out sign-in. Re-enable it.',
           jsonb_build_object('jobname', d.jobname, 'reason', d.reason,
                              'schedule', d.schedule)
      from down d
     where not exists (
       select 1 from public.lcc_health_alerts a
        where a.alert_kind = 'maintenance_cron_disabled'
          and a.source = d.jobname
          and a.resolved_at is null
     )
    returning 1
  )
  select count(*) into v_new from ins;

  -- Auto-resolve: any open alert whose job is now present AND active.
  update public.lcc_health_alerts a
     set resolved_at = now(),
         resolved_note = 'Auto-resolved: maintenance cron re-enabled (active)'
   where a.alert_kind = 'maintenance_cron_disabled'
     and a.resolved_at is null
     and exists (
       select 1 from cron.job j
        where j.jobname = a.source
          and j.active is true
     );
  get diagnostics v_resolved = row_count;

  -- Snapshot of currently-down allowlisted jobs (for observability).
  select coalesce(jsonb_agg(a.jobname), '[]'::jsonb) into v_down
    from (
      values ('lcc-artifact-offload-edge'),('sf-sync-log-prune'),
             ('field-provenance-prune'),('lcc-context-packet-prune'),
             ('lcc-staged-intake-artifacts-prune'),('lcc-disk-health-check'),
             ('lcc-pg-net-response-cleanup')
    ) as a(jobname)
   where not exists (
     select 1 from cron.job j where j.jobname = a.jobname and j.active is true
   );

  return jsonb_build_object(
    'new_alerts', v_new,
    'resolved', v_resolved,
    'down', coalesce(v_down, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.lcc_check_disabled_critical_crons() from public;
grant execute on function public.lcc_check_disabled_critical_crons() to service_role;

comment on function public.lcc_check_disabled_critical_crons() is
  'Opens a maintenance_cron_disabled alert in lcc_health_alerts (severity warn, one open per jobname) for any allowlisted CRITICAL maintenance/retention/offload cron that is missing or active=false; auto-resolves when the job is active again. Closes the blind spot that let the artifact-offload cron stay silently disabled before the June 2026 bloat incident. Folded into the lcc-cron-health-check hourly tick.';

-- ── Fold the check into the existing hourly health-check cron ───────────────
-- No brand-new cron (a new watcher could itself be silently disabled — the very
-- failure mode this closes). The proven lcc-cron-health-check tick (:15) now
-- runs both functions.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('lcc-cron-health-check'); exception when others then null; end;
    perform cron.schedule(
      'lcc-cron-health-check',
      '15 * * * *',
      'SELECT public.lcc_check_cron_health(); SELECT public.lcc_check_disabled_critical_crons();'
    );
  end if;
end $$;
