-- ============================================================================
-- GATED — APPLY ONLY AFTER dia_backfill.sql is COMMITted and re-audited.
-- Target: dia (zqzrriwuavgrquhisnoa) public.available_listings
-- dia ALREADY HAS the two main guards:
--   * available_listings_one_active_per_property  (partial unique index)
--   * trg_listing_close_if_sold                    (close-on-sale)
-- This file only adds the missing invariants: no future off_market stamp, and
-- active ⇄ off_market mutual exclusion (clear the stamp when a row goes active).
-- ============================================================================
BEGIN;

-- (1) No future off_market_date (+1d clock-skew grace). NOT VALID so it applies
--     to new writes immediately; VALIDATE after dia_backfill clears violators.
ALTER TABLE public.available_listings DROP CONSTRAINT IF EXISTS al_off_market_not_future;
ALTER TABLE public.available_listings
  ADD CONSTRAINT al_off_market_not_future
  CHECK (off_market_date IS NULL OR off_market_date <= CURRENT_DATE + 1) NOT VALID;
-- ALTER TABLE public.available_listings VALIDATE CONSTRAINT al_off_market_not_future;

-- (2) active ⇒ no off_market_date. Enforced in a BEFORE trigger (not a CHECK) to
--     avoid multi-column-update ordering hazards. Runs ahead of the existing
--     cap-rate/broker BEFORE triggers harmlessly (column-only mutation).
CREATE OR REPLACE FUNCTION public.fn_dia_listing_active_offmarket_excl()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.is_active IS TRUE AND NEW.off_market_date IS NOT NULL THEN
    NEW.off_market_date := NULL;
    NEW.off_market_reason := NULL;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_dia_active_offmarket_excl ON public.available_listings;
CREATE TRIGGER trg_dia_active_offmarket_excl
  BEFORE INSERT OR UPDATE OF is_active, off_market_date
  ON public.available_listings FOR EACH ROW
  EXECUTE FUNCTION public.fn_dia_listing_active_offmarket_excl();

COMMIT;
