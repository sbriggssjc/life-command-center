-- ============================================================================
-- P165 — value-rank the research worklist, at the OWNER level (2026-08-22)
--        Applied live to LCC Opps (xengecqvemvfknjvbvrq). Views only, no writes.
--
-- FOUND WHILE VERIFYING P163/P164. Those changes route phantom-contacted and
-- weak-reach owners into `owner_contact_manual` research tasks. Measuring
-- whether that lane is actually consumed:
--
--   research_type              open   ever completed   created 30d
--   ------------------------   ----   --------------   -----------
--   property_missing_recorded_owner 1184   4,815 (1,007 in 30d)   1,019   HEALTHY
--   true_owner_needs_salesforce      816     675 (32 in 30d)         20   slow, alive
--   trace_ownership_to_developer      18      40 (28 in 30d)        129   alive
--   establish_ownership_history      545       0                     25   NEVER CONSUMED
--   owner_contact_manual             316       0                    223   NEVER CONSUMED
--   npi_missing_inventory            203       0                    203   NEVER CONSUMED
--   confirm_tenant_mismatch           26       0                     12   NEVER CONSUMED
--   npi_new_registration              17       0                     17   NEVER CONSUMED
--   state_lease_distress_review        8       0                      8   NEVER CONSUMED
--   person_email_merge_review          8       0                      8   NEVER CONSUMED
--
-- 1,123 open tasks across SEVEN types have never had a single completion or skip
-- in the system's history. `owner_contact_manual` is one of them — i.e. P163/P164
-- carefully route high-value owners into a lane nobody has ever worked. That is
-- the Consumption-Layer rule ("no new producer without a named consumer")
-- violated by a change that cited it.
--
-- WHY IT IS IGNORED, and the fix: 3,148 open tasks, 80% of them UNSIZED, is the
-- "5,447 badge that is mostly noise" failure. The doctrine's prescription is
-- value-gate, rank, cap. These views do that.
--
-- ⚠️ RANK OWNERS, NOT TASKS — TASK-LEVEL RENT SUMS ARE 4.65x INFLATED.
-- An owner's rent is carried on EVERY one of its tasks, so summing across tasks
-- multiplies it by the task count. Boyd Watterson alone has 27 open tasks x
-- $179.8M = $4.7B of pure double-count, 69% of the task-summed total. Measured:
--
--     task-summed "actionable" rent    $6,782,080,389   INFLATED, do not quote
--     DISTINCT-owner actionable rent   $1,458,226,132   the honest figure
--
-- An operator works an OWNER, not 26 deed-pull tasks, so the owner is the unit.
--
-- HONEST HEADLINE (v_lcc_research_owner_worklist):
--     value_band  owners   distinct rent   tasks   need a contact
--     a_top ≥$5M      57     $968,379,345    125       31
--     b_mid           390    $489,846,787    422       15
--     c_small          75     $19,734,363     79       56
--     d_unsized       258              $0    263      213
--
-- 57 owners carrying $968M have open research tasks averaging 49 days old and
-- never once worked — headed by Boyd Watterson ($179.8M, 27 tasks, 64 days),
-- Cira Square Master Tenant ($34.4M), LCPC Pentagon Property ($34.3M).
--
-- NOT FIXED HERE (surfaced, deliberately): the seven never-consumed producers
-- still emit. Per doctrine each needs a named consumer, a value gate and an
-- auto-retire predicate, or it should stop producing. `establish_ownership_history`
-- is the clearest case — 545 open, 0 ever completed, 1,690 skipped, and it emits
-- ONE TASK PER PROPERTY with no value gate (hence Boyd Watterson's 26).
--
-- Also visible in the top-15: "George Washington University" and "George
-- Washington University (The)" are separate entities ($23.8M + $23.4M) — a merge
-- candidate the ranked surface makes obvious.
--
-- REVERSAL: drop view if exists v_lcc_research_owner_worklist;
--           drop view if exists v_lcc_research_worklist_ranked;
-- ============================================================================

create or replace view v_lcc_research_worklist_ranked as
with t as (
  select rt.id, rt.research_type, rt.title, rt.status, rt.entity_id, rt.domain,
         rt.created_at, rt.priority, rt.source_table, rt.source_record_id,
         e.name as entity_name,
         case when rt.entity_id is null then 0
              else lcc_owner_known_annual_rent(rt.entity_id) end as entity_annual_rent
  from research_tasks rt
  left join entities e on e.id = rt.entity_id
  where rt.status in ('queued','in_progress')
)
select t.*,
       (now()::date - t.created_at::date) as age_days,
       case when t.entity_annual_rent >= 5000000 then 'a_top'
            when t.entity_annual_rent >=  500000 then 'b_mid'
            when t.entity_annual_rent >        0 then 'c_small'
            else                                      'd_unsized' end as value_band,
       -- ACTIONABLE = we can put a number on it. Everything else is real work,
       -- but it is not work to hand an operator FIRST.
       (t.entity_annual_rent >= 500000) as is_actionable_now
from t;

create or replace view v_lcc_research_owner_worklist as
-- ONE ROW PER OWNER. See the double-count note in the header — ranking tasks
-- multiplies an owner's rent by its task count.
select r.entity_id as owner_entity_id,
       r.entity_name as owner_name,
       max(r.entity_annual_rent) as known_annual_rent,
       count(*) as open_tasks,
       min(r.created_at)::date as oldest_task,
       max(r.age_days) as oldest_age_days,
       string_agg(distinct r.research_type, ', ' order by r.research_type) as task_types,
       bool_or(r.research_type = 'owner_contact_manual') as needs_a_contact,
       max(r.value_band) as value_band,
       bool_or(r.is_actionable_now) as is_actionable_now
from v_lcc_research_worklist_ranked r
where r.entity_id is not null
group by 1,2;

-- ── VERIFICATION GATE ───────────────────────────────────────────────────────
--   select value_band, count(*), sum(known_annual_rent)
--     from v_lcc_research_owner_worklist group by 1;
--       expect a_top 57 / $968,379,345
--   select count(*) from v_lcc_research_owner_worklist where value_band='a_top'
--     and needs_a_contact;                                    -- expect 31
--   -- the double-count check: task-sum must EXCEED distinct-owner sum
--   select (select sum(entity_annual_rent) from v_lcc_research_worklist_ranked
--            where is_actionable_now)
--        > (select sum(known_annual_rent) from v_lcc_research_owner_worklist
--            where is_actionable_now);                        -- expect true
