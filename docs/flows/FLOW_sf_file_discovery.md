# FLOW — `SF → LCC: File Discovery` (Power Automate collector)

> **Purpose**: The scheduled Power Automate flow that discovers Salesforce Files
> (OMs / flyers / financials attached to Comp / Listing / Deal records) and lands
> them in Supabase `sf_files`, then moves the bytes — the **PA-collector**
> replacement for the retired server-side Connected-App sweep (W3.7c).
> **Audience**: Claude Cowork / Flow administrators (Scott builds this at
> flow.microsoft.com).
> **Companion**: `flow-sf-file-discovery.json` (skeleton), `POWER_AUTOMATE_UPDATE_GUIDE.md`
> (conventions), `SALESFORCE_LCC_INGESTION_PLAN.md` §2 + §8.2 (why PA, Flow-2 design).
> **Last updated**: 2026-07-31.

---

## Why this flow exists (the authentication reality)

The Northmarq Salesforce org is **SSO-gated** and we have **no admin rights to
provision a Connected App** (a client-credentials login returns
`INVALID_SSO_GATEWAY_URL` — see `SALESFORCE_LCC_INGESTION_PLAN.md` §2). So there
is **no server-side path** for LCC to read Salesforce directly. The W3.7b
`?action=discover` / `?action=fetch` sweep was built on Connected-App creds and
is therefore **inert forever** — it is now **retired (HTTP 410)**.

**Power Automate is the only Salesforce transport.** Its Salesforce connector is
authenticated **once, interactively** (the normal SSO browser flow); every
scheduled run afterward uses that stored, auto-refreshed connection. PA reads
Salesforce and POSTs to the LCC edge webhook. **PA is transport only — it never
writes a domain table.** All dedup / routing / storage / extraction happen on the
LCC side.

```
  Salesforce (SSO org)
        |  Salesforce connector (interactive OAuth, auto-refresh)
        v
  POWER AUTOMATE  "SF → LCC: File Discovery"  (scheduled, weekly)
        |  HTTPS, X-PA-Webhook-Secret
        v
  intake-salesforce-files edge fn  (the brain)
     GET  ?action=discovery-worklist   → which staged ids still need files
     POST ?action=discover-webhook     → record discovered file metadata
     POST ?action=file-content         → store the bytes, queue extraction
        |
        v
  sf_files (both DBs) → ?action=stage-queued (hourly cron) → /api/intake/stage-om
```

---

## Prerequisites (one-time)

1. **Salesforce connection** — Power Automate → **Data → Connections → + New
   connection → Salesforce → Create**; sign in with the Northmarq account (runs
   the normal SSO flow). This one connection is reused by every action below. The
   only manual maintenance this flow ever needs is re-authenticating it if it
   ever shows "needs reauthentication."
2. **Webhook secret** — the same value already used by the other SF flows. Store
   it in PA as a secure environment variable `LCC_PA_WEBHOOK_SECRET`; it must
   equal the edge function's `PA_WEBHOOK_SECRET`. Sent on every HTTP action as the
   header **`X-PA-Webhook-Secret`**.
3. **Endpoint base** — the `intake-salesforce-files` edge function is deployed on
   the **Dialysis_DB** project and reaches all domains via its `DIA_/GOV_`
   service-role env vars, so PA targets **one** base URL:
   `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/intake-salesforce-files`
   (one call covers **both** gov and dia — the worklist returns each id tagged
   with its `vertical`).

---

## Trigger — Recurrence (weekly)

- **+ Create → Scheduled cloud flow.** Name: `SF → LCC: File Discovery`.
- **Repeat every:** `1` / `Week` (the single cadence knob — the file corpus
  changes slowly; weekly keeps it fresh without hammering SF).
- Suggested time: a low-traffic window, e.g. Sunday 06:00 America/Chicago.

---

## Steps

### Step 1 — Get the worklist (which ids still need files)

