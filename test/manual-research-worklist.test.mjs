// CONTACT-SELECTION Slice 4 — manual-research worklist tests.
// The pure payload builder (Google queries + breadcrumbs) + the idempotent producer.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleQueries, buildManualResearchTask, buildManualResearchProducer, MANUAL_RESEARCH_TYPE,
} from '../api/_shared/manual-research-worklist.js';

describe('buildGoogleQueries', () => {
  it('owner + state + address → 3 quoted queries', () => {
    const q = buildGoogleQueries({ owner_name: 'Carrollwood Investors LLC', owner_state: 'FL', notice_address: '12 Oak Ln, Tampa FL' });
    assert.equal(q.length, 3);
    assert.ok(q[0].includes('"Carrollwood Investors LLC"') && q[0].includes('FL'));
    assert.ok(q[1].includes('registered agent'));
    assert.ok(q[2].includes('12 Oak Ln'));
  });
  it('owner only → 2 queries (no address line)', () => {
    assert.equal(buildGoogleQueries({ owner_name: 'Clayron LP' }).length, 2);
  });
});

describe('buildManualResearchTask', () => {
  it('builds the research_tasks payload with breadcrumbs + queries', () => {
    const t = buildManualResearchTask(
      { entity_id: 'own-1', owner_name: 'Clayron LP', domain: 'dia', owner_state: 'CA', notice_address: '5 Pine St' },
      { tried: [{ method: 'cross_reference', reason: 'no_sibling' }, { method: 'sos', reason: 'unconfigured' }],
        bench: [{ name: 'X Agent Co', reason: 'agent_service' }] });
    assert.equal(t.research_type, MANUAL_RESEARCH_TYPE);
    assert.equal(t.title, 'Find a contact for Clayron LP');
    assert.equal(t.entity_id, 'own-1');
    assert.equal(t.domain, 'dia');
    assert.equal(t.source_record_id, 'own-1');
    assert.ok(t.instructions.includes('Inferred state: CA'));
    assert.ok(t.instructions.includes('5 Pine St'));
    assert.ok(t.instructions.includes('cross_reference (no_sibling)'));
    assert.ok(t.instructions.includes('X Agent Co — agent_service'));
    assert.equal(t.metadata.google_queries.length, 3);
    assert.equal(t.metadata.inferred_state, 'CA');
  });
});

describe('buildManualResearchProducer (idempotent)', () => {
  it('queues a NEW task when none open', async () => {
    let created = null;
    const p = buildManualResearchProducer({
      findOpenTask: async () => [],
      createTask: async (payload) => { created = payload; return { ok: true, data: [{ id: 'rt-1' }] }; },
      resolveWorkspace: async () => 'ws-1',
    });
    const out = await p.queue({ entity_id: 'own-1', owner_name: 'Clayron LP' }, { tried: [] });
    assert.equal(out.ok, true);
    assert.equal(out.existed, false);
    assert.equal(created.workspace_id, 'ws-1');
    assert.equal(created.status, 'queued');
  });

  it('does NOT create a duplicate when one is already open', async () => {
    let createCalls = 0;
    const p = buildManualResearchProducer({
      findOpenTask: async () => [{ id: 'rt-existing' }],
      createTask: async () => { createCalls += 1; return { ok: true }; },
    });
    const out = await p.queue({ entity_id: 'own-1', owner_name: 'Clayron LP' }, {});
    assert.equal(out.existed, true);
    assert.equal(out.taskId, 'rt-existing');
    assert.equal(createCalls, 0);
  });

  it('check reports open state', async () => {
    const p = buildManualResearchProducer({ findOpenTask: async () => [{ id: 'rt-1' }] });
    assert.equal((await p.check({ entity_id: 'own-1' })).open, true);
    const p2 = buildManualResearchProducer({ findOpenTask: async () => [] });
    assert.equal((await p2.check({ entity_id: 'own-1' })).open, false);
  });
});
