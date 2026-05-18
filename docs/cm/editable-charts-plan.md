# Editable Excel Charts — Roadmap

**Marketing team feedback 2026-05-18**: *"the charts in the Excel export are PNG images or graphics and not editable charts like what's in our Excel version."*

This doc captures the full scope of the work and a phased plan, because the original "just flip the default to master_template" attempt (PR #819) failed for reasons the inventory below makes clear.

## Why the naive flip failed

The dia master template (`assets/cm-templates/dialysis-master-template.xlsx`) ships with 37 pre-wired chart objects. The existing loader (`api/_shared/cm-template-loader.js`) only populates **columns B-O (14 columns) of one sheet (Charts)**. Most chart objects reference columns + sheets the loader doesn't touch, so they render blank when opened in Excel.

PR #819 was reverted by PR #820.

## Full chart inventory

See [dia-master-template-chart-inventory.txt](./dia-master-template-chart-inventory.txt) for the auto-generated raw output of `scripts/cm-inventory-master-template-charts.py`. Summary:

**Sheets referenced** by chart objects, with the data ranges each needs populated:

| Sheet | Charts referencing it | Data shape | Columns referenced |
|---|---|---|---|
| `Available Comps` | 1 (scatter — Avail cap dot) | per-listing snapshot | L, M |
| `Core Cap Chart` | 2 (scatter — Core cap dot) | per-sale | B, C |
| `Charts` | 3-25 (23 charts — the bulk) | monthly TTM time series | ~40 cols B–CI |
| `Market Size` | 26, 30, 32, 33 (4 charts) | cross-section by term bucket | C-G rows 51-54, 65-68, 71-210 |
| `Sheet1` | 34 (scatter — DOM?) | per-listing snapshot | Q, R, T |
| `Rent Survey` | 35 (rent quartiles) | tenant/property rent series | H, I, J, K |
| `Competition` | 36, 37 (2 pies — count + volume) | tenant breakdown | N rows 23-36, 42-55 |

**Charts sheet columns** (the main one) — by master_m mapping status:

| Cols | Content | master_m source | Status |
|---|---|---|---|
| B | Date | `period_end` | ✓ already populated |
| C-O | Txn count, Avg deal, Volume, YoY, Quartiles | various | ✓ already populated (B-O is the existing Phase 1 coverage) |
| Q | Cap (90 day) | NOT in master_m | needs new view col |
| R, T | Buffer columns | n/a | empty in template too |
| S, U | Treasury, Loan Constants | `treasury_10y_yield`, `low_loan_constant`, `high_loan_constant` | ✓ in master_m |
| V | Buyer-class fields | various counts | ✓ in master_m |
| W, X | NM vs Non-NM cap TTM | `nm_avg_cap_ttm`, `non_nm_avg_cap_ttm` | ✓ in master_m |
| Z, AA | Cap Pace/Trend | derived from yoy_change_pct? | needs check |
| AB, AC | 10+ Year Cap (ttm, 90 day) | `cap_10plus_year` + new 90-day | partial |
| AD-AG | Dialysis cohort caps (12+ / 8-12 / 6-8 / ≤5) | `cap_12plus_year` etc. | ✓ in master_m |
| AH, AI | FMC / DVA tenant caps | NOT in master_m | needs new tenant-specific cap views |
| AK, AL | DOM | `avg_dom` from `cm_dialysis_dom_pct_ask_m` | needs cross-view join or master_m extension |
| AM-AS | Last Ask / Bid-Ask / Price Change | partial in master_m (`avg_last_ask_cap`, `pct_price_change`) | partial |
| AU, AV, AW | No. Added / No. Sold / Off-Market | `added_ttm`, `sold_ttm` from `cm_dialysis_inventory_backlog_m` | needs cross-view join |
| BB, BC | Price PSF | dia is chair-counted; need `cm_dialysis_rent_price_per_chair_q` or new PSF | partial |
| BD-BG | Returns indexes | `low_loan_constant`/`high_loan_constant` + cap_rate → calc | partial |
| BK, BL, BM | Individual / Fund / REIT counts | `reit_count_ttm`, `institutional_count_ttm`, `private_count_ttm` | ✓ in master_m |
| CH, CI | Doughnut Count + Volume Available | snapshot from active listings | needs new view |

## Phased plan

### Phase 1 ✓ DONE (existing)
Columns B-O populated. Covers the Volume TTM combo + a few cap quartile charts.

### Phase 2 (this PR + follow-up)
**Goal**: extend Charts sheet coverage to as many columns as can be filled from EXISTING master_m + cross-view joins, without changing any views. This unblocks ~15 of the 23 Charts-sheet charts.

Columns to add (all from `cm_dialysis_market_quarterly_master_m`):
- S, U: Treasury + Loan Constants
- V: Buyer-class counts
- W, X: NM / Non-NM cap TTM
- AB, AD, AE, AF, AG: 10+ / 12+ / 8-12 / 6-8 / ≤5 Year cohort caps
- AM-AQ: Last Ask Cap + price-change percentages
- BK, BL, BM: REIT / Institutional / Private counts

Columns needing cross-view JOIN (from `cm_dialysis_dom_pct_ask_m` and `cm_dialysis_inventory_backlog_m`):
- AK: DOM
- AU, AV: No. Added / No. Sold

After Phase 2 lands, **re-flip the dia default to master_template**.

### Phase 3 (separate PR)
Other sheets (Available Comps, Core Cap Chart, Market Size, Sheet1, Rent Survey, Competition). Each needs its own data-injection helper analogous to `generateChartsSheetXml`.

### Phase 4 (separate PR)
View extensions for derived metrics not in master_m:
- 90-day rolling cap (column AC)
- Tenant-specific caps FMC (AH) + DVA (AI)
- Cap pace/trend (Z, AA)

### Phase 5 (separate PR)
Gov master_template path — `gov-master-template.xlsx` exists (32 chart objects, 10 sheets) but no loader function. Mirror the dia approach.

## Why phased

The full expansion is genuinely large (40+ columns across 6 sheets, plus new view columns for tenant-specific data). Phasing lets us:
1. Get the easy ~60% of charts populated quickly (Phase 2)
2. Test the master_template default flip on a partially-complete export before committing to it
3. Layer in the harder sheets / new views without blocking incremental delivery

## Tracking

- Phase 2: this PR — extend Charts sheet column coverage to existing master_m fields
- Phase 3-5: tasks #6, #8 (sub-tasks to be split when work begins)
