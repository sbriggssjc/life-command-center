# DIA1 / DIA1b — Dialysis Overview tile audit, NPI tile fix, "as of" freshness

**Filed:** 2026-09-16. Continuation of `docs/claude-code/prompts/done/DIA1-overview-action-items-dead-button-and-tiles-that-disagree-with-the-db.md`
and `docs/claude-code/prompts/DIA1b-npi-tile-as-of-stamp-and-the-operators-tile-that-counts-something-else.md`.
DIA1's own session report was written to a `/tmp` scratchpad that no longer exists; this file
re-derives what is needed from the live database (`Dialysis_DB`, `zqzrriwuavgrquhisnoa`) and the
gated research lane (`LCC Opps`, `xengecqvemvfknjvbvrq`) rather than trusting the lost report's
numbers. All live values below were queried directly against those two projects on 2026-09-16 —
none are carried over unverified from the earlier prompt files.

**Read first:** `dialysis.js` — `renderDiaOverview()` (the actual Overview-tab render function),
`renderDiaActionItemsInner()` (Action Items list), `renderDiaPortfolioGlanceInner()` /
`renderDiaLeaseExpRiskInner()` / `renderDiaBreakdownInner()` (the MV-backed value-first blocks),
`loadDiaData()` (the data loader).

---

## What was fixed in this pass

1. **NPI tile — points at the gated lane, not the raw diff.** Both places the NPI count renders
   (`renderDiaActionItemsInner`'s Action Item, and the "NPI Signals" info card inside
   `renderDiaOverview`) now show `diaData.npiLaneOpen` (the sum of `open_tasks` for
   `npi_missing_inventory` + `npi_new_registration` on LCC Opps'
   `v_lcc_research_lane_summary`, read via the **existing** `GET /api/queue?view=research_lanes`
   sub-route — no new view, no new table) when that cross-project fetch succeeds. The raw
   diff-minus-auto-resolved count is kept as an explicit secondary line, labelled
   `"raw signals (not all actionable)"`, never silently dropped. If the lane fetch fails, the
   display falls back to the raw count **and says so** (`"raw — lane count unavailable"`) rather
   than looking like a real lane count.
2. **"As of" timestamp on the two MV-backed sections.** `mv_dia_overview_stats` already carries a
   `computed_at` column (stamped by the daily 01:00 UTC refresh cron `dia-refresh-overview-stats`)
   that nothing rendered. `_diaMvAsOfLabel()` / `_diaMvAsOfLine()` surface it at the top of
   **Portfolio at a Glance** and **Lease Expiration Risk**. No migration was needed — the timestamp
   already existed; it just wasn't shown.
3. **Operators Tracked — labelled, not "corrected".** The caption now reads *"distinct operator
   NAMES (raw text, not canonicalized)"* instead of the unqualified *"distinct operators"*. The
   number itself (45) is unchanged — see the dedicated section below for what 45 and 21 each mean,
   and the explicit statement that neither was picked as "the" right answer.
4. **Lease backfill — relabelled as a raw backlog.** Both places it renders now say
   *"raw backlog, not ranked/actionable"* rather than *"need lease backfill"* (which reads as a
   directive). See the consumer analysis below — a capture path exists and is essentially unused.
5. Test: `test/dia1b-npi-lane-and-mv-freshness.test.mjs` (11 assertions, comment-stripped,
   brace-balanced function-span source assertions per this repo's `uxt0-defect-sweep.test.mjs`
   convention) pins all four of the above.

**Not touched in this pass, and explicitly out of scope:**
- gov, LCC-Opps-owned tables/views (read-only cross-project reads for the NPI lane count are the
  one exception, per DIA1b's own instructions — that's the existing gated-lane pattern).
- §B (the dead Market Economics Exhibit button) — DIA1's prompt file records this as **already
  fixed and live**: the deployed `data-query` edge function was v41 (July) and 403'd every
  `v_dia_econ_*` view; it was redeployed to v43, and the handler now surfaces a real error via
  `lccReportError` instead of failing silently. Not re-verified here (would require a live
  Railway/browser session); the source guard (`_diaMarketEconomicsExhibit`'s `lccReportError` call
  on a fetch failure) is visible in `dialysis.js` and unchanged by this pass.
