-- Register field_source_priority rules for the 15 gov.properties fields
-- the sidebar pipeline writes but had zero registry coverage. Audit found:
--   year_renovated, county, building_type, gov_occupancy_pct, assessed_value,
--   gross_rent, gross_rent_psf, lease_expiration, renewal_options,
--   rent_escalations, sf_leased, agency, agency_full_name,
--   latest_deed_date, latest_sale_price
--
-- All from upsertDomainProperty's gov branch (sidebar-pipeline.js around
-- L2427+). Without rules, lcc_merge_field falls through to v_field_
-- provenance_unranked or simply records with no source-priority
-- comparison, which means manual_edit / OM / county_records writes that
-- SHOULD outrank a CoStar refresh aren't given that ranking when the
-- conflict happens.
--
-- Each field gets at minimum:
--   manual_edit    (priority 1)   — explicit human override always wins
--   costar_sidebar (priority 65)  — CoStar refresh, lower-trust
--
-- gross_rent / gross_rent_psf additionally get om_extraction (priority 30)
-- because promotePropertyFinancials backfills gross_rent from OM
-- extractions. assessed_value / latest_deed_date / latest_sale_price
-- additionally get county_records (priority 10) — these come from public-
-- record sources that should outrank CoStar.

insert into public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
values
  -- Building / property metadata
  ('gov.properties', 'year_renovated',    'manual_edit',    1,  'record_only', 'Explicit human override.'),
  ('gov.properties', 'year_renovated',    'costar_sidebar', 65, 'record_only', 'CoStar Year Renovated.'),

  ('gov.properties', 'county',            'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'county',            'costar_sidebar', 65, 'record_only', null),
  ('gov.properties', 'county',            'county_records', 10, 'record_only', 'County registrar of record.'),

  ('gov.properties', 'building_type',     'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'building_type',     'costar_sidebar', 65, 'record_only', 'CoStar property-type field.'),

  ('gov.properties', 'gov_occupancy_pct', 'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'gov_occupancy_pct', 'costar_sidebar', 65, 'record_only', null),

  ('gov.properties', 'assessed_value',    'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'assessed_value',    'county_records', 10, 'record_only', 'County tax assessor.'),
  ('gov.properties', 'assessed_value',    'costar_sidebar', 65, 'record_only', null),

  -- Rent + lease metadata mirrored onto the property row
  ('gov.properties', 'gross_rent',        'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'gross_rent',        'om_extraction',  30, 'record_only', 'OM-extracted annual rent.'),
  ('gov.properties', 'gross_rent',        'costar_sidebar', 65, 'record_only', null),

  ('gov.properties', 'gross_rent_psf',    'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'gross_rent_psf',    'om_extraction',  30, 'record_only', null),
  ('gov.properties', 'gross_rent_psf',    'costar_sidebar', 65, 'record_only', null),

  ('gov.properties', 'lease_expiration',  'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'lease_expiration',  'om_extraction',  30, 'record_only', null),
  ('gov.properties', 'lease_expiration',  'costar_sidebar', 65, 'record_only', null),

  ('gov.properties', 'renewal_options',   'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'renewal_options',   'costar_sidebar', 65, 'record_only', null),

  ('gov.properties', 'rent_escalations',  'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'rent_escalations',  'costar_sidebar', 65, 'record_only', null),

  ('gov.properties', 'sf_leased',         'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'sf_leased',         'costar_sidebar', 65, 'record_only', null),

  ('gov.properties', 'agency',            'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'agency',            'costar_sidebar', 65, 'record_only', null),

  ('gov.properties', 'agency_full_name',  'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'agency_full_name',  'costar_sidebar', 65, 'record_only', null),

  -- Latest sale signal mirrored from sales_history
  ('gov.properties', 'latest_deed_date',  'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'latest_deed_date',  'county_records', 10, 'record_only', 'County deed registrar.'),
  ('gov.properties', 'latest_deed_date',  'costar_sidebar', 65, 'record_only', null),

  ('gov.properties', 'latest_sale_price', 'manual_edit',    1,  'record_only', null),
  ('gov.properties', 'latest_sale_price', 'county_records', 10, 'record_only', null),
  ('gov.properties', 'latest_sale_price', 'costar_sidebar', 65, 'record_only', null)
on conflict (target_table, field_name, source) do nothing;
