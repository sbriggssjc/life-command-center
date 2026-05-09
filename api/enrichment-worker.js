// ============================================================================
// Enrichment Worker — Phase 0 stub
// Life Command Center
// ----------------------------------------------------------------------------
// POST /api/enrichment-worker
//
// Drains a batch of pending `enrichment_jobs` and (in Phase 0) just logs
// them. Phase 1+ replaces the inner switch with real handlers per job_type
// (entity resolution, document classification, OM extraction, etc.).
//
// Designed to be called on a schedule — either by a Vercel Cron entry or
// by a Power Automate flow on a 1-5 minute interval. Authenticates via the
// existing X-LCC-Key path so it shares creds with the other PA-driven
// integrations.
//
// Query params:
//   ?batch=N    — claim up to N jobs in this tick (default 10, max 100)
//   ?dry=1      — peek only; do not claim. Useful from /api/admin/bridges
//                 for showing queue depth without disturbing it.
//
// Response:
//   { ok, mode, claimed, processed:[{id, job_type, status, ms}], queue_depth }
// ============================================================================

import { authenticate, handleCors } from './_shared/auth.js';
import { opsQuery, isOpsConfigured, withErrorHandler } from './_shared/ops-db.js';
import { claimPendingJobs, finishJob } from './_shared/bridges.js';

// Map of job_type → handler. Phase 0: every type resolves to the stub.
// Phase 1+: split into discrete imports (e.g. handleSalesforceAccountUpsert).
const HANDLERS = {
  // 'salesforce.account.upsert':    handleSalesforceAccountUpsert,
  // 'salesforce.contact.upsert':    handleSalesforceContactUpsert,
  // 'salesforce.activity.append':   handleSalesforceActivityAppend,
  // 'sharepoint.document.classify': handleSharepointDocumentClassify,
  // 'sharepoint.document.extract':  handleSharepointDocumentExtract,
  // 'outlook.message.extract':      handleOutlookMessageExtract,
  // 'calendar.event.link':          handleCalendarEventLink,
  // 'entity.resolve.identity':      handleEntityResolveIdentity,
};

async function stubHandler(job) {
  console.log(
    `[enrichment-worker] stub handled job=${job.id} type=${job.job_type} ` +
    `target=${job.target_kind || '-'}/${job.target_id || '-'} ` +
    `external=${job.external_id || '-'}`
  );
  return { ok: true, result: { handled_by: 'stub', phase: 0 } };
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
      processed: [],
      queue_depth: depth
    });
    return;
  }

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
    processed,
    queue_depth: depth
  });
});
