-- R60 (2026-06-22): stop the research-task backlog runaway.
--
-- Grounded live 2026-06-22: 5,447 queued research_tasks, +4,061 in 7d vs 254
-- closed. Two producers fire into a void: establish_ownership_history (2,192,
-- gov 2,145 / dia 47 — NO consumer) + trace_ownership_to_developer (1,252,
-- gov 764 / dia 488 — consumer clears ~5%). All 3,444 are genuinely still-
-- incomplete chains, so the existing chain-complete sweep closes none of them.
--
-- Doctrine: a research task is only worklist if it is ACTIONABLE high-value.
-- R60 value-gates the producer (the R46 `lcc_generate_chain_research_tasks`) and
-- bulk-closes the below-floor backlog, so the Today "RESEARCH" number reflects
-- actionable high-value work, not raw producer output. The consumer
-- (developer-chain-resolve.js, Unit 2B) closes the structurally-unresolvable
-- trace buckets going forward; this migration honors those terminal verdicts so
-- a non-actionable chain is never re-seeded.
--
-- Reversible (status-only closes; lower the floor → the producer re-seeds the
-- still-incomplete above-floor chains). LCC-Opps only; no domain writes; no
-- auth-schema touch. Additive/idempotent.
--
--   p_min_value floor (default 500000 = $500k/yr rent): the single tuning knob.
--   At $500k the worklist lands at gov establish 645 + trace ~270, dia ~19 —
--   genuinely high-value assets. Lower it to widen the worklist (re-seeds).

BEGIN;

-- Re-create with the new (int, numeric) signature. CREATE OR REPLACE can't add a
-- parameter to the existing (int) function, so drop it first. The R6-chain-research
-- cron's 1-arg call still resolves (p_min_value uses its default); re-registered
-- below with the explicit floor for clarity.
DROP FUNCTION IF EXISTS public.lcc_generate_chain_research_tasks(int);

CREATE OR REPLACE FUNCTION public.lcc_generate_chain_research_tasks(
  p_limit int DEFAULT 2000,
  p_min_value numeric DEFAULT 500000
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_inserted int;
  v_fallback_ws uuid;
BEGIN
  SELECT id INTO v_fallback_ws FROM public.workspaces ORDER BY created_at ASC LIMIT 1;

  -- (1) Sweep A [Unit 2A] — close open chain tasks whose chain is no longer
  --     incomplete OR whose gap type changed (the property left the worklist).
  --     This is the "property now has ownership_history → owner_links grows →
  --     gap clears → close" path (e.g. R59 deed propagation feeding the portfolio
  --     mirror). Reversible (status only; reason in outcome).
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

  -- (2) Sweep B [Unit 3 value-gate / Unit 2 bulk-close] — close open chain tasks
  --     below the value floor: not actionable high-value work. Reversible; the
  --     seed gate (3) also requires rank_value >= floor, so a below-floor task is
  --     never re-created unless the floor is lowered.
  UPDATE public.research_tasks t
     SET status = 'skipped',
         outcome = COALESCE(t.outcome, '{}'::jsonb)
                   || jsonb_build_object('status','superseded',
                                         'reason','below_value_floor',
                                         'floor', p_min_value,
                                         'swept_at', now()),
         updated_at = now()
   FROM public.v_ownership_chain_worklist w
   WHERE w.source_domain = t.domain
     AND w.source_property_id = t.source_record_id
     AND w.suggested_research_type = t.research_type
     AND t.source_table = 'v_lcc_ownership_chain_completeness'
     AND t.research_type IN ('trace_ownership_to_developer','establish_ownership_history')
     AND t.status IN ('queued','in_progress')
     AND COALESCE(w.rank_value, 0) < p_min_value;

  -- (3) Seed the top un-tasked incomplete chains ABOVE the floor, value-ranked.
  --     Excludes properties that already carry an OPEN task (idempotent) OR a
  --     consumer-judged TERMINAL skip (outcome.terminal='true') — so a chain the
  --     developer-chain-resolve consumer found structurally unresolvable
  --     (origin_is_person / origin_not_developer / no_chain / ambiguous-no-external)
  --     is never re-seeded (no churn). The NOT EXISTS is INSIDE cand (before LIMIT)
  --     so successive runs walk DOWN the ranked backlog.
  WITH cand AS (
    SELECT w.*
    FROM public.v_ownership_chain_worklist w
    WHERE COALESCE(w.rank_value, 0) >= p_min_value
      AND NOT EXISTS (
        SELECT 1 FROM public.research_tasks t
        WHERE t.research_type = w.suggested_research_type
          AND t.source_record_id = w.source_property_id
          AND t.domain = w.source_domain
          AND (t.status IN ('queued','in_progress')
               OR (t.status = 'skipped' AND COALESCE(t.outcome->>'terminal','') = 'true'))
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

REVOKE ALL ON FUNCTION public.lcc_generate_chain_research_tasks(int, numeric) FROM PUBLIC;

-- Re-register the producer cron with the explicit floor (idempotent).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-r6-chain-research') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-r6-chain-research');
    PERFORM cron.schedule('lcc-r6-chain-research', '10 5 * * *',
      $cron$SELECT public.lcc_generate_chain_research_tasks(2000, 500000)$cron$);
  END IF;
END $$;

-- [Unit 1] Drain the resolvable: the developer-chain-resolve consumer runs more
-- often so resolvable trace tasks complete and unresolvable ones close (Unit 2B).
-- Gentle cadence (artifact-offload connection-budget lesson): every 6h, capped.
-- gov only (dia developer-resolution is a documented follow-up — the dia signal
-- is thin and the dia backlog is value-gated to ~19). No-ops until the endpoint
-- ships on the Railway redeploy (POST 404s gracefully).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-uw7-developer-chain') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-uw7-developer-chain');
    PERFORM cron.schedule('lcc-uw7-developer-chain', '0 */6 * * *',
      $cron$SELECT public.lcc_cron_post('/api/developer-chain-resolve-tick?domain=gov&limit=50', '{}'::jsonb, 'vercel')$cron$);
  END IF;
END $$;

COMMIT;
