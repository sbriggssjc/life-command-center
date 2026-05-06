-- Tier 2 item 8 of 8 — closes Tier 2 dialysis parity (8 of 8 charts done).
-- Companion to DialysisProject migration 20260507200000_cm_dialysis_valuation_index
-- which adds the underlying view to Dialysis_DB.
--
-- The dialysis valuation_index view differs from gov's in formula:
--   gov: avg_noi_psf / avg_cap_rate (yields $/SF)
--   dia: indexed (TTM_rent / TTM_cap) / base_value × 100
--        (yields a unitless 100-base index; dialysis sales lack per-SF data)
--
-- Both render through the existing CHART_COLUMNS for valuation_index without
-- changes — the dialysis view emits NULLs for avg_rent_psf / expenses_psf /
-- noi_psf and a unitless number for valuation_index.

UPDATE public.cm_chart_catalog
SET applies_to_verticals = ARRAY(
  SELECT DISTINCT v
  FROM unnest(applies_to_verticals || ARRAY['dialysis']) v
  ORDER BY v
)
WHERE chart_template_id = 'valuation_index';
