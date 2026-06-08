# Claude Code prompt — Round 72: gov CAGR view perf rewrite (export fetch timeout)

> The June-8 gov export shipped two tabs with the `⚠ FETCH FAILED — re-export`
> sentinel (the R68-E hardening working as designed — loud, not silent zeros):
> Data_CPI_CAGR (`cm_gov_cpi_vs_renewal_cagr_m`) and Data_Renewal_Growth
> (`cm_gov_renewal_rent_growth_m`). Root cause is NOT transience: both views are
> data-healthy (255 / 158 rows live) but SLOW — the verification gate measured
> `cm_gov_cpi_vs_renewal_cagr_m` at 4.1s warm, and the plan shows the same
> pathology the R69 termination-rate rewrite killed (27.9s → 403ms): a
> gsa_lease_events self-join doing multi-million-row nested-loop cross-products
> (3.6M + 3.5M rows removed by join filter) plus a 9.5MB external-disk sort. At
> 4+s warm, a cold Railway dyno tips past the export fetch timeout
> deterministically for these two CAGR views.

```
TASK — rewrite both per-lease-CAGR views to single-scan, target <1s each.

ROOT-CAUSE SHAPE (from EXPLAIN ANALYZE of cm_gov_cpi_vs_renewal_cagr_m):
  - CTE `renewals`: Nested Loop over month_anchors × renewals, 229,627 actual
    rows, 3,657,308 removed by the date-window join filter.
  - CTE `pl` (per-lease prior-rent): Nested Loop 222,575 actual, 3,529,615
    removed; a self-join of valid_events on lease_number with an external
    merge Disk sort (9,584kB) over 253k rows.
  These are the same correlated/cross-join + re-sort shape the termination
  view had. Both CAGR views (cpi_vs_renewal_cagr_m AND renewal_rent_growth_m)
  share the per-lease-CAGR CTE pattern — rewrite the shared logic once.

REWRITE PRINCIPLES (mirror the R69 termination single-scan fix):
  1. Compute the per-lease prior-rent / CAGR ONCE in a single pass over
     gsa_lease_events (window LAG over (lease_number ORDER BY event_date) for
     the prior renewal rent, instead of the valid_events × valid_events
     self-join). This kills the external-disk sort + the 9.5MB spill.
  2. Aggregate to the monthly TTM grain via ONE join to month_anchors with
     FILTER aggregates, not a nested loop that materializes millions of
     (anchor × event) pairs then discards 97% by date filter. If a range join
     is unavoidable, gate it with an indexed event_date predicate so the
     planner stops cross-producting.
  3. Keep the sentinel-date exclusion (>1000 same-day events) and the
     rent/SF band [5,100] EXACTLY as-is — they are correctness, not perf.
  4. Per-lease CAGR semantics unchanged: each renewed lease's new rate vs its
     own earliest-observed (~commencement) rate, annualized over elapsed
     years, TTM-averaged with the upper/lower quartile band. The R67 deck
     match (flat ~1%) must be preserved.

VERIFY (before replacing live):
  - Values byte-identical at 3 spot quarters (e.g. 2019-12, 2022-12, 2025-03)
    for BOTH views — CAGR per-lease, quartiles, and (cpi view) the CPI YoY
    column. Diff the full series row-count too (255 / 158).
  - EXPLAIN ANALYZE each rewritten view < 1000ms (warm). Target the export
    fetch budget with headroom for a cold dyno.
  - Both are live-read (no deploy); apply via Supabase, commit the canonical
    SQL to government-lease. Then confirm in a fresh gov export that
    Data_CPI_CAGR + Data_Renewal_Growth POPULATE (sentinel gone).

NOTE: the R69 dia/gov valuation-index and termination rewrites are the
reference implementations for the single-scan + window-function pattern.
Nothing else in the June-8 audit failed — dia book 100% clean, gov clean
except these two; this is the last open data/perf item.
```
