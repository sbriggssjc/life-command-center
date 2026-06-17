// R37 (2026-06-17) — sidebar sales writer: stop minting price-less placeholders
// and prevent-at-write the duplicate_superseded churn.
//
// Root cause (audit 2026-06-16): api/_handlers/sidebar-pipeline.js
// upsertDomainSales INSERTed a NEW price-less sales_transactions row on every
// re-capture of a property (the ±14d lookup misses when there is no priced row
// to match). 86% of those needs_review placeholders sat on a property that
// already had a real, priced live sale. R37 refuses the placeholder at the
// source: a price-less page reference is not a closed transaction.
//
// classifySaleWrite() is the pure policy; propertyHasLivePricedSale() is the
// live probe that distinguishes the redundant case from a genuinely-new one.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySaleWrite,
  propertyHasLivePricedSale,
} from '../api/_handlers/sidebar-pipeline.js';

describe('classifySaleWrite (R37 prevent-at-write policy)', () => {
  it('PATCHes when an existing sale matched — never a second row (idempotent re-capture)', () => {
    // A matched row is refreshed in place regardless of whether the incoming
    // capture carried a price.
    assert.deepEqual(
      classifySaleWrite({ lookupMatched: true, incomingHasPrice: true, propertyHasLiveSale: false }),
      { action: 'patch', reason: 'matched_existing' });
    assert.deepEqual(
      classifySaleWrite({ lookupMatched: true, incomingHasPrice: false, propertyHasLiveSale: true }),
      { action: 'patch', reason: 'matched_existing' });
  });

  it('INSERTs a genuinely-new priced sale (no existing match, real price)', () => {
    assert.deepEqual(
      classifySaleWrite({ lookupMatched: false, incomingHasPrice: true, propertyHasLiveSale: false }),
      { action: 'insert', reason: 'new_priced_sale' });
    // An aggregate-nulled sale still has incomingHasPrice=true (raw page price
    // > 0) so it is allowed to insert — it is a real, identified sale.
    assert.equal(
      classifySaleWrite({ lookupMatched: false, incomingHasPrice: true, propertyHasLiveSale: true }).action,
      'insert');
  });

  it('SKIPs a price-less re-capture when the property already has a live priced sale (the 86% case)', () => {
    assert.deepEqual(
      classifySaleWrite({ lookupMatched: false, incomingHasPrice: false, propertyHasLiveSale: true }),
      { action: 'skip', reason: 'priceless_redundant_live_sale_exists' });
  });

  it('SKIPs a genuinely-new price-less reference (no price, no live sale) — not a closed transaction', () => {
    assert.deepEqual(
      classifySaleWrite({ lookupMatched: false, incomingHasPrice: false, propertyHasLiveSale: false }),
      { action: 'skip', reason: 'priceless_no_live_sale' });
  });

  it('never returns insert for a price-less capture (no placeholder is ever minted)', () => {
    for (const propertyHasLiveSale of [true, false]) {
      const d = classifySaleWrite({ lookupMatched: false, incomingHasPrice: false, propertyHasLiveSale });
      assert.equal(d.action, 'skip');
    }
  });
});

const originalFetch = global.fetch;
const ENV_KEYS = [
  'DIA_SUPABASE_URL', 'DIA_SUPABASE_KEY', 'DIA_SUPABASE_SERVICE_KEY',
  'GOV_SUPABASE_URL', 'GOV_SUPABASE_KEY', 'GOV_SUPABASE_SERVICE_KEY',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

beforeEach(() => {
  process.env.DIA_SUPABASE_URL = 'https://dia.example.supabase.co';
  process.env.DIA_SUPABASE_KEY = 'dia-key';
  process.env.GOV_SUPABASE_URL = 'https://gov.example.supabase.co';
  process.env.GOV_SUPABASE_KEY = 'gov-key';
});

afterEach(() => {
  global.fetch = originalFetch;
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe('propertyHasLivePricedSale (R37 live probe)', () => {
  it('probes the live + priced lane and returns true when a row exists', async () => {
    let probedUrl = null;
    global.fetch = async (url) => { probedUrl = String(url); return jsonResponse([{ sale_id: 123 }]); };

    const has = await propertyHasLivePricedSale('government', 5501);

    assert.equal(has, true);
    assert.match(probedUrl, /property_id=eq\.5501/);
    assert.match(probedUrl, /transaction_state=eq\.live/);
    assert.match(probedUrl, /sold_price=gt\.0/);
  });

  it('returns false when no live priced sale exists', async () => {
    global.fetch = async () => jsonResponse([]);
    assert.equal(await propertyHasLivePricedSale('dialysis', 99), false);
  });

  it('returns false (no throw) on a probe failure', async () => {
    global.fetch = async () => { throw new Error('network'); };
    assert.equal(await propertyHasLivePricedSale('dialysis', 99), false);
  });

  it('returns false for a null property id without probing', async () => {
    global.fetch = async () => { throw new Error('should not probe on null id'); };
    assert.equal(await propertyHasLivePricedSale('government', null), false);
  });
});
