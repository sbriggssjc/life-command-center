-- Register OPS asset metadata loan propagation as a provenance citizen.
-- Source shape: entities.metadata.loans[] copied into dia/gov structured loans.
-- Trust rank: below direct costar_cmbs_loan (20), above generic OM/sidebar debt
-- extraction, because this is a previously captured RCA/CMBS loan packet being
-- moved from OPS metadata into the domain loan table.

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
VALUES
  ('dia.loans', 'lender_name',           'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('dia.loans', 'loan_amount',           'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('dia.loans', 'loan_type',             'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('dia.loans', 'loan_term',             'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('dia.loans', 'origination_date',      'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('dia.loans', 'maturity_date',         'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('dia.loans', 'interest_rate_percent', 'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('dia.loans', 'loan_to_value',         'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('dia.loans', 'originator',            'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('dia.loans', 'special_servicer',      'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('dia.loans', 'origination_appraisal', 'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('dia.loans', 'cmbs_deal_name',        'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),

  ('gov.loans', 'loan_amount',           'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('gov.loans', 'loan_type',             'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('gov.loans', 'term_years',            'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('gov.loans', 'origination_date',      'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('gov.loans', 'maturity_date',         'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('gov.loans', 'interest_rate',         'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('gov.loans', 'ltv',                   'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('gov.loans', 'originator',            'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('gov.loans', 'special_servicer',      'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('gov.loans', 'origination_appraisal', 'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('gov.loans', 'cmbs_deal_name',        'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.'),
  ('gov.loans', 'status',                'ops_asset_metadata_loan', 25, 0.5, 'record_only', 'RCA/CMBS loan packet propagated from OPS asset metadata.')
ON CONFLICT (target_table, field_name, source)
DO UPDATE SET
  priority = EXCLUDED.priority,
  min_confidence = EXCLUDED.min_confidence,
  enforce_mode = EXCLUDED.enforce_mode,
  notes = EXCLUDED.notes;
