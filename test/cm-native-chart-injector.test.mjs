// ============================================================================
// Capital Markets — Native chart injection scaffold smoke test
//
// End-to-end test: build a tiny ExcelJS workbook with sample data, inject a
// native line chart via the injector, then verify the resulting buffer:
//   (a) Round-trips through JSZip cleanly
//   (b) Contains xl/charts/chart1.xml
//   (c) Contains xl/drawings/drawing1.xml
//   (d) The Data_* tab references the drawing
//   (e) [Content_Types].xml has the chart + drawing override entries
//
// Run: node --test test/cm-native-chart-injector.test.mjs
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import {
  injectNativeCharts,
  NATIVE_CHART_TEMPLATES,
  buildInjectionSpec,
} from '../api/_shared/cm-native-chart-injector.js';

async function buildTinyWorkbook() {
  const wb = new ExcelJS.Workbook();
  // Index tab (mirrors real export structure where Index is first)
  const idx = wb.addWorksheet('Index');
  idx.getCell('A1').value = 'Test export';

  // Data_Volume_TTM tab — our target for the chart injection
  const sheet = wb.addWorksheet('Data_Volume_TTM');
  // Header at row 4 (typical no-image layout). Row 5+ = data.
  sheet.getCell('A4').value = 'Period End';
  sheet.getCell('B4').value = 'TTM Volume';
  // Header row for chart series labeling
  sheet.getCell('B5').value = 'TTM Volume';
  for (let i = 0; i < 12; i++) {
    sheet.getCell(`A${6 + i}`).value = new Date(2025, i, 31);
    sheet.getCell(`B${6 + i}`).value = 100_000_000 * (1 + i / 24);
  }
  return await wb.xlsx.writeBuffer();
}

test('injectNativeCharts: line chart on Data_Volume_TTM tab', async () => {
  const base = await buildTinyWorkbook();
  const injections = [
    {
      tabName: 'Data_Volume_TTM',
      spec: {
        type: 'line',
        tabName: 'Data_Volume_TTM',
        titleCol: 'B', titleRow: 5,
        catCol: 'A', valCol: 'B',
        dataStart: 6, dataEnd: 17,
        color: '003DA5',
        anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
      },
    },
  ];

  const result = await injectNativeCharts(base, injections);
  assert.ok(Buffer.isBuffer(result), 'returns a Buffer');
  assert.ok(result.length > 0, 'buffer is non-empty');

  // Round-trip through JSZip
  const zip = await JSZip.loadAsync(result);

  // Assert chart XML present
  assert.ok(zip.file('xl/charts/chart1.xml'), 'xl/charts/chart1.xml created');
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chartXml, /<c:lineChart>/, 'chart is a lineChart');
  assert.match(chartXml, /'Data_Volume_TTM'!\$A\$6:\$A\$17/, 'references catRange');
  assert.match(chartXml, /'Data_Volume_TTM'!\$B\$6:\$B\$17/, 'references valRange');

  // Assert drawing XML + its rels present
  assert.ok(zip.file('xl/drawings/drawing1.xml'), 'drawing1.xml created');
  const drawingXml = await zip.file('xl/drawings/drawing1.xml').async('string');
  assert.match(drawingXml, /<xdr:twoCellAnchor/, 'drawing has twoCellAnchor');

  const drawingRels = await zip.file('xl/drawings/_rels/drawing1.xml.rels').async('string');
  assert.match(drawingRels, /chart1\.xml/, 'drawing rels references chart1.xml');

  // Assert sheet xml has <drawing r:id="..."/> tag
  // (sheet2.xml because Index is sheet1)
  const sheetXml = await zip.file('xl/worksheets/sheet2.xml').async('string');
  assert.match(sheetXml, /<drawing\s+r:id="rId\d+"\s*\/>/, 'sheet2 has drawing tag');

  // Assert sheet's rels file references the drawing
  const sheetRels = await zip.file('xl/worksheets/_rels/sheet2.xml.rels').async('string');
  assert.match(sheetRels, /drawing1\.xml/, 'sheet2 rels references drawing1.xml');

  // Assert [Content_Types].xml has the overrides
  const ct = await zip.file('[Content_Types].xml').async('string');
  assert.match(ct, /\/xl\/charts\/chart1\.xml/, 'content-types lists chart1.xml');
  assert.match(ct, /\/xl\/drawings\/drawing1\.xml/, 'content-types lists drawing1.xml');
});

test('injectNativeCharts: returns original buffer when no injections', async () => {
  const base = await buildTinyWorkbook();
  const result = await injectNativeCharts(base, []);
  assert.equal(result, base, 'no-op returns the same buffer');
});

test('NATIVE_CHART_TEMPLATES: P3 simple-shape charts registered', () => {
  for (const id of [
    'volume_ttm_by_quarter',         // P2
    'cap_rate_ttm_by_quarter',       // P3
    'transaction_count_ttm',
    'avg_deal_size',
    'yoy_volume_change',
    'market_turnover',
    'quarterly_volume_bars',
  ]) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
});

