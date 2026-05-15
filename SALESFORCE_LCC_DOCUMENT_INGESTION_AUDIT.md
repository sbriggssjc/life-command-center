# Salesforce → LCC Document Ingestion Audit & Bridging Plan

**Date:** 2026-05-14
**Scope:** The relationship between Salesforce and the LCC / Supabase databases, audited specifically for **pulling Salesforce-hosted documents — old marketing flyers and offering memorandums — into the databases for ingestion, via the LCC.**
**Companion document:** `SALESFORCE_SUPABASE_DATAFLOW_AUDIT.md` covers the broader object-sync problem. This document is the file/document slice of it and supersedes that document's Gaps 6–8 with live-verified findings.

---

## 1. Objective

Ensure that documents attached to Salesforce records — especially historical marketing flyers, brochures, and offering memorandums on old Comp and Listing records — are reliably discovered, copied, and ingested into the Supabase domain databases through the LCC orchestration layer, using the existing document-extraction engine rather than a new one.

The acceptance fixture throughout is the **DaVita Dialysis — Tucson, AZ** property (1780 W Ariblan Rd, Tucson AZ 85745), whose Salesforce screenshots were provided. Its sold Comp record carries two PDFs ("DaVita - Tucson - AZ - Plan - Updated" and a sibling). Today those files have no path into Supabase. When this plan is complete, they should land in storage, be extracted by the existing engine, and attach to the Tucson property with full Salesforce provenance.

---

## 2. What the Salesforce screenshots establish

Eight screenshots from the Northmarq "Investment Sales" Salesforce app were reviewed. The relevant structural facts:

