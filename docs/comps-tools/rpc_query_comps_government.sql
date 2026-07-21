-- =====================================================================
-- rpc_query_comps  (GOVERNMENT project: scknotsqkcheojiaewwh)
-- Returns canonical comps from the gov canonical layer + Salesforce staging.
-- Read-only. Called by the LCC MCP server `query_comps` tool via PostgREST /rpc.
--
-- VALIDATED against live schema 2026-07-21. Key normalizations baked in:
--   * cap_rate: canonical gov = DECIMAL (0.085); sf_comp_staging = PERCENT (7.67)
--     -> staging cap divided by 100 so the contract is always decimal.
--   * sold_price = 0 on a "Sold" SF comp = confidential/undisclosed -> price nulled,
--     price_withheld=true, comp retained.
--   * property_type match is loose ILIKE over a caller-expanded synonym array
--     (tool expands "medical" -> Healthcare/Medical Office/MOB/... ; see tool code).
--   * Salesforce staging mixes ~192 Account rows into 662 -> filtered by comp_type IS NOT NULL.
--   * OM bytes live in sf_files / Supabase storage, NOT in Link_to_OM__c (which is literal
--     text like "Check Files in Reading Pane"); has_om is a presence flag here.
-- =====================================================================

create or replace function rpc_query_comps(
  p_comp_type       text    default 'sale',    -- 'sale' | 'lease' | 'both'
  p_property_types  text[]  default null,       -- CALLER-EXPANDED synonyms, loose-matched
  p_states          text[]  default null,
  p_metros          text[]  default null,
  p_date_from       date    default null,
  p_date_to         date    default null,
  p_sf_min          int     default null,
  p_sf_max          int     default null,
  p_government_only boolean  default false,
  p_include_sf      boolean  default true,      -- include Salesforce-staged comps
  p_include_onmkt   boolean  default false,     -- include on-market (else closed only)
  p_limit           int     default 200
) returns setof jsonb
language sql stable
as $$
  with unioned as (
    -- ================= (A) canonical CLOSED gov sales =================
    select jsonb_build_object(
      'comp_id','gov_db:'||s.sale_id,
      'source','government_db','vertical','government',
      'comp_type','sale','on_market',false,'provenance_tag',null,
      'property_type', p.building_type,
      'is_government', (s.government_type is not null),
      'gov_category', s.government_type,
      'tenant', s.agency, 'guarantor', s.guarantor,
      'address', s.address, 'city', s.city, 'state', s.state, 'zip', p.zip_code,
      'latitude', p.latitude, 'longitude', p.longitude,
      'building_sf', coalesce(s.rba, s.sf_leased), 'year_built', s.year_built,
      'sale_price', nullif(s.sold_price,0),
      'price_withheld', (s.sold_price = 0),
      'price_per_sf', s.sold_price_psf,
      'cap_rate', s.sold_cap_rate,                     -- already decimal
      'noi', s.noi, 'sale_date', s.sale_date, 'sale_conditions', s.sale_conditions,
      'rent_per_sf', s.gross_rent_psf, 'expense_type', s.expenses,
      'lease_term_years', s.total_term_years, 'lease_expiration', s.lease_expiration,
      'validation_status', null, 'confidence', 0.85,
      'source_sf_id', s.source_sf_id, 'data_source', s.data_source,
      'as_of_date', s.updated_at::date,
      'dedup_key', lower(regexp_replace(coalesce(s.normalized_address,s.address,''),'\s+','','g'))
                   ||'|'||coalesce(s.sale_date::text,''),
      'raw', to_jsonb(s)
    ) as comp,
    s.sale_date as sort_date
    from sales_transactions s
    left join properties p on p.property_id = s.property_id
    where s.transaction_state = 'live' and s.sold_price > 0
      and s.exclude_from_market_metrics is not true
      and p_comp_type in ('sale','both','lease')
      and (p_states is null or s.state = any(p_states))
      and (p_date_from is null or s.sale_date >= p_date_from)
      and (p_date_to   is null or s.sale_date <= p_date_to)
      and (p_sf_min is null or coalesce(s.rba,s.sf_leased) >= p_sf_min)
      and (p_sf_max is null or coalesce(s.rba,s.sf_leased) <= p_sf_max)
      and (p_government_only is false or s.government_type is not null)
      and (p_property_types is null or exists (
            select 1 from unnest(p_property_types) t
            where p.building_type ilike '%'||t||'%'))

    union all
    -- ================= (B) canonical ON-MARKET gov listings ==========
    select jsonb_build_object(
      'comp_id','gov_db_lst:'||al.listing_id,
      'source','government_db','vertical','government',
      'comp_type','sale','on_market',true,'provenance_tag',null,
      'property_type', p.building_type,
      'is_government', (p.government_type is not null),
      'gov_category', p.government_type,
      'tenant', al.tenant_agency, 'guarantor', null,
      'address', al.address, 'city', al.city, 'state', al.state, 'zip', p.zip_code,
      'latitude', p.latitude, 'longitude', p.longitude,
      'building_sf', al.square_feet, 'year_built', p.year_built,
      'list_price', al.asking_price, 'list_cap', al.asking_cap_rate,
      'price_per_sf', al.asking_price_psf, 'days_on_market', al.days_on_market,
      'rent_per_sf', nullif(al.annual_rent,0)/nullif(al.square_feet,0),
      'annual_rent', al.annual_rent, 'lease_expiration', al.lease_expiration,
      'confidence', 0.75, 'data_source', al.listing_source,
      'as_of_date', al.last_seen_at::date,
      'dedup_key', lower(regexp_replace(coalesce(al.normalized_address,al.address,''),'\s+','','g'))
                   ||'|listing',
      'raw', to_jsonb(al)
    ) as comp,
    al.listing_date as sort_date
    from available_listings al
    left join properties p on p.property_id = al.property_id
    where p_include_onmkt
      and al.is_active and al.off_market_date is null and al.sold_date is null
      and al.exclude_from_listing_metrics is not true
      and (p_states is null or al.state = any(p_states))
      and (p_government_only is false or p.government_type is not null)
      and (p_property_types is null or exists (
            select 1 from unnest(p_property_types) t
            where p.building_type ilike '%'||t||'%'))

    union all
    -- ================= (C) Salesforce-staged comps ==================
    select jsonb_build_object(
      'comp_id','gov_sf:'||st.sf_comp_id,
      'source','salesforce','vertical','government',
      'comp_type','sale',
      'on_market',(st.status is distinct from 'Sold'),
      'provenance_tag', st.comp_type,               -- External / Internal
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
      'term_remaining_at_sale', nullif(st.raw_row->>'Term_Remaining_At_Sale__c','')::numeric,
      'escalation', st.raw_row->>'Escalation__c',
      'sale_conditions', st.raw_row->>'Sale_Conditions__c',
      'validation_status', st.raw_row->>'Validation_Status__c',
      'has_om', (st.raw_row->>'Files_Formula__c') is not null,
      'confidence', case when st.raw_row->>'Validation_Status__c' = 'Validated' then 0.9 else 0.7 end,
      'source_sf_id', st.sf_comp_id, 'data_source','salesforce',
      'as_of_date', st.imported_at::date,
      'dedup_key', lower(regexp_replace(coalesce(st.normalized_address,st.street,''),'\s+','','g'))
                   ||'|'||coalesce(st.sold_date::text,''),
      'raw', st.raw_row
    ) as comp,
    st.sold_date as sort_date
    from sf_comp_staging st
    where p_include_sf
      and st.comp_type is not null                    -- drops the 192 Account rows
      and (st.status ilike 'sold' or p_include_onmkt)
      and (p_states is null or st.state = any(p_states))
      and (p_date_from is null or st.sold_date >= p_date_from)
      and (p_date_to   is null or st.sold_date <= p_date_to)
      and (p_sf_min is null or st.building_sf >= p_sf_min)
      and (p_sf_max is null or st.building_sf <= p_sf_max)
      and (p_government_only is false or (st.raw_row->>'Government__c')::boolean is true)
      and (p_property_types is null or exists (
            select 1 from unnest(p_property_types) t
            where st.property_type ilike '%'||t||'%' or st.primary_use ilike '%'||t||'%'))
  )
  select comp from unioned
  order by sort_date desc nulls last
  limit greatest(p_limit,1);
$$;

-- grant execute to the role the MCP server uses (service role bypasses; anon/authenticated if needed):
-- grant execute on function rpc_query_comps to authenticated, service_role;
