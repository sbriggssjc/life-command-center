# Capital Markets — PDF vs Excel Export Chart Deltas

**Source PDFs reviewed (2026-05-07):**
- `The Dialysis Market Filter (4Q-2025).pdf` — 43 pages, ~18 chart pages
- `State of the Government-Leased Market (2024-Q2).pdf` — 41 pages, ~22 chart pages

This is a chart-by-chart inventory comparing what's in the PDF deliverables vs what we ship in the Excel exports today. Each entry calls out **chart type**, **what the PDF shows**, **what our export shows**, and **specific deltas to fix**.

Visual style notes that apply globally to both decks:
- Brand palette: Northmarq navy `#003DA5` for primary lines, sky blue `#62B5E5` for secondary, pale blue `#E0E8F4` for fills/bars, gray `#6A748C` for axis/text
- Calibri family typography
- All quarterly time-series x-axis labels formatted as `Q4-YYYY` or month-yy abbreviated (`Jun-10`, `Dec-25`)
- Annotated callout boxes: small filled rounded-rectangle with white text on navy/sky-blue bg, leader line to the data point
- Footer caption strip: pale blue full-width box with italic text, summarizes the chart's takeaway
- Each PDF chart spans roughly half the page; the other half is narrative text in two columns
- Legend always at the bottom, single row, with small color-coded markers

---

## DIALYSIS PDF — chart inventory

### p.17 — Valuation Index
- **Type**: Combo: dark blue line (Valuation Index, left axis 200–400) + light blue thin vertical bars (YOY Change %, right axis -15% to +25%)
- **X-axis**: monthly, Jun-10 → Dec-25 (~16 years)
- **Annotations**: callout boxes at peaks: `22%`, `11%`, `10%`, `9%`, `375.2`, `304.3`, plus dip annotations `-2%`, `-11%`, `-9%`
- **Footer caption**: pale blue strip with italic summary
- **Our export equivalent**: `Data_Val_Index` — currently a single-line chart from `cm_dialysis_valuation_index_q`, no YoY bars overlay
- **Deltas to fix**:
  - [ ] Add YoY % series as light blue bars on right axis (combo chart, was just a line)
  - [ ] Add annotated callout boxes at peaks/troughs
  - [ ] Add italic footer caption strip ("10-yr UST: X% on date Y; …")
  - [ ] Switch to monthly TTM (still quarterly per user feedback)

### p.18 — Annualized Cash and Leveraged Return
- **Type**: 2-line chart, single Y-axis (4.00%–13.00%)
- **Series**: Cash Return Index (dark navy), Leveraged Return Index (sky blue)
- **X-axis**: monthly, Aug-09 → Dec-25
- **No annotations, no shaded regions**
- **Footer**: pale blue caption strip
- **Our export equivalent**: `Data_Returns_Idx` — chart config exists (`cash_leveraged_returns`) reads `cash_return / leveraged_return_*` columns
- **Deltas to fix**:
  - [ ] Verify data is present back to 2009 (currently sparse)
  - [ ] Add footer caption strip
  - [ ] Confirm colors match (navy + sky)
  - [ ] Switch to monthly cadence

### p.19 — Volume & Cap Rate Ranges
- **Type**: COMBO with **THREE distinct visualization layers**:
  1. Light blue **shaded area** behind everything = TTM Sales Volume (left axis $0–$1,400M)
  2. **Vertical thin lines** (range bars) = upper-to-lower quartile cap rate range, monthly
  3. **Dots** along each range bar = TTM avg cap (right axis 5.50%–8.50%)
- **X-axis**: monthly, Dec-14 → Dec-25
- **Annotations**: blue boxes with cap %s `8.28%`, `7.24%`, `6.43%`, `8.09%`, `7.57%`, `6.68%`
- **Legend**: only 2 items: "Sales Volume (ttm)" + "Cap (ttm)"
- **Our export equivalent**: `Data_Vol_Cap_Combo` (synthetic from volume_ttm + cap_rate_ttm + quartile)
- **Deltas to fix**:
  - [ ] **Replace area+lines with area+RANGE BARS+DOTS** (currently 4-line + area, should be range bars + dots)
  - [ ] Cap-rate dots should sit on top of vertical range lines, not be separate lines
  - [ ] Remove discrete upper/lower quartile lines; combine into vertical range bar
  - [ ] Add annotated callouts at major cycle peaks/troughs
  - [ ] Add footer caption strip

