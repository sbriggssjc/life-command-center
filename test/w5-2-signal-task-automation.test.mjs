// W5.2 — signal -> task automation (state lease / agency risk / NPI).
// Verifies the three consumer ticks + the NPI decision resolver in api/admin.js:
//   * fixed-threshold value gates (distress-only; high/elevated; missing/new)
//   * structured payloads (entity/property ids + a deep link; NEVER a prose
//     "instructions" field telling a human to run SQL)
//   * seam / ledger idempotency (a 409 re-run creates zero duplicate work)
//   * don't-re-ask (a prior-decided subject 409s at mint)
//   * NO destructive domain write from a dedup verdict (never-guess)
// Uses the fetch-mock harness pattern from auto-scrape-listings.test.js.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const ENV_KEYS = ['LCC_API_KEY', 'OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY',
  'DIA_SUPABASE_URL', 'DIA_SUPABASE_KEY', 'GOV_SUPABASE_URL', 'GOV_SUPABASE_KEY'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const originalFetch = global.fetch;

function mockRes() {
  return {
    _status: null, _json: null, headersSent: false, _headers: {},
    setHeader(n, v) { this._headers[n] = v; },
    status(c) { this._status = c; return this; },
    json(d) { this._json = d; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
  };
}
function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return { ok, status,
    headers: { get(n) { return headers[String(n).toLowerCase()] || null; } },
    async text() { return JSON.stringify(body); }, async json() { return body; } };
}
const DEV_USER = [{ id: 'user-1', email: 'dev@example.com', display_name: 'Dev',
  workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }] }];
async function loadHandler() {
  return (await import(`../api/admin.js?w52=${Date.now()}-${Math.random()}`)).default;
}

