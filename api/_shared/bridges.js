// ============================================================================
// Bridges helper — governance + audit for the integration-bridges scaffold
// Life Command Center — Phase 0
// ============================================================================
//
// Every external data flow (Salesforce, SharePoint, Outlook, Calendar, Teams)
// is registered as a row in `connector_bridges` with an explicit field
// allowlist and write policy. This module is the only place those rules
// are enforced — Phase 1+ handlers MUST go through `runBridgeIngest` or
// `enforceWriteAllowlist` rather than touching downstream tables directly.
//
// Public surface:
//   - getBridgeByKey(workspaceId, bridgeKey) → row | null
//   - applyAllowlist(bridge, sourceObjectName, payload) → { kept, dropped, dropReasons }
//   - enforceWriteAllowlist(bridge, sourceObjectName, payload) → { ok, payload, reason }
//   - runBridgeIngest(bridge, opts, fn) → { runId, summary }
//        Wraps a callback that does the actual ingest; opens a bridge_runs
//        row, lets the callback report rows in/accepted/dropped + new
//        watermark, then closes the row + advances connector_bridges.
//   - enqueueEnrichmentJob({ bridge, jobType, ... }) → uuid | null
//
// All side-effects go through `opsQuery` so we share the boot-time creds
// guard + 8-second timeout already in ops-db.js.
// ============================================================================

import { opsQuery, isOpsConfigured, pgFilterVal } from './ops-db.js';

// ---- read helpers ---------------------------------------------------------

/**
 * Fetch a bridge row by its (workspace_id, bridge_key) identity.
 * Returns null if not found or ops is not configured.
 */
export async function getBridgeByKey(workspaceId, bridgeKey) {
  if (!isOpsConfigured() || !workspaceId || !bridgeKey) return null;
  const path =
    `connector_bridges?workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&bridge_key=eq.${pgFilterVal(bridgeKey)}&limit=1`;
  const r = await opsQuery('GET', path, null, { countMode: 'none' });
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  return r.data[0];
}

// ---- allowlist enforcement -------------------------------------------------

/**
 * Strip any field not on the bridge's `allowlist[sourceObjectName]` list.
 * Returns { kept, dropped, dropReasons } where:
 *   - kept           = a NEW object containing only allowed keys
 *   - dropped        = count of stripped keys
 *   - dropReasons    = { "<field>": "not_in_allowlist", ... } for audit
 *
 * If the allowlist for this object is missing or empty, EVERYTHING is
 * dropped — open by default would defeat the purpose of the allowlist.
 * Bridges with no fields configured are considered misconfigured.
 */
export function applyAllowlist(bridge, sourceObjectName, payload) {
  const result = { kept: {}, dropped: 0, dropReasons: {} };
  if (!payload || typeof payload !== 'object') return result;

  const list = bridge?.allowlist?.[sourceObjectName];
  const allowed = Array.isArray(list) ? new Set(list) : new Set();

  for (const [k, v] of Object.entries(payload)) {
    if (allowed.has(k)) {
      result.kept[k] = v;
    } else {
      result.dropped += 1;
      result.dropReasons[k] = allowed.size === 0
        ? 'no_allowlist_configured'
        : 'not_in_allowlist';
    }
  }
  return result;
}

/**
 * Outbound write guard. Refuses the write entirely unless:
 *   - bridge.write_policy is 'minimal' or 'full'
 *   - every field in payload is on bridge.write_allowlist[sourceObjectName]
 *
 * 'minimal' and 'full' both enforce the allowlist; the difference is
 * documentary — 'minimal' signals to humans "we're sending the bare
 * minimum" while 'full' signals "broader sync is intentional."
 *
 * Returns { ok, payload, reason }. On rejection, reason is one of:
 *   'write_policy_none' | 'no_write_allowlist' | 'field_not_allowed:<name>'
 */
export function enforceWriteAllowlist(bridge, sourceObjectName, payload) {
  if (!bridge) return { ok: false, reason: 'no_bridge' };
  if (bridge.write_policy === 'none') {
    return { ok: false, reason: 'write_policy_none' };
  }
  const list = bridge.write_allowlist?.[sourceObjectName];
  const allowed = Array.isArray(list) ? new Set(list) : null;
  if (!allowed || allowed.size === 0) {
    return { ok: false, reason: 'no_write_allowlist' };
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'empty_payload' };
  }
  const filtered = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!allowed.has(k)) {
      return { ok: false, reason: `field_not_allowed:${k}` };
    }
    filtered[k] = v;
  }
  return { ok: true, payload: filtered, reason: null };
}

