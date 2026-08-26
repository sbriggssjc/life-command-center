-- P186b — Scott's doctrine call (2026-08-26):
--   "We do not want municipalities or public bodies in our scope. Good to know that they are
--    owners and we want to reconcile ownership to those accounts just like others in the LCC as
--    we are researching properties but for now, we do not need to even attempt to prospect
--    those owner types."
--
-- SO: the exclusion belongs at the PROSPECTING layer only. Ownership data is untouched --
-- lcc_property_owner, lcc_entity_portfolio_facts, entity_relationships and every ownership
-- reconciliation path keep these owners exactly as they are.
--
-- ============================================================================
-- PART 1 — widen lcc_owner_name_is_public_body(), conservatively
-- ============================================================================
--
-- The existing function was measured before being touched. It is GOOD: across the 795 owners in
-- scope (>= $500k rent) it caught 20 "City of / County of / Port Authority" rows and produced
-- ZERO false positives -- it correctly left every private firm alone, including the ones whose
-- names are designed to look governmental:
--   Government Properties Income Trust ($39.7M), Easterly Government Properties ($29.8M),
--   HC Government Realty Trust, National Government Properties, Government Investment Partners,
--   US Fed Properties Trust, Helena Federal Office Building LLC, BOYD STATE TUCSON LLC,
--   Federal National Finance Corporation, KBS SOR II Oakland City Center LLC.
--
-- It missed five genuine public bodies, worth $18.5M:
--   United States Postal Service ($15.5M), State Center Community College District ($0.87M),
--   The Regents Of The University Of Colorado ($0.91M), DEPARTMENT OF TRANSPORTATION FLORIDA
--   ($0.60M), Arizona State Retirement System ($0.55M).
--
-- ⚠️ THE OBVIOUS WIDENING IS THE DESTRUCTIVE ONE (the P158a shape, again).
--   * A `\muniversity\M` rule would catch **George Washington University ($23.8M)** and
--     **Georgetown University ($8.0M)** -- both PRIVATE non-profits and legitimate prospects --
--     in order to catch University of Memphis and UNC Health Care System. $31.8M of real
--     prospects destroyed to gain $2.1M. NOT DONE. Universities are left to a human call
--     (see the OPEN ITEM below).
--   * A `\mfederal\M` or `\mgovernment\M` rule would catch six private REITs and LLCs above.
--     NOT DONE.
--   * A bare `\mdepartment\M` rule is unsafe; only the named agency types are matched.
--
-- Every added pattern is unambiguous: no private firm is called "The Regents Of", "Community
-- College", "Board of Education", "Sheriff's Office" or "District Attorney".
--
-- NEGATIVE GUARD: `OBO` / `on behalf of`. Found while reading the 42 fleet-wide flips:
--   "Cottonwood Partners OBO Utah State Retirement System" -- Cottonwood Partners is a PRIVATE
--   manager acting for a public pension, and is a legitimate prospect. The pension is the
--   beneficiary, not the counterparty we would call.
--
-- VERIFIED: 26/26 named-row expectations PASS (8 must-be-public, 18 must-stay-private), stated
-- before the query was run. Fleet-wide the widening flips 42 rows, every one read individually
-- and confirmed a genuine public body.
--
-- ⚠️ TWO EXISTING CONSUMERS CHANGE WITH IT, DELIBERATELY -- checked before editing:
--   v_lcc_top_seller_prospects        (excludes public bodies from seller prospecting)
--   v_lcc_owner_contact_decidability  (reason 'public_body_not_prospected')
-- Both want exactly this semantic, so widening the SHARED function is the single-source move
-- rather than adding a second definition that would drift.

create or replace function public.lcc_owner_name_is_public_body(p_name text)
 returns boolean
 language sql
 immutable
as $function$
  select coalesce(p_name,'') ~* '(\m(city|county|town|village|borough|parish)\s+(of|and)\M|,\s*(city|county|town)\s+of\M|^(city|county|state)\s+of\M|\mstate of\M|\mtax collector\M|\mschool district\M|county regional\M|\mmunicipal\M|\mport authority\M|\mtransit authority\M|\mhousing authority\M)'
      or (
        -- P186b additions: unambiguous public bodies the original missed
        coalesce(p_name,'') ~* '(\mregents of\M|\mcommunity college\M|\munited states postal service\M|\mdepartment of (transportation|corrections|health|revenue|motor vehicles)\M|\m(state|county|city|teachers|public employee[s]?) retirement system\M|\mboard of education\M|\msheriff''s office\M|\mdistrict attorney\M)'
        -- ...unless a PRIVATE manager is named as acting on the public body's behalf.
        and coalesce(p_name,'') !~* '(\mobo\M|\mon behalf of\M|\bo/b/o\b)'
      );
$function$;

comment on function public.lcc_owner_name_is_public_body(text) is
  'TRUE when an owner name is a municipality, state/federal agency, public pension, public '
  'university governing board or similar public body. Used to keep public bodies out of '
  'PROSPECTING surfaces only (Scott 2026-08-26) -- ownership reconciliation is unaffected. '
  'Deliberately conservative: private firms with governmental-sounding names (Easterly '
  'Government Properties, Government Investment Partners, US Fed Properties Trust) must NOT '
  'match, and no blanket \muniversity\M rule exists because GWU and Georgetown are private.';

