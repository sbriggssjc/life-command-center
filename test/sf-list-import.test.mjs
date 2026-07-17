// Salesforce Lists (Campaigns/CampaignMembers) ingest — tests.
//
// Covers the pure classifiers (classifyList / normalizeMember / deriveProductType
// / deriveBroker / personNameFromMember) and the deps-injected per-member
// orchestrator (processMember) over mock deps: reconcile-by-email (no dup),
// person→company org edge, membership record, buyer vs seller routing, the
// value-gated cadence seed, the institution-registry gap match/seed, and the
// no-identity / guard-rejected skips.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyList, normalizeMember, personNameFromMember,
  deriveProductType, deriveBroker, processMember,
} from '../api/_shared/sf-list-import.js';

describe('classifyList — side / product_type / broker', () => {
  it('GSA Buyer under Buyer Lists → buyer / GSA', () => {
    const c = classifyList({ campaign_name: 'GSA Buyer', parent_name: 'Buyer Lists' });
    assert.equal(c.side, 'buyer');
    assert.equal(c.product_type, 'GSA');
    assert.equal(c.broker, null);
  });
  it('JTS Seller Prospects → seller / broker JTS', () => {
    const c = classifyList({ campaign_name: 'JTS Seller Prospects', parent_name: 'Team Briggs' });
    assert.equal(c.side, 'seller');
    assert.equal(c.broker, 'JTS');
  });
  it('KDL Seller Prospects → seller / broker KDL', () => {
    assert.equal(classifyList({ campaign_name: 'KDL Seller Prospects' }).broker, 'KDL');
  });
  it('seller wins over buyer when both cues present (seller tested first)', () => {
    assert.equal(classifyList({ campaign_name: 'Buyer & Seller Prospects' }).side, 'seller');
  });
  it('side falls back to the parent name', () => {
    assert.equal(classifyList({ campaign_name: 'Nuveen', parent_name: 'Buyer Lists' }).side, 'buyer');
  });
  it('unknown side + no product when nothing matches', () => {
    const c = classifyList({ campaign_name: 'Team Briggs', parent_name: null });
    assert.equal(c.side, 'unknown');
    assert.equal(c.product_type, null);
    assert.equal(c.broker, null);
  });
  it('a product cue in the campaign name is picked up (Dialysis)', () => {
    assert.equal(classifyList({ campaign_name: 'Dialysis Buyers' }).product_type, 'Dialysis');
  });
});

describe('classifyList — broker-prefixed Prospects + Owners → seller (Unit 2)', () => {
  it('broker-prefixed "* Prospects" is seller with the broker tag', () => {
    const a = classifyList({ campaign_name: 'SAB GSA Prospects' });
    assert.equal(a.side, 'seller');
    assert.equal(a.broker, 'SAB');
    assert.equal(a.product_type, 'GSA');
    const b = classifyList({ campaign_name: 'SAB Dialysis Prospects' });
    assert.equal(b.side, 'seller');
    assert.equal(b.broker, 'SAB');
    assert.equal(b.product_type, 'Dialysis');
    assert.equal(classifyList({ campaign_name: 'NKB Prospects' }).side, 'seller');
    assert.equal(classifyList({ campaign_name: 'NKB Prospects' }).broker, 'NKB');
  });
  it('an "* Owners" list is seller; the tenant name is NOT treated as a broker', () => {
    const a = classifyList({ campaign_name: 'VCA Animal Hospital Owners' });
    assert.equal(a.side, 'seller');
    assert.equal(a.broker, null);
    const b = classifyList({ campaign_name: 'Christian Brothers Owners' });
    assert.equal(b.side, 'seller');
    assert.equal(b.broker, null);
    const c = classifyList({ campaign_name: 'DMR Urgent Care Owners' });
    assert.equal(c.side, 'seller');
    assert.equal(c.broker, 'DMR');           // broker prefix still recognised on an Owners list
  });
  it('buyer lists stay buyer even with a broker/Prospects shape absent', () => {
    assert.equal(classifyList({ campaign_name: 'GSA Buyer' }).side, 'buyer');
    assert.equal(classifyList({ campaign_name: 'Dialysis Buyers' }).side, 'buyer');
    assert.equal(classifyList({ campaign_name: 'Medical Buyers' }).side, 'buyer');
    assert.equal(classifyList({ campaign_name: 'AL Principals' }).side, 'buyer');
  });
  it('a bare broker-prefixed non-prospect/owner list stays unknown (no over-reach)', () => {
    assert.equal(classifyList({ campaign_name: 'SAB Net Lease' }).side, 'unknown');
  });
});

