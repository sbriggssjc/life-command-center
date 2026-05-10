// ============================================================================
// Bridges Router — single function, _route-based dispatch
// Life Command Center
// ----------------------------------------------------------------------------
// Consolidates the worker, ingest receiver, and admin freshness surface into
// one Vercel function so the Hobby-plan 12-function limit isn't a bottleneck.
// New sources land as additional _source values inside this same function —
// zero new functions needed for Phase 2+.
//
// Routes (via vercel.json rewrites — clients keep using the friendly URLs):
//
//   POST /api/enrichment-worker?batch=N&dry=1
//        → /api/bridges?_route=worker&batch=N&dry=1
//
//   POST /api/salesforce-changes?bridge=sf.<name>
//        → /api/bridges?_route=ingest&_source=salesforce&bridge=sf.<name>
//
//   POST /api/sharepoint-changes?bridge=sharepoint.<name>
//        → /api/bridges?_route=ingest&_source=sharepoint&bridge=sharepoint.<name>
//
//   POST /api/outlook-changes?bridge=outlook.<name>      (X-LCC-Source-User-Id required)
//        → /api/bridges?_route=ingest&_source=outlook&bridge=outlook.<name>
//
//   POST /api/calendar-changes?bridge=calendar.<name>    (X-LCC-Source-User-Id required)
//        → /api/bridges?_route=ingest&_source=calendar&bridge=calendar.<name>
//
//   GET  /api/admin/bridges
//        → /api/bridges?_route=admin
//        Admin actions:
//          ?_route=admin&action=freshness          (default)
//          ?_route=admin&action=backfill_mappings  (manager+ role; resolves
//              salesforce_activity_log.actor_user_id for prior rows)
//
//   POST /api/sf-write?bridge=sf.touchpoint.log    (operator+ role)
//        → /api/bridges?_route=write&bridge=sf.touchpoint.log
//        Outbound writeback. Validates payload against bridge.write_allowlist
//        and forwards to the configured PA webhook (env var per bridge_key).
//
//   POST /api/cadence-tick
//        → /api/bridges?_route=cadence
//        Cross-data sweep over v_contact_engagement + v_competitive_touches.
//        Inserts cadence_alerts rows + sends Teams cards for newly-emitted
//        alerts. Idempotent within a calendar day per (subject, alert_type).
//
//   POST /api/sharepoint-extract?id=<doc-uuid>[&force=1]
//        → /api/bridges?_route=sp_extract
//        Triggers PA to fetch a SharePoint file body and pipe it into the
//        existing intake pipeline. Marks sharepoint_documents.extraction_status
//        = 'queued' and returns 202.
//
//   POST /api/sharepoint-extract-callback
//        → /api/bridges?_route=sp_extract&action=callback
//        PA flow posts the extraction outcome here. Updates
//        sharepoint_documents.extraction_status and metadata.intake_id.
//
// Direct calls also work (POST /api/bridges?_route=worker etc).
// ============================================================================

import {
  authenticate, requireRole, requireWorkspace, primaryWorkspace, handleCors
} from './_shared/auth.js';
import {
  opsQuery, isOpsConfigured, withErrorHandler, pgFilterVal, fetchWithTimeout
} from './_shared/ops-db.js';
import {
  getBridgeByKey, applyAllowlist, enforceWriteAllowlist, runBridgeIngest,
  enqueueEnrichmentJob, claimPendingJobs, finishJob
} from './_shared/bridges.js';
import { backfillSalesforceActorMappings } from './_shared/external-user-mappings.js';
import { runCadenceTick } from './_shared/cadence-alerts.js';
import {
  triggerSharepointExtract,
  handleSharepointExtractCallback
} from './_shared/sharepoint-extract.js';

import {
  handleSalesforceAccountUpsert,
  handleSalesforceContactUpsert,
  handleSalesforceOpportunityUpsert,
  handleSalesforceActivityAppend
} from './_shared/bridge-handlers-salesforce.js';

