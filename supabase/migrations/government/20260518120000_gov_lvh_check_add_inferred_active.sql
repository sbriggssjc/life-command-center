-- Gov mirror — idempotent (only fires if the CHECK exists on gov).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid WHERE t.relname='listing_verification_history' AND c.conname='lvh_check_result_check') THEN
    ALTER TABLE public.listing_verification_history DROP CONSTRAINT lvh_check_result_check;
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
  END IF;
END $$;