### p.21 — Transaction Velocity (TWO stacked charts)
- **Top chart**: Y-O-Y Change (%) — single dark blue line, Y-axis -100% to +200%, X-axis monthly Dec-10 → Dec-25
- **Bottom chart**: Quarterly Volume — single light blue bar series, Y-axis $0M–$450M, X-axis quarterly Dec-10 → Dec-25
- **Each chart has its own title in dark blue serif**: "Y-O-Y Change (%)" and "Quarterly Volume"
- **Annotations**: callouts on YoY peaks/troughs (`72%`, `-32%`, `55%`, etc.)
- **Our export equivalent**:
  - Data_YOY_Change uses `yoy_volume_change` template (single line) — close but missing annotations
  - Data_Volume_TTM uses `volume_ttm_by_quarter` (TTM line, NOT quarterly bars)
- **Deltas to fix**:
  - [ ] Page 21 PDF actually shows **quarterly** (not TTM) volume bars — we currently ship TTM line. Add a quarterly-volume bar chart variant (`quarterly_volume_bars` template)
  - [ ] Add annotations on YoY peaks/troughs
  - [ ] Match Y-axis range: -100% to +200% (not auto-scaled)

### p.22 — Cap Rate Comparison: Value of Lease Term
- **Type**: 4-line chart, single Y-axis (5.00%–10.00%)
- **Series + colors**:
  - Purple line: 12+ Year Cap (TTM)
  - Green/teal line: 8 to 12 Year Cap (TTM)
  - Sky blue line: 6 to 8 Year Cap (TTM)
  - Dark navy line: 5 or Less Year Cap (TTM)
- **X-axis**: monthly, May-19 → Dec-25 (~6.5 years — much shorter window)
- **Annotations**: endpoint values on each line (`9.46%`, `7.54%`, `6.44%`, `6.06%`, `5.84%`, `5.58%`, `5.08%`, `8.29%`, `7.28%`, `6.89%`)
- **Our export equivalent**: `Data_Cap_by_Term` (cap_rate_by_lease_term)
- **Deltas to fix**:
  - [ ] **Color scheme**: PDF uses purple/green/sky/navy — our renderer uses palette[0]/[2]/[1]/[4] which doesn't match
  - [ ] Add endpoint value annotations
  - [ ] Bucket boundaries: PDF uses **12+/8-12/6-8/≤5** — we use 10+/6-10/<5 (different cutoffs!) — needs view rebuild
  - [ ] X-axis window only ~6.5 years (May-19 → Dec-25), not 25 years

### p.23 — Cost of Capital
- **Type**: COMBO with **THREE layers**:
  1. Sky blue line bottom: 10-Year Treasury Yields (single axis 0%–10%)
  2. Dark navy line upper: Cap (TTM)
  3. **Thin gray vertical dashed bars** between them = mortgage constant range (the "loan-constant band")
- **X-axis**: monthly Sep-09 → Dec-25
- **Legend**: "10-Year Treasury Yields" + "Cap (ttm)"
- **No range bars labels in legend** — the dashes are visual only
- **Our export equivalent**: `Data_Cost_Capital` uses `cost_of_capital` chart config — has 5 lines (treasury, avg cap, 10+ cap, low loan const, high loan const)
- **Deltas to fix**:
  - [ ] **Replace high/low loan const LINES with vertical dashed RANGE BARS** between the two cap rate lines
  - [ ] Drop "10+ Year Cap" line — keep only avg Cap (TTM)
  - [ ] Tighten visualization to 3 visible elements (treasury, cap, mortgage band)

### p.24 — Pace of Cap Rate Expansion
- **Type**: COMBO with **bars + bars + line**:
  - Dark navy bars: Cap Expansion/Compression Pace
  - Light blue bars (overlapping): Cap Expansion/Compression Trend (Core)
  - Teal/green line: Pace of Change in Borrowing Cost
- **Y-axis**: -1.50% to 2.50%
- **X-axis**: monthly Feb-10 → Dec-25
- **Our export equivalent**: NOT IN OUR EXPORT — `pace_of_cap_rate_expansion` chart_template_id doesn't exist
- **Deltas to fix**:
  - [ ] **NEW CHART** required: build a `pace_of_cap_rate_expansion` template + view + chart config
  - [ ] Source data: monthly delta of `avg_cap_rate_ttm` (annualized); same for core 10+; treasury delta as third series