import {
  handleSharepointDocumentClassify
} from './_shared/bridge-handlers-sharepoint.js';

import {
  handleOutlookMessageExtract,
  handleCalendarEventLink
} from './_shared/bridge-handlers-outlook.js';

const STUCK_JOB_SECONDS = 300;

// job_type → handler. Add an entry per source.
const HANDLERS = {
  'salesforce.account.upsert':     handleSalesforceAccountUpsert,
  'salesforce.contact.upsert':     handleSalesforceContactUpsert,
  'salesforce.opportunity.upsert': handleSalesforceOpportunityUpsert,
  'salesforce.activity.append':    handleSalesforceActivityAppend,
  'sharepoint.document.classify':  handleSharepointDocumentClassify,
  'outlook.message.extract':       handleOutlookMessageExtract,
  'calendar.event.link':           handleCalendarEventLink,
  // Phase 2.5 / future:
  // 'sharepoint.document.extract':  handleSharepointDocumentExtract,
};

// Per-source bridge_key → ingest config:
//   object             — name used to index the bridge's allowlist (allowlist[object]).
//   idField            — which field on the source payload carries the unique id.
//                        Defaults to 'Id' (Salesforce). Graph payloads use 'id'.
//   jobType            — enrichment_jobs.job_type to enqueue.
//   skipIf             — optional predicate; rows for which this returns true
//                        are dropped at ingest with reason 'skipped_by_filter'.
//   requireSourceUser  — if true, the receiver requires X-LCC-Source-User-Id
//                        (or body.source_user_id) and injects _source_user_id
//                        into each enqueued payload. Used for personal-mailbox
//                        and personal-calendar bridges where the data must
//                        carry whose mailbox/calendar it came from.
const INGEST_SOURCES = {
  salesforce: {
    'sf.accounts':      { object: 'Account',     idField: 'Id', jobType: 'salesforce.account.upsert' },
    'sf.contacts':      { object: 'Contact',     idField: 'Id', jobType: 'salesforce.contact.upsert' },
    'sf.opportunities': { object: 'Opportunity', idField: 'Id', jobType: 'salesforce.opportunity.upsert' },
    'sf.activities':    { object: 'Activity',    idField: 'Id', jobType: 'salesforce.activity.append' }
  },
  sharepoint: {
    'sharepoint.properties.index': {
      object:  'DriveItem',
      idField: 'id',
      jobType: 'sharepoint.document.classify',
      skipIf:  (raw) => Boolean(raw.folder) // folders are traversal-only
    }
  },
  outlook: {
    'outlook.messages': {
      object:  'Message',
      idField: 'id',
      jobType: 'outlook.message.extract',
      requireSourceUser: true,
      skipIf:  (raw) => Boolean(raw.isDraft) // drafts aren't real touches
    }
  },
  calendar: {
    'calendar.events': {
      object:  'Event',
      idField: 'id',
      jobType: 'calendar.event.link',
      requireSourceUser: true
    }
  }
};

// ===========================================================================
// _route=worker — drain pending jobs
// ===========================================================================

async function stubHandler(job) {
  console.log(
    `[bridges/worker] no handler for type=${job.job_type} job=${job.id} — ` +
    `marking done (stub fallback). Add a handler entry to wire this job_type.`
  );
  return { ok: true, result: { handled_by: 'stub', reason: 'no_handler_registered' } };
}

async function recoverStuckJobs() {
  if (!isOpsConfigured()) return 0;
  const cutoff = new Date(Date.now() - STUCK_JOB_SECONDS * 1000).toISOString();
  const r = await opsQuery('PATCH',
    `enrichment_jobs?status=eq.running&started_at=lt.${encodeURIComponent(cutoff)}`,
    { status: 'pending', error_message: 'recovered_from_stuck_running' }
  );
  return (r.ok && Array.isArray(r.data)) ? r.data.length : 0;
}

