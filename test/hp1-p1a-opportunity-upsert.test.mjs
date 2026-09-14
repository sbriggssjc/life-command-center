// ============================================================================
// HP1-P1a-fix — the SF opportunity upsert has NEVER updated a row.
//
// docs/claude-code/prompts/HP1-P1a-fix-opportunity-upsert-never-updated.md
//
// Root cause (Unit 1, established by reading source, not re-probed live — the
// fix does not depend on the answer): mcp/opportunity-sync.js called
// opsQuery('POST', 'bd_opportunities?on_conflict=...', row,
//   { Prefer: 'resolution=merge-duplicates,return=representation' })
// and the standalone MCP's own opsQuery(method, path, body, prefer) treats
// the 4th arg as a STRING interpolated straight into the Prefer header — an
// object there degrades to the literal "[object Object]", which PostgREST
// cannot parse, so it silently ran a plain INSERT with no ON CONFLICT
// handling. Fixed by routing the write through a `lcc_upsert_bd_opportunities`
// RPC (migration 20261101170000) that needs no Prefer header at all.
//
// This file guards the three things Unit 5 asks for:
//   1. a batch whose deals ALL fail returns non-2xx
//   2. a second upsert of the same sf_opp_id UPDATEs rather than erroring
//   3. closed_at survives a re-sync of an already-closed deal
//
// Tests 2 and 3 exercise the JS/RPC CONTRACT against a hand-rolled model of
// the migration's own ON CONFLICT clause (mirroring its INSERT/UPDATE/COALESCE
// shape exactly, keyed the same way: (workspace_id, sf_opp_id) unique,
// closed_at/closed_won = COALESCE(existing, incoming)) — the sandbox has no
// live Supabase to round-trip against, so this is the closest available proof
// that processDeal's payload and read of the RPC's response are correct; the
// SQL itself must still be exercised once against the real database per the
// prompt's own verification section (`UPDATED_not_inserted` query) before
// this is called fixed.
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

function fakeRes() {
  return {
    _status: 200,
    _body: null,
    status(s) { this._status = s; return this; },
    json(b) { this._body = b; return this; },
  };
}

// A tiny in-memory model of `public.bd_opportunities` + the migration's
// `lcc_upsert_bd_opportunities` RPC — same unique key, same ON CONFLICT DO
// UPDATE SET list, same COALESCE(existing, incoming) rule for
// closed_at/closed_won. Every OTHER opsQuery path (entity resolution, owner
// lookup, vertical lookup) is stubbed to a fixed no-op answer so only the
// write path under test varies between calls.
function makeFakeDb() {
  const table = new Map(); // key: `${workspace_id}|${sf_opp_id}` -> row
  async function opsQuery(method, path, body) {
    if (method === 'GET' && path.startsWith('bd_opportunities?')) {
      // resolveDealEntity's "already linked?" probe — never linked in these tests.
      return { ok: true, data: [] };
    }
    if (method === 'GET' && path.startsWith('entities?')) {
      return { ok: true, data: [] }; // force entity creation path
    }
    if (method === 'POST' && path === 'entities') {
      return { ok: true, data: { id: body.id } };
    }
    if (method === 'GET' && path.startsWith('lcc_users?')) {
      return { ok: true, data: [] };
    }
    if (method === 'POST' && path === 'rpc/lcc_upsert_bd_opportunities') {
      const [deal] = body.p_deals;
      const key = `${deal.workspace_id}|${deal.sf_opp_id}`;
      const existing = table.get(key);
      const merged = existing
        ? {
            ...existing,
            entity_id: deal.entity_id,
            deal_name: deal.deal_name,
            property_address: deal.property_address,
            stage: deal.stage,
            amount: deal.amount,
            expected_close_date: deal.expected_close_date,
            // The migration's exact rule: COALESCE(bd_opportunities.closed_at, EXCLUDED.closed_at)
            closed_at: existing.closed_at ?? deal.closed_at,
            closed_won: existing.closed_won ?? deal.closed_won,
            owner_user_id: deal.owner_user_id,
            vertical: deal.vertical,
            last_synced_at: deal.last_synced_at,
            metadata: deal.metadata,
          }
        : { id: `bdopp-${table.size + 1}`, ...deal };
      table.set(key, merged);
      return {
        ok: true,
        data: [{
          sf_opp_id: deal.sf_opp_id,
          outcome: existing ? 'updated' : 'inserted',
          reason: null,
          bd_opportunity_id: merged.id,
          entity_id: deal.entity_id,
        }],
      };
    }
    throw new Error(`fakeDb: unhandled opsQuery(${method}, ${path})`);
  }
  return { opsQuery, table };
}

