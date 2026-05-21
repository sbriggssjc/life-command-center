# LCC Data Integrity & Logical-Consistency Audit

**Date:** 2026-05-20
**Scope:** Discovery pass (read-only) across the three Supabase projects
**Mode:** SELECT-only. No data was mutated, quarantined, or deleted. No crons/edge functions triggered.

| DB | Project ref | Role in this audit |
|----|-------------|--------------------|
| Dialysis_DB (dia) | `zqzrriwuavgrquhisnoa` | Full scan |
| Government (gov) | `scknotsqkcheojiaewwh` | Full scan |
| LCC Opps (control) | `xengecqvemvfknjvbvrq` | **Deliberately spared heavy scans** — the project recently hit connection exhaustion (max_connections=60). Cross-domain reconciliation issues surface in dia/gov, which is where the curated data lives. |

> Cap rates are stored as decimals (`0.0569` = 5.69%). "Cap rate is calculated, not authoritative-as-ingested." Dialysis/gov NNN typically trades **5–8%**; this report flags `>10%` and `<3%` as implausible.

---

## Executive summary

The two curated databases are **referentially sound** (zero FK orphans for sales, listings, leases, or escalations) and several self-healing mechanisms are demonstrably working: dia's lease auto-supersede trigger (0 multi-active leases), the `sale_date NOT NULL` constraint (0 undated dia sales), and dia's close-on-sale listing trigger (0 stale active listings). Address-junk filters are also holding — parsed-garbage OM-header addresses are nearly absent.

The defects that remain cluster into four high-impact themes:

1. **Mass-duplicated placeholder property rows** (DQ-7) — a bulk writer created **hundreds of tenant-less, source-less property records per single address** on *both* DBs. This is the most structurally damaging finding.
2. **Implausible cap rates polluting market metrics** (DQ-1) — gov leaves **458 sales >10%** *inside* its market metrics, and **~30% of the gov `cap_rate_history` sale ledger is >10%**. dia is better-disciplined (high caps excluded) but still counts **55 sub-3% caps**.
3. **Triple-pipeline duplicate sales** (DQ-2) — the same real-world transaction is ingested by CoStar sidebar + CSV import + Excel master and never deduped (≈490 dia / ≈380 gov duplicate-price groups).
4. **Owner-entity dedup gaps** (DQ-5) — ~373 redundant owner records on dia and ~1,349 on gov from casing/punctuation/abbreviation drift. This same drift is the root cause of most apparent ownership-chain "breaks" (DQ-4).

Severity tally: **HIGH** — DQ-1, DQ-2, DQ-5, DQ-7. **MEDIUM** — DQ-3, DQ-4, DQ-9, DQ-10. **LOW** — DQ-6, DQ-8.

---

## DQ-1 — Implausible / impossible cap rates · **HIGH**

**Issue.** Sales (and the gov derived ledger) carry cap rates well outside the 3–10% plausible band. dia's bad caps are mostly *computed* from fragmentary `rent_at_sale` values; gov's are mostly *ingested* `sold_cap_rate` figures with no rent/NOI behind them.

**Counts.**

| Metric | dia | gov |
|--------|-----|-----|
| Sales with a cap rate | 2,206 / 3,847 | 2,982 / 8,815 |
| Cap > 10% (total) | 242 | 517 |
| Cap > 10% **still counted in market metrics** | **0** ✅ | **458** ⚠️ |
| Cap < 3% (>0) total | 58 | 63 |
| Cap < 3% **still counted in market metrics** | **55** ⚠️ | **60** ⚠️ |
| `cap_rate_history` sale events > 10% | n/a | **697 / 2,351 (29.6%)**, avg cap 9.13% |

**Example rows.**

