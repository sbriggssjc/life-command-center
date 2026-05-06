// ============================================================================
// Capital Markets — Summary Table builder
//
// Produces the 7-column "current Q + prior Q + YoY Q + prior cycle + 5/10/15-yr
// avg" snapshot table that appears on 9 separate pages of the gov deliverable
// PDF and equivalent pages of the dialysis deliverable. Marketing currently
// builds this by hand from the master XLSX every quarter.
//
// Phase 1 of the parity audit's Tier-1 punch list:
//   - volume_cap_summary_table: 4 rows (Volume / Avg Cap / Upper Quartile Cap /
//     Lower Quartile Cap) × 7 columns
//
// Pure client/server-side aggregation over already-fetched time series — does
// not require a new SQL view. Inputs are the same row-arrays that the chart
// dispatch already returns.
//
// Field-name divergence across verticals (gov uses ttm_weighted_cap_rate /
// top_quartile / bottom_quartile, national_st uses cap_rate /
// top_quartile_cap / bottom_quartile_cap) is handled via candidate-key
// lookup — same pattern as cm-stat-recipes.js.
// ============================================================================

import { periodLabel } from './cm-stat-recipes.js';

// Candidate field names per metric, in priority order
const FIELD_KEYS = {
  volume:          ['volume_dollars'],
  cap_rate:        ['ttm_weighted_cap_rate', 'cap_rate'],
  upper_quartile:  ['top_quartile_cap', 'top_quartile'],
  lower_quartile:  ['bottom_quartile_cap', 'bottom_quartile'],
};

function pickValue(row, keys) {
  if (!row) return null;
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
  }
  return null;
}

/**
 * Find row at a specific period_end. Returns null if not found.
 */
function rowAt(rows, period_end) {
  if (!Array.isArray(rows) || !period_end) return null;
  return rows.find((r) => r.period_end === period_end) || null;
}

/**
 * Compute the period_end for "N quarters before as_of" assuming all rows have
 * canonical quarter-end dates (Mar 31 / Jun 30 / Sep 30 / Dec 31).
 *
 * Returns null if as_of is malformed.
 */
