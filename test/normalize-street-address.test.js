import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStreetAddress,
  stripDirectionalTokens,
  leadingStreetNumber,
  splitMultiAddress,
} from '../api/_shared/normalize-street-address.js';

describe('normalizeStreetAddress', () => {
  // The three real OM↔DB pairs from the 2026-06-04 forensic. Each pair must
  // produce an identical canonical key so the matcher's equality compare hits.
  describe('real OM ↔ dia pairs (must be equal)', () => {
    const pairs = [
      ['198 N Springfield Ave', '198 North Springfield Avenue'],
      ['1809 West Chapman Avenue', '1809 W Chapman Ave'],
      ['506 N Patterson St', '506 North Patterson St'],
    ];
    for (const [om, db] of pairs) {
      it(`"${om}" === "${db}"`, () => {
        const a = normalizeStreetAddress(om);
        const b = normalizeStreetAddress(db);
        assert.equal(a, b, `${a} !== ${b}`);
        assert.ok(a.length > 0);
      });
    }
  });

  it('canonicalizes directionals to letters', () => {
    assert.equal(normalizeStreetAddress('100 North Main St'), '100 n main st');
    assert.equal(normalizeStreetAddress('100 N Main Street'), '100 n main st');
    assert.equal(normalizeStreetAddress('100 Southwest Main Blvd'), '100 sw main blvd');
    assert.equal(normalizeStreetAddress('100 SW Main Boulevard'), '100 sw main blvd');
  });

  it('canonicalizes street-type suffixes', () => {
    assert.equal(normalizeStreetAddress('5 Oak Drive'), '5 oak dr');
    assert.equal(normalizeStreetAddress('5 Oak Dr'), '5 oak dr');
    assert.equal(normalizeStreetAddress('7 Elm Road'), '7 elm rd');
    assert.equal(normalizeStreetAddress('9 Pine Parkway'), '9 pine pkwy');
  });

  it('strips unit / suite / floor designators', () => {
    assert.equal(normalizeStreetAddress('198 N Springfield Ave, FIRST FLOOR'),
      normalizeStreetAddress('198 North Springfield Avenue'));
    assert.equal(normalizeStreetAddress('1809 West Chapman Avenue STE 4'),
      normalizeStreetAddress('1809 W Chapman Ave'));
    assert.equal(normalizeStreetAddress('506 N Patterson St #B'),
      normalizeStreetAddress('506 North Patterson St'));
    assert.equal(normalizeStreetAddress('12 Market St Suite 200'),
      normalizeStreetAddress('12 Market Street'));
  });

  it('drops trailing city/state/zip after the first comma', () => {
    assert.equal(normalizeStreetAddress('37139 Highway 26, Sandy, OR 97055'), '37139 hwy 26');
  });

  it('collapses case, punctuation, and whitespace', () => {
    assert.equal(normalizeStreetAddress('  198   N.  Springfield   Ave.  '), '198 n springfield ave');
  });

  it('returns empty string for null/empty', () => {
    assert.equal(normalizeStreetAddress(null), '');
    assert.equal(normalizeStreetAddress(undefined), '');
    assert.equal(normalizeStreetAddress(''), '');
  });
});

describe('stripDirectionalTokens', () => {
  it('removes directional tokens from a normalized key', () => {
    assert.equal(stripDirectionalTokens('991 e johnstown rd'), '991 johnstown rd');
    assert.equal(stripDirectionalTokens('991 johnstown rd'), '991 johnstown rd');
    assert.equal(stripDirectionalTokens('100 sw main blvd'), '100 main blvd');
  });
  it('keeps non-directional tokens that happen to be short', () => {
    // "st" is a suffix, not a directional — must survive.
    assert.equal(stripDirectionalTokens('506 n patterson st'), '506 patterson st');
  });
});

describe('leadingStreetNumber', () => {
  it('extracts the leading house number', () => {
    assert.equal(leadingStreetNumber('198 N Springfield Ave'), '198');
    assert.equal(leadingStreetNumber('1809 West Chapman Avenue'), '1809');
  });
  it('returns null when there is no leading number', () => {
    assert.equal(leadingStreetNumber('Main Street'), null);
    assert.equal(leadingStreetNumber(null), null);
  });
});

describe('splitMultiAddress', () => {
  it('JSON-array string splits into individual addresses', () => {
    const out = splitMultiAddress('["1208 Scottsville Road", "350 Preakness Avenue"]', null);
    assert.equal(out.length, 2);
    assert.equal(out[0].address, '1208 Scottsville Road');
    assert.equal(out[1].address, '350 Preakness Avenue');
  });

  it('real array splits into individual addresses', () => {
    const out = splitMultiAddress(['1208 Scottsville Road', '350 Preakness Avenue'], null);
    assert.equal(out.length, 2);
    assert.equal(out[1].address, '350 Preakness Avenue');
  });

  it('pipe-joined string splits when parts carry street numbers', () => {
    const out = splitMultiAddress('1208 Scottsville Road | 350 Preakness Avenue', null);
    assert.equal(out.length, 2);
    assert.equal(out[0].address, '1208 Scottsville Road');
  });

  it('semicolon-joined string splits when parts carry street numbers', () => {
    const out = splitMultiAddress('1208 Scottsville Road; 350 Preakness Avenue', null);
    assert.equal(out.length, 2);
    assert.equal(out[1].address, '350 Preakness Avenue');
  });

  it('pairs parallel tenant arrays by index', () => {
    const out = splitMultiAddress(
      ['1208 Scottsville Road', '350 Preakness Avenue'],
      ['DaVita Kidney Care', 'Fresenius Medical Care']
    );
    assert.equal(out[0].tenant, 'DaVita Kidney Care');
    assert.equal(out[1].tenant, 'Fresenius Medical Care');
  });

  it('broadcasts a single tenant across all addresses', () => {
    const out = splitMultiAddress(
      ['1208 Scottsville Road', '350 Preakness Avenue'],
      'DaVita Kidney Care'
    );
    assert.equal(out[0].tenant, 'DaVita Kidney Care');
    assert.equal(out[1].tenant, 'DaVita Kidney Care');
  });

  it('single address returns a one-element list (no false split)', () => {
    const out = splitMultiAddress('198 N Springfield Ave', 'DaVita Kidney Care');
    assert.equal(out.length, 1);
    assert.equal(out[0].address, '198 N Springfield Ave');
    assert.equal(out[0].tenant, 'DaVita Kidney Care');
  });

  it('does not split a non-address semicolon string lacking street numbers', () => {
    const out = splitMultiAddress('Smith & Jones; LLC', null);
    assert.equal(out.length, 1);
  });

  it('handles null address field gracefully', () => {
    const out = splitMultiAddress(null, 'Tenant X');
    assert.equal(out.length, 1);
    assert.equal(out[0].address, '');
    assert.equal(out[0].tenant, 'Tenant X');
  });
});
