-- ============================================================================
-- Round 76bl — Cap-rate float precision + future-date listing CHECK
--
-- Sampling 5 random recently-touched dia listings surfaced 2 bugs:
--
-- 1. Listing 12119 (Kidney Spa, 4298 Palm Ave Hialeah FL) had
--    listing_date = 2030-09-30 — 4+ years in the future. Almost certainly
--    a date-extraction parser bug (something like '12-30' interpreted as
--    year 2030). Set to NULL and add a CHECK constraint preventing dates
--    more than 90 days in the future.
--
-- 2. 1,101 listings + 426 sales had cap_rate values like
--    0.07150000000000001 — JS floating-point arithmetic during cap rate
--    derivation. Round to 4 decimal places. Add a BEFORE INSERT/UPDATE
--    trigger so writers can't reintroduce the precision garbage.
-- ============================================================================

-- 1. Future-dated listing fix + constraint
UPDATE public.available_listings SET listing_date = NULL WHERE listing_id = 12119;

ALTER TABLE public.available_listings
  DROP CONSTRAINT IF EXISTS available_listings_listing_date_sane;
ALTER TABLE public.available_listings
  ADD CONSTRAINT available_listings_listing_date_sane
  CHECK (listing_date IS NULL OR listing_date <= CURRENT_DATE + INTERVAL '90 days') NOT VALID;
ALTER TABLE public.available_listings
  VALIDATE CONSTRAINT available_listings_listing_date_sane;

-- 2. One-shot cap-rate rounding
UPDATE public.available_listings SET cap_rate = ROUND(cap_rate::numeric, 4)
 WHERE cap_rate IS NOT NULL AND cap_rate::text ~ '\.\d{6,}';
UPDATE public.available_listings SET current_cap_rate = ROUND(current_cap_rate::numeric, 4)
 WHERE current_cap_rate IS NOT NULL AND current_cap_rate::text ~ '\.\d{6,}';
UPDATE public.available_listings SET initial_cap_rate = ROUND(initial_cap_rate::numeric, 4)
 WHERE initial_cap_rate IS NOT NULL AND initial_cap_rate::text ~ '\.\d{6,}';
UPDATE public.available_listings SET last_cap_rate = ROUND(last_cap_rate::numeric, 4)
 WHERE last_cap_rate IS NOT NULL AND last_cap_rate::text ~ '\.\d{6,}';

UPDATE public.sales_transactions SET cap_rate = ROUND(cap_rate::numeric, 4)
 WHERE cap_rate IS NOT NULL AND cap_rate::text ~ '\.\d{6,}';
UPDATE public.sales_transactions SET stated_cap_rate = ROUND(stated_cap_rate::numeric, 4)
 WHERE stated_cap_rate IS NOT NULL AND stated_cap_rate::text ~ '\.\d{6,}';

-- 3. BEFORE INSERT/UPDATE trigger to keep cap_rates rounded
CREATE OR REPLACE FUNCTION public.dia_round_cap_rates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'available_listings' THEN
    NEW.cap_rate := ROUND(NEW.cap_rate::numeric, 4);
    NEW.current_cap_rate := ROUND(NEW.current_cap_rate::numeric, 4);
    NEW.initial_cap_rate := ROUND(NEW.initial_cap_rate::numeric, 4);
    NEW.last_cap_rate := ROUND(NEW.last_cap_rate::numeric, 4);
  ELSIF TG_TABLE_NAME = 'sales_transactions' THEN
    NEW.cap_rate := ROUND(NEW.cap_rate::numeric, 4);
    NEW.stated_cap_rate := ROUND(NEW.stated_cap_rate::numeric, 4);
    NEW.calculated_cap_rate := ROUND(NEW.calculated_cap_rate::numeric, 4);
    NEW.initial_cap_rate := ROUND(NEW.initial_cap_rate::numeric, 4);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dia_round_caps_listings ON public.available_listings;
CREATE TRIGGER trg_dia_round_caps_listings
  BEFORE INSERT OR UPDATE OF cap_rate, current_cap_rate, initial_cap_rate, last_cap_rate
  ON public.available_listings FOR EACH ROW EXECUTE FUNCTION public.dia_round_cap_rates();

DROP TRIGGER IF EXISTS trg_dia_round_caps_sales ON public.sales_transactions;
CREATE TRIGGER trg_dia_round_caps_sales
  BEFORE INSERT OR UPDATE OF cap_rate, stated_cap_rate, calculated_cap_rate, initial_cap_rate
  ON public.sales_transactions FOR EACH ROW EXECUTE FUNCTION public.dia_round_cap_rates();
