// test/deal-milestone-collapse.test.mjs
// W7.2c — the canonical same-key collapse rule (mirrored by the SQL writer +
// the one-shot collapse). Covers insert / roll-up / stale+regressed new-round /
// idempotent noop / the "stale but NOT regressed still rolls up" boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageRank, collapseDecision, STALE_DAYS } from '../api/_shared/deal-milestone-collapse.js';

test('stageRank orders the deal lifecycle; unknown → 0', () => {
  assert.ok(stageRank('loi') < stageRank('psa'));
  assert.ok(stageRank('psa') < stageRank('escrow'));
  assert.ok(stageRank('escrow') < stageRank('close'));
  assert.equal(stageRank('LOI'), stageRank('loi'));   // case-insensitive
  assert.equal(stageRank('nonsense'), 0);
  assert.equal(stageRank(null), 0);
});

test('no prior row → insert', () => {
  assert.equal(collapseDecision(null, { on: '2026-01-01', detail_ref: 'a1' }, 0), 'insert');
});

test('re-occurrence within window rolls up (Banning: repeat LOI → one row)', () => {
  const prior = { key: 'loi', occurred_on: '2025-02-20', last_seen_on: '2025-02-20', detail_refs: ['a1'] };
  assert.equal(collapseDecision(prior, { on: '2025-03-15', detail_ref: 'a2' }, stageRank('loi')), 'roll_up');
});

test('same evidence → noop (idempotent)', () => {
  const prior = { key: 'loi', occurred_on: '2025-02-20', last_seen_on: '2025-02-20', detail_refs: ['a1', 'a2'] };
  assert.equal(collapseDecision(prior, { on: '2025-03-15', detail_ref: 'a2' }, 100), 'noop');
});

test('stale AND stage-regressed → new_round (second LOI after deal advanced then fell through)', () => {
  // Deal reached escrow (rank 80); a fresh LOI 120d later with the deal having
  // advanced past LOI is a genuinely new round.
  const prior = { key: 'loi', occurred_on: '2025-02-20', last_seen_on: '2025-02-20', detail_refs: ['a1'] };
  const dealMaxRank = stageRank('escrow');
  assert.equal(collapseDecision(prior, { on: '2025-06-25', detail_ref: 'a9' }, dealMaxRank), 'new_round');
});

test('stale but NOT regressed → still rolls up (LOI is the furthest the deal ever got)', () => {
  const prior = { key: 'loi', occurred_on: '2025-02-20', last_seen_on: '2025-02-20', detail_refs: ['a1'] };
  assert.equal(collapseDecision(prior, { on: '2025-06-25', detail_ref: 'a9' }, stageRank('loi')), 'roll_up');
});

test('regressed but NOT stale (within 90d) → rolls up', () => {
  const prior = { key: 'loi', occurred_on: '2025-02-20', last_seen_on: '2025-02-20', detail_refs: ['a1'] };
  const near = new Date(new Date('2025-02-20').getTime() + (STALE_DAYS - 5) * 86_400_000).toISOString().slice(0, 10);
  assert.equal(collapseDecision(prior, { on: near, detail_ref: 'a9' }, stageRank('close')), 'roll_up');
});
