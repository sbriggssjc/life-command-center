# Capital Markets Excel Export — Diagnostic & Fix Plan

**Date:** 2026-05-29
**Owner:** Scott Briggs
**Inputs reviewed:** `NM-CapMarkets-Dialysis-2026-03-31.xlsx` (49 tabs) · `NM-CapMarkets-GovLeased-2026-03-31.xlsx` (51 tabs), both exported 2026-05-29 for the 2026-Q1 (`as_of=2026-03-31`) period · `CAPITAL_MARKETS_ARCHITECTURE.md` · `CAPITAL_MARKETS_PARITY_AUDIT.md` (last updated 2026-05-10) · `api/_shared/cm-excel-export.js` · `api/_shared/cm-native-chart-injector.js` · `api/capital-markets.js`
**Status:** Diagnostic complete; fix batch 1 (items 1–3) implemented & verified. See Resolution Log below.

---

## 0. Resolution log — 2026-05-29 (batch 1: items 1–3)

| Item | What shipped | Where | Verification |
|---|---|---|---|
| **1. As-of clamp** | Added `clampRowsToAsOf()` + wired it into the export's per-chart fetch so `Data_*` tabs never bleed past the requested `as_of`. Clamps only genuine time-series shapes (`time_series*`/`monthly*`/`quarterly*`/yearly); snapshot, ranked-table, kpi, per-sale/per-listing tabs pass through. Post-fetch JS filter (not PostgREST) to avoid the documented 400→empty-tab failure mode. | `life-command-center/api/capital-markets.js` (code, **needs Vercel deploy**) | acorn + `node --check` pass; 7/7 unit tests (drops phantom Apr/May, keeps in-period, snapshot/ranked untouched, yearly clamps on `year`, null as_of no-op); confirmed against live `cm_dialysis_dom_pct_ask_m` |
| **2. Top Buyers/Sellers dedup** | `cm_normalize_entity_key()` + `cm_canonical_entity_key()` + extensible `cm_entity_alias` table; rewrote the 4 leaderboard views to group on the canonical key and display the cleanest variant. Strips `" by <broker>"`, parentheticals, punctuation, `&`/`and`, trailing corp suffixes; keeps `trust`; does not auto-merge JV/OBO/word-level diffs. | gov (`scknotsqkcheojiaewwh`) + dialysis (`zqzrriwuavgrquhisnoa`) — **applied live**; migrations in `GovernmentProject/sql/20260529_cm_entity_dedup_top_buyers_sellers.sql` + `DialysisProject/supabase/migrations/20260529120000_cm_dialysis_entity_dedup.sql` | gov: Boyd Watterson 6 rows→1 ("Boyd Watterson", 535); Easterly REIT 70+40→110. dia: SMBC 8→1, ExchangeRight/MassMutual/AEI/Realty Income case-merged |
| **3. Notable Txns field hygiene** | View now exposes `property_display` (COALESCE address→building_name→city→"—") and `buyer_type_display` (COALESCE→"—"), appended at end. Export repointed Property→`property_display`, Buyer Type→`buyer_type_display`. Root cause: Property read `building_name` (50% populated) instead of `address` (99.6%). | dialysis view **applied live** (`DialysisProject/supabase/migrations/20260529130000_cm_dialysis_notable_txns_field_hygiene.sql`) + `life-command-center/api/_shared/cm-excel-export.js` (**needs Vercel deploy**) | Every top row now shows a real street address; sparse buyer types render "—" |

**Important deploy nuance:** the SQL view changes (items 2 + 3) are **live now** on the gov/dialysis Supabase projects — the dashboard and next export reflect them immediately, and they're backward-compatible (columns preserved, new ones appended). The JS changes (item 1 clamp + item 3 export column repoint) take effect **only after the LCC Vercel deploy**. In the interim there is no breakage: the old export simply ignores the new `property_display`/`buyer_type_display` columns.

**Not a bug (corrected from first pass):** the two scatter charts per workbook are correctly wired via `xVal`/`yVal`. High null-density on 300-row history tabs is expected (mid-century-onward quarterly series).

### Batch 2 (2026-05-29) — Trend Watch KPI block