describe('deriveProductType / deriveBroker — pure edge cases', () => {
  it('product cues map', () => {
    assert.equal(deriveProductType('Federal / GSA book'), 'GSA');
    assert.equal(deriveProductType('DaVita net lease'), 'Dialysis');
    assert.equal(deriveProductType('Walgreens drug store'), 'Drug Store');
    assert.equal(deriveProductType('Warehouse / Industrial'), 'Industrial');
    assert.equal(deriveProductType('nothing here'), null);
  });
  it('GSA Seller Prospects → broker null (GSA is a product, not a broker)', () => {
    assert.equal(deriveBroker('GSA Seller Prospects'), null);
  });
  it('a long remainder (a real name) is not a broker tag', () => {
    assert.equal(deriveBroker('Northmarq Capital Advisors Team Sellers'), null);
  });
  it('empty remainder → null', () => {
    assert.equal(deriveBroker('Seller Prospects'), null);
  });
});

describe('normalizeMember — tolerant field mapping', () => {
  it('PA/SF connector field names', () => {
    const m = normalizeMember({
      FirstName: 'Joseph', LastName: 'Capra', Email: 'JCAPRA@boydwatterson.com',
      Phone: '216-555-1212', City: 'Cleveland', State: 'OH',
      CompanyOrAccount: 'Boyd Watterson Asset Management LLC',
      ContactId: '0038W00002PRo0iQAD', Type: 'Sent', Status: 'Open',
    });
    assert.equal(m.first, 'Joseph');
    assert.equal(m.last, 'Capra');
    assert.equal(m.email, 'jcapra@boydwatterson.com');       // lowercased
    assert.equal(m.company, 'Boyd Watterson Asset Management LLC');
    assert.equal(m.sf_contact_id, '0038W00002PRo0iQAD');
    assert.equal(m.member_type, 'Sent');
    assert.equal(m.status, 'Open');
  });
  it('shadow-DOM scrape labels', () => {
    const m = normalizeMember({
      First: 'Eric', Last: 'Dowling', Company: 'Boyd Watterson',
      'CM Relationship': 'Assigned', 'Org Type': 'Investor', Team: 'JTS',
      'Last Activity': '2026-06-01',
    });
    assert.equal(m.first, 'Eric');
    assert.equal(m.company, 'Boyd Watterson');
    assert.equal(m.status, 'Assigned');
    assert.equal(m.team, 'JTS');
    assert.equal(m.last_activity, '2026-06-01');
  });
  it('personNameFromMember prefers first+last, never the company', () => {
    assert.equal(personNameFromMember(normalizeMember({ First: 'Jane', Last: 'Doe', Company: 'Acme LLC' })), 'Jane Doe');
    assert.equal(personNameFromMember(normalizeMember({ Name: 'John Smith' })), 'John Smith');
    assert.equal(personNameFromMember(normalizeMember({ Company: 'Acme LLC' })), null);
  });
  it('a Lead-linked member (LeadId, no ContactId) is fully read (Unit 1)', () => {
    const m = normalizeMember({
      FirstName: 'Lee', LastName: 'Prospect', Email: 'LEE@owner.com',
      CompanyOrAccount: 'Owner LLC', LeadId: '00Q8W00000ABCDeUAF',
    });
    assert.equal(m.first, 'Lee');
    assert.equal(m.email, 'lee@owner.com');
    assert.equal(m.company, 'Owner LLC');
    assert.equal(m.sf_lead_id, '00Q8W00000ABCDeUAF');
    assert.equal(m.sf_contact_id, null);
    assert.equal(personNameFromMember(m), 'Lee Prospect');   // a member WITH data is never dropped
  });
  it('case-insensitive keys (lowercase connector shape) still read', () => {
    const m = normalizeMember({ firstname: 'Lo', lastname: 'Case', email: 'lo@x.com', leadid: '00Qxxx', companyoraccount: 'Lo Co' });
    assert.equal(m.first, 'Lo');
    assert.equal(m.email, 'lo@x.com');
    assert.equal(m.company, 'Lo Co');
    assert.equal(m.sf_lead_id, '00Qxxx');
  });
  it('nested Lead/Contact relationship objects are read (with an Id fallback)', () => {
    const lead = normalizeMember({ LeadId: '00Qzzz', Lead: { FirstName: 'Nest', LastName: 'Ed', Email: 'nest@x.com', Company: 'Nested LLC' } });
    assert.equal(lead.first, 'Nest');
    assert.equal(lead.email, 'nest@x.com');
    assert.equal(lead.company, 'Nested LLC');
    assert.equal(lead.sf_lead_id, '00Qzzz');
    // Id resolved from the nested relationship when no top-level *Id scalar is present.
    const contact = normalizeMember({ Contact: { Id: '003abc', FirstName: 'C', LastName: 'N', Email: 'c@x.com' } });
    assert.equal(contact.sf_contact_id, '003abc');
    assert.equal(contact.first, 'C');
  });
});