describe('W5.2 signal -> task automation', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';
    process.env.DIA_SUPABASE_URL = 'https://dia.example.com';
    process.env.DIA_SUPABASE_KEY = 'dia-key';
    process.env.GOV_SUPABASE_URL = 'https://gov.example.com';
    process.env.GOV_SUPABASE_KEY = 'gov-key';
    delete process.env.LCC_API_KEY;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    for (const k of ENV_KEYS) { if (originalEnv[k] === undefined) delete process.env[k]; else process.env[k] = originalEnv[k]; }
  });

  it('state-lease: distress-only gate WITHOUT relocated; structured payload; consumption is independent of gov processed_at; NEVER writes the gov seam', async () => {
    let taskPostCount = 0; let govWrite = false;
    global.fetch = async (url, opts = {}) => {
      const t = String(url); const method = opts.method || 'GET';
      // Any non-GET to the gov state_lease_events table is a seam-contention bug.
      if (t.startsWith('https://gov.example.com/rest/v1/state_lease_events') && method !== 'GET') govWrite = true;
      if (t.includes('/rest/v1/users?')) return jsonResponse(DEV_USER);
      // producer staleness read — fresh (today) so no alarm.
      if (t.includes('/rest/v1/state_lease_events?select=created_at')) return jsonResponse([{ created_at: new Date().toISOString() }]);
      // digest counts — keyed on created_at now, NOT processed_at; relocated joins.
      if (t.includes('/rest/v1/state_lease_events?select=id&created_at=gte.') && t.includes('event_type=eq.')) {
        assert.ok(!t.includes('processed_at'), 'digest must not key on gov processed_at');
        return jsonResponse([]);
      }
      // the distress fetch — the ONLY event-type filter must be the distress set
      // (relocated dropped), and it must NOT filter on processed_at.
      if (t.includes('/rest/v1/state_lease_events?select=id,source_code')) {
        assert.ok(t.includes('event_type=in.(removed,footprint_reduction,agency_change)'), 'distress-only gate: ' + t);
        assert.ok(!t.includes('relocated'), 'relocated must move to the digest, not the task set');
        assert.ok(!t.includes('renewed') && !t.includes('lessor_change'), 'informational types must not be tasked');
        assert.ok(!t.includes('processed_at'), 'candidate fetch must not read gov processed_at');
        assert.ok(t.includes('created_at=gte.2026-08-01'), 'floor excludes the June backfill');
        // event carries processed_at already (stamped by gov lead-gen) — must still task.
        return jsonResponse([{ id: 501, source_code: 'tx_tfc', state_lease_id: '09210', event_type: 'agency_change',
          event_date: '2026-08-01', from_snapshot_date: '2026-05-01', to_snapshot_date: '2026-06-23', annual_rent: null }]);
      }
      // LCC ledger read (research_tasks) — nothing consumed yet.
      if (t.includes('/rest/v1/research_tasks?select=source_record_id') && method === 'GET') {
        assert.ok(t.includes('source_table=eq.state_lease_events'), 'ledger keyed on the source table');
        return jsonResponse([]);
      }
      if (t.includes('/rest/v1/state_lease_snapshots?select=source_code')) {
        return jsonResponse([{ source_code: 'tx_tfc', state_lease_id: '09210', snapshot_date: '2026-06-23',
          address: '6330 Hwy 290 East', city: 'AUSTIN', state: 'TX', agency: 'TCOLE', lessor: 'I-290 LP', annual_rent: 120000 }]);
      }
      if (t.includes('/rest/v1/research_tasks') && method === 'POST') {
        taskPostCount += 1;
        const b = JSON.parse(opts.body);
        assert.equal(b.source_table, 'state_lease_events');
        assert.equal(b.source_record_id, '501');
        assert.equal(b.instructions, null, 'no prose instructions');
        assert.ok(b.metadata && b.metadata.deep_link, 'payload carries a deep_link');
        assert.equal(b.metadata.event_id, 501);
        assert.equal(b.metadata.address, '6330 Hwy 290 East');
        return jsonResponse([{ id: 'task-1' }], true, 201);
      }
      throw new Error('Unexpected fetch: ' + method + ' ' + t);
    };
    const handler = await loadHandler();
    const req = { method: 'POST', query: { _route: 'state-lease-consume', limit: 50 }, headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' } };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res._status, 200, JSON.stringify(res._json));
    assert.equal(res._json.tasks_created, 1);
    assert.equal(taskPostCount, 1);
    assert.equal(res._json.marked_processed, undefined, 'no gov-seam marking counter anymore');
    assert.equal(govWrite, false, 'the tick NEVER writes gov state_lease_events (processed_at is lead-gen\'s seam)');
    assert.equal(res._json.producer.stale, false);
  });

  it('state-lease: idempotent re-run — an event already in the LCC research_tasks ledger creates ZERO duplicates', async () => {
    let taskPostCount = 0; let govWrite = false;
    global.fetch = async (url, opts = {}) => {
      const t = String(url); const method = opts.method || 'GET';
      if (t.startsWith('https://gov.example.com/rest/v1/state_lease_events') && method !== 'GET') govWrite = true;
      if (t.includes('/rest/v1/users?')) return jsonResponse(DEV_USER);
      if (t.includes('/rest/v1/state_lease_events?select=created_at')) return jsonResponse([{ created_at: new Date().toISOString() }]);
      if (t.includes('/rest/v1/state_lease_events?select=id&created_at=gte.') && t.includes('event_type=eq.')) return jsonResponse([]);
      if (t.includes('/rest/v1/state_lease_events?select=id,source_code')) return jsonResponse([{ id: 777, source_code: 'tx_tfc', state_lease_id: '1', event_type: 'removed', event_date: '2026-08-01', from_snapshot_date: '2026-05-01', to_snapshot_date: '2026-06-23' }]);
      // ledger already carries event 777 -> it must be skipped, no task, no snapshot read.
      if (t.includes('/rest/v1/research_tasks?select=source_record_id') && method === 'GET') return jsonResponse([{ source_record_id: '777' }]);
      if (t.includes('/rest/v1/research_tasks') && method === 'POST') { taskPostCount += 1; return jsonResponse([{ id: 'x' }], true, 201); }
      throw new Error('Unexpected fetch: ' + method + ' ' + t);
    };
    const handler = await loadHandler();
    const res = mockRes();
    await handler({ method: 'POST', query: { _route: 'state-lease-consume' }, headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' } }, res);
    assert.equal(res._status, 200, JSON.stringify(res._json));
    assert.equal(res._json.tasks_created, 0);
    assert.equal(res._json.deduped, 1, 'the already-tasked event is skipped via the LCC ledger');
    assert.equal(taskPostCount, 0, 'zero duplicate research_tasks');
    assert.equal(govWrite, false, 'no gov seam write');
  });

  it('npi: missing/new -> research_task + ledger; consumed hash is skipped; payload has ids+deep_link, no prose', async () => {
    let taskPosts = 0; let ledgerPosts = 0;
    // Pre-compute the hash the handler will produce for the consumed row so we can
    // seed the ledger with it (md5 of signal_type|clinic_id|npi|winner).
    const { createHash } = await import('node:crypto');
    const consumedRow = { signal_type: 'missing_inventory_npi', clinic_id: '999', npi: '', cluster_winner_medicare_id: '' };
    const consumedHash = createHash('md5').update(['missing_inventory_npi', '999', '', ''].join('|')).digest('hex');
    global.fetch = async (url, opts = {}) => {
      const t = String(url); const method = opts.method || 'GET';
      if (t.includes('/rest/v1/users?')) return jsonResponse(DEV_USER);
      // digest counts
      if (t.includes('/rest/v1/mv_npi_inventory_signals?select=clinic_id&signal_type=eq.duplicate_inventory_npi')) return jsonResponse([]);
      // ledger consumed-hash read
      if (t.includes('/rest/v1/lcc_npi_signal_consumed?select=signal_hash')) return jsonResponse([{ signal_hash: consumedHash }]);
      // missing_inventory_npi rows: one fresh + the already-consumed one.
      if (t.includes('/rest/v1/mv_npi_inventory_signals?select=signal_type,clinic_id') && t.includes('signal_type=eq.missing_inventory_npi')) {
        return jsonResponse([
          { signal_type: 'missing_inventory_npi', clinic_id: '262705', npi: null, facility_name: 'SSM HEALTH', city: 'Richmond Heights', state: 'MO', operator_name: 'Independent', cluster_winner_medicare_id: null, severity: 'unresolved', signal_priority: 3, signal_reason: 'blank NPI', latest_total_patients: 40 },
          consumedRow, // this one is in the ledger -> must be skipped
        ]);
      }
      if (t.includes('signal_type=eq.new_npi')) return jsonResponse([]);
      if (t.includes('/rest/v1/research_tasks') && method === 'POST') {
        taskPosts += 1; const b = JSON.parse(opts.body);
        assert.equal(b.domain, 'dia'); assert.equal(b.source_table, 'mv_npi_inventory_signals');
        assert.equal(b.instructions, null, 'no prose instructions');
        assert.ok(b.metadata.deep_link, 'deep_link present');
        assert.equal(b.metadata.clinic_id, '262705');
        return jsonResponse([{ id: 'rt-npi-1' }], true, 201);
      }
      if (t.includes('/rest/v1/lcc_npi_signal_consumed') && method === 'POST') {
        ledgerPosts += 1; const b = JSON.parse(opts.body);
        assert.equal(b.consumed_via, 'research_task'); assert.equal(b.clinic_id, '262705');
        return jsonResponse([{ signal_hash: b.signal_hash }], true, 201);
      }
      throw new Error('Unexpected fetch: ' + method + ' ' + t);
    };
    const handler = await loadHandler();
    const res = mockRes();
    await handler({ method: 'POST', query: { _route: 'npi-consume' }, headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' } }, res);
    assert.equal(res._status, 200, JSON.stringify(res._json));
    assert.equal(res._json.tasks_created, 1, 'only the un-consumed signal becomes a task');
    assert.equal(res._json.deduped, 1, 'the ledgered signal is skipped');
    assert.equal(taskPosts, 1);
    assert.equal(ledgerPosts, 1);
  });

  it('agency-risk: low/moderate + unlinked-elevated auto-dismissed; high never dismissed', async () => {
    const patches = [];
    global.fetch = async (url, opts = {}) => {
      const t = String(url); const method = opts.method || 'GET';
      if (t.includes('/rest/v1/users?')) return jsonResponse(DEV_USER);
      if (t.includes('/rest/v1/agency_risk_signals?select=created_at')) return jsonResponse([{ created_at: new Date().toISOString() }]);
      if (t.includes('risk_level=eq.high&limit=1')) return jsonResponse([]);
      if (t.match(/risk_level=eq\.(elevated|moderate|low)&limit=1/)) return jsonResponse([]);
      // low/moderate auto-dismiss PATCH
      if (method === 'PATCH' && t.includes('risk_level=in.(low,moderate)')) {
        patches.push('low_moderate'); const b = JSON.parse(opts.body);
        assert.equal(b.processed_reason, 'low_moderate_below_floor'); return jsonResponse([{ signal_id: 'x' }]);
      }
      // elevated candidate fetch: two elevated, one linked (agency A), one not (agency B).
      if (method === 'GET' && t.includes('risk_level=eq.elevated&order=created_at.desc')) {
        return jsonResponse([{ signal_id: 'e-linked', agency: 'Agency A' }, { signal_id: 'e-unlinked', agency: 'Agency B' }]);
      }
      // properties linkage: only Agency A has a tracked property.
      if (t.includes('/rest/v1/properties?select=agency&agency=in.')) return jsonResponse([{ agency: 'Agency A' }]);
      // elevated unlinked dismiss PATCH — must target ONLY e-unlinked.
      if (method === 'PATCH' && t.includes('signal_id=in.')) {
        patches.push('elevated_unlinked'); const b = JSON.parse(opts.body);
        assert.equal(b.processed_reason, 'elevated_no_tracked_exposure');
        assert.ok(decodeURIComponent(t).includes('e-unlinked'), 'unlinked elevated dismissed');
        assert.ok(!decodeURIComponent(t).includes('e-linked'), 'linked elevated NOT dismissed');
        return jsonResponse([{ signal_id: 'e-unlinked' }]);
      }
      throw new Error('Unexpected fetch: ' + method + ' ' + t);
    };
    const handler = await loadHandler();
    const res = mockRes();
    await handler({ method: 'POST', query: { _route: 'agency-risk-consume' }, headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' } }, res);
    assert.equal(res._status, 200, JSON.stringify(res._json));
    assert.ok(patches.includes('low_moderate'));
    assert.ok(patches.includes('elevated_unlinked'));
    assert.equal(res._json.elevated_linked, 1);
  });

  it('npi_dedup_autoapprove verdict: approve spawns a task + ledgers, with NO destructive dia write; prior-decided 409s', async () => {
    const dia_mutations = [];
    let taskPosted = false; let ledgerPosted = false; let priorDecided = false;
    global.fetch = async (url, opts = {}) => {
      const t = String(url); const method = opts.method || 'GET';
      if (t.includes('/rest/v1/users?')) return jsonResponse(DEV_USER);
      // any dia write is forbidden by the never-guess rule.
      if (t.startsWith('https://dia.example.com') && method !== 'GET') dia_mutations.push(t);
      // prior-decided guard: return a decided row when priorDecided flag set.
      if (t.includes('/rest/v1/lcc_decisions?select=id,status') && method === 'GET') {
        return jsonResponse(priorDecided ? [{ id: 9, status: 'decided' }] : []);
      }
      if (t.endsWith('/rest/v1/rpc/lcc_open_decision') && method === 'POST') return jsonResponse(1234);
      if (t.includes('/rest/v1/lcc_decisions?id=eq.1234') && method === 'GET') {
        return jsonResponse([{ id: 1234, decision_type: 'npi_dedup_autoapprove', status: 'open',
          workspace_id: 'ws-1', subject_domain: 'dia', subject_entity_id: null,
          context: { signal_hash: 'abc123', signal_type: 'duplicate_inventory_npi', severity: 'auto_resolvable',
            clinic_id: '262705', npi: '1', facility_name: 'SSM', cluster_winner_medicare_id: '262700' } }]);
      }
      if (t.includes('/rest/v1/research_tasks') && method === 'POST') {
        taskPosted = true; const b = JSON.parse(opts.body); assert.equal(b.research_type, 'npi_dedup_apply');
        return jsonResponse([{ id: 'rt-apply' }], true, 201);
      }
      if (t.includes('/rest/v1/lcc_npi_signal_consumed') && method === 'POST') {
        ledgerPosted = true; const b = JSON.parse(opts.body); assert.equal(b.consumed_via, 'decision'); return jsonResponse([{ signal_hash: 'abc123' }], true, 201);
      }
      if (t.endsWith('/rest/v1/rpc/lcc_record_decision_verdict') && method === 'POST') return jsonResponse({ ok: true });
      throw new Error('Unexpected fetch: ' + method + ' ' + t);
    };
    const handler = await loadHandler();
    const subject = { signal_hash: 'abc123', subject_domain: 'dia', context: { signal_hash: 'abc123', clinic_id: '262705', cluster_winner_medicare_id: '262700' } };
    // 1) approve
    let res = mockRes();
    await handler({ method: 'POST', query: { _route: 'decision-verdict' }, headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      body: { type: 'npi_dedup_autoapprove', subject, verdict: 'approve' } }, res);
    assert.equal(res._status, 200, JSON.stringify(res._json));
    assert.ok(taskPosted, 'approve spawns the apply research_task');
    assert.ok(ledgerPosted, 'approve ledgers the signal consumed');
    assert.equal(dia_mutations.length, 0, 'NEVER a destructive dia write from the verdict');
    // 2) prior-decided -> 409 don't-re-ask
    priorDecided = true;
    res = mockRes();
    await handler({ method: 'POST', query: { _route: 'decision-verdict' }, headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      body: { type: 'npi_dedup_autoapprove', subject, verdict: 'approve' } }, res);
    assert.equal(res._status, 409, JSON.stringify(res._json));
    assert.equal(res._json.error, 'already_decided');
  });
});
