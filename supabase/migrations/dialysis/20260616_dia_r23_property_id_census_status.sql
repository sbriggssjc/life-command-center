-- R23 (2026-06-16): add a `status` column to the dia property census so the LCC
-- reconcile can use ONE uniform cross-DB fetch (`select=property_id,status`)
-- across both domains.
--
-- dia has NO soft-archive concept — it HARD-deletes properties on merge (no
-- status column on dia.properties), so every id present here is a live, current
-- asset. We expose a constant NULL status so the LCC reconcile's KEEP predicate
-- (`status IS DISTINCT FROM 'archived'`) keeps every dia row — i.e. dia behavior
-- stays BYTE-IDENTICAL to R22 (prune hard-gone only; the R23 archived exclusion
-- is gov-specific). PII-free: id + (null) status only. Owner = postgres so anon
-- bypasses RLS like the sibling v_*_portfolio views.
CREATE OR REPLACE VIEW public.v_property_id_census AS
  SELECT property_id, NULL::text AS status FROM public.properties;

GRANT SELECT ON public.v_property_id_census TO anon, authenticated;

COMMENT ON VIEW public.v_property_id_census IS
  'R22/R23 mirror-reconcile: id + (null) status property census. dia hard-deletes '
  '(no archived state), so status is always NULL and every present id is kept; '
  'LCC prunes a mirror row only when its property_id is absent here (hard-gone).';
