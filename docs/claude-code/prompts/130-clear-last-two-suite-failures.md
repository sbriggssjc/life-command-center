# Prompt 130 — Clear the last two full-suite failures (get to green), each on its own merits

**Status:** DRAFT 2026-08-24 (Cowork; the 2 that survived P128/P129 — suite is 4,365/2)

Grounding: `test/auto-scrape-listings.test.js` + its handler; `test/folder-feed-enrich-mode.test.mjs` +
`api/_handlers/folder-feed.js` (enrich-mode path). CC confirmed both are **pre-existing, behavioural (NOT stale
source-greps like P126/128/129), reproduce in isolation on `main`.** Doctrine: determine real-bug vs
stale/over-strict test PER failure before fixing (this arc, red tests were stale twice and real once — don't
assume either way); verify by the pass/fail LIST, never `node --test`'s exit code.

## The two failures

1. **`auto-scrape-listings.test.js`** — "expected ±3y lower bound in URL": the scrape query issues
   `gte.<listing_date>&lte.<+3y>` with **no `-3y` lower bound**, and the handler **502s**. A 502 smells like a
   real handler defect, not a picky test — start here.
2. **`folder-feed-enrich-mode.test.mjs`** — "disambiguation decision emitted" is `false`: in enrich mode with
   **no match**, the folder-feed path **creates nothing and emits no disambiguation decision**. Determine
   whether that's a genuine gap (an ambiguous enrich SHOULD raise a review/disambiguation item) or the test
   asserting an intent that was deliberately changed.

## The ask

For EACH, independently:
1. **Classify with evidence:** real code defect vs. stale/over-strict test. Show the failing assertion, the
   actual handler behaviour, and which one is wrong.
2. **Fix at the right layer:** if a real defect (the 502 / a missing disambiguation emit that SHOULD fire),
   fix the handler and prove the behaviour by state delta, not just a green assertion. If the test is stale or
   asserts a superseded intent, re-anchor it on current behaviour (and note what changed).
3. **If a failure reflects an intentionally-unbuilt path** (e.g. enrich-no-match is deliberately a silent
   no-op), don't invent a feature to satisfy a test — quarantine it with an explicit `it.skip` + a one-line
   reason and a STATUS note, so "green" means "green," not "green by fabrication."
4. **Verify by the pass/fail LIST:** targeted tests resolved, full suite **4,365/2 → 4,367/0** (or 4,366/1 with
   one honest documented skip). Confirm no other test moved.

## Close-out
- Handler fixes ship on the Railway redeploy of merged `main`; test-only changes ship whenever. Update STATUS
  with the per-failure verdict and the final suite count. This closes the test-hygiene segment; key rotation is
  the next item.
