# Claude Code (dialysis + LCC) — SJC Deal Book: make it Deal-object-primary + self-maintaining

## Why (proven live, 2026-07-14)

The SJC/Northmarq dialysis Deal Book undercounts the real track record by ~70%.
`v_sjc_deal_book` (dia `zqzrriwuavgrquhisnoa`) is built ENTIRELY from
`sf_listing_staging` — every row there carries an `sf_listing_id`, so it's crawling
the Salesforce **Listing** object. A closed deal only lands in the book if it had a
marketing *Listing* record. Deals that were **off-market / buy-side / co-broke /
referral / older** (pre-Listing-workflow) have no Listing record → invisible to the
crawl.

Ground truth: Scott exported "all internal SOLD transactions, property sub-type =
Dialysis" from Salesforce (290 rows → **272 distinct deals after dedup, 251 priced**).
Our book shows **82 closed**; only 72 match the export. **~180 closed dialysis sales
are in Salesforce but missing from our book.** It is NOT the record-type filter (285
of 290 are already in our 4 whitelisted types) and NOT a date cutoff (both span
2007–2026). The Listing-object crawl simply pulls a subset.

Export saved to the repo:
`audit/data-flow-2026-05-30/data/sjc_dialysis_sold_export_2026-07-14.xlsx`
(columns: DEAL NAME, SALES PRICE, CAP RATE, CLOSE DATE, LEAD BROKER, TEAM, DEAL TYPE,
DIRECT/CO-BROKE, REFERRAL, CITY, STATE, CBSA TITLE, TENANT, BUILDING SF, ELA, DEAL
COMMISSION, PROPERTY TYPE, PROPERTY SUB-TYPE, SPECIFIC USE, LAND OWNERSHIP, BUYER/
SELLER 1031, LIST DATE, LISTING PRICE, MARKETING CAP RATE, LEASE TERM REMAINING,
LEASE TERM YEARS, TIME ON MARKET DAYS, SALE CONDITION, SELLER COMPANY/ENTITY/ORG TYPE,
BUYER COMPANY/CONTACT/CITY/STATE/ENTITY/ORG TYPE).

Scott's directive: "regardless of the source, ingest → propagate → validate →
consolidate into ONE most accurate truth in the database, with minimal manual
involvement." So the manual export is a **one-time bootstrap**; the durable fix is a
**Salesforce Deal-object crawl** that keeps the book current with no re-exports.

## The design — a Deal-object-primary, self-maintaining book

### 1. Staging table (`sjc_deal_ingest`, dia — migration)
One table that BOTH the bootstrap import AND the durable crawl write to:
- `deal_source text` (`manual_export` | `sf_crawl`), `sf_deal_id text` (null for the
  bootstrap; populated by the crawl), `import_batch text`, `raw jsonb`.
- `dedup_key text` = `lower(normalized deal_name) | close_date(YYYY-MM-DD) |
  round(sales_price/1000)` — the natural key that collapses the export's both-side /
  referral / outside-fee duplicate rows (the export has 290 rows but **272 distinct
  dedup_keys**; e.g. Leeds AL, Lawton OK, Paris/Washington PA appear twice for buy +
  sell side). **Dedup on this, not on row identity.**
- Typed columns for the fields the book renders: deal_name, sales_price, cap_rate,
  close_date, lead_broker, team, deal_type, referral, city, state, tenant,
  building_sf, deal_commission, property_subtype, seller_company, buyer_company,
  buyer_contact_name, list_date, listing_price, marketing_cap_rate, lease_term_years,
  time_on_market_days.
- `linked_property_id bigint`, `matched_sale_id bigint` (filled by propagation, §4).
- Indexes on `dedup_key`, `deal_source`, `sf_deal_id`.

### 2. Bootstrap load (one-time, in the migration or a committed loader script)
Load the saved export into `sjc_deal_ingest` with `deal_source='manual_export'`,
`import_batch='manual_export_2026-07-14'`, computing `dedup_key` as above. Map
`DEAL TYPE`→`deal_type`, etc. Keep the raw row in `raw`. (A committed
`scripts/load-sjc-deal-export.mjs` that reads the xlsx is fine; or a SQL seed. Idempotent
on `dedup_key`.) Expected: 290 rows in, **272 distinct deals** surfaced by the view.

### 3. Durable Salesforce **Deal-object** crawl (the real fix)
This is the piece that removes manual exports. Mirror the EXISTING SF Listing crawl
(the Power Automate flow that writes `sf_listing_staging`):
- **PA flow (Scott builds, like the existing SF/SharePoint flows):** crawl the SF
  **Deal / "Notable Transactions" / Opportunity** object (filtered to the sold /
  dialysis-relevant set — the same scope as the export) and POST batches to a new
  worker endpoint. Include the SF record Id (→ `sf_deal_id`), all the export's fields,
  and `LastModifiedDate`.
