# Round 68-A — Task 2 Plan v2 (LINK + SYNTH)

> **Status: v2 — amended after Scott's v1 review; awaiting final spot-check.**
> Bulk writes run dry-run → `--commit` from Scott's workstation (service key).
> Machine-readable: [`round68a_synthesis_plan.json`](./round68a_synthesis_plan.json).
> Source: live Dialysis_DB (`zqzrriwuavgrquhisnoa`), 2026-06-04.

## v1 → v2: the LINK class

v1 review found a **double-count class** inside the 1,608 synth candidates: **401
unlinked sales whose property already has a REAL (non-synthetic) listing in the
3y-prior window.** Synthesizing those would put two marketing events (the real
listing + a synthetic one) on every INCLUDE chart. Receipt: **sale 266**
(2017-12-15, property 23350) — real listing 9507 (2017-08-22, 115d prior) exists,
already linked to sibling sale 265; sale 266 itself unlinked. v1 synthesized it;
v2 does not.

| class | n | action |
|---|--:|---|
| **LINK** | **401** | excluded from synthesis. Where an **unlinked** real prior listing exists (**212**, deduped to unique listing→nearest sale), **link it** (set `sale_transaction_id`). The other **189** are already covered by a sibling-linked listing → no synth, no link (no row touched). |
| **SYNTH** | **1,207** | proceeds as planned (price-less rows). |

401 + 1,207 = 1,608. Verified live: synth `count` = 1,207, link `count` = 212,
class overlap = 0.

## LINK plan (212 rows) — `v_round68a_link_candidates`

Each links a real unlinked listing to its **nearest prior sale within 3y**
(`listing_date < sale_date`, gap ≤ 1095d; skips listings already linked; one
listing → one sale). `listing_date` is the **real captured date** (beats
imputation); `off_market_date`/`sold_date` set to `sale_date` **only where NULL**;
`status='sold'`, `is_active=false`. Gap days: min 7 / median 173 / max 848.

Links by sale year: 2013:4 2015:5 2016:12 2017:10 2018:25 2019:28 2020:27 2021:40
2022:14 2023:19 2024:15 2025:12 2026:1. Sample (listing_id, sale_id, listing_date,
sale_date, gap_days) in the JSON `link_plan.sample_12`.

## SYNTH plan (1,207 rows)

**1,207 synthetic, price-less listing rows**, one per unlinked sold deal with **no**
real prior listing, so the active-universe / turnover / available-market charts
stop showing the pre-2016 cliff (D9) and the 2025 intake hole (D8). Each row:

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

Derivation classes (v2): **951 `year_median`** / **256 `pooled_median`** = 1,207.

## Per-year synthetic counts (v2)

| synth listing yr | 2012 | 2013 | 2014 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| n | 28 | 45 | 90 | 97 | 85 | 90 | 120 | 83 | 114 | 113 | 97 | 68 | 101 | 76 |

(2026 = 0: 2026 sales impute to late-2025 listing dates.) Total **1,207**.

## 2025 recovery table (v2 — the assertion Scott added)

`current_listings` already includes the 401 real LINK-class listings (counted by
their real `listing_date`), so the recovery is **current + reduced synth**.
Combined 2025 added-to-market rises **20 → 96**, in the historical band (near
2014's 114, 2022's 113):

| year | current listings | + synthetic (v2) | = combined |
|--:|--:|--:|--:|
| 2013 | 18 | 45 | 63 |
| 2014 | 24 | 90 | 114 |
| 2015 | 40 | 97 | 137 |
| 2016 | 56 | 85 | 141 |
| 2017 | 145 | 90 | 235 |
| 2018 | 185 | 120 | 305 |
| 2019 | 203 | 83 | 286 |
| 2020 | 155 | 114 | 269 |
| 2021 | 149 | 113 | 262 |
| 2022 | 113 | 97 | 210 |
| 2023 | 147 | 68 | 215 |
| 2024 | 139 | 101 | 240 |
| **2025** | **20** | **76** | **96** |
| 2026 | 144 | 0 | 144 |

Pre-2016 active universe (2013–2015) rises from <50 to 63/114/137 — D9's cliff is
gone. (LINK-class real listings add further fill, already in `current_listings`.)

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
| **v2 split** | | | |
| − LINK class (real prior listing in 3y) | 1,207 | **401** | property already has a real listing → link it, don't synthesize (212 linked / 189 covered) |
| = SYNTH class | **1,207** | | price-less synthetic rows |

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
-- SYNTH set (1,207; 951 year_median / 256 pooled) — what the synth script inserts:
SELECT count(*), count(*) FILTER (WHERE dom_class='year_median') year_med,
       count(*) FILTER (WHERE dom_class='pooled_median') pooled
FROM v_round68a_synth_candidates;                          -- expect 1207

-- LINK set (212) — what the link script updates:
SELECT count(*), count(DISTINCT listing_id) FROM v_round68a_link_candidates;  -- 212/212

-- classes must not overlap:
SELECT count(*) FROM v_round68a_synth_candidates s
 WHERE EXISTS (SELECT 1 FROM v_round68a_link_candidates l WHERE l.sale_id=s.sale_id);  -- 0

SELECT extract(year from synth_listing_date)::int yr, count(*)
FROM v_round68a_synth_candidates GROUP BY 1 ORDER BY 1;    -- matches per-year table
SELECT * FROM v_round68a_dom_rule ORDER BY yr;             -- the computed medians
```

## Execution order (after the go)

Already applied (gate-enablement): provenance columns, helper views (v1+v2),
the listing_date-correction RPC. Held / remaining:

1. Apply `20260605_cm_round68a_synthetic_listing_views.sql` (chart include/exclude;
   output-neutral until rows land).
2. `node scripts/round68a-link-listings.mjs` then `--commit` (212 links; real
   dates beat imputed).
3. `node scripts/round68a-synthesize-listings.mjs` then `--commit` (1,207 rows).
4. Spot-check: price/DOM/cap charts byte-identical; turnover / available-market /
   active-listings counts up; 2025 added-to-market 20 → 96.
5. Task 3: re-test the 10+ gated views; apply rolling-3-month pooling to the **10+
   series only** (all-cohort stays single-month gated), label "3-mo pooled"; ship
   the before/after coverage table.
