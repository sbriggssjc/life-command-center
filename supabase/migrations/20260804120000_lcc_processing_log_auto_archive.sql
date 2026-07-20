-- ============================================================================
-- Email auto-archive / cleanup layer — public.processing_log (LCC Opps)
-- ----------------------------------------------------------------------------
-- When the intake pipeline (api/intake.js handleOutlookMessage) finishes with a
-- flagged email — OM/lease extraction (staged_intake_items), deal-closing
-- announcement, or infra-alert classification — it emits a "processing_complete"
-- decision here: the stable internet_message_id, the OUTCOME
-- (filed | needs_review | duplicate), and the TARGET_FOLDER the email should be
-- moved to. intake.js has no Graph mailbox-write access, so Power Automate
-- reads the pending decisions (GET /api/webhooks/processing-complete), performs
-- the Outlook move, and reports back (POST) which flips move_status → moved.
--
-- Move policy (never deletes here — deletion is the separate retention sweep):
--   filed        → move to Processed/{domain}  (Processed/Deals, Processed/Infra,
--                  Processed/Leads, Processed/General)     move_status = pending
--   needs_review → leave in place (surfaced via the existing flag/inbox);
--                  target_folder = NULL                    move_status = skipped
--   duplicate    → move to Processed/Duplicates (recoverable 30d, then swept)
--                                                          move_status = pending
--
-- Additive + idempotent (CREATE TABLE/INDEX/VIEW IF NOT EXISTS). Reversible:
--   DROP VIEW IF EXISTS public.v_processing_log_daily;
--   DROP TABLE IF EXISTS public.processing_log;
-- LCC-Opps only; no existing table touched; auth schema untouched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.processing_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid,
  -- Stable dedup + move key. Survives Outlook folder moves (unlike the Graph
  -- REST id). This is what Power Automate filters on to find + move the message.
  internet_message_id text,
  graph_rest_id       text,
  inbox_item_id       uuid,
  source_type         text,                 -- 'flagged_email' etc.
  channel             text,                 -- 'om' | 'deal_closing' | 'infra' | 'lead' | ...
  domain              text,                 -- 'infra' | 'dia' | 'gov' | 'netlease' | 'leads' | null
  subject             text,
  outcome             text NOT NULL
                        CHECK (outcome IN ('filed', 'needs_review', 'duplicate')),
  target_folder       text,                 -- NULL when the email is left in place
  move_status         text NOT NULL DEFAULT 'pending'
                        CHECK (move_status IN ('pending', 'moved', 'move_failed', 'skipped')),
  moved_at            timestamptz,
  move_error          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.processing_log IS
  'Auto-archive/cleanup decisions from the intake pipeline. One row per email '
  'whose intake job is done: outcome (filed/needs_review/duplicate) + the '
  'Outlook target_folder. Power Automate consumes the pending rows via '
  '/api/webhooks/processing-complete and performs the Graph move. Never deletes '
  '(see the separate retention sweep). See docs/EMAIL_AUTO_ARCHIVE.md.';

-- One authoritative decision per email (first emit wins; PA fires the flow 3-6x
-- per flag and replays must not enqueue a second move). emitProcessingComplete
-- checks-then-inserts, and this partial unique index is the DB-side backstop
-- against a concurrent-replay double-insert.
CREATE UNIQUE INDEX IF NOT EXISTS ux_processing_log_ws_msg
  ON public.processing_log (workspace_id, internet_message_id)
  WHERE internet_message_id IS NOT NULL;

-- Power Automate's pull queue: pending moves, oldest first, per workspace.
CREATE INDEX IF NOT EXISTS ix_processing_log_move_queue
  ON public.processing_log (workspace_id, move_status, created_at)
  WHERE move_status = 'pending';

-- Retention sweep + daily-briefing summary scans by recency.
CREATE INDEX IF NOT EXISTS ix_processing_log_created
  ON public.processing_log (created_at);

-- One-line daily-briefing feed: how many auto-filed vs flagged vs deduped, and
-- how many moves are still pending, per workspace per UTC day.
CREATE OR REPLACE VIEW public.v_processing_log_daily AS
SELECT
  workspace_id,
  (created_at AT TIME ZONE 'UTC')::date                                  AS log_date,
  count(*)                                                               AS total,
  count(*) FILTER (WHERE outcome = 'filed')                             AS filed,
  count(*) FILTER (WHERE outcome = 'needs_review')                      AS needs_review,
  count(*) FILTER (WHERE outcome = 'duplicate')                         AS duplicate,
  count(*) FILTER (WHERE move_status = 'pending')                       AS pending_moves,
  count(*) FILTER (WHERE move_status = 'moved')                         AS moved,
  count(*) FILTER (WHERE move_status = 'move_failed')                   AS move_failed
FROM public.processing_log
GROUP BY workspace_id, (created_at AT TIME ZONE 'UTC')::date;

COMMENT ON VIEW public.v_processing_log_daily IS
  'Per-workspace per-day rollup of processing_log outcomes. Drives the daily '
  'briefing one-liner ("N emails auto-filed, M flagged for review").';
