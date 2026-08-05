import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseRequest, runComps } from '../mcp/comps-tools.js';

// Prompt 49 — subject resolution must be phrasing-INDEPENDENT: an address that
// resolves to a property must resolve the subject the same way through
// parseRequest -> runComps regardless of wording, keep the pull national (not a
// single-metro collapse), and hydrate the nested subject.fields (incl. cap).

const SUBJECT_ID = 31964;

const SUBJECT_PROPERTY = {
  property_id: SUBJECT_ID,
  address: '1050 Old Camp Rd',
  city: 'The Villages',
  state: 'FL',
  tenant: 'DaVita',
  operator: 'DaVita',
  chain_canonical: 'DaVita',
  building_size: 6453,
  total_chairs: 12,
  year_built: 2022,
  lease_commencement: '2023-08-05',
  wavg_lease_expiration: '2038-08-05',
  lease_bump_pct: 0.10,
  lease_bump_interval_mo: 60,
};

// A national similarity set: the subject's OWN active listing + sold comps in
// several states (TX, GA, OH). If scope is (wrongly) narrowed to the subject
// metro, the out-of-FL rows would never be pulled.
function compRows() {
  return [
    { comp_id: `dia-${SUBJECT_ID}`, source: 'dialysis_db', vertical: 'dialysis',
      property_id: SUBJECT_ID, tenant: 'DaVita', address: '1050 Old Camp Rd',
      city: 'The Villages', state: 'FL', on_market: true, comp_type: 'lease',
      cap_rate: 0.0675, building_sf: 6453, confidence: 0.9 },
    { comp_id: 'dia-tx', source: 'dialysis_db', vertical: 'dialysis', tenant: 'DaVita',
      address: '10 Sold Rd', city: 'Dallas', state: 'TX', building_sf: 8000,
      sale_price: 5000000, cap_rate: 0.070, annual_rent: 350000, sale_date: '2025-06-01',
      comp_type: 'sale', confidence: 0.9 },
    { comp_id: 'dia-ga', source: 'dialysis_db', vertical: 'dialysis', tenant: 'DaVita',
      address: '20 Sold Rd', city: 'Macon', state: 'GA', building_sf: 7000,
      sale_price: 4200000, cap_rate: 0.0708, annual_rent: 297360, sale_date: '2025-05-01',
      comp_type: 'sale', confidence: 0.9 },
    { comp_id: 'dia-oh', source: 'dialysis_db', vertical: 'dialysis', tenant: 'DaVita',
      address: '30 Sold Rd', city: 'Columbus', state: 'OH', building_sf: 9000,
      sale_price: 6000000, cap_rate: 0.069, annual_rent: 414000, sale_date: '2025-04-01',
      comp_type: 'sale', confidence: 0.9 },
  ];
}

function makeDeps(capture) {
  const dia = async (method, path, body) => {
    if (method === 'POST' && path === 'rpc/rpc_query_comps') {
      capture.params.push(body);
      return { ok: true, status: 200, data: compRows() };
    }
    if (method === 'GET' && /^properties\?address=ilike/.test(path)) {
      // The subject address resolves to exactly one dia property.
      return { ok: true, status: 200, data: [SUBJECT_PROPERTY] };
    }
    if (method === 'GET' && /^available_listings\?property_id=eq/.test(path)) {
      return { ok: true, status: 200, data: [{ cap_rate: 0.0675, status: 'active' }] };
    }
    if (method === 'GET' && /^leases\?property_id=eq/.test(path)) {
      return { ok: true, status: 200, data: [{ lease_expiration: '2038-08-05' }] };
    }
    return { ok: true, status: 200, data: [] };
  };
  const gov = async (method, path, body) => {
    if (method === 'POST' && path === 'rpc/rpc_query_comps') return { ok: true, status: 200, data: [] };
    // gov has no property at this address -> unambiguous single (dia) match.
    return { ok: true, status: 200, data: [] };
  };
  return { diaQuery: dia, govQuery: gov };
}

const PHRASINGS = [
  'The Villages DaVita, 1050 Old Camp Rd, The Villages, FL — 25 best',
  'Appraisal comps for The Villages DaVita, 1050 Old Camp Rd, The Villages, FL',
];

