-- Resolve a correspondent's premise relative to a deal (buyer/broker/seller/other) from the
-- entity graph, for the role-aware next-step engine. Relationships run party → asset:
-- purchases→buyer, brokers→broker, sells/owns→seller. APPLIED LIVE 2026-07-31.
create or replace function public.lcc_party_role(p_party uuid, p_deal uuid)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    (select case r.relationship_type
              when 'purchases' then 'buyer'
              when 'brokers'   then 'broker'
              when 'sells'     then 'seller'
              when 'owns'      then 'seller'
              else 'other' end
     from public.entity_relationships r
     where r.from_entity_id = p_party and r.to_entity_id = p_deal
       and r.relationship_type in ('purchases','brokers','sells','owns')
     order by case r.relationship_type
                when 'purchases' then 1 when 'brokers' then 2 when 'sells' then 3 when 'owns' then 4 else 5 end
     limit 1),
    'other');
$function$;
