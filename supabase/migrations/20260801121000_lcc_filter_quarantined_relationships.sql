-- Quarantined entity_relationships are retained for reversibility/audit, but
-- graph read models must not surface them as active party facts.

create or replace function public.lcc_party_relationships(p_entity uuid, p_limit int default 40)
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
      and coalesce((er.metadata->>'quarantined')::boolean, false) = false
  ),
  cp as (
    select er.from_entity_id as cp_id, er.relationship_type as cp_role, pa.party_role,
           pa.asset_id, coalesce(er.effective_from::timestamptz, er.created_at) as dt
    from party_assets pa
    join entity_relationships er on er.to_entity_id = pa.asset_id
    where er.from_entity_id <> p_entity
      and er.relationship_type in ('owns','purchases','sells','brokers','finances','developed')
      and coalesce((er.metadata->>'quarantined')::boolean, false) = false
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

create or replace function public.lcc_party_history(p_entity uuid, p_per_role int default 25)
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
      and coalesce((er.metadata->>'quarantined')::boolean, false) = false
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

create or replace function public.lcc_deal_parties(p_entity uuid, p_limit int default 60)
 returns table (
   party_entity_id uuid,
   name            text,
   entity_type     text,
   relationship    text,
   side            text,
   role            text,
   effective_from  date,
   effective_to    date,
   is_current      boolean,
   source          text
 )
 language sql stable security definer set search_path to 'public'
as $function$
  select r.from_entity_id as party_entity_id,
         e.name, e.entity_type,
         r.relationship_type as relationship,
         case r.relationship_type
           when 'purchases' then 'buyer'
           when 'sells'     then 'seller'
           when 'owns'      then 'seller'
           when 'brokers'   then 'third_party'
           when 'finances'  then 'lender'
           else 'other' end as side,
         coalesce(r.metadata->>'role', r.relationship_type) as role,
         r.effective_from, r.effective_to,
         (r.effective_to is null) as is_current,
         coalesce(r.metadata->>'source','entity_relationships') as source
  from public.entity_relationships r
  join public.entities e on e.id = r.from_entity_id
  where r.to_entity_id = p_entity
    and r.relationship_type in ('purchases','sells','owns','brokers','finances','deal_party','guaranteed_by','developed')
    and coalesce((r.metadata->>'quarantined')::boolean, false) = false
  order by is_current desc, r.effective_from desc nulls last
  limit greatest(1, coalesce(p_limit, 60));
$function$;
