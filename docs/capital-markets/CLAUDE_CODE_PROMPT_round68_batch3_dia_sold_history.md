# Claude Code prompt — Round 68 batch 3: dia sold-side history depth (R68-B) + YOY/index extension (R68-D)

> Run in **life-command-center**. Addresses Scott's notes D1 (Bid-Ask sporadic
> 2014/15), D10 (cap-by-term cohorts merge pre-2018 + missing sales), D12
> (Volume+Cap choppy pre-2011), D3 (YOY% missing 2014-and-earlier; extend the
> valuation index back). Receipts from live Dialysis_DB, 2026-06-04:

```
VERIFIED BASELINE (sales_transactions by sale year, excl. excluded):
yr    sales  with_cap  with_term  term%
2008   32    19        16         50      ← D12 territory: genuinely thin
2009   21    10        10         48
2010   28    17        17         61
2011   57    34        36         63
2012   53    32        26         49
2013   85    57        54         64
2014  114    80        85         75
2015  164   113       117         71
2016  169   126       125         74
2017  207   136       162         78
2018  257   194       191         74
2022  280   142       184         66
2025  187   124       114         61
2026   58    29        20         34      ← BONUS DEFECT: recent intake terms unresolved

TASK 1 — D10: why do the cap-by-term cohorts merge pre-2018?
Diagnose before fixing: per-cohort (12+/8-12/6-8/<=5) n by quarter 2013–2018 in
cm_dialysis_sold_cap_by_term_dot. Two suspect mechanisms:
  a. thin cohort n → the gate/smoothing collapses series toward the blended mean;
  b. term-resolution quality pre-2018 (lease records era) assigns too many sales
     to the same cohort.
THE LEVER (same pattern as the master parity round): the master workbook's TERM
column is authoritative and already in repo (scripts/master_sales_comps_full.json,
rows carry term_years). The DUP_REVIEW adjudication applied master terms to its
305 matches only. Extend: for every fingerprint-matched master↔sale pair (cap
agreement ≤5bp on untouched source columns — the established identity test)
where our firm_term_years_at_sale IS NULL or differs from master by >1.5y,
backfill/correct the term with source='master_curated' (NOT locked unless
verified). Dry-run plan with per-year counts + 20-row sample → verification gate
→ workstation commit. Expect the biggest lift 2013–2018 where master coverage
is dense and our term% is 49–78%.

TASK 2 — the 2026 term-resolution gap (bonus defect, fix forward)
term% collapsed to 34% in 2026 (20/58). Diagnose: are the lease rows missing for
newly-captured sales, or is the resolver not running on the current intake path?
(The R66-era resolver ran at import; check the sidebar/intake writers call it.)
Fix the writer path so new sales resolve terms at insert; backfill the 2025–2026
unresolved set via the resolver.

TASK 3 — D12: pre-2011 choppiness — present honestly, don't fabricate
With 21–32 sales/yr and 10–19 caps, monthly TTM will be choppy. After Task 1's
term/cap lift, evaluate: (a) does the Volume+Cap+Quartile chart pre-2011 still
whipsaw? If yes, apply a presentation gate (suppress quartile band where TTM
n < 8; keep avg line) rather than inventing data. Document the chart-note.
Check one data lever first: any unimported master rows pre-2011 (the r2 importer
skipped rows without property match — count master rows sale_date < 2011 not in
sales_transactions by the fingerprint test; if >10, stage a mini-import with the
same guards as r2).

TASK 4 — D1: Bid-Ask 2014/15 sporadic — bounded expectations
Bid-ask needs ask+sold pairs; priced listings 2014/2015 = 24/40 (synthetics are
price-less by design and must stay out). Levers in order: (a) CoStar listing
history in raw capture/price_change_history for pre-2017 listings — extract
historical asks where present; (b) if coverage stays thin, gate the bid-ask
series pre-2016 (n>=5 pairs) and document. Do not relax the synthetic guard.

TASK 5 — D3: YOY% before 2014 + valuation index reach
month_anchors start 2001 and sales exist from 2008 (32/yr) — yoy_change_pct
(lag-12 of ttm_volume) should mathematically exist from ~2009. Find why the
chart/tab starts 2014: view start-date clamp, master_m row filter, or chart
crop. Extend back to where TTM count >= 12 (likely ~2009–2010), gate below that.
Same for the Capital Markets Valuation Index: its inputs (volume, cap, quartile)
exist from ~2009 — extend the synthetic recipe's window back to the same gate,
and verify the index doesn't whipsaw on the thin early years (apply the same
n-gate; this is the dia twin of the gov G13 min-n issue).

CONSTRAINTS
- Task 1 backfill is the only bulk write: dry-run plan JSON → my verification →
  workstation --commit (standing pattern). Tasks 2/5 are view/code; Task 3/4
  gates are presentation-level.
- The four cap-by-term consumer views must stay byte-identical to each other
  (R66x invariant) — term backfill changes inputs, never forks definitions.
- Acceptance: per-cohort n + cohort separation 2013–2018 before/after; term%
  table re-run; YOY/index start dates; all at the standard anchors.
```
