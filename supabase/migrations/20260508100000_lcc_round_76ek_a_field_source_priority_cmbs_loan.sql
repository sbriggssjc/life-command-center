-- Round 76ek.a — field_source_priority entries for the new CMBS loan-history
-- writers (sidebar-pipeline.js Round 76ek.b/c/d/e).
--
-- A new source `costar_cmbs_loan` is introduced at priority 20. Rationale:
--
--   priority 1   manual_edit
--   priority 10  county_records
--   priority 20  costar_cmbs_loan          ← THIS source, NEW
--   priority 30  om_extraction (rate-class)
--   priority 35  om_extraction (loan-amt-class)
--   priority 50  rca_sidebar
--   priority 60  costar_sidebar
--   priority 65  crexi_sidebar
--
-- CMBS detail pages are SEC-audited servicer filings, so they outrank both
-- OM extractions and CoStar's aggregator-quality sidebar capture for shared
-- fields like interest_rate / maturity_date / loan_term. They sit just below
-- county records (which are the original source of record for recordation
-- date / mortgage_amount).
--
-- Tables covered:
--   gov.loans, dia.loans             — shared columns (interest_rate,
--                                       maturity_date, etc.) plus the new
--                                       CMBS columns (originator, servicer,
--                                       sponsor, etc.)
--   gov.loan_snapshots, dia.loan_snapshots
--   gov.loan_top_tenants, dia.loan_top_tenants
--   gov.loan_commentary, dia.loan_commentary
--   gov.property_financials, dia.property_financials
--
-- All entries start at enforce_mode='record_only' to match the rest of the
-- registry's gradual-rollout policy. They will be flipped to warn/strict in
-- a follow-up round once we've watched a few weeks of writes.

BEGIN;

