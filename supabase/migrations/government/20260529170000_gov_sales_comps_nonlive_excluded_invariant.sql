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
  sale_id uuid PRIMARY KEY,  -- gov sale_id is uuid (dia's is integer)
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

-- gov v_sales_comps was a MATERIALIZED VIEW (stale snapshot, refreshed by cron
-- 'refresh-mv-sales-comps') gating only on exclude_from_market_metrics. Convert
-- it to a live regular VIEW with an explicit transaction_state='live' gate
-- (defense-in-depth on top of the invariant) so the gov dashboard comp counts
-- are always current and option-A correct. No dependents. Validated: 2,470
-- all-time / 61 TTM.
DROP MATERIALIZED VIEW IF EXISTS public.v_sales_comps;
SELECT cron.unschedule('refresh-mv-sales-comps')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-mv-sales-comps');
CREATE VIEW public.v_sales_comps AS
 SELECT s.sale_id, s.property_id, p.lease_number,
    COALESCE(s.agency, p.agency) AS agency,
    COALESCE(p.agency_full_name, s.agency) AS agency_full,
    s.government_type, s.address, s.city, s.state,
    COALESCE(s.land_acres, p.land_acres) AS land_acres,
    COALESCE(s.year_built, p.year_built) AS year_built,
    COALESCE(s.rba, p.rba) AS rba,
    s.noi, s.noi_psf, s.gross_rent, s.gross_rent_psf, s.lease_expiration,
    p.firm_term_remaining, p.term_remaining,
    COALESCE(s.expenses, p.expenses) AS expenses,
    COALESCE(s.rent_escalations, esc.bumps_summary) AS bumps,
    s.sold_price, s.sold_price_psf, s.sold_cap_rate, s.sale_date,
    s.seller, s.listing_broker, s.buyer, s.purchasing_broker,
    s.bid_ask_spread, s.days_on_market, s.zero_cash_flow_cap,
    s.financing_type, s.lender_name, s.buyer_type, s.is_northmarq
   FROM sales_transactions s
     LEFT JOIN properties p ON s.property_id = p.property_id
     LEFT JOIN LATERAL ( SELECT string_agg(
                CASE WHEN le.escalation_pct IS NOT NULL THEN (round(le.escalation_pct * 100::numeric, 2) || '% '::text) || COALESCE(le.escalation_type, ''::text) ELSE le.escalation_type END,
                '; '::text ORDER BY le.effective_date DESC) AS bumps_summary
           FROM ( SELECT lease_escalations.escalation_pct, lease_escalations.escalation_type, lease_escalations.effective_date
                   FROM lease_escalations WHERE lease_escalations.property_id = s.property_id
                  ORDER BY lease_escalations.effective_date DESC LIMIT 3) le) esc ON true
  WHERE s.exclude_from_market_metrics IS NOT TRUE
    AND s.transaction_state = 'live'
  ORDER BY s.sale_date DESC NULLS LAST;

-- gov overview KPIs come from a matview; refresh so the backfill is reflected.
REFRESH MATERIALIZED VIEW public.mv_gov_overview_stats;

COMMIT;

-- Verify: should be 0 after this migration.
--   SELECT count(*) FROM sales_transactions
--    WHERE transaction_state <> 'live' AND exclude_from_market_metrics IS NOT TRUE;
