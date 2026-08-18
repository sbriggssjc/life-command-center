// ============================================================================
// Prompt 119 — CM Dialysis export fixes (2Q-2026 marketing round)
//
// Regression coverage for the five exporter defects marketing hit building the
// 2Q-2026 Dialysis Market Filter, plus the two derived Value-Prop tiles:
//
//   A. KPI percent tiles shipped with Excel's General format (0.1505)
//   B. KPI_Whats_New "Cap Rate (TTM)" quoted a different series than
//      Data_Cap_Avg (7.41% vs the correct 7.06%)
//   C. KPI_Inv_Snapshot and Data_On_Market_Snapshot disagreed on DOM
//   D. Data_Operator_Bench y-axis labels were unreadable full operator names
//   E. Buyer-share bars stacked "0%" labels for zero-valued series
//   F. KPI_Value_Prop lacked Additional Proceeds ($) / Additional Value (%)
//
// Run: node --test test/cm-prompt119-export-fixes.test.mjs
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveKpiTileFormat,
  deriveValuePropTiles,
  shortOperatorName,
  applyColumnDisplay,
  checkKpiSeriesConsistency,
  getExportBundleSchema,
} from '../api/_shared/cm-excel-export.js';
import { buildInjectionSpec } from '../api/_shared/cm-native-chart-injector.js';

// ---------------------------------------------------------------------------
// A — KPI tile percent formats
// ---------------------------------------------------------------------------

test('A: percent_zero_decimal is mapped (was General -> raw 0.1505)', () => {
  const tile = {
    tile_id: 'pct_price_change',
    tile_label: 'Total Market — Price Change %',
    primary_value: 0.1505,
    primary_format: 'percent_zero_decimal',
  };
  assert.equal(resolveKpiTileFormat(tile), '0%');
});

test('A: every format token the live dia KPI views emit resolves to a percent/number format', () => {
  // Tokens observed live 2026-08-18 across cm_dialysis_{value_prop,whatsnew,
  // trend_watch,inventory_snapshot}_kpis.
  const tokens = [
    'currency_dollars', 'currency_millions', 'integer_count',
    'number_one_decimal', 'percent_basis_points', 'percent_signed',
    'percent_one_decimal', 'percent_zero_decimal',
  ];
  for (const t of tokens) {
    const fmt = resolveKpiTileFormat({ tile_label: 'x', primary_value: 0.5, primary_format: t });
    assert.notEqual(fmt, '', `token ${t} resolved to General`);
  }
});

test('A: an UNMAPPED percent-shaped token still formats as a percent', () => {
  const fmt = resolveKpiTileFormat({
    tile_label: 'Some New Tile',
    primary_value: 0.0526,
    primary_format: 'percent_three_decimal',   // hypothetical future token
  });
  assert.equal(fmt, '0.0%');
});

test('A: an unknown token on a percent-natured LABEL at ratio scale infers a percent', () => {
  assert.equal(
    resolveKpiTileFormat({ tile_label: '10+ Year — Price Change %', primary_value: 0.0526 }),
    '0.0%'
  );
});

test('A: the label heuristic never mangles a dollar or count tile', () => {
  // "Rate"/"Change" words on a non-ratio value must NOT become a percent.
  assert.equal(resolveKpiTileFormat({ tile_label: 'Avg Sales Price Change', primary_value: 269569 }), '');
  assert.equal(resolveKpiTileFormat({ tile_label: 'Number Available', primary_value: 203 }), '');
});

// ---------------------------------------------------------------------------
// B + C — one canonical source per metric
// ---------------------------------------------------------------------------

const capSeriesRows = [
  { period_end: '2026-03-31', subspecialty: 'all', ttm_weighted_cap_rate: 0.069851 },
  { period_end: '2026-06-30', subspecialty: 'all', ttm_weighted_cap_rate: 0.07056484615384615 },
];

function whatsNewPacket(capTileValue) {
  return [
    { chart_template_id: 'cap_rate_ttm_by_quarter', rows: capSeriesRows },
    {
      chart_template_id: 'whatsnew_quarter_kpis',
      rows: [
        { period_end: '2026-06-30', tile_id: 'volume_yoy', primary_value: 0.528, primary_format: 'percent_signed' },
        { period_end: '2026-06-30', tile_id: 'cap_ttm', primary_value: capTileValue, primary_format: 'percent_basis_points' },
      ],
    },
  ];
}

