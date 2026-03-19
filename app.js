// ============================================================
// CONFIG & STATE
// ============================================================
const API = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot';

// ============================================================
// USER CONTEXT — Phase 1: Multi-user support
// ============================================================
const LCC_USER = {
  id: null,
  email: null,
  display_name: null,
  avatar_url: null,
  first_name: null,
  workspace_id: null,
  workspace_name: null,
  role: null,
  memberships: [],
  _loaded: false
};

// ============================================================
// FEATURE FLAGS — loaded from /api/flags, gates rollout features
// ============================================================
const LCC_FLAGS = {
  strict_auth: false,
  queue_v2_enabled: false,
  queue_v2_auto_fallback: true,
  auto_sync_on_load: false,
  sync_outlook_enabled: true,
  sync_salesforce_enabled: true,
  sync_outbound_enabled: false,
  team_queue_enabled: false,
  escalations_enabled: false,
  bulk_operations_enabled: false,
  domain_templates_enabled: false,
  domain_sync_enabled: false,
  ops_pages_enabled: false,
  more_drawer_enabled: false,
  freshness_indicators: true,
  _loaded: false
};

/** Check if a feature flag is enabled */
function checkFlag(flagName) {
  return LCC_FLAGS[flagName] === true;
}

/** Load feature flags from the server */
async function loadFeatureFlags() {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    const res = await fetch('/api/flags', { headers });
    if (res.ok) {
      const data = await res.json();
      const flags = data.flags || {};
      for (const [key, val] of Object.entries(flags)) {
        if (key in LCC_FLAGS) LCC_FLAGS[key] = val;
      }
      LCC_FLAGS._loaded = true;
    }
  } catch {
    // Flags stay at defaults — safe for rollout (most features off)
  }
}

/** Load user context from /api/members?action=me (or fall back to defaults) */
async function loadUserContext() {
  try {
    const res = await fetch('/api/members?action=me');
    if (res.ok) {
      const data = await res.json();
      // Skip transitional default user — prefer localStorage defaults
      if (data.user.id !== 'default-dev-user') {
        LCC_USER.id = data.user.id;
        LCC_USER.email = data.user.email;
        LCC_USER.display_name = data.user.display_name;
        LCC_USER.avatar_url = data.user.avatar_url;
        LCC_USER.first_name = data.user.display_name?.split(' ')[0] || 'there';
        LCC_USER.workspace_id = data.workspace_id;
        LCC_USER.workspace_name = data.memberships?.[0]?.workspace_name;
        LCC_USER.role = data.role;
        LCC_USER.memberships = data.memberships || [];
        LCC_USER._loaded = true;
      }
    }
  } catch (e) {
    // Silently fall back to defaults — ops DB may not be configured yet
  }
  // Apply defaults if not loaded from server
  if (!LCC_USER._loaded) {
    LCC_USER.display_name = localStorage.getItem('lcc-user-name') || 'Scott Briggs';
    LCC_USER.first_name = LCC_USER.display_name.split(' ')[0];
    LCC_USER.role = 'owner';
    LCC_USER._loaded = true;
  }
  applyUserContext();
}

/** Update all UI elements that reference the current user */
function applyUserContext() {
  const name = LCC_USER.display_name || 'User';
  const first = LCC_USER.first_name || name.split(' ')[0];

  // Header user name
  const userEl = document.getElementById('appUserName');
  if (userEl) userEl.textContent = name;

  // Greeting
  const greetEl = document.getElementById('greeting');
  if (greetEl) greetEl.textContent = getGreeting();

  // Settings page user display
  const settingsUser = document.getElementById('settingsUserName');
  if (settingsUser) settingsUser.textContent = name;

  // Copilot welcome
  const copilotWelcome = document.querySelector('.copilot-msg.bot');
  if (copilotWelcome && copilotWelcome.dataset.initialized !== 'true') {
    copilotWelcome.dataset.initialized = 'true';
    // Keep existing content but with correct name
  }
}

/** Apply feature flags to UI — show/hide gated features */
function applyFeatureFlags() {
  // Ops pages: My Work, Queue, Inbox nav items
  document.querySelectorAll('[data-flag]').forEach(el => {
    const flag = el.dataset.flag;
    el.style.display = checkFlag(flag) ? '' : 'none';
  });

  // More drawer: use 5+More layout or legacy full nav
  const moreBtn = document.querySelector('.bnav[data-page="more"]');
  if (moreBtn) moreBtn.style.display = checkFlag('more_drawer_enabled') ? '' : 'none';

  // Queue v2 preference
  if (typeof useV2 !== 'undefined') {
    useV2 = checkFlag('queue_v2_enabled');
  }
}

// Weather — uses geolocation with Tulsa fallback
const WEATHER_FALLBACK_LAT = 36.15;
const WEATHER_FALLBACK_LON = -95.99;
const WEATHER_FALLBACK_CITY = 'Tulsa, OK';
function buildWeatherUrl(lat, lon) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`;
}
const TREASURY_API_URL = '/api/treasury';
const GOV_SUPABASE_URL = 'https://scknotsqkcheojiaewwh.supabase.co';
const PAGE_SIZE = 40;

// State
let activities = [];
let emails = [];
let emailTotalCount = 0;
let calEvents = [];
let currentBizTab = 'dialysis';
let bizSearch = '';
let bizPage = 0;

// Canonical model state — populated from ops DB when available
let canonicalCounts = null;     // work_counts from queue-v2 API
let canonicalMyWork = null;     // top items from my_work queue
let canonicalInbox = null;      // recent inbox items (email source)
let canonicalLoaded = false;    // true once canonical load attempted
let logCallData = {};
let govConnected = false;
let diaConnected = false;
let currentGovTab = 'overview';
let currentDiaTab = 'overview';
let diaData = {
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
let diaDataLoaded = false;
let govDataLoaded = false;
let govData = {
  properties: [],
  salesComps: [],
  leads: [],
  contacts: [],
  listings: [],
  ownership: [],
  gsaEvents: [],
  gsaSnapshots: [],
  frppRecords: [],
  countyAuth: [],
  loans: []
};

// SOS URLs for all 50 states
const SOS_URLS = {
  AL:"https://www.sos.alabama.gov/government-records/business-entity-records",
  AK:"https://www.commerce.alaska.gov/cbp/main/search/entities",
  AZ:"https://ecorp.azcc.gov/EntitySearch/Index",
  AR:"https://www.sos.arkansas.gov/corps/search_all.php",
  CA:"https://bizfileonline.sos.ca.gov/search/business",
  CO:"https://www.sos.state.co.us/biz/BusinessEntityCriteriaExt.do",
  CT:"https://service.ct.gov/business/s/onlinebusinesssearch",
  DE:"https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx",
  DC:"https://corponline.dcra.dc.gov/Home.aspx",
  FL:"https://search.sunbiz.org/Inquiry/CorporationSearch/ByName",
  GA:"https://ecorp.sos.ga.gov/BusinessSearch",
  HI:"https://hbe.ehawaii.gov/documents/search.html",
  ID:"https://sosbiz.idaho.gov/search/business",
  IL:"https://www.ilsos.gov/corporatellc/CorporateLlcController",
  IN:"https://bsd.sos.in.gov/PublicBusinessSearch",
  IA:"https://sos.iowa.gov/search/business/(S(default))/search.aspx",
  KS:"https://www.kansas.gov/bess/flow/main?execution=e1s1",
  KY:"https://web.sos.ky.gov/bussearchnprofile/(S(default))/search.aspx",
  LA:"https://coraweb.sos.la.gov/CommercialSearch/CommercialSearch.aspx",
  ME:"https://icrs.informe.org/nei-sos-icrs/ICRS?MainPage=x",
  MD:"https://egov.maryland.gov/BusinessExpress/EntitySearch",
  MA:"https://corp.sec.state.ma.us/corpweb/CorpSearch/CorpSearch.aspx",
  MI:"https://cofs.lara.state.mi.us/CorpWeb/CorpSearch/CorpSearch.aspx",
  MN:"https://mblsportal.sos.state.mn.us/Business/Search",
  MS:"https://corp.sos.ms.gov/corp/portal/c/page/corpBusinessIdSearch/portal.aspx",
  MO:"https://bsd.sos.mo.gov/BusinessEntity/BESearch.aspx",
  MT:"https://biz.sosmt.gov/search",
  NE:"https://www.nebraska.gov/sos/corp/corpsearch.cgi",
  NV:"https://esos.nv.gov/EntitySearch/OnlineEntitySearch",
  NH:"https://quickstart.sos.nh.gov/online/BusinessInquire",
  NJ:"https://www.njportal.com/DOR/BusinessNameSearch",
  NM:"https://portal.sos.state.nm.us/BFS/online/CorporationBusinessSearch",
  NY:"https://appext20.dos.ny.gov/corp_public/CORPSEARCH.ENTITY_SEARCH_ENTRY",
  NC:"https://www.sosnc.gov/online_services/search/by_title/_Business_Registration",
  ND:"https://firststop.sos.nd.gov/search/business",
  OH:"https://businesssearch.ohiosos.gov/",
  OK:"https://www.sos.ok.gov/corp/corpInquiryFind.aspx",
  OR:"https://sos.oregon.gov/business/pages/find.aspx",
  PA:"https://www.corporations.pa.gov/search/corpsearch",
  RI:"http://business.sos.ri.gov/CorpWeb/CorpSearch/CorpSearch.aspx",
  SC:"https://businessfilings.sc.gov/BusinessFiling/Entity/Search",
  SD:"https://sosenterprise.sd.gov/BusinessServices/Business/FilingSearch.aspx",
  TN:"https://tnbear.tn.gov/Ecommerce/FilingSearch.aspx",
  TX:"https://mycpa.cpa.state.tx.us/coa/",
  UT:"https://secure.utah.gov/bes/index.html",
  VT:"https://bizfilings.vermont.gov/online/BusinessInquire",
  VA:"https://cis.scc.virginia.gov/EntitySearch/Index",
  WA:"https://ccfs.sos.wa.gov/#/",
  WV:"https://apps.wv.gov/SOS/BusinessEntity/",
  WI:"https://www.wdfi.org/apps/CorpSearch/Search.aspx",
  WY:"https://wyobiz.wyo.gov/Business/FilingSearch.aspx",
};

// ============================================================
// HELPERS
// ============================================================
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
// Safe JSON for embedding in HTML onclick attributes — escapes <, >, &, ', "
function safeJSON(obj) { return JSON.stringify(obj).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }

// Display normalization — title case, clean formatting for consistent display
function norm(s) {
  if (!s) return '';
  s = String(s).trim();
  // Already mixed case (e.g., "DaVita") — leave as-is if has mix of upper/lower
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  // Title case: "BOYD WATTERSON GLOBAL" → "Boyd Watterson Global"
  return s.toLowerCase().replace(/(?:^|\s|[-\/\(])\S/g, c => c.toUpperCase());
}

// Clean up raw DB labels for display
const labelMap = {
  'gsa_new_award': 'GSA New Award', 'email_om': 'Email – Offering Memo',
  'email_listing': 'Email – Listing', 'manual': 'Manual Entry',
  'missing_inventory_npi': 'Missing from Inventory', 'new_npi': 'New NPI',
  'closed_facility': 'Closed Facility', 'patient_swing': 'Patient Swing',
  'new': 'New', 'queued': 'Queued', 'in_progress': 'In Progress',
  'pending': 'Pending', 'verified': 'Verified', 'matched': 'Matched',
  'filtered_multi_tenant': 'Multi-Tenant', 'active': 'Active',
  'under_contract': 'Under Contract', 'added': 'Added', 'removed': 'Removed',
  'persistent': 'Persistent'
};
function cleanLabel(s) { return labelMap[s] || norm(s); }

function q(selector) { return document.querySelector(selector); }

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d); if (isNaN(date)) return d;
  const now = new Date(); const diff = Math.floor((now - date) / 86400000);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Yesterday'; if (diff === -1) return 'Tomorrow';
  if (diff < 0) return `In ${Math.abs(diff)}d`;
  if (diff < 7) return `${diff}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const TZ = 'America/Chicago';
// Calendar events from edge function have +00:00 but are actually Central Time
// Strip the false UTC offset so JS treats them as local (Central) time
function stripTZ(d) { return String(d).replace(/[Zz]$/,'').replace(/[+-]\d{2}:\d{2}$/,''); }
function tzHour(d) { return new Date(stripTZ(d)).getHours(); }
function tzMin(d) { return new Date(stripTZ(d)).getMinutes(); }
function tzHourMin(d) { return tzHour(d)*60+tzMin(d); }
function tzDateStr(d) { return new Date(stripTZ(d)).toLocaleDateString('en-US'); }
function formatTime(d) {
  if (!d) return ''; const date = new Date(stripTZ(d)); if (isNaN(date)) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmt(n) {
  if (n == null) return "—";
  if (n >= 1e9) return "$" + (n/1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + (n/1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n/1e3).toFixed(0) + "K";
  return "$" + Math.round(n);
}
function fmtN(n) { return n != null ? n.toLocaleString() : "—"; }
function pct(n) { return n != null ? (n*100).toFixed(1)+"%" : "—"; }

function catClass(cat) {
  if (!cat) return 'cat-gen'; const c = cat.toLowerCase();
  if (c.includes('government')) return 'cat-gov';
  if (c.includes('dialysis')) return 'cat-dia';
  if (c.includes('medical') || c.includes('healthcare')) return 'cat-med';
  if (c.includes('developer')) return 'cat-dev';
  if (c.includes('tenant')) return 'cat-ten';
  if (c.includes('call')) return 'cat-call';
  if (c.includes('follow')) return 'cat-follow';
  if (c.includes('net lease') || c.includes('portfolio')) return 'cat-nl';
  if (c.includes('priority')) return 'cat-pri';
  return 'cat-gen';
}

function dotClass(status) {
  const m = {live:"gov-dot green",dead:"gov-dot red",redirect:"gov-dot amber",hot:"gov-dot red",warm:"gov-dot amber",cold:"gov-dot blue",
    matched:"gov-dot green",pending:"gov-dot amber",verified:"gov-dot cyan",active:"gov-dot green",under_contract:"gov-dot amber",
    new:"gov-dot blue",queued:"gov-dot blue",in_progress:"gov-dot amber"};
  return m[status]||"gov-dot dim";
}

// Programmatic page navigation — supports both bottom nav and more drawer items
function navTo(pageId) {
  // Try bottom nav button first
  const btn = document.querySelector(`.bnav[data-page="${pageId}"]`);
  if (btn) { btn.click(); return; }
  // Fall back to more drawer navigation
  navToFromMore(pageId);
}

function navToFromMore(pageId) {
  // Close more drawer
  document.getElementById('moreDrawerOverlay').classList.remove('open');
  document.getElementById('moreDrawer').classList.remove('open');
  // Deactivate all nav buttons
  document.querySelectorAll('.bnav').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.more-drawer-item').forEach(i => i.classList.remove('active'));
  // Activate the more drawer item
  const moreItem = document.querySelector(`.more-drawer-item[data-page="${pageId}"]`);
  if (moreItem) moreItem.classList.add('active');
  // Show the page
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  // Hide biz sub-tabs unless on biz page
  document.getElementById('bizSubTabs').style.display = pageId === 'pageBiz' ? 'flex' : 'none';
  document.getElementById('govInnerTabs').style.display = 'none';
  document.getElementById('diaInnerTabs').style.display = 'none';
  // Trigger page-specific loading
  handlePageLoad(pageId);
}

function toggleMoreDrawer() {
  document.getElementById('moreDrawerOverlay').classList.toggle('open');
  document.getElementById('moreDrawer').classList.toggle('open');
}

// Centralized page load handler — fires ops.js renderers for canonical model pages
function handlePageLoad(pageId) {
  switch(pageId) {
    case 'pageMyWork': if (typeof renderMyWork === 'function') renderMyWork(); break;
    case 'pageTeamQueue':
      if (!checkFlag('team_queue_enabled')) {
        const el = document.getElementById('teamQueueContent');
        if (el) el.innerHTML = '<div class="ops-empty">Team Queue is not yet enabled for this workspace.</div>';
        break;
      }
      if (typeof renderTeamQueue === 'function') renderTeamQueue(); break;
    case 'pageInbox': if (typeof renderInboxTriage === 'function') renderInboxTriage(); break;
    case 'pageEntities': if (typeof renderEntitiesPage === 'function') renderEntitiesPage(); break;
    case 'pageResearch': if (typeof renderResearchPage === 'function') renderResearchPage(); break;
    case 'pageMetrics': if (typeof renderMetricsPage === 'function') renderMetricsPage(); break;
    case 'pageSyncHealth': if (typeof renderSyncHealthPage === 'function') renderSyncHealthPage(); break;
    case 'pageCal': renderCalendarFull(); break;
    case 'pageBiz':
      if (currentBizTab === 'government') {
        document.getElementById('govInnerTabs').style.display = 'flex';
        if (govConnected && !govDataLoaded) loadGovData();
        else renderBizContent();
      } else if (currentBizTab === 'dialysis') {
        document.getElementById('diaInnerTabs').style.display = 'flex';
        if (diaConnected && !diaDataLoaded) loadDiaData();
        else renderBizContent();
      } else {
        renderBizContent();
      }
      break;
    case 'pageMessages': loadMessages(); break;
    case 'pageSettings': renderSettings(); break;
  }
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  setTimeout(() => t.className = 'toast', 3000);
}

function getGreeting() {
  const h = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Chicago' }));
  const name = LCC_USER.first_name || LCC_USER.display_name?.split(' ')[0] || 'there';
  if (h < 12) return `Good morning, ${name}`;
  if (h < 17) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

// ============================================================
// GOVERNMENT DASHBOARD (loaded from gov.js)
// ============================================================
// All government-specific functions are in gov.js

// (Government functions are in gov.js - loaded below)

// GOVERNMENT FUNCTIONS BELOW ARE IN gov.js
// Placeholder functions (overridden by gov.js)
function metricHTML(l,v,s,c){return '';}
function govQuery(t,s,p){return {data:[],count:0};}
function loadGovData(){renderGovTab();}
function renderGovOverview(){return '<div style="color:var(--text2)">Loading gov.js...</div>';}
function renderGovOwnership(){return renderGovOverview();}
function renderGovPipeline(){return renderGovOverview();}
function renderGovListings(){return renderGovOverview();}
function renderGovResearch(){return renderGovOverview();}
function renderGovSearch(){return '<div style="color:var(--text2)">Loading gov search...</div>';}
function renderGovSales(){return '<div style="color:var(--text2)">Loading gov sales...</div>';}
function renderGovPlayers(){return '<div style="color:var(--text2)">Loading gov players...</div>';}
function renderGovLeases(){return '<div style="color:var(--text2)">Loading gov leases...</div>';}
function renderGovLoans(){return '<div style="color:var(--text2)">Loading gov loans...</div>';}
function renderDiaSearch(){return '<div style="color:var(--text2)">Loading dia search...</div>';}
function renderDiaSales(){return '<div style="color:var(--text2)">Loading dia sales...</div>';}
function renderDiaPlayers(){return '<div style="color:var(--text2)">Loading dia players...</div>';}
function renderDiaLeases(){return '<div style="color:var(--text2)">Loading dia leases...</div>';}
function renderDiaLoans(){return '<div style="color:var(--text2)">Loading dia loans...</div>';}
// renderProspects — defined below in PROSPECTS section
function renderGovTab(){
  const el=document.getElementById('bizPageInner');
  if(!el)return;
  let h='';
  switch(currentGovTab){
    case 'overview':h=renderGovOverview();break;
    case 'search':h=renderGovSearch();break;
    case 'ownership':h=renderGovOwnership();break;
    case 'pipeline':h=renderGovPipeline();break;
    case 'listings':h=renderGovListings();break;
    case 'sales':h=renderGovSales();break;
    case 'leases':h=renderGovLeases();break;
    case 'loans':h=renderGovLoans();break;
    case 'players':h=renderGovPlayers();break;
    case 'research':h=renderGovResearch();break;
  }
  el.innerHTML=h;
}
// ============================================================
// DIALYSIS DASHBOARD (loaded from dialysis.js)
// ============================================================
// Placeholder functions (overridden by dialysis.js)
function diaQuery(t,s,p){return {data:[],count:0};}
function loadDiaData(){renderDiaTab();}
function renderDiaOverview(){return '<div style="color:var(--text2)">Loading dialysis.js...</div>';}
function renderDiaChanges(){return renderDiaOverview();}
function renderDiaNpi(){return renderDiaOverview();}
function renderDiaResearch(){return renderDiaOverview();}

// Placeholder functions for detail panel body renderers (overridden by gov.js and dialysis.js)
function renderGovDetailBody(record, source, tab) { return '<div class="detail-empty">Government detail not loaded</div>'; }
function renderDiaDetailBody(record, tab) { return '<div class="detail-empty">Dialysis detail not loaded</div>'; }
function renderDiaTab(){
  const el=document.getElementById('bizPageInner');
  if(!el)return;
  let h='';
  switch(currentDiaTab){
    case 'overview':h=renderDiaOverview();break;
    case 'search':h=renderDiaSearch();break;
    case 'changes':h=renderDiaChanges();break;
    case 'npi':h=renderDiaNpi();break;
    case 'sales':h=renderDiaSales();break;
    case 'leases':h=renderDiaLeases();break;
    case 'loans':h=renderDiaLoans();break;
    case 'players':h=renderDiaPlayers();break;
    case 'research':h=renderDiaResearch();break;
    case 'activity':renderBizContent();return;
  }
  el.innerHTML=h;
}

// ============================================================
// NAV & BIZ TAB HANDLING
// ============================================================
document.querySelectorAll('.bnav[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bnav').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.more-drawer-item').forEach(i => i.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(btn.dataset.page);
    if (page) page.classList.add('active');
    // Hide all secondary tab bars unless on Biz page
    document.getElementById('bizSubTabs').style.display = btn.dataset.page === 'pageBiz' ? 'flex' : 'none';
    document.getElementById('govInnerTabs').style.display = 'none';
    document.getElementById('diaInnerTabs').style.display = 'none';
    handlePageLoad(btn.dataset.page);
  });
});

