import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveListingAskHistory } from '../api/_handlers/sidebar-pipeline.js';

test('deriveListingAskHistory preserves distinct original/current ask and cap rates', () => {
  const out = deriveListingAskHistory({
    original_price: '$5.5M',
    asking_price: '$5,250,000',
    original_cap_rate: '6.25%',
    cap_rate: '6.55%',
    last_price_change: '2026-02-15',
  });

  assert.equal(out.originalPrice, 5_500_000);
  assert.equal(out.currentPrice, 5_250_000);
  assert.equal(out.originalCap, 0.0625);
  assert.equal(out.currentCap, 0.0655);
  assert.equal(out.lastPriceChange, '2026-02-15');
});

test('deriveListingAskHistory falls back to sorted vendor price history and dedupes rows', () => {
  const out = deriveListingAskHistory({
    price_change_history: [
      { change_date: '2026-03-01', price: '$4,800,000', cap_rate: '6.8%' },
      { change_date: '2025-10-01', price: '$5,100,000', cap_rate: '6.4%' },
      { change_date: '2025-10-01', price: '$5,100,000', cap_rate: '6.4%' },
    ],
  });

  assert.equal(out.history.length, 2);
  assert.equal(out.originalPrice, 5_100_000);
  assert.equal(out.currentPrice, 4_800_000);
  assert.equal(out.originalCap, 0.064);
  assert.equal(out.currentCap, 0.068);
  assert.equal(out.lastPriceChange, '2026-03-01');
  assert.equal(out.priceChangeCount, 1);
});

test('deriveListingAskHistory does not fabricate original ask from a single current ask', () => {
  const out = deriveListingAskHistory({ asking_price: '$3,900,000', cap_rate: '7.1%' });

  assert.equal(out.originalPrice, null);
  assert.equal(out.currentPrice, 3_900_000);
  assert.equal(out.originalCap, null);
  assert.equal(out.currentCap, 0.071);
  assert.equal(out.priceChangeCount, 0);
});
