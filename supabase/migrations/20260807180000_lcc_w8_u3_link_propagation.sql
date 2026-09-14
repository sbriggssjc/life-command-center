-- W8 U3 (Prompt 69, 2026-08-07): Ollama connection propagation — evidence-grounded
-- link proposals.
--
-- Hygiene campaign unit 3. Reuses U1/U2's shapes (pure planner module, GET dry-run
-- / ?score=1&n= inline sample / POST flag-gated tick, reversible batch ledger, in-
-- migration flag registration, nightly no-op-while-off cron, bounded+resumable
-- scoring) — it does NOT fork a new pattern. Additive + idempotent on LCC Opps
-- (xengecqvemvfknjvbvrq).
--
-- DOCTRINE (non-negotiable): Ollama PROPOSES a missing connection ONLY from
-- evidence LCC already holds, quoted VERBATIM (W7.4-style validator — the quote
-- must be a whitespace-normalized substring of the supplied evidence or the
-- proposal is DROPPED + logged, never shipped). A HUMAN confirm lane decides; a
-- deterministic writer applies with provenance (fill-blanks, field_source_priority
-- rows registered below so v_field_provenance_unranked stays 0). NEVER fabricate:
-- no evidence found ⇒ no proposal (counted). No web search (owner-contact-websearch
-- is PAUSED — internal evidence only).
--
-- PREMISE (verified live 2026-08-07): lcc_chain_unresolvable is EMPTY (0 rows) —
-- this unit builds against the LIVE gap surfaces instead:
--   * v_ownership_chain_worklist        (~3,405, ranked by rank_value)
--   * v_lcc_person_email_merge_candidates (~257, already-computed person-merges)
--
-- This migration creates:
--   * w8_u3_link_batch          — per-run reversible scan ledger (sibling of dup_pair_batch)
--   * w8_u3_link_review          — the proposed-link rows (one per gap/candidate)
--   * w8_u3_link_apply_log       — the deterministic-writer reversal ledger
--   * w8_u3_dropped_log          — the precision-floor metric (validator drops)
--   * v_w8_u3_link_review_open   — the Decision Center lane source (open proposals)
--   * v_lcc_w8_u3_link_health    — Health-surface tile
--   * field_source_priority rows for source 'w8_u3_link_propagation' (rank 85,
--     below all record sources) so the writer's provenance stamps are ranked
--   * feature flag W8_U3_LINK_PROPAGATION (default OFF, registered here per 36y)
--   * a nightly off-hours pg_cron POST to /api/link-propagation-tick (4:10 UTC,
--     after U1 03:40 + U2 03:50; no-ops while OFF)
--
-- REVERSAL RUNBOOK
--   -- This unit writes NO canonical data until a HUMAN accepts a proposal. On
--   --   accept the deterministic writer creates an entity_relationships edge +
--   --   stamps field_provenance; every write is logged to w8_u3_link_apply_log.
--   -- To retire a whole scan batch's un-worked proposals:
--   SELECT * FROM public.w8_u3_link_batch WHERE status='open' ORDER BY created_at DESC;
--   DELETE FROM public.w8_u3_link_review
--     WHERE scan_batch_id=<id> AND status='proposed';   -- worked rows are kept
--   -- To reverse an APPLIED link (accepted proposal):
--   SELECT * FROM public.w8_u3_link_apply_log WHERE status='applied' ORDER BY created_at DESC;
--   --   each row carries reversal={relationship_id, created_entity_id?, provenance_ids[]};
--   --   delete the entity_relationships row by id (+ the minted entity if created_entity_id
--   --   is set and it is otherwise unreferenced), then flip the log row status='reversed'.
--   -- To retire the feature: flip W8_U3_LINK_PROPAGATION off (default) — the cron
--   --   POST no-ops and the tick GET stays a dry-run.

BEGIN;

-- Reversible scan ledger — one row per tick run (batch_kind='scan'). Mirrors
-- w8_u2_dup_pair_batch so the ops/reversal muscle-memory carries over. The
-- resumable scored-marker cursors live in details.scan_cursors.
CREATE TABLE IF NOT EXISTS public.w8_u3_link_batch (
  batch_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_kind    text NOT NULL DEFAULT 'scan'
                  CHECK (batch_kind IN ('scan')),
  source_run_id text NOT NULL,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'closed', 'reversed')),
  actor         uuid,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_w8_u3_link_batch_run
  ON public.w8_u3_link_batch (source_run_id, created_at DESC);

COMMENT ON TABLE public.w8_u3_link_batch IS
  'W8 U3: reversible ledger for the Ollama connection-propagation tick. scan rows = a run (details carry per-pool generated/scored/proposed/no_evidence/dropped counts + resumable scan_cursors + the evidence-hash scored markers).';

