-- W8 U1 (Prompt 62, 2026-08-07): Ollama junk-entity pre-screen.
--
-- Hygiene campaign unit 1. Extends the prompt-32 Ollama clean-assist machinery
-- (proposal-only; Ollama proposes, a deterministic gate or a human lane
-- decides). This migration is additive + idempotent on LCC Opps
-- (xengecqvemvfknjvbvrq). It creates:
--   * junk_review_batch      — per-run + per-apply reversible ledger
--   * junk_entity_review     — the proposal rows (one per scored candidate)
--   * v_junk_entity_review_open  — the Decision Center federated-lane source
--   * v_lcc_junk_prescreen_health — Health-surface tile
--   * feature flag W8_U1_JUNK_PRESCREEN (default OFF, registered here per 36y)
--   * a nightly off-hours pg_cron POST to the Railway tick (no-ops while OFF)
--
-- DOCTRINE: never hard-delete; never delete FK-referenced rows. The apply path
-- SOFT-retires (a reversible marker) and routes FK-referenced rows to a conflict
-- card. All human-gated: no verdict, no write.
--
-- REVERSAL RUNBOOK
--   -- undo a single applied retirement (marker is stored per-row; the ledger
--   --   captures the old marker value in junk_review_batch.reversal):
--   SELECT * FROM public.junk_review_batch WHERE batch_kind='apply' AND status='applied';
--   -- each apply row's `reversal` jsonb carries { domain, table, pk, marker_col,
--   --   old_value } — re-PATCH old_value onto the row (cross-DB via the app), then
--   UPDATE public.junk_entity_review SET status='proposed', retired_at=NULL,
--          applied_batch_id=NULL WHERE review_id=<id>;
--   UPDATE public.junk_review_batch SET status='reversed' WHERE batch_id=<id>;
--   -- to retire the whole feature: flip the flag off (already default) — the
--   --   cron POST no-ops, and the tick GET stays a dry-run.

BEGIN;

