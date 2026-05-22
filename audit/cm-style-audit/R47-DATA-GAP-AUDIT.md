# R47 — Pre-2014/2006 Data Gap Audit

Per user notes 2026-05-21 Bucket A. Findings split into 3 categories.

## TL;DR

| Category | Charts | What's actually happening |
| --- | --- | --- |
| **TRUE gaps** | Bid_Ask, DOM_Ask, NM_vs_Market, Sentiment | Source data really is absent pre-2006/2013. User's claim is correct. Fixing needs source-data backfill. |
| **FALSE alarms — data IS present** | Cap_Avg, Cap_Quartile, Returns_Idx, Cost_Capital, Vol_Cap_Combo (vol col), Sold_Cap_by_Term (col C 2001-02) | The data tabs DO have data pre-2014/2006. User likely perceiving a chart-rendering issue from the next category. |
| **SPARSE 2003-2004 (chart looks broken)** | Same 6 charts above | View output has 12/12 cells in 2001 + 2002, then drops to 3/12 + 5/12 in 2003 + 2004, then back to 12/12 from 2005+. The 7-9 missing months per year in 2003-04 create visible line breaks → user reads this as "missing data". |

## Per-tab population pivot (dia, post-R45 export, col B/C/etc. = data column)

```
Tab                      Data col              2001 02 03  04  05 06 07 08 09 10 11 12 13 14 15-24
Data_Bid_Ask             Avg Bid-Ask Spread       0  0  0   0   0  0  0  0  0  0  2 10  3 10  full
Data_Cap_Quartile        Top Quartile            12 12  3   5  12 12 12 12 12 12 12 12 12 12  full
Data_Cap_Avg             Avg Cap Rate            12 12  3   5  12 12 12 12 12 12 12 12 12 12  full
Data_Returns_Idx         Cash Return Index       12 12  3   5  12 12 12 12 12 12 12 12 12 12  full
Data_Cost_Capital        Avg Cap Rate (TTM)      12 12  3   5  12 12 12 12 12 12 12 12 12 12  full
Data_DOM_Ask             Avg DOM                  0  0  0   0   0  0  8 12  6  0  6 11 12 12  full
Data_NM_vs_Market        NM Cap                   0  0  0   0   0 11 12 12 12 12 12 12 12 12  full
Data_Sentiment           Last Ask Cap (all)       0  0  0   0   0 11  9 12 12 12 12 12 12 12  full
Data_Sold_Cap_by_Term    12+ Year Cap            12  2  0   0   9 12 12 12 12 12 12 12 12 12  full
Data_Vol_Cap_Combo       TTM Volume              12 12 12  12  12 12 12 12 12 12 12 12 12 12  full
Data_Vol_Cap_Combo       TTM Cap (avg)           12 12  3   5  12 12 12 12 12 12 12 12 12 12  full
```

## Root cause

The 2003-2004 sparse-month pattern matches `sales_transactions` row counts:

```
year   sales
2001   12
2002   6
2003   4    ← sparseness inflection
2004   12
2005   16
2006   20
2007+  30+
```

Many of the views use HAVING clauses requiring ≥4-5 valid cap rates per TTM window. When the year only has 4-6 sales total, many TTM windows fall below the threshold and emit NULL.

For the TRUE-gap charts (Bid_Ask, DOM_Ask, NM_vs_Market, Sentiment), the underlying tables (`available_listings` for bid-ask + DOM, NM broker attribution for NM-vs-Market) don't have any rows before the year shown.

## Why R37 P4 concluded "data isn't there" but this audit finds more

R37 P4 looked at 4 specific cropped-at-2014 views (Inventory_Backlog, Market_Turnover, Active_Cap_Quart, Active_DOM_PC). For those 4, the conclusion was correct — they depend on `available_listings` which only has data from 2013-2014+.

The R47 batch (12 different charts) has a different shape: most of them depend on `sales_transactions` which DOES have data back to 2001 — but sparse enough in 2003-2004 to fail the views' HAVING thresholds.

## What can actually be fixed

**Option A: Loosen HAVING thresholds in master_m view aggregations**
- Change `count(*) >= 5` to `count(*) >= 2` for the 2003-2004 windows
- Will surface more cells but with weaker statistical confidence (a 2-sale TTM average is noisier)
- Side effect: also surfaces low-confidence values in other sparse periods (early 2020 COVID dip, etc.) where view was correctly hiding noise

