# Claude Code prompt — T8: rebuild the gov active-lease-over-time from the GSA inventory snapshots

> Scott (June-25, gov export, Lease Termination chart): "there should be more than 1,750 active GSA leases
> in 2013. It's as though we are only displaying the currently-active GSA leases as of this quarter over
> time." **Confirmed — and it's worse than that: the COUNTS bar is inverted.** The fix is a data RECOVERY
> (the true point-in-time inventory is already stored in monthly snapshots back to 2013), not an axis tweak.
> gov `scknotsqkcheojiaewwh`. View-only, reversible, no domain-row writes. ≤12 api/*.js.

## Root cause (grounded live 2026-06-25)
`cm_gov_lease_termination_rate_m`'s `active` CTE computes the counts bar as:
```sql
LEFT JOIN gsa_leases gl ON gl.lease_effective <= m.period_end   -- NO upper bound
count(gl.gsa_lease_id) AS total_leases_active
```
That's a **cumulative count of TODAY's `gsa_leases` table by start date** — so it (a) undercounts history
badly (only leases still in the current table, by when they started) and (b) ramps upward as a pure
artifact. Result vs the truth:

| period | current chart (cumulative-by-start) | TRUE point-in-time (snapshots) |
| --- | --- | --- |
| 2013-01 | **1,840** | **8,845** |
| 2018-05 | ~5,000 | 8,095 |
| 2026-02 | ~7,849 | 7,348 |

The real GSA footprint **declines** ~8,845 → 7,348 over 2013→2026; the chart shows a false **rise**
1,840 → 7,849. The recent end roughly agrees (≈7,300–7,800); the history is entirely wrong.

## The data is already here — monthly point-in-time snapshots (the recovery source)
- **`gsa_snapshots`** (denormalized, one row per lease per snapshot): `snapshot_date`, `lease_number`,
  `latest_action`, plus full lease attributes. **149 monthly snapshots, 2013-01-01 → 2026-06-01** (covers
  past the 2026-03-31 as-of). This is the primary source.
- **`gsa_inventory_snapshots`** (header: `snapshot_date`, `record_count`) + `gsa_inventory_snapshot_lines`
  (the per-lease lines) — 147 snapshots 2013-01 → 2026-02. **Verified:** `count(distinct lease_number)` in
  the lines == header `record_count` == the gsa_snapshots distinct-key count (8,845 @2013-01, 7,348
  @2026-02). So "active inventory at period t = distinct `lease_number` in the snapshot for t" is exact.
- Use **`gsa_snapshots`** (most current, has `latest_action`). Cross-check its per-date distinct-key count
  against `gsa_inventory_snapshots.record_count` where both exist (should match) and report any divergence.

## Unit 1 (must) — repoint the COUNTS bar to the snapshot inventory
In `cm_gov_lease_termination_rate_m` (and `_q`), replace the cumulative `active` CTE so
`total_leases_active(period_end)` = **distinct `lease_number` in the most-recent snapshot on/before
period_end** (carry-forward — see gaps). i.e. for each monthly `period_end`, pick
`max(snapshot_date) <= period_end` from `gsa_snapshots`, and count distinct `lease_number` in that snapshot.
- **Gaps:** a few months have no snapshot (2013-05, 2013-09, a 2018-06→2019-01 stretch, …). Carry forward
  the most-recent prior snapshot (standard point-in-time). Every `period_end` 2013-01→2026-03 has a
  snapshot at/before it, so no head/tail extrapolation is needed.
- This is a **display-only** change to the counts bar — it does NOT touch the rate line math (the rate uses
  `leases_outside_firm_term`, handled separately in Unit 2), so it cannot regress the T2 rate-axis fit.

## Unit 2 (recommended — accuracy, with a re-fit) — rate denominator off the same snapshots
The rate line `terminated_outside_firm_term_pct = terminated_outside_firm_term / avg(leases_outside_firm_term)`
uses `leases_outside_firm_term`, which is the SAME broken cumulative count
(`FILTER WHERE latest_action IN ('Succeeding','Extension')`) — so the early-year denominator is far too low
and the early rate is overstated. Repoint `leases_outside_firm_term(period_end)` to the snapshot sub-cohort:
distinct `lease_number` in the period's snapshot **WHERE `latest_action IN ('Succeeding','Extension')`**.
- This **changes the rate line** (lower/flatter in early years on the corrected larger base). After it lands,
  **re-fit the gov termination-rate axis data-drivenly** via the T2 `fitDataAxisRange` helper (don't leave a
  hardcoded ceiling) — the ~10% ceiling T2 set may need to drop. Report the new rate range.
- Keep `terminated_outside_firm_term` / `terminated_ttm` (the numerators) as-is for Unit 2.

## Unit 3 (investigate + report, don't auto-ship) — events-based termination numerator
The most internally-consistent "unique lease keys over time" rebuild would also derive terminations from the
snapshots: a lease that is present in snapshot(t−12mo) but absent in snapshot(t) departed. `gsa_lease_events`
already materializes the monthly diff (`event_type` incl. a 'disappeared'/departure type). **Assess** whether
a snapshot-departure / `gsa_lease_events`-based `terminated_ttm` is cleaner than the current
`gsa_leases.termination_date` numerator (which is the firm-term option date, not a confirmed move-out), and
**report the comparison** (a few periods, both methods) before changing the numerator. Do NOT ship a numerator
change without surfacing that diff — it would further move the rate line.

## Gate (verify live)
- Counts bar (`total_leases_active`) now reads the snapshot inventory: **2013 ≈ 8,845 declining to ≈ 7,348**,
  NOT 1,840 rising. Spot-check 3–4 periods vs `gsa_inventory_snapshots.record_count`.
- Snapshot gaps carry-forward correctly (no zero/null months in 2013-01→2026-03).
- Unit 2: rate denominator is the snapshot Succeeding/Extension sub-cohort; the rate line is reported
  before/after; the gov termination-rate axis is re-fit data-drivenly (report the new range).
- Unit 3: the events-vs-termination_date numerator comparison is reported (no silent numerator change).
- `_q` (quarterly) variant repointed consistently with `_m`. Reversible (restore the prior view defs).
  No domain-row writes. ≤12 api/*.js. gov only.

## Boundaries / scope
- gov lease termination/active-inventory views only. The `cm_gov_inventory_backlog_m` / `market_turnover`
  views are the LISTINGS flow (already on `on_market_date`, T4c) — a different inventory; do NOT touch them.
- No fabrication — the snapshots are the authoritative GSA inventory; carry-forward only fills month gaps
  between real snapshots. `gsa_leases` is unchanged (still the current working table for other consumers).
- The counts-bar fix (Unit 1) is the headline Scott flagged and is regression-safe; Units 2/3 are the
  accuracy follow-through (rate denominator + numerator) — keep them clearly separated so the rate-line
  movement is reported and the T2 axis re-fits rather than silently breaking.
