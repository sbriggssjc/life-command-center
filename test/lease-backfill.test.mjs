// Stage B widen — existing-corpus lease backfill. Re-runs the SAME lease
// extractor (attachLeaseDoc) over already-seen in-domain lease docs in
// folder_feed_seen. Proves: eligibility selection, outcome mapping, the marker
// idempotency gate (a backfilled row is excluded), gate-metric aggregation, and
// that transient errors are NOT marked (so they retry).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchEligibleLeaseDocs, backfillOneLeaseDoc,
} from '../api/_handlers/lease-backfill.js';

// ── fetchEligibleLeaseDocs ───────────────────────────────────────────────────
describe('lease backfill — eligibility selection', () => {
  it('filters lease + staged/attached + dia/gov + not-yet-backfilled, ordered, capped', async () => {
    let calledPath = null;
    const deps = {
      opsQuery: async (m, path) => {
        calledPath = path;
        return { ok: true, data: [
          { id: 1, server_relative_path: '/x/a.pdf', vertical: 'dia', status: 'staged', subject_hint: { vertical: 'dia', tenant_brand: 'DaVita' } },
          { id: 2, server_relative_path: '/x/b.pdf', vertical: 'gov', status: 'attached', subject_hint: { vertical: 'gov' } },
        ] };
      },
    };
    const out = await fetchEligibleLeaseDocs(15, deps);
    assert.equal(out.ok, true);
    assert.equal(out.rows.length, 2);
    assert.match(calledPath, /detected_type=eq\.lease/);
    assert.match(calledPath, /status=in\.\(staged,attached\)/);
    assert.match(calledPath, /vertical=in\.\(dia,gov\)/);
    assert.match(calledPath, /subject_hint->>lease_backfilled_at=is\.null/);  // idempotency gate
    assert.match(calledPath, /order=id\.asc/);
    assert.match(calledPath, /limit=15/);
  });

  it('surfaces a list failure (502 upstream)', async () => {
    const deps = { opsQuery: async () => ({ ok: false, status: 500, data: 'boom' }) };
    const out = await fetchEligibleLeaseDocs(15, deps);
    assert.equal(out.ok, false);
    assert.equal(out.status, 500);
  });
});

