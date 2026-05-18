# QA-26 — Gov dashboard parallel pagination (P1 perf)

**Severity: P1 perf.** Gov home dashboard showed 8–14 seconds of
"loading..." widgets before becoming usable. Phase 1 was Promise.all'd at
the top level but each individual paginated query was fetching pages
**serially** at 1000 rows/page — for the properties table (17,472 rows)
that's 18 sequential round-trips at ~400ms each, ~7 seconds of round-trip
latency for a query the DB itself executes in 95 ms.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-26-gov-parallel-pagination
node audit/patches/qa-26-gov-parallel-pagination/apply.mjs --dry
node audit/patches/qa-26-gov-parallel-pagination/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-26-gov-parallel-pagination/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-26-gov-parallel-pagination -m "Merge audit/qa-26-gov-parallel-pagination"
git push origin main
```

## Diagnosis

Live table sizes on gov (2026-05-18):

| Table              | Rows   | Pages @ 1000 | Serial cost |
|--------------------|-------:|-------------:|------------:|
| properties         | 17,472 |           18 |     ~7.2 s  |
| prospect_leads     | 11,516 |           12 |     ~4.8 s  |
| ownership_history  | 13,508 |           14 |     ~5.6 s  |
| sales_transactions |  7,706 |            8 |     ~3.2 s  |
| true_owners        | 14,099 |           15 |     ~6.0 s  |

`EXPLAIN ANALYZE` on the worst-case properties query (full select, ORDER
BY estimated_value DESC NULLS LAST...): **95 ms of DB time**. The
remainder of the 7-second wall-clock is round-trip latency in the
Edge Function + PostgREST. The fix is purely a frontend pagination
refactor — no SQL changes.

## Fix

`govQueryAll` and `_loadPaginatedQuery` previously fetched page N+1 only
after page N returned. Now:

1. First page is fetched with `count=exact`, which tells us the total row
   count in the Content-Range header.
2. All remaining pages are issued via `Promise.all` — 17 parallel HTTP
   round-trips instead of 17 sequential ones.
3. Wall-clock = `first_page + slowest_parallel_page` ≈ ~800 ms instead
   of ~7,200 ms.

Also parallelized the **ownership-coverage block** in `renderGovOverview`,
which was awaiting three independent queries serially: `ownership_history`
full scan, `true_owners` full scan, and the QA-25 `v_prospect_targets`
query. All three now run via `Promise.all`. (The third uses a settled-
result wrapper so a 403 on `v_prospect_targets` falls back cleanly to
the legacy missing-SF metric.)

## Expected speedup

Phase 1 (blocks first paint):
- Before: ~7–8 s (bottleneck = serial properties pagination)
- After:  ~1.0–1.5 s (parallel pagination)

Phase 2 (background, no first-paint impact, but improves time-to-fully-
loaded):
- Before: ~6–10 s of additional serial pagination after Phase 1
- After:  ~1–2 s

Ownership-coverage widget (lazy, but blocks the bottom-of-page section):
- Before: ~12–18 s (three serial full-table reads)
- After:  ~1.5–2 s (parallel, with each one internally parallel-paginated)

## Risks considered

- **18 concurrent HTTP requests** on Phase 1 + Phase 2 launch. Supabase
  doesn't aggressively rate-limit a single auth token; the Edge Function
  is stateless and these are independent GETs. Acceptable.
- **DB sort repeated 18× in parallel.** Each parallel page re-runs the
  full ORDER BY. At 17k rows / 95 ms / sort, that's ~1.7 s of DB CPU
  spread across 18 backends. Spike is brief and doesn't affect other
  users meaningfully. Worth it for the wall-clock win.
- **Timeout removed.** Original `govQueryAll` had a 120 s total-time
  fuse that broke out of the loop. The new code can't break early from
  inside Promise.all, but each individual page still has the 30 s
  per-request abort in `govQuery`. For any table small enough to fit
  in 30 s of wall-clock (i.e. all of them), the new code is strictly
  better.

## Dia side — out of scope here

`diaQueryAll` has the same serial pattern and would benefit from the same
fix, but `diaQuery` currently hardcodes `count=false` in its URL builder
which means we can't use the Content-Range total. Patching dia requires
modifying `diaQuery` to honor a count option — separate patch.

## Files changed

- `gov.js` — `govQueryAll`, `_loadPaginatedQuery`, ownership-coverage block
- `AUDIT_PROGRESS.md` (closeout)

No SQL, no Edge Function, no allowlist changes.
