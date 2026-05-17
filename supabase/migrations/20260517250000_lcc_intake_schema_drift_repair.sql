-- ============================================================================
-- Bug-fix #2 + #3 (LCC Opps, 2026-05-17): intake pipeline schema drift repair.
--
-- Bug #2 — staged_intake_artifacts.inline_data type drift
--   schema/037_staged_intake_on_lcc_opps.sql:57 declares this column as
--   'text' (base64 payload), but production drifted to 'bytea'. Every
--   inline upload now fails with "invalid input syntax for type bytea".
--
-- Bug #3 — staged_intake_items.status CHECK is missing values the writer
--   needs. api/_handlers/intake-feedback.js PATCHes 'matched', 'no_match',
--   and (until the paired code-fix lands) 'review_needed'. Three of those
--   four are new post-feedback states with no equivalent canonical value;
--   the fourth ('review_needed') is a typo of 'review_required'.
-- ============================================================================

-- ─── Bug #2: restore inline_data to text ────────────────────────────────────
-- Use ALTER COLUMN with an explicit cast. If production rows are actually
-- bytea-typed base64 ASCII (the common case after a sloppy ALTER), the
-- convert_from path returns the original base64 text untouched. If they
-- were genuine binary, encode() base64-stringifies them, matching the
-- shape the extractor + LCC reader code expects.
DO $$
DECLARE
  current_type text;
BEGIN
  SELECT data_type INTO current_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'staged_intake_artifacts'
     AND column_name  = 'inline_data';

  IF current_type IS NULL THEN
    RAISE NOTICE 'inline_data column not found — nothing to repair';
  ELSIF current_type = 'text' THEN
    RAISE NOTICE 'inline_data already text — no migration needed';
  ELSIF current_type = 'bytea' THEN
    -- Preserve data: convert bytea -> base64 text. This matches the
    -- expected shape per schema/037 and the read code in
    -- api/_handlers/intake-extractor.js (which treats it as a base64 string).
    ALTER TABLE public.staged_intake_artifacts
      ALTER COLUMN inline_data TYPE text
      USING encode(inline_data, 'base64');
    RAISE NOTICE 'inline_data converted from bytea to text (base64-encoded existing rows)';
  ELSE
    RAISE EXCEPTION 'inline_data unexpected type: %', current_type;
  END IF;
END $$;

-- ─── Bug #3: expand status CHECK on staged_intake_items ─────────────────────
-- Add 'matched' and 'no_match' as valid post-feedback statuses. Keep all
-- existing values. ('review_needed' is being corrected to 'review_required'
-- in the paired code-fix to intake-feedback.js, so we do NOT add it.)
ALTER TABLE public.staged_intake_items
  DROP CONSTRAINT IF EXISTS staged_intake_items_status_check;

ALTER TABLE public.staged_intake_items
  ADD CONSTRAINT staged_intake_items_status_check
  CHECK (status IN (
    'queued',
    'processing',
    'review_required',
    'failed',
    'finalized',
    'discarded',
    'matched',          -- new: feedback decision = approved|corrected
    'no_match'          -- new: feedback decision = no_match
  ));

COMMENT ON CONSTRAINT staged_intake_items_status_check ON public.staged_intake_items IS
  'Allowed statuses: pre-feedback (queued, processing, review_required, failed) + ' ||
  'finalized (promoted to dia/gov) + discarded (rejected outright) + ' ||
  'matched (feedback approved/corrected) + no_match (feedback no_match).';
