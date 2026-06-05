# Round 68-A — Final report: dia listing-side data depth (applied state + before/after)

**Status: APPLIED to prod (Dialysis_DB `zqzrriwuavgrquhisnoa`) + committed.**
Addresses Scott's notes D2/D5/D6/D7/D8/D9/D11. Receipts below are from live
Dialysis_DB queries, 2026-06-05.

This supersedes the gate-state language in `README.md` (which predated execution).
All three tasks, the go-forward capture code, **and** a post-backfill leak fix are
live.

---

## What is live

| Artifact | State |
|---|---|
| `available_listings.data_source` / `listing_date_source` provenance columns | live |
| 1,207 synthetic listing rows (`data_source='synthetic_from_sale'`) | live |
| 212 LINK-class real-listing→sale links (207 applied; 5 residual, see below) | live |
| Synthetic include/exclude view rules (`20260605_cm_round68a_synthetic_listing_views.sql`) | live |
| Task 3 rolling-3-quarter pooled 10+ asking-cap quartiles | live |
| Go-forward Task 1 capture (`dia_record_listing_date_correction` RPC + availability-checker `parsers.ts` markers + sidebar `listing_date_source` tagging) | live |
| **Leak fix** (`20260605_cm_round68a_synthetic_price_cap_leak_fix.sql`) | live |

---

## Task 1 — the 2025 intake hole

Hypothesis (capture channels defaulted 2025 listing_date to 2026 capture date)
was **killed by the evidence**: `created_at` is NULL on the 2026-dated rows, there
are zero `raw_text` Date-on-Market markers to recover from, and OM-intake is
2026-only. The organic capture channel simply collapsed in 2025 (20 organic
listings vs a 113–203 band). No blind re-dates shipped.

