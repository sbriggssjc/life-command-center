# Round 68-A — Task 2 Synthesis Plan (verification gate)

> **Status: AWAITING VERIFICATION. Nothing applied to prod.** The bulk insert
> runs dry-run → `--commit` from Scott's workstation (service key), per the
> standing security pattern. Machine-readable copy:
> [`round68a_synthesis_plan.json`](./round68a_synthesis_plan.json).
> Source: live Dialysis_DB (`zqzrriwuavgrquhisnoa`), 2026-06-04.

## What ships

**1,608 synthetic, price-less listing rows**, one per unlinked sold deal, so the
active-universe / turnover / available-market charts stop showing the pre-2016
cliff (note D9) and the 2025 intake hole (note D8). Each row:

| column | value |
|---|---|
| `listing_date` | `sale_date − DOM_used` (imputed — see derivation) |
| `off_market_date`, `sold_date` | `sale_date` |
| `sold_price` | the real sale price (honest; charts guard it out) |
| `status` / `is_active` | `'sold'` / `false` |
| `sale_transaction_id` | the sale (the link that makes a second run idempotent) |
| `data_source` | `'synthetic_from_sale'` |
| `listing_date_source` | `'synth_sale_minus_median_dom'` |
| `initial_price`, `last_price`, all `*cap_rate*` | **NULL** (no real ask history) |

Price-less by construction → the listing cap-rate trigger no-ops (never writes
`cap_rate_history`), and every price/DOM/cap chart excludes them
(see [`R68A_VIEW_MATRIX.md`](./R68A_VIEW_MATRIX.md)).

## Derivation per evidence class

There is **no capture-evidence class** here — by definition an unlinked sale has
no listing record, so no page/CoStar marketing-start date exists to recover.
**Every synthetic listing_date is an imputation**, classed by which median feeds it:

- **`year_median`** — the sale-year median DOM from the *linked* cohort, used when
  that year has **n ≥ 15** linked pairs **and** its median is in **[45, 365] days**.
- **`pooled_median` (179 d)** — the pooled all-years median, used for thin years
  (2012–2014, 2016) and for 2026, whose own median (792 d, n=10) is a distorted
  outlier and is deliberately *not* trusted.

Linked cohort = sales joined to their real (non-synthetic) listing via
`sale_transaction_id`, `7 ≤ sale_date − listing_date ≤ 1095`. Medians are computed
in SQL (`v_round68a_dom_rule`), never hard-coded.

| sale yr | linked n | median DOM | DOM used |
|--:|--:|--:|--|
| 2014 | 7  | 99  | pooled 179 |
| 2015 | 19 | 129 | **year 129** |
| 2016 | 12 | 115 | pooled 179 |
| 2017 | 59 | 141 | **year 141** |
| 2018 | 88 | 171 | **year 171** |
| 2019 | 86 | 213 | **year 213** |
| 2020 | 89 | 170 | **year 170** |
| 2021 | 96 | 168 | **year 168** |
| 2022 | 84 | 190 | **year 190** |
| 2023 | 44 | 208 | **year 208** |
| 2024 | 38 | 216 | **year 216** |
| 2025 | 26 | 267 | **year 267** |
| 2026 | 10 | 792 | pooled 179 (outlier rejected) |

## Per-year synthetic counts

| synth listing yr | 2012 | 2013 | 2014 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| n | 29 | 49 | 98 | 116 | 105 | 133 | 184 | 136 | 183 | 156 | 125 | 90 | 125 | 79 |

(2026 = 0: 2026 sales impute to late-2025 listing dates.) Total **1,608**.

## 2025 recovery table (the assertion Scott added)

Task 2 now carries the 2025 hole. Combined (current + synthetic) added-to-market
rises from **20 → 99**, back into the historical band (near 2014's 122, 2022's 113):

| year | current listings | + synthetic | = combined |
|--:|--:|--:|--:|
| 2013 | 18 | 49 | 67 |
| 2014 | 24 | 98 | 122 |
| 2015 | 40 | 116 | 156 |
| 2016 | 56 | 105 | 161 |
| 2017 | 145 | 133 | 278 |
| 2018 | 185 | 184 | 369 |
| 2019 | 203 | 136 | 339 |
| 2020 | 155 | 183 | 338 |
| 2021 | 149 | 156 | 305 |
| 2022 | 113 | 125 | 238 |
| 2023 | 147 | 90 | 237 |
| 2024 | 139 | 125 | 264 |
| **2025** | **20** | **79** | **99** |
| 2026 | 144 | 0 | 144 |

Pre-2016 active universe (2012–2015) rises from <50 to 67/122/156/161 — D9's
cliff artifact is gone.

## Gap: full unlinked universe → synthesizable set

Of **3,058** sales with no linked listing, **1,608** are synthesized. The 1,450
filtered out, enumerated:

| stage | rows | dropped here | reason |
|---|--:|--:|---|
| u0 all unlinked sales | 3,058 | — | sales with no `available_listings.sale_transaction_id` |
| u1 has sale_date | 3,058 | 0 | (sale_date is NOT NULL constrained) |
| u2 sale_date ≥ 2013-01-01 | 2,678 | **380** | pre-2013 — predates the chart window (turnover from 2014, avail from 2013) |
| u3 sold_price > 0 | 2,308 | **370** | NULL/0 price — no anchor, nothing to represent |
| u4 not exclude_from_market_metrics | 1,608 | **700** | deliberately excluded (junk parties, non-arm's-length) — must stay out |
| u5 has property_id | 1,608 | 0 | (all u4 rows already carry a property) |

Reproduce:
```sql
WITH no_listing AS (
  SELECT s.* FROM sales_transactions s
  WHERE NOT EXISTS (SELECT 1 FROM available_listings al WHERE al.sale_transaction_id=s.sale_id))
SELECT
 (SELECT count(*) FROM no_listing) u0,
 (SELECT count(*) FROM no_listing WHERE sale_date>='2013-01-01') u2,
 (SELECT count(*) FROM no_listing WHERE sale_date>='2013-01-01' AND sold_price>0) u3,
 (SELECT count(*) FROM no_listing WHERE sale_date>='2013-01-01' AND sold_price>0
    AND NOT COALESCE(exclude_from_market_metrics,false)) u4;
```

## 20-row sample

See `sample_20_most_recent` in the JSON (most-recent sales; all 2026 → pooled-179
→ synth dates in Sep–Nov 2025, which is where most of the 2025 recovery comes from).

## Independent verification (Scott)

```sql
-- the candidate set the script will insert (one row per synthesizable sale):
SELECT count(*), count(*) FILTER (WHERE dom_class='year_median') year_med,
       count(*) FILTER (WHERE dom_class='pooled_median') pooled
FROM v_round68a_synth_candidates;                          -- expect 1608

SELECT extract(year from synth_listing_date)::int yr, count(*)
FROM v_round68a_synth_candidates GROUP BY 1 ORDER BY 1;    -- matches per-year table

SELECT * FROM v_round68a_dom_rule ORDER BY yr;             -- the computed medians
```

## Execution order (after the go)

1. Apply `20260605_cm_round68a_listing_provenance_columns.sql` (adds columns).
2. Apply `20260605_cm_round68a_synthesis_helper_views.sql` (the two helper views).
3. Apply `20260605_cm_round68a_synthetic_listing_views.sql` (chart include/exclude).
4. `node scripts/round68a-synthesize-listings.mjs` (dry-run, confirm plan JSON).
5. `node scripts/round68a-synthesize-listings.mjs --commit` (workstation, service key).
6. Spot-check: price/DOM charts byte-identical; turnover/available counts up.
