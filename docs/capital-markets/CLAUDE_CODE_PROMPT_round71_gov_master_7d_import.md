# Claude Code prompt — Round 71: the 7d import (unmatched gov master Sold rows)

> Green-lit by Scott. The value case is quantified (G17 receipts): cumulative
> gov cap+term coverage 395 → ~657; 2024 cap-by-term inputs 27 → ~68 — this is
> the recent-edge fix for the cap-by-term family (G17/G37) plus depth for
> volume, bid-ask (INITIAL/LAST), DOM (ON MARKET), broker/NM, and buyer/seller
> series. Pattern: the dia r2 importer, gov edition, with every guard that
> round's failures taught us. All bulk writes: dry-run plan JSON → verification
> gate → commit.

```
SOURCE: staging.gov_master_sold (3,627 rows, still loaded on the gov DB) +
staging.gov_master_match (the 7a match table: 1,666 matched gov sales).
UNIVERSE: the ~2,464 master rows with no current match. Re-run the matcher
fresh at the start — the term/rent/NM backfills and any new sales since 7a may
have changed matchability; the import set = rows unmatched AFTER re-match.

PHASE 1 — classification plan (dry-run, no writes)
For each unmatched master row, classify:
  SALE_EXISTS_TOLERANT — a gov sale matches at ±90d + ±3% price + state
    (wider than 7a's exact fingerprint): do NOT insert; emit as ATTACH/
    enrichment candidate (fill-only: cap/term/rent/dates the sale lacks).
  DUP_REVIEW — tolerant match on a DIFFERENT property: never insert; emit
    for fingerprint adjudication (the R68 lesson: cap-fingerprint identity,
    not address identity — gov addresses are cleaner but the rule stands).
  PORTFOLIO_SKIP — >=2 master rows identical price within +-2d across
    different buildings: skip allocation-contaminated rows.
  INTRA_MASTER_DUP — dedup master rows on (state, date, price, address).
  INSERT — genuinely new sale: property attach-or-create + sale insert.

PHASE 2 — property resolution (the Riverview rule is NEW and mandatory)
The gov properties table carries duplicate clusters (12929 Summerfield
Crossing Blvd, Riverview FL = 127 rows, property_id 16739-23257; likely a
GSA-inventory duplicate class). The importer MUST:
  - match properties by lease_number first (tier-1), then USPS-normalized
    address + state (+ geocode proximity <80m where coords exist);
  - when the match hits a duplicate CLUSTER, attach to the CANONICAL member
    (prefer: has sales > has leases > lowest property_id) — NEVER create a
    new row that joins a cluster;
  - report how many imports touch known-duplicate clusters (feeds the
    merge-lane work, doesn't block the import).
New property stubs: master ADDRESS/CITY/STATE (broker-curated),
address_source='master_curated', lat/lng NULL (the geocode cron picks them up).

PHASE 3 — the insert payload (full master richness, all provenance-tagged)
  sales_transactions: sale_date, sold_price, sold_cap_rate (in-band only;
    out-of-band → exclude_from_market_metrics + note, per band policy),
    firm_term_years_at_sale = FIRM (sign preserved, locked, master_curated),
    rent fields from GROSS/NOI where present, seller/buyer names + Bstate/
    Type2 buyer typing, brokers (L./P. BROKER; is_northmarq via the
    SJC/Briggs/Northmarq regex), lease_number, agency, TYPE (fed/state/local
    — feeds the credit classifier), data_source='gov_master_backfill_r71'.
  available_listings: where ON MARKET present, a real-dated listing row
    (listing_date_source='master_curated', off_market=sale_date, linked via
    sale_transaction_id) — NOTE: these are receipt-dated, so they ALSO deepen
    the new-to-market series honestly for historical years. INITIAL/LAST
    price+cap onto the listing for bid-ask/DOM depth.
  Triggers fire as designed (cap-of-record, credit classification) — assert
    the expected side-effects in the receipts (n new caps, n by credit tier).

PHASE 4 — acceptance (before/after at the standard anchors)
  - cap-by-term inputs per year (the G17 table re-run: expect 2024 27→~68,
    cumulative cap+term toward ~657);
  - cm_gov_cap_by_term_m/_dot cohort values + n at Dec-2025/2024/2022;
  - volume count basis (R68-C deduped events — confirm imports don't
    double-count against existing rows: the tolerant-match class must be 0
    inserts by construction);
  - new-to-market by year (the master-dated listings extend honest history);
  - NM line coverage; credit-tier n by year.

GATES: Phase-1 plan JSON (counts per class + 20-row samples per class) → my
verification (independent tolerant-match sampling, same as r2) → commit in
class order (ATTACH enrichments, then INSERTs; DUP_REVIEW adjudications via
the fingerprint gate as a follow-up batch, not blocking). Idempotent
(re-run-safe on data_source + master row_num linkage). Workstation/psycopg2
channel for the bulk execution if the row volume exceeds the MCP-safe size —
same delivery as the rent backfill.
```
