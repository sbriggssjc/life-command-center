-- ============================================================================
-- P168 — an ORGANISATION is never a decision-maker; + schedule the P167 sweep
--        (2026-08-22). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--        View + cron only.
--
-- P167's verification gate surfaced 83 owners whose `active_contact_entity_id`
-- points at an ORGANISATION rather than a person. Classified:
--
--     66  contact name CONTAINED IN the owner name   $33.5M
--         Trammell Crow Co -> Trammell Crow Co
--         Blake Real Estate Inc -> Blake Real Estate
--         Global Net Lease -> Global Net Lease
--     16  other org, no contact detail                $1.3M
--         Louis J. Eyde Family LLC -> Eyde Development     <- a REAL manager
--         LVA5 San Diego LS, L.P. -> Lionstone Investments <- a REAL manager
--      1  other org, has contact detail
--         Real Estate Discovery Ventures -> "Property and Asset Manager"
--         (a ROLE TITLE minted as an entity)
--
-- The first group is the phantom pattern in ORGANISATION form, and 64 of the 66
-- were MISSED by the P164a rule. Why: P164a requires the owner to carry material
-- beyond the contact's name (`owner_tok > contact_tok`). That guard exists to
-- protect "Peter Hansen LLC" -> "Peter Hansen" — a single-member LLC whose
-- principal IS that person. It is the right guard when the contact is a PERSON.
--
-- ⚠️ IT IS THE WRONG GUARD WHEN THE CONTACT IS AN ORGANISATION. There is no
-- principal to protect: an organisation is never "the individual in control of
-- the decision" (Scott's doctrine). So for an org contact, containment alone is
-- sufficient. The rule is now SPLIT BY CONTACT TYPE rather than applied
-- uniformly — the uniform version was both too loose (P164, swept up 103
-- individual owners) and too tight (missed these 64) at the same time.
--
-- SAFE, and measured rather than assumed: a legitimate MANAGER org is not
-- name-contained. "Eyde Development" is not inside "Louis J. Eyde Family, LLC"
-- ('development' is absent), and "Lionstone Investments" is not inside "LVA5 San
-- Diego LS, L.P." Both correctly stay OUT — asserted in the gate.
--
-- Worklist after this change: 79 owners
--     org_as_contact_never_a_decision_maker   70   $33.5M
--     phantom_no_contact_detail                3    $9.4M
--     has_contact_detail_review_manually       6    $0.2M
-- (Boyd Watterson left the list because P167 nulled its self-referencing
--  pointer; Trammell Crow Co moved from the person bucket to the org bucket.)
--
-- SECOND HALF — SCHEDULING P167's SWEEP (cron 237, 04:40 daily).
-- P167 fixed 3 stranded contact pointers but did NOT fix the merge path:
-- lcc_merge_entity / lcc_reconcile_tombstone_backrefs still never repoint
-- `owner_contact_pivot.active_contact_entity_id`, so the strand can re-form on
-- the next contact merge.
--
-- ⚠️ THE MERGE PATH IS DELIBERATELY STILL NOT REWRITTEN, and that is a judgement
-- call worth stating plainly: lcc_reconcile_tombstone_backrefs is 13,250
-- characters with 13 UPDATE statements, and CREATE OR REPLACE requires
-- re-emitting every character of a SECURITY DEFINER function at the centre of
-- entity merging. Re-typing that blind to pre-empt a defect that produced THREE
-- rows, and which a proven idempotent sweep repairs daily, is the worse gamble.
-- The sweep is the mitigation; the prevention is a follow-up that should be done
-- with the function source in hand, not reconstructed from pg_get_functiondef.
--
-- FOLLOW-UP (named, so it is not lost): add `active_contact_entity_id` to
-- lcc_reconcile_tombstone_backrefs alongside the four FKs P160 added.
--
-- VERIFICATION GATE (all PASS):
--   individual owners in the worklist                    0
--   person-contact rows whose owner lacks a firm suffix  0
--   org-contact rows (all genuinely name-contained)      70
--   legitimate manager org (Louis J. Eyde Family)        0  <- must NOT be flagged
--
-- REVERSAL: restore the pre-P168 view body from git history;
--           select cron.unschedule('lcc-fix-stranded-contact-pointers');
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
       case when contact_entity_type <> 'person' then 'org_as_contact_never_a_decision_maker'
            when contact_email = '' and contact_phone = '' then 'phantom_no_contact_detail'
            else 'has_contact_detail_review_manually' end as confidence
from t
where contact_tok <@ owner_tok
  and (
    contact_entity_type <> 'person'                      -- org: containment is enough
    or (                                                 -- person: keep the P164a guards
      lcc_owner_has_firm_suffix(owner_name)
      and array_length(owner_tok,1) > array_length(contact_tok,1)
    )
  );

-- P167 sweep, scheduled (created live as jobid 237):
--   select cron.schedule('lcc-fix-stranded-contact-pointers', '40 4 * * *',
--     $$SELECT public.lcc_fix_stranded_contact_pointers(false,
--         'cron-' || to_char(now(),'YYYYMMDD'))$$);