**HTTP — GET**
`@{concat(variables('FnBase'), '/intake-salesforce-files?action=discovery-worklist&limit=150&stale_days=7')}`
Header: `X-PA-Webhook-Secret: @{variables('LCC_PA_WEBHOOK_SECRET')}`

The edge function returns, for **both domains**, staged Comp/Listing/Deal SF ids
that (a) have **no `sf_files` row yet** and (b) have **not been attempted in
`stale_days` days** — and it **stamps each served id as attempted** (a lease), so
an id that yields no files is not re-served next week. Response shape:

```json
{
  "ok": true,
  "count": 150,
  "by_vertical": { "gov": { "served": 90, "by_object": { "listing": {"served": 60}, "deal": {"served": 30} } },
                   "dia": { "served": 60, "by_object": { "listing": {"served": 40}, "deal": {"served": 20} } } },
  "worklist": [
    { "vertical": "gov", "object_type": "listing", "sf_type": "Listing__c", "linked_entity_sf_id": "a0jVs000005AqaLIAS" }
  ]
}
```

`limit` bounds one run (default 200, cap 1000, split evenly across the domains
present). Run weekly and the backlog drains in a few passes; because served ids
are leased for `stale_days`, consecutive runs pick up different ids.

**Parse JSON** the response and iterate `worklist`.

### Step 2 — Per worklist id: read its Salesforce Files

**Apply to each** `@{body('Parse_Worklist')?['worklist']}` (set concurrency to
**1–5** to respect SF connector limits):

1. **Salesforce — Get records (V3)** on **ContentDocumentLink**
   *Filter Query:* `LinkedEntityId = '@{items('Apply_to_each')?['linked_entity_sf_id']}'`
   → returns the `ContentDocumentId`s attached to this record.
   *(ContentDocumentLink must be filtered by a bounded `LinkedEntityId` — an
   unbounded scan is refused by Salesforce.)*
2. **Apply to each (inner)** over those documents — **Salesforce — Get records
   (V3)** on **ContentVersion**
   *Filter Query:* `ContentDocumentId = '@{items('Apply_to_each_Doc')?['ContentDocumentId']}' AND IsLatest = true`
   → the latest version's `Id` (ContentVersionId), `Title`, `FileExtension`,
   `PathOnClient`, `VersionNumber`, `ContentSize`.
3. **Filter** to document extensions (`pdf`, `docx`, `doc`, `xlsx`, `xls`) — skip
   images/thumbnails so a Listing Thumbnail never masquerades as an OM. (The edge
   function re-applies this gate, so it is belt-and-suspenders.)
4. **Append to array** `DiscoveredFiles` one object per kept version:
   ```json
   {
     "vertical": "@{items('Apply_to_each')?['vertical']}",
     "linked_entity_type": "@{items('Apply_to_each')?['sf_type']}",
     "linked_entity_id": "@{items('Apply_to_each')?['linked_entity_sf_id']}",
     "content_document_id": "@{items('Apply_to_each_Doc')?['ContentDocumentId']}",
     "content_version_id": "@{items('Apply_to_each_Ver')?['Id']}",
     "title": "@{items('Apply_to_each_Ver')?['Title']}",
     "file_name": "@{items('Apply_to_each_Ver')?['PathOnClient']}",
     "extension": "@{items('Apply_to_each_Ver')?['FileExtension']}",
     "version_number": "@{items('Apply_to_each_Ver')?['VersionNumber']}",
     "size_bytes": "@{items('Apply_to_each_Ver')?['ContentSize']}"
   }
   ```

### Step 3 — Record the discovered metadata (dedup on LCC side)

Post `DiscoveredFiles` in **batches of ≤200** (Do-until slicing with
`take()`/`skip()`, mirroring the object-sync flow):

