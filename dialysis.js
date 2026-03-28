// ============================================================================
// DIALYSIS DASHBOARD MODULE
// Vanilla JavaScript implementation of Dialysis dashboard
// Loaded after index.html, overrides placeholder functions
// ============================================================================

// ============================================================================
// MODULE STATE
// ============================================================================

let diaCharts = {};
let diaResearchMode = 'property'; // 'property' | 'lease' | 'clinic_leads'
let diaResearchIdx = 0;
let diaPropertyFilter = { review_type: null, state: null, selectedIdx: undefined };
let diaLeaseFilter = { priority: null, selectedIdx: undefined };
let diaClinicLeadFilter = { category: null, tier: null, state: null, selectedIdx: undefined, hideResolved: true };
let diaClinicLeadQueue = null; // lazy-loaded from v_clinic_research_priority
let diaClinicLeadLoading = false;
let diaChangeFilter = 'all'; // 'all' | 'added' | 'removed' | 'persistent'
let diaCmsData = null;  // lazy-loaded from v_cms_data
let diaCmsLoading = false;
let diaCmsSearch = '';
let diaCmsPage = 0;
let diaCmsSort = { col: 'est_in_center_patients', dir: 'desc' };
let diaCmsStateFilter = '';
let diaCmsOperatorFilter = '';
let diaCmsModalityFilter = '';
const DIA_CMS_PAGE_SIZE = 50;
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

