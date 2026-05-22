# R51 — Active-Listings Sparseness Audit

User notes 2026-05-21 flagged 4 charts as having sparse pre-201X data that
R47 didn't sweep into MIN_YEAR_BY_TEMPLATE. This audit categorizes each
as TRUE-gap (axis trim) vs real data thinning (document, no chart fix).

## Per-year data density (cm_dialysis_* quarterly views)

| Year | rent_box | active_cap_quart | avail_mkt | active_dom_pc |
| ---  | ---:     | ---:             | ---:      | ---:          |
| 2010 |   4 |  0 |  0 |  0 |
| 2011 |   4 |  0 |  0 |  0 |
| 2012 |   4 |  0 |  0 |  0 |
| 2013 |   4 |  0 |  0 |  **4** |
| 2014 |   4 |  2 |  0 |  4 |
| 2015 |   4 |  **4** |  3 |  4 |
| 2016 |   4 |  4 |  **4** |  4 |
| 2017 |   4 |  4 |  4 |  4 |
| 2018 |   4 |  4 |  4 |  4 |
| 2019 |   3 |  4 |  4 |  4 |
| 2020 |   4 |  4 |  4 |  4 |
| 2021 | **2** |  4 |  4 |  4 |
| 2022 |   2 |  4 |  4 |  4 |
| 2023 | **0** |  4 |  4 |  4 |
| 2024 |   2 |  4 |  4 |  4 |
| 2025 |   2 |  4 |  4 |  4 |

(Bold = first full year of coverage, or first year with sparseness.)

## Conclusions

### TRUE-gap (R51 trims to first full year via MIN_YEAR_BY_TEMPLATE)
- **asking_cap_quartiles_active** → 2015 (2 partial rows in 2014; full from 2015 Q1)
- **available_market_size_combo** → 2016 (3 partial rows in 2015; full from 2016 Q1)
- **dom_price_change_active**     → 2013 (full from 2013 Q1)

### Real lease-data sparseness — NOT a chart-axis fix
- **rent_psf_box_quarterly** — Lease ingestion thinned from 2021+:
  - 2010-2020: 5-12 leases/quarter (consistently above the `HAVING n_leases >= 4` gate)
  - 2021-2025: 1-7 leases/quarter (many quarters below the gate)
  - 2023: 1-3 leases per quarter — every quarter falls below the gate, so zero rows survive

  The `HAVING n_leases >= 4` gate in `cm_dialysis_rent_box_q` is correct
  behavior — emitting an IQR + median + min/max from 1-3 samples would be
  statistically misleading. The visible sparseness reflects real
  lease-record availability in the source `leases` table, not a chart bug.

  Two possible follow-ups:
  1. **Backfill lease records** for 2021-2025 (external data agreement
     required — same R-backfill track from R47).
  2. **Relax the gate** from `n_leases >= 4` to `n_leases >= 2` so the
     median has SOME signal in thin quarters. Trade-off: median from 2-3
     points is highly volatile and the IQR/whiskers collapse to a point.
     Not recommended without user direction.

  R51 leaves this view unchanged; documented here so future audits don't
  re-discover the same pattern.

## Verification

```
asking_cap_quartiles_active dataStart shifts to first 2015 row
available_market_size_combo trims to 2016
dom_price_change_active trims to 2013
```

All 3 tests pass in `test/cm-native-chart-injector.test.mjs` (R51 block).
Total CM injector tests now 140 (was 137 after R50).

## Related

- R47: original axis-trim pass for 14 templates
- R48: statistical formula fixes (verified percentile_cont is real on
  active_cap_quartiles_active — same data-tightness story as the
  closed-sale cap_quartile)
- R-backfill (deferred): pre-2003 dia comps + 2021+ leases
