// Audit each Data_* tab for missing or sparse data. For every numeric
// data column past the period axis, report:
//   • total data rows
//   • non-null cells
//   • % populated
//   • date range (if period_end column)
//
// Flags anything with < 50% population (genuine sparseness) or empty data
// columns (likely a view that emits nulls or a Supabase query error).

import fs from 'node:fs';
import JSZip from 'jszip';

const EXPORTS = {
  dia: 'C:/Users/scott/Downloads/NM-CapMarkets-Dialysis-2026-03-31 (1).xlsx',
  gov: 'C:/Users/scott/Downloads/NM-CapMarkets-GovLeased-2026-03-31 (1).xlsx',
};

function attr(s, name) {
  const m = s.match(new RegExp(`\\b${name}="([^"]+)"`));
  return m ? m[1] : null;
}

async function loadWorkbook(path) {
  const buf = fs.readFileSync(path);
  const zip = await JSZip.loadAsync(buf);
  const wb = await zip.file('xl/workbook.xml').async('string');
  const wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const ridMap = {};
  for (const m of wbRels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], 'Id'); const t = attr(m[1], 'Target');
    if (id && t) ridMap[id] = t;
  }
  const sst = zip.file('xl/sharedStrings.xml');
  const sstXml = sst ? await sst.async('string') : '';
  const ssMap = [];
  for (const m of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // Concatenate all <t> in <r> runs for rich-text strings
    const parts = Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(x => x[1]);
    ssMap.push(parts.join(''));
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const target = ridMap[m[2]];
    if (target) sheets.push({ name: m[1], path: `xl/${target}` });
  }
  return { zip, sheets, ssMap };
}