**HTTP — POST** `…/intake-salesforce-files?action=discover-webhook`
Header: `X-PA-Webhook-Secret`. Body:
```json
{ "batch_id": "@{concat('sf-files-', utcNow())}", "files": @{take(skip(variables('DiscoveredFiles'), variables('Offset')), 200)} }
```
The edge function maps each file → an `sf_files` `ingestion_status='discovered'`
row, **deduping on `content_version_id`** (a file already known is skipped), and
routes each to gov/dia by the item's `vertical`. Response reports
`discovered` / `skipped_existing` / `skipped_invalid` and returns nothing to
fetch that already has bytes. **Re-running is always safe** (idempotent).

### Step 4 — Move the bytes for the newly-discovered files

For each file that was newly `discovered` (i.e. not `skipped_existing`):

1. **Salesforce — Get file content** (or an **HTTP** GET to
   `…/services/data/v60.0/sobjects/ContentVersion/@{content_version_id}/VersionData`
   authorized with the Salesforce connection) → the raw bytes.
2. **Compose** `@{base64(body('Get_file_content'))}` and (recommended) a sha256
   for integrity.
3. **HTTP — POST** `…/intake-salesforce-files?action=file-content`
   Header: `X-PA-Webhook-Secret`. Body:
   ```json
   {
     "vertical": "@{items('Apply_to_each_File')?['vertical']}",
     "content_version_id": "@{items('Apply_to_each_File')?['content_version_id']}",
     "sha256": "@{items('Apply_to_each_File')?['sha256']}",
     "file_base64": "@{outputs('Compose_Base64')}"
   }
   ```
   The edge function verifies **sha256** (mismatch → 422, the bad bytes never
   reach the extractor) and a **15 MB size cap** (over → 413; for a larger file
   use `?action=upload-url` + a Supabase-connector bucket PUT instead of a base64
   body), stores to the `salesforce-files` bucket, and flips the row to
   `stored` / `extraction_status='queued'`. **Idempotent on
   `content_version_id`** — a row already stored is a no-op.

### Step 5 — Extraction is automatic (no PA action)

The existing **`sf-files-extract-queued-hourly`** cron drains
`extraction_status='queued'` rows through `?action=stage-queued` →
`/api/intake/stage-om` (pdf-parse + AI classification + property matching). The
flow does **not** call it.

### Step 6 — Failure handling

Put **Configure run after** on every outward HTTP/SF action so a single failure
is captured into a `Failures` array and the run continues (one bad record never
aborts the batch). A terminal **Condition**: if `Failures` is non-empty, send a
Teams/email notice with the failing worklist ids and last error.

---

## Cadence & tuning

| Knob | Where | Default |
|---|---|---|
| Run cadence | Recurrence interval | Weekly |
| Batch size per run | `?limit=` on Step 1 | 150 (cap 1000) |
| Re-attempt window | `?stale_days=` on Step 1 | 7 days |
| Discover-webhook batch | Step 3 slice size | 200 |
| File size cap (base64 lane) | edge `FILE_CONTENT_MAX_BYTES` | 15 MB |

Backfill is just the same flow run a few times (or `limit` raised): the worklist
lease guarantees each run advances to un-attempted ids, and every LCC endpoint is
idempotent, so nothing is ever double-inserted or re-moved.

---

## Verify (post-build)

1. **Dry probe:** GET `?action=discovery-worklist&limit=5` → confirm `worklist`
   has both `gov` and `dia` items and `by_vertical` counts are non-zero.
2. **Fort Wayne acceptance** (gov listing `a0jVs000005AqaLIAS`): after a run,
   `sf_files` (gov) should hold its OM with `linked_entity_type='Listing__c'`,
   `sf_listing_id='a0jVs000005AqaLIAS'`, `ingestion_status='stored'`, and within
   the hour `extraction_status='extracted'`. Then the W3.7 OM-comp resolver reaches
   it via the comp→listing traversal.
3. **Idempotence:** re-run the flow — `discover-webhook` reports
   `skipped_existing` for the same files; `file-content` returns `idempotent:true`.
