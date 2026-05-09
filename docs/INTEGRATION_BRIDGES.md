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

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/bridges` | GET | Freshness page. Returns `bridges[]` + `queue` counts for the caller's workspace. |
| `/api/enrichment-worker` | POST | Drains up to N pending jobs. Phase 0 calls a stub handler — Phase 1+ replaces with real handlers per `job_type`. Supports `?dry=1` for queue inspection. |

### Helpers (`api/_shared/bridges.js`)

- `getBridgeByKey(workspaceId, bridgeKey)`
- `applyAllowlist(bridge, sourceObjectName, payload)` — strips fields not on the bridge's read allowlist; returns kept/dropped + reasons.
- `enforceWriteAllowlist(bridge, sourceObjectName, payload)` — refuses the entire payload unless every field is in the bridge's `write_allowlist`. Refuses outright when `write_policy='none'`.
- `runBridgeIngest(bridge, opts, fn)` — opens a `bridge_runs` row, lets the callback report rows in/accepted/dropped + new watermark, closes the row, advances the bridge or increments `consecutive_failures`.
- `enqueueEnrichmentJob({...})` — push a job onto the queue.
- `claimPendingJobs(batchSize)` / `finishJob(job, outcome)` — worker dequeue + finalize with exponential backoff.

## How a Phase 1+ bridge will plug in

```js
// api/salesforce-changes.js  (illustrative — not in this PR)
import { authenticate } from './_shared/auth.js';
import { getBridgeByKey, applyAllowlist, runBridgeIngest, enqueueEnrichmentJob }
  from './_shared/bridges.js';

export default async (req, res) => {
  const user = await authenticate(req, res); if (!user) return;
  const bridge = await getBridgeByKey(user.memberships[0].workspace_id, 'sf.accounts');
  if (!bridge || bridge.status !== 'active') return res.status(404).json({});

  const incoming = req.body?.records || [];
  await runBridgeIngest(bridge, { externalRunId: req.body?.runId }, async (report) => {
    let maxLastModified = bridge.watermark?.last_modified || null;
    for (const raw of incoming) {
      report.in();
      const { kept, dropped, dropReasons } = applyAllowlist(bridge, 'Account', raw);
      if (dropped) for (const r of Object.values(dropReasons)) report.drop(0, r);
      if (!kept.Id) { report.drop(1, 'missing_id'); continue; }
      // ...upsert kept fields into LCC...
      await enqueueEnrichmentJob({
        workspaceId: bridge.workspace_id, bridge,
        jobType: 'salesforce.account.upsert',
        externalId: kept.Id, payload: kept
      });
      report.accept();
      if (raw.LastModifiedDate > (maxLastModified || '')) maxLastModified = raw.LastModifiedDate;
    }
    report.watermark({ last_modified: maxLastModified });
  });
  res.status(200).json({ ok: true });
};
```

The worker side replaces `stubHandler` in `api/enrichment-worker.js` with
a real handler keyed by `job_type`.

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

Phase 1 (next) seeds the first bridges into `connector_bridges`:

- `sf.accounts`, `sf.contacts`, `sf.opportunities`, `sf.activities`, with
  field allowlists derived from the LCC scaffolding decisions.
- Power Automate flows on a 5-minute schedule that POST batches to
  `/api/salesforce-changes?bridge=sf.<name>` (new endpoint added in
  Phase 1).
- Worker handlers for `salesforce.*.upsert` and `salesforce.activity.append`
  replace `stubHandler`.

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