test('NATIVE_CHART_TEMPLATES: P4 stacked-bar charts registered', () => {
  for (const id of [
    'lease_renewal_rate',         // 5-series stack
    'buyer_pool_monthly_count',   // 3-series stack
  ]) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
  // lease_termination_rate is DEFERRED — computed series not directly stored
  assert.ok(
    !NATIVE_CHART_TEMPLATES.has('lease_termination_rate'),
    'lease_termination_rate should remain on the PNG path (deferred)'
  );
});

test('NATIVE_CHART_TEMPLATES: P5 multi-line charts registered', () => {
  for (const id of [
    'cap_rate_by_lease_term',
    'nm_vs_market_cap',
    'sold_cap_by_term_dot_plot',
    'asking_cap_by_term_dot_plot',
  ]) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
  // net_lease_spread DEFERRED — renderer references cap_10plus_year which
  // isn't in the Data_NL_Spread tab.
  assert.ok(
    !NATIVE_CHART_TEMPLATES.has('net_lease_spread'),
    'net_lease_spread should remain on the PNG path (deferred — data-shape mismatch)'
  );
});

test('NATIVE_CHART_TEMPLATES: P6 combo dual-axis charts registered', () => {
  for (const id of [
    'dom_and_pct_of_ask',
    'dom_and_pct_of_ask_monthly',
    'case_for_renewal',
    'available_market_size_combo',
  ]) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
});

test('NATIVE_CHART_TEMPLATES: P7 scatter charts registered', () => {
  for (const id of [
    'core_cap_rate_dot_plot',
    'available_cap_rate_dot_plot',
  ]) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
});

test('NATIVE_CHART_TEMPLATES: P8 floating-bar / box-whisker charts registered', () => {
  for (const id of [
    'bid_ask_spread',
    'bid_ask_spread_monthly',
    'rent_psf_box_quarterly',
  ]) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
  // ppsf_box_quarterly DEFERRED — no CHART_COLUMNS schema
  assert.ok(
    !NATIVE_CHART_TEMPLATES.has('ppsf_box_quarterly'),
    'ppsf_box_quarterly should remain on the PNG path (deferred — no data schema)'
  );
  // rent_by_year_built DEFERRED — whisker+median+avg composite, needs
  // helper-column plumbing (IQR width = upper_q − lower_q).
  assert.ok(
    !NATIVE_CHART_TEMPLATES.has('rent_by_year_built'),
    'rent_by_year_built should remain on the PNG path (deferred — composite shape)'
  );
});

test('buildInjectionSpec: dispatches bar vs line correctly', () => {
  const baseCols = [
    { key: 'period_end',   col: 'A' },
    { key: 'subspecialty', col: 'B' },
    { key: 'avg_deal_size', col: 'C' },
  ];
  const brand = { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } };
  const args = (chart_template_id, cols) => ({
    chart_template_id, tabName: 'Data_Test',
    cols, dataStart: 5, dataEnd: 100, brand,
  });

  // bar
  const bar = buildInjectionSpec(args('avg_deal_size', baseCols));
  assert.equal(bar.spec.type, 'bar');
  assert.equal(bar.spec.catCol, 'A');
  assert.equal(bar.spec.valCol, 'C');

  // line — cap_rate_ttm_by_quarter expects ttm_weighted_cap_rate column
  const lineCols = [
    { key: 'period_end',             col: 'A' },
    { key: 'subspecialty',           col: 'B' },
    { key: 'ttm_weighted_cap_rate',  col: 'C' },
  ];
  const line = buildInjectionSpec(args('cap_rate_ttm_by_quarter', lineCols));
  assert.equal(line.spec.type, 'line');
  assert.equal(line.spec.valCol, 'C');

  // unknown template returns null
  const unknown = buildInjectionSpec(args('not_a_real_template', baseCols));
  assert.equal(unknown, null);
});

test('buildInjectionSpec: lease_renewal_rate builds 5-series stacked-bar', () => {
  const cols = [
    { key: 'period_end',                       col: 'A' },
    { key: 'first_generation_commencements',   col: 'B' },
    { key: 'renewed_leases',                   col: 'C' },
    { key: 'succeeding_superseding_leases',    col: 'D' },
    { key: 'expired_leases',                   col: 'E' },
    { key: 'terminated_leases',                col: 'F' },
  ];
  const brand = { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } };
  const out = buildInjectionSpec({
    chart_template_id: 'lease_renewal_rate',
    tabName: 'Data_Lease_Renewal',
    cols, dataStart: 5, dataEnd: 100, brand,
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'stacked-bar');
  assert.equal(out.spec.catCol, 'A', 'period_end is the x-axis');
  assert.equal(out.spec.series.length, 5, '5 series stacked');
  // Verify color order matches PDF renderer
  assert.deepEqual(
    out.spec.series.map(s => s.color),
    ['E0E8F4', '003DA5', '265AB2', '62B5E5', 'D97706'],
    'series colors: pale / navy / mid / sky / amber'
  );
  // Verify each series points at its own column
  assert.deepEqual(
    out.spec.series.map(s => s.valCol),
    ['B', 'C', 'D', 'E', 'F'],
  );
});

