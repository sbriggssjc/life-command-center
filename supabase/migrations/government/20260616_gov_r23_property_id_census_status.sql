-- R23 (2026-06-16): extend the gov property census with `status` so the LCC
-- mirror reconcile can prune SOFT-ARCHIVED gov properties (not just hard-gone
-- ones).
--
-- Background: R22 added v_property_id_census (id-only, ALL-status) and the LCC
-- reconcile prunes a mirror row only when its property_id is GENUINELY GONE from
-- gov.properties (a hard delete). R22 DELIBERATELY kept soft-archived rows. But
-- gov SOFT-deletes merged/sold/removed properties via status='archived' (6,662
-- rows = ~35% of the gov universe), and the sibling anon view
-- v_property_attributes_portfolio ALREADY excludes archived — so once a synced
-- property is archived in gov it is never refreshed AND never returned for
-- removal, leaving it permanently stale in the LCC value-ranking mirror. Those
-- 6,662 archived rows quietly inflate the R17 connected-value / representative-
-- property rank: a gov owner who SOLD or had merged/archived properties still
-- ranks by those dead assets.
--
-- Fix (R23 doctrine): archived = NOT a current BD asset. Exclude it from the
-- LCC value-ranking mirror by treating archived like gone FOR THE MIRROR. The
-- owner relationship persists via the owner's ACTIVE properties; archived assets
-- just stop inflating the value math.
--
-- This view now exposes `status` so the LCC reconcile can build its KEEP set as
-- "everything except status='archived'" and let the existing anti-join prune
-- archived + hard-gone in one pass. cmbs_discovery (38) and inactive (2) are
-- KEPT (only 'archived' is the clear exclude). PII-free: id + status only.
-- Owner = postgres so anon bypasses RLS exactly like the sibling v_*_portfolio
-- views (gov.properties has RLS enabled).
CREATE OR REPLACE VIEW public.v_property_id_census AS
  SELECT property_id, status FROM public.properties;

GRANT SELECT ON public.v_property_id_census TO anon, authenticated;

COMMENT ON VIEW public.v_property_id_census IS
  'R22/R23 mirror-reconcile: id + status property census (ALL statuses, incl. '
  'archived). LCC prunes a mirror row when its property_id is absent here '
  '(hard-gone) OR carries status=''archived'' (R23 soft-archive exclusion).';
