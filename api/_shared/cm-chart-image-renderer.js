// ============================================================================
// Capital Markets — Chart-image renderer (server-side PNG via QuickChart)
// Life Command Center
//
// Renders chart-per-tab PNG images for the workbook export. Each Data_* tab
// embeds the matching PNG at the top + data table below.
//
// Trade-offs:
//   1. External dependency on quickchart.io (or self-hosted instance)
//   2. Proprietary data flows to the rendering service for image generation
//   3. Render latency: ~500ms per chart, parallelized via Promise.all
//
// CM_QUICKCHART_URL env var can point at a self-hosted Docker QuickChart
// instance for full data sovereignty.
//
// Visual style targets the master XLSX (Dialysis Comp Work MASTER) chart
// objects: Northmarq palette (navy primary, sky secondary, pale fill),
// Calibri family, intl-formatted axes (currency / percent / integer).
// ============================================================================

const QUICKCHART_URL =
  process.env.CM_QUICKCHART_URL || 'https://quickchart.io/chart';

const RENDER_DEFAULT_WIDTH  = 900;
const RENDER_DEFAULT_HEIGHT = 480;
const RENDER_TIMEOUT_MS     = 15_000;

// Recent-window crop. User feedback (2026-05-07): "we are starting around
// 2016. Ideally, I want this data to go back as long as we have data to
// track for it reliably. Historically that's been 2001-ish for other
// categories." → bumped windows to capture roughly 2001 onward.
// Round D4 (2026-05-22) bumped further after extending dialysis master_m
// generate_series to 2001-01-01 — earlier crop of 288 months was clipping
// the earliest 14 months of newly-extended data.
// Quarterly: 104 rows ≈ 26 years; monthly: 312 ≈ 26 years.
const RECENT_QUARTERS_DEFAULT = 104;  // ~26 years quarterly (back to 2000)
const RECENT_MONTHS_DEFAULT   = 312;  // ~26 years monthly  (back to 2000)
const RECENT_YEARS_DEFAULT    = 26;   // 26 calendar years (annual templates)

// Brand-aligned series colors (hex strings).
function paletteSeries(brand) {
  const p = brand?.palette || {};
  return [
    p.nm_navy     || '#003DA5', // [0] primary
    p.nm_sky      || '#62B5E5', // [1] accent
    p.nm_blue_mid || '#265AB2', // [2] series 3
    p.nm_pale     || '#E0E8F4', // [3] fill
    p.nm_axis     || '#6A748C', // [4] axis / muted
    p.nm_text     || '#191919', // [5] text
  ];
}

function periodEndLabel(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const m = dt.getUTCMonth();
  const y = dt.getUTCFullYear();
  const q = Math.floor(m / 3) + 1;
  return `Q${q} '${String(y).slice(2)}`;
}

// Slice rows to the most recent N entries (or pass through if fewer).
function recentRows(rows, n) {
  if (!Array.isArray(rows)) return [];
  if (rows.length <= n) return rows;
  return rows.slice(rows.length - n);
}

// ============================================================================
// Axis-format helpers (Chart.js v3 — uses Intl.NumberFormat)
// ============================================================================
//
// QuickChart's JSON parser doesn't evaluate JS callback strings — anything
// shaped like `function(v) { ... }` is sent to Chart.js as a literal string,
// not a function. So we use Chart.js's built-in `format` option (which
// internally calls Intl.NumberFormat) instead of `callback`.

const AXIS_FORMAT_PERCENT_2DP = {
  format: { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 },
};
const AXIS_FORMAT_PERCENT_1DP = {
  format: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
};
const AXIS_FORMAT_PERCENT_0DP = {
  format: { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 0 },
};
const AXIS_FORMAT_CURRENCY_COMPACT = {
  format: { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 },
};
const AXIS_FORMAT_CURRENCY = {
  format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
};
const AXIS_FORMAT_INTEGER = {
  format: { style: 'decimal', maximumFractionDigits: 0 },
};

