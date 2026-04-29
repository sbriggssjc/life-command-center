-- Register field_source_priority rules for gov.properties fields the
-- sidebar (and others) write but that have no rules in the registry.
-- Companion to life-command-center sidebar-pipeline.js property
-- provenance schema split.
--
-- Audit on 2026-04-29 found:
--   gov.properties.lease_commencement: NO rules at all (writer:
--     upsertDomainProperty gov branch sets it from metadata)
--   gov.properties.year_built: only 2 sources (manual_edit, county)
--   gov.properties.zip_code:   only 1 source (manual_edit)
--   gov.properties.land_acres: only 1 source (manual_edit)
--
-- Adding costar_sidebar + om_extraction rules for the fields the
-- sidebar / OM promoter actively write. Stays in record_only mode
-- per the FU6 ramp plan.

insert into public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
values
  -- gov.properties.lease_commencement (currently 0 rules)
  ('gov.properties', 'lease_commencement', 'manual_edit',    1,  'record_only', 'Explicit human override.'),
  ('gov.properties', 'lease_commencement', 'om_extraction',  30, 'record_only', 'OM-extracted lease commencement.'),
  ('gov.properties', 'lease_commencement', 'costar_sidebar', 60, 'record_only', 'CoStar lease commencement field.'),

  -- gov.properties.year_built — fill in costar_sidebar + om_extraction
  ('gov.properties', 'year_built', 'om_extraction',  50, 'record_only', 'OM-stated year built.'),
  ('gov.properties', 'year_built', 'costar_sidebar', 65, 'record_only', 'CoStar year built field.'),
  ('gov.properties', 'year_built', 'rca_sidebar',    50, 'record_only', null),

  -- gov.properties.zip_code — fill in costar/OM/rca
  ('gov.properties', 'zip_code', 'om_extraction',  50, 'record_only', null),
  ('gov.properties', 'zip_code', 'costar_sidebar', 65, 'record_only', null),
  ('gov.properties', 'zip_code', 'rca_sidebar',    50, 'record_only', null),
  ('gov.properties', 'zip_code', 'county_records', 10, 'record_only', null),

  -- gov.properties.land_acres — fill in costar/OM/rca/county
  ('gov.properties', 'land_acres', 'om_extraction',  50, 'record_only', null),
  ('gov.properties', 'land_acres', 'costar_sidebar', 65, 'record_only', null),
  ('gov.properties', 'land_acres', 'rca_sidebar',    50, 'record_only', null),
  ('gov.properties', 'land_acres', 'county_records', 10, 'record_only', 'County parcel acreage.')
on conflict (target_table, field_name, source) do nothing;
