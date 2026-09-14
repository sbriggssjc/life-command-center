-- P186 — v_lcc_tier0_owner_contact_candidates: remove the unjoinable cross product.
--
-- WHY (measured live 2026-08-26, LCC Opps xengecqvemvfknjvbvrq, before/after in ONE session):
--   Baseline at the real consumer shape (all output columns evaluated): 58,694 ms, 2,358 rows.
--
--   ⚠️ THE DOCUMENTED CAUSE WAS WRONG ON BOTH HALVES. Prompt 186 recorded the cost as
--   "a lcc_owner_known_annual_rent() call per owner plus two EXISTS per pair". Measured
--   against the plan:
--     * the rent function  ->    191 ms of 58,694  (0.3%)
--     * SubPlan 2 (owner_already_has_contact, hashed) -> 5.9 ms  (0.01%)
--     * SubPlan 3 (already_linked, index-served)      ->  47 ms  (0.08%)
--     * SubPlan 5 (the JOIN filter)                   -> ~58.4 s (99.5%)
--
--   The real cause is that `people JOIN owner_tok ON EXISTS(unnest(toks) WHERE sld LIKE tok||'%')`
--   has NO join key, so the planner emits a Nested Loop with a Join Filter:
--       loops = 5,624,400   (688 owners x 8,175 people)
--       Rows Removed by Join Filter: 5,622,042
--   and, worse, the token array itself is rebuilt inside that filter (InitPlan 4,
--   loops = 5,624,400) instead of once per owner (795). No index can fix a correlated
--   subplan; the fix is to give the join a key.
--
-- THE KEY: the predicate is a PREFIX match, and a prefix match is an equality join in
-- disguise. Tokens are pure [a-z]+ (regexp_replace strips [^a-zA-Z ] BEFORE lower(), so
-- there are no LIKE metacharacters), and every token has length >= 5. Therefore
--     EXISTS (tok in toks : sld LIKE tok || '%')
--   <=> EXISTS (k in [5, length(sld)] : left(sld, k) in toks)
-- Expanding each person's sld into its prefixes of length >= 5 turns the cross product
-- into a hash join on text equality. Logically identical, not an approximation.
--
-- ALSO HOISTED (small, but they were the only remaining correlated nodes):
--   * lcc_owner_known_annual_rent() -> one grouped aggregate, LEFT JOINed once.
--     Identical semantics: coalesce(sum(annual_rent) filter (where is_current), 0),
--     with coalesce(...,0) covering owners absent from the facts table (the function
--     returns 0 for them, the LEFT JOIN returns NULL).
--   * owner_already_has_contact / already_linked -> LEFT JOIN semi-sets.
--     `already_linked` keeps the original's UNDIRECTED test (owner->person OR person->owner).
--
-- COLUMN LIST IS BYTE-FOR-BYTE THE SAME, IN THE SAME ORDER (CREATE OR REPLACE VIEW is
-- append-only for columns, and the promoter that will read this view is not built yet).
--
-- VERIFICATION: two-directional 0-row equivalence diff against _p186_tier0_baseline,
-- a snapshot of the pre-change view taken in the same session.
--
-- REVERSAL: re-create the prior definition (recorded in the P186 write-up); this migration
-- changes no data and no schema, only the view body.

create or replace view v_lcc_tier0_owner_contact_candidates as
with owner_rent as (
  -- hoisted: was lcc_owner_known_annual_rent() called twice per lcc_property_owner row
  select f.entity_id,
         coalesce(sum(f.annual_rent) filter (where f.is_current), 0)::numeric as owner_rent
  from lcc_entity_portfolio_facts f
  group by f.entity_id
),
owners as (
  select distinct
         po.owner_entity_id                as owner_id,
         e.name                            as owner_name,
         coalesce(r.owner_rent, 0)::numeric as owner_rent
  from lcc_property_owner po
  join entities e on e.id = po.owner_entity_id
  left join owner_rent r on r.entity_id = po.owner_entity_id
  where e.merged_into_entity_id is null
    and e.entity_type = 'organization'::entity_type
    and coalesce(r.owner_rent, 0) >= 500000::numeric
),
owner_tok as (
  -- row-expanded instead of array-valued, so the token list is built ONCE per owner
  -- (795 evaluations) rather than once per candidate pair (5,624,400).
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
  select e.id                                                            as person_id,
         e.name                                                          as person_name,
         e.email,
         e.phone,
         lower(split_part(split_part(e.email, '@', 2), '.', 1))          as sld,
         lower(split_part(e.email, '@', 2))                              as domain
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
  -- every prefix of the second-level domain with length >= 5.
  -- `sld LIKE tok || '%'` AND length(tok) >= 5  <=>  left(sld, length(tok)) = tok.
  select p.person_id, left(p.sld, k) as pfx
  from people p
  cross join lateral generate_series(5, length(p.sld)) as k
),
matched as (
  -- distinct because one person can match several tokens of the same owner;
  -- the original EXISTS emitted exactly one row per (owner, person) pair.
  select distinct ot.owner_id, pp.person_id
  from owner_tok ot
  join person_prefix pp on pp.pfx = ot.tok
),
owner_has_contact as (
  select distinct pv.entity_id
  from owner_contact_pivot pv
  where pv.active_contact_entity_id is not null
),
rel_pair as (
  -- undirected: mirrors the original `from=owner AND to=person OR to=owner AND from=person`
  select from_entity_id as a, to_entity_id   as b from entity_relationships
  union
  select to_entity_id   as a, from_entity_id as b from entity_relationships
)
select ot.owner_id,
       ot.owner_name,
       ot.owner_rent,
       p.person_id,
       p.person_name,
       p.email,
       p.domain,
       uc.title        as contact_title,
       uc.company_name as contact_company,
       case
         when uc.title ~* '(acquisition|investment|capital market)'                                  then 'acquisitions'
         when uc.title ~* '(disposition|asset manage|portfolio manage)'                              then 'disposition'
         when uc.title ~* '(broker|agent|realtor)'                                                   then 'broker'
         when uc.title ~* '(analyst|coordinator|assistant|coordinator|transaction|due diligence|escrow)' then 'transaction_support'
         when uc.title ~* '(president|principal|partner|owner|founder|ceo|managing director)'        then 'principal'
         when uc.title is not null and uc.title <> ''                                                then 'other_titled'
         else 'no_title'
       end as role_bucket,
       uc.outlook_contact_id is not null as from_outlook_sync,
       ohc.entity_id is not null         as owner_already_has_contact,
       rp.a is not null                  as already_linked
from matched m
join (select distinct owner_id, owner_name, owner_rent from owner_tok) ot on ot.owner_id = m.owner_id
join people p                on p.person_id = m.person_id
left join unified_contacts uc on lower(uc.email) = lower(p.email)
left join owner_has_contact ohc on ohc.entity_id = ot.owner_id
left join rel_pair rp on rp.a = ot.owner_id and rp.b = p.person_id;

comment on view v_lcc_tier0_owner_contact_candidates is
  'Tier 0 contact bench: person entities whose email second-level domain prefix-matches a '
  'distinctive token of a >=$500k-rent owner name. P186 rewrote the join as a prefix-equality '
  'hash join (was a 5.6M-pair cross product, 58.7s -> sub-second). PROPOSAL ONLY — nothing '
  'here is promoted to owner_contact_pivot without a human verdict, and brokers are never '
  'promoted at any tier.';
