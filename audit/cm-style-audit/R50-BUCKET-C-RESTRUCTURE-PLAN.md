# R50 — Bucket C Chart Restructure Plan

User notes 2026-05-21 flagged 4 charts as "does not match the chart type or
style in our Excel/PDF versions." Each needs a master-driven restructure.

## 1. Data_Bid_Ask

**Master chart7 (Charts tab):** 2-line time-series chart.

| Series | Master column | Header |
| --- | --- | --- |
| Line 1 | Charts!$AM | Last Ask (ttm) |
| Line 2 | Charts!$AO | Bid-Ask Spread |

Both share a TTM monthly cadence cat-axis on dates (col B = "Date").

**Current export (`bid_ask_spread`):**
- Quarterly view → single line of `avg_bid_ask_spread`
- Monthly view → 3-series floating-bar (invisible base of `avg_last_ask_cap` + visible band of `avg_bid_ask_spread`)

**Restructure plan:**
- Both quarterly + monthly become a 2-line time-series:
  - Navy line: `avg_last_ask_cap` (the last-ask reference rate)
  - Sky line: `avg_bid_ask_spread` (the spread amount)
- Pin y-axis range: 0-10% (covers both metrics)
- Replace `'bid_ask_spread'` case in `buildInjectionSpec` and `'bid_ask_spread_monthly'`. Both views (`bid_ask_spread_m` + `bid_ask_spread_q`) already emit both columns — no view changes needed.

**Affects:** dia + gov (both have the same view shape).

## 2. Data_Inventory_Backlog

**Master chart8 (Charts tab):** line+bar combo, 3 series.

| Series | Master column | Header | Role |
| --- | --- | --- | --- |
| Bar 1 | Charts!$AU | No. Added to Market | bar (sky) |
| Bar 2 | Charts!$AV | No. Sold | bar (navy) |
| Line | Charts!$AW | Net to Market | line (gray) |

`Net to Market = Added - Sold`. The line tells the story of whether inventory is growing or shrinking.

**Current export (`inventory_backlog`):**
- 2-bar clustered: `added_ttm` (sky) + `sold_ttm` (navy)
- Missing the Net-to-Market line.

**Restructure plan:**
- Add a "net" helper column to the data tab: `net_ttm = added_ttm - sold_ttm`
- Switch chart type from `clustered-bar` to `combo`:
  - 2 bar series (added + sold)
  - 1 line series (net)
- Pin y-axis range: dynamic (Excel autoscale) — net can be negative
- Apply to both dia + gov view paths (template covers both).

**View change needed?** No — added_ttm + sold_ttm both already in the view. Net is computed in the helper column at spec-build time (R34 P8.5 helperCols infra).

## 3. Data_Market_Turnover

**Master:** ⚠ No obvious direct equivalent.

Looking at the master Charts tab columns:
- `Y-O-Y Change (%)` (col G) — that's our existing YoY Volume Change chart
- No "turnover rate" column

Looking at the Market Size tab:
- `Total Market - Monthly Clear Pace` (col K) — this is `monthly_sales / months_of_supply` or similar — a "clearance pace" metric
- `Total Market - Inventory Backlog` (col L)
- Master chart31 combines K + L + cohort variants in a line+bar combo

**Possible interpretations:**

**Option A:** User meant Market_Turnover ≈ master's "Monthly Clear Pace" metric (col K). That's `monthly_sales / active_count_at_period_end` expressed as a monthly clearance rate. Currently we ship `turnover_rate = TTM_sales / (active_count + TTM_sales)`. Different formula.

**Option B:** Master doesn't have an exact equivalent and the user is comparing to a PDF version we don't have indexed. Need user to point at the specific reference chart.

**Option C:** Master has a different "turnover" concept entirely (e.g. tenant turnover for leases, not sales turnover).

**This one needs your input** — see Question 1 at the end.

## 4. Data_Avail_by_Term_Summary

**Master chart26 (Market Size tab):** bar + scatter combo, 5 series.

Header at row 50 (4 term buckets in rows 51-54):

| Series | Master column | Header | Role |
| --- | --- | --- | --- |
| Bar | C | (term bucket name) | bar — but this is the cat axis label, not a value |
| Bar | D | Avg Price | bar series (sky $) on left axis |
| Dot | E | Avg Cap | scatter dot (navy) on right axis (%) |
| Dot | F | Upper Quart | scatter dot (purple) on right axis |
| Dot | G | Lower Quart | scatter dot (gray) on right axis |

