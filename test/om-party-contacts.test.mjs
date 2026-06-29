// ORE Phase 1 Unit E — OM party-contact collection (seller / buyer / owner).
// Pure, value-gated, no-fabrication. The promoter writer (promoteOmPartyContacts)
// does the DB work; this proves the gate that decides WHAT becomes a contact.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'k';
process.env.DIA_SUPABASE_URL = 'https://dia.test.local';
process.env.DIA_SUPABASE_KEY = 'k';
process.env.GOV_SUPABASE_URL = 'https://gov.test.local';
process.env.GOV_SUPABASE_KEY = 'k';

import { collectOmPartyContacts } from '../api/_handlers/intake-promoter.js';

describe('collectOmPartyContacts (ORE Phase 1 Unit E)', () => {
  it('surfaces a seller with a name + contact details', () => {
    const out = collectOmPartyContacts({
      seller_name: 'Oldsmar Retail Development LLC',
      seller_email: 'asset@oldsmar.com',
      seller_phone: '813-555-0100',
      seller_address: '500 N Westshore Blvd, Tampa, FL 33609',
    });
    const seller = out.find(p => p.role === 'seller');
    assert.ok(seller, 'seller present');
    assert.equal(seller.contact_type, 'seller');
    assert.equal(seller.email, 'asset@oldsmar.com');
    assert.equal(seller.phone, '813-555-0100');
    assert.equal(seller.address, '500 N Westshore Blvd, Tampa, FL 33609');
  });

  it('surfaces buyer + owner when each has a name and a detail', () => {
    const out = collectOmPartyContacts({
      buyer_name: 'Deltona Wellness LP', buyer_email: 'acq@deltona.com',
      owner_contact_name: 'Jane Principal', owner_contact_phone: '305-555-7777',
    });
    assert.ok(out.find(p => p.role === 'buyer' && p.email === 'acq@deltona.com'));
    const owner = out.find(p => p.role === 'owner');
    assert.ok(owner && owner.phone === '305-555-7777');
    assert.equal(owner.address, null); // owner has no address field in the schema
  });

  it('VALUE GATE: a bare name with no email/phone/address is excluded (no noise)', () => {
    // seller_name flows to ownership resolution + the listing already; without a
    // contact detail there is nothing new to write as a contact.
    const out = collectOmPartyContacts({ seller_name: 'ABC Holdings LLC' });
    assert.equal(out.length, 0);
  });

  it('does NOT fabricate — absent fields produce no party', () => {
    assert.deepEqual(collectOmPartyContacts({}), []);
    assert.deepEqual(collectOmPartyContacts(null), []);
    // whitespace-only contact detail is treated as absent
    assert.deepEqual(
      collectOmPartyContacts({ seller_name: 'X LLC', seller_email: '   ', seller_phone: '', seller_address: null }),
      []
    );
  });

  it('unwraps array-shaped snapshot values (firstOf)', () => {
    const out = collectOmPartyContacts({
      seller_name: ['First Seller LLC', 'Second'],
      seller_email: ['a@x.com'],
    });
    const seller = out.find(p => p.role === 'seller');
    assert.equal(seller.name, 'First Seller LLC');
    assert.equal(seller.email, 'a@x.com');
  });

  it('a name with phone OR address only (no email) still qualifies', () => {
    assert.equal(collectOmPartyContacts({ seller_name: 'X LLC', seller_phone: '212-555-1' }).length, 1);
    assert.equal(collectOmPartyContacts({ seller_name: 'X LLC', seller_address: '1 Main St' }).length, 1);
  });
});
