-- ============================================================================
-- OC-v2 — the operator-note triage tick had never once run: `OPERATOR_NOTE_TRIAGE`
-- did not exist as a `feature_flags_registry` row (so the flag could not even be
-- flipped) and no pg_cron job ever posted the tick. Intake worked end to end
-- (OC-a) and the one real note filed 2026-09-12 sat `disposition='open',
-- note_type=null, routed_to=null` for two days with nothing consuming it —
-- worse than no funnel at all, because a note filed there LOOKS captured.
--
-- This migration:
--   1. registers `OPERATOR_NOTE_TRIAGE` (state='off' — the code+classification
--      fixes shipped alongside this migration need a live grade first, per the
--      standing rule "a NEW producer is not flipped on before a real run is
--      reviewed"; see the response doc for the grade output);
--   2. schedules `lcc-operator-triage` (25 7 * * *, a free minute — checked
--      against `cron.job` at commit time; re-verify before relying on it, this
--      sandbox has no live `cron.job` reach) via the standard `lcc_cron_post`
--      pattern, NOT gated on the flag (P138 pattern: an unscheduled job is
--      invisible, the tick itself records the flag-off skip loudly);
--   3. a visibility monitor for the exact failure this migration exists to
--      close: an open, untriaged note aging past a threshold with nobody
--      consuming it. Distinct alert_kind from any producer-health alert —
--      this names "intake works, nothing processed it", the MB2e pattern.
--
-- REVERSAL RUNBOOK (reverse order):
--   SELECT cron.unschedule('lcc-operator-triage');
--   SELECT cron.unschedule('lcc-operator-notes-stale-check');
--   DROP FUNCTION IF EXISTS public.lcc_check_operator_notes_stale(integer);
--   DROP VIEW IF EXISTS public.v_operator_notes_stale_open;
--   DELETE FROM public.feature_flags_registry WHERE flag = 'OPERATOR_NOTE_TRIAGE';
-- ============================================================================

INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'OPERATOR_NOTE_TRIAGE',
  'OC2 — classify each open operator_notes row (bug/data-gap/not-connecting/idea/ux/question, lane, '
  'severity), dedupe against prior notes + the PLANNED-BACKLOG index, and route to an owner thread. '
  'Deterministic keyword rules first, on-box Ollama on a miss (fails closed, no cloud fallback).',
  'GET/POST /api/operator-triage-tick -> operator_notes (note_type/lane/routed_to/triaged_at), '
  'logged to producer_runs (producer=operator_triage)',
  'OPERATOR_NOTE_TRIAGE',
  'off',
  CURRENT_DATE,
  'scott',
  'OC-v2. Registered so the flag CAN be flipped at all (it never existed before this migration). '
  'GET is always a dry run; POST writes only when the flag is on (or ?force=1). Flip to ''on'' only '
  'after reviewing a live dry-run grade against the current lane-detection + model-reachability fix '
  '(prompts/OC-v2-notes-go-in-and-nothing-happens.md) — do not flip on the strength of this migration '
  'alone.'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var, notes = EXCLUDED.notes;

-- ----------------------------------------------------------------------------
-- Cron — NOT gated on the flag (P138 pattern). '25 7 * * *' is free per a
-- static read of the migrations in this repo at commit time (no job scheduled
-- in the 7:20-7:40 window) — OPERATOR VERIFY against live `cron.job` before
-- relying on it; this sandbox cannot query the live schedule.
-- ----------------------------------------------------------------------------

DO $cronblock$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-operator-triage') THEN
    PERFORM cron.unschedule('lcc-operator-triage');
  END IF;

  PERFORM cron.schedule(
    'lcc-operator-triage',
    '25 7 * * *',
    $$SELECT public.lcc_cron_post('/api/operator-triage-tick', '{"trigger_source":"cron"}'::jsonb, 'railway');$$
  );
END
$cronblock$;

-- ----------------------------------------------------------------------------
-- Visibility monitor — an open, untriaged note aging past the threshold means
-- intake is capturing work nothing is consuming. This is the exact failure
-- OC-v2 exists to close, so it gets its own alert rather than riding a generic
-- producer-health check (the MB2e "distinct alert per fault shape" rule).
-- ----------------------------------------------------------------------------

CREATE VIEW public.v_operator_notes_stale_open AS
SELECT
  id,
  channel,
  received_at,
  EXTRACT(EPOCH FROM (now() - received_at)) / 86400.0 AS age_days,
  note_type,
  lane,
  routed_to,
  triaged_at
FROM public.operator_notes
WHERE disposition = 'open';

COMMENT ON VIEW public.v_operator_notes_stale_open IS
  'OC-v2: every currently-open operator_notes row with its age. Feeds lcc_check_operator_notes_stale. '
  'A row here with triaged_at IS NOT NULL means triage classified it but nothing routed/closed it -- '
  'still a stall, just a later stage of the same funnel.';

CREATE OR REPLACE FUNCTION public.lcc_check_operator_notes_stale(p_stale_days integer DEFAULT 3)
RETURNS TABLE(alerts_opened integer, alerts_resolved integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opened integer := 0;
  v_resolved integer := 0;
  v_row record;
  v_key text;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_operator_notes_stale_open
    WHERE age_days >= p_stale_days
  LOOP
    v_key := format('operator_note:%s', v_row.id);
    IF NOT EXISTS (
      SELECT 1 FROM public.lcc_health_alerts
      WHERE alert_kind = 'operator_note_stale_open'
        AND source = v_key
        AND resolved_at IS NULL
    ) THEN
      INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
      VALUES (
        'operator_note_stale_open', v_key, 'warn',
        format('Operator note %s (channel %s, received %s) has been open %s days with nothing consuming it -- triaged_at %s, routed_to %s',
               v_row.id, v_row.channel, v_row.received_at, round(v_row.age_days::numeric, 1),
               COALESCE(v_row.triaged_at::text, 'never'), COALESCE(v_row.routed_to, 'none')),
        jsonb_build_object(
          'note_id', v_row.id, 'channel', v_row.channel, 'received_at', v_row.received_at,
          'age_days', v_row.age_days, 'note_type', v_row.note_type, 'lane', v_row.lane,
          'routed_to', v_row.routed_to, 'triaged_at', v_row.triaged_at
        )
      );
      v_opened := v_opened + 1;
    END IF;
  END LOOP;

  -- Resolve every open alert whose note is no longer stale -- either it left
  -- disposition='open' entirely (closed/routed/superseded/refuted, so it no
  -- longer appears in v_operator_notes_stale_open at all) or it is still open
  -- but its age dropped back under the threshold (cannot happen in practice,
  -- kept for symmetry with the other auto-resolve sweeps in this file).
  UPDATE public.lcc_health_alerts a
  SET resolved_at = now(), resolved_note = 'ocv2-auto-resolve: note left open/untriaged state'
  WHERE a.alert_kind = 'operator_note_stale_open'
    AND a.resolved_at IS NULL
    AND a.source NOT IN (
      SELECT format('operator_note:%s', id) FROM public.v_operator_notes_stale_open WHERE age_days >= p_stale_days
    );
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN QUERY SELECT v_opened, v_resolved;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_check_operator_notes_stale(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_check_operator_notes_stale(integer) TO service_role;

DO $assert$
BEGIN
  IF has_function_privilege('anon', 'public.lcc_check_operator_notes_stale(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_check_operator_notes_stale must not be anon-executable';
  END IF;
END
$assert$;

DO $cronblock2$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-operator-notes-stale-check') THEN
    PERFORM cron.unschedule('lcc-operator-notes-stale-check');
  END IF;

  PERFORM cron.schedule(
    'lcc-operator-notes-stale-check',
    '30 7 * * *',
    $$SELECT public.lcc_check_operator_notes_stale(3);$$
  );
END
$cronblock2$;
