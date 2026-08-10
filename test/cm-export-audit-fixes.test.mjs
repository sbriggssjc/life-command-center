// CM Export Audit fixes (2026-08-07) — exporter-side unit tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapitalMarketsWorkbook } from '../api/_shared/cm-excel-export.js';
import { cropRowsToDisplayFrom, resolveDisplayFrom, buildAnnualBuyerShare } from '../api/capital-markets.js';

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

// Q1 as-of regeneration residual #1B — annual buyer-pool YTD roll-up.
const BUYER_Q = [
  { period_end: '2025-09-30', subspecialty: 'all', private_volume: 120, reit_volume: 20, cross_border_volume: 0, institutional_volume: 7 },
  { period_end: '2025-12-31', subspecialty: 'all', private_volume: 290, reit_volume: 6,  cross_border_volume: 0, institutional_volume: 21 },
  { period_end: '2026-03-31', subspecialty: 'all', private_volume: 150, reit_volume: 25, cross_border_volume: 0, institutional_volume: 0 },
  { period_end: '2026-06-30', subspecialty: 'all', private_volume: 122, reit_volume: 13, cross_border_volume: 0, institutional_volume: 3 },
];

test('buildAnnualBuyerShare sums ONLY quarters <= as_of into the current-year bar', () => {
  const out = buildAnnualBuyerShare(BUYER_Q, '2026-03-31');
  const y2026 = out.find((r) => r.year_num === 2026);
  // Q1 only — Q2 (2026-06-30) is dropped by the as-of clamp.
  assert.equal(y2026.private_volume, 150);
  assert.equal(y2026.reit_volume, 25);
  assert.equal(y2026.institutional_volume, 0);
  assert.equal(Math.round(y2026.private_pct * 1000) / 1000, 0.857); // 150/175
});

test('buildAnnualBuyerShare labels a partial current year "<year> YTD"', () => {
  const out = buildAnnualBuyerShare(BUYER_Q, '2026-03-31');
  const y2026 = out.find((r) => r.year_num === 2026);
  assert.equal(y2026.year, '2026 YTD');
  assert.equal(y2026.ytd, true);
  assert.equal(y2026.ytd_through, '2026-03-31');
  // A complete (year-end) prior year keeps its plain numeric label.
  const y2025 = out.find((r) => r.year_num === 2025);
  assert.equal(y2025.year, 2025);
  assert.equal(y2025.ytd, false);
});

test('buildAnnualBuyerShare treats a Q4/Dec as_of as a complete (non-YTD) year', () => {
  const out = buildAnnualBuyerShare(BUYER_Q, '2025-12-31');
  const y2025 = out.find((r) => r.year_num === 2025);
  assert.equal(y2025.year, 2025);        // not "2025 YTD"
  assert.equal(y2025.ytd, false);
  assert.equal(y2025.private_volume, 410); // both 2025 quarters summed
  assert.equal(out.some((r) => r.year_num === 2026), false); // 2026 dropped
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
      pct_price_change_long_term_8q: 0.5, last_ask_cap_long_term_8q: 0.06,
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

// ---------------------------------------------------------------------------
// 2026-08-07 follow-up — dual-builder root-cause fixes (Sentiment/Bid-Ask/
// Returns full columns via wrapper views), display_from re-crop after the
// master_m override, dead-column prune, Ask-Cap n basis label, provenance stamp.
// ---------------------------------------------------------------------------

const headersOf = (wb, tab) => {
  const sheet = wb.getWorksheet(tab);
  if (!sheet) return null;
  const out = [];
  sheet.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === 'string') out.push(cell.value); }));
  return out;
};

