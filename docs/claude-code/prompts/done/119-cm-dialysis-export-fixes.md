# Prompt 119 — CM Dialysis export fixes (marketing round, 2Q-2026 book)

## Context

Marketing (Sarah) built the 2Q-2026 Dialysis Market Filter from `NM-CapMarkets-Dialysis-2026-06-30 (3).xlsx`.
Five exporter defects surfaced during the build. All are in the CM export layer —
`api/_shared/cm-excel-export.js` (KPI/data tabs, `renderKpiBlockTab`, `CHART_COLUMNS` formats),
`api/_shared/cm-native-chart-injector.js` (native chart objects), and the views they read. The CM export
reads views per request (`no-store`), so any view fix is live immediately; JS changes ship on the next
Railway redeploy of merged `main` (then `npm run verify:deploy`).

Review the existing machinery before changing anything. Do not restructure the export; these are surgical fixes.

## Fixes

### A. KPI tile percent formats (KPI_Inv_Snapshot rows render as raw decimals)

The last two tiles of `KPI_Inv_Snapshot` ("10+ Year — Price Change %", "Total Market — Price Change %")
came over with `General` number format (`0.1505` instead of `15.0%`); the cap tiles above them correctly
got `0.00%`. Fix the format inference in the KPI tile rendering path (`renderKpiBlockTab` or its format
map) so percent-natured tiles always carry a percent format — prefer explicit per-tile format metadata
over label-sniffing if the packet supports it, but a label heuristic (`/%|cap|change|yoy|trend/i` on
ratio-scale values < 1) is acceptable if metadata isn't plumbed. Audit ALL KPI tabs
(`KPI_Whats_New`, `KPI_Trend_Watch`, `KPI_Value_Prop`, `KPI_Inv_Snapshot`) for the same defect.

### B. KPI_Whats_New "Cap Rate (TTM)" tile is wrong (7.41% vs the real 7.06%)

`KPI_Whats_New` shows `Cap Rate (TTM) = 0.07411875`, while `Data_Cap_Avg` (the TTM cap series the book
quotes everywhere, incl. page 3) ends at `0.070565` for 2026-06-30. Trace what the What's-New tile reads
(likely an unweighted simple average or a different band/filter than the `cm_dialysis_cap_ttm` series) and
point it at the SAME series/definition as `Data_Cap_Avg`'s latest value. The book's 7.06% is correct; the
tile is the defect. Add a regression test asserting the tile equals the last row of the cap-TTM series.

### C. KPI_Inv_Snapshot vs Data_On_Market_Snapshot disagree on DOM / price-change

Same quarter, two answers: KPI tab says Total DOM 480.7 / 10+ DOM 398.9; `Data_On_Market_Snapshot` says
483.1 / 421.1 (10+ price-change agrees at 5.26%; total price-change agrees at 15.05%). The book renders
both tabs (Trend Watch KPI block + the On-Market Snapshot page), so the discrepancy is client-visible.
Find where each pulls from (different views or different as-of/filter windows — the 10+ DOM gap of 22
days suggests a cohort filter difference, not rounding) and make ONE canonical source feed both tabs.
`Data_On_Market_Snapshot` carries the year-ago comparison and drives the book's snapshot page, so unless
you find its definition is wrong, align the KPI tab to it. Document the chosen definition in the tab's
descriptor row.

### D. Data_Operator_Bench — emit short operator display names

The operator-benchmark bar chart's y-axis labels are unreadable at book size. Map to short display names
at export time (data tab + native chart categories), keeping the full name available in the descriptor
if useful:

| Source | Display |
|---|---|
| American Renal Associates | American Renal |
| DaVita | DaVita |
| Fresenius Medical Care | Fresenius |
| US Renal Care | US Renal |
| Independent / Unknown | Independent |
| Other / Independent | Other |
| Satellite Healthcare | Satellite |

Apply the same mapping to any other operator-keyed CM chart (`Data_Operator_Unit_Econ`,
`Data_Facility_Scale` if operator-labeled) for consistency.

### E. Buyer Pool — Annual % of Volume: suppress zero data labels

The stacked/clustered annual buyer-share bars carry a data label on every point; series that are 0% in a
given year (Cross-Border most years, Public REIT in several) stack "0%" labels on top of each other at
the top of the chart. In `cm-native-chart-injector.js`, for the `buyer_class_share` template, set the
data-label number format to `0%;;;` (zeros render blank) — or omit `<c:dLbl>` entries for zero-value
points if per-point control is already available. Verify against the marketing chart-formatting spec in
`public/reports/cm-brand.json` (label size 9pt per marketing's ChartEdits doc; Private % and Public REIT %
labels white per the same doc — adopt those into the template while you're in there).

### F. KPI_Value_Prop — add the two tiles marketing had to hand-compute

Add two rows to `KPI_Value_Prop`, derived from the existing NM / Non-NM price tiles:
`Additional Proceeds ($) = NM avg price − Non-NM avg price` (currently $5,182,180 − $4,912,611 = $269,569)
and `Additional Value (%) = Additional Proceeds ÷ Non-NM avg price` (5.5%). Format `$#,##0` and `0.0%`.
Null-safe: if either input is absent, emit "Not on file", never a fabricated value.

## Discipline

- Sub-route/handler conventions per `.github/AI_INSTRUCTIONS.md`; no new top-level `api/*.js`.
- Tests: extend the existing CM suites (`cm-native-chart-injector.test.mjs`, cohort/column prune tests);
  add the B regression test. Full CM suite green before merge.
- These are dialysis-branch changes — do NOT disturb the gov 3-bucket cohort work (§28 gov CLAUDE.md) or
  the gov chart templates.
- Descriptive Round-numbered commit; branch + PR per repo workflow. After merge: Railway redeploy of both
  services is the ship gate; `npm run verify:deploy`.
- Acceptance: regenerate the dialysis export and verify (1) all KPI percent tiles formatted, (2)
  What's-New cap tile == Data_Cap_Avg last row, (3) KPI_Inv_Snapshot DOM rows == Data_On_Market_Snapshot,
  (4) operator chart shows short names, (5) buyer-share chart has no zero labels, (6) KPI_Value_Prop has
  the two new tiles.
