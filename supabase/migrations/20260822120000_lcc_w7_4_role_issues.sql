-- ===========================================================================
-- W7.4 — Role evolution + open-issues surfacing (last Wave 7 unit).
-- See docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md §W7.4.
--
-- The W7.2 propagation tick gains a new pass (AFTER summaries/cues/to-dos) that,
-- from each deal's attributed comm corpus, PROPOSES:
--   (a) party ROLE evolution (decision-maker vs transaction manager vs
--       attorney/lender emerging near LOI/PSA), and
--   (b) OPEN ISSUES / "what's coming" (outstanding asks, unanswered questions,
--       upcoming commitments/deadlines).
-- All LLM output is PROPOSAL-ONLY and lands ONLY in these analysis rows (which
-- the dossier renders in a clearly-labeled ANALYSIS panel) — never onto contact
-- records, deal-stage fields, or any auditable gate. Every proposal carries
-- evidence (comm ids + verbatim quotes); the JS validator drops fabricated
-- quotes and logs them here (lcc_deal_analysis_dropped_log), never surfaced.
--
-- Versioned like the correspondence summary: a new role-set / issue-set row
-- supersedes via is_current flip (never UPDATE-in-place); full history retained.
-- The per-deal `watermark` (a source_hash-style digest over the comm set
-- considered) makes the pass idempotent — an unchanged corpus writes 0 rows.
--
-- Discipline: additive · idempotent · reversible (DROP the tables/view/columns +
-- delete the flag row). No new writer to any curated fact table. Flag-gated:
-- W74_ROLE_ISSUES (default off) — merging changes nothing in prod until flipped.
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Versioned analysis rows — role-set + issue-set JSON per deal.
--    One row per (entity, kind, version). is_current flips on supersede.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_deal_dossier_analysis (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL,                     -- the deal/asset entity
  kind          text NOT NULL CHECK (kind IN ('roles','issues')),
  payload       jsonb NOT NULL DEFAULT '[]'::jsonb, -- the validated role/issue set
  watermark     text,                              -- digest over the comm set considered
  source        text NOT NULL DEFAULT 'comms_tick',
  is_current    boolean NOT NULL DEFAULT true,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS lcc_deal_dossier_analysis_entity_idx
  ON public.lcc_deal_dossier_analysis (entity_id, kind, generated_at DESC);
CREATE INDEX IF NOT EXISTS lcc_deal_dossier_analysis_current_idx
  ON public.lcc_deal_dossier_analysis (entity_id, kind) WHERE is_current;
COMMENT ON TABLE public.lcc_deal_dossier_analysis IS
  'W7.4 — versioned per-deal LLM-proposed analysis: kind=roles (party role evolution) | issues (open issues / what''s coming). PROPOSAL-only (dossier Analysis panel); every item is evidence-validated. is_current versioned; watermark short-circuits an unchanged corpus.';

-- Latest current row per (entity, kind) — what buildDealPacket reads.
CREATE OR REPLACE VIEW public.v_lcc_deal_dossier_analysis_current AS
  SELECT DISTINCT ON (entity_id, kind)
    entity_id, kind, payload, watermark, source, generated_at, metadata
  FROM public.lcc_deal_dossier_analysis
  WHERE is_current
  ORDER BY entity_id, kind, generated_at DESC;
GRANT SELECT ON public.v_lcc_deal_dossier_analysis_current TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Dropped-proposal log — fabricated / unverifiable quotes land here (audit),
--    never on the dossier. Keeps the no-fabrication contract observable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_deal_analysis_dropped_log (
  id          bigserial PRIMARY KEY,
  entity_id   uuid,
  run_id      bigint,
  kind        text,                                -- 'role' | 'issue' | 'closure'
  item        jsonb,                               -- the dropped proposal + reason
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lcc_deal_analysis_dropped_entity_idx
  ON public.lcc_deal_analysis_dropped_log (entity_id, created_at DESC);
COMMENT ON TABLE public.lcc_deal_analysis_dropped_log IS
  'W7.4 — evidence-validator drops (fabricated / non-verbatim / wrong-comm quotes). Logged for audit, never surfaced on the dossier.';

GRANT SELECT, INSERT ON public.lcc_deal_dossier_analysis TO anon, authenticated, service_role;
GRANT UPDATE ON public.lcc_deal_dossier_analysis TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.lcc_deal_analysis_dropped_log TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.lcc_deal_analysis_dropped_log_id_seq TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Observability — extend the propagation run log with W7.4 counters.
--    (Additive columns; the tick posts them, absent on older rows.)
-- ---------------------------------------------------------------------------
ALTER TABLE public.lcc_deal_comms_propagation_run_log
  ADD COLUMN IF NOT EXISTS roles_written      integer,
  ADD COLUMN IF NOT EXISTS issues_open        integer,
  ADD COLUMN IF NOT EXISTS issues_closed      integer,
  ADD COLUMN IF NOT EXISTS analysis_skipped   integer,
  ADD COLUMN IF NOT EXISTS analysis_dropped   integer;

-- ---------------------------------------------------------------------------
-- 4. Feature-flag registry: the W7.4 gate (inert until flipped).
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'W74_ROLE_ISSUES',
  'W7.2 propagation-tick pass: from a deal''s comm corpus, PROPOSE party role evolution + open issues into the dossier Analysis panel (evidence-validated, versioned). Deterministic stage-awareness line is always-on (no flag).',
  'api/_handlers/deal-comms-propagate-tick.js (role/issues pass) + api/_shared/deal-role-issues.js; rendered by dossier-generator.js',
  'W74_ROLE_ISSUES',
  'off', now(), 'scott',
  'W7.4. The pass runs only when W74_ROLE_ISSUES is set in Railway (the parent DEAL_COMMS_PROPAGATE tick still gates the tick itself). No-op until flipped; the summary/cue/to-do passes are unaffected. Ollama-primary via invokeExtractionAI; AI failure skips the deal that tick and never blocks the other passes.'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose=EXCLUDED.purpose, surface=EXCLUDED.surface, env_var=EXCLUDED.env_var, notes=EXCLUDED.notes;

-- ===========================================================================
-- REVERSAL RUNBOOK
--   DROP VIEW  IF EXISTS public.v_lcc_deal_dossier_analysis_current;
--   DROP TABLE IF EXISTS public.lcc_deal_analysis_dropped_log;
--   DROP TABLE IF EXISTS public.lcc_deal_dossier_analysis;
--   ALTER TABLE public.lcc_deal_comms_propagation_run_log
--     DROP COLUMN IF EXISTS roles_written, DROP COLUMN IF EXISTS issues_open,
--     DROP COLUMN IF EXISTS issues_closed, DROP COLUMN IF EXISTS analysis_skipped,
--     DROP COLUMN IF EXISTS analysis_dropped;
--   DELETE FROM public.feature_flags_registry WHERE flag='W74_ROLE_ISSUES';
-- ===========================================================================
