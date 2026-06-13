-- ============================================================================
-- R15 Phase 2b (blocker 1) — cross-domain CRE owner reuse  ·  LCC Opps
--
-- The CRE owner mint (ensureCreOwnerEntity) resolved owners ONLY within
-- domain='cre' (the dedup lookup forced &domain=eq.cre), so it minted a BRAND-NEW
-- cre entity for an owner that already exists in dia/gov (or null-domain) —
-- duplicating the real owner AND leaving v_lcc_cre_cross_asset_owners at 0
-- (the CRE owner_entity_id never equalled the dia/gov portfolio owner's id).
--
-- This RPC lets the JS mint REUSE an existing entity by NORMALIZED name across
-- ALL domains — using the SAME normalizer the merge-candidate / lcc_apply_fuzzy_
-- merges machinery uses (lcc_normalize_entity_name: normalized-EXACT, no trigram),
-- so it is conservative by construction and never wrongly merges two real owners
-- ("Truist Bank" ≠ "Truist Financial"). Reusing the existing entity_id IS the
-- cross-asset link.
--
--   • Organizations only (entity_type='organization'). Person reuse is unsafe
--     (two different "John Smith") — the JS caller never asks for it.
--   • Ranks a portfolio-bearing owner first (that is the overlap-view payoff),
--     then a dia/gov-tagged owner, then deterministically by id (which also
--     dedupes within cre: a 2nd registration of the same owner reuses the 1st
--     cre row instead of minting another).
--   • Returns 0 rows when the normalized name is too short / null → the JS mints
--     a fresh cre entity (no confident reuse).
--
-- Additive + idempotent (CREATE OR REPLACE). Drop the function → JS falls back to
-- minting cre (graceful; cache-or-live). Apply anytime.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_match_existing_entity_for_cre(
  p_name         text,
  p_workspace_id uuid DEFAULT NULL
)
RETURNS TABLE(
  entity_id      uuid,
  entity_name    text,
  domain         text,
  portfolio_size bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_norm text;
BEGIN
  v_norm := public.lcc_normalize_entity_name(p_name);
  IF v_norm IS NULL THEN
    RETURN;  -- too short / null → no confident reuse
  END IF;

  RETURN QUERY
  WITH cand AS (
    SELECT
      e.id,
      e.name,
      e.domain AS dom,
      (SELECT count(*) FROM public.lcc_entity_portfolio_facts f WHERE f.entity_id = e.id) AS pf
    FROM public.entities e
    WHERE e.entity_type = 'organization'
      AND e.merged_into_entity_id IS NULL
      AND e.name IS NOT NULL
      AND (p_workspace_id IS NULL OR e.workspace_id = p_workspace_id)
      AND public.lcc_normalize_entity_name(e.name) = v_norm
  )
  SELECT cand.id, cand.name, cand.dom, cand.pf
  FROM cand
  ORDER BY
    cand.pf DESC,                                 -- portfolio owner first (the overlap payoff)
    (cand.dom IN ('dia', 'gov')) DESC NULLS LAST, -- then any domain-tagged owner
    cand.id                                       -- deterministic; dedupes within cre
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lcc_match_existing_entity_for_cre(text, uuid)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.lcc_match_existing_entity_for_cre(text, uuid) IS
  'R15 Phase 2b: best EXISTING organization entity matching p_name by lcc_normalize_entity_name (normalized-exact, the merge-candidate machinery''s rule). CRE owner mint reuses this id instead of minting a duplicate — that reuse is the cross-asset link.';
