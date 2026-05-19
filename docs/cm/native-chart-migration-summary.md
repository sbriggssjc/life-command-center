# Native Excel Chart Migration — Summary

**Status (2026-05-19):** complete. Every `chart_template_id` with a working code path in `api/_shared/cm-chart-image-renderer.js` that produces a chart is now a native editable Excel chart object. 51 native templates, 2 intentional non-charts.

This document is the **authoritative reference** for the work. The per-PR tracker SQL files in `supabase/migrations/2026064[1-9]*` and `2026065[0-9]*` are historical records of each step; this doc supersedes them as the place to start when learning the system or extending it.

## Marketing's ask

2026-05-18: *"the charts in the Excel export are PNG images or graphics and not editable charts like what's in our Excel version."*

## The architectural pivot

The first attempt (R33 Editable Charts P1 / PR #819) flipped the dialysis export default from `data_tabs` to `master_template` mode, betting that the pre-wired chart objects in `assets/cm-templates/dialysis-master-template.xlsx` would render once the loader populated their referenced cell ranges. It failed: the existing `cm-template-loader.js` only populated columns B-O of one sheet (`Charts`); ~25 of the 37 chart objects referenced columns and sheets the loader didn't touch, so they rendered blank. PR #820 reverted.

R34 took a different approach: **keep the `data_tabs` layout** (one tab per chart, with the chart image PNG and the source data table on the same tab), but **inject native chart XML directly into the workbook** at the data-table location, replacing the PNG image with an editable `<c:chartSpace>` referencing the data tab's own cell ranges.

The mechanism: after ExcelJS writes the workbook to a buffer, JSZip opens it, injects new `xl/charts/chartN.xml` + `xl/drawings/drawingN.xml` files, updates `[Content_Types].xml` and sheet `.rels`, and re-zips. The sheet's drawing tag (already there from the PNG embed) points at the new chart XML instead.

This is the same technique `cm-template-loader.js` uses for the dia master template's `Charts` sheet, applied per-tab to the `data_tabs` workbook layout.

## Where the code lives

| File | Role |
|---|---|
| `api/_shared/cm-native-chart-injector.js` | Main module. `injectNativeCharts(buffer, injections)` is the entry point. Contains 9 chart-XML builders, the `NATIVE_CHART_TEMPLATES` set (51 entries), and `buildInjectionSpec` which maps `chart_template_id` + workbook column layout to an injection spec. |
| `api/_shared/cm-excel-export.js` | Workbook builder. Filters `chartImagesById` to skip PNG embed for migrated templates; collects injection specs; writes any helper columns the spec declares. |
| `api/capital-markets.js` | Endpoint. After `wb.xlsx.writeBuffer()`, calls `injectNativeCharts(buffer, wb.nativeInjections)` and sets `X-CM-Native-Charts` response header with the count. |
| `test/cm-native-chart-injector.test.mjs` | 80 unit + end-to-end tests for every builder and template. Covers backward-compat assertions on the dispatch types. |

## The 9 chart-XML builders

| Builder | OOXML construct | Used by |
|---|---|---|
| `buildSingleLineChartXml` | `<c:lineChart>` 1 series | `volume_ttm_by_quarter`, `cap_rate_ttm_by_quarter`, `market_turnover`, `bid_ask_spread` (quarterly fallback) |
| `buildSingleBarChartXml` | `<c:barChart>` 1 series | `transaction_count_ttm`, `avg_deal_size`, `yoy_volume_change`, `quarterly_volume_bars`, `renewal_rent_growth`, `leased_inventory_by_state` (horizontal), `sources_of_capital` (horizontal), `rent_heat_map` (horizontal) |
| `buildStackedBarChartXml` | `<c:barChart grouping="stacked">` N series. Supports `noFill`, `alpha`, `borderColor`, `grouping: 'clustered'`. | `lease_renewal_rate`, `buyer_pool_monthly_count`, `bid_ask_spread_monthly` (floating bar), `inventory_backlog` (clustered), `pace_of_cap_rate_expansion` (clustered), `buyer_class_pct_by_year`, `lease_termination_rate` (with helper col) |
| `buildMultiLineChartXml` | `<c:lineChart>` N series with optional `dashed` | `cap_rate_by_lease_term`, `nm_vs_market_cap`, `sold_cap_by_term_dot_plot`, `asking_cap_by_term_dot_plot`, `cap_rate_top_bottom_quartile`, `cap_rate_by_credit`, `cpi_vs_renewal_cagr`, `fed_funds_vs_treasury`, `cash_leveraged_returns`, `asking_cap_quartiles_active`, `rent_psf_box_quarterly` (P8 quartile band fallback before P8.5 upgrade), `net_lease_spread` |
| `buildComboChartXml` | `<c:barChart>` + `<c:lineChart>` sharing cat axis. Supports `barGrouping`, `sharedAxis`, `swapAxes`, per-series `noFill`/`alpha`/`borderColor` on bars, `showMarker`/`markerShape`/`markerSize`/`dashed` on lines. | `dom_and_pct_of_ask`(+monthly), `case_for_renewal`, `available_market_size_combo`, `valuation_index`, `txn_count_avg_deal_combo`, `rent_and_price_per_chair`, `rent_and_price_psf`, `dom_price_change_active`, `seller_sentiment`(+monthly), `rent_psf_box_quarterly` (P8.5 upgrade), `cost_of_capital`, `rent_by_year_built`, `available_by_term_summary`(+firm_term variant) |
| `buildScatterChartXml` | `<c:scatterChart>` with `<c:xVal>`+`<c:yVal>`, both axes are `<c:valAx>` (no `<c:catAx>`). Supports `showLine`+`dashed` for trendlines, `<a:alpha>` on markers for semi-transparent dots. | `core_cap_rate_dot_plot` (with rolling-avg trendline helper), `available_cap_rate_dot_plot` (with linear-regression trendline helper) |
| `buildAreaComboChartXml` | `<c:areaChart>` + `<c:barChart>` + `<c:lineChart>` in one plot area, sharing cat axis with 2 val axes (LEFT for area, RIGHT for bars+line). 3 chart blocks in one chartSpace. | `volume_cap_quartile_combo` only (the most complex shape in the catalog) |
| `buildDoughnutChartXml` | `<c:doughnutChart>` — axis-free radial chart with per-segment colors via `<c:dPt>` blocks, `<c:strRef>` for category labels (text), `<c:holeSize>` for cutout. | `available_by_tenant_count_donut`, `available_by_tenant_volume_donut` |
| `buildDrawingXml` | `<xdr:twoCellAnchor>` drawing that anchors a chart to a cell range | All of the above (every chart needs a drawing anchor) |

## Helper-column infrastructure

`buildInjectionSpec` can return a `helperCols` array alongside the spec. `cm-excel-export.js` writes the helpers to the right of the regular `CHART_COLUMNS` entries with the same styling (navy header, zebra-stripes, AutoFilter range extends). The helper-col letter is deterministic (`String.fromCharCode(65 + cols.length)`), so the spec can reference it ahead of time.

Each helper is `{ key, header, format, width, getValue: (row, idx, rows) => value }`. Examples in use:

- `rent_psf_box_quarterly` — `iqr_width` = `upper_q − lower_q` (writes a single computed column for the IQR bar's visible band)
- `volume_cap_quartile_combo` — `iqr_width` = `upper_q − lower_q` (same pattern)
- `cost_of_capital` — `loan_band_width` = `high_loan − low_loan` (visible band of the mortgage constant range)
- `lease_termination_rate` — `in_firm_term` = `Math.max(0, total − outside)` (computed bottom of the stacked bar)
- `core_cap_rate_dot_plot` — `trendline_12mo` = mean of cap_rate over rows within ±182 days
- `available_cap_rate_dot_plot` — `trendline_linear` = m·x + b (precomputed least-squares regression)

## Per-template dispatch table (51 native)

| chart_template_id | Dispatch type | Notes |
|---|---|---|
| asking_cap_by_term_dot_plot | multi-line | 4-line cohort (dia only) |
| asking_cap_quartiles_active | multi-line | 4-line, total solid + core dashed, light/dark blue |
| available_by_firm_term_summary | combo | 1 bar + 4 diamond markers (gov) |
| available_by_tenant_count_donut | doughnut | Count share by tenant |
| available_by_tenant_volume_donut | doughnut | Volume share by tenant |
| available_by_term_summary | combo | 1 bar + 4 diamond markers (dia) |
| available_cap_rate_dot_plot | scatter | + linear regression trendline (helper col) |
| available_market_size_combo | combo | 2 bars + 2 lines |
| avg_deal_size | bar | Single bar |
| bid_ask_spread | line | Quarterly fallback (no last_ask col) |
| bid_ask_spread_monthly | stacked-bar | Floating bar via invisible base + visible spread |
| buyer_class_pct_by_year | stacked-bar | Annual stacked, 4 capital-source segments |
| buyer_pool_monthly_count | stacked-bar | 3-series stack (Private/Inst/REIT) |
| cap_rate_by_credit | multi-line | 3-line federal/state/muni |
| cap_rate_by_lease_term | multi-line | 4-line cohort, dia vs gov cohort sniff |
| cap_rate_top_bottom_quartile | multi-line | 3-line, top/bottom dashed |
| cap_rate_ttm_by_quarter | line | Single line |
| case_for_renewal | combo | Bar + line, year x-axis |
| cash_leveraged_returns | multi-line | 2-line (cash + leveraged mid) |
| core_cap_rate_dot_plot | scatter | + 12-mo rolling-avg trendline (helper col) |
| cost_of_capital | combo | 2 lines + floating gray range bar (helper col), sharedAxis |
| cpi_vs_renewal_cagr | multi-line | 2-line CPI vs CAGR |
| dom_and_pct_of_ask | combo | DOM bars + % of ask line |
| dom_and_pct_of_ask_monthly | combo | Same shape, monthly |
| dom_price_change_active | combo | 2 bars + 2 lines (core dashed) |
| fed_funds_vs_treasury | multi-line | 2-line (mortgage 3rd series deferred — not in data tab) |
| inventory_backlog | clustered-bar | 2 bars: No. Added + No. Sold |
| lease_renewal_rate | stacked-bar | 5-series stack |
| lease_termination_rate | stacked-bar | Helper col in_firm_term = total − outside |
| leased_inventory_by_state | bar | Horizontal bar, top-N states |
| market_turnover | line | Single line |
| net_lease_spread | multi-line | 2-line (3rd cap_10plus_year not in data tab) |
| nm_vs_market_cap | multi-line | 2-line NM vs Market |
| pace_of_cap_rate_expansion | clustered-bar | 2 bars (mortgage line 3rd series deferred) |
| quarterly_volume_bars | bar | Single bar |
| renewal_rent_growth | bar | Single bar (R33 Tier D simplification) |
| rent_and_price_per_chair | combo | Bar (rent/chair) + line (price/chair), dia |
| rent_and_price_psf | combo | Bar (rent/SF) + line (price/SF), gov |
| rent_by_year_built | combo | Stacked-bar (invisible base + IQR helper col) + median/avg diamond markers, sharedAxis |
| rent_heat_map | bar | Horizontal bar fallback (choropleth blocked) |
| rent_psf_box_quarterly | combo | IQR band (helper col) + median line, sharedAxis |
| seller_sentiment | combo | swapAxes: 2 cap lines LEFT + 2 % change bars RIGHT |
| seller_sentiment_monthly | combo | Same shape, monthly |
| sold_cap_by_term_dot_plot | multi-line | 4-line cohort (dia/gov cohort sniff) |
| sources_of_capital | bar | Horizontal bar, top-N buyer states |
| transaction_count_ttm | bar | Single bar |
| txn_count_avg_deal_combo | combo | Bar (count) + line (avg deal $) |
| valuation_index | combo | swapAxes: line LEFT + YoY bars RIGHT |
| volume_cap_quartile_combo | area-combo | Area + IQR floating bars + avg cap dots (3 chart blocks) |
| volume_ttm_by_quarter | line | Single line (R34 P2 scaffold) |
| yoy_volume_change | bar | Single bar (signed-color deferred — would need `<c:dPt>` per point) |

## The 2 intentional non-charts

Both are product decisions, not technical blockers. They will never migrate without an upstream change:

- **`ppsf_box_quarterly`** — DROPPED from the runtime catalog in Round 6h (migration `20260601_cm_catalog_drop_8_view_less_rows_round6h.sql`, applied 2026-05-09). No view ever shipped, no exports ever produced this chart. The static JSON catalog `public/reports/cm_chart_catalog.json` still lists it but the DB catalog is the runtime source of truth.

- **`lease_structures`** — Renderer returns `null` by design (user feedback 2026-05-09: *"Data_Lease_Terms has a chart when what's in the PDF is just a table side by side"*). Tab ships only the data table, no chart object at all.

## Known visual defers

A few PDF visual details aren't expressible in native chart XML without per-data-point overrides (`<c:dPt>` blocks at every category index) or chartjs-plugin-equivalents that don't have OOXML analogs. These ship as native charts with the data fidelity intact but slightly different visual styling:

- **`yoy_volume_change`** + **`valuation_index`** — PNG renderer colors negative bars amber, positive sky. Native uses uniform sky.
- **`buyer_class_pct_by_year`** — PNG renderer adds in-bar datalabels via chartjs-datalabels (white text on dark bars, dark text on light bars). Native chart has no in-bar labels; users can right-click → Add Data Labels in Excel manually.
- **Donut charts** — PNG renderer adds value+share-% labels per segment via chartjs-datalabels. Native chart has no segment labels; user can right-click → Format Data Labels → check Category Name + Percentage.
- **`rent_by_year_built` + the `available_by_term_summary` family** — PNG renderer adds per-bar price annotations ("$2.5M"). Native chart has none.
- **Cap-rate scatter dot plots** — PNG renderer uses semi-transparent fill (`rgba(...,0.55)` for `core_cap_rate_dot_plot`, `(...,0.25)` for IQR bars in `volume_cap_quartile_combo`). Native chart uses `<a:alpha>` to match — verified to render correctly in Excel 2019+.

## How to add a new chart template

1. Pick a `chart_template_id` and define its CHART_COLUMNS schema in `cm-excel-export.js`.
2. Add the id to `NATIVE_CHART_TEMPLATES` in `cm-native-chart-injector.js`.
3. Add a switch case in `buildInjectionSpec` that maps the column layout to an injection spec. Match an existing shape from the dispatch table above if possible — most chart families now have a builder.
4. If the renderer plots a derived value (computed from other columns), declare it in the spec's `helperCols`. The export writer will materialize it as a column on the data tab and the chart spec can reference its letter via `String.fromCharCode(65 + cols.length)`.
5. Add tests to `test/cm-native-chart-injector.test.mjs`:
   - A `NATIVE_CHART_TEMPLATES.has('your_id')` registration check
   - A `buildInjectionSpec` unit test verifying the spec shape
   - An end-to-end XML test using `injectNativeCharts` to confirm the OOXML output

If the renderer wants a chart shape we don't have a builder for, look at adding a new builder. Each existing builder follows the same pattern (XML string template literal returning a chartSpace) so duplicating one is cheap. See `buildDoughnutChartXml` (R36 P2) and `buildAreaComboChartXml` (R34 P9) for the most recent additions.

## What's left

- **R33 Tier E1** — Rent_Price_PSF for dia. Blocked on product call: dia clinics rarely transact on $/SF basis (per 2026-05-06 hygiene audit). Options are (a) synthesize price_per_sf from per-clinic price + estimated SF, (b) ship rent-only single-bar variant, or (c) defer permanently.
- **R33 Tier E2** — Core_Cap_Dot trendline review. P7.5 shipped a 12-mo rolling avg per-sale (one trendline point per dot). The dia master template's Core Cap Chart sheet has a 2nd scatter series with ~63 data points (rows 637-699 per `dia-master-template-chart-inventory.txt`), suggesting a monthly-binned aggregation. Defer until user reviews the current trendline visual in a real export and decides whether to upgrade.

Both are decisions, not code work.

## Round-by-round contribution

| Round | PRs | Templates added | Builders/infrastructure added |
|---|---|---|---|
| R34 P1 | #823 | 0 | Revert dia default to data_tabs |
| R34 P2 | #824 | 1 | Scaffold: `buildSingleLineChartXml`, `buildDrawingXml`, `injectNativeCharts`, helper-col infra design |
| R34 P3 | #825 | 6 | `buildSingleBarChartXml`, dispatch by `spec.type` |
| R34 P4 | #826 | 2 | `buildStackedBarChartXml` |
| R34 P5 | #827 | 4 | `buildMultiLineChartXml` with cohort detection |
| R34 P6 | #828 | 4 | `buildComboChartXml` (dual-axis bar+line) |
| R34 P7 | #829 | 2 | `buildScatterChartXml` (xy plots, no cat axis) |
| R34 P7.5 | #832 | 0 (upgrades) | `showLine` + `dashed` on scatter series, trendline helper cols |
| R34 P8 | #830 | 3 | `noFill` on stacked bars (invisible-base floating bar) |
| R34 P8.5 | #831 | 0 (infra + upgrade) | Helper-column infrastructure; combo `barGrouping`/`sharedAxis`; `rent_psf_box_quarterly` upgrade |
| R34 P9 | #833 | 1 | Visible markers on combo line series (rent_by_year_built composite) |
| R33 Tier F1 | #834 | 1 | `swapAxes` on combo (line LEFT, bars RIGHT) |
| R35 P1 | #835 | 6 | (none — reused multi-line) |
| R35 P2 | #836 | 8 | `clustered-bar` dispatch; combo line `dashed` flag |
| R35 P3 | #837 | 2 | (none — reused builders) |
| R35 P4 | #838 | 2 | `buildAreaComboChartXml` (3-block area+bar+line); combo `alpha`+`borderColor` on bar series |
| R36 P1 | #839 | 2 | `horizontal` flag on single-bar (state-ranking visual) |
| R36 P2 | #840 | 2 | `buildDoughnutChartXml` (axis-free radial with per-segment `<c:dPt>`) |
| R36 P3 | #841 | 2 | (none — reused combo + showMarker) |
| R36 P4 | #842 | 3 | (none — reused helpers + horizontal-bar pattern) |
| **Total** | **20 PRs** | **51 templates** | **8 builders + helper-col infra + ~15 per-shape options** |
