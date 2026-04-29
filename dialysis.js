// ============================================================================
// DIALYSIS DASHBOARD MODULE
// Vanilla JavaScript implementation of Dialysis dashboard
// Loaded after index.html, overrides placeholder functions
// ============================================================================

// ============================================================================
// MODULE STATE
// ============================================================================

let diaCharts = {};
let diaResearchMode = 'quarantine'; // pipeline order: quarantine → unmatched → clarification → property → lease → clinic_leads → staleness → run_health
let diaResearchIdx = 0;
let diaPropertyFilter = { review_type: null, state: null, selectedIdx: undefined };
let diaLeaseFilter = { priority: null, selectedIdx: undefined };
let diaLeaseBackfillStep = 0; // step counter for 5-step lease backfill workflow
let diaClinicLeadFilter = { category: null, tier: null, state: null, selectedIdx: undefined, hideResolved: true };
let diaClinicLeadStep = 0; // step counter for 5-step clinic lead workflow
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
let diaCmsSelectedIdx = undefined; // selected row in CMS table
let diaNpiFilter = null; // filter by signal_type
let diaNpiSelectedIdx = undefined; // selected row in NPI table
let diaSalesView = 'comps'; // 'comps' | 'available'
let diaSalesComps = null;   // lazy-loaded from sales_transactions + properties + leases
let diaAvailListings = null; // lazy-loaded from available_listings (on-market only)
let diaFinancialEstimates = null; // lazy-loaded from clinic_financial_estimates
let diaPatientCounts = null; // lazy-loaded from v_facility_patient_counts_latest
let diaSalesLoading = false;
let diaSalesSearch = '';
const NM_TEAM = ['kelly largent', 'sarah martin', 'scott briggs', 'nathanael berwaldt'];
let diaSalesPage = 0;
let diaSalesSort = { col: null, dir: 'desc' }; // column sort state
let diaSalesStateFilter = ''; // state filter
let diaFilteredSalesData = [];
const DIA_SALES_PAGE_SIZE = 50;

// Properties tab state — server-side paginated
let diaPropertiesData = null;        // current page rows only
let diaPropertiesTotalCount = 0;     // server-side filtered count
let diaPropertiesLoading = false;
let diaPropertiesSearch = '';
let diaPropertiesPage = 0;
let diaPropertiesSort = { col: 'address', dir: 'asc' };
let diaPropertiesStateFilter = '';
let diaPropertiesSummary = null;     // { states, withSFCount, avgSF, total }
let diaPropertiesRequestId = 0;      // race-condition guard
const DIA_PROPERTIES_PAGE_SIZE = 25;

// Pipeline/Ops Research Modes
let diaUnmatchedQueue = null;
let diaUnmatchedLoading = false;
let diaUnmatchedIdx = 0;
let diaQuarantineQueue = null;
let diaQuarantineLoading = false;
let diaQuarantineIdx = 0;
let diaClarificationQueue = null;
let diaClarificationLoading = false;
let diaClarificationIdx = 0;
let diaStalenessData = null;
let diaStalenessLoading = false;
let diaRunHealthData = null;
let diaRunHealthLoading = false;
// Round 76cx Phase 2: listing verification dashboard digest (single-row view).
let diaVerificationSummary = null;
let diaVerificationSummaryLoading = false;
let diaIntakeQueue = null;
let diaIntakeLoading = false;
let diaIntakeIdx = 0;

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
  const { filter, filter2, order, limit = 1000, offset = 0 } = params;

  const url = new URL('/api/dia-query', window.location.origin);
  url.searchParams.set('table', table);
  url.searchParams.set('select', select);
  if (filter) url.searchParams.set('filter', filter);
  if (filter2) url.searchParams.set('filter2', filter2);
  if (order) url.searchParams.set('order', order);
  if (limit !== undefined) url.searchParams.set('limit', limit);
  if (offset !== undefined) url.searchParams.set('offset', offset);
  // Skip count=exact by default — views compute from 1M+ row tables, count doubles query cost
  url.searchParams.set('count', 'false');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`diaQuery ${table}: HTTP ${response.status}`, errBody);
      return [];
    }

    const result = await response.json();
    return result.data || [];
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') { console.warn('diaQuery ' + table + ' timed out (30s)'); return []; }
    console.error('diaQuery error:', err);
    return [];
  }
}

// Paginated fetch — loops with offset to get ALL rows past PostgREST 1000-row cap
async function diaQueryAll(table, select, params = {}) {
  let all = [], offset = 0;
  const pageSize = 1000;
  const maxTime = 120000; // 2-minute total timeout
  const start = Date.now();
  while (true) {
    if (Date.now() - start > maxTime) {
      console.warn('diaQueryAll(' + table + ') total timeout after ' + Math.round((Date.now() - start) / 1000) + 's — returning ' + all.length + ' rows');
      break;
    }
    const rows = await diaQuery(table, select, { ...params, limit: pageSize, offset });
    all = all.concat(rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

// Single-page fetch with count — for server-side pagination
async function diaQueryPage(table, select, params = {}) {
  const { filter, filter2, order, limit = 25, offset = 0 } = params;
  const url = new URL('/api/dia-query', window.location.origin);
  url.searchParams.set('table', table);
  url.searchParams.set('select', select);
  if (filter) url.searchParams.set('filter', filter);
  if (filter2) url.searchParams.set('filter2', filter2);
  if (order) url.searchParams.set('order', order);
  url.searchParams.set('limit', limit);
  url.searchParams.set('offset', offset);
  // Don't set count=false — backend will send Prefer: count=exact for total row count

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      const errBody = await response.text();
      console.error('diaQueryPage ' + table + ': HTTP ' + response.status, errBody);
      return { data: [], count: 0 };
    }
    const result = await response.json();
    return { data: result.data || [], count: result.count || 0 };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') console.warn('diaQueryPage ' + table + ' timed out (30s)');
    else console.error('diaQueryPage error:', err);
    return { data: [], count: 0 };
  }
}

// ============================================================================
// SALES COMPS LOADER
// ============================================================================
// The Sales Comps table queries EXCLUSIVELY from sales_transactions joined
// with properties (and leases). The legacy v_sales_comps view mixed in entity
// metadata sales_history, which produced duplicate rows (e.g. deed date vs
// CoStar recordation date), conflicting prices/cap rates, and stale RBA/land
// area values. sales_transactions is the deduplicated authoritative source
// populated by the sidebar pipeline; properties holds the canonical RBA/land
// area; leases holds the current rent/expiration data.
async function loadDiaSalesCompsFromTxns() {
  // Embed properties (1:1) and leases (1:many). Use !inner on properties so
  // orphan sales without a property drop out — v_sales_comps filtered those
  // too. Leases are a left-side embed so sales on vacant/land parcels still
  // show up.
  // NOTE: sale_brokers loaded separately to avoid 3-level PostgREST embed
  // failures that silently return [] through the edge proxy.
  const select = [
    '*,',
    'properties!inner(property_id,address,city,state,zip_code,county,building_size,',
    'land_area,lot_sf,year_built,year_renovated,tenant,building_type,zoning,',
    'latitude,longitude,lease_bump_pct,lease_bump_interval_mo,',
    'leases(lease_id,tenant,leased_area,lease_start,lease_expiration,',
    'expense_structure,rent_per_sf,annual_rent,renewal_options,is_active,',
    'status,data_source,source_confidence))',
  ].join('');
  let all = [];
  for (let pg = 0; pg <= 20; pg++) {
    const batch = await diaQuery('sales_transactions', select, {
      order: 'sale_date.desc.nullslast',
      limit: 1000,
      offset: pg * 1000,
    });
    all = all.concat(batch || []);
    if (!batch || batch.length < 1000) break;
  }

  // Load sale_brokers separately and merge by sale_id
  let brokerMap = {};
  try {
    const sbSelect = 'sale_id,role,broker_id,brokers(broker_name,company)';
    let sbAll = [];
    for (let pg = 0; pg <= 5; pg++) {
      const batch = await diaQuery('sale_brokers', sbSelect, {
        limit: 1000, offset: pg * 1000,
      });
      sbAll = sbAll.concat(batch || []);
      if (!batch || batch.length < 1000) break;
    }
    sbAll.forEach(sb => {
      if (!brokerMap[sb.sale_id]) brokerMap[sb.sale_id] = [];
      brokerMap[sb.sale_id].push(sb);
    });
  } catch(e) { console.warn('sale_brokers load failed:', e.message); }

  return all.map(r => {
    r.sale_brokers = brokerMap[r.sale_id] || [];
    return normalizeSalesTxnRow(r);
  });
}

function pickCurrentLease(leases) {
  if (!Array.isArray(leases) || leases.length === 0) return null;
  const scored = leases.slice().sort((a, b) => {
    const aActive = (a.is_active === true || a.status === 'active') ? 1 : 0;
    const bActive = (b.is_active === true || b.status === 'active') ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aStart = a.lease_start || '';
    const bStart = b.lease_start || '';
    return bStart.localeCompare(aStart);
  });
  return scored[0] || null;
}

function extractBrokerCompanies(r) {
  // Extract broker company names from the sale_brokers embed
  const sbs = r.sale_brokers || [];
  const companies = [];
  sbs.forEach(sb => {
    if (sb.broker_companies && sb.broker_companies.name) companies.push(sb.broker_companies.name);
    else if (sb.brokers && sb.brokers.company) companies.push(sb.brokers.company);
  });
  return companies.join(', ');
}

function normalizeSalesTxnRow(r) {
  const p = r.properties || {};
  const lease = pickCurrentLease(p.leases || r.leases);

  const buildingSize = p.building_size != null ? Number(p.building_size) : null;
  const soldPrice    = r.sold_price    != null ? Number(r.sold_price)    : null;
  const pricePerSF   = (soldPrice && buildingSize && buildingSize > 0)
    ? soldPrice / buildingSize : null;

  const capRateRaw = r.cap_rate != null ? r.cap_rate
                   : r.calculated_cap_rate != null ? r.calculated_cap_rate
                   : r.stated_cap_rate;
  const capRate = capRateRaw != null ? Number(capRateRaw) : null;

  let termYrs = null;
  if (lease && lease.lease_expiration) {
    const exp = new Date(lease.lease_expiration);
    if (!isNaN(exp.getTime())) {
      termYrs = (exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 365.25);
    }
  }

  let bumps = null;
  if (p.lease_bump_pct != null && p.lease_bump_interval_mo) {
    const pct = Number(p.lease_bump_pct) * 100;
    bumps = pct.toFixed(pct >= 10 ? 0 : 2) + '% / ' + p.lease_bump_interval_mo + 'mo';
  }

  const annualRent = lease
    ? (lease.annual_rent != null ? Number(lease.annual_rent) : null)
    : null;
  const rentPsf = lease && lease.rent_per_sf != null ? Number(lease.rent_per_sf) : null;

  return {
    sale_id:           r.sale_id,
    property_id:       r.property_id || p.property_id || null,
    tenant_operator:   (lease && lease.tenant) || p.tenant || null,
    address:           p.address || null,
    city:              p.city    || null,
    state:             p.state   || null,
    land_area:         p.land_area != null ? Number(p.land_area) : null,
    year_built:        p.year_built || null,
    rba:               buildingSize,
    rent:              annualRent,
    rent_per_sf:       rentPsf,
    lease_expiration:  lease ? lease.lease_expiration : null,
    term_remaining_yrs: termYrs,
    expenses:          lease ? lease.expense_structure : null,
    bumps:             bumps,
    price:             soldPrice,
    price_per_sf:      pricePerSF,
    cap_rate:          capRate,
    sold_date:         r.sale_date || null,
    recorded_date:     r.recorded_date || null,
    seller:            r.seller_name || null,
    buyer:             r.buyer_name  || null,
    listing_broker:    r.listing_broker   || null,
    procuring_broker:  r.procuring_broker || null,
    broker_companies:  extractBrokerCompanies(r),
    bid_ask_spread:    null,
    dom:               null,
    transaction_type:  r.transaction_type || null,
    exclude_from_market_metrics: r.exclude_from_market_metrics === true,
    notes:             r.notes || null,
    data_source:       r.data_source || null,
  };
}

// ============================================================================
// HELPER FUNCTION: parseFloat without falsy coercion bug
// ============================================================================
/**
 * Safely parse float from element or string value, returning null for empty/zero values
 * Fixes the bug where parseFloat(val) || null converts valid 0 to null
 * @param {HTMLElement|string|any} el - Element with .value, string, or value to parse
 * @returns {number|null} - Parsed float or null if empty/NaN
 */
function _pf(el) { const v = (typeof el === 'string' ? el : el?.value)?.trim(); return v ? parseFloat(v) : null; }

/**
 * Safely parse a 4-digit year-built style value. Returns NULL for blank,
 * non-numeric, zero, negative, or out-of-range inputs so we never persist
 * year_built = 0 and never trip the DB CHECK constraint added in
 * sql/20260415_properties_year_built_null_zero.sql (valid range 1600–2100).
 * Mirrors parseYearSafe() in api/_handlers/sidebar-pipeline.js.
 * @param {HTMLElement|string|any} el
 * @returns {number|null}
 */
function _py(el) {
  const raw = (typeof el === 'string' ? el : el?.value);
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const num = parseInt(str, 10);
  if (isNaN(num) || num <= 0) return null;
  if (num < 1600 || num > 2100) return null;
  return num;
}

// ============================================================================
// DATA LOADING
// ============================================================================

/**
 * Load all dialysis data
 */
let _diaDataLoading = false;
async function loadDiaData() {
  if (_diaDataLoading) return;  // Prevent concurrent loads
  _diaDataLoading = true;

  // Show loading indicator
  const inner = document.getElementById('bizPageInner');
  if (inner) {
    inner.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading dialysis data...</p></div>';
  }

  var _diaLoadStart = Date.now();
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
      sfActivities: [],
      reconciliation: {}
    };
    
    // ── ALL QUERIES: Run everything in parallel (all independent) ──────────
    // Previously split into sequential Batch 1 → movers enrichment → Batch 2
    // Now merged into single Promise.all — cuts load time roughly in half
    var [freshness, invSummary, invChanges, moversUpRaw, moversDownRaw,
         npiSignalSummary, npiSignals, propQueue, leaseQueue, outcomes, recon,
         sfActivities
    ] = await Promise.all([
      diaQuery('v_counts_freshness', '*').catch(function(e) { console.warn('Freshness view timeout', e); return []; }),
      diaQuery('v_clinic_inventory_diff_summary', '*').catch(function(e) { console.warn('Inv summary timeout', e); return []; }),
      diaQueryAll('v_clinic_inventory_latest_diff', '*').catch(function(e) { console.warn('Inv changes timeout', e); return []; }),
      diaQuery('v_facility_patient_counts_mom', '*', { filter: 'delta_patients=gt.0', order: 'delta_patients.desc', limit: 10 }).catch(function() { return []; }),
      diaQuery('v_facility_patient_counts_mom', '*', { filter: 'delta_patients=lt.0', order: 'delta_patients.asc', limit: 10 }).catch(function() { return []; }),
      diaQuery('v_npi_inventory_signal_summary', '*').catch(function() { return []; }),
      diaQuery('v_npi_inventory_signals', '*', { limit: 5000 }).catch(function() { return []; }),
      diaQuery('v_clinic_property_link_review_queue', '*', { limit: 200 }).catch(function() { return []; }),
      diaQuery('v_clinic_lease_backfill_candidates', '*', { limit: 1000 }).catch(function() { return []; }),
      diaQuery('research_queue_outcomes', 'clinic_id,queue_type,status,assigned_to,assigned_at,created_at', { limit: 2000 }).catch(function() { return []; }),
      diaQuery('v_ingestion_reconciliation', '*', { limit: 1 }).catch(function() { return []; }),
      // Team touchpoints — query DIA Supabase directly so all team members are included
      diaQuery('salesforce_activities', 'assigned_to,activity_date,company_name', {
        filter: 'or(assigned_to.ilike.*largent*,assigned_to.ilike.*martin*,assigned_to.ilike.*briggs*,assigned_to.ilike.*berwaldt*)',
        order: 'activity_date.desc',
        limit: 5000
      }).catch(function() { return []; })
    ]);

    // Assign core data
    if (freshness && freshness.length > 0) diaData.freshness = freshness[0];
    if (invSummary && invSummary.length > 0) {
      invSummary.forEach(function(row) { diaData.inventorySummary[row.change_type] = row; });
    }
    diaData.inventoryChanges = invChanges || [];

    // Fallback: if v_counts_freshness returned empty, estimate from loaded data
    if (!diaData.freshness || !diaData.freshness.total_clinics) {
      const ic = diaData.inventoryChanges;
      const withCounts = ic.filter(function(c) { return c.latest_total_patients > 0; });
      diaData.freshness = {
        total_clinics: ic.length,
        clinics_with_counts: withCounts.length,
        coverage_pct: ic.length > 0 ? Math.round(withCounts.length / ic.length * 1000) / 10 : 0,
        _fallback: true
      };
    }

    // Assign NPI + research data
    if (npiSignalSummary && npiSignalSummary.length > 0) {
      npiSignalSummary.forEach(function(row) { diaData.npiSummary[row.signal_type] = row; });
    }
    diaData.npiSignals = npiSignals || [];
    diaData.propertyReviewQueue = propQueue || [];
    diaData.leaseBackfillRows = leaseQueue || [];
    diaData.researchOutcomes = outcomes || [];
    diaData.sfActivities = sfActivities || [];
    if (recon && recon.length > 0) {
      diaData.reconciliation = recon[0];
    }

    // Enrich movers with facility names.
    // Round 76eg (2026-04-29): v_facility_patient_counts_mom now inner-joins
    // medicare_clinics and exposes facility_name + city + state directly, so
    // the row already carries the name. We keep a secondary lookup as a
    // belt-and-suspenders fallback in case the view is rolled back, and we
    // also harvest names from inventoryChanges for any IDs the view missed.
    try {
      var nameMap = {};
      // Pre-seed from inventoryChanges (cheap — no extra round trip)
      (diaData.inventoryChanges || []).forEach(function(r) {
        if (r.clinic_id && r.facility_name) nameMap[r.clinic_id] = r.facility_name;
      });
      var allMovers = [].concat(moversUpRaw || [], moversDownRaw || []);
      // Take advantage of facility_name now riding along on the mom view rows.
      allMovers.forEach(function(r) {
        if (r && r.clinic_id && r.facility_name && !nameMap[r.clinic_id]) {
          nameMap[r.clinic_id] = r.facility_name;
        }
      });
      // Fallback: only look up the IDs we still don't have a name for.
      var unresolvedIds = allMovers
        .map(function(r) { return r && r.clinic_id; })
        .filter(function(id) { return id && !nameMap[id]; })
        .filter(function(v, i, a) { return a.indexOf(v) === i; });
      if (unresolvedIds.length > 0) {
        try {
          var nameRows = await diaQuery('medicare_clinics', 'medicare_id,facility_name', {
            filter: 'medicare_id=in.(' + unresolvedIds.join(',') + ')', limit: 50
          });
          (nameRows || []).forEach(function(r) { if (r.medicare_id) nameMap[r.medicare_id] = r.facility_name; });
        } catch (e) { console.warn('name lookup failed', e); }
      }
      var enrich = function(arr) {
        return (arr || []).map(function(r) {
          // Prefer the name already on the row (new view); fall back to map; only
          // synthesize "Clinic <id>" as a last resort. Round 76eg's view-side
          // INNER JOIN should make that fallback unreachable in practice.
          var name = (r && r.facility_name) || nameMap[r && r.clinic_id] || ('Clinic ' + (r && r.clinic_id));
          return Object.assign({}, r, { facility_name: name });
        });
      };
      diaData.moversUp = enrich(moversUpRaw);
      diaData.moversDown = enrich(moversDownRaw);
    } catch (e) {
      console.warn('Failed to enrich movers data', e);
      diaData.moversUp = [];
      diaData.moversDown = [];
    }
    
    diaDataLoaded = true;
    _diaDataLoading = false;
    console.debug('DIA DATA LOADED:', {
      freshness: diaData.freshness,
      invSummaryKeys: Object.keys(diaData.inventorySummary),
      inventoryChanges: diaData.inventoryChanges.length,
      npiSummaryKeys: Object.keys(diaData.npiSummary),
      npiSignals: diaData.npiSignals.length,
      propertyQueue: diaData.propertyReviewQueue.length,
      leaseBackfill: diaData.leaseBackfillRows.length,
      outcomes: diaData.researchOutcomes.length,
      sfActivities: diaData.sfActivities.length,
      recon: diaData.reconciliation
    });
    var _diaLoadSec = ((Date.now() - _diaLoadStart) / 1000).toFixed(1);
    showToast(`Dialysis: ${(diaData.freshness || {}).total_clinics || 0} clinics, ${diaData.inventoryChanges.length} changes, ${diaData.npiSignals.length} signals (${_diaLoadSec}s)`, 'success');
    // Only render if user is still viewing the dialysis tab
    if (typeof currentBizTab !== 'undefined' && currentBizTab === 'dialysis') renderDiaTab();
  } catch (err) {
    console.error('loadDiaData error:', err);
    _diaDataLoading = false;
    // Show error in the UI instead of just console
    const inner = document.getElementById('bizPageInner');
    if (inner) {
      inner.innerHTML = '<div style="text-align:center;padding:32px;color:var(--red)"><p style="font-size:16px;margin-bottom:8px">Failed to load dialysis data</p><p style="color:var(--text2);font-size:13px">' + esc(err.message || 'Unknown error') + '</p><button class="gov-btn" onclick="this.disabled=true;this.textContent=\'Loading\u2026\';loadDiaData()" style="margin-top:12px">Retry</button></div>';
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

  // Track tabs that benefit from anti-flicker rendering
  const useFlickerFix = currentDiaTab === 'research' || currentDiaTab === 'changes';

  switch (currentDiaTab) {
    case 'overview':
      inner.innerHTML = renderDiaOverview();
      break;
    case 'search':
      inner.innerHTML = renderDiaSearch();
      break;
    case 'changes':
      if (useFlickerFix && typeof smoothDOMUpdate === 'function') {
        smoothDOMUpdate(inner, renderDiaChanges());
      } else {
        inner.innerHTML = renderDiaChanges();
      }
      break;
    case 'npi':
      inner.innerHTML = renderDiaNpi();
      break;
    case 'properties':
      renderDiaProperties(); // async — renders directly to DOM
      return;
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
      if (useFlickerFix && typeof smoothDOMUpdate === 'function') {
        smoothDOMUpdate(inner, renderDiaResearch());
      } else {
        inner.innerHTML = renderDiaResearch();
      }
      break;
    case 'prospects':
      // Render dialysis-domain prospects from domain-classified opportunities
      if (typeof renderDomainProspects === 'function' && window._mktOpportunities) {
        renderDomainProspects('dialysis');
      } else {
        inner.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading prospects...</p></div>';
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

// Helper: navigate to a dia sub-tab with optional pre-filter
function goToDiaTab(tabName, preFilter) {
  // Apply pre-filter if provided (e.g. searching CMS tab for "added" clinics)
  if (preFilter && tabName === 'changes') {
    diaCmsSearch = preFilter;
    diaCmsPage = 0;
  }
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
  const { title, value, sub, trend, trendLabel, color, icon, tab, span, id, subId } = opts;
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
    <div${id ? ' id="' + id + '"' : ''} style="font-size:28px;font-weight:800;color:${c};line-height:1">${value}</div>
    ${sub != null ? `<div${subId ? ' id="' + subId + '"' : ''} style="font-size:11px;color:var(--text2);margin-top:4px">${sub}</div>` : ''}
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
        diaSalesComps = await loadDiaSalesCompsFromTxns();
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
        // Use v_available_listings view which JOINs property data (address, city, state)
        let all = [], pg = 0;
        while (true) {
          const batch = await diaQuery('v_available_listings', '*', {
            order: 'listing_date.desc.nullslast',
            limit: 1000, offset: pg * 1000,
            filter: 'status=in.(active,Active,Available,"For Sale")',
          });
          all = all.concat(batch || []);
          if (!batch || batch.length < 1000) break;
          pg++;
        }
        // Filter out blank records — require at least an address or operator
        diaAvailListings = all.filter(r =>
          (r.address && r.address.trim()) ||
          (r.tenant_operator && r.tenant_operator.trim()) ||
          (r.operator && r.operator.trim())
        );
        console.debug('Available listings loaded:', diaAvailListings.length, 'of', all.length, 'raw');
      } catch(e) { console.warn('Available listings load failed:', e.message); diaAvailListings = []; }
      const mktEl = document.getElementById('diaOverviewMarket');
      if (mktEl) mktEl.innerHTML = renderOnMarketInner();
    })();
  }

  // Lazy-load clinic financial estimates (paginated — ~20K rows with is_latest)
  // PostgREST max-rows caps at 1000 per request, so paginate at 1000
  if (!diaFinancialEstimates) {
    (async () => {
      try {
        // Load latest primary estimates (highest-confidence per clinic)
        const selectCols = 'medicare_id,estimate_source,estimated_annual_revenue,estimated_annual_profit,estimated_ebitda,estimated_operating_profit,patient_count,chairs_used,confidence_score';
        const PAGE = 1000;
        let all = [], pg = 0;
        while (true) {
          const batch = await diaQuery('clinic_financial_estimates', selectCols, {
            filter: 'is_latest=eq.true',
            limit: PAGE, offset: pg * PAGE,
          });
          all = all.concat(batch || []);
          if (!batch || batch.length < PAGE) break;
          pg++;
        }
        diaFinancialEstimates = all;
        // Debug source breakdown
        const srcDebug = {};
        all.forEach(e => { const s = e.estimate_source || '?'; srcDebug[s] = (srcDebug[s]||0)+1; });
        console.debug('Financial estimates loaded:', all.length, 'rows. By source:', JSON.stringify(srcDebug));
      } catch(e) { console.warn('Financial estimates load failed:', e.message); diaFinancialEstimates = []; }
      const finEl = document.getElementById('diaOverviewFinancials');
      if (finEl) finEl.innerHTML = renderFinancialMetricsInner();
    })();
  }

  // Lazy-load patient counts from v_facility_patient_counts_latest (8K+ clinics)
  // PostgREST max-rows caps at 1000, paginate accordingly
  if (!diaPatientCounts) {
    (async () => {
      try {
        const PAGE = 1000;
        let all = [], pg = 0;
        while (true) {
          const batch = await diaQuery('v_facility_patient_counts_latest', 'clinic_id,total_patients,state', {
            limit: PAGE, offset: pg * PAGE,
          });
          all = all.concat(batch || []);
          if (!batch || batch.length < PAGE) break;
          pg++;
        }
        // Deduplicate by normalized clinic_id (some appear with/without leading zeros)
        const seen = {};
        diaPatientCounts = all.filter(r => {
          if (!r.total_patients || r.total_patients <= 0) return false;
          const normId = r.clinic_id ? r.clinic_id.replace(/^0+/, '') : r.clinic_id;
          if (seen[normId]) return false;
          seen[normId] = true;
          return true;
        });
      } catch(e) { diaPatientCounts = []; }
      // Re-render the patient metrics section
      const ptEl = document.getElementById('diaOverviewPatientMetrics');
      if (ptEl) ptEl.innerHTML = renderPatientMetricsInner();
    })();
  }

  // Lazy-load ownership coverage metrics (Section 4b)
  (async () => {
    try {
      // 1. Ownership depth: properties with 3+ ownership records = deep chain (likely traced to developer)
      //    Also count properties with ANY ownership vs total properties with sales
      // Exclude CMS operator rows (notes LIKE 'CMS%') — those are tenant/operator data, not property ownership
      const ownHistory = await diaQueryAll('ownership_history', 'property_id', { filter: 'property_id=not.is.null', filter2: 'or=(notes.not.like.CMS*,notes.is.null)' });
      const ownRows = ownHistory.data || ownHistory || [];
      const depthByProp = {};
      ownRows.forEach(o => {
        if (!o.property_id) return;
        depthByProp[o.property_id] = (depthByProp[o.property_id] || 0) + 1;
      });
      const propsWithOwnership = Object.keys(depthByProp).length;
      const deepChains = Object.values(depthByProp).filter(d => d >= 3).length;

      // 2. Prospecting: true_owners with SF activity in last 180 days via ID join
      //    true_owners.salesforce_id is mostly Contact IDs (003*) with some Account IDs (001*)
      //    Join to salesforce_activities via sf_contact_id, sf_company_id, OR true_owner_id
      const owners = await diaQueryAll('true_owners', 'true_owner_id,name,salesforce_id');
      const ownerRows = owners.data || owners || [];
      const ownersWithSF = ownerRows.filter(o => o.salesforce_id);
      const cutoff180 = new Date(); cutoff180.setDate(cutoff180.getDate() - 180);
      const cutoffStr = cutoff180.toISOString().substring(0, 10);
      let recentActivityOwners = 0;
      if (ownersWithSF.length > 0) {
        // Pull recent activities with all linkable ID fields
        const recentActs = await diaQueryAll('salesforce_activities', 'sf_contact_id,sf_company_id,true_owner_id,activity_date', { filter: 'activity_date=gte.' + cutoffStr });
        const actRows = recentActs.data || recentActs || [];
        // Build sets of active IDs from all three link columns
        const activeSfIds = new Set();
        const activeTrueOwnerIds = new Set();
        actRows.forEach(a => {
          if (a.sf_contact_id) activeSfIds.add(a.sf_contact_id);
          if (a.sf_company_id) activeSfIds.add(a.sf_company_id);
          if (a.true_owner_id) activeTrueOwnerIds.add(a.true_owner_id);
        });
        recentActivityOwners = ownersWithSF.filter(o =>
          activeSfIds.has(o.salesforce_id) || activeTrueOwnerIds.has(o.true_owner_id)
        ).length;
      }

      // 3. Missing SF: owners without salesforce_id
      const totalOwners = ownerRows.length;
      const missingSF = ownerRows.filter(o => !o.salesforce_id).length;

      // ── Update DOM ──
      const _fmtPct = (n, d) => d > 0 ? Math.round(n / d * 100) + '%' : '—';
      const devEl = document.getElementById('diaOwnDevVal');
      const devSub = document.getElementById('diaOwnDevSub');
      if (devEl) devEl.textContent = _fmtPct(deepChains, propsWithOwnership);
      if (devSub) devSub.textContent = deepChains + ' of ' + propsWithOwnership + ' properties with 3+ ownership records';

      const prospEl = document.getElementById('diaOwnProspVal');
      const prospSub = document.getElementById('diaOwnProspSub');
      if (prospEl) prospEl.textContent = _fmtPct(recentActivityOwners, ownersWithSF.length);
      if (prospSub) prospSub.textContent = recentActivityOwners + ' active in 180d of ' + ownersWithSF.length + ' SF-linked groups';

      const missEl = document.getElementById('diaOwnMissVal');
      const missSub = document.getElementById('diaOwnMissSub');
      if (missEl) {
        missEl.textContent = _fmtPct(missingSF, totalOwners);
        missEl.style.color = missingSF > totalOwners * 0.5 ? '#f87171' : missingSF > totalOwners * 0.25 ? '#fbbf24' : '#34d399';
      }
      if (missSub) missSub.textContent = missingSF + ' of ' + totalOwners + ' groups missing Salesforce';
    } catch (err) {
      console.warn('Ownership coverage load failed:', err.message);
      const wrap = document.getElementById('diaOwnershipCoverage');
      if (wrap) wrap.innerHTML = '<div class="dia-info-card" style="padding:16px;color:var(--text3);font-size:12px">Ownership coverage data unavailable</div>';
    }
  })();

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

  // Compute patient stats from v_facility_patient_counts_latest (loaded async) or inventory diff as fallback
  const ptSrc = diaPatientCounts && diaPatientCounts.length > 0 ? diaPatientCounts : diaData.inventoryChanges.filter(c => c.latest_total_patients > 0);
  const clinicsWithPatients = diaPatientCounts && diaPatientCounts.length > 0 ? ptSrc : ptSrc;
  const totalPatients = ptSrc.reduce((s,c) => s + (c.total_patients || c.latest_total_patients || 0), 0);
  const avgPatients = ptSrc.length > 0 ? Math.round(totalPatients / ptSrc.length) : 0;

  // Touchpoint metrics from DIA Supabase salesforce_activities — full Northmarq IS team
  const diaActivities = diaData.sfActivities || [];
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
  // SECTION 0: ACTIONABLE HIGHLIGHTS (Round 54)
  // Auto-populated from live data — what needs your attention right now
  // ═══════════════════════════════════════════════
  const diaHighlights = [];

  // Highlight 1: NPI signals need review
  if (npiSignalCount > 0) {
    diaHighlights.push({
      icon: '📡', color: '#fb923c', urgency: 'warning',
      title: npiSignalCount + ' NPI signal' + (npiSignalCount > 1 ? 's' : '') + ' need review',
      detail: 'Provider changes detected — potential ownership transitions or closures',
      action: 'Review Signals', tab: 'npi'
    });
  }

  // Highlight 2: Property review queue backlog
  if (propQueueLen > 10) {
    diaHighlights.push({
      icon: '🔗', color: '#a78bfa', urgency: 'info',
      title: propQueueLen + ' clinic' + (propQueueLen > 1 ? 's' : '') + ' in property review queue',
      detail: 'Unlinked clinics need property matching for lease + ownership data',
      action: 'Start Review', tab: 'research'
    });
  }

  // Highlight 3: Lease backfill needed
  if (leaseBackfillLen > 20) {
    diaHighlights.push({
      icon: '📋', color: '#22d3ee', urgency: 'info',
      title: leaseBackfillLen + ' clinic' + (leaseBackfillLen > 1 ? 's' : '') + ' need lease backfill',
      detail: 'Missing lease data — prioritize high-value clinics',
      action: 'Backfill Leases', tab: 'research'
    });
  }

  // Highlight 4: Clinics removed from CMS (closures)
  if (removedCount > 0) {
    diaHighlights.push({
      icon: '🚨', color: '#f87171', urgency: 'urgent',
      title: removedCount + ' clinic' + (removedCount > 1 ? 's' : '') + ' removed from CMS inventory',
      detail: 'Potential closures — check for acquisition or disposition opportunities',
      action: 'View Changes', tab: 'changes'
    });
  }

  // Highlight 5: New clinics added
  if (addedCount > 0) {
    diaHighlights.push({
      icon: '🆕', color: '#34d399', urgency: 'info',
      title: addedCount + ' new clinic' + (addedCount > 1 ? 's' : '') + ' added to CMS inventory',
      detail: 'New facilities — may need property linking and operator research',
      action: 'View New Clinics', tab: 'changes', preFilter: 'added'
    });
  }

  if (diaHighlights.length > 0) {
    html += '<div style="margin-bottom:20px">';
    html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:10px;padding-left:2px">Action Items</div>';
    for (const h of diaHighlights.slice(0, 5)) {
      const borderColor = h.urgency === 'urgent' ? h.color : h.urgency === 'warning' ? h.color : 'var(--border)';
      const _pf = h.preFilter ? ",'" + h.preFilter + "'" : '';
      html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;margin-bottom:6px;background:var(--s2);border-radius:10px;border-left:3px solid ' + borderColor + ';cursor:pointer" onclick="goToDiaTab(\'' + h.tab + '\'' + _pf + ')">';
      html += '<span style="font-size:20px;flex-shrink:0">' + h.icon + '</span>';
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-size:13px;font-weight:600;color:var(--text)">' + esc(h.title) + '</div>';
      html += '<div style="font-size:12px;color:var(--text3);margin-top:2px">' + esc(h.detail) + '</div>';
      html += '</div>';
      html += '<button class="gov-row-action accent" onclick="event.stopPropagation();goToDiaTab(\'' + h.tab + '\'' + _pf + ')" style="flex-shrink:0">' + esc(h.action) + '</button>';
      html += '</div>';
    }
    html += '</div>';
  }

  // ═══════════════════════════════════════════════
  // SECTION 1: DATABASE HEALTH
  // ═══════════════════════════════════════════════
  html += sectionHeader('Database Health', '🏥', 'search');
  if (f._fallback) {
    html += '<div style="font-size:11px;color:var(--text3);margin-bottom:8px;padding:6px 10px;background:var(--s2);border-radius:6px;border-left:3px solid #fbbf24">⚠ View not available — using estimates from inventory data (' + fmtN(totalClinics) + ' clinics loaded)</div>';
  }
  html += '<div class="dia-grid dia-grid-4">';
  html += infoCard({ title: 'Total Clinics', value: fmtN(totalClinics), sub: f._fallback ? 'from inventory data' : 'tracked nationwide', color: 'blue', tab: 'search' });
  html += infoCard({ title: 'Data Coverage', value: coveragePct.toFixed(1) + '%', sub: fmtN(clinicsWithCounts) + ' clinics with patient data', color: coveragePct > 50 ? 'green' : 'yellow', tab: 'search' });
  html += infoCard({ title: 'Property Linked', value: linkedPct + '%', sub: fmtN(totalClinics - propQueueLen) + ' of ' + fmtN(totalClinics) + ' matched', color: 'cyan', tab: 'research' });
  html += infoCard({ title: 'Lease Coverage', value: leaseBackfillPct + '%', sub: fmtN(leaseBackfillLen) + ' need backfill', color: 'purple', tab: 'research' });
  html += '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 2: CLINICAL METRICS
  // ═══════════════════════════════════════════════
  html += sectionHeader('Clinical Metrics', '📊', 'changes');
  html += '<div id="diaOverviewPatientMetrics">' + renderPatientMetricsInner() + '</div>';
  html += '<div class="dia-grid dia-grid-4" style="margin-top:10px">';
  html += infoCard({ title: 'Inventory Changes', value: fmtN(addedCount + removedCount), sub: '+' + fmtN(addedCount) + ' added · -' + fmtN(removedCount) + ' removed', color: addedCount > removedCount ? 'green' : 'red', tab: 'changes' });
  html += infoCard({ title: 'NPI Signals', value: fmtN(npiSignalCount), sub: 'provider changes detected', color: 'orange', tab: 'npi' });
  html += infoCard({ title: 'Top Mover', value: diaData.moversUp?.[0] ? '+' + fmtN(diaData.moversUp[0].delta_patients) : '—', sub: diaData.moversUp?.[0] ? norm(diaData.moversUp[0].facility_name && diaData.moversUp[0].facility_name !== 'null' ? diaData.moversUp[0].facility_name : diaData.moversUp[0].clinic_name || diaData.moversUp[0].address || 'Unknown Clinic').substring(0,30) : 'no data', color: 'green', tab: 'changes' });
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
      <div style="flex:1;font-size:11px;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(norm(r.facility_name && !(/\bnull\b/i.test(r.facility_name)) ? r.facility_name : r.clinic_name && !(/\bnull\b/i.test(r.clinic_name)) ? r.clinic_name : r.address || 'Unknown Clinic').substring(0,25))}</div>
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
      <div style="flex:1;font-size:11px;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(norm(r.facility_name && !(/\bnull\b/i.test(r.facility_name)) ? r.facility_name : r.clinic_name && !(/\bnull\b/i.test(r.clinic_name)) ? r.clinic_name : r.address || 'Unknown Clinic').substring(0,25))}</div>
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
    const lastName = name.split(' ').pop();
    const memberActs = diaActivities.filter(a => (a.assigned_to || '').toLowerCase().includes(lastName));
    const ytd = memberActs.filter(a => a.activity_date && new Date(a.activity_date) >= yearStart).length;
    const displayName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    html += infoCard({ title: displayName, value: fmtN(ytd), sub: 'YTD touchpoints', color: memberColors[name] || 'blue', tab: 'activity' });
  });
  html += '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 4b: OWNERSHIP COVERAGE REPORTING
  // ═══════════════════════════════════════════════
  html += sectionHeader('Ownership Coverage', '🏛️', 'sales');
  html += '<div id="diaOwnershipCoverage"><div class="dia-grid dia-grid-3">';
  html += infoCard({ title: 'Ownership Depth', value: '...', sub: 'loading ownership data', color: 'blue', id: 'diaOwnDevVal', subId: 'diaOwnDevSub' });
  html += infoCard({ title: 'SF Prospecting', value: '...', sub: 'loading activity data', color: 'green', id: 'diaOwnProspVal', subId: 'diaOwnProspSub' });
  html += infoCard({ title: 'Missing SF Link', value: '...', sub: 'loading salesforce data', color: 'red', id: 'diaOwnMissVal', subId: 'diaOwnMissSub' });
  html += '</div></div>';

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
    var brokers = ((r.listing_broker||'')+(r.procuring_broker||'')+(r.broker_name||'')+(r.seller_broker||'')+(r.buyer_broker||'')+(r.broker_companies||'')).toLowerCase();
    if (brokers.includes('northmarq') || brokers.includes('north marq') || brokers.includes('nm capital')) return true;
    return NM_TEAM.some(name => { var parts = name.split(' '); return parts.some(p => p.length > 3 && brokers.includes(p)); });
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
  h += infoCard({ title: 'Seller Value Add', value: capAdvStr, sub: capAdv != null && Number(capAdv) > 0 ? 'tighter caps = higher proceeds' : 'vs market average', color: capAdv != null && Number(capAdv) > 0 ? 'green' : 'yellow', tab: 'sales' });
  h += '</div>';
  return h;
}

