// test/owner-reconcile-dequeue.test.mjs
// ============================================================================
// ORE class-fix regression: the zero-pairs branch of the owner-reconcile engine
// must DEQUEUE the queue row. Before the fix, a no-duplicate owner (the common
// case) hit `if (!pairs.length) { owners_processed++; continue; }` and was never
// marked done → re-picked every hour forever. Drives the real handler with fetch
// mocked at the network level; records the queue PATCHes.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.supabase.co';
process.env.OPS_SUPABASE_KEY = 'test-key';
delete process.env.LCC_API_KEY;        // dev-mode auth (no-credential fallback → dev user)
process.env.LCC_ENV = 'development';
process.env.ORE_USE_RESOLVER = '';     // keep the resolver name-gate out of the path

const ZERO = 'aaaaaaaa-0000-0000-0000-000000000001';  // no duplicate candidates
const PAIR = 'bbbbbbbb-0000-0000-0000-000000000002';  // has a same_party candidate

function installFetch(patched) {
  const list = (arr) => ({ ok: true, status: 200, text: async () => JSON.stringify(arr),
    headers: { get: (h) => (h === 'content-range' ? `0-${Math.max(0, arr.length - 1)}/${arr.length}` : null) } });

  global.fetch = async (url, opts) => {
    const u = String(url);
    const method = opts?.method || 'GET';
    if (method === 'PATCH' && u.includes('lcc_owner_reconcile_queue')) {
      const m = u.match(/entity_id=eq\.([^&]+)/);
      patched.push(decodeURIComponent(m ? m[1] : ''));
      return list([]);
    }
    // Queue load: two queued owners.
    if (u.includes('lcc_owner_reconcile_queue') && method === 'GET') {
      return list([{ entity_id: ZERO, reason: 'enqueued' }, { entity_id: PAIR, reason: 'enqueued' }]);
    }
    // Candidate meta enrichment.
    if (u.includes('v_lcc_owner_reconcile_candidates')) {
      return list([
        { entity_id: ZERO, owner_name: 'Solo Owner LLC', rank_value: 100, workspace_id: 'a0000000-0000-0000-0000-000000000001' },
        { entity_id: PAIR, owner_name: 'Dup Owner LLC', rank_value: 200, workspace_id: 'a0000000-0000-0000-0000-000000000001' },
      ]);
    }
    // The reconcile RPC: [] for the zero-pair owner, one same_party pair for the other.
    if (u.includes('rpc/lcc_reconcile_owner')) {
      const body = JSON.parse(opts.body || '{}');
      if (body.p_entity_id === ZERO) return list([]);
      return list([{ candidate_entity_id: 'cccccccc-0000-0000-0000-000000000003', candidate_name: 'Dup Owner LLC',
        agreeing_signals: [{ signal: 'shared_name_core' }], weighted_score: 5, threshold: 3,
        high_authority_conflict: false, verdict: 'review' }]);   // review → flagged, no merge RPC needed
    }
    // Evidence write.
    if (u.includes('lcc_owner_reconcile_evidence')) return list([]);
    return list([]);
  };
}

test('zero-pair target IS dequeued (the class fix); pairs target dequeues after evidence', async () => {
  const patched = [];
  installFetch(patched);
  const { handleOwnerReconcileEngineTick } = await import('../api/_handlers/owner-reconcile-engine.js');
  // POST (non-dry-run), source=queue, merge disabled so the review pair just records evidence.
  const req = { method: 'POST', query: { source: 'queue', merge: '0', limit: '100' }, headers: {}, body: {} };
  let out = null;
  const res = { status(c) { this._s = c; return this; }, json(p) { out = { status: this._s || 200, body: p }; return this; },
    setHeader() { return this; }, set() { return this; }, getHeader() { return null; } };
  await handleOwnerReconcileEngineTick(req, res);

  assert.ok(out && out.body, 'handler returned a body');
  assert.equal(out.body.owners_processed, 2, 'both owners processed');
  assert.ok(patched.includes(ZERO), 'the ZERO-pair owner was dequeued (regression: it never was before)');
  assert.ok(patched.includes(PAIR), 'the pairs owner was dequeued after recording evidence');
  assert.equal(patched.length, 2, 'exactly two dequeues, one per queued owner');
});
