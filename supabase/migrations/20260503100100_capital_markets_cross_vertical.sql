-- Capital Markets — LCC Opps cross-vertical foundation (Phase 0)
--
-- Establishes the cross-vertical scaffolding: the verticals registry, the
-- chart-template catalog, the brand-token mirror, the macro-rates table,
-- the RCA import landing table, the Northmarq broker-pattern table, the
-- reports/narratives CMS, and the Phase 2 features-photo placeholder.
--
-- This Phase 0 migration creates TABLES + SEEDS only. No views, no RPCs.
-- Phase 1 will:
--   - Add cm_get_view_data() RPC to dispatch a chart_template_id to the
--     correct domain Supabase project's view via foreign-data-wrapper or
--     api-side fetch.
--   - Add the chart-snapshot caching table (image bytes in storage).
--
-- See public/reports/CAPITAL_MARKETS_ARCHITECTURE.md for the design.

------------------------------------------------------------
-- 1. Verticals registry
------------------------------------------------------------
create table if not exists public.cm_verticals (
  vertical_id        text primary key,         -- 'gov' | 'dialysis' | 'national_st' | ...
  label              text not null,
  supabase_project   text not null,            -- 'GovernmentProject' | 'DialysisProject' | 'lcc_opps'
  data_origin        text not null,            -- 'live_ingest' | 'rca_imports' | 'manual'
  is_active          boolean not null default true,
  deliverable_pdf    text,                     -- last published PDF, for reference
  pdf_cadence        text not null default 'quarterly',  -- 'quarterly' | 'monthly' | 'annual'
  notes              text,
  created_at         timestamptz not null default now()
);

insert into public.cm_verticals (vertical_id, label, supabase_project, data_origin, is_active, deliverable_pdf, pdf_cadence) values
  ('gov',         'Government-Leased',         'GovernmentProject', 'live_ingest', true,  'state-of-gov-leased-2024-q2.pdf',    'quarterly'),
  ('dialysis',    'Dialysis',                  'DialysisProject',   'live_ingest', true,  'dialysis-market-filter-2025-q4.pdf', 'quarterly'),
  ('national_st', 'National Single-Tenant',    'lcc_opps',          'rca_imports', true,  null,                                  'quarterly'),
  ('childcare',   'Childcare (planned)',       'tbd',               'manual',      false, null,                                  'quarterly'),
  ('urgent_care', 'Urgent Care (planned)',     'tbd',               'manual',      false, null,                                  'quarterly'),
  ('medical_nnn', 'Medical Net Lease (planned)','tbd',              'manual',      false, null,                                  'quarterly')
on conflict (vertical_id) do update
  set label = excluded.label,
      supabase_project = excluded.supabase_project,
      data_origin = excluded.data_origin,
      is_active = excluded.is_active,
      deliverable_pdf = excluded.deliverable_pdf,
      pdf_cadence = excluded.pdf_cadence;

------------------------------------------------------------
-- 2. Subspecialties (filterable mini-reports)
------------------------------------------------------------
create table if not exists public.cm_subspecialties (
  subspecialty_id    text primary key,         -- 'gov_ssa' | 'dia_davita' | ...
  vertical_id        text not null references public.cm_verticals (vertical_id),
  filter_dim         text not null,            -- 'tenant_agency' | 'operator_parent' | 'region'
  filter_value       text not null,
  label              text not null,
  is_active          boolean not null default false,
  source_proof       text,                     -- e.g. existing tab in master workbook
  notes              text,
  created_at         timestamptz not null default now()
);

insert into public.cm_subspecialties (subspecialty_id, vertical_id, filter_dim, filter_value, label, is_active, source_proof) values
  ('gov_ssa',         'gov',      'tenant_agency',   'SSA',         'SSA-Tenanted Properties',         true,  'Copy Government Master Document.xlsx ''SSA Charts'' tab'),
  ('gov_va',          'gov',      'tenant_agency',   'VA',          'VA-Tenanted Properties',          false, null),
  ('gov_irs',         'gov',      'tenant_agency',   'IRS',         'IRS-Tenanted Properties',         false, null),
  ('dia_davita',      'dialysis', 'operator_parent', 'DaVita',      'DaVita-Operated',                 false, null),
  ('dia_fresenius',   'dialysis', 'operator_parent', 'Fresenius',   'Fresenius-Operated',              false, null),
  ('dia_independent', 'dialysis', 'operator_parent', 'Independent', 'Independent Operators',           false, null)