// ============================================================================
// Common Chart.js v3 options
// ============================================================================

function commonOpts({ yAxisFormat, yAxisRange, xMaxTicks = 12, legendPosition = 'bottom' } = {}) {
  const opts = {
    responsive: false,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: legendPosition,
        labels: { color: '#191919', font: { family: 'Calibri', size: 11 } },
      },
    },
    scales: {
      x: {
        ticks: {
          color: '#6A748C',
          font: { family: 'Calibri', size: 9 },
          maxTicksLimit: xMaxTicks,
          autoSkip: true,
        },
        grid: { display: false },
      },
      y: {
        ticks: {
          color: '#6A748C',
          font: { family: 'Calibri', size: 9 },
          ...(yAxisFormat || {}),
        },
        grid: { color: '#E7E6E6' },
      },
    },
  };
  if (yAxisRange) {
    if (yAxisRange.min != null) opts.scales.y.min = yAxisRange.min;
    if (yAxisRange.max != null) opts.scales.y.max = yAxisRange.max;
  }
  return opts;
}

// Helper: dual-axis combo options (left = primary, right = secondary).
// Optional yLeft/yRightRange = { min, max } pins the axis so the data
// uses the visible vertical range instead of being compressed to a tiny
// band when auto-scaling fails (e.g. cap rates 6-7% squashed against an
// auto axis of 0-8% with empty 0-6% space).
function comboOpts({ yLeftFormat, yRightFormat, xMaxTicks = 12, yLeftRange, yRightRange } = {}) {
  const opts = commonOpts({ yAxisFormat: yLeftFormat, xMaxTicks });
  if (yLeftRange) {
    if (yLeftRange.min != null) opts.scales.y.min = yLeftRange.min;
    if (yLeftRange.max != null) opts.scales.y.max = yLeftRange.max;
  }
  opts.scales.y1 = {
    position: 'right',
    ticks: {
      color: '#6A748C',
      font: { family: 'Calibri', size: 9 },
      ...(yRightFormat || {}),
    },
    grid: { display: false },
  };
  if (yRightRange) {
    if (yRightRange.min != null) opts.scales.y1.min = yRightRange.min;
    if (yRightRange.max != null) opts.scales.y1.max = yRightRange.max;
  }
  return opts;
}

// Standard cap-rate axis range. Dialysis cap rates land in 5-9% range
// historically; pinning the y-axis here keeps the data legible and
// matches the master XLSX cap-rate charts.
const CAP_RATE_RANGE = { min: 0.05, max: 0.10 };

// Tight cap-rate range for charts where the data is concentrated 5.5-7.5%
// and a 5-10% range wastes vertical space (Active Cap Quartiles, Sentiment
// last-ask cap, Vol-Cap quartile band).
const CAP_RATE_TIGHT_RANGE = { min: 0.05, max: 0.08 };

// Even tighter range for Bid-Ask Last Ask Cap and Avail Mkt Size avg cap —
// real data lives 5.8-7.5%. User feedback (2026-05-07): "the line is
// behind and below the other data… want a tighter range… so we can see
// the up and down movement".
const CAP_RATE_BID_ASK_RANGE = { min: 0.055, max: 0.080 };

// % of Ask Price axis range. User feedback (2026-05-07) on Data_DOM_Ask:
// "the Y-axis for the % of Ask Price makes it look like one straight line
// from left to right". Tightened from 0.80–1.10 to 0.90–1.05 (real
// closed-sale data is 0.93–1.02; this gives breathing room without
// flattening the line).
const PCT_OF_ASK_RANGE = { min: 0.90, max: 1.05 };

// ============================================================================
// Per-template Chart.js v3 config builders
// ============================================================================

