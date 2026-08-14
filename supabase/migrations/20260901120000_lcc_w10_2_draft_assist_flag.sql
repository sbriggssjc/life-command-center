-- ============================================================================
-- W10 Stage 2 (Prompt 107) — retrieval-grounded drafting (/api/draft-assist).
--
-- Registers the DRAFT_ASSIST capability flag in feature_flags_registry so its
-- OFF state is visible in the daily "Dormant Capabilities" digest (audit
-- §4.4.3). There is NO curated-field write on this surface — draft-assist only
-- READS the sent corpus + deal spine and writes a DRAFT to Outlook (save-not-
-- send), so there is no field_source_priority row and no data table.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq). Additive / idempotent / reversible.
--
-- REVERSAL: DELETE FROM feature_flags_registry WHERE flag = 'DRAFT_ASSIST';
-- ============================================================================

BEGIN;

INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'DRAFT_ASSIST',
  'Retrieval-grounded drafting: RAG over Scott''s cleaned SENT-email corpus + deal-spine facts + the Stage-1 voice profile, generated ON-PREM (Ollama, fail-closed) into a Scott-voiced DRAFT. Never sends; never fabricates a fact.',
  'api/draft-assist (GET dry-run always on; POST saves to Outlook Drafts via PA_OUTLOOK_DRAFT_URL only when this flag is ON)',
  'DRAFT_ASSIST',
  'off', DATE '2026-09-01', 'Scott Briggs',
  'GET /api/draft-assist is a dry-run and works regardless of this flag (returns the assembled draft + retrieval + facts). POST save-to-Outlook is gated ON this flag. On-prem generation requires OLLAMA_URL; optional embedding-KNN retrieval uses DRAFT_ASSIST_EMBED_MODEL (default nomic-embed-text) and falls back to a deterministic ranker. Flip to on after Scott reviews the sample drafts.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes, updated_at = now();

COMMIT;
