# PERF-SPQ1-c — revert #2581 **and** #2583 now: the route still fails (502 in 26 s), Today is still dark; then rebuild the counts properly

**Filed:** 2026-09-18 16:10 UTC (Cowork round 35, browser probe on Railway `c017ff3f`). **Owner:** LCC (`api/admin.js`
`handleSellerProspectQueue`, `api/_shared/seller-prospect-queue.js`, `api/_shared/ops-query*`, `supabase/migrations/`
on LCC Opps, `test/`). **Read first:** PRs #2581 (`61847975`) and #2583 (`e716b258`), prompts `PERF-SPQ1` and
`PERF-SPQ1-b` in `prompts/done/`, backlog `PERF-SPQ1`, `PERF-SPQ1-b`.

## Measured, same request from the signed-in page (`GET /api/seller-prospect-queue?chip=all&limit=5&offset=0`)
| Railway build | result |
|---|---|
| `4d932d92` (before #2581), 13:10 UTC | **200 in 14.6 s** — slow, but Today rendered |
| `275f9c1b` (#2581: nine reads in one `Promise.all`), 14:15 UTC | **500 in 8.3 s**, ×3 — Today dark |
| `c017ff3f` (#2583: `.catch` on the items promise), 16:08 UTC | **502 in 26.2 s** — `{"error":"list_failed","detail":{"error":"items_query_threw","message":"This operation was aborted"}}` — Today dark, BD lane "Could not load." |

#2583 changed the error's shape, not the outcome: the **items page query itself now aborts**. Nine simultaneous
full passes over `v_lcc_seller_prospect_queue` (regex-heavy owner filters, ~0.9 s each alone) contend on LCC Opps and
the page read — the one that matters — is the one that times out. The serial version was slow; the parallel version
starves the page. Neither round ran a browser probe before merging ("no test suite run"; "needs a live probe… which I
can't run from here").

## Do, in this order
1. **Revert both** (`git revert e716b258 61847975`, one PR) and confirm from the browser that the request returns
   200 again (~14 s is acceptable for the hour it takes to do step 3). Merge only with the browser timing in the PR body.
2. **Instrument once:** wrap each upstream read with a timer and return them under `_perf` for `?view=_perf`; find
   what sets the abort (client `AbortController` in `ops-query`? PostgREST `statement_timeout`? Railway proxy?) and
   report the number.
3. **The real fix, once:** a single SQL function on LCC Opps, `lcc_seller_prospect_chip_counts(workspace uuid)`,
   returning every chip's exact count from **one** pass (`count(*) filter (where …)` with the same predicates the JS
   uses — move the predicate definitions into SQL and have the JS read the chip list from the function's result so
   there is one source). Route = two reads (page, counts) in parallel; if counts fail, return 200 with
   `counts: null, counts_error: '…'` and let the badge say "counts unavailable" (P139 kept: never a wrong number,
   never a 500). Consider `LIMIT`-ing the page read before the joins if the plan shows the view materialises fully.
4. Tests: chip predicates in SQL and JS agree (fixture of 10 rows); route returns 200 + items when the counts read
   throws (stub); `npm run verify:deploy` probes this route's status and duration (warn > 3 s, fail on 5xx).
5. Report browser timings for each step and the counts function's plan.

⛔ **No merge without a browser probe in the response** — a curl to a route that needs auth proves nothing; use the
signed-in page or the `_perf` view. ⛔ STATUS entry labelled **(CC)**. **Parked:** one line each.
