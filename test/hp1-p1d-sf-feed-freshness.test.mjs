// ============================================================================
// HP1-P1d — a freshness assertion on the Salesforce opportunity FEED.
//
// docs/claude-code/prompts/HP1-P1d-deal-backbone-feed-freshness.md
//
// Two things are guarded here, offline (this suite is hermetic — no network,
// no live Supabase — per test/hermetic-suite.test.mjs):
//
//   1. mcp/opportunity-sync.js — the JS side: ingestBatch tallies the RPC's
//      own inserted/updated outcome and writes exactly one producer_runs row
//      per batch, on a 3-arg opsQuery call only (never re-introducing the
//      4th-arg-mangled-Prefer-header class of bug this whole prompt exists
//      to close).
//
//   2. A pure-JS SHADOW MODEL of the SQL predicate shipped in
//      supabase/migrations/20261101180000_lcc_hp1p1d_sf_opportunity_feed_freshness.sql
//      (`max(last_synced_at) FILTER (WHERE sf_opp_id IS NOT NULL)`), run
//      against real numbers pulled from the live database during
//      investigation (2026-09-12) — the four positive-control readings this
//      migration's header records, plus the historical-window replay. The
//      SQL itself was additionally proven live via rolled-back probes
//      (recorded in the response doc); this model is what makes the same
//      four assertions re-runnable in CI without a live DB.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeOpportunitySyncRoute } from '../mcp/opportunity-sync.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const enc = (v) => encodeURIComponent(String(v));
const WORKSPACE_ID = 'a0000000-0000-0000-0000-000000000001';
const MIGRATION_PATH = join(ROOT, 'supabase', 'migrations', '20261101180000_lcc_hp1p1d_sf_opportunity_feed_freshness.sql');

function fakeRes() {
  return {
    _status: 200, _body: null,
    status(s) { this._status = s; return this; },
    json(b) { this._body = b; return this; },
  };
}

function stripSqlComments(src) {
  // This repo's standing rule (A5c/N18/B1): strip comments before grepping
  // source, so a fix's own explanatory prose (which quotes the banned shapes
  // while explaining why they are banned) cannot satisfy a naive assertion.
  return src.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
}

// ----------------------------------------------------------------------------
// 1. ingestBatch -> producer_runs wiring (behavioural, stubbed opsQuery)
// ----------------------------------------------------------------------------

function makeStubDb({ rpcOutcomes }) {
  const producerRunsWrites = [];
  let rpcCall = 0;
  const opsQuery = async (method, path, body) => {
    if (method === 'GET' && path.startsWith('bd_opportunities?')) return { ok: true, data: [] };
    if (method === 'GET' && path.startsWith('entities?')) return { ok: true, data: [] };
    if (method === 'POST' && path === 'entities') return { ok: true, data: { id: body.id } };
    if (method === 'GET' && path.startsWith('lcc_users?')) return { ok: true, data: [] };
    if (method === 'POST' && path === 'rpc/lcc_upsert_bd_opportunities') {
      const outcome = rpcOutcomes[rpcCall++] ?? 'inserted';
      const [deal] = body.p_deals;
      if (outcome === 'error') return { ok: false, status: 502, data: { message: 'simulated failure' } };
      return { ok: true, data: [{ sf_opp_id: deal.sf_opp_id, outcome, reason: null, bd_opportunity_id: 'x', entity_id: deal.entity_id }] };
    }
    if (method === 'POST' && path === 'producer_runs') {
      producerRunsWrites.push(body);
      return { ok: true, data: [] };
    }
    throw new Error(`stubDb: unhandled opsQuery(${method}, ${path})`);
  };
  return { opsQuery, producerRunsWrites };
}

async function flushMicrotasks() {
  // logIngestRun is fired-and-forgotten (never awaited by ingestBatch, so a
  // logging hiccup can't turn a real sync into a 500) — give its promise
  // chain a tick to land before asserting on producerRunsWrites.
  await new Promise((r) => setTimeout(r, 5));
}

