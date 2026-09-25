# SALE-PROMOTER1: record the sales Salesforce and CoStar already know about (2026-09-25)

Follows LISTING-SALE-PARITY1 §6. Eleven active listings were sold according to Salesforce or the CoStar
sidebar, but `sales_transactions` had no row, so the parity triggers had nothing to close them with.
Everything below was measured live. Every write is logged and reversible.

## 1. What was missing

- **Gov:** the only `sf_comp_staging` → sales writer is `gov_promote_nm_comps`, scoped to
  `Comp_Type__c = 'Internal'` (Northmarq's own deals). 142 `External` Sold comps had no writer.
- **Dia:** no `sf_comp_staging` → sales writer at all (130 `External` Sold comps).
- **Sidebar:** `upsertDomainSales` (LCC) is the forward writer. The sales in this round are ones it
  missed. Some were captured before later sidebar fixes; for others the capture landed on a different
  property row than the listing.

## 2. The design

**One rule set, two writers.** `lcc_sale_candidate_verdict(...)` is pure and byte-identical on dia and
gov. Its source block md5 `b92f6fa8…` is pinned in both repos' tests, which run one shared fixture
(`sale_candidate_verdict_cases.json`). Live function md5 `5e7ad339…` on both DBs.

| rule | verdict |
|---|---|
| no date / date in the future | `refuse_no_date` / `refuse_future_date` |
| mortgage, deed of trust, release; refinance | `refuse_not_a_transfer` |
| recordation more than 365 d from the sale date | `refuse_date_inconsistent` |
| date only: no price, no party, no recording fact (SIDEBAR-AGENCY-OVERWRITE) | `refuse_date_only` |
| price under $50k | `refuse_price_implausible` |
| a party or deed but no price | `refuse_priceless_transfer` |
| portfolio price | `refuse_portfolio_price` |
| owner-user, non-arm's-length, nominal, related, partial interest, auction, foreclosure, condo | `promote_non_market` |
| otherwise | `promote_market` |

- **Price-less transfers are refused, not written.** R37 (`classifySaleWrite`) already keeps the
  sidebar from minting a price-less row, and the promoter keeps that rule. The promote log holds the
  evidence.
- **Non-market sales are written with `exclude_from_market_metrics = true`,** not skipped. The building
  changed hands, and the CM comps stay clean. `lcc_listing_sale_verdict` never closes a listing on a
  non-market sale, so the promoter queues any open listing on the property as `review_non_market_sale`.

**Per-DB writer: `<dom>_promote_market_sales(dry_run default true, since default today − 730, property_ids, run)`.**
- Sources: `sf_comp_staging` (`External`, `Sold`, not deleted, deduped by `sf_comp_id`: dia staging held
  2 comps twice) and `<dom>_sidebar_sale_candidate`.
- Identity: `linked_property_id`, or a civic-guarded address match (state + normalized address + civic
  number) that is unique. Otherwise `refuse_property_unmatched`.
- Duplicates are checked against every `transaction_state`:
  - the property and its civic twins, within ±30 days: `refuse_existing_sale_within_30d`;
  - the same price (±1%) within 400 days: `refuse_existing_same_price`;
  - the same price (±0.5%) in the same city on a different property within 45 days:
    `refuse_sale_on_other_property`, with the listing queued for review against that sale;
  - candidate against candidate, where the best-evidenced row wins.
- A placeholder party (`Undisclosed`, `Unknown`, ...) is not a party.
- Log: `<dom>_sale_promote_log`, one row per candidate, updated only when its decision changes.
  Undo: `<dom>_restore_sale_promote(run[, source_ref])`. It reopens closed listings, withdraws open
  reviews and deletes the sale.
- Schedule: gov 05:50 UTC (after `gov-nm-comp-promote` 05:30), dia 05:52 UTC. Both run after the
  hourly SF staging refresh at :41.

## 3. The eleven, one by one

| DB | listing | outcome |
|---|---|---|
| gov | Walla Walla 23342 | promoted (SF $2.0M 2026-07-20) → **closed + linked** |
| gov | Savannah 16265 | promoted (SF $19.7M 2026-06-23) → **closed + linked** |
| gov | Moses Lake 16412 | promoted (SF $7.2M 2026-06-15) → **closed + linked** |
| gov | Jasper 16236 | promoted (SF $1.85M 2026-03-11) → **closed + linked** |
| gov | Marathon 3741 | **not a missing sale.** The listing's own address is 24700 Overseas Hwy, Summerland Key (property 41088), which already has the sale. The listing is linked to 3741. → review `review_listing_on_wrong_property` |
| gov | Asbury Park 16239 | sale exists, owner-user, excluded; the listing was re-seen 2026-09-24 and our SF internal comp is still Available → review `review_non_market_sale` |
| dia | Oak Forest 25570 | **refused**: the same sale (14875) sits on 38853 "5340 159th St", a duplicate property row → review |
| dia | Manchester 28981 | promoted (SF $2.2M 2026-03-06) → **closed + linked**. The second sidebar row (recorded 2006) was refused as date-inconsistent |
| dia | Bronx 35803 | promoted (sidebar deed $4.2M 2025-07-10). The listing has no capture date (`keep_undated`), so it stays open → review `review_promoted_sale_listing_open` |
| dia | Durham 27823 | promoted non-market (owner-user $1.6M 2026-07-29, excluded) → review `review_non_market_sale` |
| dia | Kissimmee 37696 | **refused**: the sale (14880) is on 37624; 37696 is a "For Sale \| 802 N John Young Pky" duplicate row → review |

**Beyond the eleven:** gov West Plains 16253 was promoted (no open listing). Dia 24483 was promoted
and its listing closed, and dia 25203 was promoted (no open listing). Dia 24669 and 35815 were refused
as sales on another property and queued.

**Result:** 5 of the 11 closed. The other 6 went to a review queue, each with a named reason. Guard
`active_listings_with_sale` reads 0 on both DBs. Open reviews: gov 10, dia 14. REVIEW-LANES1 is their
consumer.

## 4. Stale rule re-keyed on capture date

`<dom>_listing_market_age_date(on_market, source, listing_date, capture)` changes one case. When the
on-market date is `sf_on_market_date` and falls before capture, the listing's age counts from capture.
Every other case is unchanged. `<dom>_release_stale_listings_rekeyed()` restores the stale-verify rows
the new rule would not route.
- Gov: 131 released, **158 → 27** still queued (11 over 2 years, 16 not seen in 180 days).
- Dia: 39 released, **65 → 26** still queued (all over 2 years; dia capture is the parity proxy, since
  `-dia-first-seen` is still open).

⚠️ **The gov release exposed a latent LISTING-SALE-PARITY1 defect, and it cost 3h45m of Available.**
`gov_restore_listing_sale_close` replayed `prior->>'listing_status'` (plus the off-market fields and the
sale link) for **every** action. A `stale_verify` row's `prior` holds only the verification fields, so
restoring one set `listing_status` to NULL.
- All 131 released listings left Available from 16:07:50 to about 19:55 UTC: gov active 465 → 334.
- Dia's twin already branched on action, which is why the dia release was clean.
- Fixed: the function now restores only what the action moved. Rows repaired: all 131 were open when
  routed and the under-contract count never moved (11), so all were `active`.
- A regression test goes red without the fix.
- **Lesson: a restore that replays a whole `prior` must only replay the fields that action wrote.**

The dry-run count caught the release size. It could not catch a side effect of the restore function,
and I did not re-read `active` right after the release. That check happened only at the end of the round.

## 5. Sidebar staging load

The domain DBs cannot read LCC Opps. This round's load ran in the session. It covered dia assets with
an open listing, rows since 2024-09-25 that carry a price, a party or a recording fact: 17 rows. Gov's
stage is empty: its two sidebar cases were already on file. The loader query parses `sale_date` from
`Mon D, YYYY` or `M/D/YYYY`:

```sql
-- on LCC Opps; __DOM__ = dia|gov, __IDS__ = the open-listing property ids from the domain
select ... from external_identities ei join entities e on e.id = ei.entity_id
 cross join lateral jsonb_array_elements(e.metadata->'sales_history') with ordinality t(x, ord)
 where ei.source_type = 'asset' and ei.source_system = '__DOM__' and e.merged_into_entity_id is null ...
```

A scheduled feeder is filed (`SALE-PROMOTER1-sidebar-feed`). Until it exists, only SF comps are picked
up on schedule.

## 6. Tests

- gov `tests/unit/test_sale_promoter1.py`: 39 pass, 12 mutations, every one red by behaviour (checked
  with a harness that tells "returned false" from "errored").
- LCC `test/sale-promoter1.test.mjs`: 20 pass, 9 mutations red. A mutation that breaks the migration
  counts as a failure there, not a pass.
- Both apply the parity migration and then this one, byte for byte, to a throwaway Postgres.

## 7. Open

- `SALE-PROMOTER1-sidebar-feed`: a scheduled LCC → domain feed for sidebar sales the forward writer missed.
- `SALE-PROMOTER1-history`: External comps older than 730 days are not promoted by default (gov 142 /
  dia 130 total). Widen `p_since` after a dry-run review.
- `SALE-PROMOTER1-dup-properties`: Oak Forest 25570/38853, Kissimmee 37696/37624/24669 and the 35815
  pair are duplicate property rows, which is why their sales sit on another id.
- `LISTING-SALE-PARITY1-dia-first-seen`: still open. Bronx shows the cost: a listing with no capture
  date cannot close.
