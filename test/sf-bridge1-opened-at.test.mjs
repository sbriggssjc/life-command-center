// SF-BRIDGE1-opened-at (POSTSHIP-R73, 2026-09-24) — Salesforce CreatedDate lands in
// bd_opportunities.opened_at, fill-forward, and the batch endpoint accepts the SOQL
// result envelope ({ deals: { records: [...] } }) instead of 400ing on it.
// See supabase/migrations/20261102300000_lcc_sf_bridge1_opened_at_fill_forward.sql.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  makeOpportunitySyncRoute, normalizeDeal, sfCreatedDate, extractDeals,
} from '../mcp/opportunity-sync.js';

const WS = 'a0000000-0000-0000-0000-000000000001';
const DEAL = { Id: '006Vs00000hhYfCIAU', Name: 'US Renal-Anchored MOB - Findlay - OH', StageName: 'Listing Signed', CreatedDate: '2024-01-15T18:22:33.000+0000' };

function harness() {
  const rpcRows = [];
  const opsQuery = async (method, path, body) => {
    if (path.startsWith('rpc/lcc_upsert_bd_opportunities')) {
      rpcRows.push(body.p_deals[0]);
      return { ok: true, data: [{ outcome: 'updated', bd_opportunity_id: 'b1' }] };
    }
    if (path.startsWith('bd_opportunities?')) return { ok: true, data: [{ entity_id: 'e1' }] };
    if (path.startsWith('entities?id=')) return { ok: true, data: [{ domain: 'dia' }] };
    return { ok: true, data: [] };
  };
  const route = makeOpportunitySyncRoute({ opsQuery, enc: encodeURIComponent, WORKSPACE_ID: WS, lookupStagedDeals: async () => new Map() });
  const run = async (body) => {
    let status = 200, out = null;
    const res = { status(s) { status = s; return this; }, json(b) { out = b; return this; } };
    await route.ingestBatch({ body }, res);
    return { status, out };
  };
  return { run, rpcRows };
}

describe('CreatedDate → opened_at', () => {
  it('normalizeDeal maps the Salesforce CreatedDate to an ISO timestamp', () => {
    assert.equal(normalizeDeal(DEAL).opened_at, '2024-01-15T18:22:33.000Z');
  });
  it('an internal-shape opened_at is accepted too', () => {
    assert.equal(normalizeDeal({ opened_at: '2023-03-01T00:00:00Z' }).opened_at, '2023-03-01T00:00:00.000Z');
  });
  it('absent or unparseable is NULL, never passed through to the timestamptz cast', () => {
    assert.equal(normalizeDeal({ Id: 'x' }).opened_at, null);
    assert.equal(sfCreatedDate(''), null);
    assert.equal(sfCreatedDate('not a date'), null);
  });
  it('the sync sends opened_at to the RPC', async () => {
    const h = harness();
    await h.run({ deals: [DEAL] });
    assert.equal(h.rpcRows[0].opened_at, '2024-01-15T18:22:33.000Z');
  });
});

describe('opened_at is filled forward by the RPC, never overwritten', () => {
  // The newest migration that (re)defines the RPC is the one live; a later
  // redefinition that drops the column or overwrites it must turn this red.
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const newest = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /CREATE OR REPLACE FUNCTION public\.lcc_upsert_bd_opportunities\s*\(/i
      .test(readFileSync(new URL(f, dir), 'utf8'))).pop();
  const sql = readFileSync(new URL(newest, dir), 'utf8').replace(/--[^\n]*/g, '');
  const onConflict = sql.slice(sql.indexOf('ON CONFLICT (workspace_id, sf_opp_id) DO UPDATE SET'), sql.indexOf('RETURNING t.id'));

  it('the INSERT carries opened_at from the payload', () => {
    assert.match(sql, /metadata,\s*opened_at\s*\)/);
    assert.match(sql, /NULLIF\(v_deal->>'opened_at', ''\)::timestamptz/);
  });
  it('the conflict arm keeps a stored value (COALESCE(t.opened_at, EXCLUDED.opened_at))', () => {
    assert.match(onConflict, /opened_at\s*=\s*COALESCE\(t\.opened_at,\s*EXCLUDED\.opened_at\)/);
  });
});

describe('batch envelope', () => {
  it('{ deals: [...] } still works', async () => {
    const h = harness();
    const { status, out } = await h.run({ deals: [DEAL] });
    assert.equal(status, 200);
    assert.equal(out.total, 1);
    assert.equal(h.rpcRows.length, 1);
  });
  it('the SOQL result object { deals: { totalSize, done, records } } is unwrapped, not a 400', async () => {
    const h = harness();
    const { status, out } = await h.run({ deals: { totalSize: 1, done: true, records: [DEAL] } });
    assert.equal(status, 200);
    assert.equal(out.total, 1);
    assert.equal(h.rpcRows[0].sf_opp_id, DEAL.Id);
  });
  it('an object with no records array is still refused', async () => {
    const h = harness();
    const { status, out } = await h.run({ deals: { totalSize: 0 } });
    assert.equal(status, 400);
    assert.equal(out.ok, false);
    assert.equal(extractDeals({ deals: 'x' }), null);
  });
  it('no deals key is an empty batch, as before', () => {
    assert.deepEqual(extractDeals({}), []);
    assert.deepEqual(extractDeals([DEAL]), [DEAL]);
  });
});
