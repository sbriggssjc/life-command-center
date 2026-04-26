# Data Quality Self-Learning Loop — Architecture & Rollout Plan

> Origin: 2026-04-25 audit session. The Hondo (US Renal Care, property_id=29237) end-to-end test surfaced that:
> 1. Different ingestion sources (PA email, sidebar OM, CoStar sidebar, county records, CMS chain reporting) overwrite each other instead of merging.
> 2. Junk strings (NAICS sector names, OM table-of-contents headers like "Loan", "Financials", "Changes") leaked through tenant-name filters.
> 3. There's no centralized place to ask "where did this value come from, and how confident are we?"
>
> This doc is the multi-PR rollout plan. Phase 1 is shipped; phases 2-4 are scoped but not implemented.

## Goals

- **Field-level provenance.** Every cell in a curated table (`properties`, `leases`, `available_listings`, `contacts`, etc.) knows its source, its confidence, when it was written, and which ingestion run produced it.
- **Per-field source priority.** Per the user's spec: "I don't think we can call any one table having a source that prioritizes one v another. It needs to be field level." County records beat OM extraction for `address`, but OM/lease beats CoStar for `rent`. Different fields, different rankings.
- **Merge, not overwrite.** Two OMs from different channels on the same property should combine — newer fields fill blanks, conflicts surface for review, and lower-priority sources can't clobber higher-priority ones.
- **Self-cleaning.** Downstream ownership resolution, lookup, and linking trigger automatically when the new highest-confidence value lands.
- **Self-learning.** Track which sources turn out to be right (a sale closes at the OM-stated price; a lease renews at the OM-stated rent) and adjust source priorities automatically over time.

## Current state (2026-04-25, this session)

What already exists in the codebase:

- `properties.anchor_rent_source` — values like `lease_confirmed`, `om_confirmed`, `costar_stated`, `manual_entry`. First-class column.
- `sales_transactions.rent_source`, `cap_rate_confidence` — same pattern.
- `available_listings.listing_source`, `intake_artifact_path`, `intake_artifact_type`, `cap_rate_method`, `cap_rate_notes`.
- `leases.data_source`, `lease_rent_schedule.source_confidence` (`documented` / `estimated` / `inferred`).
- `contacts.data_source` plus a JS-side `FIELD_PRIORITY` map in `api/_handlers/contacts-handler.js` (handles email/phone/title/company per source).
- `staged_intake_matches.confidence` (numeric 0-1) + `matcher_accuracy_stats` rolled up nightly via `compute_matcher_accuracy()`. The matcher already has a feedback loop.
- `data_corrections` — append-only audit log of cross-DB mutations.
- `ingestion_log` — per-source freshness ledger.
- "Fill blanks only" conflict resolution in `promotePropertyFinancials`, `promoteBrokerContact`, `promoteLeaseExpenses`.

What was missing (until this session):

- **A centralized, queryable provenance log.** Sources are scattered across columns, with different schemas per table and different value vocabularies. No single "where did this cell come from?" lookup.
- **A unified per-field priority registry.** The contacts handler had a hardcoded JS map. Other write paths each implemented their own ad-hoc priority logic (or none).
- **A merge-decision function** that all write paths can share.

## Phase 1 — Foundation (shipped 2026-04-25)

Migration: [`supabase/migrations/20260425210000_lcc_field_provenance_and_priority.sql`](../supabase/migrations/20260425210000_lcc_field_provenance_and_priority.sql)

Three artifacts on LCC Opps:

1. **`field_provenance`** — append-only log. Every cross-table write to a curated field gets a row with `(target_database, target_table, record_pk_value, field_name, value, source, source_run_id, confidence, recorded_at, decision, decision_reason)`. Indexed for "what's the current authoritative provenance for this field?" lookups.

2. **`field_source_priority`** — per-field source ranking. Schema: `(target_table, field_name, source, priority, min_confidence, enforce_mode, notes)`. Lower priority number = higher trust. `enforce_mode` is `record_only | warn | strict` — lets us roll out per-field over time.

   Seeded today with the user's stated rules:

   | Field | Priority order |
   | --- | --- |
   | `dia.properties.address` | manual_edit → county_records → om_extraction → costar_sidebar |
   | `dia.properties.tenant` | manual_edit → cms_chain_org → lease_document → om_extraction → costar_sidebar |
   | `dia.leases.rent` | manual_edit → lease_document → om_extraction → projected_from_om → costar_sidebar → loopnet |
   | `dia.available_listings.cap_rate` | manual_edit → derived_from_rent → om_extraction → costar_sidebar → loopnet |
   | `dia.available_listings.initial_price` | manual_edit → om_extraction → costar_sidebar → loopnet |
   | `dia.properties.{year_built,lot_sf,parcel_number}` | manual_edit → county_records → om_extraction → costar_sidebar |
   | `dia.properties.{recorded_owner_id,true_owner_id}` | manual_edit → county_records / shell_chain_research / cms_chain_org → costar_sidebar |

   Same coverage exists for `gov.properties.*`. Easy to extend — `INSERT … ON CONFLICT DO NOTHING`.

