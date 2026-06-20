// R52 Unit 1 — planContactFieldPromotion / capturedFieldsFromMetadata (pure).
// Fill-blanks(+rank-upgrade), per-field provenance, company→metadata, email
// normalize, and the metadata backfill direction. No IO.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planContactFieldPromotion,
  capturedFieldsFromMetadata,
} from '../api/_shared/contact-fields.js';

describe('planContactFieldPromotion', () => {
  it('fills a blank first-class address and records the source', () => {
    const ent = { email: 'a@b.com', phone: null, address: null, metadata: {} };
    const plan = planContactFieldPromotion(ent, { address: '100 Main St', city: 'Tulsa', state: 'OK', zip: '74101' }, 'salesforce');
    assert.equal(plan.changed, true);
    assert.equal(plan.patch.address, '100 Main St');
    assert.equal(plan.patch.city, 'Tulsa');
    assert.equal(plan.patch.metadata.field_sources.address, 'salesforce');
    assert.equal(plan.patch.metadata.field_sources.zip, 'salesforce');
  });

  it('never clobbers a higher-trust value (verified beats salesforce)', () => {
    const ent = { address: '1 Verified Way', metadata: { field_sources: { address: 'verified' } } };
    const plan = planContactFieldPromotion(ent, { address: '2 SF Rd' }, 'salesforce');
    assert.equal(plan.changed, false);
    assert.equal(plan.patch.address, undefined);
  });

  it('upgrades a lower-trust value (salesforce beats capture)', () => {
    const ent = { address: '3 Capture Ln', metadata: { field_sources: { address: 'capture' } } };
    const plan = planContactFieldPromotion(ent, { address: '4 SF Blvd' }, 'salesforce');
    assert.equal(plan.changed, true);
    assert.equal(plan.patch.address, '4 SF Blvd');
    assert.equal(plan.patch.metadata.field_sources.address, 'salesforce');
  });

  it('normalizes email and skips an unchanged value', () => {
    const ent = { email: 'Geoff@Example.com', metadata: {} };
    const plan = planContactFieldPromotion(ent, { email: '  GEOFF@EXAMPLE.COM ' }, 'salesforce');
    assert.equal(plan.changed, false); // same address, just cased differently
  });

  it('company goes to metadata only (no first-class column), source recorded', () => {
    const ent = { metadata: {} };
    const plan = planContactFieldPromotion(ent, { company: 'Colliers International' }, 'capture');
    assert.equal(plan.changed, true);
    assert.equal(plan.patch.company, undefined);              // no company column
    assert.equal(plan.patch.metadata.company, 'Colliers International');
    assert.equal(plan.patch.metadata.field_sources.company, 'capture');
  });

  it('no incoming → no change', () => {
    const plan = planContactFieldPromotion({ metadata: {} }, {}, 'salesforce');
    assert.equal(plan.changed, false);
    assert.deepEqual(plan.patch, {});
  });
});

describe('capturedFieldsFromMetadata', () => {
  it('lifts the first phone and the company from captured metadata', () => {
    const ent = { metadata: { phones: ['', '(408) 459-8476', '(408) 242-1430'], company: 'Crescent Apartments LLC' } };
    const got = capturedFieldsFromMetadata(ent);
    assert.equal(got.phone, '(408) 459-8476');
    assert.equal(got.company, 'Crescent Apartments LLC');
  });

  it('returns {} when there is nothing to lift', () => {
    assert.deepEqual(capturedFieldsFromMetadata({ metadata: { website: 'x' } }), {});
    assert.deepEqual(capturedFieldsFromMetadata({}), {});
  });
});
