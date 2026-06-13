// R15 Phase 2 — CRE owner backfill worker core (deps injected). Contract:
//   • NULL-owner property + master doc with an owner → owner minted + linked
//   • no clean owner (extract returns null) → stays NULL, ensureOwner NEVER called
//   • owner rejected by the shared guard → owner_rejected, setOwner NEVER called
//   • dia/gov untouched — the worker only reads CRE docs + writes CRE owners
//     (there is no domain-write dep; asserted structurally below)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';

const { backfillOneProperty } = await import('../api/_handlers/cre-owner-backfill.js');

function deps(overrides = {}) {
  const calls = { fetch: 0, extract: 0, ensure: 0, set: 0 };
  const base = {
    _calls: calls,
    fetchBytes: async () => { calls.fetch++; return { ok: true, buffer: Buffer.from('xlsx'), contentType: null }; },
    extractOwner: async () => { calls.extract++; return { name: 'Vervent Holdings LLC', method: 'master_sheet_label_scan' }; },
    ensureOwner: async () => { calls.ensure++; return { ok: true, entityId: 'ent-cre-1' }; },
    setOwner: async () => { calls.set++; return { ok: true, patched: true }; },
  };
  return { ...base, ...overrides, _calls: calls };
}

const PROP = {
  id: 1,
  tenant_brand: 'Vervent',
  docs: [
    { document_type: 'om', source_url: '/x/om.pdf' },
    { document_type: 'master', source_url: '/PROPERTIES/V/Vervent/Vervent (Master Sheet).xlsx', file_name: 'Vervent (Master Sheet).xlsx' },
  ],
};

describe('backfillOneProperty', () => {
  it('null-owner property + master doc → owner minted + linked (reads the MASTER doc)', async () => {
    const d = deps();
    let readUrl = null;
    d.fetchBytes = async (url) => { d._calls.fetch++; readUrl = url; return { ok: true, buffer: Buffer.from('xlsx') }; };
    const r = await backfillOneProperty(PROP, d);
    assert.equal(r.status, 'owner_set');
    assert.equal(r.owner_entity_id, 'ent-cre-1');
    assert.equal(r.owner_name, 'Vervent Holdings LLC');
    assert.match(readUrl, /Master Sheet/, 'reads the master sheet, not the OM');
    assert.equal(d._calls.ensure, 1);
    assert.equal(d._calls.set, 1);
  });

  it('no clean owner → stays NULL, never invents (ensureOwner NOT called)', async () => {
    const d = deps({ extractOwner: async () => ({ name: null, method: 'master_sheet_label_scan' }) });
    const r = await backfillOneProperty(PROP, d);
    assert.equal(r.status, 'no_owner_found');
    assert.equal(d._calls.ensure, 0, 'never mints when no owner name was extracted');
    assert.equal(d._calls.set, 0);
  });

  it('owner rejected by the shared guard → owner_rejected, setOwner NOT called', async () => {
    const d = deps({ ensureOwner: async () => ({ ok: false, skipped: 'implausible_person_name' }) });
    const r = await backfillOneProperty(PROP, d);
    assert.equal(r.status, 'owner_rejected');
    assert.equal(r.skipped, 'implausible_person_name');
    assert.equal(d._calls.set, 0, 'never links a rejected owner');
  });

  it('no readable doc → no_readable_doc (never fetches/mints)', async () => {
    const d = deps();
    const r = await backfillOneProperty({ id: 9, docs: [{ document_type: 'master' /* no source_url */ }] }, d);
    assert.equal(r.status, 'no_readable_doc');
    assert.equal(d._calls.fetch, 0);
    assert.equal(d._calls.ensure, 0);
  });

  it('fetch failure → fetch_failed, never mints', async () => {
    const d = deps({ fetchBytes: async () => ({ ok: false, detail: 'SHAREPOINT_FETCH_URL unset' }) });
    const r = await backfillOneProperty(PROP, d);
    assert.equal(r.status, 'fetch_failed');
    assert.equal(d._calls.ensure, 0);
  });

  it('already-set (another tick won the race) → already_set, idempotent', async () => {
    const d = deps({ setOwner: async () => ({ ok: true, patched: false }) });
    const r = await backfillOneProperty(PROP, d);
    assert.equal(r.status, 'already_set');
  });

  it('blocker 3 — master has no owner → falls through to the OM/BOV, which does', async () => {
    const reads = [];
    const d = deps({
      fetchBytes: async (url) => { reads.push(url); return { ok: true, buffer: Buffer.from('x') }; },
      // master (read first) yields no owner; the om yields one.
      extractOwner: async ({ fileName }) =>
        /master/i.test(String(fileName || '')) || reads.length === 1
          ? { name: null, method: 'master_sheet_label_scan' }
          : { name: 'Office Owner LP', method: 'pdf_ai_fallback' },
    });
    const prop = {
      id: 5,
      tenant_brand: 'Vervent',
      docs: [
        { document_type: 'master', source_url: '/m.xlsx', file_name: 'Master.xlsx' },
        { document_type: 'om', source_url: '/om.pdf', file_name: 'OM.pdf' },
      ],
    };
    const r = await backfillOneProperty(prop, d);
    assert.equal(r.status, 'owner_set');
    assert.equal(r.owner_name, 'Office Owner LP');
    assert.equal(reads.length, 2, 'tried the master first, then the om');
  });

  it('blocker 3 — every doc read but no owner → marks the property exhausted', async () => {
    let marked = null;
    const d = deps({
      extractOwner: async () => ({ name: null, method: 'master_sheet_label_scan' }),
      markExhausted: async (id, meta, info) => { marked = { id, meta, info }; return { ok: true }; },
    });
    const prop = { id: 7, metadata: { x: 1 }, docs: [{ document_type: 'master', source_url: '/m.xlsx', file_name: 'M.xlsx' }] };
    const r = await backfillOneProperty(prop, d);
    assert.equal(r.status, 'no_owner_found');
    assert.equal(marked.id, 7);
    assert.equal(marked.info.reason, 'no_owner_found');
  });

  it('blocker 3 — a pure fetch failure is transient: NOT marked exhausted', async () => {
    let marked = false;
    const d = deps({
      fetchBytes: async () => ({ ok: false, detail: 'down' }),
      markExhausted: async () => { marked = true; return { ok: true }; },
    });
    const prop = { id: 8, docs: [{ document_type: 'master', source_url: '/m.xlsx', file_name: 'M.xlsx' }] };
    const r = await backfillOneProperty(prop, d);
    assert.equal(r.status, 'fetch_failed');
    assert.equal(marked, false, 'transient fetch failure retries next tick');
  });

  it('blocker 1 — surfaces reuse on the result when the owner was reused', async () => {
    const d = deps({ ensureOwner: async () => ({ ok: true, entityId: 'dia-1', reused: true, reused_domain: 'dia' }) });
    const r = await backfillOneProperty(PROP, d);
    assert.equal(r.status, 'owner_set');
    assert.equal(r.reused, true);
    assert.equal(r.reused_domain, 'dia');
  });
});
