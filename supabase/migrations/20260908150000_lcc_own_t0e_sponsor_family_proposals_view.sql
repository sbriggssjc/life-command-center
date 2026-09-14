-- OWN-T0e (design + dry-run, 2026-09-08) — sponsor-family PROPOSALS over the OWN-T0 conflict store.
-- APPLIED LIVE to xengecqvemvfknjvbvrq 2026-09-08. READ-ONLY: this migration creates ONE view and
-- writes nothing. Nothing here inserts into lcc_ownership_sponsor_family, merges an entity, or
-- end-dates a fact. Design: docs/audits/OWN_T0e_SPONSOR_FAMILY_LANE_DESIGN_2026-09-08.md.
--
-- WHY: v_lcc_property_ownership_reconciled reads `conflict_class = 'unclassified_rival'` on 1,617
-- properties (gov 1,401 / dia 216) — two live owner CANDIDATES on one asset with no recorded fact
-- relating them. OWN-T0 read the top 60 by rent and found the class dominated by sponsor <-> SPE
-- (both true), and every downstream measurement since (UX-T1c §10.1/§10.3/§10.7) hit the same
-- wall. One human confirm into lcc_ownership_sponsor_family clears a whole family (A3: `boyd` 20 of
-- 24), and today the registry holds 6 rows written by hand — there is no lane.
--
-- WHAT THIS VIEW IS: one row per (sponsor survivor entity, token) DECISION, ranked by rent, built
-- from the ONE sanctioned proposal gate `lcc_ownership_sponsor_token(owner, other)` (A3). That gate
-- is scoped to two names that are both parties to ONE property; two current owner candidates of one
-- asset satisfy exactly that scope. No second detector is introduced (P189/A2/N15c: the hazard
-- travels with the technique — a new normaliser is the drift this repo keeps paying for).
--
-- SPONSOR SIDE: decided by a RECORDED FACT, never by name shape — the party holding MORE current
-- properties fleet-wide is the sponsor. Ties (both hold the same count) are surfaced as
-- `sponsor_side = 'tied'` with both names, never guessed.
--
-- ⚠️ TWO VERDICTS, NOT ONE. Read on named rows 2026-09-08, a large share of the "SPE" side is a
-- DUPLICATE ENTITY of the sponsor (`Gardner Tanenbaum Holdings` ~ `Gardner-Tanenbaum`, `UIRC` ~
-- `UIRC`, `RMR` ~ `RMR Group`, `Space Center Kansas City Inc` ~ `Space Center, Inc.`). A family
-- confirm there would paper over an entity merge. `same_party_suspect` (lcc_owner_strict_core
-- equality — a LABEL for the human, banned for writes per A2) marks those so the lane can route
-- them to `lcc_merge_entity` (reversible) instead of the registry.
--
-- ⚠️ GENERIC TOKENS ARE VISIBLE, NOT FILTERED. `realty` proposes Realty Income ~ "American Realty
-- Capital JV Elman Investors" (different parties); `federal` proposes Federal Building LLC ~ Helena
-- Federal Office Building; `george`/`john` are given names. `token_entities_fleetwide` (A3's
-- blast-radius column) and `token_is_generic_word` are on the row so the human sees the weakest
-- proposals as weak. A stoplist would be a second lexical rule (P158a) — the human decides.
--
-- VERIFY (2026-09-08 at apply): ~170 decisions with a breadth-decided sponsor, ~115 tied, 193
-- tokens, 538 (property, token) pairs over 364 properties, ~$278M rent on decided rows. Re-measure,
-- never quote.

