# HOME2-e — HOME2-d's grid rules lose to `.widget-grid`'s desktop rule; make them win and prove it on Railway

**Repo root:** `life-command-center` (this repo — `index.html`, `styles.css`, `test/home2-three-lanes.test.mjs`). **Filed:** 2026-09-18
(Cowork round 44; backlog `HOME2-e`). **Read first:** backlog `HOME2-c`, `HOME2-d`, `HOME2-e`; STATUS round 44; PR #2594.

## Measured (Cowork, Chrome on Railway `c64413d7`, flag `home_three_lanes` ON, 1438-px viewport)
- `#home3LanesWidget .widget-grid.home3-grid` computed `grid-template-columns` = **`115.6px 115.6px 115.6px 115.6px`**.
- Cause: `.home3-grid { grid-template-columns: repeat(3, minmax(0,1fr)) }` and `@container (max-width: 900px) { .home3-grid
  { grid-template-columns: 1fr } }` are single-class selectors (0,1,0). `@media (min-width: 768px) { .widget-grid
  { grid-template-columns: repeat(4, 1fr) } }` (styles.css ~1292) has the same specificity and comes later, so it wins.
- `#todaySectionsWidget { container-type: inline-size }` is in effect (checked). Data loads. Three 116-px lanes + an empty fourth
  track; no overflow, unreadable. HOME2-c's SIGNIFICANT hide and See-all links are fine.

## Build
1. Raise specificity on BOTH rules — `#home3LanesWidget .home3-grid` (or `.widget-grid.home3-grid`) for the base rule and inside
   the `@container` block (and the `@supports not` fallback). Do not move or edit the `.widget-grid` desktop rule (other pages use it).
2. `test/home2-three-lanes.test.mjs`: assert the selector shape (`#home3LanesWidget .home3-grid` or `.widget-grid.home3-grid`
   appears in the base rule AND the container rule) — a rule-presence check passed while the page was wrong (PL-61).
3. Cache-buster bump as HOME2-d did (styles.css version moves as a set).
4. **Proof in the response, after merge + Railway redeploy:** computed `gridTemplateColumns` of `#home3LanesWidget .home3-grid`
   at ~1440-px viewport (expect one track — the card is ~500 px, under the 900-px container threshold) and at a width where the
   card exceeds 900 px (expect three `minmax` tracks), plus a screenshot. If no browser is available, say so and stop before
   "done" — Cowork will probe; do not report the layout as verified.

⛔ No other CSS. ⛔ Flag-off byte-identical. ⛔ STATUS heading **`Round <prompt round>-CC (CC)`** — never a bare Cowork number,
never "(Cowork)"; entry written before the PR.

**Parked:** one line each.