-- Ledger — one row per tick run (batch_kind='scan') and one per applied verdict
-- (batch_kind='apply'). The apply rows carry the reversal payload.
CREATE TABLE IF NOT EXISTS public.junk_review_batch (
  batch_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_kind    text NOT NULL DEFAULT 'scan'
                  CHECK (batch_kind IN ('scan', 'apply')),
  source_run_id text NOT NULL,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'applied', 'conflict', 'reversed', 'dismissed')),
  domain        text,
  table_name    text,
  pk_value      text,
  review_id     bigint,
  actor         uuid,
  reversal      jsonb NOT NULL DEFAULT '{}'::jsonb,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_junk_review_batch_run
  ON public.junk_review_batch (source_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_junk_review_batch_apply
  ON public.junk_review_batch (batch_kind, status, created_at DESC);

COMMENT ON TABLE public.junk_review_batch IS
  'W8 U1: reversible ledger for the Ollama junk-entity pre-screen. scan rows = a tick run; apply rows = a human-confirmed soft-retire (reversal jsonb carries old marker value).';

-- Proposal rows. One per scored candidate, keyed by the federated subject_ref so
-- a re-scan is idempotent (merge-duplicates) and a decided subject is excluded.
CREATE TABLE IF NOT EXISTS public.junk_entity_review (
  review_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref      text NOT NULL UNIQUE,
  domain           text NOT NULL,
  table_name       text NOT NULL,
  pk_value         text NOT NULL,
  entity_name      text,
  heuristic        text NOT NULL,
  proposed_verdict text NOT NULL DEFAULT 'keep'
                     CHECK (proposed_verdict IN ('dismiss', 'rename', 'parse_contact', 'keep', 'uncertain')),
  confidence       numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  evidence_quote   text,
  reason           text,
  model_provider   text,
  model_name       text,
  source_run_id    text NOT NULL,
  scan_batch_id    bigint REFERENCES public.junk_review_batch(batch_id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed', 'dismissed', 'applied', 'conflict', 'accepted_edit', 'superseded')),
  applied_batch_id bigint REFERENCES public.junk_review_batch(batch_id) ON DELETE SET NULL,
  retired_at       timestamptz,
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_junk_entity_review_open
  ON public.junk_entity_review (status, confidence DESC, created_at DESC)
  WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_junk_entity_review_domain
  ON public.junk_entity_review (domain, table_name, status);

COMMENT ON TABLE public.junk_entity_review IS
  'W8 U1: Ollama junk-entity pre-screen proposals. Proposal-only; the verdict is human (junk_entity_review Decision Center lane). dismiss+confirm => soft-retire (reversible); FK-referenced => conflict.';

CREATE OR REPLACE FUNCTION public.junk_entity_review_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_junk_entity_review_touch ON public.junk_entity_review;
CREATE TRIGGER trg_junk_entity_review_touch
  BEFORE UPDATE ON public.junk_entity_review
  FOR EACH ROW EXECUTE FUNCTION public.junk_entity_review_touch();

GRANT SELECT ON public.junk_review_batch  TO anon, authenticated, service_role;
GRANT SELECT ON public.junk_entity_review TO anon, authenticated, service_role;

-- Federated-lane source: open proposals, value-ranked by confidence (most
-- confidently-junk first), capped downstream. The verdict-not-yet-cast set.
CREATE OR REPLACE VIEW public.v_junk_entity_review_open AS
SELECT review_id, subject_ref, domain, table_name, pk_value, entity_name,
       heuristic, proposed_verdict, confidence, evidence_quote, reason,
       model_provider, model_name, source_run_id, created_at
  FROM public.junk_entity_review
 WHERE status = 'proposed'
 ORDER BY confidence DESC, created_at DESC;

GRANT SELECT ON public.v_junk_entity_review_open TO anon, authenticated, service_role;

-- Health tile — flag state + open/24h proposal counts (mirrors the clean-assist
-- health view). amber while the flag is off (a flag-gated no-op must be visible).
CREATE OR REPLACE VIEW public.v_lcc_junk_prescreen_health AS
WITH p AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS proposals_24h,
         count(*) FILTER (WHERE status = 'proposed')::int AS open_proposals,
         count(*) FILTER (WHERE status = 'applied')::int  AS applied_total,
         count(*) FILTER (WHERE status = 'conflict')::int AS conflict_total,
         max(created_at) AS latest_proposal_at
    FROM public.junk_entity_review
),
f AS (
  SELECT state FROM public.feature_flags_registry
   WHERE flag = 'W8_U1_JUNK_PRESCREEN' LIMIT 1
)
SELECT 'junk_prescreen'::text AS subsystem,
       'ollama_junk_prescreen'::text AS check_name,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off' THEN 'amber' ELSE 'green' END AS status,
       coalesce((SELECT open_proposals FROM p), 0)::int AS count,
       coalesce((SELECT latest_proposal_at FROM p), now()) AS first_seen,
       now() AS ts,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off'
            THEN 'W8_U1_JUNK_PRESCREEN feature flag is off' ELSE NULL END AS last_error,
       NULL::text AS external_url,
       jsonb_build_object(
         'feature_flag_state', coalesce((SELECT state FROM f), 'off'),
         'proposals_24h', coalesce((SELECT proposals_24h FROM p), 0),
         'open_proposals', coalesce((SELECT open_proposals FROM p), 0),
         'applied_total', coalesce((SELECT applied_total FROM p), 0),
         'conflict_total', coalesce((SELECT conflict_total FROM p), 0),
         'latest_proposal_at', (SELECT latest_proposal_at FROM p)
       ) AS details;

GRANT SELECT ON public.v_lcc_junk_prescreen_health TO anon, authenticated, service_role;

-- Feature flag (36y rule: registered IN the migration, default OFF).
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'W8_U1_JUNK_PRESCREEN',
  'W8 U1 hygiene: deterministic junk-candidate pre-filter across dia/gov/ops entity tables, Ollama scores the candidate pool, proposals land in the junk_entity_review Decision Center lane for a human verdict.',
  'api/admin.js?_route=junk-prescreen-tick + junk_entity_review + Decision Center (junk_entity_review lane)',
  'W8_U1_JUNK_PRESCREEN',
  'off',
  DATE '2026-08-07',
  'Scott Briggs',
  'Proposal-only. dismiss+human-confirm => reversible soft-retire; FK-referenced => conflict card; never hard-delete. Flip on after the dry-run sample is reviewed. Uses OLLAMA_URL/OLLAMA_MODEL via invokeExtractionAI.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes,
      updated_at = now();

-- Nightly off-hours cron (03:40, mirrors the retrain-loop cadence). POSTs the
-- Railway tick; the tick itself no-ops while the flag is off, so this is inert
-- until the flag flips.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN
      PERFORM cron.unschedule('junk-prescreen-tick');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'junk-prescreen-tick',
      '40 3 * * *',
      $cron$SELECT public.lcc_cron_post('/api/junk-prescreen-tick', '{"apply":true,"limit":40}'::jsonb, 'railway');$cron$
    );
  END IF;
END;
$$;

COMMIT;
