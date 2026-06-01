# Capital Markets — Data-Only Chart Audit (2026-06-01)

Purpose: for every chart, a plain-English summary of **what data is displayed** and the
**formula/source** behind it, so you can eyeball-confirm we're using the right data. For
lease-term-remaining cohorts, government credit tiers, and Northmarq-specific charts —
the places we've seen display problems — it also reports **how many sales feed each
average**, to show where the database/collection gaps are.

All figures are read-only snapshots of the live views as of 2026-06-01 (report quarter
= 2026-03-31). Universe unless noted: `sales_transactions` with `sale_date NOT NULL`,
`sold_price > 0`, not `exclude_from_market_metrics`, and (dia) `transaction_type IN
(NULL,'Investment','Resale')`. Most series are TTM (trailing-12-month) monthly windows.
Cap rates are banded 4–12% and `cap_rate_quality='implausible_unverified'` is nulled.

---

## Cross-cutting findings — where to focus collection effort

These themes appear in BOTH verticals and are the highest-leverage fixes:

1. **Lease-term-remaining capture is the #1 gap.** In dialysis only **~26% of market
   sales (691 of 2,703)** have both a usable cap rate AND a resolvable firm term; the
   **≥12yr cohort collapses to 0–4 deals/yr after 2020**. In government the two
   term charts use *different* resolvers (59.8% vs ~90% coverage) so they disagree, and
   recent long-term cohorts fall below their sample gates. Capturing firm lease term
   remaining at sale — especially on long-WALT deals — is the single biggest lever to
   make the term charts robust.

2. **Northmarq sales are thin and getting thinner.** Dia has **189 usable-cap NM sales
   total** (5–20/yr, often right at the n≥3 gate); gov has **123 NM sales** with only
   **1 in 2023, 5 in 2024, 3 in 2025, 0 in 2026**. NM buyer attributes are ~half empty
   (gov NM: 63/123 have buyer_state, 57/123 have buyer_type). The NM-vs-Market and NM
   distribution charts are heavily interpolated or blank in recent years. Priority:
   tag + price recent NM closings and capture NM buyer_state/buyer_type.

3. **Gov municipal/state credit tiers are effectively missing (your flag, confirmed).**
   Cap-eligible gov sales by tier: **federal 2,088 / unclassified 748 / state 40 /
   municipal 4.** `government_type` is populated on only **1,127 of 2,880** sales and the
   `agency` fallback regex is federal-biased, so 748 classifiable-looking sales fall to
   "unclassified" and are dropped. The data to classify likely exists in `agency` (2,179
   populated) — the classifier just isn't catching state/municipal.

4. **Cap-rate field choice is inconsistent.** Dia: most charts use
   `COALESCE(calculated, stated, cap_rate)` but Valuation Index, Core Cap Dot Plot, and
   NM Notable Transactions use raw `cap_rate` first — **1,003 sold rows differ** between
   the two orders, so the same sale can show different cap rates on different charts.
   Standardize one order everywhere.

5. **`exclude_from_market_metrics` is applied unevenly.** Gov volume / count / avg-deal /
   PSF charts skip it, while cap-rate and pie charts apply it — so the volume and
   cap-rate panels are computed on different populations.

6. **Listing-level inventory rests on synthetic dates.** Dia backdates a 196-day start
   for the ~1,117 of 3,297 listings missing `listing_date`; gov assumes an 18-month
   listing life when `off_market_date` is null. Inventory/turnover levels carry these
   modeling assumptions.

7. **Top Buyers/Sellers are labeled `ttm_*` but contain all-time totals** (both verticals)
   — a labeling fix, not a data gap.

---

# Dialysis — Chart Data Audit

Universe: `sales_transactions`, genuine investment sales (no portfolio/recap noise). Most
series are TTM monthly via the shared master view `cm_dialysis_market_quarterly_master_m`.

> ⚠ **Global concern — COALESCE order split (1,003 affected rows).** Master + all sold-cap
> charts use `COALESCE(calculated_cap_rate, stated_cap_rate, cap_rate)`; but Valuation
> Index, Core Cap Dot Plot, and NM Notable Transactions use raw `cap_rate` first. 1,003
> sold rows have a raw value that differs from the calculated one.

### Valuation Index → `cm_dialysis_valuation_index_m`
- **Data:** TTM monthly index of implied asset value, rebased to 100 at first qualifying month (~2010).
- **Formula:** `avg(rent_at_sale) / avg(cap_rate)` per TTM window ÷ base × 100. Needs `rent_at_sale>0` + usable cap. Base gate TTM n≥30. COALESCE raw-first (divergent).
- ⚠ Ratio of independent averages (not per-deal, not weighted); raw-first COALESCE inconsistent with the cap-rate trend charts.

### Volume TTM → `cm_dialysis_volume_ttm_m`
- **Data:** TTM total $ volume + discrete quarterly volume/count. Monthly.
- **Formula:** `sum(sold_price)` over TTM. No cap filter, no gate.

### YoY Volume Change → `cm_dialysis_yoy_change_m`
- **Data:** % change in TTM volume vs 12 months prior.
- **Formula:** `(ttm_volume − lag12)/lag12`; null when year-ago ≤ 0.

### Cap Rate TTM Avg → `cm_dialysis_cap_ttm_m`
- **Data:** TTM **volume-weighted** average cap rate. Monthly.
- **Formula:** `sum(price×cap)/sum(price)`, banded 4–12%, gate n≥4. COALESCE calculated-first.

