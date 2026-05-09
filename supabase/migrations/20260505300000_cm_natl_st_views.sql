-- Capital Markets — National Single-Tenant views (Phase 2f)
--
-- Builds the cm_natl_st_*_q view family over public.cm_rca_quarterly.
-- The frontend dispatcher in api/capital-markets.js looks up
-- view_name_template in cm_chart_catalog (e.g. 'cm_{vertical}_volume_ttm_q')
-- and replaces {vertical} with 'natl_st' for this vertical.
--
-- All views expose a `subspecialty` column carrying the product axis
-- ('all' | 'office' | 'medical' | 'industrial' | 'retail') so the
-- existing PostgREST filter (`subspecialty=eq.<value>`) works without
-- vertical-specific code paths.
--
-- 'all' rows are computed as cross-product aggregates: sum(volume),
-- sum(count), sum(SF), and a volume-weighted cap rate.
--
-- Stub views (zero rows) are provided for charts that don't apply to
-- aggregate RCA data (top buyers / sellers / NM attribution / etc.) so
-- the catalog stays consistent and the frontend renders "No data" rather
-- than a 404.
--
-- Source data: public.cm_rca_quarterly  (PK: product_type, period_end)

------------------------------------------------------------
-- 1. Helper: per-quarter rows with 'all' aggregate folded in
------------------------------------------------------------
create or replace view public.cm_natl_st_rca_unioned as
  -- Per-product rows
  select
    product_type::text                                                   as subspecialty,
    period_end,
    ttm_volume_dollars,
    ttm_property_count,
    ttm_total_sf,
    ttm_cap_rate,
    ttm_top_quartile_cap,
    ttm_top_quartile_ppsf
  from public.cm_rca_quarterly
  union all
  -- Cross-product aggregate ('all')
  select
    'all'::text                                                          as subspecialty,
    period_end,
    sum(ttm_volume_dollars)                                              as ttm_volume_dollars,
    sum(ttm_property_count)                                              as ttm_property_count,
    sum(ttm_total_sf)                                                    as ttm_total_sf,
    -- Volume-weighted cap rate; null-safe
    case when sum(ttm_volume_dollars) > 0
         then sum(ttm_cap_rate * ttm_volume_dollars) / sum(ttm_volume_dollars)
         else null end                                                   as ttm_cap_rate,
    -- Top-quartile cap: simple average across products that report it
    avg(ttm_top_quartile_cap)                                            as ttm_top_quartile_cap,
    -- Top-quartile PPSF: simple average across products that report it
    -- (Industrial reports null and is excluded by avg's null-skip)
    avg(ttm_top_quartile_ppsf)                                           as ttm_top_quartile_ppsf
  from public.cm_rca_quarterly
  group by period_end;

comment on view public.cm_natl_st_rca_unioned is
  'Per-product + cross-product (subspecialty=all) RCA quarterly rows. '
  'Volume-weighted cap rate for ''all''; simple-avg quartile metrics.';

------------------------------------------------------------
-- 2. Sales volume — TTM by quarter (Phase 1)
--    Chart: volume_ttm_by_quarter / cm_{vertical}_volume_ttm_q
--    Shape mirrors cm_gov_volume_ttm_q: period_end, subspecialty,
--    volume_dollars, yoy_change_pct
------------------------------------------------------------
create or replace view public.cm_natl_st_volume_ttm_q as
  select
    period_end,
    subspecialty,
    ttm_volume_dollars                                                   as volume_dollars,
    case
      when lag(ttm_volume_dollars, 4) over w > 0
        then (ttm_volume_dollars - lag(ttm_volume_dollars, 4) over w)
             / lag(ttm_volume_dollars, 4) over w
      else null
    end                                                                  as yoy_change_pct
  from public.cm_natl_st_rca_unioned
  window w as (partition by subspecialty order by period_end);

------------------------------------------------------------
-- 3. Transaction count — TTM by quarter (Phase 1)
--    Chart: transaction_count_ttm / cm_{vertical}_count_ttm_q
------------------------------------------------------------
create or replace view public.cm_natl_st_count_ttm_q as
  select
    period_end,
    subspecialty,
    ttm_property_count                                                   as deal_count,
    case
      when lag(ttm_property_count, 4) over w > 0
        then (ttm_property_count - lag(ttm_property_count, 4) over w)::numeric
             / lag(ttm_property_count, 4) over w
      else null
    end                                                                  as yoy_change_pct
  from public.cm_natl_st_rca_unioned
  window w as (partition by subspecialty order by period_end);

------------------------------------------------------------
-- 4. Cap rate — TTM weighted avg by quarter (Phase 1)
--    Chart: cap_rate_ttm_by_quarter / cm_{vertical}_cap_ttm_q
------------------------------------------------------------
create or replace view public.cm_natl_st_cap_ttm_q as
  select
    period_end,
    subspecialty,
    ttm_cap_rate                                                         as cap_rate,
    -- TTM volume passes through for downstream weighting if the renderer
    -- wants it (gov view exposes volume too)
    ttm_volume_dollars                                                   as volume_dollars
  from public.cm_natl_st_rca_unioned;

------------------------------------------------------------
-- 5. Cap rate — top vs bottom quartile (Phase 1)
--    Chart: cap_rate_top_bottom_quartile / cm_{vertical}_cap_quartile_q
--    RCA only provides top quartile; bottom is null (renderer handles).
------------------------------------------------------------
create or replace view public.cm_natl_st_cap_quartile_q as
  select
    period_end,
    subspecialty,
    ttm_top_quartile_cap                                                 as top_quartile_cap,
    null::numeric                                                        as median_cap,
    null::numeric                                                        as bottom_quartile_cap
  from public.cm_natl_st_rca_unioned;

------------------------------------------------------------
-- 6. Average deal size — TTM by quarter (Phase 1)
--    Chart: avg_deal_size / cm_{vertical}_avg_deal_q
------------------------------------------------------------
create or replace view public.cm_natl_st_avg_deal_q as
  select
    period_end,
    subspecialty,
    case when ttm_property_count > 0
         then ttm_volume_dollars / ttm_property_count
         else null end                                                   as avg_deal_size
  from public.cm_natl_st_rca_unioned;

------------------------------------------------------------
-- 7. TTM Volume — YoY change (Phase 2 chart)
--    Chart: yoy_volume_change / cm_{vertical}_yoy_change_q
------------------------------------------------------------
create or replace view public.cm_natl_st_yoy_change_q as
  select
    period_end,
    subspecialty,
    case
      when lag(ttm_volume_dollars, 4) over w > 0
        then (ttm_volume_dollars - lag(ttm_volume_dollars, 4) over w)
             / lag(ttm_volume_dollars, 4) over w
      else null
    end                                                                  as yoy_change_pct,
    ttm_volume_dollars                                                   as volume_dollars
  from public.cm_natl_st_rca_unioned
  window w as (partition by subspecialty order by period_end);

------------------------------------------------------------
-- 8. Cap rate — YoY change (Phase 2 chart)
--    Chart: cap_rate_yoy_change / cm_{vertical}_cap_yoy_q
------------------------------------------------------------
create or replace view public.cm_natl_st_cap_yoy_q as
  select
    period_end,
    subspecialty,
    ttm_cap_rate                                                         as cap_rate,
    case
      when lag(ttm_cap_rate, 4) over w is not null
        then ttm_cap_rate - lag(ttm_cap_rate, 4) over w
      else null
    end                                                                  as yoy_change_bps,
    avg(ttm_cap_rate) over (
      partition by subspecialty
      order by period_end
      rows between 3 preceding and current row
    )                                                                    as moving_avg_4q
  from public.cm_natl_st_rca_unioned
  window w as (partition by subspecialty order by period_end);

------------------------------------------------------------
-- 9. Macro pass-through views — alias cm_macro_rates_q (LCC level)
--    Charts: fed_funds_vs_treasury, net_lease_spread, cost_of_capital
--    These views adopt the same 'all' subspecialty placeholder so they
--    fit the dispatch contract.
------------------------------------------------------------
create or replace view public.cm_natl_st_macro_rates_q as
  select
    period_end,
    'all'::text                                                          as subspecialty,
    fed_funds_rate_avg                                                   as fed_funds_rate,
    treasury_10y_yield
  from public.cm_macro_rates_q;

create or replace view public.cm_natl_st_net_lease_spread_q as
  with cap_all as (
    select period_end, ttm_cap_rate
    from public.cm_natl_st_rca_unioned
    where subspecialty = 'all'
  )
  select
    m.period_end,
    'all'::text                                                          as subspecialty,
    case when c.ttm_cap_rate is not null and m.treasury_10y_yield is not null
         then c.ttm_cap_rate - m.treasury_10y_yield
         else null end                                                   as net_lease_spread,
    c.ttm_cap_rate                                                       as cap_rate,
    m.treasury_10y_yield                                                 as treasury_10y_yield
  from public.cm_macro_rates_q m
  left join cap_all c using (period_end);

create or replace view public.cm_natl_st_cost_of_capital_q as
  select
    period_end,
    'all'::text                                                          as subspecialty,
    fed_funds_rate_avg                                                   as fed_funds_rate,
    treasury_10y_yield
  from public.cm_macro_rates_q;

------------------------------------------------------------
-- 10. Stub views — RCA aggregates don't carry transaction-level
--     buyer/seller/broker context. Empty views keep the catalog
--     consistent so frontend handles "No data" gracefully.
------------------------------------------------------------
create or replace view public.cm_natl_st_top_buyers as
  select
    null::date                                                           as period_end,
    'all'::text                                                          as subspecialty,
    null::text                                                           as buyer_name,
    null::numeric                                                        as volume_dollars,
    null::integer                                                        as deal_count,
    null::integer                                                        as rank
  where false;

create or replace view public.cm_natl_st_top_sellers as
  select
    null::date                                                           as period_end,
    'all'::text                                                          as subspecialty,
    null::text                                                           as seller_name,
    null::numeric                                                        as volume_dollars,
    null::integer                                                        as deal_count,
    null::integer                                                        as rank
  where false;

create or replace view public.cm_natl_st_buyer_share_y as
  select
    null::integer                                                        as year,
    'all'::text                                                          as subspecialty,
    null::text                                                           as buyer_class,
    null::numeric                                                        as share_pct,
    null::numeric                                                        as volume_dollars
  where false;

create or replace view public.cm_natl_st_nm_vs_market_q as
  select
    null::date                                                           as period_end,
    'all'::text                                                          as subspecialty,
    null::numeric                                                        as nm_cap_rate,
    null::numeric                                                        as market_cap_rate,
    null::integer                                                        as nm_deal_count,
    null::integer                                                        as market_deal_count
  where false;

create or replace view public.cm_natl_st_nm_share_y as
  select
    null::integer                                                        as year,
    'all'::text                                                          as subspecialty,
    null::numeric                                                        as nm_volume_dollars,
    null::numeric                                                        as market_volume_dollars,
    null::numeric                                                        as nm_share_pct
  where false;

create or replace view public.cm_natl_st_sources_capital as
  select
    null::text                                                           as state,
    'all'::text                                                          as subspecialty,
    null::numeric                                                        as volume_dollars,
    null::integer                                                        as deal_count,
    null::integer                                                        as rank
  where false;

-- Returns indexes (Phase 1 chart but needs total-return data we don't have here)
create or replace view public.cm_natl_st_returns_indexes_q as
  select
    null::date                                                           as period_end,
    'all'::text                                                          as subspecialty,
    null::numeric                                                        as cash_return_index,
    null::numeric                                                        as leveraged_return_index
  where false;

comment on view public.cm_natl_st_top_buyers is
  'Stub. RCA aggregate exports do not include buyer-level rows. '
  'Populated only when transaction-level NM internal data is folded in.';
comment on view public.cm_natl_st_top_sellers is 'Stub — see cm_natl_st_top_buyers comment.';
comment on view public.cm_natl_st_buyer_share_y is 'Stub — see cm_natl_st_top_buyers comment.';
comment on view public.cm_natl_st_nm_vs_market_q is 'Stub — see cm_natl_st_top_buyers comment.';
comment on view public.cm_natl_st_nm_share_y is 'Stub — see cm_natl_st_top_buyers comment.';
comment on view public.cm_natl_st_sources_capital is 'Stub — see cm_natl_st_top_buyers comment.';
comment on view public.cm_natl_st_returns_indexes_q is
  'Stub — total return indexes need RCA Composite/CPPI feed not in '
  'TrendTracker exports. Wire up when feed lands.';

------------------------------------------------------------
-- 11. Grants for anon read (matches gov / dialysis pattern)
------------------------------------------------------------
do $$
declare v_view text;
begin
  for v_view in
    select table_name
    from information_schema.views
    where table_schema = 'public'
      and table_name like 'cm_natl_st_%'
  loop
    execute format('grant select on public.%I to anon, authenticated, service_role', v_view);
  end loop;
end $$;
