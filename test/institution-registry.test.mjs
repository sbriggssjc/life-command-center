// ORE Tier A — institution-registry resolve/attach + archetype-route tests.
//
// Covers the pure helpers (normalizeInstitution, routeFromArchetype) and the
// attach core (attachInstitutionContactToOwner) over injected deps: a curated
// sponsor contact minted + linked + cadence-stamped + pivot-pointed, guard
// rejection of a firm name, link failure, and the fan-out invariant (the SAME
// contact name dedups to one person entity across sibling SPEs).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInstitution, routeFromArchetype, attachInstitutionContactToOwner,
  INSTITUTION_VIA_PREFIX,
} from '../api/_shared/institution-registry.js';
import { looksLikePersonName } from '../api/_shared/entity-link.js';

describe('normalizeInstitution — the sponsor match key', () => {
  it('lowercases + collapses non-alnum + trims', () => {
    assert.equal(normalizeInstitution('Brandywine Realty Trust'), 'brandywine realty trust');
    assert.equal(normalizeInstitution('C-III Asset Management, LLC'), 'c iii asset management llc');
    assert.equal(normalizeInstitution('  Hana  Asset   Management '), 'hana asset management');
  });
  it('distinct firms do NOT collapse (no legal-token stripping)', () => {
    assert.notEqual(normalizeInstitution('Brandywine Realty Trust'), normalizeInstitution('Brandywine Realty LLC'));
  });
  it('empty / non-string → null', () => {
    assert.equal(normalizeInstitution(''), null);
    assert.equal(normalizeInstitution('   '), null);
    assert.equal(normalizeInstitution(null), null);
    assert.equal(normalizeInstitution(42), null);
  });
});

describe('routeFromArchetype — Unit 4 route split', () => {
  it('institutional + contact → institution_registry', () => {
    assert.equal(routeFromArchetype('institutional', true), 'institution_registry');
  });
  it('institutional + no contact → resolve_parent_then_registry', () => {
    assert.equal(routeFromArchetype('institutional', false), 'resolve_parent_then_registry');
  });
  it('local → fetch_public_records (regardless of contact flag)', () => {
    assert.equal(routeFromArchetype('local', true), 'fetch_public_records');
    assert.equal(routeFromArchetype('local', false), 'fetch_public_records');
  });
});

// ---- attach core -----------------------------------------------------------
function makeDeps(overrides = {}) {
  const calls = { ensure: [], link: [], stamp: [], ops: [] };
  const deps = {
    looksLikePersonName,   // the REAL person guard (rejects firm-suffix names)
    ensureEntityLink: async (a) => { calls.ensure.push(a); return { ok: true, entityId: 'person-1' }; },
    linkPersonToEntity: async (a) => { calls.link.push(a); return { ok: true, linked: true }; },
    stampContactOnActiveCadence: async (a) => { calls.stamp.push(a); return { ok: true, seeded: true }; },
    opsQuery: async (m, path, body) => { calls.ops.push({ m, path, body }); return { ok: true, data: [] }; },
    _calls: calls,
    ...overrides,
  };
  return deps;
}

const attRow = {
  entity_id: 'spe-1', owner_name: 'Cira Square Master Tenant LLC', workspace_id: 'ws-1', rank_value: 34000000,
  institution_name: 'Brandywine Realty Trust', sponsor_norm: 'brandywine realty trust',
  registry_contact_id: 7, contact_name: 'Jane Roe', contact_title: 'SVP Acquisitions',
  contact_email: 'jane@brandywine.com', contact_phone: '215-555-0100',
  contact_source: 'public_ir', contact_confidence: 'high',
};

describe('attachInstitutionContactToOwner — attach the curated sponsor contact', () => {
  it('mints person w/ title+email+phone, links, stamps cadence, points pivot', async () => {
    const deps = makeDeps();
    const out = await attachInstitutionContactToOwner(attRow, deps);
    assert.equal(out.outcome, 'attached');
    assert.equal(out.contact_entity_id, 'person-1');
    assert.equal(out.institution_name, 'Brandywine Realty Trust');
    assert.equal(out.cadence_seeded, true);
    // person minted with the curated reachable details
    assert.equal(deps._calls.ensure[0].seedFields.name, 'Jane Roe');
    assert.equal(deps._calls.ensure[0].seedFields.email, 'jane@brandywine.com');
    assert.equal(deps._calls.ensure[0].seedFields.phone, '215-555-0100');
    assert.equal(deps._calls.ensure[0].seedFields.title, 'SVP Acquisitions');
    // link carries the traceable institution_registry provenance
    assert.equal(deps._calls.link[0].via, INSTITUTION_VIA_PREFIX + ':brandywine realty trust');
    assert.equal(deps._calls.link[0].role, 'institution_decision_maker');
    // cadence stamp is contactless-only + seed-if-valuable
    assert.equal(deps._calls.stamp[0].onlyContactless, true);
    assert.equal(deps._calls.stamp[0].seedIfValuable, true);
    // pivot ensured + pointed
    assert.ok(deps._calls.ops.some((c) => c.m === 'POST' && c.path.startsWith('rpc/lcc_ensure_owner_pivot')));
    assert.ok(deps._calls.ops.some((c) => c.m === 'PATCH' && c.path.startsWith('owner_contact_pivot')
      && c.body.active_contact_entity_id === 'person-1'));
  });

  it('fan-out: the SAME sponsor contact minted once dedups across sibling SPEs', async () => {
    // ensureEntityLink dedups by canonical_name → the same person entity id is
    // returned for every SPE of the sponsor. Two SPEs → one contact entity.
    const deps = makeDeps({ ensureEntityLink: async () => ({ ok: true, entityId: 'person-shared' }) });
    const a = await attachInstitutionContactToOwner({ ...attRow, entity_id: 'spe-1' }, deps);
    const b = await attachInstitutionContactToOwner({ ...attRow, entity_id: 'spe-2', owner_name: 'Cira Square II LLC' }, deps);
    assert.equal(a.contact_entity_id, 'person-shared');
    assert.equal(b.contact_entity_id, 'person-shared');
    assert.equal(a.outcome, 'attached');
    assert.equal(b.outcome, 'attached');
  });

  it('guard-rejects a FIRM name mistakenly curated as a contact (never mints)', async () => {
    const deps = makeDeps();
    const out = await attachInstitutionContactToOwner({ ...attRow, contact_name: 'Brandywine Realty Trust LLC' }, deps);
    assert.equal(out.outcome, 'guard_rejected');
    assert.equal(deps._calls.ensure.length, 0);   // never minted
  });

  it('guard-rejects a blank contact name', async () => {
    const deps = makeDeps();
    const out = await attachInstitutionContactToOwner({ ...attRow, contact_name: '   ' }, deps);
    assert.equal(out.outcome, 'guard_rejected');
  });

  it('link_failed surfaces WHY (never a silent no-op)', async () => {
    const deps = makeDeps({ linkPersonToEntity: async () => ({ ok: false, detail: 'boom' }) });
    const out = await attachInstitutionContactToOwner(attRow, deps);
    assert.equal(out.outcome, 'link_failed');
    assert.equal(out.contact_entity_id, 'person-1');
  });

  it('an already-existing link (existed:true) still completes the attach', async () => {
    const deps = makeDeps({ linkPersonToEntity: async () => ({ ok: false, existed: true }) });
    const out = await attachInstitutionContactToOwner(attRow, deps);
    assert.equal(out.outcome, 'attached');
  });
});
