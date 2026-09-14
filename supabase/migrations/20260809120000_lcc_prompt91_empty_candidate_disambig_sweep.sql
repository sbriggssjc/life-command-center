-- Prompt 91 — sweep the empty-candidate match_disambiguation cards.
--
-- Grounding (live, 2026-08-09): 31 open match_disambiguation cards, of which 19
-- carry a literal context.candidates = [] (e.g. decisions 754292-754294, a
-- 2026-06-14 burst — same tenant "Southern Concrete Company", different
-- intake_ids). A disambiguation card with ZERO candidates is unworkable by
-- construction: the assist tick rightly skips it (skipped_no_candidates), but it
-- inflates the lane badge (honest-counts violation). The JS producer guard
-- (emitMatchDisambiguation, this same round) stops NEW empties from being minted;
-- this one-shot sweep closes the existing backlog.
--
-- Disposition: status -> 'skipped', effects.superseded_reason = 'empty_candidates_p91'.
-- This is NOT a silent drop: every one of these intakes is already parked in the
-- INTAKE review queue (staged_intake_items.status = 'review_required' with a
-- 'needs_review' staged_intake_matches row — verified live: e.g. intake
-- f8d11c87-b8ed-4708-8bf7-060455bf824f is a multi_address_no_match portfolio OM,
-- review_required). The empty card was the spurious surfacing; the intake stays
-- workable via its own review_required status (the correct no-match path). We do
-- NOT re-emit a disambiguation card (that is precisely the bug we are removing) —
-- the intake-level review lane is where a no-candidate intake belongs.
--
-- Idempotent (the WHERE guard makes a re-run a no-op). Reversible: the closed
-- rows are recoverable by effects->>'superseded_reason' = 'empty_candidates_p91'.

UPDATE public.lcc_decisions
   SET status = 'skipped',
       effects = COALESCE(effects, '{}'::jsonb)
                 || jsonb_build_object('superseded_reason', 'empty_candidates_p91'),
       updated_at = now()
 WHERE decision_type = 'match_disambiguation'
   AND status = 'open'
   AND jsonb_typeof(context->'candidates') = 'array'
   AND jsonb_array_length(context->'candidates') = 0;

-- REVERSAL RUNBOOK (if ever needed):
--   UPDATE public.lcc_decisions
--      SET status = 'open',
--          effects = effects - 'superseded_reason'
--    WHERE decision_type = 'match_disambiguation'
--      AND status = 'skipped'
--      AND effects->>'superseded_reason' = 'empty_candidates_p91';
