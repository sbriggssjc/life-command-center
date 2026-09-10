// PR-scanner writeback guard (2026-09-10)
//
// api/_shared/public-records-writeback.js routes the sidepanel's assessor /
// recorder / SOS scan captures through real structured writers. Before this
// module the sidepanel discarded everything except `name` + a description
// string — see extension/sidepanel.js loadOrgView / saveOrgBtn.
//
// This guard is BEHAVIOURAL: it stubs domainQuery / ensureEntityLink /
// insertEntityRelationship (via the injectable `deps` param) and runs the
// real exported functions against synthetic scan payloads, then asserts on
// what they actually did — never on a grep of the source.
//
// The one hard invariant the ship instructions call out by name: a
// registered-agent SERVICE address (CSC / CT Corporation / a law firm / a PO
// box) must NEVER become an llc_member's/llc_manager's recorded residence.
// That is tested by starving the stub of any address write and asserting it
// is never called for a service address, then proving the SAME code path
// DOES write a residential address when one is eligible (positive control —
// a gate that never fires either way is not evidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAssessorCapture,
  applyRecorderCapture,
  applySosEntityCapture,
  parseCurrency,
  parseLotSf,
  parseSosOfficers,
  edgeTypeForRole,
  ASSESSOR_SOURCE,
  RECORDER_SOURCE,
  SOS_SOURCE,
} from '../api/_shared/public-records-writeback.js';

// ── pure helpers ────────────────────────────────────────────────────────────

test('parseCurrency strips $ and commas', () => {
  assert.equal(parseCurrency('$1,234,567'), 1234567);
  assert.equal(parseCurrency(500000), 500000);
  assert.equal(parseCurrency(''), null);
  assert.equal(parseCurrency(null), null);
});

test('parseLotSf converts "X acres" to square feet, leaves a bare number alone', () => {
  assert.equal(parseLotSf('1.00 acre'), 43560);
  assert.equal(parseLotSf('2.5 Acres'), Math.round(2.5 * 43560));
  assert.equal(parseLotSf('12000'), 12000);
  assert.equal(parseLotSf(''), null);
});

test('parseSosOfficers splits a semicolon-joined block into named parties with roles', () => {
  const out = parseSosOfficers('John Smith, Manager; Jane Doe, Member');
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'John Smith');
  assert.equal(out[0].role, 'Manager');
  assert.equal(out[1].name, 'Jane Doe');
  assert.equal(out[1].role, 'Member');
});

test('edgeTypeForRole maps manager-shaped roles to llc_manager, else llc_member', () => {
  assert.equal(edgeTypeForRole('Manager'), 'llc_manager');
  assert.equal(edgeTypeForRole('President'), 'llc_manager');
  assert.equal(edgeTypeForRole('Member'), 'llc_member');
  assert.equal(edgeTypeForRole(null), 'llc_member');
});

// ── assessor writer ─────────────────────────────────────────────────────────

function stubDomainQuery(script) {
  // script: array of {match: (domain, method, path, body) => bool, res}
  const calls = [];
  const fn = async (domain, method, path, body) => {
    calls.push({ domain, method, path, body });
    for (const s of script) {
      if (s.match(domain, method, path, body)) return s.res;
    }
    return { ok: false, status: 404, data: { error: 'unhandled stub call', domain, method, path } };
  };
  fn.calls = calls;
  return fn;
}

test('applyAssessorCapture: a synthetic assessor scan lands parcel + tax fields on a NEW dia row', async () => {
  const q = stubDomainQuery([
    { match: (d, m, p) => d === 'dialysis' && m === 'GET' && p.startsWith('parcel_records'), res: { ok: true, data: [] } },
    { match: (d, m, p) => d === 'dialysis' && m === 'POST' && p === 'parcel_records', res: { ok: true, data: [{ id: 501 }] } },
    { match: (d, m, p) => d === 'dialysis' && m === 'GET' && p.startsWith('property_public_records'), res: { ok: true, data: [] } },
    { match: (d, m, p) => d === 'dialysis' && m === 'POST' && p === 'property_public_records', res: { ok: true, data: [] } },
    { match: (d, m, p) => d === 'dialysis' && m === 'GET' && p.startsWith('tax_records'), res: { ok: true, data: [] } },
    { match: (d, m, p) => d === 'dialysis' && m === 'POST' && p === 'tax_records', res: { ok: true, data: [{ id: 900 }] } },
  ]);

  const capture = {
    parcel_number: '123-45-678',
    county: 'Maricopa',
    state: 'AZ',
    owner_name: 'Some County Assessor Owner LLC',
    assessed_value: '$2,500,000',
    land_value: '$800,000',
    improvement_value: '$1,700,000',
    tax_amount: '$45,000',
    year_built: '2005',
    square_footage: '18,200',
    lot_size: '1.2 acres',
    zoning: 'C-2',
    property_type: 'Medical Office',
  };

  const result = await applyAssessorCapture('dialysis', 4242, capture, {}, { domainQuery: q });
  assert.equal(result.ok, true);
  assert.equal(result.parcel.op, 'insert');
  assert.equal(result.tax.op, 'insert');

  const parcelInsert = q.calls.find((c) => c.method === 'POST' && c.path === 'parcel_records');
  assert.ok(parcelInsert, 'expected a parcel_records INSERT');
  assert.equal(parcelInsert.body.apn, '123-45-678');
  assert.equal(parcelInsert.body.assessed_value, 2500000);
  assert.equal(parcelInsert.body.year_built, 2005);
  assert.equal(parcelInsert.body.building_sf, 18200);
  assert.equal(parcelInsert.body.lot_sf, Math.round(1.2 * 43560));
  assert.equal(parcelInsert.body.raw_payload.source, ASSESSOR_SOURCE);
  // owner_name rides through UNCHANGED from the scan — never backfilled from
  // a property record we already hold (the gov ORE Phase A1 "echo" defect).
  assert.equal(parcelInsert.body.owner_name, 'Some County Assessor Owner LLC');

  const taxInsert = q.calls.find((c) => c.method === 'POST' && c.path === 'tax_records');
  assert.ok(taxInsert, 'expected a tax_records INSERT');
  assert.equal(taxInsert.body.tax_amount, 45000);
});

