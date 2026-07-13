// Phase 1 (2026-07-13) — capture Scott's REAL pipeline. The GROW gate is looser
// than the R63 producer gate: repeated human outreach IS the BD signal, so a
// person Scott emails/calls (especially repeatedly) grows a tracked cadence even
// without portfolio value — but junk / a single low-value stranger never does.
// These pin the pure classifier, the deps-injected gatherer, the grow-target
// resolver (asset->owner hop / person self-contact), and the orchestrator.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  growGateFromFacts,
  entityQualifiesForCadenceGrowth,
  resolveCadenceGrowTarget,
  growCadenceFromOutreach,
  CADENCE_GROW_MIN_OUTREACH_EVENTS,
} from '../api/_shared/cadence-engine.js';

describe('growGateFromFacts (pure classifier)', () => {
  it('grows on a Salesforce identity (a real CRM contact) even with no value', () => {
    assert.equal(growGateFromFacts({ hasSalesforceIdentity: true, outreachEventCount: 0 }), true);
  });

  it('grows on >= 2 real outreach events (a genuinely-worked relationship), no value', () => {
    assert.equal(growGateFromFacts({ outreachEventCount: 2 }), true);
    assert.equal(growGateFromFacts({ outreachEventCount: 5 }), true);
  });

  it('grows on a full BD signal (open opp / value) too', () => {
    assert.equal(growGateFromFacts({ hasOpenOpportunity: true }), true);
    assert.equal(growGateFromFacts({ portfolioValue: 1_000_000, floor: 500000 }), true);
  });

  it('does NOT grow on a single low-value stranger (1 event, no SF, no value)', () => {
    assert.equal(growGateFromFacts({ outreachEventCount: 1, portfolioValue: 0, floor: 500000 }), false);
    assert.equal(growGateFromFacts({ outreachEventCount: 0 }), false);
  });

  it('NEVER grows on junk — even with an SF identity and many events', () => {
    assert.equal(growGateFromFacts({ nameIsJunk: true, hasSalesforceIdentity: true, outreachEventCount: 9 }), false);
  });

  it('the min-events threshold is CADENCE_GROW_MIN_OUTREACH_EVENTS (2) and overridable', () => {
    assert.equal(CADENCE_GROW_MIN_OUTREACH_EVENTS, 2);
    assert.equal(growGateFromFacts({ outreachEventCount: 1 }), false);
    assert.equal(growGateFromFacts({ outreachEventCount: 1, growMinEvents: 1 }), true);
  });
});

// ---- deps-injected gatherer ------------------------------------------------

// Build a fake PostgREST query that returns per-endpoint fixtures.
function fakeQuery(fixtures) {
  return async (_method, path) => {
    for (const [needle, data] of Object.entries(fixtures)) {
      if (path.includes(needle)) return { ok: true, data };
    }
    return { ok: true, data: [] };
  };
}

describe('entityQualifiesForCadenceGrowth (deps-injected gatherer)', () => {
  it('qualifies an SF-linked person even with 0 outreach events + no value', async () => {
    const query = fakeQuery({
      'external_identities': [{ entity_id: 'e1' }],   // has SF identity
      'entities?id=eq.': [{ name: 'Jane Broker', entity_type: 'person' }],
    });
    assert.equal(await entityQualifiesForCadenceGrowth('e1', { query }), true);
  });

  it('qualifies a >=2-event entity with no SF and no value', async () => {
    const query = fakeQuery({
      'category=in.(email,call,meeting)': [{ id: 'a1' }, { id: 'a2' }],   // 2 real events
      'entities?id=eq.': [{ name: 'John Owner', entity_type: 'person' }],
    });
    assert.equal(await entityQualifiesForCadenceGrowth('e2', { query }), true);
  });

  it('does NOT qualify a single low-value stranger (1 event, no SF, no value)', async () => {
    const query = fakeQuery({
      'category=in.(email,call,meeting)': [{ id: 'a1' }],   // only 1 event
      'entities?id=eq.': [{ name: 'Sam Stranger', entity_type: 'person' }],
    });
    assert.equal(await entityQualifiesForCadenceGrowth('e3', { query }), false);
  });

  it('does NOT qualify a junk-named entity even with SF identity + events', async () => {
    const query = fakeQuery({
      'external_identities': [{ entity_id: 'e4' }],
      'category=in.(email,call,meeting)': [{ id: 'a1' }, { id: 'a2' }],
      'entities?id=eq.': [{ name: 'Seller Contacts(916) 768-5544 (p)', entity_type: 'person' }],
    });
    assert.equal(await entityQualifiesForCadenceGrowth('e4', { query }), false);
  });

  it('counts outreach events on the WORKED entity (outreachEntityId) not the target', async () => {
    // The target (owner) has no events of its own, but the worked asset does.
    const query = async (_m, path) => {
      if (path.includes('entity_id=eq.asset1&category=in.(email,call,meeting)')) return { ok: true, data: [{ id: 'x' }, { id: 'y' }] };
      if (path.includes('category=in.(email,call,meeting)')) return { ok: true, data: [] };
      if (path.includes('entities?id=eq.')) return { ok: true, data: [{ name: 'Owner Org LLC', entity_type: 'organization' }] };
      return { ok: true, data: [] };
    };
    assert.equal(await entityQualifiesForCadenceGrowth('owner1', { query, outreachEntityId: 'asset1' }), true);
  });

  it('fails CLOSED on a gather error', async () => {
    const query = async () => { throw new Error('db down'); };
    assert.equal(await entityQualifiesForCadenceGrowth('e5', { query }), false);
  });
});

