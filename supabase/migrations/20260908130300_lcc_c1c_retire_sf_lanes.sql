-- ============================================================================
-- C1c — retire the open owner_needs_salesforce / true_owner_needs_salesforce
--       research tasks                                        2026-09-08
--       (executing C1 §3 / docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md)
--
-- Same shape as A4's `no_records` retirement
-- (20260827200000_lcc_a4_retire_no_records.sql): batch-tagged, reversible, a
-- re-open predicate, never a bare status flip.
--
-- ⚠️ SEQUENCED AFTER C1a AND C1b. C1a resizes both lanes to the real gap (a
-- linked owner drops out of the feed); C1b gates gate_pass permanently false
-- so nothing new mints into them. Retiring the backlog BEFORE either would
-- retire rows that (a) were already resolved under the old, wrong predicate
-- and (b) would immediately re-mint the moment the next generator tick ran,
-- because the gate did not yet exist to stop it.
--
-- ⚠️ OUTCOME VALUE IS `retired_no_consumer`, NEVER `gap_resolved` -- A5a's
-- entire fix exists because `gap_resolved` on a task that did not resolve
-- manufactures a false throughput number an audit gets ranked on. This retire
-- states plainly that the lane, not the gap, is what closed.
--
-- ⚠️ `status='skipped'` ALONE IS NOT TERMINAL TO THE SEEDER. The generator
-- (api/admin.js handleGenerateResearchTasks) dedupes new mints against the
-- OPEN set (status='queued'), and — after C1b — nothing will mint into these
-- two lanes ever again (gate_pass is permanently false), so the P176/A4
-- terminal-flag trap does not actually threaten a re-mint here the way it did
-- for establish_ownership_history. The `outcome->>'terminal'='true'` stamp is
-- applied anyway, for the same reason A4 applies it: cheap, matches the
-- documented convention, and protects against a future change that ever
-- re-admits either lane without also revisiting this retirement.
--
-- REOPEN PREDICATE (per the prompt): the subject gains a `sf_link_candidate`
-- Decision Center row, or the entity/owner acquires an SF Account directly.
-- ⚠️ HONESTLY SCOPED, NOT FABRICATED: LCC Opps can see BOTH of those facts for
-- the dia lane (entity_kind='true_owner', entity_id=true_owner_id bridges
-- cleanly through external_identities(dia,true_owner)) but CANNOT for the gov
-- lane as currently keyed (entity_kind='unified_entity', entity_id=
-- unified_id -- unified_id is a gov row id with no external_identities bridge
-- anywhere in this schema; only true_owner_id/recorded_owner_id bridge).
-- `lcc_c1c_reopen_relinked()` below is therefore a DIA-ONLY automatic sweep,
-- stated as such, alongside an explicit-id-driven `lcc_c1c_reopen_tasks()`
-- (the A4 `lcc_a4_reopen_tasks` shape) usable manually or by a future tick for
-- either domain once a caller can name the relinked subjects.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Ledger. Reversal is by batch tag; `prior_outcome` is the whole jsonb so an
-- unretire restores the row byte-for-byte rather than guessing what was there.
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_c1c_retire_log (
  log_id           bigserial primary key,
  batch_tag        text        not null,
  action           text        not null
                     check (action in ('retired','reopened','unretired')),
  research_task_id uuid        not null,
  research_type    text,
  domain           text,
  source_record_id text,
  reason           text,
  prior_status      text,
  prior_outcome     jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_lcc_c1c_retire_log_batch on public.lcc_c1c_retire_log (batch_tag);
create index if not exists idx_lcc_c1c_retire_log_task  on public.lcc_c1c_retire_log (research_task_id);

comment on table public.lcc_c1c_retire_log is
  'C1c. One row per state change on an owner_needs_salesforce / '
  'true_owner_needs_salesforce research task. action=retired | reopened | '
  'unretired. Reverse a batch with lcc_c1c_unretire(batch_tag). Read '
  '`retired` minus `reopened`/`unretired` (v_lcc_c1c_retired_watch) for the '
  'live retired population -- never count the table.';

-- The two lane names this migration touches, and only these two.
create or replace function public._lcc_c1c_lane_types()
returns text[] language sql immutable as
  $$ select array['owner_needs_salesforce','true_owner_needs_salesforce']::text[] $$;

-- ---------------------------------------------------------------------------
-- lcc_c1c_retire_sf_lanes -- dry-run default; returns the write set it WOULD
-- write (the A2 lesson: a dry run counted off a join back to the plan is a
-- dry run of something else).
-- ---------------------------------------------------------------------------
create or replace function public.lcc_c1c_retire_sf_lanes(
  p_dry_run   boolean default true,
  p_batch_tag text    default null,
  p_limit     int     default null
) returns jsonb
language plpgsql
as $fn$
declare
  v_tag      text := coalesce(nullif(btrim(p_batch_tag), ''),
                              'c1c-' || to_char(now(), 'YYYYMMDDHH24MISS'));
  v_retired  int  := 0;
  v_out      jsonb;
begin
  drop table if exists _c1c_plan;
  create temp table _c1c_plan on commit drop as
  select t.id as research_task_id, t.research_type, t.domain, t.source_record_id,
         t.status::text as prior_status, t.outcome as prior_outcome
    from public.research_tasks t
   where t.research_type = any (public._lcc_c1c_lane_types())
     and t.status in ('queued','in_progress')
   order by t.id
   limit coalesce(p_limit, 1000000);

  if p_dry_run then
    select jsonb_build_object(
             'dry_run',         true,
             'batch_tag',       v_tag,
             'tasks_to_retire', count(*),
             'by_type',         coalesce(jsonb_object_agg(rt, n) filter (where rt is not null), '{}'::jsonb),
             'sample',          coalesce((select jsonb_agg(jsonb_build_object(
                                            'task', p.research_task_id,
                                            'type', p.research_type,
                                            'domain', p.domain,
                                            'subject', p.source_record_id))
                                          from (select * from _c1c_plan order by research_task_id limit 5) p),
                                         '[]'::jsonb))
      into v_out
    from (select research_type as rt, count(*) as n from _c1c_plan group by research_type) g;
    return v_out;
  end if;

  with upd as (
    update public.research_tasks t
       set status  = 'skipped',
           outcome = coalesce(t.outcome, '{}'::jsonb) || jsonb_build_object(
                       'status',     'retired',
                       'reason',     'c1c_lane_no_consumer',
                       -- ⚠️ load-bearing: the ONLY thing the seeder ever
                       -- treats as terminal (see A4's identical note).
                       'terminal',   'true',
                       'c1c_batch',  v_tag,
                       'retired_at', now(),
                       'reopen_on',  'the entity/owner acquires an SF Account '
                                     || 'identity directly, or gains an open '
                                     || 'sf_link_candidate Decision Center row'),
           updated_at = now()
      from _c1c_plan pl
     where t.id = pl.research_task_id
       and t.status in ('queued','in_progress')
    returning t.id, pl.research_type, pl.domain, pl.source_record_id,
              pl.prior_status, pl.prior_outcome
  ),
  led as (
    insert into public.lcc_c1c_retire_log
      (batch_tag, action, research_task_id, research_type, domain,
       source_record_id, reason, prior_status, prior_outcome)
    select v_tag, 'retired', upd.id, upd.research_type, upd.domain,
           upd.source_record_id, 'c1c_lane_no_consumer',
           upd.prior_status, upd.prior_outcome
      from upd
    returning 1
  )
  -- Count from the UPDATE's own RETURNING set, never the ledger join (the A2
  -- on-conflict-do-nothing over-report lesson).
  select count(*) into v_retired from led;

  return jsonb_build_object(
    'dry_run',       false,
    'batch_tag',     v_tag,
    'tasks_retired', v_retired);
end;
$fn$;

comment on function public.lcc_c1c_retire_sf_lanes(boolean, text, int) is
  'C1c. Retire the open owner_needs_salesforce (gov) / true_owner_needs_'
  'salesforce (dia) research tasks -- the two lanes C1b gates lane_no_consumer.'
  ' outcome.reason=c1c_lane_no_consumer, NEVER gap_resolved (A5a). Stamps '
  'outcome.terminal=true because that is the ONLY thing the seeder treats as '
  'terminal. Reverse with lcc_c1c_unretire(batch_tag); re-open with '
  'lcc_c1c_reopen_tasks() or (dia only) lcc_c1c_reopen_relinked(). Read '
  'tasks_retired, never tasks scanned.';

-- ---------------------------------------------------------------------------
-- lcc_c1c_reopen_tasks -- explicit-id-driven re-open (the A4/P121 shape).
-- Callable manually or by a future tick for EITHER domain once a caller can
-- name the relinked subjects (source_record_id values).
-- ---------------------------------------------------------------------------
create or replace function public.lcc_c1c_reopen_tasks(
  p_domain           text,
  p_research_type     text,
  p_source_record_ids text[],
  p_dry_run           boolean default true,
  p_reason             text    default 'relinked'
) returns jsonb
language plpgsql
as $fn$
declare v_n int := 0;
begin
  if p_research_type not in (select unnest(public._lcc_c1c_lane_types())) then
    raise exception 'lcc_c1c_reopen_tasks: research_type must be one of %',
      public._lcc_c1c_lane_types();
  end if;
  if p_source_record_ids is null or array_length(p_source_record_ids, 1) is null then
    return jsonb_build_object('dry_run', p_dry_run, 'tasks_reopened', 0,
                              'note', 'no_source_record_ids_supplied');
  end if;

  drop table if exists _c1c_reopen;
  create temp table _c1c_reopen on commit drop as
  select t.id, t.research_type, t.domain, t.source_record_id,
         t.status::text as prior_status, t.outcome as prior_outcome
    from public.research_tasks t
   where t.research_type = p_research_type
     and t.status = 'skipped'
     and t.outcome->>'reason' = 'c1c_lane_no_consumer'
     and t.domain = p_domain
     and t.source_record_id = any (p_source_record_ids);

  if p_dry_run then
    select count(*) into v_n from _c1c_reopen;
    return jsonb_build_object('dry_run', true, 'tasks_to_reopen', v_n);
  end if;

  with upd as (
    update public.research_tasks t
       set status  = 'queued',
           outcome = (coalesce(t.outcome, '{}'::jsonb)
                       - 'terminal' - 'status' - 'reason' - 'retired_at' - 'reopen_on')
                     || jsonb_build_object('c1c_reopened_at', now(),
                                           'c1c_reopen_reason', p_reason),
           updated_at = now()
      from _c1c_reopen r
     where t.id = r.id
    returning t.id, r.research_type, r.domain, r.source_record_id,
              r.prior_status, r.prior_outcome,
              coalesce(r.prior_outcome->>'c1c_batch', 'unknown') as batch
  ),
  led as (
    insert into public.lcc_c1c_retire_log
      (batch_tag, action, research_task_id, research_type, domain,
       source_record_id, reason, prior_status, prior_outcome)
    select upd.batch, 'reopened', upd.id, upd.research_type, upd.domain,
           upd.source_record_id, p_reason, upd.prior_status, upd.prior_outcome
      from upd
    returning 1
  )
  select count(*) into v_n from led;

  return jsonb_build_object('dry_run', false, 'tasks_reopened', v_n);
end;
$fn$;

comment on function public.lcc_c1c_reopen_tasks(text, text, text[], boolean, text) is
  'C1c. Explicit-id re-open (P121 shape), either domain, for a caller that can '
  'name the relinked source_record_id values. See lcc_c1c_reopen_relinked() '
  'for the dia-only automatic sweep.';

-- ---------------------------------------------------------------------------
-- lcc_c1c_reopen_relinked -- DIA-ONLY automatic sweep. Bridges
-- source_record_id (a dia true_owner_id, since entity_kind='true_owner' on
-- this arm) through the existing external_identities(dia,true_owner) mirror
-- to the LCC entity, then checks the two stated reopen conditions:
--   (a) the entity now holds an external_identities(salesforce,Account) row
--       (either C1d's writeback attach or the pre-existing domain->LCC
--       mirror in sf-link-reconcile.js Unit 1), or
--   (b) the entity has an OPEN sf_link_candidate decision (a fresh candidate
--       surfaced for it -- worth a human look again).
-- Resolved through lcc_entity_survivor() so a merged-away tombstone id still
-- finds its live entity.
--
-- ⚠️ NOT run for gov: gov's arm is entity_kind='unified_entity', entity_id=
-- unified_id, and unified_id has no bridge in external_identities (only
-- true_owner_id/recorded_owner_id do). Building one here would be a guess
-- about a schema this sandbox cannot query live -- use
-- lcc_c1c_reopen_tasks('government','owner_needs_salesforce', ids, ...)
-- explicitly instead, or extend this function once that bridge is confirmed
-- to exist (filed, not fabricated).
-- ---------------------------------------------------------------------------
create or replace function public.lcc_c1c_reopen_relinked(
  p_dry_run boolean default true,
  p_limit   int     default 500
) returns jsonb
language plpgsql
as $fn$
declare v_n int := 0; v_out jsonb;
begin
  drop table if exists _c1c_relinked;
  create temp table _c1c_relinked on commit drop as
  with retired as (
    select t.id, t.source_record_id
      from public.research_tasks t
     where t.research_type = 'true_owner_needs_salesforce'
       and t.domain = 'dialysis'
       and t.status = 'skipped'
       and t.outcome->>'reason' = 'c1c_lane_no_consumer'
     order by t.id
     limit p_limit
  ),
  bridged as (
    select r.id, r.source_record_id,
           public.lcc_entity_survivor(ei.entity_id) as entity_id
      from retired r
      join public.external_identities ei
        on ei.source_system = 'dia' and ei.source_type = 'true_owner'
       and ei.external_id = r.source_record_id
  )
  select b.id, b.source_record_id, b.entity_id
    from bridged b
   where exists (
           select 1 from public.external_identities sf
            where sf.entity_id = b.entity_id
              and sf.source_system = 'salesforce' and sf.source_type = 'Account'
         )
      or exists (
           select 1 from public.lcc_decisions d
            where d.subject_entity_id = b.entity_id
              and d.decision_type = 'sf_link_candidate'
              and d.status = 'open'
         );

  if p_dry_run then
    select count(*) into v_n from _c1c_relinked;
    return jsonb_build_object('dry_run', true, 'tasks_to_reopen', v_n, 'domain', 'dia_only');
  end if;

  select public.lcc_c1c_reopen_tasks('dialysis', 'true_owner_needs_salesforce',
           coalesce((select array_agg(source_record_id) from _c1c_relinked), array[]::text[]),
           false, 'auto_relinked')
    into v_out;
  return v_out;
end;
$fn$;

comment on function public.lcc_c1c_reopen_relinked(boolean, int) is
  'C1c. DIA-ONLY automatic reopen sweep: bridges a retired task''s '
  'true_owner_id through external_identities(dia,true_owner) -> '
  'lcc_entity_survivor() -> checks for a fresh SF Account identity or an open '
  'sf_link_candidate decision. gov is NOT covered (no unified_id bridge in '
  'this schema) -- use lcc_c1c_reopen_tasks() explicitly for gov.';

-- ---------------------------------------------------------------------------
-- Full reversal of a batch.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_c1c_unretire(p_batch_tag text)
returns jsonb
language plpgsql
as $fn$
declare v_n int := 0;
begin
  with tgt as (
    select distinct on (l.research_task_id)
           l.research_task_id, l.prior_status, l.prior_outcome
      from public.lcc_c1c_retire_log l
     where l.batch_tag = p_batch_tag
       and l.action = 'retired'
       and not exists (select 1 from public.lcc_c1c_retire_log x
                        where x.research_task_id = l.research_task_id
                          and x.action in ('reopened','unretired')
                          and x.log_id > l.log_id)
     order by l.research_task_id, l.log_id desc
  ),
  upd as (
    update public.research_tasks t
       set status     = tgt.prior_status::research_status,
           outcome    = tgt.prior_outcome,
           updated_at = now()
      from tgt
     where t.id = tgt.research_task_id
    returning t.id
  ),
  led as (
    insert into public.lcc_c1c_retire_log
      (batch_tag, action, research_task_id, reason)
    select p_batch_tag, 'unretired', upd.id, 'batch_reversal' from upd
    returning 1
  )
  select count(*) into v_n from led;

  return jsonb_build_object('batch_tag', p_batch_tag, 'tasks_unretired', v_n);
end;
$fn$;

comment on function public.lcc_c1c_unretire(text) is
  'C1c. Reverse a retire batch: restores status and the whole prior outcome '
  'for every task whose most recent action in this batch is `retired` and has '
  'not since been reopened/unretired by a later log row.';

-- ---------------------------------------------------------------------------
-- Observability. Never count lcc_c1c_retire_log directly -- it is an
-- append-only history of state changes.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_c1c_retired_watch as
with last_action as (
  select distinct on (research_task_id)
         research_task_id, batch_tag, action, created_at
    from public.lcc_c1c_retire_log
   order by research_task_id, log_id desc
)
select la.research_task_id,
       la.batch_tag,
       la.created_at as retired_at,
       t.research_type,
       t.domain,
       t.source_record_id,
       t.status::text  as task_status,
       t.outcome->>'reason'   as retire_reason,
       t.outcome->>'terminal' as terminal_flag,
       t.title
  from last_action la
  join public.research_tasks t on t.id = la.research_task_id
 where la.action = 'retired';

comment on view public.v_lcc_c1c_retired_watch is
  'C1c. The LIVE retired population (owner_needs_salesforce / '
  'true_owner_needs_salesforce): tasks whose most recent C1c ledger action is '
  '`retired`. A task later reopened or unretired drops out -- this is '
  '"retired minus reopened", never the ledger row count.';

commit;

-- ---------------------------------------------------------------------------
-- SCHEDULE -- cron 246 (`lcc-c1c-sf-lane-retire`), UN-scheduled here on
-- purpose. After C1b lands, nothing new can mint into either lane
-- (gate_pass is permanently false), so this retire is a one-time backlog
-- clearance, not a recurring producer that needs a nightly sweep (unlike A4's
-- establish_ownership_history, whose gate remains open). Run it once,
-- manually or from a deploy step:
--
--   select public.lcc_c1c_retire_sf_lanes(false, 'c1c-initial-' || to_char(now(),'YYYYMMDD'));
--
-- If either lane is ever re-admitted (gate flipped back on), schedule a
-- nightly `lcc_c1c_reopen_relinked(false)` (dia) alongside it, mirroring
-- cron 245's pairing with cron 144.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- REVERSAL RUNBOOK
--
--   select public.lcc_c1c_unretire('<batch_tag>');
--   drop view if exists public.v_lcc_c1c_retired_watch;
--   drop function if exists public.lcc_c1c_unretire(text);
--   drop function if exists public.lcc_c1c_reopen_relinked(boolean, int);
--   drop function if exists public.lcc_c1c_reopen_tasks(text, text, text[], boolean, text);
--   drop function if exists public.lcc_c1c_retire_sf_lanes(boolean, text, int);
--   drop function if exists public._lcc_c1c_lane_types();
--   drop table if exists public.lcc_c1c_retire_log;
-- ---------------------------------------------------------------------------
