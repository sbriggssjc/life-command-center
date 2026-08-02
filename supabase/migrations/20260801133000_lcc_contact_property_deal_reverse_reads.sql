-- Prompt 13 — Contact -> Property/Deal reverse read models.
--
-- Pure graph reads over entity_relationships + external_identities. Person
-- contacts inherit context through explicit company/account links only
-- (works_at / associated_with / owner_parent / managed_by); no name matching.

create or replace function public.lcc_contact_properties(p_entity uuid, p_limit int default 200)
returns table (
  subject_entity_id uuid,
  subject_name text,
  subject_type text,
  via_relationship text,
  role text,
  sub_role text,
  asset_entity_id uuid,
  asset_name text,
  domain text,
  property_id text,
  address text,
  city text,
  state text,
  tenant text,
  effective_from date,
  effective_to date,
  is_current boolean,
  source text
)
language sql stable security definer set search_path to 'public'
as $$
  with subject_entities as (
    select e.id as subject_entity_id, e.name as subject_name, e.entity_type::text as subject_type,
           'direct'::text as via_relationship, 0 as ord
    from public.entities e
    where e.id = p_entity
    union
    select o.id, o.name, o.entity_type::text, er.relationship_type, 1
    from public.entity_relationships er
    join public.entities o
      on o.id = case when er.from_entity_id = p_entity then er.to_entity_id else er.from_entity_id end
    where (er.from_entity_id = p_entity or er.to_entity_id = p_entity)
      and er.relationship_type in ('works_at','associated_with','owner_parent','managed_by')
      and coalesce((er.metadata->>'quarantined')::boolean, false) = false
  ),
  edges as (
    select distinct on (se.subject_entity_id, er.relationship_type, er.to_entity_id, coalesce(er.metadata->>'role',''))
           se.subject_entity_id, se.subject_name, se.subject_type, se.via_relationship,
           case
             when er.relationship_type = 'owns' then 'owner'
             when er.relationship_type = 'purchases' then 'buyer'
             when er.relationship_type = 'sells' then 'seller'
             when er.relationship_type = 'brokers' then coalesce(nullif(er.metadata->>'role',''), 'broker')
             when er.relationship_type = 'finances' then coalesce(nullif(er.metadata->>'role',''), 'lender')
             when er.relationship_type = 'guaranteed_by' then 'guarantor'
             when er.relationship_type = 'developed' then 'developer'
             when er.relationship_type = 'deal_party' then coalesce(nullif(er.metadata->>'role',''), 'deal_party')
             else er.relationship_type
           end as role,
           er.metadata->>'role' as sub_role,
           er.to_entity_id as asset_entity_id,
           ae.name as asset_name,
           er.effective_from, er.effective_to,
           (er.effective_to is null) as is_current,
           coalesce(er.metadata->>'source','entity_relationships') as source,
           se.ord
    from subject_entities se
    join public.entity_relationships er on er.from_entity_id = se.subject_entity_id
    join public.entities ae on ae.id = er.to_entity_id
    where er.to_entity_id is not null
      and er.relationship_type in ('owns','purchases','sells','brokers','finances','deal_party','guaranteed_by','developed')
      and coalesce((er.metadata->>'quarantined')::boolean, false) = false
    order by se.subject_entity_id, er.relationship_type, er.to_entity_id, coalesce(er.metadata->>'role',''),
             (er.effective_to is null) desc, er.effective_from desc nulls last, se.ord
  )
  select e.subject_entity_id, e.subject_name, e.subject_type, e.via_relationship,
         e.role, e.sub_role, e.asset_entity_id, e.asset_name,
         xi.source_system as domain, xi.external_id as property_id,
         pa.address, pa.city, pa.state, coalesce(pa.tenant_label, pa.tenant_short) as tenant,
         e.effective_from, e.effective_to, e.is_current, e.source
  from edges e
  left join public.external_identities xi
    on xi.entity_id = e.asset_entity_id
   and xi.source_system in ('dia','gov')
   and xi.source_type = 'asset'
  left join public.lcc_property_attributes pa
    on pa.source_domain = xi.source_system
   and pa.source_property_id = xi.external_id
  order by e.is_current desc, e.effective_from desc nulls last, e.asset_name
  limit greatest(1, coalesce(p_limit, 200));
$$;

create or replace function public.lcc_contact_deals(p_entity uuid, p_limit int default 200)
returns table (
  subject_entity_id uuid,
  subject_name text,
  subject_type text,
  via_relationship text,
  role text,
  sub_role text,
  asset_entity_id uuid,
  asset_name text,
  domain text,
  property_id text,
  address text,
  deal_id uuid,
  deal_name text,
  stage text,
  is_open boolean,
  closed_won boolean,
  amount numeric,
  opened_at timestamptz,
  closed_at timestamptz,
  next_action text,
  source text
)
language sql stable security definer set search_path to 'public'
as $$
  with cp as (
    select *
    from public.lcc_contact_properties(p_entity, p_limit)
  ),
  dedup as (
    select distinct on (cp.subject_entity_id, cp.asset_entity_id, cp.role)
           cp.subject_entity_id, cp.subject_name, cp.subject_type, cp.via_relationship,
           cp.role, cp.sub_role, cp.asset_entity_id, cp.asset_name, cp.domain, cp.property_id,
           cp.address
    from cp
    order by cp.subject_entity_id, cp.asset_entity_id, cp.role,
             case when cp.is_current then 0 else 1 end
  )
  select d.subject_entity_id, d.subject_name, d.subject_type, d.via_relationship,
         d.role, d.sub_role, d.asset_entity_id, d.asset_name, d.domain, d.property_id,
         d.address,
         bo.id as deal_id,
         coalesce(bo.deal_name, bo.property_address, d.asset_name) as deal_name,
         bo.stage,
         bo.is_open,
         bo.closed_won,
         bo.amount,
         bo.opened_at,
         bo.closed_at,
         coalesce(bo.metadata->>'next_action', bo.metadata->>'next_step') as next_action,
         'bd_opportunities'::text as source
  from dedup d
  join public.bd_opportunities bo on bo.entity_id = d.asset_entity_id
  order by bo.is_open desc, bo.closed_at desc nulls last, bo.opened_at desc nulls last
  limit greatest(1, coalesce(p_limit, 200));
$$;

grant execute on function public.lcc_contact_properties(uuid, int) to anon, authenticated, service_role;
grant execute on function public.lcc_contact_deals(uuid, int) to anon, authenticated, service_role;