function renderOnMarketInner() {
  if (!diaAvailListings) {
    return '<div class="dia-grid dia-grid-4"><div class="dia-info-card" style="grid-column:span 4;text-align:center;padding:24px"><span class="spinner"></span><div style="margin-top:8px;font-size:12px;color:var(--text2)">Loading listings...</div></div></div>';
  }
  // Round 76cx Phase 2: kick off lazy load of the verification digest the
  // first time the on-market dashboard renders. Fire-and-forget; the card
  // shows "Loading verification digest…" until the data arrives, then a
  // re-render fills in the counts.
  if (!diaVerificationSummary && !diaVerificationSummaryLoading) {
    loadDiaVerificationSummary();
  }
  const listings = diaAvailListings;

  // Filter stale listings — anything listed before 2023 is almost certainly no longer on market
  const cutoff = new Date('2023-01-01');
  const recentListings = listings.filter(r => {
    if (!r.listing_date) return true; // keep listings without a date (benefit of the doubt)
    return new Date(r.listing_date) >= cutoff;
  });
  const staleCount = listings.length - recentListings.length;

  // Check multiple possible field names for price, cap rate, and days on market
  const getPrice = r => parseFloat(r.ask_price || r.asking_price || r.listing_price || r.price || 0);
  // Cap rates are standardized as decimals in DB (0.065 = 6.5%) — convert to display pct
  const getCapNorm = r => {
    const raw = parseFloat(r.ask_cap || r.asking_cap_rate || r.cap_rate || 0);
    if (!raw || raw <= 0) return 0;
    // DB normalized to decimal (2026-04-17). Convert to display percentage.
    return raw < 1 ? raw * 100 : raw;  // safety: if somehow still whole pct, pass through
  };
  const getDom = r => parseInt(r.dom || r.days_on_market || 0, 10);
  const withPrice = recentListings.filter(r => getPrice(r) > 0);
  // Filter to reasonable cap rates: 3%-15% for dialysis properties
  const validCaps = recentListings.map(r => getCapNorm(r)).filter(v => v >= 3 && v <= 15).sort((a,b) => a-b);
  const avgAskCap = validCaps.length > 0 ? (validCaps.reduce((s,v)=>s+v,0)/validCaps.length).toFixed(2) + '%' : '—';
  const q1Idx = Math.floor(validCaps.length * 0.25);
  const q3Idx = Math.floor(validCaps.length * 0.75);
  const lowerQ = validCaps.length > 4 ? validCaps[q1Idx].toFixed(2)+'%' : '—';
  const upperQ = validCaps.length > 4 ? validCaps[q3Idx].toFixed(2)+'%' : '—';
  const avgDom = recentListings.filter(r => getDom(r) > 0);
  const avgDomVal = avgDom.length > 0 ? Math.round(avgDom.reduce((s,r)=>s+getDom(r),0)/avgDom.length) : '—';
  const isNMListing = r => {
    var b = ((r.listing_broker||'')+(r.broker_name||'')+(r.broker_companies||'')).toLowerCase();
    if (b.includes('northmarq') || b.includes('north marq') || b.includes('nm capital')) return true;
    return NM_TEAM.some(name => { var parts = name.split(' '); return parts.some(p => p.length > 3 && b.includes(p)); });
  };
  const nmListings = recentListings.filter(isNMListing);

  let h = '<div class="dia-grid dia-grid-5">';
  const staleSub = staleCount > 0 ? recentListings.length + ' recent · ' + staleCount + ' stale excluded' : 'clinics on market';
  h += infoCard({ title: 'Active Listings', value: fmtN(recentListings.length), sub: staleSub, color: 'blue', tab: 'sales' });
  h += infoCard({ title: 'Avg Ask Cap', value: avgAskCap, sub: fmtN(validCaps.length) + ' with cap data', color: 'cyan', tab: 'sales' });
  h += infoCard({ title: 'Lower Quartile', value: lowerQ, sub: '25th pctl ask cap', color: 'purple', tab: 'sales' });
  h += infoCard({ title: 'Upper Quartile', value: upperQ, sub: '75th pctl ask cap', color: 'yellow', tab: 'sales' });
  h += infoCard({ title: 'NM On Market', value: fmtN(nmListings.length), sub: 'Northmarq listings', color: 'green', tab: 'sales' });
  h += '</div>';

  // Additional row
  h += '<div class="dia-grid dia-grid-4" style="margin-top:10px">';
  const avgAskPrice = withPrice.length > 0 ? '$' + fmtN(Math.round(withPrice.reduce((s,r)=>s+getPrice(r),0)/withPrice.length)) : '—';
  h += infoCard({ title: 'Avg Ask Price', value: avgAskPrice, sub: fmtN(withPrice.length) + ' priced', color: 'blue', tab: 'sales' });
  h += infoCard({ title: 'Avg Days on Market', value: avgDomVal, sub: fmtN(avgDom.length) + ' with dates', color: 'yellow', tab: 'sales' });
  h += infoCard({ title: 'NM Market Share', value: recentListings.length > 0 ? (nmListings.length/recentListings.length*100).toFixed(1)+'%' : '—', sub: 'of active listings', color: 'green', tab: 'sales' });
  // Round 76cx Phase 2: verification status card
  h += renderListingVerificationCard();
  h += '</div>';
  return h;
}

function renderPatientMetricsInner() {
  const ptSrc = diaPatientCounts && diaPatientCounts.length > 0 ? diaPatientCounts : null;
  if (!ptSrc) {
    // Fallback to inventory diff while loading
    const inv = (typeof diaData !== 'undefined' && diaData.inventoryChanges) ? diaData.inventoryChanges.filter(c => c.latest_total_patients > 0) : [];
    const total = inv.reduce((s,c) => s + (c.latest_total_patients || 0), 0);
    const avg = inv.length > 0 ? Math.round(total / inv.length) : 0;
    const loading = !diaPatientCounts; // null means still loading
    return '<div class="dia-grid dia-grid-4">' +
      infoCard({ title: 'Avg Patients / Clinic', value: loading ? '...' : fmtN(avg), sub: loading ? 'loading full patient data...' : fmtN(total) + ' total across ' + fmtN(inv.length) + ' clinics', color: 'blue', tab: 'changes' }) +
      '</div>';
  }
  const total = ptSrc.reduce((s,c) => s + (c.total_patients || 0), 0);
  const avg = ptSrc.length > 0 ? Math.round(total / ptSrc.length) : 0;
  // Estimate concurrent census — CMS total_patients is annual treated (includes turnover).
  // Published ESRD prevalence ~577K. Scale by ratio of our clinic count to CMS universe (~7,800).
  const estConcurrent = Math.round(577000 * (ptSrc.length / 7800));
  const estConcurrentAvg = ptSrc.length > 0 ? Math.round(estConcurrent / ptSrc.length) : 0;
  // State breakdown for top 5
  const byState = {};
  ptSrc.forEach(c => { const st = c.state || '??'; byState[st] = (byState[st] || 0) + (c.total_patients || 0); });
  const topStates = Object.entries(byState).sort((a,b) => b[1] - a[1]).slice(0, 5);
  const statesSub = topStates.map(([st, cnt]) => st + ': ' + fmtN(cnt)).join(' · ');
  return '<div class="dia-grid dia-grid-4">' +
    infoCard({ title: 'Avg Patients / Clinic', value: fmtN(avg), sub: fmtN(total) + ' annual treated · ~' + fmtN(estConcurrentAvg) + ' concurrent est.', color: 'blue', tab: 'changes' }) +
    infoCard({ title: 'Clinics Reporting', value: fmtN(ptSrc.length), sub: 'from CMS patient counts (deduped)', color: 'green', tab: 'changes' }) +
    infoCard({ title: 'Annual Treated', value: fmtN(total), sub: '~' + fmtN(estConcurrent) + ' est. concurrent (ESRD prev.)', color: 'purple', tab: 'changes' }) +
    renderTopStatesRankedCard(topStates) +
    '</div>';
}

function renderTopStatesRankedCard(topStates) {
  // Round 76cv: ranked-list card matching Top 5 Movers visual treatment.
  // Avoids the giant-letter hero + comma-separated tail look that felt
  // visually inconsistent with the rest of the Clinical Metrics row.
  if (!topStates || topStates.length === 0) {
    return '<div class="dia-info-card" onclick="goToDiaTab(\'changes\')" style="cursor:pointer;padding:14px 16px;color:var(--text3);font-size:11px">No state data</div>';
  }
  const maxCount = topStates[0][1] || 1;
  let h = '<div class="dia-info-card" onclick="goToDiaTab(\'changes\')" style="cursor:pointer;padding:14px 16px">';
  h += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">Top States</div>';
  topStates.forEach(([st, cnt], i) => {
    const barW = Math.round((cnt / maxCount) * 100);
    h += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <div style="width:20px;font-size:10px;color:var(--text3);text-align:right">${i+1}</div>
      <div style="flex:1;font-size:11px;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${st}</div>
      <div style="width:80px;flex-shrink:0;height:8px;background:var(--s3);border-radius:4px;overflow:hidden"><div style="width:${barW}%;height:100%;background:#22d3ee;border-radius:4px"></div></div>
      <div style="width:50px;font-size:10px;color:#22d3ee;text-align:right;font-weight:600">${fmtN(cnt)}</div>
    </div>`;
  });
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

  const totalClinicUniverse = typeof diaData !== 'undefined' && diaData.freshness?.total_clinics > 0
    ? diaData.freshness.total_clinics : 0;
  const coveragePct = best.length > 0 && totalClinicUniverse > 0
    ? (best.length / totalClinicUniverse * 100).toFixed(1) : '—';
  const coverageSub = totalClinicUniverse > 0
    ? fmtN(best.length) + ' of ' + fmtN(totalClinicUniverse) + ' clinics (' + coveragePct + '%)'
    : fmtN(best.length) + ' clinics estimated';

  let h = '<div class="dia-grid dia-grid-5">';
  h += infoCard({ title: 'Clinics Estimated', value: fmtN(best.length), sub: coverageSub, color: 'blue', tab: 'search' });
  h += infoCard({ title: 'Avg Revenue / Clinic', value: '$' + fmtN(Math.round(avgRev / 1000)) + 'K', sub: fmtN(withRev.length) + ' with revenue data', color: 'green', tab: 'search' });
  h += infoCard({ title: 'Avg Profit / Clinic', value: '$' + fmtN(Math.round(avgProfit / 1000)) + 'K', sub: avgMargin + '% avg margin', color: 'cyan', tab: 'search' });
  h += infoCard({ title: 'Avg EBITDA', value: '$' + fmtN(Math.round(avgEbitda / 1000)) + 'K', sub: fmtN(withEbitda.length) + ' with EBITDA', color: 'purple', tab: 'search' });
  h += infoCard({ title: 'Industry Revenue', value: '$' + fmtN(Math.round(totalRev / 1e9)) + 'B', sub: 'est. across ' + fmtN(withRev.length) + ' clinics', color: 'yellow', tab: 'search' });
  h += '</div>';

  // Source breakdown row
  h += '<div class="dia-grid dia-grid-4" style="margin-top:10px">';
  const srcLabels = { ttm_reported: 'TTM Reported', cms_patient_count: 'CMS Patient Count', google_hours: 'Google Hours', cms_chair_count: 'CMS Chair Count', '10k_filing': '10-K Filing' };
  const srcColors = { ttm_reported: 'green', cms_patient_count: 'blue', google_hours: 'cyan', cms_chair_count: 'yellow', '10k_filing': 'orange' };
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
  const upLabels = (diaData.moversUp || []).map(r => norm(r.facility_name || '').substring(0, 20));
  const upValues = (diaData.moversUp || []).map(r => r.delta_patients);
  const downLabels = (diaData.moversDown || []).map(r => norm(r.facility_name || '').substring(0, 20));
  const downValues = (diaData.moversDown || []).map(r => Math.abs(r.delta_patients));
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
        // Fetch CMS base data
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
        // Fetch rankings data (payor mix, quality, margin) and merge by medicare_id → clinic_id
        try {
          let rankings = [], rOff = 0;
          while (true) {
            const rb = await diaQuery('v_property_rankings', 'medicare_id,payer_mix_medicare_pct,payer_mix_medicaid_pct,payer_mix_private_pct,star_rating,deficiency_count,ttm_operating_margin,ttm_revenue,ttm_operating_costs,ttm_operating_profit,ttm_total_treatments,ttm_medicare_treatments,ttm_commercial_treatments,revenue_calc_method,profit_nonprofit', {
              limit: 1000, offset: rOff
            });
            rankings = rankings.concat(rb || []);
            if (!rb || rb.length < 1000) break;
            rOff += 1000;
          }
          const rankMap = {};
          rankings.forEach(r => { if (r.medicare_id) rankMap[r.medicare_id] = r; });
          all.forEach(row => {
            const rk = rankMap[row.clinic_id];
            if (rk) {
              row.payer_mix_medicare_pct = rk.payer_mix_medicare_pct;
              row.payer_mix_medicaid_pct = rk.payer_mix_medicaid_pct;
              row.payer_mix_private_pct = rk.payer_mix_private_pct;
              row.star_rating = rk.star_rating;
              row.deficiency_count = rk.deficiency_count;
              row.ttm_operating_margin = rk.ttm_operating_margin != null ? Number(rk.ttm_operating_margin) * 100 : null;
              row.ttm_revenue = rk.ttm_revenue;
              row.ttm_operating_costs = rk.ttm_operating_costs;
              row.ttm_operating_profit = rk.ttm_operating_profit;
              row.ttm_total_treatments = rk.ttm_total_treatments;
              row.ttm_medicare_treatments = rk.ttm_medicare_treatments;
              row.ttm_commercial_treatments = rk.ttm_commercial_treatments;
              row.revenue_calc_method = rk.revenue_calc_method;
              row.profit_nonprofit = rk.profit_nonprofit;
            }
          });
          console.log('[CMS] Merged rankings for', Object.keys(rankMap).length, 'clinics');
        } catch (re) {
          console.warn('Rankings merge skipped:', re.message);
        }
        diaCmsData = all;
      } catch (e) {
        console.error('CMS data load error:', e);
        showToast('CMS data load failed', 'error');
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
    // Virtual columns for computed payor mix values
    const _virtualGetter = col === '_medicare_pct' ? r => { const v = r.payer_mix_medicare_pct != null ? Number(r.payer_mix_medicare_pct) : r.payer_mix_medicare != null ? (Number(r.payer_mix_medicare) <= 1 ? Number(r.payer_mix_medicare) * 100 : Number(r.payer_mix_medicare)) : null; return v; }
      : col === '_medicaid_pct' ? r => { const v = r.payer_mix_medicaid_pct != null ? Number(r.payer_mix_medicaid_pct) : r.payer_mix_medicaid != null ? (Number(r.payer_mix_medicaid) <= 1 ? Number(r.payer_mix_medicaid) * 100 : Number(r.payer_mix_medicaid)) : null; return v; }
      : col === '_private_pct' ? r => { const v = r.payer_mix_private_pct != null ? Number(r.payer_mix_private_pct) : r.payer_mix_commercial != null ? (Number(r.payer_mix_commercial) <= 1 ? Number(r.payer_mix_commercial) * 100 : Number(r.payer_mix_commercial)) : null; return v; }
      : null;
    filtered = [...filtered].sort((a, b) => {
      let va = _virtualGetter ? _virtualGetter(a) : a[col];
      let vb = _virtualGetter ? _virtualGetter(b) : b[col];
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

  // Payor mix helper: normalize decimal (0-1) vs pct (0-100) formats
  const payerPct = (row, field, fieldPct) => {
    if (row[fieldPct] != null) return Number(row[fieldPct]);
    if (row[field] != null) { const v = Number(row[field]); return v <= 1 ? v * 100 : v; }
    return null;
  };
  const avgMedicarePct = avg(filtered, r => payerPct(r, 'payer_mix_medicare', 'payer_mix_medicare_pct'));
  const avgMedicaidPct = avg(filtered, r => payerPct(r, 'payer_mix_medicaid', 'payer_mix_medicaid_pct'));
  const avgPrivatePct = avg(filtered, r => payerPct(r, 'payer_mix_commercial', 'payer_mix_private_pct'));
  const avgMargin = avg(filtered, r => r.ttm_operating_margin);
  const avgStarRating = avg(filtered, r => r.star_rating);

  let html = '<div class="biz-section">';

  // === Action guidance banner ===
  html += '<div style="padding:10px 14px;background:rgba(96,165,250,0.08);border-radius:8px;border-left:3px solid #60a5fa;margin-bottom:12px;display:flex;align-items:center;gap:10px;">';
  html += '<div style="font-size:13px;color:var(--text);line-height:1.4"><strong>CMS Clinic Data</strong> — Browse the latest CMS enrollment data with payor mix, financials, and quality ratings. <strong>Flag</strong> clinics worth researching further. Click any row for full property details. <button onclick="document.getElementById(\'cmsMethodPanel\').style.display=document.getElementById(\'cmsMethodPanel\').style.display===\'none\'?\'block\':\'none\'" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:12px;font-weight:600;text-decoration:underline;padding:0;margin-left:4px">Data Sources & Methodology ▾</button></div>';
  html += '</div>';

  // === Methodology & Assumptions Panel (collapsible) ===
  html += '<div id="cmsMethodPanel" style="display:none;margin-bottom:16px;border:1px solid var(--border);border-radius:10px;background:var(--s1);padding:16px 20px;font-size:12px;line-height:1.6;color:var(--text2)">';
  html += '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:10px">Data Sources & Methodology</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';

  // Left column — Reported Data
  html += '<div>';
  html += '<div style="font-weight:700;color:var(--text);margin-bottom:6px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">✅ CMS-Reported Data (Direct from Source)</div>';
  html += '<div style="margin-bottom:8px"><strong style="color:var(--text)">Patient Counts</strong> — Reported by CMS Medicare enrollment data. Updated monthly as CMS publishes new Dialysis Facility Compare datasets. IC Patients and Home Patients are enrollment-based counts, not census.</div>';
  html += '<div style="margin-bottom:8px"><strong style="color:var(--text)">Payor Mix (Medicare %, Medicaid %, Private/Comm %)</strong> — Derived from CMS claims data via the property rankings model. Reflects the share of patients by primary insurance type. Coverage: ~7% of clinics have payor mix data. Percentages may not sum to 100% due to dual-eligible patients (e.g., Medicare + Medicaid) being counted in both categories. Clinics showing "–" have no payor mix data available from CMS.</div>';
  html += '<div style="margin-bottom:8px"><strong style="color:var(--text)">Star Rating</strong> — CMS 5-Star Quality Rating from Dialysis Facility Compare. Composite measure of clinical outcomes (mortality, hospitalization, transfusion) and patient experience surveys. Updated by CMS quarterly.</div>';
  html += '<div style="margin-bottom:8px"><strong style="color:var(--text)">Modality Type</strong> — CMS-designated treatment modality: In-Center (IC), Home, or Hybrid (offering both). Based on CMS certification data.</div>';
  html += '<div><strong style="color:var(--text)">Facility Name, Location, Operator</strong> — CMS Provider Enrollment data cross-referenced with chain organization filings.</div>';
  html += '</div>';

  // Right column — Estimated Data
  html += '<div>';
  html += '<div style="font-weight:700;color:var(--text);margin-bottom:6px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">⚙️ Estimated / Calculated Figures</div>';
  html += '<div style="margin-bottom:8px"><strong style="color:var(--text)">Revenue (IC Rev, Home Rev, TTM Rev)</strong> — Estimated using a blended reimbursement model: Medicare patients × ~$290/treatment × 3 treatments/week × 52 weeks, plus commercial patients at 1.4× Medicare rate, plus Medicaid at 0.85× Medicare rate. Home patients use a separate home-therapy rate (~$260/treatment). These are annualized estimates, not audited financials.</div>';
  html += '<div style="margin-bottom:8px"><strong style="color:var(--text)">EBITDA</strong> — Estimated by applying an operating cost per-treatment assumption (~$245 for IC, ~$220 for home) to estimated treatment counts, then subtracting from estimated revenue. Industry-standard margin benchmarks (10–18%) are used as sanity checks. Not derived from operator financial statements.</div>';
  html += '<div style="margin-bottom:8px"><strong style="color:var(--text)">Operating Margin</strong> — Calculated as (TTM Revenue − Estimated Operating Costs) ÷ TTM Revenue × 100. Coverage: ~97% of clinics. Color-coded: <span style="color:#34d399;font-weight:600">green ≥ 12%</span>, <span style="color:#fbbf24;font-weight:600">yellow 0–12%</span>, <span style="color:#f87171;font-weight:600">red < 0%</span>. Based on estimated revenue and cost models, not reported margins.</div>';
  html += '<div><strong style="color:var(--text)">Treatment Counts</strong> — Estimated from patient counts × 3 treatments/week (standard in-center protocol). Actual treatment frequency varies by patient acuity and modality. Home patients average fewer weekly treatments (~2.5/week for PD, variable for home HD).</div>';
  html += '</div>';

  html += '</div>'; // grid

  // Key caveats
  html += '<div style="margin-top:12px;padding:10px 14px;background:rgba(251,191,36,0.08);border-radius:6px;border-left:3px solid #fbbf24;font-size:11px;color:var(--text2);line-height:1.5">';
  html += '<strong style="color:var(--text)">Important for Client Conversations:</strong> All revenue and EBITDA figures are modeling estimates based on CMS enrollment data and published reimbursement rates — they are not audited financials. Payor mix percentages and star ratings are CMS-reported. When discussing with buyers or prospects, clearly distinguish: "CMS reports X Medicare patients" vs. "We estimate Y in annual revenue based on published reimbursement rates." Actual facility financials may differ due to contract rates, case mix, ancillary services, and operational efficiency.';
  html += '</div>';

  html += '</div>'; // cmsMethodPanel

  // === Dynamic average cards — Row 1: Volume & Financial ===
  html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:8px">';
  html += _cmsAvgCard('Clinics', fmtN(n) + '<div style="font-size:9px;color:var(--text3);margin-top:2px">' + cntIC + ' IC · ' + cntHybrid + ' Hyb · ' + cntHome + ' Home</div>', '#60a5fa');
  html += _cmsAvgCard('Avg In-Center Pts', avgICPts != null ? Math.round(avgICPts).toLocaleString() : '–', '#34d399');
  html += _cmsAvgCard('Avg Home Pts', avgHomePts != null ? Math.round(avgHomePts).toLocaleString() : '–', '#a78bfa');
  html += _cmsAvgCard('Avg Revenue', avgRevenue != null ? '$' + (avgRevenue / 1000000).toFixed(1) + 'M' : '–', '#fb923c');
  html += _cmsAvgCard('Avg EBITDA', avgEbitda != null ? '$' + Math.round(avgEbitda / 1000).toLocaleString() + 'K' : '–', '#f87171');
  html += _cmsAvgCard('Est Total Rev', totalEstRevenue > 0 ? '$' + (totalEstRevenue / 1000000000).toFixed(2) + 'B' : '–', '#22d3ee');
  html += '</div>';
  // === Row 2: Payor Mix & Quality (averages across filtered set) ===
  html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px">';
  html += _cmsAvgCard('Avg Medicare %', avgMedicarePct != null ? avgMedicarePct.toFixed(1) + '%' : '–', '#3b82f6');
  html += _cmsAvgCard('Avg Medicaid %', avgMedicaidPct != null ? avgMedicaidPct.toFixed(1) + '%' : '–', '#8b5cf6');
  html += _cmsAvgCard('Avg Private/Comm %', avgPrivatePct != null ? avgPrivatePct.toFixed(1) + '%' : '–', '#10b981');
  html += _cmsAvgCard('Avg Oper. Margin', avgMargin != null ? avgMargin.toFixed(1) + '%' : '–', avgMargin != null && avgMargin >= 12 ? '#34d399' : avgMargin != null && avgMargin >= 0 ? '#fbbf24' : '#f87171');
  html += _cmsAvgCard('Avg Star Rating', avgStarRating != null ? avgStarRating.toFixed(1) + ' / 5' : '–', '#fbbf24');
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
  html += '<div class="data-table" style="min-width:1200px">';

  // Header (sortable)
  const cols = [
    { key: 'operator_name', label: 'Operator', flex: '1.1' },
    { key: 'facility_name', label: 'Facility', flex: '1.3' },
    { key: 'city', label: 'City', flex: '0.7' },
    { key: 'state', label: 'ST', flex: '0.3' },
    { key: 'modality_type', label: 'Type', flex: '0.5' },
    { key: 'est_in_center_patients', label: 'IC Pts', flex: '0.5', align: 'right' },
    { key: 'est_home_patients', label: 'Home Pts', flex: '0.5', align: 'right' },
    { key: '_medicare_pct', label: 'Mcare %', flex: '0.45', align: 'right' },
    { key: '_medicaid_pct', label: 'Mcaid %', flex: '0.45', align: 'right' },
    { key: '_private_pct', label: 'Priv %', flex: '0.45', align: 'right' },
    { key: 'est_in_center_revenue', label: 'IC Rev', flex: '0.6', align: 'right' },
    { key: 'est_home_revenue', label: 'Home Rev', flex: '0.6', align: 'right' },
    { key: 'estimated_annual_revenue', label: 'TTM Rev', flex: '0.6', align: 'right' },
    { key: 'estimated_ebitda', label: 'EBITDA', flex: '0.6', align: 'right' },
    { key: 'ttm_operating_margin', label: 'Margin', flex: '0.5', align: 'right' },
    { key: 'star_rating', label: 'Stars', flex: '0.4', align: 'center' },
    { key: '_actions', label: 'Actions', flex: '0.7', align: 'center' }
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
  page.forEach((row, idx) => {
    const modBadge = row.modality_type === 'hybrid' ? '<span style="color:#fbbf24;font-weight:600">Hybrid</span>'
      : row.modality_type === 'home' ? '<span style="color:#a78bfa;font-weight:600">Home</span>'
      : '<span style="color:#34d399;font-weight:600">IC</span>';
    const icPts = Number(row.est_in_center_patients) || 0;
    const hmPts = Number(row.est_home_patients) || 0;
    const icRev = Number(row.est_in_center_revenue) || 0;
    const hmRev = Number(row.est_home_revenue) || 0;
    const fmtRev = v => v > 0 ? '$' + (v / 1000000).toFixed(1) + 'M' : '–';
    const isSelected = diaCmsSelectedIdx === idx;

    html += `<div class="table-row clickable-row" data-cms-row-idx="${idx}" style="font-size:12px;cursor:pointer;${isSelected ? 'background:rgba(96,165,250,0.1);border-left:3px solid #60a5fa;' : ''}">`;
    html += `<div style="flex:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${(row.operator_name || row.chain_organization) ? entityLink(row.operator_name || row.chain_organization, 'operator', null) : '–'}</div>`;
    html += `<div style="flex:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">${esc(row.facility_name || '')}</div>`;
    html += `<div style="flex:0.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${esc(row.city || '')}</div>`;
    html += `<div style="flex:0.3;color:var(--text2)">${esc(row.state || '')}</div>`;
    html += `<div style="flex:0.5;font-size:11px">${modBadge}</div>`;
    html += `<div style="flex:0.5;text-align:right;font-weight:500;color:#34d399">${icPts > 0 ? fmtN(icPts) : '–'}</div>`;
    html += `<div style="flex:0.5;text-align:right;font-weight:500;color:#a78bfa">${hmPts > 0 ? fmtN(hmPts) : '–'}</div>`;
    // Payor mix columns
    const rMcarePct = payerPct(row, 'payer_mix_medicare', 'payer_mix_medicare_pct');
    const rMcaidPct = payerPct(row, 'payer_mix_medicaid', 'payer_mix_medicaid_pct');
    const rPrivPct = payerPct(row, 'payer_mix_commercial', 'payer_mix_private_pct');
    html += `<div style="flex:0.45;text-align:right;color:#3b82f6;font-size:11px" title="CMS-reported Medicare patient %">${rMcarePct != null ? rMcarePct.toFixed(1) + '%' : '–'}</div>`;
    html += `<div style="flex:0.45;text-align:right;color:#8b5cf6;font-size:11px" title="CMS-reported Medicaid patient %">${rMcaidPct != null ? rMcaidPct.toFixed(1) + '%' : '–'}</div>`;
    html += `<div style="flex:0.45;text-align:right;color:#10b981;font-size:11px" title="CMS-reported Private/Commercial %">${rPrivPct != null ? rPrivPct.toFixed(1) + '%' : '–'}</div>`;
    html += `<div style="flex:0.6;text-align:right;color:var(--text2)">${fmtRev(icRev)}</div>`;
    html += `<div style="flex:0.6;text-align:right;color:var(--text2)">${fmtRev(hmRev)}</div>`;
    html += `<div style="flex:0.6;text-align:right;color:var(--text2)">${row.estimated_annual_revenue ? '$' + (Number(row.estimated_annual_revenue) / 1000000).toFixed(1) + 'M' : '–'}</div>`;
    html += `<div style="flex:0.6;text-align:right;color:var(--text2)">${row.estimated_ebitda ? '$' + Math.round(Number(row.estimated_ebitda) / 1000).toLocaleString() + 'K' : '–'}</div>`;
    // Operating margin & star rating
    const rowMargin = row.ttm_operating_margin != null ? Number(row.ttm_operating_margin) : null;
    const marginColor = rowMargin != null ? (rowMargin >= 12 ? '#34d399' : rowMargin >= 0 ? '#fbbf24' : '#f87171') : 'var(--text3)';
    html += `<div style="flex:0.5;text-align:right;font-size:11px;color:${marginColor}" title="Estimated operating margin (TTM revenue − estimated costs)">${rowMargin != null ? rowMargin.toFixed(1) + '%' : '–'}</div>`;
    const rowStars = row.star_rating != null ? Number(row.star_rating) : null;
    html += `<div style="flex:0.4;text-align:center;font-size:11px" title="CMS 5-Star Quality Rating">${rowStars != null ? '<span style="color:#fbbf24">★</span> ' + rowStars.toFixed(1) : '–'}</div>`;
    html += `<div style="flex:0.7;text-align:center;display:flex;gap:3px;justify-content:center" onclick="event.stopPropagation()"><button class="cms-flag-btn" data-clinic-id="${esc(row.clinic_id || row.ccn || '')}" data-clinic-name="${esc(row.facility_name || '')}" style="font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:var(--s3);color:var(--text2);cursor:pointer;" title="Flag for research">Flag</button><button class="gov-row-action" onclick='showDetail(${safeJSON(row)}, "dia-clinic", "Ownership")' title="View owner & contacts">📞</button><button class="gov-row-action accent" onclick='showDetail(${safeJSON(row)}, "dia-clinic", "Intel")' title="Research & intel">🔍</button></div>`;
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

  // === Inline context card for selected row ===
  if (diaCmsSelectedIdx !== undefined && page[diaCmsSelectedIdx]) {
    const sel = page[diaCmsSelectedIdx];
    html += '<div style="margin-top:16px;border:1px solid #60a5fa;border-radius:12px;padding:16px 20px;background:var(--s1)">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">';
    html += '<div>';
    html += '<h3 style="margin:0;font-size:15px;font-weight:700;color:var(--text)">' + esc(sel.facility_name || 'Unknown') + '</h3>';
    html += '<div style="font-size:12px;color:var(--text2);margin-top:2px">' + esc((sel.city || '') + (sel.state ? ', ' + sel.state : '')) + (sel.address ? ' — ' + esc(sel.address) : '') + '</div>';
    html += '</div>';
    html += '<button style="font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text2);cursor:pointer" onclick="diaCmsSelectedIdx=undefined;renderDiaTab()">Close</button>';
    html += '</div>';
    // Key clinic data grid
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;font-size:12px">';
    const _cv = (lbl, val) => '<div style="background:var(--s2);padding:8px;border-radius:6px"><div style="color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">' + lbl + '</div><div style="font-weight:600;color:var(--text)">' + val + '</div></div>';
    html += _cv('Operator', esc(sel.operator_name || sel.chain_organization || '—'));
    html += _cv('Modality', esc(sel.modality_type ? sel.modality_type.replace(/_/g, ' ') : '—'));
    html += _cv('IC Patients', fmtN(Number(sel.est_in_center_patients) || 0));
    html += _cv('Home Patients', fmtN(Number(sel.est_home_patients) || 0));
    html += _cv('Annual Revenue', sel.estimated_annual_revenue ? '$' + (Number(sel.estimated_annual_revenue) / 1e6).toFixed(1) + 'M' : '—');
    html += _cv('EBITDA', sel.estimated_ebitda ? '$' + Math.round(Number(sel.estimated_ebitda) / 1000).toLocaleString() + 'K' : '—');
    html += _cv('Clinic ID', esc(String(sel.clinic_id || sel.ccn || '—')));
    html += _cv('Medicare ID', esc(String(sel.medicare_id || '—')));
    html += '</div>';
    // Payor mix & quality row
    const selMcarePct = payerPct(sel, 'payer_mix_medicare', 'payer_mix_medicare_pct');
    const selMcaidPct = payerPct(sel, 'payer_mix_medicaid', 'payer_mix_medicaid_pct');
    const selPrivPct = payerPct(sel, 'payer_mix_commercial', 'payer_mix_private_pct');
    const selMargin = sel.ttm_operating_margin != null ? Number(sel.ttm_operating_margin) : null;
    const selStars = sel.star_rating != null ? Number(sel.star_rating) : null;
    html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px;font-size:12px">';
    html += _cv('Medicare %', selMcarePct != null ? '<span style="color:#3b82f6;font-weight:700">' + selMcarePct.toFixed(1) + '%</span> <span style="font-size:9px;color:var(--text3)">CMS reported</span>' : '—');
    html += _cv('Medicaid %', selMcaidPct != null ? '<span style="color:#8b5cf6;font-weight:700">' + selMcaidPct.toFixed(1) + '%</span> <span style="font-size:9px;color:var(--text3)">CMS reported</span>' : '—');
    html += _cv('Private/Comm %', selPrivPct != null ? '<span style="color:#10b981;font-weight:700">' + selPrivPct.toFixed(1) + '%</span> <span style="font-size:9px;color:var(--text3)">CMS reported</span>' : '—');
    html += _cv('Oper. Margin', selMargin != null ? '<span style="color:' + (selMargin >= 12 ? '#34d399' : selMargin >= 0 ? '#fbbf24' : '#f87171') + ';font-weight:700">' + selMargin.toFixed(1) + '%</span> <span style="font-size:9px;color:var(--text3)">Estimated</span>' : '—');
    html += _cv('Star Rating', selStars != null ? '<span style="color:#fbbf24">★</span> ' + selStars.toFixed(1) + ' <span style="font-size:9px;color:var(--text3)">CMS reported</span>' : '—');
    html += '</div>';
    // Quick actions
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    const searchQ = (sel.facility_name || '') + ' ' + (sel.address || '') + ' ' + (sel.city || '') + ' ' + (sel.state || '') + ' dialysis';
    html += '<a href="https://www.google.com/search?q=' + encodeURIComponent(searchQ.trim()) + '" target="_blank" rel="noopener" style="font-size:11px;padding:5px 12px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">Google Search</a>';
    html += '<button class="btn-action default" style="font-size:11px;padding:5px 12px;" onclick=\'showDetail(' + safeJSON(sel) + ',"dia-clinic")\'>Open Full Detail</button>';
    html += '<button class="cms-flag-btn" data-clinic-id="' + esc(sel.clinic_id || sel.ccn || '') + '" data-clinic-name="' + esc(sel.facility_name || '') + '" style="font-size:11px;padding:5px 12px;border:1px solid var(--accent);border-radius:6px;background:rgba(52,211,153,0.1);color:var(--accent);cursor:pointer;font-weight:600">Flag for Research</button>';
    html += '</div>';
    html += '</div>';
  }

  html += '</div>'; // biz-section

  // === Attach handlers ===
  setTimeout(() => {
    // CMS row clicks — show inline context card
    document.querySelectorAll('[data-cms-row-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.cmsRowIdx, 10);
        diaCmsSelectedIdx = diaCmsSelectedIdx === idx ? undefined : idx;
        renderDiaTab();
      });
    });
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
        diaCmsSelectedIdx = undefined;
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
          // Restore focus after DOM re-render
          const restored = document.getElementById('cmsSearch');
          if (restored) {
            restored.focus();
            restored.setSelectionRange(restored.value.length, restored.value.length);
          }
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
    if (prevBtn) prevBtn.addEventListener('click', () => { diaCmsPage--; diaCmsSelectedIdx = undefined; renderDiaTab(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { diaCmsPage++; diaCmsSelectedIdx = undefined; renderDiaTab(); });
    // Flag-for-review buttons
    document.querySelectorAll('.cms-flag-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const clinicId = btn.dataset.clinicId;
        const clinicName = btn.dataset.clinicName;
        if (!clinicId) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await applyInsertWithFallback({
            proxyBase: '/api/dia-query',
            table: 'research_queue_outcomes',
            data: {
              medicare_id: clinicId,
              outcome: 'flagged_for_review',
              notes: 'Flagged from CMS Data tab for research',
              created_at: new Date().toISOString()
            },
            source_surface: 'dia_cms_flag'
          });
          btn.textContent = '✓';
          btn.style.color = 'var(--success)';
          btn.style.borderColor = 'var(--success)';
          showToast('Flagged ' + (clinicName || clinicId) + ' for review', 'success');
        } catch(e) {
          btn.disabled = false;
          btn.textContent = 'Flag';
          showToast('Flag failed: ' + e.message, 'error');
        }
      });
    });
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

  // === Action guidance banner ===
  html += '<div style="padding:10px 14px;background:rgba(251,191,36,0.08);border-radius:8px;border-left:3px solid #fbbf24;margin-bottom:16px;display:flex;align-items:center;gap:10px;">';
  html += '<div style="font-size:13px;color:var(--text);line-height:1.4"><strong>NPI Intelligence Signals</strong> — Review provider-level changes detected from NPI registry data. <strong>Flag</strong> signals that warrant ownership or lease research. <strong>Dismiss</strong> signals that are routine or irrelevant. Click any row to view full property details.</div>';
  html += '</div>';

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
    html += '<div style="flex: 1.0; text-align: center;">Actions</div>';
    html += '</div>';
    
    filtered.slice(0, 500).forEach((row, idx) => {
      const signalColor = row.signal_type === 'npi_changed' ? 'var(--accent)' : 'var(--text2)';
      const isSelected = diaNpiSelectedIdx === idx;

      html += `<div class="table-row clickable-row" data-npi-row-idx="${idx}" style="cursor:pointer;${isSelected ? 'background:rgba(251,191,36,0.1);border-left:3px solid #fbbf24;' : ''}">`;
      html += `<div style="flex: 1.5; color: ${signalColor};">${esc(cleanLabel(row.signal_type || ''))}</div>`;
      html += `<div style="flex: 2;" class="truncate">${esc(norm(row.facility_name) || '')}</div>`;
      html += `<div style="flex: 1;">${esc(norm(row.city) || '')}</div>`;
      html += `<div style="flex: 1;">${esc(row.state || '')}</div>`;
      html += `<div style="flex: 1;">${row.operator_name ? entityLink(row.operator_name, 'operator', null) : ''}</div>`;
      html += `<div style="flex: 1; text-align: right; color: var(--accent);">${fmtN(row.latest_total_patients || 0)}</div>`;
      html += `<div style="flex: 1.0; text-align: center; display: flex; gap: 3px; justify-content: center;" onclick="event.stopPropagation();">`;
      html += `<button class="npi-flag-btn" data-npi-id="${esc(row.npi || row.clinic_id || row.id || '')}" data-npi-name="${esc(row.facility_name || '')}" style="font-size:9px;padding:2px 6px;border:1px solid var(--border);border-radius:3px;background:var(--s3);color:var(--text2);cursor:pointer;" title="Flag for research">Flag</button>`;
      html += `<button class="npi-dismiss-btn" data-npi-id="${esc(row.npi || row.clinic_id || row.id || '')}" style="font-size:9px;padding:2px 6px;border:1px solid var(--border);border-radius:3px;background:var(--s3);color:var(--text3);cursor:pointer;" title="Dismiss signal">✕</button>`;
      html += `<button class="gov-row-action" onclick='showDetail(${safeJSON(row)}, "dia-clinic", "Ownership")' title="View owner & contacts">📞</button>`;
      html += `<button class="gov-row-action accent" onclick='showDetail(${safeJSON(row)}, "dia-clinic", "Intel")' title="Research & intel">🔍</button>`;
      html += `</div>`;
      html += '</div>';
    });
  }
  
  html += '</div>';
  html += '</div>';

  // === Inline context card for selected NPI signal ===
  const npiFiltered = diaNpiFilter ? diaData.npiSignals.filter(r => r.signal_type === diaNpiFilter) : diaData.npiSignals;
  if (diaNpiSelectedIdx !== undefined && npiFiltered[diaNpiSelectedIdx]) {
    const sel = npiFiltered[diaNpiSelectedIdx];
    const signalExplanations = {
      'npi_changed': 'The NPI (National Provider Identifier) for this clinic has changed, which may indicate a change in operating entity, ownership transition, or administrative restructuring.',
      'npi_deactivated': 'This clinic\'s NPI has been deactivated, which may signal closure, merger, or regulatory action. Verify current operating status.',
      'new_npi': 'A new NPI has been registered at or near this facility\'s address. This could indicate a new operator, rebranding, or ownership change.',
      'address_change': 'The registered address for this NPI has changed. Verify if the clinic relocated or if this is an administrative update.',
      'taxonomy_change': 'The provider taxonomy code changed, which may indicate a shift in services offered (e.g., adding home dialysis).',
      'name_change': 'The organization name associated with this NPI changed. This often signals ownership transition or rebranding.',
    };
    const sigExplain = signalExplanations[sel.signal_type] || 'An NPI registry change was detected for this clinic. Review the details and determine if research or pipeline action is needed.';

    html += '<div style="margin-top:16px;border:1px solid #fbbf24;border-radius:12px;padding:16px 20px;background:var(--s1)">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">';
    html += '<div>';
    html += '<h3 style="margin:0;font-size:15px;font-weight:700;color:var(--text)">' + esc(norm(sel.facility_name) || 'Unknown') + '</h3>';
    html += '<div style="font-size:12px;color:var(--text2);margin-top:2px">' + esc((sel.city || '') + (sel.state ? ', ' + sel.state : '')) + '</div>';
    html += '</div>';
    html += '<button style="font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text2);cursor:pointer" onclick="diaNpiSelectedIdx=undefined;renderDiaTab()">Close</button>';
    html += '</div>';
    // Signal explanation
    html += '<div style="padding:10px 14px;background:rgba(251,191,36,0.08);border-radius:8px;border-left:3px solid #fbbf24;margin-bottom:12px;">';
    html += '<div style="font-weight:700;font-size:12px;margin-bottom:4px;color:var(--text)">Signal: ' + esc(cleanLabel(sel.signal_type || '')) + '</div>';
    html += '<div style="font-size:12px;color:var(--text);line-height:1.4;">' + esc(sigExplain) + '</div>';
    html += '</div>';
    // Context grid
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;font-size:12px">';
    const _nv = (lbl, val) => '<div style="background:var(--s2);padding:8px;border-radius:6px"><div style="color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">' + lbl + '</div><div style="font-weight:600;color:var(--text)">' + val + '</div></div>';
    html += _nv('Operator', esc(sel.operator_name || '—'));
    html += _nv('Patients', fmtN(sel.latest_total_patients || 0));
    html += _nv('NPI', esc(String(sel.npi || '—')));
    html += _nv('Clinic ID', esc(String(sel.clinic_id || sel.id || '—')));
    html += _nv('State', esc(sel.state || '—'));
    html += _nv('Signal Date', sel.signal_date ? new Date(sel.signal_date).toLocaleDateString() : '—');
    html += '</div>';
    // Actions
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    const npiSearchQ = (sel.facility_name || '') + ' ' + (sel.city || '') + ' ' + (sel.state || '') + ' NPI ' + (sel.npi || '');
    html += '<a href="https://www.google.com/search?q=' + encodeURIComponent(npiSearchQ.trim()) + '" target="_blank" rel="noopener" style="font-size:11px;padding:5px 12px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">Google Search</a>';
    html += '<a href="https://npiregistry.cms.hhs.gov/provider-view/' + encodeURIComponent(sel.npi || '') + '" target="_blank" rel="noopener" style="font-size:11px;padding:5px 12px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">NPI Registry</a>';
    html += '<button class="btn-action default" style="font-size:11px;padding:5px 12px;" onclick=\'showDetail(' + safeJSON(sel) + ',"dia-clinic")\'>Open Full Detail</button>';
    html += '<button class="npi-flag-btn" data-npi-id="' + esc(sel.npi || sel.clinic_id || sel.id || '') + '" data-npi-name="' + esc(sel.facility_name || '') + '" style="font-size:11px;padding:5px 12px;border:1px solid var(--accent);border-radius:6px;background:rgba(52,211,153,0.1);color:var(--accent);cursor:pointer;font-weight:600">Flag for Research</button>';
    html += '<button class="npi-dismiss-btn" data-npi-id="' + esc(sel.npi || sel.clinic_id || sel.id || '') + '" style="font-size:11px;padding:5px 12px;border:1px solid #f87171;border-radius:6px;background:rgba(248,113,113,0.1);color:#f87171;cursor:pointer;font-weight:600">Dismiss Signal</button>';
    html += '</div>';
    html += '</div>';
  }

  html += '</div>';

  // Attach filter handlers
  setTimeout(() => {
    // NPI row clicks — show inline context card
    document.querySelectorAll('[data-npi-row-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.npiRowIdx, 10);
        diaNpiSelectedIdx = diaNpiSelectedIdx === idx ? undefined : idx;
        renderDiaTab();
      });
    });
    document.querySelectorAll('.pills .pill').forEach(btn => {
      btn.addEventListener('click', e => {
        const filter = e.target.dataset.filter;
        diaNpiFilter = filter === 'all' ? null : filter;
        diaNpiSelectedIdx = undefined;
        renderDiaTab();
      });
    });
    // NPI Flag buttons
    document.querySelectorAll('.npi-flag-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const npiId = btn.dataset.npiId;
        const npiName = btn.dataset.npiName;
        if (!npiId) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await applyInsertWithFallback({
            proxyBase: '/api/dia-query',
            table: 'research_queue_outcomes',
            data: {
              medicare_id: npiId,
              outcome: 'flagged_for_review',
              notes: 'Flagged from NPI signals tab',
              created_at: new Date().toISOString()
            },
            source_surface: 'dia_npi_flag'
          });
          btn.textContent = '✓';
          btn.style.color = 'var(--success)';
          btn.style.borderColor = 'var(--success)';
          showToast('Flagged ' + (npiName || npiId) + ' for review', 'success');
        } catch(e) {
          btn.disabled = false;
          btn.textContent = 'Flag';
          showToast('Flag failed: ' + e.message, 'error');
        }
      });
    });
    // NPI Dismiss buttons
    document.querySelectorAll('.npi-dismiss-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const npiId = btn.dataset.npiId;
        if (!npiId) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await applyInsertWithFallback({
            proxyBase: '/api/dia-query',
            table: 'research_queue_outcomes',
            data: {
              medicare_id: npiId,
              outcome: 'dismissed',
              notes: 'Dismissed from NPI signals tab',
              created_at: new Date().toISOString()
            },
            source_surface: 'dia_npi_dismiss'
          });
          // Remove from the in-memory list
          const idx = diaData.npiSignals.findIndex(s => (s.npi || s.clinic_id || s.id || '') === npiId);
          if (idx >= 0) diaData.npiSignals.splice(idx, 1);
          showToast('Signal dismissed', 'success');
          renderDiaTab();
        } catch(e) {
          btn.disabled = false;
          btn.textContent = '✕';
          showToast('Dismiss failed: ' + e.message, 'error');
        }
      });
    });
  }, 0);

  return html;
}

