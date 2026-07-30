-- Distinct Salesforce record Ids stamped on priority-queue deals (Account + Opportunity),
-- for the SF owner-sync worker (api/_handlers/sf-owner-sync.js). Read-only, no arbitrary SQL.
-- APPLIED LIVE 2026-07-30 via MCP; mirrored here for repo migration history.
create or replace function public.lcc_deal_sf_ids(p_limit int default null)
 returns table(sf_id text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with pq as (select distinct entity_id from v_priority_queue_enriched),
  ids as (
    select nullif(e.metadata->'salesforce'->>'account_id','') as sf_id
      from entities e join pq on pq.entity_id = e.id
    union
    select nullif(e.metadata->>'sf_account','') from entities e join pq on pq.entity_id = e.id
    union
    select nullif(e.metadata->>'sf_opp_id','') from entities e join pq on pq.entity_id = e.id
    union
    select nullif(uc.sf_account_id,'') from unified_contacts uc join pq on pq.entity_id = uc.entity_id
  )
  select distinct sf_id from ids where sf_id is not null
  limit case when p_limit is null or p_limit <= 0 then null else p_limit end;
$function$;