describe('prompt 49 — phrasing-independent subject resolution', () => {
  for (const request of PHRASINGS) {
    it(`resolves the subject to property + national scope + hydrated fields: "${request.slice(0, 40)}…"`, async () => {
      const parsed = parseRequest(request);
      // The street address is extracted at parse time, independent of wording.
      assert.equal(parsed.subject?.address, '1050 Old Camp Rd');
      assert.equal(parsed.appraisal_mode, true, 'a subject address is a subject-anchored appraisal pull');

      const capture = { params: [] };
      const res = await runComps({ request, limit: 25 }, makeDeps(capture));

      // National candidate pull — states/metros NOT narrowed to the subject metro.
      const primary = capture.params[0];
      assert.equal(primary.p_states, null, 'national scope: p_states null');
      assert.equal(primary.p_metros, null, 'national scope: p_metros null');

      // Subject hydrated from the resolved record.
      const s = res.meta && res.meta.interpreted_params;
      assert.equal(s.p_candidate_scope, 'national_subject_anchored');

      // Subject excluded (its own on-market listing must not ship as a comp).
      assert.ok(res.meta.excluded_subject >= 1, 'subject row excluded');
      assert.ok(!res.comps.some(c => Number(c.property_id) === SUBJECT_ID),
        'subject property_id absent from returned comps');

      // Out-of-metro comps survived (national set, not a single-FL-metro collapse).
      const states = new Set(res.comps.map(c => c.state));
      assert.ok(states.has('TX') || states.has('GA') || states.has('OH'),
        'national similarity set retains out-of-FL comps');
    });
  }

  it('hydrates subject.fields.cap_rate to the record cap (not the 6.00% gazetteer default)', async () => {
    const request = PHRASINGS[0];
    const args = { request, limit: 25 };
    // Reproduce runComps preamble to inspect the hydrated subject directly.
    const parsed = parseRequest(request);
    // gazetteer default seeds fields.cap_rate = 0.06 for The Villages
    assert.equal(parsed.subject.fields.cap_rate, 0.06);
    assert.equal(parsed.subject._cap_default, true);

    const { hydrateSubjectFromRecord } = await import('../mcp/comps-tools.js');
    const subject = { ...parsed.subject };
    const hydrated = await hydrateSubjectFromRecord(
      { request, subject, appraisal_mode: true }, makeDeps({ params: [] }));

    assert.equal(hydrated.resolved_from_record, true);
    assert.equal(hydrated.property_id, SUBJECT_ID);
    assert.equal(hydrated.cap_rate, 0.0675);
    assert.equal(hydrated._cap_default, false, '_cap_default false once a real cap hydrates');
    assert.equal(hydrated.fields.cap_rate, 0.0675, 'nested fields.cap_rate carries the hydrated cap');
    assert.equal(Number(hydrated.building_sf), 6453);
    assert.equal(Number(hydrated.fields.building_sf), 6453);
    assert.equal(Number(hydrated.chairs), 12);
    assert.equal(Number(hydrated.fields.chairs), 12);
  });

  it('a request with NO resolvable address still resolves to a place (no regression)', () => {
    const parsed = parseRequest('dialysis comps in Florida');
    assert.equal(parsed.subject?.address, undefined, 'no street address extracted');
    assert.notEqual(parsed.appraisal_mode, true, 'not forced into subject-anchored appraisal mode');
    assert.deepEqual(parsed.states, ['FL']);
  });

  it('never overrides an explicitly user-typed cap on hydration', async () => {
    const { hydrateSubjectFromRecord } = await import('../mcp/comps-tools.js');
    const request = 'Appraisal comps for The Villages DaVita, 1050 Old Camp Rd, The Villages, FL, cap is 7%';
    const parsed = parseRequest(request);
    assert.equal(parsed.subject._cap_user, true);
    assert.equal(parsed.subject.cap_rate, 0.07);
    const subject = { ...parsed.subject };
    const hydrated = await hydrateSubjectFromRecord(
      { request, subject, appraisal_mode: true }, makeDeps({ params: [] }));
    assert.equal(hydrated.cap_rate, 0.07, 'user cap preserved');
    assert.equal(hydrated.fields.cap_rate, 0.07, 'nested field keeps user cap');
  });
});
