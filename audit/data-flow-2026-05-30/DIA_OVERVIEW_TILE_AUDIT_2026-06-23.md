# Dia Overview — Tile Audit (broken / mis-categorized tiles) 2026-06-23

Follow-on from Phase 2 (Overview parity). Phase 2 renders correctly (Scott confirmed);
this audit covers the broken/mis-categorized tiles Scott's eyeball surfaced. Every finding is
grounded live against the dia DB (`zqzrriwuavgrquhisnoa`) + `dialysis.js`.

## Unifying root cause (the theme)
Most broken tiles **derive a headline from a capped full-row fetch into `diaData` and read
`.length`**, or fill async via `setTxt` after render. When a fetch **times out / returns `[]`**
(silently `.catch(()=>[])`) or the overview **re-renders after the async fill**, the metric
collapses to a wrong value (0 → "100% coverage", empty movers, "no financial estimates") or the
tile stays stuck on its "..." placeholder. **The data all exists** — these are render/fetch
bugs, not data gaps. The robust pattern is the one the new Portfolio block uses: read a
**server-side aggregate** (summary view / MV / `count=exact`), never derive headlines from a
capped row-fetch `.length` or a fragile post-render `setTxt`.

## Per-tile findings

### 1. SJC Deal Book — 4 summary tiles stuck "..." (by-year + teams render fine)
- **Data:** `v_sjc_deal_book_summary` = 60 rows (per team/side/stage); the aggregation in
  `dialysis.js:1591-1604` is correct (the by-year table + teams table, same async block, render).
- **Root cause:** the 4 value tiles are filled by `setTxt('sjcClosedVal'…)` once, guarded by
  `window._diaSjcDealBookRendered`. If the overview **re-renders after** the async fill (the MV
  block, a tab re-activation, etc.), the HTML is rebuilt with the `value:'...'` placeholder and
  the once-guard **skips the refill** → tiles stranded on "...".
- **Fix:** compute the 4 summary values **inline during render** from data already fetched (or
  drop the once-guard and always refill on render), so a re-render can't strand them. Same
  pattern for any infoCard(id)+setTxt async tile.

### 2. Clinic Financial Estimates — "No financial estimates available"
- **Data:** `v_clinic_financial_overview` returns **clinics_estimated=8,511, with_revenue=8,511,
  total_revenue $49.9B** (verified in SQL AND via `diaQuery` in-browser — the fetch works).
- **Root cause:** `diaFinancialEstimates` is **never assigned** (null/undefined) or set to the
  `_empty` sentinel, so `renderFinancialMetricsInner` (`dialysis.js:2421-2431`) hits the
  `s._empty || !s.clinics_estimated` branch. The loader's result-shape handling (array vs
  `{data:[…]}`) or its trigger is the bug — the view itself is healthy.
- **Fix:** ensure the financial loader assigns `diaFinancialEstimates` from
  `v_clinic_financial_overview` row 0 (handle both array and `{data}` shapes, like the SJC code
  does), and only set `_empty` on a genuine empty result.

### 3. Lease Coverage — "100.0% / 0 need backfill" (misleading + collapses on timeout)
- **Data:** `v_clinic_lease_backfill_candidates` = **3,035** candidates; true lease-data coverage
  is ~**4,216 / 12,280 = 34%** (Portfolio at a Glance). Action Items separately says "1,000 need
  lease backfill" (the query's `limit:1000`).
- **Root cause:** `leaseBackfillLen = diaData.leaseBackfillRows.length` (capped at the `limit:1000`
  fetch, `dialysis.js:929/1771`), `leaseBackfillPct = (totalClinics − leaseBackfillLen)/
  totalClinics` (`:1794`). So it (a) can never exceed the 1000 cap, and (b) when the fetch
  times out / returns `[]` → len=0 → **100% / 0**, a falsely-perfect number. It also measures
  "% clinics not in the (capped) backfill queue," **not** real lease-data coverage.
- **Fix:** compute Lease Coverage from a **server-side count** (e.g. count of properties/clinics
  WITH lease data ÷ total, or `count=exact` on the backfill view) — never from a capped
  `.length`, and never collapse to 100% on an empty fetch. Align the headline with the
  Portfolio "with lease rent" denominator so the page is internally consistent.

### 4. Top Movers — blank / "no data"
- **Data:** `v_facility_patient_counts_mom` = **7,614 rows, all with `delta_patients`**; the
  dashboard's own query (`delta_patients=gt.0`, limit 10) returns **10 rows** in-browser (works).
