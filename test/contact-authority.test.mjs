// Contact authority hierarchy tests (Units 1/2/3/4/5).
//
// Pure JS mirror of the SQL in
// 20260730120000_lcc_contact_authority_hierarchy.sql. The DB views/pivot are the
// source of truth for the queue; these lock the shared reasoning.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactAuthorityWeight, authorityTier, outranksOrTies,
  roleModel, targetRole, prospectMode, touchTheme,
  contactIntensity, contactDisposition,
} from '../api/_shared/contact-authority.js';

describe('Unit 1 — contactAuthorityWeight (signer > CoStar > naming)', () => {
  it('deed signatory → 1 (by role)', () =>
    assert.equal(contactAuthorityWeight('contact_selection', 'signatory'), 1));
  it('deed/loan doc → 1 (by via)', () => {
    assert.equal(contactAuthorityWeight('deed_lookup', 'principal'), 1);
    assert.equal(contactAuthorityWeight('loan_lookup', 'executor'), 1);
  });
  it('managing member / GP / manager → 2', () => {
    assert.equal(contactAuthorityWeight('sos_lookup', 'managing_member'), 2);
    assert.equal(contactAuthorityWeight('contact_selection', 'general_partner'), 2);
    assert.equal(contactAuthorityWeight('contact_selection_drillthrough', 'manager'), 2);
    assert.equal(contactAuthorityWeight('contact_selection', 'MGR'), 2);
  });
  it('notice individual / principal / officer / economic → 3', () => {
    assert.equal(contactAuthorityWeight('address_lookup', 'economic_owner_contact'), 3);
    assert.equal(contactAuthorityWeight('contact_selection', 'president'), 3);
    assert.equal(contactAuthorityWeight('contact_selection', 'trustee'), 3);
  });
  it('registered agent → 4', () =>
    assert.equal(contactAuthorityWeight('sos_lookup', 'registered_agent'), 4));
  it('CoStar-captured ownership contact → 6', () => {
    assert.equal(contactAuthorityWeight('related_person', 'captured_person'), 6);
    assert.equal(contactAuthorityWeight('contact_acquisition', 'prospecting_contact'), 6);
    assert.equal(contactAuthorityWeight('composite_owner_split', 'contact'), 6);
  });
  it('naming / web inference (no role signal) → 8 floor', () => {
    assert.equal(contactAuthorityWeight('cross_reference:naming_core', 'prospecting_contact'), 8);
    assert.equal(contactAuthorityWeight('web_search', 'contact'), 8);
    // a claimed controlling role still wins over the via (role tiers checked first)
    assert.equal(contactAuthorityWeight('web_search', 'principal'), 3);
  });
  it('signer OUTRANKS a CoStar-captured contact for the same owner', () => {
    const signer = { source: 'deed_lookup', role: 'signatory' };
    const costar = { source: 'related_person', role: 'captured_person' };
    assert.ok(outranksOrTies(signer, costar));
    assert.ok(!outranksOrTies(costar, signer));
  });
  it('managing member OUTRANKS a CoStar-captured contact', () => {
    assert.ok(contactAuthorityWeight('sos_lookup', 'managing_member')
      < contactAuthorityWeight('related_person', 'captured_person'));
  });
  it('authorityTier labels the weight', () => {
    assert.equal(authorityTier(1), 'signatory');
    assert.equal(authorityTier(2), 'controlling');
    assert.equal(authorityTier(6), 'captured');
    assert.equal(authorityTier(8), 'inference');
  });
});

describe('Unit 2 — roleModel + targetRole (org-structure aware)', () => {
  it('small LLC / local → individual_led', () => {
    assert.equal(roleModel({ archetype: 'local', sponsorName: null }), 'individual_led');
    assert.equal(roleModel({ archetype: 'institutional', sponsorName: 'Smith Development Company' }), 'individual_led');
  });
  it('REIT / institution → role_separated', () => {
    assert.equal(roleModel({ archetype: 'institutional', sponsorName: 'Brandywine Realty Trust REIT' }), 'role_separated');
    assert.equal(roleModel({ archetype: 'institutional', sponsorName: 'Korea Investment' }), 'role_separated');
    assert.equal(roleModel({ archetype: 'institutional', sponsorName: 'Hana Asset Management' }), 'role_separated');
    assert.equal(roleModel({ archetype: 'institutional', sponsorName: 'Hyundai Securities' }), 'role_separated');
  });
  it('role_separated: seller→disposition, buyer→acquisition', () => {
    assert.equal(targetRole('role_separated', 'seller'), 'disposition');
    assert.equal(targetRole('role_separated', 'buyer'), 'acquisition');
  });
  it('individual_led: the controlling individual either way', () => {
    assert.equal(targetRole('individual_led', 'seller'), 'controlling_individual');
    assert.equal(targetRole('individual_led', 'buyer'), 'controlling_individual');
  });
});

describe('Unit 4 — prospectMode + touchTheme (buyer vs seller)', () => {
  it('registered buyer → buyer mode → buy-side value theme', () => {
    assert.equal(prospectMode({ isBuyer: true }), 'buyer');
    assert.equal(touchTheme('buyer'), 'value_early_access');
  });
  it('everyone else → seller mode → location/blue-suit theme', () => {
    assert.equal(prospectMode({ isBuyer: false }), 'seller');
    assert.equal(prospectMode({}), 'seller');
    assert.equal(touchTheme('seller'), 'location_bluesuit');
  });
});

describe('Unit 3 — contactIntensity (control anchor + directed lane)', () => {
  it('no handoff → control full, no directed', () => {
    const r = contactIntensity({ active_contact_name: 'Jane Owner', control_intensity: 'full' });
    assert.equal(r.control.name, 'Jane Owner');
    assert.equal(r.control.intensity, 'full');
    assert.equal(r.directed, null);
  });
  it('after handoff → control lightened, directed full (control anchor kept)', () => {
    const r = contactIntensity({
      active_contact_name: 'Jane Owner', control_intensity: 'light',
      directed_contact_name: 'Wealth Mgr Bob', directed_intensity: 'full',
    });
    assert.equal(r.control.name, 'Jane Owner');       // control anchor unchanged
    assert.equal(r.control.intensity, 'light');        // lightened, not dropped
    assert.deepEqual(r.directed, { name: 'Wealth Mgr Bob', intensity: 'full' });
  });
});

describe('Unit 5 — contactDisposition never stalls', () => {
  it('reachable contact → work_contact', () => {
    const d = contactDisposition({ active_contact_entity_id: 'e1', active_contact_name: 'Jane', active_authority_level: 1 });
    assert.equal(d.disposition, 'work_contact');
  });
  it('named-individual pick without an entity id → work_contact', () => {
    const d = contactDisposition({ active_contact_name: 'Jane Owner', is_named_individual: true });
    assert.equal(d.disposition, 'work_contact');
  });
  it('routed enrichment → enrich (not a block)', () => {
    const d = contactDisposition({ enrichment_action: 'sos_manager_lookup' });
    assert.equal(d.disposition, 'enrich');
    assert.equal(d.enrichment_action, 'sos_manager_lookup');
  });
  it('nothing resolved → manual_research, NEVER a hard block', () => {
    const d = contactDisposition({});
    assert.equal(d.disposition, 'manual_research');
  });
});
