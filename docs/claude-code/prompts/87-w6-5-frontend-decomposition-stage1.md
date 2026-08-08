# Prompt 87 — W6.5 front-end decomposition, STAGE 1 (module seams + extraction of one route)

**Grounding:** `LCC_Audit_Rollout_Plan.md` §W6.5. The SPA monoliths — `detail.js` (~879KB),
`app.js` (~643KB), `ops.js` (now larger after W8) — are the riskiest edit surface in the repo:
this week alone we made ~10 surgical edits into ops.js, each a truncation hazard. W6.5 is the
highest-value Wave 6 unit. **Do this STAGED — this prompt is Stage 1 only.** Behavior must be
byte-identical; no feature changes ride along.

## Do (Stage 1)

1. **Seam inventory first:** map each monolith's internal regions (routes/tabs/lane renderers/
   helpers) and their cross-references; write the findings to
   `docs/architecture/w6-5-frontend-decomposition-map.md` with the staged extraction plan
   (which region → which module, ordered by lowest coupling first).
2. **Build the module loading seam** that Railway/Express static serving supports WITHOUT a
   bundler (ES modules via `<script type="module">` or an explicit concat manifest — pick what the
   current index.html/serving model tolerates; document the choice). Hash-routing and load order
   must be preserved.
3. **Extract exactly ONE low-coupling region as proof:** recommend the Decision Center federated
   lane meta/renderers from ops.js (`_DC_FEDERATED`, `_DC_FED_META`, `_fedCardHTML` branches +
   lane helpers) into `public/js/dc-lanes.js` (or the repo's equivalent path) — it's the region
   the W8 campaign touched most and the 75 structural guard already tests it.
4. **Guards:** the 75 lane-wiring test + DC partition test must pass unchanged against the new
   layout (update file paths in tests, not assertions); add a load-order smoke test; `npm run
   verify:deploy` unaffected.
5. Stage 2+ (separate prompts, per the map doc): detail.js by tab, app.js by route.

Acceptance: app boots identically (hash routes, DC lanes render, one full verdict works), one
region extracted, map doc committed, guards green. Commit with the repo trailer.
