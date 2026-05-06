# Capital Markets Deliverable ↔ LCC Parity Audit

**Date:** 2026-05-05 (recon) · 2026-05-06 (Tier 1 + Tier 2 macro-pair shipped) · 2026-05-07 (market_share_pie_ttm + 4 transaction-level views shipped)
**Owner:** Scott Briggs
**Status:** Tier 1 fully done · Tier 2: **7 of 8 dialysis charts shipped** (cash_leveraged_returns, cost_of_capital, market_share_pie_ttm, dom_and_pct_of_ask, bid_ask_spread, seller_sentiment, cap_rate_by_lease_term); only `valuation_index` deferred
**Method:** Inventoried each chart in the two production PDF deliverables, every chart object in the three master Excel workbooks, and every row in `cm_chart_catalog`. Cross-referenced into the matrix below.

## Progress log

| Date | Item | Status | PR |
|---|---|---|---|
| 2026-05-06 | Tier 1 #1: `volume_cap_summary_table` (4 metrics × 7 cols, replaces the manual snapshot tables marketing builds 9× per gov deck) | ✅ shipped — catalog row added, `api/_shared/cm-summary-table.js` + 14 unit tests, synthetic-template dispatch in `api/capital-markets.js`, `Summary_Vol_Cap` tab in `cm-excel-export.js`, `renderPeriodSummary` card in frontend, live smoke tested against gov + national_st (all + office) | #595 |
| 2026-05-06 | Tier 1 #2: `volume_cap_quartile_combo` (front-cover combo on gov p.6/7/8/13, dia p.19, ST workbook — Volume area + Cap line + Upper/Lower quartile band on dual-axis) | ✅ shipped — `joinVolumeCapQuartile()` composer + 5 unit tests added to existing module, second `SYNTHETIC_COMPOSERS` entry, mixed Chart.js render with dual y-axes (volume left $, cap right %) and shaded quartile band, `Data_Vol_Cap_Combo` tab in workbook, smoke verified across gov (114q from 1970-Q1) + national_st all/office (96q from 2002-Q1) | #596 |
| 2026-05-06 | Tier 2 macro-pair (2 of 8): dialysis-side `cash_leveraged_returns` + `cost_of_capital` views | ✅ shipped — DialysisProject migration `20260506200000_cm_dialysis_macro_infra` adds local `economic_indicators` table, `cm_loan_constant_30yr()` fn, and 4 macro views (`cm_dialysis_macro_rates_q`, `cm_dialysis_loan_constant_q`, `cm_dialysis_returns_indexes_q`, `cm_dialysis_cost_of_capital_q`); 8230 FRED rows synced from gov DB via new `src/ingest_fred_to_dialysis.py` script (2002-2026); LCC catalog flag flip to add `dialysis` to applies_to_verticals for both. Live verified: 2025-Q4 dialysis cap 7.70%, treasury 4.10%, leveraged-mid 8.12% (math: (cap − avg_loan_const × 0.5) / 0.5 ✓) | TBA |
| 2026-05-06 | Tier 2 macro-trio item 3: `valuation_index` for dialysis | ⏸ deferred — gov view depends on `noi_psf` / `sf_leased` columns that don't exist in `dia_sales_transactions`. Needs a different formula (likely indexed cap rate inverse, per the dialysis PDF p.17) — separate workstream once formula is locked. |
| 2026-05-07 | Tier 2 item 3 of 8: `market_share_pie_ttm` for dialysis | ✅ shipped — DialysisProject migration `20260506220000_cm_dialysis_market_share_pie` builds the view from `sales_transactions` (TTM rolling 12-month, top 10 listing-broker buckets + "Other" rollup, Northmarq consolidated via `is_northmarq` flag, excludes `exclude_from_market_metrics`); LCC catalog flip adds `dialysis` to `applies_to_verticals`. **Surfaces a real data-quality finding** — 60-87% of dialysis sales lack `listing_broker` (structural across 2018-2025), so the "Unknown" bucket dominates the latest TTM pie at 81.5%. Action item: backfill `listing_broker` from CoStar/CREXi captures, and clean a handful of rows where the sidebar-paste artifact "Buyer Contacts..." landed in the broker field. |
| 2026-05-07 | Tier 2 items 4-7 of 8: `dom_and_pct_of_ask` + `bid_ask_spread` + `seller_sentiment` + `cap_rate_by_lease_term` for dialysis | ✅ shipped — single DialysisProject migration `20260507100000_cm_dialysis_tx_views` adds 4 transaction-level views built from `available_listings` + `sales_transactions ⨝ leases`. `cap_by_term` shows the canonical monotone pattern (10+ tightest at 7.0-7.4%, <5 widest at 8.1-9.0%). `dom_pct_ask` includes outlier filters: DOM in [0, 1095] days excludes negative-DOM retrospective comp entries; pct_of_ask in [0.50, 1.50] excludes portfolio sub-listings (e.g. listings 8788/8832 at 1245% from a $22.75M package sold against $1.83M per-clinic last_price). `seller_sentiment` derives `had_price_change` from `available_listings.initial_price <> last_price` since `listing_price_history` is empty in production today. LCC catalog flip enables all 4 for dialysis. |

