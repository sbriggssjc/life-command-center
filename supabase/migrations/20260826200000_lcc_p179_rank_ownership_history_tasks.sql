-- ============================================================================
-- P179 — make `establish_ownership_history` ANSWERABLE, then value-rank it
--        (2026-08-26). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--
-- TWO CORRECTIONS TO THE AUDIT ITEM THAT SENT ME HERE. It read "545 open, 0
-- completed, one task per property with no value gate, never consumed." Both
-- substantive claims were wrong:
--   • It HAS a value gate — `below_value_floor` has swept 1,548 tasks.
--   • It IS consumed — 1,690 skipped / 545 queued, of which 142 closed as
--     `chain_gap_resolved_or_changed` (the premise clearing on its own, still
--     happening through 2026-08-21).
-- "0 completed" was true; "never consumed" was false. Same trap as the Class-2
-- timestamp bug one level up: **`completed` is not the only closure status.**
--
-- THE REAL DEFECT WAS CLASS 3 (unanswerable), NOT A MISSING GATE. P173 gave the
-- research lane a capture path and gated the button to ONE research_type, so an
-- `establish_ownership_history` card offered only Complete / Follow-up / Dismiss
-- while `completeResearch()` posts just `{ research_task_id }` — working a card
-- destroyed it and captured nothing.
--
-- Capture path (ops.js `researchOpenOwnership`, guarded by P179 assertions in
-- test/frontend-module-load-order.test.mjs) reuses the property panel's existing
-- Ownership tab. No new write surface — the same discipline as P173.
--   ⚠️ It routes on the PROPERTY (`domain` + `source_record_id`), never
--   `entity_id`. The task's subject is a property whose ownership CHAIN is
--   incomplete, so the linked owner is the disputed thing, not the destination.
--   A test asserts the button is NOT wired to entity_id.
--
-- ⚠️ ORDER MATTERED: ranking BEFORE the capture path would have promoted 214
-- owners' worth of unanswerable work onto page 1, displacing the contact lane
-- P174 had just made reachable. Capture first, then rank.
--
-- THE RANKING (by the owner's known annual rent, deduped per owner — never
-- summed per task, which double-counts ~2x here):
--     >= $5M   -> 30    87 tasks /  36 owners
--     >= $500k -> 45   395 tasks / 365 owners
--     >  $0    -> 65    22 tasks /  18 owners
--     unsized  -> 85    40 tasks /  35 owners
-- Bands sit BELOW the P174 contact lane (5/15/40/55) on purpose: contact
-- acquisition is a direct BD action, ownership history is the data completeness
-- that feeds it. Before: 214 owners and $709.7M sat at a flat priority 100 while
-- the top of the lane held $259.5M — the rank was inverted at the bottom.
--
-- ⚠️⚠️ THE CLASS-7 NEAR-MISS — AND WHY THE OBVIOUS METRIC IS THE WRONG ONE.
-- After ranking, the first `establish_ownership_history` row in the GLOBAL
-- research list sits at **row 1,528 — page 62**. Ranking to priority 30 did not
-- make it reachable, which is precisely the P173/P174 failure repeating.
--
-- **But the fix is NOT to demote what sits above it.** Measured before acting:
-- the 1,527 rows ahead are `true_owner_needs_salesforce` (816) and
-- `property_missing_recorded_owner` (665), and BOTH LANES ARE HEALTHY AND
-- ACTIVELY WORKED — 4,772 and 595 lifetime completions, the former completing
-- rows the same day this was measured. Demoting real, drained work to surface a
-- newer lane would have been the actual defect.
--
-- The reachability answer for this lane is the page's **research_type FILTER**,
-- not the global rank. With the lane selected, page 1 now holds **19 distinct
-- owners / $395.0M**, top owner $179.8M — where before the same page 1 was drawn
-- from a flat 50-100 band with 214 owners dumped at the bottom. **A ranked lane
-- reachable behind one filter click is a different thing from a lane buried at
-- page 62 of an unfiltered list; do not conflate them, and do not "fix" page 1
-- by demoting healthy work.**
--
-- OPEN FOLLOW-UP (recorded in the playbook, not built here): the Research page
-- has a type filter but no lane PICKER showing per-lane open counts and value.
-- That, not further priority juggling, is what would make five lanes with
-- different cadences navigable.
--
-- VERIFICATION GATE (all PASS):
--   owners >= $5M still at priority 100        0
--   idempotent re-run                          0 tasks
--   page 1 of the UNFILTERED list              still 25/25 owner_contact_manual
--                                              (P174's fix is not displaced)
--   frontend guards                            40/40, incl. 2 mutation tests
--
-- REVERSAL:
--   update research_tasks set priority = (metadata->>'prior_priority')::int
--    where metadata->>'batch' = 'p179-rank-20260826';
-- ============================================================================

create or replace function lcc_rank_ownership_history_tasks(
  p_dry_run boolean default true, p_batch text default null
) returns table(new_priority int, tasks bigint, owners bigint, annual_rent numeric)
language plpgsql as $$
declare v_batch text := coalesce(p_batch, 'rank-ooh-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _rk2;
  create temp table _rk2 on commit drop as
  select rt.id, rt.entity_id, rt.priority as old_priority,
         lcc_owner_known_annual_rent(rt.entity_id) as rent,
         case when lcc_owner_known_annual_rent(rt.entity_id) >= 5000000 then 30
              when lcc_owner_known_annual_rent(rt.entity_id) >=  500000 then 45
              when lcc_owner_known_annual_rent(rt.entity_id) >       0  then 65
              else 85 end as new_prio
  from research_tasks rt
  where rt.research_type = 'establish_ownership_history'
    and rt.status in ('queued','in_progress')
    and rt.entity_id is not null;

  delete from _rk2 where new_prio = old_priority;   -- idempotent

  if p_dry_run then
    return query select r.new_prio, count(*)::bigint, count(distinct r.entity_id)::bigint,
                        coalesce(sum(distinct r.rent),0)
                 from _rk2 r group by r.new_prio order by r.new_prio;
    return;
  end if;

  update research_tasks rt
     set priority = r.new_prio,
         updated_at = now(),
         metadata = coalesce(rt.metadata,'{}'::jsonb)
                    || jsonb_build_object('prior_priority', r.old_priority,
                                          'ranked_by','owner_annual_rent',
                                          'batch', v_batch)
  from _rk2 r where r.id = rt.id;

  return query select r.new_prio, count(*)::bigint, count(distinct r.entity_id)::bigint,
                      coalesce(sum(distinct r.rent),0)
               from _rk2 r group by r.new_prio order by r.new_prio;
end $$;
