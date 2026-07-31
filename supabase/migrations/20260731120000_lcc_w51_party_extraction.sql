-- W5.1 — Party extraction from sale notes (GLiNER + GaryBuilt local LLM)
-- =====================================================================================
-- Fills the missing buyer/seller/broker/lender fields on LIVE sales from the CoStar
-- sale-note narrative, via a two-channel extractor (GLiNER spans + a local-LLM
-- structured pass) that WRITES ONLY on field-level agreement. Cross-repo work:
--   • Channel A  → resolver/ POST /extract-parties (span-anchored, deterministic)
--   • Channel B  → api/_shared/ai.js invokeExtractionAI (GaryBuilt/qwen2.5 primary,
--                  cloud fallback) — the bulk run is gated on ai_final_provider=ollama
--   • Adjudicate + write → api/_handlers/party-extract.js (fill-blanks, guard-gated)
--   • Backlog runner → scripts/party-extract-backlog.mjs (dry-run default, resumable)
-- Prompt: audit/data-flow-2026-05-30/CLAUDECODE_PROMPT_w51_party_extraction_local_llm.md
--
-- This migration is ADDITIVE + IDEMPOTENT (LCC Opps xengecqvemvfknjvbvrq). It:
--   1. Registers the two extraction sources in field_source_priority (record_only) so
--      v_field_provenance_unranked stays at 0 rows when the writer fires. Both sources
--      rank BELOW every aggregator (costar_sidebar 60-65, crexi 70-75) — fill-blanks
--      only, never override a curated/aggregator value.
--   2. Creates the reversible batch LEDGER (party_extract_batch) — the idempotency +
--      undo key, mirroring the w43_splink_batch discipline.
--   3. Creates the DISAGREEMENT review table (party_extract_disagreements) — the
--      training-signal lane (same philosophy as entity_match_labels): B-only claims and
--      A/B value conflicts land here for human review, never a silent write.
--   4. Registers the W51_PARTY_EXTRACT capability in feature_flags_registry (inert-
--      feature rule).
--
-- Priorities are the INTEGER trust RANK (lower = higher trust), NOT the write
-- confidence. The write confidences are 0.60 (agreement) / 0.55 (gliner-only), carried
-- by the JS writer; here they inform min_confidence=0 (record_only, no gate).
--
-- REVERSAL RUNBOOK (per batch_tag):
--   -- dia (sale_id is integer):
--   UPDATE dia.sales_transactions t
--      SET buyer_name = CASE WHEN b.field_name='buyer_name' THEN NULL ELSE t.buyer_name END,
--          ... (per field)
--   -- Simpler, one field at a time, on the DOMAIN db:
--   --   For each (record_pk, field_name) in party_extract_batch WHERE applied AND batch_tag=$1:
--   --     UPDATE <domain>.sales_transactions SET <field_name>=NULL WHERE sale_id=<record_pk>
--   --       AND <field_name> = <written_value>;   -- only revert if unchanged since
--   -- The ledger row's written_value guards against reverting a later human edit.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. field_source_priority registry rows (record_only)
-- ---------------------------------------------------------------------------
-- Party field set per domain (canonical → actual column):
--   dia.sales_transactions: buyer_name, seller_name, listing_broker, procuring_broker
--   gov.sales_transactions: buyer, seller, listing_broker, purchasing_broker, lender_name
-- gov.sales_transactions.lender_name had no registry rows at all → the party sources are
-- its first entries (fine; fill-blanks record_only).
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
SELECT v.target_table, v.field_name, v.source, v.priority, 0, 'record_only', v.notes
FROM (VALUES
  -- dia --------------------------------------------------------------------
  ('dia.sales_transactions', 'buyer_name',       'party_extract_agree', 80, 'W5.1: GLiNER+LLM agreement on buyer (conf 0.60, fill-blank).'),
  ('dia.sales_transactions', 'buyer_name',       'gliner_extract',      85, 'W5.1: GLiNER-only span for buyer (conf 0.55, fill-blank).'),
  ('dia.sales_transactions', 'seller_name',      'party_extract_agree', 80, 'W5.1: GLiNER+LLM agreement on seller (conf 0.60, fill-blank).'),
  ('dia.sales_transactions', 'seller_name',      'gliner_extract',      85, 'W5.1: GLiNER-only span for seller (conf 0.55, fill-blank).'),
  ('dia.sales_transactions', 'listing_broker',   'party_extract_agree', 80, 'W5.1: GLiNER+LLM agreement on listing broker (conf 0.60, fill-blank).'),
  ('dia.sales_transactions', 'listing_broker',   'gliner_extract',      85, 'W5.1: GLiNER-only span for listing broker (conf 0.55, fill-blank).'),
  ('dia.sales_transactions', 'procuring_broker', 'party_extract_agree', 80, 'W5.1: GLiNER+LLM agreement on procuring broker (conf 0.60, fill-blank).'),
  ('dia.sales_transactions', 'procuring_broker', 'gliner_extract',      85, 'W5.1: GLiNER-only span for procuring broker (conf 0.55, fill-blank).'),
  -- gov --------------------------------------------------------------------
  ('gov.sales_transactions', 'buyer',             'party_extract_agree', 80, 'W5.1: GLiNER+LLM agreement on buyer (conf 0.60, fill-blank).'),
  ('gov.sales_transactions', 'buyer',             'gliner_extract',      85, 'W5.1: GLiNER-only span for buyer (conf 0.55, fill-blank).'),
  ('gov.sales_transactions', 'seller',            'party_extract_agree', 80, 'W5.1: GLiNER+LLM agreement on seller (conf 0.60, fill-blank).'),
  ('gov.sales_transactions', 'seller',            'gliner_extract',      85, 'W5.1: GLiNER-only span for seller (conf 0.55, fill-blank).'),
  ('gov.sales_transactions', 'listing_broker',    'party_extract_agree', 80, 'W5.1: GLiNER+LLM agreement on listing broker (conf 0.60, fill-blank).'),
  ('gov.sales_transactions', 'listing_broker',    'gliner_extract',      85, 'W5.1: GLiNER-only span for listing broker (conf 0.55, fill-blank).'),
  ('gov.sales_transactions', 'purchasing_broker', 'party_extract_agree', 80, 'W5.1: GLiNER+LLM agreement on purchasing broker (conf 0.60, fill-blank).'),
  ('gov.sales_transactions', 'purchasing_broker', 'gliner_extract',      85, 'W5.1: GLiNER-only span for purchasing broker (conf 0.55, fill-blank).'),
  ('gov.sales_transactions', 'lender_name',       'party_extract_agree', 80, 'W5.1: GLiNER+LLM agreement on lender (conf 0.60, fill-blank).'),
  ('gov.sales_transactions', 'lender_name',       'gliner_extract',      85, 'W5.1: GLiNER-only span for lender (conf 0.55, fill-blank).')
) AS v(target_table, field_name, source, priority, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_source_priority f
  WHERE f.target_table = v.target_table
    AND f.field_name   = v.field_name
    AND f.source       = v.source
);

