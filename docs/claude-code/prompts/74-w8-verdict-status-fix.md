# Prompt 74 — W8 micro-fix: verdict record uses invalid lcc_decisions status 'resolved'

**Grounding (live failure, 2026-08-07):** Scott worked the FIRST real card in the U1 junk-review
lane → UI error "verdict record failed". DB forensics (Cowork): the review row WAS applied
(`junk_entity_review` status='applied', soft-retire landed) and the mint-at-verdict decision row
exists (`lcc_decisions` decision_type='junk_entity_review', status='open') — but closing it failed
because the code sets **`status='resolved'`**, which violates
`lcc_decisions_status_check` (allowed: `open/decided/skipped/superseded`). This traces to the
prompt-62 session's late edit "harden the verdict record status to always use 'resolved'".

## Do (small)

1. In the U1 verdict branch (`api/admin.js`), close the minted decision with **`'decided'`**
   (or `'skipped'` for keep/not-junk verdicts if that's the house semantic — check how
   `sf_link_candidate` verdicts set it and match).
2. **Sweep all three W8 verdict branches** (U1 junk, U2 dup-pair fold in owner_reconcile, U3
   link/different_people) + any other spot the 62-session hardening touched, for the same invalid
   `'resolved'` literal — fix every instance to a CHECK-valid status.
3. **Repair the stranded row:** the one open `lcc_decisions` junk_entity_review row from Scott's
   first verdict should be closed 'decided' (idempotent UPDATE in the PR or a one-line SQL note
   for Cowork to run).
4. **Test:** structural guard asserting no W8 verdict branch writes an lcc_decisions status
   outside the CHECK list (grep-based, pinned to the four allowed literals).

## Acceptance

- A U1 lane verdict completes without error; decision row lands 'decided'; review row applied;
  ledger written. Same for a U2 pair verdict and a U3 confirm.

Commit with the repo Co-Authored-By + Claude-Session trailer.