### p.25 — Transaction Count & Average Deal Size
- **Type**: COMBO bars + line+dots, dual axis
- **Light blue bars**: Transaction Count (TTM) — left axis 0–350
- **Dark navy line + dots**: Avg Deal Size — right axis $0–$6M
- **X-axis**: monthly Jun-18 → Dec-25
- **Annotations**: `243`, `$5.09`, `312`, `$3.35`, `$3.14`, `$3.38`, `152`, `103`, `$3.92`
- **Legend**: "Transaction Count (ttm)" + "Avg Deal Size"
- **Our export equivalent**: `Data_Avg_Deal` + `Data_Txn_Count` (separate tabs in our export)
- **Deltas to fix**:
  - [ ] **Combine into ONE chart** in the export — currently we ship as two separate tabs
  - [ ] Add count + deal size annotations at peaks/troughs
  - [ ] Match Y-axis ranges (0–350 / $0–$6M)

### p.26 — Rent & Price Per Square Foot
- **Type**: COMBO bars + line+dots, dual axis
- **Light blue bars**: Price per SF (TTM) — **right axis $200–$500** (NOTE: bars on right axis, line on left)
- **Dark navy line + dots**: Rent per SF (TTM) — **left axis $0–$30**
- **X-axis**: monthly Aug-18 → Dec-25
- **Annotations**: `$23.72`, `$22.20`, `$25.39`, `$21.65`, `$26.07`, `$24.74`, `$416`, `$324`, `$331`, `$21.91`
- **Our export equivalent**: NOT IN OUR EXPORT — no `rent_psf_combo` template exists
  - We have `Data_Rent_PSF_Box` (box-plot) which is different
- **Deltas to fix**:
  - [ ] **NEW CHART** required: `rent_and_price_psf` combo (rent line + price bars on dual axis)
  - [ ] Add annotations at peaks/troughs
  - [ ] Note dual-axis flip: bars on right, line on left

### p.27 — Buyer Pool & Cap Rates
- **Type**: STACKED bar chart, 3 series
- **Series**: Individual Count (dark navy bottom), Fund Count (sky blue middle), REIT Count (sage green top)
- **Y-axis**: 0–350
- **X-axis**: monthly Aug-18 → Dec-25
- **No annotations, no overlay lines**
- **Our export equivalent**: `Data_Buyer_Pool` uses `buyer_class_pct_by_year` — annual % stacked, NOT monthly count stacked
- **Deltas to fix**:
  - [ ] **Switch to monthly count-stacked** (not annual %-stacked)
  - [ ] **Drop cross-border bucket from chart** (PDF only shows Individual / Fund / REIT)
  - [ ] Match colors: dark navy / sky blue / sage green (palette[0]/[1]/teal)

### p.29 — On-Market Snapshot (TABLES, no chart)
- **Type**: Two side-by-side metric tables: "Total Market" | "10+ Year Term"
- Each row: icon + label + Current (Q4 2025) value + arrow up/down + prior year (Q4 2024) value
- Rows: Number Available, Average Price, Average Cap, Upper Quartile, Lower Quartile, Median, Days on Market, Price Change
- **Our export equivalent**: NOT IN OUR EXPORT
- **Deltas to fix**:
  - [ ] **NEW LAYOUT** — Excel `On-Market_Snapshot` tab with two-column comparison table, formatted with arrow indicators (↑ ↓)

### p.30 — Supply Side Metrics (TWO charts)
- **TOP**: Combo bars + 2 lines, quarterly Q3-17 → Q4-25
  - Pale teal bars: Total Market - No. Available
  - Lighter sky bars: 10+ Year Term - No. Available (overlaid)
  - Sky blue line: Total Market - Avg Cap
  - Dark navy line: 10+ Year Term - Avg Cap
  - Dual axis: 0–180 left (count), 4.50%–7.00% right (cap)
- **BOTTOM**: 4 grouped bars + dots
  - X-axis categories: Sub 5 Year Term / 5-8 Year Term / 8-12 Year Term / 12+ Year Term
  - Sky blue bars: Avg Price (left axis $0–$8M)
  - Dots in 4 different colors: Avg Cap, Upper Quart, Lower Quart, Median (right axis 3.50%–8.00%)
- **Our export equivalent**: `Data_Avail_Mkt_Size` exists for top half (`available_market_size_combo`); bottom is missing
- **Deltas to fix**:
  - [ ] Top chart: verify count + cap series both render correctly
  - [ ] **NEW CHART**: bottom 4-group bar+dots chart by lease-term cohort (`available_by_term_summary` template)

### p.31 — Asking Cap Rate Ranges + Marketing Duration (TWO charts)
- **TOP**: 4-line chart
  - Total Market - Upper Quart (sky blue)
  - Total Market - Lower Quart (sky blue darker)
  - 10+ Year Term - Upper Quart (dark navy dashed)
  - 10+ Year Term - Lower Quart (dark navy solid)
  - Y-axis 4.50%–7.50%
