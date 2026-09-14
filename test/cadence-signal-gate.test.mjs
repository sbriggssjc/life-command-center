// R63 Unit 1 — a cadence tracks a REAL relationship, not capture noise.
// The shared BD-signal predicate gates the CoStar contact-capture producer
// (sidebar) and the SF-activity grow path, and mirrors the Unit-2 SQL pause
// sweep. These tests pin the pure classifier + the deps-injected gatherer.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bdSignalFromFacts,
  entityHasBdSignal,
  cadenceSignalFloor,
  cadenceReachableFromFacts,
  entityIsCadenceReachable,
  cadenceSeedDecision,
  CADENCE_SIGNAL_MIN_VALUE_DEFAULT,
} from '../api/_shared/cadence-engine.js';

describe('bdSignalFromFacts (R63 Unit 1 pure classifier)', () => {
  const FLOOR = 500000;

  it('a buy_side cadence is real by construction', () => {
    assert.equal(bdSignalFromFacts({ phase: 'buy_side', floor: FLOOR }), true);
  });

  // P112: a bare SF identity was carrying 930 of 1,113 prospecting cadences
  // (897 never touched). It is corroboration, not a relationship signal.
  it('a bare Salesforce identity is NOT a signal (P112)', () => {
    assert.equal(bdSignalFromFacts({ hasSalesforceIdentity: true, floor: FLOOR }), false);
  });

  it('an SF identity PLUS real activity is a signal (the activity carries it)', () => {
    assert.equal(bdSignalFromFacts({
      hasSalesforceIdentity: true, hasSalesforceActivity: true, floor: FLOOR,
    }), true);
  });

  it('an open BD opportunity is a signal', () => {
    assert.equal(bdSignalFromFacts({ hasOpenOpportunity: true, floor: FLOOR }), true);
  });

  it('real SF activity is a signal', () => {
    assert.equal(bdSignalFromFacts({ hasSalesforceActivity: true, floor: FLOOR }), true);
  });

  it('connected value at/above the floor is a signal; below is not', () => {
    assert.equal(bdSignalFromFacts({ connectedValue: FLOOR, floor: FLOOR }), true);
    assert.equal(bdSignalFromFacts({ connectedValue: FLOOR - 1, floor: FLOOR }), false);
  });

  it('portfolio value at/above the floor is a signal', () => {
    assert.equal(bdSignalFromFacts({ portfolioValue: 1000000, floor: FLOOR }), true);
    assert.equal(bdSignalFromFacts({ portfolioValue: 0, floor: FLOOR }), false);
  });

  it('a bare captured contact (no signal) is NOT real', () => {
    assert.equal(bdSignalFromFacts({
      hasSalesforceIdentity: false, hasOpenOpportunity: false,
      hasSalesforceActivity: false, connectedValue: 0, portfolioValue: 0,
      phase: 'prospecting', floor: FLOOR,
    }), false);
  });

  it('defaults the floor to CADENCE_SIGNAL_MIN_VALUE_DEFAULT when absent', () => {
    assert.equal(bdSignalFromFacts({ connectedValue: CADENCE_SIGNAL_MIN_VALUE_DEFAULT }), true);
    assert.equal(bdSignalFromFacts({ connectedValue: CADENCE_SIGNAL_MIN_VALUE_DEFAULT - 1 }), false);
  });
});

describe('entityHasBdSignal (R63 Unit 1 deps-injected gatherer)', () => {
  // Build a fake query that answers each PostgREST path with rows or empty.
  function fakeQuery(answers) {
    return async (_method, path) => {
      if (path.startsWith('external_identities')) return { ok: true, data: answers.sf ? [{ entity_id: 'x' }] : [] };
      if (path.startsWith('bd_opportunities'))    return { ok: true, data: answers.opp ? [{ id: 'o' }] : [] };
      if (path.startsWith('activity_events'))     return { ok: true, data: answers.act ? [{ id: 'a' }] : [] };
      if (path.startsWith('lcc_entity_connected_value')) return { ok: true, data: answers.cv != null ? [{ connected_property_value: answers.cv }] : [] };
      if (path.startsWith('v_entity_portfolio_all'))     return { ok: true, data: answers.pf != null ? [{ current_annual_rent_total: answers.pf }] : [] };
      return { ok: true, data: [] };
    };
  }

  it('returns false for a falsy entity id', async () => {
    assert.equal(await entityHasBdSignal(null, { query: fakeQuery({}) }), false);
  });

  it('a bare captured contact (all empty) → no signal', async () => {
    assert.equal(await entityHasBdSignal('e1', { query: fakeQuery({}), floor: 500000 }), false);
  });

  it('an SF-linked entity with nothing else → NO signal (P112)', async () => {
    assert.equal(await entityHasBdSignal('e2', { query: fakeQuery({ sf: true }), floor: 500000 }), false);
  });

  it('an SF-linked entity WITH activity → signal', async () => {
    assert.equal(await entityHasBdSignal('e2b', { query: fakeQuery({ sf: true, act: true }), floor: 500000 }), true);
  });

  it('a high connected-value entity → signal', async () => {
    assert.equal(await entityHasBdSignal('e3', { query: fakeQuery({ cv: 2000000 }), floor: 500000 }), true);
  });

  it('a low connected-value, otherwise empty entity → no signal', async () => {
    assert.equal(await entityHasBdSignal('e4', { query: fakeQuery({ cv: 1000 }), floor: 500000 }), false);
  });

  it('fails CLOSED (no signal) when the gather throws', async () => {
    const throwing = async () => { throw new Error('db down'); };
    assert.equal(await entityHasBdSignal('e5', { query: throwing }), false);
  });
});