**Option B: Trim the chart X-axis to where data is reliably dense**
- Pin x-axis to start at 2005 for affected charts
- 2001-2002 dense data gets hidden, but the visible chart looks consistent (no breaks)
- Goes against user's "show as far back as possible" request

**Option C: Forward-fill sparse cells in the view**
- For each month with NULL, use the prior month's value
- Visually smooths the chart but technically misrepresents data availability
- Common in financial dashboards (last-observation-carried-forward) but a judgment call

**Option D: Accept the current state + document the limits**
- Pre-2005 cap-rate data is genuinely sparse; chart shows that honestly
- Add a footnote-style annotation on the chart: "Sample size <5 for 2003-2004; cap rate may be unstable"

**Option E: Find external data source + backfill `sales_transactions`**
- The master Excel likely has manually-entered comps from RCA / CoStar / broker memory that aren't in Supabase
- Requires a separate ingestion project

## What backing data DOES exist

**Underlying source tables (dia):**
| Table | Earliest data | Notable density |
| --- | --- | --- |
| `sales_transactions.sale_date` | 1994 | <5/yr until 2003; 12-30/yr 2004-2010; 30+/yr 2011+ |
| `available_listings.listing_date` | 2001 | 1-3/yr until 2011; 22-100+/yr 2012+ |
| `leases.lease_start` | varies per property | dia-dependent |
| `properties.year_built` | static | |

So at the source-table level:
- **`sales_transactions`** has data 1994+ but sparse → cap-rate-based charts are limited by sample count
- **`available_listings`** is the limiter for bid_ask, DOM_Ask, Active_*, Inventory_Backlog — really only has data from 2012+
- **NM broker attribution** lookup depends on Northmarq deal records, which begin ~2006

## Recommendation

I'd recommend a **mixed approach**:

1. **R47a (low-risk)**: For TRUE-gap charts (Bid_Ask, DOM_Ask, NM_vs_Market, Sentiment), document the data limit in the chart footer caption + add a "data available from YYYY" subtitle. This sets honest user expectations without misleading.

2. **R47b (chart polish)**: For FALSE-alarm charts (Cap_Avg, Cap_Quartile, etc.) where the perception of "missing pre-2006" comes from the 2003-2004 sparse-month visual break, **pin the chart X-axis to start at 2005**. The data tab keeps all rows from 2001+; the chart just doesn't render the noisy first 4 years.

3. **R47c (deferred)**: Backfilling sales_transactions from an external comp source is a separate project — costs include a data agreement (RCA / CoStar) + ingestion pipeline.

## Per-tab specific actions if proceeding with R47a + R47b

| Tab | Action | Effort |
| --- | --- | --- |
| Data_Bid_Ask | Set `yAxisRange` x-min to 2014 (data starts there reliably); update caption | Small |
| Data_DOM_Ask | Set x-min to 2013; update caption | Small |
| Data_NM_vs_Market | Set x-min to 2006 (where NM attribution begins) | Small |
| Data_Sentiment | Set x-min to 2006 | Small |
| Data_Cap_Quartile, Cap_Avg, Returns_Idx, Cost_Capital, Vol_Cap_Combo, Sold_Cap_by_Term | Set x-min to 2005 (skip the 2003-2004 sparse window) | Small |

## Open questions for the user

Before I ship any of this, I need to know:

- **Q1**: For the FALSE-alarm charts (data exists from 2001-2002 but 2003-2004 is sparse), do you want the chart to render the dense 2001-2002 data anyway, or trim x-axis to 2005 where data is consistent?
- **Q2**: For the TRUE-gap charts (bid_ask, DOM_Ask, NM_vs_Market, Sentiment), do you want the chart x-axis to start where data begins (auto-trim) or always show 2001+ with the visible gap?
- **Q3**: Are you open to a backfill project to import historical comp data into `sales_transactions` from an external source? That's the only way to actually get pre-2003 cap rate data.

## What I'm NOT recommending

- **Loosening HAVING thresholds (Option A)** — surfaces low-confidence values across the board, including periods where the current behavior of hiding sparse data is correct.
- **Forward-fill (Option C)** — misrepresents data availability; unsuitable for a comp deliverable where users expect cells to reflect real samples.
