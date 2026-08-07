// CM historical as-of — unit coverage for the quarter-end resolution + the
// period_end-keyed snapshot selection helpers (2026-08-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quarterEndOf,
  latestCompletedQuarterEnd,
  resolveAsOf,
  selectSnapshotPeriod,
} from '../api/capital-markets.js';

test('quarterEndOf snaps any date to its enclosing quarter end', () => {
  assert.equal(quarterEndOf('2026-01-01'), '2026-03-31');
  assert.equal(quarterEndOf('2026-02-14'), '2026-03-31');
  assert.equal(quarterEndOf('2026-03-31'), '2026-03-31');
  assert.equal(quarterEndOf('2026-04-01'), '2026-06-30');
  assert.equal(quarterEndOf('2026-08-07'), '2026-09-30');
  assert.equal(quarterEndOf('2026-11-30'), '2026-12-31');
  assert.equal(quarterEndOf('garbage'), null);
});

test('latestCompletedQuarterEnd mirrors cm_last_completed_quarter_end()', () => {
  // First day of the current quarter minus one day.
  assert.equal(latestCompletedQuarterEnd(new Date('2026-08-07T00:00:00Z')), '2026-06-30');
  assert.equal(latestCompletedQuarterEnd(new Date('2026-01-15T00:00:00Z')), '2025-12-31');
  assert.equal(latestCompletedQuarterEnd(new Date('2026-04-01T00:00:00Z')), '2026-03-31');
});

test('resolveAsOf defaults, snaps, clamps, and rejects', () => {
  const latest = latestCompletedQuarterEnd();

  const dflt = resolveAsOf(undefined);
  assert.equal(dflt.asOf, latest);
  assert.equal(dflt.defaulted, true);

  const empty = resolveAsOf('');
  assert.equal(empty.asOf, latest);
  assert.equal(empty.defaulted, true);

  const q1 = resolveAsOf('2026-03-31');
  assert.equal(q1.asOf, '2026-03-31');
  assert.equal(q1.defaulted, false);

  // mid-quarter snaps down to the quarter end
  const mid = resolveAsOf('2026-02-10');
  assert.equal(mid.asOf, '2026-03-31');
  assert.equal(mid.snapped, true);

  // a future quarter is clamped back to the latest completed quarter
  const future = resolveAsOf('2999-12-31');
  assert.equal(future.asOf, latest);

  // unparseable → null (caller returns 400)
  assert.equal(resolveAsOf('not-a-date').asOf, null);
});

test('selectSnapshotPeriod keeps only the greatest period_end <= asOf', () => {
  const rows = [
    { period_end: '2026-06-30', tenant: 'DaVita', count_active: 88 },
    { period_end: '2026-06-30', tenant: 'FMC', count_active: 92 },
    { period_end: '2026-03-31', tenant: 'DaVita', count_active: 144 },
    { period_end: '2025-12-31', tenant: 'DaVita', count_active: 130 },
  ];
  // Selecting the latest reproduces the current snapshot.
  const latest = selectSnapshotPeriod(rows, '2026-06-30');
  assert.deepEqual(latest.map((r) => r.count_active).sort(), [88, 92]);

  // Selecting Q1 reconstructs that quarter only.
  const q1 = selectSnapshotPeriod(rows, '2026-03-31');
  assert.deepEqual(q1.map((r) => r.period_end), ['2026-03-31']);

  // A between-quarters as_of falls back to the most recent prior quarter.
  const between = selectSnapshotPeriod(rows, '2026-05-15');
  assert.deepEqual(between.map((r) => r.period_end), ['2026-03-31']);

  // Nothing at or before the cap → empty.
  assert.deepEqual(selectSnapshotPeriod(rows, '2020-01-01'), []);
});
