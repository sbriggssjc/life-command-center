// One-off audit: read the two latest exports and verify Round 10 fixes.
// Not committed to git; placed at scripts/ for local execution.
import ExcelJS from 'exceljs';

const files = [
  { label: 'GOV',     path: 'C:/Users/scott/Downloads/NM-CapMarkets-GovLeased-2026-03-31 (1).xlsx' },
  { label: 'DIA',     path: 'C:/Users/scott/Downloads/NM-CapMarkets-Dialysis-2026-03-31 (2).xlsx' },
];

async function load(p) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(p);
  return wb;
}

function findSheet(wb, ...candidates) {
  for (const c of candidates) {
    const ws = wb.getWorksheet(c);
    if (ws) return ws;
  }
  return null;
}

function rowsOf(ws, maxRows = 200) {
  if (!ws) return [];
  const out = [];
  const last = Math.min(maxRows, ws.actualRowCount || ws.rowCount || 0);
  for (let r = 1; r <= last; r++) {
    const row = ws.getRow(r);
    const vals = [];
    const w = Math.max(ws.actualColumnCount || 0, ws.columnCount || 0, 10);
    for (let c = 1; c <= w; c++) {
      const v = row.getCell(c).value;
      if (v == null) vals.push('');
      else if (typeof v === 'object' && 'result' in v) vals.push(v.result);
      else if (typeof v === 'object' && 'richText' in v) vals.push(v.richText.map(t => t.text).join(''));
      else vals.push(v);
    }
    out.push(vals);
  }
  return out;
}

function show(label, ws, opts = {}) {
  const { startRow = 1, maxRows = 25, cols = 10 } = opts;
  if (!ws) { console.log(`  ${label}: <missing tab>`); return; }
  console.log(`\n  ${label} (tab="${ws.name}", actualRow=${ws.actualRowCount}, rowCount=${ws.rowCount})`);
  const last = Math.min(startRow + maxRows - 1, ws.rowCount || 9999);
  let printed = 0;
  for (let r = startRow; r <= last; r++) {
    const row = ws.getRow(r);
    const vals = [];
    let nonEmpty = false;
    for (let c = 1; c <= cols; c++) {
      let v = row.getCell(c).value;
      if (v && typeof v === 'object' && 'result' in v) v = v.result;
      else if (v && typeof v === 'object' && 'richText' in v) v = v.richText.map(t => t.text).join('');
      if (v != null && v !== '') nonEmpty = true;
      vals.push(v == null ? '' : String(v).slice(0, 20));
    }
    if (nonEmpty) {
      console.log(`    r${r}: ` + vals.join(' | '));
      printed++;
    }
    if (printed >= maxRows) break;
  }
}

for (const { label, path } of files) {
  console.log('\n=========================================================');
  console.log(`${label}  —  ${path.split('/').pop()}`);
  console.log('=========================================================');
  const wb = await load(path);
  console.log(`  Tabs: ${wb.worksheets.map(w => w.name).join(' | ')}`);

  // Common pattern: title row 1, chart image rows 2-N, then a header row, then data.
  // Scan starting at row 24 (below the chart) for ~30 rows.
  const SCAN = { startRow: 24, maxRows: 20, cols: 12 };
  const SCAN_TOP = { startRow: 1, maxRows: 6, cols: 8 }; // for tab title sanity
  const TAIL = { startRow: 318, maxRows: 16, cols: 8 };  // recent dates at the bottom
  const TAIL_DOM = { startRow: 326, maxRows: 10, cols: 8 };

  // Sentiment — verify columns + recent values
  const sentTab = findSheet(wb, 'Data_Sentiment');
  show('Sentiment.top',  sentTab, SCAN_TOP);
  show('Sentiment.hdr',  sentTab, { startRow: 24, maxRows: 3, cols: 12 });
  show('Sentiment.tail', sentTab, TAIL);
  // Renewal_Growth — should show cagr_5yr column
  const rgTab = findSheet(wb, 'Data_Renewal_Growth');
  show('Renewal_Growth.hdr',  rgTab, { startRow: 24, maxRows: 3, cols: 10 });
  show('Renewal_Growth.tail', rgTab, { startRow: 170, maxRows: 18, cols: 10 });
  // Term_Rate — should include leases_outside_firm_term column (gov only)
  const trTab = findSheet(wb, 'Data_Term_Rate', 'Data_Lease_Term_Rate');
  show('Term_Rate.hdr',  trTab, { startRow: 24, maxRows: 3, cols: 10 });
  show('Term_Rate.tail', trTab, { startRow: 65, maxRows: 16, cols: 10 });
  // Renewal_Rate
  const rrTab = findSheet(wb, 'Data_Renewal_Rate');
  show('Renewal_Rate.hdr',  rrTab, { startRow: 24, maxRows: 3, cols: 10 });
  show('Renewal_Rate.tail', rrTab, { startRow: 160, maxRows: 16, cols: 10 });
  // DOM_Ask — verify 2026-03 row null + earlier rows have values
  const domTab = findSheet(wb, 'Data_DOM_Ask');
  show('DOM_Ask.hdr',  domTab, { startRow: 24, maxRows: 3, cols: 8 });
  show('DOM_Ask.tail', domTab, TAIL_DOM);
  // Avail_Mkt_Size — verify earliest row >= 2015-Q3 (dialysis only)
  const amTab = findSheet(wb, 'Data_Avail_Mkt_Size');
  show('Avail_Mkt_Size.hdr+first', amTab, { startRow: 24, maxRows: 8, cols: 8 });
  // Rent_Year_Built — quartile values should be PSF scale (~$20-40, not 0.0009)
  const rybTab = findSheet(wb, 'Data_Rent_Year_Built');
  show('Rent_Year_Built.hdr',  rybTab, { startRow: 24, maxRows: 3, cols: 8 });
  show('Rent_Year_Built.tail', rybTab, { startRow: 50, maxRows: 12, cols: 8 });
  // NM_vs_Market plateaus (deferred; documented)
  const nmTab = findSheet(wb, 'Data_NM_vs_Market');
  show('NM_vs_Market.tail', nmTab, TAIL);
  // Cap_Avg label sanity ("Cap Rate — TTM Avg" not "weighted")
  const capTab = findSheet(wb, 'Data_Cap_Avg');
  show('Cap_Avg.top',  capTab, SCAN_TOP);
  show('Cap_Avg.hdr',  capTab, { startRow: 24, maxRows: 3, cols: 8 });
}
