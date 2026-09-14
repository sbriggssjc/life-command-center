// W7.3 — guards logManualCallNote + structureCallNotes (path A + B spine writer)
// and the shared deal-resolve helpers. Pure logic over injected deps (no live
// DB / AI).
//
// Invariants:
//   1. A quick-log stamps the deal the operator chose (entity_id = deal;
//      metadata.deal_entity_id + party_entity_id) on a `call` activity.
//   2. Empty notes are skipped (no empty call rows).
//   3. Dedup external_id is deterministic (same notes → same key).
//   4. AI-fail (structuring throws / returns null) still logs the RAW notes.
//   5. A fresh insert with an anchor drives the Phase-1 to-do path.
//   6. structureCallNotes is gated: no OLLAMA_URL → null (proposal-only).
//   7. resolveDealByQuery: >1 candidate → ambiguous (never guesses); exact wins.
//   8. decideCommTagOutcome: same→already, different→conflict, none→stamp.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logManualCallNote, structureCallNotes } from '../api/_shared/intake-correspondence.js';
import { resolveDealByQuery, decideCommTagOutcome, parseLccCategoryHint } from '../api/_shared/deal-resolve.js';

function harness() {
  const calls = { append: [], rpc: [] };
  const deps = {
    resolveWorkspace: async () => 'WS-1',
    appendActivityEvent: async (row) => { calls.append.push(row); return { ok: true, inserted: true, id: 'A1' }; },
    opsQuery: async (m, path, body) => { calls.rpc.push({ path, body }); return { ok: true, data: [] }; },
    structureCallNotes: async () => null,   // AI off by default in tests
  };
  return { deps, calls };
}

describe('logManualCallNote', () => {
  it('stamps the operator-chosen deal on a call activity', async () => {
    const { deps, calls } = harness();
    const r = await logManualCallNote({
      workspaceId: 'WS-1', actorId: 'U1',
      dealEntityId: 'DEAL-7', partyEntityId: 'PARTY-2',
      direction: 'made', notes: 'Told them we would send the OM.', contactName: 'Jane',
      occurredAt: '2026-08-06T10:00:00Z',
    }, deps);
    assert.equal(r.ok, true);
    assert.equal(r.inserted, true);
    assert.equal(r.deal_entity_id, 'DEAL-7');
    const row = calls.append[0];
    assert.equal(row.category, 'call');
    assert.equal(row.sourceType, 'manual_call');
    assert.equal(row.entityId, 'DEAL-7');
    assert.equal(row.metadata.deal_entity_id, 'DEAL-7');
    assert.equal(row.metadata.party_entity_id, 'PARTY-2');
    assert.equal(row.metadata.direction, 'outbound');       // made → outbound
    assert.equal(row.body, 'Told them we would send the OM.');
    // Phase-1 to-do path fires (anchor present + fresh insert).
    assert.ok(calls.rpc.some(c => c.path.includes('lcc_advance_todos') && c.body.p_channel === 'call'));
  });

  it('skips empty notes', async () => {
    const { deps, calls } = harness();
    const r = await logManualCallNote({ workspaceId: 'WS-1', actorId: 'U1', notes: '   ' }, deps);
    assert.equal(r.skipped, 'no_notes');
    assert.equal(calls.append.length, 0);
  });

  it('derives a deterministic dedup key from the same notes', async () => {
    const { deps: d1, calls: c1 } = harness();
    const { deps: d2, calls: c2 } = harness();
    const args = { workspaceId: 'WS-1', actorId: 'USER-ABC', notes: 'same note', occurredAt: '2026-08-06T10:00:00Z' };
    await logManualCallNote(args, d1);
    await logManualCallNote(args, d2);
    assert.equal(c1.append[0].externalId, c2.append[0].externalId);
    // A different note gets a different key.
    const { deps: d3, calls: c3 } = harness();
    await logManualCallNote({ ...args, notes: 'other note' }, d3);
    assert.notEqual(c3.append[0].externalId, c1.append[0].externalId);
  });

  it('logs raw notes even when structuring throws (AI-fail is non-blocking)', async () => {
    const { deps, calls } = harness();
    deps.structureCallNotes = async () => { throw new Error('ollama down'); };
    const r = await logManualCallNote({
      workspaceId: 'WS-1', actorId: 'U1', dealEntityId: 'D', notes: 'raw call content', structure: true,
    }, deps);
    assert.equal(r.ok, true);
    assert.equal(calls.append[0].body, 'raw call content');
    assert.equal(calls.append[0].metadata.structured, null);
  });

  it('logs on the relationship with no deal anchor (no to-do without an anchor)', async () => {
    const { deps, calls } = harness();
    const r = await logManualCallNote({ workspaceId: 'WS-1', actorId: 'U1', notes: 'cold call, no match' }, deps);
    assert.equal(r.ok, true);
    assert.equal(calls.append[0].entityId, undefined === calls.append[0].entityId ? undefined : null); // null
    assert.equal(calls.append[0].metadata.deal_entity_id, null);
    assert.ok(!calls.rpc.some(c => c.path.includes('lcc_advance_todos')), 'no anchor → no to-do advance');
  });
});