// ============================================================================
// RESEARCH UI HELPERS — Shared by Dialysis & Government research tabs
// ============================================================================

/**
 * Render a field-level completeness indicator dot
 * @param {'verified'|'auto'|'missing'} state
 * @param {string} [source] - e.g., "CoStar", "GSA", "manual"
 * @returns {string} HTML
 */
function fieldInd(state, source) {
  const icons = { verified: '✓', auto: '?', missing: '○' };
  const tips = {
    verified: source ? `Verified (${source})` : 'Verified',
    auto: source ? `Auto-filled from ${source} — verify` : 'Auto-filled — needs verification',
    missing: 'Missing — manual input needed'
  };
  return `<span class="field-ind ${state}" title="${tips[state]}">${icons[state]}</span>`;
}

/**
 * Determine field state based on value and source
 * @param {*} value - current field value
 * @param {string} [source] - data source if auto-populated
 * @param {boolean} [humanVerified] - true if explicitly saved by user
 * @returns {'verified'|'auto'|'missing'}
 */
function fieldState(value, source, humanVerified) {
  if (humanVerified) return 'verified';
  if (value !== null && value !== undefined && value !== '' && value !== 0) {
    return source ? 'auto' : 'verified';
  }
  return 'missing';
}

/**
 * Compute completeness summary for a set of fields
 * @param {Array<{name: string, value: *, source?: string, required?: boolean, verified?: boolean}>} fields
 * @returns {{pct: number, verified: number, auto: number, missing: number, missingRequired: string[], total: number}}
 */
function computeCompleteness(fields) {
  let verified = 0, auto = 0, missing = 0;
  const missingRequired = [];
  fields.forEach(f => {
    const st = fieldState(f.value, f.source, f.verified);
    if (st === 'verified') verified++;
    else if (st === 'auto') auto++;
    else {
      missing++;
      if (f.required) missingRequired.push(f.name);
    }
  });
  const total = fields.length;
  const filledCount = verified + auto;
  const pct = total > 0 ? Math.round((filledCount / total) * 100) : 100;
  return { pct, verified, auto, missing, missingRequired, total };
}

/**
 * Render completeness summary bar
 * @param {{pct: number, verified: number, auto: number, missing: number, missingRequired: string[]}} c
 * @returns {string} HTML
 */
function renderCompletenessBar(c) {
  const fillColor = c.pct >= 80 ? 'var(--green, #34d399)' : c.pct >= 50 ? '#fbbf24' : '#f87171';
  const badge = c.missing === 0 ? '<span class="task-badge ready">Ready</span>'
    : c.missingRequired.length > 0 ? '<span class="task-badge urgent">' + c.missingRequired.length + ' required</span>'
    : '<span class="task-badge needs-input">' + c.missing + ' optional</span>';

  let html = '<div class="completeness-bar">';
  html += `<div class="cb-score">${c.pct}%</div>`;
  html += `<div style="flex:1">`;
  html += `<div class="cb-meter"><div class="cb-fill" style="width:${c.pct}%;background:${fillColor}"></div></div>`;
  html += `<div class="cb-counts" style="margin-top:6px">`;
  if (c.missing > 0) html += `<span class="ct-miss">○ ${c.missing} missing</span>`;
  if (c.auto > 0) html += `<span class="ct-auto">? ${c.auto} verify</span>`;
  if (c.verified > 0) html += `<span class="ct-ok">✓ ${c.verified} confirmed</span>`;
  html += `</div></div>`;
  html += badge;
  html += '</div>';
  return html;
}

/**
 * Render step navigation dots
 * @param {number} current - 0-indexed current step
 * @param {Array<{label: string, complete: boolean}>} steps
 * @param {string} onClickFn - JS function name to call with step index
 * @returns {string} HTML
 */
function renderStepNav(current, steps, onClickFn) {
  let html = '<div class="step-nav">';
  steps.forEach((s, i) => {
    const cls = i === current ? 'current' : s.complete ? 'done' : '';
    html += `<div style="display:flex;flex-direction:column;align-items:center;">`;
    html += `<div class="step-dot ${cls}" onclick="${onClickFn}(${i})">${s.complete && i !== current ? '✓' : i + 1}</div>`;
    html += `<div class="step-label ${i === current ? 'current' : ''}">${s.label}</div>`;
    html += `</div>`;
  });
  html += '</div>';
  return html;
}

/**
 * Render a guided form field with indicator and optional source hint
 * @param {string} id - input element ID
 * @param {string} label - display label
 * @param {*} value - current value
 * @param {object} opts - { type, placeholder, source, required, verified, readonly, options }
 * @returns {string} HTML
 */
function guidedField(id, label, value, opts = {}) {
  const st = fieldState(value, opts.source, opts.verified);
  const ind = fieldInd(st, opts.source);
  const sourceHint = opts.source ? `<span class="field-source">via ${opts.source}</span>` : '';
  const reqMark = opts.required ? ' <span style="color:#f87171">*</span>' : '';

  let html = '<div class="form-group">';
  html += `<label>${esc(label)}${reqMark}${ind}${sourceHint}</label>`;

  if (opts.options) {
    // Select dropdown
    html += `<select id="${id}"${opts.readonly ? ' disabled' : ''}>`;
    html += `<option value="">Select...</option>`;
    opts.options.forEach(o => {
      const sel = (value === o.value || value === o.label) ? ' selected' : '';
      html += `<option value="${esc(o.value)}"${sel}>${esc(o.label)}</option>`;
    });
    html += '</select>';
  } else if (opts.type === 'textarea') {
    html += `<textarea id="${id}" placeholder="${esc(opts.placeholder || '')}"${opts.readonly ? ' readonly' : ''} rows="${opts.rows || 3}">${esc(value || '')}</textarea>`;
  } else if (opts.type === 'date') {
    html += `<input type="date" id="${id}" value="${value ? String(value).substring(0, 10) : ''}"${opts.readonly ? ' readonly' : ''}>`;
  } else {
    const inputType = opts.type || 'text';
    html += `<input type="${inputType}" id="${id}" value="${esc(value || '')}" placeholder="${esc(opts.placeholder || '')}"${opts.readonly ? ' readonly' : ''}${opts.step ? ' step="' + opts.step + '"' : ''}>`;
  }

  html += '</div>';
  return html;
}

// ============================================================================
// PIPELINE/OPS RESEARCH MODES — Data loading functions
// ============================================================================

/**
 * Load unmatched clinics queue (pending_updates where status='needs_match')
 */
async function loadDiaUnmatchedQueue() {
  if (diaUnmatchedLoading) return;
  diaUnmatchedLoading = true;
  try {
    const data = await diaQuery('v_pending_updates_workbench', '*', {
      filter: "status=eq.needs_match",
      order: "created_at.desc",
      limit: 1000
    });
    diaUnmatchedQueue = data || [];
  } catch(e) {
    console.error('loadDiaUnmatchedQueue error:', e);
    showToast('Unmatched queue load failed', 'error');
    diaUnmatchedQueue = [];
  }
  diaUnmatchedLoading = false;
  if (typeof currentBizTab !== 'undefined' && currentBizTab !== 'dialysis') return;
  renderDiaTab();
}

/**
 * Load quarantine queue (medicare_ingest_quarantine)
 */
async function loadDiaQuarantineQueue() {
  if (diaQuarantineLoading) return;
  diaQuarantineLoading = true;
  try {
    const data = await diaQuery('medicare_ingest_quarantine', '*', {
      order: "ingested_at.desc",
      limit: 1000
    });
    diaQuarantineQueue = data || [];
  } catch(e) {
    console.error('loadDiaQuarantineQueue error:', e);
    showToast('Quarantine queue load failed', 'error');
    diaQuarantineQueue = [];
  }
  diaQuarantineLoading = false;
  if (typeof currentBizTab !== 'undefined' && currentBizTab !== 'dialysis') return;
  renderDiaTab();
}

/**
 * Load clarification queue (pending_updates where status='needs_clarification')
 */
async function loadDiaClarificationQueue() {
  if (diaClarificationLoading) return;
  diaClarificationLoading = true;
  try {
    const data = await diaQuery('pending_updates', '*', {
      filter: "status=eq.needs_clarification",
      order: "created_at.desc",
      limit: 1000
    });
    diaClarificationQueue = data || [];
  } catch(e) {
    console.error('loadDiaClarificationQueue error:', e);
    showToast('Clarification queue load failed', 'error');
    diaClarificationQueue = [];
  }
  diaClarificationLoading = false;
  if (typeof currentBizTab !== 'undefined' && currentBizTab !== 'dialysis') return;
  renderDiaTab();
}

/**
 * Load email intake queue — staged items with extraction + match data
 */
async function loadDiaIntakeQueue() {
  if (diaIntakeLoading) return;
  diaIntakeLoading = true;
  try {
    const url = new URL('/api/intake-queue', window.location.origin);
    url.searchParams.set('domain', 'dialysis');
    url.searchParams.set('limit', '50');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    diaIntakeQueue = result.items || [];
  } catch(e) {
    console.error('loadDiaIntakeQueue error:', e);
    showToast('Intake queue load failed', 'error');
    diaIntakeQueue = [];
  }
  diaIntakeLoading = false;
  if (typeof currentBizTab !== 'undefined' && currentBizTab !== 'dialysis') return;
  renderDiaTab();
}

/**
 * Render email intake queue — documents awaiting review before DB promotion
 */
function renderDiaIntakeQueue() {
  if (diaIntakeLoading || !diaIntakeQueue) {
    return '<div style="text-align:center;padding:40px;color:var(--text3)"><div class="spinner"></div><div style="margin-top:12px">Loading intake queue...</div></div>';
  }

  const items = diaIntakeQueue;
  if (items.length === 0) {
    return '<div style="text-align:center;padding:40px">'
      + '<div style="font-size:36px;margin-bottom:12px">📬</div>'
      + '<div style="font-size:15px;font-weight:600;color:var(--text)">No intake items</div>'
      + '<div style="font-size:12px;color:var(--text3);margin-top:4px">Documents from email intake will appear here for review</div>'
      + '<button onclick="diaIntakeQueue=null;loadDiaIntakeQueue()" style="margin-top:12px;padding:6px 16px;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text2);cursor:pointer;font-size:12px">Refresh</button>'
      + '</div>';
  }

  let html = '<div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">';
  html += `<div style="font-size:13px;color:var(--text2)">${items.length} item${items.length !== 1 ? 's' : ''} awaiting review</div>`;
  html += '<button onclick="diaIntakeQueue=null;loadDiaIntakeQueue()" style="padding:4px 12px;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text2);cursor:pointer;font-size:11px">Refresh</button>';
  html += '</div>';

  html += '<div style="display:flex;flex-direction:column;gap:10px">';
  items.forEach((item, idx) => {
    html += renderIntakeCard(item, idx, 'dia');
  });
  html += '</div>';

  return html;
}

/**
 * Shared intake card renderer — used by both dialysis and gov
 */
function renderIntakeCard(item, idx, prefix) {
  const matchIcon = item.match_status === 'matched' ? '✅' : item.match_status === 'review_needed' ? '⚠️' : '❌';
  const matchLabel = item.match_status === 'matched'
    ? `Auto-matched to ${item.match_candidates?.[0]?.address || item.match_property_id || 'property'}`
    : item.match_status === 'review_needed' ? 'Needs Review' : 'No Match';
  const matchColor = item.match_status === 'matched' ? '#34d399' : item.match_status === 'review_needed' ? '#fbbf24' : '#f87171';

  const docTypeLabel = { om: 'Offering Memo', rent_roll: 'Rent Roll', lease_abstract: 'Lease Abstract', unknown: 'Unknown' }[item.document_type] || item.document_type;
  const docTypeColor = { om: '#6c8cff', rent_roll: '#34d399', lease_abstract: '#fbbf24', unknown: '#94a3b8' }[item.document_type] || '#94a3b8';

  const fmt = (v, pre, suf) => v != null ? (pre || '') + v.toLocaleString() + (suf || '') : null;

  let html = `<div style="border:1px solid var(--border);border-radius:10px;padding:14px;background:var(--s1);transition:box-shadow 0.2s" class="intake-card">`;

  // Header: subject + sender
  html += '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">';
  html += `<div style="flex:1;min-width:0">`;
  html += `<div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${(item.source_email_subject || '').replace(/"/g, '&quot;')}">${item.source_email_subject || '(No subject)'}</div>`;
  html += `<div style="font-size:11px;color:var(--text3);margin-top:2px">${item.source_email_sender || 'Unknown sender'}</div>`;
  html += '</div>';
  html += `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${docTypeColor}18;color:${docTypeColor};white-space:nowrap;margin-left:8px">${docTypeLabel}</span>`;
  html += '</div>';

  // Extracted fields grid
  const fields = [
    item.address ? { label: 'Address', value: `${item.address}${item.city ? ', ' + item.city : ''}${item.state ? ', ' + item.state : ''}` } : null,
    item.tenant_name ? { label: 'Tenant', value: item.tenant_name } : null,
    fmt(item.cap_rate, '', '%') ? { label: 'Cap Rate', value: fmt(item.cap_rate, '', '%') } : null,
    fmt(item.noi, '$') ? { label: 'NOI', value: fmt(item.noi, '$') } : null,
    fmt(item.asking_price, '$') ? { label: 'Asking Price', value: fmt(item.asking_price, '$') } : null,
    fmt(item.annual_rent, '$') ? { label: 'Annual Rent', value: fmt(item.annual_rent, '$') } : null,
  ].filter(Boolean);

  if (fields.length > 0) {
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px 12px;margin-bottom:10px">';
    fields.forEach(f => {
      html += `<div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:1px">${f.label}</div><div style="font-size:12px;font-weight:500;color:var(--text)">${f.value}</div></div>`;
    });
    html += '</div>';
  }

  // Match status + confidence
  html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${matchColor}08;border:1px solid ${matchColor}30;border-radius:6px;margin-bottom:10px">`;
  html += `<span style="font-size:14px">${matchIcon}</span>`;
  html += `<span style="font-size:12px;color:var(--text);flex:1">${matchLabel}</span>`;
  if (item.confidence != null) {
    html += `<span style="font-size:11px;font-weight:600;color:${matchColor};background:${matchColor}15;padding:2px 8px;border-radius:4px">${Math.round(item.confidence * 100)}%</span>`;
  }
  html += '</div>';

  // Action buttons
  html += '<div style="display:flex;gap:8px">';
  html += `<button onclick="intakePromote('${item.intake_id}','${prefix}')" style="flex:1;padding:7px 0;border-radius:6px;border:none;background:#34d399;color:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">Promote to DB</button>`;
  if (item.match_status !== 'matched') {
    html += `<button onclick="intakeLinkProperty('${item.intake_id}','${prefix}')" style="flex:1;padding:7px 0;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:12px;font-weight:500;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='var(--s3)'" onmouseout="this.style.background='var(--s2)'">Link to Property</button>`;
  }
  html += `<button onclick="intakeDiscard('${item.intake_id}','${prefix}')" style="padding:7px 14px;border-radius:6px;border:1px solid #f8717130;background:#f8717110;color:#f87171;font-size:12px;font-weight:500;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#f8717120'" onmouseout="this.style.background='#f8717110'">Discard</button>`;
  html += '</div>';

  html += '</div>';
  return html;
}

/**
 * Promote an intake item to the domain database
 */
window.intakePromote = async function(intakeId, prefix) {
  const btn = event.target;
  const card = btn.closest('.intake-card');
  btn.disabled = true;
  btn.textContent = 'Promoting...';
  try {
    const response = await fetch('/api/intake-promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intake_id: intakeId }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Promote failed');
    showToast(`Promoted to ${result.domain || 'DB'}${result.domain_property_id ? ' (property ' + result.domain_property_id + ')' : ''}`, 'success');
    if (card) card.style.opacity = '0.4';
    // Refresh the queue
    if (prefix === 'dia') { diaIntakeQueue = null; loadDiaIntakeQueue(); }
    else { govIntakeQueue = null; loadGovIntakeQueue(); }
  } catch(e) {
    console.error('intakePromote error:', e);
    showToast('Promote failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Promote to DB';
  }
};

/**
 * Link an intake item to an existing property (placeholder — opens search)
 */
window.intakeLinkProperty = async function(intakeId, prefix) {
  showToast('Link to Property: select a property from search to link this intake item', 'info');
  // Future: open a property search modal, then call promote with property_id
};

/**
 * Discard an intake item
 */
window.intakeDiscard = async function(intakeId, prefix) {
  if (!confirm('Discard this intake item? This cannot be undone.')) return;
  const btn = event.target;
  const card = btn.closest('.intake-card');
  btn.disabled = true;
  btn.textContent = 'Discarding...';
  try {
    const response = await fetch('/api/intake-discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intake_id: intakeId }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Discard failed');
    showToast('Intake item discarded', 'success');
    if (card) card.style.opacity = '0.4';
    if (prefix === 'dia') { diaIntakeQueue = null; loadDiaIntakeQueue(); }
    else { govIntakeQueue = null; loadGovIntakeQueue(); }
  } catch(e) {
    console.error('intakeDiscard error:', e);
    showToast('Discard failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Discard';
  }
};

/**
 * Load staleness monitor data (v_source_health_dashboard or v_counts_freshness)
 */
async function loadDiaStalenessData() {
  if (diaStalenessLoading) return;
  diaStalenessLoading = true;
  try {
    const data = await diaQuery('v_source_health_dashboard', '*', {
      limit: 1000
    });
    diaStalenessData = data || [];
  } catch(e) {
    console.error('loadDiaStalenessData error:', e);
    diaStalenessData = [];
    showToast('Staleness data load failed: ' + e.message, 'error');
  }
  diaStalenessLoading = false;
  if (typeof currentBizTab !== 'undefined' && currentBizTab !== 'dialysis') return;
  renderDiaTab();
}

// Round 76cx Phase 2: load the verification summary digest. Single-row
// view; the dashboard widget renders due_for_verification + overdue +
// broken-URL counts so the user sees at a glance how many listings need
// human eyes.
async function loadDiaVerificationSummary() {
  if (diaVerificationSummaryLoading) return;
  diaVerificationSummaryLoading = true;
  try {
    const rows = await diaQuery('v_listing_verification_summary', '*', { limit: 1 });
    diaVerificationSummary = (rows && rows[0]) || null;
  } catch (e) {
    console.error('loadDiaVerificationSummary error:', e);
    diaVerificationSummary = null;
  }
  diaVerificationSummaryLoading = false;
  if (typeof currentBizTab !== 'undefined' && currentBizTab !== 'dialysis') return;
  renderDiaTab();
}

// Round 76cx Phase 2: dashboard card. Renders a compact verification
// digest. Click → toast for now (Phase 3 wires this to a triage queue
// view). Color reflects urgency:
//   blue   — nothing overdue
//   yellow — some listings due
//   red    — broken URLs or 90d+ overdue
function renderListingVerificationCard() {
  if (!diaVerificationSummary) {
    return '<div class="dia-info-card" style="padding:14px 16px;color:var(--text3);font-size:11px">Loading verification digest…</div>';
  }
  const s = diaVerificationSummary;
  const due       = Number(s.due_for_verification) || 0;
  const overdue30 = Number(s.overdue_30d) || 0;
  const overdue90 = Number(s.overdue_90d) || 0;
  const broken    = Number(s.broken_url_count) || 0;
  const recent    = Number(s.verifications_last_7d) || 0;
  const changes7d = Number(s.recent_status_changes_7d) || 0;

  let color = 'blue';
  if (overdue90 > 0 || broken > 0) color = 'red';
  else if (due > 0 || overdue30 > 0) color = 'yellow';

  const title = 'Verification Status';
  const value = fmtN(due);
  const sub = `${overdue30} 30d-overdue · ${overdue90} 90d · ${broken} broken-url · ${recent} checks/7d · ${changes7d} status-changes/7d`;

  return `<div class="dia-info-card dia-info-${color}" onclick="showToast('Verification triage queue lands in Round 76cx Phase 3','info')" style="cursor:pointer;padding:14px 16px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:6px">${title}</div>
    <div style="font-size:24px;font-weight:700;color:var(--text1);margin-bottom:4px">${value}</div>
    <div style="font-size:11px;color:var(--text2)">due now · ${escapeHtmlSafe(sub)}</div>
  </div>`;
}

// Defensive escapeHtml stub (some dialysis.js builds inline this differently;
// fallback returns raw string if global escapeHtml is unavailable).
function escapeHtmlSafe(s) {
  if (typeof escapeHtml === 'function') return escapeHtml(String(s ?? ''));
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

/**
 * Load run health data (ingestion_tracker + v_ingestion_reconciliation)
 */
async function loadDiaRunHealthData() {
  if (diaRunHealthLoading) return;
  diaRunHealthLoading = true;
  try {
    const data = await diaQuery('ingestion_tracker', '*', {
      order: "started_at.desc",
      limit: 100
    });
    diaRunHealthData = data || [];
  } catch(e) {
    console.error('loadDiaRunHealthData error:', e);
    showToast('Run health data load failed', 'error');
    diaRunHealthData = [];
  }
  diaRunHealthLoading = false;
  if (typeof currentBizTab !== 'undefined' && currentBizTab !== 'dialysis') return;
  renderDiaTab();
}

// ============================================================================
// PIPELINE/OPS RESEARCH MODES — Render functions
// ============================================================================

/**
 * Render unmatched clinics research interface
 */
function renderDiaUnmatchedClinics() {
  let html = '<div class="research-progress" style="margin-bottom: 30px;">';

  if (diaUnmatchedLoading || !diaUnmatchedQueue) {
    html += '<div style="padding:20px;text-align:center;color:var(--text2);">Loading unmatched records...</div>';
    html += '</div>';
    return html;
  }

  const total = diaUnmatchedQueue.length;
  html += `<div class="progress-text" style="margin-bottom:10px;"><strong>${total} unmatched records</strong> awaiting property linkage</div>`;
  html += '</div>';

  // Two-column layout: list + detail
  html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start;">';

  // Left: scrollable list
  html += '<div style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden; max-height: 500px; overflow-y: auto; background: var(--s2);">';
  html += '<div style="position: sticky; top: 0; background: var(--s3); padding: 12px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 12px; color: var(--text2);">Records Needing Match</div>';

  if (total === 0) {
    html += '<div style="padding: 30px; text-align: center; color: var(--text2);">No unmatched records</div>';
  } else {
    diaUnmatchedQueue.slice(0, 100).forEach((item, idx) => {
      const isSelected = diaUnmatchedIdx === idx;
      const daysSince = item.created_at ? Math.floor((Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24)) : 0;
      const bgColor = isSelected ? 'background: rgba(52, 211, 153, 0.15); border-left: 3px solid var(--accent);' : 'border-left: 3px solid transparent;';

      html += `<div class="clickable-row" data-um-idx="${idx}" style="padding: 12px; cursor: pointer; border-bottom: 1px solid var(--border); ${bgColor}">`;
      html += `<div style="font-weight: 500; color: var(--text); font-size: 13px; margin-bottom: 4px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(item.address || 'Unknown')}</div>`;
      html += `<div style="color: var(--text2); font-size: 11px; margin-bottom: 3px;">${esc(item.city || '')}${item.city && item.state ? ', ' : ''}${esc(item.state || '')}</div>`;
      html += `<div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text2);">`;
      html += `<span>${esc(item.reason || 'Unknown')}</span>`;
      html += `<span>${daysSince}d ago</span>`;
      html += `</div>`;
      html += `</div>`;
    });
  }
  html += '</div>';

  // Right: detail card
  if (total > 0 && diaUnmatchedIdx < total) {
    const item = diaUnmatchedQueue[diaUnmatchedIdx];
    html += '<div style="border: 1px solid var(--border); border-radius: 8px; padding: 20px; background: var(--s2);">';
    html += '<div class="task-header" style="margin-bottom: 20px;">';
    html += '<div style="flex: 1;">Match to Property</div>';
    html += '<span class="task-badge urgent" style="margin-left: 10px;">Action Required</span>';
    html += '</div>';

    // Raw data display
    html += '<div style="margin-bottom: 20px; padding: 12px; background: var(--s3); border-radius: 6px; border-left: 3px solid var(--text2);">';
    html += `<div style="font-size: 12px; margin-bottom: 8px;"><strong>Address:</strong> ${esc(item.address || 'N/A')}</div>`;
    html += `<div style="font-size: 12px; margin-bottom: 8px;"><strong>City/State:</strong> ${esc(item.city || '')} ${esc(item.state || '')}</div>`;
    html += `<div style="font-size: 12px; margin-bottom: 8px;"><strong>Table:</strong> ${esc(item.table_name || 'N/A')}</div>`;
    html += `<div style="font-size: 12px;"><strong>Reason:</strong> ${esc(item.reason || 'N/A')}</div>`;
    html += '</div>';

    // Property search
    html += '<div style="margin-bottom: 20px;">';
    html += '<label style="font-weight: 600; font-size: 13px; margin-bottom: 8px; display: block;">Search Properties:</label>';
    html += `<input type="text" id="um-property-search" placeholder="Enter address or property name..." style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--s2); color: var(--text); font-size: 12px; box-sizing: border-box;">`;
    html += '<div id="um-search-results" style="margin-top: 10px; max-height: 150px; overflow-y: auto;"></div>';
    html += '</div>';

    // Manual property ID entry
    html += '<div style="margin-bottom: 20px;">';
    html += '<label style="font-weight: 600; font-size: 13px; margin-bottom: 8px; display: block;">Or Enter Property ID:</label>';
    html += `<input type="number" id="um-property-id" placeholder="Property ID..." style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--s2); color: var(--text); font-size: 12px; box-sizing: border-box;">`;
    html += '</div>';

    // Selected property display
    html += `<div id="um-selected-property" style="margin-bottom: 20px;"></div>`;

    // Notes field
    html += guidedField('um-notes', 'Resolution Notes', '', { type: 'textarea', placeholder: 'Add notes about this resolution...', rows: 3 });

    // Action buttons
    html += '<div class="action-row" style="margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap;">';
    html += `<button class="btn-action primary" data-um-action="resolve" style="flex: 1; min-width: 120px;">Link to Property</button>`;
    html += `<button class="btn-action warn" data-um-action="create" style="flex: 1; min-width: 120px;">Create New Property</button>`;
    html += `<button class="btn-action default" data-um-action="skip" style="flex: 1; min-width: 120px;">Skip</button>`;
    html += `<button class="btn-action danger" data-um-action="dismiss" style="flex: 1; min-width: 120px;">Dismiss</button>`;
    html += '</div>';

    // Inline create-property form (hidden by default)
    html += `<div id="um-create-form" style="display:none;margin-top:16px;padding:14px;background:var(--s3);border-radius:8px;border:1px solid var(--border);">`;
    html += `<div style="font-weight:600;font-size:13px;margin-bottom:10px;color:var(--accent);">Create New Property</div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">`;
    html += `<input type="text" id="um-new-addr" placeholder="Address *" style="padding:7px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);">`;
    html += `<input type="text" id="um-new-name" placeholder="Property Name" style="padding:7px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);">`;
    html += `<input type="text" id="um-new-city" placeholder="City *" style="padding:7px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);">`;
    html += `<input type="text" id="um-new-state" placeholder="State *" style="padding:7px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);">`;
    html += `</div>`;
    html += `<div style="display:flex;gap:8px;">`;
    html += `<button class="btn-action primary" id="um-create-confirm" style="flex:1;">Create & Link</button>`;
    html += `<button class="btn-action default" id="um-create-cancel" style="flex:0;">Cancel</button>`;
    html += `</div>`;
    html += `</div>`;

    html += '</div>';
  } else if (total === 0) {
    html += '<div style="padding: 30px; text-align: center; color: var(--green); font-weight: 600;">All records matched!</div>';
  }

  html += '</div>';

  // Attach handlers
  setTimeout(() => {
    // List item selection
    document.querySelectorAll('[data-um-idx]').forEach(row => {
      row.addEventListener('click', e => {
        diaUnmatchedIdx = parseInt(e.currentTarget.dataset.umIdx, 10);
        renderDiaTab();
      });
    });

    // Property search
    const searchInput = document.getElementById('um-property-search');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', async e => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        const resultsDiv = document.getElementById('um-search-results');
        if (!resultsDiv) return;

        if (query.length < 2) {
          resultsDiv.innerHTML = '';
          return;
        }

        searchTimeout = setTimeout(async () => {
          try {
            const safeQ = query.replace(/[*()',\\]/g, '');
            if (!safeQ) { resultsDiv.innerHTML = ''; return; }
            resultsDiv.innerHTML = '<div style="padding: 8px; font-size: 12px; color: var(--text2);">Searching...</div>';
            const props = await Promise.race([
              diaQuery('properties', 'id, address, city, state, property_name', {
                filter: `or(address.ilike.*${safeQ}*,property_name.ilike.*${safeQ}*)`,
                limit: 10
              }),
              new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, 5000); })
            ]);

            if (props.length === 0) {
              resultsDiv.innerHTML = '<div style="padding: 8px; font-size: 12px; color: var(--text2);">No properties found</div>';
            } else {
              resultsDiv.innerHTML = props.map(p =>
                `<div class="clickable-row um-search-result" data-prop-id="${p.id}" style="padding: 8px; border-bottom: 1px solid var(--border); cursor: pointer; font-size: 12px;">${esc(p.address || '')} - ${esc(p.city || '')} ${esc(p.state || '')}</div>`
              ).join('');

              document.querySelectorAll('.um-search-result').forEach(el => {
                el.addEventListener('click', e => {
                  const propId = parseInt(e.currentTarget.dataset.propId, 10);
                  const propIdEl = document.getElementById('um-property-id');
                  if (propIdEl) propIdEl.value = propId;

                  // Display selected property
                  const prop = props.find(p => p.id === propId);
                  if (prop) {
                    const selectedEl = document.getElementById('um-selected-property');
                    if (selectedEl) selectedEl.innerHTML =
                      `<div style="padding: 12px; background: rgba(52, 211, 153, 0.1); border-radius: 6px; border-left: 3px solid var(--accent);"><strong>Selected:</strong> ${esc(prop.address || '')} (ID: ${prop.id})</div>`;
                  }
                  resultsDiv.innerHTML = '';
                });
              });
            }
          } catch(err) {
            console.error('Property search error:', err);
            if (err.message === 'timeout') {
              resultsDiv.innerHTML = '<div style="padding: 8px; font-size: 12px; color: var(--error);">Search timed out — try again</div>';
            } else {
              resultsDiv.innerHTML = '<div style="padding: 8px; font-size: 12px; color: var(--error);">Search error</div>';
            }
          }
        }, 300);
      });
    }

    // Action buttons
    document.querySelectorAll('[data-um-action]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const action = e.target.dataset.umAction;
        const item = diaUnmatchedQueue[diaUnmatchedIdx];
        if (!item) return;

        // "Create New Property" toggles inline form
        if (action === 'create') {
          const createForm = document.getElementById('um-create-form');
          if (createForm) {
            createForm.style.display = createForm.style.display === 'none' ? 'block' : 'none';
            // Pre-fill with raw record data if available
            const raw = item.raw || item;
            if (raw.address) { const el = document.getElementById('um-new-addr'); if (el && !el.value) el.value = raw.address; }
            if (raw.facility_name) { const el = document.getElementById('um-new-name'); if (el && !el.value) el.value = raw.facility_name; }
            if (raw.city) { const el = document.getElementById('um-new-city'); if (el && !el.value) el.value = raw.city; }
            if (raw.state) { const el = document.getElementById('um-new-state'); if (el && !el.value) el.value = raw.state; }
          }
          return;
        }

        const propIdEl = document.getElementById('um-property-id');
        const propertyId = propIdEl?.value ? parseInt(propIdEl.value, 10) : null;

        if (action === 'resolve' && !propertyId) {
          showToast('Please select or enter a Property ID', 'error');
          return;
        }

        if (action === 'resolve') {
          if (!(await lccConfirm('Link this clinic to Property ID ' + propertyId + '? This cannot be undone.', 'Link'))) return;
        }

        if (action === 'dismiss') {
          if (!(await lccConfirm('Dismiss this unmatched record? It cannot be undone from this view.', 'Dismiss'))) return;
        }

        const allBtns = document.querySelectorAll('[data-um-action]');
        const origText = e.target.textContent;
        allBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });
        e.target.textContent = 'Processing\u2026';
        try {
          await resolveDiaUnmatched(item.id, action, propertyId);
        } catch (err) {
          console.error('resolveDiaUnmatched error:', err);
          showToast('Action failed: ' + err.message, 'error');
          allBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
          e.target.textContent = origText;
        }
      });
    });

    // Create-form confirm & cancel
    const umCreateConfirm = document.getElementById('um-create-confirm');
    if (umCreateConfirm) {
      umCreateConfirm.addEventListener('click', async () => {
        const item = diaUnmatchedQueue[diaUnmatchedIdx];
        if (!item) return;
        const addr = document.getElementById('um-new-addr')?.value?.trim();
        const city = document.getElementById('um-new-city')?.value?.trim();
        const state = document.getElementById('um-new-state')?.value?.trim();
        const name = document.getElementById('um-new-name')?.value?.trim();
        if (!addr || !city || !state) { showToast('Address, city, and state are required', 'error'); return; }
        umCreateConfirm.disabled = true;
        umCreateConfirm.textContent = 'Creating\u2026';
        try {
          const result = await applyInsertWithFallback({
            proxyBase: '/api/dia-query',
            table: 'properties',
            data: { address: addr, city: city, state: state, property_name: name || addr },
            source_surface: 'dia_unmatched_create'
          });
          if (result && result.ok && result.data && result.data[0]) {
            const newId = result.data[0].property_id || result.data[0].id;
            await resolveDiaUnmatched(item.id, 'resolve', newId);
            showToast('Property #' + newId + ' created & linked!', 'success');
          } else {
            showToast('Failed to create property', 'error');
          }
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        } finally {
          umCreateConfirm.disabled = false;
          umCreateConfirm.textContent = 'Create & Link';
        }
      });
    }
    const umCreateCancel = document.getElementById('um-create-cancel');
    if (umCreateCancel) {
      umCreateCancel.addEventListener('click', () => {
        const f = document.getElementById('um-create-form');
        if (f) f.style.display = 'none';
      });
    }
  }, 0);

  return html;
}

