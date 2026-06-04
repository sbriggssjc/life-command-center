# Claude Code prompt — Round 68 batch 2: dia listing-side data depth (R68-A)

> Run in **life-command-center** (Dialysis_DB writes via migrations as usual).
> Addresses Scott's notes D2, D5, D6, D7, D8, D9, D11 — the listing-side charts
> (Seller Sentiment 10+ series, Asking Cap Quartiles, Available Market Size,
> DOM & Price-Change, Market Turnover, TTM turnover) all share these roots.
> Receipts below are from live Dialysis_DB queries, 2026-06-04.

```
VERIFIED BASELINE (available_listings, by listing_date year):
  2026 Q1: 143 new listings   2025: 20 (!!)   2024: 139   2023: 147
  2022: 113   2021: 149   2020: 155   2019: 203   2018: 185   2017: 145
  2016: 56   2015: 40   2014: 24   2013: 18
Sale↔listing linkage 2015–2026: 3,877 sales; 1,422 linked via
sale_transaction_id; only ~46 more have an unlinked prior listing;
2,455 sales have NO listing record at all.
10+ year cohort (lease_expiration >= listing_date + 10y):
  2019: 115 → 2021: 62 → 2023: 41 → 2024: 25 → 2026Q1: 13.

TASK 1 — the 2025 intake hole (D8, D6)
20 listings dated 2025 vs a 113–203 band, while 143 are already dated 2026 Q1.
Hypothesis: 2025-vintage listings entered via capture channels that defaulted
listing_date to first-seen/capture date (2026). Investigate:
  - created_at vs listing_date distribution for the 143 2026-dated rows;
  - sidebar raw_text / CoStar capture fields ("Days on Market", "Date on
    Market") that recover the true marketing-start date;
  - the listing-sentinel-date guards from R66o/p/r (did a backfill clamp dates?).
Recover true listing_date where evidence exists; tag provenance
(listing_date_source). Acceptance: 2025 new-listing count lands in a
plausible band (>>20), 2026 Q1 count drops correspondingly, and the
Market Turnover Monthly chart shows 2025 added-to-market bars.

TASK 2 — synthesize listing history from sold deals (D11, D9)
Scott's design, quoted: "A property sale from 2018 would have been marketed in
the time period prior to the sale date and we should know those dates exactly."
2,455 sales (2015–2026) have no listing record. Build a backfill that creates
SYNTHETIC listing rows for unlinked sales:
  - listing_date: from CoStar capture/raw evidence where present (listing
    history, date-on-market); else sale_date − median DOM for that year's
    linked cohort (compute, don't hard-code).
  - off_market_date = sale_date, status='sold', sale_transaction_id linked.
  - data_source='synthetic_from_sale' + provenance — MUST be distinguishable.
  - VIEW RULES: active-universe/count charts (Available Market Size, Market
    Turnover denominators, TTM turnover) INCLUDE synthetic rows; price/DOM/
    price-change charts (DOM & % of Ask, Bid-Ask, price-change frequency)
    EXCLUDE them (no real ask-price history). Enforce in each view, document
    per view in the migration.
Acceptance: pre-2016 active-universe counts rise from <50 toward a defensible
level; D9's chart no longer shows the artifact cliff; DOM/price charts
byte-identical (they exclude synthetics).

TASK 3 — 10+ cohort gates after Tasks 1+2 (D2, D5, D7)
The 10+ series gaps in 2024–2026 are partly genuine market shift (fewer
long-term deals listed post-2021) and partly n-gate suppression on thin
periods. After Tasks 1+2 land: re-test the gated views (sentiment cohort,
asking-cap quartiles by term, avail-market 10+ gate n>=6 from R66v). Where a
period has real deals but fails the gate, consider widening to rolling-3-month
pooling for the 10+ cohort specifically (keep the gate, pool the window).
Report the before/after coverage table for each affected chart. If the
remaining gaps are genuine (no 10+ deals listed), document that as the answer
— do not fabricate.

CONSTRAINTS
- Dry-run-first for both backfills (Task 1 re-dating, Task 2 synthesis):
  produce a plan JSON (counts by year, sample rows) for verification gate
  BEFORE --commit. Same workflow as the master import rounds.
- Synthetic rows must never feed price-derived metrics. The volume
  count×avg from batch 1 counts TRANSACTIONS (sales), not listings — no
  interaction, but assert it.
- Round-numbered commits; report per-chart before/after at Dec-2025 and
  the earliest affected periods.
```
