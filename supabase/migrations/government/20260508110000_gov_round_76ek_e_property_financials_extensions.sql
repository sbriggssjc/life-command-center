-- Round 76ek.e — gov.property_financials column extensions for the CoStar
-- Financials tab parser (Round 76ek.e).
--
-- The Financials tab (/detail/lookup/{N}/cmbs-financials) shows multiple
-- years of actual operating financials side-by-side. The structured columns
-- added in Round 76ek.a (gross_income, vacancy, taxes, insurance, cam,
-- operating_expenses, noi, capex) cover the headline metrics, but the page
-- also lists a long tail of detail rows that don't fit cleanly:
--   - Base Rent / Expense Reimbursement / Percentage Rent / Parking Income
--     / Other Income (income breakdown beneath Gross Potential Rent)
--   - Utilities / Repairs & Maintenance / Management Fees / Ground Rent /
--     Other Expenses (expense breakdown beneath the headline categories)
--
-- Rather than ALTER TABLE every time CoStar surfaces a new line item, we
-- capture the full table verbatim into a JSONB column. The structured
-- columns still get populated when the row maps cleanly so analytics
-- queries don't need to crack open JSON for the common case.
--
-- months_covered tracks YTD partial-year captures: the "Most Recent" column
-- often covers 6 months instead of 12 (e.g. Jun 30, 2024). period_end_date
-- alone doesn't tell us this — months_covered=6 means downstream consumers
-- should annualize before comparing to full-year columns.

BEGIN;

ALTER TABLE public.property_financials
  ADD COLUMN IF NOT EXISTS months_covered integer,
  ADD COLUMN IF NOT EXISTS line_items     jsonb;

CREATE INDEX IF NOT EXISTS property_financials_line_items_gin
  ON public.property_financials USING gin (line_items);

COMMENT ON COLUMN public.property_financials.months_covered IS
  'Round 76ek.e: number of months the statement covers. 12 = full fiscal '
  'year. <12 = YTD partial-year capture (the "Most Recent" column on '
  'CoStar''s cmbs-financials tab). NULL on legacy rows.';

COMMENT ON COLUMN public.property_financials.line_items IS
  'Round 76ek.e: verbatim table rows from the source page, keyed by label. '
  'Captures everything not promoted to a structured column (e.g. base_rent, '
  'expense_reimbursement, utilities, repairs_maintenance, management_fees, '
  'ground_rent). Shape: { "<label>": <number> }. Empty cells are omitted.';

COMMIT;