// ── processMember over mock deps ────────────────────────────────────────────

function mkDeps(overrides = {}) {
  const calls = { membership: [], links: [], stamps: [], seeds: [] };
  const base = {
    _calls: calls,
    async ensureEntityLink(args) {
      // person vs org by sourceType
      if (args.sourceType === 'organization') return { ok: true, entityId: 'org-1', createdEntity: true };
      return { ok: true, entityId: 'person-1', createdEntity: true, resolvedByEmail: false };
    },
    async linkPersonToEntity(args) { calls.links.push(args); return { ok: true }; },
    async stampContactOnActiveCadence(args) { calls.stamps.push(args); return { ok: true, seeded: true }; },
    async recordMembership(row) { calls.membership.push(row); return { ok: true }; },
    async matchBuyerParent() { return false; },
    async matchRegistryGap() { return { match: false }; },
    seedInstitutionContact: async (args) => { calls.seeds.push(args); return { seeded: true }; },
  };
  return Object.assign(base, overrides);
}

const buyerCtx = { campaign_id: 'C1', campaign_name: 'GSA Buyer', parent_name: 'Buyer Lists', side: 'buyer', product_type: 'GSA', broker: null, workspaceId: 'ws', userId: 'u' };
const sellerCtx = { campaign_id: 'C2', campaign_name: 'JTS Seller Prospects', parent_name: 'Team Briggs', side: 'seller', product_type: null, broker: 'JTS', workspaceId: 'ws', userId: 'u' };

describe('processMember — buyer routing', () => {
  it('mints person, links to company org, records membership, NO cadence seed', async () => {
    const deps = mkDeps();
    const out = await processMember(
      { FirstName: 'Ann', LastName: 'Buyer', Email: 'ann@nuveen.com', CompanyOrAccount: 'Nuveen', ContactId: 'c-123' },
      buyerCtx, deps);
    assert.equal(out.outcome, 'processed');
    assert.equal(out.person_entity_id, 'person-1');
    assert.equal(out.org_entity_id, 'org-1');
    assert.equal(out.cadence_seeded, false);               // buyers never get a prospecting cadence
    assert.equal(deps._calls.stamps.length, 0);
    assert.equal(deps._calls.links.length, 1);             // person → org
    assert.equal(deps._calls.links[0].role, 'works_at');
    assert.equal(deps._calls.membership.length, 1);
    assert.equal(deps._calls.membership[0].side, 'buyer');
    assert.equal(deps._calls.membership[0].product_type, 'GSA');
  });
  it('flags a registered buyer-parent company', async () => {
    const deps = mkDeps({ matchBuyerParent: async () => true });
    const out = await processMember({ FirstName: 'A', LastName: 'B', Email: 'a@x.com', CompanyOrAccount: 'NGP Capital', ContactId: 'c1' }, buyerCtx, deps);
    assert.equal(out.buyer_parent_match, true);
  });
});