test('ingestBatch logs exactly one producer_runs row per batch, tallying the RPC outcome (never opsQuery 4th-arg options)', async () => {
  const { opsQuery, producerRunsWrites } = makeStubDb({ rpcOutcomes: ['inserted', 'updated', 'updated'] });
  const routes = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID });
  const deals = [
    { Id: '006AAA', Name: 'A - X, TX', StageName: 'BOV' },
    { Id: '006BBB', Name: 'B - Y, TX', StageName: 'LOI Executed' },
    { Id: '006CCC', Name: 'C - Z, TX', StageName: 'In Escrow' },
  ];
  const res = fakeRes();
  await routes.ingestBatch({ body: { deals } }, res);
  await flushMicrotasks();

  assert.equal(res._status, 200);
  assert.equal(producerRunsWrites.length, 1, 'exactly one producer_runs row per ingestBatch call');
  const row = producerRunsWrites[0];
  assert.equal(row.producer, 'sf_opportunity_sync');
  assert.equal(row.status, 'completed');
  assert.equal(row.trigger_source, 'ingest');
  assert.equal(row.error_count, 0);
  // facts_written is the state delta (1 insert + 2 updates), never `succeeded`
  // (which would also be 3 here and could hide a divergence on a different fixture).
  assert.equal(row.facts_written, 3);
  assert.equal(row.skip_reason, null);
  assert.ok(row.started_at && row.finished_at, 'lifecycle timestamps must be set');
});

test('ingestBatch: an all-failed batch logs status=failed with the real error_count, and still returns 502', async () => {
  const { opsQuery, producerRunsWrites } = makeStubDb({ rpcOutcomes: ['error', 'error'] });
  const routes = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID });
  const deals = [
    { Id: '006DDD', Name: 'D - X, TX', StageName: 'BOV' },
    { Id: '006EEE', Name: 'E - Y, TX', StageName: 'BOV' },
  ];
  const res = fakeRes();
  await routes.ingestBatch({ body: { deals } }, res);
  await flushMicrotasks();

  assert.equal(res._status, 502);
  assert.equal(producerRunsWrites.length, 1);
  const row = producerRunsWrites[0];
  assert.equal(row.status, 'failed');
  assert.equal(row.error_count, 2);
  assert.equal(row.facts_written, 0, 'no RPC succeeded, so no facts were written');
});

test('ingestBatch: an empty batch logs status=skipped with a named skip_reason (never a silent zero-row log)', async () => {
  const { opsQuery, producerRunsWrites } = makeStubDb({ rpcOutcomes: [] });
  const routes = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID });
  const res = fakeRes();
  await routes.ingestBatch({ body: { deals: [] } }, res);
  await flushMicrotasks();

  assert.equal(producerRunsWrites.length, 1);
  const row = producerRunsWrites[0];
  assert.equal(row.status, 'skipped');
  assert.equal(row.skip_reason, 'empty_batch');
});

test('ingestBatch: a producer_runs write failure must not break the HTTP response to Power Automate', async () => {
  let rpcCall = 0;
  const opsQuery = async (method, path, body) => {
    if (method === 'GET') return { ok: true, data: [] };
    if (method === 'POST' && path === 'entities') return { ok: true, data: { id: body.id } };
    if (method === 'POST' && path === 'rpc/lcc_upsert_bd_opportunities') {
      const [deal] = body.p_deals;
      rpcCall++;
      return { ok: true, data: [{ sf_opp_id: deal.sf_opp_id, outcome: 'inserted', reason: null, bd_opportunity_id: 'x', entity_id: deal.entity_id }] };
    }
    if (method === 'POST' && path === 'producer_runs') throw new Error('producer_runs table unreachable');
    throw new Error('unhandled: ' + method + ' ' + path);
  };
  const routes = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID });
  const res = fakeRes();
  await routes.ingestBatch({ body: { deals: [{ Id: '006FFF', Name: 'F - X, TX', StageName: 'BOV' }] } }, res);
  await flushMicrotasks();
  assert.equal(res._status, 200, 'a producer_runs logging failure must not change the response Power Automate reads');
  assert.equal(res._body.ok, true);
  assert.equal(rpcCall, 1);
});

test('processDeal response body carries the RPC outcome (inserted/updated), the field ingestBatch tallies', async () => {
  const opsQuery = async (method, path, body) => {
    if (method === 'GET') return { ok: true, data: [] };
    if (method === 'POST' && path === 'entities') return { ok: true, data: { id: body.id } };
    if (method === 'POST' && path === 'rpc/lcc_upsert_bd_opportunities') {
      const [deal] = body.p_deals;
      return { ok: true, data: [{ sf_opp_id: deal.sf_opp_id, outcome: 'updated', reason: null, bd_opportunity_id: 'x', entity_id: deal.entity_id }] };
    }
    return { ok: true, data: [] };
  };
  const routes = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID });
  const res = fakeRes();
  await routes.ingest({ body: { Id: '006GGG', Name: 'G - X, TX', StageName: 'BOV' } }, res);
  assert.equal(res._body.outcome, 'updated');
});

// ----------------------------------------------------------------------------
// 2. Migration source guards — the predicate shape (comment-stripped)
// ----------------------------------------------------------------------------

