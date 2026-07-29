# Salesforce Legacy Notes Ingestion Audit Plan

## Objective

Draft a one-time ingestion plan for the two legacy Salesforce note exports:

- `C:\Users\scott\OneDrive - NorthMarq Capital, LLC\Desktop\Note Records - Company - Team Briggs.xlsx`
- `C:\Users\scott\OneDrive - NorthMarq Capital, LLC\Desktop\Note Records - Contact - Team Briggs.xlsx`

The target is to recover private legacy notes titled in the pattern `Tenant - City, ST`, preserve the original text and Salesforce linkage, and use the notes to improve LCC/Supabase ownership, prospecting, property, contact, and Salesforce connection data without overwriting higher-trust curated records.

## User Clarification: Intended Role of This Data

2026-05-14 clarification: these legacy Salesforce notes are one of the only durable evidence trails connecting true owners, companies, and contacts to specific properties from the old SJC/Northmarq workflow. The ingestion should therefore prioritize evidence preservation and connection enrichment over direct field mutation.

Priority order:

1. Connect the Salesforce Contact/Company record to the LCC entity graph.
2. Attach the historical note evidence to that Salesforce-linked LCC entity.
3. Parse the note title as property/prospect evidence.
4. Generate candidate links from the note to an LCC asset, domain property, recorded owner, true owner, or ownership-history row.
5. Store those candidate links and field suggestions in provenance/review structures.
6. Only after review or very high-confidence matching should the import create production relationship edges.

This import must not overwrite existing fields. Its purpose is to add siftable enrichment evidence across LCC, Supabase, Microsoft, and Salesforce worlds.

## Additional Plan Guardrails

These requirements tighten the enrichment design before implementation:

1. **Treat note existence as first-class evidence**
   - The imported note should be queryable as an evidence artifact, not only as relationship metadata.
   - Required evidence fields: Salesforce parent ID, Salesforce note ID, source workbook/row, note title, optional note body, creator/owner, dates, parsed tenant/city/state, body recovery status, parse status, match status, and downstream links informed by the note.

2. **Separate evidence from assertions**
   - Observed evidence: a legacy note existed on a Salesforce Contact/Account.
   - Inferred candidate: the title likely points to a property, owner, developer, or prospecting relationship.
   - Asserted relationship: an approved or very-high-confidence connection written to production relationship tables.
   - The import must preserve all three layers distinctly.

3. **Store confidence reasons, not only scores**
   - Every candidate match should include machine-readable reasons such as:
     - `sf_parent_exact`
     - `sf_account_exact`
     - `sf_contact_exact`
     - `title_city_state_exact`
     - `tenant_exact`
     - `domain_hint_government`
     - `domain_hint_dialysis`
     - `owner_sf_account_exact`
     - `body_address_exact`
     - `body_owner_name_match`
   - Scores without reasons are not sufficient for later audit.

4. **Preserve many-to-many relationships**
   - One note can be attached to multiple contacts/companies.
   - One title can match multiple candidate properties.
   - One parent company/contact can relate to multiple properties.
   - The candidate layer must not collapse these into a single best match until review or apply time.

5. **Use unmatched parents as a Salesforce-link backlog**
   - Rows with Salesforce parent IDs that do not resolve to LCC entities should become an explicit backlog.
   - This backlog should drive additional `external_identities` / entity backfill work before owner/property assertion.

6. **Track negative and uncertain states**
   - Store status values such as:
     - `parent_unlinked`
     - `body_missing`
     - `duplicate_note_id`
     - `title_unparseable`
     - `no_property_match`
     - `ambiguous_property_match`
     - `no_owner_match`
     - `ambiguous_owner_match`
   - These states are work queues, not import failures.

7. **Run a pilot before broad application**
   - First end-to-end run should use a reviewed sample of roughly 100-300 notes.
   - Include government, dialysis, healthcare/other, sold, duplicate-note-ID, untitled, and ambiguous-title cases.
   - Do not enable broad production relationship writes until pilot precision is reviewed.

8. **Prefer note-body recovery before owner assertions**
   - If Salesforce note body recovery is possible by `Note ID`, run that before asserting owner/property relationships.
   - Title-only data is acceptable for candidate generation.
   - Body-backed data is materially stronger for address, owner, developer, lease, sale, broker, and history assertions.

9. **Expose legacy evidence in LCC**
   - Property, owner, company, and contact views should eventually surface legacy evidence directly.
   - Example display concept: `Legacy SF Note: "Tenant - City, ST", attached to <Salesforce parent>, created by <creator> on <date>.`
   - This should be visible as evidence, not hidden only in backend staging tables.

