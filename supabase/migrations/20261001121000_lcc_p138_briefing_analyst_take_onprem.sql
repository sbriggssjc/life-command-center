-- ============================================================================
-- P138 / R8 Stage 1 — on-box "Analyst's Take" for the daily brief.
--
-- The briefing email has rendered its "Analyst's Take" section from
-- briefing_intel_snapshot.analyst_take since v2. Measured live 2026-08-26 on
-- LCC Opps: 67 snapshot rows, 11 ever carried a take, and the last non-empty one
-- is 2026-07-07. Every row since carries the edge function's own warning
--   "Anthropic API 400: ... Your credit balance is too low to access the
--    Anthropic API"
-- so the cloud generator is BILLING-DEAD, not un-configured — and the same
-- outage emptied `capital_markets` on every one of those rows too.
--
-- Generation moves ON-BOX (GaryBuilt / Ollama) because the take synthesizes
-- PRIVATE LCC data — work counts, scored priorities, named cooling contacts,
-- deal-propagation deltas naming live deals. Private corpora never egress to a
-- cloud model.
--
-- This migration is ADDITIVE ONLY:
--   1. briefing_intel_snapshot.analyst_take_meta jsonb — provenance for the take
--      (source, model, density, signal counts, validation residue). Without it a
--      filled take is indistinguishable from the old cloud one, and there is no
--      way to tell a thin-day take from a rich one after the fact.
--   2. feature_flags_registry row BRIEFING_ANALYST_TAKE_ONPREM — an env-gated
--      capability that no-ops when off must be VISIBLE (audit 4.4.3), or a
--      flag-gated no-op looks identical to a healthy quiet pipeline.
--
-- REVERSAL:
--   ALTER TABLE public.briefing_intel_snapshot DROP COLUMN IF EXISTS analyst_take_meta;
--   DELETE FROM public.feature_flags_registry WHERE flag = 'BRIEFING_ANALYST_TAKE_ONPREM';
--   -- and to drop the takes this surface wrote (they are self-identifying):
--   UPDATE public.briefing_intel_snapshot SET analyst_take = NULL
--    WHERE analyst_take_meta->>'source' = 'onprem_ollama';
-- ============================================================================

ALTER TABLE public.briefing_intel_snapshot
  ADD COLUMN IF NOT EXISTS analyst_take_meta jsonb;

COMMENT ON COLUMN public.briefing_intel_snapshot.analyst_take_meta IS
  'P138 provenance for analyst_take: {source, surface, model, generated_at, density, '
  'signal_counts, prompt_chars, voice_basis, attempts, ungrounded_names_reported, '
  'fetch_errors}. source=''onprem_ollama'' means the take was generated on the '
  'GaryBuilt box by /api/briefing-analyst-take-tick and never egressed to a cloud '
  'model. NULL on rows written by the briefing-intel-snapshot edge function.';

INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'BRIEFING_ANALYST_TAKE_ONPREM',
  'Generate the daily brief''s "Analyst''s Take" narrative on-box (GaryBuilt/Ollama) from the private LCC signal set, instead of the billing-dead cloud path in the briefing-intel-snapshot edge function.',
  'POST /api/briefing-analyst-take-tick -> briefing_intel_snapshot.analyst_take (+ analyst_take_meta); rendered by api/_handlers/briefing-email-handler.js::renderAnalystTake',
  'BRIEFING_ANALYST_TAKE_ONPREM',
  'off',
  CURRENT_DATE,
  'scott',
  'R8 Stage 1 — the first net-new on-box GENERATION build (prior on-prem work was annotation-only). '
  'GET is always available as a dry run (?generate=1 renders a take inline for grading WITHOUT writing); '
  'only POST is gated. Fail-soft in every direction: flag off / model unreachable / a take that fails the '
  'fabrication guard all leave analyst_take untouched and open a deduped lcc_health_alerts row '
  '(alert_kind=briefing_analyst_take_empty), because an empty take reads exactly like a quiet news day. '
  'Flip to ''on'' only after a dry-run sample grades clean.'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose   = EXCLUDED.purpose,
  surface   = EXCLUDED.surface,
  env_var   = EXCLUDED.env_var,
  notes     = EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- 3. Schedule the tick. APPLIED LIVE 2026-08-26 as pg_cron jobid 240.
--
-- 10:18 UTC, weekdays only. The window is fixed at both ends: the
-- briefing-intel-snapshot edge cron (jobid 47, `0 10 * * 1-5`) creates the row —
-- observed landing at 10:00:02–10:00:26 — and the brief email sends ~12:30 UTC.
-- Minute :18 was chosen because it is the only free minute in that stretch: an
-- hourly job already occupies :03, :15, :17, :20, :22, :23 and :25.
--
-- ⚠️ The cron is deliberately NOT gated on the feature flag. With the flag off the
-- tick no-ops and SAYS SO in its response; an unscheduled job is invisible, which
-- is the dormant-capability failure the feature_flags_registry exists to prevent.
-- ---------------------------------------------------------------------------
DO $cronblock$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-briefing-analyst-take') THEN
    PERFORM cron.schedule(
      'lcc-briefing-analyst-take',
      '18 10 * * 1-5',
      $$SELECT public.lcc_cron_post('/api/briefing-analyst-take-tick', '{"trigger_source":"cron"}'::jsonb, 'railway');$$
    );
  END IF;
END
$cronblock$;

-- REVERSAL (cron): SELECT cron.unschedule('lcc-briefing-analyst-take');