// ---- run lifecycle --------------------------------------------------------

async function openBridgeRun(bridge, watermarkFrom, externalRunId) {
  const r = await opsQuery('POST', 'bridge_runs', {
    bridge_id:       bridge.id,
    workspace_id:    bridge.workspace_id,
    started_at:      new Date().toISOString(),
    status:          'running',
    watermark_from:  watermarkFrom || bridge.watermark || {},
    external_run_id: externalRunId || null
  });
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) {
    throw new Error(`Failed to open bridge_run: ${r.status}`);
  }
  return r.data[0].id;
}

async function closeBridgeRun(runId, fields) {
  return opsQuery('PATCH', `bridge_runs?id=eq.${runId}`, {
    finished_at: new Date().toISOString(),
    ...fields
  });
}

async function advanceBridge(bridge, fields) {
  return opsQuery('PATCH', `connector_bridges?id=eq.${bridge.id}`, fields);
}

/**
 * Run an ingest batch under audit.
 *
 * Caller passes a callback `fn(report)` where `report` is a mutable object
 * with helpers:
 *   report.in(n)         — rows seen from the source
 *   report.accept(n)     — rows that passed allowlist + landed
 *   report.drop(n, reason) — rows dropped (reason becomes a histogram bucket)
 *   report.watermark(v)  — new watermark to advance to on success
 *   report.metadata(o)   — free-form key/value attached to the run row
 *
 * On thrown error or fn returning { error }, the run is marked 'error' and
 * connector_bridges.consecutive_failures is incremented; the watermark is
 * NOT advanced. On success the watermark is committed and consecutive
 * failures reset to 0.
 */
export async function runBridgeIngest(bridge, opts, fn) {
  if (!bridge?.id) throw new Error('runBridgeIngest: bridge with id is required');
  const externalRunId = opts?.externalRunId || null;
  const watermarkFrom = opts?.watermarkFrom || bridge.watermark || {};

  const runId = await openBridgeRun(bridge, watermarkFrom, externalRunId);

  const counters = { in: 0, accepted: 0, dropped: 0 };
  const dropReasons = {};
  let nextWatermark = null;
  const metadata = {};

  const report = {
    in:      (n = 1) => { counters.in += n; },
    accept:  (n = 1) => { counters.accepted += n; },
    drop:    (n = 1, reason = 'unspecified') => {
      counters.dropped += n;
      dropReasons[reason] = (dropReasons[reason] || 0) + n;
    },
    watermark: (v) => { nextWatermark = v; },
    metadata:  (o) => { Object.assign(metadata, o || {}); }
  };

  let outcome = { ok: true, error: null };
  try {
    const r = await fn(report);
    if (r && r.error) outcome = { ok: false, error: r.error };
  } catch (err) {
    outcome = { ok: false, error: err?.message || String(err) };
    console.error(`[bridges] ingest threw for bridge=${bridge.bridge_key}:`,
      err?.stack || err);
  }

  if (outcome.ok) {
    await closeBridgeRun(runId, {
      status:        counters.dropped > 0 ? 'partial' : 'success',
      rows_in:       counters.in,
      rows_accepted: counters.accepted,
      rows_dropped:  counters.dropped,
      drop_reasons:  dropReasons,
      watermark_to:  nextWatermark || watermarkFrom,
      metadata
    });
    await advanceBridge(bridge, {
      last_run_at:          new Date().toISOString(),
      last_success_at:      new Date().toISOString(),
      consecutive_failures: 0,
      watermark:            nextWatermark || watermarkFrom
    });
  } else {
    await closeBridgeRun(runId, {
      status:        'error',
      rows_in:       counters.in,
      rows_accepted: counters.accepted,
      rows_dropped:  counters.dropped,
      drop_reasons:  dropReasons,
      error_message: outcome.error,
      metadata
    });
    await advanceBridge(bridge, {
      last_run_at:          new Date().toISOString(),
      last_error_at:        new Date().toISOString(),
      last_error:           outcome.error,
      consecutive_failures: (bridge.consecutive_failures || 0) + 1
    });
  }

  return {
    runId,
    summary: { ...counters, dropReasons, ok: outcome.ok, error: outcome.error }
  };
}

