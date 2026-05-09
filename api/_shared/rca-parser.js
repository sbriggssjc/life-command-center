// ============================================================================
// RCA TrendTracker Parser — Capital Markets Phase 2f
//
// Parses RCA TrendTracker .xls exports (one file per product type) into the
// shape expected by lcc_opps.public.cm_rca_quarterly:
//
//   { product_type, period_end, ttm_volume_dollars, ttm_property_count,
//     ttm_total_sf, ttm_cap_rate, ttm_top_quartile_cap, ttm_top_quartile_ppsf }
//
// ----------------------------------------------------------------------------
// Source-file shape (verified across all 4 products on 2026-05-05):
//
//   Sheet name:  'RCA Export Data'
//   Row 0:       'Report Run: M/D/YYYY'
//   Row 1-3:     Methodology footnotes (TTM avg, $2.5M floor, etc.)
//   Row 4:       blank
//   Row 5:       column headers
//   Row 6+:      data rows, one per quarter end (96 rows: 2002-Q1..2025-Q4)
//
// ----------------------------------------------------------------------------
// Header naming varies per product:
//
//   Office:     7 cols  'US Single Tenant Office {Volume,#,SF,Cap,TopQCap,TopQ$/SF}'
//   Retail:     7 cols  'US Retail {Volume,#,SF,Cap,TopQCap,TopQ$/SF}'
//   Medical:    7 cols  'US Medical {Volume,#,SF,Cap,TopQ$/SF,TopQCap}'  ← swapped!
//   Industrial: 6 cols  'US Single Tenant Industrial {Volume,#,SF,Cap,TopQCap}'  ← no TopQ$/SF
//
// Therefore: classify columns by HEADER KEYWORDS, never by column position.
// ============================================================================

import XLSX from 'xlsx';

const VALID_PRODUCT_TYPES = ['office', 'medical', 'industrial', 'retail'];

// Header keyword → measure key. Order matters: more-specific matches first.
const HEADER_RULES = [
  // Top quartile cap rate — must check before plain "Cap Rate"
  { test: (h) => /top\s*quartile/i.test(h) && /cap\s*rate/i.test(h),
    field: 'ttm_top_quartile_cap', kind: 'percent' },
  // Top quartile price per SF
  { test: (h) => /top\s*quartile/i.test(h) && /price.*\$?\s*\/?\s*sq?\s*ft/i.test(h),
    field: 'ttm_top_quartile_ppsf', kind: 'number' },
  // Plain TTM cap rate
  { test: (h) => /cap\s*rate/i.test(h),
    field: 'ttm_cap_rate', kind: 'percent' },
  // Volume ($)
  { test: (h) => /volume/i.test(h),
    field: 'ttm_volume_dollars', kind: 'number' },
  // Property count
  { test: (h) => /number\s*of\s*properties|#\s*properties|property\s*count/i.test(h),
    field: 'ttm_property_count', kind: 'integer' },
  // Total SF
  { test: (h) => /total\s*square\s*feet|total\s*sf|square\s*footage/i.test(h),
    field: 'ttm_total_sf', kind: 'number' },
];

// Product detection from header tokens (e.g. 'US Single Tenant Office Volume ($)')
const PRODUCT_KEYWORDS = {
  office:     /office/i,
  medical:    /medical/i,
  industrial: /industrial/i,
  retail:     /retail/i,
};

/**
 * Parse an RCA TrendTracker .xls/.xlsx buffer into normalized rows.
 *
 * @param {Buffer|ArrayBuffer|Uint8Array} buffer - file bytes
 * @param {object} [opts]
 * @param {string} [opts.expectedProductType] - 'office'|'medical'|'industrial'|'retail'
 *        If supplied and the file's headers identify a different product, the
 *        parser throws (defends against the user picking the wrong file from
 *        the wrong subfolder).
 * @returns {{
 *   product_type: string,
 *   report_run_date: string|null,    // ISO date, parsed from row 0 if present
 *   header_signature: string,         // first non-Date header for traceability
 *   rows: Array<{
 *     product_type, period_end, ttm_volume_dollars, ttm_property_count,
 *     ttm_total_sf, ttm_cap_rate, ttm_top_quartile_cap, ttm_top_quartile_ppsf
 *   }>,
 *   warnings: string[]
 * }}
 */
