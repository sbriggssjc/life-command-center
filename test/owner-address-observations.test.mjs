// ORE Option A Unit 2 — collectOwnerAddressObservations: capture EVERY owner
// address surface in the payload (never collapse), guarded, no fabrication.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectOwnerAddressObservations } from '../api/_handlers/sidebar-pipeline.js';

describe('ORE Option A — collectOwnerAddressObservations', () => {
  it('emits a distinct observation per address-bearing surface (never collapsed)', () => {
    const md = {
      contacts: [
        { role: 'owner', name: 'Acme Holdings LLC', address: '100 Owner Panel Blvd, Reston, VA' },
        { role: 'true_buyer', name: 'Beneficial Parent LP', address: '200 Contacts Tab Ave, Denver, CO' },
        { role: 'listing_broker', name: 'CBRE', address: '999 Broker Row' }, // brokers excluded
      ],
      sales_history: [
        { buyer: 'Sale Buyer LLC', buyer_address: '300 Sales Comp St, Austin, TX',
          seller: 'Sale Seller LLC', seller_address: '400 Seller Rd, Miami, FL' },
      ],
    };
    const obs = collectOwnerAddressObservations(md);
    const surfaces = obs.map(o => o.surface).sort();
    assert.deepEqual(surfaces, ['costar_contacts', 'costar_owner_panel', 'sales_comp_contact', 'sales_comp_contact']);
    const panel = obs.find(o => o.surface === 'costar_owner_panel');
    assert.equal(panel.owner_name, 'Acme Holdings LLC');
    assert.equal(panel.address, '100 Owner Panel Blvd, Reston, VA');
    assert.equal(panel.kind, 'notice');
    // both sale parties captured under their OWN names (not collapsed to one)
    const buyers = obs.filter(o => o.surface === 'sales_comp_contact').map(o => o.owner_name).sort();
    assert.deepEqual(buyers, ['Sale Buyer LLC', 'Sale Seller LLC']);
    // broker never contributes an owner address
    assert.ok(!obs.some(o => o.owner_name === 'CBRE'));
  });

  it('guards federal anti-pattern + junk owner names (no address on a garbage owner)', () => {
    const md = {
      contacts: [
        { role: 'owner', name: 'U S A', address: '1 Federal Plaza' },              // federal anti-pattern
        { role: 'owner', name: 'Seller Contacts(916) 768-5544 (p)', address: '5 Junk Ln' }, // structural junk
        { role: 'owner', name: 'Legit Owner LLC', address: '7 Real St, Reno, NV' },
      ],
    };
    const obs = collectOwnerAddressObservations(md);
    assert.equal(obs.length, 1);
    assert.equal(obs[0].owner_name, 'Legit Owner LLC');
  });

  it('never fabricates — a contact with a name but no address yields nothing', () => {
    const md = { contacts: [{ role: 'owner', name: 'No Address LLC' }], sales_history: [{ buyer: 'B' }] };
    assert.deepEqual(collectOwnerAddressObservations(md), []);
  });

  it('empty / missing payload → []', () => {
    assert.deepEqual(collectOwnerAddressObservations({}), []);
    assert.deepEqual(collectOwnerAddressObservations(null), []);
  });
});