### NM vs Market Cap → `cm_dialysis_nm_vs_market_m` **[NM]**
- **Data:** Two TTM lines — NM-brokered vs brokered non-NM market — 9-month centered smoothing.
- **Formula:** Market = `is_northmarq=false AND brokered`. Unweighted avg of banded caps. Gate nm_n≥3 & mkt_n≥3, then ±4-month smooth. COALESCE calculated-first.
- ⚠ n≥3 + 9-month smoother on a thin NM series → heavily interpolated in lean years; NM avg is unweighted vs volume-weighted elsewhere.

**Sample sizes** ("usable cap" = banded 4–12% after implausible removal):

| Year | NM sales | NM w/ usable cap | Market w/ usable cap |
|---|---|---|---|
| 2017 | 10 | 7 | 54 |
| 2018 | 19 | 15 | 74 |
| 2019 | 22 | 19 | 63 |
| 2020 | 32 | 20 | 65 |
| 2021 | 30 | 18 | 56 |
| 2022 | 31 | 16 | 37 |
| 2023 | 14 | 11 | 36 |
| 2024 | 11 | 11 | 23 |
| 2025 | 14 | 14 | 44 |
| 2026 YTD | 5 | 5 | 19 |

Totals: **360 NM rows / 262 in market scope / 189 with usable cap.** NM usable-cap counts (7–20/yr) sit at/just above the n≥3 gate — starved in 2017, 2023, 2024, 2026.

### Transaction Count TTM → `cm_dialysis_count_ttm_m`
- **Data:** Count of qualifying investment sales in the TTM window. **Formula:** master `count(*)`, no cap filter/gate.

### Avg Deal Size → `cm_dialysis_avg_deal_m`
- **Data:** TTM average `sold_price`. **Formula:** `avg(sold_price)` trimmed $100K–$200M, no min-n.

### Cap Rate Top/Bottom Quartile → `cm_dialysis_cap_quartile_m`
- **Data:** TTM 25/50/75th percentile cap. **Formula:** percentiles over banded TTM caps, gate n≥4, calculated-first.

### Buyer Class % by Year → `cm_dialysis_buyer_share_y`
- **Data:** Annual share of volume by buyer class (private/REIT/institutional), 2010+.
- **Formula:** per-class volume by year from `cm_dialysis_market_quarterly`; class via regex on buyer_type then buyer_name.
- ⚠ `cross_border` hard-coded 0; user_owner folded into private; the three shares can sum <100% silently.

### DOM & % of Ask → `cm_dialysis_dom_pct_ask_m`
- **Data:** TTM avg/median DOM and sale-to-last-ask ratio for closed listings.
- **Formula:** `available_listings`; DOM = sold−listing (0–730d); %ask = sold/last trimmed **0.5–<1.0**.
- ⚠ The `<1.0` cap structurally excludes at/above-ask closings → %ask is mechanically biased below 100%.

### Seller Sentiment → `cm_dialysis_seller_sentiment_m`
- **Data:** TTM share of sold listings with a price change (all vs ≥8yr term) + avg last-ask cap.
- **Formula:** sales↔listings via `sale_transaction_id`; `had_price_change=initial<>last`. No min-n on the %s.
- ⚠ Long-term split depends on sparse listing-link + lease-term resolution.

### Bid-Ask Spread → `cm_dialysis_bid_ask_spread_m`
- **Data:** TTM avg spread (achieved − last-ask cap), % price change, last-ask cap range.
- **Formula:** `available_listings` sold in window; spread = `cap_rate − last_cap_rate`; gate n≥5; banded 4–12%. *(Signed spread — see R66c bid-ask note in the design audit.)*

### Cost of Capital → `cm_dialysis_cost_of_capital_m`
- **Data:** TTM avg cap + ≥10yr-term cap vs 10Y Treasury + loan-constant band.
- **Formula:** master + macro_rates + loan_constant; cap gated n≥4.

### Cash & Leveraged Returns → `cm_dialysis_returns_indexes_m`
- **Data:** TTM cash return (= avg cap) + modeled leveraged return at 50% LTV.
- **Formula:** `leveraged = (avg_cap − loan_constant_mid×0.5)/0.5`; gate n≥4.
- ⚠ Fixed 50% LTV + loan-constant midpoint — modeled, not observed financing.

### Market Share Pie TTM → `cm_dialysis_market_share_pie`
- **Data:** TTM volume share by listing broker (top 10 + Other), NM always its own slice.
- **Formula:** bucket = Northmarq / initcap(listing_broker) / Unknown; share = bucket vol / total.
- ⚠ Raw broker string (no entity canonicalization) fragments non-NM slices; blank brokers → large "Unknown".

### Top Buyers / Top Sellers → `cm_dialysis_top_buyers` / `_top_sellers`
- **Data:** Top 25 by deal count + volume — **all history, not TTM** despite `ttm_*` column names.
- **Formula:** entity-keyed via `cm_canonical_entity_key()`; ranked count then volume.
- ⚠ `ttm_*` misnomer (lifetime totals).

### Rent PSF Box → `cm_dialysis_rent_box_q`
- **Data:** Quarterly box-plot (min/Q1/median/Q3/max) of lease rent PSF by lease-start quarter.
- **Formula:** `leases`, rent_per_sf trimmed $5–100, gate n≥4/quarter.

### Rent & Price PSF → `cm_dialysis_rent_price_psf_q`
- **Data:** Quarterly TTM avg rent PSF and price PSF for sold properties.
- **Formula:** sales JOIN properties (`building_size>0`); rent trim 5–100, price trim 50–1500; gate n≥5.

