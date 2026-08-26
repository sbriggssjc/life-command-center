-- ============================================================================
-- P180 — the Research LANE PICKER: per-lane open count + value + answerability
--        (2026-08-26). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--
-- P179 established that reachability on this page is a NAVIGATION problem, not
-- a ranking one: a correctly ranked, newly-answerable lane holding $1.08B still
-- read as "page 62" of the unfiltered list, and the lanes above it could not be
-- demoted because they are the healthiest work in the system (4,772 and 595
-- lifetime completions). The page had a `research_type` filter but nothing to
-- tell an operator which lane was worth selecting.
--
-- ⚠️ THE SURFACE FOUND MORE LANES THAN ANYONE HAD COUNTED: **14**, not the five
-- this work had been reasoning about. Two carry the value:
--
--   establish_ownership_history   545 open  455 owners  $1.08B  answerable
--   owner_contact_manual          316 open  315 owners  $754.9M answerable
--   trace_ownership_to_developer   18 open   16 owners  $51.3M  (40 completed, 1,400 auto-retired)
--   property_missing_recorded_owner 1,184 open  — unsized  (4,772 completed)
--   true_owner_needs_salesforce      816 open  — unsized  (595 completed)
--   npi_missing_inventory            203 open  — unsized  (0 completed, 0 skipped)
--   + 8 small lanes
--
-- ⚠️⚠️ THREE HONEST-COUNT RULES, EACH OF WHICH WOULD MISLEAD TRIAGE IF BROKEN.
-- All three are guarded by assertions, two by mutation tests:
--
--  1. **VALUE IS PER OWNER, NEVER PER TASK.** A lane emitting one task per
--     property double-counts — measured 2x on establish_ownership_history and
--     4.65x on the contact lane. `total_annual_rent` sums over DISTINCT owner
--     entities; `open_tasks` is reported separately. They answer different
--     questions and must never be blended into one figure.
--
--  2. **NULL IS NOT ZERO.** The first version of this view returned 0 for lanes
--     whose tasks carry no `entity_id`, which renders as "$0" and reads as
--     "worthless". Six lanes are in that state — and the two largest of them
--     (property_missing_recorded_owner, true_owner_needs_salesforce) are the
--     highest-throughput lanes we have. Presenting them as $0 would invite
--     precisely the wrong triage. NULL now means "cannot be sized" and the UI
--     renders an em-dash. Note this is distinct from a GENUINE $0
--     (person_email_merge_review has 8 owners with no known rent) — the view
--     preserves that difference.
--
--  3. **`answerable` IS CURATED, NOT INFERRED.** It records whether the card has
--     a capture path today (Class 3). The UI is the authority, so the flag is an
--     explicit list rather than a guess from the data. A lane with no way to
--     record an answer is marked with a warning glyph and should not be
--     presented as workable however much value it carries. Today only
--     `owner_contact_manual` (P173) and `establish_ownership_history` (P179)
--     qualify. **When a new capture path ships, update this list in the same
--     change** — otherwise the picker under-reports what the operator can do.
--
-- SERVED VIA: GET /api/queue?view=research_lanes (a sub-route of the existing
-- handler, per the routing convention — not a new api/*.js).
--
-- SURFACED AND NOT FIXED HERE: `npi_missing_inventory` (203 open, 0 completed,
-- 0 skipped, no capture path) is a third genuinely dead lane, alongside the two
-- Class-2 already documented. It now shows its own emptiness in the picker
-- rather than hiding inside an undifferentiated count.
--
-- REVERSAL: drop view v_lcc_research_lane_summary; remove the queue.js case.
-- ============================================================================

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
       -- NULL (not 0) when the lane carries no owner link: unsized <> worthless.
       (select sum(o.rent) from owners o where o.research_type = t.research_type) as total_annual_rent,
       (select max(o.rent) from owners o where o.research_type = t.research_type) as top_owner_rent,
       min(t.priority)                             as best_priority,
       (select count(*) from research_tasks c
         where c.research_type = t.research_type and c.status = 'completed') as ever_completed,
       (select count(*) from research_tasks c
         where c.research_type = t.research_type and c.status = 'skipped')   as ever_skipped,
       -- Curated: does the card offer a way to record an answer? (Class 3)
       (t.research_type in ('owner_contact_manual','establish_ownership_history')) as answerable
from open_tasks t
group by t.research_type;

grant select on v_lcc_research_lane_summary to anon, authenticated, service_role;