- The dynamic sub-sections inside `renderDiaOverview()` that are NOT fixed-count info-card grids —
  **Clinic Financial Estimates**, **Ownership Coverage**, **Listings Needing Confirmation**, and
  **LLC Research Queue** each render a variable number of rows/cards from their own inner-renderer
  functions. They are named in the tile table below with their source view and a live spot-check,
  but were not audited field-by-field against every rendered sub-card — flagged explicitly as
  **not fully verified**, not silently skipped.

---

## §A — the six original action items: human, code, or noise?

Reconstructed from DIA1's prompt file (`docs/claude-code/prompts/done/DIA1-....md` §A) plus this
session's own measurement, since the original response was lost.

| # | item (screenshot count) | live value (2026-09-16) | source | verdict | why |
|---|---|---:|---|---|---|
| 1 | 159 leases expiring ≤ 6 mo | **157** (`mv.exp_lease_lt_6mo`) | `mv_dia_overview_stats` | **human** | Renewal/sale-leaseback timing is a judgement call on WHICH owner to prioritize outreach to — no rule can rank that; keep, rank by rent/value. |
| 2 | 212 dialysis properties on market | not re-measured this session (see UX10 note below) | `v_dia_on_market` via `diaData.onMarketRows` | **human** | Acquisition targets / competitive positioning — a human decides whether/how to act on a specific listing. Already fixed once (UX10, 2026-09-02) to read the canonical set instead of the broader lifecycle-flag view; unchanged here. |
| 3 | 14 clinics removed from CMS inventory | **14** (`v_clinic_inventory_diff_summary`, `change_type='removed'`) | matches live exactly | **human** | A removal can mean closure, acquisition, or a data error — needs a person to look at the specific clinic and decide "check for acquisition/disposition." |
| 4 | 1,100 NPI signals need review | **raw**: 1,445 (931 dup + 510 missing + 4 new) minus 426 auto-resolvable = **1,019** ≈ "~1,100" (moved slightly since DIA1); **gated lane open**: **81** (62 `npi_missing_inventory` + 19 `npi_new_registration`) | `v_npi_inventory_signal_summary` (dia) vs `v_lcc_research_lane_summary` (LCC Opps) | **code, mostly** | See the NPI section below — 426 of the raw count auto-resolves already (a code path exists); 931 `duplicate_inventory_npi` route to a Decision-Center dedup lane per CLAUDE.md W5.2, not this research lane at all; the residual 81 IS the human-actionable slice, and the lane itself marks it `answerable=false` (P181 decidability gate) — worth a second look at whether even those 81 are answerable by a human today. |
| 5 | 88 clinics in property review queue | **86** true count (well under the 200-row page cap, so the tile's count is exact, not a capped artifact) | `v_clinic_property_link_review_queue` | **human** | Matching a clinic to a property record needs a person to confirm an ambiguous or missing address match — genuinely unautomatable without risking a wrong link. |
| 6 | 3,119 clinics need lease backfill | **3,119** (`v_clinic_lease_backfill_summary`, matches exactly) | `v_clinic_lease_backfill_candidates` / `_summary` | **noise (today)** | See the lease-backfill section below — a real capture path exists (Research tab → mark-reviewed), but it recorded exactly **26** completions, **all on one timestamp (2026-04-29 14:06:47 UTC)**, and **0 since** — a one-time bulk pass, not an in-use human workflow. Presented count now demoted to "raw backlog" (this pass); recommend it either gets a working consumer (auto-retire on properties that later get a lease from another source, value-ranking by rent) or is dropped from the visible tile grid entirely. |

**Admission rule going forward (recommended, not yet implemented as a predicate change):** an item
belongs on the visible Action Items list only if (a) a human can take one specific, describable
action on it (call, review, confirm — not just "look at a number"), and (b) the underlying producer
either has a working auto-retire/consumer loop OR is small enough that a human can plausibly clear
it. Item 6 fails (b) today; item 4's raw count fails both until it is re-pointed at the lane (fixed
in this pass) — the LANE's own 81 still needs a decidability check before being called "clean."

---

## §B — the Market Economics Exhibit button

Per DIA1's own prompt file: **fixed and live.** The deployed `data-query` edge function had drifted
to v41 (July) while the repo's `v_dia_econ_*` views were added later, so every fetch 403'd; it was
redeployed (v43) and `_diaMarketEconomicsExhibit()` now calls `lccReportError()` with a specific
`userMessage` on a fetch failure instead of failing silently. Confirmed present in the current
source (unchanged by this pass, `dialysis.js` around the `_diaMarketEconomicsExhibit` function) —
not independently re-verified against a live browser session in this pass.

