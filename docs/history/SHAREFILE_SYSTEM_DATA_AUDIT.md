# ShareFile System Data Audit

## Objective

Audit Life Command Center's current plan and code paths for implementing and ingesting ShareFile system data into Supabase-backed LCC/domain databases. The specific ShareFile structure under review is:

`Property / <First Letter of Tenant Name> / <Tenant Name> / <City, State>`

Expected file classes include offering memorandums, offers, PSAs, due diligence documentation, leases, valuation analysis, comps, correspondence, and related property/deal files.

## Working Assumptions

- LCC should enrich Supabase from existing ShareFile files already present in the team system.
- LCC should continue enrichment as new files are added.
- The audit should identify whether any reverse enrichment from Supabase/LCC back to ShareFile is currently planned or implemented.
- This is an audit-only pass unless a follow-up asks for implementation.

## Current Investigation Notes

- Repo instructions confirm LCC is the orchestration layer; domain Supabase projects hold canonical dialysis/government data.
- Existing ingestion architecture is centered on OM/email/sidebar intake, SharePoint bridge stubs, Power Automate flows, field provenance, and domain promotion logic.
- Need to distinguish ShareFile-specific implementation from nearby SharePoint/OneDrive/Microsoft Graph ingestion, because the names are easy to conflate but the connectors and APIs differ.

## Findings Draft

### 1. ShareFile itself is not implemented

There are no code references to `ShareFile`, `Citrix`, or `share file` in the LCC repository. The existing system-data bridge is SharePoint/OneDrive/Graph-oriented and assumes Microsoft 365 DriveItem payloads, not Citrix ShareFile items.

### 2. Existing adjacent plan is SharePoint Properties indexing

The current bridge plan indexes the TeamBriggs20 SharePoint `Shared Documents` library into `sharepoint_documents`.

Implemented flow:

1. Power Automate uses Microsoft Graph delta queries.
2. PA posts file DriveItems to `/api/sharepoint-changes`.
3. `api/bridges.js` enqueues `sharepoint.document.classify` enrichment jobs.
4. `api/_shared/bridge-handlers-sharepoint.js` parses `/Properties/<TenantName>/<City, State>/...`, classifies doc_type from filename, and writes metadata to `sharepoint_documents`.
5. Optional Phase 2.5 extraction posts to `PA_SP_EXTRACT_URL`, and the PA flow is expected to fetch file bytes and route them into the existing OM intake pipeline.

Important mismatch: the user-described ShareFile layout is `Property/<First Letter>/<Tenant Name>/<City, State>`, while the implemented SharePoint parser expects `/Properties/<TenantName>/<City, State>/...` and does not handle a letter bucket.

### 3. Metadata indexing is broader than enrichment

The SharePoint bridge indexes metadata-only rows for every file it receives. Bodies are intentionally not stored in `sharepoint_documents`; body extraction is separate and on-demand.

The metadata index captures useful discovery fields:

- drive/item id
- path
- file name and web URL
- content type, size, etag, modified date
- parsed tenant/city/state
- heuristic document type
- best-effort tenant/property entity links
- match confidence
- extraction status

This is useful for visibility, but it does not by itself enrich domain Supabase property/listing/lease/comp records.

### 4. Actual enrichment runs through the OM intake path

The only mature file-content enrichment path is the existing OM intake pipeline. Once a file body becomes a staged artifact, the extractor pulls structured fields and the promoter can write:

- `available_listings`
- listing broker contacts
- selected property fields, filling blanks only
- dialysis lease fields
- LCC-side entity/contact links
- field provenance rows tagged `om_extraction`

The extractor knows about `om`, `flyer`, `marketing_brochure`, `lease_abstract`, `rent_roll`, `comp`, and related types, but the promoter only auto-promotes listing-grade document types (`om`, `flyer`, `marketing_brochure`) unless the snapshot clearly looks like a listing. Comps, PSAs, offers, due diligence folders, correspondence, and many valuation artifacts are not first-class canonical enrichment paths.