10. **Enforce no-overwrite behavior in code**
    - Import/apply scripts should refuse to patch `true_owner_id`, `recorded_owner_id`, ownership history, lease, sale, or property facts unless running an explicit approved apply mode.
    - The approved apply path should require either:
      - `review_status='approved'`, or
      - a documented very-high-confidence rule and a blank target field.
    - All such attempts must write `field_provenance` with `source='salesforce_legacy_note'` and a `source_run_id`.

## Current Session Notes

- 2026-05-14: Started audit from `C:\Users\scott\life-command-center`.
- 2026-05-14: Confirmed both source XLSX exports exist in the Northmarq OneDrive Desktop folder.
- 2026-05-14: Loaded repository instructions and Supabase/spreadsheet workflow guidance.
- 2026-05-14: Initial architecture signals found in repo: entity hub, Salesforce bridge handlers, `sf_sync_queue`, external identities, field provenance, and previous Salesforce entity backfill scripts.
- 2026-05-14: Profiled both workbooks. They contain note metadata and titles, but no note body/content column.
- 2026-05-14: Ran read-only live Supabase count audit against LCC Opps, Gov DB, and DIA DB.
- 2026-05-14: Drafted ingestion architecture below. No production data was changed.

## Source Export Audit

### Company Note Export

- Workbook: `Note Records - Company - Team Briggs.xlsx`
- Sheet: `Notes - Company - Team Briggs`
- Rows: 14,438 total; 14,437 data rows.
- Columns:
  - `Company Name`
  - `Company Link`
  - `Company ID`
  - `Note Title`
  - `Note ID`
  - `Note Created by`
  - `Note Owner ID`
  - `Note Created Date`
  - `Note Last Modified`
- Data profile:
  - Unique note IDs: 12,272
  - Duplicate note IDs: 1,647
  - Unique parent company IDs: 9,165
  - Unique titles: 9,231
  - Titles matching a `... - City, ST` pattern: 13,137
  - Titles containing `SOLD`: 594
  - `Untitled Note` rows: 303

### Contact Note Export

- Workbook: `Note Records - Contact - Team Briggs.xlsx`
- Sheet: `Notes - Contact - Team Briggs`
- Rows: 19,566 total; 19,565 data rows.
- Columns:
  - `Contact Name`
  - `Contact Link`
  - `Contact ID`
  - `Note Title`
  - `Note ID`
  - `Note Created By`
  - `Note Owner ID`
  - `Note Created Date`
  - `Note Last Modified Date`
- Data profile:
  - Unique note IDs: 14,573
  - Duplicate note IDs: 3,316
  - Unique parent contact IDs: 12,201
  - Unique titles: 10,934
  - Titles matching a `... - City, ST` pattern: 18,145
  - Titles containing `SOLD`: 700
  - `Untitled Note` rows: 313

### Critical Limitation

The XLSX exports do not include the note body. They preserve the note title, Salesforce note ID, parent contact/account ID, creator, owner, and dates. If note body recovery is possible from Salesforce, ContentNote/ContentVersion export, backup files, or Salesforce Files export keyed by `Note ID`, that should be added before final ingestion. If the bodies cannot be recovered, the title still has high value as relationship evidence, but it should not be treated as a complete property-intel source.

## Existing LCC/Supabase Architecture Findings

### Canonical LCC Objects

The existing LCC graph already has the right primitives:

- `entities`: canonical `person`, `organization`, and `asset` records.
- `external_identities`: external IDs keyed by `(workspace_id, source_system, source_type, external_id)`. This is the right home for Salesforce Account/Contact/Note IDs and any recovered ContentNote IDs.
- `entity_relationships`: existing relationship edge table. This is the right durable place to express that a contact/company was related to a prospect asset surfaced by a legacy note.
- `activity_events`: canonical timeline. Good for imported note timeline rows only when an LCC `actor_id` can be resolved from the Salesforce owner/creator.
- `action_items`: canonical work queue. This should receive open legacy Opportunities only if current open opportunity exports are available, not from the note export alone.
- `field_provenance` and `field_source_priority`: existing source-priority framework. Legacy notes should be registered as a low-to-medium trust source and used to fill blanks or create review candidates, not overwrite county, OM, lease, or manual data.

### Salesforce-Specific Objects

Existing Salesforce bridge work is useful but incomplete for this dataset:

- `external_identities.salesforce`: live audit shows 1,262 Salesforce links in LCC Opps:
  - 896 Accounts
  - 366 Contacts
