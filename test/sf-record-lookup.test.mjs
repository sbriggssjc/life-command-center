// T4c — ID-based SF record lookup: pure helpers (buildOdataIdFilter / chunk /
// normalizeCompRecords / lookupSfRecordsByIds with a fake fetch) +
// planMissingCompFetch (still-held narrowing, dedup, not-held accounting).
// No IO except the injected fake fetch.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOdataIdFilter, chunk, normalizeCompRecords, lookupSfRecordsByIds,
} from '../api/_shared/sf-record-lookup.js';
import { planMissingCompFetch } from '../api/_handlers/sf-record-lookup.js';

describe('buildOdataIdFilter', () => {
  it('builds an Id eq ... or Id eq ... chain (never IN)', () => {
    const f = buildOdataIdFilter(['a1Y0001', 'a1Y0002']);
    assert.equal(f, "Id eq 'a1Y0001' or Id eq 'a1Y0002'");
    assert.ok(!/\bIN\b/.test(f));
  });
  it('strips non-alphanumerics defensively + drops empties', () => {
    assert.equal(buildOdataIdFilter(["a1Y'001", '', null, '  a1Y-002 ']), "Id eq 'a1Y001' or Id eq 'a1Y002'");
  });
  it('returns "" for an empty/garbage batch', () => {
    assert.equal(buildOdataIdFilter([]), '');
    assert.equal(buildOdataIdFilter(['', '!!', null]), '');
  });
  it('honors a custom field name', () => {
    assert.equal(buildOdataIdFilter(['x'], 'CompId__c'), "CompId__c eq 'x'");
  });
});

describe('chunk', () => {
  it('splits into <=n batches', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 100), []);
  });
});

describe('normalizeCompRecords', () => {
  it('maps Id/On_Market_Date__c/CreatedDate to the upsert shape, date-trimmed', () => {
    const rows = normalizeCompRecords([
      { Id: 'a1Y1', On_Market_Date__c: '2026-01-22', CreatedDate: '2025-12-01T08:00:00.000+0000' },
      { id: 'a1Y2', on_market_date: null, created_date: '2024-06-30' },
    ]);
    assert.deepEqual(rows[0], { sf_comp_id: 'a1Y1', on_market_date: '2026-01-22', created_date: '2025-12-01' });
    assert.deepEqual(rows[1], { sf_comp_id: 'a1Y2', on_market_date: null, created_date: '2024-06-30' });
  });
  it('drops records with no Id, never fabricates a date', () => {
    const rows = normalizeCompRecords([{ On_Market_Date__c: '2026-01-01' }, { Id: 'a1Y3' }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sf_comp_id, 'a1Y3');
    assert.equal(rows[0].on_market_date, null);
  });
});

describe('planMissingCompFetch', () => {
  const viewRows = [
    { match_domain: 'dialysis', listing_id: 'L1', sf_comp_id: 'a1Y1' },   // held
    { match_domain: 'dialysis', listing_id: 'L2', sf_comp_id: 'a1Y2' },   // NOT held
    { match_domain: 'dialysis', listing_id: 'L1', sf_comp_id: 'a1Y1' },   // dup comp/listing
    { match_domain: 'government', listing_id: 'G1', sf_comp_id: 'a1Y3' }, // held
    { match_domain: 'government', listing_id: 'G2', sf_comp_id: 'a1Y3' }, // same comp, other listing held → counts once
  ];
  const heldByDomain = {
    dialysis: new Set(['L1']),
    government: new Set(['G1', 'G2']),
  };

  it('fetches only still-held missing comps, deduped across listings/domains', () => {
    const plan = planMissingCompFetch({ viewRows, heldByDomain, domains: ['dialysis', 'government'] });
    assert.deepEqual(plan.missingIds.sort(), ['a1Y1', 'a1Y3']);   // a1Y2 (not held) excluded
    assert.equal(plan.byDomain.dialysis.missing_comps_held, 1);
    assert.equal(plan.byDomain.dialysis.missing_comps_not_held, 1);
    assert.equal(plan.byDomain.government.missing_comps_held, 1);
    assert.equal(plan.byDomain.government.held_missing_listings, 2);
  });

  it('honors domain scope', () => {
    const plan = planMissingCompFetch({ viewRows, heldByDomain, domains: ['government'] });
    assert.deepEqual(plan.missingIds, ['a1Y3']);
    assert.equal(plan.byDomain.dialysis, undefined);
  });

  it('empty held set → nothing fetched, not-held counted', () => {
    const plan = planMissingCompFetch({ viewRows, heldByDomain: { dialysis: new Set(), government: new Set() }, domains: ['dialysis', 'government'] });
    assert.equal(plan.missingIds.length, 0);
    assert.equal(plan.byDomain.dialysis.missing_comps_not_held, 2);
  });
});

describe('lookupSfRecordsByIds (injected fetch)', () => {
  function fakeFetch(records, capture, headerCapture) {
    return async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (capture) capture.push(body);
      if (headerCapture) headerCapture.push(opts.headers || {});
      return { ok: true, text: async () => JSON.stringify({ ok: true, records }) };
    };
  }

  it('batches by size and aggregates records', async () => {
    const captured = [];
    const out = await lookupSfRecordsByIds({
      objectType: 'Comp__c', fields: 'Id,On_Market_Date__c', ids: ['a1', 'a2', 'a3'],
      batchSize: 2, fetchImpl: fakeFetch([{ Id: 'a1', On_Market_Date__c: '2026-01-01' }], captured),
    });
    assert.equal(out.ok, true);
    assert.equal(out.batches_total, 2);
    assert.equal(out.batches_run, 2);
    // each batch posts an OData eq/or filter for its ids, never IN
    assert.equal(captured[0].object_type, 'Comp__c');
    assert.equal(captured[0].filter, "Id eq 'a1' or Id eq 'a2'");
    assert.equal(captured[1].filter, "Id eq 'a3'");
    assert.ok(captured.every((b) => !/\bIN\b/.test(b.filter)));
  });

  it('sends ONLY Content-Type — no auth header (Azure SAS refuses extra schemes)', async () => {
    const headers = [];
    await lookupSfRecordsByIds({
      objectType: 'Comp__c', fields: 'Id', ids: ['a1'],
      fetchImpl: fakeFetch([], [], headers),
    });
    assert.deepEqual(Object.keys(headers[0]), ['Content-Type']);
    assert.equal(headers[0].Authorization, undefined);
    assert.equal(headers[0]['X-Shared-Secret'], undefined);
  });

  it('reports a per-batch failure without throwing', async () => {
    const failFetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    const out = await lookupSfRecordsByIds({ objectType: 'Comp__c', fields: 'Id', ids: ['a1'], fetchImpl: failFetch });
    assert.equal(out.ok, false);
    assert.equal(out.batches_failed, 1);
    assert.equal(out.errors[0].reason, 'flow_http_error');
  });
});
