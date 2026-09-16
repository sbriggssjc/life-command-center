// MCP1 — get_property_context threw on an address lookup, and could not see a
// dia property that is not an LCC entity.
//
// Two defects fixed in mcp/subject-resolver.js:
//   1. `safeQuery` returned a PostgREST error BODY (an object, not an array)
//      as `data` whenever the query 400'd (e.g. an unescaped comma/period in
//      a free-text address breaking the `or=(...)` filter list). Every
//      downstream `(r.data || []).filter(...)` then crashed with
//      "filter is not a function", because the object is truthy and `|| []`
//      never fires.
//   2. A `property_id` lookup only ever checked `external_identities` (the
//      minted-entity mirror) and returned `not_on_file` for any domain
//      property outside that set, even when the domain's own `properties`
//      table has the row.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { resolveSubject } = await import('../mcp/subject-resolver.js');

function jsonRes(status, data) {
  return { ok: status >= 200 && status < 300, status, data, count: 0 };
}

describe('resolveSubject(property) — malformed-address 400 no longer throws', () => {
  it('a PostgREST 400 (error-body data) resolves not_on_file instead of throwing', async () => {
    // Mirrors a real address containing commas/periods breaking the
    // `or=(address.ilike...,name.ilike...)` filter list server-side.
    const opsQuery = async (method, path) => {
      if (String(path).startsWith('entities?entity_type=eq.asset')) {
        return jsonRes(400, { code: '42601', message: 'syntax error in filter' });
      }
      return jsonRes(200, []);
    };

    const result = await resolveSubject(
      { address: '100 E. Lehigh Ave., Philadelphia, PA' },
      { type: 'property', tool: 'get_property_context', opsQuery, domainAvailable: () => false }
    );

    assert.equal(result.status, 'not_on_file');
    assert.equal(result.error, 'Property not found');
  });
});

describe('resolveSubject(property) — direct-id domain fallback (no external_identities row)', () => {
  it('resolves a dia property_id from the domain properties table when no LCC entity is minted', async () => {
    const calls = [];
    const opsQuery = async (method, path) => {
      calls.push(path);
      if (String(path).startsWith('external_identities')) return jsonRes(200, []); // no minted entity
      return jsonRes(200, []);
    };
    const diaQuery = async (method, path) => {
      calls.push(`dia:${path}`);
      if (String(path).startsWith('properties?property_id=eq.28398')) {
        return jsonRes(200, [{ property_id: 28398, address: '123 Test St', city: 'Testville', state: 'PA' }]);
      }
      return jsonRes(200, []);
    };

    const result = await resolveSubject(
      { property_id: '28398', domain: 'dia' },
      {
        type: 'property',
        tool: 'get_property_context',
        opsQuery,
        diaQuery,
        domainAvailable: (dom) => dom === 'dia',
      }
    );

    assert.equal(result.status, 'resolved');
    assert.equal(result.entity, null);
    assert.equal(result.resolved_via, 'domain_property_direct_id');
    assert.ok(result.domain_property);
    assert.equal(result.domain_property.property_id, 28398);
    assert.equal(result.domain_property.domain, 'dia');
    assert.match(result.note, /No LCC asset entity/);
  });

  it('still returns not_on_file when the property does not exist anywhere', async () => {
    const opsQuery = async () => jsonRes(200, []);
    const diaQuery = async () => jsonRes(200, []);
    const govQuery = async () => jsonRes(200, []);

    const result = await resolveSubject(
      { property_id: '999999999' },
      { type: 'property', tool: 'get_property_context', opsQuery, diaQuery, govQuery, domainAvailable: () => true }
    );

    assert.equal(result.status, 'not_on_file');
  });
});