WITH new_rules(target_table, field_name) AS (
  VALUES
    -- gov.loans / dia.loans — shared base columns (CMBS source displaces
    -- costar_sidebar @ 60-65 and om_extraction @ 30-40)
    ('gov.loans','interest_rate'),
    ('gov.loans','loan_amount'),
    ('gov.loans','loan_type'),
    ('gov.loans','origination_date'),
    ('gov.loans','maturity_date'),
    ('gov.loans','term_years'),
    ('gov.loans','io_period_months'),
    ('gov.loans','ltv'),
    ('gov.loans','dscr'),
    ('gov.loans','annual_debt_service'),
    ('gov.loans','monthly_payment'),
    ('gov.loans','prepayment_type'),
    ('gov.loans','prepayment_details'),
    ('gov.loans','status'),
    ('gov.loans','rate_type'),
    ('gov.loans','amortization_years'),
    ('gov.loans','data_source'),
    -- gov.loans — new CMBS-only columns
    ('gov.loans','originator'),
    ('gov.loans','servicer'),
    ('gov.loans','special_servicer'),
    ('gov.loans','sponsor'),
    ('gov.loans','num_delinquent'),
    ('gov.loans','modification'),
    ('gov.loans','watchlist'),
    ('gov.loans','special_servicing'),
    ('gov.loans','status_at_disposal'),
    ('gov.loans','balloon_maturity'),
    ('gov.loans','pay_frequency'),
    ('gov.loans','num_collateral'),
    ('gov.loans','pct_of_total_loan'),
    ('gov.loans','origination_appraisal'),
    ('gov.loans','appraisal_date'),
    ('gov.loans','costar_loan_id'),
    ('gov.loans','source_url'),

    ('dia.loans','interest_rate_percent'),
    ('dia.loans','loan_amount'),
    ('dia.loans','loan_type'),
    ('dia.loans','loan_term'),
    ('dia.loans','origination_date'),
    ('dia.loans','maturity_date'),
    ('dia.loans','lender_name'),
    ('dia.loans','data_source'),
    ('dia.loans','originator'),
    ('dia.loans','servicer'),
    ('dia.loans','special_servicer'),
    ('dia.loans','sponsor'),
    ('dia.loans','num_delinquent'),
    ('dia.loans','modification'),
    ('dia.loans','watchlist'),
    ('dia.loans','special_servicing'),
    ('dia.loans','status_at_disposal'),
    ('dia.loans','balloon_maturity'),
    ('dia.loans','pay_frequency'),
    ('dia.loans','num_collateral'),
    ('dia.loans','pct_of_total_loan'),
    ('dia.loans','origination_appraisal'),
    ('dia.loans','appraisal_date'),
    ('dia.loans','costar_loan_id'),
    ('dia.loans','source_url'),

    -- loan_snapshots
    ('gov.loan_snapshots','as_of_date'),
    ('gov.loan_snapshots','noi'),
    ('gov.loan_snapshots','noi_dscr'),
    ('gov.loan_snapshots','debt_service'),
    ('gov.loan_snapshots','gla'),
    ('gov.loan_snapshots','occupied_sf'),
    ('gov.loan_snapshots','occupancy_pct'),
    ('gov.loan_snapshots','loan_balance'),
    ('gov.loan_snapshots','data_source'),

    ('dia.loan_snapshots','as_of_date'),
    ('dia.loan_snapshots','noi'),
    ('dia.loan_snapshots','noi_dscr'),
    ('dia.loan_snapshots','debt_service'),
    ('dia.loan_snapshots','gla'),
    ('dia.loan_snapshots','occupied_sf'),
    ('dia.loan_snapshots','occupancy_pct'),
    ('dia.loan_snapshots','loan_balance'),
    ('dia.loan_snapshots','data_source'),

    -- loan_top_tenants
    ('gov.loan_top_tenants','tenant_name'),
    ('gov.loan_top_tenants','expiration_date'),
    ('gov.loan_top_tenants','occupied_sf'),
    ('gov.loan_top_tenants','rank'),
    ('dia.loan_top_tenants','tenant_name'),
    ('dia.loan_top_tenants','expiration_date'),
    ('dia.loan_top_tenants','occupied_sf'),
    ('dia.loan_top_tenants','rank'),

    -- loan_commentary
    ('gov.loan_commentary','entry_date'),
    ('gov.loan_commentary','entry_label'),
    ('gov.loan_commentary','body'),
    ('gov.loan_commentary','rank'),
    ('dia.loan_commentary','entry_date'),
    ('dia.loan_commentary','entry_label'),
    ('dia.loan_commentary','body'),
    ('dia.loan_commentary','rank'),

    -- property_financials
    ('gov.property_financials','fiscal_year'),
    ('gov.property_financials','period_end_date'),
    ('gov.property_financials','gross_income'),
    ('gov.property_financials','vacancy'),
    ('gov.property_financials','effective_gross_income'),
    ('gov.property_financials','operating_expenses'),
    ('gov.property_financials','taxes'),
    ('gov.property_financials','insurance'),
    ('gov.property_financials','cam'),
    ('gov.property_financials','noi'),
    ('gov.property_financials','capex'),
    ('gov.property_financials','source'),

    ('dia.property_financials','fiscal_year'),
    ('dia.property_financials','period_end_date'),
    ('dia.property_financials','gross_income'),
    ('dia.property_financials','vacancy'),
    ('dia.property_financials','effective_gross_income'),
    ('dia.property_financials','operating_expenses'),
    ('dia.property_financials','taxes'),
    ('dia.property_financials','insurance'),
    ('dia.property_financials','cam'),
    ('dia.property_financials','noi'),
    ('dia.property_financials','capex'),
    ('dia.property_financials','source')
)
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
SELECT
  target_table,
  field_name,
  'costar_cmbs_loan',
  20,
  'record_only',
  'Round 76ek.a: CMBS servicer-audited filings; outrank costar_sidebar (60) and om_extraction (30-40).'
FROM new_rules
ON CONFLICT (target_table, field_name, source) DO NOTHING;

COMMIT;

-- Verification:
--   SELECT target_table, count(*)
--     FROM public.field_source_priority
--    WHERE source='costar_cmbs_loan'
--    GROUP BY target_table
--    ORDER BY target_table;
