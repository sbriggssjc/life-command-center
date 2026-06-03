# Claude Code prompt — QA#12: review-counts (and data-quality/research) endpoint latency

Paste into Claude Code, run from the **life-command-center** repo. Touches
`api/admin.js` (`handleReviewCounts`) and possibly the count helpers in
`api/_shared/domain-db.js` / `ops-db.js`. End with merge + deploy commands.

---

## Context (measured 2026-06-03 via the opsPerf dashboard — don't re-investigate the symptom)

`render:review_console` is running **p50 4.1s / p95 7.8s / max 8.2s** — and it's
**backend/DB latency**, not client render (the lane DOM is a handful of buttons).
`render:data_quality` (~1–5.6s) and `render:research` (~1.9–2.8s) are similar.
The dominant cost is `/api/review-counts` (`handleReviewCounts` in `api/admin.js`).

**Important interaction:** the QA#9 fix just made these counts *actually execute*
— before, the gov/dia `domCount` lanes were 503-ing instantly (the credentials
bug), so they returned null for free. Now `handleReviewCounts` runs **six real
`count=exact` queries** (already parallelized via `Promise.all`), several on
large/expensive sources:

| lane / source | approx rows |
|---|---|
| `ownership_research_queue` (gov) | ~49,648 |
| `v_field_provenance_actionable` (ops) | ~13,259 |
| `v_stale_identities` (ops) | ~19,129 |
| `v_data_quality_issues` duplicate_property_address (gov) | ~6,914 |
| `pending_updates` (gov) | ~2,018 |
| `llc_research_queue` (gov/dia) | ~655 |
| `v_recorded_owner_link_review` (gov) | ~44 |

So total latency ≈ the **slowest single `count=exact`** (a big table or an
expensive view). Expect it to stay 4–8s or worse post-QA#9.

## Task — measure, then fix

1. **Measure** each lane's count time (time the individual `opsCount`/`domCount`
   calls, or `EXPLAIN ANALYZE SELECT count(*)` on each source). Identify which
   1–3 lanes dominate. Report the numbers in the PR.

2. **Fix the slow lanes.** Review-console lane counts are **headline
   approximations** ("~13k to review"), not values that need to be exact — so
   the right tradeoff differs from QA#3/QA#4 (which needed exact small counts for
   band chips / "0 items"). Options, cheapest first — pick per the measurements:
   - **`count=estimated`** for the large lanes (planner estimate, sub-ms). Good
     for big tables with healthy stats (≥ a few thousand rows). Keep
     `count=exact` for the small lanes where the exact number matters and is
     cheap (e.g. `sos_owner_links` ~44). The count helpers in `domain-db.js` /
     `ops-db.js` take a `countMode` — thread an estimated mode through per lane.
   - **Cached lane counts** (if estimates are too inaccurate for a lane): a small
     `lcc_review_lane_counts` table refreshed by a short pg_cron (mirror the
     `mv_user_work_counts` pattern), with `handleReviewCounts` reading the cache
     and a `generated_at`. More work; only if estimates won't do.
   - Whatever you choose, keep the `Promise.all` parallelism and add a per-lane
     timeout so one slow source can't hang the whole endpoint (return that lane
     as null + a `stale`/`timeout` marker rather than blocking).

3. **Do NOT revert QA#3/QA#4.** Those endpoints (priority-queue band counts,
   my_work) correctly use exact/view-based counts and must stay exact — this
   change is scoped to the **review-counts** lanes (and, if you confirm they
   share the cause, the data_quality / research page counts).

## Verify + ship
- After the change, `/api/review-counts` should return in **well under 1s** with
  all six lanes populated (approximate is fine for the large ones); report the
  new latency in the PR.
- `node --check api/admin.js` (+ any helper file touched). Function count
  unchanged (no new `api/*.js`). If you add a cron/table, include the idempotent
  migration on LCC Opps.
- End with merge + deploy commands (note any migration / cron to apply).
