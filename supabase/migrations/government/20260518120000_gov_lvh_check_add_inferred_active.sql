-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

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