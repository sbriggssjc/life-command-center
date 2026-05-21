# CM Data Completeness — empty / sparse column inventory

Generated 2026-05-21 from `audit/cm-style-audit/data-completeness.mjs`
against `NM-CapMarkets-Dialysis-2026-03-31.xlsx` + `NM-CapMarkets-GovLeased-2026-03-31.xlsx`.

Scans every `Data_*` tab and reports any data column that's < 50% populated.

## TL;DR

**34 dia + 35 gov empty/sparse data columns**, split into 4 patterns:

| Pattern | Severity | Cause | Fix scope |
| --- | --- | --- | --- |
| **A. Cross-schema cohort columns** | Spreadsheet noise (chart unaffected) | Each vertical's data tab carries BOTH dia + gov cohort columns; chart only reads the relevant ones | Drop unused cohort cols from `CHART_COLUMNS` per vertical (cm-excel-export.js) |
| **B. Computed columns view doesn't emit** | ⚠ Some chart-visible | Catalog declared these columns but Supabase views don't populate them | Add to view OR drop from `CHART_COLUMNS` |
| **C. Median/secondary columns chart doesn't render** | Spreadsheet noise | Data tab includes columns the chart never references | Drop from `CHART_COLUMNS` or populate at view level |
| **D. NM-listed flag missing** | ⚠ Could affect chart styling | `Data_Avail_Cap_Dot.NM-Listed` empty — chart can't distinguish NM vs market dots | Verify view emits the column |

## Detailed findings

### Pattern A — cross-schema cohort ghosts (BOTH verticals)

These look messy in the data table but **the charts render correctly** because they only reference the vertical-appropriate cohort columns.

**Dia `Data_Sold_Cap_by_Term`** has the **gov** cohort columns empty:
- col G "10+ Year Cap" — 0/303 ✗
- col H "6-10 Year Cap" — 0/303 ✗
- col I "< 5 Year Cap" — 0/303 ✗
- col J "Outside Firm Cap" — 0/303 ✗
- col F "≤5 Year Cap" — 47% (dia cohort, partial — likely real data sparseness in older years)

**Gov `Data_Cap_by_Term` + `Data_Sold_Cap_by_Term`** have the **dia** cohort columns empty:
- col C/G "12+ Year Cap" — 0/303 ✗
- col D/H "8–12 Year Cap" — 0/303 ✗
- col E/I "6–8 Year Cap" — 0/303 ✗
- col F/J "≤5 Year Cap" — 0/303 ✗

The chart-injector switches on the cohort scheme at render time (sniffs dia vs gov from row data), so visually the charts are correct. But the data table has 4 always-empty columns per side.

**Fix:** make `CHART_COLUMNS` for these templates vertical-aware so each export emits only the relevant cohorts. Removes 16 ghost columns across the 4 affected tabs.

### Pattern B — view doesn't emit the declared column

These are chart-relevant in some cases:

**Dia `Data_Volume_TTM` col D "YoY Change" — 0/303 ✗**
→ Spreadsheet noise. The YoY chart pulls from `Data_YoY_Change` (separate tab), not this column. Drop or keep as nice-to-have.

**Gov `Data_Volume_TTM` col D "YoY Change" — 0/303 ✗**
→ Same as above. Spreadsheet noise.

**Dia + Gov `Data_Val_Index` col H "N Sales (Q)" — 0/195 ✗**
→ Sample-size column never plotted. Spreadsheet noise. Drop.

**Dia `Data_Val_Index` col C "Expenses PSF (TTM)" + col D "NOI PSF (TTM)" — 0/195 ✗ ✗**
→ Not in the gov data tab. View doesn't compute. The catalog was set up for both verticals to carry these as context columns but only dia has them declared. Drop from dia `CHART_COLUMNS`.

**Dia `Data_Sentiment` col D "N (8+ yr)" — 0/303 ✗**
→ Sample-count column. Spreadsheet noise. Drop.