document.getElementById('bizSubTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.sub-tab');
  if (!tab) return;
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  currentBizTab = tab.dataset.biz;
  bizPage = 0;
  bizSearch = '';
  
  document.getElementById('govInnerTabs').style.display = currentBizTab === 'government' ? 'flex' : 'none';
  document.getElementById('diaInnerTabs').style.display = currentBizTab === 'dialysis' ? 'flex' : 'none';

  if (currentBizTab === 'marketing') {
    document.getElementById('govInnerTabs').style.display = 'none';
    document.getElementById('diaInnerTabs').style.display = 'none';
    loadMarketing();
  } else if (currentBizTab === 'prospects') {
    const el = document.getElementById('bizPageInner');
    if (el) el.innerHTML = renderProspects();
    setTimeout(() => { if (typeof initProspectsSearch === 'function') initProspectsSearch(); }, 0);
  } else if (currentBizTab === 'government') {
    if (!govConnected) showGovConnectionForm();
    else {
      currentGovTab = 'overview';
      document.querySelectorAll('#govInnerTabs .gov-inner-tab').forEach(t => t.classList.remove('active'));
      q('[data-gov-tab="overview"]').classList.add('active');
      if (typeof govDataLoaded !== 'undefined' && govDataLoaded) {
        renderGovTab();
      } else {
        loadGovData();
      }
    }
  } else if (currentBizTab === 'dialysis') {
    if (!diaConnected) {
      currentDiaTab = 'activity';
      document.querySelectorAll('#diaInnerTabs .gov-inner-tab').forEach(t => t.classList.remove('active'));
      q('[data-dia-tab="activity"]').classList.add('active');
      renderBizContent();
    } else {
      currentDiaTab = 'overview';
      document.querySelectorAll('#diaInnerTabs .gov-inner-tab').forEach(t => t.classList.remove('active'));
      q('[data-dia-tab="overview"]').classList.add('active');
      if (typeof diaDataLoaded !== 'undefined' && diaDataLoaded) {
        renderDiaTab();
      } else {
        loadDiaData();
      }
    }
  } else if (currentBizTab === 'other') {
    // All Other tab — show domain prospects if loaded, else activity stream
    if (_mktOpportunitiesLoaded && window._mktOpportunities.all_other.length > 0) {
      renderDomainProspects('all_other');
    } else {
      renderBizContent();
    }
  } else {
    renderBizContent();
  }
});

document.getElementById('govInnerTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.gov-inner-tab');
  if (!tab) return;
  document.querySelectorAll('#govInnerTabs .gov-inner-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  currentGovTab = tab.dataset.govTab;
  renderGovTab();
});

document.getElementById('diaInnerTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.gov-inner-tab');
  if (!tab) return;
  document.querySelectorAll('#diaInnerTabs .gov-inner-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  currentDiaTab = tab.dataset.diaTab;
  if (currentDiaTab === 'activity') {
    renderBizContent();
  } else if (currentDiaTab === 'prospects') {
    // Prospects tab uses marketing data, not dia data
    if (_mktOpportunitiesLoaded) {
      renderDomainProspects('dialysis');
    } else if (typeof loadMarketing === 'function') {
      loadMarketing().then(() => renderDomainProspects('dialysis'));
    }
  } else if (typeof diaDataLoaded !== 'undefined' && diaDataLoaded) {
    renderDiaTab();
  } else {
    // Data not loaded yet — trigger load, tab will render after
    if (typeof loadDiaData === 'function') loadDiaData();
  }
});

// Auto-resolve credentials from Vercel env vars
async function autoConnectCredentials() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) { console.warn('Config endpoint returned', res.status); return; }
    const cfg = await res.json();
    console.log('Auto-connect config:', cfg);
    // Keys stay server-side in proxy endpoints — we just track connection status
    if (cfg.gov && cfg.gov.connected) {
      govConnected = true;
    }
    if (cfg.dia && cfg.dia.connected) {
      diaConnected = true;
    }
    console.log('Auto-connect result:', { govConnected, diaConnected });
  } catch(e) {
    console.log('Auto-connect: config endpoint unavailable', e);
  }
}

function showGovConnectionForm() {
  const pageInner = q('#bizPageInner');
  let html = '<div class="gov-connection-form">';
  html += '<h3>Government Database</h3>';
  html += '<p>The Government database key is not configured on the server. Set <code>GOV_SUPABASE_KEY</code> in Vercel environment variables.</p>';
  html += '<div class="gov-action-buttons">';
  html += '<button class="gov-btn" onclick="govConnected=true;loadGovData()">Retry</button>';
  html += '<button class="gov-btn secondary" onclick="renderBizContent()">Cancel</button>';
  html += '</div>';
  html += '</div>';
  pageInner.innerHTML = html;
}

function showDiaConnectionForm() {
  const pageInner = q('#bizPageInner');
  let html = '<div class="gov-connection-form">';
  html += '<h3>Dialysis Database</h3>';
  html += '<p>The Dialysis database key is not configured on the server. Set <code>DIA_SUPABASE_KEY</code> in Vercel environment variables.</p>';
  html += '<div class="gov-action-buttons">';
  html += '<button class="gov-btn" onclick="diaConnected=true;loadDiaData()">Retry</button>';
  html += '<button class="gov-btn secondary" onclick="renderBizContent()">Cancel</button>';
  html += '</div>';
  html += '</div>';
  pageInner.innerHTML = html;
}

function connectGovDatabase() {
  govConnected = true;
  currentGovTab = 'overview';
  loadGovData();
}

function connectDiaDatabase() {
  diaConnected = true;
  currentDiaTab = 'overview';
  loadDiaData();
}

// ============================================================
// BUSINESS PAGE (DIALYSIS / OTHER)
// ============================================================
function filterBizActivities() {
  return activities.filter(a => {
    const c = (a.computed_category || '').toLowerCase();
    if (currentBizTab === 'dialysis') return c.includes('dialysis') || c.includes('medical') || c.includes('healthcare');
    if (currentBizTab === 'government') return false;
    return !c.includes('dialysis') && !c.includes('medical') && !c.includes('healthcare') && !c.includes('government');
  }).filter(a => {
    if (!bizSearch) return true;
    const s = bizSearch.toLowerCase();
    return [a.subject, a.company_name, a.contact_name, a.company_city_state, a.nm_notes].filter(Boolean).join(' ').toLowerCase().includes(s);
  });
}

function updateBizBadges() {
  let dia = 0, gov = 0, mkt = 0, other = 0;
  for (const a of activities) {
    const c = (a.computed_category || '').toLowerCase();
    const t = (a.activity_type || '').toLowerCase();
    if (c.includes('dialysis') || c.includes('medical') || c.includes('healthcare') || c.includes('davita') || c.includes('fmc') || c.includes('fresenius')) dia++;
    else if (c.includes('government') || c.includes('gsa') || c.includes('va ') || c.includes('federal')) gov++;
    else if (c.includes('marketing') || c.includes('prospect') || t.includes('marketing')) mkt++;
    else other++;
  }
  const el = id => document.getElementById(id);
  if (el('bizBadgeDia')) el('bizBadgeDia').textContent = dia || '—';
  if (el('bizBadgeGov')) el('bizBadgeGov').textContent = gov || '—';
  // Only set marketing badge if marketing data hasn't loaded yet (it has its own count)
  if (el('bizBadgeMkt') && !mktLoaded) el('bizBadgeMkt').textContent = mkt || '—';
  if (el('bizBadgeOther')) el('bizBadgeOther').textContent = other || '—';
}

function renderBizContent() {
  console.log('renderBizContent:', { currentBizTab, currentDiaTab, govConnected, govDataLoaded, diaConnected, diaDataLoaded });
  // If marketing tab, load deal tasks
  if (currentBizTab === 'marketing') {
    loadMarketing();
    return;
  }
  // If prospects tab, render cross-project view
  if (currentBizTab === 'prospects') {
    const el = document.getElementById('bizPageInner');
    if (el) el.innerHTML = renderProspects();
    setTimeout(() => { if (typeof initProspectsSearch === 'function') initProspectsSearch(); }, 0);
    return;
  }
  // If "other" tab and prospects loaded, show domain prospects
  if (currentBizTab === 'other' && _mktOpportunitiesLoaded && window._mktOpportunities.all_other.length > 0) {
    renderDomainProspects('all_other');
    return;
  }
  // If government tab, route to gov.js
  if (currentBizTab === 'government') {
    if (!govConnected) { console.log('→ showGovConnectionForm'); showGovConnectionForm(); return; }
    if (!govDataLoaded) { console.log('→ loadGovData from renderBiz'); loadGovData(); return; }
    console.log('→ renderGovTab'); renderGovTab();
    return;
  }
  // If dialysis tab with a data inner tab, route to dialysis.js
  if (currentBizTab === 'dialysis' && currentDiaTab !== 'activity') {
    if (!diaConnected) { console.log('→ showDiaConnectionForm'); showDiaConnectionForm(); return; }
    if (!diaDataLoaded) { console.log('→ loadDiaData from renderBiz'); loadDiaData(); return; }
    console.log('→ renderDiaTab'); renderDiaTab();
    return;
  }
  // Ensure bizContent container exists (may have been replaced by Marketing/Prospects)
  if (!document.getElementById('bizContent')) {
    const outer = document.getElementById('bizPageInner');
    if (outer) outer.innerHTML = '<div id="bizContent"><div class="loading"><span class="spinner"></span></div></div>';
  }
  const filtered = filterBizActivities();
  const start = bizPage * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const subCats = {};
  filtered.forEach(a => { const c = a.computed_category || 'General'; subCats[c] = (subCats[c] || 0) + 1; });

  let html = '';
  html += `<div class="widget-grid"><div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${filtered.length.toLocaleString()}</div></div>`;
  const catEntries = Object.entries(subCats).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [cat, ct] of catEntries) {
    html += `<div class="stat-card"><div class="stat-label">${esc(cat)}</div><div class="stat-value">${ct}</div></div>`;
  }
  html += '</div>';

  if (Object.keys(subCats).length > 1) {
    html += '<div class="pills">';
    for (const [cat, ct] of Object.entries(subCats).sort((a, b) => b[1] - a[1])) {
      html += `<span class="pill" onclick="toggleBizCatFilter(this,'${esc(cat)}')">${esc(cat)}<span class="pill-ct">${ct}</span></span>`;
    }
    html += '</div>';
  }

  html += `<div class="search-bar"><input class="search-input" type="text" placeholder="Search activities..." value="${esc(bizSearch)}" oninput="debounceBizSearch(this.value)"></div>`;

  if (pageItems.length === 0) {
    html += '<div style="text-align:center;padding:32px;color:var(--text2)">No activities match your filters.</div>';
  } else {
    for (const a of pageItems) {
      const sfBtn = a.sf_link ? `<a href="${a.sf_link}" target="_blank" class="act-btn" onclick="event.stopPropagation()">&#x2197; Salesforce</a>` : '';
      html += `<div class="act-item" onclick='showDetail(${safeJSON(a)})'>
        <div class="act-top"><div class="act-subject">${esc(a.subject || '(No subject)')}</div><div class="act-date">${formatDate(a.activity_date)}</div></div>
        <div class="act-meta">
          <span class="act-company">${esc(a.company_name || '')}${a.company_city_state ? ' · ' + esc(a.company_city_state) : ''}</span>
          <span class="act-cat ${catClass(a.computed_category)}">${esc(a.computed_category || 'General')}</span>
        </div>
        <div class="act-actions">
          <button class="act-btn primary" onclick="event.stopPropagation();openLogCall(${safeJSON({sf_contact_id:a.sf_contact_id||'',sf_company_id:a.sf_company_id||'',name:a.contact_name||a.company_name||a.subject||''})})">&#x260E; Log Call</button>
          ${sfBtn}
        </div>
      </div>`;
    }
  }

  if (totalPages > 1) {
    html += `<div class="pager"><button onclick="bizPage--;renderBizContent()" ${bizPage===0?'disabled':''}>&#x2190; Prev</button><span>Page ${bizPage+1} of ${totalPages}</span><button onclick="bizPage++;renderBizContent()" ${bizPage>=totalPages-1?'disabled':''}>Next &#x2192;</button></div>`;
  }

  const _bcEl = document.getElementById('bizContent');
  if (_bcEl) _bcEl.innerHTML = html;
}

let bizSearchTimeout;
function debounceBizSearch(val) {
  clearTimeout(bizSearchTimeout);
  bizSearchTimeout = setTimeout(() => { bizSearch = val; bizPage = 0; renderBizContent(); }, 250);
}

function toggleBizCatFilter(el, cat) {
  const wasActive = el.classList.contains('active');
  // Scope to only the pills container this pill belongs to (not all pills on the page)
  const pillsContainer = el.closest('.pills');
  if (pillsContainer) pillsContainer.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  if (!wasActive) {
    el.classList.add('active');
    const filtered = filterBizActivities().filter(a => (a.computed_category || 'General') === cat);
    renderBizSubset(filtered);
    return;
  }
  renderBizContent();
}

let _bizSubsetData = [];
let _bizSubsetPage = 0;

function renderBizSubset(subset) {
  if (subset !== undefined) { _bizSubsetData = subset; _bizSubsetPage = 0; }
  const start = _bizSubsetPage * PAGE_SIZE;
  const pageItems = _bizSubsetData.slice(start, start + PAGE_SIZE);
  const totalPages = Math.ceil(_bizSubsetData.length / PAGE_SIZE);
  let html = `<div style="margin-bottom:12px;font-size:14px;color:var(--text2)">${_bizSubsetData.length} results · <a href="#" onclick="event.preventDefault();renderBizContent()">Clear filter</a></div>`;
  for (const a of pageItems) {
    const sfBtn = a.sf_link ? `<a href="${a.sf_link}" target="_blank" class="act-btn" onclick="event.stopPropagation()">&#x2197; Salesforce</a>` : '';
    html += `<div class="act-item" onclick='showDetail(${safeJSON(a)})'>
      <div class="act-top"><div class="act-subject">${esc(a.subject || '(No subject)')}</div><div class="act-date">${formatDate(a.activity_date)}</div></div>
      <div class="act-meta"><span class="act-company">${esc(a.company_name || '')}${a.company_city_state ? ' · ' + esc(a.company_city_state) : ''}</span><span class="act-cat ${catClass(a.computed_category)}">${esc(a.computed_category)}</span></div>
      <div class="act-actions">
        <button class="act-btn primary" onclick="event.stopPropagation();openLogCall(${safeJSON({sf_contact_id:a.sf_contact_id||'',sf_company_id:a.sf_company_id||'',name:a.contact_name||a.company_name||''})})">&#x260E; Log Call</button>
        ${sfBtn}
      </div>
    </div>`;
  }
  if (totalPages > 1) {
    html += `<div class="pager"><button onclick="_bizSubsetPage--;renderBizSubset()" ${_bizSubsetPage===0?'disabled':''}>&#x2190; Prev</button><span>Page ${_bizSubsetPage+1} of ${totalPages}</span><button onclick="_bizSubsetPage++;renderBizSubset()" ${_bizSubsetPage>=totalPages-1?'disabled':''}>Next &#x2192;</button></div>`;
  }
  const _bcEl = document.getElementById('bizContent');
  if (_bcEl) _bcEl.innerHTML = html;
}

// ============================================================
// MARKETING — CRM Activity Hub + Domain-Classified Prospects
// ============================================================

let mktData = [];              // CRM tasks (non-opportunity activities + leads)
let mktLoaded = false;
let mktSource = 'all';    // 'all' | 'sf_deal' | 'rcm' | 'crexi' | 'loopnet' | 'leads'
let mktFilter = 'new';    // 'all' | 'upcoming' | 'overdue' | 'starred' | 'new' | 'unmatched'
let mktOwner = 'mine';    // 'mine' | 'all' | specific name
let mktSearch = '';
let mktPage = 0;
let mktCallHistoryCache = {};  // sf_contact_id → [{date, notes, type}]
let mktExpandedDeal = null;    // deal name currently expanded to show call history
let mktSort = 'date';          // 'date' | 'deal'
const MKT_PAGE = 20;
let mktSearchTimeout;

// Domain-classified opportunities stored globally for domain tabs
window._mktOpportunities = { government: [], dialysis: [], all_other: [] };
let _mktOpportunitiesLoaded = false;

// Prospect tab state per domain
let prospectPage = { government: 0, dialysis: 0, all_other: 0 };
let prospectOwner = { government: 'mine', dialysis: 'mine', all_other: 'mine' };
let prospectFilter = { government: 'all', dialysis: 'all', all_other: 'all' };
let prospectSearch = { government: '', dialysis: '', all_other: '' };
let prospectSearchTimeout;
const PROSPECT_PAGE = 20;

async function loadMarketing() {
  const el = document.getElementById('bizPageInner');
  if (!el) return;

  // If called just for domain prospects (not Marketing tab), only load opportunities
  if (currentBizTab !== 'marketing' && _mktOpportunitiesLoaded) {
    return; // opportunities already loaded, nothing else needed
  }

  if (!mktLoaded) {
    if (currentBizTab === 'marketing') {
      el.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading CRM activity hub...</p></div>';
    }
    try {
      // Fetch domain-classified opportunities (for routing to domain tabs)
      // Fetch CRM tasks (calls, follow-ups — NOT opportunities)
      // Fetch inbound leads
      // Load CRM client rollup — includes open_tasks JSON for inline task display
      const userName = LCC_USER.display_name || 'Scott Briggs';
      const leanFields = 'sf_contact_id,sf_company_id,first_name,last_name,contact_name,company_name,email,phone,assigned_to,open_task_count,open_tasks,last_activity_date,completed_activity_count,last_call_notes';
      const rollupUrl = new URL('/api/dia-query', window.location.origin);
      rollupUrl.searchParams.set('table', 'v_crm_client_rollup');
      rollupUrl.searchParams.set('select', leanFields);
      rollupUrl.searchParams.set('order', 'last_activity_date.desc.nullslast');
      rollupUrl.searchParams.set('limit', '1000');
      if (mktOwner === 'mine') {
        rollupUrl.searchParams.set('filter', 'assigned_to=eq.' + userName);
      } else if (mktOwner !== 'all') {
        rollupUrl.searchParams.set('filter', 'assigned_to=eq.' + mktOwner);
      }
      // Fetch with auto-retry: Supabase often returns 57014 timeout during initial load burst
      async function fetchRollupWithRetry(url, retries) {
        for (var attempt = 0; attempt <= retries; attempt++) {
          try {
            var r = await fetch(url);
            var d = await r.json();
            if (d.data && d.data.length > 0) return d.data;
            if (d.error && attempt < retries) {
              console.warn('[Marketing] Rollup attempt ' + (attempt+1) + ' failed: ' + (d.error || d.detail) + ', retrying in 3s...');
              await new Promise(function(ok) { setTimeout(ok, 3000); });
              continue;
            }
            return d.data || [];
          } catch(e) {
            if (attempt < retries) {
              console.warn('[Marketing] Rollup fetch error, retrying in 3s:', e.message);
              await new Promise(function(ok) { setTimeout(ok, 3000); });
            } else { return []; }
          }
        }
        return [];
      }
      // Only load CRM client rollup if we're on the Marketing tab
      // Skip the heavy query when called from domain Prospects tabs (they only need opportunities)
      let clientRollupRaw = [];
      let leadsRaw = [];
      if (currentBizTab === 'marketing') {
        const results = await Promise.all([
          fetchRollupWithRetry(rollupUrl.toString(), 3),
          diaQuery('marketing_leads', '*', { filter: 'status=not.in.(archived,duplicate)', order: 'ingested_at.desc.nullslast', limit: 500 })
        ]);
        clientRollupRaw = results[0];
        leadsRaw = results[1];
      }

      // Load opportunities separately — this is a heavy query that can timeout during initial burst
      let opportunitiesRaw = [];
      try {
        opportunitiesRaw = await diaQuery('v_opportunity_domain_classified', '*', { limit: 2000 });
      } catch (e) {
        console.warn('Opportunity domain query failed, will retry in 10s:', e.message);
      }
      // If empty (timeout), schedule a deferred retry
      if (!opportunitiesRaw || opportunitiesRaw.length === 0) {
        setTimeout(async () => {
          try {
            const retry = await diaQuery('v_opportunity_domain_classified', '*', { limit: 2000 });
            if (retry && retry.length > 0) {
              const retryOpps = retry.map(d => ({
                pipeline_source: 'sf_deal', item_id: String(d.activity_id || ''), deal_name: d.deal_name,
                deal_display_name: d.deal_display_name || d.deal_name, deal_priority: d.deal_priority,
                contact_name: d.contact_name, first_name: d.first_name, last_name: d.last_name,
                company_name: d.company_name, email: d.email, phone: d.phone,
                sf_contact_id: d.sf_contact_id, sf_company_id: d.sf_company_id,
                due_date: d.activity_date, notes: d.nm_notes, status: d.status,
                assigned_to: d.assigned_to, activity_type: 'opportunity',
                lead_source: null, sf_match_status: null, touchpoint_count: null,
                ingested_at: d.created_at, domain: d.domain, prospect_domain: d.prospect_domain
              }));
              window._mktOpportunities = {
                government: retryOpps.filter(d => d.domain === 'government'),
                dialysis: retryOpps.filter(d => d.domain === 'dialysis'),
                all_other: retryOpps.filter(d => d.domain === 'all_other')
              };
              _mktOpportunitiesLoaded = true;
              console.log('[Marketing] Deferred opportunity load succeeded:', retryOpps.length, 'records');
            }
          } catch (e2) { console.warn('Deferred opportunity retry also failed:', e2.message); }
        }, 10000);
      }

      // Store domain-classified opportunities globally for domain tabs
      const opps = (opportunitiesRaw || []).map(d => ({
        pipeline_source: 'sf_deal',
        item_id: String(d.activity_id || ''),
        deal_name: d.deal_name,
        deal_display_name: d.deal_display_name || d.deal_name,
        deal_priority: d.deal_priority,
        contact_name: d.contact_name,
        first_name: d.first_name,
        last_name: d.last_name,
        company_name: d.company_name,
        email: d.email,
        phone: d.phone,
        sf_contact_id: d.sf_contact_id,
        sf_company_id: d.sf_company_id,
        due_date: d.activity_date,
        notes: d.nm_notes,
        status: d.status,
        assigned_to: d.assigned_to,
        activity_type: 'opportunity',
        lead_source: null,
        sf_match_status: null,
        touchpoint_count: null,
        ingested_at: d.created_at,
        domain: d.domain,
        prospect_domain: d.prospect_domain
      }));
      window._mktOpportunities = {
        government: opps.filter(d => d.domain === 'government'),
        dialysis: opps.filter(d => d.domain === 'dialysis'),
        all_other: opps.filter(d => d.domain === 'all_other')
      };
      _mktOpportunitiesLoaded = true;

      // Normalize client rollup to pipeline schema (one row per contact)
      const tasks = (clientRollupRaw || []).map(d => ({
        pipeline_source: 'sf_deal',
        item_id: d.sf_contact_id || '',
        deal_name: d.contact_name || '(Unknown)',
        deal_display_name: d.contact_name || '(Unknown)',
        deal_priority: null,
        contact_name: d.contact_name || '',
        first_name: d.first_name,
        last_name: d.last_name,
        company_name: d.company_name,
        email: d.email,
        phone: d.phone,
        sf_contact_id: d.sf_contact_id,
        sf_company_id: d.sf_company_id,
        due_date: d.last_activity_date,
        notes: d.task_notes,
        status: 'Open',
        assigned_to: d.assigned_to,
        activity_type: 'CRM',
        lead_source: null,
        sf_match_status: null,
        touchpoint_count: d.open_task_count,
        ingested_at: d.first_activity_date,
        // Client rollup fields
        opportunity_deals: d.opportunity_deals,
        total_deal_count: d.total_deal_count || 0,
        completed_activity_count: d.completed_activity_count || 0,
        last_call_notes: d.last_call_notes,
        open_task_count: d.open_task_count || 0,
        open_tasks: d.open_tasks || []
      }));

      // Normalize leads to pipeline schema
      const leads = (leadsRaw || []).map(l => ({
        pipeline_source: l.source,
        item_id: String(l.lead_id || ''),
        deal_name: l.deal_name,
        deal_display_name: l.deal_name || [l.property_address, l.property_city, l.property_state].filter(Boolean).join(', '),
        deal_priority: l.priority === 'high' ? 3 : l.priority === 'low' ? 5 : 4,
        contact_name: l.lead_name || [l.lead_first_name, l.lead_last_name].filter(Boolean).join(' '),
        first_name: l.lead_first_name,
        last_name: l.lead_last_name,
        company_name: l.lead_company,
        email: l.lead_email,
        phone: l.lead_phone,
        sf_contact_id: l.sf_contact_id,
        sf_company_id: l.sf_company_id,
        due_date: l.follow_up_date || (l.lead_date ? l.lead_date.split('T')[0] : null) || (l.ingested_at ? l.ingested_at.split('T')[0] : null),
        notes: l.notes,
        status: l.status,
        activity_type: l.activity_type,
        lead_source: l.source,
        sf_match_status: l.sf_match_status,
        touchpoint_count: l.touchpoint_count,
        ingested_at: l.ingested_at
      }));

      // Marketing tab only renders CRM tasks + leads (NOT opportunities)
      mktData = [...tasks, ...leads].sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return b.due_date.localeCompare(a.due_date); // DESC — most recent first
      });
      mktLoaded = true;

      // Badge: actionable CRM tasks due (calls due today + overdue follow-ups)
      const today = new Date().toISOString().split('T')[0];
      const actionableCount = mktData.filter(d => d.pipeline_source === 'sf_deal' && d.due_date && d.due_date <= today).length;
      const badge = document.getElementById('bizBadgeMkt');
      if (badge) badge.textContent = actionableCount || mktData.length;
      // Update All Other badge with prospect count
      const otherBadge = document.getElementById('bizBadgeOther');
      if (otherBadge) otherBadge.textContent = window._mktOpportunities.all_other.length || '—';
    } catch (e) {
      console.error('Marketing load error:', e);
      el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--red)">Error loading marketing pipeline.</div>';
      return;
    }
  }

  renderMarketing();
}

