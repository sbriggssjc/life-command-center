-- Fix: Decision Center "Intake match disambiguation" lane "Pick this" fails with
-- `pick_write_failed`.
--
-- Root cause: the pick verdict (api/admin.js, match_disambiguation lane) writes a
-- confirmed match into staged_intake_matches with decision='manual_match'. That
-- value is the intended tag for a human/decision-center pick (confidence 1.0) and
-- is relied upon by the intake-feedback accuracy snapshot, which EXCLUDES these
-- rows via `decision=neq.manual_match` (api/_handlers/intake-feedback.js,
-- api/intake.js, api/admin.js). But the table's CHECK constraint only ever allowed
-- ('auto_matched','needs_review'), so every disambiguation pick violated the
-- constraint (SQLSTATE 23514) and the handler returned 502 pick_write_failed.
--
-- Additive, reversible: extend the allowlist to include 'manual_match'. The two
-- existing matcher values are unchanged.

ALTER TABLE public.staged_intake_matches
  DROP CONSTRAINT IF EXISTS staged_intake_matches_decision_check;

ALTER TABLE public.staged_intake_matches
  ADD CONSTRAINT staged_intake_matches_decision_check
  CHECK (decision = ANY (ARRAY['auto_matched'::text, 'needs_review'::text, 'manual_match'::text]));

-- Reversal:
--   ALTER TABLE public.staged_intake_matches DROP CONSTRAINT staged_intake_matches_decision_check;
--   ALTER TABLE public.staged_intake_matches ADD CONSTRAINT staged_intake_matches_decision_check
--     CHECK (decision = ANY (ARRAY['auto_matched'::text, 'needs_review'::text]));