**Gov `Data_Cap_by_Credit` cols D + E "State Cap" + "Municipal Cap" — 0/303 ✗ ✗**
→ ⚠ **Chart-visible.** The Cap-by-Credit chart shows 3 lines (Federal/State/Municipal). State and Municipal are entirely empty — chart will show only Federal. Catalog notes this is data-availability driven ("0 state + ~5 municipal sales with valid cap rates" — R21 changelog). Either accept (data isn't there) or backfill from external state/muni records.

**Gov `Data_DOM_Ask` col D "Median DOM" + col F "Median % of Ask" — 0/303 ✗ ✗**
→ Median columns not used by chart (chart plots avg only). Spreadsheet noise. Drop.

**Dia `Data_Pace_Cap_Expand` col C "Pace — 10+ Year Cohort" — 0/291 ✗**
→ ⚠ **Chart-visible.** The Pace chart has 2 bars (pace_all + pace_core). pace_core is the 10+ year cohort. If empty, the chart shows only 1 bar even though the legend implies 2. View likely doesn't compute pace_core for dia.

**Dia + Gov `Data_Returns_Idx` cols D + E "Leveraged High/Low (180bps/220bps)" — 0/303 ✗ ✗**
→ Renderer only plots Cash Return + Leveraged Return Mid (line ~2496). High/Low bands are present in the schema but not computed. Spreadsheet noise OR fix the view to emit them and let users build their own scenarios.

### Pattern C — median columns chart doesn't render

Already covered above (Gov DOM_Ask). Same idea applies to a few others — chart only renders 1 of N declared columns.

### Pattern D — flag columns

**Dia `Data_Avail_Cap_Dot` col D "NM-Listed" — 0/65 ✗**
→ Empty NM flag column. Chart can't distinguish NM-brokered vs market listings. The renderer at line 2092+ explicitly merged NM + market dots into one series in R30 ("we do not need to differentiate NM sales and the balance"), so this column is no longer used. Spreadsheet noise. Drop from `CHART_COLUMNS`.

### Other / structural

- **Dia `Data_NM_Notable_Txns` col I "Buyer Type" — 33%** — Buyer Type is genuinely sparse in source data. Acceptable.
- **Gov `Data_Lease_Terms` cols C/D/E — 38%** — `Last 12 Months` data is the latest 6 of 16 lease term buckets; lookback context columns may be sparser by design. Verify.
- **Dia `Data_On_Market_Snapshot` col E — empty (1 row only)** — Snapshot tab with one period; probably a placeholder. Low priority.
- **Gov `Data_Avail_Cap_Dot` range "2026-05-21 → 2026-05-21"** — Single snapshot date (correct; this is point-in-time active inventory).
- **Gov `Data_Rent_Price_PSF` range starts "25658"** — Excel serial date 25658 = 1970-04-01. Audit script picked up a non-A column as the date column. The actual TTM range is fine (the A column does have proper dates from 2010+).

## Recommended next-step PRs

1. **R43** — Drop empty columns from `CHART_COLUMNS` per vertical for:
   - `Data_Sold_Cap_by_Term` (dia: drop gov cohorts; gov: drop dia cohorts)
   - `Data_Cap_by_Term` (gov: drop dia cohorts — they're not in PHASE_1_TEMPLATES gov order but in CHART_COLUMNS schema)
   - `Data_Volume_TTM` (drop YoY Change col)
   - `Data_Val_Index` (drop Expenses PSF / NOI PSF / N Sales cols)
   - `Data_Sentiment` (drop N 8+ yr col)
   - `Data_DOM_Ask` (drop Median DOM / Median % of Ask cols)
   - `Data_Returns_Idx` (drop Leveraged High/Low cols)
   - `Data_Avail_Cap_Dot` (drop NM-Listed col)

   Net: ~22 ghost columns removed from data tabs. No chart logic changes.

2. **R44** — Address Pattern B chart-visible gaps:
   - Backfill `pace_core` for dia OR drop the pace_core series from the chart
   - Confirm `state` / `municipal` cap-by-credit is truly empty (no remediation possible) and update the chart caption to mention data availability

3. **R45** (optional) — Backfill the leveraged high/low band metrics if the BOV team wants scenario-driven Returns Idx.