create or replace view public.v_lcc_ownt0e_sponsor_family_proposals as
with cur as (
  select r.source_domain, r.source_property_id,
         lcc_entity_survivor(r.owner_entity_id) as owner_id,
         r.owner_name, r.annual_rent
  from v_lcc_property_ownership_reconciled r
  where r.is_current and r.is_owner_candidate
    and r.property_state = 'conflict' and r.conflict_class = 'unclassified_rival'
),
port as (
  select lcc_entity_survivor(f.entity_id) as eid,
         count(distinct (f.source_domain, f.source_property_id)) as props
  from lcc_entity_portfolio_facts f
  where f.is_current
  group by 1
),
pairs as (
  select a.source_domain, a.source_property_id, a.annual_rent,
         a.owner_id as a_id, a.owner_name as a_name, coalesce(pa.props, 0) as a_props,
         b.owner_id as b_id, b.owner_name as b_name, coalesce(pb.props, 0) as b_props,
         lcc_ownership_sponsor_token(a.owner_name, b.owner_name) as tok
  from cur a
  join cur b on b.source_domain = a.source_domain and b.source_property_id = a.source_property_id
            and b.owner_id <> a.owner_id
  left join port pa on pa.eid = a.owner_id
  left join port pb on pb.eid = b.owner_id
  where a.owner_id < b.owner_id            -- one unordered pair per property
),
hit as (
  select *,
    case when a_props > b_props then a_id when b_props > a_props then b_id end as sponsor_id,
    case when a_props > b_props then a_name when b_props > a_props then b_name end as sponsor_name,
    case when a_props > b_props then b_id when b_props > a_props then a_id end as spe_id,
    case when a_props > b_props then b_name when b_props > a_props then a_name end as spe_name,
    case when a_props = b_props then 'tied' else 'breadth' end as sponsor_side,
    lcc_owner_strict_core(a_name) = lcc_owner_strict_core(b_name) as same_party_suspect
  from pairs
  where tok is not null
),
grp as (
  select
    coalesce(sponsor_id, least(a_id, b_id))   as group_key_id,   -- tied groups key on the lower id
    tok,
    sponsor_side,
    max(sponsor_name)                          as sponsor_name,
    max(case when sponsor_side = 'tied' then a_name || ' ~ ' || b_name end) as tied_pair,
    sponsor_id,
    count(*)                                   as properties,
    count(*) filter (where source_domain = 'gov') as gov_properties,
    count(*) filter (where source_domain = 'dia') as dia_properties,
    sum(annual_rent)                           as annual_rent,
    array_agg(distinct spe_name) filter (where spe_name is not null) as spe_names,
    bool_or(same_party_suspect)                as same_party_suspect,
    count(*) filter (where same_party_suspect) as same_party_pairs,
    max(greatest(a_props, b_props))            as sponsor_props,
    max(least(a_props, b_props))               as spe_props_max
  from hit
  group by 1, 2, 3, sponsor_id
)
select
  g.group_key_id,
  g.sponsor_id,
  g.sponsor_name,
  g.sponsor_side,
  g.tied_pair,
  g.tok                                        as sponsor_token,
  g.properties, g.gov_properties, g.dia_properties,
  g.annual_rent,
  g.spe_names,
  g.sponsor_props, g.spe_props_max,
  g.same_party_suspect, g.same_party_pairs,
  -- already a confirmed family for this sponsor entity + token?
  exists (select 1 from lcc_ownership_sponsor_family f
           where f.sponsor_entity_id = g.sponsor_id and f.sponsor_token = g.tok) as already_confirmed,
  -- evidence about a DIFFERENT question (P188): the token is confirmed for contact matching.
  exists (select 1 from lcc_owner_sponsor_domain sd where sd.sponsor_token = g.tok) as also_confirmed_for_contacts,
  -- blast radius of the bare token (A3): how many live entities carry it as a standalone word.
  (select count(*)::int from entities e
    where e.merged_into_entity_id is null
      and (' ' || regexp_replace(lower(e.name), '[^a-z0-9]+', ' ', 'g') || ' ') like ('% ' || g.tok || ' %')) as token_entities_fleetwide,
  -- a generic English/CRE word as the token is the weakest proposal in the set — shown, not filtered.
  (g.tok = any (array['realty','federal','corporate','capital','group','holdings','properties','property','partners','trust','family','building','center','plaza','government','office','john','george','james','national','american','first','united'])) as token_is_generic_word
from grp g;

comment on view public.v_lcc_ownt0e_sponsor_family_proposals is
  'OWN-T0e DRY-RUN SURFACE (read-only). One row per (sponsor survivor, token) decision over the '
  'OWN-T0 `unclassified_rival` conflict population, built from the A3 gate lcc_ownership_sponsor_token '
  '(the ONE sanctioned proposer — never a new normaliser). Sponsor = the party with MORE current '
  'properties (a recorded fact); ties are surfaced, never guessed. same_party_suspect = the two '
  'names are strict-core equal — that pair is an ENTITY MERGE question (lcc_merge_entity, '
  'reversible), not a family confirm; route it there. token_is_generic_word and '
  'token_entities_fleetwide expose the weakest proposals. NOTHING here writes; a confirm is one '
  'human INSERT into lcc_ownership_sponsor_family (confirmed_by required). Design: '
  'docs/audits/OWN_T0e_SPONSOR_FAMILY_LANE_DESIGN_2026-09-08.md.';

grant select on public.v_lcc_ownt0e_sponsor_family_proposals to service_role;
