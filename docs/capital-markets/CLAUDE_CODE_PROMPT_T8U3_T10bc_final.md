# Claude Code prompt — final two: T8-U3 (accurate termination numerator) + T10b/c (gov combo + average→dot)

> The last two CM items. Scott's call on T8-U3: **go with the most accurate representation** — harden the
> snapshot-departure numerator (exclude restatement snapshots) and FLIP to it. T10b/c are now pinned from the
> June-29 rendered deck. gov `scknotsqkcheojiaewwh` (+ dia for the T10 mirror if applicable). Reversible;
> injector + image renderer in sync; ≤12 api/*.js. After both land, regenerate BOTH exports.

## T8-U3 — flip the gov termination numerator to snapshot-departures, hardened (ACCURACY-FIRST)
**Decision (Scott 2026-06-29):** the `termination_date` (firm-term OPTION date) numerator undercounts real
departures ~5-6× (rate reads ~3-9% vs the true ~15%). Flip to the **snapshot-departure** numerator — a lease
counts as terminated over the trailing year if its `lease_number` is present in the snapshot ~12mo before
`period_end` and ABSENT in the snapshot at `period_end` — which is the same authoritative `gsa_snapshots`
basis the T8-U1 active count already uses. **BUT** CC's investigation found `gsa_snapshots` contains
**restatement snapshots** (2026-03-01 & 2026-06-01 jump to ~7,495 vs the smooth ~7,340 trend) that re-add
keys and MASK recent departures → a naive flip craters the most-recent point to ~1% (36 vs ~600/yr). So:
- **Harden the snap-pair selection — exclude restatement snapshots.** Detect them (a snapshot whose distinct
  `lease_number` count deviates from the local trend by more than a threshold, e.g. > ~1.5-2% above the
  trailing-3-snapshot median, OR a known restatement-date list) and EXCLUDE them from BOTH endpoints of every
  departure comparison. When `period_end`'s nearest snapshot is a restatement, use the most-recent CLEAN
  snapshot instead (same carry-forward discipline as the T8-U1 plausibility guard). Document the detection
  rule.
- Compute `terminated_ttm` (and `terminated_outside_firm_term`, filtered to the snapshot's
  Succeeding/Extension `latest_action`) from the clean-snapshot departures over the trailing 12 months.
- **Flip** `cm_gov_lease_termination_rate_m`/`_q` to this numerator (keep the T8-U1 snapshot active-count
  denominator + the plausibility guard intact). **Re-fit the gov termination-rate axis data-drivenly** (the
  T2 `fitDataAxisRange`; the ceiling moves from ~0.11 toward the ~15-18% the true rate needs).
- **Verify the recent tail does NOT crater** — the most-recent points must read in the plausible ~12-18%
  band (consistent with the historical departure rate), NOT ~1%. Report the rate series before/after at a few
  periods (incl. 2025-12, 2026-03) and confirm no restatement-driven dip. Footnote the basis change
  ("termination rate restated to a snapshot-departure basis, 2026-06").
- Reversible (prior view body in the migration header). View-only; gov.

## T10b — gov combo chart: colors/types blocking each other (gov 24)
**Pinned (June-29 deck):** the offender is **"Volume + Cap Rate + Quartile Band"** — the only 3-type combo
(areaChart + barChart + lineChart), where the quartile band (area) + volume (bar) + cap line overlap and
obscure each other. **Fix:** set a clear z-order (band area behind, volume bars mid, cap line on top), give
each series a distinct brand color with the band at low opacity, and confirm the primary/secondary axis
assignment is correct (volume on one axis, cap% on the other). Both renderers in sync. (If, on the rendered
deck, gov page 24 is actually a different combo — e.g. Market Turnover or Rent & Price PSF — apply the same
z-order/color fix there; confirm the page first.)

## T10c — gov "average should be a dot, not a bar" (gov 25)
**Pinned candidate:** **"Average Deal Size — TTM"** (a `barChart` literally titled "Average…") is the most
likely target — switch its average series from a bar to a **dot/marker** (scatter/marker overlay), matching
the dot-plot convention. **Confirm against gov deck page 25 before editing** — if page 25 is instead an
"average cap/rent" series rendered as a bar inside another chart, convert that series to a dot instead.
Both renderers in sync; number formats unchanged.

## Gate
- T8-U3: termination rate on the hardened snapshot-departure numerator; restatement snapshots excluded;
  **recent tail in the plausible ~12-18% band (NOT ~1%)**; axis re-fit; before/after + detection rule
  reported; footnoted; reversible.
- T10b: the 3-type combo legible (z-order + distinct colors + correct axes); T10c: the "average" is a
  dot/marker, not a bar — both confirmed against the rendered gov pages 24/25.
- Injector + image renderer in sync; ≤12 api/*.js. **Regenerate BOTH exports** for the final visual confirm.

## Boundaries
- T8-U3 is the one published-line change — gate it hard on the no-crater check (the restatement-snapshot
  exclusion is the whole point). T10b/c are config; confirm the exact deck pages before editing a client deck.
- No fabricated data; the snapshot-departure measure uses only real snapshot keys; reversible throughout.
