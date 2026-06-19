-- R46 (2026-06-19): resolve ownership chains to the original developer.
-- Units 2 + 3 (DB): value-ranked research-task generation for ALL incomplete
-- chains split by gap type + a workable "ownership chain" worklist view that
-- drives the Decision Center lane.
--
-- Builds on R6/R8 `v_lcc_ownership_chain_completeness`. Grounded live 2026-06-19:
-- gov 2,987 incomplete chains ($1.88B rent) / dia 547. The R6/R8 generator only
-- ever emitted `trace_ownership_to_developer`, capped at 100, AND its LIMIT
-- applied BEFORE the dedup filter (so it could never progress past the top set).
-- Live gap split: gov no_prior_owners_recorded=2,161 / developer_unidentified=826;
-- dia 47 / 500.
--
-- Cache-or-live safe: pure read-views + an idempotent generator; no domain
-- writes, no auth-schema touch.

BEGIN;

-- ---------------------------------------------------------------------------
-- (Unit 3, DB) Worklist view — every incomplete chain, joined to value, tagged
-- by gap type + the research_type that gap maps to. Single source of truth for
-- the gap→research_type mapping (the generator AND the lane both read it).
-- ---------------------------------------------------------------------------
-- NOTE: v_lcc_ownership_chain_completeness returns >1 row for ~72 properties
-- that carry multiple current-owner portfolio edges. DISTINCT ON collapses to
-- one row per (domain, property) — the highest-value edge — so the generator's
-- INSERT can never collide on the R21 uq_research_tasks_open_source index.
CREATE OR REPLACE VIEW public.v_ownership_chain_worklist
WITH (security_invoker = true) AS
SELECT DISTINCT ON (c.source_domain, c.source_property_id)
  c.source_domain,
  c.source_property_id,
  c.current_owner_entity_id,
  c.current_owner_name,
  c.workspace_id,
  c.true_owner_name,
  c.developer_name,
  c.owner_links,
  c.earliest_known_owner,
  c.address, c.city, c.state,
  c.current_annual_rent,
  COALESCE(NULLIF(c.current_annual_rent, 0), pa.annual_rent, 0)::numeric AS rank_value,
  c.missing_segments AS gap,
  CASE c.missing_segments
    WHEN 'no_prior_owners_recorded' THEN 'establish_ownership_history'
    WHEN 'developer_unidentified'   THEN 'trace_ownership_to_developer'
    ELSE 'trace_ownership_to_developer'
  END AS suggested_research_type
FROM public.v_lcc_ownership_chain_completeness c
LEFT JOIN public.lcc_property_attributes pa
  ON pa.source_domain = c.source_domain
 AND pa.source_property_id = c.source_property_id
WHERE c.chain_complete = false
ORDER BY c.source_domain, c.source_property_id,
         COALESCE(NULLIF(c.current_annual_rent, 0), pa.annual_rent, 0) DESC;

GRANT SELECT ON public.v_ownership_chain_worklist TO authenticated;

-- ---------------------------------------------------------------------------
-- (Unit 2) Research-task generation — covers ALL incomplete chains, value-ranked
-- ($ rent), split by gap type. Idempotent (one open task per property+gap+domain,
-- backed by the R21 unique index uq_research_tasks_open_source). A sweep first
-- skips open chain tasks whose property is now chain_complete OR whose gap type
-- changed (the next run re-creates the correct-gap task) — reversible (status only,
-- reason recorded in outcome).
--
-- Gap → research_type:
--   no_prior_owners_recorded → establish_ownership_history (directed county-deed lookup)
--   developer_unidentified   → trace_ownership_to_developer (trace back to developer)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_generate_chain_research_tasks(p_limit int DEFAULT 2000)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_inserted int;
  v_fallback_ws uuid;
