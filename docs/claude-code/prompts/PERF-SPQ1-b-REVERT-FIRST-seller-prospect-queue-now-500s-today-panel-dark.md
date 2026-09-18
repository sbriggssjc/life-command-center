# PERF-SPQ1-b — REVERT FIRST: `/api/seller-prospect-queue` now returns **500 in 8.3 s**; the Today panel is dark ("Today unavailable — HTTP ?" × 3) since PR #2581 deployed

**Filed:** 2026-09-18 14:20 UTC (Cowork round 34, browser measurement on Railway `275f9c1b`). **Owner:** LCC
(`api/admin.js` `handleSellerProspectQueue`, `api/_shared/seller-prospect-queue.js`, `api/_shared/ops-query*`,
`test/`). **Read first:** PR #2581 (`61847975`, "parallelize seller-prospect-queue's 9 sequential reads"), the
PERF-SPQ1 prompt in `prompts/done/`, backlog `PERF-SPQ1`, `UX-T1a`, `PRI2-on`.

## Measured
- Before #2581 (Railway `4d932d92`, 13:10 UTC): `GET /api/seller-prospect-queue?chip=all&limit=5&offset=0` → **200 in 14.6 s**.
- After #2581 (Railway `275f9c1b`, 14:15 UTC): same request, signed in → **500 `{"error":"Internal server error"}` in 8.3 s**,
  reproducible (8,302 / 8,479 / 8,324 ms). The ~8 s is an upstream abort surfacing as a throw; with nine reads in one
  `Promise.all`, the first rejection fails the whole route where the serial version had degraded to "slow".
- Consequence on Home: TODAY renders *"Today unavailable — HTTP ?"* for SIGNIFICANT, IMPORTANT and URGENT, with
  Retry buttons; HOME2-b's BD lane says *"Could not load."*; the Priority tab presumably the same (not checked).
  Scott's working screen is dark on the route that ranks his day.
- The round ran `node --check` only — *"no test suite run"* — and the merge happened without a live probe.

## Do, in this order
1. **Revert #2581** (or ship a fix that is measured green before merge) — the Today panel must come back today.
   Proof: the request above returns 200 from the browser, timing recorded.
2. **Find the 8 s.** Which of the nine reads aborts, and what sets 8 s (`opsQuery` / fetch timeout / PostgREST
   statement timeout / Railway)? Log per-read timings once, in the response body under `_perf` behind
   `?view=_perf` (the client already posts to that view).
3. **Then the real fix, as PERF-SPQ1 said:** one counts query (a view or RPC on LCC Opps returning every chip's
   exact count in a single pass; exactness kept, P139), page + counts in parallel, and a fallback that degrades
   to *"counts unavailable (as of …)"* rather than 500 when a count fails — a page with no badges beats a dark panel.
4. Tests that would have caught this: a route test with a stubbed slow/aborting count that asserts 200 + items +
   `counts: null` (never 500); and `npm run verify:deploy` probing this route's status and time after deploy.
5. Report browser timings before/after and the query plan for the counts query.

⛔ No merge without the browser probe in the response. ⛔ STATUS entry labelled **(CC)**. **Parked:** one line each.
