// ORE Phase 1 Unit D — carry CoStar owner phone/email through to the owner write.
// Covers the two pure pieces: selectAuthoritativeOwner (now surfaces normalized
// phone/email/address on the chosen owner, guarded) and contactSeedFields (now
// emits phone/email for ORGANIZATION owner contacts, not just persons).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectAuthoritativeOwner,
  contactSeedFields,
} from '../api/_handlers/sidebar-pipeline.js';

describe('ORE Phase 1 Unit D — selectAuthoritativeOwner carries reachable details', () => {
  it('surfaces phone/email/address from the private owner contact', () => {
    const md = { contacts: [{
      role: 'owner', name: 'Acme Holdings LLC', type: 'entity',
      phones: ['(415) 555-0142'], email: 'owner@acmeholdings.com',
      address: '100 Market St, San Francisco, CA 94103',
    }] };
    const owner = selectAuthoritativeOwner(md);
    assert.equal(owner.name, 'Acme Holdings LLC');
    assert.equal(owner.phone, '(415) 555-0142');
    assert.equal(owner.email, 'owner@acmeholdings.com');
    assert.equal(owner.address, '100 Market St, San Francisco, CA 94103');
  });

  it('drops a generic/role inbox email and a malformed phone (guarded)', () => {
    const md = { contacts: [{
      role: 'owner', name: 'Generic Co LLC', type: 'entity',
      phones: ['(p)'], email: 'info@genericco.com',
    }] };
    const owner = selectAuthoritativeOwner(md);
    assert.equal(owner.name, 'Generic Co LLC');
    assert.equal(owner.phone, null);   // (p) has too few digits
    assert.equal(owner.email, null);   // info@ is a role inbox, not a person
  });

  it('picks the first VALID phone when several are present', () => {
    const md = { contacts: [{
      role: 'owner', name: 'Multi Phone LLC', type: 'entity',
      phones: ['(p)', 'ext 5', '312-768-5544'],
    }] };
    assert.equal(selectAuthoritativeOwner(md).phone, '312-768-5544');
  });

  it('prefers the private owner over a federal anti-pattern candidate', () => {
    const md = { contacts: [
      { role: 'owner', name: 'U S A', type: 'entity' },
      { role: 'owner', name: 'Private Owner LLC', type: 'entity', email: 'gm@privateowner.com' },
    ] };
    const owner = selectAuthoritativeOwner(md);
    assert.equal(owner.name, 'Private Owner LLC');
    assert.equal(owner.email, 'gm@privateowner.com');
  });

  it('a sales-history buyer fallback carries no phone/email (name only)', () => {
    const md = { contacts: [], sales_history: [
      { buyer: 'Recent Buyer LLC', sale_date: '2024-01-01', buyer_address: '5 Main St, Reno, NV' },
    ] };
    const owner = selectAuthoritativeOwner(md);
    assert.equal(owner.name, 'Recent Buyer LLC');
    assert.equal(owner.phone, null);
    assert.equal(owner.email, null);
    assert.equal(owner.address, '5 Main St, Reno, NV');
  });

  it('returns null when there is no owner candidate', () => {
    assert.equal(selectAuthoritativeOwner({ contacts: [] }), null);
  });
});

describe('ORE Phase 1 Unit D — contactSeedFields emits org phone/email', () => {
  it('an organization owner contact carries phone/email + address (the gap fix)', () => {
    const contact = {
      name: 'Acme Holdings LLC',
      email: 'owner@acmeholdings.com',
      phones: ['(415) 555-0142'],
      ownership_type: 'fee',
      address: '100 Market St, San Francisco, CA 94103',
    };
    const seed = contactSeedFields(contact, 'organization');
    assert.equal(seed.email, 'owner@acmeholdings.com');
    assert.equal(seed.phone, '(415) 555-0142');
    assert.equal(seed.org_type, 'owner');
    assert.equal(seed.address, '100 Market St');
    assert.equal(seed.city, 'San Francisco');
    assert.equal(seed.state, 'CA');
    // an org never gets person-name parts
    assert.equal(seed.first_name, undefined);
    assert.equal(seed.last_name, undefined);
  });

  it('a person contact is unchanged (phone/email/title)', () => {
    const contact = { name: 'Jane Doe', email: 'jane@x.com', phones: ['312-768-5544'], title: 'Principal' };
    const seed = contactSeedFields(contact, 'person');
    assert.equal(seed.email, 'jane@x.com');
    assert.equal(seed.phone, '312-768-5544');
    assert.equal(seed.title, 'Principal');
    assert.equal(seed.first_name, 'Jane');
    assert.equal(seed.last_name, 'Doe');
  });
});