- dia `sale_id 9009`, property 23146 — the known case: a `costar_sidebar` "sale" at **$1.7M → 13.99%**, sitting beside the real `sale_id 223` at **$3.8M → 5.69%**. The bad row *is* flagged `exclude_from_market_metrics=true` (good), but remains in the table.
- dia `sale_id 471`, property 24052 — `$10,610,136` price ÷ `rent_at_sale $2,334` ⇒ **1.04%**. The rent is a fragment (per-SF or a single line item), not the building's rent. Still counted in metrics.
- dia `sale_id 8062`, property 29799 — `costar_sidebar`, `$500,000` price ÷ `$144,431` rent ⇒ **28.9%** (partial-interest or mis-parsed price).
- gov `sale_id 06f17c74…`, property 14194 — `costar_sidebar`, `sold_cap_rate=0.2949` with **NULL rent and NULL NOI** — an ingested number with nothing behind it.
- gov `sale_id 0640245f…` (property_id NULL) — `sjc_track_record_v2`, NOI `$1,347,037` ÷ `$4,553,253` ⇒ **29.6%** (price understated / partial interest).

**Root-cause hypothesis.** Two distinct writers: (a) dia `costar_sidebar` + the cap-rate calculator divide a full sale price by a non-representative `rent_at_sale`, producing both sub-1% and >25% caps; (b) gov ingests broker-quoted/mis-parsed `sold_cap_rate` strings directly without validating against rent/NOI, and — unlike dia — does not set `exclude_from_market_metrics`. The gov `cap_rate_history` triggers faithfully record these bad ingested caps, so ~30% of the derived sale ledger is implausible.

**Recommended remediation (no silent delete).** Add a validation pass that flags `coalesce(calculated_cap_rate, cap_rate/sold_cap_rate) NOT BETWEEN 0.03 AND 0.10` and, where rent/NOI is missing or fragmentary, sets `exclude_from_market_metrics=true` + a `cap_rate_quality='implausible_unverified'` tag rather than deleting. For gov, extend the dia-style exclusion discipline to the 458 high-cap sales currently feeding metrics, and add a `cap_rate_history` quality column so analytics can filter the 697 bad sale events.

---

## DQ-2 — Duplicate sales · **HIGH**

**Issue.** The same real-world transaction is ingested by multiple pipelines and stored as 2–4 separate `sales_transactions` rows at the same price within a short window.

**Counts.**

| Metric | dia | gov |
|--------|-----|-----|
| (property, sold_price) groups with >1 row | 494 | 380 |
| …of those, within a 90-day span | 412 | 357 |
| Rows with NULL sale_date | 0 ✅ | 0 ✅ |

**Example rows.**

- dia property **23772** — **4 rows** of `$1,650,000` between 2024-10-29 and 2024-11-05 (`sale_ids 8648, 9418, 6014, 8644`); sources `costar_sidebar` + Excel (null).
- dia property **29109** — two `$26.9M`/`$26.3M` rows six days apart (`sale_ids 8504, 8506`), both `costar_sidebar`.
- dia property **26288** — `$13,200,000` recorded both 2004-07-01 (`historical_csv_import`) and 2004-07-31 (`costar_sidebar`).
- gov property **16402** — **3 identical NULL-price** sale rows on 2026-04-06 (`sale_ids fa64203b…, 9800360c…, 00197b59…`).

**Root-cause hypothesis.** No cross-source dedup key on `sales_transactions`. CoStar sidebar, `historical_csv_import`, and the Excel master each insert independently; the same deed appears under each source with slightly different dates (month-start vs recorded date). The `array_agg(DISTINCT data_source)` on the duplicate groups repeatedly shows `{costar_sidebar, historical_csv_import, null}` together — the signature of three pipelines writing the same sale.

**Recommended remediation.** Build a dedup view keyed on `(property_id, round(sold_price), date_trunc('month', sale_date))`, pick a survivor by source priority (county/deed > Excel > costar_sidebar), and mark the rest with `transaction_type='duplicate_superseded'` (quarantine, not delete) so cap-rate and volume aggregates can exclude them. Then add a uniqueness guard on future inserts.

---

## DQ-3 — Listings not cleared by a sale · **MEDIUM**

