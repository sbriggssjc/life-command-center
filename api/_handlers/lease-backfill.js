// ============================================================================
// Stage B widen — existing-corpus LEASE BACKFILL worker
// Life Command Center · sub-route of intake.js (?_route=lease-backfill)
//
//   GET  /api/lease-backfill   — dry-run (lists the eligible queue, no byte/AI)
//   POST /api/lease-backfill   — drain (re-run the lease extractor on each)
//
// The auto-route (FOLDER_FEED_LEASE_EXTRACT) enriches NEW lease docs going
// forward, but the ~657 in-domain lease docs already in folder_feed_seen
// (status staged|attached) were processed under the old Stage-A LIGHT path and
// are deduped by (path, content_hash) — so the auto-route skips them as
// already-seen. This one-time backfill re-runs the SAME lease extractor over
// that existing set via each row's storage_ref (server_relative_path).
//
// Reuse, not rebuild: every doc goes through `attachLeaseDoc` — the IDENTICAL
// extract → resolve → enrich machinery the auto-route uses. So the proven policy
// is inherited verbatim:
//   • fill-blanks only; a populated-field disagreement → Decision Center
//     (field_provenance decision='conflict'), NEVER overwritten;
//   • guarantor → canonical operator entity + guaranteed_by edge;
//   • scanned / no-text-layer PDF → needs_ocr (skip, no 500);
//   • never a duplicate lease (one-active-lease dedupe in ensureLeaseRow).
//
// IDEMPOTENT by a marker, not by re-processing: a row that has been backfilled
// is stamped `subject_hint.lease_backfilled_at` and EXCLUDED from the next
// selection. So re-running the endpoint drains the NEXT batch (progressive),
// and a doc enriched once is never re-extracted — which is what guarantees it
// won't re-conflict (the curated value already filled / the disagreement already
// queued once). Transient errors (fetch/extract) are deliberately left UNmarked
// so a later tick retries them.
//
// GATED: capped batch first (?limit, default 15). Bring the receipts to Scott
// before the full corpus is opened. No new api/*.js — handler lives here,
// routed through intake.js.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { attachLeaseDoc } from './lease-extractor.js';

// Marker keys the backfill stamps onto subject_hint. Stripped before the hint is
// handed to the extractor so they never leak into a disambiguation decision.
const BACKFILL_MARKER_KEYS = ['lease_backfilled_at', 'lease_backfill'];

function fileNameFromPath(p) {
  const s = String(p || '');
  return s.split('/').pop() || 'lease.pdf';
}

function cleanHint(hint) {
  const h = { ...(hint || {}) };
  for (const k of BACKFILL_MARKER_KEYS) delete h[k];
  return h;
}

/**
 * The eligible queue: in-domain (vertical dia/gov) lease docs already SEEN under
 * the Stage-A light path (status staged|attached), not yet backfilled. Ordered
 * by id so successive ticks drain deterministically. `subject_hint->>
 * lease_backfilled_at=is.null` is the idempotency gate — a backfilled row drops
 * out of the queue.
 */
export async function fetchEligibleLeaseDocs(limit, deps) {
  const q = deps.opsQuery || opsQuery;
  // Cosmetic-accuracy filter: exclude multi-tenant / portfolio deal-folder leases
  // at SELECTION so the dry-run's eligible count reflects what will actually be
  // worked. The hard GUARANTEE is the `attachLeaseDoc` gate (whole-segment via
  // `isMultiTenantDealFolderPath`); this ILIKE mirrors its EXACT whole-segment
  // semantics by anchoring the surrounding slashes (`*/Multi/*` matches the
  // segment "Multi", never a substring like "Multimedia"/"Multifoods"). PostgREST
  // ANDs repeated column filters, and `*` is the wildcard. `/Portfolios/` is a
  // distinct segment from `/Portfolio/`, so both are listed.
  const r = await q('GET',
    'folder_feed_seen' +
    '?detected_type=eq.lease' +
    '&status=in.(staged,attached)' +
    '&vertical=in.(dia,gov)' +
    '&subject_hint->>lease_backfilled_at=is.null' +
    '&server_relative_path=not.ilike.*/Multi/*' +
    '&server_relative_path=not.ilike.*/Multitenant/*' +
    '&server_relative_path=not.ilike.*/Portfolio/*' +
    '&server_relative_path=not.ilike.*/Portfolios/*' +
    '&select=id,server_relative_path,vertical,status,subject_hint' +
    '&order=id.asc' +
    `&limit=${limit}`);
  if (!r.ok) return { ok: false, status: r.status, detail: r.data };
  const rows = (Array.isArray(r.data) ? r.data : []).map((row) => ({
    id: row.id,
    path: row.server_relative_path,
    vertical: row.vertical,
    status: row.status,
    subject_hint: row.subject_hint || {},
  }));
  return { ok: true, rows };
}

