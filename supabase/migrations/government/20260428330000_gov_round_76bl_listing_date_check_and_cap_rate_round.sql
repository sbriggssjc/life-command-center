-- ============================================================================
-- Round 76bl (gov) — Future-date listing CHECK + cap-rate float-precision trigger
--
-- Mirror of dia 76bl. Audit found 3 gov listings dated in the future
-- (2034-04-01, 2030-09-01, 2027-05-24) — clear parser/extraction bugs.
-- Set them to NULL and add CHECK constraint preventing dates >90 days
-- in the future. Gov side had 0 float-precision cap-rate rows but the
-- BEFORE INSERT/UPDATE trigger keeps it that way.
-- ============================================================================

UPDATE public.available_listings SET listing_date = NULL
 WHERE listing_date > CURRENT_DATE + INTERVAL '90 days';

ALTER TABLE public.available_listings
  DROP CONSTRAINT IF EXISTS available_listings_listing_date_sane;
ALTER TABLE public.available_listings
  ADD CONSTRAINT available_listings_listing_date_sane
  CHECK (listing_date IS NULL OR listing_date <= CURRENT_DATE + INTERVAL '90 days') NOT VALID;
ALTER TABLE public.available_listings
  VALIDATE CONSTRAINT available_listings_listing_date_sane;

CREATE OR REPLACE FUNCTION public.gov_round_cap_rates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'available_listings' THEN
    NEW.asking_cap_rate := ROUND(NEW.asking_cap_rate::numeric, 4);
  ELSIF TG_TABLE_NAME = 'sales_transactions' THEN
    NEW.sold_cap_rate := ROUND(NEW.sold_cap_rate::numeric, 4);
    NEW.initial_cap_rate := ROUND(NEW.initial_cap_rate::numeric, 4);
    NEW.last_cap_rate := ROUND(NEW.last_cap_rate::numeric, 4);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gov_round_caps_listings ON public.available_listings;
CREATE TRIGGER trg_gov_round_caps_listings
  BEFORE INSERT OR UPDATE OF asking_cap_rate ON public.available_listings
  FOR EACH ROW EXECUTE FUNCTION public.gov_round_cap_rates();

DROP TRIGGER IF EXISTS trg_gov_round_caps_sales ON public.sales_transactions;
CREATE TRIGGER trg_gov_round_caps_sales
  BEFORE INSERT OR UPDATE OF sold_cap_rate, initial_cap_rate, last_cap_rate
  ON public.sales_transactions
  FOR EACH ROW EXECUTE FUNCTION public.gov_round_cap_rates();
