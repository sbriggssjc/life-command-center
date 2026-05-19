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
