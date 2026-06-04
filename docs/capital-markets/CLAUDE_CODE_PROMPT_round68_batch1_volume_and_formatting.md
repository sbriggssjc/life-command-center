# Claude Code prompt — Round 68 batch 1: volume methodology (R68-C) + chart formatting pack (R68-E)

> Run in **life-command-center**. Sources: Scott's 2026-06-04 chart-by-chart review
> (35 notes, both verticals). This batch = the two quick-win workstreams. The data
> investigations (dia listing depth, gov firm-term) follow in batch 2.

```
PART 1 — VOLUME = TTM COUNT × AVG DEAL SIZE (both verticals)

Scott's Excel method (the deliverable standard): TTM volume = TTM count of ALL
confirmed transactions (including price-unknown — some municipalities never
disclose) × average deal size of the priced subset for the same window. Our
views instead compute sum(sold_price) AND exclude unpriced sales from the
count entirely (classified_sales WHERE sold_price > 0).

Verified live impact:
- gov: 2,197 of 2,577 sales since 2023 are unpriced (85%) — volume massively
  understated. Since 2020 the unpriced rows are transaction_type='brokered'
  (3,601 unpriced vs 1,160 priced) = genuine market sales, non-disclosure.
- dia: 0 unpriced since 2023 — near-no-op, but apply the same formula for
  methodological consistency across verticals.

Changes (cm_dialysis_market_quarterly_master_m + cm_gov_market_quarterly_master_m
+ any per-template volume/transaction-count views so every consumer agrees):
1. classified_sales: drop the sold_price>0 requirement from the COUNT cohort
   (keep it for price-derived metrics). Keep all other exclusions
   (exclude_from_market_metrics, transaction_type, date) unchanged.
2. ttm_count = all transactions in window (priced + unpriced).
3. avg_deal_size = avg(sold_price) FILTER (priced, existing 100k–200M band) — unchanged.
4. ttm_volume = ttm_count × avg_deal_size  (the new series of record).
   Keep ttm_volume_confirmed = sum(sold_price) as a secondary audit column.
5. yoy_change_pct re-derives from the new ttm_volume automatically (lag-12) — verify.
6. transaction_count_ttm shown on Transaction Count charts must be the
   INCLUSIVE count — confirm consistency everywhere (charts, data tabs, MasterPasteReady).

Gov guard: confirm the unpriced cohort really is market transactions — if any
deed-transfer/non-arm's-length records exist outside the transaction_type values
seen ('brokered','Investment','Owner-User','direct','Build-to-Suit'), exclude them
from the count. Do NOT let count×avg inflate on administrative deed noise.

Acceptance: gov TTM volume at Dec-2025 before/after with the count/avg receipt;
dia within rounding of current; YoY recalculated; all volume consumers byte-identical.

PART 2 — FORMATTING PACK (11 items, chart/format-level)

 1. D13 (dia Quarterly Volume Bars): y-axis currency abbreviations ($300M, $1.2B).
    Then SWEEP both verticals for consistent currency-axis numFmt.
 2. D14 (dia Available by Tenant): the Count/Volume DONUTS exist in the xlsx
    (chart31/chart32 + drawing rels confirmed) but the tabs render with no visible
    chart. Diagnose (anchor cell? empty data cache? doughnutChart series refs?)
    and make them render like the PDF donuts.
 3. D15 + G17 (Avg Price by [Firm] Term Bucket, both verticals): cap-rate series
    labels unreadable — add data-label callouts (or a dedicated right-axis range
    wide enough to separate the series).
 4. G3 (CPI vs GSA Renewal Rent CAGR): crop x-axis to start 2012-01 — the
    per-lease CAGR series starts 2013-02; the CPI-only early years add nothing.
 5. G5 (Lease Renewal Rate): render terminations/expirations as NEGATIVE bars
    below zero (capital-markets PDF style) so net movement reads. If the PDF
    spec is unclear from repo docs, flag and Scott will resend the deck.
 6. G6 (Lease Termination Rate): add the PDF's line series — leases outside firm
    term actually terminated in the period as % of total. If the source view
    lacks the column, add it (gsa_lease_events has the inputs).
 7. G9 (Rent by Year Built): BUG — the average plots OUTSIDE the quartile band,
    impossible for one cohort. Likely mismatched cohorts (avg over all rows vs
    quartiles over a filtered subset) — fix, then tighten the y-axis.
 8. G11 (Sources of Capital — Top Buyer States 15-yr): y-axis category labels
    ambiguous about which bar they belong to — fix spacing/alignment.
 9. G12 (the two "Top States (TTM)" charts): data is all-time, not TTM — retitle
    to "(All-Time)" (simpler than re-windowing; Scott only flagged the title).
10. G15 + G16: REMOVE from the gov export: "Distribution — Top States (TTM)" and
    "Record by Buyer Type (TTM)" — Scott: unnecessary, do not replicate.
11. G8 hardening (renewal_rent_growth empty-tab incident): root cause was a
    TRANSIENT fetch failure on a cold dyno (view live = 158 rows; REST verified
    healthy; every prior export had data). Add one retry pass to the fetchView
    ladder, console.error on final failure, and write "FETCH FAILED — re-export"
    in the tab instead of a silent "0 rows" so this class of failure is visible.

Constraints: Part 2 is chart/format/injector + image-renderer parity only, except
the named view-column additions (G6) and the G9 cohort fix. No data-layer semantic
changes beyond Part 1. Round-numbered commits, PR to main as usual.

Acceptance: fresh exports of both books show every numbered item; include a
per-item before/after note in the PR description.
```
