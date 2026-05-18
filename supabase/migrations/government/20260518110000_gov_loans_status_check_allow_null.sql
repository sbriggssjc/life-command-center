-- ============================================================================
-- Fresh audit A-4 (gov, 2026-05-18): expand loans_status_check to allow NULL.
--
-- Today's CHECK:
--   CHECK (status = ANY (ARRAY['active','paid_off','matured','defaulted',
--                              'refinanced','assumed']))
-- After Discovery #1 (loans CHECK expansion shipped earlier), this list is
-- correct for known statuses. But writers that lack a parsable status from
-- the source (CoStar's text blob is often unparseable) send NULL → CHECK
-- rejects the whole row. 54 silent 4xx/24h observed in ingest_write_failures.
--
-- Defensive fix: allow NULL. sidebar-pipeline.js gets a mapLoanStatus()
-- normalizer (paired in this patch) so we set the right value when we can.
-- ============================================================================
ALTER TABLE public.loans DROP CONSTRAINT IF EXISTS loans_status_check;

ALTER TABLE public.loans
  ADD CONSTRAINT loans_status_check
  CHECK (status IS NULL OR status = ANY (ARRAY['active','paid_off','matured','defaulted','refinanced','assumed']));

COMMENT ON CONSTRAINT loans_status_check ON public.loans IS
  'Fresh audit A-4 (2026-05-18): allow NULL so unknown-status loans don''t '
  'reject the whole row. sidebar-pipeline.js mapLoanStatus() normalizes when '
  'possible; unrecognized inputs fall through as NULL.';
