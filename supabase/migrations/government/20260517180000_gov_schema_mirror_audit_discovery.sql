-- ============================================================================
-- Audit-Discovery patch #1 (2026-05-17): gov schema mirror + loans CHECK expansion.
--
-- Surfaced by item #5's ingest_write_failures instrumentation within 2 minutes
-- of going live. Three patterns of silent gov-side writes were running on
-- every CoStar sidebar capture for an unknown duration:
--
--   1. upsertDomainOwners:linkOwnershipToSale (sidebar-pipeline.js:6744)
--      PATCHes ownership_history.sale_id, which existed on dia but not gov.
--   2. upsertDomainOwners:linkSaleToOwner (sidebar-pipeline.js:6684)
--      PATCHes sales_transactions.recorded_owner_id + recorded_owner_name,
--      both existed on dia but not gov.
--   3. upsertDomainLoans:financing (sidebar-pipeline.js:5424)
--      INSERTs gov.loans with loan_type='Refinance' or 'Acquisition' (mapped
--      from CoStar by mapLoanType() — built for dia's CHECK). gov's
--      loans_loan_type_check only allowed bank-product values
--      ('Permanent','CMBS','Fannie','SBA',...), so every loan row was
--      rejected with the CHECK violation.
--
-- This migration closes all three patterns by mirroring the dia columns onto
-- gov + expanding the gov CHECK to include the dia-style event values. A
-- separate JS-level finding (12x 409 on uq_st_property_date_price per
-- capture) needs a sidebar code change to use resolution=merge-duplicates
-- and is tracked separately.
--
-- Already applied to gov (scknotsqkcheojiaewwh) at 2026-05-17 via Supabase
-- MCP. This file commits the migration to the repo as the historical
-- record so any new gov-environment provisioning inherits the schema.
-- ============================================================================

-- ── 1. ownership_history.sale_id ────────────────────────────────────────────
ALTER TABLE public.ownership_history
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales_transactions(sale_id);
CREATE INDEX IF NOT EXISTS ownership_history_sale_id_idx
  ON public.ownership_history (sale_id);

-- ── 2. sales_transactions.recorded_owner_id + recorded_owner_name ──────────
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS recorded_owner_id   uuid REFERENCES public.recorded_owners(recorded_owner_id),
  ADD COLUMN IF NOT EXISTS recorded_owner_name text;
CREATE INDEX IF NOT EXISTS sales_transactions_recorded_owner_id_idx
  ON public.sales_transactions (recorded_owner_id);

-- ── 3. Expand loans_loan_type_check to include 'Refinance' + 'Acquisition' ──
ALTER TABLE public.loans
  DROP CONSTRAINT IF EXISTS loans_loan_type_check;
ALTER TABLE public.loans
  ADD CONSTRAINT loans_loan_type_check
  CHECK (loan_type IS NULL OR loan_type = ANY (ARRAY[
    -- gov bank-product values (kept)
    'Permanent'::text, 'Bridge'::text, 'Construction'::text, 'Mezzanine'::text,
    'CMBS'::text, 'SBA'::text, 'Other'::text, 'HUD_FHA'::text, 'Fannie'::text,
    'Freddie'::text, 'County_Recorded'::text,
    -- dia event values added so sidebar's mapLoanType() stops failing
    'Refinance'::text, 'Acquisition'::text
  ]));
