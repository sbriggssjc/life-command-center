import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCapRate,
  firstOf,
  joinedOf,
} from '../api/_shared/intake-classify.js';

// ============================================================================
// Round 77f — writer-side cap-rate normalization + array-field coercion
// ============================================================================

describe('normalizeCapRate', () => {
  it('passes through a plausible decimal cap rate (0.055 → 0.055)', () => {
    // Buckeye AZ: extraction stored 0.055 (ALREADY decimal). The old promoter
    // divided by 100 again → 0.00055 → chk_*_cap_rate_decimal_range failure.
    assert.equal(normalizeCapRate(0.055), 0.055);
  });

  it('converts a percent-form cap rate (7.75 → 0.0775)', () => {
    // Independence MO OCR re-extract returned 7.75 (percent form).
    assert.equal(normalizeCapRate(7.75), 0.0775);
  });

  it('returns null for an implausible value either way (45 → null)', () => {
    assert.equal(normalizeCapRate(45), null);
  });

  it('returns null for a double-divided value below the band (0.0006 → null)', () => {
    // The exact failing-row value the live test surfaced.
    assert.equal(normalizeCapRate(0.0006), null);
  });

  it('handles the decimal-band boundaries', () => {
    assert.equal(normalizeCapRate(0.005), 0.005);   // lower bound, inclusive
    assert.equal(normalizeCapRate(0.30), 0.30);     // upper bound, inclusive
    assert.equal(normalizeCapRate(0.5), null);      // 0.30 < v ≤ 1.5 → ambiguous
    assert.equal(normalizeCapRate(1.5), null);      // boundary → ambiguous
    assert.equal(normalizeCapRate(1.6), 0.016);     // > 1.5 → percent form
  });

  it('parses string forms (with %/$/commas/whitespace)', () => {
    assert.equal(normalizeCapRate('7.75%'), 0.0775);
    assert.equal(normalizeCapRate('  6.5 '), 0.065);
    assert.equal(normalizeCapRate('0.055'), 0.055);
  });

  it('returns null for null/empty/garbage', () => {
    assert.equal(normalizeCapRate(null), null);
    assert.equal(normalizeCapRate(undefined), null);
    assert.equal(normalizeCapRate(''), null);
    assert.equal(normalizeCapRate('n/a'), null);
    assert.equal(normalizeCapRate(0), null);
    assert.equal(normalizeCapRate(-5), null);
  });
});

describe('firstOf (first-as-primary)', () => {
  it('returns the first non-empty element of a real array', () => {
    assert.equal(firstOf(['Jay Patel', 'Thomas Ladt', 'Nico Lautmann']), 'Jay Patel');
    assert.equal(firstOf(['', '  ', 'DaVita']), 'DaVita');
  });

  it('parses a JSON-array string and returns the first element', () => {
    assert.equal(firstOf('["Jay Patel","Thomas Ladt"]'), 'Jay Patel');
  });

  it('passes a scalar string through unchanged', () => {
    assert.equal(firstOf('Jay Patel'), 'Jay Patel');
  });

  it('returns null for null/undefined and empty arrays', () => {
    assert.equal(firstOf(null), null);
    assert.equal(firstOf(undefined), undefined);
    assert.equal(firstOf([]), null);
    assert.equal(firstOf(['', '   ']), null);
  });
});

describe('joinedOf (human-joined, never raw JSON)', () => {
  it('joins a real array with the default separator', () => {
    assert.equal(
      joinedOf(['Jay Patel', 'Thomas Ladt', 'Nico Lautmann']),
      'Jay Patel, Thomas Ladt, Nico Lautmann'
    );
  });

  it('joins a JSON-array string (never leaves raw JSON in a text column)', () => {
    assert.equal(joinedOf('["Jay Patel","Thomas Ladt"]'), 'Jay Patel, Thomas Ladt');
  });

  it('drops empty/null elements before joining', () => {
    assert.equal(joinedOf(['a', null, '', 'b']), 'a, b');
  });

  it('passes a scalar string through unchanged', () => {
    assert.equal(joinedOf('Jay Patel'), 'Jay Patel');
  });

  it('feeds the broker comma-splitter cleanly', () => {
    // The promoter splits the joined form on commas to make one contact/broker.
    const joined = joinedOf(['Jay Patel', 'Thomas Ladt', 'Nico Lautmann']);
    const names = joined.split(',').map(s => s.trim()).filter(Boolean);
    assert.deepEqual(names, ['Jay Patel', 'Thomas Ladt', 'Nico Lautmann']);
  });

  it('returns null/undefined unchanged', () => {
    assert.equal(joinedOf(null), null);
    assert.equal(joinedOf(undefined), undefined);
  });
});
