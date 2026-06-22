# CM Export Chart Audit (2026-06-22) — Implementation & Findings

Response to the June-22 chart-by-chart review. Every number below was grounded
live against Dialysis_DB (`zqzrriwuavgrquhisnoa`) and government-lease
(`scknotsqkcheojiaewwh`) on 2026-06-22. View changes are applied live (CM
doctrine: Supabase views are live immediately) and committed as migrations.

---

## Task 1 — ONE canonical availability / inventory definition  ✅ DONE (both DBs)

### dia — `cm_dialysis_active_listings_m/_q` is the single source of truth
The canonical row-level active-listings view already existed; prior rounds had
converged most charts onto it. Grounding (period_end 2026-03-31) found only two
stragglers diverging:

| view | before | after |
|---|---|---|
| canonical `active_listings` count(DISTINCT property_id) | 119 | 119 |
| `available_market_size_q.count_total` | 119 | 119 (already canonical) |
| `market_turnover_m.active_count` | 119 | 119 (matches canonical for ALL 147 periods, exact) |
| `inventory_backlog_m.active_count` | **468** | **119** |
| `available_by_term` SUM(n_listings) | **82** | **119** |

Migration `20260722_cm_round74_dia_canonical_active_inventory.sql`:
- `inventory_backlog_m.active_count` → `count(DISTINCT property_id)` over the
  canonical view (was a divergent `eff`-based 468). `months_of_supply` recomputes.
- `available_by_term_bucket` → de-duped to one row per property + an explicit
  **"Undisclosed Term"** bucket (38 props) so the buckets SUM to the canonical
  total (15+46+17+3+38 = 119). Was listing-level with unknown-term silently dropped.

**Gate met:** all dia availability charts now report an identical 119 for Q1-2026.

