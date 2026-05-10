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
//
// Direct calls also work (POST /api/bridges?_route=worker etc).
// ============================================================================

import {
  authenticate, requireWorkspace, primaryWorkspace, handleCors
} from './_shared/auth.js';
import {
  opsQuery, isOpsConfigured, withErrorHandler, pgFilterVal
} from './_shared/ops-db.js';
import {
  getBridgeByKey, applyAllowlist, runBridgeIngest, enqueueEnrichmentJob,
  claimPendingJobs, finishJob
} from './_shared/bridges.js';

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
  if (req.method !== 'GET') {
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
    case 'worker': return handleWorkerRoute(req, res, user);
    case 'ingest': return handleIngestRoute(req, res, user);
    case 'admin':  return handleAdminRoute(req, res, user);
    default:
      res.status(400).json({
        error: `Unknown _route: ${route}`,
        known: ['worker', 'ingest', 'admin']
      });
  }
});