**Issue.** Active listings whose property has a later sale should auto-close. dia is clean; gov misses a handful and also has inconsistent status casing.

**Counts.**

| Metric | dia | gov |
|--------|-----|-----|
| Active (or NULL-status) listings | 414 | 245 |
| Active **with a sale dated after** `listing_date` | **0** ✅ | **5** ⚠️ |
| Distinct `listing_status` spellings | — | `active, Active, orphan, sold, Sold, superseded, under_contract` |

**Example rows.** gov listing `0a9b9dcb…` (property 16402, asking `$8,960,775`, listed 2026-03-31) is still `active` despite three matching sale rows on 2026-04-06 — but each matching sale has **NULL `sold_price`**, so the close-on-sale logic likely declines to act on a price-less "sale." Same pattern for properties 9905, 16254, 16398.

**Root-cause hypothesis.** gov's close-on-sale path is gated on a priced sale; the NULL-price `ownership_change_stub` rows (see DQ-10) satisfy the property-match but not the price condition, so the listing never flips. Compounded by case-sensitive status comparisons (`active` vs `Active`).

**Recommended remediation.** Normalize `listing_status` to a lowercase enum, and let the close-on-sale matcher act on a dated sale even when price is NULL (set `listing_status='sold'`/`off_market` with `off_market_reason='matched_unpriced_sale'`). Re-run the promotion sweep over the 5 flagged listings.

---

## DQ-4 — Sales that don't follow ownership history · **MEDIUM**

**Issue.** Ordering each property's sales by date, the seller of sale *N* should ≈ the buyer of sale *N-1*. A large fraction breaks — but most breaks are name-variant artifacts (DQ-5), not genuine missing transactions.

**Counts** (consecutive same-property sale pairs):

| Metric | dia | gov |
|--------|-----|-----|
| Links checked (both prices present) | 1,355 | 1,408 |
| Chain breaks (prior-buyer ≠ seller, both named) | 361 (27%) | **671 (48%)** |
| Links unverifiable (a buyer/seller name blank) | 817 | 357 |

**Example rows (note these double as DQ-5 evidence).**

- dia property **23146** — prior buyer `Tsoumpas 203 N Carolin GRP LLC` vs seller `Tsoumpas 203 North Carolina Group LLC`: **same entity** (`Carolin`→`Carolina` truncation, `GRP`→`Group`). A *false* break.
- dia property **28534** — `CCI WARRINGTON LLC` vs `Cci Warrington Llc`: casing only.
- dia property **35761** — `KIDNEY REAL ESTATE ASSOC OF ARVADA LLC` vs `Kidney Real Estate Associates Of Arvada`: `Assoc`→`Associates`, suffix dropped.
- dia property **37468** — `Yhp Asset Management LLC` → seller `Kupsch Trust`: a **genuine** discontinuity (an intermediate owner is missing or the buyer was never recorded).

**Root-cause hypothesis.** The break metric is inflated by un-normalized entity names (DQ-5). The residual *true* breaks come from (a) the duplicate-sale rows (DQ-2) injecting out-of-order buyer/seller pairs, and (b) genuinely missing intermediate transfers. The 817/357 unverifiable links reflect sidebar/CSV sales that never captured a counterparty name.

**Recommended remediation.** Fix DQ-5 first (normalize names to a canonical key), then re-run chain validation — the true-break count should drop sharply. For the residual, open `ownership_research_queue`/`pending_updates` items rather than fabricating links.

---

## DQ-5 — Owner / entity dedup gaps · **HIGH**

**Issue.** One legal entity is stored as many `recorded_owners` rows (each with its own UUID) differing only by case, punctuation, suffix, or abbreviation.

**Counts** (normalized = lowercase, strip punctuation + common suffixes/stopwords):

| Metric | dia `recorded_owners` | gov `recorded_owners` |
|--------|-----------------------|------------------------|
| Total rows | 3,504 | 15,155 |
| Near-duplicate clusters | 332 | 1,243 |
| Names absorbed by those clusters | 705 | 2,592 |
| Est. redundant records to merge | ~373 | ~1,349 |