// Paginated fetch — loops with offset to get ALL rows past PostgREST 1000-row cap
async function diaQueryAll(table, select, params = {}) {
  let all = [], offset = 0;
  const pageSize = 1000;
  while (true) {
    const rows = await diaQuery(table, select, { ...params, limit: pageSize, offset });
    all = all.concat(rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
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
    
    // ── BATCH 1: Core data (all independent, run in parallel) ──────────────
    const [freshness, invSummary, invChanges, moversUpRaw, moversDownRaw] = await Promise.all([
      diaQuery('v_counts_freshness', '*').catch(e => { console.warn('Freshness view timeout', e); return []; }),
      diaQuery('v_clinic_inventory_diff_summary', '*').catch(e => { console.warn('Inv summary timeout', e); return []; }),
      diaQuery('v_clinic_inventory_latest_diff', '*', { limit: 500 }).catch(e => { console.warn('Inv changes timeout', e); return []; }),
      diaQuery('v_facility_patient_counts_mom', '*', { filter: 'delta_patients=gt.0', order: 'delta_patients.desc', limit: 10 }).catch(() => []),
      diaQuery('v_facility_patient_counts_mom', '*', { filter: 'delta_patients=lt.0', order: 'delta_patients.asc', limit: 10 }).catch(() => [])
    ]);
    if (freshness && freshness.length > 0) diaData.freshness = freshness[0];
    if (invSummary && invSummary.length > 0) {
      invSummary.forEach(row => { diaData.inventorySummary[row.change_type] = row; });
    }
    diaData.inventoryChanges = invChanges || [];

    // Enrich movers with facility names
    try {
      const allMovers = [...(moversUpRaw || []), ...(moversDownRaw || [])];
      const moverIds = [...new Set(allMovers.map(r => r.clinic_id).filter(Boolean))];
      const nameMap = {};
      if (moverIds.length > 0) {
        try {
          const nameRows = await diaQuery('medicare_clinics', 'medicare_id,facility_name', {
            filter: 'medicare_id=in.(' + moverIds.join(',') + ')', limit: 30
          });
          (nameRows || []).forEach(r => { if (r.medicare_id) nameMap[r.medicare_id] = r.facility_name; });
        } catch (e) { console.warn('name lookup failed', e); }
      }
      (diaData.inventoryChanges || []).forEach(r => {
        if (r.clinic_id && r.facility_name && !nameMap[r.clinic_id]) nameMap[r.clinic_id] = r.facility_name;
      });
      const enrich = (arr) => (arr || []).map(r => ({ ...r, facility_name: nameMap[r.clinic_id] || ('Clinic ' + r.clinic_id) }));
      diaData.moversUp = enrich(moversUpRaw);
      diaData.moversDown = enrich(moversDownRaw);
    } catch (e) {
      console.warn('Failed to enrich movers data', e);
      diaData.moversUp = [];
      diaData.moversDown = [];
    }

    // ── BATCH 2: NPI + research tab data (all independent, run in parallel) ──
    const [npiSignalSummary, npiSignals, propQueue, leaseQueue, outcomes, recon] = await Promise.all([
      diaQuery('v_npi_inventory_signal_summary', '*').catch(() => []),
      diaQuery('v_npi_inventory_signals', '*', { limit: 5000 }).catch(() => []),
      diaQuery('v_clinic_property_link_review_queue', '*', { limit: 200 }).catch(() => []),
      diaQuery('v_clinic_lease_backfill_candidates', '*', { limit: 200 }).catch(() => []),
      diaQuery('research_queue_outcomes', '*', { limit: 500 }).catch(() => []),
      diaQuery('v_ingestion_reconciliation', '*', { limit: 1 }).catch(() => [])
    ]);
    if (npiSignalSummary && npiSignalSummary.length > 0) {
      npiSignalSummary.forEach(row => { diaData.npiSummary[row.signal_type] = row; });
    }
    diaData.npiSignals = npiSignals || [];
    diaData.propertyReviewQueue = propQueue || [];
    diaData.leaseBackfillRows = leaseQueue || [];
    diaData.researchOutcomes = outcomes || [];
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
    case 'prospects':
      // Render dialysis-domain prospects from domain-classified opportunities
      if (typeof renderDomainProspects === 'function' && window._mktOpportunities) {
        renderDomainProspects('dialysis');
      } else {
        inner.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text2)">Loading prospects... (Marketing data not yet loaded)</div>';
        // Trigger marketing load if not done
        if (typeof loadMarketing === 'function') loadMarketing().then(() => renderDomainProspects('dialysis'));
      }
      return;
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
  if (typeof window.syncDomainTabGroup === 'function') {
    window.syncDomainTabGroup('dialysis', tabName);
  } else {
    document.querySelectorAll('#diaInnerTabs .gov-inner-tab').forEach(t => t.classList.remove('active'));
    const btn = document.querySelector('[data-dia-tab="' + tabName + '"]');
    if (btn) btn.classList.add('active');
  }
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
          if (pg > 20) break; // safety cap
        }
        diaSalesComps = all;
      } catch(e) { diaSalesComps = []; console.warn('Sales comps load failed:', e.message); }
      diaSalesLoading = false;
      // Re-render sales sections once loaded (check for DOM elements)
      var salesEl = document.getElementById('diaOverviewSales');
      if (salesEl) salesEl.innerHTML = renderSalesMetricsInner();
      var nmEl = document.getElementById('diaOverviewNM');
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
        const batch = await diaQuery('clinic_financial_estimates', 'medicare_id,estimate_source,estimated_annual_revenue,estimated_annual_profit,estimated_ebitda,estimated_operating_profit,patient_count,chairs_used,confidence_score', {
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
    if (diaSalesLoading) {
      return '<div class="dia-grid dia-grid-5"><div class="dia-info-card" style="grid-column:span 5;text-align:center;padding:24px"><span class="spinner"></span><div style="margin-top:8px;font-size:12px;color:var(--text2)">Loading sales data...</div></div></div>';
    }
    return '<div class="dia-grid dia-grid-5"><div class="dia-info-card" style="grid-column:span 5;text-align:center;padding:24px;color:var(--text2);font-size:13px">No sales data available</div></div>';
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
    if (diaSalesLoading) {
      return '<div class="dia-grid dia-grid-4"><div class="dia-info-card" style="grid-column:span 4;text-align:center;padding:24px"><span class="spinner"></span><div style="margin-top:8px;font-size:12px;color:var(--text2)">Loading...</div></div></div>';
    }
    return '<div class="dia-grid dia-grid-4"><div class="dia-info-card" style="grid-column:span 4;text-align:center;padding:24px;color:var(--text2);font-size:13px">No Northmarq data available</div></div>';
  }
  const comps = diaSalesComps;
  const now = new Date();
  const ttmStart = new Date(now); ttmStart.setFullYear(ttmStart.getFullYear() - 1);
  const ttmComps = comps.filter(r => r.sold_date && new Date(r.sold_date) >= ttmStart);
  const isNM = r => {
    var brokers = ((r.listing_broker||'')+(r.procuring_broker||'')+(r.broker_name||'')+(r.seller_broker||'')+(r.buyer_broker||'')).toLowerCase();
    return brokers.includes('northmarq') || brokers.includes('north marq') || brokers.includes('nm capital');
  };
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
  // Check multiple possible field names for price, cap rate, and days on market
  const getPrice = r => parseFloat(r.ask_price || r.asking_price || r.listing_price || r.price || 0);
  const getCap = r => parseFloat(r.ask_cap || r.asking_cap_rate || r.cap_rate || 0);
  const getDom = r => parseInt(r.dom || r.days_on_market || 0);
  const withPrice = listings.filter(r => getPrice(r) > 0);
  const validCaps = listings.filter(r => { const v = getCap(r); return v > 0.01 && v < 0.25; }).map(r => getCap(r)).sort((a,b) => a-b);
  const avgAskCap = validCaps.length > 0 ? (validCaps.reduce((s,v)=>s+v,0)/validCaps.length*100).toFixed(2) + '%' : '—';
  const q1Idx = Math.floor(validCaps.length * 0.25);
  const q3Idx = Math.floor(validCaps.length * 0.75);
  const lowerQ = validCaps.length > 4 ? (validCaps[q1Idx]*100).toFixed(2)+'%' : '—';
  const upperQ = validCaps.length > 4 ? (validCaps[q3Idx]*100).toFixed(2)+'%' : '—';
  const avgDom = listings.filter(r => getDom(r) > 0);
  const avgDomVal = avgDom.length > 0 ? Math.round(avgDom.reduce((s,r)=>s+getDom(r),0)/avgDom.length) : '—';
  const isNMListing = r => {
    var b = ((r.listing_broker||'')+(r.broker_name||'')).toLowerCase();
    return b.includes('northmarq') || b.includes('north marq') || b.includes('nm capital');
  };
  const nmListings = listings.filter(isNMListing);

  let h = '<div class="dia-grid dia-grid-5">';
  h += infoCard({ title: 'Active Listings', value: fmtN(listings.length), sub: 'clinics on market', color: 'blue', tab: 'sales' });
  h += infoCard({ title: 'Avg Ask Cap', value: avgAskCap, sub: fmtN(validCaps.length) + ' with cap data', color: 'cyan', tab: 'sales' });
  h += infoCard({ title: 'Lower Quartile', value: lowerQ, sub: '25th pctl ask cap', color: 'purple', tab: 'sales' });
  h += infoCard({ title: 'Upper Quartile', value: upperQ, sub: '75th pctl ask cap', color: 'yellow', tab: 'sales' });
  h += infoCard({ title: 'NM On Market', value: fmtN(nmListings.length), sub: 'Northmarq listings', color: 'green', tab: 'sales' });
  h += '</div>';

  // Additional row
  h += '<div class="dia-grid dia-grid-3" style="margin-top:10px">';
  const avgAskPrice = withPrice.length > 0 ? '$' + fmtN(Math.round(withPrice.reduce((s,r)=>s+getPrice(r),0)/withPrice.length)) : '—';
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
  // estimated_ebitda is NULL in clinic_financial_estimates; v_cms_data maps
  // estimated_operating_profit → estimated_ebitda, so use that as fallback
  const ebitdaVal = e => parseFloat(e.estimated_ebitda || e.estimated_operating_profit || 0);
  const withEbitda = best.filter(e => ebitdaVal(e) > 0);

  const totalRev = withRev.reduce((s, e) => s + parseFloat(e.estimated_annual_revenue), 0);
  const avgRev = withRev.length > 0 ? totalRev / withRev.length : 0;
  const totalProfit = withProfit.reduce((s, e) => s + parseFloat(e.estimated_annual_profit), 0);
  const avgProfit = withProfit.length > 0 ? totalProfit / withProfit.length : 0;
  const avgEbitda = withEbitda.length > 0 ? withEbitda.reduce((s, e) => s + ebitdaVal(e), 0) / withEbitda.length : 0;
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
 * Render CMS Data tab (formerly Inventory) — comprehensive clinic table with financials,
 * dynamic averages, sort, and filter
 */
function renderDiaChanges() {
  // Lazy-load CMS data from the comprehensive view
  if (diaCmsData === null && !diaCmsLoading) {
    diaCmsLoading = true;
    (async () => {
      try {
        let all = [], offset = 0;
        while (true) {
          const batch = await diaQuery('v_cms_data', '*', {
            order: 'latest_total_patients.desc.nullslast',
            limit: 1000, offset
          });
          all = all.concat(batch || []);
          if (!batch || batch.length < 1000) break;
          offset += 1000;
        }
        diaCmsData = all;
      } catch (e) {
        console.error('CMS data load error:', e);
        diaCmsData = [];
      }
      diaCmsLoading = false;
      renderDiaTab();
    })();
    return '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading CMS data...</p></div>';
  }
  if (diaCmsLoading) {
    return '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading CMS data...</p></div>';
  }

  const data = diaCmsData || [];

  // === Apply filters ===
  let filtered = data;
  if (diaCmsModalityFilter) filtered = filtered.filter(r => r.modality_type === diaCmsModalityFilter);
  if (diaCmsStateFilter) filtered = filtered.filter(r => r.state === diaCmsStateFilter);
  if (diaCmsOperatorFilter) filtered = filtered.filter(r => (r.operator_name || r.chain_organization || '') === diaCmsOperatorFilter);
  if (diaCmsSearch) {
    const sq = diaCmsSearch.toLowerCase();
    filtered = filtered.filter(r =>
      (r.facility_name || '').toLowerCase().includes(sq) ||
      (r.operator_name || '').toLowerCase().includes(sq) ||
      (r.city || '').toLowerCase().includes(sq) ||
      (r.address || '').toLowerCase().includes(sq) ||
      (r.chain_organization || '').toLowerCase().includes(sq) ||
      (r.recorded_owner_name || '').toLowerCase().includes(sq) ||
      (r.clinic_id || '').includes(sq)
    );
  }

  // === Apply sort ===
  if (diaCmsSort.col) {
    const dir = diaCmsSort.dir === 'asc' ? 1 : -1;
    const col = diaCmsSort.col;
    filtered = [...filtered].sort((a, b) => {
      let va = a[col], vb = b[col];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
  }

  // === Compute dynamic averages for filtered set ===
  const n = filtered.length;
  const sum = (arr, fn) => arr.reduce((s, r) => { const v = fn(r); return v != null && !isNaN(v) ? s + Number(v) : s; }, 0);
  const cnt = (arr, fn) => arr.reduce((s, r) => { const v = fn(r); return v != null && !isNaN(v) ? s + 1 : s; }, 0);
  const avg = (arr, fn) => { const c = cnt(arr, fn); return c > 0 ? sum(arr, fn) / c : null; };

  const avgICPts = avg(filtered, r => r.est_in_center_patients);
  const avgHomePts = avg(filtered, r => r.est_home_patients);
  const avgRevenue = avg(filtered, r => r.estimated_annual_revenue);
  const avgEbitda = avg(filtered, r => r.estimated_ebitda);
  const totalEstRevenue = sum(filtered, r => r.est_combined_revenue);
  const cntHome = filtered.filter(r => r.modality_type === 'home').length;
  const cntHybrid = filtered.filter(r => r.modality_type === 'hybrid').length;
  const cntIC = filtered.filter(r => r.modality_type === 'in_center').length;

  let html = '<div class="biz-section">';

  // === Dynamic average cards ===
  html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px">';
  html += _cmsAvgCard('Clinics', fmtN(n) + '<div style="font-size:9px;color:var(--text3);margin-top:2px">' + cntIC + ' IC · ' + cntHybrid + ' Hyb · ' + cntHome + ' Home</div>', '#60a5fa');
  html += _cmsAvgCard('Avg In-Center Pts', avgICPts != null ? Math.round(avgICPts).toLocaleString() : '–', '#34d399');
  html += _cmsAvgCard('Avg Home Pts', avgHomePts != null ? Math.round(avgHomePts).toLocaleString() : '–', '#a78bfa');
  html += _cmsAvgCard('Avg Revenue', avgRevenue != null ? '$' + (avgRevenue / 1000000).toFixed(1) + 'M' : '–', '#fb923c');
  html += _cmsAvgCard('Avg EBITDA', avgEbitda != null ? '$' + Math.round(avgEbitda / 1000).toLocaleString() + 'K' : '–', '#f87171');
  html += _cmsAvgCard('Est Total Rev', totalEstRevenue > 0 ? '$' + (totalEstRevenue / 1000000000).toFixed(2) + 'B' : '–', '#22d3ee');
  html += '</div>';

  // === Filters row ===
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">';
  // Search
  html += `<input type="text" id="cmsSearch" placeholder="Search clinics..." value="${esc(diaCmsSearch)}" style="flex:1;min-width:180px;font-size:12px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)">`;
  // State dropdown
  const states = [...new Set(data.map(r => r.state).filter(Boolean))].sort();
  html += `<select id="cmsStateFilter" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)">`;
  html += `<option value="">All States</option>`;
  states.forEach(s => html += `<option value="${s}" ${diaCmsStateFilter === s ? 'selected' : ''}>${s}</option>`);
  html += '</select>';
  // Operator dropdown (top 20)
  const opCounts = {};
  data.forEach(r => { const op = r.operator_name || r.chain_organization; if (op) opCounts[op] = (opCounts[op] || 0) + 1; });
  const topOps = Object.entries(opCounts).sort((a, b) => b[1] - a[1]).slice(0, 30);
  html += `<select id="cmsOperatorFilter" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);max-width:200px">`;
  html += `<option value="">All Operators</option>`;
  topOps.forEach(([op, ct]) => html += `<option value="${esc(op)}" ${diaCmsOperatorFilter === op ? 'selected' : ''}>${esc(op)} (${ct})</option>`);
  html += '</select>';
  // Modality filter
  html += `<select id="cmsModalityFilter" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)">`;
  html += `<option value="">All Types</option>`;
  html += `<option value="in_center" ${diaCmsModalityFilter === 'in_center' ? 'selected' : ''}>In-Center</option>`;
  html += `<option value="hybrid" ${diaCmsModalityFilter === 'hybrid' ? 'selected' : ''}>Hybrid</option>`;
  html += `<option value="home" ${diaCmsModalityFilter === 'home' ? 'selected' : ''}>Home Only</option>`;
  html += '</select>';
  html += `<span style="font-size:11px;color:var(--text3)">${fmtN(filtered.length)} of ${fmtN(data.length)}</span>`;
  html += '</div>';

  // === Table ===
  const page = filtered.slice(diaCmsPage * DIA_CMS_PAGE_SIZE, (diaCmsPage + 1) * DIA_CMS_PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / DIA_CMS_PAGE_SIZE);

  html += '<div class="table-wrapper" style="overflow-x:auto">';
  html += '<div class="data-table" style="min-width:900px">';

  // Header (sortable)
  const cols = [
    { key: 'operator_name', label: 'Operator', flex: '1.1' },
    { key: 'facility_name', label: 'Facility', flex: '1.3' },
    { key: 'city', label: 'City', flex: '0.7' },
    { key: 'state', label: 'ST', flex: '0.3' },
    { key: 'modality_type', label: 'Type', flex: '0.5' },
    { key: 'est_in_center_patients', label: 'IC Pts', flex: '0.5', align: 'right' },
    { key: 'est_home_patients', label: 'Home Pts', flex: '0.5', align: 'right' },
    { key: 'est_in_center_revenue', label: 'IC Rev', flex: '0.6', align: 'right' },
    { key: 'est_home_revenue', label: 'Home Rev', flex: '0.6', align: 'right' },
    { key: 'estimated_annual_revenue', label: 'TTM Rev', flex: '0.6', align: 'right' },
    { key: 'estimated_ebitda', label: 'EBITDA', flex: '0.6', align: 'right' }
  ];

  html += '<div class="table-row" style="font-weight:600;border-bottom:2px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">';
  cols.forEach(c => {
    const isActive = diaCmsSort.col === c.key;
    const arrow = isActive ? (diaCmsSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    const style = `flex:${c.flex};${c.align ? 'text-align:' + c.align + ';' : ''}cursor:pointer;user-select:none;${isActive ? 'color:var(--accent);' : ''}`;
    html += `<div data-cms-sort="${c.key}" style="${style}">${c.label}${arrow}</div>`;
  });
  html += '</div>';

  // Rows
  page.forEach(row => {
    const modBadge = row.modality_type === 'hybrid' ? '<span style="color:#fbbf24;font-weight:600">Hybrid</span>'
      : row.modality_type === 'home' ? '<span style="color:#a78bfa;font-weight:600">Home</span>'
      : '<span style="color:#34d399;font-weight:600">IC</span>';
    const icPts = Number(row.est_in_center_patients) || 0;
    const hmPts = Number(row.est_home_patients) || 0;
    const icRev = Number(row.est_in_center_revenue) || 0;
    const hmRev = Number(row.est_home_revenue) || 0;
    const fmtRev = v => v > 0 ? '$' + (v / 1000000).toFixed(1) + 'M' : '–';

    html += `<div class="table-row clickable-row" onclick='showDetail(${safeJSON(row)}, "dia-clinic")' style="font-size:12px">`;
    html += `<div style="flex:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${esc(row.operator_name || row.chain_organization || '–')}</div>`;
    html += `<div style="flex:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">${esc(row.facility_name || '')}</div>`;
    html += `<div style="flex:0.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${esc(row.city || '')}</div>`;
    html += `<div style="flex:0.3;color:var(--text2)">${esc(row.state || '')}</div>`;
    html += `<div style="flex:0.5;font-size:11px">${modBadge}</div>`;
    html += `<div style="flex:0.5;text-align:right;font-weight:500;color:#34d399">${icPts > 0 ? fmtN(icPts) : '–'}</div>`;
    html += `<div style="flex:0.5;text-align:right;font-weight:500;color:#a78bfa">${hmPts > 0 ? fmtN(hmPts) : '–'}</div>`;
    html += `<div style="flex:0.6;text-align:right;color:var(--text2)">${fmtRev(icRev)}</div>`;
    html += `<div style="flex:0.6;text-align:right;color:var(--text2)">${fmtRev(hmRev)}</div>`;
    html += `<div style="flex:0.6;text-align:right;color:var(--text2)">${row.estimated_annual_revenue ? '$' + (Number(row.estimated_annual_revenue) / 1000000).toFixed(1) + 'M' : '–'}</div>`;
    html += `<div style="flex:0.6;text-align:right;color:var(--text2)">${row.estimated_ebitda ? '$' + Math.round(Number(row.estimated_ebitda) / 1000).toLocaleString() + 'K' : '–'}</div>`;
    html += '</div>';
  });

  if (page.length === 0) {
    html += '<div class="table-empty" style="padding:24px;text-align:center;color:var(--text3)">No clinics match filters</div>';
  }

  html += '</div>'; // data-table
  html += '</div>'; // table-wrapper

  // Pagination
  if (totalPages > 1) {
    html += '<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:12px;font-size:12px">';
    html += `<button id="cmsPrev" style="padding:4px 12px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text2);cursor:pointer" ${diaCmsPage === 0 ? 'disabled' : ''}>← Prev</button>`;
    html += `<span style="color:var(--text3)">Page ${diaCmsPage + 1} of ${totalPages}</span>`;
    html += `<button id="cmsNext" style="padding:4px 12px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text2);cursor:pointer" ${diaCmsPage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>`;
    html += '</div>';
  }

  html += '</div>'; // biz-section

  // === Attach handlers ===
  setTimeout(() => {
    // Sort headers
    document.querySelectorAll('[data-cms-sort]').forEach(el => {
      el.addEventListener('click', () => {
        const col = el.dataset.cmsSort;
        if (diaCmsSort.col === col) {
          diaCmsSort.dir = diaCmsSort.dir === 'desc' ? 'asc' : 'desc';
        } else {
          diaCmsSort.col = col;
          diaCmsSort.dir = 'desc';
        }
        diaCmsPage = 0;
        renderDiaTab();
      });
    });
    // Search
    const searchEl = document.getElementById('cmsSearch');
    if (searchEl) {
      let debounce;
      searchEl.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          diaCmsSearch = searchEl.value;
          diaCmsPage = 0;
          renderDiaTab();
        }, 300);
      });
    }
    // State filter
    const stateEl = document.getElementById('cmsStateFilter');
    if (stateEl) {
      stateEl.addEventListener('change', () => {
        diaCmsStateFilter = stateEl.value;
        diaCmsPage = 0;
        renderDiaTab();
      });
    }
    // Operator filter
    const opEl = document.getElementById('cmsOperatorFilter');
    if (opEl) {
      opEl.addEventListener('change', () => {
        diaCmsOperatorFilter = opEl.value;
        diaCmsPage = 0;
        renderDiaTab();
      });
    }
    // Modality filter
    const modEl = document.getElementById('cmsModalityFilter');
    if (modEl) {
      modEl.addEventListener('change', () => {
        diaCmsModalityFilter = modEl.value;
        diaCmsPage = 0;
        renderDiaTab();
      });
    }
    // Pagination
    const prevBtn = document.getElementById('cmsPrev');
    const nextBtn = document.getElementById('cmsNext');
    if (prevBtn) prevBtn.addEventListener('click', () => { diaCmsPage--; renderDiaTab(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { diaCmsPage++; renderDiaTab(); });
  }, 0);

  return html;
}

function _cmsAvgCard(title, value, color) {
  return `<div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;text-align:center">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:2px">${title}</div>
    <div style="font-size:18px;font-weight:800;color:${color}">${value}</div>
  </div>`;
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

  // Use pre-aggregated summary (not truncated by PostgREST row limit)
  if (diaData.npiSummary && Object.keys(diaData.npiSummary).length > 0) {
    Object.entries(diaData.npiSummary).forEach(([type, row]) => {
      const cnt = row.signal_count || 0;
      signalTypes[type] = cnt;
      totalSignals += cnt;
    });
  } else {
    diaData.npiSignals.forEach(row => {
      totalSignals++;
      const type = row.signal_type || 'unknown';
      signalTypes[type] = (signalTypes[type] || 0) + 1;
    });
  }
  
  html += metricHTML('Total Signals', fmtN(totalSignals), 'NPI intelligence signals', '');
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
    
    filtered.slice(0, 500).forEach(row => {
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
  html += renderLiveIngestWorkbench('dialysis');
  
  // Mode tabs
  html += '<div style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 10px; flex-wrap: wrap;">';
  html += `<button class="btn-link${diaResearchMode === 'property' ? '-green' : ''}" data-mode="property" style="cursor: pointer; font-weight: ${diaResearchMode === 'property' ? '600' : '500'};">Property Review</button>`;
  html += `<button class="btn-link${diaResearchMode === 'lease' ? '-green' : ''}" data-mode="lease" style="cursor: pointer; font-weight: ${diaResearchMode === 'lease' ? '600' : '500'};">Lease Backfill</button>`;
  html += `<button class="btn-link${diaResearchMode === 'clinic_leads' ? '-green' : ''}" data-mode="clinic_leads" style="cursor: pointer; font-weight: ${diaResearchMode === 'clinic_leads' ? '600' : '500'};">Clinic Leads</button>`;
  html += '</div>';

  if (diaResearchMode === 'property') {
    html += renderDiaPropertyResearch();
  } else if (diaResearchMode === 'lease') {
    html += renderDiaLeaseResearch();
  } else if (diaResearchMode === 'clinic_leads') {
    html += renderDiaClinicLeads();
  }
  
  html += '</div>';
  
  // Attach mode handlers
  setTimeout(() => {
    bindLiveIngestWorkbench('dialysis');
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
        const idx = parseInt(e.currentTarget.dataset.propIdx);
        const filtered = diaData.propertyReviewQueue.filter(r => !diaPropertyFilter.review_type || r.review_type === diaPropertyFilter.review_type);
        const item = filtered[idx];
        if (item) showDetail(item, 'dia-clinic');
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
        const outcome = q('#propOutcome')?.value;
        const propId = q('#propPropertyId')?.value;
        const notes = q('#propNotes')?.value;
        
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
        const idx = parseInt(e.currentTarget.dataset.leaseIdx);
        const filtered = diaData.leaseBackfillRows.filter(r => !diaLeaseFilter.priority || r.lease_backfill_priority === diaLeaseFilter.priority);
        const item = filtered[idx];
        if (item) showDetail(item, 'dia-clinic');
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
        const outcome = q('#leaseOutcome')?.value;
        const propId = q('#leasePropertyId')?.value;
        const notes = q('#leaseNotes')?.value;
        
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

// ============================================================================
// CLINIC LEADS RESEARCH QUEUE
// ============================================================================

/**
 * Render clinic leads research queue — prioritized by composite seller-signal score
 */
function renderDiaClinicLeads() {
  // Lazy-load the priority queue
  if (diaClinicLeadQueue === null && !diaClinicLeadLoading) {
    diaClinicLeadLoading = true;
    (async () => {
      try {
        let all = [], offset = 0;
        while (true) {
          const batch = await diaQuery('v_clinic_research_priority', '*', {
            order: 'priority_score.desc.nullslast',
            limit: 1000, offset
          });
          all = all.concat(batch || []);
          if (!batch || batch.length < 1000) break;
          offset += 1000;
        }
        diaClinicLeadQueue = all;
      } catch (e) {
        console.error('Clinic leads queue load error:', e);
        diaClinicLeadQueue = null; // keep null so next visit retries
      }
      diaClinicLeadLoading = false;
      renderDiaTab();
    })();
    return '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading clinic leads queue...</p></div>';
  }
  if (diaClinicLeadLoading) {
    return '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading clinic leads queue...</p></div>';
  }

  const queue = diaClinicLeadQueue || [];
  const resolvedIds = new Set(
    (diaData.researchOutcomes || [])
      .filter(o => o.queue_type === 'clinic_lead')
      .map(o => o.clinic_id)
  );

  // Category & tier counts
  const cats = { unlinked: 0, ownership_gap: 0, seller_signal: 0 };
  const tiers = { high: 0, medium: 0, low: 0 };
  queue.forEach(r => { cats[r.research_category] = (cats[r.research_category] || 0) + 1; tiers[r.priority_tier] = (tiers[r.priority_tier] || 0) + 1; });

  let html = '';

  // === Summary metrics ===
  html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;">';
  html += _clCard('Total Clinics', fmtN(queue.length), 'blue');
  html += _clCard('High Priority', fmtN(tiers.high), 'red');
  html += _clCard('Ownership Gap', fmtN(cats.ownership_gap), 'orange');
  html += _clCard('Seller Signals', fmtN(cats.seller_signal), 'purple');
  html += '</div>';

  // === Filters ===
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">';
  // Category filters
  html += '<div style="display:flex;gap:4px;align-items:center;margin-right:12px;">';
  html += '<span style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Category:</span>';
  const catOpts = [
    { key: null, label: 'All' },
    { key: 'ownership_gap', label: `Ownership Gap (${fmtN(cats.ownership_gap)})` },
    { key: 'seller_signal', label: `Seller Signal (${fmtN(cats.seller_signal)})` },
    { key: 'unlinked', label: `Unlinked (${cats.unlinked})` }
  ];
  catOpts.forEach(o => {
    const active = diaClinicLeadFilter.category === o.key;
    html += `<button class="cl-filter-btn" data-cl-cat="${o.key}" style="font-size:11px;padding:4px 10px;border-radius:12px;border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};background:${active ? 'var(--accent)' : 'var(--s2)'};color:${active ? '#fff' : 'var(--text2)'};cursor:pointer">${o.label}</button>`;
  });
  html += '</div>';
  // Tier filters
  html += '<div style="display:flex;gap:4px;align-items:center;">';
  html += '<span style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Priority:</span>';
  const tierOpts = [
    { key: null, label: 'All' },
    { key: 'high', label: 'High', color: '#f87171' },
    { key: 'medium', label: 'Medium', color: '#fbbf24' },
    { key: 'low', label: 'Low', color: '#94a3b8' }
  ];
  tierOpts.forEach(o => {
    const active = diaClinicLeadFilter.tier === o.key;
    html += `<button class="cl-filter-btn" data-cl-tier="${o.key}" style="font-size:11px;padding:4px 10px;border-radius:12px;border:1px solid ${active ? (o.color || 'var(--accent)') : 'var(--border)'};background:${active ? (o.color || 'var(--accent)') : 'var(--s2)'};color:${active ? '#fff' : 'var(--text2)'};cursor:pointer">${o.label}</button>`;
  });
  html += '</div>';
  html += '</div>';

  // Hide resolved toggle
  const hideRes = diaClinicLeadFilter.hideResolved;
  const resolvedCount = queue.filter(r => resolvedIds.has(r.medicare_id)).length;
  html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">';
  html += `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text2)">`;
  html += `<input type="checkbox" id="clHideResolved" ${hideRes ? 'checked' : ''} style="accent-color:var(--accent)" />`;
  html += `Hide dismissed (${resolvedCount})</label>`;
  html += '</div>';

  // Apply filters
  let filtered = queue;
  if (hideRes) filtered = filtered.filter(r => !resolvedIds.has(r.medicare_id));
  if (diaClinicLeadFilter.category) filtered = filtered.filter(r => r.research_category === diaClinicLeadFilter.category);
  if (diaClinicLeadFilter.tier) filtered = filtered.filter(r => r.priority_tier === diaClinicLeadFilter.tier);
  if (diaClinicLeadFilter.state) filtered = filtered.filter(r => r.state === diaClinicLeadFilter.state);

  // State dropdown
  const states = [...new Set(filtered.map(r => r.state).filter(Boolean))].sort();
  html += '<div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">';
  html += `<select id="clStateFilter" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)">`;
  html += `<option value="">All States (${states.length})</option>`;
  states.forEach(s => html += `<option value="${s}" ${diaClinicLeadFilter.state === s ? 'selected' : ''}>${s}</option>`);
  html += '</select>';
  html += `<span style="font-size:12px;color:var(--text3)">${fmtN(filtered.length)} clinics</span>`;
  html += '</div>';

  // === Table ===
  const pageSize = 50;
  const page = filtered.slice(0, pageSize);

  html += '<div class="data-table">';
  // Header
  html += '<div class="table-row" style="font-weight:600;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">';
  html += '<div style="flex:0.5">Score</div>';
  html += '<div style="flex:1.5">Facility</div>';
  html += '<div style="flex:0.8">City/State</div>';
  html += '<div style="flex:0.6">Patients</div>';
  html += '<div style="flex:0.7">Revenue</div>';
  html += '<div style="flex:0.6">Category</div>';
  html += '<div style="flex:0.3">&#x200B;</div>';
  html += '</div>';

  page.forEach((row, idx) => {
    const isSelected = diaClinicLeadFilter.selectedIdx === idx;
    const isResolved = resolvedIds.has(row.medicare_id);
    const tierColor = row.priority_tier === 'high' ? '#f87171' : row.priority_tier === 'medium' ? '#fbbf24' : '#94a3b8';
    const catLabel = row.research_category === 'seller_signal' ? 'Seller' : row.research_category === 'ownership_gap' ? 'Gap' : 'Unlinked';

    html += `<div class="table-row cl-row clickable-row" data-cl-idx="${idx}" style="font-size:12px;cursor:pointer;${isSelected ? 'background:rgba(52,211,153,0.1);border-left:3px solid #34d399;' : ''}${isResolved ? 'opacity:0.5;' : ''}">`;
    html += `<div style="flex:0.5"><span style="display:inline-block;padding:2px 6px;border-radius:8px;font-size:11px;font-weight:700;background:${tierColor}20;color:${tierColor}">${row.priority_score}</span></div>`;
    html += `<div style="flex:1.5;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(row.facility_name || '')}</div>`;
    html += `<div style="flex:0.8;color:var(--text2)">${esc(row.city || '')}${row.state ? ', ' + row.state : ''}</div>`;
    html += `<div style="flex:0.6;color:var(--text2)">${row.latest_estimated_patients || '–'}</div>`;
    html += `<div style="flex:0.7;color:var(--text2)">${row.estimated_annual_revenue ? '$' + fmtN(Math.round(row.estimated_annual_revenue / 1000)) + 'K' : '–'}</div>`;
    html += `<div style="flex:0.6"><span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--s3);color:var(--text2)">${catLabel}</span></div>`;
    html += `<div style="flex:0.3;text-align:right">${isResolved ? '✓' : '→'}</div>`;
    html += '</div>';
  });

  if (page.length === 0) {
    html += '<div class="table-empty" style="padding:24px;text-align:center;color:var(--text3)">No clinics match current filters</div>';
  }
  html += '</div>';

  // Selected card
  if (diaClinicLeadFilter.selectedIdx !== undefined && page[diaClinicLeadFilter.selectedIdx]) {
    html += renderClinicLeadCard(page[diaClinicLeadFilter.selectedIdx]);
  }

  // Attach handlers
  setTimeout(() => {
    // Row clicks — open unified detail sidebar
    document.querySelectorAll('.cl-row').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.clIdx);
        if (page[idx]) showDetail(page[idx], 'dia-clinic');
      });
    });
    // Category filter
    document.querySelectorAll('[data-cl-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.clCat;
        diaClinicLeadFilter.category = val === 'null' ? null : val;
        diaClinicLeadFilter.selectedIdx = undefined;
        renderDiaTab();
      });
    });
    // Tier filter
    document.querySelectorAll('[data-cl-tier]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.clTier;
        diaClinicLeadFilter.tier = val === 'null' ? null : val;
        diaClinicLeadFilter.selectedIdx = undefined;
        renderDiaTab();
      });
    });
    // State filter
    const stateEl = document.getElementById('clStateFilter');
    if (stateEl) {
      stateEl.addEventListener('change', () => {
        diaClinicLeadFilter.state = stateEl.value || null;
        diaClinicLeadFilter.selectedIdx = undefined;
        renderDiaTab();
      });
    }
    // Hide resolved toggle
    const hideEl = document.getElementById('clHideResolved');
    if (hideEl) {
      hideEl.addEventListener('change', () => {
        diaClinicLeadFilter.hideResolved = hideEl.checked;
        diaClinicLeadFilter.selectedIdx = undefined;
        renderDiaTab();
      });
    }
  }, 0);

  return html;
}

