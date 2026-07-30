// W3.5 — Listing-BD consumer (audit 3.4.2).
//
// The listing_bd_trigger producer fanned ~1,080 runs/14d of matched-contact
// inbox_items to the operator, while the T-011/T-012 templates it feeds had 0
// sends in 120 days: a producer with no consumer. These tests cover the named
// consumer:
//   • dedupeListingBdItemsByContact — cross-listing dedupe (one draft per
//     contact across a 7-day window, not one per matched listing).
//   • buildListingBdContext — nested template context from inbox metadata.
//   • runListingBdDraftConsumer — generates one draft + one template_sends row
//     (replied=null) per deduped contact and triages the drained inbox items.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeListingBdItemsByContact,
  buildListingBdContext,
  runListingBdDraftConsumer
} from '../api/_shared/listing-bd.js';

const originalFetch = global.fetch;

function jsonResponse(body) {
  return {
    ok: true, status: 200,
    headers: { get(n) { return n.toLowerCase() === 'content-range' ? '0-0/1' : null; } },
    async text() { return JSON.stringify(body); }
  };
}

// Build a listing_bd_trigger inbox item.
function lbItem({ id, contactId, contactEmail, contactName, listingId, listingName,
                  state = 'OK', city = 'Tulsa', template = 'T-011', generatedAt }) {
  return {
    id,
    source_type: 'listing_bd_trigger',
    status: 'new',
    entity_id: contactId || null,
    entity_name: contactName || null,
    domain: 'dia',
    received_at: generatedAt || '2026-07-20T00:00:00Z',
    metadata: {
      template_id: template,
      match_reason: template === 'T-011' ? 'same_asset_type_state' : 'geographic_proximity',
      listing_entity_id: listingId,
      listing_name: listingName,
      listing_state: state,
      listing_city: city,
      listing_asset_type: 'dialysis',
      contact_name: contactName,
      contact_email: contactEmail || null,
      contact_state: state,
      contact_city: city,
      generated_at: generatedAt || '2026-07-20T00:00:00Z'
    }
  };
}

describe('dedupeListingBdItemsByContact — cross-listing dedupe (Part 3)', () => {
  it('a contact matched by 3 listings in a 7-day window gets ONE group covering all three', () => {
    const items = [
      lbItem({ id: 'i1', contactId: 'c1', contactName: 'Acme LLC', listingId: 'L1', listingName: 'Listing 1', generatedAt: '2026-07-20T00:00:00Z' }),
      lbItem({ id: 'i2', contactId: 'c1', contactName: 'Acme LLC', listingId: 'L2', listingName: 'Listing 2', generatedAt: '2026-07-21T00:00:00Z' }),
      lbItem({ id: 'i3', contactId: 'c1', contactName: 'Acme LLC', listingId: 'L3', listingName: 'Listing 3', generatedAt: '2026-07-22T00:00:00Z' }),
    ];
    const groups = dedupeListingBdItemsByContact(items, { windowDays: 7 });
    assert.equal(groups.length, 1, 'one contact → one draft group');
    assert.equal(groups[0].items.length, 3, 'all three matched items collapse into the group');
    assert.equal(groups[0].listings.length, 3, 'the draft covers all three distinct listings');
    assert.equal(groups[0].contactId, 'c1');
  });

  it('a match older than the window starts a SEPARATE group (honest window boundary)', () => {
    const items = [
      lbItem({ id: 'i1', contactId: 'c1', contactName: 'Acme LLC', listingId: 'L1', generatedAt: '2026-07-22T00:00:00Z' }),
      lbItem({ id: 'i2', contactId: 'c1', contactName: 'Acme LLC', listingId: 'L2', generatedAt: '2026-07-21T00:00:00Z' }),
      // 10 days older than the anchor → outside the 7-day window
      lbItem({ id: 'i3', contactId: 'c1', contactName: 'Acme LLC', listingId: 'L3', generatedAt: '2026-07-10T00:00:00Z' }),
    ];
    const groups = dedupeListingBdItemsByContact(items, { windowDays: 7 });
    assert.equal(groups.length, 2, 'two windows → two groups');
    const sizes = groups.map(g => g.items.length).sort();
    assert.deepEqual(sizes, [1, 2]);
  });

  it('two different contacts never merge; T-011 wins over T-012 as the group template', () => {
    const items = [
      lbItem({ id: 'i1', contactId: 'c1', contactName: 'Acme', listingId: 'L1', template: 'T-012' }),
      lbItem({ id: 'i2', contactId: 'c1', contactName: 'Acme', listingId: 'L2', template: 'T-011' }),
      lbItem({ id: 'i3', contactId: 'c2', contactName: 'Beta', listingId: 'L1', template: 'T-012' }),
    ];
    const groups = dedupeListingBdItemsByContact(items, { windowDays: 7 });
    assert.equal(groups.length, 2);
    const acme = groups.find(g => g.contactId === 'c1');
    assert.equal(acme.templateId, 'T-011', 'a same-asset match makes the group T-011');
    const beta = groups.find(g => g.contactId === 'c2');
    assert.equal(beta.templateId, 'T-012');
  });

  it('falls back to a normalized email when there is no entity_id, and skips items with neither', () => {
    const items = [
      lbItem({ id: 'i1', contactId: null, contactEmail: 'Owner@Example.com', contactName: 'Owner', listingId: 'L1' }),
      lbItem({ id: 'i2', contactId: null, contactEmail: 'owner@example.com', contactName: 'Owner', listingId: 'L2' }),
      { id: 'i3', source_type: 'listing_bd_trigger', status: 'new', metadata: { listing_entity_id: 'L9' } }, // no contact
      { id: 'i4', source_type: 'flagged_email', status: 'new', entity_id: 'c9', metadata: {} },            // wrong source
    ];
    const groups = dedupeListingBdItemsByContact(items, { windowDays: 7 });
    assert.equal(groups.length, 1, 'same email (case-insensitive) collapses; contactless + wrong-source dropped');
    assert.equal(groups[0].items.length, 2);
  });
});