describe('structureCallNotes (proposal-only, gated)', () => {
  it('returns null when OLLAMA_URL is unset', async () => {
    const saved = process.env.OLLAMA_URL;
    delete process.env.OLLAMA_URL;
    const r = await structureCallNotes('Discussed price with Bob; will send OM Friday.');
    assert.equal(r, null);
    if (saved !== undefined) process.env.OLLAMA_URL = saved;
  });

  it('parses model JSON when configured, empty arrays for unstated fields', async () => {
    const saved = process.env.OLLAMA_URL;
    process.env.OLLAMA_URL = 'http://localhost:11434';
    const invokeExtractionAI = async () => ({ ok: true, data: { response: '```json\n{"participants":["Bob"],"topics":["price"],"commitments":[]}\n```' } });
    const r = await structureCallNotes('call notes', { invokeExtractionAI });
    assert.deepEqual(r.participants, ['Bob']);
    assert.deepEqual(r.topics, ['price']);
    assert.deepEqual(r.commitments, []);
    if (saved === undefined) delete process.env.OLLAMA_URL; else process.env.OLLAMA_URL = saved;
  });
});

describe('resolveDealByQuery (never guesses)', () => {
  function opsFor(entities, openIds = []) {
    return async (m, path) => {
      if (path.startsWith('entities?')) return { ok: true, data: entities };
      if (path.startsWith('bd_opportunities?')) return { ok: true, data: openIds.map(id => ({ entity_id: id })) };
      return { ok: true, data: [] };
    };
  }
  it('returns ambiguous + candidates when >1 open deal matches', async () => {
    const ents = [
      { id: 'E1', name: 'DaVita Tulsa', city: 'Tulsa', state: 'OK' },
      { id: 'E2', name: 'DaVita Norman', city: 'Norman', state: 'OK' },
    ];
    const r = await resolveDealByQuery('DaVita', { opsQuery: opsFor(ents, ['E1', 'E2']) });
    assert.equal(r.matched, 'ambiguous');
    assert.equal(r.ambiguous, true);
    assert.equal(r.candidates.length, 2);
    assert.equal(r.deal_entity_id, undefined);
  });
  it('an exact normalized-name match wins outright', async () => {
    const ents = [
      { id: 'E1', name: 'DaVita Tulsa', city: 'Tulsa', state: 'OK' },
      { id: 'E2', name: 'DaVita Tulsa Central', city: 'Tulsa', state: 'OK' },
    ];
    const r = await resolveDealByQuery('davita tulsa', { opsQuery: opsFor(ents, ['E1', 'E2']) });
    assert.equal(r.matched, 'exact');
    assert.equal(r.deal_entity_id, 'E1');
  });
  it('none when nothing matches', async () => {
    const r = await resolveDealByQuery('Nope', { opsQuery: opsFor([], []) });
    assert.equal(r.matched, 'none');
  });
});

describe('decideCommTagOutcome + parseLccCategoryHint', () => {
  it('idempotent same-deal → already; cross-deal → conflict; unstamped → stamp', () => {
    assert.equal(decideCommTagOutcome('D1', 'D1'), 'already');
    assert.equal(decideCommTagOutcome('D1', 'D2'), 'conflict');
    assert.equal(decideCommTagOutcome(null, 'D2'), 'stamp');
  });
  it('parses LCC / LCC:<hint> categories', () => {
    assert.deepEqual(parseLccCategoryHint(['Blue', 'LCC']), { tagged: true, hint: null });
    assert.deepEqual(parseLccCategoryHint(['LCC: DaVita Tulsa']), { tagged: true, hint: 'DaVita Tulsa' });
    assert.deepEqual(parseLccCategoryHint(['Red', 'Green']), { tagged: false, hint: null });
  });
});
