// ============================================================================
// Capital Markets — Master XLSX template loader
// Life Command Center
//
// Loads the binary master XLSX template (assets/cm-templates/*-master-template.xlsx),
// repopulates the data sheet that feeds the 37 chart objects, and returns
// the resulting buffer. The chart objects are pre-wired to specific cell
// ranges in the master template; replacing only the cells (and not touching
// xl/charts/*.xml or xl/drawings/*.xml) keeps every chart wired up.
//
// Why this path
// ─────────────
// ExcelJS doesn't preserve chart objects on workbook.xlsx.load() — they
// drop on save. The user's workflow requires charts to render
// immediately on open with no paste step. So we hand-roll the data
// sheet replacement via JSZip, which DOES preserve every other entry
// (charts, drawings, styles, themes, custom properties) byte-for-byte.
//
// Data layout (matches the user-attached master)
// ──────────────────────────────────────────────
// The "Charts" sheet (sheet5.xml) holds:
//   - Row 2: column headers ("Date", "Transaction Count (ttm)", ...)
//   - Rows 3+: monthly TTM data anchored at month-START
//             (Jan 1 2008, Feb 1 2008, ... — Excel-serial dates)
//
// Quarter labels show visually in chart axes; the underlying x-axis values
// are monthly. Chart objects reference ranges like Charts!$B$15:$B$218.
// ============================================================================

import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Resolve template path. In Vercel, process.cwd() is the project root; the
// assets dir is committed at that root. Fall back to relative-to-this-file
// for local-dev cases where cwd is wrong.
function resolveTemplatePath(relativePath) {
  const candidates = [
    path.join(process.cwd(), relativePath),
    path.join(__dirname, '..', '..', relativePath),
  ];
  for (const c of candidates) {
    try {
      // synchronously check via the path's existence — async fs.access
      // would be better but this runs once per export
      // eslint-disable-next-line no-sync
      require('fs').accessSync(c);
      return c;
    } catch {}
  }
  // No fallback worked; return the cwd path so the caller's read fails with
  // a clear ENOENT pointing at the expected location
  return candidates[0];
}

const DIALYSIS_TEMPLATE = 'assets/cm-templates/dialysis-master-template.xlsx';

// ============================================================================
// Date conversion: JS Date → Excel serial number
// ============================================================================
//
// Excel uses 1900-01-01 = serial 1, with the 1900-leap-year bug. The trick:
// for any date >= 1900-03-01, serial = floor(unix_ms / 86400000) + 25569.
// All our anchors are >= 2008-01-01 so the bug doesn't apply.
function dateToExcelSerial(d) {
  if (!d) return null;
  const dt = (d instanceof Date) ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  // Treat date as UTC midnight to avoid TZ drift (PostgREST returns ISO 8601
  // dates as YYYY-MM-DD strings which JS parses as UTC midnight already).
  return Math.floor(dt.getTime() / 86_400_000) + 25_569;
}

// Convert a month-end date to its month-start counterpart (master uses
// month-start anchors on the Charts sheet B column).
function monthEndToMonthStart(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
}

// ============================================================================
// Sheet5 (Charts data) generator
// ============================================================================

