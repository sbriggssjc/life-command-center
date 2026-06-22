# Capital Markets Export — Chart Comment Audit (2026-06-22)

Diagnosis of Scott's June-22 chart notes on the Dialysis + Gov-Leased exports, grounded against the
export data tables AND the live Supabase databases (dia `zqzrriwuavgrquhisnoa`, gov
`scknotsqkcheojiaewwh`). Each comment is classified by **root cause**: collection gap (data not in DB),
propagation/formula (data in DB but the `cm_*` view drops/mis-aggregates it), or chart config
(axis/smoothing/color). This is the key question Scott kept asking — "is the data in the database?"

## TL;DR — the data is mostly IN the database; most issues are formula/definition or chart-config

Ten root causes explain all 24 comments. The two that matter most:
1. **"Active / available listings" is counted three different ways** across charts (dia shows 119 vs
   468 vs 66 for the *same quarter*; gov "active leases" shows 302 vs 4,734 vs an expected ~8,000).
   This single inconsistency drives ~8 of the comments. **Formula/definition bug — fixable.**
2. **Long-history series (cap rate, volume, txn count) already go back to 2001** in the data — the
   charts truncate or over-smooth them. "Missing pre-2013/2007" is mostly a chart-axis choice, not
   absent data. **Chart config — fixable.**

---

## Root causes (with evidence)

### RC1 — "Active / available" counted inconsistently across charts  ·  FORMULA/DEFINITION  ·  fixable
The same metric resolves to wildly different numbers depending on which `cm_*` view a chart reads:

| Chart (dia, Q1-2026) | "Active listings" |
|---|---|
| Market Turnover / Available Market Size | **119** |
| Inventory Backlog | **468** |
| Available by Term | **66** (term-bucketed subset only) |

`available_listings` has **771** rows at `status='active'`. Each view applies a different
"as-of/active" rule (point-in-time snapshot vs cumulative running inventory vs term-filtered subset).
Gov is worse: a strict active-lease definition (`superseded_at IS NULL AND expiration_date >= today
AND termination_date IS NULL`) returns **302**, the chart's "Total Active Leases" shows **4,734**, and
Scott expects **~8,000**.
**Fix:** one canonical "active as-of date D" definition (a single SQL function/view) that **every**
availability/inventory/turnover chart consumes. Covers dia comments 6, 7, 8, 9, 12 and gov comments 6, 12.

### RC2 — Availability history genuinely starts mid-2022  ·  COLLECTION  ·  not retroactively fixable
`available_listings` active rows begin **2022-07-05** (first captured). We did not capture active-
listing snapshots before mid-2022, so every on-market/available chart is legitimately empty before
~2022 and "climbs from 2023." This is real, not a bug. **Fix:** start availability charts at 2022 and
label the start; we cannot reconstruct pre-2022 active-market snapshots (CoStar doesn't expose
historical point-in-time availability). Covers dia 9 and gov 12 "missing prior."

### RC3 — Long-history series exist to 2001; charts truncate/smooth them  ·  CHART CONFIG  ·  fixable
`Data_Cap_Avg`, `Data_Volume_TTM`, `Data_Txn_Count`, `Data_Sold_Cap_by_Term` all carry **303 monthly
rows back to 2001-01-31** with non-null values. Dia sales exist from **1996** (thin: 3–95/yr through
2012; gov is robust). So "missing 2013/2007 and earlier" = the chart's x-axis starts later and/or TTM
smoothing makes the thin early data invisible — **not** missing data. **Fix:** extend the x-axis to the
first real data point (1996–2001); where Scott wants "back to 1997," show it (flag thin early years).
Covers dia 1 and gov 1, 11, 13.

### RC4 — 2023–2024 dialysis sales dip is REAL in the data  ·  VERIFY COLLECTION
Dia sales by year: 2021=462, 2022=451, **2023=270, 2024=200**, 2025=287, 2026=95 (partial). The sharp
2023–24 drop is the "something funny with 2023." It's either a true market slowdown (rate shock) or a
**capture lag** for those years (2025 recovering to 287 hints at lag). **Action:** reconcile 2023–24
dia sales completeness against CoStar before concluding it's market-driven. Covers dia 4.

### RC5 — Gov State/Municipal data is near-absent  ·  COLLECTION  ·  data gap
Non-superseded gov leases by `government_type`: **Federal 11,272 · State 27 · Municipal 6 · Other 57**.
The State/Municipal cap lines are blank because we have **~0 state/municipal deals** — the GSA/federal
capture doesn't include state & local. **Fix:** either source state/municipal lease+sale data, or
relabel the chart "Federal" and drop the empty series so it doesn't read as a propagation failure.
Covers gov 2.