- `sf_sync_queue`: 469 queued/done outbound Salesforce requests exist.
- `salesforce_activity_log`: exists in schema but currently has 0 live rows.
- `activity_events` with `source_type='salesforce'`: currently 0 live rows.
- `unified_contacts` in Gov DB is fully SF-linked in the live audit:
  - 16,990 rows
  - 16,990 with `sf_contact_id`
  - 16,990 with `sf_account_id`
- DIA has weaker Salesforce contact coverage:
  - `contacts.sf_contact_id`: 358 rows.

Implication: the note import should rely first on Salesforce IDs from the exports and existing Gov `unified_contacts`, then on LCC `external_identities`, and only later on fuzzy name matching.

## Recommended Target Model

Do not force these exports directly into only `activity_events` or only `entity_relationships`. Use a staged import with four layers. The first successful outcome is not a property write; it is a verified Salesforce Account/Contact identity linked to LCC plus preserved note evidence.

1. **Raw immutable import**
   - New LCC table: `salesforce_legacy_notes_import`
   - One row per source workbook row, preserving every exported field.
   - Include `source_file`, `source_kind` (`company` or `contact`), `source_row_number`, `sf_parent_id`, `sf_note_id`, `note_title`, `note_body` nullable, creator/owner metadata, dates, and `raw_row jsonb`.
   - Include explicit status fields for `body_status`, `parse_status`, `parent_link_status`, `candidate_status`, and `apply_status`.
   - Unique key: `(source_file, source_row_number)` plus non-unique indexes on `sf_note_id`, `sf_parent_id`, and normalized title.

2. **Dedupe/canonical note layer**
   - New LCC table or materialized view: `salesforce_legacy_notes_canonical`
   - One row per `sf_note_id` where possible.
   - Keep all parent links in child rows, because duplicate note IDs may represent the same note attached to multiple records.
   - Normalize title into:
     - `tenant_label`
     - `city`
     - `state`
     - `status_hint` (`sold`, `active_unknown`, `untitled`, etc.)
     - `domain_hint` (`government`, `dialysis`, `healthcare`, `other`, `unknown`)
     - `parse_confidence`

3. **Candidate matching layer**
   - New LCC table: `salesforce_legacy_note_matches`
   - Store candidate links to:
     - LCC parent entity from Salesforce Account/Contact external identity.
     - Gov `unified_contacts` / domain contacts by `sf_contact_id`.
     - Asset entity by `tenant_label + city + state`.
     - Domain property in Gov/DIA by tenant/operator plus city/state, and later address if note body is recovered.
   - Store `match_type`, `confidence`, `match_reasons text[]`, `match_reason_detail jsonb`, `review_status`, and `reviewed_by`.
   - Preserve all plausible candidates. Ranking can happen in views or apply logic; raw candidates should remain many-to-many.

4. **Applied connection/provenance layer**
   - Write only reviewed or high-confidence matches to production tables:
     - `external_identities`: add Salesforce Note IDs as `source_system='salesforce'`, `source_type='ContentNote'` or `LegacyNote`, attached to the parent/contact/company entity or the matched asset entity.
     - `entity_relationships`: create evidence-backed relationships such as:
       - contact/company `prospected_asset`
       - contact/company `legacy_note_mentions_asset`
       - contact/company `possible_true_owner_for_asset`
       - company `possible_recorded_owner_for_asset`
       - company `developer_for_asset`
       - company/contact `associated_with_asset`
       - contact `prospecting_contact_for_asset`
     - `activity_events`: add timeline note rows only when a Salesforce owner/creator maps to an LCC user. Otherwise keep the event in `salesforce_legacy_notes_import` and surface through a view.
     - `field_provenance`: record every proposed field fill with `source='salesforce_legacy_note'`, low enough priority to avoid overwriting authoritative sources.

Recommended relationship write policy:

- Always preserve the raw note and its Salesforce parent link in staging.
- Automatically create Salesforce external identity links when the parent Salesforce ID resolves exactly.
- Automatically create low-risk evidence links such as `legacy_note_mentions_asset` only when the asset/property match is exact or near-exact by tenant/title plus city/state.
- Keep true-owner and recorded-owner implications as candidates first unless there is a direct parent Account match to an existing true_owner/recorded_owner Salesforce ID or an already-linked LCC organization.
- Record all property/owner implications in provenance/review views even when they are not applied.

## Matching Strategy

### Parent Contact/Company Matching

Use this order:

