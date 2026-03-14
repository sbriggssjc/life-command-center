// ============================================================================
// DIALYSIS DASHBOARD MODULE
// Vanilla JavaScript implementation of Dialysis dashboard
// Loaded after index.html, overrides placeholder functions
// ============================================================================

// ============================================================================
// MODULE STATE
// ============================================================================

let diaCharts = {};
let diaResearchMode = 'property'; // 'property' | 'lease'
let diaResearchIdx = 0;
let diaPropertyFilter = { review_type: null, state: null };
let diaLeaseFilter = { priority: null };
let diaChangeFilter = 'all'; // 'all' | 'added' | 'removed' | 'persistent'
let diaNpiFilter = null; // filter by signal_type

// ============================================================================
// QUERY FUNCTION
// ============================================================================

/**
 * Query Dialysis Supabase via REST API
 * @param {string} table - view or table name
 * @param {string} select - columns to select (e.g., '*' or 'col1,col2')
 * @param {object} params - {filter, order, limit, offset}
 */
async function diaQuery(table, select, params = {}) {
  // Query via serverless proxy — keeps secret key server-side
  const { filter, order, limit = 1000, offset = 0 } = params;

  const url = new URL('/api/dia-query', window.location.origin);
  url.searchParams.set('table', table);
  url.searchParams.set('select', select);
  if (filter) url.searchParams.set('filter', filter);
  if (order) url.searchParams.set('order', order);
  if (limit !== undefined) url.searchParams.set('limit', limit);
  if (offset !== undefined) url.searchParams.set('offset', offset);

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`diaQuery ${table}: HTTP ${response.status}`, errBody);
      return [];
    }

    const result = await response.json();
    return result.data || [];
  } catch (err) {
    console.error('diaQuery error:', err);
    return [];
  }
}

// ============================================================================
// DATA LOADING
// ============================================================================

/**
 * Load all dialysis data
 */
async function loadDiaData() {
  // Show loading indicator
  const inner = document.getElementById('bizPageInner');
  if (inner) {
    inner.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading dialysis data...</p></div>';
  }

  try {
    diaData = {
      freshness: {},
      inventorySummary: {},
      inventoryChanges: [],
      npiSummary: {},
      npiSignals: [],
      moversUp: [],
      moversDown: [],
      propertyReviewQueue: [],
      leaseBackfillRows: [],
      researchOutcomes: [],
      reconciliation: {}
    };
    
    // Load freshness
    const freshness = await diaQuery('v_counts_freshness', '*');
    if (freshness && freshness.length > 0) {
      diaData.freshness = freshness[0];
    }
    
    // Load inventory summary
    const invSummary = await diaQuery('v_clinic_inventory_diff_summary', '*');
    if (invSummary && invSummary.length > 0) {
      invSummary.forEach(row => {
        diaData.inventorySummary[row.change_type] = row;
      });
    }
    
    // Load latest inventory changes
    const invChanges = await diaQuery('v_clinic_inventory_latest_diff', '*', { limit: 500 });
    diaData.inventoryChanges = invChanges || [];
    
    // Separate movers up/down and limit to top 10
    const moversUpList = diaData.inventoryChanges.filter(r => r.delta_patients > 0);
    const moversDownList = diaData.inventoryChanges.filter(r => r.delta_patients < 0);
    moversUpList.sort((a, b) => b.delta_patients - a.delta_patients);
    moversDownList.sort((a, b) => a.delta_patients - b.delta_patients);
    diaData.moversUp = moversUpList.slice(0, 10);
    diaData.moversDown = moversDownList.slice(0, 10);
    
    // Load NPI signal summary
    const npiSignalSummary = await diaQuery('v_npi_inventory_signal_summary', '*');
    if (npiSignalSummary && npiSignalSummary.length > 0) {
      npiSignalSummary.forEach(row => {
        diaData.npiSummary[row.signal_type] = row;
      });
    }
    
    // Load NPI signals
    const npiSignals = await diaQuery('v_npi_inventory_signals', '*', { limit: 300 });
    diaData.npiSignals = npiSignals || [];
    
    // Load property review queue
    const propQueue = await diaQuery('v_clinic_property_link_review_queue', '*', { limit: 200 });
    diaData.propertyReviewQueue = propQueue || [];
    
    // Load lease backfill candidates
    const leaseQueue = await diaQuery('v_clinic_lease_backfill_candidates', '*', { limit: 200 });
    diaData.leaseBackfillRows = leaseQueue || [];
    
    // Load research outcomes
    const outcomes = await diaQuery('research_queue_outcomes', '*', { limit: 500 });
    diaData.researchOutcomes = outcomes || [];
    
    // Load reconciliation
    const recon = await diaQuery('v_ingestion_reconciliation', '*', { limit: 1 });
    if (recon && recon.length > 0) {
      diaData.reconciliation = recon[0];
    }
    
    diaDataLoaded = true;
    console.log('DIA DATA LOADED:', {
      freshness: diaData.freshness,
      invSummaryKeys: Object.keys(diaData.inventorySummary),
      inventoryChanges: diaData.inventoryChanges.length,
      npiSummaryKeys: Object.keys(diaData.npiSummary),
      npiSignals: diaData.npiSignals.length,
      propertyQueue: diaData.propertyReviewQueue.length,
      leaseBackfill: diaData.leaseBackfillRows.length,
      outcomes: diaData.researchOutcomes.length,
      recon: diaData.reconciliation
    });
    showToast(`Dialysis: ${(diaData.freshness || {}).total_clinics || 0} clinics, ${diaData.inventoryChanges.length} changes, ${diaData.npiSignals.length} signals loaded`, 'success');
    renderDiaTab();
  } catch (err) {
    console.error('loadDiaData error:', err);
    // Show error in the UI instead of just console
    const inner = document.getElementById('bizPageInner');
    if (inner) {
      inner.innerHTML = '<div style="text-align:center;padding:32px;color:var(--red)"><p style="font-size:16px;margin-bottom:8px">Failed to load dialysis data</p><p style="color:var(--text2);font-size:13px">' + (err.message || 'Unknown error') + '</p><button class="gov-btn" onclick="loadDiaData()" style="margin-top:12px">Retry</button></div>';
    }
  }
}

// ============================================================================
// MAIN TAB ROUTER
// ============================================================================

/**
 * Route to correct tab renderer
 */
function renderDiaTab() {
  const inner = q('#bizPageInner');
  if (!inner) return;
  
  switch (currentDiaTab) {
    case 'overview':
      inner.innerHTML = renderDiaOverview();
      break;
    case 'search':
      inner.innerHTML = renderDiaSearch();
      break;
    case 'changes':
      inner.innerHTML = renderDiaChanges();
      break;
    case 'npi':
      inner.innerHTML = renderDiaNpi();
      break;
    case 'sales':
      inner.innerHTML = renderDiaSales();
      break;
    case 'players':
      inner.innerHTML = renderDiaPlayers();
      break;
    case 'research':
      inner.innerHTML = renderDiaResearch();
      break;
    case 'activity':
      inner.innerHTML = renderDiaActivity();
      break;
    default:
      inner.innerHTML = '<p style="color: var(--text2);">Unknown tab</p>';
  }
}

// ============================================================================
// OVERVIEW TAB
// ============================================================================

/**
 * Render overview dashboard
 */
