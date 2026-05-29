# Capital Markets — Issue Triage (post-deploy export review, 2026-05-29)

Root-cause classification of the issues flagged against the freshly re-exported
workbooks. Each item is tagged by fix type: **DATA** (source-data fix, live-DB),
**CHART** (injector axis/label/range — needs LCC deploy), **REBUILD** (bid-ask),
or **SOURCE-GAP** (data we don't currently have; needs backfill).

## Fixed this pass

| Item | Root cause | Fix |
|---|---|---|
| **Dia Data_Volume_TTM 2024 spike** (DATA) | Three sales on 2023-09-12 recorded at **$950,000,000 each** (ids 14319/14331/14340 — small clinics in Bolivar TN, Lugoff & Manning SC), a costar_sidebar mis-capture. A 4th identical one (13357) was already excluded. ~$2.85B inflated TTM volume for ~4 quarters. | **Done (live):** set `exclude_from_market_metrics=true` on the three. TTM 2023-Q3 drops $3.6B→$752M; series now smooth. Migration file to follow. |

## Chart fixes — injector (need LCC deploy + re-export)

| Item | Root cause | Planned fix |
|---|---|---|
| **Bid-Ask still wrong (dia+gov)** (REBUILD) | The barChart+lineChart range I shipped renders the gray band as a continuous stacked column + connected lines; the PDF p.34 is **thin discrete high-low range bars + dash markers**. Wrong mechanism. | Rebuild as a true high-low visual — `stockChart` (hi-low-close) or thin hi-low bars with discrete markers (no connecting lines), matching the master's `hiLowLines` charts. |
| **Gov Data_CPI_CAGR "no data before 2018"** (CHART) | The view HAS `cpi_change` back to 2014-10; only `gsa_renewal_cagr` starts 2018-12. The chart's MIN_YEAR trims to where renewal exists, hiding the earlier CPI line. | Lower MIN_YEAR for `cpi_vs_renewal_cagr` so the CPI line shows from the view start (~2014/2015); renewal line legitimately begins 2018. |
| **Gov cap_by_term x-axis missing quarterly labels** (CHART) | Cat-axis labels not emitting on this template. | Apply the standard `q"Q-"yyyy` cat-axis labels + vertical rotation used on the other time-series charts. |
| **Gov Cap_by_Credit "stop x-axis around 2000"** (CHART) | Early decades are sparse/noisy. | Set MIN_YEAR ~2000–2005 for `cap_rate_by_credit` so the line starts where data is dense. |
| **Dia + Gov Data_Sentiment y-axis** (CHART) | Cap-rate axis range too wide/tight to see line movement. | Pin a tighter cap-rate y-axis range on `seller_sentiment` (per-vertical) so the asking-cap line movement is visible. |
| **Gov Data_Val_Index y-axis** (CHART) | Index axis range flattens the movement. | Pin the valuation-index y-axis to the data's min–max (with margin) so the index movement reads. |

## Data / methodology issues (need deeper work or source backfill)

| Item | Root cause | Path |
|---|---|---|
| **Dia Data_DOM_Ask ">100%"** (DATA/method) | Avg % of ask legitimately exceeds 100% in hot periods (104% in 2022, 100.5% in 2024-Q2 — clinics sold above ask); recent **median is a flat 100%** on small n (5–6 sales). The PDF keeps % of ask < 100% (different sample/ask basis). Not a single bad row. | Decide methodology: cap at 100%, switch from last-ask to initial-ask basis, or raise the n-gate so thin recent months don't show a flat-100% line. Needs your call on which the PDF uses. |
| **Gov Cap_by_Credit state/municipal missing** (SOURCE-GAP) | **2,794 of ~4,100 gov sales have NULL `government_type`**; only ~22 are "Local/State", 2 "Municipal". The Federal line populates; state/muni are starved. The master deck has real state/muni classification we don't. | Backfill `government_type` (derivable from the `agency` field — most NULLs are Federal/GSA) so the buckets fill. Separate classification batch. |
| **Gov Data_NM_vs_Market sparse/erratic** (SOURCE-GAP/method) | Market cap populated all 303 months; NM cap only 237 (thin NM-tagged deal sample → gaps + jumpy line). | Widen the NM smoothing window further and/or backfill NM attribution; partly a data-coverage limit. |
| **Dia + Gov cap-rate-by-lease-term "doesn't move like PDF"** (DATA) | Gov: `cap_6to10` and `cap_5to10` are **duplicate columns**, `cap_less5` is NULL recently (no short-term sales) — so cohort lines collapse/overlap. Dia term buckets similarly thin pre-2015. The term-remaining-at-sale fix (R67/R68) also changed cohort membership. | Audit the cohort definitions + term-remaining-at-sale logic against the master's bucketing; de-duplicate the 6to10/5to10 columns. |
| **Gov Data_Inventory_Backlog / Data_Market_Turnover** (DATA) | Both views DO have data (inventory 2014+, turnover 2005+). Likely a specific recent-month gap, a column-mapping/label issue, or chart trim — not wholesale missing. | Pull the master's expected series and diff column-by-column to pin the exact discrepancy. |
| **Gov Data_Sold_Cap_by_Term** (DATA) | Same term-bucket family as cap-by-term above. | Same cohort audit. |

## Recommended sequence

1. ✅ Volume_TTM (done).
2. **Injector batch** (one deploy): bid-ask rebuild + CPI/cap-by-credit/cap-by-term x-axis + Sentiment/Val_Index y-axis. All ship together so you re-export once.
3. **government_type backfill** (gov) — unlocks the Cap_by_Credit state/muni lines.
4. **Term-bucket cohort audit** (dia+gov) — cap-by-term, sold-cap-by-term, and the 6to10/5to10 duplicate.
5. **DOM % of ask methodology** — needs your read on what the PDF's denominator is.
