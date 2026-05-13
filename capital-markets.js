// ============================================================================
// Capital Markets — LCC frontend module
// Phase 1 (gov slice): renders the Capital Markets dashboard for the
// Government tab. Sources data from /api/capital-markets and styles charts
// using cm_brand_tokens (Northmarq palette + Calibri).
//
// Hooks into the existing gov tab router via case 'capital-markets'. Same
// pattern will extend to dia tab once Phase 1 dialysis views land.
// ============================================================================

(function () {
  'use strict';

  // ---- State -----------------------------------------------------------------
  const cmState = {
    brand: null,                  // brand tokens cache
    catalog: null,                // chart catalog cache
    subspecialties: { gov: [], dialysis: [] },
    currentVertical: 'gov',
    currentSubspecialty: 'all',
    chartInstances: new Map(),    // chart_template_id → Chart.js instance
  };
  window.__cmState = cmState;     // expose for debugging

  // Chart templates we render (in display order). After Phase 2b parity work,
  // this includes the 4 new dashboard parity charts that match the gov 2024-Q2
  // deliverable PDF.
  const PHASE_1_TEMPLATES = [
    'valuation_index',             // Phase 2c.3 — deliverable p.10 (headline index)
    'volume_ttm_by_quarter',
    'yoy_volume_change',           // Phase 2b — deliverable p.14
    'cap_rate_ttm_by_quarter',
    'nm_vs_market_cap',
    'transaction_count_ttm',
    'avg_deal_size',
    'cap_rate_top_bottom_quartile',
    'cap_rate_by_lease_term',
    'cap_rate_by_credit',
    'buyer_class_pct_by_year',     // Phase 2b — deliverable p.20
    'dom_and_pct_of_ask',          // Phase 2b — deliverable p.22
    'bid_ask_spread',              // Phase 2b — deliverable p.23
    'fed_funds_vs_treasury',       // Phase 2c — deliverable p.11 (macro context)
    'cost_of_capital',             // Phase 2c — deliverable p.15 (now with loan-constants band)
    'cash_leveraged_returns',      // Phase 2c.2 — deliverable p.16
    'net_lease_spread',            // Phase 2c — deliverable p.11
    'seller_sentiment',            // Phase 2c.2 — deliverable p.22
    'sources_of_capital',          // Phase 2c.2 — deliverable p.19 (table form for V1)
    // ===== Section 2: Leasing Trends (Phase 2c.4) =====
    'leased_inventory_by_state',   // p.26 state map; ranked table
    'leasing_summary',             // p.27 CQ/TTM/5yr summary table
    'lease_structures',            // p.27 most common term buckets
    'lease_renewal_rate',          // p.28 5-series quarterly bars
    'lease_termination_rate',      // p.29 firm/non-firm + termination %
    'rent_by_year_built',          // p.30 quartile range by year_built
    'case_for_renewal',            // p.31 commencements + avg rent line
    'renewal_rent_growth',         // p.32a renewal rent + CAGR
    'cpi_vs_renewal_cagr',         // p.32b CPI vs CAGR
    'rent_heat_map',               // p.33 state map; ranked table
    // ===== Parity-1 — period summary tables =====
    'volume_cap_summary_table',    // 4 metrics × 7 cols (current Q + prior Q + YoY + cycle + 5/10/15-yr avg)
    // ===== Parity-1 — front-cover combo =====
    'volume_cap_quartile_combo',   // gov p.6/7/8/13, dia p.19, ST workbook — Volume area + Cap line + Quartile band
    // ===== Tier 4 — KPI tile blocks =====
    'value_proposition_results',   // gov p.38 / dia p.38 — 3-tile NOI + Cap + Price (NM vs Non-NM)
    'whatsnew_quarter_kpis',       // dia p.3 — 3-tile front-of-deck headline KPIs (TTM Vol YoY, Cap, 10Y Treasury)
    // ===== Phase 5 — Inventory Analysis (dia p.29-35) =====
    'inventory_snapshot_kpis',     // dia p.29 — 8-tile × 2-cohort KPI snapshot
    'available_market_size_combo', // dia p.30 top — count bars + avg-cap line, 2 cohorts
    'available_by_term_bucket',    // dia p.30 bottom — 4-bucket cross-section table
    'asking_cap_quartiles_active', // dia p.31 top — upper/lower quartile cap, 2 cohorts (4 lines)
    'dom_price_change_active',     // dia p.31 bottom — DOM bars + price-change% lines, 2 cohorts
    'available_by_tenant',         // dia p.32 — per-tenant rollup table
    // ===== Phase 6 — Monthly TTM (dia p.33-35; dialysis-only cadence) =====
    'dom_and_pct_of_ask_monthly',  // dia p.33 — DOM + % of Ask, monthly TTM
    'bid_ask_spread_monthly',      // dia p.34 — Bid-Ask Spread, monthly TTM
    'seller_sentiment_monthly',    // dia p.35 — Seller Sentiment, monthly TTM
    // ===== Lease-rent distribution (StockChart-style box) =====
    'rent_psf_box_quarterly',      // 5-line min/Q1/median/Q3/max box per quarter
  ];

  // ---- Brand-token helpers ---------------------------------------------------
  function brandColor(token, fallback) {
    return cmState.brand?.palette?.[token] || fallback;
  }

  const SERIES_COLORS = () => [
    brandColor('nm_navy',     '#003DA5'),
    brandColor('nm_sky',      '#62B5E5'),
    brandColor('nm_blue_mid', '#265AB2'),
    brandColor('nm_pale',     '#E0E8F4'),
    brandColor('nm_axis',     '#6A748C'),
    '#000000',
  ];

  // Minimal Excel→JS number-format → Chart.js tick callback mapping
  function tickFormatterFor(yFormatToken) {
    switch (yFormatToken) {
      case 'currency_billions':
        return (v) => v == null ? '' : '$' + (v / 1e9).toFixed(2) + 'B';
      case 'currency_millions':
        return (v) => v == null ? '' : '$' + (v / 1e6).toFixed(1) + 'M';
      case 'currency_per_sf':
        return (v) => v == null ? '' : '$' + Number(v).toFixed(2);
      case 'percent_basis_points':
        return (v) => v == null ? '' : (Number(v) * 100).toFixed(2) + '%';
      case 'percent_one_decimal':
        return (v) => v == null ? '' : (Number(v) * 100).toFixed(1) + '%';
      case 'percent_zero_decimal':
        return (v) => v == null ? '' : Math.round(Number(v) * 100) + '%';
      case 'integer_count':
        return (v) => v == null ? '' : Number(v).toLocaleString();
      default:
        return (v) => v == null ? '' : Number(v).toLocaleString();
    }
  }

  // Quarter-anchored labels: "Q1 '25". Used for time_series_quarterly_*.
  function periodEndLabel(d) {
    if (!d) return '';
    const dt = new Date(d);
    const m = dt.getUTCMonth();
    const y = dt.getUTCFullYear();
    const q = Math.floor(m / 3) + 1;
    return `Q${q} '${String(y).slice(2)}`;
  }

  // Month-anchored labels: "Jan '25". Used for time_series_monthly_* templates.
  const MONTH_ABBREV = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function periodEndLabelMonthly(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${MONTH_ABBREV[dt.getUTCMonth()]} '${String(dt.getUTCFullYear()).slice(2)}`;
  }

  // Pick the right label function from a chart's data_shape / cadence.
  function labelForChart(chart) {
    const shape = String(chart?.data_shape || '').toLowerCase();
    if (chart?.cadence === 'monthly' || shape.includes('monthly')) return periodEndLabelMonthly;
    return periodEndLabel;
  }

  // ---- Data fetching ---------------------------------------------------------
  async function fetchJSON(path) {
    const r = await fetch(path, {
      credentials: 'include',
      headers: {
        'x-lcc-workspace': window.LCC?.workspaceId || '',
      },
    });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
  }

  async function loadBrand() {
    if (cmState.brand) return cmState.brand;
    const r = await fetchJSON('/api/capital-markets?action=brand');
    cmState.brand = r.tokens || {};
    return cmState.brand;
  }

  async function loadCatalog() {
    if (cmState.catalog) return cmState.catalog;
    const r = await fetchJSON('/api/capital-markets?action=catalog&phase=5');
    cmState.catalog = r.chart_templates || [];
    return cmState.catalog;
  }

  async function loadSubspecialties(vertical) {
    if (cmState.subspecialties[vertical]?.length) return cmState.subspecialties[vertical];
    const r = await fetchJSON(`/api/capital-markets?action=subspecialties&vertical_id=${vertical}`);
    cmState.subspecialties[vertical] = r.subspecialties || [];
    return cmState.subspecialties[vertical];
  }

  async function loadQuarterly(vertical, subspecialty) {
    const r = await fetchJSON(
      `/api/capital-markets?action=quarterly&vertical=${vertical}&subspecialty=${encodeURIComponent(subspecialty)}&phase=5`
    );
    return r.charts || [];
  }

  // ---- Chart builders --------------------------------------------------------
  function destroyChart(templateId) {
    const c = cmState.chartInstances.get(templateId);
    if (c) { try { c.destroy(); } catch {} cmState.chartInstances.delete(templateId); }
  }

  function commonChartOptions(yFormat) {
    const axisColor = brandColor('nm_axis', '#6A748C');
    const textColor = brandColor('nm_text', '#191919');
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: textColor, font: { family: 'Calibri, sans-serif', size: 11 } },
        },
        tooltip: {
          backgroundColor: textColor,
          titleColor: '#FFFFFF',
          bodyColor: '#FFFFFF',
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${tickFormatterFor(yFormat)(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: axisColor, font: { family: 'Calibri, sans-serif', size: 9 } },
          grid:  { display: false },
        },
        y: {
          ticks: {
            color: axisColor,
            font: { family: 'Calibri, sans-serif', size: 9 },
            callback: tickFormatterFor(yFormat),
          },
          grid: { color: brandColor('nm_bg_alt', '#E7E6E6') },
        },
      },
    };
  }

  function buildChart(canvas, chart) {
    if (!canvas || !window.Chart) return;
    const palette = SERIES_COLORS();
    const labelFn = labelForChart(chart);
    const labels = (chart.rows || []).map(r => labelFn(r.period_end));
    let datasets = [];

    switch (chart.chart_template_id) {
      case 'valuation_index': {
        // Round 27 — mirrors Round 20+24 server combo: sky/amber YoY%
        // bars on right axis + navy index line on left. Round 24
        // auto-fit right-axis range ±max(yoy_change)+10% padding.
        const navy = brandColor('nm_navy', '#003DA5');
        const yoyValues = chart.rows.map(r => r.yoy_change_pct ?? r.yoy_change ?? null);
        const yoyMag = yoyValues
          .map(v => v == null ? 0 : Math.abs(Number(v)))
          .reduce((a, b) => Math.max(a, b), 0);
        const yoyMax = Math.max(0.05, Math.ceil(yoyMag * 11) / 10);
        datasets = [
          { type: 'bar', label: 'YoY % Change',
            data: yoyValues,
            backgroundColor: yoyValues.map((v) =>
              (v != null && v < 0) ? 'rgba(217,119,6,0.55)' : 'rgba(98,181,229,0.55)'),
            borderRadius: 1, yAxisID: 'y1', order: 2 },
          { type: 'line', label: 'Valuation Index',
            data: chart.rows.map(r => r.valuation_index),
            borderColor: navy, backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5,
            yAxisID: 'y', order: 0 },
        ];
        const opts = commonChartOptions('integer_count');
        opts.scales.y.ticks.callback = (v) => '$' + Number(v).toFixed(0);
        opts.scales.y1 = { type: 'linear', position: 'right',
          min: -yoyMax, max: yoyMax,
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => (v * 100).toFixed(1) + '%',
                   color: brandColor('nm_axis','#6A748C'),
                   font: { family: 'Calibri', size: 9 } } };
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }
      case 'volume_ttm_by_quarter': {
        datasets = [{
          label: 'TTM Volume',
          data: chart.rows.map(r => r.volume_dollars),
          borderColor: palette[0],
          backgroundColor: palette[3],
          fill: true,
          tension: 0.25,
          pointRadius: 0,
        }];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('currency_billions') });
      }
      case 'volume_cap_quartile_combo': {
        // Front-cover combo (gov p.6/7/8/13, dia p.19, ST workbook): TTM volume
        // area on left axis ($) + upper/lower quartile cap band + TTM cap line
        // on right axis (%). Dataset order matters because the fill reference
        // is index-based — upper quartile fills DOWN to lower quartile (index +1).
        const navy   = brandColor('nm_navy', '#003DA5');
        const sky    = brandColor('nm_sky',  '#62B5E5');
        const pale   = brandColor('nm_pale', '#E0E8F4');
        const muted  = brandColor('nm_axis', '#6A748C');
        const textColor = brandColor('nm_text', '#191919');

        datasets = [
          {
            label: 'TTM Volume',
            data: chart.rows.map(r => r.volume_dollars),
            borderColor: navy,
            backgroundColor: pale,
            fill: 'origin',
            tension: 0.25,
            pointRadius: 0,
            yAxisID: 'y_volume',
            order: 3,  // draw under cap-rate lines
          },
          {
            label: 'Upper Quartile Cap',
            data: chart.rows.map(r => r.upper_quartile),
            borderColor: sky,
            backgroundColor: 'rgba(98, 181, 229, 0.18)',  // sky @ 18%
            fill: '+1',  // fill DOWN to next series (lower quartile)
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1,
            borderDash: [4, 4],
            yAxisID: 'y_cap',
            order: 2,
            spanGaps: true,
          },
          {
            label: 'Lower Quartile Cap',
            data: chart.rows.map(r => r.lower_quartile),
            borderColor: sky,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1,
            borderDash: [4, 4],
            yAxisID: 'y_cap',
            order: 2,
            spanGaps: true,
          },
          {
            label: 'TTM Cap (avg)',
            data: chart.rows.map(r => r.cap_rate),
            borderColor: navy,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            pointBackgroundColor: navy,
            borderWidth: 2,
            yAxisID: 'y_cap',
            order: 1,  // draw on top
            spanGaps: true,
          },
        ];

        const opts = commonChartOptions('currency_billions');
        // Replace the single y-axis with dual axes
        opts.scales = {
          x: opts.scales.x,
          y_volume: {
            position: 'left',
            ticks: {
              color: muted,
              font: { family: 'Calibri, sans-serif', size: 9 },
              callback: tickFormatterFor('currency_billions'),
            },
            grid: { color: brandColor('nm_bg_alt', '#E7E6E6') },
            title: {
              display: true, text: 'TTM Volume ($)',
              color: muted, font: { family: 'Calibri, sans-serif', size: 9, weight: '600' },
            },
          },
          y_cap: {
            position: 'right',
            ticks: {
              color: muted,
              font: { family: 'Calibri, sans-serif', size: 9 },
              callback: tickFormatterFor('percent_basis_points'),
            },
            grid: { display: false },
            title: {
              display: true, text: 'Cap Rate',
              color: muted, font: { family: 'Calibri, sans-serif', size: 9, weight: '600' },
            },
          },
        };
        // Dual-axis tooltip: format per-series
        opts.plugins.tooltip.callbacks.label = (ctx) => {
          const v = ctx.parsed.y;
          if (v == null) return `${ctx.dataset.label}: n/a`;
          if (ctx.dataset.yAxisID === 'y_volume') {
            return `${ctx.dataset.label}: ${tickFormatterFor('currency_billions')(v)}`;
          }
          return `${ctx.dataset.label}: ${tickFormatterFor('percent_basis_points')(v)}`;
        };
        return new Chart(canvas, { type: 'line', data: { labels, datasets }, options: opts });
      }
      case 'transaction_count_ttm': {
        datasets = [{
          label: 'TTM Transactions',
          data: chart.rows.map(r => r.ttm_count),
          backgroundColor: palette[0],
          borderRadius: 2,
        }];
        return new Chart(canvas, { type: 'bar', data: { labels, datasets },
          options: commonChartOptions('integer_count') });
      }
      case 'cap_rate_ttm_by_quarter': {
        datasets = [{
          label: 'Avg Cap Rate',
          data: chart.rows.map(r => r.ttm_weighted_cap_rate),
          borderColor: palette[0],
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        }];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_basis_points') });
      }
      case 'cap_rate_top_bottom_quartile': {
        datasets = [
          { label: 'Top Quartile', data: chart.rows.map(r => r.top_quartile),
            borderColor: palette[1], backgroundColor: 'transparent', tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [6,3] },
          { label: 'Median',       data: chart.rows.map(r => r.median),
            borderColor: palette[0], backgroundColor: 'transparent', tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: 'Bottom Quartile', data: chart.rows.map(r => r.bottom_quartile),
            borderColor: palette[2], backgroundColor: 'transparent', tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [6,3] },
        ];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_basis_points') });
      }
      case 'nm_vs_market_cap': {
        // Round 31 Tier 2 — Labels + y-axis pinned to match master
        // ("NM Average Cap (TTM)" / "Non-NM Average Cap (TTM)";
        // y range 5.25-9.25%).
        datasets = [
          { label: 'NM Average Cap (TTM)', data: chart.rows.map(r => r.nm_cap_rate),
            borderColor: palette[0], backgroundColor: 'transparent', tension: 0.25, pointRadius: 3, pointBackgroundColor: palette[0], borderWidth: 2.5 },
          { label: 'Non-NM Average Cap (TTM)', data: chart.rows.map(r => r.market_cap_rate),
            borderColor: palette[1], backgroundColor: 'transparent', tension: 0.25, pointRadius: 3, pointBackgroundColor: palette[1], borderWidth: 2.5 },
        ];
        const opts = commonChartOptions('percent_basis_points');
        opts.scales.y.min = 0.0525; opts.scales.y.max = 0.0925;
        return new Chart(canvas, { type: 'line', data: { labels, datasets }, options: opts });
      }
      case 'avg_deal_size': {
        datasets = [{
          label: 'Avg Deal Size',
          data: chart.rows.map(r => r.avg_deal_size),
          backgroundColor: palette[0],
          borderRadius: 2,
        }];
        return new Chart(canvas, { type: 'bar', data: { labels, datasets },
          options: commonChartOptions('currency_millions') });
      }
      case 'cap_rate_by_lease_term': {
        datasets = [
          { label: '10+ Year', data: chart.rows.map(r => r.cap_10plus),
            borderColor: palette[0], tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: '6–10 Year', data: chart.rows.map(r => r.cap_6to10),
            borderColor: palette[1], tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: '<5 Year', data: chart.rows.map(r => r.cap_less5),
            borderColor: palette[2], tension: 0.3, pointRadius: 0, borderWidth: 2 },
        ];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_basis_points') });
      }
      case 'cap_rate_by_credit': {
        datasets = [
          { label: 'Federal',   data: chart.rows.map(r => r.federal_cap),
            borderColor: palette[0], tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: 'State',     data: chart.rows.map(r => r.state_cap),
            borderColor: palette[1], tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: 'Municipal', data: chart.rows.map(r => r.municipal_cap),
            borderColor: palette[2], tension: 0.3, pointRadius: 0, borderWidth: 2 },
        ];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_basis_points') });
      }

      // ===== Phase 2b additions =====================================================
      case 'yoy_volume_change': {
        // Bar chart with positive/negative coloring
        const data = chart.rows.map(r => r.yoy_change_pct);
        const bgColors = data.map(v => v == null ? palette[4] : (v >= 0 ? palette[0] : '#C0504D'));
        datasets = [{
          label: 'YoY Change (TTM Volume)',
          data,
          backgroundColor: bgColors,
          borderRadius: 2,
        }];
        return new Chart(canvas, { type: 'bar', data: { labels, datasets },
          options: commonChartOptions('percent_one_decimal') });
      }
      case 'buyer_class_pct_by_year': {
        // Stacked bar by year (% of volume)
        const yearLabels = chart.rows.map(r => String(r.year));
        datasets = [
          { label: 'Private',           data: chart.rows.map(r => r.private_pct),
            backgroundColor: palette[0], stack: 'pool' },
          { label: 'Public REITs',      data: chart.rows.map(r => r.reit_pct),
            backgroundColor: palette[2], stack: 'pool' },
          { label: 'Cross-Border',      data: chart.rows.map(r => r.cross_border_pct),
            backgroundColor: palette[1], stack: 'pool' },
          { label: 'Institutional',     data: chart.rows.map(r => r.institutional_pct),
            backgroundColor: palette[3], stack: 'pool' },
        ];
        const opts = commonChartOptions('percent_zero_decimal');
        opts.scales.x.stacked = true;
        opts.scales.y.stacked = true;
        opts.scales.y.max = 1.0;
        return new Chart(canvas, { type: 'bar', data: { labels: yearLabels, datasets }, options: opts });
      }
      case 'dom_and_pct_of_ask':
      case 'dom_and_pct_of_ask_monthly': {
        // Combo: DOM as bars (left axis), % of ask as line (right axis)
        const dom = chart.rows.map(r => r.avg_dom);
        const pctAsk = chart.rows.map(r => r.pct_of_ask);
        datasets = [
          { type: 'bar',  label: 'Avg Days on Market', data: dom,
            backgroundColor: palette[3], borderRadius: 2, yAxisID: 'y' },
          { type: 'line', label: '% of Ask Price', data: pctAsk,
            borderColor: palette[0], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 2, borderWidth: 2.5, yAxisID: 'y1' },
        ];
        const opts = commonChartOptions('integer_count');
        opts.scales.y1 = {
          position: 'right',
          ticks: { color: brandColor('nm_axis', '#6A748C'),
                   font: { family: 'Calibri, sans-serif', size: 9 },
                   callback: tickFormatterFor('percent_one_decimal') },
          grid: { display: false },
        };
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }
      case 'bid_ask_spread':
      case 'bid_ask_spread_monthly': {
        // Quarterly: spread line only.
        // Monthly (deliverable p.34): spread bars on left axis + last-ask cap line
        // on right axis. The monthly view exposes avg_last_ask_cap; if present
        // the renderer adds the overlay; otherwise falls back to spread-only.
        const isMonthly = chart.chart_template_id === 'bid_ask_spread_monthly';
        if (isMonthly) {
          datasets = [
            { type: 'bar',  label: 'Bid-Ask Spread (bps)',
              data: chart.rows.map(r => r.avg_bid_ask_spread),
              backgroundColor: palette[3], borderRadius: 1, yAxisID: 'y' },
            { type: 'line', label: 'Last Ask Cap',
              data: chart.rows.map(r => r.avg_last_ask_cap),
              borderColor: palette[0], backgroundColor: 'transparent',
              tension: 0.3, pointRadius: 0, borderWidth: 2, yAxisID: 'y1' },
          ];
          const opts = commonChartOptions('percent_basis_points');
          opts.scales.y1 = {
            position: 'right',
            ticks: {
              color: brandColor('nm_axis', '#6A748C'),
              font: { family: 'Calibri, sans-serif', size: 9 },
              callback: tickFormatterFor('percent_basis_points'),
            },
            grid: { display: false },
          };
          return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
        }
        // Quarterly fallback (gov, dialysis quarterly cadence)
        datasets = [{
          label: 'Bid-Ask Spread (bps)',
          data: chart.rows.map(r => r.avg_bid_ask_spread),
          borderColor: palette[0],
          backgroundColor: palette[3],
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2,
        }];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_basis_points') });
      }

      // ===== Phase 2c additions (FRED-sourced macro context) ========================
      case 'fed_funds_vs_treasury': {
        datasets = [
          { label: 'Fed Funds Rate',  data: chart.rows.map(r => r.fed_funds_rate),
            borderColor: palette[1], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: '10Y Treasury',    data: chart.rows.map(r => r.treasury_10y_yield),
            borderColor: palette[0], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
        ];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_one_decimal') });
      }
      case 'cost_of_capital': {
        // Per deliverable p.15: Treasury + Avg Cap + 10+yr Cap + Loan Constants band
        // (low at 10Y+180bps, high at 10Y+220bps, both 30-yr amortization)
        datasets = [
          { label: '10Y Treasury',    data: chart.rows.map(r => r.treasury_10y_yield),
            borderColor: palette[1], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
          { label: 'Avg Cap Rate (TTM)', data: chart.rows.map(r => r.avg_cap_rate),
            borderColor: palette[3], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: '10+ Year Cap',    data: chart.rows.map(r => r.cap_10plus_year),
            borderColor: palette[0], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
          { label: 'Low Loan Constant (10Y+180bps)', data: chart.rows.map(r => r.low_loan_constant),
            borderColor: palette[4], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 1, borderDash: [3,3] },
          { label: 'High Loan Constant (10Y+220bps)', data: chart.rows.map(r => r.high_loan_constant),
            borderColor: palette[4], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 1, borderDash: [3,3] },
        ];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_one_decimal') });
      }
      case 'cash_leveraged_returns': {
        // Deliverable p.16: Cash Return Index (cap rate, dark blue) + Leveraged Return Index
        // (band between low/high LC variants, light blue line for mid)
        datasets = [
          { label: 'Cash Return Index',         data: chart.rows.map(r => r.cash_return),
            borderColor: palette[0], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
          { label: 'Leveraged Return (mid)',    data: chart.rows.map(r => r.leveraged_return_mid),
            borderColor: palette[1], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: 'Leveraged High (10Y+180)',  data: chart.rows.map(r => r.leveraged_return_high),
            borderColor: palette[1], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 0.75, borderDash: [4,3] },
          { label: 'Leveraged Low (10Y+220)',   data: chart.rows.map(r => r.leveraged_return_low),
            borderColor: palette[1], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 0.75, borderDash: [4,3] },
        ];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_one_decimal') });
      }
      case 'seller_sentiment':
      case 'seller_sentiment_monthly': {
        // Round 27 — mirrors Round 10/17/26 server config. Cap lines on
        // LEFT axis with per-vertical range; price-change bars on RIGHT.
        // Round 31 — User: cap rate lines clipped from view on both
        // verticals. Dia widened (long-term cohort hit 8.87% above old
        // 7.25%). Gov tightened bottom to focus on actual data span.
        //   Gov:   cap 5.5–9.5% / price 0–8%   (data 6.05-8.78%)
        //   Dia:   cap 4.75–9.25% / price 0–70% (long-term max 8.87%)
        const govLike = chart.vertical === 'gov' || chart.vertical === 'government_leased';
        const capMin = govLike ? 0.055  : 0.0475;
        const capMax = govLike ? 0.095  : 0.0925;
        const pcMin  = 0;
        const pcMax  = govLike ? 0.08  : 0.70;
        const opts = commonChartOptions('percent_basis_points');
        opts.scales.y.min = capMin; opts.scales.y.max = capMax;
        opts.scales.y.ticks = opts.scales.y.ticks || {};
        opts.scales.y.ticks.callback = tickFormatterFor('percent_basis_points');
        opts.scales.y1 = {
          position: 'right', min: pcMin, max: pcMax,
          ticks: { color: brandColor('nm_axis', '#6A748C'),
                   font: { family: 'Calibri, sans-serif', size: 9 },
                   callback: tickFormatterFor('percent_zero_decimal') },
          grid: { display: false },
        };
        datasets = [
          { type: 'bar',  label: 'Price Change %',          data: chart.rows.map(r => r.pct_price_change_all),
            backgroundColor: 'rgba(166,217,201,0.75)', borderRadius: 1, yAxisID: 'y1', order: 2 },
          { type: 'bar',  label: '8+ Yr Term Price Change %', data: chart.rows.map(r => r.pct_price_change_long_term),
            backgroundColor: 'rgba(200,182,226,0.75)', borderRadius: 1, yAxisID: 'y1', order: 2 },
          { type: 'line', label: 'Last Asking Cap (all)',   data: chart.rows.map(r => r.last_ask_cap_all),
            borderColor: palette[0], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5, yAxisID: 'y', order: 0 },
          { type: 'line', label: 'Last Asking Cap (8+ yr)', data: chart.rows.map(r => r.last_ask_cap_long_term),
            borderColor: palette[1], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2, yAxisID: 'y', order: 0 },
        ];
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }
      case 'sources_of_capital': {
        // Deliverable p.19: top buyer states. Rendered as a horizontal bar chart for V1
        // (the deliverable shows it as a US choropleth; map can be rebuilt in InDesign
        // from this same data).
        const top10 = (chart.rows || []).slice(0, 10);
        const stateLabels = top10.map(r => r.buyer_state);
        datasets = [{
          label: 'Total Acquisition Volume (15-yr, $M)',
          data: top10.map(r => r.total_volume_15y / 1e6),
          backgroundColor: palette[0],
          borderRadius: 2,
        }];
        const opts = commonChartOptions('integer_count');
        opts.indexAxis = 'y';
        opts.scales.x.ticks.callback = (v) => '$' + (v / 1000).toFixed(1) + 'B';
        return new Chart(canvas, { type: 'bar', data: { labels: stateLabels, datasets }, options: opts });
      }
      case 'net_lease_spread': {
        // Filled-area spread: market cap minus 10Y Treasury (in bps)
        datasets = [
          { label: 'Market Spread',   data: chart.rows.map(r => r.market_spread),
            borderColor: palette[0], backgroundColor: palette[3],
            fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2 },
          { label: 'NM Spread',       data: chart.rows.map(r => r.nm_spread),
            borderColor: palette[1], backgroundColor: 'transparent',
            tension: 0.25, pointRadius: 2, borderWidth: 2 },
        ];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_basis_points') });
      }

      // ===== Phase 2c.4: Section 2 Leasing Trends ===================================
      case 'lease_renewal_rate': {
        // Round 29 — sync to server: stacked + improved colors so
        // outcome buckets are visually distinguishable.
        const navy = brandColor('nm_navy', '#003DA5');
        const sky  = brandColor('nm_sky',  '#62B5E5');
        const midBlue = brandColor('nm_blue_mid', '#265AB2');
        datasets = [
          // first_generation_commencements is in-app only (not in server view)
          { type: 'bar', label: 'New Leases',           data: chart.rows.map(r => r.first_generation_commencements),
            backgroundColor: palette[3], borderRadius: 1, stack: 'leases' },
          { type: 'bar', label: 'Renewed',              data: chart.rows.map(r => r.renewed_leases),
            backgroundColor: navy, borderRadius: 1, stack: 'leases' },
          { type: 'bar', label: 'Succeeding/Superseding', data: chart.rows.map(r => r.succeeding_superseding_leases),
            backgroundColor: midBlue, borderRadius: 1, stack: 'leases' },
          { type: 'bar', label: 'Expired',              data: chart.rows.map(r => r.expired_leases),
            backgroundColor: sky, borderRadius: 1, stack: 'leases' },
          { type: 'bar', label: 'Terminated',           data: chart.rows.map(r => r.terminated_leases),
            backgroundColor: '#D97706', borderRadius: 1, stack: 'leases' },  // amber — negative
        ];
        const opts = commonChartOptions('integer_count');
        opts.scales.x.stacked = true;
        opts.scales.y.stacked = true;
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }
      case 'lease_termination_rate': {
        // Round 31 Tier 2 — Restructured to match master Excel
        // Term_Rate format: 2 bars of TTM counts (In Firm + Outside
        // Firm), no termination-rate %, no dual axis. Mirrors server
        // renderer rewrite.
        const opts = commonChartOptions('integer_count');
        const sky  = brandColor('nm_sky',  '#62B5E5');
        const navy = brandColor('nm_navy', '#003DA5');
        datasets = [
          { type: 'bar', label: 'Leases In Firm Term (TTM)',
            data: chart.rows.map(r => {
              const t = Number(r.total_leases_active) || 0;
              const o = Number(r.leases_outside_firm_term) || 0;
              return Math.max(0, t - o);
            }),
            backgroundColor: navy, borderColor: navy,
            borderRadius: 1, yAxisID: 'y', order: 1 },
          { type: 'bar', label: 'Leases Outside Firm (TTM)',
            data: chart.rows.map(r => r.leases_outside_firm_term),
            backgroundColor: sky, borderColor: sky,
            borderRadius: 1, yAxisID: 'y', order: 2 },
        ];
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }
      case 'rent_psf_box_quarterly': {
        // Round 30 — Removed Min and Max series per user. IQR band
        // (Q3 fills DOWN to Q1) + Median line. Y-axis pinned $5-$50.
        datasets = [
          { label: 'Upper Quartile', data: chart.rows.map(r => r.rent_upper_quartile),
            borderColor: palette[1], backgroundColor: palette[3] + '88',
            fill: '+1', tension: 0.2, pointRadius: 0, borderWidth: 1.5 },
          { label: 'Lower Quartile', data: chart.rows.map(r => r.rent_lower_quartile),
            borderColor: palette[1], backgroundColor: 'transparent',
            tension: 0.2, pointRadius: 0, borderWidth: 1.5 },
          { label: 'Median',         data: chart.rows.map(r => r.rent_median),
            borderColor: palette[0], backgroundColor: 'transparent',
            tension: 0.2, pointRadius: 0, borderWidth: 2.5 },
        ];
        const opts = commonChartOptions('currency_per_sf');
        opts.scales.y.min = 5; opts.scales.y.max = 50;
        opts.scales.y.ticks.callback = (v) => '$' + Number(v).toFixed(0);
        opts.plugins.tooltip.callbacks.label = (ctx) =>
          `${ctx.dataset.label}: $${Number(ctx.parsed.y).toFixed(2)}/SF`;
        return new Chart(canvas, { type: 'line', data: { labels, datasets }, options: opts });
      }
      case 'rent_by_year_built': {
        const yearLabels = chart.rows.map(r => String(r.year));
        datasets = [
          { type: 'line', label: 'Average RPSF',  data: chart.rows.map(r => r.avg_rpsf),
            borderColor: palette[0], backgroundColor: palette[0],
            showLine: false, pointRadius: 4 },
          { type: 'line', label: 'Median RPSF',   data: chart.rows.map(r => r.median_rpsf),
            borderColor: palette[1], backgroundColor: palette[1],
            showLine: false, pointRadius: 4 },
          { type: 'line', label: 'Upper Quartile', data: chart.rows.map(r => r.upper_quartile_rpsf),
            borderColor: palette[4], backgroundColor: 'transparent',
            tension: 0.2, pointRadius: 0, borderWidth: 1, borderDash: [4,3] },
          { type: 'line', label: 'Lower Quartile', data: chart.rows.map(r => r.lower_quartile_rpsf),
            borderColor: palette[4], backgroundColor: 'transparent',
            tension: 0.2, pointRadius: 0, borderWidth: 1, borderDash: [4,3] },
        ];
        return new Chart(canvas, { type: 'line', data: { labels: yearLabels, datasets },
          options: commonChartOptions('currency_per_sf') });
      }
      case 'case_for_renewal': {
        const yearLabels = chart.rows.map(r => String(r.year));
        const opts = commonChartOptions('integer_count');
        opts.scales.y1 = {
          position: 'right',
          ticks: { color: brandColor('nm_axis', '#6A748C'),
                   font: { family: 'Calibri, sans-serif', size: 9 },
                   callback: (v) => '$' + Number(v).toFixed(0) },
          grid: { display: false },
        };
        datasets = [
          { type: 'bar',  label: 'Lease Commencements', data: chart.rows.map(r => r.commencement_count),
            backgroundColor: palette[0], borderRadius: 1, yAxisID: 'y' },
          { type: 'line', label: 'Avg Rent PSF',        data: chart.rows.map(r => r.avg_rent_per_sf),
            borderColor: palette[2], backgroundColor: 'transparent',
            tension: 0.25, pointRadius: 2, borderWidth: 2, yAxisID: 'y1' },
        ];
        return new Chart(canvas, { type: 'bar', data: { labels: yearLabels, datasets }, options: opts });
      }
      case 'renewal_rent_growth': {
        // Round 27 — mirrors Round 26 axis widening. left $0–$70 to fit
        // gov avg_renewal_rent_psf max $65.49; right -5%–12% to fit
        // gov cagr_5yr max 10.68%.
        const opts = commonChartOptions('currency_per_sf');
        opts.scales.y.min = 0; opts.scales.y.max = 70;
        opts.scales.y1 = {
          position: 'right', min: -0.05, max: 0.12,
          ticks: { color: brandColor('nm_axis', '#6A748C'),
                   font: { family: 'Calibri, sans-serif', size: 9 },
                   callback: tickFormatterFor('percent_one_decimal') },
          grid: { display: false },
        };
        datasets = [
          { type: 'bar',  label: 'TTM Avg Renewal Rent/SF', data: chart.rows.map(r => r.ttm_avg_renewal_rent_psf),
            backgroundColor: palette[3], borderRadius: 1, yAxisID: 'y' },
          { type: 'line', label: 'Upper Quartile', data: chart.rows.map(r => r.upper_quartile_rpsf),
            borderColor: palette[4], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 1, borderDash: [4,3], yAxisID: 'y' },
          { type: 'line', label: 'Lower Quartile', data: chart.rows.map(r => r.lower_quartile_rpsf),
            borderColor: palette[4], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 1, borderDash: [4,3], yAxisID: 'y' },
          { type: 'line', label: '5-Year CAGR', data: chart.rows.map(r => r.cagr_5yr),
            borderColor: palette[1], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 2, borderWidth: 2, yAxisID: 'y1' },
        ];
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }
      case 'pace_of_cap_rate_expansion': {
        // Round 27 — mirrors Round 16/24 server config. Nominal YoY Δ
        // (curr - lag(12)) for cap rates + cost of capital. Navy bars
        // (all-cohort), sky bars (Core 10+ overlay), orange line
        // (Cost of Capital YoY).
        const navy = brandColor('nm_navy', '#003DA5');
        const sky  = brandColor('nm_sky',  '#62B5E5');
        const opts = commonChartOptions('percent_basis_points');
        opts.scales.y.min = -0.025; opts.scales.y.max = 0.035;
        datasets = [
          { type: 'bar', label: 'Cap Rate YoY Δ (All)',
            data: chart.rows.map(r => r.pace_all),
            backgroundColor: navy, borderRadius: 1,
            barPercentage: 0.7, categoryPercentage: 0.85, order: 2 },
          { type: 'bar', label: 'Cap Rate YoY Δ (Core 10+)',
            data: chart.rows.map(r => r.pace_core),
            backgroundColor: 'rgba(98,181,229,0.55)', borderRadius: 1,
            barPercentage: 0.5, categoryPercentage: 0.85, order: 1 },
          { type: 'line', label: 'Cost of Capital YoY Δ',
            data: chart.rows.map(r => r.pace_cost),
            borderColor: '#D97706', backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5, order: 0 },
        ];
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }

      case 'cpi_vs_renewal_cagr': {
        datasets = [
          { label: 'CPI YoY Change',     data: chart.rows.map(r => r.cpi_change),
            borderColor: palette[1], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: 'GSA Renewal CAGR',   data: chart.rows.map(r => r.gsa_renewal_cagr),
            borderColor: palette[0], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
        ];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_one_decimal') });
      }
      case 'leased_inventory_by_state': {
        const top10 = (chart.rows || []).slice(0, 10);
        const stateLabels = top10.map(r => r.state);
        datasets = [{
          label: 'Total Leased SF',
          data: top10.map(r => r.total_rsf / 1e6),
          backgroundColor: palette[0],
          borderRadius: 2,
        }];
        const opts = commonChartOptions('integer_count');
        opts.indexAxis = 'y';
        opts.scales.x.ticks.callback = (v) => Number(v).toFixed(1) + 'M SF';
        return new Chart(canvas, { type: 'bar', data: { labels: stateLabels, datasets }, options: opts });
      }
      case 'rent_heat_map': {
        const top10 = (chart.rows || []).slice(0, 10);
        const stateLabels = top10.map(r => r.state);
        datasets = [{
          label: 'Avg Rent / SF',
          data: top10.map(r => r.avg_rpsf),
          backgroundColor: palette[1],
          borderRadius: 2,
        }];
        const opts = commonChartOptions('currency_per_sf');
        opts.indexAxis = 'y';
        opts.scales.x.ticks.callback = (v) => '$' + Number(v).toFixed(0);
        return new Chart(canvas, { type: 'bar', data: { labels: stateLabels, datasets }, options: opts });
      }
      // ----- Inventory Analysis (dia p.29-35) ---------------------------------

      case 'available_market_size_combo': {
        // p.30 top: count of active listings per quarter (bars, both cohorts)
        // overlaid with avg asking cap rate (lines, both cohorts) on a right axis.
        const total_count = chart.rows.map(r => r.count_total);
        const core_count  = chart.rows.map(r => r.count_core_10plus);
        const total_cap   = chart.rows.map(r => r.avg_cap_total);
        const core_cap    = chart.rows.map(r => r.avg_cap_core_10plus);
        datasets = [
          { type: 'bar',  label: 'Total Market — # Available',
            data: total_count, backgroundColor: palette[3], borderRadius: 2, yAxisID: 'y' },
          { type: 'bar',  label: '10+ Year Term — # Available',
            data: core_count,  backgroundColor: palette[1], borderRadius: 2, yAxisID: 'y' },
          // Round 30 — distinct colors (navy vs amber) + tighter
          // y-axis 5.5-7.5% so the cap movement reads clearly.
          { type: 'line', label: 'Total Market — Avg Asking Cap',
            data: total_cap, borderColor: palette[0], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5, yAxisID: 'y1' },
          { type: 'line', label: '10+ Year Term — Avg Asking Cap',
            data: core_cap,  borderColor: '#D97706', backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5, yAxisID: 'y1' },
        ];
        const opts = commonChartOptions('integer_count');
        opts.scales.y1 = {
          position: 'right', min: 0.055, max: 0.075,
          ticks: {
            color: brandColor('nm_axis', '#6A748C'),
            font: { family: 'Calibri, sans-serif', size: 9 },
            callback: tickFormatterFor('percent_basis_points'),
          },
          grid: { display: false },
        };
        opts.plugins.tooltip.callbacks.label = (ctx) => {
          const fmt = ctx.dataset.yAxisID === 'y1' ? 'percent_basis_points' : 'integer_count';
          return `${ctx.dataset.label}: ${tickFormatterFor(fmt)(ctx.parsed.y)}`;
        };
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }

      case 'asking_cap_quartiles_active': {
        // p.31 top: upper/lower quartile asking cap, 2 cohorts × 2 quartiles = 4 lines
        datasets = [
          { type: 'line', label: 'Total Market — Upper Quartile',
            data: chart.rows.map(r => r.upper_q_total),
            borderColor: palette[1], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { type: 'line', label: 'Total Market — Lower Quartile',
            data: chart.rows.map(r => r.lower_q_total),
            borderColor: palette[3], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { type: 'line', label: '10+ Year Term — Upper Quartile',
            data: chart.rows.map(r => r.upper_q_core),
            borderColor: palette[2], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
          { type: 'line', label: '10+ Year Term — Lower Quartile',
            data: chart.rows.map(r => r.lower_q_core),
            borderColor: palette[0], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
        ];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_basis_points') });
      }

      case 'dom_price_change_active': {
        // p.31 bottom: avg DOM (bars, both cohorts) + price-change-frequency
        // lines (both cohorts). Two y-axes (DOM days vs %).
        datasets = [
          { type: 'bar',  label: 'Total Market — DOM',
            data: chart.rows.map(r => r.avg_dom_total),
            backgroundColor: palette[3], borderRadius: 2, yAxisID: 'y' },
          { type: 'bar',  label: '10+ Year Term — DOM',
            data: chart.rows.map(r => r.avg_dom_core),
            backgroundColor: palette[1], borderRadius: 2, yAxisID: 'y' },
          { type: 'line', label: 'Total Market — Price-Change %',
            data: chart.rows.map(r => r.pct_price_change_total),
            borderColor: palette[0], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5, yAxisID: 'y1' },
          { type: 'line', label: '10+ Year Term — Price-Change %',
            data: chart.rows.map(r => r.pct_price_change_core),
            borderColor: palette[2], backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5, yAxisID: 'y1' },
        ];
        const opts = commonChartOptions('integer_count');
        opts.scales.y1 = {
          position: 'right',
          ticks: {
            color: brandColor('nm_axis', '#6A748C'),
            font: { family: 'Calibri, sans-serif', size: 9 },
            callback: tickFormatterFor('percent_zero_decimal'),
          },
          grid: { display: false },
        };
        opts.plugins.tooltip.callbacks.label = (ctx) => {
          const fmt = ctx.dataset.yAxisID === 'y1' ? 'percent_zero_decimal' : 'integer_count';
          return `${ctx.dataset.label}: ${tickFormatterFor(fmt)(ctx.parsed.y)}`;
        };
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }

      // ─────────────────────────────────────────────────────────────
      // Round 23 — In-app parity for the 7 charts added in Rounds 18-20.
      // (Server export had these for weeks; in-app display showed empty
      // panels. Re-implements each on Chart.js v4 to match the server
      // renderer behavior.)
      // ─────────────────────────────────────────────────────────────

      case 'core_cap_rate_dot_plot': {
        // Round 27 — mirrors Round 24 server rework. Single sky-dot series
        // (no NM split per user) + 12-month rolling-average navy trendline.
        // Round 30 — Cohort filters: dia firm_term >= 8yr, gov >= 6yr
        // (the source view applies the cohort filter; renderer is
        // vertical-neutral). Source data goes back to 2001-01-01.
        const sky  = brandColor('nm_sky',  '#62B5E5');
        const navy = brandColor('nm_navy', '#003DA5');
        const dots = (chart.rows || [])
          .filter(r => r.cap_rate != null && r.period_end != null)
          .map(r => ({ x: new Date(r.period_end).getTime(), y: Number(r.cap_rate) }))
          .sort((a, b) => a.x - b.x);
        const SIX_MO_MS = 1000 * 60 * 60 * 24 * 182;
        const trend = dots.map(d => {
          let sum = 0, n = 0;
          for (const o of dots) {
            if (o.x >= d.x - SIX_MO_MS && o.x <= d.x + SIX_MO_MS) { sum += o.y; n++; }
          }
          return { x: d.x, y: n > 0 ? sum / n : null };
        });
        const ds = [
          { label: 'Core sales (long firm term)',
            data: dots,
            backgroundColor: 'rgba(98,181,229,0.55)', borderColor: sky,
            pointRadius: 3, pointStyle: 'circle', showLine: false, order: 2 },
          { label: '12-mo Rolling Avg',
            data: trend, type: 'line',
            borderColor: navy, backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5, showLine: true, order: 0 },
        ];
        const opts = commonChartOptions('percent_basis_points');
        opts.scales.x = { type: 'time', time: { unit: 'year' },
          ticks: { color: brandColor('nm_axis','#6A748C'), font: { family: 'Calibri', size: 9 } },
          grid: { display: false } };
        opts.scales.y.min = 0.04; opts.scales.y.max = 0.12;
        return new Chart(canvas, { type: 'scatter', data: { datasets: ds }, options: opts });
      }

      case 'available_cap_rate_dot_plot': {
        // Round 30 — Single dot series (removed NM split per user).
        const sky  = brandColor('nm_sky',  '#62B5E5');
        const navy = brandColor('nm_navy', '#003DA5');
        const allDots = (chart.rows || [])
          .filter(r => r.cap_rate != null && r.firm_term_years != null)
          .map(r => ({ x: Number(r.firm_term_years), y: Number(r.cap_rate) }));
        const xs = allDots.map(d => d.x);
        const xMinData = xs.length ? Math.min(...xs) : 0;
        const xMaxData = xs.length ? Math.max(...xs) : 30;
        const pad = Math.max(1, (xMaxData - xMinData) * 0.10);
        const xMin = Math.max(0, Math.floor(xMinData - pad));
        const xMax = Math.min(30, Math.ceil(xMaxData + pad));
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
        const ds = [
          { label: 'Active listings',
            data: allDots,
            backgroundColor: 'rgba(98,181,229,0.55)', borderColor: sky,
            pointRadius: 4, pointStyle: 'circle', showLine: false, order: 1 },
          { label: 'Linear Trendline',
            data: trendData, type: 'line',
            borderColor: navy, backgroundColor: 'transparent',
            borderDash: [6, 4], borderWidth: 2, pointRadius: 0,
            showLine: true, order: 0 },
        ];
        const opts = commonChartOptions('percent_basis_points');
        opts.scales.x = { type: 'linear', position: 'bottom', min: xMin, max: xMax,
          title: { display: true, text: 'Firm Lease Term (Years)',
            color: brandColor('nm_axis','#6A748C'), font: { family: 'Calibri', size: 10 } },
          ticks: { color: brandColor('nm_axis','#6A748C'), font: { family: 'Calibri', size: 9 } },
          grid: { color: 'rgba(0,0,0,0.05)' } };
        opts.scales.y.min = 0.04; opts.scales.y.max = 0.12;
        return new Chart(canvas, { type: 'scatter', data: { datasets: ds }, options: opts });
      }

      case 'available_by_firm_term_summary': {
        // Gov-only. Combo: avg_price bars + 4 cohort dots (avg/upper-Q/median/lower-Q cap)
        // on a right axis. Categories: Sub 5 / 5-8 / 8-12 / 12+.
        const navy   = brandColor('nm_navy',     '#003DA5');
        const sky    = brandColor('nm_sky',      '#62B5E5');
        const purple = '#7E6BAD';
        const sage   = '#4CB582';
        const gray   = '#6A748C';
        const termRows = chart.rows || [];
        const termLabels = termRows.map(r => r.term_bucket || '?');
        datasets = [
          { type: 'bar', label: 'Avg Price',
            data: termRows.map(r => r.avg_price),
            backgroundColor: sky, borderColor: sky,
            borderRadius: 1, barPercentage: 0.6, categoryPercentage: 0.85,
            yAxisID: 'y', order: 5 },
          { type: 'scatter', label: 'Avg Cap',
            data: termRows.map((r, i) => ({ x: i, y: r.avg_cap })),
            backgroundColor: navy, borderColor: navy,
            pointRadius: 6, pointStyle: 'rectRot', showLine: false, yAxisID: 'y1', order: 1 },
          { type: 'scatter', label: 'Upper Q',
            data: termRows.map((r, i) => ({ x: i, y: r.upper_quartile_cap })),
            backgroundColor: purple, borderColor: purple,
            pointRadius: 6, pointStyle: 'rectRot', showLine: false, yAxisID: 'y1', order: 2 },
          { type: 'scatter', label: 'Lower Q',
            data: termRows.map((r, i) => ({ x: i, y: r.lower_quartile_cap })),
            backgroundColor: gray, borderColor: gray,
            pointRadius: 6, pointStyle: 'rectRot', showLine: false, yAxisID: 'y1', order: 3 },
          { type: 'scatter', label: 'Median',
            data: termRows.map((r, i) => ({ x: i, y: r.median_cap })),
            backgroundColor: sage, borderColor: sage,
            pointRadius: 6, pointStyle: 'rectRot', showLine: false, yAxisID: 'y1', order: 4 },
        ];
        const opts = commonChartOptions('currency_millions');
        opts.scales.x = { ...(opts.scales.x || {}), type: 'category' };
        opts.scales.y1 = { type: 'linear', position: 'right', min: 0.04, max: 0.10,
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => (v * 100).toFixed(1) + '%', font: { size: 11 } } };
        return new Chart(canvas, { type: 'bar', data: { labels: termLabels, datasets }, options: opts });
      }

      case 'market_turnover': {
        // Area-filled navy line of TTM turnover rate.
        const navy = brandColor('nm_navy', '#003DA5');
        const pale = brandColor('nm_pale', '#E0E8F4');
        datasets = [{
          label: 'Turnover Rate (TTM)',
          data: chart.rows.map(r => r.turnover_rate),
          borderColor: navy, backgroundColor: pale, fill: true,
          tension: 0.3, pointRadius: 0, borderWidth: 2.5,
        }];
        const opts = commonChartOptions('percent_one_decimal');
        // Adaptive y-max: gov sits 1-3%, dia 20-30%.
        const vals = chart.rows.map(r => Number(r.turnover_rate)).filter(v => Number.isFinite(v));
        const maxV = vals.length ? Math.max(...vals) : 0.05;
        opts.scales.y.min = 0;
        opts.scales.y.max = maxV > 0.10 ? Math.ceil(maxV * 20) / 20 : 0.05;
        return new Chart(canvas, { type: 'line', data: { labels, datasets }, options: opts });
      }

      case 'inventory_backlog': {
        // Combo: active-listings bars (left axis) + months-of-supply line (right axis).
        const sky  = brandColor('nm_sky',  '#62B5E5');
        const pale = brandColor('nm_pale', '#E0E8F4');
        const navy = brandColor('nm_navy', '#003DA5');
        datasets = [
          { type: 'bar', label: 'Active Listings',
            data: chart.rows.map(r => Number(r.active_count) || 0),
            backgroundColor: pale, borderColor: sky, borderRadius: 1,
            yAxisID: 'y', order: 2 },
          { type: 'line', label: 'Months of Supply',
            data: chart.rows.map(r => r.months_of_supply != null ? Number(r.months_of_supply) : null),
            borderColor: navy, backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5,
            yAxisID: 'y1', order: 0 },
        ];
        const opts = commonChartOptions('integer_count');
        opts.scales.y1 = { type: 'linear', position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => v + ' mo', color: brandColor('nm_axis','#6A748C'),
                   font: { family: 'Calibri', size: 9 } } };
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }

      case 'txn_count_avg_deal_combo': {
        // PDF deck p.8 dia / p.17 gov: pale bars (TTM count) + navy line (avg deal $).
        const sky  = brandColor('nm_sky',  '#62B5E5');
        const pale = brandColor('nm_pale', '#E0E8F4');
        const navy = brandColor('nm_navy', '#003DA5');
        datasets = [
          { type: 'bar', label: 'TTM Transactions',
            data: chart.rows.map(r => Number(r.ttm_count) || 0),
            backgroundColor: pale, borderColor: sky, borderRadius: 1,
            yAxisID: 'y', order: 2 },
          { type: 'line', label: 'Avg Deal Size',
            data: chart.rows.map(r => r.avg_deal_size != null ? Number(r.avg_deal_size) : null),
            borderColor: navy, backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5,
            yAxisID: 'y1', order: 0 },
        ];
        const opts = commonChartOptions('integer_count');
        opts.scales.y1 = { type: 'linear', position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => '$' + (v / 1_000_000).toFixed(1) + 'M',
                   color: brandColor('nm_axis','#6A748C'),
                   font: { family: 'Calibri', size: 9 } } };
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }

      case 'rent_and_price_per_chair': {
        // Round 31 — Dia counterpart to gov rent_and_price_psf.
        // Properties measured by chair count, not SF. Bars = rent/chair
        // (left), line = price/chair (right).
        const sky  = brandColor('nm_sky',  '#62B5E5');
        const navy = brandColor('nm_navy', '#003DA5');
        datasets = [
          { type: 'bar', label: 'Avg Rent / Chair (TTM)',
            data: chart.rows.map(r => r.rent_per_chair),
            backgroundColor: sky, borderColor: sky,
            borderRadius: 1, yAxisID: 'y', order: 2 },
          { type: 'line', label: 'Avg Sale Price / Chair (TTM)',
            data: chart.rows.map(r => r.price_per_chair),
            borderColor: navy, backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5,
            yAxisID: 'y1', order: 0 },
        ];
        const opts = commonChartOptions('integer_count');
        opts.scales.y.min = 0; opts.scales.y.max = 16000;
        opts.scales.y.ticks = opts.scales.y.ticks || {};
        opts.scales.y.ticks.callback = (v) => '$' + (Number(v) / 1000).toFixed(0) + 'K';
        opts.scales.y1 = { type: 'linear', position: 'right',
          min: 0, max: 250000,
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => '$' + (Number(v) / 1000).toFixed(0) + 'K',
                   color: brandColor('nm_axis','#6A748C'),
                   font: { family: 'Calibri', size: 9 } } };
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }

      case 'rent_and_price_psf': {
        // PDF deck p.9 gov: sky bars (rent PSF) + navy line (price PSF).
        const sky  = brandColor('nm_sky',  '#62B5E5');
        const navy = brandColor('nm_navy', '#003DA5');
        datasets = [
          { type: 'bar', label: 'Avg Rent / SF',
            data: chart.rows.map(r => r.rent_psf),
            backgroundColor: sky, borderColor: sky,
            borderRadius: 1, yAxisID: 'y', order: 2 },
          { type: 'line', label: 'Avg Sale Price / SF',
            data: chart.rows.map(r => r.price_psf),
            borderColor: navy, backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 2.5,
            yAxisID: 'y1', order: 0 },
        ];
        const opts = commonChartOptions('currency_per_sf');
        opts.scales.y.min = 0; opts.scales.y.max = 50;
        opts.scales.y1 = { type: 'linear', position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => '$' + Math.round(v),
                   color: brandColor('nm_axis','#6A748C'),
                   font: { family: 'Calibri', size: 9 } } };
        return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
      }

      case 'asking_cap_by_term_dot_plot':
      case 'sold_cap_by_term_dot_plot': {
        // Round 30 — User redefined as 4-line TTM cohort time series
        // (was a scatter in R28). Mirrors server renderer logic.
        // Round 31 — asking_cap_by_term_dot_plot (NEW active-listings
        // counterpart) shares the same 4-line cohort renderer.
        const hasDialysisCohorts = (chart.rows || []).some(r =>
          r.cap_12plus != null || r.cap_8to12 != null ||
          r.cap_6to8 != null  || r.cap_5orless != null);
        const PDF = { long: '#7E6BAD', midL: '#4CB582', mid: '#62B5E5', short: '#003DA5', outside: '#6A748C' };
        datasets = hasDialysisCohorts ? [
          { label: '12+ Year',  data: chart.rows.map(r => r.cap_12plus),
            borderColor: PDF.long, backgroundColor: 'transparent',
            stepped: 'before', pointRadius: 0, borderWidth: 2.5 },
          { label: '8-12 Year', data: chart.rows.map(r => r.cap_8to12),
            borderColor: PDF.midL, backgroundColor: 'transparent',
            stepped: 'before', pointRadius: 0, borderWidth: 2 },
          { label: '6-8 Year',  data: chart.rows.map(r => r.cap_6to8),
            borderColor: PDF.mid, backgroundColor: 'transparent',
            stepped: 'before', pointRadius: 0, borderWidth: 2 },
          { label: '≤5 Year',   data: chart.rows.map(r => r.cap_5orless),
            borderColor: PDF.short, backgroundColor: 'transparent',
            stepped: 'before', pointRadius: 0, borderWidth: 2 },
        ] : [
          { label: '10+ Year',     data: chart.rows.map(r => r.cap_10plus),
            borderColor: PDF.long, backgroundColor: 'transparent',
            stepped: 'before', pointRadius: 0, borderWidth: 2.5 },
          { label: '6-10 Year',    data: chart.rows.map(r => r.cap_5to10),
            borderColor: PDF.midL, backgroundColor: 'transparent',
            stepped: 'before', pointRadius: 0, borderWidth: 2 },
          { label: '< 5 Year',     data: chart.rows.map(r => r.cap_less5),
            borderColor: PDF.short, backgroundColor: 'transparent',
            stepped: 'before', pointRadius: 0, borderWidth: 2 },
          { label: 'Outside Firm', data: chart.rows.map(r => r.cap_outside_firm),
            borderColor: PDF.outside, backgroundColor: 'transparent',
            stepped: 'before', pointRadius: 0, borderWidth: 1.5, borderDash: [3,3] },
        ];
        const opts = commonChartOptions('percent_basis_points');
        opts.scales.y.min = 0.04; opts.scales.y.max = 0.11;
        return new Chart(canvas, { type: 'line', data: { labels, datasets }, options: opts });
      }

      // DataTable types — rendered by renderDataTable() instead
      case 'leasing_summary':
      case 'lease_structures':
      case 'available_by_term_bucket':
      case 'available_by_tenant':
        return null;

      default:
        return null;
    }
  }

  // ---- RCA upload card (national_st only) -----------------------------------
  function renderRcaUploadCard() {
    const navy = brandColor('nm_navy', '#003DA5');
    const sky  = brandColor('nm_sky',  '#62B5E5');
    const pale = brandColor('nm_pale', '#E0E8F4');
    return `
      <div id="cm-rca-upload-card" style="background:#fff;border:1px solid #E7E6E6;border-radius:8px;padding:16px;margin:0 0 16px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div style="font-family:'Calibri Light',sans-serif;font-size:14pt;font-weight:600;color:${brandColor('nm_text','#191919')}">RCA TrendTracker Import</div>
            <div style="font-size:9pt;color:${brandColor('nm_text_muted','#666')}">Upload one product at a time, or select all four .xls files at once. Auto-detects product from header text.</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="border:1px dashed #C7CEDB;border-radius:6px;padding:12px;background:${pale}">
            <div style="font-size:10pt;font-weight:600;color:${navy};margin-bottom:8px">Single file</div>
            <input type="file" id="cm-rca-single-file" accept=".xls,.xlsx" style="font-size:9pt;margin-bottom:8px;width:100%">
            <select id="cm-rca-single-product" style="padding:5px;border:1px solid #E7E6E6;border-radius:4px;font-family:Calibri,sans-serif;font-size:9pt;width:100%;margin-bottom:8px">
              <option value="">(auto-detect from header)</option>
              <option value="office">Office</option>
              <option value="medical">Medical</option>
              <option value="industrial">Industrial</option>
              <option value="retail">Retail</option>
            </select>
            <button id="cm-rca-single-upload" style="padding:6px 14px;background:${navy};color:#fff;border:none;border-radius:4px;font-family:Calibri,sans-serif;font-size:9pt;font-weight:600;cursor:pointer;width:100%">Upload</button>
          </div>
          <div style="border:1px dashed #C7CEDB;border-radius:6px;padding:12px;background:${pale}">
            <div style="font-size:10pt;font-weight:600;color:${navy};margin-bottom:8px">Multi-file (one click)</div>
            <input type="file" id="cm-rca-multi-files" accept=".xls,.xlsx" multiple style="font-size:9pt;margin-bottom:8px;width:100%">
            <div style="font-size:8pt;color:${brandColor('nm_text_muted','#666')};margin-bottom:8px">Pick all four product files (Ctrl/Cmd-click). Product type is auto-detected per file.</div>
            <button id="cm-rca-multi-upload" style="padding:6px 14px;background:${sky};color:#fff;border:none;border-radius:4px;font-family:Calibri,sans-serif;font-size:9pt;font-weight:600;cursor:pointer;width:100%">Upload All</button>
          </div>
        </div>
        <div id="cm-rca-status" style="font-size:9pt;color:${brandColor('nm_axis','#6A748C')};margin-top:10px;min-height:18px"></div>
      </div>`;
  }

  // ---- HTML skeleton ---------------------------------------------------------
  function renderSkeleton(vertical) {
    const navy = brandColor('nm_navy', '#003DA5');
    const subRows = (cmState.subspecialties[vertical] || []).map(s =>
      `<option value="${s.subspecialty_id.replace(/^[a-z]+_/, '')}">${s.label}</option>`
    ).join('');
    const cards = PHASE_1_TEMPLATES.map(id => {
      const meta = (cmState.catalog || []).find(t => t.chart_template_id === id);
      if (!meta) return '';
      if (!meta.applies_to_verticals?.includes(vertical)) return '';
      // DataTable + kpi_block charts get an HTML container (no canvas); span 2 columns
      const isDataTable = meta.chart_type === 'DataTable';
      const isKpiBlock  = meta.chart_type === 'kpi_block';
      const cardSpan = (isDataTable || isKpiBlock) ? 'grid-column: span 2;' : '';
      const bodyContainer = isKpiBlock
        ? `<div class="cm-kpi-container" data-template="${id}"></div>`
        : isDataTable
          ? `<div class="cm-table-container" data-template="${id}" style="max-height:340px;overflow:auto;border:1px solid #E7E6E6;border-radius:4px"></div>`
          : `<div style="position:relative;height:300px"><canvas data-template="${id}"></canvas></div>`;
      return `
        <div class="cm-card" id="cm-card-${id}" style="background:#fff;border:1px solid #E7E6E6;border-radius:8px;padding:16px;margin:12px 0;box-shadow:0 1px 2px rgba(0,0,0,0.04);${cardSpan}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
            <div>
              <div style="font-family:'Calibri Light',sans-serif;font-size:14pt;font-weight:600;color:${brandColor('nm_text','#191919')}">${meta.name}</div>
              <div style="font-size:9pt;color:${brandColor('nm_text_muted','#666')}">${meta.metric_focus} · ${meta.chart_type}</div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost cm-stat-btn" data-template="${id}" style="font-size:9pt" title="Copy a one-line headline stat for pasting into Outlook">Copy stat</button>
              <button class="btn btn-ghost cm-export-btn" data-template="${id}" style="font-size:9pt">Copy data</button>
            </div>
          </div>
          ${bodyContainer}
        </div>`;
    }).join('');

    const headingLabel = vertical === 'gov' ? 'Government-Leased'
                       : vertical === 'dialysis' ? 'Dialysis'
                       : vertical === 'national_st' ? 'National Single-Tenant'
                       : vertical;
    const sourceCopy = vertical === 'national_st'
      ? 'TTM aggregates sourced from RCA TrendTracker quarterly exports. Buyer/seller/NM-attribution charts show "No data" until transaction-level data is folded in.'
      : 'Live-computed from sales_transactions. Each chart card links to underlying SQL view.';
    return `
      <div class="cm-dashboard" style="padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;border-left:4px solid ${navy};padding-left:12px">
          <div>
            <div style="font-family:'Calibri Light',sans-serif;font-size:18pt;font-weight:600;color:${navy}">Capital Markets — ${headingLabel}</div>
            <div style="font-size:9pt;color:${brandColor('nm_text_muted','#666')}">${sourceCopy}</div>
          </div>
          <div style="display:flex;gap:12px;align-items:center">
            <div>
              <label style="font-size:9pt;color:${brandColor('nm_axis','#6A748C')};margin-right:8px">Subspecialty:</label>
              <select id="cm-subspecialty-select" style="padding:6px 10px;border:1px solid #E7E6E6;border-radius:4px;font-family:Calibri,sans-serif">
                <option value="all">${vertical === 'gov' ? 'All Government-Leased' : vertical === 'dialysis' ? 'All Dialysis' : vertical === 'national_st' ? 'All Products (cross-product)' : 'All ' + vertical}</option>
                ${vertical === 'national_st' ? `
                  <option value="office">Office</option>
                  <option value="medical">Medical</option>
                  <option value="industrial">Industrial</option>
                  <option value="retail">Retail</option>
                ` : ''}
                ${subRows}
              </select>
            </div>
            <button id="cm-export-workbook-btn" style="padding:8px 14px;background:${navy};color:#fff;border:none;border-radius:4px;font-family:Calibri,sans-serif;font-size:10pt;font-weight:600;cursor:pointer" title="Download brand-styled .xlsx with all chart data — V1 ships data tabs only; V2 will embed pre-built charts bound to these tabs">
              ⬇ Export Workbook
            </button>
          </div>
        </div>
        <div id="cm-status" style="font-size:9pt;color:${brandColor('nm_axis','#6A748C')};margin-bottom:8px"></div>
        ${vertical === 'national_st' ? renderRcaUploadCard() : ''}
        <div class="cm-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${cards}</div>
        <div style="margin-top:16px;padding:10px;background:${brandColor('nm_pale','#E0E8F4')};border-radius:4px;font-size:9pt;color:${brandColor('nm_text','#191919')}">
          ${vertical === 'national_st'
            ? '<strong>Source:</strong> public.cm_rca_quarterly. Includes property or portfolio sales $2.5 million or greater (RCA TrendTracker convention). Cross-product cap rate is volume-weighted; quartile metrics are simple averages across products that report them.'
            : '<strong>Source:</strong> public.sales_transactions on the gov Supabase, filtered to closed sales (sold_price > 0). Northmarq attribution via cm_nm_broker_patterns. Cap rates are quarterly means; volumes and counts are TTM (4-quarter rolling).'}
        </div>
      </div>`;
  }

  // ---- RCA upload binding ----------------------------------------------------
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.onload = () => {
        const result = reader.result || '';
        // result is a data URL like 'data:...;base64,XXXX' — strip prefix
        const idx = String(result).indexOf('base64,');
        resolve(idx >= 0 ? String(result).slice(idx + 'base64,'.length) : '');
      };
      reader.readAsDataURL(file);
    });
  }

  async function postRcaImport(file, productType) {
    const file_b64 = await readFileAsBase64(file);
    const body = { filename: file.name, file_b64 };
    if (productType) body.product_type = productType;
    const r = await fetch('/api/capital-markets?action=rca_import', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-lcc-workspace': window.LCC?.workspaceId || '',
      },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await r.json(); } catch { /* ignore */ }
    if (!r.ok) {
      const msg = data?.detail || data?.error || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return data;
  }

  function bindRcaUpload(vertical) {
    if (vertical !== 'national_st') return;
    const status = document.getElementById('cm-rca-status');
    const setStatus = (msg, color) => {
      if (status) { status.textContent = msg; status.style.color = color || ''; }
    };

    const singleBtn = document.getElementById('cm-rca-single-upload');
    if (singleBtn) {
      singleBtn.addEventListener('click', async () => {
        const fileInput = document.getElementById('cm-rca-single-file');
        const productSel = document.getElementById('cm-rca-single-product');
        const file = fileInput?.files?.[0];
        if (!file) { setStatus('Pick a .xls file first.', '#c00'); return; }
        const productType = productSel?.value || '';
        singleBtn.disabled = true;
        const orig = singleBtn.textContent;
        singleBtn.textContent = 'Uploading…';
        setStatus(`Parsing ${file.name}…`);
        try {
          const result = await postRcaImport(file, productType);
          setStatus(
            `✓ ${result.product_type}: ${result.rows_loaded} rows ` +
            `(${result.period_range?.first} → ${result.period_range?.last}). ` +
            `Re-rendering charts…`,
            '#0a7d2c'
          );
          await renderCharts(vertical, cmState.currentSubspecialty);
        } catch (e) {
          setStatus(`✗ Upload failed: ${e.message}`, '#c00');
        } finally {
          singleBtn.disabled = false;
          singleBtn.textContent = orig;
        }
      });
    }

    const multiBtn = document.getElementById('cm-rca-multi-upload');
    if (multiBtn) {
      multiBtn.addEventListener('click', async () => {
        const fileInput = document.getElementById('cm-rca-multi-files');
        const files = Array.from(fileInput?.files || []);
        if (files.length === 0) { setStatus('Select 1-4 .xls files first.', '#c00'); return; }
        multiBtn.disabled = true;
        const orig = multiBtn.textContent;
        const summaries = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          multiBtn.textContent = `Uploading ${i + 1}/${files.length}…`;
          setStatus(`Parsing ${f.name} (${i + 1}/${files.length})…`);
          try {
            const result = await postRcaImport(f, '');  // auto-detect
            summaries.push(`${result.product_type}: ${result.rows_loaded} rows`);
          } catch (e) {
            summaries.push(`${f.name} FAILED: ${e.message}`);
          }
        }
        setStatus(`Done. ${summaries.join(' · ')}`, summaries.some(s => s.includes('FAILED')) ? '#c00' : '#0a7d2c');
        multiBtn.disabled = false;
        multiBtn.textContent = orig;
        await renderCharts(vertical, cmState.currentSubspecialty);
      });
    }
  }

  // ---- Period-summary renderer (data_shape='period_summary_table') ----------
  // Renders the 4-row × 7-col snapshot table that mirrors the master Excel's
  // "Industrial Volume & Cap Rate" / "Office Volume & Cap Rate" / etc. blocks.
  function renderPeriodSummary(container, chart) {
    if (!container || !chart.rows || chart.rows.length === 0) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:9pt">No data available</div>';
      return;
    }
    const navy = brandColor('nm_navy', '#003DA5');
    const pale = brandColor('nm_pale', '#E0E8F4');

    function fmtVal(format, v) {
      if (v == null) return '';
      const n = Number(v);
      if (!Number.isFinite(n)) return '';
      switch (format) {
        case 'currency_dollars':
        case 'currency_billions': {
          const abs = Math.abs(n);
          if (abs >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
          if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
          if (abs >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
          return '$' + n.toFixed(0);
        }
        case 'percent_basis_points': return (n * 100).toFixed(2) + '%';
        case 'percent_one_decimal':  return (n * 100).toFixed(1) + '%';
        default: return n.toLocaleString();
      }
    }

    function quartersBefore(asOf, k) {
      const m = String(asOf || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      const year = +m[1], q = Math.ceil(+m[2] / 3);
      const total = year * 4 + (q - 1) - k;
      const ty = Math.floor(total / 4);
      const tq = (total % 4) + 1;
      const month = tq * 3;
      const day = month === 6 || month === 9 ? 30 : 31;
      return `${ty}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    function periodLabel(asOf) {
      const m = String(asOf || '').match(/^(\d{4})-(\d{2})/);
      if (!m) return asOf || '';
      return `${m[1]}-Q${Math.ceil(+m[2] / 3)}`;
    }

    const asOf = chart.rows[0]?.as_of;
    const headers = ['Metric',
      periodLabel(asOf),
      periodLabel(quartersBefore(asOf, 1)),
      periodLabel(quartersBefore(asOf, 4)),
      periodLabel(quartersBefore(asOf, 8)),
      '5-Yr Avg', '10-Yr Avg', '15-Yr Avg',
    ];
    const dataKeys = ['current_q','prior_q','yoy_q','prior_cycle_q','avg_5yr','avg_10yr','avg_15yr'];

    const ths = headers.map(h => `<th style="background:${navy};color:#fff;font-family:'Calibri Light',sans-serif;font-weight:600;text-align:left;padding:8px 10px;font-size:9pt">${h}</th>`).join('');
    const trs = chart.rows.map((row, i) => {
      const bg = i % 2 === 1 ? pale : '#fff';
      const labelTd = `<td style="padding:6px 10px;font-family:Calibri,sans-serif;font-size:10pt;font-weight:600;border-bottom:1px solid #f0f0f0">${row.metric}</td>`;
      const valueTds = dataKeys.map(k =>
        `<td style="padding:6px 10px;font-family:Calibri,sans-serif;font-size:10pt;border-bottom:1px solid #f0f0f0;text-align:right">${fmtVal(row.format, row[k])}</td>`
      ).join('');
      return `<tr style="background:${bg}">${labelTd}${valueTds}</tr>`;
    }).join('');
    container.innerHTML = `<table style="width:100%;border-collapse:collapse"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  }

  // ---- DataTable renderer (chart_type='DataTable') ---------------------------
  function renderDataTable(container, chart) {
    if (!container || !chart.rows || chart.rows.length === 0) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:9pt">No data available</div>';
      return;
    }
    // Period-summary tables have their own renderer (different row shape)
    if (chart.data_shape === 'period_summary_table') {
      return renderPeriodSummary(container, chart);
    }
    const navy = brandColor('nm_navy', '#003DA5');
    const pale = brandColor('nm_pale', '#E0E8F4');
    const cols = Object.keys(chart.rows[0]);
    const fmt = (key, v) => {
      if (v == null) return '';
      if (typeof v === 'number') {
        if (key.includes('pct') || key.endsWith('_rate')) return (v * 100).toFixed(1) + '%';
        if (key.includes('rsf') || key.includes('lsf')) return Number(v).toLocaleString();
        if (key.includes('rent') || key.includes('price') || key.includes('volume')) {
          if (Math.abs(v) >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
          if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
          if (Math.abs(v) >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
          return '$' + Number(v).toFixed(2);
        }
        if (key.includes('rpsf') || key.includes('per_sf')) return '$' + Number(v).toFixed(2);
        return Number(v).toLocaleString();
      }
      return String(v);
    };
    const headers = cols.map(c => `<th style="position:sticky;top:0;background:${navy};color:#fff;font-family:'Calibri Light',sans-serif;font-weight:600;text-align:left;padding:8px 10px;font-size:9pt;border-bottom:2px solid ${navy}">${c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</th>`).join('');
    const rows = chart.rows.map((row, i) => {
      const tds = cols.map(c => `<td style="padding:6px 10px;font-family:Calibri,sans-serif;font-size:10pt;border-bottom:1px solid #f0f0f0">${fmt(c, row[c])}</td>`).join('');
      const bg = i % 2 === 1 ? pale : '#fff';
      return `<tr style="background:${bg}">${tds}</tr>`;
    }).join('');
    container.innerHTML = `<table style="width:100%;border-collapse:collapse"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ---- KPI block renderer (chart_type='kpi_block') ---------------------------
  // Renders a tile grid for the latest period_end. Each tile shows:
  //   - tile_label header
  //   - primary_value (formatted per primary_format)
  //   - if nm_value + non_nm_value present: split-comparison footer
  //
  // The view returns one row per (period_end x tile). We group by period_end
  // and pick the latest period that has any populated tiles.
  function renderKpiBlock(container, chart) {
    const navy = brandColor('nm_navy', '#003DA5');
    const sky  = brandColor('nm_sky',  '#62B5E5');
    const pale = brandColor('nm_pale', '#E0E8F4');
    const muted = brandColor('nm_text_muted', '#666');
    const text = brandColor('nm_text', '#191919');

    const rows = chart.rows || [];
    if (rows.length === 0) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:9pt">No data available</div>';
      return;
    }

    // Pick latest period_end where at least one tile has primary_value
    const periods = [...new Set(rows.map(r => r.period_end))].sort().reverse();
    let asOf = null;
    let tiles = [];
    for (const p of periods) {
      const candidates = rows.filter(r => r.period_end === p && r.primary_value != null);
      if (candidates.length > 0) {
        asOf = p;
        tiles = candidates.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        break;
      }
    }
    if (tiles.length === 0) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:9pt">No data available</div>';
      return;
    }

    function fmtVal(format, v) {
      if (v == null) return '—';
      const n = Number(v);
      if (!Number.isFinite(n)) return '—';
      switch (format) {
        case 'currency_billions': {
          const a = Math.abs(n);
          if (a >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
          if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
          if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
          return '$' + n.toFixed(0);
        }
        case 'currency_millions': {
          const a = Math.abs(n);
          if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
          if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
          return '$' + n.toFixed(0);
        }
        case 'currency_dollars': {
          if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
          return '$' + Math.round(n).toLocaleString('en-US');
        }
        case 'percent_basis_points': return (n * 100).toFixed(2) + '%';
        case 'percent_one_decimal':  return (n * 100).toFixed(1) + '%';
        default: return n.toLocaleString('en-US');
      }
    }

    function quarterLabel(d) {
      const m = String(d || '').match(/^(\d{4})-(\d{2})/);
      if (!m) return d;
      return `${m[1]}-Q${Math.ceil(+m[2] / 3)}`;
    }

    const tileHtml = tiles.map(t => {
      const hasSplit = (t.nm_value != null) && (t.non_nm_value != null);
      const split = hasSplit ? `
        <div style="display:flex;justify-content:space-around;margin-top:10px;padding-top:8px;border-top:1px solid ${pale}">
          <div style="text-align:center">
            <div style="font-size:8pt;color:${muted};text-transform:uppercase;letter-spacing:0.5px;font-family:'Calibri Light',sans-serif">${t.nm_label || 'NM'}</div>
            <div style="font-size:11pt;color:${navy};font-weight:600;font-family:'Calibri Light',sans-serif">${fmtVal(t.primary_format, t.nm_value)}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:8pt;color:${muted};text-transform:uppercase;letter-spacing:0.5px;font-family:'Calibri Light',sans-serif">${t.non_nm_label || 'Non-NM'}</div>
            <div style="font-size:11pt;color:${muted};font-weight:600;font-family:'Calibri Light',sans-serif">${fmtVal(t.primary_format, t.non_nm_value)}</div>
          </div>
        </div>` : '';
      return `
        <div style="flex:1;min-width:180px;padding:14px 16px;background:#fff;border:1px solid ${pale};border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.03)">
          <div style="font-size:9pt;color:${muted};text-transform:uppercase;letter-spacing:0.6px;font-family:'Calibri Light',sans-serif;margin-bottom:6px">${t.tile_label}</div>
          <div style="font-size:22pt;line-height:1.05;color:${navy};font-weight:600;font-family:'Calibri Light',sans-serif">${fmtVal(t.primary_format, t.primary_value)}</div>
          ${split}
        </div>`;
    }).join('');

    container.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${tileHtml}
      </div>
      <div style="font-size:8pt;color:${muted};margin-top:8px;font-style:italic">As of ${quarterLabel(asOf)} · Rolling 12-month TTM</div>`;
  }

  // ---- Render orchestration --------------------------------------------------
  async function renderCharts(vertical, subspecialty) {
    const status = document.getElementById('cm-status');
    if (status) status.textContent = 'Loading data…';
    try {
      const charts = await loadQuarterly(vertical, subspecialty);
      cmState.chartInstances.forEach((c, id) => destroyChart(id));
      let total = 0, ok = 0;
      for (const tplId of PHASE_1_TEMPLATES) {
        const chart = charts.find(c => c.chart_template_id === tplId);
        if (!chart || !chart.ok) continue;
        total++;
        if (chart.chart_type === 'DataTable') {
          const container = document.querySelector(`.cm-table-container[data-template="${tplId}"]`);
          if (!container) continue;
          renderDataTable(container, chart);
          ok++;
          continue;
        }
        if (chart.chart_type === 'kpi_block') {
          const container = document.querySelector(`.cm-kpi-container[data-template="${tplId}"]`);
          if (!container) continue;
          renderKpiBlock(container, chart);
          ok++;
          continue;
        }
        const canvas = document.querySelector(`canvas[data-template="${tplId}"]`);
        if (!canvas) continue;
        const inst = buildChart(canvas, chart);
        if (inst) {
          cmState.chartInstances.set(tplId, inst);
          ok++;
        }
      }
      if (status) {
        const latestVol = (charts.find(c => c.chart_template_id === 'volume_ttm_by_quarter')?.rows || []).slice(-1)[0];
        const asOfTxt = latestVol ? ` · latest period: ${periodEndLabel(latestVol.period_end)}` : '';
        status.textContent = `Rendered ${ok}/${total} charts · subspecialty=${subspecialty}${asOfTxt}`;
      }
    } catch (e) {
      if (status) status.textContent = `Error loading: ${e.message}`;
      console.error('cm renderCharts error:', e);
    }
  }

  // ============================================================================
  // Public entry: renderCapitalMarketsForVertical
  // Generic implementation used by both gov and dialysis tabs. The catalog's
  // applies_to_verticals filter (server-side) decides which chart cards show.
  // ============================================================================
  async function renderCapitalMarketsForVertical(vertical) {
    const el = document.getElementById('bizPageInner');
    if (!el) return '';
    el.innerHTML = '<div style="padding:24px;color:#666">Loading Capital Markets…</div>';

    try {
      await Promise.all([loadBrand(), loadCatalog(), loadSubspecialties(vertical)]);
    } catch (e) {
      el.innerHTML = `<div style="padding:24px;color:#c00">Failed to load Capital Markets reference data: ${e.message}</div>`;
      return '';
    }

    // Reset subspecialty when switching vertical (gov_ssa not valid for dialysis, etc.)
    if (cmState.currentVertical !== vertical) {
      cmState.currentSubspecialty = 'all';
    }
    cmState.currentVertical = vertical;
    el.innerHTML = renderSkeleton(vertical);

    // Bind subspecialty selector
    const sel = document.getElementById('cm-subspecialty-select');
    if (sel) {
      sel.value = cmState.currentSubspecialty;
      sel.addEventListener('change', (ev) => {
        cmState.currentSubspecialty = ev.target.value;
        renderCharts(vertical, cmState.currentSubspecialty);
      });
    }

    // Bind RCA upload card (national_st only)
    bindRcaUpload(vertical);

    // Bind copy-data buttons
    document.querySelectorAll('.cm-export-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tpl = btn.dataset.template;
        const charts = await loadQuarterly(vertical, cmState.currentSubspecialty);
        const chart = charts.find(c => c.chart_template_id === tpl);
        if (!chart) return;
        const tsv = chart.rows.length === 0 ? '' :
          [Object.keys(chart.rows[0]).join('\t'),
           ...chart.rows.map(r => Object.values(r).map(v => v == null ? '' : v).join('\t'))].join('\n');
        try {
          await navigator.clipboard.writeText(tsv);
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = 'Copy data'; }, 1500);
        } catch (e) {
          btn.textContent = 'Copy failed';
        }
      });
    });

    // Bind copy-stat buttons — one-line headline stat for Outlook drafts
    document.querySelectorAll('.cm-stat-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tpl = btn.dataset.template;
        const orig = btn.textContent;
        btn.textContent = '⏳';
        try {
          const url = `/api/capital-markets?action=copilot_stat&vertical=${encodeURIComponent(vertical)}&chart_template_id=${encodeURIComponent(tpl)}&subspecialty=${encodeURIComponent(cmState.currentSubspecialty)}`;
          const r = await fetchJSON(url);
          if (!r.ok) {
            btn.textContent = r.error === 'recipe_not_implemented' ? 'No stat for this chart' : 'No data';
            setTimeout(() => { btn.textContent = orig; }, 2000);
            return;
          }
          await navigator.clipboard.writeText(r.stat_text);
          btn.textContent = '✓ Stat copied';
          setTimeout(() => { btn.textContent = orig; }, 1800);
        } catch (e) {
          console.error('cm-stat-btn error:', e);
          btn.textContent = 'Copy failed';
          setTimeout(() => { btn.textContent = orig; }, 2000);
        }
      });
    });

    // Bind workbook export
    const exportBtn = document.getElementById('cm-export-workbook-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        const orig = exportBtn.textContent;
        exportBtn.disabled = true;
        exportBtn.textContent = '⏳ Generating…';
        try {
          const charts = await loadQuarterly(vertical, cmState.currentSubspecialty);
          const latestVol = (charts.find(c => c.chart_template_id === 'volume_ttm_by_quarter')?.rows || []).slice(-1)[0];
          const asOf = latestVol?.period_end || '';

          const url = `/api/capital-markets?action=export&vertical=${vertical}&subspecialty=${encodeURIComponent(cmState.currentSubspecialty)}&as_of=${encodeURIComponent(asOf)}&format=xlsx`;
          const r = await fetch(url, {
            credentials: 'include',
            headers: { 'x-lcc-workspace': window.LCC?.workspaceId || '' },
          });
          if (!r.ok) {
            const errText = await r.text().catch(() => '');
            throw new Error(`HTTP ${r.status}: ${errText.slice(0, 200)}`);
          }
          const cd = r.headers.get('Content-Disposition') || '';
          const match = cd.match(/filename="([^"]+)"/);
          const verticalLbl = vertical === 'gov' ? 'Gov' : vertical === 'dialysis' ? 'Dialysis' : vertical;
          const filename = match ? match[1] : `NM-CapMarkets-${verticalLbl}-${asOf || 'latest'}.xlsx`;
          const blob = await r.blob();
          const downloadUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(downloadUrl);
          exportBtn.textContent = '✓ Downloaded';
          setTimeout(() => { exportBtn.textContent = orig; }, 2000);
        } catch (e) {
          console.error('Export workbook error:', e);
          exportBtn.textContent = '✗ Failed';
          alert(`Export failed: ${e.message}`);
          setTimeout(() => { exportBtn.textContent = orig; }, 2500);
        } finally {
          exportBtn.disabled = false;
        }
      });
    }

    await renderCharts(vertical, cmState.currentSubspecialty);
    return '';
  }

  // Public entry — called by the gov tab router
  async function renderGovCapitalMarkets() {
    return renderCapitalMarketsForVertical('gov');
  }

  // Public entry — called by the dia tab router (Phase 2d: live, ~10 charts)
  async function renderDiaCapitalMarkets() {
    return renderCapitalMarketsForVertical('dialysis');
  }

  // Public entry — called by the national_st tab router (Phase 2f: RCA-driven)
  async function renderNatlStCapitalMarkets() {
    return renderCapitalMarketsForVertical('national_st');
  }

  // Expose to gov.js / app.js routers
  window.renderGovCapitalMarkets = renderGovCapitalMarkets;
  window.renderDiaCapitalMarkets = renderDiaCapitalMarkets;
  window.renderNatlStCapitalMarkets = renderNatlStCapitalMarkets;
})();
