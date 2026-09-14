-- OWN-T0e BUILD (2026-09-09) — make v_lcc_ownt0e_sponsor_family_proposals a LANE source.
-- APPLIED LIVE to xengecqvemvfknjvbvrq 2026-09-09. Three things, all read-side; nothing here
-- writes an ownership fact, merges an entity, or touches lcc_ownership_sponsor_family.
--
-- 1. THREE COLUMNS APPENDED to the view (CREATE OR REPLACE VIEW is append-only — 42P16 otherwise;
--    whole view restated per P194):
--      member_ids uuid[] — every distinct survivor entity id in the group (sponsor + SPEs, or
--                          every side of a tied group). The verdict path validates a human's
--                          sponsor pick on a TIED group against this, never against the request.
--      spe_ids    uuid[] — the non-sponsor side only (NULL on tied groups — no side is decided).
--      member_names text[] — ALIGNED with member_ids (both ordered by id), so a tied group's
--                          sponsor picker can label each id. tied_pair names ONE pair; a tied
--                          group can hold up to 9 members (measured), so labelling the picker
--                          from tied_pair by position would mislabel the pick.
--
-- 2. THE VIEW'S BODY IS REWRITTEN FOR COST, BYTE-IDENTICAL IN OUTPUT. Measured at apply:
--    the 2026-09-08 body ran 64.3 s (EXPLAIN ANALYZE, 1.69M buffers) — over service_role's 30 s
--    statement_timeout, so the lane would have 500'd on every open. Two pathologies, both
--    below the `cur` read:
--      • the self-join `cur a join cur b` on (domain, property) was planned as a nested loop
--        with the join keys in the FILTER (the CTE estimated rows=1): 11.3M rows removed by
--        join filter, ~20 s. Rewritten as a per-property array_agg + generate_subscripts pair
--        walk, which cannot degrade to a cross product whatever the estimate says.
--      • token_entities_fleetwide ran a regexp_replace over all 69k entities ONCE PER GROUP
--        (SubPlan, loops=182, ~43 s). Rewritten as one pass that unnests every live entity's
--        tokens and counts distinct entities per token (LIKE '% tok %' over the space-joined
--        normalised name ≡ token membership in string_to_array of the same string).
--    Result: 19.8 s, of which ~15 s is reading v_lcc_property_ownership_reconciled for the
--    whole population (that view is built for panel point-queries — OWN-T0). Equivalence:
--    md5 over the 21 pre-existing columns ce0a83c996a7fabad545c5ec2e79fd10 before AND after;
--    182 rows both; md5 over the first 23 columns 411328bc96ea95fdecfd641905187a89 for the applied
--    body and the rewrite; member_names is a labelling column derived from the same rows.
--
-- 3. A CACHE, because 19.8 s is still not a request path. /api/decisions?summary=1 calls every
--    federated source on page load and listFederatedLane reads the source per open; the pattern
--    already in the repo is lcc_priority_queue_resolved + lcc_refresh_priority_queue_resolved()
--    (a table refreshed by cron, the surface reads the table). Same shape here:
--      lcc_ownt0e_sponsor_family_proposals_cache  — the view's rows + refreshed_at
--      lcc_ownt0e_refresh_proposals()             — truncate-and-fill, returns the row count
--      cron 'lcc-ownt0e-proposals-refresh'        — 27 */4 * * *, seven minutes after
--                                                   lcc-portfolio-sync-finalize (20 */4), the
--                                                   producer whose output moves this population.
--    The lane reads the CACHE and re-evaluates already_confirmed LIVE (the registry is tiny);
--    a confirmed or decided group disappears through lcc_decisions exclusion + that live check
--    long before the next refresh. Snapshot columns that can go stale between refreshes:
--    properties/rent/spe lists — all display, none a guard input. The guards that matter
--    (registry membership, tombstone) are read live at verdict time.
--
-- VERIFY (at apply): select count(*), max(refreshed_at) from lcc_ownt0e_sponsor_family_proposals_cache;
--   → 182, now(). And: select jobname, schedule from cron.job where jobname = 'lcc-ownt0e-proposals-refresh'.
-- REVERSE: drop the cron job, function and cache table; the view restates to 20260908150000's body
--   (the 21 columns are identical, so nothing downstream moves).

