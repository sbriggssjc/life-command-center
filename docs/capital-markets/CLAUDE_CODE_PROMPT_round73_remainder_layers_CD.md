# Claude Code prompt — Round 73 remainder: Layer C (chart design) + Layer D (axis reach) + Layer-B singles

> Closes out the June-8 review. Layer A (cohort consistency, 6 charts) and the
> two big Layer-B items (#9 active-count, #20 NM flag) shipped in prior sessions.
> This prompt = the remaining design/axis/data-bug items, all independent of the
> Salesforce round (R74). Injector + image-renderer parity on every chart change;
> harness assertions in-session; Scott verifies the rendered export. Gov deck
> pages referenced are the 2024-Q2 "State of the Government-Leased Market" PDF.

```
LAYER C — CHART DESIGN (deck-match)

C1. #17 gov Lease Renewal Rate — DIVERGING + NET LINE (revert R70-A3's stack).
    Scott: "expirations and terminations show a negative number below zero;
    total actions = a net number so we can display the trend line." Deck p28:
    first-gen commencements / renewed / succeeding ABOVE zero; expired +
    terminated as NEGATIVE bars BELOW zero; a gray NET CHANGE line (signed sum
    of all series) overlaid. This is exactly the diverging design CC built
    pre-A3 — restore it (the data columns + the negative-helper cols already
    exist from R68-E/R70). Injector + PNG renderer; assert series signs + a
    single zero-crossing axis + net-line presence.

C2. #18 gov Lease Termination Rate — STACKED firm/soft bars + rate line.
    Scott: "firm term count and soft term count as bars stacked on top of one
    another so we can show the total active lease count over time." Deck p29:
    Leases In Firm Term + Leases Outside Firm Term as STACKED bars (total height
    = total active leases) on the count axis; the soft-term termination-rate
    line (kept from R70) on the secondary % axis. Currently likely side-by-side
    or single — make them stacked. Keep the wider % axis (2025 data exceeds the
    deck's 14%).

C3. #23 gov Valuation Index — y-axis not displaying. The index line data is
    right (Scott: "looks more normal now") but the axis doesn't render. Fix the
    valAx min/max/format so the line shows. (Likely an empty or mis-scaled
    numFmt after the R69/R70 index rebuild.)

C4. #26 gov Volume + Cap + Quartile Band — secondary-axis separation. Scott:
    "adjust the y-axis on cap rate so the volume portion isn't hidden behind the
    cap rate data." Put the cap-rate series/band on a secondary axis scaled so
    the volume bars are visible (the cap band currently overlays/obscures the
    volume). Same review for the dia equivalent (#4 Rent/SF box — check the
    outlier whiskers aren't crushing the box).

LAYER D — X-AXIS REACH (extend to the earliest quarter the series stays
          consistent; 7d added gov history pre-2015; else document the floor)
  D-list (set the catAx/dateAx floor + confirm the series is continuous there):
    #2 dia DOM & %Ask (back past 2018) · #3 dia Seller Sentiment (past 2017) ·
    #7 dia DOM & Price-Change (past 2018) · #12 gov Bid-Ask (past 2014) ·
    #15 gov Cash & Leveraged Returns (further back) · #16 gov DOM & %Ask (past
    2018) · #26 gov Volume+Cap (further back).
  #19 gov Net Lease Spread — 10Y TREASURY back to 2001: the treasury series is
    FRED (series DGS10). If our macro_rates table starts late, backfill it from
    FRED (the geocode/FRED pattern) so the treasury line reaches the chart's
    start. This is a data backfill (macro_rates) — dry-run → gate if it writes.
  RULE: extend only where the series stays consistent; if a series genuinely
  thins at the early edge, gate + annotate rather than show a mechanical line
  (the D13 pre-2010 precedent).

LAYER B — remaining singles
  B-#8/#24 — on-market / turnover 2025+ over-stamping VERIFY. The R70
    new_to_market gate + the R73 #9 active-count fix already landed; confirm in
    a fresh export that #8 (dia Market Turnover added-vs-sold) and #24 (gov TTM
    turnover, pre-2012 + 2023+) now read honest floors. NOTE: the deeper
    listing_date backfill is R74 Task 6c — here just verify the gates hold and
    document the floor. (gov 2yr-window interim is documented.)
  B-#13 — gov Cap by Credit Tier still "missing data for a smooth line." The
    state/muni cohorts are sparse → isolated points render invisible on a line.
    Receipts: classifiable state/muni n per year post-7d. Fix: render sparse
    cohorts with MARKERS (so single points show) and/or pool state/muni to
    annual; raise nothing that fabricates. Document the genuine-thin floor.
  B-#21 — gov Rent Growth "missing data": confirm the R72 CAGR perf fix cleared
    the FETCH-FAILED sentinel (view now <1.5s); verify it populates in a fresh
    export.
  B-#1 — dia Bid-Ask "multiple category titles at the bottom for the same data
    + outliers." This is a legend/series-DEDUP bug (duplicate series labels in
    the injector) + an outlier review on the bid-ask spread series. Fix the
    duplicate-label emission; review/gate the visible outliers (band them like
    the other cap series).

ORDER: C (design — highest visible impact) → B singles → D (axis reach). View
changes live with before/after; the treasury backfill (D #19) and anything that
writes rows go dry-run → gate. Per-item before/after at Dec-2025 in the PR.
Scope across sessions if needed.
```