---

## §C — full tile table

**Scope note:** `renderDiaOverview()` is the single function that renders the Overview tab. It is
larger than the 14 tiles DIA1 originally scoped (Portfolio at a Glance × 9 + Lease Expiration Risk
× 5) — it also renders a "Data Health" grid, "Clinical Metrics" cards, and several dynamic
sub-sections. The table below covers every **fixed-count info-card tile** (25 of them) plus the
dynamic sections by name/source, with a match column that is `n/a` where "match" isn't a
meaningful question (e.g. a bar chart, a variable-row queue).

### Portfolio at a Glance (9 tiles) — `renderDiaPortfolioGlanceInner()`, reads `mv_dia_overview_stats`

| caption | query behind it | live value | value MV/caption claims | match |
|---|---|---:|---:|---|
| Total Properties | `count(*)` over `v_property_attributes_portfolio` (in the MV's `base` CTE) | live `count(*) from properties` = **11,826** | MV `total_properties` = **11,825** | **no — off by 1**, MV refreshed 2026-09-16 01:00 UTC and one property was added since. This is exactly the lag the new "as of" stamp now surfaces; not a bug, a documented staleness window. |
| Total SF | `sum(building_size)` where `>0` | not independently re-measured (would require re-running the MV's exact SF filter against `properties`) | MV `total_sf` = 207,481,122 sq ft (8,628 properties with SF) | n/a — no live re-derivation this pass; same staleness window as above applies |
| Projected Annual Rent | `sum(annual_rent)` projected to current date via `dia_project_rent_at_date` | not independently re-derived (requires replaying the projection function) | MV `total_rent` = $928,312,088 (4,156 properties with rent) | n/a — trust the MV's own projection logic, not re-audited here |
| Avg Rent / SF | `avg(rent/building_size)` where both present | derived from the two figures above | MV `avg_rent_psf` = $27.54 | n/a — arithmetic consistency only |
| **Operators Tracked** | `count(distinct operator)` on `v_property_attributes_portfolio` (`properties.operator`, free text, trimmed) | live `count(distinct operator)` = **45** (matches) | vs `count(distinct operator_id)` = **21** on the same table (a DIFFERENT column — the ID2 canonical operator registry) | **see dedicated section below — flagged for Scott's decision, not "fixed"** |
| Net Rent ≈ NOI | `= total_rent` (dia is NNN) | same as Projected Annual Rent | | n/a |
| Avg Net Rent / Property | `total_noi / total_properties` | derived | | n/a |
| CMS Clinics | `count(distinct medicare_id)` on `medicare_clinics` | live = **8,547** (matches `v_counts_freshness.total_clinics`) | MV `cms_clinics` = **8,547** | **yes** |
| Contacts | `count(*)` on `contacts` | not independently re-measured | MV `total_contacts` = 6,541 | n/a |

### Lease Expiration Risk (5 tiles) — `renderDiaLeaseExpRiskInner()`, same MV

| caption | query | live/MV value | match |
|---|---|---:|---|
| Expiring < 6 Months | `count(*)` where lease_expiration in `[today, today+6mo)` | 157 | n/a — internally consistent with the MV, not independently re-derived against `leases` this pass |
| Expiring < 1 Year | same, `<1yr` | 306 | n/a |
| Expired / Holdover | `< today` | 2,721 (2,452 stale >1yr) | n/a |
| 2–5 Year Term | `[2yr, 5yr)` | 637 | n/a |
| 5+ Year Term | `>= 5yr` | 679 | n/a |

All five now carry the shared "as of" stamp from `_diaMvAsOfLine(mv)` — the whole section shares
one refresh timestamp, since all five come from one MV row.

### Data Health (4 tiles) — inline in `renderDiaOverview()`, reads `v_counts_freshness` + `_diaLeaseCoverage()`

| caption | query | live value | caption claims | match |
|---|---|---:|---:|---|
| Total Clinics | `v_counts_freshness.total_clinics` | **8,547** | 8,547 | **yes** |
| Data Coverage | `clinics_with_counts / total_clinics` | 7,521 / 8,547 = **88.0%** | 88.00% | **yes** |
| Property Linked | `(total_clinics − propQueueLen) / total_clinics` | (8,547 − 86) / 8,547 = **99.0%** | — | **n/a — internally consistent, live-measured this pass** |
| Lease Coverage | `properties_with_rent / total_properties` (via `_diaLeaseCoverage()`) | 4,156 / 11,825 = **35.2%** (MV) | matches MV | **yes, subject to the same MV-lag note as Portfolio at a Glance** |

### Clinical Metrics (3 fixed cards + dynamic patient-metrics sub-block)

| caption | query | live value | caption claims | match |
|---|---|---:|---:|---|
| Inventory Changes | `added.clinic_count + removed.clinic_count` from `v_clinic_inventory_diff_summary` | 17 + 14 = **31** | "+17 added · -14 removed" | **yes, exact** |
| NPI Signals | see NPI section below | **fixed this pass** (was raw diff, now gated lane, 81, with raw kept as labelled secondary) | — | **fixed** |
| Top Mover | `v_facility_patient_counts_mom`, `delta_patients > 0` | **0 rows** (up) and **0 rows** (down) currently — CMS has not published a new patient-count period since the last one loaded | renders the honest "no new CMS reporting period" empty-state (existing, correct code path) | **yes — correctly empty, not a bug** |
| Clinics Reporting (`renderPatientMetricsInner`, dynamic) | `diaPatientCounts` (client-loaded) | not independently re-measured this pass (dynamic sub-renderer, out of scope per the scope note above) | — | **not verified** |

### Research Pipeline (4 tiles) — inline in `renderDiaOverview()`

| caption | query | live value | caption claims | match |
|---|---|---:|---:|---|
| Property Queue | `v_clinic_property_link_review_queue` (capped at 200) | true count = **86**, well under the 200-row page cap | page length = 86 | **yes — the cap does not bite here** |
| Lease Backfill | `v_clinic_lease_backfill_summary` (sum of priority buckets) | **3,119**, matches exactly | 3,119 | **yes — but see the relabelling above; the number is accurate, the framing as "actionable" was not** |
| Completed Reviews | `research_queue_outcomes` count=exact | true count = **1,197** | rendered from `diaData.researchOutcomesCount` (count=exact probe) | **yes, assuming the probe landed** — not independently re-checked against the client's exact runtime value this pass, but the exact-count query matches the documented mechanism |
| Last Ingestion | `v_ingestion_reconciliation`, most recent row | `run_status='partial'`, started 2026-08-31 18:30 UTC, `error_log='Failed steps: run_timeout'` | rendered date + status | **yes — and note the status is itself informative**: the most recent CMS ingestion run partially failed on a timeout, which is a separate, real finding (not part of this task's scope, but worth a follow-up: `docs/architecture/producer-health-and-ci-enforcement.md` and the CMS-ingestion sections of the Dialysis repo's `CLAUDE.md` already document a documented history of this exact pipeline stalling silently — this run is `partial`, not silent, so the existing reconciliation gap tracking (`reconciliation_gap=0, gap_pct=0.0`) did its job) |

### Dynamic sections — named, not exhaustively audited (out of scope, stated per DIA1b's own prohibition against skipping silently)

| section | source | why not fully audited |
|---|---|---|
| Clinic Financial Estimates | `renderFinancialMetricsInner()` | renders a variable set of derived-model cards (revenue/profit/EBITDA); auditing every sub-figure against `dialysis_econ_reconciled_v1` duplicates the existing, extensive verification already documented in `docs/architecture/dialysis-economics-and-medicare-data.md` — out of scope for a tile-caption audit |
| Ownership Coverage | `_diaOwnershipCoverageCards()`, reads `diaData.ownershipCoverage` (`v_ownership_coverage`) + `diaData.unprospectedCount` (`v_prospect_targets`, count=exact) | single-row view + one count=exact probe — spot-checkable but not done this pass for time |
| Listings Needing Confirmation | `_diaListingConfirmTiles()`, reads `v_listings_needing_manual_confirmation` | variable-row list, not a fixed KPI tile |
| LLC Research Queue | `_diaLlcTiles()`, reads `v_llc_research_queue_health` | variable-row list, not a fixed KPI tile |

---

## The Operators Tracked discrepancy — 45 vs 21, and what each one counts

**This is not resolved here and is not silently "fixed" by rewording the caption to whichever
number seemed right.** Both numbers are real, live, and measured on the same table, on different
columns:

| number | query | what it counts |
|---|---|---|
| **45** | `select count(distinct operator) from properties` (also what `mv_dia_overview_stats.operators_tracked` computes, over `v_property_attributes_portfolio.operator`) | distinct **free-text operator name strings**. This field is populated by whatever ingestion/capture path wrote it, unnormalized. |
| **21** | `select count(distinct operator_id) from properties` | distinct rows in the canonical **operator registry** (`operators` table, 67 rows total — the registry itself carries more entries than are currently referenced by a live property, e.g. aliases/inactive operators), resolved via `properties.operator_id` — the post-ID2 (`docs/claude-code/prompts/done/ID2b-consumer-switch-to-operator-id.md`) canonical join. |

**Live proof the 45 is a name-splitting artifact, not 45 real operators:** the MV's own
`top_operators_by_count` payload (queried live) shows, among others:

- `"Fresenius"` (3,733 properties) and `"Fresenius Medical Care"` (36 properties) as two separate
  entries
- `"US Renal Care, Inc."` (418 properties) and `"US Renal Care"` (47 properties) as two separate
  entries

These are the exact operator-name-split cases this repo's own `CLAUDE.md` documents under the
**ID1** backlog item (*"'Fresenius' vs 'Fresenius Medical Care' in the market brief traced back to
free-text `dia.properties.operator`, a duplicated `operators` registry, and two conflicting
'canonical' spellings"*) and the broader **"TRUTH IS FIXED AT ITS SOURCE OF RECORD"** doctrine. This
tile is a second, previously-unflagged instance of that same underlying defect class, on the
Overview page rather than the market brief.

**What was done here:** the tile's sub-label now reads *"distinct operator NAMES (raw text, not
canonicalized)"* — an accurate description of what `mv_dia_overview_stats.operators_tracked`
actually computes, not a claim that 45 is the "true" operator count. **Nothing was changed to make
45 read as 21 or vice versa.** The decision Scott needs to make: should this tile switch to
`count(distinct operator_id)` (the canonical count, 21, but excludes any property whose
`operator_id` is still unresolved/NULL — worth checking that population before switching), or stay
on the raw-text count with the corrected label (honest about the number's real meaning, but still
overstates distinct real-world operators)? Measured: `count(*) where operator_id is null and operator is not null` = **878 properties** —
these carry a real operator NAME but no resolved canonical ID, so a bare switch to
`count(distinct operator_id)` would not just shrink 45→21 for the right reason, it would also
silently drop these 878 properties' operators out of every rollup that joins on `operator_id`
(the top-operators bars, any operator-scoped rent total, etc.) unless those 878 are resolved or
counted separately first.

---

## NPI tile — the raw diff vs the gated lane

**Raw diff** (`v_npi_inventory_signal_summary`, dia):

| signal_type | signal_count | auto_resolvable_count |
|---|---:|---:|
| duplicate_inventory_npi | 931 | 426 |
| missing_inventory_npi | 510 | 0 |
| new_npi | 4 | 0 |
| **total** | **1,445** | **426** |

`npiSignalCount − npiAutoResolvable` = 1,445 − 426 = **1,019** — this is what the tile showed before
this fix (DIA1 measured it at ~1,100; it moved slightly as the underlying diff view updates day to
day, which is itself further evidence this number was never a stable "actionable" count).

**Gated lane** (`v_lcc_research_lane_summary`, LCC Opps):

| research_type | open_tasks | ever_completed | ever_skipped | answerable |
|---|---:|---:|---:|---|
| npi_missing_inventory | 62 | 0 | 141 | **false** |
| npi_new_registration | 19 | 0 | 0 | **false** |
| **total** | **81** | | | |

Two things worth carrying forward, beyond the headline fix:

1. **The 931 `duplicate_inventory_npi` signals never reach this lane at all.** Per this repo's
   `CLAUDE.md` (W5.2, 2026-08-05), duplicate-NPI signals route to a **Decision Center** dedup lane
   (`npi_dedup_review` for genuine conflicts, `npi_dedup_autoapprove` for the 426 auto-resolvable
   ones — a human *approves* the deterministic survivor, never a silent auto-collapse), not to a
   `research_tasks` row this view can see. So the raw-diff number was never even measuring one
   pipeline; it was three signal types with three different fates (62+19 human research tasks, 426
   auto-resolvable dedup approvals, ~505 genuine dedup conflicts) added together and presented as
   one "needs review" count. This audit does not re-verify the Decision Center side (out of scope
   for time) but names it so the next person doesn't have to re-discover it.
2. **`answerable: false` on both research_type rows.** Per the P181 decidability-gate doctrine
   already in this repo's `CLAUDE.md` (*"'actionable-only' has two axes — value AND decidability"*),
   a research lane marking itself `answerable=false` means the lane's own worker has judged these
   81 open tasks as **not currently answerable by anyone** (not just "not yet worked"). This fix
   correctly surfaces the gated count (81) instead of the raw diff (1,019) as the primary tile
   value, which is a real improvement — but 81 may still overstate what a human can actually close
   today. Recommend a follow-up: read `v_lcc_research_lane_summary`'s `answerable` semantics against
   the actual per-row escalation confidence (the P181 pattern) before treating 81 as the clean,
   final number either.

---

## Lease backfill — is there a consumer?

**Yes, a capture path exists** — the Research tab lets a human review a lease-backfill candidate and
record an outcome via `research_queue_outcomes` (`queue_type='lease_backfill'`, `status` including
`'verified_lease'`), the same mechanism used for the (actively-used) property-review queue.

**No, it is not meaningfully in use.** Measured live:

```
select status, count(*) from research_queue_outcomes where queue_type='lease_backfill' group by 1;
  → verified_lease: 26

select min(created_at), max(created_at), count(*) from research_queue_outcomes where queue_type='lease_backfill';
  → first = last = 2026-04-29 14:06:47.240132+00, total = 26
```

**All 26 completions share the identical timestamp to the microsecond** — this is a one-time bulk
insert (a backfill of the outcomes table itself, or a scripted seed), not 26 separate human review
sessions. There have been **zero** organic completions in the four and a half months since, against
a backlog of 3,119 (0.8% ever touched, 0% touched recently).

This is the exact shape this repo's `CLAUDE.md` calls out repeatedly: *"a producer with no
consumer"* (Dead-End Playbook class) and *"a one-shot repair of a recurring producer is a chore you
repeat silently forever"* (P176) — except here the "repair" (the 26-row bulk insert) never repeated
even once, and the backlog has grown to 3,119 with the capture UI sitting unused.

**Treatment applied this pass:** per DIA1b's instruction, given no working consumer, the tile now
carries the same demotion as the NPI raw count — relabelled from *"need lease backfill"* (a
directive, implying ranked actionable work) to *"missing lease data (raw backlog)"* /
*"raw backlog, not ranked/actionable"* everywhere it renders. The underlying number (3,119) is
unchanged and accurate as a backlog size; only the framing changed.

**Not done, and recommended as a follow-up, not attempted here (would need a producer decision,
which is explicitly out of scope for a tile-audit pass):** either (a) build a real auto-retire —
close a backlog row automatically when the clinic's property later gets a lease from ANY other
source (deed, OM extraction, sidebar capture), which is likely most of the 3,119 given lease data
flows in from several channels already, or (b) value-rank the queue by rent/deal-size the way the
NPI and owner-contact queues already are, so a human working through it sees the highest-value
clinics first instead of an unranked 3,119-row list nobody has touched.

---

## Verification

```
node --check dialysis.js                                    # syntax
node --test test/dia1b-npi-lane-and-mv-freshness.test.mjs    # 11/11 pass
```

Both run clean. The existing `test/uxt0-defect-sweep.test.mjs` (which also slices
`renderDiaActionItemsInner`) was re-read to confirm this change doesn't collide with its UX10
assertions (it doesn't — UX10 only checks the on-market-listings branch, which this pass didn't
touch).

## What was skipped, stated plainly

- §B (dead button) was not re-verified in a live browser session — relying on DIA1's own prompt
  file recording it as already fixed and shipped, plus the source code visibly matching that
  description.
- The four dynamic sub-sections (Financials, Ownership Coverage, Listings Confirmation, LLC Queue)
  were named with their source views but not audited row-by-row against the live database.
- The `answerable=false` semantics on the NPI lane, and whether the 931 duplicate-NPI signals'
  Decision Center consumer is itself healthy, are named but not measured — flagged as follow-ups.
- No mutation-testing pass was run on the new guard test (this repo's convention for higher-stakes
  guards); the assertions were manually confirmed to fail against the pre-fix source by inspection
  of the diff, not by an automated revert-and-rerun.
