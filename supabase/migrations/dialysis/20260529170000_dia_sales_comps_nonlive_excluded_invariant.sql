-- ============================================================================
-- Dia — Sales comps: enforce "non-live ⇒ excluded from market metrics"
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Context (2026-05-29): see SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md
-- + the 2026-05-29 sales-comps categorization review.
--
-- `transaction_state` (live/duplicate_superseded/ownership_stub/needs_review) and
-- `exclude_from_market_metrics` are DISTINCT, legitimate concepts and stay
-- separate: transaction_state = "is this a unique real transaction?";
-- exclude_from_market_metrics = "is this real transaction clean enough for
-- market STATISTICS?" (set on real priced sales with implausible cap rates,
-- portfolio-allocation contamination, parser-error prices, etc.).
--
-- THE BUG: every comp/metric view gates only on exclude_from_market_metrics and
-- never on transaction_state, so duplicate_superseded / ownership_stub /
-- needs_review rows (which lack the exclude flag) LEAK into comp counts, TTM
-- volume, and the CM report.
--
-- Decision (user, 2026-05-29): comp/count/volume gate = transaction_state='live'
-- AND exclude_from_market_metrics IS NOT TRUE (option A).
--
-- FIX (chosen for minimal blast radius): rather than edit 22+ cm_* views, we
-- enforce the universally-correct invariant that ANY non-live row is also
-- excluded from market metrics. A duplicate / price-less stub / needs-review row
-- must never appear in market statistics. This makes the existing
-- `exclude_from_market_metrics IS NOT TRUE` gate in every view (and the gov
-- v_sales_comps, and detail.js) equal option A with NO view edits. Live rows'
-- exclude flag is NOT touched, so the cap-quality concept is preserved intact.
-- No rows deleted; reversible.
-- ============================================================================

BEGIN;

-- 0. Reversible snapshot of every row whose exclude flag this migration flips.
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

-- 1. Backfill the invariant.
UPDATE public.sales_transactions
   SET exclude_from_market_metrics = true
 WHERE transaction_state IS DISTINCT FROM 'live'
   AND exclude_from_market_metrics IS NOT TRUE;

-- 2. Keep the invariant true forever: any write that lands a non-live state also
--    excludes the row from market metrics. Live rows keep their independent
--    cap-quality exclude flag (we only ever force TRUE on non-live).
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

-- dia comp consumers that are MATERIALIZED VIEWS gating on
-- exclude_from_market_metrics must be refreshed so the backfill is reflected
-- (both retain their own refresh crons going forward):
--   v_sales_comps        — detail.js entity comp lookups (gates on the flag).
--   mv_property_value_signal — per-property signal off sales_transactions.
REFRESH MATERIALIZED VIEW public.v_sales_comps;
REFRESH MATERIALIZED VIEW public.mv_property_value_signal;

COMMIT;

-- Verify: should be 0 after this migration.
--   SELECT count(*) FROM sales_transactions
--    WHERE transaction_state <> 'live' AND exclude_from_market_metrics IS NOT TRUE;
-- Rollback: restore exclude=false for the snapshotted sale_ids and drop the trigger.