// Column-to-key map for the Phase-1 master coverage (B-O = 14 columns).
// Keep parallel to cm_dialysis_market_quarterly_master_m view's column shape.
const CHARTS_SHEET_COLUMNS = [
  { col: 'B', header: 'Date',                                  key: 'period_end',                       fmt: 'date'  },
  { col: 'C', header: 'Transaction Count (ttm)',               key: 'transaction_count_ttm',            fmt: 'int'   },
  { col: 'D', header: 'Transaction Count (ttm) w/o Sumitomo',  key: 'transaction_count_ttm_no_sumitomo',fmt: 'int'   },
  { col: 'E', header: 'Avg Deal Size',                         key: 'avg_deal_size',                    fmt: 'num'   },
  { col: 'F', header: 'Sales Volume (ttm)',                    key: 'ttm_volume',                       fmt: 'num'   },
  { col: 'G', header: 'Y-O-Y Change (%)',                      key: 'yoy_change_pct',                   fmt: 'num'   },
  { col: 'H', header: 'Sales Volume (ttm)',                    key: 'ttm_volume_alt',                   fmt: 'num'   },
  { col: 'I', header: 'Quarterly Volume',                      key: 'quarterly_volume',                 fmt: 'num'   },
  { col: 'J', header: 'Quarterly Count',                       key: 'quarterly_count',                  fmt: 'int'   },
  { col: 'K', header: 'Monthly Volume',                        key: 'monthly_volume',                   fmt: 'num'   },
  { col: 'L', header: 'Monthly Count',                         key: 'monthly_count',                    fmt: 'int'   },
  { col: 'M', header: 'Upper Quartile (ttm)',                  key: 'upper_quartile_cap_ttm',           fmt: 'num'   },
  { col: 'N', header: 'Lower Quartile (ttm)',                  key: 'lower_quartile_cap_ttm',           fmt: 'num'   },
  { col: 'O', header: 'Cap (ttm)',                             key: 'avg_cap_rate_ttm',                 fmt: 'num'   },
];

function escapeXml(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

function cellNumXml(ref, value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) {
    return ''; // omit empty cells — readers handle blanks
  }
  return `<c r="${ref}"><v>${Number(value)}</v></c>`;
}

function cellInlineStrXml(ref, value) {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/**
 * Generate the full sheet5.xml content with the populated Charts data.
 * The drawing rId reference is preserved so the 37 chart objects anchored
 * on this sheet stay rendered.
 */
function generateChartsSheetXml(rows) {
  const dataRowsStartAt = 3; // master uses row 2 = headers, row 3 = first data
  const lastRow = dataRowsStartAt + rows.length - 1;

  // Header row (row 2)
  const headerCells = CHARTS_SHEET_COLUMNS
    .map(c => cellInlineStrXml(`${c.col}2`, c.header))
    .join('');

  // Data rows
  const dataRows = rows.map((row, i) => {
    const r = dataRowsStartAt + i;
    const cells = CHARTS_SHEET_COLUMNS.map(c => {
      const ref = `${c.col}${r}`;
      let v = row[c.key];
      if (c.fmt === 'date') {
        v = dateToExcelSerial(monthEndToMonthStart(v));
      }
      return cellNumXml(ref, v);
    }).join('');
    return `<row r="${r}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="B2:O${lastRow}"/>
  <sheetViews>
    <sheetView workbookViewId="0"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="13.5"/>
  <cols>
    <col min="2" max="14" width="13" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="2">${headerCells}</row>
    ${dataRows}
  </sheetData>
  <drawing r:id="rId1"/>
</worksheet>`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build the dialysis Capital Markets workbook by loading the binary master
 * template and injecting the monthly TTM data. Returns a Buffer ready to
 * stream as the export response.
 *
 * @param {object} opts
 * @param {Array<object>} opts.masterRows   Rows from cm_dialysis_market_quarterly_master_m
 * @param {string} [opts.subspecialty]      Subspecialty filter (informational only)
 * @param {string} [opts.asOf]              As-of date (informational only)
 * @returns {Promise<Buffer>}
 */
export async function buildDialysisMasterWorkbook({ masterRows, subspecialty, asOf } = {}) {
  if (!Array.isArray(masterRows) || masterRows.length === 0) {
    throw new Error('buildDialysisMasterWorkbook: masterRows required (and non-empty)');
  }

  const templatePath = resolveTemplatePath(DIALYSIS_TEMPLATE);
  const templateBuf = await fs.readFile(templatePath);

  const zip = await JSZip.loadAsync(templateBuf);

  // Replace the Charts sheet with our populated version. All other
  // entries — chart XML, drawings, styles, theme — pass through untouched
  // so the 37 chart objects stay wired to the cell ranges they reference.
  const newSheetXml = generateChartsSheetXml(masterRows);
  zip.file('xl/worksheets/sheet5.xml', newSheetXml);

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export const DIALYSIS_TEMPLATE_PATH = DIALYSIS_TEMPLATE;
