// Prompt 42 — comps DATA-QUALITY gates (2026-08-05).
// Verifies the engine-side gates that keep impossible/blank values out of the comps
// export: DOM gate (bad/after-sale list dates), bid-ask gate (sold above ask), and the
// on-market PRICE CHG signal (original ask distinct from current).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applySoldCompGates, applyOnMarketPriceChange } from '../mcp/comps-tools.js';

describe('applySoldCompGates — DOM gate', () => {
  it('blanks an ON MARKET date that is AFTER the sale (would yield negative DOM)', () => {
    const row = applySoldCompGates({ sale_date: '2025-06-01', on_market: '2025-09-01', sale_price: 1_000_000 });
    assert.equal(row.on_market, undefined, 'after-sale list date must be blanked');
    assert.ok(row.review_flags?.includes('list_date_out_of_range'));
  });

  it('blanks an ON MARKET date more than 1,500 days before sale (absurd DOM)', () => {
    const row = applySoldCompGates({ sale_date: '2025-06-01', on_market: '2018-01-01', sale_price: 1_000_000 });
    assert.equal(row.on_market, undefined);
  });

  it('keeps a valid ON MARKET date (normal DOM) untouched', () => {
    const row = applySoldCompGates({ sale_date: '2025-06-01', on_market: '2025-01-01', sale_price: 1_000_000 });
    assert.equal(row.on_market, '2025-01-01');
    assert.ok(!row.review_flags);
  });

  it('leaves a blank list date blank (never fabricates)', () => {
    const row = applySoldCompGates({ sale_date: '2025-06-01', sale_price: 1_000_000 });
    assert.equal(row.on_market, undefined);
    assert.ok(!row.review_flags);
  });
});

describe('applySoldCompGates — bid-ask gate', () => {
  it('blanks an ask that is BELOW the sale price (would yield negative bid-ask) and flags it', () => {
    const row = applySoldCompGates({
      sale_date: '2025-06-01', sale_price: 1_000_000,
      initial_price: 900_000, initial_cap: 0.07,
      last_price: 950_000, last_cap: 0.068, on_market: '2025-01-01',
    });
    assert.equal(row.initial_price, undefined);
    assert.equal(row.last_price, undefined);
    assert.equal(row.initial_cap, undefined);
    assert.equal(row.last_cap, undefined);
    assert.ok(row.review_flags?.includes('ask_below_sale'));
  });

  it('keeps an ask at/above the sale price (normal down-negotiation)', () => {
    const row = applySoldCompGates({
      sale_date: '2025-06-01', sale_price: 1_000_000,
      initial_price: 1_100_000, last_price: 1_000_000, on_market: '2025-01-01',
    });
    assert.equal(row.initial_price, 1_100_000);
    assert.equal(row.last_price, 1_000_000);
    assert.ok(!row.review_flags);
  });
});

describe('applyOnMarketPriceChange — PRICE CHG signal', () => {
  it('flags a repriced listing (initial != current)', () => {
    const row = applyOnMarketPriceChange({ initial_price: 5_000_000, cur_price: 4_500_000 });
    assert.equal(row.had_price_change, true);
    assert.equal(row.price_changes, 1);
    assert.equal(row.pct_of_initial, 0.9);
  });

  it('does not flag a listing whose ask never moved', () => {
    const row = applyOnMarketPriceChange({ initial_price: 5_000_000, cur_price: 5_000_000 });
    assert.equal(row.had_price_change, false);
    assert.equal(row.price_changes, 0);
  });
});
