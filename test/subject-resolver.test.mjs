import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSubject } from '../mcp/subject-resolver.js';

function makeOpsQuery(routes) {
  return async (method, path) => {
    if (method === 'POST') return { ok: true, data: [] };
    for (const [needle, data] of routes) {
      if (path.includes(needle)) return { ok: true, data };
    }
    if (path.startsWith('v_priority_queue_enriched')) return { ok: true, data: [] };
    return { ok: true, data: [] };
  };
}

test('resolveSubject property surfaces duplicate-name matches as ambiguous', async () => {
  const opsQuery = makeOpsQuery([
    ['entities?entity_type=eq.asset&or=', [
      { id: '35724', entity_type: 'asset', name: 'Woodland Hills', address: '100 Main St', city: 'Woodland Hills', state: 'CA', domain: 'dia' },
      { id: '29882', entity_type: 'asset', name: 'Woodland Hills', address: '200 Main St', city: 'Woodland Hills', state: 'CA', domain: 'gov' },
    ]],
  ]);

  const out = await resolveSubject(
    { address: 'Woodland Hills' },
    { type: 'property', tool: 'get_property_context', opsQuery, log: async () => {} }
  );

  assert.equal(out.status, 'ambiguous');
  assert.equal(out.type, 'asset');
  assert.deepEqual(out.candidates.map((c) => c.entity_id).sort(), ['29882', '35724']);
});

test('resolveSubject property resolves a clean single match with resolved_via', async () => {
  const opsQuery = makeOpsQuery([
    ['entities?entity_type=eq.asset&or=', [
      { id: '23654', entity_type: 'asset', name: '207 Fob James Dr', address: '207 Fob James Dr', city: 'Valley', state: 'AL', domain: 'dia' },
    ]],
  ]);

  const out = await resolveSubject(
    { address: '207 Fob James Dr' },
    { type: 'property', tool: 'get_property_context', opsQuery, log: async () => {} }
  );

  assert.equal(out.status, 'resolved');
  assert.equal(out.entity.id, '23654');
  assert.equal(out.resolved_via, 'asset_address_name');
  assert.equal(out.candidates.length, 1);
});

test('resolveSubject contact refuses duplicate email matches instead of choosing best', async () => {
  const opsQuery = makeOpsQuery([
    ['entities?entity_type=eq.person&email=eq.', [
      { id: 'person-a', entity_type: 'person', name: 'Alex Lee', email: 'alex@example.com' },
      { id: 'person-b', entity_type: 'person', name: 'Alex Lee Jr.', email: 'alex@example.com' },
    ]],
  ]);

  const out = await resolveSubject(
    { email: 'alex@example.com' },
    { type: 'contact', tool: 'get_contact_context', opsQuery, log: async () => {} }
  );

  assert.equal(out.status, 'ambiguous');
  assert.equal(out.resolved_via, 'email');
  assert.deepEqual(out.candidates.map((c) => c.entity_id).sort(), ['person-a', 'person-b']);
});