1. Exact LCC external identity:
   - Account rows: `external_identities(source_system='salesforce', source_type='Account', external_id=Company ID)`.
   - Contact rows: `external_identities(source_system='salesforce', source_type='Contact', external_id=Contact ID)`.
2. Gov `unified_contacts` by `sf_contact_id` or `sf_account_id`.
3. Domain contacts:
   - Gov `contacts.sf_contact_id`
   - DIA `contacts.sf_contact_id`
4. Fuzzy fallback by parent name only when the Salesforce ID path misses. These should be review-only unless the score is extremely high and there is supporting company/account context.

The parent Salesforce ID match is the backbone of the ingestion. Even if no property can be confidently matched, the system should still retain: "Salesforce Contact/Account X had legacy note Y titled `Tenant - City, ST` on date Z."

### Asset/Property Matching

Title parsing should be deterministic and conservative:

- Parse from the right edge first: final ` - City, ST` segment wins.
- Treat suffixes like ` - SOLD` as status hints, not part of the city/state.
- Everything before the location segment becomes `tenant_label`.
- Flag special title forms for review:
  - `Untitled Note`
  - titles with street address instead of city/state
  - titles with multiple tenants separated by `/`, `|`, `&`
  - generic labels such as `GSA Properties`

Candidate matching order:

1. Exact asset entity by normalized `name/canonical_name + city + state`.
2. Domain properties by `(tenant/operator/agency/facility name) + city + state`.
3. Available listings by tenant/name plus city/state and date windows.
4. Sales transactions where title has `SOLD`, using city/state/tenant and sale date proximity if note body is recovered.
5. Fuzzy title match to existing asset/property with review required.

### Owner/Ownership-History Matching

Because the notes are true-owner evidence, owner matching deserves its own pass after parent and asset matching:

1. If a company-note parent Salesforce Account ID already exists on an LCC organization or domain true owner/recorded owner, treat that as strong owner-side evidence.
2. If a contact-note parent Salesforce Contact ID maps to a `unified_contacts` row with `true_owner_id`, `recorded_owner_id`, `sf_account_id`, or an LCC `entity_id`, use that as candidate owner-side evidence.
3. If the note title maps to a property and the parent maps to an organization, create or propose an LCC relationship edge between organization/contact and asset with source metadata from the note.
4. If the note title maps to a domain property, propose links to:
   - `properties.true_owner_id`
   - `properties.recorded_owner_id`
   - `ownership_history.true_owner_uuid`
   - owner/contact bridge tables, where present
5. Use `field_provenance` and review queues for every owner-field suggestion. Do not patch `true_owner_id`, `recorded_owner_id`, or ownership history automatically unless the match is exact and the target field is blank.

### Domain Routing

Use the title and tenant label to infer domain:

- Government: `SSA`, `VA`, `DVA`, `FBI`, `GSA`, `BLM`, state agencies, city/county/federal department names.
- Dialysis: `DaVita`, `Fresenius`, `US Renal`, `American Renal`, dialysis/plasma tenants where applicable.
- Healthcare/other: urgent care, MOB, orthopedics, dental, plasma, ASC, etc.

This should remain a routing hint, not a hard write decision.

## One-Time Ingestion Workflow

1. **Preflight**
   - Save a read-only checksum and row-count profile for both XLSX files.
   - Confirm whether a note body export can be obtained by `Note ID`.
   - Snapshot current target counts:
     - LCC `entities`, `external_identities`, `entity_relationships`, `activity_events`, `field_provenance`
     - Gov `unified_contacts`, `contacts`, `true_owners`, `properties`, `available_listings`
     - DIA `contacts`, `properties`, `leases`, `available_listings`, `sales_transactions`

2. **Create staging schema**
   - Add migration for `salesforce_legacy_notes_import`.
   - Add migration for `salesforce_legacy_note_matches`.
   - Add source-priority rows for `salesforce_legacy_note` across only the fields it may suggest.
   - Add review views:
     - `v_salesforce_legacy_notes_parse_quality`
     - `v_salesforce_legacy_note_high_confidence_matches`
     - `v_salesforce_legacy_note_review_queue`
     - `v_salesforce_legacy_note_apply_summary`

3. **Load raw rows**
   - Parse XLSX with a dry-run-first script.
   - Insert raw rows in batches.
   - Store duplicates explicitly rather than dropping them.
   - Mark rows with missing/untitled/unparseable titles.

4. **Normalize and dedupe**
   - Canonicalize Salesforce IDs to 18-character IDs where possible.
   - Normalize note titles.
   - Group duplicate `sf_note_id` rows.
   - Keep separate parent links for each parent ID.