function renderMarketing() {
  const el = document.getElementById('bizPageInner');
  if (!el) return;

  const today = new Date().toISOString().split('T')[0];
  const userName = LCC_USER.display_name || 'Scott Briggs';

  // Owner filter
  let filtered = mktData;
  if (mktOwner === 'mine') {
    filtered = filtered.filter(d => d.assigned_to === userName);
  } else if (mktOwner !== 'all') {
    filtered = filtered.filter(d => d.assigned_to === mktOwner);
  }

  // Source filter
  if (mktSource === 'sf_deal') {
    filtered = filtered.filter(d => d.pipeline_source === 'sf_deal');
  } else if (mktSource === 'leads') {
    filtered = filtered.filter(d => d.pipeline_source !== 'sf_deal');
  } else if (mktSource !== 'all') {
    filtered = filtered.filter(d => d.pipeline_source === mktSource);
  }

  // Status/timing filter
  if (mktFilter === 'upcoming') {
    filtered = filtered.filter(d => d.due_date && d.due_date >= today);
  } else if (mktFilter === 'overdue') {
    filtered = filtered.filter(d => d.due_date && d.due_date < today);
  } else if (mktFilter === 'starred') {
    filtered = filtered.filter(d => d.deal_name && d.deal_name.startsWith('****'));
  } else if (mktFilter === 'new') {
    filtered = filtered.filter(d => d.status === 'new' || d.status === 'Open');
  } else if (mktFilter === 'unmatched') {
    filtered = filtered.filter(d => d.sf_match_status === 'unmatched');
  }

  if (mktSearch) {
    const q = mktSearch.toLowerCase();
    filtered = filtered.filter(d =>
      (d.deal_display_name || '').toLowerCase().includes(q) ||
      (d.contact_name || '').toLowerCase().includes(q) ||
      (d.company_name || '').toLowerCase().includes(q) ||
      (d.email || '').toLowerCase().includes(q)
    );
  }

  // Collect unique owners for dropdown
  const ownerSet = new Set();
  mktData.forEach(d => { if (d.assigned_to) ownerSet.add(d.assigned_to); });
  const owners = Array.from(ownerSet).sort();

  // Stats from owner-filtered dataset
  const ownerFiltered = mktOwner === 'all' ? mktData : mktOwner === 'mine' ? mktData.filter(d => d.assigned_to === userName) : mktData.filter(d => d.assigned_to === mktOwner);
  const crmTasks = ownerFiltered.filter(d => d.pipeline_source === 'sf_deal');
  const inboundLeads = ownerFiltered.filter(d => d.pipeline_source !== 'sf_deal');
  const callsDueToday = crmTasks.filter(d => d.due_date === today).length;
  const overdue = ownerFiltered.filter(d => d.due_date && d.due_date < today).length;
  const unmatched = inboundLeads.filter(d => d.sf_match_status === 'unmatched').length;

  // Domain prospect counts for quick reference
  const govCount = window._mktOpportunities.government.length;
  const diaCount = window._mktOpportunities.dialysis.length;
  const otherCount = window._mktOpportunities.all_other.length;

  let html = '';

  // Header
  html += '<div style="margin-bottom:12px"><h3 style="margin:0;color:var(--text)">CRM Activity Hub</h3><div style="font-size:12px;color:var(--text3)">Calls, follow-ups & tasks — Opportunities routed to domain Prospects tabs</div></div>';

  // Owner toggle (My Tasks / All Tasks)
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">';
  html += `<span class="pill ${mktOwner==='mine'?'active':''}" onclick="mktOwner='mine';mktPage=0;mktLoaded=false;loadMarketing()">My Tasks</span>`;
  html += `<span class="pill ${mktOwner==='all'?'active':''}" onclick="mktOwner='all';mktPage=0;mktLoaded=false;loadMarketing()">All Tasks</span>`;
  html += '<select style="background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px" onchange="mktOwner=this.value;mktPage=0;renderMarketing()">';
  html += `<option value="mine" ${mktOwner==='mine'?'selected':''}>My Tasks</option>`;
  html += `<option value="all" ${mktOwner==='all'?'selected':''}>All Team</option>`;
  owners.forEach(o => { html += `<option value="${esc(o)}" ${mktOwner===o?'selected':''}>${esc(o)}</option>`; });
  html += '</select>';
  html += '</div>';

  // Metrics row — CRM focused
  html += '<div class="widget-grid">';
  html += `<div class="stat-card" style="cursor:pointer" onclick="mktFilter='all';mktSource='sf_deal';mktPage=0;renderMarketing()"><div class="stat-label">Calls Due Today</div><div class="stat-value" style="color:var(--accent)">${callsDueToday}</div><div class="stat-sub">CRM tasks</div></div>`;
  html += `<div class="stat-card" style="cursor:pointer" onclick="mktFilter='overdue';mktSource='all';mktPage=0;renderMarketing()"><div class="stat-label">Overdue</div><div class="stat-value" style="color:var(--red)">${overdue}</div><div class="stat-sub">Past due date</div></div>`;
  html += `<div class="stat-card" style="cursor:pointer" onclick="mktSource='leads';mktFilter='all';mktPage=0;renderMarketing()"><div class="stat-label">Inbound Leads</div><div class="stat-value" style="color:var(--purple)">${inboundLeads.length}</div><div class="stat-sub">${unmatched ? unmatched + ' unmatched' : 'All matched'}</div></div>`;
  html += `<div class="stat-card"><div class="stat-label">Prospects</div><div class="stat-value" style="color:var(--green)">${govCount + diaCount + otherCount}</div><div class="stat-sub">Gov ${govCount} · Dia ${diaCount} · Other ${otherCount}</div></div>`;
  html += '</div>';

  // Source tabs
  const srcCounts = {};
  ownerFiltered.forEach(d => { srcCounts[d.pipeline_source] = (srcCounts[d.pipeline_source] || 0) + 1; });
  html += '<div class="pills" style="margin-bottom:4px">';
  html += `<span class="pill ${mktSource==='all'?'active':''}" onclick="mktSource='all';mktPage=0;renderMarketing()">All <span class="pill-ct">${ownerFiltered.length}</span></span>`;
  html += `<span class="pill ${mktSource==='sf_deal'?'active':''}" onclick="mktSource='sf_deal';mktPage=0;renderMarketing()">CRM Tasks <span class="pill-ct">${srcCounts['sf_deal']||0}</span></span>`;
  if (srcCounts['rcm']) html += `<span class="pill ${mktSource==='rcm'?'active':''}" onclick="mktSource='rcm';mktPage=0;renderMarketing()">RCM <span class="pill-ct">${srcCounts['rcm']}</span></span>`;
  if (srcCounts['crexi']) html += `<span class="pill ${mktSource==='crexi'?'active':''}" onclick="mktSource='crexi';mktPage=0;renderMarketing()">CREXi <span class="pill-ct">${srcCounts['crexi']}</span></span>`;
  if (srcCounts['loopnet']) html += `<span class="pill ${mktSource==='loopnet'?'active':''}" onclick="mktSource='loopnet';mktPage=0;renderMarketing()">LoopNet <span class="pill-ct">${srcCounts['loopnet']}</span></span>`;
  if (srcCounts['website']) html += `<span class="pill ${mktSource==='website'?'active':''}" onclick="mktSource='website';mktPage=0;renderMarketing()">Website <span class="pill-ct">${srcCounts['website']}</span></span>`;
  html += '</div>';

  // Status filters
  html += '<div class="pills" style="margin-bottom:8px">';
  html += `<span class="pill ${mktFilter==='all'?'active':''}" onclick="mktFilter='all';mktPage=0;renderMarketing()">All</span>`;
  html += `<span class="pill ${mktFilter==='new'?'active':''}" onclick="mktFilter='new';mktPage=0;renderMarketing()">New/Open</span>`;
  html += `<span class="pill ${mktFilter==='upcoming'?'active':''}" onclick="mktFilter='upcoming';mktPage=0;renderMarketing()">Upcoming</span>`;
  html += `<span class="pill ${mktFilter==='overdue'?'active':''}" onclick="mktFilter='overdue';mktPage=0;renderMarketing()">Overdue</span>`;
  html += `<span class="pill ${mktFilter==='starred'?'active':''}" onclick="mktFilter='starred';mktPage=0;renderMarketing()">Starred</span>`;
  if (unmatched > 0) html += `<span class="pill ${mktFilter==='unmatched'?'active':''}" onclick="mktFilter='unmatched';mktPage=0;renderMarketing()">Unmatched <span class="pill-ct" style="background:var(--red);color:#fff">${unmatched}</span></span>`;
  html += '</div>';

  // Sort toggle
  html += '<div class="pills" style="margin-bottom:8px">';
  html += '<span style="font-size:11px;color:var(--text3);margin-right:6px">Sort:</span>';
  html += `<span class="pill ${mktSort==='date'?'active':''}" onclick="mktSort='date';mktPage=0;renderMarketing()">Recent Activity</span>`;
  html += `<span class="pill ${mktSort==='deal'?'active':''}" onclick="mktSort='deal';mktPage=0;renderMarketing()">By Deal</span>`;
  html += '</div>';

  // Search
  html += `<div class="search-bar"><input class="search-input" type="text" placeholder="Search tasks, contacts, companies, emails..." value="${esc(mktSearch)}" oninput="debounceMktSearch(this.value)"></div>`;

  if (mktSort === 'deal') {
    // Group contacts by their Opportunity deal subjects
    var dealGroups = {};
    filtered.forEach(function(c) {
      var tasks = c.open_tasks || [];
      var oppTasks = tasks.filter(function(t) { return t.type === 'Opportunity'; });
      if (oppTasks.length > 0) {
        oppTasks.forEach(function(t) {
          var key = t.subject || '(Untitled)';
          if (!dealGroups[key]) dealGroups[key] = { deal: key, date: t.date, contacts: [] };
          if (t.date && (!dealGroups[key].date || t.date > dealGroups[key].date)) dealGroups[key].date = t.date;
          dealGroups[key].contacts.push(c);
        });
      }
    });
    var sortedDeals = Object.values(dealGroups).sort(function(a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });

    if (sortedDeals.length === 0) {
      html += '<div style="text-align:center;padding:32px;color:var(--text2)">No contacts with Opportunity deals found. Try "Recent Activity" sort.</div>';
    } else {
      var dealStart = mktPage * MKT_PAGE;
      var dealPageItems = sortedDeals.slice(dealStart, dealStart + MKT_PAGE);
      var dealTotalPages = Math.ceil(sortedDeals.length / MKT_PAGE);

      dealPageItems.forEach(function(group) {
        html += '<div class="widget" style="padding:14px">';
        html += '<div style="font-size:15px;font-weight:600;margin-bottom:6px"><span style="color:var(--yellow)">&#9733;</span> ' + esc(group.deal) + '</div>';
        html += '<div style="font-size:12px;color:var(--text3);margin-bottom:8px">' + group.contacts.length + ' contact' + (group.contacts.length > 1 ? 's' : '') + ' · Due: ' + esc(group.date || '—') + '</div>';
        group.contacts.forEach(function(c) {
          var cId = esc(c.sf_contact_id || c.item_id || '');
          var logData = safeJSON({sf_contact_id:c.sf_contact_id||'',sf_company_id:c.sf_company_id||'',name:c.contact_name||c.company_name||''});
          html += '<div style="padding:6px 0;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
          html += '<div style="flex:1;min-width:0">';
          html += '<div style="font-size:13px;font-weight:500">' + esc(c.contact_name || '—') + '</div>';
          html += '<div style="font-size:12px;color:var(--text2)">' + esc(c.company_name || '');
          if (c.email) html += ' · <a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>';
          html += '</div>';
          if (c.phone) html += '<div style="font-size:12px;color:var(--text3)">' + esc(c.phone) + '</div>';
          html += '</div>';
          html += '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">';
          if (c.email) html += '<a href="mailto:' + esc(c.email) + '" class="act-btn" style="font-size:11px;padding:4px 8px">&#x2709;</a>';
          if (c.phone) {
            var cleanPhone = (c.phone || '').replace(/[^+0-9]/g, '');
            html += '<a href="webexteams://call?uri=' + encodeURIComponent(cleanPhone) + '" class="act-btn" style="font-size:11px;padding:4px 8px" title="Call via WebEx">&#x1F4DE;</a>';
          }
          html += '<button class="act-btn primary" style="font-size:11px;padding:4px 8px" onclick="openLogCall(' + logData + ')">Log</button>';
          html += '</div></div>';
        });
        html += '</div>';
      });

      if (dealTotalPages > 1) {
        html += '<div class="pager"><button onclick="mktPage--;renderMarketing()" ' + (mktPage===0?'disabled':'') + '>&#x2190; Prev</button><span>Page ' + (mktPage+1) + ' of ' + dealTotalPages + ' · ' + sortedDeals.length + ' deals</span><button onclick="mktPage++;renderMarketing()" ' + (mktPage>=dealTotalPages-1?'disabled':'') + '>Next &#x2192;</button></div>';
      }
    }
  } else {
    // Render cards using the shared function
    html += renderProspectCardsHTML(filtered, { showDomainDropdown: false, showReassign: true, showEmailTemplates: true, showCallHistory: true, page: mktPage, pageSize: MKT_PAGE, pagerFn: 'mktPage', renderFn: 'renderMarketing' });
  }

  el.innerHTML = html;
}

// ============================================================
// SHARED PROSPECT CARD RENDERING
// ============================================================

/**
 * Render deal-grouped prospect/task cards as HTML string.
 * Used by Marketing CRM hub, Dialysis Prospects, Government Pipeline, All Other Prospects.
 */
