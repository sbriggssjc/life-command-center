# HOME2-c — the three lanes take SIGNIFICANT's place at the top of TODAY; TODAY keeps IMPORTANT + URGENT; nothing renders twice

**Filed:** 2026-09-18 (Cowork round 40). **Owner:** LCC (`index.html`, `app.js`, `test/home2-three-lanes.test.mjs`).
**Read first:** `docs/audits/HOME1_HOME_PAGE_*` (the spec), backlog `HOME2`, `HOME2-b`, `HOME2-c`, commits `7d30f90e`,
`f612db87`, `6addd692`; Scott's two Home screenshots 2026-09-18 (in the round-40 chat — TODAY's SIGNIFICANT block and
the BD lane show the same five sellers; the lanes sit below the whole TODAY panel).

## Decision (Cowork's recommendation, Scott confirming by not objecting after seeing the duplicate — option **b**)
- The RESEARCH / BD / INBOX widget moves **inside the TODAY card, where SIGNIFICANT is now**, with the TODAY header
  above it. SIGNIFICANT's block is **removed under the flag** (its content *is* the BD lane — same
  `/api/seller-prospect-queue`, top 5). IMPORTANT and URGENT stay below the lanes, unchanged.
- Flag OFF → today's layout exactly (SIGNIFICANT back, widget hidden). Flag ON → the layout above. Nothing else moves.
- The lanes' three columns are unequal today (RESEARCH cards are tall and narrow, INBOX rows wide): equal thirds,
  cards clamp to two lines with the address as title and a one-line reason; "See all" links per lane
  (`pageSellerProspectQueue`, the research feed, `pageInbox`).

## Measured, to keep honest
- BD lane and SIGNIFICANT both read `/api/seller-prospect-queue?chip=all&limit=5` (1.5 s since PERF-SPQ1-c).
- INBOX lane shows the same OM twice (`OM: USRC Gaffney…`) because the sidebar posted the inbox item twice within
  one second — that is `SIDEBAR2`, not this round; do not dedupe in the lane (it would hide the defect).

## Build
1. Move the widget markup; hide `#todaySignificant*` under `home_three_lanes` in `applyFeatureFlags()`; the "See all
   seller prospects (N)" link moves to the BD lane header.
2. Column layout as above; no new data calls.
3. Tests: flag ON → SIGNIFICANT block hidden and widget is the first child of the TODAY card; flag OFF → the reverse;
   ids `app.js` looks up exist in `index.html` (keep); a fixture render of each lane with N > 0.
4. Browser screenshot against Railway at first paint, flag ON, in the response.

⛔ No redesign beyond HOME1 + this placement. ⛔ STATUS entry labelled **(CC)**, written. **Parked:** one line each.