test('buildInjectionSpec: buyer_pool_monthly_count builds 3-series stacked-bar', () => {
  const cols = [
    { key: 'period_end',           col: 'A' },
    { key: 'private_count',        col: 'B' },
    { key: 'institutional_count',  col: 'C' },
    { key: 'reit_count',           col: 'D' },
    { key: 'cross_border_count',   col: 'E' },  // present but NOT charted
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'buyer_pool_monthly_count',
    tabName: 'Data_Buyer_Pool',
    cols, dataStart: 5, dataEnd: 100,
    brand: { palette: {} },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'stacked-bar');
  assert.equal(out.spec.series.length, 3, '3 series — Cross-Border excluded');
  assert.deepEqual(
    out.spec.series.map(s => s.valCol),
    ['B', 'C', 'D'],
    'Cross-Border (column E) should NOT be charted'
  );
  assert.deepEqual(
    out.spec.series.map(s => s.color),
    ['003DA5', '62B5E5', '4CB582'],
    'colors: navy (Private) / sky (Institutional) / sage (REIT)'
  );
});

test('buildInjectionSpec: nm_vs_market_cap builds 2-series multi-line', () => {
  const cols = [
    { key: 'period_end',      col: 'A' },
    { key: 'subspecialty',    col: 'B' },
    { key: 'nm_cap_rate',     col: 'C' },
    { key: 'market_cap_rate', col: 'D' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'nm_vs_market_cap',
    tabName: 'Data_NM_vs_Market',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'multi-line');
  assert.equal(out.spec.catCol, 'A');
  assert.equal(out.spec.series.length, 2);
  assert.deepEqual(
    out.spec.series.map(s => s.valCol),
    ['C', 'D'],
    'series point at nm_cap_rate and market_cap_rate columns'
  );
  assert.deepEqual(
    out.spec.series.map(s => s.color),
    ['003DA5', '62B5E5'],
    'NM navy first, Market sky second'
  );
});

test('buildInjectionSpec: cap_rate_by_lease_term — dia 4-cohort detection', () => {
  // Both cohort schemes present in cols (matches the actual data tab).
  const cols = [
    { key: 'period_end',       col: 'A' },
    { key: 'subspecialty',     col: 'B' },
    { key: 'cap_10plus',       col: 'C' },
    { key: 'cap_6to10',        col: 'D' },
    { key: 'cap_less5',        col: 'E' },
    { key: 'cap_outside_firm', col: 'F' },
    { key: 'cap_12plus',       col: 'G' },
    { key: 'cap_8to12',        col: 'H' },
    { key: 'cap_6to8',         col: 'I' },
    { key: 'cap_5orless',      col: 'J' },
  ];
  // Dialysis-shaped data row → picks the 12+/8-12/6-8/≤5 branch
  const out = buildInjectionSpec({
    chart_template_id: 'cap_rate_by_lease_term',
    tabName: 'Data_Cap_by_Term',
    cols, dataStart: 5, dataEnd: 50,
    brand: { palette: {} },
    rows: [{ cap_12plus: 0.062, cap_8to12: 0.065, cap_6to8: 0.069, cap_5orless: 0.075 }],
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'multi-line');
  assert.equal(out.spec.series.length, 4, '4 dialysis cohorts');
  assert.deepEqual(
    out.spec.series.map(s => s.valCol),
    ['G', 'H', 'I', 'J'],
    'series point at dia cohort columns (cap_12plus..cap_5orless)'
  );
  assert.deepEqual(
    out.spec.series.map(s => s.color),
    ['7E6BAD', '4CB582', '62B5E5', '003DA5'],
    'colors: purple / sage / sky / navy'
  );
  // No dashed lines on the dia branch
  assert.ok(out.spec.series.every(s => !s.dashed), 'no dashed series on dia');
});

test('buildInjectionSpec: cap_rate_by_lease_term — gov 4-cohort with dashed Outside', () => {
  const cols = [
    { key: 'period_end',       col: 'A' },
    { key: 'subspecialty',     col: 'B' },
    { key: 'cap_10plus',       col: 'C' },
    { key: 'cap_6to10',        col: 'D' },
    { key: 'cap_less5',        col: 'E' },
    { key: 'cap_outside_firm', col: 'F' },
    { key: 'cap_12plus',       col: 'G' },
    { key: 'cap_8to12',        col: 'H' },
    { key: 'cap_6to8',         col: 'I' },
    { key: 'cap_5orless',      col: 'J' },
  ];
  // Gov-shaped data row → picks the 10+/6-10/<5/Outside branch
  const out = buildInjectionSpec({
    chart_template_id: 'cap_rate_by_lease_term',
    tabName: 'Data_Cap_by_Term',
    cols, dataStart: 5, dataEnd: 50,
    brand: { palette: {} },
    rows: [{ cap_10plus: 0.062, cap_6to10: 0.068, cap_less5: 0.075, cap_outside_firm: 0.085 }],
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.series.length, 4, '4 gov cohorts');
  assert.deepEqual(
    out.spec.series.map(s => s.valCol),
    ['C', 'D', 'E', 'F'],
    'series point at gov cohort columns'
  );
  assert.deepEqual(
    out.spec.series.map(s => s.color),
    ['7E6BAD', '4CB582', '003DA5', '6A748C'],
    'colors: purple / sage / navy / gray'
  );
  // Outside Firm (last series, gray) is dashed
  assert.equal(out.spec.series[3].dashed, true, 'Outside Firm series is dashed');
  assert.ok(out.spec.series.slice(0, 3).every(s => !s.dashed), 'first 3 series solid');
});

test('buildInjectionSpec: sold_cap_by_term_dot_plot — gov uses cap_5to10 (not cap_6to10)', () => {
  // sold_cap_by_term's gov cohort uses cap_5to10 (different from cap_rate_by_lease_term).
  const cols = [
    { key: 'period_end',       col: 'A' },
    { key: 'subspecialty',     col: 'B' },
    { key: 'cap_12plus',       col: 'C' },
    { key: 'cap_8to12',        col: 'D' },
    { key: 'cap_6to8',         col: 'E' },
    { key: 'cap_5orless',      col: 'F' },
    { key: 'cap_10plus',       col: 'G' },
    { key: 'cap_5to10',        col: 'H' },  // ← different key name vs cap_rate_by_lease_term
    { key: 'cap_less5',        col: 'I' },
    { key: 'cap_outside_firm', col: 'J' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'sold_cap_by_term_dot_plot',
    tabName: 'Data_Sold_Cap_by_Term',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: {} },
    rows: [{ cap_10plus: 0.06, cap_5to10: 0.07, cap_less5: 0.08, cap_outside_firm: 0.09 }],
  });
  assert.ok(out, 'should produce a spec');
  assert.deepEqual(
    out.spec.series.map(s => s.valCol),
    ['G', 'H', 'I', 'J'],
    'series point at gov cohort columns including cap_5to10'
  );
});

test('buildInjectionSpec: dom_and_pct_of_ask builds 1-bar + 1-line combo', () => {
  // Real-world dia DOM tab column shape (Data_DOM_Ask)
  const cols = [
    { key: 'period_end',        col: 'A' },
    { key: 'subspecialty',      col: 'B' },
    { key: 'avg_dom',           col: 'C' },
    { key: 'median_dom',        col: 'D' },
    { key: 'pct_of_ask',        col: 'E' },
    { key: 'median_pct_of_ask', col: 'F' },
  ];
  const brand = { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } };
  const out = buildInjectionSpec({
    chart_template_id: 'dom_and_pct_of_ask',
    tabName: 'Data_DOM_Ask',
    cols, dataStart: 5, dataEnd: 60, brand,
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.catCol, 'A');
  assert.equal(out.spec.barSeries.length, 1, 'one bar series');
  assert.equal(out.spec.lineSeries.length, 1, 'one line series');
  assert.equal(out.spec.barSeries[0].valCol, 'C', 'bar = avg_dom');
  assert.equal(out.spec.lineSeries[0].valCol, 'E', 'line = pct_of_ask');
  assert.equal(out.spec.barSeries[0].color, '62B5E5', 'bar sky');
  assert.equal(out.spec.lineSeries[0].color, '003DA5', 'line navy');
});

test('buildInjectionSpec: dom_and_pct_of_ask_monthly uses same combo shape', () => {
  const cols = [
    { key: 'period_end',   col: 'A' },
    { key: 'subspecialty', col: 'B' },
    { key: 'n_sales',      col: 'C' },
    { key: 'avg_dom',      col: 'D' },
    { key: 'pct_of_ask',   col: 'E' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'dom_and_pct_of_ask_monthly',
    tabName: 'Data_DOM_Ask_Monthly',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: {} },
  });
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.barSeries[0].valCol, 'D', 'bar = avg_dom (col D in monthly)');
  assert.equal(out.spec.lineSeries[0].valCol, 'E', 'line = pct_of_ask');
});