// ---- grow-target resolver --------------------------------------------------

describe('resolveCadenceGrowTarget', () => {
  it('an asset hops to its owns-owner (contact null)', async () => {
    const query = async (_m, path) => {
      if (path.includes('entities?id=eq.')) return { ok: true, data: [{ id: 'a', entity_type: 'asset' }] };
      if (path.includes('relationship_type=eq.owns')) return { ok: true, data: [{ from_entity_id: 'owner-9' }] };
      return { ok: true, data: [] };
    };
    const t = await resolveCadenceGrowTarget('a', { query });
    assert.deepEqual(t, { growEntityId: 'owner-9', contactEntityId: null, kind: 'asset_owner' });
  });

  it('an asset with no owner returns null (nothing to grow)', async () => {
    const query = async (_m, path) => {
      if (path.includes('entities?id=eq.')) return { ok: true, data: [{ id: 'a', entity_type: 'asset' }] };
      return { ok: true, data: [] };
    };
    assert.equal(await resolveCadenceGrowTarget('a', { query }), null);
  });

  it('a person grows on themselves and is their own contact', async () => {
    const query = async () => ({ ok: true, data: [{ id: 'p', entity_type: 'person' }] });
    const t = await resolveCadenceGrowTarget('p', { query });
    assert.deepEqual(t, { growEntityId: 'p', contactEntityId: 'p', kind: 'person_self' });
  });

  it('an organization owner grows on itself (contact null)', async () => {
    const query = async () => ({ ok: true, data: [{ id: 'o', entity_type: 'organization' }] });
    const t = await resolveCadenceGrowTarget('o', { query });
    assert.deepEqual(t, { growEntityId: 'o', contactEntityId: null, kind: 'owner' });
  });
});

// ---- orchestrator ----------------------------------------------------------

describe('growCadenceFromOutreach', () => {
  const baseDeps = {
    resolveCadenceForEntity: async () => null,       // no existing cadence
    resolveCadenceGrowTarget: async () => ({ growEntityId: 'p', contactEntityId: 'p', kind: 'person_self' }),
    qualifies: async () => true,
  };

  it('seeds + advances a NEW cadence, stamping the person as contact', async () => {
    const seedCalls = [], advCalls = [];
    const g = await growCadenceFromOutreach({ entityId: 'p', category: 'call' }, {
      ...baseDeps,
      getCadenceState: async (ids) => { seedCalls.push(ids); return { ok: true, is_new: true, cadence: { id: 'cad-1' } }; },
      advanceCadence: async (id, td) => { advCalls.push({ id, td }); return { ok: true }; },
    });
    assert.equal(g.grown, true);
    assert.equal(g.cadence_id, 'cad-1');
    assert.equal(seedCalls[0].contact_id, 'p', 'the person is stamped as its own contact');
    assert.equal(advCalls[0].td.type, 'phone', 'a call advances a phone touch');
    assert.equal(advCalls[0].td.direction, 'outbound');
  });

  it('no-ops when a cadence already resolves (the trigger owns the advance)', async () => {
    let seeded = false;
    const g = await growCadenceFromOutreach({ entityId: 'p', category: 'email' }, {
      ...baseDeps,
      resolveCadenceForEntity: async () => ({ id: 'existing' }),
      getCadenceState: async () => { seeded = true; return { ok: true, is_new: true, cadence: { id: 'x' } }; },
      advanceCadence: async () => ({ ok: true }),
    });
    assert.equal(g.grown, false);
    assert.equal(g.reason, 'cadence_exists');
    assert.equal(seeded, false, 'never seeds when a cadence exists');
  });

  it('does NOT grow when the gate declines', async () => {
    let seeded = false;
    const g = await growCadenceFromOutreach({ entityId: 'p', category: 'email' }, {
      ...baseDeps, qualifies: async () => false,
      getCadenceState: async () => { seeded = true; return { ok: true, is_new: true, cadence: { id: 'x' } }; },
      advanceCadence: async () => ({ ok: true }),
    });
    assert.equal(g.grown, false);
    assert.equal(g.reason, 'not_qualified');
    assert.equal(seeded, false);
  });

  it('an existing (paused) cadence FOUND by the seed is left untouched — not a grow', async () => {
    const g = await growCadenceFromOutreach({ entityId: 'p', category: 'email' }, {
      ...baseDeps,
      getCadenceState: async () => ({ ok: true, is_new: false, cadence: { id: 'paused-1' } }),
      advanceCadence: async () => { throw new Error('should not advance'); },
    });
    assert.equal(g.grown, false);
    assert.equal(g.reason, 'cadence_exists');
  });

  it('ignores non-outreach categories', async () => {
    const g = await growCadenceFromOutreach({ entityId: 'p', category: 'note' }, baseDeps);
    assert.equal(g.grown, false);
    assert.equal(g.reason, 'not_outreach');
  });

  it('no grow target → no grow', async () => {
    const g = await growCadenceFromOutreach({ entityId: 'a', category: 'email' }, {
      ...baseDeps, resolveCadenceGrowTarget: async () => null,
    });
    assert.equal(g.grown, false);
    assert.equal(g.reason, 'no_grow_target');
  });
});
