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

const { fetchEligibleDocs, fetchReparseDocs, processOneReparse, fetchPropagateBackfillDocs, processOnePropagateBackfill, R59_BACKFILL_MARKER, DEED_NO_PARTIES_TERMINAL } = await import('../api/_handlers/document-text.js');

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

describe('fetchReparseDocs (R58b Unit 3 / R58c terminal bump)', () => {
  it('selects deed docs WITH raw_text and a NULL parsed grantee; re-includes the legacy deed_no_parties backlog, excludes only the R58c terminal', async () => {
    const { q, calls } = makeFakeQ({ 'property_documents?raw_text=not.is.null': { value: { ok: true, data: [{ document_id: 1 }] } } });
    const r = await fetchReparseDocs('dialysis', { limit: 25 }, { domainQuery: q });
    assert.equal(r.ok, true);
    const path = calls[0].path;
    assert.ok(path.includes('raw_text=not.is.null'), 'requires raw_text present');
    assert.ok(path.includes('document_type=ilike.*deed*'), 'deed docs only');
    assert.ok(path.includes('extracted_data->deed_extraction->>grantee=is.null'), 'no parsed grantee yet');
    // R58c — only the CURRENT terminal marker is excluded; the legacy bare
    // 'deed_no_parties' backlog (e.g. doc 3964) is re-included for one pass.
    assert.ok(path.includes('ingestion_status.neq.deed_no_parties_r58c'), 'excludes the R58c terminal no-parties');
    assert.ok(!path.includes('ingestion_status.neq.deed_no_parties)'), 'does NOT exclude the legacy bare deed_no_parties');
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
    assert.equal(mark.body.ingestion_status, 'deed_no_parties_r58c');
  });

  it('no raw_text → no_text, no writes', async () => {
    const { q, calls } = makeFakeQ({});
    const r = await processOneReparse('dialysis', { document_id: 1, property_id: null, raw_text: null }, { domainQuery: q });
    assert.equal(r.outcome, 'no_text');
    assert.equal(calls.length, 0);
  });
});

// ── R59b Unit 2 — retroactive propagation backfill (worker) ─────────────────
describe('fetchPropagateBackfillDocs (R59b Unit 2)', () => {
  it('selects deed_parsed deeds with a stored grantee, not yet backfill-marked', async () => {
    const { q, calls } = makeFakeQ({ 'property_documents?ingestion_status=eq.deed_parsed': { value: { ok: true, data: [{ document_id: 1 }] } } });
    const r = await fetchPropagateBackfillDocs('dialysis', { limit: 25 }, { domainQuery: q });
    assert.equal(r.ok, true);
    const path = calls[0].path;
    assert.ok(path.includes('ingestion_status=eq.deed_parsed'), 'already-parsed deeds');
    assert.ok(path.includes('document_type=ilike.*deed*'), 'deed docs only');
    assert.ok(path.includes('extracted_data->deed_extraction->>grantee=not.is.null'), 'has a stored grantee');
    assert.ok(path.includes(`extracted_data->>${R59_BACKFILL_MARKER}=is.null`), 'not yet backfill-marked (idempotent / drains)');
    assert.ok(path.includes('extracted_data') && path.includes('select='), 'selects extracted_data for the stored parse');
  });
});

