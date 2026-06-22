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

const { parseDeedText, processDeedDocument, propagateStoredDeedExtraction } = await import('../api/_handlers/deed-parser.js');

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

describe('parseDeedText R58b — real-world formats (Unit 1) + price (Unit 2)', () => {
  // doc 3964 shape — narrative parenthetical body + explicit transfer amount + FL doc stamps
  const NARRATIVE = [
    'Prepared by ... Transfer Amt $13,333,400.00 ... Doc Stamps $93,333.80 ...',
    'SPECIAL WARRANTY DEED',
    'THIS SPECIAL WARRANTY DEED made this day by and between Oldsmar Retail Development LLC, ' +
      'a Florida limited liability company, whose address is 123 Main St (the "Grantor"), and ' +
      'Deltona Wellness, LP, a Florida limited partnership (the "Grantee").',
  ].join('\n');

  // doc 3807 shape — Simplifile / county-recorder cover-page labels (OCR)
  const COVER = 'Recording Cover Page\nFirst Grantor: TRIVIUM GROVE CITY LLC First Grantee: CHF II GROVE CITY MOB LLC\nFees: $18.50';

  it('narrative parenthetical: captures parties + strips entity qualifiers', () => {
    const p = parseDeedText(NARRATIVE, { state: 'FL' });
    assert.equal(p.grantor, 'Oldsmar Retail Development LLC');   // qualifier + address stripped
    assert.equal(p.grantee, 'Deltona Wellness, LP');            // ", LP" kept; ", a Florida …" stripped
  });

  it('R58c — real doc-3964 shape: name separated from the marker by a long qualifier + a/k/a + multi-line notice address', () => {
    // The token immediately before "(the "Grantor")" is the ADDRESS, not the
    // name; the qualifier/address wraps across OCR lines (newlines + commas).
    const REAL = [
      'Prepared by First American Title. Transfer Amt $13,333,400.00  Doc Stamps $93,333.80',
      'SPECIAL WARRANTY DEED',
      'THIS SPECIAL WARRANTY DEED is made this day by and between Oldsmar Retail Development LLC,',
      'a Florida limited liability company, a/k/a Oldsmar Retail Development, LLC, whose address is',
      '3662 Avalon Park East Boulevard, Suite 201, Orlando, Florida 32828 (the "Grantor"), and',
      'Deltona Wellness, LP, a Florida limited partnership, whose address is 17 Copperbeech Lane,',
      'Lawrence, New York 11559 (the "Grantee"), the following described property in Pinellas County.',
    ].join('\n');
    const p = parseDeedText(REAL, { state: 'FL' });
    assert.equal(p.grantor, 'Oldsmar Retail Development LLC');   // qualifier + a/k/a + address stripped
    assert.equal(p.grantee, 'Deltona Wellness, LP');            // ", LP" kept; ", a Florida …, whose address" stripped
    // Explicit transfer amount captured + doc-stamp cross-check agrees.
    assert.equal(p.transfer_amount, 13333400);
    assert.equal(p.implied_sale_price, 13333400);
    assert.equal(p.price_source, 'transfer_amount');
    assert.equal(p.price_cross_check, 'agree');                 // 13,333,400 × 0.0070 = 93,333.80
  });

  it('narrative parenthetical: curly quotes + name-qualifier-paren ordering', () => {
    const t = 'made by and between ABC Holdings, LLC, a Delaware limited liability company (the “Grantor”) and XYZ Trust (the “Grantee”)';
    const p = parseDeedText(t, { state: 'TX' });
    assert.equal(p.grantor, 'ABC Holdings, LLC');
    assert.equal(p.grantee, 'XYZ Trust');
  });

  it('labeled cover-page: First Grantor/First Grantee on one line', () => {
    const p = parseDeedText(COVER, { state: 'OH' });
    assert.equal(p.grantor, 'TRIVIUM GROVE CITY LLC');
    assert.equal(p.grantee, 'CHF II GROVE CITY MOB LLC');
  });

  it('labeled cover-page wins when both a cover sheet AND a narrative body are present', () => {
    const both = COVER + '\nby and between SOME OTHER SELLER LLC (the "Grantor"), and SOME OTHER BUYER LLC (the "Grantee")';
    const p = parseDeedText(both, { state: 'OH' });
    assert.equal(p.grantor, 'TRIVIUM GROVE CITY LLC');          // recorder's authoritative field
    assert.equal(p.grantee, 'CHF II GROVE CITY MOB LLC');
  });

  it('price: explicit transfer amount wins, tagged transfer_amount, cross-checks doc stamps', () => {
    const p = parseDeedText(NARRATIVE, { state: 'FL' });
    assert.equal(p.transfer_amount, 13333400);
    assert.equal(p.implied_sale_price, 13333400);
    assert.equal(p.price_source, 'transfer_amount');
    assert.equal(p.price_cross_check, 'agree');                 // 13,333,400 × 0.0070 = 93,333.80
  });

  it('price: FL doc-stamp back-out by state rate when no explicit amount', () => {
    const t = 'WARRANTY DEED ... Doc Stamps: $7,000.00 ... County of Pinellas';
    const p = parseDeedText(t, { state: 'FL' });
    assert.equal(p.implied_sale_price, 1000000);               // 7000 / 0.0070
    assert.equal(p.price_source, 'doc_stamp_estimate');
  });

  it('price: unmodeled state doc stamps → no estimate (skip, never guess)', () => {
    const t = 'WARRANTY DEED ... Doc Stamps: $7,000.00 ...';
    const p = parseDeedText(t, { state: 'GA' });
    assert.equal(p.implied_sale_price, undefined);
    assert.equal(p.doc_stamp_implied_price, undefined);
  });

  it('nominal "$10.00 and other valuable consideration" is NOT read as a price', () => {
    const t = 'GRANT DEED ... in consideration of $10.00 and other good and valuable consideration ... County of Orange';
    const p = parseDeedText(t, { state: 'CA' });
    assert.equal(p.transfer_amount, undefined);
    assert.equal(p.implied_sale_price, undefined);
  });

  it('deed of trust (trustor/trustee/beneficiary) yields NULL parties — no false extraction', () => {
    const t = 'DEED OF TRUST\nThis Deed of Trust is made among the Trustor JOHN SMITH, the Trustee FIRST AMERICAN TITLE, and the Beneficiary BIG BANK NA.';
    const p = parseDeedText(t, { state: 'CA' });
    assert.equal(p.grantor || null, null);
    assert.equal(p.grantee || null, null);
  });
});

