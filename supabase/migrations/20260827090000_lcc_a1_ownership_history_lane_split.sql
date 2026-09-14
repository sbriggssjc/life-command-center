-- ============================================================================
-- A1 — `establish_ownership_history` is FOUR jobs wearing one label. Split it.
--      (2026-08-27). LCC Opps (xengecqvemvfknjvbvrq).
--
-- THE FINDING. The lane reads 545 open / **0 completions in 68 days** (first
-- seeded 2026-06-19). It is not short of answers: **545 of 545** already carry a
-- finished, deterministic, record-cited draft in `lcc_clean_assist_proposals`
-- (source `ownership_chain_draft`, P131/P133). Nobody completes one because the
-- lane presents four structurally different jobs as one "go research this" queue:
--
--   agrees      380  (450 links, 337 contiguous)  a CONFIRMATION, not a question
--   mismatch     73  (120 links,  57 contiguous)  a DATA-INTEGRITY alert
--   no_records   74  (0 links)                    unanswerable from what we hold
--   all_guarded  18  (0 links)                    transfers EXIST; all guard-rejected
--
-- An operator facing *confirm what you already believe* mixed with *your
-- ownership record is contradicted* mixed with *this cannot be answered* learns
-- to skip all of it. 68 days of zero completions is what that looks like.
--
-- THIS MIGRATION SPLITS ONLY. It writes no ownership links, retires nothing and
-- applies nothing. A2 (apply the 380) / A3 (route the 73) / A4 (retire the 74) /
-- A4b (adjudicate the 18) each land separately and each is reversible.
--
-- ⚠️ CLASSIFY FROM THE STRUCTURED PAYLOAD, NEVER FROM THE `reason` PROSE.
-- Measured 2026-08-27: `reason ilike '%does not match the current owner%'` and
-- `(proposed_link->>'terminates_at_current_owner')::boolean is false` BOTH return
-- 73, with **0 disagreements** — and the prose detector is still wrong to build
-- on. It is the P182 trap (a text detector over prose the drafter generates,
-- structurally unable to survive a wording change), and it **cannot see the
-- 74/18 split at all**: that distinction exists only in `insufficient_reason`.
-- This view reads booleans and enum-valued reason keys. Nothing greps prose.
--
-- ⚠️ AND IT DOES NOT SILENTLY DROP OR SILENTLY BUCKET ANYTHING.
--   * LEFT JOIN, not INNER. A task whose draft has not been written yet is
--     `split_state='awaiting_draft'` with a NULL action — visible and countable.
--     It is 0 today (verified 545/545, no orphans, no duplicate drafts, no draft
--     pointing at a non-open task), but the nightly seeder (06:35) mints new lane
--     rows BEFORE the drafter runs (06:45), so a non-zero window is normal and
--     must never read as "no records".
--   * A draft whose payload yields none of the four actions is
--     `split_state='unrecognised_payload'`, NOT a NULL that merges with
--     awaiting_draft. If the drafter ever emits a new `insufficient_reason`, it
--     surfaces as its own count instead of being absorbed into a bucket it does
--     not belong to. That conflation is the P181 failure ("one label covering two
--     different facts is what made it invisible") and this lane is where it bites.
--
-- ⚠️ `no_records` AND `all_guarded` MUST NOT BE MERGED (P181). "Nothing is
-- recorded" and "we distrust everything recorded" call for different actions:
-- A4 auto-retires the first; the second is a human adjudication of whether a
-- P138 guard was over-strict, and folding it into an auto-retire would silently
-- discard 18 properties whose transfers demonstrably exist.
--
-- HONEST COUNTS. `human_actionable` is TRUE only for `mismatch` and
-- `all_guarded`. `agrees` and `no_records` are not questions for a human, so a
-- badge that counts them is the badge-that-is-noise failure this repo has paid
-- for repeatedly. The lane badge reads **91**, not 545.
--
-- VALUE IS PER OWNER, NEVER PER TASK (P180 rule 1) — this lane was measured at
-- 2x task-per-owner inflation. The rollup sums `lcc_owner_known_annual_rent`
-- over DISTINCT `entity_id` inside each action group, and reports the task count
-- separately. NULL means "cannot be sized", never $0 (P180 rule 2).
--
-- REVERSAL:
--   drop view if exists v_lcc_ownership_history_lane_actions;
--   drop view if exists v_lcc_ownership_history_lane_split;
--   -- and restore the prior body of v_lcc_research_lane_summary (20260826210000)
--   -- to drop the appended human_actionable_tasks column.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The split: one row per OPEN establish_ownership_history task.
-- ---------------------------------------------------------------------------
create or replace view v_lcc_ownership_history_lane_split as
with open_tasks as (
  select rt.id, rt.workspace_id, rt.title, rt.status, rt.priority, rt.domain,
         rt.source_record_id, rt.entity_id, rt.assigned_to,
         rt.created_at, rt.updated_at
  from research_tasks rt
  where rt.research_type = 'establish_ownership_history'
    and rt.status in ('queued','in_progress')
),
-- One draft per task. There are no duplicates today, but ranking rather than
-- assuming means a future double-write degrades to "newest wins" instead of
-- fanning the task out into two rows and double-counting the lane.
draft as (
  select *
  from (
    select p.proposal_id, p.proposed_link, p.reason, p.confidence, p.updated_at,
           (p.proposed_link->>'research_task_id')::uuid as research_task_id,
           row_number() over (
             partition by (p.proposed_link->>'research_task_id')::uuid
             order by p.proposal_id desc
           ) as rn
    from lcc_clean_assist_proposals p
    where p.source = 'ownership_chain_draft'
      and p.status = 'proposed'
      and p.proposed_link->>'research_task_id' is not null
  ) r
  where r.rn = 1
)
select
  t.id                                                        as research_task_id,
  t.workspace_id,
  t.title,
  t.status::text                                              as status,
  t.priority,
  t.domain,
  t.source_record_id,
  t.entity_id,
  t.assigned_to,
  t.created_at,
  t.updated_at,
  (d.proposal_id is not null)                                 as has_draft,
  -- The four actions. NULL only when split_state says why.
  case
    when d.proposal_id is null then null
    when (d.proposed_link->>'draftable')::boolean is not true then
      case d.proposed_link->>'insufficient_reason'
        when 'no_transitions_on_file'  then 'no_records'
        when 'all_transitions_guarded' then 'all_guarded'
        else null
      end
    when (d.proposed_link->>'terminates_at_current_owner')::boolean is true  then 'agrees'
    when (d.proposed_link->>'terminates_at_current_owner')::boolean is false then 'mismatch'
    else null
  end                                                         as action,
  case
    when d.proposal_id is null then 'awaiting_draft'
    when (d.proposed_link->>'draftable')::boolean is not true then
      case when d.proposed_link->>'insufficient_reason'
                in ('no_transitions_on_file','all_transitions_guarded')
           then 'classified' else 'unrecognised_payload' end
    when (d.proposed_link->>'terminates_at_current_owner')::boolean is not null
      then 'classified'
    else 'unrecognised_payload'
  end                                                         as split_state,
  -- Is this a question a HUMAN must answer? A2 applies `agrees`; A4 retires
  -- `no_records`. Neither belongs on an operator badge.
  case
    when d.proposal_id is null then false
    when (d.proposed_link->>'draftable')::boolean is not true
      then d.proposed_link->>'insufficient_reason' = 'all_transitions_guarded'
    else (d.proposed_link->>'terminates_at_current_owner')::boolean is false
  end                                                         as human_actionable,
  (d.proposed_link->>'draftable')::boolean                    as draftable,
  (d.proposed_link->>'terminates_at_current_owner')::boolean  as terminates_at_current_owner,
  d.proposed_link->>'insufficient_reason'                     as insufficient_reason,
  d.proposed_link->>'current_owner_name'                      as current_owner_name,
  d.proposed_link->>'address'                                 as address,
  coalesce(jsonb_array_length(coalesce(d.proposed_link->'links', '[]'::jsonb)), 0) as link_count,
  jsonb_array_length(coalesce(d.proposed_link->'rejected', '[]'::jsonb))           as rejected_count,
  (d.proposed_link->'continuity'->>'contiguous')::boolean     as contiguous,
  (d.proposed_link->'continuity'->>'breaks')::int             as continuity_breaks,
  d.reason                                                    as draft_reason,
  d.confidence                                                as draft_confidence,
  d.updated_at                                                as drafted_at,
  d.proposal_id
from open_tasks t
left join draft d on d.research_task_id = t.id;

grant select on v_lcc_ownership_history_lane_split to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The rollup that drives the action chips.
--
-- The chip count MUST be the whole-lane universe, not the rows on the current
-- page — a chip reading "73" that filters to 6 visible cards is the
-- badge-that-lies failure P139 had to fix after shipping it. Because the API
-- filters server-side off the split view, selecting a chip pages through the
-- whole action, so the number on the chip is the number reachable.
--
-- `total_annual_rent` sums over DISTINCT owners inside each action. An owner
-- holding properties in two actions is counted in both — correct per group,
-- and the reason these figures must never be summed into a lane total.
-- ---------------------------------------------------------------------------
create or replace view v_lcc_ownership_history_lane_actions as
with rows_ as (
  -- The bucket is derived ONCE here, not repeated in the GROUP BY: a bucket
  -- expression restated in an outer subquery is ungrouped (42803) and, worse,
  -- is the shape where two copies of one classification silently drift apart.
  select coalesce(action, split_state) as bucket,
         action, human_actionable, entity_id, link_count
  from v_lcc_ownership_history_lane_split
),
owners as (
  select distinct bucket, entity_id from rows_ where entity_id is not null
)
select
  r.bucket,
  r.action,
  bool_or(r.human_actionable)                    as human_actionable,
  count(*)                                       as open_tasks,
  count(distinct r.entity_id)                    as distinct_owners,
  sum(r.link_count)                              as total_links,
  (select sum(lcc_owner_known_annual_rent(o.entity_id))
     from owners o where o.bucket = r.bucket)    as total_annual_rent
from rows_ r
group by r.bucket, r.action;

grant select on v_lcc_ownership_history_lane_actions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Append the honest badge count to the P180 lane picker.
--
-- ⚠️ `CREATE OR REPLACE VIEW` is APPEND-ONLY for columns (42P16 on a mid-list
-- insert), so `human_actionable_tasks` goes at the END and every prior column
-- keeps its position and definition verbatim.
--
-- NULL = "this lane has not been split; open_tasks is the only count we have."
-- It is NOT 0, and it is NOT open_tasks: claiming a lane is fully actionable
-- because nobody has measured it is exactly the unearned-positive default
-- (P124's `else` branch) this repo keeps paying for.
-- ---------------------------------------------------------------------------
create or replace view v_lcc_research_lane_summary as
with open_tasks as (
  select rt.research_type, rt.id, rt.entity_id, rt.priority
  from research_tasks rt
  where rt.status in ('queued','in_progress')
),
owners as (
  select research_type, entity_id,
         lcc_owner_known_annual_rent(entity_id) as rent
  from (select distinct research_type, entity_id from open_tasks where entity_id is not null) d
)
select t.research_type,
       count(*)                                    as open_tasks,
       count(distinct t.entity_id)                 as distinct_owners,
       (select sum(o.rent) from owners o where o.research_type = t.research_type) as total_annual_rent,
       (select max(o.rent) from owners o where o.research_type = t.research_type) as top_owner_rent,
       min(t.priority)                             as best_priority,
       (select count(*) from research_tasks c
         where c.research_type = t.research_type and c.status = 'completed') as ever_completed,
       (select count(*) from research_tasks c
         where c.research_type = t.research_type and c.status = 'skipped')   as ever_skipped,
       (t.research_type in ('owner_contact_manual','establish_ownership_history')) as answerable,
       -- A1 (appended): how many of these are questions a HUMAN must answer.
       case when t.research_type = 'establish_ownership_history'
            then (select count(*) from v_lcc_ownership_history_lane_split s
                   where s.human_actionable)
            else null end                          as human_actionable_tasks
from open_tasks t
group by t.research_type;

grant select on v_lcc_research_lane_summary to anon, authenticated, service_role;
