-- ============================================================================
-- R7 Phase 2 (gov) — implausible sale-value review source view
-- ============================================================================
-- Mirror of the dia view (see that file's header). gov ceiling = $250M (DC
-- trophy federal buildings can be legitimately large, so this is a SOFT flag —
-- the price is retained; a human confirms-as-is / corrects / voids).
-- Read-only, additive, idempotent. No write path touched.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_implausible_sale_values AS
SELECT
  st.sale_id,
  st.property_id,
  st.sold_price,
  st.sale_date,
  COALESCE(p.address, st.address) AS address,
  COALESCE(p.city,    st.city)    AS city,
  COALESCE(p.state,   st.state)   AS state,
  COALESCE(p.agency,  st.agency)  AS label,   -- tenant agency for gov
  250000000::numeric  AS ceiling
FROM public.sales_transactions st
LEFT JOIN public.properties p ON p.property_id = st.property_id
WHERE st.sold_price > 250000000;

COMMENT ON VIEW public.v_implausible_sale_values IS
  'R7 Phase 2: sales over the $250M gov magnitude soft-ceiling, retained for human review (Decision Center implausible_value lane).';