5. **Generate candidates**
   - Match parent contacts/companies by Salesforce ID.
   - Match assets/properties by parsed title.
   - Assign confidence:
     - 0.95-1.00: exact SF identity plus exact asset city/state/title match.
     - 0.80-0.94: exact SF parent plus strong asset/property fuzzy match.
     - 0.60-0.79: title-derived asset candidate without exact parent entity.
     - below 0.60: review-only.

6. **Dry-run report**
   - Produce counts before writes:
     - rows imported
     - unique notes
     - duplicate notes
     - parsed titles
     - matched contacts
     - matched companies
     - matched assets/properties
     - unmatched Salesforce parent IDs
     - review-only rows
     - negative/uncertain state counts
     - proposed relationship writes
     - proposed field provenance writes
   - Export a review CSV/XLSX for ambiguous matches.

6A. **Pilot batch**
   - Run the entire workflow against a sample of 100-300 notes before broad application.
   - Sample should include:
     - government tenant titles
     - dialysis tenant titles
     - healthcare/other titles
     - `SOLD` titles
     - duplicate note IDs
     - `Untitled Note` rows
     - ambiguous or multi-tenant titles
   - Review precision and false-positive patterns before enabling broad apply.

7. **Apply high-confidence writes**
   - Insert `external_identities` for Salesforce note IDs.
   - Insert or update exact Salesforce Account/Contact external identity links for the parent entity first.
   - Insert `entity_relationships` with metadata:
     - `source='salesforce_legacy_note'`
     - `sf_note_id`
     - `note_title`
     - `source_kind`
     - `created_by_name`
     - `sf_owner_id`
     - `created_date`
     - `parse_confidence`
     - `match_confidence`
   - Insert `field_provenance` rows for suggested fills. Use `lcc_merge_field()` and respect skip/conflict decisions.
   - Do not overwrite domain fields directly unless the merge decision is `write` and the existing field is blank or lower-priority.
   - Code must refuse direct owner/property/lease/sale field patches outside an explicit approved apply path.

Minimum successful import, even before property/owner resolution:

- Every importable row has a raw staging record.
- Every exact Salesforce Account/Contact parent match creates or confirms an LCC `external_identities` link.
- Every linked parent gets a preserved legacy-note evidence record.
- Every parseable title gets a candidate asset/property/owner match row, even if `review_status='needs_review'`.

8. **Review and second-pass apply**
   - Review ambiguous parent/entity/property matches in the LCC UI or a generated workbook.
   - Apply manually approved matches by updating `review_status='approved'` and running the apply script for approved rows only.

9. **Verification**
   - Re-run live counts and compare to preflight.
   - Spot-check at least 25 high-confidence applied rows across:
     - government titles
     - dialysis titles
     - healthcare/other titles
     - sold titles
     - duplicate note IDs
   - Confirm dashboards/search do not double-count duplicate notes.
   - Confirm `v_field_provenance_unranked` remains clean after adding the new source-priority rows.
   - Confirm unresolved/negative states produce review queues rather than disappearing from the workflow.

10. **Rollback**
   - Every applied row should carry `source_run_id`.
   - Rollback should delete by `source_run_id` from:
     - `external_identities` where `source_type in ('LegacyNote','ContentNote')`
     - `entity_relationships` where `metadata->>'source_run_id' = ...`
     - `field_provenance` where `source_run_id = ...`
   - Raw import rows should remain as immutable audit evidence.

## What Should Not Happen

- Do not import these rows as current open opportunities without a separate open Task/Opportunity export.
- Do not write note-title-derived tenant/address/lease/sale facts directly over existing domain fields.
- Do not collapse duplicate note IDs blindly; duplicates may represent one note linked to multiple contacts/companies.
- Do not create `activity_events` with fake actors. If the Salesforce owner cannot be mapped to an LCC user, keep the note in the legacy import tables and expose it through a view.
- Do not use fuzzy parent names as authoritative Salesforce identity links.

## Best Next Step

Before implementation, try to recover the missing note bodies by exporting Salesforce ContentNote/ContentVersion data keyed by the 12,272 company note IDs and 14,573 contact note IDs. If bodies are not recoverable, proceed with the title-only workflow above, but lower field-write confidence and treat the import primarily as relationship/prospecting evidence.

## Open Work

- Decide whether to implement staging migrations now or first attempt body recovery from Salesforce.
- Decide whether the review interface should be a temporary XLSX/CSV workflow or an LCC admin view.
- Add tests for title parsing and candidate scoring before any production write path.
