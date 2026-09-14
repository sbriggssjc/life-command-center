-- ============================================================================
-- P172 — supersede Decision Center cards whose SUBJECT was merged away
--        (2026-08-25). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--
-- Found by lcc_audit_merge_path_coverage() (P171), which flagged
-- lcc_decisions.subject_entity_id as the largest uncovered entity reference:
-- 286 stranded rows, 80 of them STILL OPEN, across 219 distinct ghost entities.
--
-- ⚠️ WHY THIS IS WORSE THAN A DEAD QUEUE. lcc_decisions is HEALTHY — 2,687 cards
-- closed, 1,254 in the last 30 days. So these are not rotting in an ignored
-- lane; they are being actively worked, against entities that no longer exist.
-- A dead queue wastes nothing. A busy queue pointed at ghosts produces wrong
-- verdicts.
--
-- THE 80 OPEN ONES:
--     78  junk_entity_name              -> superseded here
--      1  sf_contact_account_mismatch   -> LEFT for a human
--      1  sf_link_collision             -> LEFT for a human
--
-- WHY junk_entity_name IS SAFE TO AUTO-CLOSE, and the other two are not:
-- the merge ALREADY ANSWERED the junk question. Read by name, the ghost IS the
-- junk and the survivor is the clean form:
--
--     "JBG SMITH Properties | Ares Management"      -> "JBG Smith Properties"
--     "Mark Neumann | Columbia Development Group"   -> "Columbia Development Group"
--     "AP Williams | SOUTH QUEEN ASSOCIATES, LLC"   -> "South Queen Associates LLC"
--     "InCommercial Property Group"                 -> "Incommercial Property Group"
--     "Terreno Realty"                              -> "Terreno Realty Corporation"
--
-- Pipe-delimited multi-party captures and casing variants, each merged into its
-- clean form. Asking "is this name junk?" about an entity that was merged into
-- the clean version is moot. An sf_link_collision is NOT answered by a merge, so
-- it stays open — the disposition is per TYPE, not blanket, which is the P167
-- lesson applied before it could bite.
--
-- ⚠️ 'superseded', NOT 'decided' OR 'skipped'. Nobody decided anything and
-- nobody skipped it; the merge overtook the question. The right word was found
-- by the database rejecting a guess: a first attempt wrote status='resolved' and
-- hit `lcc_decisions_status_check`, whose allowed set is
-- (open | decided | skipped | superseded). A CHECK constraint doing its job is
-- cheaper than a wrong status shipped quietly.
--
-- A card with no resolvable survivor is NOT superseded — it is left open,
-- because "merged into nothing" is not an answer.
--
-- RESULT: open backlog 2,358 -> 2,280. Open cards on a merged subject 80 -> 2.
--
-- NOT FIXED HERE: the 206 ALREADY-DECIDED stranded cards keep a subject pointer
-- to a tombstone. They are history, and rewriting decided history to point
-- somewhere else would falsify the record of what was actually decided about
-- what. Left deliberately.
--
-- Also still open: lcc_decisions.subject_entity_id remains absent from the merge
-- path itself (P171 class 1), so new strands can form. This supersedes the
-- backlog; it does not prevent recurrence.
--
-- VERIFICATION GATE (all PASS):
--   open decisions on a merged subject   2   (the two non-junk types)
--   superseded in this batch            78
--   idempotent re-run                    0
--
-- REVERSAL:
--   update lcc_decisions set status='open', decided_at=null,
--          metadata = metadata - 'auto_closed' - 'reason' - 'survivor' - 'batch'
--    where metadata->>'batch' = 'p172-decisions-merged-20260825';
-- ============================================================================

create or replace function lcc_close_decisions_on_merged_subjects(
  p_dry_run boolean default true, p_batch text default null
) returns table(action text, cards bigint)
language plpgsql as $$
declare v_batch text := coalesce(p_batch, 'dec-merged-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _dm;
  create temp table _dm on commit drop as
  select d.id, d.decision_type, e.name as ghost_name,
         lcc_entity_survivor(d.subject_entity_id) as surv_id
  from lcc_decisions d
  join entities e on e.id = d.subject_entity_id
  where e.merged_into_entity_id is not null
    and d.decided_at is null
    -- Per TYPE, never blanket. Only junk_entity_name is answered by a merge.
    and d.decision_type = 'junk_entity_name';

  -- "Merged into nothing" is not an answer.
  delete from _dm where surv_id is null;

  if p_dry_run then
    return query select 'DRY-RUN would_supersede'::text, count(*)::bigint from _dm;
    return;
  end if;

  update lcc_decisions d
     set decided_at = now(),
         status  = 'superseded',
         metadata = coalesce(d.metadata,'{}'::jsonb)
                    || jsonb_build_object('auto_closed', true,
                                          'reason','subject_merged_away_question_moot',
                                          'survivor', m.surv_id::text,
                                          'batch', v_batch)
  from _dm m where m.id = d.id;

  return query select 'SUPERSEDED (batch ' || v_batch || ')', count(*)::bigint from _dm;
end $$;
