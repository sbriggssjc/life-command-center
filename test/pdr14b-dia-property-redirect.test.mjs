// ============================================================================
// PDR14b — dia dangling property_id self-heal: planner invariants.
//
// entity with a LIVE domain_property_id is never touched (the caller only
// ever hands the planner already-dangling candidates, but the resolver logic
// itself must still never invent a resolution the redirect/parcel channels
// did not earn).
//
// entity with a resolvable dangling pointer is corrected EXACTLY ONCE via a
// named channel ('pdr14b_redirect' preferred over 'pdr14b_parcel_match' when
// both would apply — the redirect table is the more authoritative source).
//
// entity with no confident match is FLAGGED, never guessed — an ambiguous
// parcel match (n_match !== 1) or a too-short/compound parcel token must
// never resolve.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_PARCEL_LEN,
  usableParcelToken,
  splitLiveDangling,
  resolveDanglingEntity,
  planDiaPropertyRedirectSweep,
} from '../api/_shared/dia-property-redirect-planner.js';

// ---------------------------------------------------------------------------
// usableParcelToken — mirrors dia_find_property_twins_strong_id's
// p_min_parcel_len default (6), and refuses a compound (comma-joined)
// multi-parcel capture, which is a real, common shape in this repo's own
// metadata (see PDR14b sweep: "30-2S-30-1001-001-028, 30-2S-30-1001-002-028, ...").
// ---------------------------------------------------------------------------

test('usableParcelToken: refuses null/blank', () => {
  assert.equal(usableParcelToken(null), null);
  assert.equal(usableParcelToken(undefined), null);
  assert.equal(usableParcelToken(''), null);
  assert.equal(usableParcelToken('   '), null);
});

test('usableParcelToken: refuses a token shorter than MIN_PARCEL_LEN', () => {
  assert.equal(MIN_PARCEL_LEN, 6);
  assert.equal(usableParcelToken('14'), null);
  assert.equal(usableParcelToken('12345'), null); // 5 chars, one short
});

test('usableParcelToken: accepts a single token at exactly MIN_PARCEL_LEN', () => {
  assert.equal(usableParcelToken('123456'), '123456');
});

test('usableParcelToken: refuses a comma-joined compound parcel capture', () => {
  assert.equal(
    usableParcelToken('30-2S-30-1001-001-028, 30-2S-30-1001-002-028'),
    null
  );
});

test('usableParcelToken: trims whitespace but preserves the real token', () => {
  assert.equal(usableParcelToken('  480276030003000  '), '480276030003000');
});

// ---------------------------------------------------------------------------
// splitLiveDangling
// ---------------------------------------------------------------------------

test('splitLiveDangling: partitions by the exists flag exactly', () => {
  const rows = [
    { pid: '1', exists: true },
    { pid: '2', exists: false },
    { pid: '3', exists: false },
    { pid: '4', exists: true },
  ];
  const { live, dangling } = splitLiveDangling(rows);
  assert.deepEqual(live, ['1', '4']);
  assert.deepEqual(dangling, ['2', '3']);
});

// ---------------------------------------------------------------------------
// resolveDanglingEntity — the core "never guess" contract.
// ---------------------------------------------------------------------------

test('resolveDanglingEntity: redirect resolution wins and is never overridden', () => {
  const r = resolveDanglingEntity({
    redirectResolved: 39874,
    parcelMatch: { n_match: 1, candidate_pid: 999 }, // must be ignored
  });
  assert.deepEqual(r, { via: 'pdr14b_redirect', resolved: 39874 });
});

test('resolveDanglingEntity: falls back to an unambiguous parcel match when redirect has nothing', () => {
  const r = resolveDanglingEntity({
    redirectResolved: null,
    parcelMatch: { n_match: 1, candidate_pid: 25896 },
  });
  assert.deepEqual(r, { via: 'pdr14b_parcel_match', resolved: 25896 });
});