function colLetterToIdx(letter) {
  let n = 0;
  for (const c of letter.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

function excelDateToISO(serial) {
  const n = Number(serial);
  if (!isFinite(n) || n < 30000 || n > 80000) return null;
  // Excel base: 1900-01-01 with the 1900-02-29 bug; subtract 25569 for 1970 epoch
  const ms = (n - 25569) * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function auditDataTab(zip, sheet, ssMap) {
  const sx = await zip.file(sheet.path).async('string');
  // Find the header row — first row with multiple non-empty cells, typically row 4.
  // Then collect all numeric cells in rows 5+ by column.
  // Excel cells: <c r="B4" s="3" t="s"><v>17</v></c> → string idx 17
  //              <c r="B5" s="4"><v>0.06</v></c>     → numeric
  const cellRe = /<c r="([A-Z]+)(\d+)"(?:\s+s="\d+")?(?:\s+t="(\w+)")?\s*(?:>([\s\S]*?)<\/c>|\/>)/g;
  const cells = Array.from(sx.matchAll(cellRe));
  if (cells.length === 0) return { rows: 0, columns: {} };

  // Find header row — look for row N where at least 3 string cells appear
  const rowMap = {};
  for (const c of cells) {
    const col = c[1], row = parseInt(c[2], 10), type = c[3], inner = c[4];
    if (!rowMap[row]) rowMap[row] = [];
    rowMap[row].push({ col, type, inner });
  }
  // Find header row — usually 4, but find first row with ≥3 string cells
  let headerRow = null;
  for (const r of [4, 3, 27, 28, 29, 5, 2, 1].filter(r => rowMap[r])) {
    const strCount = rowMap[r].filter(x => x.type === 's').length;
    if (strCount >= 3) { headerRow = r; break; }
  }
  if (!headerRow) {
    // fallback: row 4
    headerRow = 4;
  }
  // Resolve column header labels
  const headers = {};
  for (const c of rowMap[headerRow] || []) {
    if (c.type === 's') {
      const idx = parseInt(c.inner.match(/<v>(\d+)<\/v>/)?.[1] || '-1', 10);
      headers[c.col] = ssMap[idx] || `(col ${c.col})`;
    } else if (c.inner) {
      headers[c.col] = c.inner.replace(/<[^>]+>/g, '').trim() || `(col ${c.col})`;
    }
  }
  // Count data values per column from header+1 onward
  const dataRows = Object.keys(rowMap).map(Number).filter(r => r > headerRow).sort((a, b) => a - b);
  const colStats = {};
  const dateValues = [];
  for (const r of dataRows) {
    for (const c of rowMap[r] || []) {
      if (!colStats[c.col]) colStats[c.col] = { populated: 0, total: 0 };
      colStats[c.col].total++;
      if (c.inner && /<v>[^<]+<\/v>/.test(c.inner)) {
        colStats[c.col].populated++;
      }
    }
  }
  // Date column = col A typically; pluck its values
  for (const r of dataRows.slice(0, 5).concat(dataRows.slice(-3))) {
    const a = (rowMap[r] || []).find(c => c.col === 'A');
    if (a && a.inner) {
      const v = a.inner.match(/<v>([^<]+)<\/v>/)?.[1];
      if (v) {
        const iso = excelDateToISO(v);
        if (iso) dateValues.push(iso);
      }
    }
  }
  // Date range from first/last data row's col A
  const firstA = (rowMap[dataRows[0]] || []).find(c => c.col === 'A');
  const lastA = (rowMap[dataRows[dataRows.length - 1]] || []).find(c => c.col === 'A');
  const firstDate = firstA?.inner?.match(/<v>([^<]+)<\/v>/)?.[1];
  const lastDate = lastA?.inner?.match(/<v>([^<]+)<\/v>/)?.[1];

  return {
    headerRow,
    totalDataRows: dataRows.length,
    columns: Object.entries(colStats).map(([col, stat]) => ({
      col,
      header: headers[col] || `(col ${col})`,
      populated: stat.populated,
      total: stat.total,
      pct: stat.total > 0 ? Math.round(100 * stat.populated / stat.total) : 0,
    })).sort((a, b) => colLetterToIdx(a.col) - colLetterToIdx(b.col)),
    dateRange: firstDate && lastDate
      ? `${excelDateToISO(firstDate) || firstDate} → ${excelDateToISO(lastDate) || lastDate}`
      : null,
  };
}

async function auditVertical(label, path) {
  const { zip, sheets, ssMap } = await loadWorkbook(path);
  const dataSheets = sheets.filter(s => s.name.startsWith('Data_'));
  console.log(`\n=== ${label.toUpperCase()} (${dataSheets.length} Data_* tabs) ===\n`);
  const issues = [];
  for (const s of dataSheets) {
    const r = await auditDataTab(zip, s, ssMap);
    const dataCols = r.columns.filter(c => c.col !== 'A' && c.col !== 'B' && c.total > 0);
    const sparse = dataCols.filter(c => c.pct < 50 && c.total > 0);
    const empty = dataCols.filter(c => c.populated === 0);
    const range = r.dateRange || '(no period_end)';
    const tag = empty.length > 0 ? '✗ EMPTY' : sparse.length > 0 ? '! SPARSE' : '✓';
    console.log(`${tag.padEnd(8)} ${s.name.padEnd(28)} rows=${String(r.totalDataRows).padStart(3)}  range: ${range}`);
    if (empty.length > 0 || sparse.length > 0) {
      for (const c of empty) {
        console.log(`           col ${c.col} "${c.header}"  EMPTY (0/${c.total})`);
        issues.push({ tab: s.name, col: c.col, header: c.header, pct: 0, total: c.total });
      }
      for (const c of sparse) {
        console.log(`           col ${c.col} "${c.header}"  ${c.pct}% populated (${c.populated}/${c.total})`);
        issues.push({ tab: s.name, col: c.col, header: c.header, pct: c.pct, total: c.total });
      }
    }
  }
  console.log(`\n  ${issues.length} sparse/empty data columns flagged across ${dataSheets.length} tabs`);
  return issues;
}

for (const [label, path] of Object.entries(EXPORTS)) {
  await auditVertical(label, path);
}