async function getQueueDepth(workspaceId) {
  if (!isOpsConfigured()) return null;
  const filter = workspaceId
    ? `workspace_id=eq.${pgFilterVal(workspaceId)}&`
    : '';
  const r = await opsQuery('GET',
    `enrichment_jobs?${filter}status=eq.pending&select=id&limit=1`,
    null,
    { countMode: 'exact' }
  );
  return r.ok ? (r.count || 0) : null;
}

async function handleWorkerRoute(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const batch = Math.max(1, Math.min(parseInt(req.query?.batch, 10) || 10, 100));
  const dry   = req.query?.dry === '1' || req.query?.dry === 'true';

  if (dry) {
    const depth = await getQueueDepth();
    res.status(200).json({
      ok: true, mode: 'dry',
      claimed: 0, recovered_stuck: 0, processed: [], queue_depth: depth
    });
    return;
  }

  const recoveredStuck = await recoverStuckJobs();
  const claimed = await claimPendingJobs(batch);
  const processed = [];

  for (const job of claimed) {
    const t0 = Date.now();
    const handler = HANDLERS[job.job_type] || stubHandler;
    let outcome;
    try {
      outcome = await handler(job);
    } catch (err) {
      outcome = { ok: false, error: err?.message || String(err) };
    }
    await finishJob(job, outcome);
    processed.push({
      id:       job.id,
      job_type: job.job_type,
      status:   outcome?.ok ? 'done' : 'error',
      ms:       Date.now() - t0,
      error:    outcome?.ok ? undefined : (outcome?.error || 'unknown')
    });
  }

  const depth = await getQueueDepth();
  res.status(200).json({
    ok: true, mode: 'live',
    claimed: claimed.length,
    recovered_stuck: recoveredStuck,
    processed, queue_depth: depth
  });
}

// ===========================================================================
// _route=ingest — receive a PA batch, allowlist-validate, enqueue
// ===========================================================================

function pickRowWatermark(raw) {
  return raw?.LastModifiedDate
      || raw?.SystemModstamp
      || raw?.lastModifiedDateTime
      || raw?.receivedDateTime
      || null;
}