/**
 * Render quarantine review interface
 */
function renderDiaQuarantineReview() {
  let html = '<div class="research-progress" style="margin-bottom: 30px;">';

  if (diaQuarantineLoading || !diaQuarantineQueue) {
    html += '<div style="padding:20px;text-align:center;color:var(--text2);">Loading quarantine records...</div>';
    html += '</div>';
    return html;
  }

  const total = diaQuarantineQueue.length;
  html += `<div class="progress-text" style="margin-bottom:10px;"><strong>${total} quarantined records</strong> requiring review</div>`;
  html += '</div>';

  // Two-column layout
  html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start;">';

  // Left: list
  html += '<div style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden; max-height: 500px; overflow-y: auto; background: var(--s2);">';
  html += '<div style="position: sticky; top: 0; background: var(--s3); padding: 12px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 12px; color: var(--text2);">Quarantine Queue</div>';

  if (total === 0) {
    html += '<div style="padding: 30px; text-align: center; color: var(--text2);">No quarantined records</div>';
  } else {
    diaQuarantineQueue.slice(0, 100).forEach((item, idx) => {
      const isSelected = diaQuarantineIdx === idx;
      const daysSince = item.ingested_at ? Math.floor((Date.now() - new Date(item.ingested_at).getTime()) / (1000 * 60 * 60 * 24)) : 0;
      const bgColor = isSelected ? 'background: rgba(52, 211, 153, 0.15); border-left: 3px solid var(--accent);' : 'border-left: 3px solid transparent;';

      html += `<div class="clickable-row" data-q-idx="${idx}" style="padding: 12px; cursor: pointer; border-bottom: 1px solid var(--border); ${bgColor}">`;
      html += `<div style="font-weight: 500; color: var(--red); font-size: 13px; margin-bottom: 4px;">${esc(item.reason || 'Unknown')}</div>`;
      html += `<div style="color: var(--text2); font-size: 11px; margin-bottom: 3px;">${esc(item.source || 'Unknown')}</div>`;
      html += `<div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text2);">`;
      html += `<span>${daysSince}d ago</span>`;
      html += `</div>`;
      html += `</div>`;
    });
  }
  html += '</div>';

  // Right: detail card
  if (total > 0 && diaQuarantineIdx < total) {
    const item = diaQuarantineQueue[diaQuarantineIdx];
    const raw = item.raw || {};

    html += '<div style="border: 1px solid var(--border); border-radius: 8px; padding: 20px; background: var(--s2);">';
    html += '<div class="task-header" style="margin-bottom: 20px;">';
    html += '<div style="flex: 1;">Quarantine Review</div>';
    html += '<span class="task-badge urgent">Needs Review</span>';
    html += '</div>';

    // Raw data display
    html += '<div style="margin-bottom: 20px; padding: 12px; background: var(--s3); border-radius: 6px; border-left: 3px solid var(--red); max-height: 200px; overflow-y: auto; font-size: 12px;">';
    html += `<div style="margin-bottom: 8px;"><strong>Reason:</strong> ${esc(item.reason || 'N/A')}</div>`;
    html += `<div style="margin-bottom: 8px;"><strong>Source:</strong> ${esc(item.source || 'N/A')}</div>`;

    if (raw.facility_name) html += `<div style="margin-bottom: 8px;"><strong>Facility:</strong> ${esc(raw.facility_name)}</div>`;
    if (raw.ccn) html += `<div style="margin-bottom: 8px;"><strong>CCN:</strong> ${esc(raw.ccn)}</div>`;
    if (raw.address) html += `<div style="margin-bottom: 8px;"><strong>Address:</strong> ${esc(raw.address)}</div>`;
    if (raw.city) html += `<div style="margin-bottom: 8px;"><strong>City:</strong> ${esc(raw.city)}</div>`;
    if (raw.state) html += `<div style="margin-bottom: 8px;"><strong>State:</strong> ${esc(raw.state)}</div>`;

    html += '</div>';

    // Property resolution — search or create to link this quarantined record
    html += '<div style="margin-top:16px;padding:12px;background:var(--s3);border-radius:6px;border:1px dashed var(--warning);">';
    html += '<div style="font-size:12px;font-weight:600;color:var(--warning);margin-bottom:8px;">Link to Property (optional)</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
    html += '<input type="text" id="q-prop-search" placeholder="Search by address or name..." style="flex:1;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">';
    html += '<button class="btn-action default" id="q-prop-search-btn" style="padding:6px 12px;font-size:11px;">Search</button>';
    html += '</div>';
    html += '<div id="q-prop-results" style="max-height:120px;overflow-y:auto;margin-bottom:8px;"></div>';
    html += '<div id="q-prop-selected" style="margin-bottom:8px;"></div>';
    html += '<input type="hidden" id="q-prop-id" value="">';
    html += '</div>';

    // Action buttons
    html += '<div class="action-row" style="margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap;">';
    html += `<button class="btn-action primary" data-q-action="reingest" style="flex: 1; min-width: 120px;">Resolve & Re-ingest</button>`;
    html += `<button class="btn-action warn" data-q-action="merge" style="flex: 1; min-width: 120px;">Mark Duplicate</button>`;
    html += `<button class="btn-action danger" data-q-action="dismiss" style="flex: 1; min-width: 120px;">Dismiss</button>`;
    html += '</div>';

    html += '</div>';
  } else if (total === 0) {
    html += '<div style="padding: 30px; text-align: center; color: var(--green); font-weight: 600;">All clear!</div>';
  }

  html += '</div>';

  // Attach handlers
  setTimeout(() => {
    document.querySelectorAll('[data-q-idx]').forEach(row => {
      row.addEventListener('click', e => {
        diaQuarantineIdx = parseInt(e.currentTarget.dataset.qIdx, 10);
        renderDiaTab();
      });
    });

    // Quarantine property search
    const qSearchBtn = document.getElementById('q-prop-search-btn');
    const qSearchInput = document.getElementById('q-prop-search');
    if (qSearchBtn && qSearchInput) {
      const doQSearch = async () => {
        const query = qSearchInput.value.trim();
        const resultsDiv = document.getElementById('q-prop-results');
        if (!resultsDiv) return;
        if (query.length < 2) { showToast('Enter at least 2 characters', 'info'); return; }
        resultsDiv.innerHTML = '<div style="padding:4px;font-size:11px;color:var(--text2);">Searching...</div>';
        try {
          const safeQ = query.replace(/[*()',\\]/g, '');
          const props = await diaQuery('properties', 'property_id,address,city,state,property_name', {
            filter: `or(address.ilike.*${safeQ}*,property_name.ilike.*${safeQ}*)`, limit: 10
          });
          if (!props || props.length === 0) {
            resultsDiv.innerHTML = '<div style="padding:4px;font-size:11px;color:var(--text2);">No properties found</div>';
            return;
          }
          resultsDiv.innerHTML = props.map(p =>
            `<div class="clickable-row q-prop-pick" data-pid="${p.property_id}" style="padding:6px 8px;font-size:11px;border-bottom:1px solid var(--border);cursor:pointer;">${esc(p.address || p.property_name || 'Unknown')} — ${esc((p.city || '') + (p.state ? ', ' + p.state : ''))}</div>`
          ).join('');
          document.querySelectorAll('.q-prop-pick').forEach(el => {
            el.addEventListener('click', () => {
              const pid = el.dataset.pid;
              document.getElementById('q-prop-id').value = pid;
              document.getElementById('q-prop-selected').innerHTML = '<div style="padding:8px;background:rgba(52,211,153,0.1);border-radius:4px;font-size:12px;border-left:3px solid var(--accent);"><strong>Selected:</strong> Property #' + pid + ' — ' + esc(el.textContent) + '</div>';
              resultsDiv.innerHTML = '';
            });
          });
        } catch(e) {
          resultsDiv.innerHTML = '<div style="padding:4px;font-size:11px;color:var(--error);">Search failed</div>';
        }
      };
      qSearchBtn.addEventListener('click', doQSearch);
      qSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doQSearch(); } });
    }

    document.querySelectorAll('[data-q-action]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const action = e.target.dataset.qAction;
        const item = diaQuarantineQueue[diaQuarantineIdx];
        if (!item) return;
        const linkedPropId = document.getElementById('q-prop-id')?.value || null;

        console.debug('Quarantine action:', action, item);

        const allQBtns = document.querySelectorAll('[data-q-action]');
        const origText = e.target.textContent;

        if (action === 'dismiss') {
          if (!(await lccConfirm('Dismiss this quarantined record? It will be removed from the queue.', 'Dismiss'))) return;
        } else if (action === 'reingest') {
          if (!(await lccConfirm('Mark this record as resolved and re-ingest it?', 'Resolve'))) return;
        } else if (action === 'merge') {
          if (!linkedPropId) { showToast('Search and select a property to merge with first', 'warning'); return; }
          if (!(await lccConfirm('Mark as duplicate and link to Property #' + linkedPropId + '?', 'Merge'))) return;
        }

        allQBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });
        e.target.textContent = 'Processing\u2026';
        try {
          const updateData = {
            status: action === 'dismiss' ? 'dismissed' : action === 'merge' ? 'merged' : 'resolved',
            resolved_at: new Date().toISOString(),
            resolved_by: 'dashboard'
          };
          if (linkedPropId) updateData.linked_property_id = parseInt(linkedPropId, 10);
          await diaPatchRecord('medicare_ingest_quarantine', 'id', item.id, updateData);
          diaQuarantineQueue = diaQuarantineQueue.filter((_, i) => i !== diaQuarantineIdx);
          diaQuarantineIdx = Math.min(diaQuarantineIdx, Math.max(0, diaQuarantineQueue.length - 1));
          const labels = { dismiss: 'Dismissed', reingest: 'Resolved & queued for re-ingest', merge: 'Merged with property' };
          showToast(labels[action] || 'Done', 'success');
          renderDiaTab();
        } catch (err) {
          console.error('Quarantine action error:', err);
          showToast('Action failed: ' + err.message, 'error');
          allQBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
          e.target.textContent = origText;
        }
      });
    });
  }, 0);

  return html;
}

/**
 * Render clarification queue interface
 */
function renderDiaClarificationQueue() {
  let html = '<div class="research-progress" style="margin-bottom: 30px;">';

  if (diaClarificationLoading || !diaClarificationQueue) {
    html += '<div style="padding:20px;text-align:center;color:var(--text2);">Loading clarification queue...</div>';
    html += '</div>';
    return html;
  }

  const total = diaClarificationQueue.length;
  html += `<div class="progress-text" style="margin-bottom:10px;"><strong>${total} clarification requests</strong></div>`;
  html += '</div>';

  // Two-column layout
  html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start;">';

  // Left: list
  html += '<div style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden; max-height: 500px; overflow-y: auto; background: var(--s2);">';
  html += '<div style="position: sticky; top: 0; background: var(--s3); padding: 12px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 12px; color: var(--text2);">Pending Clarification</div>';

  if (total === 0) {
    html += '<div style="padding: 30px; text-align: center; color: var(--green);">No pending clarifications</div>';
  } else {
    diaClarificationQueue.slice(0, 100).forEach((item, idx) => {
      const isSelected = diaClarificationIdx === idx;
      const bgColor = isSelected ? 'background: rgba(52, 211, 153, 0.15); border-left: 3px solid var(--accent);' : 'border-left: 3px solid transparent;';

      html += `<div class="clickable-row" data-cl-idx="${idx}" style="padding: 12px; cursor: pointer; border-bottom: 1px solid var(--border); ${bgColor}">`;
      html += `<div style="font-weight: 500; color: var(--text); font-size: 13px; margin-bottom: 4px;">${esc(item.clarification_prompt ? item.clarification_prompt.substring(0, 30) : 'Clarification')}</div>`;
      html += `<div style="color: var(--text2); font-size: 11px;">${esc(item.table_name || 'Unknown')}</div>`;
      html += `</div>`;
    });
  }
  html += '</div>';

  // Right: detail card
  if (total > 0 && diaClarificationIdx < total) {
    const item = diaClarificationQueue[diaClarificationIdx];

    html += '<div style="border: 1px solid var(--border); border-radius: 8px; padding: 20px; background: var(--s2);">';
    html += '<div class="task-header" style="margin-bottom: 20px;">';
    html += '<div style="flex: 1;">Provide Missing Data</div>';
    html += '<span class="task-badge needs-input">Response Needed</span>';
    html += '</div>';

    // Clarification prompt (prominent)
    html += '<div style="margin-bottom: 20px; padding: 12px; background: rgba(251, 191, 36, 0.1); border-radius: 6px; border-left: 3px solid #fbbf24;">';
    html += `<div style="font-weight: 600; color: #fbbf24; font-size: 13px; margin-bottom: 8px;">Question:</div>`;
    html += `<div style="font-size: 13px; color: var(--text);">${esc(item.clarification_prompt || 'Clarification needed')}</div>`;
    html += '</div>';

    // Input field for the missing data
    html += `<div style="margin-bottom: 20px;">`;
    html += `<label style="font-weight: 600; font-size: 13px; margin-bottom: 8px; display: block;">Your Response:</label>`;
    html += `<textarea id="cl-response" placeholder="Enter the missing information..." style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--s2); color: var(--text); font-size: 12px; box-sizing: border-box; min-height: 100px;"></textarea>`;
    html += `</div>`;

    // View related record button — lets user open detail panel for context
    if (item.record_id) {
      html += `<div style="margin-bottom:12px;">`;
      html += `<button class="btn-action default" id="cl-view-record" style="width:100%;font-size:12px;padding:8px;">View Related Record in Detail Panel</button>`;
      html += `</div>`;
    }

    // Action buttons
    html += '<div class="action-row" style="margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap;">';
    html += `<button class="btn-action primary" data-cl-action="submit" style="flex: 1; min-width: 120px;">Submit Data</button>`;
    html += `<button class="btn-action warn" data-cl-action="cannot-determine" style="flex: 1; min-width: 120px;">Cannot Determine</button>`;
    html += `<button class="btn-action default" data-cl-action="skip" style="flex: 1; min-width: 120px;">Skip</button>`;
    html += '</div>';

    html += '</div>';
  }

  html += '</div>';

  // Attach handlers
  setTimeout(() => {
    document.querySelectorAll('[data-cl-idx]').forEach(row => {
      row.addEventListener('click', e => {
        diaClarificationIdx = parseInt(e.currentTarget.dataset.clIdx, 10);
        renderDiaTab();
      });
    });

    // "View Related Record" opens the unified detail panel
    const clViewBtn = document.getElementById('cl-view-record');
    if (clViewBtn) {
      clViewBtn.addEventListener('click', () => {
        const item = diaClarificationQueue[diaClarificationIdx];
        if (!item) return;
        const fakeRec = { property_id: item.property_id || null, medicare_id: item.record_id || null };
        if (typeof showUnifiedDetail === 'function') {
          showUnifiedDetail(fakeRec, 'dia-clinic');
        } else if (typeof showDetail === 'function') {
          showDetail(fakeRec, 'dia-clinic');
        }
      });
    }

    document.querySelectorAll('[data-cl-action]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const action = e.target.dataset.clAction;
        const item = diaClarificationQueue[diaClarificationIdx];
        if (!item) return;

        const response = document.getElementById('cl-response')?.value || '';

        console.debug('Clarification action:', action, item);
        if (action === 'submit') {
          if (!response.trim()) {
            showToast('Please enter your response before submitting', 'error');
            return;
          }
          const allClBtns = document.querySelectorAll('[data-cl-action]');
          allClBtns.forEach(b => { b.disabled = true; });
          e.target.textContent = 'Submitting...';
          // Write clarification response to the source record
          try {
            if (item.table_name && item.record_id) {
              await diaPatchRecord(item.table_name, item.id_column || 'id', item.record_id, {
                [item.field_name || 'clarification_response']: response.trim(),
                clarification_status: 'resolved'
              });
            }
            showToast('Clarification submitted!', 'success');
          } catch(err) {
            console.error('Clarification submit error:', err);
            showToast('Submit failed: ' + err.message + ' — please retry', 'error');
            allClBtns.forEach(b => { b.disabled = false; });
            e.target.textContent = 'Submit Data';
            return;
          }
          diaClarificationQueue = diaClarificationQueue.filter((_, i) => i !== diaClarificationIdx);
          diaClarificationIdx = Math.min(diaClarificationIdx, Math.max(0, diaClarificationQueue.length - 1));
          renderDiaTab();
        } else if (action === 'cannot-determine') {
          if (!(await lccConfirm('Mark as "Cannot Determine"? The item will be removed from your queue.', 'Cannot Determine'))) return;
          const clItem = diaClarificationQueue[diaClarificationIdx];
          if (clItem && clItem.id) {
            const ok = await diaPatchRecord('pending_updates', 'id', clItem.id, { status: 'cannot_determine' });
            if (!ok) { showToast('Failed to persist — please retry', 'error'); return; }
          }
          diaClarificationQueue = diaClarificationQueue.filter((_, i) => i !== diaClarificationIdx);
          diaClarificationIdx = Math.min(diaClarificationIdx, Math.max(0, diaClarificationQueue.length - 1));
          showToast('Marked as cannot determine', 'success');
          renderDiaTab();
        } else if (action === 'skip') {
          const prevIdx = diaClarificationIdx;
          diaClarificationIdx = Math.min(diaClarificationIdx + 1, Math.max(0, diaClarificationQueue.length - 1));
          if (diaClarificationIdx === prevIdx && diaClarificationQueue.length > 0) {
            showToast('End of clarification queue reached', 'info');
          } else {
            showToast('Skipped — ' + (diaClarificationIdx + 1) + ' / ' + diaClarificationQueue.length, 'info');
          }
          renderDiaTab();
        }
      });
    });
  }, 0);

  return html;
}

/**
 * Render staleness monitor
 */
function renderDiaStalenessMonitor() {
  let html = '<div style="margin-bottom: 30px;">';

  if (diaStalenessLoading || !diaStalenessData) {
    html += '<div style="padding:20px;text-align:center;color:var(--text2);">Loading staleness data...</div>';
    html += '</div>';
    return html;
  }

  html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">';
  html += '<div style="font-size: 16px; font-weight: 600;">Data Source Freshness</div>';
  html += `<button class="btn-action default" id="dia-refresh-staleness" style="padding: 6px 12px; font-size: 12px;">Refresh</button>`;
  html += '</div>';

  // Grid of source health
  html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px;">';

  if (diaStalenessData.length === 0) {
    html += '<div style="padding: 30px; text-align: center; color: var(--text2);">No staleness data available</div>';
  } else {
    diaStalenessData.forEach(source => {
      const lastUpdate = source.last_update_date ? new Date(source.last_update_date) : null;
      const daysSince = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24)) : null;

      let color = 'var(--text2)';
      let badge = 'Unknown';
      if (daysSince !== null) {
        if (daysSince < 7) {
          color = 'var(--green)';
          badge = 'Fresh';
        } else if (daysSince < 30) {
          color = '#fbbf24';
          badge = 'Stale';
        } else {
          color = 'var(--red)';
          badge = 'Very Stale';
        }
      }

      html += '<div style="border: 1px solid var(--border); border-radius: 8px; padding: 15px; background: var(--s2);">';
      html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">`;
      html += `<div style="font-weight: 600; color: var(--text);">${esc(source.source || 'Unknown')}</div>`;
      html += `<span class="task-badge" style="background: ${color}; color: white; border: none;">${badge}</span>`;
      html += `</div>`;
      html += `<div style="font-size: 13px; color: var(--text2); margin-bottom: 8px;">`;
      if (daysSince !== null) {
        html += `Last updated: <strong style="color: ${color};">${daysSince} days ago</strong>`;
      } else {
        html += `Last updated: Unknown`;
      }
      html += `</div>`;
      if (source.run_status) {
        html += `<div style="font-size: 12px; color: var(--text2);">Status: ${esc(source.run_status)}</div>`;
      }
      html += '</div>';
    });
  }

  html += '</div>';
  html += '</div>';

  // Attach handlers
  setTimeout(() => {
    document.getElementById('dia-refresh-staleness')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Refreshing...';
      diaStalenessData = null;
      await loadDiaStalenessData();
      // renderDiaTab rebuilds the button fresh
    });
  }, 0);

  return html;
}

/**
 * Render run health dashboard
 */
function renderDiaRunHealth() {
  let html = '<div style="margin-bottom: 30px;">';

  if (diaRunHealthLoading || !diaRunHealthData) {
    html += '<div style="padding:20px;text-align:center;color:var(--text2);">Loading run health data...</div>';
    html += '</div>';
    return html;
  }

  // Summary metrics
  const successfulRuns = diaRunHealthData.filter(r => r.run_status === 'success').length;
  const totalRuns = diaRunHealthData.length;
  const lastRun = diaRunHealthData.length > 0 ? diaRunHealthData[0] : null;
  const errorRate = totalRuns > 0 ? Math.round((totalRuns - successfulRuns) / totalRuns * 100) : 0;

  html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 30px;">';
  html += '<div style="border: 1px solid var(--border); border-radius: 8px; padding: 15px; background: var(--s2);">';
  html += '<div style="font-size: 11px; color: var(--text2); margin-bottom: 5px;">Last Run</div>';
  html += `<div style="font-size: 14px; font-weight: 600; color: var(--text);">${lastRun && lastRun.finished_at ? new Date(lastRun.finished_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}</div>`;
  html += '</div>';

  html += '<div style="border: 1px solid var(--border); border-radius: 8px; padding: 15px; background: var(--s2);">';
  html += '<div style="font-size: 11px; color: var(--text2); margin-bottom: 5px;">Success Rate</div>';
  html += `<div style="font-size: 14px; font-weight: 600; color: ${successfulRuns === totalRuns ? 'var(--green)' : 'var(--text)'};">${successfulRuns} / ${totalRuns}</div>`;
  html += '</div>';

  html += '<div style="border: 1px solid var(--border); border-radius: 8px; padding: 15px; background: var(--s2);">';
  html += '<div style="font-size: 11px; color: var(--text2); margin-bottom: 5px;">Error Rate</div>';
  html += `<div style="font-size: 14px; font-weight: 600; color: ${errorRate > 0 ? 'var(--red)' : 'var(--green)'};">${errorRate}%</div>`;
  html += '</div>';
  html += '</div>';

  // Recent runs table
  html += '<div style="margin-bottom: 30px;">';
  html += '<div style="font-size: 14px; font-weight: 600; margin-bottom: 15px;">Recent Runs</div>';
  html += '<div style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--s2);">';
  html += '<div style="display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr 0.8fr; gap: 0; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 12px; padding: 12px; background: var(--s3); color: var(--text2);">';
  html += '<div>Task / Source</div>';
  html += '<div>Status</div>';
  html += '<div>Started</div>';
  html += '<div>Stats</div>';
  html += '<div>Actions</div>';
  html += '</div>';

  if (diaRunHealthData.length === 0) {
    html += '<div style="padding: 30px; text-align: center; color: var(--text2);">No run data available</div>';
  } else {
    diaRunHealthData.slice(0, 20).forEach((run, idx) => {
      const statusColor = run.run_status === 'success' ? 'var(--green)' : 'var(--red)';
      const startedTime = run.started_at ? new Date(run.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
      const stats = `${run.rows_fetched || 0}F / ${run.rows_inserted || 0}I / ${run.rows_updated || 0}U`;

      html += '<div style="display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr 0.8fr; gap: 0; padding: 12px; border-bottom: 1px solid var(--border); font-size: 12px; align-items: center;">';
      html += `<div><strong>${esc(run.task_name || run.source || 'Unknown')}</strong></div>`;
      html += `<div><span class="task-badge" style="background: ${statusColor}; color: white; border: none; font-size: 11px;">${run.run_status || 'pending'}</span></div>`;
      html += `<div style="color: var(--text2);">${startedTime}</div>`;
      html += `<div style="color: var(--text2); font-size: 11px;">${stats}</div>`;
      html += `<div><button class="btn-link" data-rh-expand="${idx}" style="font-size: 11px; cursor: pointer;">Detail</button></div>`;
      html += '</div>';

      // Expandable error detail
      if (run.error_summary || run.error_log) {
        html += `<div id="rh-detail-${idx}" style="display: none; padding: 12px; background: var(--s3); border-bottom: 1px solid var(--border); font-size: 11px; color: var(--text2); max-height: 150px; overflow-y: auto;">`;
        if (run.error_summary) html += `<div><strong>Error:</strong> ${esc(run.error_summary)}</div>`;
        if (run.error_log) html += `<div style="margin-top: 8px; font-family: monospace; white-space: pre-wrap; word-break: break-word;">${esc(run.error_log.substring(0, 300))}</div>`;
        html += `</div>`;
      }
    });
  }
  html += '</div>';
  html += '</div>';

  // Attach handlers
  setTimeout(() => {
    document.querySelectorAll('[data-rh-expand]').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = e.target.dataset.rhExpand;
        const detail = document.getElementById(`rh-detail-${idx}`);
        if (detail) {
          detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
          e.target.textContent = detail.style.display === 'none' ? 'Detail' : 'Hide';
        }
      });
    });
  }, 0);

  return html;
}

// ============================================================================
// ACTION HANDLER FUNCTIONS
// ============================================================================

/**
 * Resolve unmatched clinic
 */
async function resolveDiaUnmatched(updateId, action, propertyId) {
  const notes = document.getElementById('um-notes')?.value || '';
  const status = action === 'dismiss' ? 'dismissed' : action === 'resolve' ? 'resolved' : 'needs_match';

  console.debug('Resolving unmatched:', { updateId, action, propertyId, status, notes });

  try {
    const updateData = {
      status: status,
      resolved_at: new Date().toISOString(),
      resolved_by: 'dashboard'
    };

    if (notes) {
      updateData.notes = notes;
    }

    if (propertyId && status === 'resolved') {
      updateData.property_id = propertyId;
    }

    const ok = await diaPatchRecord('pending_updates', 'id', updateId, updateData);

    if (ok) {
      diaUnmatchedQueue = diaUnmatchedQueue.filter(r => r.id !== updateId);
      diaUnmatchedIdx = Math.min(diaUnmatchedIdx, Math.max(0, diaUnmatchedQueue.length - 1));
      const actionLabel = action === 'dismiss' ? 'Dismissed' : action === 'resolve' ? 'Linked to property' : action === 'create' ? 'New property created' : 'Skipped';
      showToast(actionLabel, 'success');
      renderDiaTab();
    } else {
      console.error('Failed to resolve unmatched record:', updateId);
      showToast('Failed to resolve record — please try again', 'error');
    }
  } catch(e) {
    console.error('Error resolving unmatched:', e);
    showToast('Error: ' + e.message, 'error');
  }
}

// ============================================================================
// RESEARCH TAB (WORKBENCH)
// ============================================================================

/**
 * Render research workbench — pipeline-ordered human closed-loop interface.
 * Tabs follow the logical data lifecycle from ingest → enrichment → prospecting → monitoring.
 */
function renderDiaResearch() {
  let html = '<div class="research-workbench">';

  // Queue counts for badges
  const qCount = diaQuarantineQueue ? diaQuarantineQueue.length : null;
  const umCount = diaUnmatchedQueue ? diaUnmatchedQueue.length : null;
  const clCount = diaClarificationQueue ? diaClarificationQueue.length : null;
  const inCount = diaIntakeQueue ? diaIntakeQueue.length : null;
  const prCount = (diaData.propertyReviewQueue || []).length;
  const lbCount = (diaData.leaseBackfillRows || []).length;
  const clLeadCount = diaClinicLeadQueue ? diaClinicLeadQueue.length : null;

  // Pipeline step definitions — ordered from data ingest to prospecting to monitoring
  const pipelineSteps = [
    { key: 'quarantine',     num: '1', label: 'Quarantine',       count: qCount,     phase: 'ingest',      desc: 'Fix bad data caught during ingest' },
    { key: 'unmatched',      num: '2', label: 'Unmatched',        count: umCount,    phase: 'ingest',      desc: 'Link clinics to property records' },
    { key: 'clarification',  num: '3', label: 'Clarification',    count: clCount,    phase: 'ingest',      desc: 'Answer missing required fields' },
    { key: 'intake',         num: '4', label: 'Intake',           count: inCount,    phase: 'ingest',      desc: 'Review email intake documents before DB promotion' },
    { key: 'property',       num: '5', label: 'Property Review',  count: prCount,    phase: 'enrichment',  desc: 'Verify property-clinic links' },
    { key: 'lease',          num: '6', label: 'Lease Backfill',   count: lbCount,    phase: 'enrichment',  desc: 'Research missing lease data' },
    { key: 'clinic_leads',   num: '7', label: 'Clinic Leads',     count: clLeadCount, phase: 'prospecting', desc: 'Qualify leads for outreach' },
    { key: 'staleness',      num: '',  label: 'Staleness',        count: null,       phase: 'monitoring',  desc: 'Data freshness monitoring' },
    { key: 'run_health',     num: '',  label: 'Run Health',       count: null,       phase: 'monitoring',  desc: 'Pipeline run diagnostics' },
  ];

  // Phase labels for visual grouping
  const phases = [
    { key: 'ingest',      label: 'DATA QUALITY',  color: '#f87171', icon: '🛡️' },
    { key: 'enrichment',  label: 'ENRICHMENT',    color: '#fbbf24', icon: '🔍' },
    { key: 'prospecting', label: 'PROSPECTING',   color: '#34d399', icon: '🎯' },
    { key: 'monitoring',  label: 'MONITORING',    color: '#60a5fa', icon: '📊' },
  ];

  // Current step's phase
  const currentStep = pipelineSteps.find(s => s.key === diaResearchMode) || pipelineSteps[0];
  const currentPhase = phases.find(p => p.key === currentStep.phase) || phases[0];

  // === Pipeline progress bar ===
  html += '<div style="display:flex;gap:0;margin-bottom:16px;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--s2);height:4px">';
  phases.forEach(ph => {
    const stepsInPhase = pipelineSteps.filter(s => s.phase === ph.key);
    const isActive = ph.key === currentStep.phase;
    const isPast = phases.indexOf(ph) < phases.indexOf(currentPhase);
    const pct = (stepsInPhase.length / pipelineSteps.length * 100).toFixed(0);
    const bg = isActive ? ph.color : isPast ? ph.color + '60' : 'transparent';
    html += `<div style="flex:${stepsInPhase.length};height:100%;background:${bg};transition:background 0.3s"></div>`;
  });
  html += '</div>';

  // === Tab strip — unified pipeline order ===
  html += '<div style="display:flex;gap:0;margin-bottom:20px;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--s2)">';

  let lastPhase = '';
  pipelineSteps.forEach((step, i) => {
    const isActive = diaResearchMode === step.key;
    const phase = phases.find(p => p.key === step.phase);
    const showSeparator = step.phase !== lastPhase && i > 0;
    lastPhase = step.phase;

    // Phase separator
    if (showSeparator) {
      html += '<div style="width:1px;background:var(--border);flex-shrink:0"></div>';
    }

    // Tab button
    const activeBg = isActive ? phase.color + '18' : 'transparent';
    const activeBorder = isActive ? 'border-bottom:2px solid ' + phase.color + ';' : '';
    const activeColor = isActive ? phase.color : 'var(--text2)';
    const fontWeight = isActive ? '700' : '500';
    const badge = step.count != null && step.count > 0
      ? `<span style="display:inline-block;min-width:18px;text-align:center;padding:1px 5px;border-radius:10px;font-size:9px;font-weight:700;background:${phase.color}20;color:${phase.color};margin-left:4px">${step.count > 999 ? '999+' : step.count}</span>`
      : step.count === 0 ? '<span style="display:inline-block;min-width:18px;text-align:center;padding:1px 5px;border-radius:10px;font-size:9px;font-weight:700;background:var(--s3);color:var(--text3);margin-left:4px">0</span>' : '';
    const numBadge = step.num ? `<span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:50%;font-size:9px;font-weight:700;background:${isActive ? phase.color : 'var(--s3)'};color:${isActive ? '#fff' : 'var(--text3)'};margin-right:4px">${step.num}</span>` : '';

    html += `<button data-mode="${step.key}" style="flex:1;padding:10px 6px;font-size:11px;font-weight:${fontWeight};color:${activeColor};background:${activeBg};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:2px;white-space:nowrap;${activeBorder}transition:all 0.2s" title="${step.desc}">`;
    html += numBadge;
    html += `<span>${step.label}</span>`;
    html += badge;
    html += '</button>';
  });

  html += '</div>';

  // === Phase context header ===
  html += `<div style="padding:10px 14px;background:${currentPhase.color}10;border-radius:8px;border-left:3px solid ${currentPhase.color};margin-bottom:16px;display:flex;align-items:center;gap:10px;">`;
  html += `<span style="font-size:18px">${currentPhase.icon}</span>`;
  html += `<div>`;
  html += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:${currentPhase.color};margin-bottom:2px">${currentPhase.label}${currentStep.num ? ' — Step ' + currentStep.num + ' of 7' : ''}</div>`;
  html += `<div style="font-size:13px;color:var(--text);line-height:1.4"><strong>${currentStep.label}:</strong> ${currentStep.desc}</div>`;
  html += '</div></div>';

  // Live Intake workbench - only show for enrichment/prospecting modes
  const isResearchMode = ['property', 'lease', 'clinic_leads'].includes(diaResearchMode);
  if (isResearchMode) {
    html += renderLiveIngestWorkbench('dialysis');
  }

  // Render selected mode
  if (diaResearchMode === 'quarantine') {
    if (!diaQuarantineQueue) loadDiaQuarantineQueue();
    html += renderDiaQuarantineReview();
  } else if (diaResearchMode === 'unmatched') {
    if (!diaUnmatchedQueue) loadDiaUnmatchedQueue();
    html += renderDiaUnmatchedClinics();
  } else if (diaResearchMode === 'clarification') {
    if (!diaClarificationQueue) loadDiaClarificationQueue();
    html += renderDiaClarificationQueue();
  } else if (diaResearchMode === 'intake') {
    if (!diaIntakeQueue) loadDiaIntakeQueue();
    html += renderDiaIntakeQueue();
  } else if (diaResearchMode === 'property') {
    html += renderDiaPropertyResearch();
  } else if (diaResearchMode === 'lease') {
    html += renderDiaLeaseResearch();
  } else if (diaResearchMode === 'clinic_leads') {
    html += renderDiaClinicLeads();
  } else if (diaResearchMode === 'staleness') {
    if (!diaStalenessData) loadDiaStalenessData();
    html += renderDiaStalenessMonitor();
  } else if (diaResearchMode === 'run_health') {
    if (!diaRunHealthData) loadDiaRunHealthData();
    html += renderDiaRunHealth();
  }

  html += '</div>';

  // Attach mode handlers
  setTimeout(() => {
    bindLiveIngestWorkbench('dialysis');
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        diaResearchMode = btn.dataset.mode;
        diaResearchIdx = 0;
        renderDiaTab();
      });
    });
  }, 0);

  return html;
}

