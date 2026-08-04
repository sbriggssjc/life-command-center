-- Prompt 32 (2026-08-04): Ollama cleaning-assist proposal layer.
--
-- LLM proposes; resolver/priority ladder/human confirms. This migration is
-- additive and idempotent on LCC Opps. It creates a proposal ledger attached to
-- the existing Decision Center subject keys, a Health-surface view, a visible
-- feature flag, and a pg_cron schedule that POSTs the Railway worker.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lcc_clean_assist_proposals (
  proposal_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source              text NOT NULL DEFAULT 'ollama_clean_assist'
                        CHECK (source = 'ollama_clean_assist'),
  source_run_id       text NOT NULL,
  decision_id         bigint REFERENCES public.lcc_decisions(id) ON DELETE SET NULL,
  decision_type       text NOT NULL,
  subject_ref         text NOT NULL,
  subject_domain      text,
  subject_property_id text,
  subject_entity_id   uuid,
  proposal_kind       text NOT NULL
                        CHECK (proposal_kind IN ('review_triage','unstructured_reconciliation','conflict_narration')),
  verdict             text NOT NULL
                        CHECK (verdict IN ('merge','not','uncertain','link','no_link','keep_current','accept_attempted','research')),
  reason              text NOT NULL,
  confidence          numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  proposed_link       jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflict_summary    text,
  model_provider      text,
  model_name          text,
  ai_tried            jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_hash         text,
  status              text NOT NULL DEFAULT 'proposed'
                        CHECK (status IN ('proposed','superseded','dismissed','accepted_as_hint')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_type, subject_ref, proposal_kind, source)
);

CREATE INDEX IF NOT EXISTS idx_clean_assist_proposals_open
  ON public.lcc_clean_assist_proposals (status, decision_type, created_at DESC)
  WHERE status = 'proposed';

CREATE INDEX IF NOT EXISTS idx_clean_assist_proposals_subject
  ON public.lcc_clean_assist_proposals (decision_type, subject_ref, created_at DESC);

COMMENT ON TABLE public.lcc_clean_assist_proposals IS
  'Prompt 32: local-Ollama cleaning-assist proposals attached to existing Decision Center subjects. Proposal only: no canonical data writes, no merges.';

CREATE OR REPLACE FUNCTION public.lcc_clean_assist_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lcc_clean_assist_touch ON public.lcc_clean_assist_proposals;
CREATE TRIGGER trg_lcc_clean_assist_touch
  BEFORE UPDATE ON public.lcc_clean_assist_proposals
  FOR EACH ROW EXECUTE FUNCTION public.lcc_clean_assist_touch();

GRANT SELECT ON public.lcc_clean_assist_proposals TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.v_lcc_clean_assist_latest AS
SELECT DISTINCT ON (decision_type, subject_ref, proposal_kind)
       proposal_id, source, source_run_id, decision_id, decision_type, subject_ref,
       subject_domain, subject_property_id, subject_entity_id, proposal_kind,
       verdict, reason, confidence, proposed_link, conflict_summary,
       model_provider, model_name, ai_tried, status, created_at, updated_at
  FROM public.lcc_clean_assist_proposals
 WHERE status = 'proposed'
 ORDER BY decision_type, subject_ref, proposal_kind, created_at DESC, proposal_id DESC;

GRANT SELECT ON public.v_lcc_clean_assist_latest TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.v_lcc_clean_assist_health AS
WITH p AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS proposals_24h,
         count(*) FILTER (WHERE status = 'proposed')::int AS open_proposals,
         max(created_at) AS latest_proposal_at
    FROM public.lcc_clean_assist_proposals
),
q AS (
  SELECT count(*) FILTER (WHERE status = 'open')::int AS review_queue_depth
    FROM public.lcc_decisions
),
f AS (
  SELECT state
    FROM public.feature_flags_registry
   WHERE flag = 'OLLAMA_CLEAN_ASSIST'
   LIMIT 1
)
SELECT 'clean_assist'::text AS subsystem,
       'ollama_clean_assist'::text AS check_name,
       CASE
         WHEN coalesce((SELECT state FROM f), 'off') = 'off' THEN 'amber'
         ELSE 'green'
       END AS status,
       coalesce((SELECT open_proposals FROM p), 0)::int AS count,
       coalesce((SELECT latest_proposal_at FROM p), now()) AS first_seen,
       now() AS ts,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off'
            THEN 'OLLAMA_CLEAN_ASSIST feature flag is off'
            ELSE NULL END AS last_error,
       NULL::text AS external_url,
       jsonb_build_object(
         'feature_flag_state', coalesce((SELECT state FROM f), 'off'),
         'proposals_24h', coalesce((SELECT proposals_24h FROM p), 0),
         'open_proposals', coalesce((SELECT open_proposals FROM p), 0),
         'review_queue_depth', coalesce((SELECT review_queue_depth FROM q), 0),
         'latest_proposal_at', (SELECT latest_proposal_at FROM p)
       ) AS details;

GRANT SELECT ON public.v_lcc_clean_assist_health TO anon, authenticated, service_role;

INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'OLLAMA_CLEAN_ASSIST',
  'P4 cleaning-assist layer: local Ollama proposes review-lane triage, unstructured record links, and field-conflict narration.',
  'api/admin.js?_route=ollama-clean-assist-tick + lcc_clean_assist_proposals + Decision Center',
  'OLLAMA_CLEAN_ASSIST',
  'off',
  DATE '2026-08-04',
  'Scott Briggs',
  'Proposal-only. Never merges, dedups, or writes canonical data. Flip to on after seeded proposal verification; OLLAMA_URL/OLLAMA_MODEL make local primary via invokeExtractionAI.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes,
      updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN
      PERFORM cron.unschedule('ollama-clean-assist-tick');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'ollama-clean-assist-tick',
      '22 * * * *',
      $cron$SELECT public.lcc_cron_post('/api/ollama-clean-assist-tick', '{"limit":12}'::jsonb, 'railway');$cron$
    );
  END IF;
END;
$$;

COMMIT;