async function handleIngestRoute(req, res, user) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const source = req.query?._source || req.body?.source || 'salesforce';
  const sourceMap = INGEST_SOURCES[source];
  if (!sourceMap) {
    res.status(400).json({
      error: `Unknown source: ${source}`,
      known: Object.keys(INGEST_SOURCES)
    });
    return;
  }

  const bridgeKey = req.query?.bridge || req.body?.bridge;
  const config = sourceMap[bridgeKey];
  if (!config) {
    res.status(400).json({
      error: `Unknown bridge for source=${source}: ${bridgeKey || '(missing)'}`,
      known: Object.keys(sourceMap)
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

  // Per-bridge requireSourceUser gate. Personal-mailbox and personal-calendar
  // bridges (outlook, calendar) need to know whose data this is so the
  // handler can enforce per-user filtering and the body-access ACL.
  let sourceUserId = null;
  if (config.requireSourceUser) {
    sourceUserId = req.body?.source_user_id
      || req.headers['x-lcc-source-user-id']
      || null;
    if (!sourceUserId) {
      res.status(400).json({
        error: `source_user_id required for bridge ${bridgeKey} ` +
               `(supply via X-LCC-Source-User-Id header or body.source_user_id)`
      });
      return;
    }
  }

  const bridge = await getBridgeByKey(workspaceId, bridgeKey);
  if (!bridge) {
    res.status(404).json({ error: `Bridge not seeded: ${bridgeKey}` });
    return;
  }
  if (bridge.status !== 'active') {
    res.status(409).json({
      error: `Bridge not active: ${bridgeKey} (status=${bridge.status})`
    });
    return;
  }

  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  const externalRunId = req.body?.runId || req.headers['x-pa-flow-run'] || null;
  const idField = config.idField || 'Id';

  const { summary } = await runBridgeIngest(
    bridge,
    { externalRunId },
    async (report) => {
      let maxRowWatermark = bridge.watermark?.last_modified || null;

      for (const raw of records) {
        report.in();

        const { kept, dropped, dropReasons } =
          applyAllowlist(bridge, config.object, raw);

        if (dropped > 0) {
          // Tally per-reason field-drop counts for the run audit row.
          const counts = Object.values(dropReasons).reduce((acc, r) => {
            acc[`field_dropped_${r}`] = (acc[`field_dropped_${r}`] || 0) + 1;
            return acc;
          }, {});
          report.metadata(counts);
        }

        if (typeof config.skipIf === 'function' && config.skipIf(kept)) {
          report.drop(1, 'skipped_by_filter');
          continue;
        }

        const externalId = kept[idField];
        if (!externalId) { report.drop(1, `missing_${idField.toLowerCase()}`); continue; }

        const rowWm = pickRowWatermark(raw);
        if (rowWm && rowWm > (maxRowWatermark || '')) maxRowWatermark = rowWm;

        // Inject _source_user_id into the payload when this bridge requires it.
        // Underscore prefix marks it as bridge-injected metadata vs a real
        // source field — handlers know to read it and strip it as needed.
        const payload = sourceUserId
          ? { ...kept, _source_user_id: sourceUserId }
          : kept;

        const jobId = await enqueueEnrichmentJob({
          workspaceId,
          bridge,
          jobType:    config.jobType,
          targetKind: config.object.toLowerCase(),
          externalId: String(externalId),
          payload
        });
        if (jobId) report.accept();
        else       report.drop(1, 'enqueue_failed');
      }

      // Watermark precedence:
      //   1. body.watermark — explicit batch checkpoint (e.g. Graph deltaLink).
      //   2. derived per-row max (Salesforce LastModifiedDate path).
      // Sources without a coherent batch token (Salesforce) just rely on (2).
      if (req.body?.watermark && typeof req.body.watermark === 'object') {
        report.watermark(req.body.watermark);
      } else if (maxRowWatermark) {
        report.watermark({ last_modified: maxRowWatermark });
      }
      report.metadata({
        source, bridge: bridgeKey,
        batch_size: records.length,
        ...(sourceUserId ? { source_user_id: sourceUserId } : {})
      });
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
}

// ===========================================================================
// _route=admin — freshness page + queue counts
// ===========================================================================

async function getQueueCounts(workspaceId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const baseFilter = `workspace_id=eq.${pgFilterVal(workspaceId)}`;

  const [pending, running, errored] = await Promise.all([
    opsQuery('GET',
      `enrichment_jobs?${baseFilter}&status=eq.pending&select=id&limit=1`,
      null, { countMode: 'exact' }),
    opsQuery('GET',
      `enrichment_jobs?${baseFilter}&status=eq.running&select=id&limit=1`,
      null, { countMode: 'exact' }),
    opsQuery('GET',
      `enrichment_jobs?${baseFilter}&status=eq.error&updated_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
      null, { countMode: 'exact' })
  ]);
  return {
    pending:           pending.ok ? (pending.count || 0) : null,
    running:           running.ok ? (running.count || 0) : null,
    error_recent_24h:  errored.ok ? (errored.count || 0) : null
  };
}

async function handleAdminRoute(req, res, user) {
  const action = req.query?.action || 'freshness';
  const requested =
    req.query?.workspace ||
    req.headers['x-lcc-workspace'] ||
    primaryWorkspace(user)?.workspace_id;
  if (!requested) {
    res.status(400).json({ error: 'No workspace context' });
    return;
  }
  if (!requireWorkspace(user, requested)) {
    res.status(403).json({ error: 'Not a member of this workspace' });
    return;
  }

  if (action === 'backfill_mappings') {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    if (!requireRole(user, 'manager', requested)) {
      res.status(403).json({ error: 'Manager role required' });
      return;
    }
    const source = req.query?.source || 'salesforce';
    if (source !== 'salesforce') {
      res.status(400).json({ error: `Backfill not implemented for source=${source}` });
      return;
    }
    const limit = Math.max(1, Math.min(parseInt(req.query?.limit, 10) || 200, 1000));
    const result = await backfillSalesforceActorMappings(requested, { limit });
    res.status(200).json({ ok: true, action, source, ...result });
    return;
  }

  // Default: freshness page.
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const filter = `workspace_id=eq.${pgFilterVal(requested)}`;
  const bridgesR = await opsQuery('GET',
    `v_bridge_freshness?${filter}&order=source_system.asc,bridge_key.asc`,
    null, { countMode: 'estimated' }
  );
  const queue = await getQueueCounts(requested);

  res.status(200).json({
    ok: true,
    workspace_id: requested,
    bridges: bridgesR.ok ? (bridgesR.data || []) : [],
    queue
  });
}

// ===========================================================================
// _route=write — outbound writeback to a per-bridge PA webhook
// ===========================================================================

// bridge_key → env var name carrying the PA webhook URL. Add new entries
// here as outbound bridges come online. Keeping URLs in env (not in the
// bridge row) means rotating a webhook never requires a DB write.
const OUTBOUND_ENV = {
  'sf.touchpoint.log': 'PA_SF_TOUCHPOINT_URL',
  // Already-existing webhooks (kept here for documentary symmetry —
  // the legacy code paths still call them directly, not via this route):
  //   'sf.task.close':       'PA_COMPLETE_TASK_URL',
  //   'sf.lead.notify':      'PA_NEW_LEAD_WEBHOOK_URL',
};

async function handleWriteRoute(req, res, user) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const workspaceId = req.body?.workspaceId
    || req.headers['x-lcc-workspace']
    || primaryWorkspace(user)?.workspace_id;
  if (!workspaceId) {
    res.status(400).json({ error: 'No workspace context' });
    return;
  }
  if (!requireRole(user, 'operator', workspaceId)) {
    res.status(403).json({ error: 'Operator role required' });
    return;
  }

  const bridgeKey = req.query?.bridge || req.body?.bridge;
  if (!bridgeKey) {
    res.status(400).json({ error: 'bridge required' });
    return;
  }
  const envName = OUTBOUND_ENV[bridgeKey];
  if (!envName) {
    res.status(400).json({
      error: `No outbound webhook configured for bridge ${bridgeKey}`,
      known: Object.keys(OUTBOUND_ENV)
    });
    return;
  }
  const webhookUrl = process.env[envName];
  if (!webhookUrl) {
    res.status(503).json({ error: `${envName} not set in environment` });
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
  if (bridge.direction !== 'outbound' && bridge.direction !== 'bidirectional') {
    res.status(409).json({ error: `Bridge ${bridgeKey} is not an outbound bridge` });
    return;
  }

  // The body's payload is keyed by source object name (e.g. "Task" for
  // sf.touchpoint.log). The caller declares which object via body.object.
  const sourceObjectName = req.body?.object;
  const payload          = req.body?.payload;
  if (!sourceObjectName || !payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'object + payload required in body' });
    return;
  }

  const guard = enforceWriteAllowlist(bridge, sourceObjectName, payload);
  if (!guard.ok) {
    res.status(400).json({ error: `write rejected: ${guard.reason}` });
    return;
  }

  // Forward to PA. Wrap in runBridgeIngest so the call is recorded as a
  // bridge_run with status=success/error and rows_in/accepted reflect a
  // single write attempt. This makes outbound writes auditable in the
  // same place as inbound batches.
  const { summary } = await runBridgeIngest(bridge, { externalRunId: req.body?.runId || null }, async (report) => {
    report.in();
    report.metadata({ direction: 'outbound', bridge: bridgeKey, object: sourceObjectName });

    const r = await fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bridge: bridgeKey,
        workspaceId,
        object:  sourceObjectName,
        payload: guard.payload,
        actor:   { user_id: user.id, email: user.email },
        runId:   req.body?.runId || null
      })
    }, 10000);

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      report.drop(1, `webhook_${r.status}`);
      return { error: `pa_webhook_${r.status}: ${text.slice(0, 200)}` };
    }
    report.accept();
    return null;
  });

  res.status(summary.ok ? 200 : 502).json({
    ok:     summary.ok,
    bridge: bridgeKey,
    error:  summary.error || undefined
  });
}

// ===========================================================================
// _route=cadence — daily sweep over engagement + competitive touches
// ===========================================================================

async function handleCadenceRoute(req, res, user) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const requested =
    req.query?.workspace ||
    req.headers['x-lcc-workspace'] ||
    primaryWorkspace(user)?.workspace_id;
  if (!requested) {
    res.status(400).json({ error: 'No workspace context' });
    return;
  }
  if (!requireWorkspace(user, requested)) {
    res.status(403).json({ error: 'Not a member of this workspace' });
    return;
  }

  // All thresholds optional — handler defaults to sane values when absent.
  const opts = {};
  const intParam = (k) => {
    const v = parseInt(req.query?.[k], 10);
    if (Number.isFinite(v) && v > 0) opts[k] = v;
  };
  intParam('cold_days');
  intParam('heat_min_touches');
  intParam('heat_recency_days');
  intParam('max_emit');

  const result = await runCadenceTick(requested, opts);
  res.status(result.ok ? 200 : 500).json(result);
}

// ===========================================================================
// _route=sp_extract — SharePoint document extract trigger + callback
// ===========================================================================

async function handleSpExtractRoute(req, res, user) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const action = req.query?.action || req.body?.action || 'trigger';
  const workspaceId =
    req.body?.workspace_id ||
    req.body?.workspaceId ||
    req.headers['x-lcc-workspace'] ||
    primaryWorkspace(user)?.workspace_id;
  if (!workspaceId) {
    res.status(400).json({ error: 'No workspace context' });
    return;
  }

  // Callback path is system-to-system (PA → LCC). Workspace membership
  // check is skipped — auth via X-LCC-Key in the dispatcher is the gate.
  if (action === 'callback') {
    const result = await handleSharepointExtractCallback({ workspaceId, body: req.body || {} });
    res.status(result.status || (result.ok ? 200 : 500)).json(result);
    return;
  }

  // Trigger path — user-initiated, requires workspace membership.
  if (!requireWorkspace(user, workspaceId)) {
    res.status(403).json({ error: 'Not a member of this workspace' });
    return;
  }

  const docId = req.query?.id || req.body?.doc_id;
  if (!docId) {
    res.status(400).json({ error: 'doc id required (?id=<uuid>)' });
    return;
  }
  const force = req.query?.force === '1' || req.query?.force === 'true' || req.body?.force === true;

  const result = await triggerSharepointExtract({ workspaceId, docId, user, force });
  res.status(result.status || (result.ok ? 200 : 500)).json(result);
}

// ===========================================================================
// dispatcher
// ===========================================================================

export default withErrorHandler(async (req, res) => {
  if (handleCors(req, res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  if (!isOpsConfigured()) {
    res.status(503).json({ error: 'Ops database not configured' });
    return;
  }

  const route = req.query?._route || req.body?._route || 'worker';

  switch (route) {
    case 'worker':     return handleWorkerRoute(req, res, user);
    case 'ingest':     return handleIngestRoute(req, res, user);
    case 'admin':      return handleAdminRoute(req, res, user);
    case 'write':      return handleWriteRoute(req, res, user);
    case 'cadence':    return handleCadenceRoute(req, res, user);
    case 'sp_extract': return handleSpExtractRoute(req, res, user);
    default:
      res.status(400).json({
        error: `Unknown _route: ${route}`,
        known: ['worker', 'ingest', 'admin', 'write', 'cadence', 'sp_extract']
      });
  }
});
