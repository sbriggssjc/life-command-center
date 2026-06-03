// QA1 (2026-06-03) — sale-price bleed defense in api/_handlers/sidebar-pipeline.js.
//
// CoStar portfolio captures stamp a deal's AGGREGATE sale price onto every
// constituent property as that property's per-property sold_price. The
// ingestion guard detectSalePriceBleed() refuses to store such an aggregate:
// when a sale for ANOTHER property already carries the same sold_price +
// sale_date, the incoming row is treated as a portfolio aggregate
// (isAggregate=true ⇒ the caller nulls sold_price + sets
// exclude_from_market_metrics). Magnitude alone (overCeiling) is only a soft
// flag — large government buildings are legitimately expensive — so it never
// auto-nulls; the duplicate price+date signature is the auto-null trigger.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectSalePriceBleed,
  SALE_PRICE_BLEED_CEILING,
} from '../api/_handlers/sidebar-pipeline.js';

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

describe('detectSalePriceBleed', () => {
  it('flags a second property with an identical price+date as a portfolio aggregate (→ sold_price nulled + excluded)', async () => {
    let probedUrl = null;
    // Simulate: property 26621 already has a $950M / 2023-09-12 sale, and now
    // property 28730 arrives with the SAME price+date — the bleed signature.
    global.fetch = async (url) => {
      probedUrl = String(url);
      return jsonResponse([{ sale_id: 14319 }]); // a sibling row exists
    };

    const bleed = await detectSalePriceBleed('dialysis', 28730, 950000000, '2023-09-12');

    assert.equal(bleed.isAggregate, true, 'duplicate price+date on another property ⇒ aggregate');
    // The probe must exclude the current property and pin price + date.
    assert.match(probedUrl, /sold_price=eq\.950000000/);
    assert.match(probedUrl, /sale_date=eq\.2023-09-12/);
    assert.match(probedUrl, /property_id=neq\.28730/);

    // Mirror the caller's write decision: an aggregate is nulled + excluded.
    const writeSoldPrice = bleed.isAggregate ? null : 950000000;
    const excludeFromMarketMetrics = bleed.isAggregate || bleed.overCeiling;
    assert.equal(writeSoldPrice, null, 'aggregate price must be nulled, not stored per-property');
    assert.equal(excludeFromMarketMetrics, true, 'aggregate row must be excluded from market metrics');
  });

  it('does NOT flag a genuine single-property sale (no sibling, normal price)', async () => {
    global.fetch = async () => jsonResponse([]); // no other property shares price+date

    const bleed = await detectSalePriceBleed('dialysis', 12345, 2980000, '2024-05-01');

    assert.equal(bleed.isAggregate, false);
    assert.equal(bleed.overCeiling, false);
  });

  it('soft-flags an over-ceiling price for review without auto-nulling (magnitude is a flag, not the trigger)', async () => {
    global.fetch = async () => jsonResponse([]); // unique price+date — not the bleed signature

    const bleed = await detectSalePriceBleed('dialysis', 999, 142900000, '2019-09-30');

    assert.equal(bleed.isAggregate, false, 'magnitude alone never sets isAggregate');
    assert.equal(bleed.overCeiling, true, `> $${SALE_PRICE_BLEED_CEILING.dialysis} dia ceiling`);

    // Caller: over-ceiling is flagged for review but the price is RETAINED.
    const writeSoldPrice = bleed.isAggregate ? null : 142900000;
    const excludeFromMarketMetrics = bleed.isAggregate || bleed.overCeiling;
    assert.equal(writeSoldPrice, 142900000, 'over-ceiling price is retained, not nulled');
    assert.equal(excludeFromMarketMetrics, true, 'over-ceiling row is flagged for human review');
  });

  it('uses the higher government ceiling — a $142.9M gov sale is not over-ceiling', async () => {
    global.fetch = async () => jsonResponse([]);

    const bleed = await detectSalePriceBleed('government', 3063, 142900000, '2022-12-01');

    assert.equal(bleed.overCeiling, false,
      `gov ceiling is $${SALE_PRICE_BLEED_CEILING.government}, so $142.9M is allowed`);
    assert.equal(bleed.isAggregate, false);
  });

  it('returns no flags for a null/zero/negative price', async () => {
    global.fetch = async () => { throw new Error('should not probe on missing price'); };

    for (const px of [null, 0, -100]) {
      const bleed = await detectSalePriceBleed('dialysis', 1, px, '2024-01-01');
      assert.deepEqual(bleed, { isAggregate: false, overCeiling: false });
    }
  });
});
