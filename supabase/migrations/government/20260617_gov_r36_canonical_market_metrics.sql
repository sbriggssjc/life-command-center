-- R36 Phase 1: canonical market-metric layer (GOV)
--
-- ONE source of truth for the market metrics that were previously computed by
-- 3+ independent paths with divergent windows/filters (lcc_briefing_market_stats,
-- mv_gov_overview_stats, capital_markets_agg.py). Encodes M1 (on-market) + M2
-- (sold-TTM) exactly per CANONICAL_METRIC_DICTIONARY_2026-06-16.
--
--   M2 sold-TTM: sale_date within window, sold_price > 100000,
--                transaction_state = 'live', exclude_from_market_metrics IS NOT TRUE.
--                Northmarq is COUNTED in totals and ALSO exposed as a sub-cut.
--                avg/percentile cap over sold_cap_rate band 0.01-0.25.
--   M1 on-market: is_active, exclude_from_listing_metrics IS NOT TRUE, and NOT a
--                property with a 'live' sale in the last 60 days (sale-overlap).
--                Northmarq counted in totals + exposed as a sub-cut.
--
-- Verified live 2026-06-17: on_market_total=629 (nm 10), sold_ttm_count=61,
-- sold_ttm_volume=$0.871B, sold_ttm_nm_count=0, avg_cap_rate=0.0766.

create or replace function public.lcc_market_metrics(p_days int default 365)
returns table (
  window_days         int,
  total_properties    bigint,
  on_market_total     bigint,
  on_market_volume    numeric,
  on_market_nm        bigint,
  on_market_nm_volume numeric,
  sold_ttm_count      bigint,
  sold_ttm_volume     numeric,
  sold_ttm_nm_count   bigint,
  sold_ttm_nm_volume  numeric,
  avg_cap_rate        numeric,
  median_cap_rate     numeric,
  q1_cap_rate         numeric,
  q3_cap_rate         numeric
)
language sql stable as $$
  with sold as (
    select s.sold_price::numeric sp,
           s.sold_cap_rate::numeric cr,
           coalesce(s.is_northmarq,false) nm
    from public.sales_transactions s
    where s.sale_date >= current_date - p_days
      and s.sold_price is not null and s.sold_price > 100000
      and s.transaction_state = 'live'
      and s.exclude_from_market_metrics is not true
  ),
  caps as (select cr from sold where cr between 0.01 and 0.25),
  onmkt as (
    select coalesce(l.is_northmarq,false) nm,
           coalesce(l.asking_price,l.last_price,l.initial_price)::numeric price
    from public.available_listings l
    where coalesce(l.is_active,false) = true
      and l.exclude_from_listing_metrics is not true
      and not exists (
        select 1 from public.sales_transactions s2
        where s2.property_id = l.property_id
          and s2.transaction_state = 'live'
          and s2.sale_date >= current_date - 60)
  )
  select
    p_days,
    (select count(*) from public.properties),
    (select count(*) from onmkt),
    (select coalesce(sum(price),0) from onmkt where price is not null),
    (select count(*) from onmkt where nm),
    (select coalesce(sum(price) filter (where nm),0) from onmkt where price is not null),
    (select count(*) from sold),
    (select coalesce(sum(sp),0) from sold),
    (select count(*) from sold where nm),
    (select coalesce(sum(sp) filter (where nm),0) from sold),
    (select round(avg(cr),4) from caps),
    (select round((percentile_cont(0.5)  within group (order by cr))::numeric,4) from caps),
    (select round((percentile_cont(0.25) within group (order by cr))::numeric,4) from caps),
    (select round((percentile_cont(0.75) within group (order by cr))::numeric,4) from caps);
$$;

comment on function public.lcc_market_metrics(int) is
  'R36 canonical market metrics (GOV). M1 on-market + M2 sold-TTM per CANONICAL_METRIC_DICTIONARY_2026-06-16. Single source of truth for briefing/overview/dashboards.';

create or replace view public.v_market_metrics_gov as
  select * from public.lcc_market_metrics(365);

comment on view public.v_market_metrics_gov is
  'R36 canonical GOV market metrics at the 365-day window. Reads lcc_market_metrics(365).';