-- Proposed-link rows. One per scored gap/candidate, keyed by subject_ref
-- (link:chain:<dom>:<propId>:<gap> | link:pmail:<winnerId>) so a re-scan is
-- idempotent (merge-duplicates) and a decided row is excluded from re-proposal.
CREATE TABLE IF NOT EXISTS public.w8_u3_link_review (
  review_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref      text NOT NULL UNIQUE,
  pool             text NOT NULL                    -- 'chain' | 'person_email'
                     CHECK (pool IN ('chain', 'person_email')),
  domain           text NOT NULL,                   -- 'lcc' | 'gov' | 'dia'
  -- Gap-side identity (the row the gap belongs to).
  source_property_id text,                          -- chain pool
  gap              text,                            -- chain pool: developer_unidentified | no_prior_owners_recorded
  proposal_type    text NOT NULL,                   -- developer_link | prior_owner_link | person_email_merge
  current_owner_entity_id text,                     -- chain: the current owner (edge endpoint)
  current_owner_name text,
  winner_entity_id text,                            -- person_email pool
  -- The PROPOSAL (proposal-only; a human confirm-lane decides; the writer applies).
  proposed_verdict text NOT NULL DEFAULT 'no_evidence_found'
                     CHECK (proposed_verdict IN ('link_proposal', 'no_evidence_found')),
  linked_entity_name text,                          -- the proposed missing party
  role             text,                            -- developed | owns | prior_owner | same_person
  confidence       numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  evidence_quote   text,                            -- VERBATIM (validated) span
  evidence_source  text,                            -- the [E#] block tag / source ref
  evidence_hash    text,                            -- resumable scored-marker key
  reason           text,
  rank_value       numeric,
  seeder           text NOT NULL DEFAULT 'w8_u3_link_propagation',
  model_provider   text,
  model_name       text,
  source_run_id    text NOT NULL,
  scan_batch_id    bigint REFERENCES public.w8_u3_link_batch(batch_id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed', 'applied', 'rejected', 'conflict', 'superseded')),
  applied_log_id   bigint,
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_w8_u3_link_review_open
  ON public.w8_u3_link_review (status, confidence DESC, rank_value DESC NULLS LAST, created_at DESC)
  WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_w8_u3_link_review_pool
  ON public.w8_u3_link_review (pool, domain, status);

COMMENT ON TABLE public.w8_u3_link_review IS
  'W8 U3: Ollama connection-propagation PROPOSALS (seeder w8_u3_link_propagation). Proposal-only — every proposed_verdict=link_proposal carries a VERBATIM evidence_quote (validator-enforced). A HUMAN verdict (Decision Center w8_u3_link_review lane) applies via the deterministic writer (entity_relationships edge + provenance). NEVER an auto-write.';

CREATE OR REPLACE FUNCTION public.w8_u3_link_review_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_w8_u3_link_review_touch ON public.w8_u3_link_review;
CREATE TRIGGER trg_w8_u3_link_review_touch
  BEFORE UPDATE ON public.w8_u3_link_review
  FOR EACH ROW EXECUTE FUNCTION public.w8_u3_link_review_touch();

-- The deterministic-writer reversal ledger — one row per APPLIED link (human
-- accept). reversal carries what to undo (relationship_id, minted entity, provenance).
CREATE TABLE IF NOT EXISTS public.w8_u3_link_apply_log (
  apply_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_id      bigint REFERENCES public.w8_u3_link_review(review_id) ON DELETE SET NULL,
  subject_ref    text NOT NULL,
  source_run_id  text NOT NULL DEFAULT 'verdict',
  status         text NOT NULL DEFAULT 'applied'
                   CHECK (status IN ('applied', 'reversed', 'conflict')),
  actor          uuid,
  reversal       jsonb NOT NULL DEFAULT '{}'::jsonb,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_w8_u3_link_apply_log_review
  ON public.w8_u3_link_apply_log (review_id, created_at DESC);

COMMENT ON TABLE public.w8_u3_link_apply_log IS
  'W8 U3: reversible ledger for accepted link proposals. reversal={relationship_id, created_entity_id?, provenance_ids[]} — the writer records it BEFORE mutating so an accept is always undoable.';

-- The precision-floor metric (W7.4 pattern): every proposal the validator DROPPED
-- (fabricated / non-verbatim / no-entity quote). Logged for audit, NEVER surfaced.
CREATE TABLE IF NOT EXISTS public.w8_u3_dropped_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref    text,
  pool           text,
  domain         text,
  proposed_verdict text,
  linked_entity_name text,
  quote          text,
  reason         text NOT NULL,        -- no_entity_named | no_quote | quote_not_verbatim | below_confidence
  source_run_id  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_w8_u3_dropped_log_run
  ON public.w8_u3_dropped_log (source_run_id, created_at DESC);

COMMENT ON TABLE public.w8_u3_dropped_log IS
  'W8 U3: evidence-validator drops (non-verbatim / fabricated / below-confidence link proposals). The free precision floor — logged for audit, never surfaced on the lane.';

GRANT SELECT ON public.w8_u3_link_batch      TO anon, authenticated, service_role;
GRANT SELECT ON public.w8_u3_link_review     TO anon, authenticated, service_role;
GRANT SELECT ON public.w8_u3_link_apply_log  TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.w8_u3_dropped_log TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.w8_u3_dropped_log_id_seq TO anon, authenticated, service_role;

-- Decision Center lane source: open link proposals, ranked by confidence then $ value.
CREATE OR REPLACE VIEW public.v_w8_u3_link_review_open AS
SELECT review_id, subject_ref, pool, domain, source_property_id, gap, proposal_type,
       current_owner_entity_id, current_owner_name, winner_entity_id,
       proposed_verdict, linked_entity_name, role, confidence,
       evidence_quote, evidence_source, reason, rank_value,
       model_provider, model_name, source_run_id, created_at
  FROM public.w8_u3_link_review
 WHERE status = 'proposed'
   AND proposed_verdict = 'link_proposal'
 ORDER BY confidence DESC, rank_value DESC NULLS LAST, created_at DESC;

GRANT SELECT ON public.v_w8_u3_link_review_open TO anon, authenticated, service_role;

-- Health tile — flag state + open/applied counts + the dropped precision-floor
-- ratio. amber while the flag is off (a flag-gated no-op must be visible), mirroring
-- the U1/U2 health views.
CREATE OR REPLACE VIEW public.v_lcc_w8_u3_link_health AS
WITH p AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS proposals_24h,
         count(*) FILTER (WHERE status = 'proposed' AND proposed_verdict = 'link_proposal')::int AS open_proposals,
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
         'applied_total', coalesce((SELECT applied_total FROM p), 0),
         'rejected_total', coalesce((SELECT rejected_total FROM p), 0),
         'dropped_24h', coalesce((SELECT dropped_24h FROM d), 0),
         'latest_proposal_at', (SELECT latest_proposal_at FROM p)
       ) AS details;

GRANT SELECT ON public.v_lcc_w8_u3_link_health TO anon, authenticated, service_role;

-- field_source_priority: register the deterministic writer's provenance source so
-- v_field_provenance_unranked stays 0. The writer stamps field_provenance on the
-- entity_relationships edge it creates (target_table='entity_relationships',
-- field_name=<relationship_type>). Source 'w8_u3_link_propagation' at rank 85 —
-- the derived/inferred band, BELOW all record sources (manual 1, recorded_deed 3,
-- county/sos 5-55) and below aggregators; a human accepted it, but it is an
-- LLM-proposed inference, so it never outranks a record.
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  ('entity_relationships', 'developed', 'w8_u3_link_propagation', 85, null,
   'W8 U3: human-accepted, LLM-proposed developer link (evidence-grounded). Below all record sources.'),
  ('entity_relationships', 'owns',      'w8_u3_link_propagation', 85, null,
   'W8 U3: human-accepted, LLM-proposed prior-owner link (evidence-grounded). Below all record sources.')
ON CONFLICT (target_table, field_name, source) DO NOTHING;

-- Feature flag (36y rule: registered IN the migration, default OFF).
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'W8_U3_LINK_PROPAGATION',
  'W8 U3 hygiene: Ollama connection propagation. For ownership-chain gaps (v_ownership_chain_worklist) + person-email-merge candidates (v_lcc_person_email_merge_candidates), Ollama proposes the missing link ONLY from evidence LCC already holds, quoted VERBATIM (validator drops non-verbatim → w8_u3_dropped_log). Human confirm lane (Decision Center w8_u3_link_review) → deterministic writer creates the entity_relationships edge with provenance (fill-blanks). NEVER auto-writes, never fabricates.',
  'api/admin.js?_route=link-propagation-tick + w8_u3_link_review + Decision Center (w8_u3_link_review lane)',
  'W8_U3_LINK_PROPAGATION',
  'off',
  DATE '2026-08-07',
  'Scott Briggs',
  'Proposal-only — ZERO auto-writes. Ollama proposes a missing link WITH a verbatim quote; a human verdict applies it via the deterministic writer (entity_relationships edge + field_provenance, source w8_u3_link_propagation@85, reversible w8_u3_link_apply_log). no_evidence_found is honest/counted. Flip on after the ?score=1 dry-run sample is reviewed. Uses OLLAMA_URL/OLLAMA_MODEL via invokeExtractionAI (surface clean_assist).'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes,
      updated_at = now();

-- Nightly off-hours cron (04:10 UTC, after U1 junk-prescreen 03:40 + U2 dup-pair
-- 03:50 — GaryBuilt is serial; evidence assembly makes these calls longer). POSTs
-- the Railway tick; the tick itself no-ops while the flag is off, so this is inert
-- until the flag flips.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN
      PERFORM cron.unschedule('link-propagation-tick');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'link-propagation-tick',
      '10 4 * * *',
      $cron$SELECT public.lcc_cron_post('/api/link-propagation-tick', '{"apply":true,"limit":15}'::jsonb, 'railway');$cron$
    );
  END IF;
END;
$$;

COMMIT;
