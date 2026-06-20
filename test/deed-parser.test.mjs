// R58 Unit 2 — deed parser wired off the orphaned shelf. parseDeedText regex +
// the schema-correct, deps-injected processDeedDocument (extracted_data not
// metadata; per-domain dedup PK; R51 latest_deed_grantee feed; gated price fill).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'k';
process.env.DIA_SUPABASE_URL = 'https://dia.test.local';
process.env.DIA_SUPABASE_KEY = 'k';
process.env.GOV_SUPABASE_URL = 'https://gov.test.local';
process.env.GOV_SUPABASE_KEY = 'k';

const { parseDeedText, processDeedDocument } = await import('../api/_handlers/deed-parser.js');

const DEED_TEXT = [
  'GRANT DEED',
  'County of Los Angeles',
  'DOCUMENTARY TRANSFER TAX is $1,100.00 computed on the full value of the property.',
  'DOC # 2024-0042560  recorded on 03/15/2024',
  'For valuable consideration acknowledged, SELLER TRUST hereby GRANTS to BUYER HOLDINGS LLC, the following described property:',
  'APN: 123-456-789',
].join('\n');

// A fake domainQuery: a router that records every call and returns canned rows.
function makeFakeQ(canned = {}) {
  const calls = [];
  const q = async (domain, method, path, body) => {
    calls.push({ domain, method, path, body });
    for (const [match, resp] of Object.entries(canned)) {
      if (path.includes(match) && (!resp.method || resp.method === method)) {
        return resp.value;
      }
    }
    return { ok: true, data: [] };
  };
  return { q, calls };
}

describe('parseDeedText (R58 Unit 2)', () => {
  it('extracts grantor/grantee/implied price/date/apn/type (CA)', () => {
    const p = parseDeedText(DEED_TEXT, { state: 'CA' });
    assert.equal(p.grantee, 'BUYER HOLDINGS LLC');
    assert.equal(p.grantor, 'SELLER TRUST');
    assert.equal(p.deed_type, 'Grant Deed');
    assert.equal(p.transfer_tax, 1100);
    assert.equal(p.implied_sale_price, 1000000);     // 1100 / 1.10 * 1000
    assert.equal(p.recording_date, '03/15/2024');
    assert.equal(p.apn, '123-456-789');
  });

  it('non-CA state → no implied price (transfer-tax rate only modeled for CA)', () => {
    const p = parseDeedText(DEED_TEXT, { state: 'TX' });
    assert.equal(p.transfer_tax, 1100);
    assert.equal(p.implied_sale_price, undefined);
  });
});

