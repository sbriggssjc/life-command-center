-- ============================================================================
-- C1C-SPLIT-b — the dry run reported the number of LANES in the plan, not TASKS
--                                                                   2026-09-16
--
-- Found on the FIRST live dry run of 20260916120000 (Cowork, LCC Opps): with the
-- dia lane alone the call returned
--
--   by_type          = {"true_owner_needs_salesforce": 839}
--   tasks_to_retire  = 1
--
-- The dry-run jsonb_build_object selects FROM the per-lane GROUP BY subquery, so
-- its count(*) counts GROUPS: one lane -> 1, both lanes -> 2. The same
-- expression is in 20260908130300, so the pre-split function had it too; it was
-- never seen because that migration was never applied (C1C-UNAPPLIED).
--
-- The write path is unaffected -- it counts the ledger insert's RETURNING set --
-- but the dry run IS the safety property of this function, and the prompt's
-- own stop rule ("if the dry run is not 838/0, STOP") reads tasks_to_retire.
-- This is the A2 shape verbatim: a dry run counted off the wrong set is a dry
-- run of something else.
--
-- ONLY the count expression changes: sum of the per-lane counts == plan rows.
-- Body otherwise identical to 20260916120000. Same signature, so this is a
-- plain CREATE OR REPLACE with the single-signature assertion kept.
--
-- Applied live 2026-09-16 (Cowork) BEFORE the dia retire ran. The corrected
-- dry run then read tasks_to_retire = 839 (838 measured on the 16th + one row
-- minted 2026-09-15), 0 gov; the real run retired 839; gov unchanged at 1,851.
-- ============================================================================

begin;

create or replace function public.lcc_c1c_retire_sf_lanes(
  p_dry_run        boolean  default true,
  p_batch_tag      text     default null,
  p_limit          int      default null,
  p_research_types text[]   default null
) returns jsonb
language plpgsql
as $fn$
declare
  v_tag        text   := coalesce(nullif(btrim(p_batch_tag), ''),
                              'c1c-' || to_char(now(), 'YYYYMMDDHH24MISS'));
  v_valid      text[] := public._lcc_c1c_lane_types();
  v_types      text[] := coalesce(p_research_types, v_valid);
  v_bad        text[];
  v_retired    int    := 0;
  v_out        jsonb;
begin
  if p_research_types is not null and array_length(p_research_types, 1) is null then
    raise exception
      'lcc_c1c_retire_sf_lanes: p_research_types is an empty array -- pass NULL '
      'to retire the default lane set (%), or name at least one lane from it',
      v_valid;
  end if;

  select array_agg(x) into v_bad
    from unnest(v_types) x
   where x <> all (v_valid);

  if v_bad is not null and array_length(v_bad, 1) > 0 then
    raise exception
      'lcc_c1c_retire_sf_lanes: unknown research_type(s) % -- must be a subset '
      'of %', v_bad, v_valid;
  end if;

  drop table if exists _c1c_plan;
  create temp table _c1c_plan on commit drop as
  select t.id as research_task_id, t.research_type, t.domain, t.source_record_id,
         t.status::text as prior_status, t.outcome as prior_outcome
    from public.research_tasks t
   where t.research_type = any (v_types)
     and t.status in ('queued','in_progress')
   order by t.id
   limit coalesce(p_limit, 1000000);

  if p_dry_run then
    select jsonb_build_object(
             'dry_run',         true,
             'batch_tag',       v_tag,
             'research_types',  to_jsonb(v_types),
             -- C1C-SPLIT-b: TASKS, not lanes. The sum of the per-lane counts is
             -- the plan's row count; count(*) here would count lanes.
             'tasks_to_retire', coalesce(sum(n), 0),
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
    'research_types', to_jsonb(v_types),
    'tasks_retired', v_retired);
end;
$fn$;

-- Same single-signature assertion as 20260916120000 -- a CREATE OR REPLACE with
-- an identical signature cannot add an overload, but assert it rather than
-- reason about it.
do $$
declare v_n int;
begin
  select count(*) into v_n
    from pg_proc
   where proname = 'lcc_c1c_retire_sf_lanes'
     and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then
    raise exception
      'lcc_c1c_retire_sf_lanes: expected exactly 1 signature after migration, found %',
      v_n;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- REVERSAL RUNBOOK: re-apply the function body from 20260916120000 (restores
-- the lane-counting dry run -- there is no reason to want that, but it is the
-- exact prior state).
-- ---------------------------------------------------------------------------