**Example clusters (dia).**

- `B & P Properties Llc` / `B&P Properties Llc` / `B & P Properties LLC` / `B&P Properties LLC` — 4 rows, one entity.
- `Dialysis Clinic Inc.` / `Dialysis Clinic, Inc.` / `Dialysis Clinic LLC` / `Dialysis Clinic Holdings LLC` / `Dialysis Clinic Properties LLC` — 5 rows.
- `Net Lease Alliance` / `…Llc` / `…LLC` / `…, LLC`; `Raas Realty…` (4 casings); `Tams Family` / `Tam's Family LLC` / `Tam'S Family LLC`.

**Root-cause hypothesis.** `normalized_name` (dia) / `canonical_name` (gov) exist but are **not enforced as the merge/upsert key** — each writer (CoStar sidebar, deed records, OM extraction) inserts the raw string it saw, generating a fresh UUID. There is no entity-resolution gate at write time.

**Recommended remediation.** Backfill a strict canonical key (lowercase, strip punctuation + entity suffixes), cluster, and **merge** duplicates into a survivor UUID (repointing `properties`, `sales_transactions`, `ownership_history` FKs) inside a reviewed migration — never silent-delete. Then make the canonical key the upsert conflict target so new variants attach to the existing entity.

---

## DQ-6 — Junk / parsed-garbage addresses · **LOW**

**Issue.** A small number of `properties.address` values are blank, OM-document fragments, or facility names rather than street addresses.

**Counts.**

| Metric | dia (14,776 props) | gov (17,609 props) |
|--------|--------------------|--------------------|
| Blank/empty address | 25 | 32 |
| Contains OM-header / demographic fragment | 2 | 5 |
| No digit (no street number) | 254 | 212 |

**Example rows (dia).** `Unknown Address` (property 10279), `Northern Michigan Hospital`, `Hemodialysis Unit Christiana Hospital`, `Free State Dialysis`, `Dialysis Unit`, `Svmc`. These are CMS/legacy facility *names* placed in the address field, plus a few `…Tbd` placeholders.

**Root-cause hypothesis.** The OM/sidebar junk filters are working well (only 2–5 true OM-header fragments). The no-digit cases come from the CMS/Excel legacy import storing facility names where a street address was unknown. Impact is limited to geocoding/address-matching failures, not metric pollution.

**Recommended remediation.** Route the ~250 no-digit + blank rows per DB to the geocode/address-research queue; replace facility-name "addresses" with the geocoded street address when available, keeping the facility name in `building_name`. Quarantine, don't delete.

---

## DQ-7 — Duplicate property records (mass placeholder duplication) · **HIGH**

**Issue.** Hundreds of `properties` rows share a single street address, carry **no tenant/lease, no source, and no CMS/lease linkage** — a runaway bulk-creation defect present on *both* DBs.

**Counts.**

| Metric | dia | gov |
|--------|-----|-----|
| Duplicate normalized-address groups | 118 | 264 |
| Property rows inside duplicate groups | 2,608 | 7,128 |
| Largest single-address bucket | **237** | **173** |

**Example rows.**

- dia — **237 rows** for `380 N Dupree St`, TN; property_id range **40059–43553**; **0** distinct `medicare_id`, **0** with a `source`, **0** tenants. Seven more buckets of ~178–236 rows each (`2443 Monarch Dr` TX, `3710 Fm 1889` TX, `1540 W Covina Pkwy` CA, `3905 Wheeling Ave` IN, `401 Whitmer St` KY, `923 S Broadway` TN, `4419 Utica St` LA).
- gov — **173 rows** for `3800 Charlotte Ave`, TN (0 leases, 1 agency); plus `1607 N Lincoln St` IA (165), `277 Looney Rd` OH (164), `2776 US-51` MS (164), `1050 W 15th St` FL (163), `101 Ranch Dr` WY (162).