function _clCard(title, value, color) {
  const colors = { blue: '#60a5fa', green: '#34d399', red: '#f87171', orange: '#fb923c', purple: '#a78bfa', yellow: '#fbbf24', cyan: '#22d3ee' };
  const c = colors[color] || colors.blue;
  return `<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:4px">${title}</div>
    <div style="font-size:22px;font-weight:800;color:${c}">${value}</div>
  </div>`;
}

/**
 * Render the research card for a selected clinic lead — mirrors GSA research pattern
 */
function renderClinicLeadCard(rec) {
  let html = '<div style="margin-top:20px;border:1px solid var(--accent);border-radius:12px;padding:20px;background:var(--s1)">';

  // Header
  html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">`;
  html += `<div>`;
  html += `<h3 style="margin:0;font-size:16px;font-weight:700;color:var(--text)">${esc(rec.facility_name || 'Unknown Facility')}</h3>`;
  html += `<div style="font-size:12px;color:var(--text2);margin-top:2px">${esc(rec.address || '')}${rec.city ? ', ' + esc(rec.city) : ''}${rec.state ? ', ' + rec.state : ''} ${rec.zip_code || ''}</div>`;
  html += `</div>`;
  const tierColor = rec.priority_tier === 'high' ? '#f87171' : rec.priority_tier === 'medium' ? '#fbbf24' : '#94a3b8';
  html += `<div style="text-align:right">`;
  html += `<span style="display:inline-block;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700;background:${tierColor}20;color:${tierColor}">${rec.priority_score} pts</span>`;
  html += `<div style="font-size:10px;color:var(--text3);margin-top:2px">${(rec.research_category || '').replace('_', ' ').toUpperCase()}</div>`;
  html += `</div></div>`;

  // Context grid
  html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;font-size:12px">';
  html += _clCtx('Medicare ID', rec.medicare_id);
  html += _clCtx('Operator', rec.chain_organization || 'Independent');
  html += _clCtx('Stations', rec.stations || '–');
  html += _clCtx('Patients', rec.latest_estimated_patients || '–');
  html += _clCtx('Est. Revenue', rec.estimated_annual_revenue ? '$' + fmtN(Math.round(rec.estimated_annual_revenue)) : '–');
  html += _clCtx('Capacity Util.', rec.capacity_utilization_pct ? rec.capacity_utilization_pct + '%' : '–');
  html += _clCtx('Building SF', rec.building_size ? fmtN(Math.round(rec.building_size)) : '–');
  html += _clCtx('Land Area', rec.land_area ? fmtN(Math.round(rec.land_area)) + ' SF' : '–');
  html += _clCtx('Year Built', rec.year_built || '–');
  html += _clCtx('Last Rent', rec.last_known_rent ? '$' + fmtN(Math.round(rec.last_known_rent)) : '–');
  html += _clCtx('Ownership Tenure', rec.ownership_tenure_yrs ? rec.ownership_tenure_yrs + ' yrs' : '–');
  html += _clCtx('Loan Maturity', rec.months_to_maturity != null ? rec.months_to_maturity + ' mo' : '–');
  html += '</div>';

  // Loan context (if exists)
  if (rec.loan_id) {
    html += '<div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:12px">';
    html += '<div style="font-weight:600;margin-bottom:4px;color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Loan Info</div>';
    html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">`;
    html += _clCtx('Lender', rec.lender_name || '–');
    html += _clCtx('Amount', rec.loan_amount ? '$' + fmtN(Math.round(rec.loan_amount)) : '–');
    html += _clCtx('Type', rec.loan_type || '–');
    html += '</div></div>';
  }

  // Quick actions
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">';
  const searchQ = `${rec.facility_name || ''} ${rec.address || ''} ${rec.city || ''} ${rec.state || ''} dialysis ownership`;
  html += `<a href="https://www.google.com/search?q=${encodeURIComponent(searchQ)}" target="_blank" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">Google Search</a>`;
  if (rec.state) {
    html += `<a href="https://www.google.com/search?q=${encodeURIComponent('Secretary of State business search ' + rec.state)}" target="_blank" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">SOS ${rec.state}</a>`;
  }
  if (rec.city && rec.state) {
    html += `<a href="https://www.google.com/search?q=${encodeURIComponent(rec.city + ' ' + rec.state + ' county property records')}" target="_blank" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">County Records</a>`;
  }
  html += '</div>';

  // === RESEARCH FORM (mirrors GSA pattern) ===
  html += '<div style="border-top:1px solid var(--border);padding-top:16px">';
  html += '<div style="font-weight:700;font-size:13px;margin-bottom:12px;color:var(--text)">Research Form</div>';

  // Row 1: Owner info
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
  html += _clInput('Recorded Owner', 'cl-recorded-owner', '');
  html += _clInput('True Owner / Developer', 'cl-true-owner', '');
  html += '</div>';

  // Row 2: Entity details
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">';
  html += _clInput('State of Incorporation', 'cl-incorporation', '');
  html += _clInput('Principal Names', 'cl-principals', '');
  html += _clInput('Contact Email', 'cl-email', '', 'email');
  html += '</div>';

  // Row 3: Contact info
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">';
  html += _clInput('Phone', 'cl-phone', '', 'tel');
  html += _clInput('Phone 2', 'cl-phone-2', '', 'tel');
  html += _clInput('Mailing Address', 'cl-mailing', '');
  html += '</div>';

  // Row 4: Pipeline status
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
  html += '<div>';
  html += '<label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:3px">Pipeline Status</label>';
  html += '<select id="cl-pipeline-status" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)">';
  html += '<option value="">— Select —</option>';
  html += '<option value="new_lead">New Lead</option>';
  html += '<option value="researching">Researching</option>';
  html += '<option value="contacted">Contacted</option>';
  html += '<option value="meeting_set">Meeting Set</option>';
  html += '<option value="proposal_sent">Proposal Sent</option>';
  html += '<option value="not_for_sale">Not For Sale</option>';
  html += '<option value="dead">Dead</option>';
  html += '</select>';
  html += '</div>';
  html += _clInput('Mailing Address 2', 'cl-mailing-2', '');
  html += '</div>';

  // Row 5: Research notes
  html += '<div style="margin-bottom:14px">';
  html += '<label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:3px">Research Notes</label>';
  html += `<textarea id="cl-notes" rows="3" placeholder="Research findings, next steps..." style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);resize:vertical;font-family:inherit;box-sizing:border-box"></textarea>`;
  html += '</div>';

  // Action buttons
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
  html += `<button id="clSaveBtn" style="flex:1;padding:10px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer">Save & Next</button>`;
  html += `<button id="clSkipBtn" style="padding:10px 16px;background:var(--s2);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--text2)">Skip</button>`;
  html += `<button id="clNaBtn" style="padding:10px 16px;background:var(--s2);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--text3)">N/A</button>`;
  html += '</div>';

  html += '</div>'; // form
  html += '</div>'; // card

  // Attach save/skip handlers
  setTimeout(() => {
    const saveBtn = document.getElementById('clSaveBtn');
    const skipBtn = document.getElementById('clSkipBtn');
    const naBtn = document.getElementById('clNaBtn');

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        await saveClinicLeadResearch(rec);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save & Next';
      });
    }
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        diaClinicLeadFilter.selectedIdx = undefined;
        renderDiaTab();
      });
    }
    if (naBtn) {
      naBtn.addEventListener('click', async () => {
        naBtn.disabled = true;
        await markClinicLead(rec, 'not_applicable');
        naBtn.disabled = false;
      });
    }
  }, 0);

  return html;
}