### Rent & Price per Chair → `cm_dialysis_rent_price_per_chair_q`
- **Data:** Quarterly TTM avg rent-per-chair and price-per-chair.
- **Formula:** sales JOIN properties (`total_chairs>0`); rent/chair $1K–30K, price/chair $10K–500K; gate n≥5.
- ⚠ Needs `total_chairs`, sparsely captured → thinnest unit-econ series.

### NM Notable Transactions → `cm_dialysis_notable_transactions` **[NM]**
- **Data:** Price-ranked list of NM sales, deduped to one row per property.
- **Formula:** `is_northmarq=true` JOIN properties; dedup on property_id (fallback address). COALESCE raw-first.
- ⚠ No `transaction_type` filter here (unlike every market metric) — a recap/portfolio NM deal can surface. With ≤20 usable-cap NM/yr, the set is shallow outside 2018–2022.

### Industry Participants → `cm_dialysis_industry_participants`
- **Data:** Top-10 operators by **clinic count** + "Independent & Other" catch-all, with share. Snapshot.
- **Formula:** `medicare_clinics` grouped by `chain_organization`; independent/other/unknown/blank folded into one remainder.
- ⚠ CMS facility-count universe, not transaction data — share is by clinic count.

### Asking Cap Quartiles (Active) → `cm_dialysis_asking_cap_quartiles_active_m` **[TERM]**
- **Data:** Monthly Q1/Q3 asking cap for active listings, all vs core (≥10yr firm term).
- **Formula:** `cm_dialysis_active_listings_m` → `available_listings`; active-lease-only firm term; gate n≥4 banded.
- **Sample sizes** — latest anchor (38 usable rows): **≥12yr 0 · 8–12yr 2 · 6–8yr 6 · ≤5yr 26.** Core ≥10yr essentially empty; active market is short-term-remaining dominated.

### Available Market Size → `cm_dialysis_available_market_size_q` **[TERM]**
- **Data:** Quarterly active-listing count (total + core ≥10yr) + avg asking cap.
- **Formula:** `cm_dialysis_active_listings_q`; total gate n≥5; core avg-cap gate n≥5.
- **Sample sizes** — latest quarter: **89 active listings, 47 usable for term/cap.** Core ≥10yr a small minority.

### DOM & Price-Change (Active) → `cm_dialysis_dom_price_change_active_m`
- **Data:** Monthly avg DOM + % with price change (all vs core), 3-month smoothed, from 2018.
- **Formula:** `cm_dialysis_active_listings_m`; DOM 0–730; gate n≥8, then ±1-month smoothing.

### Core Cap Rate Dot Plot → `cm_dialysis_core_cap_dot_q`
- **Data:** Per-sale scatter of cap vs date for core (≥8yr term) closed sales, 2001+.
- **Formula:** `cm_dialysis_core_cap_rate_dots`; **different firm-term logic** (any lease + superseded check, ≤15yr original, most-recent start). COALESCE raw-first.
- ⚠ Term resolution differs from `sold_cap_by_term_dot` → same sale, different "term remaining." Raw-first COALESCE.

### Available Cap Rate Dot Plot → `cm_dialysis_available_cap_dot`
- **Data:** Per-listing scatter asking cap vs firm-term for latest quarter's active listings (~47 dots).
- **Formula:** `cm_dialysis_active_listings_q` latest period; cap 4–12%, term 0–30yr.

### Inventory Backlog → `cm_dialysis_inventory_backlog_m`
- **Data:** Monthly active count, TTM additions, TTM sold, months-of-supply, from 2014.
- **Formula:** effective-window heuristic `eff_start = COALESCE(listing_date, end−196d)`.
- ⚠ ~1,117 of 3,297 listings lack `listing_date` → 196-day synthetic start; active level carries that assumption.

### Market Turnover → `cm_dialysis_market_turnover_m`
- **Data:** Monthly turnover = TTM sales / (active + TTM sales) + months-of-supply, from 2014.
- **Formula:** same effective-window heuristic + TTM sales count. Same synthetic-start caveat.

### Sold Cap by Term → `cm_dialysis_sold_cap_by_term_dot` **[TERM]**
- **Data:** Four TTM cap lines by firm-term cohort (≥12 / 8–12 / 6–8 / ≤5yr), 9-month smoothed.
- **Formula:** corrected active-lease firm term (is_active, excl superseded/expired/terminated); banded, calculated-first; per-cohort gate n≥3, then ±4-month smoothing.

**Sample sizes** — sales with resolvable active-lease firm term AND usable cap:

| Year | Term+cap | Cap-ok total | ≥12yr | 8–12yr | 6–8yr | ≤5yr |
|---|---|---|---|---|---|---|
| 2015 | 31 | 85 | 17 | 6 | 2 | 0 |
| 2016 | 39 | 93 | 21 | 12 | 3 | 3 |
| 2017 | 53 | 107 | 29 | 10 | 5 | 8 |
| 2018 | 54 | 149 | 20 | 17 | 4 | 10 |
| 2019 | 71 | 146 | 14 | 28 | 18 | 10 |
| 2020 | 81 | 143 | 18 | 33 | 15 | 10 |
| 2021 | 78 | 140 | 5 | 29 | 12 | 14 |
| 2022 | 66 | 97 | 1 | 25 | 20 | 14 |
| 2023 | 55 | 88 | 8 | 8 | 13 | 19 |
| 2024 | 32 | 65 | 3 | 5 | 5 | 10 |
| 2025 | 63 | 103 | 4 | 11 | 9 | 26 |
| 2026 YTD | 10 | 26 | 0 | 0 | 3 | 5 |

