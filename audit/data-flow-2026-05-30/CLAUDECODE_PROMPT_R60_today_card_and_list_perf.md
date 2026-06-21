# Claude Code — R60: fix the Today "Top BD Actions" card fetch + virtualize the long list views

## Why (live app re-walk 2026-06-20, post-R59 redeploy)
R59 verified live and working (signal-aware detail banner renders, Top BD Actions worklist + Priority
Queue all good). Two small polish items surfaced in the walk:
1. **The Today "Top BD Actions" card's inline rows sit on a loading spinner and never populate** —
   the card frame + "See all BD actions →" render, but the embedded row fetch doesn't resolve.
   Meanwhile the full Top BD Actions page (Priority → Top BD actions) loads its rows fine. So the
   card's inline fetch differs from the working full-page fetch.
2. **Renderer sluggishness on the big list views** — Priority Queue (~1,520 rows across bands) and
   Top BD Actions (~150 rows) render the whole list to the DOM; screenshots timed out mid-transition
   and the views are visibly heavy.

UI/perf round — no new data, reuse existing endpoints. ≤12 `api/*.js`; `node --check`/suite green;
ships on the Railway redeploy.

## Unit 1 — fix the Today "Top BD Actions" card
Diagnose why the Today card's inline rows don't populate while the full page does. Likely causes to
check: the card calls `?action=bd_worklist` without the `limit`/param the full page uses (or a
different param shape), an unhandled promise/parse on the card's render path, or it awaits a count
the endpoint doesn't return for the summary shape. Fix so the card shows the **top 5** rows
(value-ranked, each with its one-line action + route), matching the full page's data shape. On
genuine empty/slow, render a graceful empty/"view all" state — never an indefinite spinner (add a
timeout + error fallback). Verify the card populates on Today within a normal load.

## Unit 2 — virtualize / cap the long list views
The Priority Queue and Top BD Actions render all rows at once. Make them performant:
- Simplest robust fix: **render a capped first page** (e.g. top 50-100 rows) with a "Show more" /
  pagination control, instead of the full 1,500/150 at once. (Full windowing/virtualization is
  fine too, but a capped page is the low-risk win.)
- Keep the band-filter chips (Priority Queue) and the signal-filter chips (Top BD Actions) working
  against the full set — the cap is a render limit, not a data limit; selecting a band/filter
  re-pages within that subset.
- The queue already reads the R7 materialized cache, so this is a render-side change, not a query
  change.
Goal: the most-used surfaces render without the multi-second freeze / screenshot timeouts seen in
the walk.

## Verify (report back)
- Today "Top BD Actions" card populates its top-5 rows (no perpetual spinner); graceful empty/error
  fallback exercised.
- Priority Queue + Top BD Actions render a capped first page fast; "Show more"/pagination loads the
  rest; band/signal filters still work across the full set.
- `node --check`; ≤12 api/*.js; suite green; no new domain writes.

## Bottom line
Two polish fixes on top of the now-strong app: make the Today Top BD Actions card actually show its
rows, and stop the big list views from rendering 1,500 rows at once so the daily-driver surfaces
stay snappy.
