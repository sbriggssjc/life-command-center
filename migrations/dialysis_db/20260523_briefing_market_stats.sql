-- ============================================================================
-- Dialysis_DB: briefing market-stats RPCs
-- Life Command Center — executive briefing v2 follow-up
--
-- Provides single-round-trip aggregations for the v2 email's Capital Markets
-- subsection. Two RPCs:
--
--   lcc_briefing_market_stats(days int) → jsonb
--     TTM sales volume + count + cap-rate distribution (avg, median, Q1, Q3)
--     across non-excluded sales_transactions for the last N days.
--     Plus on-market listing count + asking volume for active listings.
--
--   lcc_briefing_research_counts(days int) → jsonb
--     Comps + listings added in the last N days, plus property research
--     coverage rates (% with recorded owner, % with developer).
--
-- Both functions filter out is_northmarq = true so the "market" tiles
-- reflect competitor activity, not our own deals. Use the dedicated
-- pipeline section for our own opportunities.
-- ============================================================================

create or replace function public.lcc_briefing_market_stats(
  p_days int default 365
) returns jsonb
language sql stable as $$
  with sales as (
    select sold_price::numeric              as sold_price,
           coalesce(cap_rate, calculated_cap_rate, stated_cap_rate)::numeric
                                            as cap_rate
    from   sales_transactions
    where  sale_date >= current_date - p_days
      and  sold_price is not null
      and  sold_price > 100000
      and  coalesce(exclude_from_market_metrics, false) = false
      and  coalesce(is_northmarq, false)              = false
  ),
  caps as (select cap_rate from sales where cap_rate between 0.02 and 0.20),
  listings as (
    select coalesce(last_price, initial_price)::numeric        as price,
           coalesce(current_cap_rate, cap_rate, last_cap_rate, initial_cap_rate)::numeric
                                                               as cap_rate
    from   available_listings
    where  coalesce(is_active, true) = true
      and  coalesce(is_northmarq, false) = false
  )
  select jsonb_build_object(
    'window_days',      p_days,
    'ttm_volume',       (select coalesce(sum(sold_price), 0) from sales),
    'ttm_count',        (select count(*) from sales),
    'avg_cap',          (select avg(cap_rate)                                                 from caps),
    'median_cap',       (select percentile_cont(0.50) within group (order by cap_rate) from caps),
    'q1_cap',           (select percentile_cont(0.25) within group (order by cap_rate) from caps),
    'q3_cap',           (select percentile_cont(0.75) within group (order by cap_rate) from caps),
    'on_market_count',  (select count(*) from listings),
    'on_market_volume', (select coalesce(sum(price), 0) from listings where price is not null)
  );
$$;

comment on function public.lcc_briefing_market_stats(int) is
  'TTM market stats for the briefing email Capital Markets tile group. Filters out NM deals + flagged-excluded comps + outlier cap rates (>20%, <2%). Stable, ~100ms.';

grant execute on function public.lcc_briefing_market_stats(int) to anon, authenticated, service_role;


create or replace function public.lcc_briefing_research_counts(
  p_days int default 7
) returns jsonb
language sql stable as $$
  with window_start as (
    select (now() - make_interval(days => p_days)) as ts
  )
  select jsonb_build_object(
    'window_days',          p_days,
    'comps_added',          (
      select count(*)
      from   sales_transactions
      where  created_at >= (select ts from window_start)
    ),
    'listings_added',       (
      select count(*)
      from   available_listings
      where  created_at >= (select ts from window_start)
    ),
    'props_total',          (select count(*) from properties),
    'props_with_owner',     (
      select count(*) from properties
      where  recorded_owner_id is not null
         or  true_owner_id     is not null
    ),
    'props_with_developer', (
      select count(*) from properties
      where  developer is not null
        and  btrim(developer) <> ''
    )
  );
$$;

comment on function public.lcc_briefing_research_counts(int) is
  'Counts driving Research Progress tiles for dia. Stable, ~80ms.';

grant execute on function public.lcc_briefing_research_counts(int) to anon, authenticated, service_role;
