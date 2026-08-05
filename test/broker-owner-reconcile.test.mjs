// Broker→owner mis-attribution guard (extension side, 2026-08-05).
//
// CoStar's for-sale summary renders the listing-broker card adjacent to the
// owner panel, so the DOM/text extractors slot the broker's email/phone (and
// the broker person itself) into the "Current Owner" rows. Live capture
// (3710 FM 1889, Robstown TX): a Newmark broker's leighton.hopkins@nmrk.com
// email attributed to three owner rows, so the sidebar showed the broker as the
// owner. The reconcile pass runs on the assembled contacts[] before they are
// sent, so BOTH the sidebar display and the ingested capture are corrected.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
await import('../extension/content/_broker-owner-reconcile.js');
const { reconcileBrokerOwnerAttribution } = globalThis.__lccBrokerOwnerReconcile;

const BROKER_EMAIL = 'Leighton.hopkins@nmrk.com';
const BROKER_PHONE = '(918) 845-5375';

// Faithful reproduction of the reported scrambled capture.
function liveContacts() {
  return [
    { role: 'listing_broker', name: 'Bradley Veo Timmons', type: 'person',
      email: BROKER_EMAIL, phones: [BROKER_PHONE] },
    { role: 'owner', name: 'Leighton Hopkins', type: 'person',
      email: BROKER_EMAIL, phones: [BROKER_PHONE], address: 'The Dalles, OR 97058' },
    { role: 'owner', name: 'Associate', type: 'person',
      email: BROKER_EMAIL, address: 'The Dalles, OR 97058' },
    { role: 'owner', name: 'Newmark', type: 'organization',
      email: BROKER_EMAIL, address: 'The Dalles, OR 97058' },
  ];
}

describe('reconcileBrokerOwnerAttribution', () => {
  it('drops every owner row that carries the captured broker email', () => {
    const out = reconcileBrokerOwnerAttribution(liveContacts());
    const owners = out.filter(c => c.role === 'owner');
    assert.equal(owners.length, 0, 'no broker-attributed owner survives');
    // The genuine listing-broker row is untouched.
    const brokers = out.filter(c => c.role === 'listing_broker');
    assert.equal(brokers.length, 1);
    assert.equal(brokers[0].email, BROKER_EMAIL);
  });

  it('drops an owner on a brokerage-domain email even without a broker contact', () => {
    const out = reconcileBrokerOwnerAttribution([
      { role: 'owner', name: 'Somebody', type: 'person', email: 'x@cbre.com' },
    ]);
    assert.equal(out.length, 0);
  });

  it('keeps a real owner but strips a leaked broker phone', () => {
    const out = reconcileBrokerOwnerAttribution([
      { role: 'listing_broker', name: 'Leighton Hopkins', type: 'person',
        email: BROKER_EMAIL, phones: [BROKER_PHONE] },
      { role: 'owner', name: 'Riverside Holdings LLC', type: 'entity',
        email: 'contact@riverside.com', phones: [BROKER_PHONE, '(214) 555-0100'],
        address: '9 Owner Way, Austin, TX 78701' },
    ]);
    const owner = out.find(c => c.role === 'owner');
    assert.ok(owner, 'owner with its own identity is kept');
    assert.equal(owner.email, 'contact@riverside.com');
    assert.deepEqual(owner.phones, ['(214) 555-0100'], 'broker phone stripped, own phone kept');
  });

  it('leaves a genuine owner (own email/phone) untouched', () => {
    const input = [
      { role: 'listing_broker', name: 'Leighton Hopkins', type: 'person',
        email: BROKER_EMAIL, phones: [BROKER_PHONE] },
      { role: 'owner', name: 'Real Owner LLC', type: 'entity',
        email: 'jane@realowner.com', phones: ['(512) 555-0199'],
        address: '1 Real St, Austin, TX 78701' },
    ];
    const out = reconcileBrokerOwnerAttribution(input);
    const owner = out.find(c => c.role === 'owner');
    assert.equal(owner.email, 'jane@realowner.com');
    assert.deepEqual(owner.phones, ['(512) 555-0199']);
  });

  it('does not touch a contact that has both broker and owner roles', () => {
    // mergeContacts collapses a dual-role person; the representative-role picker
    // in costar.js ranks broker above owner, so leave it alone here.
    const input = [
      { roles: ['listing_broker', 'owner'], role: 'listing_broker',
        name: 'Leighton Hopkins', type: 'person', email: BROKER_EMAIL, phones: [BROKER_PHONE] },
    ];
    const out = reconcileBrokerOwnerAttribution(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].email, BROKER_EMAIL);
  });
});
