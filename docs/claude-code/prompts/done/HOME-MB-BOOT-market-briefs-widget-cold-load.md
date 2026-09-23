# HOME-MB-BOOT — the Home "Market Briefs" widget spins forever on a cold load

Backlog: `HOME-MB-BOOT`. Scott hard-refreshed Home on 2026-09-23. Everything painted except Market Briefs, which stayed on its spinner.

## Measured (code read by Cowork)

- The widget container ships with a spinner (`index.html` ~259, `#marketBriefsWidgetContent`). It is filled only by `renderMarketBriefsWidget()` (`app.js` ~7468). Every branch of that function replaces the spinner: facts, "Not live yet.", "No live facts yet." or "Unavailable right now." So a permanent spinner means the function never ran.
- The only caller is `handlePageLoad('pageHome')` (`app.js` ~1138). That has been true since MB-b (`71fccd05`).
- On a cold load, `pageHome` is already the active page. The router bootstrap (`applyRoute`, ~2297) calls `navTo` only when the target page is *not* active, so `handlePageLoad` never runs.
- `bootApp()` (~9610) renders Today, the three lanes and the briefing directly. It doesn't call this widget.
- The endpoint is healthy: `GET /api/market-brief-tab?lane=dialysis` answered 401 (unauthenticated) in 0.26 s from outside.

## Ask

1. Make the widget render on a cold load. Either call it from `bootApp()` after auth, or have the router bootstrap run `handlePageLoad` once for the initially active page. Pick the one that doesn't double-render the other Home widgets, and say why.
2. Audit `handlePageLoad('pageHome')`'s other calls (`renderDailyBriefingPanel`, `renderNextBestActionPanel`, `renderTodaySections`) for the same cold-load gap. Report which are covered by `bootApp` and which aren't.
3. Add a test that a cold boot on `#/` (or no hash) invokes `renderMarketBriefsWidget`. Include a mutation that turns it red.

## Do not touch

- The market-brief producer, flags or API.

## Done means

- The backlog row is updated.
- Cache busters are bumped as a set.
- Deploy = redeploy both Railway services.
- Scott re-checks with a hard refresh.
