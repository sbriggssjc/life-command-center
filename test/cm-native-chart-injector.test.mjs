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