function renderProspectCardsHTML(items, options = {}) {
  const { showDomainDropdown = false, showReassign = true, showEmailTemplates = true, showCallHistory = true, page = 0, pageSize = 20, pagerFn, renderFn, domain } = options;
  const today = new Date().toISOString().split('T')[0];

  // Collect owners for reassign dropdown
  const ownerSet = new Set();
  items.forEach(d => { if (d.assigned_to) ownerSet.add(d.assigned_to); });
  const owners = Array.from(ownerSet).sort();

  const start = page * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  const totalPages = Math.ceil(items.length / pageSize);

  let html = '';

  if (items.length === 0) {
    html += '<div style="text-align:center;padding:32px;color:var(--text2)">No items match your filters.</div>';
    return html;
  }

  // Group by deal for display
  const groups = {};
  pageItems.forEach(d => {
    const key = d.deal_name || d.item_id;
    if (!groups[key]) groups[key] = { items: [], displayName: d.deal_display_name || d.deal_name || '(No deal name)', first: d };
    groups[key].items.push(d);
  });

  Object.values(groups).forEach(group => {
    const first = group.first;
    const contacts = group.items;
    const isOverdue = first.due_date && first.due_date < today;
    const isStarred = first.deal_name && first.deal_name.startsWith('****');
    const isLead = first.pipeline_source !== 'sf_deal';

    const priorityBadge = first.deal_priority ? `<span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:50%;background:${first.deal_priority <= 3 ? 'var(--red)' : first.deal_priority <= 4 ? 'var(--yellow)' : 'var(--text3)'};color:#fff;font-size:11px;font-weight:700;margin-right:6px">${first.deal_priority}</span>` : '';
    const dueBadge = isOverdue ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--red);color:#fff;margin-left:6px">OVERDUE</span>' : '';
    const sourceBadge = isLead ? `<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--purple);color:#fff;margin-left:6px">${esc(first.pipeline_source.toUpperCase())}</span>` : '';
    const matchBadge = isLead && first.sf_match_status === 'unmatched' ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--orange);color:#fff;margin-left:6px">UNMATCHED</span>' : '';

    html += `<div class="widget" style="padding:14px${isLead ? ';border-left:3px solid var(--purple)' : ''}">`;
    // Deal header
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">`;
    html += `<div style="flex:1;min-width:0">`;
    html += `<div style="font-size:15px;font-weight:600;display:flex;align-items:center;flex-wrap:wrap;gap:4px">${priorityBadge}${isStarred ? '<span style="color:var(--yellow);margin-right:4px">&#9733;</span>' : ''}${esc(group.displayName)}${dueBadge}${sourceBadge}${matchBadge}</div>`;
    html += `<div style="font-size:12px;color:var(--text3);margin-top:2px">Due: ${esc(first.due_date || '—')} · ${contacts.length} contact${contacts.length > 1 ? 's' : ''}${first.assigned_to ? ' · <span style="color:var(--accent)">' + esc(first.assigned_to) + '</span>' : ''}${isLead && first.activity_type ? ' · ' + esc(cleanLabel(first.activity_type)) : ''}</div>`;
    html += '</div>';
    // Reassign dropdown + domain dropdown
    html += '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">';
    if (showDomainDropdown) {
      const curDomain = first.domain || 'all_other';
      html += `<select style="background:var(--card);color:var(--text2);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:11px" title="Reclassify domain" onchange="mktReclassifyDeal('${esc(first.item_id)}',this.value)">`;
      html += `<option value="government" ${curDomain==='government'?'selected':''}>Government</option>`;
      html += `<option value="dialysis" ${curDomain==='dialysis'?'selected':''}>Dialysis</option>`;
      html += `<option value="all_other" ${curDomain==='all_other'?'selected':''}>All Other</option>`;
      html += '</select>';
    }
    if (showReassign) {
      html += '<select style="background:var(--card);color:var(--text2);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:11px" title="Reassign deal" onchange="mktReassignDeal(\'' + esc(first.item_id) + '\',this.value,\'' + esc(first.sf_contact_id || '') + '\')">';
      html += `<option value="">Assign to...</option>`;
      owners.forEach(o => { html += `<option value="${esc(o)}" ${first.assigned_to===o?'selected':''}>${esc(o)}</option>`; });
      html += '</select>';
    }
    html += '</div>';
    html += '</div>';

    // Contact rows
    contacts.forEach(c => {
      const cId = esc(c.sf_contact_id || c.item_id || '');
      const logData = safeJSON({sf_contact_id:c.sf_contact_id||'',sf_company_id:c.sf_company_id||'',name:c.contact_name||c.company_name||''});
      // Clickable contact row — expands to show deals + history
      html += `<div style="cursor:pointer;padding:8px 0;border-top:1px solid var(--border)" onclick="toggleContactDetail('${cId}')">`;
      html += `<div style="display:flex;align-items:center;justify-content:space-between">`;
      html += `<div style="flex:1;min-width:0">`;
      html += `<div style="font-size:14px;font-weight:500">${esc(c.contact_name || '—')} <span style="font-size:11px;color:var(--text3);margin-left:4px">&#9660;</span></div>`;
      html += `<div style="font-size:12px;color:var(--text2)">${esc(c.company_name || '')}`;
      if (c.email) html += ` · <a href="mailto:${esc(c.email)}" onclick="event.stopPropagation()">${esc(c.email)}</a>`;
      html += `</div>`;
      if (c.phone) html += `<div style="font-size:12px;color:var(--text3)">${esc(c.phone)}</div>`;
      // Client rollup: open tasks with deal titles
      // Show open task count — full task list loads on expand via toggleContactDetail
      if (c.open_task_count > 0 && !c.open_tasks) {
        html += `<div style="font-size:11px;color:var(--accent);margin-top:3px">${c.open_task_count} open task${c.open_task_count > 1 ? 's' : ''} — click to view</div>`;
      }
      if (c.open_tasks && c.open_tasks.length > 0) {
        html += '<div style="margin-top:4px;font-size:11px">';
        html += '<span style="color:var(--text2);font-weight:600">Open Tasks (' + c.open_tasks.length + '):</span>';
        c.open_tasks.slice(0, 5).forEach(function(t) {
          var subj = t.subject || 'Task';
          var isOpp = t.type === 'Opportunity';
          var icon = isOpp ? '<span style="color:var(--yellow)">&#9733;</span> ' : '<span style="color:var(--text3)">&#8226;</span> ';
          html += '<div style="padding:2px 0 2px 8px;display:flex;align-items:center;justify-content:space-between;gap:6px" onclick="event.stopPropagation()">';
          html += '<div style="flex:1;min-width:0">' + icon;
          html += '<span style="color:' + (isOpp ? 'var(--accent)' : 'var(--text)') + '">' + esc(subj) + '</span>';
          if (t.date) html += ' <span style="color:var(--text3)">(' + esc(t.date) + ')</span>';
          if (t.notes) html += ' <span style="color:var(--text3);font-style:italic">— ' + esc(t.notes) + '</span>';
          html += '</div>';
          // Task action buttons: complete, edit date, snooze
          html += '<div style="display:flex;gap:3px;flex-shrink:0">';
          html += '<button class="act-btn" style="font-size:10px;padding:2px 5px" onclick="completeTask(\'' + esc(c.sf_contact_id) + '\',\'' + esc(subj) + '\')" title="Mark complete">&#x2713;</button>';
          html += '<input type="date" style="font-size:10px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:1px 3px;width:110px" value="' + esc(t.date || '') + '" onchange="rescheduleTask(\'' + esc(c.sf_contact_id) + '\',\'' + esc(subj) + '\',this.value)" title="Change due date">';
          html += '<button class="act-btn" style="font-size:10px;padding:2px 5px" onclick="dismissTask(\'' + esc(c.sf_contact_id) + '\',\'' + esc(subj) + '\')" title="Dismiss/archive">&#x2715;</button>';
          html += '</div></div>';
        });
        if (c.open_tasks.length > 5) html += '<div style="padding:1px 0 1px 8px;color:var(--text3)">+ ' + (c.open_tasks.length - 5) + ' more...</div>';
        html += '</div>';
      }
      // Deal associations (from Opportunity records across all statuses)
      if (c.opportunity_deals) {
        html += `<div style="font-size:11px;color:var(--accent);margin-top:3px">Related Deals: ${esc(c.opportunity_deals)}</div>`;
      }
      // Activity summary line
      if (c.last_call_notes) {
        html += `<div style="font-size:11px;color:var(--text3);margin-top:2px">Last call: ${esc(c.last_call_notes)}</div>`;
      }
      if (c.completed_activity_count > 0) {
        html += `<div style="font-size:11px;color:var(--text3);margin-top:1px">${c.completed_activity_count} completed activities${c.total_deal_count ? ' · ' + c.total_deal_count + ' deal' + (c.total_deal_count > 1 ? 's' : '') : ''}</div>`;
      }

      // Lead-specific metadata
      if (c.pipeline_source !== 'sf_deal') {
        let meta = [];
        if (c.sf_match_status) meta.push(c.sf_match_status === 'matched' ? '<span style="color:var(--green)">SF Matched</span>' : '<span style="color:var(--orange)">Unmatched</span>');
        if (c.touchpoint_count) meta.push(c.touchpoint_count + ' touchpoint' + (c.touchpoint_count > 1 ? 's' : ''));
        if (c.lead_source) meta.push('via ' + esc(c.lead_source));
        if (meta.length) html += `<div style="font-size:11px;color:var(--text3);margin-top:2px">${meta.join(' · ')}</div>`;
      }
      html += '</div>';

      // Action buttons
      html += `<div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px;flex-wrap:wrap;justify-content:flex-end" onclick="event.stopPropagation()">`;
      if (showEmailTemplates && c.email) {
        html += `<div style="position:relative;display:inline-block"><button class="act-btn" style="font-size:11px;padding:4px 8px" onclick="event.stopPropagation();toggleEmailMenu(this)">&#x2709; Email</button>`;
        html += `<div class="email-tpl-menu" style="display:none;position:absolute;right:0;top:28px;background:var(--card);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.3);z-index:20;min-width:180px;padding:4px 0;font-size:12px">`;
        html += `<div style="padding:6px 12px;cursor:pointer;color:var(--text)" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background=''" onclick="event.stopPropagation();closeEmailMenus();openMktEmail('${esc(c.email)}','${esc(c.contact_name||'')}','${esc(group.displayName)}')">Initial Outreach</div>`;
        html += `<div style="padding:6px 12px;cursor:pointer;color:var(--text)" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background=''" onclick="event.stopPropagation();closeEmailMenus();openMktFollowUp('${esc(c.email)}','${esc(c.contact_name||'')}','${esc(group.displayName)}')">Follow-Up</div>`;
        html += `<div style="padding:6px 12px;cursor:pointer;color:var(--text)" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background=''" onclick="event.stopPropagation();closeEmailMenus();openMktMarketUpdate('${esc(c.email)}','${esc(c.contact_name||'')}','${esc(group.displayName)}')">Market Update</div>`;
        html += `<div style="padding:6px 12px;cursor:pointer;color:var(--text)" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background=''" onclick="event.stopPropagation();closeEmailMenus();openMktMeetingReq('${esc(c.email)}','${esc(c.contact_name||'')}','${esc(group.displayName)}')">Meeting Request</div>`;
        html += '</div></div>';
      }
      if (c.phone) {
        const cleanPhone = (c.phone || '').replace(/[^+0-9]/g, '');
        html += `<a href="webexteams://call?uri=${encodeURIComponent(cleanPhone)}" class="act-btn" style="font-size:11px;padding:4px 8px" onclick="event.stopPropagation()" title="Call via WebEx">&#x1F4DE; WebEx</a>`;
        html += `<a href="tel:${esc(c.phone)}" class="act-btn" style="font-size:11px;padding:4px 8px" onclick="event.stopPropagation()" title="Direct dial">&#x260E;</a>`;
      }
      html += `<button class="act-btn primary" style="font-size:11px;padding:4px 8px" onclick="event.stopPropagation();openLogCall(${logData})">Log</button>`;
      // Lead management buttons
      if (c.pipeline_source !== 'sf_deal' && c.sf_match_status === 'unmatched') {
        html += `<button class="act-btn" style="font-size:11px;padding:4px 8px;background:var(--orange);color:#fff" onclick="event.stopPropagation();mktMatchLead('${esc(c.item_id)}')">Match</button>`;
      }
      if (c.pipeline_source !== 'sf_deal') {
        html += `<button class="act-btn" style="font-size:11px;padding:4px 8px" onclick="event.stopPropagation();mktUpdateStatus('${esc(c.item_id)}','contacted')">&#x2713;</button>`;
      }
      html += '</div></div></div>';
      // Expandable detail panel (hidden by default) — shows deals + call history
      html += `<div id="contact-detail-${cId}" style="display:none;padding:8px 0 8px 16px;font-size:12px;color:var(--text2);border-top:1px dashed var(--border);background:rgba(255,255,255,.02)">`;
      html += '<div style="color:var(--text3)"><span class="spinner" style="width:12px;height:12px"></span> Loading contact details...</div>';
      html += '</div>';
    });

    html += '</div>';
  });

  // Pager
  if (totalPages > 1 && pagerFn && renderFn) {
    html += `<div class="pager"><button onclick="${pagerFn}--;${renderFn}()" ${page===0?'disabled':''}>&#x2190; Prev</button><span>Page ${page+1} of ${totalPages} · ${items.length} results</span><button onclick="${pagerFn}++;${renderFn}()" ${page>=totalPages-1?'disabled':''}>Next &#x2192;</button></div>`;
  }

  return html;
}

// ============================================================
// DOMAIN PROSPECT RENDERING (shared by Dialysis, Gov, All Other)
// ============================================================

/**
 * Render a full prospect subtab for a given domain.
 * Called by dialysis.js, gov.js, and the All Other section.
 */
function renderDomainProspects(domain, containerId) {
  const el = containerId ? document.getElementById(containerId) : document.getElementById('bizPageInner');
  if (!el) return '';

  const today = new Date().toISOString().split('T')[0];
  const userName = LCC_USER.display_name || 'Scott Briggs';
  const prospects = window._mktOpportunities[domain] || [];

  // Apply filters
  let filtered = prospects;
  if (prospectOwner[domain] === 'mine') {
    filtered = filtered.filter(d => d.assigned_to === userName);
  } else if (prospectOwner[domain] !== 'all') {
    filtered = filtered.filter(d => d.assigned_to === prospectOwner[domain]);
  }

  if (prospectFilter[domain] === 'upcoming') {
    filtered = filtered.filter(d => d.due_date && d.due_date >= today);
  } else if (prospectFilter[domain] === 'overdue') {
    filtered = filtered.filter(d => d.due_date && d.due_date < today);
  } else if (prospectFilter[domain] === 'starred') {
    filtered = filtered.filter(d => d.deal_name && d.deal_name.startsWith('****'));
  }

  if (prospectSearch[domain]) {
    const q = prospectSearch[domain].toLowerCase();
    filtered = filtered.filter(d =>
      (d.deal_display_name || '').toLowerCase().includes(q) ||
      (d.contact_name || '').toLowerCase().includes(q) ||
      (d.company_name || '').toLowerCase().includes(q) ||
      (d.email || '').toLowerCase().includes(q)
    );
  }

  // Collect owners
  const ownerSet = new Set();
  prospects.forEach(d => { if (d.assigned_to) ownerSet.add(d.assigned_to); });
  const owners = Array.from(ownerSet).sort();
  const overdue = prospects.filter(d => d.due_date && d.due_date < today).length;
  const totalDeals = new Set(prospects.map(d => d.deal_name)).size;
  const domainLabel = domain === 'government' ? 'Government' : domain === 'dialysis' ? 'Dialysis' : 'All Other';
  const renderCall = `renderDomainProspects('${domain}')`;

  let html = '';
  html += `<div style="margin-bottom:12px"><h3 style="margin:0;color:var(--text)">${domainLabel} Prospects</h3><div style="font-size:12px;color:var(--text3)">${totalDeals} deals · ${prospects.length} contacts</div></div>`;

  // Owner toggle
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">';
  html += `<span class="pill ${prospectOwner[domain]==='mine'?'active':''}" onclick="prospectOwner['${domain}']='mine';prospectPage['${domain}']=0;${renderCall}">My Deals</span>`;
  html += `<span class="pill ${prospectOwner[domain]==='all'?'active':''}" onclick="prospectOwner['${domain}']='all';prospectPage['${domain}']=0;${renderCall}">All Deals</span>`;
  html += `<select style="background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px" onchange="prospectOwner['${domain}']=this.value;prospectPage['${domain}']=0;${renderCall}">`;
  html += `<option value="mine" ${prospectOwner[domain]==='mine'?'selected':''}>My Deals</option>`;
  html += `<option value="all" ${prospectOwner[domain]==='all'?'selected':''}>All Team</option>`;
  owners.forEach(o => { html += `<option value="${esc(o)}" ${prospectOwner[domain]===o?'selected':''}>${esc(o)}</option>`; });
  html += '</select>';
  html += '</div>';

  // Metrics
  html += '<div class="widget-grid">';
  html += `<div class="stat-card"><div class="stat-label">Total Deals</div><div class="stat-value" style="color:var(--accent)">${totalDeals}</div><div class="stat-sub">${prospects.length} contacts</div></div>`;
  html += `<div class="stat-card" style="cursor:pointer" onclick="prospectFilter['${domain}']='overdue';prospectPage['${domain}']=0;${renderCall}"><div class="stat-label">Overdue</div><div class="stat-value" style="color:var(--red)">${overdue}</div><div class="stat-sub">Past due date</div></div>`;
  html += '</div>';

  // Status filters
  html += '<div class="pills" style="margin-bottom:8px">';
  html += `<span class="pill ${prospectFilter[domain]==='all'?'active':''}" onclick="prospectFilter['${domain}']='all';prospectPage['${domain}']=0;${renderCall}">All</span>`;
  html += `<span class="pill ${prospectFilter[domain]==='upcoming'?'active':''}" onclick="prospectFilter['${domain}']='upcoming';prospectPage['${domain}']=0;${renderCall}">Upcoming</span>`;
  html += `<span class="pill ${prospectFilter[domain]==='overdue'?'active':''}" onclick="prospectFilter['${domain}']='overdue';prospectPage['${domain}']=0;${renderCall}">Overdue</span>`;
  html += `<span class="pill ${prospectFilter[domain]==='starred'?'active':''}" onclick="prospectFilter['${domain}']='starred';prospectPage['${domain}']=0;${renderCall}">Starred</span>`;
  html += '</div>';

  // Search
  html += `<div class="search-bar"><input class="search-input" type="text" placeholder="Search prospects..." value="${esc(prospectSearch[domain] || '')}" oninput="clearTimeout(prospectSearchTimeout);prospectSearchTimeout=setTimeout(()=>{prospectSearch['${domain}']=this.value;prospectPage['${domain}']=0;${renderCall}},250)"></div>`;

  // Cards
  html += renderProspectCardsHTML(filtered, {
    showDomainDropdown: true,
    showReassign: true,
    showEmailTemplates: true,
    showCallHistory: true,
    page: prospectPage[domain],
    pageSize: PROSPECT_PAGE,
    pagerFn: `prospectPage['${domain}']`,
    renderFn: `renderDomainProspects.bind(null,'${domain}')`,
    domain: domain
  });

  if (containerId) {
    el.innerHTML = html;
  } else {
    el.innerHTML = html;
  }
  return html;
}

function debounceMktSearch(val) {
  clearTimeout(mktSearchTimeout);
  mktSearchTimeout = setTimeout(() => { mktSearch = val; mktPage = 0; renderMarketing(); }, 250);
}

// ── Email template menus ──
function toggleEmailMenu(btn) {
  const menu = btn.parentElement.querySelector('.email-tpl-menu');
  const wasOpen = menu.style.display !== 'none';
  closeEmailMenus();
  if (!wasOpen) menu.style.display = 'block';
}
function closeEmailMenus() {
  document.querySelectorAll('.email-tpl-menu').forEach(m => m.style.display = 'none');
}
document.addEventListener('click', closeEmailMenus);

function openMktFollowUp(email, name, deal) {
  const first = name.split(' ')[0] || 'there';
  _composeOutlook(email,
    'Following Up \u2014 ' + deal,
    'Hi ' + first + ',\n\n' +
    'I wanted to follow up on my previous outreach regarding ' + deal + '. I understand these decisions take time, and I am happy to work on your schedule.\n\n' +
    'If you have a few minutes this week, I would love to share some recent market data and comparable transactions that may be useful as you evaluate your options.\n\n' +
    'Please let me know if there is a good time to connect.' +
    _sig()
  );
}

function openMktMarketUpdate(email, name, deal) {
  const first = name.split(' ')[0] || 'there';
  _composeOutlook(email,
    'Net Lease Market Update \u2014 ' + deal,
    'Hi ' + first + ',\n\n' +
    'I wanted to share a quick update on the net lease market as it relates to ' + deal + '.\n\n' +
    'The 10-year Treasury is currently at [X.XX]%, and we are seeing [cap rate trends / buyer activity / pricing observations]. For government-leased properties in particular, [specific insight].\n\n' +
    'Investment Highlights:\n' +
    '  - Tenant: [Agency / Operator]\n' +
    '  - Location: [City, State]\n' +
    '  - Building Size: [XX,XXX SF]\n' +
    '  - Lease Term Remaining: [X.X years]\n' +
    '  - Annual Rent: [$X,XXX,XXX]\n' +
    '  - Cap Rate: [X.XX%]\n\n' +
    'Happy to walk through the offering memorandum if helpful.' +
    _sig()
  );
}

function openMktMeetingReq(email, name, deal) {
  const first = name.split(' ')[0] || 'there';
  _composeOutlook(email,
    'Meeting Request \u2014 ' + deal,
    'Hi ' + first + ',\n\n' +
    'I would appreciate the opportunity to meet briefly to discuss ' + deal + ' and how Northmarq can be a resource for your capital markets needs.\n\n' +
    'Would any of the following times work for a 15-minute call?\n\n' +
    '  - [Day, Time]\n  - [Day, Time]\n  - [Day, Time]\n\n' +
    'Alternatively, feel free to suggest a time that works best for you.' +
    _sig()
  );
}

// ── Call history ──
// ── Expandable contact detail — shows deal associations + call history ──
async function toggleContactDetail(contactId) {
  const el = document.getElementById('contact-detail-' + contactId);
  if (!el) return;
  if (el.style.display !== 'none' && el.dataset.loaded) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  if (el.dataset.loaded) return; // already loaded, just re-show

  try {
    // Fetch all activities for this contact (deals they're associated with + call history)
    const activities = await diaQuery('salesforce_activities', 'subject,nm_type,task_subtype,status,activity_date,nm_notes,assigned_to', {
      filter: 'sf_contact_id=eq.' + contactId,
      order: 'activity_date.desc.nullslast',
      limit: 50
    });

    let h = '';

    // Section 1: Deal associations (Opportunity records)
    const deals = [];
    const seen = new Set();
    (activities || []).forEach(function(a) {
      if (a.nm_type === 'Opportunity' && !seen.has(a.subject)) {
        seen.add(a.subject);
        deals.push(a);
      }
    });
    if (deals.length) {
      h += '<div style="margin-bottom:8px"><div style="font-weight:600;color:var(--text);margin-bottom:4px">Associated Deals (' + deals.length + ')</div>';
      deals.forEach(function(d) {
        var statusColor = d.status === 'Completed' ? 'var(--green)' : d.status === 'Abandoned' ? 'var(--text3)' : 'var(--accent)';
        h += '<div style="padding:3px 0;display:flex;justify-content:space-between">';
        h += '<span>' + esc(d.subject) + '</span>';
        h += '<span style="color:' + statusColor + ';font-size:11px">' + esc(d.status || '—') + '</span>';
        h += '</div>';
      });
      h += '</div>';
    } else {
      h += '<div style="margin-bottom:8px;color:var(--text3)">No deal associations found</div>';
    }

    // Section 2: Call / activity history (non-Opportunity completed activities)
    const history = (activities || []).filter(function(a) {
      return a.status === 'Completed' || (a.nm_type !== 'Opportunity');
    });
    const callHistory = history.filter(function(a) { return a.status === 'Completed'; });
    if (callHistory.length) {
      h += '<div style="margin-bottom:4px"><div style="font-weight:600;color:var(--text);margin-bottom:4px">Call History (' + callHistory.length + ')</div>';
      callHistory.slice(0, 15).forEach(function(r) {
        var type = r.nm_type || r.subject || r.task_subtype || '—';
        h += '<div style="padding:3px 0;border-bottom:1px solid var(--border)">';
        h += '<span style="color:var(--accent);font-weight:500">' + esc(r.activity_date || '—') + '</span>';
        h += ' · <span>' + esc(type) + '</span>';
        if (r.nm_notes) h += '<div style="color:var(--text3);margin-top:1px;font-size:11px">' + esc(r.nm_notes) + '</div>';
        h += '</div>';
      });
      if (callHistory.length > 15) h += '<div style="color:var(--text3);padding:4px 0">+ ' + (callHistory.length - 15) + ' more...</div>';
      h += '</div>';
    } else {
      h += '<div style="color:var(--text3)">No call history found</div>';
    }

    el.innerHTML = h;
    el.dataset.loaded = '1';
  } catch (e) {
    el.innerHTML = '<span style="color:var(--red)">Error loading details: ' + esc(e.message) + '</span>';
  }
}

async function toggleCallHistory(sfContactId, contactName, btn) {
  const el = document.getElementById('callhist-' + sfContactId);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> Loading call history...';

  if (mktCallHistoryCache[sfContactId]) {
    renderCallHistory(el, mktCallHistoryCache[sfContactId], contactName);
    return;
  }

  try {
    const history = await diaQuery('salesforce_activities', 'subject,nm_type,task_subtype,activity_date,nm_notes,status', {
      filter: `sf_contact_id=eq.${sfContactId},status=eq.Completed`,
      order: 'activity_date.desc.nullslast',
      limit: 25
    });
    mktCallHistoryCache[sfContactId] = history || [];
    renderCallHistory(el, mktCallHistoryCache[sfContactId], contactName);
  } catch (e) {
    el.innerHTML = '<span style="color:var(--red)">Error loading history</span>';
  }
}

