-- ---------------------------------------------------------------------------
-- B1 -- SPLIT THE OWNERSHIP-CHAIN VALUE FLOOR BY CONSUMER.
--
-- 2026-08-28 - LCC Opps. Additive, reversible, dry-run default.
--
-- WHY THE $500k FLOOR WAS RIGHT, AND WHY IT IS NOW WRONG IN ONE PLACE ONLY
-- -----------------------------------------------------------------------
-- R60 (`20260622120000`) value-gated `lcc_generate_chain_research_tasks`
-- (cron 144) at $500,000 and it was CORRECT: `establish_ownership_history`
-- was a HUMAN research queue -- "pull the county deed history via the
-- county-recorder portal" -- and nobody should hand-research a $50k
-- property. $500k is also a deliberately SHARED knob (the gov asset-mint
-- floor, `CADENCE_SIGNAL_MIN_VALUE`, P161's weak-role floor).
--
-- ⚠️ WHAT CHANGED IS THE CONSUMER, NOT THE JUDGEMENT.
-- Since A2 (`20260827130000`, cron 244, 06:49) the `agrees` bucket is
-- APPLIED AUTOMATICALLY from a deterministic, record-cited P131 draft, and
-- A4 (`20260827200000`, cron 245) auto-retires `no_records`. No human sees
-- either. A floor sized for OPERATOR ATTENTION is therefore suppressing work
-- that costs no operator attention at all -- and suppressing precisely the
-- ownership-history coverage the lane exists to build.
--
-- **That distinction did not exist when the floor was set, because the
-- automated path did not exist.** This is not "the floor was wrong".
--
-- THE COST OF THE AUTOMATED PATH, MEASURED (2026-08-28) -- NOT ASSERTED
-- --------------------------------------------------------------------
--   drafter gov read : 508 ms per 60-property chunk (14,524 buffers),
--                      and it is FIXED cost -- gov's
--                      `v_ownership_transitions_portfolio` materialises its
--                      whole `norm` CTE (9,595 rows) plus an oscillating-pair
--                      self-join on every request; only 71 of 9,595 rows
--                      survived the 60-id filter. So cost scales with
--                      CHUNKS, not with chains.
--   A2 apply         : 450 ms for the whole open lane (dry run, 51 tasks);
--                      run 7 did 380 tasks / 450 links in one pass.
--   human minutes    : ZERO.
--
-- Admitting the whole below-floor gov population (1,257 draftable) is
-- ~21 chunks ≈ **10.7 s of gov DB time, once** -- about **8 ms per chain**.
-- That is the number the floor is now being asked to protect, and it is not
-- a number worth protecting.
--
-- ⚠️ WHERE THE FLOOR STAYS, AND WHY -- MEASURED, NOT ASSUMED
-- ----------------------------------------------------------
-- The automated path exists for exactly ONE (domain, research_type) pair:
--
--   * The drafter (P131) reads `gov.v_ownership_transitions_portfolio`.
--     **dia HAS NO SUCH VIEW** -- measured on `zqzrriwuavgrquhisnoa`:
--     zero objects matching `%ownership_transition%`. A dia task therefore
--     can never be drafted, never auto-applied, and lands on a human.
--     gov holds 9,595 transitions across 4,698 properties.
--   * A2 and A4 consume `research_type = 'establish_ownership_history'`
--     only. `trace_ownership_to_developer` has a different consumer path
--     that has NOT been graded here.
--
-- So dropping the floor for dia, or for `trace_ownership_to_developer`,
-- would mint work no automation can touch -- the Consumption-Layer failure
-- this repo has spent the whole arc unwinding. It is NOT done here.
-- (Sizes held back, for the record: dia establish 47, dia trace 469,
-- gov trace 514 below-floor skips.)
--
-- TWO GATES, TWO DIRECTIONS -- AND THE ASYMMETRY IS DELIBERATE
-- -----------------------------------------------------------
-- The automated floor and the human floor answer different questions, so
-- they treat an UNKNOWN value in opposite directions and both are right:
--
--   automated path : unknown value is ADMITTED  -- drafting is ~free, and
--                    refusing a free chain because we cannot price it buys
--                    nothing.
--   human surface  : unknown value is GATED     -- "we cannot size it" is
--                    not evidence it is worth an operator's time (P180:
--                    NULL is not zero; A5c gates `value_unknown`).
--
-- ⚠️ THE HUMAN GATE IS NOT AT THE SEEDER. It cannot be: the seeder mints
-- BEFORE the drafter runs, and it is the DRAFT that decides whether a task
-- is `agrees` (automation) or `mismatch` (a person). The human floor
-- therefore lives on `v_lcc_ownership_history_lane_split.human_actionable`
-- -- the single owner of "does a person need to look at this" -- which is
-- what `v_lcc_research_lane_summary.human_actionable_tasks` already reads.
-- Projected: of the 1,257 newly-draftable, roughly 1 in 8 classifies
-- `mismatch`/`all_guarded`; every one of those is below $500k by
-- construction, so the human badge must not move. That is the invariant to
-- verify, and it is verified below.
--
-- REVERSAL
-- --------
--   floors  : `select cron.alter_job(144, command =>
--             $$SELECT public.lcc_generate_chain_research_tasks(2000, 500000, 500000)$$)`
--             restores single-floor behaviour without touching any object.
--   re-open : `select public.lcc_b1_unreopen('<batch_tag>')` restores every
--             task's prior status and outcome byte-for-byte from the ledger.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. THE SINGLE OWNER OF "does this lane row have an automated consumer".
--
-- One predicate, called by the seeder and by the re-open sweep, so the two
-- can never drift about which rows the low floor applies to (the normaliser
-- drift this repo warns about a dozen times).
-- ---------------------------------------------------------------------------
create or replace function public.lcc_chain_lane_has_auto_consumer(
  p_domain        text,
  p_research_type text
) returns boolean
language sql immutable
as $$
  -- gov + establish_ownership_history ONLY: the drafter's source view exists
  -- only on gov, and A2/A4 consume only this research_type. Widening this
  -- predicate without first building the consumer is the failure it guards.
  select lower(coalesce(p_domain,'')) in ('gov','government')
     and coalesce(p_research_type,'') = 'establish_ownership_history';
