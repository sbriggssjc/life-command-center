// ORE — multi-signal reconciliation engine: pure worker-helper tests.
//
// Covers classifyReconcilePair (the resolver-verdict → action map) and
// pickMergeWinner (the same-party cluster winner selection). The weighted
// clustering itself lives in SQL (lcc_reconcile_owner) and is verified live;
// these tests pin the JS decision layer that consumes it. No I/O.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReconcilePair, pickMergeWinner } from '../api/_handlers/owner-reconcile-engine.js';

describe('classifyReconcilePair — resolver verdict → action', () => {
  it('same_party (no conflict) → merge', () => {
    assert.equal(classifyReconcilePair({ verdict: 'same_party', high_authority_conflict: false }), 'merge');
  });
  it('review → flag_review (surface, never guess)', () => {
    assert.equal(classifyReconcilePair({ verdict: 'review', high_authority_conflict: false }), 'flag_review');
  });
  it('distinct → record_distinct', () => {
    assert.equal(classifyReconcilePair({ verdict: 'distinct', high_authority_conflict: false }), 'record_distinct');
  });
  it('a high-authority conflict is NEVER a merge, even if verdict says same_party', () => {
    // defense-in-depth: a conflicting SF account holds two shells apart
    assert.equal(classifyReconcilePair({ verdict: 'same_party', high_authority_conflict: true }), 'record_distinct');
  });
  it('missing/blank verdict → skip', () => {
    assert.equal(classifyReconcilePair(null), 'skip');
    assert.equal(classifyReconcilePair({}), 'skip');
  });
});

describe('pickMergeWinner — same-party cluster winner', () => {
  it('the single SF-linked member wins (preserves the CRM link)', () => {
    const w = pickMergeWinner('t', [
      { entity_id: 't', sf_account: null, rank: 9 },
      { entity_id: 'c', sf_account: '0011I00000AbcDeQAY', rank: 0 },
    ]);
    assert.equal(w, 'c');
  });
  it('no SF link anywhere → the value-ranked target is canonical', () => {
    const w = pickMergeWinner('t', [
      { entity_id: 't', sf_account: null, rank: 9 },
      { entity_id: 'c', sf_account: null, rank: 0 },
    ]);
    assert.equal(w, 't');
  });
  it('multiple SF-linked incl. the target → keep the target', () => {
    const w = pickMergeWinner('t', [
      { entity_id: 't', sf_account: 'A', rank: 9 },
      { entity_id: 'c', sf_account: 'B', rank: 3 },
    ]);
    assert.equal(w, 't');
  });
  it('multiple SF-linked, target not one → highest-rank SF-linked', () => {
    const w = pickMergeWinner('t', [
      { entity_id: 't', sf_account: null, rank: 9 },
      { entity_id: 'c1', sf_account: 'A', rank: 3 },
      { entity_id: 'c2', sf_account: 'B', rank: 7 },
    ]);
    assert.equal(w, 'c2');
  });
});
