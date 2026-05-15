-- =============================================================================
-- LCC Opps — Power Automate dead-letter / flow-health plane
-- Gap analysis backlog item #2 (lcc-microsoft-salesforce-pipeline-gap-analysis.md)
-- Created 2026-05-14
--
-- Today, Power Automate flow failures scatter across 29 separate flow run
-- histories with no single queryable pane. The platform's only safety net is
-- the 14-day-consecutive-failure auto-disable (which silently took HTTP Init
-- LLC offline for two weeks). This migration creates the landing zone:
--
--   1. flow_run_failures      append-only forensic dead-letter log
--   2. lcc_record_flow_failure RPC  the single ingestion entrypoint a PA
--                              fault branch POSTs to (via PostgREST /rpc/)
--   3. v_flow_run_failures_open view  open failures, newest first
--
-- The RPC also opens a de-duplicated row in the EXISTING lcc_health_alerts
-- table (alert_kind='flow_failure'), so flow failures show up in the same
-- unified pane that lcc_check_cron_health() and the availability-checker
-- already feed — and therefore in the daily briefing — with no new cron.
-- =============================================================================

-- 1. Forensic dead-letter log -------------------------------------------------
create table if not exists public.flow_run_failures (
  failure_id      bigint generated always as identity primary key,
  detected_at     timestamptz not null default now(),
  flow_name       text        not null,
  flow_run_id     text,                                   -- PA workflow().run.name
  correlation_id  text,                                   -- flow's correlation_id, if it carries one
  failed_action   text,                                   -- action that failed / timed out
  error_kind      text        not null default 'has_failed', -- has_failed | has_timed_out | logical_failure
  error_code      text,                                   -- HTTP status / connector error code, if known
  error_detail    text,                                   -- truncated error message
  payload         jsonb,                                  -- inbound payload / relevant run context
  severity        text        not null default 'error',   -- error | warn
  resolved_at     timestamptz,
  resolved_note   text
);

comment on table public.flow_run_failures is
  'Append-only dead-letter log for Power Automate flow failures. Written via lcc_record_flow_failure(). Gap analysis item #2.';

create index if not exists flow_run_failures_open_idx
  on public.flow_run_failures (flow_name, detected_at desc)
  where resolved_at is null;

create index if not exists flow_run_failures_corr_idx
  on public.flow_run_failures (correlation_id)
  where correlation_id is not null;

-- RLS on, no policies: the table is only reachable through the SECURITY DEFINER
-- RPC below (for inserts) and service_role (for triage/reads). The anon key a
-- flow carries can do nothing with this table directly.
alter table public.flow_run_failures enable row level security;

-- 2. Ingestion RPC ------------------------------------------------------------
-- A PA fault branch POSTs to:
--   https://xengecqvemvfknjvbvrq.supabase.co/rest/v1/rpc/lcc_record_flow_failure
-- with apikey + Authorization: Bearer <anon key> headers and a JSON body whose
-- keys are the p_* parameter names below. PostgREST maps them to named args.
create or replace function public.lcc_record_flow_failure(
  p_flow_name      text,
  p_flow_run_id    text  default null,
  p_correlation_id text  default null,
  p_failed_action  text  default null,
  p_error_kind     text  default 'has_failed',
  p_error_code     text  default null,
  p_error_detail   text  default null,
  p_payload        jsonb default null,
  p_severity       text  default 'error'
) returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_failure_id bigint;
  v_cutoff     timestamptz := now() - interval '24 hours';
  v_severity   text := case when lower(coalesce(p_severity,'error')) = 'warn' then 'warn' else 'error' end;
begin
  insert into public.flow_run_failures (
    flow_name, flow_run_id, correlation_id, failed_action,
    error_kind, error_code, error_detail, payload, severity
  ) values (
    p_flow_name, p_flow_run_id, p_correlation_id, p_failed_action,
    coalesce(nullif(p_error_kind,''), 'has_failed'),
    p_error_code, left(coalesce(p_error_detail,''), 1000),
    p_payload, v_severity
  )
  returning failure_id into v_failure_id;

  -- Open ONE de-duplicated alert per flow per 24h window in the unified pane.
  if not exists (
    select 1 from public.lcc_health_alerts a
     where a.alert_kind = 'flow_failure'
       and a.source     = p_flow_name
       and a.resolved_at is null
       and a.detected_at > v_cutoff
  ) then
    insert into public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    values (
      'flow_failure',
      p_flow_name,
      v_severity,
      'Power Automate flow ' || p_flow_name || ' failed'
        || coalesce(' at action "' || p_failed_action || '"', '')
        || coalesce(' (' || p_error_kind || ')', ''),
      jsonb_build_object(
        'failure_id',     v_failure_id,
        'flow_run_id',    p_flow_run_id,
        'correlation_id', p_correlation_id,
        'failed_action',  p_failed_action,
        'error_kind',     p_error_kind,
        'error_code',     p_error_code,
        'error_detail',   left(coalesce(p_error_detail,''), 500)
      )
    );
  end if;

  return v_failure_id;
end
$function$;

comment on function public.lcc_record_flow_failure(text,text,text,text,text,text,text,jsonb,text) is
  'Single ingestion entrypoint for Power Automate flow failures. Inserts a flow_run_failures row and opens a de-duplicated lcc_health_alerts row. SECURITY DEFINER so the anon key (execute-only) can call it without table access.';

grant execute on function public.lcc_record_flow_failure(text,text,text,text,text,text,text,jsonb,text)
  to anon, authenticated, service_role;

-- 3. Triage view --------------------------------------------------------------
create or replace view public.v_flow_run_failures_open as
  select failure_id,
         detected_at,
         flow_name,
         flow_run_id,
         correlation_id,
         failed_action,
         error_kind,
         error_code,
         left(error_detail, 240) as error_detail_short,
         severity
  from public.flow_run_failures
  where resolved_at is null
  order by detected_at desc;

comment on view public.v_flow_run_failures_open is
  'Open (unresolved) Power Automate flow failures, newest first. Triage feed for the flow-health plane.';

-- Resolution helper: a human (or a future auto-resolve cron) marks a failure
-- handled. Kept simple — service_role only.
create or replace function public.lcc_resolve_flow_failure(
  p_failure_id bigint,
  p_note       text default 'Resolved'
) returns void
language sql
security definer
set search_path = public
as $function$
  update public.flow_run_failures
     set resolved_at = now(),
         resolved_note = coalesce(p_note, 'Resolved')
   where failure_id = p_failure_id
     and resolved_at is null;
$function$;

grant execute on function public.lcc_resolve_flow_failure(bigint, text) to service_role;
