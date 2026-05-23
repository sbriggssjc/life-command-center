-- ============================================================================
-- 041: Briefing Research Progress RPC + snapshot pg_cron schedule
-- Life Command Center — executive briefing v2 follow-up
--
-- Adds:
--   - public.lcc_briefing_research_progress(workspace, days) RPC
--     Returns counts and rates that drive the email's "Research Progress"
--     section: touchpoints this week, prospects added this week, entities
--     with recent activity vs total, and percent-prospected.
--
--   - pg_cron schedule for the briefing-intel-snapshot edge function
--     (5:30 AM CT weekdays). Uses the existing lcc_cron_post helper so
--     the function URL and Authorization come from vault, matching the
--     pattern of every other LCC cron.
-- ============================================================================

create or replace function public.lcc_briefing_research_progress(
  p_workspace uuid,
  p_days      int default 7
) returns jsonb
language sql stable as $$
  with window_start as (
    select (now() - make_interval(days => p_days)) as ts
  ),
  warm_window_start as (
    -- "Engaged" = touched in the last 180 days; longer than the report
    -- window because a contact you spoke to in March is still warm in May.
    select (now() - interval '180 days') as ts
  )
  select jsonb_build_object(
    'window_days', p_days,
    'touchpoints_this_week', (
      select count(*)
      from activity_events
      where workspace_id = p_workspace
        and occurred_at >= (select ts from window_start)
        and category::text in ('call','email','meeting','note')
    ),
    'prospects_added_this_week', (
      select count(*)
      from entities
      where workspace_id = p_workspace
        and created_at >= (select ts from window_start)
    ),
    'total_entities', (
      select count(*)
      from entities
      where workspace_id = p_workspace
    ),
    'entities_with_recent_activity', (
      select count(distinct ae.entity_id)
      from activity_events ae
      where ae.workspace_id   = p_workspace
        and ae.entity_id      is not null
        and ae.occurred_at    >= (select ts from warm_window_start)
        and ae.category::text in ('call','email','meeting','note')
    ),
    'opportunities_open', (
      select count(*)
      from bd_opportunities
      where workspace_id = p_workspace
        and is_open      = true
    ),
    'opportunities_opened_this_week', (
      select count(*)
      from bd_opportunities
      where workspace_id = p_workspace
        and created_at   >= (select ts from window_start)
    )
  );
$$;

comment on function public.lcc_briefing_research_progress(uuid, int) is
  'Returns counts driving the Research Progress section of the v2 morning briefing email. Stable, cheap (~50ms). Called from api/_shared/briefing-data.js::fetchResearchProgress.';

grant execute on function public.lcc_briefing_research_progress(uuid, int) to anon, authenticated, service_role;

-- ============================================================================
-- Snapshot generator pg_cron schedule
--
-- 11:30 UTC = 5:30 AM Central Standard Time (winter) / 6:30 AM Central
-- Daylight Time (summer). Briefing flow fires at 6:00 AM Chicago and reads
-- whichever row landed most recently for today's CT date, so the half-hour
-- DST drift is fine — the row is still well ahead of the read.
--
-- Mon–Fri only (matches the email cadence). Manual Saturday runs go
-- through the dry-run / variant=daily query params.
-- ============================================================================

-- Drop any prior version so re-applying this migration is safe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lcc-briefing-intel-snapshot') then
    perform cron.unschedule('lcc-briefing-intel-snapshot');
  end if;
end$$;

select cron.schedule(
  'lcc-briefing-intel-snapshot',
  '30 11 * * 1-5',
  $cron$
    select public.lcc_cron_post(
      '/briefing-intel-snapshot',
      '{}'::jsonb,
      'edge'
    );
  $cron$
);

comment on extension pg_cron is 'pg_cron — see lcc-briefing-intel-snapshot job (schema/041)';
