-- ============================================================================
-- W7.6 — Mailbox Mirror: Outlook folders reflect open LCC work
-- ----------------------------------------------------------------------------
-- Flagged emails land in an Outlook folder ("Intake Staged, Not Complete") and
-- create LCC to-dos / an inbox_item. When the loop closes — the follow-up is
-- SENT, or a task that closes the to-do is COMPLETED, or the inbox_item is
-- triaged away — the email should move to a Processed folder so the Not-Complete
-- folder shows ONLY open work and mirrors the LCC exactly.
--
-- PULL model — LCC never touches the mailbox. LCC publishes a deterministic
-- worklist (this view); a Power Automate "mover" flow executes the Outlook move
-- (+ unflag + mark read) via Graph and acks back (the ack RPC). MOVE ONLY —
-- never delete. Reversible ledger, idempotent, flag-gated.
--
-- Discipline: DETERMINISTIC gate (no LLM anywhere); move-only (the hazard class);
-- reversible + ledgered + idempotent (unique on internet_message_id; re-acks are
-- no-ops); flag-gated + the flag registered HERE (feature_flags_registry); own
-- seam (a new ledger table — no other producer's tables written); loud failure
-- (retry cap → alert row in lcc_health_alerts, never a silent drop).
--
-- Reversal runbook (fully reversible — nothing destructive lands in the mailbox
-- from LCC; the mover only MOVES messages, never deletes):
--   DROP VIEW IF EXISTS public.v_lcc_mailbox_reconcile_worklist;
--   DROP FUNCTION IF EXISTS public.lcc_mailbox_reconcile_ack(text,boolean,text,text);
--   DROP TABLE IF EXISTS public.lcc_mailbox_reconcile_ledger;
--   DELETE FROM public.feature_flags_registry WHERE flag='MAILBOX_MIRROR';
-- (Any messages already moved by the mover flow stay in the Processed folder —
-- move them back in Outlook if desired; LCC did not delete anything.)
-- ============================================================================

-- ── 1. Ledger — the OWN seam. One row per internet_message_id the mover acted on.
CREATE TABLE IF NOT EXISTS public.lcc_mailbox_reconcile_ledger (
  id                  bigserial PRIMARY KEY,
  internet_message_id text        NOT NULL,
  action              text,                 -- 'move' | 'noop'
  reason              text,                 -- close reason echoed from the worklist
  moved               boolean,              -- last ack outcome (true = in Processed)
  attempts            int         NOT NULL DEFAULT 0,   -- consecutive move FAILURES
  last_error          text,
  next_retry_at       timestamptz,          -- a failed move may re-queue at/after this
  parked              boolean     NOT NULL DEFAULT false, -- retry cap hit → stop retrying
  acked_at            timestamptz DEFAULT now(),
  created_at          timestamptz DEFAULT now()
);
-- Idempotency anchor: one ledger row per message; re-acks UPDATE in place.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_reconcile_ledger_imid
  ON public.lcc_mailbox_reconcile_ledger (internet_message_id);

COMMENT ON TABLE public.lcc_mailbox_reconcile_ledger IS
  'W7.6 Mailbox Mirror ledger. One row per internet_message_id the PA mover acted on. '
  'moved=true → in the Processed folder (excluded from the worklist). '
  'moved=false → failed; re-queues after next_retry_at until attempts hits the cap (5), '
  'then parked=true + an lcc_health_alerts row (mailbox_mirror_parked). Reversible: delete a '
  'row to re-queue a message. LCC only MOVES messages via the mover — never deletes.';

-- ── 2. Deterministic worklist view — NO LLM. Pure SQL over the spine + inbox.
-- Anchor = flagged-email inbox_items (what physically sits in the Not-Complete
-- folder); each carries the internet_message_id (external_id) the mover needs.
-- A message QUALIFIES (loop closed) when ANY of:
--   (a) todos_done    — every to-do generated from it (action_items.inbox_item_id
--                       lineage) is terminal (completed/cancelled), and at least
--                       one such to-do existed.
--   (b) thread_replied— a LATER outbound comm exists in the same conversation_id
--                       (outlook_sent / outlook_tagged, occurred_at > the inbound).
--   (c) inbox_triaged — the inbox_item was triaged to a terminal status
--                       (dismissed / archived).
-- Inverse guard: a message is WITHHELD while its deal has an OPEN offer_review —
-- an offer thread stays visible until the offer resolves (simple + tunable:
-- widen/narrow the offer_review predicate below).
-- Excludes messages already moved / parked / in retry-backoff (ledger join).
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
),
ae AS (  -- the deal-stamped inbound spine row for the message (conversation + deal)
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
    -- (a) every generated to-do terminal (and ≥1 existed)
    ( EXISTS (SELECT 1 FROM public.action_items ai WHERE ai.inbox_item_id = m.inbox_item_id)
      AND NOT EXISTS (SELECT 1 FROM public.action_items ai
                      WHERE ai.inbox_item_id = m.inbox_item_id
                        AND ai.status IN ('open','in_progress','waiting')) ) AS todos_done,
    -- (b) a later outbound comm in the same thread
    ( ae.conversation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.activity_events a2
        WHERE a2.source_type IN ('outlook_sent','outlook_tagged')
          AND a2.metadata->>'conversation_id' = ae.conversation_id
          AND a2.occurred_at > ae.occurred_at) ) AS thread_replied,
    -- (c) inbox_item triaged to a terminal status
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
  -- reason (priority order todos_done → thread_replied → inbox_triaged)
  CASE WHEN j.todos_done     THEN 'todos_done'
       WHEN j.thread_replied THEN 'thread_replied'
       WHEN j.inbox_triaged  THEN 'inbox_triaged'
  END AS reason,
  -- best-effort close timestamp for FIFO ordering / audit
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
  -- inverse guard: an open offer_review keeps the thread visible
  AND NOT EXISTS (
        SELECT 1 FROM public.action_items o
        WHERE o.entity_id = j.deal_entity_id
          AND o.action_type = 'offer_review'
          AND o.status IN ('open','in_progress'))
  -- ledger exclusions: already moved, parked, or waiting out a retry-backoff
  AND (led.internet_message_id IS NULL
       OR (COALESCE(led.moved,false) = false
           AND led.parked = false
           AND (led.next_retry_at IS NULL OR led.next_retry_at <= now())));

