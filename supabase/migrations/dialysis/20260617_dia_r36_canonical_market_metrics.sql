-- R36 Phase 1: canonical market-metric layer (DIA)
--
-- IDENTICAL canonical expression to gov (CANONICAL_METRIC_DICTIONARY_2026-06-16),
-- with dia schema specifics:
--   * sold cap   = coalesce(cap_rate, calculated_cap_rate, stated_cap_rate)
--   * cap band drops cap_rate_quality = 'implausible_unverified'
--   * listing price = coalesce(last_price, initial_price)   (dia has no asking_price)
--
-- dia parity columns (additive, default-false; no backfill). They make M1
-- identically defined across both domains. DATA-POPULATION FOLLOW-UP (not a
-- definition gap): teach the dia sidebar listing-capture path to set
-- is_northmarq for Northmarq-broker listings and the curation flow to set
-- exclude_from_listing_metrics. Until then dia on_market_nm = 0 and
-- exclude_from_listing_metrics excludes nothing.
alter table public.available_listings
  add column if not exists is_northmarq boolean not null default false;
alter table public.available_listings
  add column if not exists exclude_from_listing_metrics boolean;

comment on column public.available_listings.is_northmarq is
  'R36 parity with gov. Default false; populated later by dia listing-capture for Northmarq-broker listings.';
comment on column public.available_listings.exclude_from_listing_metrics is
  'R36 parity with gov (nullable; IS NOT TRUE = included). Populated later by the dia curation flow.';

-- Verified live 2026-06-17: on_market_total=810 (nm 0), sold_ttm_count=167,
-- sold_ttm_volume=$0.718B, sold_ttm_nm_count=8 ($0.035B) -> non-NM 159, avg_cap_rate=0.0730.
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
           coalesce(s.cap_rate, s.calculated_cap_rate, s.stated_cap_rate)::numeric cr,
           coalesce(s.is_northmarq,false) nm,
           s.cap_rate_quality cq
    from sales_transactions s
    where s.sale_date >= current_date - p_days
      and s.sold_price is not null and s.sold_price > 100000
      and s.transaction_state = 'live'
      and s.exclude_from_market_metrics is not true
  ),
  caps as (
    select cr from sold
    where cr between 0.01 and 0.25
      and coalesce(cq,'') <> 'implausible_unverified'
  ),
  onmkt as (
    select coalesce(l.is_northmarq,false) nm,
           coalesce(l.last_price,l.initial_price)::numeric price
    from available_listings l
    where coalesce(l.is_active,false) = true
      and l.exclude_from_listing_metrics is not true
      and not exists (
        select 1 from sales_transactions s2
        where s2.property_id = l.property_id
          and s2.transaction_state = 'live'
          and s2.sale_date >= current_date - 60)
  )
  select
    p_days,
    (select count(*) from properties),
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
  'R36 canonical market metrics (DIA). M1 on-market + M2 sold-TTM per CANONICAL_METRIC_DICTIONARY_2026-06-16. Single source of truth for briefing/overview/dashboards.';

create or replace view public.v_market_metrics_dia as
  select * from public.lcc_market_metrics(365);

comment on view public.v_market_metrics_dia is
  'R36 canonical DIA market metrics at the 365-day window. Reads lcc_market_metrics(365).';
