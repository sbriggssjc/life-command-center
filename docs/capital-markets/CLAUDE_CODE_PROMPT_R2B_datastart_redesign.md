# Claude Code prompt — R2-B: chart dataStart hygiene + Avg_Deal revert + Returns start + Renewal_Growth redesign + T6 markers

> June-29 round, chart-config layer (decisions confirmed with Scott). Mostly renderer/injector config; keep
> injector + image renderer in sync; reversible; ≤12 api/*.js. dia `zqzrriwuavgrquhisnoa`, gov
> `scknotsqkcheojiaewwh`. No data fabrication.

## Unit 1 — "start each chart where we have data" (repeated June-29 ask)
Rule: each time-series chart's dataStart = the **first period where the chart's primary series has real
data** — don't render empty/blank early space. Apply per-chart (compute the first non-null period and floor
the category axis there). Flagged charts:
- **dia:** Bid_Ask (no data pre-2013), Cap_Avg (pre-2005), Returns_Idx (see Unit 2), NM_vs_Market (pre-2012).
- **gov:** Bid_Ask (pre-2007), NM_vs_Market (data starts ~2014 — start the chart there, not 2001/1997),
  Market_Turnover (active-listing counts missing pre-2012 — start there).
Use the existing per-chart dataStart/`MIN_YEAR_BY_TEMPLATE` mechanism. Where the early-low look is real thin
collection (dia/gov Market_Turnover pre-2016/2012), starting at first-real-data resolves it; if any series is
genuinely mid-history sparse (not a clean start), gap honestly. Report each chart's chosen start.

## Unit 2 — gov Returns_Idx: start ~2001 (both lines complete) + fix x-axis labels
The T7-U2 1997 extension left 1997-2000 with cash caps but NO loan constants → blank leveraged returns + the
x-axis labels broke. **Scott's call: start the returns chart where BOTH cash AND leveraged returns exist
(~2001)** and FIX the missing x-axis labels. (Leave the underlying mat extended; this is a chart dataStart +
label fix — set the returns chart's start to the first period where leveraged_return is non-null, ~2001.)
Confirm the x-axis date labels render across the full plotted span.

## Unit 3 — revert Average Deal Size to a bar (both decks)
The T10c "average→dot" change mis-landed on **Average Deal Size — TTM** (deal size is a $ magnitude; a bar is
correct). **Revert Avg_Deal to a bar chart on BOTH dia + gov** (undo the markerOnly/line change for this
template only). Keep the quarter axis + $X.XM format + labels. The genuine dot treatment goes to
Renewal_Growth (Unit 4), not here.

## Unit 4 — gov Renewal_Growth redesign (gov 9)
Scott: "colors/style make it hard to read. The CAGR can stay a line, but change the average rent to a **dot in
the middle of an up-down bar of the lower and upper quartile**, in **lighter colors** than the line and dots."
So: render `cm_gov_renewal_growth` (or whatever Data_Renewal_Growth reads) as — (a) **CAGR = line** (keep),
(b) **avg rent = a dot/marker** sitting between (c) a **high-low bar** spanning lower-quartile→upper-quartile
rent, with the quartile bar in a **lighter shade** than the CAGR line + avg dot. This is a high-low (open-
high-low-close-style) or error-bar rendering. Both injector + image renderer in sync; confirm the three
elements (CAGR line, avg dot, light quartile bar) read clearly.

## Unit 5 — gov Cap_by_Credit markers refinement (T6 follow-up, gov 3)
Scott: the credit-tier chart "now has dots in the lines" (the T6 uniform markers landed on the dense FEDERAL
line too, which he doesn't want) "and still missing quite a bit of municipal and state deals." Fix:
- Put markers ONLY on the **sparse** series (State + Municipal) so their isolated points show; the dense
  **Federal** line renders as a clean line (no per-point dots). (Markers where they add value, not on the
  dense series.)
- The municipal/state sparsity is REAL (T6 grounded: state→2025-11, municipal→2023-03, only isolated n=1 muni
  after) — annotate honestly ("state/municipal comps are sparse; markers show each available quarter") so the
  gaps read as real scarcity, not a broken pull. Do NOT fabricate points.

## Gate
- Each flagged chart starts at its first-real-data period (reported); gov Returns starts ~2001 with both lines
  + working x-axis labels. Avg_Deal is a bar on both decks. Renewal_Growth shows CAGR line + avg dot + light
  quartile high-low bar. Cap_by_Credit: markers on State/Municipal only, Federal a clean line, sparsity
  annotated. Injector + image renderer in sync; reversible; ≤12 api/*.js.

## Boundaries
Config/render + dataStart only (no data writes except none here). No fabricated points — "start where data
is" and "annotate sparsity," never invent early/missing values.
