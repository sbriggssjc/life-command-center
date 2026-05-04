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

  // Phase 1 chart templates we render (in display order)
  const PHASE_1_TEMPLATES = [
    'volume_ttm_by_quarter',
    'cap_rate_ttm_by_quarter',
    'nm_vs_market_cap',
    'transaction_count_ttm',
    'cap_rate_top_bottom_quartile',
    'avg_deal_size',
    'cap_rate_by_lease_term',
    'cap_rate_by_credit',
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

  function periodEndLabel(d) {
    if (!d) return '';
    const dt = new Date(d);
    const m = dt.getUTCMonth();
    const y = dt.getUTCFullYear();
    const q = Math.floor(m / 3) + 1;
    return `Q${q} '${String(y).slice(2)}`;
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
    const r = await fetchJSON('/api/capital-markets?action=catalog&phase=1');
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
      `/api/capital-markets?action=quarterly&vertical=${vertical}&subspecialty=${encodeURIComponent(subspecialty)}&phase=1`
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
    const labels = (chart.rows || []).map(r => periodEndLabel(r.period_end));
    let datasets = [];

    switch (chart.chart_template_id) {
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
        datasets = [
          { label: 'Northmarq Cap Rate', data: chart.rows.map(r => r.nm_cap_rate),
            borderColor: palette[0], backgroundColor: 'transparent', tension: 0.25, pointRadius: 3, pointBackgroundColor: palette[0], borderWidth: 2.5 },
          { label: 'Market Cap Rate', data: chart.rows.map(r => r.market_cap_rate),
            borderColor: palette[1], backgroundColor: 'transparent', tension: 0.25, pointRadius: 3, pointBackgroundColor: palette[1], borderWidth: 2.5 },
        ];
        return new Chart(canvas, { type: 'line', data: { labels, datasets },
          options: commonChartOptions('percent_basis_points') });
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
      default:
        return null;
    }
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
      return `
        <div class="cm-card" id="cm-card-${id}" style="background:#fff;border:1px solid #E7E6E6;border-radius:8px;padding:16px;margin:12px 0;box-shadow:0 1px 2px rgba(0,0,0,0.04)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
            <div>
              <div style="font-family:'Calibri Light',sans-serif;font-size:14pt;font-weight:600;color:${brandColor('nm_text','#191919')}">${meta.name}</div>
              <div style="font-size:9pt;color:${brandColor('nm_text_muted','#666')}">${meta.metric_focus} · ${meta.chart_type}</div>
            </div>
            <button class="btn btn-ghost cm-export-btn" data-template="${id}" style="font-size:9pt">Copy data</button>
          </div>
          <div style="position:relative;height:300px"><canvas data-template="${id}"></canvas></div>
        </div>`;
    }).join('');

    return `
      <div class="cm-dashboard" style="padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;border-left:4px solid ${navy};padding-left:12px">
          <div>
            <div style="font-family:'Calibri Light',sans-serif;font-size:18pt;font-weight:600;color:${navy}">Capital Markets — ${vertical === 'gov' ? 'Government-Leased' : vertical === 'dialysis' ? 'Dialysis' : vertical}</div>
            <div style="font-size:9pt;color:${brandColor('nm_text_muted','#666')}">Live-computed from sales_transactions. Each chart card links to underlying SQL view.</div>
          </div>
          <div style="display:flex;gap:12px;align-items:center">
            <div>
              <label style="font-size:9pt;color:${brandColor('nm_axis','#6A748C')};margin-right:8px">Subspecialty:</label>
              <select id="cm-subspecialty-select" style="padding:6px 10px;border:1px solid #E7E6E6;border-radius:4px;font-family:Calibri,sans-serif">
                <option value="all">All Government-Leased</option>
                ${subRows}
              </select>
            </div>
            <button id="cm-export-workbook-btn" style="padding:8px 14px;background:${navy};color:#fff;border:none;border-radius:4px;font-family:Calibri,sans-serif;font-size:10pt;font-weight:600;cursor:pointer" title="Download brand-styled .xlsx with all chart data — V1 ships data tabs only; V2 will embed pre-built charts bound to these tabs">
              ⬇ Export Workbook
            </button>
          </div>
        </div>
        <div id="cm-status" style="font-size:9pt;color:${brandColor('nm_axis','#6A748C')};margin-bottom:8px"></div>
        <div class="cm-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${cards}</div>
        <div style="margin-top:16px;padding:10px;background:${brandColor('nm_pale','#E0E8F4')};border-radius:4px;font-size:9pt;color:${brandColor('nm_text','#191919')}">
          <strong>Source:</strong> public.sales_transactions on the gov Supabase, filtered to closed sales (sold_price > 0). Northmarq attribution via cm_nm_broker_patterns. Cap rates are quarterly means; volumes and counts are TTM (4-quarter rolling).
        </div>
      </div>`;
  }

  // ---- Render orchestration --------------------------------------------------
  async function renderCharts(vertical, subspecialty) {
    const status = document.getElementById('cm-status');
    if (status) status.textContent = 'Loading data…';
    try {
      const charts = await loadQuarterly(vertical, subspecialty);
      // Destroy old chart instances first
      cmState.chartInstances.forEach((c, id) => destroyChart(id));
      // Build fresh
      let total = 0, ok = 0;
      for (const tplId of PHASE_1_TEMPLATES) {
        const chart = charts.find(c => c.chart_template_id === tplId);
        if (!chart || !chart.ok) continue;
        total++;
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

  // Public entry — called by the gov tab router
  async function renderGovCapitalMarkets() {
    const el = document.getElementById('bizPageInner');
    if (!el) return '';
    el.innerHTML = '<div style="padding:24px;color:#666">Loading Capital Markets…</div>';

    try {
      // Load reference data in parallel (cached after first call)
      await Promise.all([loadBrand(), loadCatalog(), loadSubspecialties('gov')]);
    } catch (e) {
      el.innerHTML = `<div style="padding:24px;color:#c00">Failed to load Capital Markets reference data: ${e.message}</div>`;
      return '';
    }

    cmState.currentVertical = 'gov';
    el.innerHTML = renderSkeleton('gov');

    // Bind subspecialty selector
    const sel = document.getElementById('cm-subspecialty-select');
    if (sel) {
      sel.value = cmState.currentSubspecialty;
      sel.addEventListener('change', (ev) => {
        cmState.currentSubspecialty = ev.target.value;
        renderCharts('gov', cmState.currentSubspecialty);
      });
    }

    // Bind copy-data buttons
    document.querySelectorAll('.cm-export-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tpl = btn.dataset.template;
        const charts = await loadQuarterly('gov', cmState.currentSubspecialty);
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

    // Bind workbook export button — downloads a brand-styled .xlsx
    const exportBtn = document.getElementById('cm-export-workbook-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        const orig = exportBtn.textContent;
        exportBtn.disabled = true;
        exportBtn.textContent = '⏳ Generating…';
        try {
          // Find the latest period to use as as_of (lets the workbook pin to a quarter)
          const charts = await loadQuarterly('gov', cmState.currentSubspecialty);
          const latestVol = (charts.find(c => c.chart_template_id === 'volume_ttm_by_quarter')?.rows || []).slice(-1)[0];
          const asOf = latestVol?.period_end || '';

          const url = `/api/capital-markets?action=export&vertical=gov&subspecialty=${encodeURIComponent(cmState.currentSubspecialty)}&as_of=${encodeURIComponent(asOf)}&format=xlsx`;
          const r = await fetch(url, {
            credentials: 'include',
            headers: { 'x-lcc-workspace': window.LCC?.workspaceId || '' },
          });
          if (!r.ok) {
            const errText = await r.text().catch(() => '');
            throw new Error(`HTTP ${r.status}: ${errText.slice(0, 200)}`);
          }

          // Pull filename from Content-Disposition or fall back to a default
          const cd = r.headers.get('Content-Disposition') || '';
          const match = cd.match(/filename="([^"]+)"/);
          const filename = match ? match[1] : `NM-CapMarkets-Gov-${asOf || 'latest'}.xlsx`;

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

    // Initial chart render
    await renderCharts('gov', cmState.currentSubspecialty);
    return '';  // we render directly to DOM; gov tab router expects this
  }

  // Mirror for dialysis (Phase 2 — placeholder for now)
  function renderDiaCapitalMarkets() {
    return '<div style="padding:24px;color:#666">Capital Markets for Dialysis lands in Phase 2 (after dialysis cm_dia_*_q views are built).</div>';
  }

  // Expose to gov.js / app.js routers
  window.renderGovCapitalMarkets = renderGovCapitalMarkets;
  window.renderDiaCapitalMarkets = renderDiaCapitalMarkets;
})();
