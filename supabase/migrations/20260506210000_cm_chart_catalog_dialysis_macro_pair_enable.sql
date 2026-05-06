-- Tier 2 of parity audit: enable two macro charts for the dialysis vertical
-- now that cm_dialysis_returns_indexes_q + cm_dialysis_cost_of_capital_q are
-- live on the Dialysis_DB project.
--
-- Companion to DialysisProject migration 20260506200000_cm_dialysis_macro_infra
-- and the FRED data sync (8230 rows from gov.economic_indicators on
-- 2026-05-06 via src/ingest_fred_to_dialysis.py).
--
-- valuation_index intentionally NOT flipped here — gov's view depends on
-- noi_psf / sf_leased fields that the dialysis sales-transaction schema
-- doesn't carry. See CAPITAL_MARKETS_PARITY_AUDIT.md §7 Tier 2 #3b.

UPDATE public.cm_chart_catalog
SET applies_to_verticals = ARRAY(
  SELECT DISTINCT v
  FROM unnest(applies_to_verticals || ARRAY['dialysis']) v
  ORDER BY v
)
WHERE chart_template_id IN ('cash_leveraged_returns','cost_of_capital');
