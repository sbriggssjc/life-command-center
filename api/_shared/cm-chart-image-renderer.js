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

// Recent-window crop. User wants charts back to ~2001. Original Round 1
// bumped to 100/288/24, Round D4 to 104/312/26 after extending dialysis
// master_m to 2001-01-01.
//
// IMPORTANT (2026-05-22): QuickChart's public free tier rejects chart
// configs with >250 data points (returns HTTP 400 with an error PNG).
// Empirically tested: N=250 OK, N=252 fails. Post-D4 master_m had 303
// monthly rows, which silently broke every master_m-mapped chart in the
// dialysis export — Avg_Deal, Bid_Ask, Cap_Quartile, Cap_Avg, DOM_Ask,
// NM_vs_Market, Sentiment, Txn_Count, Volume_TTM, YOY_Change,
// Vol_Cap_Combo all came back missing. User reported it as a "mass
// chart-missing regression."
//
// Fix: cap the monthly window at 240 (= 20 years from 2026 → 2006).
// Combined with the renderer's `cropForRender()` downsample safety net
// (below), charts always stay under QuickChart's hard limit.
//
// Going further back than 20 years would need either a self-hosted
// QuickChart instance (CM_QUICKCHART_URL env var) or downsampling to a
// 2-month cadence.
const RECENT_QUARTERS_DEFAULT = 104;  // ~26 years quarterly — under 250 limit
const RECENT_MONTHS_DEFAULT   = 240;  // 20 years monthly  — under 250 limit
const RECENT_YEARS_DEFAULT    = 26;   // 26 calendar years (annual templates)

// Hard ceiling that the renderer enforces regardless of crop. QuickChart
// free tier rejects payloads with N > 250 data points per dataset.
const QUICKCHART_MAX_POINTS = 240;

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

// Round 1 — PDF-matched chart-specific colors. The brand palette covers
// blue-family series, but several PDF charts use accent colors that don't
// fit there: purple/sage/teal for cap-rate cohorts (dialysis p.22), sage
// green + light purple for sentiment bars (p.35), gray for "Outside Firm"
// (gov p.13). Hard-coded here so they survive brand-token overrides.
const PDF_COLORS = {
  // Cap_by_Term cohort lines (dialysis p.22)
  cap_long_term:    '#7E6BAD', // purple — 12+ Year (longest term)
  cap_mid_long:     '#4CB582', // sage green — 8-12 Year (or 6-10)
  cap_mid:          '#62B5E5', // sky blue — 6-8 Year (or <5)
  cap_short:        '#003DA5', // dark navy — ≤5 Year (or outside firm)
  cap_outside_firm: '#6A748C', // gray — Outside Firm (gov p.13)

  // Sentiment bar colors (p.35)
  sentiment_bar_all:   '#A6D9C9', // sage green — all-deals price change
  sentiment_bar_long:  '#C8B6E2', // light purple — long-term price change

  // Annotation styling
  annotation_navy_bg:  '#003DA5',
  annotation_sky_bg:   '#62B5E5',
  annotation_text:     '#FFFFFF',
};

// Helper to build min/max/last-value annotation labels for time-series
// charts. Picks 3 anchor data points and emits chartjs-plugin-annotation
// label entries pointing at them. Format helpers per chart's units.
//
//   rows:    array of chart rows with `period_end` (or `year`)
//   getter:  fn(row) → numeric value (or null)
//   labelFn: fn(value) → display string (e.g. percent / currency / int)
//   xKey:    'period_end' (default) or 'year'
//
// Returns an `annotation.annotations` object plug-and-play for
// `options.plugins.annotation = { annotations: ... }`.
function buildAnnotations(rows, getter, labelFn, xKey = 'period_end') {
  if (!Array.isArray(rows) || rows.length === 0) return {};
  const points = rows
    .map((r, i) => ({ i, x: r[xKey] || r.period_end || r.year, y: getter(r) }))
    .filter(p => p.y != null && Number.isFinite(Number(p.y)));
  if (points.length < 3) return {};

  // Find indices for: max, min, last
  let maxP = points[0], minP = points[0];
  for (const p of points) {
    if (Number(p.y) > Number(maxP.y)) maxP = p;
    if (Number(p.y) < Number(minP.y)) minP = p;
  }
  const lastP = points[points.length - 1];

  const labelStyle = (bgColor) => ({
    backgroundColor: bgColor,
    color: PDF_COLORS.annotation_text,
    font: { size: 10, family: 'Calibri', weight: 'bold' },
    padding: { top: 2, bottom: 2, left: 5, right: 5 },
    borderRadius: 3,
    z: 100,  // above everything
  });

  // Convert period_end (date) to a label like "Q4 '25" matching periodEndLabel
  const xToLabel = (x) => {
    if (!x) return null;
    const dt = new Date(x);
    if (Number.isNaN(dt.getTime())) return String(x);
    const q = Math.floor(dt.getUTCMonth() / 3) + 1;
    return `Q${q} '${String(dt.getUTCFullYear()).slice(2)}`;
  };

  const out = {};
  // Last data point — primary callout (navy)
  out.lastVal = {
    type: 'label',
    xValue: xToLabel(lastP.x),
    yValue: Number(lastP.y),
    content: labelFn(Number(lastP.y)),
    yAdjust: -16,
    ...labelStyle(PDF_COLORS.annotation_navy_bg),
  };
  // Max — sky blue callout
  if (maxP.i !== lastP.i) {
    out.maxVal = {
      type: 'label',
      xValue: xToLabel(maxP.x),
      yValue: Number(maxP.y),
      content: labelFn(Number(maxP.y)),
      yAdjust: -16,
      ...labelStyle(PDF_COLORS.annotation_sky_bg),
    };
  }
  // Min — sky blue callout
  if (minP.i !== lastP.i && minP.i !== maxP.i) {
    out.minVal = {
      type: 'label',
      xValue: xToLabel(minP.x),
      yValue: Number(minP.y),
      content: labelFn(Number(minP.y)),
      yAdjust: 16,
      ...labelStyle(PDF_COLORS.annotation_sky_bg),
    };
  }
  return out;
}

