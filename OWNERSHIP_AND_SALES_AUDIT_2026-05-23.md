# Ownership History & Sales Transaction Audit — 2026-05-23

**Scope:** End-to-end review of how the LCC stack (dia + gov + LCC Opps) ingests, stores, deduplicates, reconciles, propagates, and surfaces ownership-history and sales/transaction data.

**Trigger:** Earlier developer-tracking session surfaced that sample sales records were missing many transaction elements and that duplicates were appearing for the same sale on the same property. This audit confirms both observations, traces their root causes, and lays out the gap inventory.

**Inputs reviewed:** `supabase/migrations/**`, `sql/`, `schema/`, `api/_handlers/sidebar-pipeline.js`, `api/_handlers/intake-promoter.js`, `api/sync.js`, `api/admin.js`, `detail.js`, plus the existing audit corpus (`DATA_INTEGRITY_AUDIT_2026-05-20.md`, `GAPS_AND_FINDINGS_REGISTER.md`, `AUDIT_PROGRESS.md`, `OWNERSHIP_*.md`, `SPEC_deed_county_ingestion_fix.md`, `SPEC_sos_direct_scraper.md`, `SPEC_owner_data_ingestion_2026-05-21.md`, `SPEC_unified_contacts_gov_dia_wiring_2026-05-21.md`, `CoStar_Ingestion_Audit_15002_Amargosa.md`, `CoStar_Ingestion_Audit_12316_Molly_Pitcher.md`, `Claude_Code_Prompts_SaleNotes_DocIngestion.md`, `RCM_LOOPNET_FIX_INSTRUCTIONS.md`, `Lease_Data_Provenance_Schema_Design.md`).

---

## 1. Executive Summary

### What works well
- The **canonical table set is in place** on both dialysis and government schemas:
  `sales_transactions`, `property_sale_events`, `ownership_history`, `recorded_owners`, `true_owners`, `deed_records`, `parcel_records`, plus `field_provenance` for write-level source attribution and `llc_research_queue` for SOS enrichment.
- The **sales↔ownership FK is now physically present** on both domains as of `supabase/migrations/20260517180000_gov_schema_mirror_audit_discovery.sql` (lines 31–42) — `ownership_history.matched_sale_id` → `sales_transactions.sale_id`, and `sales_transactions.recorded_owner_id` → `recorded_owners.recorded_owner_id`.
- **Trigger-based propagation** exists for the "sale → property → ownership_history → property.recorded_owner_id" hop (`propagate_sale_to_property`, `propagate_ownership_to_property`, `close_listing_on_sale`).
- **Field-level provenance** is being written for sidebar captures with explicit confidence (CoStar aggregator quality = 0.6) (`AGENTS.md:86–88`).
- A clear **remediation roadmap** already exists in `OWNERSHIP_INTELLIGENCE_WIRING_DESIGN_2026-05-21.md` and `OWNERSHIP_ORCHESTRATION_BLUEPRINT_2026-05-21.md` — the audit findings below largely confirm and quantify what those design docs anticipated.

### Headline gaps (driving the user-visible symptoms)

