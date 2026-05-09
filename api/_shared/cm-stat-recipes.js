// ============================================================================
// Capital Markets — Stat Recipes (Copilot tool support)
//
// Per chart_template_id, defines how to extract a single headline metric from
// a view row, format it, and compose a one-sentence stat suitable for
// pasting into an Outlook draft.
//
// Used by api/capital-markets.js#copilot_stat.
//
// Example output:
//   "Gov-leased TTM weighted cap is 7.47% as of 2024-Q2; up 32 bps YoY."
//
// Field-name divergence across verticals (e.g. ttm_weighted_cap_rate on gov
// vs cap_rate on natl_st) is handled by the `metric_keys` array — the first
// key found on the row wins.
// ============================================================================

// ----------------------------------------------------------------------------
// Vertical labels (used in the sentence template)
// ----------------------------------------------------------------------------
const VERTICAL_LABELS = {
  gov:         'Gov-leased',
  dialysis:    'Dialysis',
  national_st: 'National single-tenant',
};

// ----------------------------------------------------------------------------
// Per-template recipes.
//
//   metric_keys:  candidate row fields, in priority order (first match wins).
//                 Lets one recipe span verticals with divergent column names.
//   value_format: how to render the metric value.
//   yoy_field:    if the view already exposes a YoY delta on the row.
//   yoy_compute:  if YoY must be computed by diffing current vs prior period:
//                   'pct_diff' → (current - prior) / prior  (relative %)
//                   'bps_diff' → (current - prior) (already in fractional form,
//                                rendered as bps where 0.0032 → "32 bps")
//   verb:         "is" | "totals" | "stands at" — small variation by metric
//   metric_phrase: noun phrase describing the metric (slots into the sentence)
// ----------------------------------------------------------------------------
export const STAT_RECIPES = {
  volume_ttm_by_quarter: {
    metric_keys: ['volume_dollars'],
    value_format: 'currency_billions',
    yoy_field: 'yoy_change_pct',
    yoy_format: 'percent_signed',
    verb: 'totals',
    metric_phrase: 'TTM transaction volume',
  },
  cap_rate_ttm_by_quarter: {
    metric_keys: ['ttm_weighted_cap_rate', 'cap_rate'],
    value_format: 'percent_basis_points',
    yoy_compute: 'bps_diff',
    yoy_format: 'bps_signed',
    verb: 'is',
    metric_phrase: 'TTM weighted cap',
  },
  transaction_count_ttm: {
    metric_keys: ['ttm_count', 'deal_count'],
    value_format: 'integer_count',
    yoy_field: 'yoy_change_pct',
    yoy_format: 'percent_signed',
    verb: 'reached',
    metric_phrase: 'TTM transaction count',
  },
  avg_deal_size: {
    metric_keys: ['avg_deal_size'],
    value_format: 'currency_millions',
    yoy_compute: 'pct_diff',
    yoy_format: 'percent_signed',
    verb: 'averaged',
    metric_phrase: 'average deal size',
  },
  yoy_volume_change: {
    metric_keys: ['yoy_change_pct'],
    value_format: 'percent_signed',
    // No YoY-of-YoY; the metric IS the YoY
    verb: 'ran',
    metric_phrase: 'YoY volume change',
  },
  cap_rate_yoy_change: {
    metric_keys: ['yoy_change_bps'],
    value_format: 'bps_signed',
    verb: 'shifted',
    metric_phrase: 'cap rate YoY',
  },
  cap_rate_top_bottom_quartile: {
    metric_keys: ['top_quartile_cap', 'top_quartile'],
    value_format: 'percent_basis_points',
    yoy_compute: 'bps_diff',
    yoy_format: 'bps_signed',
    verb: 'is',
    metric_phrase: 'top-quartile TTM cap',
  },
  fed_funds_vs_treasury: {
    metric_keys: ['treasury_10y_yield'],
    value_format: 'percent_one_decimal',
    yoy_compute: 'bps_diff',
    yoy_format: 'bps_signed',
    verb: 'sat at',
    metric_phrase: '10Y Treasury',
  },
  net_lease_spread: {
    metric_keys: ['net_lease_spread', 'market_spread'],
    value_format: 'bps_unsigned',
    yoy_compute: 'bps_diff',
    yoy_format: 'bps_signed',
    verb: 'is',
    metric_phrase: 'net lease spread',
  },
};

