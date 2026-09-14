// PR-scanner-3 — gov-property-record-coverage.js
//
// Behavioural tests against injected `domainQuery`/`opsQuery` deps (never a
// real network call — this repo's hermetic-suite guard forbids that). Covers
// the four cases the spec asked for directly, plus the model-leg exclusion
// and the multi-signal (parcel/tax/deed) OR.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkGovPropertyTrustworthyRecords,
  syncGovPropertyRecordCoverage,
} from '../api/_shared/gov-property-record-coverage.js';

function fakeDomainQuery(routes) {
  return async (domain, method, path) => {
    assert.equal(domain, 'government');
    assert.equal(method, 'GET');
    for (const [prefix, data] of routes) {
      if (path.startsWith(prefix)) return { ok: true, status: 200, data };
    }
    return { ok: true, status: 200, data: [] };
  };
}

test('a property with a costar_sidebar parcel capture is trustworthy', async () => {
  const domainQuery = fakeDomainQuery([
    ['parcel_records?property_id=in.(1)&raw_payload->>source=eq.costar_sidebar', [{ property_id: 1, parcel_id: 'p1' }]],
    ['parcel_records?property_id=in.(1)&select', [{ property_id: 1, parcel_id: 'p1' }]],
    ['tax_records', []],
    ['deed_records', []],
  ]);
  const r = await checkGovPropertyTrustworthyRecords([1], { domainQuery });
  assert.equal(r.ok, true);
  assert.equal(r.byId[1].hasTrustworthyRecord, true);
  assert.equal(r.byId[1].parcelTrust, true);
});

test('a property whose only deed row is the ai_recall_gpt model leg is NOT trustworthy', async () => {
  const domainQuery = fakeDomainQuery([
    ['parcel_records', []],
    ['tax_records', []],
    ['deed_records?property_id=in.(2)', [{ property_id: 2, raw_payload: { source: 'ai_recall_gpt' } }]],
  ]);
  const r = await checkGovPropertyTrustworthyRecords([2], { domainQuery });
  assert.equal(r.ok, true);
  assert.equal(r.byId[2].hasTrustworthyRecord, false, 'the model leg must never count as a real record');
  assert.equal(r.byId[2].deedTrust, false);
});

test('a property with a real (non-model-leg) deed row IS trustworthy — deed_parser or unstamped legacy', async () => {
  const domainQuery = fakeDomainQuery([
    ['parcel_records', []],
    ['tax_records', []],
    ['deed_records?property_id=in.(3)', [{ property_id: 3, raw_payload: { source: 'deed_parser' } }]],
  ]);
  const r1 = await checkGovPropertyTrustworthyRecords([3], { domainQuery });
  assert.equal(r1.byId[3].hasTrustworthyRecord, true);

  const domainQuery2 = fakeDomainQuery([
    ['parcel_records', []],
    ['tax_records', []],
    ['deed_records?property_id=in.(4)', [{ property_id: 4, raw_payload: {} }]], // no source key at all (legacy)
  ]);
  const r2 = await checkGovPropertyTrustworthyRecords([4], { domainQuery: domainQuery2 });
  assert.equal(r2.byId[4].hasTrustworthyRecord, true, 'an unstamped legacy deed row still counts (it is not the model leg)');
});

test('a property with NO parcel/tax/deed rows at all is NOT trustworthy', async () => {
  const domainQuery = fakeDomainQuery([]);
  const r = await checkGovPropertyTrustworthyRecords([5], { domainQuery });
  assert.equal(r.byId[5].hasTrustworthyRecord, false);
  assert.equal(r.byId[5].parcelTrust, false);
  assert.equal(r.byId[5].taxTrust, false);
  assert.equal(r.byId[5].deedTrust, false);
});

test('a costar_sidebar tax_records row (reached via the property\'s parcel_id) counts, even without a trusted parcel row', async () => {
  const domainQuery = fakeDomainQuery([
    // The trusted-parcel-source query returns nothing...
    ['parcel_records?property_id=in.(6)&raw_payload->>source=eq.costar_sidebar', []],
    // ...but the property does have SOME parcel (untrusted at parcel level)...
    ['parcel_records?property_id=in.(6)&select', [{ property_id: 6, parcel_id: 'p6' }]],
    // ...and that parcel's tax record IS costar_sidebar-tagged.
    ['tax_records?parcel_id=in.(p6)&raw_payload->>source=eq.costar_sidebar', [{ parcel_id: 'p6' }]],
    ['deed_records', []],
  ]);
  const r = await checkGovPropertyTrustworthyRecords([6], { domainQuery });
  assert.equal(r.byId[6].taxTrust, true);
  assert.equal(r.byId[6].parcelTrust, false);
  assert.equal(r.byId[6].hasTrustworthyRecord, true);
});

test('syncGovPropertyRecordCoverage upserts every checked property, including the false ones', async () => {
  const domainQuery = fakeDomainQuery([
    ['parcel_records?property_id=in.(7,8)&raw_payload->>source=eq.costar_sidebar', [{ property_id: 7, parcel_id: 'p7' }]],
    ['parcel_records?property_id=in.(7,8)&select', [{ property_id: 7, parcel_id: 'p7' }]],
    ['tax_records', []],
    ['deed_records', []],
  ]);
  const upserted = [];
  const opsQuery = async (method, path, body) => {
    assert.equal(method, 'POST');
    assert.match(path, /^lcc_gov_property_record_coverage\?on_conflict=property_id$/);
    upserted.push(...body);
    return { ok: true, status: 200, data: [] };
  };
  const r = await syncGovPropertyRecordCoverage([7, 8], { domainQuery, opsQuery });
  assert.equal(r.ok, true);
  assert.equal(r.synced, 2);
  const byId = Object.fromEntries(upserted.map((row) => [row.property_id, row]));
  assert.equal(byId[7].has_trustworthy_record, true);
  assert.equal(byId[8].has_trustworthy_record, false, 'a property with nothing on file still gets an explicit false row');
});

test('a failed gov read is surfaced, never silently swallowed into a false negative', async () => {
  const domainQuery = async () => ({ ok: false, status: 500, data: { message: 'boom' } });
  const r = await checkGovPropertyTrustworthyRecords([9], { domainQuery });
  assert.equal(r.ok, false);
  assert.match(r.error, /parcel_records read failed/);
});