**Root-cause hypothesis.** A bulk property-creation writer (the dia and gov platforms share architecture, and the symptom is identical on both) inserted large blocks of placeholder property rows against a small set of seed/sentinel addresses without deduping against existing `(normalized_address, state)`. The contiguous id range, total absence of `source`/`medicare_id`/`tenant`/`lease`, and the suspiciously round per-address counts all point to a backfill/test loop or a fan-out bug rather than organic data. **This is the single most damaging finding** — it inflates property counts, corrupts any per-property aggregate, and creates thousands of phantom comp candidates.

**Recommended remediation.** Do **not** delete blind. First confirm provenance (query the full id ranges, `created_at`, and any batch/run marker). Then, for each address bucket, keep the one row with real linkage (tenant/lease/CMS/source) if it exists, mark the rest `domain_classification_flag='duplicate_placeholder'` and exclude from linking/metrics, and repoint any child rows to the survivor. Escalate to whoever owns the property-creation writer to find and disable the fan-out path before re-running.

---

## DQ-8 — Lease logic gaps · **LOW**

**Issue.** Simultaneously-active leases, missing dates, or impossible date order.

**Counts.**

| Metric | dia | gov |
|--------|-----|-----|
| Total leases | 12,322 | 16,394 |
| Active leases | 6,577 | 300 |
| Properties with >1 active lease | **0** ✅ | 11 ⚠️ |
| Active leases with no dates | **0** ✅ | 0 ✅ |
| Expiration < commencement | 1 | 0 |
| Occupied/≥99% with no active lease | 307 | — |
| Sale dated before current lease commencement | 1,267 (mostly benign) | — |

**Root-cause hypothesis.** dia's `auto_supersede_expired_leases` trigger is clearly working (0 multi-active, 0 date-less). gov has 11 properties with overlapping active leases the supersede logic didn't resolve (likely overlapping terms needing human review). The 1,267 dia "sale-before-commencement" rows are largely legitimate (an older sale, then a newer lease) and should be treated as a soft signal, not an error. The single dia `expiration < commencement` lease is a genuine data-entry inversion.

**Recommended remediation.** Surface the 11 gov overlaps and the 1 dia inverted lease in the existing `v_data_quality_issues` triage view for manual resolution. Investigate the 307 "occupied, no active lease" dia properties as a lease-coverage gap (likely missing lease ingestion, not bad data).

---

## DQ-9 — Orphans & broken references · **MEDIUM**

**Issue.** Child rows pointing at non-existent parents, and rows missing the dates that make them temporally meaningful.

**Counts.**

| Metric | dia | gov |
|--------|-----|-----|
| Sales → missing property (FK orphan) | 0 ✅ | 0 ✅ |
| Listings / leases / escalations FK orphans | 0 / 0 / 0 ✅ | 0 / 0 / 0 ✅ |
| Sales with NULL `property_id` (unlinkable) | 0 | **415** ⚠️ |
| `ownership_history` rows with no dates | **1,563** (NULL start+end) | **5,445** (NULL `transfer_date`) |