function renderDiaOverview() {
  let html = '<div class="biz-section">';
  
  // Metrics row
  html += '<div class="gov-metrics">';
  
  const freshness = diaData.freshness || {};
  const totalClinics = freshness.total_clinics || 0;
  const coveragePct = freshness.coverage_pct || 0;
  const addedCount = (diaData.inventorySummary.added?.clinic_count || 0);
  const removedCount = (diaData.inventorySummary.removed?.clinic_count || 0);
  const npiSignalCount = Object.values(diaData.npiSummary).reduce((s, r) => s + (r.signal_count || 0), 0);
  
  html += metricHTML('Total Clinics', fmtN(totalClinics), 'tracked nationwide', '');
  html += metricHTML('Coverage %', coveragePct.toFixed(1) + '%', 'of clinics counted', '');
  html += metricHTML('Changes This Month', fmtN(addedCount + removedCount), `${fmtN(addedCount)} added, ${fmtN(removedCount)} removed`, '');
  html += metricHTML('NPI Signals', fmtN(npiSignalCount), 'requiring attention', '');
  
  html += '</div>';
  
  // Run Pulse section
  html += '<div class="biz-section">';
  html += '<h3 class="gov-chart-title">Run Pulse</h3>';
  html += '<div class="data-table">';
  
  const recon = diaData.reconciliation;
  if (recon && recon.started_at) {
    const reconStatus = recon.run_status || 'unknown';
    const statusColor = reconStatus === 'success' ? 'green' : reconStatus === 'running' ? 'amber' : 'red';
    
    html += '<div class="table-row">';
    html += `<div style="flex: 1;">Latest Run</div>`;
    html += `<div style="flex: 2; color: var(--text2);">${new Date(recon.started_at).toLocaleString()}</div>`;
    html += `<div class="status-dot ${statusColor}"></div>`;
    html += `<div style="flex: 1; text-align: right; color: var(--text2);">${reconStatus}</div>`;
    html += '</div>';
    
    if (recon.rows_fetched !== undefined) {
      html += '<div class="table-row">';
      html += `<div style="flex: 1;">Rows Fetched</div>`;
      html += `<div style="flex: 4; text-align: right; color: var(--accent);">${fmtN(recon.rows_fetched)}</div>`;
      html += '</div>';
    }
    
    if (recon.rows_updated !== undefined) {
      html += '<div class="table-row">';
      html += `<div style="flex: 1;">Rows Updated</div>`;
      html += `<div style="flex: 4; text-align: right; color: var(--accent);">${fmtN(recon.rows_updated)}</div>`;
      html += '</div>';
    }
    
    if (recon.reconciliation_gap !== undefined) {
      html += '<div class="table-row">';
      html += `<div style="flex: 1;">Reconciliation Gap</div>`;
      html += `<div style="flex: 4; text-align: right; color: var(--text2);">${fmtN(recon.reconciliation_gap)}</div>`;
      html += '</div>';
    }
  } else {
    html += '<div class="table-empty">No reconciliation data</div>';
  }
  
  html += '</div>';
  html += '</div>';
  
  // Top movers charts
  html += '<div class="gov-chart-row">';
  html += '<div class="gov-chart-card"><div class="gov-chart-title">Top 10 Movers Up</div><div class="chart-container"><canvas id="diaMoversUpChart"></canvas></div></div>';
  html += '<div class="gov-chart-card"><div class="gov-chart-title">Top 10 Movers Down</div><div class="chart-container"><canvas id="diaMoversDownChart"></canvas></div></div>';
  html += '</div>';
  
  html += '</div>';
  
  // Render charts after HTML is inserted
  setTimeout(() => {
    renderDiaMoversChart();
  }, 0);
  
  return html;
}

/**
 * Render movers charts
 */
function renderDiaMoversChart() {
  // renderBarChart(id, labels[], datasets[], isMoney) — from gov.js
  const upLabels = diaData.moversUp.map(r => (r.facility_name || '').substring(0, 20));
  const upValues = diaData.moversUp.map(r => r.delta_patients);

  const downLabels = diaData.moversDown.map(r => (r.facility_name || '').substring(0, 20));
  const downValues = diaData.moversDown.map(r => Math.abs(r.delta_patients));

  if (upLabels.length > 0 && typeof renderBarChart === 'function') {
    renderBarChart('diaMoversUpChart', upLabels, [{ label: 'Patients Added', data: upValues }], false);
  }

  if (downLabels.length > 0 && typeof renderBarChart === 'function') {
    renderBarChart('diaMoversDownChart', downLabels, [{ label: 'Patients Lost', data: downValues }], false);
  }
}

// ============================================================================
// CHANGES TAB
// ============================================================================

/**
 * Render inventory changes tab
 */
function renderDiaChanges() {
  let html = '<div class="biz-section">';
  
  // Metrics
  html += '<div class="gov-metrics">';
  const addedCount = (diaData.inventorySummary.added?.clinic_count || 0);
  const removedCount = (diaData.inventorySummary.removed?.clinic_count || 0);
  const persistentCount = (diaData.inventorySummary.persistent?.clinic_count || 0);
  
  html += metricHTML('Added', fmtN(addedCount), 'new clinics', '');
  html += metricHTML('Removed', fmtN(removedCount), 'clinics closed', '');
  html += metricHTML('Persistent', fmtN(persistentCount), 'unchanged clinics', '');
  html += metricHTML('Total Changes', fmtN(addedCount + removedCount), 'this month', '');
  html += '</div>';
  
  // Filter pills
  html += '<div class="pills" style="margin: 20px 0;">';
  const types = ['all', 'added', 'removed', 'persistent'];
  types.forEach(type => {
    const active = diaChangeFilter === type ? ' active' : '';
    html += `<button class="pill${active}" data-filter="${type}">${type}</button>`;
  });
  html += '</div>';
  
  // Table
  html += '<div class="table-wrapper">';
  html += '<div class="data-table">';
  
  let filtered = diaData.inventoryChanges;
  if (diaChangeFilter !== 'all') {
    filtered = filtered.filter(r => r.change_type === diaChangeFilter);
  }
  
  if (filtered.length === 0) {
    html += '<div class="table-empty">No changes to display</div>';
  } else {
    // Header
    html += '<div class="table-row" style="font-weight: 600; border-bottom: 1px solid var(--border);">';
    html += '<div style="flex: 2;">Facility</div>';
    html += '<div style="flex: 1;">City</div>';
    html += '<div style="flex: 1;">State</div>';
    html += '<div style="flex: 1;">Operator</div>';
    html += '<div style="flex: 1; text-align: right;">Patients</div>';
    html += '<div style="flex: 1; text-align: right;">Delta</div>';
    html += '<div style="flex: 1; text-align: right;">% Change</div>';
    html += '</div>';
    
    filtered.slice(0, 100).forEach(row => {
      const isLargeMove = Math.abs(row.delta_patients || 0) > 100;
      const npiChanged = row.snapshot_npi_changed ? ' • NPI Changed' : '';
      const highlight = isLargeMove ? 'background: rgba(251, 191, 36, 0.1);' : '';
      
      html += `<div class="table-row clickable-row" style="${highlight}" onclick='showDetail(${JSON.stringify(row).replace(/'/g,"&#39;")}, "dia-clinic")'>`;
      html += `<div style="flex: 2;" class="truncate">${esc(row.facility_name || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.city || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.state || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.operator_name || '')}</div>`;
      html += `<div style="flex: 1; text-align: right; color: var(--accent);">${fmtN(row.latest_total_patients || 0)}</div>`;
      html += `<div style="flex: 1; text-align: right; color: ${row.delta_patients > 0 ? '#34d399' : '#f87171'};">${row.delta_patients > 0 ? '+' : ''}${fmtN(row.delta_patients || 0)}</div>`;
      html += `<div style="flex: 1; text-align: right; color: var(--text2);">${pct(row.pct_change || 0)}</div>`;
      html += '</div>';
    });
  }
  
  html += '</div>';
  html += '</div>';
  html += '</div>';
  
  // Attach filter handlers after HTML
  setTimeout(() => {
    document.querySelectorAll('.pills .pill').forEach(btn => {
      btn.addEventListener('click', e => {
        diaChangeFilter = e.target.dataset.filter;
        renderDiaTab();
      });
    });
  }, 0);
  
  return html;
}

// ============================================================================
// NPI TAB
// ============================================================================

/**
 * Render NPI Intelligence tab
 */
function renderDiaNpi() {
  let html = '<div class="biz-section">';
  
  // Signal summary metrics
  html += '<div class="gov-metrics">';
  
  let totalSignals = 0;
  const signalTypes = {};
  
  diaData.npiSignals.forEach(row => {
    totalSignals++;
    const type = row.signal_type || 'unknown';
    signalTypes[type] = (signalTypes[type] || 0) + 1;
  });
  
  html += metricHTML('Total Signals', fmtN(totalSignals), 'NPI intelligence signals', '');
  html += metricHTML('Signal Types', fmtN(Object.keys(signalTypes).length), 'different categories', '');
  
  Object.entries(signalTypes).slice(0, 2).forEach(([type, count]) => {
    html += metricHTML(type || 'Unknown', fmtN(count), 'signals', '');
  });
  
  html += '</div>';
  
  // Filter pills by signal type
  html += '<div class="pills" style="margin: 20px 0;">';
  html += '<button class="pill active" data-filter="all">All</button>';
  Object.keys(signalTypes).forEach(type => {
    const active = diaNpiFilter === type ? ' active' : '';
    html += `<button class="pill${active}" data-filter="${type}">${type || 'Unknown'}</button>`;
  });
  html += '</div>';
  
  // Signals table
  html += '<div class="table-wrapper">';
  html += '<div class="data-table">';
  
  let filtered = diaData.npiSignals;
  if (diaNpiFilter && diaNpiFilter !== 'all') {
    filtered = filtered.filter(r => r.signal_type === diaNpiFilter);
  }
  
  if (filtered.length === 0) {
    html += '<div class="table-empty">No signals</div>';
  } else {
    // Header
    html += '<div class="table-row" style="font-weight: 600; border-bottom: 1px solid var(--border);">';
    html += '<div style="flex: 1.5;">Signal Type</div>';
    html += '<div style="flex: 2;">Facility</div>';
    html += '<div style="flex: 1;">City</div>';
    html += '<div style="flex: 1;">State</div>';
    html += '<div style="flex: 1;">Operator</div>';
    html += '<div style="flex: 1; text-align: right;">Patients</div>';
    html += '</div>';
    
    filtered.slice(0, 150).forEach(row => {
      const signalColor = row.signal_type === 'npi_changed' ? 'var(--accent)' : 'var(--text2)';
      
      html += `<div class="table-row clickable-row" onclick='showDetail(${JSON.stringify(row).replace(/'/g,"&#39;")}, "dia-clinic")'>`;
      html += `<div style="flex: 1.5; color: ${signalColor};">${esc(row.signal_type || '')}</div>`;
      html += `<div style="flex: 2;" class="truncate">${esc(row.facility_name || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.city || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.state || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.operator_name || '')}</div>`;
      html += `<div style="flex: 1; text-align: right; color: var(--accent);">${fmtN(row.latest_total_patients || 0)}</div>`;
      html += '</div>';
    });
  }
  
  html += '</div>';
  html += '</div>';
  html += '</div>';
  
  // Attach filter handlers
  setTimeout(() => {
    document.querySelectorAll('.pills .pill').forEach(btn => {
      btn.addEventListener('click', e => {
        const filter = e.target.dataset.filter;
        diaNpiFilter = filter === 'all' ? null : filter;
        renderDiaTab();
      });
    });
  }, 0);
  
  return html;
}

