# Claude Code prompt — fix the capital-markets export charts (June-22 review)

> Implements the fixes in `CM_EXPORT_CHART_AUDIT_2026-06-22.md`. Scott reviewed the dia + gov
> June-22 exports chart-by-chart; the audit grounds every comment against the export data AND the live
> DBs (dia `zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`). Receipts-first; verify each fix against
> the numbers below; reversible; don't change working chart logic that isn't called out.

## The core problem (highest leverage — do this first)
**"Active / available" is counted three different ways.** Same dia quarter (Q1-2026) shows **119**
(Market Turnover, Available Market Size) vs **468** (Inventory Backlog) vs **66** (Available by Term).
Gov "active leases" shows **302** (strict `expiration_date>=today`) vs **4,734** (chart "Total Active
Leases") vs **~8,000** (the real GSA footprint Scott expects). `available_listings` has 771 `active`
rows; gov has 16,616 leases / 11,379 not-superseded / only 302 unexpired.

### Task 1 — one canonical availability/inventory definition, consumed everywhere
- **dia:** create `cm_active_listings(as_of date)` returning the point-in-time active set
  (`status='active'` and listing live as of `as_of`, de-duped to one row per property). Repoint
  **every** availability/turnover/inventory chart view at it: `Data_Avail_Mkt_Size`,
  `Data_Market_Turnover`, `Data_Inventory_Backlog`, `Data_Avail_by_Term`, `Data_Active_Cap_Quart`,
  `Data_Active_DOM_PC`, `Data_Avail_Cap_Dot`, the donuts. After the fix the "active listings" number
  must be **identical** across all of them for a given quarter.
- **gov:** create `cm_active_lease_inventory(as_of date)` = the **latest non-superseded,
  non-terminated lease per property** (ignore `expiration_date` — GSA holdover means expired-but-
  occupied is still active inventory). Target total ≈ **8,000**, not 302. Repoint `Data_Inventory_State`,
  `Data_Term_Rate` (denominator), `Data_Market_Turnover`, the availability charts.
- Gate: dia active count matches across all availability charts; gov active inventory ≈ 8,000 and the
  inventory chart **stacks by state to that total over time** (Scott's request).

## Task 2 — history axis + over-smoothing (the "doesn't look like our Excel/PDF" complaint)
Receipts: `Data_Cap_Avg`/`Data_Volume_TTM`/`Data_Txn_Count`/`Data_Sold_Cap_by_Term` already hold
**303 monthly rows back to 2001-01-31**; dia sales exist from **1996** (thin: 3–95/yr pre-2013), gov
robust. The data is NOT missing — the charts truncate/smooth it.
- **Axis:** extend each long-history chart's x-axis to the first real data point (1996–2001). Where
  Scott wants "back to 1997," show it; flag thin early years rather than hiding them.
- **Smoothing:** the TTM-averaged comparison charts (cap rate by lease-term bucket, "Cap Rate
  Comparison — Closed Sales by Lease Term Remaining", NM-vs-Market, lease term remaining at close)
  flatten because of the trailing-12-month mean. Render **quarterly point estimates** (or a shorter
  rolling window) for these so they move like the legacy reports. Keep TTM only where a smooth trend
  is the intent (headline volume/cap-avg).
- Gate: the term-bucket + term-remaining charts show real quarter-to-quarter movement; long-history
  charts start at first data.

## Task 3 — verifications (report findings; don't fabricate)
- **dia 2023–24 dip:** sales 2022=451 → **2023=270 → 2024=200** → 2025=287. Reconcile 2023–24 dia
  sales completeness against CoStar — is this a real slowdown or a capture lag? Report which.
- **gov lease events:** confirm `Renewal_Rate`/`Term_Rate` counts (Expired ≈ 927, Terminated ≈ 498)
  are **TTM** (not cumulative/monthly), that "expired" excludes still-occupied holdover, and recompute
  the rates on Task 1's corrected active-inventory denominator.
- **NM-brokered sales (gov 7/9):** gov sales overall are robust through 2026 (2025=1,304, 2026=465),
  so verify the **Northmarq-brokered subset** specifically — collection → propagation → the Salesforce
  export of NM listings/sales, and recent coverage. Report gaps.

## Task 4 — honest labeling (don't paper over collection gaps)
- **gov State/Municipal (gov 2):** non-superseded leases are Federal 11,272 / **State 27 / Municipal 6**.
  The empty cap lines are a real data gap, not a formula bug. Either source state/municipal data, or
  relabel the chart "Federal" and drop the empty series so it doesn't read as a propagation failure.
- **availability start (RC2):** active-listing capture began **2022-07-05**; start availability charts
  at 2022 with a clear note. Do not imply pre-2022 coverage.

## Task 5 — config polish
- Y-axis min/max tuning so movement is visible (dia 2, gov 11) — fit the axis to the data range.
- Recolor the gov **Rent Heat Map by State** — the current scheme hides the data (gov 8).
- Resolve the gov duplicate: confirm "Cap Rate by Remaining Lease Term" vs "Cap Rate Comparison —
  Closed Sales by Lease Term Remaining" are both intended (asking vs closed) or remove the dupe (gov 13).

## Boundaries
- The `cm_*` views are the source of truth the export reads; fix at the view layer, not the export
  formatter, unless the issue is purely axis/color (chart config). Reversible. Keep brand tokens
  (`cm_brand_tokens.json`). Verify every numeric fix against the receipts above before calling it done.
