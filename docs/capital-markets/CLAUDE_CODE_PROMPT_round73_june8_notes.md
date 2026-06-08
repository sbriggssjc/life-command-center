# Claude Code prompt — Round 73: June-8 export review (26 notes, both verticals)

> Scott's fourth review pass (June-8 exports, post-7d-import + R72). The
> dominant theme (9 of 26 notes) is cap-by-term cohort lines CROSSING where the
> PDF/Excel lines stay parallel — Scott believes it's a data/formula/propagation
> gap. 7d already imported the master comps, so this round must settle it with
> RECEIPTS (per-cohort n vs the master) and fix toward the PDF behavior, OR
> prove the residual is genuine. Verification-gate receipts confirmed two live
> findings already (embedded below). Layers A–D; A leads (it reshapes the most
> charts).

```
LAYER A — THE HEADLINE: cap-by-term cohort consistency (#5,#10,#11 dia ·
          #14,#22,#25 gov)
Scott: "historically been a gap in the averages in these lease term buckets
that stays consistent and doesn't illogically pass one another." The PDF/Excel
cohort lines are smooth + parallel (term premium always visible); ours cross.
Charts: dia Asking Cap Quartiles by term (#5), dia Closed-Sales-by-Term-Remaining
dot (#10), dia Asking Cap Ranges by Term Buckets (#11); gov Cap by Remaining
Lease Term (#14), gov Seller Sentiment 10+ cohort (#22), gov Closed-Sales-by-
Term (#25).
INVESTIGATE (receipts-first, BOTH verticals):
  1. Per-cohort n by quarter 2015-2026 for EACH chart's source view. Where a
     cohort line crosses another, show the n at that quarter — confirm it's
     thin-n noise (1-3 deals, one outlier flips the order).
  2. Compare to the master's apparent method: the master TTM-averages its
     curated comps over a stable window so the lines stay parallel. Our
     per-month n-gated cohorts are noisier. Quantify: at the crossing
     quarters, is the term premium actually inverted in the data, or is it a
     thin-n artifact?
FIX (toward the PDF, without fabrication):
  - Widen the cohort smoothing/pooling so the term premium stays monotonic
    where the underlying data supports it: e.g. rolling-4-quarter (or wider)
    TTM pooling on the cohort lines, raise the per-cohort n-gate, and/or a
    longer TTM window — matching the master's stability. Document the exact
    window/gate per chart.
  - Confirm we're pulling ALL term+cap data post-7d: cross-check the cohort
    n against sales_transactions with both cap_rate_final AND
    firm_term_years_at_sale present. If cohorts are still starved vs that
    universe, find the propagation gap (view filter dropping eligible rows).
  - The gov "core = 6+ yr" definition (R70 A1) must be reflected in #22's
    cohort + LABELS — Scott re-flagged "government should be a 6+ year cohort
    here, confirm and fix the labels."
ACCEPTANCE: the four cohort lines fan out and stay ordered (term premium
visible, no illogical crossings) at the labeled periods; per-chart before/after
n + cohort values; document any genuinely-inverted period with its receipts.

LAYER B — DATA/LOGIC BUGS (receipts-first)
B1. #9 dia active-universe over-count (Market Turnover TTM). VERIFIED LIVE:
    2024-Q3 counts 256 active (193 organic + 63 synthetic), but only 126 have
    a NULL off_market_date — Scott's ~130 expectation ≈ that 126. Two inflators:
    (a) synthetics (sold deals) in the active window; (b) organic listings with
    no off_market_date counting active for up to 1095 days (3yr) when most
    close within a year. FIX: the "active at quarter end" count should be
    genuinely-available inventory — tighten the no-off-market assumed-active
    window (evaluate 365-540d vs 1095d against the availability-checker's
    actual close cadence) AND decide synthetic treatment (they belong in the
    historical added-to-market series, but for the point-in-time ACTIVE count
    Scott wants tracked-available only). Target: the active line lands near
    ~130 at recent quarter-ends, matching what NM reports. Same audit gov-side
    (#24 — listing count issues pre-2012 + 2023+ drop-off).
B2. #20 gov NM-vs-Market: the NM avg cap sits BELOW the market line for almost
    the whole series. Receipts: NM vs non-NM TTM avg cap by quarter — is NM
    genuinely lower (NM brokers premium/lower-cap assets → plausible) or is the
    gating/weighting wrong? Compare to the PDF's relationship. Fix only if the
    method is wrong; otherwise document it's a real (and sensible) spread.
B3. #8 dia + #24 gov on-market 2025+ storage ("tons added 2025, none recent").
    This is the R70 over-stamping fix — VERIFY the June-8 export predates the
    new_to_market gate landing, or whether residual stamping remains. Confirm
    the gated series now shows honest floors that self-heal.
B4. #13 gov Cap by Credit Tier still "missing data for a smooth line" — the
    state/muni render-chain issue (sparse points rendering invisible). Receipts:
    classifiable state/muni n per year post-7d (the import added agency/TYPE);
    marker-render or annual-pool the sparse cohorts.
B5. #21 gov Rent Growth "missing data" + #1 dia Bid-Ask "multiple category
    titles at the bottom for the same data + outliers" — #1 is a
    legend/series-dedup bug (duplicate series labels) plus outlier review; #21
    confirm the R72 perf fix cleared it (was FETCH FAILED).

LAYER C — CHART DESIGN (deck-match; injector + image renderer parity)
C1. #17 gov Lease Renewal Rate: Scott wants expirations + terminations as
    NEGATIVE bars below zero + the total actions as a NET line (the diverging
    design). NOTE: R70 A3 flipped this to all-positive stacked — Scott is now
    explicitly reverting to diverging+net for the RENEWAL chart. Re-confirm
    against the gov PDF p.28 which shows the gray Net Change line. Implement
    diverging + net line.
C2. #18 gov Lease Termination Rate: firm-term + soft-term counts as STACKED
    bars (total height = total active lease count over time) + the soft-term
    rate line (kept). Deck p.29.
C3. #23 gov Valuation Index: y-axis "not displaying" (data is right — Scott
    says it "looks more normal" now). Fix the axis range/format so the line
    renders.
C4. #26 gov Volume + Cap + Quartile Band: y-axis on the cap-rate series so the
    volume bars aren't hidden behind the cap band (secondary-axis separation).
    Same dia request implied (#4 Rent/SF box outliers — review).

LAYER D — X-AXIS REACH (extend back where the post-7d data supports a
          consistent line; else document the honest start)
  #2 dia DOM/%Ask (back past 2018) · #3 dia Sentiment (past 2017) · #7 dia
  DOM/Price-Change (past 2018) · #12 gov Bid-Ask (past 2014) · #15 gov Returns
  (further back) · #16 gov DOM/%Ask (past 2018) · #19 gov Net Lease Spread —
  10Y Treasury back to 2001 (macro_rates/FRED — backfill the table if our copy
  starts late) · #26 gov Volume+Cap (further back).
  RULE: extend the x-axis floor to the earliest quarter the series stays
  consistent (7d added gov history pre-2015; treasury is a FRED backfill). If a
  series genuinely thins, gate + document rather than show a mechanical line.

ORDER: A (cohorts — the headline, reshapes 6 charts) → B (data bugs) → C
(design) → D (axis reach). Receipts per item; view changes live with before/
after; any bulk write dry-run → gate. Per-item before/after at Dec-2025 in the
PR. Scope across sessions if needed (A alone is a full session).
```