**Example/root-cause.** Referential integrity is intact on both DBs — no dangling FKs. The real problem is *temporal* nullness: gov has 415 sales that never matched a property (CoStar/track-record rows captured without a `property_id`), and both DBs carry thousands of `ownership_history` rows with no date, which makes them useless for chain ordering (and partly explains DQ-4's unverifiable links).

**Recommended remediation.** Route the 415 NULL-`property_id` gov sales to the matcher/`pending_updates` queue. For undated `ownership_history`, attempt to backfill `transfer_date`/`start_date` from the linked `sale_id`/`matched_sale_id`; where no date is recoverable, tag `research_status='undated_unusable'` and exclude from chain logic rather than deleting.

---

## DQ-10 — Price / figure sanity · **MEDIUM**

**Issue.** Sales lacking a price, or with implausible per-SF figures.

**Counts.**

| Metric | dia | gov |
|--------|-----|-----|
| Sales with NULL `sold_price` | 0 | **5,423** ⚠️ |
| Sold price < $50k | 0 | 0 |
| Sold price > $200M | 0 | — |
| Sold price PSF > $2,000 | n/a | 7 |
| Sale price == listing asking price (exact) | — | 0 |

**Breakdown of gov NULL-price sales by source:** `ownership_change_stub` 2,940 · `costar_sidebar` 1,784 · `ownership_change_stub_spe_rename` 373 · `costar_export` 188 · `excel_master` 133 · misc 5.

**Root-cause hypothesis.** ~3,300 of the gov price-less rows are intentional `ownership_change_stub` records (GSA lease-event-derived ownership transfers that legitimately have no price) — but they live in `sales_transactions` and masquerade as sales, which is what keeps listings open in DQ-3 and dilutes the sales table. The 1,784 `costar_sidebar` price-less rows are more concerning: real sale captures missing the price. The 7 PSF>$2,000 rows are mis-parsed price or SF.

**Recommended remediation.** Move `ownership_change_stub*` rows to a dedicated `ownership_events` concept (or tag `transaction_type='ownership_stub'` + `exclude_from_market_metrics=true`) so they stop counting as sales. Queue the 1,784 price-less sidebar sales for price research. Inspect the 7 PSF outliers for price/SF transposition.

---

## Prioritized punch list

| # | Finding | DB(s) | Severity | First action |
|---|---------|-------|----------|--------------|
| 1 | **DQ-7** Mass-duplicated placeholder property rows (237/address dia, 173/address gov; ~2.6k/7.1k rows) | dia + gov | HIGH | Confirm provenance of id ranges, disable the runaway property-creation writer, then quarantine duplicates to a survivor. |
| 2 | **DQ-1** 458 gov sales >10% counted in metrics + 30% of gov cap_rate_history implausible; 55 dia sub-3% counted | gov + dia | HIGH | Extend `exclude_from_market_metrics` discipline + cap-rate validation band to gov; re-tag dia sub-3% rows. |
| 3 | **DQ-2** Triple-pipeline duplicate sales (~490 dia / ~380 gov groups) | dia + gov | HIGH | Build dedup view + survivor selection; add insert-time uniqueness guard. |
| 4 | **DQ-5** Owner dedup gaps (~373 dia / ~1,349 gov redundant) | dia + gov | HIGH | Enforce canonical-name upsert key; merge clusters in a reviewed migration. |
| 5 | **DQ-4** Ownership-chain breaks (27% dia / 48% gov) | dia + gov | MED | Re-run after DQ-5 fix; queue residual true breaks. |
| 6 | **DQ-10** 5,423 gov NULL-price "sales" (mostly ownership stubs) | gov | MED | Re-class `ownership_change_stub*` out of sales; research the 1,784 sidebar price-less rows. |
| 7 | **DQ-9** 415 unlinkable gov sales; 1.5k/5.4k undated ownership_history rows | dia + gov | MED | Send to matcher / backfill dates from linked sales. |
| 8 | **DQ-3** 5 gov listings not closed + status casing inconsistency | gov | MED | Normalize status enum; allow close-on-unpriced-sale. |
| 9 | **DQ-6** ~250/DB no-street-number addresses (facility names) | dia + gov | LOW | Route to geocode/address queue. |
| 10 | **DQ-8** 11 gov multi-active leases; 1 dia inverted lease; 307 dia occupied-no-lease | dia + gov | LOW | Surface in `v_data_quality_issues` for manual review. |

**What's already healthy (no action):** FK referential integrity (0 orphans both DBs); dia lease auto-supersede (0 multi-active); dia `sale_date NOT NULL` (0 undated sales); dia close-on-sale listing trigger (0 stale); OM-header address junk filters (2–5 hits only).

---

*Discovery pass only — every count and example above was produced by read-only SELECT queries. No remediation has been performed. Per the operating brief, I will not run any database-writing follow-up (quarantine, normalize, merge, re-class) without your go-ahead.*
