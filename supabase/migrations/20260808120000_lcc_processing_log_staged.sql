-- ============================================================================
-- Defer auto-filing until To Do completion — processing_log `staged` outcome
-- ----------------------------------------------------------------------------
-- Adds a THIRD terminal-of-intake state between `filed` and `needs_review`:
-- `staged`. When intake FINISHES for a NON-terminal category (deals / leads /
-- general / infra — anything NOT in AUTO_COMPLETE_CATEGORIES) the email is
-- moved to a single "Intake Staged, Not Completed" folder and KEPT FLAGGED — it
-- is outstanding work, not filed. The flag clears + the email reaches
-- Processed/{category} only once the linked Microsoft To Do task is completed
-- (by Scott, or the terminal-category auto-complete gate). `needs_review` stays
-- reserved for genuinely ambiguous / failed items (left in the Inbox).
--
-- Two additive changes to public.processing_log:
--   1. Widen the outcome CHECK to accept 'staged'.
--   2. ADD COLUMN final_target_folder — the real Processed/{category}
--      destination, RESOLVED + STORED AT STAGING TIME (never re-derived later,
--      so a channel/domain-mapping change can't retroactively re-route a
--      already-staged email). The todo-completion poll reads this to build the
--      eventual staging → Processed/{category} move.
--
-- Additive + idempotent. Reversible (restore the 3-value CHECK from
-- 20260804120000 + drop the column + re-create the prior view body):
--   ALTER TABLE public.processing_log DROP CONSTRAINT IF EXISTS processing_log_outcome_check;
--   ALTER TABLE public.processing_log ADD CONSTRAINT processing_log_outcome_check
--     CHECK (outcome IN ('filed', 'needs_review', 'duplicate'));
--   ALTER TABLE public.processing_log DROP COLUMN IF EXISTS final_target_folder;
-- LCC-Opps only; no existing row rewritten; auth schema untouched.
-- ============================================================================

-- 1. Widen the outcome CHECK (the inline CHECK from 20260804120000 is named
--    processing_log_outcome_check — Postgres's <table>_<column>_check default).
ALTER TABLE public.processing_log
  DROP CONSTRAINT IF EXISTS processing_log_outcome_check;

ALTER TABLE public.processing_log
  ADD CONSTRAINT processing_log_outcome_check
  CHECK (outcome IN ('filed', 'needs_review', 'duplicate', 'staged'));

-- 2. The eventual Processed/{category} destination for a staged email, resolved
--    at staging time.
ALTER TABLE public.processing_log
  ADD COLUMN IF NOT EXISTS final_target_folder text;

COMMENT ON COLUMN public.processing_log.final_target_folder IS
  'For a `staged` row: the real Processed/{category} destination the email '
  'moves to once its Microsoft To Do task completes. Resolved + stored AT '
  'STAGING TIME (targetFolderFor(''filed'', {channel, domain})) so it is never '
  're-derived later. NULL for filed / needs_review / duplicate.';

-- Refresh the table comment to describe the four-state model.
COMMENT ON TABLE public.processing_log IS
  'Auto-archive/cleanup decisions from the intake pipeline. One row per email '
  'whose intake job is done: outcome (filed / needs_review / duplicate / '
  'staged) + the Outlook target_folder. `staged` = finished intake for a '
  'non-terminal category → moved to "Intake Staged, Not Completed" and KEPT '
  'flagged until its To Do task completes (final_target_folder is the eventual '
  'Processed/{category}). Power Automate consumes pending moves via '
  '/api/webhooks/processing-complete; the todo-completion poll drives the '
  'staged → Processed move on task completion. Never deletes (see the separate '
  'retention sweep). See docs/EMAIL_AUTO_ARCHIVE.md.';

-- One-line daily-briefing feed: append `staged` at the END (CREATE OR REPLACE
-- VIEW is column-append-only — the existing columns keep their positions).
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
  count(*) FILTER (WHERE move_status = 'move_failed')                   AS move_failed,
  count(*) FILTER (WHERE outcome = 'staged')                            AS staged
FROM public.processing_log
GROUP BY workspace_id, (created_at AT TIME ZONE 'UTC')::date;

COMMENT ON VIEW public.v_processing_log_daily IS
  'Per-workspace per-day rollup of processing_log outcomes. Drives the daily '
  'briefing one-liner ("N emails auto-filed, M staged, K flagged for review").';
