-- ============================================================================
-- C13g-min-lane-fix (2026-09-09): v_lcc_entity_retype_candidates read the
-- ~20-35 s PROPOSALS VIEW instead of the OWN-T0e CACHE, so the lane 502'd.
-- ----------------------------------------------------------------------------
-- Measured live: the Decision Center card "Entity type — person or
-- organization?" returned HTTP 502 federated_list_failed / "This operation was
-- aborted" — api/_shared/ops-db.js opsQuery aborts at 8 s, and
-- EXPLAIN ANALYZE on the view read 34.7 s. Both the `own_t0e_blocked` CTE and
-- the per-row LATERAL referenced v_lcc_ownt0e_sponsor_family_proposals, the
-- view OWN-T0e design §6 measured at 64 s -> 20 s and explicitly moved behind
-- lcc_ownt0e_sponsor_family_proposals_cache (cron lcc-ownt0e-proposals-refresh,
-- 27 */4 * * *) because "a view built for point-queries is not a population
-- source". The C13g-min migration re-committed exactly that footgun, and its
-- own "18 rows" measurement hid it: the SQL editor has a longer statement
-- timeout than the app's fetch.
--
-- Fix: the same two references now read the CACHE (same columns: sponsor_id,
-- sponsor_token, spe_ids uuid[], spe_props_max). Output is identical on the
-- 18-row population; the OWN-T0e blocker column can lag the cache by <= 4 h,
-- which is the same lag the sponsor lane itself displays. The two facts that
-- gate a WRITE (the entity's live type / tombstone) are read live in the
-- verdict path, never from this view.
--
-- Whole view restated (P194: a migration that changes a view carries the
-- WHOLE view). No column added or moved.
-- ============================================================================

create or replace view v_lcc_entity_retype_candidates as
with fact_pop as (
  select e.id as entity_id, e.name, e.entity_type,
         count(*) filter (where f.is_current) as current_facts,
         coalesce(sum(f.annual_rent) filter (where f.is_current), 0) as current_rent
    from entities e
    join lcc_entity_portfolio_facts f on f.entity_id = e.id
   where e.entity_type = 'person'
     and e.merged_into_entity_id is null
   group by e.id, e.name, e.entity_type
  having count(*) filter (where f.is_current) >= 2
),
own_t0e_blocked as (
  select distinct dup.id as entity_id, p.sponsor_id, p.sponsor_token
    from lcc_ownt0e_sponsor_family_proposals_cache p
    cross join lateral unnest(p.spe_ids) as spe_id
    join entities dup on dup.id = spe_id
    join entities spo on spo.id = p.sponsor_id
   where p.spe_props_max >= 2
     and dup.entity_type = 'person'
     and dup.merged_into_entity_id is null
     and spo.entity_type = 'organization'
),
population as (
  select fp.entity_id, fp.name, fp.current_facts, fp.current_rent
    from fact_pop fp
  union
  select b.entity_id, e.name, coalesce(fp.current_facts, 0), coalesce(fp.current_rent, 0)
    from own_t0e_blocked b
    join entities e on e.id = b.entity_id
    left join fact_pop fp on fp.entity_id = b.entity_id
   where fp.entity_id is null
)
select
  p.entity_id,
  p.name,
  p.current_facts,
  p.current_rent,
  exists (
    select 1 from external_identities xi
     where xi.entity_id = p.entity_id and xi.source_system = 'salesforce' and xi.source_type = 'Contact'
  ) as has_salesforce_contact,
  exists (
    select 1 from external_identities xi
     where xi.entity_id = p.entity_id and xi.source_system = 'salesforce' and xi.source_type = 'Account'
  ) as has_salesforce_account,
  (select count(*) from external_identities xi
    where xi.entity_id = p.entity_id and xi.source_system = 'rca' and xi.source_type = 'contact') as n_rca_contact_ids,
  (select count(*) from external_identities xi
    where xi.entity_id = p.entity_id and xi.source_system = 'costar' and xi.source_type = 'contact') as n_costar_contact_ids,
  lcc_looks_like_person(p.name) as looks_like_person_warning,
  lcc_owner_name_has_org_marker(p.name) as has_org_marker,
  (select count(*) from entity_relationships er
    where er.from_entity_id = p.entity_id or er.to_entity_id = p.entity_id) as relationship_count,
  (select count(*) from lcc_property_owner po where po.owner_entity_id = p.entity_id) as resolved_owner_of,
  ob.sponsor_id as blocks_own_t0e_sponsor_id,
  ob.sponsor_token as blocks_own_t0e_token
from population p
left join lateral (
  select p2.sponsor_id, p2.sponsor_token
    from lcc_ownt0e_sponsor_family_proposals_cache p2
   where p.entity_id = any(p2.spe_ids) and p2.spe_props_max >= 2
   order by p2.spe_props_max desc
   limit 1
) ob on true
order by (ob.sponsor_id is not null) desc, p.current_rent desc nulls last;

grant select on v_lcc_entity_retype_candidates to service_role;
