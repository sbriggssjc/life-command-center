// ============================================================================
// Enrichment Worker
// Life Command Center
// ----------------------------------------------------------------------------
// POST /api/enrichment-worker
//
// Drains a batch of pending `enrichment_jobs`, dispatching to a real handler
// per `job_type`. Phase 1 wires the four Salesforce handlers; Phase 2+ adds
// SharePoint, Outlook, Calendar handlers via the same HANDLERS map.
//
// Designed to be called on a schedule — Vercel Cron entry or a Power
// Automate scheduled flow on a 1-5 minute interval. Authenticates via the
// existing X-LCC-Key path so it shares creds with the other PA-driven
// integrations.
//
// Query params:
//   ?batch=N    — claim up to N jobs in this tick (default 10, max 100)
//   ?dry=1      — peek only; do not claim. For /api/admin/bridges to show
//                 queue depth without disturbing it.
//
// On every tick, before claiming new jobs, the worker also sweeps stuck
// 'running' jobs (started_at older than STUCK_JOB_SECONDS) back to
// 'pending' so a crash mid-handler doesn't leave permanent zombies.
//
// Response:
//   {
//     ok, mode, claimed, recovered_stuck,
//     processed: [ { id, job_type, status, ms, error? } ],
//     queue_depth
//   }
// ============================================================================

import { authenticate, handleCors } from './_shared/auth.js';
import { opsQuery, isOpsConfigured, withErrorHandler } from './_shared/ops-db.js';
import { claimPendingJobs, finishJob } from './_shared/bridges.js';

import {
  handleSalesforceAccountUpsert,
  handleSalesforceContactUpsert,
  handleSalesforceOpportunityUpsert,
  handleSalesforceActivityAppend
} from './_shared/bridge-handlers-salesforce.js';

const STUCK_JOB_SECONDS = 300; // 5 min — should be longer than the longest handler

// Map of job_type → handler. Phase 0 stub fallback handles unknown types.
const HANDLERS = {
  'salesforce.account.upsert':     handleSalesforceAccountUpsert,
  'salesforce.contact.upsert':     handleSalesforceContactUpsert,
  'salesforce.opportunity.upsert': handleSalesforceOpportunityUpsert,
  'salesforce.activity.append':    handleSalesforceActivityAppend,
  // Phase 2+:
  // 'sharepoint.document.classify': handleSharepointDocumentClassify,
  // 'sharepoint.document.extract':  handleSharepointDocumentExtract,
  // 'outlook.message.extract':      handleOutlookMessageExtract,
  // 'calendar.event.link':          handleCalendarEventLink,
};

async function stubHandler(job) {
  console.log(
    `[enrichment-worker] no handler for type=${job.job_type} job=${job.id} — ` +
    `marking done (stub fallback). Add a handler entry to wire this job_type.`
  );
  return { ok: true, result: { handled_by: 'stub', reason: 'no_handler_registered' } };
}

async function recoverStuckJobs() {
  if (!isOpsConfigured()) return 0;
  const cutoff = new Date(Date.now() - STUCK_JOB_SECONDS * 1000).toISOString();
  const r = await opsQuery('PATCH',
    `enrichment_jobs?status=eq.running&started_at=lt.${encodeURIComponent(cutoff)}`,
    {
      status:        'pending',
      error_message: 'recovered_from_stuck_running'
    }
  );
  return (r.ok && Array.isArray(r.data)) ? r.data.length : 0;
}

async function getQueueDepth() {
  if (!isOpsConfigured()) return null;
  const r = await opsQuery('GET',
    'enrichment_jobs?status=eq.pending&select=id&limit=1',
    null,
    { countMode: 'exact' }
  );
  return r.ok ? (r.count || 0) : null;
}

export default withErrorHandler(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await authenticate(req, res);
  if (!user) return;

  if (!isOpsConfigured()) {
    res.status(503).json({ error: 'Ops database not configured' });
    return;
  }

  const batch = Math.max(1, Math.min(parseInt(req.query?.batch, 10) || 10, 100));
  const dry   = req.query?.dry === '1' || req.query?.dry === 'true';

  if (dry) {
    const depth = await getQueueDepth();
    res.status(200).json({
      ok: true,
      mode: 'dry',
      claimed: 0,
      recovered_stuck: 0,
      processed: [],
      queue_depth: depth
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
    ok: true,
    mode: 'live',
    claimed: claimed.length,
    recovered_stuck: recoveredStuck,
    processed,
    queue_depth: depth
  });
});
