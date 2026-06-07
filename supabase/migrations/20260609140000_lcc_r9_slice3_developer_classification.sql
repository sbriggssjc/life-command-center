-- R9 Slice 3 (2026-06-09): developer classification + chain research reconciliation.
-- ===========================================================================
-- Unit 2 #2/#3. Three additive artifacts (the worker that drains them lives in
-- api/admin.js handleChainClassifyTick -> /api/chain-classify-tick; crons are
-- registered LAST, post-deploy + post-Scott-blessing of the top-10 list):
--
-- 1. CLEANUP of the legacy owner_role='developer' mistags on CONFIRMED buyer
--    SPE shells. Grounding (2026-06-09) found 123 entities (gov 122, dia 1) that
--    resolve to a buyer parent (in lcc_buyer_spe_resolved) yet carry
--    owner_role/behavioral_override='developer' from the noisy dia/gov BTS
--    classifier (Tucson AZ IV SGF, GLENDALE GSA, ...). A confirmed buyer SPE is
--    definitionally NOT a developer. Correct via behavioral_override='buyer'
--    (reversible, existing role machinery) -- NEVER a registered parent, never
--    hard-deleted. This also lets Slice-3's developer-role precedence be added
--    later without dropping the shells.
--
-- 2. v_lcc_developer_classification_candidates -- the conservative CLASSIFIER
--    RULE, inspectable. Two precision-first signals (the literal "earliest owner
--    + BTS-timing" rule alone produced single-property individuals -- the gate
--    caught it; retuned):
--      * SIGNAL A 'named_developer' (ground truth): the property's explicit
--        developer_name field (dia 304 / gov 17 properties). The named party IS
--        the developer. Ranked by attributed property rent.
--      * SIGNAL B 'bts_multi_prop': the chain's earliest owner ONLY when it is a
--        multi-property ORGANIZATION (>=2 current properties) that acquired
--        within ~2yr of construction -- excludes the single-asset individuals /
--        address-LLCs the raw BTS signal mislabeled.
--    Both EXCLUDE: registered buyer parents (buyer registry precedence wins),
--    confirmed buyer-SPE shells, and entities already classified operator or
--    developer (don't reclassify DaVita/Fresenius operators or re-tag).
--
-- 3. lcc_reconcile_chain_research_tasks() -- closes the loop: marks open
--    trace_ownership_to_developer research_tasks 'completed' once their property
--    is chain_complete=true (the chain view flips automatically when a developer
--    entity is connected + tagged). Idempotent.
--
-- DB-safety: additive / CREATE OR REPLACE / one bounded UPDATE; no auth-schema
-- contact; entity-scale. The classifier DRAIN (minting + tagging) and the crons
-- are deliberately NOT here -- they run after Scott blesses the top-10.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Cleanup: confirmed buyer-SPE shells must not carry the 'developer' mistag.
-- ---------------------------------------------------------------------------
UPDATE public.entities e
SET behavioral_override = 'buyer',
    behavioral_override_reason = 'r9_slice3: confirmed buyer-SPE shell, not a developer',
    behavioral_override_at = now()
WHERE e.merged_into_entity_id IS NULL
  AND COALESCE(e.behavioral_override, e.owner_role) = 'developer'
  AND e.id IN (SELECT entity_id FROM public.lcc_buyer_spe_resolved)
  AND e.id NOT IN (SELECT parent_entity_id FROM public.lcc_buyer_parents);

-- ---------------------------------------------------------------------------
-- 2. The classifier rule as an inspectable view (consumed by the worker).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_developer_classification_candidates
WITH (security_invoker = true) AS
WITH named AS (  -- SIGNAL A: explicitly-named developers (developer_name field)
  SELECT pof.source_domain,
         public.lcc_normalize_entity_name(pof.developer_name) AS norm,
         min(pof.developer_name) AS candidate_name,
         count(*) AS props,
         COALESCE(sum( (SELECT max(pf.annual_rent)
                        FROM public.lcc_entity_portfolio_facts pf
                        WHERE pf.source_domain = pof.source_domain
                          AND pf.source_property_id = pof.source_property_id
                          AND pf.is_current) ), 0) AS attributed_rent
  FROM public.lcc_property_owner_facts pof
  WHERE pof.developer_name IS NOT NULL AND btrim(pof.developer_name) <> ''
    AND public.lcc_normalize_entity_name(pof.developer_name) IS NOT NULL
  GROUP BY pof.source_domain, public.lcc_normalize_entity_name(pof.developer_name)
),
named_c AS (
  SELECT 'named_developer'::text AS signal, n.source_domain, n.candidate_name, n.norm,
         n.props, n.attributed_rent, e.id AS entity_id,
         COALESCE(e.behavioral_override, e.owner_role) AS cur_role
  FROM named n
  LEFT JOIN public.entities e
    ON e.canonical_name = n.norm AND e.merged_into_entity_id IS NULL
   AND e.entity_type = 'organization'
),
bts AS (  -- earliest owner ENTITY per incomplete-chain property
  SELECT DISTINCT ON (c.source_domain, c.source_property_id)
    c.source_domain, c.source_property_id, pf.entity_id,
    pf.ownership_start_date, pa.year_built
  FROM public.v_lcc_ownership_chain_completeness c
  JOIN public.lcc_entity_portfolio_facts pf
    ON pf.source_domain = c.source_domain AND pf.source_property_id = c.source_property_id
  JOIN public.entities e ON e.id = pf.entity_id
   AND e.merged_into_entity_id IS NULL AND e.entity_type = 'organization'
  LEFT JOIN public.lcc_property_attributes pa
    ON pa.source_domain = c.source_domain AND pa.source_property_id = c.source_property_id
  WHERE c.chain_complete = false
  ORDER BY c.source_domain, c.source_property_id, pf.ownership_start_date ASC NULLS LAST
),
bts_c AS (  -- SIGNAL B: multi-property org earliest owner, BTS timing
  SELECT 'bts_multi_prop'::text AS signal, b.source_domain, e.name AS candidate_name,
         e.canonical_name AS norm, count(*) AS props,
         COALESCE(sum( (SELECT max(pf.annual_rent)
                        FROM public.lcc_entity_portfolio_facts pf
                        WHERE pf.source_domain = b.source_domain
                          AND pf.source_property_id = b.source_property_id
                          AND pf.is_current) ), 0) AS attributed_rent,
         b.entity_id, COALESCE(e.behavioral_override, e.owner_role) AS cur_role
  FROM bts b
  JOIN public.entities e ON e.id = b.entity_id
  WHERE b.year_built IS NOT NULL AND b.ownership_start_date IS NOT NULL
    AND (extract(year FROM b.ownership_start_date)::int - b.year_built) BETWEEN 0 AND 2
    AND (SELECT count(*) FROM public.lcc_entity_portfolio_facts pf2
         WHERE pf2.entity_id = b.entity_id AND pf2.is_current) >= 2
  GROUP BY b.source_domain, e.name, e.canonical_name, b.entity_id,
           COALESCE(e.behavioral_override, e.owner_role)
)
SELECT u.signal, u.source_domain, u.candidate_name, u.norm, u.props,
       u.attributed_rent, u.entity_id, u.cur_role
FROM (
  SELECT signal, source_domain, candidate_name, norm, props, attributed_rent, entity_id, cur_role FROM named_c
  UNION ALL
  SELECT signal, source_domain, candidate_name, norm, props, attributed_rent, entity_id, cur_role FROM bts_c
) u
WHERE COALESCE(u.cur_role, '') NOT IN ('operator', 'developer')   -- don't reclassify operators; skip already-developer
  AND (u.entity_id IS NULL OR u.entity_id NOT IN (SELECT parent_entity_id FROM public.lcc_buyer_parents))
  AND (u.entity_id IS NULL OR u.entity_id NOT IN (SELECT entity_id FROM public.lcc_buyer_spe_resolved));

GRANT SELECT ON public.v_lcc_developer_classification_candidates TO authenticated;

COMMENT ON VIEW public.v_lcc_developer_classification_candidates IS
  'R9 Slice 3 conservative developer classifier (inspectable rule). Signal A = '
  'explicit developer_name (ground truth); Signal B = multi-property org earliest '
  'owner with build-to-suit timing. Excludes registered buyer parents, confirmed '
  'buyer-SPE shells, and current operators/developers. Drained by '
  'api/admin.js handleChainClassifyTick (mint-or-find via ensureEntityLink, then '
  'behavioral_override=developer). Self-excludes tagged entities => idempotent.';

-- ---------------------------------------------------------------------------
-- 3. Research-task reconciliation: complete trace_ownership_to_developer tasks
--    whose property is now chain_complete (developer identified + connected).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_reconcile_chain_research_tasks(p_limit int DEFAULT 1000)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_done int;
BEGIN
  WITH target AS (
    SELECT t.id
    FROM public.research_tasks t
    JOIN public.v_lcc_ownership_chain_completeness c
      ON c.source_domain = t.domain
     AND c.source_property_id = t.source_record_id::text
     AND c.chain_complete = true
    WHERE t.research_type = 'trace_ownership_to_developer'
      AND t.status IN ('queued', 'in_progress')
    LIMIT GREATEST(p_limit, 0)
  ),
  upd AS (
    UPDATE public.research_tasks t
    SET status = 'completed', completed_at = now(), updated_at = now(),
        outcome = COALESCE(t.outcome, 'chain_complete: developer identified & connected (r9_slice3)')
    FROM target WHERE t.id = target.id
    RETURNING 1
  )
  SELECT count(*) INTO v_done FROM upd;
  RETURN v_done;
END; $$;

REVOKE ALL ON FUNCTION public.lcc_reconcile_chain_research_tasks(int) FROM PUBLIC;

COMMIT;