// ============================================================================
// RESEARCH TAB (WORKBENCH)
// ============================================================================

/**
 * Render research workbench
 */
function renderDiaResearch() {
  let html = '<div class="research-workbench">';
  
  // Mode tabs
  html += '<div style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 10px;">';
  html += `<button class="btn-link${diaResearchMode === 'property' ? '-green' : ''}" data-mode="property">Property Review Queue</button>`;
  html += `<button class="btn-link${diaResearchMode === 'lease' ? '-green' : ''}" data-mode="lease">Lease Backfill Queue</button>`;
  html += '</div>';
  
  if (diaResearchMode === 'property') {
    html += renderDiaPropertyResearch();
  } else {
    html += renderDiaLeaseResearch();
  }
  
  html += '</div>';
  
  // Attach mode handlers
  setTimeout(() => {
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', e => {
        diaResearchMode = e.target.dataset.mode;
        diaResearchIdx = 0;
        renderDiaTab();
      });
    });
  }, 0);
  
  return html;
}

/**
 * Render property review queue section
 */
function renderDiaPropertyResearch() {
  let html = '<div class="research-progress" style="margin-bottom: 30px;">';
  
  const total = diaData.propertyReviewQueue.length;
  const reviewed = diaData.researchOutcomes.filter(o => o.queue_type === 'property_review').length;
  const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  
  html += `<div class="progress-text">${reviewed} of ${total} reviewed (${pct}%)</div>`;
  html += `<div class="progress-bar"><div style="width: ${pct}%; background: #34d399;"></div></div>`;
  html += '</div>';
  
  // Summary metrics
  html += '<div class="gov-metrics" style="margin-bottom: 30px;">';
  
  const pending = diaData.propertyReviewQueue.length;
  const largeClinic = diaData.propertyReviewQueue.filter(r => r.total_patients > 200).length;
  
  html += metricHTML('Pending Review', fmtN(pending), 'items in queue', '');
  html += metricHTML('Large Clinics', fmtN(largeClinic), '200+ patients', '');
  html += metricHTML('States', fmtN(new Set(diaData.propertyReviewQueue.map(r => r.state)).size), 'represented', '');
  html += metricHTML('Avg Patients', fmtN(Math.round(diaData.propertyReviewQueue.reduce((s, r) => s + (r.total_patients || 0), 0) / Math.max(pending, 1))), 'per clinic', '');
  
  html += '</div>';
  
  // Filter
  html += '<div class="pills" style="margin: 20px 0;">';
  html += '<button class="pill active" data-filter-type="all">All</button>';
  const reviewTypes = [...new Set(diaData.propertyReviewQueue.map(r => r.review_type))];
  reviewTypes.forEach(type => {
    html += `<button class="pill" data-filter-type="${type}">${type}</button>`;
  });
  html += '</div>';
  
  // Queue table
  html += '<div class="table-wrapper" style="margin-bottom: 20px;">';
  html += '<div class="data-table">';
  
  let filtered = diaData.propertyReviewQueue;
  if (diaPropertyFilter.review_type) {
    filtered = filtered.filter(r => r.review_type === diaPropertyFilter.review_type);
  }
  
  if (filtered.length === 0) {
    html += '<div class="table-empty">No items in queue</div>';
  } else {
    html += '<div class="table-row" style="font-weight: 600; border-bottom: 1px solid var(--border);">';
    html += '<div style="flex: 0.5;">ID</div>';
    html += '<div style="flex: 2;">Facility</div>';
    html += '<div style="flex: 1;">Operator</div>';
    html += '<div style="flex: 0.5;">State</div>';
    html += '<div style="flex: 0.7; text-align: right;">Patients</div>';
    html += '<div style="flex: 1;">Review Type</div>';
    html += '</div>';
    
    filtered.slice(0, 50).forEach((row, idx) => {
      html += `<div class="table-row clickable-row" style="cursor: pointer;" data-prop-idx="${idx}">`;
      html += `<div style="flex: 0.5; color: var(--text2);">${row.clinic_id}</div>`;
      html += `<div style="flex: 2;" class="truncate">${esc(row.facility_name || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.operator_name || '')}</div>`;
      html += `<div style="flex: 0.5;">${row.state}</div>`;
      html += `<div style="flex: 0.7; text-align: right; color: var(--accent);">${fmtN(row.total_patients || 0)}</div>`;
      html += `<div style="flex: 1; color: var(--text2);">${row.review_type}</div>`;
      html += `<div style="flex: 0.3; text-align: right;"><span style="color:var(--accent);font-size:16px" title="Open detail" onclick='event.stopPropagation();showDetail(${JSON.stringify(row).replace(/'/g,"&#39;")}, "dia-clinic")'>&rsaquo;</span></div>`;
      html += '</div>';
    });
  }
  
  html += '</div>';
  html += '</div>';
  
  // Research card for selected item
  if (diaPropertyFilter.selectedIdx !== undefined && filtered[diaPropertyFilter.selectedIdx]) {
    const item = filtered[diaPropertyFilter.selectedIdx];
    html += renderDiaPropertyCard(item);
  }
  
  // Attach handlers
  setTimeout(() => {
    document.querySelectorAll('[data-filter-type]').forEach(btn => {
      btn.addEventListener('click', e => {
        diaPropertyFilter.review_type = e.target.dataset.filterType === 'all' ? null : e.target.dataset.filterType;
        renderDiaTab();
      });
    });
    
    document.querySelectorAll('[data-prop-idx]').forEach(row => {
      row.addEventListener('click', e => {
        diaPropertyFilter.selectedIdx = parseInt(e.currentTarget.dataset.propIdx);
        renderDiaTab();
      });
    });
  }, 0);
  
  return html;
}

/**
 * Render property review card
 */
function renderDiaPropertyCard(item) {
  let html = '<div class="research-card" style="display: grid; grid-template-columns: 1fr 460px; gap: 20px; margin-top: 20px;">';
  
  // Context
  html += '<div class="research-context">';
  html += `<div class="context-block">`;
  html += `<div class="context-label">Facility</div>`;
  html += `<div class="context-value">${esc(item.facility_name || '')}</div>`;
  html += `</div>`;
  
  html += `<div class="context-block">`;
  html += `<div class="context-label">Operator / Clinic ID</div>`;
  html += `<div class="context-value">${esc(item.operator_name || '')} / ${item.clinic_id}</div>`;
  html += `</div>`;
  
  html += `<div class="context-block">`;
  html += `<div class="context-label">Location</div>`;
  html += `<div class="context-value">${item.state || ''}</div>`;
  html += `</div>`;
  
  html += `<div class="context-block">`;
  html += `<div class="context-label">Patients</div>`;
  html += `<div class="context-value">${fmtN(item.total_patients || 0)}</div>`;
  html += `</div>`;
  
  if (item.candidate_types) {
    html += `<div class="context-block">`;
    html += `<div class="context-label">Candidate Types</div>`;
    html += `<div class="context-value">${esc(item.candidate_types)}</div>`;
    html += `</div>`;
  }
  
  if (item.review_reason) {
    html += `<div class="context-block">`;
    html += `<div class="context-label">Review Reason</div>`;
    html += `<div class="context-value">${esc(item.review_reason)}</div>`;
    html += `</div>`;
  }
  
  html += '</div>';
  
  // Form
  html += '<div class="research-form">';
  html += '<div class="form-group">';
  html += '<label style="display: block; color: var(--text2); font-size: 12px; margin-bottom: 8px; font-weight: 600;">Outcome</label>';
  html += `<select id="propOutcome" style="width: 100%; padding: 8px; background: var(--s2); color: var(--text); border: 1px solid var(--border); border-radius: 4px;">`;
  html += '<option value="">Select status...</option>';
  html += '<option value="pending_review">Pending Review</option>';
  html += '<option value="approved_link">Approved Link</option>';
  html += '<option value="needs_research">Needs Research</option>';
  html += '<option value="rejected_candidate">Rejected Candidate</option>';
  html += '<option value="escalated">Escalated</option>';
  html += '</select>';
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label style="display: block; color: var(--text2); font-size: 12px; margin-bottom: 8px; font-weight: 600;">Property ID (if approved)</label>';
  html += `<input type="text" id="propPropertyId" placeholder="Property ID" style="width: 100%; padding: 8px; background: var(--s2); color: var(--text); border: 1px solid var(--border); border-radius: 4px;" />`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label style="display: block; color: var(--text2); font-size: 12px; margin-bottom: 8px; font-weight: 600;">Notes</label>';
  html += `<textarea id="propNotes" placeholder="Add notes..." style="width: 100%; padding: 8px; background: var(--s2); color: var(--text); border: 1px solid var(--border); border-radius: 4px; resize: vertical; min-height: 100px;"></textarea>`;
  html += '</div>';
  
  html += '<div class="form-divider"></div>';
  
  html += `<button class="btn-primary" data-save-prop="${item.clinic_id}" style="width: 100%;">Save Outcome</button>`;
  
  html += '</div>';
  html += '</div>';
  
  setTimeout(() => {
    const saveBtn = document.querySelector(`[data-save-prop="${item.clinic_id}"]`);
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const outcome = (q('#propOutcome') || {}).value;
        const propId = (q('#propPropertyId') || {}).value;
        const notes = (q('#propNotes') || {}).value;
        
        if (!outcome) {
          showToast('Please select an outcome', 'warning');
          return;
        }
        
        saveDiaOutcome('property_review', item.clinic_id, outcome, propId, notes);
      });
    }
  }, 0);
  
  return html;
}

