# Claude Code prompt — Round 76: June-10 export review (Scott's notes, both verticals)

> Scott's fifth review pass, on the FRESH June-10 exports (post-R73/R74/R75).
> The dominant signal across ~26 notes is a recurring conviction that **the
> cohort/cap charts still "don't match our PDF/Excel" and "the data conflicts
> with itself"** — i.e. a data collection/propagation/formula gap is blocking
> DB data from reaching the charts, not just thin-n. The verification gate
> already confirmed TWO real defects live (seeded below). This round is
> receipts-first: prove the root cause per chart, fix toward the PDF/Excel, and
> bring each finding back to the gate. Layers by theme; A is the headline.

```
LAYER A — COHORT DATA: propagation + bucketing (THE HEADLINE)
Verified-live defects (start here):
  A1. EMPTY COHORT COLUMNS / dual bucketing. Data_Sold_Cap_by_Term (dia) and
      Data_Cap_by_Term (gov) each emit TWO bucket schemes in one tab; one is
      100% NULL. dia populates 12+/8-12/6-8/≤5 but 10+/6-10/<5/Outside-Firm are
      ALL null; gov is the REVERSE (10+/6-10/<5 populated, 12+/8-12/6-8/≤5 null).
      → Confirm which scheme each CHART series binds to. Scott's "missing 10+
      cohort" (dia) is a series pointed at the null scheme. Decide ONE canonical
      bucketing per vertical, populate it, and delete/repoint the empty columns
      so no chart series can bind to a null set.
  A2. NON-MONOTONIC COHORTS (gov). At 2026-Q1 gov caps: 6-10yr 7.43% > 10+yr
      6.93% > <5yr 6.94% — the 6-10 cohort is anomalously the HIGHEST, so the
      term-premium lines cross. Receipts: per-cohort n by quarter; is the 6-10
      bucket starved/outlier-driven, or is a real cohort being mis-binned? The
      R73 Layer-A TTM pooling did not resolve gov. Compare to the master's
      method (it stays monotonic). Fix toward parallel, ordered cohort lines;
      document any genuinely-inverted period with receipts.
  A3. "Doesn't match PDF/Excel / conflicts prior to 2018" recurs on dia
      Sold/Ask cap-by-term and gov cap-by-term + cap-by-credit. For each:
      cross-check the chart's cohort n against the DB universe (sales with
      cap_rate AND term present). If the chart is starved vs that universe,
      find the view filter/join dropping eligible rows (the propagation gap
      Scott senses). Receipts: eligible-DB-rows vs chart-rows per cohort/year.

LAYER B — DATA COMPLETENESS (both ends)
  B1. Pre-2015/2016 history thin/missing (dia notes: "missing before 2015",
      "counts prior to 2016 look weak", "weak pre-2016"). Confirm we're pulling
      ALL pre-2016 sales/listings the DB holds; if the data exists but isn't
      charted, it's a view floor/filter. If genuinely absent, document the floor.
  B2. Recent-edge gaps: missing 10+ cohort %-price-change from 2024+ (dia
      Active_DOM_PC), missing new-to-market 2025+ while 2024 is overstated
      (dia + gov turnover — the R70/R74-6c over-stamp theme), gov "missing
      newer than 2020" on a cohort cap chart. Receipts per edge.

LAYER C — ON-MARKET = POINT-IN-TIME SNAPSHOT, not a TTM sum (Scott explicit)
  C1. "This should be a snapshot in time — just a count of those available at
      that point, NOT a sum of the TTM counts." The on-market/available chart
      must render the point-in-time active inventory (the active_count ≈125
      we landed in #9), not a TTM-summed series. Find the chart summing TTM and
      switch it to the snapshot. Also Scott: 2026 on-market counts look low and
      take the x-axis back. Reconcile the snapshot vs turnover series so they
      tell the same honest story.

LAYER D — X-AXIS REACH (extend where consistent; recurs on ~8 charts)
  Take the x-axis further back where the series stays consistent: dia (the
  y-axis-zoom line chart, the "consistent before 2020" line, cohort charts past
  2016), gov (the "consistent data" chart, CPI-CAGR start-at-data so there's no
  leading gap — note "x-axis start where we have CAGR data"). RULE unchanged:
  extend only where consistent; gate + annotate genuine thinning. Pair with B1.

LAYER E — SPECIFIC CHART DESIGN
  E1. gov #18 Lease Termination STILL not stacked — "stack the two lease-term
      categories so we see total lease inventory over time." Firm + soft term
      counts as STACKED bars (total height = total active leases) + the rate
      line on secondary axis. (R73 C2 was specced; verify it didn't land and
      finish it.)
  E2. gov #13 Cap by Credit Tier — "line type different for municipal and
      state; fix." Make the cohort line styles consistent (the R73 marker work
      left muni/state with a different line type). Still "missing data" — pair
      with A3 (credit-tier cohort starvation).
  E3. gov #26 Volume+Cap — "chart type and color scheme need adjusting so we
      can see what's reported." Revisit the combo type + palette (brand order)
      for legibility; ensure the secondary axis separation from R73 C4 landed.
  E4. Y-AXIS zoom + LABELS. Several charts need a tighter y-axis to show line
      movement, and Scott wants the y-axes LABELED (dia note 2; gov note 24).
      Add axis titles + sensible min/max to the flagged line charts.

LAYER F — gov #20 over-smoothing / cap basis (links to deferred Task 5)
  F1. Scott: "formula or over-smoothing issue — data doesn't match Excel/PDF
      or the dialysis version." The gate confirmed the gov #20 raw view shows
      NM ≈/above market (NM 6.96% vs market 6.83% at the deck quarter), vs the
      deck's NM 6.78% well BELOW market 7.35%. This is the deferred gov
      cap-basis question: present Scott the option to compute gov #20 on the
      curated Internal-comp basis (like dia → 6.38%) vs the raw market-universe
      view, with the spread each produces. Decision gate before any view change.

LAYER G — OUTLIER REVIEW
  G1. dia: "huge outlier taking the data significantly up around 2022/23."
      Identify the chart + the outlier sale(s); band/exclude per the existing
      outlier policy (exclude_from_market_metrics) if it's a non-representative
      deal, else document. (Confirm it's not the HQ2 $93.5M — already excluded.)

ORDER: A (cohort propagation — the headline, reshapes the most) → C (snapshot)
→ E (design) → B/D (completeness + reach) → F (Scott's call) → G. Receipts per
item; view changes live with before/after; any write dry-run → gate. Per-item
before/after at the recent + a historical anchor. Scope across sessions.
NOTE: map each numbered note to its chart from the export's chart order first;
the notes are in scroll order and skip the charts Scott found clean.
```
