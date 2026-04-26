-- ============================================================================
-- Migration: Phase 2.2 extension to field_source_priority registry
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Adds priority entries for the additional fields the CoStar sidebar
-- instrumentation now records (Phase 2.2.a, sidebar-pipeline.js
-- propagateToDomainDbDirect):
--   - dia.properties.{city,state,zip_code,land_acres,building_size}
--   - gov.properties.rba
--   - dia.available_listings.{last_price,listing_broker,broker_email,seller_name,listing_date}
--
-- Same priority bands as the original Phase 1 seed:
--   1-19   = hard authoritative (manual edits, county records of record)
--   20-39  = primary trusted (signed leases, OM source-of-truth)
--   40-59  = secondary trusted (OM extraction by AI, lease abstracts)
--   60-79  = aggregator/scraper (CoStar, LoopNet, broker flyers)
--
-- See docs/architecture/data_quality_self_learning_loop.md for the full
-- rollout plan and supabase/migrations/20260425210000_lcc_field_provenance_and_priority.sql
-- for the Phase 1 schema.
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  ('dia.properties', 'city',  'manual_edit',    1,  null, 'Explicit human override.'),
  ('dia.properties', 'city',  'county_records', 10, null, 'County tax records.'),
  ('dia.properties', 'city',  'om_extraction',  50, 0.5,  'OM-stated city.'),
  ('dia.properties', 'city',  'costar_sidebar', 65, null, 'CoStar city.'),

  ('dia.properties', 'state', 'manual_edit',    1,  null, null),
  ('dia.properties', 'state', 'county_records', 10, null, null),
  ('dia.properties', 'state', 'om_extraction',  50, 0.5,  null),
  ('dia.properties', 'state', 'costar_sidebar', 65, null, null),

  ('dia.properties', 'zip_code', 'manual_edit',    1,  null, null),
  ('dia.properties', 'zip_code', 'county_records', 10, null, null),
  ('dia.properties', 'zip_code', 'om_extraction',  50, 0.5,  null),
  ('dia.properties', 'zip_code', 'costar_sidebar', 65, null, null),

  ('dia.properties', 'land_acres', 'manual_edit',    1,  null, null),
  ('dia.properties', 'land_acres', 'county_records', 10, null, 'County parcel acreage.'),
  ('dia.properties', 'land_acres', 'om_extraction',  50, 0.5,  null),
  ('dia.properties', 'land_acres', 'costar_sidebar', 65, null, null),

  ('dia.properties', 'building_size', 'manual_edit',    1,  null, null),
  ('dia.properties', 'building_size', 'county_records', 15, null, 'County tax record.'),
  ('dia.properties', 'building_size', 'om_extraction',  40, 0.5,  'OM rentable SF.'),
  ('dia.properties', 'building_size', 'costar_sidebar', 65, null, null),

  ('gov.properties', 'rba', 'manual_edit',    1,  null, null),
  ('gov.properties', 'rba', 'county_records', 15, null, null),
  ('gov.properties', 'rba', 'om_extraction',  40, 0.5,  null),
  ('gov.properties', 'rba', 'costar_sidebar', 65, null, null),

  ('dia.available_listings', 'last_price',     'manual_edit',    1,  null, null),
  ('dia.available_listings', 'last_price',     'om_extraction',  25, 0.5,  null),
  ('dia.available_listings', 'last_price',     'costar_sidebar', 60, null, null),
  ('dia.available_listings', 'last_price',     'loopnet',        70, null, null),

  ('dia.available_listings', 'listing_broker', 'manual_edit',    1,  null, null),
  ('dia.available_listings', 'listing_broker', 'om_extraction',  30, 0.5,  null),
  ('dia.available_listings', 'listing_broker', 'costar_sidebar', 60, null, null),

  ('dia.available_listings', 'broker_email',   'manual_edit',    1,  null, null),
  ('dia.available_listings', 'broker_email',   'om_extraction',  30, 0.5,  null),
  ('dia.available_listings', 'broker_email',   'costar_sidebar', 60, null, null),

  ('dia.available_listings', 'seller_name',    'manual_edit',    1,  null, null),
  ('dia.available_listings', 'seller_name',    'om_extraction',  30, 0.5,  null),
  ('dia.available_listings', 'seller_name',    'costar_sidebar', 60, null, null),

  ('dia.available_listings', 'listing_date',   'manual_edit',    1,  null, null),
  ('dia.available_listings', 'listing_date',   'om_extraction',  40, 0.5,  null),
  ('dia.available_listings', 'listing_date',   'costar_sidebar', 50, null, 'CoStar tracks listing-date changes more reliably.')

ON CONFLICT (target_table, field_name, source) DO NOTHING;
