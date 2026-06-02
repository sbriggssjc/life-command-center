import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveListingDate } from '../api/_handlers/sidebar-pipeline.js';

// Fixed capture instant so assertions are deterministic: 2026-06-02T00:00:00Z
const NOW = Date.parse('2026-06-02T00:00:00.000Z');

describe('deriveListingDate — CoStar on-market signal → listing_date', () => {
  it('prefers CoStar explicit on-market date when present and not future', () => {
    const r = deriveListingDate({ listing_date: '2025-01-07', days_on_market: 30 }, NOW);
    assert.equal(r.listing_date, '2025-01-07');
    assert.equal(r.source, 'costar_on_market_date');
  });

  it('falls back to capture_date − days_on_market when no explicit date', () => {
    const r = deriveListingDate({ days_on_market: 196 }, NOW);
    // 2026-06-02 minus 196 days = 2025-11-18
    assert.equal(r.listing_date, '2025-11-18');
    assert.equal(r.source, 'costar_days_on_market');
  });

  it('ignores a future on-market date and uses DOM instead', () => {
    const r = deriveListingDate({ listing_date: '2026-12-31', days_on_market: 10 }, NOW);
    assert.equal(r.listing_date, '2026-05-23'); // NOW − 10d
    assert.equal(r.source, 'costar_days_on_market');
  });

  it('falls back to capture date when neither signal is present', () => {
    const r = deriveListingDate({}, NOW);
    assert.equal(r.listing_date, '2026-06-02');
    assert.equal(r.source, 'capture_date_fallback');
  });

  it('rejects out-of-range DOM (>1825d / negative) → capture date', () => {
    assert.equal(deriveListingDate({ days_on_market: 5000 }, NOW).source, 'capture_date_fallback');
    assert.equal(deriveListingDate({ days_on_market: -5 }, NOW).source, 'capture_date_fallback');
  });

  it('accepts DOM = 0 (listed today) as a valid signal, not a fallback', () => {
    const r = deriveListingDate({ days_on_market: 0 }, NOW);
    assert.equal(r.listing_date, '2026-06-02');
    assert.equal(r.source, 'costar_days_on_market');
  });

  it('handles malformed / numeric on-market date by falling through to DOM', () => {
    const r = deriveListingDate({ listing_date: 'not-a-date', days_on_market: 30 }, NOW);
    assert.equal(r.listing_date, '2026-05-03'); // NOW − 30d
    assert.equal(r.source, 'costar_days_on_market');
  });

  it('parses CoStar timestamp form and returns the date part only', () => {
    const r = deriveListingDate({ listing_date: '2024-09-15T00:00:00Z' }, NOW);
    assert.equal(r.listing_date, '2024-09-15');
    assert.equal(r.source, 'costar_on_market_date');
  });

  it('never returns a future date and is robust to empty input', () => {
    const r = deriveListingDate(undefined, NOW);
    assert.equal(r.listing_date, '2026-06-02');
    assert.ok(r.listing_date <= '2026-06-02');
  });
});
