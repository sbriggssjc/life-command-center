# Prompt 84 — W8 U1 nightly fix: windowed scan so scoring actually runs

**Grounding (live, 2026-08-08 night run):** all five crons fired; U2/U3/U5/assist produced
(+21 pairs / +1 link / 67 hygiene proposals / 12 annotations) but **U1 wrote only a `scan` batch
(03:40, status 'open') with NO apply/scoring** — 0 new proposals, scored-ledger unchanged (20).
GaryBuilt was up (the 3:50–4:30 units scored fine). Root cause hypothesis to verify: U1 is the
only unit still FULL-scanning all ~128k rows across 7 targets every invocation (no scan cursor —
U5 got one in 83, U2 in 68), so the scan eats the invocation budget and the scoring stage gets
nothing. Also the scan batch row is never closed (status stays 'open').

## Do (small — port the 83 pattern back to U1)

1. Verify the root cause from the tick's behavior/logs, then: **windowed resumable scan** —
   per-invocation scan cap (~20k rows) with keyset cursors persisted in the batch ledger
   (83's exact pattern), so nightly runs walk the corpus instead of rescanning it. Budget
   accounting: scan and scoring each get a bounded share; scoring must always get its slice.
2. Apply batch bookkeeping: write the apply batch with honest `scored`/`by_verdict` details;
   close scan batch rows (status lifecycle, not perpetual 'open').
3. Sanity: with 199 enqueueable blank-name dia contacts waiting, the next nightly should produce
   a real batch (~25 scored, mostly dismiss).
4. Tests: cursor resume, scoring-gets-budget guard, batch lifecycle; existing suites green.

Acceptance: next nightly (or a manual POST) yields scored>0, proposals in the junk lane, cursor
advanced. Commit with the repo trailer.
