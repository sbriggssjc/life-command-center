-- Round 76ej.r priority registry — gov.leases sidebar provenance.
-- The sidebar pipeline's upsertGovernmentLeases now records
-- field_provenance per row (one per tenant on multi-tenant
-- buildings). Without these rules every gov.leases costar_sidebar
-- write would show up in v_field_provenance_unranked as schema
-- drift. The columns + priorities mirror dia.leases rules from
-- migration 20260426110000_field_source_priority_phase_22b_extension.sql:
--
--   manual_edit       priority 1   (highest trust)
--   lease_document   priority 10  (signed copy)
--   om_extraction    priority 30  (broker OM PDF)
--   excel_master     priority 40  (the GSA IOLP / state master lease feed)
--   costar_sidebar   priority 60-70 (aggregator-quality, default 0.6 conf)
--
-- All entries land in record_only mode initially so the existing
-- write paths run unchanged; flipping to warn / strict is a
-- separate Phase 3-style migration after observation.

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  -- ── gov.leases ─────────────────────────────────────────────────────────
  ('gov.leases', 'tenant_agency',      'manual_edit',    1,  null, null),
  ('gov.leases', 'tenant_agency',      'excel_master',  10,  null, 'GSA IOLP master-lease feed — canonical agency name.'),
  ('gov.leases', 'tenant_agency',      'om_extraction', 30,  0.5,  null),
  ('gov.leases', 'tenant_agency',      'costar_sidebar',60,  null, 'CoStar / CREXi tenant prose — multi-tenant fan-out.'),

  ('gov.leases', 'tenant_agency_full', 'manual_edit',    1,  null, null),
  ('gov.leases', 'tenant_agency_full', 'excel_master',  10,  null, null),
  ('gov.leases', 'tenant_agency_full', 'om_extraction', 30,  0.5,  null),
  ('gov.leases', 'tenant_agency_full', 'costar_sidebar',60,  null, null),

  ('gov.leases', 'government_type',    'manual_edit',    1,  null, null),
  ('gov.leases', 'government_type',    'excel_master',  10,  null, null),
  ('gov.leases', 'government_type',    'om_extraction', 30,  0.5,  null),
  ('gov.leases', 'government_type',    'costar_sidebar',65,  null, null),

  ('gov.leases', 'commencement_date',  'manual_edit',    1,  null, null),
  ('gov.leases', 'commencement_date',  'lease_document',10,  null, null),
  ('gov.leases', 'commencement_date',  'excel_master',  20,  null, null),
  ('gov.leases', 'commencement_date',  'om_extraction', 35,  0.5,  null),
  ('gov.leases', 'commencement_date',  'costar_sidebar',60,  null, null),

  ('gov.leases', 'expiration_date',    'manual_edit',    1,  null, null),
  ('gov.leases', 'expiration_date',    'lease_document',10,  null, null),
  ('gov.leases', 'expiration_date',    'excel_master',  20,  null, null),
  ('gov.leases', 'expiration_date',    'om_extraction', 35,  0.5,  null),
  ('gov.leases', 'expiration_date',    'costar_sidebar',60,  null, null),

  ('gov.leases', 'annual_rent',        'manual_edit',    1,  null, null),
  ('gov.leases', 'annual_rent',        'lease_document',10,  null, null),
  ('gov.leases', 'annual_rent',        'excel_master',  15,  null, 'GSA IOLP rent — authoritative when present.'),
  ('gov.leases', 'annual_rent',        'om_extraction', 30,  0.5,  null),
  ('gov.leases', 'annual_rent',        'costar_sidebar',70,  null, 'CoStar/CREXi rent — aggregator quality.'),

  ('gov.leases', 'rent_psf',           'manual_edit',    1,  null, null),
  ('gov.leases', 'rent_psf',           'lease_document',10,  null, null),
  ('gov.leases', 'rent_psf',           'excel_master',  15,  null, null),
  ('gov.leases', 'rent_psf',           'om_extraction', 30,  0.5,  null),
  ('gov.leases', 'rent_psf',           'costar_sidebar',60,  null, null),

  ('gov.leases', 'expense_structure',  'manual_edit',    1,  null, null),
  ('gov.leases', 'expense_structure',  'lease_document',10,  null, null),
  ('gov.leases', 'expense_structure',  'om_extraction', 30,  0.5,  null),
  ('gov.leases', 'expense_structure',  'costar_sidebar',60,  null, null),

  ('gov.leases', 'renewal_options',    'manual_edit',    1,  null, null),
  ('gov.leases', 'renewal_options',    'lease_document',10,  null, null),
  ('gov.leases', 'renewal_options',    'om_extraction', 30,  0.5,  null),
  ('gov.leases', 'renewal_options',    'costar_sidebar',60,  null, null)

ON CONFLICT (target_table, field_name, source) DO NOTHING;

-- Audit: should be 0 after this migration runs and the next gov-leases
-- ingest fires (Mast One re-capture, an EPA Houston re-capture, etc.):
--
--   SELECT count(*) FROM v_field_provenance_unranked
--   WHERE target_table = 'gov.leases';
