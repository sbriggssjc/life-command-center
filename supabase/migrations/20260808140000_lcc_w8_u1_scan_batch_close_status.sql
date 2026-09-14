-- W8 U1 (Prompt 84) — windowed-scan fix: give the scan-batch ledger a terminal
-- 'closed' status so a scan row never lingers 'open' forever.
--
-- Root cause (2026-08-08 night run): U1's per-invocation scan FULL-scanned all
-- ~128k rows across 7 targets every run (no keyset cursor — U5 got one in Prompt
-- 83, U2 in 68), so the scan ate the invocation budget and the scoring stage got
-- nothing (a nightly `scan` batch, status 'open', 0 scored). The JS fix ports the
-- 83 pattern back to U1 (windowed resumable scan + a budget split that guarantees
-- scoring its slice) and CLOSES the scan batch after scoring. The batch's
-- status CHECK only allowed ('open','applied','conflict','reversed','dismissed'),
-- with no terminal value meaning "scan complete" — so this migration widens it to
-- add 'closed'.
--
-- ADDITIVE / LOOSENING only: it widens an allowed set, so every value the pre-84
-- writer emitted ('open','applied',…) stays valid. Per the deploy-ordering rule,
-- a constraint-LOOSENING change applies BEFORE the writer deploy (the new writer
-- that emits 'closed' would otherwise be rejected by the old CHECK). Idempotent.
--
-- REVERSAL: closed scan batches carry no destructive payload (the per-verdict
-- apply batches remain the reversible ledger). To revert the constraint, restore
-- the prior CHECK without 'closed' after re-labelling any 'closed' rows.

ALTER TABLE public.junk_review_batch
  DROP CONSTRAINT IF EXISTS junk_review_batch_status_check;

ALTER TABLE public.junk_review_batch
  ADD CONSTRAINT junk_review_batch_status_check
  CHECK (status IN ('open', 'closed', 'applied', 'conflict', 'reversed', 'dismissed'));

COMMENT ON COLUMN public.junk_review_batch.status IS
  'open (scan in flight) | closed (scan tick complete, Prompt 84) | applied/conflict/reversed/dismissed (per-verdict apply rows).';
