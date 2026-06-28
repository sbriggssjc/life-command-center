# Claude Code prompt — CM final closeout: T5, T6, T7-U2, T8-U3, T9-legend, T10, T11 (then re-export)

> The remaining June-25/26 export notes after the listing-currency arc (T1-T4c, T7-U1, T8-U1/2, T9, T9b-e are
> all done). Each item below is grounded live. Mostly chart-config + a couple of view/data items. dia
> `zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`. Reversible; no fabricated data; keep injector + image
> renderer in sync; ≤12 api/*.js. After all land, regenerate BOTH exports for a visual confirm.

---
## T5 — core price-change % coverage (dia 5, 9 · gov 27)
**Grounded:** dia `cm_dialysis_dom_price_change_active_m` is now **fully populated** — `pct_price_change_core`
non-null on 179/179 months, 2010-02→2026-03, incl. 15 in 2025+ (the T4c/T9d active-listing rework fixed the
coverage the note flagged). **Action:** (a) confirm the dia DOM/price-change CHART now renders the core series
across the full span (no missing 2025+ / pre-2019 gaps) — it likely just needs the chart's dataStart to not
floor it. (b) **gov side:** there is NO gov price-change-frequency view (only `cm_gov_bid_ask_spread_*` /
`cm_gov_dom_pct_ask_*`). Decide with the data: if gov listing history supports a price-change-frequency metric,
add `cm_gov_dom_price_change_active_m` mirroring the dia view; if gov active-listing history is too thin,
scope it honestly (omit the gov price-change chart or mark it not-tracked) rather than show an empty panel.
Report which. No fabrication — thin spans gap honestly.

## T6 — gov State/Municipal cap rates render as "missing" (gov 18)
**Grounded:** the data EXISTS in `cm_gov_cap_by_credit_m` (federal 303 non-null; **state 227 non-null →
2025-11; municipal 84 non-null → stops 2023-03**) — it only LOOKS missing because the series are sparse and
the line chart breaks on NULL gaps. **Action:** (a) render the sparse State/Municipal series **gap-aware** —
markers on present points + connect-across-nulls (or a scatter/dot overlay) so they're visible instead of
invisible; do NOT drop the series. (b) **Investigate the municipal 2023-03 stop** — is it real (no
municipal-tier gov sales since 2023-03) or a tagging/classification gap upstream? Report root cause; if real,
annotate "no municipal comps since 2023"; if a tagging gap, note it for a data follow-up (don't fabricate
points). Keep injector + image renderer in sync.

## T7 Unit 2 — extend the gov Returns Index to ~1997 (was deferred; Scott now wants it)
**Grounded earlier:** the gov returns index starts 2001-01 only because the shared
`cm_gov_market_quarterly_master_m_mat` does; capped sales exist back to 1970 (60 in 1997-2000, thin).
**Action:** extend that **materialized** table's period window back to **1997-01** (find its generate_series /
window start; change + refresh). **HIGH-CARE (shared table):** it feeds MANY gov CM charts — **audit every
consumer** and confirm each either has its own display floor (won't surface thin 1997-2000 points it
shouldn't) or renders the sparse early span gap-honestly. The returns index's n≥4 gate will gap the sparsest
early months (indicative, not a forced line) — annotate the early span. **Report the full consumer-audit list
+ what each chart does at 1997-2000 BEFORE finalizing.** If the blast radius is unacceptable, fall back to a
returns-index-specific earlier window (compute from `sales_transactions` back to 1997 without widening the
shared mat) — assess + report which approach you used. Reversible.

## T8 Unit 3 — events-based termination numerator (was deferred; moves the rate line)
**Grounded earlier:** the gov termination rate's numerator uses `gsa_leases.termination_date` (the firm-term
OPTION date, not a confirmed move-out) → undercounts real departures ~5-6×. The snapshot-consistent signal is
`gsa_lease_events` 'disappeared' / a lease key present in snapshot(t-12mo) but absent in snapshot(t).
**Action:** switch `terminated_ttm` / `terminated_outside_firm_term` in `cm_gov_lease_termination_rate_m`/`_q`
to the **snapshot-departure / `gsa_lease_events`-disappeared** count over the trailing year (consistent with
the T8 active-count snapshot basis). **This moves the rate line** — report before/after and **re-fit the gov
termination-rate axis data-drivenly** (the T2 `fitDataAxisRange`; the ~0.11 ceiling will change). Keep the
T8-U1 snapshot active-count + the T8 plausibility guard intact. Reversible; report the rate before/after.

## T9 legend — gov cap-by-term [5,6)yr cohort gap
**Grounded:** the gov cap-by-term buckets (10+/6-10/<5/Outside) leave **[5,6)yr** sales uncounted (a gap
between `<5` and `6-10`). **Action:** relabel/redefine **`<5` → `<6`** so the buckets are contiguous
(10+ / 6-10 / <6) and the [5,6)yr sales are captured. Apply in the view + the chart legend (injector + image
renderer). Confirm the bucket counts reconcile (no sale falls in a gap). Reversible.

## T10 — chart design / type (dia 15 · gov 24, 25)
- **dia 15 — remove the "Undisclosed Term" bar** (38 listings) from the dia term-bucket chart
  (`Data_Avail_by_Term` / the asking-cap-by-term term axis). Keep the undisclosed COUNT in a footnote/caption,
  not as a bar. Confirm the 38 reconcile in the footnote.
- **gov 24 — combo chart colors/types blocking each other:** identify the gov combo chart where the bar +
  line series overlap/obscure (likely a Vol+Cap or turnover combo) and fix the color scheme + series types so
  both read clearly (distinct colors, line-over-bar z-order, correct primary/secondary axis assignment).
- **gov 25 — "the average should be a dot, not a bar":** switch the flagged gov "average" series from a bar to
  a dot/marker series (a scatter/marker overlay), matching the dot-plot convention used elsewhere.
  Identify the exact chart (a gov cap/rent average rendered as a bar) and convert. Keep injector + image
  renderer in sync; number formats unchanged.

## T11 — gov Northmarq-vs-market chart (gov 23)
**Grounded:** `cm_gov_nm_vs_market_m` — `nm_cap_rate` is now populated **140 quarters, 2014-08 → 2026-03** (the
2026 NM attribution recovery worked; it already extends back past 2020); `market_cap_rate` 303 non-null.
**Action:** (a) confirm the CHART renders the NM line from 2014 (not floored at a 2020 dataStart — "take back
further than 2020"); lower the dataStart if it's clipping. (b) **Reconcile the "market" series** — Scott:
"market cap should move closer to the avg movement in the cap-rate charts." Compare `market_cap_rate` here vs
the main `cm_gov_cap_avg` (Cap-TTM-Avg) series; if they're on different bases (e.g. one TTM-smoothed, one not),
align the NM-vs-market "market" line to the same basis as the headline Cap-TTM-Avg so they move together.
Report the basis difference + the fix. (c) confirm the NM line "moves better" (populated, not flat).

---
## Gate (all items)
- T5: dia price-change renders full span; gov price-change either added (if history supports) or honestly
  scoped — reported. T6: State/Municipal visible (gap-aware/markers); municipal-stop root cause reported.
  T7-U2: gov returns back to ~1997 with consumer-audit reported + thin early gated (or per-index fallback,
  stated). T8-U3: termination numerator on snapshot departures, rate before/after reported, axis re-fit.
  T9-legend: buckets contiguous (<6), no gap. T10: Undisclosed bar gone (footnoted), combo chart legible,
  average→dot. T11: NM renders from 2014, market reconciled to the avg basis.
- Injector + image renderer in sync on every chart change; reversible; no fabricated data (thin spans gap
  honestly); ≤12 api/*.js; both DBs.
- **THEN regenerate BOTH exports** (dia + gov) so Scott can visually confirm the full set in one pass.

## Boundaries / order
Independent items — can be done in any order, but **T7-U2 is the highest-risk** (shared materialized table):
do its consumer audit and report BEFORE finalizing, and if the blast radius is large prefer the per-index
fallback. T8-U3 moves a published line — footnote + re-fit. Everything else is low-risk config/label.
