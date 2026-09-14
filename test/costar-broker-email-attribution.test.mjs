// Broker-email-attribution guard (2026-08-05).
//
// CoStar's for-sale detail page renders the listing-broker contact card
// adjacent to the owner panel, so the DOM's nearest-mailto/nearest-tel
// enrichment can splatter the listing broker's reachable details across the
// "Current Owner" rows. Live report (3710 FM 1889, Robstown TX): a Newmark
// broker's `Leighton.hopkins@nmrk.com` email + phone attributed to three
// separate "Current Owner" contacts. An owner is never reachable at a brokerage
// inbox — the sidebar pipeline must (a) never write a broker person as a
// recorded owner and (b) never carry a broker's email/phone onto an owner
// record or address observation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectAuthoritativeOwner,
  collectOwnerAddressObservations,
} from '../api/_handlers/sidebar-pipeline.js';

// Faithful reproduction of the reported capture: a listing broker whose email
// bled onto three "owner" rows (two of which are the brokerage itself).
const BROKER_EMAIL = 'leighton.hopkins@nmrk.com';
const BROKER_PHONE = '(918) 845-5375';
function liveMetadata() {
  return {
    contacts: [
      { role: 'listing_broker', name: 'Leighton Hopkins', type: 'person',
        email: 'Leighton.hopkins@nmrk.com', phones: ['(918) 845-5375'] },
      { role: 'owner', name: 'Leighton Hopkins', type: 'person',
        email: 'Leighton.hopkins@nmrk.com', phones: ['(918) 845-5375'],
        address: 'The Dalles, OR 97058' },
      { role: 'owner', name: 'Associate', type: 'person',
        email: 'Leighton.hopkins@nmrk.com', address: 'The Dalles, OR 97058' },
      { role: 'owner', name: 'Newmark', type: 'organization',
        email: 'Leighton.hopkins@nmrk.com', address: 'The Dalles, OR 97058' },
    ],
  };
}

describe('CoStar broker-email attribution guard', () => {
  it('does not select a broker-emailed contact as the authoritative owner', () => {
    const owner = selectAuthoritativeOwner(liveMetadata());
    // Every "owner" row in the live capture carries the broker's email, so no
    // legitimate owner survives — better null than a broker written as owner.
    assert.equal(owner, null);
  });

  it('drops an owner row that carries the captured broker email outright', () => {
    // An "owner" row whose email exactly matches a captured listing-broker
    // contact is the broker-card DOM bleed, not a real owner — even with an
    // LLC-looking name, so it must not be written as a recorded owner.
    const md = {
      contacts: [
        { role: 'listing_broker', name: 'Leighton Hopkins', type: 'person',
          email: BROKER_EMAIL, phones: [BROKER_PHONE] },
        { role: 'owner', name: 'Riverside Dialysis Holdings LLC', type: 'entity',
          email: BROKER_EMAIL, phones: [BROKER_PHONE],
          address: '3710 FM 1889, Robstown, TX 78380' },
      ],
    };
    assert.equal(selectAuthoritativeOwner(md), null);
  });

  it('drops a brokerage-inbox-domain email even with no matching broker contact', () => {
    // Fallback net: the leaked email survives on the owner row but the broker
    // contact carried no email of its own, so the cross-reference set is empty.
    const md = {
      contacts: [
        { role: 'owner', name: 'Acme Property Owner LLC', type: 'entity',
          email: 'someone@cbre.com', address: '1 Main St, Dallas, TX 75201' },
      ],
    };
    const owner = selectAuthoritativeOwner(md);
    assert.equal(owner.name, 'Acme Property Owner LLC');
    assert.equal(owner.email, null, 'brokerage-domain email must not attach to owner');
  });

  it('keeps a genuine owner email/phone untouched', () => {
    const md = {
      contacts: [
        { role: 'listing_broker', name: 'Leighton Hopkins', type: 'person',
          email: BROKER_EMAIL, phones: [BROKER_PHONE] },
        { role: 'owner', name: 'Real Owner LLC', type: 'entity',
          email: 'jane@realowner.com', phones: ['(214) 555-0100'],
          address: '9 Owner Way, Austin, TX 78701' },
      ],
    };
    const owner = selectAuthoritativeOwner(md);
    assert.equal(owner.email, 'jane@realowner.com');
    assert.equal(owner.phone, '(214) 555-0100');
  });

  it('does not seed an owner-address observation from a broker-attributed owner', () => {
    const obs = collectOwnerAddressObservations(liveMetadata());
    // None of the broker-attributed "owner" rows should contribute an address.
    assert.equal(obs.length, 0);
  });
});
