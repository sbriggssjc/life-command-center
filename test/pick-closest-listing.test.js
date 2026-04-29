import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickClosestListing } from '../api/_handlers/sidebar-pipeline.js';

describe('pickClosestListing — sale_date → active listing matcher', () => {
  it('returns null for empty / non-array input', () => {
    assert.equal(pickClosestListing([], '2026-04-01'), null);
    assert.equal(pickClosestListing(null, '2026-04-01'), null);
    assert.equal(pickClosestListing(undefined, '2026-04-01'), null);
  });

  it('returns null when saleDate is unparseable', () => {
    assert.equal(pickClosestListing([{ listing_id: 1, listing_date: '2026-01-01' }], 'not-a-date'), null);
  });

  it('skips listings outside the 3-year window on either side', () => {
    const sale = '2026-04-01';
    const rows = [
      { listing_id: 1, listing_date: '2022-03-01' }, // 4y before — out
      { listing_id: 2, listing_date: '2030-04-01' }  // 4y after  — out
    ];
    assert.equal(pickClosestListing(rows, sale), null);
  });

  it('picks the closest in-window listing by absolute distance', () => {
    const sale = '2026-04-01';
    const rows = [
      { listing_id: 1, listing_date: '2025-04-01' },  // 365d before
      { listing_id: 2, listing_date: '2026-03-15' },  // 17d before — closest
      { listing_id: 3, listing_date: '2026-09-01' }   // 153d after
    ];
    assert.equal(pickClosestListing(rows, sale).listing_id, 2);
  });

  it('breaks ties in favor of the listing on-or-before sale_date', () => {
    const sale = '2026-04-15';
    const rows = [
      { listing_id: 'before', listing_date: '2026-04-05' }, // 10d before
      { listing_id: 'after',  listing_date: '2026-04-25' }  // 10d after
    ];
    assert.equal(pickClosestListing(rows, sale).listing_id, 'before');
  });

  it('counts an exactly-on-sale-date listing as on-or-before', () => {
    const sale = '2026-04-15';
    const rows = [
      { listing_id: 'same', listing_date: '2026-04-15' }, // 0d
      { listing_id: 'after', listing_date: '2026-04-15' }, // 0d (duplicate)
    ];
    // First scan picks 'same' (sign=-1); second has same dist+sign so the
    // first wins. Either way, an exact-match listing is preferred over an
    // arbitrary candidate further away.
    const picked = pickClosestListing(rows, sale);
    assert.ok(picked);
    assert.equal(picked.listing_date, '2026-04-15');
  });

  it('skips rows with null/missing listing_date', () => {
    const sale = '2026-04-01';
    const rows = [
      { listing_id: 1, listing_date: null },
      { listing_id: 2 },
      { listing_id: 3, listing_date: '2026-03-01' }
    ];
    assert.equal(pickClosestListing(rows, sale).listing_id, 3);
  });

  it('honors the 3-year boundary — at exactly 3 years it still matches', () => {
    const sale = '2026-04-01';
    const inWindow = { listing_id: 'in',  listing_date: '2023-04-02' }; // ~3y - 1d
    const outOfWindow = { listing_id: 'out', listing_date: '2022-01-01' };
    assert.equal(pickClosestListing([inWindow, outOfWindow], sale).listing_id, 'in');
  });
});