test('processDeal: second sync of the same sf_opp_id UPDATEs, never re-collides on the unique key', async () => {
  const { opsQuery, table } = makeFakeDb();
  const routes = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID });

  const deal1 = { Id: '006AAA', Name: 'Acme - Dallas, TX', StageName: 'BOV', Amount: 1000000 };
  const res1 = fakeRes();
  await routes.ingest({ body: deal1 }, res1);
  assert.equal(res1._status, 200, `first sync must succeed: ${JSON.stringify(res1._body)}`);
  assert.equal(res1._body.ok, true);
  // This is the assertion the whole defect existed for: before the fix, a
  // second POST of the same sf_opp_id 502'd on "duplicate key value violates
  // unique constraint bd_opportunities_workspace_id_sf_opp_id_key".
  const deal2 = { ...deal1, StageName: 'LOI Executed' };
  const res2 = fakeRes();
  await routes.ingest({ body: deal2 }, res2);
  assert.equal(res2._status, 200, `second sync of the same sf_opp_id must UPDATE, not error: ${JSON.stringify(res2._body)}`);
  assert.equal(res2._body.ok, true);
  assert.equal(res2._body.stage, 'loi_executed');

  const row = table.get(`${WORKSPACE_ID}|006AAA`);
  assert.equal(table.size, 1, 'one sf_opp_id must map to exactly one row, never two');
  assert.equal(row.stage, 'loi_executed', 'the stage change must have propagated on the second sync');
});

test('processDeal + RPC contract: closed_at survives a re-sync of an already-closed deal', async () => {
  const { opsQuery, table } = makeFakeDb();
  const routes = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID });

  const closeDeal = { Id: '006BBB', Name: 'Widgetco - Reno, NV', StageName: 'Closed' };
  const r1 = fakeRes();
  await routes.ingest({ body: closeDeal }, r1);
  assert.equal(r1._body.closed, true);
  const firstClosedAt = table.get(`${WORKSPACE_ID}|006BBB`).closed_at;
  assert.ok(firstClosedAt, 'closed_at must be stamped on the transition into closed');

  // Simulate the clock moving forward, then a routine 30-min re-sync of the
  // SAME already-closed deal (the full-refresh flow re-sends every open AND
  // recently-closed record every run).
  await new Promise((r) => setTimeout(r, 5));
  const r2 = fakeRes();
  await routes.ingest({ body: closeDeal }, r2);
  assert.equal(r2._status, 200);
  const secondClosedAt = table.get(`${WORKSPACE_ID}|006BBB`).closed_at;
  assert.equal(
    secondClosedAt, firstClosedAt,
    'Unit 4: closed_at must NOT be re-stamped with a later timestamp on a subsequent sync of an already-closed deal'
  );
});

test('ingestBatch: a batch whose deals ALL fail returns a non-2xx (loud, never a lying 200)', async () => {
  const opsQuery = async (method, path) => {
    if (method === 'POST' && path === 'rpc/lcc_upsert_bd_opportunities') {
      return { ok: false, status: 502, data: { message: 'simulated PostgREST failure' } };
    }
    return { ok: true, data: [] };
  };
  const routes = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID });
  const deals = [
    { Id: '006CCC', Name: 'A - X, TX', StageName: 'BOV' },
    { Id: '006DDD', Name: 'B - Y, TX', StageName: 'BOV' },
  ];
  const res = fakeRes();
  await routes.ingestBatch({ body: { deals } }, res);
  assert.equal(res._body.total, 2);
  assert.equal(res._body.succeeded, 0);
  assert.equal(res._body.failed, 2);
  assert.notEqual(res._status, 200, 'a 100% failed batch must not report HTTP 200 — that is exactly the six weeks of invisible failure this fix closes');
  assert.equal(res._body.ok, false);
  // Unit 3: the detail must ride along, not just the label.
  assert.ok(res._body.errors[0].detail, 'error detail must be carried through, not discarded');
});