### 5. Continuation for new files is only planned for SharePoint

The SharePoint plan uses Graph delta links on a 30-minute PA cadence. That gives incremental metadata indexing for new/changed SharePoint files. There is no equivalent ShareFile webhook/delta cursor, polling job, source table, or connector type.

Even on SharePoint, continued enrichment after a new file lands is mostly manual/on-demand:

- `sharepoint.properties.index` is active in the seed.
- `sharepoint.properties.extract` is seeded as paused.
- docs say the UI button for "Extract latest OM" still needs wiring.
- no frontend code currently references `sharepoint_documents` or `/api/sharepoint-extract`.
- no auto-extract-on-classify path is implemented.

### 6. Reverse enrichment back to file storage is not implemented

Outbound bridge support currently only maps `sf.touchpoint.log` to `PA_SF_TOUCHPOINT_URL`. There is no outbound SharePoint or ShareFile bridge for writing database-derived metadata, generated summaries, canonical naming, extracted lease abstracts, valuation snapshots, provenance sidecars, or folder tags back into the storage system.

### 7. Field provenance is strong for OM promotions, incomplete for file-library intelligence

`field_provenance` and `field_source_priority` are well-developed for cross-table field writes. OM promoter writes record provenance under `om_extraction`. CoStar document links record provenance under `costar_sidebar`.

Missing for ShareFile/SharePoint library ingestion:

- no `sharefile_system` source in provenance/priority registry
- no provenance rows for metadata-only file indexing
- no provenance policy for extracted leases, comps, offers, PSAs, correspondence, or valuation analyses
- no source priority rules for file-library data vs OM, CoStar, county records, manual edits, Salesforce, or lease documents

### 8. Current data coverage gaps against the business objective

The system does not yet enrich from the team's existing file library as a comprehensive property knowledge base. It can support OM extraction if a file is routed into the intake pipeline, but it does not systematically ingest the rest of the deal file:

- Offers/LOIs: no extraction schema or canonical target tables found.
- PSAs: no PSA parser, transaction milestone extraction, buyer/seller extraction, or closing pipeline enrichment.
- Due diligence/leases: extractor can identify lease abstracts and lease responsibility fields, but only dialysis OM-derived lease promotion is implemented; signed lease ingestion is marked future.
- Valuation analysis: no Excel/valuation workbook parser beyond generic binary best-effort AI prompt; no valuation history table/write path.
- Comps: extractor recognizes `comp`, but promoter excludes comps from canonical listing/property enrichment.
- Correspondence: Outlook bridge exists for email body extraction/linking, but ShareFile/SharePoint folder correspondence is not parsed as activity history.
- Existing files/backfill: no bulk extraction loop over all indexed docs; only per-doc trigger is implemented.
- UI review loop: no app surface yet for low-confidence file/property matches or pending extraction queue.

### 9. Documentation drift to clean up before implementation

`docs/INTEGRATION_BRIDGES.md` still describes Phase 2 as `/Properties/<Letter>/<City, State>/`, while the newer Phase 2 SharePoint migration and handler use `/Properties/<TenantName>/<City, State>/`. The user's ShareFile shape adds both a top-level singular `Property` segment and a tenant-letter bucket. Any ShareFile implementation should normalize the docs around the exact canonical path grammar before code is written.

## Preliminary Recommendation

Treat the existing SharePoint bridge as a reusable pattern, not as completion of ShareFile ingestion. Implement a storage-neutral `file_library_documents` ingestion model or add a real `sharefile` source alongside SharePoint with path adapters for:

`Property/<Letter>/<Tenant>/<City, State>`

Then add three distinct stages:

1. Metadata index: backfill existing ShareFile library and keep it current with ShareFile events or scheduled delta/polling.
2. Content extraction: auto-queue high-value document classes, with bulk extraction and stuck-job recovery.
3. Canonical enrichment: promote each document class to explicit domain targets with provenance and conflict rules.