describe('parseDeedText R59b — clean party extraction from OCR\'d scanned deeds (Unit 1)', () => {
  const HEAD = ['GRANT DEED', 'County of Los Angeles', 'DOC # 2021-1 recorded on 05/10/2021'].join('\n');

  it('doc-1896 shape: a county-form instruction LABEL is rejected (→ null, not junk)', () => {
    // The scanned form puts the parenthetical instruction after the label; the
    // labeled path used to capture it verbatim.
    const t = HEAD + '\nGrantee (name, mailing address, and, if appropriate, character of entity, e.g. a California corporation):\n';
    const p = parseDeedText(t, { state: 'CA' });
    assert.equal(p.grantee || null, null, 'form-instruction label is not emitted as a grantee');
  });

  it('doc-1935 shape: a legal-description blob is rejected (→ null, not junk)', () => {
    const legal = 'BEGINNING at the POINT OF BEGINNING thence North 45 degrees East along the metes and bounds more particularly described in Deed Book 12 Page 345 of said records, '.repeat(3);
    const t = HEAD + '\nacknowledged, SELLER TRUST hereby GRANTS to ' + legal + ' all that certain real property:';
    const p = parseDeedText(t, { state: 'CA' });
    assert.equal(p.grantee || null, null, 'legal-description span is not emitted as a grantee');
  });

  it('doc-1948 shape: a real name + trailing OCR junk is TRIMMED to the clean name (recovery)', () => {
    // The legacy "GRANTS to …" path latched onto "<name>, A CALIFORNIA LIMITED
    // LIABILITY COMPANY Area". R59b strips the qualifier + the stray "Area" tail.
    const t = HEAD + '\nacknowledged, SUNSET PLAZA HOLDINGS LLC hereby GRANTS to LA MIRADA INVESTMENT LLC, A CALIFORNIA LIMITED LIABILITY COMPANY Area, the following described property:';
    const p = parseDeedText(t, { state: 'CA' });
    assert.equal(p.grantee, 'LA MIRADA INVESTMENT LLC', 'trailing qualifier + OCR-bleed token stripped');
  });

  it('no-comma OCR variant: "FOO LLC A CALIFORNIA LIMITED LIABILITY COMPANY Area" trims to "FOO LLC"', () => {
    const t = HEAD + '\nacknowledged, SELLER TRUST hereby GRANTS to OAKWOOD PARTNERS LLC A CALIFORNIA LIMITED LIABILITY COMPANY Area, the following described property:';
    const p = parseDeedText(t, { state: 'CA' });
    assert.equal(p.grantee, 'OAKWOOD PARTNERS LLC');
  });

  it('clean scanned GRANTOR:/GRANTEE: labeled block extracts both parties correctly', () => {
    const t = ['GRANT DEED', 'County of Los Angeles',
      'GRANTOR: SUNSET PLAZA HOLDINGS LLC',
      'GRANTEE: LA MIRADA INVESTMENT LLC',
      'DOC # 2021-123 recorded on 05/10/2021'].join('\n');
    const p = parseDeedText(t, { state: 'CA' });
    assert.equal(p.grantor, 'SUNSET PLAZA HOLDINGS LLC');
    assert.equal(p.grantee, 'LA MIRADA INVESTMENT LLC');
  });

  it('scanned "from <X> to <Y>" recital form (no parenthetical marker) extracts both parties', () => {
    const t = 'THIS WARRANTY DEED is made from Riverside Capital LP to Oakwood Partners LLC, dated May 10, 2021. County of Orange.';
    const p = parseDeedText(t, { state: 'CA' });
    assert.equal(p.grantor, 'Riverside Capital LP');
    assert.equal(p.grantee, 'Oakwood Partners LLC');
  });

  it('NO regression: doc-3964 narrative parenthetical still extracts Oldsmar / Deltona', () => {
    const REAL = [
      'Prepared by First American Title. Transfer Amt $13,333,400.00  Doc Stamps $93,333.80',
      'SPECIAL WARRANTY DEED',
      'THIS SPECIAL WARRANTY DEED is made this day by and between Oldsmar Retail Development LLC,',
      'a Florida limited liability company, a/k/a Oldsmar Retail Development, LLC, whose address is',
      '3662 Avalon Park East Boulevard, Suite 201, Orlando, Florida 32828 (the "Grantor"), and',
      'Deltona Wellness, LP, a Florida limited partnership, whose address is 17 Copperbeech Lane,',
      'Lawrence, New York 11559 (the "Grantee"), the following described property in Pinellas County.',
    ].join('\n');
    const p = parseDeedText(REAL, { state: 'FL' });
    assert.equal(p.grantor, 'Oldsmar Retail Development LLC');
    assert.equal(p.grantee, 'Deltona Wellness, LP');
  });

  it('NO regression: deed of trust still yields NULL parties (no false from/to or label match)', () => {
    const t = 'DEED OF TRUST\nThis Deed of Trust is made among the Trustor JOHN SMITH, the Trustee FIRST AMERICAN TITLE, and the Beneficiary BIG BANK NA.';
    const p = parseDeedText(t, { state: 'CA' });
    assert.equal(p.grantor || null, null);
    assert.equal(p.grantee || null, null);
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

// ── R59 — propagation into the BD spine (Units 1-4) ─────────────────────────
describe('processDeedDocument — R59 BD-spine propagation', () => {
  // Reusable BD deps. granteePassesOwnerGuards rejects brokers/federal; the rest
  // are recording stubs. With NONE of these injected the R58 tests above prove
  // the deed flow is byte-identical (gated on dep presence).
  function bdDeps(over = {}) {
    const events = { research: [], entities: [], edges: [], ownerResolved: [] };
    const deps = {
      granteePassesOwnerGuards: (n) => !!n && !/broker|gsa|u\.?s\.?a\b/i.test(n) && n.replace(/[^a-z0-9]/gi, '').length >= 4,
      resolveRecordedOwner: async (_d, name) => { events.ownerResolved.push(name); return 'ro-1'; },
      ensureEntityLink: async (a) => {
        if (a.resolveOnly) return a.sourceType === 'asset' ? { ok: true, entityId: 'asset-ent-1' } : { ok: false };
        events.entities.push(a); return { ok: true, entityId: 'owner-ent-1' };
      },
      insertEntityRelationship: async (row) => { events.edges.push(row); return { ok: true }; },
      opsQuery: async (_m, _p) => ({ ok: true, data: [] }),  // edge dupe-guard: none exists
      openResearchTask: async (a) => { events.research.push(a); return { ok: true, created: true }; },
      resolveBuyerParent: async () => ({ ok: true, data: [] }),  // no registered parent
      ...over,
    };
    return { deps, events };
  }

  it('Unit 1(a): fills a date-proximate sale\'s parties (dia buyer_name/seller_name), guarded on is.null', async () => {
    const { deps } = bdDeps();
    const f = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'deed_records': { method: 'POST', value: { ok: true, data: [{ id: 'd1' }] } },
      'properties?property_id=eq.55&select=latest_deed_grantee': { value: { ok: true, data: [{ latest_deed_grantee: null, latest_deed_date: null }] } },
      // price (2,000,000) does NOT 2%-match the deed's 1,000,000, but the sale is 5
      // days from the deed date → date-proximate fallback ⇒ confident.
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [{ sale_id: 7, sold_price: 2000000, sale_date: '2024-03-10' }] } },
    });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q, ...deps });
    const buyerFill = f.calls.find(c => c.method === 'PATCH' && c.path.includes('sales_transactions?sale_id=eq.7') && c.path.includes('buyer_name=is.null'));
    const sellerFill = f.calls.find(c => c.method === 'PATCH' && c.path.includes('sales_transactions?sale_id=eq.7') && c.path.includes('seller_name=is.null'));
    assert.ok(buyerFill, 'buyer_name fill-blanks PATCH on the matched sale');
    assert.equal(buyerFill.body.buyer_name, 'BUYER HOLDINGS LLC');
    assert.ok(sellerFill, 'seller_name fill-blanks PATCH');
    assert.equal(sellerFill.body.seller_name, 'SELLER TRUST');
    assert.equal(r.saleBuyerFilled, true);
    assert.equal(r.saleSellerFilled, true);
  });

  it('Unit 1(a): gov uses buyer/seller columns (not buyer_name)', async () => {
    const { deps } = bdDeps();
    const f = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [{ sale_id: 'u-1', sold_price: 1000000, sale_date: '2024-03-15' }] } },
    });
    await processDeedDocument('government', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q, ...deps });
    assert.ok(f.calls.some(c => c.method === 'PATCH' && c.path.includes('&buyer=is.null') && c.body.buyer === 'BUYER HOLDINGS LLC'), 'gov fills buyer');
    assert.equal(f.calls.some(c => c.path.includes('buyer_name=is.null')), false, 'gov never uses buyer_name');
  });

  it('Unit 1(b): appends an ownership_history event for the grantee (dia schema), idempotent', async () => {
    const { deps } = bdDeps();
    const f = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [{ sale_id: 7, sold_price: 1000000, sale_date: '2024-03-15' }] } },
      // dedup probe: no existing OH row for this owner+date
      'ownership_history?property_id=eq.55&recorded_owner_id=eq.ro-1': { method: 'GET', value: { ok: true, data: [] } },
    });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q, ...deps });
    const ohPost = f.calls.find(c => c.method === 'POST' && c.path === 'ownership_history');
    assert.ok(ohPost, 'POST ownership_history');
    assert.equal(ohPost.body.recorded_owner_id, 'ro-1');
    assert.equal(ohPost.body.ownership_start, '2024-03-15');
    assert.equal(ohPost.body.acquisition_method, 'deed');
    assert.equal(ohPost.body.ownership_state, 'active');
    assert.equal(ohPost.body.sale_id, 7, 'links the integer sale_id (dia)');
    assert.equal('ownership_id' in ohPost.body, false, 'never supplies ownership_id (DB auto-fills it)');
    assert.equal(r.ownershipEventAppended, true);
  });

  it('Unit 1(b): a pre-existing OH row for the same owner+date → no duplicate append', async () => {
    const { deps } = bdDeps();
    const f = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [{ sale_id: 7, sold_price: 1000000, sale_date: '2024-03-15' }] } },
      'ownership_history?property_id=eq.55&recorded_owner_id=eq.ro-1': { method: 'GET', value: { ok: true, data: [{ id: 999 }] } },
    });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q, ...deps });
    assert.equal(f.calls.some(c => c.method === 'POST' && c.path === 'ownership_history'), false, 'no duplicate OH insert');
    assert.equal(r.ownershipEventAppended, false);
  });

  it('Unit 2: deed with consideration but NO sale → research task, never writes a sale', async () => {
    const { deps, events } = bdDeps();
    const f = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [] } },   // no sales at all
    });
    const r = await processDeedDocument('government', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q, ...deps });
    assert.equal(r.suspectedSaleSurfaced, true);
    const task = events.research.find(t => t.researchType === 'confirm_deed_transfer_sale');
    assert.ok(task, 'opens confirm_deed_transfer_sale');
    assert.equal(task.propertyId, 55);
    assert.equal(task.metadata.suspected_grantee, 'BUYER HOLDINGS LLC');
    assert.equal(f.calls.some(c => c.method === 'POST' && c.path.startsWith('sales_transactions')), false, 'never writes a sales row');
  });

  it('Unit 3: grantee → entity + owns edge (asset resolved); never opens an opportunity', async () => {
    const { deps, events } = bdDeps();
    const f = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [] } },
    });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q, ...deps });
    assert.equal(r.granteeEntityId, 'owner-ent-1');
    const mint = events.entities.find(e => e.sourceType === 'true_owner');
    assert.ok(mint, 'mints the grantee owner entity via ensureEntityLink');
    assert.equal(mint.domain, 'dia');
    assert.equal(r.ownsEdgeCreated, true);
    const edge = events.edges[0];
    assert.equal(edge.from_entity_id, 'owner-ent-1');  // owner = from
    assert.equal(edge.to_entity_id, 'asset-ent-1');    // asset = to
    assert.equal(edge.relationship_type, 'owns');
    // No opportunity is ever opened by the deed path (R5 gate owns that).
    assert.equal(f.calls.some(c => /rpc\/lcc_open_prospect_opportunity|bd_opportunities/.test(c.path)), false);
  });

  it('Unit 3: asset entity does not resolve → no owns edge (never invents an asset)', async () => {
    const { deps, events } = bdDeps({ ensureEntityLink: async (a) => a.resolveOnly ? { ok: false } : { ok: true, entityId: 'owner-ent-1' } });
    const f = makeFakeQ({ 'deed_records?data_hash': { value: { ok: true, data: [] } }, 'sales_transactions?property_id=eq.55': { value: { ok: true, data: [] } } });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q, ...deps });
    assert.equal(r.granteeEntityId, 'owner-ent-1');
    assert.equal(r.ownsEdgeCreated, false);
    assert.equal(events.edges.length, 0);
  });

  it('Unit 4: an LLC grantee that does not resolve to a parent → trace_grantee_to_parent', async () => {
    const { deps, events } = bdDeps();  // resolveBuyerParent returns no parent
    const f = makeFakeQ({ 'deed_records?data_hash': { value: { ok: true, data: [] } }, 'sales_transactions?property_id=eq.55': { value: { ok: true, data: [] } } });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q, ...deps });
    assert.equal(r.traceGranteeTaskSurfaced, true);
    assert.ok(events.research.some(t => t.researchType === 'trace_grantee_to_parent'), 'opens trace task');
  });

  it('Unit 4: a grantee that DOES resolve to a known parent → no trace task', async () => {
    const { deps, events } = bdDeps({ resolveBuyerParent: async () => ({ ok: true, data: [{ parent_entity_id: 'parent-1' }] }) });
    const f = makeFakeQ({ 'deed_records?data_hash': { value: { ok: true, data: [] } }, 'sales_transactions?property_id=eq.55': { value: { ok: true, data: [] } } });
    const r = await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, { domainQuery: f.q, ...deps });
    assert.equal(r.traceGranteeTaskSurfaced, false);
    assert.equal(events.research.some(t => t.researchType === 'trace_grantee_to_parent'), false);
  });

  it('GUARD: a broker grantee writes nothing (no party fill, no OH, no entity)', async () => {
    const BROKER_DEED = [
      'GRANT DEED', 'County of Orange',
      'DOC # 2024-1 recorded on 06/01/2024',
      'acknowledged, SELLER TRUST hereby GRANTS to CBRE Group Inc broker, the following described property:',
    ].join('\n');
    const { deps, events } = bdDeps();
    const f = makeFakeQ({
      'deed_records?data_hash': { value: { ok: true, data: [] } },
      'sales_transactions?property_id=eq.55': { value: { ok: true, data: [{ sale_id: 7, sold_price: 1, sale_date: '2024-06-01' }] } },
    });
    const r = await processDeedDocument('dialysis', 55, 900, BROKER_DEED, { state: 'CA' }, { domainQuery: f.q, ...deps });
    assert.equal(r.saleBuyerFilled, false, 'broker never fills the buyer');
    assert.equal(r.ownershipEventAppended, false);
    assert.equal(r.granteeEntityId, null);
    assert.equal(events.entities.length, 0);
  });
});

