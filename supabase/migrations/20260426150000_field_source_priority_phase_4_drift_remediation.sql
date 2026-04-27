-- ============================================================================
-- Migration: Phase 4 drift remediation — seed priority for fields the
-- v_field_provenance_unranked view surfaced.
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- The schema-drift detector (v_field_provenance_unranked) found 20
-- (target_table, field_name, source) triples that had been writing to
-- field_provenance but were never registered in field_source_priority.
-- This migration adds the missing rules so every CoStar / OM field write
-- is now governed.
--
-- Pattern follows existing bands:
--   1     manual_edit    (always wins)
--   10    lease_document (signed lease)
--   20    salesforce     (CRM source of truth for contacts)
--   30-45 om_extraction  (AI-extracted from OM)
--   55-70 costar_sidebar (CoStar aggregator)
--
-- All entries default to enforce_mode=record_only — this is observation
-- only. Phase 3 already flipped a starter set of safer rules to `warn`.
--
-- After this migration, v_field_provenance_unranked should return 0 rows
-- (no active unranked writes in the last 30 days).
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  -- Lease responsibility fields (NNN allocation matrix)
  ('dia.leases', 'renewal_options',         'manual_edit',     1,  null, null),
  ('dia.leases', 'renewal_options',         'lease_document', 10, null, null),
  ('dia.leases', 'renewal_options',         'om_extraction',  35, 0.5,  null),
  ('dia.leases', 'renewal_options',         'costar_sidebar', 65, null, null),

  ('dia.leases', 'roof_responsibility',     'manual_edit',     1,  null, null),
  ('dia.leases', 'roof_responsibility',     'lease_document', 10, null, null),
  ('dia.leases', 'roof_responsibility',     'om_extraction',  35, 0.5,  null),
  ('dia.leases', 'roof_responsibility',     'costar_sidebar', 65, null, null),

  ('dia.leases', 'structure_responsibility','manual_edit',     1,  null, null),
  ('dia.leases', 'structure_responsibility','lease_document', 10, null, null),
  ('dia.leases', 'structure_responsibility','om_extraction',  35, 0.5,  null),
  ('dia.leases', 'structure_responsibility','costar_sidebar', 65, null, null),

  ('dia.leases', 'hvac_responsibility',     'manual_edit',     1,  null, null),
  ('dia.leases', 'hvac_responsibility',     'lease_document', 10, null, null),
  ('dia.leases', 'hvac_responsibility',     'om_extraction',  35, 0.5,  null),
  ('dia.leases', 'hvac_responsibility',     'costar_sidebar', 65, null, null),

  ('dia.leases', 'parking_responsibility',  'manual_edit',     1,  null, null),
  ('dia.leases', 'parking_responsibility',  'lease_document', 10, null, null),
  ('dia.leases', 'parking_responsibility',  'om_extraction',  35, 0.5,  null),
  ('dia.leases', 'parking_responsibility',  'costar_sidebar', 65, null, null),

  ('dia.leases', 'guarantor',               'manual_edit',     1,  null, null),
  ('dia.leases', 'guarantor',               'lease_document', 10, null, null),
  ('dia.leases', 'guarantor',               'om_extraction',  35, 0.5,  null),
  ('dia.leases', 'guarantor',               'costar_sidebar', 65, null, null),

  -- Contact extras
  ('dia.contacts', 'title',                 'manual_edit',     1,  null, null),
  ('dia.contacts', 'title',                 'salesforce',     20, null, null),
  ('dia.contacts', 'title',                 'om_extraction',  40, 0.5,  null),
  ('dia.contacts', 'title',                 'costar_sidebar', 65, null, null),

  ('dia.contacts', 'company',               'manual_edit',     1,  null, null),
  ('dia.contacts', 'company',               'salesforce',     20, null, null),
  ('dia.contacts', 'company',               'om_extraction',  40, 0.5,  null),
  ('dia.contacts', 'company',               'costar_sidebar', 65, null, null),

  ('dia.contacts', 'contact_email',         'manual_edit',     1,  null, null),
  ('dia.contacts', 'contact_email',         'salesforce',     20, null, null),
  ('dia.contacts', 'contact_email',         'om_extraction',  35, 0.5,  null),
  ('dia.contacts', 'contact_email',         'costar_sidebar', 60, null, null),

  ('gov.contacts', 'title',                 'manual_edit',     1,  null, null),
  ('gov.contacts', 'title',                 'salesforce',     20, null, null),
  ('gov.contacts', 'title',                 'om_extraction',  40, 0.5,  null),
  ('gov.contacts', 'title',                 'costar_sidebar', 65, null, null),

  ('gov.contacts', 'company',               'manual_edit',     1,  null, null),
  ('gov.contacts', 'company',               'salesforce',     20, null, null),
  ('gov.contacts', 'company',               'om_extraction',  40, 0.5,  null),
  ('gov.contacts', 'company',               'costar_sidebar', 65, null, null),

  ('gov.contacts', 'contact_email',         'manual_edit',     1,  null, null),
  ('gov.contacts', 'contact_email',         'salesforce',     20, null, null),
  ('gov.contacts', 'contact_email',         'om_extraction',  35, 0.5,  null),
  ('gov.contacts', 'contact_email',         'costar_sidebar', 60, null, null),

  -- Listing cap rates
  ('dia.available_listings', 'current_cap_rate', 'manual_edit',     1,  null, null),
  ('dia.available_listings', 'current_cap_rate', 'om_extraction',  30, 0.5,  null),
  ('dia.available_listings', 'current_cap_rate', 'costar_sidebar', 65, null, null),

  ('dia.available_listings', 'initial_cap_rate', 'manual_edit',     1,  null, null),
  ('dia.available_listings', 'initial_cap_rate', 'om_extraction',  30, 0.5,  null),
  ('dia.available_listings', 'initial_cap_rate', 'costar_sidebar', 65, null, null),

  ('dia.available_listings', 'price_per_sf',     'manual_edit',     1,  null, null),
  ('dia.available_listings', 'price_per_sf',     'om_extraction',  30, 0.5,  null),
  ('dia.available_listings', 'price_per_sf',     'costar_sidebar', 65, null, null),

  ('gov.available_listings', 'listing_broker',   'manual_edit',     1,  null, null),
  ('gov.available_listings', 'listing_broker',   'om_extraction',  30, 0.5,  null),
  ('gov.available_listings', 'listing_broker',   'costar_sidebar', 60, null, null),

  ('gov.available_listings', 'broker_email',     'manual_edit',     1,  null, null),
  ('gov.available_listings', 'broker_email',     'om_extraction',  30, 0.5,  null),
  ('gov.available_listings', 'broker_email',     'costar_sidebar', 60, null, null),

  -- Property fields tied to anchor rent and lease commencement
  ('dia.properties', 'lease_commencement', 'manual_edit',     1,  null, null),
  ('dia.properties', 'lease_commencement', 'lease_document', 10, null, null),
  ('dia.properties', 'lease_commencement', 'om_extraction',  35, 0.5,  null),
  ('dia.properties', 'lease_commencement', 'costar_sidebar', 65, null, null),

  ('dia.properties', 'anchor_rent',        'manual_edit',     1,  null, null),
  ('dia.properties', 'anchor_rent',        'lease_document', 10, null, 'Confirmed by signed lease.'),
  ('dia.properties', 'anchor_rent',        'om_extraction',  30, 0.5,  null),
  ('dia.properties', 'anchor_rent',        'costar_sidebar', 65, null, null),

  ('dia.properties', 'anchor_rent_date',   'manual_edit',     1,  null, null),
  ('dia.properties', 'anchor_rent_date',   'lease_document', 10, null, null),
  ('dia.properties', 'anchor_rent_date',   'om_extraction',  30, 0.5,  null),
  ('dia.properties', 'anchor_rent_date',   'costar_sidebar', 65, null, null)

ON CONFLICT (target_table, field_name, source) DO NOTHING;
