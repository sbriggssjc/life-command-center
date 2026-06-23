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
  CADENCE_SIGNAL_MIN_VALUE_DEFAULT,
} from '../api/_shared/cadence-engine.js';

describe('bdSignalFromFacts (R63 Unit 1 pure classifier)', () => {
  const FLOOR = 500000;

  it('a buy_side cadence is real by construction', () => {
    assert.equal(bdSignalFromFacts({ phase: 'buy_side', floor: FLOOR }), true);
  });

  it('a Salesforce identity is a signal', () => {
    assert.equal(bdSignalFromFacts({ hasSalesforceIdentity: true, floor: FLOOR }), true);
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

  it('an SF-linked entity → signal', async () => {
    assert.equal(await entityHasBdSignal('e2', { query: fakeQuery({ sf: true }), floor: 500000 }), true);
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