$$;

comment on function public.lcc_chain_lane_has_auto_consumer(text, text) is
  'B1: true when this (domain, research_type) is applied by an automated '
  'consumer (A2 cron 244 / A4 cron 245) and therefore costs no operator '
  'attention. gov+establish_ownership_history only -- dia has no '
  'v_ownership_transitions_portfolio, so it can never be drafted.';

-- The human-surface floor. ONE knob, matching the shared $500k used by the
-- gov asset-mint, CADENCE_SIGNAL_MIN_VALUE and P161's weak-role floor.
create or replace function public.lcc_chain_human_value_floor()
returns numeric language sql immutable as $$ select 500000::numeric $$;

comment on function public.lcc_chain_human_value_floor() is
  'B1: the value floor for ownership-chain work that reaches a PERSON. '
  'Unchanged at $500k -- B1 lowers only the automated path.';

-- ---------------------------------------------------------------------------
-- 2. THE SEEDER -- one floor per CONSUMER instead of one floor per lane.
--
-- ⚠️ ADDING A PARAMETER WITH A DEFAULT CREATES AN OVERLOAD, and with defaults
-- on both the old and new signatures every 2-arg call becomes
-- "function ... is not unique" (42725). That bit N15d/N15e on
-- `lcc_n15c_backfill_canonical_names`. DROP the old signature first.
-- ---------------------------------------------------------------------------
drop function if exists public.lcc_generate_chain_research_tasks(int, numeric);

create or replace function public.lcc_generate_chain_research_tasks(
  p_limit          int     default 2000,
  p_min_value      numeric default 500000,   -- HUMAN-consumed lanes
  p_auto_min_value numeric default null      -- AUTOMATED lanes; null => p_min_value
) returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_inserted int;
  v_fallback_ws uuid;
  v_auto numeric := coalesce(p_auto_min_value, p_min_value);
