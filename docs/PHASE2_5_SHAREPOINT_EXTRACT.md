# Phase 2.5 — SharePoint Document Extract

Phase 2 indexed the entire `Shared Documents` library on TeamBriggs20 and
landed every file in `sharepoint_documents` with `extraction_status='pending'`.
Phase 2.5 adds the on-demand body fetch — when a user clicks "Extract this OM"
on the property sidebar, LCC kicks PA, PA downloads the file and pipes it
into LCC's existing intake pipeline, then PA reports back.

LCC code never holds a SharePoint token. Same architectural pattern as the
inbound bridges: PA owns the M365 connection, LCC orchestrates.

> **Function count: still 12.** Phase 2.5 plugs into `api/bridges.js` as
> `_route=sp_extract` (default action=`trigger`, plus `action=callback`).
> No migration — the `extraction_status` column on `sharepoint_documents`
> existed since Phase 0; we use it.

## What ships

| Component | Path | Purpose |
|-----------|------|---------|
| Helper   | `api/_shared/sharepoint-extract.js` | `triggerSharepointExtract()` + `handleSharepointExtractCallback()`. |
| Router   | `api/bridges.js` (updated) | Adds `_route=sp_extract` with action=trigger / action=callback. |
| Rewrites | `vercel.json` | `/api/sharepoint-extract` (trigger) and `/api/sharepoint-extract-callback`. |

## The flow

```
┌─ user clicks "Extract" in LCC ─┐
│                                │
│ POST /api/sharepoint-extract   │
│   ?id=<doc-uuid>&force=1?      │
│                                │
│ • Reads sharepoint_documents   │
│ • Validates bridge=active      │
│ • POSTs PA_SP_EXTRACT_URL with │
│   { doc_id, drive_id, item_id, │
│     web_url, doc_type, ... }   │
│ • Sets status='queued'         │
│ • Returns 202                  │
└───────────────┬────────────────┘
                │
                ▼
       PA flow downloads via Graph
       Routes to extractor (PDF/DOCX/...)
       POSTs result to existing intake
       (e.g. /api/intake-pdf, /api/intake-extract)
       gets back intake_id
                │
                ▼
   POST /api/sharepoint-extract-callback
     { doc_id, status: 'done',
       intake_id, extracted_doc_type? }
                │
                ▼
   • Updates sharepoint_documents:
     extraction_status='done'
     extracted_at=now()
     metadata.intake_id=<id>
     doc_type=<refined> (optional)
   • UI can now link doc → intake row
```

## Activation steps

