-- ============================================================================
-- P170 — auto-resolve the prospecting contact where the answer is unambiguous;
--        fall back to the research lane where it is not (2026-08-22).
--        Applied live to LCC Opps. VIEW ONLY — proposes, writes nothing yet.
--
-- Scott's model, stated 2026-08-22: "auto resolve who we should be prospecting
-- and calling on as much as we can, but when it truly doesn't know or is
-- uncertain (like a Boyd Watterson where there are many different options to
-- call on), fall back to the manual connection via the research lane."
--
-- THE SIGNAL: a linked person whose EMAIL DOMAIN belongs to the owner's own
-- company demonstrably works there. Measured across all resolved owners:
--
--     auto_resolve                exactly one clean person   31 owners  $50.9M
--     manual_multiple_at_firm     several — genuinely ambiguous 30      $226.3M
--     review_name_email_mismatch  the email is not that person   3       $27.2M
--     (nobody at the firm known — external research needed)      249     $454.6M
--
-- Boyd Watterson lands in `manual_multiple_at_firm` (Eric Dowling AND Joseph
-- Capra, both @boydwatterson.com) — exactly the fallback case Scott described.
--
-- ⚠️ TWO FALSE-POSITIVE MODES WERE FOUND BY READING NAMED ROWS, AND BOTH WOULD
-- HAVE WRITTEN A WRONG CONTACT ONTO A LIVE PROSPECT:
--
--  1. SUBSTRING DOMAIN MATCH. A first cut tested `position(tok in domain) > 0`,
--     so "global" matched "ar-global" and proposed an AR Global person as the
--     contact for Global Net Lease — a different company. Fixed by anchoring:
--     the domain must START with the owner token (`dom_head LIKE tok || '%'`).
--     A company domain almost always leads with its own name. Cost: 46 -> 31
--     auto-resolvable, which is the correct price.
--
--  2. NAME/EMAIL MISMATCH. "Irwin Molasky <melaniep@molaskyco.com>" — right
--     company, wrong human; that is Melanie's address. Same shape as the
--     "Brian Pfohl <will.pike@cbre.com>" row found in P166. Fixed by requiring
--     the email LOCAL-PART to carry part of the person's name.
--     Deliberately strict: it also routes truncated corporate handles
--     ("cmcgibbo" for Chris McGibbon) and hyphenated surnames to REVIEW rather
--     than auto-attaching. Failing safe costs a review; failing open writes the
--     wrong decision-maker onto a $27M prospect.
--
-- Also excluded outright: our own @northmarq.com colleagues
-- (lcc_is_own_firm_email) and brokerage-named people
-- (lcc_owner_name_is_brokerage), per standing doctrine.
--
-- ⚠️ THIS VIEW WRITES NOTHING. It is the proposal surface. An attach is a write
-- onto a live prospect and, on this codebase's record, the step that most
-- deserves a dry run and a named-row read before it executes (see P164, which
-- cleared 103 individual owners on a rule that looked obviously right).
--
-- THE GAP THIS DOES NOT CLOSE — the research lane cannot be filled in.
-- `completeResearch()` posts only { research_task_id }; the research page has
-- ZERO input fields. "Complete" closes a task without recording an answer.
-- That, not operator neglect, is why owner_contact_manual has 316 open tasks and
-- zero completions in system history. The only working capture path today is
-- Owner panel -> Contacts tab -> "Select contact" (picker ->
-- /api/operations?action=select_prospecting_contact, with "+ Add new" for a
-- person not yet in the graph). Wiring the research card to that existing
-- picker is the natural follow-up; nothing new needs building.
--
-- VERIFICATION GATE:
--   select disposition, count(distinct owner_entity_id)
--     from v_lcc_contact_autoresolve_candidates group by 1;
--     expect auto_resolve 31, manual_multiple_at_firm 30, review 3
--   -- Boyd Watterson must NOT be auto-resolvable:
--   select disposition from v_lcc_contact_autoresolve_candidates
--    where owner_name like 'Boyd Watterson Asset%';   -- expect manual_multiple_at_firm
--
-- REVERSAL: drop view if exists v_lcc_contact_autoresolve_candidates;
-- ============================================================================

create or replace view v_lcc_contact_autoresolve_candidates as
with owners as (
  select distinct po.owner_entity_id from lcc_property_owner po where po.owner_entity_id is not null
), cand as (
  select o.owner_entity_id, e.name as owner_name, p.id as person_id, p.name as person_name,
         lower(p.email) as email, nullif(btrim(p.phone),'') as phone,
         lower(split_part(split_part(p.email,'@',2),'.',1)) as dom_head,
         lower(split_part(p.email,'@',1)) as local_part,
         lower(btrim(coalesce(r.metadata->>'role',''))) as edge_role,
         lcc_owner_known_annual_rent(o.owner_entity_id) as rent
  from owners o
  join entities e on e.id = o.owner_entity_id
  join entity_relationships r on r.to_entity_id=o.owner_entity_id or r.from_entity_id=o.owner_entity_id
  join entities p on p.id = case when r.to_entity_id=o.owner_entity_id then r.from_entity_id else r.to_entity_id end
  where p.entity_type='person'
    and nullif(btrim(p.email),'') is not null
    and not lcc_is_own_firm_email(p.email)
    and not lcc_owner_name_is_brokerage(p.name)
), scored as (
  select cand.*,
    exists (select 1 from unnest(string_to_array(lcc_owner_strict_core(cand.owner_name),' ')) tok
             where length(tok) >= 4 and cand.dom_head like tok || '%') as at_firm,
    exists (select 1 from unnest(string_to_array(lower(replace(cand.person_name,'-',' ')),' ')) nt
             where length(nt) >= 3 and position(nt in cand.local_part) > 0) as email_matches_name
  from cand
), per_owner as (
  select owner_entity_id, owner_name, rent,
         count(*) filter (where at_firm and email_matches_name)     as n_clean,
         count(*) filter (where at_firm and not email_matches_name) as n_mismatch
  from scored group by 1,2,3
)
select s.owner_entity_id, s.owner_name, s.rent as known_annual_rent,
       s.person_id, s.person_name, s.email, s.phone, s.edge_role,
       po.n_clean, po.n_mismatch,
       case when po.n_clean = 1 and po.n_mismatch = 0 then 'auto_resolve'
            when po.n_clean > 1                       then 'manual_multiple_at_firm'
            else                                           'review_name_email_mismatch' end as disposition
from scored s
join per_owner po on po.owner_entity_id = s.owner_entity_id
where s.at_firm and s.email_matches_name;