COMMENT ON VIEW public.v_lcc_mailbox_reconcile_worklist IS
  'W7.6 deterministic (NO-LLM) mailbox-mirror worklist. Flagged-email inbox_items whose loop is '
  'closed (all generated to-dos terminal, OR a later outbound reply in-thread, OR the inbox_item '
  'triaged dismissed/archived), withheld while the deal has an open offer_review, excluding '
  'ledger-moved/parked/backoff messages. The PA mover reads this and moves each message to the '
  'Processed folder.';

-- ── 3. Ack RPC — idempotent ledger upsert + retry/backoff/park + loud alert.
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
  v_row        public.lcc_mailbox_reconcile_ledger%rowtype;
BEGIN
  IF p_internet_message_id IS NULL OR btrim(p_internet_message_id) = '' THEN
    RAISE EXCEPTION 'internet_message_id is required';
  END IF;

  IF p_moved THEN
    -- Success: mark moved, clear retry/park state. Re-acks are idempotent no-ops.
    INSERT INTO public.lcc_mailbox_reconcile_ledger
      (internet_message_id, action, reason, moved, attempts, last_error, next_retry_at, parked, acked_at)
    VALUES (p_internet_message_id, 'move', p_reason, true, 0, NULL, NULL, false, now())
    ON CONFLICT (internet_message_id) DO UPDATE SET
      action='move', moved=true, last_error=NULL, next_retry_at=NULL, parked=false,
      reason=COALESCE(EXCLUDED.reason, public.lcc_mailbox_reconcile_ledger.reason),
      acked_at=now()
    RETURNING * INTO v_row;
  ELSE
    -- Failure: increment attempts; back off, or park at the cap.
    INSERT INTO public.lcc_mailbox_reconcile_ledger
      (internet_message_id, action, reason, moved, attempts, last_error, next_retry_at, parked, acked_at)
    VALUES (p_internet_message_id, 'move', p_reason, false, 1, p_error, now() + v_backoff, false, now())
    ON CONFLICT (internet_message_id) DO UPDATE SET
      action='move', moved=false, last_error=p_error,
      attempts = public.lcc_mailbox_reconcile_ledger.attempts + 1,
      reason=COALESCE(EXCLUDED.reason, public.lcc_mailbox_reconcile_ledger.reason),
      parked        = (public.lcc_mailbox_reconcile_ledger.attempts + 1) >= v_retry_cap,
      next_retry_at = CASE WHEN (public.lcc_mailbox_reconcile_ledger.attempts + 1) >= v_retry_cap
                           THEN NULL ELSE now() + v_backoff END,
      acked_at=now()
    RETURNING * INTO v_row;

    -- Loud failure at the cap: a deduped alert row (never a silent drop).
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
    'attempts', v_row.attempts,
    'parked', v_row.parked,
    'next_retry_at', v_row.next_retry_at
  );
END $function$;

-- ── 4. Register the feature flag (make "off" visible in the daily briefing).
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'MAILBOX_MIRROR',
  'Mailbox Mirror: publish a deterministic worklist of intake-captured flagged emails whose LCC loop '
  'has closed (all to-dos terminal, OR a later in-thread reply sent, OR the inbox_item triaged away) so '
  'a Power Automate mover flow moves each message from the "Intake Staged, Not Complete" Outlook folder '
  'to a Processed folder — the folder then mirrors open LCC work exactly. Move-only, never delete.',
  'api/_handlers/mailbox-reconcile.js (GET /api/mailbox-reconcile-worklist, POST /api/mailbox-reconcile-ack)',
  'MAILBOX_MIRROR',
  'off', now(), 'scott',
  'W7.6. Deterministic gate (NO LLM). Worklist view v_lcc_mailbox_reconcile_worklist + ack RPC '
  'lcc_mailbox_reconcile_ack + own ledger lcc_mailbox_reconcile_ledger (unique on internet_message_id). '
  'Reversible/idempotent; failed moves back off 1h and park after 5 tries with an lcc_health_alerts '
  '(mailbox_mirror_parked) row. No-ops until MAILBOX_MIRROR=true in Railway. PA spec: '
  'docs/setup/OUTLOOK_MAILBOX_MIRROR_FLOW.md.'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var, notes = EXCLUDED.notes;

-- ── 5. Grants — service_role drives both endpoints via opsQuery.
GRANT SELECT ON public.v_lcc_mailbox_reconcile_worklist TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.lcc_mailbox_reconcile_ledger TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.lcc_mailbox_reconcile_ledger_id_seq TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_mailbox_reconcile_ack(text,boolean,text,text) TO service_role;
