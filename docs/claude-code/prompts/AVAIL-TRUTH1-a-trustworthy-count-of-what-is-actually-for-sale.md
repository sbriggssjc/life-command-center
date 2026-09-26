# AVAIL-TRUTH1 — a trustworthy count of what is actually for sale, with price and date history kept

Backlog: `AVAIL-TRUTH1` (new), absorbing `DUP-RECORDS1-gov-properties` and `DUP-RECORDS1-panel-merge`. Source: Scott, 2026-09-26:

> "a number of government availables that are showing in our available list that are no longer on the market or have already sold … a number of duplicates still in there … I'd imagine the same for property duplicates … Are we accurately tracking and retaining dates and price adjustments?"

Cowork measured it live in round 81. This is one topic: the lifecycle of an available listing (captured → re-seen / re-priced → off market or sold), on both DBs.

## Measured (Cowork, 2026-09-26, live)

**1. "Sold" is now handled.**
- LISTING-SALE-PARITY1 + SALE-PROMOTER1: `gov_check_listing_sale_parity()` reads 0 active listings with a qualifying sale.
- The sidebar-sale feed is live: Cowork applied cron **269** after the deploy, and the smoke run staged dia 288 / gov 200 rows.
- What's left is "**no longer on the market**" (withdrawn / expired / off-market) plus duplicates.

**2. Nothing verifies that a listing is still live.**

| | gov | dia |
|---|---|---|
| active listings | **463** | **425** |
| not seen in 90 days | **355** | 141 |
| never URL-checked | **458** | **425** |

- Gov by source: `lcc_intake_om` 357, `costar_sidebar` 65, `salesforce_ascendix` 40, `crexi` 1. An OM is a snapshot; nothing re-sights it.
- The LCC machinery exists but is empty: `lcc_listing_web_pages` has **0 rows**, while cron `lcc-listing-page-crawl` runs every 30 min against nothing. `lcc-auto-scrape-listings` also runs every 6 h. Say what it actually touches.

**3. Duplicate listings on duplicate gov properties, and they hide price changes.** Active pairs, same building, different property id:

| building | property ids | price A | price B |
|---|---|---|---|
| Hope AR | 16388 / 16503 | $2.375M | $2.375M |
| Jacksonville FL | 16470 / 36683 | $23.0M | $25.0M |
| Lake Charles LA | 31576 / 6415 | $1.687M | — |
| Tupelo MS | 38279 / 8522 | **$5.64M** | **$5.135M** |
| Malta MT | 16193 / 40643 (US Highway 2 vs US-2) | $5.305M | — |
| Farmington NM | 35251 / 16311 | — | $2.2M |
| Portland OR | 31776 / 11307 | $7.6M | $7.6M |
| Poulsbo WA | 112 / 36449 | $2.205M | $2.195M |

- A later capture with a **new price** created a **second listing on a twin property** instead of recording a price change. That is where price history is lost.
- `DUP-RECORDS1-gov-properties`: gov has 297 same-address pairs and **no gov property merger** (DUP-RECORDS1 built dia's only).
- `DUP-RECORDS1-panel-merge`: the panel / Decision Center `property_merge` path still deletes the dropped row's active listings. Only the twin verdict uses the safe merge.

**4. Price and date history is thin.**
- Gov: `price_change_count > 0` on 8 active listings; `original_price ≠ last_price` on 18.
- Dia: `had_price_change` 31, and `price_change_history` is **empty on every row**.
- Gov: `on_market_date` is null on 233 of 463.
- There is no per-event log of price, cap or status changes on either DB. LCC Opps has `lcc_listing_events`; check whether it's the intended home.

## Ask

1. **Gov property merger.** Port DUP-RECORDS1's dia two-signal merger to gov: same vetoes (tenant / agency / lease number conflicts, directional, unit), reversible, survivor = the more complete row. Apply Scott's Saginaw rule. Run the 8 pairs above first, then the 297 same-address pairs (merge on two signals; card the rest).
   - **Fix `DUP-RECORDS1-panel-merge`** in the same round, so no merge path drops listings.
2. **One listing per offering, with history.**
   - When two active listings describe one offering (same property after the merge, or the same address + broker + building), fold them into one: keep the earliest capture as `on_market_date` / `original_price`, the latest price as current, and write every price and status step as an event.
   - Make the listing writers (OM intake, sidebar, SF) **update the existing open listing** on re-capture and log a price-change event, instead of inserting a new one.
   - Choose one event store (reuse `lcc_listing_events` or a per-domain `listing_price_events`; decide and say why). Backfill it from the folded pairs, `original_price` / `last_price`, gov `last_price_change`, and SF / CoStar price history where captured.
3. **Liveness: prove a listing is still on the market.**
   - Register every active listing's URLs (`source_url`, `tracked_urls`, dia `listing_url` / `url`, SF listing record) into `lcc_listing_web_pages`, and let the existing crawler and listing-event pipeline check them. Report what the crawler can and can't read (CoStar and Crexi may block).
   - For SF-sourced listings, sync status from Salesforce (closed / withdrawn / expired → off market).
   - For OM-only listings with no URL: a re-verification cadence. After N days without a re-sighting (a new OM, sidebar capture, SF touch or crawl hit), the listing moves to **"unverified"**. It isn't deleted and it isn't counted as available, and it's queued in the existing verification lane / an Accuracy card. Justify N (e.g. 120 days) from how long gov and dia deals actually stay on market (`on_market_date` → `off_market_date` on sold listings).
4. **A trustworthy count.** Define "truly available" = active, and (re-sighted or verified within N days, or confirmed live by the crawler or SF). Show it on the gov and dia Available tabs as the headline, with the unverified remainder one click away (reuse GOV-AVAIL2's display layer; don't add a parallel view). Report before/after for gov and dia: total active → truly available → unverified → closed this round, by class.
5. **Guards:**
   - a daily check that fails if any two active listings share one offering;
   - a check that a re-capture with a new price never inserts a new listing;
   - the crawler worklist count vs registered pages.

Tests: each of the rules above, with a mutation that turns it red. Include a re-capture at a new price → one listing plus one price event; the gov two-signal merge + vetoes; the panel merge keeping listings; the unverified transition.

## Done means

- Backlog rows updated with the evidence.
- Migrations in the owning repos.
- LCC code deploy = redeploy BOTH Railway services, with cache busters bumped if the frontend changes.
- Scott re-checks Gov Available: the headline count should match what he believes is truly on the market.
