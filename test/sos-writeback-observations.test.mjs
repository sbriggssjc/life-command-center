// ORE Option B — buildSosAddressObservations: shape the SOS-sidebar capture's
// owner-side addresses into DISTINCT observation rows (never collapse), no
// fabrication, situs never emitted (an SOS filing has none).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSosAddressObservations, SOS_OBSERVATION_SURFACE } from '../api/_shared/sos-writeback-observations.js';

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
