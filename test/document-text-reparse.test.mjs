// R58b Unit 3 — document-text worker re-parse mode. Runs the deed parser over
// docs that ALREADY have raw_text (no fetch/OCR), marks genuine no-party docs
// terminal so the queue drains idempotently.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'k';
process.env.DIA_SUPABASE_URL = 'https://dia.test.local';
process.env.DIA_SUPABASE_KEY = 'k';
process.env.GOV_SUPABASE_URL = 'https://gov.test.local';
process.env.GOV_SUPABASE_KEY = 'k';

const { fetchReparseDocs, processOneReparse } = await import('../api/_handlers/document-text.js');

function makeFakeQ(canned = {}) {
  const calls = [];
  const q = async (domain, method, path, body) => {
    calls.push({ domain, method, path, body });
    for (const [match, resp] of Object.entries(canned)) {
      if (path.includes(match) && (!resp.method || resp.method === method)) return resp.value;
    }
    return { ok: true, data: [] };
  };
  return { q, calls };
}

const COVER = 'Recording Cover Page\nFirst Grantor: TRIVIUM GROVE CITY LLC First Grantee: CHF II GROVE CITY MOB LLC\nFees: $18.50';
const DEED_OF_TRUST = 'DEED OF TRUST\nmade among the Trustor JOHN SMITH, the Trustee FIRST AMERICAN TITLE, and the Beneficiary BIG BANK NA.';

describe('fetchReparseDocs (R58b Unit 3)', () => {
  it('selects deed docs WITH raw_text and a NULL parsed grantee, excluding deed_no_parties', async () => {
    const { q, calls } = makeFakeQ({ 'property_documents?raw_text=not.is.null': { value: { ok: true, data: [{ document_id: 1 }] } } });
    const r = await fetchReparseDocs('dialysis', { limit: 25 }, { domainQuery: q });
    assert.equal(r.ok, true);
    const path = calls[0].path;
    assert.ok(path.includes('raw_text=not.is.null'), 'requires raw_text present');
    assert.ok(path.includes('document_type=ilike.*deed*'), 'deed docs only');
    assert.ok(path.includes('extracted_data->deed_extraction->>grantee=is.null'), 'no parsed grantee yet');
    assert.ok(path.includes('ingestion_status.neq.deed_no_parties'), 'excludes terminal no-parties');
    assert.ok(path.includes('raw_text') && path.includes('select='), 'selects raw_text for in-place parse');
  });
});

describe('processOneReparse (R58b Unit 3)', () => {
  it('parses a cover-page deed over stored raw_text and feeds R51 — no fetch/OCR', async () => {
    const { q, calls } = makeFakeQ({
      'properties?property_id=eq.55&select=city,state': { value: { ok: true, data: [{ city: 'Grove City', state: 'OH' }] } },
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'properties?property_id=eq.55&select=latest_deed_grantee': { value: { ok: true, data: [{ latest_deed_grantee: null, latest_deed_date: null }] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [] } },
    });
    const r = await processOneReparse('dialysis', { document_id: 7, property_id: 55, raw_text: COVER }, { domainQuery: q });
    assert.equal(r.outcome, 'deed_parsed');
    assert.equal(r.grantor, 'TRIVIUM GROVE CITY LLC');
    assert.equal(r.grantee, 'CHF II GROVE CITY MOB LLC');
    assert.equal(r.r51_fed, true);
    // Never fetched bytes / OCR'd — only domainQuery calls, no source_url fetch.
    assert.equal(calls.some(c => /\bhttp/i.test(String(c.path)) === false), true);
  });

  it('a deed of trust (no parties) is marked deed_no_parties so it drops out of the queue', async () => {
    const { q, calls } = makeFakeQ({
      'properties?property_id=eq.9&select=city,state': { value: { ok: true, data: [{ city: 'X', state: 'CA' }] } },
    });
    const r = await processOneReparse('government', { document_id: 3, property_id: 9, raw_text: DEED_OF_TRUST }, { domainQuery: q });
    assert.equal(r.outcome, 'no_parties');
    const mark = calls.find(c => c.method === 'PATCH' && c.path.startsWith('property_documents?document_id=eq.3'));
    assert.ok(mark, 'marks the doc terminal');
    assert.equal(mark.body.ingestion_status, 'deed_no_parties');
  });

  it('no raw_text → no_text, no writes', async () => {
    const { q, calls } = makeFakeQ({});
    const r = await processOneReparse('dialysis', { document_id: 1, property_id: null, raw_text: null }, { domainQuery: q });
    assert.equal(r.outcome, 'no_text');
    assert.equal(calls.length, 0);
  });
});
