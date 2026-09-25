# SALE-PROMOTER1 — record the sales Salesforce and CoStar already know about, so sold listings close themselves

Backlog: `LISTING-SALE-PARITY1-sf-promoter`, `LISTING-SALE-PARITY1-stale-volume`. Source: LISTING-SALE-PARITY1 (CC, 2026-09-24); Cowork round 79 verified it live.

## Measured

- LISTING-SALE-PARITY1 is live on both DBs:
  - one verdict (`lcc_listing_sale_verdict`, byte-identical on dia and gov);
  - both directions;
  - daily check `gov_check_listing_sale_parity()` reads `active_listings_with_sale 0`, `open_reviews 7`.
  - Gov active listings are 469 now; dia 437.
  - Lakeland 31007 is closed and linked.
  - Madison WV 15747 stays active on purpose: `on_market_date` 2026-03-24, 4 years after the 2022 sale.
- **11 active listings are sold per Salesforce or the CoStar sidebar, but have no `sales_transactions` row:**
  - gov: Walla Walla 23342, Savannah 16265, Moses Lake 16412, Jasper 16236 (SF); Marathon 3741 (sidebar); Asbury Park 16239 (an excluded owner-user sale);
  - dia: 25570 (SF), Manchester 28981, Bronx 35803, Durham 27823, Kissimmee 37696.
- The only `sf_comp_staging` → sales writer is `gov_promote_nm_comps`, which is Northmarq-internal. Nothing promotes a general market comp.
- **225 stale listings went to the verification lane** (gov 160, dia 65), mostly `listed_over_2y`. Many are 2026 OMs carrying a years-old SF on-market date.

## Ask

1. **One guarded sale promoter per DB, sharing one rule set.** Extend `gov_promote_nm_comps`, or add a sibling if extending would muddy it; read it first. Sources: `sf_comp_staging` and the sidebar-captured `sales_history`. A candidate becomes a sale only with:
   - a sale date **and** at least one of price, buyer or seller, or a recording fact (SIDEBAR-AGENCY-OVERWRITE's "a date alone is not a sale");
   - property identity by id, or by the address matcher with the GOV-AVAIL1 civic guard;
   - no existing sale within ±30 days / same price.
   Non-market sales (owner-user, related party: see Asbury Park) are written with `exclude_from_market_metrics`, or skipped. Say which and why.
2. **Promote the 11 through it, logged and reversible.** The listing triggers then close each one; confirm per listing. Report any the guard refuses, with the reason.
3. **Schedule it** after the SF and sidebar ingests. It's idempotent: a second run writes 0.
4. **Stale rule.** Re-key `listed_over_2y` on the listing's capture date (`first_seen_at`, or the dia equivalent; see `LISTING-SALE-PARITY1-dia-first-seen`) when the on-market date comes from SF and predates capture. Release the wrongly queued rows from verification, logged, and report how many stay queued.

Tests: a date-only candidate is refused; a price+date candidate on a matched property promotes and closes its listing; a duplicate within ±30 days is refused; the promoter is idempotent; the stale rule uses capture date. Each needs a mutation that turns it red.

## Done means

- The backlog rows updated with the evidence (the 11, one by one).
- Migrations in the repos that own each DB.
- Deploy: Railway BOTH services only if LCC code changes.
