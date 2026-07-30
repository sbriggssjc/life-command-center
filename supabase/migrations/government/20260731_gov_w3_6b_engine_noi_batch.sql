-- ============================================================================
-- W3.6b — gov_engine_noi_batch: batched ENGINE NOI for the comp-review producer.
-- Applied live to gov (scknotsqkcheojiaewwh) 2026-07-31.
-- ============================================================================
-- The shared comps producer (mcp/comps-tools.js runComps -> computeReviewSignals)
-- used to divide PRICE into the stale properties.noi (mostly estimated_comp_ratio
-- @2026-03-31), flagging cap_mismatch even when gov_compute_cap_rate already
-- reconciled the deal to its reliable ingested cap. This RPC lets the producer
-- fetch the ENGINE'S NOI for many sold comps in ONE round trip: for each
-- {sale_id, property_id, price, as_of} it calls the authoritative
-- gov_compute_cap_rate() and returns the NOI it used (only when the engine's
-- income_type is 'NOI' — a last-resort gross_rent tier is NOT an NOI and must not
-- feed an NOI implied cap; the producer then falls back to properties.noi).
--
-- Additive, read-only (STABLE, SECURITY INVOKER — the MCP calls it with the gov
-- service key). Reversible: DROP FUNCTION public.gov_engine_noi_batch(jsonb);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gov_engine_noi_batch(p_items jsonb)
RETURNS TABLE (
  sale_id           text,
  property_id       bigint,
  engine_income     numeric,   -- NOI the engine used (NULL when income_type <> 'NOI')
  engine_cap        numeric,
  income_source     text,
  income_confidence text,
  income_type       text
)
LANGUAGE sql STABLE AS $$
  SELECT it.sale_id,
         it.property_id,
         CASE WHEN e.income_type = 'NOI' THEN e.income_used ELSE NULL END AS engine_income,
         e.cap_rate,
         e.income_source,
         e.income_confidence,
         e.income_type
  FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb))
       AS it(sale_id text, property_id bigint, price numeric, as_of date)
  LEFT JOIN LATERAL public.gov_compute_cap_rate(it.property_id, it.price, it.as_of) e ON true
  WHERE it.property_id IS NOT NULL AND it.price IS NOT NULL AND it.price > 0;
$$;

REVOKE ALL ON FUNCTION public.gov_engine_noi_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gov_engine_noi_batch(jsonb) TO service_role;

COMMENT ON FUNCTION public.gov_engine_noi_batch(jsonb) IS
  'W3.6b — batched engine NOI (gov_compute_cap_rate) for the comp-review producer. Input jsonb array of {sale_id, property_id, price, as_of}; returns the engine NOI (only when income_type=NOI) + cap + source/confidence so implied_cap is derived from the reconciled figure, not stale properties.noi.';
