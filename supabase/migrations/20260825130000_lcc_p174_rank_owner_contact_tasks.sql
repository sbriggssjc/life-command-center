-- ============================================================================
-- P174 — value-rank owner_contact_manual so the answerable lane is REACHABLE
--        (2026-08-25). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--
-- ⚠️ THIS FIXES A DEFECT IN P173, SHIPPED HOURS EARLIER.
-- P173 added a "Find the contact" button to owner_contact_manual research cards,
-- making the only dead lane in the system answerable for the first time. Correct,
-- tested, deployed — and INVISIBLE.
--
-- The Research page serves /api/queue?view=research ordered
-- `priority.asc, created_at.asc`, 25 per page. Measured:
--
--     page 1                            25 of 25 `true_owner_needs_salesforce`
--                                        (priority 20), 0 actionable
--     first owner_contact_manual         row 1,869  ->  PAGE 75
--
-- Nobody pages to 75. The button existed on cards no operator would ever see.
-- **A fix that ships behind 74 pages of other work has not shipped.**
--
-- ROOT CAUSE: owner_contact_manual carried a FLAT priority 50 — the unranked
-- default — while `true_owner_needs_salesforce` had a hard 20. The producers for
-- `property_missing_recorded_owner` (21-25, 50-74) and
-- `establish_ownership_history` (50-100) DO value-rank; the contact producer
-- never did. So a $179.8M owner's contact task ranked identically to a $0 one.
--
-- THE RANKING (by the owner's known annual rent):
--     >= $5M   -> 5    32 tasks  $740.0M   above everything; page 1
--     >= $500k -> 15   15 tasks   $18.4M   above the SF lane (20)
--     >  $0    -> 40   56 tasks   $14.8M
--     unsized  -> 55  213 tasks        -   sinks BELOW today's 50
--
-- The unsized 213 moving DOWN matters as much as the 32 moving up: a blanket
-- lowering would just have inverted the noise. Idempotent (rows already at the
-- target priority are skipped); reversible via metadata.prior_priority.
--
-- RESULT: page 1 is now 25 actionable contact tasks, every one carrying the
-- P173 button, top-value first.
--
-- ⚠️ PUBLIC ENTITIES — AND A DELIBERATE REFUSAL TO OVER-APPLY THE DOCTRINE.
-- Three institutional owners landed at priority 5. Scott's rule is exact:
-- "Public entities like a state or county will not be prospected."
--   • United States Postal Service -> DEMOTED to 60. Federal. Unambiguous.
--   • George Washington University (x2) -> LEFT AT 5, flagged for Scott.
--     GWU is a PRIVATE university. It is not a state or county, and demoting it
--     would be extending the doctrine rather than applying it — the same
--     over-application that made P164 clear 103 individual owners.
--
-- ALSO SURFACED, not fixed:
--   • "George Washington University" and "George Washington University (The)"
--     are two entities, $23.8M + $23.4M — one prospect, a merge candidate.
--   • "Penzance Management LLC" appears TWICE at identical rent in the priority-5
--     block — duplicate task or duplicate entity.
--
-- VERIFICATION GATE:
--   select research_type, count(*) from research_tasks
--    where status in ('queued','in_progress')
--    order by priority asc, created_at asc limit 25;   -- expect all owner_contact_manual
--   select * from lcc_rank_owner_contact_tasks(true);  -- expect empty (idempotent)
--
-- REVERSAL:
--   update research_tasks set priority = (metadata->>'prior_priority')::int
--    where metadata->>'batch' in ('p174-rank-contact-tasks-20260825',
--                                 'p174-public-demote-20260825');
-- ============================================================================

create or replace function lcc_rank_owner_contact_tasks(
  p_dry_run boolean default true, p_batch text default null
) returns table(new_priority int, tasks bigint, annual_rent numeric)
language plpgsql as $$
declare v_batch text := coalesce(p_batch, 'rank-occ-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _rk;
  create temp table _rk on commit drop as
  select rt.id, rt.priority as old_priority,
         lcc_owner_known_annual_rent(rt.entity_id) as rent,
         case when lcc_owner_known_annual_rent(rt.entity_id) >= 5000000 then 5
              when lcc_owner_known_annual_rent(rt.entity_id) >=  500000 then 15
              when lcc_owner_known_annual_rent(rt.entity_id) >       0  then 40
              else 55 end as new_prio
  from research_tasks rt
  where rt.research_type = 'owner_contact_manual'
    and rt.status in ('queued','in_progress')
    and rt.entity_id is not null;

  delete from _rk where new_prio = old_priority;   -- idempotent

  if p_dry_run then
    return query select r.new_prio, count(*)::bigint, coalesce(sum(r.rent),0)
                 from _rk r group by r.new_prio order by r.new_prio;
    return;
  end if;

  update research_tasks rt
     set priority = r.new_prio,
         updated_at = now(),
         metadata = coalesce(rt.metadata,'{}'::jsonb)
                    || jsonb_build_object('prior_priority', r.old_priority,
                                          'ranked_by','owner_annual_rent',
                                          'batch', v_batch)
  from _rk r where r.id = rt.id;

  return query select r.new_prio, count(*)::bigint, coalesce(sum(r.rent),0)
               from _rk r group by r.new_prio order by r.new_prio;
end $$;
