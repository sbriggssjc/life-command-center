// ORE Phase B — B1: owner-reconcile classifier tests.
//
// Covers the pure reconcileOwnerRow classifier — the SF-presence-vs-contact
// comparison that resolves each owner to ONE traceable state — and the source
// trace it builds. No I/O; the classifier is the reconcile logic Scott does
// manually.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileOwnerRow, RECONCILE_ROUTES } from '../api/_handlers/owner-reconcile.js';

const base = {
  entity_id: 'own-1', owner_name: 'Acme Holdings LLC', workspace_id: 'ws-1', rank_value: 5000000,
  sf_account_id: null, n_sf_accounts: 0, has_person_contact: false,
  active_contact_entity_id: null, active_contact_name: null, active_contact_role: null,
  active_authority_level: null, pivot_source: null, enrichment_action: null,
  entity_has_email: false, entity_has_phone: false, entity_has_address: false, has_reg_address: false,
};

describe('reconcileOwnerRow — the SF-vs-contact reconcile comparison', () => {
  it('confirmed_connected: SF Account AND a human contact agree (no route)', () => {
    const r = reconcileOwnerRow({ ...base, sf_account_id: '0011I00000AbcDeQAY', n_sf_accounts: 1,
      has_person_contact: true, active_contact_entity_id: 'p-1', active_contact_name: 'Jane Roe' });
    assert.equal(r.reconcile_state, 'confirmed_connected');
    assert.equal(r.routed_to, null);
    assert.equal(r.control_contact_entity_id, 'p-1');
    assert.equal(r.control_contact_source, 'pivot');
    assert.equal(r.sources.sf_account.id, '0011I00000AbcDeQAY');
    assert.equal(r.sources.person_contact, true);
  });

  it('contact_ready_no_sf: we hold a contact, SF has no Account → net-new to SF (B2)', () => {
    const r = reconcileOwnerRow({ ...base, has_person_contact: true,
      active_contact_entity_id: 'p-2', active_contact_name: 'Sam Poe' });
    assert.equal(r.reconcile_state, 'contact_ready_no_sf');
    assert.equal(r.routed_to, 'sf_push_b2');
    assert.equal(r.sf_account_id, null);
    assert.equal(r.sources.sf_account, null);
  });

  it('sf_no_contact: SF Account but no human pulled into LCC → contact-acquisition', () => {
    const r = reconcileOwnerRow({ ...base, sf_account_id: '0011I00000XyzQAY', n_sf_accounts: 1 });
    assert.equal(r.reconcile_state, 'sf_no_contact');
    assert.equal(r.routed_to, 'contact_acquisition');
    assert.equal(r.has_person_contact, false);
  });

  it('resolvable_contact: pivot resolved a NAMED contact, not yet attached → enrich', () => {
    const r = reconcileOwnerRow({ ...base, active_contact_name: 'Adam Kamlet',
      active_contact_entity_id: null, active_contact_role: 'principal', active_authority_level: 3,
      pivot_source: 'cross_reference' });
    assert.equal(r.reconcile_state, 'resolvable_contact');
    assert.equal(r.routed_to, 'owner_contact_enrich');
    assert.equal(r.control_contact_entity_id, null);
    assert.equal(r.control_contact_source, 'pivot_unattached');
    assert.equal(r.sources.pivot.name, 'Adam Kamlet');
    assert.equal(r.sources.pivot.attached, false);
  });

  it('needs_enrichment: no contact, an automated enrichment path exists → enrich', () => {
    const r = reconcileOwnerRow({ ...base, enrichment_action: 'sos_manager_lookup' });
    assert.equal(r.reconcile_state, 'needs_enrichment');
    assert.equal(r.routed_to, 'owner_contact_enrich');
    assert.equal(r.sources.enrichment_action, 'sos_manager_lookup');
  });

  it('unresolvable: no contact, no SF, no pivot name, manual_research only → surfaced (no guess)', () => {
    const r = reconcileOwnerRow({ ...base, enrichment_action: 'manual_research' });
    assert.equal(r.reconcile_state, 'unresolvable');
    assert.equal(r.routed_to, null);
  });

  it('unresolvable: truly bare owner (no signals at all)', () => {
    const r = reconcileOwnerRow({ ...base });
    assert.equal(r.reconcile_state, 'unresolvable');
  });

  it('a whitespace-only pivot name is NOT a resolvable contact', () => {
    const r = reconcileOwnerRow({ ...base, active_contact_name: '   ' });
    assert.equal(r.reconcile_state, 'unresolvable');
    assert.equal(r.control_contact_name, null);
  });

  it('SF-present outranks a pivot name (sf_no_contact, not resolvable_contact)', () => {
    // An owner with an SF Account but only a pivot-suggested unattached name is
    // an SF-pull case first — the SF Account is the authoritative contact home.
    const r = reconcileOwnerRow({ ...base, sf_account_id: '0011I00000AbcDeQAY',
      active_contact_name: 'Adam Kamlet', active_contact_entity_id: null });
    assert.equal(r.reconcile_state, 'sf_no_contact');
  });

  it('sources trace carries entity-contact + has_reg_address flags', () => {
    const r = reconcileOwnerRow({ ...base, entity_has_email: true, entity_has_phone: true,
      has_reg_address: true, enrichment_action: 'address_reverse_lookup' });
    assert.deepEqual(r.sources.entity_contact, { email: true, phone: true, address: false });
    assert.equal(r.sources.has_reg_address, true);
  });

  it('every reconcile state has a route mapping (terminal states map to null)', () => {
    const states = ['confirmed_connected', 'contact_ready_no_sf', 'sf_no_contact',
      'resolvable_contact', 'needs_enrichment', 'unresolvable'];
    for (const s of states) assert.ok(Object.prototype.hasOwnProperty.call(RECONCILE_ROUTES, s), s);
  });
});

