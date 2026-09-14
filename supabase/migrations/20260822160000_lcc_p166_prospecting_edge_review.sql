-- ============================================================================
-- P166 — review lane for mis-targeted `prospecting_contact` edges (2026-08-22)
--        Applied live to LCC Opps (xengecqvemvfknjvbvrq). View + function only.
--        SURFACES, never removes — see the doctrine note below.
--
-- FOUND WHILE LOOKING FOR AN INTERNAL CONTACT FOR THE TOP PROSPECTS.
-- Boyd Watterson Asset Management ($179.8M, 273 assets) showed "14 linked
-- people" while its recorded contact was a phantom. Reading the 14:
--
--   REAL Boyd Watterson employees (2, role works_at, linked 2026-07-24):
--     Eric Dowling   edowling@boydwatterson.com  (312) 777-3704
--     Joseph Capra   jcapra@boydwatterson.com    (312) 777-3707
--
--   NOT Boyd Watterson (12, all role `prospecting_contact`, bulk-linked 06-29):
--     3 x @northmarq.com  — OUR OWN COLLEAGUES
--     3 x @cbre.com, 1 x @eastdil.com  — COMPETITOR BROKERS
--     plus @prologis.com, @htareit.com, @mcwhinney.com, @ii-hpa.com, @cullprop.com
--     (one row carries the name "Brian Pfohl" with the email will.pike@cbre.com
--      — a name/email mismatch of the fan-out class Prompt 89 chased out)
--
-- Scott's doctrine: prospect "the ultimate individual in control of the
-- decision"; prior listing/procuring brokers are NOT prospected unless we
-- specify otherwise for a prior working relationship. Our own colleagues are
-- obviously never prospects.
--
-- ⚠️ CORRECTS AN EARLIER CLAIM OF MINE (P161 notes, 2026-08-21): "live check
-- confirms ZERO broker edges exist on resolved owners today, so that guard is
-- correct and simply has nothing to catch." That checked the ROLE LABEL. These
-- people are brokers by EMPLOYER but are stamped `prospecting_contact`, which is
-- not in NON_REACHABLE_ROLES — so the role-based guard cannot see them.
-- Population: 47 competitor-broker edges + 33 own-firm edges = 80 unambiguously
-- wrong, across 27 owners carrying $340.7M; 8 of those are resolved owners.
--
-- ⚠️ AND A MEASURED NON-FINDING, RECORDED SO NOBODY "FIXES" IT TWICE:
-- excluding our own firm from the reachability graph changes the count by ZERO
-- (303 owners via_person either way; owners reachable ONLY via a Northmarq
-- colleague = 0). Every such owner has another route. So this is DATA HYGIENE
-- — wrong edges visible in the panel's linked-contact list — NOT an inflated
-- headline metric, and v_lcc_owner_reachability is deliberately left unchanged.
--
-- WHY THIS IS A REVIEW LANE AND NOT A SWEEP:
--   • `northmarq.com` is unambiguous — it is us.
--   • "Is this @cbre.com person a broker or a principal?" is NOT. The domain
--     spread makes that plain: matthews.com / edinarealty.com / capitalpacific.com
--     are brokerages, while lightstonegroup.com / brauvin.com / harbertrealty.com
--     are almost certainly real principals. A hardcoded brokerage list would be
--     both incomplete and unmaintainable, and Scott's doctrine explicitly allows
--     an exception for a prior working relationship.
--   Same call as the P111 owner-contact lane: surface the ambiguity, never wire
--   a single "confirm" button to it.
--
-- LIVE COUNTS: own_firm_never_a_prospect 33 edges / 7 owners / $180.5M
--              brokerage_domain_review  110 edges / 26 owners / $345.2M
--
-- REVERSAL: drop view if exists v_lcc_prospecting_edge_review;
--           drop function if exists lcc_is_own_firm_email(text);
-- ============================================================================

create or replace function lcc_is_own_firm_email(p_email text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_email,'')) ~ '@([a-z0-9-]+\.)*northmarq\.com$'
$$;

create or replace view v_lcc_prospecting_edge_review as
with pe as (
  select r.id as relationship_id, r.created_at,
         o.id as owner_entity_id, o.name as owner_name,
         p.id as person_entity_id, p.name as person_name,
         coalesce(nullif(btrim(p.email),''),'') as person_email,
         lower(split_part(coalesce(p.email,''),'@',2)) as email_domain
  from entity_relationships r
  join entities a on a.id = r.from_entity_id
  join entities b on b.id = r.to_entity_id
  -- The edge direction is NOT consistent (person->org and org->person both
  -- occur), so normalise rather than assuming. A first pass assumed one
  -- direction and matched 2 of 80 edges.
  join lateral (select case when a.entity_type='person' then a else b end as p_,
                       case when a.entity_type='person' then b else a end as o_) x on true
  join entities p on p.id = (x.p_).id
  join entities o on o.id = (x.o_).id
  where lower(btrim(coalesce(r.metadata->>'role',''))) = 'prospecting_contact'
    and (a.entity_type='person') <> (b.entity_type='person')
)
select pe.*,
       lcc_owner_known_annual_rent(pe.owner_entity_id) as owner_annual_rent,
       case when lcc_is_own_firm_email(pe.person_email) then 'own_firm_never_a_prospect'
            when lcc_owner_name_is_brokerage(pe.person_name) then 'person_name_reads_as_brokerage'
            else 'brokerage_domain_review' end as reason
from pe
where lcc_is_own_firm_email(pe.person_email)
   or pe.email_domain in ('cbre.com','am.jll.com','jll.com','eastdil.com','cushwake.com',
                          'marcusmillichap.com','colliers.com','newmark.com','stanjohnsonco.com',
                          'avisonyoung.com','matthews.com','capitalpacific.com','edinarealty.com');

-- ── VERIFICATION GATE ───────────────────────────────────────────────────────
--   select reason, count(*) from v_lcc_prospecting_edge_review group by 1;
--     expect own_firm_never_a_prospect 33, brokerage_domain_review 110
--   -- the non-finding, re-assert before changing reachability:
--   -- owners reachable ONLY via an own-firm colleague must be 0