// Keyboard shortcuts for dialysis research workflow
(function() {
  document.addEventListener('keydown', function(e) {
    // Only active when a dialysis research card is visible and no input/textarea is focused
    if (!document.querySelector('.research-card') && !document.querySelector('[data-confirm-prop]') && !document.querySelector('[data-verify-lease]') && !document.getElementById('clSaveBtn') && !document.getElementById('clNextBtn')) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    // Only when dialysis tab is active
    if (!document.querySelector('[data-mode="property"]')) return;

    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      // Click the visible skip button
      var skipBtn = document.querySelector('[data-skip-prop]') || document.querySelector('[data-skip-lease]') || document.getElementById('clSkipBtn');
      if (skipBtn) skipBtn.click();
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      // Click the visible save/confirm button
      var saveBtn = document.querySelector('[data-confirm-prop]') || document.querySelector('[data-verify-lease]') || document.getElementById('clSaveBtn');
      if (saveBtn) saveBtn.click();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      // N = Next step in multi-step forms
      if (document.querySelector('[data-verify-lease]')) {
        // Lease backfill: 5 steps (0-4)
        if (diaLeaseBackfillStep < 4) window.diaLeaseStepNav(diaLeaseBackfillStep + 1);
      } else if (document.getElementById('clSaveBtn') || document.getElementById('clNextBtn')) {
        // Clinic leads: 5 steps (0-4)
        if (diaClinicLeadStep < 4) window.diaClStepNav(diaClinicLeadStep + 1);
      }
    } else if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      // B = Back step in multi-step forms
      if (document.querySelector('[data-verify-lease]')) {
        if (diaLeaseBackfillStep > 0) window.diaLeaseStepNav(diaLeaseBackfillStep - 1);
      } else if (document.getElementById('clSaveBtn') || document.getElementById('clNextBtn') || document.getElementById('clBackBtn')) {
        if (diaClinicLeadStep > 0) window.diaClStepNav(diaClinicLeadStep - 1);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      // Ctrl+Enter (or Cmd+Enter on Mac) saves the current research card
      var saveBtn = document.querySelector('.research-card button[onclick*="save"], .research-card button[onclick*="Save"]');
      if (saveBtn && !saveBtn.disabled) {
        saveBtn.click();
      }
    }
  });
})();

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

  // Keyboard shortcuts hint
  html += '<div style="display:flex;gap:10px;margin-bottom:12px;padding:6px 10px;background:var(--s2);border-radius:6px;font-size:11px;color:var(--text3);align-items:center;">';
  html += '<span><kbd style="padding:2px 6px;background:var(--s3);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:monospace;">S</kbd> Save</span>';
  html += '<span><kbd style="padding:2px 6px;background:var(--s3);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:monospace;">K</kbd> Skip</span>';
  html += '</div>';

  // Filter
  html += '<div class="pills" style="margin: 20px 0;">';
  html += '<button class="pill active" data-filter-type="all">All</button>';
  const reviewTypes = [...new Set(diaData.propertyReviewQueue.map(r => r.review_type))];
  reviewTypes.forEach(type => {
    html += `<button class="pill" data-filter-type="${type}">${type}</button>`;
  });
  html += '</div>';

  // Hide reviewed toggle
  const propReviewedCount = diaData.researchOutcomes.filter(o => o.queue_type === 'property_review').length;
  html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">';
  html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text2)">';
  html += '<input type="checkbox" id="propHideReviewed" ' + (diaPropertyFilter.hideReviewed ? 'checked' : '') + ' style="accent-color:var(--accent)" />';
  html += 'Hide reviewed (' + propReviewedCount + ')</label>';
  html += '</div>';

  // Pre-compute filter for operations card (show at top, before list)
  let filtered = diaData.propertyReviewQueue;
  if (diaPropertyFilter.hideReviewed) {
    const reviewedClinicIds = new Set(diaData.researchOutcomes.filter(o => o.queue_type === 'property_review').map(o => o.clinic_id));
    filtered = filtered.filter(r => !reviewedClinicIds.has(r.clinic_id));
  }
  if (diaPropertyFilter.review_type) {
    filtered = filtered.filter(r => r.review_type === diaPropertyFilter.review_type);
  }

  // Operations card — render at the top so it's immediately visible
  if (diaPropertyFilter.selectedIdx !== undefined && filtered[diaPropertyFilter.selectedIdx]) {
    const item = filtered[diaPropertyFilter.selectedIdx];
    html += renderDiaPropertyCard(item);
  }

  // Queue table
  html += '<div class="table-wrapper" style="margin-bottom: 20px;">';
  html += '<div class="data-table">';

  if (filtered.length === 0) {
    const totalPropItems = diaData.propertyReviewQueue.length;
    const reviewedPropItems = diaData.researchOutcomes.filter(o => o.queue_type === 'property_review').length;
    html += '<div class="table-empty">';
    if (diaPropertyFilter.review_type) {
      html += 'No items match the "' + esc(diaPropertyFilter.review_type) + '" filter. <button class="btn-link" onclick="diaPropertyFilter.review_type=null;renderDiaTab()">Show all</button>';
    } else if (totalPropItems === 0) {
      html += 'Property review queue is empty. New items will appear when the data pipeline detects properties needing verification.';
    } else {
      html += 'All ' + totalPropItems + ' items have been reviewed (' + reviewedPropItems + ' outcomes recorded). <button class="btn-link" onclick="diaPropertyFilter.review_type=null;renderDiaTab()">Refresh</button>';
    }
    html += '</div>';
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
      html += `<div style="flex: 0.5; color: var(--text2);">${esc(String(row.clinic_id || ''))}</div>`;
      html += `<div style="flex: 2;" class="truncate">${esc(row.facility_name || '')}</div>`;
      html += `<div style="flex: 1;">${row.operator_name ? entityLink(row.operator_name, 'operator', null) : ''}</div>`;
      html += `<div style="flex: 0.5;">${esc(row.state || '')}</div>`;
      html += `<div style="flex: 0.7; text-align: right; color: var(--accent);">${fmtN(row.total_patients || 0)}</div>`;
      html += `<div style="flex: 1; color: var(--text2);">${esc(row.review_type || '')}</div>`;
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
        const idx = parseInt(e.currentTarget.dataset.propIdx, 10);
        diaPropertyFilter.selectedIdx = idx;
        renderDiaTab();
      });
    });

    const propHideEl = document.getElementById('propHideReviewed');
    if (propHideEl) {
      propHideEl.addEventListener('change', () => {
        diaPropertyFilter.hideReviewed = propHideEl.checked;
        renderDiaTab();
      });
    }
  }, 0);
  
  return html;
}

/**
 * Render property review card
 */
function renderDiaPropertyCard(item) {
  let html = '<div class="research-card" style="display: grid; grid-template-columns: 1fr 400px; gap: 20px; margin-top: 20px;">';

  // Context panel (left) — EXPLAIN the issue and show what needs resolving
  html += '<div class="research-context">';

  // Task header with human-readable explanation
  const reviewType = item.review_type || '';
  const taskExplanations = {
    'multiple_property_candidates': 'This clinic matches multiple properties in our database. Pick the correct one below.',
    'no_property_link': 'This clinic has no linked property record. Search for a matching property or create a new one.',
    'no_exact_property_candidate': 'No exact address match in our property database. Search by name or street, or create a new property.',
    'fuzzy_property_candidates': 'Likely matches found via fuzzy address similarity. Click to link the right one.',
    'single_lower_confidence_candidate': 'One candidate found below. Confirm if correct, or search for the right property.',
    'address_mismatch': 'The clinic address doesn\'t match the linked property. Verify the correct address and update.',
    'stale_match': 'This property link hasn\'t been verified recently. Confirm the link is still correct.',
    'ownership_conflict': 'Ownership data conflicts between sources. Review and confirm the correct owner.',
    'data_quality': 'Data quality flags detected. Review the fields below and correct any errors.'
  };
  const explanation = taskExplanations[reviewType] || ('Review needed: ' + (item.review_reason || reviewType).replace(/_/g, ' '));

  html += '<div style="padding:14px;background:rgba(251,191,36,0.08);border-radius:8px;border-left:3px solid #fbbf24;margin-bottom:16px;">';
  html += '<div style="font-weight:700;font-size:14px;margin-bottom:6px;color:var(--text)">What To Do</div>';
  html += '<div style="font-size:13px;color:var(--text);line-height:1.5;">' + esc(explanation) + '</div>';
  html += '</div>';

  // Clinic context — what we know
  html += '<div style="background:var(--s2);border-radius:8px;padding:14px;margin-bottom:12px;">';
  html += '<div style="font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:10px;">Clinic Record</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">';
  html += '<div><span style="color:var(--text3)">Facility:</span> <strong>' + esc(item.facility_name || '—') + '</strong></div>';
  html += '<div><span style="color:var(--text3)">Clinic ID:</span> ' + esc(String(item.clinic_id || '—')) + '</div>';
  html += '<div><span style="color:var(--text3)">Operator:</span> ' + (item.operator_name ? entityLink(item.operator_name, 'operator', null) : '—') + '</div>';
  html += '<div><span style="color:var(--text3)">Patients:</span> ' + fmtN(item.total_patients || 0) + '</div>';
  if (item.address) html += '<div><span style="color:var(--text3)">Address:</span> ' + esc(item.address) + '</div>';
  if (item.city || item.state) html += '<div><span style="color:var(--text3)">Location:</span> ' + esc((item.city || '') + (item.city && item.state ? ', ' : '') + (item.state || '')) + '</div>';
  html += '</div></div>';

  // If property_id exists, show linked property
  if (item.property_id) {
    html += '<div style="background:rgba(52,211,153,0.08);border-radius:8px;padding:14px;margin-bottom:12px;border-left:3px solid var(--accent);">';
    html += '<div style="font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--accent);margin-bottom:6px;">Currently Linked Property</div>';
    html += '<div style="font-size:12px;">Property #' + item.property_id;
    if (item.property_name) html += ' — ' + esc(item.property_name);
    if (item.property_address) html += '<br>' + esc(item.property_address);
    html += '</div>';
    html += '<button class="btn-action default" style="margin-top:8px;font-size:11px;padding:4px 10px;" onclick=\'showDetail(' + safeJSON(item) + ',"dia-clinic")\'>Open in Detail Panel</button>';
    html += '</div>';
  }

  // Review type detail + suggested candidates (one-click chips)
  const suggested = Array.isArray(item.suggested_candidates) ? item.suggested_candidates : [];
  if (suggested.length > 0) {
    html += renderSuggestedCandidates(item, suggested);
  } else if (item.candidate_types) {
    html += '<div style="background:rgba(251,191,36,0.06);border-radius:8px;padding:14px;margin-bottom:12px;border-left:3px solid #fbbf24;">';
    html += '<div style="font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#fbbf24;margin-bottom:6px;">Property Candidates</div>';
    html += '<div style="font-size:12px;color:var(--text);">' + esc(item.candidate_types) + '</div>';
    html += '<div style="font-size:11px;color:var(--text2);margin-top:4px;">No address-based suggestions — use Search below.</div>';
    html += '</div>';
  }

  // Quick research links
  const searchQ = (item.facility_name || '') + ' ' + (item.address || '') + ' ' + (item.city || '') + ' ' + (item.state || '');
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
  html += '<a href="https://www.google.com/search?q=' + encodeURIComponent(searchQ.trim()) + '" target="_blank" rel="noopener" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">Google Search</a>';
  const mapQ = encodeURIComponent((item.address || '') + ' ' + (item.city || '') + ' ' + (item.state || ''));
  html += '<a href="https://www.google.com/maps/search/' + mapQ + '" target="_blank" rel="noopener" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">Google Maps</a>';
  html += '</div>';

  html += '</div>';

  // Form panel (right)
  html += '<div class="research-form">';

  // Completeness bar
  const fields = [
    { name: 'outcome', value: item.outcome, required: true },
    { name: 'property_id', value: item.property_id, required: item.outcome === 'approved_link' },
    { name: 'source', value: item.verification_source },
    { name: 'notes', value: item.notes }
  ];
  const completeness = computeCompleteness(fields);
  html += renderCompletenessBar(completeness);

  // Outcome
  html += guidedField('propOutcome', 'Outcome', item.outcome, {
    type: 'select',
    required: true,
    options: [
      { label: 'Pending Review', value: 'pending_review' },
      { label: 'Approved Link', value: 'approved_link' },
      { label: 'Needs Research', value: 'needs_research' },
      { label: 'Rejected Candidate', value: 'rejected_candidate' },
      { label: 'Escalated', value: 'escalated' }
    ]
  });

  // === PROPERTY RESOLUTION / SEARCH ===
  // Always show search — for unlinked clinics it's the primary workflow;
  // for linked clinics it lets users check for duplicates or re-link.
  html += renderPropertyResolution(item, 'v_clinic_property_link_review_queue', 'clinic_id');

  // Property ID
  html += guidedField('propPropertyId', 'Property ID', item.property_id, {
    type: 'text',
    required: item.outcome === 'approved_link',
    placeholder: 'Enter linked property ID'
  });

  // Verification Source
  html += guidedField('propSource', 'Verification Source', item.verification_source, {
    type: 'select',
    options: [
      { label: 'CoStar', value: 'costar' },
      { label: 'County Records', value: 'county_records' },
      { label: 'Google', value: 'google' },
      { label: 'Manual Verify', value: 'manual_verify' },
      { label: 'Other', value: 'other' }
    ]
  });

  // Notes
  html += guidedField('propNotes', 'Notes', item.notes, {
    type: 'textarea',
    placeholder: 'Add notes...',
    rows: 3
  });

  // Action row
  html += '<div class="action-row">';
  html += `<button class="btn-action primary" data-confirm-prop="${item.clinic_id}">Confirm Link</button>`;
  html += `<button class="btn-action danger" data-reject-prop="${item.clinic_id}">Reject</button>`;
  html += `<button class="btn-action" data-skip-prop="${item.clinic_id}">Skip</button>`;
  html += '</div>';

  html += '</div>';
  html += '</div>';

  setTimeout(() => {
    const confirmBtn = document.querySelector(`[data-confirm-prop="${item.clinic_id}"]`);
    const rejectBtn = document.querySelector(`[data-reject-prop="${item.clinic_id}"]`);
    const skipBtn = document.querySelector(`[data-skip-prop="${item.clinic_id}"]`);

    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const outcome = q('#propOutcome')?.value;
        const propId = q('#propPropertyId')?.value;
        const source = q('#propSource')?.value;
        const notes = q('#propNotes')?.value;

        if (!outcome) {
          showToast('Please select an outcome', 'warning');
          return;
        }

        if (outcome === 'approved_link' && !propId) {
          showToast('Property ID required when approving link', 'warning');
          return;
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Saving\u2026';
        confirmBtn.style.opacity = '0.6';
        try {
          const ok = await saveDiaOutcome('property_review', item.clinic_id, outcome, propId, notes, source);
          if (!ok) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Link'; confirmBtn.style.opacity = ''; }
        } catch (e) { console.error('confirm link error:', e); showToast('Save failed: ' + e.message, 'error'); confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Link'; confirmBtn.style.opacity = ''; }
      });
    }

    if (rejectBtn) {
      rejectBtn.addEventListener('click', async () => {
        const notes = q('#propNotes')?.value;
        rejectBtn.disabled = true;
        rejectBtn.textContent = 'Saving\u2026';
        rejectBtn.style.opacity = '0.6';
        try {
          const ok = await saveDiaOutcome('property_review', item.clinic_id, 'rejected_candidate', '', notes);
          if (!ok) { rejectBtn.disabled = false; rejectBtn.textContent = 'Reject'; rejectBtn.style.opacity = ''; }
        } catch (e) { console.error('reject error:', e); showToast('Reject failed: ' + e.message, 'error'); rejectBtn.disabled = false; rejectBtn.textContent = 'Reject'; rejectBtn.style.opacity = ''; }
      });
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        const filtered = diaData.propertyReviewQueue.filter(r => !diaPropertyFilter.review_type || r.review_type === diaPropertyFilter.review_type);
        const currentIdx = diaPropertyFilter.selectedIdx || 0;
        if (currentIdx + 1 < filtered.length) {
          diaPropertyFilter.selectedIdx = currentIdx + 1;
          showToast('Skipped \u2014 ' + (currentIdx + 2) + ' / ' + filtered.length, 'info');
        } else {
          diaPropertyFilter.selectedIdx = undefined;
          showToast('End of queue reached', 'info');
        }
        renderDiaTab();
      });
    }
  }, 0);

  return html;
}


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

  // Keyboard shortcuts hint
  html += '<div style="display:flex;gap:10px;margin-bottom:12px;padding:6px 10px;background:var(--s2);border-radius:6px;font-size:11px;color:var(--text3);align-items:center;">';
  html += '<span><kbd style="padding:2px 6px;background:var(--s3);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:monospace;">S</kbd> Save</span>';
  html += '<span><kbd style="padding:2px 6px;background:var(--s3);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:monospace;">N</kbd> Next</span>';
  html += '<span><kbd style="padding:2px 6px;background:var(--s3);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:monospace;">B</kbd> Back</span>';
  html += '<span><kbd style="padding:2px 6px;background:var(--s3);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:monospace;">K</kbd> Skip</span>';
  html += '</div>';

  // Filter
  html += '<div class="pills" style="margin: 20px 0;">';
  html += '<button class="pill active" data-filter-priority="all">All</button>';
  ['high', 'medium', 'low'].forEach(priority => {
    html += `<button class="pill" data-filter-priority="${priority}">${priority}</button>`;
  });
  html += '</div>';

  // Hide reviewed toggle
  const leaseReviewedCount = diaData.researchOutcomes.filter(o => o.queue_type === 'lease_backfill').length;
  html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">';
  html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text2)">';
  html += '<input type="checkbox" id="leaseHideReviewed" ' + (diaLeaseFilter.hideReviewed ? 'checked' : '') + ' style="accent-color:var(--accent)" />';
  html += 'Hide reviewed (' + leaseReviewedCount + ')</label>';
  html += '</div>';

  // Queue table
  html += '<div class="table-wrapper" style="margin-bottom: 20px;">';
  html += '<div class="data-table">';

  let filtered = diaData.leaseBackfillRows;
  if (diaLeaseFilter.hideReviewed) {
    const reviewedLeaseIds = new Set(diaData.researchOutcomes.filter(o => o.queue_type === 'lease_backfill').map(o => o.clinic_id));
    filtered = filtered.filter(r => !reviewedLeaseIds.has(r.clinic_id));
  }
  if (diaLeaseFilter.priority) {
    filtered = filtered.filter(r => r.lease_backfill_priority === diaLeaseFilter.priority);
  }

  // Operations card — render at the top so it's immediately visible
  if (diaLeaseFilter.selectedIdx !== undefined && filtered[diaLeaseFilter.selectedIdx]) {
    const item = filtered[diaLeaseFilter.selectedIdx];
    html += renderDiaLeaseCard(item);
  }

  if (filtered.length === 0) {
    const totalLeaseItems = diaData.leaseBackfillRows.length;
    const verifiedLeaseItems = diaData.researchOutcomes.filter(o => o.queue_type === 'lease_backfill' && o.status === 'verified_lease').length;
    html += '<div class="table-empty">';
    if (diaLeaseFilter.priority) {
      html += 'No items match the "' + esc(diaLeaseFilter.priority) + '" priority filter. <button class="btn-link" onclick="diaLeaseFilter.priority=null;renderDiaTab()">Show all</button>';
    } else if (totalLeaseItems === 0) {
      html += 'Lease backfill queue is empty. New items will appear when clinics are identified that need lease data.';
    } else {
      html += 'All ' + totalLeaseItems + ' items have been processed (' + verifiedLeaseItems + ' leases verified). <button class="btn-link" onclick="diaLeaseFilter.priority=null;renderDiaTab()">Refresh</button>';
    }
    html += '</div>';
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
      html += `<div style="flex: 0.5; color: var(--text2);">${esc(String(row.clinic_id || ''))}</div>`;
      html += `<div style="flex: 2;" class="truncate">${esc(row.facility_name || '')}</div>`;
      html += `<div style="flex: 1;">${row.operator_name ? entityLink(row.operator_name, 'operator', null) : ''}</div>`;
      html += `<div style="flex: 0.7; text-align: right; color: var(--accent);">${fmtN(row.total_patients || 0)}</div>`;
      html += `<div style="flex: 1; color: ${watchColor};">${esc(row.closure_watch_level || 'none')}</div>`;
      html += `<div style="flex: 1; color: var(--text2);">${esc(row.lease_backfill_priority || 'unknown')}</div>`;
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
        const idx = parseInt(e.currentTarget.dataset.leaseIdx, 10);
        diaLeaseFilter.selectedIdx = idx;
        renderDiaTab();
      });
    });

    const leaseHideEl = document.getElementById('leaseHideReviewed');
    if (leaseHideEl) {
      leaseHideEl.addEventListener('change', () => {
        diaLeaseFilter.hideReviewed = leaseHideEl.checked;
        renderDiaTab();
      });
    }
  }, 0);
  
  return html;
}

/**
 * Render lease backfill card
 */
function renderDiaLeaseCard(item) {
  const step = diaLeaseBackfillStep || 0;
  let html = '<div class="research-card" style="display: grid; grid-template-columns: 1fr 400px; gap: 20px; margin-bottom: 20px;">';

  // Context panel (left) — explain what's needed and show current data
  html += '<div class="research-context">';

  // Human-readable task explanation
  const backfillExplanations = {
    'no_lease_data': 'This clinic has no lease information on file. Research and enter the lease terms.',
    'expired_lease': 'The lease on file has expired. Verify if the lease was renewed and update the terms.',
    'missing_rent': 'Lease exists but annual rent is missing. Find and enter the rent amount.',
    'missing_term': 'Lease exists but the term/expiration is missing. Find and enter the lease term.',
    'stale_data': 'Lease data hasn\'t been updated in over 12 months. Verify current terms.',
  };
  const explanation = backfillExplanations[item.backfill_reason] || ('Lease data needed: ' + (item.backfill_reason || 'missing information').replace(/_/g, ' '));

  html += '<div style="padding:14px;background:rgba(251,191,36,0.08);border-radius:8px;border-left:3px solid #fbbf24;margin-bottom:16px;">';
  html += '<div style="font-weight:700;font-size:14px;margin-bottom:6px;color:var(--text)">What To Do</div>';
  html += '<div style="font-size:13px;color:var(--text);line-height:1.5;">' + esc(explanation) + '</div>';
  html += '</div>';

  // Clinic context
  html += '<div style="background:var(--s2);border-radius:8px;padding:14px;margin-bottom:12px;">';
  html += '<div style="font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:10px;">Clinic Info</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">';
  html += '<div><span style="color:var(--text3)">Facility:</span> <strong>' + esc(item.facility_name || '\u2014') + '</strong></div>';
  html += '<div><span style="color:var(--text3)">Clinic ID:</span> ' + esc(String(item.clinic_id || '\u2014')) + '</div>';
  html += '<div><span style="color:var(--text3)">Operator:</span> ' + (item.operator_name ? entityLink(item.operator_name, 'operator', null) : '\u2014') + '</div>';
  html += '<div><span style="color:var(--text3)">Patients:</span> ' + fmtN(item.total_patients || 0) + '</div>';
  if (item.address) html += '<div><span style="color:var(--text3)">Address:</span> ' + esc(item.address) + '</div>';
  if (item.city || item.state) html += '<div><span style="color:var(--text3)">Location:</span> ' + esc((item.city || '') + (item.city && item.state ? ', ' : '') + (item.state || '')) + '</div>';
  html += '</div></div>';

  // Current lease data on file — show what exists vs. what's missing
  html += '<div style="background:var(--s2);border-radius:8px;padding:14px;margin-bottom:12px;">';
  html += '<div style="font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:10px;">Lease Data On File</div>';
  const leaseFields = [
    { label: 'Property ID', value: item.property_id, key: 'property_id' },
    { label: 'Lease Term', value: item.lease_term, key: 'lease_term' },
    { label: 'Annual Rent', value: item.annual_rent ? '$' + fmtN(Math.round(item.annual_rent)) : null, key: 'annual_rent' },
    { label: 'Rent/SF', value: item.rent_per_sf ? '$' + Number(item.rent_per_sf).toFixed(2) : null, key: 'rent_per_sf' },
    { label: 'Expiration', value: item.lease_expiration, key: 'lease_expiration' },
    { label: 'Watch Level', value: item.closure_watch_level, key: 'closure_watch_level' },
  ];
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px;">';
  leaseFields.forEach(f => {
    const hasVal = f.value != null && String(f.value).trim() !== '';
    const icon = hasVal ? '<span style="color:var(--success)">\u2713</span>' : '<span style="color:#f87171">\u25CB</span>';
    html += '<div>' + icon + ' <span style="color:var(--text3)">' + f.label + ':</span> ' + (hasVal ? '<strong>' + esc(String(f.value)) + '</strong>' : '<span style="color:#f87171">Missing</span>') + '</div>';
  });
  html += '</div></div>';

  // Quick research links
  const searchQ = (item.facility_name || '') + ' ' + (item.address || '') + ' ' + (item.city || '') + ' ' + (item.state || '') + ' lease';
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
  html += '<a href="https://www.google.com/search?q=' + encodeURIComponent(searchQ.trim()) + '" target="_blank" rel="noopener" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">Google Search</a>';
  if (item.city && item.state) {
    html += '<a href="https://www.google.com/search?q=' + encodeURIComponent(item.city + ' ' + item.state + ' county property records') + '" target="_blank" rel="noopener" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">County Records</a>';
  }
  html += '<button class="btn-action default" style="font-size:11px;padding:4px 10px;" onclick=\'showDetail(' + safeJSON(item) + ',"dia-clinic")\'>Open Detail Panel</button>';
  html += '</div>';

  html += '</div>';

  // Form panel (right) — 5-step workflow
  html += '<div class="research-form">';

  // Completeness bar
  const cFields = [
    { name: 'outcome', value: item.outcome, required: true },
    { name: 'property_id', value: item.property_id, required: item.outcome === 'verified_lease' },
    { name: 'lease_term', value: item.lease_term },
    { name: 'annual_rent', value: item.annual_rent },
    { name: 'rent_per_sf', value: item.rent_per_sf },
    { name: 'source', value: item.lease_source },
    { name: 'notes', value: item.notes }
  ];
  const completeness = computeCompleteness(cFields);
  html += renderCompletenessBar(completeness);

  // Step navigation
  const steps = [
    { label: 'Lease Details', complete: !!item.outcome && item.outcome !== 'pending_backfill' },
    { label: 'Rent Schedule', complete: !!item.annual_rent || !!item.rent_per_sf },
    { label: 'Property', complete: !!item.property_id },
    { label: 'Financing', complete: !!item.lender_name || !!item.loan_amount },
    { label: 'Notes', complete: !!item.notes }
  ];
  html += renderStepNav(step, steps, 'window.diaLeaseStepNav');

  // ===== Step 0: Lease Details =====
  html += '<div class="form-step" style="display:' + (step === 0 ? 'block' : 'none') + ';margin-top:16px">';
  html += '<div class="form-step-head"><h4 style="margin:0;font-size:13px;font-weight:700">Step 1: Lease Details</h4></div>';

  html += guidedField('leaseOutcome', 'Outcome', item.outcome, {
    type: 'select', required: true,
    options: [
      { label: 'Pending Backfill', value: 'pending_backfill' },
      { label: 'Requested Lease', value: 'requested_lease' },
      { label: 'Verified Lease', value: 'verified_lease' },
      { label: 'Not Owned', value: 'not_owned' },
      { label: 'Escalated', value: 'escalated' }
    ]
  });
  html += guidedField('leaseTerm', 'Lease Term', item.lease_term, { type: 'text', placeholder: 'e.g., 10 years' });
  html += guidedField('leaseExpiration', 'Lease Expiration', item.lease_expiration, { type: 'date' });
  html += guidedField('leaseSource', 'Lease Source', item.lease_source, {
    type: 'select',
    options: [
      { label: 'CoStar', value: 'costar' },
      { label: 'Direct Contact', value: 'direct_contact' },
      { label: 'County Records', value: 'county_records' },
      { label: 'Broker', value: 'broker' },
      { label: 'Other', value: 'other' }
    ]
  });
  html += '</div>';

  // ===== Step 1: Rent Schedule =====
  html += '<div class="form-step" style="display:' + (step === 1 ? 'block' : 'none') + ';margin-top:16px">';
  html += '<div class="form-step-head"><h4 style="margin:0;font-size:13px;font-weight:700">Step 2: Rent Schedule</h4></div>';

  html += guidedField('leaseRent', 'Current Annual Rent', item.annual_rent, { type: 'number', placeholder: '$' });
  html += guidedField('leaseRentSF', 'Rent/SF', item.rent_per_sf, { type: 'number', placeholder: '$', step: 0.01 });
  html += guidedField('leaseEscalations', 'Escalations', item.escalations, { type: 'text', placeholder: 'e.g., 2% annual, CPI, fixed' });

  // Prior Leases — bulk entry section
  html += '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
  html += '<div style="font-weight:600;font-size:12px;color:var(--text)">Prior Leases</div>';
  html += '<button id="addPriorLease" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--accent);color:#fff;border:none;cursor:pointer;font-weight:600">+ Add Row</button>';
  html += '</div>';

  // Table header for prior leases
  html += '<div style="font-size:10px;font-weight:600;color:var(--text3);display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr 30px;gap:4px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">';
  html += '<div>Start</div><div>End</div><div>Annual Rent</div><div>Rent/SF</div><div>Escalations</div><div></div>';
  html += '</div>';

  // Existing prior lease rows container
  html += '<div id="priorLeaseRows">';
  var priorLeases = window._diaLeaseFormDraft._priorLeases || [{}];
  priorLeases.forEach(function(pl, pi) {
    html += _renderPriorLeaseRow(pi, pl);
  });
  html += '</div>';
  html += '</div>';
  html += '</div>';

  // ===== Step 2: Property =====
  html += '<div class="form-step" style="display:' + (step === 2 ? 'block' : 'none') + ';margin-top:16px">';
  html += '<div class="form-step-head"><h4 style="margin:0;font-size:13px;font-weight:700">Step 3: Property</h4></div>';
  html += guidedField('leasePropertyId', 'Property ID', item.property_id, { type: 'text', placeholder: 'Enter property ID' });
  html += renderPropertyResolution(item, 'lease_backfill', 'clinic_id');
  html += '</div>';

  // ===== Step 3: Financing =====
  html += '<div class="form-step" style="display:' + (step === 3 ? 'block' : 'none') + ';margin-top:16px">';
  html += '<div class="form-step-head"><h4 style="margin:0;font-size:13px;font-weight:700">Step 4: Financing</h4></div>';
  html += guidedField('leaseLender', 'Lender', item.lender_name, { type: 'text', placeholder: 'Lender name' });
  html += guidedField('leaseLoanAmount', 'Loan Amount', item.loan_amount, { type: 'number', placeholder: '$' });
  html += guidedField('leaseLoanType', 'Loan Type', item.loan_type, {
    type: 'select',
    options: [
      { label: 'Fixed', value: 'fixed' },
      { label: 'Variable', value: 'variable' },
      { label: 'CMBS', value: 'cmbs' },
      { label: 'SBA', value: 'sba' },
      { label: 'Other', value: 'other' }
    ]
  });
  html += guidedField('leaseLoanMaturity', 'Loan Maturity', item.loan_maturity_date, { type: 'date' });
  html += '</div>';

  // ===== Step 4: Notes =====
  html += '<div class="form-step" style="display:' + (step === 4 ? 'block' : 'none') + ';margin-top:16px">';
  html += '<div class="form-step-head"><h4 style="margin:0;font-size:13px;font-weight:700">Step 5: Notes</h4></div>';
  html += guidedField('leaseNotes', 'Notes', item.notes, { type: 'textarea', placeholder: 'Add notes...', rows: 4 });
  html += '</div>';

  // Action buttons — always visible
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">';
  if (step > 0) {
    html += '<button id="leaseBackBtn" style="padding:10px 16px;background:var(--s2);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--text2)">\u2190 Back</button>';
  }
  if (step < 4) {
    html += '<button id="leaseNextBtn" style="flex:1;padding:10px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer">Next \u2192</button>';
  }
  html += '<button class="btn-action primary" data-verify-lease="' + item.clinic_id + '" style="' + (step === 4 ? 'flex:1;' : '') + 'padding:10px 16px;font-size:13px">Verify Lease</button>';
  html += '<button class="btn-action warn" data-notowned-lease="' + item.clinic_id + '" style="padding:10px 16px;font-size:13px">Not Owned</button>';
  html += '<button class="btn-action" data-skip-lease="' + item.clinic_id + '" style="padding:10px 16px;font-size:13px">Skip</button>';
  html += '</div>';

  html += '</div>';
  html += '</div>';

  setTimeout(function() {
    // Step navigation buttons
    var backBtn = document.getElementById('leaseBackBtn');
    var nextBtn = document.getElementById('leaseNextBtn');
    if (backBtn) backBtn.addEventListener('click', function() { window.diaLeaseStepNav(step - 1); });
    if (nextBtn) nextBtn.addEventListener('click', function() { window.diaLeaseStepNav(step + 1); });

    // Prior lease add/remove
    var addBtn = document.getElementById('addPriorLease');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        _capturePriorLeases();
        window._diaLeaseFormDraft._priorLeases.push({});
        renderDiaTab();
      });
    }
    document.querySelectorAll('[data-remove-prior]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _capturePriorLeases();
        var idx = parseInt(btn.dataset.removePrior, 10);
        window._diaLeaseFormDraft._priorLeases.splice(idx, 1);
        if (window._diaLeaseFormDraft._priorLeases.length === 0) window._diaLeaseFormDraft._priorLeases = [{}];
        renderDiaTab();
      });
    });

    // Save / action buttons
    var verifyBtn = document.querySelector('[data-verify-lease="' + item.clinic_id + '"]');
    var notownedBtn = document.querySelector('[data-notowned-lease="' + item.clinic_id + '"]');
    var skipBtn = document.querySelector('[data-skip-lease="' + item.clinic_id + '"]');

    if (verifyBtn) {
      verifyBtn.addEventListener('click', async function() {
        var outcome = q('#leaseOutcome') ? q('#leaseOutcome').value : '';
        var propId = q('#leasePropertyId') ? q('#leasePropertyId').value : '';
        var term = q('#leaseTerm') ? q('#leaseTerm').value : '';
        var rent = q('#leaseRent') ? q('#leaseRent').value : '';
        var rentSF = q('#leaseRentSF') ? q('#leaseRentSF').value : '';
        var source = q('#leaseSource') ? q('#leaseSource').value : '';
        var notes = q('#leaseNotes') ? q('#leaseNotes').value : '';

        if (!outcome) { showToast('Please select an outcome', 'warning'); return; }
        if (outcome === 'verified_lease' && !propId) { showToast('Property ID required when verifying lease', 'warning'); return; }

        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Saving\u2026';
        verifyBtn.style.opacity = '0.6';
        try {
          var ok = await saveDiaOutcome('lease_backfill', item.clinic_id, outcome, propId, notes, source, term, rent, rentSF);
          if (ok) { diaLeaseBackfillStep = 0; window._diaLeaseFormDraft = {}; }
          else { verifyBtn.disabled = false; verifyBtn.textContent = 'Verify Lease'; verifyBtn.style.opacity = ''; }
        } catch (e) { console.error('verify lease error:', e); showToast('Save failed: ' + e.message, 'error'); verifyBtn.disabled = false; verifyBtn.textContent = 'Verify Lease'; verifyBtn.style.opacity = ''; }
      });
    }

    if (notownedBtn) {
      notownedBtn.addEventListener('click', async function() {
        var notes = q('#leaseNotes') ? q('#leaseNotes').value : '';
        notownedBtn.disabled = true;
        notownedBtn.textContent = 'Saving\u2026';
        notownedBtn.style.opacity = '0.6';
        try {
          var ok = await saveDiaOutcome('lease_backfill', item.clinic_id, 'not_owned', '', notes);
          if (ok) { diaLeaseBackfillStep = 0; window._diaLeaseFormDraft = {}; }
          else { notownedBtn.disabled = false; notownedBtn.textContent = 'Not Owned'; notownedBtn.style.opacity = ''; }
        } catch (e) { console.error('not owned error:', e); showToast('Save failed: ' + e.message, 'error'); notownedBtn.disabled = false; notownedBtn.textContent = 'Not Owned'; notownedBtn.style.opacity = ''; }
      });
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', function() {
        var filteredRows = diaData.leaseBackfillRows.filter(function(r) { return !diaLeaseFilter.priority || r.lease_backfill_priority === diaLeaseFilter.priority; });
        var currentIdx = diaLeaseFilter.selectedIdx || 0;
        diaLeaseBackfillStep = 0;
        window._diaLeaseFormDraft = {};
        if (currentIdx + 1 < filteredRows.length) {
          diaLeaseFilter.selectedIdx = currentIdx + 1;
          showToast('Skipped \u2014 ' + (currentIdx + 2) + ' / ' + filteredRows.length, 'info');
        } else {
          diaLeaseFilter.selectedIdx = undefined;
          showToast('End of queue reached', 'info');
        }
        renderDiaTab();
      });
    }
  }, 0);

  return html;
}

