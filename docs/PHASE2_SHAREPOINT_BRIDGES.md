# Phase 2 — SharePoint Properties Bridge

Phase 2 indexes the entire `Shared Documents` library on the
**TeamBriggs20** SharePoint site (`northmarq.sharepoint.com/sites/TeamBriggs20`)
into `sharepoint_documents`, with rich path-parsing for files under
`/Properties/<TenantName>/<City, State>/...` and best-effort linkage to
LCC tenant + property entities.

## What ships

| Component | Path | Purpose |
|-----------|------|---------|
| Migration | `supabase/migrations/20260604000000_phase2_sharepoint_bridge.sql` | Replaces `sharepoint_documents.tenant_letter char(1)` with `tenant_name text` (Phase 0 had the wrong shape). Adds `match_confidence numeric` column + low-confidence index. |
| Seed     | `supabase/seeds/phase2_sharepoint_bridges.sql` | Two bridge rows: `sharepoint.properties.index` (active, 30-min) and `sharepoint.properties.extract` (paused, Phase 2.5). |
| Handler  | `api/_shared/bridge-handlers-sharepoint.js` | `handleSharepointDocumentClassify` — path-parses, classifies doc_type, links tenant + property entities with confidence. |
| Router   | `api/bridges.js` (updated) | Adds `sharepoint` to `INGEST_SOURCES` + handler to `HANDLERS`. New per-bridge `idField` and `skipIf` config so the receiver works generically. Body-supplied watermark (Graph `deltaLink`) takes precedence over per-row watermarks. |
| Rewrite  | `vercel.json` | `/api/sharepoint-changes` → `/api/bridges?_route=ingest&_source=sharepoint`. |

> **Function count:** zero new Vercel functions. All Phase 2 logic plugs
> into the existing `api/bridges.js` router.

## What this gives you on first run

After the seed runs and the PA flow does its first sweep:

```sql
-- Every indexed file in the library
select doc_type, count(*) from sharepoint_documents
where workspace_id='<ws>' group by doc_type order by 2 desc;

-- Files we couldn't confidently link to a property entity
select name, parent_path, tenant_name, city, state, match_confidence
from sharepoint_documents
where workspace_id='<ws>' and match_confidence is not null and match_confidence < 0.7
order by indexed_at desc;

-- All OMs for a tenant
select name, parent_path, web_url, last_modified_at
from sharepoint_documents
where workspace_id='<ws>' and tenant_name ilike 'Acme Properties'
  and doc_type='om'
order by last_modified_at desc;

-- Property entity → its document set
select doc_type, count(*) from sharepoint_documents
where workspace_id='<ws>' and property_entity_id='<entity uuid>'
group by doc_type;
```

## How the classifier links entities

For each driveItem coming through the ingest receiver, the worker:

1. **Parses the path.** Strips Graph's `/drive/root:` prefix and matches
   `/Properties/<TenantName>/<City, State>/...`. Files outside that
   pattern (templates, comps, market reports at the library root) are
   indexed with `tenant_name=null, city=null, state=null,
   doc_type='other'` — searchable but not linked.

2. **Classifies `doc_type`** from the filename via heuristic regex:
   `om`, `lease`, `comp`, `ownership_research`, `financial`,
   `marketing`, or `other`. Refined by Phase 2.5's body extractor.

3. **Links the tenant entity** by canonical-name match on the parsed
   `<TenantName>` against `entities` (organizations) in the workspace.
   Match is exact on `canonical_name` (lowercased, common suffixes like
   `LLC` / `Properties` stripped). Null if no match.

4. **Links the property entity** by `(city, state)` match against asset
   entities, with a confidence score:

   | Candidates | Action | `match_confidence` |
   |------------|--------|--------------------|
   | 1 | Link directly. | `0.9` |
   | 2+, one matches tenant name | Link to that one. | `0.65` |
   | 2+, none preferred | Link to first; flag for review. | `0.35` |
   | 0 | No link. | `null` |

   The low-confidence index `ix_sharepoint_documents_low_confidence`
   makes "files needing human review" a single fast query. The UI can
   render a "click to confirm" affordance for `match_confidence < 0.7`.

## Power Automate flow spec

One PA flow per workspace, scheduled every 30 minutes. Uses Graph
**delta queries** so it's incremental — the watermark stores the
`@odata.deltaLink` Graph returns at the end of each batch, and the next
run starts from there.

