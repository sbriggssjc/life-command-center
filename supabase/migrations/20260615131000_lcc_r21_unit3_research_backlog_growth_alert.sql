-- ============================================================================
-- R21 Unit 3 — bound + alert: catch a future research-task backlog regression
-- ============================================================================
-- A gap-tracker that only grows is a broken signal (the disabled-cron / stall
-- lesson). After R21 Unit 1's dedupe the OPEN research_tasks count reflects real
-- distinct gaps (property_missing_recorded_owner ~1,534, true_owner_needs_
-- salesforce ~748). This check makes a regression LOUD instead of silent: if the
-- open count for any research_type blows past a threshold (a dupe re-explosion,
-- or a real influx that outpaces completion), it opens a research_backlog_growth
-- alert in lcc_health_alerts (severity warn, one open per research_type),
-- auto-resolving when the type drops back under threshold.
--
-- Folded into the EXISTING lcc-cron-health-check tick (:15) — NOT a new cron (a
-- standalone watcher could itself be silently disabled, the very failure mode
-- being closed; same reasoning as R18 Unit 2). This migration sorts after R18
-- Unit 2 (20260615121000) so a full replay re-establishes the combined command
-- last with all three checks.
--
-- Additive (new function + alert rows only); DB-only, idempotent. Auth schema
-- untouched. Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

create or replace function public.lcc_check_research_backlog_growth(p_threshold integer default 3000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new      int := 0;
  v_resolved int := 0;
  v_over     jsonb;
begin
  -- Open counts per research_type (queued + in_progress).
  with open_counts as (
    select research_type, count(*) as open_ct
      from public.research_tasks
     where status in ('queued','in_progress')
     group by research_type
  ),
  over_threshold as (
    select research_type, open_ct
      from open_counts
     where open_ct > p_threshold
  ),
  -- One open alert per research_type that is over threshold and not already open.
  ins as (
    insert into public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    select 'research_backlog_growth', o.research_type, 'warn',
           'research_tasks backlog for ' || o.research_type || ' = ' || o.open_ct ||
             ' open (> ' || p_threshold || '). Either a duplicate-generation ' ||
             'regression (see R21 Unit 1 dedupe guard) or real influx outpacing ' ||
             'completion. Investigate the generator + the resolution path.',
           jsonb_build_object('research_type', o.research_type,
                              'open_count', o.open_ct,
                              'threshold', p_threshold)
      from over_threshold o
     where not exists (
       select 1 from public.lcc_health_alerts a
        where a.alert_kind = 'research_backlog_growth'
          and a.source = o.research_type
          and a.resolved_at is null
     )
    returning 1
  )
  select count(*) into v_new from ins;

  -- Auto-resolve: any open alert whose research_type is now back under threshold
  -- (or has no open tasks at all).
  update public.lcc_health_alerts a
     set resolved_at = now(),
         resolved_note = 'Auto-resolved: research backlog back under threshold'
   where a.alert_kind = 'research_backlog_growth'
     and a.resolved_at is null
     and coalesce((
       select count(*) from public.research_tasks t
        where t.status in ('queued','in_progress')
          and t.research_type = a.source
     ), 0) <= p_threshold;
  get diagnostics v_resolved = row_count;

  -- Snapshot of currently-over-threshold types (observability).
  select coalesce(jsonb_object_agg(research_type, open_ct), '{}'::jsonb) into v_over
    from (
      select research_type, count(*) as open_ct
        from public.research_tasks
       where status in ('queued','in_progress')
       group by research_type
      having count(*) > p_threshold
    ) s;

  return jsonb_build_object(
    'new_alerts', v_new,
    'resolved', v_resolved,
    'over_threshold', coalesce(v_over, '{}'::jsonb),
    'threshold', p_threshold
  );
end;
$$;

revoke all on function public.lcc_check_research_backlog_growth(integer) from public;
grant execute on function public.lcc_check_research_backlog_growth(integer) to service_role;

comment on function public.lcc_check_research_backlog_growth(integer) is
  'Opens a research_backlog_growth alert in lcc_health_alerts (warn, one open per research_type) when a research_type''s open (queued+in_progress) research_tasks count exceeds the threshold (default 3000); auto-resolves when it drops back under. Catches a future duplicate-generation regression or a real influx outpacing completion. Folded into the lcc-cron-health-check hourly tick.';

-- ── Fold into the existing hourly health-check cron (all three checks) ───────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('lcc-cron-health-check'); exception when others then null; end;
    perform cron.schedule(
      'lcc-cron-health-check',
      '15 * * * *',
      'SELECT public.lcc_check_cron_health(); SELECT public.lcc_check_disabled_critical_crons(); SELECT public.lcc_check_research_backlog_growth();'
    );
  end if;
end $$;
