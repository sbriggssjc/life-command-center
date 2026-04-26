-- ============================================================================
-- Migration: Phase 2.2.b extension to field_source_priority registry
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Adds priority entries for the per-row provenance now recorded by the
-- CoStar sidebar pipeline (sidebar-pipeline.js Phase 2.2.b instrumentation):
--   - dia.leases.{tenant,annual_rent,rent_per_sf,leased_area,lease_start,
--                 lease_expiration,expense_structure}
--   - dia.sales_transactions.{sale_date,sold_price,buyer_name,seller_name,
--                             stated_cap_rate,listing_broker,procuring_broker,
--                             transaction_type}
--   - gov.sales_transactions.{sale_date,sold_price,buyer,seller,sold_cap_rate,
--                             purchasing_broker,transaction_type}
--   - dia.contacts.{name,email,phone,role}
--   - gov.contacts.{name,email,phone,contact_type}
--   - dia.parcel_records.{apn,county,assessed_value}
--   - gov.parcel_records.{apn,county,land_value,improvement_value,
--                         total_assessed_value}
--   - dia.tax_records.{tax_year,assessed_value}
--   - gov.tax_records.{tax_year,assessed_value}
--
-- Same priority bands as the original Phase 1 seed:
--   1-19   = hard authoritative (manual edits, county records of record)
--   20-39  = primary trusted (signed leases, OM source-of-truth, lease docs)
--   40-59  = secondary trusted (OM extraction by AI, lease abstracts)
--   60-79  = aggregator/scraper (CoStar, LoopNet, broker flyers)
--
-- All entries default to enforce_mode='record_only' (set on the table) so
-- this is observation-only — actual UPDATEs in sidebar-pipeline.js run
-- unchanged. See docs/architecture/data_quality_self_learning_loop.md for
-- the Phase 3+ flip to warn / strict modes.
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  -- ── dia.leases ──────────────────────────────────────────────────────────
  -- Lease-document data (signed lease) wins over OM extraction wins over CoStar.
  ('dia.leases', 'tenant',            'manual_edit',     1,  null, 'Explicit human override.'),
  ('dia.leases', 'tenant',            'lease_document', 10, null, 'Signed lease.'),
  ('dia.leases', 'tenant',            'om_extraction',  30, 0.5,  'OM-stated tenant.'),
  ('dia.leases', 'tenant',            'costar_sidebar', 60, null, 'CoStar tenant panel — junk-tenant filter applied at write time.'),

  ('dia.leases', 'annual_rent',       'manual_edit',     1,  null, null),
  ('dia.leases', 'annual_rent',       'lease_document', 10, null, null),
  ('dia.leases', 'annual_rent',       'om_extraction',  30, 0.5,  'OM rent — typically anchor rent.'),
  ('dia.leases', 'annual_rent',       'costar_sidebar', 70, null, 'CoStar metadata.annual_rent often misreports per-SF as total.'),

  ('dia.leases', 'rent_per_sf',       'manual_edit',     1,  null, null),
  ('dia.leases', 'rent_per_sf',       'lease_document', 10, null, null),
  ('dia.leases', 'rent_per_sf',       'om_extraction',  30, 0.5,  null),
  ('dia.leases', 'rent_per_sf',       'costar_sidebar', 60, null, null),

  ('dia.leases', 'leased_area',       'manual_edit',     1,  null, null),
  ('dia.leases', 'leased_area',       'lease_document', 10, null, null),
  ('dia.leases', 'leased_area',       'om_extraction',  35, 0.5,  null),
  ('dia.leases', 'leased_area',       'costar_sidebar', 65, null, null),

  ('dia.leases', 'lease_start',       'manual_edit',     1,  null, null),
  ('dia.leases', 'lease_start',       'lease_document', 10, null, null),
  ('dia.leases', 'lease_start',       'om_extraction',  35, 0.5,  null),
  ('dia.leases', 'lease_start',       'costar_sidebar', 60, null, null),

  ('dia.leases', 'lease_expiration',  'manual_edit',     1,  null, null),
  ('dia.leases', 'lease_expiration',  'lease_document', 10, null, null),
  ('dia.leases', 'lease_expiration',  'om_extraction',  35, 0.5,  null),
  ('dia.leases', 'lease_expiration',  'costar_sidebar', 60, null, null),

  ('dia.leases', 'expense_structure', 'manual_edit',     1,  null, null),
  ('dia.leases', 'expense_structure', 'lease_document', 10, null, null),
  ('dia.leases', 'expense_structure', 'om_extraction',  30, 0.5,  null),
  ('dia.leases', 'expense_structure', 'costar_sidebar', 65, null, 'CoStar lease-type panel often abbreviated/inaccurate.'),

  -- ── dia.sales_transactions ──────────────────────────────────────────────
  -- Recorded deeds (county records) win over OM/marketing data.
  ('dia.sales_transactions', 'sale_date',        'manual_edit',     1,  null, null),
  ('dia.sales_transactions', 'sale_date',        'county_records', 10, null, 'Recorded deed date.'),
  ('dia.sales_transactions', 'sale_date',        'om_extraction',  40, 0.5,  null),
  ('dia.sales_transactions', 'sale_date',        'costar_sidebar', 65, null, null),

  ('dia.sales_transactions', 'sold_price',       'manual_edit',     1,  null, null),
  ('dia.sales_transactions', 'sold_price',       'county_records', 15, null, 'Recorded deed consideration.'),
  ('dia.sales_transactions', 'sold_price',       'om_extraction',  35, 0.5,  null),
  ('dia.sales_transactions', 'sold_price',       'costar_sidebar', 60, null, null),

  ('dia.sales_transactions', 'buyer_name',       'manual_edit',     1,  null, null),
  ('dia.sales_transactions', 'buyer_name',       'county_records', 15, null, null),
  ('dia.sales_transactions', 'buyer_name',       'om_extraction',  40, 0.5,  null),
  ('dia.sales_transactions', 'buyer_name',       'costar_sidebar', 65, null, null),

  ('dia.sales_transactions', 'seller_name',      'manual_edit',     1,  null, null),
  ('dia.sales_transactions', 'seller_name',      'county_records', 15, null, null),
  ('dia.sales_transactions', 'seller_name',      'om_extraction',  40, 0.5,  null),
  ('dia.sales_transactions', 'seller_name',      'costar_sidebar', 65, null, null),

  ('dia.sales_transactions', 'stated_cap_rate',  'manual_edit',     1,  null, null),
  ('dia.sales_transactions', 'stated_cap_rate',  'om_extraction',  35, 0.5,  null),
  ('dia.sales_transactions', 'stated_cap_rate',  'costar_sidebar', 70, null, 'CoStar stated cap is provisional until rent confirmed.'),

  ('dia.sales_transactions', 'listing_broker',   'manual_edit',     1,  null, null),
  ('dia.sales_transactions', 'listing_broker',   'om_extraction',  35, 0.5,  null),
  ('dia.sales_transactions', 'listing_broker',   'costar_sidebar', 60, null, null),

  ('dia.sales_transactions', 'procuring_broker', 'manual_edit',     1,  null, null),
  ('dia.sales_transactions', 'procuring_broker', 'om_extraction',  35, 0.5,  null),
  ('dia.sales_transactions', 'procuring_broker', 'costar_sidebar', 60, null, null),

  ('dia.sales_transactions', 'transaction_type', 'manual_edit',     1,  null, null),
  ('dia.sales_transactions', 'transaction_type', 'om_extraction',  40, 0.5,  null),
  ('dia.sales_transactions', 'transaction_type', 'costar_sidebar', 65, null, null),

  -- ── gov.sales_transactions ──────────────────────────────────────────────
  ('gov.sales_transactions', 'sale_date',        'manual_edit',     1,  null, null),
  ('gov.sales_transactions', 'sale_date',        'county_records', 10, null, null),
  ('gov.sales_transactions', 'sale_date',        'om_extraction',  40, 0.5,  null),
  ('gov.sales_transactions', 'sale_date',        'costar_sidebar', 65, null, null),

  ('gov.sales_transactions', 'sold_price',       'manual_edit',     1,  null, null),
  ('gov.sales_transactions', 'sold_price',       'county_records', 15, null, null),
  ('gov.sales_transactions', 'sold_price',       'om_extraction',  35, 0.5,  null),
  ('gov.sales_transactions', 'sold_price',       'costar_sidebar', 60, null, null),

  ('gov.sales_transactions', 'buyer',            'manual_edit',     1,  null, null),
  ('gov.sales_transactions', 'buyer',            'county_records', 15, null, null),
  ('gov.sales_transactions', 'buyer',            'om_extraction',  40, 0.5,  null),
  ('gov.sales_transactions', 'buyer',            'costar_sidebar', 65, null, null),

  ('gov.sales_transactions', 'seller',           'manual_edit',     1,  null, null),
  ('gov.sales_transactions', 'seller',           'county_records', 15, null, null),
  ('gov.sales_transactions', 'seller',           'om_extraction',  40, 0.5,  null),
  ('gov.sales_transactions', 'seller',           'costar_sidebar', 65, null, null),

  ('gov.sales_transactions', 'sold_cap_rate',    'manual_edit',     1,  null, null),
  ('gov.sales_transactions', 'sold_cap_rate',    'om_extraction',  35, 0.5,  null),
  ('gov.sales_transactions', 'sold_cap_rate',    'costar_sidebar', 70, null, null),

  ('gov.sales_transactions', 'purchasing_broker','manual_edit',     1,  null, null),
  ('gov.sales_transactions', 'purchasing_broker','om_extraction',  35, 0.5,  null),
  ('gov.sales_transactions', 'purchasing_broker','costar_sidebar', 60, null, null),

  -- ── dia.contacts ────────────────────────────────────────────────────────
  -- Manual edits and Salesforce sync trump CoStar; OM-extracted broker
  -- contacts beat CoStar (OMs are signed by the broker, CoStar pages
  -- aggregate from disparate listing feeds).
  ('dia.contacts', 'contact_name', 'manual_edit',     1,  null, null),
  ('dia.contacts', 'contact_name', 'salesforce',     20, null, 'CRM source of truth.'),
  ('dia.contacts', 'contact_name', 'om_extraction',  40, 0.5,  null),
  ('dia.contacts', 'contact_name', 'costar_sidebar', 65, null, null),

  ('dia.contacts', 'email',        'manual_edit',     1,  null, null),
  ('dia.contacts', 'email',        'salesforce',     20, null, null),
  ('dia.contacts', 'email',        'om_extraction',  35, 0.5,  null),
  ('dia.contacts', 'email',        'costar_sidebar', 60, null, null),

  ('dia.contacts', 'phone',        'manual_edit',     1,  null, null),
  ('dia.contacts', 'phone',        'salesforce',     20, null, null),
  ('dia.contacts', 'phone',        'om_extraction',  40, 0.5,  null),
  ('dia.contacts', 'phone',        'costar_sidebar', 60, null, null),

  ('dia.contacts', 'role',         'manual_edit',     1,  null, null),
  ('dia.contacts', 'role',         'salesforce',     20, null, null),
  ('dia.contacts', 'role',         'om_extraction',  40, 0.5,  null),
  ('dia.contacts', 'role',         'costar_sidebar', 65, null, null),

  -- ── gov.contacts ────────────────────────────────────────────────────────
  ('gov.contacts', 'contact_name', 'manual_edit',     1,  null, null),
  ('gov.contacts', 'contact_name', 'salesforce',     20, null, null),
  ('gov.contacts', 'contact_name', 'om_extraction',  40, 0.5,  null),
  ('gov.contacts', 'contact_name', 'costar_sidebar', 65, null, null),

  ('gov.contacts', 'email',        'manual_edit',     1,  null, null),
  ('gov.contacts', 'email',        'salesforce',     20, null, null),
  ('gov.contacts', 'email',        'om_extraction',  35, 0.5,  null),
  ('gov.contacts', 'email',        'costar_sidebar', 60, null, null),

  ('gov.contacts', 'phone',        'manual_edit',     1,  null, null),
  ('gov.contacts', 'phone',        'salesforce',     20, null, null),
  ('gov.contacts', 'phone',        'om_extraction',  40, 0.5,  null),
  ('gov.contacts', 'phone',        'costar_sidebar', 60, null, null),

  ('gov.contacts', 'contact_type', 'manual_edit',     1,  null, null),
  ('gov.contacts', 'contact_type', 'salesforce',     20, null, null),
  ('gov.contacts', 'contact_type', 'om_extraction',  40, 0.5,  null),
  ('gov.contacts', 'contact_type', 'costar_sidebar', 65, null, null),

  -- ── dia.parcel_records / dia.tax_records ────────────────────────────────
  -- County records always win for parcel/tax data; CoStar's "Public Record"
  -- panel re-states county data so it should never overwrite once captured.
  ('dia.parcel_records', 'apn',            'manual_edit',     1,  null, null),
  ('dia.parcel_records', 'apn',            'county_records',  5, null, 'County source of record.'),
  ('dia.parcel_records', 'apn',            'om_extraction',  45, 0.5,  null),
  ('dia.parcel_records', 'apn',            'costar_sidebar', 55, null, 'CoStar Public Record tab.'),

  ('dia.parcel_records', 'county',         'manual_edit',     1,  null, null),
  ('dia.parcel_records', 'county',         'county_records',  5, null, null),
  ('dia.parcel_records', 'county',         'costar_sidebar', 55, null, null),

  ('dia.parcel_records', 'assessed_value', 'manual_edit',     1,  null, null),
  ('dia.parcel_records', 'assessed_value', 'county_records',  5, null, null),
  ('dia.parcel_records', 'assessed_value', 'costar_sidebar', 55, null, null),

  ('dia.tax_records',    'tax_year',       'manual_edit',     1,  null, null),
  ('dia.tax_records',    'tax_year',       'county_records',  5, null, null),
  ('dia.tax_records',    'tax_year',       'costar_sidebar', 55, null, null),

  ('dia.tax_records',    'assessed_value', 'manual_edit',     1,  null, null),
  ('dia.tax_records',    'assessed_value', 'county_records',  5, null, null),
  ('dia.tax_records',    'assessed_value', 'costar_sidebar', 55, null, null),

  -- ── gov.parcel_records / gov.tax_records ────────────────────────────────
  ('gov.parcel_records', 'apn',                   'manual_edit',     1,  null, null),
  ('gov.parcel_records', 'apn',                   'county_records',  5, null, null),
  ('gov.parcel_records', 'apn',                   'costar_sidebar', 55, null, null),

  ('gov.parcel_records', 'county',                'manual_edit',     1,  null, null),
  ('gov.parcel_records', 'county',                'county_records',  5, null, null),
  ('gov.parcel_records', 'county',                'costar_sidebar', 55, null, null),

  ('gov.parcel_records', 'land_value',            'manual_edit',     1,  null, null),
  ('gov.parcel_records', 'land_value',            'county_records',  5, null, null),
  ('gov.parcel_records', 'land_value',            'costar_sidebar', 55, null, null),

  ('gov.parcel_records', 'improvement_value',     'manual_edit',     1,  null, null),
  ('gov.parcel_records', 'improvement_value',     'county_records',  5, null, null),
  ('gov.parcel_records', 'improvement_value',     'costar_sidebar', 55, null, null),

  ('gov.parcel_records', 'total_assessed_value',  'manual_edit',     1,  null, null),
  ('gov.parcel_records', 'total_assessed_value',  'county_records',  5, null, null),
  ('gov.parcel_records', 'total_assessed_value',  'costar_sidebar', 55, null, null),

  ('gov.tax_records',    'tax_year',              'manual_edit',     1,  null, null),
  ('gov.tax_records',    'tax_year',              'county_records',  5, null, null),
  ('gov.tax_records',    'tax_year',              'costar_sidebar', 55, null, null),

  ('gov.tax_records',    'assessed_value',        'manual_edit',     1,  null, null),
  ('gov.tax_records',    'assessed_value',        'county_records',  5, null, null),
  ('gov.tax_records',    'assessed_value',        'costar_sidebar', 55, null, null)

ON CONFLICT (target_table, field_name, source) DO NOTHING;