/**
 * Render lease backfill queue section
 */
function renderDiaLeaseResearch() {
  let html = '<div class="research-progress" style="margin-bottom: 30px;">';
  
  const total = diaData.leaseBackfillRows.length;
  const verified = diaData.researchOutcomes.filter(o => o.queue_type === 'lease_backfill' && o.status === 'verified_lease').length;
  const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
  
  html += `<div class="progress-text">${verified} of ${total} verified (${pct}%)</div>`;
  html += `<div class="progress-bar"><div style="width: ${pct}%; background: #34d399;"></div></div>`;
  html += '</div>';
  
  // Summary metrics
  html += '<div class="gov-metrics" style="margin-bottom: 30px;">';
  
  const pending = diaData.leaseBackfillRows.length;
  const highRisk = diaData.leaseBackfillRows.filter(r => r.closure_watch_level === 'high').length;
  const largeClinic = diaData.leaseBackfillRows.filter(r => r.total_patients > 100).length;
  
  html += metricHTML('Pending Backfill', fmtN(pending), 'lease candidates', '');
  html += metricHTML('High Risk', fmtN(highRisk), 'closure watch', '');
  html += metricHTML('Large Clinics', fmtN(largeClinic), '100+ patients', '');
  html += metricHTML('Avg Patients', fmtN(Math.round(diaData.leaseBackfillRows.reduce((s, r) => s + (r.total_patients || 0), 0) / Math.max(pending, 1))), 'per clinic', '');
  
  html += '</div>';
  
  // Filter
  html += '<div class="pills" style="margin: 20px 0;">';
  html += '<button class="pill active" data-filter-priority="all">All</button>';
  ['high', 'medium', 'low'].forEach(priority => {
    html += `<button class="pill" data-filter-priority="${priority}">${priority}</button>`;
  });
  html += '</div>';
  
  // Queue table
  html += '<div class="table-wrapper" style="margin-bottom: 20px;">';
  html += '<div class="data-table">';
  
  let filtered = diaData.leaseBackfillRows;
  if (diaLeaseFilter.priority) {
    filtered = filtered.filter(r => r.lease_backfill_priority === diaLeaseFilter.priority);
  }
  
  if (filtered.length === 0) {
    html += '<div class="table-empty">No items in queue</div>';
  } else {
    html += '<div class="table-row" style="font-weight: 600; border-bottom: 1px solid var(--border);">';
    html += '<div style="flex: 0.5;">ID</div>';
    html += '<div style="flex: 2;">Facility</div>';
    html += '<div style="flex: 1;">Operator</div>';
    html += '<div style="flex: 0.7; text-align: right;">Patients</div>';
    html += '<div style="flex: 1;">Watch Level</div>';
    html += '<div style="flex: 1;">Priority</div>';
    html += '</div>';
    
    filtered.slice(0, 50).forEach((row, idx) => {
      const watchColor = row.closure_watch_level === 'high' ? '#f87171' : 'var(--text2)';
      
      html += `<div class="table-row clickable-row" style="cursor: pointer;" data-lease-idx="${idx}">`;
      html += `<div style="flex: 0.5; color: var(--text2);">${row.clinic_id}</div>`;
      html += `<div style="flex: 2;" class="truncate">${esc(row.facility_name || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.operator_name || '')}</div>`;
      html += `<div style="flex: 0.7; text-align: right; color: var(--accent);">${fmtN(row.total_patients || 0)}</div>`;
      html += `<div style="flex: 1; color: ${watchColor};">${row.closure_watch_level || 'none'}</div>`;
      html += `<div style="flex: 1; color: var(--text2);">${row.lease_backfill_priority || 'unknown'}</div>`;
      html += `<div style="flex: 0.3; text-align: right;"><span style="color:var(--accent);font-size:16px" title="Open detail" onclick='event.stopPropagation();showDetail(${JSON.stringify(row).replace(/'/g,"&#39;")}, "dia-clinic")'>&rsaquo;</span></div>`;
      html += '</div>';
    });
  }
  
  html += '</div>';
  html += '</div>';
  
  // Research card for selected item
  if (diaLeaseFilter.selectedIdx !== undefined && filtered[diaLeaseFilter.selectedIdx]) {
    const item = filtered[diaLeaseFilter.selectedIdx];
    html += renderDiaLeaseCard(item);
  }
  
  // Attach handlers
  setTimeout(() => {
    document.querySelectorAll('[data-filter-priority]').forEach(btn => {
      btn.addEventListener('click', e => {
        diaLeaseFilter.priority = e.target.dataset.filterPriority === 'all' ? null : e.target.dataset.filterPriority;
        renderDiaTab();
      });
    });
    
    document.querySelectorAll('[data-lease-idx]').forEach(row => {
      row.addEventListener('click', e => {
        diaLeaseFilter.selectedIdx = parseInt(e.currentTarget.dataset.leaseIdx);
        renderDiaTab();
      });
    });
  }, 0);
  
  return html;
}

/**
 * Render lease backfill card
 */
function renderDiaLeaseCard(item) {
  let html = '<div class="research-card" style="display: grid; grid-template-columns: 1fr 460px; gap: 20px; margin-top: 20px;">';
  
  // Context
  html += '<div class="research-context">';
  html += `<div class="context-block">`;
  html += `<div class="context-label">Facility</div>`;
  html += `<div class="context-value">${esc(item.facility_name || '')}</div>`;
  html += `</div>`;
  
  html += `<div class="context-block">`;
  html += `<div class="context-label">Operator / Clinic ID</div>`;
  html += `<div class="context-value">${esc(item.operator_name || '')} / ${item.clinic_id}</div>`;
  html += `</div>`;
  
  html += `<div class="context-block">`;
  html += `<div class="context-label">Patients</div>`;
  html += `<div class="context-value">${fmtN(item.total_patients || 0)}</div>`;
  html += `</div>`;
  
  html += `<div class="context-block">`;
  html += `<div class="context-label">Closure Watch Level</div>`;
  const watchColor = item.closure_watch_level === 'high' ? '#f87171' : 'var(--text2)';
  html += `<div class="context-value" style="color: ${watchColor};">${item.closure_watch_level || 'none'}</div>`;
  html += `</div>`;
  
  if (item.backfill_reason) {
    html += `<div class="context-block">`;
    html += `<div class="context-label">Backfill Reason</div>`;
    html += `<div class="context-value">${esc(item.backfill_reason)}</div>`;
    html += `</div>`;
  }
  
  html += '</div>';
  
  // Form
  html += '<div class="research-form">';
  html += '<div class="form-group">';
  html += '<label style="display: block; color: var(--text2); font-size: 12px; margin-bottom: 8px; font-weight: 600;">Outcome</label>';
  html += `<select id="leaseOutcome" style="width: 100%; padding: 8px; background: var(--s2); color: var(--text); border: 1px solid var(--border); border-radius: 4px;">`;
  html += '<option value="">Select status...</option>';
  html += '<option value="pending_backfill">Pending Backfill</option>';
  html += '<option value="requested_lease">Requested Lease</option>';
  html += '<option value="verified_lease">Verified Lease</option>';
  html += '<option value="not_owned">Not Owned</option>';
  html += '<option value="escalated">Escalated</option>';
  html += '</select>';
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label style="display: block; color: var(--text2); font-size: 12px; margin-bottom: 8px; font-weight: 600;">Property ID (if verified)</label>';
  html += `<input type="text" id="leasePropertyId" placeholder="Property ID" style="width: 100%; padding: 8px; background: var(--s2); color: var(--text); border: 1px solid var(--border); border-radius: 4px;" />`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label style="display: block; color: var(--text2); font-size: 12px; margin-bottom: 8px; font-weight: 600;">Notes</label>';
  html += `<textarea id="leaseNotes" placeholder="Add notes..." style="width: 100%; padding: 8px; background: var(--s2); color: var(--text); border: 1px solid var(--border); border-radius: 4px; resize: vertical; min-height: 100px;"></textarea>`;
  html += '</div>';
  
  html += '<div class="form-divider"></div>';
  
  html += `<button class="btn-primary" data-save-lease="${item.clinic_id}" style="width: 100%;">Save Outcome</button>`;
  
  html += '</div>';
  html += '</div>';
  
  setTimeout(() => {
    const saveBtn = document.querySelector(`[data-save-lease="${item.clinic_id}"]`);
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const outcome = (q('#leaseOutcome') || {}).value;
        const propId = (q('#leasePropertyId') || {}).value;
        const notes = (q('#leaseNotes') || {}).value;
        
        if (!outcome) {
          showToast('Please select an outcome', 'warning');
          return;
        }
        
        saveDiaOutcome('lease_backfill', item.clinic_id, outcome, propId, notes);
      });
    }
  }, 0);
  
  return html;
}

