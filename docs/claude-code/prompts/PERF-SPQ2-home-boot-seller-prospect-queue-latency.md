# PERF-SPQ2 — Home's cold boot loses its own 12s race against `v_lcc_seller_prospect_queue`

## Context

`v_lcc_seller_prospect_queue` costs ~0.85s per pass under normal load, but Home
issues several passes of it at boot (`today_sections`, the seller-prospect-queue
page + its counts, and the priority-queue lane) — round 37 probes measured the same
request at 1.5s alone and **16s** during a real page load. Today's card has a 12s
race against its own data and loses, painting "unavailable" until the user hits
Retry.

Round 45 added one more data point: on a cold Home load (Railway `0abc89f7`) the BD
lane and the INBOX lane both spun for ~10s behind one ~20s request, while a
different query (`queue-v2?view=work_counts`) answered in 0.8s in the same load —
so the slowness is specific to this query path repeated multiple times, not a
general DB/network problem that morning.

Three options were floated when this was filed, none chosen yet:
- (a) materialize the queue into a table refreshed by the existing 5-minute tick,
  with `as_of`, and have the views read the table instead of computing live;
- (b) one `home_boot` endpoint that computes the queue once per page load and
  serves Today + the BD lane + chips from that single result, instead of each
  lane independently re-querying;
- (c) raise Today's race timeout to 30s (papers over the symptom, doesn't fix the
  underlying repeated-computation cost).

## Ask

**Measure first, precisely, before picking an option** — this row explicitly says
"measure first" and that instruction still stands:
1. Instrument (or find an existing `_perf`-style view/log) to get per-pass timing
   for `v_lcc_seller_prospect_queue` specifically, and confirm exactly how many
   times a single cold Home load triggers it (Today's `today_sections`, the
   seller-prospect-queue page/counts call, the priority-queue lane — confirm
   whether it's really 3 separate call sites or more/fewer).
2. With real numbers in hand, recommend and implement the option that actually
   fixes the repeated-computation cost — option (c) alone is very unlikely to be
   the right call since it doesn't address why the query is slow or why it runs
   multiple times per load, but make the call based on what the measurement shows
   rather than this prompt's guess. If (a) or (b) turns out to be substantially
   more work than the other, say so and let Scott choose between them rather than
   silently picking the cheaper one.
3. Whichever option is implemented, confirm the fix with a fresh cold-load
   measurement (not just a warm/cached one) showing Home's boot request completing
   well inside its race window, and that the seller-prospect-queue data shown is
   still correct (no staleness regression if a materialized-table approach is
   chosen — confirm the 5-minute refresh tick is actually adequate for how fresh
   this data needs to be, or say if it isn't).

## Do not touch

- `queue-v2?view=work_counts` or the BD/INBOX lanes' own query paths — already
  confirmed fast in round 45's evidence, not part of this defect.
