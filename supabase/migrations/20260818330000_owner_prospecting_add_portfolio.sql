-- Enhance lcc_owner_prospecting_status with the owner's PORTFOLIO (owner -> properties
-- via lcc_property_owner), incl. how many are our active deals. A data-backed owner->portfolio
-- connection for the Current Owner card.
--
-- Rep derivation intentionally OMITTED: reviewed and found un-derivable. Of 1,786 rep-less
-- cadence rows, 0 have a bd_opportunity_id, 0 have SF-owner metadata, 23 have an entity
-- override, and only 3 cadence-owners map to a deal point-person. The real gap is UPSTREAM --
-- cadence generation never stamps owner_user_id. Fix there (stamp the point-person / SF
-- activity owner at cadence create/advance), not via backfill. See property-tab-ux-review.md.
create or replace function public.lcc_owner_prospecting_status(p_owner_entity_id uuid)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  with c as (
    select * from public.touchpoint_cadence where entity_id = p_owner_entity_id
  ), agg as (
    select
      count(*)::int as cadence_rows,
      max(last_touch_at) as last_touch_at,
      (array_agg(last_touch_type order by last_touch_at desc nulls last))[1] as last_touch_type,
      min(next_touch_due) filter (where next_touch_due is not null) as next_touch_due,
      (array_agg(next_touch_type order by next_touch_due asc nulls last))[1] as next_touch_type,
      (array_agg(priority_tier order by (priority_tier='A') desc nulls last))[1] as tier,
      sum(coalesce(emails_sent,0))::int as emails_sent,
      sum(coalesce(emails_replied,0))::int as emails_replied,
      sum(coalesce(calls_connected,0))::int as calls_connected,
      sum(coalesce(meetings_scheduled,0))::int as meetings,
      bool_or(unsubscribe_status is not null and lower(unsubscribe_status) not in ('','subscribed','active','none')) as unsubscribed,
      (array_agg(owner_user_id order by last_touch_at desc nulls last) filter (where owner_user_id is not null))[1] as rep_user
    from c
  ), pf as (
    select
      count(*)::int as portfolio_count,
      count(*) filter (where exists (
        select 1 from public.bd_opportunities o where o.entity_id = po.entity_id and o.is_open = true))::int as our_open_deals
    from public.lcc_property_owner po where po.owner_entity_id = p_owner_entity_id
  )
  select (case when coalesce((select cadence_rows from agg),0) = 0
    then jsonb_build_object('status','none','prospecting',false)
    else jsonb_build_object(
      'status', case when (select unsubscribed from agg) then 'unsubscribed' else 'active' end,
      'prospecting', true,
      'rep', (select display_name from public.lcc_users where lcc_user_id = (select rep_user from agg)),
      'tier', (select tier from agg),
      'last_touch_at', (select last_touch_at from agg),
      'last_touch_type', (select last_touch_type from agg),
      'next_touch_due', (select next_touch_due from agg),
      'next_touch_type', (select next_touch_type from agg),
      'emails_sent', (select emails_sent from agg),
      'emails_replied', (select emails_replied from agg),
      'calls_connected', (select calls_connected from agg),
      'meetings', (select meetings from agg))
    end)
    || jsonb_build_object(
      'portfolio_count', (select portfolio_count from pf),
      'our_open_deals', (select our_open_deals from pf));
$function$;
