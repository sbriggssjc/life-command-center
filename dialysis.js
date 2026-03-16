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
let diaPropertyFilter = { review_type: null, state: null, selectedIdx: undefined };
let diaLeaseFilter = { priority: null, selectedIdx: undefined };
let diaChangeFilter = 'all'; // 'all' | 'added' | 'removed' | 'persistent'
let diaNpiFilter = null; // filter by signal_type
let diaSalesView = 'comps'; // 'comps' | 'available'
let diaSalesComps = null;   // lazy-loaded from v_sales_comps
let diaAvailListings = null; // lazy-loaded from available_listings (on-market only)
let diaFinancialEstimates = null; // lazy-loaded from clinic_financial_estimates
let diaSalesLoading = false;
let diaSalesSearch = '';
let diaSalesPage = 0;
let diaSalesSort = { col: null, dir: 'desc' }; // column sort state
let diaSalesStateFilter = ''; // state filter
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
      inner.innerHTML = '<div style="text-align:center;padding:32px;color:var(--red)"><p style="font-size:16px;margin-bottom:8px">Failed to load dialysis data</p><p style="color:var(--text2);font-size:13px">' + esc(err.message || 'Unknown error') + '</p><button class="gov-btn" onclick="loadDiaData()" style="margin-top:12px">Retry</button></div>';
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
    case 'leases':
      renderDiaLeases(); // async — renders directly to DOM
      return;
    case 'loans':
      renderDiaLoans(); // async — renders directly to DOM
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
// OVERVIEW TAB — Infographic-Style Command Center
// ============================================================================

// Helper: navigate to a dia sub-tab
function goToDiaTab(tabName) {
  currentDiaTab = tabName;
  document.querySelectorAll('#diaInnerTabs .gov-inner-tab').forEach(t => t.classList.remove('active'));
  const btn = document.querySelector('[data-dia-tab="' + tabName + '"]');
  if (btn) btn.classList.add('active');
  if (tabName === 'activity') { renderBizContent(); }
  else if (typeof diaDataLoaded !== 'undefined' && diaDataLoaded) { renderDiaTab(); }
}

// Helper: build a clickable infographic card
function infoCard(opts) {
  const { title, value, sub, trend, trendLabel, color, icon, tab, span } = opts;
  const colors = { blue:'#6c8cff', green:'#34d399', yellow:'#fbbf24', red:'#f87171', purple:'#a78bfa', cyan:'#22d3ee', white:'var(--text1)', orange:'#fb923c' };
  const c = colors[color] || colors.blue;
  const trendColor = trend > 0 ? '#34d399' : trend < 0 ? '#f87171' : 'var(--text3)';
  const trendArrow = trend > 0 ? '▲' : trend < 0 ? '▼' : '—';
  const trendStr = trend != null ? `<div style="font-size:11px;color:${trendColor};margin-top:4px">${trendArrow} ${trendLabel || ''}</div>` : '';
  const click = tab ? ` onclick="goToDiaTab('${tab}')" style="cursor:pointer"` : '';
  const spanStyle = span ? `grid-column: span ${span};` : '';
  return `<div class="dia-info-card"${click} style="${spanStyle}">
    ${icon ? `<div style="font-size:20px;margin-bottom:4px">${icon}</div>` : ''}
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:6px">${title}</div>
    <div style="font-size:28px;font-weight:800;color:${c};line-height:1">${value}</div>
    ${sub ? `<div style="font-size:11px;color:var(--text2);margin-top:4px">${sub}</div>` : ''}
    ${trendStr}
  </div>`;
}

// Helper: section header
function sectionHeader(title, icon, tab) {
  const click = tab ? ` onclick="goToDiaTab('${tab}')" style="cursor:pointer"` : '';
  return `<div${click} style="display:flex;align-items:center;gap:8px;margin:28px 0 12px;padding:0 2px">
    <span style="font-size:16px">${icon}</span>
    <span style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text2)">${title}</span>
    ${tab ? '<span style="font-size:11px;color:var(--accent);margin-left:auto">View Details →</span>' : ''}
  </div>`;
}

/**
 * Render overview — infographic-style command center homepage
 */