## Proposed ShareFile Connection, Discovery, and Linking Architecture

### Design Decision

ShareFile discovery should be **self-discovery by LCC through the ShareFile API**, optionally assisted by Power Automate for operational plumbing. Power Automate should not be treated as the authoritative discovery engine unless we confirm a robust tenant-approved custom connector with stable auth, pagination, file-content download, and retry behavior.

Rationale:

- ShareFile items have immutable GUIDs, so LCC can track files across renames/moves by source item id rather than path text.
- ShareFile supports webhooks for file events, including signed webhook payloads.
- LCC already has a governed bridge pattern (`connector_bridges`, `bridge_runs`, `enrichment_jobs`) that fits API/webhook ingestion.
- Power Automate is useful when credentials must stay inside Microsoft/low-code governance, but PA run history, connector limits, and custom HTTP complexity make it weaker as the canonical crawler.

### Source of Truth

The source of truth for discovery should be ShareFile itself:

- `sharefile_item_id` is the stable external id.
- `sharefile_parent_id` links folders/files to their parent folder.
- `sharefile_path` is derived and can change.
- `etag` / version / modified timestamp drives idempotency.
- `content_hash`, when available or computed after download, prevents duplicate extraction.

Power Automate, if used, should only forward ShareFile API results/events to LCC's existing bridge receiver shape.

### Backfill Existing ShareFile Library

Initial ingestion is a crawler, not a one-file upload flow.

1. Seed a bridge row:
   - `bridge_key = 'sharefile.properties.index'`
   - `source_system = 'sharefile'`
   - `direction = 'inbound'`
   - `schedule = 'hourly'` or `on_demand_backfill`
   - allowlist: item id, parent id, name, item type, path, size, created/modified times, creator/modifier, download URI metadata, version/hash fields if exposed.

2. Start at the configured ShareFile root folder:
   - expected root: `Property`
   - root id stored in `connector_bridges.watermark.root_item_id` or bridge metadata.

3. Recursively list children:
   - persist every folder and file into `file_library_documents` or `sharefile_documents`.
   - checkpoint progress by folder id and page cursor.
   - write `bridge_runs` rows for each crawl batch.
   - enqueue classify/link jobs for files.

4. Parse path segments:
   - `Property`
   - `<tenant_letter>`
   - `<tenant_name>`
   - `<city_state>`
   - optional subfolders like `OM`, `Offers`, `PSA`, `Due Diligence`, `Leases`, `Valuation`, `Comps`, `Correspondence`.

5. Classify each file:
   - first by folder path and filename heuristics.
   - second by lightweight content sniffing for ambiguous files.
   - final doc classes should include more than today's OM set: `om`, `lease`, `lease_abstract`, `rent_roll`, `offer_loi`, `psa`, `dd`, `valuation_analysis`, `comp`, `correspondence`, `closing_statement`, `other`.

6. Link to LCC/domain records:
   - tenant entity by canonical tenant name.
   - property by tenant + city/state, then address if extracted.
   - existing domain property id when matched.
   - Salesforce account/opportunity if mapped in entity metadata.
   - confidence score and match reason stored on the file row.

7. Surface review:
   - files with `match_confidence < 0.85`, multiple candidates, unknown doc type, or parse errors go to a "File Library Review" queue.

### Continuing Discovery for New Files

There should be two mechanisms:

1. **Webhook fast path**
   - Subscribe to ShareFile file upload/update/delete/move/rename events where supported.
   - Webhook endpoint: `/api/sharefile-events` routed to `api/bridges.js?_route=ingest&_source=sharefile`.
   - Verify ShareFile HMAC signature before accepting.
   - Store raw event payload in `bridge_runs.metadata` or a small `external_events` table.
   - Enqueue a `sharefile.item.refresh` job to fetch the full item by id.

