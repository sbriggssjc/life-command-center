// SIDEBAR2-b (2026-09-18) — CoStar sidebar captures were updating/creating
// address TWIN rows instead of the canonical property: a captured range
// address ("4550-4666 S Kirkman Rd") landed on its own row instead of the
// real single-number property inside that range, and an off-by-a-few-digits
// capture ("2604 N Hospital Rd") missed the real "2609 Hospital Rd" row
// entirely. No production-authorized range/alias matcher exists yet (see
// docs/architecture/property-identity-and-address-resolution.md — explicitly
// "No shared service, schema, promotion, or production write is
// authorized"), so this is NOT a new auto-attach matcher. It is a narrow,
// pure detector used only to REFUSE creating a twin and flag for review.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectRangeAddressCollision } from '../api/_handlers/sidebar-pipeline.js';

describe('detectRangeAddressCollision (SIDEBAR2-b)', () => {
  it('flags a captured RANGE containing an existing single-number property', () => {
    const hit = detectRangeAddressCollision('4550-4666 S Kirkman Rd', '4600 S Kirkman Rd');
    assert.ok(hit, 'must detect the range containment');
    assert.equal(hit.kind, 'range_containment');
  });

  it('flags the reverse: captured single number falling inside an existing RANGE row', () => {
    const hit = detectRangeAddressCollision('980 S Washington Ave', '920-1000 S Washington Ave');
    assert.ok(hit);
    assert.equal(hit.kind, 'range_containment');
  });

  it('flags a close off-by-a-few-digits civic number on the same street', () => {
    const hit = detectRangeAddressCollision('2604 N Hospital Rd', '2609 Hospital Rd');
    assert.ok(hit, 'must detect the adjacent-civic-number near miss');
    assert.equal(hit.kind, 'adjacent_civic_number');
    assert.equal(hit.distance, 5);
  });

  it('does NOT flag a genuinely different street (no false positive)', () => {
    const hit = detectRangeAddressCollision('4600 S Kirkman Rd', '4600 N Orange Ave');
    assert.equal(hit, null);
  });

  it('does NOT flag a range that does not overlap the candidate number', () => {
    const hit = detectRangeAddressCollision('4550-4666 S Kirkman Rd', '5000 S Kirkman Rd');
    assert.equal(hit, null);
  });

  it('does NOT flag two identical addresses (that is an exact match, handled earlier)', () => {
    const hit = detectRangeAddressCollision('4600 S Kirkman Rd', '4600 S Kirkman Rd');
    assert.equal(hit, null, 'exact same civic number, non-range, distance 0 — not this detector\'s job');
  });

  it('does NOT flag civic numbers far apart on the same street', () => {
    const hit = detectRangeAddressCollision('2604 N Hospital Rd', '9200 N Hospital Rd');
    assert.equal(hit, null);
  });

  it('is tolerant of punctuation/spacing differences in the street remainder', () => {
    const hit = detectRangeAddressCollision('4550-4666 S. Kirkman Rd', '4600  S Kirkman Rd,');
    assert.ok(hit);
  });

  it('returns null for unparseable addresses (never throws)', () => {
    assert.equal(detectRangeAddressCollision('', '4600 S Kirkman Rd'), null);
    assert.equal(detectRangeAddressCollision(null, undefined), null);
    assert.equal(detectRangeAddressCollision('Lease Summary', '4600 S Kirkman Rd'), null);
  });
});