describe('processDeedDocument — schema-correct DB integration', () => {
  it('writes property_documents.extracted_data (NOT metadata) keyed by document_id', async () => {
    const { q, calls } = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'deed_records': { method: 'POST', value: { ok: true, data: [{ id: 'd1' }] } },
      'properties?property_id=eq.55&select=latest_deed_grantee': { value: { ok: true, data: [{ latest_deed_grantee: null, latest_deed_date: null }] } },
      'properties?property_id=eq.55&select=recorded_owner_name': { value: { ok: true, data: [{ recorded_owner_name: null }] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [] } },
    });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: q });
    const pdPatch = calls.find(c => c.method === 'PATCH' && c.path.startsWith('property_documents?document_id=eq.900'));
    assert.ok(pdPatch, 'PATCHes property_documents by document_id');
    assert.ok(pdPatch.body.extracted_data?.deed_extraction, 'writes extracted_data.deed_extraction');
    assert.equal('metadata' in pdPatch.body, false, 'never writes the nonexistent metadata column');
    assert.equal(pdPatch.body.ingestion_status, 'deed_parsed');
  });

  it('parses county and dedups deed_records on the per-domain PK (dia=id, gov=deed_id)', async () => {
    assert.equal(parseDeedText(DEED_TEXT, { state: 'CA' }).county, 'Los Angeles');
    for (const [domain, pk] of [['dialysis', 'id'], ['government', 'deed_id']]) {
      const f = makeFakeQ({ 'deed_records?data_hash': { value: { ok: true, data: [] } }, 'deed_records': { method: 'POST', value: { ok: true, data: [{ [pk]: 'x' }] } } });
      await processDeedDocument(domain, 7, 1, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q });
      const dedup = f.calls.find(c => c.method === 'GET' && c.path.startsWith('deed_records?data_hash'));
      assert.ok(dedup, `${domain} attempts deed dedup (county+state present)`);
      assert.ok(dedup.path.includes(`select=${pk}`), `${domain} dedup selects ${pk}`);
    }
  });

  it('FEEDS R51 — fills blank properties.latest_deed_grantee with the grantee', async () => {
    const f = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'deed_records': { method: 'POST', value: { ok: true, data: [{ id: 'd1' }] } },
      'properties?property_id=eq.55&select=latest_deed_grantee': { value: { ok: true, data: [{ latest_deed_grantee: null, latest_deed_date: null }] } },
      'properties?property_id=eq.55&select=recorded_owner_name': { value: { ok: true, data: [{ recorded_owner_name: null }] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [] } },
    });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q });
    const feed = f.calls.find(c => c.method === 'PATCH' && c.path.startsWith('properties?property_id=eq.55'));
    assert.ok(feed, 'PATCHes properties to feed R51');
    assert.equal(feed.body.latest_deed_grantee, 'BUYER HOLDINGS LLC');
    assert.equal(feed.body.latest_deed_date, '2024-03-15');
    assert.equal(r.r51Fed, true);
  });

  it('R51 feed never clobbers a NEWER recorded grantee', async () => {
    const f = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'deed_records': { method: 'POST', value: { ok: true, data: [{ id: 'd1' }] } },
      'properties?property_id=eq.55&select=latest_deed_grantee': { value: { ok: true, data: [{ latest_deed_grantee: 'NEWER OWNER LLC', latest_deed_date: '2025-01-01' }] } },
      'properties?property_id=eq.55&select=recorded_owner_name': { value: { ok: true, data: [{ recorded_owner_name: null }] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [] } },
    });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q });
    const feed = f.calls.find(c => c.method === 'PATCH' && c.path.startsWith('properties?property_id=eq.55'));
    assert.equal(feed, undefined, 'no R51 PATCH when existing grantee is newer');
    assert.equal(r.r51Fed, false);
  });

  it('verifies a price-matching sale; gated implied-price fill stays OFF by default', async () => {
    delete process.env.DEED_IMPLIED_PRICE_FILL;
    const f = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'deed_records': { method: 'POST', value: { ok: true, data: [{ id: 'd1' }] } },
      'properties?property_id=eq.55&select=latest_deed_grantee': { value: { ok: true, data: [{ latest_deed_grantee: null, latest_deed_date: null }] } },
      'properties?property_id=eq.55&select=recorded_owner_name': { value: { ok: true, data: [{ recorded_owner_name: null }] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [{ sale_id: 'S1', sold_price: 1000000, sale_date: '2024-03-10' }] } },
    });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q });
    assert.equal(r.upgradedTransactions, 1, 'price-matched sale recorded as verified');
    assert.equal(r.impliedPriceFilled, false, 'no price fill when gate is off');
    assert.equal(f.calls.some(c => c.method === 'PATCH' && c.path.includes('sold_price=is.null')), false);
  });

  it('gated implied-price fill writes ONLY a NULL price when DEED_IMPLIED_PRICE_FILL=on', async () => {
    process.env.DEED_IMPLIED_PRICE_FILL = 'on';
    const f = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'deed_records': { method: 'POST', value: { ok: true, data: [{ id: 'd1' }] } },
      'properties?property_id=eq.55&select=latest_deed_grantee': { value: { ok: true, data: [{ latest_deed_grantee: null, latest_deed_date: null }] } },
      'properties?property_id=eq.55&select=recorded_owner_name': { value: { ok: true, data: [{ recorded_owner_name: null }] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [{ sale_id: 'S1', sold_price: null, sale_date: '2024-03-10' }] } },
    });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q });
    const fill = f.calls.find(c => c.method === 'PATCH' && c.path.includes('sold_price=is.null'));
    assert.ok(fill, 'PATCHes the blank-price sale, guarded on sold_price=is.null');
    assert.equal(fill.body.sold_price, 1000000);
    assert.equal(r.impliedPriceFilled, true);
    delete process.env.DEED_IMPLIED_PRICE_FILL;
  });

  it('nothing meaningful parsed → no DB writes', async () => {
    const f = makeFakeQ({});
    const r = await processDeedDocument('dialysis', 55, 900, 'just some random text', {}, { domainQuery: f.q });
    assert.equal(f.calls.length, 0);
    assert.equal(r.deedRecordId, null);
  });
});