- **BOTTOM**: Combo
  - Pale bars: Total Market - DOM (left axis 0–600 days)
  - Pale purple bars: 10+ Year Term - DOM (overlaid)
  - Sky blue line: Total Market - Price Change % (right axis 0–70%)
  - Dark navy line: 10+ Year Term - Price Change %
- **Our export equivalent**: `Data_Active_Cap_Quart` (top) + `Data_Active_DOM_PC` (bottom)
- **Deltas to fix**:
  - [ ] Top: PDF uses sky/sky-darker/navy-dashed/navy-solid — verify we match
  - [ ] Bottom: verify dual axis ranges (0–600 days, 0–70%)

### p.32 — Available Clinics by Tenant
- **Type**: TABLE + 2 DONUT charts
- **Table**: rows DaVita / FMC / US Renal, columns: Count Available / Volume Available / Avg Deal Size / Avg Term Remaining / Avg Asking Cap / Avg Days on Market
- **Donut 1**: "COUNT AVAILABLE" — 3 segments (DaVita 56 / FMC 35 / US Renal 10)
- **Donut 2**: "VOLUME AVAILABLE" — 3 segments ($196.4M / $144.5M / $43.6M)
- Both donuts have empty center holes
- Color: dark navy / sky blue / sage green
- **Our export equivalent**: `Data_Avail_by_Tenant` table only
- **Deltas to fix**:
  - [ ] **ADD 2 DONUT CHARTS** alongside the table (one for count, one for volume)
  - [ ] Match colors

### p.33 — Days on Market & % of Ask Price
- **Type**: COMBO bars + line+dots
- **Light blue bars**: Days on Market (TTM) — left axis 0–300
- **Dark navy line + dots**: % of Ask — right axis 84.0%–96.0%
- **X-axis**: monthly Jun-18 → Dec-25
- **Annotations**: `95.3%`, `173`, `88.6%`, `283`, `255`, `89.9%`
- **Our export equivalent**: `Data_DOM_Ask` (`dom_and_pct_of_ask`)
- **Deltas to fix**:
  - [ ] Tighten right axis from default to 84%–96% (currently might be 90%–105% from D2 fix)
  - [ ] Add annotations

### p.34 — Bid-Ask Spread
- **Type**: COMBO **range-bar chart** + scatter dashes
- Each x-position has:
  - A vertical light gray-sky range bar (high-to-low for that month) showing spread
  - A sky blue dash AT THE BOTTOM of bar = Last Ask (TTM)
  - A dark navy dash IN THE MIDDLE = Bid-Ask Spread
- Each dash also has a tiny number annotation
- **Y-axis**: 5.25%–8.00%
- **X-axis**: monthly Mar-18 → Dec-25
- **Our export equivalent**: `Data_Bid_Ask` is bar+line, not a range-bar visual
- **Deltas to fix**:
  - [ ] **REPLACE bar+line with range-bar visualization** (high-low whisker bars + scatter dashes)
  - [ ] Y-axis range 5.25%–8.00% (tight)

### p.35 — Seller Sentiment and Confidence
- **Type**: COMBO bars + 2 lines, dual axis
- **Sage green bars**: Price Change (TTM)
- **Light purple bars**: 10+ Year Price Change (TTM)
- **Dark navy line**: Last Ask (TTM)
- **Sky blue line**: 10+ Year Ask (TTM)
- **Left axis**: Average Asking Cap Rate 4.75%–7.25%
- **Right axis**: Average Portion of Broadly Marketed Deals that Changed Price 0%–70%
- **Our export equivalent**: `Data_Sentiment` (`seller_sentiment`)
- **Deltas to fix**:
  - [ ] Bar colors: sage green + light purple (currently palette[3]/[1])
  - [ ] Dual axis ranges: 4.75%–7.25% left, 0%–70% right
  - [ ] Verify both bar series render

---

## GOV PDF — chart inventory

### p.10 — Government Leased Valuation Index
- **Type**: Combo: dark navy line (Valuation Index) + light blue thin bars (YOY Change %), dual axis
- **X-axis**: quarterly Q2-1998 → Q2-2024 (~26 years)
- **Y-axes**: -80% to +120% left (YoY), 0–300 right (Index)
- **Annotations**: `95.8%`, `54.1%`, `57.3%`, `14.5%`, `6.6%`, `12.7%`, `-54.0%`, `-15.2%`, `-39.9%`, `-7.4%`, `208.6`, `246.2`, `236.0`
- **Our export equivalent**: `Data_Val_Index` for gov uses `valuation_index` template — single line
- **Deltas to fix**:
  - [ ] Add YoY % bar overlay (combo dual-axis chart)
  - [ ] Add annotations at peaks/troughs
  - [ ] Verify x-axis goes back to 1998