**Current export (`available_by_term_summary`):**
- 5 series: 1 bar (Avg Price) + 4 dots (Avg Cap navy + Upper Q purple + Median sage + Lower Q gray)
- Includes a Median dot that master doesn't have.

**Diff:**
- We include a 4th cap dot (Median); master only has 3 cap dots (Avg + Upper Q + Lower Q).
- Likely colors / labels / layout differ too — user said "style, format, colors, layout, and labels" all don't match.

**Restructure plan:**
- Drop the Median dot series (or keep it; user's call)
- Verify the dot colors match master: Avg Cap = navy, Upper Q = purple, Lower Q = gray
- Confirm bar = Avg Price in sky
- Right-axis range for the cap dots: master likely uses 5-10%; ours auto-scales

User said "style, format, colors, layout, and labels" — need to know specifically what's off. The structural shape (bar + dots) is the same. Could be:
- Number formats differ (master may use whole-percent on cap, $ rounded on price)
- Dot marker style differs (diamond vs circle)
- Cap dot colors differ
- Bar fill color differs
- Axis labels / titles differ

## Detailed master inspection (2nd-pass findings)

### 1. Bid_Ask master (chart7) — STACKED LINE + UP-DOWN BARS

Deeper inspection revealed:
- `<c:lineChart>` with **`grouping="stacked"`** — both lines stacked
- Chart-level **`<c:upDownBars>`** — Excel draws vertical bars between the two stacked lines
- Series 0: Last Ask TTM (AM) — sky line, 5.25-8% val axis
- Series 1: Bid-Ask Spread (AO) — navy line stacked above ser[0]

Net visual: the BLUE line is `last_ask_cap`. The NAVY line above it is
`last_ask_cap + spread`. Vertical bars connect them at each month showing
the spread distance. That's the "drop down lines above the last asking
cap" you described.

**Restructure:**
- Switch chart type to `stacked-line` (new builder needed)
- Add `<c:upDownBars>` element for the drop-down visual
- Same data: last_ask_cap + spread (both already in views for both
  monthly + quarterly cadences? need to verify quarterly has both)

### 2. Avail_by_Term_Summary master (chart26)

- `barChart` (clustered) + `scatterChart` (5 series total)
- Series structure (master colors, not the renderer's):
  - ser[0] BAR — Term-bucket count (col C No. Available), pale fill E0E8F4 + navy border 003DA5
  - ser[1] DOT — Avg Price (col D), navy 003DA5
  - ser[2] DOT — Avg Cap (col E), teal 5FA3A8
  - ser[3] DOT — Upper Quart (col F), purple 9B88A5
  - ser[4] DOT — Lower Quart (col G), sky 62B5E5
- All dots use **circle marker** (not diamond — user said diamond, but master is circle)
- 3 val axes: left $ (price), right % min 3.5%, bottom General

**Note vs your earlier answers:** master uses CIRCLE markers; you said diamond. Confirm — would you prefer diamond (looks distinct from bar fill) or master-faithful circle?

**Restructure:**
- Match master's 4-dot color scheme (navy/teal/purple/sky)
- Pin right-axis range (3.5%-10% or similar)
- Marker shape per your call (circle = master; diamond = your preference)
- Keep current 4-dot Median? Master only has 3 dots + Avg Price. Your choice.

### 3. Inventory_Backlog — confirmed approach

Add `net_ttm` helper column = `added_ttm - sold_ttm`. Switch chart type
from `clustered-bar` to `combo`:
- Bar 1: added_ttm (sky)
- Bar 2: sold_ttm (navy)
- Line: net_ttm (gray)

No view change needed. R34 P8.5 helperCol infra handles the computation.

### 4. Market_Turnover — "untitled chart at bottom of Market Size tab"

The Market Size tab has 8 charts. By anchor row position (lower = further down the sheet):

| Chart # | Anchor rows | Type | Series | First col |
| --- | --- | --- | --- | --- |
| 26 | 54-103 | bar+scatter (5) | C/D/E/F/G | Avail_by_Term_Summary master |
| 27 | 56-72 | line+bar (4) | C/M/E/O | Active mkt size cohort 1 |
| 28 | 59-77 | line (4) | F/G/P/Q | Cap quartile cohort |
| 29 | 105-123 | line+bar (4) | I/S/J/T | DOM + Price Change cohort |
| 31 | 105-125 | line+bar (4) | K/U/L/V | Monthly Clear Pace + Inventory |
| 33 | 105-128 | bar+scatter (2) | E/D | DOM & Price Adjustments (titled) |
| 30 | 125-155 | line (4) | C/D/E/F at row 70+ | 4-line time series (cap quartiles?) |
| **32** | **158-193** | **pie** | C64 | Tenant share pie |

The chart with the highest row number (158-193) is **chart32**, which is a PIE chart. That's tenant share, not market turnover.

Second-to-bottom by anchor: **chart30** — 4-line time series from rows 70-210 of Market Size. Val axis is `0.045+` (cap rate %). 4 series referencing C/D/E/F starting at row 70. Without sheet visualizing I can't be 100% sure but this looks like a "4-cohort cap rate over time" chart, NOT turnover.

**I need a more specific pointer** — chart number, chart title, or what data it plots. None of these have a "turnover rate" computation that's clearly in any of them.

## What shipped (R50, 2026-05-22)

User answered with: Bid_Ask = drop-down lines above the last-asking-cap;
Inventory_Backlog = add Net-to-Market helper line; Avail_by_Term = diamond
markers + master-aligned dot colors + pin right axis; Market_Turnover =
"untitled chart at the bottom of Market Size" (chart31 by anchor row).
Re-inspection of Market Size confirmed chart31 (rows 159-194) is the
bottom-anchored, untitled bar+line combo with Monthly Clear Pace bars +
Inventory Backlog lines (Total + 10+ Year cohort).

### 1. Bid_Ask
**Shipped:** `multi-line` chart type with `lineGrouping='stacked'` +
chart-level `<c:upDownBars/>`. Bottom series = `avg_last_ask_cap` (sky);
top series = `avg_bid_ask_spread` (navy) stacked above it. Gray up-down
bars at each x mark the spread distance — exactly matches user's
"drop down lines above the last asking cap TTM".

`buildMultiLineChartXml` extended with `lineGrouping` + `upDownBars`
flags (backward-compat defaults preserve every existing multi-line spec).

**View changes:** `cm_dialysis_bid_ask_spread_q` recomputes
`avg_last_ask_cap` with the same TTM window + ≥5 sanity-band gate as
the monthly view. `cm_gov_bid_ask_spread_q` swaps its source from
`cm_gov_market_quarterly` (no last_ask) to `cm_gov_market_quarterly_master_m_mat`
(carries last_ask), with the same ≥5 TTM gate. Both verticals,
both cadences now formula-consistent.

**Graceful fallback:** if `avg_last_ask_cap` is missing for any reason,
spec degrades to a single-line of just the spread (no breakage).

### 2. Inventory_Backlog
**Shipped:** `combo` chart with 2 bars + 1 line on `sharedAxis=true`:
- Bar (sky):    added_ttm
- Bar (navy):   sold_ttm
- Line (gray):  Net = added_ttm − sold_ttm (helper col G)

Helper col added via R34 P8.5 infra — no view changes needed.

### 3. Market_Turnover
**Shipped:** `combo` chart with 1 bar + 1 line on dual axis:
- Bar (sky):    Monthly Clear Pace = ttm_sales_count / 12 (helper col F, left integer axis)
- Line (navy):  Turnover Rate (existing col E, right % axis)

Matches master chart31's "bars for activity + line for rate" shape.
Dia doesn't have the 10+ Year cohort decomposition the master uses,
so we plot just the Total Market series — open as R-cohort follow-up
if the user wants 4-series parity.

### 4. Avail_by_Term_Summary
**Shipped:** color realignment + right-axis pin. Markers stayed as
diamonds per user preference (master uses circle, user prefers diamond).
- Avg Cap dot:        navy → aquamarine #00B1B0 (matches master teal)
- Upper Quartile dot: purple #7E6BAD (unchanged)
- Lower Quartile dot: gray → sky #62B5E5 (matches master)
- Median dot:         sage #4CB582 (unchanged; master has no equivalent
                                    but user didn't say drop it)
- Right axis pinned to CAP_RATE_DOT_RANGE { 4%, 12% }
- Left axis labeled as currency ($)

## Verification
137 CM injector tests pass (was 132 before R50); 9 new tests cover the
stacked-line builder extension + each restructured spec. Full suite
358 pass / 2 unrelated pre-existing failures.

## Migration tracker
`supabase/migrations/20260675_cm_round50_bucket_c_chart_restructures.sql`
