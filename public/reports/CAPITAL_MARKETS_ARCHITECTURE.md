# Capital Markets Reporting — Architecture

**Status:** Phase 0 (foundation laid, Phase 1 implementation pending)
**Owner:** Scott Briggs
**Branch family:** `claude/capital-markets-phase-0-*` (3 repos)
**Last updated:** 2026-05-03

---

## 1. Goal

Eliminate the manual spreadsheet/data-entry work that currently produces our quarterly Capital Markets updates (the *State of the Government-Leased Market* and the *Dialysis Market Filter* PDFs). Replace it with:

1. **Live SQL views** in each domain's Supabase project that compute every chart's underlying data on demand.
2. **A capital-markets tab in the LCC** where every chart in the PDF is also viewable, filterable, and exportable to PDF or Excel by the team.
3. **An auto-built "marketing-ready" workbook** that mirrors the existing master Excel files, sent to marketing each quarter (ultimately monthly) for InDesign layout.
4. **A vertical-template architecture** so adding future verticals (childcare, urgent care, medical net lease) means adding rows, not rewriting code.
5. **A subspecialty pattern** so we can spin up tenant-specific or operator-specific clickbait mini-reports (SSA-only, DaVita-only, etc.) from the same data and chart templates.
6. **Eventual Copilot integration** (Phase 3) so charts and stats flow into Outlook drafts and Microsoft 365 day-to-day work.

**Non-goal for v1:** Replacing InDesign. Marketing keeps doing layout. We just stop doing the data lifting.

---

## 2. Three vertical types

| Vertical | Active | Supabase project | Data origin | Deliverable |
|---|---|---|---|---|
| `gov` | yes | `GovernmentProject` | Live ingest (CoStar, FRPP, Salesforce, OPM) | *State of the Government-Leased Market* |
| `dialysis` | yes | `DialysisProject` | Live ingest (CMS, CoStar, 10-K, Google) | *Dialysis Market Filter* |
| `national_st` | yes | `lcc_opps` (cross-domain) | RCA TrendTracker manual upload | *Single-Tenant Cross-Product* (replaces ST Market.xlsx) |
| `childcare` | future | tbd | Live ingest (planned) | tbd |
| `urgent_care` | future | tbd | Live ingest (planned) | tbd |
| `medical_nnn` | future | tbd | Live ingest (planned) | tbd |

The cross-vertical macro context (Fed Funds, 10Y Treasury, Net Lease Spread) lives at the LCC level (`lcc_opps`) since every report references it.

---

## 3. Schema pattern (per vertical)

Every vertical's Supabase project gets a parallel set of `cm_*` views and tables with **identical column shape**, so the same query and renderer code works for every vertical.

### Core views (pre-aggregated, refreshed nightly)

```
cm_{vertical}_volume_ttm_q       — quarterly TTM sales volume
cm_{vertical}_count_ttm_q         — quarterly TTM transaction count
cm_{vertical}_cap_ttm_q           — quarterly TTM weighted cap rate
cm_{vertical}_cap_quartile_q      — quarterly top/median/bottom quartile cap
cm_{vertical}_cap_yoy_q           — quarterly YoY cap rate change + 4-period MA
cm_{vertical}_cap_by_credit_q     — quarterly cap rate split by credit_tier
cm_{vertical}_ppsf_box_q          — quarterly PPSF high/low/avg
cm_{vertical}_rent_box_q          — quarterly rent/SF high/low/avg
cm_{vertical}_rent_survey_y       — annual rent survey by year-built / lease-term bucket
cm_{vertical}_avg_deal_q          — quarterly average deal size
cm_{vertical}_market_share_pie    — TTM market share (sold + on-market)
cm_{vertical}_buyer_share_y       — annual buyer-class % of volume
cm_{vertical}_top_buyers          — TTM top buyers by volume
cm_{vertical}_top_sellers         — TTM top sellers by volume
cm_{vertical}_nm_vs_market_q      — NM-brokered vs market avg cap rate (quarterly)
cm_{vertical}_nm_share_y          — NM share of total market volume (annual)
cm_{vertical}_listings_q          — active listings count quarterly
cm_{vertical}_available_scatter   — current listings cap-rate vs term scatter
cm_{vertical}_dom_price_adj       — DOM and price adjustments
```

### Subspecialty filter

Same views are exposed as a SQL function with a filter dimension:

```sql
cm_{vertical}_market_quarterly(filter_dim text, filter_value text)
```

For gov: `filter_dim` ∈ `{tenant_agency, region, lease_term_bucket}`.
For dialysis: `filter_dim` ∈ `{operator_parent, region, chair_count_bucket}`.

Calling with `filter_dim=NULL, filter_value=NULL` returns the umbrella report.
Calling with `filter_dim='tenant_agency', filter_value='SSA'` returns the SSA mini-report.

### NM attribution

Each vertical's source sales table gets a stored boolean `is_northmarq_brokered` computed via:

```sql
is_northmarq_brokered := EXISTS (
  SELECT 1 FROM lcc_opps.cm_nm_broker_patterns p
  WHERE source_sales.broker_name ILIKE p.match_pattern
)
```

