# Salesforce -> LCC Ingestion & Continuous Sync Plan

**Date:** 2026-05-14
**Scope:** All Salesforce data, all verticals (dialysis, government, and the cross-vertical LCC layer) — initial ingestion *and* ongoing scheduled updates — delivered through Power Automate into the LCC orchestration layer and the Supabase domain databases.
**Companion docs:** `SALESFORCE_LCC_DOCUMENT_INGESTION_AUDIT.md` (the file/flyer slice), `EDGE_FUNCTION_AUDIT.md`, `backend_webhook_contract.md` (the email-intake contract this plan's contract is modeled on).

---

## 1. Objective

Stand up a durable, repeatable pipeline that pulls Salesforce records and files into the LCC/Supabase databases and keeps them current on a schedule — without ever overwriting higher-quality or newer data already in the database. The pipeline must work for every vertical, not just dialysis, and must survive the constraint that the Northmarq Salesforce org is SSO-gated.

Three things must be true when this is done:

1. **Ingestion** — every in-scope Salesforce object and file can be pulled into Supabase staging, on demand and as a historical backfill.
2. **Continuous sync** — the same pipeline runs on a schedule (default twice a year, full crawl) and reconciles changes, additions, and deletes with no manual export step.
3. **Provenance-safe promotion** — staged Salesforce data only reaches the canonical domain tables through the field-level precedence rules, so a Salesforce value never clobbers a newer or higher-trust value.

---

## 2. Why Power Automate (the authentication reality)

Direct API access was attempted and fails. The Northmarq org is **SSO-gated**: a username/password/security-token login returns `INVALID_SSO_GATEWAY_URL` because users authenticate through an external identity provider, not against Salesforce directly. A `simple_salesforce` / JWT-Connected-App path would work but requires a Salesforce admin to provision a Connected App or an SSO-exempt integration user — slow, and outside our control.

**Power Automate sidesteps this entirely.** Its Salesforce connector is authenticated **once, interactively** — you sign in through a browser, which runs the normal SSO flow — and Power Automate then stores and auto-refreshes the OAuth token. Every scheduled flow afterward runs unattended against that stored connection. This is the approach the team already concluded was necessary, and it matches the original dataflow audit's "Power Automate as collector" design.

The trade: Power Automate is the **transport**, not the brain. It authenticates, queries, and moves bytes. All validation, idempotency, routing, mapping, provenance gating, and domain writes happen on the LCC side. Power Automate must never write a domain table.

---

## 3. Architecture overview

```
  Salesforce (SSO org)
        |
        |  Power Automate Salesforce connector (interactive OAuth, auto-refresh)
        v
  ┌─────────────────────────────────────────────────────────────┐
  │  POWER AUTOMATE  (transport only)                            │
  │    Flow 1  Object Sync          (scheduled)                  │
  │    Flow 2  File Discovery & Move (scheduled)                 │
  │    Flow 3  Retry & Dead-letter   (scheduled)                 │
  │    Flow 4  On-demand Backfill    (manual / button)           │
  └─────────────────────────────────────────────────────────────┘
        |  HTTPS POST, X-PA-Webhook-Secret
        v
  ┌─────────────────────────────────────────────────────────────┐
  │  LCC EDGE FUNCTIONS  (the brain)                             │
  │    intake-salesforce        — objects: validate, dedup, stage│
  │    intake-salesforce-files  — files: store bytes, stage meta │
  │    sf-promotion-worker      — provenance-gated promotion     │
  └─────────────────────────────────────────────────────────────┘
        |                              |
        v                              v
  raw + staging tables          Supabase Storage
  (sf_sync_log, sf_*_staging)   (salesforce-files bucket)
        |
        |  promotion worker, gated by field_precedence_policy
        |                       + field_value_provenance
        v
  CANONICAL DOMAIN TABLES   (properties, leases, sales_transactions,
   per vertical: Dialysis_DB / government / LCC Opps)
```

The shape is one transport layer (Power Automate), one brain (LCC edge functions), one provenance gate (the promotion worker), fanning out to three Supabase projects. Power Automate flows differ only by *what* they collect; they all converge on the same LCC intake contract.

---

## 4. Data in scope

### 4.1 Salesforce objects

| Object | Why it matters | Primary vertical(s) |
|---|---|---|
| Property | The anchor record; address, type, size, owner company | dialysis, government |
| Comp | Sold/available comps; **carries file attachments** | dialysis, government |
| Listing | Active marketing records; **carries thumbnail/files** | dialysis, government |
| Deal | Stage, pricing, seller/buyer, broker team | dialysis, government |
| Lease | Tenant, rent, term, escalations, expenses | dialysis, government |
| Tenant | Credit ratings, public-company data | dialysis, government |
| Company | Owner & broker companies, relationship status | cross-vertical (LCC) |
| Contact | People + broker/seller/buyer roles | cross-vertical (LCC) |
| ContentDocumentLink / ContentVersion | The join + bytes for every attached file | all |

### 4.2 Salesforce files

Files attach to **Comp and Listing records, not Property** (confirmed from the org screenshots — the Property page has no Files list). Discovery must therefore walk Property -> Comp and Property -> Deal -> Listing, then read each child's `ContentDocumentLink`s. Target file classes: marketing flyers, brochures, offering memorandums, site plans, lease abstracts.

### 4.3 Verticals and routing

- **Dialysis** -> `Dialysis_DB` — properties with dialysis/DaVita/Fresenius/clinic signals.
- **Government** -> `government` — GSA/federal-tenant/lease-number signals.
- **Cross-vertical** -> `LCC Opps` — Contacts, Companies, and activity that aren't vertical-specific live in the LCC layer's own database and are referenced by both domains.

Routing is decided by the LCC `intake-salesforce` edge function per record, not by Power Automate. Power Automate pulls everything; the brain sorts it.

---

## 5. The Supabase landing zone

### 5.1 Staging tables (already partially built)

The canonical staging shape is government's `sf_comps_staging` pattern: an identity PK, the `sf_<obj>_id`, `source_system` / `import_batch`, a `raw_row` jsonb that preserves the entire Salesforce record, a `payload_hash` for change detection, parsed columns for traversal and matching, `linked_*_id` link-probe outputs, and `processed` / `process_status`.

| Database | Status |
|---|---|
| `Dialysis_DB` | **Built** (Phase 1): `sf_sync_log`, `sf_property_staging`, `sf_comp_staging`, `sf_listing_staging`, `sf_deal_staging` |
| `government` | Partially present: `sf_comps_staging`, `sf_contacts_import`, `sf_activities`, `sf_sync_log`. Needs the same `sf_property_staging` / `sf_listing_staging` / `sf_deal_staging` shape added for parity. |
| `LCC Opps` | Needs the cross-vertical staging tables (`sf_company_staging`, `sf_contact_staging`, `sf_sync_log`). |

All three converge on one shape. The remaining migrations mirror the Phase 1 `create_sf_staging_tables.sql` already applied to `Dialysis_DB`.

### 5.2 File tables and storage

- A private `salesforce-files` Storage bucket per database (modeled on government's existing `intake-attachments` bucket).
- An `sf_files` metadata table: `content_document_id`, `content_version_id`, `linked_entity_type`, `linked_entity_id`, `title`, `file_name`, `extension`, `version_number`, `sha256`, `size_bytes`, `sf_download_url`, `storage_path`, `ingestion_status`, `extraction_status`. Modeled on government's `intake_attachments`.

### 5.3 Provenance tables (already present, to be wired in)

Both `Dialysis_DB` and `government` already have `field_precedence_policy` (per-field rules: source-authoritative / manual-override / overlay / derived-only). `government` has `field_value_provenance` (authority_source, authority_rank, manual_override, last_confirmed_at); `Dialysis_DB` has `lease_field_provenance` and `field_precedence_policy` plus `record_field_overrides` and `manual_change_events`. The promotion worker (Section 7) uses these — nothing new needs to be invented, only connected.

---

## 6. Field-level provenance: the non-destructive promotion rule

This is a hard requirement: **ingested Salesforce data must never overwrite higher-quality or newer data already in the database.** The pipeline enforces it structurally by separating *ingestion* from *promotion*.

### 6.1 The two-stage rule

- **Ingestion** (Power Automate -> edge function -> staging) only ever writes to `sf_sync_log` and `sf_*_staging`. It never touches a domain table. Staging is an append/upsert ledger of "here is what Salesforce said, and when."
- **Promotion** (the `sf-promotion-worker`) is the only thing that writes domain tables, and every single field write passes through the precedence gate below.

Because the two stages are separate, a bad or stale Salesforce pull can never damage canonical data — the worst case is a staging row that the promotion gate declines to promote.

### 6.2 The promotion gate (per field, every time)

For each candidate field on each staged record, the worker:

1. **Looks up the rule** in `field_precedence_policy` for that `(table, field)`. Mode is one of:
   - `manual-override` — a human-verified field. Salesforce **never** auto-overwrites it. A conflicting Salesforce value goes to the review queue.
   - `source-authoritative` — promote only if the incoming source outranks the current source, or the field is empty.
   - `overlay` — promote if newer, regardless of source rank (used for genuinely Salesforce-owned CRM fields).
   - `derived-only` — never written by ingestion at all (computed downstream).
2. **Reads current provenance** from `field_value_provenance` for that record/field: who set it, at what authority rank, and `last_confirmed_at`.
3. **Compares.** Salesforce is allowed to win only when: the field is empty; OR the rule is `overlay` and the Salesforce record's `LastModifiedDate` is newer than `last_confirmed_at`; OR the rule is `source-authoritative` and Salesforce's authority rank for that field beats the incumbent's.
4. **Acts:**
   - *Promote* — write the domain field, update `field_value_provenance` (authority_source = `salesforce`, the rank, `last_change_event_id`, `last_confirmed_at`), and append a row to `manual_change_events` / promotion log with the previous value.
   - *Hold* — leave the domain field, but keep the staged observation (it stays queryable as evidence and history).
   - *Conflict* — when the rule can't safely decide (e.g. `manual-override` field with a materially different Salesforce value), write a review-queue row instead of guessing.

### 6.3 Per-field authority for Salesforce

`field_precedence_policy` is seeded so Salesforce is authoritative only where it genuinely is:

- **Salesforce authoritative / overlay** — listing status, marketing status, deal stage, broker/team assignment, expected close date, the Salesforce record IDs themselves, Salesforce file metadata.
- **Not Salesforce authoritative** — CMS/Medicare identifiers, public-record ownership chains, deed/transfer facts, and any derived underwriting metric (NOI, cap rate calculations). Salesforce observations of these are stored but do not promote over the public-record or derived source.
- **Newer-document-wins** — current rent, lease expiration, current cap rate: a Salesforce value competes on `source_document_date` / recency, not on being "from Salesforce."

The point: "don't overwrite better data" is not a hope, it's a gate every field passes through, and the rules live in a table you can tune without code changes.

---

## 7. The LCC intake endpoints

Three edge functions, all siblings of the existing `intake-receiver`, all reusing `_shared` (`auth.ts`, `cors.ts`, `supabase-client.ts` with `opsClient` / `govClient` / `diaClient`).

### 7.1 `intake-salesforce` — object intake

`POST` actions:

- `?action=objects` — body is a batch of Salesforce records (`{ payload_version, batch_id, object_type, records: [...] }`). The function: validates the shared secret; for each record computes `payload_hash`; writes raw to `sf_sync_log` (sync_type `object_intake`); routes to a vertical (Section 9); upserts the parsed row into that vertical's `sf_<obj>_staging` table (idempotent on `sf_<obj>_id, source_system, import_batch`); runs the address link-probe to `properties`. The describe-driven mapping and link-probe logic already written in `DialysisProject/src/sf_object_sync.py` ports directly here.
- `?action=crawl-complete` — body is the batch summary. Writes the `crawl_run` row to `sf_sync_log` (this is the watermark store) and returns counts.

`GET` actions:

- `?action=watermark` — returns the last successful `crawl_run` timestamp, so Flow 1 can run incrementally when configured to.
- `?action=summary` — recent intake status for dashboards.

### 7.2 `intake-salesforce-files` — file intake

`POST` actions:

- `?action=manifest` — body is a list of discovered files (ContentDocument/ContentVersion metadata + linked entity). The function records each in `sf_files` with `ingestion_status = discovered`, deduplicates on `content_version_id` + `sha256`, and returns the subset whose bytes still need to be fetched (so Flow 2 only moves new versions).
- `?action=bytes` — body is one file's bytes (base64 for small files) or a `storage_path` (for files Power Automate uploaded straight to the bucket). The function verifies `sha256`, finalizes the `sf_files` row (`ingestion_status = stored`), and enqueues extraction through the existing `file_processor.py` / `document_classifier.py` engine.

### 7.3 `sf-promotion-worker` — provenance-gated promotion

A scheduled edge function (or Supabase cron) that drains `process_status = 'pending'` staging rows, runs the Section 6 promotion gate field-by-field, writes domain tables where the gate allows, and moves each staging row to `linked` / `held` / `review`. This is deliberately separate from intake so promotion cadence and intake cadence are independent.

---

## 8. Power Automate flow designs (exact)

Four flows, plus shared connection setup. All are built at `flow.microsoft.com` in the Production environment. Naming convention follows the existing repo flows (`Flagged Email -> To Do Task`, etc.): `SF -> LCC: <Purpose>`.

### 8.0 Prerequisites — connections (one-time)

**Salesforce connection.**

1. In Power Automate, **Data -> Connections -> + New connection**, search **Salesforce**.
2. Click **Create**. A browser window opens — sign in with the Northmarq account. This runs the **normal SSO flow**; complete it.
3. Power Automate stores the OAuth token and refreshes it automatically. Every Salesforce flow below reuses this one connection. If it ever shows "needs reauthentication," repeat steps 1–3 — that is the only manual touch this design ever needs.

**LCC HTTP secret.**

1. Generate a shared secret; store it in Power Automate as a **secure environment variable** named `LCC_PA_WEBHOOK_SECRET`.
2. Set the same value in the LCC edge function environment as `PA_WEBHOOK_SECRET` (the variable `_shared/auth.ts` already checks).
3. Every HTTP action below sends it as the header `X-PA-Webhook-Secret`.

**Endpoints.** All HTTP actions target the LCC edge function base URL, e.g. `https://<project>.functions.supabase.co/intake-salesforce` and `.../intake-salesforce-files`.

---

### 8.1 Flow 1 — `SF -> LCC: Object Sync`  (scheduled)

Pulls the Salesforce object graph and hands it to the LCC for staging. This is the workhorse and the one that replaces the superseded `sf_object_sync.py` crawl.

**Trigger — Recurrence.**

1. **+ Create -> Scheduled cloud flow.** Name: `SF -> LCC: Object Sync`.
2. **Repeat every:** `6` / `Month`. *This single setting is the cadence knob* — change it to run quarterly or monthly. (At monthly or tighter, also flip the mode variable in Step 2 to incremental.)

**Step 1 — Initialize variables.**

- `BatchId` (String) = `@{concat('crawl_', utcNow())}`
- `Mode` (String) = `full` (set to `incremental` for tighter cadences)
- `Watermark` (String) = empty
- `Objects` (Array) = the in-scope SObject API names, e.g. `["Property__c","Comp__c","Listing__c","Deal__c","Lease__c","Tenant__c","Account","Contact"]` — confirm the exact custom-object API names against the org once (the Salesforce connector's SObject dropdown lists them).

**Step 2 — Resolve watermark (incremental mode only).**

1. **Condition:** `Mode` is equal to `incremental`.
2. If yes: **HTTP GET** `…/intake-salesforce?action=watermark`, header `X-PA-Webhook-Secret`. **Set variable** `Watermark` = `@{body('HTTP_Watermark')?['watermark']}`.
3. If no (full crawl): leave `Watermark` empty — every record is pulled, which also reconciles deletes.

**Step 3 — Apply to each object** (`Objects`).

1. **Salesforce — Get records (V3).** *Salesforce object type:* the current item `@{items('Apply_to_each_Object')}`. *Filter Query:* leave blank when `Watermark` is empty; otherwise `LastModifiedDate > @{variables('Watermark')}`. The connector returns all fields and pages automatically.
2. **Apply to each (inner) — record.** Inside it, **Append to array variable** into a per-object `Records` buffer: `@{item()}` (the full record, untouched — the LCC side does the field mapping).
3. After the inner loop, the records need to go out in **batches of 200** to stay under the HTTP payload limit. Use a **Do until** that slices `Records` 200 at a time (`take()` / `skip()` expressions), and inside it:
   - **HTTP POST** `…/intake-salesforce?action=objects`
   - Headers: `Content-Type: application/json`, `X-PA-Webhook-Secret: @{variables('LCC_PA_WEBHOOK_SECRET')}`
   - Body:
     ```json
     {
       "payload_version": "sf-2026-05-v1",
       "batch_id": "@{variables('BatchId')}",
       "object_type": "@{items('Apply_to_each_Object')}",
       "records": @{take(skip(variables('Records'), variables('Offset')), 200)}
     }
     ```
   - **Configure run after** on the POST: on failure, append the failed slice to a `Failures` array (Flow 3 replays it) and continue — one bad batch never aborts the crawl.

**Step 4 — Close the batch.**

1. **HTTP POST** `…/intake-salesforce?action=crawl-complete`, body `{ "batch_id": "...", "mode": "...", "objects": [counts], "failures": @{variables('Failures')} }`.
2. The edge function writes the `crawl_run` row to `sf_sync_log` — that is the new watermark for the next incremental run.

**Step 5 — Failure notification.** A terminal **Condition**: if `Failures` is non-empty, send a Teams/email notice with the batch id and failed object/offset list.

---

### 8.2 Flow 2 — `SF -> LCC: File Discovery & Move`  (scheduled)

Walks the object graph to `ContentDocumentLink` / `ContentVersion` and moves the bytes for marketing flyers, OMs, and plans into Supabase Storage.

**Trigger — Recurrence.** Name: `SF -> LCC: File Discovery & Move`. Run it **after** Flow 1 (e.g. same cadence, offset by a few hours) so the object graph is fresh.

**Step 1 — Initialize variables.** `BatchId` = `@{concat('files_', utcNow())}`; `LinkedIds` (Array) empty.

**Step 2 — Get the records to inspect.** **HTTP GET** `…/intake-salesforce?action=file-targets` — the LCC side returns the `sf_property_id` / `sf_comp_id` / `sf_listing_id` / `sf_deal_id` values from staging that are in scope (new or changed since last file run). Set `LinkedIds` from the response. (Doing the "which records to check" selection on the LCC side keeps Flow 2 dumb and avoids re-deriving the graph in Power Automate.)

**Step 3 — Discover file links.** **Salesforce — Get records (V3)** on **ContentDocumentLink**, *Filter Query:* `LinkedEntityId IN (@{join(variables('LinkedIds'),',')})`. This returns the join rows: which `ContentDocumentId` is attached to which record.

**Step 4 — Resolve latest versions.** **Salesforce — Get records (V3)** on **ContentVersion**, *Filter Query:* `IsLatest = true AND ContentDocumentId IN (...)`. Returns `Id` (the ContentVersionId), `Title`, `FileExtension`, `ContentSize`, `VersionNumber`, `PathOnClient`, and the `VersionData` relative path.

**Step 5 — Send the manifest, get the to-fetch list.** **HTTP POST** `…/intake-salesforce-files?action=manifest` with the joined ContentDocumentLink + ContentVersion metadata. The edge function records every file in `sf_files` (`ingestion_status = discovered`), deduplicates on `content_version_id` + later `sha256`, and **returns only the ContentVersionIds whose bytes are not already stored** — so unchanged files are never re-moved.

**Step 6 — Move the bytes.** **Apply to each** over the to-fetch list:

1. Retrieve the file content for the `ContentVersionId`. Use the **Salesforce — Get record** action on `ContentVersion` for the row, or an **HTTP** action to the Salesforce REST path `…/services/data/v59.0/sobjects/ContentVersion/{Id}/VersionData` authorized with the Salesforce connection. *(File-byte retrieval is the one genuinely fiddly part of the Salesforce connector — see Open Item O-1; the recommended fallback is to have Power Automate write the bytes straight to the Supabase Storage bucket via the Supabase connector and pass only the `storage_path` onward.)*
2. **HTTP POST** `…/intake-salesforce-files?action=bytes` — for files under ~4 MB send `{ content_version_id, file_base64 }`; for larger files send `{ content_version_id, storage_path }` after the bucket upload. Header `X-PA-Webhook-Secret`.
3. The edge function verifies `sha256`, finalizes the `sf_files` row (`ingestion_status = stored`), and enqueues extraction.

**Step 7 — Filter by type (optional, recommended).** Before Step 6, screen ContentVersion rows by `FileExtension` (pdf, docx, xlsx, images) and `Title` keywords (flyer, brochure, marketing, OM, offering memorandum, plan, abstract) so the move targets marketing material and not every attachment.

**Step 8 — Failure handling.** Same pattern as Flow 1 — failed files append to `Failures`; Flow 3 replays.

---

### 8.3 Flow 3 — `SF -> LCC: Retry & Dead-letter`  (scheduled)

Keeps the pipeline self-healing so a transient failure never needs a human.

**Trigger — Recurrence:** every `6` / `Hour`.

**Step 1 — Pull the retry queue.** **HTTP GET** `…/intake-salesforce?action=retry-queue` — the LCC side returns `sf_sync_log` rows with `status = 'error'` and `retry_count < max` (max 5), plus failed `sf_files` rows.

**Step 2 — Apply to each failed item.** Re-POST it to the same endpoint it originally targeted (`?action=objects` or `?action=bytes`). On success the edge function flips `status` to `ok`; on failure it increments `retry_count` and sets `retried_at`.

**Step 3 — Dead-letter.** **Condition:** items at `retry_count >= max`. For those, **HTTP POST** `…/intake-salesforce?action=dead-letter` (marks them `status = 'dead'`) and send one consolidated alert listing each object type, Salesforce record URL, and last error — that is the only thing that ever reaches a human, and only after five automatic attempts.

---

### 8.4 Flow 4 — `SF -> LCC: On-demand Backfill`  (manual / button)

The historical sweep — the flow you run once to pull the back catalogue of old flyers and OMs, and again any time you want a scoped re-pull.

**Trigger — Manual (button / instant cloud flow)** with inputs: `object_types` (text), `since` (date, optional), `tenant_filter` (text, optional, e.g. `DaVita`), `include_files` (yes/no).

**Step 1 — Build the scope.** Compose a `Filter Query` from the inputs — e.g. `Tenant__c LIKE '%@{triggerBody()['tenant_filter']}%'`, optionally `AND LastModifiedDate > @{triggerBody()['since']}`.

**Step 2 — Run the object pull.** The same Apply-to-each-object + batched-POST logic as Flow 1, Step 3, but using the scoped filter and `BatchId = @{concat('backfill_', utcNow())}`.

**Step 3 — Run the file pull (if `include_files`).** The same logic as Flow 2, scoped to the records this backfill just staged.

**Step 4 — Report.** POST `?action=crawl-complete` with `mode = backfill`, then surface the counts back to the button result.

Backfills are safe to re-run: the `payload_hash` dedup in staging and the `content_version_id` + `sha256` dedup in `sf_files` mean a repeated backfill never duplicates a record or re-moves a file.

---

### 8.5 Shared conventions across all flows

- **Idempotency** is the LCC side's job — Power Automate may resend; the edge functions dedup on `payload_hash` (objects) and `content_version_id` + `sha256` (files). Re-running any flow is always safe.
- **Batch size 200** for object POSTs; **~4 MB inline / bucket-upload above** for files. These keep every HTTP action inside Power Automate and edge-function limits.
- **Configure run after** on every outward HTTP action so a single failure is captured into `Failures` and continues, rather than aborting the run.
- **No domain writes, ever** — every flow's only outputs are HTTP POSTs to the two intake endpoints (and, for large files, a Storage bucket upload). Promotion to canonical tables is exclusively the `sf-promotion-worker`'s job.
- **One Salesforce connection** shared by Flows 1–4; reauthenticating it (rare) is the entire human-maintenance surface of this design.

---

## 9. Multi-vertical routing

Power Automate pulls everything; the `intake-salesforce` edge function decides where each record belongs, record by record:

- **Dialysis signals** (property type / tenant contains dialysis, DaVita, Fresenius, clinic; or a known Medicare linkage) -> stage in `Dialysis_DB`.
- **Government signals** (GSA, federal agency tenant, government lease-number format) -> stage in `government`.
- **Cross-vertical objects** (Contact, Company, and any object with no clear vertical signal) -> stage in `LCC Opps`, where both domains can reference them.
- **Ambiguous** -> stage in `LCC Opps` and flag for review rather than guessing.

Routing rules live in a small config the edge function reads, so adding a vertical later is a config change, not a Power Automate change. Each database owns its own staging tables and its own `field_precedence_policy`, so promotion rules can differ per vertical.

---

## 10. Cadence and scheduling

| Flow | Default cadence | Knob |
|---|---|---|
| Object Sync | Every 6 months, full crawl | Recurrence interval; `Mode` var to switch full vs incremental |
| File Discovery & Move | Every 6 months, just after Object Sync | Recurrence interval |
| Retry & Dead-letter | Every 6 hours | Recurrence interval |
| On-demand Backfill | Manual | n/a |

A twice-a-year **full crawl** is the default because at that frequency a complete sweep is cheap and it reconciles deletes and merges for free (a `LastModifiedDate` watermark cannot see a deleted record; a full crawl can). If the cadence is tightened to monthly or faster, switch Object Sync to `incremental` mode and add a periodic full crawl (e.g. quarterly) purely to catch deletes.

---

## 11. Implementation sequence

1. **Staging parity** — apply the `sf_*_staging` migration to `government` and `LCC Opps` (it already exists on `Dialysis_DB`). Add the `sf_files` table and `salesforce-files` bucket to each.
2. **`intake-salesforce` edge function** — port the describe-driven mapping + link-probe from `sf_object_sync.py`; implement the `objects` / `crawl-complete` / `watermark` / `file-targets` / `retry-queue` actions and vertical routing.
3. **`intake-salesforce-files` edge function** — `manifest` / `bytes` actions; wire enqueue into the existing extraction engine.
4. **Power Automate Flow 1** — Object Sync. Validate end to end against the Tucson DaVita property as the fixture.
5. **Power Automate Flow 2** — File Discovery & Move. Resolve Open Item O-1 (file-byte retrieval) during this step.
6. **`sf-promotion-worker`** — the provenance gate. Seed `field_precedence_policy` with the Salesforce per-field authority from Section 6.3. Run in dry-run/report mode first.
7. **Flows 3 & 4** — Retry/Dead-letter and On-demand Backfill.
8. **Historical backfill** — run Flow 4 scoped to DaVita/Fresenius first, then broaden.
9. **Monitoring** — `v_sf_ingestion_status`, `v_sf_file_processing_status`, `v_sf_promotion_review` views; weekly QA sampling.

---

## 12. What is already built

- **`Dialysis_DB` staging tables** — `sf_sync_log`, `sf_property_staging`, `sf_comp_staging`, `sf_listing_staging`, `sf_deal_staging` (migration `create_sf_staging_tables.sql`, applied).
- **`sf_object_sync.py`** — the describe-driven SObject mapping, `payload_hash` dedup, and address link-probe. The SOQL-crawl half is superseded by Flow 1, but the **mapping and link-probe logic ports directly into the `intake-salesforce` edge function** and should not be rewritten.
- **The intake pattern itself** — `intake-receiver` + `_shared` (auth, multi-project clients) is the proven template for both new edge functions.
- **Provenance tables** — `field_precedence_policy`, `field_value_provenance` / `lease_field_provenance`, `record_field_overrides`, `manual_change_events` already exist; they need seeding and wiring, not building.

---

## 13. Open items and decisions

- **O-1 — Salesforce file-byte retrieval in Power Automate.** The Salesforce connector handles object queries cleanly but file *content* download (`ContentVersion.VersionData`) is awkward. Recommended resolution: have Power Automate write file bytes straight to the Supabase Storage bucket via the Supabase connector and pass only the `storage_path` to `intake-salesforce-files`. Needs a short spike during Step 5.
- **O-2 — Confirm Salesforce custom-object API names.** `Property__c` / `Comp__c` / `Listing__c` / `Deal__c` are best guesses; confirm against the connector's SObject list and update the `Objects` array and the edge-function mapping config.
- **O-3 — `government` and `LCC Opps` staging migrations.** Need the same shape applied (Step 1 of the sequence).
- **O-4 — RLS.** New `sf_*` tables and the `salesforce-files` bucket should be created RLS-aware (service-role-only) even though the broader RLS remediation on `Dialysis_DB` is a separate, deferred workstream.
- **O-5 — Promotion-worker host.** Confirm whether `sf-promotion-worker` runs as a scheduled edge function or a Supabase `pg_cron` job.
- **O-6 — Object history / Change Data Capture.** Out of scope for the twice-a-year cadence (the full crawl covers it). Revisit only if near-real-time sync is later required.
