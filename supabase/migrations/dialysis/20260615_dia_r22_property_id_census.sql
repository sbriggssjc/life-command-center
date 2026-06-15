-- R22 (2026-06-15): id-only property census for cross-DB mirror orphan
-- reconciliation. dia hard-deletes properties on merge (no status/archived
-- column), so every id absent here is genuinely gone. The LCC reconcile
-- (lcc_reconcile_mirrors_*) anti-joins each LCC mirror against this census and
-- prunes confirmed orphans. PII-free: integer ids only. Symmetric with
-- gov.v_property_id_census so the LCC reconcile uses one cross-DB path.
CREATE OR REPLACE VIEW public.v_property_id_census AS
  SELECT property_id FROM public.properties;

GRANT SELECT ON public.v_property_id_census TO anon, authenticated;

COMMENT ON VIEW public.v_property_id_census IS
  'R22 mirror-reconcile: id-only property census. LCC prunes a mirror row only '
  'when its property_id is absent here (hard-gone in dia dedup).';
