# Archived STATUS.md span — 2026-09-12 (thirteenth span)

Moved verbatim from `docs/claude-code/STATUS.md` on 2026-09-14 to restore line-budget headroom
(`test/status-line-budget.test.mjs`, ≤2,500 lines). Nothing was dropped; every still-open item this
span named is tracked in `docs/os/PLANNED-BACKLOG.md`.

---

## 2026-09-12 — HP1 P0 reconciled: the Today 500 is fixed, DEPLOYED and verified — and the "See all (N)" badge was never honest

Filed `responses/HP1 desktop response.docx` → `done/`; prompt → `prompts/done/`. **PR #2358 merged
(`42158f17`) and LIVE — `/version` reads `42158f174956`** (probed from LCC Opps via `net.http_get`,
the sandbox-reachable route), so this one is *running*, not merely merged.

**What shipped, verified live in the merged source rather than from the response:** `Promise.all` →
**`Promise.allSettled`** with a `settledQueryResult()` mapper (1b); explicit **`timeoutMs: 20000`** on
the seller-prospect read and 12 s on the other three ops calls (1a); **`countMode` `'exact'` →
`'estimated'`** on all four (1c); and a real per-lane failure state (1e) — `today-sections.js` now
returns **`source_error`** per section, `app.js` renders *"This section is unavailable right now"*
instead of the blanket "Today unavailable — HTTP 500", and `assembleTodaySections` folds a
per-request degradation note into the existing **`named_gaps`** contract reading *"Section shown
empty, not exhausted."* That last distinction is the whole point: before this, a lane whose source
died rendered **"Nothing here right now. ✓"** — a green checkmark over a failure. CC also found and
wrapped a **seventh** previously-unguarded `opsQuery` in the same handler (the entity-name lookup),
which the brief had not named. Guard `test/today-sections-degraded-source.test.mjs` asserts a thrown
source empties exactly its own lane, leaves the other two intact, and the endpoint returns **200**;
full suite 6,013 pass / 0 fail / 6 skipped.

🔴 **NEW FINDING, mine, found while reconciling — `total_open` is the CAPPED PAGE LENGTH, not the
population, and two of the three "See all (N) →" badges under-report.** Every section returns
`total_open: all.length` (`today-sections.js:79/103/182`) where `all` is the rows the query
returned — and every source query carries **`limit=200`**. Measured live 2026-09-12:

| lane | badge reads | true population | honest? |
|---|---:|---:|---|
| Significant (`v_lcc_seller_prospect_queue`) | **200** | **517** | ❌ under-reports 61% |
| Urgent (`v_lcc_bd_worklist` contact_writeback half) | **≤200** | **1,587** | ❌ under-reports 87% |
| Important (`bd_opportunities` open) | 50 | 50 | ✅ (below the cap) |

**The module's own header promises the opposite** — *"`total_open` (the full population, for the
'See all →' link)"* — and cites **P159a**, the rule that a rendered count and a population must be
two distinct numbers and never blended. It is the honest-counts rule (Consumption Layer §5) failing
inside the module written to enforce it. **Be precise about the blast radius: the RANKING is not
affected.** Each query is `order=rank_value.desc` before the `limit=200`, so the eight rows rendered
really are the top eight; only the badge lies.

⚠️ **And this corrects my own filing, in place.** HP1's 1c said *"the only consumer of `total_open`
is the 'See all (N) →' button text"*, which implies the PostgREST header count fed it. **It never
did** — CC checked and reported correctly that `.count` is read nowhere in the handler, which is
exactly why the downgrade to `'estimated'` was safe. What that check actually exposed is that the
exact `COUNT(*)` we were paying ~750–800 ms for on every page load was **pure waste**, and the badge
has been wrong since UX-T1a-today shipped. **Re-enabling `count=exact` is NOT the fix** — an
estimated planner count over one of these views is the documented ~58× trap, and an exact one
re-imposes the cost 1c just removed. Filed as **HP1-badge**: either a cheap dedicated count-only
read, or render the badge as *"top 200"* and stop claiming a total. 👤 A count nobody can afford to
compute may simply not belong on the card.

**1d re-measured and correctly NOT built.** Post-1c the 200-row page is **~1.2 s warm** and the
separate exact COUNT that 1c removed was **~0.8 s** (my own pre-fix measurement was 815 ms + 750 ms;
wall-clock on this box moves 2–4× between sessions, so read the structural facts, not the
milliseconds). The structural cost is untouched — seq scans on `entities` / `lcc_property_attributes`
/ `lcc_entity_portfolio_facts` plus the `activity_events` subplan at `loops=1518` — so the
materialized-view question stays open as **HP1-1d** rather than being taken on a number that moved.

**Still open, unchanged:** **P1** (deal-backbone freshness + the deal-status confirmation lane) is
held 👤 pending Scott's determination of whether the frozen transaction stages are a Salesforce
hygiene gap or a Power Automate scope gap — *do not assume*. **P2** (Inbox routing/ranking, My Work
re-rank onto the shared function) untouched. The 12 s front-end race in `renderTodaySections` was
correctly left alone.

⚠️ **Deploy note:** the doctrine is *redeploy BOTH Railway services*. `tranquil-delight` is confirmed
on `42158f17` and serves this endpoint and `app.js`; the standalone MCP service does not serve
`today_sections`, so the surface is fixed either way — but confirm the MCP redeploy before assuming
any other engine change in the same merge is live.