- **Root cause:** two layers — (a) on some loads the movers query is caught→[] (load-timing/
  timeout) leaving the tiles empty; (b) **the underlying patient-count feed is STALE** (see #7),
  so even when populated the MoM deltas are old. Not a query bug per se.
- **Fix:** lower priority for code; the real fix is the stale ingestion (#7). Optionally render
  "data as of <snapshot date>" so stale movers are labeled honestly.

### 5. Verification Status — headline "0"
- **Data:** the detail line is real ("28 30d-overdue · 452 checks/7d · 71 status-changes/7d").
- **Root cause:** the headline `0` = the **"due now"** count (genuinely 0), which reads as
  "broken/empty." Labeling/metric-choice issue.
- **Fix:** headline a meaningful number (e.g. **28 overdue**, or checks/7d) with the rest as
  sub-detail, so the tile doesn't look dead.

### 6. ON MARKET — "742 active listings" (scope check)
- **Data:** `v_available_listings` = **746** rows (the tile's 742 after excluding 2 stale).
  This is a real count, not a bug.
- **RESOLVED (spot-check 2026-06-23): the count is REAL and dialysis-scoped — not
  mis-categorized.** 745 rows, all with a `property_id`; **712 (96%) carry a dialysis-named
  operator** (DaVita/Fresenius/US Renal/dialysis/nephro), only 6 have no operator; 701 priced;
  status = 744 active + 1 under_contract. So 742 active dialysis listings is accurate.
  - **One refinement (freshness, not a bug):** only **601 of 745 were listed within 180 days** →
    ~144 (19%) are 6+ months old but still `status='active'`, yet the tile excludes only "2
    stale." The availability-checker / verification (the 28-overdue tile) should age more of
    these out so the "active market" headline isn't padded by a stale tail. Ties to #5/#7.

### 7. Ingestion staleness (the real ops issue — drives #4 and freshness)
- **Data:** `ingestion_tracker` latest `facility_patient_counts` run = **2026-03-27,
  run_status='failed'** ("Reclaimed by ingestion_lock after 25.7h stale"); the Research-Pipeline
  "last ingestion" shows **May 13**. The CMS patient-counts ingestion has **not succeeded since
  late March**.
- **Root cause:** the **CMS ingestion pipeline** (DialysisProject `run_cms_ingestion`) is failing/
  not running — this is upstream of LCC (a Python pipeline / scheduled job, not LCC code). It
  explains stale movers, stale inventory-change deltas, and the stale "last ingestion" date.
- **Fix (ops, Scott):** re-run / repair the CMS ingestion pipeline (clear the stale
  `ingestion_lock`, re-run `run_cms_ingestion`); then movers/inventory refresh. Track separately
  from the LCC tile fixes.

### 8. SJC "missing many sales" (scope clarification, not a bug)
- The SJC Deal Book by-year/teams = the team's **Salesforce CRM brokered deals**
  (`v_sjc_deal_book`, bounded ~60), NOT the **3,035 market sale comps** (`sales_transactions`).
  They're different universes — the by-year chart correctly shows only Briggs/SJC closed deals.
- **RESOLVED (spot-check 2026-06-23): NOT a sync gap.** The deal book spans **2017-2026 across
  ~12 teams** (Briggs, Scrivner, Feller, Powell, Brett, Hughes, Butler, Hedrick, Byerly, Duff,
  Fritz, Harf, Adatto, Stan Johnson Co…) — a reasonably complete multi-team SF sync. Closed
  deals by side: **62 Sale-Deal-Commercial + 11 IS-Buy-Side + 9 IS-Off-Market = 82 total
  closed** (plus 29 terminated Sale, 29 terminated Off-Market, 13 active, 5 in-escrow/LOI).
  - **The "missing many sales" impression has two real parts:** (a) the deal book is the team's
    SF *brokered* deals (~82 closed), a different universe from the **3,035 market sale comps**
    (`sales_transactions`) — not missing, just different; and (b) the headline **"Closed Sales"
    tile counts ONLY `deal_side='Sale Deal - Commercial'` (62)**, excluding the ~20 closed
    buy-side / off-market deals. → **Scott's call:** relabel the tile "Closed Sale-Side Deals"
    for honesty, OR include all closed `deal_side`s (82). Minor JS tweak, not a sync fix.

### 9. Feature request — clickable Recent Closed Sales + team closings
- `Recent closed sales` (`dialysis.js:1666-1677`) and the team table render as static rows.
- **Want:** each recent-closed-sale row (and ideally team-closing rows) links to the deal /
  property detail so Scott can click through and follow it.
- **Fix:** wire rows to `openUnifiedDetail('dia', {...})` (or the SF deal URL where it's a pure
  CRM deal with no LCC property). `v_sjc_deal_book` would need to expose a `property_id` /
  `sale_id` / SF deal id to link on — confirm the view carries a linkable id; if not, add it.

## Fix routing
- **JS fixes (Claude Code → Railway redeploy):** #1 SJC summary inline-compute, #2 financial
  loader assignment, #3 lease-coverage server-count + honest formula, #5 verification headline,
  #9 clickable rows. → `CLAUDECODE_PROMPT_DIA_TILES_*` (to be written).
- **Scope checks (grounding, me):** #6 listings scope, #8 SJC SF-sync completeness.
- **Ops (Scott):** #7 re-run/repair the CMS ingestion pipeline (DialysisProject); clears stale
  movers + freshness.

## Bottom line
The dia Overview's value dashboard is correct (Phase 2). The broken tiles are render/fetch bugs
(capped-`.length` headlines that collapse on timeout, stranded async `setTxt` fills, a loader
that never assigns) over **data that exists** — plus one real upstream ops failure (CMS
ingestion stalled since March). Fixing the tiles to read **server-side aggregates** (the
consumption-layer "honest counts" doctrine) makes them robust and internally consistent.