function renderCallHistory(el, history, contactName) {
  if (!history.length) {
    el.innerHTML = '<div style="padding:4px 0;color:var(--text3)">No completed activities found for ' + esc(contactName) + '</div>';
    return;
  }
  let h = '<div style="font-weight:600;margin-bottom:4px;color:var(--text)">Activity History — ' + esc(contactName) + ' (' + history.length + ')</div>';
  history.forEach(r => {
    const type = r.nm_type || r.subject || r.task_subtype || '—';
    const date = r.activity_date || '—';
    const notes = r.nm_notes || '';
    h += `<div style="padding:3px 0;border-bottom:1px solid var(--border)">`;
    h += `<span style="color:var(--accent);font-weight:500">${esc(date)}</span> · <span>${esc(type)}</span>`;
    if (notes) h += `<div style="color:var(--text3);margin-top:1px;font-size:11px">${esc(notes)}</div>`;
    h += '</div>';
  });
  el.innerHTML = h;
}

// ── Reassign deal ──
async function mktReassignDeal(activityId, newOwner, sfContactId) {
  if (!newOwner) return;
  showToast('Reassigning to ' + newOwner + '...', 'success');
  try {
    // Update in Supabase — this will need a SF sync to push back
    const res = await diaQuery('salesforce_activities', '*', {
      method: 'PATCH',
      filter: `activity_id=eq.${activityId}`,
      body: { assigned_to: newOwner }
    });
    // Update local data across all stores
    mktData.forEach(d => { if (d.item_id === activityId) d.assigned_to = newOwner; });
    ['government', 'dialysis', 'all_other'].forEach(dom => {
      (window._mktOpportunities[dom] || []).forEach(d => { if (d.item_id === activityId) d.assigned_to = newOwner; });
    });
    showToast('Reassigned to ' + newOwner, 'success');
    renderMarketing();
  } catch (e) {
    showToast('Error reassigning: ' + e.message, 'error');
  }
}

// ── Task management: complete, reschedule, dismiss ──
async function completeTask(sfContactId, subject) {
  showToast('Marking task complete...', 'success');
  try {
    const url = new URL('/api/dia-query', window.location.origin);
    url.searchParams.set('table', 'salesforce_activities');
    url.searchParams.set('filter', 'sf_contact_id=eq.' + sfContactId);
    url.searchParams.set('filter2', 'subject=eq.' + subject);
    await fetch(url.toString(), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Completed' })
    });
    showToast('Task completed!', 'success');
    // Remove from local data and re-render
    mktData = mktData.filter(function(d) { return !(d.sf_contact_id === sfContactId && d.open_tasks && d.open_tasks.length <= 1); });
    mktData.forEach(function(d) {
      if (d.sf_contact_id === sfContactId && d.open_tasks) {
        d.open_tasks = d.open_tasks.filter(function(t) { return t.subject !== subject; });
        d.open_task_count = d.open_tasks.length;
        d.completed_activity_count = (d.completed_activity_count || 0) + 1;
      }
    });
    renderMarketing();
  } catch (e) {
    showToast('Error completing task: ' + e.message, 'error');
  }
}

async function rescheduleTask(sfContactId, subject, newDate) {
  if (!newDate) return;
  showToast('Rescheduling to ' + newDate + '...', 'success');
  try {
    const url = new URL('/api/dia-query', window.location.origin);
    url.searchParams.set('table', 'salesforce_activities');
    url.searchParams.set('filter', 'sf_contact_id=eq.' + sfContactId);
    url.searchParams.set('filter2', 'subject=eq.' + subject);
    await fetch(url.toString(), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity_date: newDate })
    });
    showToast('Rescheduled to ' + newDate, 'success');
    // Update local data
    mktData.forEach(function(d) {
      if (d.sf_contact_id === sfContactId && d.open_tasks) {
        d.open_tasks.forEach(function(t) { if (t.subject === subject) t.date = newDate; });
        d.due_date = newDate;
      }
    });
    renderMarketing();
  } catch (e) {
    showToast('Error rescheduling: ' + e.message, 'error');
  }
}

async function dismissTask(sfContactId, subject) {
  if (!confirm('Dismiss "' + subject + '"? This will mark it as Abandoned.')) return;
  showToast('Dismissing task...', 'success');
  try {
    const url = new URL('/api/dia-query', window.location.origin);
    url.searchParams.set('table', 'salesforce_activities');
    url.searchParams.set('filter', 'sf_contact_id=eq.' + sfContactId);
    url.searchParams.set('filter2', 'subject=eq.' + subject);
    await fetch(url.toString(), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Abandoned' })
    });
    showToast('Task dismissed', 'success');
    // Remove from local data
    mktData.forEach(function(d) {
      if (d.sf_contact_id === sfContactId && d.open_tasks) {
        d.open_tasks = d.open_tasks.filter(function(t) { return t.subject !== subject; });
        d.open_task_count = d.open_tasks.length;
      }
    });
    // Remove contacts with no remaining tasks
    mktData = mktData.filter(function(d) { return !d.open_tasks || d.open_tasks.length > 0 || d.completed_activity_count > 0; });
    renderMarketing();
  } catch (e) {
    showToast('Error dismissing task: ' + e.message, 'error');
  }
}

// ── Reclassify deal domain ──
async function mktReclassifyDeal(activityId, newDomain) {
  if (!activityId || !newDomain) return;
  showToast('Reclassifying deal to ' + newDomain + '...', 'success');
  try {
    await diaQuery('salesforce_activities', '*', {
      method: 'PATCH',
      filter: `activity_id=eq.${activityId}`,
      body: { prospect_domain: newDomain }
    });
    // Move item between domain buckets locally
    let movedItem = null;
    ['government', 'dialysis', 'all_other'].forEach(dom => {
      const idx = window._mktOpportunities[dom].findIndex(d => d.item_id === activityId);
      if (idx !== -1) {
        movedItem = window._mktOpportunities[dom].splice(idx, 1)[0];
      }
    });
    if (movedItem) {
      movedItem.domain = newDomain;
      movedItem.prospect_domain = newDomain;
      window._mktOpportunities[newDomain].push(movedItem);
    }
    showToast('Deal moved to ' + newDomain, 'success');
    // Re-render whichever view is active
    if (currentBizTab === 'dialysis' && currentDiaTab === 'prospects') {
      renderDomainProspects('dialysis');
    } else if (currentBizTab === 'government' && currentGovTab === 'pipeline') {
      renderGovTab();
    } else if (currentBizTab === 'other') {
      renderDomainProspects('all_other');
    } else {
      renderMarketing();
    }
  } catch (e) {
    showToast('Error reclassifying: ' + e.message, 'error');
  }
}

/** Trigger SF matching for an inbound lead */
async function mktMatchLead(leadId) {
  showToast('Matching against Salesforce...', 'success');
  try {
    const url = new URL('/api/dia-query', window.location.origin);
    url.searchParams.set('table', 'rpc/match_marketing_lead_to_sf');
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_lead_id: leadId })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Match RPC error:', res.status, errText);
      showToast('Error calling match function — ' + res.status, 'error');
      return;
    }
    const raw = await res.json();
    // Proxy returns array directly for RPC; handle both formats for safety
    const rows = Array.isArray(raw) ? raw : (raw.data || []);
    if (rows.length > 0 && rows[0]) {
      const m = rows[0];
      if (m.match_method === 'no_match') {
        showToast('No SF match found — flagged for manual review', 'error');
      } else {
        showToast(`Matched via ${m.match_method}!`, 'success');
      }
    } else {
      showToast('Match completed — no result returned', 'success');
    }
    // Refresh data
    mktLoaded = false;
    loadMarketing();
  } catch (e) {
    console.error('Match error:', e);
    showToast('Error matching lead: ' + e.message, 'error');
  }
}

/** Update lead status (contacted, qualified, etc.) */
async function mktUpdateStatus(leadId, newStatus) {
  try {
    const url = new URL('/api/dia-query', window.location.origin);
    url.searchParams.set('table', 'marketing_leads');
    url.searchParams.set('filter', `lead_id=eq.${leadId}`);
    const res = await fetch(url.toString(), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('mktUpdateStatus error:', res.status, errText);
      showToast('Error updating status — server returned ' + res.status, 'error');
      return;
    }
    // Update local cache
    const item = mktData.find(d => d.item_id === leadId);
    if (item) item.status = newStatus;
    showToast(`Status updated to "${newStatus}"`, 'success');
    renderMarketing();
  } catch (e) {
    showToast('Error updating status', 'error');
  }
}

/** Open email template for a marketing deal contact */
// Open email in Outlook desktop via mailto (Outlook intercepts when set as default mail client)
function _composeOutlook(email, subjectText, bodyText) {
  const subject = encodeURIComponent(subjectText);
  const body = encodeURIComponent(bodyText);
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
}

function _sig() {
  const user = LCC_USER.display_name || 'Scott Briggs';
  return '\n\nBest regards,\n' + user + '\nSenior Vice President\nNorthmarq Investment Sales\n(612) 555-0100';
}

function openMktEmail(email, contactName, dealName) {
  const first = contactName.split(' ')[0] || 'there';
  const user = LCC_USER.display_name || 'Scott Briggs';
  _composeOutlook(email,
    'Northmarq Investment Sales \u2014 ' + dealName,
    'Hi ' + first + ',\n\n' +
    'I hope this message finds you well. My name is ' + user + ', and I am a Senior Vice President with Northmarq Investment Sales.\n\n' +
    'I am reaching out regarding ' + dealName + '. Our team has been actively working in this market and I wanted to introduce myself as a resource for any future capital markets needs you may have.\n\n' +
    'I would welcome the opportunity to share some recent market activity and comparable transactions that may be relevant to your portfolio. Would you have a few minutes for a brief call this week?' +
    _sig()
  );
}

// ============================================================
// PROSPECTS — Cross-Project CRM Lookup
// ============================================================

let prospectsSearchTerm = '';
let prospectsResults = null;
let prospectsSearching = false;

function renderProspects() {
  let html = '<div class="biz-section">';
  html += '<div class="search-bar">';
  html += '<input type="text" id="prospectsSearchInput" placeholder="Search across all projects — name, phone, LLC, address, entity, operator..." value="' + esc(prospectsSearchTerm) + '" />';
  html += '<button onclick="execProspectsSearch()">Search</button>';
  html += '</div>';

  if (prospectsSearching) {
    html += '<div class="search-loading">Searching across Government + Dialysis databases...</div>';
  } else if (prospectsResults === null) {
    html += '<div class="search-empty">';
    html += '<div class="search-empty-icon">&#128101;</div>';
    html += '<p>Cross-project CRM lookup — search ownership records, leads, contacts, clinics, and research outcomes across both Government and Dialysis</p>';
    html += '</div>';
  } else {
    const sections = prospectsResults;
    let total = 0;
    sections.forEach(s => total += s.items.length);

    if (total === 0) {
      html += '<div class="search-empty"><p>No results found for "' + esc(prospectsSearchTerm) + '"</p></div>';
    } else {
      html += '<div style="color: var(--text2); font-size: 13px; margin-bottom: 16px;">' + total + ' result' + (total !== 1 ? 's' : '') + ' across all projects</div>';

      sections.forEach(section => {
        if (section.items.length === 0) return;
        html += '<div class="search-results-section"><h4>' + esc(section.title) + ' (' + section.items.length + ')</h4>';
        section.items.forEach(r => {
          const clickAttr = r._source ? ' onclick=\'showDetail(' + safeJSON(r) + ', "' + r._source + '")\'' : '';
          html += '<div class="search-card"' + clickAttr + '>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(r._title || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: ' + r._badgeBg + '; color: ' + r._badgeColor + ';">' + esc(r._badge) + '</span></div>';
          html += '<div class="search-card-meta">';
          (r._meta || []).forEach(m => { html += '<span>' + esc(m) + '</span>'; });
          html += '</div></div>';
        });
        html += '</div>';
      });
    }
  }

  html += '</div>';
  return html;
}

function initProspectsSearch() {
  const input = document.getElementById('prospectsSearchInput');
  if (input) {
    input.addEventListener('keydown', e => { if (e.key === 'Enter') execProspectsSearch(); });
    input.focus();
  }
}

async function execProspectsSearch() {
  const input = document.getElementById('prospectsSearchInput');
  if (!input) return;
  const term = input.value.trim();
  if (!term) return;

  prospectsSearchTerm = term;
  prospectsSearching = true;
  const el = document.getElementById('bizPageInner');
  if (el) el.innerHTML = renderProspects();

  const like = '*' + term + '*';
  const sections = [];

  try {
    // Resilient query helper — returns empty on error so one bad query doesn't kill the whole search
    const safeQuery = async (fn, ...args) => { try { return await fn(...args); } catch (e) { console.warn('Prospects search query failed:', e); return { data: [] }; } };

    // Gov queries (only if connected)
    let govLeads = [], govOwnership = [], govContacts = [], govListings = [];
    if (govConnected) {
      const [gl, go, gc, gli] = await Promise.all([
        safeQuery(govQuery, 'prospect_leads', '*', { filter: 'or=(address.ilike.' + like + ',city.ilike.' + like + ',tenant_agency.ilike.' + like + ',lessor_name.ilike.' + like + ',recorded_owner.ilike.' + like + ')', limit: 15 }),
        safeQuery(govQuery, 'ownership_history', '*', { filter: 'or=(address.ilike.' + like + ',city.ilike.' + like + ',state.ilike.' + like + ',new_owner.ilike.' + like + ',recorded_owner_name.ilike.' + like + ',prior_owner.ilike.' + like + ')', limit: 15 }),
        safeQuery(govQuery, 'contacts', '*', { filter: 'or=(name.ilike.' + like + ',contact_type.ilike.' + like + ',phone.ilike.' + like + ',email.ilike.' + like + ')', limit: 15 }),
        safeQuery(govQuery, 'available_listings', '*', { filter: 'or=(address.ilike.' + like + ',city.ilike.' + like + ',tenant_agency.ilike.' + like + ')', limit: 15 })
      ]);
      govLeads = (gl.data || []).map(r => ({ ...r, _title: norm(r.address) || norm(r.tenant_agency) || '—', _badge: 'Gov Lead', _badgeBg: 'rgba(52,211,153,0.15)', _badgeColor: '#34d399', _source: 'gov-lead', _meta: [r.city && r.state ? norm(r.city) + ', ' + r.state : '', r.tenant_agency ? 'Tenant: ' + norm(r.tenant_agency) : '', r.lessor_name ? 'Owner: ' + norm(r.lessor_name) : '', r.recorded_owner ? 'Recorded: ' + norm(r.recorded_owner) : '', r.pipeline_stage ? cleanLabel(r.pipeline_stage) : ''].filter(Boolean) }));
      govOwnership = (go.data || []).map(r => ({ ...r, _title: norm(r.address) || r.lease_number || '—', _badge: 'Gov Ownership', _badgeBg: 'rgba(108,140,255,0.15)', _badgeColor: '#6c8cff', _source: 'gov-ownership', _meta: [r.city && r.state ? norm(r.city) + ', ' + r.state : '', r.prior_owner ? 'From: ' + norm(r.prior_owner) : '', r.new_owner ? 'To: ' + norm(r.new_owner) : '', r.estimated_value ? 'Value: ' + fmt(r.estimated_value) : ''].filter(Boolean) }));
      govContacts = (gc.data || []).map(r => ({ ...r, _title: norm(r.name) || norm(r.contact_type) || '—', _badge: 'Gov Contact', _badgeBg: 'rgba(167,139,250,0.15)', _badgeColor: '#a78bfa', _source: 'gov-contact', _meta: [norm(r.contact_type) || '', r.phone || '', r.email || '', r.total_volume ? 'Vol: ' + fmt(r.total_volume) : ''].filter(Boolean) }));
      govListings = (gli.data || []).map(r => ({ ...r, _title: norm(r.address) || norm(r.tenant_agency) || '—', _badge: 'Gov Listing', _badgeBg: 'rgba(251,191,36,0.15)', _badgeColor: '#fbbf24', _source: 'gov-listing', _meta: [r.city && r.state ? norm(r.city) + ', ' + r.state : '', r.tenant_agency ? 'Tenant: ' + norm(r.tenant_agency) : '', r.asking_price ? 'Asking: ' + fmt(r.asking_price) : ''].filter(Boolean) }));
    }

    // Dia queries (only if connected)
    let diaClinics = [], diaNpi = [];
    if (diaConnected) {
      const [dc, dn] = await Promise.all([
        safeQuery(diaQuery, 'v_clinic_inventory_latest_diff', '*', { filter: 'or=(facility_name.ilike.' + like + ',city.ilike.' + like + ',state.ilike.' + like + ',operator_name.ilike.' + like + ',address.ilike.' + like + ')', limit: 20 }),
        safeQuery(diaQuery, 'v_npi_inventory_signals', '*', { filter: 'or=(facility_name.ilike.' + like + ',city.ilike.' + like + ',npi.ilike.' + like + ')', limit: 15 })
      ]);
      diaClinics = (dc || []).map(r => ({ ...r, _title: norm(r.facility_name) || '—', _badge: 'Dia Clinic', _badgeBg: 'rgba(167,139,250,0.15)', _badgeColor: '#a78bfa', _source: 'dia-clinic', _meta: [r.city && r.state ? norm(r.city) + ', ' + r.state : '', r.ccn ? 'CCN: ' + r.ccn : '', r.operator_name ? 'Op: ' + norm(r.operator_name) : '', r.latest_total_patients ? 'Patients: ' + r.latest_total_patients : ''].filter(Boolean) }));
      diaNpi = (dn || []).map(r => ({ ...r, _title: norm(r.facility_name) || r.npi || '—', _badge: 'NPI Signal', _badgeBg: 'rgba(248,113,113,0.15)', _badgeColor: '#f87171', _source: 'dia-clinic', _meta: [r.city && r.state ? norm(r.city) + ', ' + r.state : '', r.signal_type ? cleanLabel(r.signal_type) : '', r.npi ? 'NPI: ' + r.npi : ''].filter(Boolean) }));
    }

    if (govLeads.length) sections.push({ title: 'Government — Prospect Leads', items: govLeads });
    if (govOwnership.length) sections.push({ title: 'Government — Ownership Records', items: govOwnership });
    if (govListings.length) sections.push({ title: 'Government — Listings', items: govListings });
    if (govContacts.length) sections.push({ title: 'Government — Contacts', items: govContacts });
    if (diaClinics.length) sections.push({ title: 'Dialysis — Clinics', items: diaClinics });
    if (diaNpi.length) sections.push({ title: 'Dialysis — NPI Signals', items: diaNpi });

    prospectsResults = sections;
  } catch (err) {
    console.error('Prospects search error:', err);
    prospectsResults = [];
  }

  prospectsSearching = false;
  if (el) el.innerHTML = renderProspects();
  initProspectsSearch();
}

// ============================================================
// DETAIL PANEL (Tabbed Architecture)
// ============================================================

// Global state for detail panel
window._detailRecord = null;
window._detailSource = null;
window._detailTab = 'Overview';

function showDetail(record, source = 'activity') {
  // Route gov/dia property sources to unified detail page
  if (source === 'gov-ownership' || source === 'gov-lead' || source === 'gov-listing' ||
      source === 'dia-clinic') {
    if (typeof showUnifiedDetail === 'function') {
      showUnifiedDetail(record, source);
      return;
    }
  }
  // Gov contacts get a simple detail panel (no unified detail needed)
  if (source === 'gov-contact') {
    // Falls through to the standard detail panel below
  }

  window._detailRecord = record;
  window._detailSource = source;
  window._detailTab = 'Overview';

  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');

  // Render header
  const header = renderDetailHeader(record, source);
  document.getElementById('detailHeader').innerHTML = header;

  // Render tabs
  const tabs = renderDetailTabs(source);
  document.getElementById('detailTabs').innerHTML = tabs;

  // Render initial body
  const body = renderDetailBody(record, source, window._detailTab);
  document.getElementById('detailBody').innerHTML = body;

  panel.style.display = 'block';
  overlay.classList.add('open');
}

function closeDetail() {
  window._detailRecord = null;
  window._detailSource = null;
  window._detailTab = null;
  
  document.getElementById('detailPanel').style.display = 'none';
  document.getElementById('detailOverlay').classList.remove('open');
  document.getElementById('detailHeader').innerHTML = '';
  document.getElementById('detailTabs').innerHTML = '';
  document.getElementById('detailBody').innerHTML = '';
}

function switchDetailTab(tabName) {
  if(!window._detailRecord || !window._detailSource) return;
  
  window._detailTab = tabName;
  
  // Update active tab highlight
  const tabs = document.querySelectorAll('.detail-tab');
  tabs.forEach(t => {
    t.classList.toggle('active', t.textContent.trim() === tabName);
  });
  
  // Render new body content
  const body = renderDetailBody(window._detailRecord, window._detailSource, tabName);
  document.getElementById('detailBody').innerHTML = body;
}