function renderDiaOverview() {
  // Kick off lazy-loading sales comps and listings in background if not cached
  if (!diaSalesComps && !diaSalesLoading) {
    diaSalesLoading = true;
    (async () => {
      try {
        let all = [], pg = 0;
        while (true) {
          const batch = await diaQuery('v_sales_comps', '*', { order: 'sold_date.desc.nullslast', limit: 1000, offset: pg * 1000 });
          all = all.concat(batch || []);
          if (!batch || batch.length < 1000) break;
          pg++;
        }
        diaSalesComps = all;
      } catch(e) { diaSalesComps = []; }
      diaSalesLoading = false;
      // Re-render sales section once loaded
      const salesEl = document.getElementById('diaOverviewSales');
      if (salesEl) salesEl.innerHTML = renderSalesMetricsInner();
      const nmEl = document.getElementById('diaOverviewNM');
      if (nmEl) nmEl.innerHTML = renderNorthmarqInner();
    })();
  }
  if (!diaAvailListings) {
    (async () => {
      try {
        // Filter to on-market statuses only: active, Active, Available, For Sale
        let all = [], pg = 0;
        while (true) {
          const batch = await diaQuery('available_listings', '*', {
            order: 'listing_date.desc.nullslast',
            limit: 1000, offset: pg * 1000,
            filter: 'status=in.(active,Active,Available,For Sale)',
          });
          all = all.concat(batch || []);
          if (!batch || batch.length < 1000) break;
          pg++;
        }
        diaAvailListings = all;
      } catch(e) { diaAvailListings = []; }
      const mktEl = document.getElementById('diaOverviewMarket');
      if (mktEl) mktEl.innerHTML = renderOnMarketInner();
    })();
  }

  // Lazy-load clinic financial estimates
  if (!diaFinancialEstimates) {
    (async () => {
      try {
        // Load latest primary estimates (highest-confidence per clinic)
        const batch = await diaQuery('clinic_financial_estimates', 'medicare_id,estimate_source,estimated_annual_revenue,estimated_annual_profit,estimated_ebitda,patient_count,chairs_used,confidence_score', {
          filter: 'is_latest=eq.true',
          limit: 10000,
        });
        diaFinancialEstimates = batch || [];
      } catch(e) { diaFinancialEstimates = []; }
      const finEl = document.getElementById('diaOverviewFinancials');
      if (finEl) finEl.innerHTML = renderFinancialMetricsInner();
    })();
  }

  let html = '<div style="padding:4px 0">';

  // ── STYLE ──
  html += `<style>
    .dia-info-card { background: var(--s2); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; transition: all 0.15s; position: relative; overflow: hidden; }
    .dia-info-card:hover { border-color: var(--accent); transform: translateY(-1px); box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
    .dia-info-card[onclick] { cursor: pointer; }
    .dia-info-card[onclick]::after { content: '→'; position: absolute; top: 12px; right: 14px; font-size: 14px; color: var(--text3); opacity: 0; transition: opacity 0.15s; }
    .dia-info-card[onclick]:hover::after { opacity: 1; color: var(--accent); }
    .dia-grid { display: grid; gap: 10px; }
    .dia-grid-4 { grid-template-columns: repeat(4, 1fr); }
    .dia-grid-3 { grid-template-columns: repeat(3, 1fr); }
    .dia-grid-5 { grid-template-columns: repeat(5, 1fr); }
    .dia-divider { border: none; border-top: 1px solid var(--border); margin: 8px 0; }
    @media (max-width: 900px) {
      .dia-grid-4, .dia-grid-5 { grid-template-columns: repeat(2, 1fr); }
      .dia-grid-3 { grid-template-columns: repeat(2, 1fr); }
    }
  </style>`;

  // ── DATA ──
  const f = diaData.freshness || {};
  const totalClinics = f.total_clinics || 0;
  const coveragePct = f.coverage_pct || 0;
  const clinicsWithCounts = f.clinics_with_counts || 0;
  const addedCount = diaData.inventorySummary.added?.clinic_count || 0;
  const removedCount = diaData.inventorySummary.removed?.clinic_count || 0;
  const npiSignalCount = Object.values(diaData.npiSummary).reduce((s,r) => s + (r.signal_count||0), 0);
  const propQueueLen = diaData.propertyReviewQueue?.length || 0;
  const leaseBackfillLen = diaData.leaseBackfillRows?.length || 0;
  const researchDone = diaData.researchOutcomes?.length || 0;

  // Compute patient stats from inventory changes
  const clinicsWithPatients = diaData.inventoryChanges.filter(c => c.latest_total_patients > 0);
  const totalPatients = clinicsWithPatients.reduce((s,c) => s + (c.latest_total_patients || 0), 0);
  const avgPatients = clinicsWithPatients.length > 0 ? Math.round(totalPatients / clinicsWithPatients.length) : 0;

  // Touchpoint metrics from SF activities — full Northmarq IS team
  const NM_TEAM = ['kelly largent', 'sarah martin', 'scott briggs', 'nathanael berwaldt'];
  const allActivities = (typeof activities !== 'undefined' ? activities : []);
  const diaActivities = allActivities.filter(a => {
    const who = (a.assigned_to || '').toLowerCase();
    return NM_TEAM.some(name => who.includes(name));
  });
  const now = new Date();
  const sixMonthsAgo = new Date(now); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const oneMonthAgo = new Date(now); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const touchpointsYTD = diaActivities.filter(a => a.activity_date && new Date(a.activity_date) >= yearStart).length;
  const touchpoints6mo = diaActivities.filter(a => a.activity_date && new Date(a.activity_date) >= sixMonthsAgo).length;
  const touchpoints1mo = diaActivities.filter(a => a.activity_date && new Date(a.activity_date) >= oneMonthAgo).length;
  const uniqueAccounts = new Set(diaActivities.map(a => a.company_name).filter(Boolean)).size;
  const avgTouchPerAcct = uniqueAccounts > 0 ? (touchpointsYTD / uniqueAccounts).toFixed(1) : '—';

  // Property linkage stats
  const linkedPct = totalClinics > 0 ? ((totalClinics - propQueueLen) / totalClinics * 100).toFixed(1) : '—';
  const leaseBackfillPct = totalClinics > 0 ? ((totalClinics - leaseBackfillLen) / totalClinics * 100).toFixed(1) : '—';

  // ═══════════════════════════════════════════════
  // SECTION 1: DATABASE HEALTH
  // ═══════════════════════════════════════════════
  html += sectionHeader('Database Health', '🏥', 'search');
  html += '<div class="dia-grid dia-grid-4">';
  html += infoCard({ title: 'Total Clinics', value: fmtN(totalClinics), sub: 'tracked nationwide', color: 'blue', tab: 'search' });
  html += infoCard({ title: 'Data Coverage', value: coveragePct.toFixed(1) + '%', sub: fmtN(clinicsWithCounts) + ' clinics with patient data', color: coveragePct > 50 ? 'green' : 'yellow', tab: 'search' });
  html += infoCard({ title: 'Property Linked', value: linkedPct + '%', sub: fmtN(totalClinics - propQueueLen) + ' of ' + fmtN(totalClinics) + ' matched', color: 'cyan', tab: 'research' });
  html += infoCard({ title: 'Lease Coverage', value: leaseBackfillPct + '%', sub: fmtN(leaseBackfillLen) + ' need backfill', color: 'purple', tab: 'research' });
  html += '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 2: CLINICAL METRICS
  // ═══════════════════════════════════════════════
  html += sectionHeader('Clinical Metrics', '📊', 'changes');
  html += '<div class="dia-grid dia-grid-4">';
  html += infoCard({ title: 'Avg Patients / Clinic', value: fmtN(avgPatients), sub: fmtN(totalPatients) + ' total across ' + fmtN(clinicsWithPatients.length) + ' clinics', color: 'blue', tab: 'changes' });
  html += infoCard({ title: 'Inventory Changes', value: fmtN(addedCount + removedCount), sub: '+' + fmtN(addedCount) + ' added · -' + fmtN(removedCount) + ' removed', color: addedCount > removedCount ? 'green' : 'red', tab: 'changes' });
  html += infoCard({ title: 'NPI Signals', value: fmtN(npiSignalCount), sub: 'provider changes detected', color: 'orange', tab: 'npi' });
  html += infoCard({ title: 'Top Mover', value: diaData.moversUp?.[0] ? '+' + fmtN(diaData.moversUp[0].delta_patients) : '—', sub: diaData.moversUp?.[0] ? norm(diaData.moversUp[0].facility_name || '').substring(0,30) : 'no data', color: 'green', tab: 'changes' });
  html += '</div>';

  // Top Movers mini-charts
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">';
  html += '<div class="dia-info-card" onclick="goToDiaTab(\'changes\')" style="cursor:pointer;padding:14px 16px">';
  html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">Top 5 Movers Up</div>';
  (diaData.moversUp || []).slice(0, 5).forEach((r, i) => {
    const maxDelta = diaData.moversUp[0]?.delta_patients || 1;
    const barW = Math.round((r.delta_patients / maxDelta) * 100);
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <div style="width:20px;font-size:10px;color:var(--text3);text-align:right">${i+1}</div>
      <div style="flex:1;font-size:11px;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(norm(r.facility_name||'').substring(0,25))}</div>
      <div style="width:80px;height:8px;background:var(--s3);border-radius:4px;overflow:hidden"><div style="width:${barW}%;height:100%;background:#34d399;border-radius:4px"></div></div>
      <div style="width:36px;font-size:10px;color:#34d399;text-align:right;font-weight:600">+${r.delta_patients}</div>
    </div>`;
  });
  html += '</div>';

  html += '<div class="dia-info-card" onclick="goToDiaTab(\'changes\')" style="cursor:pointer;padding:14px 16px">';
  html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">Top 5 Movers Down</div>';
  (diaData.moversDown || []).slice(0, 5).forEach((r, i) => {
    const maxDelta = Math.abs(diaData.moversDown[0]?.delta_patients || 1);
    const barW = Math.round((Math.abs(r.delta_patients) / maxDelta) * 100);
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <div style="width:20px;font-size:10px;color:var(--text3);text-align:right">${i+1}</div>
      <div style="flex:1;font-size:11px;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(norm(r.facility_name||'').substring(0,25))}</div>
      <div style="width:80px;height:8px;background:var(--s3);border-radius:4px;overflow:hidden"><div style="width:${barW}%;height:100%;background:#f87171;border-radius:4px"></div></div>
      <div style="width:36px;font-size:10px;color:#f87171;text-align:right;font-weight:600">${r.delta_patients}</div>
    </div>`;
  });
  html += '</div>';
  html += '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 3: CLINIC FINANCIALS (async)
  // ═══════════════════════════════════════════════
  html += sectionHeader('Clinic Financial Estimates', '💵', 'search');
  html += '<div id="diaOverviewFinancials">' + renderFinancialMetricsInner() + '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 4: OUTREACH & TOUCHPOINTS
  // ═══════════════════════════════════════════════
  html += sectionHeader('Team Outreach & Touchpoints', '📞', 'activity');
  html += '<div class="dia-grid dia-grid-5">';
  html += infoCard({ title: 'Team Touchpoints YTD', value: fmtN(touchpointsYTD), sub: now.getFullYear() + ' year to date', color: 'blue', tab: 'activity' });
  html += infoCard({ title: 'Last 6 Months', value: fmtN(touchpoints6mo), sub: 'team contacts', color: 'green', tab: 'activity' });
  html += infoCard({ title: 'Last 30 Days', value: fmtN(touchpoints1mo), sub: 'recent contacts', color: 'cyan', tab: 'activity' });
  html += infoCard({ title: 'Unique Accounts', value: fmtN(uniqueAccounts), sub: 'companies touched', color: 'purple', tab: 'activity' });
  html += infoCard({ title: 'Avg / Account', value: avgTouchPerAcct, sub: 'touchpoints per account YTD', color: 'yellow', tab: 'activity' });
  html += '</div>';

  // Per-team-member breakdown
  html += '<div class="dia-grid dia-grid-4" style="margin-top:10px">';
  const memberColors = { 'kelly largent': 'green', 'sarah martin': 'purple', 'scott briggs': 'blue', 'nathanael berwaldt': 'cyan' };
  NM_TEAM.forEach(name => {
    const memberActs = diaActivities.filter(a => (a.assigned_to || '').toLowerCase().includes(name));
    const ytd = memberActs.filter(a => a.activity_date && new Date(a.activity_date) >= yearStart).length;
    const displayName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    html += infoCard({ title: displayName, value: fmtN(ytd), sub: 'YTD touchpoints', color: memberColors[name] || 'blue', tab: 'activity' });
  });
  html += '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 5: TTM SALES MARKET
  // ═══════════════════════════════════════════════
  html += sectionHeader('TTM Sales Activity', '💰', 'sales');
  html += '<div id="diaOverviewSales">' + renderSalesMetricsInner() + '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 6: NORTHMARQ PERFORMANCE
  // ═══════════════════════════════════════════════
  html += sectionHeader('Northmarq Performance', '🏆', 'sales');
  html += '<div id="diaOverviewNM">' + renderNorthmarqInner() + '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 7: ON MARKET
  // ═══════════════════════════════════════════════
  html += sectionHeader('On Market', '🏪', 'sales');
  html += '<div id="diaOverviewMarket">' + renderOnMarketInner() + '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 8: RESEARCH PIPELINE
  // ═══════════════════════════════════════════════
  html += sectionHeader('Research Pipeline', '🔬', 'research');
  html += '<div class="dia-grid dia-grid-4">';
  html += infoCard({ title: 'Property Queue', value: fmtN(propQueueLen), sub: 'pending review', color: 'yellow', tab: 'research' });
  html += infoCard({ title: 'Lease Backfill', value: fmtN(leaseBackfillLen), sub: 'missing lease data', color: 'orange', tab: 'research' });
  html += infoCard({ title: 'Completed Reviews', value: fmtN(researchDone), sub: 'outcomes logged', color: 'green', tab: 'research' });
  const reconStatus = diaData.reconciliation?.run_status || 'unknown';
  const reconDate = diaData.reconciliation?.started_at ? new Date(diaData.reconciliation.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
  html += infoCard({ title: 'Last Ingestion', value: reconDate, sub: reconStatus, color: reconStatus === 'success' ? 'green' : reconStatus === 'partial' ? 'yellow' : 'red' });
  html += '</div>';

  html += '</div>'; // end wrapper
  return html;
}

// ── Inner renderers for async-loaded sections ──

function renderSalesMetricsInner() {
  if (!diaSalesComps) {
    return '<div class="dia-grid dia-grid-5"><div class="dia-info-card" style="grid-column:span 5;text-align:center;padding:24px"><span class="spinner"></span><div style="margin-top:8px;font-size:12px;color:var(--text2)">Loading sales data...</div></div></div>';
  }
  const comps = diaSalesComps;
  const now = new Date();
  const ttmStart = new Date(now); ttmStart.setFullYear(ttmStart.getFullYear() - 1);
  const ttmComps = comps.filter(r => r.sold_date && new Date(r.sold_date) >= ttmStart);
  const ttmWithPrice = ttmComps.filter(r => r.price > 0);
  const ttmVolume = ttmWithPrice.reduce((s,r) => s + parseFloat(r.price || 0), 0);
  const ttmTxns = ttmComps.length;

  // Cap rates (filter outliers: 1%–25%)
  const validCaps = ttmComps.filter(r => { const v = parseFloat(r.cap_rate); return v > 0.01 && v < 0.25; }).map(r => parseFloat(r.cap_rate)).sort((a,b) => a - b);
  const avgCap = validCaps.length > 0 ? (validCaps.reduce((s,v) => s+v, 0) / validCaps.length * 100).toFixed(2) + '%' : '—';
  const q1Idx = Math.floor(validCaps.length * 0.25);
  const q3Idx = Math.floor(validCaps.length * 0.75);
  const lowerQCap = validCaps.length > 4 ? (validCaps[q1Idx] * 100).toFixed(2) + '%' : '—';
  const upperQCap = validCaps.length > 4 ? (validCaps[q3Idx] * 100).toFixed(2) + '%' : '—';

  let h = '<div class="dia-grid dia-grid-5">';
  h += infoCard({ title: 'TTM Volume', value: '$' + fmtN(Math.round(ttmVolume / 1000000)) + 'M', sub: fmtN(ttmWithPrice.length) + ' priced transactions', color: 'green', tab: 'sales' });
  h += infoCard({ title: 'TTM Transactions', value: fmtN(ttmTxns), sub: 'trailing 12 months', color: 'blue', tab: 'sales' });
  h += infoCard({ title: 'Avg Cap Rate', value: avgCap, sub: fmtN(validCaps.length) + ' with cap data', color: 'cyan', tab: 'sales' });
  h += infoCard({ title: 'Lower Quartile', value: lowerQCap, sub: '25th percentile', color: 'purple', tab: 'sales' });
  h += infoCard({ title: 'Upper Quartile', value: upperQCap, sub: '75th percentile', color: 'yellow', tab: 'sales' });
  h += '</div>';

  // Historical total comps
  h += '<div class="dia-grid dia-grid-3" style="margin-top:10px">';
  const allWithPrice = comps.filter(r => r.price > 0);
  const totalVolume = allWithPrice.reduce((s,r) => s + parseFloat(r.price || 0), 0);
  const avgPrice = allWithPrice.length > 0 ? '$' + fmtN(Math.round(allWithPrice.reduce((s,r) => s + parseFloat(r.price), 0) / allWithPrice.length)) : '—';
  h += infoCard({ title: 'All-Time Comps', value: fmtN(comps.length), sub: 'total in database', color: 'blue', tab: 'sales' });
  h += infoCard({ title: 'All-Time Volume', value: '$' + fmtN(Math.round(totalVolume / 1000000)) + 'M', sub: fmtN(allWithPrice.length) + ' priced sales', color: 'green', tab: 'sales' });
  h += infoCard({ title: 'Avg Sale Price', value: avgPrice, sub: 'across all comps', color: 'purple', tab: 'sales' });
  h += '</div>';
  return h;
}

function renderNorthmarqInner() {
  if (!diaSalesComps) {
    return '<div class="dia-grid dia-grid-4"><div class="dia-info-card" style="grid-column:span 4;text-align:center;padding:24px"><span class="spinner"></span><div style="margin-top:8px;font-size:12px;color:var(--text2)">Loading...</div></div></div>';
  }
  const comps = diaSalesComps;
  const now = new Date();
  const ttmStart = new Date(now); ttmStart.setFullYear(ttmStart.getFullYear() - 1);
  const ttmComps = comps.filter(r => r.sold_date && new Date(r.sold_date) >= ttmStart);
  const isNM = r => ((r.listing_broker||'')+(r.procuring_broker||'')).toLowerCase().includes('northmarq');
  const nmComps = ttmComps.filter(isNM);
  const nmWithPrice = nmComps.filter(r => r.price > 0);
  const nmVolume = nmWithPrice.reduce((s,r) => s + parseFloat(r.price || 0), 0);
  const ttmWithPrice = ttmComps.filter(r => r.price > 0);
  const ttmVolume = ttmWithPrice.reduce((s,r) => s + parseFloat(r.price || 0), 0);
  const marketShareTxn = ttmComps.length > 0 ? (nmComps.length / ttmComps.length * 100).toFixed(1) + '%' : '—';
  const marketShareVol = ttmVolume > 0 ? (nmVolume / ttmVolume * 100).toFixed(1) + '%' : '—';

  // NM avg cap vs market avg cap
  const nmCaps = nmComps.filter(r => { const v = parseFloat(r.cap_rate); return v > 0.01 && v < 0.25; }).map(r => parseFloat(r.cap_rate));
  const mktCaps = ttmComps.filter(r => { const v = parseFloat(r.cap_rate); return v > 0.01 && v < 0.25; }).map(r => parseFloat(r.cap_rate));
  const nmAvgCap = nmCaps.length > 0 ? (nmCaps.reduce((s,v)=>s+v,0)/nmCaps.length*100).toFixed(2) + '%' : '—';
  const mktAvgCap = mktCaps.length > 0 ? (mktCaps.reduce((s,v)=>s+v,0)/mktCaps.length*100).toFixed(2) + '%' : '—';
  // Cap rate advantage (lower cap = higher price = better for sellers)
  const capAdv = (nmCaps.length > 0 && mktCaps.length > 0) ?
    ((mktCaps.reduce((s,v)=>s+v,0)/mktCaps.length - nmCaps.reduce((s,v)=>s+v,0)/nmCaps.length) * 10000).toFixed(0) : null;
  const capAdvStr = capAdv ? capAdv + ' bps tighter' : '—';

  let h = '<div class="dia-grid dia-grid-4">';
  h += infoCard({ title: 'NM TTM Sales', value: fmtN(nmComps.length), sub: '$' + fmtN(Math.round(nmVolume / 1000000)) + 'M volume', color: 'green', tab: 'sales' });
  h += infoCard({ title: 'Market Share (Txns)', value: marketShareTxn, sub: fmtN(nmComps.length) + ' of ' + fmtN(ttmComps.length) + ' TTM deals', color: 'blue', tab: 'sales' });
  h += infoCard({ title: 'NM Avg Cap Rate', value: nmAvgCap, sub: 'vs ' + mktAvgCap + ' market avg', color: 'cyan', tab: 'sales' });
  h += infoCard({ title: 'Seller Value Add', value: capAdvStr, sub: capAdv && parseInt(capAdv) > 0 ? 'tighter caps = higher proceeds' : 'vs market average', color: parseInt(capAdv) > 0 ? 'green' : 'yellow', tab: 'sales' });
  h += '</div>';
  return h;
}

function renderOnMarketInner() {
  if (!diaAvailListings) {
    return '<div class="dia-grid dia-grid-4"><div class="dia-info-card" style="grid-column:span 4;text-align:center;padding:24px"><span class="spinner"></span><div style="margin-top:8px;font-size:12px;color:var(--text2)">Loading listings...</div></div></div>';
  }
  const listings = diaAvailListings;
  const withPrice = listings.filter(r => r.ask_price > 0);
  const validCaps = listings.filter(r => { const v = parseFloat(r.ask_cap); return v > 0.01 && v < 0.25; }).map(r => parseFloat(r.ask_cap)).sort((a,b) => a-b);
  const avgAskCap = validCaps.length > 0 ? (validCaps.reduce((s,v)=>s+v,0)/validCaps.length*100).toFixed(2) + '%' : '—';
  const q1Idx = Math.floor(validCaps.length * 0.25);
  const q3Idx = Math.floor(validCaps.length * 0.75);
  const lowerQ = validCaps.length > 4 ? (validCaps[q1Idx]*100).toFixed(2)+'%' : '—';
  const upperQ = validCaps.length > 4 ? (validCaps[q3Idx]*100).toFixed(2)+'%' : '—';
  const avgDom = listings.filter(r => r.dom > 0);
  const avgDomVal = avgDom.length > 0 ? Math.round(avgDom.reduce((s,r)=>s+r.dom,0)/avgDom.length) : '—';
  const isNM = r => ((r.listing_broker||'')).toLowerCase().includes('northmarq');
  const nmListings = listings.filter(isNM);

  let h = '<div class="dia-grid dia-grid-5">';
  h += infoCard({ title: 'Active Listings', value: fmtN(listings.length), sub: 'clinics on market', color: 'blue', tab: 'sales' });
  h += infoCard({ title: 'Avg Ask Cap', value: avgAskCap, sub: fmtN(validCaps.length) + ' with cap data', color: 'cyan', tab: 'sales' });
  h += infoCard({ title: 'Lower Quartile', value: lowerQ, sub: '25th pctl ask cap', color: 'purple', tab: 'sales' });
  h += infoCard({ title: 'Upper Quartile', value: upperQ, sub: '75th pctl ask cap', color: 'yellow', tab: 'sales' });
  h += infoCard({ title: 'NM On Market', value: fmtN(nmListings.length), sub: 'Northmarq listings', color: 'green', tab: 'sales' });
  h += '</div>';

  // Additional row
  h += '<div class="dia-grid dia-grid-3" style="margin-top:10px">';
  const avgAskPrice = withPrice.length > 0 ? '$' + fmtN(Math.round(withPrice.reduce((s,r)=>s+parseFloat(r.ask_price),0)/withPrice.length)) : '—';
  h += infoCard({ title: 'Avg Ask Price', value: avgAskPrice, sub: fmtN(withPrice.length) + ' priced', color: 'blue', tab: 'sales' });
  h += infoCard({ title: 'Avg Days on Market', value: avgDomVal, sub: fmtN(avgDom.length) + ' with dates', color: 'yellow', tab: 'sales' });
  h += infoCard({ title: 'NM Market Share', value: listings.length > 0 ? (nmListings.length/listings.length*100).toFixed(1)+'%' : '—', sub: 'of active listings', color: 'green', tab: 'sales' });
  h += '</div>';
  return h;
}

function renderFinancialMetricsInner() {
  if (!diaFinancialEstimates) {
    return '<div class="dia-grid dia-grid-5"><div class="dia-info-card" style="grid-column:span 5;text-align:center;padding:24px"><span class="spinner"></span><div style="margin-top:8px;font-size:12px;color:var(--text2)">Loading financial estimates...</div></div></div>';
  }
  const est = diaFinancialEstimates;
  if (est.length === 0) {
    return '<div class="dia-info-card" style="text-align:center;padding:18px;color:var(--text2)">No financial estimates available</div>';
  }

  // Prefer highest-confidence per clinic (group by medicare_id, pick highest confidence)
  const byClinic = {};
  est.forEach(e => {
    const id = e.medicare_id;
    if (!byClinic[id] || (e.confidence_score || 0) > (byClinic[id].confidence_score || 0)) {
      byClinic[id] = e;
    }
  });
  const best = Object.values(byClinic);
  const withRev = best.filter(e => e.estimated_annual_revenue > 0);
  const withProfit = best.filter(e => e.estimated_annual_profit > 0);
  const withEbitda = best.filter(e => e.estimated_ebitda > 0);

  const totalRev = withRev.reduce((s, e) => s + parseFloat(e.estimated_annual_revenue), 0);
  const avgRev = withRev.length > 0 ? totalRev / withRev.length : 0;
  const totalProfit = withProfit.reduce((s, e) => s + parseFloat(e.estimated_annual_profit), 0);
  const avgProfit = withProfit.length > 0 ? totalProfit / withProfit.length : 0;
  const avgEbitda = withEbitda.length > 0 ? withEbitda.reduce((s, e) => s + parseFloat(e.estimated_ebitda), 0) / withEbitda.length : 0;
  const avgMargin = avgRev > 0 ? (avgProfit / avgRev * 100).toFixed(1) : '—';

  // By source breakdown
  const sources = {};
  est.forEach(e => {
    const src = e.estimate_source || 'unknown';
    if (!sources[src]) sources[src] = 0;
    sources[src]++;
  });

  const coveragePct = best.length > 0 && typeof diaData !== 'undefined' && diaData.freshness?.total_clinics > 0
    ? (best.length / diaData.freshness.total_clinics * 100).toFixed(1) : '—';

  let h = '<div class="dia-grid dia-grid-5">';
  h += infoCard({ title: 'Clinics Estimated', value: fmtN(best.length), sub: coveragePct + '% of database', color: 'blue', tab: 'search' });
  h += infoCard({ title: 'Avg Revenue / Clinic', value: '$' + fmtN(Math.round(avgRev / 1000)) + 'K', sub: fmtN(withRev.length) + ' with revenue data', color: 'green', tab: 'search' });
  h += infoCard({ title: 'Avg Profit / Clinic', value: '$' + fmtN(Math.round(avgProfit / 1000)) + 'K', sub: avgMargin + '% avg margin', color: 'cyan', tab: 'search' });
  h += infoCard({ title: 'Avg EBITDA', value: '$' + fmtN(Math.round(avgEbitda / 1000)) + 'K', sub: fmtN(withEbitda.length) + ' with EBITDA', color: 'purple', tab: 'search' });
  h += infoCard({ title: 'Industry Revenue', value: '$' + fmtN(Math.round(totalRev / 1e9)) + 'B', sub: 'est. across ' + fmtN(withRev.length) + ' clinics', color: 'yellow', tab: 'search' });
  h += '</div>';

  // Source breakdown row
  h += '<div class="dia-grid dia-grid-4" style="margin-top:10px">';
  const srcLabels = { ttm_reported: 'TTM Reported', cms_patient_count: 'CMS Patient Count', google_hours: 'Google Hours', cms_chair_count: 'CMS Chair Count' };
  const srcColors = { ttm_reported: 'green', cms_patient_count: 'blue', google_hours: 'cyan', cms_chair_count: 'yellow' };
  Object.entries(sources).forEach(([src, cnt]) => {
    h += infoCard({ title: srcLabels[src] || src, value: fmtN(cnt), sub: 'estimates', color: srcColors[src] || 'blue' });
  });
  h += '</div>';
  return h;
}

/**
 * Render movers charts (legacy — kept for backward compat but overview uses inline bars now)
 */
function renderDiaMoversChart() {
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
      
      html += `<div class="table-row clickable-row" style="${highlight}" onclick='showDetail(${safeJSON(row)}, "dia-clinic")'>`;
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
      
      html += `<div class="table-row clickable-row" onclick='showDetail(${safeJSON(row)}, "dia-clinic")'>`;
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
  html += `<button class="btn-link${diaResearchMode === 'property' ? '-green' : ''}" data-mode="property" style="cursor: pointer; font-weight: ${diaResearchMode === 'property' ? '600' : '500'};">Property Review Queue</button>`;
  html += `<button class="btn-link${diaResearchMode === 'lease' ? '-green' : ''}" data-mode="lease" style="cursor: pointer; font-weight: ${diaResearchMode === 'lease' ? '600' : '500'};">Lease Backfill Queue</button>`;
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
      const isSelected = diaPropertyFilter.selectedIdx === idx;
      const isResolved = diaData.researchOutcomes.some(o => o.clinic_id === row.clinic_id && o.queue_type === 'property_review');
      const rowStyle = isSelected ? 'background: rgba(52, 211, 153, 0.1); border-left: 3px solid var(--accent);' : isResolved ? 'background: rgba(52, 211, 153, 0.05); opacity: 0.7;' : '';
      html += `<div class="table-row clickable-row" style="cursor: pointer; ${rowStyle}" data-prop-idx="${idx}">`;
      html += `<div style="flex: 0.5; color: var(--text2);">${row.clinic_id}</div>`;
      html += `<div style="flex: 2;" class="truncate">${esc(row.facility_name || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.operator_name || '')}</div>`;
      html += `<div style="flex: 0.5;">${row.state}</div>`;
      html += `<div style="flex: 0.7; text-align: right; color: var(--accent);">${fmtN(row.total_patients || 0)}</div>`;
      html += `<div style="flex: 1; color: var(--text2);">${row.review_type}</div>`;
      if (isResolved) {
        html += `<div style="flex: 0.3; text-align: right;"><span style="color:var(--green);font-size:16px" title="Resolved">✓</span></div>`;
      } else {
        html += `<div style="flex: 0.3; text-align: right;"><span style="color:var(--accent);font-size:16px" title="Open detail" onclick='event.stopPropagation();showDetail(${safeJSON(row)}, "dia-clinic")'>&rsaquo;</span></div>`;
      }
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
  
  html += '<div style="display: flex; gap: 10px;">';
  html += `<button class="btn-primary" data-save-prop="${item.clinic_id}" style="flex: 1;">Save Outcome</button>`;
  html += `<button class="pill" data-skip-prop="${item.clinic_id}" style="flex: 1; padding: 10px 20px; font-size: 13px; font-weight: 600;">Skip</button>`;
  html += '</div>';
  
  html += '</div>';
  html += '</div>';
  
  setTimeout(() => {
    const saveBtn = document.querySelector(`[data-save-prop="${item.clinic_id}"]`);
    const skipBtn = document.querySelector(`[data-skip-prop="${item.clinic_id}"]`);
    
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
    
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        diaPropertyFilter.selectedIdx = undefined;
        renderDiaTab();
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
      const isSelected = diaLeaseFilter.selectedIdx === idx;
      const isResolved = diaData.researchOutcomes.some(o => o.clinic_id === row.clinic_id && o.queue_type === 'lease_backfill');
      const rowStyle = isSelected ? 'background: rgba(52, 211, 153, 0.1); border-left: 3px solid var(--accent);' : isResolved ? 'background: rgba(52, 211, 153, 0.05); opacity: 0.7;' : '';
      
      html += `<div class="table-row clickable-row" style="cursor: pointer; ${rowStyle}" data-lease-idx="${idx}">`;
      html += `<div style="flex: 0.5; color: var(--text2);">${row.clinic_id}</div>`;
      html += `<div style="flex: 2;" class="truncate">${esc(row.facility_name || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.operator_name || '')}</div>`;
      html += `<div style="flex: 0.7; text-align: right; color: var(--accent);">${fmtN(row.total_patients || 0)}</div>`;
      html += `<div style="flex: 1; color: ${watchColor};">${row.closure_watch_level || 'none'}</div>`;
      html += `<div style="flex: 1; color: var(--text2);">${row.lease_backfill_priority || 'unknown'}</div>`;
      if (isResolved) {
        html += `<div style="flex: 0.3; text-align: right;"><span style="color:var(--green);font-size:16px" title="Resolved">✓</span></div>`;
      } else {
        html += `<div style="flex: 0.3; text-align: right;"><span style="color:var(--accent);font-size:16px" title="Open detail" onclick='event.stopPropagation();showDetail(${safeJSON(row)}, "dia-clinic")'>&rsaquo;</span></div>`;
      }
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
  
  html += '<div style="display: flex; gap: 10px;">';
  html += `<button class="btn-primary" data-save-lease="${item.clinic_id}" style="flex: 1;">Save Outcome</button>`;
  html += `<button class="pill" data-skip-lease="${item.clinic_id}" style="flex: 1; padding: 10px 20px; font-size: 13px; font-weight: 600;">Skip</button>`;
  html += '</div>';
  
  html += '</div>';
  html += '</div>';
  
  setTimeout(() => {
    const saveBtn = document.querySelector(`[data-save-lease="${item.clinic_id}"]`);
    const skipBtn = document.querySelector(`[data-skip-lease="${item.clinic_id}"]`);
    
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
    
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        diaLeaseFilter.selectedIdx = undefined;
        renderDiaTab();
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
      const errText = await response.text();
      throw new Error('Failed to save outcome: ' + errText);
    }

    showToast('Outcome saved', 'success');
    
    // Clear selection and reload data
    if (queueType === 'property_review') {
      diaPropertyFilter.selectedIdx = undefined;
    } else {
      diaLeaseFilter.selectedIdx = undefined;
    }
    
    // Reload data and re-render to advance to next record
    await loadDiaData();
    renderDiaTab();
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
      
      html += `<div class="table-row clickable-row" onclick='showDetail(${safeJSON(row)}, "dia-clinic")'>`;
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
        const batch = await diaQuery('available_listings', '*', {
          order: 'listing_date.desc.nullslast', limit: 1000, offset: pg * 1000,
          filter: 'status=in.(active,Active,Available,For Sale)',
        });
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

  // Apply state filter
  let filtered = data;
  if (diaSalesStateFilter) {
    filtered = filtered.filter(r => r.state === diaSalesStateFilter);
  }

  // Apply search filter
  if (diaSalesSearch) {
    const sq = diaSalesSearch.toLowerCase();
    filtered = filtered.filter(r =>
      (r.tenant_operator || '').toLowerCase().includes(sq) ||
      (r.address || '').toLowerCase().includes(sq) ||
      (r.city || '').toLowerCase().includes(sq) ||
      (r.state || '').toLowerCase().includes(sq) ||
      (r.seller || '').toLowerCase().includes(sq) ||
      (r.listing_broker || '').toLowerCase().includes(sq) ||
      (isComps ? (r.buyer || '').toLowerCase().includes(sq) || (r.procuring_broker || '').toLowerCase().includes(sq) : false)
    );
  }

  // Apply sort
  if (diaSalesSort.col) {
    const col = diaSalesSort.col;
    const dir = diaSalesSort.dir === 'asc' ? 1 : -1;
    const numericCols = ['land_area','year_built','rba','rent','rent_per_sf','term_remaining_yrs','price','price_per_sf','cap_rate','bid_ask_spread','dom','ask_price','ask_cap'];
    const isNumeric = numericCols.indexOf(col) >= 0;
    filtered = filtered.slice().sort(function(a, b) {
      let va = a[col], vb = b[col];
      if (va == null) return 1;
      if (vb == null) return -1;
      if (isNumeric) {
        return (parseFloat(va) - parseFloat(vb)) * dir;
      }
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  const totalPages = Math.ceil(filtered.length / DIA_SALES_PAGE_SIZE);
  const pageRows = filtered.slice(diaSalesPage * DIA_SALES_PAGE_SIZE, (diaSalesPage + 1) * DIA_SALES_PAGE_SIZE);

  let html = '<div class="biz-section">';

  // Sub-tab toggle: Sales Comps | Available
  html += '<div class="pills" style="margin-bottom: 16px;">';
  html += '<button class="pill' + (isComps ? ' active' : '') + '" data-sales-view="comps">Sales Comps (' + (diaSalesComps ? fmtN(diaSalesComps.length) : '…') + ')</button>';
  html += '<button class="pill' + (!isComps ? ' active' : '') + '" data-sales-view="available">Available (' + (diaAvailListings ? fmtN(diaAvailListings.length) : '…') + ')</button>';
  html += '</div>';

  // Metrics
  html += '<div class="dia-grid dia-grid-4" style="margin-bottom: 16px;">';
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
    // Bid-Ask Spread in basis points
    const withBidAsk = data.filter(r => r.bid_ask_spread != null && parseFloat(r.bid_ask_spread) > 0 && parseFloat(r.bid_ask_spread) < 2000);
    const avgBidAsk = withBidAsk.length > 0 ? Math.round(withBidAsk.reduce((s, r) => s + parseFloat(r.bid_ask_spread), 0) / withBidAsk.length) : null;
    html += infoCard({ title: 'Total Sales', value: fmtN(data.length), sub: 'dialysis comps', color: 'blue' });
    html += infoCard({ title: 'Avg Cap Rate', value: cap.val, sub: cap.n + ' with cap data', color: 'green' });
    html += infoCard({ title: 'Avg Sale Price', value: avgPrice, sub: withPrice.length + ' with price data', color: 'purple' });
    html += infoCard({ title: 'Avg Bid-Ask Spread', value: avgBidAsk != null ? avgBidAsk + ' bps' : '—', sub: withBidAsk.length + ' with spread data', color: 'cyan' });
  } else {
    const withPrice = data.filter(r => r.ask_price > 0);
    const cap = avgCapRate(data, 'ask_cap');
    const avgAsk = withPrice.length > 0 ? '$' + fmtN(Math.round(withPrice.reduce((s, r) => s + parseFloat(r.ask_price), 0) / withPrice.length)) : '—';
    html += infoCard({ title: 'Active Listings', value: fmtN(data.length), sub: 'on market', color: 'blue' });
    html += infoCard({ title: 'Avg Ask Cap', value: cap.val, sub: cap.n + ' with cap data', color: 'green' });
    html += infoCard({ title: 'Avg Ask Price', value: avgAsk, sub: withPrice.length + ' priced', color: 'purple' });
    const avgDom = data.filter(r => r.dom > 0);
    const avgDomVal = avgDom.length > 0 ? Math.round(avgDom.reduce((s, r) => s + r.dom, 0) / avgDom.length) : '—';
    html += infoCard({ title: 'Avg DOM', value: avgDomVal, sub: avgDom.length + ' with dates', color: 'yellow' });
  }
  html += '</div>';

  // Search bar + State filter
  const allStates = [...new Set(data.map(r => r.state).filter(Boolean))].sort();
  html += '<div style="margin: 16px 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">';
  html += '<input type="text" id="diaSalesSearchInput" placeholder="Search tenant, address, city, broker..." value="' + esc(diaSalesSearch) + '" style="flex:1; min-width: 200px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--s2); color: var(--text); font-size: 13px;" />';
  html += '<select id="diaSalesStateSelect" style="padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--s2); color: var(--text); font-size: 13px;">';
  html += '<option value="">All States</option>';
  allStates.forEach(function(st) {
    html += '<option value="' + esc(st) + '"' + (diaSalesStateFilter === st ? ' selected' : '') + '>' + esc(st) + '</option>';
  });
  html += '</select>';
  if (diaSalesSort.col) {
    html += '<button class="pill active" id="diaSalesClearSort" style="font-size:11px;padding:4px 10px;">Clear Sort</button>';
  }
  html += '<span style="font-size: 12px; color: var(--text3);">' + fmtN(filtered.length) + ' results</span>';
  html += '</div>';

  // Scrollable table
  html += '<div style="overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--border); border-radius: 10px; max-height: 70vh;">';
  html += '<table style="width: max-content; min-width: 2200px; border-collapse: collapse; font-size: 12px;">';

  // Sortable header helper
  const sortArrow = function(col) {
    if (diaSalesSort.col !== col) return ' <span style="opacity:0.3;font-size:9px">⇅</span>';
    return diaSalesSort.dir === 'asc' ? ' <span style="color:var(--accent)">▲</span>' : ' <span style="color:var(--accent)">▼</span>';
  };
  const thBase = 'padding:10px 8px;font-weight:600;font-size:11px;letter-spacing:0.3px;text-transform:uppercase;color:var(--text2);border-bottom:2px solid var(--border);white-space:nowrap;cursor:pointer;user-select:none;';
  const th = function(label, w, col) { return '<th data-sort-col="' + col + '" style="text-align:left;' + thBase + 'min-width:' + w + 'px;">' + label + sortArrow(col) + '</th>'; };
  const thr = function(label, w, col) { return '<th data-sort-col="' + col + '" style="text-align:right;' + thBase + 'min-width:' + w + 'px;">' + label + sortArrow(col) + '</th>'; };

  html += '<thead><tr style="background: var(--s2); position: sticky; top: 0; z-index: 1;">';
  if (isComps) {
    html += th('Tenant/Operator', 160, 'tenant_operator');
    html += th('Address', 140, 'address');
    html += th('City', 90, 'city');
    html += th('State', 40, 'state');
    html += thr('Land', 55, 'land_area');
    html += thr('Built', 45, 'year_built');
    html += thr('RBA', 60, 'rba');
    html += thr('Rent', 75, 'rent');
    html += thr('Rent/SF', 60, 'rent_per_sf');
    html += th('Expiration', 85, 'lease_expiration');
    html += thr('Term Rem', 65, 'term_remaining_yrs');
    html += th('Expenses', 70, 'expenses');
    html += th('Bumps', 90, 'bumps');
    html += thr('Price', 85, 'price');
    html += thr('Price/SF', 65, 'price_per_sf');
    html += thr('Cap', 55, 'cap_rate');
    html += th('Sold Date', 80, 'sold_date');
    html += th('Seller', 110, 'seller');
    html += th('Listing Broker', 100, 'listing_broker');
    html += th('Buyer', 110, 'buyer');
    html += th('Procuring Broker', 110, 'procuring_broker');
    html += thr('Bid-Ask (bps)', 70, 'bid_ask_spread');
    html += thr('DOM', 45, 'dom');
  } else {
    html += th('Tenant/Operator', 160, 'tenant_operator');
    html += th('Address', 140, 'address');
    html += th('City', 90, 'city');
    html += th('State', 40, 'state');
    html += thr('Land', 55, 'land_area');
    html += thr('Built', 45, 'year_built');
    html += thr('RBA', 60, 'rba');
    html += thr('Rent', 75, 'rent');
    html += thr('Rent/SF', 60, 'rent_per_sf');
    html += th('Expiration', 85, 'lease_expiration');
    html += thr('Term Rem', 65, 'term_remaining_yrs');
    html += th('Expenses', 70, 'expenses');
    html += th('Bumps', 90, 'bumps');
    html += thr('Ask Price', 85, 'ask_price');
    html += thr('Price/SF', 65, 'price_per_sf');
    html += thr('Ask Cap', 55, 'ask_cap');
    html += th('Seller', 110, 'seller');
    html += th('Listing Broker', 100, 'listing_broker');
    html += thr('DOM', 45, 'dom');
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
  const fmtTerm = (v) => v != null ? (parseFloat(v) < 0 ? 'Exp.' : parseFloat(v).toFixed(1) + ' yr') : '—';
  const fmtDate = (v) => v || '—';

  pageRows.forEach(r => {
    html += '<tr class="clickable-row" onclick=\'showSaleDetail(' + safeJSON(r) + ')\' style="cursor: pointer;">';
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
      html += tdr(r.bid_ask_spread != null && parseFloat(r.bid_ask_spread) > 0 ? Math.round(parseFloat(r.bid_ask_spread)) + ' bps' : '—');
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
      diaSalesSort = { col: null, dir: 'desc' };
      diaSalesStateFilter = '';
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
    searchInput.selectionStart = searchInput.selectionEnd = searchInput.value.length;
  }
  // State filter
  const stateSelect = document.getElementById('diaSalesStateSelect');
  if (stateSelect) {
    stateSelect.addEventListener('change', function() {
      diaSalesStateFilter = this.value;
      diaSalesPage = 0;
      renderDiaSales();
    });
  }
  // Clear sort button
  const clearSortBtn = document.getElementById('diaSalesClearSort');
  if (clearSortBtn) {
    clearSortBtn.addEventListener('click', function() {
      diaSalesSort = { col: null, dir: 'desc' };
      diaSalesPage = 0;
      renderDiaSales();
    });
  }
  // Column sort handlers
  document.querySelectorAll('[data-sort-col]').forEach(function(thEl) {
    thEl.addEventListener('click', function() {
      const col = this.dataset.sortCol;
      if (diaSalesSort.col === col) {
        diaSalesSort.dir = diaSalesSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        diaSalesSort = { col: col, dir: 'desc' };
      }
      diaSalesPage = 0;
      renderDiaSales();
    });
  });
}

// ============================================================================

// ============================================================================
// DIALYSIS LEASES TAB
// ============================================================================
let diaLeasesData = null;
let diaLeaseWatchlist = null;
let diaLeaseGaps = null;

function renderDiaLeases() {
  const el = document.getElementById('bizPageInner');
  if (!el) return '';

  if (!diaLeasesData) {
    el.innerHTML = '<div class="loading"><span class="spinner"></span> Loading lease data...</div>';
    (async () => {
      try {
        const [watchlist, gaps] = await Promise.all([
          diaQuery('v_clinic_lease_renewal_watchlist', '*', { limit: 1000 }),
          diaQuery('v_clinic_lease_data_gaps', 'gap_type,clinic_id,facility_name,operator_name,city,state,lease_expiration,total_patients', { limit: 2000 })
        ]);
        diaLeaseWatchlist = watchlist || [];
        diaLeaseGaps = gaps || [];
        diaLeasesData = true;
        el.innerHTML = buildDiaLeasesHTML();
      } catch (e) {
        console.error('Dia leases load error:', e);
        el.innerHTML = '<div class="widget-error"><div class="err-msg">Failed to load lease data: ' + esc(e.message || '') + '</div><button class="retry-btn" onclick="diaLeasesData=null;renderDiaLeases()">Retry</button></div>';
      }
    })();
    return '';
  }

  el.innerHTML = buildDiaLeasesHTML();
  return '';
}

function buildDiaLeasesHTML() {
  const watchlist = diaLeaseWatchlist || [];
  const gaps = diaLeaseGaps || [];
  const backfill = diaData.leaseBackfillRows || [];
  const totalClinics = (diaData.freshness || {}).total_clinics || 8513;

  // Gap type counts
  const gapCounts = {};
  gaps.forEach(function(g) { gapCounts[g.gap_type] = (gapCounts[g.gap_type] || 0) + 1; });
  const missingPropLink = gapCounts['missing_property_link'] || 0;
  const missingLeaseRow = gapCounts['missing_lease_row'] || 0;
  const staleLeases = gapCounts['lease_stale_vs_inventory'] || 0;
  const expiredActive = gapCounts['expired_lease_on_active_clinic'] || 0;
  const expiring12m = gapCounts['expiring_within_12_months'] || 0;
  const totalGaps = gaps.length;
  const linkedWithLease = totalClinics - missingPropLink - missingLeaseRow;

  // Watchlist buckets
  const expired = watchlist.filter(function(w) { return w.renewal_watchlist_type === 'expired_lease_risk'; });
  const risk12m = watchlist.filter(function(w) { return w.renewal_watchlist_type.indexOf('12m') >= 0; });
  const missingFollow = watchlist.filter(function(w) { return w.renewal_watchlist_type === 'missing_lease_followup'; });

  let html = '<div style="margin-bottom:24px">';
  html += '<div style="font-size:16px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px"><span style="font-size:20px">📋</span> Dialysis Lease Intelligence</div>';

  // Summary Stats
  html += '<div class="dia-grid dia-grid-4" style="margin-bottom:20px">';
  html += infoCard({ title: 'Total Clinics', value: fmtN(totalClinics), sub: 'Tracked nationwide', color: 'blue' });
  html += infoCard({ title: 'Lease Coverage', value: ((linkedWithLease / totalClinics) * 100).toFixed(1) + '%', sub: fmtN(linkedWithLease) + ' with lease data', color: 'cyan' });
  html += infoCard({ title: 'Data Gaps', value: fmtN(totalGaps), sub: 'Clinics need attention', color: 'yellow' });
  html += infoCard({ title: 'Watchlist', value: fmtN(watchlist.length), sub: fmtN(expired.length) + ' expired · ' + fmtN(risk12m.length) + ' within 12m', color: 'red' });
  html += '</div>';

  // Backfill Queue
  if (backfill.length > 0) {
    html += '<div class="widget" style="margin-bottom:16px">';
    html += '<div class="widget-title">Lease Data Backfill Queue <span style="font-size:12px;font-weight:400;color:var(--text3)">(' + backfill.length + ' clinics need lease data)</span></div>';
    html += '<div style="font-size:13px;color:var(--text2);margin-bottom:10px">Clinics missing lease information — research candidates for the Research tab.</div>';
    html += '<button class="retry-btn" onclick="currentDiaTab=\'research\';renderDiaTab()">Go to Research Workbench</button>';
    html += '</div>';
  }

  // Data Gap Summary
  if (totalGaps > 0) {
    html += '<div class="widget" style="margin-bottom:16px">';
    html += '<div class="widget-title">Lease Data Quality</div>';
    var gapBuckets = [
      { label: 'Missing Property Link', count: missingPropLink, color: '#ef4444' },
      { label: 'Stale vs Inventory', count: staleLeases, color: '#fb923c' },
      { label: 'Missing Lease Row', count: missingLeaseRow, color: '#f59e0b' },
      { label: 'Expired on Active', count: expiredActive, color: '#f87171' },
      { label: 'Expiring < 12mo', count: expiring12m, color: '#fbbf24' },
    ];
    var maxB = Math.max.apply(null, gapBuckets.map(function(b) { return b.count; }).concat([1]));
    html += '<div style="display:flex;flex-direction:column;gap:6px">';
    for (var gi = 0; gi < gapBuckets.length; gi++) {
      var b = gapBuckets[gi];
      if (b.count === 0) continue;
      var pctW = ((b.count / maxB) * 100).toFixed(0);
      html += '<div style="display:flex;align-items:center;gap:8px">';
      html += '<div style="width:140px;font-size:12px;color:var(--text2);text-align:right;flex-shrink:0">' + b.label + '</div>';
      html += '<div style="flex:1;background:var(--s2);border-radius:4px;height:22px;overflow:hidden">';
      html += '<div style="width:' + pctW + '%;background:' + b.color + ';height:100%;border-radius:4px;min-width:2px"></div>';
      html += '</div>';
      html += '<div style="width:50px;font-size:12px;font-weight:600;color:var(--text)">' + fmtN(b.count) + '</div>';
      html += '</div>';
    }
    html += '</div></div>';
  }

  // Lease Renewal Watchlist Table
  if (watchlist.length > 0) {
    html += '<div class="widget" style="margin-bottom:16px">';
    html += '<div class="widget-title">Lease Renewal Watchlist <span style="font-size:12px;font-weight:400;color:var(--text3)">(' + watchlist.length + ' clinics)</span></div>';
    html += '<div style="font-size:13px;color:var(--text2);margin-bottom:10px">Clinics with expiring, expired, or at-risk leases — sorted by urgency.</div>';
    html += '<div class="gov-table-card"><table class="gov-table"><thead><tr>';
    html += '<th>Facility</th><th>Operator</th><th>City</th><th>State</th><th>Risk</th><th style="text-align:right">Months Left</th><th>Expiration</th>';
    html += '</tr></thead><tbody>';
    var sorted = watchlist.slice().sort(function(a, b) { return (a.months_to_expiration || 999) - (b.months_to_expiration || 999); });
    for (var wi = 0; wi < Math.min(sorted.length, 75); wi++) {
      var c = sorted[wi];
      var mo = c.months_to_expiration;
      var moLabel = mo != null ? (mo <= 0 ? 'Expired' : mo + 'mo') : '—';
      var moColor = mo != null ? (mo <= 0 ? 'var(--red)' : mo <= 12 ? '#f87171' : mo <= 24 ? '#fb923c' : 'var(--text2)') : 'var(--text3)';
      var riskBadge = c.closure_watch_level === 'high' ? '<span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px">HIGH</span>'
        : c.closure_watch_level === 'moderate' ? '<span style="background:#f59e0b;color:#000;padding:1px 6px;border-radius:4px;font-size:11px">MOD</span>'
        : '<span style="font-size:11px;color:var(--text3)">low</span>';
      var exp = c.lease_expiration ? new Date(c.lease_expiration).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—';
      html += '<tr>';
      html += '<td>' + esc(c.facility_name || '—') + '</td>';
      html += '<td>' + esc(c.operator_name || c.parent_organization || '—') + '</td>';
      html += '<td>' + esc(c.city || '—') + '</td>';
      html += '<td>' + esc(c.state || '—') + '</td>';
      html += '<td>' + riskBadge + '</td>';
      html += '<td style="text-align:right;color:' + moColor + ';font-weight:600">' + moLabel + '</td>';
      html += '<td>' + exp + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    if (watchlist.length > 75) html += '<div style="text-align:center;font-size:12px;color:var(--text3);padding:8px">Showing 75 of ' + watchlist.length + '</div>';
    html += '</div>';
  }

  // Operator Lease Exposure
  var opMap = {};
  for (var oi = 0; oi < watchlist.length; oi++) {
    var row = watchlist[oi];
    var op = row.operator_name || row.parent_organization || 'Independent';
    if (!opMap[op]) opMap[op] = { count: 0, expired: 0, expiring12m: 0 };
    opMap[op].count++;
    if (row.months_to_expiration != null && row.months_to_expiration <= 0) opMap[op].expired++;
    if (row.months_to_expiration != null && row.months_to_expiration > 0 && row.months_to_expiration <= 12) opMap[op].expiring12m++;
  }
  var topOps = Object.entries(opMap).sort(function(a, b) { return b[1].count - a[1].count; }).slice(0, 15);
  if (topOps.length > 0) {
    html += '<div class="widget">';
    html += '<div class="widget-title">Operator Lease Exposure (Watchlist)</div>';
    html += '<div class="gov-table-card"><table class="gov-table"><thead><tr>';
    html += '<th>Operator</th><th style="text-align:right">On Watchlist</th><th style="text-align:right">Expired</th><th style="text-align:right">Expiring &lt;12mo</th>';
    html += '</tr></thead><tbody>';
    for (var ti = 0; ti < topOps.length; ti++) {
      var name = topOps[ti][0], data = topOps[ti][1];
      html += '<tr><td>' + esc(name) + '</td>';
      html += '<td style="text-align:right">' + fmtN(data.count) + '</td>';
      html += '<td style="text-align:right;color:' + (data.expired > 0 ? 'var(--red)' : 'var(--text2)') + '">' + fmtN(data.expired) + '</td>';
      html += '<td style="text-align:right;color:' + (data.expiring12m > 0 ? '#f87171' : 'var(--text2)') + '">' + fmtN(data.expiring12m) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div></div>';
  }

  html += '</div>';
  return html;
}

// ============================================================================
// DIALYSIS LOANS TAB
// ============================================================================
let diaLoansData = null;

function renderDiaLoans() {
  const el = document.getElementById('bizPageInner');
  if (!el) return '';

  if (!diaLoansData) {
    el.innerHTML = '<div class="loading"><span class="spinner"></span> Loading loan data...</div>';
    (async () => {
      try {
        const loans = await diaQuery('loans',
          'loan_id,property_id,loan_amount,current_balance,interest_rate_percent,interest_rate_text,maturity_date,origination_date,loan_to_value,loan_type,recourse,alert_flag,lender_name,loan_term',
          { limit: 1000 }
        );
        diaLoansData = loans || [];
        el.innerHTML = buildDiaLoansHTML();
      } catch (e) {
        console.error('Dia loans load error:', e);
        el.innerHTML = '<div class="widget-error"><div class="err-msg">Failed to load loan data: ' + esc(e.message || '') + '</div><button class="retry-btn" onclick="diaLoansData=null;renderDiaLoans()">Retry</button></div>';
      }
    })();
    return '';
  }

  el.innerHTML = buildDiaLoansHTML();
  return '';
}

function buildDiaLoansHTML() {
  const loans = diaLoansData || [];

  let html = '<div style="margin-bottom:24px">';
  html += '<div style="font-size:16px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px"><span style="font-size:20px">🏦</span> Dialysis Loan Intelligence</div>';

  if (loans.length === 0) {
    html += '<div class="widget" style="text-align:center;padding:40px 20px">';
    html += '<div style="font-size:48px;margin-bottom:12px;opacity:0.3">🏦</div>';
    html += '<div style="font-size:16px;font-weight:600;margin-bottom:8px;color:var(--text)">No Loan Data Available</div>';
    html += '</div></div>';
    return html;
  }

  // Stats
  var withAmt = loans.filter(function(l) { return l.loan_amount; });
  var totalVol = withAmt.reduce(function(s, l) { return s + (parseFloat(l.loan_amount) || 0); }, 0);
  var withRate = loans.filter(function(l) { return parseFloat(l.interest_rate_percent) > 0; });
  var avgRate = withRate.length > 0 ? (withRate.reduce(function(s, l) { return s + parseFloat(l.interest_rate_percent); }, 0) / withRate.length) : 0;
  var withMaturity = loans.filter(function(l) { return l.maturity_date; });
  var now = new Date();
  var oneYr = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  var maturingUnder1 = withMaturity.filter(function(l) { return new Date(l.maturity_date) <= oneYr; }).length;
  var flagged = loans.filter(function(l) { return l.alert_flag; }).length;

  html += '<div class="dia-grid dia-grid-4" style="margin-bottom:20px">';
  html += infoCard({ title: 'Total Loans', value: fmtN(loans.length), sub: fmtN(withAmt.length) + ' with amounts', color: 'blue' });
  html += infoCard({ title: 'Total Volume', value: fmt(totalVol), sub: 'Across ' + fmtN(withAmt.length) + ' loans', color: 'green' });
  html += infoCard({ title: 'Avg Rate', value: avgRate > 0 ? avgRate.toFixed(2) + '%' : 'N/A', sub: withRate.length + ' loans with rates', color: 'cyan' });
  html += infoCard({ title: 'Flagged', value: fmtN(flagged), sub: flagged > 0 ? 'Need attention' : 'No alerts', color: flagged > 0 ? 'red' : 'green' });
  html += '</div>';

  // Loan size distribution
  var buckets = [
    { label: '$0–$1M', min: 0, max: 1e6, count: 0, vol: 0 },
    { label: '$1M–$5M', min: 1e6, max: 5e6, count: 0, vol: 0 },
    { label: '$5M–$10M', min: 5e6, max: 10e6, count: 0, vol: 0 },
    { label: '$10M–$25M', min: 10e6, max: 25e6, count: 0, vol: 0 },
    { label: '$25M+', min: 25e6, max: Infinity, count: 0, vol: 0 }
  ];
  withAmt.forEach(function(l) {
    var amt = parseFloat(l.loan_amount) || 0;
    for (var i = 0; i < buckets.length; i++) {
      if (amt >= buckets[i].min && amt < buckets[i].max) {
        buckets[i].count++;
        buckets[i].vol += amt;
        break;
      }
    }
  });
  var maxBkt = Math.max.apply(null, buckets.map(function(b) { return b.count; }).concat([1]));

  html += '<div class="widget" style="margin-bottom:16px">';
  html += '<div class="widget-title">Loan Size Distribution</div>';
  html += '<div style="display:flex;flex-direction:column;gap:6px">';
  for (var bi = 0; bi < buckets.length; bi++) {
    var bk = buckets[bi];
    if (bk.count === 0) continue;
    var pctW = ((bk.count / maxBkt) * 100).toFixed(0);
    html += '<div style="display:flex;align-items:center;gap:8px">';
    html += '<div style="width:100px;font-size:12px;color:var(--text2);text-align:right;flex-shrink:0">' + bk.label + '</div>';
    html += '<div style="flex:1;background:var(--s2);border-radius:4px;height:22px;overflow:hidden">';
    html += '<div style="width:' + pctW + '%;background:#6c8cff;height:100%;border-radius:4px;min-width:2px"></div>';
    html += '</div>';
    html += '<div style="width:40px;font-size:12px;font-weight:600;color:var(--text)">' + fmtN(bk.count) + '</div>';
    html += '<div style="width:70px;font-size:11px;color:var(--text3)">' + fmt(bk.vol) + '</div>';
    html += '</div>';
  }
  html += '</div></div>';

  // Loan table — top loans by amount
  var sorted = withAmt.slice().sort(function(a, b) { return (parseFloat(b.loan_amount) || 0) - (parseFloat(a.loan_amount) || 0); });
  html += '<div class="widget" style="margin-bottom:16px">';
  html += '<div class="widget-title">Largest Loans <span style="font-size:12px;font-weight:400;color:var(--text3)">(' + fmtN(sorted.length) + ' loans with amounts)</span></div>';
  html += '<div class="gov-table-card"><table class="gov-table"><thead><tr>';
  html += '<th>Property ID</th><th style="text-align:right">Loan Amount</th><th style="text-align:right">Rate</th><th>Type</th><th>Recourse</th><th>Alert</th>';
  html += '</tr></thead><tbody>';
  for (var li = 0; li < Math.min(sorted.length, 50); li++) {
    var ln = sorted[li];
    var rate = parseFloat(ln.interest_rate_percent) > 0 ? parseFloat(ln.interest_rate_percent).toFixed(2) + '%' : (ln.interest_rate_text || '—');
    var alertBadge = ln.alert_flag ? '<span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px">FLAG</span>' : '<span style="font-size:11px;color:var(--text3)">—</span>';
    html += '<tr>';
    html += '<td>' + esc(String(ln.property_id || '—')) + '</td>';
    html += '<td style="text-align:right;font-weight:600">' + fmt(parseFloat(ln.loan_amount) || 0) + '</td>';
    html += '<td style="text-align:right">' + rate + '</td>';
    html += '<td>' + esc(ln.loan_type || '—') + '</td>';
    html += '<td>' + esc(ln.recourse || '—') + '</td>';
    html += '<td>' + alertBadge + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  if (sorted.length > 50) html += '<div style="text-align:center;font-size:12px;color:var(--text3);padding:8px">Showing 50 of ' + fmtN(sorted.length) + '</div>';
  html += '</div>';

  html += '</div>';
  return html;
}
// DIALYSIS PLAYERS (Top Operators, Largest Clinics)
// ============================================================================

let diaPlayersView = 'operators';
let diaBuyers = null;        // lazy-loaded from sales_transactions
let diaSellers = null;       // lazy-loaded from sales_transactions
let diaBrokers = null;       // lazy-loaded from sale_brokers/brokers/sales_transactions (joined client-side)
let diaPlayersLoading = false;

function renderDiaPlayers() {
  let html = '<div class="biz-section">';

  // View toggle
  html += '<div class="pills" style="margin-bottom: 20px;">';
  ['operators', 'largest', 'movers', 'buyers', 'sellers', 'brokers'].forEach(view => {
    const active = diaPlayersView === view ? ' active' : '';
    const label = view === 'operators' ? 'Top Operators' : view === 'largest' ? 'Largest Clinics' : view === 'movers' ? 'Biggest Movers' : view === 'buyers' ? 'Top Buyers' : view === 'sellers' ? 'Top Sellers' : 'Brokers';
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
      html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(p.records[0]) + ', "dia-clinic")\'>';
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
      html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic")\'>';
      html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(r.facility_name || '—') + '</div>';
      html += '<div style="flex: 1;">' + esc((r.city || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</div>';
      html += '<div style="flex: 1;" class="truncate">' + esc(r.operator_name || '—') + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + fmtN(r.latest_total_patients || 0) + '</div>';
      html += '<div style="flex: 1; color: var(--text2);">' + esc(r.ccn || '—') + '</div>';
      html += '</div>';
    });
    html += '</div></div>';

  } else if (diaPlayersView === 'movers') {
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
      html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic")\'>';
      html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(r.facility_name || '—') + '</div>';
      html += '<div style="flex: 1;">' + esc((r.city || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</div>';
      html += '<div style="flex: 1;" class="truncate">' + esc(r.operator_name || '—') + '</div>';
      html += '<div style="flex: 1; text-align: right; color: ' + deltaColor + ';">' + ((r.delta_patients || 0) > 0 ? '+' : '') + fmtN(r.delta_patients || 0) + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + pct(r.pct_change || 0) + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + fmtN(r.latest_total_patients || 0) + '</div>';
      html += '</div>';
    });
    html += '</div></div>';
  } else if (diaPlayersView === 'buyers') {
    // Show loading spinner and load data on first view
    if (diaBuyers === null && !diaPlayersLoading) {
      html += '<div style="color: var(--text2); text-align: center; padding: 40px;">Loading buyer data...</div>';
      diaPlayersLoading = true;
      (async () => {
        try {
          const buyersRaw = await diaQuery('sales_transactions', 'buyer_name,buyer_type,sold_price,sale_date,cap_rate,property_id', { limit: 5000 });
          // Group by buyer_name
          const buyerMap = {};
          buyersRaw.forEach(r => {
            if (r.buyer_name) {
              const key = r.buyer_name.trim().toUpperCase();
              if (!buyerMap[key]) buyerMap[key] = { name: r.buyer_name, type: r.buyer_type, deals: 0, volume: 0, prices: [], capRates: [], records: [] };
              buyerMap[key].deals++;
              buyerMap[key].volume += (r.sold_price || 0);
              if (r.cap_rate) buyerMap[key].capRates.push(r.cap_rate);
              buyerMap[key].records.push(r);
            }
          });
          diaBuyers = Object.values(buyerMap).sort((a, b) => b.volume - a.volume);
          diaPlayersLoading = false;
          renderDiaTab();
        } catch (err) {
          console.error('Error loading buyer data:', err);
          diaPlayersLoading = false;
        }
      })();
    } else if (diaBuyers) {
      const top50 = diaBuyers.slice(0, 50);
      const totalVolume = top50.reduce((s, b) => s + b.volume, 0);
      const totalDeals = top50.reduce((s, b) => s + b.deals, 0);

      html += '<div class="dia-grid dia-grid-4" style="gap: 12px; margin-bottom: 20px;">';
      html += infoCard({ title: 'Total Buyers', value: fmtN(diaBuyers.length), sub: 'in dataset', color: 'blue' });
      html += infoCard({ title: 'Top Buyer', value: top50[0] ? (top50[0].name.substring(0, 30) || '—') : '—', sub: top50[0] ? fmt(top50[0].volume) + ' volume' : '', color: 'green' });
      html += infoCard({ title: 'Avg Deal Size', value: fmt(Math.round(totalVolume / Math.max(1, totalDeals))), sub: 'across top 50', color: 'cyan' });
      html += infoCard({ title: 'Total Deals', value: fmtN(totalDeals), sub: 'transactions (top 50)', color: 'purple' });
      html += '</div>';

      html += '<div class="table-wrapper"><div class="data-table">';
      html += '<div class="table-row" style="font-weight: 600; border-bottom: 2px solid var(--border);">';
      html += '<div style="flex: 2;">Buyer Name</div>';
      html += '<div style="flex: 1;">Type</div>';
      html += '<div style="flex: 1; text-align: right;">Deals</div>';
      html += '<div style="flex: 1; text-align: right;">Total Volume</div>';
      html += '<div style="flex: 1; text-align: right;">Avg Cap Rate</div>';
      html += '</div>';

      top50.forEach((b, idx) => {
        const avgCapRate = b.capRates.length > 0 ? b.capRates.reduce((s, cr) => s + cr, 0) / b.capRates.length : 0;
        html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(b.records[0]) + ', "sales-transaction")\'>';
        html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(b.name) + '</div>';
        html += '<div style="flex: 1;">' + esc(b.type || '—') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + b.deals + '</div>';
        html += '<div style="flex: 1; text-align: right;">' + fmt(b.volume, 'currency') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + pct(avgCapRate / 100) + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    }

  } else if (diaPlayersView === 'sellers') {
    // Show loading spinner and load data on first view
    if (diaSellers === null && !diaPlayersLoading) {
      html += '<div style="color: var(--text2); text-align: center; padding: 40px;">Loading seller data...</div>';
      diaPlayersLoading = true;
      (async () => {
        try {
          const sellersRaw = await diaQuery('sales_transactions', 'seller_name,seller_type,sold_price,sale_date,cap_rate,property_id', { limit: 5000 });
          // Group by seller_name
          const sellerMap = {};
          sellersRaw.forEach(r => {
            if (r.seller_name) {
              const key = r.seller_name.trim().toUpperCase();
              if (!sellerMap[key]) sellerMap[key] = { name: r.seller_name, type: r.seller_type, deals: 0, volume: 0, prices: [], capRates: [], records: [] };
              sellerMap[key].deals++;
              sellerMap[key].volume += (r.sold_price || 0);
              if (r.cap_rate) sellerMap[key].capRates.push(r.cap_rate);
              sellerMap[key].records.push(r);
            }
          });
          diaSellers = Object.values(sellerMap).sort((a, b) => b.volume - a.volume);
          diaPlayersLoading = false;
          renderDiaTab();
        } catch (err) {
          console.error('Error loading seller data:', err);
          diaPlayersLoading = false;
        }
      })();
    } else if (diaSellers) {
      const top50 = diaSellers.slice(0, 50);
      const totalVolume = top50.reduce((s, s2) => s + s2.volume, 0);
      const totalDeals = top50.reduce((s, s2) => s + s2.deals, 0);

      html += '<div class="dia-grid dia-grid-4" style="gap: 12px; margin-bottom: 20px;">';
      html += infoCard({ title: 'Total Sellers', value: fmtN(diaSellers.length), sub: 'in dataset', color: 'red' });
      html += infoCard({ title: 'Top Seller', value: top50[0] ? (top50[0].name.substring(0, 30) || '—') : '—', sub: top50[0] ? fmt(top50[0].volume) + ' volume' : '', color: 'green' });
      html += infoCard({ title: 'Avg Deal Size', value: fmt(Math.round(totalVolume / Math.max(1, totalDeals))), sub: 'across top 50', color: 'cyan' });
      html += infoCard({ title: 'Total Deals', value: fmtN(totalDeals), sub: 'transactions (top 50)', color: 'purple' });
      html += '</div>';

      html += '<div class="table-wrapper"><div class="data-table">';
      html += '<div class="table-row" style="font-weight: 600; border-bottom: 2px solid var(--border);">';
      html += '<div style="flex: 2;">Seller Name</div>';
      html += '<div style="flex: 1;">Type</div>';
      html += '<div style="flex: 1; text-align: right;">Deals</div>';
      html += '<div style="flex: 1; text-align: right;">Total Volume</div>';
      html += '<div style="flex: 1; text-align: right;">Avg Cap Rate</div>';
      html += '</div>';

      top50.forEach((s2, idx) => {
        const avgCapRate = s2.capRates.length > 0 ? s2.capRates.reduce((s, cr) => s + cr, 0) / s2.capRates.length : 0;
        html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(s2.records[0]) + ', "sales-transaction")\'>';
        html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(s2.name) + '</div>';
        html += '<div style="flex: 1;">' + esc(s2.type || '—') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + s2.deals + '</div>';
        html += '<div style="flex: 1; text-align: right;">' + fmt(s2.volume, 'currency') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + pct(avgCapRate / 100) + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    }

  } else if (diaPlayersView === 'brokers') {
    // Show loading spinner and load data on first view
    if (diaBrokers === null && !diaPlayersLoading) {
      html += '<div style="color: var(--text2); text-align: center; padding: 40px;">Loading broker data...</div>';
      diaPlayersLoading = true;
      (async () => {
        try {
          // Query three tables and join client-side
          const saleBrokers = await diaQuery('sale_brokers', '*', { limit: 5000 });
          const brokers = await diaQuery('brokers', 'broker_id,broker_name,company,email,phone', { limit: 5000 });
          const sales = await diaQuery('sales_transactions', 'sale_id,sold_price,sale_date,cap_rate,buyer_name,seller_name', { limit: 5000 });
          
          // Create lookup maps
          const brokerMap = {};
          brokers.forEach(b => { brokerMap[b.broker_id] = b; });
          const saleMap = {};
          sales.forEach(s => { saleMap[s.sale_id] = s; });
          
          // Join: for each sale_broker, add broker and sale info
          const brokerStats = {};
          saleBrokers.forEach(sb => {
            const broker = brokerMap[sb.broker_id];
            const sale = saleMap[sb.sale_id];
            if (broker && sale) {
              const key = broker.broker_id;
              if (!brokerStats[key]) {
                brokerStats[key] = {
                  broker_id: broker.broker_id,
                  broker_name: broker.broker_name,
                  company: broker.company,
                  email: broker.email,
                  phone: broker.phone,
                  deals: 0,
                  volume: 0,
                  capRates: [],
                  roles: new Set(),
                  records: []
                };
              }
              brokerStats[key].deals++;
              brokerStats[key].volume += (sale.sold_price || 0);
              if (sale.cap_rate) brokerStats[key].capRates.push(sale.cap_rate);
              brokerStats[key].roles.add(sb.role);
              brokerStats[key].records.push({ ...sb, broker: broker, sale: sale });
            }
          });
          
          // Convert to array and sort by volume
          diaBrokers = Object.values(brokerStats)
            .map(b => ({ ...b, roles: Array.from(b.roles) }))
            .sort((a, b) => b.volume - a.volume);
          diaPlayersLoading = false;
          renderDiaTab();
        } catch (err) {
          console.error('Error loading broker data:', err);
          diaPlayersLoading = false;
        }
      })();
    } else if (diaBrokers) {
      const top50 = diaBrokers.slice(0, 50);
      const totalVolume = top50.reduce((s, b) => s + b.volume, 0);
      const totalDeals = top50.reduce((s, b) => s + b.deals, 0);

      html += '<div class="dia-grid dia-grid-4" style="gap: 12px; margin-bottom: 20px;">';
      html += infoCard({ title: 'Total Brokers', value: fmtN(diaBrokers.length), sub: 'in dataset', color: 'orange' });
      html += infoCard({ title: 'Top Broker', value: top50[0] ? (top50[0].broker_name.substring(0, 30) || '—') : '—', sub: top50[0] ? fmt(top50[0].volume) + ' volume' : '', color: 'green' });
      html += infoCard({ title: 'Avg Deal Size', value: fmt(Math.round(totalVolume / Math.max(1, totalDeals))), sub: 'across top 50', color: 'cyan' });
      html += infoCard({ title: 'Total Deals', value: fmtN(totalDeals), sub: 'transactions (top 50)', color: 'purple' });
      html += '</div>';

      html += '<div class="table-wrapper"><div class="data-table">';
      html += '<div class="table-row" style="font-weight: 600; border-bottom: 2px solid var(--border);">';
      html += '<div style="flex: 2;">Broker Name</div>';
      html += '<div style="flex: 1;">Company</div>';
      html += '<div style="flex: 1; text-align: right;">Deals</div>';
      html += '<div style="flex: 1; text-align: right;">Total Volume</div>';
      html += '<div style="flex: 1; text-align: right;">Avg Cap Rate</div>';
      html += '</div>';

      top50.forEach((b, idx) => {
        const avgCapRate = b.capRates.length > 0 ? b.capRates.reduce((s, cr) => s + cr, 0) / b.capRates.length : 0;
        html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(b.records[0]) + ', "sale-broker")\'>';
        html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(b.broker_name) + '</div>';
        html += '<div style="flex: 1;" class="truncate">' + esc(b.company || '—') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + b.deals + '</div>';
        html += '<div style="flex: 1; text-align: right;">' + fmt(b.volume, 'currency') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + pct(avgCapRate / 100) + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    }
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
          html += '<div class="search-card" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic")\'>';
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
          html += '<div class="search-card" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic")\'>';
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
          html += '<div class="search-card" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic")\'>';
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
          html += '<div class="search-card" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic")\'>';
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
// ============================================================================
// SALES COMP DETAIL/EDIT PANEL
// ============================================================================

async function diaPatchRecord(table, idCol, idVal, data) {
  const url = new URL('/api/dia-query', window.location.origin);
  url.searchParams.set('table', table);
  url.searchParams.set('filter', `${idCol}=eq.${idVal}`);

  try {
    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`PATCH error: ${response.status}`, errText);
      showToast('Error saving data', 'error');
      return false;
    }

    return true;
  } catch (err) {
    console.error('diaPatchRecord error:', err);
    showToast('Error saving', 'error');
    return false;
  }
}

async function showSaleDetail(record) {
  if (!record || !record.sale_id) {
    showToast('Unable to open sale detail', 'error');
    return;
  }

  // Store in window for detail panel
  window._saleRecord = record;
  window._saleCurrentTab = 'deal';

  const overlay = q('#detailOverlay');
  const panel = q('#detailPanel');
  const header = q('#detailHeader');
  const tabsContainer = q('#detailTabs');
  const body = q('#detailBody');

  if (!panel || !header || !tabsContainer || !body) return;

  // Show panel
  if (overlay) overlay.style.display = 'flex';
  panel.style.display = 'flex';

  // Render header
  const title = esc(record.tenant_operator || 'Sale Comp');
  const subtitle = esc(`${record.address || ''}, ${record.city || ''}, ${record.state || ''}`);
  const salePrice = record.price ? '$' + Number(record.price).toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'N/A';

  header.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 16px; border-bottom: 1px solid var(--border);">
      <div>
        <h2 style="margin: 0; color: var(--text); font-size: 18px; font-weight: 600;">${title}</h2>
        <p style="margin: 4px 0 0 0; color: var(--text2); font-size: 13px;">${subtitle}</p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <span style="color: var(--accent); font-weight: 600; font-size: 14px;">${salePrice}</span>
        <button onclick="closeSaleDetail()" style="background: none; border: none; color: var(--text2); font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">&times;</button>
      </div>
    </div>
  `;

  // Render tabs
  const tabs = ['Deal', 'Property', 'Ownership', 'Research'];
  let tabsHtml = '<div style="display: flex; border-bottom: 1px solid var(--border); gap: 0;">';
  tabs.forEach(tab => {
    const isActive = window._saleCurrentTab === tab.toLowerCase();
    const style = isActive
      ? 'color: var(--accent); border-bottom: 2px solid var(--accent); background: rgba(var(--accent-rgb), 0.1);'
      : 'color: var(--text2); border-bottom: 2px solid transparent;';
    tabsHtml += `<button onclick="switchSaleTab('${tab.toLowerCase()}')" style="flex: 1; padding: 12px; background: none; border: none; cursor: pointer; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.3px; ${style}">${tab}</button>`;
  });
  tabsHtml += '</div>';
  tabsContainer.innerHTML = tabsHtml;

  // Render body based on current tab
  renderSaleDetailBody(record);
}

function switchSaleTab(tab) {
  window._saleCurrentTab = tab;
  const record = window._saleRecord;
  if (record) renderSaleDetailBody(record);

  // Update active tab style
  document.querySelectorAll('#detailTabs button').forEach(btn => {
    const btnTab = btn.textContent.trim().toLowerCase();
    if (btnTab === tab) {
      btn.style.color = 'var(--accent)';
      btn.style.borderBottomColor = 'var(--accent)';
      btn.style.background = 'rgba(var(--accent-rgb), 0.1)';
    } else {
      btn.style.color = 'var(--text2)';
      btn.style.borderBottomColor = 'transparent';
      btn.style.background = 'none';
    }
  });
}

async function renderSaleDetailBody(record) {
  const body = q('#detailBody');
  if (!body) return;

  let html = '';

  if (window._saleCurrentTab === 'deal') {
    html = renderSaleDealTab(record);
  } else if (window._saleCurrentTab === 'property') {
    html = renderSalePropertyTab(record);
  } else if (window._saleCurrentTab === 'ownership') {
    html = await renderSaleOwnershipTab(record);
  } else if (window._saleCurrentTab === 'research') {
    html = renderSaleResearchTab(record);
  }

  body.innerHTML = html;
}

function renderSaleDealTab(record) {
  const lblStyle = 'display:block;color:var(--text2);font-size:12px;margin-bottom:6px;font-weight:600;';
  const inpStyle = 'width:100%;padding:8px;background:var(--s2);color:var(--text);border:1px solid var(--border);border-radius:4px;box-sizing:border-box;font-family:inherit;font-size:13px;';
  const gridStyle = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;';

  let html = '<div style="padding: 16px; overflow-y: auto; max-height: calc(100% - 100px);">';

  // Transaction Details section
  html += '<div style="margin-bottom: 24px;">';
  html += '<h3 style="color: var(--text); font-size: 14px; font-weight: 600; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.3px; color: var(--accent);">Transaction Details</h3>';
  
  html += '<div style="' + gridStyle + '">';
  html += '<div>';
  html += '<label style="' + lblStyle + '">Buyer Name</label>';
  html += '<input type="text" id="dia-buyer-name" value="' + esc(record.buyer_name || '') + '" placeholder="Buyer name" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Buyer Type</label>';
  html += '<select id="dia-buyer-type" style="' + inpStyle + '">';
  html += '<option value=""' + (record.buyer_type ? '' : ' selected') + '>Select type</option>';
  const buyerTypes = ['Individual', 'Private Equity', 'REIT', 'Strategic Buyer', 'Other'];
  buyerTypes.forEach(t => {
    html += '<option value="' + esc(t) + '"' + (record.buyer_type === t ? ' selected' : '') + '>' + esc(t) + '</option>';
  });
  html += '</select>';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Seller Name</label>';
  html += '<input type="text" id="dia-seller-name" value="' + esc(record.seller_name || '') + '" placeholder="Seller name" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Sold Price</label>';
  html += '<input type="number" id="dia-sold-price" value="' + (record.sold_price || '') + '" placeholder="0" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Cap Rate (%)</label>';
  html += '<input type="number" id="dia-cap-rate" value="' + ((record.cap_rate && record.cap_rate < 1) ? (record.cap_rate * 100).toFixed(2) : (record.cap_rate || '')) + '" placeholder="0.00" step="0.01" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Sale Date</label>';
  html += '<input type="date" id="dia-sale-date" value="' + (record.sale_date || '') + '" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Cap Rate Method</label>';
  html += '<select id="dia-cap-rate-method" style="' + inpStyle + '">';
  html += '<option value=""' + (record.cap_rate_method ? '' : ' selected') + '>Select method</option>';
  const methods = ['NOI / Purchase Price', 'Operating Expense Analysis', 'Market Comparable', 'Other'];
  methods.forEach(m => {
    html += '<option value="' + esc(m) + '"' + (record.cap_rate_method === m ? ' selected' : '') + '>' + esc(m) + '</option>';
  });
  html += '</select>';
  html += '</div>';
  
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Cap Rate Notes</label>';
  html += '<textarea id="dia-cap-rate-notes" placeholder="Notes about cap rate calculation..." style="' + inpStyle + 'min-height:80px;resize:vertical;">' + esc(record.cap_rate_notes || '') + '</textarea>';
  html += '</div>';
  
  html += '<div style="margin-top: 12px;">';
  html += '<label style="' + lblStyle + '">Transaction Notes</label>';
  html += '<textarea id="dia-notes" placeholder="Additional notes..." style="' + inpStyle + 'min-height:80px;resize:vertical;">' + esc(record.notes || '') + '</textarea>';
  html += '</div>';
  
  html += '</div>';

  // Broker Info section
  html += '<div style="margin-bottom: 24px;">';
  html += '<h3 style="color: var(--text); font-size: 14px; font-weight: 600; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.3px; color: var(--accent);">Broker Info (Read-Only)</h3>';
  
  html += '<div style="' + gridStyle + '">';
  html += '<div>';
  html += '<label style="' + lblStyle + '">Listing Broker</label>';
  html += '<div style="padding:8px;background:var(--s3);color:var(--text3);border:1px solid var(--border);border-radius:4px;font-size:13px;">' + esc(record.listing_broker || '—') + '</div>';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Procuring Broker</label>';
  html += '<div style="padding:8px;background:var(--s3);color:var(--text3);border:1px solid var(--border);border-radius:4px;font-size:13px;">' + esc(record.procuring_broker || '—') + '</div>';
  html += '</div>';
  
  html += '</div>';
  html += '</div>';

  // Computed section
  html += '<div style="margin-bottom: 24px;">';
  html += '<h3 style="color: var(--text); font-size: 14px; font-weight: 600; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.3px; color: var(--accent);">Computed Values (Read-Only)</h3>';
  
  const pricePerSF = record.rba && record.price ? (record.price / record.rba).toFixed(2) : 'N/A';
  const bidAskSpread = record.bid_ask_spread ? Math.round(record.bid_ask_spread) + ' bps' : 'N/A';
  const dom = record.dom ? record.dom + ' days' : 'N/A';
  
  html += '<div style="' + gridStyle + '">';
  html += '<div>';
  html += '<label style="' + lblStyle + '">Price Per SF</label>';
  html += '<div style="padding:8px;background:var(--s3);color:var(--text3);border:1px solid var(--border);border-radius:4px;font-size:13px;">' + esc(pricePerSF) + '</div>';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Bid-Ask Spread</label>';
  html += '<div style="padding:8px;background:var(--s3);color:var(--text3);border:1px solid var(--border);border-radius:4px;font-size:13px;">' + esc(bidAskSpread) + '</div>';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Days on Market</label>';
  html += '<div style="padding:8px;background:var(--s3);color:var(--text3);border:1px solid var(--border);border-radius:4px;font-size:13px;">' + esc(dom) + '</div>';
  html += '</div>';
  
  html += '</div>';
  html += '</div>';

  // Save button
  html += '<div style="position: sticky; bottom: 0; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--s1);">';
  html += '<button onclick="saveSaleTransaction()" style="width: 100%; padding: 10px; background: var(--accent); color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">Save Transaction</button>';
  html += '</div>';

  html += '</div>';
  return html;
}

function renderSalePropertyTab(record) {
  const lblStyle = 'display:block;color:var(--text2);font-size:12px;margin-bottom:6px;font-weight:600;';
  const inpStyle = 'width:100%;padding:8px;background:var(--s2);color:var(--text);border:1px solid var(--border);border-radius:4px;box-sizing:border-box;font-family:inherit;font-size:13px;';
  const gridStyle = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;';

  let html = '<div style="padding: 16px; overflow-y: auto; max-height: calc(100% - 100px);">';
  html += '<h3 style="color: var(--text); font-size: 14px; font-weight: 600; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.3px; color: var(--accent);">Property Information</h3>';
  
  html += '<div style="' + gridStyle + '">';
  html += '<div>';
  html += '<label style="' + lblStyle + '">Address</label>';
  html += '<input type="text" id="dia-prop-address" value="' + esc(record.address || '') + '" placeholder="Address" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">City</label>';
  html += '<input type="text" id="dia-prop-city" value="' + esc(record.city || '') + '" placeholder="City" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">State</label>';
  html += '<input type="text" id="dia-prop-state" value="' + esc(record.state || '') + '" placeholder="State" maxlength="2" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Tenant/Operator</label>';
  html += '<input type="text" id="dia-prop-tenant" value="' + esc(record.tenant_operator || '') + '" placeholder="Tenant/Operator" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Building Size (RBA, SF)</label>';
  html += '<input type="number" id="dia-prop-rba" value="' + (record.rba || '') + '" placeholder="0" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Land Area (acres)</label>';
  html += '<input type="number" id="dia-prop-land" value="' + (record.land_area || '') + '" placeholder="0" step="0.01" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '<div>';
  html += '<label style="' + lblStyle + '">Year Built</label>';
  html += '<input type="number" id="dia-prop-year" value="' + (record.year_built || '') + '" placeholder="YYYY" min="1800" max="2100" style="' + inpStyle + '" />';
  html += '</div>';
  
  html += '</div>';

  html += '</div>';

  // Save button
  html += '<div style="position: sticky; bottom: 0; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--s1);">';
  html += '<button onclick="saveSaleProperty()" style="width: 100%; padding: 10px; background: var(--accent); color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">Save Property</button>';
  html += '</div>';

  return html;
}

async function renderSaleOwnershipTab(record) {
  const lblStyle = 'display:block;color:var(--text2);font-size:12px;margin-bottom:6px;font-weight:600;';
  const inpStyle = 'width:100%;padding:8px;background:var(--s2);color:var(--text);border:1px solid var(--border);border-radius:4px;box-sizing:border-box;font-family:inherit;font-size:13px;';

  let html = '<div style="padding: 16px; overflow-y: auto; max-height: calc(100% - 60px);">';
  html += '<h3 style="color: var(--text); font-size: 14px; font-weight: 600; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.3px; color: var(--accent);">Ownership History</h3>';

  try {
    const owners = await diaQuery('ownership_history', '*', {
      filter: `property_id=eq.${record.property_id}`,
      order: 'start_date.desc',
      limit: 50
    });

    if (!owners || owners.length === 0) {
      html += '<p style="color: var(--text3); font-size: 13px;">No ownership history records found.</p>';
    } else {
      owners.forEach((owner, idx) => {
        html += '<div style="margin-bottom: 16px; padding: 12px; background: var(--s2); border: 1px solid var(--border); border-radius: 6px;">';
        html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">';
        
        html += '<div>';
        html += '<label style="' + lblStyle + '">Owner Type</label>';
        html += '<select id="dia-owner-type-' + idx + '" style="' + inpStyle + '">';
        const ownerTypes = ['Operator', 'Owner', 'Investor', 'Other'];
        ownerTypes.forEach(t => {
          html += '<option value="' + esc(t) + '"' + (owner.owner_type === t ? ' selected' : '') + '>' + esc(t) + '</option>';
        });
        html += '</select>';
        html += '</div>';
        
        html += '<div>';
        html += '<label style="' + lblStyle + '">Ownership Source</label>';
        html += '<input type="text" id="dia-owner-source-' + idx + '" value="' + esc(owner.ownership_source || '') + '" placeholder="Source" style="' + inpStyle + '" />';
        html += '</div>';
        
        html += '</div>';
        
        html += '<div>';
        html += '<label style="' + lblStyle + '">Notes</label>';
        html += '<textarea id="dia-owner-notes-' + idx + '" placeholder="Notes..." style="' + inpStyle + 'min-height:60px;resize:vertical;">' + esc(owner.notes || '') + '</textarea>';
        html += '</div>';
        
        html += '<button onclick="saveSaleOwner(' + owner.ownership_id + ', ' + idx + ')" style="width: 100%; padding: 8px; margin-top: 8px; background: var(--accent); color: white; border: none; border-radius: 4px; font-weight: 600; font-size: 12px; cursor: pointer;">Save Owner Record</button>';
        html += '</div>';
      });
    }
  } catch (e) {
    console.error('Error loading ownership history:', e);
    html += '<p style="color: var(--error); font-size: 13px;">Error loading ownership history.</p>';
  }

  html += '</div>';
  return html;
}

function renderSaleResearchTab(record) {
  const lblStyle = 'display:block;color:var(--text2);font-size:12px;margin-bottom:6px;font-weight:600;';
  const inpStyle = 'width:100%;padding:8px;background:var(--s2);color:var(--text);border:1px solid var(--border);border-radius:4px;box-sizing:border-box;font-family:inherit;font-size:13px;';

  let html = '<div style="padding: 16px; overflow-y: auto; max-height: calc(100% - 100px);">';
  html += '<h3 style="color: var(--text); font-size: 14px; font-weight: 600; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.3px; color: var(--accent);">Research Resolution</h3>';

  html += '<div style="margin-bottom: 16px;">';
  html += '<label style="' + lblStyle + '">Status</label>';
  html += '<select id="dia-research-status" style="' + inpStyle + '">';
  const statuses = ['pending_review', 'verified', 'needs_correction', 'flagged', 'resolved'];
  statuses.forEach(s => {
    html += '<option value="' + esc(s) + '">' + esc(s.replace(/_/g, ' ')) + '</option>';
  });
  html += '</select>';
  html += '</div>';

  html += '<div>';
  html += '<label style="' + lblStyle + '">Research Notes</label>';
  html += '<textarea id="dia-research-notes" placeholder="Notes about this sale comp..." style="' + inpStyle + 'min-height:120px;resize:vertical;"></textarea>';
  html += '</div>';

  html += '</div>';

  // Save button
  html += '<div style="position: sticky; bottom: 0; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--s1);">';
  html += '<button onclick="saveSaleResearch()" style="width: 100%; padding: 10px; background: var(--accent); color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">Resolve Research</button>';
  html += '</div>';

  return html;
}

async function saveSaleTransaction() {
  const record = window._saleRecord;
  if (!record || !record.sale_id) return;

  const buyer = q('#dia-buyer-name').value.trim();
  const buyerType = q('#dia-buyer-type').value.trim();
  const seller = q('#dia-seller-name').value.trim();
  const price = parseFloat(q('#dia-sold-price').value) || null;
  const capRateVal = parseFloat(q('#dia-cap-rate').value);
  const capRate = capRateVal ? capRateVal / 100 : null;
  const saleDate = q('#dia-sale-date').value || null;
  const capMethod = q('#dia-cap-rate-method').value.trim();
  const capNotes = q('#dia-cap-rate-notes').value.trim();
  const notes = q('#dia-notes').value.trim();

  const data = {
    buyer_name: buyer || null,
    buyer_type: buyerType || null,
    seller_name: seller || null,
    sold_price: price,
    cap_rate: capRate,
    sale_date: saleDate,
    cap_rate_method: capMethod || null,
    cap_rate_notes: capNotes || null,
    notes: notes || null
  };

  const success = await diaPatchRecord('sales_transactions', 'sale_id', record.sale_id, data);
  if (success) {
    showToast('Transaction saved successfully', 'success');
    // Update in-memory record
    Object.assign(record, data);
    // Update in array
    if (window.diaSalesComps) {
      const idx = window.diaSalesComps.findIndex(r => r.sale_id === record.sale_id);
      if (idx >= 0) {
        Object.assign(window.diaSalesComps[idx], data);
      }
    }
  }
}

async function saveSaleProperty() {
  const record = window._saleRecord;
  if (!record || !record.property_id) return;

  const address = q('#dia-prop-address').value.trim();
  const city = q('#dia-prop-city').value.trim();
  const state = q('#dia-prop-state').value.trim();
  const tenant = q('#dia-prop-tenant').value.trim();
  const rba = parseFloat(q('#dia-prop-rba').value) || null;
  const land = parseFloat(q('#dia-prop-land').value) || null;
  const year = parseInt(q('#dia-prop-year').value) || null;

  const data = {
    address: address || null,
    city: city || null,
    state: state || null,
    tenant: tenant || null,
    building_size: rba,
    land_area: land,
    year_built: year
  };

  const success = await diaPatchRecord('properties', 'property_id', record.property_id, data);
  if (success) {
    showToast('Property saved successfully', 'success');
    Object.assign(record, data);
    if (window.diaSalesComps) {
      const idx = window.diaSalesComps.findIndex(r => r.property_id === record.property_id);
      if (idx >= 0) {
        Object.assign(window.diaSalesComps[idx], data);
      }
    }
  }
}

async function saveSaleOwner(ownershipId, idx) {
  const ownerType = q('#dia-owner-type-' + idx).value.trim();
  const ownerSource = q('#dia-owner-source-' + idx).value.trim();
  const notes = q('#dia-owner-notes-' + idx).value.trim();

  const data = {
    owner_type: ownerType || null,
    ownership_source: ownerSource || null,
    notes: notes || null
  };

  const success = await diaPatchRecord('ownership_history', 'ownership_id', ownershipId, data);
  if (success) {
    showToast('Owner record saved successfully', 'success');
  }
}

async function saveSaleResearch() {
  const record = window._saleRecord;
  if (!record || !record.sale_id) return;

  const status = q('#dia-research-status').value.trim();
  const notes = q('#dia-research-notes').value.trim();

  if (!status) {
    showToast('Please select a status', 'error');
    return;
  }

  // Create or update research_queue_outcomes record
  const url = new URL('/api/dia-query', window.location.origin);
  url.searchParams.set('table', 'research_queue_outcomes');

  try {
    const data = {
      queue_type: 'sales_comp',
      sale_id: record.sale_id,
      status: status,
      notes: notes || null,
      resolved_at: new Date().toISOString()
    };

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Research save error: ${response.status}`, errText);
      showToast('Error saving research', 'error');
      return;
    }

    showToast('Research resolution saved', 'success');
  } catch (err) {
    console.error('saveSaleResearch error:', err);
    showToast('Error saving research', 'error');
  }
}

function closeSaleDetail() {
  window._saleRecord = null;
  window._saleCurrentTab = null;
  const overlay = q('#detailOverlay');
  const panel = q('#detailPanel');
  if (overlay) overlay.style.display = 'none';
  if (panel) panel.style.display = 'none';
  q('#detailTabs').innerHTML = '';
  q('#detailBody').innerHTML = '';
}

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
window.renderDiaLeases = renderDiaLeases;
window.renderDiaLoans = renderDiaLoans;
window.goToDiaTab = goToDiaTab;
window.infoCard = infoCard;
window.showSaleDetail = showSaleDetail;
window.switchSaleTab = switchSaleTab;
window.saveSaleTransaction = saveSaleTransaction;
window.saveSaleProperty = saveSaleProperty;
window.saveSaleOwner = saveSaleOwner;
window.saveSaleResearch = saveSaleResearch;
window.closeSaleDetail = closeSaleDetail;
