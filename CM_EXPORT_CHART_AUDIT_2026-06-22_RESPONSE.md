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

## Task 2 — axis extension: investigated; grounding refuted the premise

Grounded the full data path (views → `fetchView` → data tab → native chart). The
data is **already full-range and already charted** — there is no recoverable
truncation at the view or export layer:
- The long-history views span their full history: dia `volume_ttm_q` /
  `count_ttm_q` carry non-NULL values back to **1985** (first sale 1985-08-12);
  gov `cap_ttm_q` / `volume_ttm_q` back to 2001/earlier.
- `fetchView` (`api/capital-markets.js`) pulls every row with no date filter; the
  export writes ALL rows (`dataStart..dataEnd` = first..last row) and the native
  chart references that full range. Round 47's "trim" was a one-round JS change,
  long superseded (the round-47 `.sql` is comment-only).
- The dia **cap-rate** line is genuinely **NULL before ~2005** — `cap_ttm_q`'s
  first non-NULL is 2005-06-30, because dia has only 3–95 sales/yr pre-2005 and a
  TTM weighted cap from <15 sales is noise, not signal (the round-47 audit
  deliberately rejected showing it). Forcing the line earlier would **fabricate
  precision** — not done. Volume/count (a count of 3 IS real) already extend to
  1985.

So "extend the x-axis to first data" is **already true**; the apparent gap on the
cap charts is the honest absence of computable cap rates in the thin early years,
already explained by the existing footer captions ("Dialysis starts 2019…",
"Starts 2017…", "pre-2020 thins — read as indicative"). No view/export change is
warranted; doing one would either fabricate or duplicate existing honest flags.

## Task 4 — Federal relabel + 2022 note: grounding changed the verdict

**Federal relabel — NOT done (the data refutes it; a relabel would destroy real
data).** The gov `cap_by_credit` chart's State/Municipal series are **not empty**:
State = **76** non-NULL quarters (through 2025-Q3), Municipal = **29** (through
2023-Q1). These are *sales*-derived cap cohorts — the audit conflated them with
the *lease* mix (which is ~99.7% Federal). The existing footer caption already
says exactly this: "State and municipal are genuinely sparse … real data scarcity,
not a defect." Relabeling "Federal" and dropping the series would erase real
comparative history. **Left intact** — the honest, already-documented state.

**2022 availability note — done, accurately.** Grounding shows dia
`available_listings` carry real (non-synthetic) `listing_date` back to
**2001-10-16**, and `available_market_size_q` starts **2015**; active-listing
coverage builds gradually (single digits 2013–16 → ~25 by 2019 → 60 in 2024). So a
hard "starts 2022" cutoff would *hide* 2015–21 data. Instead, refined the
`available_market_size_combo` footer caption to flag the coverage ramp honestly
(systematic verification began mid-2022; pre-2017 indicative; deliberately NOT
truncated to 2022). Also refined the `lease_termination_rate` and
`leased_inventory_by_state` captions to document the Task-1 holdover-inclusive
(~8,000) definition + the TERMN-option-date caveat. (`api/_shared/cm-excel-export.js`,
ships on the Railway redeploy; `node --check` clean, 12 functions.)

## Task 5 — config polish

**Heat-map recolor — DONE.** The gov Rent Heat Map by State was rendering as flat
navy bars (single fill) in BOTH the native Excel chart and the PNG fallback —
that's the "current scheme hides the data" complaint (it's a heat map with no
heat). Added `heatRampColors()` (`cm-native-chart-injector.js`): a pure pale-sky
→ NM-Blue ramp by each state's `avg_rpsf`, applied as per-bar `<c:dPt>` fills in
the native bar (guarded — absent `spec.colors` ⇒ byte-identical to every other
bar chart) and as a `backgroundColor` array in the PNG renderer. Now the bars
shade light→dark by rent. Test: `test/cm-heat-ramp.test.mjs` (4, incl. the
cross-module import). Ships on the Railway redeploy; no view/data change.

**Cap-by-term "duplicate" — confirmed NOT a dupe (don't delete blind).** Grounding
the trio: `cap_rate_by_lease_term` ("Cap Rate by Remaining Lease Term",
**closed-sale TTM LINE**, Data_Cap_by_Term) vs `sold_cap_by_term_dot_plot`
("…Closed Sales by Lease Term Remaining", **closed-sale per-deal DOT** plot,
Data_Sold_Cap_by_Term) vs `asking_cap_by_term_dot_plot` (**asking** dot plot,
Data_Ask_Cap_by_Term). The two the reviewer flagged are both **closed-sale** — a
time-trend LINE vs a recent-window dispersion DOT plot (complementary views, not
the same chart); the genuine asking-vs-closed pair is the closed-dots vs the
asking-dots. So all three are intentional. **Recommendation:** keep the closed
LINE + the asking DOTS; the closed DOTS is the only candidate to drop if the deck
wants one fewer term-cap panel — an editorial call for Scott, not a blind delete.

**Y-axis min/max — mechanism confirmed; specific charts need naming.** The
line/bar builders already accept `spec.yAxisRange:{min,max}` (`valAxScalingFrag`)
— pinning is per-chart config, just not set on the flagged "dia chart 2 / gov 11".
Those chart numbers aren't resolvable from the export code without the June-22
review doc's numbering, and pinning a wrong range hurts more than it helps, so I
held rather than guess. Tell me which two charts (or "all the cap-rate trend
charts") and I'll add a fitted range — the classic win is a non-zero floor on the
cap-rate line charts so 6–8% movement isn't flattened against a 0-based axis.

---

## Reversibility
Task-1 view changes re-apply the prior DDL (captured in the round-19 /
round-73 / term-bucket migrations); drop `cm_gov_active_lease_inventory(date)` and
`cm_gov_leased_inventory_by_state_q` to fully revert gov. Brand tokens untouched.
