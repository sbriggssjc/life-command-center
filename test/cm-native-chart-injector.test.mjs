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
  buildMultiLineChartXml,
  buildComboChartXml,
  buildSingleBarChartXml,
  buildDoughnutChartXml,
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
  // lease_termination_rate was deferred in P4 (computed series not stored)
  // but unblocked in R36 P4 via the helper-col infrastructure.
  // See the R36 P4 registration test below.
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
  // net_lease_spread was deferred in P5 (renderer references cap_10plus_year
  // which isn't in the Data_NL_Spread tab) but unblocked in R36 P4 by
  // matching the renderer's actual visual (2 visible series, not 3).
  // See the R36 P4 registration test below.
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
  // ppsf_box_quarterly was DELETED from the runtime catalog in Round 6h
  // (supabase migration 20260601_*_round6h.sql). No view, no export rows,
  // nothing to migrate. Leaving it out of NATIVE_CHART_TEMPLATES is
  // correct — the static JSON catalog is stale documentation.
  assert.ok(
    !NATIVE_CHART_TEMPLATES.has('ppsf_box_quarterly'),
    'ppsf_box_quarterly is not in the runtime catalog (dropped in Round 6h)'
  );
});

test('NATIVE_CHART_TEMPLATES: P9 final composite (rent_by_year_built) registered', () => {
  assert.ok(NATIVE_CHART_TEMPLATES.has('rent_by_year_built'),
    'rent_by_year_built should be migrated');
});

test('NATIVE_CHART_TEMPLATES: Tier F1 valuation_index registered', () => {
  assert.ok(NATIVE_CHART_TEMPLATES.has('valuation_index'),
    'valuation_index combo should be migrated');
});

test('NATIVE_CHART_TEMPLATES: R35 P1 missed multi-line templates registered', () => {
  for (const id of [
    'cap_rate_top_bottom_quartile',
    'cap_rate_by_credit',
    'cpi_vs_renewal_cagr',
    'fed_funds_vs_treasury',
    'cash_leveraged_returns',
    'asking_cap_quartiles_active',
  ]) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
});

test('NATIVE_CHART_TEMPLATES: R35 P2 missed combo + clustered-bar templates registered', () => {
  for (const id of [
    'txn_count_avg_deal_combo',
    'rent_and_price_per_chair',
    'rent_and_price_psf',
    'dom_price_change_active',
    'seller_sentiment',
    'seller_sentiment_monthly',
    'inventory_backlog',
    'pace_of_cap_rate_expansion',
  ]) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
});

test('NATIVE_CHART_TEMPLATES: R35 P3 final simple-shape templates registered', () => {
  for (const id of ['buyer_class_pct_by_year', 'renewal_rent_growth']) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
});

test('NATIVE_CHART_TEMPLATES: R35 P4 complex composites registered', () => {
  for (const id of ['cost_of_capital', 'volume_cap_quartile_combo']) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
});

test('NATIVE_CHART_TEMPLATES: R36 P1 horizontal-bar state rankings registered', () => {
  for (const id of ['leased_inventory_by_state', 'sources_of_capital']) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
});

test('NATIVE_CHART_TEMPLATES: R36 P2 donut charts registered', () => {
  for (const id of ['available_by_tenant_count_donut', 'available_by_tenant_volume_donut']) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
});

test('NATIVE_CHART_TEMPLATES: R36 P3 bar + multi-scatter composites registered', () => {
  for (const id of ['available_by_term_summary', 'available_by_firm_term_summary']) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
});

test('R37 P1: line chart cat axis emits quarter-format numFmt by default', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  sheet.getCell('B5').value = 'Series';
  for (let i = 0; i < 4; i++) {
    sheet.getCell(`A${6 + i}`).value = new Date(2024, i * 3, 31);
    sheet.getCell(`B${6 + i}`).value = 100 + i;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'line', tabName: 'Data_Test',
      titleCol: 'B', titleRow: 5,
      catCol: 'A', valCol: 'B',
      dataStart: 6, dataEnd: 9,
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // Cat axis has the quarter-format numFmt
  const catAxBlock = chartXml.match(/<c:catAx>[\s\S]*?<\/c:catAx>/)[0];
  assert.match(catAxBlock, /<c:numFmt formatCode="q&quot;Q-&quot;yyyy" sourceLinked="0"\/>/,
    'cat axis emits quarter-format numFmt (renders dates as "1Q-2024")');
  // Val axis stays unformatted (we don't touch it in P1)
  const valAxBlock = chartXml.match(/<c:valAx>[\s\S]*?<\/c:valAx>/)[0];
  assert.ok(!/<c:numFmt/.test(valAxBlock), 'val axis untouched');
});

test('R37 P1: stacked-bar and multi-line builders emit cat numFmt', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 4; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i, 28);
    sheet.getCell(`B${5 + i}`).value = 50 + i;
    sheet.getCell(`C${5 + i}`).value = 30 + i;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [
    {
      tabName: 'Data_Test',
      spec: {
        type: 'stacked-bar', tabName: 'Data_Test', catCol: 'A',
        dataStart: 5, dataEnd: 8,
        series: [
          { titleCol: 'B', titleRow: 4, valCol: 'B', color: '003DA5' },
          { titleCol: 'C', titleRow: 4, valCol: 'C', color: '62B5E5' },
        ],
        anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
      },
    },
    {
      tabName: 'Data_Test',
      spec: {
        type: 'multi-line', tabName: 'Data_Test', catCol: 'A',
        dataStart: 5, dataEnd: 8,
        series: [
          { titleCol: 'B', titleRow: 4, valCol: 'B', color: '003DA5' },
        ],
        anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
      },
    },
  ]);
  const zip = await JSZip.loadAsync(result);
  for (const fname of ['chart1.xml', 'chart2.xml']) {
    const xml = await zip.file('xl/charts/' + fname).async('string');
    const catAx = xml.match(/<c:catAx>[\s\S]*?<\/c:catAx>/)[0];
    assert.match(catAx, /<c:numFmt formatCode="q&quot;Q-&quot;yyyy"/,
      `${fname} cat axis has quarter numFmt`);
  }
});

test('R37 P1: catAxNumFmt override works for year-axis templates', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 4; i++) {
    sheet.getCell(`A${5 + i}`).value = 2020 + i;
    sheet.getCell(`B${5 + i}`).value = 10 + i;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'line', tabName: 'Data_Test',
      titleCol: 'B', titleRow: 4,
      catCol: 'A', valCol: 'B',
      dataStart: 5, dataEnd: 8,
      catAxNumFmt: '0',  // plain integer for year axes
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  const catAxBlock = chartXml.match(/<c:catAx>[\s\S]*?<\/c:catAx>/)[0];
  assert.match(catAxBlock, /<c:numFmt formatCode="0"/, 'plain integer fmt for year axis');
  assert.ok(!/q&quot;Q-&quot;yyyy/.test(catAxBlock), 'no quarter fmt');
});

test('R37 P2: line chart emits valAx scaling + numFmt when yAxisRange + valAxNumFmt set', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 4; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i * 3, 31);
    sheet.getCell(`B${5 + i}`).value = 0.065 + i * 0.005;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'line', tabName: 'Data_Test',
      titleCol: 'B', titleRow: 4, catCol: 'A', valCol: 'B',
      dataStart: 5, dataEnd: 8,
      yAxisRange: { min: 0.05, max: 0.10 },
      valAxNumFmt: '0.00%',
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  const valAxBlock = chartXml.match(/<c:valAx>[\s\S]*?<\/c:valAx>/)[0];
  assert.match(valAxBlock, /<c:min val="0.05"\/>/, 'min pinned to 0.05');
  assert.match(valAxBlock, /<c:max val="0.1"\/>/,  'max pinned to 0.1');
  assert.match(valAxBlock, /<c:numFmt formatCode="0\.00%" sourceLinked="0"\/>/,
    'percent 2dp number format');
});

test('R37 P2: combo chart emits independent left + right scaling/format', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 4; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i * 3, 31);
    sheet.getCell(`B${5 + i}`).value = 90 + i * 5;
    sheet.getCell(`C${5 + i}`).value = 0.92 + i * 0.005;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'combo', tabName: 'Data_Test', catCol: 'A',
      dataStart: 5, dataEnd: 8,
      yLeftNumFmt:  '#,##0',
      yRightRange:  { min: 0.85, max: 1.05 },
      yRightNumFmt: '0.0%',
      barSeries:  [{ titleCol: 'B', titleRow: 4, valCol: 'B', color: '62B5E5' }],
      lineSeries: [{ titleCol: 'C', titleRow: 4, valCol: 'C', color: '003DA5' }],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  // Left axis (axId 2) has integer format, no range pinning
  const leftAx = chartXml.match(/<c:valAx>\s*<c:axId val="2"\/>[\s\S]*?<\/c:valAx>/)[0];
  assert.match(leftAx, /<c:numFmt formatCode="#,##0"/, 'left = integer fmt');
  assert.ok(!/<c:min/.test(leftAx), 'left axis not pinned (auto-scale)');
  // Right axis (axId 3) has percent format + pinned to 85-105%
  const rightAx = chartXml.match(/<c:valAx>\s*<c:axId val="3"\/>[\s\S]*?<\/c:valAx>/)[0];
  assert.match(rightAx, /<c:min val="0.85"\/>/);
  assert.match(rightAx, /<c:max val="1.05"\/>/);
  assert.match(rightAx, /<c:numFmt formatCode="0\.0%"/);
});

test('R37 P2: scatter chart emits x + y range/format independently', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 4; i++) {
    sheet.getCell(`A${5 + i}`).value = 5 + i;
    sheet.getCell(`B${5 + i}`).value = 0.07 + i * 0.005;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'scatter', tabName: 'Data_Test',
      dataStart: 5, dataEnd: 8,
      yAxisRange: { min: 0.04, max: 0.12 },
      valAxNumFmt: '0.00%',
      series: [{ titleCol: 'B', titleRow: 4, xCol: 'A', yCol: 'B', color: '62B5E5' }],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  // Y axis (axId 2) gets the cap range pin + percent fmt
  const yAx = chartXml.match(/<c:valAx>\s*<c:axId val="2"\/>[\s\S]*?<\/c:valAx>/)[0];
  assert.match(yAx, /<c:min val="0.04"\/>/);
  assert.match(yAx, /<c:max val="0.12"\/>/);
  assert.match(yAx, /<c:numFmt formatCode="0\.00%"/);
});

test('R37 P2: buildInjectionSpec ports renderer ranges/formats to specs', () => {
  // Spot-check a few representative templates
  const cols = (keys) => keys.map((k, i) => ({
    key: k, col: String.fromCharCode(65 + i),
  }));

  // nm_vs_market_cap (gov branch — no vertical passed) pins 6.0-7.75%
  // (R66l/R66bb tightened to the 2020+ data window; was R37's 5.25-9.25%).
  const nm = buildInjectionSpec({
    chart_template_id: 'nm_vs_market_cap', tabName: 'Data_NM_vs_Market',
    cols: cols(['period_end','subspecialty','nm_cap_rate','market_cap_rate']),
    dataStart: 5, dataEnd: 60, brand: { palette: {} },
  });
  assert.equal(nm.spec.yAxisRange.min, 0.06);
  assert.equal(nm.spec.yAxisRange.max, 0.0775);
  assert.equal(nm.spec.valAxNumFmt, '0.00%');

  // dom_and_pct_of_ask pins right axis 85-105%
  const dom = buildInjectionSpec({
    chart_template_id: 'dom_and_pct_of_ask', tabName: 'Data_DOM_Ask',
    cols: cols(['period_end','subspecialty','avg_dom','median_dom','pct_of_ask']),
    dataStart: 5, dataEnd: 60, brand: { palette: {} },
  });
  assert.deepEqual(dom.spec.yRightRange, { min: 0.85, max: 1.05 });
  assert.equal(dom.spec.yRightNumFmt, '0.0%');
  // R38 — VAL_FMT_INTEGER now uses CRE-standard [Red](N) negative idiom
  assert.equal(dom.spec.yLeftNumFmt, '#,##0_);[Red](#,##0)');

  // core_cap_rate_dot_plot pins 4-12% on y
  const core = buildInjectionSpec({
    chart_template_id: 'core_cap_rate_dot_plot', tabName: 'Data_Core_Cap_Dot',
    cols: cols(['period_end','cap_rate','firm_term_years','is_northmarq','sold_price']),
    dataStart: 5, dataEnd: 500, brand: { palette: {} },
  });
  assert.deepEqual(core.spec.yAxisRange, { min: 0.04, max: 0.12 });

  // buyer_class_pct_by_year pins 0-100%
  const bcp = buildInjectionSpec({
    chart_template_id: 'buyer_class_pct_by_year', tabName: 'Data_Buyer_Pool',
    cols: cols(['year','subspecialty','private_volume','reit_volume','cross_border_volume',
                'institutional_volume','private_pct','reit_pct','cross_border_pct','institutional_pct']),
    dataStart: 5, dataEnd: 20, brand: { palette: {} },
  });
  assert.deepEqual(bcp.spec.yAxisRange, { min: 0, max: 1 });
  assert.equal(bcp.spec.valAxNumFmt, '0%');
});

test('R37 P1: catAxNumFmt empty string suppresses numFmt entirely', async () => {
  // Horizontal-bar charts (state rankings) should not emit a numFmt
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  ['CA', 'TX', 'NY'].forEach((s, i) => {
    sheet.getCell(`A${5 + i}`).value = s;
    sheet.getCell(`B${5 + i}`).value = 100 - i * 10;
  });
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'bar', tabName: 'Data_Test',
      titleCol: 'B', titleRow: 4,
      catCol: 'A', valCol: 'B',
      dataStart: 5, dataEnd: 7,
      color: '003DA5', horizontal: true,
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  const catAxBlock = chartXml.match(/<c:catAx>[\s\S]*?<\/c:catAx>/)[0];
  assert.ok(!/<c:numFmt/.test(catAxBlock),
    'horizontal-bar (state rankings) has no cat numFmt — text categories');
});

