-- ID2b-caps-2 -- closes the gap ID2b-caps left open: sf_comp_staging (Team
-- Briggs' own Salesforce-staged closed comps) has no `properties` join, so
-- ID2b-caps could only ever emit explicit NULLs for that arm's
-- operator_id/operator_canonical. Live re-check by Cowork against deployed
-- build `c5fc261f` found the dry-run tick emitting FIVE per-operator TTM
-- cap-rate bands where there should be THREE: 196 sf_comp_staging rows
-- spelled `DaVita Dialysis` and 179 spelled `Fresenius Medical Care` --
-- exact matches of aliases already registered to operator_id 4 and 5 -- were
-- minting a SECOND, text-keyed band under the identical canonical label the
-- id-keyed band already carries. Docs:
-- docs/audits/ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md addendum.
--
-- Fix, at the source of record (see
-- 20260912140000_dia_id2bcaps2_sf_comp_staging_operator_id.sql): the SF arm
-- now resolves `operator_id`/`operator_canonical` from
-- `sf_comp_staging.operator_id` (the new first-class column that migration
-- adds), survivor-resolved through `dia_operator_survivor`, IDENTICALLY to
-- how the sale/listing arms resolve `properties.operator_id`. NULL only
-- when the tenant text has genuinely never resolved through the shared
-- `dia_resolve_operator` (open rows in `dia_operator_write_review` where
-- `table_name='sf_comp_staging'`) -- never guessed, never a second resolver.
--
-- Every OTHER key on every arm, including the sale/listing arms'
-- operator_id/operator_canonical, is byte-identical to the ID2b-caps
-- definition -- the only diff from that migration's body is the SF arm's
-- tail `jsonb_build_object(...)` (NULL literals -> a resolved lateral join)
-- plus this header/footer comment. Comp SELECTION/scoring
-- (mcp/comps-tools.js::operatorTier/compTenantText), the `tenant` text
-- field, and every guard/alias-table/registry write path remain untouched.
--
-- Deliberately touches ONLY the 13-arg overload (the one with p_tenant) --
-- market-brief-psql-tick.js and mcp/comps-tools.js both always pass p_tenant
-- explicitly (verified 2026-09-11/12), so that is the only signature either
-- caller can ever resolve to; the 12-arg overload is untouched.

CREATE OR REPLACE FUNCTION public.rpc_query_comps(p_comp_type text DEFAULT 'sale'::text, p_property_types text[] DEFAULT NULL::text[], p_states text[] DEFAULT NULL::text[], p_metros text[] DEFAULT NULL::text[], p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_sf_min integer DEFAULT NULL::integer, p_sf_max integer DEFAULT NULL::integer, p_government_only boolean DEFAULT false, p_include_sf boolean DEFAULT true, p_include_onmkt boolean DEFAULT false, p_limit integer DEFAULT 200, p_tenant text DEFAULT NULL::text)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '10s'
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  with cand as (
    select 'sale'::text as arm, s.sale_id as id_main, null::bigint as id_stg, s.sale_date as sort_date
    from sales_transactions s
    left join properties p on p.property_id = s.property_id
    where s.transaction_state = 'live' and s.sold_price > 0 and s.exclude_from_market_metrics is not true and (p_government_only is false)
      and p_comp_type in ('sale','both','lease') and (p_states is null or p.state = any(p_states))
      and (p_date_from is null or s.sale_date >= p_date_from) and (p_date_to is null or s.sale_date <= p_date_to)
      and (p_sf_min is null or p.building_size >= p_sf_min) and (p_sf_max is null or p.building_size <= p_sf_max)
      and (p_tenant is null or replace(lower(coalesce(p.chain_canonical,'')||' '||coalesce(p.tenant,'')||' '||coalesce(p.operator,'')),'.','') ilike '%'||replace(lower(p_tenant),'.','')||'%')
      and (p_property_types is null or exists (select 1 from unnest(p_property_types) t where p.property_type ilike '%'||t||'%' or p.building_type ilike '%'||t||'%'))
    union all
    select 'lst'::text, al.listing_id, null::bigint, al.listing_date
    from available_listings al
    left join properties p on p.property_id = al.property_id
    where p_include_onmkt and al.is_active and al.off_market_date is null and al.sold_date is null and (p_government_only is false) and coalesce(al.exclude_from_listing_metrics, false) = false
      and (p_states is null or p.state = any(p_states))
      and (p_tenant is null or replace(lower(coalesce(p.chain_canonical,'')||' '||coalesce(p.tenant,'')||' '||coalesce(p.operator,'')),'.','') ilike '%'||replace(lower(p_tenant),'.','')||'%')
      and (p_property_types is null or exists (select 1 from unnest(p_property_types) t where p.property_type ilike '%'||t||'%' or p.building_type ilike '%'||t||'%'))
    union all
    select 'sf'::text, null::integer, st.staging_id, st.sold_date
    from sf_comp_staging st
    where p_include_sf and st.comp_type is not null and (st.status ilike 'sold' or p_include_onmkt)
      and (p_states is null or st.state = any(p_states)) and (p_date_from is null or st.sold_date >= p_date_from) and (p_date_to is null or st.sold_date <= p_date_to)
      and (p_sf_min is null or st.building_sf >= p_sf_min) and (p_sf_max is null or st.building_sf <= p_sf_max)
      and (p_tenant is null or replace(lower(coalesce(st.tenant,'')),'.','') ilike '%'||replace(lower(p_tenant),'.','')||'%')
      and (p_property_types is null or exists (select 1 from unnest(p_property_types) t where st.property_type ilike '%'||t||'%' or st.primary_use ilike '%'||t||'%'))
  ),
  top as (
    select arm, id_main, id_stg, sort_date from cand order by sort_date desc nulls last limit greatest(p_limit,1)
  ),
  proj as (
    select t.sort_date, (jsonb_build_object(
      'comp_id','dia_db:'||s.sale_id,'source','dialysis_db','vertical','dialysis','comp_type','sale','on_market',false,'provenance_tag',null,
      'property_type', coalesce(p.property_type, p.building_type),'property_subtype', p.building_type,'is_government', false,'gov_category', null,
      'tenant', public.comp_tenant(p.chain_canonical, p.operator, p.tenant),'guarantor', null,'address', p.address,'city', p.city,'state', p.state,'zip', p.zip_code,
      'latitude', p.latitude,'longitude', p.longitude,
      'land', coalesce(p.land_area, round((p.lot_sf/43560.0)::numeric,2)),'building_sf', p.building_size,
      'chairs', coalesce(p.total_chairs, pcanon.total_chairs),'patient_count', public.census_suppressed(coalesce(p.ttm_total_treatments, pcanon.ttm_total_treatments), coalesce(p.latest_patient_count, pcanon.latest_patient_count), coalesce(p.total_chairs, pcanon.total_chairs)),
      'year_built', p.year_built,'year_renovated', p.year_renovated,
      'lease_expiration', coalesce(p.wavg_lease_expiration, ll.lease_expiration),'lease_type', ll.expenses,'bumps', ll.bumps,'renewal_options', ll.renewal_options,
      'initial_price', dia_comp_gate_ask(sale_lst.initial_price, s.sold_price),'initial_cap', sale_lst.initial_cap_rate,'last_price', dia_comp_gate_ask(sale_lst.last_price, s.sold_price),'last_cap', sale_lst.last_cap,'list_date', dia_comp_gate_list_date(sale_lst.on_market_date, s.sale_date),
      'sale_price', nullif(s.sold_price,0),'price_withheld', (s.sold_price = 0),'price_per_sf', round((nullif(s.sold_price,0)/nullif(p.building_size,0))::numeric,2),
      'cap_rate', coalesce(s.cap_rate_final, s.cap_rate),'noi', null,'sale_date', s.sale_date,
      'occupancy', p.occupancy_percent,
      'validation_status', null,'confidence', 0.85,'source_sf_id', null,'data_source', s.data_source,'as_of_date', s.updated_at::date,
      'dedup_key', dia_normalize_address(p.address)||'|'||lower(coalesce(p.state,''))||'|'||coalesce(s.sale_date::text,''),'raw', to_jsonb(s)
    ) || jsonb_build_object(
      'annual_rent', coalesce(ll.annual_rent, p.anchor_rent, p.rent_imputed),
      'actual_annual_rent', ll.annual_rent,
      'rent_source', case when ll.annual_rent is not null then 'lease'
                          when p.anchor_rent is not null then coalesce(p.anchor_rent_source, 'master_workbook')
                          when p.rent_imputed is not null then 'imputed' end,
      'rent_is_imputed', (ll.annual_rent is null and p.anchor_rent is null and p.rent_imputed is not null),
      'rent_psf_basis', case when ll.annual_rent is null and p.anchor_rent is null and p.rent_imputed is not null then p.rent_psf_basis end,
      'rent_per_sf', round((coalesce(ll.annual_rent, p.anchor_rent, p.rent_imputed)/nullif(p.building_size,0))::numeric,2),
      'anchor_tenant', p.anchor_tenant, 'tenant_count', p.tenant_count, 'term_weight_basis', p.term_weight_basis, 'firm_term_expiration', p.wavg_firm_term_expiration
    ) || jsonb_build_object(
      -- ID2b-caps: canonical operator identity, additive only.
      'operator_id', op_resolved.operator_id,
      'operator_canonical', op_resolved.name
    )) as comp
    from (select id_main, sort_date from top where arm='sale') t
    join sales_transactions s on s.sale_id = t.id_main
    left join properties p on p.property_id = s.property_id
    left join lateral (
      select l.annual_rent, l.lease_expiration,
        canonicalize_expense_structure(coalesce(l.expense_structure_canonical, l.expense_structure)) as expenses,
        case when l.annualized_escalation_percent_current is not null then (rtrim(rtrim(to_char(l.annualized_escalation_percent_current * 100::numeric, 'FM990.0'::text), '0'::text), '.'::text) || '%/'::text) ||
          case when coalesce(l.escalation_frequency_years_current, 1::numeric) = 1::numeric then 'Yr'::text else l.escalation_frequency_years_current::text || 'Yr'::text end
          else l.escalation_raw_text_current end as bumps,
        coalesce(l.renewal_option_text, l.renewal_options::text) as renewal_options
      from leases l
      where l.property_id = p.property_id
      order by l.is_active desc nulls last, l.effective_date desc nulls last, l.updated_at desc nulls last, l.lease_id asc
      limit 1
    ) ll on true
    left join lateral (
      select cp.total_chairs, cp.ttm_total_treatments, cp.latest_patient_count
      from properties cp
      where cp.property_id = coalesce(p.merged_into_property_id, p.canonical_property_id, p.property_id)
      limit 1
    ) pcanon on true
    left join lateral (
      select o.operator_id, o.name
      from public.operators o
      where o.operator_id = public.dia_operator_survivor(p.operator_id::bigint)
    ) op_resolved on true
    left join lateral (
      select coalesce(al.on_market_date, al.listing_date) as on_market_date,
             al.initial_price, al.initial_cap_rate, al.last_price,
             coalesce(al.last_cap_rate, al.current_cap_rate) as last_cap
      from available_listings al
      where al.property_id = p.property_id
        and coalesce(al.on_market_date, al.listing_date) <= s.sale_date
        and coalesce(al.exclude_from_listing_metrics, false) = false
      order by (al.sale_transaction_id = s.sale_id) desc, coalesce(al.on_market_date, al.listing_date) desc, al.listing_id desc
      limit 1
    ) sale_lst on true
    union all
    select t.sort_date, (jsonb_build_object(
      'comp_id','dia_db_lst:'||al.listing_id,'source','dialysis_db','vertical','dialysis','comp_type','sale','on_market',true,'provenance_tag',null,
      'property_type', coalesce(p.property_type, p.building_type),'is_government', false,'gov_category', null,'tenant', public.comp_tenant(p.chain_canonical, p.operator, p.tenant),'guarantor', null,
      'address', p.address,'city', p.city,'state', p.state,'zip', p.zip_code,'latitude', p.latitude,'longitude', p.longitude,
      'land', coalesce(p.land_area, round((p.lot_sf/43560.0)::numeric,2)),'building_sf', p.building_size,
      'chairs', coalesce(p.total_chairs, pcanon.total_chairs),'patient_count', public.census_suppressed(coalesce(p.ttm_total_treatments, pcanon.ttm_total_treatments), coalesce(p.latest_patient_count, pcanon.latest_patient_count), coalesce(p.total_chairs, pcanon.total_chairs)),
      'year_built', p.year_built,
      'lease_expiration', coalesce(p.wavg_lease_expiration, ll.lease_expiration),'lease_type', ll.expenses,'bumps', ll.bumps,'renewal_options', ll.renewal_options,
      'initial_price', al.initial_price,'initial_cap', al.initial_cap_rate,'last_price', al.last_price,'last_cap', coalesce(al.last_cap_rate, al.current_cap_rate),
      'list_date', coalesce(al.on_market_date, al.listing_date),'price_changes', (al.initial_price IS DISTINCT FROM al.last_price AND al.initial_price IS NOT NULL AND al.last_price IS NOT NULL),'status', initcap(coalesce(al.status,'active')),
      'list_price', coalesce(al.last_price, al.initial_price),'list_cap', coalesce(al.current_cap_rate, al.cap_rate),
      'price_per_sf', al.price_per_sf,'property_subtype', p.building_type,'year_renovated', p.year_renovated,'occupancy', p.occupancy_percent,'noi', round((coalesce(al.last_price, al.initial_price) * coalesce(al.current_cap_rate, al.last_cap_rate, al.initial_cap_rate))::numeric, 0),'noi_is_estimated', (coalesce(al.last_price, al.initial_price) is not null and coalesce(al.current_cap_rate, al.last_cap_rate, al.initial_cap_rate) is not null),'noi_basis', case when coalesce(al.last_price, al.initial_price) is not null and coalesce(al.current_cap_rate, al.last_cap_rate, al.initial_cap_rate) is not null then 'implied_ask' end,'confidence', 0.75,'data_source', al.data_source,'as_of_date', al.last_seen::date,
      'dedup_key', dia_normalize_address(p.address)||'|'||lower(coalesce(p.state,''))||'|listing','raw', to_jsonb(al)
    ) || jsonb_build_object(
      'annual_rent', coalesce(ll.annual_rent, p.anchor_rent, p.rent_imputed),
      'actual_annual_rent', ll.annual_rent,
      'rent_source', case when ll.annual_rent is not null then 'lease'
                          when p.anchor_rent is not null then coalesce(p.anchor_rent_source, 'master_workbook')
                          when p.rent_imputed is not null then 'imputed' end,
      'rent_is_imputed', (ll.annual_rent is null and p.anchor_rent is null and p.rent_imputed is not null),
      'rent_psf_basis', case when ll.annual_rent is null and p.anchor_rent is null and p.rent_imputed is not null then p.rent_psf_basis end,
      'rent_per_sf', round((coalesce(ll.annual_rent, p.anchor_rent, p.rent_imputed)/nullif(p.building_size,0))::numeric,2),
      'anchor_tenant', p.anchor_tenant, 'tenant_count', p.tenant_count, 'term_weight_basis', p.term_weight_basis, 'firm_term_expiration', p.wavg_firm_term_expiration
    ) || jsonb_build_object(
      -- ID2b-caps: canonical operator identity, additive only.
      'operator_id', op_resolved.operator_id,
      'operator_canonical', op_resolved.name
    )) as comp
    from (select id_main, sort_date from top where arm='lst') t
    join available_listings al on al.listing_id = t.id_main
    left join properties p on p.property_id = al.property_id
    left join lateral (
      select l.annual_rent, l.lease_expiration,
        canonicalize_expense_structure(coalesce(l.expense_structure_canonical, l.expense_structure)) as expenses,
        case when l.annualized_escalation_percent_current is not null then (rtrim(rtrim(to_char(l.annualized_escalation_percent_current * 100::numeric, 'FM990.0'::text), '0'::text), '.'::text) || '%/'::text) ||
          case when coalesce(l.escalation_frequency_years_current, 1::numeric) = 1::numeric then 'Yr'::text else l.escalation_frequency_years_current::text || 'Yr'::text end
          else l.escalation_raw_text_current end as bumps,
        coalesce(l.renewal_option_text, l.renewal_options::text) as renewal_options
      from leases l
      where l.property_id = p.property_id
      order by l.is_active desc nulls last, l.effective_date desc nulls last, l.updated_at desc nulls last, l.lease_id asc
      limit 1
    ) ll on true
    left join lateral (
      select cp.total_chairs, cp.ttm_total_treatments, cp.latest_patient_count
      from properties cp
      where cp.property_id = coalesce(p.merged_into_property_id, p.canonical_property_id, p.property_id)
      limit 1
    ) pcanon on true
    left join lateral (
      select o.operator_id, o.name
      from public.operators o
      where o.operator_id = public.dia_operator_survivor(p.operator_id::bigint)
    ) op_resolved on true
    union all
    select t.sort_date, (jsonb_build_object(
      'comp_id','dia_sf:'||st.sf_comp_id,'source','salesforce','vertical','dialysis','comp_type','sale','on_market',(st.status is distinct from 'Sold'),'provenance_tag', st.comp_type,
      'property_type', st.property_type,'property_subtype', st.primary_use,'is_government', coalesce((st.raw_row->>'Government__c')::boolean,false),'gov_category', st.raw_row->>'Gov_Category__c',
      'tenant', st.tenant,'guarantor', st.raw_row->>'Guarantor__c','address', st.street,'city', st.city,'state', st.state,'zip', st.zip_code,'metro', st.raw_row->>'Metro_Name__c',
      'building_sf', st.building_sf,'chairs', null,'patient_count', null,'land_acres', st.land_acres,'year_built', st.year_built,'year_renovated', st.year_renovated,
      'sale_price', case when st.status ilike 'sold' then nullif(st.sold_price,0) end,'price_withheld', (st.status ilike 'sold' and coalesce(st.sold_price,0)=0),
      'price_per_sf', nullif(st.price_sf,0),'cap_rate', round((nullif(st.cap_rate,0)/100.0)::numeric,4),'noi', nullif(st.raw_row->>'NOI__c','')::numeric,'sale_date', st.sold_date,
      'list_price', st.listing_price,'list_cap', nullif(st.raw_row->>'List_Cap__c','')::numeric,'days_on_market', st.days_on_market,
      'annual_rent', st.annual_rent,'rent_per_sf', nullif(st.raw_row->>'Rent_SF__c','')::numeric,'expense_type', st.raw_row->>'Expenses__c',
      'lease_term_years', st.lease_term_years,'lease_expiration', st.lease_expiration,
      'anchor_tenant', null::text,'tenant_count', null::integer,'term_weight_basis', null::text,'firm_term_expiration', null::date,
      'validation_status', st.raw_row->>'Validation_Status__c','has_om', (st.raw_row->>'Files_Formula__c') is not null,
      'confidence', case when st.raw_row->>'Validation_Status__c' = 'Validated' then 0.9 else 0.7 end,'source_sf_id', st.sf_comp_id,'data_source','salesforce','as_of_date', st.imported_at::date,
      'dedup_key', dia_normalize_address(st.street)||'|'||lower(coalesce(st.state,''))||'|'||coalesce(st.sold_date::text,''),'raw', st.raw_row
    ) || jsonb_build_object(
      -- ID2b-caps-2: sf_comp_staging.operator_id (resolved from `tenant` at
      -- write time by trg_dia_sf_comp_staging_operator_fill, backfillable via
      -- dia_id2acleanup2_backfill_sf_comp_staging_operator_ids) resolved
      -- through the survivor chain, mirroring the sale/listing arms exactly.
      -- NULL when the tenant has never resolved (see
      -- dia_operator_write_review where table_name='sf_comp_staging') --
      -- never guessed, never a second resolver.
      'operator_id', sf_op_resolved.operator_id,
      'operator_canonical', sf_op_resolved.name
    )) as comp
    from (select id_stg, sort_date from top where arm='sf') t
    join sf_comp_staging st on st.staging_id = t.id_stg
    left join lateral (
      select o.operator_id, o.name
      from public.operators o
      where o.operator_id = public.dia_operator_survivor(st.operator_id::bigint)
    ) sf_op_resolved on true
  )
  select comp from proj order by sort_date desc nulls last;
$function$;

COMMENT ON FUNCTION public.rpc_query_comps(text, text[], text[], text[], date, date, integer, integer, boolean, boolean, boolean, integer, text) IS
  'ID2b-caps-2 (2026-09-12): sale/listing arms unchanged from ID2b-caps
   (operator_id/operator_canonical via properties.operator_id ->
   dia_operator_survivor -> operators.name). The sf_comp_staging arm now
   resolves the SAME fields from sf_comp_staging.operator_id ->
   dia_operator_survivor -> operators.name (was: explicit NULL, because that
   arm has no properties join). Additive only; comp SELECTION/scoring is
   untouched. Closes the remaining Fresenius/DaVita cap-rate band
   fragmentation that ID2b-caps left unresolved on the Salesforce-staged
   comp source.';
