-- Round 76er.a: add data_source column to dia.loans
-- The CoStar/RCA sidebar pipeline (upsertDomainLoans, upsertLoanRecords) writes
-- `data_source: 'costar_sidebar'` / `'costar_cmbs_loan'` into both gov.loans and
-- dia.loans. gov.loans has the column; dia.loans did not — every dia loan POST
-- was silently failing with column-not-found and the writer counted it as a
-- no-op (count++ skipped, no error thrown). Adding the column unblocks every
-- prior sidebar-captured dia loan and matches the gov.loans schema for
-- consistent provenance auditing.
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS data_source text;
COMMENT ON COLUMN public.loans.data_source IS
  'Source program that wrote this row (costar_sidebar / costar_cmbs_loan / county_records / om_extraction / manual_edit). Round 76er.a, 2026-05-13.';