function _clCtx(label, value) {
  return `<div><span style="color:var(--text3);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">${label}</span><div style="font-weight:500;color:var(--text)">${value}</div></div>`;
}

function _clInput(label, id, value, type) {
  return `<div>
    <label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:3px">${label}</label>
    <input type="${type || 'text'}" id="${id}" value="${esc(value || '')}" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box">
  </div>`;
}

/**
 * Save clinic lead research — writes to research_queue_outcomes + updates properties if data entered
 */
async function saveClinicLeadResearch(rec) {
  const data = {
    recorded_owner: document.getElementById('cl-recorded-owner')?.value || null,
    true_owner: document.getElementById('cl-true-owner')?.value || null,
    state_of_incorporation: document.getElementById('cl-incorporation')?.value || null,
    principal_names: document.getElementById('cl-principals')?.value || null,
    contact_email: document.getElementById('cl-email')?.value || null,
    contact_phone: document.getElementById('cl-phone')?.value || null,
    phone_2: document.getElementById('cl-phone-2')?.value || null,
    mailing_address: document.getElementById('cl-mailing')?.value || null,
    mailing_address_2: document.getElementById('cl-mailing-2')?.value || null,
    pipeline_status: document.getElementById('cl-pipeline-status')?.value || null,
    notes: document.getElementById('cl-notes')?.value || null
  };

  // 1. Save research outcome
  const outcomeOk = await saveClinicLeadOutcome(rec.medicare_id, 'completed', data.notes, rec.property_id);
  if (!outcomeOk) return;

  // 2. If we have owner info and a property_id, update the property's owner fields
  if (rec.property_id && (data.recorded_owner || data.true_owner)) {
    const propUpdate = {};
    if (data.recorded_owner) propUpdate.tenant = data.recorded_owner; // recorded_owner maps to tenant field for display
    await diaPatchRecord('properties', 'property_id', rec.property_id, propUpdate);
  }

  // Bridge to canonical model
  canonicalBridge('complete_research', {
    domain: 'dialysis',
    research_type: 'clinic_lead',
    external_id: String(rec.medicare_id || rec.property_id),
    source_system: 'dia_supabase',
    source_type: rec.property_id ? 'asset' : 'clinic',
    outcome: 'completed',
    notes: data.notes,
    source_record_id: String(rec.medicare_id || rec.property_id),
    source_table: rec.property_id ? 'properties' : 'clinic_leads',
    title: rec.facility_name || rec.address || `Clinic ${rec.medicare_id || rec.property_id}`,
    entity_fields: {
      name: rec.facility_name || rec.address || `Clinic ${rec.medicare_id || rec.property_id}`,
      address: rec.address || null,
      city: rec.city || null,
      state: rec.state || null,
      asset_type: 'dialysis_clinic'
    }
  });

  showToast('Clinic lead saved!', 'success');

  // Advance to next
  diaClinicLeadFilter.selectedIdx = undefined;
  renderDiaTab();
}