test('Data_Bid_Ask emits Low/High/Achieved when the wrapper rows carry min/max/achieved (item 1)', () => {
  const charts = [{
    chart_template_id: 'bid_ask_spread', name: 'Bid-Ask', chart_type: 'combo',
    data_shape: 'time_series_quarterly', view_name: 'cm_dialysis_bid_ask_spread_m', vertical: 'dialysis',
    rows: [{ period_end: '2025-12-31', subspecialty: 'all', avg_bid_ask_spread: 0.002,
      avg_last_ask_cap: 0.07, pct_price_change: 0.3,
      min_last_ask_cap: 0.06, max_last_ask_cap: 0.085, achieved_last_ask_cap: 0.071 }],
  }];
  const wb = buildCapitalMarketsWorkbook({ vertical: 'dialysis', subspecialty: 'all', asOf: '2025-12-31', charts, brand: null });
  assert.equal((wb.driftWarnings || []).filter((m) => /min_last_ask_cap|max_last_ask_cap|achieved_last_ask_cap/.test(m)).length, 0);
  const h = headersOf(wb, 'Data_Bid_Ask');
  // CM close-out (bid-ask, native hi-low): the native chart plots an Achieved Cap
  // line, so the "Achieved Cap (TTM)" helper column (= Last-Ask + Spread) is added
  // back, alongside the Low/High range columns.
  for (const label of ['Last Ask — Low (TTM)', 'Last Ask — High (TTM)', 'Achieved Cap (TTM)']) {
    assert.ok(h.includes(label), `missing ${label}; got ${h.join(' | ')}`);
  }
});

test('Data_Returns_Idx emits Leveraged High/Low when the extended wrapper rows carry them (item 1)', () => {
  const charts = [{
    chart_template_id: 'cash_leveraged_returns', name: 'Returns', chart_type: 'line',
    data_shape: 'time_series_quarterly', view_name: 'cm_dialysis_returns_indexes_m', vertical: 'dialysis',
    rows: [{ period_end: '2025-12-31', cash_return: 0.07, leveraged_return_mid: 0.064,
      leveraged_return_low: 0.062, leveraged_return_high: 0.066 }],
  }];
  const wb = buildCapitalMarketsWorkbook({ vertical: 'dialysis', subspecialty: 'all', asOf: '2025-12-31', charts, brand: null });
  assert.equal((wb.driftWarnings || []).filter((m) => /leveraged_return_(low|high)/.test(m)).length, 0);
});

test('Rent_Price_PSF N columns coalesce dia rent_n/price_n via fieldKeys (item 3 map-from-view)', () => {
  const charts = [{
    chart_template_id: 'rent_and_price_psf', name: 'Rent/Price PSF', chart_type: 'combo',
    data_shape: 'time_series_quarterly', view_name: 'cm_dialysis_rent_price_psf_q', vertical: 'dialysis',
    rows: [{ period_end: '2025-12-31', subspecialty: 'all', rent_psf: 30, price_psf: 400, rent_n: 12, price_n: 9 }],
  }];
  const wb = buildCapitalMarketsWorkbook({ vertical: 'dialysis', subspecialty: 'all', asOf: '2025-12-31', charts, brand: null });
  // No drift: rent_n/price_n satisfy the fieldKeys, so the columns are not "absent".
  assert.equal((wb.driftWarnings || []).filter((m) => /n_with_(rent|price)_ttm/.test(m)).length, 0);
  const sheet = wb.getWorksheet('Data_Rent_Price_PSF');
  const nums = [];
  sheet.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === 'number') nums.push(cell.value); }));
  assert.ok(nums.includes(12) && nums.includes(9), `expected rent_n=12/price_n=9 in cells; got ${nums.join(',')}`);
});

