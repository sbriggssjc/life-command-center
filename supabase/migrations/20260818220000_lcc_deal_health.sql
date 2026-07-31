-- Deal-health / risk scoring (intelligence layer #2). Per open deal, a 0–100 risk score with
-- human reasons from signals already computed — past expected close, late-stage & quiet,
-- listing quiet, no activity, aged-in-early-stage. Owner-scoped via the reconciliation override.
-- Pure-DB, tunable weights. APPLIED LIVE 2026-07-31. Consume via lcc_deal_health(owner, limit)
-- or fold the score into lcc_my_day active_deals.
create or replace function public.lcc_deal_health(
  p_owner_user_id uuid default '1d3f7321-a4ad-4f83-9c7b-489554fc1c51'::uuid,
  p_limit int default 25)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with me as (select p_owner_user_id as uid),
  d as (
    select b.id, b.entity_id, coalesce(nullif(b.deal_name,''), b.property_address, e.name) as name,
           b.stage, b.expected_close_date, b.opened_at,
           coalesce(ov.owner_user_id, (select lu.lcc_user_id from lcc_users lu where lu.lcc_user_id=b.owner_user_id)) as eff_owner,
           (select max(u.occurred_at) from v_activity_unified u
             where u.entity_id=b.entity_id or u.deal_entity_id=b.entity_id or u.party_entity_id=b.entity_id) as last_touch_at
    from bd_opportunities b
    left join entities e on e.id=b.entity_id
    left join lcc_entity_owner_override ov on ov.entity_id=b.entity_id
    where b.is_open and b.entity_id is not null
  ),
  scored as (
    select d.*,
      case when d.last_touch_at is null then null else (current_date - d.last_touch_at::date) end as days_since_touch,
      case when d.expected_close_date is not null and d.expected_close_date < current_date then (current_date - d.expected_close_date) else 0 end as days_past_close,
      ( (case when d.expected_close_date is not null and d.expected_close_date < current_date then 40 else 0 end)
      + (case when d.stage in ('non_refundable','loi_executed')
              and (d.last_touch_at is null or (current_date - d.last_touch_at::date) > 7) then 30 else 0 end)
      + (case when d.stage in ('listing_signed','off_market_listing')
              and (d.last_touch_at is null or (current_date - d.last_touch_at::date) > 14) then 15 else 0 end)
      + (case when d.last_touch_at is null then 10 else 0 end)
      + (case when d.opened_at is not null and (current_date - d.opened_at::date) > 180
              and d.stage in ('bov','identified') then 10 else 0 end)
      ) as risk_score
    from d
  ),
  mine as (select * from scored where eff_owner is null or eff_owner=(select uid from me))
  select jsonb_build_object(
    'ok', true, 'generated_at', now(),
    'at_risk_count', (select count(*) from mine where risk_score >= 40),
    'deals', coalesce((select jsonb_agg(jsonb_build_object(
        'deal_id',id,'entity_id',entity_id,'name',name,'stage',stage,'risk_score',risk_score,
        'expected_close_date',expected_close_date,'days_past_close',days_past_close,
        'days_since_touch',days_since_touch,'unassigned',(eff_owner is null),
        'reasons', (
          select jsonb_agg(r) from (
            select 'Past expected close ('||days_past_close||'d)' as r where days_past_close > 0
            union all select 'Late stage, quiet '||coalesce(days_since_touch::text,'—')||'d' where stage in ('non_refundable','loi_executed') and (last_touch_at is null or days_since_touch>7)
            union all select 'Listing quiet '||coalesce(days_since_touch::text,'—')||'d' where stage in ('listing_signed','off_market_listing') and (last_touch_at is null or days_since_touch>14)
            union all select 'No logged activity' where last_touch_at is null
            union all select 'Aged in early stage (>180d)' where opened_at is not null and (current_date-opened_at::date)>180 and stage in ('bov','identified')
          ) x ))
        order by risk_score desc, days_past_close desc)
      from (select * from mine order by risk_score desc, days_past_close desc limit greatest(1,least(p_limit,100))) z), '[]'::jsonb)
  );
$function$;
