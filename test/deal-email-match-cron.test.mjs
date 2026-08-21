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

test('a failed candidate READ is an ERROR, not a silent "this deal has no mail"', async () => {
  // Force EVERY candidate GET to fail with a non-array body, even without count=exact.
  // Two things must hold, and they are DIFFERENT properties:
  //   1. it must not crash (the defensive non-array coercion, not just the count fix);
  //   2. it must report ok=false. P123 changed this deliberately — v2.1 swallowed a
  //      failed read as `cand.data || []`, so a broken query was indistinguishable from
  //      a quiet inbox and the run still reported healthy.
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
  assert.equal(out.status, 200, 'still answers 200 — it must never throw at the route');
  assert.equal(out.body.ok, false, 'a failed read is an error, never "no mail for this deal"');
  assert.ok((out.body.errors || []).length > 0, 'the failure is recorded, not swallowed');
  assert.equal(out.body.emails_attributed, 0, 'and nothing is attributed off a failed read');
});

// ── P123 regression guards ──────────────────────────────────────────────────
// The live break: the handler took ~75-90 s against lcc_cron_post's 60 s pg_net
// window, so EVERY hourly call recorded `no_response` while the work quietly
// succeeded. The cost was ~680 sequential per-email round trips (one idempotency
// GET + one roster-edge GET per match) spent rediscovering already-done work.

// Fixture: one deal, N already-attributed emails. Records every request so we can
// assert on the ROUND-TRIP SHAPE, which is what actually blew the response window.
function installBulkFetch({ matchCount, recorder, runId = 42, edgesExist = true }) {
  const emails = Array.from({ length: matchCount }, (_, i) => ({
    id: `ae${i}`, entity_id: `person${i}`, title: `DaVita Queens update ${i}`,
    body: 'DaVita Queens', occurred_at: '2026-01-01', external_id: `m${i}`, domain: null,
  }));
  const list = (arr) => ({ ok: true, status: 200, text: async () => JSON.stringify(arr),
    headers: { get: (h) => (h === 'content-range' ? `0-${Math.max(0, arr.length - 1)}/${arr.length}` : null) } });
  global.fetch = async (url, opts) => {
    const u = String(url);
    const method = opts?.method || 'GET';
    recorder.push({ u, method });
    if (u.includes('lcc_users')) return list([{ lcc_user_id: 'u1' }]);
    if (u.includes('bd_opportunities')) return list([{ entity_id: DEAL, sf_opp_id: 'sf1', owner_user_id: 'u1', metadata: {} }]);
    if (u.includes('entities?id=in')) return list([{ id: DEAL, name: 'DaVita Dialysis - Queens - NY', city: 'Queens', state: 'NY' }]);
    // Bulk prefetch of already-attributed external_ids.
    if (u.includes('source_type=eq.lcc%3Adeal_match') && u.includes('select=external_id')) {
      return list(emails.map(e => ({ external_id: e.external_id })));
    }
    // Bulk prefetch of existing deal_party edges. Default TRUE because that is the live
    // steady state — every roster edge already exists, which is precisely why v2.1 burned
    // ~680 round trips per hour discovering nothing.
    if (u.includes('entity_relationships') && u.includes('from_entity_id=in.')) {
      return list(edgesExist ? emails.map(e => ({ from_entity_id: DEAL, to_entity_id: e.entity_id })) : []);
    }
    if (u.includes('source_type=eq.outlook')) {
      const offset = Number((u.match(/offset=(\d+)/) || [])[1] || 0);
      return list(offset === 0 ? emails : []);
    }
    if (u.includes('lcc_deal_match_run_log')) return list([{ run_id: runId, cursor_end: 0 }]);
    return list([]);
  };
}

