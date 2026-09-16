# PRI2 — re-compose the Priority tab on `v_lcc_seller_prospect_queue`; hide the code-doable bands; count them in a footer

**Filed:** 2026-09-16 (Cowork), the build unit PRI1 named. **Owner:** LCC (`ops.js`, one view, one test file).
**Read first:** PRI1's response (band table + spec; `test/pri1-priority-queue-band-labels.test.mjs`),
`v_lcc_seller_prospect_queue` (shipped 2026-09-03, 520 rows / 453 owners — the seller doctrine
implemented: $2.5M–$25M, newer lease, reason-to-sell, not-yet-reached), UX-T1a-gates (`human_surface`),
`CLAUDE.md` → "A band named for the doctrine can select the opposite population" and "single-advance-owner".

## What PRI1 measured

- 941 of 1,635 queue rows (P0.4 555 · P-CONTACT 216 · P0.5 148 · P-BUYER 22) are plumbing already
  flagged non-human by `human_surface`; the human set is the 694 seller-timing rows (P8 213 · P3 166 ·
  P1 147 · P2 95 · P5 59 · P4 14).
- The tab's population is **89.6% disjoint** from the seller doctrine's (UX-T1a): late-term leases were
  selected, not the newer ones the doctrine wants.
- The four sub-entries (Next best touchpoint / Cadence dashboard / Top BD actions / Qualify contacts)
  are four worklists, not views of one list.
- `v_lcc_seller_prospect_queue` already implements what Scott asked for and has **no UI wiring**.

## What to build (flag-gated OFF, `PRIORITY_TAB_V2`)

1. **One ranked list** backed by `v_lcc_seller_prospect_queue`: each row = *owner · property · why now
  (the reason-to-sell column, in words) · the one button* (open property / open owner / log touch —
  whichever the row's next step is; name the rule). Rank = the view's existing order; do not add a score.
2. **Code-doable bands leave the list.** P0.4 / P0.5 / P-CONTACT / P-BUYER rows are not rendered; a footer
  reads "N resolved automatically today" from the existing producers' ledgers (A2/cron 244 for P0.4, the
  bulk-open path for P0.5, Tier 0 auto-attach for P-CONTACT). Where no producer exists yet, the footer says
  "N waiting on <producer>" — never silently dropped.
3. **Readable labels** (PRI1's `_pqBandLabel`) carry over as the row's "why now" prefix.
4. **The four sub-entries** collapse to two: the list (this) and the Cadence dashboard; "Top BD actions"
  and "Qualify contacts" become filters or are removed — measure their top-20 overlap with the new list
  first and say which.
5. Tests: the list renders only rows present in `v_lcc_seller_prospect_queue`; a P0.4 row never renders;
  the footer count equals the ledger count for the day (mock); flag OFF leaves the current tab byte-identical.

## Gate before flag ON

Side-by-side for one real day: the current tab's top 20 vs the new list's top 20, with Scott's read on
which he would actually work first. Record it in `docs/audits/PRI2_SIDE_BY_SIDE_<date>.md`. Flag ON is
Scott's call after that read, not the round's.

## Prohibitions

- ⛔ No new scoring engine, no edits to `v_lcc_seller_prospect_queue`'s predicate in this round.
- ⛔ Do not delete the P-band machinery; it stays behind the flag until the side-by-side is read.
- ⛔ Redeploy both Railway services and confirm `/version` before calling anything live.