export function parseRcaExport(buffer, opts = {}) {
  const warnings = [];

  // SheetJS accepts Buffer, ArrayBuffer, Uint8Array
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('rca_parse_failed: workbook has no sheets');

  const sheet = wb.Sheets[sheetName];
  // sheet_to_json with header:1 returns array-of-arrays
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  if (rows.length < 7) {
    throw new Error(`rca_parse_failed: only ${rows.length} rows (need >=7 — 5 metadata + header + data)`);
  }

  // Row 0: 'Report Run: M/D/YYYY'
  let reportRunDate = null;
  const r0 = (rows[0]?.[0] || '').toString();
  const reportRunMatch = r0.match(/Report\s+Run:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (reportRunMatch) {
    const [, mm, dd, yyyy] = reportRunMatch;
    const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
    reportRunDate = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  // Find the header row — usually row 5, but tolerate small shifts
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = rows[i] || [];
    const first = (r[0] || '').toString().trim();
    if (first === 'Date' || /^date$/i.test(first)) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) {
    throw new Error('rca_parse_failed: could not locate header row (no "Date" column found in first 10 rows)');
  }

  const headers = (rows[headerRowIdx] || []).map((h) => (h == null ? '' : String(h).trim()));

  // Detect product type from header text
  const headerBlob = headers.slice(1).join(' | ');  // skip "Date"
  let detectedProduct = null;
  for (const [name, re] of Object.entries(PRODUCT_KEYWORDS)) {
    if (re.test(headerBlob)) { detectedProduct = name; break; }
  }
  if (!detectedProduct) {
    throw new Error(
      `rca_parse_failed: could not detect product from headers. ` +
      `Expected one of office/medical/industrial/retail. ` +
      `Headers seen: ${headerBlob.slice(0, 200)}`
    );
  }

  if (opts.expectedProductType && opts.expectedProductType !== detectedProduct) {
    throw new Error(
      `rca_parse_mismatch: file identifies as '${detectedProduct}' but ` +
      `caller expected '${opts.expectedProductType}'. ` +
      `Did you pick the wrong file from the wrong subfolder?`
    );
  }

  // Map header column index → measure field
  const colMap = {};  // { 'ttm_volume_dollars': 1, ... }
  for (let c = 1; c < headers.length; c++) {
    const h = headers[c];
    if (!h) continue;
    for (const rule of HEADER_RULES) {
      if (rule.test(h)) {
        if (colMap[rule.field] === undefined) {
          colMap[rule.field] = c;
        }
        // Once matched, don't fall through to less-specific rules
        break;
      }
    }
  }

  // Required measures (everyone has these)
  const required = ['ttm_volume_dollars', 'ttm_property_count', 'ttm_total_sf', 'ttm_cap_rate'];
  const missing = required.filter((f) => colMap[f] === undefined);
  if (missing.length) {
    throw new Error(
      `rca_parse_failed: missing required columns ${missing.join(', ')}. ` +
      `Headers seen: ${headerBlob.slice(0, 200)}`
    );
  }

  // top_quartile_cap is reported by Office/Medical/Industrial/Retail (all 4)
  if (colMap.ttm_top_quartile_cap === undefined) {
    warnings.push('header_missing_top_quartile_cap_rate');
  }
  // top_quartile_ppsf is missing on Industrial (and we tolerate it)
  if (colMap.ttm_top_quartile_ppsf === undefined && detectedProduct !== 'industrial') {
    warnings.push(`header_missing_top_quartile_ppsf (unexpected for ${detectedProduct})`);
  }

  // Walk data rows
  const out = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const dateCell = r[0];
    const periodEnd = coerceDateToISO(dateCell);
    if (!periodEnd) continue;  // skip blank/footer rows

    const row = {
      product_type: detectedProduct,
      period_end: periodEnd,
      ttm_volume_dollars:    coerceNumber(r[colMap.ttm_volume_dollars]),
      ttm_property_count:    coerceInteger(r[colMap.ttm_property_count]),
      ttm_total_sf:          coerceNumber(r[colMap.ttm_total_sf]),
      ttm_cap_rate:          coerceNumber(r[colMap.ttm_cap_rate]),
      ttm_top_quartile_cap:  colMap.ttm_top_quartile_cap !== undefined
                                ? coerceNumber(r[colMap.ttm_top_quartile_cap])
                                : null,
      ttm_top_quartile_ppsf: colMap.ttm_top_quartile_ppsf !== undefined
                                ? coerceNumber(r[colMap.ttm_top_quartile_ppsf])
                                : null,
    };
    out.push(row);
  }

  if (out.length === 0) {
    throw new Error('rca_parse_failed: 0 data rows produced');
  }

  return {
    product_type: detectedProduct,
    report_run_date: reportRunDate,
    header_signature: headers.slice(1, 4).join(' | '),
    rows: out,
    warnings,
  };
}

/**
 * Validate a product_type string. Returns lowercase canonical form, or throws.
 */
export function normalizeProductType(s) {
  if (typeof s !== 'string') throw new Error(`product_type must be string, got ${typeof s}`);
  const lc = s.trim().toLowerCase();
  if (!VALID_PRODUCT_TYPES.includes(lc)) {
    throw new Error(`Invalid product_type '${s}'. Must be one of: ${VALID_PRODUCT_TYPES.join(', ')}`);
  }
  return lc;
}

export { VALID_PRODUCT_TYPES };

// ----------------------------------------------------------------------------
// Cell coercion helpers — RCA exports use Excel native types when read with
// cellDates:true, but old .xls files occasionally surface dates as numbers.
// ----------------------------------------------------------------------------

function coerceDateToISO(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    // Excel serial date (days since 1899-12-30 with the 1900 leap-year bug)
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + v * 86400 * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === 'string') {
    // Try parsing common formats: 'M/D/YYYY', 'YYYY-MM-DD'
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const md = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (md) {
      const [, mm, dd, yyyy] = md;
      return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    // Anything else: not a date
    return null;
  }
  return null;
}

function coerceNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s%]/g, '');
    if (cleaned === '' || cleaned === '-' || /^n\/?a$/i.test(cleaned)) return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceInteger(v) {
  const n = coerceNumber(v);
  if (n == null) return null;
  return Math.round(n);
}
