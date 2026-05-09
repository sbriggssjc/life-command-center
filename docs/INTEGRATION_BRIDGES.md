# Integration Bridges (Phase 0)

This is the scaffold for moving LCC's data ingestion from ad-hoc Power
Automate flag flows toward continuous, governed enrichment from
Microsoft 365 / Salesforce / SharePoint.

## Why bridges, not a firehose

Salesforce is a shared corporate database, SharePoint contains sensitive
property documentation, and tenant-level Microsoft Graph application
permissions are not available in our org. The constraints push us toward a
model where every external data flow is:

- **Narrow** — one bridge per (source × object), not one giant connector.
- **Allowlisted** — each bridge declares the exact fields it may carry.
- **Audited** — every run produces a `bridge_runs` row with rows in /
  accepted / dropped + drop reasons.
- **Default-deny on writes** — `write_policy` is `'none'` unless explicitly
  bumped to `'minimal'` or `'full'`, and every write field must appear in
  `write_allowlist`.

## What this phase ships

Schema-only scaffold + a stub worker. No live bridges are wired up yet.

### Tables

| Table | Purpose |
|-------|---------|
| `connector_bridges` | One row per bridge: source, direction, ownership, allowlist, write_policy, schedule, watermark, status. |
| `bridge_runs` | Audit log: one row per execution, with rows in/accepted/dropped, drop_reasons histogram, watermark advancement, errors. |
| `enrichment_jobs` | Queue. Bridges enqueue follow-up work (entity link, classification, extraction) for the worker. |
| `sharepoint_documents` | Phase 2 prep — metadata-only index of SharePoint/OneDrive items. Bodies never stored. |
| `email_bodies` | Phase 3 prep — sensitive payload separated from `activity_events` so timeline rendering never joins it. |
| `meetings` | Phase 3 prep — calendar events with attendee + entity-link JSONB. |

### Views

| View | Purpose |
|------|---------|
| `v_bridge_freshness` | Powers `/api/admin/bridges`. Each bridge + most-recent run + seconds since last run/success. |

### Routes

All bridge logic lives in a single Vercel function — `api/bridges.js` —
dispatched by `?_route=worker|ingest|admin` (Hobby-plan budget: see
"Function count" below). Friendly URLs are mapped via `vercel.json`
rewrites:

| Friendly URL | Method | Internal | Purpose |
|--------------|--------|----------|---------|
| `/api/admin/bridges` | GET | `/api/bridges?_route=admin` | Freshness page. Returns `bridges[]` + `queue` counts. |
| `/api/enrichment-worker` | POST | `/api/bridges?_route=worker` | Drains up to N pending jobs. Supports `?dry=1` for queue inspection. |
| `/api/salesforce-changes` | POST | `/api/bridges?_route=ingest&_source=salesforce` | Phase 1+: receives a PA batch for a given `bridge=sf.<name>`. |

### Helpers (`api/_shared/bridges.js`)

- `getBridgeByKey(workspaceId, bridgeKey)`
- `applyAllowlist(bridge, sourceObjectName, payload)` — strips fields not on the bridge's read allowlist; returns kept/dropped + reasons.
- `enforceWriteAllowlist(bridge, sourceObjectName, payload)` — refuses the entire payload unless every field is in the bridge's `write_allowlist`. Refuses outright when `write_policy='none'`.
- `runBridgeIngest(bridge, opts, fn)` — opens a `bridge_runs` row, lets the callback report rows in/accepted/dropped + new watermark, closes the row, advances the bridge or increments `consecutive_failures`.
- `enqueueEnrichmentJob({...})` — push a job onto the queue.
- `claimPendingJobs(batchSize)` / `finishJob(job, outcome)` — worker dequeue + finalize with exponential backoff.

## Function count

We're on Vercel Hobby (12-function ceiling). Every bridge concern —
worker, ingest receivers, admin freshness — lives in one
`api/bridges.js` file dispatched by `_route` and (for ingest) `_source`.
Phase 2 SharePoint, Phase 3 Outlook/Calendar, and any future inbound
sources add new entries to the `INGEST_SOURCES` map and the `HANDLERS`
map inside that file. **No additional Vercel functions are needed for
the rest of the integration roadmap.**

## How a Phase 1+ source plugs in

Add an entry to `INGEST_SOURCES` in `api/bridges.js`:

```js
const INGEST_SOURCES = {
  salesforce: { 'sf.accounts': { object: 'Account', jobType: 'salesforce.account.upsert' }, ... },
  sharepoint: { 'sharepoint.properties': { object: 'DriveItem', jobType: 'sharepoint.document.classify' } },
};
```

Add a handler to `HANDLERS`:

```js
import { handleSharepointDocumentClassify } from './_shared/bridge-handlers-sharepoint.js';
const HANDLERS = {
  ...,
  'sharepoint.document.classify': handleSharepointDocumentClassify,
};
```

Add a `vercel.json` rewrite if you want a friendly URL:

```json
{ "source": "/api/sharepoint-changes",
  "destination": "/api/bridges?_route=ingest&_source=sharepoint" }
```

That's it — one function, one rewrite per source.

## Write-back policy (current decision)

- Default `write_policy = 'none'`.
- Three outbound write surfaces will exist long-term:
  1. `salesforce.task.close` (already lives at `PA_COMPLETE_TASK_URL`).
  2. `salesforce.touchpoint.log` — minimal row: WhoId/WhatId, Subject like
     `LCC Touchpoint #<action_id>`, ActivityDate, Type, plus a description
     field with an LCC deep-link reference.
  3. `salesforce.lead.notify` (already lives at `PA_NEW_LEAD_WEBHOOK_URL`).
- No property-ownership detail flows back until the Listing stage; the
  marketing team handles that surface in Salesforce directly.
- Any new write surface requires (a) a code change adding it to
  `write_allowlist`, (b) flipping `write_policy` to `'minimal'` or
  `'full'`, and (c) review.

## Phase 0 → Phase 1 hand-off

Phase 1 (now shipped) seeds the first bridges into `connector_bridges`:

- `sf.accounts`, `sf.contacts`, `sf.opportunities`, `sf.activities`, with
  field allowlists derived from the LCC scaffolding decisions.
- Power Automate flows on a 5-minute schedule that POST batches to
  `/api/salesforce-changes?bridge=sf.<name>`.
- Worker handlers for `salesforce.*.upsert` and `salesforce.activity.append`
  replace the `stubHandler`.

Phase 2 wires `sharepoint.properties` (the `/Properties/<Letter>/<City,
State>/` walker). Phase 3 adds `outlook.*` and `calendar.*`. Phase 5 is
the proactive-synthesis "agent" worker on top of the populated stream.

## Operational notes

- `enrichment_jobs.status='pending'` is the queue. The partial index
  `ix_enrichment_jobs_pending` keeps the worker dequeue cheap as
  done/error rows accumulate.
- `bridge_runs` is append-only and grows roughly proportional to the
  number of bridge executions × retention. A periodic prune (e.g. >90
  days) is a future ops task.
- `connector_bridges.consecutive_failures` is incremented on every error
  run and reset on success — easy hook for alerting once Teams alerts
  are wired (Phase 1).
