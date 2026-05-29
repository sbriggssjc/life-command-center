# Capital Markets — Chart Parity Re-Check (fresh export vs master/PDF)

**Date:** 2026-05-29
**Inputs:** fresh LCC exports `NM-CapMarkets-Dialysis-2026-03-31.xlsx` + `NM-CapMarkets-GovLeased-2026-03-31.xlsx` (generated 2026-05-29) · `Dialysis Comp Work MASTER.xlsx` · `Copy Government Master Document.xlsx` · `The Dialysis Market Filter (4Q-2025).pdf` · `State of the Government-Leased Market (2024-Q2).pdf` · prior notes `audit/cm-style-audit/` (PUNCH-LIST + R66–R73)
**Method:** unzipped each workbook's `xl/charts/*.xml`, tallied chart kinds / titles / number formats / legend positions / axis bounds / data-label counts / upDownBars; rendered and read the PDF chart pages; cross-checked the current code (`cm-native-chart-injector.js`, `cm-excel-export.js`) against each prior note.

---

## 1. Headline

The prior chart notes (PUNCH-LIST A–D and the R66–R73 user-feedback rounds) are **almost entirely resolved in the fresh 2026-05-29 export.** Many R66–R68 items were originally logged as "verified shipped but the user's export predated the fix" — this fresh export, generated after all those rounds, now demonstrably carries them.

**One prior-noted item still does not match the master/PDF: the Bid-Ask Spread chart idiom (note #11).** Everything else flagged in the notes is either resolved or is a deferred data-reconciliation item (not a chart-formatting fix), documented below.

---

## 2. Prior notes confirmed RESOLVED in the fresh export

| Note | Item | Evidence in fresh export |
|---|---|---|
| PUNCH-LIST **A** (HIGH) | Chart titles missing | **All 68 chart objects carry `<c:title>`** (was "_" on every chart in the 2026-05-21 audit) |
| PUNCH-LIST **B** | Negative number format (CRE red-parens) | 32 charts use `#,##0_);[Red](#,##0)` / `$#,##0_);[Red]($#,##0)` axis formats (shipped R38) |
| PUNCH-LIST **C** | Doughnut legend position | All 4 doughnut charts now `legendPos val="b"` (bottom) |
| R66 #1 | X-axis quarter alignment | catAx `rot="-5400000"` (vertical) restored |
| R66 #3 | Cap_Quartile / Active_Cap_Quart "too zoomed in" | Cap_Quartile axis now **0.04–0.10 (4–10%)**, confirmed in chart XML |
| R64 / R66 | Volume_TTM `$X.XXB` axis + high/low/recent labels | Volume_TTM chart carries **3 `<c:dLbl>`** (peak/trough/most-recent) |
| R67 #5 | Sold/Ask_Cap_by_Term "lines all over the place / pre-2014" | `MIN_YEAR_BY_TEMPLATE` = 2015 for both (in code) |
| R67 #6/7 | Core_Cap_Dot x-axis + over-counting extended leases | scatter chart present with pinned x-axis; dia view filtered to ≤15-yr total term, gov to firm-remaining-at-sale |
| R68 #1 | Inventory_Backlog "Sold" bar fill vs legend | `invertIfNegative val="0"` on bar builders |
| R68 #4 | Avail_Tenant_Count / _Vol donuts "missing" | Both donut charts present (chart31/chart32) with 4 colored segments |
| R71 | Aggregate "Charts" tab out of sync with Data_* tabs | **68 chart objects = 34 templates × 2** — each Data_* chart now has a live-linked native twin on the Charts tab |

DOM & % of Ask (PDF p.33) was also visually confirmed to match: sky bars (DOM TTM) + navy line (% of ask) with 3 labels per series.

---

## 3. Still NOT matching — actionable

### 3.1 Bid-Ask Spread chart idiom (note #11) — **OPEN**

**Master / PDF (p.34, the authoritative "our version"):** a **high-low range chart** — per period: a gray vertical **range bar** (min–max of last asks for TTM sales), a navy **"Last Ask (ttm)" dash** marker, and a sky-blue **"Bid-Ask Spread"** segment at the base. Reads like an OHLC/stock chart.

**Fresh export (`Data_Bid_Ask`, chart2/chart36):** a **stacked 2-line chart** (Last Ask Cap + Spread) with chart-level **`upDownBars`** — the R68 reactivation of the R50 template. `upDownBars` is present and renders, but it is a *different visual* from the master's gray high-low range bars + two marker series.

**Why it's still open:** R66→R68 flagged this exact risk — R68's note said "if R68's R50-reactivation isn't the master's exact idiom (range bars vs stacked-line + upDownBars), revisit." The PDF confirms the master uses **range bars**, so the revisit is warranted.

**Fix (recommended):** rebuild `bid_ask_spread` as a high-low range visual — either a `stockChart` (hi-low-close) or a bar series with `hiLowLines` spanning the TTM last-ask min/max, plus the navy "Last Ask (TTM)" marker series and the sky "Bid-Ask Spread" series. The master itself uses `hiLowLines` on 4 charts and `upDownBars` on 1, so the building blocks already exist in the reference workbook. This is a focused new chart-builder in `cm-native-chart-injector.js` (the data — `avg_last_ask_cap`, spread, and the per-period range — is already in `Data_Bid_Ask`).

---

## 4. Deferred — data reconciliation, not chart formatting (status unchanged)

These were flagged in the notes and remain open by design; they are source-data items, not export-formatting fixes.

| Item | Status |
|---|---|
| **~80 bps cap-rate gap, dia 2009–2011** (Cap_Avg / Returns_Idx / Cost_Capital vs master) | Largely closed by R72 (532 master sales backfilled); 2009–2011 now 25–90 bps closer, 2014+ within 10–20 bps (statistically indistinguishable). Remaining gap is the **379 unmatched master sales needing property records first** — a separate batch. |
| **Seller Sentiment pre-2014** | R73 added 18 `available_listings` rows; chart still effectively starts ~Q3-2014 (data-aware trim at n≥5). Extending further needs the 379-sale property backfill or relaxing the density threshold to n≥3. |
| **"2005 cap rates should be in the 4s"** | Resolved by investigation (R69): the master Excel has **no 2005 data** (its series starts Jan-2009 at 8.6–9.2%); our early-2005 4.73% TTM is a single-sale artifact. Not a bug. |
| **#14 Inventory_Backlog title cosmetic** | R67 noted the bar-color issue was the real complaint; the title text itself was not specifically called out. Confirm with marketing if a title reword is still wanted. |

---

## 5. Recommendation

The export now faithfully reflects the prior formatting notes — the only chart whose *idiom* still diverges from the published deliverable is **Bid-Ask Spread**. Recommend implementing the high-low range rebuild (§3.1) as the next change; the remaining open items are data-reconciliation work tracked separately and don't affect chart formatting.

Re-run `node audit/cm-style-audit/audit-master-vs-export.mjs` against a fresh export after any chart-builder change to regenerate the inventory diff.
