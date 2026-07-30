-- ============================================================================
-- W3.6b — dia_engine_rent_batch: batched ENGINE net rent for the comp-review
-- producer. Applied live to dia (zqzrriwuavgrquhisnoa) 2026-07-31.
-- ============================================================================
-- dia parallel of gov_engine_noi_batch. The shared comps producer divides PRICE
-- into the comp's annual_rent (a stale properties-derived figure) while
-- dia_compute_cap_rate already reconciles the deal to its reliable cap_rate_final
-- from the same active-lease net rent (dia cap = net rent, NNN — not NOI). This
-- RPC returns the ENGINE'S net rent for many sold comps in one round trip so the
-- producer derives implied_cap from the reconciled figure; when the engine has
-- nothing it falls back to annual_rent.
--
-- Additive, read-only (STABLE, SECURITY INVOKER — MCP calls with the dia service
-- key). Reversible: DROP FUNCTION public.dia_engine_rent_batch(jsonb);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dia_engine_rent_batch(p_items jsonb)
RETURNS TABLE (
  sale_id           text,
  property_id       bigint,
  engine_income     numeric,   -- net rent the engine used (dia cap basis)
  engine_cap        numeric,
  income_source     text,
  income_confidence text
)
LANGUAGE sql STABLE AS $$
  SELECT it.sale_id,
         it.property_id,
         e.rent_used AS engine_income,
         e.cap_rate,
         e.rent_source     AS income_source,
         e.rent_confidence AS income_confidence
  FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb))
       AS it(sale_id text, property_id bigint, price numeric, as_of date)
  LEFT JOIN LATERAL public.dia_compute_cap_rate(it.property_id, it.price, it.as_of) e ON true
  WHERE it.property_id IS NOT NULL AND it.price IS NOT NULL AND it.price > 0;
$$;

REVOKE ALL ON FUNCTION public.dia_engine_rent_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dia_engine_rent_batch(jsonb) TO service_role;

COMMENT ON FUNCTION public.dia_engine_rent_batch(jsonb) IS
  'W3.6b — batched engine net rent (dia_compute_cap_rate) for the comp-review producer. Input jsonb array of {sale_id, property_id, price, as_of}; returns the engine net rent + cap + source/confidence so implied_cap is derived from the reconciled figure, not stale annual_rent.';