function buildChartConfig(chart, brand) {
  if (!chart || !chart.rows || chart.rows.length === 0) return null;
  const palette = paletteSeries(brand);

  // Crop to recent window for legibility. Annual templates (year column)
  // get the year-window; monthly templates (cadence='monthly' OR data_shape
  // includes 'monthly') get the monthly window; everything else uses the
  // quarter window. The cadence hint lets the export endpoint swap
  // quarterly chart rows for master_m monthly data without re-encoding the
  // chart_template_id.
  const isAnnual  = String(chart.data_shape || '').includes('yearly');
  const isMonthly = chart.cadence === 'monthly'
                 || String(chart.data_shape || '').includes('monthly');
  const windowSize = isAnnual  ? RECENT_YEARS_DEFAULT
                   : isMonthly ? RECENT_MONTHS_DEFAULT
                   :             RECENT_QUARTERS_DEFAULT;
  const rows = recentRows(chart.rows, windowSize);
  const labels = rows.map(r => periodEndLabel(r.period_end || r.year));

  switch (chart.chart_template_id) {
    case 'volume_ttm_by_quarter': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'TTM Volume',
            data: rows.map(r => r.volume_dollars),
            borderColor: palette[0],
            backgroundColor: palette[3],
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2.5,
          }],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_CURRENCY_COMPACT }),
      };
    }

    case 'cap_rate_ttm_by_quarter': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Avg Cap Rate (TTM, weighted)',
            data: rows.map(r => r.ttm_weighted_cap_rate),
            borderColor: palette[0],
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2.5,
          }],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP, yAxisRange: CAP_RATE_RANGE }),
      };
    }

    case 'nm_vs_market_cap': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'NM Cap Rate',     data: rows.map(r => r.nm_cap_rate),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Market Cap Rate', data: rows.map(r => r.market_cap_rate),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP, yAxisRange: CAP_RATE_RANGE }),
      };
    }

    case 'yoy_volume_change': {
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'YoY Change %',
            data: rows.map(r => r.yoy_change_pct),
            backgroundColor: rows.map(r =>
              (r.yoy_change_pct >= 0 ? palette[0] : palette[2])
            ),
            borderRadius: 2,
          }],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_0DP }),
      };
    }

    case 'transaction_count_ttm': {
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'TTM Transactions',
            data: rows.map(r => r.ttm_count ?? r.count),
            backgroundColor: palette[0],
            borderRadius: 2,
          }],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_INTEGER }),
      };
    }

    case 'avg_deal_size': {
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Avg Deal Size',
            data: rows.map(r => r.avg_deal_size),
            backgroundColor: palette[0],
            borderRadius: 2,
          }],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_CURRENCY_COMPACT }),
      };
    }

    case 'cap_rate_top_bottom_quartile': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Top Quartile',    data: rows.map(r => r.top_quartile),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: 'Median',          data: rows.map(r => r.median),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Bottom Quartile', data: rows.map(r => r.bottom_quartile),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP, yAxisRange: CAP_RATE_RANGE }),
      };
    }

    case 'cap_rate_by_lease_term': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: '10+ Year',       data: rows.map(r => r.cap_10plus),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: '6-10 Year',      data: rows.map(r => r.cap_6to10),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: '< 5 Year',       data: rows.map(r => r.cap_less5),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: 'Outside Firm',   data: rows.map(r => r.cap_outside_firm),
              borderColor: palette[4], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [3, 3] },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP, yAxisRange: CAP_RATE_RANGE }),
      };
    }

    case 'dom_and_pct_of_ask':
    case 'dom_and_pct_of_ask_monthly': {
      // Right axis (% of Ask) pinned 80-110% so the 96-100% data lives
      // in the visible range. Auto-scaled 0-120% was hiding movement.
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar',  label: 'Avg Days on Market',
              data: rows.map(r => r.avg_dom),
              backgroundColor: palette[3], borderRadius: 2,
              yAxisID: 'y', order: 2 },
            { type: 'line', label: '% of Ask Price',
              data: rows.map(r => r.pct_of_ask),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 1, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
          ],
        },
        options: comboOpts({
          yLeftFormat:  AXIS_FORMAT_INTEGER,
          yRightFormat: AXIS_FORMAT_PERCENT_1DP,
          // PCT_OF_ASK_RANGE tightened to 0.90-1.05 (was 0.80-1.10)
          // so the % of Ask line shows real movement.
          yRightRange:  PCT_OF_ASK_RANGE,
        }),
      };
    }

    case 'bid_ask_spread':
    case 'bid_ask_spread_monthly': {
      // Deliverable p.34: Bid-Ask Spread bars (left axis) + Last Ask line
      // (right axis, cap-rate range). When avg_last_ask_cap is missing
      // (older quarterly view) we fall back to spread-only.
      const hasLastAsk = rows.some(r => r.avg_last_ask_cap != null);
      if (hasLastAsk) {
        return {
          type: 'bar',
          data: {
            labels,
            datasets: [
              // Chart.js draws lower `order` LATER (on top). Bar order=2
              // pushes the bars BEHIND the line so the Last Ask Cap line
              // is visible across the chart even when the bar ranges
              // overlap with it. User feedback (2026-05-07): "want the
              // line to display above the bar chart elements for as
              // much of the data as possible".
              { type: 'bar',  label: 'Bid-Ask Spread (bps)',
                data: rows.map(r => r.avg_bid_ask_spread),
                backgroundColor: palette[3], borderRadius: 1,
                yAxisID: 'y', order: 2 },
              { type: 'line', label: 'Last Ask Cap',
                data: rows.map(r => r.avg_last_ask_cap),
                borderColor: palette[0], backgroundColor: 'transparent',
                tension: 0.3, pointRadius: 0, borderWidth: 2.5,
                yAxisID: 'y1', order: 0 },
            ],
          },
          options: comboOpts({
            yLeftFormat:  AXIS_FORMAT_PERCENT_2DP,
            yRightFormat: AXIS_FORMAT_PERCENT_2DP,
            // 5.5-8% — last-ask cap data lives 5.8-7.5%. Tighter than
            // CAP_RATE_TIGHT_RANGE so the line shows movement.
            yRightRange:  CAP_RATE_BID_ASK_RANGE,
          }),
        };
      }
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Bid-Ask Spread (bps)',
            data: rows.map(r => r.avg_bid_ask_spread),
            borderColor: palette[0],
            backgroundColor: palette[3],
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2,
          }],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP }),
      };
    }

    case 'seller_sentiment':
    case 'seller_sentiment_monthly': {
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            // order=2 on bars pushes them behind the cap lines.
            { type: 'bar',  label: 'Price Change %',
              data: rows.map(r => r.pct_price_change_all),
              backgroundColor: palette[3], borderRadius: 1,
              yAxisID: 'y', order: 2 },
            { type: 'bar',  label: '8+ Yr Term Price Change %',
              data: rows.map(r => r.pct_price_change_long_term),
              backgroundColor: palette[1], borderRadius: 1,
              yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Last Asking Cap (all)',
              data: rows.map(r => r.last_ask_cap_all),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2,
              yAxisID: 'y1', order: 0 },
            { type: 'line', label: 'Last Asking Cap (8+ yr)',
              data: rows.map(r => r.last_ask_cap_long_term),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2,
              yAxisID: 'y1', order: 0 },
          ],
        },
        options: comboOpts({
          yLeftFormat:  AXIS_FORMAT_PERCENT_1DP,
          yLeftRange:   { min: 0, max: 0.30 },  // price-change % up to 30%
          yRightFormat: AXIS_FORMAT_PERCENT_2DP,
          // Tighter than CAP_RATE_TIGHT_RANGE per user feedback —
          // last-ask cap on sentiment lives 5.8-7.5%.
          yRightRange:  CAP_RATE_BID_ASK_RANGE,
        }),
      };
    }

    case 'valuation_index': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Valuation Index',
            data: rows.map(r => r.valuation_index),
            borderColor: palette[0],
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2.5,
          }],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_INTEGER }),
      };
    }

    case 'rent_psf_box_quarterly':
    case 'ppsf_box_quarterly': {
      // User feedback (2026-05-07): "There is no chart in Data_Rent_PSF_Box.
      // Its also displayed in weird timeline increments." Add an IQR-as-bar
      // chart: floating bar from lower_quartile→upper_quartile, with the
      // median rendered as a line on top. min/max are printed as light
      // dashed lines for whiskers.
      // Source view: cm_dialysis_rent_box_q (or _ppsf_box_q for gov-PSF):
      //   period_end, n_leases, rent_min, rent_lower_quartile,
      //   rent_median, rent_upper_quartile, rent_max
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            // Floating bar: [lower_quartile, upper_quartile] → the box body
            { type: 'bar',  label: 'IQR (25th-75th %)',
              data: rows.map(r => [r.rent_lower_quartile ?? r.lower_quartile,
                                    r.rent_upper_quartile ?? r.upper_quartile]),
              backgroundColor: palette[3], borderRadius: 1,
              borderWidth: 0, order: 2 },
            { type: 'line', label: 'Median',
              data: rows.map(r => r.rent_median ?? r.median),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0, pointRadius: 0, borderWidth: 2.5, order: 0 },
            { type: 'line', label: 'Min',
              data: rows.map(r => r.rent_min ?? r.min),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0, pointRadius: 0, borderWidth: 1,
              borderDash: [4, 4], order: 1 },
            { type: 'line', label: 'Max',
              data: rows.map(r => r.rent_max ?? r.max),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0, pointRadius: 0, borderWidth: 1,
              borderDash: [4, 4], order: 1 },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_CURRENCY }),
      };
    }

    case 'cost_of_capital': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: '10Y Treasury',         data: rows.map(r => r.treasury_10y_yield),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Avg Cap Rate (TTM)',   data: rows.map(r => r.avg_cap_rate),
              borderColor: palette[3], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: '10+ Year Cap',         data: rows.map(r => r.cap_10plus_year),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Low Loan Constant',    data: rows.map(r => r.low_loan_constant),
              borderColor: palette[4], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1, borderDash: [3, 3] },
            { label: 'High Loan Constant',   data: rows.map(r => r.high_loan_constant),
              borderColor: palette[4], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1, borderDash: [3, 3] },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_1DP }),
      };
    }

    case 'cash_leveraged_returns': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Cash Return Index',
              data: rows.map(r => r.cash_return),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Leveraged Return (mid)',
              data: rows.map(r => r.leveraged_return_mid),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_1DP }),
      };
    }

    case 'buyer_class_pct_by_year': {
      const yearLabels = rows.map(r => String(r.year));
      const opts = commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_0DP });
      opts.scales.x.stacked = true;
      opts.scales.y.stacked = true;
      opts.scales.y.max = 1.0;
      return {
        type: 'bar',
        data: {
          labels: yearLabels,
          datasets: [
            { label: 'Private',       data: rows.map(r => r.private_pct),
              backgroundColor: palette[0], stack: 'pool' },
            { label: 'Public REITs',  data: rows.map(r => r.reit_pct),
              backgroundColor: palette[2], stack: 'pool' },
            { label: 'Cross-Border',  data: rows.map(r => r.cross_border_pct),
              backgroundColor: palette[1], stack: 'pool' },
            { label: 'Institutional', data: rows.map(r => r.institutional_pct),
              backgroundColor: palette[3], stack: 'pool' },
          ],
        },
        options: opts,
      };
    }

    // ────────────────────────────────────────────────────────────────────
    // Inventory analysis charts (deliverable p.30-31)
    // ────────────────────────────────────────────────────────────────────

    case 'available_market_size_combo': {
      // p.30 top: count bars (Total + Core 10+) on left axis, avg cap line
      // (Total + Core 10+) on right axis. Two cohorts. Cap-rate axis pinned
      // to 5-10% so the data variation is visible (auto-scaling was producing
      // a 0-8% range with the data squashed against the top edge).
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            // order=2 pushes bars behind the cap-rate lines. User
            // feedback (2026-05-07): "appears to have the line data
            // hidden behind the bar graph data".
            { type: 'bar',  label: 'Total Market — # Available',
              data: rows.map(r => r.count_total),
              backgroundColor: palette[3], borderRadius: 2,
              yAxisID: 'y', order: 2 },
            { type: 'bar',  label: '10+ Year Term — # Available',
              data: rows.map(r => r.count_core_10plus),
              backgroundColor: palette[1], borderRadius: 2,
              yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Total Market — Avg Asking Cap',
              data: rows.map(r => r.avg_cap_total),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
            { type: 'line', label: '10+ Year Term — Avg Asking Cap',
              data: rows.map(r => r.avg_cap_core_10plus),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
          ],
        },
        options: comboOpts({
          yLeftFormat:  AXIS_FORMAT_INTEGER,
          yRightFormat: AXIS_FORMAT_PERCENT_2DP,
          // Tighter than CAP_RATE_RANGE so the cap line shows movement.
          // Asking caps land 5.5-8% — the BID_ASK range fits.
          yRightRange:  CAP_RATE_BID_ASK_RANGE,
        }),
      };
    }

    case 'asking_cap_quartiles_active': {
      // p.31 top: 4-line — upper/lower quartile for both Total and Core 10+
      // Color scheme per user feedback (2026-05-07):
      //   "darker blues are the lower quartiles and lighter blues are the
      //    upper quartiles but we also need to signify the core vs total
      //    market with a color similarity"
      // Implementation:
      //   - All 4 lines are blue-family (palette-independent literal hex
      //     so it survives palette overrides on the brand-tokens table).
      //   - Light blue = upper quartile, dark blue = lower quartile.
      //   - Total Market = solid; 10+ Year Term (core) = dashed (same hue
      //     so eye groups them as "the same market subset, different cut").
      const COLOR_LIGHT_BLUE = '#9DC3E6';  // upper quartile
      const COLOR_DARK_BLUE  = '#1F4E79';  // lower quartile
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Total Market — Upper Quartile',
              data: rows.map(r => r.upper_q_total),
              borderColor: COLOR_LIGHT_BLUE, backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Total Market — Lower Quartile',
              data: rows.map(r => r.lower_q_total),
              borderColor: COLOR_DARK_BLUE,  backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: '10+ Year Term — Upper Quartile',
              data: rows.map(r => r.upper_q_core),
              borderColor: COLOR_LIGHT_BLUE, backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2,
              borderDash: [5, 4] },
            { label: '10+ Year Term — Lower Quartile',
              data: rows.map(r => r.lower_q_core),
              borderColor: COLOR_DARK_BLUE,  backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2,
              borderDash: [5, 4] },
          ],
        },
        // 5-8% range — quartile data lives 5.3-7.7%; tighter axis shows movement
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP, yAxisRange: CAP_RATE_TIGHT_RANGE }),
      };
    }

    case 'dom_price_change_active': {
      // p.31 bottom: DOM bars (Total + Core 10+) + price-change-frequency
      // lines (Total + Core 10+). Two y-axes (DOM days vs %).
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar',  label: 'Total Market — DOM',
              data: rows.map(r => r.avg_dom_total),
              backgroundColor: palette[3], borderRadius: 2, yAxisID: 'y' },
            { type: 'bar',  label: '10+ Year Term — DOM',
              data: rows.map(r => r.avg_dom_core),
              backgroundColor: palette[1], borderRadius: 2, yAxisID: 'y' },
            { type: 'line', label: 'Total Market — Price-Change %',
              data: rows.map(r => r.pct_price_change_total),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5, yAxisID: 'y1' },
            { type: 'line', label: '10+ Year Term — Price-Change %',
              data: rows.map(r => r.pct_price_change_core),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5, yAxisID: 'y1' },
          ],
        },
        options: comboOpts({
          yLeftFormat:  AXIS_FORMAT_INTEGER,
          yRightFormat: AXIS_FORMAT_PERCENT_0DP,
        }),
      };
    }

    case 'volume_cap_quartile_combo': {
      // Front-cover combo: TTM volume area + cap rate line + quartile band.
      // Synthetic chart that the API composes from volume_ttm_by_quarter
      // + cap_rate_ttm_by_quarter + cap_rate_top_bottom_quartile.
      // User feedback (2026-05-07): "the line charts displayed behind and
      // hidden by the area chart for volume". Fix: order=2 on the volume
      // area pushes it BEHIND the cap-rate lines (Chart.js draws lower
      // `order` LATER, on top).
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'line', label: 'TTM Volume',
              data: rows.map(r => r.volume_dollars),
              borderColor: palette[0], backgroundColor: palette[3],
              fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Avg Cap Rate (TTM)',
              data: rows.map(r => r.cap_rate),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
            { type: 'line', label: 'Upper Quartile Cap',
              data: rows.map(r => r.upper_quartile),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1.5,
              borderDash: [3, 3], yAxisID: 'y1', order: 0 },
            { type: 'line', label: 'Lower Quartile Cap',
              data: rows.map(r => r.lower_quartile),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1.5,
              borderDash: [3, 3], yAxisID: 'y1', order: 0 },
          ],
        },
        options: comboOpts({
          yLeftFormat:  AXIS_FORMAT_CURRENCY_COMPACT,
          yRightFormat: AXIS_FORMAT_PERCENT_2DP,
          yRightRange:  { min: 0.05, max: 0.09 },  // 5-9% — quartile band fits
        }),
      };
    }

    default:
      return null;
  }
}