describe('processOnePropagateBackfill (R59b Unit 2)', () => {
  const STORED = {
    extracted_data: { deed_extraction: { grantee: 'Deltona Wellness, LP', grantor: 'Oldsmar Retail Development LLC', recording_date: '01/21/2020', implied_sale_price: 13333400 } },
  };

  it('runs R59 propagation over the STORED extraction (no re-parse) + stamps the idempotency marker', async () => {
    const events = [];
    const propagateStoredDeedExtraction = async (args) => { events.push(args); return { saleBuyerFilled: true, saleSellerFilled: true, ownershipEventAppended: true }; };
    const { q, calls } = makeFakeQ({});
    const row = { document_id: 3964, property_id: 24703, ...STORED };
    const r = await processOnePropagateBackfill('dialysis', row, { domainQuery: q, propagateStoredDeedExtraction });
    assert.equal(r.outcome, 'propagated');
    assert.equal(r.sale_parties_filled, true);
    assert.equal(r.ownership_event, true);
    // Read the stored parse, never re-parsed.
    assert.equal(events[0].parsed.grantee, 'Deltona Wellness, LP');
    assert.equal(events[0].propertyId, 24703);
    // Stamps the idempotency marker (merged into existing extracted_data) so the row drops out.
    const mark = calls.find(c => c.method === 'PATCH' && c.path.startsWith('property_documents?document_id=eq.3964'));
    assert.ok(mark, 'PATCHes the backfill marker');
    assert.ok(mark.body.extracted_data[R59_BACKFILL_MARKER], 'sets the marker');
    assert.equal(mark.body.extracted_data.deed_extraction.grantee, 'Deltona Wellness, LP', 'preserves existing extracted_data');
  });

  it('a row without a stored grantee → skipped, no propagation, no marker', async () => {
    const events = [];
    const propagateStoredDeedExtraction = async (args) => { events.push(args); return {}; };
    const { q, calls } = makeFakeQ({});
    const r = await processOnePropagateBackfill('dialysis', { document_id: 5, property_id: 9, extracted_data: { deed_extraction: { grantor: 'X' } } }, { domainQuery: q, propagateStoredDeedExtraction });
    assert.equal(r.outcome, 'skipped');
    assert.equal(events.length, 0);
    assert.equal(calls.length, 0);
  });
});

// Deed OCR drain eligibility — claim STORAGE-READY docs, not expired-CDN URLs.
// Root cause of the "spinning on the wrong 7" stall: the old claim allowed
// source_url-only docs (expired CoStar-CDN links, highest document_id) to clog
// the newest-first window every tick. Now the claim requires storage_path.
describe('fetchEligibleDocs (deed OCR drain — storage-ready claim)', () => {
  it('requires storage_path + NULL raw_text, excludes terminal states, ILIKE deed, newest-first', async () => {
    const { q, calls } = makeFakeQ({ 'property_documents?raw_text=is.null': { value: { ok: true, data: [{ document_id: 6738, storage_path: 'gov/deed/1/x.pdf' }] } } });
    const r = await fetchEligibleDocs('government', { limit: 15, doctype: 'deed' }, { domainQuery: q });
    assert.equal(r.ok, true);
    const path = calls[0].path;
    assert.ok(path.includes('raw_text=is.null'), 'not yet text-extracted');
    assert.ok(path.includes('storage_path=not.is.null'), 'bytes must be in Storage (no CDN fetch)');
    assert.ok(!path.includes('source_url.not.is.null'), 'no longer claims URL-only (expired-CDN) docs');
    assert.ok(path.includes(`ingestion_status.not.in.(deed_parsed,${DEED_NO_PARTIES_TERMINAL})`), 'terminal states excluded');
    assert.ok(path.includes('ingestion_status.is.null'), 'NULL / url_captured / bytes_captured status included');
    assert.ok(path.includes('document_type=ilike.*deed*'), 'deed doctype via ILIKE (robust to variants)');
    assert.ok(path.includes('order=document_id.desc'), 'newest-first');
    assert.ok(path.includes('limit=15'));
  });

  it('doctype=all drops the document_type filter entirely', async () => {
    const { q, calls } = makeFakeQ();
    await fetchEligibleDocs('dialysis', { limit: 10, doctype: 'all' }, { domainQuery: q });
    assert.ok(!calls[0].path.includes('document_type='), 'no doctype filter when all');
    assert.ok(calls[0].path.includes('storage_path=not.is.null'), 'still storage-ready only');
  });

  it('propagates a list failure', async () => {
    const q = async () => ({ ok: false, status: 500, data: 'boom' });
    const r = await fetchEligibleDocs('government', { limit: 15, doctype: 'deed' }, { domainQuery: q });
    assert.equal(r.ok, false);
    assert.equal(r.status, 500);
  });
});