### p.11 — Volume & Cap Rate Ranges
- Same chart structure as Dialysis p.19 (range bars + dots + shaded volume area)
- **PLUS**: summary table beneath: Trans Vol (ttm) / Upper Quart / Lower Quart / Average Cap, by 2Q-2024 / 1Q-2024 / 2Q-2023 / 2Q-2022 / 5-yr / 10-yr / 15-yr avg
- **Deltas to fix**:
  - [ ] Same as dialysis p.19 (range-bar visualization)
  - [ ] Add summary table beneath chart

### p.12 — YOY Change (%)
- **Type**: SINGLE dark navy line, Y-axis -200% to 600%
- **X-axis**: monthly 2Q-2000 → Q2-2024
- **Annotations**: peak/trough callouts
- **Our export equivalent**: `Data_YoY_Change` (`yoy_volume_change`)
- **Deltas to fix**:
  - [ ] Add peak/trough annotations
  - [ ] Verify y-axis range matches (auto-scaled is fine, the data range is wild)

### p.13 — Cap Rate Comparison: Firm Lease Term
- **Type**: 4-line + summary table
- **Lines (PDF)**:
  - Dark navy: 10+ Year Cap (TTM)
  - Sky blue: 6 to 10 Year Cap (TTM)
  - Light blue: Less than 5 Year Cap (TTM)
  - Dark gray: Outside Firm Term (TTM)
- **Y-axis**: 5.00%–11.00%
- **Summary table beneath**: cap by cohort with 5/10/15-yr avgs
- **Our export equivalent**: `Data_Cap_by_Term` (`cap_rate_by_lease_term`)
- **Deltas to fix**:
  - [ ] **Bucket boundaries**: gov uses 10+/6-10/<5/Outside (no 5-8 cohort) — we have 10+/5-10/<5/outside which differs
  - [ ] **Color**: dark gray for "Outside Firm" line specifically (we use palette[4] which is similar but verify)
  - [ ] Add summary table beneath chart

### p.14 — Cap Rate by Government Type
- **Type**: 3-line + summary table
- **Lines**:
  - Dark navy: Federal Cap
  - Sky blue: State Cap
  - Dark gray: Municipal Cap
- **Y-axis**: 5.50%–9.00%
- **Summary table beneath**: Federal/State/Muni × current quarter / prior quarters / 5/10/15-yr avgs
- **Our export equivalent**: `Data_Cap_by_Credit` (`cap_rate_by_credit`)
- **Deltas to fix**:
  - [ ] **Critical data ceiling**: only 2 state + 2 muni sales in our gov feed have cap rate. Without external data import, this chart will keep showing only Federal
  - [ ] Add summary table beneath chart

### p.15 — Cost of Capital
- Same structure as Dialysis p.23: 2 lines + range-bar mortgage constant overlay
- **Lines**: 10-Year Treasury (sky blue), Average Cap Rate TTM (light blue), 10+ Year Cap (dark navy)
- **Range bars**: Low/High Assumed Loan Constant (gray dashes)
- **Our export equivalent**: `Data_Cost_Capital` — has all 5 series as lines
- **Deltas to fix**: same as dialysis p.23

### p.16 — Annualized Cash & Leveraged Return Indexes
- Same structure as Dialysis p.18: 2-line, single Y-axis
- **Our export equivalent**: `Data_Returns_Idx` 
- **Deltas to fix**: data sparsity check; footer caption; monthly TTM

### p.17 — Transaction Count & Average Deal Size
- Same structure as Dialysis p.25: bars + line+dots, dual axis + summary table
- **PLUS** summary table beneath with 2Q-24 / 1Q-24 / 2Q-23 / 2Q-22 / 5/10/15-yr avgs
- **Deltas to fix**: combine count + deal size into one tab; add summary table

### p.18 — Buyer Pool
- **Type**: ANNUAL stacked-percentage bar chart (NOT monthly count like dialysis)
- **Series**: Private Volume (TTM) navy / Public Listed/REIT (light blue) / Cross-Border (sky blue) / Institutional (sage)
- **X-axis**: 2016 / 2017 / 2018 / ... / 2024 (YTD) / 5-Year Avg
- **Each bar shows percentages stacked to 100%**
- **Annotations**: percentages at top of each segment
- **Summary table beneath**: full breakdown by year (Volume + Count for each category)
- **Our export equivalent**: `Data_Buyer_Pool` matches structure (yearly stacked %) — closer match
- **Deltas to fix**:
  - [ ] Add the "5-Year Avg" final column on the right
  - [ ] Add segment-level percentage annotations
  - [ ] Add summary table beneath