describe('processMember — seller routing', () => {
  it('value-gated cadence seed on the owner org + membership', async () => {
    const deps = mkDeps();
    const out = await processMember(
      { FirstName: 'Sam', LastName: 'Seller', Email: 'sam@bwater.com', CompanyOrAccount: 'Boyd Watterson', ContactId: 'c-9' },
      sellerCtx, deps);
    assert.equal(out.outcome, 'processed');
    assert.equal(out.cadence_seeded, true);
    assert.equal(deps._calls.stamps.length, 1);
    assert.equal(deps._calls.stamps[0].entityId, 'org-1');     // cadence on the OWNER org
    assert.equal(deps._calls.stamps[0].seedIfValuable, true);
    assert.equal(deps._calls.membership[0].broker, 'JTS');
  });
  it('below the value floor → no seed (stamp reports not seeded)', async () => {
    const deps = mkDeps({ stampContactOnActiveCadence: async (a) => { deps._calls.stamps.push(a); return { ok: false, reason: 'below_value_floor' }; } });
    const out = await processMember({ FirstName: 'Lo', LastName: 'Val', Email: 'lo@x.com', CompanyOrAccount: 'Tiny LLC', ContactId: 'c2' }, sellerCtx, deps);
    assert.equal(out.cadence_seeded, false);
  });
  it('institution-registry gap match → seeds the curated contact', async () => {
    const deps = mkDeps({ matchRegistryGap: async () => ({ match: true, has_contact: false, institution_norm: 'gardner tannenbaum', institution_name: 'Gardner Tannenbaum' }) });
    const out = await processMember({ FirstName: 'Gary', LastName: 'Tann', Email: 'gary@gt.com', CompanyOrAccount: 'Gardner Tannenbaum', ContactId: 'c3' }, sellerCtx, deps);
    assert.equal(out.registry_gap, 'Gardner Tannenbaum');
    assert.equal(out.registry_seeded, true);
    assert.equal(deps._calls.seeds.length, 1);
    assert.equal(deps._calls.seeds[0].contact.name, 'Gary Tann');
  });
  it('registry gap that ALREADY has a contact → no seed', async () => {
    const deps = mkDeps({ matchRegistryGap: async () => ({ match: true, has_contact: true, institution_name: 'X' }) });
    const out = await processMember({ FirstName: 'A', LastName: 'B', Email: 'a@x.com', CompanyOrAccount: 'X', ContactId: 'c4' }, sellerCtx, deps);
    assert.equal(out.registry_seeded, false);
    assert.equal(deps._calls.seeds.length, 0);
  });
  it('seed flag off (no seedInstitutionContact dep) → candidate recorded, no write', async () => {
    const deps = mkDeps({ matchRegistryGap: async () => ({ match: true, has_contact: false, institution_name: 'Y' }), seedInstitutionContact: undefined });
    const out = await processMember({ FirstName: 'A', LastName: 'B', Email: 'a@x.com', CompanyOrAccount: 'Y', ContactId: 'c5' }, sellerCtx, deps);
    assert.equal(out.registry_gap, 'Y');
    assert.equal(out.registry_seeded, false);
  });
});