create or replace view public.v_lcc_ownt0e_sponsor_family_proposals as
with cur as materialized (
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
-- one row per property carrying >= 2 current owner candidates; the pair walk below is
-- bounded by the property's own candidate count, never by the population squared.
byprop as (
  select source_domain, source_property_id,
         array_agg(owner_id   order by owner_id) as ids,
         array_agg(owner_name order by owner_id) as names,
         array_agg(annual_rent order by owner_id) as rents
  from cur
  group by 1, 2
  having count(*) >= 2
),
pairs as (
  select p.source_domain, p.source_property_id, p.rents[i] as annual_rent,
         p.ids[i] as a_id, p.names[i] as a_name, coalesce(pa.props, 0) as a_props,
         p.ids[j] as b_id, p.names[j] as b_name, coalesce(pb.props, 0) as b_props,
         lcc_ownership_sponsor_token(p.names[i], p.names[j]) as tok
  from byprop p
  cross join generate_subscripts(p.ids, 1) as i
  cross join generate_subscripts(p.ids, 1) as j
  left join port pa on pa.eid = p.ids[i]
  left join port pb on pb.eid = p.ids[j]
  where i < j and p.ids[i] <> p.ids[j]     -- one unordered pair per property (ids sorted asc)
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
    max(least(a_props, b_props))               as spe_props_max,
    -- OWN-T0e build (appended): the ids behind the names.
    (select array_agg(distinct x) from unnest(array_agg(a_id) || array_agg(b_id)) as u(x)) as member_ids,
    array_agg(distinct spe_id) filter (where spe_id is not null) as spe_ids,
    -- member_names: one name per member id, ordered by id — the same order
    -- array_agg(distinct x) yields for member_ids, so the two arrays align.
    (select array_agg(mn order by mx)
       from (select x as mx, min(n) as mn
               from unnest(array_agg(a_id) || array_agg(b_id), array_agg(a_name) || array_agg(b_name)) as u(x, n)
              group by x) m) as member_names
  from hit
  group by 1, 2, 3, sponsor_id
),
-- blast radius of the bare token (A3): live entities carrying it as a standalone word —
-- ONE pass over entities, counted per token, instead of one scan per group.
tokc as (
  select t.tok, count(distinct e.id)::int as n
  from entities e
  cross join lateral unnest(string_to_array(regexp_replace(lower(e.name), '[^a-z0-9]+', ' ', 'g'), ' ')) as t(tok)
  where e.merged_into_entity_id is null and t.tok <> ''
    and t.tok in (select tok from grp)
  group by 1
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
  coalesce(tc.n, 0)                            as token_entities_fleetwide,
  -- a generic English/CRE word as the token is the weakest proposal in the set — shown, not filtered.
  (g.tok = any (array['realty','federal','corporate','capital','group','holdings','properties','property','partners','trust','family','building','center','plaza','government','office','john','george','james','national','american','first','united'])) as token_is_generic_word,
  -- OWN-T0e build (appended 2026-09-09): ids for the verdict path.
  g.member_ids,
  g.spe_ids,
  g.member_names
from grp g
left join tokc tc on tc.tok = g.tok;

comment on view public.v_lcc_ownt0e_sponsor_family_proposals is
  'OWN-T0e lane source (read-only, ~20 s — read the CACHE lcc_ownt0e_sponsor_family_proposals_cache '
  'from any request path). One row per (sponsor survivor, token) decision over the OWN-T0 '
  '`unclassified_rival` conflict population, built from the A3 gate lcc_ownership_sponsor_token '
  '(the ONE sanctioned proposer — never a new normaliser). Sponsor = the party with MORE current '
  'properties (a recorded fact); ties are surfaced, never guessed — the human picks the sponsor from '
  'member_ids. same_party_suspect = the two names are strict-core equal — that pair is an ENTITY '
  'MERGE question (lcc_merge_entity, reversible), not a family confirm; the lane routes it there. '
  'token_is_generic_word and token_entities_fleetwide expose the weakest proposals. NOTHING here '
  'writes; a confirm is one human INSERT into lcc_ownership_sponsor_family by the Decision Center '
  'lane sponsor_family_confirm (api/admin.js). Design: '
  'docs/audits/OWN_T0e_SPONSOR_FAMILY_LANE_DESIGN_2026-09-08.md.';

grant select on public.v_lcc_ownt0e_sponsor_family_proposals to service_role;

-- ---------------------------------------------------------------------------
-- 3. the cache the lane actually reads
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_ownt0e_sponsor_family_proposals_cache (
  group_key_id                uuid        not null,
  sponsor_id                  uuid,
  sponsor_name                text,
  sponsor_side                text        not null,
  tied_pair                   text,
  sponsor_token               text        not null,
  properties                  int         not null,
  gov_properties              int         not null,
  dia_properties              int         not null,
  annual_rent                 numeric,
  spe_names                   text[],
  sponsor_props               int,
  spe_props_max               int,
  same_party_suspect          boolean,
  same_party_pairs            int,
  already_confirmed           boolean     not null,
  also_confirmed_for_contacts boolean     not null,
  token_entities_fleetwide    int         not null,
  token_is_generic_word       boolean     not null,
  member_ids                  uuid[]      not null,
  spe_ids                     uuid[],
  member_names                text[]      not null,
  refreshed_at                timestamptz not null default now(),
  primary key (group_key_id, sponsor_token, sponsor_side)
);

comment on table public.lcc_ownt0e_sponsor_family_proposals_cache is
  'OWN-T0e: snapshot of v_lcc_ownt0e_sponsor_family_proposals (a ~20 s view), refreshed by '
  'lcc_ownt0e_refresh_proposals() on cron lcc-ownt0e-proposals-refresh (27 */4 * * *). The '
  'Decision Center lane sponsor_family_confirm reads THIS. already_confirmed is a snapshot — the '
  'handler re-checks the registry live; every guard that can refuse a write reads live state, '
  'never this table. Display columns (properties, rent, names) may lag by up to 4 h.';

create or replace function public.lcc_ownt0e_refresh_proposals()
returns int
language plpgsql
as $fn$
declare v_n int;
begin
  -- Whole-population rebuild: 182 rows, ~20 s. Truncate-and-fill inside one transaction so a
  -- reader never sees an empty table (the fill commits with the truncate).
  delete from lcc_ownt0e_sponsor_family_proposals_cache;
  insert into lcc_ownt0e_sponsor_family_proposals_cache (
    group_key_id, sponsor_id, sponsor_name, sponsor_side, tied_pair, sponsor_token,
    properties, gov_properties, dia_properties, annual_rent, spe_names, sponsor_props, spe_props_max,
    same_party_suspect, same_party_pairs, already_confirmed, also_confirmed_for_contacts,
    token_entities_fleetwide, token_is_generic_word, member_ids, spe_ids, member_names, refreshed_at)
  select group_key_id, sponsor_id, sponsor_name, sponsor_side, tied_pair, sponsor_token,
         properties, gov_properties, dia_properties, annual_rent, spe_names, sponsor_props, spe_props_max,
         same_party_suspect, same_party_pairs, already_confirmed, also_confirmed_for_contacts,
         token_entities_fleetwide, token_is_generic_word, member_ids, spe_ids, member_names, now()
  from v_lcc_ownt0e_sponsor_family_proposals;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

comment on function public.lcc_ownt0e_refresh_proposals() is
  'OWN-T0e: rebuild lcc_ownt0e_sponsor_family_proposals_cache from the view. Returns rows written. '
  'Invoker-rights (no SECURITY DEFINER): cron runs as postgres, the handler as service_role.';

revoke all on function public.lcc_ownt0e_refresh_proposals() from public, anon, authenticated;
grant execute on function public.lcc_ownt0e_refresh_proposals() to service_role;
-- Supabase default privileges grant SELECT to anon/authenticated on every new table (the B6d/OCR2
-- two-grant lesson); measured true at apply and revoked. Asserted: has_table_privilege('anon', ..) = false.
revoke all on table public.lcc_ownt0e_sponsor_family_proposals_cache from public, anon, authenticated;
grant select on public.lcc_ownt0e_sponsor_family_proposals_cache to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'lcc-ownt0e-proposals-refresh';
select cron.schedule('lcc-ownt0e-proposals-refresh', '27 */4 * * *',
  $$select public.lcc_ownt0e_refresh_proposals();$$);

-- initial fill (~20 s)
select public.lcc_ownt0e_refresh_proposals();
