// CM audit 2026-06-22 Task 5 (gov #8) — heat-map ramp coloring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heatRampColors } from '../api/_shared/cm-native-chart-injector.js';
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