describe('ORE Tier A (Unit 4) — archetype-aware routing of the enrichment tail', () => {
  it('institutional + registry contact → institution_registry (fan-out attach)', () => {
    const r = reconcileOwnerRow({ ...base, enrichment_action: 'manual_research',
      owner_archetype: 'institutional', sponsor_institution: 'Blackstone', has_institution_contact: true });
    assert.equal(r.reconcile_state, 'unresolvable');   // no LCC signals → tail state
    assert.equal(r.routed_to, 'institution_registry');
    assert.equal(r.sources.owner_archetype, 'institutional');
    assert.equal(r.sources.sponsor_institution, 'Blackstone');
    assert.equal(r.sources.has_institution_contact, true);
  });

  it('institutional + NO registry contact → resolve_parent_then_registry (add ONE contact)', () => {
    const r = reconcileOwnerRow({ ...base, enrichment_action: 'sos_manager_lookup',
      owner_archetype: 'institutional', sponsor_institution: 'Gardner Tannenbaum', has_institution_contact: false });
    assert.equal(r.reconcile_state, 'needs_enrichment');
    assert.equal(r.routed_to, 'resolve_parent_then_registry');
    assert.equal(r.sources.has_institution_contact, false);
  });

  it('local (terminal owner) → fetch_public_records (SOS/deed/address)', () => {
    const r = reconcileOwnerRow({ ...base, enrichment_action: 'address_reverse_lookup',
      owner_archetype: 'local', has_institution_contact: false });
    assert.equal(r.reconcile_state, 'needs_enrichment');
    assert.equal(r.routed_to, 'fetch_public_records');
  });

  it('archetype only reroutes the enrichment tail — a connected owner is unaffected', () => {
    const r = reconcileOwnerRow({ ...base, sf_account_id: '0011I00000AbcDeQAY',
      has_person_contact: true, active_contact_entity_id: 'p-1', active_contact_name: 'Jane Roe',
      owner_archetype: 'institutional', has_institution_contact: true });
    assert.equal(r.reconcile_state, 'confirmed_connected');
    assert.equal(r.routed_to, null);   // NOT rerouted — it is already connected
  });

  it('NO archetype overlay → generic routing preserved (deploy-order safe)', () => {
    const r = reconcileOwnerRow({ ...base, enrichment_action: 'sos_manager_lookup' });
    assert.equal(r.routed_to, 'owner_contact_enrich');   // pre-Tier-A behavior
    assert.equal(r.sources.owner_archetype, null);
  });
});