test('ingestBatch: a partial failure still returns 200 but is flagged, and a full success is unflagged', async () => {
  let n = 0;
  const opsQuery = async (method, path, body) => {
    if (method === 'GET') return { ok: true, data: [] };
    if (method === 'POST' && path === 'entities') return { ok: true, data: { id: body.id } };
    if (method === 'POST' && path === 'rpc/lcc_upsert_bd_opportunities') {
      n++;
      if (n === 1) return { ok: false, status: 502, data: { message: 'one bad row' } };
      const [deal] = body.p_deals;
      return { ok: true, data: [{ sf_opp_id: deal.sf_opp_id, outcome: 'inserted', reason: null, bd_opportunity_id: 'x', entity_id: deal.entity_id }] };
    }
    throw new Error('unhandled: ' + method + ' ' + path);
  };
  const routes = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID });
  const deals = [
    { Id: '006EEE', Name: 'A - X, TX', StageName: 'BOV' },
    { Id: '006FFF', Name: 'B - Y, TX', StageName: 'BOV' },
  ];
  const res = fakeRes();
  await routes.ingestBatch({ body: { deals } }, res);
  assert.equal(res._status, 200, 'a partial failure must still report 200 (it is not a total outage)');
  assert.equal(res._body.ok, true);
  assert.equal(res._body.partial, true);
  assert.equal(res._body.succeeded, 1);
  assert.equal(res._body.failed, 1);
});

test('opportunity-sync source: writes go through the RPC, never the old on_conflict= PostgREST upsert', () => {
  const src = readFileSync(join(ROOT, 'mcp', 'opportunity-sync.js'), 'utf8');
  // Strip `//` line comments before matching (this repo's standing rule — a
  // fix's own explanatory comment quoting the removed call would otherwise
  // satisfy a raw-source grep for the very thing it removed).
  const codeOnly = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(
    src.includes("opsQuery('POST', 'rpc/lcc_upsert_bd_opportunities'"),
    'processDeal must write through the lcc_upsert_bd_opportunities RPC'
  );
  assert.ok(
    !/bd_opportunities\?on_conflict=/.test(codeOnly),
    'the old PostgREST on_conflict= upsert (whose Prefer header was silently mangled) must not be reintroduced'
  );
});

test('migration source: the RPC preserves closed_at/closed_won once set (Unit 4 protection is not silently dropped)', () => {
  const migPath = join(ROOT, 'supabase', 'migrations', '20261101170000_lcc_hp1p1a_opportunity_upsert_rpc.sql');
  const src = readFileSync(migPath, 'utf8');
  assert.ok(
    src.includes('closed_at           = COALESCE(bd_opportunities.closed_at, EXCLUDED.closed_at)'),
    'closed_at must be COALESCE(existing, incoming), never a bare EXCLUDED.closed_at overwrite'
  );
  assert.ok(
    src.includes('closed_won          = COALESCE(bd_opportunities.closed_won, EXCLUDED.closed_won)'),
    'closed_won must be COALESCE(existing, incoming), never a bare EXCLUDED.closed_won overwrite'
  );
  // SEC1-definer-default: this repo's own most-repeated security defect.
  assert.match(src, /REVOKE ALL ON FUNCTION public\.lcc_upsert_bd_opportunities\(jsonb\) FROM public, anon, authenticated/);
  assert.match(src, /has_function_privilege\('service_role', 'public\.lcc_upsert_bd_opportunities\(jsonb\)', 'EXECUTE'\)/);
  assert.match(src, /has_function_privilege\('anon', 'public\.lcc_upsert_bd_opportunities\(jsonb\)', 'EXECUTE'\)/);
});