### p.19 — Sources of Capital (US MAP)
- **Type**: US state-level bubble map
- States are colored darker for higher dollar volumes; circles overlaid on top states with `$X.XB` labels
- **Our export equivalent**: `Data_Sources` is a horizontal bar chart of top states by 15y volume
- **Deltas to fix**:
  - [ ] **MAP visualization required** — Chart.js doesn't natively support choropleth. Options: (a) use QuickChart's GeoMap support, (b) use a library like Datawrapper, (c) skip the map and ship horizontal bar chart instead with a note

### p.20 — Days on Market & % of Ask Price
- Same structure as Dialysis p.33: bars + line+dots, dual axis
- **Y-axes**: 0–350 left (DOM), 82%–96% right (% of Ask)
- **Deltas to fix**: same as dialysis p.33

### p.21 — Bid-Ask Spread
- Same structure as Dialysis p.34: range bars + scatter dashes
- **Y-axis**: 6.50%–10.00%
- **Deltas to fix**: same as dialysis p.34 (range-bar visualization)

### p.22 — Seller Sentiment and Confidence
- Same structure as Dialysis p.35: bars + 2 lines, dual axis
- **Y-axes**: 5.00%–8.50% left (cap), 0%–14% right (price change %)
- **Deltas to fix**: same as dialysis p.35

### p.26 — Leased Inventory (US HEAT MAP)
- **Type**: US state-level choropleth (states shaded by total LSF)
- **List on left**: top 35 states with total SF and rank circles
- **Our export equivalent**: `Data_Inventory_State` — horizontal bar chart
- **Deltas to fix**:
  - [ ] **Choropleth map** required (same options as Sources of Capital)
  - [ ] Or accept ranked-bar fallback

