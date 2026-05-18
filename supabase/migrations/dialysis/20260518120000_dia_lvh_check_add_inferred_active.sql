-- Fresh audit A-3 (dia, 2026-05-18): expand listing_verification_history
-- check_result CHECK to include 'inferred_active'. The timer-driven
-- auto-scrape path records "still listed by inference (no sale evidence
-- in 3y window)" as a distinct outcome from "still_available" (which
-- implies the scraper actually saw the listing live). 150 silent 4xx/24h.
ALTER TABLE public.listing_verification_history DROP CONSTRAINT IF EXISTS lvh_check_result_check;
ALTER TABLE public.listing_verification_history
  ADD CONSTRAINT lvh_check_result_check
  CHECK (check_result = ANY (ARRAY[
    'still_available'::text,
    'price_changed'::text,
    'off_market'::text,
    'sold'::text,
    'unreachable'::text,
    'manual_review_needed'::text,
    'inferred_active'::text
  ]));