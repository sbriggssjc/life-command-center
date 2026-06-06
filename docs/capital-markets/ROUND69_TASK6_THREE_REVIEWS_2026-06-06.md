# Round 69 — Task 6: final three per-chart reviews (gov)

Closing reviews of the June-5 notes. Worked from the live gov DB
(`scknotsqkcheojiaewwh`) + the LCC repo. Per-review verdict + receipts below.

| Review | Chart | Verdict | Disposition |
|--------|-------|---------|-------------|
| G20 | Rent by Year Built — 2021+ inconsistent | **Two real bugs + genuine thinness** | Live view fix (applied) |
| G24 | Market Turnover Monthly — 2023+ inconsistent | **Organic-capture gap (b) + minor clustering (c); NOT a clean market signal** | Document; no data change |
| G25 | TTM Turnover — missing series | **Chart series-wiring gap (confirmed)** | View gate + injector/renderer wiring (PR) |

---

## REVIEW 1 — G20 Rent by Year Built (img20)

> Scott: "The data from 2021 on seems to be much more inconsistent than the
> balance. Review to ensure we are pulling in accurate information."

### Receipts (live, before fix)

`cm_gov_rent_by_year_built` returned 34 buckets, 1990..**9999**. The recent tail:

| year | n | avg | median | Q1 | Q3 | avg building RSF |
|------|---|-----|--------|----|----|------------------|
| 2016 | 7 | 34.92 | 32.99 | 28.97 | 41.91 | 91,228 |
| 2017 | 4 | 28.48 | 28.10 | 26.42 | 30.16 | 188,615 |
| 2018 | 6 | 37.18 | 35.16 | 34.20 | 40.60 | 69,183 |
| 2019 | 4 | 34.42 | 31.81 | 24.10 | 42.13 | 50,095 |
| 2020 | 4 | 26.21 | 26.93 | 19.30 | 33.84 | 193,110 |
| **2023** | **3** | **18.15** | **14.65** | **10.96** | **23.60** | **411,074** |
| **2024** | **2** | 35.55 | 35.55 | 34.38 | 36.71 | 36,007 |
| **9999** | **13** | 37.24 | 27.91 | 16.86 | 42.40 | 47,025 |

(2021, 2022, 2025 had **zero** in-band rows.)

**(a) source / basis.** The view reads `properties.gross_rent_psf` directly.
Of 179 properties built 2021+, only **5** have an in-band rent — and **all 5 are
`costar_sidebar`** (CoStar new-construction capture), vs the 1990-2020 buckets
which are dominated by `excel_master` lease-table rents. Different basis =
exactly the inconsistency Scott sees. Worse, the 2023 bucket mixes a
**1,048,631-SF GSA Federal Supply Service distribution warehouse @ $7.27/SF**
(prop 9525, Burlington NJ) with a 137k-SF FBI office @ $32.54 — warehouse vs
office economics averaged into one "vintage."

**(b) per-bucket n.** 2023 n=3, 2024 n=2 — far below any quartile-stability bar.

**The 9999 sentinel.** 13 `excel_master` rows carry `year_built = 9999`
(placeholder for "unknown year built"). Because `9999 >= 1990`, the R68-E filter
let them render as a phantom vintage with n=13 — pure noise on a year axis, and
**an n-gate alone never catches it** (n=13 ≥ 8).

### Verdict & fix (applied live + migration committed)

Two independent bugs + one honest limitation:

1. **9999 sentinel** → cap `year_built <= CURRENT_YEAR+1`. Drops the phantom.
2. **Thin recent vintages** → `HAVING count(*) >= 8`, the quartile-band gate the
   dia cap-quartile chart already uses (R68b). Below 8, Q1/median/Q3 whipsaw.
3. **2021+ is genuinely thin** (5 in-band, warehouse-contaminated). Documented;
   self-heals as recent-vintage leases accrue. **Pooling into a "2021+" bucket
   (the deck's approach) was considered and rejected** — 5 mixed rows including a
   1M-SF $7 warehouse would still fail the gate and would *hide* the
   contamination instead of surfacing it.

Effect: **34 → 26 buckets, 1990..2015, min n=9, every avg ∈ [Q1,Q3]**, no
phantom, no whipsaw. Note the clean cut lands at **2015**, not 2021 — 2016-2020
were also sub-gate (n=4-7), they just happened to land in the normal range.

Migration: `supabase/migrations/government/20260606_cm_round69_g20_rent_by_year_built_sentinel_and_quartile_gate.sql`.

---

## REVIEW 2 — G24 Market Turnover Monthly (img24)

> Scott: "The data for 2023 and onward looks way less consistent with the
> balance."

### Receipts — the "added to market" series composition by year

Reconstructed `cm_gov_inventory_backlog_m`'s `inv_windows` (the source of
`added_month`) by source class — count of window-starts per year:

| yr | synthetic_from_sale | master_curated | organic listing | sales on-market | total |
|----|---------------------|----------------|-----------------|-----------------|-------|
| 2017 | 57 | 14 | 0 | 14 | 85 |
| 2018 | 104 | 19 | 0 | 24 | 147 |
| 2019 | 55 | 15 | 0 | 17 | 87 |
| 2020 | 128 | 16 | 0 | 16 | 160 |
| 2021 | 120 | 23 | 0 | 27 | 170 |
| 2022 | 76 | 15 | 0 | 17 | 108 |
| **2023** | **41** | **11** | **0** | **10** | **62** |
| **2024** | **30** | **8** | **0** | **7** | **45** |
| **2025** | **40** | **0** | **1** | **7** | **48** |
| **2026** | **0** | **0** | **79** | **3** | **82** |

