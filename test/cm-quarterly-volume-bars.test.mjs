// Regression tests for the Quarterly Volume Bars composer (Data_Volume_Quarterly).
//
// The gov export historically rendered "boxy" — three straight months carrying
// the same quarter total — because the composer plotted master_m.quarterly_volume
// (repeated on every monthly anchor). It was rebuilt as a TRAILING-3-MONTH ROLLING
// SUM of true monthly volume (A5 / feedback item #11). These tests lock that:
//   1. the rolling path moves month-to-month and equals the quarter total at
//      quarter-end months;
//   2. the composer prefers the slim `volumeMonthlyRows` projection (which the
//      export re-fetches when the full 39-column master_m select fails);
//   3. the fallback collapses to ONE bar per quarter — never the boxy
//      monthly-repeat — when no monthly volume is available at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRolling3MonthVolumeBars, SYNTHETIC_COMPOSERS } from '../api/capital-markets.js';

// Three quarters of true monthly volume (lumpy, like real gov data).
const MONTHLY = [
  { period_end: '2025-10-31', monthly_volume: 43475000,  monthly_count: 14 },
  { period_end: '2025-11-30', monthly_volume: 112757681, monthly_count: 16 },
  { period_end: '2025-12-31', monthly_volume: 188412000, monthly_count: 18 },
  { period_end: '2026-01-31', monthly_volume: 62713800,  monthly_count: 8  },
  { period_end: '2026-02-28', monthly_volume: 22717953,  monthly_count: 9  },
  { period_end: '2026-03-31', monthly_volume: 170605631, monthly_count: 15 },
];

test('buildRolling3MonthVolumeBars: bars move month-to-month (not boxy)', () => {
  const out = buildRolling3MonthVolumeBars(MONTHLY);
  assert.equal(out.length, MONTHLY.length);
  // First two months have no full trailing window yet.
  assert.equal(out[0].quarterly_volume, null);
  assert.equal(out[1].quarterly_volume, null);
  // Rolling 3-month sums.
  assert.equal(out[2].quarterly_volume, 43475000 + 112757681 + 188412000); // Dec
  assert.equal(out[3].quarterly_volume, 112757681 + 188412000 + 62713800); // Jan
  assert.equal(out[4].quarterly_volume, 188412000 + 62713800 + 22717953);  // Feb
  assert.equal(out[5].quarterly_volume, 62713800 + 22717953 + 170605631);  // Mar
  // Consecutive months differ — the defining property the boxy chart lacked.
  assert.notEqual(out[2].quarterly_volume, out[3].quarterly_volume);
  assert.notEqual(out[3].quarterly_volume, out[4].quarterly_volume);
  assert.notEqual(out[4].quarterly_volume, out[5].quarterly_volume);
});

test('buildRolling3MonthVolumeBars: quarter-end month equals that quarter total', () => {
  const out = buildRolling3MonthVolumeBars(MONTHLY);
  const dec = out.find((r) => r.period_end === '2025-12-31');
  const mar = out.find((r) => r.period_end === '2026-03-31');
  assert.equal(dec.quarterly_volume, 344644681); // Q4-2025 total
  assert.equal(mar.quarterly_volume, 256037384); // Q1-2026 total
});

test('composer prefers the slim volumeMonthlyRows projection', () => {
  const compose = SYNTHETIC_COMPOSERS.quarterly_volume_bars;
  const rows = compose({
    allCharts: [],
    masterMonthlyRows: [],      // full fetch came back empty (Round 6b)
    volumeMonthlyRows: MONTHLY, // slim re-fetch recovered the monthly volume
  });
  assert.equal(rows.length, MONTHLY.length);
  assert.equal(rows[5].quarterly_volume, 62713800 + 22717953 + 170605631);
});

test('composer fallback collapses to ONE bar per quarter (never boxy monthly-repeat)', () => {
  const compose = SYNTHETIC_COMPOSERS.quarterly_volume_bars;
  // Simulate the monthly cm_{vertical}_volume_ttm_m view: monthly rows each
  // carrying the SAME quarter total three times (the boxy source), and NO
  // monthly volume anywhere.
  const monthlyBoxy = [
    { period_end: '2025-10-31', quarterly_volume: 344644681, quarterly_count: 47 },
    { period_end: '2025-11-30', quarterly_volume: 344644681, quarterly_count: 47 },
    { period_end: '2025-12-31', quarterly_volume: 344644681, quarterly_count: 47 },
    { period_end: '2026-01-31', quarterly_volume: 256037384, quarterly_count: 31 },
    { period_end: '2026-02-28', quarterly_volume: 256037384, quarterly_count: 31 },
    { period_end: '2026-03-31', quarterly_volume: 256037384, quarterly_count: 31 },
  ];
  const rows = compose({
    allCharts: [{ chart_template_id: 'volume_ttm_by_quarter', rows: monthlyBoxy }],
    masterMonthlyRows: [],
    volumeMonthlyRows: [],
  });
  // One bar per quarter, anchored on the quarter-end month.
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.period_end), ['2025-12-31', '2026-03-31']);
  assert.equal(rows[0].quarterly_volume, 344644681);
  assert.equal(rows[1].quarterly_volume, 256037384);
});