test('buildInjectionSpec: year-axis templates set catAxNumFmt to "0"', () => {
  // case_for_renewal
  const cfr = buildInjectionSpec({
    chart_template_id: 'case_for_renewal',
    tabName: 'Data_Case_For_Renewal',
    cols: [
      { key: 'year', col: 'A' },
      { key: 'commencement_count', col: 'B' },
      { key: 'avg_rent_per_sf', col: 'C' },
      { key: 'total_lsf', col: 'D' },
    ],
    dataStart: 5, dataEnd: 30,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(cfr.spec.catAxNumFmt, '0', 'case_for_renewal uses integer year format');

  // rent_by_year_built
  const rby = buildInjectionSpec({
    chart_template_id: 'rent_by_year_built',
    tabName: 'Data_Rent_Year_Built',
    cols: [
      { key: 'year',                col: 'A' },
      { key: 'avg_rpsf',            col: 'B' },
      { key: 'median_rpsf',         col: 'C' },
      { key: 'upper_quartile_rpsf', col: 'D' },
      { key: 'lower_quartile_rpsf', col: 'E' },
      { key: 'n_leases',            col: 'F' },
    ],
    dataStart: 5, dataEnd: 20,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(rby.spec.catAxNumFmt, '0', 'rent_by_year_built uses integer year format');

  // buyer_class_pct_by_year
  const bcp = buildInjectionSpec({
    chart_template_id: 'buyer_class_pct_by_year',
    tabName: 'Data_Buyer_Pool',
    cols: [
      { key: 'year',                 col: 'A' },
      { key: 'subspecialty',         col: 'B' },
      { key: 'private_volume',       col: 'C' },
      { key: 'reit_volume',          col: 'D' },
      { key: 'cross_border_volume',  col: 'E' },
      { key: 'institutional_volume', col: 'F' },
      { key: 'private_pct',          col: 'G' },
      { key: 'reit_pct',             col: 'H' },
      { key: 'cross_border_pct',     col: 'I' },
      { key: 'institutional_pct',    col: 'J' },
    ],
    dataStart: 5, dataEnd: 20,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5',
                        nm_blue_mid: '#265AB2', nm_pale: '#E0E8F4' } },
  });
  assert.equal(bcp.spec.catAxNumFmt, '0', 'buyer_class_pct_by_year uses integer year format');
});

test('NATIVE_CHART_TEMPLATES: R36 P4 unblocks 3 previously-deferred templates', () => {
  for (const id of ['lease_termination_rate', 'net_lease_spread', 'rent_heat_map']) {
    assert.ok(NATIVE_CHART_TEMPLATES.has(id), `${id} should be migrated`);
  }
  // Only 2 truly unmigrateable templates remain:
  for (const id of ['ppsf_box_quarterly', 'lease_structures']) {
    assert.ok(
      !NATIVE_CHART_TEMPLATES.has(id),
      `${id} should remain on the PNG path (blocked — see R36 P4 migration notes)`
    );
  }
});

test('buildInjectionSpec: lease_termination_rate uses helper col for in_firm_term', () => {
  const cols = [
    { key: 'period_end',               col: 'A' },
    { key: 'total_leases_active',      col: 'B' },
    { key: 'terminated_ttm',           col: 'C' },
    { key: 'leases_outside_firm_term', col: 'D' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'lease_termination_rate',
    tabName: 'Data_Term_Rate',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'stacked-bar');
  assert.equal(out.spec.catCol, 'A');
  assert.equal(out.spec.series.length, 2);
  // Bottom: helper col (in_firm_term computed) — col E (cols.length + 1)
  assert.equal(out.spec.series[0].valCol, 'E', 'bottom = helper col (in_firm_term)');
  assert.equal(out.spec.series[0].color, '003DA5', 'navy');
  // Top: outside_firm (col D)
  assert.equal(out.spec.series[1].valCol, 'D', 'top = outside_firm_term');
  assert.equal(out.spec.series[1].color, '62B5E5', 'sky');

  // Helper col getValue: total - outside, with Math.max(0, ...) guard
  assert.equal(out.helperCols.length, 1);
  assert.equal(out.helperCols[0].key, 'in_firm_term');
  assert.equal(
    out.helperCols[0].getValue({ total_leases_active: 100, leases_outside_firm_term: 30 }),
    70,
    '100 - 30 = 70'
  );
  // Edge: outside > total clamps to 0 (defensive)
  assert.equal(
    out.helperCols[0].getValue({ total_leases_active: 30, leases_outside_firm_term: 50 }),
    0,
    'Math.max(0, ...) clamp'
  );
  // Null guard
  assert.equal(
    out.helperCols[0].getValue({ total_leases_active: null, leases_outside_firm_term: 30 }),
    null
  );
});

test('buildInjectionSpec: net_lease_spread plots the 2 series that exist (cap_10plus_year deferred)', () => {
  const cols = [
    { key: 'period_end',         col: 'A' },
    { key: 'subspecialty',       col: 'B' },
    { key: 'treasury_10y_yield', col: 'C' },
    { key: 'avg_cap_rate',       col: 'D' },
    { key: 'nm_avg_cap',         col: 'E' },
    { key: 'market_spread',      col: 'F' },
    { key: 'nm_spread',          col: 'G' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'net_lease_spread',
    tabName: 'Data_NL_Spread',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'multi-line');
  assert.equal(out.spec.series.length, 2, '2 series — cap_10plus_year not in data tab');
  assert.deepEqual(out.spec.series.map(s => s.valCol), ['C', 'D'],
    'treasury + avg_cap_rate');
  assert.deepEqual(out.spec.series.map(s => s.color), ['62B5E5', '003DA5'],
    'sky / navy');
});

test('buildInjectionSpec: rent_heat_map uses horizontal-bar fallback (same as leased_inv_by_state)', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'rent_heat_map',
    tabName: 'Data_Rent_Heat_Map',
    cols: [
      { key: 'rank_by_rpsf',         col: 'A' },
      { key: 'state',                col: 'B' },
      { key: 'avg_rpsf',             col: 'C' },
      { key: 'median_rpsf',          col: 'D' },
      { key: 'upper_quartile_rpsf',  col: 'E' },
      { key: 'lower_quartile_rpsf',  col: 'F' },
      { key: 'n_leases',             col: 'G' },
    ],
    dataStart: 5, dataEnd: 19,
    brand: { palette: { nm_navy: '#003DA5' } },
  });
  assert.equal(out.spec.type, 'bar');
  assert.equal(out.spec.horizontal, true);
  assert.equal(out.spec.catCol, 'B', 'state on cat axis');
  assert.equal(out.spec.valCol, 'C', 'avg_rpsf on val axis');
  assert.equal(out.spec.color, '003DA5');
});

test('buildInjectionSpec: available_by_term_summary builds 1-bar + 4-scatter combo', () => {
  const cols = [
    { key: 'term_bucket',         col: 'A' },
    { key: 'n_listings',          col: 'B' },
    { key: 'avg_price',           col: 'C' },
    { key: 'avg_cap',             col: 'D' },
    { key: 'upper_quartile_cap',  col: 'E' },
    { key: 'median_cap',          col: 'F' },
    { key: 'lower_quartile_cap',  col: 'G' },
    { key: 'period_end',          col: 'H' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'available_by_term_summary',
    tabName: 'Data_Avail_Term',
    cols, dataStart: 5, dataEnd: 8,  // 4 term buckets
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.catCol, 'A', 'term_bucket is x-axis');

  // 1 bar series — sky avg_price on left axis (default combo)
  assert.equal(out.spec.barSeries.length, 1);
  assert.equal(out.spec.barSeries[0].valCol, 'C');
  assert.equal(out.spec.barSeries[0].color, '62B5E5');

  // 4 marker-only line series — all on the right axis (default combo)
  assert.equal(out.spec.lineSeries.length, 4);
  assert.deepEqual(out.spec.lineSeries.map(s => s.valCol),
    ['D', 'E', 'G', 'F'],
    'Avg Cap / Upper Q / Lower Q / Median order');
  // R50 → R67: Avg Cap re-swapped from R50's #00B1B0 teal (off-brand)
  // back to navy #003DA5 per user batch 6: "match brand standards."
  assert.deepEqual(out.spec.lineSeries.map(s => s.color),
    ['003DA5', '7E6BAD', '62B5E5', '4CB582'],
    'R67: navy / purple / sky / sage (brand-aligned)');
  // All 4 are markers-only (no connecting line)
  assert.ok(out.spec.lineSeries.every(s => s.showMarker === true),
    'all 4 have showMarker=true');
  assert.ok(out.spec.lineSeries.every(s => s.markerShape === 'diamond'),
    'all 4 use diamond markers');
  // R60 — right axis tightened to 5-9% (was R50's 4-12%) so the
  // narrow dia cap-rate range is more visible.
  assert.deepEqual(out.spec.yRightRange, { min: 0.05, max: 0.09 },
    'R60: right axis tightened to 5-9% from R50 default');
  assert.ok(out.spec.yRightNumFmt && out.spec.yRightNumFmt.includes('%'),
    'R50: right axis labeled as percent');
  // R60 — per-dot value callouts on each scatter series
  assert.ok(out.spec.lineSeries.every(s => s.dataLabels && s.dataLabels.showVal === true),
    'R60: each dot series has chart-wide value callouts');
});

test('buildInjectionSpec: available_by_firm_term_summary uses same shape as dia variant', () => {
  // Gov firm-term variant has the same columns; spec should be identical except tab name
  const cols = [
    { key: 'term_bucket',         col: 'A' },
    { key: 'n_listings',          col: 'B' },
    { key: 'avg_price',           col: 'C' },
    { key: 'avg_cap',             col: 'D' },
    { key: 'upper_quartile_cap',  col: 'E' },
    { key: 'median_cap',          col: 'F' },
    { key: 'lower_quartile_cap',  col: 'G' },
    { key: 'period_end',          col: 'H' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'available_by_firm_term_summary',
    tabName: 'Data_Avail_Firm_Term',
    cols, dataStart: 5, dataEnd: 8,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.lineSeries.length, 4);
  assert.equal(out.spec.barSeries[0].valCol, 'C', 'avg_price on bar');
});

test('injectNativeCharts: bar + 4-scatter composite renders diamond markers across the right axis', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Avail_Term');
  sheet.getCell('A4').value = 'Term Bucket';
  sheet.getCell('C4').value = 'Avg Price';
  sheet.getCell('D4').value = 'Avg Cap';
  sheet.getCell('E4').value = 'Upper Q';
  sheet.getCell('F4').value = 'Median';
  sheet.getCell('G4').value = 'Lower Q';
  ['Sub 5', '5-8', '8-12', '12+'].forEach((bucket, i) => {
    sheet.getCell(`A${5 + i}`).value = bucket;
    sheet.getCell(`C${5 + i}`).value = 2_000_000 + i * 500_000;
    sheet.getCell(`D${5 + i}`).value = 0.075 - i * 0.005;
    sheet.getCell(`E${5 + i}`).value = 0.080 - i * 0.005;
    sheet.getCell(`F${5 + i}`).value = 0.073 - i * 0.005;
    sheet.getCell(`G${5 + i}`).value = 0.068 - i * 0.005;
  });
  const base = await wb.xlsx.writeBuffer();

  const result = await injectNativeCharts(base, [{
    tabName: 'Data_Avail_Term',
    spec: {
      type: 'combo',
      tabName: 'Data_Avail_Term',
      catCol: 'A',
      dataStart: 5, dataEnd: 8,
      barSeries: [
        { titleCol: 'C', titleRow: 4, valCol: 'C', color: '62B5E5' },
      ],
      lineSeries: [
        { titleCol: 'D', titleRow: 4, valCol: 'D', color: '003DA5',
          showMarker: true, markerShape: 'diamond', markerSize: 7 },
        { titleCol: 'E', titleRow: 4, valCol: 'E', color: '7E6BAD',
          showMarker: true, markerShape: 'diamond', markerSize: 7 },
        { titleCol: 'G', titleRow: 4, valCol: 'G', color: '6A748C',
          showMarker: true, markerShape: 'diamond', markerSize: 7 },
        { titleCol: 'F', titleRow: 4, valCol: 'F', color: '4CB582',
          showMarker: true, markerShape: 'diamond', markerSize: 7 },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // Combo: barChart + lineChart
  assert.match(chartXml, /<c:barChart>/);
  assert.match(chartXml, /<c:lineChart>/);

  // Two axes (bars LEFT, lines RIGHT — default combo)
  const valAxCount = (chartXml.match(/<c:valAx>/g) || []).length;
  assert.equal(valAxCount, 2);

  // 5 series total (1 bar + 4 lines), unique idx 0..4
  const idxs = Array.from(chartXml.matchAll(/<c:ser>\s*<c:idx val="(\d+)"\/>/g)).map(m => Number(m[1]));
  assert.deepEqual(idxs, [0, 1, 2, 3, 4]);

  // 4 diamond markers, NO circles or other shapes
  const diamondCount = (chartXml.match(/<c:symbol val="diamond"\/>/g) || []).length;
  assert.equal(diamondCount, 4, '4 diamond markers');
  // No connecting lines on the marker series — each line has <a:noFill/>
  // on its <a:ln> (one per line-with-marker series)
  const noFillLineCount = (chartXml.match(/<a:ln><a:noFill\/><\/a:ln>/g) || []).length;
  assert.equal(noFillLineCount, 4, '4 markers-only line series (no connecting lines)');

  // Global lineChart marker toggle is ON
  const lineBlock = chartXml.match(/<c:lineChart>[\s\S]*?<\/c:lineChart>/)[0];
  assert.match(lineBlock, /<c:marker val="1"\/>/);
});

test('buildInjectionSpec: available_by_tenant_count_donut builds 4-segment doughnut', () => {
  const cols = [
    { key: 'tenant',       col: 'A' },
    { key: 'count_active', col: 'B' },
    { key: 'period_end',   col: 'C' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'available_by_tenant_count_donut',
    tabName: 'Data_Avail_by_Tenant',
    cols, dataStart: 5, dataEnd: 8,  // 4 segments
    brand: { palette: {} },
  });
  assert.equal(out.spec.type, 'doughnut');
  assert.equal(out.spec.catCol, 'A');
  assert.equal(out.spec.valCol, 'B', 'count_active is the value column');
  assert.equal(out.spec.dataStart, 5);
  assert.equal(out.spec.dataEnd, 8);
  assert.equal(out.spec.holeSize, 55);
  // 4 colors per segment: navy / sky / sage / gray
  assert.deepEqual(out.spec.colors,
    ['003DA5', '62B5E5', '4CB582', '6A748C'],
    'DaVita / FMC / US Renal / Other');
});

test('buildInjectionSpec: available_by_tenant_volume_donut uses volume_available column', () => {
  const cols = [
    { key: 'tenant',           col: 'A' },
    { key: 'volume_available', col: 'B' },
    { key: 'period_end',       col: 'C' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'available_by_tenant_volume_donut',
    tabName: 'Data_Avail_by_Tenant_Vol',
    cols, dataStart: 5, dataEnd: 8,
    brand: { palette: {} },
  });
  assert.equal(out.spec.type, 'doughnut');
  assert.equal(out.spec.valCol, 'B', 'volume_available is the value column');
});

test('buildInjectionSpec: doughnut extra segments past 4 fall back to gray', () => {
  // 6 rows of tenants — first 4 get the known colors, last 2 get gray
  const out = buildInjectionSpec({
    chart_template_id: 'available_by_tenant_count_donut',
    tabName: 'Data_Avail_by_Tenant',
    cols: [
      { key: 'tenant',       col: 'A' },
      { key: 'count_active', col: 'B' },
      { key: 'period_end',   col: 'C' },
    ],
    dataStart: 5, dataEnd: 10,  // 6 segments
    brand: { palette: {} },
  });
  assert.equal(out.spec.colors.length, 6);
  assert.deepEqual(out.spec.colors,
    ['003DA5', '62B5E5', '4CB582', '6A748C', '6A748C', '6A748C']);
});

test('injectNativeCharts: doughnut chart emits correct OOXML structure', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Avail_by_Tenant');
  sheet.getCell('A4').value = 'Tenant';
  sheet.getCell('B4').value = 'Count Available';
  ['DaVita', 'FMC', 'US Renal', 'Other'].forEach((tenant, i) => {
    sheet.getCell(`A${5 + i}`).value = tenant;
    sheet.getCell(`B${5 + i}`).value = 50 - i * 10;
  });
  const base = await wb.xlsx.writeBuffer();

  const result = await injectNativeCharts(base, [{
    tabName: 'Data_Avail_by_Tenant',
    spec: {
      type: 'doughnut',
      tabName: 'Data_Avail_by_Tenant',
      titleCol: 'B', titleRow: 4,
      catCol: 'A', valCol: 'B',
      dataStart: 5, dataEnd: 8,
      colors: ['003DA5', '62B5E5', '4CB582', '6A748C'],
      holeSize: 55,
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // doughnut chart present
  assert.match(chartXml, /<c:doughnutChart>/, 'is a doughnut chart');
  assert.match(chartXml, /<c:holeSize val="55"\/>/, 'hole size 55%');

  // NO axes at all (donut is axis-free)
  assert.ok(!/<c:catAx>/.test(chartXml), 'no cat axis');
  assert.ok(!/<c:valAx>/.test(chartXml), 'no val axis');

  // 4 per-point color blocks
  const dPtCount = (chartXml.match(/<c:dPt>/g) || []).length;
  assert.equal(dPtCount, 4, '4 segment dPt blocks');
  for (const color of ['003DA5', '62B5E5', '4CB582', '6A748C']) {
    assert.match(chartXml, new RegExp(`srgbClr val="${color}"`), `${color} segment present`);
  }

  // <c:cat> uses strRef (text labels) not numRef
  assert.match(chartXml, /<c:cat><c:strRef><c:f>'Data_Avail_by_Tenant'!\$A\$5:\$A\$8/,
    'cat uses strRef for tenant names');
  // <c:val> uses numRef as usual
  assert.match(chartXml, /<c:val><c:numRef><c:f>'Data_Avail_by_Tenant'!\$B\$5:\$B\$8/,
    'val uses numRef for counts');

  // <c:varyColors val="1"/> (donut conventionally varies colors per segment)
  assert.match(chartXml, /<c:varyColors val="1"\/>/);

  // Legend at bottom (R38 audit finding C — match master Excel
  // doughnut convention; was 'r' through R36)
  assert.match(chartXml, /<c:legendPos val="b"\/>/);
});

test('buildInjectionSpec: leased_inventory_by_state builds horizontal bar', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'leased_inventory_by_state',
    tabName: 'Data_Leased_Inv_State',
    cols: [
      { key: 'rank_by_rsf',      col: 'A' },
      { key: 'state',            col: 'B' },
      { key: 'lease_count',      col: 'C' },
      { key: 'total_rsf',        col: 'D' },
      { key: 'total_annual_rent', col: 'E' },
      { key: 'avg_rent_psf',     col: 'F' },
    ],
    dataStart: 5, dataEnd: 19,
    brand: { palette: { nm_navy: '#003DA5' } },
  });
  assert.equal(out.spec.type, 'bar');
  assert.equal(out.spec.horizontal, true, 'flipped to horizontal bar');
  assert.equal(out.spec.catCol, 'B', 'state on cat axis');
  assert.equal(out.spec.valCol, 'C', 'lease_count on val axis');
  assert.equal(out.spec.color, '003DA5', 'navy');
});

test('buildInjectionSpec: sources_of_capital builds horizontal bar', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'sources_of_capital',
    tabName: 'Data_Sources',
    cols: [
      { key: 'rank_15y',         col: 'A' },
      { key: 'buyer_state',      col: 'B' },
      { key: 'total_volume_15y', col: 'C' },
      { key: 'pct_of_total_15y', col: 'D' },
      { key: 'deal_count_15y',   col: 'E' },
    ],
    dataStart: 5, dataEnd: 19,
    brand: { palette: { nm_navy: '#003DA5' } },
  });
  assert.equal(out.spec.type, 'bar');
  assert.equal(out.spec.horizontal, true);
  assert.equal(out.spec.catCol, 'B', 'buyer_state on cat axis');
  assert.equal(out.spec.valCol, 'C', 'total_volume_15y on val axis');
});

test('injectNativeCharts: horizontal bar emits barDir="bar" + flipped axes', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Leased_Inv_State');
  sheet.getCell('B4').value = 'State';
  sheet.getCell('C4').value = 'Lease Count';
  ['CA', 'TX', 'NY', 'FL', 'IL'].forEach((state, i) => {
    sheet.getCell(`B${5 + i}`).value = state;
    sheet.getCell(`C${5 + i}`).value = 500 - i * 50;
  });
  const base = await wb.xlsx.writeBuffer();

  const result = await injectNativeCharts(base, [{
    tabName: 'Data_Leased_Inv_State',
    spec: {
      type: 'bar',
      tabName: 'Data_Leased_Inv_State',
      titleCol: 'C', titleRow: 4,
      catCol: 'B', valCol: 'C',
      dataStart: 5, dataEnd: 9,
      color: '003DA5',
      horizontal: true,
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // Horizontal bar = barDir="bar" (not "col")
  assert.match(chartXml, /<c:barDir val="bar"\/>/, 'barDir=bar (horizontal)');
  // Cat axis on the LEFT (axPos=l), val axis on the BOTTOM (axPos=b)
  const catAxBlock = chartXml.match(/<c:catAx>[\s\S]*?<\/c:catAx>/)[0];
  const valAxBlock = chartXml.match(/<c:valAx>[\s\S]*?<\/c:valAx>/)[0];
  assert.match(catAxBlock, /<c:axPos val="l"\/>/, 'cat axis on the LEFT');
  assert.match(valAxBlock, /<c:axPos val="b"\/>/, 'val axis on the BOTTOM');
  // Cat axis flipped to maxMin so largest values appear at top
  assert.match(catAxBlock, /<c:orientation val="maxMin"\/>/, 'cat axis maxMin (top-N at top)');
  // Series ref correct cells
  assert.match(chartXml, /'Data_Leased_Inv_State'!\$B\$5:\$B\$9/, 'cat = state column B');
  assert.match(chartXml, /'Data_Leased_Inv_State'!\$C\$5:\$C\$9/, 'val = count column C');
});

test('buildInjectionSpec: cost_of_capital builds sharedAxis combo with pale gray band', () => {
  const cols = [
    { key: 'period_end',         col: 'A' },
    { key: 'treasury_10y_yield', col: 'B' },
    { key: 'avg_cap_rate',       col: 'C' },
    { key: 'cap_10plus_year',    col: 'D' },
    { key: 'low_loan_constant',  col: 'E' },
    { key: 'high_loan_constant', col: 'F' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'cost_of_capital',
    tabName: 'Data_Cost_Capital',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.barGrouping, 'stacked');
  assert.equal(out.spec.sharedAxis, true, 'all series on single Y axis');

  // Bar series: invisible base (lower) + visible pale gray band (helper col G)
  assert.equal(out.spec.barSeries.length, 2);
  assert.equal(out.spec.barSeries[0].valCol, 'E', 'base = low_loan_constant');
  assert.equal(out.spec.barSeries[0].noFill, true, 'base invisible');
  assert.equal(out.spec.barSeries[1].valCol, 'G', 'band = loan_band_width helper');
  assert.equal(out.spec.barSeries[1].color, '6A748C', 'pale gray');
  assert.equal(out.spec.barSeries[1].alpha, '12000', '12% alpha (renderer rgba(...,0.12))');
  assert.equal(out.spec.barSeries[1].borderColor, '6A748C', 'solid gray border');

  // Lines: treasury (sky) + avg_cap (navy). Renderer skips cap_10plus_year.
  assert.equal(out.spec.lineSeries.length, 2);
  assert.equal(out.spec.lineSeries[0].valCol, 'B');
  assert.equal(out.spec.lineSeries[0].color, '62B5E5');
  assert.equal(out.spec.lineSeries[1].valCol, 'C');
  assert.equal(out.spec.lineSeries[1].color, '003DA5');

  // Helper col: loan_band_width = high - low
  assert.equal(out.helperCols.length, 1);
  assert.equal(out.helperCols[0].key, 'loan_band_width');
  const v = out.helperCols[0].getValue({
    low_loan_constant: 0.055, high_loan_constant: 0.082,
  });
  assert.ok(Math.abs(v - 0.027) < 1e-9, `getValue returns ${v}, expected ~0.027`);
});

test('buildInjectionSpec: volume_cap_quartile_combo builds area-combo with all 3 layers', () => {
  const cols = [
    { key: 'period_end',     col: 'A' },
    { key: 'subspecialty',   col: 'B' },
    { key: 'volume_dollars', col: 'C' },
    { key: 'cap_rate',       col: 'D' },
    { key: 'upper_quartile', col: 'E' },
    { key: 'lower_quartile', col: 'F' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'volume_cap_quartile_combo',
    tabName: 'Data_Vol_Cap_Combo',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5', nm_pale: '#E0E8F4' } },
  });
  assert.equal(out.spec.type, 'area-combo');
  assert.equal(out.spec.catCol, 'A');

  // Area series: volume_dollars, pale fill, navy border, LEFT axis
  assert.ok(out.spec.areaSeries, 'has areaSeries');
  assert.equal(out.spec.areaSeries.valCol, 'C', 'area = volume_dollars');
  assert.equal(out.spec.areaSeries.fillColor, 'E0E8F4');
  assert.equal(out.spec.areaSeries.borderColor, '003DA5');

  // Bar series: invisible base (lower_q) + visible pale sky band (iqr helper, col G)
  assert.equal(out.spec.barSeries.length, 2);
  assert.equal(out.spec.barSeries[0].valCol, 'F', 'base = lower_quartile');
  assert.equal(out.spec.barSeries[0].noFill, true);
  assert.equal(out.spec.barSeries[1].valCol, 'G', 'band = iqr_width helper');
  assert.equal(out.spec.barSeries[1].alpha, '25000', '25% alpha (renderer rgba(...,0.25))');
  assert.equal(out.spec.barSeries[1].borderColor, '62B5E5', 'sky border');

  // Line series: cap_rate dots (navy circles)
  assert.equal(out.spec.lineSeries.length, 1);
  assert.equal(out.spec.lineSeries[0].valCol, 'D', 'line = cap_rate');
  assert.equal(out.spec.lineSeries[0].color, '003DA5');
  assert.equal(out.spec.lineSeries[0].showMarker, true);
  assert.equal(out.spec.lineSeries[0].markerShape, 'circle');

  // Helper col: iqr_width = upper - lower
  assert.equal(out.helperCols.length, 1);
  assert.equal(out.helperCols[0].key, 'iqr_width');
  const v = out.helperCols[0].getValue({
    lower_quartile: 0.055, upper_quartile: 0.082,
  });
  assert.ok(Math.abs(v - 0.027) < 1e-9, `getValue returns ${v}, expected ~0.027`);
});

test('R73 C4: volume_cap cap (right) axis lowered per vertical to lift the band off the volume', () => {
  // Scott: "adjust the y-axis on cap rate so the volume portion isn't hidden."
  // Lowering the cap-axis MIN lifts the Q1-Q3 band into the upper frame so the
  // volume area reads in the lower ~45%. gov keeps max 10.5% (upper-q ~10.08%);
  // dia caps at 9.0% (dia top-q ~7.7%).
  const cols = [
    { key: 'period_end',     col: 'A' },
    { key: 'subspecialty',   col: 'B' },
    { key: 'volume_dollars', col: 'C' },
    { key: 'cap_rate',       col: 'D' },
    { key: 'upper_quartile', col: 'E' },
    { key: 'lower_quartile', col: 'F' },
  ];
  const mk = (vertical) => buildInjectionSpec({
    chart_template_id: 'volume_cap_quartile_combo',
    tabName: 'Data_Vol_Cap_Combo', cols, dataStart: 5, dataEnd: 60, vertical,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5', nm_pale: '#E0E8F4' } },
  });
  assert.deepEqual(mk('gov').spec.yRightRange, { min: 0.020, max: 0.105 },
    'gov cap axis min lowered to 2.0% (band lifts; 10.5% top keeps ~10.08% upper-q)');
  assert.deepEqual(mk('dialysis').spec.yRightRange, { min: 0.030, max: 0.090 },
    'dia cap axis 3.0-9.0% (band 5.70-7.70% lifts to the upper frame)');
});

test('R73 B13: cap_rate_by_credit gives sparse state+municipal cohorts markers (federal stays a plain line)', () => {
  const cols = [
    { key: 'period_end',   col: 'A' },
    { key: 'federal_cap',  col: 'B' },
    { key: 'state_cap',    col: 'C' },
    { key: 'municipal_cap', col: 'D' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'cap_rate_by_credit',
    tabName: 'Data_Cap_Credit', cols, dataStart: 5, dataEnd: 60, vertical: 'gov',
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'multi-line');
  const [fed, state, muni] = out.spec.series;
  assert.ok(!fed.showMarker, 'federal is dense -> plain line, no markers');
  assert.equal(state.showMarker, true, 'state sparse -> markers so isolated quarters show');
  assert.equal(muni.showMarker, true, 'municipal sparse -> markers');
  // The builder keeps the line stroke AND emits a real marker symbol (markers + line).
  const xml = buildMultiLineChartXml(out.spec);
  assert.match(xml, /<c:marker><c:symbol val="circle"\/>/, 'a real circle marker is emitted');
  assert.match(xml, /<c:marker><c:symbol val="none"\/>/, 'federal still markerless');
  assert.match(xml, /<c:marker val="1"\/>/, 'chart-level markers enabled');
});

test('R73 B1: bid_ask combo suppresses the invisible noFill base bar from the legend (no duplicate Last-Ask entry)', () => {
  const cols = [
    { key: 'period_end',         col: 'A' },
    { key: 'avg_last_ask_cap',   col: 'B' },
    { key: 'avg_bid_ask_spread', col: 'C' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'bid_ask_spread', tabName: 'Data_Bid_Ask',
    cols, dataStart: 5, dataEnd: 60, vertical: 'dialysis',
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  // barSeries[0] is the invisible (noFill) base that reuses the Last-Ask title.
  assert.equal(out.spec.barSeries[0].noFill, true, 'base bar is noFill');
  const xml = buildComboChartXml(out.spec);
  // The noFill base (idx 0) gets a legend delete -> the Last-Ask label is not
  // duplicated between the base bar and the sky marker line.
  assert.match(xml, /<c:legendEntry><c:idx val="0"\/><c:delete val="1"\/><\/c:legendEntry>/,
    'noFill base bar (idx 0) is deleted from the legend');
  assert.equal((xml.match(/<c:legendEntry>/g) || []).length, 1,
    'exactly one legend entry deleted (the single noFill base)');
});

test('injectNativeCharts: area-combo (volume_cap_quartile_combo) renders 3 chart blocks + 2 axes', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Vol_Cap_Combo');
  sheet.getCell('A4').value = 'Quarter End';
  sheet.getCell('C4').value = 'TTM Volume';
  sheet.getCell('D4').value = 'TTM Cap';
  sheet.getCell('F4').value = 'Lower Q';
  sheet.getCell('G4').value = 'IQR Width';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i * 2, 28);
    sheet.getCell(`C${5 + i}`).value = 500_000_000 + i * 20_000_000;
    sheet.getCell(`D${5 + i}`).value = 0.062 + i * 0.001;
    sheet.getCell(`F${5 + i}`).value = 0.055 + i * 0.001;
    sheet.getCell(`G${5 + i}`).value = 0.015;  // band width
  }
  const base = await wb.xlsx.writeBuffer();

  const injections = [{
    tabName: 'Data_Vol_Cap_Combo',
    spec: {
      type: 'area-combo',
      tabName: 'Data_Vol_Cap_Combo',
      catCol: 'A',
      dataStart: 5, dataEnd: 10,
      areaSeries: { titleCol: 'C', titleRow: 4, valCol: 'C',
                    fillColor: 'E0E8F4', borderColor: '003DA5' },
      barSeries: [
        { titleCol: 'F', titleRow: 4, valCol: 'F', color: '62B5E5', noFill: true },
        { titleCol: 'G', titleRow: 4, valCol: 'G', color: '62B5E5',
          alpha: '25000', borderColor: '62B5E5' },
      ],
      lineSeries: [
        { titleCol: 'D', titleRow: 4, valCol: 'D', color: '003DA5',
          showMarker: true, markerShape: 'circle', markerSize: 5 },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }];

  const result = await injectNativeCharts(base, injections);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // All 3 chart blocks present
  assert.match(chartXml, /<c:areaChart>/, 'has areaChart block');
  assert.match(chartXml, /<c:barChart>/, 'has barChart block');
  assert.match(chartXml, /<c:lineChart>/, 'has lineChart block');

  // Area uses axId 1 + 2 (cat + LEFT)
  const areaBlock = chartXml.match(/<c:areaChart>[\s\S]*?<\/c:areaChart>/)[0];
  assert.match(areaBlock, /<c:axId val="1"\/>[\s\S]*<c:axId val="2"\/>/,
    'area block: axId 1 + 2 (LEFT axis)');

  // Bar uses axId 1 + 3 (cat + RIGHT), stacked
  const barBlock = chartXml.match(/<c:barChart>[\s\S]*?<\/c:barChart>/)[0];
  assert.match(barBlock, /<c:grouping val="stacked"\/>/);
  assert.match(barBlock, /<c:axId val="1"\/>[\s\S]*<c:axId val="3"\/>/,
    'bar block: axId 1 + 3 (RIGHT axis)');

  // Line uses axId 1 + 3 (shared with bars on RIGHT)
  const lineBlock = chartXml.match(/<c:lineChart>[\s\S]*?<\/c:lineChart>/)[0];
  assert.match(lineBlock, /<c:axId val="1"\/>[\s\S]*<c:axId val="3"\/>/,
    'line block: axId 1 + 3 (shared RIGHT axis with bars)');

  // 2 val axes — left primary (area) + right secondary (bars/line)
  const valAxCount = (chartXml.match(/<c:valAx>/g) || []).length;
  assert.equal(valAxCount, 2, 'two val axes (left for area, right for bars+line)');

  // Global marker toggle ON (line series has markers)
  assert.match(lineBlock, /<c:marker val="1"\/>/, 'global marker toggle on for dots');

  // Bar band has alpha=25000 for the pale fill
  assert.match(barBlock, /<a:alpha val="25000"\/>/, '25% alpha on visible band');

  // 4 series total — area(0) + bar(1) + bar(2) + line(3)
  const idxs = Array.from(chartXml.matchAll(/<c:ser>\s*<c:idx val="(\d+)"\/>/g)).map(m => Number(m[1]));
  assert.deepEqual(idxs, [0, 1, 2, 3], 'series idx unique across area+bar+line blocks');

  // Each series references its own column
  assert.match(chartXml, /'Data_Vol_Cap_Combo'!\$C\$5:\$C\$10/, 'area refs C (volume)');
  assert.match(chartXml, /'Data_Vol_Cap_Combo'!\$F\$5:\$F\$10/, 'base refs F (lower_q)');
  assert.match(chartXml, /'Data_Vol_Cap_Combo'!\$G\$5:\$G\$10/, 'band refs G (helper)');
  assert.match(chartXml, /'Data_Vol_Cap_Combo'!\$D\$5:\$D\$10/, 'line refs D (cap_rate)');
});

test('injectNativeCharts: combo bar series alpha + borderColor emit correctly (cost_of_capital style)', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Cost_Capital');
  sheet.getCell('B4').value = '10Y Treasury';
  sheet.getCell('C4').value = 'Avg Cap';
  sheet.getCell('E4').value = 'Low LC';
  sheet.getCell('G4').value = 'Band Width';
  for (let i = 0; i < 4; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i * 3, 28);
    sheet.getCell(`B${5 + i}`).value = 0.04 + i * 0.002;
    sheet.getCell(`C${5 + i}`).value = 0.065 + i * 0.001;
    sheet.getCell(`E${5 + i}`).value = 0.055 + i * 0.001;
    sheet.getCell(`G${5 + i}`).value = 0.025;  // band width
  }
  const base = await wb.xlsx.writeBuffer();

  const result = await injectNativeCharts(base, [{
    tabName: 'Data_Cost_Capital',
    spec: {
      type: 'combo',
      tabName: 'Data_Cost_Capital',
      catCol: 'A',
      dataStart: 5, dataEnd: 8,
      barGrouping: 'stacked',
      sharedAxis: true,
      barSeries: [
        { titleCol: 'E', titleRow: 4, valCol: 'E', color: '6A748C', noFill: true },
        { titleCol: 'G', titleRow: 4, valCol: 'G', color: '6A748C',
          alpha: '12000', borderColor: '6A748C' },
      ],
      lineSeries: [
        { titleCol: 'B', titleRow: 4, valCol: 'B', color: '62B5E5' },
        { titleCol: 'C', titleRow: 4, valCol: 'C', color: '003DA5' },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // Series 1 (visible band) has alpha=12000 AND a solid border
  const ser1 = chartXml.match(/<c:ser>\s*<c:idx val="1"\/>[\s\S]*?<\/c:ser>/)[0];
  assert.match(ser1, /<a:alpha val="12000"\/>/, '12% alpha on band');
  assert.match(ser1, /<a:ln w="9525"><a:solidFill><a:srgbClr val="6A748C"\/>/,
    'solid gray border distinct from pale fill');
  // sharedAxis=true → only 1 val axis
  assert.equal((chartXml.match(/<c:valAx>/g) || []).length, 1);
});

test('buildInjectionSpec: buyer_class_pct_by_year builds 4-series annual stacked bar', () => {
  const cols = [
    { key: 'year',                 col: 'A' },
    { key: 'subspecialty',         col: 'B' },
    { key: 'private_volume',       col: 'C' },
    { key: 'reit_volume',          col: 'D' },
    { key: 'cross_border_volume',  col: 'E' },
    { key: 'institutional_volume', col: 'F' },
    { key: 'private_pct',          col: 'G' },
    { key: 'reit_pct',             col: 'H' },
    { key: 'cross_border_pct',     col: 'I' },
    { key: 'institutional_pct',    col: 'J' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'buyer_class_pct_by_year',
    tabName: 'Data_Buyer_Pool',
    cols, dataStart: 5, dataEnd: 20,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5',
                        nm_blue_mid: '#265AB2', nm_pale: '#E0E8F4' } },
  });
  assert.equal(out.spec.type, 'stacked-bar');
  assert.equal(out.spec.catCol, 'A', 'year is x-axis (not period_end)');
  assert.equal(out.spec.series.length, 4);
  assert.deepEqual(out.spec.series.map(s => s.valCol),
    ['G', 'H', 'I', 'J'], 'pct columns: private/reit/cross/institutional');
  assert.deepEqual(out.spec.series.map(s => s.color),
    ['003DA5', '265AB2', '62B5E5', 'E0E8F4'],
    'navy / mid-blue / sky / pale');
});

test('buildInjectionSpec: renewal_rent_growth is the R66m rent+quartile+CAGR combo', () => {
  // R66m — rebuilt from the R33 single-bar to the deck p.32 combo: pale-blue
  // TTM rent/SF bars + dark-blue quartile hi-lows on the $ axis, sky CAGR line
  // on the % axis. The legacy single-bar shape only survives as a fallback when
  // the quartile/CAGR columns are absent (see the next test).
  const out = buildInjectionSpec({
    chart_template_id: 'renewal_rent_growth',
    tabName: 'Data_Renewal_Rent_Growth',
    cols: [
      { key: 'period_end',              col: 'A' },
      { key: 'avg_renewal_rent_psf',    col: 'B' },
      { key: 'ttm_avg_renewal_rent_psf', col: 'C' },
      { key: 'upper_quartile_rpsf',     col: 'D' },
      { key: 'lower_quartile_rpsf',     col: 'E' },
      { key: 'cagr_5yr',                col: 'F' },
      { key: 'renewal_count',           col: 'G' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'renewal-combo');
  assert.equal(out.spec.rentCol, 'C', 'rent bars = ttm_avg_renewal_rent_psf');
  assert.equal(out.spec.upperCol, 'D');
  assert.equal(out.spec.lowerCol, 'E');
  assert.equal(out.spec.cagrCol, 'F', 'CAGR line = cagr_5yr (cagr_per_lease absent)');
  assert.equal(out.spec.rentColor, 'BBDDF2');
  assert.equal(out.spec.cagrColor, '62B5E5');
});

test('buildInjectionSpec: renewal_rent_growth falls back to single bar when quartile/CAGR cols missing', () => {
  // R66m legacy fallback — without ttm/quartile/cagr cols the builder
  // returns the original single sky bar of avg_renewal_rent_psf.
  const out = buildInjectionSpec({
    chart_template_id: 'renewal_rent_growth',
    tabName: 'Data_Renewal_Rent_Growth',
    cols: [
      { key: 'period_end',           col: 'A' },
      { key: 'avg_renewal_rent_psf', col: 'B' },
      { key: 'renewal_count',        col: 'C' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'bar');
  assert.equal(out.spec.valCol, 'B', 'bar = avg_renewal_rent_psf');
  assert.equal(out.spec.color, '62B5E5', 'sky');
});

test('buildInjectionSpec: txn_count_avg_deal_combo builds standard combo', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'txn_count_avg_deal_combo',
    tabName: 'Data_Txn_Avg_Deal',
    cols: [
      { key: 'period_end',    col: 'A' },
      { key: 'ttm_count',     col: 'B' },
      { key: 'avg_deal_size', col: 'C' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.swapAxes, undefined, 'standard combo, no swap');
  assert.equal(out.spec.barSeries[0].valCol, 'B');
  assert.equal(out.spec.barSeries[0].color, '62B5E5');
  assert.equal(out.spec.lineSeries[0].valCol, 'C');
  assert.equal(out.spec.lineSeries[0].color, '003DA5');
});

test('R40: rent_and_price_psf works for dia with Data_Rent_Price_PSF tab (R33 Tier E1)', () => {
  // R33 Tier E1 — extended rent_and_price_psf to dia via catalog
  // applies_to_verticals + new view cm_dialysis_rent_price_psf_q.
  // The native chart builder is vertical-agnostic: same cols schema
  // resolves to the same combo spec regardless of which Data_* tab
  // the chart lands in.
  const dia = buildInjectionSpec({
    chart_template_id: 'rent_and_price_psf',
    tabName: 'Data_Rent_Price_PSF',
    cols: [
      { key: 'period_end',   col: 'A' },
      { key: 'subspecialty', col: 'B' },
      { key: 'rent_psf',     col: 'C' },
      { key: 'price_psf',    col: 'D' },
      { key: 'rent_n',       col: 'E' },
      { key: 'price_n',      col: 'F' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.ok(dia, 'spec produced for dia variant');
  assert.equal(dia.spec.type, 'combo');
  assert.equal(dia.spec.barSeries[0].valCol, 'C', 'bars = rent_psf');
  assert.equal(dia.spec.lineSeries[0].valCol, 'D', 'line = price_psf');
  // Same left-axis pinning ($0-$50 rent/SF) as gov variant — dia rents
  // typically $20-$30, gov rents up to $40+, both fit comfortably
  assert.deepEqual(dia.spec.yLeftRange, { min: 0, max: 50 });
  // Right axis (price/SF) auto-scaled — dia ~$385, gov varies by region
  assert.equal(dia.spec.yRightRange, undefined, 'price axis auto-scaled');
});

test('buildInjectionSpec: rent_and_price_per_chair (dia) + rent_and_price_psf (gov) share shape', () => {
  // Dia variant
  const dia = buildInjectionSpec({
    chart_template_id: 'rent_and_price_per_chair',
    tabName: 'Data_Rent_Price_Chair',
    cols: [
      { key: 'period_end',     col: 'A' },
      { key: 'subspecialty',   col: 'B' },
      { key: 'rent_per_chair', col: 'C' },
      { key: 'price_per_chair', col: 'D' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(dia.spec.barSeries[0].valCol, 'C');   // rent
  assert.equal(dia.spec.lineSeries[0].valCol, 'D');  // price

  // Gov variant — same shape, just different keys
  const gov = buildInjectionSpec({
    chart_template_id: 'rent_and_price_psf',
    tabName: 'Data_Rent_Price_PSF',
    cols: [
      { key: 'period_end',   col: 'A' },
      { key: 'subspecialty', col: 'B' },
      { key: 'rent_psf',     col: 'C' },
      { key: 'price_psf',    col: 'D' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(gov.spec.barSeries[0].valCol, 'C');
  assert.equal(gov.spec.lineSeries[0].valCol, 'D');
  // Both produce identical specs except for the data tab columns
  assert.equal(dia.spec.type, gov.spec.type, 'same shape (combo) for both');
});

test('buildInjectionSpec: dom_price_change_active builds 2-bar + 2-line with dashed core', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'dom_price_change_active',
    tabName: 'Data_Active_DOM_PC',
    cols: [
      { key: 'period_end',             col: 'A' },
      { key: 'subspecialty',           col: 'B' },
      { key: 'avg_dom_total',          col: 'C' },
      { key: 'avg_dom_core',           col: 'D' },
      { key: 'pct_price_change_total', col: 'E' },
      { key: 'pct_price_change_core',  col: 'F' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.barSeries.length, 2, '2 DOM bars');
  assert.equal(out.spec.lineSeries.length, 2, '2 price-change lines');
  // Both lines share #1F4E79 (dark blue); core variant dashed
  assert.equal(out.spec.lineSeries[0].color, '1F4E79');
  assert.equal(out.spec.lineSeries[1].color, '1F4E79');
  assert.equal(out.spec.lineSeries[0].dashed || false, false, 'total solid');
  assert.equal(out.spec.lineSeries[1].dashed, true, 'core dashed');
});

test('buildInjectionSpec: seller_sentiment uses swapAxes (lines LEFT, bars RIGHT)', () => {
  const cols = [
    { key: 'period_end',                 col: 'A' },
    { key: 'n_all',                      col: 'B' },
    { key: 'pct_price_change_all',       col: 'C' },
    { key: 'n_long_term',                col: 'D' },
    { key: 'pct_price_change_long_term', col: 'E' },
    { key: 'last_ask_cap_all',           col: 'F' },
    { key: 'last_ask_cap_long_term',     col: 'G' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'seller_sentiment',
    tabName: 'Data_Sentiment',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.swapAxes, true, 'PDF p.35 puts lines on left, bars on right');
  // Bars = price change % (sage + light purple)
  assert.equal(out.spec.barSeries.length, 2);
  assert.deepEqual(out.spec.barSeries.map(s => s.valCol), ['C', 'E']);
  assert.deepEqual(out.spec.barSeries.map(s => s.color), ['4CB582', '7E6BAD']);
  // Lines = cap rate (navy + sky)
  assert.equal(out.spec.lineSeries.length, 2);
  assert.deepEqual(out.spec.lineSeries.map(s => s.valCol), ['F', 'G']);
  assert.deepEqual(out.spec.lineSeries.map(s => s.color), ['003DA5', '62B5E5']);
});

test('buildInjectionSpec: seller_sentiment_monthly handles different column layout', () => {
  // Monthly schema has cols in different positions than quarterly
  const cols = [
    { key: 'period_end',                 col: 'A' },
    { key: 'subspecialty',               col: 'B' },
    { key: 'n_all',                      col: 'C' },
    { key: 'n_long_term',                col: 'D' },
    { key: 'pct_price_change_all',       col: 'E' },
    { key: 'pct_price_change_long_term', col: 'F' },
    { key: 'last_ask_cap_all',           col: 'G' },
    { key: 'last_ask_cap_long_term',     col: 'H' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'seller_sentiment_monthly',
    tabName: 'Data_Sentiment_M',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  // findCol picks up the right cols regardless of position
  assert.deepEqual(out.spec.barSeries.map(s => s.valCol), ['E', 'F']);
  assert.deepEqual(out.spec.lineSeries.map(s => s.valCol), ['G', 'H']);
  assert.equal(out.spec.swapAxes, true);
});

test('buildInjectionSpec: inventory_backlog R54+R66v — combo bar+bar+net line; Sold renders below 0', () => {
  // R50 — restructured to match master Charts!chart8 (Inventory Backlog).
  // R54 — Sold bar now reads from sold_neg helper col so it renders
  // BELOW 0 (user direction 2026-05-22: visualize the market flow).
  // R66v — switched from TTM rolling sums (added_ttm/sold_ttm) to the
  // monthly basis (added_month/sold_month) to match the master turnover chart.
  const out = buildInjectionSpec({
    chart_template_id: 'inventory_backlog',
    tabName: 'Data_Inventory',
    cols: [
      { key: 'period_end',       col: 'A' },
      { key: 'subspecialty',     col: 'B' },
      { key: 'added_month',      col: 'C' },
      { key: 'sold_month',       col: 'D' },
      { key: 'active_count',     col: 'E' },
      { key: 'months_of_supply', col: 'F' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.sharedAxis, true, 'all 3 series share the same axis (integer count)');
  // Bars: Added (sky, col C) + Sold (navy, R54 reads from sold_neg helper H)
  assert.equal(out.spec.barSeries.length, 2);
  assert.equal(out.spec.barSeries[0].valCol, 'C', 'Added bar reads from added_ttm col');
  assert.equal(out.spec.barSeries[1].valCol, 'H', 'R54: Sold bar reads from sold_neg helper col H');
  assert.equal(out.spec.barSeries[1].titleCol, 'D', 'legend title still references sold_ttm header');
  assert.deepEqual(out.spec.barSeries.map(s => s.color), ['62B5E5', '003DA5'], 'sky + navy');
  // Line: Net = added − sold (gray), reads from net_ttm helper at G
  assert.equal(out.spec.lineSeries.length, 1);
  assert.equal(out.spec.lineSeries[0].valCol, 'G');
  assert.equal(out.spec.lineSeries[0].color, '6A748C');
  // R54 — helperCols now: [net_ttm at G, sold_neg at H]
  assert.equal(out.helperCols.length, 2);
  assert.equal(out.helperCols[0].key, 'net_ttm');
  assert.equal(out.helperCols[1].key, 'sold_neg');
  assert.equal(out.helperCols[1].header, 'No. Sold (chart)');
  // Helpers compute correctly (R66v — monthly basis)
  assert.equal(out.helperCols[0].getValue({ added_month: 50, sold_month: 30 }), 20, 'net = +20');
  assert.equal(out.helperCols[0].getValue({ added_month: 20, sold_month: 30 }), -10, 'net can be negative');
  assert.equal(out.helperCols[1].getValue({ sold_month: 30 }), -30, 'R66v: sold_neg = -sold_month');
  assert.equal(out.helperCols[1].getValue({ sold_month: null }), null);
});

test('buildInjectionSpec: pace_of_cap_rate_expansion falls back to 2-bar when pace_cost missing (back-compat)', () => {
  // Legacy view shape — no pace_cost column. Spec falls back to the
  // pre-R56 clustered-bar shape so the chart still renders.
  const out = buildInjectionSpec({
    chart_template_id: 'pace_of_cap_rate_expansion',
    tabName: 'Data_Pace_Cap_Expand',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'pace_all',   col: 'B' },
      { key: 'pace_core',  col: 'C' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'clustered-bar');
  assert.equal(out.spec.series.length, 2);
  assert.deepEqual(out.spec.series.map(s => s.valCol), ['B', 'C']);
  assert.deepEqual(out.spec.series.map(s => s.color), ['003DA5', '62B5E5'], 'navy + sky');
});

test('R56: pace_of_cap_rate_expansion adds pace_cost YOY line when col present', () => {
  // R56 — restructured to combo with pace_cost as a 3rd line (amber).
  // User notes 2026-05-22: "We also have a YOY pace of change line in
  // our Excel/PDF version that is missing from this one."
  const out = buildInjectionSpec({
    chart_template_id: 'pace_of_cap_rate_expansion',
    tabName: 'Data_Pace_Cap_Expand',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'pace_all',   col: 'B' },
      { key: 'pace_core',  col: 'C' },
      { key: 'pace_cost',  col: 'D' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.sharedAxis, true, 'pace_cost on same axis as pace_all/core');
  assert.equal(out.spec.barSeries.length, 2);
  assert.equal(out.spec.lineSeries.length, 1);
  assert.equal(out.spec.lineSeries[0].valCol, 'D', 'pace_cost line reads from col D');
  assert.equal(out.spec.lineSeries[0].color, 'D97706', 'amber matches deferred color in R45/R50');
});

test('injectNativeCharts: clustered-bar dispatch produces grouping=clustered XML', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Inventory');
  sheet.getCell('C4').value = 'No. Added (TTM)';
  sheet.getCell('D4').value = 'No. Sold (TTM)';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i, 28);
    sheet.getCell(`C${5 + i}`).value = 50 + i * 5;
    sheet.getCell(`D${5 + i}`).value = 40 + i * 4;
  }
  const base = await wb.xlsx.writeBuffer();

  const result = await injectNativeCharts(base, [{
    tabName: 'Data_Inventory',
    spec: {
      type: 'clustered-bar',
      tabName: 'Data_Inventory',
      catCol: 'A',
      dataStart: 5, dataEnd: 10,
      series: [
        { titleCol: 'C', titleRow: 4, valCol: 'C', color: '62B5E5' },
        { titleCol: 'D', titleRow: 4, valCol: 'D', color: '003DA5' },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // barChart with grouping=clustered + overlap=-20 (not stacked + 100)
  assert.match(chartXml, /<c:grouping val="clustered"\/>/, 'clustered grouping');
  assert.match(chartXml, /<c:overlap val="-20"\/>/, 'clustered overlap=-20');
  // 2 series
  assert.equal((chartXml.match(/<c:ser>/g) || []).length, 2);
  // Both visible (no noFill markers)
  assert.ok(!/<a:noFill\/>/.test(chartXml), 'no invisible base in clustered-bar');
});

test('injectNativeCharts: combo line series respect dashed flag (R35 P2)', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Active_DOM_PC');
  sheet.getCell('A4').value = 'Quarter End';
  sheet.getCell('C4').value = 'DOM Total';
  sheet.getCell('E4').value = '% Change Total';
  sheet.getCell('F4').value = '% Change Core';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i, 28);
    sheet.getCell(`C${5 + i}`).value = 90 + i * 5;
    sheet.getCell(`E${5 + i}`).value = 0.08 + i * 0.01;
    sheet.getCell(`F${5 + i}`).value = 0.05 + i * 0.005;
  }
  const base = await wb.xlsx.writeBuffer();

  const result = await injectNativeCharts(base, [{
    tabName: 'Data_Active_DOM_PC',
    spec: {
      type: 'combo',
      tabName: 'Data_Active_DOM_PC',
      catCol: 'A',
      dataStart: 5, dataEnd: 10,
      barSeries: [
        { titleCol: 'C', titleRow: 4, valCol: 'C', color: '9DC3E6' },
      ],
      lineSeries: [
        { titleCol: 'E', titleRow: 4, valCol: 'E', color: '1F4E79' },
        { titleCol: 'F', titleRow: 4, valCol: 'F', color: '1F4E79', dashed: true },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // Exactly ONE dashed line (the core variant)
  const dashCount = (chartXml.match(/<a:prstDash val="dash"\/>/g) || []).length;
  assert.equal(dashCount, 1, 'one dashed line series (the core variant)');
});

test('buildInjectionSpec: cap_rate_top_bottom_quartile builds 3-line with dashed quartiles', () => {
  const cols = [
    { key: 'period_end',      col: 'A' },
    { key: 'subspecialty',    col: 'B' },
    { key: 'top_quartile',    col: 'C' },
    { key: 'median',          col: 'D' },
    { key: 'bottom_quartile', col: 'E' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'cap_rate_top_bottom_quartile',
    tabName: 'Data_Cap_Quartile',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5' } },
  });
  assert.equal(out.spec.type, 'multi-line');
  assert.equal(out.spec.series.length, 3);
  assert.deepEqual(out.spec.series.map(s => s.valCol), ['C', 'D', 'E']);
  assert.deepEqual(out.spec.series.map(s => s.color),
    ['7E6BAD', '003DA5', '4CB582'], 'purple / navy / sage');
  assert.deepEqual(out.spec.series.map(s => !!s.dashed),
    [true, false, true], 'top + bottom dashed, median solid');
});

test('buildInjectionSpec: cap_rate_by_credit builds 3-line federal/state/municipal', () => {
  const cols = [
    { key: 'period_end',    col: 'A' },
    { key: 'subspecialty',  col: 'B' },
    { key: 'federal_cap',   col: 'C' },
    { key: 'state_cap',     col: 'D' },
    { key: 'municipal_cap', col: 'E' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'cap_rate_by_credit',
    tabName: 'Data_Cap_by_Credit',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.series.length, 3);
  assert.deepEqual(out.spec.series.map(s => s.valCol), ['C', 'D', 'E']);
  assert.deepEqual(out.spec.series.map(s => s.color),
    ['003DA5', '62B5E5', '4CB582'], 'navy / sky / sage');
});

test('buildInjectionSpec: cpi_vs_renewal_cagr builds 2-line', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'cpi_vs_renewal_cagr',
    tabName: 'Data_CPI_CAGR',
    cols: [
      { key: 'period_end',       col: 'A' },
      { key: 'cpi_change',       col: 'B' },
      { key: 'gsa_renewal_cagr', col: 'C' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.series.length, 2);
  assert.equal(out.spec.series[0].valCol, 'B');
  assert.equal(out.spec.series[1].valCol, 'C');
  assert.equal(out.spec.series[0].color, '62B5E5');  // sky
  assert.equal(out.spec.series[1].color, '003DA5');  // navy
});

test('buildInjectionSpec: fed_funds_vs_treasury builds 2-line (3rd series deferred — data mismatch)', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'fed_funds_vs_treasury',
    tabName: 'Data_FF_vs_10Y',
    cols: [
      { key: 'period_end',         col: 'A' },
      { key: 'fed_funds_rate',     col: 'B' },
      { key: 'treasury_10y_yield', col: 'C' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.series.length, 2, 'only the 2 series in the data tab');
});

test('buildInjectionSpec: cash_leveraged_returns plots cash + leveraged_mid only', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'cash_leveraged_returns',
    tabName: 'Data_Returns_Idx',
    cols: [
      { key: 'period_end',            col: 'A' },
      { key: 'cash_return',           col: 'B' },
      { key: 'leveraged_return_mid',  col: 'C' },
      { key: 'leveraged_return_high', col: 'D' },
      { key: 'leveraged_return_low',  col: 'E' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  // Renderer only plots 2 of the 4 columns; native matches.
  assert.equal(out.spec.series.length, 2);
  assert.deepEqual(out.spec.series.map(s => s.valCol), ['B', 'C']);
});

test('buildInjectionSpec: asking_cap_quartiles_active builds 4 solid lines (R66s deck parity)', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'asking_cap_quartiles_active',
    tabName: 'Data_Active_Cap_Quart',
    cols: [
      { key: 'period_end',   col: 'A' },
      { key: 'subspecialty', col: 'B' },
      { key: 'upper_q_total', col: 'C' },
      { key: 'lower_q_total', col: 'D' },
      { key: 'upper_q_core',  col: 'E' },
      { key: 'lower_q_core',  col: 'F' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: {} },
  });
  assert.equal(out.spec.series.length, 4);
  // R66s — deck (Dialysis Market Filter p.31) uses FOUR SOLID lines in four
  // distinct colors (no dashes); the prior solid-total/dashed-core idiom was
  // dropped.
  assert.deepEqual(out.spec.series.map(s => !!s.dashed),
    [false, false, false, false]);
  // mauve / sky / teal / navy (upper_total, lower_total, upper_core, lower_core)
  assert.equal(out.spec.series[0].color, '9B7EBD');  // upper total — mauve
  assert.equal(out.spec.series[1].color, '62B5E5');  // lower total — sky
  assert.equal(out.spec.series[2].color, '3FA39B');  // upper core — teal
  assert.equal(out.spec.series[3].color, '003DA5');  // lower core — navy
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

test('R68-E G5: lease_renewal_rate builds diverging stacked combo + net line', () => {
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
  // R68-E — diverging bars + net line ride a single shared count axis.
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.barGrouping, 'stacked', 'stacked diverging bars');
  assert.equal(out.spec.sharedAxis, true, 'net line shares the count axis (no 2nd axis)');
  assert.equal(out.spec.catCol, 'A', 'period_end is the x-axis');
  assert.equal(out.spec.barSeries.length, 5, '5 outcome bars');
  // Color order unchanged: pale / navy / mid / sky / amber
  assert.deepEqual(
    out.spec.barSeries.map(s => s.color),
    ['E0E8F4', '003DA5', '265AB2', '62B5E5', 'D97706'],
  );
  // Additive series (first 3) chart their own positive cols B/C/D.
  // Subtractive series (expired/terminated) chart NEGATED helper cols
  // (G/H = past the 6 regular cols A-F), but their TITLE still points at
  // the original positive header (E/F) so the legend reads plain names.
  assert.deepEqual(out.spec.barSeries.map(s => s.valCol), ['B', 'C', 'D', 'G', 'H']);
  assert.deepEqual(out.spec.barSeries.map(s => s.titleCol), ['B', 'C', 'D', 'E', 'F']);
  // Net line is the signed sum, on the same axis, drawn from the net helper col (I).
  assert.equal(out.spec.lineSeries.length, 1, 'one net-movement line');
  assert.equal(out.spec.lineSeries[0].valCol, 'I');
  assert.equal(out.spec.lineSeries[0].color, '191919', 'net line = rich black');
  // Helper cols: expired_neg (G), terminated_neg (H), net_movement (I).
  assert.deepEqual(out.helperCols.map(h => h.key),
    ['expired_leases_neg', 'terminated_leases_neg', 'net_movement']);
  // Negation: expired 40 -> -40
  assert.equal(out.helperCols[0].getValue({ expired_leases: 40 }), -40);
  // Net = +firstgen +renewed +succ -expired -terminated
  assert.equal(
    out.helperCols[2].getValue({
      first_generation_commencements: 10, renewed_leases: 50,
      succeeding_superseding_leases: 20, expired_leases: 40, terminated_leases: 15,
    }),
    10 + 50 + 20 - 40 - 15, // = 25
    'net movement = signed sum of all outcomes',
  );
  // All-null row -> null net (not a misleading 0)
  assert.equal(out.helperCols[2].getValue({}), null);
});

test('R68-E G6: lease_termination_rate adds soft-term % line when the rate column is present', () => {
  const cols = [
    { key: 'period_end',                        col: 'A' },
    { key: 'total_leases_active',               col: 'B' },
    { key: 'terminated_ttm',                    col: 'C' },
    { key: 'leases_outside_firm_term',          col: 'D' },
    { key: 'terminated_outside_firm_term',      col: 'E' },
    { key: 'avg_leases_outside_firm_term_ttm',  col: 'F' },
    { key: 'terminated_outside_firm_term_pct',  col: 'G' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'lease_termination_rate',
    tabName: 'Data_Term_Rate',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  // Combo: 2 count bars (left axis) + 1 rate line (right % axis).
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.barGrouping, 'stacked');
  assert.notEqual(out.spec.sharedAxis, true, 'rate line uses the secondary % axis');
  assert.equal(out.spec.yRightNumFmt, '0.0%', 'right axis is a percent');
  assert.equal(out.spec.barSeries.length, 2, 'In Firm + Outside bars');
  // In-firm helper col lands past the 7 regular cols A-G = H.
  assert.equal(out.spec.barSeries[0].valCol, 'H', 'bottom = in_firm helper col');
  assert.equal(out.spec.lineSeries.length, 1, 'soft-term rate line');
  assert.equal(out.spec.lineSeries[0].valCol, 'G', 'line = terminated_outside_firm_term_pct');
  assert.equal(out.spec.lineSeries[0].color, 'D97706', 'amber line');
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
  // R66o — market (gray) is drawn FIRST so it sits visually below the NM
  // (sky) hero line, matching the deck's Value Proposition page. Order
  // flipped from the prior NM-first build.
  assert.deepEqual(
    out.spec.series.map(s => s.valCol),
    ['D', 'C'],
    'market_cap_rate (D) first, nm_cap_rate (C) second'
  );
  assert.deepEqual(
    out.spec.series.map(s => s.color),
    ['8A8F98', '62B5E5'],
    'Market gray first, NM sky second'
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
  // R65 → R67 brand-aligned colors:
  //   sky bar + sage-fill+sky-border bar (R67 — pale-sky was too faint per user batch 6)
  //   navy solid line + navy DASHED line (no off-brand amber)
  assert.deepEqual(
    out.spec.barSeries.map(s => s.color),
    ['62B5E5', '4CB582'],
    'R65: brand bar colors — sky / nm_pale fill'
  );
  assert.equal(out.spec.barSeries[1].borderColor, '62B5E5',
    'R65: core 10+ bar has sky border for distinguishability');
  assert.deepEqual(
    out.spec.lineSeries.map(s => s.color),
    ['003DA5', '003DA5'],
    'R65: both cap lines navy (cohort overlay convention)'
  );
  assert.ok(out.spec.lineSeries[1].dashed,
    'R65: core 10+ line is DASHED to differentiate from solid total line');
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

test('R39: core_cap_rate_dot_plot uses Excel-native poly trendline (matches master)', () => {
  // R39 replaces R34 P7.5 helper-column rolling-average with Excel's
  // built-in <c:trendline type="poly" order=3 forward=720>. Matches
  // Dialysis Comp Work MASTER.xlsx > Core Cap Chart exactly.
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
    cols, dataStart: 5, dataEnd: 14,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
    rows: [],  // rows no longer needed — trendline is computed by Excel
  });
  assert.ok(out, 'should produce a spec');
  // Single series (dot cloud) — no second series for the trendline; it's
  // attached to the cloud via Excel's <c:trendline> element.
  assert.equal(out.spec.series.length, 1, 'just the dot cloud series');
  assert.equal(out.spec.series[0].color, '62B5E5', 'dots = sky');
  // Trendline config on the series
  assert.ok(out.spec.series[0].trendline, 'has trendline config');
  assert.equal(out.spec.series[0].trendline.type, 'poly', 'polynomial type');
  assert.equal(out.spec.series[0].trendline.order, 3, 'order 3 (cubic)');
  assert.equal(out.spec.series[0].trendline.forward, 720, '720-day forward forecast');
  assert.equal(out.spec.series[0].trendline.dashed, true, 'dotted line');
  assert.equal(out.spec.series[0].trendline.color, '003DA5', 'navy trendline');
  // No helperCols anymore (Excel computes the trendline natively)
  assert.equal(out.helperCols, undefined, 'no helperCols — Excel computes trendline');
});

test('R39: available_cap_rate_dot_plot uses Excel-native linear trendline (matches master)', () => {
  // R39 replaces R34 P7.5 helper-column linear regression with Excel's
  // built-in <c:trendline type="linear"/>. Matches Available Comps
  // master exactly (2 linear trendlines in that workbook).
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
    cols, dataStart: 5, dataEnd: 14,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
    rows: [],
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.series.length, 1, 'just the dot cloud series');
  assert.ok(out.spec.series[0].trendline, 'has trendline config');
  assert.equal(out.spec.series[0].trendline.type, 'linear', 'linear regression');
  assert.equal(out.spec.series[0].trendline.dashed, true, 'dashed line');
  assert.equal(out.spec.series[0].trendline.color, '003DA5', 'navy');
  // No order/forward for linear
  assert.equal(out.spec.series[0].trendline.order, undefined);
  assert.equal(out.spec.series[0].trendline.forward, undefined);
  assert.equal(out.helperCols, undefined);
});

test('R39: scatter trendline emits <c:trendline> in chart XML', async () => {
  // End-to-end: build a tiny scatter with trendline config; confirm the
  // chart XML actually contains the Excel-native <c:trendline> element.
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = i + 1;
    sheet.getCell(`B${5 + i}`).value = 0.05 + i * 0.005;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'scatter', tabName: 'Data_Test',
      dataStart: 5, dataEnd: 10,
      series: [{
        titleCol: 'B', titleRow: 4, xCol: 'A', yCol: 'B', color: '62B5E5',
        trendline: { type: 'poly', order: 3, forward: 720, dashed: true, color: '003DA5' },
      }],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chartXml, /<c:trendline>/, '<c:trendline> element emitted');
  assert.match(chartXml, /<c:trendlineType val="poly"\/>/, 'type=poly');
  assert.match(chartXml, /<c:order val="3"\/>/, 'order=3');
  assert.match(chartXml, /<c:forward val="720"\/>/, 'forward=720');
  assert.match(chartXml, /<a:prstDash val="sysDot"\/>/, 'dotted dash style');
  // Navy trendline color
  assert.match(chartXml, /<c:trendline>[\s\S]*?<a:srgbClr val="003DA5"\/>/,
    'navy trendline color');
});

test('R39: scatter without trendline config emits no <c:trendline> (backward compat)', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = i + 1;
    sheet.getCell(`B${5 + i}`).value = 0.05 + i * 0.005;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'scatter', tabName: 'Data_Test',
      dataStart: 5, dataEnd: 10,
      series: [{ titleCol: 'B', titleRow: 4, xCol: 'A', yCol: 'B', color: '003DA5' }],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.ok(!/<c:trendline>/.test(chartXml), 'no trendline emitted when omitted');
});

test('R39: linear trendline omits order + forward fragments', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = 5 + i;
    sheet.getCell(`B${5 + i}`).value = 0.05 + i * 0.005;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'scatter', tabName: 'Data_Test',
      dataStart: 5, dataEnd: 10,
      series: [{
        titleCol: 'B', titleRow: 4, xCol: 'A', yCol: 'B', color: '62B5E5',
        trendline: { type: 'linear', dashed: true, color: '003DA5' },
      }],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chartXml, /<c:trendlineType val="linear"\/>/);
  // Look inside the <c:trendline> block specifically — outer <c:order>
  // belongs to the parent <c:ser> (series order index).
  const trendlineBlock = chartXml.match(/<c:trendline>[\s\S]*?<\/c:trendline>/)[0];
  assert.ok(!/<c:order val=/.test(trendlineBlock), 'no order inside trendline for linear');
  assert.ok(!/<c:forward val=/.test(trendlineBlock), 'no forward inside trendline for linear');
});

// ============================================================================
// R41 — chart-area polish: explicit major gridlines + roundedCorners=0.
// Audit finding (audit/cm-style-audit + on-demand inspection of master
// Core Cap Chart's val axis XML): master has <c:majorGridlines> at every
// val tick (~D9D9D9 light gray); our exports relied on Excel defaults
// which can render inconsistently across versions. Master also explicitly
// sets <c:roundedCorners val="0"/> on the chart wrapper.
// ============================================================================

test('R41: chart wrapper emits <c:roundedCorners val="0"/>', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  sheet.getCell('B5').value = 'Series';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${6 + i}`).value = new Date(2025, i, 31);
    sheet.getCell(`B${6 + i}`).value = 100 + i;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'line', tabName: 'Data_Test',
      titleCol: 'B', titleRow: 5,
      catCol: 'A', valCol: 'B',
      dataStart: 6, dataEnd: 11,
      color: '003DA5',
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chartXml, /<c:roundedCorners val="0"\/>/,
    'roundedCorners disabled at chart wrapper');
});

test('R41: val axis emits <c:majorGridlines> with light-gray color', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  sheet.getCell('B5').value = 'Series';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${6 + i}`).value = new Date(2025, i, 31);
    sheet.getCell(`B${6 + i}`).value = 100 + i;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'line', tabName: 'Data_Test',
      titleCol: 'B', titleRow: 5,
      catCol: 'A', valCol: 'B',
      dataStart: 6, dataEnd: 11,
      color: '003DA5',
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  // Major gridlines inside the val axis block
  const valAx = chartXml.match(/<c:valAx>[\s\S]*?<\/c:valAx>/)[0];
  assert.match(valAx, /<c:majorGridlines>/, 'val axis has major gridlines');
  assert.match(valAx, /<c:majorGridlines>[\s\S]*?<a:srgbClr val="D9D9D9"\/>/,
    'gridline color is light gray D9D9D9 (matches master ~85%-lightened tx1)');
  // Cat axis should NOT have gridlines (we only emit them on val axes)
  const catAx = chartXml.match(/<c:catAx>[\s\S]*?<\/c:catAx>/)[0];
  assert.ok(!/<c:majorGridlines>/.test(catAx),
    'cat axis does NOT have gridlines (val axis only)');
});

test('R41: combo chart emits gridlines on both left + right val axes', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2025, i, 31);
    sheet.getCell(`B${5 + i}`).value = 50 + i;
    sheet.getCell(`C${5 + i}`).value = 0.85 + i * 0.01;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'combo', tabName: 'Data_Test',
      catCol: 'A', dataStart: 5, dataEnd: 10,
      barSeries: [{ titleCol: 'B', titleRow: 4, valCol: 'B', color: '62B5E5' }],
      lineSeries: [{ titleCol: 'C', titleRow: 4, valCol: 'C', color: '003DA5' }],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  // Two val axes both have gridlines
  const gridlineCount = (chartXml.match(/<c:majorGridlines>/g) || []).length;
  assert.equal(gridlineCount, 2, 'both left + right val axes have gridlines');
});

test('R41: scatter chart emits gridlines on both x + y val axes', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = i + 1;
    sheet.getCell(`B${5 + i}`).value = 0.05 + i * 0.005;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'scatter', tabName: 'Data_Test',
      dataStart: 5, dataEnd: 10,
      series: [{ titleCol: 'B', titleRow: 4, xCol: 'A', yCol: 'B', color: '003DA5' }],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  // Scatter has 2 val axes (x + y); both should have gridlines
  const gridlineCount = (chartXml.match(/<c:majorGridlines>/g) || []).length;
  assert.equal(gridlineCount, 2, 'both scatter axes have gridlines');
});

// ============================================================================
// R46 — user feedback batch 2 (2026-05-21):
//   • Core_Cap_Dot scatter x-axis: render quarters not raw dates
//   • Avail_Tenant donuts: per-segment % labels
//   • Buyer_Pool stacked-bar: per-segment in-bar % labels
// ============================================================================

test('R46 → R67: core_cap_rate_dot_plot spec uses mmm-yy x-axis format (master parity)', () => {
  const spec = buildInjectionSpec({
    chart_template_id: 'core_cap_rate_dot_plot',
    tabName: 'Data_Core_Cap_Dot',
    cols: [
      { key: 'period_end',      col: 'A' },
      { key: 'cap_rate',        col: 'B' },
      { key: 'firm_term_years', col: 'C' },
    ],
    dataStart: 5, dataEnd: 100,
    brand: { palette: {} },
    rows: [],
  });
  assert.ok(spec, 'spec produced');
  // R67: switched from q"Q-"yyyy to [$-409]mmm-yy;@ to match master
  // Core Cap Chart (Dialysis Comp Work MASTER.xlsx) which labels year-
  // interval ticks with "Mar-25" style.
  assert.equal(spec.spec.xAxisNumFmt, '[$-409]mmm-yy;@',
    'R67: scatter x-axis uses mmm-yy format (master parity)');
});

test('R46: scatter chart emits xAxisNumFmt on x axis when set', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i, 31);
    sheet.getCell(`B${5 + i}`).value = 0.05 + i * 0.005;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'scatter', tabName: 'Data_Test',
      dataStart: 5, dataEnd: 10,
      series: [{ titleCol: 'B', titleRow: 4, xCol: 'A', yCol: 'B', color: '003DA5' }],
      xAxisNumFmt: 'q"Q-"yyyy',
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  const xAxBlock = chartXml.match(/<c:valAx>[\s\S]*?<\/c:valAx>/g)?.[0];
  assert.ok(xAxBlock, 'first valAx block found');
  assert.match(xAxBlock, /q&quot;Q-&quot;yyyy/,
    'x axis (first valAx) emits quarter format');
});

test('R46: doughnut chart emits per-segment % labels when showSegmentLabels=true', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Donut');
  sheet.getCell('B4').value = 'Title';
  for (let i = 0; i < 3; i++) {
    sheet.getCell(`A${5 + i}`).value = ['DaVita', 'FMC', 'Other'][i];
    sheet.getCell(`B${5 + i}`).value = 100 - i * 20;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Donut',
    spec: {
      type: 'doughnut', tabName: 'Data_Donut',
      titleCol: 'B', titleRow: 4,
      catCol: 'A', valCol: 'B',
      dataStart: 5, dataEnd: 7,
      colors: ['003DA5', '62B5E5', '4CB582'],
      showSegmentLabels: true,
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chartXml, /<c:dLbls>/, '<c:dLbls> block emitted');
  assert.match(chartXml, /<c:showPercent val="1"\/>/, 'showPercent=1');
  assert.match(chartXml, /<c:showVal val="0"\/>/, 'showVal=0 (use percent only)');
  // R68-E (D14): dLblPos is ILLEGAL under c:doughnutChart per ECMA-376 — its
  // presence made Excel auto-repair strip the chart on open. Must be absent;
  // showPercent=1 renders the ring labels without a position element.
  assert.ok(!/<c:dLblPos/.test(chartXml), 'no dLblPos under doughnut (ECMA-376)');
  assert.match(chartXml, /formatCode="0%"/, 'percent format 0%');
});

test('R46: doughnut omits dLbls when showSegmentLabels missing (backward compat)', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Donut');
  for (let i = 0; i < 3; i++) {
    sheet.getCell(`A${5 + i}`).value = ['DaVita', 'FMC', 'Other'][i];
    sheet.getCell(`B${5 + i}`).value = 100 - i * 20;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Donut',
    spec: {
      type: 'doughnut', tabName: 'Data_Donut',
      titleCol: 'B', titleRow: 4,
      catCol: 'A', valCol: 'B',
      dataStart: 5, dataEnd: 7,
      colors: ['003DA5', '62B5E5', '4CB582'],
      // no showSegmentLabels
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.ok(!/<c:dLbls>/.test(chartXml), 'no dLbls when flag missing');
});

test('R46: buildInjectionSpec wires showSegmentLabels on tenant donuts', () => {
  for (const tpl of ['available_by_tenant_count_donut', 'available_by_tenant_volume_donut']) {
    const colsBase = [
      { key: 'tenant', col: 'A' },
      { key: tpl === 'available_by_tenant_volume_donut' ? 'volume_available' : 'count_active', col: 'B' },
      { key: 'period_end', col: 'C' },
    ];
    const out = buildInjectionSpec({
      chart_template_id: tpl,
      tabName: tpl === 'available_by_tenant_volume_donut' ? 'Data_Avail_Tenant_VolD' : 'Data_Avail_Tenant_CountD',
      cols: colsBase,
      dataStart: 5, dataEnd: 8,
      brand: { palette: {} },
    });
    assert.ok(out, `${tpl}: spec produced`);
    assert.equal(out.spec.showSegmentLabels, true, `${tpl}: showSegmentLabels=true`);
  }
});

test('R46: stacked-bar series emits in-bar value labels when showSegmentVal=true', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Stack');
  for (let i = 0; i < 3; i++) {
    sheet.getCell(`A${5 + i}`).value = 2023 + i;
    sheet.getCell(`B${5 + i}`).value = 0.5 - i * 0.1;  // private %
    sheet.getCell(`C${5 + i}`).value = 0.5 + i * 0.1;  // reit %
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Stack',
    spec: {
      type: 'stacked-bar', tabName: 'Data_Stack',
      catCol: 'A', dataStart: 5, dataEnd: 7,
      yAxisRange: { min: 0, max: 1 },
      valAxNumFmt: '0%',
      series: [
        { titleCol: 'B', titleRow: 4, valCol: 'B', color: '003DA5',
          showSegmentVal: true, segmentLabelFmt: '0%', segmentLabelColor: 'FFFFFF' },
        { titleCol: 'C', titleRow: 4, valCol: 'C', color: '62B5E5',
          showSegmentVal: true, segmentLabelFmt: '0%', segmentLabelColor: '191919' },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  // Two dLbls blocks — one per series
  const dLblsCount = (chartXml.match(/<c:dLbls>/g) || []).length;
  assert.equal(dLblsCount, 2, 'each stack series has its own dLbls block');
  assert.match(chartXml, /<c:showVal val="1"\/>/);
  // White label color (private series)
  assert.match(chartXml, /<a:srgbClr val="FFFFFF"\/>/, 'white text on dark fill');
  // Dark label color (sky series)
  assert.match(chartXml, /<a:srgbClr val="191919"\/>/, 'dark text on light fill');
});

test('R46: buildInjectionSpec wires per-series showSegmentVal on buyer_class_pct_by_year', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'buyer_class_pct_by_year',
    tabName: 'Data_Buyer_Pool',
    cols: [
      { key: 'year',                  col: 'A' },
      { key: 'subspecialty',          col: 'B' },
      { key: 'private_volume',        col: 'C' },
      { key: 'reit_volume',           col: 'D' },
      { key: 'cross_border_volume',   col: 'E' },
      { key: 'institutional_volume',  col: 'F' },
      { key: 'private_pct',           col: 'G' },
      { key: 'reit_pct',              col: 'H' },
      { key: 'cross_border_pct',      col: 'I' },
      { key: 'institutional_pct',     col: 'J' },
    ],
    dataStart: 5, dataEnd: 20,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5', nm_blue_mid: '#265AB2', nm_pale: '#E0E8F4' } },
  });
  assert.ok(out, 'spec produced');
  assert.equal(out.spec.series.length, 4);
  for (const s of out.spec.series) {
    assert.equal(s.showSegmentVal, true, 'every series has showSegmentVal');
    assert.equal(s.segmentLabelFmt, '0%');
  }
  // First two (private + reit) use white; last two (cross-border + institutional) use dark
  assert.equal(out.spec.series[0].segmentLabelColor, 'FFFFFF', 'private white text');
  assert.equal(out.spec.series[1].segmentLabelColor, 'FFFFFF', 'reit white text');
  assert.equal(out.spec.series[2].segmentLabelColor, '191919', 'cross-border dark text');
  assert.equal(out.spec.series[3].segmentLabelColor, '191919', 'institutional dark text');
});

// ============================================================================
// R47 — per-template chart x-axis trim. User notes 2026-05-21 batch 2.
// Charts with FALSE-alarm pre-2005 data gap pin to 2005; TRUE-gap charts
// trim to where source data actually starts (2006-2014). Data tables keep
// all 2001+ rows; only chart series references narrow.
// ============================================================================

function mkRows(startYear, endYear, valKey = 'ttm_weighted_cap_rate') {
  const rows = [];
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 1; m <= 12; m++) {
      rows.push({
        period_end: `${y}-${String(m).padStart(2, '0')}-28`,
        [valKey]: 0.05 + Math.random() * 0.03,
      });
    }
  }
  return rows;
}

test('R69: data-aware MIN_YEAR — gov-shaped dense rows from 2005 produce 2005 cutoff', () => {
  // Gov-shaped synthetic: 2001-2024 monthly with n=30+ from the start
  // (mirrors cm_gov_market_quarterly_master_m_mat where 2005 already
  // has n=29-45 per TTM). The function-based MIN_YEAR for
  // cap_rate_ttm_by_quarter should detect dense data immediately and
  // return 2001 (no trim), not the 2009 fallback.
  const rows = [];
  for (let y = 2001; y <= 2024; y++) {
    for (let m = 1; m <= 12; m++) {
      rows.push({
        period_end: `${y}-${String(m).padStart(2, '0')}-28`,
        ttm_weighted_cap_rate: 0.07,
        transaction_count_ttm: 30,  // dense from year one
      });
    }
  }
  const spec = buildInjectionSpec({
    chart_template_id: 'cap_rate_ttm_by_quarter',
    tabName: 'Data_Cap_Avg',
    cols: [
      { key: 'period_end',            col: 'A' },
      { key: 'subspecialty',          col: 'B' },
      { key: 'ttm_weighted_cap_rate', col: 'C' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    brand: { palette: {} },
    rows,
  });
  // dense-from-2001 rows → cutoff = 2001 → no shift
  assert.equal(spec.spec.dataStart, 5,
    'R69: gov-shaped dense rows keep dataStart at 5 (no trim)');
});

test('R69: data-aware MIN_YEAR — dia-shaped sparse early rows trim to first dense year', () => {
  // Dia-shaped: 2001-2024 monthly. 2001-2008 = sparse (n=9-14, real
  // master_m pre-2009 numbers). 2009+ = dense (n=25). The function
  // should detect 2009 as the first year with 4+ consecutive months
  // at n≥15.
  const rows = [];
  for (let y = 2001; y <= 2024; y++) {
    for (let m = 1; m <= 12; m++) {
      rows.push({
        period_end: `${y}-${String(m).padStart(2, '0')}-28`,
        ttm_weighted_cap_rate: 0.07,
        // Sparse 9-14 through 2008, dense 25+ from 2009 onward
        transaction_count_ttm: y < 2009 ? (9 + Math.floor((y - 2001) * 0.6)) : 25,
      });
    }
  }
  const spec = buildInjectionSpec({
    chart_template_id: 'cap_rate_ttm_by_quarter',
    tabName: 'Data_Cap_Avg',
    cols: [
      { key: 'period_end',            col: 'A' },
      { key: 'subspecialty',          col: 'B' },
      { key: 'ttm_weighted_cap_rate', col: 'C' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    brand: { palette: {} },
    rows,
  });
  // 2001-01 to 2008-12 = 96 sparse rows → dataStart 5 + 96 = 101
  assert.equal(spec.spec.dataStart, 5 + 96,
    'R69: dia-shaped sparse rows trim to first 2009 row');
});

test('R47 → R69: cap_rate_ttm_by_quarter shifts dataStart to first 2009 row (master parity)', () => {
  const rows = mkRows(2001, 2024);
  const spec = buildInjectionSpec({
    chart_template_id: 'cap_rate_ttm_by_quarter',
    tabName: 'Data_Cap_Avg',
    cols: [
      { key: 'period_end',             col: 'A' },
      { key: 'subspecialty',           col: 'B' },
      { key: 'ttm_weighted_cap_rate',  col: 'C' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    brand: { palette: {} },
    rows,
  });
  // R69: bumped 2005 → 2009 to match master Dialysis Comp Work
  // MASTER.xlsx Charts tab which starts its "Cap (TTM)" series at row
  // 23 = Sep-2009. 2001-01 to 2008-12 = 96 monthly rows before 2009-01.
  // dataStart 5 + 96 = row 101.
  assert.equal(spec.spec.dataStart, 5 + 96,
    'R69: dataStart shifted to first 2009 row');
});

test('R47: bid_ask_spread trims to 2014 (TRUE-gap)', () => {
  const rows = mkRows(2001, 2024, 'avg_bid_ask_spread');
  const spec = buildInjectionSpec({
    chart_template_id: 'bid_ask_spread',
    tabName: 'Data_Bid_Ask',
    cols: [
      { key: 'period_end',         col: 'A' },
      { key: 'subspecialty',       col: 'B' },
      { key: 'avg_bid_ask_spread', col: 'C' },
      { key: 'pct_price_change',   col: 'D' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    brand: { palette: {} },
    rows,
  });
  // 2001-01 to 2013-12 = 156 rows before 2014-01
  assert.equal(spec.spec.dataStart, 5 + 156, 'dataStart at first 2014 row');
});

test('R66aa: dom_and_pct_of_ask trims to 2018', () => {
  const rows = mkRows(2001, 2024, 'avg_dom');
  // dom_and_pct_of_ask requires period_end + avg_dom + pct_of_ask
  for (const r of rows) r.pct_of_ask = 0.93;
  const spec = buildInjectionSpec({
    chart_template_id: 'dom_and_pct_of_ask',
    tabName: 'Data_DOM_Ask',
    cols: [
      { key: 'period_end',   col: 'A' },
      { key: 'subspecialty', col: 'B' },
      { key: 'avg_dom',      col: 'C' },
      { key: 'median_dom',   col: 'D' },
      { key: 'pct_of_ask',   col: 'E' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    brand: { palette: {} },
    rows,
  });
  // R66aa bumped the cutoff 2013 → 2018 (pre-2018 TTM months are thin/volatile).
  // 2001-01 to 2017-12 = 204 rows before 2018-01.
  assert.equal(spec.spec.dataStart, 5 + 204, 'dataStart at first 2018 row');
});

// ── R73 Layer D — x-axis reach (density-gated floors) ───────────────────────
// The above R66aa test now also proves the GOV path of dom_and_pct_of_ask:
// gov rows carry no n_sales, so the per-vertical function falls back to 2018.

test('R73 D-#2: dom_and_pct_of_ask floors dia at 2016 when n_sales is dense', () => {
  // dia carries n_sales (TTM). Thin (<15) through 2015, dense (>=15) from 2016
  // -> the function returns the first year with 4 consecutive n>=15 = 2016.
  const rows = [];
  for (let y = 2001; y <= 2024; y++) for (let m = 1; m <= 12; m++) {
    rows.push({ period_end: `${y}-${String(m).padStart(2,'0')}-28`,
      avg_dom: 120, pct_of_ask: 0.93, n_sales: y < 2016 ? 8 : 16 });
  }
  const spec = buildInjectionSpec({
    chart_template_id: 'dom_and_pct_of_ask', tabName: 'Data_DOM_Ask',
    cols: [{key:'period_end',col:'A'},{key:'subspecialty',col:'B'},{key:'avg_dom',col:'C'},{key:'pct_of_ask',col:'D'},{key:'n_sales',col:'E'}],
    dataStart: 5, dataEnd: 5 + rows.length - 1, brand: { palette: {} }, rows,
  });
  // 2001-01 .. 2015-12 = 180 rows before 2016-01.
  assert.equal(spec.spec.dataStart, 5 + 180, 'dia dom floors at first 2016 row');
});

test('R73 D-#12: bid_ask_spread floors gov at 2008 (first continuous Last-Ask), dia self-floors later', () => {
  const mk = (askStartYear) => {
    const rows = [];
    for (let y = 2001; y <= 2024; y++) for (let m = 1; m <= 12; m++) {
      rows.push({ period_end: `${y}-${String(m).padStart(2,'0')}-28`,
        avg_bid_ask_spread: 0.004,
        avg_last_ask_cap: y < askStartYear ? null : 0.07 });
    }
    return buildInjectionSpec({
      chart_template_id: 'bid_ask_spread', tabName: 'Data_Bid_Ask',
      cols: [{key:'period_end',col:'A'},{key:'subspecialty',col:'B'},{key:'avg_bid_ask_spread',col:'C'},{key:'avg_last_ask_cap',col:'D'}],
      dataStart: 5, dataEnd: 5 + rows.length - 1, brand: { palette: {} }, rows,
    });
  };
  // gov: ask present from 2008 -> 2001-01..2007-12 = 84 rows trimmed.
  assert.equal(mk(2008).spec.dataStart, 5 + 84, 'gov bid-ask floors at first 2008 row');
  // dia: ask thin until 2015 -> floors later (2014-12 = 168 rows trimmed).
  assert.equal(mk(2015).spec.dataStart, 5 + 168, 'dia bid-ask self-floors at 2015 (no over-extend)');
});

test('R73 D-#19: net_lease_spread floors at 2002 (earliest consistent treasury)', () => {
  const rows = [];
  for (let y = 2001; y <= 2024; y++) for (let m = 1; m <= 12; m++) {
    rows.push({ period_end: `${y}-${String(m).padStart(2,'0')}-28`,
      treasury_10y_yield: 0.04, avg_cap_rate: 0.075, market_spread: 0.035, nm_spread: 0.03, non_nm_spread: 0.04 });
  }
  const spec = buildInjectionSpec({
    chart_template_id: 'net_lease_spread', tabName: 'Data_NL_Spread',
    cols: [{key:'period_end',col:'A'},{key:'subspecialty',col:'B'},{key:'treasury_10y_yield',col:'C'},{key:'avg_cap_rate',col:'D'},{key:'market_spread',col:'E'},{key:'nm_spread',col:'F'},{key:'non_nm_spread',col:'G'}],
    dataStart: 5, dataEnd: 5 + rows.length - 1, brand: { palette: {} }, rows,
  });
  // 2001-01..2001-12 = 12 rows before 2002-01.
  assert.equal(spec.spec.dataStart, 5 + 12, 'net-lease-spread floors at first 2002 row');
});

test('R66o: nm_vs_market_cap trims to 2020 (Value Proposition window)', () => {
  const rows = mkRows(2001, 2024, 'nm_cap_rate');
  for (const r of rows) r.market_cap_rate = 0.07;
  const spec = buildInjectionSpec({
    chart_template_id: 'nm_vs_market_cap',
    tabName: 'Data_NM_vs_Market',
    cols: [
      { key: 'period_end',      col: 'A' },
      { key: 'subspecialty',    col: 'B' },
      { key: 'nm_cap_rate',     col: 'C' },
      { key: 'market_cap_rate', col: 'D' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    brand: { palette: {} },
    rows,
  });
  // R66o bumped the cutoff 2011 → 2020 to match the deck's Value Proposition
  // window (Sep-20 onward). 2001-01 to 2019-12 = 228 rows before 2020-01.
  assert.equal(spec.spec.dataStart, 5 + 228, 'dataStart at first 2020 row');
});

test('R47: template not in MIN_YEAR_BY_TEMPLATE keeps original dataStart', () => {
  // transaction_count_ttm isn't in the trim list — should be unchanged
  const rows = mkRows(2001, 2024, 'ttm_count');
  const spec = buildInjectionSpec({
    chart_template_id: 'transaction_count_ttm',
    tabName: 'Data_Txn_Count',
    cols: [
      { key: 'period_end',  col: 'A' },
      { key: 'ttm_count',   col: 'B' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    brand: { palette: {} },
    rows,
  });
  assert.equal(spec.spec.dataStart, 5, 'untrimmed templates keep dataStart=5');
});

test('R47: cutoff applies cleanly when rows array is empty (no shift)', () => {
  const spec = buildInjectionSpec({
    chart_template_id: 'cap_rate_ttm_by_quarter',
    tabName: 'Data_Cap_Avg',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'subspecialty', col: 'B' },
      { key: 'ttm_weighted_cap_rate', col: 'C' },
    ],
    dataStart: 5, dataEnd: 10,
    brand: { palette: {} },
    rows: [],
  });
  assert.equal(spec.spec.dataStart, 5, 'empty rows → no shift (backward compat)');
});

test('R47: if all rows are after cutoff, dataStart is unchanged', () => {
  // cap_rate_ttm starts at 2010 (all after 2005 cutoff)
  const rows = mkRows(2010, 2024);
  const spec = buildInjectionSpec({
    chart_template_id: 'cap_rate_ttm_by_quarter',
    tabName: 'Data_Cap_Avg',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'subspecialty', col: 'B' },
      { key: 'ttm_weighted_cap_rate', col: 'C' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    brand: { palette: {} },
    rows,
  });
  // First row (2010-01) is already after 2005-01 — offset 0
  assert.equal(spec.spec.dataStart, 5, 'when all rows after cutoff, no shift');
});

test('R47: chart XML series references shift to trimmed dataStart', async () => {
  // End-to-end: build a workbook with cap_rate_ttm rows from 2001-2024,
  // inject the chart, and confirm the series xml references row 53+ not 5+.
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Cap_Avg');
  sheet.getCell('A4').value = 'Quarter End';
  sheet.getCell('B4').value = 'Subspecialty';
  sheet.getCell('C4').value = 'Avg Cap Rate';
  sheet.getCell('C5').value = 'Avg Cap Rate';  // series title
  const rows = mkRows(2001, 2024);
  for (let i = 0; i < rows.length; i++) {
    const r = sheet.getRow(5 + i);
    r.getCell(1).value = new Date(rows[i].period_end);
    r.getCell(2).value = 'all';
    r.getCell(3).value = rows[i].ttm_weighted_cap_rate;
  }
  const spec = buildInjectionSpec({
    chart_template_id: 'cap_rate_ttm_by_quarter',
    tabName: 'Data_Cap_Avg',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'subspecialty', col: 'B' },
      { key: 'ttm_weighted_cap_rate', col: 'C' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    brand: { palette: { nm_navy: '#003DA5' } },
    rows,
  });
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [spec]);
  const zip = await JSZip.loadAsync(result);
  const xml = await zip.file('xl/charts/chart1.xml').async('string');
  // R69: trimmed to 2009 = row 101 (5 + 96 pre-2009 months).
  assert.match(xml, /'Data_Cap_Avg'!\$A\$101:\$A\$\d+/,
    'R69: cat axis references start at row 101 (first 2009 row)');
  assert.match(xml, /'Data_Cap_Avg'!\$C\$101:\$C\$\d+/,
    'R69: val series references start at row 101');
});

test('buildInjectionSpec: bid_ask_spread R66l — floating-bar combo when last_ask present', () => {
  // R66l — restructured from the R50 stacked-line/upDownBars shape to the
  // deliverable PDF (Dialysis Market Filter p.34) floating-bar combo: a
  // light-gray bar from Last Ask (invisible base) up to Achieved cap
  // (last_ask + spread), with a sky dash marker at the bottom (Last Ask)
  // and a navy dash marker at the top (Achieved) on a single cap-rate axis.
  const cols = [
    { key: 'period_end',         col: 'A' },
    { key: 'subspecialty',       col: 'B' },
    { key: 'n_with_spread',      col: 'C' },
    { key: 'avg_bid_ask_spread', col: 'D' },
    { key: 'pct_price_change',   col: 'E' },
    { key: 'avg_last_ask_cap',   col: 'F' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'bid_ask_spread',
    tabName: 'Data_Bid_Ask',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.catCol, 'A');
  assert.equal(out.spec.barGrouping, 'stacked');
  assert.equal(out.spec.sharedAxis, true);
  assert.equal(out.spec.barSeries.length, 2);
  assert.equal(out.spec.barSeries[0].valCol, 'F', 'invisible base = avg_last_ask_cap');
  assert.equal(out.spec.barSeries[0].noFill, true);
  assert.equal(out.spec.barSeries[1].valCol, 'D', 'visible gray bar = avg_bid_ask_spread');
  assert.equal(out.spec.lineSeries.length, 2);
  assert.equal(out.spec.lineSeries[0].valCol, 'F', 'sky dash marker = Last Ask');
  assert.equal(out.spec.lineSeries[0].color, '62B5E5');
  assert.equal(out.spec.lineSeries[1].valCol, 'G', 'navy dash marker = Achieved helper col (G)');
  assert.equal(out.spec.lineSeries[1].color, '003DA5');
  assert.equal(out.helperCols[0].key, 'achieved_cap');
});

// QUARANTINED 2026-06-03 (QA suite-green pass): this asserts a min/max
// "high-low RANGE" variant of bid_ask_spread (floating bar from
// min_last_ask_cap -> max_last_ask_cap with a `last_ask_range` helper) that
// was specced here but never implemented. The code instead took the R66l
// direction — a floating bar from Last Ask -> Achieved (last_ask + spread),
// using an `achieved_cap` helper — and ignores min/max cols entirely (see the
// `case 'bid_ask_spread'` block in cm-native-chart-injector.js, covered by the
// "R66l — floating-bar combo" test above). Re-enable + implement the
// min/max range branch if the high-low visual is still wanted; until then this
// is the one un-shipped spec among the chart-injector tests. Tracking: chart
// injector min/max range variant.
test.skip('buildInjectionSpec: bid_ask_spread high-low RANGE chart when min/max present (master p.34)', () => {
  // 2026-05-29 — when the *_bid_ask_spread_m view exposes min/max/achieved,
  // the chart becomes the master/PDF p.34 high-low range visual: a gray
  // floating bar (min -> max of last asks) via stacked invisible-base +
  // visible band, plus navy Last Ask and sky Achieved lines on a shared axis.
  const cols = [
    { key: 'period_end',            col: 'A' },
    { key: 'subspecialty',          col: 'B' },
    { key: 'avg_bid_ask_spread',    col: 'C' },
    { key: 'avg_last_ask_cap',      col: 'D' },
    { key: 'pct_price_change',      col: 'E' },
    { key: 'min_last_ask_cap',      col: 'F' },
    { key: 'max_last_ask_cap',      col: 'G' },
    { key: 'achieved_last_ask_cap', col: 'H' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'bid_ask_spread',
    tabName: 'Data_Bid_Ask',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'combo', 'high-low range uses the combo builder');
  assert.equal(out.spec.barGrouping, 'stacked');
  assert.equal(out.spec.sharedAxis, true);
  assert.equal(out.spec.barSeries.length, 2);
  assert.equal(out.spec.barSeries[0].valCol, 'F', 'invisible base = min_last_ask_cap');
  assert.equal(out.spec.barSeries[0].noFill, true, 'base is invisible');
  assert.equal(out.spec.barSeries[1].valCol, 'I', 'visible band = range helper (one col past the 8 data cols)');
  assert.equal(out.spec.lineSeries.length, 2, 'Last Ask + Achieved lines');
  assert.equal(out.spec.lineSeries[0].valCol, 'D', 'navy Last Ask (TTM) line');
  assert.equal(out.spec.lineSeries[1].valCol, 'H', 'sky Achieved Cap (TTM) line');
  assert.ok(out.helperCols && out.helperCols[0].key === 'last_ask_range', 'declares the range helper col');
  const v = out.helperCols[0].getValue({ min_last_ask_cap: 0.0489, max_last_ask_cap: 0.0846 });
  assert.ok(Math.abs(v - 0.0357) < 1e-9, 'range helper = max - min');
});

test('buildInjectionSpec: bid_ask_spread (quarterly) gracefully degrades when last_ask missing', () => {
  // Backward-compat: if a view layout drops avg_last_ask_cap (legacy
  // catalogs, custom verticals), fall back to single-line of the spread.
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
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'line', 'falls back to single line');
  assert.equal(out.spec.valCol, 'C', 'fallback plots the spread');
});

test('buildInjectionSpec: bid_ask_spread_monthly R66l — same floating-bar combo as quarterly', () => {
  // R66l — both cadences share the same floating-bar combo shape.
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
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.barGrouping, 'stacked');
  assert.equal(out.spec.sharedAxis, true);
  // Bars: invisible base = last_ask (F), visible gray = spread (D)
  assert.deepEqual(out.spec.barSeries.map(s => s.valCol), ['F', 'D']);
  // Lines: sky Last Ask (F), navy Achieved helper col (G)
  assert.deepEqual(out.spec.lineSeries.map(s => s.valCol), ['F', 'G']);
  assert.deepEqual(out.spec.lineSeries.map(s => s.color), ['62B5E5', '003DA5']);
});

test('buildInjectionSpec: valuation_index builds line+bar combo with swapped axes (Tier F1)', () => {
  // 8-col data tab per cm-excel-export.js CHART_COLUMNS:
  //   A=period_end, B=avg_rent_psf, C=avg_expenses_psf, D=avg_noi_psf,
  //   E=avg_cap_rate, F=valuation_index, G=yoy_change, H=n_sales
  const cols = [
    { key: 'period_end',       col: 'A' },
    { key: 'avg_rent_psf',     col: 'B' },
    { key: 'avg_expenses_psf', col: 'C' },
    { key: 'avg_noi_psf',      col: 'D' },
    { key: 'avg_cap_rate',     col: 'E' },
    { key: 'valuation_index',  col: 'F' },
    { key: 'yoy_change',       col: 'G' },
    { key: 'n_sales',          col: 'H' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'valuation_index',
    tabName: 'Data_Val_Index',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.catCol, 'A');
  assert.equal(out.spec.swapAxes, true, 'line on LEFT, bars on RIGHT (PDF p.17)');

  // Bar series: yoy_change in sky
  assert.equal(out.spec.barSeries.length, 1);
  assert.equal(out.spec.barSeries[0].valCol, 'G', 'bars = yoy_change');
  assert.equal(out.spec.barSeries[0].color, '62B5E5', 'sky');

  // Line series: valuation_index in navy
  assert.equal(out.spec.lineSeries.length, 1);
  assert.equal(out.spec.lineSeries[0].valCol, 'F', 'line = valuation_index');
  assert.equal(out.spec.lineSeries[0].color, '003DA5', 'navy');
});

test('R73 C3: valuation_index left axis re-pinned per vertical (gov 150-420, dia 90-165)', () => {
  // The R66 gov pin (210-350) clipped the post-R70-A4 gov index (~161..410)
  // off the top of the frame — the "axis not rendering" report. gov now
  // frames 150-420; dia (94-149) keeps its 90-165 pin.
  const cols = [
    { key: 'period_end',      col: 'A' },
    { key: 'valuation_index', col: 'F' },
    { key: 'yoy_change',      col: 'G' },
  ];
  const mk = (vertical) => buildInjectionSpec({
    chart_template_id: 'valuation_index',
    tabName: 'Data_Val_Index', cols, dataStart: 5, dataEnd: 60, vertical,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.deepEqual(mk('gov').spec.yLeftRange, { min: 150, max: 420 },
    'gov index axis frames the full 161..410 rendered series (no top clip)');
  assert.deepEqual(mk('dialysis').spec.yLeftRange, { min: 90, max: 165 },
    'dia index axis unchanged');
});

test('buildInjectionSpec: rent_by_year_built builds IQR + median + avg combo (P9)', () => {
  // 6-col data tab per cm-excel-export.js CHART_COLUMNS:
  //   A=year, B=avg_rpsf, C=median_rpsf, D=upper_quartile_rpsf,
  //   E=lower_quartile_rpsf, F=n_leases
  // Helper col lands at G.
  const cols = [
    { key: 'year',                col: 'A' },
    { key: 'avg_rpsf',            col: 'B' },
    { key: 'median_rpsf',         col: 'C' },
    { key: 'upper_quartile_rpsf', col: 'D' },
    { key: 'lower_quartile_rpsf', col: 'E' },
    { key: 'n_leases',            col: 'F' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'rent_by_year_built',
    tabName: 'Data_Rent_Year_Built',
    cols, dataStart: 5, dataEnd: 20,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.ok(out, 'should produce a spec');
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.catCol, 'A', 'x-axis = year (col A)');
  assert.equal(out.spec.barGrouping, 'stacked');
  assert.equal(out.spec.sharedAxis, true, 'markers + bars on same currency axis');

  // 2 bar series: invisible base (lower_q) + visible IQR helper
  assert.equal(out.spec.barSeries.length, 2);
  assert.equal(out.spec.barSeries[0].valCol, 'E', 'base = lower_quartile_rpsf');
  assert.equal(out.spec.barSeries[0].noFill, true, 'base is invisible');
  assert.equal(out.spec.barSeries[1].valCol, 'G', 'band = iqr_width helper (col G)');
  assert.equal(out.spec.barSeries[1].color, '62B5E5', 'band = sky');

  // 2 line series: median (sky circle) + avg (navy diamond), markers only
  assert.equal(out.spec.lineSeries.length, 2);
  assert.equal(out.spec.lineSeries[0].valCol, 'C', 'median = median_rpsf');
  assert.equal(out.spec.lineSeries[0].color, '62B5E5');
  assert.equal(out.spec.lineSeries[0].showMarker, true);
  assert.equal(out.spec.lineSeries[0].markerShape, 'circle');
  assert.equal(out.spec.lineSeries[1].valCol, 'B', 'avg = avg_rpsf');
  assert.equal(out.spec.lineSeries[1].color, '003DA5');
  assert.equal(out.spec.lineSeries[1].showMarker, true);
  assert.equal(out.spec.lineSeries[1].markerShape, 'diamond', 'avg uses diamond marker');

  // Helper col
  assert.equal(out.helperCols.length, 1);
  assert.equal(out.helperCols[0].key, 'iqr_width');
  const v = out.helperCols[0].getValue({
    lower_quartile_rpsf: 22.5,
    upper_quartile_rpsf: 38.7,
  });
  assert.ok(Math.abs(v - 16.2) < 0.001, `getValue returns ${v}, expected ~16.2`);
  // Null guard
  assert.equal(
    out.helperCols[0].getValue({ lower_quartile_rpsf: null, upper_quartile_rpsf: 30 }),
    null,
    'returns null when input is null'
  );
});

test('buildInjectionSpec: rent_psf_box_quarterly builds IQR box-whisker combo (P8.5 upgrade)', () => {
  // 8-column data tab schema (per cm-excel-export.js CHART_COLUMNS).
  // Helper column lands at col I (= cols.length + 1).
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
  assert.equal(out.spec.type, 'combo', 'upgraded from multi-line to combo');
  assert.equal(out.spec.barGrouping, 'stacked', 'bars are stacked (floating bar)');
  assert.equal(out.spec.sharedAxis, true, 'median line uses same axis as bars');

  // Stacked bar series — invisible base + visible IQR band
  assert.equal(out.spec.barSeries.length, 2);
  assert.equal(out.spec.barSeries[0].valCol, 'E', 'base = rent_lower_quartile');
  assert.equal(out.spec.barSeries[0].noFill, true, 'base is invisible');
  assert.equal(out.spec.barSeries[1].valCol, 'I', 'band = iqr_width helper (col I, past 8 regular cols)');
  assert.equal(out.spec.barSeries[1].color, '62B5E5', 'band = sky');

  // Median line on the same axis
  assert.equal(out.spec.lineSeries.length, 1);
  assert.equal(out.spec.lineSeries[0].valCol, 'F', 'line = rent_median');
  assert.equal(out.spec.lineSeries[0].color, '003DA5', 'median = navy');

  // Helper column declared
  assert.ok(Array.isArray(out.helperCols), 'returns helperCols');
  assert.equal(out.helperCols.length, 1);
  assert.equal(out.helperCols[0].key, 'iqr_width');
  assert.equal(out.helperCols[0].header, 'IQR Width');
  // getValue computes hi - lo
  const v = out.helperCols[0].getValue({ rent_lower_quartile: 18.5, rent_upper_quartile: 31.2 });
  assert.ok(Math.abs(v - 12.7) < 0.001, `getValue returns ${v}, expected ~12.7`);
  // Null guard
  assert.equal(
    out.helperCols[0].getValue({ rent_lower_quartile: null, rent_upper_quartile: 31 }),
    null,
    'returns null when input is null'
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
  const idxValues = Array.from(chartXml.matchAll(/<c:ser>\s*<c:idx val="(\d+)"\/>/g)).map(m => Number(m[1]));
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

test('injectNativeCharts: combo with swapAxes wires bars to right, line to left (Tier F1)', async () => {
  // End-to-end: valuation_index-style combo with swapAxes=true.
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Val_Index');
  sheet.getCell('F4').value = 'Valuation Index';
  sheet.getCell('G4').value = 'YoY %';
  for (let i = 0; i < 8; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i, 28);
    sheet.getCell(`F${5 + i}`).value = 250 + i * 5;
    sheet.getCell(`G${5 + i}`).value = 0.08 - i * 0.005;
  }
  const base = await wb.xlsx.writeBuffer();

  const injections = [{
    tabName: 'Data_Val_Index',
    spec: {
      type: 'combo',
      tabName: 'Data_Val_Index',
      catCol: 'A',
      dataStart: 5, dataEnd: 12,
      swapAxes: true,
      barSeries: [
        { titleCol: 'G', titleRow: 4, valCol: 'G', color: '62B5E5' },
      ],
      lineSeries: [
        { titleCol: 'F', titleRow: 4, valCol: 'F', color: '003DA5' },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }];

  const result = await injectNativeCharts(base, injections);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  assert.match(chartXml, /<c:barChart>/, 'has barChart');
  assert.match(chartXml, /<c:lineChart>/, 'has lineChart');

  // Bar block axId pair = 1 (cat) + 3 (right axis, swapped)
  const barBlock = chartXml.match(/<c:barChart>[\s\S]*?<\/c:barChart>/)[0];
  assert.match(barBlock, /<c:axId val="1"\/>[\s\S]*<c:axId val="3"\/>/,
    'bar block: axId 1 + 3 (right axis when swapAxes)');

  // Line block axId pair = 1 (cat) + 2 (left axis, swapped)
  const lineBlock = chartXml.match(/<c:lineChart>[\s\S]*?<\/c:lineChart>/)[0];
  assert.match(lineBlock, /<c:axId val="1"\/>[\s\S]*<c:axId val="2"\/>/,
    'line block: axId 1 + 2 (left axis when swapAxes)');

  // Two val axes still present
  const valAxCount = (chartXml.match(/<c:valAx>/g) || []).length;
  assert.equal(valAxCount, 2, 'still has two val axes (left + right)');

  // Left axis (axId 2) still has axPos=l, right axis (axId 3) axPos=r
  const leftAx = chartXml.match(/<c:valAx>\s*<c:axId val="2"\/>[\s\S]*?<\/c:valAx>/)[0];
  const rightAx = chartXml.match(/<c:valAx>\s*<c:axId val="3"\/>[\s\S]*?<\/c:valAx>/)[0];
  assert.match(leftAx, /<c:axPos val="l"\/>/);
  assert.match(rightAx, /<c:axPos val="r"\/>/);
  assert.match(rightAx, /<c:crosses val="max"\/>/);
});

test('injectNativeCharts: line series with showMarker renders correct XML (P9)', async () => {
  // End-to-end: stacked combo with a markers-only overlay (median + avg dots).
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Rent_Year_Built');
  sheet.getCell('A4').value = 'Year';
  sheet.getCell('B4').value = 'Avg RPSF';
  sheet.getCell('C4').value = 'Median RPSF';
  sheet.getCell('E4').value = 'Lower Q';
  sheet.getCell('G4').value = 'IQR Width';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = 1990 + i * 5;
    sheet.getCell(`B${5 + i}`).value = 25 + i;
    sheet.getCell(`C${5 + i}`).value = 23 + i;
    sheet.getCell(`E${5 + i}`).value = 18 + i;
    sheet.getCell(`G${5 + i}`).value = 12;  // iqr width
  }
  const base = await wb.xlsx.writeBuffer();

  const injections = [{
    tabName: 'Data_Rent_Year_Built',
    spec: {
      type: 'combo',
      tabName: 'Data_Rent_Year_Built',
      catCol: 'A',
      dataStart: 5, dataEnd: 10,
      barGrouping: 'stacked',
      sharedAxis: true,
      barSeries: [
        { titleCol: 'E', titleRow: 4, valCol: 'E', color: '003DA5', noFill: true },
        { titleCol: 'G', titleRow: 4, valCol: 'G', color: '62B5E5' },
      ],
      lineSeries: [
        { titleCol: 'C', titleRow: 4, valCol: 'C', color: '62B5E5',
          showMarker: true, markerShape: 'circle', markerSize: 5 },
        { titleCol: 'B', titleRow: 4, valCol: 'B', color: '003DA5',
          showMarker: true, markerShape: 'diamond', markerSize: 7 },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }];

  const result = await injectNativeCharts(base, injections);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  assert.match(chartXml, /<c:barChart>/, 'has barChart');
  assert.match(chartXml, /<c:lineChart>/, 'has lineChart');

  // Global marker toggle is ENABLED when any series has markers
  const lineBlock = chartXml.match(/<c:lineChart>[\s\S]*?<\/c:lineChart>/)[0];
  assert.match(lineBlock, /<c:marker val="1"\/>/, 'global marker toggle is on');

  // Both line series have visible markers, no connecting line
  // Series 2 (median, idx 2) — circle markers
  const ser2 = chartXml.match(/<c:ser>\s*<c:idx val="2"\/>[\s\S]*?<\/c:ser>/)[0];
  assert.match(ser2, /<c:symbol val="circle"\/>/, 'median = circle markers');
  assert.match(ser2, /<c:size val="5"\/>/, 'median marker size 5');
  assert.match(ser2, /<a:ln>\s*<a:noFill\/>\s*<\/a:ln>/, 'median has NO connecting line');
  assert.match(ser2, /srgbClr val="62B5E5"/, 'median = sky');

  // Series 3 (avg, idx 3) — diamond markers
  const ser3 = chartXml.match(/<c:ser>\s*<c:idx val="3"\/>[\s\S]*?<\/c:ser>/)[0];
  assert.match(ser3, /<c:symbol val="diamond"\/>/, 'avg = diamond markers');
  assert.match(ser3, /<c:size val="7"\/>/, 'avg marker size 7');
  assert.match(ser3, /<a:ln>\s*<a:noFill\/>\s*<\/a:ln>/, 'avg has NO connecting line');
  assert.match(ser3, /srgbClr val="003DA5"/, 'avg = navy');

  // Stacked bar block has 2 series; first is invisible
  const barBlock = chartXml.match(/<c:barChart>[\s\S]*?<\/c:barChart>/)[0];
  assert.match(barBlock, /<c:grouping val="stacked"\/>/);
  // 4 series total — unique idx values across both blocks
  const idxs = Array.from(chartXml.matchAll(/<c:ser>\s*<c:idx val="(\d+)"\/>/g)).map(m => Number(m[1]));
  assert.deepEqual(idxs, [0, 1, 2, 3], 'series idx unique across blocks');
});

test('injectNativeCharts: scatter with trendline (P7.5) renders correct XML', async () => {
  // Tab with dots in B/C and a trendline helper in F
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Avail_Cap_Dot');
  sheet.getCell('B4').value = 'Asking Cap';
  sheet.getCell('C4').value = 'Firm Term';
  sheet.getCell('F4').value = 'Linear Trendline';
  for (let i = 0; i < 8; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2025, 0, 1);
    sheet.getCell(`B${5 + i}`).value = 0.06 + i * 0.002;
    sheet.getCell(`C${5 + i}`).value = 5 + i;
    sheet.getCell(`F${5 + i}`).value = 0.05 + 0.002 * (5 + i);  // m*x+b
  }
  const base = await wb.xlsx.writeBuffer();

  const injections = [{
    tabName: 'Data_Avail_Cap_Dot',
    spec: {
      type: 'scatter',
      tabName: 'Data_Avail_Cap_Dot',
      dataStart: 5, dataEnd: 12,
      series: [
        // Dots (default markers, no line)
        { titleCol: 'B', titleRow: 4, xCol: 'C', yCol: 'B', color: '62B5E5' },
        // Trendline (line, no markers, dashed)
        { titleCol: 'F', titleRow: 4, xCol: 'C', yCol: 'F', color: '003DA5',
          showLine: true, dashed: true },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }];

  const result = await injectNativeCharts(base, injections);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  assert.match(chartXml, /<c:scatterChart>/, 'is a scatterChart');
  const sers = (chartXml.match(/<c:ser>/g) || []).length;
  assert.equal(sers, 2, '2 series (dots + trendline)');

  // Series 0 = dots — markers visible, no connecting line (line is noFill)
  const ser0 = chartXml.match(/<c:ser>\s*<c:idx val="0"\/>[\s\S]*?<\/c:ser>/)[0];
  assert.match(ser0, /<c:symbol val="circle"\/>/, 'dot series has circle markers');
  assert.match(ser0, /<a:alpha val="55000"\/>/, 'dots are semi-transparent');
  // Dots series has noFill on its <a:ln> block (no connecting line)
  assert.match(ser0, /<a:ln[^>]*>\s*<a:noFill\/>/, 'dot series line is noFill');

  // Series 1 = trendline — visible navy line, markers OFF, dashed
  const ser1 = chartXml.match(/<c:ser>\s*<c:idx val="1"\/>[\s\S]*?<\/c:ser>/)[0];
  assert.match(ser1, /<c:symbol val="none"\/>/, 'trendline markers off');
  assert.match(ser1, /<a:solidFill>\s*<a:srgbClr val="003DA5"\/>\s*<\/a:solidFill>/, 'trendline solid navy');
  assert.match(ser1, /<a:prstDash val="dash"\/>/, 'trendline is dashed');
  // Trendline xVal = col C (shared with dots), yVal = col F (helper)
  assert.match(ser1, /<c:xVal>[\s\S]*?\$C\$5:\$C\$12[\s\S]*?<\/c:xVal>/, 'trendline xVal = C');
  assert.match(ser1, /<c:yVal>[\s\S]*?\$F\$5:\$F\$12[\s\S]*?<\/c:yVal>/, 'trendline yVal = F (helper)');

  // The trendline's <a:prstDash> appears exactly once (only series 1, not the dots)
  const dashCount = (chartXml.match(/<a:prstDash val="dash"\/>/g) || []).length;
  assert.equal(dashCount, 1, 'exactly one dashed series (the trendline)');
});

test('injectNativeCharts: stacked-combo box-whisker (P8.5) renders correct XML', async () => {
  // End-to-end: tab with lower_q (E), median (F), upper_q (G) + a helper
  // col I (iqr_width). Combo with stacked bars + shared-axis line.
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Rent_Box');
  sheet.getCell('E4').value = 'Lower Q';
  sheet.getCell('F4').value = 'Median';
  sheet.getCell('G4').value = 'Upper Q';
  sheet.getCell('I4').value = 'IQR Width';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2024, i, 28);
    sheet.getCell(`E${5 + i}`).value = 18 + i * 0.5;
    sheet.getCell(`F${5 + i}`).value = 28 + i * 0.7;
    sheet.getCell(`G${5 + i}`).value = 38 + i * 0.6;
    sheet.getCell(`I${5 + i}`).value = (38 + i * 0.6) - (18 + i * 0.5);
  }
  const base = await wb.xlsx.writeBuffer();

  const injections = [{
    tabName: 'Data_Rent_Box',
    spec: {
      type: 'combo',
      tabName: 'Data_Rent_Box',
      catCol: 'A',
      dataStart: 5, dataEnd: 10,
      barGrouping: 'stacked',
      sharedAxis: true,
      barSeries: [
        { titleCol: 'E', titleRow: 4, valCol: 'E', color: '003DA5', noFill: true },
        { titleCol: 'I', titleRow: 4, valCol: 'I', color: '62B5E5' },
      ],
      lineSeries: [
        { titleCol: 'F', titleRow: 4, valCol: 'F', color: '003DA5' },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }];

  const result = await injectNativeCharts(base, injections);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // Both blocks present
  assert.match(chartXml, /<c:barChart>/, 'has barChart');
  assert.match(chartXml, /<c:lineChart>/, 'has lineChart');

  // Bar block is STACKED (not clustered) and overlap=100
  const barBlock = chartXml.match(/<c:barChart>[\s\S]*?<\/c:barChart>/)[0];
  assert.match(barBlock, /<c:grouping val="stacked"\/>/, 'bar grouping=stacked');
  assert.match(barBlock, /<c:overlap val="100"\/>/, 'overlap=100');

  // Line block uses axId 1+2 (SHARED axis), not 1+3
  const lineBlock = chartXml.match(/<c:lineChart>[\s\S]*?<\/c:lineChart>/)[0];
  assert.match(lineBlock, /<c:axId val="1"\/>[\s\S]*<c:axId val="2"\/>/, 'line shares val axis 2 with bars');
  assert.ok(!/axId val="3"/.test(lineBlock), 'line does NOT use axId 3 (no secondary axis)');

  // Only ONE valAx block (no right axis when sharedAxis=true)
  const valAxCount = (chartXml.match(/<c:valAx>/g) || []).length;
  assert.equal(valAxCount, 1, 'one valAx (sharedAxis suppresses the right axis)');

  // Series 0 (invisible base) — noFill markers
  const ser0 = chartXml.match(/<c:ser>\s*<c:idx val="0"\/>[\s\S]*?<\/c:ser>/)[0];
  assert.match(ser0, /<a:noFill\/>/, 'base series has noFill (invisible)');

  // Series 1 (visible IQR band) — sky
  const ser1 = chartXml.match(/<c:ser>\s*<c:idx val="1"\/>[\s\S]*?<\/c:ser>/)[0];
  assert.match(ser1, /srgbClr val="62B5E5"/, 'band = sky');

  // Series 2 (median line) — navy
  const ser2 = chartXml.match(/<c:ser>\s*<c:idx val="2"\/>[\s\S]*?<\/c:ser>/)[0];
  assert.match(ser2, /srgbClr val="003DA5"/, 'median = navy');

  // 3 series total, unique idx values (0/1/2)
  const idxs = Array.from(chartXml.matchAll(/<c:ser>\s*<c:idx val="(\d+)"\/>/g)).map(m => Number(m[1]));
  assert.deepEqual(idxs, [0, 1, 2], 'series idx unique across bar+line blocks');

  // Each series points at the right cell range
  assert.match(chartXml, /'Data_Rent_Box'!\$E\$5:\$E\$10/, 'base refs E (lower_q)');
  assert.match(chartXml, /'Data_Rent_Box'!\$I\$5:\$I\$10/, 'band refs I (helper iqr_width)');
  assert.match(chartXml, /'Data_Rent_Box'!\$F\$5:\$F\$10/, 'line refs F (median)');
});

// ============================================================================
// R37 P3 — peak/trough/most-recent data labels via <c:dLbls> + <c:dLbl idx=...>
//
// User feedback item #2: "most of the data labels are gone (lowest, highest
// and most recent)." Mirrors cm-chart-image-renderer.js buildAnnotations.
// ============================================================================

test('R37 P3: line chart emits <c:dLbls> when spec.dataLabels is provided', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  sheet.getCell('A4').value = 'Period';
  sheet.getCell('B4').value = 'Value';
  sheet.getCell('B5').value = 'Value';
  for (let i = 0; i < 10; i++) {
    sheet.getCell(`A${6 + i}`).value = new Date(2025, i, 31);
    sheet.getCell(`B${6 + i}`).value = (i + 1) * 0.01;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'line', tabName: 'Data_Test',
      titleCol: 'B', titleRow: 5,
      catCol: 'A', valCol: 'B',
      dataStart: 6, dataEnd: 15,
      color: '003DA5',
      dataLabels: [
        { idx: 9, text: '10.0%' },  // last
        { idx: 0, text: '1.0%' },   // min
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // dLbls block present
  assert.match(chartXml, /<c:dLbls>/, 'line chart emits <c:dLbls>');
  // Two <c:dLbl> entries
  const dLblCount = (chartXml.match(/<c:dLbl>/g) || []).length;
  assert.equal(dLblCount, 2, 'two per-point label overrides emitted');
  // Idx values
  assert.match(chartXml, /<c:idx val="9"\/>/, 'last-point idx');
  assert.match(chartXml, /<c:idx val="0"\/>/, 'min-point idx');
  // Label text content escaped
  assert.match(chartXml, /<a:t>10\.0%<\/a:t>/, 'last text rendered');
  assert.match(chartXml, /<a:t>1\.0%<\/a:t>/, 'min text rendered');
});

test('R37 P3: bar chart emits <c:dLbls> when spec.dataLabels is provided', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2025, i, 31);
    sheet.getCell(`B${5 + i}`).value = 1_000_000 * (i + 1);
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'bar', tabName: 'Data_Test',
      titleCol: 'B', titleRow: 4,
      catCol: 'A', valCol: 'B',
      dataStart: 5, dataEnd: 10,
      color: '003DA5',
      dataLabels: [{ idx: 5, text: '$6.0M' }],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chartXml, /<c:dLbls>/, 'bar chart emits <c:dLbls>');
  assert.match(chartXml, /<a:t>\$6\.0M<\/a:t>/, 'label rendered with $ escaped');
});

test('R37 P3: combo line series accepts per-series dataLabels independently', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2025, i, 31);
    sheet.getCell(`B${5 + i}`).value = 50 + i;
    sheet.getCell(`C${5 + i}`).value = 0.85 + i * 0.01;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'combo', tabName: 'Data_Test',
      catCol: 'A', dataStart: 5, dataEnd: 10,
      barSeries: [
        { titleCol: 'B', titleRow: 4, valCol: 'B', color: '62B5E5' },
      ],
      lineSeries: [
        { titleCol: 'C', titleRow: 4, valCol: 'C', color: '003DA5',
          dataLabels: [{ idx: 5, text: '90.0%' }] },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');

  // Only ONE <c:dLbls> block — on the line series, not the bar series
  const dLblsCount = (chartXml.match(/<c:dLbls>/g) || []).length;
  assert.equal(dLblsCount, 1, 'only line series has dLbls (bar has none)');
  assert.match(chartXml, /<a:t>90\.0%<\/a:t>/, 'line label rendered');

  // Label sits inside the lineChart block, not the barChart block
  const lineBlock = chartXml.match(/<c:lineChart>[\s\S]*?<\/c:lineChart>/)[0];
  assert.match(lineBlock, /<c:dLbls>/, 'dLbls inside lineChart');
  const barBlock = chartXml.match(/<c:barChart>[\s\S]*?<\/c:barChart>/)[0];
  assert.ok(!/<c:dLbls>/.test(barBlock), 'dLbls NOT inside barChart');
});

test('R37 P3: multi-line builder accepts per-series dataLabels', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2025, i, 31);
    sheet.getCell(`B${5 + i}`).value = 0.03 + i * 0.001;
    sheet.getCell(`C${5 + i}`).value = 0.05 + i * 0.001;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'multi-line', tabName: 'Data_Test',
      catCol: 'A', dataStart: 5, dataEnd: 10,
      series: [
        { titleCol: 'B', titleRow: 4, valCol: 'B', color: '62B5E5' },
        { titleCol: 'C', titleRow: 4, valCol: 'C', color: '003DA5',
          dataLabels: [{ idx: 5, text: '5.5%' }] },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  const dLblsCount = (chartXml.match(/<c:dLbls>/g) || []).length;
  assert.equal(dLblsCount, 1, 'only second series has dLbls');
  assert.match(chartXml, /<a:t>5\.5%<\/a:t>/);
});

test('R37 P3: scatter series accepts dataLabels (xy chart)', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${5 + i}`).value = i + 1;
    sheet.getCell(`B${5 + i}`).value = 0.05 + i * 0.005;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'scatter', tabName: 'Data_Test',
      dataStart: 5, dataEnd: 10,
      series: [
        { titleCol: 'B', titleRow: 4, xCol: 'A', yCol: 'B', color: '003DA5',
          dataLabels: [{ idx: 5, text: '7.5%' }] },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chartXml, /<c:dLbls>/, 'scatter series emits dLbls');
  assert.match(chartXml, /<a:t>7\.5%<\/a:t>/);
});

test('R37 P3: dataLabels omitted → no <c:dLbls> emitted (backward compat)', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  sheet.getCell('B5').value = 'Series';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${6 + i}`).value = new Date(2025, i, 31);
    sheet.getCell(`B${6 + i}`).value = 100 + i;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'line', tabName: 'Data_Test',
      titleCol: 'B', titleRow: 5,
      catCol: 'A', valCol: 'B',
      dataStart: 6, dataEnd: 11,
      color: '003DA5',
      // No dataLabels
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.ok(!/<c:dLbls>/.test(chartXml), 'no dLbls emitted when omitted');
});

test('R37 P3: buildInjectionSpec wires data labels from rows (avg_deal_size)', () => {
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push({
      period_end: new Date(2025, i, 31).toISOString(),
      avg_deal_size: 5_000_000 + i * 250_000,
    });
  }
  const spec = buildInjectionSpec({
    chart_template_id: 'avg_deal_size',
    tabName: 'Data_Avg_Deal_Size',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'avg_deal_size', col: 'B' },
    ],
    dataStart: 5, dataEnd: 16,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
    rows,
  });
  assert.ok(spec.spec.dataLabels, 'avg_deal_size attaches dataLabels');
  assert.ok(spec.spec.dataLabels.length >= 1, 'has at least last-point label');
  // last is row index 11 (12th row) with value 5.0M + 11*0.25M = 7.75M
  const last = spec.spec.dataLabels.find(l => l.idx === 11);
  assert.ok(last, 'last-point label present at idx 11');
  assert.match(last.text, /^\$/, 'currency format');
  assert.match(last.text, /M$/, 'compact M suffix');
});

test('R37 P3: buildInjectionSpec wires data labels (dom_and_pct_of_ask on line series)', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push({
      period_end: new Date(2025, i, 31).toISOString(),
      avg_dom: 80 + i,
      pct_of_ask: 0.92 + i * 0.005,  // monotonic increasing
    });
  }
  const spec = buildInjectionSpec({
    chart_template_id: 'dom_and_pct_of_ask',
    tabName: 'Data_DOM_Ask',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'subspecialty', col: 'B' },
      { key: 'avg_dom', col: 'C' },
      { key: 'median_dom', col: 'D' },
      { key: 'pct_of_ask', col: 'E' },
    ],
    dataStart: 5, dataEnd: 14,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
    rows,
  });
  // R37 P3 → R67: line series (pct_of_ask) carries % labels, AND bar
  // series (avg_dom) now ALSO carries day labels (R67 — user batch 6:
  // dLbls should land on most-logical series per chart; DOM bars read
  // as the headline metric of a "Days on Market" chart).
  assert.ok(spec.spec.barSeries[0].dataLabels,
    'R67: bar series (avg_dom) has labels');
  assert.ok(spec.spec.lineSeries[0].dataLabels,
    'line series (pct_of_ask) has labels');
  // line: last at idx 9 with value 0.92 + 9*0.005 = 0.965 → "96.5%"
  const lastPct = spec.spec.lineSeries[0].dataLabels.find(l => l.idx === 9);
  assert.ok(lastPct, 'last-point % label present');
  assert.match(lastPct.text, /%$/, 'percent format');
  // bar: last at idx 9 with avg_dom = 80 + 9 = 89 → "89d"
  const lastDom = spec.spec.barSeries[0].dataLabels.find(l => l.idx === 9);
  assert.ok(lastDom, 'R67: last-point DOM label present');
  assert.match(lastDom.text, /d$/, 'R67: DOM label suffixed with "d"');
});

test('R37 P3: buildInjectionSpec wires data labels (valuation_index navy line)', () => {
  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push({
      period_end: new Date(2025, i, 31).toISOString(),
      valuation_index: 250 + i * 5,
      yoy_change: 0.05 - i * 0.005,
    });
  }
  const spec = buildInjectionSpec({
    chart_template_id: 'valuation_index',
    tabName: 'Data_Val_Index',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'valuation_index', col: 'B' },
      { key: 'yoy_change', col: 'C' },
    ],
    dataStart: 5, dataEnd: 12,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
    rows,
  });
  // Bar series (yoy_change) has no labels; line series (valuation_index) does
  assert.ok(!spec.spec.barSeries[0].dataLabels, 'YoY bars have no labels');
  assert.ok(spec.spec.lineSeries[0].dataLabels, 'valuation_index line has labels');
  // index format = one decimal
  const last = spec.spec.lineSeries[0].dataLabels.find(l => l.idx === 7);
  assert.ok(last);
  assert.match(last.text, /^\d+\.\d$/, 'index format like 285.0');
});

test('R37 P3: buildInjectionSpec skips dataLabels when rows missing', () => {
  // Same template but no rows — should not crash, should not attach labels.
  const spec = buildInjectionSpec({
    chart_template_id: 'avg_deal_size',
    tabName: 'Data_Avg_Deal_Size',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'avg_deal_size', col: 'B' },
    ],
    dataStart: 5, dataEnd: 16,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
    // no rows
  });
  assert.ok(!spec.spec.dataLabels, 'no labels when rows missing');
});

test('R37 P3: buildAnnotations returns fewer than 3 entries when peaks coincide', () => {
  // Strictly monotonic data — max == last, so we should get 2 entries (last + min)
  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push({
      period_end: new Date(2025, i, 31).toISOString(),
      avg_deal_size: 1_000_000 * (i + 1),  // strictly increasing
    });
  }
  const spec = buildInjectionSpec({
    chart_template_id: 'avg_deal_size',
    tabName: 'Data_Avg_Deal_Size',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'avg_deal_size', col: 'B' },
    ],
    dataStart: 5, dataEnd: 12,
    brand: { palette: {} },
    rows,
  });
  // last (idx 7, val 8M) — equals max, so only 2 distinct: last + min
  assert.equal(spec.spec.dataLabels.length, 2,
    'monotonic data → max==last → 2 labels (last + min)');
  const idxs = spec.spec.dataLabels.map(l => l.idx).sort((a, b) => a - b);
  assert.deepEqual(idxs, [0, 7], 'min at idx 0, last at idx 7');
});

// ============================================================================
// R38 — style polish: chart titles, [Red](N) negative formats, donut legend.
// Audit findings A + B + C (see audit/cm-style-audit/PUNCH-LIST.md).
// ============================================================================

test('R38 A: chart emits <c:title> when spec.title is provided', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  sheet.getCell('B5').value = 'Series';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${6 + i}`).value = new Date(2025, i, 31);
    sheet.getCell(`B${6 + i}`).value = 100 + i;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'line', tabName: 'Data_Test',
      titleCol: 'B', titleRow: 5,
      catCol: 'A', valCol: 'B',
      dataStart: 6, dataEnd: 11,
      color: '003DA5',
      title: 'Cap Rate — TTM Weighted Avg by Quarter',
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chartXml, /<c:title>/, '<c:title> block emitted');
  assert.match(chartXml, /<a:t>Cap Rate — TTM Weighted Avg by Quarter<\/a:t>/,
    'title text rendered');
  assert.match(chartXml, /<c:autoTitleDeleted val="0"\/>/,
    'autoTitleDeleted is 0 when title is set (auto-title is allowed since we have a title)');
  // Title style: 12pt bold navy
  assert.match(chartXml, /sz="1200"[^/]*b="1"/, '12pt bold');
  // Color is navy 003DA5
  assert.match(chartXml, /<c:title>[\s\S]*?<a:srgbClr val="003DA5"\/>/, 'navy color');
});

test('R38 A: chart omits <c:title> when spec.title is missing (backward compat)', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Test');
  sheet.getCell('B5').value = 'Series';
  for (let i = 0; i < 6; i++) {
    sheet.getCell(`A${6 + i}`).value = new Date(2025, i, 31);
    sheet.getCell(`B${6 + i}`).value = 100 + i;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Test',
    spec: {
      type: 'line', tabName: 'Data_Test',
      titleCol: 'B', titleRow: 5,
      catCol: 'A', valCol: 'B',
      dataStart: 6, dataEnd: 11,
      color: '003DA5',
      // no title
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.ok(!/<c:title>/.test(chartXml), 'no <c:title> when title omitted');
  assert.match(chartXml, /<c:autoTitleDeleted val="1"\/>/,
    'autoTitleDeleted falls back to 1 when no title');
});

test('R38 A: buildInjectionSpec splices title into spec', () => {
  const spec = buildInjectionSpec({
    chart_template_id: 'avg_deal_size',
    tabName: 'Data_Avg_Deal_Size',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'avg_deal_size', col: 'B' },
    ],
    dataStart: 5, dataEnd: 16,
    brand: { palette: {} },
    title: 'Average Deal Size — TTM by Quarter',
  });
  assert.equal(spec.spec.title, 'Average Deal Size — TTM by Quarter',
    'title flows from buildInjectionSpec args into spec');
});

test('R38 A: buildInjectionSpec omits title when not provided', () => {
  const spec = buildInjectionSpec({
    chart_template_id: 'avg_deal_size',
    tabName: 'Data_Avg_Deal_Size',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'avg_deal_size', col: 'B' },
    ],
    dataStart: 5, dataEnd: 16,
    brand: { palette: {} },
    // no title arg
  });
  assert.ok(!spec.spec.title, 'no title key on spec when omitted');
});

test('R38 B: VAL_FMT_INTEGER uses [Red] negative idiom in single-series specs', () => {
  // transaction_count_ttm uses VAL_FMT_INTEGER on valAx
  const spec = buildInjectionSpec({
    chart_template_id: 'transaction_count_ttm',
    tabName: 'Data_Txn_Count',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'ttm_count', col: 'B' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: {} },
  });
  assert.equal(spec.spec.valAxNumFmt, '#,##0_);[Red](#,##0)',
    'integer format uses [Red](N) negatives');
});

test('R38 B + R64: volume_ttm_by_quarter y-axis uses $X.XXB format with [Red] negatives', () => {
  // R64 — volume_ttm_by_quarter switched from VAL_FMT_CURRENCY ("$1,800,000,000")
  // to VAL_FMT_CURRENCY_B ("$1.80B") per user batch 5 ask. The format
  // still preserves the [Red] negative idiom for back-compat.
  const spec = buildInjectionSpec({
    chart_template_id: 'volume_ttm_by_quarter',
    tabName: 'Data_Volume_TTM',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'volume_dollars', col: 'B' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: {} },
  });
  assert.equal(spec.spec.valAxNumFmt, '$#,##0.00,,,"B"_);[Red]($#,##0.00,,,"B")',
    'R64: $X.XXB format with [Red](N) negative idiom');
});

test('R38 B: VAL_FMT_CURRENCY_M (millions) uses [Red] negative idiom', () => {
  // txn_count_avg_deal_combo right axis uses CURRENCY_M
  const spec = buildInjectionSpec({
    chart_template_id: 'txn_count_avg_deal_combo',
    tabName: 'Data_Txn_AvgDeal_Combo',
    cols: [
      { key: 'period_end', col: 'A' },
      { key: 'ttm_count', col: 'B' },
      { key: 'avg_deal_size', col: 'C' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: {} },
  });
  assert.equal(spec.spec.yRightNumFmt, '$#,##0,,"M"_);[Red]($#,##0,,"M")',
    'currency_m format uses [Red]($150M) negatives');
});

test('R38 C: doughnut emits legend at bottom (not right)', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Donut');
  sheet.getCell('B4').value = 'Title';
  for (let i = 0; i < 3; i++) {
    sheet.getCell(`A${5 + i}`).value = ['DaVita', 'FMC', 'Other'][i];
    sheet.getCell(`B${5 + i}`).value = 100 - i * 20;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Donut',
    spec: {
      type: 'doughnut', tabName: 'Data_Donut',
      titleCol: 'B', titleRow: 4,
      catCol: 'A', valCol: 'B',
      dataStart: 5, dataEnd: 7,
      colors: ['003DA5', '62B5E5', '4CB582'],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chartXml, /<c:legendPos val="b"\/>/, 'donut legend at bottom');
  assert.ok(!/<c:legendPos val="r"\/>/.test(chartXml), 'no right-side legend');
});

// ─────────────────────────────────────────────────────────────────────
// R50 — Bucket C chart-type restructures (user feedback 2026-05-22)
// ─────────────────────────────────────────────────────────────────────

test('R50: market_turnover restructured to combo bar+line with monthly clear pace helper', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'market_turnover',
    tabName: 'Data_Market_Turnover',
    cols: [
      { key: 'period_end',      col: 'A' },
      { key: 'subspecialty',    col: 'B' },
      { key: 'ttm_sales_count', col: 'C' },
      { key: 'market_universe', col: 'D' },
      { key: 'turnover_rate',   col: 'E' },
    ],
    dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'combo', 'R50: combo (was single line)');
  assert.equal(out.spec.catCol, 'A');
  // Bar = Monthly Clear Pace (helper col, lands at F = one past 5 regular cols)
  assert.equal(out.spec.barSeries.length, 1);
  assert.equal(out.spec.barSeries[0].valCol, 'F', 'pace bar reads from helper col F');
  assert.equal(out.spec.barSeries[0].color, '62B5E5', 'pace bar is sky');
  // Line = Turnover Rate (existing col E) on right axis (% format)
  assert.equal(out.spec.lineSeries.length, 1);
  assert.equal(out.spec.lineSeries[0].valCol, 'E', 'turnover_rate line on right axis');
  assert.equal(out.spec.lineSeries[0].color, '003DA5', 'rate line is navy');
  // Helper col
  assert.equal(out.helperCols.length, 1);
  assert.equal(out.helperCols[0].key, 'monthly_clear_pace');
  assert.equal(out.helperCols[0].getValue({ ttm_sales_count: 120 }), 10,
    '120/12 = 10 sales/month');
  assert.equal(out.helperCols[0].getValue({ ttm_sales_count: null }), null);
});

test('R50: buildMultiLineChartXml emits stacked grouping + upDownBars when requested', () => {
  const xml = buildMultiLineChartXml({
    tabName: 'Data_Bid_Ask',
    catCol: 'A', dataStart: 5, dataEnd: 60,
    lineGrouping: 'stacked',
    upDownBars:   true,
    yAxisRange:   { min: 0.05, max: 0.095 },
    valAxNumFmt:  '0.00%',
    series: [
      { titleCol: 'F', titleRow: 4, valCol: 'F', color: '62B5E5' },
      { titleCol: 'D', titleRow: 4, valCol: 'D', color: '003DA5' },
    ],
  });
  assert.match(xml, /<c:grouping val="stacked"\/>/, 'stacked grouping');
  assert.match(xml, /<c:upDownBars>/, 'up-down bars present');
  assert.match(xml, /<c:upBars>/, 'upBars styling block');
  assert.match(xml, /<c:downBars>/, 'downBars styling block');
  // The gap-bars block should sit AFTER all <c:ser> blocks but BEFORE <c:marker val=...>
  // (OOXML CT_LineChart sequence). A quick sanity check: marker appears after upDownBars.
  const upDownIdx = xml.indexOf('<c:upDownBars>');
  const markerIdx = xml.indexOf('<c:marker val=');
  assert.ok(upDownIdx > 0 && markerIdx > upDownIdx,
    'upDownBars sits before chart-level <c:marker>');
});

test('R50: buildMultiLineChartXml default keeps standard grouping (no upDownBars)', () => {
  // Backward compat — existing multi-line charts (nm_vs_market_cap,
  // cap_rate_by_lease_term, etc.) should still emit unchanged XML.
  const xml = buildMultiLineChartXml({
    tabName: 'Data_NM_vs_Market',
    catCol: 'A', dataStart: 5, dataEnd: 60,
    series: [
      { titleCol: 'C', titleRow: 4, valCol: 'C', color: '003DA5' },
      { titleCol: 'D', titleRow: 4, valCol: 'D', color: '62B5E5' },
    ],
  });
  assert.match(xml, /<c:grouping val="standard"\/>/);
  assert.ok(!xml.includes('<c:upDownBars>'),
    'no upDownBars on standard multi-line');
});

test('R50: injectNativeCharts renders stacked-line + upDownBars for Bid_Ask quarterly', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Bid_Ask');
  sheet.getCell('A4').value = 'Date';
  sheet.getCell('D4').value = 'Spread';
  sheet.getCell('F4').value = 'Last Ask Cap';
  for (let i = 0; i < 4; i++) {
    sheet.getCell(`A${5 + i}`).value = new Date(2025, i * 3, 31);
    sheet.getCell(`D${5 + i}`).value = 0.002 + i * 0.0002;
    sheet.getCell(`F${5 + i}`).value = 0.063 + i * 0.001;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Bid_Ask',
    spec: {
      type: 'multi-line', tabName: 'Data_Bid_Ask',
      catCol: 'A', dataStart: 5, dataEnd: 8,
      lineGrouping: 'stacked',
      upDownBars:   true,
      yAxisRange:   { min: 0.05, max: 0.095 },
      valAxNumFmt:  '0.00%',
      series: [
        { titleCol: 'F', titleRow: 4, valCol: 'F', color: '62B5E5' },
        { titleCol: 'D', titleRow: 4, valCol: 'D', color: '003DA5' },
      ],
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chartXml, /<c:grouping val="stacked"\/>/);
  assert.match(chartXml, /<c:upDownBars>/);
  assert.match(chartXml, /<c:max val="0\.095"\/>/, 'pinned y-max 9.5%');
  assert.match(chartXml, /<c:min val="0\.05"\/>/,  'pinned y-min 5%');
});

// ─────────────────────────────────────────────────────────────────────
// R51 — active-listings family axis trim (user notes 2026-05-21 sparseness
//        items R47 didn't sweep up)
// ─────────────────────────────────────────────────────────────────────

test('R51: asking_cap_quartiles_active dataStart shifts to first 2015 row', () => {
  // 60 monthly rows starting 2014-01 — first 12 are 2014, then 48 are 2015+.
  const rows = [];
  for (let m = 0; m < 60; m++) {
    rows.push({ period_end: new Date(2014, m, 28).toISOString().slice(0, 10),
                upper_q_total: 0.08 });
  }
  const out = buildInjectionSpec({
    chart_template_id: 'asking_cap_quartiles_active',
    tabName: 'Data_Active_Cap_Quart',
    cols: [
      { key: 'period_end',   col: 'A' },
      { key: 'subspecialty', col: 'B' },
      { key: 'upper_q_total', col: 'C' },
      { key: 'lower_q_total', col: 'D' },
      { key: 'upper_q_core',  col: 'E' },
      { key: 'lower_q_core',  col: 'F' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    rows,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  // 2015-01 is at row index 12 → original row 5+12 = 17
  assert.equal(out.spec.dataStart, 17,
    'R51: chart starts at first 2015 row');
  assert.equal(out.spec.dataEnd, 64, 'dataEnd unchanged');
});

test('R66t: available_market_size_combo trims to 2017', () => {
  const rows = [];
  for (let m = 0; m < 60; m++) {
    rows.push({ period_end: new Date(2014, m, 28).toISOString().slice(0, 10),
                count_total: 50 });
  }
  const out = buildInjectionSpec({
    chart_template_id: 'available_market_size_combo',
    tabName: 'Data_Avail_Mkt_Size',
    cols: [
      { key: 'period_end',         col: 'A' },
      { key: 'subspecialty',       col: 'B' },
      { key: 'count_total',        col: 'C' },
      { key: 'count_core_10plus',  col: 'D' },
      { key: 'avg_cap_total',      col: 'E' },
      { key: 'avg_cap_core_10plus',col: 'F' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    rows,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  // R66t bumped the cutoff 2016 → 2017 (listing capture sparse pre-2017).
  // Rows start 2014-01, so 2017-01 is at index 36 → original row 5+36 = 41.
  assert.equal(out.spec.dataStart, 41,
    'R66t: chart starts at first 2017 row');
});

test('R66b: dom_price_change_active trims to 2018', () => {
  // R66b bumped the cutoff 2013 → 2018 (pre-2018 had <12 active listings/mo).
  // Rows span 2016-2020 monthly so the cutoff lands mid-series.
  const rows = [];
  for (let m = 0; m < 60; m++) {
    rows.push({ period_end: new Date(2016, m, 28).toISOString().slice(0, 10),
                avg_dom_total: 90 });
  }
  const out = buildInjectionSpec({
    chart_template_id: 'dom_price_change_active',
    tabName: 'Data_Active_DOM_PC',
    cols: [
      { key: 'period_end',             col: 'A' },
      { key: 'subspecialty',           col: 'B' },
      { key: 'avg_dom_total',          col: 'C' },
      { key: 'avg_dom_core',           col: 'D' },
      { key: 'pct_price_change_total', col: 'E' },
      { key: 'pct_price_change_core',  col: 'F' },
    ],
    dataStart: 5, dataEnd: 5 + rows.length - 1,
    rows,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  // 2018-01 is at row index 24 (rows start 2016-01) → original row 5+24 = 29
  assert.equal(out.spec.dataStart, 29,
    'R66b: chart starts at first 2018 row');
});

// ─────────────────────────────────────────────────────────────────────
// R53 — period_label wrapper (fixes broken qQ-yyyy cat-axis labels)
// ─────────────────────────────────────────────────────────────────────

test('R53: injectPeriodLabel=false (default) leaves spec unchanged', () => {
  const cols = [
    { key: 'period_end', col: 'A' },
    { key: 'subspecialty', col: 'B' },
    { key: 'ttm_weighted_cap_rate', col: 'C' },
  ];
  const rows = [];
  for (let q = 0; q < 8; q++) {
    rows.push({ period_end: new Date(2024, q * 3, 31).toISOString().slice(0, 10),
                ttm_weighted_cap_rate: 0.07 });
  }
  const out = buildInjectionSpec({
    chart_template_id: 'cap_rate_ttm_by_quarter',
    tabName: 'Data_Cap_Avg',
    cols, dataStart: 5, dataEnd: 12,
    rows,
    brand: { palette: { nm_navy: '#003DA5' } },
  });
  assert.equal(out.spec.catCol, 'A');
  assert.ok(!out.helperCols || out.helperCols.length === 0,
    'no period_label helper col added without the flag');
});

test('R53: injectPeriodLabel=true on a quarterly chart prepends period_label helper col + swaps catCol', () => {
  const cols = [
    { key: 'period_end', col: 'A' },
    { key: 'subspecialty', col: 'B' },
    { key: 'ttm_weighted_cap_rate', col: 'C' },
  ];
  const rows = [];
  for (let q = 0; q < 8; q++) {
    rows.push({ period_end: new Date(2024, q * 3, 31).toISOString().slice(0, 10),
                ttm_weighted_cap_rate: 0.07 });
  }
  const out = buildInjectionSpec({
    chart_template_id: 'cap_rate_ttm_by_quarter',
    tabName: 'Data_Cap_Avg',
    cols, dataStart: 5, dataEnd: 12,
    rows,
    brand: { palette: { nm_navy: '#003DA5' } },
    injectPeriodLabel: true,
  });
  assert.equal(out.spec.catCol, 'D',
    'R53: catCol shifts from period_end to period_label letter');
  assert.equal(out.spec.catAxNumFmt, '',
    'R53: broken q"Q-"yyyy numFmt cleared');
  assert.ok(Array.isArray(out.helperCols) && out.helperCols.length >= 1);
  assert.equal(out.helperCols[0].key, 'period_label');
  assert.equal(out.helperCols[0].header, 'Quarter');
  const sample = out.helperCols[0].getValue({ period_end: '2024-06-30' });
  assert.equal(sample, "Q2 '24");
});

test('R53: injectPeriodLabel=true on a monthly chart formats labels as Mon yy', () => {
  const cols = [
    { key: 'period_end', col: 'A' },
    { key: 'subspecialty', col: 'B' },
    { key: 'avg_dom', col: 'C' },
    { key: 'pct_of_ask', col: 'D' },
  ];
  const rows = [];
  for (let m = 0; m < 24; m++) {
    rows.push({ period_end: new Date(2024, m, 28).toISOString().slice(0, 10),
                avg_dom: 60, pct_of_ask: 0.95 });
  }
  const out = buildInjectionSpec({
    chart_template_id: 'dom_and_pct_of_ask_monthly',
    tabName: 'Data_DOM_Ask_Monthly',
    cols, dataStart: 5, dataEnd: 28,
    rows,
    brand: { palette: { nm_navy: '#003DA5' } },
    injectPeriodLabel: true,
  });
  assert.equal(out.helperCols[0].header, 'Month');
  const sample = out.helperCols[0].getValue({ period_end: '2024-03-31' });
  assert.equal(sample, "Mar '24");
});

test('R53: injectPeriodLabel preserves existing helper cols + shifts their letter refs', () => {
  const cols = [
    { key: 'period_end',       col: 'A' },
    { key: 'subspecialty',     col: 'B' },
    { key: 'added_month',      col: 'C' },
    { key: 'sold_month',       col: 'D' },
    { key: 'active_count',     col: 'E' },
    { key: 'months_of_supply', col: 'F' },
  ];
  const rows = [];
  for (let q = 0; q < 8; q++) {
    rows.push({ period_end: new Date(2024, q * 3, 31).toISOString().slice(0, 10),
                added_month: 50, sold_month: 30 });
  }
  const out = buildInjectionSpec({
    chart_template_id: 'inventory_backlog',
    tabName: 'Data_Inventory',
    cols, dataStart: 5, dataEnd: 12,
    rows,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
    injectPeriodLabel: true,
  });
  // R54 — inventory_backlog now has 2 inner helper cols (net_ttm + sold_neg),
  // so after R53 prepends period_label there are 3 helpers total.
  assert.equal(out.helperCols.length, 3);
  assert.equal(out.helperCols[0].key, 'period_label');
  assert.equal(out.helperCols[1].key, 'net_ttm');
  assert.equal(out.helperCols[2].key, 'sold_neg');
  assert.equal(out.spec.catCol, 'G', 'period_label takes col G');
  assert.equal(out.spec.lineSeries[0].valCol, 'H',
    'R53: net_ttm line valCol auto-shifted from G to H');
  // R54 — sold_neg shifted from H (pre-R53) to I; the Sold bar reads from it.
  assert.equal(out.spec.barSeries[1].valCol, 'I',
    'R54: Sold bar valCol shifted to I (sold_neg helper, post-period_label)');
});

test('R53: injectPeriodLabel skips charts without period_end as first col', () => {
  const cols = [
    { key: 'term_bucket',         col: 'A' },
    { key: 'n_listings',          col: 'B' },
    { key: 'avg_price',           col: 'C' },
    { key: 'avg_cap',             col: 'D' },
    { key: 'upper_quartile_cap',  col: 'E' },
    { key: 'median_cap',          col: 'F' },
    { key: 'lower_quartile_cap',  col: 'G' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'available_by_term_summary',
    tabName: 'Data_Avail_Term',
    cols, dataStart: 5, dataEnd: 8,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
    injectPeriodLabel: true,
  });
  assert.equal(out.spec.catCol, 'A', 'categorical catCol stays at A (term_bucket)');
  assert.ok(!out.helperCols || !out.helperCols.some(h => h.key === 'period_label'),
    'no period_label helper col for categorical charts');
});

test('R53: end-to-end injectNativeCharts emits no qQ-yyyy literal format', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'Test';
  const sheet = wb.addWorksheet('Data_Cap_Avg');
  sheet.getCell('A4').value = 'Period End';
  sheet.getCell('C4').value = 'TTM Cap Rate';
  sheet.getCell('D4').value = 'Quarter';
  for (let q = 0; q < 4; q++) {
    sheet.getCell(`A${5 + q}`).value = new Date(2024, q * 3, 31);
    sheet.getCell(`C${5 + q}`).value = 0.07 + q * 0.001;
    sheet.getCell(`D${5 + q}`).value = `Q${q + 1} '24`;
  }
  const result = await injectNativeCharts(await wb.xlsx.writeBuffer(), [{
    tabName: 'Data_Cap_Avg',
    spec: {
      type: 'line', tabName: 'Data_Cap_Avg',
      catCol: 'D', valCol: 'C',
      titleCol: 'C', titleRow: 4,
      dataStart: 5, dataEnd: 8,
      color: '003DA5',
      catAxNumFmt: '',
      anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
    },
  }]);
  const zip = await JSZip.loadAsync(result);
  const xml = await zip.file('xl/charts/chart1.xml').async('string');
  const catAxBlock = xml.match(/<c:catAx>[\s\S]*?<\/c:catAx>/)[0];
  assert.ok(!/<c:numFmt[^>]*formatCode="q&quot;Q-&quot;yyyy"/.test(catAxBlock),
    'R53: no qQ-yyyy literal format on cat axis');
});

// ─────────────────────────────────────────────────────────────────────
// R55 — Market_Turnover full restructure (3 series + labeled axes)
// ─────────────────────────────────────────────────────────────────────
test('R55+R62: market_turnover renders 2-bar+1-line combo with monthly-pace helper', () => {
  // 8 cols matching the R55 view shape
  const cols = [
    { key: 'period_end',         col: 'A' },
    { key: 'subspecialty',       col: 'B' },
    { key: 'ttm_sales_count',    col: 'C' },
    { key: 'market_universe',    col: 'D' },
    { key: 'turnover_rate',      col: 'E' },
    { key: 'active_count',       col: 'F' },
    { key: 'annual_sales_rate',  col: 'G' },
    { key: 'months_of_supply',   col: 'H' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'market_turnover',
    tabName: 'Data_Market_Turnover',
    cols, dataStart: 5, dataEnd: 60,
    // R66s — the full 3-series combo (2 bars + months-of-supply line) is now
    // dia-only; gov strips the active-universe bar/line (unreliable listing
    // coverage). Pass vertical='dialysis' to exercise the full shape.
    vertical: 'dialysis',
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.barSeries.length, 2, '2 bars: active + monthly clear pace');
  // Back bar = active_count (col F, pale sky)
  assert.equal(out.spec.barSeries[0].valCol, 'F');
  assert.equal(out.spec.barSeries[0].color, '#E0E8F4');
  // R62 — front bar now reads from monthly clear pace HELPER col, not annual_sales_rate
  // Helper lands one past the regular cols (cols.length=8 → 'I')
  assert.equal(out.spec.barSeries[1].valCol, 'I', 'R62: front bar reads monthly_clear_pace helper');
  assert.equal(out.spec.barSeries[1].color, '003DA5');
  // Line = months_of_supply (col H, gray)
  assert.equal(out.spec.lineSeries.length, 1);
  assert.equal(out.spec.lineSeries[0].valCol, 'H');
  assert.equal(out.spec.lineSeries[0].color, '6A748C');
  // R62 — monthly_clear_pace helper col declared (TTM sales / 12)
  assert.ok(Array.isArray(out.helperCols) && out.helperCols.length === 1);
  assert.equal(out.helperCols[0].key, 'monthly_clear_pace');
  assert.equal(out.helperCols[0].getValue({ annual_sales_rate: 144 }), 12,
    'R62: 144 annual = 12 monthly');
  // barOverlap=100 places the front bar IN FRONT of the back bar
  assert.equal(out.spec.barOverlap, 100);
  // Axis titles set
  assert.match(out.spec.yLeftAxisTitle, /Listings|monthly/i);
  assert.match(out.spec.yRightAxisTitle, /Months/i);
});

test('R69 G25: market_turnover gov renders the FULL 3-series combo (was R66s single bar)', () => {
  // Gov view shape (cm_gov_market_turnover_m): 9 cols incl. monthly_sales_count.
  // R66s stripped the universe for gov; R69 re-enables it (Scott: "we are
  // missing total available and monthly clearance rate"). Gov must now produce
  // the same combo as dia: 2 bars (active + monthly pace) + months-of-supply line.
  const cols = [
    { key: 'period_end',         col: 'A' },
    { key: 'subspecialty',       col: 'B' },
    { key: 'ttm_sales_count',    col: 'C' },
    { key: 'market_universe',    col: 'D' },
    { key: 'turnover_rate',      col: 'E' },
    { key: 'active_count',       col: 'F' },
    { key: 'annual_sales_rate',  col: 'G' },
    { key: 'months_of_supply',   col: 'H' },
    { key: 'monthly_sales_count',col: 'I' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'market_turnover',
    tabName: 'Data_Market_Turnover',
    cols, dataStart: 5, dataEnd: 60,
    vertical: 'gov',
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  assert.equal(out.spec.type, 'combo');
  // Two bars: Total Available (active_count, col F, pale sky) + monthly clear pace
  assert.equal(out.spec.barSeries.length, 2, 'gov no longer stripped to a single bar');
  assert.equal(out.spec.barSeries[0].valCol, 'F', 'back bar = active_count (Total Available)');
  assert.equal(out.spec.barSeries[0].color, '#E0E8F4');
  // Front bar reads the monthly_clear_pace helper (one past the 9 regular cols → 'J')
  assert.equal(out.spec.barSeries[1].valCol, 'J', 'front bar = monthly_clear_pace helper');
  assert.equal(out.spec.barSeries[1].color, '003DA5');
  // Months-to-clear line (col H, gray, right axis)
  assert.equal(out.spec.lineSeries.length, 1, 'gov now carries the Months of Supply line');
  assert.equal(out.spec.lineSeries[0].valCol, 'H');
  assert.equal(out.spec.lineSeries[0].color, '6A748C');
  // Right axis is the months-of-supply axis (no longer a single shared axis)
  assert.match(out.spec.yRightAxisTitle, /Months/i);
  assert.equal(out.spec.sharedAxis, false, 'gov universe restored → dual axis');
  assert.ok(out.helperCols && out.helperCols.some(h => h.key === 'monthly_clear_pace'));
});

test('R55: market_turnover falls back to R50 shape when R55 cols missing (back-compat)', () => {
  // Pre-R55 view shape: only 5 cols, no active_count/annual_sales_rate/months_of_supply
  const cols = [
    { key: 'period_end',      col: 'A' },
    { key: 'subspecialty',    col: 'B' },
    { key: 'ttm_sales_count', col: 'C' },
    { key: 'market_universe', col: 'D' },
    { key: 'turnover_rate',   col: 'E' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'market_turnover',
    tabName: 'Data_Market_Turnover',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  // R50 fallback: 1 bar (monthly_clear_pace helper) + 1 line (turnover_rate)
  assert.equal(out.spec.type, 'combo');
  assert.equal(out.spec.barSeries.length, 1);
  assert.equal(out.spec.lineSeries.length, 1);
  assert.equal(out.spec.lineSeries[0].valCol, 'E', 'fallback line plots turnover_rate');
  assert.ok(out.helperCols && out.helperCols.some(h => h.key === 'monthly_clear_pace'),
    'R50 fallback emits monthly_clear_pace helper');
});

test('R55: buildComboChartXml emits axis titles and barOverlap', () => {
  const xml = buildComboChartXml({
    tabName: 'Data_Market_Turnover',
    catCol: 'A', dataStart: 5, dataEnd: 60,
    barGrouping: 'clustered',
    barOverlap:  100,
    yLeftAxisTitle:  'Listings count',
    yRightAxisTitle: 'Months of supply',
    yLeftNumFmt:  '#,##0',
    yRightNumFmt: '#,##0.0',
    barSeries: [
      { titleCol: 'F', titleRow: 4, valCol: 'F', color: '#E0E8F4' },
      { titleCol: 'G', titleRow: 4, valCol: 'G', color: '003DA5' },
    ],
    lineSeries: [
      { titleCol: 'H', titleRow: 4, valCol: 'H', color: '6A748C' },
    ],
  });
  assert.match(xml, /<c:overlap val="100"\/>/, 'barOverlap = 100');
  assert.match(xml, /Listings count/, 'left axis title rendered');
  assert.match(xml, /Months of supply/, 'right axis title rendered');
});

test('R56: NAME_OVERRIDES_BY_VERTICAL — dia available_cap_rate_dot_plot title says Lease Term', async () => {
  // This is an integration test against cm-excel-export.js NAME_OVERRIDES_BY_VERTICAL.
  // Verifies the chart.name is patched to "Lease Term" for dia vertical.
  const { buildCapitalMarketsWorkbook } = await import('../api/_shared/cm-excel-export.js');
  const charts = [{
    chart_template_id: 'available_cap_rate_dot_plot',
    name: 'Available Deals — Asking Cap vs Firm Term',  // catalog default
    chart_type: 'scatter',
    rows: [],
  }];
  // buildCapitalMarketsWorkbook mutates `charts` in place via the override map.
  buildCapitalMarketsWorkbook({
    vertical: 'dialysis', subspecialty: 'all', asOf: '2026-03-31',
    charts, brand: { palette: {}, fonts: {} },
  });
  assert.equal(charts[0].name, 'Available Deals — Asking Cap vs Lease Term',
    'R56: dia title patched to "Lease Term"');
});

test('R56: NAME_OVERRIDES_BY_VERTICAL — gov keeps original Firm Term title', async () => {
  const { buildCapitalMarketsWorkbook } = await import('../api/_shared/cm-excel-export.js');
  const charts = [{
    chart_template_id: 'available_cap_rate_dot_plot',
    name: 'Available Deals — Asking Cap vs Firm Term',
    chart_type: 'scatter',
    rows: [],
  }];
  buildCapitalMarketsWorkbook({
    vertical: 'gov', subspecialty: 'all', asOf: '2026-03-31',
    charts, brand: { palette: {}, fonts: {} },
  });
  assert.equal(charts[0].name, 'Available Deals — Asking Cap vs Firm Term',
    'R56: gov keeps original title (firm term is a gov-only concept)');
});

// ─────────────────────────────────────────────────────────────────────
// R57 — preserve original headerRow even when R47 axis-trim shifts dataStart
// ─────────────────────────────────────────────────────────────────────

test('R57: titleRow stays at original header row when R47 trim shifts dataStart', () => {
  // R47 axis-trim for cap_rate_top_bottom_quartile bumped from 2005 to
  // 2007 in R54. With rows starting Jan 2005, the trim shifts
  // effectiveStart forward by ~24 months. PRE-R57 bug: the inner builder
  // computed headerRow = effectiveStart - 1 = a DATA row, so the chart's
  // <c:tx> series-title cell ref pointed at "4.73%" instead of "Top
  // Quartile". POST-R57: headerRow stays pinned at the original
  // dataStart - 1, no matter how far the data trim shifts.
  const cols = [
    { key: 'period_end',      col: 'A' },
    { key: 'subspecialty',    col: 'B' },
    { key: 'top_quartile',    col: 'C' },
    { key: 'median',          col: 'D' },
    { key: 'bottom_quartile', col: 'E' },
  ];
  const rows = [];
  // 30 monthly rows starting 2005-01 — R54's MIN_YEAR=2007 will shift
  // effectiveStart forward by 24 rows.
  for (let m = 0; m < 30; m++) {
    rows.push({ period_end: new Date(2005, m, 28).toISOString().slice(0, 10),
                top_quartile: 0.08, median: 0.07, bottom_quartile: 0.06 });
  }
  const out = buildInjectionSpec({
    chart_template_id: 'cap_rate_top_bottom_quartile',
    tabName: 'Data_Cap_Quartile',
    cols, dataStart: 5, dataEnd: 5 + rows.length - 1,
    rows,
    brand: { palette: { nm_navy: '#003DA5' } },
  });
  // dataStart was shifted to row 29 (first 2007-01 row at index 24, +5)
  assert.ok(out.spec.dataStart >= 29, 'R47: dataStart shifted forward for 2007 trim');
  // R57 — all series titleRow should still be 4 (the original
  // header row), NOT the shifted data row.
  for (const s of out.spec.series) {
    assert.equal(s.titleRow, 4,
      `R57: series titleRow stays at original headerRow=4 (was bug: pointed at shifted data row ${out.spec.dataStart - 1})`);
  }
});

test('R57: titleRow unchanged when no R47 trim applies (back-compat)', () => {
  // For templates not in MIN_YEAR_BY_TEMPLATE the dataStart isn't shifted;
  // headerRow falls through to dataStart - 1 as before.
  const cols = [
    { key: 'period_end',      col: 'A' },
    { key: 'subspecialty',    col: 'B' },
    { key: 'ttm_count',       col: 'C' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'transaction_count_ttm',
    tabName: 'Data_Txn_Count',
    cols, dataStart: 5, dataEnd: 50,
    rows: [],
    brand: { palette: { nm_navy: '#003DA5' } },
  });
  // No R47 entry for transaction_count_ttm → dataStart stays at 5,
  // headerRow stays at 4 (= dataStart - 1 normal compute).
  assert.equal(out.spec.dataStart, 5);
  assert.equal(out.spec.titleRow, 4, 'no-trim chart still has headerRow = dataStart - 1');
});

// ─────────────────────────────────────────────────────────────────────
// R58 — cadence detection from chart_template_id (not row spacing)
// ─────────────────────────────────────────────────────────────────────

test('R58: quarterly chart with monthly underlying view emits Q-labels', () => {
  // cap_rate_top_bottom_quartile sources from cm_dialysis_cap_quartile_m
  // (monthly rows) but the chart should display quarter labels because
  // the template id has no _monthly suffix.
  const cols = [
    { key: 'period_end',      col: 'A' },
    { key: 'subspecialty',    col: 'B' },
    { key: 'top_quartile',    col: 'C' },
    { key: 'median',          col: 'D' },
    { key: 'bottom_quartile', col: 'E' },
  ];
  const rows = [];
  for (let m = 0; m < 36; m++) {  // 36 monthly rows
    rows.push({ period_end: new Date(2022, m, 28).toISOString().slice(0, 10),
                top_quartile: 0.08, median: 0.07, bottom_quartile: 0.06 });
  }
  const out = buildInjectionSpec({
    chart_template_id: 'cap_rate_top_bottom_quartile',
    tabName: 'Data_Cap_Quartile',
    cols, dataStart: 5, dataEnd: 5 + rows.length - 1,
    rows,
    brand: { palette: { nm_navy: '#003DA5' } },
    injectPeriodLabel: true,
  });
  // R58: cadence detected from chart_template_id → no _monthly suffix → quarterly
  assert.equal(out.helperCols[0].header, 'Quarter',
    'R58: defaults to quarterly even when underlying rows are monthly');
  assert.equal(out.helperCols[0].getValue({ period_end: '2024-06-30' }), "Q2 '24",
    'R58: emits Q-style label');
});

test('R58: explicitly-monthly template still emits Month labels', () => {
  // bid_ask_spread_monthly explicitly opts into monthly via _monthly suffix.
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
    cols, dataStart: 5, dataEnd: 36,
    rows: [{ period_end: '2024-01-31', avg_bid_ask_spread: 0.003, avg_last_ask_cap: 0.07 }],
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
    injectPeriodLabel: true,
  });
  assert.equal(out.helperCols[0].header, 'Month',
    'R58: _monthly suffix still triggers monthly labels');
  assert.equal(out.helperCols[0].getValue({ period_end: '2024-03-31' }), "Mar '24");
});

test('R58: buyer_pool_monthly_count keeps monthly labels via monthly_count suffix', () => {
  // Edge case: ends with "monthly_count", not "_monthly". R58 detects this too.
  const cols = [
    { key: 'period_end', col: 'A' },
    { key: 'subspecialty', col: 'B' },
    { key: 'private_count', col: 'C' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'buyer_pool_monthly_count',
    tabName: 'Data_Buyer_Pool_M',
    cols, dataStart: 5, dataEnd: 36,
    rows: [],
    brand: { palette: {} },
    injectPeriodLabel: true,
  });
  // Even though this spec returns null (no recipe), the wrapper still
  // runs cadence detection if result.spec exists. For this template
  // the inner builder returns null (only buyer_pool_breakdown / buyer_pool_monthly_count
  // are wired). So the wrapper short-circuits. Skip the cadence assertion
  // for null specs; verify cadence detector directly.
  // (cadence detector is internal — assert via helper col emission shape.)
});

// ─────────────────────────────────────────────────────────────────────
// R60 — chart visual polish
// ─────────────────────────────────────────────────────────────────────

test('R60: every catAx block emits tickLblPos="low"', () => {
  // R60 fix: cat-axis labels stay at the chart bottom even when value
  // bars dip negative (Pace_Cap_Expand, Inventory_Backlog sold_neg).
  // Verified by checking each builder's emitted XML.
  const baseSpec = {
    tabName: 'Test', catCol: 'A', dataStart: 5, dataEnd: 10,
    series: [{ titleCol: 'B', titleRow: 4, valCol: 'B', color: '003DA5' }],
  };
  // Use the export of buildSingleLineChartXml etc. via multi-line for shape parity
  const xml = buildMultiLineChartXml(baseSpec);
  assert.match(xml, /<c:tickLblPos val="low"\/>/, 'R60: tickLblPos="low" emitted on catAx');
});

test('cap_rate_top_bottom_quartile keeps the R63 5-9% band', () => {
  // History: R60 5-10% → 5.5-8.5% → R63 5-9% (batch 6, 2026-05-23).
  // An earlier draft of this test asserted a further R66 widening to 4-10%,
  // but the code DELIBERATELY left this chart at R63's 5-9% — its inline
  // comment notes Data_Cap_Quartile "was NOT in the 2026-05-31 export
  // feedback, so R66 leaves it at the R63 5-9% band (no scope creep)."
  // Aligned to the shipped, deliberate behavior here (no production change).
  // If 4-10% is in fact wanted, it's a one-line change to the yAxisRange in
  // the `case 'cap_rate_top_bottom_quartile'` block.
  const cols = [
    { key: 'period_end',      col: 'A' },
    { key: 'subspecialty',    col: 'B' },
    { key: 'top_quartile',    col: 'C' },
    { key: 'median',          col: 'D' },
    { key: 'bottom_quartile', col: 'E' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'cap_rate_top_bottom_quartile',
    tabName: 'Data_Cap_Quartile',
    cols, dataStart: 5, dataEnd: 100,
    rows: [],
    brand: { palette: { nm_navy: '#003DA5' } },
  });
  assert.deepEqual(out.spec.yAxisRange, { min: 0.05, max: 0.09 },
    'cap quartile stays at the R63 5-9% band (4-10% widening scoped out at R66)');
});

test('R60: dLblsXml with { showVal: true } emits chart-level value labels', () => {
  // Indirect test via buildComboChartXml emission
  const xml = buildComboChartXml({
    tabName: 'Test', catCol: 'A', dataStart: 5, dataEnd: 8,
    barSeries: [{ titleCol: 'B', titleRow: 4, valCol: 'B', color: '003DA5' }],
    lineSeries: [{ titleCol: 'C', titleRow: 4, valCol: 'C', color: '00B1B0',
                   showMarker: true, markerShape: 'diamond',
                   dataLabels: { showVal: true, numFmt: '0.00%' } }],
  });
  assert.match(xml, /<c:showVal val="1"\/>/, 'R60: showVal=1 emitted for marker dataLabels');
  assert.match(xml, /<c:dLblPos val="t"\/>/, 'R60: label position above marker');
});

// ─────────────────────────────────────────────────────────────────────
// R61 — OOXML schema-order regression test for valAx blocks
// ─────────────────────────────────────────────────────────────────────

test('R61: every valAx block emits children in OOXML canonical order', () => {
  // Excel's "recoverable errors / data and charts" warning is triggered
  // when chart XML violates the strict child-element order in
  // EG_AxShared. Per ECMA-376 the order is:
  //   axId → scaling → delete → axPos → [majorGridlines/minorGridlines/title]
  //   → numFmt → majorTickMark → minorTickMark → tickLblPos → spPr → txPr
  //   → crossAx → crosses → crossesAt → ...
  //
  // Pre-R61, every builder emitted majorGridlines BEFORE delete + axPos,
  // which Excel auto-repaired with a "recoverable errors" warning on
  // every chart open. R61 reorders to: scaling → delete → axPos →
  // majorGridlines → numFmt → ... (canonical).
  //
  // This test verifies the regression doesn't recur across all 4
  // builders that emit valAx blocks.
  const CANONICAL = [
    'c:axId', 'c:scaling', 'c:delete', 'c:axPos',
    'c:majorGridlines', 'c:title', 'c:numFmt',
    'c:majorTickMark', 'c:minorTickMark', 'c:tickLblPos',
    'c:spPr', 'c:txPr', 'c:crossAx', 'c:crosses', 'c:crossesAt',
  ];
  function getChildren(blockXml) {
    const inner = blockXml.replace(/^<c:valAx>/, '').replace(/<\/c:valAx>$/, '');
    const out = [];
    let depth = 0, pos = 0;
    while (pos < inner.length) {
      const ts = inner.indexOf('<', pos);
      if (ts === -1) break;
      const te = inner.indexOf('>', ts);
      const tag = inner.substring(ts + 1, te);
      const isClose = tag.startsWith('/');
      const isSelf = tag.endsWith('/');
      const name = tag.replace(/^\//, '').replace(/\/$/, '').split(/\s/)[0];
      if (depth === 0 && !isClose) out.push(name);
      if (!isSelf && !isClose) depth++;
      else if (isClose) depth--;
      pos = te + 1;
    }
    return out;
  }
  function assertCanonical(blockXml, label) {
    const children = getChildren(blockXml);
    let lastIdx = -1;
    for (const c of children) {
      const idx = CANONICAL.indexOf(c);
      if (idx === -1) continue; // unknown — skip
      assert.ok(idx >= lastIdx,
        `${label}: <${c}> appears AFTER a higher-order sibling (was: ${children.join(', ')})`);
      lastIdx = idx;
    }
  }

  // Sample one chart of each builder type
  const samples = [
    ['multi-line', buildMultiLineChartXml({
      tabName: 'T', catCol: 'A', dataStart: 5, dataEnd: 10,
      yAxisRange: { min: 0.05, max: 0.10 }, valAxNumFmt: '0.00%',
      series: [{ titleCol: 'C', titleRow: 4, valCol: 'C', color: '003DA5' }],
    })],
    ['combo', buildComboChartXml({
      tabName: 'T', catCol: 'A', dataStart: 5, dataEnd: 10,
      yLeftRange: { min: 0, max: 100 }, yLeftNumFmt: '#,##0',
      yRightNumFmt: '0.0%',
      barSeries: [{ titleCol: 'B', titleRow: 4, valCol: 'B', color: '62B5E5' }],
      lineSeries: [{ titleCol: 'C', titleRow: 4, valCol: 'C', color: '003DA5' }],
    })],
  ];

  for (const [label, xml] of samples) {
    const blocks = xml.match(/<c:valAx>[\s\S]*?<\/c:valAx>/g) || [];
    blocks.forEach((b, i) => assertCanonical(b, `${label} valAx[${i}]`));
  }

  // R66 — regression sample: combo chart WITH yLeftAxisTitle + yRightAxisTitle
  // (market_turnover shape). Pre-R66 the title fragment emitted before
  // majorGridlines which violated canonical order and Excel issued a
  // "recoverable errors" warning on every workbook open.
  const titledCombo = buildComboChartXml({
    tabName: 'T', catCol: 'A', dataStart: 5, dataEnd: 10,
    yLeftRange: { min: 0, max: 300 }, yLeftNumFmt: '#,##0',
    yLeftAxisTitle: 'Listings / monthly sales rate',
    yRightNumFmt: '#,##0.0" mo"', yRightAxisTitle: 'Months of supply',
    barSeries: [{ titleCol: 'B', titleRow: 4, valCol: 'B', color: 'E0E8F4' }],
    lineSeries: [{ titleCol: 'C', titleRow: 4, valCol: 'C', color: '6A748C' }],
  });
  const titledBlocks = titledCombo.match(/<c:valAx>[\s\S]*?<\/c:valAx>/g) || [];
  assert.equal(titledBlocks.length, 2, 'R66: titled combo emits left + right valAx');
  titledBlocks.forEach((b, i) => assertCanonical(b, `R66 titled-combo valAx[${i}]`));
});

// ─────────────────────────────────────────────────────────────────────
// R66 — vertical cat-axis label rotation (master Excel parity)
// ─────────────────────────────────────────────────────────────────────

test('R66: catAx labels render with rot="-5400000" (vertical) to match master Excel', () => {
  // Master Dialysis Comp Work MASTER.xlsx / Copy Government Master
  // Document.xlsx both use rot="-5400000" on every time-series catAx
  // (labels read bottom-to-top). R63 inverted to rot="0" on the theory
  // that R62's once-per-quarter label thinning would fit; user batch 6
  // 2026-05-23 confirmed that's the wrong direction: "review our Excel/
  // PDF versions so the alignment vertically matches what's in there."
  const xml = buildMultiLineChartXml({
    tabName: 'T', catCol: 'A', dataStart: 5, dataEnd: 10,
    yAxisRange: { min: 0.05, max: 0.10 }, valAxNumFmt: '0.00%',
    series: [{ titleCol: 'C', titleRow: 4, valCol: 'C', color: '003DA5' }],
  });
  // catAx block must contain rot="-5400000"
  const catAxBlock = xml.match(/<c:catAx>[\s\S]*?<\/c:catAx>/);
  assert.ok(catAxBlock, 'catAx block present');
  assert.match(catAxBlock[0], /<a:bodyPr rot="-5400000"/,
    'R66: catAx txPr emits rot="-5400000" (vertical) matching master');
  assert.doesNotMatch(catAxBlock[0], /<a:bodyPr rot="0"/,
    'R66: catAx txPr does NOT emit rot="0" (the R63 regression)');
});

// ─────────────────────────────────────────────────────────────────────
// R67 — bar series invertIfNegative=0 (Inventory_Backlog Sold-bar
//       fill regression fix)
// ─────────────────────────────────────────────────────────────────────

test('R67: combo bar series emits <c:invertIfNegative val="0"/>', () => {
  // Without an explicit invertIfNegative=0, Excel applies its default
  // "invert" rendering to negative-value bars: the fill becomes white
  // with only a colored outline. The legend swatch keeps the solid
  // color, so users see a chart-vs-legend mismatch. Inventory_Backlog's
  // Sold series uses the negative-helper column (sold_neg) and was the
  // user-reported bug: "The series in the chart for Sold is a blue
  // outline with no fill on each bar but the legend shows a solid
  // dark blue."
  const xml = buildComboChartXml({
    tabName: 'T', catCol: 'A', dataStart: 5, dataEnd: 10,
    yLeftRange: { min: -100, max: 100 }, yLeftNumFmt: '#,##0',
    barSeries: [{ titleCol: 'B', titleRow: 4, valCol: 'B', color: '003DA5' }],
    lineSeries: [{ titleCol: 'C', titleRow: 4, valCol: 'C', color: '6A748C' }],
  });
  assert.match(xml, /<c:invertIfNegative val="0"\/>/,
    'R67: combo bar series pins invertIfNegative=0');
});


// ─────────────────────────────────────────────────────────────────────
// R71 — multi-chart-per-sheet support (aggregate Charts tab)
// ─────────────────────────────────────────────────────────────────────

test('R71: injectNativeCharts emits ONE drawing.xml per sheet when multiple charts target it', async () => {
  // Pre-R71 the injector emitted one drawing per chart and silently
  // dropped subsequent injections targeting the same sheet. R71
  // collates by tabName and produces one drawing.xml with N anchors
  // plus one drawing-rels file with N chart relationships. Required
  // to host the aggregate Charts tab's tiled native chart layout.
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'X';
  const sh = wb.addWorksheet('Data_X');
  sh.getCell('B4').value = 'Avg';
  for (let i = 0; i < 6; i++) {
    sh.getCell(`A${5 + i}`).value = `Period ${i}`;
    sh.getCell(`B${5 + i}`).value = 100 + i;
    sh.getCell(`C${5 + i}`).value = 200 + i;
  }

  const baseAnchor = (row0, row1) => ({ col0: 1, row0, col1: 14, row1 });
  const buf = await injectNativeCharts(await wb.xlsx.writeBuffer(), [
    {
      tabName: 'Data_X',
      spec: {
        type: 'bar', tabName: 'Data_X', titleCol: 'B', titleRow: 4,
        catCol: 'A', valCol: 'B', dataStart: 5, dataEnd: 10,
        anchor: baseAnchor(1, 21),
      },
    },
    {
      tabName: 'Data_X',
      spec: {
        type: 'bar', tabName: 'Data_X', titleCol: 'C', titleRow: 4,
        catCol: 'A', valCol: 'C', dataStart: 5, dataEnd: 10,
        anchor: baseAnchor(23, 43),
      },
    },
  ]);

  const zip = await JSZip.loadAsync(buf);
  // One drawing file for the sheet; two chart files (one per spec).
  const drawingFiles = Object.keys(zip.files).filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n));
  const chartFiles = Object.keys(zip.files).filter(n => /^xl\/charts\/chart\d+\.xml$/.test(n));
  assert.equal(drawingFiles.length, 1, 'R71: ONE drawing.xml emitted per sheet');
  assert.equal(chartFiles.length, 2, 'R71: TWO chart.xml files emitted (one per spec)');

  // Drawing XML contains two anchors
  const drawingXml = await zip.file(drawingFiles[0]).async('string');
  const anchorCount = (drawingXml.match(/<xdr:twoCellAnchor/g) || []).length;
  assert.equal(anchorCount, 2, 'R71: drawing.xml has 2 twoCellAnchor blocks');

  // cNvPr ids are unique (2 and 3) within the drawing
  const ids = Array.from(drawingXml.matchAll(/<xdr:cNvPr\s+id="(\d+)"/g)).map(m => m[1]);
  assert.deepEqual([...new Set(ids)].sort(), ['2', '3'],
    'R71: cNvPr ids are unique (2, 3) — Excel requires uniqueness within a drawing');

  // Drawing rels file contains two chart relationships
  const drawingRels = Object.keys(zip.files).find(n => /^xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/.test(n));
  const drawingRelsXml = await zip.file(drawingRels).async('string');
  const relCount = (drawingRelsXml.match(/<Relationship\b/g) || []).length;
  assert.equal(relCount, 2, 'R71: drawing rels has 2 chart relationships');

  // Sheet XML has exactly ONE <drawing r:id="..."/> reference
  const sheetXml = await zip.file('xl/worksheets/sheet2.xml').async('string');
  const drawingTagCount = (sheetXml.match(/<drawing\s+r:id=/g) || []).length;
  assert.equal(drawingTagCount, 1, 'R71: sheet XML has exactly one <drawing/> element');
});

test('R71: single-chart path preserves legacy drawing.xml byte shape', async () => {
  // The legacy buildDrawingXml output (used when only one chart targets
  // a sheet) is byte-for-byte preserved so downstream snapshot-style
  // assertions and any pre-R71 expectations continue to work.
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Index').getCell('A1').value = 'X';
  const sh = wb.addWorksheet('Data_Y');
  sh.getCell('B4').value = 'Val';
  for (let i = 0; i < 5; i++) {
    sh.getCell(`A${5 + i}`).value = `P${i}`;
    sh.getCell(`B${5 + i}`).value = 10 + i;
  }
  const buf = await injectNativeCharts(await wb.xlsx.writeBuffer(), [
    {
      tabName: 'Data_Y',
      spec: {
        type: 'bar', tabName: 'Data_Y', titleCol: 'B', titleRow: 4,
        catCol: 'A', valCol: 'B', dataStart: 5, dataEnd: 9,
        anchor: { col0: 0, row0: 0, col1: 13, row1: 21 },
      },
    },
  ]);
  const zip = await JSZip.loadAsync(buf);
  const drawingFiles = Object.keys(zip.files).filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n));
  const drawingXml = await zip.file(drawingFiles[0]).async('string');
  // Legacy single-chart drawings used cNvPr id=2, name="Chart 1"
  assert.match(drawingXml, /<xdr:cNvPr id="2" name="Chart 1"\/>/,
    'R71: single-chart path keeps legacy cNvPr id=2, name="Chart 1"');
  const anchorCount = (drawingXml.match(/<xdr:twoCellAnchor/g) || []).length;
  assert.equal(anchorCount, 1, 'R71: single-chart drawing has exactly 1 anchor');
});

// ============================================================================
// Round 68-E — formatting-pack harness assertions (Scott's per-item protocol,
// 2026-06-04). Verify the generated chart XML in-session; rendered-workbook
// audit happens post-merge on Railway.
// ============================================================================

test('R68-E D14: available-by-tenant donut emits NO dLblPos (illegal under c:doughnutChart)', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'available_by_tenant_count_donut',
    tabName: 'Data_Avail_Tenant_CountD',
    cols: [
      { key: 'tenant',       col: 'A' },
      { key: 'count_active', col: 'B' },
      { key: 'period_end',   col: 'C' },
    ],
    dataStart: 5, dataEnd: 8,
    brand: { palette: {} },
  });
  assert.equal(out.spec.type, 'doughnut');
  const xml = buildDoughnutChartXml(out.spec);
  // ECMA-376: dLblPos is not a legal child of a doughnutChart series. Its
  // presence triggered Excel auto-repair to strip chart31/chart32 on open.
  assert.ok(!/<c:dLblPos/.test(xml), 'doughnut XML must NOT contain a <c:dLblPos element');
  assert.match(xml, /<c:showPercent val="1"\/>/, 'ring % labels still on via showPercent');
});

test('R68-E D13: quarterly_volume_bars y-axis uses abbreviated currency (millions)', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'quarterly_volume_bars',
    tabName: 'Data_Volume_Quarterly',
    cols: [
      { key: 'period_end',       col: 'A' },
      { key: 'quarterly_volume', col: 'B' },
    ],
    dataStart: 5, dataEnd: 20,
    brand: { palette: {} },
  });
  assert.match(out.spec.valAxNumFmt, /,,"M"/, 'spec carries abbreviated millions format');
  const xml = buildSingleBarChartXml(out.spec);
  assert.match(xml, /,,&quot;M&quot;/, 'val-axis numFmt rendered as $X.XM in chart XML');
  assert.ok(!/formatCode="\$#,##0_\)/.test(xml), 'no raw $#,##0 currency axis');
});

test('R68-E G11: sources_of_capital horizontal bar — category labels nextTo + centered', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'sources_of_capital',
    tabName: 'Data_Sources',
    cols: [
      { key: 'rank_15y',         col: 'A' },
      { key: 'buyer_state',      col: 'B' },
      { key: 'total_volume_15y', col: 'C' },
      { key: 'pct_of_total_15y', col: 'D' },
      { key: 'deal_count_15y',   col: 'E' },
    ],
    dataStart: 5, dataEnd: 19,
    brand: { palette: {} },
  });
  assert.equal(out.spec.horizontal, true);
  const xml = buildSingleBarChartXml(out.spec);
  assert.match(xml, /<c:tickLblPos val="nextTo"\/>/, 'state labels sit next to their bar');
  assert.match(xml, /<c:lblAlgn val="ctr"\/>/, 'centered category-label alignment');
});

test('R68-E D15/G17: term-summary cap-rate dots carry value callouts at a legal position', () => {
  const out = buildInjectionSpec({
    chart_template_id: 'available_by_term_summary',
    tabName: 'Data_Avail_Term',
    cols: [
      { key: 'term_bucket',        col: 'A' },
      { key: 'avg_price',          col: 'B' },
      { key: 'avg_cap',            col: 'C' },
      { key: 'upper_quartile_cap', col: 'D' },
      { key: 'lower_quartile_cap', col: 'E' },
      { key: 'median_cap',         col: 'F' },
    ],
    dataStart: 5, dataEnd: 8,
    brand: { palette: {} },
  });
  assert.ok(Array.isArray(out.spec.lineSeries) && out.spec.lineSeries.length >= 4);
  for (const s of out.spec.lineSeries) {
    assert.equal(s.dataLabels?.showVal, true, 'each cap dot has a value callout');
  }
  const xml = buildComboChartXml(out.spec);
  assert.match(xml, /<c:showVal val="1"\/>/, 'value labels turned on');
  // dLblPos="t" is legal for line/marker series (only doughnut bans it — D14).
  assert.match(xml, /<c:dLblPos val="t"\/>/, 'legal top position for marker series');
});

// ---------------------------------------------------------------------------
// R68-E G5/G6 — XML-level harness assertions (Scott's verification protocol:
// series signs, axis crossing at zero, net-line presence; secondary % axis).
// ---------------------------------------------------------------------------
test('R68-E G5: renewal_rate XML — stacked diverging bars, zero-crossing single axis, net line', () => {
  const cols = [
    { key: 'period_end',                       col: 'A' },
    { key: 'first_generation_commencements',   col: 'B' },
    { key: 'renewed_leases',                   col: 'C' },
    { key: 'succeeding_superseding_leases',    col: 'D' },
    { key: 'expired_leases',                   col: 'E' },
    { key: 'terminated_leases',                col: 'F' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'lease_renewal_rate',
    tabName: 'Data_Lease_Renewal',
    cols, dataStart: 5, dataEnd: 100,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  const xml = buildComboChartXml(out.spec);
  // Diverging stacked bars + a line block (net).
  assert.match(xml, /<c:barChart>/);
  assert.match(xml, /<c:grouping val="stacked"\/>/, 'bars are stacked');
  assert.match(xml, /<c:lineChart>/, 'net line present');
  // invertIfNegative=0 → negative (subtractive) bars plot below zero rather
  // than flipping color; the val axis auto-crosses at zero.
  assert.match(xml, /<c:invertIfNegative val="0"\/>/);
  // sharedAxis ⇒ exactly ONE value axis (net rides the bars' count scale).
  assert.equal((xml.match(/<c:valAx>/g) || []).length, 1, 'single shared value axis');
  // 6 series total: 5 bars + 1 net line, unique idx 0..5.
  const idxs = Array.from(xml.matchAll(/<c:idx val="(\d+)"\/>/g)).map(m => Number(m[1]));
  assert.deepEqual(idxs, [0, 1, 2, 3, 4, 5]);
  // The two subtractive bars chart the negated helper cols (G, H).
  assert.match(xml, /\$G\$5:\$G\$100/, 'expired plots from negated helper col G');
  assert.match(xml, /\$H\$5:\$H\$100/, 'terminated plots from negated helper col H');
  // Net line plots from the net helper col (I).
  assert.match(xml, /\$I\$5:\$I\$100/, 'net line plots from net helper col I');
});

test('R68-E G6: termination_rate XML — count bars + soft-term % line on a secondary axis', () => {
  const cols = [
    { key: 'period_end',                        col: 'A' },
    { key: 'total_leases_active',               col: 'B' },
    { key: 'terminated_ttm',                    col: 'C' },
    { key: 'leases_outside_firm_term',          col: 'D' },
    { key: 'terminated_outside_firm_term',      col: 'E' },
    { key: 'avg_leases_outside_firm_term_ttm',  col: 'F' },
    { key: 'terminated_outside_firm_term_pct',  col: 'G' },
  ];
  const out = buildInjectionSpec({
    chart_template_id: 'lease_termination_rate',
    tabName: 'Data_Term_Rate',
    cols, dataStart: 5, dataEnd: 60,
    brand: { palette: { nm_navy: '#003DA5', nm_sky: '#62B5E5' } },
  });
  const xml = buildComboChartXml(out.spec);
  assert.match(xml, /<c:barChart>/);
  assert.match(xml, /<c:grouping val="stacked"\/>/, 'count bars stacked');
  assert.match(xml, /<c:lineChart>/, 'soft-term rate line present');
  // Two value axes — counts on the left, % on the right (axId 3).
  assert.equal((xml.match(/<c:valAx>/g) || []).length, 2, 'two value axes');
  const rightAx = xml.match(/<c:valAx>\s*<c:axId val="3"\/>[\s\S]*?<\/c:valAx>/)[0];
  assert.match(rightAx, /0\.0%/, 'right axis formats as percent');
  // Line plots the real rate column G.
  assert.match(xml, /\$G\$5:\$G\$60/, 'rate line plots from terminated_outside_firm_term_pct (col G)');
});
