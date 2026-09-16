# DIA1 — Dialysis Overview: which action items are human, a button that does nothing, and tiles that disagree with the database

**Filed:** 2026-09-16 (Cowork) from `docs/claude-code/SB notes/LCC app notes - Sept 12.docx` §4.
Triage rows **SBN-6, SBN-7, SBN-8**. Two fixes (§B, §C) and one measured recommendation (§A).
**Read first:** `dialysis.js` (overview render ~2280; `_diaMarketEconomicsExhibit` at 1744;
`renderDiaPortfolioGlanceInner`); `docs/os/CURRENT-STATE.md` § "Salesforce research lanes" and the
2026-09-16 section; `CLAUDE.md` → "Assert on the right output".

## Scott's words

> Review each of those action items in the top section. Are all of those action items items that
> require human in the loop review? Can some or all of them be automated? I like the home tab
> opening with the action items at top but I want those items to only be human in the loop items
> that are prioritized by impact and advance the ball forward in the swimlane.
> That Market Economics Exhibit button doesn't do anything. Look into what this is and what should
> be opening here.
> […] the numbers are not automatically matching what's actually in the database for each topic.
> Let's ensure there's a freshness and accuracy with these and if there's some duplication or lack
> of connection between these figures and our database, let's dig in and reconcile the code so
> that there's only one accurate view of each topic that can't be confused.

## §A — the six action items: human, code, or producer noise? (SBN-6)

Screenshot: **159** leases expiring ≤ 6 mo · **212** dialysis properties on market · **14** clinics
removed from CMS inventory · **1,100** NPI signals need review · **88** clinics in property review
queue · **3,119** clinics need lease backfill.

For each: the view/query behind the number (file:line), what a human would *do* with it, and the
verdict — `human` (keep, rank by impact), `code` (a producer should drain it; name the producer or
the missing one), `noise` (a count of a backlog, not an action). Two are already answered by
history and should be checked against it: "NPI signals" and "lease backfill" are producer-shaped
(OWNERGAP1 / the NPI lanes, `v_lcc_research_lane_summary` shows `npi_missing_inventory` 62 open with
141 ever-skipped — the app's 1,100 is a different number; find out why). Recommend the list's
admission rule and the impact ranking key; implement it if it is a predicate change.

## §B — the dead button (SBN-7) — FIX

`dialysis.js:2286` → `onclick="_diaMarketEconomicsExhibit()"` → `dialysis.js:1744` (async; "opens a
Northmarq-branded report … scale curve, operator benchmark vs 10-K, value crosswalk"). Reproduce: open
DevTools, click, capture the console and network. Expected causes, in order of likelihood: the
handler awaits an endpoint that 404s/500s on Railway (a route that exists in the repo but not on the
deployed SHA — `CLAUDE.md` → "'Merged' is not 'running'"), a thrown error swallowed by the async
handler with no user-facing toast, or `window._diaMarketEconomicsExhibit` shadowed. Fix the cause;
**also fix the silence** — a button whose async handler fails must say so (the app's error hook
`lccReportError` + a visible toast). Test: the handler surfaces an error when its endpoint fails
(mock), and the endpoint returns the exhibit for one real operator.

## §C — tiles vs. database (SBN-8) — FIX: one source per number

Measured 2026-09-16 on Dialysis_DB (`zqzrriwuavgrquhisnoa`):

| tile | shows | live | note |
|---|---:|---:|---|
| Total properties | 11,804 | **11,826** `count(*) properties` | stale by 22 |
| … with size data | 8,607 | **8,629** `building_size IS NOT NULL` | stale by 22 |
| Operators tracked | 45 | **21** `count(distinct operator_id)` on properties | different definition, not staleness |

So the tiles are (a) computed from a snapshot that lags the tables and (b) at least one counts a
different thing than its caption says. For **every** tile on the Overview (Portfolio at a Glance:
9 tiles; Lease Expiration Risk: 5), produce: caption · the query the tile runs today (file:line;
`v_portfolio_summary` / `dashboards` / client-side aggregation) · the live value of that query ·
the value of the query the caption *claims* · match? Then make each tile read **one named view**
whose definition is the caption (add the SQL to the view's `COMMENT`), refreshed on load or with a
visible "as of" timestamp when it is a materialized snapshot. A test per tile that the view's
definition contains the caption's predicate (positive control: change the predicate, test fails).
⛔ Do not "fix" a number by editing the caption to match it — if the caption is wrong, say which
number Scott actually wants and ask.

## Prohibitions

- ⛔ No new aggregation tables; name an existing view or create one view per tile, nothing else.
- ⛔ The action-item list is not rebuilt in this round; §A is a predicate change or a spec.
- ⛔ No touch to gov or LCC Opps.

## Reporting

§A verdict table + rule; §B cause, fix, test, and the exhibit rendering for one operator; §C the
14-row tile table before/after with the view names. If any step was skipped, say so.