// ── R59b Unit 2 — retroactive propagation over STORED extraction ────────────
describe('propagateStoredDeedExtraction (R59b Unit 2)', () => {
  function bdDeps(over = {}) {
    const events = { research: [], entities: [], edges: [], ownerResolved: [] };
    const deps = {
      granteePassesOwnerGuards: (n) => !!n && !/broker|gsa|u\.?s\.?a\b/i.test(n) && n.replace(/[^a-z0-9]/gi, '').length >= 4,
      resolveRecordedOwner: async (_d, name) => { events.ownerResolved.push(name); return 'ro-1'; },
      ensureEntityLink: async (a) => {
        if (a.resolveOnly) return a.sourceType === 'asset' ? { ok: true, entityId: 'asset-ent-1' } : { ok: false };
        events.entities.push(a); return { ok: true, entityId: 'owner-ent-1' };
      },
      insertEntityRelationship: async (row) => { events.edges.push(row); return { ok: true }; },
      opsQuery: async () => ({ ok: true, data: [] }),
      openResearchTask: async (a) => { events.research.push(a); return { ok: true, created: true }; },
      resolveBuyerParent: async () => ({ ok: true, data: [] }),
      ...over,
    };
    return { deps, events };
  }

  // The stored extraction (extracted_data.deed_extraction) for the real 3964 deal.
  const STORED = {
    grantee: 'Deltona Wellness, LP', grantor: 'Oldsmar Retail Development LLC',
    recording_date: '01/21/2020', implied_sale_price: 13333400, deed_type: 'Special Warranty Deed',
  };

  it('reuses Step 6 over stored extraction (no re-parse): fills a price-matched sale\'s parties', async () => {
    const { deps } = bdDeps();
    const f = makeFakeQ({
      'sales_transactions?property_id=eq.24703': { value: { ok: true, data: [{ sale_id: 14751, sold_price: 13333400, sale_date: '2020-01-21' }] } },
      'ownership_history?property_id=eq.24703&recorded_owner_id=eq.ro-1': { method: 'GET', value: { ok: true, data: [] } },
    });
    const r = await propagateStoredDeedExtraction(
      { domain: 'dialysis', propertyId: 24703, documentId: 3964, parsed: STORED },
      { domainQuery: f.q, ...deps }
    );
    // Never re-parses (no extracted_data PATCH, no deed_records write).
    assert.equal(f.calls.some(c => c.path.startsWith('property_documents')), false, 'no extracted_data re-write');
    assert.equal(f.calls.some(c => c.path.startsWith('deed_records')), false, 'no deed_records write');
    // Runs the R59 propagation: buyer/seller fill on the matched sale.
    const buyerFill = f.calls.find(c => c.method === 'PATCH' && c.path.includes('sales_transactions?sale_id=eq.14751') && c.path.includes('buyer_name=is.null'));
    assert.ok(buyerFill, 'fills buyer_name on the matched sale');
    assert.equal(buyerFill.body.buyer_name, 'Deltona Wellness, LP');
    assert.equal(r.saleBuyerFilled, true);
    assert.equal(r.saleSellerFilled, true);
    assert.equal(r.ownershipEventAppended, true);
  });

  it('no grantee in the stored extraction → pure no-op', async () => {
    const { deps } = bdDeps();
    const f = makeFakeQ({});
    const r = await propagateStoredDeedExtraction(
      { domain: 'dialysis', propertyId: 24703, documentId: 3964, parsed: { grantor: 'X', recording_date: '01/21/2020' } },
      { domainQuery: f.q, ...deps }
    );
    assert.equal(f.calls.length, 0);
    assert.equal(r.saleBuyerFilled, false);
    assert.equal(r.ownershipEventAppended, false);
  });
});
