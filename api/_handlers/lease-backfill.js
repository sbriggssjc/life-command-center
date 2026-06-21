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
// `lease_backfill_attempts` (the transient-retry counter) is NOT stripped — it
// must survive across ticks until the row is terminally marked or dead-lettered.
const BACKFILL_MARKER_KEYS = ['lease_backfilled_at', 'lease_backfill'];

// Dead-letter cap for genuinely-transient errors (extract/fetch/write failures
// that may clear). Mirrors LLC_MAX_ATTEMPTS: a "transient" that keeps failing is
// re-fetched at the head of the id.asc queue every tick, so without a cap it
// blocks forward progress forever. After this many attempts the row is marked
// terminal (`error_dead_letter`) and drops out for human follow-up. Deterministic
// failures (enrich_unprocessable / needs_ocr) are terminal on the FIRST pass and
// never reach the counter.
const LEASE_BACKFILL_MAX_ATTEMPTS = Math.max(1, parseInt(process.env.LEASE_BACKFILL_MAX_ATTEMPTS || '3', 10));

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
    '&select=id,server_relative_path,vertical,status,subject_hint,content_hash' +
    '&order=id.asc' +
    `&limit=${limit}`);
  if (!r.ok) return { ok: false, status: r.status, detail: r.data };
  const rows = (Array.isArray(r.data) ? r.data : []).map((row) => ({
    id: row.id,
    path: row.server_relative_path,
    vertical: row.vertical,
    status: row.status,
    subject_hint: row.subject_hint || {},
    content_hash: row.content_hash || null,
  }));
  return { ok: true, rows };
}

/**
 * UW#2b Fix 3 — content-hash dedupe lookup. The SAME executed instrument filed
 * under two folders (e.g. an estoppel under both /Lease/ and /Estoppel/) shares a
 * `content_hash`; re-extracting the copy would double-write the SAME conflicts on
 * the SAME property. Find an ALREADY-ENRICHED backfill row with the identical
 * content_hash (excluding this row's own id). Distinct documents (a real amendment
 * vs the base lease) carry DIFFERENT content_hashes → never matched here. Returns
 * `{ id, property_id }` of the prior enriched copy, or null.
 */
export async function findPriorBackfillByContentHash(contentHash, excludeId, deps) {
  if (!contentHash) return null;
  const q = deps.opsQuery || opsQuery;
  const r = await q('GET',
    'folder_feed_seen' +
    '?detected_type=eq.lease' +
    `&content_hash=eq.${encodeURIComponent(contentHash)}` +
    `&id=neq.${encodeURIComponent(excludeId)}` +
    '&subject_hint->lease_backfill->>outcome=eq.enriched' +
    '&select=id,subject_hint' +
    '&order=id.asc&limit=1').catch(() => ({ ok: false }));
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  const prior = r.data[0];
  return { id: prior.id, property_id: prior.subject_hint?.lease_backfill?.property_id ?? null };
}

/**
 * UW#4 OCR queue — lease docs already marked terminal `needs_ocr` (scanned /
 * no-text-layer). These are EXCLUDED from `fetchEligibleLeaseDocs` (they carry
 * `lease_backfilled_at`), so the free-OCR workstation drainer pulls them here,
 * recovers the text layer off-box, and re-submits via the single-doc id path.
 * A successful OCR re-process re-stamps `outcome='enriched'`, dropping the row
 * out of THIS queue — so the lane self-drains and is idempotent.
 */