// ---- queue ----------------------------------------------------------------

/**
 * Insert a job into the enrichment queue. Bridges call this once per
 * accepted row that needs the worker to do follow-up reasoning (link
 * to entity, classify, extract, etc.).
 *
 * Returns the new job id, or null if ops is unconfigured / insert failed.
 * Never throws.
 */
export async function enqueueEnrichmentJob({
  workspaceId,
  bridge,
  jobType,
  targetKind = null,
  targetId   = null,
  externalId = null,
  payload    = {},
  priority   = 50,
  delaySeconds = 0
}) {
  if (!isOpsConfigured() || !workspaceId || !jobType) return null;
  const nextRunAt = delaySeconds > 0
    ? new Date(Date.now() + delaySeconds * 1000).toISOString()
    : new Date().toISOString();
  try {
    const r = await opsQuery('POST', 'enrichment_jobs', {
      workspace_id: workspaceId,
      bridge_id:    bridge?.id || null,
      job_type:     jobType,
      target_kind:  targetKind,
      target_id:    targetId,
      external_id:  externalId,
      payload,
      priority,
      next_run_at:  nextRunAt
    });
    if (r.ok && Array.isArray(r.data) && r.data.length) return r.data[0].id;
  } catch (err) {
    console.warn('[bridges] enqueueEnrichmentJob failed (non-fatal):',
      err?.message || err);
  }
  return null;
}

// ---- worker dequeue (used by api/enrichment-worker.js) --------------------

/**
 * Atomically claim up to `batchSize` pending jobs whose next_run_at has
 * passed. Marks them 'running' so a concurrent worker can't double-pick.
 *
 * Implemented as a PATCH with a CTE-style filter via PostgREST: select
 * candidate ids, then PATCH WHERE id=in.(...) and status=eq.pending. The
 * row-level concurrency guarantee depends on the DB returning only the
 * rows that actually flipped — which PostgREST does, because the WHERE
 * clause includes status=eq.pending and Postgres serializes the update.
 *
 * Returns the array of claimed rows (empty if nothing pending).
 */
export async function claimPendingJobs(batchSize = 10) {
  if (!isOpsConfigured()) return [];
  const peek = await opsQuery('GET',
    `enrichment_jobs?status=eq.pending&next_run_at=lte.${encodeURIComponent(new Date().toISOString())}` +
    `&order=priority.asc,next_run_at.asc&limit=${Math.max(1, Math.min(batchSize, 100))}`,
    null,
    { countMode: 'none' }
  );
  if (!peek.ok || !Array.isArray(peek.data) || !peek.data.length) return [];

  const ids = peek.data.map(r => r.id);
  const idFilter = ids.map(id => `"${id}"`).join(',');
  const claim = await opsQuery('PATCH',
    `enrichment_jobs?id=in.(${idFilter})&status=eq.pending`,
    {
      status:     'running',
      started_at: new Date().toISOString()
    }
  );
  if (!claim.ok || !Array.isArray(claim.data)) return [];
  return claim.data;
}

/**
 * Finalize a previously-claimed job. Pass `ok=false` with an `error` to
 * mark it errored; if attempts >= max_attempts the row is left in 'error',
 * otherwise it's flipped back to 'pending' with next_run_at advanced
 * by an exponential backoff (30s * 2^attempts, capped at 1h).
 */
export async function finishJob(job, { ok, error, result } = {}) {
  if (!job?.id) return;
  if (ok) {
    await opsQuery('PATCH', `enrichment_jobs?id=eq.${job.id}`, {
      status:        'done',
      finished_at:   new Date().toISOString(),
      attempts:      (job.attempts || 0) + 1,
      result:        result || null,
      error_message: null
    });
    return;
  }
  const attempts = (job.attempts || 0) + 1;
  const exhausted = attempts >= (job.max_attempts || 5);
  const backoffSec = Math.min(3600, 30 * Math.pow(2, attempts));
  await opsQuery('PATCH', `enrichment_jobs?id=eq.${job.id}`, exhausted
    ? {
        status:        'error',
        finished_at:   new Date().toISOString(),
        attempts,
        error_message: error || 'unknown'
      }
    : {
        status:        'pending',
        attempts,
        next_run_at:   new Date(Date.now() + backoffSec * 1000).toISOString(),
        error_message: error || 'unknown'
      }
  );
}
