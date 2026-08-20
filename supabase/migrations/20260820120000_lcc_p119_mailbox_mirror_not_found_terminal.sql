-- ============================================================================
-- P119 — Mailbox-mirror park storm: "not in the source folder" is SUCCESS
-- ----------------------------------------------------------------------------
-- MEASURED LIVE 2026-08-20 (LCC Opps xengecqvemvfknjvbvrq):
--   lcc_mailbox_reconcile_ledger: 3,963 rows, **0 moved=true, ever** (since
--   2026-08-06). 3,960 parked, 100% with the identical
--   last_error='not_found_or_not_in_source_folder', producing 3,960 open
--   mailbox_mirror_parked alerts — 99.3% of the whole open-alert surface.
--
-- The park storm has TWO independent causes, both fixed here:
--
-- (1) PRODUCER OVER-EMISSION — the worklist had no source-folder-membership
--     predicate. It anchored on EVERY inbox_items row with
--     source_type='flagged_email' (4,051), of which 3,944 are status='archived'
--     — and that 'archived' is not a deliberate triage but two bulk inbox
--     sweeps (2,319 rows on 2026-06-04, 580 on 2026-06-16). 100% of the 3,960
--     parked messages qualified via the inbox_triaged arm; not one qualified
--     via todos_done or thread_replied. 3,649 of them (92.1%) have no
--     processing_log decision AT ALL (an Apr–May 2026 capture that predates the
--     move queue), so LCC never routed them into "Intake Staged, Not Completed"
--     and they cannot be there. The mirror was publishing the entire historical
--     flagged-email inbox as moves against a folder those messages never
--     entered.
--
-- (2) "not_found" WAS TREATED AS A RETRYABLE FAILURE — but the mover reporting
--     "the message is not in the source folder" means **the desired end state is
--     already true**. It got 5 retries + a park + an error alert instead of one
--     terminal ack. Even the legitimate slice fails this way: all 323
--     processing_log outcome='staged' rows are still move_status='pending'
--     (nothing has ever drained that queue), so the staging folder is not being
--     populated; and the flagged-intake flow moves the message to Processed on
--     its own success (docs/architecture/flows/lcc-flagged-email-intake.md §5) —
--     the double-mover race, which accounts for the 7 outcome='filed' rows.
--
-- OWNERSHIP RULE (one owner per folder transition):
--   intake flow / processing_log  → owns Inbox → Processed/* and Inbox → staging.
--   mailbox mirror                → owns staging → Processed ONLY, and only for
--                                   messages LCC itself routed to staging
--                                   (processing_log.outcome='staged').
--   A message the mirror does not find in staging is DONE, not broken.
--
-- Discipline: additive columns · fill-blanks (no ack history rewritten) ·
-- terminal classification is a narrow allowlist that still retries genuine
-- transients and a bad DESTINATION folder · reversible (runbook below) ·
-- idempotent · dry-run-default sweep · honest counts.
--
-- REVERSAL RUNBOOK
--   -- 1. auto-retired alerts (this migration's sweep only; Cowork's
--   --    'cowork-mirror-backlog-retire-20260820' backlog is never touched)
--   UPDATE public.lcc_health_alerts SET resolved_at=NULL, resolved_note=NULL
--    WHERE resolved_note LIKE 'p119-mirror-auto-retire:%';
--   -- 2. ledger rows normalised to the terminal already_out state
--   UPDATE public.lcc_mailbox_reconcile_ledger
--      SET moved=false, parked=true, attempts=5, action='move',
--          last_error=terminal_note, outcome='failed', terminal_note=NULL
--    WHERE outcome='already_out';
--   -- 3. drop the additions / restore the prior bodies
--   ALTER TABLE public.lcc_mailbox_reconcile_ledger
--     DROP COLUMN IF EXISTS outcome, DROP COLUMN IF EXISTS terminal_note;
--   DROP FUNCTION IF EXISTS public.lcc_mailbox_mirror_retire_cleared_parks(boolean);
--   DROP FUNCTION IF EXISTS public.lcc_mailbox_mirror_error_is_terminal(text);
--   SELECT cron.unschedule('lcc-mailbox-mirror-retire');
--   -- then re-apply 20260824120000_lcc_w7_6_mailbox_mirror.sql for the view+RPC.
--
-- APPLIED LIVE 2026-08-20 to LCC Opps (xengecqvemvfknjvbvrq) as migration
-- `lcc_p119_mailbox_mirror_not_found_terminal`. The applied payload is this file
-- with the header comment block trimmed; every DDL statement below is byte-equal
-- in intent and verified live (view carries the staged gate, ack RPC calls the
-- classifier, ledger has outcome+terminal_note, cron `lcc-mailbox-mirror-retire`
-- @ '25 6 * * *').
-- ============================================================================

-- ── 1. Ledger: additive honesty columns ─────────────────────────────────────
-- `moved` keeps its worklist-exclusion meaning ("at the desired end state — out
-- of the Not-Complete folder"); `outcome` says whether WE moved it or merely
-- found it already gone. Never conflate the two in a report.
ALTER TABLE public.lcc_mailbox_reconcile_ledger
  ADD COLUMN IF NOT EXISTS outcome       text,
  ADD COLUMN IF NOT EXISTS terminal_note text;

UPDATE public.lcc_mailbox_reconcile_ledger
   SET outcome = CASE WHEN COALESCE(moved,false) THEN 'moved' ELSE 'failed' END
 WHERE outcome IS NULL;

DO $$ BEGIN
  ALTER TABLE public.lcc_mailbox_reconcile_ledger
    ADD CONSTRAINT chk_mailbox_reconcile_ledger_outcome
    CHECK (outcome IS NULL OR outcome IN ('moved','already_out','failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.lcc_mailbox_reconcile_ledger.moved IS
  'Desired end state reached: the message is OUT of the Not-Complete folder, so it is excluded '
  'from the worklist. TRUE covers both "we moved it" and "it was already gone" — read `outcome` '
  'for which. Never quote `moved` as a count of moves performed.';
COMMENT ON COLUMN public.lcc_mailbox_reconcile_ledger.outcome IS
  'P119 honest disposition: moved = the mover performed the Graph move; already_out = the mover '
  'reported the message is not in the source folder (terminal SUCCESS — the end state was already '
  'true, never a retry/park); failed = a genuine retryable failure.';
COMMENT ON COLUMN public.lcc_mailbox_reconcile_ledger.terminal_note IS
  'P119: the raw mover signal that was classified terminal (e.g. not_found_or_not_in_source_folder). '
  'Kept for audit; `last_error` is cleared because a terminal disposition is not an error.';

-- ── 2. The single terminal-vs-retryable classifier ──────────────────────────
-- Narrow ALLOWLIST. "the MESSAGE is not there" is terminal success; a missing
-- DESTINATION folder (a real config break — e.g. a stale processedFolderId
-- binding, the class that just bit the flagged-intake trigger) must still
-- retry, park and alert. Every other error (throttling, 5xx, timeout, auth)
-- falls through to the existing retry path unchanged.
CREATE OR REPLACE FUNCTION public.lcc_mailbox_mirror_error_is_terminal(p_error text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_error IS NOT NULL
     AND lower(btrim(p_error)) ~ ('(^|[^a-z])not_?[ ]?found([^a-z]|$)'
                                  '|not[_ ]?in[_ ]?source[_ ]?folder'
                                  '|erroritemnotfound|itemnotfound'
                                  '|resourcenotfound|objectnotfound'
                                  '|message[_ ]?not[_ ]?found')
     -- ...but NOT when the thing not found is the DESTINATION folder.
     AND lower(btrim(p_error)) !~ ('destination'
                                   '|errorfoldernotfound'
                                   '|folder[_ ]?not[_ ]?found'
                                   '|mailfolder');
$function$;

COMMENT ON FUNCTION public.lcc_mailbox_mirror_error_is_terminal(text) IS
  'P119. TRUE when a mover ack means "the message is already out of the source folder" — a '
  'terminal SUCCESS, not a retryable failure. Deliberately excludes destination/folder-not-found, '
  'which IS a real break (stale processedFolderId) and must still retry + park + alert.';

-- ── 3. Ack RPC — terminal disposition short-circuits retry/park/alert ───────
CREATE OR REPLACE FUNCTION public.lcc_mailbox_reconcile_ack(
  p_internet_message_id text,
  p_moved               boolean,
  p_reason              text DEFAULT NULL,
  p_error               text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_retry_cap  int := 5;
  v_backoff    interval := interval '1 hour';
  v_terminal   boolean;
  v_row        public.lcc_mailbox_reconcile_ledger%rowtype;
BEGIN
  IF p_internet_message_id IS NULL OR btrim(p_internet_message_id) = '' THEN
    RAISE EXCEPTION 'internet_message_id is required';
  END IF;

  -- P119: a failed ack whose error means "already out of the source folder" is
  -- the desired end state, not a failure. Classify BEFORE the retry ladder.
  v_terminal := (NOT COALESCE(p_moved,false))
                AND public.lcc_mailbox_mirror_error_is_terminal(p_error);

  IF p_moved OR v_terminal THEN
    INSERT INTO public.lcc_mailbox_reconcile_ledger
      (internet_message_id, action, reason, moved, attempts, last_error,
       next_retry_at, parked, outcome, terminal_note, acked_at)
    VALUES (p_internet_message_id,
            CASE WHEN v_terminal THEN 'noop' ELSE 'move' END,
            p_reason, true, 0, NULL, NULL, false,
            CASE WHEN v_terminal THEN 'already_out' ELSE 'moved' END,
            CASE WHEN v_terminal THEN LEFT(p_error, 500) ELSE NULL END,
            now())
    ON CONFLICT (internet_message_id) DO UPDATE SET
      action        = EXCLUDED.action,
      moved         = true,
      attempts      = 0,
      last_error    = NULL,
      next_retry_at = NULL,
      parked        = false,
      outcome       = EXCLUDED.outcome,
      terminal_note = EXCLUDED.terminal_note,
      reason        = COALESCE(EXCLUDED.reason, public.lcc_mailbox_reconcile_ledger.reason),
      acked_at      = now()
    RETURNING * INTO v_row;

    -- Premise cleared right now: close any open park alert for this message.
    -- (Only ever touches resolved_at IS NULL, so an already-retired backlog row
    -- — e.g. the cowork-mirror-backlog-retire-20260820 batch — is never rewritten.)
    UPDATE public.lcc_health_alerts
       SET resolved_at   = now(),
           resolved_note = 'p119-mirror-auto-retire: premise cleared on ack ('
                           || COALESCE(v_row.outcome,'moved') || ').'
     WHERE alert_kind = 'mailbox_mirror_parked'
       AND source     = 'imid:' || p_internet_message_id
       AND resolved_at IS NULL;

  ELSE
    -- Genuine retryable failure: unchanged ladder (backoff → park → alert).
    INSERT INTO public.lcc_mailbox_reconcile_ledger
      (internet_message_id, action, reason, moved, attempts, last_error,
       next_retry_at, parked, outcome, acked_at)
    VALUES (p_internet_message_id, 'move', p_reason, false, 1, p_error,
            now() + v_backoff, false, 'failed', now())
    ON CONFLICT (internet_message_id) DO UPDATE SET
      action='move', moved=false, last_error=p_error, outcome='failed',
      attempts = public.lcc_mailbox_reconcile_ledger.attempts + 1,
      reason=COALESCE(EXCLUDED.reason, public.lcc_mailbox_reconcile_ledger.reason),
      parked        = (public.lcc_mailbox_reconcile_ledger.attempts + 1) >= v_retry_cap,
      next_retry_at = CASE WHEN (public.lcc_mailbox_reconcile_ledger.attempts + 1) >= v_retry_cap
                           THEN NULL ELSE now() + v_backoff END,
      acked_at=now()
    RETURNING * INTO v_row;

    IF v_row.parked THEN
      INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
      SELECT 'mailbox_mirror_parked', 'imid:'||p_internet_message_id, 'error',
             'Mailbox-mirror move failed '||v_retry_cap||'x and was parked: '||p_internet_message_id,
             jsonb_build_object('internet_message_id', p_internet_message_id,
                                'last_error', LEFT(COALESCE(p_error,''), 500),
                                'attempts', v_row.attempts)
      WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
        WHERE a.alert_kind='mailbox_mirror_parked'
          AND a.source='imid:'||p_internet_message_id
          AND a.resolved_at IS NULL);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'internet_message_id', v_row.internet_message_id,
    'moved', v_row.moved,
    'outcome', v_row.outcome,
    'terminal', COALESCE(v_terminal,false),
    'attempts', v_row.attempts,
    'parked', v_row.parked,
    'next_retry_at', v_row.next_retry_at
  );
END $function$;

COMMENT ON FUNCTION public.lcc_mailbox_reconcile_ack(text,boolean,text,text) IS
  'W7.6 mailbox-mirror ack (P119). Idempotent ledger upsert. moved:true → outcome=moved. '
  'moved:false with a not-in-source-folder error → TERMINAL SUCCESS (outcome=already_out, '
  'action=noop, no retry, no park, no alert, and any open park alert for the message is resolved). '
  'Any other failure keeps the 1h-backoff → park-at-5 → lcc_health_alerts ladder.';

-- ── 4. Worklist view — source-folder-membership gate ────────────────────────
-- Column list, order and types are UNCHANGED (CREATE OR REPLACE VIEW is
-- append-only for columns); the change is a join + WHERE predicate.
-- The mirror now only publishes messages LCC ITSELF routed into the staging
-- folder (processing_log.outcome='staged' → target_folder STAGING_FOLDER, see
-- api/_shared/processing-complete.js). filed / duplicate / needs_review belong
-- to the intake flow's own move, and a message with no decision at all was
-- never staged by LCC — neither is the mirror's business.
CREATE OR REPLACE VIEW public.v_lcc_mailbox_reconcile_worklist AS
WITH m AS (
  SELECT i.id            AS inbox_item_id,
         i.workspace_id,
         i.external_id    AS internet_message_id,
         i.status::text   AS inbox_status,
         i.entity_id      AS inbox_entity_id,
         i.title,
         i.triaged_at,
         i.updated_at
  FROM public.inbox_items i
  WHERE i.source_type = 'flagged_email'
    AND i.external_id IS NOT NULL
    -- P119 source-folder gate: LCC must have routed this message to the
    -- "Intake Staged, Not Completed" folder. Without this the view published
    -- the entire historical flagged-email inbox (4,051 rows, 3,944 bulk-
    -- archived) as moves against a folder those messages never entered.
    AND EXISTS (
          SELECT 1 FROM public.processing_log pl
          WHERE pl.internet_message_id = i.external_id
            AND pl.outcome = 'staged')
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
  CASE WHEN j.todos_done     THEN 'todos_done'
       WHEN j.thread_replied THEN 'thread_replied'
       WHEN j.inbox_triaged  THEN 'inbox_triaged'
  END AS reason,
  CASE
    WHEN j.todos_done THEN (SELECT max(COALESCE(ai.completed_at, ai.updated_at))
                              FROM public.action_items ai WHERE ai.inbox_item_id = j.inbox_item_id)
    WHEN j.thread_replied THEN (SELECT min(a2.occurred_at)
                              FROM public.activity_events a2
                              WHERE a2.source_type IN ('outlook_sent','outlook_tagged')
                                AND a2.metadata->>'conversation_id' = j.conversation_id
                                AND a2.occurred_at > j.inbound_at)
    ELSE COALESCE(j.triaged_at, j.updated_at)
  END AS closed_at,
  COALESCE(led.attempts, 0) AS attempts
FROM j
LEFT JOIN public.lcc_mailbox_reconcile_ledger led
       ON led.internet_message_id = j.internet_message_id
WHERE (j.todos_done OR j.thread_replied OR j.inbox_triaged)
  AND NOT EXISTS (
        SELECT 1 FROM public.action_items o
        WHERE o.entity_id = j.deal_entity_id
          AND o.action_type = 'offer_review'
          AND o.status IN ('open','in_progress'))
  AND (led.internet_message_id IS NULL
       OR (COALESCE(led.moved,false) = false
           AND led.parked = false
           AND (led.next_retry_at IS NULL OR led.next_retry_at <= now())));

COMMENT ON VIEW public.v_lcc_mailbox_reconcile_worklist IS
  'W7.6 deterministic (NO-LLM) mailbox-mirror worklist, P119-gated. Flagged-email inbox_items that '
  'LCC ITSELF routed to the "Intake Staged, Not Completed" folder (processing_log.outcome=staged) '
  'AND whose loop is closed (all generated to-dos terminal, OR a later in-thread outbound reply, OR '
  'the inbox_item triaged dismissed/archived), withheld while the deal has an open offer_review, '
  'excluding ledger already-out/moved/parked/backoff messages. Without the staged gate this view '
  'published the whole historical flagged inbox and every ack failed not-in-source-folder (P119).';

-- ── 5. Auto-retire sweep (Consumption-Layer arm) ────────────────────────────
-- The producer now emits far less, and not_found no longer parks — but a park
-- whose premise LATER clears must still self-heal instead of accreting.
CREATE OR REPLACE FUNCTION public.lcc_mailbox_mirror_retire_cleared_parks(
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scanned   int := 0;
  v_retire    int := 0;
  v_normalise int := 0;
  v_left      int := 0;
BEGIN
  DROP TABLE IF EXISTS _p119_cleared;
  CREATE TEMP TABLE _p119_cleared ON COMMIT DROP AS
  SELECT a.alert_id,
         led.internet_message_id AS imid,
         CASE
           WHEN led.internet_message_id IS NULL                       THEN 'ledger_row_removed'
           WHEN COALESCE(led.moved,false)                             THEN 'already_out_of_source_folder'
           WHEN led.outcome IN ('moved','already_out')                THEN 'already_out_of_source_folder'
           WHEN public.lcc_mailbox_mirror_error_is_terminal(led.last_error)
                                                                      THEN 'terminal_not_in_source_folder'
         END AS clear_reason
  FROM public.lcc_health_alerts a
  LEFT JOIN public.lcc_mailbox_reconcile_ledger led
         ON 'imid:' || led.internet_message_id = a.source
  WHERE a.alert_kind = 'mailbox_mirror_parked'
    AND a.resolved_at IS NULL;   -- idempotent: an already-retired row (incl. the
                                 -- cowork-mirror-backlog-retire-20260820 batch)
                                 -- is never re-touched.

  SELECT count(*) INTO v_scanned FROM _p119_cleared;
  SELECT count(*) INTO v_left    FROM _p119_cleared WHERE clear_reason IS NULL;

  IF p_dry_run THEN
    SELECT count(*) INTO v_retire FROM _p119_cleared WHERE clear_reason IS NOT NULL;
    SELECT count(*) INTO v_normalise
      FROM public.lcc_mailbox_reconcile_ledger led
      JOIN _p119_cleared c ON c.imid = led.internet_message_id
     WHERE c.clear_reason IS NOT NULL AND COALESCE(led.outcome,'') <> 'already_out'
       AND public.lcc_mailbox_mirror_error_is_terminal(led.last_error);
  ELSE
    -- Normalise the ledger FIRST so a re-queue can never re-park the message.
    WITH upd AS (
      UPDATE public.lcc_mailbox_reconcile_ledger led
         SET action='noop', moved=true, attempts=0, parked=false,
             next_retry_at=NULL, outcome='already_out',
             terminal_note=COALESCE(led.terminal_note, LEFT(led.last_error,500)),
             last_error=NULL, acked_at=now()
        FROM _p119_cleared c
       WHERE c.imid = led.internet_message_id
         AND c.clear_reason IS NOT NULL
         AND public.lcc_mailbox_mirror_error_is_terminal(led.last_error)
      RETURNING 1)
    SELECT count(*) INTO v_normalise FROM upd;

    WITH res AS (
      UPDATE public.lcc_health_alerts a
         SET resolved_at   = now(),
             resolved_note = 'p119-mirror-auto-retire: premise cleared ('
                             || c.clear_reason || ') — the message is out of the '
                             || '"Intake Staged, Not Completed" folder, which is the desired end '
                             || 'state. Reversible by this tag.'
        FROM _p119_cleared c
       WHERE a.alert_id = c.alert_id
         AND c.clear_reason IS NOT NULL
         AND a.resolved_at IS NULL
      RETURNING 1)
    SELECT count(*) INTO v_retire FROM res;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'alerts_scanned', v_scanned,
    'alerts_retired', v_retire,
    'ledger_normalised', v_normalise,
    'alerts_left_open', v_left,   -- genuine stuck moves: an operator must see these
    'tag', 'p119-mirror-auto-retire'
  );
END $function$;

COMMENT ON FUNCTION public.lcc_mailbox_mirror_retire_cleared_parks(boolean) IS
  'P119 Consumption-Layer auto-retire. Resolves OPEN mailbox_mirror_parked alerts whose premise has '
  'cleared (ledger row gone / moved / already_out / a terminal not-in-source-folder last_error) and '
  'normalises those ledger rows to the terminal already_out state. Dry-run default, idempotent '
  '(touches resolved_at IS NULL only), reversible by resolved_note LIKE ''p119-mirror-auto-retire:%''. '
  'alerts_left_open is the honest count of genuinely stuck moves an operator must still work.';

-- ── 6. Cron — daily self-heal.
SELECT cron.unschedule('lcc-mailbox-mirror-retire')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='lcc-mailbox-mirror-retire');
SELECT cron.schedule('lcc-mailbox-mirror-retire', '25 6 * * *',
  $cron$SELECT public.lcc_mailbox_mirror_retire_cleared_parks(false)$cron$);

-- ── 7. Grants + flag-registry note (no NEW flag; MAILBOX_MIRROR still gates).
GRANT EXECUTE ON FUNCTION public.lcc_mailbox_mirror_error_is_terminal(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_mailbox_mirror_retire_cleared_parks(boolean) TO service_role;

UPDATE public.feature_flags_registry
   SET notes = notes || ' P119 (2026-08-20): worklist gated to processing_log.outcome=''staged'' '
               || '(LCC-staged messages only — one owner per folder transition); a mover ack of '
               || '"not in the source folder" is TERMINAL SUCCESS (outcome=already_out), never a '
               || 'retry/park/alert; auto-retire sweep lcc_mailbox_mirror_retire_cleared_parks + '
               || 'cron lcc-mailbox-mirror-retire (06:25 UTC).'
 WHERE flag = 'MAILBOX_MIRROR'
   AND notes NOT LIKE '%P119 (2026-08-20)%';
