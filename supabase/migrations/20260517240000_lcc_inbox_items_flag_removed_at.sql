-- ============================================================================
-- Bug-fix #1 (LCC Opps, 2026-05-17): add inbox_items.flag_removed_at column.
--
-- Closes the production error surfaced in Postgres logs:
--   ERROR: column inbox_items.flag_removed_at does not exist
--
-- api/sync.js (handleFlaggedEmails + dependents) references this column at
-- lines 358, 406, 459, 545, 600, 601, 659. Reads have a graceful fallback,
-- but every flagged-email request burns one failed round-trip before the
-- fallback fires — directly contributing to slow Home loads. Writes are
-- NOT fallback-protected, so unflagging an email silently drops state.
--
-- The column was supposed to land in schema/028_email_dedup_constraint.sql
-- but never reached this environment.
-- ============================================================================
ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS flag_removed_at TIMESTAMPTZ;

-- Partial index: only-not-removed rows are the hot path.
-- (workspace_id, source_type, status) WHERE flag_removed_at IS NULL is the
-- read shape on every Home + Inbox load.
CREATE INDEX IF NOT EXISTS idx_inbox_items_flag_removed_at_null
  ON public.inbox_items (workspace_id, source_type, status)
  WHERE flag_removed_at IS NULL;

COMMENT ON COLUMN public.inbox_items.flag_removed_at IS
  'Set when a flagged email is unflagged in Outlook. NULL = still flagged. '
  'Used by api/sync.js to filter the Home flagged-email rail and to soft-delete '
  'items archived during sync.';