3. **`lcc_merge_field()`** — single SQL function that takes `(target_database, target_table, record_pk, field_name, new_value, new_source, new_confidence, source_run_id)` and returns `(provenance_id, decision, decision_reason, current_value, current_source, current_priority, new_priority, enforce_mode)`. Records every call to `field_provenance` regardless of decision (auditability), supersedes the prior winner when the new write outranks, and flags `conflict` when same-priority sources disagree. Plus two views: `v_field_provenance_current` (latest authoritative per field) and `v_field_provenance_conflicts` (open conflicts pending human review).

**Behavior change today: zero.** Every priority entry is `enforce_mode='record_only'`. Application write paths still execute their own UPDATEs unchanged. The function is a passive observer until we wire callers.

## Phase 2 — Wire write paths to record (in progress)

For each ingestion path, before its existing UPDATE/INSERT, call `lcc_merge_field()` to record provenance. Continue performing the existing write as before. This produces real data in `field_provenance` so we can see what's writing what, validate the priority registry against reality, and identify which fields actually have multi-source conflicts in practice.

### Phase 2.1 — OM intake promoter ✅ SHIPPED 2026-04-25

`api/_handlers/intake-promoter.js::promoteIntakeToDomainListing` now calls `recordOmFieldsProvenance` after each downstream writer:

- `promoteListing` → `dia.available_listings` / `gov.available_listings`
- `promoteBrokerContact` → `dia.contacts` / `gov.contacts`
- `promotePropertyFinancials` / `promoteDiaPropertyFromOm` → properties
- `promoteDiaLeaseFromOm` → `dia.leases`

Source name: `om_extraction`. Source run id: `intake_id`. Confirmed working — every recent OM intake records 6-27 field writes per row.

### Phase 2.2 — CoStar sidebar pipeline (in progress)

#### Phase 2.2.a — properties + listings ✅ SHIPPED 2026-04-25

`api/_handlers/sidebar-pipeline.js::propagateToDomainDbDirect` now calls `recordCoStarFieldsProvenance` after the `external_identities` PATCH for:

- **Properties** — address, city, state, zip_code, tenant, year_built, building_size/rba, lot_sf, land_acres, parcel_number
- **available_listings** — looked up by `property_id` after the writer runs since the writer returns a count not an id; records initial_price, last_price, current_cap_rate, initial_cap_rate, listing_broker, broker_email, seller_name, listing_date

