-- W8 U2 (Prompt 63, 2026-08-07): Ollama duplicate-pair proposals → resolver fuel.
--
-- Hygiene campaign unit 2. Reuses U1's shapes (reversible batch ledger, in-
-- migration flag registration, nightly no-op-while-off cron) — it does NOT fork a
-- new pattern. Additive + idempotent on LCC Opps (xengecqvemvfknjvbvrq).
--
-- DOCTRINE (non-negotiable): DUPES ARE THE RESOLVER'S JOB (Fellegi-Sunter /match
-- + the entity_match_labels corpus). Ollama ASSISTS — it emits CANDIDATE PAIRS
-- only; it never merges, never scores the auditable band. A deterministic near-
-- miss generator (NO LLM) finds the name/address pairs the resolver's token-blocks
-- skip; Ollama gives a same_party/distinct/unsure second look; proposed pairs land
-- in the EXISTING owner_reconcile resolver review pool (seeder 'w8_u2_ollama_pair',
-- a 4th folded seeder — NOT a new lane). A HUMAN verdict flows exactly as today:
-- accepted → an entity_match_labels row (same_party | distinct) → the nightly W4.4
-- retrain consumes it. ZERO MERGES from this unit — only labeled pairs.
--
-- This migration creates:
--   * w8_u2_dup_pair_batch  — per-run reversible ledger (sibling of junk_review_batch)
--   * w8_u2_dup_pair         — the proposed-pair rows (one per scored candidate pair)
--   * v_w8_u2_dup_pair_open  — the owner_reconcile seeder-D source (proposed rows)
--   * v_lcc_w8_u2_dup_pair_health — Health-surface tile
--   * feature flag W8_U2_DUP_PAIRS (default OFF, registered here per 36y)
--   * a nightly off-hours pg_cron POST to /api/dup-pair-tick (no-ops while OFF)
--
-- REVERSAL RUNBOOK
--   -- This unit writes NO canonical data — only proposal rows + (on human verdict)
--   --   entity_match_labels rows via the existing owner_reconcile handler.
--   -- To retire a whole scan batch's un-worked proposals:
--   SELECT * FROM public.w8_u2_dup_pair_batch WHERE status='open' ORDER BY created_at DESC;
--   DELETE FROM public.w8_u2_dup_pair
--     WHERE scan_batch_id=<id> AND status='proposed';   -- worked rows (labeled) are kept
--   -- To reverse a label a verdict wrote, follow the entity_match_labels /
--   --   lcc_decisions reversal (delete the label row by subject_ref; re-open the decision).
--   -- To retire the feature: flip W8_U2_DUP_PAIRS off (default) — the cron POST
--   --   no-ops and the tick GET stays a dry-run.

BEGIN;