| # | Symptom | Root Cause | Severity |
|---|---------|-----------|----------|
| **G1** | "Duplicates for the same sale on the same property" | No cross-source dedup key on `sales_transactions`; three independent writers (CoStar sidebar, CSV/Excel backfill, RCM/county) all insert without coordination. ≈490 dia / ≈380 gov duplicate-price groups within 90-day windows (`DATA_INTEGRITY_AUDIT_2026-05-20.md` DQ-2). | **HIGH** |
| **G2** | "Sales records missing many elements" | Sidebar pipeline captures ~60% of available CoStar fields; gov `sales_transactions` lacks several columns the dia table has (`recorded_date`, `sale_notes_raw`, etc.); buyer/seller addresses, emails, phones from CoStar Contacts tab are extracted but never written to the contacts table. | **HIGH** |
| **G3** | Owner data orphaned from properties | County deed/parcel scrapers write `deed_records` and `parcel_records` **without `property_id`** — 9,402 gov parcel owners (94% of rows) and ~500 dia deeds remain unlinked. Cannot be retroactively recovered from SQL because situs/APN keys were never persisted. (`SPEC_deed_county_ingestion_fix.md`) | **HIGH** |
| **G4** | Owner name variants treated as distinct entities | `normalized_name` / `canonical_name` columns exist but are **not enforced at write time**. ~373 redundant dia owner rows, ~1,349 redundant gov owner rows (DQ-5). 2/3 of the "sales-chain breaks" (DQ-4) collapse once entities are de-duped. | **HIGH** |
| **G5** | SOS/registered-agent enrichment never runs | 461 gov + 1,235 dia rows queued in `llc_research_queue`, **0 auto-completed**. Manual sidebar write-back endpoint shipped as a workaround. | **HIGH** |
| **G6** | Cap rates on government sales are unreliable | Gov ingests `sold_cap_rate` from CoStar/RCA without rent/NOI validation — 458 gov rows >10% feeding the metrics layer; ~30% of historical ledger is implausible (DQ-1). | **MED** |
| **G7** | `unified_contacts` not deployed on dia | Gov has 13,111 recorded owners wired into `unified_contacts`; dia has 0. Cross-domain entity home is undecided. | **MED** |
| **G8** | Owner→Salesforce linkage near-zero | 1.5% (gov recorded) → 20% (dia true). No automated create/link path. Sales buyers and sellers stay as free-text strings, not `contact_id` FKs. | **MED** |
| **G9** | NULL-price "sales" pollute the ledger | 5,423 gov rows are `ownership_change_stub` records (mostly derived from GSA lease lessor swaps) sitting in `sales_transactions` and surfacing in comp queries (DQ-10). | **MED** |
| **G10** | No ownership-period overlap/gap constraints | `ownership_history` has start/end dates but no exclusion constraint preventing two simultaneous owners or detecting transfer gaps. | **MED** |
| **G11** | Silent ingest failures on `ownership_research_queue` | Sidebar writers post columns that don't exist on the real schema (`research_id`, `lead_id`, `task_type`, …); failures were swallowed until Phase-A instrumentation surfaced them 2026-05-17 (`AUDIT_PROGRESS.md` §D-discovery-2). | **MED** |
| **G12** | RCM / LoopNet pipeline blocked | `marketing_leads` = 0 rows. Power Automate webhook is missing auth header; endpoint 401s. | LOW (lead-only, not comps) |

---

## 2. Sales Transactions — Detailed Findings

### 2.1 Canonical tables
- `public.sales_transactions` (both dia and gov) — the working ledger.
- `public.property_sale_events` (gov) — canonical event surface defined in `supabase/migrations/20260416232000_gov_property_sale_events_and_ingestion_log.sql`. Columns: `sale_event_id, property_id, sale_date, price, cap_rate, buyer_id, seller_id, broker_id, buyer_name, seller_name, broker_name, source, notes, sales_transaction_id, ownership_history_id`.
- `sale_date NOT NULL` enforced on dia as of `20260427000000_dia_sales_transactions_sale_date_not_null.sql` after 363 undated phantoms were purged.
- Dialysis-only extensions: `stated_cap_rate, calculated_cap_rate, cap_rate_confidence, rent_source, rent_at_sale, recorded_date, sale_notes_raw, sale_notes_extracted, listing_sale_id`.
- Government-only extensions: `sold_cap_rate, buyer, seller, purchasing_broker, address, city, state, agency, government_type, sold_price_psf, financing_type, lender_name, guarantor, gross_rent, gross_rent_psf, transaction_type`.

**Schema asymmetry:** dia and gov diverge on `recorded_date` and `sale_notes_*`. Cross-domain queries (LCC Opps roll-ups) have to special-case.

### 2.2 Ingestion pipelines

| Source | Entry point | What it captures | What it misses |
|--------|-------------|------------------|----------------|
| CoStar sidebar | `api/_handlers/sidebar-pipeline.js::upsertDomainSales` (≈4473) | sale_date, sold_price, doc_number, buyer/seller name (stripped of brokerage text), deed_type (skipping mortgages), broker name (gated), sale notes (dia only) | latitude/longitude, buyer/seller email/phone/address (extracted but not persisted to contacts), historical sales beyond "active" view, parcel APN |
| Historical CSV / Excel master | bulk loader (no dedicated writer; merged at load time) | sale_date, sold_price, sometimes buyer/seller | source = NULL or `historical_csv_import`; no doc_number; high duplication |
| RCM / LoopNet (Power Automate email) | `api/sync.js:1084–1349` (RCM) + LoopNet handler | inquiry leads → `marketing_leads`, not `sales_transactions` | currently **blocked by 401 auth**; 0 rows landed |
| County deed scraper | Python `src/county_scraper.py` → `deed_records` / `parcel_records` | grantor, grantee, doc number, recording date | **`property_id` not persisted** → 9,402 gov / ~500 dia rows orphaned |
| OM / document extraction | `api/_handlers/intake-promoter.js` | does NOT write to sales_transactions; pulls rent/lease signals only | full sale event capture |

