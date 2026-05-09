// ============================================================================
// Salesforce Changes Receiver — Phase 1
// Life Command Center
// ----------------------------------------------------------------------------
// POST /api/salesforce-changes?bridge=sf.<name>
//
// Power Automate flows scheduled every 5 minutes per workspace POST batches
// of changed records here. This endpoint is intentionally dumb:
//
//   1. Authenticate (X-LCC-Key from PA, or user JWT for ad-hoc tests).
//   2. Resolve the bridge row (must be 'active').
//   3. For each record:
//        - applyAllowlist → drop fields not on the read allowlist.
//        - require Id, advance watermark, enqueue an enrichment_job.
//   4. Audit the run via runBridgeIngest (rows in/accepted/dropped, watermark).
//
// All actual upserts/links into LCC tables happen in the worker
// (api/_shared/bridge-handlers-salesforce.js). Keeping the receiver
// thin means the PA flow can be retried safely and the worker can be
// scaled / paused independently.
//
// Request body shape:
//   {
//     bridge:   "sf.accounts",            // optional; ?bridge=… also works
//     workspaceId: "<uuid>",              // optional; defaults to caller's
//                                         //   primary workspace
//     runId:    "<PA flow run id>",       // optional, propagated to bridge_runs
//     records:  [ { Id: "0015...", Name: "...", ... }, ... ]
//   }
//
// Response:
//   { ok, bridge, rows_in, rows_accepted, rows_dropped, error? }
// ============================================================================

import { authenticate, primaryWorkspace, handleCors } from './_shared/auth.js';
import { withErrorHandler, isOpsConfigured } from './_shared/ops-db.js';
import {
  getBridgeByKey, applyAllowlist, runBridgeIngest, enqueueEnrichmentJob
} from './_shared/bridges.js';

// Map each bridge_key to (a) which SF object name to expect for allowlist
// lookup, and (b) the enrichment_jobs.job_type the worker dispatches on.
const BRIDGE_TO_JOB = {
  'sf.accounts':      { object: 'Account',     jobType: 'salesforce.account.upsert' },
  'sf.contacts':      { object: 'Contact',     jobType: 'salesforce.contact.upsert' },
  'sf.opportunities': { object: 'Opportunity', jobType: 'salesforce.opportunity.upsert' },
  'sf.activities':    { object: 'Activity',    jobType: 'salesforce.activity.append' }
};

function pickWatermark(raw) {
  return raw?.LastModifiedDate || raw?.SystemModstamp || null;
}

export default withErrorHandler(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await authenticate(req, res);
  if (!user) return;

  if (!isOpsConfigured()) {
    res.status(503).json({ error: 'Ops database not configured' });
    return;
  }

  const bridgeKey = req.query?.bridge || req.body?.bridge;
  const config = BRIDGE_TO_JOB[bridgeKey];
  if (!config) {
    res.status(400).json({
      error: `Unknown bridge: ${bridgeKey || '(missing)'}`,
      known: Object.keys(BRIDGE_TO_JOB)
    });
    return;
  }

  const workspaceId = req.body?.workspaceId
    || req.headers['x-lcc-workspace']
    || primaryWorkspace(user)?.workspace_id;
  if (!workspaceId) {
    res.status(400).json({ error: 'No workspace context' });
    return;
  }

  const bridge = await getBridgeByKey(workspaceId, bridgeKey);
  if (!bridge) {
    res.status(404).json({ error: `Bridge not seeded: ${bridgeKey}` });
    return;
  }
  if (bridge.status !== 'active') {
    res.status(409).json({ error: `Bridge not active: ${bridgeKey} (status=${bridge.status})` });
    return;
  }

  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  const externalRunId =
    req.body?.runId || req.headers['x-pa-flow-run'] || null;

  const { summary } = await runBridgeIngest(
    bridge,
    { externalRunId },
    async (report) => {
      let maxLastModified = bridge.watermark?.last_modified || null;

      for (const raw of records) {
        report.in();

        const { kept, dropped, dropReasons } =
          applyAllowlist(bridge, config.object, raw);

        // Bookkeeping: tally how many fields got stripped, but the row
        // itself still proceeds as long as Id survived.
        if (dropped > 0) {
          report.metadata({
            // accumulate counts per reason across the batch
            ...Object.fromEntries(
              Object.entries(
                Object.values(dropReasons).reduce((acc, r) => {
                  acc[`field_dropped_${r}`] = (acc[`field_dropped_${r}`] || 0) + 1;
                  return acc;
                }, {})
              )
            )
          });
        }

        if (!kept.Id) {
          report.drop(1, 'missing_sf_id');
          continue;
        }

        const lastMod = pickWatermark(raw);
        if (lastMod && lastMod > (maxLastModified || '')) {
          maxLastModified = lastMod;
        }

        const jobId = await enqueueEnrichmentJob({
          workspaceId,
          bridge,
          jobType:    config.jobType,
          targetKind: config.object.toLowerCase(),
          externalId: kept.Id,
          payload:    kept
        });

        if (jobId) report.accept();
        else       report.drop(1, 'enqueue_failed');
      }

      if (maxLastModified) report.watermark({ last_modified: maxLastModified });
      report.metadata({ bridge: bridgeKey, batch_size: records.length });
    }
  );

  res.status(200).json({
    ok:            summary.ok,
    bridge:        bridgeKey,
    rows_in:       summary.in,
    rows_accepted: summary.accepted,
    rows_dropped:  summary.dropped,
    error:         summary.error || undefined
  });
});
