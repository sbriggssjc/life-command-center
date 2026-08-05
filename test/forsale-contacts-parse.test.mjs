// For-Sale/For-Lease "Contacts" panel trailing-label parser (2026-08-05).
//
// CoStar's redesigned listing Contacts panel prints each contact as a NAME/FIRM
// line followed by its ROLE-LABEL line ("Newmark" → "Sales Company",
// "Bradley Veo Timmons" → "True Owner"). The comp-oriented leading-header
// handlers mislabel the following owner as a broker. This parser reads the block
// from the preceding name so the firm and the owner each get the right role.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
await import('../extension/content/_forsale-contacts-parse.js');
const {
  parseForSaleContacts,
  mapForSaleFigures,
  trailingRoleFor,
  looksLikeContactName,
  looksLikePerson,
  isForSaleContactsUrl,
} = globalThis.__lccForSaleContacts;

// Faithful reproduction of the 3710 FM 1889 for-sale Contacts panel, as
// document.body.innerText split into trimmed lines.
const LIVE_LINES = [
  'Contacts',
  'Newmark',
  'Sales Company',
  '2601 Olive St, Suite 1600',
  'Dallas, TX 75201',
  'United States',
  '(469) 467-2000',
  'Bradley Veo Timmons',
  'True Owner',
  'The Dalles, OR 97058',
  'United States',
  '(541) 980-2057',
  'Listing ID: 41489718',
];

describe('parseForSaleContacts — trailing-label layout', () => {
  it('reads Newmark as the sales/listing broker firm', () => {
    const out = parseForSaleContacts(LIVE_LINES);
    const nm = out.find(c => c.name === 'Newmark');
    assert.ok(nm, 'Newmark captured');
    assert.equal(nm.role, 'listing_broker');
    assert.equal(nm.type, 'organization');
    assert.equal(nm.address, '2601 Olive St, Suite 1600');
    assert.equal(nm.city, 'Dallas');
    assert.equal(nm.state, 'TX');
    assert.equal(nm.phone, '(469) 467-2000');
  });

  it('reads Bradley Veo Timmons as the OWNER, not the broker', () => {
    const out = parseForSaleContacts(LIVE_LINES);
    const bradley = out.find(c => c.name === 'Bradley Veo Timmons');
    assert.ok(bradley, 'Bradley captured');
    assert.equal(bradley.role, 'owner', 'true owner must not be a broker');
    assert.equal(bradley.type, 'person');
    assert.equal(bradley.city, 'The Dalles');
    assert.equal(bradley.state, 'OR');
    assert.equal(bradley.phone, '(541) 980-2057');
    // The owner must NOT inherit the firm's phone.
    assert.notEqual(bradley.phone, '(469) 467-2000');
  });

  it('does not leak the firm block into the owner (exactly two contacts)', () => {
    const out = parseForSaleContacts(LIVE_LINES);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map(c => c.role).sort(), ['listing_broker', 'owner']);
  });

  it('maps role labels correctly', () => {
    assert.equal(trailingRoleFor('Sales Company'), 'listing_broker');
    assert.equal(trailingRoleFor('Listing Contacts'), 'listing_broker');
    assert.equal(trailingRoleFor('Buyer Broker'), 'buyer_broker');
    assert.equal(trailingRoleFor('True Owner'), 'owner');
    assert.equal(trailingRoleFor('Recorded Owner'), 'owner');
    assert.equal(trailingRoleFor('Property Manager'), 'property_manager');
    assert.equal(trailingRoleFor('Bradley Veo Timmons'), null);
  });

  it('name/person predicates behave', () => {
    assert.equal(looksLikeContactName('Newmark'), true);
    assert.equal(looksLikeContactName('Bradley Veo Timmons'), true);
    assert.equal(looksLikeContactName('United States'), false);
    assert.equal(looksLikeContactName('Sales Company'), false);   // a label is not a name
    assert.equal(looksLikeContactName('(469) 467-2000'), false);
    assert.equal(looksLikePerson('Bradley Veo Timmons'), true);
    assert.equal(looksLikePerson('Newmark'), false);
    assert.equal(looksLikePerson('Riverside Holdings LLC'), false);
  });

  it('gates on for-sale / for-lease URLs only', () => {
    assert.equal(isForSaleContactsUrl('https://product.costar.com/listings/for-sale/detail/1l4lhl7/summary'), true);
    assert.equal(isForSaleContactsUrl('https://product.costar.com/listings/for-lease/detail/x/summary'), true);
    assert.equal(isForSaleContactsUrl('https://product.costar.com/comps/detail/abc'), false);
  });

  it('returns nothing when no trailing-label block is present', () => {
    const out = parseForSaleContacts([
      'Listing Broker', 'Jane Doe', '(555) 123-4567', 'jane@brokerage.com',
    ]);
    assert.equal(out.length, 0);
  });
});