test('P123: already-attributed emails cost ZERO per-email round trips', async () => {
  const recorder = [];
  installBulkFetch({ matchCount: 50, recorder });
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  let out = null;
  const res = { status(c) { this._s = c; return this; }, json(p) { out = { status: this._s || 200, body: p }; return this; } };
  await handleDealEmailMatchCron({ query: {}, body: {} }, res);

  assert.equal(out.body.ok, true);
  assert.equal(out.body.already_attributed, 50, 'all 50 recognised as already attributed');
  assert.equal(out.body.emails_attributed, 0, 'and none re-written');
  assert.equal(out.body.roster_edges, 0, 'and no edge re-written — this is the live steady state');

  // THE GUARD. v2.1 issued one `external_id=eq.<key>` GET per match; that N+1 is what
  // took the run past 60 s. There must now be exactly ZERO of them.
  const perEmailIdemGets = recorder.filter(c =>
    c.method === 'GET' && c.u.includes('source_type=eq.lcc%3Adeal_match') && c.u.includes('external_id=eq.'));
  assert.equal(perEmailIdemGets.length, 0,
    'per-email idempotency GETs must be replaced by ONE bulk prefetch');

  // Likewise the per-match roster-edge existence probe.
  const perEdgeGets = recorder.filter(c =>
    c.method === 'GET' && c.u.includes('entity_relationships') && c.u.includes('to_entity_id=eq.'));
  assert.equal(perEdgeGets.length, 0, 'per-match roster-edge GETs must be replaced by ONE bulk prefetch');

  // Total request count must not scale with the match count.
  // In steady state the whole run is a fixed handful of reads regardless of match count.
  // v2.1 would have issued 100+ here; the live run issued ~680.
  assert.ok(recorder.length < 15,
    `total round trips must not scale with matches (got ${recorder.length} for 50 matches)`);
});

test('P123: a failed PREFETCH aborts the run — it never assumes "nothing is attributed"', async () => {
  // Failing closed matters: assuming an empty attributed-set would re-POST every match
  // against the unique index and report a fabricated emails_attributed delta.
  const recorder = [];
  installBulkFetch({ matchCount: 10, recorder });
  const inner = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('source_type=eq.lcc%3Adeal_match') && u.includes('select=external_id')) {
      return { ok: false, status: 500, text: async () => JSON.stringify({ message: 'prefetch boom' }),
        headers: { get: () => null } };
    }
    return inner(url, opts);
  };
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  let out = null;
  const res = { status(c) { this._s = c; return this; }, json(p) { out = { status: this._s || 200, body: p }; return this; } };
  await handleDealEmailMatchCron({ query: {}, body: {} }, res);

  assert.equal(out.body.ok, false, 'a failed prefetch must fail the run');
  assert.equal(out.body.emails_attributed, 0, 'and must NOT write anything');
  const posts = recorder.filter(c => c.method === 'POST' && c.u.includes('activity_events'));
  assert.equal(posts.length, 0, 'no activity_events written after a failed prefetch');
});

test('P123: the run-log row is OPENED before the work and CLOSED after it', async () => {
  const recorder = [];
  installBulkFetch({ matchCount: 3, recorder });
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  const res = { status(c) { this._s = c; return this; }, json() { return this; } };
  await handleDealEmailMatchCron({ query: {}, body: {} }, res);

  const logCalls = recorder.filter(c => c.u.includes('lcc_deal_match_run_log'));
  const openIdx = logCalls.findIndex(c => c.method === 'POST');
  const closeIdx = logCalls.findIndex(c => c.method === 'PATCH');
  assert.ok(openIdx >= 0, 'a run-log row is INSERTed');
  assert.ok(closeIdx >= 0, 'and PATCHed closed');
  assert.ok(openIdx < closeIdx, 'the open must precede the close');

  // The open must come before the matcher touches activity_events at all — that is what
  // makes a dropped run (pg_net timeout / crash) leave a `started` row behind instead of
  // no trace at all.
  const openPos = recorder.findIndex(c => c.u.includes('lcc_deal_match_run_log') && c.method === 'POST');
  const firstWork = recorder.findIndex(c => c.u.includes('source_type=eq.outlook'));
  assert.ok(openPos >= 0 && firstWork > openPos, 'the row is opened BEFORE the candidate scan');
});