### RC6 — Gov "active lease inventory" definition is broken (302 / 4,734 / ~8,000)  ·  FORMULA  ·  fixable
Total gov leases **16,616**; not-superseded **11,379**; but only **302** have `expiration_date >=
today`. GSA runs heavy holdover (expired-but-occupied), so "active inventory" cannot key on
`expiration_date >= today`. The chart's 4,734 and Scott's ~8,000 are both attempts at "current
footprint." **Fix:** define active GSA inventory as the **latest non-superseded, non-terminated lease
per property** (ignore expiration for holdover), and make the inventory chart a **stacked bar of that
count over time** totaling ~8,000. Covers gov 6 (and fixes the denominator behind RC7).

### RC7 — Gov lease-event counts (expired/terminated) — magnitude + TTM basis unverified  ·  VERIFY
`Renewal_Rate`: Expired ≈ 927, Terminated ≈ 498 (Mar-26); `Term_Rate`: Terminated(TTM)=498, Total
Active=4,734. Confirm these are **TTM** (not cumulative or monthly), that "expired" isn't counting
holdover leases that are still occupied, and recompute the rates once RC6's denominator is fixed.
1,500 expirations+terminations/yr is plausible at 11k+ leases but the basis must be verified. Covers gov 5.

### RC8 — Y-axis scaling + color/design  ·  CHART CONFIG  ·  easy
Several charts need the y-axis min/max tuned so movement is visible (the series are real but the axis
is too wide); the gov **Rent Heat Map by State** color scheme hides the data. Pure rendering fixes.
Covers dia 2 and gov 8, 11.

### RC9 — Over-smoothed lines vs the legacy Excel/PDF  ·  DESIGN CHOICE  ·  decide + fix
The TTM-averaged series (cap rate by term bucket, lease term remaining at close, NM-vs-market) are
inherently smooth — a trailing-12-month mean flattens the curve. The legacy Excel/PDF reports used
shorter windows / actual quarterly point estimates, so they moved more. This is why "it doesn't look
like our reports" and "moves too smoothly." **Fix:** match the legacy granularity — render quarterly
point estimates (or a shorter rolling window) for these comparison charts, keeping TTM only where a
smooth trend is intended. Covers dia 5, 10, 11 and gov 3, 4.

### RC10 — Northmarq-brokered sales coverage/recency  ·  VERIFY (SF export)
Gov sales overall are robust through 2026 (2025=1,304, 2026=465), so "missing newer than 2020" is
chart-specific, not a data gap. But the **NM-brokered** subset (sourced from Salesforce) must be
verified end-to-end: collection → propagation → the SF export of NM listings/sales, and recent
coverage. **Action:** confirm the NM-brokered sales feed is current. Covers gov 7, 9.

### RC11 — Possible duplicate chart (gov)  ·  CONFIRM
Gov has both "Cap Rate by Remaining Lease Term" and "Cap Rate Comparison — Closed Sales by Lease Term
Remaining" — confirm both are intended (one asking, one closed) vs an accidental duplicate. Covers gov 13.

---

## Comment → root-cause map

**Dialysis:** 1→RC3 · 2→RC8 · 3→RC1/term-sparsity · 4→RC4 · 5→RC9 · 6→RC1+RC2 · 7→RC1 · 8→RC1+RC2 ·
9→RC2 · 10→RC9 · 11→RC9.

**Government:** 1→RC3 · 2→RC5 · 3→RC9/RC1 · 4→RC9 · 5→RC7 · 6→RC6 · 7→RC10 · 8→RC8 · 9→RC10 ·
10→RC3+price-calc · 11→RC8+RC3 · 12→RC1+RC2 · 13→RC3+RC11.

---

## Fix plan (priority order)

1. **Canonical availability/inventory definition (RC1, RC6)** — one `cm_active_listings(as_of)` (dia)
   and one `cm_active_lease_inventory(as_of)` (gov); repoint every availability/turnover/inventory
   chart at it. Highest leverage — fixes the most comments and the credibility issue.
2. **History axis + smoothing (RC3, RC9)** — extend x-axes to first real data; switch the
   comparison/term-bucket/term-remaining charts from TTM smoothing to quarterly point estimates to
   match the legacy reports.
3. **Verifications (RC4, RC7, RC10)** — reconcile 2023–24 dia sales vs CoStar; confirm gov lease-event
   counts are TTM on the corrected denominator; confirm NM-brokered SF feed currency.
4. **Honest labeling (RC2, RC5)** — start availability charts at 2022; relabel/trim the empty gov
   State/Municipal series (or source the data).
5. **Config polish (RC8, RC11)** — y-axis min/max tuning; recolor the Rent Heat Map; resolve the
   duplicate term-bucket chart.

A companion Claude Code prompt implements items 1–5 grouped by root cause:
`CLAUDE_CODE_PROMPT_CM_CHART_FIXES.md`.