test('B: What\'s-New cap tile equal to the last cap-TTM row passes the guard', () => {
  assert.deepEqual(checkKpiSeriesConsistency(whatsNewPacket(0.07056484615384615)), []);
});

test('B: the ORIGINAL defect (tile 7.41% vs series 7.06%) is caught', () => {
  const warnings = checkKpiSeriesConsistency(whatsNewPacket(0.07411875));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /KPI_Whats_New Cap Rate \(TTM\)/);
  assert.match(warnings[0], /Data_Cap_Avg/);
});

const snapshotRows = [
  {
    period_end: '2026-06-30', cohort: 'total', count_available: 203, avg_price: 4119490.83,
    avg_cap: 0.067597, upper_q_cap: 0.0709, lower_q_cap: 0.060075, median_cap: 0.065,
    avg_dom: 483.0147, pct_price_change: 0.151220,
  },
  {
    period_end: '2026-06-30', cohort: 'core_10plus', count_available: 18, avg_price: 4447031.78,
    avg_cap: 0.062707, upper_q_cap: 0.0668, lower_q_cap: 0.05845, median_cap: 0.0617,
    avg_dom: 435.0588, pct_price_change: 0.055556,
  },
];

function invPacket(totalDom, coreDom) {
  return [
    { chart_template_id: 'on_market_snapshot', rows: snapshotRows },
    {
      chart_template_id: 'inventory_snapshot_kpis',
      rows: [
        { period_end: '2026-06-30', cohort: 'total', tile_id: 'avg_dom', primary_value: totalDom },
        { period_end: '2026-06-30', cohort: 'core_10plus', tile_id: 'avg_dom', primary_value: coreDom },
        { period_end: '2026-06-30', cohort: 'total', tile_id: 'pct_price_change', primary_value: 0.151220 },
        { period_end: '2026-06-30', cohort: 'core_10plus', tile_id: 'pct_price_change', primary_value: 0.055556 },
      ],
    },
  ];
}

test('C: KPI tiles sourced from the snapshot view pass the guard', () => {
  assert.deepEqual(checkKpiSeriesConsistency(invPacket(483.0147, 435.0588)), []);
});

test('C: the ORIGINAL DOM disagreement (480.7/398.9 vs 483.1/421.1) is caught per cohort', () => {
  const warnings = checkKpiSeriesConsistency(invPacket(480.658536585366, 398.9));
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => /avg_dom/.test(w) && /Data_On_Market_Snapshot/.test(w)));
});

test('B+C: a packet missing either side is skipped, not failed', () => {
  assert.deepEqual(checkKpiSeriesConsistency([]), []);
  assert.deepEqual(checkKpiSeriesConsistency([{ chart_template_id: 'whatsnew_quarter_kpis', rows: [] }]), []);
});

// ---------------------------------------------------------------------------
// D — short operator display names
// ---------------------------------------------------------------------------

test('D: marketing\'s operator display mapping', () => {
  const expected = {
    'American Renal Associates': 'American Renal',
    'DaVita':                    'DaVita',
    'Fresenius Medical Care':    'Fresenius',
    'US Renal Care':             'US Renal',
    'Independent / Unknown':     'Independent',
    'Other / Independent':       'Other',
    'Satellite Healthcare':      'Satellite',
  };
  for (const [src, display] of Object.entries(expected)) {
    assert.equal(shortOperatorName(src), display, `${src} -> ${display}`);
  }
});

test('D: already-short and unknown operators pass through unchanged', () => {
  // The live view already emits some short forms; mapping must be idempotent.
  for (const v of ['American Renal', 'Fresenius', 'US Renal', 'Satellite', 'DaVita']) {
    assert.equal(shortOperatorName(v), v);
  }
  assert.equal(shortOperatorName('Dialysis Clinic, Inc.'), 'Dialysis Clinic, Inc.');
  assert.equal(shortOperatorName(null), null);
});

test('D: both operator-keyed dia tabs carry the display transform', () => {
  const { chartColumns } = getExportBundleSchema();
  for (const tmpl of ['dia_operator_ebitda_benchmark', 'dia_operator_unit_economics']) {
    const col = chartColumns[tmpl].find((c) => c.key === 'operator');
    assert.equal(col.display, 'short_operator', `${tmpl} operator column`);
    assert.equal(applyColumnDisplay(col.display, 'Fresenius Medical Care'), 'Fresenius');
  }
});