function renderDetailHeader(record, source) {
  let title = '';
  let subtitle = '';
  let badge = '';
  
  if(source === 'activity') {
    title = esc(record.subject || '(No subject)');
    subtitle = esc(record.computed_category || 'Activity');
    badge = 'Activity';
  } else if(source === 'gov-ownership') {
    title = esc(record.address || record.lease_number || '(No address)');
    subtitle = `${esc(record.city || '')}${record.city && record.state ? ', ' : ''}${esc(record.state || '')} · Ownership Transfer`;
    badge = 'GOV';
  } else if(source === 'gov-lead') {
    title = esc(record.lessor_name || record.address || record.lease_number || '(No name)');
    subtitle = `${esc(record.city || '')}${record.city && record.state ? ', ' : ''}${esc(record.state || '')} · Lead`;
    badge = 'LEAD';
  } else if(source === 'gov-listing') {
    title = esc(record.address || '(No address)');
    subtitle = `${esc(record.city || '')}${record.state ? ', ' + esc(record.state) : ''} · Listing`;
    badge = 'LISTING';
  } else if(source === 'gov-contact') {
    title = esc(record.name || record.contact_name || '(No name)');
    subtitle = esc(record.contact_type || 'Contact');
    badge = 'CONTACT';
  } else if(source === 'dia-clinic') {
    title = esc(record.facility_name || '(No name)');
    subtitle = `${esc(record.city || '')}${record.city && record.state ? ', ' : ''}${esc(record.state || '')} · ${esc(record.operator_name || 'Clinic')}`;
    badge = 'DIA';
  }
  
  // Build key-fields bar showing Tenant, Address, City, State
  let keyFields = '';
  if (source.startsWith('gov')) {
    const tenant = record.tenant_agency || record.agency_full_name || '';
    const addr = record.address || '';
    const loc = (record.city || '') + (record.city && record.state ? ', ' : '') + (record.state || '');
    const lease = record.lease_number || '';
    const lessor = record.lessor_name || record.prior_owner || record.new_owner || '';
    keyFields = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-top:8px;font-size:12px;">';
    if (addr) keyFields += `<div><span style="color:var(--text3)">Address:</span> <span style="color:var(--text)">${esc(addr)}</span></div>`;
    if (loc.trim()) keyFields += `<div><span style="color:var(--text3)">Location:</span> <span style="color:var(--text)">${esc(loc)}</span></div>`;
    if (tenant) keyFields += `<div><span style="color:var(--text3)">Tenant:</span> <span style="color:var(--text)">${esc(tenant)}</span></div>`;
    if (lease) keyFields += `<div><span style="color:var(--text3)">Lease:</span> <span style="color:var(--text);font-family:monospace">${esc(lease)}</span></div>`;
    if (lessor) keyFields += `<div><span style="color:var(--text3)">Lessor:</span> <span style="color:var(--text)">${esc(lessor)}</span></div>`;
    keyFields += '</div>';
  } else if (source === 'gov-contact') {
    const contactType = record.contact_type || '';
    const phone = record.phone || '';
    const email = record.email || '';
    const volume = record.total_volume;
    keyFields = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-top:8px;font-size:12px;">';
    if (contactType) keyFields += `<div><span style="color:var(--text3)">Type:</span> <span style="color:var(--text)">${esc(contactType)}</span></div>`;
    if (volume) keyFields += `<div><span style="color:var(--text3)">Volume:</span> <span style="color:var(--accent);font-weight:600">${fmt(volume)}</span></div>`;
    if (phone) keyFields += `<div><span style="color:var(--text3)">Phone:</span> <a href="tel:${esc(phone)}" style="color:var(--accent)">${esc(phone)}</a></div>`;
    if (email) keyFields += `<div><span style="color:var(--text3)">Email:</span> <a href="mailto:${esc(email)}" style="color:var(--accent)">${esc(email)}</a></div>`;
    keyFields += '</div>';
  } else if (source === 'dia-clinic') {
    const ccn = record.ccn || '';
    const npi = record.npi || '';
    const loc = (record.city || '') + (record.city && record.state ? ', ' : '') + (record.state || '');
    const op = record.operator_name || '';
    const patients = record.latest_total_patients;
    keyFields = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-top:8px;font-size:12px;">';
    if (loc.trim()) keyFields += `<div><span style="color:var(--text3)">Location:</span> <span style="color:var(--text)">${esc(loc)}</span></div>`;
    if (op) keyFields += `<div><span style="color:var(--text3)">Operator:</span> <span style="color:var(--text)">${esc(op)}</span></div>`;
    if (ccn) keyFields += `<div><span style="color:var(--text3)">CCN:</span> <span style="color:var(--text);font-family:monospace">${esc(ccn)}</span></div>`;
    if (npi) keyFields += `<div><span style="color:var(--text3)">NPI:</span> <span style="color:var(--text);font-family:monospace">${esc(npi)}</span></div>`;
    if (patients !== undefined && patients !== null) keyFields += `<div><span style="color:var(--text3)">Patients:</span> <span style="color:var(--accent);font-weight:600">${fmtN(patients)}</span></div>`;
    keyFields += '</div>';
  } else if (source === 'activity') {
    const company = record.company_name || '';
    const loc = record.company_city_state || record.company_address || '';
    const contact = record.contact_name || '';
    keyFields = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-top:8px;font-size:12px;">';
    if (company) keyFields += `<div><span style="color:var(--text3)">Company:</span> <span style="color:var(--text)">${esc(company)}</span></div>`;
    if (loc) keyFields += `<div><span style="color:var(--text3)">Location:</span> <span style="color:var(--text)">${esc(loc)}</span></div>`;
    if (contact) keyFields += `<div><span style="color:var(--text3)">Contact:</span> <span style="color:var(--text)">${esc(contact)}</span></div>`;
    keyFields += '</div>';
  }

  return `
    <button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>
    <div class="detail-header-info">
      <div style="flex: 1; min-width: 0;">
        <div class="detail-title">${title}</div>
        <div class="detail-subtitle">${subtitle}</div>
        ${keyFields}
      </div>
      ${badge ? `<span class="detail-badge" style="background:${
        source === 'activity' ? 'var(--accent2)' :
        source.startsWith('gov') ? 'var(--gov-green)' :
        source.startsWith('dia') ? 'var(--purple)' : 'var(--s3)'
      };color:#fff">${esc(badge)}</span>` : ''}
    </div>
    <button class="detail-close" onclick="closeDetail()">&times;</button>
  `;
}

function renderDetailTabs(source) {
  const tabConfigs = {
    'activity': ['Details'],
    'gov-ownership': ['Overview', 'Lease', 'Ownership', 'Activity'],
    'gov-lead': ['Overview', 'Property', 'Pipeline', 'Contacts', 'Activity'],
    'gov-listing': ['Overview', 'Property', 'Market', 'Activity'],
    'gov-contact': ['Details'],
    'dia-clinic': ['Overview', 'Property', 'Ownership', 'Signals', 'Research', 'Activity']
  };
  
  const tabs = tabConfigs[source] || ['Details'];
  const currentTab = window._detailTab || tabs[0];
  
  let html = '';
  tabs.forEach(tab => {
    const isActive = tab === currentTab ? 'active' : '';
    html += `<button class="detail-tab ${isActive}" onclick="switchDetailTab('${esc(tab)}')">${esc(tab)}</button>`;
  });
  
  return html;
}

function renderDetailBody(record, source, tab) {
  if(source === 'activity') {
    return renderActivityDetailBody(record, tab);
  } else if(source === 'gov-contact') {
    return renderGovContactDetailBody(record);
  } else if(source === 'gov-ownership' || source === 'gov-lead' || source === 'gov-listing') {
    return renderGovDetailBody(record, source, tab);
  } else if(source === 'dia-clinic') {
    return renderDiaDetailBody(record, tab);
  }
  return '<div class="detail-empty">Unknown source type</div>';
}

function renderGovContactDetailBody(record) {
  let html = '<div style="padding:16px">';
  html += '<div style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text)">Contact Details</div>';
  const fields = [
    ['Name', record.name || record.contact_name],
    ['Type', record.contact_type],
    ['Total Volume', record.total_volume ? fmt(record.total_volume) : null],
    ['Phone', record.phone],
    ['Email', record.email],
    ['Notes', record.notes]
  ];
  html += '<div style="display:grid;grid-template-columns:120px 1fr;gap:8px;font-size:13px">';
  for (const [label, val] of fields) {
    if (!val) continue;
    let display = esc(val);
    if (label === 'Phone') display = `<a href="tel:${esc(val)}" style="color:var(--accent)">${esc(val)}</a>`;
    if (label === 'Email') display = `<a href="mailto:${esc(val)}" style="color:var(--accent)">${esc(val)}</a>`;
    html += `<div style="color:var(--text3);font-weight:500">${label}</div><div style="color:var(--text)">${display}</div>`;
  }
  html += '</div>';
  // Action buttons
  html += '<div style="display:flex;gap:8px;margin-top:20px">';
  if (record.phone) html += `<a href="tel:${esc(record.phone)}" class="act-btn primary" style="text-decoration:none;font-size:13px;padding:8px 16px">&#x260E; Call</a>`;
  if (record.email) html += `<a href="mailto:${esc(record.email)}" class="act-btn" style="text-decoration:none;font-size:13px;padding:8px 16px">&#x2709; Email</a>`;
  html += '</div>';
  html += '</div>';
  return html;
}

function renderActivityDetailBody(record) {
  let html = '<div class="detail-section">';
  
  if(record.subject) html += `<div class="detail-row"><span class="detail-lbl">Subject:</span> <span class="detail-val">${esc(record.subject)}</span></div>`;
  if(record.computed_category) html += `<div class="detail-row"><span class="detail-lbl">Category:</span> <span class="detail-val"><span class="act-cat ${catClass(record.computed_category)}" style="font-size:13px;padding:4px 12px">${esc(record.computed_category)}</span></span></div>`;
  if(record.company_name) html += `<div class="detail-row"><span class="detail-lbl">Company:</span> <span class="detail-val">${esc(record.company_name)}</span></div>`;
  const locVal = record.company_city_state || (record.company_address && record.company_address !== '0' ? record.company_address : '');
  if(locVal) html += `<div class="detail-row"><span class="detail-lbl">Location:</span> <span class="detail-val">${esc(locVal)}</span></div>`;
  if(record.contact_name) html += `<div class="detail-row"><span class="detail-lbl">Contact:</span> <span class="detail-val">${esc(record.contact_name)}</span></div>`;
  if(record.email) html += `<div class="detail-row"><span class="detail-lbl">Email:</span> <span class="detail-val"><a href="mailto:${esc(record.email)}">${esc(record.email)}</a></span></div>`;
  if(record.phone) html += `<div class="detail-row"><span class="detail-lbl">Phone:</span> <span class="detail-val"><a href="tel:${esc(record.phone)}">${esc(record.phone)}</a></span></div>`;
  if(record.activity_date) html += `<div class="detail-row"><span class="detail-lbl">Date:</span> <span class="detail-val">${esc(record.activity_date)}</span></div>`;
  if(record.status) html += `<div class="detail-row"><span class="detail-lbl">Status:</span> <span class="detail-val">${esc(record.status)}</span></div>`;
  if(record.nm_type || record.task_subtype) html += `<div class="detail-row"><span class="detail-lbl">Type:</span> <span class="detail-val">${esc(record.nm_type || record.task_subtype)}</span></div>`;
  
  if(record.nm_notes) {
    html += `<div class="detail-notes"><strong>Notes:</strong><br>${esc(record.nm_notes)}</div>`;
  }
  
  html += '<div class="detail-actions">';
  html += `<button class="act-btn primary" onclick="closeDetail();openLogCall(${safeJSON({sf_contact_id:record.sf_contact_id||'',sf_company_id:record.sf_company_id||'',name:record.contact_name||record.company_name||''})})">&#x260E; Log Call</button>`;
  if(record.sf_link) html += `<a href="${record.sf_link}" target="_blank" class="act-btn">&#x2197; Salesforce</a>`;
  if(record.phone) html += `<a href="tel:${esc(record.phone)}" class="act-btn">&#x1F4DE; Call</a>`;
  if(record.email) html += `<a href="mailto:${esc(record.email)}" class="act-btn">&#x2709; Email</a>`;
  html += '</div>';
  
  html += '</div>';
  return html;
}