test('P123: the candidate query carries BOTH core tenant and city to the DB', async () => {
  // v2.1 sent only the core tenant and filtered city in memory, so a common core pulled a
  // whole 1000-row page of full email bodies and truncated real matches past the cap.
  const recorder = [];
  installBulkFetch({ matchCount: 2, recorder });
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  const res = { status(c) { this._s = c; return this; }, json() { return this; } };
  await handleDealEmailMatchCron({ query: {}, body: {} }, res);

  const cand = recorder.find(c => c.u.includes('source_type=eq.outlook'));
  assert.ok(cand, 'a candidate query ran');
  const decoded = decodeURIComponent(cand.u);
  // coreTenantOf strips generic descriptors, so the core of "DaVita Dialysis - Queens - NY"
  // is "DaVita" — that is the v2.1 recall win and it is unchanged by P123.
  assert.ok(decoded.includes('DaVita'), 'core tenant is pushed to the DB');
  assert.ok(decoded.includes('Queens'), 'and so is the city — not filtered only in memory');
  // Every multi-row read must page at exactly 1000: PostgREST caps a response at 1000
  // rows regardless of `limit=`, so the old `limit=1200` silently dropped rows.
  assert.ok(/limit=1000(&|$)/.test(cand.u), `candidate read must page at 1000, got ${cand.u}`);
});

test('P123: the DEADLINE stops the run on a deal boundary and hands over a cursor', async () => {
  const recorder = [];
  installBulkFetch({ matchCount: 1, recorder });
  const inner = global.fetch;
  // Real elapsed time, so a 1 ms deadline is deterministically spent by the time the
  // first deal comes up. (Without this the whole mocked run can finish inside one
  // millisecond and the deadline never fires — a race in the TEST, not the engine.)
  global.fetch = async (url, opts) => {
    if (String(url).includes('entities?id=in')) await new Promise(r => setTimeout(r, 5));
    return inner(url, opts);
  };
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  let out = null;
  const res = { status(c) { this._s = c; return this; }, json(p) { out = { status: this._s || 200, body: p }; return this; } };
  await handleDealEmailMatchCron({ query: { deadline_ms: 1 }, body: {} }, res);

  assert.equal(out.status, 200, 'a budget stop still returns inside the window');
  assert.equal(out.body.budget_stopped, true, 'and says so out loud — never a silent cap');
  assert.equal(out.body.deals_scanned, 0, 'no deal was started that could not be finished');
  assert.equal(typeof out.body.cursor_end, 'number', 'the next run gets a resume point');
});

