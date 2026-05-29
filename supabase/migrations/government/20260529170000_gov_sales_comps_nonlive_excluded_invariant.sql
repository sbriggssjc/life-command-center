-- ============================================================================
-- Gov — Sales comps: enforce "non-live ⇒ excluded from market metrics"
--
-- Target: government Supabase (GOV_SUPABASE_URL)
--
-- Gov mirror of the dia migration of the same date. See that file's header and
-- SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md for the rationale.
--
-- Gov-specific note: gov v_sales_comps already gates on
-- `exclude_from_market_metrics IS NOT TRUE`; this invariant therefore upgrades
-- it to the full option-A gate (live AND not-excluded) with no view edit. The
-- gov ownership_stub rows (3,313) are already excluded; this catches the 127
-- duplicate_superseded + 807 needs_review rows that were leaking.
-- No rows deleted; reversible.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.sales_nonlive_exclude_backfill_20260529 (
  sale_id integer PRIMARY KEY,
  transaction_state text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sales_nonlive_exclude_backfill_20260529 (sale_id, transaction_state)
SELECT sale_id, transaction_state
  FROM public.sales_transactions
 WHERE transaction_state IS DISTINCT FROM 'live'
   AND exclude_from_market_metrics IS NOT TRUE
ON CONFLICT (sale_id) DO NOTHING;

UPDATE public.sales_transactions
   SET exclude_from_market_metrics = true
 WHERE transaction_state IS DISTINCT FROM 'live'
   AND exclude_from_market_metrics IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.enforce_nonlive_excluded_from_metrics()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.transaction_state IS DISTINCT FROM 'live'
     AND NEW.exclude_from_market_metrics IS NOT TRUE THEN
    NEW.exclude_from_market_metrics := true;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_enforce_nonlive_excluded ON public.sales_transactions;
CREATE TRIGGER trg_enforce_nonlive_excluded
  BEFORE INSERT OR UPDATE OF transaction_state, exclude_from_market_metrics
  ON public.sales_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_nonlive_excluded_from_metrics();

COMMIT;

-- Verify: should be 0 after this migration.
--   SELECT count(*) FROM sales_transactions
--    WHERE transaction_state <> 'live' AND exclude_from_market_metrics IS NOT TRUE;