### p.27 — Leasing Summary (TWO TABLES)
- **Table 1**: New Leases — categories (No. of Leases, Monthly Avg, LSF Total, Avg Size, Total Rent, Avg Annual Rent, Avg Rent per SF) × Current Quarter / TTM / Last Five Years
- **Table 2**: Most Common Lease Structures — Terms (10,5 / 15,10 / 10,10 / 20,15 / 20,10 / Others / Total) × TTM / % of Total / Last Five Years / % of Total
- **Our export equivalent**: `Data_Leasing_Summary` exists; structure unclear without inspection
- **Deltas to fix**:
  - [ ] Verify table structure matches (categorical rows + period columns)
  - [ ] Confirm "10,5" format on Lease Structures (already done in PR #196)

### p.28 — Lease Renewal Rate
- **Type**: Stacked bar chart + trend line + table
- **Bars stacked**: First-Gen Commencements / Renewed / Succeeding-Superseding / Expired / Terminated
- **Line**: Net Change (TTM) — gray line on right axis
- **Table beneath**: First-Gen / Renewed / Succeeding / Expired / Terminated / Total Current / Outside Firm / Net Change × current/prior periods/5y avg
- **Our export equivalent**: `Data_Renewal_Rate` (`lease_renewal_rate`)
- **Deltas to fix**:
  - [ ] **Add trend line** (Net Change) on dual axis
  - [ ] Add summary table beneath
  - [ ] Verify all 5 stack categories render correctly

### p.29 — Lease Termination Rate
- **Type**: Combo bars + line, dual axis + summary table
- **Bars**: Leases In Firm Term (sky), Leases Outside Firm (lighter)
- **Line**: Leases Terminated (TTM) — dark navy on left axis (%)
- **Y-axes**: 0%–14% left (term rate), 0–10,000 right (lease counts)
- **Our export equivalent**: `Data_Term_Rate` (`lease_termination_rate`)
- **Deltas to fix**:
  - [ ] Add the two-bar overlay (in-firm vs outside-firm counts)
  - [ ] Add summary table

### p.30 — Rent by Year Built (SCATTER + WHISKERS)
- **Type**: Scatter chart with whiskers + trend line
- **For each year (1992-2024)**:
  - Vertical gray range bar (whisker): lower-to-upper quartile
  - Dark navy dot at top: Average RPSF
  - Sky blue dot at middle: Median RPSF
- **Dotted line**: Linear trend (Average RPSF)
- **Y-axis**: $15–$50, X-axis years 1992–2024
- **Our export equivalent**: `Data_Rent_Year_Built` (`rent_by_year_built`)
- **Deltas to fix**:
  - [ ] **Switch from bar chart to scatter+whiskers** (currently rendered as bars per my Round GD2)
  - [ ] Add linear trend dotted line
  - [ ] Both Avg and Median dots in different colors

### p.31 — Case for Renewal
- **Type**: Combo bars + line, dual axis + trend line
- **Bars**: dark navy = New Lease Commencements (count) by year
- **Line**: light gray dotted = Avg Annual Rent PSF
- **Y-axes**: 0–350 left (count), $0–$40 right (rent PSF)
- **Annotations**: bar count labels + line value annotations
- **Our export equivalent**: `Data_Case_Renewal` (`case_for_renewal`)
- **Deltas to fix**:
  - [ ] Verify dual-axis combo renders correctly (currently combo configured)
  - [ ] Add annotations at peaks/key years

### p.32 — Renewal Rent Growth & Inflation (TWO charts)
- **Left chart**: Combo bar + dot/whisker
  - Light blue bars: Renewal Rent / SF (left axis $0–$45)
  - Dark navy vertical bars: Upper/Lower Quartile range
  - Dots at center: Average Renewal Rent CAGR (right axis -4% to 8%)
- **Right chart**: 2-line
  - Dark navy: Average Renewal Rent CAGR
  - Sky blue: CPI
  - Y-axis -2% to 10%
- **Our export equivalent**: `Data_Renewal_Growth` + `Data_CPI_CAGR`
- **Deltas to fix**:
  - [ ] Combine into single tab with two charts (not two tabs)
  - [ ] Add quartile whiskers on left chart

### p.33 — Rent Heat Map (US CHOROPLETH)
- Color-graded US map by avg rent PSF
- Each state has $XX.XX value labeled
- Color scale legend on right ($12.14–$43.18)
- **Our export equivalent**: `Data_Rent_Heat_Map` — horizontal bar chart
- **Deltas to fix**:
  - [ ] Same as Leased Inventory: choropleth or ranked-bar fallback

---

## Summary of Action Items

### High-effort items (new chart types or major rebuilds)
1. **Range-bar + scatter visualization** (Vol_Cap_Combo, Bid_Ask) — needs new Chart.js config approach (floating bars + scatter dataset)
2. **US CHOROPLETH MAPS** (Sources of Capital, Leased Inventory, Rent Heat Map) — Chart.js doesn't support; needs QuickChart GeoMap or library swap
3. **Cost_Capital range-bar mortgage band** — needs new mortgage_constant_band field (currently rendered as 2 lines)
4. **Pace of Cap Rate Expansion** — entirely new chart_template_id + view + config
5. **Rent & Price Per Square Foot combo** — new chart_template_id (different from existing Rent_PSF_Box)
6. **On-Market Snapshot table layout** — Excel cell-based layout, not a Chart.js chart
7. **Available Clinics by Tenant donuts** — add 2 donut charts beneath the existing table
8. **Available by Term summary** — 4-group bars + dots chart (new chart_template_id)

### Medium-effort items (data view + chart config rebuild)
9. **Cap_by_Term bucket boundaries** — dialysis uses 12+/8-12/6-8/≤5 (PDF); we use 10+/6-10/<5/outside. Bucket boundaries differ by ~2 yrs across cohorts. View rebuild needed.
10. **Quarterly_Volume_Bars** — separate from Volume_TTM (one is line, one is bars)
11. **Buyer_Pool** monthly-count vs annual-percentage variant — dialysis wants monthly count, gov wants annual %. Different views.
12. **Annotated callouts** — add data-point annotations to ~10+ charts. Chart.js supports via `chartjs-plugin-annotation` but QuickChart compatibility unclear.
13. **Footer caption strips** — add italic summary text below each chart on the worksheet (Excel cell, not chart-config).
14. **Summary tables under charts** — many gov PDF charts have a summary table beneath. We currently ship the data tab AS the table, but the PDF aggregates current/prior/5y/10y/15y averages.

### Low-effort items (style polish)
15. **Color matching**:
    - Cap_by_Term lines: purple/teal/sky/navy (currently palette indices don't match)
    - Outside Firm cap line: dark gray (palette[4] is close but verify)
    - Sentiment bar colors: sage green + light purple
    - Cap_Quart 4 lines: sky/sky-darker/navy-dashed/navy-solid (mostly done)
16. **Y-axis range tightening** on specific charts:
    - Sentiment left axis: 4.75%–7.25%
    - Sentiment right axis: 0%–70%
    - DOM_Ask right axis: 84%–96% (currently 90%–105%)
    - Cap_by_Term y-axis: 5.00%–10.00%

### Data-side outstanding (no code fix)
17. **State/municipal cap rates** (Cap_by_Credit) — only 2 sales each in gov feed; need imports
18. **Bid_Ask pre-2010 data** — CoStar field gap, can't fix without external data
19. **Sentiment "many issues"** — needs specific examples
20. **Val_Index monthly** — needs source-data extension
21. **Catalog rows missing TAB_NAMES (silent export drops)** — surfaced
    by the 2026-05-08 export-bundle audit. The chart_template_ids below
    have valid catalog rows (visible to the dashboard query path) but no
    entries in `TAB_NAMES` / `CHART_COLUMNS` in `cm-excel-export.js`,
    which means the per-tab loop's `if (!tabName || !cols) continue;`
    silently skips them in every export. Audit-fix shipped Round 5a for
    `top_buyers_table`, `top_sellers_table`, `nm_notable_transactions`.

    **Round 5b CI gate**: `test/cm-export-bundle-audit.test.js` enforces
    that every dialysis-or-gov catalog row has a TAB_NAMES + CHART_COLUMNS
    entry, with explicit allow-listing for the 11 known-missing items
    below. Refresh the snapshot after catalog migrations via
    `npm run cm:refresh-catalog-snapshot`. New silent drops will fail
    `npm test` on PR rather than slip silently into deploy.

    Still missing (lower priority — chart-type renderers needed, not
    just data tables):
      - `available_cap_rate_scatter` (ScatterChart, dialysis+gov)
      - `cap_rate_yoy_change` (LineChart, gov+national_st)
      - `dom_price_adjustments` (BarChart, dialysis+gov)
      - `listings_count_q` (BarChart, gov+dialysis)
      - `market_share_pie_ttm` (PieChart, dialysis+gov)
      - `nm_buyer_distribution` (DataTable, gov)
      - `nm_share_of_market` (BarChart, gov+national_st)
      - `nm_track_record_buyer_type` (DataTable, gov)
      - `ppsf_box_quarterly` (StockChart, national_st+gov)
      - `predicted_cap_rate` (LineChart, national_st+gov)
      - `rent_survey_yearly` (LineChart, gov)

22. **US choropleth maps** (Sources / Inventory / Rent Heat Map) — **infra-blocked.**
    QuickChart's hosted service does NOT bundle the chartjs-chart-geo plugin
    (probed 2026-05-08; returns HTTP 400 with an error PNG when `type:
    'choropleth'` is sent). Options to unblock:
      a. Spin up a self-hosted QuickChart Docker image (`ianw/quickchart`) with
         `chartjs-chart-geo` pre-loaded as a custom plugin; point CM_QUICKCHART_URL
         at it. ~30 min of infra work + a long-running container.
      b. Swap to Datawrapper, Mapbox, or another map service (heavier change —
         needs separate auth + a new image-fetch path in cm-chart-image-renderer).
      c. Generate the PNG via a server-side D3 + topojson script and skip
         QuickChart entirely for these 3 charts. Requires `d3-geo` + `canvas`
         npm deps in the API package.
    Until then: ship the horizontal-bar fallback (top 15 states) which the
    existing Data_Sources / Data_Inventory_State / Data_Rent_Heat_Map tabs
    already provide. The bar fallback was deliberately preserved.

---

## Recommended ordering for next rounds

**Round 1 (style polish — lowest risk, highest visibility):**
- Items 15, 16 above — color + y-axis ranges
- Annotated callouts on 4-5 most-viewed charts (Val_Index, Vol_Cap_Combo, Txn_Count, DOM_Ask, Sentiment)
- Footer caption strips

**Round 2 (chart-type rebuilds):**
- Item 1 — range-bar visualization for Vol_Cap_Combo + Bid_Ask
- Item 3 — Cost_Capital mortgage band
- Item 4 — Pace_of_Cap_Rate_Expansion (new template)
- Item 5 — Rent_and_Price_PSF combo (new template)

**Round 3 (data-side reshape):**
- Item 9 — Cap_by_Term bucket realignment (dialysis 12+/8-12/6-8/≤5)
- Item 10 — Quarterly_Volume_Bars template
- Item 11 — Buyer_Pool monthly-vs-annual variants
- Item 14 — Summary tables under charts

**Round 4 (advanced visualization):**
- Item 2 — US choropleth maps (Sources, Inventory, Rent Heat Map)
- Item 6 — On-Market Snapshot table layout
- Item 7 — Available_by_Tenant donuts
- Item 8 — Available_by_Term summary

**Round 5 (data ceilings — partner-driven):**
- Items 17-20 — state/muni cap, pre-2010 bid/ask, sentiment specifics, Val_Index monthly source data
