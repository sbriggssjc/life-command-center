import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDocType,
  isNonDealSnapshot,
  hasFullDealSignature,
  snapshotLooksLikeListing,
  LISTING_DOCUMENT_TYPES,
  classifyStagedIntake,
  INTAKE_NOISE_DOCTYPES,
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

describe('classifyStagedIntake — Decision-Center create-lane klass', () => {
  it('an unmatched OM with content → create_candidate (the genuine create set)', () => {
    const r = classifyStagedIntake({
      document_type: 'om', match_status: 'unmatched',
      address: '2860 US-83', tenant_name: 'Davita dialysis', asking_price: '4390000',
    });
    assert.equal(r.klass, 'create_candidate');
    assert.equal(r.doctype, 'om');
    assert.equal(r.address, '2860 US-83');
    assert.equal(r.tenant, 'Davita dialysis');
    assert.equal(r.asking_price, 4390000);  // projected from the string
    assert.equal(r.has_content, true);
  });

  it('normalizes a long-form doctype before the listing check', () => {
    const r = classifyStagedIntake({
      document_type: 'offering memorandum', match_status: 'unmatched',
      address: '100 N. Seventh Ave', asking_price: 8047375,
    });
    assert.equal(r.doctype, 'om');               // alias → canonical
    assert.equal(r.klass, 'create_candidate');
  });

  it('a matched row (any doctype) → matched, never create', () => {
    const r = classifyStagedIntake({
      document_type: 'om', match_status: 'matched',
      match_domain: 'dia', match_property_id: '24703',
      address: '654 SR 75', tenant_name: 'Dollar General', asking_price: 1318324,
    });
    assert.equal(r.klass, 'matched');
    assert.equal(r.match_domain, 'dia');
    assert.equal(r.match_property_id, '24703');
  });

  it('a matched broker_email still classifies matched (matched wins over doctype)', () => {
    const r = classifyStagedIntake({
      document_type: 'broker_email', match_status: 'matched',
      match_domain: 'lcc', match_property_id: 'ff1fe4ed-9004-498e-b264-95e56b877c9e',
      address: '50 Taylor Avenue',
    });
    assert.equal(r.klass, 'matched');
  });

  it('an unmatched email_update → noise (market intel, excluded from create lane)', () => {
    const r = classifyStagedIntake({
      document_type: 'email_update', match_status: 'unmatched',
      address: '100 Midland Ave',
    });
    assert.equal(r.klass, 'noise');
    assert.ok(INTAKE_NOISE_DOCTYPES.has('email_update'));
    assert.ok(INTAKE_NOISE_DOCTYPES.has('comp'));
  });

  it('an unmatched comp → noise (a comp is not a property to create)', () => {
    const r = classifyStagedIntake({
      document_type: 'comp', match_status: 'unmatched', address: '1 Main St',
    });
    assert.equal(r.klass, 'noise');
  });

  it('no address AND no tenant AND no price → no_data (auto-retire), whatever the match_status', () => {
    assert.equal(classifyStagedIntake({ document_type: 'comp', match_status: 'no_data' }).klass, 'no_data');
    assert.equal(classifyStagedIntake({ document_type: null, match_status: null }).klass, 'no_data');
    assert.equal(classifyStagedIntake({ document_type: 'email_update', match_status: 'unmatched',
      address: '', tenant_name: null, asking_price: '0' }).klass, 'no_data');
  });

  it('unmatched, has content, unknown doctype → other (workable but not the default create set)', () => {
    const r = classifyStagedIntake({
      document_type: 'unknown', match_status: 'unmatched',
      tenant_name: 'DaVita Inc.', asking_price: 3760000,
    });
    assert.equal(r.klass, 'other');
    assert.equal(r.has_content, true);
  });

  it('the create-candidate set EXCLUDES matched, noise, and no_data', () => {
    const rows = [
      { document_type: 'om', match_status: 'unmatched', address: 'A', asking_price: 1 },     // create
      { document_type: 'om', match_status: 'matched', address: 'B', asking_price: 1 },        // matched
      { document_type: 'email_update', match_status: 'unmatched', address: 'C' },             // noise
      { document_type: 'om', match_status: 'unmatched' },                                     // no_data (no content)
    ];
    const created = rows.map((r) => classifyStagedIntake(r).klass).filter((k) => k === 'create_candidate');
    assert.equal(created.length, 1);
  });
});
