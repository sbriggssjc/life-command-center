// R59 — shared idempotent research-task producer (openResearchTask).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'k';

const { openResearchTask } = await import('../api/_shared/research-task.js');

function fakeOps(over = {}) {
  const calls = [];
  const q = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.startsWith('workspaces')) return { ok: true, data: [{ id: 'ws-1' }] };
    if (method === 'GET' && path.startsWith('research_tasks')) return over.existing || { ok: true, data: [] };
    if (method === 'POST' && path === 'research_tasks') return over.post || { ok: true, data: [{ id: 'rt-1' }] };
    return { ok: true, data: [] };
  };
  return { q, calls };
}

describe('openResearchTask', () => {
  it('creates a task with the open-source idempotency key fields', async () => {
    const { q, calls } = fakeOps();
    const r = await openResearchTask(
      { researchType: 'confirm_deed_transfer_sale', title: 'T', domain: 'gov', propertyId: 42,
        sourceTable: 'deed_extraction', metadata: { document_id: 9 } },
      { opsQuery: q });
    assert.equal(r.ok, true);
    assert.equal(r.created, true);
    const post = calls.find(c => c.method === 'POST' && c.path === 'research_tasks');
    assert.equal(post.body.research_type, 'confirm_deed_transfer_sale');
    assert.equal(post.body.domain, 'gov');
    assert.equal(post.body.source_record_id, '42');
    assert.equal(post.body.source_table, 'deed_extraction');
    assert.equal(post.body.status, 'queued');
    assert.equal(post.body.workspace_id, 'ws-1');
  });

  it('idempotent — an already-open task for the same key → no duplicate POST', async () => {
    const { q, calls } = fakeOps({ existing: { ok: true, data: [{ id: 'rt-existing' }] } });
    const r = await openResearchTask(
      { researchType: 'trace_grantee_to_parent', title: 'T', domain: 'dia', propertyId: 7 },
      { opsQuery: q });
    assert.equal(r.ok, true);
    assert.equal(r.created, false);
    assert.equal(r.duplicate, true);
    assert.equal(calls.some(c => c.method === 'POST'), false, 'no POST when one is already open');
  });

  it('a 409 race is an idempotent no-op (ok, not created)', async () => {
    const { q } = fakeOps({ post: { ok: false, status: 409, data: { code: '23505' } } });
    const r = await openResearchTask({ researchType: 'x', title: 'T', domain: 'gov', propertyId: 1 }, { opsQuery: q });
    assert.equal(r.ok, true);
    assert.equal(r.created, false);
    assert.equal(r.duplicate, true);
  });

  it('missing input → not ok, no calls', async () => {
    const { q, calls } = fakeOps();
    const r = await openResearchTask({ title: 'no type' }, { opsQuery: q });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'missing_input');
    assert.equal(calls.length, 0);
  });
});