// ============================================================
// LOG CALL
// ============================================================
function openLogCall(data) {
  logCallData = data;
  document.getElementById('logCallDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('logCallNotes').value = '';
  document.getElementById('logCallContext').textContent = `Logging activity for: ${data.name || 'Unknown'}`;
  document.getElementById('logCallSubmit').disabled = false;
  document.getElementById('logCallSubmit').textContent = 'Log Activity';
  document.getElementById('logCallModal').classList.add('open');
}

function closeLogCall() {
  document.getElementById('logCallModal').classList.remove('open');
}

async function submitLogCall() {
  const btn = document.getElementById('logCallSubmit');
  btn.disabled = true; btn.textContent = 'Logging...';
  const payload = {
    sf_contact_id: logCallData.sf_contact_id || undefined,
    sf_company_id: logCallData.sf_company_id || undefined,
    activity_type: document.getElementById('logCallType').value,
    activity_date: document.getElementById('logCallDate').value,
    notes: document.getElementById('logCallNotes').value || undefined,
    force: true,
  };
  if (!payload.sf_contact_id && !payload.sf_company_id) {
    showToast('No SF contact or company ID available for this activity.', 'error');
    btn.disabled = false; btn.textContent = 'Log Activity';
    return;
  }
  try {
    const res = await fetch(`${API}/sync/log-to-sf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      showToast('Activity logged to Salesforce!', 'success');
      closeLogCall();
    } else if (data.warning) {
      showToast(`Warning: ${data.message || 'Recent activity detected'}`, 'error');
      btn.disabled = false; btn.textContent = 'Log Activity';
    } else {
      showToast(`Error: ${data.error || 'Unknown error'}`, 'error');
      btn.disabled = false; btn.textContent = 'Log Activity';
    }
  } catch (e) {
    showToast(`Network error: ${e.message}`, 'error');
    btn.disabled = false; btn.textContent = 'Log Activity';
  }
}

// ============================================================
// HOME PAGE DATA LOADING & RENDERING
// ============================================================

/**
 * Trigger canonical sync ingestion in background (non-blocking).
 * Falls back silently if ops DB not configured — existing edge function
 * data loading continues to work independently.
 */
function triggerCanonicalSync() {
  if (!LCC_USER._loaded) return;
  const headers = { 'Content-Type': 'application/json' };
  // Fire-and-forget — these populate the canonical model for Phase 4+ queue views
  fetch('/api/sync?action=ingest_emails', { method: 'POST', headers }).catch(() => {});
  fetch('/api/sync?action=ingest_calendar', { method: 'POST', headers }).catch(() => {});
  fetch('/api/sync?action=ingest_sf_activities', { method: 'POST', headers }).catch(() => {});
}

// ============================================================
// CANONICAL DATA LOADING — Today page integration
// Fetches work_counts, top my_work items, and inbox items from
// the canonical ops model. Falls back silently to legacy data
// when ops DB is not configured.
// ============================================================
async function loadCanonicalData() {
  if (!LCC_USER._loaded) { canonicalLoaded = true; return; }
  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;

  try {
    // Fire all three in parallel
    const [countsRes, workRes, inboxRes] = await Promise.allSettled([
      fetch('/api/queue-v2?view=work_counts', { headers }),
      fetch('/api/queue-v2?view=my_work&per_page=5&sort=due_date', { headers }),
      fetch('/api/queue-v2?view=inbox&per_page=6&status=new', { headers })
    ]);

    if (countsRes.status === 'fulfilled' && countsRes.value.ok) {
      canonicalCounts = await countsRes.value.json();
    }
    if (workRes.status === 'fulfilled' && workRes.value.ok) {
      canonicalMyWork = await workRes.value.json();
    }
    if (inboxRes.status === 'fulfilled' && inboxRes.value.ok) {
      canonicalInbox = await inboxRes.value.json();
    }
  } catch {
    // Ops DB not configured — canonical data stays null, legacy renders apply
  }

  canonicalLoaded = true;

  // Update widget titles when canonical data is active
  if (canonicalCounts || canonicalMyWork || canonicalInbox) {
    const ptTitle = document.getElementById('priorityTasksTitle');
    if (ptTitle && canonicalMyWork) ptTitle.textContent = 'My Work';
    const reTitle = document.getElementById('recentEmailsTitle');
    if (reTitle && canonicalInbox) reTitle.textContent = 'Inbox';
  }

  // Re-render Today page widgets with canonical data
  renderHomeStats();
  document.getElementById('priorityTasks').innerHTML = renderPriorityTasks();
  document.getElementById('recentEmails').innerHTML = renderRecentEmails();
  document.getElementById('categoryMetrics').innerHTML = renderCategoryMetrics();
  renderTeamPulse();
}

// ============================================================
// CANONICAL BRIDGE — call from legacy domain save functions
// to keep canonical model in sync with domain writes.
// Usage: canonicalBridge('log_activity', { title, domain, ... })
// ============================================================
function canonicalBridge(action, payload) {
  if (!LCC_USER._loaded) return Promise.resolve(null);
  return fetch(`/api/bridge?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.ok ? r.json() : null).catch(() => null);
}

let activitiesLoaded = false;
async function loadActivities() {
  try {
    const res = await fetch(`${API}/sync/sf-activities?limit=5000&sort_dir=desc&assigned_to=all`);
    if (!res.ok) { console.warn('Activities API returned', res.status); return; }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (_) { console.warn('Activities API returned non-JSON'); return; }
    const raw = data.activities || [];
    // Deduplicate — API returns ~2x duplicates
    const seen = new Set();
    activities = raw.filter(a => {
      const key = `${a.subject}|${a.contact_name||a.first_name}|${a.company_name}|${a.activity_date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    activitiesLoaded = true;
    console.log(`Activities: ${raw.length} raw → ${activities.length} unique`);
    updateBizBadges();
    renderHomeStats();
    document.getElementById('priorityTasks').innerHTML = renderPriorityTasks();
    document.getElementById('categoryMetrics').innerHTML = renderCategoryMetrics();
  } catch (e) {
    console.error('Activities load error:', e);
    activitiesLoaded = true;
    // Clear loading spinners even on error
    document.getElementById('categoryMetrics').innerHTML = renderCategoryMetrics();
    document.getElementById('priorityTasks').innerHTML = renderPriorityTasks();
  }
}

async function loadEmails() {
  try {
    const res = await fetch(`${API}/sync/flagged-emails?limit=500`);
    if (!res.ok) throw new Error('API returned ' + res.status);
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (_) { console.warn('Emails API returned non-JSON'); return; }
    emails = data.emails || [];
    emailTotalCount = data.total || emails.length;
    renderHomeStats();
    document.getElementById('recentEmails').innerHTML = renderRecentEmails();
  } catch (e) {
    console.error('Emails load error:', e);
    document.getElementById('recentEmails').innerHTML = '<div class="widget-error"><div class="err-msg">Unable to load emails</div><button class="retry-btn" onclick="loadEmails()">Retry</button></div>';
  }
}

async function loadCalendar() {
  try {
    const res = await fetch(`${API}/sync/calendar-events?days_back=1&days_forward=14&limit=200`);
    if (!res.ok) throw new Error('API returned ' + res.status);
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (_) { throw new Error('Calendar API returned non-JSON'); }
    calEvents = data.events || [];
    renderHomeStats();
    document.getElementById('todaySchedule').innerHTML = renderTodaySchedule();
  } catch (e) {
    console.error('Calendar load error:', e);
    document.getElementById('todaySchedule').innerHTML = '<div class="widget-error"><div class="err-msg">Unable to load schedule</div><button class="retry-btn" onclick="loadCalendar()">Retry</button></div>';
  }
}

async function loadHealth() {
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error(res.status);
    const text = await res.text();
    const data = JSON.parse(text);
    document.getElementById('statusDot').className = data.status === 'ok' ? 'dot' : 'dot offline';
  } catch (_) { document.getElementById('statusDot').className = 'dot offline'; }
}

async function loadWeather() {
  try {
    // Use saved location from settings, or default to Tulsa
    const savedLat = localStorage.getItem('lcc-weather-lat');
    const savedLon = localStorage.getItem('lcc-weather-lon');
    const savedCity = localStorage.getItem('lcc-weather-city');
    let lat = savedLat ? parseFloat(savedLat) : WEATHER_FALLBACK_LAT;
    let lon = savedLon ? parseFloat(savedLon) : WEATHER_FALLBACK_LON;
    let cityLabel = savedCity || WEATHER_FALLBACK_CITY;

    // Update widget title
    const titleEl = document.querySelector('#weatherWidget .widget-title');
    if (titleEl) titleEl.textContent = 'Weather — ' + cityLabel;

    const res = await fetch(buildWeatherUrl(lat, lon));
    if (!res.ok) throw new Error('API returned ' + res.status);
    const d = await res.json();
    const cur = d.current || {};
    const daily = d.daily || {};
    const temp = Math.round(cur.temperature_2m || 0);
    const hi = Math.round((daily.temperature_2m_max || [])[0] || 0);
    const lo = Math.round((daily.temperature_2m_min || [])[0] || 0);
    const hum = cur.relative_humidity_2m || 0;
    const wind = Math.round(cur.wind_speed_10m || 0);
    const code = cur.weather_code || 0;
    const desc = weatherDesc(code);
    const emoji = weatherEmoji(code);
    document.getElementById('wxTemp').textContent = `${temp}°F`;
    document.getElementById('wxDetails').innerHTML = `${emoji} ${desc}<br>High ${hi}° / Low ${lo}° · Humidity ${hum}% · Wind ${wind} mph`;
  } catch (e) {
    console.error('Weather load error:', e);
    document.getElementById('wxTemp').textContent = '--°';
    document.getElementById('wxDetails').innerHTML = '<div class="widget-error"><div class="err-msg">Weather unavailable</div><button class="retry-btn" onclick="loadWeather()">Retry</button></div>';
  }
}

// US state name → abbreviation for weather label
const US_STATE_ABBR = {"Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY"};
function weatherEmoji(code) {
  if (code === 0) return '☀️'; if (code <= 3) return '⛅'; if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️'; if (code <= 67) return '🌧️'; if (code <= 77) return '🌨️';
  if (code <= 82) return '🌧️'; if (code <= 86) return '🌨️'; if (code >= 95) return '⛈️';
  return '☁️';
}

function weatherDesc(code) {
  if (code === 0) return 'Clear sky';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Cloudy';
}

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
      document.getElementById('mktTreasury').textContent = d.ten_yr.toFixed(2) + '%';
      if (d.prev_ten_yr) {
        const chg = d.ten_yr - d.prev_ten_yr;
        const chgEl = document.getElementById('mktTreasuryChg');
        chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '% (as of ' + d.date + ')';
        chgEl.className = 'market-chg ' + (chg >= 0 ? 'market-up' : 'market-down');
      }
    } else {
      throw new Error('No yield data');
    }
  } catch (e) {
    console.error('Market load error:', e);
    document.getElementById('mktTreasury').textContent = '--';
    document.getElementById('mktTreasuryChg').innerHTML = '<div class="widget-error"><div class="err-msg">Market data unavailable</div><button class="retry-btn" onclick="loadMarket()">Retry</button></div>';
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
  // 1D: show last 10 trading days for context (Treasury only has daily closes)
  if (range === '1D') return data.slice(-10);
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
  return data.filter(d => d.date >= cutStr);
}

async function loadYieldChart(range) {
  currentYieldRange = range;
  const container = document.getElementById('yieldChartContainer');
  container.innerHTML = '<div class="chart-loading"><span class="spinner"></span></div>';

  // Update active button
  document.querySelectorAll('#yieldChartControls button').forEach(b => {
    b.classList.toggle('active', b.dataset.range === range);
  });

  const numYears = yearsForRange(range);
  const allData = await fetchYieldHistory(numYears);
  const data = filterByRange(allData, range);

  if (data.length < 2) {
    container.innerHTML = '<div class="chart-loading" style="font-size:12px;color:var(--text2)">Not enough data for this range</div>';
    return;
  }

  renderYieldSVG(container, data, range);
}

function renderYieldSVG(container, data, range) {
  const W = container.clientWidth || 320;
  const H = container.clientHeight || 160;
  const pad = { top: 10, right: 10, bottom: 24, left: 54 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  const vals = data.map(d => d.ten_yr);
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

// Wire up chart range buttons
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('yieldChartControls')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-range]');
    if (btn) loadYieldChart(btn.dataset.range);
  });
});

function renderHomeStats() {
  // Prefer canonical work_counts when available
  if (canonicalCounts) {
    document.getElementById('statActivities').textContent = (canonicalCounts.my_actions || 0).toLocaleString();
    document.getElementById('statEmails').textContent = (canonicalCounts.inbox_new || 0).toLocaleString();
    document.getElementById('statDue').textContent = (canonicalCounts.due_this_week || 0).toLocaleString();
  } else {
    // Legacy fallback — only update activity-dependent stats once loaded (prevents 0-flash)
    if (activitiesLoaded) {
      document.getElementById('statActivities').textContent = activities.length.toLocaleString();
      const now = Date.now(); const week = 7 * 86400000;
      const due = activities.filter(a => { if (!a.activity_date) return false; const d = new Date(a.activity_date).getTime(); return d >= now && d <= now + week; });
      document.getElementById('statDue').textContent = due.length;
    }
    document.getElementById('statEmails').textContent = (emailTotalCount || emails.length).toLocaleString();
  }
  // Calendar events always from edge function (individual calendar)
  const today = tzDateStr(new Date());
  const todayEvents = calEvents.filter(e => tzDateStr(e.start_time) === today && !isCanceled(e));
  document.getElementById('statEvents').textContent = todayEvents.length;
}

function isCanceled(ev) { return (ev.subject || '').startsWith('[CANCELED]') || (ev.subject || '').startsWith('Canceled:') || ev.is_cancelled; }

function renderTodaySchedule() {
  const today = tzDateStr(new Date());
  const todayEvts = calEvents.filter(e => tzDateStr(e.start_time) === today && !isCanceled(e));
  if (todayEvts.length === 0) return '<div style="color:var(--text2);font-size:14px;padding:8px 0">No events scheduled today.</div>';

  const allDay = todayEvts.filter(e => e.is_all_day);
  const timed = todayEvts.filter(e => !e.is_all_day);

  let startHr = 6, endHr = 18;
  for (const ev of timed) {
    const sh = tzHour(ev.start_time);
    const eh = tzHour(ev.end_time) + (tzMin(ev.end_time) > 0 ? 1 : 0);
    if (sh < startHr) startHr = sh;
    if (eh > endHr) endHr = eh;
  }
  const nowHr = tzHour(new Date());
  if (nowHr >= startHr - 1 && nowHr <= endHr + 2) {
    if (nowHr < startHr) startHr = nowHr;
    if (nowHr >= endHr) endHr = nowHr + 1;
  }
  const hrHeight = 48;
  const totalHours = endHr - startHr;

  let html = '';
  if (allDay.length > 0) {
    html += '<div class="sched-alldays">';
    for (const ev of allDay) {
      html += `<div class="sched-event allday"><div class="sched-ev-title">${esc(ev.subject || '(No title)')}</div></div>`;
    }
    html += '</div>';
  }

  html += `<div class="sched-hours" style="height:${totalHours * hrHeight}px">`;
  for (let h = startHr; h < endHr; h++) {
    const top = (h - startHr) * hrHeight;
    const label = h === 0 ? '12 AM' : h < 12 ? h + ' AM' : h === 12 ? '12 PM' : (h - 12) + ' PM';
    html += `<div class="sched-hour" style="top:${top}px;position:absolute;left:0;right:0;height:${hrHeight}px;border-bottom:1px solid var(--border)"><span class="sched-hour-label">${label}</span></div>`;
  }

  const now = new Date();
  const nowMin = tzHourMin(now);
  const startMin = startHr * 60;
  const endMin = endHr * 60;
  if (nowMin >= startMin && nowMin <= endMin) {
    const nowTop = ((nowMin - startMin) / 60) * hrHeight;
    html += `<div class="sched-now" style="top:${nowTop}px"></div>`;
  }

  for (const ev of timed) {
    const evStartMin = tzHourMin(ev.start_time);
    const evEndMin = tzHourMin(ev.end_time);
    const top = ((evStartMin - startMin) / 60) * hrHeight;
    const height = Math.max(((evEndMin - evStartMin) / 60) * hrHeight, 22);
    const timeLabel = formatTime(ev.start_time) + ' - ' + formatTime(ev.end_time);
    html += `<div class="sched-event" style="top:${top}px;height:${height}px">`;
    html += `<div class="sched-ev-title">${esc(ev.subject || '(No title)')}</div>`;
    if (height > 28) html += `<div class="sched-ev-time">${timeLabel}</div>`;
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function renderPriorityTasks() {
  // Prefer canonical my_work items when available
  if (canonicalMyWork && canonicalMyWork.items && canonicalMyWork.items.length > 0) {
    let html = '';
    for (const item of canonicalMyWork.items) {
      const title = esc(item.title || '(Untitled)');
      const statusCls = `status-${(item.status || '').replace(/ /g, '_')}`;
      const statusLabel = (item.status || '').replace(/_/g, ' ');
      const isOverdue = item.due_date && new Date(item.due_date) < new Date();
      const dueLabel = item.due_date ? formatDate(item.due_date) : '';
      html += `<div class="act-item canonical-task${isOverdue ? ' overdue' : ''}" onclick="navTo('pageMyWork')">
        <div class="act-top"><div class="act-subject">${title}</div></div>
        <div class="act-meta">
          <span class="q-badge ${statusCls}">${statusLabel}</span>
          ${item.domain ? `<span class="q-badge domain">${esc(item.domain)}</span>` : ''}
          ${dueLabel ? `<span class="act-due${isOverdue ? ' text-overdue' : ''}">${dueLabel}</span>` : ''}
        </div>
      </div>`;
    }
    const total = canonicalMyWork.pagination?.total || 0;
    if (total > 5) {
      html += `<div class="widget-more" onclick="navTo('pageMyWork')">View all ${total} items</div>`;
    }
    return html;
  }

  // Legacy fallback — Salesforce activities
  const priority = activities.filter(a => (a.computed_category || '').includes('Priority'));
  const recent = activities.slice(0, 10);
  const items = priority.length > 0 ? priority.slice(0, 5) : recent.slice(0, 5);
  if (items.length === 0) return '<div style="color:var(--text2);font-size:13px">No tasks loaded.</div>';
  let html = '';
  for (const a of items) {
    const subj = (a.subject && a.subject.replace(/[!?.\s]/g, '').length > 0) ? a.subject : (a.contact_name || a.company_name || '—');
    html += `<div class="act-item" onclick='showDetail(${safeJSON(a)})'>
      <div class="act-top"><div class="act-subject">${esc(subj)}</div></div>
      <div class="act-meta"><span class="act-company">${esc(a.company_name || '')}</span><span class="act-cat ${catClass(a.computed_category)}">${esc(a.computed_category || 'General')}</span></div>
    </div>`;
  }
  return html;
}

function renderCategoryMetrics() {
  // Prefer canonical counts when available
  if (canonicalCounts) {
    let html = '<div class="cat-metrics">';
    html += `<div class="cat-metric clickable" onclick="navTo('pageMyWork')"><div class="cat-metric-val" style="color:var(--accent)">${canonicalCounts.my_actions || 0}</div><div class="cat-metric-lbl">My Actions</div></div>`;
    html += `<div class="cat-metric clickable" onclick="navTo('pageTeamQueue')"><div class="cat-metric-val" style="color:var(--cyan)">${canonicalCounts.open_actions || 0}</div><div class="cat-metric-lbl">Team Open</div></div>`;
    html += `<div class="cat-metric"><div class="cat-metric-val" style="color:var(--green)">${canonicalCounts.completed_week || 0}</div><div class="cat-metric-lbl">Done This Week</div></div>`;
    html += `<div class="cat-metric${(canonicalCounts.overdue || 0) > 0 ? ' overdue' : ''}"><div class="cat-metric-val" style="color:${(canonicalCounts.overdue || 0) > 0 ? 'var(--red)' : 'var(--yellow)'}">${canonicalCounts.overdue || 0}</div><div class="cat-metric-lbl">Overdue</div></div>`;
    html += '</div>';
    return html;
  }

  // Legacy fallback — Salesforce activity categories
  if (activities.length === 0) return '<div style="color:var(--text2);font-size:13px">No activities recorded yet</div>';
  const isDiaCategory = c => c.includes('dialysis') || c.includes('davita') || c.includes('fmc') || c.includes('fresenius') || c.includes('medical') || c.includes('healthcare');
  const isGovCategory = c => c.includes('government') || c.includes('gsa') || c.includes('va ') || c.includes('federal');
  const dialysis = activities.filter(a => { const c = (a.computed_category || '').toLowerCase(); return isDiaCategory(c); });
  const govt = activities.filter(a => { const c = (a.computed_category || '').toLowerCase(); return isGovCategory(c); });
  const other = activities.filter(a => {
    const c = (a.computed_category || '').toLowerCase();
    return !isDiaCategory(c) && !isGovCategory(c);
  });
  const now = Date.now(); const week = 7 * 86400000;
  const dueSoon = activities.filter(a => { if (!a.activity_date) return false; const d = new Date(a.activity_date).getTime(); return d >= now && d <= now + week; });

  let html = '<div class="cat-metrics">';
  html += `<div class="cat-metric"><div class="cat-metric-val" style="color:var(--purple)">${dialysis.length}</div><div class="cat-metric-lbl">Dialysis</div></div>`;
  html += `<div class="cat-metric"><div class="cat-metric-val" style="color:var(--cyan)">${govt.length}</div><div class="cat-metric-lbl">Government</div></div>`;
  html += `<div class="cat-metric"><div class="cat-metric-val" style="color:var(--orange)">${other.length}</div><div class="cat-metric-lbl">All Other</div></div>`;
  html += `<div class="cat-metric"><div class="cat-metric-val" style="color:var(--yellow)">${dueSoon.length}</div><div class="cat-metric-lbl">Due 7 Days</div></div>`;
  html += '</div>';
  return html;
}

function renderRecentEmails() {
  // Prefer canonical inbox items when available
  if (canonicalInbox && canonicalInbox.items && canonicalInbox.items.length > 0) {
    let html = '';
    for (const item of canonicalInbox.items) {
      const title = esc(item.title || '(No subject)');
      const source = esc(item.source_ref || item.source_type || '');
      const date = item.received_at ? formatDate(item.received_at) : '';
      html += `<div class="email-card canonical-inbox-item" onclick="navTo('pageInbox')">
        <div class="email-subj">${title}</div>
        <div class="email-from"><span>${source}</span><span>${date}</span></div>
      </div>`;
    }
    const total = canonicalInbox.pagination?.total || 0;
    if (total > 6) {
      html += `<div class="widget-more" onclick="navTo('pageInbox')">View all ${total} items</div>`;
    }
    return html;
  }

  // Legacy fallback — edge function flagged emails
  if (emails.length === 0) return '<div style="color:var(--text2);font-size:13px">No flagged emails.</div>';
  let html = '';
  for (const e of emails.slice(0, 6)) {
    const link = e.outlook_link || e.web_link || '#';
    html += `<div class="email-card" onclick="window.open(${safeJSON(link)},'_blank')">
      <div class="email-subj">${esc(e.subject || '(No subject)')}</div>
      <div class="email-from"><span>${esc(e.sender_name || e.sender_email || '')}</span><span>${formatDate(e.received_date)}</span></div>
    </div>`;
  }
  return html;
}

// ============================================================
// TEAM PULSE — manager/owner widget showing team health at a glance
// ============================================================
function renderTeamPulse() {
  const widget = document.getElementById('teamPulseWidget');
  const el = document.getElementById('teamPulseContent');
  if (!widget || !el) return;

  // Only show for managers/owners with canonical data
  const isManager = LCC_USER.role === 'owner' || LCC_USER.role === 'manager';
  if (!isManager || !canonicalCounts) {
    widget.style.display = 'none';
    return;
  }

  widget.style.display = '';
  const c = canonicalCounts;

  let html = '<div class="team-pulse-grid">';

  // Unassigned work
  const unassignedCount = (c.open_actions || 0) - (c.in_progress || 0);
  html += `<div class="pulse-card${unassignedCount > 0 ? ' attention' : ''}" onclick="navTo('pageTeamQueue')">
    <div class="pulse-val">${Math.max(0, unassignedCount)}</div>
    <div class="pulse-label">Unassigned</div>
  </div>`;

  // Open escalations
  html += `<div class="pulse-card${(c.open_escalations || 0) > 0 ? ' alert' : ''}" onclick="navTo('pageMetrics')">
    <div class="pulse-val">${c.open_escalations || 0}</div>
    <div class="pulse-label">Escalations</div>
  </div>`;

  // Sync errors
  html += `<div class="pulse-card${(c.sync_errors || 0) > 0 ? ' attention' : ''}" onclick="navTo('pageSyncHealth')">
    <div class="pulse-val">${c.sync_errors || 0}</div>
    <div class="pulse-label">Sync Errors</div>
  </div>`;

  // Active research
  html += `<div class="pulse-card" onclick="navTo('pageResearch')">
    <div class="pulse-val">${c.research_active || 0}</div>
    <div class="pulse-label">Research</div>
  </div>`;

  html += '</div>';

  // Overdue alert bar
  if ((c.overdue || 0) > 0) {
    html += `<div class="pulse-alert" onclick="navTo('pageMyWork')">
      ${c.overdue} overdue action${c.overdue !== 1 ? 's' : ''} across the team
    </div>`;
  }

  el.innerHTML = html;
}

// ============================================================
// CALENDAR PAGE
// ============================================================
function renderCalendarFull() {
  if (calEvents.length === 0) { document.getElementById('calendarFull').innerHTML = '<div style="color:var(--text2)">No events loaded.</div>'; return; }
  const byDay = {};
  for (const ev of calEvents) {
    const d = new Date(stripTZ(ev.start_time)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(ev);
  }
  let html = '';
  for (const [day, events] of Object.entries(byDay)) {
    const isToday = tzDateStr(events[0].start_time) === tzDateStr(new Date());
    html += `<div style="font-size:14px;font-weight:600;padding:12px 0 6px;color:${isToday ? 'var(--accent)' : 'var(--text)'}">${day}${isToday ? ' (Today)' : ''}</div>`;
    html += '<div class="widget" style="margin-bottom:8px">';
    for (const ev of events) {
      const canceled = isCanceled(ev);
      const time = ev.is_all_day ? '<span class="cal-allday">All Day</span>' : `${formatTime(ev.start_time)} – ${formatTime(ev.end_time)}`;
      const cancelStyle = canceled ? ' style="opacity:0.4;text-decoration:line-through"' : '';
      html += `<div class="cal-item"${cancelStyle}><div class="cal-time">${time}</div><div><div class="cal-subj">${esc(ev.subject || '(No title)')}</div>${ev.location ? `<div class="cal-loc">${esc(ev.location)}</div>` : ''}${ev.organizer_name ? `<div class="cal-loc">Organizer: ${esc(ev.organizer_name)}</div>` : ''}</div></div>`;
    }
    html += '</div>';
  }
  document.getElementById('calendarFull').innerHTML = html;
}

// ============================================================
// KEYBOARD
// ============================================================
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDetail(); closeLogCall(); } });

// Auto-set title attribute on truncated elements for hover tooltips
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('.truncate');
  if (el && !el.title) el.title = el.textContent.trim();
});

// ============================================================
// PERSONAL TAB — Calendar & Tasks
// ============================================================
let personalCalEvents = [];
let personalTodoLists = ['Personal', 'Family', 'Kids', 'Health', 'Finance', 'House'];

async function loadPersonalCalendar() {
  try {
    const res = await fetch(`${API}/sync/calendar-events?days_back=1&days_forward=30&limit=200&calendar=personal`);
    const data = await res.json();
    personalCalEvents = data.events || [];
    renderPersonalCalendar();
  } catch (e) {
    console.error('Personal calendar load error:', e);
    renderPersonalCalendar();
  }
}

function renderPersonalCalendar() {
  const el = document.getElementById('personalCalendar');
  if (!el) return;
  if (personalCalEvents.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2)">' +
      '<div style="font-size:13px;margin-bottom:8px">No personal calendar events in the next 30 days.</div>' +
      '<div style="font-size:12px;color:var(--text3)">Events from your personal Outlook.com calendar will sync here automatically every hour via Power Automate.</div>' +
      '</div>';
    return;
  }
  // Group by date
  const byDate = {};
  const tz = 'America/Chicago';
  for (const ev of personalCalEvents) {
    if (isCanceled(ev)) continue;
    const d = tzDateStr(ev.start_time);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(ev);
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const dates = Object.keys(byDate).sort();
  let html = '';
  for (const d of dates) {
    const isToday = d === today;
    const label = isToday ? 'Today' : new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    html += `<div style="font-size:11px;font-weight:600;color:${isToday ? 'var(--cyan)' : 'var(--text3)'};text-transform:uppercase;letter-spacing:0.5px;margin:12px 0 6px;padding:0 16px">${label}</div>`;
    for (const ev of byDate[d]) {
      const t0 = ev.is_all_day ? 'All Day' : new Date(ev.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
      const t1 = ev.is_all_day ? '' : ' - ' + new Date(ev.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
      const loc = ev.location ? ` · ${esc(ev.location)}` : '';
      html += `<div style="padding:8px 16px;border-bottom:1px solid var(--s2);cursor:pointer" onclick="${ev.web_link ? `window.open('${ev.web_link}','_blank')` : ''}">
        <div style="font-size:14px;color:var(--text1)">${esc(ev.subject || '(No title)')}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${t0}${t1}${loc}</div>
      </div>`;
    }
  }
  el.innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--text2)">No upcoming personal events.</div>';
}

async function loadPersonalTasks() {
  // Render personal tasks filtered from the already-loaded activities
  const el = document.getElementById('personalTasks');
  if (!el) return;
  try {
    // Wait for activities to be loaded if they haven't been yet
    if (!activitiesLoaded) {
      await new Promise(resolve => {
        const check = setInterval(() => { if (activitiesLoaded) { clearInterval(check); resolve(); } }, 200);
        setTimeout(() => { clearInterval(check); resolve(); }, 10000); // 10s timeout
      });
    }
    const raw = activities;
    // Filter for personal categories (including medical/healthcare from SF)
    const personalCats = ['family', 'personal', 'kids', 'health', 'finance', 'house', 'medical'];
    const personalItems = raw.filter(a => {
      const cat = (a.computed_category || '').toLowerCase();
      return personalCats.some(c => cat.includes(c));
    });
    // Deduplicate personal items by subject + date
    const pSeen = new Set();
    const dedupedPersonal = personalItems.filter(a => {
      const key = `${a.subject}|${a.activity_date}`;
      if (pSeen.has(key)) return false;
      pSeen.add(key);
      return true;
    });
    if (dedupedPersonal.length === 0) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2)">' +
        '<div style="font-size:13px;margin-bottom:8px">No personal tasks found.</div>' +
        '<div style="font-size:12px;color:var(--text3)">Personal tasks from Microsoft To Do and flagged personal emails will appear here once synced.</div>' +
        '</div>';
      return;
    }
    let html = '';
    // Group by list/category
    const grouped = {};
    for (const item of dedupedPersonal.slice(0, 30)) {
      const cat = item.computed_category || 'Personal';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    }
    for (const [cat, items] of Object.entries(grouped)) {
      html += `<div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin:12px 0 6px;padding:0 16px">${esc(cat)} (${items.length})</div>`;
      for (const item of items.slice(0, 5)) {
        const subj = item.subject || item.contact_name || '—';
        const date = item.activity_date ? formatDate(item.activity_date) : '';
        html += `<div style="padding:8px 16px;border-bottom:1px solid var(--s2)">
          <div style="font-size:14px;color:var(--text1)">${esc(subj)}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px">${date}</div>
        </div>`;
      }
    }
    el.innerHTML = html;
  } catch (e) {
    console.error('Personal tasks load error:', e);
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2)">Unable to load personal tasks.</div>';
  }
}

// ============================================================
// MESSAGES PAGE
// ============================================================
let msgData = { flagged: [], recent: [], sent: [] };
let currentMsgTab = 'flagged';
let messagesLoaded = false;

async function loadMessages() {
  if (messagesLoaded) { renderMessages(); return; }
  const el = document.getElementById('msgList');
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    // Use flagged emails as the primary message source
    if (emails.length > 0) {
      msgData.flagged = emails;
    } else {
      const res = await fetch(`${API}/sync/flagged-emails?limit=500`);
      if (!res.ok) throw new Error('API returned ' + res.status);
      const data = await res.json();
      msgData.flagged = data.emails || [];
    }
    // Recent = most recent from activities that have email type
    msgData.recent = activities.filter(a => {
      const cat = (a.computed_category || '').toLowerCase();
      return cat.includes('email') || (a.subject || '').toLowerCase().includes('email');
    }).slice(0, 50);
    // Sent = activities logged as outbound
    msgData.sent = activities.filter(a => {
      const type = (a.activity_type || '').toLowerCase();
      return type.includes('email') || type.includes('correspondence');
    }).slice(0, 50);
    messagesLoaded = true;
    renderMessages();
  } catch (e) {
    console.error('Messages load error:', e);
    el.innerHTML = '<div class="widget-error"><div class="err-icon">&#x1F4EC;</div><div class="err-msg">Unable to load messages</div><button class="retry-btn" onclick="loadMessages()">Retry</button></div>';
  }
}

function renderMessages() {
  const el = document.getElementById('msgList');
  const search = document.getElementById('msgSearchInput')?.value || '';
  const searchLower = search.toLowerCase();

  // Update tab active state and counts
  const tabCounts = { flagged: msgData.flagged.length, recent: msgData.recent.length, sent: msgData.sent.length };
  const tabLabels = { flagged: 'Flagged', recent: 'Recent', sent: 'Sent' };
  document.querySelectorAll('#msgTabs .msg-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.msgTab === currentMsgTab);
    const ct = tabCounts[t.dataset.msgTab];
    t.textContent = tabLabels[t.dataset.msgTab] + (ct ? ` (${ct})` : '');
  });

  let items = [];
  if (currentMsgTab === 'flagged') {
    items = msgData.flagged.map(e => ({
      sender: e.sender_name || e.sender_email || 'Unknown',
      subject: e.subject || '(No subject)',
      preview: e.body_preview || '',
      time: e.received_date,
      link: e.outlook_link || e.web_link,
      unread: e.is_read === false,
    }));
  } else if (currentMsgTab === 'recent') {
    items = msgData.recent.map(a => ({
      sender: a.contact_name || a.company_name || 'Unknown',
      subject: a.subject || '(No subject)',
      preview: a.description || '',
      time: a.activity_date,
      link: null,
      unread: false,
    }));
  } else {
    items = msgData.sent.map(a => ({
      sender: 'To: ' + (a.contact_name || a.company_name || 'Unknown'),
      subject: a.subject || '(No subject)',
      preview: a.description || '',
      time: a.activity_date,
      link: null,
      unread: false,
    }));
  }

  if (searchLower) {
    items = items.filter(m =>
      m.sender.toLowerCase().includes(searchLower) ||
      m.subject.toLowerCase().includes(searchLower) ||
      m.preview.toLowerCase().includes(searchLower)
    );
  }

  if (items.length === 0) {
    el.innerHTML = `<div class="msg-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      <div style="font-size:14px;margin-bottom:4px">No messages${searchLower ? ' matching "' + esc(search) + '"' : ''}</div>
      <div style="font-size:12px;color:var(--text3)">${currentMsgTab === 'flagged' ? 'Flagged Outlook emails will appear here' : 'Activity-based messages will appear here'}</div>
    </div>`;
    return;
  }

  let html = '';
  for (const m of items.slice(0, 50)) {
    html += `<div class="msg-item${m.unread ? ' unread' : ''}" ${m.link ? `onclick="window.open(${safeJSON(m.link)},'_blank')"` : ''}>
      <div class="msg-header">
        <div class="msg-sender">${esc(m.sender)}</div>
        <div class="msg-time">${formatDate(m.time)}</div>
      </div>
      <div class="msg-subject">${esc(m.subject)}</div>
      ${m.preview ? `<div class="msg-preview">${esc(m.preview)}</div>` : ''}
    </div>`;
  }
  if (items.length > 50) html += `<div style="text-align:center;padding:12px;color:var(--text3);font-size:12px">Showing 50 of ${items.length} messages</div>`;
  el.innerHTML = html;
}