1. **Build the PA flow** (one-time, per workspace or shared):
   - HTTP trigger → receives `{ doc_id, drive_id, item_id, web_url, doc_type, callback_url, ... }`
   - GET `https://graph.microsoft.com/v1.0/drives/{driveId}/items/{itemId}/content` (delegated SP connection)
   - Branch on `doc_type`:
     - `om` → existing OM extractor (the project's `intake-om-pipeline.js`
       already handles OMs; pass the binary to `/api/intake-pdf`)
     - `lease` → if a lease extractor exists, route there; else mark
       `status='skipped'` and let the user handle it manually
     - others → `status='skipped'` for v1
   - Capture `intake_id` from the intake response
   - POST to `callback_url` (LCC's `/api/sharepoint-extract-callback`)
     with `{ doc_id, status, intake_id, extracted_doc_type? }`
   - Save the flow's HTTP trigger URL.

2. **Set env vars**:
   - `PA_SP_EXTRACT_URL` = the PA flow's HTTP trigger URL.
   - `LCC_APP_BASE_URL` = your LCC base URL (so the callback URL is
     resolvable). Already set if Phase 4 is using it.

3. **Activate the bridge** (Phase 2 seed left it paused):
   ```sql
   update connector_bridges
   set status='active'
   where workspace_id='<ws>'
     and bridge_key='sharepoint.properties.extract';
   ```

4. **Wire the UI button**. The property sidebar's "Extract latest OM"
   action calls:
   ```
   POST /api/sharepoint-extract?id=<sharepoint_documents.id>
     Headers: X-LCC-Key, X-LCC-User-Email
   ```
   Response is 202 immediately (the actual work runs async in PA).

## Calling the trigger

```http
POST /api/sharepoint-extract?id=<doc-uuid>
X-LCC-Key:        <key>
X-LCC-Workspace:  <workspace-uuid>
X-LCC-User-Email: <caller@northmarq.com>
```

Optional:
- `?force=1` — re-trigger even if `extraction_status` is already `queued`
  or `done` (use for "re-extract this file, it changed").

Response codes:
- `202` — queued; PA is doing the work.
- `200 already=done` — already extracted; UI can link to existing intake.
- `200 already=queued` — extraction in flight; UI shows the spinner.
- `404` — doc not found OR bridge not seeded.
- `409` — bridge is paused; activate it via SQL above.
- `502` — PA webhook returned non-2xx; check `PA_SP_EXTRACT_URL` and the
  flow's run history.
- `503` — `PA_SP_EXTRACT_URL` env var not set.

## Callback contract

PA must POST to `/api/sharepoint-extract-callback` with:

```json
{
  "doc_id":              "<sharepoint_documents.id>",
  "workspace_id":        "<workspace-uuid>",
  "status":              "done" | "error" | "skipped",
  "intake_id":           "<staged_intake_promotions.id>",
  "extracted_doc_type":  "om" | "lease" | "comp" | "ownership_research" | "financial" | "marketing" | "other",
  "text_preview":        "<first 500 chars for UI tooltip>",
  "error":               "<message; required when status='error'>",
  "extracted_at":        "<ISO timestamp; defaults to now>"
}
```

Headers:
- `X-LCC-Key: <LCC_API_KEY>` — same key the inbound flows use.

What happens server-side:
- `extraction_status` ← `status`.
- `extracted_at` ← provided value or `now()`.
- `metadata.intake_id` ← linked intake row (rendered as a sidebar
  affordance).
- `metadata.text_preview` ← stored truncated to 500 chars.
- If `extracted_doc_type` differs from the heuristic doc_type set by the
  Phase 2 classifier, the column is updated to the refined value.
- On success, any prior `metadata.extract_error` is cleared.

## Verifying

```sql
-- Recently extracted, with their intake link
select name, doc_type, extraction_status, extracted_at,
       metadata->>'intake_id' as intake_id,
       metadata->>'refined_doc_type' as refined
from sharepoint_documents
where workspace_id='<ws>' and extraction_status in ('done','error')
order by extracted_at desc nulls last
limit 30;

-- Stuck-in-queue (likely PA flow failure to call back)
select name, web_url, metadata->>'extract_requested_at' as queued_at
from sharepoint_documents
where workspace_id='<ws>' and extraction_status='queued'
  and (metadata->>'extract_requested_at')::timestamptz < now() - interval '30 min'
order by queued_at;

-- Error count by reason
select metadata->>'extract_error' as reason, count(*)
from sharepoint_documents
where workspace_id='<ws>' and extraction_status='error'
group by 1 order by 2 desc;
```

## What's deferred

- **Stuck-job sweep.** A doc in `extraction_status='queued'` that never
  gets a callback (PA flow crashed, callback URL wrong) sits there
  forever. The enrichment-worker's stuck-job recovery pattern (Phase 0)
  could be applied: a periodic sweep flips `queued` → `pending` if
  `extract_requested_at` is older than N minutes. Easy follow-up; for
  now, recover via SQL when noticed.
- **Bulk extract.** Today the trigger is per-doc. A
  `?_route=sp_extract&action=bulk` action that queues all
  `extraction_status='pending'` rows for a property would speed up
  ingest of a freshly indexed tenant. Same handler logic, just looped.
- **Auto-extract on classify.** When the Phase 2 classifier lands a
  `doc_type='om'` row, it could auto-fire the extract instead of
  waiting for a user click. Two-line addition to the SP classify
  handler — hold until we see the data and decide whether the OM volume
  warrants automatic processing.
- **Per-extract bridge_runs.** Each extract isn't currently logged in
  `bridge_runs` (those are for batch ingest). For unified outbound
  auditing, the trigger could open a one-row bridge_run; the callback
  would close it. Skip for v1 — the
  `sharepoint_documents.metadata.extract_*` fields are already a
  per-doc audit trail.
- **Credential-free direct download.** If/when LCC obtains a SharePoint
  delegated token (e.g. via the user's JWT), the worker could
  short-circuit PA entirely. That's contingent on the auth roadmap;
  Phase 2.5 stays PA-routed for now.
