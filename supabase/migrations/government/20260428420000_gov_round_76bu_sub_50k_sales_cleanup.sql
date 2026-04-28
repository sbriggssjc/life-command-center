-- ============================================================================
-- Round 76bu — Gov sales sub-$50K cleanup (parity with dia Round 76bp)
--
-- Audit found 3 gov sales below $50K, all clearly parser errors:
--
-- sale_id 1d6c9232 — $100, property 7309, Boyd Watterson buying from
--    OPI Trust on 2019-11-15. Real portfolio trade, but price truncated.
--
-- sale_id 122eb446 — $10,000, ATAPCO buying from individual.
--    Could be deed-fee transaction; far below market regardless.
--
-- sale_id edcda014 — $37,919, no property_id (already orphan), same
--    parties + date as #1 — likely a duplicate/garbage row.
--
-- 56 sales > $100M kept unchanged — none are same-price-portfolio
-- duplicates (verified). These are real federal portfolio trades like
-- the OPI Trust acquisitions.
-- ============================================================================

UPDATE public.sales_transactions
   SET exclude_from_market_metrics = TRUE,
       sold_price = NULL
 WHERE sold_price > 0 AND sold_price < 50000;

-- The orphan duplicate (no property_id, same Boyd Watterson/OPI Trust
-- as the property-7309 sale) has no value once price is NULL — delete it.
DELETE FROM public.sales_transactions
 WHERE sale_id = 'edcda014-ceb5-4987-bbb4-8b9d0f4f1d88'::uuid
   AND property_id IS NULL;

ALTER TABLE public.sales_transactions
  DROP CONSTRAINT IF EXISTS sales_transactions_sold_price_realistic;
ALTER TABLE public.sales_transactions
  ADD CONSTRAINT sales_transactions_sold_price_realistic
  CHECK (sold_price IS NULL OR sold_price >= 50000) NOT VALID;
ALTER TABLE public.sales_transactions VALIDATE CONSTRAINT sales_transactions_sold_price_realistic;
