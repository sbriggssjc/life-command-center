-- ============================================================================
-- Round 76cp — move mortgage rows from deed_records to loans
--
-- Audit found 109 rows in dia.deed_records whose raw_payload looks like
-- a mortgage/loan, not a deed:
--   - has loan_amount, lender, loan_term, maturity_date, loan_type
--   - transaction_type often = 'Loan' or 'Mortgage'
--   - deed_type is NULL or 'Mortgage'
--
-- The dia.loans table received ZERO rows from sidebar captures in the
-- same week. Mortgages were entirely landing in deed_records due to a
-- bug in api/_handlers/sidebar-pipeline.js::upsertDialysisDeedRecords
-- which iterated over metadata.sales_history without filtering loan-
-- type entries (CoStar's Sale History tab interleaves deed and mortgage
-- records). Forward fix in sidebar-pipeline.js (this round) skips loan-
-- typed entries so upsertDomainLoans handles them.
--
-- Note on loan_type: dia.loans has CHECK (loan_type IN ('Refinance',
-- 'Acquisition')) but CoStar uses 'Commercial', 'New Conventional',
-- 'Future Advance Clause Open End Mortgage', etc. We NULL loan_type and
-- preserve the original CoStar value in `notes` for forensic recovery.
--
-- Result:
--   86 mortgage rows migrated to loans
--   23 dedup-skipped (already had matching property_id+date+amount)
--    0 misrouted rows remain in deed_records
-- ============================================================================

WITH mortgage_rows AS (
  SELECT id AS deed_id, property_id,
    raw_payload->>'lender' AS lender,
    raw_payload->>'loan_amount' AS loan_amount_str,
    raw_payload->>'loan_type' AS loan_type_str,
    raw_payload->>'loan_term' AS loan_term_str,
    NULLIF(raw_payload->>'loan_origination_date', '')::date AS origination_date,
    NULLIF(raw_payload->>'maturity_date', '')::date AS maturity_date
  FROM public.deed_records
  WHERE property_id IS NOT NULL
    AND (raw_payload ? 'loan_amount' OR raw_payload ? 'lender'
         OR raw_payload->>'transaction_type' ILIKE '%loan%'
         OR raw_payload->>'transaction_type' ILIKE '%mortgage%'
         OR deed_type ILIKE '%mortgage%')
),
parsed AS (
  SELECT property_id, lender,
    NULLIF(REGEXP_REPLACE(loan_amount_str, '[^0-9.]', '', 'g'), '')::numeric AS loan_amount,
    loan_type_str,
    NULLIF(REGEXP_REPLACE(loan_term_str, '[^0-9.]', '', 'g'), '')::numeric AS loan_term,
    origination_date, maturity_date
  FROM mortgage_rows
)
INSERT INTO public.loans (property_id, lender_name, loan_amount, loan_term, origination_date, maturity_date, is_active, notes)
SELECT property_id, lender, loan_amount, loan_term, origination_date, maturity_date, TRUE,
       NULLIF('Migrated from deed_records (Round 76cp). Original loan_type: ' || COALESCE(loan_type_str, ''), '')
FROM parsed p
WHERE NOT EXISTS (
  SELECT 1 FROM public.loans existing
  WHERE existing.property_id = p.property_id
    AND COALESCE(existing.origination_date::text, '') = COALESCE(p.origination_date::text, '')
    AND COALESCE(existing.loan_amount, 0) = COALESCE(p.loan_amount, 0)
);

DELETE FROM public.deed_records
 WHERE raw_payload ? 'loan_amount'
    OR raw_payload ? 'lender'
    OR raw_payload->>'transaction_type' ILIKE '%loan%'
    OR raw_payload->>'transaction_type' ILIKE '%mortgage%'
    OR deed_type ILIKE '%mortgage%';
