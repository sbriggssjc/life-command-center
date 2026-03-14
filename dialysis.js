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
let diaSalesView = 'comps'; // 'comps' | 'available'
let diaSalesComps = null;   // lazy-loaded from v_sales_comps
let diaAvailListings = null; // lazy-loaded from v_available_listings
let diaSalesLoading = false;
let diaSalesSearch = '';
let diaSalesPage = 0;
const DIA_SALES_PAGE_SIZE = 50;

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
    
    // Load top movers from month-over-month patient counts
    try {
      const [moversUpRaw, moversDownRaw] = await Promise.all([
        diaQuery('v_facility_patient_counts_mom', '*', {
          filter: 'delta_patients=gt.0',
          order: 'delta_patients.desc',
          limit: 10
        }),
        diaQuery('v_facility_patient_counts_mom', '*', {
          filter: 'delta_patients=lt.0',
          order: 'delta_patients.asc',
          limit: 10
        })
      ]);
      // Collect all mover clinic_ids and batch-lookup facility names
      const allMovers = [...(moversUpRaw || []), ...(moversDownRaw || [])];
      const moverIds = [...new Set(allMovers.map(r => r.clinic_id).filter(Boolean))];
      const nameMap = {};
      if (moverIds.length > 0) {
        try {
          const nameRows = await diaQuery('medicare_clinics', 'medicare_id,facility_name', {
            filter: 'medicare_id=in.(' + moverIds.join(',') + ')',
            limit: 30
          });
          (nameRows || []).forEach(r => { if (r.medicare_id) nameMap[r.medicare_id] = r.facility_name; });
        } catch (e) { console.warn('name lookup failed', e); }
      }
      // Also check inventory cache
      (diaData.inventoryChanges || []).forEach(r => {
        if (r.clinic_id && r.facility_name && !nameMap[r.clinic_id]) nameMap[r.clinic_id] = r.facility_name;
      });
      const enrich = (arr) => (arr || []).map(r => ({
        ...r,
        facility_name: nameMap[r.clinic_id] || ('Clinic ' + r.clinic_id)
      }));
      diaData.moversUp = enrich(moversUpRaw);
      diaData.moversDown = enrich(moversDownRaw);
    } catch (e) {
      console.warn('Failed to load movers MoM data', e);
      diaData.moversUp = [];
      diaData.moversDown = [];
    }
    
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
      renderDiaSales(); // async — renders directly to DOM
      return;
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
  const upLabels = diaData.moversUp.map(r => norm(r.facility_name || '').substring(0, 20));
  const upValues = diaData.moversUp.map(r => r.delta_patients);

  const downLabels = diaData.moversDown.map(r => norm(r.facility_name || '').substring(0, 20));
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
    html += `<button class="pill${active}" data-filter="${type}">${cleanLabel(type)}</button>`;
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
      html += `<div style="flex: 2;" class="truncate">${esc(norm(row.facility_name) || '')}</div>`;
      html += `<div style="flex: 1;">${esc(norm(row.city) || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.state || '')}</div>`;
      html += `<div style="flex: 1;">${esc(norm(row.operator_name) || '')}</div>`;
      html += `<div style="flex: 1; text-align: right; color: var(--accent);">${fmtN(row.latest_total_patients || 0)}</div>`;
      html += `<div style="flex: 1; text-align: right; color: ${row.delta_patients > 0 ? '#34d399' : row.delta_patients < 0 ? '#f87171' : 'var(--text3)'};">${row.delta_patients != null ? (row.delta_patients > 0 ? '+' : '') + fmtN(row.delta_patients) : '—'}</div>`;
      html += `<div style="flex: 1; text-align: right; color: var(--text2);">${row.pct_change != null ? pct(row.pct_change) : '—'}</div>`;
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
  
  html += metricHTML('Total Signals', totalSignals >= 500 ? '500+' : fmtN(totalSignals), 'NPI intelligence signals', '');
  html += metricHTML('Signal Types', fmtN(Object.keys(signalTypes).length), 'different categories', '');
  
  Object.entries(signalTypes).slice(0, 2).forEach(([type, count]) => {
    html += metricHTML(cleanLabel(type) || 'Unknown', fmtN(count), 'signals', '');
  });
  
  html += '</div>';
  
  // Filter pills by signal type
  html += '<div class="pills" style="margin: 20px 0;">';
  html += '<button class="pill active" data-filter="all">All</button>';
  Object.keys(signalTypes).forEach(type => {
    const active = diaNpiFilter === type ? ' active' : '';
    html += `<button class="pill${active}" data-filter="${type}">${cleanLabel(type) || 'Unknown'}</button>`;
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
      html += `<div style="flex: 1.5; color: ${signalColor};">${esc(cleanLabel(row.signal_type || ''))}</div>`;
      html += `<div style="flex: 2;" class="truncate">${esc(norm(row.facility_name) || '')}</div>`;
      html += `<div style="flex: 1;">${esc(norm(row.city) || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.state || '')}</div>`;
      html += `<div style="flex: 1;">${esc(norm(row.operator_name) || '')}</div>`;
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
  const delta_patients = record.delta_patients;
  const pct_change = record.pct_change;
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
  html += '<div class="detail-val" style="' + deltaColor + '">' + (delta_patients != null ? (delta_patients > 0 ? '+' : '') + fmtN(delta_patients) : '—') + '</div>';
  html += '</div>';

  html += '<div class="detail-row">';
  html += '<div class="detail-lbl">% Change</div>';
  html += '<div class="detail-val" style="' + deltaColor + '">' + (pct_change != null ? pct(pct_change) : '—') + '</div>';
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
    html += '<span class="detail-badge ' + signalClass + '">' + esc(cleanLabel(signal.signal_type)) + '</span>';
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

async function renderDiaSales() {
  // Lazy-load sales comps and available listings data on first visit
  if (diaSalesView === 'comps' && diaSalesComps === null && !diaSalesLoading) {
    diaSalesLoading = true;
    const inner = q('#bizPageInner');
    if (inner) inner.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading sales comps...</p></div>';
    try {
      // Paginate: PostgREST limits to 1000 rows per request
      let all = [], pg = 0;
      while (true) {
        const batch = await diaQuery('v_sales_comps', '*', { order: 'sold_date.desc.nullslast', limit: 1000, offset: pg * 1000 });
        all = all.concat(batch || []);
        if (!batch || batch.length < 1000) break;
        pg++;
      }
      diaSalesComps = all;
    } catch (e) { console.error('Sales comps load error:', e); diaSalesComps = []; }
    diaSalesLoading = false;
  }
  if (diaSalesView === 'available' && diaAvailListings === null && !diaSalesLoading) {
    diaSalesLoading = true;
    const inner = q('#bizPageInner');
    if (inner) inner.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading available listings...</p></div>';
    try {
      let all = [], pg = 0;
      while (true) {
        const batch = await diaQuery('v_available_listings', '*', { order: 'listing_date.desc.nullslast', limit: 1000, offset: pg * 1000 });
        all = all.concat(batch || []);
        if (!batch || batch.length < 1000) break;
        pg++;
      }
      diaAvailListings = all;
    } catch (e) { console.error('Available listings load error:', e); diaAvailListings = []; }
    diaSalesLoading = false;
  }

  const isComps = diaSalesView === 'comps';
  const data = isComps ? (diaSalesComps || []) : (diaAvailListings || []);

  // Apply search filter
  let filtered = data;
  if (diaSalesSearch) {
    const sq = diaSalesSearch.toLowerCase();
    filtered = data.filter(r =>
      (r.tenant_operator || '').toLowerCase().includes(sq) ||
      (r.address || '').toLowerCase().includes(sq) ||
      (r.city || '').toLowerCase().includes(sq) ||
      (r.state || '').toLowerCase().includes(sq) ||
      (r.seller || '').toLowerCase().includes(sq) ||
      (r.listing_broker || '').toLowerCase().includes(sq) ||
      (isComps ? (r.buyer || '').toLowerCase().includes(sq) || (r.procuring_broker || '').toLowerCase().includes(sq) : false)
    );
  }

  const totalPages = Math.ceil(filtered.length / DIA_SALES_PAGE_SIZE);
  const pageRows = filtered.slice(diaSalesPage * DIA_SALES_PAGE_SIZE, (diaSalesPage + 1) * DIA_SALES_PAGE_SIZE);

  let html = '<div class="biz-section">';

  // Sub-tab toggle: Sales Comps | Available
  html += '<div class="pills" style="margin-bottom: 16px;">';
  html += '<button class="pill' + (isComps ? ' active' : '') + '" data-sales-view="comps">Sales Comps (' + fmtN((diaSalesComps || []).length) + ')</button>';
  html += '<button class="pill' + (!isComps ? ' active' : '') + '" data-sales-view="available">Available (' + fmtN((diaAvailListings || []).length) + ')</button>';
  html += '</div>';

  // Metrics
  html += '<div class="gov-metrics">';
  // Helper: compute average cap rate, filtering outliers (only 0.01–0.25 i.e. 1%–25%)
  const avgCapRate = (arr, field) => {
    const valid = arr.filter(r => { const v = parseFloat(r[field]); return v > 0.01 && v < 0.25; });
    if (valid.length === 0) return { val: '—', n: 0 };
    return { val: (valid.reduce((s, r) => s + parseFloat(r[field]), 0) / valid.length * 100).toFixed(2) + '%', n: valid.length };
  };
  if (isComps) {
    const withPrice = data.filter(r => r.price > 0);
    const cap = avgCapRate(data, 'cap_rate');
    const avgPrice = withPrice.length > 0 ? '$' + fmtN(Math.round(withPrice.reduce((s, r) => s + parseFloat(r.price), 0) / withPrice.length)) : '—';
    html += metricHTML('Total Sales', fmtN(data.length), 'dialysis comps', 'blue');
    html += metricHTML('Avg Cap Rate', cap.val, cap.n + ' with cap data', 'green');
    html += metricHTML('Avg Sale Price', avgPrice, withPrice.length + ' with price data', 'purple');
    const thisYear = data.filter(r => r.sold_date && r.sold_date >= new Date().getFullYear() + '-01-01').length;
    html += metricHTML('This Year', fmtN(thisYear), 'sales YTD', 'yellow');
  } else {
    const withPrice = data.filter(r => r.ask_price > 0);
    const cap = avgCapRate(data, 'ask_cap');
    const avgAsk = withPrice.length > 0 ? '$' + fmtN(Math.round(withPrice.reduce((s, r) => s + parseFloat(r.ask_price), 0) / withPrice.length)) : '—';
    html += metricHTML('Active Listings', fmtN(data.length), 'on market', 'blue');
    html += metricHTML('Avg Ask Cap', cap.val, cap.n + ' with cap data', 'green');
    html += metricHTML('Avg Ask Price', avgAsk, withPrice.length + ' priced', 'purple');
    const avgDom = data.filter(r => r.dom > 0);
    const avgDomVal = avgDom.length > 0 ? Math.round(avgDom.reduce((s, r) => s + r.dom, 0) / avgDom.length) : '—';
    html += metricHTML('Avg DOM', avgDomVal, avgDom.length + ' with dates', 'yellow');
  }
  html += '</div>';

  // Search bar
  html += '<div style="margin: 16px 0; display: flex; gap: 8px; align-items: center;">';
  html += '<input type="text" id="diaSalesSearchInput" placeholder="Search tenant, address, city, broker..." value="' + esc(diaSalesSearch) + '" style="flex:1; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--s2); color: var(--text); font-size: 13px;" />';
  html += '<span style="font-size: 12px; color: var(--text3);">' + fmtN(filtered.length) + ' results</span>';
  html += '</div>';

  // Scrollable table
  html += '<div style="overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--border); border-radius: 10px;">';
  html += '<table style="width: max-content; min-width: 100%; border-collapse: collapse; font-size: 12px;">';

  // Header
  html += '<thead><tr style="background: var(--s2); position: sticky; top: 0; z-index: 1;">';
  const th = (label, w) => '<th style="padding: 10px 8px; text-align: left; font-weight: 600; font-size: 11px; letter-spacing: 0.3px; text-transform: uppercase; color: var(--text2); border-bottom: 2px solid var(--border); white-space: nowrap; min-width: ' + w + 'px;">' + label + '</th>';
  const thr = (label, w) => '<th style="padding: 10px 8px; text-align: right; font-weight: 600; font-size: 11px; letter-spacing: 0.3px; text-transform: uppercase; color: var(--text2); border-bottom: 2px solid var(--border); white-space: nowrap; min-width: ' + w + 'px;">' + label + '</th>';

  if (isComps) {
    html += th('Tenant/Operator', 160);
    html += th('Address', 140);
    html += th('City', 90);
    html += th('State', 40);
    html += thr('Land', 55);
    html += thr('Built', 45);
    html += thr('RBA', 60);
    html += thr('Rent', 75);
    html += thr('Rent/SF', 60);
    html += th('Expiration', 85);
    html += thr('Term Rem', 65);
    html += th('Expenses', 70);
    html += th('Bumps', 90);
    html += thr('Price', 85);
    html += thr('Price/SF', 65);
    html += thr('Cap', 55);
    html += th('Sold Date', 80);
    html += th('Seller', 110);
    html += th('Listing Broker', 100);
    html += th('Buyer', 110);
    html += th('Procuring Broker', 110);
    html += thr('Bid-Ask', 55);
    html += thr('DOM', 45);
  } else {
    html += th('Tenant/Operator', 160);
    html += th('Address', 140);
    html += th('City', 90);
    html += th('State', 40);
    html += thr('Land', 55);
    html += thr('Built', 45);
    html += thr('RBA', 60);
    html += thr('Rent', 75);
    html += thr('Rent/SF', 60);
    html += th('Expiration', 85);
    html += thr('Term Rem', 65);
    html += th('Expenses', 70);
    html += th('Bumps', 90);
    html += thr('Ask Price', 85);
    html += thr('Price/SF', 65);
    html += thr('Ask Cap', 55);
    html += th('Seller', 110);
    html += th('Listing Broker', 100);
    html += thr('DOM', 45);
  }
  html += '</tr></thead>';

  // Body
  html += '<tbody>';
  const td = (val, trunc) => '<td style="padding: 8px; border-bottom: 1px solid var(--border); white-space: nowrap;' + (trunc ? ' max-width: 180px; overflow: hidden; text-overflow: ellipsis;' : '') + '">' + esc(val || '—') + '</td>';
  const tdr = (val) => '<td style="padding: 8px; border-bottom: 1px solid var(--border); white-space: nowrap; text-align: right; font-family: \'JetBrains Mono\', monospace; font-size: 11px;">' + (val || '—') + '</td>';
  const fmtMoney = (v) => v != null && v > 0 ? '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
  const fmtCap = (v) => v != null && v > 0 ? (v < 1 ? (v * 100).toFixed(2) : parseFloat(v).toFixed(2)) + '%' : '—';
  const fmtPSF = (v) => v != null && v > 0 ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const fmtAcres = (v) => v != null && v > 0 ? parseFloat(v).toFixed(2) + ' ac' : '—';
  const fmtSF = (v) => v != null && v > 0 ? Number(Math.round(v)).toLocaleString('en-US') + ' SF' : '—';
  const fmtTerm = (v) => v != null ? parseFloat(v).toFixed(1) + ' yr' : '—';
  const fmtDate = (v) => v || '—';

  pageRows.forEach(r => {
    const rowData = JSON.stringify({ property_id: r.property_id, clinic_id: r.clinic_id, tenant_operator: r.tenant_operator, address: r.address, city: r.city, state: r.state }).replace(/'/g, '&#39;');
    html += '<tr class="clickable-row" onclick=\'showDetail(' + rowData + ', "dia-clinic")\' style="cursor: pointer;">';
    html += td(r.tenant_operator, true);
    html += td(r.address, true);
    html += td(r.city);
    html += td(r.state);
    html += tdr(fmtAcres(r.land_area));
    html += tdr(r.year_built || '—');
    html += tdr(fmtSF(r.rba));
    html += tdr(fmtMoney(r.rent));
    html += tdr(fmtPSF(r.rent_per_sf));
    html += td(fmtDate(r.lease_expiration));
    html += tdr(fmtTerm(r.term_remaining_yrs));
    html += td(r.expenses);
    html += td(r.bumps, true);
    if (isComps) {
      html += tdr(fmtMoney(r.price));
      html += tdr(fmtPSF(r.price_per_sf));
      html += tdr(fmtCap(r.cap_rate));
      html += td(fmtDate(r.sold_date));
      html += td(r.seller, true);
      html += td(r.listing_broker, true);
      html += td(r.buyer, true);
      html += td(r.procuring_broker, true);
      html += tdr(r.bid_ask_spread != null ? r.bid_ask_spread + '%' : '—');
      html += tdr(r.dom != null ? r.dom + 'd' : '—');
    } else {
      html += tdr(fmtMoney(r.ask_price));
      html += tdr(fmtPSF(r.price_per_sf));
      html += tdr(fmtCap(r.ask_cap));
      html += td(r.seller, true);
      html += td(r.listing_broker, true);
      html += tdr(r.dom != null ? r.dom + 'd' : '—');
    }
    html += '</tr>';
  });

  if (pageRows.length === 0) {
    const colSpan = isComps ? 23 : 19;
    html += '<tr><td colspan="' + colSpan + '" style="text-align: center; padding: 32px; color: var(--text3);">No ' + (isComps ? 'sales comps' : 'available listings') + ' to display</td></tr>';
  }
  html += '</tbody></table></div>';

  // Pagination
  if (totalPages > 1) {
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 13px; color: var(--text2);">';
    html += '<span>Page ' + (diaSalesPage + 1) + ' of ' + totalPages + ' (' + fmtN(filtered.length) + ' total)</span>';
    html += '<div style="display: flex; gap: 6px;">';
    html += '<button class="pill' + (diaSalesPage === 0 ? '' : ' active') + '" data-sales-page="prev"' + (diaSalesPage === 0 ? ' disabled style="opacity:0.4;pointer-events:none"' : '') + '>&laquo; Prev</button>';
    html += '<button class="pill' + (diaSalesPage >= totalPages - 1 ? '' : ' active') + '" data-sales-page="next"' + (diaSalesPage >= totalPages - 1 ? ' disabled style="opacity:0.4;pointer-events:none"' : '') + '>Next &raquo;</button>';
    html += '</div></div>';
  }

  html += '</div>';

  // Render to DOM
  const inner = q('#bizPageInner');
  if (inner) inner.innerHTML = html;

  // Bind events
  document.querySelectorAll('[data-sales-view]').forEach(btn => {
    btn.addEventListener('click', e => {
      diaSalesView = e.target.dataset.salesView;
      diaSalesPage = 0;
      diaSalesSearch = '';
      renderDiaSales();
    });
  });
  document.querySelectorAll('[data-sales-page]').forEach(btn => {
    btn.addEventListener('click', e => {
      if (e.target.dataset.salesPage === 'prev' && diaSalesPage > 0) diaSalesPage--;
      else if (e.target.dataset.salesPage === 'next') diaSalesPage++;
      renderDiaSales();
    });
  });
  const searchInput = document.getElementById('diaSalesSearchInput');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', e => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        diaSalesSearch = e.target.value.trim();
        diaSalesPage = 0;
        renderDiaSales();
      }, 300);
    });
    searchInput.focus();
    // Keep cursor at end of input
    searchInput.selectionStart = searchInput.selectionEnd = searchInput.value.length;
  }
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
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(norm(r.facility_name) || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(167,139,250,0.15); color: #a78bfa;">Clinic</span></div>';
          html += '<div class="search-card-meta">';
          if (r.city || r.state) html += '<span>' + esc((norm(r.city) || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</span>';
          if (r.medicare_npi) html += '<span>NPI: ' + esc(r.medicare_npi) + '</span>';
          if (r.operator_name) html += '<span>Op: ' + esc(norm(r.operator_name)) + '</span>';
          if (r.latest_total_patients) html += '<span>Patients: ' + fmtN(r.latest_total_patients) + '</span>';
          if (r.change_type) html += '<span>' + esc(cleanLabel(r.change_type)) + '</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      if (npiSignals.length > 0) {
        html += '<div class="search-results-section"><h4>NPI Signals (' + npiSignals.length + ')</h4>';
        npiSignals.forEach(r => {
          html += '<div class="search-card" onclick=\'showDetail(' + JSON.stringify(r).replace(/'/g,"&#39;") + ', "dia-clinic")\'>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(norm(r.facility_name) || r.npi || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(248,113,113,0.15); color: #f87171;">NPI Signal</span></div>';
          html += '<div class="search-card-meta">';
          if (r.city || r.state) html += '<span>' + esc((norm(r.city) || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</span>';
          if (r.signal_type) html += '<span>Signal: ' + esc(cleanLabel(r.signal_type)) + '</span>';
          if (r.npi) html += '<span>NPI: ' + esc(r.npi) + '</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      if (propQueue.length > 0) {
        html += '<div class="search-results-section"><h4>Property Review Queue (' + propQueue.length + ')</h4>';
        propQueue.forEach(r => {
          html += '<div class="search-card" onclick=\'showDetail(' + JSON.stringify(r).replace(/'/g,"&#39;") + ', "dia-clinic")\'>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(norm(r.facility_name) || r.clinic_id || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(251,191,36,0.15); color: #fbbf24;">Property</span></div>';
          html += '<div class="search-card-meta">';
          if (r.state) html += '<span>' + esc(r.state) + '</span>';
          if (r.operator_name) html += '<span>Op: ' + esc(norm(r.operator_name)) + '</span>';
          if (r.review_type) html += '<span>Review: ' + esc(cleanLabel(r.review_type)) + '</span>';
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
