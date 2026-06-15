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