BEGIN
  SELECT id INTO v_fallback_ws FROM public.workspaces ORDER BY created_at ASC LIMIT 1;

  -- (1) Sweep stale open chain tasks: complete OR gap-type changed.
  UPDATE public.research_tasks t
     SET status = 'skipped',
         outcome = COALESCE(t.outcome, '{}'::jsonb)
                   || jsonb_build_object('status','superseded',
                                         'reason','chain_gap_resolved_or_changed',
                                         'swept_at', now()),
         updated_at = now()
   WHERE t.source_table = 'v_lcc_ownership_chain_completeness'
     AND t.research_type IN ('trace_ownership_to_developer',
                             'establish_ownership_history',
                             'confirm_developer')
     AND t.status IN ('queued','in_progress')
     AND NOT EXISTS (
       SELECT 1 FROM public.v_ownership_chain_worklist w
       WHERE w.source_domain = t.domain
         AND w.source_property_id = t.source_record_id
         AND w.suggested_research_type = t.research_type
     );

  -- (2) Seed the top-N un-tasked incomplete chains by value. The NOT EXISTS is
  --     INSIDE cand (before LIMIT), so successive runs walk DOWN the ranked
  --     backlog instead of re-checking only the same top slice.
  WITH cand AS (
    SELECT w.*
    FROM public.v_ownership_chain_worklist w
    WHERE NOT EXISTS (
      SELECT 1 FROM public.research_tasks t
      WHERE t.research_type = w.suggested_research_type
        AND t.source_record_id = w.source_property_id
        AND t.domain = w.source_domain
        AND t.status IN ('queued','in_progress')
    )
    ORDER BY w.rank_value DESC NULLS LAST, w.source_domain, w.source_property_id
    LIMIT GREATEST(p_limit, 0)
  ),
  ins AS (
    INSERT INTO public.research_tasks (
      workspace_id, research_type, title, instructions,
      entity_id, domain, status, priority, source_record_id, source_table, metadata
    )
    SELECT
      COALESCE(cand.workspace_id, v_fallback_ws),
      cand.suggested_research_type,
      CASE cand.suggested_research_type
        WHEN 'establish_ownership_history'
          THEN 'Establish ownership history (pull county deeds): '
               || COALESCE(cand.address, 'property ' || cand.source_property_id)
        ELSE 'Trace ownership to the original developer: '
             || COALESCE(cand.address, 'property ' || cand.source_property_id)
      END,
      CASE cand.suggested_research_type
        WHEN 'establish_ownership_history'
          THEN 'No prior owners are recorded for ' || COALESCE(cand.address, 'this property')
               || '. The current owner ' || COALESCE(cand.current_owner_name, '(unknown)')
               || ' is a categorized buyer (acquisition, not development) but the deed chain '
               || 'was never ingested. Pull the county deed history via the property''s '
               || 'county-recorder portal and record each grantor→grantee transfer back to '
               || 'the original developer.'
        ELSE 'Current owner ' || COALESCE(cand.current_owner_name, '(unknown)')
             || ' is a categorized buyer (acquisition, not development). Trace '
             || COALESCE(cand.address, 'this property') || ' back through ownership_history + '
             || 'sales to the original developer, and connect each historical owner '
             || '(LCC entity + contact) so the chain is complete.'
      END,
      cand.current_owner_entity_id,
      cand.source_domain,
      'queued',
      LEAST(100, GREATEST(1, (cand.rank_value / 10000)::int)),
      cand.source_property_id,
      'v_lcc_ownership_chain_completeness',
      jsonb_strip_nulls(jsonb_build_object(
        'true_owner_name', cand.true_owner_name,
        'earliest_known_owner', cand.earliest_known_owner,
        'gap', cand.gap,
        'rank_value', cand.rank_value))
    FROM cand
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_generate_chain_research_tasks(int) FROM PUBLIC;

-- Daily generation at 05:10 (after the owner-facts mirror refresh). Idempotent
-- (re)registration; bump the per-tick bound off the R6 sliver of 100.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-r6-chain-research') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-r6-chain-research');
    PERFORM cron.schedule('lcc-r6-chain-research', '10 5 * * *', $$SELECT public.lcc_generate_chain_research_tasks(2000)$$);
  ELSE
    RAISE NOTICE 'pg_cron not installed; call lcc_generate_chain_research_tasks() manually.';
  END IF;
END $$;

COMMIT;