/**
 * Mark a clinic lead as N/A or other quick-status
 */
async function markClinicLead(rec, status) {
  await saveClinicLeadOutcome(rec.medicare_id, status, null, rec.property_id);

  // Bridge to canonical model
  canonicalBridge(status === 'not_applicable' ? 'dismiss_lead' : 'complete_research', {
    domain: 'dialysis',
    research_type: 'clinic_lead',
    external_id: String(rec.medicare_id || rec.property_id),
    source_system: 'dia_supabase',
    outcome: status,
    reason: status
  });

  showToast(`Marked as ${status.replace('_', ' ')}`, 'success');
  diaClinicLeadFilter.selectedIdx = undefined;
  renderDiaTab();
}

/**
 * Persist to research_queue_outcomes for clinic_lead queue type
 */
async function saveClinicLeadOutcome(clinicId, status, notes, propertyId) {
  try {
    const payload = {
      queue_type: 'clinic_lead',
      clinic_id: clinicId,
      status: status,
      notes: notes || null,
      selected_property_id: propertyId || null,
      assigned_at: new Date().toISOString()
    };

    const result = await applyInsertWithFallback({
      proxyBase: '/api/dia-query',
      table: 'research_queue_outcomes',
      idColumn: 'clinic_id',
      recordIdentifier: clinicId,
      data: payload,
      source_surface: 'dialysis_clinic_leads',
      propagation_scope: 'research_queue_outcome'
    });

    if (!result.ok) {
      console.error('Clinic lead save error:', result.errors || []);
      showToast('Error saving clinic lead', 'error');
      return false;
    }

    // Refresh outcomes cache
    const freshOutcomes = await diaQuery('research_queue_outcomes', '*', { limit: 500 });
    diaData.researchOutcomes = freshOutcomes || [];

    canonicalBridge('log_activity', {
      title: 'Clinic lead outcome recorded',
      domain: 'dialysis',
      source_system: 'dia_supabase',
      external_id: String(clinicId),
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      metadata: { clinic_id: clinicId, status: status, notes: notes, property_id: propertyId }
    });

    return true;
  } catch (err) {
    console.error('saveClinicLeadOutcome error:', err);
    showToast('Error saving: ' + err.message, 'error');
    return false;
  }
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

    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'research_queue_outcomes',
      idColumn: 'clinic_id',
      idValue: clinicId,
      matchFilters: [{ column: 'queue_type', value: queueType }],
      data: payload,
      source_surface: 'dialysis_research_outcome',
      propagation_scope: 'research_queue_outcome'
    });

    if (!result.ok) {
      throw new Error('Failed to save outcome: ' + (result.errors || []).join('; '));
    }

    showToast('Outcome saved', 'success');
    canonicalBridge('log_activity', {
      title: 'Research outcome saved',
      domain: 'dialysis',
      source_system: 'dia_supabase',
      external_id: String(clinicId),
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      metadata: { queue_type: queueType, clinic_id: clinicId, status: status, property_id: propId, notes: notes }
    });

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
    case 'ownership':
      html = renderDiaDetailOwnership(record);
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
 * Overview tab — comprehensive facility info with financials, lease, and ownership summary
 */
