-- ============================================================================
-- W7.5 — Outbound loop closure: register the action-summary feature flag
-- ----------------------------------------------------------------------------
-- W7.5 has NO schema change: parts A (outbound advance in the tagged path) and
-- B (cross-path de-dupe + the untagged Sent-Items sweep) reuse the existing
-- lcc_advance_todos / lcc_reconcile_deal_todo writers and the activity_events
-- spine — nothing new to create.
--
-- The ONE durable DB artifact is this feature-flag row. Part C (the per-action
-- Ollama "action taken" narration) is gated by W75_ACTION_SUMMARY (default OFF)
-- and must be visible in the daily briefing's Dormant-capabilities section while
-- off — the W7.3 gap (a flag added in code but never registered here, caught in
-- session 36y) must NOT recur.
--
-- Discipline: additive, idempotent (ON CONFLICT), reversible (DELETE the row).
-- ============================================================================

INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'W75_ACTION_SUMMARY',
  'Per-action Ollama narration: after a spine-stamped comm/call advances or completes a deal''s to-dos, append a one-line "action taken" summary to the activity event''s metadata (metadata.action_summary), surfaced in the deal timeline + dossier correspondence section.',
  'api/_shared/action-summary.js (called from api/intake.js::handleOutlookSent + api/_handlers/intake-tagged-comm.js)',
  'W75_ACTION_SUMMARY',
  'off', now(), 'scott',
  'W7.5 Part C. Proposal-only, no-fabrication: the narration may only reference the subject/body and the to-dos actually touched (validated — a fabricated to-do label drops the summary). Ollama via the invokeExtractionAI seam; any failure = no summary, never an error. No-ops until W75_ACTION_SUMMARY=true in Railway. Parts A/B (outbound advance from a tagged/untagged send, cross-path de-dupe) need no flag — they extend the already-live outbound completion engine.'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var, notes = EXCLUDED.notes;