And the monthly `sold_month` (from real `sales_transactions`) declines in
lockstep: TTM sales fell 161 (2022) → 99 (2023) → 57 (2024) → 45 (2025).

### Verdict: **(b) organic-capture gap + minor (c) clustering — NOT a clean market signal**

- The "added to market" series is **~75-80% `synthetic_from_sale`** through 2025
  — i.e. listing windows *back-computed from sales* (listing_date imputed from
  sale_date − DOM). Organic listing captures were **essentially zero before
  2026** (0,0,0,0,0,0,0,0,1 → then 79 in 2026). So pre-2026 the chart is
  effectively plotting *sales twice* (once as "sold", once as "added", back-dated)
  rather than an independent on-market signal.
- Therefore the post-2023 dip is **mostly (b)**: the synthetic series mirrors the
  real sales slowdown, and there is no organic listing signal to fill it in.
  2026 is a **regime change** — 79 organic window-starts, 0 synthetic — the
  page-marker / OM-intake capture finally producing real listing dates. This is
  the self-healing the June notes anticipated.
- A **minor (c)** component exists: imputed `listing_date`s cluster at quarter
  boundaries, producing the March spikes (2021-03 = 24, 2023-03 = 12). The bulk
  vendor imports (crexi @ 2026-03-12 ×112; salesforce_ascendix @ 2026-03-31 ×127)
  share a single date but are **already neutralized** by the view's
  `sentinel_dates` filter (any date with ≥20 listings is excluded).

### Disposition: document, no data change

The view math is honest — it counts what's in the data. **Per the brief, jitter
is not allowed, and there is nothing to "fix with receipts" here** because the
inconsistency is a data-composition artifact (synthetic back-dating + the
organic-capture gap), not a view bug. Recommended: leave the math intact; the
series self-heals as organic capture accrues (already visibly true in 2026). If
a cosmetic improvement is wanted later, the right move is an **annotation**
("inventory additions pre-2026 are sale-derived estimates"), not altering the
data.

---

## REVIEW 3 — G25 TTM Turnover (img25)

> Scott: "We are missing several pieces of data from this chart (total available
> and monthly clearance rate)."

### Receipts — the columns exist and are reliable from 2012 on

`cm_gov_market_turnover_m` carries `active_count`, `months_of_supply`,
`monthly_sales_count` (255/255 months populated). Yearly averages:

| yr | active | TTM sales | months of supply |
|----|--------|-----------|------------------|
| 2005-2010 | **0** | 45-140 | 0 (degenerate) |
| 2011 | 0.6 | 143 | 0.1 |
| 2012 | 20.5 | 137 | 1.7 |
| 2013-2022 | 35-98 | 117-186 | 4-8 |
| 2023 | 34.6 | 99 | 4.3 |
| 2024-2025 | 20-27 | 45-57 | 4-8 |

So the chart was a **series-wiring gap** (confirmed): R66s had *stripped* the
active-universe bar + months-of-supply line for gov (single "Monthly Sales Rate"
bar in both the injector and the image renderer), citing thin listing coverage.
The data shows the universe is **degenerate only before 2012** (zero listing
history), then stable and plausible (4-8 months of supply).

Two parity gaps found while comparing specs:
- The **gov injector** showed a single navy bar (stripped); the **gov image
  renderer** also showed a single bar — but the renderer's *dia* path is a single
  `turnover_rate` line while the *dia injector* is a 3-series combo. The deck /
  dia injector shape is: Total Available bar + Monthly Sales Rate bar +
  Months-of-Supply line.

### Fix (PR — ships on next Railway redeploy) + one live view gate

1. **View gate (live, applied):** `cm_gov_market_turnover_m` now NULLs
   `active_count` and `months_of_supply` for the pre-coverage months (raw
   `active_count = 0`, i.e. pre-2012). The universe series start cleanly at
   2011-06; the Monthly Sales Rate bar keeps the full 2005+ sales history.
   `market_universe` / `turnover_rate` left numerically unchanged (not plotted,
   zero blast radius). Migration:
   `supabase/migrations/government/20260606_cm_round69_g25_market_turnover_gate_universe_precoverage.sql`.
2. **Injector** (`cm-native-chart-injector.js`): gov `stripUniverse` → `false`.
   Gov now emits the full 3-series combo at parity with dia + the deck:
   **Total Available** (active_count) bar + **Monthly Sales Rate** (TTM/12) bar +
   **Months of Supply** line on the right axis.
3. **Image renderer** (`cm-chart-image-renderer.js`): gov branch replaced the
   single bar with the same 3-series combo (dual axis via `comboOpts`).
4. **Harness:** added `R69 G25` assertion — gov produces 2 bars + 1 line,
   `active_count` back bar, `monthly_clear_pace` front bar, `months_of_supply`
   line, dual axis (`sharedAxis=false`). Full suite green (177 tests).

**Documented caveat (carried from Review 2):** the gov active-universe is ~80%
`synthetic_from_sale`, so Months of Supply is a *relative* inventory-vs-pace
indicator, not an organic on-market count. It strengthens as organic capture
accrues.

**Known remaining divergence (follow-up, not in scope):** the image-renderer
*dia* turnover path is still a single `turnover_rate` line (it diverged from the
dia injector combo long before this round). Left untouched to avoid an
unrequested change to the dia deck; flagged here for a future parity pass.

---

*Round 69 Task 6 complete — these were the last three items of the round.*