The `cm_nm_broker_patterns` table (in LCC Opps) holds the editable list:

| pattern | as_of | note |
|---|---|---|
| `%Northmarq%` | 2022-01-01 | Current name |
| `%Stan Johnson%` | 2002-01-01 | Pre-acquisition, retained until 2022 |
| `%SJC%` | 2002-01-01 | Common abbreviation in CoStar |

Adding new producers or post-acquisition firms in the future is an INSERT, not a code change.

---

## 4. LCC layer (cross-vertical)

| Table / view | Purpose |
|---|---|
| `cm_verticals` | Registry. One row per vertical. Used by API to discover what's available. |
| `cm_subspecialties` | Sub-tenant / sub-operator breakouts per vertical. |
| `cm_chart_catalog` | The chart_template_id contract (mirrors `cm_chart_catalog.json`). |
| `cm_brand_tokens` | Server-side mirror of `cm_brand_tokens.json` for Copilot/Excel-renderer access. |
| `cm_macro_rates_q` | Fed Funds, 10Y Treasury, Net Lease Spread per quarter. |
| `cm_rca_quarterly` | RCA TrendTracker imports normalized: (product_type, quarter_end, volume, count, sf, cap, top_q_cap, top_q_ppsf). |
| `cm_nm_broker_patterns` | Editable NM-attribution patterns. |
| `cm_reports` | Each published quarterly/monthly report (`vertical`, `period_end`, `published_at`, `pdf_url`). |
| `cm_narratives` | Narrative blocks per report (`section_id`, `markdown`, `author_id`). Forks from prior period at draft creation. |
| `cm_features` | Featured-deal photo references per report. Out of v1 scope but schema reserved. |

---

## 5. API surface

Single LCC API function: `api/capital-markets.js` (10th of 12 Vercel hobby budget).

Routes:

```
GET  /api/capital-markets/verticals              → registry list
GET  /api/capital-markets/catalog                → chart_template_id catalog
GET  /api/capital-markets/brand                  → brand tokens
GET  /api/capital-markets/{vertical}/quarterly?as_of=YYYY-Q&filter_dim=...&filter_value=...
                                                 → all chart-template results for a vertical/quarter
GET  /api/capital-markets/{vertical}/chart/{chart_template_id}?as_of=...
                                                 → single chart's data
GET  /api/capital-markets/{vertical}/export?as_of=...&format=xlsx|pdf|png
                                                 → marketing-ready workbook or per-chart PNG
POST /api/capital-markets/rca/import             → upload RCA TrendTracker export
GET  /api/capital-markets/{vertical}/narrative?as_of=...
POST /api/capital-markets/{vertical}/narrative   → save narrative draft
POST /api/capital-markets/{vertical}/publish     → publish a draft
```

All endpoints accept the `subspecialty=<id>` query param (e.g., `subspecialty=gov_ssa`) to filter to a sub-tenant/sub-operator breakout.

---

## 6. Web UI (LCC)

Each vertical's domain tab gets a new sub-tab: **Capital Markets**. The page renders:

- Top: as-of selector + subspecialty selector + "Export Workbook" + "Export PNGs" + "Open in Outlook draft"
- Grid of chart cards (one per `chart_template_id` applicable to this vertical)
- Each card has `[Copy data]`, `[Download PNG]`, `[Edit narrative]` actions
- Bottom: narrative section (markdown editor, fork-from-prior-quarter on first load)
- "Publish report" button (gated; sets `published_at`, snapshots data, generates static PDF)

Charts use Chart.js 4.4.1 (already loaded by `index.html`) styled against `cm_brand_tokens.json`.

---

## 7. Excel export (v1 priority)

`GET /api/capital-markets/{vertical}/export?format=xlsx` produces a workbook with the same tab structure as the existing master Excel files:

- Per-chart data tables on a `Charts` tab
- Per-buyer/seller raw lists on `Top Buyers` / `Top Sellers`
- Rent Survey, Competition, etc. matching the master template
- Charts pre-built using the brand tokens (Calibri Light titles, Calibri body, NM navy/sky/pale/mid/axis palette)
- Excel cell number formats per `cm_brand_tokens.axis_formats`
- Sheet protection on formula cells (so marketing can't accidentally break them)

Implementation: server-side `openpyxl`-equivalent (the LCC stack is Node, so we'll use `exceljs`). Brand tokens are translated to `exceljs` chart styling on export.

---

## 8. Editorial workflow (Phase 2)

1. Author opens the Capital Markets tab for a vertical, selects "Draft new report for {next_period}".
2. System creates `cm_reports` row with `published_at=NULL` and copies last published period's narratives into draft narratives (the "fork prior quarter" pattern).
3. Each chart card shows the QoQ delta vs prior published period.
4. Author edits narratives in markdown.
5. (Phase 3) Optional: a "Suggest narrative bullets" button calls the Copilot to generate 2-3 bullets per section based on the QoQ deltas. Author edits.
6. Author hits "Publish". System sets `published_at`, snapshots underlying chart data into immutable `cm_report_snapshots` (so re-running the report years later still shows the as-of-publish numbers), and generates a static PDF for the marketing handoff.

The author always retains final approval. AI assistance never auto-publishes.

---

## 9. Copilot integration (Phase 3)

Two server-side tools exposed to the LCC Copilot:

```
cm_get_stat(vertical, chart_template_id, as_of, subspecialty=None)
  → text answer ("Gov-leased TTM weighted cap is 7.47% as of 2024-Q2; up 32 bps YoY.")

cm_attach_chart(vertical, chart_template_id, as_of, format='png', subspecialty=None)
  → server renders chart, attaches to active Outlook draft via existing taskpane plumbing.
```

Chart PNGs are cached in Supabase Storage at
`{vertical}/{period_end}/{subspecialty_or_umbrella}/{chart_template_id}.png`,
so subsequent attaches are zero-render.

---

## 10. Phasing

| Phase | Scope | Status |
|---|---|---|
| **0** | Architecture, brand tokens, chart catalog, schema migrations drafted, branches created, API stub | **In progress** |
| **1** | Gov MVP slice end-to-end: cm_volume_ttm_q view → API endpoint → Capital Markets tab with one chart → Excel export. NM broker patterns table + backfill. RCA upload form. | Pending |
| **2** | Full chart matrix per vertical. Editorial CMS (fork-prior-quarter). Workbook export matching master template. PNG export for InDesign. Subspecialty filters live. | Pending |
| **3** | Predicted cap rate model. National ST index. Copilot tools. Editorial AI assist. | Pending |
| **7** | (Stretch) Replace InDesign with auto-generated PDF. | Deferred |

---

## 11. Open issues for Phase 1

### 11.1 Gov master workbook BN-column data corruption

The `Copy Government Master Document.xlsx` workbook has 6+ cells in column BN with date-formatted serial values that exceed Excel's maximum valid date (2,958,465 = 9999-12-31):

```
Cell BN47   serial 4,244,718.346
Cell BN415  serial 3,041,518.065
Cell BN430  serial 13,485,129.07
Cell BN435  serial 668,283,739.7    ← especially anomalous
Cell BN452  serial 25,432,711.61
Cell BN495  serial 15,401,009.24
```

**Hypothesis** (matches Scott's intuition): a formula in an upstream input column (likely 10Y Treasury yield or Fed Funds Rate) returned `0` or `#DIV/0!` for one period, and a downstream formula `BN_n = BN_{n-1} + (some_delta / divisor)` exploded when `divisor` was near-zero. The BN_435 value of ~668M is consistent with a divisor that briefly went to ~$1e-7 and got compounded.

**Phase 1 fix:** Identify the formula in BN, find the upstream input column, add a NULLIF guard so a missing input feed produces `NULL` instead of cascading an explosion. The data feed itself (treasury yields) needs to be sourced from `cm_macro_rates_q` once we have it.

### 11.2 Off-brand workbooks

`Dialysis Comp Work MASTER.xlsx` and `ST Market.xlsx` use the default Office 2016+ palette (`#5B9BD5`, `#ED7D31`, etc.) instead of the Northmarq palette (`#003DA5`, `#62B5E5`, etc.). Phase 1 Excel exports must use `cm_brand_tokens.json` so all three deliverables look like the gov-master reference.

### 11.3 Dashboard cleanup

`DialysisProject/admin-dashboard/` and `GovernmentProject/dashboards/` haven't been touched in 4+ weeks; LCC has zero references to them. Confirm with team and either delete or mark deprecated. Their data flows are fully replaced by LCC + `cm_*` views.

### 11.4 RCA export shape lock-in

The RCA TrendTracker sample export has a stable 7-column shape:

```
Date | US {Product} Volume ($) | # Properties | Total SF | Cap Rate | Top Quartile Cap Rate | Top Quartile Price ($/SF)
```

One file per product type (Office, Medical, Industrial, Retail). Loader normalizes into `cm_rca_quarterly(product_type, quarter_end, ...)`. Phase 1 will build the upload form and persist these.

### 11.5 RCA sourcing for sub-$2.5M deals

The RCA export footer notes: *"Includes property or portfolio sales $2.5 million or greater."* This means RCA-derived market totals exclude smaller deals. Our internal `gov` and `dialysis` data covers all sale sizes. This footnote needs to surface on every chart that compares NM volume to RCA market totals.

### 11.6 Featured-deal photos

Out of v1 scope per Scott. Schema reserves `cm_features` table for future use. Marketing continues to hand-pick photos.

### 11.7 Geo maps (annual)

Out of LCC scope. Phase 1 adds an "Annual Map Data Export" button that drops a state-level summary `.xlsx` so Scott's existing map workflow can re-run without manual extraction.

---

## 12. Cross-references

- `cm_brand_tokens.json` — palette, fonts, axis formats
- `cm_chart_catalog.json` — the 28 chart templates and their per-vertical applicability
- DialysisProject migration: `supabase/migrations/<ts>_capital_markets_schema.sql`
- GovernmentProject migration: `sql/<date>_capital_markets_schema.sql`
- LCC migration: `supabase/migrations/<ts>_capital_markets_cross_vertical.sql`
- LCC API stub: `api/capital-markets.js`