on conflict (subspecialty_id) do nothing;

------------------------------------------------------------
-- 3. Chart catalog (mirrors cm_chart_catalog.json)
------------------------------------------------------------
create table if not exists public.cm_chart_catalog (
  chart_template_id  text primary key,
  name               text not null,
  chart_type         text not null,            -- 'BarChart' | 'LineChart' | 'AreaChart' | 'PieChart' | 'ScatterChart' | 'StockChart' | 'DataTable'
  data_shape         text not null,            -- 'time_series_quarterly' | 'time_series_yearly' | 'categorical' | ...
  metric_focus       text not null,            -- 'volume_dollars' | 'cap_rate' | 'deal_count' | ...
  y_format_token     text,                     -- key into cm_brand_tokens.axis_formats
  applies_to_verticals  text[] not null,
  subspecialty_friendly boolean not null default false,
  view_name_template text not null,            -- 'cm_{vertical}_volume_ttm_q'
  phase              int not null default 1,
  notes              text,
  created_at         timestamptz not null default now()
);

-- Seed from cm_chart_catalog.json (kept brief — full set populated by Phase 1 loader)
insert into public.cm_chart_catalog
  (chart_template_id, name, chart_type, data_shape, metric_focus, y_format_token, applies_to_verticals, subspecialty_friendly, view_name_template, phase) values
  ('volume_ttm_by_quarter',     'Sales Volume — TTM by Quarter',           'AreaChart',    'time_series_quarterly',           'volume_dollars',  'currency_billions',    array['gov','dialysis','national_st'], true,  'cm_{vertical}_volume_ttm_q',     1),
  ('transaction_count_ttm',     'Transaction Count — TTM by Quarter',      'BarChart',     'time_series_quarterly',           'deal_count',      'integer_count',        array['gov','dialysis','national_st'], true,  'cm_{vertical}_count_ttm_q',      1),
  ('cap_rate_ttm_by_quarter',   'Cap Rate — TTM Weighted Avg by Quarter',  'LineChart',    'time_series_quarterly',           'cap_rate',        'percent_basis_points', array['gov','dialysis','national_st'], true,  'cm_{vertical}_cap_ttm_q',        1),
  ('cap_rate_top_bottom_quartile','Cap Rate — Top vs Bottom Quartile',    'LineChart',    'time_series_quarterly',           'cap_rate_quartile','percent_basis_points',array['gov','dialysis','national_st'], true,  'cm_{vertical}_cap_quartile_q',   1),
  ('rent_survey_yearly',        'Rent Survey — Annual',                    'LineChart',    'time_series_yearly_by_dim',       'rent_per_sf',     'currency_per_sf',      array['gov','dialysis'],               true,  'cm_{vertical}_rent_survey_y',    1),
  ('avg_deal_size',             'Average Deal Size — TTM by Quarter',     'BarChart',     'time_series_quarterly',           'avg_deal_size',   'currency_millions',    array['gov','dialysis','national_st'], true,  'cm_{vertical}_avg_deal_q',       1),
  ('market_share_pie_ttm',      'Market Share Pie — TTM',                  'PieChart',     'categorical',                     'market_share_ttm','percent_one_decimal',  array['gov','dialysis'],               true,  'cm_{vertical}_market_share_pie', 1),
  ('top_buyers_table',          'Top Buyers (TTM)',                        'DataTable',    'ranked_list',                     'buyer_volume',    'currency_millions',    array['gov','dialysis','national_st'], true,  'cm_{vertical}_top_buyers',       1),
  ('top_sellers_table',         'Top Sellers (TTM)',                       'DataTable',    'ranked_list',                     'seller_volume',   'currency_millions',    array['gov','dialysis','national_st'], true,  'cm_{vertical}_top_sellers',      1),
  ('nm_vs_market_cap',          'NM vs Market — Avg Cap Rate (TTM)',       'LineChart',    'time_series_quarterly_dual',      'cap_rate_attribution','percent_basis_points',array['gov','dialysis','national_st'], false, 'cm_{vertical}_nm_vs_market_q',   1),
  ('cap_rate_yoy_change',       'Cap Rate — YoY Change',                   'LineChart',    'time_series_quarterly',           'cap_rate_change', 'percent_basis_points', array['gov','dialysis','national_st'], false, 'cm_{vertical}_cap_yoy_q',        2),
  ('cap_rate_by_credit',        'Cap Rate by Credit Tier',                 'LineChart',    'time_series_quarterly_by_dim',    'cap_rate',        'percent_basis_points', array['dialysis','gov'],               false, 'cm_{vertical}_cap_by_credit_q',  2),
  ('ppsf_box_quarterly',        'Price/SF — Quarterly Box',                'StockChart',   'time_series_quarterly_ohlc',      'price_per_sf',    'currency_per_sf',      array['national_st','gov','dialysis'], true,  'cm_{vertical}_ppsf_box_q',       2),
  ('rent_psf_box_quarterly',    'Rent/SF — Quarterly Box',                 'StockChart',   'time_series_quarterly_ohlc',      'rent_per_sf',     'currency_per_sf',      array['national_st','gov','dialysis'], true,  'cm_{vertical}_rent_box_q',       2),
  ('buyer_class_pct_by_year',   'Buyer Class % of Volume — Annual',        'BarChart',     'stacked_bar_yearly',              'buyer_class_share','percent_one_decimal', array['national_st','gov','dialysis'], true,  'cm_{vertical}_buyer_share_y',    2),
  ('nm_share_of_market',        'NM Share of Market Volume — Annual',      'BarChart',     'time_series_yearly',              'nm_volume_share', 'percent_one_decimal',  array['gov','dialysis','national_st'], false, 'cm_{vertical}_nm_share_y',       2),
  ('listings_count_q',          'Available Listings Count',                'BarChart',     'time_series_quarterly',           'active_listings', 'integer_count',        array['gov','dialysis'],               true,  'cm_{vertical}_listings_q',       2),
  ('available_cap_rate_scatter','Available Listings — Cap vs Term',       'ScatterChart', 'scatter_xy',                       'cap_vs_term',     'percent_basis_points', array['dialysis','gov'],               true,  'cm_{vertical}_available_scatter',2),
  ('dom_price_adjustments',     'DOM & Price Adjustments',                 'BarChart',     'categorical',                      'dom',             'integer_count',        array['dialysis','gov'],               true,  'cm_{vertical}_dom_price_adj',    2),
  ('fed_funds_vs_treasury',     'Fed Funds vs 10Y Treasury',               'LineChart',    'time_series_quarterly_dual',      'rates',           'percent_one_decimal',  array['national_st','gov','dialysis'], false, 'cm_macro_rates_q',               2),
  ('net_lease_spread',          'Net Lease Spread (Cap - 10Y Treasury)',   'AreaChart',    'time_series_quarterly',           'spread',          'percent_basis_points', array['national_st','gov','dialysis'], false, 'cm_macro_spread_q',              2),
  ('predicted_cap_rate',        'Predicted Cap Rate (vs 10Y regression)',  'LineChart',    'time_series_quarterly_with_forecast','cap_forecast', 'percent_basis_points', array['national_st','gov','dialysis'], false, 'cm_{vertical}_cap_forecast_q',   3),
  ('index_yoy_change',          'Index YoY — Net Lease vs Components',     'LineChart',    'time_series_quarterly_indexed',   'index',           'percent_one_decimal',  array['national_st'],                  false, 'cm_natl_st_index_q',             3)