2. **Scheduled reconciliation sweep**
   - Runs hourly or nightly.
   - Re-crawls the `Property` tree using modified timestamps and folder checkpoints.
   - Repairs missed webhooks, folder moves, permission drift, and webhook outages.

This hybrid is safer than relying only on events. File systems usually produce edge cases: bulk uploads, renames, moves, missed event deliveries, deleted files, and permissions changes.

### Content Extraction Queue

Metadata indexing should be cheap and broad. Content extraction should be selective and queued.

Auto-extract immediately:

- OMs / flyers / marketing brochures
- leases and lease abstracts
- rent rolls
- valuation analysis workbooks
- offers / LOIs / PSAs
- comps packages

Do not auto-extract by default:

- obvious duplicates
- very large media files
- correspondence threads unless they are tied to active deal status
- unknown file types until reviewed

Extraction jobs:

- `sharefile.document.extract`
- fetch bytes from ShareFile by item id.
- upload raw artifact to Supabase Storage or stream directly into the existing intake artifact pipeline.
- run document-specific extractor.
- write extraction snapshot and diagnostics.
- pass eligible fields into canonical promoters.

### Canonical Enrichment Targets

ShareFile should enrich more than current OM intake:

| Document class | Likely targets |
|---|---|
| OM / flyer / marketing brochure | `available_listings`, property financial fields, broker contacts, lease fields, `field_provenance` |
| Lease / lease abstract | `leases`, expense responsibility fields, renewal options, rent schedule, lease provenance |
| Rent roll | lease occupancy, rent schedule candidates, multi-tenant flags |
| Offer / LOI | buyer/prospect entity, offered price, offer date, contingencies, deal stage |
| PSA | buyer/seller, contract date, due diligence deadlines, closing deadline, escrow, purchase price |
| Due diligence docs | checklist status, lease/financial/legal evidence links |
| Valuation analysis | valuation snapshots, cap-rate assumptions, pricing recommendation, analyst/source |
| Comps | sales comp evidence, source document, comp set membership |
| Correspondence | activity/timeline events, contact/entity linking, commitments/deadlines |

### Provenance Rules

Add a new source family:

- `sharefile_metadata`
- `sharefile_om_extraction`
- `sharefile_lease_document`
- `sharefile_psa`
- `sharefile_offer`
- `sharefile_valuation`
- `sharefile_correspondence`

Then seed `field_source_priority` rules before canonical writes are enabled. Example priority posture:

- signed lease / PSA from ShareFile should outrank OM extraction for lease/legal terms.
- valuation workbook should not overwrite closed sale data or county records.
- correspondence should create activity/commitment records but not overwrite canonical property facts without review.
- ShareFile metadata should link evidence, not rewrite facts.

### Power Automate Role

Power Automate is **not the best canonical discovery source** if we can get direct ShareFile API credentials or an app registration. The preferred architecture is:

`ShareFile API/webhooks -> LCC bridge receiver -> enrichment_jobs -> Supabase/domain promoters`

Power Automate is acceptable as an adapter when:

- IT will not grant direct ShareFile API credentials to LCC.
- the ShareFile connection already exists inside Power Platform governance.
- PA can call ShareFile API through HTTP/custom connector and post normalized payloads to LCC.

If PA is used, keep it dumb:

- no matching logic in PA.
- no field transformation beyond allowlisted metadata normalization.
- no canonical writes from PA directly to Supabase domain DBs.
- PA posts batches/events to LCC, and LCC owns idempotency, parsing, linking, provenance, and promotion.

### Minimal LCC Implementation Plan

1. Add `sharefile` as an allowed `source_system` in `connector_bridges`.
2. Add `sharefile_documents` or generalized `file_library_documents`.
3. Add `/api/sharefile-events` rewrite into `api/bridges.js`.
4. Add `INGEST_SOURCES.sharefile` configs:
   - `sharefile.properties.index`
   - `sharefile.item.refresh`
   - `sharefile.document.extract`
