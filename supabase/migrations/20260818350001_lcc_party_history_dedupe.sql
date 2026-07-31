-- Dedupe fix for lcc_party_history: the graph carries multiple edges for the same
-- (party, asset, role) (re-ingested deeds/sidebars), so collapse to one row per
-- (role, asset) — prefer a current edge, then the latest observation — and count
-- role_total by DISTINCT asset. Otherwise the history double/triple-lists the same
-- building. This is the authoritative definition of lcc_party_history.
create or replace function lcc_party_history(p_entity uuid, p_per_role int default 25)
returns table (
  party_role text,
  sub_role text,
  asset_id uuid,
  asset_name text,
  city text,
  state text,
  effective_from date,
  effective_to date,
  is_current boolean,
  source text,
  role_total int
)
language sql stable as $$
  with base as (
    select distinct on (er.relationship_type, er.to_entity_id)
           er.relationship_type as party_role,
           (er.metadata->>'role') as sub_role,
           er.to_entity_id as asset_id, e.name as asset_name, e.city, e.state,
           er.effective_from, er.effective_to,
           (er.effective_to is null) as is_current,
           (er.metadata->>'source') as source
    from entity_relationships er
    join entities e on e.id = er.to_entity_id
    where er.from_entity_id = p_entity
      and er.relationship_type in ('owns','purchases','sells','brokers','finances','developed')
      and er.to_entity_id is not null
    order by er.relationship_type, er.to_entity_id,
             (er.effective_to is null) desc, er.effective_from desc nulls last
  ),
  ranked as (
    select b.*,
      row_number() over (
        partition by b.party_role
        order by b.is_current desc, b.effective_from desc nulls last
      ) as rn,
      count(*) over (partition by b.party_role)::int as role_total
    from base b
  )
  select party_role, sub_role, asset_id, asset_name, city, state,
         effective_from, effective_to, is_current, source, role_total
  from ranked
  where rn <= greatest(1, coalesce(p_per_role, 25))
  order by party_role, is_current desc, effective_from desc nulls last;
$$;