// The structured DOM path is the preferred one. These records mirror exactly
// what the costar.js DOM adapter reads from the real 3710 FM 1889 Contacts
// panel (three <figure> elements: broker person, sales-company firm, true owner).
describe('mapForSaleFigures — structured Contacts panel', () => {
  const FIGURES = [
    { name: 'Leighton Hopkins', jobTitle: 'Associate', designation: '', company: 'Newmark',
      email: 'Leighton.hopkins@nmrk.com', phones: ['(918) 845-5375', '(918) 845-5375'],
      addressLines: [] },
    { name: 'Newmark', jobTitle: '', designation: 'Sales Company', company: '',
      email: '', phones: ['(469) 467-2000'],
      addressLines: ['2601 Olive St, Suite 1600', 'Dallas, TX 75201', 'United States', ''] },
    { name: 'Bradley Veo Timmons', jobTitle: '', designation: 'True Owner', company: '',
      email: '', phones: ['(541) 980-2057'],
      addressLines: ['The Dalles, OR 97058', 'United States', '', ''] },
  ];

  it('maps the broker agent, the sales-company firm, and the true owner', () => {
    const out = mapForSaleFigures(FIGURES);
    assert.equal(out.length, 3);

    const agent = out.find(c => c.name === 'Leighton Hopkins');
    assert.equal(agent.role, 'listing_broker');
    assert.equal(agent.type, 'person');
    assert.equal(agent.email, 'Leighton.hopkins@nmrk.com');
    assert.deepEqual(agent.phones, ['(918) 845-5375']); // deduped

    const firm = out.find(c => c.name === 'Newmark');
    assert.equal(firm.role, 'listing_broker');
    assert.equal(firm.type, 'organization');
    assert.equal(firm.address, '2601 Olive St, Suite 1600');
    assert.equal(firm.city, 'Dallas');
    assert.equal(firm.state, 'TX');
    assert.equal(firm.phone, '(469) 467-2000');

    const owner = out.find(c => c.name === 'Bradley Veo Timmons');
    assert.equal(owner.role, 'owner', 'True Owner designation → owner, not broker');
    assert.equal(owner.type, 'person');
    assert.equal(owner.city, 'The Dalles');
    assert.equal(owner.state, 'OR');
    assert.equal(owner.phone, '(541) 980-2057');
    assert.equal(owner.email, undefined, 'owner has no email — broker email never bleeds in');
  });

  it('skips a figure with an unmapped designation rather than guessing', () => {
    const out = mapForSaleFigures([
      { name: 'Some Firm', designation: 'Appraiser', phones: [], addressLines: [] },
    ]);
    assert.equal(out.length, 0);
  });

  it('ignores empty/garbage figure names', () => {
    const out = mapForSaleFigures([
      { name: '', designation: 'True Owner' },
      { name: 'United States', designation: 'True Owner' },
    ]);
    assert.equal(out.length, 0);
  });
});

describe('parseForSaleContacts — no-op guard', () => {
  it('returns nothing when no trailing-label block is present', () => {
    const out = parseForSaleContacts([
      'Listing Broker', 'Jane Doe', '(555) 123-4567', 'jane@brokerage.com',
    ]);
    // "Listing Broker" heads the block here (comp layout) — the line before it
    // ("nothing") is not a name, so no trailing-label block is emitted.
    assert.equal(out.length, 0);
  });
});
