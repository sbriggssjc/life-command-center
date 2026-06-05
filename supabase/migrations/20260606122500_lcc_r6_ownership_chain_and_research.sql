-- R6 (2026-06-06): ownership-resolution gating. File 4 of 4 (LCC Opps).
-- Ownership chain back to the developer (Task 3). Phases (a) chain-completeness
-- metric + (b) research-task generation. Phase (c) connecting each historical
-- chain owner (ensureEntityLink + contact linkage) rides the existing entity-
-- link machinery and is DEFERRED — see the PR notes.
--
-- gov first (dia mirrors the pattern once the dia owner-facts leg is wired). A
-- property whose CURRENT owner is a categorized BUYER is, by doctrine, an
-- acquisition not a development — its ownership history should trace back to an
-- identified developer. This surfaces the gaps and feeds them to the existing
-- research_tasks machinery as "trace ownership to developer" tasks.

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Chain-completeness metric, per gov property with a buyer as current owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_ownership_chain_completeness
WITH (security_invoker = true) AS
WITH cur AS (
  SELECT pf.source_domain, pf.source_property_id, pf.entity_id,
         e.name AS current_owner_name, e.workspace_id, e.domain
  FROM public.lcc_entity_portfolio_facts pf
  JOIN public.entities e ON e.id = pf.entity_id AND e.merged_into_entity_id IS NULL
  WHERE pf.is_current = true AND pf.source_domain = 'gov'
    AND COALESCE(e.behavioral_override, e.owner_role) = 'buyer'
),
chain AS (
  SELECT pf.source_domain, pf.source_property_id,
         count(*) AS owner_links,
         min(pf.ownership_start_date) AS earliest_start,
         (array_agg(e.name ORDER BY pf.ownership_start_date ASC NULLS FIRST))[1] AS earliest_known_owner,
         bool_or(COALESCE(e.behavioral_override, e.owner_role) = 'developer') AS has_developer_in_chain
  FROM public.lcc_entity_portfolio_facts pf
  JOIN public.entities e ON e.id = pf.entity_id AND e.merged_into_entity_id IS NULL
  GROUP BY pf.source_domain, pf.source_property_id
)
SELECT
  cur.source_domain,
  cur.source_property_id,
  cur.entity_id        AS current_owner_entity_id,
  cur.current_owner_name,
  cur.workspace_id,
  pof.true_owner_name,
  pof.developer_name,
  ch.owner_links,
  ch.earliest_known_owner,
  ch.earliest_start,
  COALESCE(ch.has_developer_in_chain, false) AS has_developer_in_chain,
  pa.address, pa.city, pa.state, pa.building_size_sqft,
  COALESCE(f.annual_rent, 0)::numeric AS current_annual_rent,
  (pof.developer_name IS NOT NULL OR COALESCE(ch.has_developer_in_chain, false)) AS chain_complete,
  CASE
    WHEN (pof.developer_name IS NOT NULL OR COALESCE(ch.has_developer_in_chain, false)) THEN NULL
    WHEN COALESCE(ch.owner_links, 0) <= 1 THEN 'no_prior_owners_recorded'
    ELSE 'developer_unidentified'
  END AS missing_segments
FROM cur
LEFT JOIN chain ch
  ON ch.source_domain = cur.source_domain AND ch.source_property_id = cur.source_property_id
LEFT JOIN public.lcc_property_owner_facts pof
  ON pof.source_domain = cur.source_domain AND pof.source_property_id = cur.source_property_id
LEFT JOIN public.lcc_property_attributes pa
  ON pa.source_domain = cur.source_domain AND pa.source_property_id = cur.source_property_id
LEFT JOIN public.lcc_entity_portfolio_facts f
  ON f.entity_id = cur.entity_id AND f.source_domain = cur.source_domain
 AND f.source_property_id = cur.source_property_id AND f.is_current = true;

GRANT SELECT ON public.v_lcc_ownership_chain_completeness TO authenticated;

-- ---------------------------------------------------------------------------
-- (b) Research-task generation — feed chain-incomplete properties to the
--     existing research_tasks machinery, prioritized by property value (rent).
--     Idempotent: one open ('queued'/'in_progress') task per property.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_generate_chain_research_tasks(p_limit int DEFAULT 100)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_inserted int;
BEGIN
  WITH cand AS (
    SELECT c.*
    FROM public.v_lcc_ownership_chain_completeness c
    WHERE c.chain_complete = false
    ORDER BY c.current_annual_rent DESC NULLS LAST, c.source_property_id
    LIMIT GREATEST(p_limit, 0)
  ),
  ins AS (
    INSERT INTO public.research_tasks (
      workspace_id, research_type, title, instructions,
      entity_id, domain, status, priority, source_record_id, source_table, metadata
    )
    SELECT
      cand.workspace_id,
      'trace_ownership_to_developer',
      'Trace ownership to the original developer: ' || COALESCE(cand.address, 'property ' || cand.source_property_id),
      'Current owner ' || COALESCE(cand.current_owner_name, '(unknown)')
        || ' is a categorized buyer (acquisition, not development). Trace '
        || COALESCE(cand.address, 'this property') || ' back through ownership_history + '
        || 'sales to the original developer, and connect each historical owner '
        || '(LCC entity + contact) so the chain is complete.'
        || CASE WHEN cand.missing_segments IS NOT NULL THEN ' Gap: ' || cand.missing_segments ELSE '' END,
      cand.current_owner_entity_id,
      'gov',
      'queued',
      LEAST(100, GREATEST(1, (cand.current_annual_rent / 10000)::int)),
      cand.source_property_id,
      'v_lcc_ownership_chain_completeness',
      jsonb_strip_nulls(jsonb_build_object(
        'true_owner_name', cand.true_owner_name,
        'earliest_known_owner', cand.earliest_known_owner,
        'missing_segments', cand.missing_segments,
        'current_annual_rent', cand.current_annual_rent))
    FROM cand
    WHERE NOT EXISTS (
      SELECT 1 FROM public.research_tasks t
      WHERE t.research_type = 'trace_ownership_to_developer'
        AND t.source_record_id = cand.source_property_id
        AND t.domain = 'gov'
        AND t.status IN ('queued','in_progress')
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_generate_chain_research_tasks(int) FROM PUBLIC;

-- Daily generation at 05:10 (after the owner-facts mirror refresh at 04:50/55,
-- so developer_name/chain signal is fresh). Idempotent (re)registration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-r6-chain-research') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-r6-chain-research');
    PERFORM cron.schedule('lcc-r6-chain-research', '10 5 * * *', $$SELECT public.lcc_generate_chain_research_tasks(100)$$);
  ELSE
    RAISE NOTICE 'pg_cron not installed; call lcc_generate_chain_research_tasks() manually.';
  END IF;
END $$;

COMMIT;
