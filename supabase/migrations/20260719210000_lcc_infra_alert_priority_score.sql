-- ============================================================================
-- Infra-alert priority scoring — inbox_items.priority_score column
-- ----------------------------------------------------------------------------
-- The outlook-message intake handler (api/intake.js) now classifies flagged
-- Vercel/GitHub CI-CD failure emails as domain='infra' and priority-scores them
-- against the open queue (via the shared scoreItem() engine) so their To Do
-- task carries a scannable [HIGH]/[MED]/[LOW] tier. The numeric score is stored
-- on inbox_items.priority_score.
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS). Reversible:
--   ALTER TABLE public.inbox_items DROP COLUMN priority_score;
-- No CHECK/constraint change; existing rows keep NULL (only infra alerts set it).
-- LCC-Opps only; auth schema untouched.
-- ============================================================================

ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS priority_score integer;

COMMENT ON COLUMN public.inbox_items.priority_score IS
  'Cross-domain priority score (shared scoreItem() scale). Set by the intake '
  'infra-alert path for Vercel/GitHub CI-CD alerts; NULL otherwise. '
  'Higher = more urgent. Drives the [HIGH]/[MED]/[LOW] To Do tier '
  '(see docs/INFRA_ALERT_CLASSIFICATION.md).';
