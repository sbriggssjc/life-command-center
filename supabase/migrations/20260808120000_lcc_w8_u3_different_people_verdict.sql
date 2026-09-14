-- W8 U3 fix round (Prompt 71, 2026-08-08): add the `different_people` verdict to
-- the connection-propagation review lane.
--
-- CONTEXT: Scott's first live ?score=1 run showed the person-email pool model
-- confidently (0.95) finding "multiple DISTINCT names share this email" — a
-- candidate-RESOLVING finding — but the verdict vocabulary only had
-- link_proposal / no_evidence_found, so that finding was dumped into no_evidence
-- and lost (a producer with no consumer). `different_people` (person_email pool
-- ONLY) is now a first-class proposed_verdict: same VERBATIM-quote requirement as
-- link_proposal (the quote = the span showing the distinct names), and on human
-- confirm the deterministic writer resolves the merge candidate as DISTINCT + seeds
-- an entity_match_labels 'distinct' hard-negative (seeder w8_u3_shared_email) —
-- NEVER a merge, NEVER an auto-link. Still no merge/auto-link shape in the CHECK.
--
-- Additive + idempotent on LCC Opps (xengecqvemvfknjvbvrq). Reverse: restore the
-- prior 2-value CHECK (no different_people rows will exist unless the flag ran).

BEGIN;

ALTER TABLE public.w8_u3_link_review
  DROP CONSTRAINT IF EXISTS w8_u3_link_review_proposed_verdict_check;

ALTER TABLE public.w8_u3_link_review
  ADD CONSTRAINT w8_u3_link_review_proposed_verdict_check
  CHECK (proposed_verdict IN ('link_proposal', 'no_evidence_found', 'different_people'));

COMMENT ON COLUMN public.w8_u3_link_review.proposed_verdict IS
  'W8 U3: link_proposal (evidence names a missing party — chain + person pools) | different_people (person_email pool ONLY — the email-sharing records are DISTINCT people, resolves the merge candidate as distinct on confirm, NEVER a merge) | no_evidence_found (honest, quote-free). NO auto-merge/auto-link verdict exists.';

-- The Decision Center lane must surface different_people proposals too (not just
-- link_proposal). Re-create the open-lane view to include both proposable verdicts.
CREATE OR REPLACE VIEW public.v_w8_u3_link_review_open AS
SELECT review_id, subject_ref, pool, domain, source_property_id, gap, proposal_type,
       current_owner_entity_id, current_owner_name, winner_entity_id,
       proposed_verdict, linked_entity_name, role, confidence,
       evidence_quote, evidence_source, reason, rank_value,
       model_provider, model_name, source_run_id, created_at
  FROM public.w8_u3_link_review
 WHERE status = 'proposed'
   AND proposed_verdict IN ('link_proposal', 'different_people')
 ORDER BY confidence DESC, rank_value DESC NULLS LAST, created_at DESC;

GRANT SELECT ON public.v_w8_u3_link_review_open TO anon, authenticated, service_role;

-- Health tile: open_proposals must count BOTH proposable verdicts.
CREATE OR REPLACE VIEW public.v_lcc_w8_u3_link_health AS
WITH p AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS proposals_24h,
         count(*) FILTER (WHERE status = 'proposed' AND proposed_verdict IN ('link_proposal', 'different_people'))::int AS open_proposals,
         count(*) FILTER (WHERE status = 'proposed' AND proposed_verdict = 'different_people')::int AS open_different_people,
         count(*) FILTER (WHERE status = 'applied')::int AS applied_total,
         count(*) FILTER (WHERE status = 'rejected')::int AS rejected_total,
         max(created_at) AS latest_proposal_at
    FROM public.w8_u3_link_review
),
d AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS dropped_24h
    FROM public.w8_u3_dropped_log
),
f AS (
  SELECT state FROM public.feature_flags_registry
   WHERE flag = 'W8_U3_LINK_PROPAGATION' LIMIT 1
)
SELECT 'link_propagation'::text AS subsystem,
       'ollama_link_propagation'::text AS check_name,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off' THEN 'amber' ELSE 'green' END AS status,
       coalesce((SELECT open_proposals FROM p), 0)::int AS count,
       coalesce((SELECT latest_proposal_at FROM p), now()) AS first_seen,
       now() AS ts,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off'
            THEN 'W8_U3_LINK_PROPAGATION feature flag is off' ELSE NULL END AS last_error,
       NULL::text AS external_url,
       jsonb_build_object(
         'feature_flag_state', coalesce((SELECT state FROM f), 'off'),
         'proposals_24h', coalesce((SELECT proposals_24h FROM p), 0),
         'open_proposals', coalesce((SELECT open_proposals FROM p), 0),
         'open_different_people', coalesce((SELECT open_different_people FROM p), 0),
         'applied_total', coalesce((SELECT applied_total FROM p), 0),
         'rejected_total', coalesce((SELECT rejected_total FROM p), 0),
         'dropped_24h', coalesce((SELECT dropped_24h FROM d), 0),
         'latest_proposal_at', (SELECT latest_proposal_at FROM p)
       ) AS details;

GRANT SELECT ON public.v_lcc_w8_u3_link_health TO anon, authenticated, service_role;

COMMIT;