5. Add parser for `Property/<Letter>/<Tenant>/<City, State>/...`.
6. Add metadata backfill script/job.
7. Add webhook verifier and event normalizer.
8. Add UI review panel for unmatched/low-confidence documents.
9. Add document-class extractors and promoters incrementally, starting with OMs and leases.
10. Add outbound ShareFile enrichment later only after inbound is stable.

### Reverse Enrichment Back to ShareFile

Reverse enrichment should be conservative and auditable. Recommended v1 writebacks:

- write LCC-generated sidecar JSON or markdown summary files into an `_LCC` subfolder per property.
- add/update ShareFile metadata tags if ShareFile account configuration supports them.
- do not rename/move existing team files automatically.
- do not overwrite source documents.

Examples:

- `_LCC/lcc-property-summary.md`
- `_LCC/lcc-extraction-index.json`
- `_LCC/lcc-open-items.md`
- `_LCC/lcc-source-map.json`

These sidecars can give humans ShareFile-native context while keeping Supabase as the canonical structured-data system.

## Additional Design Considerations

### Permissions and Ethical Visibility

ShareFile is a deal-file system with sensitive client documents. The ingestion service should only see folders the Briggs team is allowed to use for business workflows. Avoid broad admin-level crawling if a service account with scoped folder access is possible.

Design requirements:

- store `source_acl_snapshot` or at least visibility scope on every file row.
- never expose extracted text to users who cannot access the source property/workspace.
- treat correspondence, PSAs, offers, and DD docs as higher sensitivity than OMs.
- record who triggered manual extraction and who approved promotion.

### Idempotency and File Identity

Use ShareFile immutable item ids as the canonical external id. Path alone is not sufficient because users rename folders, move files, and replace documents.

Recommended unique key:

`workspace_id + source_system + source_item_id + source_version`

Also store:

- current path
- prior path history
- parent folder id
- file name
- modified timestamp
- size
- etag/version/hash
- content hash after download when practical

This prevents duplicates when a file is moved from `Due Diligence` to `Closed` or renamed from `Draft OM` to `Final OM`.

### Deletes, Moves, and Renames

Do not hard-delete indexed file rows when ShareFile reports deletion. Soft-delete them:

- `source_deleted_at`
- `last_seen_at`
- `current_status = active|missing|deleted|permission_lost`

Moves and renames should update path metadata but preserve links, extraction history, and provenance through the immutable item id.

### Versioning and Re-Extraction Policy

The system needs a version policy. A modified OM or lease should not silently overwrite prior extracted evidence without trace.

Recommended behavior:

- new source version creates a new extraction snapshot.
- compare extracted field deltas to the current authoritative fields.
- if differences affect material terms, queue for review.
- only auto-promote low-risk blank-field fills or same-value confirmations.

Material term examples:

- asking price
- cap rate
- NOI/rent
- lease expiration
- expense responsibilities
- PSA deadlines
- buyer/seller names

### Document Family and Deal Lifecycle Model

A property folder is not just a pile of documents. It represents a deal lifecycle. We should model that explicitly:

- prospect/research
- valuation
- listing prep
- on market
- offers
- PSA / under contract
- due diligence
- closing
- post-close/archive

Folder names and document classes should update a `property_file_lifecycle` or `deal_file_status` surface, even when no canonical field is promoted.

### Evidence Graph, Not Just Field Extraction

For broker workflows, the most valuable output may be an evidence graph:

- source document
- extracted facts
- exact page/text evidence when possible
- target canonical field
- promotion decision
- reviewer
- confidence
- superseded-by relationship

This lets a user answer: "Why does LCC think the lease expires on this date?" with a direct document trail.

### Human Review Queues

The design should include multiple queues, not one generic "failed extraction" bucket:

- unmatched file/property
- low-confidence property match
- ambiguous document type
- high-value extraction ready for review
- material conflict with existing canonical field
- extraction failed / unsupported file type
- source permission lost

Each queue should have a clear next action.

### File Type Handling

Do not assume everything is a PDF. The ShareFile system likely has:

