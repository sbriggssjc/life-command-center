# GOV Northmarq comp → sales `is_northmarq` promotion (ongoing) — 2026-06-23

Fixes the June-22 capital-markets chart review finding RC10
(`CM_EXPORT_CHART_AUDIT_2026-06-22.md` / `..._RESPONSE.md` Task "gov Northmarq
subset"): Scott's own gov NM-brokered sales all but vanished from the report
since 2023. Grounded live on government (`scknotsqkcheojiaewwh`) 2026-06-23.

**It was a propagation gap, not a collection gap** — the NM comps are in
staging, but the match/promotion that stamps `is_northmarq` on
`sales_transactions` ran exactly ONCE (the inline Round-74c script, 2026-06-09)
and was never wrapped as a function/cron, so it never re-ran.

## ⚠️ Grounding correction the task premise got wrong (surfaced, not buried)

The original task receipts pointed at **`sf_comps_staging`** (plural) — per-year
counts 162/179/104/88/128/62 — and called them "staged NM comps." **They are
NOT Northmarq comps.** `sf_comps_staging` is dominated by
`source_system='costar_sidebar'` — **CoStar MARKET captures** (1,447 dated rows,
refreshed daily through 2026-06-23, `raw_row` = `{buyer_name, seller_name}`).
Tagging `is_northmarq` off matches to that table would have **mass-false-attributed
the entire market to Northmarq** — exactly the trap the task warned against. We
deliberately do **not** touch `sf_comps_staging` here. (Its CoStar promotion is a
separate path; leaving its `processed`/`linked_sale_id` at 0 is correct.)

The three similarly-named tables, disambiguated live:

| table | rows | what it actually is |
|---|---|---|
| **`sf_internal_comp_export`** | 127 | **the authoritative NM comp universe** — NM's internal gov comp DB (NM deal-style names, all government), loaded 2026-06-09 |
| `sf_comp_staging` (singular) | 840 | SF Object-Sync comp staging — carries the `Direct_Co_Broke__c` SIDE per `sf_comp_id` |
| `sf_comps_staging` (plural) | 1,634 | **CoStar market captures** (`costar_sidebar`) + 187 legacy `Comps.xlsx` rows — NOT the NM source |

## Root cause of the recent (2023+) gap

The R74c matcher reads NM comps from `sf_internal_comp_export` and joins the
buy/sell side from `sf_comp_staging.raw_row->>'Direct_Co_Broke__c'`. **Every**
Sold/priced NM internal comp matches a gov sale via the conservative gate — but
the `Direct_Co_Broke__c` side is **NULL for all 2024 (5) and 2025 (4)** comps
(the side field went stale in the SF comp sync). R74c therefore HELD them
("9 null-side matched comps HELD") and the recent years were never tagged.

For every year where a side IS present (2003-2023) it is **always** one of the
three NM sides (`Direct (Both)` / `Co-Broke (Seller)` / `Co-Broke (Buyer)`) and
**never** an external/competitor value — i.e. the internal-comp object only holds
NM-involved deals. A side-less internal comp is therefore an NM deal whose side
simply wasn't entered.

## What shipped

`government-lease/sql/20260623_gov_nm_comp_promotion.sql` (applied live to gov):

- **`gov_promote_nm_comps(p_dry_run boolean default true, p_tag_unsided boolean
  default true)`** — wraps the proven R74c matcher (state + `sale_date` ±120d +
  `sold_price` ±6%, confirmed by city OR agency(tenant) OR ≤25mi geocoded
  proximity; 1:1 best-comp-per-sale). Flag columns only — never price/cap/term.
  - `Direct (Both)`/`Co-Broke (Seller)` → `is_northmarq=true`,
    `is_northmarq_source='salesforce_comp'`, buyside=false.
  - `Co-Broke (Buyer)` → buyside=true (GUARD: skip if the sale's `listing_broker`
    is itself an NM broker).
  - **NULL side** (`p_tag_unsided=true`, the recovery) → `is_northmarq=true`,
    `is_northmarq_source='salesforce_internal_comp'` (DISTINCT provenance so the
    side-inferred set is auditable + revertable on its own). Set
    `p_tag_unsided=false` for exact R74c hold behavior.
  - **Idempotent** (writes only rows whose `(is_northmarq, source, buyside)`
    differs); **no removes** (a flagged sale is never un-tagged, parity with R74c);
    every change logged to `gov_nm_comp_promote_log` (prev+new) for audit/revert;
    dry-run writes nothing.
  - Marks the matched NM comps in `sf_comp_staging` (`linked_sale_id`,
    `processed=true`, `match_method='nm_comp_promote'`).
- **Ongoing**: cron **`gov-nm-comp-promote`** (daily 05:30 UTC,
  `gov_promote_nm_comps(false,true)`) — re-derives from scratch each run, so a
  refreshed `sf_internal_comp_export` / `sf_comp_staging` propagates automatically.
  This is the durable fix for "made ongoing, not another one-time backfill."

Both `is_northmarq` triggers on `sales_transactions` are column-scoped
(`listing_broker`/`sale_date`/`purchasing_broker`), so the `is_northmarq`-only
UPDATE never fires them (verified; R74c proved persistence).

## Verified live (applied 2026-06-23)

Real run: `matched_sales=105, listing_changes=2, buyside_changes=0,
unsided_changes=9, already_correct=94, held=0, staging_linked=105, no_match=3`.

**Gate — NM-tagged gov sales by year (before → after):**

| year | before is_nm / src | after is_nm / src | note |
|---|---|---|---|
| 2021 | 17 / 17 | 17 / 17 | unchanged |
| 2022 | 12 / 8 | 12 / 8 | unchanged |
| 2023 | 3 / 2 | 3 / 2 | unchanged (already at the matchable share) |
| **2024** | **1 / 0** | **5 / 5** | +4 recovered (all `salesforce_internal_comp`) |
| **2025** | **2 / 0** | **5 / 4** | +3 recovered |
| 2026 | 0 / 0 | 0 / 0 | honest — **no NM internal comp sold in 2026 yet** |

- `is_northmarq_source` no longer 100% null from 2024 (was the audit symptom).
- **Idempotent**: an immediate second real run made **0 sales changes**
  (`already_correct=105`).
- **Spot-check (gate c)**: all 9 newly-tagged sales are EXACT matches to their SF
  comp — identical city/state/`sold_price` (to the dollar)/`sold_date`/tenant
  (Fort Wayne VA $8.0M, Peoria SSA $4.65M, El Paso CBP $1.84M, Rockwall TX
  $3.55M, …). **0 false positives.**
- **Chart (gate d)**: `cm_gov_nm_vs_market_q` NM cap-rate line is now populated
  through **2026-03-31** (6.54% → 7.35% across 2024-26), tracking just above
  market — the right edge that was starved. CM views are live, no deploy needed.
- **`sf_comp_staging`** matched rows now `processed`/`linked_sale_id` set (105);
  `sf_comps_staging` (CoStar) deliberately untouched.
- No regression: buyside total still 10; `is_northmarq` total 131 → 140 (+9).

## No-match / create-from-comp bucket — reported, NOT created

NM internal comps (Sold, priced) that match NO gov sale = **3 total**, all old
(2010, 2013, 2021); **0 for 2024-26**. Creating `sales_transactions` rows from
SF comps is therefore immaterial to the recent recovery and was **NOT done**
(left for a future Scott-gated decision). The recovery came entirely from tagging
existing matched sales.

## Reversibility

- Per-run revert from `gov_nm_comp_promote_log` (`prev_*` columns).
- Revert ALL side-inferred tags only:
  `UPDATE sales_transactions SET is_northmarq=false, is_northmarq_source=NULL,
  is_northmarq_buyside=NULL WHERE is_northmarq_source='salesforce_internal_comp';`
- `SELECT cron.unschedule('gov-nm-comp-promote');`

## Boundaries

gov-DB attribution only; flag columns only (no price/cap/term writes); did not
alter the SF importer or the chart code (both correct once the data is tagged);
conservative matching over coverage. No `api/*.js` change (pure gov-DB SQL + cron).