**Next:** HP1-badge (smallest, and it is an honest-counts defect on an operator surface), then P2's
inbox routing. P1 stays 👤-blocked.
## 2026-09-12 — PR-scanner-3 shipped: `county_records_needed`, the sixth ownership-history-lane action

Re-measured live before building (unchanged from the 2026-09-12 sizing already in `PLANNED-BACKLOG.md`):
of gov's 68 `human_actionable` `mismatch`/`all_guarded` tasks in `v_lcc_ownership_history_lane_split`,
27 (40%) carry no trustworthy `parcel_records`/`tax_records`/`deed_records` on file; fleet-wide (254
tasks) it is 126 (49.6%). The spec's `ai_gpt4o_presumed` model-leg label does not exist as a literal in
gov's tables — the live tag is `ai_recall_gpt` (11 deed / 23 parcel / 14 tax rows), used instead.
Shipped as a RECLASSIFICATION inside the existing split (mirroring A3's `sponsor_spe` precedent) rather
than a new lane/table. Cross-database constraint (the view is on LCC Opps, the source tables on the gov
project) solved with a small mirror table (`lcc_gov_property_record_coverage`) synced by
`api/_shared/gov-property-record-coverage.js`; the SQL CASE in the view stays the single owner of the
classification, and an unsynced property (`IS FALSE`, never `= false`) is left at its base action —
never guessed into the reclassification on an absence of information. Reuses B1's existing
`lcc_chain_human_value_floor()` unchanged.

Predicted-vs-actual delta was **exact**: `mismatch` 192→101, `all_guarded` 62→27,
`county_records_needed` 0→126, `human_actionable` held at 68 (split 37/4/27), `agrees`/`sponsor_spe`
untouched. Wired the first live consumer of PR-scanner-5's previously-unwired `/api/recorder-portal`
route: a "County portal →" button on these cards (`researchOpenCountyPortal`, `ops.js`).

Migration `supabase/migrations/20260912150000_lcc_pr_scanner3_county_records_needed_action.sql`
(applied live to LCC Opps + coverage table seeded for today's 254-property population). Guards:
`test/ownership-lane-split.test.mjs` (6 new/updated assertions) + `test/gov-property-record-coverage.test.mjs`
(7 behavioural tests, injected deps). Full suite: 6,022 pass / 0 fail (6 pre-existing skips, unrelated).

**Not done — an operator/scheduling step:** `syncGovPropertyRecordCoverageForOwnershipLane()` is not
yet wired to a cron; today's mirror was seeded once against the live population this measurement
covers. As PR-scanner-1/2's capture writers get adopted (still 0 rows on either domain per the
2026-09-12 research-workbench.md §7c note), the mirror needs a periodic re-sync to stay current.
Docs updated in the same change: `PLANNED-BACKLOG.md` (row `PR-scanner-3`), `research-workbench.md`
§7d, `ownership-history-lane.md` §5.
## 2026-09-12 — ID2b partially shipped: market brief's operator-count source switched to `operator_id`; comps/CM/dossier measured and deferred

Executed `prompts/ID2b-consumer-switch-to-operator-id.md`. **Re-measured the population first: the real grep hit is
96 views, not 45** — most are review/audit queues where raw operator text IS the deliverable (switching would hide
the ambiguity they surface), correctly left alone. **Shipped:** `v_market_brief_cms_operator_counts` (the market
brief's only CMS-operator-count source) now groups on `properties.operator_id` (survivor-resolved via
`dia_operator_survivor`), fill-blanks fallback to raw text for the 14.7% of clinics with no resolved operator.
Measured live: row-count parity 6,695→6,695, `Satellite Healthcare`(54)+`Satellite Dialysis`(14)→one bucket of 69.
`market-brief-facts.js` needed no code change — it was already agnostic to the grouping key, so it is unblocked.
Migration `supabase/migrations/dialysis/20260912120000_dia_id2b_market_brief_operator_id.sql`; guard
`test/id2b-consumer-operator-id.test.mjs` (6 tests, incl. a repo-wide class guard against a NEW module grouping on
raw operator text). Full suite 6,017/0/6-skipped.

**Deferred, named, not silently declared done** (per the prompt's own "ship the highest-value subset, name the
rest" instruction): `mcp/comps-tools.js` fuzzy comp SELECTION (`operatorTier`/`tenantMatches`) was read — its
substring filter already tolerates most alias variance, but the required 5-subject live comp-set before/after diff
was NOT run (needs a live MCP tick invocation this session's budget didn't reach) — filed **ID2b-c**, Scott's call.
`cm_dialysis_operator_unit_economics`/`v_dia_econ_operator_benchmark` already ILIKE-bucket via `dia_operator_bucket()`
(so the exact Fresenius/DaVita string split mostly doesn't occur there today, but it's a heuristic, not the
registry); `cm_dialysis_available_by_tenant[_q]` and `cm_dialysis_industry_participants` still group on raw/
precomputed text — filed **ID2b-cm**. `dossier-generator.js`/`rent-projection.js`/`team-context.js`/
`sidebar-pipeline.js` and the ~85 remaining views not read this round — filed **ID2b-remaining**/**ID2b-mods**.
Full report: `docs/audits/ID2b_OPERATOR_ID_CONSUMER_SWITCH_2026-09-12.md`. Branch `claude/dreamy-pascal-i97j44`.