/**
 * Save research outcome
 */
async function saveDiaOutcome(queueType, clinicId, status, propId, notes) {
  try {
    const payload = {
      queue_type: queueType,
      clinic_id: clinicId,
      status: status,
      notes: notes,
      selected_property_id: propId || null,
      assigned_at: new Date().toISOString()
    };

    const url = new URL('/api/dia-query', window.location.origin);
    url.searchParams.set('table', 'research_queue_outcomes');
    url.searchParams.set('filter', `clinic_id=eq.${clinicId}`);
    url.searchParams.set('filter2', `queue_type=eq.${queueType}`);

    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Failed to save outcome');
    }

    showToast('Outcome saved', 'success');
    loadDiaData();
  } catch (err) {
    console.error('saveDiaOutcome error:', err);
    showToast('Failed to save outcome: ' + err.message, 'error');
  }
}

// ============================================================================
// ACTIVITY TAB
// ============================================================================

/**
 * Render activity/audit log tab
 */
function renderDiaActivity() {
  let html = '<div class="biz-section">';
  
  html += '<h3 class="gov-chart-title">Recent Activity</h3>';
  
  html += '<div class="data-table">';
  
  const outcomes = diaData.researchOutcomes || [];
  
  if (outcomes.length === 0) {
    html += '<div class="table-empty">No activity recorded</div>';
  } else {
    html += '<div class="table-row" style="font-weight: 600; border-bottom: 1px solid var(--border);">';
    html += '<div style="flex: 1;">Queue Type</div>';
    html += '<div style="flex: 0.5;">Clinic ID</div>';
    html += '<div style="flex: 1;">Status</div>';
    html += '<div style="flex: 1.5;">Assigned To</div>';
    html += '<div style="flex: 1;">Date</div>';
    html += '</div>';
    
    outcomes.slice(0, 100).forEach(row => {
      const statusColor = row.status === 'verified_lease' || row.status === 'approved_link' ? '#34d399' : 'var(--text2)';
      
      html += `<div class="table-row clickable-row" onclick='showDetail(${JSON.stringify(row).replace(/'/g,"&#39;")}, "dia-clinic")'>`;
      html += `<div style="flex: 1;">${row.queue_type || 'unknown'}</div>`;
      html += `<div style="flex: 0.5; color: var(--text2);">${row.clinic_id}</div>`;
      html += `<div style="flex: 1; color: ${statusColor};">${row.status || 'unknown'}</div>`;
      html += `<div style="flex: 1.5;">${row.assigned_to ? esc(row.assigned_to) : '–'}</div>`;
      html += `<div style="flex: 1; color: var(--text2);">${fmt(row.assigned_at || row.created_at)}</div>`;
      html += '</div>';
    });
  }
  
  html += '</div>';
  html += '</div>';
  
  return html;
}

// ============================================================================
// DETAIL PANEL RENDERER
// ============================================================================

/**
 * Main detail panel renderer - dispatches to tab-specific renderers
 */
function renderDiaDetailBody(record, tab) {
  tab = (tab || 'Overview').toLowerCase();

  if (!record) {
    return '<div class="detail-empty">No record selected</div>';
  }

  let html = '';

  switch (tab) {
    case 'overview':
      html = renderDiaDetailOverview(record);
      break;
    case 'property':
      html = renderDiaDetailProperty(record);
      break;
    case 'signals':
      html = renderDiaDetailSignals(record);
      break;
    case 'research':
      html = renderDiaDetailResearch(record);
      break;
    case 'activity':
      html = renderDiaDetailActivity(record);
      break;
    default:
      html = renderDiaDetailOverview(record);
  }
  
  return html;
}

/**
 * Overview tab - key facility information
 */
function renderDiaDetailOverview(record) {
  const facility_name = record.facility_name || '—';
  const ccn = record.ccn || '—';
  const npi = record.npi || '—';
  const operator_name = record.operator_name || '—';
  const city = record.city || '—';
  const state = record.state || '—';
  const latest_total_patients = record.latest_total_patients || 0;
  const delta_patients = record.delta_patients || 0;
  const pct_change = record.pct_change || 0;
  const change_type = record.change_type || '—';
  
  let html = '<div class="detail-section">';
  
  // Header with facility name and key identifiers
  html += '<div class="detail-section-title">' + esc(facility_name) + '</div>';
  
  html += '<div class="detail-grid">';
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">CCN</div>';
  html += '<div class="detail-val">' + esc(ccn) + '</div>';
  html += '</div>';
  
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">NPI</div>';
  html += '<div class="detail-val">' + esc(npi) + '</div>';
  html += '</div>';
  
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">Operator</div>';
  html += '<div class="detail-val">' + esc(operator_name) + '</div>';
  html += '</div>';
  
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">Location</div>';
  html += '<div class="detail-val">' + esc(city) + ', ' + esc(state) + '</div>';
  html += '</div>';
  html += '</div>';
  
  // Metrics grid
  html += '<div class="detail-section-title" style="margin-top: 24px;">Metrics</div>';
  
  html += '<div class="detail-grid">';
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">Latest Patient Count</div>';
  html += '<div class="detail-val">' + fmtN(latest_total_patients) + '</div>';
  html += '</div>';
  
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">Patient Change (Δ)</div>';
  const deltaColor = delta_patients > 0 ? 'color: var(--success);' : delta_patients < 0 ? 'color: var(--danger);' : '';
  html += '<div class="detail-val" style="' + deltaColor + '">' + (delta_patients > 0 ? '+' : '') + fmtN(delta_patients) + '</div>';
  html += '</div>';
  
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">% Change</div>';
  html += '<div class="detail-val" style="' + deltaColor + '">' + pct(pct_change) + '</div>';
  html += '</div>';
  
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">Change Type</div>';
  html += '<div class="detail-val">' + esc(change_type || '—') + '</div>';
  html += '</div>';
  html += '</div>';
  
  html += '</div>';
  
  return html;
}

/**
 * Property tab - location and matching records
 */
function renderDiaDetailProperty(record) {
  const ccn = record.ccn;
  const facility_name = record.facility_name || '—';
  const city = record.city || '—';
  const state = record.state || '—';
  
  let html = '<div class="detail-section">';
  
  html += '<div class="detail-section-title">Property Information</div>';
  
  html += '<div class="detail-grid">';
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">Facility</div>';
  html += '<div class="detail-val">' + esc(facility_name) + '</div>';
  html += '</div>';
  
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">City</div>';
  html += '<div class="detail-val">' + esc(city) + '</div>';
  html += '</div>';
  
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">State</div>';
  html += '<div class="detail-val">' + esc(state) + '</div>';
  html += '</div>';
  
  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">CCN</div>';
  html += '<div class="detail-val">' + esc(ccn || '—') + '</div>';
  html += '</div>';
  html += '</div>';
  
  // Matching inventory changes for this CCN
  if (ccn && diaData.inventoryChanges) {
    const matching = diaData.inventoryChanges.filter(r => r.ccn === ccn);
    
    if (matching.length > 0) {
      html += '<div class="detail-section-title" style="margin-top: 24px;">Inventory Snapshots</div>';
      
      matching.forEach((item, idx) => {
        html += '<div class="detail-card">';
        html += '<div class="detail-card-header">';
        html += '<div class="detail-card-title">' + esc(item.change_type || '—') + '</div>';
        html += '<div class="detail-card-date">' + fmt(item.snapshot_date) + '</div>';
        html += '</div>';
        html += '<div class="detail-card-body">';
        html += '<div class="detail-row">';
        html += '<div class="detail-lbl">Patient Count</div>';
        html += '<div class="detail-val">' + fmtN(item.latest_total_patients) + '</div>';
        html += '</div>';
        html += '<div class="detail-row">';
        html += '<div class="detail-lbl">Change</div>';
        const deltaColor = item.delta_patients > 0 ? 'color: var(--success);' : item.delta_patients < 0 ? 'color: var(--danger);' : '';
        html += '<div class="detail-val" style="' + deltaColor + '">' + (item.delta_patients > 0 ? '+' : '') + fmtN(item.delta_patients) + '</div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
      });
    }
  }
  
  html += '</div>';
  
  return html;
}

