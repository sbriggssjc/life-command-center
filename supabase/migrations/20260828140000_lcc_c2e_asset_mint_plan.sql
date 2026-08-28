-- C2e -- the no-floor, eligible-set gov asset mint plan (2026-08-28)
--
-- Scott's decision (connectivity-and-open-threads.md §4h): NO rent floor, but
-- ELIGIBLE SET ONLY -- mint every gov property whose owner resolves on the same
-- pass, and skip the ~3,600 that would resolve nothing and match the documented
-- retire predicate ("a minted entity with no evidence and no portfolio fact has
-- no consumer") on day one.  "Evidence justifies the entity, never the reverse."
--
-- WHY A VIEW AND NOT A SCRIPT: the plan is the auditable object.  Tranche two
-- reads this same view (`where cum_props <= N`), so the two tranches cannot
-- drift apart, and the eligibility verdict is inspectable before and after.
-- Precedent: v_lcc_p195_merge_plan, v_lcc_a2a_ambiguity_merge_plan.
--
-- The classification mirrors v_lcc_domain_owner_candidates' own CASE arm for
-- arm, plus the sixth guard C2a added (lcc_reconcile_property_owner filters
-- lcc_owner_name_is_brokerage(ce.name) INSIDE its scoring CTE, so a candidate
-- can clear the view and still score zero evidence and never resolve).  It is
-- deliberately NOT a re-implementation of the resolver: it is the same
-- predicates applied to properties that have NO asset entity yet and therefore
-- cannot appear in the candidate view at all -- that view starts FROM
-- external_identities asset rows, so a property with no anchor is invisible to
-- it by construction.
--
-- Cross-checked live: minting tranche one moved the production candidate view's
-- gov `eligible` count 3 -> 2,003, i.e. it agreed with this view's verdict on
-- 2,000 of 2,000 rows.
--
-- The 'ambiguous' and 'self_reference' arms are structurally inapplicable to a
-- fresh mint (one new entity per property, no prior identity), so they are
-- absent rather than reported as a zero.
--
-- READ-ONLY.  Nothing here writes.  Reversible: DROP VIEW.
create or replace view public.v_lcc_c2e_asset_mint_plan as
with prop as (
  select pa.source_property_id as pid,
         pa.annual_rent        as rent,
         -- the feeder's own name shape: "<address>, <city>, <state>"
         nullif(btrim(concat_ws(', ',
           nullif(btrim(pa.address),''),
           nullif(btrim(concat_ws(', ', nullif(btrim(pa.city),''),
                                        nullif(btrim(pa.state),''))),''))),'') as name
  from public.lcc_property_attributes pa
  where pa.source_domain = 'gov'          -- gov ONLY.  dia is a different problem
),                                        -- (84% operator-blocked, P113) and must not be swept in.
noasset as (
  select p.* from prop p
  where not exists (select 1 from public.external_identities ei
                     where ei.source_system='gov' and ei.source_type='asset'
                       and ei.external_id = p.pid)
),
j as (
  select n.*,
         f.true_owner_effective_id                       as toid,
         f.true_owner_name                               as toname,
         coalesce(f.true_owner_is_operator, false)       as is_op,
         -- ID-to-ID, never by name (the "Realty Income Corporation" -> '' footgun)
         (select oi.entity_id from public.external_identities oi
           where oi.source_system='gov' and oi.source_type='true_owner'
             and oi.external_id = f.true_owner_effective_id::text
           order by oi.entity_id limit 1)                as owner_ent
  from noasset n
  left join public.lcc_property_owner_facts f
    on f.source_domain='gov' and f.source_property_id = n.pid
),
classified as (
  select j.*,
    case
      when j.name  is null then 'no_name'
      when j.toid  is null then 'no_true_owner'
      when j.is_op         then 'operator_blocked'
      when not public.lcc_owner_name_promotable(j.toname) then 'name_blocked'
      when j.owner_ent is null then 'no_owner_entity'
      when exists (select 1 from public.lcc_owner_operator_block b
                    where b.owner_entity_id = j.owner_ent) then 'operator_blocked'
      when exists (select 1 from public.entities ce
                    where ce.id = j.owner_ent
                      and public.lcc_owner_name_is_brokerage(ce.name))
           then 'brokerage_at_reconcile'
      -- P175: existence is not liveness.  Measured nil today (0 of 8,919 gov
      -- true_owner identities sit on a tombstone, because P178's trigger
      -- resolves entity_id to the survivor at INSERT) -- kept so it stays nil.
      when not exists (select 1 from public.entities ce
                        where ce.id = j.owner_ent and ce.merged_into_entity_id is null)
           then 'owner_entity_tombstoned'
      else 'eligible'
    end as status
  from j
),
-- Owner-level gov portfolio rent across EVERY non-archived gov property that
-- owner holds (minted or not) -- value is per OWNER, never per property.
own_rent as (
  select oi.entity_id as owner_ent,
         sum(pa.annual_rent) as owner_gov_rent,
         count(*)            as owner_gov_props
  from public.lcc_property_owner_facts f
  join public.external_identities oi
    on oi.source_system='gov' and oi.source_type='true_owner'
   and oi.external_id = f.true_owner_effective_id::text
  join public.lcc_property_attributes pa
    on pa.source_domain='gov' and pa.source_property_id = f.source_property_id
  where f.source_domain='gov' and f.true_owner_effective_id is not null
  group by 1
),
ranked as (
  select c.*, e.name as owner_name, r.owner_gov_rent, r.owner_gov_props,
         not exists (select 1 from public.lcc_property_owner po
                      where po.owner_entity_id = c.owner_ent) as owner_is_net_new,
         dense_rank() over (order by r.owner_gov_rent desc nulls last, c.owner_ent) as owner_rank
  from classified c
  left join own_rent r on r.owner_ent = c.owner_ent
  left join public.entities e on e.id = c.owner_ent
  where c.status = 'eligible'
)
select pid, name, rent, owner_ent, owner_name, owner_gov_rent, owner_gov_props,
       owner_is_net_new, owner_rank,
       -- cumulative property count when owners are taken WHOLE, richest first.
       -- Owners are kept whole deliberately: evidence lands per property, and a
       -- split owner is a half-resolved owner.  The tranche cut is a QUERY-TIME
       -- parameter (`where cum_props <= N`), not baked in.
       sum(count(*)) over (order by owner_rank rows between unbounded preceding and current row)
         as cum_props
from ranked
group by pid, name, rent, owner_ent, owner_name, owner_gov_rent, owner_gov_props,
         owner_is_net_new, owner_rank;

comment on view public.v_lcc_c2e_asset_mint_plan is
'C2e (2026-08-28): gov properties with no asset entity whose owner resolves ID-to-ID on the same pass. No rent floor (Scott, connectivity §4h); eligible-set only, so every minted entity carries evidence immediately. Read-only plan; the mint is lcc_mint_gov_asset_entities(p_rows,p_batch,p_dry_run,p_reason). Cut a tranche with `where cum_props <= N` -- owners are taken whole, richest gov portfolio first. The view self-excludes rows once minted, so it is also the live remaining-backlog surface.';

grant select on public.v_lcc_c2e_asset_mint_plan to service_role;
