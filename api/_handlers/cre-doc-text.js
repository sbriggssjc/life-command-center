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
  fetchOverCapCreDocs,
  CRE_DOC_TEXT_VERSION,
  CRE_OCR_WINDOW_PAGES,
  CRE_OCR_WINDOW_BUDGET_MS,
} from '../_shared/cre-property-doc-text.js';
import { planPageWindow } from '../_shared/document-text.js';
import { claimPendingJobs, finishJob } from '../_shared/bridges.js';

const PROD_DEPS = {}; // runPropertyDocText resolves opsQuery + Unit-1 internally

export async function handleCreDocTextTick(req, res, deps = PROD_DEPS) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const mode = (req.query.mode || 'eligible').toLowerCase(); // 'eligible' | 'jobs' | 'longdoc'
  const isLongDoc = mode === 'longdoc';
  // ── DOC18 — THE TICK-BUDGET DECISION, STATED ────────────────────────────────
  // DOC17 measured a single DocAI call at 10.2 s (15 pages) and 19.3 s (15 pages);
  // a 50-page window is THREE calls, so it cannot fit the ordinary 22 s tick. Two
  // options were on the table (§2): span ticks, or give the route its own budget.
  //
  // CHOSEN: ITS OWN BUDGET, ONE DOCUMENT PER TICK, NO CROSS-TICK PARTIAL STATE.
  // Spanning ticks would need per-segment text persisted mid-document — a
  // half-written sidecar both consumers could read, and a limbo state that can
  // strand. Instead a document either completes its window inside one tick or
  // persists whatever pages it DID get (never discarded, so the next attempt
  // cannot double-charge for them) and stops. `lcc_cron_post` gives up listening
  // at 60 s while the handler runs on (P123) — read the sidecar delta, never the
  // caller's patience.
  const limit = isLongDoc
    ? Math.min(5, Math.max(1, parseInt(req.query.limit || '1', 10)))
    : Math.min(50, Math.max(1, parseInt(req.query.limit || '15', 10)));
  const doctype = (req.query.doctype || null);
  const version = req.query.version || CRE_DOC_TEXT_VERSION;
  const tickBudgetMs = isLongDoc
    ? CRE_OCR_WINDOW_BUDGET_MS
    : Math.max(5000, parseInt(process.env.CRE_DOC_TEXT_TICK_BUDGET_MS || '22000', 10));
  const windowTargetPages = Math.max(0, parseInt(req.query.window_pages || String(CRE_OCR_WINDOW_PAGES), 10) || 0);

  const result = {
    mode: mode + (dryRun ? '_dry_run' : ''),
    version, doctype: doctype || 'lease,dd,om', limit,
    scanned: 0, text_extracted: 0, ocr: 0, already_extracted: 0, needs_ocr: 0, fetch_failed: 0, persist_failed: 0, error: 0, not_found: 0,
    // DOC1: a byte-fetch failure now leaves a dated deferred-retry marker so the
    // oldest-first scan can page past it. Counted separately from fetch_failed so
    // "we could not fetch it" and "and we recorded that" stay distinguishable.
    retry_marked: 0,
    // DOC10: an OCR result too thin to be the document. It is NOT an extraction and
    // does not report as one — it writes DOC1's dated marker and re-admits.
    thin_ocr: 0,
    // DOC8: over Google's synchronous page cap, so no OCR was attempted at all.
    over_page_cap: 0,
    // DOC18: the multi-call window RAN and produced nothing — a different fact
    // from `over_page_cap` ("we never tried"), so they are counted apart.
    window_failed: 0,
    // DOC18: the window landed the consumer's pages on a document longer than it.
    // ⚠️ Complete for the consumer, INCOMPLETE for the document — it is counted
    // separately from `ocr` so a partial can never read as full coverage.
    partial_window: 0,
    window_pages_covered: 0,
    window_calls: 0,
    // ── DOC9 — THE COUNTER BUILT TO CATCH THE 6-14x ESCALATION WAS BLIND TO IT ──
    // The old bump() accumulated ONLY when `ocr_pages > 0`, and the gpt-4o path
    // returns no page count — so the 15:00 tick reported `ocr_by_engine: {}` and
    // `ocr_pages_total: 0` WHILE SPENDING gpt-4o MONEY. The spend guard read empty
    // precisely when the spend happened: failure-looks-like-success, inside the
    // instrument.
    //
    // ENGINE is counted UNCONDITIONALLY (documents), PAGES only when known. The two
    // are separate keys because they are different units and one name cannot carry
    // both — the old `ocr_by_engine` counted PAGES, so re-using that name for a
    // document count would silently change what every reader thinks it says. It is
    // REMOVED rather than redefined: a reader of the old field now gets `undefined`,
    // which is loud, instead of a plausible number meaning something else.
    //
    // ⚠️ An unknown page count is NOT reported as 0 (P180). It is counted in
    // `ocr_pages_unknown`, so `ocr_pages_total: 0` can never again mean "we OCR'd
    // nothing" when it actually means "we could not price what we OCR'd".
    ocr_docs: 0,
    ocr_docs_by_engine: {},
    ocr_pages_total: 0,
    ocr_pages_by_engine: {},
    ocr_pages_unknown: 0,
    items: [],
  };
  const bump = (r) => {
    result.scanned++;
    if (Object.prototype.hasOwnProperty.call(result, r.outcome)) result[r.outcome]++;
    if (r.retry_marked) result.retry_marked++;
    // An OCR was SERVED whenever a tier or an engine came back — independent of
    // whether that engine reports pages. This is the arm DOC9 adds.
    if (r.window) {
      result.window_calls += Number(r.window.calls || 0);
      result.window_pages_covered += Number(r.window.pages_covered || 0);
    }
    if (r.ocr_tier || r.ocr_engine) {
      result.ocr_docs++;
      const eng = r.ocr_engine || r.ocr_tier || 'unknown';
      result.ocr_docs_by_engine[eng] = (result.ocr_docs_by_engine[eng] || 0) + 1;
      if (Number.isFinite(r.ocr_pages) && r.ocr_pages > 0) {
        result.ocr_pages_total += r.ocr_pages;
        result.ocr_pages_by_engine[eng] = (result.ocr_pages_by_engine[eng] || 0) + r.ocr_pages;
      } else {
        result.ocr_pages_unknown++;
      }
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

  // ---- DOC18 long-document mode: drain the ceiling markers via the sync window.
  // ⚠️ Deliberately a SEPARATE lane. The eligible/jobs modes never pass
  // `ocrPageWindow`, so the ordinary under-cap drain is byte-identical to what it
  // does today — which is the one thing this build was told not to disturb.
  if (isLongDoc) {
    result.window_target_pages = windowTargetPages;
    if (!windowTargetPages) {
      // 0 disables the whole route. Say so rather than reporting an empty queue:
      // "switched off" and "nothing to do" are different facts.
      return res.status(200).json({ ...result, window_disabled: true, eligible: 0 });
    }
    const queue = await (deps.fetchOverCapCreDocs || fetchOverCapCreDocs)({ limit, version }, deps);
    if (!queue.ok) {
      return res.status(200).json({
        ...result, scan_failed: true, scan_stage: queue.stage || null, error_detail: queue.detail,
      });
    }
    result.eligible = queue.rows.length;
    result.registry_missing = queue.registry_missing || [];
    if (dryRun) {
      // The dry run costs NOTHING and shows the PLAN — how many calls each
      // document needs and over which ranges — so the spend is sized before it
      // happens rather than discovered afterwards.
      result.items = queue.rows.map((r) => ({
        document_id: r.id,
        document_type: r.document_type,
        file_name: r.file_name,
        page_count: r._marker?.page_count ?? null,
        marker_reason: r._marker?.reason ?? null,
        marker_age_at: r._marker?.extracted_at ?? null,
        plan: planPageWindow(r._marker?.page_count ?? null, { targetPages: windowTargetPages }),
      }));
      return res.status(200).json(result);
    }
    for (const row of queue.rows) {
      // Checked BEFORE each document, never mid-document: a window is atomic
      // within a tick (see the budget decision above).
      if (Date.now() > deadline) { result.budget_stopped = true; break; }
      const r = await runPropertyDocText(row.id, {
        ...deps,
        registryRow: row,
        version,
        ocrPageWindow: { targetPages: windowTargetPages, deadline },
      });
      bump(r);
    }
    if (result.ocr_docs > 0 || result.window_failed > 0) {
      console.log(
        `[cre-doc-text] LONGDOC: ${result.partial_window} partial + ${result.ocr} full` +
        ` | ${result.window_calls} DocAI calls, ${result.window_pages_covered} pages` +
        ` | ${result.window_failed} window_failed`,
      );
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
  // DOC9: log whenever OCR was SERVED, not only when pages were priced — an
  // unpriced gpt-4o document is exactly the line that used to be missing.
  if (result.ocr_docs > 0) {
    console.log(
      `[cre-doc-text] OCR: ${result.ocr_docs} docs ${JSON.stringify(result.ocr_docs_by_engine)}` +
      ` | ${result.ocr_pages_total} priced pages ${JSON.stringify(result.ocr_pages_by_engine)}` +
      ` | ${result.ocr_pages_unknown} docs with an UNKNOWN page count`,
    );
  }
  return res.status(200).json(result);
}