function filterMessages() { renderMessages(); }

// Message tab click handler
document.getElementById('msgTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.msg-tab');
  if (!tab) return;
  currentMsgTab = tab.dataset.msgTab;
  renderMessages();
});

// ============================================================
// SETTINGS PAGE
// ============================================================
const LCC_SETTINGS_KEY = 'lcc-settings';
let appSettings = {
  notifications: true,
  darkMode: true,
  autoRefresh: true,
  refreshInterval: 5,
  timezone: 'America/Chicago',
  defaultTab: 'dialysis',
  compactView: false,
  showWeather: true,
  showMarkets: true,
};

function loadSettings() {
  try {
    const saved = localStorage.getItem(LCC_SETTINGS_KEY);
    if (saved) appSettings = { ...appSettings, ...JSON.parse(saved) };
  } catch (e) {}
}
function saveSettings() {
  try { localStorage.setItem(LCC_SETTINGS_KEY, JSON.stringify(appSettings)); } catch (e) {}
}
loadSettings();

function renderSettings() {
  const el = document.getElementById('settingsContent');
  if (!el) return;

  el.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">General</div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Auto-Refresh Data</div>
          <div class="settings-row-desc">Automatically refresh activities and dashboard data</div>
        </div>
        <label class="settings-toggle"><input type="checkbox" ${appSettings.autoRefresh ? 'checked' : ''} onchange="toggleSetting('autoRefresh', this.checked)"><span class="slider"></span></label>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Compact View</div>
          <div class="settings-row-desc">Reduce padding and show more data per screen</div>
        </div>
        <label class="settings-toggle"><input type="checkbox" ${appSettings.compactView ? 'checked' : ''} onchange="toggleSetting('compactView', this.checked)"><span class="slider"></span></label>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Default Business Tab</div>
          <div class="settings-row-desc">Which tab opens first in Business view</div>
        </div>
        <select style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);font-size:13px;outline:none;width:auto" onchange="setSetting('defaultTab', this.value)">
          <option value="dialysis" ${appSettings.defaultTab === 'dialysis' ? 'selected' : ''}>Dialysis</option>
          <option value="government" ${appSettings.defaultTab === 'government' ? 'selected' : ''}>Government</option>
          <option value="marketing" ${appSettings.defaultTab === 'marketing' ? 'selected' : ''}>Marketing</option>
          <option value="prospects" ${appSettings.defaultTab === 'prospects' ? 'selected' : ''}>Prospects</option>
        </select>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Home Widgets</div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Show Weather</div>
          <div class="settings-row-desc">Display local weather on home screen (auto-detects location)</div>
        </div>
        <label class="settings-toggle"><input type="checkbox" ${appSettings.showWeather ? 'checked' : ''} onchange="toggleSetting('showWeather', this.checked)"><span class="slider"></span></label>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Show Markets</div>
          <div class="settings-row-desc">Display Treasury yield data on home screen</div>
        </div>
        <label class="settings-toggle"><input type="checkbox" ${appSettings.showMarkets ? 'checked' : ''} onchange="toggleSetting('showMarkets', this.checked)"><span class="slider"></span></label>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Data Connections</div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Government Database</div>
          <div class="settings-row-desc">Supabase connection for government property data</div>
        </div>
        <div class="settings-val" style="color:${govConnected ? 'var(--green)' : 'var(--red)'}">${govConnected ? 'Connected' : 'Disconnected'}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Dialysis Database</div>
          <div class="settings-row-desc">Supabase connection for dialysis clinic data</div>
        </div>
        <div class="settings-val" style="color:${diaConnected ? 'var(--green)' : 'var(--red)'}">${diaConnected ? 'Connected' : 'Disconnected'}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Salesforce Sync</div>
          <div class="settings-row-desc">Activity sync via Edge Function</div>
        </div>
        <div class="settings-val" style="color:${activitiesLoaded && activities.length > 0 ? 'var(--green)' : 'var(--yellow)'}">${activitiesLoaded ? activities.length + ' activities' : 'Loading...'}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Outlook Sync</div>
          <div class="settings-row-desc">Flagged email sync via Edge Function</div>
        </div>
        <div class="settings-val" style="color:${emails.length > 0 ? 'var(--green)' : 'var(--yellow)'}">${emails.length > 0 ? emails.length + ' emails' : 'No data'}</div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">App Info</div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Version</div>
          <div class="settings-row-desc">Life Command Center</div>
        </div>
        <div class="settings-val">2.2.0</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">User</div>
          <div class="settings-row-desc">Northmarq Investment Sales</div>
        </div>
        <div class="settings-val" style="color:var(--text)" id="settingsUserName">Scott Briggs</div>
      </div>
      <div class="settings-row" style="cursor:pointer" onclick="clearCacheAndReload()">
        <div class="settings-row-info">
          <div class="settings-row-label" style="color:var(--red)">Clear Cache & Reload</div>
          <div class="settings-row-desc">Force refresh all data and clear local storage</div>
        </div>
        <div style="color:var(--red);font-size:18px">&#x21BB;</div>
      </div>
    </div>
  `;
}

function toggleSetting(key, val) {
  appSettings[key] = val;
  saveSettings();
  applySettings();
  // Restart auto-refresh if that setting changed
  if (key === 'autoRefresh' || key === 'refreshInterval') {
    if (typeof startAutoRefresh === 'function') startAutoRefresh();
  }
}
function setSetting(key, val) {
  appSettings[key] = val;
  saveSettings();
}
function applySettings() {
  // Apply widget visibility
  const wx = document.getElementById('weatherWidget');
  if (wx) wx.style.display = appSettings.showWeather ? '' : 'none';
  const mkt = document.getElementById('marketWidget');
  if (mkt) mkt.style.display = appSettings.showMarkets ? '' : 'none';
  // Apply compact mode
  document.body.classList.toggle('compact', appSettings.compactView);
}
function clearCacheAndReload() {
  if (confirm('Clear all cached data and reload the app?')) {
    localStorage.clear();
    if ('caches' in window) caches.keys().then(names => names.forEach(n => caches.delete(n)));
    location.reload();
  }
}
// Apply settings on load
setTimeout(applySettings, 100);

// ============================================================
// AI COPILOT
// ============================================================
let copilotOpen = false;
let copilotHistory = [];

function toggleCopilot() {
  copilotOpen = !copilotOpen;
  document.getElementById('copilotPanel').classList.toggle('open', copilotOpen);
  document.getElementById('copilotFab').classList.toggle('hidden', copilotOpen);
  if (copilotOpen) {
    setTimeout(() => document.getElementById('copilotInput').focus(), 300);
  }
}

function sendCopilotSuggestion(text) {
  document.getElementById('copilotInput').value = text;
  sendCopilotMessage();
}

async function sendCopilotMessage() {
  const input = document.getElementById('copilotInput');
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  input.style.height = 'auto';

  // Add user message
  appendCopilotMsg(msg, 'user');

  // Add typing indicator
  const typingId = 'typing-' + Date.now();
  appendCopilotMsg('Thinking...', 'bot typing', typingId);

  // Build context from loaded data
  const context = buildCopilotContext();

  copilotHistory.push({ role: 'user', content: msg });

  try {
    const res = await fetch(`${API}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        context: context,
        history: copilotHistory.slice(-6),
      }),
    });

    if (!res.ok) throw new Error('API returned ' + res.status);
    const data = await res.json();
    const reply = data.response || data.message || data.reply || 'I couldn\'t generate a response. Try rephrasing your question.';

    // Remove typing indicator
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();

    appendCopilotMsg(reply, 'bot');
    copilotHistory.push({ role: 'assistant', content: reply });

  } catch (e) {
    console.error('Copilot error:', e);
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();

    // Fallback: use local data to answer common questions
    const localReply = handleLocalCopilotQuery(msg);
    appendCopilotMsg(localReply, 'bot');
    copilotHistory.push({ role: 'assistant', content: localReply });
  }
}

function appendCopilotMsg(text, cls, id) {
  const container = document.getElementById('copilotMessages');
  const div = document.createElement('div');
  div.className = 'copilot-msg ' + cls;
  if (id) div.id = id;
  div.innerHTML = formatCopilotText(text);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function formatCopilotText(text) {
  // Basic markdown-like formatting
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
    .replace(/`(.+?)`/g, '<code style="background:var(--s2);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>');
}

function buildCopilotContext() {
  const ctx = {};
  ctx.total_activities = activities.length;
  ctx.total_emails = emails.length;
  ctx.today_events = calEvents.filter(e => tzDateStr(e.start_time) === tzDateStr(new Date())).length;
  ctx.gov_connected = govConnected;
  ctx.dia_connected = diaConnected;

  // Recent activities summary
  const now = new Date();
  const weekAgo = new Date(now - 7 * 86400000);
  const thisWeek = activities.filter(a => a.activity_date && new Date(a.activity_date) >= weekAgo);
  ctx.activities_this_week = thisWeek.length;

  // Category breakdown
  const cats = {};
  for (const a of activities) {
    const c = a.computed_category || 'General';
    cats[c] = (cats[c] || 0) + 1;
  }
  ctx.category_breakdown = cats;

  return ctx;
}

function handleLocalCopilotQuery(msg) {
  const lower = msg.toLowerCase();

  if (lower.includes('this week') || lower.includes('activity') && lower.includes('summar')) {
    const now = new Date();
    const weekAgo = new Date(now - 7 * 86400000);
    const thisWeek = activities.filter(a => a.activity_date && new Date(a.activity_date) >= weekAgo);
    const cats = {};
    for (const a of thisWeek) { const c = a.computed_category || 'General'; cats[c] = (cats[c] || 0) + 1; }
    let reply = `**This Week's Activity Summary**\nYou have **${thisWeek.length}** activities logged this week.\n\n`;
    for (const [cat, count] of Object.entries(cats).sort((a,b) => b[1]-a[1])) {
      reply += `• ${cat}: ${count}\n`;
    }
    return reply;
  }

  if (lower.includes('today') && (lower.includes('event') || lower.includes('schedule') || lower.includes('calendar'))) {
    const today = tzDateStr(new Date());
    const todayEvts = calEvents.filter(e => tzDateStr(e.start_time) === today && !isCanceled(e));
    if (todayEvts.length === 0) return 'You have no events scheduled for today.';
    let reply = `**Today's Schedule** (${todayEvts.length} events)\n\n`;
    for (const ev of todayEvts) {
      const time = ev.is_all_day ? 'All Day' : formatTime(ev.start_time);
      reply += `• **${time}** — ${ev.subject || '(No title)'}\n`;
    }
    return reply;
  }

  if (lower.includes('priorit') || lower.includes('task')) {
    const priority = activities.filter(a => (a.computed_category || '').includes('Priority'));
    const items = priority.length > 0 ? priority.slice(0, 5) : activities.slice(0, 5);
    let reply = `**Priority Tasks** (${priority.length} flagged)\n\n`;
    for (const a of items) {
      reply += `• ${a.subject || a.contact_name || '—'} — ${a.company_name || ''} (${formatDate(a.activity_date)})\n`;
    }
    return reply;
  }

  if (lower.includes('email') || lower.includes('flagged')) {
    return `You have **${emails.length}** flagged emails. The most recent are from: ${emails.slice(0, 3).map(e => e.sender_name || e.sender_email).join(', ')}.`;
  }

  if (lower.includes('connection') || lower.includes('status') || lower.includes('health')) {
    return `**System Status**\n• Government DB: ${govConnected ? '✅ Connected' : '❌ Disconnected'}\n• Dialysis DB: ${diaConnected ? '✅ Connected' : '❌ Disconnected'}\n• Activities: ${activities.length} loaded\n• Emails: ${emails.length} flagged\n• Calendar: ${calEvents.length} events`;
  }

  return `I wasn't able to reach the AI service, but I can help with local data queries. Try asking about:\n• "Summarize my activity this week"\n• "What's on my schedule today?"\n• "Show priority tasks"\n• "System connection status"`;
}

// ============================================================
// ENHANCED GREETING — updates with daily context after data loads
// ============================================================
function updateGreeting() {
  const el = document.getElementById('greeting');
  if (!el) return;
  const base = getGreeting();

  // After data loads, add a contextual summary
  if (!activitiesLoaded && calEvents.length === 0) {
    el.textContent = base;
    return;
  }

  const today = tzDateStr(new Date());
  const todayEvts = calEvents.filter(e => tzDateStr(e.start_time) === today && !isCanceled(e));
  const now = Date.now();
  const weekEnd = now + 7 * 86400000;
  const dueSoon = activities.filter(a => { if (!a.activity_date) return false; const d = new Date(a.activity_date).getTime(); return d >= now && d <= weekEnd; });

  let summary = '';
  if (todayEvts.length > 0 || dueSoon.length > 0 || emails.length > 0) {
    const parts = [];
    if (todayEvts.length > 0) parts.push(`${todayEvts.length} event${todayEvts.length > 1 ? 's' : ''} today`);
    if (dueSoon.length > 0) parts.push(`${dueSoon.length} due this week`);
    const emailDisplay = emailTotalCount || emails.length;
    if (emailDisplay > 0) parts.push(`${emailDisplay.toLocaleString()} flagged email${emailDisplay !== 1 ? 's' : ''}`);
    summary = parts.join(' · ');
  }

  el.innerHTML = base + (summary ? `<span style="display:block;font-size:13px;color:var(--text2);font-weight:400;margin-top:4px">${summary}</span>` : '');
}

// ============================================================
// INIT
// ============================================================
document.getElementById('greeting').textContent = getGreeting();
document.getElementById('greetingDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });

// Load user context, then flags, then connect & load data
loadUserContext().then(() => {
  loadFeatureFlags().then(() => {
    applyFeatureFlags();
    autoConnectCredentials().then(() => {
      Promise.all([loadActivities(), loadEmails(), loadCalendar(), loadHealth(), loadWeather(), loadMarket(), loadPersonalCalendar(), loadPersonalTasks(), loadCanonicalData()])
        .then(() => { updateGreeting(); if (checkFlag('auto_sync_on_load')) triggerCanonicalSync(); })
        .catch(() => { updateGreeting(); if (checkFlag('auto_sync_on_load')) triggerCanonicalSync(); });
    });
  });
});

// ============================================================
// AUTO-REFRESH — periodically reload data when enabled in Settings
// ============================================================
let autoRefreshTimer = null;
function startAutoRefresh() {
  stopAutoRefresh();
  if (!appSettings.autoRefresh) return;
  const interval = Math.max(1, appSettings.refreshInterval || 5) * 60 * 1000;
  autoRefreshTimer = setInterval(() => {
    console.log('Auto-refresh triggered');
    loadActivities();
    loadEmails();
    loadCalendar();
    loadHealth();
    loadWeather();
    loadMarket();
    loadCanonicalData();
    updateGreeting();
  }, interval);
}
function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}
// Start auto-refresh after initial load
setTimeout(startAutoRefresh, 5000);

// Also refresh when app regains focus (e.g., user switches back to PWA)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && appSettings.autoRefresh) {
    // Debounce: only refresh if > 2 minutes since last visibility change
    const lastRefresh = window._lastVisibilityRefresh || 0;
    const now = Date.now();
    if (now - lastRefresh > 120000) {
      window._lastVisibilityRefresh = now;
      loadActivities();
      loadEmails();
      loadCalendar();
      loadWeather();
      loadMarket();
      loadCanonicalData();
      updateGreeting();
    }
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ============================================================
// PWA INSTALL PROMPT
// ============================================================
let deferredPrompt = null;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  if (isStandalone) return; // already installed
  if (localStorage.getItem('lcc-install-dismissed')) return;

  const banner = document.createElement('div');
  banner.id = 'installBanner';
  banner.innerHTML = `
    <div style="position:fixed;bottom:0;left:0;right:0;z-index:9999;padding:12px 16px;
      background:linear-gradient(135deg,#1a1d27,#242836);border-top:1px solid var(--accent);
      display:flex;align-items:center;gap:12px;font-family:Outfit,sans-serif;
      padding-bottom:max(12px,env(safe-area-inset-bottom))">
      <img src="icons/icon-192.png" style="width:40px;height:40px;border-radius:10px" alt="LCC">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;color:var(--text);font-size:14px">Install Life Command Center</div>
        <div style="color:var(--text2);font-size:12px">Pin to taskbar &middot; Launch instantly &middot; Works offline</div>
      </div>
      <button onclick="installPWA()" style="background:var(--accent);color:#fff;border:none;
        padding:8px 16px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;
        white-space:nowrap;font-family:Outfit,sans-serif">Install</button>
      <button onclick="dismissInstall()" style="background:none;border:none;color:var(--text3);
        font-size:18px;cursor:pointer;padding:4px 8px">&times;</button>
    </div>`;
  document.body.appendChild(banner);
}

function installPWA() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(result => {
      deferredPrompt = null;
      const banner = document.getElementById('installBanner');
      if (banner) banner.remove();
      if (result.outcome === 'accepted') {
        showToast('LCC installed! Pin it to your taskbar for quick access.', 'success');
      }
    });
  }
}

function dismissInstall() {
  localStorage.setItem('lcc-install-dismissed', Date.now());
  const banner = document.getElementById('installBanner');
  if (banner) banner.remove();
}

// Show iOS-specific install hint (Safari doesn't fire beforeinstallprompt)
if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone && !isStandalone) {
  if (!localStorage.getItem('lcc-install-dismissed')) {
    setTimeout(() => {
      const iosBanner = document.createElement('div');
      iosBanner.id = 'installBanner';
      iosBanner.innerHTML = `
        <div style="position:fixed;bottom:0;left:0;right:0;z-index:9999;padding:16px;
          background:linear-gradient(135deg,#1a1d27,#242836);border-top:1px solid var(--accent);
          text-align:center;font-family:Outfit,sans-serif;
          padding-bottom:max(16px,env(safe-area-inset-bottom))">
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:6px">
            <img src="icons/icon-192.png" style="width:32px;height:32px;border-radius:8px" alt="LCC">
            <span style="font-weight:600;color:var(--text);font-size:14px">Install Life Command Center</span>
          </div>
          <div style="color:var(--text2);font-size:13px">
            Tap <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> then <strong style="color:var(--text)">"Add to Home Screen"</strong>
          </div>
          <button onclick="dismissInstall()" style="position:absolute;top:8px;right:12px;background:none;
            border:none;color:var(--text3);font-size:18px;cursor:pointer">&times;</button>
        </div>`;
      document.body.appendChild(iosBanner);
    }, 3000);
  }
}