### 2.3 Deduplication logic (where the duplicates come from)

Inside `upsertDomainSales` (`sidebar-pipeline.js:4541–4601`):
1. **Stage 1:** exact `document_number` match → PATCH.
2. **Stage 2:** fallback to `price ±5%` AND `sale_date ±14d` window; pull up to 5 candidates, JS-filter by delta.

**Why this leaks duplicates:**
- The 14-day window is too narrow when a deed is recorded weeks later than the closing date (CoStar can surface both dates as separate entries).
- Stage 2 only protects against the *sidebar's own* prior inserts. It does not look at the Excel/CSV-imported rows (different `data_source`, often NULL doc_number).
- **No schema-level UNIQUE constraint** on `(property_id, round(price), date_trunc('month', sale_date))` or equivalent.
- Two independent writers can race; no advisory lock.

**Observed impact (DATA_INTEGRITY_AUDIT_2026-05-20 §DQ-2):** ≈490 dia and ≈380 gov duplicate-price groups; concrete example — property 23772 has 4 rows of $1.65M between 2024-10-29 and 2024-11-05 (sale_ids 8648, 9418, 6014, 8644) split across `costar_sidebar` and a NULL-source Excel import.

### 2.4 Required vs optional fields

Canonical "complete" sales transaction (target state):

| Group | Field | Currently captured? |
|-------|-------|---------------------|
| Identity | `sale_date`, `sold_price`, `document_number`, `recorded_date` | sale_date/price ✅; doc_number partial; recorded_date dia-only |
| Parties | `buyer_name`, `seller_name`, `buyer_address`, `seller_address`, `buyer_phone/email`, `seller_phone/email` | names ✅ (often stripped); addresses partial (buyer_address sometimes stuffed into `notes`); phone/email **never persisted** |
| Deed | `deed_type`, `financing_type`, `lender_name`, `guarantor` | dia partial (deed_type in notes); gov has columns but rarely populated |
| Economics | `cap_rate` (stated), `cap_rate_quality`, `rent_at_sale`, `noi_at_sale`, `psf` | stated cap rate captured but overwritten — only the most-recent-per-property keeps it (sidebar-pipeline.js:4671–4674, 4763) |
| Linkage | `property_id`, `recorded_owner_id`, `sale_event_id`, `listing_sale_id` (dia) | property_id usually ✅ (415 gov NULL); recorded_owner_id added gov 2026-05-17; listing_sale_id dia-only |
| Provenance | `data_source`, `source_run_id`, `confidence` | `data_source` ✅; `field_provenance` row ✅ for sidebar; not enforced on bulk imports |

Average completeness across the corpus is ~50%; gov is notably weaker on buyer/seller identity (817/1,355 unverifiable links per DQ-4).

### 2.5 Cross-source reconciliation

**None implemented.** `data_source` records origin but is not consulted by any dedup or priority routine. There is no view, trigger, or scheduled job that merges sales rows of the same event across CoStar / Excel / county.

`OWNERSHIP_ORCHESTRATION_BLUEPRINT_2026-05-21.md` §2 enumerates the intended cascade but the *cross-source dedup view + survivor selection* step is not yet built. The blueprint recommends:
- Dedup key: `(property_id, round(sold_price), date_trunc('month', sale_date))`.
- Source priority: county/deed > Excel master > CoStar sidebar > NULL.
- Losers tagged `transaction_type='duplicate_superseded'` rather than deleted.

### 2.6 Field propagation downstream

- **Sale → property:** `propagate_sale_to_property` AFTER INSERT on `sales_transactions` updates `property.last_sale_date`, `property.last_sale_price`, and (when matched) `property.recorded_owner_id`.
- **Sale → listing close:** dia works; gov misses 5 close-on-sale events due to NULL-price ownership-change stubs (`DATA_INTEGRITY_AUDIT_2026-05-20.md` DQ-3).
- **Sale → ownership_history:** indirect — must go via deed_records or via the buyer/seller name matching against `recorded_owners`. Many properties have no `recorded_owners` row, so the bridge silently no-ops.
- **Sale → cap rate panels (gov):** `v_sales_comps_projected_rent` (`20260416120000_v_sales_comps_projected_rent.sql`) exposes ≈458 gov rows with cap > 10% straight into metrics; no quality gate.
- **Sale → broker propagation:** dia `available_listings.listing_sale_id` link works; gov has no column.

