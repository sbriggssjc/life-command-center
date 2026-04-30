-- Two unranked-write patterns surfaced in v_field_provenance_unranked
-- after PR #519's lcc_merge_field plumbing fix unblocked the audit
-- pipeline:
--
-- 1. dia.properties × costar_sidebar — 10 fields the sidebar's dia
--    branch in upsertDomainProperty writes but had no rules. Same
--    class as PR #524's gov.properties extension; this PR mirrors
--    it for dia.
--
-- 2. dia.leases × email_intake — a new email-intake writer
--    (introduced separately) is hitting field_provenance with 9
--    user-facing lease fields. The fields themselves already have
--    rules for other sources (costar_sidebar, om_extraction, etc.);
--    we just need to register email_intake as a recognized source
--    for them.
--
-- email_intake priority = 35: lower-trust than om_extraction (30)
-- because it's a free-form email body (no explicit OM document
-- attached), but higher-trust than costar_sidebar (60) because the
-- email is from a known broker contact.

-- 1. dia.properties × costar_sidebar
insert into public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
values
  ('dia.properties', 'building_type',           'manual_edit',    1,  'record_only', null),
  ('dia.properties', 'building_type',           'costar_sidebar', 65, 'record_only', 'CoStar property-type field.'),
  ('dia.properties', 'county',                  'manual_edit',    1,  'record_only', null),
  ('dia.properties', 'county',                  'county_records', 10, 'record_only', 'County registrar of record.'),
  ('dia.properties', 'county',                  'costar_sidebar', 65, 'record_only', null),
  ('dia.properties', 'is_single_tenant',        'manual_edit',    1,  'record_only', null),
  ('dia.properties', 'is_single_tenant',        'costar_sidebar', 65, 'record_only', 'CoStar tenancy classification (Single vs Multi).'),
  ('dia.properties', 'occupancy_percent',       'manual_edit',    1,  'record_only', null),
  ('dia.properties', 'occupancy_percent',       'costar_sidebar', 65, 'record_only', null),
  ('dia.properties', 'parking_ratio',           'manual_edit',    1,  'record_only', null),
  ('dia.properties', 'parking_ratio',           'costar_sidebar', 65, 'record_only', null),
  ('dia.properties', 'property_ownership_type', 'manual_edit',    1,  'record_only', null),
  ('dia.properties', 'property_ownership_type', 'costar_sidebar', 65, 'record_only', 'CoStar Owner-occupied vs Investor-owned classification.'),
  ('dia.properties', 'recorded_owner_name',     'manual_edit',    1,  'record_only', null),
  ('dia.properties', 'recorded_owner_name',     'county_records', 10, 'record_only', 'County deed registrar.'),
  ('dia.properties', 'recorded_owner_name',     'costar_sidebar', 65, 'record_only', null),
  ('dia.properties', 'year_renovated',          'manual_edit',    1,  'record_only', null),
  ('dia.properties', 'year_renovated',          'costar_sidebar', 65, 'record_only', null),
  ('dia.properties', 'zoning',                  'manual_edit',    1,  'record_only', null),
  ('dia.properties', 'zoning',                  'county_records', 10, 'record_only', 'County zoning records.'),
  ('dia.properties', 'zoning',                  'costar_sidebar', 65, 'record_only', null),
  ('dia.properties', 'assessed_value',          'manual_edit',    1,  'record_only', null),
  ('dia.properties', 'assessed_value',          'county_records', 10, 'record_only', 'County tax assessor.'),
  ('dia.properties', 'assessed_value',          'costar_sidebar', 65, 'record_only', null),

  -- 2. dia.leases × email_intake (priority 35; less trusted than
  --    om_extraction at 30 but higher than costar_sidebar at 60).
  ('dia.leases', 'annual_rent',       'email_intake', 35, 'record_only', 'Email-extracted annual rent.'),
  ('dia.leases', 'expense_structure', 'email_intake', 35, 'record_only', null),
  ('dia.leases', 'guarantor',         'email_intake', 35, 'record_only', null),
  ('dia.leases', 'lease_expiration',  'email_intake', 35, 'record_only', null),
  ('dia.leases', 'lease_start',       'email_intake', 35, 'record_only', null),
  ('dia.leases', 'leased_area',       'email_intake', 35, 'record_only', null),
  ('dia.leases', 'renewal_options',   'email_intake', 35, 'record_only', null),
  ('dia.leases', 'rent_per_sf',       'email_intake', 35, 'record_only', null),
  ('dia.leases', 'tenant',            'email_intake', 35, 'record_only', 'Email-extracted tenant identity.')
on conflict (target_table, field_name, source) do nothing;