---

## 1. Source artifacts inventoried

| Artifact | Path | Items |
|---|---|---|
| Gov PDF (Q2-2024) | [`public/reports/state-of-gov-leased-2024-q2.pdf`](state-of-gov-leased-2024-q2.pdf) | 46 chart-or-data-table items; 28 unique templates |
| Dialysis PDF (Q4-2025) | [`public/reports/dialysis-market-filter-2025-q4.pdf`](dialysis-market-filter-2025-q4.pdf) | 33 items; ~25 unique templates |
| Gov Master XLSX | `Copy Government Master Document.xlsx` | 32 chart objects across `All Charts` (18), `SSA Charts` (10), `Rent Survey` (2), `Competition` (2) |
| Dialysis Master XLSX | `Dialysis Comp Work MASTER.xlsx` | 37 chart objects across `Charts` (23), `Market Size` (8), `Available Comps` (1), `Core Cap Chart` (1), `Sheet1` (1), `Rent Survey` (1), `Competition` (2) |
| ST Market XLSX | `ST Market.xlsx` | 29 chart objects across `Index` (2), `Vol` (5), `Count` (11), `Buyers` (4), `Spreads` (2), `Prediction` (2), `Value Prop` (3) |
| LCC catalog | `cm_chart_catalog` table (lcc_opps) | 41 chart_template_ids: 32 Phase-1, 7 Phase-2, 2 Phase-3 |

There is **no published National Single-Tenant PDF deliverable** today; the ST Market workbook is the source of truth for what marketing produces.

---

## 2. The verdict in one paragraph

The LCC catalog covers most of the deliverable's chart shapes — but **`applies_to_verticals` is wrong on 8 chart_template_ids** (dialysis is excluded from charts that very obviously appear in its own deliverable), and there are **6 distinct chart concepts in the gov + dialysis decks that have no template** in the catalog yet. Plus a handful of static-content elements (KPI tile blocks, reference comparison tables, US choropleth maps, public-health charts) that are not "chart_templates" in the engineering sense but are page-sized parameterized layouts marketing rebuilds quarterly. **Net: ~95% of the data chart shapes are covered; the gaps are concentrated in vertical applicability flags and the dialysis deck.**

---

## 3. Parity matrix — chart_template_id ↔ deliverable presence

Legend: ✅ in catalog & in deliverable · ⚠️ in catalog but `applies_to_verticals` wrong · ❌ in deliverable but no template · ➖ template exists but unused by this vertical (correct).

### 3.1 Gov deliverable (`state-of-gov-leased-2024-q2.pdf`)