-- ---------------------------------------------------------------------------
-- 2. party_extract_batch — reversible write ledger (idempotency + undo key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.party_extract_batch (
  id                bigserial PRIMARY KEY,
  batch_tag         text NOT NULL,                       -- e.g. 'w51_20260731_dia'
  target_database   text NOT NULL,                       -- 'dia' | 'gov'
  target_table      text NOT NULL,                       -- 'dia.sales_transactions'
  record_pk         text NOT NULL,                       -- sale_id as text (int or uuid)
  field_name        text NOT NULL,                       -- actual column written
  written_value     text,                                -- value written (for safe revert)
  source            text NOT NULL,                       -- party_extract_agree | gliner_extract
  confidence        numeric,                             -- 0.60 | 0.55
  channel_a_value   text,                                -- GLiNER span value
  channel_b_value   text,                                -- LLM value
  span_text         text,                                -- grounding: the source span
  span_start        integer,                             -- note offset (nullable)
  span_end          integer,
  note_source       text,                                -- which column the note came from
  ai_final_provider text,                                -- channel B provider ('ollama'|...)
  applied           boolean NOT NULL DEFAULT false,      -- false = dry-run record (not written)
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_tag, target_database, record_pk, field_name)
);
CREATE INDEX IF NOT EXISTS ix_party_extract_batch_lookup
  ON public.party_extract_batch (target_database, record_pk, field_name);
CREATE INDEX IF NOT EXISTS ix_party_extract_batch_applied
  ON public.party_extract_batch (applied, created_at);

COMMENT ON TABLE public.party_extract_batch IS
  'W5.1 reversible ledger — one row per (batch, domain, sale, field) extraction write. '
  'applied=false rows are dry-run previews. Revert a batch by NULLing each field_name on '
  'the domain sales_transactions row where the value still equals written_value.';

-- ---------------------------------------------------------------------------
-- 3. party_extract_disagreements — review lane / training signal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.party_extract_disagreements (
  id                bigserial PRIMARY KEY,
  batch_tag         text,
  target_database   text NOT NULL,                       -- 'dia' | 'gov'
  record_pk         text NOT NULL,
  field_name        text NOT NULL,                       -- canonical field (buyer/seller/…)
  channel_a_value   text,                                -- GLiNER value (null = abstain)
  channel_b_value   text,                                -- LLM value (null = abstain)
  channel_a_core    text,                                -- normalized core (agreement key)
  channel_b_core    text,
  disagreement_kind text NOT NULL,                       -- 'b_only' | 'value_conflict'
  note_excerpt      text,
  ai_final_provider text,
  resolved          boolean NOT NULL DEFAULT false,
  resolution        text,                                -- human verdict (future)
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_database, record_pk, field_name, disagreement_kind)
);
CREATE INDEX IF NOT EXISTS ix_party_extract_disagreements_unresolved
  ON public.party_extract_disagreements (resolved, created_at);

COMMENT ON TABLE public.party_extract_disagreements IS
  'W5.1 review lane — B-only (LLM claimed a party with no GLiNER span) and A/B value '
  'conflicts. Never written to sales; human-adjudicated, feeds future training signal '
  '(same philosophy as entity_match_labels).';

-- ---------------------------------------------------------------------------
-- 4. feature_flags_registry — make the capability visible (inert-feature rule)
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'W51_PARTY_EXTRACT',
  'Two-channel (GLiNER + local-LLM) party extraction from sale notes → fill-blank buyer/seller/broker/lender on live sales.',
  'scripts/party-extract-backlog.mjs + api/_handlers/party-extract.js + resolver /extract-parties',
  'W51_ALLOW_CLOUD',
  'off',
  NULL,
  'scott',
  'Mechanism shipped W5.1. Bulk run gated on ai_final_provider=ollama unless W51_ALLOW_CLOUD=1. '
  'Requires RESOLVER_URL (Channel A) + OLLAMA_URL (Channel B, free) + domain service keys. '
  'Flip to on when the first bulk --apply run lands.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      env_var = EXCLUDED.env_var,
      notes   = EXCLUDED.notes;

COMMIT;
