-- ============================================================================
-- R7 Phase 2 (dia) — implausible sale-value review source view
-- ============================================================================
-- The Decision Center's "Is this value real?" lane needs a queryable source for
-- the magnitude-flag class — sale prices over the per-domain soft ceiling that
-- the NBA list suppresses (api/admin.js NBA_VALUE_CEILING / sidebar-pipeline.js
-- SALE_PRICE_BLEED_CEILING). Magnitude alone is a SOFT flag (the price is
-- RETAINED, not auto-nulled), so these rows sit waiting for a human verdict
-- (correct the value / confirm as-is / void the record) with no surface today.
--
-- dia ceiling = $50M (a single dialysis/medical asset rarely exceeds this).
-- Read-only, additive, idempotent. No write path touched.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_implausible_sale_values AS
SELECT
  st.sale_id,
  st.property_id,
  st.sold_price,
  st.sale_date,
  p.address,
  p.city,
  p.state,
  p.tenant            AS label,        -- operator name for dia
  50000000::numeric   AS ceiling
FROM public.sales_transactions st
LEFT JOIN public.properties p ON p.property_id = st.property_id
WHERE st.sold_price > 50000000;

COMMENT ON VIEW public.v_implausible_sale_values IS
  'R7 Phase 2: sales over the $50M dia magnitude soft-ceiling, retained for human review (Decision Center implausible_value lane).';
