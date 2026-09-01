// ============================================================================
// CRE doc-text drain — R58 "Unit 4", Step 2A handler
// Life Command Center · sub-route of intake.js (?_route=cre-doc-text-tick)
//
//   GET  /api/cre-doc-text-tick    — dry-run (lists the eligible queue, no fetch/OCR)
//   POST /api/cre-doc-text-tick    — drain (Unit-1 extract → write the CRE sidecar)
//
// The CRE-side twin of document-text.js: that one drains the DOMAIN dbs'
// property_documents.raw_text (deed/OM pipeline); THIS one fills the CRE registry
// text sidecar (lcc_cre_property_document_text) for lease/dd/om so Unit 4 and
// every access point reuse one extraction. Also drains the `cre.doc.text`
// enrichment_jobs lane the classify bridge enqueues (spec step 4).
//
// SAFE / GATED: capped batch (?limit default 15 / hard cap 50), wall-clock
// budgeted, idempotent on (document_id, extractor_version). needs_ocr is recorded
// (terminal-this-pass); a transient fetch failure records a DATED deferred-retry
// marker (DOC1) so the oldest-first backlog scan pages past it and re-admits it
// after CRE_DOC_TEXT_RETRY_AFTER_HOURS.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import {
  runPropertyDocText,
  fetchEligibleCreDocs,
  CRE_DOC_TEXT_VERSION,
} from '../_shared/cre-property-doc-text.js';
import { claimPendingJobs, finishJob } from '../_shared/bridges.js';

const PROD_DEPS = {}; // runPropertyDocText resolves opsQuery + Unit-1 internally

export async function handleCreDocTextTick(req, res, deps = PROD_DEPS) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const mode = (req.query.mode || 'eligible').toLowerCase(); // 'eligible' | 'jobs'
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '15', 10)));
  const doctype = (req.query.doctype || null);
  const version = req.query.version || CRE_DOC_TEXT_VERSION;
  const tickBudgetMs = Math.max(5000, parseInt(process.env.CRE_DOC_TEXT_TICK_BUDGET_MS || '22000', 10));

  const result = {
    mode: mode + (dryRun ? '_dry_run' : ''),
    version, doctype: doctype || 'lease,dd,om', limit,
    scanned: 0, text_extracted: 0, ocr: 0, already_extracted: 0, needs_ocr: 0, fetch_failed: 0, persist_failed: 0, error: 0, not_found: 0,
    // DOC1: a byte-fetch failure now leaves a dated deferred-retry marker so the
    // oldest-first scan can page past it. Counted separately from fetch_failed so
    // "we could not fetch it" and "and we recorded that" stay distinguishable.
    retry_marked: 0,
    ocr_pages_total: 0, ocr_by_engine: {}, items: [],
  };
  const bump = (r) => {
    result.scanned++;
    if (Object.prototype.hasOwnProperty.call(result, r.outcome)) result[r.outcome]++;
    if (r.retry_marked) result.retry_marked++;
    if (Number.isFinite(r.ocr_pages) && r.ocr_pages > 0) {
      result.ocr_pages_total += r.ocr_pages;
      const eng = r.ocr_engine || r.ocr_tier || 'unknown';
      result.ocr_by_engine[eng] = (result.ocr_by_engine[eng] || 0) + r.ocr_pages;
    }
    result.items.push(r);
  };
  const deadline = Date.now() + tickBudgetMs;

  // ---- Job-lane mode: drain the cre.doc.text enrichment_jobs the bridge enqueued.
  if (mode === 'jobs') {
    const jobs = dryRun ? [] : await (deps.claimPendingJobs || claimPendingJobs)(limit);
    result.claimed = jobs.length;
    for (const job of jobs) {
      if (Date.now() > deadline) break;
      if (job.job_type !== 'cre.doc.text') { await (deps.finishJob || finishJob)(job, { ok: true, result: { skipped: 'wrong_type' } }); continue; }
      const docId = job.external_id || job.payload?.document_id;
      const r = await runPropertyDocText(docId, { ...deps, version });
      r.job_id = job.id;
      bump(r);
      await (deps.finishJob || finishJob)(job, { ok: r.ok, error: r.ok ? null : r.reason, result: { outcome: r.outcome } });
    }
    return res.status(200).json(result);
  }

  // ---- Eligible-scan mode: find registry lease/dd/om with no sidecar yet.
  const eligible = await (deps.fetchEligibleCreDocs || fetchEligibleCreDocs)({ limit, doctype, version }, deps);
  if (!eligible.ok) {
    // A failed registry page or sidecar probe fails CLOSED (see
    // fetchEligibleCreDocs) — report the stage rather than draining a queue we
    // could not verify was undrained.
    return res.status(200).json({
      ...result, scan_failed: true, scan_stage: eligible.stage || null, error_detail: eligible.detail,
    });
  }
  result.eligible = eligible.rows.length;
  // DOC1 scan telemetry. ⚠️ Read scan_capped before reading eligible:0 as an
  // empty queue, and scan_lowest_id to confirm the walk is reaching the bottom
  // of the backlog rather than skimming the newest rows.
  result.scan_pages = eligible.scan_pages;
  result.scan_rows = eligible.scan_rows;
  result.scan_capped = eligible.scan_capped;
  result.scan_exhausted = eligible.scan_exhausted;
  result.scan_lowest_id = eligible.scan_lowest_id;
  result.scan_highest_id = eligible.scan_highest_id;
  result.retry_admitted = eligible.retry_admitted;
  result.eligible_lowest_id = eligible.rows.length ? Math.min(...eligible.rows.map((r) => r.id)) : null;

  if (dryRun) {
    result.items = eligible.rows.slice(0, 20).map((r) => ({
      document_id: r.id, cre_property_id: r.cre_property_id, document_type: r.document_type, file_name: r.file_name,
    }));
    return res.status(200).json(result);
  }

  for (const row of eligible.rows) {
    if (Date.now() > deadline) break;
    const r = await runPropertyDocText(row.id, { ...deps, registryRow: row, version });
    bump(r);
  }
  if (result.ocr_pages_total > 0) {
    console.log(`[cre-doc-text] OCR cost: ${result.ocr_pages_total} pages ${JSON.stringify(result.ocr_by_engine)}`);
  }
  return res.status(200).json(result);
}
