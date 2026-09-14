import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findContactOfficeAddressBleed } from '../api/_shared/contact-address-bleed-guard.js';

describe('ADDR1 findContactOfficeAddressBleed', () => {
  it('flags a contact whose own office street matches the property street at a DIFFERENT city/state (37491/9893 shape)', () => {
    const hit = findContactOfficeAddressBleed(
      '680 Newport Center Dr',
      'Wisconsin Dells',
      'WI',
      [
        { name: 'Aron Cline', role: 'listing_broker', address: null, city: null, state: null },
        {
          name: 'SRS Capital Markets',
          role: 'listing_broker',
          address: '680 Newport Center Dr',
          city: 'Newport Beach',
          state: 'CA',
        },
      ],
    );
    assert.ok(hit, 'expected the bleed to be detected');
    assert.equal(hit.name, 'SRS Capital Markets');
    assert.equal(hit.city, 'Newport Beach');
  });

  it('reproduces the gov J.P. Morgan / Raton NM live instance', () => {
    const hit = findContactOfficeAddressBleed(
      '245 Park Ave',
      'Raton',
      'NM',
      [{ name: 'J.P. Morgan Asset Management', address: '245 Park Ave', city: 'New York', state: 'NY' }],
    );
    assert.ok(hit);
    assert.equal(hit.state, 'NY');
  });

  it('is case/whitespace-insensitive on the street', () => {
    const hit = findContactOfficeAddressBleed(
      '  680  NEWPORT   Center Dr ',
      'Wisconsin Dells',
      'WI',
      [{ name: 'SRS', address: '680 newport center dr', city: 'Newport Beach', state: 'CA' }],
    );
    assert.ok(hit);
  });

  it('a role does not gate the detector — a "buyer"-role contact still flags (IRA Capital / Kokomo shape)', () => {
    const hit = findContactOfficeAddressBleed(
      '3121 Michelson Dr, Suite 500',
      'Kokomo',
      'IN',
      [{ name: 'IRA Capital, LLC', role: 'buyer', address: '3121 Michelson Dr, Suite 500', city: 'Irvine', state: 'CA' }],
    );
    assert.ok(hit);
  });

  it('does NOT flag a contact at the SAME address with the SAME city/state — an owner genuinely at the property', () => {
    const hit = findContactOfficeAddressBleed(
      '14134 Nephron Ln',
      'Hudson',
      'FL',
      [{ name: 'MK Acharya, MD', role: 'seller', address: '14134 Nephron Ln', city: 'Hudson', state: 'FL' }],
    );
    assert.equal(hit, null);
  });

  it('does NOT flag when the contact has no city/state on file — never guess', () => {
    const hit = findContactOfficeAddressBleed(
      '680 Newport Center Dr',
      'Wisconsin Dells',
      'WI',
      [{ name: 'Aron Cline', role: 'listing_broker', address: '680 Newport Center Dr', city: null, state: null }],
    );
    assert.equal(hit, null);
  });

  it('does NOT flag when the STREET text differs (even if similar)', () => {
    const hit = findContactOfficeAddressBleed(
      '680 Newport Center Dr',
      'Wisconsin Dells',
      'WI',
      [{ name: 'SRS', address: '681 Newport Center Dr', city: 'Newport Beach', state: 'CA' }],
    );
    assert.equal(hit, null);
  });

  it('handles null/undefined property address, city, state and empty contacts without throwing', () => {
    assert.equal(findContactOfficeAddressBleed(null, null, null, null), null);
    assert.equal(findContactOfficeAddressBleed(undefined, undefined, undefined, []), null);
    assert.equal(findContactOfficeAddressBleed('123 Main St', 'Denver', 'CO', undefined), null);
  });

  it('rejects a too-short street match as noise, not evidence', () => {
    const hit = findContactOfficeAddressBleed('1 St', 'X', 'CA', [{ name: 'A', address: '1 St', city: 'Y', state: 'NY' }]);
    assert.equal(hit, null);
  });

  it('scans multiple contacts and returns the FIRST genuine bleed', () => {
    const hit = findContactOfficeAddressBleed(
      '245 Park Ave',
      'Raton',
      'NM',
      [
        { name: 'No Address', address: null },
        { name: 'Same City', address: '245 Park Ave', city: 'Raton', state: 'NM' }, // not a mismatch — skipped
        { name: 'J.P. Morgan Asset Management', address: '245 Park Ave', city: 'New York', state: 'NY' },
      ],
    );
    assert.ok(hit);
    assert.equal(hit.name, 'J.P. Morgan Asset Management');
  });
});
