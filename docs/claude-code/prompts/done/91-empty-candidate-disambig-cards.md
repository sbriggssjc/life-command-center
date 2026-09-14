# Prompt 91 — micro: empty-candidate match_disambiguation cards (producer guard + sweep)

**Grounding (live, 2026-08-09):** the disambig-assist tick skipped 19/19 remaining cards —
Cowork traced it: all have literal `context.candidates: []` (e.g. decisions 754292-754294, a
2026-06-14 burst — same tenant "Southern Concrete Company"/address, different intake_ids). A
disambiguation card with zero candidates is unworkable by construction: the assist rightly
refuses it, but it inflates the lane badge (honest-counts violation) and represents a producer
bug — the matcher minted "pick one of nothing" instead of routing to its no-match path.

## Do (small)

1. **Producer guard:** in the intake matcher path that mints `match_disambiguation` decisions,
   never mint when the candidate list is empty — route to whatever the correct no-match
   disposition is (the create-property / park flow the matcher uses when nothing scores).
   Regression test.
2. **One-shot sweep:** close all OPEN `match_disambiguation` decisions whose
   `context.candidates` is `[]` — status `skipped`, `superseded_reason: 'empty_candidates_p91'`
   (count first; expect ~19). If the underlying intakes are still unresolved, re-emit them through
   the correct no-match path rather than silently dropping (check one: intake
   f8d11c87-b8ed-4708-8bf7-060455bf824f). Idempotent; report counts.
3. **Assist tick polish:** surface `skipped_no_candidates` as its own counter so this class is
   visible in the response rather than folded into a generic skip.

Acceptance: lane badge drops to real workable cards (~12 annotated ones + any future valid mints);
assist tick reports 0 unannotated or annotates real cards only; producer can no longer mint empty
cards. Commit with the repo trailer.