function renderDiaDetailOverview(record) {
  const r = record;
  let html = '<div class="detail-section">';

  // Facility identity
  html += '<div class="detail-section-title">' + esc(r.facility_name || '—') + '</div>';
  html += _detRow('Address', [r.address, r.city, r.state, r.zip_code].filter(Boolean).join(', ') || '—');
  html += _detRow('CCN / Medicare ID', r.ccn || r.clinic_id || r.medicare_id || '—');
  html += _detRow('NPI', r.npi || r.medicare_npi || '—');
  html += _detRow('Operator', r.operator_name || r.chain_organization || '—');
  html += _detRow('Parent Org', r.parent_organization || '—');
  html += _detRow('Stations / Chairs', r.stations || r.number_of_chairs || '—');

  // Modality & Patient metrics
  const modLabel = r.modality_type === 'hybrid' ? 'Hybrid (IC + Home)' : r.modality_type === 'home' ? 'Home Only' : 'In-Center';
  const modColor = r.modality_type === 'hybrid' ? '#fbbf24' : r.modality_type === 'home' ? '#a78bfa' : '#34d399';
  html += '<div class="detail-section-title" style="margin-top:20px">Patient Volume</div>';
  html += '<div class="detail-row"><div class="detail-lbl">Modality</div><div class="detail-val" style="color:' + modColor + ';font-weight:600">' + modLabel + '</div></div>';
  html += _detRow('CMS Total Patients', r.latest_total_patients != null ? fmtN(r.latest_total_patients) : '—');
  const icPts = Number(r.est_in_center_patients) || 0;
  const hmPts = Number(r.est_home_patients) || 0;
  if (r.modality_type === 'hybrid' || r.modality_type === 'home') {
    html += '<div class="detail-row"><div class="detail-lbl">Est. In-Center Pts</div><div class="detail-val" style="color:#34d399;font-weight:600">' + fmtN(icPts) + '</div></div>';
    html += '<div class="detail-row"><div class="detail-lbl">Est. Home Pts</div><div class="detail-val" style="color:#a78bfa;font-weight:600">' + fmtN(hmPts) + '</div></div>';
  }
  html += _detRow('Capacity Utilization', r.capacity_utilization_pct ? r.capacity_utilization_pct + '%' : '—');

  // Financial summary — bifurcated
  html += '<div class="detail-section-title" style="margin-top:20px">Financials</div>';
  if (r.estimated_annual_revenue) {
    html += _detRow('TTM Revenue (Reported)', '$' + Number(r.estimated_annual_revenue).toLocaleString(undefined, {maximumFractionDigits: 0}));
  }
  const icRev = Number(r.est_in_center_revenue) || 0;
  const hmRev = Number(r.est_home_revenue) || 0;
  const combRev = Number(r.est_combined_revenue) || 0;
  if (r.modality_type === 'hybrid') {
    html += '<div class="detail-row"><div class="detail-lbl">Est. IC Revenue</div><div class="detail-val" style="color:#34d399">$' + icRev.toLocaleString(undefined, {maximumFractionDigits: 0}) + '</div></div>';
    html += '<div class="detail-row"><div class="detail-lbl">Est. Home Revenue</div><div class="detail-val" style="color:#a78bfa">$' + hmRev.toLocaleString(undefined, {maximumFractionDigits: 0}) + '</div></div>';
    html += _detRow('Est. Combined Revenue', '$' + combRev.toLocaleString(undefined, {maximumFractionDigits: 0}));
  } else if (r.modality_type === 'home') {
    html += '<div class="detail-row"><div class="detail-lbl">Est. Home Revenue</div><div class="detail-val" style="color:#a78bfa">$' + hmRev.toLocaleString(undefined, {maximumFractionDigits: 0}) + '</div></div>';
  } else {
    html += _detRow('Est. IC Revenue', '$' + icRev.toLocaleString(undefined, {maximumFractionDigits: 0}));
  }
  html += _detRow('Est. EBITDA', r.estimated_ebitda ? '$' + Number(r.estimated_ebitda).toLocaleString(undefined, {maximumFractionDigits: 0}) : '—');
  html += _detRow('Operating Margin', r.operating_margin_assumption ? (Number(r.operating_margin_assumption) * 100).toFixed(1) + '%' : '—');
  html += _detRow('Payer Mix (Medicare)', r.payer_mix_medicare ? (Number(r.payer_mix_medicare) * 100).toFixed(0) + '%' : '—');
  html += _detRow('Payer Mix (Commercial)', r.payer_mix_commercial ? (Number(r.payer_mix_commercial) * 100).toFixed(0) + '%' : '—');

  // Lease summary (if present)
  html += '<div class="detail-section-title" style="margin-top:20px">Lease</div>';
  if (r.lease_id) {
    html += _detRow('Tenant', r.lease_tenant || '—');
    html += _detRow('Lease Start', r.lease_start || '—');
    html += _detRow('Lease Expiration', r.lease_expiration || '—');
    html += _detRow('Rent', r.rent ? '$' + Number(r.rent).toLocaleString(undefined, {maximumFractionDigits: 0}) : '—');
    html += _detRow('Rent PSF', r.rent_per_sf ? '$' + Number(r.rent_per_sf).toFixed(2) : '—');
    html += _detRow('Expense Structure', r.expense_structure || '—');
    html += _detRow('Guarantor', r.guarantor || '—');
    html += _detRow('Renewal Options', r.renewal_options || '—');
    if (r.lease_expiration_risk) {
      const riskColor = r.lease_expiration_risk === 'high' ? '#f87171' : r.lease_expiration_risk === 'medium' ? '#fbbf24' : '#34d399';
      html += '<div class="detail-row"><div class="detail-lbl">Expiration Risk</div><div class="detail-val" style="color:' + riskColor + ';font-weight:600">' + esc(r.lease_expiration_risk) + '</div></div>';
    }
  } else {
    html += '<div style="color:var(--text3);font-size:12px;padding:4px 0">No active lease linked</div>';
  }

  // Ownership summary (if present)
  html += '<div class="detail-section-title" style="margin-top:20px">Ownership</div>';
  if (r.ownership_id) {
    html += _detRow('Recorded Owner', r.recorded_owner_name || '—');
    html += _detRow('True Owner / Developer', r.true_owner_name || '— not traced');
    html += _detRow('Owner Type', r.owner_type || '—');
    html += _detRow('Ownership Start', r.ownership_start || '—');
    html += _detRow('Last Sale Price', r.last_sold_price ? '$' + Number(r.last_sold_price).toLocaleString(undefined, {maximumFractionDigits: 0}) : '—');
    if (r.is_developer) html += _detRow('Developer?', 'Yes');
  } else {
    html += '<div style="color:var(--text3);font-size:12px;padding:4px 0">No ownership chain linked — <span style="color:var(--accent);cursor:pointer" onclick="switchUnifiedTab(\'Ownership\')">resolve now</span></div>';
  }

  html += '</div>';
  return html;
}

