// test/deal-email-match-cron.test.mjs
// ============================================================================
// W7.1 — end-to-end test of the deal-email-matcher cron wrapper against the REAL
// api/_shared/ops-db.js opsQuery, mocked at the FETCH level (not a hand-rolled
// opsQuery). This is the regression guard for the "object is not iterable" crash:
// the matcher runs `for (const m of (cand.data||[]))`, and ops-db's default
// `count=exact` GET made that candidate query time out and return a non-array
// error object, killing the run. The compat shim (countMode:'none' + non-array
// coercion) must let the matcher complete and land stats in the run log.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.supabase.co';
process.env.OPS_SUPABASE_KEY = 'test-key';
process.env.DEAL_EMAIL_MATCH_ENABLED = '1';

const DEAL = 'c3bc3125-c9b9-4c7b-801d-b1d4bf715f59';

// Install a fetch mock that emulates PostgREST, including the failure mode:
// a GET carrying `count=exact` (the ops-db default) 5xx's with an error OBJECT,
// while the same GET with `count=none`/no-count succeeds with a real array.
function installFetch({ recorder } = {}) {
  const list = (arr) => ({ ok: true, status: 200, text: async () => JSON.stringify(arr),
    headers: { get: (h) => (h === 'content-range' ? `0-${Math.max(0, arr.length - 1)}/${arr.length}` : null) } });
  const errObj = (status) => ({ ok: false, status, text: async () =>
    JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout' }),
    headers: { get: () => null } });

  global.fetch = async (url, opts) => {
    const u = String(url);
    const prefer = (opts?.headers?.Prefer || opts?.headers?.prefer || '');
    if (recorder) recorder.push({ u, method: opts?.method, prefer });
    if (u.includes('lcc_users')) return list([{ lcc_user_id: 'u1' }]);
    if (u.includes('bd_opportunities')) return list([{ entity_id: DEAL, sf_opp_id: 'sf1', owner_user_id: 'u1', metadata: {} }]);
    if (u.includes('entities?id=in')) return list([{ id: DEAL, name: 'DaVita Dialysis - Queens - NY', city: 'Queens', state: 'NY' }]);
    if (u.includes('source_type=eq.outlook')) {
      // The crash trigger: exact-count candidate query times out (non-array 5xx).
      if (prefer.includes('count=exact')) return errObj(500);
      return list([{ id: 'ae1', entity_id: 'p1', title: 'OM for the DaVita in Queens, NY',
        body: 'DaVita Queens', occurred_at: '2026-01-01', external_id: 'm1', domain: null }]);
    }
    if (u.includes('lcc_deal_match_run_log')) return list([{ run_id: 99 }]);
    // idempotency check, roster-edge existence, POST inserts, health alerts → empty/ok
    return list([]);
  };
}

test('cron wrapper completes and lands stats (count=exact crash is fixed by the shim)', async () => {
  const recorder = [];
  installFetch({ recorder });
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  let out = null;
  const res = { status(c) { this._s = c; return this; }, json(p) { out = { status: this._s || 200, body: p }; return this; } };
  await handleDealEmailMatchCron({ query: {}, body: {} }, res);

  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true, 'run should be ok — the non-array count=exact response must not crash it');
  assert.equal(out.body.deals_scanned, 1, 'the DaVita Queens deal is scanned');
  assert.equal(out.body.emails_attributed, 1, 'the matching email is attributed');
  assert.equal(out.body.run_id, 99, 'a run-log row is written');

  // The shim must have driven the candidate GET WITHOUT count=exact.
  const candCalls = recorder.filter(c => c.u.includes('source_type=eq.outlook'));
  assert.ok(candCalls.length >= 1, 'candidate query ran');
  assert.ok(candCalls.every(c => !String(c.prefer).includes('count=exact')),
    'candidate GETs must not carry count=exact (that is the timeout that returned a non-array)');
});

test('a non-array GET still degrades gracefully instead of throwing', async () => {
  // Force EVERY candidate GET to return a non-array, even without count=exact,
  // to prove the defensive coercion (not just the count fix) holds.
  const list = (arr) => ({ ok: true, status: 200, text: async () => JSON.stringify(arr),
    headers: { get: (h) => (h === 'content-range' ? `0-0/${arr.length}` : null) } });
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('lcc_users')) return list([{ lcc_user_id: 'u1' }]);
    if (u.includes('bd_opportunities')) return list([{ entity_id: DEAL, sf_opp_id: 'sf1', owner_user_id: 'u1', metadata: {} }]);
    if (u.includes('entities?id=in')) return list([{ id: DEAL, name: 'DaVita Dialysis - Queens - NY', city: 'Queens', state: 'NY' }]);
    if (u.includes('source_type=eq.outlook')) return { ok: false, status: 500,
      text: async () => JSON.stringify({ message: 'boom' }), headers: { get: () => null } };
    if (u.includes('lcc_deal_match_run_log')) return list([{ run_id: 7 }]);
    return list([]);
  };
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  let out = null;
  const res = { status(c) { this._s = c; return this; }, json(p) { out = { status: this._s || 200, body: p }; return this; } };
  await handleDealEmailMatchCron({ query: {}, body: {} }, res);
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true, 'a non-array candidate read degrades to zero matches, not a crash');
  assert.equal(out.body.deals_scanned, 1);
  assert.equal(out.body.emails_attributed, 0, 'no candidates → nothing attributed');
});