test('buildInjectionSpec: case_for_renewal uses year as x-axis', () => {
  const cols = [
    { key: 'year',                col: 'A' },
    { key: 'commencement_count',  col: 'B' },
    { key: 'avg_rent_per_sf',     col: 'C' },
    { key: 'total_lsf',           col: 'D' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'case_for_renewal',
    tabName: 'Data_Case_For_Renewal',
    cols, dataStart: 5, dataEnd: 30,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.catCol, 'A', 'x-axis is year (col A) not period_end');
  assert.equal(out.spec.barSeries[0].valCol, 'B', 'bar = commencement_count');
  assert.equal(out.spec.lineSeries[0].valCol, 'C', 'line = avg_rent_per_sf');
});

test('buildInjectionSpec: available_market_size_combo builds 2-bar + 2-line combo', () => {
  const cols = [
    { key: 'period_end',           col: 'A' },
    { key: 'subspecialty',         col: 'B' },
    { key: 'count_total',          col: 'C' },
    { key: 'count_core_10plus',    col: 'D' },
    { key: 'avg_cap_total',        col: 'E' },
    { key: 'avg_cap_core_10plus',  col: 'F' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'available_market_size_combo',
    tabName: 'Data_Available_Market',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.barSeries.length, 2, '2 bar series');
  assert.equal(out.spec.lineSeries.length, 2, '2 line series');
  assert.deepEqual(
    out.spec.barSeries.map(s => s.valCol),
    ['C', 'D'],
    'bars: count_total, count_core_10plus'
  );
  assert.deepEqual(
    out.spec.lineSeries.map(s => s.valCol),
    ['E', 'F'],
    'lines: avg_cap_total, avg_cap_core_10plus'
  );
  assert.deepEqual(
    out.spec.barSeries.map(s => s.color),
    ['62B5E5', '4CB582'],
    'bar colors: sky / sage'
  );
  assert.deepEqual(
    out.spec.lineSeries.map(s => s.color),
    ['003DA5', 'D97706'],
    'line colors: navy / amber'
  );
});

test('buildInjectionSpec: core_cap_rate_dot_plot — time-based scatter (x=period_end, y=cap_rate)', () => {
  const cols = [
    { key: 'period_end',      col: 'A' },
    { key: 'cap_rate',        col: 'B' },
    { key: 'firm_term_years', col: 'C' },
    { key: 'is_northmarq',    col: 'D' },
    { key: 'sold_price',      col: 'E' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'core_cap_rate_dot_plot',
    tabName: 'Data_Core_Cap_Dot',
    cols, dataStart: 5, dataEnd: 500,
    brand: { palette: { nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'scatter');
  assert.equal(out.spec.series.length, 1, 'single dot series (trendline deferred)');
  assert.equal(out.spec.series[0].xCol, 'A', 'x = period_end (sale date)');
  assert.equal(out.spec.series[0].yCol, 'B', 'y = cap_rate');
  assert.equal(out.spec.series[0].color, '62B5E5', 'sky color');
});

test('buildInjectionSpec: available_cap_rate_dot_plot — term-based scatter (x=firm_term_years, y=cap_rate)', () => {
  const cols = [
    { key: 'period_end',      col: 'A' },
    { key: 'cap_rate',        col: 'B' },
    { key: 'firm_term_years', col: 'C' },
    { key: 'is_northmarq',    col: 'D' },
    { key: 'last_price',      col: 'E' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'available_cap_rate_dot_plot',
    tabName: 'Data_Avail_Cap_Dot',
    cols, dataStart: 5, dataEnd: 200,
    brand: { palette: { nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'scatter');
  assert.equal(out.spec.series[0].xCol, 'C', 'x = firm_term_years (continuous)');
  assert.equal(out.spec.series[0].yCol, 'B', 'y = cap_rate');
});

test('buildInjectionSpec: bid_ask_spread (quarterly) falls back to single line', () => {
  // Quarterly tab has no avg_last_ask_cap → renderer uses single-line.
  const cols = [
    { key: 'period_end',         col: 'A' },
    { key: 'subspecialty',       col: 'B' },
    { key: 'avg_bid_ask_spread', col: 'C' },
    { key: 'pct_price_change',   col: 'D' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'bid_ask_spread',
    tabName: 'Data_Bid_Ask',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'line');
  assert.equal(out.spec.catCol, 'A');
  assert.equal(out.spec.valCol, 'C', 'line = avg_bid_ask_spread');
});

test('buildInjectionSpec: bid_ask_spread_monthly builds floating-bar via invisible-base stack', () => {
  const cols = [
    { key: 'period_end',         col: 'A' },
    { key: 'subspecialty',       col: 'B' },
    { key: 'n_with_spread',      col: 'C' },
    { key: 'avg_bid_ask_spread', col: 'D' },
    { key: 'pct_price_change',   col: 'E' },
    { key: 'avg_last_ask_cap',   col: 'F' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'bid_ask_spread_monthly',
    tabName: 'Data_Bid_Ask_Monthly',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'stacked-bar');
  assert.equal(out.spec.series.length, 2, 'invisible base + visible band');
  // Series 0 = invisible base (last_ask = col F)
  assert.equal(out.spec.series[0].valCol, 'F', 'base series = avg_last_ask_cap');
  assert.equal(out.spec.series[0].noFill, true, 'base series is invisible');
  // Series 1 = visible spread band (col D)
  assert.equal(out.spec.series[1].valCol, 'D', 'top series = avg_bid_ask_spread');
  assert.equal(out.spec.series[1].color, '62B5E5', 'visible band is sky');
  assert.ok(!out.spec.series[1].noFill, 'top series visible');
});

test('buildInjectionSpec: rent_psf_box_quarterly builds 3-line quartile band', () => {
  const cols = [
    { key: 'period_end',          col: 'A' },
    { key: 'subspecialty',        col: 'B' },
    { key: 'n_leases',            col: 'C' },
    { key: 'rent_min',            col: 'D' },
    { key: 'rent_lower_quartile', col: 'E' },
    { key: 'rent_median',         col: 'F' },
    { key: 'rent_upper_quartile', col: 'G' },
    { key: 'rent_max',            col: 'H' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'rent_psf_box_quarterly',
    tabName: 'Data_Rent_Box',
    cols, dataStart: 5, dataEnd: 40,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'multi-line');
  assert.equal(out.spec.series.length, 3, '3-line quartile chart');
  assert.deepEqual(
    out.spec.series.map(s => s.valCol),
    ['E', 'F', 'G'],
    'series: lower_q / median / upper_q'
  );
  assert.deepEqual(
    out.spec.series.map(s => s.color),
    ['62B5E5', '003DA5', '62B5E5'],
    'lower=sky, median=navy bold, upper=sky'
  );
});

test('injectNativeCharts: stacked-bar chart renders correct XML', async () => {
  // Build a tiny workbook with a Data_Lease_Renewal tab + 5 series columns
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Lease_Renewal');
  sheet.getCell('A4').value = 'Period';
  sheet.getCell('B4').value = 'First Gen';
  sheet.getCell('C4').value = 'Renewed';
  sheet.getCell('D4').value = 'Succ-Super';
  sheet.getCell('E4').value = 'Expired';
  sheet.getCell('F4').value = 'Terminated';
  sheet.getCell('B5').value = 'First Generation Commencements';
  sheet.getCell('C5').value = 'Renewed Leases';
  sheet.getCell('D5').value = 'Succeeding/Superseding Leases';
  sheet.getCell('E5').value = 'Expired Leases';
  sheet.getCell('F5').value = 'Terminated Leases';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${6 + i}`).value = new Date(2025, i, 28);
    sheet.getCell(`B${6 + i}`).value = 10 + i;
    sheet.getCell(`C${6 + i}`).value = 50 + i * 2;
    sheet.getCell(`D${6 + i}`).value = 20;
    sheet.getCell(`E${6 + i}`).value = 8;
    sheet.getCell(`F${6 + i}`).value = 4;
  }
  const base = await wb.xlsx.writeBuffer();

  const injections = [{
    tabName: 'Data_Lease_Renewal',
    spec: {
      type: 'stacked-bar',
      tabName: 'Data_Lease_Renewal',
      catCol: 'A',
      dataStart: 6, dataEnd: 11,
      series: [
        { titleCol: 'B', titleRow: 5, valCol: 'B', color: 'E0E8F4' },
        { titleCol: 'C', titleRow: 5, valCol: 'C', color: '003DA5' },
        { titleCol: 'D', titleRow: 5, valCol: 'D', color: '265AB2' },
        { titleCol: 'E', titleRow: 5, valCol: 'E', color: '62B5E5' },
        { titleCol: 'F', titleRow: 5, valCol: 'F', color: 'D97706' },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }];

  const result = await injectNativeCharts(base, injections);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  assert.match(chartXml, /<c:barChart>/, 'is a barChart');
  assert.match(chartXml, /<c:grouping val="stacked"\/>/, 'grouping=stacked');
  assert.match(chartXml, /<c:overlap val="100"\/>/, 'overlap=100 (fully stacked)');
  // 5 series → 5 <c:ser> blocks
  const serCount = (chartXml.match(/<c:ser>/g) || []).length;
  assert.equal(serCount, 5, '5 series in stacked bar');
  // All 5 colors present
  for (const color of ['E0E8F4', '003DA5', '265AB2', '62B5E5', 'D97706']) {
    assert.match(chartXml, new RegExp(`srgbClr val="${color}"`), `color ${color} present`);
  }
  // First and last series reference correct columns
  assert.match(chartXml, /'Data_Lease_Renewal'!\$B\$6:\$B\$11/, 'first series points at B6:B11');
  assert.match(chartXml, /'Data_Lease_Renewal'!\$F\$6:\$F\$11/, 'last series points at F6:F11');
  // Legend should be visible for stacked bar (multi-series)
  assert.match(chartXml, /<c:legend>/, 'has legend');
});

test('injectNativeCharts: multi-line cohort chart renders correct XML (gov dashed Outside)', async () => {
  // Build a tiny workbook with a Data_Cap_by_Term tab + gov cohort columns
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Cap_by_Term');
  sheet.getCell('A4').value = 'Quarter End';
  sheet.getCell('B4').value = 'Subspecialty';
  sheet.getCell('C4').value = '10+ Year Cap';
  sheet.getCell('D4').value = '6-10 Year Cap';
  sheet.getCell('E4').value = '< 5 Year Cap';
  sheet.getCell('F4').value = 'Outside Firm Cap';
  for (let i = 0; i < 8; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i, 28);
    sheet.getCell(`B${5 + i}`).value = 'Gov';
    sheet.getCell(`C${5 + i}`).value = 0.062 + i * 0.001;
    sheet.getCell(`D${5 + i}`).value = 0.068 + i * 0.001;
    sheet.getCell(`E${5 + i}`).value = 0.075 + i * 0.0015;
    sheet.getCell(`F${5 + i}`).value = 0.085 + i * 0.0008;
  }
  const base = await wb.xlsx.writeBuffer();

  const injections = [{
    tabName: 'Data_Cap_by_Term',
    spec: {
      type: 'multi-line',
      tabName: 'Data_Cap_by_Term',
      catCol: 'A',
      dataStart: 5, dataEnd: 12,
      series: [
        { titleCol: 'C', titleRow: 4, valCol: 'C', color: '7E6BAD' },                  // 10+
        { titleCol: 'D', titleRow: 4, valCol: 'D', color: '4CB582' },                  // 6-10
        { titleCol: 'E', titleRow: 4, valCol: 'E', color: '003DA5' },                  // <5
        { titleCol: 'F', titleRow: 4, valCol: 'F', color: '6A748C', dashed: true },   // Outside
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }];

  const result = await injectNativeCharts(base, injections);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  assert.match(chartXml, /<c:lineChart>/, 'is a lineChart');
  assert.match(chartXml, /<c:grouping val="standard"\/>/, 'grouping=standard (not stacked)');
  const serCount = (chartXml.match(/<c:ser>/g) || []).length;
  assert.equal(serCount, 4, '4 series in multi-line');
  for (const color of ['7E6BAD', '4CB582', '003DA5', '6A748C']) {
    assert.match(chartXml, new RegExp(`srgbClr val="${color}"`), `color ${color} present`);
  }
  // Outside Firm series (dashed) should have <a:prstDash val="dash"/>
  assert.match(chartXml, /<a:prstDash val="dash"\/>/, 'Outside Firm series is dashed');
  // Only ONE dashed series — count occurrences
  const dashCount = (chartXml.match(/<a:prstDash val="dash"\/>/g) || []).length;
  assert.equal(dashCount, 1, 'exactly one dashed series (Outside Firm)');
  // Series reference correct ranges
  assert.match(chartXml, /'Data_Cap_by_Term'!\$C\$5:\$C\$12/, 'first series points at C5:C12');
  assert.match(chartXml, /'Data_Cap_by_Term'!\$F\$5:\$F\$12/, 'last series points at F5:F12');
  // Markers off for line cohort series (pointRadius:0 equivalent)
  assert.match(chartXml, /<c:symbol val="none"\/>/, 'markers off');
  // Legend visible (multi-series)
  assert.match(chartXml, /<c:legend>/, 'has legend');
});

test('injectNativeCharts: combo chart renders correct dual-axis XML', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_DOM_Ask');
  sheet.getCell('A4').value = 'Quarter End';
  sheet.getCell('B4').value = 'Avg DOM';
  sheet.getCell('C4').value = '% of Ask';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i, 28);
    sheet.getCell(`B${5 + i}`).value = 90 + i * 5;
    sheet.getCell(`C${5 + i}`).value = 0.96 + i * 0.002;
  }
  const base = await wb.xlsx.writeBuffer();

  const injections = [{
    tabName: 'Data_DOM_Ask',
    spec: {
      type: 'combo',
      tabName: 'Data_DOM_Ask',
      catCol: 'A',
      dataStart: 5, dataEnd: 10,
      barSeries: [
        { titleCol: 'B', titleRow: 4, valCol: 'B', color: '62B5E5' },  // sky
      ],
      lineSeries: [
        { titleCol: 'C', titleRow: 4, valCol: 'C', color: '003DA5' },  // navy
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }];

  const result = await injectNativeCharts(base, injections);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // Both chart blocks present, sharing the cat axis
  assert.match(chartXml, /<c:barChart>/, 'has barChart block');
  assert.match(chartXml, /<c:lineChart>/, 'has lineChart block');

  // Bar block uses axId 1 (cat) + 2 (left val); line uses 1 + 3 (right val)
  const barBlock  = chartXml.match(/<c:barChart>[\s\S]*?<\/c:barChart>/)[0];
  const lineBlock = chartXml.match(/<c:lineChart>[\s\S]*?<\/c:lineChart>/)[0];
  assert.match(barBlock,  /<c:axId val="1"\/>[\s\S]*<c:axId val="2"\/>/, 'bar block: axId 1 + 2');
  assert.match(lineBlock, /<c:axId val="1"\/>[\s\S]*<c:axId val="3"\/>/, 'line block: axId 1 + 3');

  // Two val axes — left primary (axPos=l) and right secondary (axPos=r, crosses=max)
  const leftAx  = chartXml.match(/<c:valAx>\s*<c:axId val="2"\/>[\s\S]*?<\/c:valAx>/);
  const rightAx = chartXml.match(/<c:valAx>\s*<c:axId val="3"\/>[\s\S]*?<\/c:valAx>/);
  assert.ok(leftAx,  'left val axis (axId=2) present');
  assert.ok(rightAx, 'right val axis (axId=3) present');
  assert.match(leftAx[0],  /<c:axPos val="l"\/>/, 'left axis on left');
  assert.match(rightAx[0], /<c:axPos val="r"\/>/, 'right axis on right');
  assert.match(rightAx[0], /<c:crosses val="max"\/>/, 'right axis crosses at max');

  // One bar series + one line series, with unique idx values across both
  const idxValues = Array.from(chartXml.matchAll(/<c:idx val="(\d+)"\/>/g)).map(m => Number(m[1]));
  assert.deepEqual(idxValues, [0, 1], 'series idx 0 (bar) + 1 (line) — unique across chart');

  // Series reference correct cells
  assert.match(chartXml, /'Data_DOM_Ask'!\$B\$5:\$B\$10/, 'bar refs B5:B10');
  assert.match(chartXml, /'Data_DOM_Ask'!\$C\$5:\$C\$10/, 'line refs C5:C10');

  // Legend visible
  assert.match(chartXml, /<c:legend>/, 'has legend');

  // Bar fill = sky, line stroke = navy
  assert.match(barBlock,  /srgbClr val="62B5E5"/, 'bar = sky');
  assert.match(lineBlock, /srgbClr val="003DA5"/, 'line = navy');
});

test('injectNativeCharts: scatter chart renders correct xy XML', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Avail_Cap_Dot');
  sheet.getCell('A4').value = 'As of';
  sheet.getCell('B4').value = 'Asking Cap';
  sheet.getCell('C4').value = 'Firm Term (yrs)';
  // 10 sample dots: firm_term_years 5..14, cap_rate 0.060..0.085
  for (let i = 0; i < 10; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i, 28);
    sheet.getCell(`B${5 + i}`).value = 0.060 + i * 0.0025;
    sheet.getCell(`C${5 + i}`).value = 5 + i;
  }
  const base = await wb.xlsx.writeBuffer();

  const injections = [{
    tabName: 'Data_Avail_Cap_Dot',
    spec: {
      type: 'scatter',
      tabName: 'Data_Avail_Cap_Dot',
      dataStart: 5, dataEnd: 14,
      series: [{
        titleCol: 'B', titleRow: 4,
        xCol: 'C', yCol: 'B',
        color: '62B5E5',
      }],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }];

  const result = await injectNativeCharts(base, injections);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // Scatter-specific OpenXML constructs
  assert.match(chartXml, /<c:scatterChart>/, 'is a scatterChart');
  assert.match(chartXml, /<c:scatterStyle val="marker"\/>/, 'scatterStyle=marker (no line)');

  // Scatter series use xVal/yVal (not cat/val) — verify both refs present
  assert.match(chartXml, /<c:xVal>[\s\S]*?\$C\$5:\$C\$14[\s\S]*?<\/c:xVal>/, 'xVal points at C5:C14 (firm_term_years)');
  assert.match(chartXml, /<c:yVal>[\s\S]*?\$B\$5:\$B\$14[\s\S]*?<\/c:yVal>/, 'yVal points at B5:B14 (cap_rate)');

  // Scatter charts should NOT have a cat axis (both axes are valAx)
  assert.ok(!/<c:catAx>/.test(chartXml), 'no catAx (both axes continuous)');
  const valAxCount = (chartXml.match(/<c:valAx>/g) || []).length;
  assert.equal(valAxCount, 2, 'two valAx blocks (x continuous + y continuous)');

  // Marker color (sky) present + alpha attribute for the fill (transparent dot)
  assert.match(chartXml, /srgbClr val="62B5E5"/, 'sky color present');
  assert.match(chartXml, /<a:alpha val="55000"\/>/, 'marker fill has alpha (semi-transparent dot)');
  // No connecting line on the dot series
  assert.match(chartXml, /<c:smooth val="0"\/>/, 'smooth=0');
});

test('injectNativeCharts: floating-bar (invisible base) renders correct stacked XML', async () => {
  // Build a tiny workbook with avg_last_ask_cap + avg_bid_ask_spread cols
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Bid_Ask_Monthly');
  sheet.getCell('A4').value = 'Month End';
  sheet.getCell('D4').value = 'Spread';
  sheet.getCell('F4').value = 'Last Ask Cap';
  for (let i = 0; i < 8; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i, 28);
    sheet.getCell(`D${5 + i}`).value = 0.0025 + i * 0.0001;  // spread ~25 bps
    sheet.getCell(`F${5 + i}`).value = 0.065 + i * 0.0008;   // last ask ~6.5%
  }
  const base = await wb.xlsx.writeBuffer();

  const injections = [{
    tabName: 'Data_Bid_Ask_Monthly',
    spec: {
      type: 'stacked-bar',
      tabName: 'Data_Bid_Ask_Monthly',
      catCol: 'A',
      dataStart: 5, dataEnd: 12,
      series: [
        // Invisible base
        { titleCol: 'F', titleRow: 4, valCol: 'F', color: '003DA5', noFill: true },
        // Visible band
        { titleCol: 'D', titleRow: 4, valCol: 'D', color: '62B5E5' },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }];

  const result = await injectNativeCharts(base, injections);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // Stacked bar structure confirmed
  assert.match(chartXml, /<c:barChart>/, 'is a barChart');
  assert.match(chartXml, /<c:grouping val="stacked"\/>/, 'grouping=stacked (floats over invisible base)');

  // 2 series total
  assert.equal((chartXml.match(/<c:ser>/g) || []).length, 2, '2 series (base + band)');

  // First series (index 0) is the invisible base — should have <a:noFill/>
  // for both fill AND line border
  const ser0Match = chartXml.match(/<c:ser>\s*<c:idx val="0"\/>[\s\S]*?<\/c:ser>/);
  assert.ok(ser0Match, 'series 0 found');
  assert.match(ser0Match[0], /<a:noFill\/>/, 'invisible base has <a:noFill/>');
  // The invisible series must NOT have solidFill with a color — that
  // would defeat the floating-bar trick.
  assert.ok(
    !/<a:solidFill>\s*<a:srgbClr/.test(ser0Match[0]),
    'invisible base has no solidFill color block'
  );
  // And the line border is also noFill (no visible outline)
  assert.match(ser0Match[0], /<a:ln>\s*<a:noFill\/>\s*<\/a:ln>/, 'invisible base has no line border');

  // Series 1 (the visible band) still has the sky color
  const ser1Match = chartXml.match(/<c:ser>\s*<c:idx val="1"\/>[\s\S]*?<\/c:ser>/);
  assert.match(ser1Match[0], /srgbClr val="62B5E5"/, 'visible band = sky');
  // Visible series must NOT have the noFill flag
  assert.ok(!/<a:noFill\/>/.test(ser1Match[0]), 'visible band has no noFill');

  // Each series references its own column
  assert.match(chartXml, /'Data_Bid_Ask_Monthly'!\$F\$5:\$F\$12/, 'base refs F (last_ask)');
  assert.match(chartXml, /'Data_Bid_Ask_Monthly'!\$D\$5:\$D\$12/, 'band refs D (spread)');
});