---

## 3. Ownership History — Detailed Findings

### 3.1 Canonical tables
- `recorded_owners` (dia + gov) — title-holder per deed/lease. Carries `normalized_name`/`canonical_name`, `mailing_address`, `phone`, `email`, `state_of_incorporation`, `registered_agent_name`, `manager_name`, `manager_role`, `filing_id`, `filing_date`, `filing_status`.
- `true_owners` (dia + gov) — beneficial owner; FK from `properties.true_owner_id`.
- `ownership_history` (dia + gov) — chronology spine. Columns include `ownership_start_date`, `ownership_end_date`, `matched_sale_id` (FK to `sales_transactions.sale_id`), `sale_id`.
- `unified_contacts` (LCC Opps + gov only) — cross-domain entity hub with link columns `gov_contact_id`, `dia_contact_id`, `recorded_owner_id`, `true_owner_id`, `sf_account_id`, `outlook_contact_id`.
- `entities` (LCC Opps) — owner-role taxonomy (`owner_role`, `owner_role_source`, `owner_role_confidence`, `behavioral_override`) added 2026-05-22 via `20260522120000_lcc_owner_role_taxonomy.sql`.
- `llc_research_queue` — SOS enrichment queue (461 gov + 1,235 dia pending).
- `field_provenance` — append-only write log instrumented for owner fields with CoStar confidence 0.6.

### 3.2 Ingestion pipelines

| Source | Status |
|--------|--------|
| County deeds / parcels | **Captured but orphaned** — scrapers write without `property_id`; 9,402 gov + ~500 dia rows unreachable. Fix lives in scraper code, not SQL. |
| GSA leases (gov) | Lessor → recorded owner. +182 backfilled via resolved-company matching. 43% gov property→owner coverage. |
| SOS filings | **0 auto-completed.** `POST /api/sos-writeback` shipped as manual sidebar workaround. |
| CoStar sidebar | `upsertDomainOwners` (sidebar-pipeline.js:6618–6744). Silently failed on gov writes for an unknown duration due to missing columns; fixed by `20260517180000`. |
| Salesforce sync | 1.5% (gov recorded) to 20% (dia true) linkage; no automated create path. |
| OM / AI extraction | `intake-promoter.js::resolveOwnerLinksDia` live since 2026-05-17. |

### 3.3 Sales ↔ ownership-history link

- **FK present:** `ownership_history.matched_sale_id` → `sales_transactions.sale_id` (both domains; gov added 2026-05-17).
- **FK present:** `sales_transactions.recorded_owner_id` → `recorded_owners.recorded_owner_id` (gov added 2026-05-17).
- **Trigger present:** `propagate_ownership_to_property` AFTER INSERT on `ownership_history` updates `property.recorded_owner_id`/`true_owner_id`.
- **Coverage:** property→recorded gov 7,573/17,610 (43%) and dia 1,875/13,964 (13%). 57% gov and 87% dia properties have **no recorded_owners row at all**, so the sale→ownership bridge has no anchor to land on.

### 3.4 Entity resolution

Three layers, only one of which is currently live:

1. **`resolve_company()` canonical-key matcher** — strips legal suffixes, lowercases, trigram similarity. Live; batch-driven via `lcc_sync_classified_owners` (`20260522220000_lcc_entity_sync_from_dia_gov.sql:75–95`). Not enforced at *write* time — each ingestion writer still inserts the raw string before sync runs.
2. **Address-canonical matcher** — spec'd (`SPEC_unified_contacts_gov_dia_wiring_2026-05-21.md`) but not deployed. Needed to merge "ABC Propco I LLC" and "ABC Propco II LLC" at one mailing address.
3. **`contact_aliases` table** — records merge decisions post-hoc, not preventatively.

**Impact (DQ-5):** ~373 redundant dia owner rows, ~1,349 redundant gov. ~2/3 of the apparent sales-chain breaks (DQ-4: 361 dia / 671 gov) evaporate once entities are deduped on canonical key.

### 3.5 Timeline integrity