function quartersBefore(as_of, n) {
  if (!as_of) return null;
  const m = String(as_of).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  // Jan-Mar=Q1 → end Mar 31; Apr-Jun=Q2 → Jun 30; Jul-Sep=Q3 → Sep 30; Oct-Dec=Q4 → Dec 31
  const q = Math.ceil(month / 3);
  // Convert to total-quarters since year 0
  const totalQ = year * 4 + (q - 1);
  const targetTotalQ = totalQ - n;
  const targetYear = Math.floor(targetTotalQ / 4);
  const targetQ = (targetTotalQ % 4) + 1;
  const targetMonth = targetQ * 3;
  const lastDay = (targetMonth === 3) ? 31
                : (targetMonth === 6) ? 30
                : (targetMonth === 9) ? 30
                : 31;
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Compute trailing-N-quarter average ending at as_of (inclusive).
 * Skips nulls. Returns null if no valid samples.
 */
function trailingAvg(rows, asOfPeriod, nQuarters, fieldKeys) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const idx = rows.findIndex((r) => r.period_end === asOfPeriod);
  if (idx < 0) return null;
  const start = Math.max(0, idx - nQuarters + 1);
  let sum = 0, count = 0;
  for (let i = start; i <= idx; i++) {
    const v = pickValue(rows[i], fieldKeys);
    if (v != null && Number.isFinite(Number(v))) {
      sum += Number(v);
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

/**
 * Build the 4-row × 7-column volume + cap summary for a single (vertical,
 * subspecialty, as_of) tuple.
 *
 * @param {object} args
 * @param {Array}  args.volumeRows   - cm_*_volume_ttm_q rows (asc by period_end)
 * @param {Array}  args.capRows      - cm_*_cap_ttm_q rows
 * @param {Array}  args.quartileRows - cm_*_cap_quartile_q rows
 * @param {string} args.asOf         - target quarter-end (YYYY-MM-DD); if null,
 *                                     uses the most recent period_end shared
 *                                     across all 3 row-arrays
 * @returns {Array<object>} 4 row objects, each with 7 numeric/null fields
 *   plus metric / format metadata. Suitable for direct rendering in Excel
 *   (one cell per column) or HTML table.
 */
export function buildVolumeCapSummary({ volumeRows = [], capRows = [], quartileRows = [], asOf = null }) {
  // Resolve as_of when not supplied. The deliverable always anchors on the
  // latest *closed* period — meaning a quarter with reported cap rate, not
  // just transactions in flight. Find the latest period_end where:
  //   - volume row exists with non-null volume_dollars
  //   - cap row exists with non-null cap_rate / ttm_weighted_cap_rate
  // The cap-rate gate filters out partial-quarter rows that have a few sales
  // but not enough to publish a representative cap rate.
  let resolved = asOf;
  if (!resolved) {
    const capPeriods = new Set(
      capRows.filter((r) => pickValue(r, FIELD_KEYS.cap_rate) != null).map((r) => r.period_end)
    );
    const candidate = [...volumeRows]
      .reverse()
      .find((r) => pickValue(r, FIELD_KEYS.volume) != null && capPeriods.has(r.period_end));
    resolved = candidate?.period_end
      // Last-resort fallback: latest non-null volume row even without cap
      || [...volumeRows].reverse().find((r) => pickValue(r, FIELD_KEYS.volume) != null)?.period_end
      || null;
  }

  if (!resolved) {
    return [];  // No data
  }

  // Period anchors
  const periods = {
    current_q:     resolved,
    prior_q:       quartersBefore(resolved, 1),
    yoy_q:         quartersBefore(resolved, 4),
    prior_cycle_q: quartersBefore(resolved, 8),
  };

  const buildRow = (label, format, fieldKeys, sourceRows) => {
    const cur = rowAt(sourceRows, periods.current_q);
    const prq = rowAt(sourceRows, periods.prior_q);
    const yoy = rowAt(sourceRows, periods.yoy_q);
    const cyc = rowAt(sourceRows, periods.prior_cycle_q);
    return {
      metric: label,
      format,
      current_q:     pickValue(cur, fieldKeys),
      prior_q:       pickValue(prq, fieldKeys),
      yoy_q:         pickValue(yoy, fieldKeys),
      prior_cycle_q: pickValue(cyc, fieldKeys),
      avg_5yr:       trailingAvg(sourceRows, resolved, 20, fieldKeys),
      avg_10yr:      trailingAvg(sourceRows, resolved, 40, fieldKeys),
      avg_15yr:      trailingAvg(sourceRows, resolved, 60, fieldKeys),
    };
  };

  return [
    buildRow('Volume',              'currency_dollars',     FIELD_KEYS.volume,         volumeRows),
    buildRow('Average Cap Rate',    'percent_basis_points', FIELD_KEYS.cap_rate,       capRows),
    buildRow('Upper Quartile Cap',  'percent_basis_points', FIELD_KEYS.upper_quartile, quartileRows),
    buildRow('Lower Quartile Cap',  'percent_basis_points', FIELD_KEYS.lower_quartile, quartileRows),
  ].map((r) => ({
    ...r,
    period_label: periodLabel(periods.current_q),
    as_of: periods.current_q,
  }));
}

/**
 * Convert a summary-table row (one of the 4 above) into a header-aligned cell
 * array suitable for a flat 7-column rendering. Returns labels + values in the
 * canonical column order: current Q, prior Q, YoY Q, prior cycle, 5/10/15-yr avg.
 */
export const SUMMARY_COLUMN_KEYS = [
  { key: 'current_q',     header: 'Current Q' },          // header is replaced at render time with periodLabel
  { key: 'prior_q',       header: 'Prior Q' },
  { key: 'yoy_q',         header: 'YoY Q' },
  { key: 'prior_cycle_q', header: 'Prior Cycle' },
  { key: 'avg_5yr',       header: '5-Yr Avg' },
  { key: 'avg_10yr',      header: '10-Yr Avg' },
  { key: 'avg_15yr',      header: '15-Yr Avg' },
];

/**
 * Resolve dynamic column headers for a given as_of:
 *   "Current Q" → "2Q-2024" (using the actual quarter)
 *   "Prior Q"   → "1Q-2024"
 *   ...
 */
export function summaryColumnHeaders(asOf) {
  if (!asOf) return SUMMARY_COLUMN_KEYS.map((c) => c.header);
  const q = (n) => quartersBefore(asOf, n);
  return [
    periodLabel(asOf),
    periodLabel(q(1)),
    periodLabel(q(4)),
    periodLabel(q(8)),
    '5-Yr Avg',
    '10-Yr Avg',
    '15-Yr Avg',
  ];
}

// ============================================================================
// Volume + Cap + Quartile combo (canonical "front-cover" chart)
// ============================================================================
//
// Joins the three time-series feeds (volume_ttm_q, cap_ttm_q, cap_quartile_q)
// into a single per-quarter row. Used by the deliverable's front-cover combo
// chart on gov p.6/7/8/13, dialysis p.19, and the ST workbook Vol/* sheets.
//
// Output rows are sorted ASC by period_end. Each row has the same period_end
// across all 3 source series; rows where the volume row is null are dropped
// (those are typically pre-2002 padding or future/forecast rows). Cap rate
// and quartile values can be null individually (e.g. partial quarter, RCA
// products that don't report bottom quartile).
//
// @param {object} args
// @param {Array}  args.volumeRows   - cm_*_volume_ttm_q rows, sorted ASC
// @param {Array}  args.capRows      - cm_*_cap_ttm_q rows
// @param {Array}  args.quartileRows - cm_*_cap_quartile_q rows
// @returns {Array<object>} Joined rows: { period_end, subspecialty,
//   volume_dollars, cap_rate, upper_quartile, lower_quartile }
// ============================================================================
export function joinVolumeCapQuartile({ volumeRows = [], capRows = [], quartileRows = [] }) {
  if (!Array.isArray(volumeRows) || volumeRows.length === 0) return [];

  // Index cap and quartile rows by period_end for O(1) lookup
  const capByPeriod = new Map(
    (capRows || []).map((r) => [r.period_end, r])
  );
  const qByPeriod = new Map(
    (quartileRows || []).map((r) => [r.period_end, r])
  );

  const out = [];
  for (const v of volumeRows) {
    if (!v?.period_end) continue;
    const volume_dollars = pickValue(v, FIELD_KEYS.volume);
    if (volume_dollars == null) continue;  // skip pre-data rows

    const c = capByPeriod.get(v.period_end);
    const q = qByPeriod.get(v.period_end);

    out.push({
      period_end:     v.period_end,
      subspecialty:   v.subspecialty ?? c?.subspecialty ?? q?.subspecialty ?? null,
      volume_dollars,
      cap_rate:       c ? pickValue(c, FIELD_KEYS.cap_rate)        : null,
      upper_quartile: q ? pickValue(q, FIELD_KEYS.upper_quartile)  : null,
      lower_quartile: q ? pickValue(q, FIELD_KEYS.lower_quartile)  : null,
    });
  }
  return out;
}

// Internal exports for tests
export const _internal = { quartersBefore, trailingAvg, rowAt, pickValue, FIELD_KEYS };