/**
 * Signals tab - NPI and data quality signals
 */
function renderDiaDetailSignals(record) {
  const ccn = record.ccn;
  const npi = record.npi;
  
  let html = '<div class="detail-section">';
  
  if (!ccn && !npi) {
    html += '<div class="detail-empty">No facility identifiers to look up signals</div>';
    html += '</div>';
    return html;
  }
  
  const signals = (diaData.npiSignals || []).filter(s => s.ccn === ccn || s.npi === npi);
  
  if (signals.length === 0) {
    html += '<div class="detail-empty">No signals detected for this facility</div>';
    html += '</div>';
    return html;
  }
  
  html += '<div class="detail-section-title">Data Quality Signals</div>';
  
  signals.forEach(signal => {
    const signalClass = signal.signal_type === 'npi_change' ? 'badge-warning' : 'badge-info';
    
    html += '<div class="detail-card">';
    html += '<div class="detail-card-header">';
    html += '<div class="detail-card-title">';
    html += '<span class="detail-badge ' + signalClass + '">' + esc(signal.signal_type) + '</span>';
    html += '</div>';
    html += '</div>';
    html += '<div class="detail-card-body">';
    
    if (signal.signal_type === 'npi_change') {
      html += '<div class="detail-row">';
      html += '<div class="detail-lbl">Old NPI</div>';
      html += '<div class="detail-val">' + esc(signal.old_npi || '—') + '</div>';
      html += '</div>';
      html += '<div class="detail-row">';
      html += '<div class="detail-lbl">New NPI</div>';
      html += '<div class="detail-val">' + esc(signal.new_npi || '—') + '</div>';
      html += '</div>';
    }
    
    html += '<div class="detail-row">';
    html += '<div class="detail-lbl">Patients</div>';
    html += '<div class="detail-val">' + fmtN(signal.latest_total_patients) + '</div>';
    html += '</div>';
    
    html += '</div>';
    html += '</div>';
  });
  
  html += '</div>';
  
  return html;
}

/**
 * Research tab - property review queue and lease backfill status
 */
function renderDiaDetailResearch(record) {
  const clinic_id = record.clinic_id;
  const ccn = record.ccn;
  
  let html = '<div class="detail-section">';
  
  // Property review queue items
  if (ccn && diaData.propertyReviewQueue) {
    const reviewItems = diaData.propertyReviewQueue.filter(r => r.ccn === ccn);
    
    if (reviewItems.length > 0) {
      html += '<div class="detail-section-title">Property Review Queue</div>';
      
      reviewItems.forEach(item => {
        html += '<div class="detail-card">';
        html += '<div class="detail-card-header">';
        html += '<div class="detail-card-title">' + metricHTML(item.review_type) + '</div>';
        html += '<div class="detail-card-date">' + fmt(item.created_at) + '</div>';
        html += '</div>';
        html += '<div class="detail-card-body">';
        html += '<div class="detail-row">';
        html += '<div class="detail-lbl">Facility</div>';
        html += '<div class="detail-val">' + esc(item.facility_name || '—') + '</div>';
        html += '</div>';
        html += '<div class="detail-row">';
        html += '<div class="detail-lbl">Status</div>';
        html += '<div class="detail-val">' + (item.status || '—') + '</div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
      });
    }
  }
  
  // Lease backfill items
  if (ccn && diaData.leaseBackfillRows) {
    const leaseItems = diaData.leaseBackfillRows.filter(r => r.ccn === ccn);
    
    if (leaseItems.length > 0) {
      html += '<div class="detail-section-title" style="margin-top: 24px;">Lease Backfill Status</div>';
      
      leaseItems.forEach(item => {
        html += '<div class="detail-card">';
        html += '<div class="detail-card-header">';
        html += '<div class="detail-card-title">' + esc(item.facility_name || '—') + '</div>';
        html += '<div class="detail-card-date">' + fmt(item.updated_at || item.created_at) + '</div>';
        html += '</div>';
        html += '<div class="detail-card-body">';
        html += '<div class="detail-row">';
        html += '<div class="detail-lbl">Status</div>';
        html += '<div class="detail-val">' + (item.status || 'pending') + '</div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
      });
    }
  }
  
  // Research status form
  html += '<div class="detail-section-title" style="margin-top: 24px;">Update Research Status</div>';
  
  html += '<div class="detail-form">';
  html += '<div class="form-group">';
  html += '<label style="display: block; color: var(--text2); font-size: 12px; margin-bottom: 8px; font-weight: 600;">Research Status</label>';
  html += '<select id="diaDetailStatus" style="width: 100%; padding: 8px; background: var(--s2); color: var(--text); border: 1px solid var(--border); border-radius: 4px;">';
  html += '<option value="">Select status...</option>';
  html += '<option value="pending">Pending</option>';
  html += '<option value="in_progress">In Progress</option>';
  html += '<option value="verified_lease">Verified Lease</option>';
  html += '<option value="approved_link">Approved Link</option>';
  html += '<option value="rejected">Rejected</option>';
  html += '</select>';
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label style="display: block; color: var(--text2); font-size: 12px; margin-bottom: 8px; font-weight: 600;">Notes</label>';
  html += '<textarea id="diaDetailNotes" placeholder="Add notes..." style="width: 100%; padding: 8px; background: var(--s2); color: var(--text); border: 1px solid var(--border); border-radius: 4px; resize: vertical; min-height: 100px;"></textarea>';
  html += '</div>';
  
  html += '<div style="display: flex; gap: 8px;">';
  html += '<button class="btn-primary" onclick="saveDiaDetailResearch()">Save</button>';
  html += '</div>';
  html += '</div>';
  
  html += '</div>';
  
  return html;
}

/**
 * Activity tab - research outcomes timeline
 */
function renderDiaDetailActivity(record) {
  const clinic_id = record.clinic_id;
  
  let html = '<div class="detail-section">';
  
  if (!clinic_id) {
    html += '<div class="detail-empty">No clinic ID to look up activity</div>';
    html += '</div>';
    return html;
  }
  
  const outcomes = (diaData.researchOutcomes || []).filter(o => o.clinic_id === clinic_id);
  
  if (outcomes.length === 0) {
    html += '<div class="detail-empty">No research outcomes recorded</div>';
    html += '</div>';
    return html;
  }
  
  html += '<div class="detail-section-title">Research Activity Timeline</div>';
  
  html += '<div class="detail-timeline">';
  
  outcomes.slice().reverse().forEach((outcome, idx) => {
    const statusColor = outcome.status === 'verified_lease' || outcome.status === 'approved_link' ? 'color: var(--success);' : 'color: var(--text2);';
    
    html += '<div class="detail-timeline-item">';
    html += '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">';
    html += '<div style="font-weight: 600;">' + esc(outcome.queue_type || 'unknown') + '</div>';
    html += '<div style="color: var(--text2); font-size: 12px;">' + fmt(outcome.assigned_at || outcome.created_at) + '</div>';
    html += '</div>';
    html += '<div style="display: flex; justify-content: space-between; align-items: center;">';
    html += '<div style="' + statusColor + '">' + esc(outcome.status || 'unknown') + '</div>';
    if (outcome.assigned_to) {
      html += '<div style="color: var(--text2); font-size: 12px;">by ' + esc(outcome.assigned_to) + '</div>';
    }
    html += '</div>';
    html += '</div>';
  });
  
  html += '</div>';
  
  html += '</div>';
  
  return html;
}

/**
 * Save research status from detail panel
 */
function saveDiaDetailResearch() {
  const status = (document.getElementById('diaDetailStatus') || {}).value;
  const notes = (document.getElementById('diaDetailNotes') || {}).value;
  
  if (!status) {
    showToast('Please select a status', 'warning');
    return;
  }
  
  // Get clinic ID from the current detail panel context
  // This assumes the showDetail function sets a global context or we extract from form
  const clinicIdEl = document.querySelector('[data-clinic-id]');
  const clinicId = clinicIdEl ? clinicIdEl.getAttribute('data-clinic-id') : null;
  
  if (!clinicId) {
    showToast('Clinic ID not found', 'error');
    return;
  }
  
  saveDiaOutcome('property_review', clinicId, status, null, notes);
}

// ============================================================================
// EXPORT PUBLIC FUNCTIONS
// ============================================================================

// These override the placeholders in index.html
window.diaQuery = diaQuery;
window.loadDiaData = loadDiaData;
// ============================================================================
// DIALYSIS SALES (Facility Transfers / Market Activity)
// ============================================================================

