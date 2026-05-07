// ============================================================================
// Capital Markets — Chart-image renderer (server-side PNG via QuickChart)
// Life Command Center
//
// ExcelJS doesn't support creating chart objects from scratch; the existing
// MasterPasteReady workflow gets visible charts via paste-into-master. For
// users without a master XLSX, this module renders PNG images via QuickChart
// (https://quickchart.io) and the export pipeline embeds them on a single
// consolidated "Charts" tab.
//
// Trade-offs documented in the cover sheet when the feature is enabled:
//   1. External dependency on quickchart.io (or self-hosted instance)
//   2. Proprietary data (cap rates, volumes) flows to the rendering service
//   3. Render latency: ~500ms per chart, parallelized via Promise.all
//
// The user can self-host QuickChart via Docker and point at it via the
// CM_QUICKCHART_URL env var; default is the public service.
//
// Feature flag: process.env.CM_EXPORT_NATIVE_CHARTS = 'true' to enable.
// Default behaviour is unchanged — workbook ships data tabs only.
//
// Marquee chart set
// ─────────────────
// First-pass coverage targets the deliverable PDF's 6 most-cited charts:
//   - Volume TTM by Quarter
//   - Cap Rate TTM by Quarter
//   - NM vs Market Cap
//   - YoY Volume Change
//   - DOM + % of Ask
//   - Buyer Class % by Year
//
// Follow-up PRs can extend buildChartConfig() to cover additional templates.
// ============================================================================

const QUICKCHART_URL =
  process.env.CM_QUICKCHART_URL || 'https://quickchart.io/chart';

const RENDER_DEFAULT_WIDTH  = 900;
const RENDER_DEFAULT_HEIGHT = 480;
const RENDER_TIMEOUT_MS     = 15_000;

// Brand-aligned series colors (hex strings without the leading '#').
function paletteSeries(brand) {
  const p = brand?.palette || {};
  return [
    p.nm_navy     || '#003DA5',
    p.nm_sky      || '#62B5E5',
    p.nm_blue_mid || '#265AB2',
    p.nm_pale     || '#E0E8F4',
    p.nm_axis     || '#6A748C',
    p.nm_text     || '#191919',
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

function commonOpts(yLabelCallback) {
  return {
    responsive: false,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: '#191919', font: { family: 'Calibri', size: 11 } },
      },
    },
    scales: {
      x: {
        ticks: { color: '#6A748C', font: { family: 'Calibri', size: 9 } },
        grid:  { display: false },
      },
      y: {
        ticks: {
          color: '#6A748C',
          font: { family: 'Calibri', size: 9 },
          ...(yLabelCallback ? { callback: yLabelCallback } : {}),
        },
        grid: { color: '#E7E6E6' },
      },
    },
  };
}

// ============================================================================
// Per-template Chart.js v3 config builders
// ============================================================================
//
// Each builder returns a JSON-serializable Chart.js config or null if the
// template isn't supported yet. Mirrors the dashboard's buildChart switch
// in capital-markets.js — but produces a config object rather than a Chart
// instance.

