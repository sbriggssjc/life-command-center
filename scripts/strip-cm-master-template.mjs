#!/usr/bin/env node
// ============================================================================
// strip-cm-master-template.mjs
//
// Takes a master Capital Markets Excel (gov or dialysis) and produces a
// stripped template suitable for committing to LCC.
//
// What's preserved:
//   - All charts (objects, formatting, axis specs, data range references)
//   - Headers (row 1-2 of every tab)
//   - Formula structure on chart-source tabs (so charts re-bind on populate)
//   - Brand styling, page setup, named ranges
//
// What's removed:
//   - Data rows on bulky transactional tabs (Sold, FRPP-Leased, Ownership,
//     Inventory, Top Buyers, Top Sellers, Off Market Comps) — these will
//     be re-populated by SQL output at export time
//   - Data rows on chart-source tabs ('All Charts', 'SSA Charts', etc.)
//     beyond row 4 — these get re-populated from cm_gov_market_quarterly
//
// Usage:
//   node scripts/strip-cm-master-template.mjs <input.xlsx> <output.xlsx> [vertical]
//
// vertical: 'gov' | 'dialysis' (controls which tabs are treated as bulky)
// ============================================================================

import ExcelJS from 'exceljs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tabs whose data should be cleared but structure preserved
const BULKY_DATA_TABS = {
  gov: [
    'Sold',
    'Ownership',
    'Inventory',
    'FRPP-Leased',
    'Top Buyers',
    'Top Sellers',
  ],
  dialysis: [
    'Sales Comps',
    'Available Comps',
    'Available Coverage',
    'Off Market Comps',
    'Top Buyers',
    'Top Sellers',
    'Sheet1',  // Scratch sheet
  ],
};

// Tabs whose data we re-populate at export time. Charts on these tabs
// reference rows below the header — we clear rows 4+ to make space.
// Format: { sheetName: keepHeaderRows }
const CHART_SOURCE_TABS = {
  gov: {
    'All Charts': 4,   // Keep rows 1-4 (header + summary formulas)
    'SSA Charts': 4,   // Same
  },
  dialysis: {
    'Charts': 14,        // First 14 rows are summary formulas; data starts at row 15
    'Market Size': 4,
    'Core Cap Chart': 4,
  },
};

// Tabs to keep as-is (structure-only sheets, small data, or shared metadata)
const KEEP_AS_IS = new Set([
  'Rent Survey',
  'Competition',
]);

async function stripMaster(inputPath, outputPath, vertical = 'gov') {
  console.log(`Loading ${inputPath} ...`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);

  console.log(`Sheets found: ${wb.worksheets.map(s => s.name).join(', ')}`);

  const bulkyTabs = new Set(BULKY_DATA_TABS[vertical] || []);
  const chartSourceTabs = CHART_SOURCE_TABS[vertical] || {};

  let totalRowsCleared = 0;

  for (const ws of wb.worksheets) {
    const name = ws.name;
    const beforeRows = ws.actualRowCount || ws.rowCount || 0;

    if (bulkyTabs.has(name)) {
      // Clear all data rows but keep first 2 rows (headers)
      const keepRows = 2;
      const lastRow = ws.actualRowCount || ws.rowCount || 0;
      if (lastRow > keepRows) {
        ws.spliceRows(keepRows + 1, lastRow - keepRows);
        const cleared = lastRow - keepRows;
        totalRowsCleared += cleared;
        console.log(`  [${name}] BULKY: cleared ${cleared} data rows, kept ${keepRows} header rows`);
      }
    } else if (chartSourceTabs[name] !== undefined) {
      // Clear data rows but keep header + summary formula rows
      const keepRows = chartSourceTabs[name];
      const lastRow = ws.actualRowCount || ws.rowCount || 0;
      if (lastRow > keepRows) {
        ws.spliceRows(keepRows + 1, lastRow - keepRows);
        const cleared = lastRow - keepRows;
        totalRowsCleared += cleared;
        console.log(`  [${name}] CHART SOURCE: cleared ${cleared} data rows, kept ${keepRows} structural rows + charts`);
      }
    } else if (KEEP_AS_IS.has(name)) {
      console.log(`  [${name}] KEEP: ${beforeRows} rows preserved as-is`);
    } else {
      console.log(`  [${name}] UNKNOWN: ${beforeRows} rows preserved (review manually)`);
    }
  }

  console.log(`\nTotal data rows cleared: ${totalRowsCleared.toLocaleString()}`);
  console.log(`Saving to ${outputPath} ...`);
  await wb.xlsx.writeFile(outputPath);
  const fs = await import('fs');
  const inSize = fs.statSync(inputPath).size / 1024 / 1024;
  const outSize = fs.statSync(outputPath).size / 1024 / 1024;
  console.log(`Done. Size: ${inSize.toFixed(2)}MB → ${outSize.toFixed(2)}MB (${((1 - outSize / inSize) * 100).toFixed(0)}% reduction)`);
}

const [, , inputPath, outputPath, vertical = 'gov'] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node strip-cm-master-template.mjs <input.xlsx> <output.xlsx> [vertical=gov]');
  process.exit(1);
}

stripMaster(inputPath, outputPath, vertical).catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
