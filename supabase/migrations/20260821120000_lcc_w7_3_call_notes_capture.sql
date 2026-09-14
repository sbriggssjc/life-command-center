-- ============================================================================
-- W7.3 — Call notes + Microsoft-side capture (Copilot actions · Outlook tagging)
-- ----------------------------------------------------------------------------
-- Capture is the only missing piece: calls and operator-tagged comms become
-- first-class inputs to the LIVE W7.2 propagation tick. Everything lands as
-- `activity_events` (category 'call' | 'email') deal-stamped where known,
-- through the EXISTING dual-anchor loggers — so W7.2 propagates it with ZERO
-- new propagation code (the tick keys on metadata.deal_entity_id).
--
-- This migration is PURELY ADDITIVE:
--   * NO new tables — the three capture paths reuse `activity_events` (spine)
--     and `research_tasks` (the tag_unresolved parking lane; idempotent via the
--     existing uq (source_table, source_record_id, research_type, domain) index
--     from R21).
--   * Registers the ONE new env-gated capability (the Outlook-category receiver)
--     in feature_flags_registry so "off" is visible in the daily briefing.
--     Quick-log (path A) and the two Copilot actions (path B) are
--     operator-initiated, not background producers, so they carry no flag.
--
-- Reversal: DELETE the feature_flags_registry row below. No schema to drop.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Feature-flag registry: the Outlook-category tagged-comm receiver gate.
-- Inert until TAGGED_COMM_INTAKE_ENABLED is set in Railway (handler no-ops).
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'TAGGED_COMM_INTAKE',
  'Outlook category-tagging capture: a Power Automate flow posts messages tagged with the LCC category (sent OR received) to /api/intake-tagged-comm, which deal-stamps them onto the activity spine so W7.2 propagates them.',
  'api/_handlers/intake-tagged-comm.js (route POST /api/intake-tagged-comm)',
  'TAGGED_COMM_INTAKE_ENABLED',
  'off', now(), 'scott',
  'W7.3 path C. Auth: X-PA-Webhook-Secret (PA_WEBHOOK_SECRET). Resolves the deal by category hint (LCC:<hint> → open-deal name / tenant+city core) → else the W7.1 lcc_resolve_contact paths → else parks a research_tasks row (research_type=tag_unresolved, source_table=outlook_tagged) rather than guessing. Idempotent on internet_message_id. No-ops until the env flag is set. The Copilot log_call_note / tag_comm_to_deal actions and the in-app quick-log Log-call action need no flag (operator-initiated).'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose=EXCLUDED.purpose, surface=EXCLUDED.surface, env_var=EXCLUDED.env_var, notes=EXCLUDED.notes;

-- No cron: the tagged-comm receiver is push-driven by the Power Automate flow,
-- not scheduled. W7.2's existing lcc-deal-comms-propagate tick consumes the
-- deal-stamped rows this path produces (metadata.deal_entity_id), so nothing new
-- schedules here.