Overall: **2,703 market sales / 1,466 usable cap / 1,003 resolvable term / 691 with BOTH** (~26%).
- ⚠ ≥12yr cohort collapses after 2020 (firm term measured vs *currently-active* leases, so old long-lease sales decay to short term). Nulled in 2026; 2022 rests on 1 deal. 9-month smoother hides the thinness.

### Asking Cap by Term → `cm_dialysis_asking_cap_by_term_m` **[TERM]**
- **Data:** TTM asking cap by term cohort for active listings, 5-month smoothed.
- **Formula:** `cm_dialysis_active_listings_m`; per-cohort gate n≥3, ±2-month smoothing; active-lease firm term.
- **Sample sizes** — latest anchor (38 cap+term rows): **≥12yr 0 · 8–12yr 2 · 6–8yr 6 · ≤5yr 26.** Only ≤5yr clears the gate.

## Dialysis — where the data gaps are
1. **COALESCE split** (1,003 rows) — Valuation Index / Core Dot / NM Notable use raw-cap-first vs calculated-first elsewhere. Standardize.
2. **Long-term cohorts starved** — sold ≥12yr drops to 0–4/yr from 2021; active core-10+ has 0 usable. Term capture on long-WALT deals is the top need.
3. **Only ~26% of sales feed term charts** (691/2,703 with cap+term). Active-lease logic is correct but decays old long leases out of the long buckets.
4. **NM thin** — 189 usable-cap NM sales; 5–20/yr, often at the n≥3 gate.
5. **Unit econ depends on sparse fields** — `total_chairs`, `building_size`; inventory uses a 196-day synthetic start for ~1,100 listings.
6. **Filter biases** — %ask capped `<1.0` (low bias); buyer-share hard-codes cross-border 0; NM Notable skips the transaction_type filter.

---

# Government — Chart Data Audit

Hub: `cm_gov_market_quarterly_master_m` (+ matview `…_m_mat`), monthly TTM anchors. Cap band
4–12%; implausible nulled. `cm_last_completed_quarter_end()` = 2026-03-31.

### Valuation Index → `cm_gov_valuation_index_m`
- **Data:** TTM index = avg NOI/SF ÷ avg cap, + rebased-100 + YoY%.
- **Formula:** `sf_leased>=500`; NOI/SF = `COALESCE(noi_psf, noi/sf_leased)` clamp 1–150; cap via `sold_cap_rate` clamp 4–12%; simple averages; no min-n gate.
- ⚠ No sample floor; ratio of independent averages.

### Volume TTM → `cm_gov_volume_ttm_m`
- **Data:** TTM $ volume + quarterly. **Formula:** `sum(sold_price)` over TTM — **does NOT apply `exclude_from_market_metrics`** (unlike cap/pie charts).

### YoY Volume Change → `cm_gov_yoy_change_m`
- **Data/Formula:** `(ttm_volume − lag12)/lag12`.

### Cap Rate TTM Avg → `cm_gov_cap_ttm_m`
- **Data:** TTM **volume-weighted** avg cap. **Formula:** `sum(price·cap)/sum(price)`, gate n≥4 (LATERAL with transaction_type filter); cap = `COALESCE(cap_rate_history event, sold, last, initial)`.
- ⚠ Gate filter (transaction_type Investment/Resale) differs from the value's aggregation filter — gate and value computed on slightly different populations.

### NM vs Market Cap → `cm_gov_nm_vs_market_m` **[NM]**
- **Data:** TTM NM vs brokered-market cap, 9-point smoothed.
- **Formula:** NM=`is_northmarq`; market=`NOT is_northmarq AND brokered`; simple avg `sold_cap_rate` in band; NM gate n≥3 then ±4 smooth.

**Sample sizes:**

| Year | NM sales | NM usable cap | Market brokered cap |
|---|---|---|---|
| 2018 | 9 | 5 | 43 |
| 2019 | 8 | 4 | 47 |
| 2020 | 12 | 7 | 58 |
| 2021 | 16 | 14 | 62 |
| 2022 | 9 | 6 | 44 |
| 2023 | **1** | **1** | 31 |
| 2024 | 5 | 3 | 13 |
| 2025 | 3 | **1** | 10 |
| 2026 | 0 | 0 | 9 |

Totals: **123 NM sales / 118 usable cap.**
- ⚠ NM line starved 2023→present (1, 5, 3, 0); with the n≥3 gate it goes mostly null after early 2023. Effectively non-current.

### Transaction Count TTM → `cm_gov_count_ttm_m`
- **Data/Formula:** TTM count of all `sold_price>0` sales (no cap/exclude filter).

### Avg Deal Size → `cm_gov_avg_deal_m`
- **Data/Formula:** `avg(sold_price)` over TTM, clamp $100K–$200M; no exclude/cap/n-gate.

