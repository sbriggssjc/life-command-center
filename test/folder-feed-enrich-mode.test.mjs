// Phase 2 Slice 2a — PROPERTIES enrich-read channel: promoter mode threading.
//
// The folder-feed PROPERTIES channel stamps seed_data.mode='enrich', which the
// extractor forwards to the promoter as context.promoteMode='enrich'. This test
// drives the REAL promoter (promoteIntakeToDomainListing) through a global.fetch
// mock and asserts the enrich write policy:
//   • enrich + confident match  → fill-blanks property patch + property_documents
//     attach + field_provenance; NEVER an available_listings / sales_transactions
//     write; result.enrich_ok === true.
//   • enrich + no match          → a match_disambiguation decision is emitted
//     (lcc_open_decision) and NO property/listing is created; enrich_ok === false.
//   • ingest (default) + match   → the create/update listing path runs
//     (available_listings IS written) — the divergence proof.
//
// Env is set BEFORE the dynamic import because the domain/ops db helpers capture
// the *_SUPABASE_URL values at module load.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.DIA_SUPABASE_URL = 'https://dia.test.local';
process.env.DIA_SUPABASE_KEY = 'dia-key';
process.env.GOV_SUPABASE_URL = 'https://gov.test.local';
process.env.GOV_SUPABASE_KEY = 'gov-key';

const { promoteIntakeToDomainListing } = await import('../api/_handlers/intake-promoter.js');

const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    headers: { get(n) { return headers[n.toLowerCase()] || headers[n] || null; } },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

// Capture every write (method + url + body) so the assertions can check WHICH
// tables were written. existingProperty controls whether the dia property looks
// like it has blank fields to fill.
let calls;
function installFetchMock({ existingProperty } = {}) {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch { /* ignore */ }
    calls.push({ method, url: u, body });

    // dia.properties GET (promoteDiaPropertyFromOm lookup) → an existing row
    // with NULL fields the enrich path can fill.
    if (u.includes('/rest/v1/properties') && method === 'GET') {
      return jsonResponse(existingProperty ? [existingProperty] : []);
    }
    // property_documents attach → returns a doc id.
    if (u.includes('/rest/v1/property_documents') && method === 'POST') {
      return jsonResponse([{ document_id: 9001 }], true, 201);
    }
    // lcc_merge_field provenance + lcc_open_decision disambiguation → ok.
    if (u.includes('/rest/v1/rpc/lcc_merge_field')) return jsonResponse([{ decision: 'write' }]);
    if (u.includes('/rest/v1/rpc/lcc_open_decision')) return jsonResponse([{ id: 'dec-1' }]);

    // Any other POST returns a generic row; GETs find nothing.
    if (method === 'POST') return jsonResponse([{ listing_id: 1, id: 1 }], true, 201);
    if (method === 'PATCH') return jsonResponse([{ property_id: 123 }]);
    return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
  };
}

const SNAPSHOT = {
  document_type: 'om',
  address: '123 Main St',
  city: 'Tulsa',
  state: 'OK',
  tenant_name: 'DaVita Dialysis',
  year_built: 2015,
  annual_rent: 250000,
  lease_commencement: '2020-01-01',
};

const MATCHED = { status: 'matched', confidence: 0.95, domain: 'dialysis', property_id: 123 };
const UNMATCHED = { status: 'unmatched', confidence: 0, domain: 'dialysis', property_id: null };

// A dia property with blank fillable fields.
const BLANK_PROPERTY = {
  tenant: null, year_built: null, lot_sf: null, building_size: null,
  land_area: null, lease_commencement: null, anchor_rent: null,
  anchor_rent_date: null, anchor_rent_source: null, parcel_number: null,
};

function postUrls() {
  return calls.filter(c => c.method === 'POST').map(c => c.url);
}
function wroteTo(table) {
  return postUrls().some(u => u.includes(`/rest/v1/${table}`));
}

describe('enrich-mode promotion (PROPERTIES folder feed)', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('enrich + confident match → fills blanks, attaches doc, NO listing/sale', async () => {
    installFetchMock({ existingProperty: BLANK_PROPERTY });
    const res = await promoteIntakeToDomainListing('intake-enrich-1', SNAPSHOT, MATCHED, {
      promoteMode: 'enrich',
      seedData: { mode: 'enrich', source_path: '/sites/x/PROPERTIES/D/DaVita/Tulsa, OK/OM.pdf' },
      workspaceId: 'ws-1', actorId: 'user-1',
    });

    assert.equal(res.ok, true, 'enrich succeeded');
    assert.equal(res.mode, 'enrich');
    assert.equal(res.enrich_ok, true);
    assert.ok(res.fields_filled > 0, 'at least one blank field filled');

    // The doc was attached; provenance was recorded.
    assert.ok(wroteTo('property_documents'), 'doc attached to property_documents');
    assert.ok(wroteTo('rpc/lcc_merge_field'), 'field provenance recorded');

    // CRITICAL: enrich NEVER writes market events or creates a property.
    assert.equal(wroteTo('available_listings'), false, 'no listing write in enrich mode');
    assert.equal(wroteTo('sales_transactions'), false, 'no sales write in enrich mode');
    assert.equal(wroteTo('prospect_leads'), false, 'no lead write in enrich mode');
    // No POST to properties (creation); the only properties touch is a PATCH.
    assert.equal(wroteTo('properties'), false, 'no property INSERT in enrich mode');
  });

  it('enrich + no match → emits match_disambiguation, creates nothing', async () => {
    installFetchMock({ existingProperty: null });
    const res = await promoteIntakeToDomainListing('intake-enrich-2', SNAPSHOT, UNMATCHED, {
      promoteMode: 'enrich',
      seedData: { mode: 'enrich', source_path: '/sites/x/PROPERTIES/Z/Unknown/OM.pdf' },
      workspaceId: 'ws-1', actorId: 'user-1',
    });

    assert.equal(res.ok, false);
    assert.equal(res.mode, 'enrich');
    assert.equal(res.enrich_ok, false);
    assert.equal(res.skipped, 'enrich_unresolved');
    assert.equal(res.emitted_disambiguation, true, 'disambiguation decision emitted');

    assert.ok(wroteTo('rpc/lcc_open_decision'), 'lcc_open_decision called');
    assert.equal(wroteTo('available_listings'), false, 'no listing created');
    assert.equal(wroteTo('property_documents'), false, 'no doc attached for an unresolved file');
    assert.equal(wroteTo('properties'), false, 'no property created');
  });

  it('ingest (default) + confident match → runs the listing create path', async () => {
    installFetchMock({ existingProperty: BLANK_PROPERTY });
    const res = await promoteIntakeToDomainListing('intake-ingest-1', SNAPSHOT, MATCHED, {
      // no promoteMode → defaults to 'ingest' (every non-folder-feed channel)
      seedData: { source_path: null },
      workspaceId: 'ws-1', actorId: 'user-1',
    });

    assert.notEqual(res.mode, 'enrich', 'ingest path does not report enrich mode');
    // The divergence proof: ingest writes available_listings; enrich never does.
    assert.ok(wroteTo('available_listings'), 'ingest writes a listing');
  });
});
