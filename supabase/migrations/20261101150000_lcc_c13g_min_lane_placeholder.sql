-- ============================================================================
-- C13g-min-lane-placeholder (2026-09-09) — a PLACEHOLDER entity does not
-- belong on the entity_type_review lane. Neither verdict fits a placeholder
-- ("Retype to organization" asserts a firm; "Keep as person" asserts a
-- person), and none of the three existing guards fires on it, measured live:
--
--   select lcc_is_placeholder_owner_name('Research In Progress'),   -- false
--          lcc_p131_is_document_row_label('Research In Progress'), -- false
--          lcc_a2_is_placeholder_party('Research In Progress');    -- false
--
-- "Research In Progress" is one of the four live v_lcc_entity_retype_candidates
-- rows (2026-09-09): entity e38b93d4-4c17-4a33-8211-f7928851e9af, 2 current
-- portfolio facts, $0 current rent. Blast radius measured before widening the
-- SHARED guard (never `contains`, per P158a/A2's anchored-prefix rule):
--
--   select count(*) from entities where lower(btrim(name)) = 'research in progress';
--   -- 2 fleet-wide, both genuine placeholders, 0 real parties
--
-- Fix, three parts:
--   1. Widen lcc_is_placeholder_owner_name's exact-match IN list with the one
--      literal measured above (anchored exact match on the lower/trimmed
--      name, same shape as every other entry in that list — never a regex,
--      never `contains`).
--   2. Restate v_lcc_entity_retype_candidates WHOLE (P194: a migration that
--      changes a view carries the whole view) to exclude
--      lcc_is_placeholder_owner_name(name) from BOTH population sources
--      (fact_pop directly, and the own_t0e_blocked union branch, so a
--      placeholder can never reach the lane via either path).
--   3. A narrow view, v_lcc_entity_retype_placeholder_excluded, mirroring
--      fact_pop's own WHERE with the guard INVERTED — the population the
--      candidates view now excludes — so the excluded row(s) are not
--      silently dropped: api/admin.js's one-shot
--      `entity-retype-placeholder-seed` reads it and routes them to the
--      EXISTING junk_entity_review lane (retire, never merge — the C13g-min
--      backlog row's own instruction), so the fact that they held current
--      portfolio facts is recorded, not lost.
--
-- VERIFY: select count(*) from v_lcc_entity_retype_candidates;  -- 3 (was 4)
--         select * from v_lcc_entity_retype_placeholder_excluded;  -- 1 row
-- REVERSE: `create or replace function public.lcc_is_placeholder_owner_name`
--   dropping the added literal restores the prior 21-entry IN list; the two
--   views restate to their pre-migration bodies (both committed in full below
--   AND in 20261101120000/20261101130000, so either can be replayed).
-- ============================================================================

create or replace function public.lcc_is_placeholder_owner_name(p_name text)
returns boolean language plpgsql immutable as
$$
declare n text;
begin
  if p_name is null then return true; end if;
  n := lower(btrim(p_name));
  if n = '' then return true; end if;
  if n in ('john doe','jane doe','independent','n/a','na','none','unknown','tbd','tba',
           'various','multiple','undisclosed','not available','not disclosed','owner',
           'current owner','recorded owner','the owner','same','see above','no owner',
           'research in progress') then
    return true;
  end if;
  if n ~ '^[0-9.,$%()\-\s]+$' then return true; end if;      -- numeric / symbol-only
  return false;
end;
$$;

create or replace view v_lcc_entity_retype_candidates as
with fact_pop as (
  select e.id as entity_id, e.name, e.entity_type,
         count(*) filter (where f.is_current) as current_facts,
         coalesce(sum(f.annual_rent) filter (where f.is_current), 0) as current_rent
    from entities e
    join lcc_entity_portfolio_facts f on f.entity_id = e.id
   where e.entity_type = 'person'
     and e.merged_into_entity_id is null
     and not lcc_is_placeholder_owner_name(e.name)
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
     and not lcc_is_placeholder_owner_name(dup.name)
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

-- ---------------------------------------------------------------------------
-- The excluded population, for the one-shot placeholder-routing seed
-- (api/admin.js handleEntityRetypePlaceholderSeed). Mirrors fact_pop's own
-- WHERE with the guard inverted — same shape as the candidates view, never a
-- second normalizer.
-- ---------------------------------------------------------------------------
create or replace view v_lcc_entity_retype_placeholder_excluded as
select e.id as entity_id, e.name,
       count(*) filter (where f.is_current) as current_facts,
       coalesce(sum(f.annual_rent) filter (where f.is_current), 0) as current_rent
  from entities e
  join lcc_entity_portfolio_facts f on f.entity_id = e.id
 where e.entity_type = 'person'
   and e.merged_into_entity_id is null
   and lcc_is_placeholder_owner_name(e.name)
 group by e.id, e.name
having count(*) filter (where f.is_current) >= 2;

comment on view public.v_lcc_entity_retype_placeholder_excluded is
  'C13g-min-lane-placeholder: the population v_lcc_entity_retype_candidates now excludes for being a '
  'placeholder name (lcc_is_placeholder_owner_name) — read by the one-shot '
  'api/admin.js?action=entity-retype-placeholder-seed, which routes these rows to junk_entity_review '
  '(retire, never merge) instead of silently dropping them off the entity_type_review lane.';

grant select on v_lcc_entity_retype_placeholder_excluded to service_role;
