-- =====================================================================
-- rpc_query_comps  (DIALYSIS project: zqzrriwuavgrquhisnoa)
-- Mirror of the government RPC with the dialysis column map.
-- VALIDATED against live schema 2026-07-21.
--
-- Dialysis differences vs government:
--   * sales_transactions is thin: no address/agency/noi/rba on it -> address, property_type,
--     building_sf (building_size), lat/lng all come from the properties JOIN.
--   * cap lives in cap_rate_final (fallback cap_rate); both DECIMAL (avg 0.068).
--   * not a government vertical -> is_government=false, gov_category=null on canonical rows.
--   * available_listings has no days_on_market column.
--   * Salesforce block (C) is IDENTICAL to the gov RPC (same sf_comp_staging shape); 340 rows here.
-- =====================================================================

create or replace function rpc_query_comps(
  p_comp_type       text    default 'sale',
  p_property_types  text[]  default null,       -- caller-expanded synonyms
  p_states          text[]  default null,
  p_metros          text[]  default null,
  p_date_from       date    default null,
  p_date_to         date    default null,
  p_sf_min          int     default null,
  p_sf_max          int     default null,
  p_government_only boolean  default false,
  p_include_sf      boolean  default true,
  p_include_onmkt   boolean  default false,
  p_limit           int     default 200
) returns setof jsonb
language sql stable
as $$
  with unioned as (
    -- ================= (A) canonical CLOSED dialysis sales ===========
    select jsonb_build_object(
      'comp_id','dia_db:'||s.sale_id,
      'source','dialysis_db','vertical','dialysis',
      'comp_type','sale','on_market',false,'provenance_tag',null,
      'property_type', coalesce(p.property_type, p.building_type),
      'property_subtype', p.building_type,
      'is_government', false, 'gov_category', null,
      'tenant', coalesce(p.tenant, p.operator), 'guarantor', null,
      'address', p.address, 'city', p.city, 'state', p.state, 'zip', p.zip_code,
      'latitude', p.latitude, 'longitude', p.longitude,
      'building_sf', p.building_size, 'year_built', p.year_built,
      'year_renovated', p.year_renovated,
      'sale_price', nullif(s.sold_price,0), 'price_withheld', (s.sold_price = 0),
      'price_per_sf', round((nullif(s.sold_price,0)/nullif(p.building_size,0))::numeric,2),
      'cap_rate', coalesce(s.cap_rate_final, s.cap_rate),      -- decimal
      'noi', null, 'sale_date', s.sale_date,
      'rent_per_sf', null, 'occupancy', p.occupancy_percent,
      'validation_status', null, 'confidence', 0.85,
      'source_sf_id', null, 'data_source', s.data_source,
      'as_of_date', s.updated_at::date,
      'dedup_key', lower(regexp_replace(coalesce(p.address,'')||coalesce(p.city,'')||coalesce(p.state,''),'\s+','','g'))
                   ||'|'||coalesce(s.sale_date::text,''),
      'raw', to_jsonb(s)
    ) as comp,
    s.sale_date as sort_date
    from sales_transactions s
    left join properties p on p.property_id = s.property_id
    where s.transaction_state = 'live' and s.sold_price > 0
      and s.exclude_from_market_metrics is not true
      and p_comp_type in ('sale','both','lease')
      and (p_states is null or p.state = any(p_states))
      and (p_date_from is null or s.sale_date >= p_date_from)
      and (p_date_to   is null or s.sale_date <= p_date_to)
      and (p_sf_min is null or p.building_size >= p_sf_min)
      and (p_sf_max is null or p.building_size <= p_sf_max)
      and (p_property_types is null or exists (
            select 1 from unnest(p_property_types) t
            where p.property_type ilike '%'||t||'%' or p.building_type ilike '%'||t||'%'))

    union all
    -- ================= (B) canonical ON-MARKET dialysis listings =====
    select jsonb_build_object(
      'comp_id','dia_db_lst:'||al.listing_id,
      'source','dialysis_db','vertical','dialysis',
      'comp_type','sale','on_market',true,'provenance_tag',null,
      'property_type', coalesce(p.property_type, p.building_type),
      'is_government', false, 'gov_category', null,
      'tenant', coalesce(p.tenant, p.operator), 'guarantor', null,
      'address', p.address, 'city', p.city, 'state', p.state, 'zip', p.zip_code,
      'latitude', p.latitude, 'longitude', p.longitude,
      'building_sf', p.building_size, 'year_built', p.year_built,
      'list_price', coalesce(al.last_price, al.initial_price),
      'list_cap', coalesce(al.current_cap_rate, al.cap_rate),
      'price_per_sf', al.price_per_sf,
      'confidence', 0.75, 'data_source', al.data_source,
      'as_of_date', al.last_seen::date,
      'dedup_key', lower(regexp_replace(coalesce(p.address,'')||coalesce(p.city,'')||coalesce(p.state,''),'\s+','','g'))
                   ||'|listing',
      'raw', to_jsonb(al)
    ) as comp,
    al.listing_date as sort_date
    from available_listings al
    left join properties p on p.property_id = al.property_id
    where p_include_onmkt
      and al.is_active and al.off_market_date is null and al.sold_date is null
      and (p_states is null or p.state = any(p_states))
      and (p_property_types is null or exists (
            select 1 from unnest(p_property_types) t
            where p.property_type ilike '%'||t||'%' or p.building_type ilike '%'||t||'%'))

    union all
    -- ================= (C) Salesforce-staged comps (identical to gov) =
    select jsonb_build_object(
      'comp_id','dia_sf:'||st.sf_comp_id,
      'source','salesforce','vertical','dialysis',
      'comp_type','sale',
      'on_market',(st.status is distinct from 'Sold'),
      'provenance_tag', st.comp_type,
      'property_type', st.property_type, 'property_subtype', st.primary_use,
      'is_government', coalesce((st.raw_row->>'Government__c')::boolean,false),
      'gov_category', st.raw_row->>'Gov_Category__c',
      'tenant', st.tenant, 'guarantor', st.raw_row->>'Guarantor__c',
      'address', st.street, 'city', st.city, 'state', st.state, 'zip', st.zip_code,
      'metro', st.raw_row->>'Metro_Name__c',
      'building_sf', st.building_sf, 'land_acres', st.land_acres,
      'year_built', st.year_built, 'year_renovated', st.year_renovated,
      'sale_price', case when st.status ilike 'sold' then nullif(st.sold_price,0) end,
      'price_withheld', (st.status ilike 'sold' and coalesce(st.sold_price,0)=0),
      'price_per_sf', nullif(st.price_sf,0),
      'cap_rate', round((nullif(st.cap_rate,0)/100.0)::numeric,4),   -- % -> decimal
      'noi', nullif(st.raw_row->>'NOI__c','')::numeric,
      'sale_date', st.sold_date,
      'list_price', st.listing_price, 'list_cap', nullif(st.raw_row->>'List_Cap__c','')::numeric,
      'days_on_market', st.days_on_market,
      'annual_rent', st.annual_rent, 'rent_per_sf', nullif(st.raw_row->>'Rent_SF__c','')::numeric,
      'expense_type', st.raw_row->>'Expenses__c',
      'lease_term_years', st.lease_term_years, 'lease_expiration', st.lease_expiration,
      'validation_status', st.raw_row->>'Validation_Status__c',
      'has_om', (st.raw_row->>'Files_Formula__c') is not null,
      'confidence', case when st.raw_row->>'Validation_Status__c' = 'Validated' then 0.9 else 0.7 end,
      'source_sf_id', st.sf_comp_id, 'data_source','salesforce',
      'as_of_date', st.imported_at::date,
      'dedup_key', lower(regexp_replace(coalesce(st.street,'')||coalesce(st.city,'')||coalesce(st.state,''),'\s+','','g'))
                   ||'|'||coalesce(st.sold_date::text,''),
      'raw', st.raw_row
    ) as comp,
    st.sold_date as sort_date
    from sf_comp_staging st
    where p_include_sf
      and st.comp_type is not null
      and (st.status ilike 'sold' or p_include_onmkt)
      and (p_states is null or st.state = any(p_states))
      and (p_date_from is null or st.sold_date >= p_date_from)
      and (p_date_to   is null or st.sold_date <= p_date_to)
      and (p_sf_min is null or st.building_sf >= p_sf_min)
      and (p_sf_max is null or st.building_sf <= p_sf_max)
      and (p_property_types is null or exists (
            select 1 from unnest(p_property_types) t
            where st.property_type ilike '%'||t||'%' or st.primary_use ilike '%'||t||'%'))
  )
  select comp from unioned
  order by sort_date desc nulls last
  limit greatest(p_limit,1);
$$;
-- NOTE: dedup_key here uses address+city+state (consistent form). The MCP tool ALSO recomputes a
-- normalized key across verticals before merging, because canonical vs SF address normalization differ.