function renderDiaSales() {
  const changes = diaData.inventoryChanges || [];
  // "Sales" in dialysis = facility additions/removals (ownership transfers, new openings, closures)
  const added = changes.filter(r => r.change_type === 'added');
  const removed = changes.filter(r => r.change_type === 'removed');

  let html = '<div class="biz-section">';

  // Metrics
  html += '<div class="gov-metrics">';
  html += metricHTML('New Facilities', fmtN(added.length), 'opened this period', 'green');
  html += metricHTML('Closed Facilities', fmtN(removed.length), 'removed this period', 'red');
  const avgPatientsAdded = added.length > 0 ? Math.round(added.reduce((s, r) => s + (r.latest_total_patients || 0), 0) / added.length) : 0;
  html += metricHTML('Avg Patients (New)', fmtN(avgPatientsAdded), 'per new facility', 'blue');
  const bigMoves = changes.filter(r => Math.abs(r.delta_patients || 0) > 50).length;
  html += metricHTML('Major Moves', fmtN(bigMoves), '>50 patient swing', 'yellow');
  html += '</div>';

  // Comps-style table
  html += '<h3 class="gov-chart-title" style="margin-top: 20px;">Recent Market Activity</h3>';
  html += '<div class="table-wrapper"><div class="data-table">';
  html += '<div class="table-row" style="font-weight: 600; border-bottom: 2px solid var(--border);">';
  html += '<div style="flex: 2;">Facility</div>';
  html += '<div style="flex: 1;">City, State</div>';
  html += '<div style="flex: 1;">Operator</div>';
  html += '<div style="flex: 1;">Type</div>';
  html += '<div style="flex: 1; text-align: right;">Patients</div>';
  html += '<div style="flex: 1; text-align: right;">Delta</div>';
  html += '<div style="flex: 1; text-align: right;">% Change</div>';
  html += '<div style="flex: 1;">CCN</div>';
  html += '</div>';

  // Sort by abs delta descending for most impactful first
  const sorted = [...changes].sort((a, b) => Math.abs(b.delta_patients || 0) - Math.abs(a.delta_patients || 0));

  sorted.slice(0, 200).forEach(r => {
    const typeColor = r.change_type === 'added' ? '#34d399' : r.change_type === 'removed' ? '#f87171' : 'var(--text2)';
    const deltaColor = (r.delta_patients || 0) > 0 ? '#34d399' : (r.delta_patients || 0) < 0 ? '#f87171' : 'var(--text2)';

    html += '<div class="table-row clickable-row" onclick=\'showDetail(' + JSON.stringify(r).replace(/'/g,"&#39;") + ', "dia-clinic")\'>';
    html += '<div style="flex: 2;" class="truncate">' + esc(r.facility_name || '—') + '</div>';
    html += '<div style="flex: 1;">' + esc((r.city || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</div>';
    html += '<div style="flex: 1;" class="truncate">' + esc(r.operator_name || '—') + '</div>';
    html += '<div style="flex: 1; color: ' + typeColor + ';">' + esc(r.change_type || '—') + '</div>';
    html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + fmtN(r.latest_total_patients || 0) + '</div>';
    html += '<div style="flex: 1; text-align: right; color: ' + deltaColor + ';">' + ((r.delta_patients || 0) > 0 ? '+' : '') + fmtN(r.delta_patients || 0) + '</div>';
    html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + pct(r.pct_change || 0) + '</div>';
    html += '<div style="flex: 1; color: var(--text2);">' + esc(r.ccn || '—') + '</div>';
    html += '</div>';
  });

  if (changes.length === 0) {
    html += '<div class="table-empty">No market activity data loaded</div>';
  }

  html += '</div></div>';
  html += '</div>';
  return html;
}

// ============================================================================
// DIALYSIS PLAYERS (Top Operators, Largest Clinics)
// ============================================================================

let diaPlayersView = 'operators';

function renderDiaPlayers() {
  let html = '<div class="biz-section">';

  // View toggle
  html += '<div class="pills" style="margin-bottom: 20px;">';
  ['operators', 'largest', 'movers'].forEach(view => {
    const active = diaPlayersView === view ? ' active' : '';
    const label = view === 'operators' ? 'Top Operators' : view === 'largest' ? 'Largest Clinics' : 'Biggest Movers';
    html += '<button class="pill' + active + '" onclick="diaPlayersView=\'' + view + '\';renderDiaTab()">' + label + '</button>';
  });
  html += '</div>';

  const changes = diaData.inventoryChanges || [];

  if (diaPlayersView === 'operators') {
    // Aggregate by operator
    const opMap = {};
    changes.forEach(r => {
      if (r.operator_name) {
        const key = r.operator_name.trim().toUpperCase();
        if (!opMap[key]) opMap[key] = { name: r.operator_name, clinics: 0, patients: 0, records: [] };
        opMap[key].clinics++;
        opMap[key].patients += (r.latest_total_patients || 0);
        opMap[key].records.push(r);
      }
    });
    const topOps = Object.values(opMap).sort((a, b) => b.clinics - a.clinics).slice(0, 50);

    html += '<div class="gov-metrics">';
    html += metricHTML('Unique Operators', fmtN(topOps.length), 'in dataset', 'blue');
    html += metricHTML('Top Operator', (topOps[0]?.name || '—').substring(0, 25), topOps[0]?.clinics + ' clinics', 'green');
    const totalPatients = topOps.reduce((s, p) => s + p.patients, 0);
    html += metricHTML('Total Patients', fmtN(totalPatients), 'across all operators', 'purple');
    html += '</div>';

    html += '<div class="table-wrapper"><div class="data-table">';
    html += '<div class="table-row" style="font-weight: 600; border-bottom: 2px solid var(--border);">';
    html += '<div style="flex: 3;">Operator</div>';
    html += '<div style="flex: 1; text-align: right;">Clinics</div>';
    html += '<div style="flex: 1; text-align: right;">Total Patients</div>';
    html += '<div style="flex: 1; text-align: right;">Avg Patients</div>';
    html += '</div>';

    topOps.forEach((p, idx) => {
      const avg = p.clinics > 0 ? Math.round(p.patients / p.clinics) : 0;
      html += '<div class="table-row clickable-row" onclick=\'showDetail(' + JSON.stringify(p.records[0]).replace(/'/g,"&#39;") + ', "dia-clinic")\'>';
      html += '<div style="flex: 3;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(p.name) + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + p.clinics + '</div>';
      html += '<div style="flex: 1; text-align: right;">' + fmtN(p.patients) + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + fmtN(avg) + '</div>';
      html += '</div>';
    });
    html += '</div></div>';

  } else if (diaPlayersView === 'largest') {
    // Largest clinics by patient count
    const sorted = [...changes].sort((a, b) => (b.latest_total_patients || 0) - (a.latest_total_patients || 0)).slice(0, 50);

    html += '<div class="gov-metrics">';
    html += metricHTML('Largest Clinic', (sorted[0]?.facility_name || '—').substring(0, 25), fmtN(sorted[0]?.latest_total_patients || 0) + ' patients', 'green');
    html += metricHTML('Top 10 Avg', fmtN(Math.round(sorted.slice(0, 10).reduce((s, r) => s + (r.latest_total_patients || 0), 0) / Math.min(10, sorted.length))), 'patients per clinic', 'blue');
    html += '</div>';

    html += '<div class="table-wrapper"><div class="data-table">';
    html += '<div class="table-row" style="font-weight: 600; border-bottom: 2px solid var(--border);">';
    html += '<div style="flex: 2;">Facility</div>';
    html += '<div style="flex: 1;">City, State</div>';
    html += '<div style="flex: 1;">Operator</div>';
    html += '<div style="flex: 1; text-align: right;">Patients</div>';
    html += '<div style="flex: 1;">CCN</div>';
    html += '</div>';

    sorted.forEach((r, idx) => {
      html += '<div class="table-row clickable-row" onclick=\'showDetail(' + JSON.stringify(r).replace(/'/g,"&#39;") + ', "dia-clinic")\'>';
      html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(r.facility_name || '—') + '</div>';
      html += '<div style="flex: 1;">' + esc((r.city || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</div>';
      html += '<div style="flex: 1;" class="truncate">' + esc(r.operator_name || '—') + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + fmtN(r.latest_total_patients || 0) + '</div>';
      html += '<div style="flex: 1; color: var(--text2);">' + esc(r.ccn || '—') + '</div>';
      html += '</div>';
    });
    html += '</div></div>';

  } else {
    // Biggest movers by absolute delta
    const sorted = [...changes].filter(r => r.delta_patients !== 0).sort((a, b) => Math.abs(b.delta_patients || 0) - Math.abs(a.delta_patients || 0)).slice(0, 50);

    html += '<div class="gov-metrics">';
    const biggestUp = changes.filter(r => (r.delta_patients || 0) > 0).sort((a, b) => b.delta_patients - a.delta_patients)[0];
    const biggestDown = changes.filter(r => (r.delta_patients || 0) < 0).sort((a, b) => a.delta_patients - b.delta_patients)[0];
    html += metricHTML('Biggest Gainer', (biggestUp?.facility_name || '—').substring(0, 25), '+' + fmtN(biggestUp?.delta_patients || 0) + ' patients', 'green');
    html += metricHTML('Biggest Loser', (biggestDown?.facility_name || '—').substring(0, 25), fmtN(biggestDown?.delta_patients || 0) + ' patients', 'red');
    html += '</div>';

    html += '<div class="table-wrapper"><div class="data-table">';
    html += '<div class="table-row" style="font-weight: 600; border-bottom: 2px solid var(--border);">';
    html += '<div style="flex: 2;">Facility</div>';
    html += '<div style="flex: 1;">City, State</div>';
    html += '<div style="flex: 1;">Operator</div>';
    html += '<div style="flex: 1; text-align: right;">Delta</div>';
    html += '<div style="flex: 1; text-align: right;">% Change</div>';
    html += '<div style="flex: 1; text-align: right;">Current</div>';
    html += '</div>';

    sorted.forEach((r, idx) => {
      const deltaColor = (r.delta_patients || 0) > 0 ? '#34d399' : '#f87171';
      html += '<div class="table-row clickable-row" onclick=\'showDetail(' + JSON.stringify(r).replace(/'/g,"&#39;") + ', "dia-clinic")\'>';
      html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(r.facility_name || '—') + '</div>';
      html += '<div style="flex: 1;">' + esc((r.city || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</div>';
      html += '<div style="flex: 1;" class="truncate">' + esc(r.operator_name || '—') + '</div>';
      html += '<div style="flex: 1; text-align: right; color: ' + deltaColor + ';">' + ((r.delta_patients || 0) > 0 ? '+' : '') + fmtN(r.delta_patients || 0) + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + pct(r.pct_change || 0) + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + fmtN(r.latest_total_patients || 0) + '</div>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  html += '</div>';
  return html;
}

// ============================================================================
// DIALYSIS SEARCH
// ============================================================================

let diaSearchTerm = '';
let diaSearchResults = null;
let diaSearching = false;

function renderDiaSearch() {
  let html = '<div class="biz-section">';
  html += '<div class="search-bar">';
  html += '<input type="text" id="diaSearchInput" placeholder="Search by facility name, city, state, operator, address..." value="' + esc(diaSearchTerm) + '" />';
  html += '<button onclick="execDiaSearch()">Search</button>';
  html += '</div>';

  if (diaSearching) {
    html += '<div class="search-loading">Searching across all dialysis records...</div>';
  } else if (diaSearchResults === null) {
    html += '<div class="search-empty">';
    html += '<div class="search-empty-icon">&#128269;</div>';
    html += '<p>Search across clinic inventory, NPI signals, property links, and research outcomes</p>';
    html += '</div>';
  } else {
    const { clinics, npiSignals, propQueue, outcomes } = diaSearchResults;
    const total = clinics.length + npiSignals.length + propQueue.length + outcomes.length;

    if (total === 0) {
      html += '<div class="search-empty"><p>No results found for "' + esc(diaSearchTerm) + '"</p></div>';
    } else {
      html += '<div style="color: var(--text2); font-size: 13px; margin-bottom: 16px;">' + total + ' result' + (total !== 1 ? 's' : '') + ' found</div>';

      if (clinics.length > 0) {
        html += '<div class="search-results-section"><h4>Clinics (' + clinics.length + ')</h4>';
        clinics.forEach(r => {
          html += '<div class="search-card" onclick=\'showDetail(' + JSON.stringify(r).replace(/'/g,"&#39;") + ', "dia-clinic")\'>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(r.facility_name || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(167,139,250,0.15); color: #a78bfa;">Clinic</span></div>';
          html += '<div class="search-card-meta">';
          if (r.city || r.state) html += '<span>' + esc((r.city || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</span>';
          if (r.medicare_npi) html += '<span>NPI: ' + esc(r.medicare_npi) + '</span>';
          if (r.operator_name) html += '<span>Op: ' + esc(r.operator_name) + '</span>';
          if (r.latest_total_patients) html += '<span>Patients: ' + fmtN(r.latest_total_patients) + '</span>';
          if (r.change_type) html += '<span>' + esc(r.change_type) + '</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      if (npiSignals.length > 0) {
        html += '<div class="search-results-section"><h4>NPI Signals (' + npiSignals.length + ')</h4>';
        npiSignals.forEach(r => {
          html += '<div class="search-card" onclick=\'showDetail(' + JSON.stringify(r).replace(/'/g,"&#39;") + ', "dia-clinic")\'>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(r.facility_name || r.npi || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(248,113,113,0.15); color: #f87171;">NPI Signal</span></div>';
          html += '<div class="search-card-meta">';
          if (r.city || r.state) html += '<span>' + esc((r.city || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</span>';
          if (r.signal_type) html += '<span>Signal: ' + esc(r.signal_type) + '</span>';
          if (r.npi) html += '<span>NPI: ' + esc(r.npi) + '</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      if (propQueue.length > 0) {
        html += '<div class="search-results-section"><h4>Property Review Queue (' + propQueue.length + ')</h4>';
        propQueue.forEach(r => {
          html += '<div class="search-card" onclick=\'showDetail(' + JSON.stringify(r).replace(/'/g,"&#39;") + ', "dia-clinic")\'>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(r.facility_name || r.clinic_id || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(251,191,36,0.15); color: #fbbf24;">Property</span></div>';
          html += '<div class="search-card-meta">';
          if (r.state) html += '<span>' + esc(r.state) + '</span>';
          if (r.operator_name) html += '<span>Op: ' + esc(r.operator_name) + '</span>';
          if (r.review_type) html += '<span>Review: ' + esc(r.review_type) + '</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      if (outcomes.length > 0) {
        html += '<div class="search-results-section"><h4>Research Outcomes (' + outcomes.length + ')</h4>';
        outcomes.forEach(r => {
          html += '<div class="search-card" onclick=\'showDetail(' + JSON.stringify(r).replace(/'/g,"&#39;") + ', "dia-clinic")\'>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(r.queue_type || r.clinic_id || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(52,211,153,0.15); color: #34d399;">Research</span></div>';
          html += '<div class="search-card-meta">';
          if (r.status) html += '<span>Status: ' + esc(r.status) + '</span>';
          if (r.queue_type) html += '<span>Type: ' + esc(r.queue_type) + '</span>';
          if (r.source_bucket) html += '<span>Source: ' + esc(r.source_bucket) + '</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }
    }
  }

  html += '</div>';

  setTimeout(() => {
    const input = document.getElementById('diaSearchInput');
    if (input) {
      input.addEventListener('keydown', e => { if (e.key === 'Enter') execDiaSearch(); });
      input.focus();
    }
  }, 0);

  return html;
}

async function execDiaSearch() {
  const input = document.getElementById('diaSearchInput');
  if (!input) return;
  const term = input.value.trim();
  if (!term) return;

  diaSearchTerm = term;
  diaSearching = true;
  renderDiaTab();

  const like = '*' + term + '*';
  try {
    const [clinics, npiSignals, propQueue, outcomes] = await Promise.all([
      diaQuery('v_clinic_inventory_latest_diff', '*', { filter: 'or=(facility_name.ilike.' + like + ',city.ilike.' + like + ',state.ilike.' + like + ',operator_name.ilike.' + like + ',address.ilike.' + like + ')', limit: 50 }),
      diaQuery('v_npi_inventory_signals', '*', { filter: 'or=(facility_name.ilike.' + like + ',city.ilike.' + like + ',state.ilike.' + like + ',npi.ilike.' + like + ',operator_name.ilike.' + like + ')', limit: 25 }),
      diaQuery('v_clinic_property_link_review_queue', '*', { filter: 'or=(facility_name.ilike.' + like + ',operator_name.ilike.' + like + ',state.ilike.' + like + ')', limit: 25 }),
      diaQuery('research_queue_outcomes', '*', { filter: 'or=(queue_type.ilike.' + like + ',status.ilike.' + like + ',notes.ilike.' + like + ')', limit: 25 })
    ]);

    diaSearchResults = {
      clinics: clinics || [],
      npiSignals: npiSignals || [],
      propQueue: propQueue || [],
      outcomes: outcomes || []
    };
  } catch (err) {
    console.error('Dia search error:', err);
    diaSearchResults = { clinics: [], npiSignals: [], propQueue: [], outcomes: [] };
  }

  diaSearching = false;
  renderDiaTab();
}

// ============================================================================
// EXPORTS
// ============================================================================

window.renderDiaTab = renderDiaTab;
window.renderDiaOverview = renderDiaOverview;
window.renderDiaChanges = renderDiaChanges;
window.renderDiaNpi = renderDiaNpi;
window.renderDiaResearch = renderDiaResearch;
window.renderDiaActivity = renderDiaActivity;
window.renderDiaDetailBody = renderDiaDetailBody;
window.saveDiaDetailResearch = saveDiaDetailResearch;
window.renderDiaSearch = renderDiaSearch;
window.execDiaSearch = execDiaSearch;
window.renderDiaSales = renderDiaSales;
window.renderDiaPlayers = renderDiaPlayers;
