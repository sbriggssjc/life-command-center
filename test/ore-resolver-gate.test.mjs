// W4.4 — ORE resolver merge-gate, fail-closed. Unit tests for the pure gate core
// (gateFromMatch + finalMergeAction) and the resolver-client fail-closed contract
// (service down / unset URL / non-2xx → { ok:false } → no merge). No live service.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { matchOwnerNamePair, gateFromMatch } from '../api/_shared/resolver-client.js';
import { finalMergeAction, classifyReconcilePair } from '../api/_handlers/owner-reconcile-engine.js';

const realFetch = globalThis.fetch;
const realUrl = process.env.RESOLVER_URL;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realUrl === undefined) delete process.env.RESOLVER_URL;
  else process.env.RESOLVER_URL = realUrl;
});

describe('gateFromMatch — pure band → decision', () => {
  it('auto_link band → confirm', () => {
    assert.equal(gateFromMatch({ ok: true, band: 'auto_link', probability: 0.99 }).decision, 'confirm');
  });
  it('needs_review band → veto (not a confident match)', () => {
    assert.equal(gateFromMatch({ ok: true, band: 'needs_review', probability: 0.6 }).decision, 'veto');
  });
  it('auto_reject band → veto', () => {
    assert.equal(gateFromMatch({ ok: true, band: 'auto_reject', probability: 0.01 }).decision, 'veto');
  });
  it('ok:false → fallback (fail-closed)', () => {
    assert.equal(gateFromMatch({ ok: false, error: 'timeout' }).decision, 'fallback');
    assert.equal(gateFromMatch(null).decision, 'fallback');
  });
});

describe('finalMergeAction — a merge only survives a resolver confirm', () => {
  it('merge + confirm → merge', () => {
    assert.equal(finalMergeAction('merge', { decision: 'confirm' }), 'merge');
  });
  it('merge + veto → flag_review (needs_review, no merge)', () => {
    assert.equal(finalMergeAction('merge', { decision: 'veto' }), 'flag_review');
  });
  it('merge + fallback (service down) → flag_review (FAIL-CLOSED, no merge)', () => {
    assert.equal(finalMergeAction('merge', { decision: 'fallback' }), 'flag_review');
  });
  it('non-merge actions are never promoted', () => {
    assert.equal(finalMergeAction('flag_review', { decision: 'confirm' }), 'flag_review');
    assert.equal(finalMergeAction('record_distinct', { decision: 'confirm' }), 'record_distinct');
  });
  it('no gate (resolver off) leaves the base action', () => {
    assert.equal(finalMergeAction('merge', null), 'merge');
  });
});

describe('matchOwnerNamePair — fail-closed on every unhappy path', () => {
  it('RESOLVER_URL unset → ok:false (no network)', async () => {
    delete process.env.RESOLVER_URL;
    const r = await matchOwnerNamePair('Cedar Point LLC', 'Cedar Point L.L.C.');
    assert.equal(r.ok, false);
    assert.match(r.error, /unset/);
  });
  it('service down (fetch throws) → ok:false', async () => {
    process.env.RESOLVER_URL = 'https://resolver.example';
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const r = await matchOwnerNamePair('A LLC', 'B LLC');
    assert.equal(r.ok, false);
  });
  it('non-2xx → ok:false', async () => {
    process.env.RESOLVER_URL = 'https://resolver.example';
    globalThis.fetch = async () => new Response('nope', { status: 503 });
    const r = await matchOwnerNamePair('A LLC', 'B LLC');
    assert.equal(r.ok, false);
    assert.match(r.error, /503/);
  });
  it('a healthy auto_link response passes the band through', async () => {
    process.env.RESOLVER_URL = 'https://resolver.example';
    globalThis.fetch = async () => new Response(JSON.stringify({
      bands: { auto_link: 0.5 },
      pairs: [{ band: 'auto_link', probability: 0.97 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const r = await matchOwnerNamePair('Cedar Point LLC', 'Cedar Point L.L.C.');
    assert.equal(r.ok, true);
    assert.equal(r.band, 'auto_link');
    assert.equal(gateFromMatch(r).decision, 'confirm');
  });
  it('no candidate pair (blocked out) → rejecting band → veto', async () => {
    process.env.RESOLVER_URL = 'https://resolver.example';
    globalThis.fetch = async () => new Response(JSON.stringify({
      bands: { auto_link: 0.5 }, pairs: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const r = await matchOwnerNamePair('Cedar Point LLC', 'Zzz Unrelated LLC');
    assert.equal(r.ok, true);
    assert.equal(gateFromMatch(r).decision, 'veto');
  });
});

describe('end-to-end fail-closed chain (service down → no merge)', () => {
  it('unset URL → gate fallback → merge downgraded to needs_review', async () => {
    delete process.env.RESOLVER_URL;
    // The SQL verdict said same_party (would auto-merge)…
    const pair = { verdict: 'same_party', candidate_name: 'X LLC' };
    assert.equal(classifyReconcilePair(pair), 'merge');
    // …but the resolver is down, so the gate fails closed and it becomes review.
    const gate = gateFromMatch(await matchOwnerNamePair('X LLC', 'X L.L.C.'));
    assert.equal(gate.decision, 'fallback');
    assert.equal(finalMergeAction('merge', gate), 'flag_review');
  });
});
