// ============================================================================
// Prompt 78 (W8 U4) — PGRST204 schema-drift guard.
//
// The U4 audit's #1 critical cluster was ~7k silently-lost domain writes: a
// writer sent field(s) the target table lacks, PostgREST 400'd (PGRST204
// "Could not find the '<col>' column ... in the schema cache"), and the write
// vanished. This module is the single source of truth that lets a test catch
// the next drift BEFORE it reaches production:
//
//   * PINNED_DOMAIN_COLUMNS — a snapshot of the LIVE columns (post-fix) for
//     every domain table the U4 cluster touched. Refresh from
//     information_schema.columns when the schema legitimately changes.
//   * WRITER_COLUMN_SETS — the exact field set each fixed writer emits, keyed
//     by "<file>:<function>[:<domain>]".
//
// test/pgrst204-schema-drift.test.mjs asserts every writer set is a subset of
// its table's pinned columns. A writer field that isn't a real column breaks
// the test instead of losing a write.
// ============================================================================

// --- Pinned live schema (public.*), snapshot 2026-08-08 after Prompt 78 -------
export const PINNED_DOMAIN_COLUMNS = {
  'dia.property_documents': [
    'content_hash', 'created_at', 'document_id', 'document_type', 'extracted_data',
    'file_id', 'file_name', 'ingestion_status', 'property_id', 'raw_text',
    'sale_id', 'source', 'source_url', 'storage_bucket', 'storage_path',
  ],
  'gov.property_documents': [
    'content_hash', 'created_at', 'document_id', 'document_type', 'extracted_data',
    'file_name', 'ingestion_status', 'property_id', 'raw_text', 'sale_id',
    'source', 'source_url', 'storage_bucket', 'storage_path',
  ],
  'dia.properties': [
    // Only the columns the guarded writer touches are asserted; the pinned set
    // lists the ones relevant to Prompt 78. `last_ingested_at` added this round.
    'property_id', 'last_ingested_at', 'source', 'updated_at',
  ],
  'dia.sales_transactions': [
    'sale_id', 'property_id', 'sale_date', 'sold_price', 'listing_sale_id',
    'data_source', 'transaction_state', 'notes', 'updated_at',
  ],
  'dia.lease_escalations': [
    'annualized_escalation_percent', 'calculated_rent_flag', 'data_source',
    'effective_date', 'end_date', 'escalation_frequency_years', 'escalation_id',
    'escalation_source', 'escalation_type', 'escalation_unit', 'escalation_value',
    'expense_structure', 'flat_increase_amount', 'increase_interval_years',
    'lease_id', 'property_id', 'raw_escalation_text', 'rent_amount',
    'rent_estimate_psf', 'rent_high_psf', 'rent_low_psf', 'start_date',
  ],
  'dia.alerts_unified': [
    'alert_id', 'entity_type', 'entity_id', 'property_id', 'medicare_id',
    'true_owner_id', 'alert_type', 'alert_reason', 'priority', 'triggered_date',
    'alert_date', 'created_at', 'resolved', 'resolved_at', 'resolved_by',
    'source', 'source_file', 'change_source', 'notes', 'suggested_action', 'metadata',
  ],
  'dia.contacts': [
    'contact_id', 'contact_name', 'contact_email', 'contact_phone', 'company',
    'title', 'role', 'notes', 'sf_contact_id', 'contact_fields_synced_at',
    'true_owner_id', 'recorded_owner_id', 'property_id', 'data_source',
    'sale_id', 'sale_role', 'updated_at',
  ],
  'gov.contacts': [
    'address', 'avg_cap_rate', 'canonical_name', 'city', 'company', 'contact_id',
    'contact_type', 'created_at', 'data_source', 'email', 'entity_type',
    'first_transaction', 'is_1031_buyer', 'last_transaction', 'name',
    'normalized_name', 'notes', 'phone', 'property_id', 'recorded_owner_id',
    'sale_id', 'sale_role', 'sf_account_id', 'sf_contact_id', 'sf_last_synced',
    'sf_lead_id', 'state', 'title', 'total_transactions', 'total_volume',
    'true_owner_id', 'updated_at', 'website',
  ],
  'dia.available_listings': [
    'listing_id', 'property_id', 'listing_broker', 'initial_price', 'last_price',
    'status', 'off_market_date', 'listing_date', 'seller_name', 'notes',
    'data_source', 'on_market_date',
  ],
};

// --- The field set each fixed writer emits ------------------------------------
export const WRITER_COLUMN_SETS = {
  // property_documents.source (dia+gov 6,759/30d) — writers request `source`
  // as their preferred payload; the column now exists so the write succeeds.
  'intake-promoter.js:attachEnrichDocument': {
    table: 'dia.property_documents',
    columns: ['property_id', 'file_name', 'document_type', 'source_url', 'ingestion_status', 'source'],
  },
  'intake-promoter.js:attachEnrichDocument:gov': {
    table: 'gov.property_documents',
    columns: ['property_id', 'file_name', 'document_type', 'source_url', 'ingestion_status', 'source'],
  },
  'property-doc-writeback.js:insertLccDocument': {
    table: 'dia.property_documents',
    columns: ['property_id', 'file_name', 'document_type', 'source_url', 'ingestion_status', 'source'],
  },
  // properties.last_ingested_at (dia 713/30d)
  'sidebar-pipeline.js:propagateToDomainDbDirect:last_ingested_at': {
    table: 'dia.properties',
    columns: ['last_ingested_at'],
  },
  // sales_transactions.listing_sale_id (dia 645/30d)
  'sidebar-pipeline.js:backfillListingSaleIdForListing': {
    table: 'dia.sales_transactions',
    columns: ['listing_sale_id'],
  },
  // lease_escalations CoStar rent band (dia 121/30d)
  'sidebar-pipeline.js:upsertLeaseEscalations': {
    table: 'dia.lease_escalations',
    columns: [
      'lease_id', 'property_id', 'rent_low_psf', 'rent_high_psf', 'rent_estimate_psf',
      'expense_structure', 'escalation_source', 'data_source', 'effective_date',
    ],
  },
  // alerts_unified new-sale alert (dia 61/30d) — remapped to real columns
  'sidebar-pipeline.js:createSaleAlert': {
    table: 'dia.alerts_unified',
    columns: ['entity_type', 'entity_id', 'property_id', 'alert_type', 'priority', 'alert_reason', 'source', 'resolved', 'created_at'],
  },
  // contacts SF-link stamp (dia 5/30d) — domain-gated stamp column
  'intake-promoter.js:linkDomainContactSf:dia': {
    table: 'dia.contacts',
    columns: ['sf_contact_id', 'contact_fields_synced_at'],
  },
  'intake-promoter.js:linkDomainContactSf:gov': {
    table: 'gov.contacts',
    columns: ['sf_contact_id', 'sf_last_synced'],
  },
  // available_listings misroute (dia 2/30d) — list_price → last_price
  'sidebar-pipeline.js:routeListingMisroute': {
    table: 'dia.available_listings',
    columns: ['property_id', 'last_price', 'status', 'notes', 'data_source'],
  },
};
