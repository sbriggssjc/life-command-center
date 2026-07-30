// Guards logCallDualAnchor — the telephony mirror of the email dual-anchor
// loggers. Pure logic over injected deps (no live DB / WebEx).
//
// Invariants:
//   1. A call resolves the caller's PARTY + OPEN deal by phone and stamps BOTH
//      (entity_id = open deal; metadata.party_entity_id + deal_entity_id).
//   2. category='call', source_type='<sys>_call'; direction inferred
//      (placed/received → outbound/inbound).
//   3. A sub-10-digit phone is skipped (no junk call rows).
//   4. A resolver miss still logs the raw call with null anchors (back-fillable).
//   5. Dedup external_id is deterministic (sys:last10:time) when none supplied.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logCallDualAnchor } from '../api/_shared/intake-correspondence.js';

function harness(packet) {
  const calls = { append: [], resolve: [] };
  const deps = {
    resolveWorkspace: async () => 'a0000000-0000-0000-0000-000000000001',
    opsQuery: async (_m, path, body) => { calls.resolve.push({ path, body }); return { ok: true, data: [packet || {}] }; },
    appendActivityEvent: async (row) => { calls.append.push(row); return { ok: true, inserted: true, id: 'C1' }; },
  };
  return { deps, calls };
}

describe('logCallDualAnchor', () => {
  it('stamps the dual anchor for a resolvable caller', async () => {
    const { deps, calls } = harness({ party_entity_id: 'PARTY-9', primary_deal: 'DEAL-3' });
    const r = await logCallDualAnchor({
      call: { phone: '(720) 631-0270', name: 'Susan Holdsworth', direction: 'received',
              occurred_at: '2026-07-30T12:00:00Z', duration_seconds: 320, disposition: 'answered' },
    }, deps);
    assert.equal(r.ok, true);
    assert.equal(r.party_entity_id, 'PARTY-9');
    assert.equal(r.deal_entity_id, 'DEAL-3');
    const row = calls.append[0];
    assert.equal(row.category, 'call');
    assert.equal(row.sourceType, 'webex_call');
    assert.equal(row.entityId, 'DEAL-3');
    assert.equal(row.metadata.party_entity_id, 'PARTY-9');
    assert.equal(row.metadata.direction, 'inbound');           // received → inbound
    assert.equal(calls.resolve[0].body.p_phone, '(720) 631-0270');
  });

  it('infers outbound for a placed call and builds a deterministic external_id', async () => {
    const { deps, calls } = harness({ party_entity_id: 'P', primary_deal: 'D' });
    await logCallDualAnchor({
      call: { phone: '918-794-9787', direction: 'placed', occurred_at: '2026-07-30T13:00:00Z', source_system: 'webex' },
    }, deps);
    const row = calls.append[0];
    assert.equal(row.metadata.direction, 'outbound');
    assert.equal(row.externalId, 'webex:9187949787:2026-07-30T13:00:00Z');
    assert.equal(row.title, 'Call to 918-794-9787');           // no name → phone
    // an outbound call auto-resolves "reach out" to-dos (multi-channel loop)
    assert.ok(calls.resolve.some(c => c.path.includes('lcc_autoresolve_todos') && c.body.p_direction === 'outbound'),
      'outbound call should invoke lcc_autoresolve_todos');
  });

  it('does NOT auto-resolve on an inbound (received) call', async () => {
    const { deps, calls } = harness({ party_entity_id: 'P', primary_deal: 'D' });
    await logCallDualAnchor({
      call: { phone: '303-876-1155', direction: 'received', occurred_at: '2026-07-30T15:00:00Z' },
    }, deps);
    assert.ok(!calls.resolve.some(c => c.path.includes('lcc_autoresolve_todos')),
      'received call must not auto-resolve a follow_up (you did not reach out)');
  });

  it('skips a sub-10-digit phone', async () => {
    const { deps, calls } = harness({ party_entity_id: 'X' });
    const r = await logCallDualAnchor({ call: { phone: '123' } }, deps);
    assert.equal(r.skipped, 'no_phone');
    assert.equal(calls.append.length, 0);
  });

  it('logs the raw call with null anchors when the resolver finds nothing', async () => {
    const { deps, calls } = harness({});
    const r = await logCallDualAnchor({
      call: { phone: '303-876-1155', direction: 'received', occurred_at: '2026-07-30T14:00:00Z' },
    }, deps);
    assert.equal(r.ok, true);
    assert.equal(r.party_entity_id, null);
    assert.equal(calls.append[0].entityId, null);
    assert.equal(calls.append[0].metadata.party_entity_id, null);
  });
});