/**
 * Stamp the backfill marker on a folder_feed_seen row (merging the existing
 * subject_hint so the path anchor is preserved). Called ONLY for terminal
 * outcomes so transient failures retry. Effect-truthful: returns {ok}.
 */
async function markBackfilled(row, info, deps) {
  const q = deps.opsQuery || opsQuery;
  const merged = {
    ...cleanHint(row.subject_hint),
    lease_backfilled_at: new Date().toISOString(),
    lease_backfill: info,
  };
  const r = await q('PATCH', `folder_feed_seen?id=eq.${row.id}`,
    { subject_hint: merged, last_seen_at: new Date().toISOString() },
    { Prefer: 'return=minimal' }).catch(() => ({ ok: false }));
  return { ok: !!r.ok };
}

/**
 * Backfill ONE lease doc by re-running the lease extractor through the SAME
 * `attachLeaseDoc` the auto-route uses. Deps injected for testability.
 *
 * Outcome vocabulary (mapped from the attachLeaseDoc result, mirroring the
 * folder-feed worker's status mapping):
 *   enriched              — matched + applied (fill-blanks / conflicts → Decision Center)
 *   multitenant_deferred  — under a /Multi/ or /Portfolio/ deal folder; the
 *                           attachLeaseDoc gate refused (no extract, no lease) —
 *                           TERMINAL, marked so it drops out of the eligible queue
 *   needs_ocr             — scanned / no-text-layer PDF (sizes the OCR follow-up)
 *   ambiguous             — ≥2 in-domain near-misses → match_disambiguation lane
 *   no_domain             — no in-domain property (captured, tenant-searchable, no guess)
 *   error                 — extract/fetch failure (transient → NOT marked, retries)
 *
 * deps: { attachLeaseDoc, markBackfilled }
 */
export async function backfillOneLeaseDoc(row, ctx, deps) {
  const subjectHint = cleanHint(row.subject_hint);
  let res;
  try {
    res = await deps.attachLeaseDoc({
      storageRef: row.path,
      fileName:   fileNameFromPath(row.path),
      subjectHint,
      pathRef:    row.path,
      workspaceId: ctx.workspaceId,
      actorId:     ctx.actorId,
    });
  } catch (err) {
    return { id: row.id, path: row.path, outcome: 'error', reason: err?.message || 'threw' };
  }

  // ---- map the extractor result → a backfill outcome -----------------------
  // Multi-tenant / portfolio deal-folder: the shared attachLeaseDoc gate refused
  // (no extract, no lease, no edge). TERMINAL — mark it so it drops out of the
  // eligible queue and isn't re-listed every tick. NOT an error, NOT enriched.
  if (res?.multitenant_deferred) {
    const reason = res.skip_reason || 'multitenant_deal_folder';
    await deps.markBackfilled(row, { outcome: 'multitenant_deferred', skip_reason: reason });
    return { id: row.id, path: row.path, outcome: 'multitenant_deferred', skip_reason: reason };
  }
  if (res?.needs_ocr) {
    const out = { id: row.id, path: row.path, outcome: 'needs_ocr' };
    await deps.markBackfilled(row, { outcome: 'needs_ocr' });
    return out;
  }
  if (res?.attached && res?.lease) {
    const a = res.applied || {};
    const out = {
      id: row.id, path: row.path, outcome: 'enriched',
      domain: res.domain, property_id: res.property_id,
      fields_filled: a.fields_filled || 0,
      conflicts: a.conflicts || 0,
      ti_rows: a.ti_rows || 0,
      lease_created: !!a.lease_created,
      lease_id: a.lease_id ?? null,
      guarantor_entity_id: a.guarantor_entity_id || null,
      guaranteed_by_edge: a.guaranteed_by_edge ?? null,
      boundary_ok: res.boundary_ok ?? null,
    };
    await deps.markBackfilled(row, {
      outcome: 'enriched', domain: res.domain, property_id: res.property_id,
      fields_filled: out.fields_filled, conflicts: out.conflicts,
      ti_rows: out.ti_rows, lease_created: out.lease_created,
    });
    return out;
  }
  if (res?.emitted_disambiguation) {
    await deps.markBackfilled(row, { outcome: 'ambiguous' });
    return { id: row.id, path: row.path, outcome: 'ambiguous' };
  }
  if (res?.no_domain) {
    await deps.markBackfilled(row, { outcome: 'no_domain', reason: res.reason || null });
    return { id: row.id, path: row.path, outcome: 'no_domain', reason: res.reason || null };
  }
  // Anything else (extract_failed, ambiguous-emit failed, write failure) is
  // treated as transient → NOT marked, so a later tick retries it.
  return { id: row.id, path: row.path, outcome: 'error', reason: res?.reason || 'unresolved' };
}

