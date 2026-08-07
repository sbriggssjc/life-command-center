// CM Export Audit fixes (2026-08-07) — exporter-side unit tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapitalMarketsWorkbook } from '../api/_shared/cm-excel-export.js';
import { cropRowsToDisplayFrom, resolveDisplayFrom } from '../api/capital-markets.js';

test('resolveDisplayFrom prefers the registry row matching the exported view_name', () => {
  const rows = [
    { chart_template_id: 'dom_price_change_active', view_name: 'cm_dialysis_dom_price_change_active_m', display_from: '2016-10-31' },
    { chart_template_id: 'dom_price_change_active', view_name: 'cm_dialysis_dom_price_change_active_q', display_from: '2016-12-31' },
  ];
  assert.equal(resolveDisplayFrom(rows, 'dom_price_change_active', 'cm_dialysis_dom_price_change_active_m'), '2016-10-31');
  assert.equal(resolveDisplayFrom(rows, 'dom_price_change_active', 'cm_dialysis_dom_price_change_active_q'), '2016-12-31');
});

test('resolveDisplayFrom falls back to any row when the view_name does not match, and returns null when absent', () => {
  const rows = [{ chart_template_id: 'market_turnover', view_name: 'cm_dialysis_market_turnover_m', display_from: '2016-10-31' }];
  assert.equal(resolveDisplayFrom(rows, 'market_turnover', 'some_other_view'), '2016-10-31');
  assert.equal(resolveDisplayFrom(rows, 'not_registered', 'x'), null);
  assert.equal(resolveDisplayFrom([], 'market_turnover', 'x'), null);
});

test('cropRowsToDisplayFrom accepts a resolved date string (the production path)', () => {
  const rows = [{ period_end: '2015-06-30' }, { period_end: '2017-06-30' }];
  const tmpl = { chart_template_id: 'market_turnover', data_shape: 'monthly_ttm' };
  assert.deepEqual(
    cropRowsToDisplayFrom(rows, tmpl, '2016-10-31').map((r) => r.period_end),
    ['2017-06-30']
  );
});

test('cropRowsToDisplayFrom drops period_end rows before display_from', () => {
  const rows = [
    { period_end: '2003-03-31', v: 1 },
    { period_end: '2007-03-31', v: 2 },
    { period_end: '2020-12-31', v: 3 },
  ];
  const tmpl = { chart_template_id: 'volume_ttm_by_quarter', data_shape: 'time_series_quarterly' };
  const out = cropRowsToDisplayFrom(rows, tmpl, { volume_ttm_by_quarter: '2007-03-31' });
  assert.deepEqual(out.map((r) => r.period_end), ['2007-03-31', '2020-12-31']);
});

test('cropRowsToDisplayFrom is a no-op without a registered display_from', () => {
  const rows = [{ period_end: '2001-03-31' }, { period_end: '2020-12-31' }];
  const tmpl = { chart_template_id: 'volume_ttm_by_quarter', data_shape: 'time_series_quarterly' };
  assert.equal(cropRowsToDisplayFrom(rows, tmpl, {}).length, 2);
  assert.equal(cropRowsToDisplayFrom(rows, tmpl, null).length, 2);
});

test('cropRowsToDisplayFrom skips year-axis (non period_end) shapes', () => {
  const rows = [{ year: 2001 }, { year: 2020 }];
  const tmpl = { chart_template_id: 'buyer_class_pct_by_year', data_shape: 'time_series_yearly' };
  assert.equal(cropRowsToDisplayFrom(rows, tmpl, { buyer_class_pct_by_year: '2007-03-31' }).length, 2);
});

test('buildCapitalMarketsWorkbook flags schema drift when a template column is absent from the view rows', () => {
  // seller_sentiment template expects n_all / n_long_term; a view row that
  // omits n_long_term entirely is drift (not thin data).
  const charts = [{
    chart_template_id: 'seller_sentiment',
    name: 'Seller Sentiment',
    chart_type: 'combo',
    data_shape: 'time_series_quarterly_combo',
    view_name: 'cm_dialysis_seller_sentiment_m',
    vertical: 'dialysis',
    rows: [{ period_end: '2025-12-31', subspecialty: 'all', n_all: 12, pct_price_change_all: 0.1 }],
  }];
  const wb = buildCapitalMarketsWorkbook({
    vertical: 'dialysis', subspecialty: 'all', asOf: '2025-12-31', charts, brand: null,
  });
  assert.ok(Array.isArray(wb.driftWarnings));
  assert.ok(
    wb.driftWarnings.some((m) => m.includes('n_long_term')),
    `expected a drift warning naming n_long_term, got: ${JSON.stringify(wb.driftWarnings)}`
  );
});

test('buildCapitalMarketsWorkbook: no drift warning when every template column is present (nulls are OK)', () => {
  const charts = [{
    chart_template_id: 'seller_sentiment',
    name: 'Seller Sentiment',
    chart_type: 'combo',
    data_shape: 'time_series_quarterly_combo',
    view_name: 'cm_dialysis_seller_sentiment_m',
    vertical: 'dialysis',
    // All keys present; some null — that is thin data, not drift.
    rows: [{
      period_end: '2025-12-31', subspecialty: 'all', n_all: 12, n_long_term: null,
      pct_price_change_all: 0.1, pct_price_change_long_term: null,
      last_ask_cap_all: 0.07, last_ask_cap_long_term: null,
    }],
  }];
  const wb = buildCapitalMarketsWorkbook({
    vertical: 'dialysis', subspecialty: 'all', asOf: '2025-12-31', charts, brand: null,
  });
  assert.equal((wb.driftWarnings || []).length, 0);
});

test('Data_DOM_Ask column headers state the % of Original List basis (audit item E)', () => {
  const charts = [{
    chart_template_id: 'dom_and_pct_of_ask',
    name: 'DOM & % of Ask',
    chart_type: 'combo',
    data_shape: 'time_series_quarterly',
    view_name: 'cm_dialysis_dom_pct_ask_m',
    vertical: 'dialysis',
    rows: [{ period_end: '2025-12-31', subspecialty: 'all', avg_dom: 200, median_dom: 150, pct_of_ask: 0.9, median_pct_of_ask: 0.92 }],
  }];
  const wb = buildCapitalMarketsWorkbook({
    vertical: 'dialysis', subspecialty: 'all', asOf: '2025-12-31', charts, brand: null,
  });
  const sheet = wb.getWorksheet('Data_DOM_Ask');
  assert.ok(sheet, 'Data_DOM_Ask sheet exists');
  const headerVals = [];
  sheet.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === 'string') headerVals.push(cell.value); }));
  assert.ok(headerVals.includes('% of Original List'), `headers: ${headerVals.join(' | ')}`);
  assert.ok(!headerVals.includes('% of Ask Price'), 'stale "% of Ask Price" header must be gone');
});