Re-scoped to a **receipt-gated, go-forward** mechanism that is now live: the
availability-checker parses a marketing-start marker ("Listed on" / "Date on
Market" / "Days on Market" / JSON-LD `datePosted`) off the live CREXi/CoStar/
LoopNet page and calls `dia_record_listing_date_correction(listing_id, new_date,
url, marker)`, which only moves a date materially earlier (>30 d) and stamps
`listing_date_source`. The sidebar capture path stamps `listing_date_source`
(`costar_date_on_market` / `costar_days_on_market`) so a true marketing-start
date is recorded at capture time going forward. The **2025 recovery itself is
carried by Task 2**, not by re-dating.

## Task 2 — synthesize listing history from unlinked sold deals

1,207 price-less synthetic listings (one per unlinked sold deal: `listing_date =
sale_date − median DOM for that year's linked cohort`, `off_market_date =
sold_date = sale_date`, `sale_transaction_id` linked, `status='sold'`,
`is_active=false`). A separate **LINK class** linked 207 of 212 *existing* real
unlinked listings to their nearest prior sale instead of synthesizing them (no
double-count). 5 residual LINK candidates are intentionally left unwritten — 2
are `Superseded` (the link path would force `status='sold'`, which is wrong for a
superseded row) and the rest are dedup edge cases; zero chart impact.

**Doctrine:** active-universe/COUNT charts INCLUDE synthetic; price/DOM/cap charts
EXCLUDE them.

### Acceptance — new-listings per year (listing_date), before vs after

| year | organic | + synthetic | = total |
|---|--:|--:|--:|
| 2012 | 7 | 28 | 35 |
| 2013 | 22 | 46 | 68 |
| 2014 | 26 | 93 | 119 |
| 2015 | 41 | 74 | 115 |
| 2016 | 57 | 108 | 165 |
| 2024 | 140 | 101 | 241 |
| **2025** | **20** | **76** | **96** |

The 2025 added-to-market count rises **20 → 96** (target ~99), and the pre-2016
active-universe cliff (`<50/yr`) is erased. ✔

### Available Market Size — `count_total` before/after (quarter-end)

| period_end | before (organic) | after (incl. synthetic) | Δ |
|---|--:|--:|--:|
| 2013-12-31 | 22 | 68 | +46 |
| 2014-12-31 | 26 | 119 | +93 |
| 2015-12-31 | 41 | 115 | +74 |
| 2016-12-31 | 57 | 165 | +108 |
| 2024-12-31 | 140 | 241 | +101 |
| **2025-12-31** | **19** | **95** | **+76** |

### Market Turnover — `active_count` before/after (1095-day window)

| period_end | before | after | Δ |
|---|--:|--:|--:|
| 2014-12-31 | 63 | 107 | +44 |
| 2015-12-31 | 62 | 90 | +28 |
| 2016-12-31 | 98 | 134 | +36 |
| 2025-12-31 | 358 | 392 | +34 |

(2025 Δ is small because the 1095-day cap keeps many older real rows active; the
synthetic lift concentrates in early history where the cliff was.)

### DOM & % of Ask / Bid-Ask / Seller Sentiment — EXCLUDE, byte-identical

These six views carry the explicit `data_source IS DISTINCT FROM
'synthetic_from_sale'` guard. Synthetic rows do not feed them. ✔

## Task 3 — 10+ cohort gate re-test + rolling pooling

The 10+ asking-cap quartile series (`cm_dialysis_asking_cap_quartiles_active_q`)
had **no core-count gate** — `percentile_cont` over 1–3 listings emitted
meaningless quartiles. Fixed: all-cohort total stays single-quarter gated
(`tot_n ≥ 4`); the 10+ core series is pooled over a **rolling 3-quarter window**,
gated on **pooled core n ≥ 4**. Chart note must label the 10+ band **"3-mo
pooled"**.

| 10+ core asking-cap quartile | quarters with a value |
|---|--:|
| Prior view (no core gate) | 42 (incl. 16 meaningless n=1–3) |
| Proper single-quarter gate (n≥4) | 26 |
| **Rolling-3-quarter pooled, n≥4 (shipped)** | **34** |

All-cohort total series: 52/52 present, unchanged. Remaining 18 core gaps are
**genuine** (11 quarters have zero 10+ priced listings even pooled; ~7 stay below
n=4) — documented, not fabricated. Full detail: `R68A_TASK3_COVERAGE.md`.

---

## Post-backfill leak fix (2026-06-05) — `..._synthetic_price_cap_leak_fix.sql`

**Audit finding:** synthesis was specified "price-less", and the view-rules
migration therefore left the cap/price *child* views (`asking_cap_quartiles_
active_m/q`, `asking_cap_by_term_m`, `available_cap_dot`, `on_market_snapshot_q`,
`available_market_size.avg_cap_*`) unguarded "because synthetic carry NULL
cap/price". **That was false in prod:** all 1,207 synthetic rows carried
`sold_price` and ~34 also carried `last_price`/`initial_price`/`cap_rate`. Result:
**84 synthetic (listing × quarter) rows with an in-band cap (0.04–0.12) reached
the active-listings layer across 38 quarters (2015-06 … 2025-09)**, contaminating
every cap/price chart that reads it — a violation of the R68-A hard constraint
"synthetic rows must never feed price-derived metrics."

**Fix (structural + hygiene):**
- `cm_dialysis_active_listings_m/q` NULL `last_cap_rate`/`last_price`/
  `initial_price` and force `had_price_change=false` for synthetic rows. Every
  cap/price child band/NULL-filters on these, so one guard at the source layer
  cleans all five children with no per-child edit.
- `cm_dialysis_available_market_size_q` excludes synthetic from `avg_cap_total`/
  `avg_cap_core_10plus` (NULL-safe `IS NOT DISTINCT FROM`, because organic rows
  carry `data_source=NULL`) while keeping them in `count_total`/`count_core_10plus`.
- Raw hygiene UPDATE NULLs the ask-price/cap columns on synthetic rows (durable:
  `trg_listing_cap_rate_snapshot()` no-ops when `last_price`+`initial_price` are
  NULL, so it never recomputes a cap). `sold_price`/`sold_date`/`off_market_date`/
  `sale_transaction_id` retained.

**Verification:**
- synthetic cap/price rows reaching the chart layer: **84 → 0**; raw contaminated
  rows: **34 → 0**; all 1,207 synthetic rows preserved (`sold_price` intact).
- INCLUDE counts byte-identical (e.g. 2025-12-31 `count_total` 95, `count_core`
  1 unchanged).
- `avg_cap_total` de-contaminated (now real asking caps only):
  2021-09-30 0.06335→0.06344, 2021-12-31 0.06133→0.06141, 2022-09-30
  0.06285→0.06277, 2025-09-30 0.07037→0.07014, **2025-12-31 0.06957→0.06831**
  (~13 bp).

---

## Constraints satisfied

- **Dry-run-first** for both backfills (synthesis + link) — plan JSONs produced
  and gated before `--commit` (see `scripts/round68a_*_plan.json`).
- **Synthetic never feeds price-derived metrics** — now enforced *structurally*
  at the active-listings source layer + the market-size cap aggregate, and
  asserted: 0 synthetic cap/price rows reach any chart (was 84). The batch-1
  volume count×avg counts TRANSACTIONS (`sales_transactions`), not listings — no
  interaction with synthetic listings.
- **Round-numbered commits**; per-chart before/after at Dec-2025 + earliest
  affected periods reported above.