- **Files live on Comp and Listing records — not on the Property record.** The Property page (DaVita Dialysis — Tucson — AZ) shows linked Leases, Deals, and Comps but **no Files related list**. The sold/external Comp shows **Files (2)** with the "DaVita - Tucson - AZ - Plan" PDFs. The available/internal Comp shows **Files (0)** with an upload area. The Listing shows a **Listing Thumbnail Image** plus an upload/drop area. This means document discovery cannot start and stop at the Property — it must traverse **Property → Comps** and **Property → Deal → Listing** and read the Files related list on each child record.
- **The custom object graph is rich and interlinked:** Property, Listing (record type "Leasehold"), Comp (one object, `Comp Type` Internal/External and `Status` Available/Sold), Lease, Deal (stage path Listing Signed → LOI Executed → In Escrow → Non-refundable → Closed), Tenant (DaVita Dialysis — DVA/NYSE, S&P BB, Moody's Ba2), and Company (owner companies, e.g. "Tam's Family LLC"). Each record carries related Contacts and Companies with broker roles (Seller Broker, Buyer Broker, etc.).
- **These are standard Salesforce Files** — the "Files (N)" related lists are `ContentDocumentLink` rows where `LinkedEntityId` is the Comp/Listing record Id, each pointing to a `ContentDocument` with one or more `ContentVersion` rows holding the actual bytes.
- **The objects appear to be a managed package** ("Investment Sales"), so their API names need to be confirmed (likely `Comp__c`, `Listing__c`, `Property__c`, `Lease__c`, `Tenant__c`, with Deal possibly mapped to `Opportunity` and Company to `Account`).

---

## 3. Current state — the Salesforce ↔ LCC/Supabase relationship as it exists today

### 3.1 Infrastructure topology (live-verified)

Three Supabase projects, all active:

- **`Dialysis_DB`** (`zqzrriwuavgrquhisnoa`) — canonical dialysis domain data.
- **`government`** (`scknotsqkcheojiaewwh`) — canonical government-lease domain data.
- **`LCC Opps`** (`xengecqvemvfknjvbvrq`) — the LCC orchestration layer's own database.

The **`life-command-center` repo is the confirmed intermediary.** Its Supabase Edge Functions layer has a `_shared` module exposing `opsClient()`, `govClient()`, and `diaClient()` — one client per project — plus Power Automate webhook auth (`X-PA-Webhook-Secret`, constant-time compare) and an `X-LCC-Key` API key. The `daily-briefing` function already cross-queries `DIA_URL/rest/v1/salesforce_activities`. Repo instructions state explicitly that LCC is the orchestration layer and the domain projects hold canonical data. So routing Salesforce content through LCC is not a new pattern — it is the established one.

### 3.2 Salesforce object data — partial, export-driven, no files

| Path | What it does | Mechanism |
|---|---|---|
| `DialysisProject/src/salesforce_reader.py` | Read-only enrichment lookups (Account/Contact/Opportunity/Task/Event/Note) by owner name or contact Id | `simple_salesforce` API, username/password/token auth |
| `DialysisProject/src/salesforce_ingestion.py` | Ingests Salesforce activity CSV exports into `salesforce_activities` (107k rows) | Manual CSV export → importer |
| `DialysisProject/src/salesforce_sync.py` | Pushes owner/contact/activity data back to Salesforce | API write |
| `GovernmentProject/src/ingest_sf_export.py` | CSV import of SF contacts/accounts/activities → `sf_contacts_import`, `sf_activities` | Manual CSV export → importer |
| `government.sf_comps_staging` (54 cols) | Holds Salesforce comp exports, split by `Status` into `sales_transactions` / `available_listings` | Manual Excel export (`Comps.xlsx`) → importer |

Two structural facts follow from this:

1. **The custom CRE objects in the screenshots — Property, Listing, Comp, Lease, Deal, Tenant — are essentially not synced.** Only Account / Contact / Opportunity / Task / Activity data flows, and mostly as periodic manual CSV/Excel exports. The richest data is the data not being captured.
2. **Nothing is event-driven or API-polled at the object level.** Every Salesforce object path today is "a human exports a file, a human runs an importer."

### 3.3 Salesforce Files — zero capability

**Confirmed by code search across all three repos: nothing references `ContentDocument`, `ContentVersion`, or `ContentDocumentLink`.** There is no connector, no query, no download path, no storage target, and no metadata table for Salesforce-hosted files. The marketing flyers and plans visible in the screenshots are completely unreachable from Supabase today. This is the central gap.

### 3.4 The document-extraction engine — mature and ready, but local-folder-bound

The downstream machinery that *would* consume Salesforce files already exists and is good:

- **`DialysisProject/src/file_processor.py`** (~109 KB) — extracts text/OCR from PDF/DOCX/TXT/EML/XLSX, classifies, AI-scrubs, matches or creates a property, writes structured upserts, logs `pending_updates`, inserts `scrub_cache`, marks files processed. **But its inputs are local folders only** — `sharefile_data/`, `data/raw/`, `email_data/`. It has no Salesforce source and cannot be triggered by a Salesforce event.
- **`DialysisProject/src/document_classifier.py`** — already classifies `marketing_flyer`, `offering_memorandum`, `lease_abstract`, `rent_roll`, `appraisal`, `purchase_agreement`, etc., by filename and content, and returns type-specific extraction prompts. It is ready to consume Salesforce flyers and OMs the moment they arrive.
- **`Dialysis_DB.property_documents`** — live, 425 rows. Columns: `document_id`, `property_id`, `file_name`, `raw_text`, `file_id`, `document_type`, `source_url`, `sale_id`, `ingestion_status`, `extracted_data` (jsonb). It already links to both properties and sales. This is the natural landing table for extracted Salesforce documents.
- **`Dialysis_DB.source_files`** — live but empty (0 rows), email-oriented. Exists, unused.

The takeaway: **the extraction brain is built. The gap is entirely in the delivery — getting Salesforce file bytes in front of it.**

### 3.5 The Power Automate → LCC → Storage pattern already exists for email

This is the most important finding for the plan, because it means the bridge is mostly an *adaptation*, not a *build*:

- **`life-command-center/supabase/functions/intake-receiver`** — a working Power Automate front door. Validates the webhook secret, builds a deterministic correlation/idempotency key, performs a merge-duplicate upsert. This is the exact template for an `intake-salesforce` sibling function.
- **`government.email_intake_v2`** — a mature 60-column intake envelope: `payload_version`, `idempotency_key`, `flow_run_id`, `correlation_id`, `raw_payload` (jsonb), `status`, `processing_state`, `retry_count`, `worker_*`, `promotion_*`, `lifecycle_stage`, `retention_class`.
- **`government.intake_attachments`** + the **`intake-attachments` Storage bucket** (private) — the file side: `file_name`, `mime_type`, `size_bytes`, `sha256`, `sha256_verified`, `storage_method`, `storage_path`, `storage_status`, `is_inline`, `validation_error`. This is ~90% of the shape a Salesforce-files table needs.
- **`GovernmentProject/backend_webhook_contract.md`** — a versioned (`2026-03-31-v1`) JSON contract spec for `POST /api/intake/email`, with auth, size limits, and an `intake_event` idempotency block. Directly adaptable to a Salesforce-files contract.
- **`Dialysis_DB.staged_intake_items / _artifacts / _matches / _promotions`** — a parallel, thinner staging pipeline on the dialysis side (`staged_intake_artifacts` has `file_name`, `file_type`, `inline_data`, `storage_path` but **no `sha256` and no `storage_status`** — weaker than government's version).

So the mechanical pattern — *Power Automate moves a file → an LCC edge function authenticates and deduplicates it → bytes land in a Storage bucket with a metadata row → a worker extracts → match → promote* — is **already built and running for email.** Salesforce Files need to be plugged into the same machinery, not given their own.

### 3.6 Adjacent plans that share the same engine

Two existing LCC documents confirm the "one extraction core, many front doors" principle and the house style (evidence-first, non-destructive, provenance-tracked):

- **`SHAREFILE_SYSTEM_DATA_AUDIT.md`** — a SharePoint document bridge is implemented (PA Graph delta → `/api/sharepoint-changes` → `sharepoint_documents` → classify → extract). ShareFile itself is not implemented. This is a third front door into the same extraction engine.
- **`SALESFORCE_NOTES_INGESTION_AUDIT_PLAN.md`** — a one-time legacy Salesforce *Notes* (not Files) ingestion plan, explicitly evidence-first and non-destructive. The Salesforce *Files* path should follow the same philosophy and not duplicate its provenance structures.

---

## 4. Gap analysis

The gaps below are ordered by how directly they block the objective (pulling old flyers/OMs into the databases).

**Gap 1 — No Salesforce Files connector exists at all.** Nothing queries `ContentDocumentLink` / `ContentVersion`. This is the headline gap; everything else is downstream of it.

**Gap 2 — Files hang off Comp and Listing records, so discovery requires the object graph.** The screenshots prove the Property has no Files list. To find a property's flyers you must traverse Property → Comps and Property → Deal → Listing and read each child's Files related list. That traversal is impossible today because the custom objects aren't in Supabase.

**Gap 3 — The custom object graph (Property/Comp/Listing/Deal) is not in Supabase.** Without these records and their Salesforce Ids landed somewhere, you cannot enumerate which `ContentDocumentLink`s to fetch, and you cannot link a fetched file back to a property.

**Gap 4 — No Salesforce-file storage target.** government has the `intake-attachments` bucket + `intake_attachments` table for email; there is no `salesforce-files` bucket and no SF-file metadata table carrying ContentDocument/ContentVersion identity. `Dialysis_DB` has no Storage bucket at all.

**Gap 5 — `file_processor.py` is local-folder-only.** It scans `sharefile_data/`, `data/raw/`, `email_data/`. It cannot be triggered by a Salesforce file event and has no Salesforce source adapter.

**Gap 6 — No LCC edge function for Salesforce.** `intake-receiver` is email-only. There is no `intake-salesforce` sibling to act as the front door.

**Gap 7 — No de-duplication identity for Salesforce files.** `ContentVersion` provides a natural version identity, and government's `intake_attachments` already carries `sha256` — but `Dialysis_DB.staged_intake_artifacts` does not. Without both, the same flyer re-uploaded under a new name re-extracts every time.

**Gap 8 — No provenance from an extracted field back to its Salesforce origin.** `property_documents` has a generic `source_url` but no ContentDocument/ContentVersion/SF-record linkage. The provenance tables that exist (`government.field_value_provenance`, `Dialysis_DB.lease_field_provenance`) are not wired to Salesforce files.

**Gap 9 — Authentication and throughput for file download are unaddressed.** `salesforce_reader.py` uses `simple_salesforce` username/password/token auth — reusable — but downloading the `ContentVersion.VersionData` blob is a different call pattern, and a historical backfill across every linked record × versions needs an explicit API-quota budget and batching strategy.

**Gap 10 — The two databases have diverged, and a files path could deepen the split.** `Dialysis_DB` uses `staged_intake_*`; `government` uses `email_intake_v2` / `sf_*_staging` / `intake_attachments`. government's pattern is the more mature of the two. A Salesforce-files path should converge on government's shape rather than extend the thinner dialysis tables.

**Gap 11 — RLS posture (noted, deferred).** 155 tables on `Dialysis_DB` have Row Level Security disabled. Per direction this is a separate, later workstream — but any new Salesforce tables and the new Storage bucket should be created RLS-aware from day one so they don't add to the backlog.

---

## 5. Bridging plan

### 5.1 Design principle

**Reuse the email machinery; do not build a parallel one.** The Salesforce-files path is a new *front door* onto the existing intake → storage → extraction → match → promote pipeline. Power Automate (or a scheduled Python job — see Phase 0) discovers Salesforce Files; the LCC `intake-salesforce` edge function authenticates, deduplicates, and routes; bytes land in a `salesforce-files` Storage bucket with an `sf_files` metadata row; the existing `file_processor.py` / `document_classifier.py` engine extracts; results land in `property_documents` with Salesforce provenance; ambiguous cases go to review.

Staging shape converges on government's pattern (`sf_*_staging`, `intake_attachments`-style file table, `field_value_provenance`). LCC stays the intermediary in *code*; the *data* stays in each domain database (centralizing it in LCC Opps would make every match and promotion a cross-database operation).

### 5.2 Phase 0 — Decisions and confirmations

Small, fast, blocking. Specifically:

- Confirm the Salesforce API object names for the eight screenshot objects (managed-package custom objects vs. standard `Opportunity`/`Account`).
- Confirm a Salesforce integration user with read access to the custom objects **and** to `ContentDocumentLink` / `ContentVersion.VersionData`.
- Decide the discovery mechanism: Power Automate's Salesforce connector vs. a scheduled Python job reusing `salesforce_reader.py`'s `simple_salesforce` session. (Recommendation: Python for the object/file *discovery crawl* — it is quota-sensitive and easier to batch and debug — with Power Automate reserved for any near-real-time triggers later. File *movement* can go either way.)
- Confirm that extracted Salesforce documents for dialysis properties land in `Dialysis_DB` and government properties in `government`.

### 5.3 Phase 1 — Minimal object graph for traversal

Land *just enough* of the custom objects to enumerate files and link them back: Property, Comp, Listing, Deal — their Salesforce Ids and parent-child links — into `sf_*_staging` tables modeled on `government.sf_comps_staging`. This is the prerequisite for Gap 2 and Gap 3: you cannot know which `ContentDocumentLink`s to pull, or what a file belongs to, without it. Scope the first pass to the Tucson fixture's object graph.

### 5.4 Phase 2 — Salesforce file discovery and storage

- Create the `salesforce-files` Storage bucket (private, RLS-aware) and the `sf_files` metadata table — model it on `government.intake_attachments` plus Salesforce identity: `content_document_id`, `content_version_id`, `linked_entity_type`, `linked_entity_id`, `title`, `file_name`, `extension`, `version_number`, `sha256`, `size_bytes`, `sf_download_url`, `storage_path`, `ingestion_status`, `extraction_status`.
- Build the discovery step: for the staged Property/Comp/Listing/Deal records, query `ContentDocumentLink WHERE LinkedEntityId IN (...)`, then the latest `ContentVersion` per `ContentDocumentId`.
- Filter by document signals — file type (PDF/DOCX/XLSX/images) and name/content keywords (flyer, brochure, marketing, OM, offering memorandum, plan, etc.), reusing `document_classifier.py`'s vocabulary.
- Download only new `ContentVersionId`s; persist every file/version row to `sf_files` before extraction; compute and store `sha256`.
- Build the **`intake-salesforce` LCC edge function** as the front door — a sibling of `intake-receiver`, reusing `_shared` (auth, cors, `diaClient`/`govClient`), with a versioned JSON contract adapted from `backend_webhook_contract.md`.

### 5.5 Phase 3 — Wire into the existing extraction engine

Add a Salesforce source adapter to `file_processor.py` (or a thin wrapper around it) so a downloaded Salesforce file is processed exactly like a ShareFile or email PDF: text/OCR → `document_classifier` → AI scrub → property match → `property_documents` + `extracted_data`. Carry Salesforce provenance — `content_document_id`, `content_version_id`, source SF record Id and object type — onto every `scrub_cache`, `property_documents`, and `pending_updates` row it writes (closes Gap 8).

### 5.6 Phase 4 — Historical backfill of old flyers and OMs

This is the actual objective. Sweep the back catalogue: starting from the staged object graph, batch-scoped by tenant (DaVita, Fresenius first), object type, or date range. Dry-run/report mode first; API-quota-budgeted; reversible. The Tucson "DaVita - Tucson - AZ - Plan" PDFs are the first acceptance case.

### 5.7 Phase 5 — Steady state and monitoring

Watermark-based incremental discovery (new/changed `ContentDocumentLink`s since last run); retry/dead-letter handling reusing the email pattern; a `v_sf_file_ingestion_status` view (`discovered → stored → extracted → matched → linked → failed/retry`); weekly QA sampling of files-versus-storage-versus-extraction-versus-linkage.

---

## 6. Acceptance criteria

- Every Salesforce file linked to a synced Property/Comp/Listing/Deal record is represented in `sf_files` with ContentDocument/ContentVersion identity and a `storage_path` in the `salesforce-files` bucket.
- The Tucson DaVita property's Comp-attached PDFs are discoverable, stored, extracted by the existing engine, and produce `property_documents` rows linked to the Tucson property with Salesforce provenance.
- Re-running discovery does not duplicate files (ContentVersion identity + `sha256`) or re-extract unchanged versions.
- Every extracted field can be traced back to its `content_version_id` and source Salesforce record.
- Old documents are retained as evidence; ingestion never overwrites a higher-trust current value (consistent with the Notes-ingestion plan's non-destructive policy).
- Failures land in a reviewable queue with enough context to fix the file, the link, or the source.

---

## 7. Immediate next step

With Phase 0's scope already largely confirmed, the first build step is **Phase 1**: draft the `sf_*_staging` migration (Property/Comp/Listing/Deal, modeled on `government.sf_comps_staging`) for `Dialysis_DB`, scoped to the Tucson fixture's object graph — reviewed before anything is applied.