- PDFs
- Word docs
- Excel valuation workbooks
- email `.msg` / `.eml`
- images/scans
- zipped DD packages
- PowerPoint/BOV decks

Needed handlers:

- PDF text extraction plus OCR fallback for scanned PDFs.
- DOCX text extraction.
- XLSX structured workbook parser for valuation/comps.
- MSG/EML parser for correspondence.
- ZIP manifest indexing before selectively extracting contained files.

### OCR and Scanned Documents

Many legal/lease/PSA scans will not have extractable PDF text. The current OM pipeline depends heavily on `pdf-parse`. Add an OCR fallback for high-value docs, ideally only after cheap text extraction returns too little text.

Use OCR selectively because it is slower and more expensive.

### Rate Limits, Large Backfills, and Cost Controls

The first crawl could touch thousands of files. Build backfill throttles from day one:

- crawl batch size
- extraction daily budget
- per-doc max bytes
- per-folder concurrency
- pause/resume checkpoints
- retry ceilings
- dead-letter queue
- cost estimate per extraction batch

Metadata indexing can run broadly; content extraction should be prioritized.

### Security and Secrets

If direct API is used:

- store ShareFile OAuth credentials outside client code.
- never send ShareFile tokens to browser clients.
- rotate secrets.
- verify webhook signatures.
- log token/auth failures without leaking secrets.

If Power Automate is used:

- require `X-LCC-Key` or equivalent request auth.
- avoid secrets in flow run-history where possible.
- treat PA HTTP URLs as credentials and rotate after exposure.

### Data Retention and Legal Hold

Do not create uncontrolled copies of all source documents. The default should be:

- persist metadata and extraction snapshots.
- persist source file IDs/URLs.
- store raw bytes only when needed for extraction and only with retention policy.
- keep extracted text for high-value docs only if it is needed for evidence/review.

Legal-sensitive documents may require a different retention posture than public OMs.

### Search and Retrieval

Add search as a product requirement, not an afterthought:

- file search by tenant, city/state, doc type, file name.
- property detail "source documents" tab.
- full-text/vector search over approved extracted text snippets.
- "show me all docs that support this field" from property detail.

### Domain Boundaries

Some ShareFile folders will not be dialysis or government deals. The ingestion model should support:

- domain unknown
- capital markets/general net lease
- ignored folder patterns
- manual domain override

Avoid forcing every file into `dia` or `gov`.

### UI/Workflow Requirements

Before auto-promoting beyond OMs, add a review UI:

- document index per property.
- extraction status and last error.
- side-by-side extracted fields vs current database values.
- accept/reject per field.
- link/unlink file to property.
- re-extract button.
- "do not ingest this folder/file" control.

### Operational Observability

Add health views and alerts:

- last successful ShareFile webhook received.
- last reconciliation crawl.
- files indexed today.
- extraction queue depth.
- extraction failure rate by doc type.
- low-confidence match count.
- permission/auth failure count.
- stale queued jobs.

This should fit the existing bridge freshness/admin pattern.

### Naming and Folder Governance

The system can tolerate messy folders, but it should also report governance issues:

- tenant letter does not match tenant name.
- city/state segment invalid.
- duplicate tenant/city folders.
- files at wrong folder depth.
- stale drafts after final versions exist.
- orphan folders with no matching property/entity.

Do not auto-reorganize ShareFile; report and optionally generate cleanup suggestions.

### Acceptance Criteria for V1

A good V1 should prove the loop end-to-end:

1. crawl one ShareFile root folder.
2. index every file/folder with stable ids.
3. parse path into tenant/city/state.
4. link at least 80% of property folders to an LCC/domain property or review queue.
5. auto-extract OMs and leases only.
6. write canonical fields only when blank or human-approved.
7. record field provenance for every promoted field.
8. handle a new uploaded OM through webhook or next sweep.
9. show indexed/extracted docs in property detail.
10. recover from a failed extraction without manual SQL.