-- Reversible ledger — one row per tick run (batch_kind='scan'). Mirrors
-- junk_review_batch so the ops/reversal muscle-memory carries over.
CREATE TABLE IF NOT EXISTS public.w8_u2_dup_pair_batch (
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

CREATE INDEX IF NOT EXISTS idx_w8_u2_dup_pair_batch_run
  ON public.w8_u2_dup_pair_batch (source_run_id, created_at DESC);

COMMENT ON TABLE public.w8_u2_dup_pair_batch IS
  'W8 U2: reversible ledger for the Ollama duplicate-pair generator. scan rows = a tick run (details carry per-domain generated/scored/proposed/dropped counts).';

-- Proposed-pair rows. One per scored near-miss pair, keyed by the canonical
-- order-independent pair_key so a re-scan is idempotent (merge-duplicates) and a
-- decided/labeled pair is excluded from re-proposal. The subject_ref is the
-- owner_reconcile seeder-D federated key (ownrec:w8u2:<pair_key>).
CREATE TABLE IF NOT EXISTS public.w8_u2_dup_pair (
  pair_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pair_key         text NOT NULL UNIQUE,
  subject_ref      text NOT NULL UNIQUE,
  domain           text NOT NULL,                 -- 'lcc' | 'gov' | 'dia' (both sides same domain)
  table_name       text NOT NULL,                 -- entities | true_owners
  -- Both entity refs + names (the pair). entity_a/entity_b are the source pks.
  entity_a         text NOT NULL,
  entity_b         text NOT NULL,
  name_a           text,
  name_b           text,
  generator_method text NOT NULL                  -- name_near_miss | same_address_diff_name | abbrev_expansion
                     CHECK (generator_method IN ('name_near_miss', 'same_address_diff_name', 'abbrev_expansion')),
  name_similarity  numeric,
  gen_evidence     text,                          -- the deterministic generator evidence
  -- Ollama's PROPOSAL (proposal-only; never a merge, never an auditable score).
  proposed_verdict text NOT NULL DEFAULT 'unsure'
                     CHECK (proposed_verdict IN ('same_party', 'distinct', 'unsure')),
  confidence       numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  evidence_quote   text,
  reason           text,
  seeder           text NOT NULL DEFAULT 'w8_u2_ollama_pair',
  model_provider   text,
  model_name       text,
  source_run_id    text NOT NULL,
  scan_batch_id    bigint REFERENCES public.w8_u2_dup_pair_batch(batch_id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed', 'confirmed_match', 'rejected', 'superseded')),
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_w8_u2_dup_pair_open
  ON public.w8_u2_dup_pair (status, confidence DESC, created_at DESC)
  WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_w8_u2_dup_pair_domain
  ON public.w8_u2_dup_pair (domain, table_name, status);

COMMENT ON TABLE public.w8_u2_dup_pair IS
  'W8 U2: Ollama duplicate-pair PROPOSALS (seeder w8_u2_ollama_pair). Proposal-only — the verdict is human (owner_reconcile Decision Center lane, seeder D). Accepted → an entity_match_labels row (same_party|distinct), the W4.4 retrain fuel. NEVER a merge.';

CREATE OR REPLACE FUNCTION public.w8_u2_dup_pair_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_w8_u2_dup_pair_touch ON public.w8_u2_dup_pair;
CREATE TRIGGER trg_w8_u2_dup_pair_touch
  BEFORE UPDATE ON public.w8_u2_dup_pair
  FOR EACH ROW EXECUTE FUNCTION public.w8_u2_dup_pair_touch();

GRANT SELECT ON public.w8_u2_dup_pair_batch TO anon, authenticated, service_role;
GRANT SELECT ON public.w8_u2_dup_pair       TO anon, authenticated, service_role;

-- Seeder-D source for the owner_reconcile lane: open proposals, ranked by
-- confidence (most confidently-decided first). The verdict-not-yet-cast set.
CREATE OR REPLACE VIEW public.v_w8_u2_dup_pair_open AS
SELECT pair_id, pair_key, subject_ref, domain, table_name,
       entity_a, entity_b, name_a, name_b,
       generator_method, name_similarity, gen_evidence,
       proposed_verdict, confidence, evidence_quote, reason,
       model_provider, model_name, source_run_id, created_at
  FROM public.w8_u2_dup_pair
 WHERE status = 'proposed'
 ORDER BY confidence DESC, created_at DESC;

GRANT SELECT ON public.v_w8_u2_dup_pair_open TO anon, authenticated, service_role;

-- Health tile — flag state + open/labeled counts. amber while the flag is off
-- (a flag-gated no-op must be visible), mirroring the U1 health view.
CREATE OR REPLACE VIEW public.v_lcc_w8_u2_dup_pair_health AS
WITH p AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS proposals_24h,
         count(*) FILTER (WHERE status = 'proposed')::int AS open_proposals,
         count(*) FILTER (WHERE status = 'confirmed_match')::int AS confirmed_total,
         count(*) FILTER (WHERE status = 'rejected')::int AS rejected_total,
         max(created_at) AS latest_proposal_at
    FROM public.w8_u2_dup_pair
),
f AS (
  SELECT state FROM public.feature_flags_registry
   WHERE flag = 'W8_U2_DUP_PAIRS' LIMIT 1
)
SELECT 'dup_pair_prescreen'::text AS subsystem,
       'ollama_dup_pair'::text AS check_name,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off' THEN 'amber' ELSE 'green' END AS status,
       coalesce((SELECT open_proposals FROM p), 0)::int AS count,
       coalesce((SELECT latest_proposal_at FROM p), now()) AS first_seen,
       now() AS ts,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off'
            THEN 'W8_U2_DUP_PAIRS feature flag is off' ELSE NULL END AS last_error,
       NULL::text AS external_url,
       jsonb_build_object(
         'feature_flag_state', coalesce((SELECT state FROM f), 'off'),
         'proposals_24h', coalesce((SELECT proposals_24h FROM p), 0),
         'open_proposals', coalesce((SELECT open_proposals FROM p), 0),
         'confirmed_total', coalesce((SELECT confirmed_total FROM p), 0),
         'rejected_total', coalesce((SELECT rejected_total FROM p), 0),
         'latest_proposal_at', (SELECT latest_proposal_at FROM p)
       ) AS details;

GRANT SELECT ON public.v_lcc_w8_u2_dup_pair_health TO anon, authenticated, service_role;

-- Feature flag (36y rule: registered IN the migration, default OFF).
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'W8_U2_DUP_PAIRS',
  'W8 U2 hygiene: deterministic near-miss pair generator (name/address/abbrev the resolver blocking skips) across ops entities + gov/dia true_owners, Ollama gives a same_party/distinct/unsure second look, proposed pairs land in the owner_reconcile resolver review pool (seeder w8_u2_ollama_pair) for a human verdict → entity_match_labels (W4.4 retrain fuel).',
  'api/admin.js?_route=dup-pair-tick + w8_u2_dup_pair + Decision Center (owner_reconcile lane, seeder w8_u2_ollama_pair)',
  'W8_U2_DUP_PAIRS',
  'off',
  DATE '2026-08-07',
  'Scott Briggs',
  'Proposal-only — ZERO merges from this unit. Ollama emits candidate pairs; a human verdict writes an entity_match_labels row (same_party|distinct). unsure/low-confidence dropped. Flip on after the dry-run sample is reviewed. Uses OLLAMA_URL/OLLAMA_MODEL via invokeExtractionAI (surface clean_assist).'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes,
      updated_at = now();

-- Nightly off-hours cron (03:50, after the U1 junk-prescreen at 03:40). POSTs the
-- Railway tick; the tick itself no-ops while the flag is off, so this is inert
-- until the flag flips.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN
      PERFORM cron.unschedule('dup-pair-tick');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'dup-pair-tick',
      '50 3 * * *',
      $cron$SELECT public.lcc_cron_post('/api/dup-pair-tick', '{"apply":true,"limit":40}'::jsonb, 'railway');$cron$
    );
  END IF;
END;
$$;

COMMIT;