// Helper: render a prior lease row for bulk entry
function _renderPriorLeaseRow(idx, data) {
  var d = data || {};
  var html = '<div class="prior-lease-row" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr 30px;gap:4px;margin-bottom:4px">';
  html += '<input type="date" id="pl-start-' + idx + '" value="' + esc(d.start_date || '') + '" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--s2);color:var(--text);box-sizing:border-box" />';
  html += '<input type="date" id="pl-end-' + idx + '" value="' + esc(d.end_date || '') + '" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--s2);color:var(--text);box-sizing:border-box" />';
  html += '<input type="number" id="pl-rent-' + idx + '" value="' + esc(d.annual_rent || '') + '" placeholder="$" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--s2);color:var(--text);box-sizing:border-box" />';
  html += '<input type="number" id="pl-rentsf-' + idx + '" value="' + esc(d.rent_psf || '') + '" placeholder="$/SF" step="0.01" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--s2);color:var(--text);box-sizing:border-box" />';
  html += '<input type="text" id="pl-esc-' + idx + '" value="' + esc(d.escalations || '') + '" placeholder="2% annual" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--s2);color:var(--text);box-sizing:border-box" />';
  html += '<button data-remove-prior="' + idx + '" style="font-size:14px;background:none;border:none;color:#f87171;cursor:pointer;padding:0" title="Remove">\u00D7</button>';
  html += '</div>';
  return html;
}

