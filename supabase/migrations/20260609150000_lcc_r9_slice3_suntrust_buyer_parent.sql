-- R9 Slice 3 follow-up (2026-06-09): register SunTrust as a buyer parent,
-- make "registration IS the exclusion" robust, and restrict the developer
-- classifier to Signal A (the gate dropped the noisy Signal B).
-- ===========================================================================
-- Scott's disposition: SunTrust is a BANK whose fund operates as a WHOLESALE
-- BUYER (acquired the dia facilities via sale-leaseback). It was in the R5 dia
-- repeat-buyer grounding (28 txns / ~$98M) but never made the original 24-parent
-- registry, so the developer_name field "SunTrust" leaked it into the developer
-- classifier. Fix = full R5 treatment (register it), NOT a bespoke exclusion.
-- Anchor: "Suntrust Bank" (carries Salesforce account 0018W00002X0pFlQAJ ->
-- needs_sf_mapping=false). Role -> buyer. Spelling-variant buyer_parent patterns
-- let the prefix tier fold the SunTrust-named SPEs into the P-BUYER rollup.
--
-- Classifier robustness + correction:
--   (a) NAME-based registered-parent exclusion via lcc_match_buyer_parent_by_name
--       so any candidate whose name resolves to a REGISTERED buyer parent is
--       dropped ("registration is the exclusion"; generalizes to all parents).
--   (b) DROP Signal B (bts_multi_prop). Gate grounding showed it surfaces
--       net-lease REITs / brokers (Vereit, Netstreit, White Oak Healthcare REIT,
--       Societe Generale, Stan Johnson Co): a REIT acquiring a build-to-suit near
--       construction is the BUYER in a sale-leaseback, not the developer. The
--       classifier is now Signal A only (explicit developer_name = ground truth).
--       A precision-correct chain/BTS signal (builder vs first net-lease buyer)
--       is deferred.
--
-- Idempotent / additive. Caches refreshed.

BEGIN;

-- 1. Anchor role -> buyer (was 'unknown').
UPDATE public.entities
SET behavioral_override = 'buyer',
    behavioral_override_reason = 'r9_slice3: SunTrust fund = wholesale buyer (sale-leaseback), registered buyer parent',
    behavioral_override_at = now()
WHERE id = '3f674a99-c8e3-4f58-a790-e15207a5521d'   -- Suntrust Bank (has SF account)
  AND merged_into_entity_id IS NULL;

-- 2. Register the buyer parent (SF account present => needs_sf_mapping=false).
INSERT INTO public.lcc_buyer_parents
  (parent_entity_id, domain, sf_account_id, needs_sf_mapping, notes)
VALUES
  ('3f674a99-c8e3-4f58-a790-e15207a5521d', 'dia', '0018W00002X0pFlQAJ', false,
   'R9 Slice 3: SunTrust fund operates as wholesale buyer (sale-leaseback); R5 dia repeat-buyer (28 txns/~$98M) missed from the original 24-parent registry.')
ON CONFLICT (parent_entity_id) DO UPDATE
  SET sf_account_id = EXCLUDED.sf_account_id, needs_sf_mapping = EXCLUDED.needs_sf_mapping,
      notes = EXCLUDED.notes, updated_at = now();

-- 3. Spelling-variant buyer_parent patterns (the prefix tier folds SPEs).
INSERT INTO public.lcc_operator_affiliate_patterns
  (parent_entity_id, pattern_name, pattern_type, relationship, notes)
SELECT '3f674a99-c8e3-4f58-a790-e15207a5521d', x.pat, x.typ, 'buyer_parent', 'R9 Slice 3 SunTrust'
FROM (VALUES ('suntrust','exact'), ('suntrust bank','exact'), ('suntrust equity','exact'),
             ('suntrust %','prefix')) AS x(pat,typ)
ON CONFLICT (parent_entity_id, pattern_name, pattern_type) DO UPDATE SET relationship = 'buyer_parent';

-- 4. Classifier -> Signal A only + registered-parent name exclusion.
CREATE OR REPLACE VIEW public.v_lcc_developer_classification_candidates
WITH (security_invoker = true) AS
WITH named AS (
  SELECT pof.source_domain,
         public.lcc_normalize_entity_name(pof.developer_name) AS norm,
         min(pof.developer_name) AS candidate_name,
         count(*) AS props,
         COALESCE(sum( (SELECT max(pf.annual_rent) FROM public.lcc_entity_portfolio_facts pf
                        WHERE pf.source_domain = pof.source_domain AND pf.source_property_id = pof.source_property_id AND pf.is_current) ), 0) AS attributed_rent
  FROM public.lcc_property_owner_facts pof
  WHERE pof.developer_name IS NOT NULL AND btrim(pof.developer_name) <> ''
    AND public.lcc_normalize_entity_name(pof.developer_name) IS NOT NULL
  GROUP BY pof.source_domain, public.lcc_normalize_entity_name(pof.developer_name)
),
named_c AS (
  SELECT 'named_developer'::text AS signal, n.source_domain, n.candidate_name, n.norm,
         n.props, n.attributed_rent, e.id AS entity_id, COALESCE(e.behavioral_override, e.owner_role) AS cur_role
  FROM named n
  LEFT JOIN public.entities e ON e.canonical_name = n.norm AND e.merged_into_entity_id IS NULL AND e.entity_type = 'organization'
)
SELECT u.signal, u.source_domain, u.candidate_name, u.norm, u.props, u.attributed_rent, u.entity_id, u.cur_role
FROM named_c u
WHERE COALESCE(u.cur_role, '') NOT IN ('operator', 'developer')
  AND (u.entity_id IS NULL OR u.entity_id NOT IN (SELECT parent_entity_id FROM public.lcc_buyer_parents))
  AND (u.entity_id IS NULL OR u.entity_id NOT IN (SELECT entity_id FROM public.lcc_buyer_spe_resolved))
  AND NOT EXISTS (SELECT 1 FROM public.lcc_match_buyer_parent_by_name(u.candidate_name));

SELECT public.lcc_refresh_buyer_spe_resolved();

COMMIT;