test('valuation_index drops Expenses/NOI PSF for dia (empty) but keeps them for gov (populated) — item 3', () => {
  const mk = (vertical, extra) => ({
    chart_template_id: 'valuation_index', name: 'Val Index', chart_type: 'line',
    data_shape: 'time_series_monthly', view_name: `cm_${vertical}_valuation_index_m`, vertical,
    rows: [{ period_end: '2025-12-31', subspecialty: 'all', avg_rent_psf: 30,
      avg_cap_rate: 0.07, valuation_index: 420, n_sales: 5, ...extra }],
  });
  // dia rows omit avg_expenses_psf/avg_noi_psf entirely (view lacks them) → pruned.
  const diaWb = buildCapitalMarketsWorkbook({ vertical: 'dialysis', subspecialty: 'all', asOf: '2025-12-31', charts: [mk('dialysis', {})], brand: null });
  const diaH = headersOf(diaWb, 'Data_Val_Index');
  assert.ok(!diaH.includes('Expenses PSF (TTM)'), `dia should not ship Expenses PSF; got ${diaH.join(' | ')}`);
  assert.ok(!diaH.includes('NOI PSF (TTM)'), 'dia should not ship NOI PSF');
  // gov rows carry populated values → kept.
  const govWb = buildCapitalMarketsWorkbook({ vertical: 'gov', subspecialty: 'all', asOf: '2025-12-31', charts: [mk('gov', { avg_expenses_psf: 8, avg_noi_psf: 22 })], brand: null });
  const govH = headersOf(govWb, 'Data_Val_Index');
  assert.ok(govH.includes('Expenses PSF (TTM)') && govH.includes('NOI PSF (TTM)'), `gov should keep Expenses/NOI PSF; got ${govH.join(' | ')}`);
});

test('Data_Ask_Cap_by_Term n headers state the 24-mo distinct basis (item 4)', () => {
  const charts = [{
    chart_template_id: 'asking_cap_by_term_dot_plot', name: 'Ask Cap by Term', chart_type: 'line',
    data_shape: 'time_series_monthly', view_name: 'cm_dialysis_asking_cap_by_term_m', vertical: 'dialysis',
    rows: [{ period_end: '2025-12-31', subspecialty: 'all', cap_12plus: 0.07, cap_12plus_n: 40,
      cap_8to12: 0.075, cap_8to12_n: 30, cap_6to8: 0.08, cap_6to8_n: 20, cap_5orless: 0.09, cap_5orless_n: 10 }],
  }];
  const wb = buildCapitalMarketsWorkbook({ vertical: 'dialysis', subspecialty: 'all', asOf: '2025-12-31', charts, brand: null });
  const h = headersOf(wb, 'Data_Ask_Cap_by_Term');
  assert.ok(h.some((x) => /24-mo distinct/.test(x)), `expected a 24-mo distinct n header; got ${h.join(' | ')}`);
  assert.ok(!h.includes('12+ n'), 'bare "12+ n" header must be relabeled');
});

test('Cover sheet carries the build-provenance stamp (item 5)', () => {
  const wb = buildCapitalMarketsWorkbook({
    vertical: 'dialysis', subspecialty: 'all', asOf: '2025-12-31', charts: [], brand: null,
    provenance: { gitSha: 'abc123def456', generatedAt: '2026-08-07T12:00:00.000Z', builder: 'test-builder' },
  });
  const cover = wb.getWorksheet('Cover');
  const b7 = cover.getCell('B7').value;
  assert.ok(/abc123def456/.test(b7) && /2026-08-07T12:00:00/.test(b7) && /test-builder/.test(b7), `B7 stamp: ${b7}`);
});

// CM packet-export parity interim guard (2026-08-09) — the packet build must
// carry a loud PREVIEW watermark on the Cover so it can't be mistaken for the
// marketing deliverable until it reaches full standard coverage; the standard
// export (no flag) must NOT carry it.
test('previewWatermark renders a Cover banner only when requested', () => {
  const base = {
    vertical: 'gov', subspecialty: 'all', asOf: '2026-06-30',
    charts: [], brand: null, masterRows: null, chartImages: [], provenance: {}, commentary: [],
  };
  const withWm = buildCapitalMarketsWorkbook({ ...base, previewWatermark: true });
  const b1 = withWm.getWorksheet('Cover').getCell('B1');
  assert.match(String(b1.value), /PREVIEW — NOT FOR MARKETING/);
  assert.equal(b1.fill?.fgColor?.argb, 'FFC00000');

  const noWm = buildCapitalMarketsWorkbook({ ...base });
  assert.equal(noWm.getWorksheet('Cover').getCell('B1').value, null);
});