test('D: a column with no display token is untouched', () => {
  assert.equal(applyColumnDisplay(undefined, 'Fresenius Medical Care'), 'Fresenius Medical Care');
});

// ---------------------------------------------------------------------------
// E — buyer-share zero data labels
// ---------------------------------------------------------------------------

test('E: buyer_class_pct_by_year suppresses zero-valued data labels', () => {
  const cols = (keys) => keys.map((k, i) => ({ key: k, col: String.fromCharCode(65 + i) }));
  const spec = buildInjectionSpec({
    chart_template_id: 'buyer_class_pct_by_year',
    tabName: 'Data_Buyer_Pool',
    cols: cols(['year', 'subspecialty', 'private_pct', 'reit_pct', 'cross_border_pct', 'institutional_pct']),
    dataStart: 5, dataEnd: 20, brand: { palette: {} },
    vertical: 'dialysis',
  });
  assert.ok(spec, 'spec built');
  const series = spec.spec.series;
  assert.equal(series.length, 4);
  for (const s of series) {
    assert.equal(s.showSegmentVal, true);
    // `0%;;;` -> positive renders "0%", negative/zero/text sections are EMPTY.
    assert.equal(s.segmentLabelFmt, '0%;;;');
  }
  // Marketing ChartEdits: white labels on the navy Private + mid-blue REIT fills.
  assert.equal(series[0].segmentLabelColor, 'FFFFFF');
  assert.equal(series[1].segmentLabelColor, 'FFFFFF');
});

// ---------------------------------------------------------------------------
// F — derived Value-Prop tiles
// ---------------------------------------------------------------------------

test('F: Additional Proceeds ($) / Additional Value (%) reproduce marketing\'s hand-computed values', () => {
  const tiles = deriveValuePropTiles([
    { tile_id: 'avg_noi', primary_value: 1930088, sort_order: 1 },
    { tile_id: 'avg_cap_rate', primary_value: 0.0707, sort_order: 2 },
    { tile_id: 'avg_sales_price', primary_value: 5000000, nm_value: 5182180, non_nm_value: 4912611, sort_order: 3 },
  ]);
  assert.equal(tiles.length, 2);
  const [proceeds, pct] = tiles;

  assert.equal(proceeds.tile_label, 'Additional Proceeds ($)');
  assert.equal(proceeds.primary_value, 269569);                 // 5,182,180 - 4,912,611
  assert.equal(proceeds.primary_format, 'currency_dollars');    // '"$"#,##0'

  assert.equal(pct.tile_label, 'Additional Value (%)');
  assert.equal((pct.primary_value * 100).toFixed(1), '5.5');    // 269,569 / 4,912,611
  assert.equal(pct.primary_format, 'percent_one_decimal');      // '0.0%'

  // Appended after the existing tiles, never reordering them.
  assert.deepEqual(tiles.map((t) => t.sort_order), [4, 5]);
});

test('F: a missing NM / Non-NM input emits "Not on file", never a fabricated 0', () => {
  for (const price of [
    { tile_id: 'avg_sales_price', nm_value: 5182180, non_nm_value: null },
    { tile_id: 'avg_sales_price', nm_value: null, non_nm_value: 4912611 },
    { tile_id: 'avg_sales_price', nm_value: 5182180, non_nm_value: 0 },
  ]) {
    const tiles = deriveValuePropTiles([price]);
    for (const t of tiles) {
      assert.equal(t.primary_value, null);
      assert.equal(t.null_display, 'Not on file');
    }
  }
  // No avg_sales_price tile at all -> same honest blank.
  assert.ok(deriveValuePropTiles([]).every((t) => t.primary_value === null));
});

test('F: the derived tiles format as percent, not General (item A applies to them too)', () => {
  const [proceeds, pct] = deriveValuePropTiles([
    { tile_id: 'avg_sales_price', nm_value: 5182180, non_nm_value: 4912611 },
  ]);
  assert.equal(resolveKpiTileFormat(proceeds), '"$"#,##0');
  assert.equal(resolveKpiTileFormat(pct), '0.0%');
});