| Item | What shipped | Where | Verification |
|---|---|---|---|
| **5. Trend Watch (Tier-4 KPI block)** | Built `cm_dialysis_trend_watch_kpis` — 4 data-driven directional tiles (Cap Rate Trend QoQ, TTM Volume Momentum YoY, Cap–Treasury Spread, Days-on-Market Trend QoQ) on the existing `kpi_block` contract. Registered in `cm_chart_catalog` (dialysis, phase 4); export wired via new `KPI_Trend_Watch` tab + `specialRenderers`; added the missing `percent_signed` FMT token (`+0.0%;-0.0%`), which also fixes the whatsnew Volume tile that previously rendered as a raw decimal. | dialysis view + LCC catalog **applied live**; `life-command-center/api/_shared/cm-excel-export.js` (**needs Vercel deploy**); migrations: `DialysisProject/supabase/migrations/20260529140000_cm_dialysis_trend_watch_kpis.sql`, `life-command-center/supabase/migrations/20260529140000_cm_chart_catalog_trend_watch.sql` | acorn OK; live 2026-Q1 tiles: Cap +0.66% QoQ, Volume +54.7% YoY, Cap–Treasury 3.48%, DOM +290.9d. View max period = 2026-03-31 (quarterly sources, no in-progress-quarter bleed). Dashboard card is catalog-driven (no frontend code change needed). |
| **4. Gov NPV view** | **Skipped** per direction — master-workbook-only, no export tab today. Open for a future batch. | — | — |

**Deferred within this batch:** "Sumitomo Bank" vs "SMBC" left distinct (same parent, different names — add a `cm_entity_alias` row to merge); Elliott Bay sub-fund family left distinct; display casing reflects source (e.g. "Aei"). The monthly TTM views still synthesize forward-filled future months at source — the export clamp fully hides this for any given `as_of`, but trimming it in the view is a separate lower-priority cleanup.

---

## 1. Headline

The export is in good shape. Both workbooks are well-formed, brand-styled, populate Q1-2026 cleanly across all data tabs and KPI blocks, and the 34 native chart objects per workbook (including the two scatter dot-plots) are correctly wired. The marketing paste-ready workflow is intact.

The issues that remain fall into three buckets: **one real export bug** (data tabs not clamped to the as-of period), **a handful of source-data quality gaps** (entity dedup, null fields, "Unknown" buckets), and **the known parity backlog** carried in the audit. None are blockers; all are worth a clean-up pass.

**Correction to my first read:** I initially flagged the two scatter charts ("Available Deals — Asking Cap vs Term" and "Core Cap Rate — Dot Plot") as broken. They are **not** broken — scatter series store their data in `xVal`/`yVal` rather than `val`, and both point at valid ranges. My first check only inspected `.val`. Disregard that flag.

---

## 2. Confirmed bug — data tabs are not clamped to `as_of`

**Severity: High (credibility).** **Effort: Low.**

### Symptom
Exporting "as of 2026-03-31" still produces tabs with rows dated *after* Q1-2026:

| Workbook | Tab | Last row date | Problem |
|---|---|---|---|
| Dialysis | `Data_DOM_Ask` | **2026-05-31** | Two months past the report period; Apr-30 and May-31 rows carry **identical** values (`453.2 / 440 / 0.98248 / 0.92929`) — a forward-fill artifact, looks like fabricated data |
| GovLeased | `Data_CPI_CAGR` | 2026-04-30 | One month past period (FRED macro series runs ahead) |
| GovLeased | `Data_Avail_Cap_Dot` | 2026-05-29 | Active-listing scatter stamped with the export date |

### Root cause
In `api/capital-markets.js`, `fetchView()` (≈line 786) builds every per-chart `Data_*` tab with:

```
{view}?select=*&subspecialty=eq.{sub}&order={col}.asc
```

There is **no `period_end=lte.{as_of}` filter**. The only as-of clamping in the whole export is on the `MasterPasteReady` tab, which is sourced from the `*_master_m` monthly views that *are* clamped to `cm_last_completed_quarter_end()` (added 2026-05-07 per the comment at ≈line 880). The individual data tabs never got the same treatment, so they return whatever the view holds — including in-progress/future months — and the monthly TTM views forward-fill the trailing window when no new closed deals exist.

### Fix
Apply the same clamp the master_m path already uses to the per-chart fetch. Two options:

1. **Preferred — clamp in `fetchView`:** append `&{orderCol}=lte.{as_of}` to each try string (resolving `as_of` to `cm_last_completed_quarter_end()` when null). One change, covers every data tab, mirrors the master_m semantics.
2. Clamp per-chart after fetch in the `chartFetches` map (filter `rows` to `period_end <= as_of`). Simpler but leaves the over-fetch on the wire.

Also worth deciding: active-listing snapshot tabs (`Data_Avail_*`, `Data_Core_Cap_Dot`) are legitimately "as of today" — confirm whether those should be stamped with the as-of quarter-end label instead of the export date for consistency in the deliverable.

### Verification
After the fix, re-export and assert every `Data_*` tab's max `period_end` ≤ `as_of`, and that no trailing-month duplicate rows remain.

---

## 3. Source-data quality findings (upstream of the export)

These are not export bugs — the export faithfully renders what the views return — but they surface in the deliverable and undercut polish.

