-- R22 (2026-06-15): id-only, all-status property census for cross-DB mirror
-- orphan reconciliation. The LCC mirrors (lcc_property_attributes /
-- lcc_property_owner_facts / lcc_entity_portfolio_facts) are insert/update-only
-- and never prune rows for properties merged/deleted in gov dedup. The LCC
-- reconcile (lcc_reconcile_mirrors_*) anti-joins each mirror against this census
-- and prunes a mirror row only when its property_id is GENUINELY GONE from
-- gov.properties (a hard delete).
--
-- IMPORTANT: this census includes ALL statuses, including status='archived'.
-- gov SOFT-deletes merged properties (archive), and the sibling anon views
-- (v_property_attributes_portfolio / v_property_owner_facts_portfolio) already
-- EXCLUDE archived. Reconciling against those would prune ~6,600 soft-archived
-- mirror rows — but R22's intent is "genuinely gone, not soft state," so the
-- reconcile uses THIS all-status census and leaves archived rows in place.
--
-- PII-free: integer ids only. Owner = postgres so it bypasses RLS exactly like
-- the sibling v_*_portfolio anon views (gov.properties has RLS enabled).
CREATE OR REPLACE VIEW public.v_property_id_census AS
  SELECT property_id FROM public.properties;

GRANT SELECT ON public.v_property_id_census TO anon, authenticated;

COMMENT ON VIEW public.v_property_id_census IS
  'R22 mirror-reconcile: id-only, ALL-status property census (incl. archived). '
  'LCC prunes a mirror row only when its property_id is absent here (hard-gone).';
