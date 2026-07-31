-- Tab 2 "Portfolio & History" (Scott ask #1) — every role a party has played on
-- every asset, over time: as owner / buyer / seller / broker / lender / developer,
-- current-vs-prior, with the sub-role (listing_broker, true_seller, lender, ...)
-- and the observation date. Pure graph read over entity_relationships (from=party,
-- to=asset). Capped PER ROLE so a prolific role (1000s of purchases) doesn't drown
-- the rare ones (a couple of broker deals); role_total gives an honest "N of M".
-- NOTE: superseded in the same session by 20260818350001 (dedupe fix). This file
-- is the initial definition; the dedupe migration is the authoritative one.
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
    select er.relationship_type as party_role,
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