describe('buildListingBdContext', () => {
  it('builds the nested template context and enriches from the listing entity', () => {
    const group = dedupeListingBdItemsByContact(
      [lbItem({ id: 'i1', contactId: 'c1', contactName: 'Acme Health LLC', listingId: 'L1', listingName: 'Tulsa Clinic', state: 'OK', city: 'Tulsa' })],
      {})[0];
    const listingEntity = { id: 'L1', metadata: { asking_price: 5200000, cap_rate: 0.0725, building_name: 'Tulsa Clinic' } };
    const ctx = buildListingBdContext(group, listingEntity);
    assert.equal(ctx.contact.full_name, 'Acme Health LLC');
    assert.equal(ctx.contact.first_name, 'Acme');
    assert.equal(ctx.listing.city_state, 'Tulsa, OK');
    assert.equal(ctx.listing.list_price, '$5,200,000', 'numeric price is formatted with $ + commas');
    // Bare number — the T-011/T-012 templates append the literal '%' themselves.
    assert.equal(ctx.listing.cap_rate, '7.25', 'decimal cap rate → bare percentage number');
    assert.equal(ctx.domain, 'dia');
  });

  it('enumerates the other listings when a contact matched more than one', () => {
    const group = dedupeListingBdItemsByContact([
      lbItem({ id: 'i1', contactId: 'c1', contactName: 'Acme', listingId: 'L1', listingName: 'One' }),
      lbItem({ id: 'i2', contactId: 'c1', contactName: 'Acme', listingId: 'L2', listingName: 'Two' }),
    ], {})[0];
    const ctx = buildListingBdContext(group, null);
    assert.equal(ctx.listing.additional_count, 1);
    assert.equal(ctx.listing.additional_listings.length, 1);
  });
});