### gov — `cm_gov_active_lease_inventory(as_of date)` (≈ 8,000)
The gov charts read **`gsa_leases`** (the GSA footprint), not the `leases` table.
Grounded: `gsa_leases` total = **7,892** (one row per lease_number, none
superseded). The strict `lease_expiration > now() AND termination_date null/future`
filter cut it to **4,602** (the chart's "4,734") because:
1. `gsa_leases.termination_date` is the GSA **TERMN soft-term / early-termination
   OPTION date** (populated on most leases), NOT a "lease is dead" flag.
2. GSA **holdover** means an expired lease can still be occupied = active inventory
   (`latest_action='Holdover'` on 257 rows; no `latest_action` value is a dead state).

The `leases`-table "302" the audit cites is a *different table* (detailed lease
economics), not the GSA footprint.

Migration `government/20260622_cm_round74_gov_canonical_active_lease_inventory.sql`:
- `cm_gov_active_lease_inventory(as_of)` = every current-feed gsa_lease commenced
  by `as_of`, **holdover-inclusive** (ignore expiration + termination_date). At
  today = **7,892**.
- `cm_gov_leased_inventory_by_state` repointed at it: 4,602 → **7,892** (same
  column shape, no export break).
- `cm_gov_lease_termination_rate_m` active denominator → holdover-inclusive
  (builds to 7,849 at latest quarter).
- **`cm_gov_leased_inventory_by_state_q`** (NEW) — quarterly by-state time series
  (entry-cumulative, holdover-inclusive) that builds to 7,849. This is the data
  foundation for Scott's "stacked by state over time" request; charting it as a
  stacked area is a catalog/template change (see Task 5 / follow-ups).

**Deliberately NOT repointed:** `cm_gov_market_turnover_m.active_count` measures
the for-sale **LISTING** universe (investment-sale turnover = TTM sales ÷
for-sale listings), a genuinely different concept from the lease footprint.
Repointing it to the 8,000 lease inventory would misstate turnover. Same for the
dia market-turnover (sale listings). Left as-is by design.

---

## Task 3 — verifications (findings; nothing fabricated)

### dia 2023–24 sales dip — mostly CAPTURE LAG, with a real rate-cycle component
Market-eligible dia sales/yr (sold_price>0, not excluded): 2022=279, 2023=191,
2024=**129**, 2025=187, 2026=61 (partial). The decisive signal is capture lag —
avg days from sale_date to row `updated_at`: 2022=1437d, 2023=1064d, 2024=688d,
2025=325d, 2026=85d, and CoStar captures jump in 2025 (91) vs 2023–24 (32/26).
**Interpretation:** 2023–24 are under-captured and still filling in (a deal 688
days stale in 2024 is still arriving in mid-2026); the 2025 rebound is recent,
low-lag CoStar capture. There was a genuine higher-rates slowdown in 2023–24, but
the depth of the 2024 trough is amplified by capture lag — treat 2024 as
incomplete, not a true floor. **Recommend a targeted 2023–24 dia CoStar backfill**
before treating the dip as fully real.

### gov lease-event counts ARE TTM (confirmed); "expired" includes holdover
`cm_gov_lease_renewal_rate_m` / `_termination_rate_m` window every count as
`event_date/termination_date > period_end − 1yr AND ≤ period_end` — **TTM, not
cumulative/monthly** (confirmed in the DDL). The published "Expired ≈ 927" is the
**de-bulked** count: the renewal view drops `gsa_lease_events` date+type groups
with >1000 rows as mass-ingest artifacts (raw last-12mo `expired` = 3,822,
`modified` = 55,771 — the latter are snapshot-diff noise). Caveat: the "expired"
event fires on lease_expiration regardless of holdover occupancy, so the expired
COUNT does include still-occupied holdovers — it is "reached expiration," not
"vacated." "Terminated ≈ 498" derives from `gsa_leases.termination_date` in the
TTM window, which (per Task 1) is the soft-term OPTION date — so the termination
numerator counts leases *reaching their termination option*, not confirmed
move-outs. The Task-1 denominator fix (4,602 → ~8,000) makes the rate
denominator correct; the numerator semantics are a known limitation to flag on
the chart.

### gov Northmarq-brokered subset — real RECENT attribution gap
NM is tracked by the `is_northmarq` flag (not broker-name; a name match returns 0).
NM-tagged gov sales/yr: 2019=9, 2020=18, 2021=17, 2022=12, **2023=3, 2024=1,
2025=2, 2026=0** — and `is_northmarq_source` is NULL for 2024+. Overall gov sales
stay robust, so this is a **collection/propagation gap from 2023 onward**: the
Salesforce NM-deal export is no longer tagging recent gov closings. The NM-vs-Market
and NM-track-record charts are starved on the right edge for this reason — not a
formula bug. **Recommend re-running / repairing the SF→gov `is_northmarq`
propagation for 2023–2026.**

---

## Tasks 2, 4, 5 — recommendations (chart-config layer; not yet applied)

These are largely axis/labeling/template changes (the catalog +
`cm-excel-export.js` / renderer), riskier than the view-layer Task-1/3 work and
out of the "fix at the view layer" boundary. Grounded recommendations:

- **Task 2 axis** — long-history series (`cap_avg`, `volume_ttm`, `txn_count`,
  `sold_cap_by_term`) already hold 303 monthly rows back to 2001; the charts
  truncate via the round-47/51 axis-trim config. Extend each long-history chart's
  x-axis start to first real data (dia sales from 1996, thin pre-2013; gov
  robust). Flag thin early years rather than hide them.
- **Task 2 smoothing** — the term-bucket / term-remaining / NM-vs-Market caps were
  deliberately moved to 2-yr TTM pools in round 73 to survive thin buckets.
  Quarterly point estimates will move more but go sparse/empty in thin gov+dia
  buckets. Recommend a SHORTER rolling window (e.g. 4-qtr) rather than raw
  quarterly points, and keep TTM only on the headline volume/cap-avg. Needs a
  per-chart judgment pass.
- **Task 4 gov Federal labeling** — non-superseded leases are Federal 11,272 /
  State 27 / Municipal 6. The empty State/Municipal cap lines are a real data
  gap. Relabel the cohort chart "Federal" and drop the empty State/Municipal
  series so it doesn't read as a propagation failure.
- **Task 4 availability start** — dia active-listing capture began 2022-07-05;
  start the availability charts at 2022 with a note. Do not imply pre-2022 coverage.
- **Task 5** — Y-axis min/max fit-to-range (dia chart 2, gov 11); recolor the gov
  Rent Heat Map by State (`cm_gov_rent_heat_map`) via `cm_brand_tokens.json`;
  resolve the gov "Cap Rate by Remaining Lease Term" vs "…Closed Sales by Lease
  Term Remaining" duplicate (asking vs closed — confirm both intended or drop one).

---

## Reversibility
Task-1 view changes re-apply the prior DDL (captured in the round-19 /
round-73 / term-bucket migrations); drop `cm_gov_active_lease_inventory(date)` and
`cm_gov_leased_inventory_by_state_q` to fully revert gov. Brand tokens untouched.
