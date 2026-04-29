import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeTenant, listCanonicalTenants } from '../api/_shared/tenant-canonical.js';

describe('canonicalizeTenant', () => {
  describe('DaVita variants', () => {
    const expected = 'DaVita Kidney Care';
    for (const variant of [
      'DaVita',
      'DaVita Kidney Care',
      'DaVita Dialysis',
      'DaVita Inc.',
      'DAVITA DIALYSIS',
      'Davita Kidney Care',
      'Davita Healthcare Partners, Inc.',
      'Da Vita',
      'davita inc',
    ]) {
      it(`${variant} → ${expected}`, () => {
        assert.equal(canonicalizeTenant(variant), expected);
      });
    }
  });

  describe('Fresenius variants', () => {
    const expected = 'Fresenius Medical Care';
    for (const variant of [
      'Fresenius',
      'Fresenius Medical Care',
      'Fresenius Kidney Care',
      'Fresenius Health Partners',
      'FRESENIUS MEDICAL CARE',
    ]) {
      it(`${variant} → ${expected}`, () => {
        assert.equal(canonicalizeTenant(variant), expected);
      });
    }
  });

  describe('US Renal Care variants', () => {
    const expected = 'U.S. Renal Care';
    for (const variant of [
      'U.S. Renal Care',
      'US Renal Care',
      'U S Renal Care',
      'us renal care',
    ]) {
      it(`${variant} → ${expected}`, () => {
        assert.equal(canonicalizeTenant(variant), expected);
      });
    }
  });

  describe('Pass-through (no false positives)', () => {
    for (const variant of [
      'Whittier Kidney Dialysis',           // not DaVita; contains "kidney" + "dialysis" but anchored ^da\s*vita\b prevents match
      'Renal South of Rome',                // not US Renal Care
      'NEPHCON Vascular Access Center',
      'Eastpoint Dialysis',
      'Cooper Nephrology',
      'Kidney Spa',
      'Reliable Health Care Inc',
    ]) {
      it(`${variant} stays unchanged`, () => {
        assert.equal(canonicalizeTenant(variant), variant);
      });
    }
  });

  describe('Edge cases', () => {
    it('null → null', () => {
      assert.equal(canonicalizeTenant(null), null);
    });
    it('undefined → undefined', () => {
      assert.equal(canonicalizeTenant(undefined), undefined);
    });
    it('non-string → returned unchanged', () => {
      assert.equal(canonicalizeTenant(42), 42);
    });
    it('empty string → empty string', () => {
      assert.equal(canonicalizeTenant(''), '');
    });
    it('whitespace-only → empty', () => {
      assert.equal(canonicalizeTenant('   '), '');
    });
    it('trims surrounding whitespace before matching', () => {
      assert.equal(canonicalizeTenant('  DaVita Inc.  '), 'DaVita Kidney Care');
    });
  });

  describe('listCanonicalTenants', () => {
    it('returns the canonical names', () => {
      const list = listCanonicalTenants();
      assert.ok(list.includes('DaVita Kidney Care'));
      assert.ok(list.includes('Fresenius Medical Care'));
      assert.ok(list.includes('U.S. Renal Care'));
    });
  });
});
