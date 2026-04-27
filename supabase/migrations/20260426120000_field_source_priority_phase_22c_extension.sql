-- ============================================================================
-- Migration: Phase 2.2.c extension to field_source_priority registry
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Adds priority entries for the per-row provenance now recorded by the
-- remaining lower-priority CoStar sidebar writers (sidebar-pipeline.js
-- Phase 2.2.c instrumentation):
--   - dia.recorded_owners.{name,normalized_name,address,city,state}
--   - gov.recorded_owners.{name,canonical_name}
--   - dia.ownership_history.{ownership_start,ownership_end,sold_price}
--   - gov.ownership_history.{transfer_date,transfer_price,new_owner,prior_owner}
--   - dia.brokers.{broker_name,email,phone,company}
--   - gov.brokers.{name,firm,email,phone}
--   - dia.deed_records.{document_number,deed_type,grantor,grantee,
--                       recording_date,consideration}
--   - gov.deed_records.{document_number,deed_type,grantor,grantee,
--                       recording_date,consideration}
--   - dia.loans.{lender_name,loan_amount,loan_type,origination_date,
--                maturity_date,interest_rate_percent}
--   - gov.loans.{loan_amount,loan_type,origination_date,interest_rate}
--   - dia.property_documents.{file_name,document_type,source_url}
--   - gov.property_documents.{file_name,document_type,source_url}
--
-- Same priority bands as the original Phase 1 seed:
--   1-19   = hard authoritative (manual edits, county records of record)
--   20-39  = primary trusted (signed leases, OM source-of-truth, Salesforce)
--   40-59  = secondary trusted (OM extraction by AI)
--   60-79  = aggregator/scraper (CoStar, LoopNet)
--
-- Deed/recorded_owners/ownership_history records strongly favor county_records
-- because that's the legal source of record. CoStar carries a copy that may
-- lag the actual deed by days/weeks.
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  -- dia.recorded_owners
  ('dia.recorded_owners', 'name',            'manual_edit',     1,  null, null),
  ('dia.recorded_owners', 'name',            'county_records',  5,  null, 'County recorder of record.'),
  ('dia.recorded_owners', 'name',            'om_extraction',   45, 0.5,  null),
  ('dia.recorded_owners', 'name',            'costar_sidebar',  60, null, null),
  ('dia.recorded_owners', 'normalized_name', 'manual_edit',     1,  null, null),
  ('dia.recorded_owners', 'normalized_name', 'county_records',  5,  null, null),
  ('dia.recorded_owners', 'normalized_name', 'costar_sidebar',  60, null, null),
  ('dia.recorded_owners', 'address',         'manual_edit',     1,  null, null),
  ('dia.recorded_owners', 'address',         'county_records',  5,  null, null),
  ('dia.recorded_owners', 'address',         'costar_sidebar',  60, null, null),
  ('dia.recorded_owners', 'city',            'manual_edit',     1,  null, null),
  ('dia.recorded_owners', 'city',            'county_records',  5,  null, null),
  ('dia.recorded_owners', 'city',            'costar_sidebar',  60, null, null),
  ('dia.recorded_owners', 'state',           'manual_edit',     1,  null, null),
  ('dia.recorded_owners', 'state',           'county_records',  5,  null, null),
  ('dia.recorded_owners', 'state',           'costar_sidebar',  60, null, null),

  -- gov.recorded_owners
  ('gov.recorded_owners', 'name',            'manual_edit',     1,  null, null),
  ('gov.recorded_owners', 'name',            'county_records',  5,  null, null),
  ('gov.recorded_owners', 'name',            'om_extraction',   45, 0.5,  null),
  ('gov.recorded_owners', 'name',            'costar_sidebar',  60, null, null),
  ('gov.recorded_owners', 'canonical_name',  'manual_edit',     1,  null, null),
  ('gov.recorded_owners', 'canonical_name',  'county_records',  5,  null, null),
  ('gov.recorded_owners', 'canonical_name',  'costar_sidebar',  60, null, null),

  -- dia.ownership_history
  ('dia.ownership_history', 'ownership_start', 'manual_edit',     1,  null, null),
  ('dia.ownership_history', 'ownership_start', 'county_records',  5,  null, null),
  ('dia.ownership_history', 'ownership_start', 'costar_sidebar',  60, null, null),
  ('dia.ownership_history', 'ownership_end',   'manual_edit',     1,  null, null),
  ('dia.ownership_history', 'ownership_end',   'county_records',  5,  null, null),
  ('dia.ownership_history', 'ownership_end',   'costar_sidebar',  60, null, null),
  ('dia.ownership_history', 'sold_price',      'manual_edit',     1,  null, null),
  ('dia.ownership_history', 'sold_price',      'county_records',  5,  null, null),
  ('dia.ownership_history', 'sold_price',      'costar_sidebar',  60, null, null),

  -- gov.ownership_history
  ('gov.ownership_history', 'transfer_date',   'manual_edit',     1,  null, null),
  ('gov.ownership_history', 'transfer_date',   'county_records',  5,  null, null),
  ('gov.ownership_history', 'transfer_date',   'costar_sidebar',  60, null, null),
  ('gov.ownership_history', 'transfer_price',  'manual_edit',     1,  null, null),
  ('gov.ownership_history', 'transfer_price',  'county_records',  5,  null, null),
  ('gov.ownership_history', 'transfer_price',  'costar_sidebar',  60, null, null),
  ('gov.ownership_history', 'new_owner',       'manual_edit',     1,  null, null),
  ('gov.ownership_history', 'new_owner',       'county_records',  5,  null, null),
  ('gov.ownership_history', 'new_owner',       'costar_sidebar',  60, null, null),
  ('gov.ownership_history', 'prior_owner',     'manual_edit',     1,  null, null),
  ('gov.ownership_history', 'prior_owner',     'county_records',  5,  null, null),
  ('gov.ownership_history', 'prior_owner',     'costar_sidebar',  60, null, null),

  -- dia.brokers
  ('dia.brokers', 'broker_name',     'manual_edit',     1,  null, null),
  ('dia.brokers', 'broker_name',     'salesforce',     20,  null, null),
  ('dia.brokers', 'broker_name',     'om_extraction',   45, 0.5,  null),
  ('dia.brokers', 'broker_name',     'costar_sidebar',  60, null, null),
  ('dia.brokers', 'email',           'manual_edit',     1,  null, null),
  ('dia.brokers', 'email',           'salesforce',     20,  null, null),
  ('dia.brokers', 'email',           'om_extraction',   40, 0.5,  null),
  ('dia.brokers', 'email',           'costar_sidebar',  60, null, null),
  ('dia.brokers', 'phone',           'manual_edit',     1,  null, null),
  ('dia.brokers', 'phone',           'salesforce',     20,  null, null),
  ('dia.brokers', 'phone',           'costar_sidebar',  60, null, null),
  ('dia.brokers', 'company',         'manual_edit',     1,  null, null),
  ('dia.brokers', 'company',         'salesforce',     20,  null, null),
  ('dia.brokers', 'company',         'om_extraction',   40, 0.5,  null),
  ('dia.brokers', 'company',         'costar_sidebar',  60, null, null),

  -- gov.brokers
  ('gov.brokers', 'name',            'manual_edit',     1,  null, null),
  ('gov.brokers', 'name',            'salesforce',     20,  null, null),
  ('gov.brokers', 'name',            'om_extraction',   45, 0.5,  null),
  ('gov.brokers', 'name',            'costar_sidebar',  60, null, null),
  ('gov.brokers', 'firm',            'manual_edit',     1,  null, null),
  ('gov.brokers', 'firm',            'salesforce',     20,  null, null),
  ('gov.brokers', 'firm',            'costar_sidebar',  60, null, null),
  ('gov.brokers', 'email',           'manual_edit',     1,  null, null),
  ('gov.brokers', 'email',           'salesforce',     20,  null, null),
  ('gov.brokers', 'email',           'costar_sidebar',  60, null, null),
  ('gov.brokers', 'phone',           'manual_edit',     1,  null, null),
  ('gov.brokers', 'phone',           'salesforce',     20,  null, null),
  ('gov.brokers', 'phone',           'costar_sidebar',  60, null, null),

  -- dia.deed_records / gov.deed_records (immutable - county records always trump)
  ('dia.deed_records', 'document_number', 'manual_edit',     1,  null, null),
  ('dia.deed_records', 'document_number', 'county_records',  5,  null, null),
  ('dia.deed_records', 'document_number', 'costar_sidebar',  55, null, null),
  ('dia.deed_records', 'deed_type',       'manual_edit',     1,  null, null),
  ('dia.deed_records', 'deed_type',       'county_records',  5,  null, null),
  ('dia.deed_records', 'deed_type',       'costar_sidebar',  55, null, null),
  ('dia.deed_records', 'grantor',         'manual_edit',     1,  null, null),
  ('dia.deed_records', 'grantor',         'county_records',  5,  null, null),
  ('dia.deed_records', 'grantor',         'costar_sidebar',  55, null, null),
  ('dia.deed_records', 'grantee',         'manual_edit',     1,  null, null),
  ('dia.deed_records', 'grantee',         'county_records',  5,  null, null),
  ('dia.deed_records', 'grantee',         'costar_sidebar',  55, null, null),
  ('dia.deed_records', 'recording_date',  'manual_edit',     1,  null, null),
  ('dia.deed_records', 'recording_date',  'county_records',  5,  null, null),
  ('dia.deed_records', 'recording_date',  'costar_sidebar',  55, null, null),
  ('dia.deed_records', 'consideration',   'manual_edit',     1,  null, null),
  ('dia.deed_records', 'consideration',   'county_records',  5,  null, null),
  ('dia.deed_records', 'consideration',   'costar_sidebar',  55, null, null),

  ('gov.deed_records', 'document_number', 'manual_edit',     1,  null, null),
  ('gov.deed_records', 'document_number', 'county_records',  5,  null, null),
  ('gov.deed_records', 'document_number', 'costar_sidebar',  55, null, null),
  ('gov.deed_records', 'deed_type',       'manual_edit',     1,  null, null),
  ('gov.deed_records', 'deed_type',       'county_records',  5,  null, null),
  ('gov.deed_records', 'deed_type',       'costar_sidebar',  55, null, null),
  ('gov.deed_records', 'grantor',         'manual_edit',     1,  null, null),
  ('gov.deed_records', 'grantor',         'county_records',  5,  null, null),
  ('gov.deed_records', 'grantor',         'costar_sidebar',  55, null, null),
  ('gov.deed_records', 'grantee',         'manual_edit',     1,  null, null),
  ('gov.deed_records', 'grantee',         'county_records',  5,  null, null),
  ('gov.deed_records', 'grantee',         'costar_sidebar',  55, null, null),
  ('gov.deed_records', 'recording_date',  'manual_edit',     1,  null, null),
  ('gov.deed_records', 'recording_date',  'county_records',  5,  null, null),
  ('gov.deed_records', 'recording_date',  'costar_sidebar',  55, null, null),
  ('gov.deed_records', 'consideration',   'manual_edit',     1,  null, null),
  ('gov.deed_records', 'consideration',   'county_records',  5,  null, null),
  ('gov.deed_records', 'consideration',   'costar_sidebar',  55, null, null),

  -- dia.loans / gov.loans
  ('dia.loans', 'lender_name',           'manual_edit',     1,  null, null),
  ('dia.loans', 'lender_name',           'county_records',  10, null, null),
  ('dia.loans', 'lender_name',           'om_extraction',   35, 0.5,  null),
  ('dia.loans', 'lender_name',           'costar_sidebar',  60, null, null),
  ('dia.loans', 'loan_amount',           'manual_edit',     1,  null, null),
  ('dia.loans', 'loan_amount',           'county_records',  10, null, null),
  ('dia.loans', 'loan_amount',           'om_extraction',   35, 0.5,  null),
  ('dia.loans', 'loan_amount',           'costar_sidebar',  60, null, null),
  ('dia.loans', 'loan_type',             'manual_edit',     1,  null, null),
  ('dia.loans', 'loan_type',             'om_extraction',   40, 0.5,  null),
  ('dia.loans', 'loan_type',             'costar_sidebar',  60, null, null),
  ('dia.loans', 'origination_date',      'manual_edit',     1,  null, null),
  ('dia.loans', 'origination_date',      'county_records',  10, null, null),
  ('dia.loans', 'origination_date',      'costar_sidebar',  60, null, null),
  ('dia.loans', 'maturity_date',         'manual_edit',     1,  null, null),
  ('dia.loans', 'maturity_date',         'om_extraction',   30, 0.5,  null),
  ('dia.loans', 'maturity_date',         'costar_sidebar',  60, null, null),
  ('dia.loans', 'interest_rate_percent', 'manual_edit',     1,  null, null),
  ('dia.loans', 'interest_rate_percent', 'om_extraction',   30, 0.5,  null),
  ('dia.loans', 'interest_rate_percent', 'costar_sidebar',  65, null, null),

  ('gov.loans', 'loan_amount',           'manual_edit',     1,  null, null),
  ('gov.loans', 'loan_amount',           'county_records',  10, null, null),
  ('gov.loans', 'loan_amount',           'om_extraction',   35, 0.5,  null),
  ('gov.loans', 'loan_amount',           'costar_sidebar',  60, null, null),
  ('gov.loans', 'loan_type',             'manual_edit',     1,  null, null),
  ('gov.loans', 'loan_type',             'om_extraction',   40, 0.5,  null),
  ('gov.loans', 'loan_type',             'costar_sidebar',  60, null, null),
  ('gov.loans', 'origination_date',      'manual_edit',     1,  null, null),
  ('gov.loans', 'origination_date',      'county_records',  10, null, null),
  ('gov.loans', 'origination_date',      'costar_sidebar',  60, null, null),
  ('gov.loans', 'interest_rate',         'manual_edit',     1,  null, null),
  ('gov.loans', 'interest_rate',         'om_extraction',   30, 0.5,  null),
  ('gov.loans', 'interest_rate',         'costar_sidebar',  65, null, null),

  -- dia.property_documents (URLs captured from CoStar Documents tab)
  ('dia.property_documents', 'file_name',     'manual_edit',     1,  null, null),
  ('dia.property_documents', 'file_name',     'costar_sidebar',  55, null, null),
  ('dia.property_documents', 'document_type', 'manual_edit',     1,  null, null),
  ('dia.property_documents', 'document_type', 'costar_sidebar',  55, null, null),
  ('dia.property_documents', 'source_url',    'manual_edit',     1,  null, null),
  ('dia.property_documents', 'source_url',    'costar_sidebar',  55, null, null),

  ('gov.property_documents', 'file_name',     'manual_edit',     1,  null, null),
  ('gov.property_documents', 'file_name',     'costar_sidebar',  55, null, null),
  ('gov.property_documents', 'document_type', 'manual_edit',     1,  null, null),
  ('gov.property_documents', 'document_type', 'costar_sidebar',  55, null, null),
  ('gov.property_documents', 'source_url',    'manual_edit',     1,  null, null),
  ('gov.property_documents', 'source_url',    'costar_sidebar',  55, null, null)

ON CONFLICT (target_table, field_name, source) DO NOTHING;
