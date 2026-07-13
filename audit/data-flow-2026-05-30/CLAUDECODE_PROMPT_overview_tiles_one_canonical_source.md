# Claude Code (life-command-center) — dia/gov Overview: every snapshot reads ONE canonical source

## Why (grounded live on dia `zqzrriwuavgrquhisnoa` + gov `scknotsqkcheojiaewwh` 2026-07-13)

Scott's goal: all data seamlessly connected and correct no matter where it's
viewed — ONE correct source, not many versions of the same number. The dia (and
gov) Overview snapshot tiles violate this. The **canonical summary/CM views exist
and are fresh, but the Overview tiles ignore them** — they re-derive from raw or
capped detail queries, or fire async loads that never resolve. Grounded counts,
tile-shown vs canonical-truth:

| Tile | Shows | Canonical truth | Source that IS correct |
|---|---|---|---|
| **Lease Backfill** (Research Pipeline) | **1,000** | **3,039** (2,516 high + 274 mod + 249 low) | `v_clinic_lease_backfill_summary.clinic_count` |
| **Completed Reviews** | **1,000** | dia `research_tasks` completed = **10** (1,000 is a capped page of some other log, not a real count) | needs the real count source, not `page.length` |
| **Ownership Coverage** (Ownership Depth / SF Prospecting / Missing SF Link) | stuck **"loading…"** | fresh data ready: `v_ownership_coverage` (as_of today: 12,304 props · 45.7% recorded owner · 83.8% true owner · 14.0% county deed · 0.5% owner-has-SOS · 11.1% true-owner-has-SF) | `v_ownership_coverage` (1-row summary) — the async load never resolves |
| **Listings Needing Confirmation** (Need Confirmation) | stuck **"loading…"** | `v_listings_needing_manual_confirmation` **has an internal LIMIT** (returns exactly 500 — itself capped) | needs an uncapped count |
| **LLC Research Queue** (Queued Owners / Shown) | dots / **"loading"** | `v_llc_research_queue_health` available | the summary view |
| **Property Queue** | 89 | 89 (`v_clinic_property_link_review_queue`) | ✓ correct — this is the pattern to copy |
| **On Market (dia)** | (Overview #) | **184** distinct props (`cm_dialysis_available_market_size_q`, latest quarter, T9d entry/exit/cap truth) | the CM available view |
| **On Market (gov)** | **519** ("active listings on market") | **44** (`cm_gov_available_cap_dot` — the quarterly-report truth) | the CM available view |

### The one root cause (three symptoms)

1. **Counts read a capped detail page, not a summary.** A tile shows `1,000`
   because it counts the length of a `LIMIT 1000` detail query (or a source view
   that itself carries an internal LIMIT — `v_listings_needing_manual_confirmation`
   is capped at 500). The true count lives in an existing `_summary` view.
2. **Async tiles never resolve** — Ownership Coverage / Listings-confirm / LLC
   queue sit on "loading…" forever even though the source view has fresh data. The
   tile's fetch errors or is never awaited/rendered — a connection bug, not
   missing data.
3. **"On Market" has multiple definitions** — the Overview counts raw/loosely-
   filtered `available_listings` (gov 519, or raw 3,059 / off-market-null 580)
   instead of the canonical CM available view the quarterly report uses (gov 44,
   dia 184). Overview ≠ Capital Markets report for the SAME concept.

## Unit 1 — every count tile reads its canonical summary view (never a capped page)

For each Overview snapshot count, read the number from the ONE canonical
summary/count source, not `rows.length` of a paged detail query:
- **Lease Backfill** → `v_clinic_lease_backfill_summary` (sum of `clinic_count`,
  or the total row) = 3,039. (The Action-Items "clinics need lease backfill" tile
  must use the SAME source — today both show 1,000; unify them.)
- **Completed Reviews** → the real completed-count of whatever it tracks (a
  `count(*)` via a count-only query, or a summary view), never a 1,000-capped
  page. Confirm what it's meant to count (dia review outcomes) and read the true
  count.
- **Listings Needing Confirmation** → an **uncapped** count. Either remove the
  `LIMIT` from `v_listings_needing_manual_confirmation` (or add a
  `v_listings_needing_manual_confirmation_summary` count view) so the tile shows
  the true backlog, and page the DETAIL list separately.
- **LLC Research Queue** → `v_llc_research_queue_health` (the summary).
- **Property Queue (89)** is already correct — use it as the reference pattern.
- **Rule:** a snapshot COUNT never equals a query's `LIMIT`. If a tile can show
  the exact ceiling number (500/1,000), it's reading a page, not a count — fix it.

## Unit 2 — fix the stuck "loading" tiles (connection, not data)

Ownership Coverage (3 tiles), Listings-confirm, and LLC Research Queue hang on
"loading…" while their source views have fresh data. Diagnose the fetch:
- The Ownership Coverage tiles should read the single `v_ownership_coverage` row
  (Ownership Depth = `pct_property_has_recorded_owner`/`_true_owner`; SF
  Prospecting = `pct_true_owner_has_salesforce`; Missing SF Link = the inverse /
  the count of true_owners without SF). The data is one row, refreshed today —
  the tile just needs to consume it. Find why the async call errors/never resolves
  (wrong endpoint, missing await, a rejected promise swallowed) and render it.
- Same for Listings-confirm + LLC queue. If a tile genuinely has 0 rows, show
  "0", never a perpetual spinner.
- Add a visible error/empty state so a failed fetch shows "unavailable", not an
  infinite "loading…".

## Unit 3 — ONE canonical "On Market" definition, used everywhere (DECIDED)

Today there are 3-4 "on market" numbers because each surface filters
`available_listings` differently (gov: `is_active`=541, `off_market_date IS
NULL`=580, active+not-off=**519** [Overview], recency-gated=**278**,
re-verified-freshness-gate=**44** [CM report]). That inconsistency is the bug —
Scott wants ONE accurate, live figure everywhere, NOT a frozen report number.

**Decision (Scott, 2026-07-13): the single definition is "active + recent."** A
listing is "currently on market" when:
`is_active = true` AND `off_market_date IS NULL` AND `sale_transaction_id IS NULL`
AND `NOT COALESCE(exclude_from_market_metrics,false)` AND
`COALESCE(on_market_date, listing_date) >= current_date - interval '<N> months'`.
The recency window `<N>` is the ONE tunable knob — default **24 months** (gov ≈
278; dia apply the identical rule). This drops ancient stale listings that quietly
sold/withdrew without the severe undercount of the re-verification gate.

Implement it as **ONE view per domain** — e.g. `v_gov_on_market` /
`v_dia_on_market` (or reuse/repoint an existing one) encoding exactly this rule —
and repoint **every** on-market surface at it: the Overview On Market tile, the
Capital Markets available-listings metric, and the listings tab/count. **No
surface computes its own on-market filter.** It updates live (a listing entering
its recency window or getting `off_market_date`/sold flips the count daily) — that
daily movement is expected; two surfaces showing different numbers is not.

- **dia note:** dia already has the T9d entry/exit/cap model
  (`cm_dialysis_active_listings*`, ~184). Reconcile to the single rule so the dia
  Overview, CM, and listings tab all read ONE dia on-market view with the same
  "active + recent" logic (align the age-out to the shared `<N>`-month knob so dia
  and gov are defined identically). If T9d's model is kept as the dia
  implementation, the Overview + listings tab must read THAT one view — never a
  second raw count.
- **CM report impact:** this changes the gov CM available number (44 → ~278).
  That's intended — the CM report and the Overview must show the SAME on-market
  figure from the SAME view. Update the CM available metric to read the shared
  view too.

## Unit 4 — parity + click-through correctness

- Apply the same source-of-truth fixes to BOTH dia and gov Overviews identically
  (the tiles differ by domain but the "read the canonical summary" rule is shared).
- Verify each tile's **"View Details →"** routes to the correct filtered detail
  list for that exact metric (Lease Backfill → the backfill list; On Market → the
  active listings; Ownership Coverage → the ownership detail) — Scott flagged
  "connecting to the correct data/pages we want to click through to."

## Boundaries / verify

- life-command-center: the Overview render + data-fetch (`dialysis.js` / `gov.js`,
  the tile loaders); the canonical sources are the EXISTING summary/CM views
  (add/uncap a summary view only where the source is internally LIMIT-capped —
  additive, reversible). Prefer `mv_dia_overview_stats` / `mv_gov_overview_stats`
  for headline counts where they already carry them. No new api/*.js.
- **Verify (live):** every Overview tile's number equals the canonical SQL count
  (Lease Backfill = 3,039; On Market dia = 184, gov = 44 [or the confirmed
  canonical]; Ownership Coverage renders the real percentages; no tile shows a
  round LIMIT number like 1,000/500 unless that's genuinely the count; no tile
  stuck on "loading"). `node --check`; suite green.

## Documentation

Update CLAUDE.md: dia/gov Overview snapshot tiles read ONE canonical summary/CM
source each (never a capped detail page or a re-derived second query); "On
Market" uses the single CM available definition shared with the quarterly report;
stuck-loading tiles fixed to consume the fresh summary views with a real
empty/error state; dia↔gov parity + correct View-Details routing. One source of
truth per metric.

## Bottom line

The Overview shows wrong numbers (1,000 caps, 519 vs 44 on-market) and dead
"loading" tiles because it re-derives metrics from raw/capped queries and hanging
fetches instead of the canonical summary/CM views that already exist and are
fresh. Point every tile at its one canonical source, fix the async hangs, and
unify "on market" to the CM definition — so the Overview equals the Capital
Markets report equals the database: one correct number per metric, everywhere.