Source name: `costar_sidebar`. Source run id: `costar:<entity.id>`. Default confidence: 0.6 (lower than OM's 0.7 because CoStar data is aggregator-quality and lags real lease modifications).

#### Phase 2.2.b — leases, contacts, sales_transactions, etc. ⏳ DEFERRED

The remaining sidebar writers return counts not row PKs, which prevents post-hoc provenance recording. Phase 2.2.b will modify writer return shapes to expose the row PKs they wrote (or insert per-row provenance recording inside each writer). Coverage to add:

- `upsertDomainLeases` — leases
- `upsertSidebarContacts` — contacts
- `upsertDomainSales` — sales_transactions
- `upsertPublicRecords` — parcel + tax records
- `upsertDocumentLinks` — document_links
- `upsertDialysisDeedRecords` / `upsertGovernmentDeedRecords` — deed records
- `upsertDomainLoans` — loans
- `upsertDomainOwners` — recorded_owners + ownership_history
- `upsertDialysisBrokerLinks` / `upsertGovBrokers` — broker linkages

### Phase 2.3 — CMS chain-org sync ⏳ NOT STARTED

Whatever process populates `dia.properties.medicare_id`, `tenant`, chain reporting. Source name: `cms_chain_org`. Highest non-manual priority for tenant on dialysis.

### Phase 2.4 — County records sync ⏳ NOT STARTED

Whatever process populates `properties.assessed_owner`, `parcel_number`, `tax_year`, `latest_deed_date`. Source name: `county_records`. Highest non-manual priority for address, parcel_number, ownership.

### Phase 2.5 — Manual edits ⏳ NOT STARTED

`api/admin.js` apply-change path. Source name: `manual_edit`. Highest priority on every field — explicit human override always wins.

### Phase 2.6 — Salesforce two-way sync ⏳ NOT STARTED

Source name: `salesforce`. Per-field priority TBD by which SF object owns the field.

After all of Phase 2 is deployed for a week, query `v_field_provenance_conflicts` and inspect what's actually conflicting. Tune priorities. Add missing fields to the registry.

## Phase 3 — Flip enforcement (after Phase 2 + tuning)

Once the conflict rate is low and the registry is comprehensive, flip individual field priorities to `enforce_mode='warn'` first (logs but doesn't block), then `'strict'`:

- In `strict` mode, when `lcc_merge_field` returns `decision='skip'`, the caller skips its UPDATE and instead calls `record_intake_event(intake_id, 'skipped_overwrite_lower_priority', ...)`.
- When `decision='conflict'`, the caller writes the value into a "pending review" shadow row (or just records and flags), surfaces it in the triage UI via `v_field_provenance_conflicts`, and waits for human resolution.

Roll out per-field, not per-table. Start with `address` and `parcel_number` (county-authoritative, low ambiguity), then `tenant` (CMS-authoritative for dialysis), then financial fields (more contentious).

## Phase 4 — Self-learning loop

The matcher already has this pattern via `staged_intake_feedback` → `matcher_accuracy_stats` → nightly `compute_matcher_accuracy()`. Generalize it for source quality:

1. **Confirmation events.** When a sale closes at the OM-stated price → +1 for `om_extraction` on `initial_price`. When a lease renews at the OM-stated rent → +1 for `om_extraction` on `rent`. When the CoStar-stated cap rate is contradicted by the eventual sale's derived cap → -1 for `costar_sidebar` on `cap_rate`.

2. **Source accuracy roll-up.** Nightly `compute_field_source_accuracy()` rolls up `field_provenance` rows whose values were later confirmed/contradicted, and writes `field_source_accuracy_stats(source, target_table, field_name, period_end, sample_count, confirmed_count, contradicted_count, accuracy_rate)`.

3. **Priority adjustment.** A weekly job reviews `field_source_accuracy_stats` and proposes priority adjustments — if `costar_sidebar` is wrong on `dia.leases.rent` 40% of the time, increase its priority number (lower its trust) and require higher confidence. Proposals are submitted as PRs (or for an MVP, written to a `field_priority_proposals` table for human review before applying).

4. **Confidence calibration.** When a high-confidence write turns out to be wrong, the source's `min_confidence` for that field rises. When a low-confidence write turns out right, it falls. Same rolling-window mechanism the matcher uses for `confidence_band` accuracy bands.

This phase requires Phases 1-3 to have produced data for several weeks before there's enough signal to learn from.

## Operational notes

- **Don't extend `data_corrections`.** That table is the cross-DB mutation audit log (who/when/what mutation). `field_provenance` is field-level value provenance. Different question, different table. Both should exist.
- **Source names are namespaced.** Channel-specific (`om_email_intake` vs `om_sidebar`) when the source's reliability differs by channel. Generic (`costar_sidebar`) when the channel doesn't matter. Source names should map 1:1 onto `field_source_priority.source`.
- **`source_run_id` is the link back.** For OM intake, `source_run_id = staged_intake_items.intake_id`. For CoStar sidebar, `source_run_id = inbox_items.id` of the sidebar capture. This lets you say "show me every field write produced by intake X" — which is the audit story.
- **Conflicts are not failures.** Two same-priority OMs disagreeing on `cap_rate` is signal, not noise. Surface it for a human, learn from the eventual resolution.
- **The junk-tenant filter is still needed.** Even with strict enforcement on `dia.leases.tenant`, if the source produces "Health Care and Social Assistance" as the value, the priority registry can't help — that's a value-quality problem, not a source-quality problem. Per-source value validators (regex, whitelist, AI sanity-check) need to live alongside the merge function. The Phase 1 patch to `upsertDomainLeases` (extended `isJunkTenant`) is one such validator; future ones should accumulate in the relevant ingestion handler.

## Open questions for future sessions

- **Multi-row vs single-row provenance.** `field_provenance.record_pk_value` is `TEXT` to handle both UUID and BIGINT pks. For composite keys (e.g., `lease_rent_schedule(lease_id, period_start)`), we'd need to extend either to an array or switch to a pk-as-JSON convention. Defer until we hit that case.
- **What's the source name for "computed from rent + sale_price = cap_rate"?** Treated as `derived_from_rent` in the seed; might want a more general `derived_from_<inputs>` pattern that explicitly lists which inputs the value depends on, so when an input changes the derivation can be re-run.
- **How does this interact with Salesforce two-way sync?** SF objects have their own change tracking. Probably treat SF as a peer source with its own priority entries; the SF sync code consults `lcc_merge_field` before pushing to SF, and SF's own webhooks call `lcc_merge_field` when SF makes the change.
- **Real-time UI surfacing.** A property detail page should be able to render "tenant: USRC Medina County Dialysis (source: cms_chain_org, recorded 2026-04-12, confidence 0.95)" inline. Add a small UI helper that queries `v_field_provenance_current` for the current page's records.

## What's blocked on what

```
Phase 1 (Foundation)               ── DONE
  └── Phase 2 (Wire writers to record)
        └── Phase 3 (Flip enforce_mode → warn → strict, per field)
              └── Phase 4 (Self-learning loop on accuracy stats)
```

Phase 1's enforcement is `record_only`, which means deploying it is non-breaking. Phase 2 is non-breaking (additive instrumentation only). Phase 3 is the first behavior change and should be rolled out per-field with monitoring. Phase 4 is on top of Phase 3's signal.
