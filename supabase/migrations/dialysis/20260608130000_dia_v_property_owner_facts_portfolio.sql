-- R8 Unit 1 (2026-06-08): dia owner-facts leg — closes the R6 gap (gov shipped
-- tier-0 domain-truth resolution; dia was deferred). This is the dia mirror of
-- gov.v_property_owner_facts_portfolio (gov 20260606120000): a slim, anon-
-- readable per-property OWNER-FACTS view so LCC's ownership-resolution gate can
-- consume dia's recorded_owner vs true_owner linkage (per-row domain truth that
-- OUTRANKS name patterns).
--
-- Why dia needs its own view: like gov, dia owner NAMES live in separate
-- recorded_owners / true_owners tables (UUID FKs on properties), not inline on
-- properties. LCC's BD mirror only carries true_owner-derived entities; for SPE
-- shells the LCC graph never consumed dia.properties.true_owner. Mirroring the
-- per-property recorded/true owner NAME lets the resolver use domain truth so
-- dia entities whose property's true_owner maps to a registered buyer parent
-- (Elliott Bay, Sumitomo/SMBC, ExchangeRight, AEI, Realty Income, Agree, ...)
-- flow through tier-0 into P-BUYER.
--
-- PII posture: NAMES ONLY (no phone/address/principals/notes), identical to the
-- gov view and to the existing true_owners anon exposure. dia.properties also
-- carries tenant / operator — those are deliberately NOT exposed here; this view
-- is owner facts only.
--
-- DEPLOY ORDERING: apply this BEFORE the LCC owner-facts sync extension
-- (lcc 20260608130000), which selects these columns over PostgREST. If the LCC
-- sync runs before this view exists it simply skips that page (404) — graceful,
-- the dia mirror stays empty until this lands (resolver/views behave exactly as
-- the gov-only R6 state, no regression).

BEGIN;

DROP VIEW IF EXISTS public.v_property_owner_facts_portfolio;

CREATE VIEW public.v_property_owner_facts_portfolio AS
SELECT
  p.property_id,
  ro.name      AS recorded_owner_name,
  to2.name     AS true_owner_name,
  p.developer  AS developer_name
FROM public.properties p
LEFT JOIN public.recorded_owners ro  ON ro.recorded_owner_id = p.recorded_owner_id
LEFT JOIN public.true_owners     to2 ON to2.true_owner_id    = p.true_owner_id;

GRANT SELECT ON public.v_property_owner_facts_portfolio TO anon, authenticated;

COMMENT ON VIEW public.v_property_owner_facts_portfolio IS
  'Per-property recorded_owner / true_owner / developer NAMES exposed for '
  'LCC R8 dia ownership-resolution (tier-0 domain truth). Names only — no PII '
  'contact fields, no tenant/operator. Plain (definer-privilege) view so anon '
  'can read while properties / recorded_owners / true_owners stay RLS-protected.';

COMMIT;