describe('processMember — reconcile + guards', () => {
  it('reconcile-by-email → no new entity, resolved_by_email true', async () => {
    const deps = mkDeps({ ensureEntityLink: async (a) => (a.sourceType === 'organization'
      ? { ok: true, entityId: 'org-1' }
      : { ok: true, entityId: 'existing-person', createdEntity: false, resolvedByEmail: true }) });
    const out = await processMember({ FirstName: 'Dup', LastName: 'Person', Email: 'dup@x.com', CompanyOrAccount: 'X', ContactId: 'c6' }, buyerCtx, deps);
    assert.equal(out.person_entity_id, 'existing-person');
    assert.equal(out.resolved_by_email, true);
    assert.equal(out.created_entity, false);
  });
  it('a member with neither name nor email is skipped — never mints', async () => {
    let minted = false;
    const deps = mkDeps({ ensureEntityLink: async () => { minted = true; return { ok: true, entityId: 'x' }; } });
    const out = await processMember({ CompanyOrAccount: 'Acme LLC' }, buyerCtx, deps);
    assert.equal(out.outcome, 'skipped');
    assert.equal(out.reason, 'no_identity');
    assert.equal(minted, false);
  });
  it('a junk person rejected by ensureEntityLink → guard_rejected', async () => {
    const deps = mkDeps({ ensureEntityLink: async (a) => (a.sourceType === 'organization'
      ? { ok: true, entityId: 'org-1' }
      : { ok: false, skipped: 'junk_entity_name' }) });
    const out = await processMember({ Name: 'Seller Contacts (916) 768-5544', Email: 'x@x.com' }, sellerCtx, deps);
    assert.equal(out.outcome, 'guard_rejected');
    assert.equal(out.reason, 'junk_entity_name');
  });
  it('no company → no org link, membership still recorded', async () => {
    const deps = mkDeps();
    const out = await processMember({ FirstName: 'No', LastName: 'Co', Email: 'no@co.com', ContactId: 'c7' }, buyerCtx, deps);
    assert.equal(out.org_entity_id, null);
    assert.equal(deps._calls.links.length, 0);
    assert.equal(deps._calls.membership.length, 1);
  });
});

describe('processMember — Lead-linked members (Unit 1, the critical fix)', () => {
  function captureDeps() {
    const links = [];
    const deps = mkDeps({
      async ensureEntityLink(a) {
        links.push(a);
        if (a.sourceType === 'organization') return { ok: true, entityId: 'org-1', createdEntity: true };
        return { ok: true, entityId: 'person-1', createdEntity: true };
      },
    });
    deps._links = links;
    return deps;
  }

  it('a Lead-only member keys the identity on the LeadId with source_type Lead', async () => {
    const deps = captureDeps();
    const out = await processMember(
      { FirstName: 'Lee', LastName: 'Prospect', Email: 'lee@owner.com', CompanyOrAccount: 'Owner LLC', LeadId: '00Q8W00000ABCDeUAF' },
      buyerCtx, deps);
    assert.equal(out.outcome, 'processed');
    const personLink = deps._links.find((l) => l.sourceType !== 'organization');
    assert.equal(personLink.sourceSystem, 'salesforce');
    assert.equal(personLink.sourceType, 'Lead');
    assert.equal(personLink.externalId, '00Q8W00000ABCDeUAF');
    assert.equal(personLink.seedFields.first_name, 'Lee');   // structured name → person infer
    assert.equal(personLink.seedFields.last_name, 'Prospect');
    // membership records the LeadId (and no ContactId) — visible in the DB row
    assert.equal(deps._calls.membership[0].sf_lead_id, '00Q8W00000ABCDeUAF');
    assert.equal(deps._calls.membership[0].sf_contact_id, null);
  });

  it('a name-only Lead (no email) is still processed, not dropped', async () => {
    const deps = captureDeps();
    const out = await processMember({ FirstName: 'Nora', LastName: 'Email-less', LeadId: '00Qnoemail' }, sellerCtx, deps);
    assert.equal(out.outcome, 'processed');
    const personLink = deps._links.find((l) => l.sourceType !== 'organization');
    assert.equal(personLink.sourceType, 'Lead');
    assert.equal(personLink.seedFields.first_name, 'Nora');
  });
});
