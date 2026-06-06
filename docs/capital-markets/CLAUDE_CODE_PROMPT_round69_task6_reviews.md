# Claude Code prompt — Round 69 Task 6: final three per-chart reviews (gov)

> Closing reviews of the June-5 notes. The June-6 exports were audited by the
> verification gate: all round-69 fixes confirmed present (5 resurrected charts
> 303/303; termination 159 rows first clean render; cap-by-term 255/255
> smoothed; both valuation indexes corrected; dia 10+ asking cohorts populated
> through 2025; zero empty/failed tabs in either book). These three items are
> the judgment reviews queued behind that audit. Work from the live gov DB +
> the LCC repo — no workbook access needed.

```
REVIEW 1 — G20 (img20): Rent by Year Built — 2021+ rows inconsistent
Scott: "The data from 2021 on seems to be much more inconsistent than the
balance. Review to ensure we are pulling in accurate information."
The view was rebuilt in R68-E (G9: single-cohort fix, 0/34 buckets out of band)
— so the remaining complaint is about the RECENT-VINTAGE rows specifically.
Check: (a) which source populates rents for build-years 2021+ (new construction
→ CMBS/OM-sourced rents vs lease-table rents — mixed bases would explain the
inconsistency); (b) per-bucket n for 2021-2025 vintages (likely thin → consider
the same n-gate used elsewhere, or pool recent vintages into a "2021+" bucket
like the deck does — check the gov PDF's rent-by-year-built page for its
bucketing). Fix only with receipts; document if genuinely thin.

REVIEW 2 — G24 (img24): Market Turnover Monthly — 2023+ inconsistency
Scott: "The data for 2023 and onward looks way less consistent with the balance."
The monthly added-to-market series post-2023 mixes: organic captures (thin in
2023-24, the known intake gap), synthetics (sale-anchored, ended at sales), and
the 184 master-upgraded listings (real on-market dates). Quantify the per-month
mix 2023-2026 vs 2017-2022 and determine whether the visual inconsistency is
(a) genuine market slowdown, (b) the organic-capture gap (document as
self-healing via the page-marker capture), or (c) a synthetic-vs-organic date
clustering artifact (e.g., imputed listing_dates clumping at sale_date - median
DOM creating artificial spikes). If (c), consider jittering is NOT allowed —
instead gate or annotate. Receipts per month-bucket in the report.

REVIEW 3 — G25 (img25): TTM turnover chart — missing series
Scott: "We are missing several pieces of data from this chart (total available
and monthly clearance rate)."
The view (cm_gov_market_turnover_m) HAS the columns (active_count,
months_of_supply, monthly_sales_count — verified populated 255/255 in the
June-6 export tab). So this is a CHART SERIES-WIRING gap: the chart template /
native-chart injector for market_turnover_ttm (gov) doesn't map those columns
as plotted series. Compare the gov chart spec against the dia equivalent and
the deck's version (active inventory + months-to-clear lines). Add the missing
series to the injector + image renderer (parity), harness assertions for
series count/names. This is LCC code → ships on the next Railway redeploy.

REPORT: per-review verdict + receipts; any view change live with before/after;
the G25 wiring fix on a PR. These are the last three items of Round 69.
```
