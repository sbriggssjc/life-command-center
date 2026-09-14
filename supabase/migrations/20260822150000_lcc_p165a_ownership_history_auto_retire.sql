-- ============================================================================
-- P165a — auto-retire predicate for `establish_ownership_history` (2026-08-22)
--         Applied live to LCC Opps (xengecqvemvfknjvbvrq). Functions only.
--
-- The Consumption-Layer doctrine requires every operator-facing producer to have
-- (1) a named consumer, (2) an auto-retire sweep, (3) a ranked/capped actionable
-- surface, (4) honest counts. `establish_ownership_history` had NONE of them:
--
--     545 open, 0 EVER COMPLETED, 1,690 skipped, oldest 2026-06-19
--     emits ONE TASK PER PROPERTY with no value gate
--     (Boyd Watterson alone carries 26 of them)
--
-- This adds (2). P165 added (3) and (4) via v_lcc_research_owner_worklist.
-- (1) — a named consumer — is still missing and is called out below.
--
-- ⚠️ IT RETIRES 0 TASKS TODAY, AND THAT IS THE HONEST RESULT, NOT A BUG.
-- Every one of the 545 premises was re-tested against the source view
-- (v_lcc_ownership_chain_completeness, joined on source_property_id + domain):
-- ALL 545 are still genuinely incomplete. This backlog is not stale-premise
-- noise — it is real, un-done work that nothing consumes. The sweep is the
-- durable mechanism that stops it ROTTING in future, in the same spirit as the
-- Phase-A1 promote endpoint that was input-starved on the day it shipped.
--
-- ⚠️ THE JOIN KEY IS (source_record_id, domain), NOT source_record_id ALONE.
-- `source_record_id` is a BARE property id ("3113"), and dia and gov both have a
-- property 3113. A first attempt joined on a composed "domain:property" string,
-- matched 0 of 545, and would have reported "no source row" for every task — a
-- clean-looking 100% that meant nothing. Measure the actual column format before
-- writing the join.
--
-- PROVEN BY A SELF-ROLLING-BACK SYNTHETIC GATE (a sweep that has never been made
-- to fire is a guess): seed one task against a property whose chain IS complete,
-- run the sweep, assert it was retired AND marked `skipped` AND stamped
-- reason='premise_cleared_chain_complete', then RAISE to roll the whole thing
-- back. Verified afterwards: 0 synthetic residue, 545 open tasks unchanged.
--
-- REVERSIBLE BY DESIGN: retirement sets status='skipped' and stamps
-- outcome.batch — it never deletes. lcc_unretire_ownership_history_tasks(batch)
-- re-opens everything a given sweep closed.
--
-- STILL OPEN (surfaced, deliberately not built here):
--   • NO CONSUMER. 0 of 545 have ever been completed. Per doctrine this producer
--     should either get a named consumer or stop producing. Value-ranked, only
--     29 tasks / 27 owners are >= $5M — that is the workable head; 516 are below.
--   • NO VALUE GATE at the producer. It emits one task per property regardless
--     of value, which is what makes the surface unreadable.
--   • Six OTHER research types are equally never-consumed (owner_contact_manual
--     316, npi_missing_inventory 203, confirm_tenant_mismatch 26,
--     npi_new_registration 17, state_lease_distress_review 8,
--     person_email_merge_review 8) — 1,123 open tasks with zero completions in
--     system history. owner_contact_manual is the lane P163/P164 route into.
--
-- REVERSAL: drop function if exists lcc_retire_cleared_ownership_history_tasks(boolean,text);
--           drop function if exists lcc_unretire_ownership_history_tasks(text);
-- ============================================================================

create or replace function lcc_retire_cleared_ownership_history_tasks(
  p_dry_run boolean default true,
  p_batch   text    default null
) returns table(action text, tasks bigint)
language plpgsql as $$
declare
  v_batch text := coalesce(p_batch, 'oh-retire-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  create temp table _cleared on commit drop as
  select rt.id
  from research_tasks rt
  join v_lcc_ownership_chain_completeness v
    on v.source_property_id = rt.source_record_id
   and v.source_domain      = rt.domain          -- BOTH keys; see header note
  where rt.research_type = 'establish_ownership_history'
    and rt.status in ('queued','in_progress')
    and v.chain_complete;                        -- the premise has cleared

  if p_dry_run then
    return query select 'DRY-RUN would_retire'::text, count(*)::bigint from _cleared;
    return;
  end if;

  update research_tasks rt
     set status = 'skipped',                     -- reversible: never deleted
         completed_at = now(),
         updated_at = now(),
         outcome = coalesce(rt.outcome,'{}'::jsonb)
                   || jsonb_build_object('auto_retired', true,
                                         'reason', 'premise_cleared_chain_complete',
                                         'batch', v_batch)
  from _cleared c where c.id = rt.id;

  return query select 'RETIRED (batch ' || v_batch || ')', count(*)::bigint from _cleared;
end $$;

create or replace function lcc_unretire_ownership_history_tasks(p_batch text)
returns table(action text, tasks bigint) language plpgsql as $$
begin
  update research_tasks
     set status='queued', completed_at=null, updated_at=now(),
         outcome = outcome - 'auto_retired' - 'reason' - 'batch'
   where research_type='establish_ownership_history'
     and outcome->>'batch' = p_batch;
  return query select 'REVERTED batch ' || p_batch, count(*)::bigint
               from research_tasks where research_type='establish_ownership_history'
                 and outcome->>'batch' is null and status='queued';
end $$;

-- ── VERIFICATION GATE ───────────────────────────────────────────────────────
--   select * from lcc_retire_cleared_ownership_history_tasks(true);
--     expect 0 today — every premise still holds (re-measure before quoting)
--   select count(*) from research_tasks
--    where research_type='establish_ownership_history' and status in ('queued','in_progress');
--     expect 545 (unchanged by the dry run)
--
-- SUGGESTED SCHEDULE (not created here — a sweep that retires 0 needs no cron
-- until the producer has a consumer): daily alongside the other retire sweeps.