// Format helpers for annotation labels.
const fmtPct1 = (v) => (v * 100).toFixed(1) + '%';
const fmtPct2 = (v) => (v * 100).toFixed(2) + '%';
const fmtCurrencyM = (v) => '$' + (v / 1_000_000).toFixed(1) + 'M';
const fmtCurrencyB = (v) => '$' + (v / 1_000_000_000).toFixed(2) + 'B';
const fmtInteger = (v) => Math.round(v).toString();
const fmtIndex = (v) => Number(v).toFixed(1);

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

// Defense-in-depth against QuickChart's 250-point limit. After the
// recent-window crop, if the chart still has more rows than QuickChart
// will accept, downsample by taking every Nth row. This preserves the
// time range (just at coarser cadence) instead of clipping the older
// end of the series.
//
// Example: 303 monthly rows → step = ceil(303/240) = 2 → keep every 2nd
// row → 152 rows surviving. The chart still spans 2001 → 2026 but with
// ~2-month resolution instead of monthly. Better than failing entirely.
function cropForRender(rows) {
  if (!Array.isArray(rows) || rows.length <= QUICKCHART_MAX_POINTS) return rows;
  const step = Math.ceil(rows.length / QUICKCHART_MAX_POINTS);
  const out = [];
  for (let i = 0; i < rows.length; i += step) out.push(rows[i]);
  // Always keep the very last row so the chart's right edge matches the
  // actual data endpoint regardless of step alignment.
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
  return out;
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

// % of Ask Price axis range. PDF dialysis p.33 + gov p.20 both pin
// 84%–96% on the right axis. Switched to that exact range so our chart
// matches the master deliverable visually (bars on left = DOM days,
// line on right = % of Ask).
const PCT_OF_ASK_RANGE = { min: 0.84, max: 0.96 };

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
  // recentRows = clip to recent window; cropForRender = downsample if
  // we still exceed QuickChart's 250-point hard limit. Belt + suspenders.
  const rows = cropForRender(recentRows(chart.rows, windowSize));
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

    case 'available_by_tenant_count_donut':
    case 'available_by_tenant_volume_donut': {
      // Round 4b — PDF dialysis p.32. Single-period donut, 4 segments
      // (DaVita / FMC / US Renal / Other). For doughnut charts the row
      // shape is single-period: each row is one tenant segment.
      // Use the un-cropped chart.rows here — recentRows truncates to a
      // time window which would drop everything for a non-time-series
      // chart.
      const tenantRows = chart.rows || [];
      const isVolume = chart.chart_template_id === 'available_by_tenant_volume_donut';
      const valueKey = isVolume ? 'volume_available' : 'count_active';
      // PDF p.32 colors: dark navy / sky / sage / muted gray for "Other"
      const segmentColors = [
        PDF_COLORS.cap_short,     // dark navy — DaVita
        PDF_COLORS.cap_mid,       // sky — FMC
        PDF_COLORS.cap_mid_long,  // sage — US Renal
        PDF_COLORS.cap_outside_firm, // muted gray — Other
      ];
      return {
        type: 'doughnut',
        data: {
          labels: tenantRows.map(r => r.tenant || 'Unknown'),
          datasets: [{
            label: isVolume ? 'Volume Available' : 'Count Available',
            data: tenantRows.map(r => Number(r[valueKey]) || 0),
            backgroundColor: tenantRows.map((_, i) => segmentColors[i] || segmentColors[3]),
            borderColor: '#FFFFFF',
            borderWidth: 2,
          }],
        },
        options: {
          plugins: {
            legend: {
              position: 'right',
              labels: { font: { size: 12 } },
            },
            title: {
              display: true,
              text: isVolume ? 'Volume Available by Tenant' : 'Count Available by Tenant',
              font: { size: 14, weight: 'bold' },
              color: PDF_COLORS.cap_short,
            },
          },
          cutout: '55%',  // donut hole
        },
      };
    }

    case 'available_by_term_summary': {
      // Round 4c — PDF dialysis p.30 bottom. 4 grouped sky-blue bars
      // (Avg Price, left axis $0–$8M) + 4 dot/line series (Avg Cap,
      // Upper Quartile, Lower Quartile, Median) on right axis (3.5%–8%).
      //
      // X-axis is categorical (term buckets), not time-series. Use the
      // un-cropped chart.rows directly — recentRows truncation would
      // drop categories for non-time-series charts.
      const termRows = chart.rows || [];
      const termLabels = termRows.map(r => r.term_bucket || '?');
      const dotPointRadius = 6;
      const dotPointStyle = 'rectRot'; // diamond marker, similar to PDF
      return {
        type: 'bar',
        data: {
          labels: termLabels,
          datasets: [
            { type: 'bar', label: 'Avg Price (left axis)',
              data: termRows.map(r => r.avg_price),
              backgroundColor: PDF_COLORS.cap_mid, // sky
              borderColor: PDF_COLORS.cap_mid,
              borderRadius: 1,
              barPercentage: 0.6, categoryPercentage: 0.85,
              yAxisID: 'y', order: 5 },
            { type: 'scatter', label: 'Avg Cap',
              data: termRows.map((r, i) => ({ x: i, y: r.avg_cap })),
              backgroundColor: PDF_COLORS.cap_short, // navy
              borderColor: PDF_COLORS.cap_short,
              pointRadius: dotPointRadius, pointStyle: dotPointStyle,
              showLine: false, yAxisID: 'y1', order: 1 },
            { type: 'scatter', label: 'Upper Quartile',
              data: termRows.map((r, i) => ({ x: i, y: r.upper_quartile_cap })),
              backgroundColor: PDF_COLORS.cap_long_term, // purple
              borderColor: PDF_COLORS.cap_long_term,
              pointRadius: dotPointRadius, pointStyle: dotPointStyle,
              showLine: false, yAxisID: 'y1', order: 2 },
            { type: 'scatter', label: 'Lower Quartile',
              data: termRows.map((r, i) => ({ x: i, y: r.lower_quartile_cap })),
              backgroundColor: PDF_COLORS.cap_outside_firm, // gray
              borderColor: PDF_COLORS.cap_outside_firm,
              pointRadius: dotPointRadius, pointStyle: dotPointStyle,
              showLine: false, yAxisID: 'y1', order: 3 },
            { type: 'scatter', label: 'Median',
              data: termRows.map((r, i) => ({ x: i, y: r.median_cap })),
              backgroundColor: PDF_COLORS.cap_mid_long, // sage
              borderColor: PDF_COLORS.cap_mid_long,
              pointRadius: dotPointRadius, pointStyle: dotPointStyle,
              showLine: false, yAxisID: 'y1', order: 4 },
          ],
        },
        options: (() => {
          const opts = commonOpts({ yAxisFormat: AXIS_FORMAT_CURRENCY_COMPACT });
          opts.scales = opts.scales || {};
          opts.scales.x = { ...(opts.scales.x || {}), type: 'category' };
          opts.scales.y1 = {
            type: 'linear',
            position: 'right',
            min: 0.035, max: 0.08,  // 3.5%–8% per PDF
            grid: { drawOnChartArea: false },
            ticks: {
              callback: (v) => (v * 100).toFixed(1) + '%',
              font: { size: 11 },
            },
          };
          return opts;
        })(),
      };
    }

    case 'buyer_pool_monthly_count': {
      // Round 3c — PDF dialysis p.27. Stacked bar by buyer class, monthly.
      // Series colors per the PDF deck:
      //   • Private (Individual): dark navy #003DA5 (bottom of stack)
      //   • Institutional/Fund:   sky blue  #62B5E5 (middle)
      //   • REIT:                 sage      #4CB582 (top)
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Private',
              data: rows.map(r => r.private_count),
              backgroundColor: PDF_COLORS.cap_short, // navy
              stack: 'pool', borderRadius: 0, barPercentage: 1.0,
              categoryPercentage: 0.95 },
            { label: 'Institutional / Fund',
              data: rows.map(r => r.institutional_count),
              backgroundColor: PDF_COLORS.cap_mid, // sky
              stack: 'pool', borderRadius: 0, barPercentage: 1.0,
              categoryPercentage: 0.95 },
            { label: 'REIT',
              data: rows.map(r => r.reit_count),
              backgroundColor: PDF_COLORS.cap_mid_long, // sage
              stack: 'pool', borderRadius: 0, barPercentage: 1.0,
              categoryPercentage: 0.95 },
          ],
        },
        options: (() => {
          const opts = commonOpts({ yAxisFormat: AXIS_FORMAT_INTEGER });
          opts.scales = opts.scales || {};
          opts.scales.x = { ...(opts.scales.x || {}), stacked: true };
          opts.scales.y = { ...(opts.scales.y || {}), stacked: true };
          return opts;
        })(),
      };
    }

    case 'quarterly_volume_bars': {
      // Round 3b — PDF dialysis p.21 bottom (gov ~p.12). Per-quarter
      // transaction volume rendered as bars (NOT a TTM rolling line).
      // Sky-blue bars per the deck.
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Quarterly Volume',
            data: rows.map(r => r.quarterly_volume),
            backgroundColor: PDF_COLORS.cap_mid, // sky #62B5E5
            borderColor: PDF_COLORS.cap_mid,
            borderRadius: 1,
            barPercentage: 0.85,
            categoryPercentage: 0.9,
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
      const annotations = buildAnnotations(
        rows, r => r.avg_deal_size, fmtCurrencyM
      );
      const opts = commonOpts({ yAxisFormat: AXIS_FORMAT_CURRENCY_COMPACT });
      if (Object.keys(annotations).length) {
        opts.plugins.annotation = { annotations };
      }
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
        options: opts,
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
      // Round 3 — bucket realignment per dialysis PDF p.22.
      //
      // Two cohort schemes coexist:
      //   • Dialysis PDF (p.22):  12+ / 8-12 / 6-8 / ≤5
      //   • Gov PDF (p.13):       10+ / 6-10 / <5 / Outside Firm
      //
      // master_m exposes BOTH (Round 3 migration); we detect dialysis
      // cohorts by sniffing for cap_12plus on the row shape and pick
      // the matching dataset configuration.
      //
      // Colors per PDF (kept consistent across both schemes so the legend
      // reads the same chart family):
      //   • Long-term:  purple   #7E6BAD
      //   • Mid-long:   sage     #4CB582
      //   • Mid:        sky      #62B5E5
      //   • Short:      navy     #003DA5
      //   • Outside:    gray     #6A748C (gov only)
      const hasDialysisCohorts = rows.some(r =>
        r.cap_12plus != null || r.cap_8to12 != null ||
        r.cap_6to8 != null  || r.cap_5orless != null
      );
      const datasets = hasDialysisCohorts ? [
        { label: '12+ Year',     data: rows.map(r => r.cap_12plus),
          borderColor: PDF_COLORS.cap_long_term, backgroundColor: 'transparent',
          tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
        { label: '8-12 Year',    data: rows.map(r => r.cap_8to12),
          borderColor: PDF_COLORS.cap_mid_long, backgroundColor: 'transparent',
          tension: 0.3, pointRadius: 0, borderWidth: 2 },
        { label: '6-8 Year',     data: rows.map(r => r.cap_6to8),
          borderColor: PDF_COLORS.cap_mid, backgroundColor: 'transparent',
          tension: 0.3, pointRadius: 0, borderWidth: 2 },
        { label: '≤5 Year',      data: rows.map(r => r.cap_5orless),
          borderColor: PDF_COLORS.cap_short, backgroundColor: 'transparent',
          tension: 0.3, pointRadius: 0, borderWidth: 2 },
      ] : [
        { label: '10+ Year',       data: rows.map(r => r.cap_10plus),
          borderColor: PDF_COLORS.cap_long_term, backgroundColor: 'transparent',
          tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
        { label: '6-10 Year',      data: rows.map(r => r.cap_6to10),
          borderColor: PDF_COLORS.cap_mid_long, backgroundColor: 'transparent',
          tension: 0.3, pointRadius: 0, borderWidth: 2 },
        { label: '< 5 Year',       data: rows.map(r => r.cap_less5),
          borderColor: PDF_COLORS.cap_short, backgroundColor: 'transparent',
          tension: 0.3, pointRadius: 0, borderWidth: 2 },
        { label: 'Outside Firm',   data: rows.map(r => r.cap_outside_firm),
          borderColor: PDF_COLORS.cap_outside_firm, backgroundColor: 'transparent',
          tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [3, 3] },
      ];
      return {
        type: 'line',
        data: { labels, datasets },
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
        options: (() => {
          const o = comboOpts({
            yLeftFormat:  AXIS_FORMAT_INTEGER,
            yRightFormat: AXIS_FORMAT_PERCENT_1DP,
            // PCT_OF_ASK_RANGE pinned to 0.84-0.96 (matches dialysis
            // PDF p.33 + gov PDF p.20 right-axis labels).
            yRightRange:  PCT_OF_ASK_RANGE,
          });
          // Annotations: peak/trough/last on % of Ask line
          const ann = buildAnnotations(rows, r => r.pct_of_ask, fmtPct1);
          if (Object.keys(ann).length) o.plugins.annotation = { annotations: ann };
          return o;
        })(),
      };
    }

    case 'bid_ask_spread':
    case 'bid_ask_spread_monthly': {
      // Round 2a — match dialysis PDF p.34 + gov p.21 visual:
      //   • Each x-position has a vertical floating bar showing the
      //     bid-ask spread RANGE from achieved cap (= Last Ask − spread)
      //     up to Last Ask.
      //   • Sky blue dot at bar BOTTOM = Last Ask cap (= achieved cap)
      //     — wait, PDF shows Last Ask at BOTTOM and the spread is the
      //     bar above it. So bar = [last_ask, last_ask + spread]. The
      //     visual: thin bar with sky tint, with marker at bottom for
      //     Last Ask cap.
      //   • Single Y axis for cap rate (PDF range ~5.25%–8.00% dialysis,
      //     ~6.50%–10.00% gov).
      const hasLastAsk = rows.some(r => r.avg_last_ask_cap != null);
      if (hasLastAsk) {
        return {
          type: 'bar',
          data: {
            labels,
            datasets: [
              // Floating bar: spread range from Last Ask up by spread amount
              { type: 'bar', label: 'Bid-Ask Spread Range',
                data: rows.map(r => {
                  const last = r.avg_last_ask_cap;
                  const spread = r.avg_bid_ask_spread;
                  return (last != null && spread != null) ? [last, last + spread] : null;
                }),
                backgroundColor: 'rgba(224,232,244,0.6)',  // pale blue fill
                borderColor: palette[1],                    // sky border
                borderWidth: 1,
                borderSkipped: false,
                barPercentage: 0.5,
                categoryPercentage: 0.85,
                order: 2 },
              // Last Ask Cap dots at bar bottom
              { type: 'line', label: 'Last Ask Cap (TTM)',
                data: rows.map(r => r.avg_last_ask_cap),
                borderColor: 'transparent',
                backgroundColor: palette[1],
                pointRadius: 2.5,
                pointStyle: 'circle',
                showLine: false,
                order: 0 },
              // Bid-Ask spread (achieved cap) at bar top — derived
              { type: 'line', label: 'Bid-Ask Spread Top (Achieved Cap)',
                data: rows.map(r => {
                  const last = r.avg_last_ask_cap;
                  const spread = r.avg_bid_ask_spread;
                  return (last != null && spread != null) ? last + spread : null;
                }),
                borderColor: 'transparent',
                backgroundColor: palette[0],  // navy dot
                pointRadius: 2.5,
                pointStyle: 'circle',
                showLine: false,
                order: 0 },
            ],
          },
          options: commonOpts({
            yAxisFormat: AXIS_FORMAT_PERCENT_2DP,
            yAxisRange: CAP_RATE_BID_ASK_RANGE,
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
      // Round 1 — PDF p.35 styling:
      //   • Sage green bars: Price Change (TTM)
      //   • Light purple bars: 8+ Yr Price Change (TTM)
      //   • Dark navy line: Last Ask (TTM)
      //   • Sky blue line: 8+ Yr Last Ask (TTM)
      //   • Left axis 0%–70% (price change %, allows for the wide bar
      //     range — was 0%–30% which clipped >30% values)
      //   • Right axis 4.75%–7.25% (cap rate, tighter than BID_ASK
      //     range to match PDF visual emphasis on movement)
      const annotations = buildAnnotations(
        rows, r => r.last_ask_cap_all, fmtPct2
      );
      const opts = comboOpts({
        yLeftFormat:  AXIS_FORMAT_PERCENT_0DP,
        yLeftRange:   { min: 0, max: 0.70 },
        yRightFormat: AXIS_FORMAT_PERCENT_2DP,
        yRightRange:  { min: 0.0475, max: 0.0725 },
      });
      if (Object.keys(annotations).length) {
        opts.plugins.annotation = { annotations };
      }
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            // order=2 on bars pushes them behind the cap lines.
            { type: 'bar',  label: 'Price Change %',
              data: rows.map(r => r.pct_price_change_all),
              backgroundColor: PDF_COLORS.sentiment_bar_all, borderRadius: 1,
              yAxisID: 'y', order: 2 },
            { type: 'bar',  label: '8+ Yr Term Price Change %',
              data: rows.map(r => r.pct_price_change_long_term),
              backgroundColor: PDF_COLORS.sentiment_bar_long, borderRadius: 1,
              yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Last Asking Cap (all)',
              data: rows.map(r => r.last_ask_cap_all),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
            { type: 'line', label: 'Last Asking Cap (8+ yr)',
              data: rows.map(r => r.last_ask_cap_long_term),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2,
              yAxisID: 'y1', order: 0 },
          ],
        },
        options: opts,
      };
    }

    case 'valuation_index': {
      const annotations = buildAnnotations(
        rows, r => r.valuation_index, fmtIndex
      );
      const opts = commonOpts({ yAxisFormat: AXIS_FORMAT_INTEGER });
      if (Object.keys(annotations).length) {
        opts.plugins.annotation = { annotations };
      }
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
        options: opts,
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
      // Round 2a — match dialysis PDF p.23 + gov p.15 visual:
      //   • Sky blue line (lower): 10-Year Treasury yield
      //   • Dark navy line (upper): TTM Avg Cap Rate
      //   • Vertical floating gray range bars BETWEEN them: Low–High
      //     loan constant (mortgage constant) band, hashed border
      //   • Single Y-axis 0%–10%
      //
      // Was: 5 separate lines (treasury, avg cap, 10+ cap, low LC,
      // high LC). PDF only shows 2 lines + the band; "10+ Year Cap"
      // is dropped (the gov PDF p.15 keeps it as a third line, but
      // the dialysis PDF p.23 doesn't — go with 2-line for clarity).
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            // Mortgage constant range bar (low to high), order=2 (back)
            { type: 'bar', label: 'Mortgage Constant Band',
              data: rows.map(r => {
                const lo = r.low_loan_constant, hi = r.high_loan_constant;
                return (lo != null && hi != null) ? [lo, hi] : null;
              }),
              backgroundColor: 'rgba(106,116,140,0.12)',  // pale gray fill
              borderColor: '#6A748C',                      // gray border
              borderWidth: 1,
              borderSkipped: false,
              barPercentage: 0.4,
              categoryPercentage: 0.7,
              order: 2 },
            // 10Y Treasury (sky blue)
            { type: 'line', label: '10Y Treasury Yield',
              data: rows.map(r => r.treasury_10y_yield),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              order: 1 },
            // Avg Cap Rate (TTM) (dark navy, primary)
            { type: 'line', label: 'Avg Cap Rate (TTM)',
              data: rows.map(r => r.avg_cap_rate),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              order: 0 },
          ],
        },
        options: commonOpts({
          yAxisFormat: AXIS_FORMAT_PERCENT_1DP,
          yAxisRange: { min: 0, max: 0.10 },
        }),
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
      // User feedback (2026-05-07): "The Price Change % is the same color
      // too so its hard to tell a difference." Use Active_Cap_Quart-style
      // solid/dashed split so the eye groups Total vs Core 10+ by hue
      // similarity but distinguishes them by line style.
      const COLOR_DARK_BLUE_DPC  = '#1F4E79';
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar',  label: 'Total Market — DOM',
              data: rows.map(r => r.avg_dom_total),
              backgroundColor: palette[3], borderRadius: 2,
              yAxisID: 'y', order: 2 },
            { type: 'bar',  label: '10+ Year Term — DOM',
              data: rows.map(r => r.avg_dom_core),
              backgroundColor: palette[1], borderRadius: 2,
              yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Total Market — Price-Change %',
              data: rows.map(r => r.pct_price_change_total),
              borderColor: COLOR_DARK_BLUE_DPC, backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
            { type: 'line', label: '10+ Year Term — Price-Change %',
              data: rows.map(r => r.pct_price_change_core),
              borderColor: COLOR_DARK_BLUE_DPC, backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2,
              borderDash: [5, 4], yAxisID: 'y1', order: 0 },
          ],
        },
        options: comboOpts({
          yLeftFormat:  AXIS_FORMAT_INTEGER,
          yRightFormat: AXIS_FORMAT_PERCENT_0DP,
        }),
      };
    }

    case 'volume_cap_quartile_combo': {
      // Round 2a — match dialysis PDF p.19 + gov p.11 visual:
      //   • Light blue shaded area (back) = TTM volume on left axis
      //   • Vertical floating bars = cap-rate range upper-to-lower quartile
      //     on right axis (was 2 dashed lines)
      //   • Dots on top of bars = TTM avg cap rate (was a line)
      //
      // Floating bars use Chart.js v4 `[lower, upper]` data point shape.
      // Dots are a line dataset with showLine:false so Chart.js renders
      // only the markers.
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            // Volume area (background, lowest z-order)
            { type: 'line', label: 'TTM Volume',
              data: rows.map(r => r.volume_dollars),
              borderColor: palette[0], backgroundColor: palette[3],
              fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y', order: 3 },
            // Cap-rate range bars (upper-to-lower quartile per period)
            { type: 'bar', label: 'Cap Rate Range (Q1–Q3)',
              data: rows.map(r => {
                const lo = r.lower_quartile, hi = r.upper_quartile;
                return (lo != null && hi != null) ? [lo, hi] : null;
              }),
              backgroundColor: 'rgba(98,181,229,0.25)',  // pale sky fill
              borderColor: palette[1],                    // sky border
              borderWidth: 1,
              borderSkipped: false,
              barPercentage: 0.6,
              categoryPercentage: 0.8,
              yAxisID: 'y1', order: 1 },
            // Avg cap rate dots (foreground, highest z-order)
            { type: 'line', label: 'Avg Cap Rate (TTM)',
              data: rows.map(r => r.cap_rate),
              borderColor: 'transparent',
              backgroundColor: palette[0],
              pointRadius: 3,
              pointStyle: 'circle',
              showLine: false,
              yAxisID: 'y1', order: 0 },
          ],
        },
        options: (() => {
          const o = comboOpts({
            yLeftFormat:  AXIS_FORMAT_CURRENCY_COMPACT,
            yRightFormat: AXIS_FORMAT_PERCENT_2DP,
            yRightRange:  { min: 0.055, max: 0.085 },  // tighter to fit quartile band cleanly
          });
          // Annotations on Avg Cap Rate (the primary line — peak/trough/last)
          const ann = buildAnnotations(rows, r => r.cap_rate, fmtPct2);
          if (Object.keys(ann).length) o.plugins.annotation = { annotations: ann };
          return o;
        })(),
      };
    }

    // ──────────────────────────────────────────────────────────────────
    // Round GD2 (2026-05-22): chart configs for the gov-only templates
    // that previously rendered as "no chart" because no case matched
    // their chart_template_id. User listed 13 such tabs in the
    // 2026-05-07 gov export feedback. Each config is intentionally
    // simple — line for time-series, horizontal bar for rankings —
    // to get charts on the page; style-match-master-Excel work iterates
    // separately.
    // ──────────────────────────────────────────────────────────────────

    case 'cap_rate_by_credit': {
      // 3-line: federal / state / municipal cap rates over time.
      // Source view: cm_gov_cap_by_credit_q OR master_m (if mapper kicks).
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Federal',   data: rows.map(r => r.federal_cap),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'State',     data: rows.map(r => r.state_cap),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: 'Municipal', data: rows.map(r => r.municipal_cap),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP, yAxisRange: CAP_RATE_TIGHT_RANGE }),
      };
    }

    case 'cpi_vs_renewal_cagr': {
      // 2-line: CPI YoY change vs GSA renewal CAGR
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'CPI YoY Change', data: rows.map(r => r.cpi_change),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: 'GSA Renewal CAGR', data: rows.map(r => r.gsa_renewal_cagr),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_1DP }),
      };
    }

    case 'fed_funds_vs_treasury': {
      // 3-line: Fed Funds vs 10Y Treasury vs 30Y Mortgage
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Fed Funds Rate', data: rows.map(r => r.fed_funds_rate),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: '10Y Treasury',   data: rows.map(r => r.treasury_10y_yield),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: '30Y Mortgage',   data: rows.map(r => r.mortgage_30y_rate),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2, borderDash: [4, 4] },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_1DP }),
      };
    }

    case 'lease_renewal_rate': {
      // Bar chart: renewed / superseding-succeeding / expired / terminated
      // counts by quarter.
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Renewed',           data: rows.map(r => r.renewed_leases),
              backgroundColor: palette[0], borderRadius: 1 },
            { label: 'Succeed/Supersede', data: rows.map(r => r.succeeding_superseding_leases),
              backgroundColor: palette[1], borderRadius: 1 },
            { label: 'Expired',           data: rows.map(r => r.expired_leases),
              backgroundColor: palette[3], borderRadius: 1 },
            { label: 'Terminated',        data: rows.map(r => r.terminated_leases),
              backgroundColor: palette[4], borderRadius: 1 },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_INTEGER }),
      };
    }

    case 'lease_termination_rate': {
      // Termination rate as % of active leases (TTM)
      const series = rows.map(r => {
        const total = Number(r.total_leases_active) || 0;
        const term  = Number(r.terminated_ttm) || 0;
        return total > 0 ? term / total : null;
      });
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Termination Rate (TTM)',
            data: series,
            borderColor: palette[0], backgroundColor: palette[3],
            fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2.5,
          }],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_1DP }),
      };
    }

    case 'lease_structures': {
      // Horizontal bar: pct_of_total by term_bucket.
      // User feedback (2026-05-07): "the term buckets should be displayed
      // like 10, 5 (which would indicate an initial term of 10 years with
      // the first 5 years firm)" — that formatting is owned by the view
      // (term_bucket label). For now render whatever label the view ships.
      return {
        type: 'bar',
        data: {
          labels: rows.map(r => r.term_bucket),
          datasets: [{
            label: '% of Total',
            data: rows.map(r => r.pct_of_total),
            backgroundColor: palette[0], borderRadius: 2,
          }],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_0DP, xMaxTicks: 12, legendPosition: 'top' }),
      };
    }

    case 'leased_inventory_by_state': {
      // Round 4d (deferred — see docs/cm-pdf-vs-export-chart-deltas.md item #22):
      //
      // The PDF (gov p.26) ships this as a US choropleth — states colored
      // by lease count. QuickChart's hosted service does NOT bundle the
      // chartjs-chart-geo plugin, so `type: 'choropleth'` returns a 400.
      // We ship the horizontal-bar fallback below; when CM_QUICKCHART_URL
      // points at a self-hosted instance with chartjs-chart-geo installed,
      // a future PR can swap this to:
      //
      //   if (process.env.CM_CHOROPLETH_ENABLED === 'true') {
      //     return { type: 'choropleth', data: { ... outline: '$states' ... } };
      //   }
      //
      // Top 15 states by lease_count
      const top = (rows || []).slice(0, 15);
      return {
        type: 'bar',
        data: {
          labels: top.map(r => r.state),
          datasets: [{
            label: 'Lease Count',
            data: top.map(r => r.lease_count),
            backgroundColor: palette[0], borderRadius: 2,
          }],
        },
        options: { ...commonOpts({ yAxisFormat: AXIS_FORMAT_INTEGER, xMaxTicks: 16 }),
                   indexAxis: 'y' },
      };
    }

    case 'net_lease_spread': {
      // 3 spread lines: market / NM / non-NM (vs 10Y Treasury)
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Market Spread (Cap - 10Y)', data: rows.map(r => r.market_spread),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'NM Spread',                  data: rows.map(r => r.nm_spread),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2, borderDash: [4, 4] },
            { label: 'Non-NM Spread',              data: rows.map(r => r.non_nm_spread),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP }),
      };
    }

    case 'renewal_rent_growth': {
      // Avg renewal rent PSF + upper/lower quartile band over time
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Avg Renewal Rent PSF',  data: rows.map(r => r.avg_renewal_rent_psf),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'TTM Avg',               data: rows.map(r => r.ttm_avg_renewal_rent_psf),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: 'Upper Quartile',        data: rows.map(r => r.upper_quartile_rpsf),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1, borderDash: [3, 3] },
            { label: 'Lower Quartile',        data: rows.map(r => r.lower_quartile_rpsf),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1, borderDash: [3, 3] },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_CURRENCY }),
      };
    }

    case 'rent_by_year_built': {
      // Bar: median rent PSF by build-year decade with whisker dashes
      return {
        type: 'bar',
        data: {
          labels: rows.map(r => String(r.year)),
          datasets: [
            { type: 'bar',  label: 'Median Rent PSF',
              data: rows.map(r => r.median_rpsf),
              backgroundColor: palette[0], borderRadius: 2, order: 2 },
            { type: 'line', label: 'Upper Quartile',
              data: rows.map(r => r.upper_quartile_rpsf),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0, pointRadius: 0, borderWidth: 1,
              borderDash: [4, 4], order: 0 },
            { type: 'line', label: 'Lower Quartile',
              data: rows.map(r => r.lower_quartile_rpsf),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0, pointRadius: 0, borderWidth: 1,
              borderDash: [4, 4], order: 0 },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_CURRENCY }),
      };
    }

    case 'rent_heat_map': {
      // Round 4d (deferred — see docs/cm-pdf-vs-export-chart-deltas.md item #22):
      // PDF (gov p.33) ships as a US choropleth color-graded by avg rent PSF.
      // Choropleth requires chartjs-chart-geo plugin not bundled in QuickChart
      // hosted; when self-hosted instance comes online, swap to choropleth via
      // CM_CHOROPLETH_ENABLED feature flag.
      //
      // Top 15 states by avg rent PSF (horizontal bar; labels=state)
      const top = (rows || [])
        .filter(r => r.avg_rpsf != null)
        .sort((a, b) => Number(b.avg_rpsf) - Number(a.avg_rpsf))
        .slice(0, 15);
      return {
        type: 'bar',
        data: {
          labels: top.map(r => r.state),
          datasets: [{
            label: 'Avg Rent PSF',
            data: top.map(r => r.avg_rpsf),
            backgroundColor: palette[0], borderRadius: 2,
          }],
        },
        options: { ...commonOpts({ yAxisFormat: AXIS_FORMAT_CURRENCY, xMaxTicks: 16 }),
                   indexAxis: 'y' },
      };
    }

    case 'sources_of_capital': {
      // Round 4d (deferred — see docs/cm-pdf-vs-export-chart-deltas.md item #22):
      // PDF (gov p.19) ships as a US bubble map (states colored by dollar
      // volume + circles overlaid on top states with $X.XB labels). Bubble
      // map = scatter geo overlay, also requires chartjs-chart-geo plugin.
      // Bar fallback below; choropleth swap behind CM_CHOROPLETH_ENABLED flag.
      //
      // Top 15 buyer states by 15y volume
      const top = (rows || []).slice(0, 15);
      return {
        type: 'bar',
        data: {
          labels: top.map(r => r.buyer_state || 'Unknown'),
          datasets: [{
            label: 'Volume (15y)',
            data: top.map(r => r.total_volume_15y),
            backgroundColor: palette[0], borderRadius: 2,
          }],
        },
        options: { ...commonOpts({ yAxisFormat: AXIS_FORMAT_CURRENCY_COMPACT, xMaxTicks: 16 }),
                   indexAxis: 'y' },
      };
    }

    case 'case_for_renewal': {
      // Bar: commencement_count by year + line: avg_rent_per_sf
      return {
        type: 'bar',
        data: {
          labels: rows.map(r => String(r.year)),
          datasets: [
            { type: 'bar',  label: 'New Lease Commencements',
              data: rows.map(r => r.commencement_count),
              backgroundColor: palette[3], borderRadius: 2,
              yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Avg Rent PSF',
              data: rows.map(r => r.avg_rent_per_sf),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
          ],
        },
        options: comboOpts({
          yLeftFormat:  AXIS_FORMAT_INTEGER,
          yRightFormat: AXIS_FORMAT_CURRENCY,
        }),
      };
    }

    // ──────────────────────────────────────────────────────────────────
    // Round 2b — Pace of Cap Rate Expansion (dialysis PDF p.24, gov ~)
    // ──────────────────────────────────────────────────────────────────
    case 'pace_of_cap_rate_expansion': {
      // Two overlapping bar series: pace_all (all-cohort MoM cap-rate
      // delta, annualized × 12) + pace_core (10+ Year cohort delta).
      // PDF visual:
      //   • Dark navy bars: Cap Expansion/Compression Pace (all)
      //   • Light blue bars (overlapping): Trend (Core 10+)
      //   • [Treasury delta line deferred — needs monthly treasury data]
      // Y-axis -1.50% to 2.50% per PDF.
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Cap Expansion/Compression Pace (all)',
              data: rows.map(r => r.pace_all),
              backgroundColor: palette[0],  // dark navy
              borderRadius: 1,
              barPercentage: 0.7,
              categoryPercentage: 0.85,
              order: 1 },
            { type: 'bar', label: 'Cap Expansion/Compression Trend (Core 10+)',
              data: rows.map(r => r.pace_core),
              backgroundColor: 'rgba(98,181,229,0.55)',  // sky w/ alpha so overlap is visible
              borderRadius: 1,
              barPercentage: 0.5,
              categoryPercentage: 0.85,
              order: 0 },
          ],
        },
        options: commonOpts({
          yAxisFormat: AXIS_FORMAT_PERCENT_2DP,
          yAxisRange: { min: -0.015, max: 0.025 },
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