// ── backfillOneLeaseDoc — outcome mapping + marker discipline ─────────────────
describe('lease backfill — per-doc outcome mapping', () => {
  const row = (over = {}) => ({ id: 7, path: '/x/lease.pdf', vertical: 'dia', status: 'staged', subject_hint: { vertical: 'dia', tenant_brand: 'DaVita' }, ...over });
  const ctx = { workspaceId: 'w', actorId: 'u' };

  it('enriched (matched+applied) → counts fields/conflicts/TI/edge; MARKS the row', async () => {
    let marked = null;
    const deps = {
      attachLeaseDoc: async (a) => {
        assert.equal(a.storageRef, '/x/lease.pdf');
        assert.equal(a.subjectHint.lease_backfilled_at, undefined); // marker stripped
        return {
          ok: true, attached: true, lease: true, domain: 'dialysis', property_id: 30441,
          boundary_ok: true,
          applied: { fields_filled: 11, conflicts: 2, ti_rows: 1, lease_created: true, lease_id: 'abc', guarantor_entity_id: 'g1', guaranteed_by_edge: true },
        };
      },
      markBackfilled: async (r, info) => { marked = info; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);
    assert.equal(out.outcome, 'enriched');
    assert.equal(out.fields_filled, 11);
    assert.equal(out.conflicts, 2);
    assert.equal(out.ti_rows, 1);
    assert.equal(out.lease_created, true);
    assert.equal(out.guaranteed_by_edge, true);
    assert.equal(out.property_id, 30441);
    assert.ok(marked, 'enriched row was marked (idempotency)');
    assert.equal(marked.outcome, 'enriched');
  });

  it('UW#4 — supplied free-OCR text is forwarded to attachLeaseDoc + tier/conf recorded on the enriched receipt', async () => {
    let seen = null, marked = null;
    const deps = {
      attachLeaseDoc: async (a) => {
        seen = { ocrText: a.ocrText, ocrConfidence: a.ocrConfidence };
        return {
          ok: true, attached: true, lease: true, domain: 'dialysis', property_id: 30441, boundary_ok: true,
          ocr_tier: 'free_external', ocr_confidence: 81,
          applied: { fields_filled: 9, conflicts: 1, ti_rows: 0, lease_created: false },
        };
      },
      markBackfilled: async (r, info) => { marked = info; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), { workspaceId: 'w', actorId: 'u', ocrText: 'LEASE TEXT recovered by tesseract', ocrConfidence: 81 }, deps);
    assert.equal(seen.ocrText, 'LEASE TEXT recovered by tesseract'); // forwarded
    assert.equal(seen.ocrConfidence, 81);
    assert.equal(out.outcome, 'enriched');
    assert.equal(out.ocr_tier, 'free_external');                     // on the receipt
    assert.equal(out.ocr_confidence, 81);
    assert.equal(marked.ocr_tier, 'free_external');                  // and the marker
  });

  it('needs_ocr (scanned) → marks + records, never a 500', async () => {
    let marked = null;
    const deps = {
      attachLeaseDoc: async () => ({ ok: true, attached: false, needs_ocr: true, match_status: 'needs_ocr' }),
      markBackfilled: async (r, info) => { marked = info; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);
    assert.equal(out.outcome, 'needs_ocr');
    assert.equal(marked.outcome, 'needs_ocr');
  });

  it('ambiguous → match_disambiguation lane, marked', async () => {
    let marked = false;
    const deps = {
      attachLeaseDoc: async () => ({ ok: false, attached: false, emitted_disambiguation: true, match_status: 'review_required' }),
      markBackfilled: async () => { marked = true; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);
    assert.equal(out.outcome, 'ambiguous');
    assert.equal(marked, true);
  });

  it('operator mismatch (Unit 3) → ambiguous lane, MARKED with the operator_mismatch reason', async () => {
    let marked = null;
    const deps = {
      attachLeaseDoc: async () => ({ ok: false, attached: false, emitted_disambiguation: true,
        operator_mismatch: true, reason: 'operator_mismatch', property_operator: 'Satellite Healthcare',
        domain: 'dialysis', property_id: 30680, match_status: 'review_required' }),
      markBackfilled: async (r, info) => { marked = info; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);
    assert.equal(out.outcome, 'ambiguous');
    assert.equal(out.reason, 'operator_mismatch');
    assert.equal(marked.outcome, 'ambiguous');
    assert.equal(marked.reason, 'operator_mismatch');
  });

  it('no in-domain property → no_domain (captured, never a guess), marked', async () => {
    let marked = false;
    const deps = {
      attachLeaseDoc: async () => ({ ok: false, attached: false, no_domain: true, reason: 'no_domain_property' }),
      markBackfilled: async () => { marked = true; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);
    assert.equal(out.outcome, 'no_domain');
    assert.equal(marked, true);
  });

  it('extract/fetch failure → error, NOT marked (transient retries next tick)', async () => {
    let marked = false;
    const deps = {
      attachLeaseDoc: async () => ({ ok: false, attached: false, reason: 'extract_failed:timeout', match_status: null }),
      markBackfilled: async () => { marked = true; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);
    assert.equal(out.outcome, 'error');
    assert.equal(marked, false, 'transient error left unmarked so it retries');
  });

  it('a thrown extractor → error, not marked', async () => {
    let marked = false;
    const deps = {
      attachLeaseDoc: async () => { throw new Error('kaboom'); },
      markBackfilled: async () => { marked = true; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);
    assert.equal(out.outcome, 'error');
    assert.equal(marked, false);
  });

  it('matched-but-no-usable-terms → enrich_unprocessable, MARKED terminal with reason (drops out, never re-runs)', async () => {
    let marked = null;
    const deps = {
      attachLeaseDoc: async () => ({ ok: false, attached: false, enrich_unprocessable: true, reason: 'no_factual_fields', domain: 'government', property_id: 555, text_len: 4200, match_status: 'matched' }),
      markBackfilled: async (r, info) => { marked = info; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);
    assert.equal(out.outcome, 'enrich_unprocessable');
    assert.equal(out.reason, 'no_factual_fields');
    assert.equal(out.property_id, 555);
    assert.ok(marked, 'unprocessable doc MARKED → drops out of the id.asc queue immediately (no head-of-line block)');
    assert.equal(marked.outcome, 'enrich_unprocessable');
    assert.equal(marked.reason, 'no_factual_fields');
    assert.equal(marked.text_len, 4200);
  });

  it('create-4xx rejection → enrich_create_rejected, MARKED terminal on the FIRST pass (no attempt bump, no dead-letter)', async () => {
    let marked = null, bumped = false;
    const deps = {
      attachLeaseDoc: async () => ({ ok: false, attached: false, enrich_create_rejected: true,
        reason: 'create_failed:400:23502:leased_area', domain: 'dialysis', property_id: 40041, text_len: 8400, match_status: 'matched' }),
      markBackfilled: async (r, info) => { marked = info; return { ok: true }; },
      bumpAttempt: async () => { bumped = true; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);
    assert.equal(out.outcome, 'enrich_create_rejected');
    assert.equal(out.reason, 'create_failed:400:23502:leased_area');
    assert.equal(out.property_id, 40041);
    assert.equal(bumped, false, 'a deterministic 4xx is NOT routed through the transient attempt counter');
    assert.ok(marked, 'create-rejection MARKED → drops out of the id.asc queue on the first pass');
    assert.equal(marked.outcome, 'enrich_create_rejected');
    assert.equal(marked.reason, 'create_failed:400:23502:leased_area');
    assert.equal(marked.text_len, 8400);
  });

  it('needs_ocr carrying a thin-text reason → marked with reason + text_len (the scanned mis-route, fixed)', async () => {
    let marked = null;
    const deps = {
      attachLeaseDoc: async () => ({ ok: false, attached: false, needs_ocr: true, reason: 'thin_text_layer', text_len: 120, match_status: 'needs_ocr' }),
      markBackfilled: async (r, info) => { marked = info; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);
    assert.equal(out.outcome, 'needs_ocr');
    assert.equal(out.reason, 'thin_text_layer');
    assert.equal(marked.reason, 'thin_text_layer');
    assert.equal(marked.text_len, 120);
  });

  it('transient error UNDER the cap → error, NOT marked, bumps the attempt counter (still retries)', async () => {
    let marked = false, bumped = null;
    const deps = {
      attachLeaseDoc: async () => ({ ok: false, attached: false, reason: 'enrich_create_failed:503', match_status: 'matched' }),
      markBackfilled: async () => { marked = true; return { ok: true }; },
      bumpAttempt: async (r, n) => { bumped = n; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);   // attempts 0 → 1
    assert.equal(out.outcome, 'error');
    assert.equal(out.attempts, 1);
    assert.equal(marked, false, 'still retryable → not terminally marked');
    assert.equal(bumped, 1, 'attempt counter persisted so the cap can fire later');
  });

  it('transient error AT the cap → error_dead_letter, MARKED terminal (cannot block the head forever)', async () => {
    let marked = null;
    const deps = {
      attachLeaseDoc: async () => ({ ok: false, attached: false, reason: 'enrich_create_failed:503', match_status: 'matched' }),
      markBackfilled: async (r, info) => { marked = info; return { ok: true }; },
      bumpAttempt: async () => ({ ok: true }),
    };
    // Two prior failures recorded → this attempt reaches LEASE_BACKFILL_MAX_ATTEMPTS (3).
    const out = await backfillOneLeaseDoc(row({ subject_hint: { vertical: 'dia', lease_backfill_attempts: 2 } }), ctx, deps);
    assert.equal(out.outcome, 'error_dead_letter');
    assert.equal(out.attempts, 3);
    assert.equal(marked.outcome, 'error_dead_letter');
    assert.equal(marked.attempts, 3);
  });

  it('a thrown extractor is transient → error (routed through the cap), not an opaque early-return', async () => {
    let bumped = null;
    const deps = {
      attachLeaseDoc: async () => { throw new Error('kaboom'); },
      markBackfilled: async () => ({ ok: true }),
      bumpAttempt: async (r, n) => { bumped = n; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row(), ctx, deps);
    assert.equal(out.outcome, 'error');
    assert.match(out.reason, /threw:kaboom/);
    assert.equal(bumped, 1);
  });

  it('strips backfill marker keys from the hint before re-running (no leak into disambiguation)', async () => {
    let passedHint = null;
    const deps = {
      attachLeaseDoc: async (a) => { passedHint = a.subjectHint; return { ok: false, attached: false, no_domain: true }; },
      markBackfilled: async () => ({ ok: true }),
    };
    await backfillOneLeaseDoc(row({ subject_hint: { vertical: 'gov', tenant_brand: 'X', lease_backfilled_at: '2026-01-01', lease_backfill: { outcome: 'error' } } }), ctx, deps);
    assert.equal(passedHint.lease_backfilled_at, undefined);
    assert.equal(passedHint.lease_backfill, undefined);
    assert.equal(passedHint.tenant_brand, 'X');
  });
});