export async function fetchOcrQueue(limit, deps) {
  const q = deps.opsQuery || opsQuery;
  const r = await q('GET',
    'folder_feed_seen' +
    '?detected_type=eq.lease' +
    '&vertical=in.(dia,gov)' +
    '&subject_hint->lease_backfill->>outcome=eq.needs_ocr' +
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
 * Fetch ONE folder_feed_seen lease row by id, bypassing the eligibility filter —
 * the single-doc free-OCR re-process targets a row already marked terminal
 * `needs_ocr`, which the queue selects exclude.
 */
export async function fetchLeaseDocById(id, deps) {
  const q = deps.opsQuery || opsQuery;
  const r = await q('GET',
    `folder_feed_seen?id=eq.${encodeURIComponent(id)}` +
    '&detected_type=eq.lease' +
    '&select=id,server_relative_path,vertical,status,subject_hint' +
    '&limit=1');
  if (!r.ok) return { ok: false, status: r.status, detail: r.data };
  const row = Array.isArray(r.data) ? r.data[0] : null;
  if (!row) return { ok: true, row: null };
  return { ok: true, row: { id: row.id, path: row.server_relative_path, vertical: row.vertical, status: row.status, subject_hint: row.subject_hint || {} } };
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
 * Bump the transient-retry counter WITHOUT marking the row terminal (no
 * `lease_backfilled_at`), so it stays eligible and retries on a later tick — but
 * the count is now durable, so backfillOneLeaseDoc can dead-letter it once it
 * crosses LEASE_BACKFILL_MAX_ATTEMPTS instead of re-running it at the head of the
 * queue forever. Preserves the existing hint (incl. the path anchor).
 */
async function bumpAttempt(row, attempts, deps) {
  const q = deps.opsQuery || opsQuery;
  const merged = { ...cleanHint(row.subject_hint), lease_backfill_attempts: attempts };
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
 *   duplicate_content     — same content_hash already enriched a property under
 *                           another folder (the estoppel filed twice) → TERMINAL,
 *                           skipped before any extract so it can't double-write
 *                           the same conflicts (UW#2b Fix 3)
 *   multitenant_deferred  — under a /Multi/ or /Portfolio/ deal folder; the
 *                           attachLeaseDoc gate refused (no extract, no lease) —
 *                           TERMINAL, marked so it drops out of the eligible queue
 *   draft_not_executed    — under a /Drafts/ segment OR a blackline/redline/draft/
 *                           version filename; the shared attachLeaseDoc gate
 *                           refused — an UNEXECUTED draft never mints an
 *                           authoritative lease. TERMINAL (Unit 2)
 *   needs_ocr             — scanned / no-text-layer PDF, incl. a matched doc whose
 *                           only text was a thin cover page (sizes the OCR follow-up)
 *   enrich_unprocessable  — matched, but the doc carries NO usable primary-lease
 *                           terms (amendment / master / co-tenant / draft /
 *                           unsupported). DETERMINISTIC → TERMINAL with its reason,
 *                           joins the OCR/format follow-up tail (never re-runs)
 *   enrich_create_rejected— matched, but the lease CREATE was rejected with a 4xx
 *                           (bad payload / constraint violation — NOT NULL / CHECK
 *                           / unique / FK). DETERMINISTIC (fails identically on
 *                           retry) → TERMINAL on the FIRST pass with the captured
 *                           SQLSTATE + column reason; separable from the benign
 *                           no-terms tail. (Unit 2, 2026-06-15)
 *   ambiguous             — ≥2 in-domain near-misses OR an operator-family
 *                           mismatch (DaVita doc vs Satellite property) OR a
 *                           location mismatch (FL doc vs CO/HQ property, Unit 1) →
 *                           match_disambiguation lane (reason distinguishes them)
 *   no_domain             — no in-domain property (captured, tenant-searchable, no guess)
 *   error                 — transient extract/fetch/write failure → NOT marked,
 *                           retries (bumps the attempt counter)
 *   error_dead_letter     — a transient error that kept failing past
 *                           LEASE_BACKFILL_MAX_ATTEMPTS → TERMINAL, so it can't
 *                           block the head of the id.asc queue forever
 *
 * deps: { attachLeaseDoc, markBackfilled, bumpAttempt? }
 */
export async function backfillOneLeaseDoc(row, ctx, deps) {
  // UW#2b Fix 3 — content-hash dedupe (BEFORE any byte fetch / extract). If a row
  // with an identical content_hash already ENRICHED a property, this is the same
  // executed instrument filed under a second folder; re-extracting it would
  // re-write the SAME conflicts on the SAME property. Skip it terminally. Distinct
  // documents (amendment vs base lease) have different hashes → never deduped.
  if (row.content_hash && deps.findPriorBackfill) {
    const prior = await deps.findPriorBackfill(row.content_hash, row.id).catch(() => null);
    if (prior) {
      await deps.markBackfilled(row, {
        outcome: 'duplicate_content', content_hash: row.content_hash,
        duplicate_of_id: prior.id ?? null, property_id: prior.property_id ?? null,
      });
      return {
        id: row.id, path: row.path, outcome: 'duplicate_content',
        duplicate_of_id: prior.id ?? null, property_id: prior.property_id ?? null,
      };
    }
  }

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
      // UW#4 — a workstation drainer may supply free-OCR'd text for a scanned
      // doc; when present the extractor uses it instead of in-server OCR.
      ocrText:       ctx.ocrText ?? null,
      ocrConfidence: ctx.ocrConfidence ?? null,
    });
  } catch (err) {
    // A thrown extractor is transient → fall through to the capped transient
    // handler (NOT an early return), so it can't re-throw at the head forever.
    res = { reason: `threw:${err?.message || 'err'}` };
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
  // Draft / unexecuted doc: the shared attachLeaseDoc gate refused (no extract,
  // no lease, no edge). TERMINAL — mark it so it drops out of the eligible queue
  // and isn't re-listed every tick. NOT an error, NOT enriched. (Unit 2)
  if (res?.draft_not_executed) {
    const reason = res.skip_reason || 'draft_not_executed';
    await deps.markBackfilled(row, { outcome: 'draft_not_executed', skip_reason: reason });
    return { id: row.id, path: row.path, outcome: 'draft_not_executed', skip_reason: reason };
  }
  if (res?.needs_ocr) {
    const info = { outcome: 'needs_ocr' };
    if (res.reason) info.reason = res.reason;            // 'needs_ocr' | 'thin_text_layer'
    if (res.text_len != null) info.text_len = res.text_len;
    await deps.markBackfilled(row, info);
    return { id: row.id, path: row.path, outcome: 'needs_ocr', reason: res.reason || null, text_len: res.text_len ?? null };
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
      ocr_tier: res.ocr_tier ?? null,            // UW#4 — provenance of the text layer
      ocr_confidence: res.ocr_confidence ?? null,
    };
    await deps.markBackfilled(row, {
      outcome: 'enriched', domain: res.domain, property_id: res.property_id,
      fields_filled: out.fields_filled, conflicts: out.conflicts,
      ti_rows: out.ti_rows, lease_created: out.lease_created,
      ocr_tier: out.ocr_tier, ocr_confidence: out.ocr_confidence,
    });
    return out;
  }
  // Matched but the doc has no usable primary-lease terms — DETERMINISTIC, so it
  // will never succeed on retry. Mark it terminal WITH its reason (queryable tail)
  // so it drops out of the queue immediately instead of re-running at the head.
  if (res?.enrich_unprocessable) {
    const reason = res.reason || 'enrich_unprocessable';
    await deps.markBackfilled(row, {
      outcome: 'enrich_unprocessable', reason,
      domain: res.domain, property_id: res.property_id, text_len: res.text_len ?? null,
    });
    return {
      id: row.id, path: row.path, outcome: 'enrich_unprocessable', reason,
      domain: res.domain, property_id: res.property_id, text_len: res.text_len ?? null,
    };
  }
  // Matched, but the lease CREATE was REJECTED with a 4xx (bad payload / constraint
  // violation). DETERMINISTIC — it fails identically on retry, so mark it terminal
  // on the FIRST pass with the captured SQLSTATE + column reason (queryable tail)
  // instead of bumping the attempt counter through three wasted ticks to the
  // dead-letter cap. Separable from enrich_unprocessable (the no-usable-terms tail).
  if (res?.enrich_create_rejected) {
    const reason = res.reason || 'enrich_create_rejected';
    await deps.markBackfilled(row, {
      outcome: 'enrich_create_rejected', reason,
      domain: res.domain, property_id: res.property_id, text_len: res.text_len ?? null,
    });
    return {
      id: row.id, path: row.path, outcome: 'enrich_create_rejected', reason,
      domain: res.domain, property_id: res.property_id, text_len: res.text_len ?? null,
    };
  }
  if (res?.emitted_disambiguation) {
    // reason distinguishes an address-ambiguous emit from the Unit-3 operator
    // mismatch (DaVita doc vs Satellite property) — both route to the same lane,
    // but the marker stays queryable.
    const reason = res.reason || null;
    await deps.markBackfilled(row, { outcome: 'ambiguous', reason });
    return { id: row.id, path: row.path, outcome: 'ambiguous', reason };
  }
  if (res?.no_domain) {
    await deps.markBackfilled(row, { outcome: 'no_domain', reason: res.reason || null });
    return { id: row.id, path: row.path, outcome: 'no_domain', reason: res.reason || null };
  }
  // Anything else (extract_failed, enrich write failure, ambiguous-emit failed,
  // a thrown extractor) is treated as TRANSIENT → retries on a later tick. But a
  // "transient" that keeps failing sits at the head of the id.asc queue and
  // re-runs every tick, starving forward progress — so it is dead-lettered after
  // LEASE_BACKFILL_MAX_ATTEMPTS (mirrors the LLC-tick cap). The attempt count is
  // persisted (bumpAttempt) WITHOUT marking the row terminal, so it stays eligible
  // until the cap, then drops out for human follow-up.
  const reason = res?.reason || 'unresolved';
  const attempts = Number(row.subject_hint?.lease_backfill_attempts || 0) + 1;
  if (attempts >= LEASE_BACKFILL_MAX_ATTEMPTS) {
    await deps.markBackfilled(row, { outcome: 'error_dead_letter', reason, attempts });
    return { id: row.id, path: row.path, outcome: 'error_dead_letter', reason, attempts };
  }
  if (deps.bumpAttempt) await deps.bumpAttempt(row, attempts);
  return { id: row.id, path: row.path, outcome: 'error', reason, attempts };
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
  // UW#2b Fix 3 — content-hash dedupe across the drain. An in-tick map catches two
  // copies in the SAME batch (the prior copy's marker may not be visible to a
  // read-after-write within the tick); the DB lookup catches a copy enriched on an
  // earlier tick. Together: the same instrument under two folders enriches once.
  const seenContentHashes = new Map();   // content_hash → { id, property_id } enriched this tick
  const workerDeps = {
    attachLeaseDoc: deps.attachLeaseDoc || PROD_DEPS.attachLeaseDoc,
    markBackfilled: (row, info) => markBackfilled(row, info, deps),
    bumpAttempt: (row, attempts) => bumpAttempt(row, attempts, deps),
    findPriorBackfill: async (contentHash, excludeId) => {
      if (!contentHash) return null;
      if (seenContentHashes.has(contentHash)) return seenContentHashes.get(contentHash);
      return findPriorBackfillByContentHash(contentHash, excludeId, deps);
    },
  };

  // ── UW#4 GET ?ocr_queue=1 — list the scanned (needs_ocr) lease docs ──────────
  // The free-OCR workstation drainer pulls its worklist here (read-only, no
  // byte fetch / AI), recovers each text layer off-box, and re-submits via the
  // single-doc POST below.
  if (req.method === 'GET' && (req.query.ocr_queue === '1' || req.query.ocr_queue === 'true')) {
    const oq = await fetchOcrQueue(limit, deps);
    if (!oq.ok) return res.status(502).json({ error: 'ocr_queue_list_failed', detail: oq.detail });
    return res.status(200).json({
      mode: 'ocr_queue', limit, count: oq.rows.length,
      items: oq.rows.map((row) => {
        const h = cleanHint(row.subject_hint);
        return {
          id: row.id, path: row.path, vertical: row.vertical,
          tenant_brand: h.tenant_brand || null, city: h.city || null, state: h.state || null,
          text_len: row.subject_hint?.lease_backfill?.text_len ?? null,
        };
      }),
    });
  }

  // ── UW#4 POST ?id=<id> — single-doc re-process with supplied free-OCR text ───
  // Re-runs ONE already-marked needs_ocr lease doc through the SAME attachLeaseDoc
  // machinery using the text layer the workstation drainer recovered off-box
  // (body.ocr_text). With no ocr_text the row escalates to in-server cloud OCR.
  // All guards / fill-blanks / provenance / dedupe are UNCHANGED — OCR only adds
  // a text layer. Bypasses the eligible-queue filter (needs_ocr rows are marked
  // terminal); a successful re-process re-stamps `enriched`, draining the queue.
  if (req.method === 'POST' && req.query.id) {
    if (!process.env.SHAREPOINT_FETCH_URL) {
      return res.status(200).json({ mode: 'ocr_resubmit', note: 'sharepoint_fetch_not_configured' });
    }
    const body = req.body || {};
    const ocrText = typeof body.ocr_text === 'string' && body.ocr_text.trim() ? body.ocr_text : null;
    const ocrConfidence = typeof body.ocr_confidence === 'number' ? body.ocr_confidence : null;
    const found = await fetchLeaseDocById(req.query.id, deps);
    if (!found.ok) return res.status(502).json({ error: 'lookup_failed', detail: found.detail });
    if (!found.row) return res.status(404).json({ error: 'lease_doc_not_found', id: req.query.id });
    const r = await backfillOneLeaseDoc(found.row, { workspaceId, actorId, ocrText, ocrConfidence }, workerDeps);
    return res.status(200).json({ mode: 'ocr_resubmit', id: found.row.id, ocr_text_supplied: !!ocrText, ocr_confidence: ocrConfidence, result: r });
  }

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
    duplicate_content: 0,
    multitenant_deferred: 0,
    needs_ocr: 0,
    enrich_unprocessable: 0,
    enrich_create_rejected: 0,
    ambiguous: 0,
    no_domain: 0,
    error: 0,
    error_dead_letter: 0,
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
      // Record the enriched content_hash so a same-batch duplicate (under a second
      // folder) is deduped without relying on read-after-write of the marker.
      if (row.content_hash) seenContentHashes.set(row.content_hash, { id: row.id, property_id: r.property_id ?? null });
    }
    result.items.push(r);
  }

  return res.status(200).json(result);
}
