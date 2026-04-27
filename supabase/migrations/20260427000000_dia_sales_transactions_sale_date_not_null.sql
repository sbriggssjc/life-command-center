-- ============================================================================
-- Migration: enforce sale_date NOT NULL on dia.sales_transactions
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Audit 2026-04-27 found 363 sales_transactions rows with sale_date=NULL,
-- all with data_source=NULL — i.e. legacy CSV-imported rows that never had
-- a real recorded sale date. They were corrupting cap-rate analysis (some
-- carried OM asking prices misread as sale prices) and creating duplicate
-- sale records on properties with real recorded deeds.
--
-- Recovery sweep first:
--   - 9 rows had a YYYY-MM-DD string in notes — extracted into sale_date
--   - 0 rows had recorded_date populated (would have been copied)
--   - 0 rows could be matched to a deed_records row by buyer + price
--
-- Cleanup:
--   - UPDATE ownership_history SET sale_id=NULL  (12 rows pointed at
--     phantom sales — kept the ownership rows, severed the bad link)
--   - DELETE FROM sales_transactions WHERE sale_date IS NULL  (350 rows)
--
-- Then this CHECK constraint prevents the class of bug from recurring:
-- any future writer that tries to insert a sale without a date fails fast.
--
-- (Other writers were audited too: OM promoter doesn't write to
-- sales_transactions at all; CoStar sidebar always sets sale_date in
-- upsertDomainSales, with a hasParseableDate guard that routes undated
-- rows to available_listings instead.)
-- ============================================================================

ALTER TABLE public.sales_transactions
  ADD CONSTRAINT sales_transactions_sale_date_required
  CHECK (sale_date IS NOT NULL);

COMMENT ON CONSTRAINT sales_transactions_sale_date_required
  ON public.sales_transactions IS
  'A sale without a date is not a sale — it is either an asking price
   misread, an empty placeholder, or a half-imported row. Force every
   write to carry a real sale_date so historical analysis stays clean.';
