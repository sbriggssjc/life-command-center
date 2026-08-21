-- ============================================================================
-- P121 — Close the staging→Processed ordering hazard (Flow 6 vs the W7.6 mirror)
-- ----------------------------------------------------------------------------
-- P120's move-queue executor went live 2026-08-20 19:42Z and immediately began
-- filling the "Intake Staged, Not Completed" folder. That turned P120's own
-- §"Known ordering hazard" from latent into REACHABLE, because two consumers
-- react to the same event — a staged email's To Do completing — and BOTH keyed
-- on the same transient field, processing_log.outcome='staged':
--
--   Flow 6  (api/sync.js todo-completion-poll → markFiled) flips outcome
--           staged→filed and stamped move_status='moved' + moved_at +
--           target_folder=final_target_folder. It performs NO Graph move; its
--           own comment says "PA already moved the email there".
--   Mirror  (W7.6) performs the actual staging → Processed/* move, and its
--           worklist was gated on processing_log.outcome='staged'.
--
-- If Flow 6 won the race the row stopped being 'staged', the mirror's worklist
-- DROPPED it, and the message sat in staging forever while the DB read
-- filed/moved — this codebase's signature failure mode: looks exactly like
-- success, did nothing.
--
-- MEASURED LIVE 2026-08-20 (LCC Opps xengecqvemvfknjvbvrq), both flags ON:
--   processing_log: staged/pending 240 · staged/moved(move_outcome=moved) 81
--     · staged/moved(already_out) 5 · needs_review/skipped 47
--     · filed/moved(move_outcome NULL) 16 · duplicate/* 15
--   81 messages are PHYSICALLY IN STAGING right now (move_outcome='moved' with
--   target_folder='Intake Staged, Not Completed', moved_at 19:42–20:15Z today).
--   240 more are still draining in at 25/run × 4 runs/hr. Every one of them is
--   exposed the moment its To Do completes.
--   The 16 filed/moved/move_outcome-NULL rows are Flow 6 bookkeeping from
--   2026-07-22/23 — a MONTH before the executor existed, so those messages were
--   moved by the old PA intake flow and are NOT stranded. Today's Flow-6-race
--   stranded count is genuinely 0; what this migration fixes is the mechanism,
--   before the first To Do completes against a staged message.
--
-- ⚠️ SECOND, ALREADY-LIVE STRANDING CLASS FOUND WHILE GROUNDING THIS:
--   61 of those 81 in-staging messages are ALREADY invisible to the mirror.
--   They carry a pre-P119 ledger row parked=true /
--   last_error='not_found_or_not_in_source_folder', acked 2026-08-07..09 — days
--   BEFORE the staging placement, back when the staging folder was empty and
--   that verdict was CORRECT. The executor has since put them in staging, so the
--   verdict is now provably about a prior state of the mailbox, and the ledger
--   exclusion (moved/parked) keeps them out of the worklist permanently. The
--   P119 retire sweep cannot catch it: it only ever moves a row TOWARD terminal,
--   never re-queues. Hence the acked_at < staged_at invalidation below and the
--   reversible re-enqueue sweep.
--
-- THE FIX — a DURABLE anchor, not a transient one.
--   processing_log.staged_at = "LCC placed this message in the staging folder",
--   stamped by lcc_move_queue_ack only on a GENUINE move (moved=true) whose
--   destination is the staging folder. It is never cleared, and Flow 6 never
--   touches it. The mirror anchors on it, so a staged→filed flip can no longer
--   drop a row that is still sitting in staging.
--   Deliberately NOT stamped on an 'already_out' ack: "the message was not in
--   the Inbox" does not prove "the message is in staging". Only a move we
--   performed proves placement (honest-counts doctrine).
--
-- ONE OWNER PER FOLDER TRANSITION (P119's rule, now enforced on both sides):
--   Inbox → staging, Inbox → Processed/*   : the P120 move queue.
--   staging → Processed/*                  : the W7.6 mailbox mirror. ONLY.
--   Flow 6 (To Do completion)              : INFORMATIONAL. It records that the
--     To Do closed (outcome='filed' + todo_completed_at) and may RETARGET a
--     still-queued row so the move queue delivers it straight to its final
--     folder — but it never claims a mailbox action it did not perform.
--
-- Discipline: additive columns · fill-blanks (no ack history rewritten) ·
--   the terminal/stale decision stays in SQL (never a JS copy) · reversible
--   (runbook below; ledger repairs carry their prior state in requeue_prior) ·
--   idempotent · dry-run-default sweep · honest counts.
--
-- REVERSAL RUNBOOK
--   -- 1. un-requeue the ledger rows this migration's sweep reset
--   UPDATE public.lcc_mailbox_reconcile_ledger led SET
--     outcome       = led.requeue_prior->>'outcome',
--     moved         = (led.requeue_prior->>'moved')::boolean,
--     parked        = (led.requeue_prior->>'parked')::boolean,
--     attempts      = (led.requeue_prior->>'attempts')::int,
--     last_error    = led.requeue_prior->>'last_error',
--     terminal_note = led.requeue_prior->>'terminal_note',
--     next_retry_at = NULLIF(led.requeue_prior->>'next_retry_at','')::timestamptz,
--     action        = led.requeue_prior->>'action',
--     requeued_at   = NULL, requeue_prior = NULL
--    WHERE led.requeue_prior IS NOT NULL;
--   -- 2. restore the prior bodies / drop the additions
--   SELECT cron.unschedule('lcc-mailbox-mirror-requeue');
--   DROP FUNCTION IF EXISTS public.lcc_mailbox_mirror_requeue_stranded(boolean);
--   DROP VIEW     IF EXISTS public.v_lcc_mailbox_mirror_stranded;
--   DROP FUNCTION IF EXISTS public.lcc_todo_completion_mark_filed(uuid);
--   ALTER TABLE public.lcc_mailbox_reconcile_ledger
--     DROP COLUMN IF EXISTS requeued_at, DROP COLUMN IF EXISTS requeue_prior;
--   ALTER TABLE public.processing_log
--     DROP COLUMN IF EXISTS staged_at, DROP COLUMN IF EXISTS todo_completed_at;
--   -- then re-apply 20260820120000 (view + mirror ack) and 20260820140000
--   -- (lcc_move_queue_ack) for the prior bodies. DROP FUNCTION
--   -- lcc_staging_folder_name() LAST — the restored bodies do not use it.
-- ============================================================================

-- ── 1. The staging-folder name has exactly ONE spelling in SQL ──────────────
-- Mirrors STAGING_FOLDER in api/_shared/processing-complete.js. Two hand-typed
-- copies of a folder string is the same normaliser drift this codebase keeps
-- getting bitten by; test/todo-completion.test.mjs asserts the two agree.
CREATE OR REPLACE FUNCTION public.lcc_staging_folder_name()
RETURNS text LANGUAGE sql IMMUTABLE AS
$function$ SELECT 'Intake Staged, Not Completed'::text $function$;

COMMENT ON FUNCTION public.lcc_staging_folder_name() IS
  'P121. The single SQL spelling of the intake staging folder. Mirrors '
  'STAGING_FOLDER in api/_shared/processing-complete.js (asserted by a test).';

-- ── 2. Durable placement + To-Do-disposition columns ───────────────────────
ALTER TABLE public.processing_log
  ADD COLUMN IF NOT EXISTS staged_at         timestamptz,
  ADD COLUMN IF NOT EXISTS todo_completed_at timestamptz;

COMMENT ON COLUMN public.processing_log.staged_at IS
  'P121. When LCC PLACED this message in the "Intake Staged, Not Completed" folder — stamped by '
  'lcc_move_queue_ack ONLY on a genuine move (moved=true) whose destination is that folder. NOT '
  'stamped on an already_out ack: "not in the Inbox" does not prove "in staging". This is the '
  'DURABLE anchor the W7.6 mirror worklist keys on, so a Flow 6 staged→filed flip can no longer '
  'drop a message that is still sitting in staging. Never cleared; Flow 6 never writes it.';

COMMENT ON COLUMN public.processing_log.todo_completed_at IS
  'P121. When Flow 6 (todo-completion-poll) observed the native Flagged-email To Do complete. A '
  'DISPOSITION record only — Flow 6 performs no Graph move, so it must never stamp move_status / '
  'moved_at / move_outcome. The staging→Processed move is the mirror''s, and it is recorded in '
  'lcc_mailbox_reconcile_ledger.';

-- Backfill: reconstruct staged_at for placements the executor already PROVED
-- (move_outcome='moved' AND the destination is the staging folder). Nothing is
-- invented — moved_at is the executor's own ack timestamp. Live: 81 rows.
UPDATE public.processing_log
   SET staged_at = moved_at
 WHERE staged_at IS NULL
   AND move_outcome = 'moved'
   AND target_folder = public.lcc_staging_folder_name()
   AND moved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_processing_log_staged_at
  ON public.processing_log (staged_at)
  WHERE staged_at IS NOT NULL;

-- ── 3. Ledger: reversible re-enqueue columns ───────────────────────────────
ALTER TABLE public.lcc_mailbox_reconcile_ledger
  ADD COLUMN IF NOT EXISTS requeued_at   timestamptz,
  ADD COLUMN IF NOT EXISTS requeue_prior jsonb;

COMMENT ON COLUMN public.lcc_mailbox_reconcile_ledger.requeue_prior IS
  'P121. The verbatim prior ledger state captured when lcc_mailbox_mirror_requeue_stranded reset a '
  'verdict that predated the message''s current staging placement. Reversal is mechanical — see the '
  'runbook in migration 20260820160000. NULL = this row was never re-queued.';

-- ── 4. lcc_move_queue_ack — stamp the durable placement ────────────────────
-- Byte-identical to P120 except for the staged_at stamp on the success branch.
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
  v_dest       text;
  v_staged     boolean;
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

  IF v_row.move_status <> 'pending' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_done', true,
      'internet_message_id', p_internet_message_id,
      'move_status', v_row.move_status,
      'move_outcome', v_row.move_outcome,
      'attempts', v_row.move_attempts);
  END IF;

  v_terminal := (NOT COALESCE(p_moved, false))
                AND public.lcc_mailbox_mirror_error_is_terminal(p_error);

  -- The destination this ack is about (the mover echoes it; fall back to the row).
  v_dest := COALESCE(NULLIF(btrim(COALESCE(p_target_folder, '')), ''), v_row.target_folder);

  IF COALESCE(p_moved, false) OR v_terminal THEN
    -- P121: a GENUINE move into the staging folder is the durable placement the
    -- mirror anchors on. An already_out ack proves the message left the Inbox,
    -- NOT that it is in staging — so it never stamps staged_at.
    v_staged := COALESCE(p_moved, false) AND v_dest = public.lcc_staging_folder_name();

    UPDATE public.processing_log pl
       SET move_status        = 'moved',
           moved_at           = now(),
           move_outcome       = CASE WHEN COALESCE(p_moved, false) THEN 'moved' ELSE 'already_out' END,
           move_terminal_note = CASE WHEN v_terminal THEN p_error ELSE NULL END,
           move_error         = NULL,
           move_parked        = false,
           target_folder      = COALESCE(v_dest, pl.target_folder),
           staged_at          = CASE WHEN v_staged THEN now() ELSE pl.staged_at END,
           move_last_attempt_at = now()
     WHERE pl.id = v_row.id;

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
      'staged', COALESCE(v_staged, false),
      'parked', false,
      'attempts', v_row.move_attempts);
  END IF;

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
    'staged', false,
    'parked', v_parked,
    'attempts', v_attempts,
    'retry_after', CASE WHEN v_parked THEN NULL ELSE (now() + interval '1 hour') END);
END;
$function$;

COMMENT ON FUNCTION public.lcc_move_queue_ack(text,uuid,boolean,text,text) IS
  'P120/P121. The SINGLE stamp-back path for the processing_log move queue. Idempotent (a row '
  'already out of the queue is never rewritten). Reuses lcc_mailbox_mirror_error_is_terminal: '
  '"message not in source folder" = terminal SUCCESS on the first ack (already_out), a missing '
  'DESTINATION folder retries 5x then parks + alerts. P121: a genuine move whose destination is '
  'lcc_staging_folder_name() also stamps processing_log.staged_at — the durable placement anchor '
  'the W7.6 mirror keys on. An already_out ack never stamps it.';

-- ── 5. Flow 6 mark-filed — record the disposition, never claim the move ────
-- The SINGLE owner of what a completed To Do does to processing_log. Replaces
-- the raw PATCH in api/sync.js markFiled, which stamped move_status='moved' +
-- moved_at + target_folder=final_target_folder — asserting a mailbox action
-- Flow 6 never performs, and the exact stamp that hid a stranded message.
--
-- Three dispositions, decided by whether the message is ALREADY in staging:
--   mirror_owns_move    — staged_at set ⇒ the message is in staging. Record the
--                         To Do only. The mirror owns staging → Processed and
--                         records it in its own ledger.
--   retargeted_to_final — never placed in staging and the Inbox → staging move
--                         is still queued ⇒ retarget the SAME queue row to
--                         final_target_folder so the move queue (the single
--                         owner of Inbox → *) delivers it straight to Processed
--                         and clears the flag. move_status stays 'pending': no
--                         move is asserted, only a destination changed.
--   no_move_state_change— anything else (skipped / parked / already moved
--                         elsewhere / no resolved destination): flip the outcome
--                         and touch nothing about the mailbox.
--
-- Both race interleavings are safe by construction. If the executor is mid-flight
-- and acks the staging destination after a retarget, that ack stamps staged_at,
-- so the mirror worklist picks the message up on the staged_at arm. If it acks
-- the retargeted destination, the message went straight to Processed and the
-- mirror correctly never publishes it.
CREATE OR REPLACE FUNCTION public.lcc_todo_completion_mark_filed(
  p_processing_log_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row         public.processing_log%rowtype;
  v_disposition text;
  v_n           integer := 0;
BEGIN
  IF p_processing_log_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'filed', false, 'disposition', 'missing_id');
  END IF;

  -- Serialise against a concurrent poll so the guard below is a real guard.
  SELECT * INTO v_row FROM public.processing_log pl
   WHERE pl.id = p_processing_log_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'filed', false, 'disposition', 'unknown_row');
  END IF;

  -- Idempotent: a row already resolved is a no-op, never rewritten.
  IF v_row.outcome IS DISTINCT FROM 'staged' THEN
    RETURN jsonb_build_object('ok', true, 'filed', false,
                              'disposition', 'already_resolved',
                              'internet_message_id', v_row.internet_message_id,
                              'outcome', v_row.outcome);
  END IF;

  IF v_row.staged_at IS NOT NULL THEN
    v_disposition := 'mirror_owns_move';
    UPDATE public.processing_log pl
       SET outcome = 'filed', todo_completed_at = now()
     WHERE pl.id = v_row.id AND pl.outcome = 'staged';

  ELSIF v_row.move_status = 'pending'
        AND COALESCE(v_row.move_parked, false) = false
        AND COALESCE(btrim(v_row.final_target_folder), '') <> '' THEN
    v_disposition := 'retargeted_to_final';
    UPDATE public.processing_log pl
       SET outcome        = 'filed',
           todo_completed_at = now(),
           target_folder  = v_row.final_target_folder
     WHERE pl.id = v_row.id AND pl.outcome = 'staged';

  ELSE
    v_disposition := 'no_move_state_change';
    UPDATE public.processing_log pl
       SET outcome = 'filed', todo_completed_at = now()
     WHERE pl.id = v_row.id AND pl.outcome = 'staged';
  END IF;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'filed', v_n > 0,
    'disposition', CASE WHEN v_n > 0 THEN v_disposition ELSE 'already_resolved' END,
    'internet_message_id', v_row.internet_message_id,
    'staged_at', v_row.staged_at,
    'final_target_folder', v_row.final_target_folder);
END;
$function$;

COMMENT ON FUNCTION public.lcc_todo_completion_mark_filed(uuid) IS
  'P121. The single owner of what a completed To Do does to processing_log (Flow 6, '
  'todo-completion-poll). Flips outcome staged→filed idempotently and stamps todo_completed_at. '
  'NEVER stamps move_status / moved_at / move_outcome — Flow 6 performs no Graph move, and '
  'claiming one is what let a message sit in staging forever while the DB read filed/moved. '
  'Returns disposition: mirror_owns_move (already in staging — the mirror owns staging→Processed), '
  'retargeted_to_final (still queued — the move queue now delivers it straight to Processed), '
  'no_move_state_change, or already_resolved.';

-- ── 6. Mirror worklist — anchor on the DURABLE placement ───────────────────
-- Two changes, both in the gate (CREATE OR REPLACE VIEW is append-only for
-- columns, so the existing 8 keep their position/type and staged_at is APPENDED):
--   (a) the P119 source-folder gate widens from the transient outcome='staged'
--       to (staged_at IS NOT NULL OR outcome='staged'), so a Flow 6 flip cannot
--       drop a message that is still in staging;
--   (b) a ledger verdict recorded BEFORE the current placement is about a prior
--       state of the mailbox and no longer excludes the row — that is the 61
--       messages parked 2026-08-07..09 as not-in-source-folder (true then, the
--       folder was empty) which the executor placed in staging on 2026-08-20.
CREATE OR REPLACE VIEW public.v_lcc_mailbox_reconcile_worklist AS
WITH m AS (
  SELECT i.id            AS inbox_item_id,
         i.workspace_id,
         i.external_id    AS internet_message_id,
         i.status::text   AS inbox_status,
         i.entity_id      AS inbox_entity_id,
         i.title,
         i.triaged_at,
         i.updated_at,
         pl.staged_at,
         pl.todo_completed_at
  FROM public.inbox_items i
  -- P121: the source-folder gate, now durable. LATERAL (not EXISTS) so the view
  -- can read staged_at; prefer a row that PROVES placement over one that merely
  -- decided it. An inner join keeps this a gate exactly as P119 intended.
  JOIN LATERAL (
    SELECT p.staged_at, p.todo_completed_at
    FROM public.processing_log p
    WHERE p.internet_message_id = i.external_id
      AND (p.staged_at IS NOT NULL OR p.outcome = 'staged')
    ORDER BY (p.staged_at IS NOT NULL) DESC, p.created_at DESC
    LIMIT 1
  ) pl ON true
  WHERE i.source_type = 'flagged_email'
    AND i.external_id IS NOT NULL
),
ae AS (
  SELECT DISTINCT ON (a.external_id)
         a.external_id  AS internet_message_id,
         a.entity_id,
         a.occurred_at,
         a.metadata->>'conversation_id' AS conversation_id
  FROM public.activity_events a
  WHERE a.source_type = 'outlook_inbound'
    AND a.external_id IS NOT NULL
  ORDER BY a.external_id, a.occurred_at DESC
),
j AS (
  SELECT
    m.*,
    ae.entity_id     AS ae_entity_id,
    ae.occurred_at   AS inbound_at,
    ae.conversation_id,
    COALESCE(m.inbox_entity_id, ae.entity_id) AS deal_entity_id,
    -- P121 arm (d): Flow 6 saw the native Flagged-email To Do completed. The most
    -- authoritative closure signal there is (Scott closed it by hand) — and the ONLY
    -- one this population can satisfy: the native-list model creates no action_items,
    -- so todos_done is structurally dead for staged messages (0 of 103 live have any)
    -- and 27 still have an untriaged inbox_item. Without this arm, completing a To Do
    -- flips the row to filed and NOTHING ever publishes the staging→Processed move.
    ( m.todo_completed_at IS NOT NULL ) AS todo_completed,
    ( EXISTS (SELECT 1 FROM public.action_items ai WHERE ai.inbox_item_id = m.inbox_item_id)
      AND NOT EXISTS (SELECT 1 FROM public.action_items ai
                      WHERE ai.inbox_item_id = m.inbox_item_id
                        AND ai.status IN ('open','in_progress','waiting')) ) AS todos_done,
    ( ae.conversation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.activity_events a2
        WHERE a2.source_type IN ('outlook_sent','outlook_tagged')
          AND a2.metadata->>'conversation_id' = ae.conversation_id
          AND a2.occurred_at > ae.occurred_at) ) AS thread_replied,
    ( m.inbox_status IN ('dismissed','archived') ) AS inbox_triaged
  FROM m
  LEFT JOIN ae ON ae.internet_message_id = m.internet_message_id
)
SELECT
  j.internet_message_id,
  j.workspace_id,
  j.inbox_item_id,
  j.deal_entity_id,
  j.title AS subject,
  CASE WHEN j.todo_completed THEN 'todo_completed'
       WHEN j.todos_done      THEN 'todos_done'
       WHEN j.thread_replied  THEN 'thread_replied'
       WHEN j.inbox_triaged   THEN 'inbox_triaged'
  END AS reason,
  CASE
    WHEN j.todo_completed THEN j.todo_completed_at
    WHEN j.todos_done THEN (SELECT max(COALESCE(ai.completed_at, ai.updated_at))
                              FROM public.action_items ai WHERE ai.inbox_item_id = j.inbox_item_id)
    WHEN j.thread_replied THEN (SELECT min(a2.occurred_at)
                              FROM public.activity_events a2
                              WHERE a2.source_type IN ('outlook_sent','outlook_tagged')
                                AND a2.metadata->>'conversation_id' = j.conversation_id
                                AND a2.occurred_at > j.inbound_at)
    ELSE COALESCE(j.triaged_at, j.updated_at)
  END AS closed_at,
  COALESCE(led.attempts, 0) AS attempts,
  j.staged_at                                      -- P121, appended
FROM j
LEFT JOIN public.lcc_mailbox_reconcile_ledger led
       ON led.internet_message_id = j.internet_message_id
WHERE (j.todo_completed OR j.todos_done OR j.thread_replied OR j.inbox_triaged)
  AND NOT EXISTS (
        SELECT 1 FROM public.action_items o
        WHERE o.entity_id = j.deal_entity_id
          AND o.action_type = 'offer_review'
          AND o.status IN ('open','in_progress'))
  AND (led.internet_message_id IS NULL
       -- P121: a verdict recorded before the CURRENT placement describes a prior
       -- state of the mailbox and cannot bind this one.
       OR (j.staged_at IS NOT NULL AND led.acked_at < j.staged_at)
       OR (COALESCE(led.moved,false) = false
           AND led.parked = false
           AND (led.next_retry_at IS NULL OR led.next_retry_at <= now())));

COMMENT ON VIEW public.v_lcc_mailbox_reconcile_worklist IS
  'W7.6 deterministic (NO-LLM) mailbox-mirror worklist, P119-gated and P121-anchored. Flagged-email '
  'inbox_items that LCC ITSELF routed to the "Intake Staged, Not Completed" folder — anchored on the '
  'DURABLE processing_log.staged_at, not the transient outcome=''staged'', so a Flow 6 staged→filed '
  'flip can no longer drop a message still sitting in staging (P120''s ordering hazard) — AND whose '
  'loop is closed. Closure arms, in reason priority: todo_completed (Flow 6 saw the native '
  'Flagged-email To Do completed — processing_log.todo_completed_at; the most authoritative signal '
  'and the ONLY one the staged population can satisfy, since the native-list model creates no '
  'action_items: 0 of 103 staged messages have any, so todos_done is structurally dead for them), '
  'todos_done, thread_replied, inbox_triaged. Withheld while the deal has an open offer_review. '
  'Excludes ledger moved/parked/backoff messages EXCEPT where the verdict predates the current '
  'staging placement (a stale verdict about a prior state).';

-- ── 7. Stranded detector — in staging, invisible to the mirror ─────────────
CREATE OR REPLACE VIEW public.v_lcc_mailbox_mirror_stranded AS
WITH c AS (
  SELECT
    pl.id                AS processing_log_id,
    pl.workspace_id,
    pl.internet_message_id,
    pl.subject,
    pl.outcome,
    pl.move_status,
    pl.move_outcome,
    pl.target_folder,
    pl.final_target_folder,
    pl.staged_at,
    pl.todo_completed_at,
    led.outcome  AS ledger_outcome,
    led.parked   AS ledger_parked,
    led.acked_at AS ledger_acked_at,
    CASE
      -- (a) a pre-placement verdict (parked / moved) still excluding the row.
      WHEN led.internet_message_id IS NOT NULL
           AND (COALESCE(led.moved,false) OR led.parked)
           AND led.acked_at < pl.staged_at                THEN 'stale_park'
      -- (b) something rewrote the row to claim a destination the message is not
      --     at — the pre-P121 Flow 6 markFiled signature.
      WHEN pl.target_folder IS DISTINCT FROM public.lcc_staging_folder_name()
                                                          THEN 'flow6_asserted'
    END AS stranded_class
  FROM public.processing_log pl
  LEFT JOIN public.lcc_mailbox_reconcile_ledger led
         ON led.internet_message_id = pl.internet_message_id
  -- Only messages LCC PROVABLY placed in staging, with no mirror ack since that
  -- placement saying they left it.
  WHERE pl.staged_at IS NOT NULL
    AND NOT (led.internet_message_id IS NOT NULL
             AND led.acked_at >= pl.staged_at
             AND led.outcome IN ('moved','already_out'))
)
SELECT * FROM c WHERE stranded_class IS NOT NULL;

COMMENT ON VIEW public.v_lcc_mailbox_mirror_stranded IS
  'P121. Messages LCC provably placed in the staging folder (processing_log.staged_at) which no '
  'mirror ack has since moved out, and which the mirror cannot see. stale_park = a ledger verdict '
  'recorded BEFORE the placement (parked/moved) still excluding the row — 61 live at P121, acked '
  '2026-08-07..09 as not-in-source-folder when the folder really was empty. flow6_asserted = the row '
  'claims a destination the message is not at (the pre-P121 Flow 6 markFiled stamp). Both are '
  're-enqueued structurally by v_lcc_mailbox_reconcile_worklist; the sweep below clears the stale '
  'ledger verdict so it stops asserting a state that is no longer true.';

-- ── 8. Reversible re-enqueue sweep (Consumption-Layer: auto-retire's inverse) ─
-- The worklist already re-publishes these structurally. This clears the stale
-- LEDGER verdict so the ledger stops asserting a state that is no longer true,
-- and so a later ack lands on a clean row rather than incrementing a stale
-- attempts counter straight back into a park.
-- Deliberately touches ONLY the ledger: the flow6_asserted class needs no
-- processing_log repair (staged_at is the load-bearing field and it is correct;
-- target_folder's prior value is still in final_target_folder), and rewriting a
-- move row would be a second writer on a field the move queue owns.
CREATE OR REPLACE FUNCTION public.lcc_mailbox_mirror_requeue_stranded(
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_stale_park     integer := 0;
  v_flow6          integer := 0;
  v_ledger_reset   integer := 0;
BEGIN
  SELECT count(*) FILTER (WHERE stranded_class = 'stale_park'),
         count(*) FILTER (WHERE stranded_class = 'flow6_asserted')
    INTO v_stale_park, v_flow6
    FROM public.v_lcc_mailbox_mirror_stranded;

  IF NOT p_dry_run THEN
    WITH tgt AS (
      SELECT DISTINCT s.internet_message_id
        FROM public.v_lcc_mailbox_mirror_stranded s
       WHERE s.stranded_class = 'stale_park'
    ), upd AS (
      UPDATE public.lcc_mailbox_reconcile_ledger led
         SET requeue_prior = jsonb_build_object(
               'outcome',       led.outcome,
               'moved',         led.moved,
               'parked',        led.parked,
               'attempts',      led.attempts,
               'last_error',    led.last_error,
               'terminal_note', led.terminal_note,
               'action',        led.action,
               'next_retry_at', led.next_retry_at,
               'acked_at',      led.acked_at),
             requeued_at   = now(),
             outcome       = NULL,
             moved         = false,
             parked        = false,
             attempts      = 0,
             last_error    = NULL,
             next_retry_at = NULL
        FROM tgt
       WHERE led.internet_message_id = tgt.internet_message_id
         -- idempotent: never re-capture a prior state over an existing one.
         AND led.requeue_prior IS NULL
      RETURNING 1)
    SELECT count(*) INTO v_ledger_reset FROM upd;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    -- Honest counts: what is stranded, and what this run actually rewrote.
    'stranded_stale_park',   v_stale_park,
    'stranded_flow6_asserted', v_flow6,
    'ledger_verdicts_reset', v_ledger_reset,
    'tag', 'p121-mirror-requeue');
END;
$function$;

COMMENT ON FUNCTION public.lcc_mailbox_mirror_requeue_stranded(boolean) IS
  'P121 re-enqueue sweep — the inverse of P119''s auto-retire. Clears mailbox-mirror ledger verdicts '
  'that predate the message''s current staging placement, preserving the prior state verbatim in '
  'requeue_prior (reversal runbook in migration 20260820160000). Dry-run default, idempotent (a row '
  'that already carries requeue_prior is never re-captured). Reports stranded counts per class '
  'separately from what it actually rewrote — never quote one as the other.';

-- ── 9. Cron — daily self-heal, paired with P119's retire at 06:25.
SELECT cron.unschedule('lcc-mailbox-mirror-requeue')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='lcc-mailbox-mirror-requeue');
SELECT cron.schedule('lcc-mailbox-mirror-requeue', '35 6 * * *',
  $cron$SELECT public.lcc_mailbox_mirror_requeue_stranded(false)$cron$);

-- ── 10. Grants.
GRANT EXECUTE ON FUNCTION public.lcc_staging_folder_name() TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_todo_completion_mark_filed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_mailbox_mirror_requeue_stranded(boolean) TO service_role;
GRANT SELECT ON public.v_lcc_mailbox_mirror_stranded TO service_role;

-- ── 11. Registry notes — the flags are ON; record what changed under them.
UPDATE public.feature_flags_registry
   SET notes = notes || ' P121 (2026-08-20): worklist anchored on the DURABLE '
               || 'processing_log.staged_at (not the transient outcome=''staged''), so a Flow 6 '
               || 'staged→filed flip can no longer drop a message still sitting in staging; a ledger '
               || 'verdict predating the current placement no longer excludes the row; stranded '
               || 'detector v_lcc_mailbox_mirror_stranded + re-enqueue sweep '
               || 'lcc_mailbox_mirror_requeue_stranded + cron lcc-mailbox-mirror-requeue (06:35 UTC).'
 WHERE flag = 'MAILBOX_MIRROR'
   AND notes NOT LIKE '%P121 (2026-08-20)%';

UPDATE public.feature_flags_registry
   SET notes = notes || ' P121 (2026-08-20): lcc_move_queue_ack now stamps processing_log.staged_at '
               || 'on a genuine move into lcc_staging_folder_name() — the durable placement anchor '
               || 'the W7.6 mirror keys on. An already_out ack never stamps it ("not in the Inbox" '
               || 'does not prove "in staging").'
 WHERE flag = 'MOVE_QUEUE_EXECUTOR'
   AND notes NOT LIKE '%P121 (2026-08-20)%';