// ============================================================================
// QuickChart POST helper
// ============================================================================

async function renderToPng(config, { width, height } = {}) {
  if (!config) throw new Error('renderToPng: config required');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);

  try {
    const r = await fetch(QUICKCHART_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        // Pin Chart.js v4 — required for `ticks.format` Intl.NumberFormat
        // support. v3 (the default on free tier) doesn't render currency /
        // percent / compact-notation tick labels via the format option,
        // and QuickChart's JSON parser doesn't evaluate JS callback strings.
        version: '4',
        width:  width  || RENDER_DEFAULT_WIDTH,
        height: height || RENDER_DEFAULT_HEIGHT,
        format: 'png',
        backgroundColor: '#FFFFFF',
        chart: config,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      throw new Error(`QuickChart ${r.status}: ${detail.slice(0, 200)}`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return buf;
  } finally {
    clearTimeout(t);
  }
}

// ============================================================================
// Public API: render every renderable chart to PNG, in parallel
// ============================================================================

/**
 * Render the chart set to PNG buffers. Returns an array of
 * { chart_template_id, name, png } objects, skipping any that fail to render.
 * Promise.all parallelizes; the QuickChart public service handles 30+
 * concurrent requests reliably.
 */
export async function renderChartsToImages({ charts, brand }) {
  const tasks = (charts || []).map(async (chart) => {
    const config = buildChartConfig(chart, brand);
    if (!config) return null;
    try {
      const png = await renderToPng(config);
      return {
        chart_template_id: chart.chart_template_id,
        name: chart.name,
        png,
      };
    } catch (e) {
      console.warn(
        `[cm-chart-image-renderer] ${chart.chart_template_id} failed: ${e?.message || e}`
      );
      return null;
    }
  });
  const results = await Promise.all(tasks);
  return results.filter(Boolean);
}

// Legacy named export kept for any caller referencing the old flag — always
// returns true now since chart rendering is unconditional in the export path.
export const NATIVE_CHARTS_FEATURE_FLAG = true;
export const QUICKCHART_URL_FOR_DEBUG = QUICKCHART_URL;
