-- lcc_my_day: fold deal-health risk (score + reasons) into active_deals; lead the section
-- with at-risk deals (order risk_score desc, then stage_rank); add active_deal_at_risk count.
-- Same risk formula as lcc_deal_health. APPLIED LIVE 2026-07-31. Supersedes 20260818210000.
create or replace function public.lcc_my_day(
  p_owner_user_id uuid default '1d3f7321-a4ad-4f83-9c7b-489554fc1c51'::uuid,
  p_todo_limit integer default 25, p_pipeline_limit integer default 12,
  p_deal_limit integer default 25, p_touch_limit integer default 15)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with me as (select p_owner_user_id as uid),
  ai0 as (
    select ai.id, ai.entity_id, ai.action_type, ai.status, ai.title, ai.priority, ai.due_date,
           e.name as entity_name, e.entity_type,
           coalesce(ov.owner_user_id,
             (select lu.lcc_user_id from lcc_users lu where lu.lcc_user_id = ai.assigned_to),
             (select lu.lcc_user_id from lcc_users lu where lu.lcc_user_id = ai.owner_id)) as eff_owner
    from action_items ai
    left join entities e on e.id = ai.entity_id
    left join lcc_entity_owner_override ov on ov.entity_id = ai.entity_id
    where ai.workspace_id = 'a0000000-0000-0000-0000-000000000001' and ai.status in ('open','in_progress')
  ),
  ai_mine as (select * from ai0 where eff_owner is null or eff_owner = (select uid from me)),
  touches as (
    select m.id as todo_id, u.occurred_at, u.channel, u.direction, u.title, u.who
    from ai_mine m
    join v_activity_unified u on (u.entity_id = m.entity_id or u.party_entity_id = m.entity_id or u.deal_entity_id = m.entity_id)
  ),
  tagg as (
    select todo_id, max(occurred_at) last_touch_at, array_agg(distinct channel) channels, count(*) touch_count,
      (select coalesce(jsonb_agg(jsonb_build_object('occurred_at',t2.occurred_at,'channel',t2.channel,
              'direction',t2.direction,'title',left(t2.title,120),'who',t2.who) order by t2.occurred_at desc),'[]'::jsonb)
       from (select * from touches t3 where t3.todo_id=t.todo_id order by t3.occurred_at desc limit 6) t2) recent
    from touches t group by todo_id
  ),
  todos as (
    select m.*, ta.last_touch_at, ta.channels, coalesce(ta.touch_count,0) touch_count, coalesce(ta.recent,'[]'::jsonb) recent,
      case when ta.last_touch_at is null then null else (current_date - ta.last_touch_at::date) end as days_since_touch,
      ( (case when m.due_date is not null and m.due_date < current_date then 100
              when m.due_date = current_date then 60 else 0 end)
      + (case when m.priority='high' then 30 when m.priority='urgent' then 45 else 0 end)
      + (case when m.action_type='offer_review' then 20 else 0 end)
      + least(coalesce(current_date - ta.last_touch_at::date, 30),60)/2 ) as rank_score
    from ai_mine m left join tagg ta on ta.todo_id = m.id
  ),
  deals0 as (
    select b.id, b.entity_id, coalesce(nullif(b.deal_name,''), b.property_address, e.name) as name,
           b.stage, b.amount, b.expected_close_date, b.opened_at, b.vertical,
           coalesce(ov.owner_user_id, (select lu.lcc_user_id from lcc_users lu where lu.lcc_user_id = b.owner_user_id)) as eff_owner,
           case b.stage when 'non_refundable' then 1 when 'loi_executed' then 2 when 'off_market_listing' then 3
                        when 'listing_signed' then 4 when 'bov' then 5 when 'identified' then 6 else 7 end as stage_rank,
           lt.last_touch_at, lt.last_channel, lt.last_title,
           case when lt.last_touch_at is null then null else (current_date - lt.last_touch_at::date) end as days_since_touch,
           case when b.expected_close_date is not null and b.expected_close_date < current_date then (current_date - b.expected_close_date) else 0 end as days_past_close,
           case when lt.last_touch_at is null then true
                when b.stage in ('non_refundable','loi_executed') and (current_date - lt.last_touch_at::date) > 7  then true
                when b.stage in ('listing_signed','off_market_listing') and (current_date - lt.last_touch_at::date) > 14 then true
                when b.stage = 'bov' and (current_date - lt.last_touch_at::date) > 10 then true
                else false end as is_stale,
           ( (case when b.expected_close_date is not null and b.expected_close_date < current_date then 40 else 0 end)
           + (case when b.stage in ('non_refundable','loi_executed') and (lt.last_touch_at is null or (current_date - lt.last_touch_at::date) > 7) then 30 else 0 end)
           + (case when b.stage in ('listing_signed','off_market_listing') and (lt.last_touch_at is null or (current_date - lt.last_touch_at::date) > 14) then 15 else 0 end)
           + (case when lt.last_touch_at is null then 10 else 0 end)
           + (case when b.opened_at is not null and (current_date - b.opened_at::date) > 180 and b.stage in ('bov','identified') then 10 else 0 end)
           ) as risk_score
    from bd_opportunities b
    left join entities e on e.id = b.entity_id
    left join lcc_entity_owner_override ov on ov.entity_id = b.entity_id
    left join lateral (
      select u.occurred_at as last_touch_at, u.channel as last_channel, left(u.title,140) as last_title
      from v_activity_unified u
      where u.entity_id = b.entity_id or u.deal_entity_id = b.entity_id or u.party_entity_id = b.entity_id
      order by u.occurred_at desc limit 1
    ) lt on true
    where b.is_open
  ),
  tc0 as (
    select tc.id, tc.entity_id, tc.contact_id, tc.property_address, tc.domain,
           tc.priority_tier, tc.phase, tc.next_touch_due, tc.next_touch_type, tc.next_touch_template, tc.notes,
           tc.last_touch_at, tc.last_touch_type,
           coalesce((select e.name from entities e where e.id = tc.contact_id),
                    (select u.full_name from unified_contacts u where u.entity_id = tc.contact_id limit 1),
                    (select e2.name from entities e2 where e2.id = tc.entity_id),
                    tc.property_address) as contact_name,
           en.engagement_score, en.total_deal_volume, en.deals_transacted,
           coalesce(ov.owner_user_id, (select lu.lcc_user_id from lcc_users lu where lu.lcc_user_id = tc.owner_user_id)) as eff_owner,
           greatest(0, current_date - tc.next_touch_due::date) as overdue_days,
           case tc.priority_tier when 'A' then 1 when 'B' then 2 when 'C' then 3 else 4 end as tier_rank
    from touchpoint_cadence tc
    left join lcc_entity_owner_override ov on ov.entity_id = tc.entity_id
    left join contact_engagement en on en.contact_id = tc.contact_id
    where tc.next_touch_due::date <= current_date
      and (current_date - tc.next_touch_due::date) <= 400
      and coalesce(tc.unsubscribe_status,'') <> 'unsubscribed'
  ),
  tc_mine as (select * from tc0 where eff_owner is null or eff_owner = (select uid from me)),
  q0 as (
    select q.entity_id, q.name, q.priority_band, q.reason, q.days_overdue,
           q.effective_owner_role, q.current_annual_rent_total, q.rank_annual_rent, q.effective_domain,
           coalesce(ov.owner_user_id, q.owner_user_id) as eff_owner
    from v_priority_queue_enriched q
    left join lcc_entity_owner_override ov on ov.entity_id = q.entity_id
  ),
  q_mine as (select * from q0 where eff_owner is null or eff_owner = (select uid from me))
  select jsonb_build_object(
    'ok', true, 'owner_user_id', (select uid from me),
    'owner_name', (select display_name from lcc_users where lcc_user_id = (select uid from me)),
    'generated_at', now(),
    'todo_count', (select count(*) from todos),
    'active_deal_count', (select count(*) from deals0 where eff_owner is null or eff_owner=(select uid from me)),
    'active_deal_stale', (select count(*) from deals0 where (eff_owner is null or eff_owner=(select uid from me)) and is_stale),
    'active_deal_at_risk', (select count(*) from deals0 where (eff_owner is null or eff_owner=(select uid from me)) and risk_score>=40),
    'touchpoint_due_total', (select count(*) from tc_mine),
    'pipeline_total', (select count(*) from q_mine),
    'todos', coalesce((select jsonb_agg(jsonb_build_object(
        'todo_id',id,'entity_id',entity_id,'entity_name',entity_name,'entity_type',entity_type,
        'action_type',action_type,'status',status,'title',title,'priority',priority,'due_date',due_date,
        'rank_score',rank_score,'last_touch_at',last_touch_at,'days_since_touch',days_since_touch,
        'channels',to_jsonb(channels),'touch_count',touch_count,'recent',recent) order by rank_score desc, due_date asc nulls last)
      from (select * from todos order by rank_score desc limit greatest(1,least(p_todo_limit,200))) z), '[]'::jsonb),
    'active_deals', coalesce((select jsonb_agg(jsonb_build_object(
        'deal_id',id,'entity_id',entity_id,'name',name,'stage',stage,'stage_rank',stage_rank,
        'amount',amount,'expected_close_date',expected_close_date,
        'days_to_close',case when expected_close_date is null then null else (expected_close_date - current_date) end,
        'days_past_close',days_past_close,'vertical',vertical,'unassigned',(eff_owner is null),
        'last_touch_at',last_touch_at,'last_touch',last_title,'last_channel',last_channel,
        'days_since_touch',days_since_touch,'stale',is_stale,'risk_score',risk_score,
        'reasons',(select jsonb_agg(r) from (
            select 'Past expected close ('||days_past_close||'d)' as r where days_past_close > 0
            union all select 'Late stage, quiet '||coalesce(days_since_touch::text,'—')||'d' where stage in ('non_refundable','loi_executed') and (last_touch_at is null or days_since_touch>7)
            union all select 'Listing quiet '||coalesce(days_since_touch::text,'—')||'d' where stage in ('listing_signed','off_market_listing') and (last_touch_at is null or days_since_touch>14)
            union all select 'No logged activity' where last_touch_at is null
            union all select 'Aged in early stage (>180d)' where opened_at is not null and (current_date-opened_at::date)>180 and stage in ('bov','identified')
          ) x))
        order by risk_score desc, stage_rank asc, expected_close_date asc nulls last)
      from (select * from deals0 where eff_owner is null or eff_owner=(select uid from me)
            order by risk_score desc, stage_rank asc, expected_close_date asc nulls last
            limit greatest(1,least(p_deal_limit,100))) z), '[]'::jsonb),
    'next_touchpoints', coalesce((select jsonb_agg(jsonb_build_object(
        'touch_id',id,'entity_id',entity_id,'contact_name',contact_name,'domain',domain,
        'priority_tier',priority_tier,'phase',phase,'next_touch_due',next_touch_due,'next_touch_type',next_touch_type,
        'notes',notes,'overdue_days',overdue_days,'total_deal_volume',total_deal_volume,'deals_transacted',deals_transacted,
        'unassigned',(eff_owner is null))
        order by tier_rank asc, coalesce(total_deal_volume,0) desc, coalesce(engagement_score,0) desc, overdue_days desc)
      from (select * from tc0 where eff_owner is null or eff_owner=(select uid from me)
            order by tier_rank asc, coalesce(total_deal_volume,0) desc, coalesce(engagement_score,0) desc, overdue_days desc
            limit greatest(1,least(p_touch_limit,100))) z), '[]'::jsonb),
    'pipeline', coalesce((select jsonb_agg(jsonb_build_object(
        'entity_id',entity_id,'name',name,'band',priority_band,'band_rank',lcc_band_rank(priority_band),
        'reason',reason,'days_overdue',days_overdue,'owner_role',effective_owner_role,
        'annual_rent',current_annual_rent_total,'value_rank',rank_annual_rent,'domain',effective_domain,
        'unassigned',(eff_owner is null))
        order by lcc_band_rank(priority_band), coalesce(days_overdue,0) desc, rank_annual_rent asc nulls last)
      from (select * from q_mine order by lcc_band_rank(priority_band), coalesce(days_overdue,0) desc,
                   rank_annual_rent asc nulls last limit greatest(1,least(p_pipeline_limit,60))) zz), '[]'::jsonb)
  );
$function$;
