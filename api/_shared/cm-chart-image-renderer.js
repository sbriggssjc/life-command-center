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
// Round 7 — JS-literal serializer for QuickChart. QuickChart's eval
// only fires when `chart` is sent as a STRING containing JS-object
// syntax. Plain JSON-with-function-text doesn't trigger evaluation —
// the function strings stay as strings and the default datalabels
// behavior kicks in instead. This serializer:
//   • emits unquoted property keys when valid JS identifiers
//   • preserves functions as their toString() source
//   • escapes strings via JSON.stringify
//   • handles arrays/numbers/booleans/null naturally
function jsLiteral(v) {
  if (v == null) return 'null';
  const t = typeof v;
  if (t === 'function') return v.toString();
  if (t === 'string')   return JSON.stringify(v);
  if (t === 'number' || t === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map(jsLiteral).join(',') + ']';
  if (t === 'object') {
    const entries = Object.entries(v).map(([k, val]) => {
      const safeKey = /^[$_A-Za-z][$_A-Za-z0-9]*$/.test(k) ? k : JSON.stringify(k);
      return `${safeKey}: ${jsLiteral(val)}`;
    });
    return '{' + entries.join(',') + '}';
  }
  return JSON.stringify(v);
}

function buildAnnotations(rows, getter, labelFn, xKey = 'period_end') {
  if (!Array.isArray(rows) || rows.length === 0) return {};
  // i = array index into the rendered data. Chart.js category-axis can
  // accept either a label string or a numeric index. With monthly data
  // there are 3 rows per "Q1 '26" label, so label-based xValue lands on
  // the FIRST occurrence (Round 7 user feedback: "labels still floating
  // in the middle of the chart"). Index-based positioning is unambiguous.
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

  const out = {};
  // Last data point — primary callout (navy). xValue=index pins to the
  // exact row position regardless of how many rows share the same Q label.
  out.lastVal = {
    type: 'label',
    xValue: lastP.i,
    yValue: Number(lastP.y),
    content: labelFn(Number(lastP.y)),
    yAdjust: -16,
    ...labelStyle(PDF_COLORS.annotation_navy_bg),
  };
  // Max — sky blue callout
  if (maxP.i !== lastP.i) {
    out.maxVal = {
      type: 'label',
      xValue: maxP.i,
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
      xValue: minP.i,
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
const fmtCurrencyPerSf = (v) => '$' + Number(v).toFixed(2);

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
      // Round 6c — QuickChart v4 ships chartjs-plugin-datalabels enabled
      // by default, drawing a label on every data point. That's the
      // "floating data labels" problem on Avg_Deal / DOM_Ask / Sentiment /
      // Pace_Cap_Expand. Suppress globally; charts that want the
      // most-recent + high + low pattern use buildAnnotations() (which
      // emits chartjs-plugin-annotation labels at exactly 3 points), and
      // charts that want per-segment labels (donuts, stacked %) override
      // `plugins.datalabels` locally.
      // Pace_Cap_Expand etc. Suppress globally; charts that want the
      // most-recent + high + low pattern use buildAnnotations() (which
      // emits chartjs-plugin-annotation labels at exactly 3 points), and
      // charts that want per-segment labels (donuts, stacked bar %)
      // override `plugins.datalabels` locally.
      datalabels: { display: false },
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

// Even tighter range for Bid-Ask Last Ask Cap and Avail Mkt Size avg cap.
// Round 17 — widened 0.055-0.080 → 0.055-0.100 because gov data shows
// floating bars topping at ~9.6% (avg_last_ask 8.51% + spread 1.09%);
// the prior 8.0% ceiling was clipping the bar tops. User: "Data_Bid_Ask
// needs the y-axis adjusted so we can view all the data in range."
// Dialysis bars stay well within the band (top ~8.4%).
const CAP_RATE_BID_ASK_RANGE = { min: 0.055, max: 0.100 };

// % of Ask Price axis range. PDF dialysis p.33 + gov p.20 both pin
// 84%–96% on the right axis. Switched to that exact range so our chart
// matches the master deliverable visually (bars on left = DOM days,
// line on right = % of Ask).
// Round 7 — widened 0.84–0.96 → 0.85–1.05 so the line is visible.
// Actual dialysis data 2017+ runs 95-99% (TTM avg); 96% ceiling clipped
// the entire line off the top of the chart. User: "% of ask is completely
// gone now too." Range now bracketing recent values comfortably while
// preserving the PDF-aligned tight band.
const PCT_OF_ASK_RANGE = { min: 0.85, max: 1.05 };

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
      // Round 6a — segment label color contrast fix (user feedback
      // 2026-05-08: "label colors need to be lighter so we can see them").
      // Use chartjs-plugin-datalabels to draw the value + share % on
      // each wedge in white. QuickChart's hosted service includes this
      // plugin by default.
      //
      // Round 7 — pre-compute labels into the dataset's `dataLabels` array
      // and reference them by index in the formatter. Earlier versions
      // used a closure (`totalValue`, `isVolume`) inside the formatter,
      // which got dropped when JSON-stringified to QuickChart (server
      // didn't have those variables in scope, so the formatter silently
      // failed and raw numbers like `136722463.88` showed instead of
      // `$136.7M`). Embedding the labels as data means the formatter
      // works regardless of how QuickChart serializes the callback.
      const totalValue = tenantRows.reduce(
        (sum, r) => sum + (Number(r[valueKey]) || 0), 0);
      const preLabels = tenantRows.map((r) => {
        const v = Number(r[valueKey]) || 0;
        if (v === 0 || totalValue === 0) return '';
        const share = (v / totalValue) * 100;
        if (share < 4) return '';  // hide micro-segments
        if (isVolume) {
          const m = v / 1_000_000;
          const label = m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m.toFixed(1)}M`;
          return `${label}\n${share.toFixed(1)}%`;
        }
        return `${v}\n${share.toFixed(1)}%`;
      });
      return {
        type: 'doughnut',
        data: {
          labels: tenantRows.map(r => r.tenant || 'Unknown'),
          datasets: [{
            label: isVolume ? 'Volume Available' : 'Count Available',
            data: tenantRows.map(r => Number(r[valueKey]) || 0),
            // Pre-computed display strings — read by formatter via index
            dataLabels: preLabels,
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
            datalabels: {
              color: '#FFFFFF',
              font: { size: 11, weight: 'bold' },
              textShadowBlur: 2,
              textShadowColor: 'rgba(0,0,0,0.45)',
              // Pure function — reads pre-computed label from the
              // dataset's `dataLabels` array. No closure needed.
              formatter: function (value, ctx) {
                return (ctx.dataset.dataLabels || [])[ctx.dataIndex] || '';
              },
              anchor: 'center',
              align: 'center',
            },
          },
          cutout: '55%',
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
      // Round 7 — pre-compute price-bar labels here so the formatter
      // can read them off ctx.dataset (closures get dropped through
      // QuickChart's serialization).
      const termPriceLabels = termRows.map((row) => {
        const v = Number(row.avg_price) || 0;
        const m = v / 1_000_000;
        const priceLabel = m >= 1 ? `$${m.toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K`;
        const n = row.n_listings ?? 0;
        return `${priceLabel}\n(n=${n})`;
      });
      return {
        type: 'bar',
        data: {
          labels: termLabels,
          datasets: [
            { type: 'bar', label: 'Avg Price (left axis)',
              data: termRows.map(r => r.avg_price),
              // Pre-computed labels for datalabels formatter
              priceLabels: termPriceLabels,
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
          // Round 6a — total callouts above each price bar + count under the
          // term-bucket label, per user feedback: "we want data labels and
          // callouts so we can see the totals." datalabels plugin is shipped
          // by QuickChart hosted; the formatter shows N listings + avg price.
          opts.plugins = opts.plugins || {};
          // Round 7 — datalabels formatter reads priceLabels[i] off the
          // bar dataset (pre-computed above). No closure over termRows
          // so the function survives QuickChart's JSON serialization.
          opts.plugins.datalabels = {
            display: function (ctx) { return ctx.dataset.type === 'bar'; },
            color: PDF_COLORS.cap_short,
            font: { size: 11, weight: 'bold' },
            anchor: 'end',
            align: 'top',
            offset: 4,
            formatter: function (value, ctx) {
              return (ctx.dataset.priceLabels || [])[ctx.dataIndex] || '';
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
            // Round 9 — user feedback: "It should just be an average."
            // Master_m mapper has emitted simple TTM avg since Round 6b
            // (field name `ttm_weighted_cap_rate` retained for backwards
            // compatibility, but the value is the simple mean).
            label: 'Avg Cap Rate (TTM)',
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
      // Round 31 Tier 2 — Y-axis tightened to 5.25-9.25% to match
      // master Excel "All Charts" chart 7/8 (NM Average Cap vs Non-NM
      // Average Cap). Master uses 0.0525..0.09250 fixed range; tighter
      // window than the default CAP_RATE_RANGE so the two cap lines
      // fill the chart frame.
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'NM Average Cap (TTM)',     data: rows.map(r => r.nm_cap_rate),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Non-NM Average Cap (TTM)', data: rows.map(r => r.market_cap_rate),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: commonOpts({
          yAxisFormat: AXIS_FORMAT_PERCENT_2DP,
          yAxisRange: { min: 0.0525, max: 0.0925 },
        }),
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
      // Round 6b — color distinction per user feedback "we need to address
      // the colors so we can tell which line is which." Previous palette
      // indices (1/0/2) gave sky-blue/navy/pale-blue — three blues that
      // blend at the screen sizes in the workbook export. Switch to
      // distinct hues from the PDF deck:
      //   • Top Quartile    → purple #7E6BAD  (cap_long_term)
      //   • Median          → dark navy #003DA5 (cap_short — anchor)
      //   • Bottom Quartile → sage #4CB582    (cap_mid_long)
      // Top + Bottom thinner; Median emphasized.
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Top Quartile',    data: rows.map(r => r.top_quartile),
              borderColor: PDF_COLORS.cap_long_term, backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2,
              borderDash: [4, 3] },
            { label: 'Median',          data: rows.map(r => r.median),
              borderColor: PDF_COLORS.cap_short, backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Bottom Quartile', data: rows.map(r => r.bottom_quartile),
              borderColor: PDF_COLORS.cap_mid_long, backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2,
              borderDash: [4, 3] },
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
      // Round 21 — stepped: 'before' replaces tension to match the
      // step-plot pattern used on NM_vs_Market and Active_Cap_Quart
      // since Round 13. Cohort cap rates plateau when their TTM
      // distribution shifts slowly (gov cohorts have thin samples);
      // the step display reads as honest held-constant rather than
      // sporadic smooth lines.
      const datasets = hasDialysisCohorts ? [
        { label: '12+ Year',     data: rows.map(r => r.cap_12plus),
          borderColor: PDF_COLORS.cap_long_term, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2.5 },
        { label: '8-12 Year',    data: rows.map(r => r.cap_8to12),
          borderColor: PDF_COLORS.cap_mid_long, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2 },
        { label: '6-8 Year',     data: rows.map(r => r.cap_6to8),
          borderColor: PDF_COLORS.cap_mid, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2 },
        { label: '≤5 Year',      data: rows.map(r => r.cap_5orless),
          borderColor: PDF_COLORS.cap_short, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2 },
      ] : [
        { label: '10+ Year',       data: rows.map(r => r.cap_10plus),
          borderColor: PDF_COLORS.cap_long_term, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2.5 },
        { label: '6-10 Year',      data: rows.map(r => r.cap_6to10),
          borderColor: PDF_COLORS.cap_mid_long, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2 },
        { label: '< 5 Year',       data: rows.map(r => r.cap_less5),
          borderColor: PDF_COLORS.cap_short, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2 },
        { label: 'Outside Firm',   data: rows.map(r => r.cap_outside_firm),
          borderColor: PDF_COLORS.cap_outside_firm, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 1.5, borderDash: [3, 3] },
      ];
      return {
        type: 'line',
        data: { labels, datasets },
        // Round 21 — y range widened 5-10% → 4-11% (gov cap_less5
        // tops at 10.06%, occasionally clipping at the prior 10% cap).
        options: commonOpts({
          yAxisFormat: AXIS_FORMAT_PERCENT_2DP,
          yAxisRange:  { min: 0.04, max: 0.11 },
        }),
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
          // Annotations: peak/trough/last on % of Ask line.
          // Round 17 — pin annotations to the right-axis ('y1') so
          // they sit on the line they describe, and nudge them above
          // by 14px so they don't sit ON the line marker. Previously
          // labels were "floating" (the user's word) because the
          // default y-axis assignment landed them on the LEFT axis
          // (DOM days) numerical space, far above the actual % line.
          const ann = buildAnnotations(rows, r => r.pct_of_ask, fmtPct1);
          for (const k of Object.keys(ann)) {
            ann[k].yScaleID = 'y1';
            ann[k].yAdjust  = -14;
          }
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
      // Round 10 — PDF spec parity (dialysis p.35 / gov p.22):
      //   • LEFT axis  = cap rate (lines)         — dialysis 4.75–7.25%, gov 5.0–8.5%
      //   • RIGHT axis = price change % (bars)    — dialysis 0–70%,      gov 0–14%
      //   (Round 1 had these flipped — bars-left/lines-right — which
      //   matched the data but not the PDF axis layout.)
      //
      // Colors retained from Round 1 (sage green / light purple / navy /
      // sky) — already PDF-matched per docs/cm-pdf-vs-export-chart-deltas.md.
      const govLike = chart.vertical === 'gov'
                   || chart.vertical === 'government_leased';
      // Round 26 — gov cap window widened 5.0–8.5% → 5.0–9.0%. Gov
      // last_ask_cap_all hits 8.78%, clipping the prior 8.5% ceiling.
      // User: "the asking cap rates for anything before 2010 appear
      // to be very lacking or gaps… needs an adjustment to the Y-axis
      // so that we can see the data."
      // Round 31 — Both verticals widened. Dia 4.75-7.25% was clipping
      // the long-term cohort (max 8.87%) and the all-window (max 7.99%).
      // Gov narrowed slightly so the lines fill the chart frame better.
      // User: "We also have a y-axis issue with the cap rate lines not
      // displaying in view on the chart" (dia) and "Y-axis does not
      // allow the data to be in view on the chart" (gov).
      const yLeftRange  = govLike
        ? { min: 0.055, max: 0.095 }      // gov: tightened 5.5-9.5% (data 6.05-8.78%)
        : { min: 0.0475, max: 0.0925 };   // dia: widened to 4.75-9.25% (long-term max 8.87%)
      // Round 17 — tightened gov price-change axis 0.14 → 0.08. Actual
      // gov data tops at ~7% TTM (was specced 0-14% from the dialysis
      // p.35 deck assumption). User: "Sentiment needs the y-axis
      // adjusted to show the movement in the price change categories."
      const yRightRange = govLike
        ? { min: 0, max: 0.08 }           // gov price change %
        : { min: 0, max: 0.70 };          // dialysis price change %
      const annotations = buildAnnotations(
        rows, r => r.last_ask_cap_all, fmtPct2
      );
      const opts = comboOpts({
        yLeftFormat:  AXIS_FORMAT_PERCENT_2DP,
        yLeftRange,
        yRightFormat: AXIS_FORMAT_PERCENT_0DP,
        yRightRange,
      });
      if (Object.keys(annotations).length) {
        opts.plugins.annotation = { annotations };
      }
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            // Bars (price change) on the RIGHT axis, order=2 → drawn behind lines.
            { type: 'bar',  label: 'Price Change %',
              data: rows.map(r => r.pct_price_change_all),
              backgroundColor: PDF_COLORS.sentiment_bar_all, borderRadius: 1,
              yAxisID: 'y1', order: 2 },
            { type: 'bar',  label: '8+ Yr Term Price Change %',
              data: rows.map(r => r.pct_price_change_long_term),
              backgroundColor: PDF_COLORS.sentiment_bar_long, borderRadius: 1,
              yAxisID: 'y1', order: 2 },
            // Lines (cap rate) on the LEFT axis, order=0 → drawn on top.
            { type: 'line', label: 'Last Asking Cap (all)',
              data: rows.map(r => r.last_ask_cap_all),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y', order: 0 },
            { type: 'line', label: 'Last Asking Cap (8+ yr)',
              data: rows.map(r => r.last_ask_cap_long_term),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2,
              yAxisID: 'y', order: 0 },
          ],
        },
        options: opts,
      };
    }

    case 'valuation_index': {
      // Round 20 — Combo: navy line for Valuation Index (left axis) +
      // sky-blue YoY% bars (right axis), matching master deck p.17.
      // YoY field name coalesces: gov view uses `yoy_change`, dialysis
      // uses `yoy_change_pct`.
      const yoyValues = rows.map(r => r.yoy_change_pct ?? r.yoy_change ?? null);
      // Round 24 — auto-fit right-axis range to data ±10% padding,
      // centered on zero. User: "the y-axis needs to be adjusted to
      // show the YOY change in view for the entire chart." Prior
      // ±25% clipped DIA Mar 2026 (27% YoY) — and didn't expand
      // when extremes drifted further.
      const yoyMag = yoyValues
        .map(v => v == null ? 0 : Math.abs(Number(v)))
        .reduce((a, b) => Math.max(a, b), 0);
      const yoyMax = Math.max(0.05, Math.ceil(yoyMag * 11) / 10);  // round up to nearest 10%
      const opts = comboOpts({
        yLeftFormat:  AXIS_FORMAT_INTEGER,
        yRightFormat: AXIS_FORMAT_PERCENT_1DP,
        yRightRange:  { min: -yoyMax, max: yoyMax },
      });
      // Annotations on the navy Valuation Index line (peak/trough/last).
      const annotations = buildAnnotations(rows, r => r.valuation_index, fmtIndex);
      for (const k of Object.keys(annotations)) annotations[k].yAdjust = -14;
      if (Object.keys(annotations).length) {
        opts.plugins.annotation = { annotations };
      }
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            // Bars BEHIND the line (order: 2 = drawn first)
            { type: 'bar', label: 'YoY % Change',
              data: yoyValues,
              backgroundColor: rows.map((r, i) => (yoyValues[i] != null && yoyValues[i] < 0)
                ? 'rgba(217,119,6,0.55)'        // amber for declines
                : 'rgba(98,181,229,0.55)'),     // sky for gains
              borderRadius: 1,
              yAxisID: 'y1', order: 2 },
            // Index line on top (order: 0 = drawn last)
            { type: 'line', label: 'Valuation Index',
              data: rows.map(r => r.valuation_index),
              borderColor: palette[0],          // navy
              backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y', order: 0 },
          ],
        },
        options: opts,
      };
    }

    case 'rent_psf_box_quarterly':
    case 'ppsf_box_quarterly': {
      // Round 30 — User: "Let's remove the min and max from the chart
      // and adjust the y-axis so we can see the movement of the data
      // better." IQR box + median line; y-axis pinned $5-$50/SF
      // (dia rent IQR data lives $9.83-$45.62).
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            // Floating bar: [lower_quartile, upper_quartile] → IQR box body
            { type: 'bar',  label: 'IQR (25th-75th %)',
              data: rows.map(r => [r.rent_lower_quartile ?? r.lower_quartile,
                                    r.rent_upper_quartile ?? r.upper_quartile]),
              backgroundColor: palette[3], borderRadius: 1,
              borderWidth: 0, order: 2 },
            { type: 'line', label: 'Median',
              data: rows.map(r => r.rent_median ?? r.median),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0, pointRadius: 0, borderWidth: 2.5, order: 0 },
          ],
        },
        options: commonOpts({
          yAxisFormat: AXIS_FORMAT_CURRENCY,
          yAxisRange: { min: 5, max: 50 },
        }),
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
        options: (() => {
          const o = commonOpts({
            yAxisFormat: AXIS_FORMAT_PERCENT_1DP,
            yAxisRange: { min: 0, max: 0.10 },
          });
          // Round 6c — most-recent + high + low labels on avg cap rate
          // (primary navy line). User: "Data_Cost_Capital needs labels."
          const ann = buildAnnotations(rows, r => r.avg_cap_rate, fmtPct2);
          if (Object.keys(ann).length) o.plugins.annotation = { annotations: ann };
          return o;
        })(),
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
      // Round 25 — Per-dataset label color now lives on EACH dataset
      // via `datalabels.color`, not in opts.plugins.datalabels.color
      // as a closure-using function. The Round 17 closure
      // `labelColorByDatasetIndex` was lost in QuickChart's JS-string
      // serialization, causing the chart render to fail entirely (the
      // entire Data_Buyer_Pool tab dropped its image). Per-dataset
      // datalabels override the plugin-level color cleanly.
      opts.plugins = opts.plugins || {};
      opts.plugins.datalabels = {
        font: { size: 10, weight: 'bold' },
        formatter: function (value) {
          if (value == null || value < 0.04) return '';
          return (value * 100).toFixed(0) + '%';
        },
        anchor: 'center',
        align: 'center',
      };
      return {
        type: 'bar',
        data: {
          labels: yearLabels,
          datasets: [
            { label: 'Private',       data: rows.map(r => r.private_pct),
              backgroundColor: palette[0], stack: 'pool',
              datalabels: { color: '#FFFFFF' } },           // navy bg → white
            { label: 'Public REITs',  data: rows.map(r => r.reit_pct),
              backgroundColor: palette[2], stack: 'pool',
              datalabels: { color: '#FFFFFF' } },           // mid-blue bg → white
            { label: 'Cross-Border',  data: rows.map(r => r.cross_border_pct),
              backgroundColor: palette[1], stack: 'pool',
              datalabels: { color: '#191919' } },           // sky bg → dark
            { label: 'Institutional', data: rows.map(r => r.institutional_pct),
              backgroundColor: palette[3], stack: 'pool',
              datalabels: { color: '#191919' } },           // pale bg → dark
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
            // Round 30 — distinct line colors so the two cap series
            // are visually different (was palette[0] navy vs palette[2]
            // mid-blue — too similar; user noticed lines crossing
            // ambiguously). Navy for Total, amber for 10+yr cohort.
            { type: 'line', label: 'Total Market — Avg Asking Cap',
              data: rows.map(r => r.avg_cap_total),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
            { type: 'line', label: '10+ Year Term — Avg Asking Cap',
              data: rows.map(r => r.avg_cap_core_10plus),
              borderColor: '#D97706', backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
          ],
        },
        // Round 30 — Cap rate axis tightened 5.5-7.5% (data lives
        // 5.89-7.00%). The prior CAP_RATE_BID_ASK_RANGE 5.5-10.0%
        // squashed the cap lines into the bottom of the chart.
        options: comboOpts({
          yLeftFormat:  AXIS_FORMAT_INTEGER,
          yRightFormat: AXIS_FORMAT_PERCENT_2DP,
          yRightRange:  { min: 0.055, max: 0.075 },
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
            // Round 17 — widened from 5.0–9.0% to 5.0–10.5%. Gov
            // upper-quartile hits 10.08% and dialysis upper hits
            // ~9.5%; the prior 9.0% cap was clipping the top of the
            // Q1–Q3 floating bars off the chart. User: "needs to
            // have the y-axis looked at and adjusted so all the data
            // in cap rates are visible."
            yRightRange:  { min: 0.050, max: 0.105 },
          });
          // Annotations on Avg Cap Rate (the primary line — peak/trough/last).
          // Round 24 — pin to right axis ('y1' = % axis). Default was 'y'
          // (left = volume $ axis), causing labels to sit at the very
          // bottom of the chart because 0.0762 on a $0-$3B axis = ~$76K.
          // User: "let's just adjust the labels to call out the data
          // point and not just floating at the bottom."
          const ann = buildAnnotations(rows, r => r.cap_rate, fmtPct2);
          for (const k of Object.keys(ann)) {
            ann[k].yScaleID = 'y1';
            ann[k].yAdjust  = -18;
          }
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
      //
      // Round 6b — Y-axis was CAP_RATE_TIGHT_RANGE (5%–8%) which clipped
      // federal data into the top edge. Real gov federal cap data ranges
      // 5%–26% (with outliers); typical band is 5.5%–9.5%. Use the
      // standard CAP_RATE_RANGE (5%–10%) for headroom without letting
      // outliers dominate the visual. State + municipal still missing
      // (deltas-doc item #17 — gov feed has 0 state/muni rows with
      // populated cap rate; user feedback: "missing the state and
      // municipal data" persists until we get that data feed).
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Federal',   data: rows.map(r => r.federal_cap),
              borderColor: PDF_COLORS.cap_short,    backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'State',     data: rows.map(r => r.state_cap),
              borderColor: PDF_COLORS.cap_mid,      backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: 'Municipal', data: rows.map(r => r.municipal_cap),
              borderColor: PDF_COLORS.cap_mid_long, backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP, yAxisRange: CAP_RATE_RANGE }),
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
        options: (() => {
          const o = commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_1DP });
          // Round 6c — labels on the GSA renewal CAGR (primary navy)
          // per user feedback "Data_CPI_CAGR... add labels."
          const ann = buildAnnotations(rows, r => r.gsa_renewal_cagr, fmtPct1);
          if (Object.keys(ann).length) o.plugins.annotation = { annotations: ann };
          return o;
        })(),
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
      // Round 9 — stacked bars per the PDF.
      // Round 29 — distinguishable colors for 4 outcomes (prior palette
      // used pale [3] for Expired which blended into the background and
      // muted axis [4] for Terminated). New scheme uses 3 sequential
      // navy→sky shades for the "continuing" tiers + amber for the
      // negative "Terminated" bucket so the lost-lease signal pops.
      const opts = commonOpts({ yAxisFormat: AXIS_FORMAT_INTEGER });
      opts.scales.x.stacked = true;
      opts.scales.y.stacked = true;
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Renewed',           data: rows.map(r => r.renewed_leases),
              backgroundColor: PDF_COLORS.cap_short,    // navy
              stack: 'leases' },
            { label: 'Succeed/Supersede', data: rows.map(r => r.succeeding_superseding_leases),
              backgroundColor: palette[2],              // mid-blue
              stack: 'leases' },
            { label: 'Expired',           data: rows.map(r => r.expired_leases),
              backgroundColor: PDF_COLORS.cap_mid,      // sky
              stack: 'leases' },
            { label: 'Terminated',        data: rows.map(r => r.terminated_leases),
              backgroundColor: '#D97706',               // amber — negative outcome
              stack: 'leases' },
          ],
        },
        options: opts,
      };
    }

    case 'lease_termination_rate': {
      // Round 9 — Originally area (Termination Rate %) + line (Outside
      // Firm count).
      // Round 31 Tier 2 — Restructured to match master Excel "Term_Rate"
      // chart in `Copy Government Master Document.xlsx` > 'All Charts'
      // > chart 4: two bar series (counts), no rate %, no dual axis.
      //   Series 0: "Leases In Firm Term (TTM)"     — total - outside
      //   Series 1: "Leases Outside Firm (TTM)"     — outside_firm_term
      // User: "Data_Term_Rate - Review the formatting of the chart in
      // our Excel and update".
      const outsideFirm = rows.map(r =>
        r.leases_outside_firm_term != null ? Number(r.leases_outside_firm_term) : null
      );
      const inFirm = rows.map(r => {
        const total   = r.total_leases_active != null ? Number(r.total_leases_active) : null;
        const outside = r.leases_outside_firm_term != null ? Number(r.leases_outside_firm_term) : null;
        if (total == null || outside == null) return null;
        return Math.max(0, total - outside);
      });
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Leases In Firm Term (TTM)',
              data: inFirm,
              backgroundColor: palette[0],            // NM navy
              borderColor: palette[0],
              borderRadius: 1, yAxisID: 'y', order: 1 },
            { type: 'bar', label: 'Leases Outside Firm (TTM)',
              data: outsideFirm,
              backgroundColor: palette[1],            // sky
              borderColor: palette[1],
              borderRadius: 1, yAxisID: 'y', order: 2 },
          ],
        },
        options: commonOpts({ yAxisFormat: AXIS_FORMAT_INTEGER }),
      };
    }

    case 'lease_structures': {
      // Round 6b — user feedback 2026-05-09: "Data_Lease_Terms has a chart
      // when what's in the PDF is just a table side by side." The PDF
      // (gov p.27) shows two tables (TTM + Last 5 Years), no chart.
      // Return null so the export renders only the data table on this tab.
      return null;
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
      // Round 10 — PDF gov p.32 left-chart styling:
      //   • Light-blue bars: Avg Renewal Rent / SF (left $ axis)
      //   • Dark-navy whisker bars: Upper/Lower Quartile range (left $ axis)
      //     Implemented as a floating-bar dataset (data: [low, high] pairs),
      //     narrow categoryPercentage so it reads as a vertical whisker on
      //     top of the wider light-blue bar.
      //   • Dark-navy dots: 5-Year Renewal Rent CAGR (right % axis)
      //     Scatter points at the bar center with no connecting line.
      //
      // Prior Round 1-9 layout was 4 stacked lines (avg / TTM / U-quartile
      // dashed / L-quartile dashed) — the PDF style was always the goal.
      // Round 26 — widened axes to fit gov data:
      //   left axis $0–$45 → $0–$70 (gov avg_renewal_rent_psf hits $65.49)
      //   right axis -4%–8% → -5%–12% (gov cagr_5yr hits 10.68%)
      // User: "we need to adjust the y-axis so we can see all the data.
      // Also, we're missing a good amount of the data for the renewal
      // rate CAGR."
      const opts = comboOpts({
        yLeftFormat:  AXIS_FORMAT_CURRENCY,
        yLeftRange:   { min: 0, max: 70 },
        yRightFormat: AXIS_FORMAT_PERCENT_1DP,
        yRightRange:  { min: -0.05, max: 0.12 },
      });
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            // Wide light-blue bar — quarterly avg renewal rent PSF
            { type: 'bar', label: 'Avg Renewal Rent / SF',
              data: rows.map(r => r.avg_renewal_rent_psf),
              backgroundColor: PDF_COLORS.cap_mid, // sky #62B5E5
              borderRadius: 1,
              barPercentage: 0.85, categoryPercentage: 0.9,
              yAxisID: 'y', order: 3 },
            // Narrow navy floating-bar — quartile range (low→high pairs)
            { type: 'bar', label: 'Upper/Lower Quartile',
              data: rows.map(r => {
                const lo = r.lower_quartile_rpsf;
                const hi = r.upper_quartile_rpsf;
                return (lo != null && hi != null) ? [Number(lo), Number(hi)] : null;
              }),
              backgroundColor: PDF_COLORS.cap_short,  // navy
              borderColor: PDF_COLORS.cap_short,
              borderRadius: 0,
              barPercentage: 0.20,  categoryPercentage: 0.6,
              yAxisID: 'y', order: 1 },
            // Navy dots — 5-yr renewal CAGR on right axis. Scatter via
            // line type with showLine:false + visible point markers.
            { type: 'line', label: '5-Yr Renewal Rent CAGR',
              data: rows.map(r => r.cagr_5yr),
              borderColor: PDF_COLORS.cap_short, backgroundColor: PDF_COLORS.cap_short,
              showLine: false,
              pointRadius: 4, pointHoverRadius: 5,
              pointStyle: 'circle',
              yAxisID: 'y1', order: 0 },
          ],
        },
        options: opts,
      };
    }

    case 'rent_by_year_built': {
      // Round 21 — Refactor from bar+dashed lines to scatter + whiskers
      // to match master deck p.30. One vertical whisker per year-built
      // bucket spanning lower-quartile → upper-quartile rent PSF, with
      // a median dot in the middle. Average dot in navy for emphasis.
      //
      // Whiskers: implemented as a thin floating-bar dataset (data:
      // [lower, upper] pairs) with categoryPercentage tight enough to
      // read as a vertical line.
      // Dots: separate scatter datasets for median (sky), avg (navy).
      const yearLabels = rows.map(r => String(r.year));
      return {
        type: 'bar',
        data: {
          labels: yearLabels,
          datasets: [
            // Whisker bar (lower-Q → upper-Q range)
            { type: 'bar', label: 'Q1–Q3 Range',
              data: rows.map(r => {
                const lo = r.lower_quartile_rpsf, hi = r.upper_quartile_rpsf;
                return (lo != null && hi != null) ? [Number(lo), Number(hi)] : null;
              }),
              backgroundColor: 'rgba(98,181,229,0.25)',  // pale sky fill
              borderColor: PDF_COLORS.cap_mid,           // sky border
              borderWidth: 1,
              borderSkipped: false,
              barPercentage: 0.18,                       // narrow → reads as whisker
              categoryPercentage: 0.6,
              order: 3 },
            // Median dot (sky)
            { type: 'scatter', label: 'Median Rent / SF',
              data: rows.map((r, i) => ({ x: i, y: r.median_rpsf })),
              backgroundColor: PDF_COLORS.cap_mid,
              borderColor: PDF_COLORS.cap_mid,
              pointRadius: 5, pointStyle: 'circle',
              showLine: false, order: 1 },
            // Avg dot (navy — primary marker)
            { type: 'scatter', label: 'Avg Rent / SF',
              data: rows.map((r, i) => ({ x: i, y: r.avg_rpsf })),
              backgroundColor: PDF_COLORS.cap_short,    // navy
              borderColor: PDF_COLORS.cap_short,
              pointRadius: 6, pointStyle: 'rectRot',    // diamond
              showLine: false, order: 0 },
          ],
        },
        options: (() => {
          const opts = commonOpts({ yAxisFormat: AXIS_FORMAT_CURRENCY });
          opts.scales = opts.scales || {};
          opts.scales.x = { ...(opts.scales.x || {}), type: 'category' };
          // Pin a sensible y range — rent PSF typically $5-$50 for
          // gov leased buildings.
          opts.scales.y.min = 0;
          opts.scales.y.max = 50;
          return opts;
        })(),
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
      // Bar: commencement_count by year + line: avg_rent_per_sf.
      //
      // Round 6c — user feedback 2026-05-09: "outlier commencements in
      // 2026 and 2019 that need to be investigated and the y-axis needs
      // to be adjusted to show the movement in the average rent figure.
      // Let's add low high and most recent labels too." Outliers were
      // bulk-import sentinel dates in gsa_lease_events — fixed in the
      // _y view via Round 6e sentinel filter. Renderer-side: tighten
      // right-axis around the rent line + 3-point annotations.
      const rentVals = rows.map(r => Number(r.avg_rent_per_sf)).filter(Number.isFinite);
      const rentMin = rentVals.length ? Math.min(...rentVals) : null;
      const rentMax = rentVals.length ? Math.max(...rentVals) : null;
      const rentRange = rentMin != null && rentMax != null
        ? { min: Math.max(0, Math.floor((rentMin - 1) * 2) / 2),
            max: Math.ceil((rentMax + 1) * 2) / 2 }
        : null;
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
        options: (() => {
          const o = comboOpts({
            yLeftFormat:  AXIS_FORMAT_INTEGER,
            yRightFormat: AXIS_FORMAT_CURRENCY,
            yRightRange:  rentRange,  // tighter so rent movement is visible
          });
          // Annotations on rent series (year axis, not period_end).
          const ann = buildAnnotations(rows, r => r.avg_rent_per_sf, fmtCurrencyPerSf, 'year');
          if (Object.keys(ann).length) o.plugins.annotation = { annotations: ann };
          return o;
        })(),
      };
    }

    // ──────────────────────────────────────────────────────────────────
    // Round 2b — Pace of Cap Rate Expansion (dialysis PDF p.24, gov ~)
    // ──────────────────────────────────────────────────────────────────
    case 'pace_of_cap_rate_expansion': {
      // Round 16 — Composer switched to nominal YoY cap-rate change
      // (per user: "7% cap a year ago, 6.5% cap today should show
      //  50bps compression for the current month"). Renderer plots:
      //   • Dark navy bars: Cap Rate YoY Δ (All)
      //   • Light blue bars (overlapping): Cap Rate YoY Δ (Core 10+)
      //   • Orange line: Cost of Capital YoY Δ (mortgage_30y_rate)
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Cap Rate YoY Δ (All)',
              data: rows.map(r => r.pace_all),
              backgroundColor: palette[0],  // dark navy
              borderRadius: 1,
              barPercentage: 0.7,
              categoryPercentage: 0.85,
              order: 2 },
            { type: 'bar', label: 'Cap Rate YoY Δ (Core 10+)',
              data: rows.map(r => r.pace_core),
              backgroundColor: 'rgba(98,181,229,0.55)',  // sky w/ alpha
              borderRadius: 1,
              barPercentage: 0.5,
              categoryPercentage: 0.85,
              order: 1 },
            { type: 'line', label: 'Cost of Capital YoY Δ',
              data: rows.map(r => r.pace_cost),
              borderColor: '#D97706',  // amber/orange
              backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              order: 0 },
          ],
        },
        options: (() => {
          const o = commonOpts({
            yAxisFormat: AXIS_FORMAT_PERCENT_2DP,
            yAxisRange: { min: -0.025, max: 0.035 },
          });
          // Round 24 — user: "We're missing the high label callout."
          // The default buildAnnotations skips max/min when they
          // coincide with the most-recent point. For Pace_Cap_Expand
          // we always want all three: high (sky), low (sky), latest
          // (navy). Compose them explicitly here.
          const points = rows
            .map((r, i) => ({ i, x: r.period_end, y: r.pace_all }))
            .filter(p => p.y != null && Number.isFinite(Number(p.y)));
          if (points.length >= 2) {
            let maxP = points[0], minP = points[0];
            for (const p of points) {
              if (Number(p.y) > Number(maxP.y)) maxP = p;
              if (Number(p.y) < Number(minP.y)) minP = p;
            }
            const lastP = points[points.length - 1];
            const labelStyle = (bg) => ({
              type: 'label',
              backgroundColor: bg,
              color: PDF_COLORS.annotation_text,
              font: { size: 10, family: 'Calibri', weight: 'bold' },
              padding: { top: 2, bottom: 2, left: 5, right: 5 },
              borderRadius: 3,
              z: 100,
            });
            o.plugins.annotation = { annotations: {
              highVal: { ...labelStyle(PDF_COLORS.annotation_sky_bg),
                xValue: maxP.i, yValue: Number(maxP.y),
                content: fmtPct2(Number(maxP.y)), yAdjust: -16 },
              lowVal:  { ...labelStyle(PDF_COLORS.annotation_sky_bg),
                xValue: minP.i, yValue: Number(minP.y),
                content: fmtPct2(Number(minP.y)), yAdjust: 16 },
              lastVal: { ...labelStyle(PDF_COLORS.annotation_navy_bg),
                xValue: lastP.i, yValue: Number(lastP.y),
                content: fmtPct2(Number(lastP.y)),
                yAdjust: Number(lastP.y) >= 0 ? -16 : 16 },
            }};
          }
          return o;
        })(),
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // Round 18 — 5 NEW charts
    // ─────────────────────────────────────────────────────────────────

    case 'core_cap_rate_dot_plot': {
      // Round 24 — User: "only show the sales with 8+ years of lease
      // term remaining at close and we do not need to differentiate
      // NM sales and the balance. Just one dataset and also add a
      // trendline that moves over time."
      // Round 30 — User: "Can we go further back in time with this
      // chart so we can see the movement over time? … verify 8+yr
      // (dia) / 6+yr (gov) firm-term filters."
      //   • Dia core = firm_term_years >= 8  (view applies filter)
      //   • Gov core = firm_term_years >= 6  (R30 fix: was 8)
      //   • Source views back to 2001-01-01; renderer no longer
      //     constrains the timeline window.
      // x = sale_date (numeric ms), y = cap_rate.
      // Single sky-blue dot series + a 12-month rolling-avg trendline
      // computed in JS (sorted by date, sliding-window mean over ±6mo).
      const dots = rows
        .filter(r => r.cap_rate != null && r.period_end != null)
        .map(r => ({ x: new Date(r.period_end).getTime(), y: Number(r.cap_rate) }))
        .sort((a, b) => a.x - b.x);

      // 12-month rolling average trendline. For each dot, average y of
      // all dots with x in [center - 6mo, center + 6mo].
      const SIX_MO_MS = 1000 * 60 * 60 * 24 * 182;
      const trend = dots.map((d) => {
        let sum = 0, n = 0;
        for (const o of dots) {
          if (o.x >= d.x - SIX_MO_MS && o.x <= d.x + SIX_MO_MS) {
            sum += o.y; n++;
          }
        }
        return { x: d.x, y: n > 0 ? sum / n : null };
      });

      return {
        type: 'scatter',
        data: {
          datasets: [
            { label: 'Core sales (long firm term)',
              data: dots,
              backgroundColor: 'rgba(98,181,229,0.55)',  // sky w/ alpha
              borderColor: PDF_COLORS.cap_mid,
              pointRadius: 3, pointStyle: 'circle',
              showLine: false, order: 2 },
            { label: '12-mo Rolling Avg',
              data: trend,
              type: 'line',
              borderColor: PDF_COLORS.cap_short,         // navy line
              backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              showLine: true, order: 0 },
          ],
        },
        options: (() => {
          const o = commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP, yAxisRange: { min: 0.04, max: 0.12 } });
          o.scales.x = {
            type: 'time',
            time: { unit: 'year' },
            ticks: { color: '#6A748C', font: { family: 'Calibri', size: 9 } },
            grid: { display: false },
          };
          return o;
        })(),
      };
    }

    case 'available_cap_rate_dot_plot': {
      // Round 24 — trendline + axis centering.
      // Round 30 — User: "Remove the NM-brokered listings from the
      // data labels table." Single combined dot series (no NM split).
      const allDots = rows
        .filter(r => r.cap_rate != null && r.firm_term_years != null)
        .map(r => ({
          x: Number(r.firm_term_years),
          y: Number(r.cap_rate),
        }));

      // Auto-center x-axis around data ±10% padding, capped to [0, 30]
      const xs = allDots.map(d => d.x);
      const xMinData = xs.length ? Math.min(...xs) : 0;
      const xMaxData = xs.length ? Math.max(...xs) : 30;
      const pad = Math.max(1, (xMaxData - xMinData) * 0.10);
      const xMin = Math.max(0, Math.floor(xMinData - pad));
      const xMax = Math.min(30, Math.ceil(xMaxData + pad));

      // Linear-regression trendline through ALL points (combined)
      // y = mx + b; compute by least-squares.
      const n = allDots.length;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const d of allDots) { sx += d.x; sy += d.y; sxx += d.x * d.x; sxy += d.x * d.y; }
      const denom = (n * sxx - sx * sx);
      const m = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
      const b = (sy - m * sx) / Math.max(n, 1);
      const trendData = [
        { x: xMin, y: m * xMin + b },
        { x: xMax, y: m * xMax + b },
      ];

      return {
        type: 'scatter',
        data: {
          datasets: [
            { label: 'Active listings',
              data: allDots,
              backgroundColor: 'rgba(98,181,229,0.55)',
              borderColor: PDF_COLORS.cap_mid,
              pointRadius: 4, pointStyle: 'circle',
              showLine: false, order: 1 },
            { label: 'Linear Trendline',
              data: trendData,
              type: 'line',
              borderColor: PDF_COLORS.cap_short,
              backgroundColor: 'transparent',
              borderDash: [6, 4],
              borderWidth: 2,
              pointRadius: 0,
              showLine: true, order: 0 },
          ],
        },
        options: (() => {
          const o = commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP, yAxisRange: { min: 0.04, max: 0.12 } });
          o.scales.x = {
            type: 'linear',
            position: 'bottom',
            min: xMin,
            max: xMax,
            title: { display: true, text: 'Firm Lease Term (Years)', color: '#6A748C', font: { family: 'Calibri', size: 10 } },
            ticks: { color: '#6A748C', font: { family: 'Calibri', size: 9 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
          };
          return o;
        })(),
      };
    }

    case 'available_by_firm_term_summary': {
      // Gov equivalent of available_by_term_summary (dialysis p.30 bottom).
      // 4 grouped sky-blue bars (Avg Price, left axis) + 4 dot/line
      // series (Avg Cap, Upper Q, Lower Q, Median) on right axis.
      // Cohorts: Sub 5 / 5-8 / 8-12 / 12+ firm lease years.
      const termRows = rows || [];
      const termLabels = termRows.map(r => r.term_bucket || '?');
      const dotPointRadius = 6;
      const dotPointStyle = 'rectRot';
      const termPriceLabels = termRows.map((row) => {
        const v = Number(row.avg_price) || 0;
        const m = v / 1_000_000;
        const priceLabel = m >= 1 ? `$${m.toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K`;
        const n = row.n_listings ?? 0;
        return `${priceLabel}\n(n=${n})`;
      });
      return {
        type: 'bar',
        data: {
          labels: termLabels,
          datasets: [
            { type: 'bar', label: 'Avg Price (left axis)',
              data: termRows.map(r => r.avg_price),
              priceLabels: termPriceLabels,
              backgroundColor: PDF_COLORS.cap_mid,
              borderColor: PDF_COLORS.cap_mid,
              borderRadius: 1,
              barPercentage: 0.6, categoryPercentage: 0.85,
              yAxisID: 'y', order: 5 },
            { type: 'scatter', label: 'Avg Cap',
              data: termRows.map((r, i) => ({ x: i, y: r.avg_cap })),
              backgroundColor: PDF_COLORS.cap_short,
              borderColor: PDF_COLORS.cap_short,
              pointRadius: dotPointRadius, pointStyle: dotPointStyle,
              showLine: false, yAxisID: 'y1', order: 1 },
            { type: 'scatter', label: 'Upper Quartile',
              data: termRows.map((r, i) => ({ x: i, y: r.upper_quartile_cap })),
              backgroundColor: PDF_COLORS.cap_long_term,
              borderColor: PDF_COLORS.cap_long_term,
              pointRadius: dotPointRadius, pointStyle: dotPointStyle,
              showLine: false, yAxisID: 'y1', order: 2 },
            { type: 'scatter', label: 'Lower Quartile',
              data: termRows.map((r, i) => ({ x: i, y: r.lower_quartile_cap })),
              backgroundColor: PDF_COLORS.cap_outside_firm,
              borderColor: PDF_COLORS.cap_outside_firm,
              pointRadius: dotPointRadius, pointStyle: dotPointStyle,
              showLine: false, yAxisID: 'y1', order: 3 },
            { type: 'scatter', label: 'Median',
              data: termRows.map((r, i) => ({ x: i, y: r.median_cap })),
              backgroundColor: PDF_COLORS.cap_mid_long,
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
            min: 0.04, max: 0.10,
            grid: { drawOnChartArea: false },
            ticks: {
              callback: function (v) { return (v * 100).toFixed(1) + '%'; },
              font: { size: 11 },
            },
          };
          opts.plugins = opts.plugins || {};
          opts.plugins.datalabels = {
            display: function (ctx) { return ctx.dataset.type === 'bar'; },
            color: PDF_COLORS.cap_short,
            font: { size: 11, weight: 'bold' },
            anchor: 'end',
            align: 'top',
            offset: 4,
            formatter: function (value, ctx) {
              return (ctx.dataset.priceLabels || [])[ctx.dataIndex] || '';
            },
          };
          return opts;
        })(),
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // Round 19 — Market Turnover + Inventory Backlog
    // ─────────────────────────────────────────────────────────────────

    case 'market_turnover': {
      // Single-line time series — turnover_rate (TTM sales / market universe).
      // Y-axis range adapts: gov data lands 1-3%, dia 20-30%, so use
      // auto-scaling with a friendly minimum.
      const data = rows.map(r => Number(r.turnover_rate));
      const finiteData = data.filter(v => Number.isFinite(v));
      const dataMax = finiteData.length ? Math.max(...finiteData) : 0.05;
      const yMax = dataMax > 0.10 ? Math.ceil(dataMax * 20) / 20 : 0.05;
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Turnover Rate (TTM)',
            data,
            borderColor: palette[0],
            backgroundColor: palette[3],
            fill: true,
            tension: 0.3, pointRadius: 0, borderWidth: 2.5,
          }],
        },
        options: (() => {
          const o = commonOpts({
            yAxisFormat: AXIS_FORMAT_PERCENT_1DP,
            yAxisRange: { min: 0, max: yMax },
          });
          const ann = buildAnnotations(rows, r => r.turnover_rate, fmtPct1);
          if (Object.keys(ann).length) o.plugins.annotation = { annotations: ann };
          return o;
        })(),
      };
    }

    case 'inventory_backlog': {
      // Combo: bars = active listings (left axis), line = months of supply
      // (right axis). For gov, historical bars are sparse until ~2024
      // when listing tracking became reliable; recent values are the
      // meaningful signal. For dia, both series are robust 2018+.
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Active Listings',
              data: rows.map(r => Number(r.active_count) || 0),
              backgroundColor: palette[3],         // pale fill
              borderColor: palette[1],             // sky border
              borderRadius: 1,
              yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Months of Supply',
              data: rows.map(r => r.months_of_supply != null ? Number(r.months_of_supply) : null),
              borderColor: palette[0],             // navy
              backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
          ],
        },
        options: (() => {
          const o = comboOpts({
            yLeftFormat:  AXIS_FORMAT_INTEGER,
            yRightFormat: AXIS_FORMAT_INTEGER,
          });
          // Right-axis tick suffix — months.
          o.scales.y1.ticks = o.scales.y1.ticks || {};
          o.scales.y1.ticks.callback = function (v) { return v + ' mo'; };
          // Annotate months-of-supply (the more interesting line).
          const ann = buildAnnotations(rows, r => r.months_of_supply, function (v) {
            return Number(v).toFixed(1) + ' mo';
          });
          for (const k of Object.keys(ann)) {
            ann[k].yScaleID = 'y1';
            ann[k].yAdjust  = -14;
          }
          if (Object.keys(ann).length) o.plugins.annotation = { annotations: ann };
          return o;
        })(),
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // Round 20 — PDF parity charts
    // ─────────────────────────────────────────────────────────────────

    case 'txn_count_avg_deal_combo': {
      // Master deck p.8 (dia) / p.17 (gov): bars = TTM transaction count
      // (left axis, integer); line = avg deal size (right axis, currency).
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'TTM Transactions',
              data: rows.map(r => Number(r.ttm_count) || 0),
              backgroundColor: palette[3],          // pale fill
              borderColor: palette[1],              // sky border
              borderRadius: 1,
              yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Avg Deal Size',
              data: rows.map(r => r.avg_deal_size != null ? Number(r.avg_deal_size) : null),
              borderColor: palette[0],              // navy
              backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
          ],
        },
        options: (() => {
          const o = comboOpts({
            yLeftFormat:  AXIS_FORMAT_INTEGER,
            yRightFormat: AXIS_FORMAT_CURRENCY_COMPACT,
          });
          // Annotate the navy avg-deal-size line.
          const ann = buildAnnotations(rows, r => r.avg_deal_size,
            function (v) { return '$' + (Number(v) / 1_000_000).toFixed(1) + 'M'; });
          for (const k of Object.keys(ann)) {
            ann[k].yScaleID = 'y1';
            ann[k].yAdjust  = -14;
          }
          if (Object.keys(ann).length) o.plugins.annotation = { annotations: ann };
          return o;
        })(),
      };
    }

    case 'rent_and_price_per_chair': {
      // Round 31 — Dialysis counterpart to gov rent_and_price_psf.
      // User: "Still missing the following charts: Rent & Price PSF"
      // (dia). Dialysis properties are measured by CHAIR count, not SF,
      // so the unit-econ axis is per-chair.
      //   Bars = Avg Rent / Chair  (left $, TTM rolling)
      //   Line = Avg Sold Price / Chair (right $, TTM rolling)
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Avg Rent / Chair (TTM)',
              data: rows.map(r => r.rent_per_chair != null ? Number(r.rent_per_chair) : null),
              backgroundColor: PDF_COLORS.cap_mid,
              borderColor: PDF_COLORS.cap_mid,
              borderRadius: 1,
              yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Avg Sale Price / Chair (TTM)',
              data: rows.map(r => r.price_per_chair != null ? Number(r.price_per_chair) : null),
              borderColor: palette[0],
              backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
          ],
        },
        options: (() => {
          const o = comboOpts({
            yLeftFormat:  AXIS_FORMAT_CURRENCY,    // $X,XXX (rent/chair)
            yRightFormat: AXIS_FORMAT_CURRENCY,    // $XXX,XXX (price/chair)
            yLeftRange:   { min: 0, max: 16000 },  // rent $0-$16K/chair
            yRightRange:  { min: 0, max: 250000 }, // price $0-$250K/chair
          });
          const ann = buildAnnotations(rows, r => r.price_per_chair,
            function (v) { return '$' + Math.round(v / 1000) + 'K'; });
          for (const k of Object.keys(ann)) {
            ann[k].yScaleID = 'y1';
            ann[k].yAdjust  = -14;
          }
          if (Object.keys(ann).length) o.plugins.annotation = { annotations: ann };
          return o;
        })(),
      };
    }

    case 'rent_and_price_psf': {
      // Master deck p.9 (gov): bars = rent PSF (left $), line = price PSF
      // (right $). Both TTM-rolling.
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Avg Rent / SF (TTM)',
              data: rows.map(r => r.rent_psf != null ? Number(r.rent_psf) : null),
              backgroundColor: PDF_COLORS.cap_mid,   // sky #62B5E5
              borderColor: PDF_COLORS.cap_mid,
              borderRadius: 1,
              yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Avg Sale Price / SF (TTM)',
              data: rows.map(r => r.price_psf != null ? Number(r.price_psf) : null),
              borderColor: palette[0],               // navy
              backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5,
              yAxisID: 'y1', order: 0 },
          ],
        },
        options: (() => {
          const o = comboOpts({
            yLeftFormat:  AXIS_FORMAT_CURRENCY,    // $XX (rent PSF)
            yRightFormat: AXIS_FORMAT_CURRENCY,    // $XXX (price PSF)
            yLeftRange:   { min: 0, max: 50 },     // rent $0-$50/SF
          });
          const ann = buildAnnotations(rows, r => r.price_psf,
            function (v) { return '$' + Math.round(v); });
          for (const k of Object.keys(ann)) {
            ann[k].yScaleID = 'y1';
            ann[k].yAdjust  = -14;
          }
          if (Object.keys(ann).length) o.plugins.annotation = { annotations: ann };
          return o;
        })(),
      };
    }

    case 'asking_cap_by_term_dot_plot':
    case 'sold_cap_by_term_dot_plot': {
      // Round 30 — User redefined: "four distinct lines of rolling TTM
      // monthly averages by lease term bucket." Replaces the Round 28
      // scatter dot-plot (wrong execution).
      // Round 31 — asking_cap_by_term_dot_plot (NEW active-listings
      // counterpart) shares the same 4-line cohort renderer. Dia uses
      // the same column shape (cap_12plus / cap_8to12 / cap_6to8 /
      // cap_5orless). Gov asking version deferred (no historical
      // active-listing data; only the sold version applies for gov).
      //   Gov cohorts: 10+ / 6-10 / <5 / Outside Firm
      //   Dia cohorts: 12+ / 8-12 / 6-8 / ≤5
      const hasDialysisCohorts = rows.some(r =>
        r.cap_12plus != null || r.cap_8to12 != null ||
        r.cap_6to8 != null  || r.cap_5orless != null
      );
      const datasets = hasDialysisCohorts ? [
        { label: '12+ Year',  data: rows.map(r => r.cap_12plus),
          borderColor: PDF_COLORS.cap_long_term, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2.5 },
        { label: '8-12 Year', data: rows.map(r => r.cap_8to12),
          borderColor: PDF_COLORS.cap_mid_long, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2 },
        { label: '6-8 Year',  data: rows.map(r => r.cap_6to8),
          borderColor: PDF_COLORS.cap_mid, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2 },
        { label: '≤5 Year',   data: rows.map(r => r.cap_5orless),
          borderColor: PDF_COLORS.cap_short, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2 },
      ] : [
        { label: '10+ Year',     data: rows.map(r => r.cap_10plus),
          borderColor: PDF_COLORS.cap_long_term, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2.5 },
        { label: '6-10 Year',    data: rows.map(r => r.cap_5to10),
          borderColor: PDF_COLORS.cap_mid_long, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2 },
        { label: '< 5 Year',     data: rows.map(r => r.cap_less5),
          borderColor: PDF_COLORS.cap_short, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 2 },
        { label: 'Outside Firm', data: rows.map(r => r.cap_outside_firm),
          borderColor: PDF_COLORS.cap_outside_firm, backgroundColor: 'transparent',
          stepped: 'before', pointRadius: 0, borderWidth: 1.5, borderDash: [3,3] },
      ];
      return {
        type: 'line',
        data: { labels, datasets },
        options: commonOpts({
          yAxisFormat: AXIS_FORMAT_PERCENT_2DP,
          yAxisRange:  { min: 0.04, max: 0.11 },
        }),
      };
    }

    case 'sold_cap_by_term_dot_plot_OLD_DEPRECATED_R30': {
      // Round 30 — superseded: see new case below. User redefined chart
      // as 4-line TTM cohort time series (not a scatter).
      const allDots = rows
        .filter(r => r.cap_rate != null && r.firm_term_years != null)
        .map(r => ({
          x: Number(r.firm_term_years),
          y: Number(r.cap_rate),
          nm: !!r.is_northmarq,
        }));
      const xs = allDots.map(d => d.x);
      const xMinData = xs.length ? Math.min(...xs) : 0;
      const xMaxData = xs.length ? Math.max(...xs) : 20;
      const pad = Math.max(1, (xMaxData - xMinData) * 0.10);
      const xMin = Math.max(0, Math.floor(xMinData - pad));
      const xMax = Math.min(30, Math.ceil(xMaxData + pad));
      // Least-squares regression
      const n = allDots.length;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const d of allDots) { sx += d.x; sy += d.y; sxx += d.x * d.x; sxy += d.x * d.y; }
      const denom = (n * sxx - sx * sx);
      const m = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
      const b = (sy - m * sx) / Math.max(n, 1);
      const trendData = [
        { x: xMin, y: m * xMin + b },
        { x: xMax, y: m * xMax + b },
      ];
      return {
        type: 'scatter',
        data: {
          datasets: [
            { label: 'Closed sales (last 5 yr)',
              data: allDots,
              backgroundColor: 'rgba(98,181,229,0.55)',
              borderColor: PDF_COLORS.cap_mid,
              pointRadius: 4, pointStyle: 'circle',
              showLine: false, order: 1 },
            { label: 'Linear Trendline',
              data: trendData, type: 'line',
              borderColor: PDF_COLORS.cap_short,
              backgroundColor: 'transparent',
              borderDash: [6, 4], borderWidth: 2, pointRadius: 0,
              showLine: true, order: 0 },
          ],
        },
        options: (() => {
          const o = commonOpts({ yAxisFormat: AXIS_FORMAT_PERCENT_2DP, yAxisRange: { min: 0.04, max: 0.12 } });
          o.scales.x = {
            type: 'linear', position: 'bottom', min: xMin, max: xMax,
            title: { display: true, text: 'Firm Lease Term Remaining at Sale (Years)',
                     color: '#6A748C', font: { family: 'Calibri', size: 10 } },
            ticks: { color: '#6A748C', font: { family: 'Calibri', size: 9 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
          };
          return o;
        })(),
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

  // Round 7 — QuickChart only evaluates JavaScript functions in the
  // chart config when `chart` is sent as a STRING containing JS-literal
  // syntax (not a JSON object). JSON-with-function-text-strings doesn't
  // work — they're treated as plain strings. Confirmed empirically:
  // donut formatter outputting `$136.7M` works via string-mode but not
  // via JSON-mode with stringified functions.
  //
  // Build the chart as a JS-literal expression string. Helper jsLiteral()
  // emits objects with unquoted keys (where valid), preserves function
  // source verbatim, handles arrays/scalars correctly.
  const jsLiteralChart = jsLiteral(config);
  try {
    const r = await fetch(QUICKCHART_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        // Pin Chart.js v4 — required for `ticks.format` Intl.NumberFormat
        // support. v3 (the default on free tier) doesn't render currency /
        // percent / compact-notation tick labels via the format option.
        version: '4',
        width:  width  || RENDER_DEFAULT_WIDTH,
        height: height || RENDER_DEFAULT_HEIGHT,
        format: 'png',
        backgroundColor: '#FFFFFF',
        chart: jsLiteralChart,
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