### Initial setup (one-time)

1. **Resolve site + drive IDs** with these Graph calls (run once,
   record the IDs in the flow's variables):

   ```http
   GET https://graph.microsoft.com/v1.0/sites/northmarq.sharepoint.com:/sites/TeamBriggs20
   ```
   Returns `id` like `northmarq.sharepoint.com,abc123,def456`.

   ```http
   GET https://graph.microsoft.com/v1.0/sites/{siteId}/drives
   ```
   Find the `Documents` drive; record its `id`.

2. **First-run delta** (no token — returns everything in pages):

   ```http
   GET https://graph.microsoft.com/v1.0/drives/{driveId}/root/delta
   ```

### Recurring flow (every 30 min)

```
Recurrence (30 min)
  ↓
Initialize variable: deltaUrl
  ← if first run: "https://graph.microsoft.com/v1.0/drives/{driveId}/root/delta"
  ← else:        the @odata.deltaLink stored in the bridge watermark
  (read via GET /api/admin/bridges, parse bridges[*].watermark.delta_link)
  ↓
Do until deltaUrl is null:
  HTTP — GET deltaUrl
    ↓
  Filter the response value[] to file driveItems (folder is null)
    ↓
  HTTP — POST /api/sharepoint-changes?bridge=sharepoint.properties.index
    Headers: X-LCC-Key, Content-Type: application/json
    Body:
      {
        "bridge": "sharepoint.properties.index",
        "workspaceId": "<workspace-uuid>",
        "runId": "@{workflow().run.name}",
        "records": <filtered value[]>,
        "watermark": { "delta_link": "@{body('HTTP')['@odata.deltaLink']}" }
      }
    Note: send watermark only on the LAST page of the loop (when
    deltaLink is present, not nextLink). The body-watermark takes
    precedence in the bridge so partial-page checkpoints are avoided.
    ↓
  Set deltaUrl ← @odata.nextLink (continues paging) OR null when
  @odata.deltaLink is set instead (loop exits).
```

### Allowlist (carried fields)

```
id, name, webUrl, size, eTag,
createdDateTime, lastModifiedDateTime,
file, folder, parentReference, lastModifiedBy
```

Anything else Graph returns is dropped at ingest. `parentReference` is
allowed as a nested object — the handler reads `.driveId` and `.path`
from it. Folders that slip through the PA filter are dropped at the
receiver (`config.skipIf` returns true for `folder`).

## Deployment steps

1. **Apply the Phase 2 migration** to OPS Supabase (`xengecqvemvfknjvbvrq`).
2. **Run the seed** per workspace:
   ```sh
   psql "$OPS_SUPABASE_DB_URL" \
     -v workspace_id="'<workspace-uuid>'" \
     -f supabase/seeds/phase2_sharepoint_bridges.sql
   ```
3. **Build the PA flow** per the spec above.
4. **Verify** by querying `bridge_runs` and `sharepoint_documents` after
   the first tick. Initial sweep of the whole library may produce
   thousands of rows — Graph paginates at 200 items per call, so the
   PA loop will run for several minutes on first run, then settle into
   delta mode.

## What's deferred to Phase 2.5

- `sharepoint.properties.extract` — on-demand body fetch + extractor
  pipeline. Triggered when a user clicks "extract latest OM" on the
  property sidebar. Will use the existing `intake-om-pipeline.js` to
  produce a staged_intake_promotions row that the user can review.
- **Smarter property linkage** — the current `(city, state, tenant)`
  matcher is intentionally simple. A v2 should consult
  `entities.metadata.salesforce.account_id` and address-token overlap
  against `parent_path`'s street segment when the user nests deeper
  than `<City, State>`.
- **Library-wide doc type refinement** — files outside `/Properties/`
  currently default to `doc_type='other'`. A small classifier could
  bucket templates / market reports / comps from the path & filename
  (e.g. `/Templates/...`, `/Market Reports/...`).
- **SharePoint user mapping** — `lastModifiedBy.user.displayName` is
  stored in metadata but not linked to LCC users. Phase 1.5's
  `salesforce_user_mappings` table can be extended to a generic
  `external_user_mappings(source_system, external_id, user_id)` and
  shared across SF + SharePoint + Outlook + Calendar.