// ----------------------------------------------------------------------------
// Formatters — compact, suitable for one-line emails / chat. All accept a
// numeric value and return a string. Null/undefined returns 'n/a'.
// ----------------------------------------------------------------------------

function fmt(v, format) {
  if (v == null) return 'n/a';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'n/a';

  switch (format) {
    case 'currency_billions': {
      const abs = Math.abs(n);
      if (abs >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
      if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
      if (abs >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
      return '$' + n.toFixed(0);
    }
    case 'currency_millions': {
      const abs = Math.abs(n);
      if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
      if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
      if (abs >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
      return '$' + n.toFixed(0);
    }
    case 'percent_basis_points':
      return (n * 100).toFixed(2) + '%';
    case 'percent_one_decimal':
      return (n * 100).toFixed(1) + '%';
    case 'percent_signed': {
      // n is already a fraction; render as +X.X% / -X.X%
      const sign = n >= 0 ? '+' : '';
      return sign + (n * 100).toFixed(1) + '%';
    }
    case 'bps_signed': {
      // n is a fractional delta (e.g. 0.0032 → +32 bps)
      const bps = Math.round(n * 10000);
      const sign = bps >= 0 ? '+' : '';
      return sign + bps + ' bps';
    }
    case 'bps_unsigned': {
      const bps = Math.round(n * 10000);
      return bps + ' bps';
    }
    case 'integer_count':
      return Math.round(n).toLocaleString('en-US');
    default:
      return String(n);
  }
}

// ----------------------------------------------------------------------------
// Period label: 2024-06-30 → "2024-Q2"
// ----------------------------------------------------------------------------
export function periodLabel(periodEnd) {
  if (!periodEnd) return '';
  const s = String(periodEnd).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (!m) return s;
  const [, y, mm] = m;
  const month = parseInt(mm, 10);
  const q = Math.ceil(month / 3);
  return `${y}-Q${q}`;
}

// ----------------------------------------------------------------------------
// Pull a value from a row using the recipe's candidate fields.
// ----------------------------------------------------------------------------
function pickValue(row, keys) {
  if (!row || !Array.isArray(keys)) return null;
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
  }
  return null;
}

// ----------------------------------------------------------------------------
// Find the row 4 quarters earlier than the given period_end (for YoY).
// rows are assumed sorted ASC by period_end. Returns null if not found.
// ----------------------------------------------------------------------------
function priorYearRow(rows, period_end) {
  if (!Array.isArray(rows) || !period_end) return null;
  const idx = rows.findIndex((r) => r.period_end === period_end);
  if (idx < 4) return null;
  return rows[idx - 4];
}

// ----------------------------------------------------------------------------
// Compose a stat from a recipe + the relevant row(s).
//
// @param {string} chart_template_id
// @param {string} vertical          - 'gov' | 'dialysis' | 'national_st'
// @param {string} subspecialty      - filter context, included in note when not 'all'
// @param {Array}  rows              - all rows in the view (sorted ASC by period_end)
// @param {string} as_of             - target period_end (YYYY-MM-DD); falls back to last row
// @returns {object|null} stat object or null if recipe / row missing
// ----------------------------------------------------------------------------
export function composeStat({ chart_template_id, vertical, subspecialty, rows, as_of }) {
  const recipe = STAT_RECIPES[chart_template_id];
  if (!recipe) {
    return {
      ok: false,
      error: 'recipe_not_implemented',
      chart_template_id,
      hint: `Available templates: ${Object.keys(STAT_RECIPES).join(', ')}`,
    };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'no_data', chart_template_id, vertical, subspecialty };
  }

  // Resolve target row.
  // - If as_of is supplied, use that exact row (and surface metric_value_missing
  //   if the metric is null there — caller asked for that specific period).
  // - If as_of is omitted, walk backwards from the latest row to the first row
  //   that has a non-null metric. Recent quarters often have incomplete data
  //   (e.g. partial-quarter Q2 with null cap rate, or FRED quarter that extends
  //   past the RCA aggregate). Falling back to the most-recent valid row is
  //   what callers actually want for "give me the headline number".
  let targetRow = null;
  if (as_of) {
    targetRow = rows.find((r) => r.period_end === as_of) || null;
  } else {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (pickValue(rows[i], recipe.metric_keys) != null) {
        targetRow = rows[i];
        break;
      }
    }
    if (!targetRow) targetRow = rows[rows.length - 1];
  }
  if (!targetRow) {
    return { ok: false, error: 'no_target_row', chart_template_id, as_of };
  }

  const period_end = targetRow.period_end;
  const value = pickValue(targetRow, recipe.metric_keys);
  if (value == null) {
    return {
      ok: false,
      error: 'metric_value_missing',
      tried_keys: recipe.metric_keys,
      period_end,
      hint: 'The row at this period_end has a null metric. Try omitting as_of to use the latest non-null period.',
    };
  }

  // YoY delta
  let yoyDelta = null;
  let yoyMethod = null;

  if (recipe.yoy_field) {
    yoyDelta = targetRow[recipe.yoy_field];
    yoyMethod = 'view_field';
  } else if (recipe.yoy_compute === 'pct_diff') {
    const prior = priorYearRow(rows, period_end);
    if (prior) {
      const priorVal = pickValue(prior, recipe.metric_keys);
      if (priorVal != null && priorVal !== 0) {
        yoyDelta = (Number(value) - Number(priorVal)) / Number(priorVal);
        yoyMethod = 'computed_pct';
      }
    }
  } else if (recipe.yoy_compute === 'bps_diff') {
    const prior = priorYearRow(rows, period_end);
    if (prior) {
      const priorVal = pickValue(prior, recipe.metric_keys);
      if (priorVal != null) {
        yoyDelta = Number(value) - Number(priorVal);
        yoyMethod = 'computed_bps';
      }
    }
  }

  // Format
  const value_formatted = fmt(value, recipe.value_format);
  const yoy_delta_formatted = yoyDelta == null ? null : fmt(yoyDelta, recipe.yoy_format);
  const direction = yoyDelta == null ? null : (yoyDelta >= 0 ? 'up' : 'down');

  // Compose sentence
  const verticalLabel = VERTICAL_LABELS[vertical] || vertical;
  const subSuffix = subspecialty && subspecialty !== 'all'
    ? ` (${String(subspecialty).toUpperCase()})`
    : '';
  const periodTxt = periodLabel(period_end);

  let sentence = `${verticalLabel}${subSuffix} ${recipe.metric_phrase} ${recipe.verb} ${value_formatted} as of ${periodTxt}`;
  if (yoy_delta_formatted) {
    // For metrics where the value IS already a YoY change, suppress redundant suffix
    const valueIsYoy = ['percent_signed'].includes(recipe.value_format)
                    && (recipe.metric_keys.includes('yoy_change_pct') || recipe.metric_keys.includes('yoy_change_bps'));
    if (!valueIsYoy) {
      // Strip leading sign from formatted delta for the verb-paired direction word
      const magnitude = yoy_delta_formatted.replace(/^[+\-]/, '');
      sentence += `; ${direction} ${magnitude} YoY`;
    }
  }
  sentence += '.';

  return {
    ok: true,
    chart_template_id,
    vertical,
    subspecialty: subspecialty || 'all',
    period_end,
    period_label: periodTxt,
    metric_phrase: recipe.metric_phrase,
    value,
    value_formatted,
    yoy_delta: yoyDelta,
    yoy_delta_formatted,
    yoy_method: yoyMethod,
    direction,
    stat_text: sentence,
  };
}

// ----------------------------------------------------------------------------
// Public registry of supported templates (for the catalog endpoint)
// ----------------------------------------------------------------------------
export function listSupportedTemplates() {
  return Object.keys(STAT_RECIPES);
}