BEGIN
  SELECT id INTO v_fallback_ws FROM public.workspaces ORDER BY created_at ASC LIMIT 1;

  -- Sweep A -- unchanged: the gap resolved or the suggestion changed.
  UPDATE public.research_tasks t
     SET status = 'skipped',
         outcome = COALESCE(t.outcome, '{}'::jsonb)
                   || jsonb_build_object('status','superseded','reason','chain_gap_resolved_or_changed','swept_at', now()),
         updated_at = now()
   WHERE t.source_table = 'v_lcc_ownership_chain_completeness'
     AND t.research_type IN ('trace_ownership_to_developer','establish_ownership_history','confirm_developer')
     AND t.status IN ('queued','in_progress')
     AND NOT EXISTS (
       SELECT 1 FROM public.v_ownership_chain_worklist w
       WHERE w.source_domain = t.domain AND w.source_property_id = t.source_record_id
         AND w.suggested_research_type = t.research_type);

  -- Sweep B -- the value floor, now resolved PER CONSUMER.
  --
  -- ⚠️ The effective floor MUST be identical here and in the mint below, or a
  -- row is admitted by one and closed by the other every night -- churn that
  -- reads as a working producer.
  --
  -- `floor_kind` is recorded so a reader can tell an automated-path skip from
  -- a human-path skip. One reason string covering two different facts is the
  -- P181 failure, and it is exactly what made the original 1,548 look like a
  -- single population.
  UPDATE public.research_tasks t
     SET status = 'skipped',
         outcome = COALESCE(t.outcome, '{}'::jsonb)
                   || jsonb_build_object(
                        'status','superseded',
                        'reason','below_value_floor',
                        'floor', CASE WHEN public.lcc_chain_lane_has_auto_consumer(t.domain, t.research_type)
                                      THEN v_auto ELSE p_min_value END,
                        'floor_kind', CASE WHEN public.lcc_chain_lane_has_auto_consumer(t.domain, t.research_type)
                                           THEN 'automated' ELSE 'human' END,
                        'swept_at', now()),
         updated_at = now()
   FROM public.v_ownership_chain_worklist w
   WHERE w.source_domain = t.domain AND w.source_property_id = t.source_record_id
     AND w.suggested_research_type = t.research_type
     AND t.source_table = 'v_lcc_ownership_chain_completeness'
     AND t.research_type IN ('trace_ownership_to_developer','establish_ownership_history')
     AND t.status IN ('queued','in_progress')
     AND COALESCE(w.rank_value, 0) < CASE
           WHEN public.lcc_chain_lane_has_auto_consumer(t.domain, t.research_type)
           THEN v_auto ELSE p_min_value END;

  WITH cand AS (
    SELECT w.*
    FROM public.v_ownership_chain_worklist w
    WHERE COALESCE(w.rank_value, 0) >= CASE
            WHEN public.lcc_chain_lane_has_auto_consumer(w.source_domain, w.suggested_research_type)
            THEN v_auto ELSE p_min_value END
      AND NOT EXISTS (
        SELECT 1 FROM public.research_tasks t
        WHERE t.research_type = w.suggested_research_type
          AND t.source_record_id = w.source_property_id
          AND t.domain = w.source_domain
          AND (t.status IN ('queued','in_progress')
               OR (t.status = 'skipped' AND COALESCE(t.outcome->>'terminal','') = 'true')))
    ORDER BY w.rank_value DESC NULLS LAST, w.source_domain, w.source_property_id
    LIMIT GREATEST(p_limit, 0)
  ),
  ins AS (
    INSERT INTO public.research_tasks (
      workspace_id, research_type, title, instructions,
      entity_id, domain, status, priority, source_record_id, source_table, metadata
    )
    SELECT
      COALESCE(cand.workspace_id, v_fallback_ws),
      cand.suggested_research_type,
      CASE cand.suggested_research_type
        WHEN 'establish_ownership_history'
          THEN 'Establish ownership history (pull county deeds): ' || COALESCE(cand.address, 'property ' || cand.source_property_id)
        ELSE 'Trace ownership to the original developer: ' || COALESCE(cand.address, 'property ' || cand.source_property_id)
      END,
      CASE cand.suggested_research_type
        WHEN 'establish_ownership_history'
          THEN 'No prior owners are recorded for ' || COALESCE(cand.address, 'this property')
               || '. The current owner ' || COALESCE(cand.current_owner_name, '(unknown)')
               || ' is a categorized buyer (acquisition, not development) but the deed chain '
               || 'was never ingested. Pull the county deed history via the property''s '
               || 'county-recorder portal and record each grantor→grantee transfer back to the original developer.'
        ELSE 'Current owner ' || COALESCE(cand.current_owner_name, '(unknown)')
             || ' is a categorized buyer (acquisition, not development). Trace '
             || COALESCE(cand.address, 'this property') || ' back through ownership_history + '
             || 'sales to the original developer, and connect each historical owner (LCC entity + contact) so the chain is complete.'
      END,
      cand.current_owner_entity_id,
      cand.source_domain,
      'queued',
      LEAST(100, GREATEST(1, (cand.rank_value / 10000)::int)),
      cand.source_property_id,
      'v_lcc_ownership_chain_completeness',
      -- ⚠️ jsonb_strip_nulls DROPS a null rank_value, so the key is ABSENT
      -- rather than null on an unpriced property. The human gate below treats
      -- an absent value as BELOW the floor (gate closed); the automated path
      -- treats it as admitted. Both are deliberate -- see the header.
      jsonb_strip_nulls(jsonb_build_object(
        'true_owner_name', cand.true_owner_name,
        'earliest_known_owner', cand.earliest_known_owner,
        'gap', cand.gap,
        'rank_value', cand.rank_value))
    FROM cand
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;
  RETURN v_inserted;
END;
$function$;

revoke all on function public.lcc_generate_chain_research_tasks(int, numeric, numeric) from public;
grant execute on function public.lcc_generate_chain_research_tasks(int, numeric, numeric) to service_role;

comment on function public.lcc_generate_chain_research_tasks(int, numeric, numeric) is
  'R46/R60/B1 chain-research seeder. p_min_value gates HUMAN-consumed lanes; '
  'p_auto_min_value gates lanes with an automated consumer '
  '(lcc_chain_lane_has_auto_consumer -- gov+establish_ownership_history). '
  'Pass p_auto_min_value => p_min_value to restore single-floor behaviour.';

-- ---------------------------------------------------------------------------
-- 3. THE HUMAN GATE -- on the lane split, which is where "a person must look
--    at this" is actually decided.
--
-- ⚠️ APPEND-ONLY: `CREATE OR REPLACE VIEW` cannot insert a column mid-list
-- (42P16), so `lane_value`/`human_value_floor`/`below_human_floor`/
-- `human_gate` go at the END and every pre-existing column keeps its exact
-- position, name and type. `human_actionable` keeps its position; only its
-- EXPRESSION tightens.
--
-- `human_gate` names the four states rather than collapsing them into the
-- boolean: a card held back by the floor is a different fact from one that
-- was never a human's job, and from one the drafter has not reached yet.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_ownership_history_lane_split as
with open_tasks as (
  select rt.id, rt.workspace_id, rt.title, rt.status, rt.priority, rt.domain,
         rt.source_record_id, rt.entity_id, rt.assigned_to, rt.created_at, rt.updated_at,
         -- B1: the value the seeder stamped at mint time. Stable, cheap, and
         -- already present on 100% of open tasks (measured 2026-08-28).
         nullif(rt.metadata->>'rank_value','')::numeric as lane_value
    from public.research_tasks rt
   where rt.research_type = 'establish_ownership_history'
     and rt.status = any (array['queued'::research_status, 'in_progress'::research_status])
), draft as (
  select r.proposal_id, r.proposed_link, r.reason, r.confidence, r.updated_at,
         r.research_task_id, r.rn
    from (
      select p.proposal_id, p.proposed_link, p.reason, p.confidence, p.updated_at,
             (p.proposed_link ->> 'research_task_id')::uuid as research_task_id,
             row_number() over (partition by ((p.proposed_link ->> 'research_task_id')::uuid)
                                order by p.proposal_id desc) as rn
        from public.lcc_clean_assist_proposals p
       where p.source = 'ownership_chain_draft' and p.status = 'proposed'
         and (p.proposed_link ->> 'research_task_id') is not null) r
   where r.rn = 1
), scored as (
  select ot.*, d.proposal_id, d.proposed_link, d.reason, d.confidence,
         d.updated_at as drafted_at,
         d.proposed_link ->> 'current_owner_name' as current_owner_name_x,
         (select a.l ->> 'to'
            from jsonb_array_elements(d.proposed_link -> 'links') with ordinality a(l, o)
           order by a.o desc limit 1) as last_grantee_x
    from open_tasks ot
    left join draft d on d.research_task_id = ot.id
), cls as (
  select s.*,
         case when s.proposal_id is not null
               and ((s.proposed_link ->> 'draftable')::boolean) is true
               and ((s.proposed_link ->> 'terminates_at_current_owner')::boolean) is false
              then lcc_ownership_mismatch_class(s.current_owner_name_x, s.last_grantee_x)
              else null::text end as mclass,
         case when s.proposal_id is not null
               and ((s.proposed_link ->> 'draftable')::boolean) is true
               and ((s.proposed_link ->> 'terminates_at_current_owner')::boolean) is false
              then lcc_ownership_sponsor_token(s.current_owner_name_x, s.last_grantee_x)
              else null::text end as mtoken
    from scored s
), fam as (
  select c.*,
         c.mtoken is not null and (exists (
           select 1 from public.lcc_ownership_sponsor_family f
            where f.sponsor_entity_id = lcc_entity_survivor(c.entity_id)
              and f.sponsor_token = c.mtoken)) as sponsor_confirmed
    from cls c
), gated as (
  select t.*,
         public.lcc_chain_human_value_floor() as human_floor_x,
         -- Pre-floor: would this reach a person at all? (the pre-B1 rule)
         case
           when t.proposal_id is null then false
           when ((t.proposed_link ->> 'draftable')::boolean) is not true
             then (t.proposed_link ->> 'insufficient_reason') = 'all_transitions_guarded'
           else ((t.proposed_link ->> 'terminates_at_current_owner')::boolean) is false
                and not t.sponsor_confirmed
         end as would_be_human_x
    from fam t
)
select
  id as research_task_id,
  workspace_id,
  title,
  status::text as status,
  priority,
  domain,
  source_record_id,
  entity_id,
  assigned_to,
  created_at,
  updated_at,
  proposal_id is not null as has_draft,
  case
    when proposal_id is null then null::text
    when ((proposed_link ->> 'draftable')::boolean) is not true then
      case proposed_link ->> 'insufficient_reason'
        when 'no_transitions_on_file' then 'no_records'::text
        when 'all_transitions_guarded' then 'all_guarded'::text
        else null::text end
    when ((proposed_link ->> 'terminates_at_current_owner')::boolean) is true then 'agrees'::text
    when ((proposed_link ->> 'terminates_at_current_owner')::boolean) is false then
      case when sponsor_confirmed then 'sponsor_spe'::text else 'mismatch'::text end
    else null::text
  end as action,
  case
    when proposal_id is null then 'awaiting_draft'::text
    when ((proposed_link ->> 'draftable')::boolean) is not true then
      case when (proposed_link ->> 'insufficient_reason') = any (array['no_transitions_on_file','all_transitions_guarded'])
           then 'classified'::text else 'unrecognised_payload'::text end
    when ((proposed_link ->> 'terminates_at_current_owner')::boolean) is not null then 'classified'::text
    else 'unrecognised_payload'::text
  end as split_state,
  -- B1: a person's queue is still gated at $500k. An UNPRICED task
  -- (lane_value absent) is gated too -- "we cannot size it" is not evidence
  -- it is worth an operator's time (P180 / A5c `value_unknown`).
  would_be_human_x and lane_value is not null and lane_value >= human_floor_x as human_actionable,
  (proposed_link ->> 'draftable')::boolean as draftable,
  (proposed_link ->> 'terminates_at_current_owner')::boolean as terminates_at_current_owner,
  proposed_link ->> 'insufficient_reason' as insufficient_reason,
  proposed_link ->> 'current_owner_name' as current_owner_name,
  proposed_link ->> 'address' as address,
  coalesce(jsonb_array_length(coalesce(proposed_link -> 'links', '[]'::jsonb)), 0) as link_count,
  jsonb_array_length(coalesce(proposed_link -> 'rejected', '[]'::jsonb)) as rejected_count,
  ((proposed_link -> 'continuity') ->> 'contiguous')::boolean as contiguous,
  ((proposed_link -> 'continuity') ->> 'breaks')::integer as continuity_breaks,
  reason as draft_reason,
  confidence as draft_confidence,
  drafted_at,
  proposal_id,
  mclass as mismatch_class,
  mtoken as mismatch_sponsor_token,
  -- ---- B1 appended ----
  lane_value,
  human_floor_x as human_value_floor,
  (would_be_human_x and (lane_value is null or lane_value < human_floor_x)) as below_human_floor,
  case
    when proposal_id is null then 'awaiting_draft'::text
    when not would_be_human_x then 'not_human'::text
    when lane_value is null or lane_value < human_floor_x then 'below_value_floor'::text
    else 'actionable'::text
  end as human_gate
from gated t;

comment on view public.v_lcc_ownership_history_lane_split is
  'A1 lane split + B1 human value gate. `human_actionable` = a person must '
  'look at this AND it clears lcc_chain_human_value_floor(). `human_gate` '
  'names the four states (actionable | below_value_floor | not_human | '
  'awaiting_draft) so a floor-held card is not confused with one that was '
  'never a human job. Classification is from the structured payload, never '
  'the drafted prose (P182).';

-- ---------------------------------------------------------------------------
-- 4. RE-OPEN THE BELOW-FLOOR SKIPS.
--
-- These tasks were closed by a rule that no longer describes the cost. The
-- re-open is reversible and batch-tagged; the ledger keeps the prior status
-- and the prior outcome jsonb so `lcc_b1_unreopen` restores them BYTE-FOR-BYTE
-- rather than guessing what was there (the A4 pattern).
--
-- ⚠️ ORDER MATTERS: this must run AFTER the split floor is live (same
-- migration) and after cron 144 carries the new argument, or the 05:10 sweep
-- re-skips every row the next morning.
--
-- ⚠️ `uq_research_tasks_open_source` is UNIQUE on
-- (source_table, source_record_id, research_type, domain) WHERE the row is
-- open, so re-opening a subject that already has an open task would abort the
-- batch. It is excluded, and so are duplicates WITHIN the batch (distinct on).
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_b1_reopen_log (
  id                bigserial primary key,
  batch_tag         text not null,
  action            text not null check (action in ('reopened','unreopened')),
  research_task_id  uuid not null,
  domain            text,
  research_type     text,
  source_record_id  text,
  rank_value        numeric,
  prior_status      text,
  prior_outcome     jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists idx_lcc_b1_reopen_log_batch on public.lcc_b1_reopen_log (batch_tag);
create index if not exists idx_lcc_b1_reopen_log_task  on public.lcc_b1_reopen_log (research_task_id);

comment on table public.lcc_b1_reopen_log is
  'B1: ledger of below_value_floor tasks re-opened once the automated path '
  'made them free. Reverse a batch with lcc_b1_unreopen(batch_tag). Read '
  '`reopened` minus `unreopened`.';

create or replace function public.lcc_b1_reopen_below_floor(
  p_dry_run   boolean default true,
  p_limit     int     default null,
  p_min_value numeric default 0,      -- the AUTOMATED floor to admit against
  p_batch_tag text    default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_tag        text := coalesce(nullif(btrim(p_batch_tag), ''),
                                'b1-reopen-' || to_char(now(), 'YYYYMMDDHH24MISS'));
  v_candidates int;
  v_reopened   int := 0;
  v_held       jsonb;
BEGIN
  -- The admissible set: a below-floor skip on a lane that now has an
  -- automated consumer, still suggested by the worklist, not terminal, and
  -- not colliding with an already-open task for the same subject.
  create temp table _b1_cand on commit drop as
  select distinct on (t.domain, t.research_type, t.source_record_id)
         t.id, t.domain, t.research_type, t.source_record_id,
         t.status::text as prior_status, t.outcome as prior_outcome,
         coalesce(nullif(t.metadata->>'rank_value','')::numeric, 0) as rank_value
    from public.research_tasks t
    join public.v_ownership_chain_worklist w
      on w.source_domain = t.domain
     and w.source_property_id = t.source_record_id
     and w.suggested_research_type = t.research_type
   where t.source_table = 'v_lcc_ownership_chain_completeness'
     and t.status = 'skipped'
     and t.outcome->>'reason' = 'below_value_floor'
     and coalesce(t.outcome->>'terminal','') <> 'true'
     and public.lcc_chain_lane_has_auto_consumer(t.domain, t.research_type)
     and coalesce(nullif(t.metadata->>'rank_value','')::numeric, 0) >= coalesce(p_min_value, 0)
     and not exists (
       select 1 from public.research_tasks o
        where o.source_table = t.source_table
          and o.source_record_id = t.source_record_id
          and o.research_type = t.research_type
          and o.domain = t.domain
          and o.status in ('queued','in_progress'))
   order by t.domain, t.research_type, t.source_record_id, t.updated_at desc, t.id;

  select count(*) into v_candidates from _b1_cand;

  -- Honest counts: name what is HELD and why, rather than reporting only the
  -- admitted set. dia and trace_ownership_to_developer are held by design.
  select jsonb_object_agg(k, n) into v_held from (
    select case
             when not public.lcc_chain_lane_has_auto_consumer(t.domain, t.research_type)
               then 'held_no_auto_consumer:' || t.domain || '/' || t.research_type
             else 'held_other' end as k,
           count(*) n
      from public.research_tasks t
     where t.source_table = 'v_lcc_ownership_chain_completeness'
       and t.status = 'skipped'
       and t.outcome->>'reason' = 'below_value_floor'
       and not public.lcc_chain_lane_has_auto_consumer(t.domain, t.research_type)
     group by 1) s;

  if not p_dry_run then
    with picked as (
      select * from _b1_cand
       order by rank_value desc, id
       limit case when p_limit is null then null else greatest(p_limit, 0) end
    ),
    upd as (
      update public.research_tasks t
         set status = 'queued',
             -- strip the sweep's own keys so an OPEN task never still reads
             -- as "superseded / below_value_floor"; keep a breadcrumb.
             outcome = (coalesce(t.outcome,'{}'::jsonb)
                        - 'status' - 'reason' - 'floor' - 'floor_kind' - 'swept_at')
                       || jsonb_build_object('b1_reopened_at', now(), 'b1_batch', v_tag),
             updated_at = now()
        from picked p
       where t.id = p.id
      returning t.id, p.domain, p.research_type, p.source_record_id,
                p.rank_value, p.prior_status, p.prior_outcome
    ),
    led as (
      insert into public.lcc_b1_reopen_log
        (batch_tag, action, research_task_id, domain, research_type,
         source_record_id, rank_value, prior_status, prior_outcome)
      select v_tag, 'reopened', u.id, u.domain, u.research_type,
             u.source_record_id, u.rank_value, u.prior_status, u.prior_outcome
        from upd u
      returning 1
    )
    select count(*) into v_reopened from led;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'batch_tag', v_tag,
    'auto_floor_applied', coalesce(p_min_value, 0),
    'candidates', v_candidates,
    'limit', p_limit,
    'tasks_reopened', v_reopened,
    'capped', (p_limit is not null and v_candidates > p_limit),
    -- true => `candidates` IS the whole admissible population, not a floor.
    'admitted_head_exhausted', (p_limit is null or v_candidates <= p_limit),
    'held_by_design', coalesce(v_held, '{}'::jsonb));
END;
$function$;

comment on function public.lcc_b1_reopen_below_floor(boolean, int, numeric, text) is
  'B1: re-open below_value_floor skips on lanes that now have an automated '
  'consumer. Dry-run default. Read tasks_reopened and '
  'admitted_head_exhausted, never candidates. Reverse: lcc_b1_unreopen(tag).';

create or replace function public.lcc_b1_unreopen(p_batch_tag text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE v_restored int := 0;
BEGIN
  with tgt as (
    select l.research_task_id, l.prior_status, l.prior_outcome
      from public.lcc_b1_reopen_log l
     where l.batch_tag = p_batch_tag and l.action = 'reopened'
       and not exists (select 1 from public.lcc_b1_reopen_log u
                        where u.research_task_id = l.research_task_id
                          and u.batch_tag = l.batch_tag and u.action = 'unreopened')
  ),
  upd as (
    update public.research_tasks t
       set status = tgt.prior_status::research_status,
           outcome = tgt.prior_outcome,
           updated_at = now()
      from tgt where t.id = tgt.research_task_id
    returning t.id
  ),
  led as (
    insert into public.lcc_b1_reopen_log
      (batch_tag, action, research_task_id, prior_status, prior_outcome)
    select p_batch_tag, 'unreopened', u.id, null, null from upd u
    returning 1
  )
  select count(*) into v_restored from led;
  return jsonb_build_object('batch_tag', p_batch_tag, 'tasks_restored', v_restored);
END;
$function$;

comment on function public.lcc_b1_unreopen(text) is
  'B1: restore a re-opened batch to its prior status + outcome byte-for-byte.';

-- ---------------------------------------------------------------------------
-- 5. SEEDER PREVIEW -- so `admitted_head_exhausted` is observable without
--    minting. Pure read; writes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_b1_chain_seed_preview(
  p_limit          int     default 2000,
  p_min_value      numeric default 500000,
  p_auto_min_value numeric default 0
) returns jsonb
language sql stable
security definer
set search_path to 'public'
as $function$
  with cand as (
    select w.source_domain, w.suggested_research_type, w.rank_value,
           public.lcc_chain_lane_has_auto_consumer(w.source_domain, w.suggested_research_type) as auto_lane
      from public.v_ownership_chain_worklist w
     where coalesce(w.rank_value, 0) >= case
             when public.lcc_chain_lane_has_auto_consumer(w.source_domain, w.suggested_research_type)
             then coalesce(p_auto_min_value, p_min_value) else p_min_value end
       and not exists (
         select 1 from public.research_tasks t
          where t.research_type = w.suggested_research_type
            and t.source_record_id = w.source_property_id
            and t.domain = w.source_domain
            and (t.status in ('queued','in_progress')
                 or (t.status = 'skipped' and coalesce(t.outcome->>'terminal','') = 'true')))
  )
  select jsonb_build_object(
    'limit', p_limit,
    'human_floor', p_min_value,
    'auto_floor', coalesce(p_auto_min_value, p_min_value),
    'would_insert', least(count(*), greatest(p_limit,0)),
    'candidates', count(*),
    'admitted_head_exhausted', count(*) <= greatest(p_limit,0),
    'by_lane', (select jsonb_object_agg(k, n) from (
        select source_domain || '/' || suggested_research_type
               || case when auto_lane then ' [auto]' else ' [human]' end as k,
               count(*) n from cand group by 1) x))
  from cand;
$function$;

comment on function public.lcc_b1_chain_seed_preview(int, numeric, numeric) is
  'B1: what cron 144 would mint under a given floor pair. Read '
  'admitted_head_exhausted -- false means `candidates` is a FLOOR, not a total.';

-- ---------------------------------------------------------------------------
-- 6. CRON 144 -- pass the automated floor. Same name, same schedule, so this
--    replaces the existing job rather than adding a second one.
--    Reverse by re-scheduling with 500000 as the third argument.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('lcc-r6-chain-research', '10 5 * * *',
      $cron$SELECT public.lcc_generate_chain_research_tasks(2000, 500000, 0)$cron$);
  end if;
end $$;
