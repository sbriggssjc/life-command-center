-- R6 (2026-06-06): expose a slim, anon-readable property OWNER-FACTS view so
-- LCC's ownership-resolution gate can consume the gov DB's recorded_owner vs
-- true_owner linkage (the "per-row domain truth" that OUTRANKS name patterns).
--
-- Why: LCC's BD mirror only carries true_owner-derived entities; for SPE shells
-- minted from the GSA lease lessor (e.g. "WASHINGTON DC VI FGF, LLC") the LCC
-- graph never consumed gov.properties.true_owner ("Boyd Watterson"). Grounding
-- against the live gov DB on 2026-06-06 showed the name pattern alone is unsafe
-- (only ~60% of "* FGF *" recorded owners are Boyd; the rest are Shooshan,
-- Hyundai Securities, Mountain Real Estate, Princeton Holdings, ...). The fix is
-- to mirror the per-property recorded/true owner NAME so the resolver can use
-- domain truth.
--
-- PII posture: NAMES ONLY (no phone/address/principals/notes), identical to the
-- existing v_ownership_history_portfolio / true_owners anon exposure. Some
-- true_owner names are individuals/trusts (beneficial owners) — that is the core
-- BD datum and is already anon-readable via the true_owners table.
--
-- DEPLOY ORDERING: apply this BEFORE the LCC owner-facts sync
-- (20260606122000_lcc_r6_owner_facts_sync.sql), which selects these columns over
-- PostgREST. If the LCC sync runs before this view exists it simply skips that
-- page (404) — graceful, but the mirror stays empty until this lands.

BEGIN;

DROP VIEW IF EXISTS public.v_property_owner_facts_portfolio;

CREATE VIEW public.v_property_owner_facts_portfolio AS
SELECT
  p.property_id,
  ro.name      AS recorded_owner_name,
  to2.name     AS true_owner_name,
  p.developer  AS developer_name
FROM public.properties p
LEFT JOIN public.recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
LEFT JOIN public.true_owners     to2 ON to2.true_owner_id    = p.true_owner_id;

GRANT SELECT ON public.v_property_owner_facts_portfolio TO anon, authenticated;

COMMENT ON VIEW public.v_property_owner_facts_portfolio IS
  'Per-property recorded_owner / true_owner / developer NAMES exposed for '
  'LCC R6 ownership-resolution (tier-0 domain truth). Names only — no PII '
  'contact fields. SECURITY DEFINER (default) so anon can read while '
  'properties / recorded_owners / true_owners stay RLS-protected.';

COMMIT;
