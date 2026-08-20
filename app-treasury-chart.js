// ─────────────────────────────────────────────────────────────────────────────
// app-treasury-chart.js — W6.5 Stage 3, Unit 2 (extracted from app.js
// 2026-08-20). Moved VERBATIM from app.js lines 6807-7037.
//
// The 10-yr Treasury widget + yield-history chart on the Today page:
//   yieldHistoryCache · currentYieldRange   per-range fetch cache + selection
//   loadMarket()                            the headline rate + day change
//   yearsForRange · fetchYieldHistory · filterByRange
//   loadYieldChart(range) · renderYieldSVG(container, data, range)
//
// ⚠️ ITS DOM WIRING DID **NOT** COME WITH IT, and that is deliberate.
// The map calls this a "self-contained Chart.js block". It is not: the
// yieldChartControls click handler lives inside a SHARED DOMContentLoaded
// bootstrap in app.js that ALSO calls applyRoute() — the hash router. Moving
// that block would have dragged the router out of app.js, which the map itself
// says to extract last if ever, and which the guard forbids. So the chart LOGIC
// moved and the bootstrap stayed whole; it reaches loadYieldChart() at CALL
// time across files, which the shared global scope resolves.
//
// (Contrast Unit 1: the modal's DOMContentLoaded block was ITS OWN and had to
// travel with it — leave it behind and the modal opens and never closes. Same
// construct, opposite correct answer. Read the block before assuming.)
//
// TREASURY_API_URL stays in app.js's config block (line ~189) and is read at
// call time inside the fetches here.
//
// CLASSIC script loaded BEFORE app.js.
// ─────────────────────────────────────────────────────────────────────────────

// ── Treasury Yield Chart ──
let yieldHistoryCache = {};
let currentYieldRange = '5D';

async function loadMarket() {
  try {
    const res = await fetch(TREASURY_API_URL);
    if (!res.ok) throw new Error('API returned ' + res.status);
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    if (d.ten_yr) {
      _setText('mktTreasury', d.ten_yr.toFixed(2) + '%');
      if (d.prev_ten_yr) {
        const chg = d.ten_yr - d.prev_ten_yr;
        const chgEl = document.getElementById('mktTreasuryChg');
        if (chgEl) {
          chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '% (as of ' + d.date + ')';
          chgEl.className = 'market-chg ' + (chg >= 0 ? 'market-up' : 'market-down');
        }
      }
    } else {
      throw new Error('No yield data');
    }
  } catch (e) {
    console.error('Market load error:', e);
    _setText('mktTreasury', '--');
    _setHTML('mktTreasuryChg', '<div class="widget-error"><div class="err-msg">Market data unavailable</div><button class="retry-btn" onclick="loadMarket()">Retry</button></div>');
  }
  // Load chart after market data
  loadYieldChart('1D');
}

function yearsForRange(range) {
  if (range === '3Y') return 3;
  if (range === '1Y') return 2; // fetch 2 to ensure full year coverage
  return 1;
}

async function fetchYieldHistory(numYears) {
  const key = 'y' + numYears;
  if (yieldHistoryCache[key]) return yieldHistoryCache[key];
  try {
    const res = await fetch(TREASURY_API_URL + '?history=true&years=' + numYears);
    if (!res.ok) throw new Error('History API returned ' + res.status);
    const d = await res.json();
    if (d.history && d.history.length > 0) {
      yieldHistoryCache[key] = d.history;
      return d.history;
    }
  } catch (e) {
    console.error('Yield history error:', e);
  }
  return [];
}

function filterByRange(data, range) {
  if (!data.length) return data;
  // 1D: show last 2 trading days (today + previous close) — Treasury only has daily closes
  if (range === '1D') return data.slice(-2);
  const now = new Date();
  let cutoff;
  switch (range) {
    case '5D': cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 10); break; // 10 calendar ≈ 5-7 trading
    case '1M': cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 1); break;
    case '3M': cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 3); break;
    case '6M': cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 6); break;
    case 'YTD': cutoff = new Date(now.getFullYear(), 0, 1); break;
    case '1Y': cutoff = new Date(now); cutoff.setFullYear(cutoff.getFullYear() - 1); break;
    case '3Y': cutoff = new Date(now); cutoff.setFullYear(cutoff.getFullYear() - 3); break;
    default: return data.slice(-10);
  }
  const cutStr = cutoff.toISOString().split('T')[0];
  return data.filter(d => d.date && d.date >= cutStr);
}

async function loadYieldChart(range) {
  currentYieldRange = range;
  const container = document.getElementById('yieldChartContainer');
  if (!container) return;
  container.innerHTML = '<div class="chart-loading"><span class="spinner"></span></div>';

  // Update active button
  document.querySelectorAll('#yieldChartControls button').forEach(b => {
    b.classList.toggle('active', b.dataset.range === range);
  });

  try {
    const numYears = yearsForRange(range);
    const allData = await fetchYieldHistory(numYears);
    const data = filterByRange(allData, range);

    if (data.length < 2) {
      container.innerHTML = '<div class="chart-loading" style="font-size:12px;color:var(--text2)">Not enough data for this range</div>';
      return;
    }

    renderYieldSVG(container, data, range);
  } catch (e) {
    console.warn('loadYieldChart error:', e);
    container.innerHTML = '<div class="chart-loading" style="font-size:12px;color:var(--text2)">Unable to load chart</div>';
  }
}