function _detRow(label, value) {
  return '<div class="detail-row"><div class="detail-lbl">' + label + '</div><div class="detail-val">' + esc(String(value || '—')) + '</div></div>';
}

/**
 * Property tab — location, building info, and inventory snapshots
 */
function renderDiaDetailProperty(record) {
  const r = record;
  let html = '<div class="detail-section">';

  html += '<div class="detail-section-title">Property Information</div>';
  html += _detRow('Facility', r.facility_name || '—');
  html += _detRow('Address', r.address || '—');
  html += _detRow('City / State', (r.city || '—') + ', ' + (r.state || '—'));
  html += _detRow('ZIP', r.zip_code || '—');
  html += _detRow('Property ID', r.property_id || 'Not linked');
  html += _detRow('Building Size', r.building_size ? fmtN(Math.round(Number(r.building_size))) + ' SF' : '—');
  html += _detRow('Land Area', r.land_area ? fmtN(Math.round(Number(r.land_area))) + ' SF' : '—');
  html += _detRow('Year Built', r.year_built || '—');
  html += _detRow('Stations / Chairs', r.stations || r.number_of_chairs || '—');

  // Lease detail section
  html += '<div class="detail-section-title" style="margin-top:20px">Active Lease</div>';
  if (r.lease_id) {
    html += _detRow('Tenant', r.lease_tenant || '—');
    html += _detRow('Lease Start', r.lease_start || '—');
    html += _detRow('Lease Expiration', r.lease_expiration || '—');
    html += _detRow('Renewal Options', r.renewal_options || '—');
    html += _detRow('Rent', r.rent ? '$' + Number(r.rent).toLocaleString(undefined, {maximumFractionDigits: 0}) : '—');
    html += _detRow('Rent PSF', r.rent_per_sf ? '$' + Number(r.rent_per_sf).toFixed(2) : '—');
    html += _detRow('Expense Structure', r.expense_structure || '—');
    html += _detRow('Guarantor', r.guarantor || '—');
    html += _detRow('Lease Status', r.lease_status || '—');
    if (r.lease_expiration_risk) {
      const riskColor = r.lease_expiration_risk === 'high' ? '#f87171' : r.lease_expiration_risk === 'medium' ? '#fbbf24' : '#34d399';
      html += '<div class="detail-row"><div class="detail-lbl">Expiration Risk</div><div class="detail-val" style="color:' + riskColor + ';font-weight:600">' + esc(r.lease_expiration_risk) + '</div></div>';
    }
  } else {
    html += '<div style="color:var(--text3);font-size:12px;padding:4px 0">No active lease found for this property</div>';
  }

  html += '</div>';
  return html;
}

/**
 * Ownership tab — view chain and resolve ownership back to developer
 */