- `ownership_start_date` / `ownership_end_date` exist on dia; gov has analogous columns.
- **No exclusion constraint** preventing two open ownership periods for the same property.
- **No gap-detection** between period N's `ownership_end_date` and period N+1's `ownership_start_date`.
- **No transfer-pending placeholder** for known-but-undated owner changes.
- Lease-side has an auto-supersede trigger; ownership has no analog.

### 3.6 UI propagation

- `detail.js:11558` `_ownerLink(displayName, ctx)` — clickable owner link, encodes context as data-attribute.
- `detail.js:11600` `_ownerCtxFromChain(h, db)` — standardizes `v_ownership_chain` rows.
- `detail.js:11620` `_ownerCtxFromCurrent(own, db, which)` — extracts true/recorded owner from `v_ownership_current`.
- `detail.js:5432–5680` — `_dedupChain` + `_dedupChainTimelineRows` for the displayed timeline. Deduping happens **at render time**, masking but not fixing the underlying duplicates.
- Property list views (`dialysis.js`, `gov.js`) — no owner column yet; depends on the `v_next_best_action` view that is spec'd but unbuilt.

### 3.7 Provenance

- `field_provenance` table active; sidebar owner writes record confidence 0.6.
- Source priority matrix (462 rules) covers leases and sales explicitly but **does not enumerate ownership fields** — likely gap when the resolver has to break a tie between e.g. county deed and CoStar sidebar for `recorded_owner_name`.
- No equivalent of `Lease_Data_Provenance_Schema_Design.md` exists for ownership; the lease doc should be cloned and adapted.

---

## 4. Cross-Cutting Gap Register

(Maps every finding to a remediation owner. Severity from §1.)