test('migration source: the freshness predicate filters on sf_opp_id IS NOT NULL, never bare last_synced_at or updated_at', () => {
  const raw = readFileSync(MIGRATION_PATH, 'utf8');
  const codeOnly = stripSqlComments(raw);
  assert.match(
    codeOnly,
    /max\(last_synced_at\)\s*FILTER\s*\(WHERE\s+sf_opp_id\s+IS\s+NOT\s+NULL\)/i,
    'the predicate must be max(last_synced_at) FILTER (WHERE sf_opp_id IS NOT NULL)'
  );
  // Never read updated_at anywhere in the check function's body -- that is
  // verbatim the mechanism HP1-P1a found hiding the 36-day outage.
  const fnStart = codeOnly.indexOf('CREATE OR REPLACE FUNCTION public.lcc_check_sf_opportunity_freshness');
  const fnEnd = codeOnly.indexOf('$function$;', fnStart + 1);
  const fnBody = codeOnly.slice(fnStart, fnEnd);
  assert.ok(!/updated_at/i.test(fnBody), 'the check function must never read updated_at');
});

test('migration source: SECURITY DEFINER stanza (SEC1-definer-default) is present', () => {
  const src = readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(src, /REVOKE ALL ON FUNCTION public\.lcc_check_sf_opportunity_freshness\(numeric\) FROM public, anon, authenticated/);
  assert.match(src, /has_function_privilege\('service_role', 'public\.lcc_check_sf_opportunity_freshness\(numeric\)', 'EXECUTE'\)/);
  assert.match(src, /has_function_privilege\('anon', 'public\.lcc_check_sf_opportunity_freshness\(numeric\)', 'EXECUTE'\)/);
});

test('migration source: the threshold default (3h) matches the stated 30-min cadence measurement, and does not register a table-keyed feed_freshness_registry row', () => {
  const src = readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(src, /p_stale_hours numeric DEFAULT 3/);
  assert.match(src, /30[- ]min/i, 'the migration must state the measured cadence it derived the threshold from');
  assert.ok(!/insert into public\.feed_freshness_registry/i.test(src), 'must not register bd_opportunities in feed_freshness_registry (table-keyed, cannot express the sf_opp_id filter)');
});

// ----------------------------------------------------------------------------
// 3. Shadow model of the SQL predicate + the four positive-control readings
//    (numbers pulled live from LCC Opps during HP1-P1d investigation,
//    2026-09-12 -- see the migration header and the response doc).
// ----------------------------------------------------------------------------

/** Pure mirror of lcc_check_sf_opportunity_freshness's predicate. */
function computeSfOpportunityFreshness(rows, { staleHours = 3, now = new Date() } = {}) {
  const sfLinked = rows.filter((r) => r.sf_opp_id != null);
  const maxSynced = sfLinked.reduce((max, r) => {
    if (r.last_synced_at == null) return max;
    const t = new Date(r.last_synced_at).getTime();
    return max == null || t > max ? t : max;
  }, null);
  const ageHours = maxSynced == null ? null : (now.getTime() - maxSynced) / 3_600_000;
  const stale = ageHours == null || ageHours > staleHours;
  return { maxSynced: maxSynced == null ? null : new Date(maxSynced), ageHours, stale, sfLinkedCount: sfLinked.length };
}

test('shadow model, positive control 1: feed healthy NOW reads green (live reading, 2026-09-12 13:00:47 UTC sync, ~0.3h old)', () => {
  const rows = [
    { sf_opp_id: null, last_synced_at: null },
    { sf_opp_id: '006Vs00000hhYfCIAU', last_synced_at: '2026-09-12T13:00:47.237Z' },
  ];
  const r = computeSfOpportunityFreshness(rows, { staleHours: 3, now: new Date('2026-09-12T13:18:50.000Z') });
  assert.equal(r.stale, false);
  assert.ok(r.ageHours < 1, `expected sub-hour age, got ${r.ageHours}`);
});

test('shadow model, positive control 2: a simulated stale feed (all SF-linked rows back-dated 10 days) fires', () => {
  const rows = [
    { sf_opp_id: '006A', last_synced_at: '2026-09-02T13:18:50.000Z' },
    { sf_opp_id: '006B', last_synced_at: '2026-09-02T13:18:50.000Z' },
  ];
  const r = computeSfOpportunityFreshness(rows, { staleHours: 3, now: new Date('2026-09-12T13:18:50.000Z') });
  assert.equal(r.stale, true);
  assert.equal(Math.round(r.ageHours), 240, 'matches the live rolled-back probe: 240.0h');
});