describe('runListingBdDraftConsumer — draft + template_sends + triage (Parts 2, 3, 5)', () => {
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; });

  function installMock(state) {
    global.fetch = async (url, opts) => {
      const u = String(url); const method = opts?.method || 'GET';
      if (u.includes('/entities?') && method === 'GET') {
        return jsonResponse([{ id: 'L1', name: 'Tulsa Clinic', metadata: { asking_price: 5000000, cap_rate: 0.07 } }]);
      }
      if (u.includes('template_definitions') && method === 'GET') {
        return jsonResponse([{
          template_id: 'T-011', template_version: 1, name: 'Listing BD', category: 'listing_bd',
          domain: null,
          mandatory_variables: ['contact.full_name', 'listing.tenant', 'listing.city_state'],
          optional_variables: ['listing.cap_rate', 'listing.list_price'],
          subject_template: '{{listing.city_state}} {{listing.tenant}} — New Listing',
          body_template: '{{contact.first_name}}, we listed {{listing.tenant}} in {{listing.city_state}}. Cap {{listing.cap_rate}}.'
        }]);
      }
      if (u.includes('template_sends') && method === 'POST') {
        const body = JSON.parse(opts.body);
        state.sends.push(body);
        return jsonResponse([{ id: 'send-' + state.sends.length, ...body }]);
      }
      if (u.includes('signals') && method === 'POST') { state.signals++; return jsonResponse([{ id: 'sig' }]); }
      if (u.includes('inbox_items') && method === 'PATCH') {
        state.patches.push({ url: u, body: JSON.parse(opts.body) });
        return jsonResponse([{ id: 'ok' }]);
      }
      throw new Error('unexpected fetch ' + method + ' ' + u);
    };
  }

  it('one deduped contact → one draft, one template_sends (replied=null), N items triaged', async () => {
    const state = { sends: [], signals: 0, patches: [] };
    installMock(state);

    const items = [
      lbItem({ id: 'i1', contactId: 'c1', contactName: 'Acme LLC', listingId: 'L1', listingName: 'Tulsa Clinic', generatedAt: '2026-07-20T00:00:00Z' }),
      lbItem({ id: 'i2', contactId: 'c1', contactName: 'Acme LLC', listingId: 'L1', listingName: 'Tulsa Clinic', generatedAt: '2026-07-21T00:00:00Z' }),
    ];
    const out = await runListingBdDraftConsumer({ inboxItems: items, workspaceId: 'ws1', userId: 'u1' });

    assert.equal(out.ok, true);
    assert.equal(out.deduped_contacts, 1, 'both items collapse to one contact');
    assert.equal(out.drafted, 1, 'exactly one draft for the contact');
    // Honest count: ONE send per drafted contact, not one per matched row.
    assert.equal(out.sends_recorded, 1);
    assert.equal(state.sends.length, 1);
    assert.strictEqual(state.sends[0].replied, null, 'send opens as "not yet observed" (null), not false');
    assert.equal(state.sends[0].entity_id, 'c1');
    assert.equal(state.sends[0].contact_id, 'c1');
    // Both inbox items are triaged (drained) and tagged reversibly.
    assert.equal(out.items_triaged, 2);
    assert.equal(state.patches.length, 2);
    assert.equal(state.patches[0].body.status, 'triaged');
    assert.equal(state.patches[0].body.metadata.listing_bd_drafted, true);
    // The rendered draft resolved the contact + listing.
    assert.match(out.drafts[0].subject, /New Listing/);
    assert.match(out.drafts[0].body, /Acme,/);
  });

  it('two distinct contacts → two drafts and two sends (honest per-contact counts)', async () => {
    const state = { sends: [], signals: 0, patches: [] };
    installMock(state);
    const items = [
      lbItem({ id: 'i1', contactId: 'c1', contactName: 'Acme', listingId: 'L1' }),
      lbItem({ id: 'i2', contactId: 'c2', contactName: 'Beta', listingId: 'L1' }),
    ];
    const out = await runListingBdDraftConsumer({ inboxItems: items, workspaceId: 'ws1', userId: 'u1' });
    assert.equal(out.deduped_contacts, 2);
    assert.equal(out.drafted, 2);
    assert.equal(out.sends_recorded, 2);
    assert.equal(out.items_triaged, 2);
  });

  it('ignores non-listing_bd rows passed in', async () => {
    const state = { sends: [], signals: 0, patches: [] };
    installMock(state);
    const items = [{ id: 'x', source_type: 'flagged_email', status: 'new', entity_id: 'c1', metadata: {} }];
    const out = await runListingBdDraftConsumer({ inboxItems: items, workspaceId: 'ws1', userId: 'u1' });
    assert.equal(out.selected, 0);
    assert.equal(out.drafted, 0);
    assert.equal(state.sends.length, 0);
  });
});