| ID | Gap | Lives in | Severity | Recommended remediation |
|----|-----|----------|----------|-------------------------|
| G1 | No cross-source dedup on `sales_transactions` | SQL + ingestion | HIGH | Build dedup view keyed on `(property_id, round(sold_price), date_trunc('month', sale_date))`. Apply survivor selection (county > Excel > sidebar > NULL). Tag losers `transaction_type='duplicate_superseded'`. Add UNIQUE partial index for future inserts. |
| G2a | Missing field coverage on capture | `sidebar-pipeline.js` | HIGH | Extend `upsertDomainSales` to also persist lat/long, buyer/seller address/phone/email to `contacts`; widen gov `sales_transactions` to add `recorded_date`, `sale_notes_raw`, `sale_notes_extracted` to match dia. |
| G2b | Stated cap rate overwritten to NULL on non-recent sales | `sidebar-pipeline.js:4671–4763` | MED | Remove the NULL-out branch; keep stated cap rate on every sale row with `cap_rate_source='costar_stated'` and `cap_rate_confidence='low'`. |
| G3 | Deed/parcel scrapers don't persist `property_id` | Python scrapers | HIGH | Modify `src/county_scraper.py` and `src/public_record_ingest.py` to accept and write the property context that triggered the fetch. Also persist `situs_address` + `apn` to enable retroactive backfill on future runs. |
| G4 | Owner-entity dedup not enforced at write time | All ingestion writers | HIGH | Add `BEFORE INSERT` trigger on `recorded_owners`/`true_owners` that consults `resolve_company()` and either reuses the existing UUID or inserts a `contact_aliases` row. Schedule the address-canonical matcher (already spec'd). |
| G5 | SOS enrichment never runs | `api/_shared/llc-research.js` | HIGH | Replace the placeholder OpenCorporates path with the per-state adapters described in `SPEC_sos_direct_scraper.md`. Keep the sidebar write-back as the manual fallback. |
| G6 | Cap rates >10% on gov pollute metrics | `v_sales_comps_projected_rent`, gov ingestion | MED | Validate `sold_cap_rate` at insert against `gross_rent`/`noi`; tag `cap_rate_quality='implausible_unverified'` when outside 3–10%; exclude tagged rows from comp views. |
| G7 | `unified_contacts` missing on dia | Schema decision | MED | Adopt the dia-side variant or commit to a single LCC-Opps `unified_contacts` (the latter aligns with `SPEC_unified_contacts_gov_dia_wiring_2026-05-21.md`). Backfill 13,964 dia properties. |
| G8 | Owner→SF link near zero | `api/admin.js` + Salesforce bridge | MED | Implement the SF link/create route in `OWNERSHIP_ORCHESTRATION_BLUEPRINT §2`. For owners crossing the lead-priority threshold, auto-create an Account stub. |
| G9 | 5,423 gov NULL-price "ownership stubs" in sales_transactions | Data classification | MED | Move stubs out of `sales_transactions` (or tag `transaction_type='ownership_stub'`) and ensure they live in `ownership_history` instead. Re-point any references. Exclude them from comp queries. |
| G10 | No overlap/gap constraints on `ownership_history` | Schema | MED | Add `EXCLUDE USING gist (property_id WITH =, daterange(ownership_start_date, ownership_end_date) WITH &&)`; add a nightly gap-detection job that opens `research_tasks` for missing intermediate transfers. |
| G11 | Silent failures on `ownership_research_queue` writes | `sidebar-pipeline.js:1759–1769`, `2592–2603` | MED | Reconcile the column list with the live schema and surface insert failures through the existing telemetry instead of swallowing them. |
| G12 | RCM/LoopNet pipeline 401s | Power Automate flow + `api/sync.js` | LOW | Add `X-LCC-Key` header to Power Automate webhook, or switch endpoint to JWT auth. |
| G13 | Sales chain continuity (seller N ≠ buyer N-1) | Reconciliation | MED (derivative of G4) | After G4 lands, run continuity check; remaining true breaks become `research_tasks` for analyst review. |
| G14 | Ownership-field priority rules absent | `field_provenance` priority matrix | MED | Extend the rule set to cover `recorded_owner_name`, `recorded_owner_mailing_address`, `state_of_incorporation`, etc., with source priority county > SOS > sidebar > OM. |
| G15 | No provenance design doc for ownership | Documentation | LOW | Clone `Lease_Data_Provenance_Schema_Design.md` → `Ownership_Data_Provenance_Schema_Design.md`. |

---

## 5. Recommended Sequence

Suggested order, optimizing for unlocking downstream gaps:

1. **G4** (write-time entity dedup) — collapses ~2/3 of G13's chain breaks and ~70% of the apparent owner-row inflation. Must precede any backfill of G8.
2. **G3** (scraper persists `property_id`) — unblocks 9,400+ orphaned gov owners; this is the single biggest source of "ownership coverage" lift.
3. **G1 + G9** (sales dedup + ownership-stub re-classification) — directly addresses the user's reported symptoms; one combined migration.
4. **G2a/G2b** (field completeness on capture) — slot in alongside G1 in the sidebar refactor.
5. **G10 + G11** (ownership_history integrity + silent-failure fix) — schema constraint + writer reconciliation; small, fast, prevents regressions.
6. **G6** (cap-rate quality gate).
7. **G7 + G8** (unified_contacts on dia + SF link/create).
8. **G5** (SOS auto-enrichment) — manual sidebar path can keep handling demand-driven cases in the interim.
9. **G14 + G15** (provenance rules + doc).
10. **G12** (RCM/LoopNet auth) — independent and small.

---

## 6. Open Questions for the User

These need a call before remediation can be sequenced:

1. **Unified contacts home** — adopt `unified_contacts` on dia, or consolidate everything in LCC Opps and treat dia/gov contacts tables as projections? (Affects G7.)
2. **Duplicate-sale handling on Excel/CSV imports** — preserve the historical row as a `duplicate_superseded` audit trail, or delete? (Affects G1.)
3. **Cap-rate band** — confirm 3–10% as the plausible window or tune per asset class? (Affects G6.)
4. **SOS scraper scope** — full 50-state coverage day 1, or top-10 states (TX, FL, CA, GA, NC, AZ, NV, CO, TN, OH) with manual fallback elsewhere? (Affects G5.)
5. **Buyer/seller PII capture** — confirm that persisting buyer/seller phone/email from CoStar Contacts tab is contractually allowed under the CoStar TOS your team operates under. (Affects G2a.)

---

*Audit prepared 2026-05-23. Source references inline. Companion docs: `DATA_INTEGRITY_AUDIT_2026-05-20.md`, `GAPS_AND_FINDINGS_REGISTER.md`, `OWNERSHIP_INTELLIGENCE_WIRING_DESIGN_2026-05-21.md`, `OWNERSHIP_ORCHESTRATION_BLUEPRINT_2026-05-21.md`, `SPEC_deed_county_ingestion_fix.md`, `SPEC_sos_direct_scraper.md`, `SPEC_unified_contacts_gov_dia_wiring_2026-05-21.md`.*