test('applyAssessorCapture: an existing parcel row is PATCHed fill-blanks-only, never overwritten', async () => {
  const patches = [];
  const q = async (domain, method, path, body) => {
    if (domain === 'dialysis' && method === 'GET' && path.startsWith('parcel_records')) {
      return { ok: true, data: [{ id: 77, building_sf: 9999, lot_sf: null, year_built: null, zoning: null, land_use: null, owner_name: 'Existing Curated Owner', assessed_value: null }] };
    }
    if (domain === 'dialysis' && method === 'PATCH' && path.startsWith('parcel_records')) {
      patches.push({ path, body });
      return { ok: true, data: [] };
    }
    if (domain === 'dialysis' && method === 'GET' && path.startsWith('property_public_records')) return { ok: true, data: [{ id: 1 }] };
    if (domain === 'dialysis' && method === 'GET' && path.startsWith('tax_records')) return { ok: true, data: [{ id: 5, tax_amount: null, assessed_value: null }] };
    if (domain === 'dialysis' && method === 'PATCH' && path.startsWith('tax_records')) { patches.push({ path, body }); return { ok: true, data: [] }; }
    return { ok: true, data: [] };
  };

  const capture = { parcel_number: 'X', square_footage: '5000', assessed_value: '1000000', tax_amount: '10000' };
  const result = await applyAssessorCapture('dialysis', 1, capture, {}, { domainQuery: q });
  assert.equal(result.ok, true);

  const parcelPatch = patches.find((p) => p.path.startsWith('parcel_records'));
  assert.ok(parcelPatch, 'expected a parcel_records PATCH');
  // building_sf was already 9999 on the row — fill-blanks must NOT send it.
  assert.equal('building_sf' in parcelPatch.body, false, 'must not overwrite an existing building_sf');
  // assessed_value was blank — the offered value IS sent.
  assert.equal(parcelPatch.body.assessed_value, 1000000);
});

// ── recorder writer ──────────────────────────────────────────────────────────

test('applyRecorderCapture: a synthetic recorder scan lands a deed_records row with grantor/grantee', async () => {
  const q = stubDomainQuery([
    { match: (d, m, p) => d === 'government' && m === 'GET' && p.startsWith('deed_records'), res: { ok: true, data: [] } },
    { match: (d, m, p) => d === 'government' && m === 'POST' && p === 'deed_records', res: { ok: true, data: [{ deed_id: 88 }] } },
    { match: (d, m, p) => d === 'government' && m === 'GET' && p.startsWith('property_public_records'), res: { ok: true, data: [] } },
    { match: (d, m, p) => d === 'government' && m === 'POST' && p === 'property_public_records', res: { ok: true, data: [] } },
  ]);
  const capture = {
    document_type: 'Warranty Deed',
    grantor: 'ABC Sellers LLC',
    grantee: 'XYZ Buyers LLC',
    sale_price: '$4,500,000',
    sale_date: '2026-03-01',
    book_page: 'DOC-2026-00123',
    county: 'Fulton',
    state: 'GA',
  };
  const result = await applyRecorderCapture('government', 99, capture, {}, { domainQuery: q });
  assert.equal(result.ok, true);
  const insert = q.calls.find((c) => c.method === 'POST' && c.path === 'deed_records');
  assert.ok(insert);
  assert.equal(insert.body.grantor, 'ABC Sellers LLC');
  assert.equal(insert.body.grantee, 'XYZ Buyers LLC');
  assert.equal(insert.body.consideration, 4500000);
  assert.equal(insert.body.raw_payload.source, RECORDER_SOURCE);
});