### Cap Rate Top/Bottom Quartile → `cm_gov_cap_quartile_m`
- **Data:** TTM 25/50/75th percentile cap. **Formula:** master percentiles surfaced at master `ttm_count>=10`, re-gated here band n≥4.
- ⚠ Double, mismatched gating (master counts all sales; view's LATERAL uses a filtered count).

### Cap Rate by Credit Tier → `cm_gov_cap_by_credit_q` **[CREDIT]**
- **Data:** Quarterly TTM avg cap split federal / state / municipal.
- **Formula:** tier = `government_type` ILIKE match, else an `agency` regex ladder (federal-heavy); per-quarter avg `sold_cap_rate`; gates federal n≥3, state n≥2, municipal n≥2.

**Sample sizes (cap-eligible gov sales by tier):**

| Tier | n total | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|---|
| federal | 2,088 | 127 | 75 | 64 | 34 | 41 |
| **unclassified** | **748** | 77 | 71 | 33 | 17 | 21 |
| **state** | **40** | 7 | 7 | 1 | 3 | 0 |
| **municipal** | **4** | 0 | 0 | 0 | 0 | 0 |

Classifier input: only **1,127 of 2,880** eligible sales have `government_type`; 2,179 have `agency`.
- ⚠ **Confirmed — your flag.** Municipal (4 ever, 0 since 2021) never clears the gate; state clears sporadically. The agency regex is federal-biased, so 748 sales fall to **unclassified and drop off the chart**. Fix: populate `government_type` + broaden state/municipal agency patterns.

### Cap Rate by Remaining Lease Term → `cm_gov_cap_by_term_m` **[TERM]**
- **Data:** TTM avg cap by firm-term-remaining cohort (10+, 6–10, 5–10, <5, outside).
- **Formula:** firm-remaining resolver ladder: (1) gsa_leases.termination_date−sale; (2) leases.firm_term−elapsed; (3) sale's own firm_term_years; (4) lease_expiration−sale. Cohort gate n≥5.

**Sample sizes (per year; pooled into TTM):**

| Year | capable | resolvable | 10+ | 5–10 | <5 | outside |
|---|---|---|---|---|---|---|
| 2016 | 73 | 69 | 36 | 19 | 11 | 3 |
| 2017 | 83 | 73 | 28 | 23 | 17 | 5 |
| 2018 | 82 | 74 | 23 | 26 | 17 | 8 |
| 2019 | 82 | 72 | 23 | 32 | 14 | 3 |
| 2020 | 106 | 90 | 22 | 32 | 24 | 12 |
| 2021 | 109 | 94 | 27 | 35 | 27 | 5 |
| 2022 | 85 | 77 | 13 | 31 | 21 | 12 |
| 2023 | 50 | 49 | 12 | 16 | 13 | 8 |
| 2024 | 28 | 23 | 6 | 10 | 7 | 0 |
| 2025 | 29 | 21 | 3 | 3 | 13 | 2 |
| 2026 | 16 | 9 | 2 | 0 | 6 | 1 |

Resolvability high (~88–95%) via the fallback ladder.
- ⚠ 10+ and outside cohorts dip below n≥5 in 2024–2026 (2025 10+=3); 5–10 and 6–10 buckets overlap by design.

### Buyer Class % by Year → `cm_gov_buyer_share_y`
- **Data:** Annual % of $ volume by buyer class. **Formula:** sums of per-class TTM volumes by year from `cm_gov_market_quarterly`.
- ⚠ Summing overlapping TTM windows by calendar year double-counts — not discrete-year volume.

### DOM & % of Ask → `cm_gov_dom_pct_ask_m`
- **Data/Formula:** TTM `avg_dom` (0–1095d) + `pct_of_ask` (sold/last, 0.5–1.5), each gated count≥5.

### Seller Sentiment → `cm_gov_seller_sentiment_m`
- **Data:** TTM % price-changed (all vs ≥8yr) + avg last-ask cap. **Formula:** `had_price_change` + last_cap_rate in band; lease-derived firm term; no min-n beyond NULLIF.

### Bid-Ask Spread → `cm_gov_bid_ask_spread_m`
- **Data/Formula:** TTM spread + % price change + last-ask cap min/avg/max/achieved; each gated count≥5.

### Cost of Capital → `cm_gov_cost_of_capital_m`
- **Data/Formula:** TTM 10Y Treasury (DGS10) + avg cap + 10+yr cap + loan constants; cap gated n≥4.

### Cash & Leveraged Returns → `cm_gov_returns_indexes_m`
- **Data/Formula:** cash = avg cap; leveraged = `(cap − mid_loan_constant·0.5)/0.5`; gate n≥4. ⚠ hard-coded 50% LTV.

### Fed Funds vs 10Y Treasury → `cm_gov_macro_rates_q`
- **Data/Formula:** Quarterly avg DGS10/FEDFUNDS/MORTGAGE30US/CPI/UNRATE from `economic_indicators`. Macro only.

### Net Lease Spread → `cm_gov_net_lease_spread_m`
- **Data:** TTM cap-minus-10Y spread for market / NM / non-NM.
- ⚠ **No n-gate** — `nm_avg_cap_ttm` can be built on 1–2 NM sales recently.

### CPI vs Renewal CAGR → `cm_gov_cpi_vs_renewal_cagr_m`
- **Data/Formula:** CPI YoY (CPIAUCSL) vs GSA renewal-rent 5yr CAGR (`gsa_lease_events` renewed). *(Data gap: renewals start 2013 → CAGR can't begin before ~2018.)*

### Case for Renewal → `cm_gov_case_for_renewal_y`
- **Data/Formula:** Annual new-award count/avg rent-SF/total LSF from `gsa_lease_events` new_award; sentinel dates excluded.

### Lease Renewal Rate → `cm_gov_lease_renewal_rate_m`
- **Data/Formula:** TTM counts of commencements/renewals/succeeding/expirations/terminations; **excludes >1000-row sentinel batches**.
- ⚠ The >1000-row filter could drop a legitimately large single-day batch.

### Lease Termination Rate → `cm_gov_lease_termination_rate_m`
- **Data/Formula:** active-lease count, TTM terminations, leases outside firm term, from `gsa_leases`.

### Renewal Rent Growth → `cm_gov_renewal_rent_growth_m`
- **Data/Formula:** quarterly+TTM avg renewal rent/SF, quartiles, 5yr CAGR (lag 60mo); sentinel-filtered.

### Rent by Year Built → `cm_gov_rent_by_year_built`
- **Data/Formula:** avg/median/quartile rent/SF by vintage from pre-aggregated `rent_survey` (`year_built`), **33 rows**.
- ⚠ Snapshot table — build cadence/staleness not visible from the view.

### Rent Heat Map → `cm_gov_rent_heat_map`
- **Data/Formula:** avg/median rent/SF by state from `rent_survey` (`state`), **51 rows**. Quartile-PSF = quartile rent ÷ avg RBA (approximate).

### Rent & Price PSF → `cm_gov_rent_price_psf_q`
- **Data/Formula:** TTM (4-qtr) smoothed gross rent/SF (5–200) + price/SF (50–2000); `sf_leased>=500`; no exclude/n-gate.

### Market Share Pie TTM → `cm_gov_market_share_pie`
- **Data/Formula:** TTM broker volume share (top 10 + Other), NM flagged; bucket = raw `listing_broker`.
- ⚠ No entity canonicalization (unlike Top Buyers/Sellers) — name variants split share.

### Top Buyers / Top Sellers → `cm_gov_top_buyers` / `_top_sellers`
- **Data/Formula:** Top 25 by count then volume, canonicalized entity — **all-time despite `ttm_*` names.**

### Sources of Capital → `cm_gov_sources_capital`
- **Data/Formula:** buyer volume by `buyer_state`, 15yr window, ranked. ⚠ depends on sparse `buyer_state` (large "(unknown)").

### Leased Inventory by State → `cm_gov_leased_inventory_by_state`
- **Data/Formula:** current GSA leased count/RSF/rent/rent-SF by state (`lease_expiration>now()`, not terminated).

### Lease Structures → `cm_gov_lease_structures`
- **Data/Formula:** new-award term-structure mix (total/firm bins) for qtr/TTM/5yr; sentinel-excluded.

### Leasing Summary → `cm_gov_leasing_summary`
- **Data/Formula:** new-lease count/monthly-avg/LSF/rent/rent-SF for qtr/TTM/5yr.

### NM Buyer Distribution → `cm_nm_buyer_distribution_q` **[NM]**
- **Data/Formula:** TTM NM $ volume by `buyer_state`, ranked.
- **Sample sizes:** 123 NM sales; **only 63 have buyer_state.** ⚠ ~49% lack buyer_state → "Unknown" dominates; recent quarters near-zero NM.

### NM Track Record by Buyer Type → `cm_nm_track_record_by_buyer_type_q` **[NM]**
- **Data/Formula:** TTM NM count/volume/avg cap by `buyer_type`; cap = COALESCE(sold,last,initial) **ungated (no band)**.
- **Sample sizes:** 123 NM sales; **only 57 have buyer_type.** ⚠ uncapped cap can leak a bad initial value.

### Core Cap Rate Dot Plot → `cm_gov_core_cap_dot_q`
- **Data/Formula:** per-sale scatter cap vs firm-term (firm≥6yr), NM flagged, 2001+; cap = COALESCE(history,sold,last,initial); firm-term from `leases`.
- **Sample sizes:** **373 dots, 20 Northmarq.** ⚠ lease-only firm term drops sales without a lease match.

### Available Cap Rate Dot Plot → `cm_gov_available_cap_dot`
- **Data/Formula:** per-listing scatter asking/current cap vs firm-term, today's active listings.
- ⚠ 350 active → 182 excluded, 106 with firm_term → **~53 survive.**

### Inventory Backlog → `cm_gov_inventory_backlog_m`
- **Data/Formula:** TTM active inventory/added/sold/months-of-supply from synthetic windows (`available_listings` off-market or listing+18mo) UNION sold-deal on-market spans.
- ⚠ 18-month default listing life when off_market is null — synthetic; can overstate inventory.

### Market Turnover → `cm_gov_market_turnover_m`
- **Data/Formula:** same window construction; TTM sales / active-universe turnover + months-of-supply. Same 18-month caveat.

### Sold Cap by Term → `cm_gov_sold_cap_by_term_dot` **[TERM]**
- **Data:** 7-quarter centered smoothed TTM cap by cohort (10+, 5–10, <5, outside).
- **Formula:** reads master view's cohort caps, which resolve firm term from **`leases` ONLY** (no gsa/sale fallback) — *different resolver than `cm_gov_cap_by_term_m`*; re-clamped, ±3 smoothing.
- **Sample sizes:** 1,791 cap-eligible sold deals, **only 1,071 (59.8%) resolve a lease firm term; just 71 since 2023.**
- ⚠ Disagrees with "Cap Rate by Remaining Lease Term" (which resolves ~88–95%) — same family, ~40% different sample.

### Available by Firm Term → `cm_gov_available_by_term_summary` **[TERM]**
- **Data/Formula:** today's active-listing count/avg price/avg-median-quartile cap by bucket (Sub-5 / 5–8 / 8–12 / 12+).
- **Sample sizes:** Sub-5 **27** · 5–8 **12** · 8–12 **7** · 12+ **7**. ⚠ long buckets have 7 listings each — quartiles barely meaningful.

## Government — where the data gaps are
1. **Municipal/state credit missing** — federal 2,088 / unclassified 748 / state 40 / municipal 4; municipal 0 since 2021. `government_type` on only 1,127/2,880; agency regex federal-biased → 748 dropped as unclassified. Populate government_type + broaden patterns.
2. **NM starved 2023→present** (1/5/3/0 sales/yr) — NM cap + spread go null/flat recently.
3. **NM buyer attributes half-empty** — buyer_state 63/123, buyer_type 57/123.
4. **Two by-term charts disagree** — Sold Cap by Term (lease-only, 59.8%, 71 since 2023) vs Cap Rate by Remaining Lease Term (fallback ladder, ~90%). Align the resolver.
5. **Available pipeline thin** — 350 active → ~53 after filters; 8–12 & 12+ buckets only 7 listings each.
6. **Consistency gaps** — volume/count/avg-deal/PSF skip `exclude_from_market_metrics`; Top Buyers/Sellers all-time despite `ttm_*` names; inventory uses an 18-month synthetic listing life.

---

# Alignment vs Master Excel + Published PDF (added 2026-06-01)

Reviewed our live views against the authoritative references: **Dialysis Comp Work
MASTER.xlsx** (`Charts` sheet), **Copy Government Master Document.xlsx** (`All Charts` /
`SSA Charts`), **The Dialysis Market Filter (4Q-2025).pdf**, and **State of the
Government-Leased Market (2024-Q2).pdf**.

## Headline: durations align — the gap is DATA CAPTURE, not windowing

Both masters and our views are true **trailing-12-month (TTM)** windows anchored on the
sale date. (The dia master adds 90- and 180-day cap windows for two exhibits; gov is
TTM-only.) One dia-master quirk: its *count* series and *average* series are windowed one
month apart (B89..B101 vs B88..B100) — a spreadsheet artifact; our single-anchor views are
actually cleaner, so **don't "fix" ours to match the spreadsheet**.

The real divergence is the **capture model.** The masters HAND-ENTER the hard fields on
every comp and reach near-total coverage; we DERIVE the same fields and lose coverage:

| Field | Master (hand-entered) | Our DB (derived) |
|---|---|---|
| **Lease term remaining** (frozen at sale) | dia `TERM` 99.9% / gov `FIRM` ~100% | dia 37% resolvable, **26% with cap+term**; gov **60–82%** via two clashing resolvers |
| **Credit tier** (Fed/State/Muni) | gov `TYPE` 100% | usable state/muni on **~33 of 2,474**; classifier → fed 2,149 / unclassified 297 / state 22 / muni 6 |
| **NM identity** | broker `LIKE *briggs*` / `*sjc*` | `is_northmarq` flag (dia 258, gov 104; **0 in 2026**) |
| **Cap rate** | single curated `SOLD CAP` = NOI/Price | `COALESCE` of 4 sources, order inconsistent across charts |
| **Buyer type** | dia `Type` / gov `Type2` ~97% | `buyer_type` **25%** |
| **Bid-ask spread / % of ask / DOM** | curated per-comp 95–99.9% | listing-derived, **~26%** |

This is why our term / NM / credit / buyer panels thin out where the masters' don't. The
single highest-leverage improvement is **capturing these as stored fields at intake**
(mirroring the master), rather than deriving them after the fact.

## Loan constants & cost of capital — ✅ confirmed aligned (and answers the earlier spread question)

Both masters compute loan constants as `PMT((10yrTreasury + 0.018)/12, 360, -1)*12` (low)
and `+0.022` (high) → **+180 / +220 bps over the 10-yr Treasury, 30-yr (360-mo)
amortization, 50% LTV** for the leveraged return. This matches our cost-of-capital and
returns views. Note: this also **answers the round-66 cost-of-capital question directly** —
the firm's own model *is* the fixed 180–220 bps band, baked into the master. Deriving a
data-driven spread from loan history would be a change from the published methodology, not
a correction of it.

## Formula mismatches that change the numbers

1. **Cash Return Index** — master (both verticals) = `0.25·LowerQuartile + 0.5·AvgCap +
   0.25·UpperQuartile`; ours = plain avg cap. Won't reproduce the PDF (dia 7.40%). **Fix
   both verticals.**
2. **Lease term remaining decays** — master freezes term-at-sale; our resolver measures
   against *today's* lease state, so a 2017 12-yr deal now reads short and the 12+ cohort
   empties (PDF still prints 6.89%). **Compute term as-of `sale_date`, or store it at intake.**
3. **% of Ask (dia)** — master = % of **INITIAL** ask (`% of Int Ach`); ours = `sold/LAST`
   ask **+ a `<1.0` clamp** that drops at/above-ask deals, biasing us below the PDF's
   89.9–93.7%. **Switch to initial ask; drop the `<1.0` ceiling** (gov already uses 0.5–1.5 — fine).
4. **NM cap (dia)** — master NM leg is **rent-weighted** (`ΣRENT/ΣPRICE`), market leg
   **simple**, and market **excludes blank brokers**; ours makes both simple on
   `is_northmarq`. Won't reproduce the PDF's 6.70% vs 7.33%.
5. **Credit classifier (gov)** — federal-biased regex drops 297 to unclassified; state/muni
   never clear the n≥2 gate. **Capture credit tier + broaden state/muni patterns.**
6. **Two gov term resolvers disagree by 403 deals** (ladder 82.1% vs leases-only 59.7%).
   **Unify both gov term charts on the 4-tier ladder.**
7. **Plumbing:** standardize the dia cap `COALESCE` order (1,003 rows); apply
   `exclude_from_market_metrics` uniformly on gov volume/count/avg/PSF; rename
   Top-Buyers/Sellers `ttm_*` columns (they're all-time).

## Dialysis — per-chart verdicts (vs `Charts` sheet + PDF)

- Volume / YoY / Count / Avg Deal — ✅ aligned (TTM SUM/COUNT/AVG of `SOLD PRICE`).
- Cap Rate TTM — ⚠ master headline is the **simple** avg (col O); its weighted variant (P)
  is **rent-weighted `ΣRENT/ΣPRICE`**, not our `Σ(price·cap)/Σprice`. Surface a simple-avg line; compute weighted as ΣRENT/ΣPRICE.
- Cap Quartiles — ✅ aligned.
- NM vs Market — ❌ rent-weight the NM leg, simple market leg, exclude blank brokers; verify `is_northmarq == *briggs*` set.
- Sold Cap by Term — ❌ **data-capture + decay** (master `TERM` 99.9% frozen; ours 26% cap+term, decays). Top fix.
- DOM & % of Ask — ❌ master uses **% of initial ask**; ours sold/last + `<1.0` clamp.
- Bid-Ask Spread — ⚠ direction correct (per-deal `achieved − last ask`, matches PDF p34 ~+44 bps long-run); gap is coverage (95% vs ~26%) — confirm sign yields positive.
- Seller Sentiment — ⚠ master core overlay = **≥10yr**; ours ≥8yr. Align to 10yr.
- Cost of Capital — ✅ +180/+220, 30yr amort. (Master's 10+ overlay is DaVita-only — a quirk; don't copy.)
- Cash & Leveraged Returns — ❌ cash index must be the **0.5/0.25/0.25 quartile blend**, not bare avg cap.
- Buyer Class — ❌ master hand-enters `Type` (Individual/Fund/REIT) at 97%; ours 25%, and buckets don't map 1:1 (master has "Fund", not "institutional").
- Rent & Price PSF — ✅ aligned.
- Valuation Index — ⚠ master divides by a cap **blend** (cap + both quartiles) and folds in available rents; ours is a single ratio. Plus raw-cap-first COALESCE.
- Inventory / Market Size / Available — ⚠ master uses curated `ON MARKET` dates across 3 tables; we synthesize a 196-day start for ~1/3 of listings.
- NM Notable Txns — ⚠ add the `transaction_type` filter; standardize COALESCE.
- (Not produced by us: master's **cap-by-tenant** FMC/DVA/Other sold-cap split, cols AH–AJ.)

## Government — per-chart verdicts (vs `All Charts`/`SSA Charts`)

- Volume / Avg Deal / Count / YoY — ⚠ aligned, but apply `exclude_from_market_metrics` uniformly.
- Average Cap — ⚠ master is **unweighted** on a single `SOLD CAP=NOI/Price`; ours volume-weights a 4-way COALESCE. Standardize the cap field; decide weighting deliberately.
- Cap Quartiles — ⚠ collapse the mismatched double-gate.
- NM vs Market — ⚠ master keys on live `L. BROKER *sjc*` + bands NM ≤9%; ours on `is_northmarq` (104/2,474, 0 in 2026). Backfill the flag from the broker string.
- **Cap by Credit Tier — ❌ root cause confirmed:** master hand-enters `TYPE` on 100%; our `government_type` holds usable state/muni on **~33 of 2,474**. State/muni non-deliverable until captured at intake + patterns broadened.
- **Cap by Remaining Lease Term — ❌ two resolvers disagree** (ladder 82.1% vs leases-only 59.7%, 403-deal gap). Unify on the ladder; ideally store `FIRM` at intake.
- Buyer Class — ⚠ class strings align; switch annual roll-up to discrete-year (it sums overlapping TTM windows); confirm Cross-Border is populated.
- DOM / %Ask / Bid-Ask / Last Ask — ✅ aligned (gov %ask band 0.5–1.5 is correct).
- Treasury / Loan Constants — ✅ +180/+220, 30yr amort.
- Cash & Leveraged Returns — ❌ cash index must be the quartile blend (`All Charts!BM`); reconcile leveraged to `BN`.
- Renewal / Lease-event charts (renewal rate, termination, rent growth, CPI-CAGR, case-for-renewal) — ⚠ source maps cleanly (master `Ownership` ≙ our `gsa_lease_events`/`gsa_leases`), TTM both; CPI-CAGR pre-2018 is a real data-window limit; watch the >1000-row sentinel filter.
- Rent Survey / Heat Map / Inventory / Top Buyers-Sellers / Pie — ⚠ snapshot sources align; fix `ttm_*` mislabel, 18-mo synthetic inventory span, broker canonicalization.
- **SSA cut — ⚠ gap:** the master ships an SSA-agency-specific deck (`SSA Charts`, with shorter 0–3 / 2.5–5 / 3+yr term cohorts). We have **no agency-scoped views**. Note if SSA pages ship.

## Combined prioritized fix list

**Data capture (needs intake/process change — biggest deliverable impact):**
1. Store **firm-term-remaining-at-sale** per comp (both verticals) — frozen, not decaying. Unblocks every term cohort.
2. Capture **credit tier** (gov) at intake like the master's `TYPE` + broaden state/muni agency patterns. Unblocks the state/muni cap lines.
3. Backfill **`is_northmarq`** from `listing_broker ILIKE '%sjc%' OR '%briggs%'` and tag recent NM closings.
4. Capture **buyer type** (Individual/Fund/REIT) per comp.

**Formula (code-only — we can do now):**
5. Rebuild **Cash Return Index** = `0.25·Q1 + 0.5·avgCap + 0.25·Q3` (both verticals); reconcile leveraged formula.
6. **% of Ask (dia)** → initial-ask reference, drop the `<1.0` clamp.
7. **NM cap (dia)** → rent-weight NM leg, simple market leg, exclude blank brokers.
8. **Unify the two gov term resolvers** on the 4-tier ladder.
9. Standardize the dia cap **COALESCE** order (1,003 rows); apply `exclude_from_market_metrics` uniformly (gov); fix `ttm_*` labels.

Durations need no change — confirmed TTM end-to-end.
