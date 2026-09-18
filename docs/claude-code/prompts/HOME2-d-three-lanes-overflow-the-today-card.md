# HOME2-d — the three lanes overflow the TODAY card; make them fit (stack when narrow, thirds only when wide)

**Filed:** 2026-09-18 (Cowork round 42; backlog `HOME2-d`). **Owner:** LCC (`index.html` `#home3LanesWidget`, `styles.css`,
`test/home2-three-lanes.test.mjs`). **Read first:** backlog `HOME2`, `HOME2-b`, `HOME2-c`, `HOME2-d`; STATUS rounds 40–42;
`prompts/done/HOME2-c-lanes-replace-todays-significant-block.md`.

## Measured (Cowork, Chrome on Railway `95137d03`, flag `home_three_lanes` ON, 1438-px viewport)
- `#home3LanesWidget` is inside the TODAY card as HOME2-c specified; the card's content width is **498 px** (`.home-layout`
  is `1fr 320px` at ≥768 px, so the main column is narrow on a laptop).
- `#home3LanesWidget .widget-grid` carries inline `grid-template-columns:1fr 1fr 1fr`; lane children have `min-width:auto`,
  so the tracks size to content: **342 / 208 / 139 px**, `scrollWidth` 713 in a 498-px box. The INBOX lane's right edge is at
  x=1006 while the card ends at x=809 — it is painted under the MY WORK column and cannot be seen. BD titles wrap to three
  lines; the "See all seller prospects (507)" button is half off the card.
- SIGNIFICANT hidden, IMPORTANT + URGENT intact, See-all links work — placement is right; only the grid is wrong.

## Build
1. **Floor:** replace the inline style with a class; `grid-template-columns: repeat(3, minmax(0, 1fr))`; `min-width: 0` on
   each lane; `.home3-item` keeps the HOME2-c clamp; long tokens (`no_linked_person`, `in_pipeline_untouched`) wrap or
   truncate with a title attribute — never overflow.
2. **Right answer:** a container query on the TODAY card (`container-type: inline-size`): **one column, lanes stacked in
   the order RESEARCH → BD → INBOX, top 5 each** while the card is under ~900 px; three columns at or above. No JS
   measurement. If a container query is off the table for a browser Scott uses (Edge desktop app + Chrome — both support
   it), fall back to `@media` on the viewport and say so.
3. **Flag OFF** → byte-identical to today (assert in the test, as HOME2-c did).
4. **Tests:** extend `test/home2-three-lanes.test.mjs` — no inline `grid-template-columns` on the widget, the `minmax` rule
   present, the container rule present, flag-off untouched.
5. **Proof in the response:** after merge + Railway redeploy, a screenshot of Home on Railway with the flag ON at a laptop
   width showing all three lane headers inside the card, and the computed `gridTemplateColumns` of the widget grid. A local
   static serve is not proof (HOME2-c's was, and it missed this).

⛔ Do not touch IMPORTANT / URGENT markup. ⛔ Do not dedupe or filter lane contents (that is SIDEBAR2/3). ⛔ STATUS heading
**`Round <this prompt's round>-CC (CC)`**, never a bare Cowork number; entry written before the PR.

**Parked:** one line each.
