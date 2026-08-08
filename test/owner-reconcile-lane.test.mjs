// W3.2 — Owner-reconcile Decision-Center lane: pure-helper unit tests.
// Covers oreCanonicalPairRef (order-independent LCC pair subject_ref — the
// dedupe key that collapses the reciprocal pair) and ownerReconcileLabelVerdict
// (lane verdict token → training LABEL). Also asserts the three-seeder
// subject_ref namespaces + the entity_match_labels wiring are present in the
// server, and that the client lane is registered (partition-safe).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { oreCanonicalPairRef, ownerReconcileLabelVerdict } from '../api/admin.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

describe('oreCanonicalPairRef — order-independent LCC pair key', () => {
  it('produces the SAME ref regardless of argument order (dedupes reciprocal pairs)', () => {
    const a = '11111111-1111-1111-1111-111111111111';
    const b = '22222222-2222-2222-2222-222222222222';
    assert.equal(oreCanonicalPairRef(a, b), oreCanonicalPairRef(b, a));
  });
  it('is namespaced under ownrec:lcc: with the two ids sorted', () => {
    const a = 'bbbb', b = 'aaaa';
    assert.equal(oreCanonicalPairRef(a, b), 'ownrec:lcc:aaaa:bbbb');
  });
  it('returns null when either id is missing', () => {
    assert.equal(oreCanonicalPairRef(null, 'x'), null);
    assert.equal(oreCanonicalPairRef('x', undefined), null);
  });
});

describe('ownerReconcileLabelVerdict — verdict token → training label', () => {
  it('maps every approve alias to same_party (positive)', () => {
    for (const v of ['approve', 'confirm', 'same_party', 'merge', 'APPROVE'])
      assert.equal(ownerReconcileLabelVerdict(v), 'same_party');
  });
  it('maps every reject alias to distinct (negative)', () => {
    for (const v of ['reject', 'distinct', 'not_a_match', 'keep_separate'])
      assert.equal(ownerReconcileLabelVerdict(v), 'distinct');
  });
  it('returns null for research / unknown (not a label)', () => {
    assert.equal(ownerReconcileLabelVerdict('research'), null);
    assert.equal(ownerReconcileLabelVerdict(''), null);
    assert.equal(ownerReconcileLabelVerdict(undefined), null);
  });
});

describe('server: three-seeder wiring + entity_match_labels', () => {
  const admin = read('api/admin.js');
  it('owner_reconcile is a federated lane', () => {
    assert.match(admin, /FEDERATED_DECISION_TYPES\s*=\s*new Set\(\[[\s\S]*'owner_reconcile'[\s\S]*\]\)/);
  });
  it('federatedSubjectRef namespaces all three seeders', () => {
    assert.ok(admin.includes("'ownrec:lcc:'"), 'ORE pair namespace');
    assert.ok(admin.includes("'ownrec:govu:'"), 'owner_unification namespace');
    assert.ok(admin.includes("'ownrec:emc:'"), 'entity_match_candidate namespace');
  });
  it('the verdict path writes both lcc_decisions (record) AND entity_match_labels', () => {
    assert.ok(admin.includes('writeEntityMatchLabel('), 'label writer called');
    assert.ok(admin.includes("'rpc/lcc_merge_entity'"), 'LCC approve merges via lcc_merge_entity');
  });
  it('gov/dia seeders disposition their source row (verdicts only, no domain merge)', () => {
    assert.ok(admin.includes("'owner_unification_review_queue?id=eq.'"), 'gov ouq dispositioned');
    assert.ok(admin.includes("'entity_match_candidates?id=eq.'"), 'emc dispositioned');
  });
});

describe('client: owner_reconcile lane registered', () => {
  // W6.5 Stage 1 (P87): federated lane card/verdict code moved to dc-lanes.js
  // (classic script loaded before ops.js, same global scope) — read both halves.
  const ops = read('ops.js') + '\n' + read('dc-lanes.js');
  it('is in _DC_FEDERATED (partition-safe with the server set)', () => {
    assert.match(ops, /_DC_FEDERATED\s*=\s*new Set\(\[[\s\S]*'owner_reconcile'[\s\S]*\]\)/);
  });
  it('has a card renderer with approve/reject/research actions', () => {
    assert.ok(ops.includes("_dcFedType === 'owner_reconcile'"), 'card branch present');
    assert.ok(ops.includes("dcFed(' + i + ',\\'approve\\')"), 'approve action');
    assert.ok(ops.includes("dcFed(' + i + ',\\'reject\\')"), 'reject action');
  });
});