### 3.1 Top Buyers entity-dedup gap — Medium
GovLeased `Data_Top_Buyers` lists **"Boyd Watterson Global" (#1, 339 txns / $7.7B)** and **"Boyd Watterson" (#2, 184 txns / $3.5B)** as separate buyers — the same entity split across two rows. This inflates the ranked list, fragments the leaderboard, and understates true buyer concentration. Almost certainly repeats for other multi-alias buyers/sellers in both verticals. Fix belongs in the `cm_*_top_buyers` / `top_sellers` views (normalize on a canonical entity key) or upstream entity resolution.

### 3.2 Notable Transactions — null/inconsistent fields — Medium
Dialysis `Data_NM_Notable_Txns` (244 rows): the **Property** column is null on most flagship rows and, where present, holds inconsistent content — an operator name ("Davita Dialysis"), a county ("Alameda County"), or occasionally a real street address ("1009 Executive Pkwy Dr"). **Buyer Type** is null on the majority of rows. This is the marketing track-record set, so the empties are visible. Tighten `cm_dialysis_notable_transactions` to coalesce Property to a consistent field (street address → property name → city) and backfill Buyer Type where resolvable.

### 3.3 Market-share / buyer-geography "Unknown" dominance — Medium (known)
Already logged in the parity audit (2026-05-07/08): 60-87% of dialysis sales lack `listing_broker`; gov `listing_broker` values are often first-name-only ("Kevin", "Matthew") or semicolon-joined firms. GovLeased `Data_NM_Buyer_Distrib` carries an **"UNKNOWN" buyer-state** bucket that dominates early years. Root fix is the `listing_broker` / buyer-state backfill from CoStar/CREXi captures — a data-hygiene workstream, not a reporting change.

### 3.4 High-null time-series tabs — Not a bug (expected)
Tabs flagged at 40-57% null density (`Data_Volume_TTM`, `Data_Sold_Cap_by_Term`, `Data_Cap_by_Term`, etc.) are 300+ row quarterly histories reaching back to the mid-20th century; early decades legitimately have no transactions, so TTM columns are empty. No action — documented here so it isn't re-investigated.

---

## 4. Parity backlog (from the 2026-05-10 audit — still open)

PDF/master-workbook parity was reconciled against the existing audit rather than re-reading the 40-page PDFs (the audit's inventory is current as of 2026-05-05 and nothing indicates the source PDFs changed). Remaining open items:

| Item | Vertical | Type | Notes |
|---|---|---|---|
| `trend_watch_callouts` | dialysis | KPI block | Last of the Tier-4 KPI blocks; narrative-driven, needs the editorial CMS pattern |
| `nm_cross_asset_class` | gov, dialysis | chart | Deferred — needs RCA broker-dimension data we don't currently load |
| Reference comparison tables (Industry Participants; Standard BTS Lease Terms) | dialysis | static table | Editorial CMS / `cm_narratives` content |
| `cm_gov_npv_q` ("Estimated NPV" / BN column) | gov | SQL view | Architecture §11.1 — replaces the corrupted master-workbook BN column |
| Tier-4 NHE tile | dialysis | KPI tile | Needs an `external_kpi_values` table or year-keyed constants |
| Public-health charts (ESRD incidence map, transplants by organ) | dialysis | static | Out of scope for v1 — annual USRDS/NIH data |
| National-ST PDF/workbook publication | national_st | deliverable | ST workbook is wired; no published PDF yet |

---

## 5. Recommended fix sequence

1. **Clamp data tabs to `as_of`** (§2) — highest credibility impact, lowest effort, pure code. Ship first, re-export, verify no post-period rows.
2. **Top Buyers/Sellers entity dedup** (§3.1) — view-level normalization; visible quick win on the leaderboard tabs.
3. **Notable Transactions field hygiene** (§3.2) — coalesce Property, backfill Buyer Type in the dialysis view.
4. **`cm_gov_npv_q` view** (§4) — retires the long-standing BN-column corruption issue; moderate SQL effort.
5. **`trend_watch_callouts` KPI block** (§4) — reuses the existing `kpi_block` render path; mostly a view + catalog row.
6. **listing_broker / buyer-state backfill** (§3.3) — larger data-hygiene workstream; schedule separately.
7. **`nm_cross_asset_class`** (§4) — gated on RCA broker-dimension data; defer until that lands.

Items 1-3 are the cleanest "pick back up" batch: they make the *current* deliverable correct without new data dependencies.

---

## 6. Method (re-runnable)

Workbooks inspected with `openpyxl` (`data_only=True` for values, `data_only=False` for chart objects). Per tab: row count, max `period_end` in column A, null density in the data region. Chart objects walked for `series` → `val`/`xVal`/`yVal` refs to confirm wiring. Code paths traced in `cm-excel-export.js` (rendering), `cm-native-chart-injector.js` (native charts), `capital-markets.js` (`fetchView` / `exportWorkbook` data fetch). Parity reconciled against `CAPITAL_MARKETS_PARITY_AUDIT.md`.
