# LISTING-SALE-PARITY1 — gov Available shows properties that have sold; make listing↔sale reconciliation identical in dia and gov

Backlog: `LISTING-SALE-PARITY1`. Source: Scott, 2026-09-24:

> "a number of available deals showing up in the available tab of the government section that are properties that have recently sold or are showing as sold in our sales tab (or should be) … confirm all the same mechanisms that check and connect and reconcile listings and sales in the dialysis database are present in government and vice versa … not double counting availables."

Cowork measured it live in round 78. This is one topic: the listing lifecycle (open → sold/withdrawn/stale) on both DBs.

## Measured (Cowork, 2026-09-24, live)

**1. The gov sale→listing close is dead: a case bug.**
- gov `available_listings.listing_status` values are lowercase:

| value | rows |
|---|---|
| `active` | 482 |
| `sold` | 2,308 |
| `superseded` | 233 |
| `orphan` | 61 |
| `off_market` | 54 |
| `under_contract` | 11 |
| `withdrawn` | 4 |

- Both gov triggers that should close a listing on a sale match `listing_status = 'Active'` (capital A), so they never fire:
  - `close_listing_on_sale` (on `sales_transactions`);
  - `pse_close_listing_on_sale` (on `property_sale_events`).
- Each also closes only ONE listing (`LIMIT 1`), requires `listing_date <= sale_date`, and never sets `sale_transaction_id` or `is_active`.
- **0** of 482 active gov listings carry `sale_transaction_id`. Whatever closed the 2,308 sold rows, it wasn't these triggers.

**2. The dia trigger is the model to copy.** Dia `close_listing_on_sale`:
- closes **every** open listing on the property (`off_market_date IS NULL`);
- skips non-market sales (`exclude_from_market_metrics`);
- keeps a genuine re-listing (`on_market_date > sale_date + 90 days`);
- sets `is_active=false`, `status='Sold'`, `off_market_reason`, `sold_date`, `sold_price` and `sale_transaction_id`.

**3. Dia has machinery gov lacks:**
- `dia_consolidate_listings_by_transaction`
- `dia_consolidate_property_listings`
- `fn_sale_event_mark_listings_sold` (gov's analogue is the broken `pse_close_listing_on_sale`)
- `dia_propagate_closed_sales_to_workbook`
- `cm_capture_active_listings_snapshot` (cron `cm_dialysis_listing_snapshot_daily`)

Both DBs have `lcc_data_hygiene_sweep` (dia 03:00, gov 03:30), `lcc_record_listing_check`, `propagate_sales_recompute` and `v_listings_on_market_at`. Diff these rather than assume they match.

**4. The reverse direction is missing on both: a listing created after the sale is already on file.**
- `listing_date` is often a fallback (`capture_date_fallback`, `date_unknown_r70b34`), so "sold before listed" can't be read from it. Live gov examples:
  - **4231 S Pipkin Rd, Lakeland FL** (31007): sold 2026-06-09; an OM captured today created an "active" listing dated 2026-09-24 (capture fallback).
  - **1664 Pond Fork Rd, Madison WV** (15747): sold 2022-02-25, "listed" 2022-05-03, first/last seen 2026-05-04, still active.
  - **7840 Madison Ave, Fair Oaks CA** (16506): sold 2026-02-10, OM 2026-05-06, no price. It could be a genuine resale; decide from evidence.
  - Florence SC 31529, Long Beach CA 16531 and Casa Grande AZ 905: sold 1–2 years before a capture-dated listing.
- 47 active gov listings sit on a property that has any sale in `v_sales_comps`; 6 of those sales fall within 2 years before the listing date.
- Dia: 6 active listings have a same-property sale within a year before or after the listing date.

**5. Twins.**
- 11 active gov listings share a normalized address + state with a sale recorded on a **different** property id; 1 of those sales post-dates the listing.
- Dia and gov each have 0 properties with two active listings today, so no in-DB double count. **Cross-domain double counting** (the same building active in both dia and gov Available) is unmeasured.

**6. Staleness.**
- Gov: 14 active listings not seen in 180 days, 4 listed over 2 years ago.
- Dia: 13 listed over 2 years ago.

## Ask

1. **Parity matrix first.** For every listing↔sale mechanism on either DB (triggers, crons, functions, LCC handlers such as the intake/sidebar listing writers and the listing-page crawler), make a two-column table: dia vs gov, present / absent / different, with the live definition diffed. Include the LCC side that writes or reads both.
2. **Fix gov to dia's semantics** (one implementation per behaviour, with names per the repo's conventions):
   - the sale close on `sales_transactions` and on `property_sale_events`;
   - case-insensitive status, or better, one canonical vocabulary with a CHECK, if dia's is safe to mirror;
   - close all open listings on the property;
   - the relisting grace, the non-market-sale exclusion, and the `sale_transaction_id` / `sold_*` / `is_active` links.
   - Port the consolidation and snapshot functions gov lacks, or say why gov doesn't need them.
3. **Add the reverse check on BOTH DBs.** When a listing is created or re-seen, if the property (or its twin, via the existing address matcher with the GOV-AVAIL1 civic guard) has a market sale on or after the listing's **real** on-market date, close it as sold. When the listing date is only a fallback, compare against the sale date plus a window you justify. If the evidence is ambiguous (e.g. Fair Oaks), mark it for review, don't close it.
4. **Backfill both DBs**, logged and reversible (GOV-AVAIL1 pattern):
   - close every active listing that one rule says is sold, and report each class with counts;
   - link `sale_transaction_id` where it's certain;
   - send stale ones (not seen in 180 days / listed more than 2 years ago) to the existing verification lane (`verification_due_at` / `lcc_record_listing_check`), not straight to closed.
5. **Cross-domain double count.** Measure buildings active in both dia and gov Available (normalized address + state, plus the SF / CoStar ids you have). Report them, and pick one owner per building per the existing domain rules. Don't delete anything.
6. **"Should be sold."** Find sales Salesforce or CoStar already know about but `sales_transactions` doesn't: `sf_comp_staging`, sidebar-captured `sales_history`. List active listings that one of those says sold. Promote a sale only through the existing sale writers with their guards (SIDEBAR-AGENCY-OVERWRITE's "a date alone is not a sale").
7. **Guard:** a daily check on each DB that counts active listings with a same-property or twin market sale on or after their on-market date, raising the existing health alert when that count is above 0.

Tests: a gov lowercase `active` listing closes on a sale; all open listings close; a re-listing after 90 days survives; the reverse check closes a post-sale capture and flags an ambiguous one; parity holds (the same fixture gives the same result on the dia and gov function). Each needs a mutation that turns it red.

## Done means

- Backlog row with the before/after gov and dia Available counts by class.
- Gov migrations in government-lease; dia migrations in the repo that owns them.
- LCC code deploy = redeploy BOTH Railway services.
- Scott re-checks Gov Available for the properties he saw.
