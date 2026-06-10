# Claude Code prompt — Round 75: gov valuation-index + lease-renewal-rate view perf rewrite (export FETCH FAILED)

> The June-10 fresh gov export shipped two tabs with the `⚠ FETCH FAILED —
> re-export` sentinel (the R68-E hardening working as designed): **Data_Val_Index**
> (`cm_gov_valuation_index_m`, chart #23) and **Data_Renewal_Rate**
> (`cm_gov_lease_renewal_rate_m`, chart #17). The R73 chart-code IS present (the
> Renewal_Rate header carries the R73 diverging cols "expired/terminated (neg)" +
> "Net Change"); the **data fetch timed out**. The independent verification gate
> measured both live — this is NOT transient: it's the same R72/R69 pathology.
> dia is clean (0 FETCH FAILED). These two are the only blockers to the gov
> closeout.

```
TASK — rewrite both gov views single-scan, target <1s each (R69 termination /
R72 CAGR are the reference single-scan rewrites). Live-read views (no deploy);
apply via Supabase, commit canonical SQL, then re-export gov and confirm both
tabs POPULATE (sentinel gone).

ROOT-CAUSE SHAPES (from EXPLAIN ANALYZE, gov DB scknotsqkcheojiaewwh):

cm_gov_valuation_index_m — Execution 9,588 ms:
  - gsa_snapshots Seq Scan 694,041 rows → Sort spills to disk (external merge
    Disk: 20,176 kB) computing the per-month occupancy/rent (`r`) CTE.
  - The unified Append computes the expensive `calc` CTE TWICE — once for the
    pre-2013 master-curated branch, once for the >=2013 GSA branch — so the
    9.6s body runs ~2×. Compute `calc` ONCE (CTE/materialized) and reference it
    from both branches.
  - Aggregate gsa_snapshots to the monthly grain in a single pass (window/range
    join with an indexed snapshot_date predicate), not a 682k-row merge-join +
    disk sort per the month_anchors cross.

cm_gov_lease_renewal_rate_m — Execution 11,035 ms:
  - 5 correlated SubPlans, each a Seq Scan on gsa_leases (≈7,495 rows) ×147
    month-anchors = ~5×147 full scans. Replace the per-anchor correlated
    subqueries with ONE pass: a single range/window aggregate over gsa_leases
    (and the expired-events anti-join over gsa_lease_events) joined once to
    month_anchors with FILTER aggregates. The SubPlan-5 (expired anti-join,
    >1000-same-day sentinel exclusion) keep EXACTLY as-is logically.

REWRITE PRINCIPLES (mirror R69/R72):
  1. One pass over the base table; window/range aggregate, not correlated
     per-anchor scans or a month×rows cross that discards 97% by date filter.
  2. Preserve correctness EXACTLY: the >1000-same-day sentinel exclusion, the
     rent/SF bands, the pre-2013-curated vs >=2013-GSA splice (val index), and
     the R73 renewal diverging series (first-gen/renewed/succeeding ABOVE zero;
     expired+terminated as NEG helper cols; signed Net Change). The R73 deck
     match (diverging+net) and the R68-G val-index formula must be preserved.

VERIFY (before replacing live):
  - Values byte-identical at 3 spot quarters (e.g. 2019-12, 2022-12, 2025-03)
    for BOTH views — full series row-count too (val index ~321; renewal ~147).
  - EXPLAIN ANALYZE each rewritten view < 1000 ms warm (headroom for a cold
    Railway dyno on the export fetch).
  - After apply, regenerate the gov export and confirm Data_Val_Index +
    Data_Renewal_Rate populate (sentinel gone, real rows), and the #17 diverging
    + #23 index render.

NOTE: nothing else in the June-10 export failed — dia 100% clean; gov clean
except these two. This is the last open perf item before the gov closeout.
```