function renderDiaDetailOwnership(record) {
  const r = record;
  let html = '<div class="detail-section">';

  html += '<div class="detail-section-title">Ownership Chain</div>';

  if (r.ownership_id) {
    html += _detRow('Recorded Owner', r.recorded_owner_name || '— unknown');
    html += _detRow('True Owner / Developer', r.true_owner_name || '— not traced');
    html += _detRow('Owner Type', r.owner_type || '—');
    html += _detRow('Ownership Start', r.ownership_start || '—');
    html += _detRow('Last Sale Price', r.last_sold_price ? '$' + Number(r.last_sold_price).toLocaleString(undefined, {maximumFractionDigits: 0}) : '—');
  } else {
    html += '<div style="color:var(--text3);font-size:12px;padding:8px 0">No ownership records found for this property</div>';
  }

  // Ownership resolution form
  html += '<div class="detail-section-title" style="margin-top:20px">Resolve Ownership</div>';
  html += '<div style="font-size:11px;color:var(--text3);margin-bottom:10px">Trace the ownership chain back to the developer / true owner. This writes to the ownership_history table.</div>';

  html += '<div class="detail-grid" style="gap:10px">';
  html += '<div class="detail-row" style="flex-direction:column;align-items:stretch"><label style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:2px">Recorded Owner</label><input id="dia-own-recorded" type="text" value="' + esc(r.recorded_owner_name || '') + '" placeholder="Entity name on deed" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)"></div>';
  html += '<div class="detail-row" style="flex-direction:column;align-items:stretch"><label style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:2px">True Owner / Developer</label><input id="dia-own-true" type="text" value="' + esc(r.true_owner_name || '') + '" placeholder="Parent entity, developer, fund" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)"></div>';
  html += '<div class="detail-row" style="flex-direction:column;align-items:stretch"><label style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:2px">Owner Type</label><select id="dia-own-type" style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)"><option value="">— Select —</option><option value="individual"' + (r.owner_type === 'individual' ? ' selected' : '') + '>Individual</option><option value="llc"' + (r.owner_type === 'llc' ? ' selected' : '') + '>LLC</option><option value="reit"' + (r.owner_type === 'reit' ? ' selected' : '') + '>REIT</option><option value="developer"' + (r.owner_type === 'developer' ? ' selected' : '') + '>Developer</option><option value="fund"' + (r.owner_type === 'fund' ? ' selected' : '') + '>Fund</option><option value="operator"' + (r.owner_type === 'operator' ? ' selected' : '') + '>Operator</option><option value="other"' + (r.owner_type === 'other' ? ' selected' : '') + '>Other</option></select></div>';
  html += '<div class="detail-row" style="flex-direction:column;align-items:stretch"><label style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:2px">Notes</label><textarea id="dia-own-notes" rows="2" placeholder="Research notes..." style="font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);resize:vertical;font-family:inherit"></textarea></div>';
  html += '</div>';

  html += '<button onclick="saveDiaOwnershipResolution()" style="margin-top:12px;width:100%;padding:10px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer">Save Ownership</button>';

  // Quick actions
  html += '<div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">';
  const searchQ = (r.recorded_owner_name || r.facility_name || '') + ' ' + (r.state || '');
  html += '<a href="https://www.google.com/search?q=' + encodeURIComponent(searchQ + ' ownership') + '" target="_blank" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none">Google Owner</a>';
  if (r.state) {
    html += '<a href="https://www.google.com/search?q=' + encodeURIComponent('Secretary of State business search ' + r.state) + '" target="_blank" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none">SOS ' + esc(r.state) + '</a>';
  }
  html += '</div>';

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
    const liveIngestMeta = window.parseLiveIngestOutcomeNotes ? window.parseLiveIngestOutcomeNotes(outcome.notes) : null;
    
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
    if (liveIngestMeta && window.renderLiveIngestOutcomeProvenance) {
      html += window.renderLiveIngestOutcomeProvenance(liveIngestMeta, { limit: 4 });
    } else if (outcome.notes) {
      html += '<div style="margin-top:8px;color:var(--text2);font-size:12px;white-space:pre-wrap">' + esc(outcome.notes) + '</div>';
    }
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
  const status = document.getElementById('diaDetailStatus')?.value;
  const notes = document.getElementById('diaDetailNotes')?.value;
  
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
        const batch = await diaQuery('v_available_listings', '*', {
          order: 'listing_date.desc.nullslast', limit: 1000, offset: pg * 1000,
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
        // These views may return 403 if Supabase role lacks SELECT permission — catch individually
        const [watchlist, gaps] = await Promise.all([
          diaQueryAll('v_clinic_lease_renewal_watchlist', '*').catch(function(e) {
            console.warn('v_clinic_lease_renewal_watchlist: ' + (e.message || '403 — grant SELECT to API role'));
            return [];
          }),
          diaQueryAll('v_clinic_lease_data_gaps', 'gap_type,clinic_id,facility_name,operator_name,city,state,lease_expiration,total_patients').catch(function(e) {
            console.warn('v_clinic_lease_data_gaps: ' + (e.message || '403 — grant SELECT to API role'));
            return [];
          })
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
        const loans = await diaQuery('v_loans',
          'loan_id,property_id,facility_name,address,city,state,operator,loan_amount,current_balance,interest_rate_percent,interest_rate_text,maturity_date,origination_date,loan_to_value,loan_type,recourse,alert_flag,lender_name,loan_term',
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
  html += '<th>Facility</th><th>City</th><th style="text-align:right">Loan Amount</th><th style="text-align:right">Rate</th><th>Type</th><th>Lender</th><th>Maturity</th><th>Alert</th>';
  html += '</tr></thead><tbody>';
  for (var li = 0; li < Math.min(sorted.length, 50); li++) {
    var ln = sorted[li];
    var rate = parseFloat(ln.interest_rate_percent) > 0 ? parseFloat(ln.interest_rate_percent).toFixed(2) + '%' : (ln.interest_rate_text || '—');
    var alertBadge = ln.alert_flag ? '<span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px">FLAG</span>' : '<span style="font-size:11px;color:var(--text3)">—</span>';
    var matDate = ln.maturity_date ? new Date(ln.maturity_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '—';
    html += '<tr>';
    html += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ln.facility_name || String(ln.property_id || '—')) + '</td>';
    html += '<td>' + esc((ln.city || '') + (ln.state ? ', ' + ln.state : '')) + '</td>';
    html += '<td style="text-align:right;font-weight:600">' + fmt(parseFloat(ln.loan_amount) || 0) + '</td>';
    html += '<td style="text-align:right">' + rate + '</td>';
    html += '<td>' + esc(ln.loan_type || '—') + '</td>';
    html += '<td>' + esc(ln.lender_name || '—') + '</td>';
    html += '<td>' + matDate + '</td>';
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
          const buyersRaw = await diaQueryAll('sales_transactions', 'buyer_name,buyer_type,sold_price,sale_date,cap_rate,property_id');
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
          const sellersRaw = await diaQueryAll('sales_transactions', 'seller_name,seller_type,sold_price,sale_date,cap_rate,property_id');
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
          const saleBrokers = await diaQueryAll('sale_brokers', '*');
          const brokers = await diaQueryAll('brokers', 'broker_id,broker_name,company,email,phone');
          const sales = await diaQueryAll('sales_transactions', 'sale_id,sold_price,sale_date,cap_rate,buyer_name,seller_name');
          
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

      // Store flat search results array for onclick references (avoids massive inline JSON in DOM)
      window._diaSearchFlat = [];
      function pushDiaRef(record) {
        var idx = window._diaSearchFlat.length;
        window._diaSearchFlat.push(record);
        return idx;
      }

      if (clinics.length > 0) {
        html += '<div class="search-results-section"><h4>Clinics (' + clinics.length + ')</h4>';
        clinics.forEach(r => {
          var idx = pushDiaRef(r);
          html += '<div class="search-card" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\')">';
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
          var idx = pushDiaRef(r);
          html += '<div class="search-card" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\')">';
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
          var idx = pushDiaRef(r);
          html += '<div class="search-card" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\')">';
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
          var idx = pushDiaRef(r);
          html += '<div class="search-card" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\')">';
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
      diaQuery('v_clinic_property_link_review_queue', '*', { filter: 'or=(facility_name.ilike.' + like + ',operator_name.ilike.' + like + ',state.ilike.' + like + ')', limit: 25 }).catch(() => []),
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
  // Route through closed-loop mutation service with fallback to direct PATCH
  try {
    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table,
      idColumn: idCol,
      idValue: idVal,
      data,
      source_surface: 'dia_workspace'
    });

    if (!result.ok) {
      console.error(`diaPatchRecord error: ${(result.errors || []).join(', ')}`);
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

  const buyer = q('#dia-buyer-name')?.value?.trim() || null;
  const buyerType = q('#dia-buyer-type')?.value?.trim() || null;
  const seller = q('#dia-seller-name')?.value?.trim() || null;
  const price = parseFloat(q('#dia-sold-price')?.value) || null;
  const capRateVal = parseFloat(q('#dia-cap-rate')?.value);
  const capRate = capRateVal ? capRateVal / 100 : null;
  const saleDate = q('#dia-sale-date')?.value || null;
  const capMethod = q('#dia-cap-rate-method')?.value?.trim() || null;
  const capNotes = q('#dia-cap-rate-notes')?.value?.trim() || null;
  const notes = q('#dia-notes')?.value?.trim() || null;

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
    canonicalBridge('log_activity', {
      title: 'Sale transaction saved',
      domain: 'dialysis',
      source_system: 'dia_supabase',
      external_id: String(record.sale_id),
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      metadata: { sale_id: record.sale_id, buyer: buyer, seller: seller, sold_price: price, sale_date: saleDate }
    });
  }
}

async function saveSaleProperty() {
  const record = window._saleRecord;
  if (!record || !record.property_id) return;

  const address = q('#dia-prop-address')?.value?.trim() || null;
  const city = q('#dia-prop-city')?.value?.trim() || null;
  const state = q('#dia-prop-state')?.value?.trim() || null;
  const tenant = q('#dia-prop-tenant')?.value?.trim() || null;
  const rba = parseFloat(q('#dia-prop-rba')?.value) || null;
  const land = parseFloat(q('#dia-prop-land')?.value) || null;
  const year = parseInt(q('#dia-prop-year')?.value) || null;

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
    canonicalBridge('log_activity', {
      title: 'Sale property updated',
      domain: 'dialysis',
      source_system: 'dia_supabase',
      external_id: String(record.property_id),
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      property_name: address || null,
      metadata: { property_id: record.property_id, address: address, city: city, state: state, tenant: tenant }
    });
  }
}

async function saveSaleOwner(ownershipId, idx) {
  const ownerType = q('#dia-owner-type-' + idx)?.value?.trim() || null;
  const ownerSource = q('#dia-owner-source-' + idx)?.value?.trim() || null;
  const notes = q('#dia-owner-notes-' + idx)?.value?.trim() || null;

  const data = {
    owner_type: ownerType || null,
    ownership_source: ownerSource || null,
    notes: notes || null
  };

  const success = await diaPatchRecord('ownership_history', 'ownership_id', ownershipId, data);
  if (success) {
    showToast('Owner record saved successfully', 'success');
    canonicalBridge('save_ownership', {
      domain: 'dialysis',
      source_system: 'dia_supabase',
      external_id: String(ownershipId),
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      owner_type: ownerType,
      metadata: { ownership_id: ownershipId, owner_type: ownerType, ownership_source: ownerSource, notes: notes }
    });
  }
}

async function saveSaleResearch() {
  const record = window._saleRecord;
  if (!record || !record.sale_id) return;

  const status = q('#dia-research-status')?.value?.trim() || null;
  const notes = q('#dia-research-notes')?.value?.trim() || null;

  if (!status) {
    showToast('Please select a status', 'error');
    return;
  }

  if (!record.clinic_id) {
    showToast('No clinic linked to this sale — cannot save research outcome', 'error');
    return;
  }

  // Create or update research_queue_outcomes record
  try {
    const data = {
      queue_type: 'sales_comp',
      clinic_id: record.clinic_id,
      status: status,
      notes: notes || null,
      selected_property_id: record.property_id || null
    };

    const result = await applyInsertWithFallback({
      proxyBase: '/api/dia-query',
      table: 'research_queue_outcomes',
      idColumn: 'clinic_id',
      recordIdentifier: record.clinic_id,
      data,
      source_surface: 'dialysis_sales_detail',
      propagation_scope: 'research_queue_outcome'
    });

    if (!result.ok) {
      console.error('Research save error:', result.errors || []);
      showToast('Error saving research', 'error');
      return;
    }

    showToast('Research resolution saved', 'success');
    canonicalBridge('complete_research', {
      domain: 'dialysis',
      research_type: 'entity_enrichment',
      source_system: 'dia_supabase',
      external_id: String(record.clinic_id),
      source_type: 'clinic',
      outcome: status || 'completed',
      notes: notes,
      source_record_id: String(record.clinic_id),
      source_table: 'research_queue_outcomes',
      title: record.facility_name || record.address || `Clinic ${record.clinic_id}`,
      entity_fields: {
        name: record.facility_name || record.address || `Clinic ${record.clinic_id}`,
        address: record.address || null,
        city: record.city || null,
        state: record.state || null,
        asset_type: 'dialysis_clinic'
      },
      metadata: { queue_type: 'sales_comp', clinic_id: record.clinic_id, status: status, property_id: record.property_id }
    });
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
window.renderDiaClinicLeads = renderDiaClinicLeads;
window.saveClinicLeadResearch = saveClinicLeadResearch;
window.markClinicLead = markClinicLead;
window.saveDiaOwnershipResolution = saveDiaOwnershipResolution;

/**
 * Save ownership resolution from the dialysis-specific detail panel (fallback path).
 * Reads form fields from renderDiaDetailOwnership(), patches ownership_history
 * if a record exists, and logs the resolution to research_queue_outcomes.
 */
async function saveDiaOwnershipResolution() {
  const record = window._detailRecord;
  if (!record) { showToast('No record loaded', 'error'); return; }

  const propertyId = record.property_id;
  if (!propertyId) { showToast('No property ID — cannot save ownership', 'error'); return; }

  const recordedOwner = q('#dia-own-recorded')?.value?.trim() || null;
  const trueOwner     = q('#dia-own-true')?.value?.trim() || null;
  const ownerType     = q('#dia-own-type')?.value || null;
  const notes         = q('#dia-own-notes')?.value?.trim() || null;

  // If there's an existing ownership record, PATCH it
  if (record.ownership_id) {
    const patchData = {};
    if (ownerType) patchData.owner_type = ownerType;
    if (notes) patchData.notes = notes;
    if (Object.keys(patchData).length > 0) {
      const ok = await diaPatchRecord('ownership_history', 'ownership_id', record.ownership_id, patchData);
      if (!ok) return; // toast already shown by diaPatchRecord
    }
  }

  // Log resolution to research_queue_outcomes
  const clinicId = record.clinic_id || record.medicare_id || null;
  if (clinicId) {
    try {
      const payload = {
        queue_type: 'ownership_resolution',
        clinic_id: clinicId,
        status: 'completed',
        notes: [
          recordedOwner ? 'Recorded Owner: ' + recordedOwner : null,
          trueOwner ? 'True Owner: ' + trueOwner : null,
          ownerType ? 'Type: ' + ownerType : null,
          notes ? 'Notes: ' + notes : null
        ].filter(Boolean).join(' | '),
        selected_property_id: propertyId,
        assigned_at: new Date().toISOString()
      };
      const result = await applyInsertWithFallback({
        proxyBase: '/api/dia-query',
        table: 'research_queue_outcomes',
        idColumn: 'clinic_id',
        recordIdentifier: clinicId,
        data: payload,
        source_surface: 'dialysis_ownership_detail',
        propagation_scope: 'research_queue_outcome'
      });
      if (!result.ok) {
        console.error('Ownership resolution save error:', result.errors || []);
      }
    } catch (e) {
      console.error('Ownership resolution POST error:', e);
    }
  }

  showToast('Ownership resolution saved!', 'success');
  canonicalBridge('save_ownership', {
    domain: 'dialysis',
    source_system: 'dia_supabase',
    external_id: String(propertyId),
    user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
    owner_name: recordedOwner,
    true_owner_name: trueOwner,
    owner_type: ownerType,
    metadata: { property_id: propertyId, clinic_id: record.clinic_id || record.medicare_id || null, notes: notes }
  });
}
