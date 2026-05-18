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
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DIALYSIS_TEMPLATE = 'assets/cm-templates/dialysis-master-template.xlsx';

// Resolve template path. Vercel's serverless bundler (NFT) doesn't statically
// trace runtime fs.readFile() calls, so we declare the asset via vercel.json
// `functions[*].includeFiles` and probe a few candidate locations at runtime.
// Logs candidates + their existence so misconfiguration surfaces in Vercel
// function logs.
function resolveTemplatePath(relativePath) {
  const candidates = [
    path.join(process.cwd(), relativePath),
    path.join(__dirname, '..', '..', relativePath),
    path.join(__dirname, '..', '..', '..', relativePath),
    // Vercel sometimes co-locates includeFiles next to the function:
    path.join(__dirname, '..', relativePath),
  ];
  for (const c of candidates) {
    try {
      fsSync.accessSync(c, fsSync.constants.R_OK);
      console.log(`[cm-template-loader] resolved template at: ${c}`);
      return c;
    } catch { /* try next */ }
  }
  console.error('[cm-template-loader] template NOT found. Tried:');
  candidates.forEach(c => {
    let exists = false;
    try { fsSync.accessSync(c); exists = true; } catch {}
    console.error(`  ${exists ? '[OK ]' : '[MISS]'} ${c}`);
  });
  console.error(`  cwd=${process.cwd()}`);
  console.error(`  __dirname=${__dirname}`);
  // Return first candidate so the caller's readFile throws a clear ENOENT
  return candidates[0];
}

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

// Cell style indexes baked into the repo template's xl/styles.xml. These were
// chosen to match the style indexes the user's actual master XLSX uses on
// the same columns, so the chart objects (which respect cell number-formats
// for axis labels + data tooltips) render with the correct formatting.
//
//   STYLE_DATE     (s=23) → numFmt 167  "mmm-yy"           e.g. "Jan-08"
//   STYLE_INTEGER  (s=24) → numFmt 38   "#,##0;(#,##0)"    e.g. "124"
//   STYLE_CURRENCY (s=25) → numFmt 165  "$#,##0;[Red]..."  e.g. "$518,106,944"
//   STYLE_PCT_INT  (s=26) → numFmt 9    "0%"               e.g. "66%"
//   STYLE_PCT_2DP  (s=29) → numFmt 10   "0.00%"            e.g. "7.63%"
//
// Without these, Excel interprets cells as plain numbers (39448, 0.0763,
// 518106944) and chart axes look raw. The user reported "the formatting is
// off" after the first deploy of the loader for this exact reason.
const STYLE_DATE     = 23;
const STYLE_INTEGER  = 24;
const STYLE_CURRENCY = 25;
const STYLE_PCT_INT  = 26;
const STYLE_PCT_2DP  = 29;