test('shadow model, positive control 3: the historical outage window (2026-08-04 -> 2026-09-12) WOULD have fired at 13 of 16 checkpoints', () => {
  // sf-linked rows carried NO updates during the outage (HP1-P1a: zero UPDATEs
  // ever, until the 2026-09-12 fix), so last_synced_at == created_at for every
  // row throughout the window. These created_at dates are the live-measured
  // insert distribution (migration header / response doc).
  const sfRows = [
    { sf_opp_id: 'seed', last_synced_at: '2026-07-28T12:00:00.000Z' },
    { sf_opp_id: 'a', last_synced_at: '2026-08-04T21:00:46.129Z' },
    { sf_opp_id: 'b', last_synced_at: '2026-08-20T21:00:46.375Z' },
    { sf_opp_id: 'c', last_synced_at: '2026-09-03T16:31:03.001Z' },
    { sf_opp_id: 'd', last_synced_at: '2026-09-07T22:00:48.362Z' },
    { sf_opp_id: 'e', last_synced_at: '2026-09-09T20:30:49.068Z' },
  ];
  const checkpoints = [
    ['2026-08-05T00:00:00Z', false], ['2026-08-10T00:00:00Z', true], ['2026-08-15T00:00:00Z', true],
    ['2026-08-19T00:00:00Z', true], ['2026-08-20T12:00:00Z', true], ['2026-08-21T00:00:00Z', false],
    ['2026-08-25T00:00:00Z', true], ['2026-08-30T00:00:00Z', true], ['2026-09-01T00:00:00Z', true],
    ['2026-09-03T12:00:00Z', true], ['2026-09-04T00:00:00Z', true], ['2026-09-06T00:00:00Z', true],
    ['2026-09-07T12:00:00Z', true], ['2026-09-08T00:00:00Z', false], ['2026-09-10T00:00:00Z', true],
    ['2026-09-11T12:00:00Z', true],
  ];
  let fired = 0;
  for (const [ts, expectedFired] of checkpoints) {
    const now = new Date(ts);
    const rowsAsOf = sfRows.filter((r) => new Date(r.last_synced_at).getTime() <= now.getTime());
    const r = computeSfOpportunityFreshness(rowsAsOf, { staleHours: 3, now });
    assert.equal(r.stale, expectedFired, `checkpoint ${ts}: expected stale=${expectedFired}, got ${r.stale} (age ${r.ageHours}h)`);
    if (r.stale) fired++;
  }
  assert.equal(fired, 13, 'the check would have fired at 13 of 16 checkpoints across the outage window, live-reproduced against the migration');
});

test('shadow model, positive control 4: a write by the non-SF (sf_opp_id IS NULL) producer does NOT clear the alert', () => {
  const rows = [
    { sf_opp_id: '006A', last_synced_at: '2026-09-02T13:18:50.000Z' }, // stale SF row
    { sf_opp_id: null, last_synced_at: new Date().toISOString() },     // the OTHER producer just wrote NOW
  ];
  const r = computeSfOpportunityFreshness(rows, { staleHours: 3, now: new Date('2026-09-12T13:18:50.000Z') });
  assert.equal(r.stale, true, 'the sf_opp_id IS NULL row must never satisfy the predicate -- if this test ever reads false, the migration has regressed into a table-keyed check');
  assert.equal(Math.round(r.ageHours), 240);
});

test('shadow model: a row with sf_opp_id IS NULL is excluded from sfLinkedCount and can never set maxSynced on its own', () => {
  const rows = [{ sf_opp_id: null, last_synced_at: new Date().toISOString() }];
  const r = computeSfOpportunityFreshness(rows, { staleHours: 3, now: new Date() });
  assert.equal(r.sfLinkedCount, 0);
  assert.equal(r.maxSynced, null);
  assert.equal(r.stale, true, 'no SF-linked row at all must read stale (age null), never green by default');
});

test('shadow model: threshold computation -- 3h is 6x the measured 30-min PA cadence, and a run inside that window reads green', () => {
  const CADENCE_MINUTES = 30;
  const STALE_HOURS = 3;
  assert.equal(STALE_HOURS, (CADENCE_MINUTES / 60) * 6, 'threshold must be a stated multiple of the measured cadence, not an arbitrary round number');
  const rows = [{ sf_opp_id: '006A', last_synced_at: new Date(Date.now() - 2 * CADENCE_MINUTES * 60_000).toISOString() }];
  const r = computeSfOpportunityFreshness(rows, { staleHours: STALE_HOURS, now: new Date() });
  assert.equal(r.stale, false, 'a single missed 30-min run (1h old) must not false-alarm at a 3h threshold');
});