test('P123: the WRITE CAP stops the run and the cursor points at the unfinished deal', async () => {
  // Deterministic (no timing): two deals, one new attribution each, max_writes=1.
  const DEAL_B = 'd4cd4236-daca-5d8e-912e-c2e5cf826a6a';
  const emails = {
    [DEAL]: { id: 'aeA', entity_id: null, title: 'DaVita Queens tour', body: 'DaVita Queens',
      occurred_at: '2026-01-01', external_id: 'mA', domain: null },
    [DEAL_B]: { id: 'aeB', entity_id: null, title: 'Fresenius Rome LOI', body: 'Fresenius Rome',
      occurred_at: '2026-01-02', external_id: 'mB', domain: null },
  };
  const list = (arr) => ({ ok: true, status: 200, text: async () => JSON.stringify(arr),
    headers: { get: (h) => (h === 'content-range' ? `0-${Math.max(0, arr.length - 1)}/${arr.length}` : null) } });
  const recorder = [];
  global.fetch = async (url, opts) => {
    const u = String(url); const method = opts?.method || 'GET';
    recorder.push({ u, method });
    if (u.includes('lcc_users')) return list([{ lcc_user_id: 'u1' }]);
    if (u.includes('bd_opportunities')) return list([
      { entity_id: DEAL, sf_opp_id: 'sfA', owner_user_id: 'u1', metadata: {} },
      { entity_id: DEAL_B, sf_opp_id: 'sfB', owner_user_id: 'u1', metadata: {} }]);
    if (u.includes('entities?id=in')) return list([
      { id: DEAL, name: 'DaVita Dialysis - Queens - NY', city: 'Queens', state: 'NY' },
      { id: DEAL_B, name: 'Fresenius - Rome - GA', city: 'Rome', state: 'GA' }]);
    if (u.includes('source_type=eq.lcc%3Adeal_match') && u.includes('select=external_id')) return list([]);
    if (u.includes('entity_relationships') && u.includes('from_entity_id=in.')) return list([]);
    if (u.includes('source_type=eq.outlook')) {
      const offset = Number((u.match(/offset=(\d+)/) || [])[1] || 0);
      if (offset > 0) return list([]);
      const d = decodeURIComponent(u).includes('Fresenius') ? DEAL_B : DEAL;
      return list([emails[d]]);
    }
    if (u.includes('lcc_deal_match_run_log')) return list([{ run_id: 55, cursor_end: 0 }]);
    return list([]);
  };
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  let out = null;
  const res = { status(c) { this._s = c; return this; }, json(p) { out = { status: this._s || 200, body: p }; return this; } };
  await handleDealEmailMatchCron({ query: { max_writes: 1 }, body: {} }, res);

  assert.equal(out.body.deals_total, 2, 'both deals are eligible');
  assert.equal(out.body.deals_scanned, 1, 'only one is worked under a 1-write cap');
  assert.equal(out.body.emails_attributed, 1, 'exactly one write happened');
  assert.equal(out.body.budget_stopped, true, 'the cap is reported, never silent');
  assert.equal(out.body.cursor_end, 1, 'the next run resumes at the deal we did not reach');
});

test('P123: the cursor WRAPS so a later run comes back round to deal 0', async () => {
  const recorder = [];
  // Last completed run stopped at the end of a 1-deal list; cursor_end wraps to 0.
  installBulkFetch({ matchCount: 2, recorder, runId: 61 });
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  let out = null;
  const res = { status(c) { this._s = c; return this; }, json(p) { out = { status: this._s || 200, body: p }; return this; } };
  await handleDealEmailMatchCron({ query: {}, body: {} }, res);
  assert.equal(out.body.deals_scanned, 1, 'the single eligible deal is worked');
  assert.equal(out.body.cursor_end, 0, 'cursor wraps modulo the eligible-deal count');
  assert.equal(out.body.budget_stopped, false, 'a full pass is not a budget stop');
});

test('P123b: a core tenant containing a COMMA is double-quoted, not left to split the logic tree', async () => {
  // Live-caught 2026-08-21. PostgREST parses the and()/or() logic tree AFTER percent-decoding,
  // so encodeURIComponent does NOT protect a comma: it decodes back to `,` and splits the
  // argument list. All 5 address-named deals whose core carries a comma returned HTTP 400 on
  // BOTH the nested filter and v2.1's core-only shape — i.e. v2.1 had been silently skipping
  // them as "this deal has no mail". Exact partition live: 5 comma cores fail, 32 clean pass.
  const recorder = [];
  const list = (arr) => ({ ok: true, status: 200, text: async () => JSON.stringify(arr),
    headers: { get: (h) => (h === 'content-range' ? `0-${Math.max(0, arr.length - 1)}/${arr.length}` : null) } });
  global.fetch = async (url, opts) => {
    const u = String(url);
    recorder.push({ u, method: opts?.method || 'GET' });
    if (u.includes('lcc_users')) return list([{ lcc_user_id: 'u1' }]);
    if (u.includes('bd_opportunities')) return list([{ entity_id: DEAL, sf_opp_id: 'sf1', owner_user_id: 'u1', metadata: {} }]);
    if (u.includes('entities?id=in')) return list([
      { id: DEAL, name: '2155 Main Street East, Snellville, GA', city: 'Snellville', state: 'GA' }]);
    if (u.includes('source_type=eq.lcc%3Adeal_match') && u.includes('select=external_id')) return list([]);
    if (u.includes('entity_relationships') && u.includes('from_entity_id=in.')) return list([]);
    if (u.includes('source_type=eq.outlook')) return list([]);
    if (u.includes('lcc_deal_match_run_log')) return list([{ run_id: 77, cursor_end: 0 }]);
    return list([]);
  };
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  let out = null;
  const res = { status(c) { this._s = c; return this; }, json(p) { out = { status: this._s || 200, body: p }; return this; } };
  await handleDealEmailMatchCron({ query: {}, body: {} }, res);

  const cand = recorder.find(c => c.u.includes('source_type=eq.outlook'));
  assert.ok(cand, 'a candidate query ran for the comma-bearing deal');
  const decoded = decodeURIComponent(cand.u);
  // The core is "Main Street East, Snellville, GA" (the leading number is dropped as generic).
  assert.ok(decoded.includes('title.ilike."*Main Street East, Snellville, GA*"'),
    `the comma-bearing value must be double-quoted, got: ${decoded}`);
  assert.equal(out.body.ok, true, 'and the run is clean — no 400, no fallback');
  assert.equal(out.body.deals_scanned, 1, 'the deal is actually scanned, not skipped');
});