- **Worker (LCC or dia — a sub-route, no new api/*.js if avoidable):** upsert rows into
  `sjc_deal_ingest` with `deal_source='sf_crawl'`, `sf_deal_id`, `import_batch='crawl_...'`.
  Idempotent on `sf_deal_id` (update-in-place per deal). Gentle cron (daily), same
  posture as the Listing crawl.
- **Consolidation (the "one truth" rule):** a `sjc_deal_ingest` row from `sf_crawl`
  (has `sf_deal_id`) SUPERSEDES a `manual_export` row with the same `dedup_key`. So as
  the crawl backfills history, the bootstrap rows are automatically replaced — no
  double-count, no stale manual data. Model it as a `v_sjc_deal_ingest_current`
  = `DISTINCT ON (dedup_key)` preferring `sf_crawl` over `manual_export`, then latest
  `sf_last_modified`/`created_at`.

### 4. Propagate (link each deal into the property/sales graph)
For each consolidated deal, best-effort match to a `properties` row (address/tenant/
city/state — reuse the existing matcher used elsewhere) → set `linked_property_id`,
and to a `sales_transactions` row (property + close_date + price) → `matched_sale_id`.
Where a confident property match exists but no `sales_transactions` row does, this is
the hook to CREATE the sale (feeding TTM/cap-rate) — but **gate that behind a flag /
Scott's blessing** for the first run (don't mass-create sales silently; the cap-rate
framework + dedup rules in CLAUDE.md apply). At minimum, surface the linkage so the
book rows click through to the property.

### 5. Consolidate the view — `v_sjc_deal_book` deal-object-primary
Rewrite `v_sjc_deal_book` to read from `v_sjc_deal_ingest_current` (the Deal object)
as the PRIMARY source, UNION the `sf_listing_staging` source ONLY for **active-listing
marketing status** that isn't a closed deal (so the current on-market/marketing pipeline
still shows). **Keep the EXACT output columns** `v_sjc_deal_book` exposes today
(`sf_deal_id, deal_name, deal_side, sjc_team, deal_status, deal_stage, is_closed,
closed_price, asking_price, cap_rate, noi, est_close_date, property_address, city,
state, seller_company, linked_property_id, matched_sale_id, …`) so the dependent views
are unaffected in shape:
- `v_sjc_deal_book_summary` reads `sjc_team, deal_side, deal_stage, is_closed,
  closed_price, matched_sale_id`.
- `v_sjc_deal_book_by_year` reads `deal_side, is_closed, est_close_date, closed_price,
  cap_rate` and **filters `deal_side='Sale Deal - Commercial'`** — with the deal-object
  source this by-year chart now reflects the full Sale-Deal-Commercial history (213
  rows in the export vs the ~62 it saw before). Confirm that's desired (it is — it was
  undercounting for the same root cause).
- Map the export's `DEAL TYPE` → `deal_side`/`deal_stage` the same way the current view
  maps `record_type`/`Deal_Status__c` (Closed IS→closed, etc.). Referral / outside-fee
  rows should be classified so they don't inflate the closed count (they carry no
  price — treat as non-closed or a distinct `referral` stage).

### 6. dia app render (dialysis.js) — no shape change needed
The Overview SJC Deal Book section + `Deals › Sales` read the three views; with the
views repointed they show ~251 closed automatically. Verify the by-year, by-team, and
recent-closed tiles render the fuller set. (gov has no SJC book — dia only.)

## Boundaries / verify

- dia migration (staging table + views) + a committed bootstrap loader + the durable
  crawl worker/cron; ≤12 api/*.js. Additive + reversible (drop the table / re-create
  the prior view bodies from git). The Listing crawl + `sf_listing_staging` are left
  intact (now a supplemental source for active marketing status).
- **Verify:** after bootstrap, `v_sjc_deal_book` closed count jumps 82 → ~251 (272
  total incl. active/referral), by-year spans 2007–2026 with the fuller counts
  (2018:~24, 2019:~27, 2020:~30, 2021:~48 per the export), `_summary` by-team sums
  reconcile, no duplicate deals (dedup_key holds), and the dia Overview renders it.
  Then simulate a `sf_crawl` upsert with a matching `dedup_key` and confirm it
  SUPERSEDES the manual_export row (count unchanged, source flips). `node --check`;
  suite green.
- **Validation loop (Scott's ask):** once live, Scott eyeballs the ~251 against his
  knowledge; any genuinely-missing deals are a Salesforce-scope question (the crawl
  filter), not the app — the crawl filter is the one knob.

## Documentation

Update CLAUDE.md (new SJC Deal Book section): the book is **Deal-object-primary**,
sourced from `sjc_deal_ingest` (durable SF Deal-object crawl, `deal_source='sf_crawl'`,
superseding the one-time `manual_export` bootstrap by `dedup_key`); the SF **Listing**
crawl (`sf_listing_staging`) is now supplemental (active marketing status only). One
self-maintaining truth, no recurring manual exports.

## Bottom line

The Deal Book showed 82 of ~251 closed dialysis deals because it was fed from the SF
Listing object, which misses off-market/buy-side/co-broke/referral/older deals. Ingest
the Deal object (bootstrap from the saved export now, durable SF Deal-object crawl
going forward), dedup on a natural key, propagate to properties/sales, and repoint
`v_sjc_deal_book` deal-primary — one accurate, self-maintaining track record, verified
in the live dia Overview.
