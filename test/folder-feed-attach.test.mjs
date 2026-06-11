// Phase 2 Slice 2d (Unit 2) — attach ALL recognized doc types by path anchor.
//
// Drives the REAL light-attach handler (attachRecognizedDoc) + the REAL
// path-anchor matcher (matchByPathAnchor) through a global.fetch mock and
// asserts:
//   • a lease resolved by path anchor (exactly one tenant+city+state hit) →
//     attaches a property_documents row, writes provenance, NEVER creates a
//     property / listing / sale.
//   • an unresolved doc (no candidates) → emits a match_disambiguation decision
//     keyed on the path, attaches nothing.
//   • an ambiguous doc (a hit in BOTH domains) → routes to disambiguation, never
//     a guess-attach.
//
// Env set BEFORE import (db helpers capture *_SUPABASE_URL at load).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.DIA_SUPABASE_URL = 'https://dia.test.local';
process.env.DIA_SUPABASE_KEY = 'dia-key';
process.env.GOV_SUPABASE_URL = 'https://gov.test.local';
process.env.GOV_SUPABASE_KEY = 'gov-key';

const { attachRecognizedDoc } = await import('../api/_handlers/folder-feed-attach.js');

const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok, status,
    headers: { get(n) { return headers[n.toLowerCase()] || headers[n] || null; } },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

// diaRows / govRows control what the tenant+city+state matcher finds per domain.
let calls;
function installFetchMock({ diaRows = [], govRows = [] } = {}) {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch { /* ignore */ }
    calls.push({ method, url: u, body });

    // tenantCityStateMatch GET against each domain's properties table.
    if (u.includes('dia.test.local') && u.includes('/rest/v1/properties') && method === 'GET') {
      return jsonResponse(diaRows);
    }
    if (u.includes('gov.test.local') && u.includes('/rest/v1/properties') && method === 'GET') {
      return jsonResponse(govRows);
    }
    // property_documents attach (domain POST) → returns a doc id.
    if (u.includes('/rest/v1/property_documents') && method === 'POST') {
      return jsonResponse([{ document_id: 9001 }], true, 201);
    }
    // provenance merge_field + disambiguation decision RPCs (LCC Opps).
    if (u.includes('/rest/v1/rpc/lcc_merge_field')) return jsonResponse({ decision: 'write' });
    if (u.includes('/rest/v1/rpc/lcc_open_decision')) return jsonResponse({ id: 'dec-1' });

    return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
  };
}

const HINT_DIA = { tenant_brand: 'DaVita', city: 'Tulsa', state: 'OK', vertical: 'dia', bucket: 'D' };

describe('folder-feed light attach (Slice 2d Unit 2)', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('lease resolved by path anchor → attaches a property_documents row, no create', async () => {
    installFetchMock({ diaRows: [{ property_id: 26955, address: '123 Main St', tenant: 'DaVita' }] });

    const res = await attachRecognizedDoc({
      subjectHint: HINT_DIA,
      fileName: 'DaVita Tulsa Lease Abstract.pdf',
      sourceUrl: '/sites/x/PROPERTIES/D/DaVita/Tulsa, OK/lease.pdf',
      docType: 'lease',
      pathRef: '/sites/x/PROPERTIES/D/DaVita/Tulsa, OK/lease.pdf',
    });

    assert.equal(res.ok, true);
    assert.equal(res.attached, true);
    assert.equal(res.domain, 'dialysis');
    assert.equal(res.property_id, 26955);

    // Attached a property_documents row…
    const docWrites = calls.filter(c => c.url.includes('/property_documents') && c.method === 'POST');
    assert.ok(docWrites.length >= 1, 'property_documents POST happened');
    assert.equal(docWrites[0].body.document_type, 'lease');
    // …and recorded provenance…
    assert.ok(calls.some(c => c.url.includes('/rpc/lcc_merge_field')), 'provenance recorded');
    // …and NEVER wrote a listing / sale (light path, attach-only).
    assert.ok(!calls.some(c => c.url.includes('/available_listings')), 'no listing write');
    assert.ok(!calls.some(c => c.url.includes('/sales_transactions')), 'no sale write');
    // …and emitted NO disambiguation (it resolved).
    assert.ok(!calls.some(c => c.url.includes('/rpc/lcc_open_decision')), 'no disambiguation on a clean match');
  });

  it('no in-domain property (zero candidates) → terminal, NO decision, attaches nothing', async () => {
    // Stage A doctrine: most PROPERTIES docs are out-of-universe (no dia/gov
    // property). A zero-candidate result is captured terminally, NOT churned
    // into the match_disambiguation lane.
    installFetchMock({ diaRows: [], govRows: [] });

    const res = await attachRecognizedDoc({
      subjectHint: HINT_DIA,
      fileName: 'DaVita Tulsa BOV.pdf',
      sourceUrl: '/sites/x/PROPERTIES/D/DaVita/Tulsa, OK/bov.pdf',
      docType: 'bov',
      pathRef: '/sites/x/PROPERTIES/D/DaVita/Tulsa, OK/bov.pdf',
    });

    assert.equal(res.attached, false);
    assert.equal(res.emitted_disambiguation, false);
    assert.equal(res.no_domain, true);
    assert.ok(!calls.some(c => c.url.includes('/rpc/lcc_open_decision')), 'no decision emitted for out-of-universe doc');
    assert.ok(!calls.some(c => c.url.includes('/property_documents')), 'no doc attached when unresolved');
  });

  it('ambiguous (a hit in both domains via unknown vertical) → disambiguation, never a guess', async () => {
    installFetchMock({
      diaRows: [{ property_id: 1, address: 'A', tenant: 'Acme' }],
      govRows: [{ property_id: 2, address: 'B', agency: 'Acme' }],
    });

    const res = await attachRecognizedDoc({
      subjectHint: { tenant_brand: 'Acme', city: 'Reno', state: 'NV', vertical: null },
      fileName: 'Acme Reno DD.pdf',
      sourceUrl: '/sites/x/PROPERTIES/A/Acme/Reno, NV/dd.pdf',
      docType: 'dd',
      pathRef: '/sites/x/PROPERTIES/A/Acme/Reno, NV/dd.pdf',
    });

    assert.equal(res.attached, false);
    assert.equal(res.reason, 'ambiguous');
    assert.ok(calls.some(c => c.url.includes('/rpc/lcc_open_decision')), 'ambiguous routes to disambiguation');
    assert.ok(!calls.some(c => c.url.includes('/property_documents')), 'no guess-attach on ambiguity');
  });
});