-- ============================================================================
-- PART 2 — keep public bodies out of the Tier 0 contact bench
-- ============================================================================
-- Adds a WHERE predicate only. Column list, order and types are unchanged, so this remains a
-- legal CREATE OR REPLACE (which is append-only for columns).
--
-- Effect measured post-change and recorded in
-- docs/audits/P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md.
--
-- OPEN ITEM, deliberately not decided here: PUBLIC universities and public health systems
-- (University of Memphis, University Of North Carolina Health Care System) are still in scope
-- because no name-based rule separates them from PRIVATE universities (George Washington,
-- Georgetown) without destroying the latter. This needs Scott's call, not a regex.

create or replace view v_lcc_tier0_owner_contact_candidates as
with owner_rent as (
  select f.entity_id,
         coalesce(sum(f.annual_rent) filter (where f.is_current), 0)::numeric as owner_rent
  from lcc_entity_portfolio_facts f
  group by f.entity_id
),
owners as (
  select distinct
         po.owner_entity_id                 as owner_id,
         e.name                             as owner_name,
         coalesce(r.owner_rent, 0)::numeric as owner_rent
  from lcc_property_owner po
  join entities e on e.id = po.owner_entity_id
  left join owner_rent r on r.entity_id = po.owner_entity_id
  where e.merged_into_entity_id is null
    and e.entity_type = 'organization'::entity_type
    and coalesce(r.owner_rent, 0) >= 500000::numeric
    -- P186b: public bodies are never prospected (ownership data unaffected)
    and not lcc_owner_name_is_public_body(e.name)
),
owner_tok as (
  select o.owner_id, o.owner_name, o.owner_rent, t.t as tok
  from owners o
  cross join lateral unnest(
    regexp_split_to_array(lower(regexp_replace(o.owner_name, '[^a-zA-Z ]', '', 'g')), '\s+')
  ) t(t)
  where length(t.t) >= 5
    and t.t <> all (array[
      'trust','group','holdings','properties','partners','capital','company','realty',
      'investors','management','development','associates','incorporated','limited',
      'national','american','government','property','asset','assets','income','equity',
      'equities','western','eastern','northern','southern','pacific','atlantic','central',
      'general','united','global','premier','first','second','third','commercial',
      'residential','industrial','venture','ventures','enterprise','enterprises',
      'financial','finance','realestate','services','solutions','systems','corporation',
      'company','partnership'
    ])
),
people as (
  select e.id as person_id, e.name as person_name, e.email, e.phone,
         lower(split_part(split_part(e.email, '@', 2), '.', 1)) as sld,
         lower(split_part(e.email, '@', 2))                     as domain
  from entities e
  where e.entity_type = 'person'::entity_type
    and e.merged_into_entity_id is null
    and e.email like '%@%'
    and lower(split_part(e.email, '@', 2)) <> all (array[
      'gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','me.com',
      'live.com','msn.com','protonmail.com','mail.com','comcast.net','att.net','verizon.net'
    ])
),
person_prefix as (
  select p.person_id, left(p.sld, k) as pfx
  from people p
  cross join lateral generate_series(5, length(p.sld)) as k
),
matched as (
  select distinct ot.owner_id, pp.person_id
  from owner_tok ot
  join person_prefix pp on pp.pfx = ot.tok
),
owner_has_contact as (
  select distinct pv.entity_id from owner_contact_pivot pv
  where pv.active_contact_entity_id is not null
),
rel_pair as (
  select from_entity_id as a, to_entity_id   as b from entity_relationships
  union
  select to_entity_id   as a, from_entity_id as b from entity_relationships
)
select ot.owner_id, ot.owner_name, ot.owner_rent,
       p.person_id, p.person_name, p.email, p.domain,
       uc.title as contact_title, uc.company_name as contact_company,
       case
         when uc.title ~* '(acquisition|investment|capital market)' then 'acquisitions'
         when uc.title ~* '(disposition|asset manage|portfolio manage)' then 'disposition'
         when uc.title ~* '(broker|agent|realtor)' then 'broker'
         when uc.title ~* '(analyst|coordinator|assistant|coordinator|transaction|due diligence|escrow)' then 'transaction_support'
         when uc.title ~* '(president|principal|partner|owner|founder|ceo|managing director)' then 'principal'
         when uc.title is not null and uc.title <> '' then 'other_titled'
         else 'no_title'
       end as role_bucket,
       uc.outlook_contact_id is not null as from_outlook_sync,
       ohc.entity_id is not null         as owner_already_has_contact,
       rp.a is not null                  as already_linked
from matched m
join (select distinct owner_id, owner_name, owner_rent from owner_tok) ot on ot.owner_id = m.owner_id
join people p                 on p.person_id = m.person_id
left join unified_contacts uc on lower(uc.email) = lower(p.email)
left join owner_has_contact ohc on ohc.entity_id = ot.owner_id
left join rel_pair rp on rp.a = ot.owner_id and rp.b = p.person_id;