describe('cadenceSignalFloor env knob (R63)', () => {
  it('falls back to the default when CADENCE_SIGNAL_MIN_VALUE is unset/invalid', () => {
    const saved = process.env.CADENCE_SIGNAL_MIN_VALUE;
    delete process.env.CADENCE_SIGNAL_MIN_VALUE;
    assert.equal(cadenceSignalFloor(), CADENCE_SIGNAL_MIN_VALUE_DEFAULT);
    process.env.CADENCE_SIGNAL_MIN_VALUE = '250000';
    assert.equal(cadenceSignalFloor(), 250000);
    if (saved === undefined) delete process.env.CADENCE_SIGNAL_MIN_VALUE;
    else process.env.CADENCE_SIGNAL_MIN_VALUE = saved;
  });
});


// ============================================================================
// P112 / BREAK-2 — reachability precondition + combined seed decision
// ============================================================================

describe('cadenceReachableFromFacts (P112 pure classifier)', () => {
  it('the org\'s own email or phone makes it reachable', () => {
    assert.equal(cadenceReachableFromFacts({ orgEmail: 'a@b.com' }), true);
    assert.equal(cadenceReachableFromFacts({ orgPhone: '555-1212' }), true);
  });

  it('a unified_contacts email makes it reachable', () => {
    assert.equal(cadenceReachableFromFacts({ unifiedContactEmail: 'x@y.com' }), true);
  });

  it('nothing at all → unreachable', () => {
    assert.equal(cadenceReachableFromFacts({}), false);
    assert.equal(cadenceReachableFromFacts({ orgEmail: '   ', linkedPersons: [] }), false);
  });

  it('a linked person with a contact detail makes it reachable', () => {
    assert.equal(cadenceReachableFromFacts({
      linkedPersons: [{ email: 'p@q.com', role: 'manager' }],
    }), true);
  });

  // The most expensive possible failure of this feature is routing owner
  // outreach to the counterparty's broker — so broker-ish roles are EXCLUDED,
  // never merely ranked last (mirrors NON_REACHABLE_ROLES + the SQL arm).
  it('a broker-ish linked person does NOT make the owner reachable', () => {
    for (const role of ['broker', 'listing_broker', 'purchasing_broker', 'agent', 'tenant', 'operator']) {
      assert.equal(cadenceReachableFromFacts({
        linkedPersons: [{ email: 'b@brokerage.com', role }],
      }), false, `role ${role} must not confer reachability`);
    }
  });

  it('a person with a role but no contact detail does not count', () => {
    assert.equal(cadenceReachableFromFacts({
      linkedPersons: [{ role: 'manager' }],
    }), false);
  });
});

describe('entityIsCadenceReachable (P112 gatherer)', () => {
  function fakeQuery({ org = {}, uc = null, rels = [], fail = null }) {
    return async (_m, path) => {
      if (fail && path.startsWith(fail)) return { ok: false, data: null };
      if (path.startsWith('entities?id=')) return { ok: true, data: [org] };
      if (path.startsWith('unified_contacts')) return { ok: true, data: uc ? [uc] : [] };
      if (path.startsWith('entity_relationships')) return { ok: true, data: rels };
      return { ok: true, data: [] };
    };
  }

  it('resolves the org route', async () => {
    assert.equal(await entityIsCadenceReachable('e1', {
      query: fakeQuery({ org: { email: 'o@x.com' } }) }), true);
  });

  it('picks the counterparty side of the edge, not this entity', async () => {
    const rels = [{
      from_entity_id: 'PERSON', to_entity_id: 'e1', metadata: { role: 'manager' },
      from_entity: { id: 'PERSON', entity_type: 'person', email: 'p@q.com' },
      to_entity: { id: 'e1', entity_type: 'organization' },
    }];
    assert.equal(await entityIsCadenceReachable('e1', { query: fakeQuery({ rels }) }), true);
  });

  it('an unreachable org with only a broker edge → false', async () => {
    const rels = [{
      from_entity_id: 'e1', to_entity_id: 'BROKER', metadata: { role: 'listing_broker' },
      from_entity: { id: 'e1', entity_type: 'organization' },
      to_entity: { id: 'BROKER', entity_type: 'person', email: 'b@br.com' },
    }];
    assert.equal(await entityIsCadenceReachable('e1', { query: fakeQuery({ rels }) }), false);
  });

  // Fails OPEN, unlike the BD-signal gate: a transient read error must never
  // silently suppress a cadence for a genuinely reachable owner.
  it('fails OPEN (reachable) when a read errors', async () => {
    assert.equal(await entityIsCadenceReachable('e1', {
      query: fakeQuery({ fail: 'entity_relationships' }) }), true);
  });

  it('fails OPEN (reachable) when the gather throws', async () => {
    const throwing = async () => { throw new Error('db down'); };
    assert.equal(await entityIsCadenceReachable('e1', { query: throwing }), true);
  });
});

describe('cadenceSeedDecision (P112 combined auto-seed gate)', () => {
  const yes = async () => true;
  const no  = async () => false;

  it('seeds when signalled AND reachable', async () => {
    assert.deepEqual(await cadenceSeedDecision('e1', { signalCheck: yes, reachCheck: yes }),
      { seed: true, reason: 'ok' });
  });

  it('does not seed below the value floor', async () => {
    assert.deepEqual(await cadenceSeedDecision('e1', { signalCheck: no, reachCheck: yes }),
      { seed: false, reason: 'below_value_floor' });
  });

  it('does not seed an unreachable entity, and says why', async () => {
    assert.deepEqual(await cadenceSeedDecision('e1', { signalCheck: yes, reachCheck: no }),
      { seed: false, reason: 'unreachable_no_contact_method' });
  });

  it('does not seed without an entity id', async () => {
    assert.deepEqual(await cadenceSeedDecision(null, {}), { seed: false, reason: 'no_entity' });
  });
});
