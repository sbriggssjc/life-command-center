// R41 — entity_relationships self-loop writer guard.
// insertEntityRelationship is the single choke point for creating edges; a
// self-relationship (from_entity_id === to_entity_id) is never meaningful and
// must be skipped BEFORE it reaches the DB (mirrors the DB CHECK
// chk_entity_relationships_no_self_loop).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { insertEntityRelationship } from '../api/_shared/ops-db.js';

const originalFetch = global.fetch;

describe('insertEntityRelationship self-loop guard (R41)', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('skips a self-loop without hitting the DB', async () => {
    let fetched = false;
    global.fetch = async () => { fetched = true; throw new Error('fetch should not be called'); };
    const res = await insertEntityRelationship({
      workspace_id: 'ws', from_entity_id: 'abc', to_entity_id: 'abc',
      relationship_type: 'purchases',
    });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, 'self_loop');
    assert.equal(fetched, false, 'no DB call for a self-loop');
  });

  it('skips a self-loop even when the ids differ only by type (string vs number)', async () => {
    global.fetch = async () => { throw new Error('fetch should not be called'); };
    const res = await insertEntityRelationship({
      workspace_id: 'ws', from_entity_id: 42, to_entity_id: '42',
      relationship_type: 'owns',
    });
    assert.equal(res.skipped, 'self_loop');
  });

  it('skips when an endpoint is missing', async () => {
    global.fetch = async () => { throw new Error('fetch should not be called'); };
    const res = await insertEntityRelationship({
      workspace_id: 'ws', from_entity_id: 'abc', to_entity_id: null,
      relationship_type: 'sells',
    });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, 'missing_endpoint');
  });

  it('inserts a real edge (from !== to) via the DB', async () => {
    let posted = null;
    global.fetch = async (url, opts) => {
      posted = { url, method: opts.method, body: JSON.parse(opts.body) };
      return {
        ok: true, status: 201,
        headers: { get: () => null },
        async text() { return JSON.stringify([{ id: 'rel-1' }]); },
      };
    };
    const res = await insertEntityRelationship({
      workspace_id: 'ws', from_entity_id: 'owner', to_entity_id: 'asset',
      relationship_type: 'owns',
    });
    assert.equal(res.ok, true);
    assert.ok(!res.skipped);
    assert.equal(posted.method, 'POST');
    assert.match(posted.url, /entity_relationships/);
    assert.equal(posted.body.from_entity_id, 'owner');
    assert.equal(posted.body.to_entity_id, 'asset');
  });
});
