-- ============================================================================
-- C1C-SPLIT — scope lcc_c1c_retire_sf_lanes to a NAMED lane list      2026-09-16
-- (docs/claude-code/prompts/C1C-SPLIT-retire-the-dia-lane-only.md)
--
-- THE PROBLEM. 20260908130300 shipped `lcc_c1c_retire_sf_lanes(p_dry_run,
-- p_batch_tag, p_limit)` with NO way to choose which of the two lanes it
-- retires -- its plan CTE always selects
-- `research_type = any(public._lcc_c1c_lane_types())`, which is hardcoded to
-- BOTH `owner_needs_salesforce` (government) and `true_owner_needs_salesforce`
-- (dialysis). That migration also never ran (backlog C1C-UNAPPLIED, found by
-- DEPLOY2's first live catch -- 9 of 9 declared objects absent from LCC Opps).
--
-- IT CANNOT SIMPLY BE APPLIED NOW. C1c's own header states the retirement is
-- safe *because* C1b's gate makes `gate_pass` permanently false, so "nothing
-- will mint into these two lanes ever again." Measured live 2026-09-16, that
-- premise is HALF true:
--
--   lane                              domain    queued  minted since C1b (09-08..09-15)
--   true_owner_needs_salesforce       dialysis     838   1                    -- holds
--   owner_needs_salesforce            government 1,851   175 (2/1/10/156/1/5) -- FAILS
--
-- The government lane is still being fed because C1b's gov gate guards the
-- WRONG ARM (backlog C1B-GOV-GATE): live `government.v_ownership_gaps` carries
-- exactly one `lane_no_consumer` marker and it sits on `owner_needs_sos`, while
-- `owner_needs_salesforce` still runs the ordinary value/placeholder predicate.
-- Retiring the gov lane today is a one-time drop that refills within days --
-- the PR1e / N15d lesson that a backfill and a fixed producer are
-- indistinguishable until the producer actually runs.
--
-- The dia lane's "no human consumer" half DOES hold, and was CHECKED rather
-- than inherited: it shows 298 `completed` rows, but every one carries a
-- fully NULL `outcome` (no `action`, no `outcome`, no `terminal`; last touched
-- 2026-09-02) -- a bulk status flip, not a human working the lane.
--
-- SCOPE. Lane and domain are 1:1, measured, not assumed:
--   owner_needs_salesforce      is 1,851 rows, ALL domain='government'
--   true_owner_needs_salesforce is   838 rows, ALL domain='dialysis'
-- So a lane-LIST parameter is sufficient. Deliberately NO domain parameter --
-- that would be a second way to say the same thing, and two selectors that
-- must agree is a defect waiting to happen.
--
-- ⚠️ DO NOT USE THIS TO RETIRE `owner_needs_salesforce` (government) UNTIL
-- C1B-GOV-GATE IS FIXED. It is blocked, not merely deferred: retiring it today
-- would clear ~1,851 rows and have the generator re-mint most of them within
-- days, because the real value/placeholder gate the gov lane needs has never
-- been wired.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Adding a parameter with a default creates an OVERLOAD, it does not replace
-- (the N15d / N15g / C2e-caller-reason lesson). DROP the old 3-arg signature
-- FIRST, or the 3-arg and 4-arg forms both resolve for a 3-arg call and every
-- existing caller starts failing 42725 "function is not unique".
-- ---------------------------------------------------------------------------
drop function if exists public.lcc_c1c_retire_sf_lanes(boolean, text, int);

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
  -- ⚠️ VALIDATE, NEVER SILENTLY NO-OP. This function writes to research_tasks;
  -- a typo'd or arbitrary lane name must raise, not quietly retire zero rows
  -- (a no-op that looks like a success is the failure shape this whole arc
  -- keeps paying for -- C1C-UNAPPLIED itself was exactly that shape one layer
  -- up: a migration nobody noticed had never run).
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
    'research_types', to_jsonb(v_types),
    'tasks_retired', v_retired);
end;
$fn$;

comment on function public.lcc_c1c_retire_sf_lanes(boolean, text, int, text[]) is
  'C1c / C1C-SPLIT. Retire OPEN research tasks for the given research_type(s) '
  '-- p_research_types NULL means the full default set from '
  '_lcc_c1c_lane_types() (owner_needs_salesforce + true_owner_needs_salesforce), '
  'a non-null array MUST be a subset of that set or the call raises. Use this '
  'to retire ONLY true_owner_needs_salesforce (dia) while owner_needs_salesforce '
  '(gov) stays queued behind C1B-GOV-GATE. outcome.reason=c1c_lane_no_consumer, '
  'NEVER gap_resolved (A5a). Reverse with lcc_c1c_unretire(batch_tag). Read '
  'tasks_retired, never tasks scanned.';

-- ---------------------------------------------------------------------------
-- Assert the drop-then-create actually left exactly one signature. Never
-- trust the DROP silently -- assert it (the B6b lesson: a DDL batch ending in
-- a runtime error rolls the DDL back with it, so the overload can survive a
-- migration that "looks" like it dropped the old form).
-- ---------------------------------------------------------------------------
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
-- EXPECTED APPLY SEQUENCE (Cowork, live -- this sandbox has no Supabase
-- egress):
--   1. apply 20260908130300 (DDL only, defines functions, runs nothing inline)
--   2. apply THIS migration
--   3. select lcc_c1c_retire_sf_lanes(true, 'c1c-dia-<date>', null,
--        array['true_owner_needs_salesforce']);
--      -- expect tasks_to_retire = 838, research_types = ["true_owner_needs_salesforce"]
--      -- STOP if this is not 838 dia / 0 gov -- re-measure before writing.
--   4. same call with p_dry_run => false
--   5. re-read v_lcc_research_lane_summary: dia lane -> 0 open,
--      gov owner_needs_salesforce UNCHANGED at ~1,851
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- REVERSAL RUNBOOK (this migration's own change only -- does not touch
-- 20260908130300's objects, whose own reversal runbook still applies after):
--
--   drop function if exists public.lcc_c1c_retire_sf_lanes(boolean, text, int, text[]);
--   -- restore the 3-arg form from 20260908130300 if that migration itself is
--   -- being kept but this scoping change is being rolled back:
--   create or replace function public.lcc_c1c_retire_sf_lanes(
--     p_dry_run boolean default true, p_batch_tag text default null,
--     p_limit int default null) returns jsonb language plpgsql as $fn$ ... $fn$;
--   -- (body identical to 20260908130300's original -- see that file)
--   notify pgrst, 'reload schema';
-- ---------------------------------------------------------------------------