test('resolveDanglingEntity: an AMBIGUOUS parcel match (n_match > 1) resolves nothing', () => {
  const r = resolveDanglingEntity({
    redirectResolved: null,
    parcelMatch: { n_match: 3, candidate_pid: null },
  });
  assert.deepEqual(r, { via: null, resolved: null });
});

test('resolveDanglingEntity: a ZERO-match parcel probe resolves nothing', () => {
  const r = resolveDanglingEntity({
    redirectResolved: null,
    parcelMatch: { n_match: 0, candidate_pid: null },
  });
  assert.deepEqual(r, { via: null, resolved: null });
});

test('resolveDanglingEntity: no redirect and no parcel probe at all resolves nothing', () => {
  const r = resolveDanglingEntity({ redirectResolved: null, parcelMatch: null });
  assert.deepEqual(r, { via: null, resolved: null });
});

test('resolveDanglingEntity: redirectResolved undefined is treated the same as null', () => {
  const r = resolveDanglingEntity({ redirectResolved: undefined, parcelMatch: null });
  assert.deepEqual(r, { via: null, resolved: null });
});

// ---------------------------------------------------------------------------
// planDiaPropertyRedirectSweep — the batch contract the handler relies on.
// ---------------------------------------------------------------------------

test('planDiaPropertyRedirectSweep: splits a mixed batch into apply/flag with honest counts', () => {
  const plan = planDiaPropertyRedirectSweep([
    { id: 'e1', dead_pid: '37722', redirectResolved: 39874, parcelMatch: null },
    { id: 'e2', dead_pid: '3719807', redirectResolved: null, parcelMatch: { n_match: 1, candidate_pid: 25896 } },
    { id: 'e3', dead_pid: '29100', redirectResolved: null, parcelMatch: { n_match: 2, candidate_pid: null } },
    { id: 'e4', dead_pid: '31513', redirectResolved: null, parcelMatch: null },
  ]);
  assert.equal(plan.resolved_via_redirect, 1);
  assert.equal(plan.resolved_via_parcel, 1);
  assert.equal(plan.flagged, 2);
  assert.deepEqual(plan.toApply, [
    { entity_id: 'e1', dead_pid: '37722', resolved: '39874', via: 'pdr14b_redirect' },
    { entity_id: 'e2', dead_pid: '3719807', resolved: '25896', via: 'pdr14b_parcel_match' },
  ]);
  assert.deepEqual(plan.toFlag, [
    { entity_id: 'e3', dead_pid: '29100', reason: 'no_confident_match' },
    { entity_id: 'e4', dead_pid: '31513', reason: 'no_confident_match' },
  ]);
});

test('planDiaPropertyRedirectSweep: an empty batch produces an empty, zeroed plan', () => {
  const plan = planDiaPropertyRedirectSweep([]);
  assert.deepEqual(plan.toApply, []);
  assert.deepEqual(plan.toFlag, []);
  assert.equal(plan.resolved_via_redirect, 0);
  assert.equal(plan.resolved_via_parcel, 0);
  assert.equal(plan.flagged, 0);
});

// ---------------------------------------------------------------------------
// Positive control: the LIVE PDR14b sweep result (2026-09-11), pinned so a
// future change to the resolution order cannot silently regress the exact
// acceptance case PDR3/PDR6 were blocked on.
// ---------------------------------------------------------------------------

test('positive control: entity d90be440... (DaVita/Donna-TX) resolves via redirect to 39874', () => {
  const plan = planDiaPropertyRedirectSweep([
    {
      id: 'd90be440-c4f2-4e6c-a50e-8a0be44c9d76',
      dead_pid: '37722',
      redirectResolved: 39874,
      parcelMatch: null,
    },
  ]);
  assert.equal(plan.toApply.length, 1);
  assert.equal(plan.toApply[0].resolved, '39874');
  assert.equal(plan.toApply[0].via, 'pdr14b_redirect');
});