// Capture prior lease row values into draft
function _capturePriorLeases() {
  var rows = document.querySelectorAll('.prior-lease-row');
  var leases = [];
  rows.forEach(function(row, i) {
    var startEl = document.getElementById('pl-start-' + i);
    var endEl = document.getElementById('pl-end-' + i);
    var rentEl = document.getElementById('pl-rent-' + i);
    var rentsfEl = document.getElementById('pl-rentsf-' + i);
    var escEl = document.getElementById('pl-esc-' + i);
    leases.push({
      start_date: startEl ? startEl.value : '',
      end_date: endEl ? endEl.value : '',
      annual_rent: rentEl ? rentEl.value : '',
      rent_psf: rentsfEl ? rentsfEl.value : '',
      escalations: escEl ? escEl.value : ''
    });
  });
  window._diaLeaseFormDraft._priorLeases = leases;
}


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
        showToast('Clinic leads load failed', 'error');
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

  // Progress bar
  const clTotal = queue.length;
  const clResolved = queue.filter(r => resolvedIds.has(r.medicare_id)).length;
  const clPct = clTotal > 0 ? Math.round((clResolved / clTotal) * 100) : 0;
  html += '<div class="research-progress" style="margin-bottom:16px;">';
  html += `<div class="progress-text">${clResolved} of ${clTotal} reviewed (${clPct}%)</div>`;
  html += `<div class="progress-bar"><div style="width: ${clPct}%; background: #34d399;"></div></div>`;
  html += '</div>';

  // Keyboard hint bar
  html += '<div style="display:flex;gap:10px;margin-bottom:12px;padding:6px 10px;background:var(--s2);border-radius:6px;font-size:11px;color:var(--text3);align-items:center;">';
  html += '<span><kbd style="padding:2px 6px;background:var(--s3);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:monospace;">S</kbd> Save</span>';
  html += '<span><kbd style="padding:2px 6px;background:var(--s3);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:monospace;">N</kbd> Next</span>';
  html += '<span><kbd style="padding:2px 6px;background:var(--s3);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:monospace;">B</kbd> Back</span>';
  html += '<span><kbd style="padding:2px 6px;background:var(--s3);border:1px solid var(--border);border-radius:3px;font-size:10px;font-family:monospace;">K</kbd> Skip</span>';
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

  // Operations card — render at top so it's immediately visible
  const clPage = filtered.slice(0, 50);
  if (diaClinicLeadFilter.selectedIdx !== undefined && clPage[diaClinicLeadFilter.selectedIdx]) {
    html += renderClinicLeadCard(clPage[diaClinicLeadFilter.selectedIdx]);
  }

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

  clPage.forEach((row, idx) => {
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

  if (clPage.length === 0) {
    html += '<div class="table-empty" style="padding:24px;text-align:center;color:var(--text3)">No clinics match current filters</div>';
  }
  html += '</div>';

  // Attach handlers
  setTimeout(() => {
    // Row clicks — show inline research card
    document.querySelectorAll('.cl-row').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.clIdx, 10);
        diaClinicLeadFilter.selectedIdx = idx;
        renderDiaTab();
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
  var step = diaClinicLeadStep || 0;
  let html = '<div style="margin-bottom:20px;border:1px solid var(--accent);border-radius:12px;padding:20px;background:var(--s1)">';

  // Header
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">';
  html += '<div>';
  html += '<h3 style="margin:0;font-size:16px;font-weight:700;color:var(--text)">' + esc(rec.facility_name || 'Unknown Facility') + '</h3>';
  html += '<div style="font-size:12px;color:var(--text2);margin-top:2px">' + esc(rec.address || '') + (rec.city ? ', ' + esc(rec.city) : '') + (rec.state ? ', ' + rec.state : '') + ' ' + (rec.zip_code || '') + '</div>';
  html += '</div>';
  var tierColor = rec.priority_tier === 'high' ? '#f87171' : rec.priority_tier === 'medium' ? '#fbbf24' : '#94a3b8';
  html += '<div style="text-align:right">';
  html += '<span style="display:inline-block;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700;background:' + tierColor + '20;color:' + tierColor + '">' + rec.priority_score + ' pts</span>';
  html += '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + (rec.research_category || '').replace('_', ' ').toUpperCase() + '</div>';
  html += '</div></div>';

  // Category-specific "What To Do" explanation
  var categoryExplanations = {
    'ownership_gap': {
      title: 'Ownership Gap \u2014 Identify Who Owns This Property',
      body: 'This clinic has missing or incomplete ownership data. Research the property owner, verify the operating entity, and fill in the ownership fields below.',
      color: '#fbbf24',
      fields: [
        { label: 'Recorded Owner', value: rec.recorded_owner },
        { label: 'True Owner', value: rec.true_owner },
        { label: 'State of Incorporation', value: rec.state_of_incorporation },
        { label: 'Principal Names', value: rec.principal_names },
        { label: 'Ownership Tenure', value: rec.ownership_tenure_yrs ? rec.ownership_tenure_yrs + ' yrs' : null },
      ]
    },
    'seller_signal': {
      title: 'Seller Signal \u2014 Evaluate Disposition Likelihood',
      body: 'This clinic shows signals that the owner may be willing to sell. Review signal details, verify accuracy, and determine if outreach is warranted.',
      color: '#f87171',
      fields: [
        { label: 'Loan Maturity', value: rec.months_to_maturity != null ? rec.months_to_maturity + ' months' : null },
        { label: 'Loan Amount', value: rec.loan_amount ? '$' + fmtN(Math.round(rec.loan_amount)) : null },
        { label: 'Lender', value: rec.lender_name },
        { label: 'Ownership Tenure', value: rec.ownership_tenure_yrs ? rec.ownership_tenure_yrs + ' yrs' : null },
        { label: 'Recorded Owner', value: rec.recorded_owner },
        { label: 'Est. Revenue', value: rec.estimated_annual_revenue ? '$' + fmtN(Math.round(rec.estimated_annual_revenue)) : null },
      ]
    },
    'unlinked': {
      title: 'Unlinked Clinic \u2014 Match to a Property Record',
      body: 'This clinic exists in CMS data but is not linked to a property in the database. Search for an existing property match or create a new property record.',
      color: '#60a5fa',
      fields: [
        { label: 'Address', value: rec.address },
        { label: 'City/State', value: (rec.city || '') + (rec.city && rec.state ? ', ' : '') + (rec.state || '') || null },
        { label: 'Building SF', value: rec.building_size ? fmtN(Math.round(rec.building_size)) + ' SF' : null },
        { label: 'Year Built', value: rec.year_built },
      ]
    }
  };
  var catInfo = categoryExplanations[rec.research_category] || { title: 'Research Needed', body: 'Review this clinic record and fill in any missing information.', color: '#94a3b8', fields: [] };

  html += '<div style="padding:14px;background:' + catInfo.color + '14;border-radius:8px;border-left:3px solid ' + catInfo.color + ';margin-bottom:16px;">';
  html += '<div style="font-weight:700;font-size:14px;margin-bottom:6px;color:var(--text)">' + esc(catInfo.title) + '</div>';
  html += '<div style="font-size:13px;color:var(--text);line-height:1.5;margin-bottom:10px;">' + esc(catInfo.body) + '</div>';
  if (catInfo.fields.length) {
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px;">';
    catInfo.fields.forEach(function(f) {
      var hasVal = f.value != null && String(f.value).trim() !== '';
      var icon = hasVal ? '<span style="color:var(--success)">\u2713</span>' : '<span style="color:#f87171">\u25CB</span>';
      html += '<div>' + icon + ' <span style="color:var(--text3)">' + esc(f.label) + ':</span> ' + (hasVal ? '<strong>' + esc(String(f.value)) + '</strong>' : '<span style="color:#f87171">Missing</span>') + '</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  // Context grid
  html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;font-size:12px">';
  html += _clCtx('Medicare ID', rec.medicare_id);
  html += _clCtx('Operator', rec.chain_organization || 'Independent');
  html += _clCtx('Stations', rec.stations || '\u2013');
  html += _clCtx('Patients', rec.latest_estimated_patients || '\u2013');
  html += _clCtx('Est. Revenue', rec.estimated_annual_revenue ? '$' + fmtN(Math.round(rec.estimated_annual_revenue)) : '\u2013');
  html += _clCtx('Capacity Util.', rec.capacity_utilization_pct ? rec.capacity_utilization_pct + '%' : '\u2013');
  html += _clCtx('Building SF', rec.building_size ? fmtN(Math.round(rec.building_size)) : '\u2013');
  html += _clCtx('Land Area', rec.land_area ? fmtN(Math.round(rec.land_area)) + ' SF' : '\u2013');
  html += _clCtx('Year Built', rec.year_built || '\u2013');
  html += _clCtx('Last Rent', rec.last_known_rent ? '$' + fmtN(Math.round(rec.last_known_rent)) : '\u2013');
  html += _clCtx('Ownership Tenure', rec.ownership_tenure_yrs ? rec.ownership_tenure_yrs + ' yrs' : '\u2013');
  html += _clCtx('Loan Maturity', rec.months_to_maturity != null ? rec.months_to_maturity + ' mo' : '\u2013');
  html += '</div>';

  // Loan context (if exists)
  if (rec.loan_id) {
    html += '<div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:12px">';
    html += '<div style="font-weight:600;margin-bottom:4px;color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Loan Info</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">';
    html += _clCtx('Lender', rec.lender_name || '\u2013');
    html += _clCtx('Amount', rec.loan_amount ? '$' + fmtN(Math.round(rec.loan_amount)) : '\u2013');
    html += _clCtx('Type', rec.loan_type || '\u2013');
    html += '</div></div>';
  }

  // Quick actions
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">';
  var searchQ = (rec.facility_name || '') + ' ' + (rec.address || '') + ' ' + (rec.city || '') + ' ' + (rec.state || '') + ' dialysis ownership';
  html += '<a href="https://www.google.com/search?q=' + encodeURIComponent(searchQ) + '" target="_blank" rel="noopener" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">Google Search</a>';
  if (rec.state) {
    html += '<a href="https://www.google.com/search?q=' + encodeURIComponent('Secretary of State business search ' + rec.state) + '" target="_blank" rel="noopener" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">SOS ' + rec.state + '</a>';
  }
  if (rec.city && rec.state) {
    html += '<a href="https://www.google.com/search?q=' + encodeURIComponent(rec.city + ' ' + rec.state + ' county property records') + '" target="_blank" rel="noopener" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none;cursor:pointer">County Records</a>';
  }
  html += '</div>';

  // === RESEARCH FORM (5-STEP WORKFLOW) ===
  html += '<div style="border-top:1px solid var(--border);padding-top:16px">';

  // Completeness bar
  var cFields = [
    { name: 'recorded_owner', value: rec.recorded_owner, required: true },
    { name: 'true_owner', value: rec.true_owner },
    { name: 'incorporation', value: rec.state_of_incorporation },
    { name: 'principals', value: rec.principal_names },
    { name: 'property', value: rec.property_id },
    { name: 'email', value: rec.contact_email },
    { name: 'phone', value: rec.phone },
    { name: 'pipeline', value: rec.pipeline_status, required: true },
    { name: 'notes', value: rec.research_notes }
  ];
  var completeness = computeCompleteness(cFields);
  html += renderCompletenessBar(completeness);

  // Step navigation — 5 steps
  var clSteps = [
    { label: 'Clinic Info', complete: !!rec.facility_name },
    { label: 'Ownership', complete: !!rec.recorded_owner },
    { label: 'Property', complete: !!rec.property_id },
    { label: 'Contacts', complete: !!rec.contact_email || !!rec.phone },
    { label: 'Notes', complete: !!rec.pipeline_status }
  ];
  html += renderStepNav(step, clSteps, 'window.diaClStepNav');

  // ===== Step 0: Clinic Info (read-only context) =====
  html += '<div class="form-step" style="display:' + (step === 0 ? 'block' : 'none') + ';margin-top:16px">';
  html += '<div class="form-step-head"><h4 style="margin:0;font-size:13px;font-weight:700">Step 1: Clinic Info</h4></div>';
  html += '<div style="font-size:12px;color:var(--text2);margin-bottom:12px">Review the clinic context above. Confirm details are accurate before proceeding to ownership research.</div>';
  // Show key fields as read-only summary
  html += '<div style="background:var(--s2);border-radius:8px;padding:12px;font-size:12px">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';
  html += '<div><span style="color:var(--text3)">Facility:</span> <strong>' + esc(rec.facility_name || '\u2014') + '</strong></div>';
  html += '<div><span style="color:var(--text3)">Medicare ID:</span> ' + esc(rec.medicare_id || '\u2014') + '</div>';
  html += '<div><span style="color:var(--text3)">Operator:</span> ' + esc(rec.chain_organization || 'Independent') + '</div>';
  html += '<div><span style="color:var(--text3)">Patients:</span> ' + (rec.latest_estimated_patients || '\u2013') + '</div>';
  html += '<div><span style="color:var(--text3)">Address:</span> ' + esc(rec.address || '\u2014') + '</div>';
  html += '<div><span style="color:var(--text3)">City/State:</span> ' + esc((rec.city || '') + (rec.city && rec.state ? ', ' : '') + (rec.state || '')) + '</div>';
  html += '<div><span style="color:var(--text3)">Building SF:</span> ' + (rec.building_size ? fmtN(Math.round(rec.building_size)) : '\u2013') + '</div>';
  html += '<div><span style="color:var(--text3)">Year Built:</span> ' + (rec.year_built || '\u2013') + '</div>';
  html += '</div></div>';
  html += '</div>';

  // ===== Step 1: Ownership =====
  html += '<div class="form-step" style="display:' + (step === 1 ? 'block' : 'none') + ';margin-top:16px">';
  html += '<div class="form-step-head"><h4 style="margin:0;font-size:13px;font-weight:700">Step 2: Ownership</h4></div>';

  html += guidedField('cl-recorded-owner', 'Recorded Owner', rec.recorded_owner, { type: 'text', required: true });
  html += guidedField('cl-true-owner', 'True Owner / Developer', rec.true_owner, { type: 'text' });
  html += guidedField('cl-incorporation', 'State of Incorporation', rec.state_of_incorporation, { type: 'text' });
  html += guidedField('cl-principals', 'Principal Names', rec.principal_names, { type: 'text' });
  html += guidedField('cl-mailing', 'Mailing Address', rec.mailing_address, { type: 'text' });
  html += '</div>';

  // ===== Step 2: Property =====
  html += '<div class="form-step" style="display:' + (step === 2 ? 'block' : 'none') + ';margin-top:16px">';
  html += '<div class="form-step-head"><h4 style="margin:0;font-size:13px;font-weight:700">Step 3: Property</h4></div>';
  html += guidedField('cl-property-id', 'Property ID', rec.property_id, { type: 'text', placeholder: 'Enter or link property ID' });
  html += renderPropertyResolution(rec, 'clinic_leads', 'medicare_id');
  html += '</div>';

  // ===== Step 3: Contacts (dynamic rows) =====
  html += '<div class="form-step" style="display:' + (step === 3 ? 'block' : 'none') + ';margin-top:16px">';
  html += '<div class="form-step-head"><h4 style="margin:0;font-size:13px;font-weight:700">Step 4: Contacts</h4></div>';

  // Primary contact fields
  html += guidedField('cl-email', 'Primary Email', rec.contact_email, { type: 'email' });
  html += guidedField('cl-phone', 'Primary Phone', rec.phone, { type: 'tel' });

  // Dynamic contact rows
  html += '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
  html += '<div style="font-weight:600;font-size:12px;color:var(--text)">Additional Contacts</div>';
  html += '<button id="addClContact" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--accent);color:#fff;border:none;cursor:pointer;font-weight:600">+ Add Contact</button>';
  html += '</div>';

  // Table header
  html += '<div style="font-size:10px;font-weight:600;color:var(--text3);display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr 30px;gap:4px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">';
  html += '<div>Name</div><div>Phone</div><div>Email</div><div>Role</div><div></div>';
  html += '</div>';

  html += '<div id="clContactRows">';
  var contacts = window._diaClinicFormDraft._contacts || [{}];
  contacts.forEach(function(ct, ci) {
    html += _renderClContactRow(ci, ct);
  });
  html += '</div>';
  html += '</div>';
  html += '</div>';

  // ===== Step 4: Notes =====
  html += '<div class="form-step" style="display:' + (step === 4 ? 'block' : 'none') + ';margin-top:16px">';
  html += '<div class="form-step-head"><h4 style="margin:0;font-size:13px;font-weight:700">Step 5: Notes & Pipeline</h4></div>';

  html += guidedField('cl-pipeline-status', 'Pipeline Status', rec.pipeline_status, {
    type: 'select', required: true,
    options: [
      { label: 'New Lead', value: 'new_lead' },
      { label: 'Researching', value: 'researching' },
      { label: 'Contacted', value: 'contacted' },
      { label: 'Meeting Set', value: 'meeting_set' },
      { label: 'Proposal Sent', value: 'proposal_sent' },
      { label: 'Not For Sale', value: 'not_for_sale' },
      { label: 'Dead', value: 'dead' }
    ]
  });

  html += guidedField('cl-notes', 'Research Notes', rec.research_notes, {
    type: 'textarea', placeholder: 'Research findings, next steps...', rows: 4
  });
  html += '</div>';

  // Action buttons — always visible
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">';
  if (step > 0) {
    html += '<button id="clBackBtn" style="padding:10px 16px;background:var(--s2);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--text2)">\u2190 Back</button>';
  }
  if (step < 4) {
    html += '<button id="clNextBtn" style="flex:1;padding:10px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer">Next \u2192</button>';
  }
  html += '<button id="clSaveBtn" style="' + (step === 4 ? 'flex:1;' : '') + 'padding:10px 16px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer">Save</button>';
  html += '<button id="clNaBtn" style="padding:10px 16px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:8px;font-size:13px;cursor:pointer;color:#f87171">N/A</button>';
  html += '<button id="clSkipBtn" style="padding:10px 16px;background:var(--s2);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--text2)">Skip</button>';
  html += '</div>';

  html += '</div>'; // form
  html += '</div>'; // card

  // Attach handlers
  setTimeout(function() {
    var nextBtn = document.getElementById('clNextBtn');
    var backBtn = document.getElementById('clBackBtn');
    var saveBtn = document.getElementById('clSaveBtn');
    var naBtn = document.getElementById('clNaBtn');
    var skipBtn = document.getElementById('clSkipBtn');

    if (nextBtn) nextBtn.addEventListener('click', function() { window.diaClStepNav(step + 1); });
    if (backBtn) backBtn.addEventListener('click', function() { window.diaClStepNav(step - 1); });

    if (saveBtn) {
      saveBtn.addEventListener('click', async function() {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving\u2026';
        saveBtn.style.opacity = '0.6';
        try {
          await saveClinicLeadResearch(rec);
          diaClinicLeadStep = 0;
          window._diaClinicFormDraft = {};
        } catch (e) {
          console.error('saveClinicLeadResearch error:', e);
          showToast('Save failed: ' + e.message, 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
          saveBtn.style.opacity = '';
        }
      });
    }

    if (naBtn) {
      naBtn.addEventListener('click', async function() {
        if (!(await lccConfirm('Mark this clinic lead as N/A? It will be removed from your research queue.', 'Mark N/A'))) return;
        naBtn.disabled = true;
        naBtn.style.opacity = '0.6';
        try {
          await markClinicLead(rec, 'not_applicable');
          diaClinicLeadStep = 0;
          window._diaClinicFormDraft = {};
        } catch (e) {
          console.error('markClinicLead error:', e);
          showToast('Mark failed: ' + e.message, 'error');
        } finally {
          naBtn.disabled = false;
          naBtn.style.opacity = '';
        }
      });
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', function() {
        diaClinicLeadStep = 0;
        window._diaClinicFormDraft = {};
        diaClinicLeadFilter.selectedIdx = undefined;
        showToast('Skipped \u2014 returned to list', 'info');
        renderDiaTab();
      });
    }

    // Dynamic contact add/remove
    var addContactBtn = document.getElementById('addClContact');
    if (addContactBtn) {
      addContactBtn.addEventListener('click', function() {
        _captureClinicFormDraft();
        window._diaClinicFormDraft._contacts.push({});
        renderDiaTab();
      });
    }
    document.querySelectorAll('[data-remove-contact]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _captureClinicFormDraft();
        var idx = parseInt(btn.dataset.removeContact, 10);
        window._diaClinicFormDraft._contacts.splice(idx, 1);
        if (window._diaClinicFormDraft._contacts.length === 0) window._diaClinicFormDraft._contacts = [{}];
        renderDiaTab();
      });
    });
  }, 0);

  return html;
}

// Helper: render a dynamic contact row for clinic leads
function _renderClContactRow(idx, data) {
  var d = data || {};
  var html = '<div class="cl-contact-row" style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr 30px;gap:4px;margin-bottom:4px">';
  html += '<input type="text" id="cl-ct-name-' + idx + '" value="' + esc(d.name || '') + '" placeholder="Name" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--s2);color:var(--text);box-sizing:border-box" />';
  html += '<input type="tel" id="cl-ct-phone-' + idx + '" value="' + esc(d.phone || '') + '" placeholder="Phone" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--s2);color:var(--text);box-sizing:border-box" />';
  html += '<input type="email" id="cl-ct-email-' + idx + '" value="' + esc(d.email || '') + '" placeholder="Email" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--s2);color:var(--text);box-sizing:border-box" />';
  html += '<input type="text" id="cl-ct-role-' + idx + '" value="' + esc(d.role || '') + '" placeholder="Role" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--s2);color:var(--text);box-sizing:border-box" />';
  html += '<button data-remove-contact="' + idx + '" style="font-size:14px;background:none;border:none;color:#f87171;cursor:pointer;padding:0" title="Remove">\u00D7</button>';
  html += '</div>';
  return html;
}

/**
 * Draft state preservation for lease backfill and clinic leads multi-step forms
 */
window._diaLeaseFormDraft = {};
window._diaClinicFormDraft = {};

function _captureLeaseFormDraft() {
  var fields = ['leaseOutcome', 'leaseTerm', 'leaseExpiration', 'leaseSource', 'leaseRent', 'leaseRentSF', 'leaseEscalations', 'leasePropertyId', 'leaseLender', 'leaseLoanAmount', 'leaseLoanType', 'leaseLoanMaturity', 'leaseNotes'];
  fields.forEach(function(id) {
    var el = document.getElementById(id);
    if (el && el.value !== undefined && el.value !== '') {
      window._diaLeaseFormDraft[id] = el.value;
    }
  });
  _capturePriorLeases();
}

function _captureClinicFormDraft() {
  var fields = ['cl-recorded-owner', 'cl-true-owner', 'cl-incorporation', 'cl-principals', 'cl-mailing', 'cl-property-id', 'cl-email', 'cl-phone', 'cl-phone-2', 'cl-mailing-2', 'cl-pipeline-status', 'cl-notes'];
  fields.forEach(function(id) {
    var el = document.getElementById(id);
    if (el && el.value !== undefined && el.value !== '') {
      window._diaClinicFormDraft[id] = el.value;
    }
  });
  // Capture dynamic contact rows
  var contactRows = document.querySelectorAll('.cl-contact-row');
  if (contactRows.length > 0) {
    var contacts = [];
    contactRows.forEach(function(row, i) {
      contacts.push({
        name: (document.getElementById('cl-ct-name-' + i) || {}).value || '',
        phone: (document.getElementById('cl-ct-phone-' + i) || {}).value || '',
        email: (document.getElementById('cl-ct-email-' + i) || {}).value || '',
        role: (document.getElementById('cl-ct-role-' + i) || {}).value || ''
      });
    });
    window._diaClinicFormDraft._contacts = contacts;
  }
}

function _restoreDraft(draft) {
  requestAnimationFrame(function() {
    Object.keys(draft).forEach(function(id) {
      if (id.startsWith('_')) return; // skip special keys
      var el = document.getElementById(id);
      if (el && !el.value) el.value = draft[id];
    });
  });
}

/**
 * Step navigation handler for lease backfill multi-step form
 */
window.diaLeaseStepNav = function(idx) {
  _captureLeaseFormDraft();
  diaLeaseBackfillStep = idx;
  renderDiaTab();
  _restoreDraft(window._diaLeaseFormDraft);
};

/**
 * Step navigation handler for clinic lead multi-step form
 */
window.diaClStepNav = function(idx) {
  _captureClinicFormDraft();
  diaClinicLeadStep = idx;
  renderDiaTab();
  _restoreDraft(window._diaClinicFormDraft);
};

/**
 * Render property resolution component for research cards lacking property_id
 */
/**
 * Render the ranked candidate chips for property-link review.
 * Each chip links to a property in one click; high-confidence candidates
 * (score >= 0.92) are highlighted as a primary action.
 */
function renderSuggestedCandidates(item, suggested) {
  const top = suggested.slice(0, 5);
  const best = top[0];
  const bestScore = best && typeof best.score === 'number' ? best.score : 0;
  const isHighConfidence = bestScore >= 0.92;
  const clinicId = item.clinic_id;

  let html = '<div style="background:rgba(52,211,153,0.06);border-radius:8px;padding:14px;margin-bottom:12px;border-left:3px solid var(--accent);">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
  html += '<div style="font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--accent);">Suggested Properties (' + top.length + ')</div>';
  html += '<div style="font-size:11px;color:var(--text2);">Click any to link in one click</div>';
  html += '</div>';

  top.forEach((c, idx) => {
    const score = typeof c.score === 'number' ? c.score : 0;
    const scorePct = Math.round(score * 100);
    const isExact = c.match_type === 'exact_address_city_state_zip' || c.match_type === 'exact_address_city_state';
    const isFuzzy = c.match_type === 'fuzzy_address_state';
    const badgeColor = score >= 0.92 ? '#34d399' : score >= 0.75 ? '#fbbf24' : '#9ca3af';
    const badgeLabel = isExact ? 'EXACT' : isFuzzy ? 'FUZZY' : 'MATCH';
    const isPrimary = idx === 0 && isHighConfidence;

    const cityState = (c.city || '') + (c.city && c.state ? ', ' : '') + (c.state || '');
    const addrLine = (c.address || '—') + (c.zip_code ? ' · ' + c.zip_code : '');

    html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;background:var(--s2);border:1px solid ' + (isPrimary ? 'var(--accent)' : 'var(--border)') + ';border-radius:6px;">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:2px;">';
    html += '<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;background:' + badgeColor + ';color:#0a0a0a;">' + badgeLabel + ' ' + scorePct + '%</span>';
    html += '<span style="font-size:11px;color:var(--text3);">#' + esc(String(c.property_id)) + (c.property_name ? ' · ' + esc(c.property_name) : '') + '</span>';
    html += '</div>';
    html += '<div style="font-size:12px;color:var(--text);font-weight:500;" class="truncate">' + esc(addrLine) + '</div>';
    if (cityState) html += '<div style="font-size:11px;color:var(--text2);">' + esc(cityState) + '</div>';
    html += '</div>';
    html += '<button class="btn-action ' + (isPrimary ? 'primary' : 'default') + '" style="font-size:11px;padding:5px 12px;white-space:nowrap;" onclick="propResLinkFromQueue(\'' + String(clinicId).replace(/\'/g, "\\\'") + '\',' + c.property_id + ')">' + (isPrimary ? '✓ Confirm Link' : 'Link') + '</button>';
    html += '</div>';
  });

  html += '</div>';
  return html;
}

var _propResLinkInFlight = false;
window.propResLinkFromQueue = async function(clinicId, propertyId) {
  // Module-level lock prevents double-saves while the request is in flight.
  // (Earlier versions disabled `event.target` after `await lccConfirm`, but
  // the post-await `event` global resolved to the *modal*'s OK button,
  // which left it permanently disabled and broke subsequent links.)
  if (_propResLinkInFlight) return;

  if (!(await lccConfirm('Link clinic ' + clinicId + ' to Property #' + propertyId + '?', 'Link'))) return;

  _propResLinkInFlight = true;

  try {
    // research_queue_outcomes has a UNIQUE(queue_type, clinic_id) constraint,
    // so an INSERT for an already-reviewed clinic returns 409. Check the
    // existing outcomes cache and PATCH the row in place if it exists,
    // otherwise INSERT a new one.
    const existing = (diaData.researchOutcomes || []).find(function(o) {
      return o && o.queue_type === 'property_review'
        && String(o.clinic_id) === String(clinicId);
    });

    const payload = {
      queue_type: 'property_review',
      clinic_id: String(clinicId),
      status: 'approved_link',
      notes: 'Linked from suggested candidate',
      selected_property_id: propertyId,
      source_name: 'manual_verify',
      assigned_at: new Date().toISOString()
    };

    let result;
    if (existing) {
      result = await applyChangeWithFallback({
        proxyBase: '/api/dia-query',
        table: 'research_queue_outcomes',
        idColumn: 'clinic_id',
        idValue: String(clinicId),
        matchFilters: [{ column: 'queue_type', value: 'property_review' }],
        data: payload,
        source_surface: 'dialysis_property_review',
        propagation_scope: 'research_queue_outcome'
      });
    } else {
      result = await applyInsertWithFallback({
        proxyBase: '/api/dia-query',
        table: 'research_queue_outcomes',
        idColumn: 'clinic_id',
        recordIdentifier: String(clinicId),
        data: payload,
        source_surface: 'dialysis_property_review',
        propagation_scope: 'research_queue_outcome'
      });
    }

    if (!result || !result.ok) {
      const msg = (result && result.errors && result.errors.join('; ')) || 'unknown error';
      showToast('Failed to save link: ' + msg, 'error');
      return;
    }

    showToast('Linked to Property #' + propertyId, 'success');

    // Persist the canonical link in properties.medicare_id so the gap view
    // recognizes the clinic as linked. This is the field
    // v_clinic_lease_data_gaps joins on; without it the clinic stays in the
    // queue forever (regardless of medicare_clinics.property_id state).
    // Best-effort: the outcome row above is the durable user decision; this
    // patch is a follow-up that lets the queue self-clean.
    try {
      await applyChangeWithFallback({
        proxyBase: '/api/dia-query',
        table: 'properties',
        idColumn: 'property_id',
        idValue: propertyId,
        data: { medicare_id: String(clinicId) },
        source_surface: 'dialysis_property_review',
        propagation_scope: 'property_clinic_link'
      });
    } catch (linkErr) {
      console.warn('[propResLinkFromQueue] properties.medicare_id patch failed:', linkErr);
    }

    // Refresh outcomes cache so the queue advances and this row is hidden.
    try {
      const fresh = await diaQuery('research_queue_outcomes', '*', { limit: 500 });
      diaData.researchOutcomes = fresh || [];
    } catch (_) { /* non-fatal */ }

    canonicalBridge('log_activity', {
      title: 'Property link approved',
      domain: 'dialysis',
      source_system: 'dia_supabase',
      external_id: String(clinicId),
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      metadata: { clinic_id: clinicId, property_id: propertyId, source: 'one_click_candidate' }
    });

    // Drop the linked clinic out of the in-memory queue so the next
    // render skips it. Avoid a full loadDiaData() reload — that re-runs
    // 10+ queries and can take 20s on a slow connection.
    const cidStr = String(clinicId);
    diaData.propertyReviewQueue = (diaData.propertyReviewQueue || []).filter(function(r) {
      return String(r.clinic_id) !== cidStr;
    });

    // Selection index points into the *filtered* slice, so recompute against
    // the new filtered length and clamp.
    const filtered = diaData.propertyReviewQueue.filter(function(r) {
      return !diaPropertyFilter.review_type || r.review_type === diaPropertyFilter.review_type;
    });
    if (filtered.length === 0) {
      diaPropertyFilter.selectedIdx = undefined;
    } else {
      const targetIdx = (typeof diaPropertyFilter.selectedIdx === 'number')
        ? diaPropertyFilter.selectedIdx
        : 0;
      diaPropertyFilter.selectedIdx = Math.min(targetIdx, filtered.length - 1);
    }

    renderDiaTab();
  } catch (err) {
    console.error('propResLinkFromQueue error:', err);
    showToast('Failed to save link: ' + (err.message || 'unknown error'), 'error');
  } finally {
    _propResLinkInFlight = false;
  }
};

function renderPropertyResolution(rec, sourceTable, sourceIdCol) {
  if (rec.property_id) {
    return `<div class="prop-linked" style="padding:8px;background:var(--bg2);border-radius:6px;margin:8px 0;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <span style="color:var(--success);font-size:12px;">✓ Linked to Property #${rec.property_id}</span>
        <div style="display:flex;gap:4px;">
          <button onclick="openUnifiedDetail('dialysis',{property_id:${rec.property_id}})" style="font-size:11px;padding:2px 8px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;">View</button>
          <button onclick="document.getElementById('propResRelink').style.display=document.getElementById('propResRelink').style.display==='none'?'block':'none'" style="font-size:11px;padding:2px 8px;background:var(--s3);color:var(--text2);border:1px solid var(--border);border-radius:4px;cursor:pointer;">Search / Re-link</button>
        </div>
      </div>
      <div id="propResRelink" style="display:none;margin-top:6px;padding-top:6px;border-top:1px solid var(--border);">
        <div style="display:flex;gap:6px;margin-bottom:6px;">
          <input type="text" id="propResSearch" placeholder="Search by address or name..." onkeydown="if(event.key==='Enter'){event.preventDefault();propResDoSearch('${sourceTable}','${sourceIdCol}',${rec[sourceIdCol]||'null'});}" style="flex:1;padding:5px 8px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
          <button onclick="propResDoSearch('${sourceTable}','${sourceIdCol}',${rec[sourceIdCol]||'null'})" style="padding:5px 10px;font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;">Search</button>
        </div>
        <div id="propResResults" style="max-height:150px;overflow-y:auto;"></div>
      </div>
    </div>`;
  }

  return `<div class="prop-resolution" style="padding:10px;background:var(--bg2);border-radius:6px;margin:8px 0;border:1px dashed var(--warning);">
    <div style="font-size:12px;font-weight:600;color:var(--warning);margin-bottom:8px;">⚠ No Property Linked</div>
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <input type="text" id="propResSearch" placeholder="Search by address or name..." onkeydown="if(event.key==='Enter'){event.preventDefault();propResDoSearch('${sourceTable}','${sourceIdCol}',${rec[sourceIdCol]||'null'});}" style="flex:1;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
      <button onclick="propResDoSearch('${sourceTable}','${sourceIdCol}',${rec[sourceIdCol] || 'null'})" style="padding:6px 12px;font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;">Search</button>
    </div>
    <div id="propResResults" style="max-height:150px;overflow-y:auto;margin-bottom:8px;"></div>
    <button onclick="propResShowCreate('${sourceTable}','${sourceIdCol}',${rec[sourceIdCol] || 'null'})" style="font-size:11px;padding:4px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;">+ Create New Property</button>
    <div id="propResCreateForm" style="display:none;margin-top:8px;"></div>
  </div>`;
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
let _diaClinicSaving = false;
async function saveClinicLeadResearch(rec) {
  if (_diaClinicSaving) { showToast('Save in progress', 'info'); return; }
  _diaClinicSaving = true;
  try { await _saveClinicLeadResearchInner(rec); } finally { _diaClinicSaving = false; }
}
async function _saveClinicLeadResearchInner(rec) {
  // Capture current step's visible fields into draft before reading
  _captureClinicFormDraft();
  var draft = window._diaClinicFormDraft;

  // Read from DOM (current step) or draft (other steps)
  function _clVal(id) {
    var el = document.getElementById(id);
    if (el && el.value) return el.value;
    return draft[id] || null;
  }

  const data = {
    recorded_owner: _clVal('cl-recorded-owner'),
    true_owner: _clVal('cl-true-owner'),
    state_of_incorporation: _clVal('cl-incorporation'),
    principal_names: _clVal('cl-principals'),
    contact_email: _clVal('cl-email'),
    contact_phone: _clVal('cl-phone'),
    phone_2: _clVal('cl-phone-2'),
    mailing_address: _clVal('cl-mailing'),
    mailing_address_2: _clVal('cl-mailing-2'),
    pipeline_status: _clVal('cl-pipeline-status'),
    notes: _clVal('cl-notes'),
    property_id: _clVal('cl-property-id')
  };

  const _anyClField = Object.values(data).some(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (!_anyClField) { showToast('Please fill in at least one field before saving', 'info'); return; }

  var _propId = data.property_id || rec.property_id;

  // 1. Save research outcome
  const outcomeOk = await saveClinicLeadOutcome(rec.medicare_id, 'completed', data.notes, _propId);
  if (!outcomeOk) return;

  // 2. If we have owner info and a property_id, update the property's owner fields
  if (_propId && (data.recorded_owner || data.true_owner)) {
    const propUpdate = {};
    if (data.recorded_owner) propUpdate.tenant = data.recorded_owner; // recorded_owner maps to tenant field for display
    await diaPatchRecord('properties', 'property_id', _propId, propUpdate);
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
  const ok = await saveClinicLeadOutcome(rec.medicare_id, status, null, rec.property_id);
  if (!ok) return; // saveClinicLeadOutcome already showed error toast

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
async function saveDiaOutcome(queueType, clinicId, status, propId, notes, source, term, rent, rentSF) {
  try {
    const payload = {
      queue_type: queueType,
      clinic_id: clinicId,
      status: status,
      notes: notes,
      selected_property_id: propId || null,
      assigned_at: new Date().toISOString(),
      verification_source: source || null,
      lease_term: term || null,
      annual_rent: rent ? parseFloat(rent) : null,
      rent_per_sf: rentSF ? parseFloat(rentSF) : null
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
      metadata: { queue_type: queueType, clinic_id: clinicId, status: status, property_id: propId, notes: notes, source: source, lease_term: term, annual_rent: rent, rent_per_sf: rentSF }
    });

    // Auto-advance to next item or mark queue as complete
    if (queueType === 'property_review') {
      const filtered = diaData.propertyReviewQueue.filter(r => !diaPropertyFilter.review_type || r.review_type === diaPropertyFilter.review_type);
      const currentIdx = diaPropertyFilter.selectedIdx || 0;
      if (currentIdx + 1 < filtered.length) {
        diaPropertyFilter.selectedIdx = currentIdx + 1;
        showToast('Outcome saved — advancing to next item', 'success');
      } else {
        diaPropertyFilter.selectedIdx = undefined;
        showToast('Outcome saved — queue complete!', 'success');
      }
    } else {
      const filtered = diaData.leaseBackfillRows.filter(r => !diaLeaseFilter.priority || r.lease_backfill_priority === diaLeaseFilter.priority);
      const currentIdx = diaLeaseFilter.selectedIdx || 0;
      if (currentIdx + 1 < filtered.length) {
        diaLeaseFilter.selectedIdx = currentIdx + 1;
        showToast('Outcome saved — advancing to next item', 'success');
      } else {
        diaLeaseFilter.selectedIdx = undefined;
        showToast('Outcome saved — queue complete!', 'success');
      }
    }

    // Reload data and re-render to advance to next record
    await loadDiaData();
    renderDiaTab();
    return true;
  } catch (err) {
    console.error('saveDiaOutcome error:', err);
    showToast('Failed to save outcome: ' + err.message, 'error');
    return false;
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
    html += '<div style="flex: 0.5;">Action</div>';
    html += '</div>';
    
    outcomes.slice(0, 100).forEach(row => {
      const statusColor = row.status === 'verified_lease' || row.status === 'approved_link' ? '#34d399' : 'var(--text2)';

      html += `<div class="table-row clickable-row" onclick='showDetail(${safeJSON(row)}, "dia-clinic")'>`;
      html += `<div style="flex: 1;">${esc(row.queue_type || 'unknown')}</div>`;
      html += `<div style="flex: 0.5; color: var(--text2);">${esc(String(row.clinic_id || ''))}</div>`;
      html += `<div style="flex: 1; color: ${statusColor};">${esc(row.status || 'unknown')}</div>`;
      html += `<div style="flex: 1.5;">${row.assigned_to ? esc(row.assigned_to) : '–'}</div>`;
      html += `<div style="flex: 1; color: var(--text2);">${fmt(row.assigned_at || row.created_at)}</div>`;
      html += `<div style="flex: 0.5; text-align: right;"><button class="act-btn" style="font-size:10px;padding:2px 6px" onclick="event.stopPropagation();reopenDiaOutcome('${esc(row.queue_type || '')}','${esc(String(row.clinic_id || ''))}')">Reopen</button></div>`;
      html += '</div>';
    });
  }
  
  html += '</div>';
  html += '</div>';
  
  return html;
}

async function reopenDiaOutcome(queueType, clinicId) {
  if (!(await lccConfirm('Reopen this item? It will be returned to the research queue.', 'Reopen'))) return;
  try {
    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'research_queue_outcomes',
      idColumn: 'clinic_id',
      idValue: clinicId,
      matchFilters: [{ column: 'queue_type', value: queueType }],
      data: { status: 'reopened', reopened_at: new Date().toISOString() },
      source_surface: 'dialysis_activity_reopen',
      propagation_scope: 'research_queue_outcome'
    });
    if (result.ok) {
      showToast('Item reopened', 'success');
      await loadDiaData();
      renderDiaTab();
    } else {
      showToast('Reopen failed', 'error');
    }
  } catch (err) {
    console.error('Reopen error:', err);
    showToast('Error: ' + err.message, 'error');
  }
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
  html += _detRow('Operator', (r.operator_name || r.chain_organization) ? entityLink(r.operator_name || r.chain_organization, 'operator', null) : '—');
  html += _detRow('Parent Org', r.parent_organization || '—');
  html += _detRow('Stations', r.stations || r.number_of_chairs || '—');

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
  // Use != null so that a legitimate property_id of 0 is still treated as linked.
  html += _detRow('Property ID', r.property_id != null ? r.property_id : 'Not linked');
  html += _detRow('Building Size', r.building_size ? fmtN(Math.round(Number(r.building_size))) + ' SF' : '—');
  html += _detRow('Land Area', r.land_area ? fmtN(Math.round(Number(r.land_area))) + ' SF' : '—');
  // Treat 0 as "unknown" — CoStar sometimes sends blank Year Built as 0.
  const ybNum = Number(r.year_built);
  html += _detRow('Year Built', (r.year_built && ybNum >= 1600 && ybNum <= 2100) ? ybNum : '—');
  html += _detRow('Stations', r.stations || r.number_of_chairs || '—');

  // Ownership vs operator — never conflate the two.
  // "Recorded Owner" is the deed holder (e.g. Agree Central LLC) sourced from the
  // recorded_owners table via v_property_detail. "Tenant / Operator" is the facility
  // operator (e.g. DaVita Kidney Care) sourced from CMS clinic data. Earlier versions
  // of this renderer leaked the CMS operator into the "Owner" slot via a data merge —
  // keep them on separate rows so the display cannot regress.
  html += '<div class="detail-section-title" style="margin-top:20px">Ownership &amp; Operator</div>';
  html += _detRow('Recorded Owner', r.recorded_owner_name || '— unknown');
  if (r.recorded_owner_address) {
    html += _detRow('Recorded Owner Address', r.recorded_owner_address);
  }
  html += _detRow('Tenant / Operator', r.operator_name || r.chain_organization || '—');

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
 *
 * Uses the v_ownership_chain array (loaded by detail.js into window._udCache.chain)
 * to render a full timeline of every recorded owner for this property, most recent
 * at top. Falls back to the single v_ownership_current record fields embedded on
 * the record when no chain is available (e.g. when this renderer is invoked
 * outside of the unified detail panel flow).
 */
function renderDiaDetailOwnership(record) {
  const r = record;
  let html = '<div class="detail-section">';

  html += '<div class="detail-section-title">Ownership Chain</div>';

  // Pull chain from the unified detail cache when available. detail.js populates
  // window._udCache.chain via openUnifiedDetail() before invoking any tab renderer.
  const chain = (window._udCache && Array.isArray(window._udCache.chain))
    ? window._udCache.chain
    : [];

  if (chain.length > 0) {
    // 90-day fallback rule: if the most-recent entry has an ownership_end within
    // 90 days of today, treat it as current. This guards against stale end dates
    // on the active ownership record (e.g. Agree Central's 2026-03-13 bug).
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const isChainEntryCurrent = (entry, isMostRecent) => {
      if (!isMostRecent) return false;
      if (!entry.ownership_end) return true;
      const endMs = new Date(entry.ownership_end).getTime();
      if (isNaN(endMs)) return true;
      return Math.abs(nowMs - endMs) <= NINETY_DAYS_MS;
    };

    html += '<div class="detail-timeline">';
    chain.forEach((h, idx) => {
      const isFirst = idx === 0;
      const isCurrent = isChainEntryCurrent(h, isFirst);
      const ownerLabel = h.recorded_owner_name || h.true_owner_name || '—';
      const startStr = h.transfer_date
        ? new Date(h.transfer_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Unknown';
      const endStr = isCurrent
        ? 'Present'
        : (h.ownership_end
            ? new Date(h.ownership_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Unknown');
      const priceStr = h.sale_price
        ? '$' + Number(h.sale_price).toLocaleString(undefined, { maximumFractionDigits: 0 })
        : 'Not Disclosed';
      const capStr = h.cap_rate ? Number(h.cap_rate).toFixed(2) + '%' : '—';

      html += '<div class="detail-timeline-item ' + (isCurrent ? 'green' : '') + '" style="margin-bottom:10px">';
      html += '<div class="detail-card-date">' + esc(startStr) + ' → ' + esc(endStr);
      if (isCurrent) html += ' <span class="detail-badge" style="background:var(--green);color:#fff;margin-left:6px">Current</span>';
      html += '</div>';
      // Clickable owner name — opens the entity/contact by name so the user
      // can jump from the ownership chain into LCC Contacts.
      html += '<div class="detail-card-title">' + (typeof entityLink === 'function' ? entityLink(ownerLabel, 'contact', null) : esc(ownerLabel)) + '</div>';
      html += '<div class="detail-card-body">';
      if (h.true_owner_name && h.recorded_owner_name && h.true_owner_name !== h.recorded_owner_name) {
        html += '<span style="font-size:12px;color:var(--text3)">True Owner:</span> ' + (typeof entityLink === 'function' ? entityLink(h.true_owner_name, 'contact', null) : esc(h.true_owner_name)) + '<br>';
      }
      html += '<div style="font-size:12px">Sale price: <span class="mono" style="color:var(--green)">' + esc(priceStr) + '</span> <span style="color:var(--text3)">|</span> Cap rate: ' + esc(capStr) + '</div>';
      if (h.ownership_type) html += '<div style="font-size:11px;color:var(--text3);margin-top:2px">Type: ' + esc(h.ownership_type) + '</div>';
      if (h.ownership_source) html += '<div style="font-size:11px;color:var(--text3)">Source: ' + esc(h.ownership_source) + '</div>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
  } else if (r.ownership_id) {
    // Fallback: no chain loaded — show the single current-ownership fields
    // embedded on the record (legacy v_ownership_current path).
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

  html += '<button onclick="_udBtnGuard(this, saveDiaOwnershipResolution)" style="margin-top:12px;width:100%;padding:10px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer">Save Ownership</button>';

  // Quick actions
  html += '<div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">';
  const searchQ = (r.recorded_owner_name || r.facility_name || '') + ' ' + (r.state || '');
  html += '<a href="https://www.google.com/search?q=' + encodeURIComponent(searchQ + ' ownership') + '" target="_blank" rel="noopener" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none">Google Owner</a>';
  if (r.state) {
    html += '<a href="https://www.google.com/search?q=' + encodeURIComponent('Secretary of State business search ' + r.state) + '" target="_blank" rel="noopener" style="font-size:11px;padding:4px 10px;border-radius:6px;background:var(--s2);border:1px solid var(--border);color:var(--text2);text-decoration:none">SOS ' + esc(r.state) + '</a>';
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
  html += '<button class="btn-primary" onclick="_udBtnGuard(this, saveDiaDetailResearch)">Save</button>';
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
async function saveDiaDetailResearch() {
  const status = document.getElementById('diaDetailStatus')?.value;
  const notes = document.getElementById('diaDetailNotes')?.value;

  if (!status) {
    showToast('Please select a status', 'warning');
    return;
  }

  // Get clinic ID from the current detail panel context
  const clinicIdEl = document.querySelector('[data-clinic-id]');
  const clinicId = clinicIdEl ? clinicIdEl.getAttribute('data-clinic-id') : null;

  if (!clinicId) {
    showToast('Clinic ID not found', 'error');
    return;
  }

  const btn = document.querySelector('[onclick*="saveDiaDetailResearch"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; btn.style.opacity = '0.6'; }
  try {
    await saveDiaOutcome('property_review', clinicId, status, null, notes);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; btn.style.opacity = ''; }
  }
}

// ============================================================================
// EXPORT PUBLIC FUNCTIONS
// ============================================================================

// These override the placeholders in index.html
window.diaQuery = diaQuery;
window.loadDiaData = loadDiaData;
// ============================================================================
// PROPERTIES TAB — Server-side paginated property inventory browser
// ============================================================================

window.diaPropertiesSortBy = function(col) {
  if (diaPropertiesSort.col === col) {
    diaPropertiesSort.dir = diaPropertiesSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    diaPropertiesSort = { col: col, dir: 'desc' };
  }
  diaPropertiesPage = 0;
  renderDiaProperties();
};

// Build PostgREST order string from current sort state
function _diaPropsOrder() {
  var col = diaPropertiesSort.col || 'address';
  var dir = diaPropertiesSort.dir || 'asc';
  var nulls = (col === 'address' || col === 'property_name' || col === 'city' || col === 'state' || col === 'owner' || col === 'tenant') ? '' : '.nullslast';
  return col + '.' + dir + nulls;
}

// Build server-side filter + filter2 from search + state inputs
function _diaPropsFilters() {
  var filter = null, filter2 = null;
  if (diaPropertiesStateFilter) {
    filter = 'state=eq.' + diaPropertiesStateFilter;
  }
  if (diaPropertiesSearch) {
    var sq = diaPropertiesSearch.replace(/%/g, '').replace(/\\/g, '');
    var searchFilter = 'or(address.ilike.*' + sq + '*,property_name.ilike.*' + sq + '*,city.ilike.*' + sq + '*,state.ilike.*' + sq + '*,owner.ilike.*' + sq + '*)';
    if (filter) { filter2 = searchFilter; } else { filter = searchFilter; }
  }
  return { filter: filter, filter2: filter2 };
}

// Canonical US state/territory codes (50 states + DC + 5 inhabited territories = 56)
// Used to whitelist raw values from the properties.state column so junk data
// (foreign codes, full names, whitespace, casing dupes) does not leak into the
// Properties tab state filter dropdown.
var DIA_US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP'
]);

// Background-load summary stats (states, avg SF) via lightweight aggregate queries.
// Two parallel single-column queries instead of fetching all 11k rows:
//   1) state column (non-null only) — deduplicate client-side for distinct count
//   2) building_size column (> 0 only) — compute avg from the filtered subset
//      NOTE: the DIA properties table uses `building_size` (the v_available_listings
//      view aliases it as `rba`). An earlier attempt queried `building_sf`, which
//      does not exist on this table and silently returned 0 rows.
async function _loadDiaPropertiesSummary() {
  if (diaPropertiesSummary) return;
  try {
    // Run two focused queries in parallel — much lighter than SELECT state, building_size FROM all rows
    var results = await Promise.all([
      diaQueryAll('properties', 'state', { filter: 'state=not.is.null' }),
      diaQueryAll('properties', 'building_size', { filter: 'building_size=gt.0' })
    ]);
    var stateRows = results[0];
    var sfRows = results[1];

    // If both queries returned nothing, likely a transient error — don't cache so we can retry
    if (stateRows.length === 0 && sfRows.length === 0) {
      console.warn('Properties summary: both queries returned 0 rows, will retry on next render');
      return;
    }

    // Extract unique states — normalize (trim + uppercase) and whitelist to canonical
    // US codes so junk values (foreign codes like AD/AG, lowercase dupes, full names
    // like "Alabama", stray whitespace) don't pollute the filter dropdown.
    var states = [];
    var seen = {};
    for (var i = 0; i < stateRows.length; i++) {
      var raw = stateRows[i].state;
      if (!raw) continue;
      var st = String(raw).trim().toUpperCase();
      if (!DIA_US_STATES.has(st)) continue;
      if (!seen[st]) { seen[st] = true; states.push(st); }
    }
    states.sort();

    // Compute avg SF from pre-filtered rows (only rows with building_size > 0)
    var withSFCount = sfRows.length;
    var sfSum = 0;
    for (var j = 0; j < sfRows.length; j++) {
      sfSum += parseFloat(sfRows[j].building_size);
    }
    var avgSF = withSFCount > 0 ? Math.round(sfSum / withSFCount) : 0;

    diaPropertiesSummary = { states: states, withSFCount: withSFCount, avgSF: avgSF, total: stateRows.length };

    // Update DOM in-place without full re-render
    var statesValEl = document.getElementById('diaPropStatesValue');
    var statesSubEl = document.getElementById('diaPropStatesSub');
    if (statesValEl) statesValEl.textContent = fmtN(states.length);
    if (statesSubEl) statesSubEl.textContent = states.slice(0, 5).join(', ') + (states.length > 5 ? '...' : '');
    var sfValEl = document.getElementById('diaPropSFValue');
    var sfSubEl = document.getElementById('diaPropSFSub');
    if (sfValEl) sfValEl.textContent = avgSF > 0 ? fmtN(avgSF) : '\u2014';
    if (sfSubEl) sfSubEl.textContent = withSFCount + ' with SF data';
    // Populate state dropdown if not yet populated
    var sel = document.getElementById('diaPropsStateSelect');
    if (sel && sel.options.length <= 1) {
      states.forEach(function(s) {
        var opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        if (diaPropertiesStateFilter === s) opt.selected = true;
        sel.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Properties summary error:', e);
  }
}

async function renderDiaProperties() {
  var inner = q('#bizPageInner');
  if (!inner) return;

  // Build server-side query params
  var order = _diaPropsOrder();
  var filters = _diaPropsFilters();
  var offset = diaPropertiesPage * DIA_PROPERTIES_PAGE_SIZE;

  // Show loading spinner on first render only
  if (diaPropertiesData === null) {
    inner.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading properties...</p></div>';
  }

  // Race-condition guard: ignore responses from stale requests
  var requestId = ++diaPropertiesRequestId;
  diaPropertiesLoading = true;

  try {
    var result = await diaQueryPage('properties', '*', {
      order: order,
      filter: filters.filter,
      filter2: filters.filter2,
      limit: DIA_PROPERTIES_PAGE_SIZE,
      offset: offset
    });
    if (requestId !== diaPropertiesRequestId) return; // stale
    diaPropertiesData = result.data;
    diaPropertiesTotalCount = result.count;
  } catch (e) {
    if (requestId !== diaPropertiesRequestId) return;
    console.error('Properties load error:', e);
    showToast('Properties load failed', 'error');
    diaPropertiesData = [];
    diaPropertiesTotalCount = 0;
  }
  diaPropertiesLoading = false;

  var pageRows = diaPropertiesData;
  var totalCount = diaPropertiesTotalCount;
  var totalPages = Math.max(1, Math.ceil(totalCount / DIA_PROPERTIES_PAGE_SIZE));

  // Kick off background summary load (states, avg SF) — runs once
  if (!diaPropertiesSummary) { _loadDiaPropertiesSummary(); }
  var summary = diaPropertiesSummary; // may be null on first render

  var html = '<div class="biz-section">';

  // Action guidance banner
  html += '<div style="padding:10px 14px;background:rgba(108,140,255,0.08);border-radius:8px;border-left:3px solid #6c8cff;margin-bottom:16px;display:flex;align-items:center;gap:10px;">';
  html += '<div style="font-size:13px;color:var(--text);line-height:1.4"><strong>Properties</strong> \u2014 Browse the full dialysis property inventory. Click any row to view property details, ownership, and linked clinics.</div>';
  html += '</div>';

  // Summary metrics — total count from server, others from background summary
  html += '<div class="dia-grid dia-grid-3" style="margin-bottom:16px;">';
  html += infoCard({ title: 'Total Properties', value: fmtN(totalCount), sub: 'in database', color: 'blue' });
  html += infoCard({
    title: 'States Represented',
    value: summary ? fmtN(summary.states.length) : '...',
    sub: summary ? summary.states.slice(0, 5).join(', ') + (summary.states.length > 5 ? '...' : '') : 'loading',
    color: 'green', id: 'diaPropStatesValue', subId: 'diaPropStatesSub'
  });
  html += infoCard({
    title: 'Avg Building SF',
    value: summary ? (summary.avgSF > 0 ? fmtN(summary.avgSF) : '\u2014') : '...',
    sub: summary ? summary.withSFCount + ' with SF data' : 'loading',
    color: 'purple', id: 'diaPropSFValue', subId: 'diaPropSFSub'
  });
  html += '</div>';

  // Search bar + State filter
  var summaryStates = summary ? summary.states : [];
  html += '<div style="margin:16px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">';
  html += '<input type="text" id="diaPropsSearchInput" placeholder="Search address, name, city, state, owner..." value="' + esc(diaPropertiesSearch) + '" style="flex:1;min-width:200px;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:13px;" />';
  html += '<select id="diaPropsStateSelect" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:13px;">';
  html += '<option value="">All States</option>';
  summaryStates.forEach(function(st) {
    html += '<option value="' + esc(st) + '"' + (diaPropertiesStateFilter === st ? ' selected' : '') + '>' + esc(st) + '</option>';
  });
  html += '</select>';
  if (diaPropertiesSort.col && diaPropertiesSort.col !== 'address') {
    html += '<button class="pill active" id="diaPropsClearSort" style="font-size:11px;padding:4px 10px;">Clear Sort</button>';
  }
  html += '<span style="font-size:12px;color:var(--text3);">' + fmtN(totalCount) + ' results</span>';
  html += '</div>';

  // Sort toolbar — address is the default/primary sort
  var SORT_COLS = [
    { col: 'address', label: 'Address' },
    { col: 'city', label: 'City' },
    { col: 'state', label: 'State' },
    { col: 'building_size', label: 'SF' },
    { col: 'year_built', label: 'Year Built' },
    { col: 'tenant', label: 'Tenant' },
    { col: 'owner', label: 'Owner' }
  ];
  var sortArrow = function(col) {
    if (diaPropertiesSort.col !== col) return '';
    return diaPropertiesSort.dir === 'asc' ? ' \u25B2' : ' \u25BC';
  };
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">';
  html += '<span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.4px;margin-right:4px;">Sort:</span>';
  SORT_COLS.forEach(function(s) {
    var active = diaPropertiesSort.col === s.col;
    html += '<button class="pill' + (active ? ' active' : '') + '" data-prop-sort-col="' + s.col + '" style="font-size:11px;padding:4px 10px;">' + s.label + sortArrow(s.col) + '</button>';
  });
  html += '</div>';

  // Scrollable card grid — address is the primary title, with city/state/zip subtitle
  html += '<div style="overflow-y:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:10px;max-height:70vh;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">';

  pageRows.forEach(function(r, _ri) {
    // Title priority: address (primary) > property_name / facility_name (fallback)
    var title = r.address || r.property_name || r.facility_name || '\u2014';
    var locParts = [];
    if (r.city) locParts.push(r.city);
    if (r.state) locParts.push(r.state);
    var locLine = locParts.join(', ');
    if (r.zip_code) locLine = locLine ? locLine + ' ' + r.zip_code : String(r.zip_code);

    var metaParts = [];
    if (r.building_size && parseFloat(r.building_size) > 0) {
      metaParts.push(fmtN(Math.round(parseFloat(r.building_size))) + ' SF');
    }
    if (r.year_built) metaParts.push('Built ' + r.year_built);
    if (r.cap_rate) {
      var capNum = parseFloat(r.cap_rate);
      if (capNum > 0) {
        var capPct = capNum < 1 ? (capNum * 100).toFixed(1) : capNum.toFixed(1);
        metaParts.push('Cap: ' + capPct + '%');
      }
    }

    html += '<div class="prop-card clickable-row" data-prop-idx="' + _ri + '" style="cursor:pointer;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--s2);display:flex;flex-direction:column;gap:3px;">';
    html += '<div class="prop-card-title" style="font-size:14px;font-weight:700;color:var(--text);line-height:1.3;overflow:hidden;text-overflow:ellipsis;">' + esc(title) + '</div>';
    if (locLine) {
      html += '<div class="prop-card-sub" style="font-size:12px;color:var(--text2);">' + esc(locLine) + '</div>';
    }
    if (r.tenant) {
      html += '<div class="prop-card-tenant" style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.4px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.tenant) + '</div>';
    }
    if (metaParts.length) {
      html += '<div class="prop-card-meta" style="font-size:11px;color:var(--text2);font-family:\'JetBrains Mono\',monospace;margin-top:4px;">' + esc(metaParts.join(' | ')) + '</div>';
    }
    if (r.owner && r.owner !== r.tenant) {
      html += '<div class="prop-card-owner" style="font-size:10px;color:var(--text3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Owner: ' + esc(r.owner) + '</div>';
    }
    html += '</div>';
  });

  if (pageRows.length === 0) {
    html += '<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--text3);">No properties to display</div>';
  }
  html += '</div>';

  // Pagination
  if (totalPages > 1) {
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:13px;color:var(--text2);">';
    html += '<span>Page ' + (diaPropertiesPage + 1) + ' of ' + fmtN(totalPages) + ' (' + fmtN(totalCount) + ' total)</span>';
    html += '<div style="display:flex;gap:6px;">';
    html += '<button class="pill' + (diaPropertiesPage === 0 ? '' : ' active') + '" data-props-page="prev"' + (diaPropertiesPage === 0 ? ' disabled style="opacity:0.4;pointer-events:none"' : '') + '>&laquo; Prev</button>';
    html += '<button class="pill' + (diaPropertiesPage >= totalPages - 1 ? '' : ' active') + '" data-props-page="next"' + (diaPropertiesPage >= totalPages - 1 ? ' disabled style="opacity:0.4;pointer-events:none"' : '') + '>Next &raquo;</button>';
    html += '</div></div>';
  }

  html += '</div>';

  // Render to DOM
  inner.innerHTML = html;

  // Bind row click — open unified detail sidebar
  document.querySelectorAll('[data-prop-idx]').forEach(function(tr) {
    tr.addEventListener('click', function() {
      var idx = parseInt(this.dataset.propIdx, 10);
      var row = pageRows[idx];
      if (row && row.property_id) {
        openUnifiedDetail('dialysis', { property_id: row.property_id }, row);
      }
    });
  });

  // Pagination handlers
  document.querySelectorAll('[data-props-page]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (this.dataset.propsPage === 'prev' && diaPropertiesPage > 0) diaPropertiesPage--;
      else if (this.dataset.propsPage === 'next') diaPropertiesPage++;
      renderDiaProperties();
    });
  });

  // Search input — debounced server-side search
  var searchInput = document.getElementById('diaPropsSearchInput');
  if (searchInput) {
    var debounce;
    searchInput.addEventListener('input', function(e) {
      clearTimeout(debounce);
      debounce = setTimeout(function() {
        diaPropertiesSearch = e.target.value.trim();
        diaPropertiesPage = 0;
        renderDiaProperties();
        var restored = document.getElementById('diaPropsSearchInput');
        if (restored) {
          restored.focus();
          restored.setSelectionRange(restored.value.length, restored.value.length);
        }
      }, 400);
    });
    searchInput.focus();
    searchInput.selectionStart = searchInput.selectionEnd = searchInput.value.length;
  }

  // State filter
  var stateSelect = document.getElementById('diaPropsStateSelect');
  if (stateSelect) {
    stateSelect.addEventListener('change', function() {
      diaPropertiesStateFilter = this.value;
      diaPropertiesPage = 0;
      renderDiaProperties();
    });
  }

  // Clear sort button
  var clearSortBtn = document.getElementById('diaPropsClearSort');
  if (clearSortBtn) {
    clearSortBtn.addEventListener('click', function() {
      diaPropertiesSort = { col: 'address', dir: 'asc' };
      diaPropertiesPage = 0;
      renderDiaProperties();
    });
  }

  // Column sort handlers
  document.querySelectorAll('[data-prop-sort-col]').forEach(function(thEl) {
    thEl.addEventListener('click', function() {
      var col = this.dataset.propSortCol;
      if (diaPropertiesSort.col === col) {
        diaPropertiesSort.dir = diaPropertiesSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        diaPropertiesSort = { col: col, dir: 'desc' };
      }
      diaPropertiesPage = 0;
      renderDiaProperties();
    });
  });
}

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
      diaSalesComps = await loadDiaSalesCompsFromTxns();
    } catch (e) { console.error('Sales comps load error:', e); showToast('Sales comps load failed', 'error'); diaSalesComps = []; }
    diaSalesLoading = false;
  }
  if (diaSalesView === 'available' && (!diaAvailListings || diaAvailListings.length === 0) && !diaSalesLoading) {
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
    } catch (e) { console.error('Available listings load error:', e); showToast('Listings load failed', 'error'); diaAvailListings = []; }
    diaSalesLoading = false;
  }

  const isComps = diaSalesView === 'comps';
  let data = isComps ? (diaSalesComps || []) : (diaAvailListings || []);

  // Filter out blank/empty records — require at least an address or operator name
  data = data.filter(r => (r.address && r.address.trim()) || (r.tenant_operator && r.tenant_operator.trim()) || (r.facility_name && r.facility_name.trim()));

  // Deduplicate rows — Sales Comps are already DB-deduped by sale_id in
  // sales_transactions, so the dedup pass runs only for Available Listings
  // (v_available_listings can still return duplicates from joins).
  if (!isComps) {
    const seen = new Set();
    data = data.filter(r => {
      const addr = (r.address || '').trim().toLowerCase();
      const dateKey = r.listing_date || '';
      const priceKey = r.ask_price || '';
      const key = `${addr}|${dateKey}|${priceKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

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

  // Store filtered data for export
  diaFilteredSalesData = filtered;

  const totalPages = Math.ceil(filtered.length / DIA_SALES_PAGE_SIZE);
  const pageRows = filtered.slice(diaSalesPage * DIA_SALES_PAGE_SIZE, (diaSalesPage + 1) * DIA_SALES_PAGE_SIZE);

  let html = '<div class="biz-section">';

  // === Action guidance banner ===
  html += '<div style="padding:10px 14px;background:rgba(52,211,153,0.08);border-radius:8px;border-left:3px solid #34d399;margin-bottom:16px;display:flex;align-items:center;gap:10px;">';
  if (isComps) {
    html += '<div style="font-size:13px;color:var(--text);line-height:1.4"><strong>Sales Comps</strong> — Browse closed dialysis property transactions. Use these as comparable evidence for BOV underwriting. Click any row to view full property details and financials.</div>';
  } else {
    html += '<div style="font-size:13px;color:var(--text);line-height:1.4"><strong>Available Listings</strong> — Monitor on-market dialysis properties. Identify acquisition opportunities or competitive positioning for your pipeline. Click any row for property details.</div>';
  }
  html += '</div>';

  // Sub-tab toggle: Sales Comps | Available
  html += '<div class="pills" style="margin-bottom: 16px;">';
  html += '<button class="pill' + (isComps ? ' active' : '') + '" data-sales-view="comps">Sales Comps (' + (diaSalesComps ? fmtN(diaSalesComps.length) : '…') + ')</button>';
  html += '<button class="pill' + (!isComps ? ' active' : '') + '" data-sales-view="available">Available (' + (diaAvailListings ? fmtN(diaAvailListings.length) : '…') + ')</button>';
  html += '</div>';

  // Metrics
  html += '<div class="dia-grid dia-grid-4" style="margin-bottom: 16px;">';
  // Helper: compute average cap rate, normalizing mixed formats.
  // DB stores some rows as decimals (0.07 = 7%) and others as percentages (7.15 = 7.15%).
  // Normalize everything to decimal before averaging, then display as percentage.
  const avgCapRate = (arr, field) => {
    const normalized = [];
    arr.forEach(r => {
      const v = parseFloat(r[field]);
      if (!v || v <= 0) return;
      // Same threshold as fmtCap: v < 1 means decimal format, else percentage format
      const dec = v < 1 ? v : v / 100;
      // Filter outliers: keep 1%–25% (0.01–0.25 in decimal)
      if (dec > 0.01 && dec < 0.25) normalized.push(dec);
    });
    if (normalized.length === 0) return { val: '—', n: 0 };
    return { val: (normalized.reduce((s, d) => s + d, 0) / normalized.length * 100).toFixed(2) + '%', n: normalized.length };
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
  html += '<button onclick="exportCompsToXlsx(diaFilteredSalesData, \'sales\')" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--s2);color:var(--accent);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:4px;" title="Export all ' + fmtN(filtered.length) + ' filtered results to Excel">&#x1F4E5; Export</button>';
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
  html += '<th style="text-align:center;min-width:90px;position:sticky;right:0;background:var(--s2);z-index:2;border-left:1px solid var(--border)">Actions</th>';
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

  pageRows.forEach((r, _ri) => {
    const _zebra = _ri % 2 === 0 ? '' : 'background:rgba(255,255,255,0.02);';
    html += '<tr class="clickable-row" onclick=\'openDiaSaleOrProperty(' + safeJSON(r) + ')\' style="cursor: pointer;' + _zebra + '">';
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
    html += '<td style="text-align:center;position:sticky;right:0;background:var(--s1);z-index:1;border-left:1px solid var(--border);padding:4px" onclick="event.stopPropagation()">';
    html += '<div style="display:flex;gap:3px;justify-content:center;flex-wrap:wrap">';
    // Marketing collateral icons — OM PDF + any marketplace/broker URLs.
    // Dia schema uses separate `url` + `listing_url` text columns (no
    // tracked_urls jsonb), so surface both via extraUrlFields.
    if (typeof buildCollateralIcons === 'function') {
      html += buildCollateralIcons(r, {
        pdf:             'intake_artifact_path',
        pdfType:         'intake_artifact_type',
        primaryUrl:      'url',
        extraUrlFields:  ['listing_url']
      });
    }
    html += '<button class="gov-row-action" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic", "Ownership")\' title="View owner & contacts">📞</button>';
    html += '<button class="gov-row-action accent" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic", "Intel")\' title="Research & intel">🔍</button>';
    html += '</div></td>';
    html += '</tr>';
  });

  if (pageRows.length === 0) {
    const colSpan = isComps ? 24 : 20;
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
        // Restore focus after DOM re-render
        const restored = document.getElementById('diaSalesSearchInput');
        if (restored) {
          restored.focus();
          restored.setSelectionRange(restored.value.length, restored.value.length);
        }
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
  html += '<div style="font-size:16px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px"><span style="font-size:20px">📋</span> Dialysis Lease Intelligence</div>';

  // === Action guidance banner ===
  html += '<div style="padding:10px 14px;background:rgba(248,113,113,0.08);border-radius:8px;border-left:3px solid #f87171;margin-bottom:16px;display:flex;align-items:center;gap:10px;">';
  html += '<div style="font-size:13px;color:var(--text);line-height:1.4"><strong>Action:</strong> Review lease expirations and data gaps across tracked clinics. <strong>Flag</strong> watchlist items that need lease research or pipeline consideration. Use the <em>Research Workbench</em> to backfill missing lease data.</div>';
  html += '</div>';

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
    html += '<th>Facility</th><th>Operator</th><th>City</th><th>State</th><th>Risk</th><th style="text-align:right">Months Left</th><th>Expiration</th><th style="text-align:center;min-width:140px">Actions</th>';
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
      html += '<tr class="clickable-row" onclick=\'showDetail(' + safeJSON(c) + ', "dia-clinic")\'>';
      html += '<td>' + esc(c.facility_name || '—') + '</td>';
      html += '<td>' + ((c.operator_name || c.parent_organization) ? entityLink(c.operator_name || c.parent_organization, 'operator', null) : '—') + '</td>';
      html += '<td>' + esc(c.city || '—') + '</td>';
      html += '<td>' + esc(c.state || '—') + '</td>';
      html += '<td>' + riskBadge + '</td>';
      html += '<td style="text-align:right;color:' + moColor + ';font-weight:600">' + moLabel + '</td>';
      html += '<td>' + exp + '</td>';
      html += '<td style="text-align:center" onclick="event.stopPropagation()">';
      html += '<div style="display:flex;gap:3px;justify-content:center">';
      html += '<button class="lease-flag-btn" data-lid="' + esc(c.clinic_id || c.medicare_id || '') + '" data-lname="' + esc(c.facility_name || '') + '" style="font-size:9px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;background:var(--s3);color:var(--text2);cursor:pointer;" title="Flag for research">Flag</button>';
      html += '<button class="gov-row-action" onclick=\'showDetail(' + safeJSON(c) + ', "dia-clinic", "Ownership")\' title="View owner details & contacts">📞</button>';
      html += '<button class="gov-row-action accent" onclick=\'showDetail(' + safeJSON(c) + ', "dia-clinic", "Intel")\' title="Research & intel">🔍</button>';
      html += '</div></td>';
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

  // Attach handlers after DOM render (called via setTimeout from renderDiaLeases)
  setTimeout(function() {
    document.querySelectorAll('.lease-flag-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var lid = btn.dataset.lid;
        var lname = btn.dataset.lname;
        if (!lid) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await applyInsertWithFallback({
            proxyBase: '/api/dia-query',
            table: 'research_queue_outcomes',
            data: {
              medicare_id: lid,
              outcome: 'flagged_for_review',
              notes: 'Flagged from Lease Watchlist — expiring/at-risk lease',
              created_at: new Date().toISOString()
            },
            source_surface: 'dia_lease_flag'
          });
          btn.textContent = '✓';
          btn.style.color = 'var(--success)';
          btn.style.borderColor = 'var(--success)';
          showToast('Flagged ' + (lname || lid) + ' for review', 'success');
        } catch(e) {
          btn.disabled = false;
          btn.textContent = 'Flag';
          showToast('Flag failed: ' + e.message, 'error');
        }
      });
    });
  }, 0);

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
  html += '<div style="font-size:16px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px"><span style="font-size:20px">🏦</span> Dialysis Loan Intelligence</div>';

  // === Action guidance banner ===
  html += '<div style="padding:10px 14px;background:rgba(108,140,255,0.08);border-radius:8px;border-left:3px solid #6c8cff;margin-bottom:16px;display:flex;align-items:center;gap:10px;">';
  html += '<div style="font-size:13px;color:var(--text);line-height:1.4"><strong>Action:</strong> Review loan data for maturity signals and financing patterns. <strong>Flag</strong> loans approaching maturity or with distress indicators for prospecting consideration. <strong>Ack</strong> (acknowledge) flagged loans you have already reviewed.</div>';
  html += '</div>';

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
  html += '<th>Facility</th><th>City</th><th style="text-align:right">Loan Amount</th><th style="text-align:right">Rate</th><th>Type</th><th>Lender</th><th>Maturity</th><th>Alert</th><th style="text-align:center;min-width:140px">Actions</th>';
  html += '</tr></thead><tbody>';
  for (var li = 0; li < Math.min(sorted.length, 50); li++) {
    var ln = sorted[li];
    var rate = parseFloat(ln.interest_rate_percent) > 0 ? parseFloat(ln.interest_rate_percent).toFixed(2) + '%' : (ln.interest_rate_text || '—');
    var alertBadge = ln.alert_flag ? '<span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px">FLAG</span>' : '<span style="font-size:11px;color:var(--text3)">—</span>';
    var matDate = ln.maturity_date ? new Date(ln.maturity_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '—';
    html += '<tr class="clickable-row" onclick=\'showDetail(' + safeJSON(ln) + ', "dia-clinic")\'>';
    html += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ln.facility_name || String(ln.property_id || '—')) + '</td>';
    html += '<td>' + esc((ln.city || '') + (ln.state ? ', ' + ln.state : '')) + '</td>';
    html += '<td style="text-align:right;font-weight:600">' + fmt(parseFloat(ln.loan_amount) || 0) + '</td>';
    html += '<td style="text-align:right">' + rate + '</td>';
    html += '<td>' + esc(ln.loan_type || '—') + '</td>';
    html += '<td>' + esc(ln.lender_name || '—') + '</td>';
    html += '<td>' + matDate + '</td>';
    html += '<td>' + alertBadge + '</td>';
    html += '<td style="text-align:center" onclick="event.stopPropagation()">';
    html += '<div style="display:flex;gap:3px;justify-content:center">';
    html += '<button class="loan-flag-btn" data-loan-id="' + esc(ln.loan_id || '') + '" data-loan-name="' + esc(ln.facility_name || '') + '" style="font-size:9px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;background:var(--s3);color:var(--text2);cursor:pointer;" title="Flag for review">' + (ln.alert_flag ? 'Ack' : 'Flag') + '</button>';
    html += '<button class="gov-row-action" onclick=\'showDetail(' + safeJSON(ln) + ', "dia-clinic", "Ownership")\' title="View owner details & contacts">📞</button>';
    html += '<button class="gov-row-action accent" onclick=\'showDetail(' + safeJSON(ln) + ', "dia-clinic", "Intel")\' title="Research & intel">🔍</button>';
    html += '</div></td>';
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  if (sorted.length > 50) html += '<div style="text-align:center;font-size:12px;color:var(--text3);padding:8px">Showing 50 of ' + fmtN(sorted.length) + '</div>';
  html += '</div>';

  html += '</div>';

  // Attach handlers after DOM render
  setTimeout(function() {
    document.querySelectorAll('.loan-flag-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var loanId = btn.dataset.loanId;
        var loanName = btn.dataset.loanName;
        if (!loanId) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await applyInsertWithFallback({
            proxyBase: '/api/dia-query',
            table: 'research_queue_outcomes',
            data: {
              medicare_id: loanId,
              outcome: 'flagged_for_review',
              notes: 'Flagged from Loans tab — loan alert acknowledged',
              created_at: new Date().toISOString()
            },
            source_surface: 'dia_loan_flag'
          });
          btn.textContent = '✓';
          btn.style.color = 'var(--success)';
          btn.style.borderColor = 'var(--success)';
          showToast('Loan flagged: ' + (loanName || loanId), 'success');
        } catch(e) {
          btn.disabled = false;
          btn.textContent = 'Flag';
          showToast('Flag failed: ' + e.message, 'error');
        }
      });
    });
  }, 0);

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
  // Apply pending navigation filter
  if (window._pendingOpFilter) {
    const filter = window._pendingOpFilter;
    window._pendingOpFilter = null;

    if (filter.type === 'operator') {
      // Switch to operators view and highlight the matching operator
      diaPlayersView = 'operators';
      window._highlightOperator = filter.value;
    } else if (filter.type === 'state') {
      // Switch to operators view filtered by state
      diaPlayersView = 'operators';
      window._highlightState = filter.value;
    }
  }

  let html = '<div class="biz-section">';

  // === Action guidance banner ===
  html += '<div style="padding:10px 14px;background:rgba(167,139,250,0.08);border-radius:8px;border-left:3px solid #a78bfa;margin-bottom:16px;display:flex;align-items:center;gap:10px;">';
  html += '<div style="font-size:13px;color:var(--text);line-height:1.4"><strong>Market Players</strong> — Analyze operators, buyers, sellers, and brokers active in the dialysis property market. Click any row to view entity details and related properties. Use this intelligence for pipeline targeting and competitive positioning.</div>';
  html += '</div>';

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
    html += '<div style="flex: 0.8; text-align: center;">Actions</div>';
    html += '</div>';

    topOps.forEach((p, idx) => {
      const avg = p.clinics > 0 ? Math.round(p.patients / p.clinics) : 0;

      // Check for operator or state highlighting
      const isHighlightOp = window._highlightOperator && (p.name || '').toLowerCase().includes(window._highlightOperator.toLowerCase());
      const isHighlightState = window._highlightState && p.records.some(r => (r.state || '').toUpperCase() === window._highlightState.toUpperCase());
      const rowStyle = (isHighlightOp || isHighlightState) ? 'background:var(--accent-bg,rgba(59,130,246,0.1));border-left: 3px solid var(--accent,#3b82f6);' : '';

      html += '<div class="table-row clickable-row" style="' + rowStyle + '" onclick=\'showDetail(' + safeJSON(p.records[0]) + ', "dia-clinic")\'>';
      html += '<div style="flex: 3;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(p.name) + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + p.clinics + '</div>';
      html += '<div style="flex: 1; text-align: right;">' + fmtN(p.patients) + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + fmtN(avg) + '</div>';
      html += '<div style="flex: 0.8; text-align: center;" onclick="event.stopPropagation()"><button class="gov-row-action" onclick=\'showDetail(' + safeJSON(p.records[0]) + ', "dia-clinic", "Ownership")\' title="View owner & contacts">📞</button> <button class="gov-row-action accent" onclick=\'showDetail(' + safeJSON(p.records[0]) + ', "dia-clinic", "Intel")\' title="Research & intel">🔍</button></div>';
      html += '</div>';
    });
    html += '</div></div>';

    // Clear highlight flags after rendering
    window._highlightOperator = null;
    window._highlightState = null;

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
    html += '<div style="flex: 0.8; text-align: center;">Actions</div>';
    html += '</div>';

    sorted.forEach((r, idx) => {
      html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic")\'>';
      html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(r.facility_name || '—') + '</div>';
      html += '<div style="flex: 1;">' + esc((r.city || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</div>';
      html += '<div style="flex: 1;" class="truncate">' + (r.operator_name ? entityLink(r.operator_name, 'operator', null) : '—') + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + fmtN(r.latest_total_patients || 0) + '</div>';
      html += '<div style="flex: 1; color: var(--text2);">' + esc(r.ccn || '—') + '</div>';
      html += '<div style="flex: 0.8; text-align: center;" onclick="event.stopPropagation()"><button class="gov-row-action" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic", "Ownership")\' title="View owner & contacts">📞</button> <button class="gov-row-action accent" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic", "Intel")\' title="Research & intel">🔍</button></div>';
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
    html += '<div style="flex: 0.8; text-align: center;">Actions</div>';
    html += '</div>';

    sorted.forEach((r, idx) => {
      const deltaColor = (r.delta_patients || 0) > 0 ? '#34d399' : '#f87171';
      html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic")\'>';
      html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(r.facility_name || '—') + '</div>';
      html += '<div style="flex: 1;">' + esc((r.city || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</div>';
      html += '<div style="flex: 1;" class="truncate">' + (r.operator_name ? entityLink(r.operator_name, 'operator', null) : '—') + '</div>';
      html += '<div style="flex: 1; text-align: right; color: ' + deltaColor + ';">' + ((r.delta_patients || 0) > 0 ? '+' : '') + fmtN(r.delta_patients || 0) + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + pct(r.pct_change || 0) + '</div>';
      html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + fmtN(r.latest_total_patients || 0) + '</div>';
      html += '<div style="flex: 0.8; text-align: center;" onclick="event.stopPropagation()"><button class="gov-row-action" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic", "Ownership")\' title="View owner & contacts">📞</button> <button class="gov-row-action accent" onclick=\'showDetail(' + safeJSON(r) + ', "dia-clinic", "Intel")\' title="Research & intel">🔍</button></div>';
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
              if (r.cap_rate) { var _cr = parseFloat(r.cap_rate); buyerMap[key].capRates.push(_cr < 1 ? _cr * 100 : _cr); }
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
      html += '<div style="flex: 0.8; text-align: center;">Actions</div>';
      html += '</div>';

      top50.forEach((b, idx) => {
        const avgCapRate = b.capRates.length > 0 ? b.capRates.reduce((s, cr) => s + cr, 0) / b.capRates.length : 0;
        html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(b.records[0]) + ', "sales-transaction")\'>';
        html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + entityLink(b.name, 'contact', null, 'dialysis') + '</div>';
        html += '<div style="flex: 1;">' + esc(b.type || '—') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + b.deals + '</div>';
        html += '<div style="flex: 1; text-align: right;">' + fmt(b.volume, 'currency') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + pct(avgCapRate / 100) + '</div>';
        html += '<div style="flex: 0.8; text-align: center;" onclick="event.stopPropagation()"><button class="gov-row-action" onclick=\'showDetail(' + safeJSON(b.records[0]) + ', "dia-clinic", "Ownership")\' title="View owner & contacts">📞</button> <button class="gov-row-action accent" onclick=\'showDetail(' + safeJSON(b.records[0]) + ', "dia-clinic", "Intel")\' title="Research & intel">🔍</button></div>';
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
              if (r.cap_rate) { var _cr = parseFloat(r.cap_rate); sellerMap[key].capRates.push(_cr < 1 ? _cr * 100 : _cr); }
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
      html += '<div style="flex: 0.8; text-align: center;">Actions</div>';
      html += '</div>';

      top50.forEach((s2, idx) => {
        const avgCapRate = s2.capRates.length > 0 ? s2.capRates.reduce((s, cr) => s + cr, 0) / s2.capRates.length : 0;
        html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(s2.records[0]) + ', "sales-transaction")\'>';
        html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + entityLink(s2.name, 'contact', null, 'dialysis') + '</div>';
        html += '<div style="flex: 1;">' + esc(s2.type || '—') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + s2.deals + '</div>';
        html += '<div style="flex: 1; text-align: right;">' + fmt(s2.volume, 'currency') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + pct(avgCapRate / 100) + '</div>';
        html += '<div style="flex: 0.8; text-align: center;" onclick="event.stopPropagation()"><button class="gov-row-action" onclick=\'showDetail(' + safeJSON(s2.records[0]) + ', "dia-clinic", "Ownership")\' title="View owner & contacts">📞</button> <button class="gov-row-action accent" onclick=\'showDetail(' + safeJSON(s2.records[0]) + ', "dia-clinic", "Intel")\' title="Research & intel">🔍</button></div>';
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
              if (sale.cap_rate) { var _cr = parseFloat(sale.cap_rate); brokerStats[key].capRates.push(_cr < 1 ? _cr * 100 : _cr); }
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
      html += '<div style="flex: 0.8; text-align: center;">Actions</div>';
      html += '</div>';

      top50.forEach((b, idx) => {
        const avgCapRate = b.capRates.length > 0 ? b.capRates.reduce((s, cr) => s + cr, 0) / b.capRates.length : 0;
        html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(b.records[0]) + ', "sale-broker")\'>';
        html += '<div style="flex: 2;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(b.broker_name) + '</div>';
        html += '<div style="flex: 1;" class="truncate">' + esc(b.company || '—') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + b.deals + '</div>';
        html += '<div style="flex: 1; text-align: right;">' + fmt(b.volume, 'currency') + '</div>';
        html += '<div style="flex: 1; text-align: right; color: var(--text2);">' + pct(avgCapRate / 100) + '</div>';
        html += '<div style="flex: 0.8; text-align: center;" onclick="event.stopPropagation()"><button class="gov-row-action" onclick=\'showDetail(' + safeJSON(b.records[0]) + ', "dia-clinic", "Ownership")\' title="View owner & contacts">📞</button> <button class="gov-row-action accent" onclick=\'showDetail(' + safeJSON(b.records[0]) + ', "dia-clinic", "Intel")\' title="Research & intel">🔍</button></div>';
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
const DIA_SEARCH_COLLAPSED_LIMIT = 5;
let _diaSearchExpanded = {}; // Track which categories are expanded

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
      html += '<div style="color: var(--text2); font-size: 13px; margin-bottom: 12px;">' + total + ' result' + (total !== 1 ? 's' : '') + ' found</div>';

      // Category anchor bar — clickable jump links for each result type
      const categories = [
        { key: 'clinics', label: 'Clinics', count: clinics.length, color: '#a78bfa' },
        { key: 'npi', label: 'NPI Signals', count: npiSignals.length, color: '#f87171' },
        { key: 'property', label: 'Property Queue', count: propQueue.length, color: '#fbbf24' },
        { key: 'outcomes', label: 'Research', count: outcomes.length, color: '#34d399' }
      ].filter(c => c.count > 0);

      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">';
      categories.forEach(c => {
        html += '<a href="#dia-search-' + c.key + '" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600;text-decoration:none;background:' + c.color + '20;color:' + c.color + ';border:1px solid ' + c.color + '30;cursor:pointer" onclick="event.preventDefault();document.getElementById(\'dia-search-' + c.key + '\')?.scrollIntoView({behavior:\'smooth\',block:\'start\'})">';
        html += c.label + ' <span style="opacity:0.8">(' + c.count + ')</span></a>';
      });
      html += '</div>';

      // Store flat search results array for onclick references (avoids massive inline JSON in DOM)
      window._diaSearchFlat = [];
      function pushDiaRef(record) {
        var idx = window._diaSearchFlat.length;
        window._diaSearchFlat.push(record);
        return idx;
      }

      if (clinics.length > 0) {
        var isExpanded = _diaSearchExpanded.clinics || false;
        var visibleClinics = isExpanded ? clinics : clinics.slice(0, DIA_SEARCH_COLLAPSED_LIMIT);
        html += '<div class="search-results-section" id="dia-search-clinics"><h4>Clinics (' + clinics.length + ')</h4>';
        visibleClinics.forEach(r => {
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
          html += '</div>';
          html += '<div style="display:flex;gap:4px;margin-top:6px" onclick="event.stopPropagation()">';
          html += '<button class="gov-row-action" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\', \'Ownership\')" title="View owner & contacts">📞 Contacts</button>';
          html += '<button class="gov-row-action accent" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\', \'Intel\')" title="Research & intel">🔍 Intel</button>';
          html += '</div></div>';
        });
        if (clinics.length > DIA_SEARCH_COLLAPSED_LIMIT) {
          if (!isExpanded) {
            html += '<button onclick="_diaSearchExpanded.clinics=true;renderDiaTab()" style="width:100%;padding:8px;margin-top:4px;background:var(--s2);border:1px solid var(--border);border-radius:6px;color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">Show all ' + clinics.length + ' clinics</button>';
          } else {
            html += '<button onclick="_diaSearchExpanded.clinics=false;renderDiaTab()" style="width:100%;padding:8px;margin-top:4px;background:var(--s2);border:1px solid var(--border);border-radius:6px;color:var(--text2);font-size:12px;font-weight:600;cursor:pointer">Collapse</button>';
          }
        }
        html += '</div>';
      }

      if (npiSignals.length > 0) {
        var isExpanded = _diaSearchExpanded.npi || false;
        var visibleNpi = isExpanded ? npiSignals : npiSignals.slice(0, DIA_SEARCH_COLLAPSED_LIMIT);
        html += '<div class="search-results-section" id="dia-search-npi"><h4>NPI Signals (' + npiSignals.length + ')</h4>';
        visibleNpi.forEach(r => {
          var idx = pushDiaRef(r);
          html += '<div class="search-card" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\')">';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(norm(r.facility_name) || r.npi || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(248,113,113,0.15); color: #f87171;">NPI Signal</span></div>';
          html += '<div class="search-card-meta">';
          if (r.city || r.state) html += '<span>' + esc((norm(r.city) || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</span>';
          if (r.signal_type) html += '<span>Signal: ' + esc(cleanLabel(r.signal_type)) + '</span>';
          if (r.npi) html += '<span>NPI: ' + esc(r.npi) + '</span>';
          html += '</div>';
          html += '<div style="display:flex;gap:4px;margin-top:6px" onclick="event.stopPropagation()">';
          html += '<button class="gov-row-action" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\', \'Ownership\')" title="View owner & contacts">📞 Contacts</button>';
          html += '<button class="gov-row-action accent" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\', \'Intel\')" title="Research & intel">🔍 Intel</button>';
          html += '</div></div>';
        });
        if (npiSignals.length > DIA_SEARCH_COLLAPSED_LIMIT) {
          if (!isExpanded) {
            html += '<button onclick="_diaSearchExpanded.npi=true;renderDiaTab()" style="width:100%;padding:8px;margin-top:4px;background:var(--s2);border:1px solid var(--border);border-radius:6px;color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">Show all ' + npiSignals.length + ' NPI signals</button>';
          } else {
            html += '<button onclick="_diaSearchExpanded.npi=false;renderDiaTab()" style="width:100%;padding:8px;margin-top:4px;background:var(--s2);border:1px solid var(--border);border-radius:6px;color:var(--text2);font-size:12px;font-weight:600;cursor:pointer">Collapse</button>';
          }
        }
        html += '</div>';
      }

      if (propQueue.length > 0) {
        var isExpanded = _diaSearchExpanded.property || false;
        var visibleProp = isExpanded ? propQueue : propQueue.slice(0, DIA_SEARCH_COLLAPSED_LIMIT);
        html += '<div class="search-results-section" id="dia-search-property"><h4>Property Review Queue (' + propQueue.length + ')</h4>';
        visibleProp.forEach(r => {
          var idx = pushDiaRef(r);
          html += '<div class="search-card" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\')">';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(norm(r.facility_name) || r.clinic_id || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(251,191,36,0.15); color: #fbbf24;">Property</span></div>';
          html += '<div class="search-card-meta">';
          if (r.state) html += '<span>' + esc(r.state) + '</span>';
          if (r.operator_name) html += '<span>Op: ' + esc(norm(r.operator_name)) + '</span>';
          if (r.review_type) html += '<span>Review: ' + esc(cleanLabel(r.review_type)) + '</span>';
          html += '</div>';
          html += '<div style="display:flex;gap:4px;margin-top:6px" onclick="event.stopPropagation()">';
          html += '<button class="gov-row-action" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\', \'Ownership\')" title="View owner & contacts">📞 Contacts</button>';
          html += '<button class="gov-row-action accent" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\', \'Intel\')" title="Research & intel">🔍 Intel</button>';
          html += '</div></div>';
        });
        if (propQueue.length > DIA_SEARCH_COLLAPSED_LIMIT) {
          if (!isExpanded) {
            html += '<button onclick="_diaSearchExpanded.property=true;renderDiaTab()" style="width:100%;padding:8px;margin-top:4px;background:var(--s2);border:1px solid var(--border);border-radius:6px;color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">Show all ' + propQueue.length + ' properties</button>';
          } else {
            html += '<button onclick="_diaSearchExpanded.property=false;renderDiaTab()" style="width:100%;padding:8px;margin-top:4px;background:var(--s2);border:1px solid var(--border);border-radius:6px;color:var(--text2);font-size:12px;font-weight:600;cursor:pointer">Collapse</button>';
          }
        }
        html += '</div>';
      }

      if (outcomes.length > 0) {
        var isExpanded = _diaSearchExpanded.outcomes || false;
        var visibleOutcomes = isExpanded ? outcomes : outcomes.slice(0, DIA_SEARCH_COLLAPSED_LIMIT);
        html += '<div class="search-results-section" id="dia-search-outcomes"><h4>Research Outcomes (' + outcomes.length + ')</h4>';
        visibleOutcomes.forEach(r => {
          var idx = pushDiaRef(r);
          html += '<div class="search-card" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\')">';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(r.queue_type || r.clinic_id || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(52,211,153,0.15); color: #34d399;">Research</span></div>';
          html += '<div class="search-card-meta">';
          if (r.status) html += '<span>Status: ' + esc(r.status) + '</span>';
          if (r.queue_type) html += '<span>Type: ' + esc(r.queue_type) + '</span>';
          if (r.source_bucket) html += '<span>Source: ' + esc(r.source_bucket) + '</span>';
          html += '</div>';
          html += '<div style="display:flex;gap:4px;margin-top:6px" onclick="event.stopPropagation()">';
          html += '<button class="gov-row-action" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\', \'Ownership\')" title="View owner & contacts">📞 Contacts</button>';
          html += '<button class="gov-row-action accent" onclick="showDetail(window._diaSearchFlat[' + idx + '], \'dia-clinic\', \'Intel\')" title="Research & intel">🔍 Intel</button>';
          html += '</div></div>';
        });
        if (outcomes.length > DIA_SEARCH_COLLAPSED_LIMIT) {
          if (!isExpanded) {
            html += '<button onclick="_diaSearchExpanded.outcomes=true;renderDiaTab()" style="width:100%;padding:8px;margin-top:4px;background:var(--s2);border:1px solid var(--border);border-radius:6px;color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">Show all ' + outcomes.length + ' outcomes</button>';
          } else {
            html += '<button onclick="_diaSearchExpanded.outcomes=false;renderDiaTab()" style="width:100%;padding:8px;margin-top:4px;background:var(--s2);border:1px solid var(--border);border-radius:6px;color:var(--text2);font-size:12px;font-weight:600;cursor:pointer">Collapse</button>';
          }
        }
        html += '</div>';
      }
    }
  }

  html += '</div>';

  setTimeout(() => {
    const input = document.getElementById('diaSearchInput');
    if (input) {
      input.onkeydown = e => { if (e.key === 'Enter') execDiaSearch(); };
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

  const searchBtn = document.querySelector('[onclick*="execDiaSearch"]');
  if (searchBtn) { searchBtn.disabled = true; searchBtn.textContent = 'Searching\u2026'; searchBtn.style.opacity = '0.6'; }

  diaSearchTerm = term;
  diaSearching = true;
  _diaSearchExpanded = {}; // Reset expansion state on new search
  renderDiaTab();

  // Sanitize for PostgREST ilike filter — strip syntax-breaking characters
  const safeTerm = term.replace(/[*()',\\]/g, '');
  if (!safeTerm) { diaSearching = false; renderDiaTab(); return; }
  const like = '*' + safeTerm + '*';
  try {
    const [clinics, npiSignals, propQueue, outcomes] = await Promise.all([
      diaQuery('v_clinic_inventory_latest_diff', '*', { filter: 'or(facility_name.ilike.' + like + ',city.ilike.' + like + ',state.ilike.' + like + ',operator_name.ilike.' + like + ',address.ilike.' + like + ')', limit: 100 }).catch(e => { console.warn('[DiaSearch] clinic inventory query failed:', e.message); return []; }),
      diaQuery('v_npi_inventory_signals', '*', { filter: 'or(facility_name.ilike.' + like + ',city.ilike.' + like + ',state.ilike.' + like + ',npi.ilike.' + like + ',operator_name.ilike.' + like + ')', limit: 50 }).catch(e => { console.warn('[DiaSearch] NPI signals query failed:', e.message); return []; }),
      diaQuery('v_clinic_property_link_review_queue', '*', { filter: 'or(facility_name.ilike.' + like + ',operator_name.ilike.' + like + ',state.ilike.' + like + ')', limit: 50 }).catch(e => { console.warn('[DiaSearch] property queue query failed:', e.message); return []; }),
      diaQuery('research_queue_outcomes', '*', { filter: 'or(queue_type.ilike.' + like + ',status.ilike.' + like + ',notes.ilike.' + like + ')', limit: 50 }).catch(e => { console.warn('[DiaSearch] outcomes query failed:', e.message); return []; })
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
    showToast('Search failed: ' + err.message, 'error');
  }

  diaSearching = false;
  if (searchBtn) { searchBtn.disabled = false; searchBtn.textContent = 'Search'; searchBtn.style.opacity = ''; }
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
      console.error('diaPatchRecord error [' + table + '.' + idCol + '=' + idVal + ']:', (result.errors || []).join(', '));
      showToast('Error saving ' + table + ': ' + ((result.errors || [])[0] || 'unknown error'), 'error');
      return false;
    }

    return true;
  } catch (err) {
    console.error('diaPatchRecord error [' + table + '.' + idCol + '=' + idVal + ']:', err);
    showToast('Error saving ' + table + ': ' + (err.message || 'unknown error'), 'error');
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
  if (overlay) { overlay.classList.add('open'); overlay.style.display = ''; }
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
  try {
    if (window._saleCurrentTab === 'deal') {
      html = renderSaleDealTab(record);
    } else if (window._saleCurrentTab === 'property') {
      html = renderSalePropertyTab(record);
    } else if (window._saleCurrentTab === 'ownership') {
      html = await renderSaleOwnershipTab(record);
    } else if (window._saleCurrentTab === 'research') {
      html = renderSaleResearchTab(record);
    }
  } catch (err) {
    console.error('renderSaleDetailBody error:', err);
    html = '<div style="padding:20px;color:var(--red);font-size:13px">Failed to load tab content.</div>';
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
  html += '<button onclick="_udBtnGuard(this, saveSaleTransaction)" style="width: 100%; padding: 10px; background: var(--accent); color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">Save Transaction</button>';
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
  html += '<button onclick="_udBtnGuard(this, saveSaleProperty)" style="width: 100%; padding: 10px; background: var(--accent); color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">Save Property</button>';
  html += '</div>';

  return html;
}

async function renderSaleOwnershipTab(record) {
  const lblStyle = 'display:block;color:var(--text2);font-size:12px;margin-bottom:6px;font-weight:600;';
  const inpStyle = 'width:100%;padding:8px;background:var(--s2);color:var(--text);border:1px solid var(--border);border-radius:4px;box-sizing:border-box;font-family:inherit;font-size:13px;';

  let html = '<div style="padding: 16px; overflow-y: auto; max-height: calc(100% - 60px);">';
  html += '<h3 style="color: var(--text); font-size: 14px; font-weight: 600; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.3px; color: var(--accent);">Ownership History</h3>';

  let owners = [];
  try {
    owners = await diaQuery('ownership_history', '*', {
      filter: `property_id=eq.${record.property_id}`,
      order: 'start_date.desc',
      limit: 50
    }) || [];
  } catch (e) {
    console.error('Ownership load error:', e);
    showToast('Failed to load ownership history', 'error');
  }

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

      html += '<button onclick="_udBtnGuard(this, saveSaleOwner, ' + owner.ownership_id + ', ' + idx + ')" style="width: 100%; padding: 8px; margin-top: 8px; background: var(--accent); color: white; border: none; border-radius: 4px; font-weight: 600; font-size: 12px; cursor: pointer;">Save Owner Record</button>';
      html += '</div>';
    });
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
  html += '<button onclick="_udBtnGuard(this, saveSaleResearch)" style="width: 100%; padding: 10px; background: var(--accent); color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">Resolve Research</button>';
  html += '</div>';

  return html;
}

async function saveSaleTransaction() {
  const record = window._saleRecord;
  if (!record || !record.sale_id) return;

  // Quick check: at least one field should have data
  const _anyField = ['#dia-buyer-name','#dia-seller-name','#dia-sold-price','#dia-cap-rate','#dia-sale-date','#dia-notes'].some(s => { const v = q(s)?.value?.trim(); return v && v !== ''; });
  if (!_anyField) { showToast('No changes to save', 'info'); return; }

  const buyer = q('#dia-buyer-name')?.value?.trim() || null;
  const buyerType = q('#dia-buyer-type')?.value?.trim() || null;
  const seller = q('#dia-seller-name')?.value?.trim() || null;
  const price = _pf(q('#dia-sold-price'));
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

  try {
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
      // Re-render detail panel to show updated values
      await renderSaleDetailBody(record);
    }
  } catch (err) {
    console.error('Sale transaction save error:', err);
    showToast('Error saving transaction: ' + (err.message || 'unknown error'), 'error');
  }
}

async function saveSaleProperty() {
  const record = window._saleRecord;
  if (!record || !record.property_id) return;

  const _anyField = ['#dia-prop-address','#dia-prop-city','#dia-prop-state','#dia-prop-tenant','#dia-prop-rba','#dia-prop-land','#dia-prop-year'].some(s => { const v = q(s)?.value?.trim(); return v && v !== ''; });
  if (!_anyField) { showToast('No changes to save', 'info'); return; }

  const address = q('#dia-prop-address')?.value?.trim() || null;
  const city = q('#dia-prop-city')?.value?.trim() || null;
  const state = q('#dia-prop-state')?.value?.trim() || null;
  const tenant = q('#dia-prop-tenant')?.value?.trim() || null;
  const rba = _pf(q('#dia-prop-rba'));
  const land = _pf(q('#dia-prop-land'));
  const year = _py(q('#dia-prop-year'));

  const data = {
    address: address || null,
    city: city || null,
    state: state || null,
    tenant: tenant || null,
    building_size: rba,
    land_area: land,
    year_built: year
  };

  try {
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
      // Re-render detail panel to show updated values
      await renderSaleDetailBody(record);
    }
  } catch (err) {
    console.error('Sale property save error:', err);
    showToast('Error saving property: ' + (err.message || 'unknown error'), 'error');
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

  if (!ownerType && !ownerSource && !notes) { showToast('No changes to save', 'info'); return; }

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
      const errorMsg = result.errors && result.errors.length > 0 ? result.errors[0] : 'unknown error';
      console.error('Research save error:', result.errors || []);
      showToast('Error saving research: ' + errorMsg, 'error');
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
    showToast('Error saving research: ' + (err.message || 'unknown error'), 'error');
  }
}

function closeSaleDetail() {
  // Check for unsaved changes
  const body = document.getElementById('detailBody');
  if (body) {
    const inputs = body.querySelectorAll('input, select, textarea');
    const hasDirty = Array.from(inputs).some(function(inp) {
      if (inp.tagName === 'SELECT') return false; // selects don't track defaultValue well
      return inp.value !== (inp.defaultValue || '');
    });
    if (hasDirty) {
      lccConfirm('You have unsaved changes. Close anyway?', 'Close').then(function(ok) {
        if (ok) _closeSaleDetailInner();
      });
      return;
    }
  }
  _closeSaleDetailInner();
}

function _closeSaleDetailInner() {
  window._saleRecord = null;
  window._saleCurrentTab = null;
  const overlay = q('#detailOverlay');
  const panel = q('#detailPanel');
  if (overlay) { overlay.classList.remove('open'); overlay.style.display = ''; }
  if (panel) panel.style.display = 'none';
  q('#detailHeader').innerHTML = '';
  q('#detailTabs').innerHTML = '';
  q('#detailBody').innerHTML = '';
}

/**
 * Property Resolution Component Handlers
 */
window.propResDoSearch = async function(sourceTable, sourceIdCol, sourceIdVal) {
  const query = document.getElementById('propResSearch')?.value?.trim();
  if (!query || query.length < 2) { showToast('Enter at least 2 characters', 'info'); return; }
  const resultsDiv = document.getElementById('propResResults');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '<div style="padding:4px;font-size:11px;color:var(--text2);">Searching...</div>';

  try {
    const safeQ = query.replace(/[*()',\\]/g, '');
    const props = await diaQuery('properties', 'property_id,address,city,state,property_name', {
      filter: `or(address.ilike.*${safeQ}*,property_name.ilike.*${safeQ}*)`,
      limit: 10
    });
    if (!props || props.length === 0) {
      resultsDiv.innerHTML = '<div style="padding:4px;font-size:11px;color:var(--text2);">No properties found</div>';
      return;
    }
    resultsDiv.innerHTML = props.map(p =>
      `<div onclick="propResLink('${sourceTable}','${sourceIdCol}',${sourceIdVal},${p.property_id})" style="padding:6px 8px;font-size:11px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;justify-content:space-between;" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
        <span>${esc(p.address || p.property_name || 'Unknown')}</span>
        <span style="color:var(--text2);">${esc((p.city || '') + (p.state ? ', ' + p.state : ''))}</span>
      </div>`
    ).join('');
  } catch (e) {
    resultsDiv.innerHTML = '<div style="padding:4px;font-size:11px;color:var(--error);">Search failed</div>';
  }
};

window.propResLink = async function(sourceTable, sourceIdCol, sourceIdVal, propertyId) {
  if (!(await lccConfirm('Link this record to Property #' + propertyId + '?', 'Link'))) return;
  const ok = await diaPatchRecord(sourceTable, sourceIdCol, sourceIdVal, { property_id: propertyId });
  if (ok) {
    showToast('Property linked successfully!', 'success');
    renderDiaTab();
  }
};

window.propResShowCreate = function(sourceTable, sourceIdCol, sourceIdVal) {
  const form = document.getElementById('propResCreateForm');
  if (!form) return;
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  form.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
      <input type="text" id="propNewAddr" placeholder="Address *" style="padding:5px 8px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
      <input type="text" id="propNewName" placeholder="Property Name" style="padding:5px 8px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
      <input type="text" id="propNewCity" placeholder="City *" style="padding:5px 8px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
      <input type="text" id="propNewState" placeholder="State *" style="padding:5px 8px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
    </div>
    <button onclick="propResCreate('${sourceTable}','${sourceIdCol}',${sourceIdVal})" style="padding:5px 12px;font-size:11px;background:var(--success);color:#fff;border:none;border-radius:4px;cursor:pointer;">Create & Link</button>
  `;
};

window.propResCreate = async function(sourceTable, sourceIdCol, sourceIdVal) {
  const addr = document.getElementById('propNewAddr')?.value?.trim();
  const city = document.getElementById('propNewCity')?.value?.trim();
  const state = document.getElementById('propNewState')?.value?.trim();
  const name = document.getElementById('propNewName')?.value?.trim();
  if (!addr || !city || !state) { showToast('Address, city, and state are required', 'error'); return; }

  const btn = event.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

  try {
    const result = await applyInsertWithFallback({
      proxyBase: '/api/dia-query',
      table: 'properties',
      data: { address: addr, city: city, state: state, property_name: name || addr },
      source_surface: 'dia_research_prop_create'
    });
    if (result && result.ok && result.data && result.data[0]) {
      const newId = result.data[0].property_id;
      const linkOk = await diaPatchRecord(sourceTable, sourceIdCol, sourceIdVal, { property_id: newId });
      if (linkOk) {
        showToast('Property created (#' + newId + ') and linked!', 'success');
        renderDiaTab();
      }
    } else {
      showToast('Failed to create property', 'error');
    }
  } catch (e) {
    showToast('Error creating property: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create & Link'; }
  }
};

window.renderDiaChanges = renderDiaChanges;
window.renderDiaNpi = renderDiaNpi;
window.renderDiaResearch = renderDiaResearch;
window.renderDiaActivity = renderDiaActivity;
window.renderDiaDetailBody = renderDiaDetailBody;
window.saveDiaDetailResearch = saveDiaDetailResearch;
window.renderDiaSearch = renderDiaSearch;
window.execDiaSearch = execDiaSearch;
window._diaSearchExpanded = _diaSearchExpanded;
window.renderDiaProperties = renderDiaProperties;
window.renderDiaSales = renderDiaSales;
window.renderDiaPlayers = renderDiaPlayers;
window.renderDiaLeases = renderDiaLeases;
window.renderDiaLoans = renderDiaLoans;
window.goToDiaTab = goToDiaTab;
window.infoCard = infoCard;
window.showSaleDetail = showSaleDetail;
window.openDiaSaleOrProperty = function(record) {
  // If the sale comp has a property_id, open the full property sidebar
  if (record && record.property_id) {
    openUnifiedDetail('dialysis', { property_id: record.property_id }, record, 'sales');
  } else {
    // Fallback to the dedicated sale detail form
    showSaleDetail(record);
  }
};
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

  const _saveBtn = document.querySelector('[onclick*="saveDiaOwnershipResolution"]');
  if (_saveBtn) { _saveBtn.disabled = true; _saveBtn.textContent = 'Saving\u2026'; _saveBtn.style.opacity = '0.6'; }

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
        showToast('Ownership outcome log failed — resolution may be incomplete', 'error');
        if (_saveBtn) { _saveBtn.disabled = false; _saveBtn.textContent = 'Save Ownership'; _saveBtn.style.opacity = ''; }
        return;
      }
    } catch (e) {
      console.error('Ownership resolution POST error:', e);
      showToast('Save error: ' + e.message, 'error');
      if (_saveBtn) { _saveBtn.disabled = false; _saveBtn.textContent = 'Save Ownership'; _saveBtn.style.opacity = ''; }
      return;
    }
  }

  if (_saveBtn) { _saveBtn.disabled = false; _saveBtn.textContent = 'Save Ownership'; _saveBtn.style.opacity = ''; }
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
