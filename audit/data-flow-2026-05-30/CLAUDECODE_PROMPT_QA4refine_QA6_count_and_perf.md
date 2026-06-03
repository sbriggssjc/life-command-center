# Claude Code prompt — QA#4 refinement (My Work exact count) + QA#6 (render-perf, profile-first)

Paste into Claude Code, run from the **life-command-center** repo. (Harness picks
the branch — fine; end with merge + deploy commands.)

---

## QA#4 refinement — kill the My Work count flicker

**Verified live 2026-06-03:** after the QA#4 inbox-exclusion fix, the My Work
total dropped 8442 → 0 (matches "Open Activities"). But on a cold load the Today
"View all **1001** items" link briefly disagreed with "Open Activities" (0).
Root cause: `v2GetMyWork` (`api/queue.js`, ~line 300) uses
`countMode: 'estimated'` — a PostgREST **planner estimate** on the `v_my_work`
UNION view, which returns garbage like 1001. The comment notes exact count was
"the dominant cost" — but that was *before* inbox exclusion; the action-items-
only, user-scoped set is now tiny, so an exact count is cheap.

Fix:
1. `api/queue.js` `v2GetMyWork`: change `countMode: 'estimated'` →
   `countMode: 'exact'`. Update the comment (inbox exclusion removed the
   dominant cost, so exact is now affordable and the Today widget total must be
   accurate). Do the same for the v1 `case 'my_work'` (~line 74) for parity.
2. `app.js`: the "View all N items" link (~line 6471) reads
   `canonicalMyWork.pagination.total`, while "Open Activities"
   (`renderHomeStats`, ~line 6311) reads the exact MV count
   (`canonicalCounts.open_actions ?? canonicalCounts.my_actions`). Make the
   "View all" link use that **same** exact value (fall back to the now-exact
   `pagination.total` only if `canonicalCounts` is absent), so the widget total
   and the stat are guaranteed to match. Also re-check the stale-MV fallback in
   `renderHomeStats` (~line 6318: `if (allZero && liveTotal>0) actCount=liveTotal`)
   — `liveTotal` should be the now-exact total, so it no longer risks promoting
   a bad estimate.

Verify: on a cold load and a warm load, Today "View all N", "Open Activities",
and Pipeline "N items" all show the same number (0 for Scott today).

## QA#6 — render responsiveness (PROFILE FIRST — do not optimize blind)

**Evidence is weak/ambiguous:** during the live walkthrough, `Page.captureScreenshot`
(CDP) timed out 2–3× ("renderer may be frozen") around Priority Queue chip
clicks and page switches. That may be the headless capture under load rather
than a freeze a human would feel — JS kept executing fine throughout. So treat
this as "measure before fixing."

The app already has perf instrumentation: `opsPerf(label)` in `ops.js` (pushes
`{label, dur}` to `opsPerfLog`, beacons to `/api/queue-v2?view=_perf`), surfaced
by `v2GetPerfDashboard` (`v_perf_endpoint_summary` / `v_perf_target_compliance`
/ `v_perf_hourly_throughput`). `render:my_work` and `render:team_queue` are
already instrumented.

Task:
1. Add `opsPerf('render:priority_queue')` and `opsPerf('render:review_console')`
   wrappers around those two render functions if not already present (mirror the
   `render:my_work` pattern), so client render time is captured.
2. Pull the `_perf` dashboard (or read `opsPerfLog` in a live session) and find
   any `render:*` whose duration regularly exceeds **~100ms** on the heavy
   surfaces (Priority Queue 150 rows, Review Console, My Work).
3. **Only if** a real hot path shows up: reduce it — chunk large list builds
   (render in `requestAnimationFrame` batches), avoid full-innerHTML rebuilds on
   filter clicks where a targeted update suffices, or cap/virtualize the list.
   The Priority Queue chip-filter re-render (full `renderPriorityQueuePage`) is
   the most likely candidate — consider re-rendering only the rows, not the
   whole page, on a chip click.
4. If nothing exceeds threshold, **close QA#6 as not-reproducible** (likely a
   capture-tool artifact) and just leave the new perf wrappers in place for
   future monitoring. Don't add speculative optimizations.

## Verify + ship
- `node --check api/queue.js app.js ops.js`. Function count unchanged.
- Report the measured `render:*` durations in the PR so we know whether QA#6 was
  real or an artifact.
- End with merge + deploy commands.