test('applyRecorderCapture: a duplicate data_hash is a no-op, never a second insert', async () => {
  const q = async (domain, method, path) => {
    if (method === 'GET' && path.startsWith('deed_records')) return { ok: true, data: [{ deed_id: 5 }] };
    return { ok: false, status: 500, data: null };
  };
  const capture = { grantor: 'A', grantee: 'B', book_page: 'DOC-1', sale_date: '2026-01-01', state: 'TX' };
  const result = await applyRecorderCapture('government', 1, capture, {}, { domainQuery: q });
  assert.equal(result.ok, true);
  assert.equal(result.deed.op, 'already_present');
});

// ── SOS writer: entity_relationships edges + the residential/agent-service gate ─

function stubEntityLink(idFactory) {
  let n = 1000;
  return async ({ seedFields }) => ({ ok: true, entityId: String(++n), entity: { id: String(n) } });
}

test('applySosEntityCapture: creates the org + an llc_manager edge for a named officer', async () => {
  const edgeCalls = [];
  const capture = {
    name: 'Acme Holdings LLC',
    officers: 'Robert Jones, Manager',
    principal_address: '123 Main St, Phoenix, AZ 85001',
  };
  const result = await applySosEntityCapture(capture, { workspaceId: 'ws1' }, {
    resolvePrimaryWorkspaceId: async () => 'ws1',
    ensureEntityLink: stubEntityLink(),
    insertEntityRelationship: async (row) => { edgeCalls.push(row); return { ok: true }; },
    // a real residential address, so this positive control proves the gate
    // CAN write — see the negative control below for the agent-service case.
    classifyReverseAddress: () => ({ eligible: true, reason: 'residential_candidate' }),
    patchEntityAddress: async () => ({ ok: true }),
  });
  assert.equal(result.ok, true);
  assert.equal(edgeCalls.length, 1);
  assert.equal(edgeCalls[0].relationship_type, 'llc_manager');
  assert.equal(edgeCalls[0].metadata.source, SOS_SOURCE);
  assert.equal(edgeCalls[0].metadata.address_attributed, true);
});

// The hard invariant: a registered-agent SERVICE address must NEVER become a
// person's recorded residence. classifyReverseAddress is the real,
// unmodified export from address-reverse.js here — not stubbed — so this
// proves the actual CSC/registered-agent detector gates the write.
test('applySosEntityCapture: a CSC registered-agent address is NEVER written as the agent\'s residence', async () => {
  let addressWriteCalled = false;
  const capture = {
    name: 'Beta Ventures LLC',
    registered_agent: 'John Q. Public',
    agent_address: 'c/o Corporation Service Company, 251 Little Falls Drive, Wilmington, DE 19808',
  };
  const result = await applySosEntityCapture(capture, {}, {
    resolvePrimaryWorkspaceId: async () => 'ws1',
    ensureEntityLink: stubEntityLink(),
    insertEntityRelationship: async () => ({ ok: true }),
    patchEntityAddress: async () => { addressWriteCalled = true; return { ok: true }; },
    // classifyReverseAddress is the REAL export — no stub — so this is a
    // genuine positive control, not an assertion the test wrote itself.
  });
  assert.equal(result.ok, true);
  assert.equal(addressWriteCalled, false,
    'a registered-agent SERVICE address must never be written as a residence');
  const edge = result.edges.find((e) => e.name === 'John Q. Public');
  assert.ok(edge, 'the officer edge must still be created (only the ADDRESS is gated)');
  assert.equal(edge.address_attributed, false);
});

test('applySosEntityCapture: the SAME code path DOES attach a real residential address (positive control)', async () => {
  let attached = null;
  const capture = {
    name: 'Gamma Properties LLC',
    registered_agent: 'Mary Landowner',
    agent_address: '4821 Oak Ridge Lane, Austin, TX 78704',
  };
  const result = await applySosEntityCapture(capture, {}, {
    resolvePrimaryWorkspaceId: async () => 'ws1',
    ensureEntityLink: stubEntityLink(),
    insertEntityRelationship: async () => ({ ok: true }),
    patchEntityAddress: async (entityId, address) => { attached = address; return { ok: true }; },
  });
  assert.equal(result.ok, true);
  assert.equal(attached, '4821 Oak Ridge Lane, Austin, TX 78704');
});

test('applySosEntityCapture: a not-person-shaped officer name is skipped, not minted', async () => {
  const capture = { name: 'Delta Corp', officers: 'XYZ Holdings LLC' };
  const result = await applySosEntityCapture(capture, {}, {
    resolvePrimaryWorkspaceId: async () => 'ws1',
    ensureEntityLink: stubEntityLink(),
    insertEntityRelationship: async () => { throw new Error('must not be called for a non-person name'); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.edges[0].skipped, 'not_person_shaped');
});
