-- R36 Phase 2: repoint mv_gov_overview_stats onto the canonical market layer.
--
-- The MV's on-market + sold-TTM columns diverged from the briefing/CM paths:
--   active_listings   = count(*) of ALL available_listings rows (3,049 — unfiltered)
--   sales_ttm_count   = count(*) sale_date>=12mo (1,300 — no live/$100k/exclude filters)
--   sales_ttm_volume  = $1.70B on the same loose set
-- Now they read from public.lcc_market_metrics(365) (the R36 canon), so the
-- dashboard, the briefing email, and v_market_metrics_gov agree on M1/M2.
--
-- Postgres has no CREATE OR REPLACE MATERIALIZED VIEW, so this DROPs + CREATEs.
-- All non-market columns are reproduced verbatim from the live definition; only
-- listing_stats (asking averages now over the canonical on-market set),
-- the active_listings / sales_ttm_* columns (sourced from the canon), and a set
-- of appended mkt_* canonical columns change. Unique index recreated for the
-- daily CONCURRENTLY refresh (R15 Unit 2). Grants restored.

drop materialized view if exists public.mv_gov_overview_stats;

create materialized view public.mv_gov_overview_stats as
 with prop_stats as (
         select count(*) as total_properties,
            count(*) filter (where properties.sf_leased > 0) as properties_with_sf,
            coalesce(sum(properties.sf_leased) filter (where properties.sf_leased > 0), 0::bigint) as total_sf,
            coalesce(sum(properties.gross_rent), 0::numeric) as total_gross_rent,
            count(*) filter (where properties.gross_rent_psf > 0::numeric) as properties_with_rent_psf,
                case
                    when count(*) filter (where properties.gross_rent_psf > 0::numeric) > 0 then round(avg(properties.gross_rent_psf) filter (where properties.gross_rent_psf > 0::numeric), 2)
                    else 0::numeric
                end as avg_rent_psf,
            count(distinct properties.agency) filter (where properties.agency is not null and properties.agency !~* 'SERVICES DIVISION$'::text) as agencies_tracked,
            coalesce(sum(properties.noi), 0::numeric) as total_noi,
            count(*) filter (where properties.firm_term_remaining is not null) as properties_with_term,
            count(*) filter (where properties.firm_term_remaining <= 1::numeric) as expiring_lt_1yr,
            count(*) filter (where properties.firm_term_remaining <= 2::numeric) as expiring_lt_2yr,
            count(*) filter (where properties.firm_term_remaining > 2::numeric and properties.firm_term_remaining <= 5::numeric) as term_2_5yr,
            count(*) filter (where properties.firm_term_remaining > 5::numeric) as term_5plus,
                case
                    when count(*) filter (where properties.firm_term_remaining is not null) > 0 then round(avg(properties.firm_term_remaining) filter (where properties.firm_term_remaining is not null), 1)
                    else 0::numeric
                end as avg_firm_term,
            count(*) filter (where properties.lease_expiration is not null) as properties_with_lease_exp,
            count(*) filter (where properties.lease_expiration < current_date) as lease_expired_count,
            count(*) filter (where properties.lease_expiration < (current_date - '1 year'::interval)) as lease_expired_stale,
            count(*) filter (where properties.lease_expiration >= current_date and properties.lease_expiration < (current_date + '6 mons'::interval)) as exp_lease_lt_6mo,
            count(*) filter (where properties.lease_expiration >= current_date and properties.lease_expiration < (current_date + '1 year'::interval)) as exp_lease_lt_1yr,
            count(*) filter (where properties.lease_expiration >= (current_date + '1 year'::interval) and properties.lease_expiration < (current_date + '2 years'::interval)) as exp_lease_1_2yr,
            count(*) filter (where properties.lease_expiration >= (current_date + '2 years'::interval) and properties.lease_expiration < (current_date + '5 years'::interval)) as exp_lease_2_5yr,
            count(*) filter (where properties.lease_expiration >= (current_date + '5 years'::interval)) as exp_lease_5plus
           from public.properties properties
          where coalesce(properties.status, 'active'::text) <> 'archived'::text
        ), lease_buckets as (
         select jsonb_build_array(jsonb_build_object('label', 'Expired / < 0 yrs', 'count', count(*) filter (where properties.firm_term_remaining < 0::numeric), 'color', '#ef4444'), jsonb_build_object('label', '0 – 1 years', 'count', count(*) filter (where properties.firm_term_remaining >= 0::numeric and properties.firm_term_remaining <= 1::numeric), 'color', '#f87171'), jsonb_build_object('label', '1 – 2 years', 'count', count(*) filter (where properties.firm_term_remaining > 1::numeric and properties.firm_term_remaining <= 2::numeric), 'color', '#fb923c'), jsonb_build_object('label', '2 – 3 years', 'count', count(*) filter (where properties.firm_term_remaining > 2::numeric and properties.firm_term_remaining <= 3::numeric), 'color', '#fbbf24'), jsonb_build_object('label', '3 – 5 years', 'count', count(*) filter (where properties.firm_term_remaining > 3::numeric and properties.firm_term_remaining <= 5::numeric), 'color', '#34d399'), jsonb_build_object('label', '5 – 10 years', 'count', count(*) filter (where properties.firm_term_remaining > 5::numeric and properties.firm_term_remaining <= 10::numeric), 'color', '#22d3ee'), jsonb_build_object('label', '10+ years', 'count', count(*) filter (where properties.firm_term_remaining > 10::numeric), 'color', '#60a5fa')) as lease_distribution
           from public.properties properties
          where properties.firm_term_remaining is not null and coalesce(properties.status, 'active'::text) <> 'archived'::text
        ), lease_exp_buckets as (
         select jsonb_build_array(jsonb_build_object('label', 'Expired / holdover', 'count', count(*) filter (where properties.lease_expiration < current_date), 'color', '#ef4444'), jsonb_build_object('label', '< 6 months', 'count', count(*) filter (where properties.lease_expiration >= current_date and properties.lease_expiration < (current_date + '6 mons'::interval)), 'color', '#f87171'), jsonb_build_object('label', '6 – 12 months', 'count', count(*) filter (where properties.lease_expiration >= (current_date + '6 mons'::interval) and properties.lease_expiration < (current_date + '1 year'::interval)), 'color', '#fb923c'), jsonb_build_object('label', '1 – 2 years', 'count', count(*) filter (where properties.lease_expiration >= (current_date + '1 year'::interval) and properties.lease_expiration < (current_date + '2 years'::interval)), 'color', '#fbbf24'), jsonb_build_object('label', '2 – 5 years', 'count', count(*) filter (where properties.lease_expiration >= (current_date + '2 years'::interval) and properties.lease_expiration < (current_date + '5 years'::interval)), 'color', '#34d399'), jsonb_build_object('label', '5+ years', 'count', count(*) filter (where properties.lease_expiration >= (current_date + '5 years'::interval)), 'color', '#60a5fa')) as lease_distribution_by_expiry
           from public.properties properties
          where properties.lease_expiration is not null and coalesce(properties.status, 'active'::text) <> 'archived'::text
        ), agency_agg as (
         select properties.agency as name,
            count(*) as cnt,
            coalesce(sum(properties.gross_rent), 0::numeric) as rent,
            coalesce(sum(properties.sf_leased), 0::bigint) as sf,
            coalesce(sum(properties.firm_term_remaining) filter (where properties.firm_term_remaining is not null), 0::numeric) as term_sum,
            count(*) filter (where properties.firm_term_remaining is not null) as term_count
           from public.properties properties
          where properties.agency is not null and properties.agency !~* 'SERVICES DIVISION$'::text and coalesce(properties.status, 'active'::text) <> 'archived'::text
          group by properties.agency
        ), top_agencies_by_count as (
         select jsonb_agg(jsonb_build_object('name', t.name, 'count', t.cnt, 'rent', t.rent, 'sf', t.sf, 'termSum', t.term_sum, 'termCount', t.term_count) order by t.cnt desc) as j
           from ( select agency_agg.name, agency_agg.cnt, agency_agg.rent, agency_agg.sf, agency_agg.term_sum, agency_agg.term_count
                   from agency_agg order by agency_agg.cnt desc limit 12) t
        ), top_agencies_by_rent as (
         select jsonb_agg(jsonb_build_object('name', t.name, 'count', t.cnt, 'rent', t.rent) order by t.rent desc) as j
           from ( select agency_agg.name, agency_agg.cnt, agency_agg.rent, agency_agg.sf, agency_agg.term_sum, agency_agg.term_count
                   from agency_agg order by agency_agg.rent desc limit 10) t
        ), state_agg as (
         select properties.state as name,
            count(*) as cnt,
            coalesce(sum(properties.gross_rent), 0::numeric) as rent,
            coalesce(sum(properties.sf_leased), 0::bigint) as sf
           from public.properties properties
          where properties.state is not null and coalesce(properties.status, 'active'::text) <> 'archived'::text
          group by properties.state
        ), top_states_by_count as (
         select jsonb_agg(jsonb_build_object('name', t.name, 'count', t.cnt, 'rent', t.rent, 'sf', t.sf) order by t.cnt desc) as j
           from ( select state_agg.name, state_agg.cnt, state_agg.rent, state_agg.sf
                   from state_agg order by state_agg.cnt desc limit 10) t
        ), top_states_by_rent as (
         select jsonb_agg(jsonb_build_object('name', t.name, 'rent', t.rent) order by t.rent desc) as j
           from ( select state_agg.name, state_agg.cnt, state_agg.rent, state_agg.sf
                   from state_agg order by state_agg.rent desc limit 10) t
        ), contact_stats as (
         select count(*) as total_contacts from public.contacts
        ), listing_stats as (
         -- R36: asking averages over the CANONICAL on-market set (M1), so they
         -- agree with the active_listings count now sourced from the canon.
         select round(avg(l.asking_cap_rate), 4) as avg_asking_cap,
            round(avg(l.asking_price), 2) as avg_asking_price
           from public.available_listings l
          where coalesce(l.is_active, false) = true
            and l.exclude_from_listing_metrics is not true
            and not exists (select 1 from public.sales_transactions s2
                            where s2.property_id = l.property_id
                              and s2.transaction_state = 'live'
                              and s2.sale_date >= current_date - 60)
        ), ownership_stats as (
         select count(*) as total_changes,
            count(*) filter (where ownership_history.sale_price > 0::numeric) as with_sale_price,
            coalesce(sum(ownership_history.sale_price) filter (where ownership_history.sale_price > 0::numeric), 0::numeric) as confirmed_value,
            count(*) filter (where ownership_history.research_status is null or ownership_history.research_status = 'pending'::text) as needs_research
           from public.ownership_history ownership_history
        ), loan_stats as (
         select count(*) as total_loans from public.loans
        ), sale_stats as (
         -- R36: TTM count/volume removed from here (now from the canon). All-time
         -- aggregates retained unchanged (a distinct metric from sold-TTM).
         select count(*) as total_sales,
            round(avg(sales_transactions.sold_cap_rate) filter (where sales_transactions.sold_cap_rate > 0.01 and sales_transactions.sold_cap_rate < 0.25), 4) as avg_sold_cap_rate,
            count(*) filter (where sales_transactions.sold_cap_rate > 0.01 and sales_transactions.sold_cap_rate < 0.25) as sales_with_cap,
            count(*) filter (where sales_transactions.sold_price > 0::numeric) as sales_priced_count,
            coalesce(sum(sales_transactions.sold_price) filter (where sales_transactions.sold_price > 0::numeric), 0::numeric) as sales_total_volume,
            round(avg(sales_transactions.sold_price) filter (where sales_transactions.sold_price > 0::numeric)) as sales_avg_price
           from public.sales_transactions sales_transactions
        ), mkt as (
         select * from public.lcc_market_metrics(365)
        ), lead_stats as (
         select count(*) as total_leads,
            count(*) filter (where prospect_leads.lead_temperature = 'hot'::text) as hot_leads,
            count(*) filter (where prospect_leads.lead_temperature = 'warm'::text) as warm_leads,
            count(*) filter (where prospect_leads.lead_temperature = 'cold'::text) as cold_leads,
            count(*) filter (where prospect_leads.estimated_value > 0::numeric) as leads_with_value,
            coalesce(sum(prospect_leads.estimated_value) filter (where prospect_leads.estimated_value > 0::numeric), 0::numeric) as pipeline_value_total,
            round(avg(prospect_leads.estimated_value) filter (where prospect_leads.estimated_value > 0::numeric)) as avg_lead_value
           from public.prospect_leads prospect_leads
        ), gsa_stats as (
         select ( select count(*) as count from public.gsa_lease_events) as gsa_events_total,
            ( select count(*) as count from gsa_lease_events where gsa_lease_events.event_date >= date_trunc('year'::text, current_date::timestamp with time zone)) as gsa_events_ytd,
            ( select count(*) as count from public.gsa_leases) as gsa_leases_tracked,
            ( select coalesce(sum(gsa_leases.annual_rent) filter (where gsa_leases.annual_rent > 0::numeric), 0::numeric) as "coalesce" from public.gsa_leases) as gsa_current_annual_rent
        ), frpp_stats as (
         select count(*) as frpp_total,
            coalesce(sum(frpp_records.square_feet), 0::numeric)::bigint as frpp_total_sf,
            coalesce(sum(frpp_records.annual_rent_to_lessor), 0::numeric) as frpp_total_rent,
            count(distinct frpp_records.using_agency) as frpp_distinct_agencies
           from public.frpp_records frpp_records
        )
 select p.total_properties,
    p.properties_with_sf,
    p.total_sf,
    p.total_gross_rent,
    p.properties_with_rent_psf,
    p.avg_rent_psf,
    p.agencies_tracked,
    p.total_noi,
    p.properties_with_term,
    p.expiring_lt_1yr,
    p.expiring_lt_2yr,
    p.term_2_5yr,
    p.term_5plus,
    p.avg_firm_term,
    p.properties_with_lease_exp,
    p.lease_expired_count,
    p.lease_expired_stale,
    p.exp_lease_lt_6mo,
    p.exp_lease_lt_1yr,
    p.exp_lease_1_2yr,
    p.exp_lease_2_5yr,
    p.exp_lease_5plus,
    leb.lease_distribution_by_expiry,
    lb.lease_distribution,
    ( select top_agencies_by_count.j from top_agencies_by_count) as top_agencies_by_count,
    ( select top_agencies_by_rent.j from top_agencies_by_rent) as top_agencies_by_rent,
    ( select top_states_by_count.j from top_states_by_count) as top_states_by_count,
    ( select top_states_by_rent.j from top_states_by_rent) as top_states_by_rent,
    c.total_contacts,
    mkt.on_market_total as active_listings,         -- R36: canonical M1
    li.avg_asking_cap,
    li.avg_asking_price,
    o.total_changes,
    o.with_sale_price,
    o.confirmed_value,
    o.needs_research,
    ln.total_loans,
    s.total_sales,
    s.avg_sold_cap_rate,
    s.sales_with_cap,
    s.sales_priced_count,
    s.sales_total_volume,
    s.sales_avg_price,
    mkt.sold_ttm_count as sales_ttm_count,          -- R36: canonical M2
    mkt.sold_ttm_volume as sales_ttm_volume,        -- R36: canonical M2
    ld.total_leads,
    ld.hot_leads,
    ld.warm_leads,
    ld.cold_leads,
    ld.leads_with_value,
    ld.pipeline_value_total,
    ld.avg_lead_value,
    g.gsa_events_total,
    g.gsa_events_ytd,
    g.gsa_leases_tracked,
    g.gsa_current_annual_rent,
    f.frpp_total,
    f.frpp_total_sf,
    f.frpp_total_rent,
    f.frpp_distinct_agencies,
    -- R36 appended canonical columns (single source for any new consumer)
    mkt.on_market_nm        as mkt_on_market_nm,
    mkt.on_market_volume    as mkt_on_market_volume,
    mkt.sold_ttm_nm_count   as mkt_sold_ttm_nm_count,
    mkt.sold_ttm_nm_volume  as mkt_sold_ttm_nm_volume,
    mkt.avg_cap_rate        as mkt_avg_cap_rate,
    mkt.median_cap_rate     as mkt_median_cap_rate,
    mkt.q1_cap_rate         as mkt_q1_cap_rate,
    mkt.q3_cap_rate         as mkt_q3_cap_rate,
    now() as computed_at
   from prop_stats p,
    lease_buckets lb,
    lease_exp_buckets leb,
    contact_stats c,
    listing_stats li,
    ownership_stats o,
    loan_stats ln,
    sale_stats s,
    mkt,
    lead_stats ld,
    gsa_stats g,
    frpp_stats f;

create unique index mv_gov_overview_stats_computed_at_uidx
  on public.mv_gov_overview_stats using btree (computed_at);

grant select on public.mv_gov_overview_stats to anon, authenticated, service_role;
