import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDocType,
  isNonDealSnapshot,
  hasFullDealSignature,
  snapshotLooksLikeListing,
  LISTING_DOCUMENT_TYPES,
} from '../api/_shared/intake-classify.js';
import { DIALYSIS_KEYWORDS } from '../api/_handlers/intake-matcher.js';

// Mirror of intake-create-property.js::pickDomainForTenant — the create-from-
// intake domain routing decision (dialysis if the tenant matches the dialysis
// operator keyword set, else government).
function pickDomainForTenant(tenant) {
  return tenant && DIALYSIS_KEYWORDS.test(tenant) ? 'dialysis' : 'government';
}

describe('normalizeDocType', () => {
  it('maps OM synonyms + typos to canonical short form', () => {
    assert.equal(normalizeDocType('offering memorandum'), 'om');
    assert.equal(normalizeDocType('OFFERRING MEMORANDUM'), 'om'); // double-r typo
    assert.equal(normalizeDocType('broker_package'), 'om');
    assert.equal(normalizeDocType('marketing brochure'), 'marketing_brochure');
    assert.equal(normalizeDocType('one-pager'), 'flyer');
  });
  it('passes non-listing types through (lowercased)', () => {
    assert.equal(normalizeDocType('email_update'), 'email_update');
    assert.equal(normalizeDocType('Comp'), 'comp');
    assert.equal(normalizeDocType('unknown'), 'unknown');
  });
});

describe('isNonDealSnapshot — auto-disposition classifier', () => {
  it('discards a no-address email_update newsletter', () => {
    assert.equal(isNonDealSnapshot({
      document_type: 'email_update', address: null,
      asking_price: null, cap_rate: null, tenant_name: null,
    }), true);
  });

  it('discards a null-doctype broker blast with only a tenant mention', () => {
    // tenant alone does NOT save it (doctrine)
    assert.equal(isNonDealSnapshot({
      document_type: 'unknown', address: null,
      asking_price: null, cap_rate: null, tenant_name: 'DaVita',
    }), true);
  });

  it('keeps an OM with address + price (not non-deal)', () => {
    assert.equal(isNonDealSnapshot({
      document_type: 'offering_memorandum',
      address: '5139 34th Ave S', asking_price: 4200000, cap_rate: 6.5,
    }), false);
  });

  it('keeps a no-address row that still carries an asking price', () => {
    assert.equal(isNonDealSnapshot({
      document_type: 'unknown', address: null, asking_price: 3000000, cap_rate: null,
    }), false);
  });

  it('keeps a no-address row whose doctype is a deal doc (comp)', () => {
    assert.equal(isNonDealSnapshot({
      document_type: 'comp', address: null, asking_price: null, cap_rate: null,
    }), false);
  });

  it('keeps a no-address row with a cap rate', () => {
    assert.equal(isNonDealSnapshot({
      document_type: 'broker_email', address: null, asking_price: null, cap_rate: 7.1,
    }), false);
  });

  it('returns false for a null snapshot (extraction failure, handled elsewhere)', () => {
    assert.equal(isNonDealSnapshot(null), false);
  });
});

describe('hasFullDealSignature — guarded AUTO-create gate', () => {
  it('true only with address + tenant + asking_price', () => {
    assert.equal(hasFullDealSignature({
      address: '100 Main St', tenant_name: 'USPS', asking_price: 5000000,
    }), true);
  });
  it('false when asking_price is missing', () => {
    assert.equal(hasFullDealSignature({
      address: '100 Main St', tenant_name: 'USPS', asking_price: null,
    }), false);
  });
  it('false when address is missing', () => {
    assert.equal(hasFullDealSignature({
      address: null, tenant_name: 'USPS', asking_price: 5000000,
    }), false);
  });
  it('accepts a multi-address (addresses[]) portfolio OM', () => {
    assert.equal(hasFullDealSignature({
      addresses: ['1 A St', '2 B St'], tenant_name: 'DaVita', asking_price: 9000000,
    }), true);
  });
});

describe('create-from-intake domain routing', () => {
  it('routes dialysis operators to the dialysis domain', () => {
    assert.equal(pickDomainForTenant('DaVita Kidney Care'), 'dialysis');
    assert.equal(pickDomainForTenant('Fresenius Medical Care'), 'dialysis');
    assert.equal(pickDomainForTenant('Bio-Medical Applications of Florida'), 'dialysis');
  });
  it('routes federal / non-dialysis tenants to the government domain', () => {
    assert.equal(pickDomainForTenant('United States Postal Service'), 'government');
    assert.equal(pickDomainForTenant('Social Security Administration'), 'government');
    assert.equal(pickDomainForTenant(null), 'government');
  });
});

describe('snapshotLooksLikeListing + LISTING_DOCUMENT_TYPES (shared source of truth)', () => {
  it('LISTING_DOCUMENT_TYPES holds the three listing doctypes', () => {
    assert.ok(LISTING_DOCUMENT_TYPES.has('om'));
    assert.ok(LISTING_DOCUMENT_TYPES.has('flyer'));
    assert.ok(LISTING_DOCUMENT_TYPES.has('marketing_brochure'));
    assert.ok(!LISTING_DOCUMENT_TYPES.has('comp'));
  });
  it('infers listing-grade from price + tenant + supporting field', () => {
    assert.equal(snapshotLooksLikeListing({
      asking_price: 4000000, tenant_name: 'DaVita', cap_rate: 6.5,
    }), true);
  });
  it('rejects a bare tenant-only snapshot', () => {
    assert.equal(snapshotLooksLikeListing({ tenant_name: 'DaVita' }), false);
  });
});
