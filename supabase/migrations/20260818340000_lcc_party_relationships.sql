-- Tab 3 "Relationships" — working-relationship intelligence for a party.
-- For a party P, walk P's transaction assets and collect the OTHER parties on
-- the same asset, rolled up per counterparty + derived relationship, ranked by
-- how many assets they share. Surfaces "sold to REIT X", "co-brokers with CBRE",
-- "financed by lender Y". Pure graph rollup over entity_relationships — no new
-- data. Direction convention: from_entity_id = party, to_entity_id = asset.
create or replace function lcc_party_relationships(p_entity uuid, p_limit int default 40)
returns table (
  counterparty_id uuid,
  counterparty_name text,
  counterparty_type text,
  org_type text,
  relationship text,
  shared_assets int,
  last_date date,
  is_institution boolean
)
language sql stable as $$
  with party_assets as (
    select er.to_entity_id as asset_id, er.relationship_type as party_role
    from entity_relationships er
    where er.from_entity_id = p_entity
      and er.relationship_type in ('owns','purchases','sells','brokers','finances','developed')
      and er.to_entity_id is not null
  ),
  cp as (
    select er.from_entity_id as cp_id, er.relationship_type as cp_role, pa.party_role,
           pa.asset_id, coalesce(er.effective_from::timestamptz, er.created_at) as dt
    from party_assets pa
    join entity_relationships er on er.to_entity_id = pa.asset_id
    where er.from_entity_id <> p_entity
      and er.relationship_type in ('owns','purchases','sells','brokers','finances','developed')
  ),
  labeled as (
    select cp_id, asset_id, dt,
      case
        when party_role='sells' and cp_role='purchases' then 'sold_to'
        when party_role in ('purchases','owns') and cp_role='sells' then 'bought_from'
        when party_role in ('owns','purchases','sells') and cp_role='finances' then 'financed_by'
        when party_role='finances' and cp_role in ('owns','purchases') then 'lent_to'
        when party_role='brokers' and cp_role in ('purchases','sells','owns') then 'brokered_for'
        when party_role in ('owns','purchases','sells') and cp_role='brokers' then 'broker_on_deal'
        when party_role='brokers' and cp_role='brokers' then 'co_broker'
        when party_role='owns' and cp_role='owns' then 'co_owner'
        else 'co_party' end as relationship
    from cp
  )
  select l.cp_id,
         e.name,
         e.entity_type::text,
         e.org_type,
         l.relationship,
         count(distinct l.asset_id)::int as shared_assets,
         max(l.dt)::date as last_date,
         (e.name ~* '(\yREIT\y|realty income|realty trust|properties trust|income trust|healthcare trust|medical properties|net lease|physicians realty|healthpeak|ventas|welltower|omega health|sabra|caretrust|global medical|store capital|spirit realty|national retail|agree realty|w\.? ?p\.? ?carey|broadstone|essential properties|getty realty|netstreit|gladstone commercial|postal realty|four corners|community healthcare)') as is_institution
  from labeled l
  join entities e on e.id = l.cp_id
  where l.relationship <> 'co_party'
  group by l.cp_id, e.name, e.entity_type, e.org_type, l.relationship
  order by shared_assets desc, last_date desc nulls last
  limit greatest(1, coalesce(p_limit, 40));
$$;
