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
function diaQuery(table, select, params = {}) {
  return new Promise((resolve, reject) => {
    const { filter, order, limit = 1000, offset = 0 } = params;
    
    let url = `${DIA_SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
    
    if (filter) {
      // Parse filter: "column=value" format
      const eqIdx = filter.indexOf('=');
      if (eqIdx > -1) {
        const col = filter.substring(0, eqIdx).trim();
        const val = filter.substring(eqIdx + 1).trim();
        url += `&${encodeURIComponent(col)}=eq.${encodeURIComponent(val)}`;
      }
    }
    
    if (order) {
      url += `&order=${encodeURIComponent(order)}`;
    }
    
    if (limit) {
      url += `&limit=${limit}`;
    }
    
    if (offset) {
      url += `&offset=${offset}`;
    }
    
    fetch(url, {
      headers: {
        'apikey': diaApiKey,
        'Authorization': `Bearer ${diaApiKey}`,
        'Content-Type': 'application/json'
      }
    })
      .then(res => {
        if (!res.ok) {
          return res.text().then(t => {
            console.error(`diaQuery ${table}: HTTP ${res.status}`, t);
            resolve([]);
          });
        }
        return res.json();
      })
      .then(data => {
        if (data === undefined) return; // already resolved above
        if (Array.isArray(data)) resolve(data);
        else if (data && data.message) {
          console.error(`diaQuery ${table}:`, data.message);
          resolve([]);
        } else {
          resolve(data);
        }
      })
      .catch(err => {
        console.error('diaQuery error:', err);
        resolve([]);
      });
  });
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
    case 'changes':
      inner.innerHTML = renderDiaChanges();
      break;
    case 'npi':
      inner.innerHTML = renderDiaNpi();
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
  
  const totalClinics = diaData.freshness.total_clinics || 0;
  const coveragePct = diaData.freshness.coverage_pct || 0;
  const addedCount = (diaData.inventorySummary.added?.clinic_count || 0);
  const removedCount = (diaData.inventorySummary.removed?.clinic_count || 0);
  const npiSignalCount = Object.values(diaData.npiSummary).reduce((s, r) => s + (r.signal_count || 0), 0);
  
  html += metricHTML('Total Clinics', fmtN(totalClinics), 'tracked nationwide', '');
  html += metricHTML('Coverage %', pct(coveragePct), 'of clinics counted', '');
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
    html += `<div style="flex: 2; color: var(--text2);">${fmt(recon.started_at)}</div>`;
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
  html += '<div class="gov-chart-card"><div class="gov-chart-title">Top 10 Movers Up</div><div class="chart-container" id="diaMoversUpChart"></div></div>';
  html += '<div class="gov-chart-card"><div class="gov-chart-title">Top 10 Movers Down</div><div class="chart-container" id="diaMoversDownChart"></div></div>';
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
  const upData = diaData.moversUp.map(r => ({
    label: r.facility_name.substring(0, 20),
    value: r.delta_patients
  }));
  
  const downData = diaData.moversDown.map(r => ({
    label: r.facility_name.substring(0, 20),
    value: Math.abs(r.delta_patients)
  }));
  
  if (upData.length > 0 && typeof renderBarChart === 'function') {
    renderBarChart('diaMoversUpChart', upData, '#34d399', 'Patients');
  }
  
  if (downData.length > 0 && typeof renderBarChart === 'function') {
    renderBarChart('diaMoversDownChart', downData, '#f87171', 'Patients');
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
      
      html += `<div class="table-row" style="${highlight}">`;
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
      
      html += '<div class="table-row">';
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
      html += `<div class="table-row" style="cursor: pointer;" data-prop-idx="${idx}">`;
      html += `<div style="flex: 0.5; color: var(--text2);">${row.clinic_id}</div>`;
      html += `<div style="flex: 2;" class="truncate">${esc(row.facility_name || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.operator_name || '')}</div>`;
      html += `<div style="flex: 0.5;">${row.state}</div>`;
      html += `<div style="flex: 0.7; text-align: right; color: var(--accent);">${fmtN(row.total_patients || 0)}</div>`;
      html += `<div style="flex: 1; color: var(--text2);">${row.review_type}</div>`;
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
      
      html += `<div class="table-row" style="cursor: pointer;" data-lease-idx="${idx}">`;
      html += `<div style="flex: 0.5; color: var(--text2);">${row.clinic_id}</div>`;
      html += `<div style="flex: 2;" class="truncate">${esc(row.facility_name || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.operator_name || '')}</div>`;
      html += `<div style="flex: 0.7; text-align: right; color: var(--accent);">${fmtN(row.total_patients || 0)}</div>`;
      html += `<div style="flex: 1; color: ${watchColor};">${row.closure_watch_level || 'none'}</div>`;
      html += `<div style="flex: 1; color: var(--text2);">${row.lease_backfill_priority || 'unknown'}</div>`;
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
    
    const response = await fetch(
      `${DIA_SUPABASE_URL}/rest/v1/research_queue_outcomes?clinic_id=eq.${clinicId}&queue_type=eq.${queueType}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': diaApiKey,
          'Authorization': `Bearer ${diaApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );
    
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
      
      html += '<div class="table-row">';
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
// EXPORT PUBLIC FUNCTIONS
// ============================================================================

// These override the placeholders in index.html
window.diaQuery = diaQuery;
window.loadDiaData = loadDiaData;
window.renderDiaTab = renderDiaTab;
window.renderDiaOverview = renderDiaOverview;
window.renderDiaChanges = renderDiaChanges;
window.renderDiaNpi = renderDiaNpi;
window.renderDiaResearch = renderDiaResearch;
window.renderDiaActivity = renderDiaActivity;
