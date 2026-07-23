// ORE Option B — buildSosAddressObservations: shape the SOS-sidebar capture's
// owner-side addresses into DISTINCT observation rows (never collapse), no
// fabrication, situs never emitted (an SOS filing has none).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSosAddressObservations, SOS_OBSERVATION_SURFACE, computeSosNotFoundDisposition } from '../api/_shared/sos-writeback-observations.js';

describe('ORE Option B — buildSosAddressObservations', () => {
  it('emits a DISTINCT observation per owner-side address field (never collapsed)', () => {
    const cap = {
      name: 'Acme Holdings LLC',
      principal_address: '100 Principal Office Blvd, Reston, VA',
      agent_address: '200 Registered Agent Ave, Richmond, VA',
      mailing_address: '300 Mailing Rd, Denver, CO',
    };
    const obs = buildSosAddressObservations(cap);
    assert.equal(obs.length, 3);
    const byKind = Object.fromEntries(obs.map((o) => [o.kind, o.address]));
    assert.equal(byKind.principal, '100 Principal Office Blvd, Reston, VA');
    assert.equal(byKind.registered_agent, '200 Registered Agent Ave, Richmond, VA');
    assert.equal(byKind.mailing, '300 Mailing Rd, Denver, CO');
  });

  it('principal and agent addresses stay DISTINCT rows even when both present', () => {
    const obs = buildSosAddressObservations({
      principal_address: '100 Main St',
      agent_address: '999 Agent Blvd',
    });
    assert.equal(obs.length, 2);
    assert.deepEqual(obs.map((o) => o.kind).sort(), ['principal', 'registered_agent']);
  });

  it('never fabricates: absent / empty / whitespace fields yield nothing', () => {
    assert.deepEqual(buildSosAddressObservations({}), []);
    assert.deepEqual(buildSosAddressObservations({ principal_address: '   ' }), []);
    assert.deepEqual(buildSosAddressObservations(null), []);
    assert.deepEqual(buildSosAddressObservations({ agent_address: '' }), []);
  });

  it('emits only the fields present (a manager-only capture with no address → [])', () => {
    const obs = buildSosAddressObservations({ name: 'Some LLC', officers: 'Jane Doe, Manager', filing_number: 'L123' });
    assert.deepEqual(obs, []);
  });

  it('trims addresses and dedups an identical repeat within a kind', () => {
    const obs = buildSosAddressObservations({ principal_address: '  100 Main St  ' });
    assert.equal(obs.length, 1);
    assert.equal(obs[0].address, '100 Main St');
  });

  it('exports the sos_sidebar surface tag', () => {
    assert.equal(SOS_OBSERVATION_SURFACE, 'sos_sidebar');
  });
});

describe('Not-registered disposition — computeSosNotFoundDisposition (two-jurisdiction)', () => {
  it('a miss in ONE of two candidate states keeps the owner workable (not exhausted)', () => {
    const d = computeSosNotFoundDisposition({
      filingState: 'CA', assetState: 'NY', searchedState: 'CA', priorNotFound: [], at: 'T1',
    });
    assert.equal(d.searched, 'CA');
    assert.equal(d.exhausted, false);
    assert.deepEqual(d.remaining, ['NY']);
    assert.deepEqual(d.notFoundStates, [{ state: 'CA', at: 'T1' }]);
  });

  it('the SECOND miss exhausts both jurisdictions → hand back', () => {
    const d = computeSosNotFoundDisposition({
      filingState: 'CA', assetState: 'NY', searchedState: 'NY',
      priorNotFound: [{ state: 'CA', at: 'T1' }], at: 'T2',
    });
    assert.equal(d.exhausted, true);
    assert.deepEqual(d.remaining, []);
    assert.deepEqual(d.notFoundStates.map((x) => x.state).sort(), ['CA', 'NY']);
  });

  it('a single candidate state → the one miss exhausts it', () => {
    const d = computeSosNotFoundDisposition({ filingState: 'TX', assetState: null, searchedState: 'TX', priorNotFound: [] });
    assert.equal(d.exhausted, true);
    assert.deepEqual(d.remaining, []);
  });

  it('a stateless owner → a single stateless miss exhausts it', () => {
    const d = computeSosNotFoundDisposition({ filingState: null, assetState: null, searchedState: null, priorNotFound: [], at: 'T' });
    assert.equal(d.searched, null);
    assert.equal(d.exhausted, true);
    assert.deepEqual(d.notFoundStates, [{ state: '(unspecified)', at: 'T' }]);
  });

  it('the operator can search a state we did NOT derive (still counts + is a candidate)', () => {
    // Owner derives only CA; operator searched DE (a formation state we missed).
    const d = computeSosNotFoundDisposition({ filingState: 'CA', assetState: null, searchedState: 'DE', priorNotFound: [] });
    assert.deepEqual(d.remaining, ['CA']);        // CA still open
    assert.equal(d.exhausted, false);
    assert.ok(d.notFoundStates.some((x) => x.state === 'DE'));
  });

  it('is append-only + deduped: re-searching the same state does not duplicate', () => {
    const d = computeSosNotFoundDisposition({
      filingState: 'CA', assetState: 'NY', searchedState: 'CA',
      priorNotFound: [{ state: 'CA', at: 'T1' }], at: 'T2',
    });
    assert.equal(d.notFoundStates.filter((x) => x.state === 'CA').length, 1);
    assert.equal(d.exhausted, false);
  });

  it('normalizes case + whitespace on the searched state', () => {
    const d = computeSosNotFoundDisposition({ filingState: 'ca', assetState: null, searchedState: '  ca  ', priorNotFound: [] });
    assert.equal(d.searched, 'CA');
    assert.equal(d.exhausted, true);
  });
});
