-- ============================================================================
-- P120 — Make the app actually MOVE emails: drain the processing_log move queue
-- ----------------------------------------------------------------------------
-- MEASURED LIVE 2026-08-20 (LCC Opps xengecqvemvfknjvbvrq):
--   processing_log outcome/move_status:
--     staged/pending 323 · duplicate/pending 15 · filed/moved 16 · needs_review/skipped 47
--   ALL 16 move_status='moved' rows carry outcome='filed' AND
--   target_folder = final_target_folder — the exact signature of the Flow 6
--   todo-completion-poll staged→filed flip (api/sync.js markFiled). intake.js
--   NEVER emits outcome='filed'. So the MOVE EXECUTOR has stamped ZERO rows,
--   ever; the 16 are Flow 6 bookkeeping from 2026-07-22/23.
--
-- ROOT CAUSE (four independent confirmations):
--   1. api/_shared/processing-complete.js WRITES the queue row
--      (target_folder + move_status='pending') and returns the event in the
--      intake HTTP RESPONSE. It never pushes a move.
--   2. The mover relay DOES exist — api/sync.js handleProcessingComplete
--      (POST /api/webhooks/processing-complete) → api/_shared/pa-move-message.js
--      — but it is a PUSH endpoint with NO CALLER: nothing in api/ invokes it
--      (grep: the only postMoveMessage call site is the relay itself), and
--      docs/architecture/flows/processing-complete-move-message.md says so in
--      as many words: "The CALLER ... does not exist yet."
--   3. Even when invoked, the relay NEVER stamps processing_log — no
--      move_status / moved_at / move_error write on any path. There was no
--      stamp-back for the move leg at all.
--   4. api/_shared/briefing-data.js:297 already recorded the diagnosis: "the
--      queue-drain consumer (api/_handlers/processing-complete.js) was retired".
--      The P119 migration header records it too: "all 323 processing_log
--      outcome='staged' rows are still move_status='pending' (nothing has ever
--      drained that queue)".
--   The index ix_processing_log_move_queue (workspace_id, move_status,
--   created_at) WHERE move_status='pending' already exists — the schema was
--   built for a drainer that was never written. This migration writes it.
--
-- OWNERSHIP RULE (P119's rule, made concrete — ONE owner per transition):
--   Inbox → staging, and Inbox → Processed/*  : THIS move-queue drainer.
--   staging → Processed                        : the W7.6 mailbox mirror.
--   The drainer IS the processing_log owner, so this is P119's rule unchanged
--   ("intake flow / processing_log owns Inbox → *"), with the owner now real.
--   The PA intake flow must NOT also move at classification time: a transient
--   Graph failure there is lost forever (no queue behind it), and two movers on
--   one transition is exactly the race P119 killed.
--
-- P119 SEMANTICS REUSED, NOT REINVENTED:
--   A mover ack of "the MESSAGE is not in the source folder" means the desired
--   end state is already true ⇒ TERMINAL SUCCESS on the FIRST ack
--   (move_outcome='already_out'), no retry, no park, no alert. A missing
--   DESTINATION folder is a REAL break ⇒ bounded retry → park → alert. The
--   single owner of that decision is the existing SQL function
--   lcc_mailbox_mirror_error_is_terminal(text). There is deliberately NO JS
--   copy — that would be the normaliser drift this codebase keeps hitting.
--
-- HONEST COUNTS (Consumption-Layer doctrine):
--   move_status='moved' covers BOTH "we relocated it" and "it was already
--   gone". NEVER quote it as a count of moves performed — read move_outcome:
--     'moved'       = this system relocated the message  (the real move-delta)
--     'already_out' = it had already left the source folder (terminal no-op)
--     'failed'      = genuinely stuck (move_parked=true after 5 tries)
--
-- Discipline: additive columns · fill-blanks (no existing ack history rewritten)
--   · reversible (runbook below) · idempotent (re-ack = no-op) · dry-run-default
--   sweep · bounded retry · never deletes a message or a row.
--
-- REVERSAL RUNBOOK
--   -- 1. auto-retired alerts from this migration's sweep only
--   UPDATE public.lcc_health_alerts SET resolved_at=NULL, resolved_note=NULL
--    WHERE resolved_note LIKE 'p120-move-queue-auto-retire:%';
--   -- 2. return drained rows to the queue (only ones THIS executor stamped)
--   UPDATE public.processing_log
--      SET move_status='pending', moved_at=NULL, move_error=NULL
--    WHERE move_outcome IS NOT NULL;
--   -- 3. drop the additions
--   DROP FUNCTION IF EXISTS public.lcc_move_queue_retire_cleared_parks(boolean);
--   DROP FUNCTION IF EXISTS public.lcc_move_queue_ack(text,uuid,boolean,text,text);
--   DROP VIEW IF EXISTS public.v_lcc_move_queue_worklist;
--   ALTER TABLE public.processing_log
--     DROP COLUMN IF EXISTS move_attempts, DROP COLUMN IF EXISTS move_last_attempt_at,
--     DROP COLUMN IF EXISTS move_parked,  DROP COLUMN IF EXISTS move_outcome,
--     DROP COLUMN IF EXISTS move_terminal_note;
-- ============================================================================

-- ── 1. Additive retry/disposition columns ──────────────────────────────────
ALTER TABLE public.processing_log
  ADD COLUMN IF NOT EXISTS move_attempts        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS move_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS move_parked          boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS move_outcome         text,
  ADD COLUMN IF NOT EXISTS move_terminal_note   text;

COMMENT ON COLUMN public.processing_log.move_outcome IS
  'P120. The HONEST disposition of the move: moved = this system relocated the message; '
  'already_out = it had already left the source folder (terminal success, a no-op); '
  'failed = genuinely stuck (move_parked). move_status=''moved'' covers the first TWO, '
  'so never quote move_status as a count of moves performed — count move_outcome=''moved''.';

COMMENT ON COLUMN public.processing_log.move_parked IS
  'P120. TRUE after MOVE_MAX_ATTEMPTS(5) genuine failures — the row leaves the worklist and '
  'raises a deduped move_queue_parked health alert. Reversible: set false to re-queue.';

-- Worklist index: pending, not parked, FIFO, backoff-aware.
CREATE INDEX IF NOT EXISTS ix_processing_log_move_queue_ready
  ON public.processing_log (created_at)
  WHERE move_status = 'pending' AND move_parked = false;

-- ── 2. The worklist — actionable-only, capped by the caller, FIFO ──────────
-- Consumption-Layer: a row is published ONLY if a mover can act on it right
-- now. Excluded: no move key, no destination, parked, or inside the 1h backoff
-- window after a genuine failure.
CREATE OR REPLACE VIEW public.v_lcc_move_queue_worklist AS
SELECT
  pl.id                       AS processing_log_id,
  pl.workspace_id,
  pl.internet_message_id,
  pl.graph_rest_id,
  pl.outcome,
  pl.target_folder,
  pl.final_target_folder,
  pl.subject,
  pl.channel,
  pl.domain,
  pl.created_at,
  pl.move_attempts,
  pl.move_last_attempt_at,
  -- Mirrors api/_shared/processing-complete.js: a `staged` move keeps the flag
  -- (work is still outstanding → the native Flagged-email task stays open);
  -- filed/duplicate are terminal and clear it.
  (pl.outcome IN ('filed', 'duplicate')) AS clear_flag
FROM public.processing_log pl
WHERE pl.move_status = 'pending'
  AND pl.move_parked = false
  AND pl.target_folder IS NOT NULL
  AND btrim(pl.target_folder) <> ''
  AND pl.internet_message_id IS NOT NULL
  AND btrim(pl.internet_message_id) <> ''
  AND (pl.move_last_attempt_at IS NULL
       OR pl.move_last_attempt_at < now() - interval '1 hour');

COMMENT ON VIEW public.v_lcc_move_queue_worklist IS
  'P120 move-queue worklist: processing_log rows whose move has not been executed, that a mover '
  'can act on NOW (has a move key + a destination, not parked, outside the 1h retry backoff). '
  'FIFO by created_at at the caller. Actionable-only by design — the badge is real work.';

-- ── 3. Ack RPC — the single stamp-back path ────────────────────────────────
-- ⚠️ The terminal-failure value is the schema's EXISTING 'move_failed' —
-- processing_log_move_status_check allows exactly (pending|moved|move_failed|
-- skipped). A first cut used 'error' and was rejected by that CHECK in the live
-- synthetic gate. Reuse the schema's vocabulary; never introduce a second
-- spelling for a state that already has one.
-- Idempotent: a row already out of the queue returns already_done and is never
-- rewritten (fill-blanks — a prior ack's history stands).
CREATE OR REPLACE FUNCTION public.lcc_move_queue_ack(
  p_internet_message_id text,
  p_workspace_id        uuid    DEFAULT NULL,
  p_moved               boolean DEFAULT false,
  p_target_folder       text    DEFAULT NULL,
  p_error               text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row        public.processing_log%rowtype;
  v_terminal   boolean;
  v_attempts   integer;
  v_parked     boolean;
  v_max_tries  constant integer := 5;
BEGIN
  IF p_internet_message_id IS NULL OR btrim(p_internet_message_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'internet_message_id_required');
  END IF;

  SELECT * INTO v_row
    FROM public.processing_log pl
   WHERE pl.internet_message_id = p_internet_message_id
     AND (p_workspace_id IS NULL OR pl.workspace_id = p_workspace_id)
   ORDER BY pl.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_message',
                              'internet_message_id', p_internet_message_id);
  END IF;

  -- Idempotency: already drained ⇒ no-op, never rewrite the earlier verdict.
  IF v_row.move_status <> 'pending' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_done', true,
      'internet_message_id', p_internet_message_id,
      'move_status', v_row.move_status,
      'move_outcome', v_row.move_outcome,
      'attempts', v_row.move_attempts);
  END IF;

  -- P119 semantics, single owner: the SQL classifier decides what "not found"
  -- means. Message-not-in-source-folder ⇒ terminal success. DESTINATION folder
  -- missing ⇒ NOT terminal (a real break: stale folder id) ⇒ retry/park/alert.
  v_terminal := (NOT COALESCE(p_moved, false))
                AND public.lcc_mailbox_mirror_error_is_terminal(p_error);

  IF COALESCE(p_moved, false) OR v_terminal THEN
    UPDATE public.processing_log pl
       SET move_status        = 'moved',
           moved_at           = now(),
           move_outcome       = CASE WHEN COALESCE(p_moved, false) THEN 'moved' ELSE 'already_out' END,
           move_terminal_note = CASE WHEN v_terminal THEN p_error ELSE NULL END,
           move_error         = NULL,
           move_parked        = false,
           target_folder      = COALESCE(NULLIF(btrim(COALESCE(p_target_folder, '')), ''), pl.target_folder),
           move_last_attempt_at = now()
     WHERE pl.id = v_row.id;

    -- A cleared move resolves any open park alert for this message on the spot.
    UPDATE public.lcc_health_alerts a
       SET resolved_at   = now(),
           resolved_note = 'p120-move-queue-auto-retire: cleared by ack ('
                           || CASE WHEN COALESCE(p_moved, false) THEN 'moved' ELSE 'already_out' END || ')'
     WHERE a.alert_kind = 'move_queue_parked'
       AND a.resolved_at IS NULL
       AND a.details->>'internet_message_id' = p_internet_message_id;

    RETURN jsonb_build_object(
      'ok', true,
      'internet_message_id', p_internet_message_id,
      'move_status', 'moved',
      'move_outcome', CASE WHEN COALESCE(p_moved, false) THEN 'moved' ELSE 'already_out' END,
      'terminal', v_terminal,
      'parked', false,
      'attempts', v_row.move_attempts);
  END IF;

  -- Genuine failure: bounded retry, then park loudly.
  v_attempts := COALESCE(v_row.move_attempts, 0) + 1;
  v_parked   := v_attempts >= v_max_tries;

  UPDATE public.processing_log pl
     SET move_attempts        = v_attempts,
         move_last_attempt_at = now(),
         move_error           = COALESCE(p_error, 'unknown_error'),
         move_parked          = v_parked,
         move_status          = CASE WHEN v_parked THEN 'move_failed' ELSE 'pending' END,
         move_outcome         = CASE WHEN v_parked THEN 'failed' ELSE NULL END
   WHERE pl.id = v_row.id;

  IF v_parked THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'move_queue_parked', 'lcc_move_queue_ack', 'warn',
           'Email move parked after ' || v_attempts || ' failed attempts: '
             || COALESCE(NULLIF(btrim(v_row.subject), ''), '(no subject)'),
           jsonb_build_object(
             'internet_message_id', p_internet_message_id,
             'processing_log_id',   v_row.id,
             'target_folder',       COALESCE(p_target_folder, v_row.target_folder),
             'outcome',             v_row.outcome,
             'attempts',            v_attempts,
             'last_error',          COALESCE(p_error, 'unknown_error'))
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lcc_health_alerts a
       WHERE a.alert_kind = 'move_queue_parked'
         AND a.resolved_at IS NULL
         AND a.details->>'internet_message_id' = p_internet_message_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'internet_message_id', p_internet_message_id,
    'move_status', CASE WHEN v_parked THEN 'move_failed' ELSE 'pending' END,
    'move_outcome', CASE WHEN v_parked THEN 'failed' ELSE NULL END,
    'terminal', false,
    'parked', v_parked,
    'attempts', v_attempts,
    'retry_after', CASE WHEN v_parked THEN NULL ELSE (now() + interval '1 hour') END);
END;
$function$;

COMMENT ON FUNCTION public.lcc_move_queue_ack(text,uuid,boolean,text,text) IS
  'P120. The SINGLE stamp-back path for the processing_log move queue. Idempotent (a row already '
  'out of the queue is never rewritten). Reuses lcc_mailbox_mirror_error_is_terminal: '
  '"message not in source folder" = terminal SUCCESS on the first ack (already_out), while a '
  'missing DESTINATION folder retries 5x then parks + alerts.';

-- ── 4. Auto-retire sweep — never leave a stale park alert open ─────────────
CREATE OR REPLACE FUNCTION public.lcc_move_queue_retire_cleared_parks(
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_candidates integer;
  v_retired    integer := 0;
  v_left_open  integer;
BEGIN
  -- A park alert is stale when its message is no longer parked/pending — the
  -- premise cleared (someone moved it by hand, or a later ack drained it).
  WITH cleared AS (
    SELECT a.alert_id
      FROM public.lcc_health_alerts a
      JOIN public.processing_log pl
        ON pl.internet_message_id = a.details->>'internet_message_id'
     WHERE a.alert_kind = 'move_queue_parked'
       AND a.resolved_at IS NULL
       AND pl.move_status = 'moved'
  )
  SELECT count(*) INTO v_candidates FROM cleared;

  IF NOT p_dry_run THEN
    WITH cleared AS (
      SELECT a.alert_id
        FROM public.lcc_health_alerts a
        JOIN public.processing_log pl
          ON pl.internet_message_id = a.details->>'internet_message_id'
       WHERE a.alert_kind = 'move_queue_parked'
         AND a.resolved_at IS NULL
         AND pl.move_status = 'moved'
    )
    UPDATE public.lcc_health_alerts a
       SET resolved_at   = now(),
           resolved_note = 'p120-move-queue-auto-retire: message left the queue'
      FROM cleared c
     WHERE a.alert_id = c.alert_id
       AND a.resolved_at IS NULL;   -- idempotent: never rewrite another batch's tag
    GET DIAGNOSTICS v_retired = ROW_COUNT;
  END IF;

  SELECT count(*) INTO v_left_open
    FROM public.lcc_health_alerts a
   WHERE a.alert_kind = 'move_queue_parked' AND a.resolved_at IS NULL;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'candidates', v_candidates,
    'retired', v_retired,
    -- The HONEST count of genuinely stuck moves still needing a human.
    'alerts_left_open', v_left_open);
END;
$function$;

COMMENT ON FUNCTION public.lcc_move_queue_retire_cleared_parks(boolean) IS
  'P120 auto-retire: resolves move_queue_parked alerts whose message has since left the queue. '
  'Dry-run default. Touches resolved_at IS NULL only ⇒ idempotent. alerts_left_open is the honest '
  'count of genuinely stuck moves.';

GRANT SELECT ON public.v_lcc_move_queue_worklist TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_move_queue_ack(text,uuid,boolean,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_move_queue_retire_cleared_parks(boolean) TO service_role;

-- ── 5. Inert-feature registry ──────────────────────────────────────────────
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'MOVE_QUEUE_EXECUTOR',
  'Drains processing_log.move_status=''pending'' — the executor that actually moves an intake email '
    || 'from the Inbox into its target folder (staged → "Intake Staged, Not Completed"; '
    || 'filed/duplicate → Processed/*), then stamps the result back.',
  'GET /api/move-queue-worklist + POST /api/move-queue-ack (PA "LCC Move Queue Executor" flow)',
  'MOVE_QUEUE_EXECUTOR',
  'off',
  CURRENT_DATE,
  'Scott Briggs',
  'P120 (2026-08-20). Built because NOTHING had ever drained this queue: 323 staged + 15 duplicate '
    || 'moves pending since 2026-07-21, and all 16 move_status=''moved'' rows were Flow 6 '
    || 'bookkeeping, not moves. Reuses P119 terminal semantics via '
    || 'lcc_mailbox_mirror_error_is_terminal (no JS copy). Honest counts: read move_outcome, not '
    || 'move_status. Flip to ''on'' in the Railway env once the PA flow is built.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      notes   = EXCLUDED.notes;

-- ── 6. Auto-retire cron (jobid 233 live; 06:35, after the mirror retire 06:25) ─
--   SELECT cron.schedule('lcc-move-queue-retire','35 6 * * *',
--     $$select public.lcc_move_queue_retire_cleared_parks(false);$$);
--   Unschedule: SELECT cron.unschedule('lcc-move-queue-retire');
