# Prompt 123 — `match-deal-emails-cron` returns `no_response` (matcher HTTP call times out despite the count fix)

**Status:** DRAFT 2026-08-21 (Cowork-diagnosed from live LCC Opps health)

Grounding: `api/_handlers/deal-email-match-cron.js` (route `POST /api/pipeline/match-deal-emails-cron`, hourly
pg_cron `lcc-deal-email-match` → `lcc_cron_post`), the matcher engine `mcp/deal-email-matcher.js`
(`makeDealEmailMatcherRoute`), gate `DEAL_EMAIL_MATCH_ENABLED` / registry `DEAL_EMAIL_MATCH_CRON`,
`lcc_deal_match_run_log`. Doctrine: the P118 "profile the handler's REAL query shape; a `loops=`-per-row node
is a correlated subplan no index fixes" lesson, and "assert on the state delta, not the worker's own tally."

## The break

Live health: **`pg_net:no_response [/api/pipeline/match-deal-emails-cron]` — 6 HTTP calls returned
`no_response` in the last 24h.** `no_response` means pg_net got NO response at all — the Railway request
exceeded the response window and the connection dropped, so no `lcc_deal_match_run_log` row and no honest
error is captured. The handler already carries a documented fix (`engineOpsQuery` forces `countMode:'none'` to
kill an exact `count=exact` over `activity_events` 22k+ rows that was hitting the statement timeout and
crashing the run) — so a *different* slow path is still blowing the response window, or the run is simply too
large per invocation.

## The ask

1. **First establish which state it's in.** Is `DEAL_EMAIL_MATCH_ENABLED` actually ON (registry
   `DEAL_EMAIL_MATCH_CRON`)? A gated no-op returns 200 fast → no `no_response`; so either the matcher is
   running and too slow, or there's a connectivity/cold-start issue. Check `lcc_deal_match_run_log` for the
   last successful run + its duration/rowcounts, and whether the 6 failures cluster (cold start after idle) or
   are steady.
2. **If it's a genuine matcher timeout, profile the real per-run query shape** (P118 method — reproduce the
   exact PostgREST paths the matcher issues, with the same filters/orderings, in ONE session; look for a
   `loops=`-per-row correlated subplan or a full-table scan per candidate deal). Fix at the source (hoist the
   correlated aggregate / add a functional index if the key is IMMUTABLE / narrow the candidate set), not by
   just raising a timeout.
3. **Bound the work per invocation.** A recurring matcher must drain a bounded batch and advance, so one run
   can't exceed the response window regardless of backlog (same "per-tick drain + cursor" pattern as the move
   queue / P122). Make a `no_response` structurally impossible: cap candidates per run, and ensure the handler
   returns its 200 envelope well inside pg_net's timeout even on the largest backlog.
4. **Make the failure observable.** Today a `no_response` writes no run-log row (the request died before the
   log write). Write the run-log row FIRST (started) and update it on completion, so a dropped run is
   distinguishable from a slow-but-healthy one — never a silent gap.

## Verify
- A full hour's run completes inside the response window with a `lcc_deal_match_run_log` row; `no_response`
  rate → 0 over a day; matches actually written (state delta on the deal-match target), not just "ran".

## Close-out
- Handler/engine changes ship on the Railway redeploy of merged `main` → `npm run verify:deploy`. Any DB
  migration is live-immediate. Update STATUS + `WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md` (W7.1).