// Column-to-key map for the dia master template Charts sheet.
// Originally Phase 1 (B-O = 14 cols, R31). Phase 2 (R33) extends to BM
// covering every column the 37 chart objects reference that has a
// direct counterpart in cm_dialysis_market_quarterly_master_m.
//
// Columns mapped to master_m fields here become live data when the
// loader runs. Columns NOT mapped (P, Q, R, V, Y, Z, AA, AC, AH, AI,
// AJ, AN, AS, AT, AU, AV, AW, AX, AY, AZ, BB, BC, BD, BF, BG, BH,
// BI, BJ) need either derived calculations (90/180-day rolling caps,
// pace metrics, valuation index) or cross-view joins (DOM, inventory
// flow) or new view extensions (tenant-specific caps for FMC/DVA,
// Rent/SF). See docs/cm/editable-charts-plan.md for the full
// inventory and Phase 3+ scope.
//
// Headers exactly match the master template's row-2 inline strings
// (verified via scripts/cm-inventory-master-template-charts.py) so
// the chart objects' axis labels + tooltips render correctly.
const CHARTS_SHEET_COLUMNS = [
  { col: 'B',  header: 'Date',                                  key: 'period_end',                       style: STYLE_DATE,     transform: 'date' },
  { col: 'C',  header: 'Transaction Count (ttm)',               key: 'transaction_count_ttm',            style: STYLE_INTEGER  },
  { col: 'D',  header: 'Transaction Count (ttm) w/o Sumitomo',  key: 'transaction_count_ttm_no_sumitomo',style: STYLE_INTEGER  },
  { col: 'E',  header: 'Avg Deal Size',                         key: 'avg_deal_size',                    style: STYLE_CURRENCY },
  { col: 'F',  header: 'Sales Volume (ttm)',                    key: 'ttm_volume',                       style: STYLE_CURRENCY },
  { col: 'G',  header: 'Y-O-Y Change (%)',                      key: 'yoy_change_pct',                   style: STYLE_PCT_INT  },
  { col: 'H',  header: 'Sales Volume (ttm)',                    key: 'ttm_volume_alt',                   style: STYLE_CURRENCY },
  { col: 'I',  header: 'Quarterly Volume',                      key: 'quarterly_volume',                 style: STYLE_CURRENCY },
  { col: 'J',  header: 'Quarterly Count',                       key: 'quarterly_count',                  style: STYLE_INTEGER  },
  { col: 'K',  header: 'Monthly Volume',                        key: 'monthly_volume',                   style: STYLE_CURRENCY },
  { col: 'L',  header: 'Monthly Count',                         key: 'monthly_count',                    style: STYLE_INTEGER  },
  { col: 'M',  header: 'Upper Quartile (ttm)',                  key: 'upper_quartile_cap_ttm',           style: STYLE_PCT_2DP  },
  { col: 'N',  header: 'Lower Quartile (ttm)',                  key: 'lower_quartile_cap_ttm',           style: STYLE_PCT_2DP  },
  { col: 'O',  header: 'Cap (ttm)',                             key: 'avg_cap_rate_ttm',                 style: STYLE_PCT_2DP  },
  // ---- R33 Phase 2 additions (all from master_m) ----
  { col: 'S',  header: '10-Year Treasury Yields',               key: 'treasury_10y_yield',               style: STYLE_PCT_2DP  },
  { col: 'T',  header: 'Low Assumed Loan Constant',             key: 'low_loan_constant',                style: STYLE_PCT_2DP  },
  { col: 'U',  header: 'High Assumed Loan Constant',            key: 'high_loan_constant',               style: STYLE_PCT_2DP  },
  { col: 'W',  header: 'NM Cap Rate (ttm)',                     key: 'nm_avg_cap_ttm',                   style: STYLE_PCT_2DP  },
  { col: 'X',  header: 'Non-NM Cap Rate (ttm)',                 key: 'non_nm_avg_cap_ttm',               style: STYLE_PCT_2DP  },
  { col: 'AB', header: '10+ Year Cap (ttm)',                    key: 'cap_10plus_year',                  style: STYLE_PCT_2DP  },
  { col: 'AD', header: '12+ Year Cap (ttm)',                    key: 'cap_12plus_year',                  style: STYLE_PCT_2DP  },
  { col: 'AE', header: '8 to 12 Year Cap (ttm)',                key: 'cap_8to12_year',                   style: STYLE_PCT_2DP  },
  { col: 'AF', header: '6 to 8 Year Cap (ttm)',                 key: 'cap_6to8_year',                    style: STYLE_PCT_2DP  },
  { col: 'AG', header: '5 or Less Year Cap (ttm)',              key: 'cap_5orless_year',                 style: STYLE_PCT_2DP  },
  { col: 'AK', header: 'Days on Market (ttm)',                  key: 'avg_dom',                          style: STYLE_INTEGER  },
  { col: 'AL', header: '% of Ask',                              key: 'pct_of_ask',                       style: STYLE_PCT_2DP  },
  { col: 'AM', header: 'Last Ask (ttm)',                        key: 'avg_last_ask_cap',                 style: STYLE_PCT_2DP  },
  { col: 'AO', header: 'Bid-Ask Spread',                        key: 'avg_bid_ask_spread',               style: STYLE_PCT_2DP  },
  { col: 'AP', header: 'Price Change (ttm)',                    key: 'pct_price_change_all',             style: STYLE_PCT_INT  },
  { col: 'AQ', header: '10+ Year Ask (ttm)',                    key: 'last_ask_cap_long_term',           style: STYLE_PCT_2DP  },
  { col: 'AR', header: '10+ Year Price Change (ttm)',           key: 'pct_price_change_long_term',       style: STYLE_PCT_INT  },
  { col: 'BE', header: 'YOY Change (%)',                        key: 'yoy_change_pct',                   style: STYLE_PCT_INT  },
  { col: 'BK', header: 'Individual Count (ttm)',                key: 'private_count',                    style: STYLE_INTEGER  },
  { col: 'BL', header: 'Fund Count (ttm)',                      key: 'institutional_count',              style: STYLE_INTEGER  },
  { col: 'BM', header: 'REIT Count (ttm)',                      key: 'reit_count',                       style: STYLE_INTEGER  },
];

function escapeXml(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

function cellNumXml(ref, value, styleIdx) {
  if (value == null || value === '' || Number.isNaN(Number(value))) {
    return ''; // omit empty cells — readers handle blanks
  }
  const styleAttr = styleIdx != null ? ` s="${styleIdx}"` : '';
  return `<c r="${ref}"${styleAttr}><v>${Number(value)}</v></c>`;
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

  // Compute dimension ref to span the full populated range. R31's
  // Phase 1 was hard-coded B-O; R33 Phase 2 extends through BM.
  // Derive from CHARTS_SHEET_COLUMNS so future column additions
  // update the dimension automatically.
  const allCols = CHARTS_SHEET_COLUMNS.map(c => c.col);
  const colSortKey = (a) => a.length === 1
    ? a.charCodeAt(0)
    : (a.charCodeAt(0) - 64) * 26 + (a.charCodeAt(1) - 64);
  const lastCol = allCols.reduce((acc, c) =>
    colSortKey(c) > colSortKey(acc) ? c : acc, 'B');

  // Header row (row 2)
  const headerCells = CHARTS_SHEET_COLUMNS
    .map(c => cellInlineStrXml(`${c.col}2`, c.header))
    .join('');

  // Data rows. Each cell carries the style index that maps to a numFmt in the
  // template's xl/styles.xml — this is what makes Excel render dates as
  // "Jan-08" instead of "39448", caps as "7.63%" instead of "0.0763", and
  // currency as "$518,106,944" instead of "518106944".
  const dataRows = rows.map((row, i) => {
    const r = dataRowsStartAt + i;
    const cells = CHARTS_SHEET_COLUMNS.map(c => {
      const ref = `${c.col}${r}`;
      let v = row[c.key];
      if (c.transform === 'date') {
        v = dateToExcelSerial(monthEndToMonthStart(v));
      }
      return cellNumXml(ref, v, c.style);
    }).join('');
    return `<row r="${r}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="B2:${lastCol}${lastRow}"/>
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