on conflict (chart_template_id) do nothing;

------------------------------------------------------------
-- 4. Brand tokens (mirror of cm_brand_tokens.json)
------------------------------------------------------------
create table if not exists public.cm_brand_tokens (
  token_key          text primary key,         -- 'palette.nm_navy' | 'fonts.title_family' | ...
  token_value        text not null,
  category           text not null,            -- 'palette' | 'fonts' | 'type_scale' | 'axis_formats' | 'chart_layout'
  notes              text,
  updated_at         timestamptz not null default now()
);

insert into public.cm_brand_tokens (token_key, token_value, category, notes) values
  ('palette.nm_navy',       '#003DA5', 'palette', 'Primary'),
  ('palette.nm_sky',        '#62B5E5', 'palette', 'Accent'),
  ('palette.nm_pale',       '#E0E8F4', 'palette', 'Fill'),
  ('palette.nm_blue_mid',   '#265AB2', 'palette', 'Series 3'),
  ('palette.nm_axis',       '#6A748C', 'palette', 'Axis tick labels'),
  ('palette.nm_text',       '#191919', 'palette', 'Body text'),
  ('palette.nm_text_muted', '#666666', 'palette', 'Footnote text'),
  ('palette.nm_bg',         '#FFFFFF', 'palette', 'Background'),
  ('palette.nm_bg_alt',     '#E7E6E6', 'palette', 'Card divider'),
  ('fonts.title_family',    'Calibri Light', 'fonts', null),
  ('fonts.body_family',     'Calibri',       'fonts', null),
  ('fonts.fallback_stack',  '''Calibri Light'', ''Calibri'', ''Segoe UI'', system-ui, sans-serif', 'fonts', null)
on conflict (token_key) do update set token_value = excluded.token_value, updated_at = now();

------------------------------------------------------------
-- 5. Northmarq broker patterns (editable attribution rules)
------------------------------------------------------------
create table if not exists public.cm_nm_broker_patterns (
  pattern_id         bigserial primary key,
  match_pattern      text not null unique,     -- ILIKE pattern, e.g. '%Northmarq%'
  effective_from     date,                      -- when this pattern started identifying NM deals
  effective_until    date,                      -- when it stopped (NULL = still current)
  notes              text,
  created_at         timestamptz not null default now()
);

insert into public.cm_nm_broker_patterns (match_pattern, effective_from, effective_until, notes) values
  ('%Northmarq%',     date '2022-01-01', null,                       'Current Northmarq name (post Stan Johnson Co. acquisition).'),
  ('%Stan Johnson%',  date '2002-01-01', date '2024-12-31',          'Pre-acquisition firm name. Continued appearing in CoStar through ~2024.'),
  ('%SJC%',           date '2002-01-01', date '2024-12-31',          'Common abbreviation in CoStar exports for Stan Johnson Company.'),
  ('%NorthMarq%',     date '2022-01-01', null,                       'Common alternate capitalization.')
on conflict (match_pattern) do nothing;

------------------------------------------------------------
-- 6. Macro rates (Fed Funds + 10Y Treasury, used cross-vertical)
------------------------------------------------------------
create table if not exists public.cm_macro_rates_q (
  period_end           date primary key,
  fed_funds_rate_avg   numeric(6,4),            -- 0.0 to 1.0
  treasury_10y_yield   numeric(6,4),            -- 0.0 to 1.0
  net_lease_spread     numeric(6,4),            -- avg market cap - treasury_10y
  source_url           text,
  ingested_at          timestamptz,
  notes                text
);

comment on table public.cm_macro_rates_q is
  'Quarterly macro rates referenced by the Spreads, Prediction, and Net Lease '
  'Spread charts. Phase 1 will add a scheduled ingestion from FRED (Federal '
  'Reserve Economic Data) so 10Y Treasury and Fed Funds populate automatically. '
  'This table is also the long-term fix for the BN-column corruption in the gov '
  'master workbook (the corrupted cells appear to depend on a missing 10Y feed).';

------------------------------------------------------------
-- 7. RCA TrendTracker imports (national single-tenant data)
------------------------------------------------------------
create table if not exists public.cm_rca_quarterly (
  product_type         text not null,           -- 'office' | 'medical' | 'industrial' | 'retail'
  period_end           date not null,
  ttm_volume_dollars   numeric(20,2),
  ttm_property_count   int,
  ttm_total_sf         numeric(18,2),
  ttm_cap_rate         numeric(6,4),
  ttm_top_quartile_cap numeric(6,4),
  ttm_top_quartile_ppsf numeric(10,2),
  source_export_id     uuid,
  ingested_at          timestamptz not null default now(),
  primary key (product_type, period_end)
);

create table if not exists public.cm_rca_imports (
  import_id           uuid primary key default gen_random_uuid(),
  filename            text not null,
  product_type        text not null,
  uploaded_by         text,
  uploaded_at         timestamptz not null default now(),
  rows_loaded         int not null default 0,
  notes               text
);

comment on table public.cm_rca_quarterly is
  'Normalized RCA TrendTracker time-series. One row per (product_type, '
  'quarter). RCA includes property/portfolio sales >= $2.5M only — chart '
  'footnotes that compare NM volume to RCA totals must surface this.';

------------------------------------------------------------
-- 8. Reports (the published quarterly/monthly deliverable)
------------------------------------------------------------
create table if not exists public.cm_reports (
  report_id          uuid primary key default gen_random_uuid(),
  vertical_id        text not null references public.cm_verticals (vertical_id),
  subspecialty_id    text references public.cm_subspecialties (subspecialty_id),
  period_end         date not null,
  draft_status       text not null default 'draft',  -- 'draft' | 'review' | 'published' | 'archived'
  forked_from_report_id uuid references public.cm_reports (report_id),
  drafted_at         timestamptz not null default now(),
  drafted_by         text,
  published_at       timestamptz,
  published_by       text,
  pdf_url            text,
  workbook_url       text,
  notes              text,
  unique (vertical_id, subspecialty_id, period_end)
);

create index if not exists ix_cm_reports_vertical_period on public.cm_reports (vertical_id, period_end desc);

------------------------------------------------------------
-- 9. Narratives (markdown blocks per report, fork-friendly)
------------------------------------------------------------
create table if not exists public.cm_narratives (
  narrative_id       uuid primary key default gen_random_uuid(),
  report_id          uuid not null references public.cm_reports (report_id) on delete cascade,
  section_id         text not null,            -- 'summary' | 'volume' | 'cap_rates' | 'buyer_mix' | 'outlook' | ...
  section_order      int not null default 0,
  markdown           text not null default '',
  forked_from_narrative_id uuid references public.cm_narratives (narrative_id),
  edited_at          timestamptz not null default now(),
  edited_by          text,
  unique (report_id, section_id)
);

create index if not exists ix_cm_narratives_report on public.cm_narratives (report_id, section_order);

------------------------------------------------------------
-- 10. Featured deals (Phase 2 placeholder; Scott picks photos manually)
------------------------------------------------------------
create table if not exists public.cm_features (
  feature_id         uuid primary key default gen_random_uuid(),
  report_id          uuid not null references public.cm_reports (report_id) on delete cascade,
  position           int not null default 0,
  property_id        text,                     -- nullable; can reference an LCC property
  caption            text,
  photo_url          text,
  notes              text
);

------------------------------------------------------------
-- 11. Report snapshots (immutable as-of data per published report)
------------------------------------------------------------
create table if not exists public.cm_report_snapshots (
  snapshot_id        uuid primary key default gen_random_uuid(),
  report_id          uuid not null references public.cm_reports (report_id) on delete cascade,
  chart_template_id  text not null,
  payload            jsonb not null,           -- the rendered data the chart was built on
  rendered_png_url   text,                     -- optional cached PNG (Supabase Storage)
  snapshotted_at     timestamptz not null default now(),
  unique (report_id, chart_template_id)
);

comment on table public.cm_report_snapshots is
  'Immutable as-of-publish chart data. Lets us re-render a year-old report '
  'with the original numbers even if upstream data has since changed.';

------------------------------------------------------------
-- 12. Grants
------------------------------------------------------------
grant select on public.cm_verticals          to anon, authenticated, service_role;
grant select on public.cm_subspecialties     to anon, authenticated, service_role;
grant select on public.cm_chart_catalog      to anon, authenticated, service_role;
grant select on public.cm_brand_tokens       to anon, authenticated, service_role;
grant select on public.cm_nm_broker_patterns to anon, authenticated, service_role;
grant select on public.cm_macro_rates_q      to anon, authenticated, service_role;
grant select on public.cm_rca_quarterly      to anon, authenticated, service_role;
grant select on public.cm_reports            to anon, authenticated, service_role;
grant select on public.cm_narratives         to anon, authenticated, service_role;
grant select on public.cm_features           to anon, authenticated, service_role;
grant select on public.cm_report_snapshots   to anon, authenticated, service_role;

grant insert, update, delete on public.cm_macro_rates_q      to authenticated, service_role;
grant insert, update, delete on public.cm_rca_quarterly      to authenticated, service_role;
grant insert, update, delete on public.cm_rca_imports        to authenticated, service_role;
grant insert, update, delete on public.cm_nm_broker_patterns to authenticated, service_role;
grant insert, update, delete on public.cm_reports            to authenticated, service_role;
grant insert, update, delete on public.cm_narratives         to authenticated, service_role;
grant insert, update, delete on public.cm_features           to authenticated, service_role;
grant insert, update, delete on public.cm_report_snapshots   to service_role;
