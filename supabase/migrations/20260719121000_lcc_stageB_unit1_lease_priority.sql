-- ============================================================================
-- Stage B Unit 1 — folder_feed_lease field-source priority (LCC Opps)
-- 2026-06-11 · written, NOT applied
--
-- Registers the lease extractor's FACTUAL writes in the provenance registry so
-- (a) they rank correctly and (b) they don't show as drift in
-- v_field_provenance_unranked. A confirmed lease abstract is high-trust: priority
-- 45 — below county_records (10) but ABOVE om_extraction (~50) and the
-- aggregator captures (costar 70 / folder_feed_properties 50). record_only mode
-- (the JS writer consults the decision; UPDATEs still run).
--
-- Per-domain field names mirror api/_handlers/lease-extractor.js LEASE_FIELD_MAP.
-- Idempotent upsert on (target_table, field_name, source).
-- ============================================================================

INSERT INTO public.field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
SELECT v.target_table, v.field_name, 'folder_feed_lease', 45, 'record_only',
       'Stage B Unit 1 — confirmed lease abstract (factual lease enrichment).'
FROM (VALUES
  -- gov.leases factual map
  ('gov.leases','tenant_agency'), ('gov.leases','guarantor'), ('gov.leases','annual_rent'),
  ('gov.leases','rent_psf'), ('gov.leases','lease_structure'), ('gov.leases','expense_structure'),
  ('gov.leases','firm_term_years'), ('gov.leases','total_term_years'),
  ('gov.leases','commencement_date'), ('gov.leases','expiration_date'), ('gov.leases','renewal_options'),
  -- dia.leases factual map
  ('dia.leases','tenant'), ('dia.leases','guarantor'), ('dia.leases','annual_rent'),
  ('dia.leases','rent_per_sf'), ('dia.leases','leased_area'), ('dia.leases','expense_structure'),
  ('dia.leases','lease_start'), ('dia.leases','lease_expiration'), ('dia.leases','renewal_options'),
  -- TI amortization schedule (both domains)
  ('gov.lease_ti_amortization','ti_excess_amount'), ('gov.lease_ti_amortization','cumulative_ti'),
  ('gov.lease_ti_amortization','burn_off_date'),
  ('dia.lease_ti_amortization','ti_excess_amount'), ('dia.lease_ti_amortization','cumulative_ti'),
  ('dia.lease_ti_amortization','burn_off_date'),
  -- the attached lease doc
  ('gov.property_documents','file_name'), ('gov.property_documents','document_type'),
  ('gov.property_documents','source_url'),
  ('dia.property_documents','file_name'), ('dia.property_documents','document_type'),
  ('dia.property_documents','source_url')
) AS v(target_table, field_name)
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET priority = EXCLUDED.priority, enforce_mode = EXCLUDED.enforce_mode,
      notes = EXCLUDED.notes, updated_at = now();