function renderYieldSVG(container, data, range) {
  const W = container.clientWidth || 320;
  const H = container.clientHeight || 160;
  const pad = { top: 10, right: 10, bottom: 24, left: 54 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  const vals = data.map(d => d.ten_yr).filter(v => typeof v === 'number' && !isNaN(v));
  if (vals.length < 2) { container.innerHTML = '<div class="chart-loading" style="font-size:12px;color:var(--text2)">Insufficient numeric data</div>'; return; }
  const minY = Math.floor((Math.min(...vals) - 0.05) * 20) / 20;
  const maxY = Math.ceil((Math.max(...vals) + 0.05) * 20) / 20;
  const rangeY = maxY - minY || 0.1;

  const xScale = (i) => pad.left + (i / (data.length - 1)) * cw;
  const yScale = (v) => pad.top + ch - ((v - minY) / rangeY) * ch;

  // Determine color: green if last > first, red if down
  const startVal = data[0].ten_yr;
  const endVal = data[data.length - 1].ten_yr;
  const lineColor = endVal >= startVal ? 'var(--green, #22c55e)' : 'var(--red, #ef4444)';
  const fillColor = endVal >= startVal ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';

  // Build path
  let pathD = '';
  let areaD = '';
  data.forEach((d, i) => {
    const x = xScale(i);
    const y = yScale(d.ten_yr);
    pathD += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    areaD += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  });
  // Close area path
  areaD += 'L' + xScale(data.length - 1).toFixed(1) + ',' + (pad.top + ch) + 'L' + pad.left + ',' + (pad.top + ch) + 'Z';

  // Y-axis ticks (4-5 ticks)
  const numTicks = 4;
  const tickStep = rangeY / numTicks;
  let yTicks = '';
  let gridLines = '';
  for (let i = 0; i <= numTicks; i++) {
    const val = minY + i * tickStep;
    const y = yScale(val);
    yTicks += `<text x="${pad.left - 4}" y="${y + 3}" text-anchor="end" class="yield-axis">${val.toFixed(2)}%</text>`;
    if (i > 0 && i < numTicks) {
      gridLines += `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" class="yield-grid"/>`;
    }
  }

  // X-axis labels (3-5 dates)
  const labelCount = Math.min(5, data.length);
  let xLabels = '';
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round(i * (data.length - 1) / (labelCount - 1));
    const x = xScale(idx);
    const d = data[idx];
    const dt = new Date(d.date + 'T12:00:00');
    const label = (dt.getMonth() + 1) + '/' + dt.getDate() + (range === '1Y' || range === '3Y' ? '/' + String(dt.getFullYear()).slice(2) : '');
    xLabels += `<text x="${x}" y="${H - 4}" text-anchor="middle" class="yield-axis">${label}</text>`;
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <g class="yield-grid">${gridLines}</g>
    ${yTicks}${xLabels}
    <path d="${areaD}" fill="${fillColor}"/>
    <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="1.5" stroke-linejoin="round"/>
    <line id="yieldCrossH" class="yield-crosshair" x1="0" y1="0" x2="0" y2="0" style="display:none"/>
    <circle id="yieldDot" cx="0" cy="0" r="3" fill="${lineColor}" style="display:none"/>
    <rect class="yield-hover-zone" x="${pad.left}" y="${pad.top}" width="${cw}" height="${ch}" fill="transparent" style="cursor:crosshair"/>
  </svg>`;

  container.innerHTML = svg;

  // Tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'yield-tooltip';
  tooltip.style.display = 'none';
  container.appendChild(tooltip);

  const hoverZone = container.querySelector('.yield-hover-zone');
  const crossH = container.querySelector('#yieldCrossH');
  const dot = container.querySelector('#yieldDot');
  const svgEl = container.querySelector('svg');
  if (!hoverZone || !crossH || !dot || !svgEl) return;
  const svgRect = () => svgEl.getBoundingClientRect();

  function handleMove(e) {
    const rect = svgRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const relX = clientX - rect.left;
    const scaleRatio = W / rect.width;
    const svgX = relX * scaleRatio;
    const dataX = (svgX - pad.left) / cw;
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(dataX * (data.length - 1))));
    const d = data[idx];
    const cx = xScale(idx);
    const cy = yScale(d.ten_yr);

    crossH.setAttribute('x1', cx); crossH.setAttribute('y1', pad.top);
    crossH.setAttribute('x2', cx); crossH.setAttribute('y2', pad.top + ch);
    crossH.style.display = '';
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
    dot.style.display = '';

    const dt = new Date(d.date + 'T12:00:00');
    const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const chg = d.ten_yr - startVal;
    const chgStr = (chg >= 0 ? '+' : '') + chg.toFixed(2);
    const chgColor = chg >= 0 ? 'var(--green, #22c55e)' : 'var(--red, #ef4444)';
    tooltip.innerHTML = `<div class="tt-date">${dateStr}</div><div class="tt-val">${d.ten_yr.toFixed(2)}%</div><div style="font-size:11px;color:${chgColor}">${chgStr}% from start</div>`;
    tooltip.style.display = '';

    // Position tooltip
    const tipX = relX < rect.width / 2 ? relX + 12 : relX - tooltip.offsetWidth - 12;
    tooltip.style.left = tipX + 'px';
    tooltip.style.top = '0px';
  }

  function handleLeave() {
    crossH.style.display = 'none';
    dot.style.display = 'none';
    tooltip.style.display = 'none';
  }

  hoverZone.addEventListener('mousemove', handleMove);
  hoverZone.addEventListener('mouseleave', handleLeave);
  hoverZone.addEventListener('touchmove', handleMove, { passive: true });
  hoverZone.addEventListener('touchend', handleLeave);
}