const PROD_DEPS = {
  opsQuery,
  attachLeaseDoc: (a) => attachLeaseDoc(a),       // production wiring (live deps)
};

export async function handleLeaseBackfill(req, res, deps = PROD_DEPS) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  // Gated: capped batch. Default 15, hard cap 50 — the full corpus is drained by
  // repeated capped ticks, not one giant call (the artifact-offload lesson).
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '15', 10)));
  const tickBudgetMs = Math.max(5000, parseInt(process.env.LEASE_BACKFILL_TICK_BUDGET_MS || '22000', 10));
  const workspaceId = req.query.workspace_id
    || req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID
    || null;
  const actorId = user.id || user.user_id || null;

  // markBackfilled closes over deps so the test can stub opsQuery; the per-doc
  // worker calls deps.markBackfilled(row, info).
  const workerDeps = {
    attachLeaseDoc: deps.attachLeaseDoc || PROD_DEPS.attachLeaseDoc,
    markBackfilled: (row, info) => markBackfilled(row, info, deps),
  };

  const eligible = await fetchEligibleLeaseDocs(limit, deps);
  if (!eligible.ok) {
    return res.status(502).json({ error: 'list_failed', detail: eligible.detail });
  }

  const result = {
    mode: dryRun ? 'dry_run' : 'drain',
    eligible: eligible.rows.length,
    limit,
    scanned: 0,
    enriched: 0,
    multitenant_deferred: 0,
    needs_ocr: 0,
    ambiguous: 0,
    no_domain: 0,
    error: 0,
    // gate metrics
    fields_filled_total: 0,
    conflicts_total: 0,
    ti_rows_total: 0,
    leases_created: 0,
    guaranteed_by_edges: 0,
    items: [],
  };

  if (dryRun) {
    // No byte fetch / AI on a GET probe — just report WHAT WOULD be re-run.
    for (const row of eligible.rows) {
      const h = cleanHint(row.subject_hint);
      result.items.push({
        id: row.id, path: row.path, vertical: row.vertical, status: row.status,
        tenant_brand: h.tenant_brand || null, city: h.city || null, state: h.state || null,
      });
    }
    return res.status(200).json(result);
  }

  // Drain needs SharePoint bytes (read-back via the Get flow) + the extraction
  // AI. Without the Get flow it can't extract — return cleanly (graceful no-op),
  // the same posture as the rest of the folder-feed channel.
  if (!process.env.SHAREPOINT_FETCH_URL) {
    return res.status(200).json({ ...result, note: 'sharepoint_fetch_not_configured' });
  }

  const ctx = { workspaceId, actorId };
  const deadline = Date.now() + tickBudgetMs;
  for (const row of eligible.rows) {
    if (Date.now() > deadline) break;
    const r = await backfillOneLeaseDoc(row, ctx, workerDeps);
    result.scanned++;
    if (Object.prototype.hasOwnProperty.call(result, r.outcome)) result[r.outcome]++;
    if (r.outcome === 'enriched') {
      result.fields_filled_total += r.fields_filled || 0;
      result.conflicts_total += r.conflicts || 0;
      result.ti_rows_total += r.ti_rows || 0;
      if (r.lease_created) result.leases_created += 1;
      if (r.guaranteed_by_edge === true) result.guaranteed_by_edges += 1;
    }
    result.items.push(r);
  }

  return res.status(200).json(result);
}
