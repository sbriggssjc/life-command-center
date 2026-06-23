// CM audit 2026-06-22 Task 5 (gov #8) — heat-map ramp coloring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heatRampColors, fitCapAxisRange } from '../api/_shared/cm-native-chart-injector.js';
// Confirms the renderer's cross-module ESM import of heatRampColors resolves.
import * as renderer from '../api/_shared/cm-chart-image-renderer.js';

test('heatRampColors: low value -> pale, high value -> navy, graded between', () => {
  const cols = heatRampColors([10, 20, 30]); // ascending
  assert.equal(cols.length, 3);
  assert.equal(cols[0], 'C9DCF0');           // min -> pale sky (low color)
  assert.equal(cols[2], '003DA5');           // max -> NM Blue (high color)
  assert.notEqual(cols[1], cols[0]);         // mid is graded, not flat
  assert.notEqual(cols[1], cols[2]);
});

test('heatRampColors: order is preserved (descending input)', () => {
  const cols = heatRampColors([30, 20, 10]); // descending (heat-map view order)
  assert.equal(cols[0], '003DA5');           // first row = highest = navy
  assert.equal(cols[2], 'C9DCF0');           // last row  = lowest  = pale
});

test('heatRampColors: degenerate + non-finite inputs fall back to the low color', () => {
  assert.deepEqual(heatRampColors([]), []);
  assert.deepEqual(heatRampColors([5, 5, 5]), ['C9DCF0', 'C9DCF0', 'C9DCF0']); // zero span
  assert.deepEqual(heatRampColors([null, undefined, NaN]), ['C9DCF0', 'C9DCF0', 'C9DCF0']);
});

test('renderer ESM import of heatRampColors resolves', () => {
  assert.equal(typeof renderer.renderChartsToImages, 'function');
});

// CM audit Task 5 — data-driven cap-rate/spread Y-axis auto-fit. Targets below
// are Scott's grounded June-22 numbers; floor=round-down-0.5%, ceil=round-up-0.5%.
const capCols = [{ key: 'cap', format: 'percent_basis_points' }];
const rowsOf = (vals) => vals.map((v) => ({ cap: v }));

test('fitCapAxisRange matches Scott\'s grounded targets', () => {
  assert.deepEqual(fitCapAxisRange(rowsOf([0.050, 0.072, 0.095]), capCols), { min: 0.05, max: 0.095 });   // most-cap 5.0-9.5
  assert.deepEqual(fitCapAxisRange(rowsOf([0.063, 0.070, 0.076]), capCols), { min: 0.06, max: 0.08 });    // gov NM 6.0-8.0
  assert.deepEqual(fitCapAxisRange(rowsOf([0.055, 0.066, 0.076]), capCols), { min: 0.055, max: 0.08 });   // dia active 5.5-8.0
  assert.deepEqual(fitCapAxisRange(rowsOf([0.070, 0.082, 0.0911]), capCols), { min: 0.07, max: 0.095 });  // gov credit 7.0-9.5
});

test('fitCapAxisRange: Net Lease Spread floors toward zero (no high floor forced)', () => {
  assert.deepEqual(fitCapAxisRange(rowsOf([0.011, 0.05, 0.106]), capCols), { min: 0.01, max: 0.11 });
});

test('fitCapAxisRange: null fallbacks keep prior literal (no regression)', () => {
  assert.equal(fitCapAxisRange(rowsOf([0.07]), capCols), null);          // <2 points
  assert.equal(fitCapAxisRange([], capCols), null);                      // no rows
  assert.equal(fitCapAxisRange(rowsOf([700, 250]), capCols), null);      // bps-shape values out of band -> excluded
  assert.equal(fitCapAxisRange(rowsOf([0.06, 0.07]),
    [{ key: 'cap', format: 'integer_count' }]), null);                   // non-percent column -> not a cap series
});

test('fitCapAxisRange reads fieldKeys coalesce + ignores non-cap percent gaps', () => {
  const cols = [{ key: 'x', fieldKeys: ['top_quartile', 'top'], format: 'percent_basis_points' }];
  const rows = [{ top_quartile: 0.052 }, { top: 0.081 }];
  assert.deepEqual(fitCapAxisRange(rows, cols), { min: 0.05, max: 0.085 });
});