| chart_template_id | Gov page(s) | Status | Notes |
|---|---|---|---|
| `valuation_index` | p.12 | ✅ | "Government-Leased Valuation Index" |
| `volume_ttm_by_quarter` | p.13 | ✅ | "Volume & Cap Rate Ranges" — combined with `cap_rate_top_bottom_quartile` in the deliverable |
| `cap_rate_top_bottom_quartile` | p.13 | ✅ | Combined band on the volume chart |
| `cap_rate_ttm_by_quarter` | p.13, p.17 | ✅ | Avg Cap Rate (TTM) line |
| `yoy_volume_change` | p.14 | ✅ | YOY Change (%) |
| `cap_rate_by_lease_term` | p.15 | ✅ | "Cap Rate Comparison \| The Value of Firm Lease Term" — 4 cohort lines |
| `cap_rate_by_credit` | p.16 | ✅ | "Cap Rate by Government Type" — Federal / State / Municipal |
| `cost_of_capital` | p.17 | ✅ | 10Y Treasury + Avg Cap + Loan Constant Band |
| `cash_leveraged_returns` | p.18 | ✅ | Cash + Leveraged Return Indexes |
| `transaction_count_ttm` | p.19 | ✅ | Trans Count (TTM) bars |
| `avg_deal_size` | p.19 | ✅ | Avg Deal Size dots (same chart as count) |
| `buyer_class_pct_by_year` | p.20 | ✅ | Buyer Pool 100% stacked + buyer detail table |
| `sources_of_capital` | p.21 | ✅ | US bubble map; rendered as data table in our Excel export |
| `dom_and_pct_of_ask` | p.22 | ✅ | DOM + % of Ask Price |
| `bid_ask_spread` | p.23 | ✅ | Bid-Ask Spread |
| `seller_sentiment` | p.24 | ✅ | Supply Side: Seller Sentiment & Confidence |
| `leased_inventory_by_state` | p.28 | ✅ | "Leased Inventory" map + ranked list |
| `leasing_summary` | p.29 | ✅ | New Leases + Most Common Lease Structures (twin tables) |
| `lease_structures` | p.29 | ✅ | Most Common Lease Structures (component of leasing_summary in PDF) |
| `lease_renewal_rate` | p.30 | ✅ | |
| `lease_termination_rate` | p.31 | ✅ | |
| `rent_by_year_built` | p.32 | ✅ | Scatter w/ quartile band + trendline |
| `case_for_renewal` | p.33 | ✅ | Bars (commencement count) + line (avg rent/SF) |
| `renewal_rent_growth` | p.34 | ✅ | Renewal Rent + CAGR combo |
| `cpi_vs_renewal_cagr` | p.34 | ✅ | CPI vs Renewal Rent CAGR |
| `rent_heat_map` | p.35 | ✅ | US choropleth w/ $/SF labels |
| `nm_vs_market_cap` | p.38 | ✅ | "Value Proposition Results" |
| `market_share_pie_ttm` | (Excel only) | ➖ | Master XLSX `Competition` tab; not in PDF |
| **Net Lease cross-product index** | p.5 | ❌ | "Net Lease Valuation Index" main chart + "Product Type Valuation Index Breakdown" — exists conceptually in `index_yoy_change` (Phase 3, national_st-only) but **the gov deliverable shows it on page 5** as a cross-product reference. Need a `national_st`-driven render that's also embeddable in the gov deck. |
| **Net Lease subsector blocks (Industrial / Office / Medical Volume + Cap)** | p.6, p.7, p.8 | ❌ | Identical structure to gov-leased volume chart, but data is RCA national_st with subspecialty filter. Can be served by `volume_ttm_by_quarter` + `cap_rate_top_bottom_quartile` against `cm_natl_st_*_q` views with subspecialty=office/medical/industrial. **The catalog already supports this** (`applies_to_verticals` includes national_st); the **deliverable workflow** needs a way to embed national_st charts inside the gov deck. |
| **Net Lease Buyer Pool (Office/Industrial/Medical)** | p.10 | ❌ | Annual stacked bar across the 3 ST product types. `buyer_class_pct_by_year` covers this for national_st once buyer-class data lands (currently stubbed, see §6 below). |
| **Yield Spreads (cross-product)** | p.11 | ❌ | "Net Lease Spread" line — `net_lease_spread` in catalog applies to national_st + gov. Working as designed; just need to publish it on the gov tab. |
| **Buyer Distribution US dot map** | p.39 | ❌ | "Northmarq's Targeted Buyer Reach" — dot map with state callouts. No template. Static-ish content; would render as `DataTable` ranked geographic, similar to `sources_of_capital`. |
| **Track Record by Buyer Type** | p.39 | ❌ | Table: Individual / Developer / Institutional / Private Equity / Pooled / Other × {# deals, Avg Cap, Total Vol}. No template. |
| **Cap Rate / Volume summary tables (TTM + 5/10/15-yr avgs)** | p.6, 7, 8, 13, 15, 16, 19, 20, 27 | ⚠️ | **Every chart in the deliverable is paired with a 7-column summary table** (current quarter, prior quarter, YoY same-quarter, prior-cycle, 5/10/15-yr avg). LCC export today produces only the time series. Marketing currently builds these tables manually from the master XLSX. **Highest-impact gap.** |

### 3.2 Dialysis deliverable (`dialysis-market-filter-2025-q4.pdf`)

| chart_template_id | Dialysis page | Status | Notes |
|---|---|---|---|
| `valuation_index` | p.17 | ⚠️ | **applies_to_verticals = `[gov]` only** — fix to include dialysis. Used in deliverable as "Valuation Index" combo |
| `cash_leveraged_returns` | p.18 | ⚠️ | applies_to_verticals = `[gov, national_st]` only — fix to include dialysis |
| `volume_ttm_by_quarter` | p.19 | ✅ | Combined with cap quartiles into one chart |
| `cap_rate_top_bottom_quartile` | p.19 | ✅ | |
| `cap_rate_ttm_by_quarter` | p.19, p.23 | ✅ | |
| `yoy_volume_change` | p.21 | ✅ | YoY (%) line |
| `transaction_count_ttm` | p.21, p.25 | ✅ | Quarterly volume on p.21 (NOT TTM) is a different cut |
| `cap_rate_by_lease_term` | p.22 | ⚠️ | applies_to_verticals = `[gov]` only — fix to include dialysis (4 cohort lines: 12+/8-12/6-8/≤5 yr) |
| `cost_of_capital` | p.23 | ⚠️ | applies_to_verticals = `[gov, national_st]` only — fix to include dialysis |
| `cap_rate_yoy_change` | p.24 | ✅ | "Cap Expansion/Compression Pace" — Phase 2 |
| `avg_deal_size` | p.25 | ✅ | |
| `ppsf_box_quarterly` | p.26 | ✅ (Phase 2) | "Price per SF (TTM)" + "Rent per SF (TTM)" combo on the same page |
| `rent_psf_box_quarterly` | p.26 | ✅ (Phase 2) | |
| `buyer_class_pct_by_year` | p.27 | ✅ | Individual / Fund / REIT TTM buyer-pool stacked bars |
| `dom_and_pct_of_ask` | p.33 | ⚠️ | applies_to_verticals = `[gov]` only — fix to include dialysis |
| `bid_ask_spread` | p.34 | ⚠️ | applies_to_verticals = `[gov]` only — fix to include dialysis |
| `seller_sentiment` | p.35 | ⚠️ | applies_to_verticals = `[gov]` only — fix to include dialysis |
| `nm_vs_market_cap` | p.38 | ✅ | NM vs Non-NM cap rate (TTM) |
| `market_share_pie_ttm` | (Excel only) | ⚠️ | applies_to_verticals = `[gov]` only — Dialysis Master `Competition` tab also has Market Share pies; fix to include dialysis |
| `available_cap_rate_scatter` | (Excel `Available Comps`) | ✅ (Phase 2) | "Asking Cap Rate vs Term" scatter |
| `dom_price_adjustments` | (Excel `Market Size`) | ✅ (Phase 2) | |
| `listings_count_q` | p.30 | ✅ (Phase 2) | "Number of Clinics Available" + Avg Asking Cap (Total vs 10+ Yr) |
| **ESRD Incidence US choropleth** | p.6 | ❌ | Public health data from USRDS 2024 ADR. Static-ish reference content. |
| **Number of Transplants by Organ** | p.8 | ❌ | Public health data. Static reference. |
| **Industry Participants comparison table** | p.10 | ❌ | DaVita vs FMC reference table |
| **Standard Build-to-Suit Lease Terms comparison** | p.11 | ❌ | Reference table |
| **Trend Watch callout cluster** | p.20 | ❌ | KPI/narrative tile block |
| **What's New in Q4 2025 KPI tiles** | p.3 | ❌ | KPI tile block |
| **TTM Volume + Cap + Quartile-Band combo** | p.19 | ❌ | Single chart object that overlays `volume_ttm_by_quarter` + `cap_rate_ttm_by_quarter` + `cap_rate_top_bottom_quartile`. The data exists; **the combination chart-shape doesn't have a template**. The master XLSX builds this from 3 separate ranges. |
| **Asking Cap Rate Ranges by Term Bucket** | p.30 | ❌ | Bar (avg price) + dots (avg cap, upper, lower, median) by 4 term buckets. Distinct from `cap_rate_top_bottom_quartile` because it's a point-in-time bucket comparison, not time series. |
| **Asking Cap Rate Quartiles Over Time (Total vs 10+ Yr Term)** | p.31 | ❌ | 4 lines: Total Upper/Lower + 10+yr Upper/Lower. Distinct from `cap_rate_top_bottom_quartile` — that view is single-cohort, this is 2-cohort. |
| **DOM + Price-Change Frequency (active listings, Total vs 10+ Yr)** | p.31 | ❌ | Distinct from `dom_and_pct_of_ask` — that is closed-deal DOM, this is active-listing DOM with cohort split. |
| **Available Clinics by Tenant** (table + 2 donuts) | p.32 | ❌ | DaVita / FMC / US Renal breakdown of active inventory — count donut, volume donut, summary table |
| **Notable Healthcare Transactions list** | p.39 | ❌ | Reference list of NM-brokered tenant + sale price; ~30 rows. Track-record content. |
| **NM vs Other Brokers grouped bar** | p.37 | ❌ | Cross-asset-class NM vs Market avg cap (5 product types). Same template would work in gov deck p.37. |
| **Sample Dialysis Transactions card grid** | p.40 | ➖ | Featured-deal photo cards. Out of v1 scope per architecture §11.6. |

### 3.3 ST Market workbook (no PDF deliverable today)

The ST Market.xlsx is wired for 7 sheets: Index, Vol, Count, Buyers, Spreads, Prediction, Value Prop. All 29 chart objects map to existing Phase-1 templates against `cm_natl_st_*_q` views — already covered by the Phase 2f work. No new templates needed. Scoping note: when you decide to publish a national_st PDF, the layout will follow the gov deck since the master sources are RCA TrendTracker exports already loaded.

---

## 4. The 8 vertical-applicability errors (low-risk fix)

These are all in the deliverable PDF but blocked from rendering in the LCC tab because `applies_to_verticals` excludes the relevant vertical:

| chart_template_id | Current `applies_to_verticals` | Should be | Evidence |
|---|---|---|---|
| `valuation_index` | `{gov}` | `{gov, dialysis}` | Dialysis PDF p.17 |
| `cash_leveraged_returns` | `{gov, national_st}` | `{gov, dialysis, national_st}` | Dialysis PDF p.18 |
| `cap_rate_by_lease_term` | `{gov}` | `{gov, dialysis}` | Dialysis PDF p.22 |
| `cost_of_capital` | `{gov, national_st}` | `{gov, dialysis, national_st}` | Dialysis PDF p.23 |
| `dom_and_pct_of_ask` | `{gov}` | `{gov, dialysis}` | Dialysis PDF p.33 |
| `bid_ask_spread` | `{gov}` | `{gov, dialysis}` | Dialysis PDF p.34 |
| `seller_sentiment` | `{gov}` | `{gov, dialysis}` | Dialysis PDF p.35 |
| `market_share_pie_ttm` | `{gov}` | `{gov, dialysis}` | Both Master XLSX `Competition` tabs |

**⚠️ Verified after writing the table above: none of the 8 dialysis views exist** (`cm_dialysis_valuation_index_q`, `cm_dialysis_cash_leveraged_returns_q`, `cm_dialysis_cap_by_term_q`, `cm_dialysis_cost_of_capital_q`, `cm_dialysis_dom_pct_ask_q`, `cm_dialysis_bid_ask_spread_q`, `cm_dialysis_seller_sentiment_q`, `cm_dialysis_market_share_pie`). So **flipping the catalog flag alone would expose 404s**. This is a two-step migration:

1. **First** — write the 8 dialysis views (migration on the Dialysis_DB Supabase project). Two of them (`valuation_index`, `cash_leveraged_returns`, `cost_of_capital`) are macro-rate-based and can be lifted from the national_st implementations with minimal change. The other five need a dialysis sales-transaction dimension that may or may not exist in `dia_sales_transactions` today.
2. **Then** — flip `applies_to_verticals` in `cm_chart_catalog` (the small migration in this PR).

This bumps the catalog flip from "Tier 1 — ships immediately" to **Tier 2 (depends on dialysis-side view migration first)**. See revised punch list in §7.

---

## 5. The 6 net-new templates needed for full deliverable parity

| New chart_template_id | Vertical | Description | Source data |
|---|---|---|---|
| `volume_cap_quartile_combo` | gov, dialysis, national_st | Single combined chart: TTM volume area + TTM cap dot + cap quartile high-low band, all on one canvas. Heavily used in dialysis PDF p.19, ST workbook, gov subsector blocks p.6-8/13. | Same data as the 3 source templates; just a render-mode flag |
| `volume_cap_summary_table` | gov, dialysis, national_st | The 7-column "current Q + prior Q + YoY-Q + prior cycle + 5/10/15-yr avg" snapshot that appears on p.6, 7, 8, 13, 15, 16, 19, 20 of the gov deck. | Same data as `volume_ttm_by_quarter` + `cap_rate_ttm_by_quarter`; aggregates added |
| `asking_cap_quartiles_cohort_q` | dialysis, gov | 4-line chart: {Total Market Upper, Total Lower, 10+ Yr Upper, 10+ Yr Lower}. Distinct from `cap_rate_top_bottom_quartile` because it's 2-cohort. | Active-listings table with term-bucket dimension |
| `asking_cap_by_term_bucket` | dialysis, gov | Point-in-time bar+dot chart by 4 term buckets (sub-5, 5-8, 8-12, 12+). Avg price bar + cap quartile dots. | Active-listings snapshot with term-bucket aggregates |
| `available_inventory_by_tenant` | dialysis | Dialysis-specific: DaVita/FMC/USRC active inventory snapshot. Table + 2 donuts (count + volume). | `cm_dialysis_available_listings` filtered on operator |
| `nm_cross_asset_class` | gov, dialysis, national_st | NM vs Market avg cap, grouped-bar across product types. Used in About-NM section of both decks. | RCA-derived national_st cap rates joined to NM internal closed deals |

---

## 6. Static-content elements that aren't `chart_templates` but the deliverable needs

These don't fit the `chart_template_id` data-shape contract — they're either page-sized layouts or content that lives outside the LCC data flow.

| Element | Vertical(s) | Recommendation |
|---|---|---|
| **KPI tile blocks** ("What's New in Q4", "Trend Watch", "Value Proposition Results") | gov, dialysis | New `cm_kpi_blocks` table or extend `cm_chart_catalog` with a `kpi_block` chart_type. Each block is N tiles (label + value + format), filled from a SQL function or hardcoded text + dynamic stat |
| **Reference comparison tables** (Industry Participants, Standard Lease Terms) | dialysis | Static markdown in `cm_narratives` (already in schema) — already covered by editorial CMS plan |
| **Public-health charts** (ESRD Incidence map, Transplants by Organ) | dialysis | Out of scope for v1. These are pulled from USRDS / NIH and update annually. Mark as static content block + flag for Phase 4. |
| **Featured deal photo grids** | gov, dialysis | Out of v1 scope per architecture §11.6 |
| **News article cards** (gov p.25-26) | gov | Out of v1 scope; manual marketing content |

---

## 7. Recommended punch list (revised after view-existence check)

**Tier 1 — ships immediately (zero new SQL, just rendering work)**

1. ✅ **`volume_cap_summary_table`** — *shipped 2026-05-06 (PR #595).* The 7-column table pattern is on p.6, 7, 8, 13, 15, 16, 19, 20, 27 of the gov deck. Marketing builds it manually today. Single highest-impact delta. Pure rendering: aggregates the existing `volume_ttm_by_quarter` + `cap_rate_*_q` data into the summary shape via the synthetic-template dispatch (`__synthetic__:` view-name prefix). Live-verified output: gov 2025-Q4 cap 8.33%, prior 8.61%, 15-yr avg 8.53%.
2. ✅ **`volume_cap_quartile_combo`** — *shipped 2026-05-06.* The canonical "front cover" chart on gov p.6/7/8/13, dialysis p.19, ST workbook. Combines three existing data feeds into one mixed-chart render: volume area on left axis ($), TTM cap line + upper/lower quartile band on right axis (%). Same `__synthetic__:` synthetic-template pattern as #1, no new SQL view.

**Tier 2 — dialysis parity (8 dialysis views + catalog flip)**

3a. ✅ **Macro-pair shipped 2026-05-06.** `cash_leveraged_returns` + `cost_of_capital` views built on Dialysis_DB (mirroring the gov implementation: local `economic_indicators` + `cm_loan_constant_30yr` fn + 4-view chain), 8230 FRED rows synced via new `src/ingest_fred_to_dialysis.py`, catalog flags flipped. Live data verified.

3b. ⏸ **`valuation_index` deferred** — gov view's NOI/sf inputs don't exist in dialysis sales schema. Separate workstream when the dialysis-specific index formula is locked (likely reads from `cm_dialysis_market_quarterly.avg_cap_rate` indexed against a base period, per the PDF p.17 chart shape).

3c. ✅ **`market_share_pie_ttm` shipped 2026-05-07.** Live-computed view from `sales_transactions.listing_broker`, top 10 + "Other", Northmarq consolidated via `is_northmarq` flag. Surfaces a real DQ issue: 60-87% of dialysis sales lack `listing_broker` text — "Unknown" bucket dominates and a few rows have CoStar sidebar-paste artifacts. **Follow-up data hygiene task** queued to backfill broker from CoStar/CREXi captures.

3d. ✅ **Transaction-level quartet shipped 2026-05-07.** Single DialysisProject migration `20260507100000_cm_dialysis_tx_views` adds `cm_dialysis_dom_pct_ask_q`, `cm_dialysis_bid_ask_spread_q`, `cm_dialysis_seller_sentiment_q`, `cm_dialysis_cap_by_term_q`. Inputs: `available_listings` (1813 sold rows; 754 with full DOM+%-of-ask data after outlier filter) + `sales_transactions ⨝ leases` for firm-term cohorts. `seller_sentiment` derives `had_price_change` from `available_listings.initial_price ≠ last_price` since `listing_price_history` is empty. `dom_pct_ask` filters out negative-DOM rows (retrospective comp entries) and pct_of_ask outliers >1.5x (portfolio sub-listings). `cap_by_term` displays the canonical monotone pattern: 10+ at 7.0-7.4%, <5 at 8.1-9.0%.

**Tier 2 dialysis is now 7 of 8 complete.** Only `valuation_index` (3b) remains, deferred until the dialysis-specific formula is locked.

4. **Flip remaining `applies_to_verticals`** for the 5 transaction-level templates above (small migration on lcc_opps after each view lands).

5. **Build `asking_cap_quartiles_cohort_q`, `asking_cap_by_term_bucket`** — both feed off dialysis active-listings views.

6. **Build `available_inventory_by_tenant`** — dialysis-specific operator concentration view.

**Tier 3 — about-Northmarq section**

7. **Build `nm_cross_asset_class`** — used in both decks. Cross-vertical join.
8. **Buyer Distribution US dot map + Track Record by Buyer Type** — gov-only.
9. **Notable Healthcare Transactions list** — dialysis-only.

**Tier 4 — defer until editorial CMS lands**

10. KPI tile blocks (Trend Watch, What's New, Value Proposition).
11. Reference comparison tables.
12. Public-health charts (USRDS feed integration).

---

## 8. What's intentionally out of scope

Per [`CAPITAL_MARKETS_ARCHITECTURE.md`](CAPITAL_MARKETS_ARCHITECTURE.md):

- §11.6 Featured-deal photos — marketing continues to hand-pick
- §11.7 Geo maps (annual) — out of LCC scope; annual export-only
- News article cards — manual marketing content
- Phase 7 (stretch) — replacing InDesign; the deliverable still gets human layout

---

## 9. How this audit was produced (re-runnable recipe)

1. **PDF inventories** — read each PDF in 5-page chunks via `Read(pages: ...)`, capture chart title / type / time axis / series / units / footnote per page.
2. **Master XLSX inventory** — `openpyxl.load_workbook(path)`, walk `wb.sheetnames`, then `ws._charts`, extract `chart.__class__.__name__` (chart kind), `chart.series[0].val.numRef.f` (data range), then walk back from the data range's start row in that sheet to find the column header text. Most chart objects in these workbooks have no embedded `chart.title`, so the column-header walk is the only way to recover their identity.
3. **LCC catalog** — `SELECT * FROM cm_chart_catalog ORDER BY phase, chart_template_id;` against `lcc_opps`.
4. **View-existence check** — the resolved `view_name_template` per chart_template_id, queried against `information_schema.tables` on the relevant Supabase project.

The findings here reflect a 2026-05-05 snapshot. Re-run the steps above after any large catalog change or master-workbook refresh.
