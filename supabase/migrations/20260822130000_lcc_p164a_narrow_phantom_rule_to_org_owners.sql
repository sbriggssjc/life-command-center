-- ============================================================================
-- P164a — NARROW the phantom rule so it can never fire on an individual owner
--         (2026-08-22). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--         View + function only. The paired JS guard shipped in 2fb2f294.
--
-- ⚠️ THIS CORRECTS A LIVE MIS-CLASSIFICATION MADE THE PREVIOUS DAY.
--
-- P162/P164 defined a "phantom" owner-contact as one whose every name token
-- already appears in the OWNER's name. That is true of a restated company AND
-- of an INDIVIDUAL WHO OWNS IN THEIR OWN NAME. Of the 168 rows the P164 batch
-- cleared:
--
--     60  org-marked names       (true phantoms)                       $42.5M
--    103  PERSON-SHAPED owners   (individuals owning directly)        $199.4M
--      5  ambiguous                                                     $0.6M
--
-- The 103 include Alonso Cantu, Bashar Hamami, Ruth Malone, Praveen Gupta,
-- Thomas H. Yates. For those, contact-name == owner-name is CORRECT. Scott's
-- standing doctrine states it explicitly: "a person can be an owner in the LCC
-- if they are the individual in control of the ownership of the LLC or SPE. We
-- often have true companies and true contacts that are the same name and name
-- of an individual."
--
-- The batch was REVERTED IN FULL via lcc_unclear_phantom_owner_contacts()
-- ('p164-phantom-clear-20260821'): 168 rows restored, 0 unreverted, verified by
-- name on both Boyd Watterson and Alonso Cantu. Reversibility is the only reason
-- this cost nothing.
--
-- HOW IT WAS CAUGHT: the state-delta check after the first tick showed 8 "new
-- phantoms" that were plainly individuals (Peter Hansen @ Peter Hansen, George
-- Mosley @ George Mosley). Reading the ROWS, not the tick's tally, is what
-- surfaced it.
--
-- THE NARROWED RULE (mirrors isOwnerNameRestated() in api/_shared/entity-link.js):
--   containment counts ONLY when
--     (1) the OWNER carries a firm suffix  — lcc_owner_has_firm_suffix(), and
--     (2) the owner name has material BEYOND the person's name, so a
--         single-member "Peter Hansen LLC" whose principal IS Peter Hansen is
--         never flagged.
--
-- EFFECT — the honest number is an order of magnitude smaller:
--     v_lcc_phantom_owner_contact_worklist   372 -> 13
--        phantom_no_contact_detail             7   $214.4M
--            (Boyd Watterson Asset Management, Trammell Crow Co,
--             Genesis Financial Group, Procacci Development Company, …)
--        has_contact_detail_review_manually    6     $0.2M
--            (person-named TRUSTS — the named person is plausibly the
--             grantee/trustee, so they stay human-reviewed, never swept)
--
-- Validated against 203 real self-named attaches from the following 16 hours:
--   152 ALLOWED  individual / bare-name owner   (correct per doctrine)
--    44 ALLOWED  single-member-LLC shape        (principal IS the person)
--     7 BLOCKED  company restated
-- i.e. 196 of 203 correctly allowed. The un-narrowed rule would have blocked all
-- 203, including 152 real individual owners.
--
-- STATED LIMITATION, accepted deliberately: an organisation with no firm-suffix
-- word ("Sterling Bay"), or one that reduces to the same tokens as its contact
-- ("Trammell Crow Co" -> {trammell, crow} in the JS tokenizer), is structurally
-- identical to a single-member LLC named for its principal and is NOT blocked by
-- the JS guard. Missing a phantom costs one row a human rejects; blocking a real
-- individual owner deletes a decision-maker on a live prospect. Fail safe.
--
-- ⚠️ NOTE A KNOWN JS/SQL DIVERGENCE: the SQL core (lcc_owner_strict_core) does
-- NOT strip "Co" while the JS tokenizer does, so "Trammell Crow Co" appears in
-- this view but is not blocked at mint time by the JS guard. The view
-- over-reports by that one class rather than under-reporting — the safe
-- direction for a review surface.
--
-- REVERSAL: restore the pre-P164a view body from git history and drop
--           lcc_owner_has_firm_suffix(text).
-- ============================================================================

create or replace function lcc_owner_has_firm_suffix(p_name text)
returns boolean language sql immutable as $$
  select coalesce(p_name,'') ~* '\y(LLC|L\.L\.C|LP|LLP|Inc|Incorporated|Corp|Corporation|Ltd|Trust|Fund|Holdings|Partners|Capital|Advisors|Realty|Ventures|Company|Properties|Property|Associates|Group|Management|Mgmt|Development|Developers|Investments|Investors|Enterprises|Bancorp|Bank|Co)\y'
$$;

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
  and lcc_owner_has_firm_suffix(owner_name)
  and array_length(owner_tok,1) > array_length(contact_tok,1);

-- ── VERIFICATION GATE (asserted after apply) ────────────────────────────────
--   select confidence, count(*) from v_lcc_phantom_owner_contact_worklist group by 1;
--     expect phantom_no_contact_detail 7, has_contact_detail_review_manually 6
--   select count(*) from v_lcc_phantom_owner_contact_worklist
--    where owner_name in ('Alonso Cantu','Ruth Malone','Peter Hansen');
--     expect 0 — an individual owner must NEVER appear here
--   select count(*) from lcc_phantom_contact_clear_log where reverted_at is null;
--     expect 0 — the P164 batch is fully reverted
