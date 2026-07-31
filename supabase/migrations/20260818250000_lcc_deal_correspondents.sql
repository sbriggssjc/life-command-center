-- Deal → correspondents / search-seed for the correspondence-ingestion pipeline (see
-- docs/architecture/correspondence-ingestion-design.md). Returns deal name (subject search),
-- recorded primary_contact, and related-party emails/names (deal_party/broker/seller/buyer →
-- unified_contacts). Also useful standalone: "who do I contact on this deal." APPLIED LIVE
-- 2026-07-31. Coverage: 40/40 open deals get a subject seed; 13 also carry correspondent emails.
create or replace function public.lcc_deal_correspondents(p_deal_entity_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with deal as (
    select coalesce(nullif(b.deal_name,''), b.property_address, (select name from entities where id=p_deal_entity_id)) as name,
           b.metadata->'primary_contact' as pc
    from bd_opportunities b where b.entity_id = p_deal_entity_id and b.is_open limit 1
  ),
  related_people as (
    select distinct case when r.from_entity_id=p_deal_entity_id then r.to_entity_id else r.from_entity_id end as person_id,
           r.relationship_type
    from entity_relationships r
    where (r.from_entity_id=p_deal_entity_id or r.to_entity_id=p_deal_entity_id)
      and r.relationship_type in ('deal_party','brokers','sells','purchases','owns')
  ),
  emails as (
    select distinct lower(u.email) as email, u.full_name,
           (select string_agg(distinct rp.relationship_type, ',') from related_people rp where rp.person_id=u.entity_id) as roles
    from unified_contacts u
    join related_people rp on rp.person_id = u.entity_id
    where u.email is not null and u.email <> ''
  )
  select jsonb_build_object(
    'deal_entity_id', p_deal_entity_id,
    'deal_name', (select name from deal),
    'primary_contact', (select pc from deal),
    'search_subjects', jsonb_build_array((select name from deal)),
    'correspondent_emails', coalesce((select jsonb_agg(distinct email) from emails), '[]'::jsonb),
    'correspondents', coalesce((select jsonb_agg(jsonb_build_object('email',email,'name',full_name,'roles',roles)) from emails), '[]'::jsonb)
  );
$function$;