function buildChartConfig(chart, brand) {
  if (!chart || !chart.rows || chart.rows.length === 0) return null;
  const palette = paletteSeries(brand);
  const labels = chart.rows.map(r => periodEndLabel(r.period_end || r.year));

  switch (chart.chart_template_id) {
    case 'volume_ttm_by_quarter': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'TTM Volume',
            data: chart.rows.map(r => r.volume_dollars),
            borderColor: palette[0],
            backgroundColor: palette[3],
            fill: true,
            tension: 0.25,
            pointRadius: 0,
          }],
        },
        options: {
          ...commonOpts(),
          scales: {
            ...commonOpts().scales,
            y: {
              ...commonOpts().scales.y,
              ticks: {
                ...commonOpts().scales.y.ticks,
                callback: 'function(v) { return "$" + (v/1e9).toFixed(2) + "B"; }',
              },
            },
          },
        },
      };
    }

    case 'cap_rate_ttm_by_quarter': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Avg Cap Rate (TTM, weighted)',
            data: chart.rows.map(r => r.ttm_weighted_cap_rate),
            borderColor: palette[0],
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2.5,
          }],
        },
        options: commonOpts('function(v){return (v*100).toFixed(2)+"%"}'),
      };
    }

    case 'nm_vs_market_cap': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'NM Cap Rate',     data: chart.rows.map(r => r.nm_cap_rate),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Market Cap Rate', data: chart.rows.map(r => r.market_cap_rate),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: commonOpts('function(v){return (v*100).toFixed(2)+"%"}'),
      };
    }

    case 'yoy_volume_change': {
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'YoY Change %',
            data: chart.rows.map(r => r.yoy_change_pct),
            backgroundColor: chart.rows.map(r =>
              (r.yoy_change_pct >= 0 ? palette[0] : palette[2])
            ),
            borderRadius: 2,
          }],
        },
        options: commonOpts('function(v){return (v*100).toFixed(0)+"%"}'),
      };
    }

    case 'dom_and_pct_of_ask': {
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar',  label: 'Avg Days on Market',
              data: chart.rows.map(r => r.avg_dom),
              backgroundColor: palette[3], borderRadius: 2, yAxisID: 'y' },
            { type: 'line', label: '% of Ask Price',
              data: chart.rows.map(r => r.pct_of_ask),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 2, borderWidth: 2.5, yAxisID: 'y1' },
          ],
        },
        options: {
          ...commonOpts(),
          scales: {
            ...commonOpts().scales,
            y1: {
              position: 'right',
              ticks: {
                color: '#6A748C',
                font: { family: 'Calibri', size: 9 },
                callback: 'function(v){return (v*100).toFixed(1)+"%"}',
              },
              grid: { display: false },
            },
          },
        },
      };
    }

    case 'transaction_count_ttm': {
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'TTM Transactions',
            data: chart.rows.map(r => r.ttm_count ?? r.count),
            backgroundColor: palette[0],
            borderRadius: 2,
          }],
        },
        options: commonOpts('function(v){return Math.round(v).toLocaleString()}'),
      };
    }

    case 'avg_deal_size': {
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Avg Deal Size',
            data: chart.rows.map(r => r.avg_deal_size),
            backgroundColor: palette[1],
            borderRadius: 2,
          }],
        },
        options: commonOpts('function(v){return "$"+(v/1e6).toFixed(1)+"M"}'),
      };
    }

    case 'cap_rate_top_bottom_quartile': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Top Quartile',    data: chart.rows.map(r => r.top_quartile),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: 'Median',          data: chart.rows.map(r => r.median),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Bottom Quartile', data: chart.rows.map(r => r.bottom_quartile),
              borderColor: palette[3], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: commonOpts('function(v){return (v*100).toFixed(2)+"%"}'),
      };
    }

    case 'cap_rate_by_lease_term': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: '10+ Year',       data: chart.rows.map(r => r.cap_10plus),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: '6-10 Year',      data: chart.rows.map(r => r.cap_6to10),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: '< 5 Year',       data: chart.rows.map(r => r.cap_less5),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: 'Outside Firm',   data: chart.rows.map(r => r.cap_outside_firm),
              borderColor: palette[4], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [3, 3] },
          ],
        },
        options: commonOpts('function(v){return (v*100).toFixed(2)+"%"}'),
      };
    }

    case 'bid_ask_spread':
    case 'bid_ask_spread_monthly': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Bid-Ask Spread (bps)',
            data: chart.rows.map(r => r.avg_bid_ask_spread),
            borderColor: palette[0],
            backgroundColor: palette[3],
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2,
          }],
        },
        options: commonOpts('function(v){return (v*100).toFixed(2)+"%"}'),
      };
    }

    case 'seller_sentiment':
    case 'seller_sentiment_monthly': {
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar',  label: 'Price Change %',
              data: chart.rows.map(r => r.pct_price_change_all),
              backgroundColor: palette[0], borderRadius: 1, yAxisID: 'y' },
            { type: 'bar',  label: '8+ Yr Term Price Change %',
              data: chart.rows.map(r => r.pct_price_change_long_term),
              backgroundColor: palette[1], borderRadius: 1, yAxisID: 'y' },
            { type: 'line', label: 'Last Asking Cap (all)',
              data: chart.rows.map(r => r.last_ask_cap_all),
              borderColor: palette[4], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1.5, yAxisID: 'y1' },
            { type: 'line', label: 'Last Asking Cap (8+ yr)',
              data: chart.rows.map(r => r.last_ask_cap_long_term),
              borderColor: palette[2], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1.5, yAxisID: 'y1' },
          ],
        },
        options: {
          ...commonOpts('function(v){return (v*100).toFixed(1)+"%"}'),
          scales: {
            ...commonOpts().scales,
            y1: {
              position: 'right',
              ticks: {
                color: '#6A748C', font: { family: 'Calibri', size: 9 },
                callback: 'function(v){return (v*100).toFixed(2)+"%"}',
              },
              grid: { display: false },
            },
          },
        },
      };
    }

    case 'valuation_index': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Valuation Index',
            data: chart.rows.map(r => r.valuation_index),
            borderColor: palette[0],
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2.5,
          }],
        },
        options: commonOpts('function(v){return Number(v).toFixed(0)}'),
      };
    }

    case 'cost_of_capital': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: '10Y Treasury',
              data: chart.rows.map(r => r.treasury_10y_yield),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Avg Cap Rate (TTM)',
              data: chart.rows.map(r => r.avg_cap_rate),
              borderColor: palette[3], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: '10+ Year Cap',
              data: chart.rows.map(r => r.cap_10plus_year),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Low Loan Constant',
              data: chart.rows.map(r => r.low_loan_constant),
              borderColor: palette[4], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1, borderDash: [3, 3] },
            { label: 'High Loan Constant',
              data: chart.rows.map(r => r.high_loan_constant),
              borderColor: palette[4], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 1, borderDash: [3, 3] },
          ],
        },
        options: commonOpts('function(v){return (v*100).toFixed(1)+"%"}'),
      };
    }

    case 'cash_leveraged_returns': {
      return {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Cash Return Index',
              data: chart.rows.map(r => r.cash_return),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
            { label: 'Leveraged Return (mid)',
              data: chart.rows.map(r => r.leveraged_return_mid),
              borderColor: palette[1], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: commonOpts('function(v){return (v*100).toFixed(1)+"%"}'),
      };
    }

    case 'dom_and_pct_of_ask_monthly': {
      // Same shape as quarterly version, just monthly anchors. Re-use the
      // quarterly chart's case body.
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar',  label: 'Avg Days on Market',
              data: chart.rows.map(r => r.avg_dom),
              backgroundColor: palette[3], borderRadius: 2, yAxisID: 'y' },
            { type: 'line', label: '% of Ask Price',
              data: chart.rows.map(r => r.pct_of_ask),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 1, borderWidth: 2.5, yAxisID: 'y1' },
          ],
        },
        options: {
          ...commonOpts(),
          scales: {
            ...commonOpts().scales,
            y1: {
              position: 'right',
              ticks: {
                color: '#6A748C', font: { family: 'Calibri', size: 9 },
                callback: 'function(v){return (v*100).toFixed(1)+"%"}',
              },
              grid: { display: false },
            },
          },
        },
      };
    }

    case 'buyer_class_pct_by_year': {
      const yearLabels = chart.rows.map(r => String(r.year));
      return {
        type: 'bar',
        data: {
          labels: yearLabels,
          datasets: [
            { label: 'Private',       data: chart.rows.map(r => r.private_pct),
              backgroundColor: palette[0], stack: 'pool' },
            { label: 'Public REITs',  data: chart.rows.map(r => r.reit_pct),
              backgroundColor: palette[2], stack: 'pool' },
            { label: 'Cross-Border',  data: chart.rows.map(r => r.cross_border_pct),
              backgroundColor: palette[1], stack: 'pool' },
            { label: 'Institutional', data: chart.rows.map(r => r.institutional_pct),
              backgroundColor: palette[3], stack: 'pool' },
          ],
        },
        options: {
          ...commonOpts('function(v){return Math.round(v*100)+"%"}'),
          scales: {
            ...commonOpts().scales,
            x: { ...commonOpts().scales.x, stacked: true },
            y: {
              ...commonOpts().scales.y,
              stacked: true,
              max: 1.0,
              ticks: {
                ...commonOpts().scales.y.ticks,
                callback: 'function(v){return Math.round(v*100)+"%"}',
              },
            },
          },
        },
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
 * Render the marquee chart set to PNG buffers. Returns an array of
 * { chart_template_id, name, png } objects, skipping any that fail to render.
 * Promise.all parallelizes; the QuickChart public service handles 30+
 * concurrent requests reliably.
 *
 * Time budget at default settings: ~1-2s for 6 charts on the public service.
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
      // Per-chart graceful degradation: log + skip
      console.warn(
        `[cm-chart-image-renderer] ${chart.chart_template_id} failed: ${e?.message || e}`
      );
      return null;
    }
  });
  const results = await Promise.all(tasks);
  return results.filter(Boolean);
}

export const NATIVE_CHARTS_FEATURE_FLAG =
  process.env.CM_EXPORT_NATIVE_CHARTS === 'true';

export const QUICKCHART_URL_FOR_DEBUG = QUICKCHART_URL;
