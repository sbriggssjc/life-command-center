-- ============================================================================
-- P162 — PHANTOM OWNER CONTACTS: the company's own name filed as its decision-
-- maker, marking the enrichment queue "done" (2026-08-21)
--
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq). View only. Surfaces, never
-- writes — this is a review lane, not an auto-fix (see the P111 note in
-- CLAUDE.md: the owner-contact review lane is mostly REJECTS, so nothing here
-- gets wired to a single "confirm" button).
--
-- FOUND WHILE CHASING P161's gated owners. `owner_contact_pivot` marks an owner
-- resolved once `active_contact_entity_id` is set, and the enrichment queue then
-- stops revisiting it. Measured live across all 1,349 resolved owners:
--
--     contact name IS the owner name            345 owners   $28.3M
--     contact name CONTAINED IN the owner name   27 owners  $225.6M
--                                               ---        --------
--                                               372 owners  $253.9M
--     …of which 306 are typed as a PERSON and 169 carry no email at all.
--
-- The single largest is LCC's biggest owner by rent: Boyd Watterson Asset
-- Management, LLC — 198 current assets, $179.8M annual rent, a top-tier
-- government-leased prospect — whose recorded decision-maker is a PERSON entity
-- literally named "Boyd Watterson", with no email and NO relationship edge to
-- the owner at all. The system believes that contact is resolved.
--
-- ⚠️ TWO MEASUREMENT ERRORS WERE MADE GETTING HERE. Both are recorded because
-- both are repeatable:
--
--  1. A TAUTOLOGY THAT RETURNED A PLAUSIBLE 100%. `... where owner_entity_id in
--     (select owner_entity_id from v_owner_contact_enrich_queue)` — that view has
--     no `owner_entity_id` column, so Postgres resolved the name against the
--     OUTER query and the predicate degenerated to `x IN (x)`, TRUE for every
--     row. It reported "93 of 93 gated owners are queued". The truth is 68 of 93,
--     with 25 ($75.1M) in no consumer at all. An unqualified column name in a
--     subselect is a silent correlated reference, never an error.
--
--  2. A PREFIX TEST ON A SORTED STRING. `lcc_owner_strict_core` SORTS its tokens
--     ("Boyd Watterson Asset Management, LLC" -> "asset boyd management
--     watterson"), so `owner_core LIKE contact_core || '%'` can only match by
--     accident — it put the flagship case in "genuinely different". CLAUDE.md
--     already warns that acronym matching must read the UNSORTED name for this
--     exact reason. The correct test on a sorted core is a TOKEN SUBSET
--     (`contact_tok <@ owner_tok`), which is what this view uses.
--
-- CONFIDENCE SPLIT — the lane is deliberately not one bucket:
--     phantom_no_contact_detail            164 owners  $242.5M
--        no email AND no phone: not a callable human under any reading.
--     has_contact_detail_review_manually   208 owners   $11.3M
--        MUST stay human-reviewed. A founder-named firm ("Sam Zell" at a Zell
--        entity) is a REAL principal whose name legitimately sits inside the
--        company name. Sweeping these would delete exactly the contacts worth
--        the most. Same trap as P158a's `&`-means-a-married-couple finding.
--
-- CONSUMER: route through the EXISTING P114 shape-aware lane
-- (`owner_contact_attach_review`, verdicts attach_person | same_party | reject).
-- `same_party` is precisely this shape — do not build a second verdict path.
--
-- REVERSAL: drop view if exists v_lcc_phantom_owner_contact_worklist;
-- ============================================================================

create or replace view v_lcc_phantom_owner_contact_worklist as
with resolved as (
  select p.entity_id, p.active_contact_entity_id, p.active_contact_name
  from owner_contact_pivot p where p.active_contact_entity_id is not null
), t as (
  select r.entity_id, r.active_contact_entity_id, r.active_contact_name,
         o.name as owner_name, c.entity_type::text as contact_entity_type,
         coalesce(nullif(btrim(c.email),''),'') as contact_email,
         coalesce(nullif(btrim(c.phone),''),'') as contact_phone,
         string_to_array(lcc_owner_strict_core(o.name), ' ') as owner_tok,
         string_to_array(lcc_owner_strict_core(r.active_contact_name), ' ') as contact_tok,
         (select count(*) from entity_relationships rel
           where (rel.from_entity_id = r.active_contact_entity_id and rel.to_entity_id = r.entity_id)
              or (rel.to_entity_id = r.active_contact_entity_id and rel.from_entity_id = r.entity_id)) as edges
  from resolved r
  join entities o on o.id = r.entity_id
  left join entities c on c.id = r.active_contact_entity_id
)
select entity_id as owner_entity_id, owner_name,
       active_contact_entity_id, active_contact_name,
       contact_entity_type, contact_email, contact_phone, edges,
       lcc_owner_known_annual_rent(entity_id) as known_annual_rent,
       case when contact_tok = owner_tok then 'name_identical' else 'name_contained' end as shape,
       case when contact_email = '' and contact_phone = '' then 'phantom_no_contact_detail'
            else 'has_contact_detail_review_manually' end as confidence
from t
where contact_tok <@ owner_tok
order by lcc_owner_known_annual_rent(entity_id) desc;

-- VERIFICATION GATE (must hold after apply):
--   select confidence, count(*) from v_lcc_phantom_owner_contact_worklist group by 1;
--     expect phantom_no_contact_detail 164, has_contact_detail_review_manually 208
--   select owner_name, known_annual_rent from v_lcc_phantom_owner_contact_worklist limit 1;
--     expect Boyd Watterson Asset Management, LLC / 179800482