test('P123b: a CLEAN core keeps the unquoted shape proven to work live', async () => {
  // Zero-regression guard: quoting is applied ONLY when a reserved character is present, so the
  // 32 deals whose cores are clean keep byte-for-byte the query shape that works today.
  const recorder = [];
  installBulkFetch({ matchCount: 1, recorder });
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  const res = { status(c) { this._s = c; return this; }, json() { return this; } };
  await handleDealEmailMatchCron({ query: {}, body: {} }, res);
  const cand = recorder.find(c => c.u.includes('source_type=eq.outlook'));
  const decoded = decodeURIComponent(cand.u);
  assert.ok(decoded.includes('title.ilike.*DaVita*'), `clean core stays unquoted, got: ${decoded}`);
  assert.ok(!decoded.includes('"*DaVita*"'), 'no quotes added where none are needed');
});

test('P123b: a failed read records the REAL PostgREST error, not an empty array', async () => {
  // The shim blanks a non-array `data` to [] so `for…of` can never throw, stashing the original
  // on `_nonArrayData`. Reading `data` logged `detail: []` and discarded the message naming the
  // cause — which is why the comma 400s took a live run to diagnose.
  const list = (arr) => ({ ok: true, status: 200, text: async () => JSON.stringify(arr),
    headers: { get: (h) => (h === 'content-range' ? `0-0/${arr.length}` : null) } });
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('lcc_users')) return list([{ lcc_user_id: 'u1' }]);
    if (u.includes('bd_opportunities')) return list([{ entity_id: DEAL, sf_opp_id: 'sf1', owner_user_id: 'u1', metadata: {} }]);
    if (u.includes('entities?id=in')) return list([{ id: DEAL, name: 'DaVita Dialysis - Queens - NY', city: 'Queens', state: 'NY' }]);
    if (u.includes('source_type=eq.lcc%3Adeal_match') && u.includes('select=external_id')) return list([]);
    if (u.includes('entity_relationships') && u.includes('from_entity_id=in.')) return list([]);
    if (u.includes('source_type=eq.outlook')) return { ok: false, status: 400,
      text: async () => JSON.stringify({ code: 'PGRST100', message: 'unexpected "," expecting letter' }),
      headers: { get: () => null } };
    if (u.includes('lcc_deal_match_run_log')) return list([{ run_id: 78, cursor_end: 0 }]);
    return list([]);
  };
  const { handleDealEmailMatchCron } = await import('../api/_handlers/deal-email-match-cron.js');
  let out = null;
  const res = { status(c) { this._s = c; return this; }, json(p) { out = { status: this._s || 200, body: p }; return this; } };
  await handleDealEmailMatchCron({ query: {}, body: {} }, res);

  assert.equal(out.body.ok, false);
  const blob = JSON.stringify(out.body.errors);
  assert.ok(blob.includes('PGRST100') && blob.includes('unexpected'),
    `the recorded error must name the cause, got: ${blob}`);
});
