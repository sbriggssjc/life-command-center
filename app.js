// ============================================================
// SAFE DOM HELPERS
// ============================================================
function _setDisplay(id, val) { const el = document.getElementById(id); if (el) el.style.display = val; }
function _setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
function _setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

// ============================================================
// CONFIG & STATE
// ============================================================
const API = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot';
const CHAT_API = '/api/chat';

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
  team_queue_enabled: true,
  escalations_enabled: false,
  bulk_operations_enabled: false,
  domain_templates_enabled: false,
  domain_sync_enabled: false,
  mutation_fallback_enabled: false,
  ops_pages_enabled: true,
  more_drawer_enabled: true,
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
    // Use authenticated fetch if available (JWT mode), otherwise plain fetch (dev mode)
    const fetchFn = (typeof LCC_AUTH !== 'undefined' && LCC_AUTH.isAuthenticated) ? LCC_AUTH.apiFetch : fetch;
    const res = await fetchFn('/api/members?action=me');
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
    try { LCC_USER.display_name = localStorage.getItem('lcc-user-name') || 'Scott Briggs'; } catch(e) { LCC_USER.display_name = 'Scott Briggs'; }
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
let dailyBriefingSnapshot = null;
let dailyBriefingLoaded = false;
let dailyBriefingRoleView = 'broker';
let logCallData = {};
let govConnected = false;
let diaConnected = false;
let currentGovTab = 'overview';
let currentDiaTab = 'overview';
let currentGovGroup = 'overview';
let currentDiaGroup = 'overview';
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

const GOV_TAB_GROUPS = {
  overview: ['overview', 'search'],
  pipeline: ['pipeline', 'sales', 'prospects'],
  research: ['research', 'ownership'],
  reference: ['leases', 'loans', 'players']
};

const DIA_TAB_GROUPS = {
  overview: ['overview', 'search', 'changes', 'npi'],
  pipeline: ['activity', 'sales', 'prospects'],
  research: ['research'],
  reference: ['leases', 'loans', 'players']
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
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
// Safe JSON for embedding in HTML onclick attributes — escapes <, >, &, ', "
function safeJSON(obj) { return JSON.stringify(obj).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }

// Safe URL for href attributes — blocks javascript: and data: schemes
function safeHref(url) { if (!url) return '#'; const lower = url.trim().toLowerCase(); if (lower.startsWith('http://') || lower.startsWith('https://')) return esc(url); return '#'; }

// Build a reliable Outlook deep-link for a specific email.
// Priority: Graph webLink (stable) → REST id deeplink → internet_message_id fallback.
// Graph REST IDs change when emails move between folders, so we prefer the
// canonical webLink provided by the Graph API which survives folder moves.
function outlookWebLink(email) {
  // 1. Prefer Graph-supplied webLink / external_url — most reliable, survives moves.
  //    Normalise legacy OWA domain but keep deep-link params intact.
  const raw = email.external_url || email.web_link || email.outlook_link || '';
  if (raw) {
    return raw.replace('https://outlook.office365.com/owa/', 'https://outlook.office.com/mail/');
  }
  // 2. Fall back to Graph REST id deeplink (breaks if email is moved).
  const restId = email.id || email.email_id || (email.metadata && email.metadata.graph_rest_id) || '';
  if (restId) {
    return `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(restId)}`;
  }
  // 3. Last resort: internet_message_id search (least reliable)
  const inetId = email.internet_message_id || (email.metadata && email.metadata.internet_message_id) || '';
  if (inetId) {
    return `https://outlook.office.com/mail/inbox/id/${encodeURIComponent(inetId)}`;
  }
  return '';
}

// Display normalization — title case, clean formatting for consistent display
function norm(s) {
  if (!s) return '';
  s = String(s).trim();
  // Already mixed case (e.g., "DaVita") — leave as-is if has mix of upper/lower
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  // Title case: "BOYD WATTERSON GLOBAL" → "Boyd Watterson Global"
  return s.toLowerCase().replace(/(?:^|\s|[-\/\(])\S/g, c => c.toUpperCase());
}

// Operator name normalization — maps variant names to canonical names (Issue #4)
function normalizeOperatorName(name) {
  if (!name) return '';
  const canonical = {
    'davita': 'DaVita',
    'fresenius': 'Fresenius Medical Care',
    'fmc': 'Fresenius Medical Care',
    'fresenius medical care': 'Fresenius Medical Care',
    'us renal': 'US Renal Care',
    'us renal care': 'US Renal Care',
    'dialysis clinic': 'Dialysis Clinic Inc',
    'dialysis clinic inc': 'Dialysis Clinic Inc',
    'dci': 'Dialysis Clinic Inc',
    'american renal': 'American Renal Associates',
    'american renal associates': 'American Renal Associates'
  };
  const normalized = String(name).trim().toLowerCase();
  return canonical[normalized] || name;
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
  'persistent': 'Persistent',
  'missing_inventory_npi': 'Missing from Inventory',
  'duplicate_inventory_npi': 'Duplicate NPI',
  'snapshot_inventory_npi_mismatch': 'NPI Mismatch',
  'snapshot_npi_not_in_inventory': 'NPI Not in Inventory'
};
function cleanLabel(s) { return labelMap[s] || norm(s); }

function q(selector) { return document.querySelector(selector); }

function groupForTab(tabName, groups, fallback = 'overview') {
  for (const [group, tabs] of Object.entries(groups)) {
    if (tabs.includes(tabName)) return group;
  }
  return fallback;
}

function syncDomainTabGroup(domain, explicitTab) {
  const isGov = domain === 'government';
  const currentTab = explicitTab || (isGov ? currentGovTab : currentDiaTab);
  const groups = isGov ? GOV_TAB_GROUPS : DIA_TAB_GROUPS;
  const groupId = isGov ? 'govTabGroups' : 'diaTabGroups';
  const tabsId = isGov ? 'govInnerTabs' : 'diaInnerTabs';
  const attr = isGov ? 'govTab' : 'diaTab';
  const activeGroup = groupForTab(currentTab, groups, 'overview');

  if (isGov) currentGovGroup = activeGroup;
  else currentDiaGroup = activeGroup;

  document.querySelectorAll(`#${groupId} .domain-tab-group`).forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.group === activeGroup);
  });

  const allowedTabs = new Set(groups[activeGroup] || []);
  document.querySelectorAll(`#${tabsId} .gov-inner-tab`).forEach((btn) => {
    const tabName = btn.dataset[attr];
    btn.style.display = allowedTabs.has(tabName) ? '' : 'none';
    btn.classList.toggle('active', tabName === currentTab);
  });
}

window.syncDomainTabGroup = syncDomainTabGroup;

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
function localToday() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
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
  // Map pageBiz domain shortcuts to primary nav buttons
  if (pageId === 'pageDia' || pageId === 'pageGov') {
    const btn = document.querySelector(`.bnav[data-page="${pageId}"]`);
    if (btn) { btn.click(); return; }
  }
  // Try bottom nav button first
  const btn = document.querySelector(`.bnav[data-page="${pageId}"]`);
  if (btn) { btn.click(); return; }
  // Fall back to more drawer navigation
  navToFromMore(pageId);
}

function navToFromMore(pageId) {
  // Close more drawer instantly (skip CSS transition to avoid visual overlap)
  const overlay = document.getElementById('moreDrawerOverlay');
  const drawer = document.getElementById('moreDrawer');
  if (drawer) {
    drawer.style.transition = 'none';
    drawer.classList.remove('open');
    void drawer.offsetHeight;
    requestAnimationFrame(function() { drawer.style.transition = ''; });
  }
  if (overlay) {
    overlay.style.transition = 'none';
    overlay.classList.remove('open');
    requestAnimationFrame(function() { overlay.style.transition = ''; });
  }
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
  _setDisplay('bizSubTabs', pageId === 'pageBiz' ? 'flex' : 'none');
  _setDisplay('govTabGroups', 'none');
  _setDisplay('diaTabGroups', 'none');
  _setDisplay('govInnerTabs', 'none');
  _setDisplay('diaInnerTabs', 'none');
  // Trigger page-specific loading
  handlePageLoad(pageId);
}

function toggleMoreDrawer() {
  document.getElementById('moreDrawerOverlay')?.classList.toggle('open');
  document.getElementById('moreDrawer')?.classList.toggle('open');
}

// Pipeline tab switching
var currentPipelineTab = 'mywork';
document.getElementById('pipelineTabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.pipeline-tab');
  if (!tab) return;
  currentPipelineTab = tab.dataset.pipelineTab;
  document.querySelectorAll('.pipeline-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('pipelineMyWork').style.display = currentPipelineTab === 'mywork' ? '' : 'none';
  document.getElementById('pipelineTeam').style.display = currentPipelineTab === 'team' ? '' : 'none';
  if (currentPipelineTab === 'mywork' && typeof renderMyWork === 'function') renderMyWork();
  if (currentPipelineTab === 'team' && typeof renderTeamQueue === 'function') {
    if (!checkFlag('team_queue_enabled')) {
      const el = document.getElementById('teamQueueContent');
      if (el) el.innerHTML = '<div class="ops-empty">Team Queue is not yet enabled for this workspace.</div>';
    } else {
      renderTeamQueue();
    }
  }
});

// Centralized page load handler — fires ops.js renderers for canonical model pages
function handlePageLoad(pageId) {
  switch(pageId) {
    case 'pageHome':
      renderDailyBriefingPanel();
      if (!dailyBriefingLoaded) loadDailyBriefingData();
      break;
    case 'pagePipeline':
      if (currentPipelineTab === 'mywork') {
        if (typeof renderMyWork === 'function') renderMyWork();
      } else {
        if (!checkFlag('team_queue_enabled')) {
          const el = document.getElementById('teamQueueContent');
          if (el) el.innerHTML = '<div class="ops-empty">Team Queue is not yet enabled for this workspace.</div>';
        } else if (typeof renderTeamQueue === 'function') {
          renderTeamQueue();
        }
      }
      break;
    // Legacy aliases — redirect to Pipeline
    case 'pageMyWork': navTo('pagePipeline'); return;
    case 'pageTeamQueue': navTo('pagePipeline'); return;
    case 'pageInbox': if (typeof renderInboxTriage === 'function') renderInboxTriage(); break;
    case 'pageEntities': if (typeof renderEntitiesPage === 'function') renderEntitiesPage(); break;
    case 'pageResearch': if (typeof renderResearchPage === 'function') renderResearchPage(); break;
    case 'pageMetrics': if (typeof renderMetricsPage === 'function') renderMetricsPage(); break;
    case 'pageSyncHealth': if (typeof renderSyncHealthPage === 'function') renderSyncHealthPage(); break;
    case 'pageDataQuality': if (typeof renderDataQualityPage === 'function') renderDataQualityPage(); break;
    case 'pageCal': renderCalendarFull(); break;
    case 'pageBiz':
      if (currentBizTab === 'government') {
        _setDisplay('govTabGroups', 'flex');
        _setDisplay('govInnerTabs', 'flex');
        syncDomainTabGroup('government', currentGovTab);
        if (govConnected && !govDataLoaded) loadGovData();
        else renderBizContent();
      } else if (currentBizTab === 'dialysis') {
        _setDisplay('diaTabGroups', 'flex');
        _setDisplay('diaInnerTabs', 'flex');
        syncDomainTabGroup('dialysis', currentDiaTab);
        if (diaConnected && !diaDataLoaded) loadDiaData();
        else renderBizContent();
      } else {
        renderBizContent();
      }
      break;
    case 'pageContacts': if (typeof renderContactsPage === 'function') renderContactsPage(); break;
    case 'pageMessages': loadMessages(); break;
    case 'pageSettings': renderSettings(); break;
  }
}

const _toastQueue = [];
let _toastActive = false;
function showToast(msg, type = '') {
  _toastQueue.push({ msg, type });
  if (!_toastActive) _drainToast();
}
function _drainToast() {
  if (_toastQueue.length === 0) { _toastActive = false; return; }
  _toastActive = true;
  const { msg, type } = _toastQueue.shift();
  const t = document.getElementById('toast');
  if (!t) { _toastActive = false; return; }
  t.textContent = msg; t.className = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast'; setTimeout(_drainToast, 350); }, 3000);
}

/**
 * Anti-flicker DOM update — fades container to 0, replaces HTML, fades back in
 * Prevents visible flash when innerHTML rebuilds destroy the DOM
 */
function smoothDOMUpdate(container, html) {
  if (!container) return;
  container.style.transition = 'opacity 0.1s ease';
  container.style.opacity = '0.3';
  container.innerHTML = html;           // synchronous — DOM exists immediately for event listeners
  requestAnimationFrame(function() {
    container.style.opacity = '1';      // only the fade-in is deferred
  });
}
window.smoothDOMUpdate = smoothDOMUpdate;

// ── Custom Modal (async replacements for confirm/prompt) ──────────────
let _modalResolve = null;
let _modalPrevFocus = null;
let _modalIsPrompt = false;

function _isModalOpen() {
  const overlay = document.getElementById('lcc-modal-overlay');
  return overlay && overlay.style.display !== 'none';
}

function _showModal(msg, inputMode, defaultVal, okLabel) {
  // Race guard: if a modal is already open, resolve the old one with cancel before opening new
  if (_isModalOpen() && _modalResolve) {
    _modalResolve(_modalIsPrompt ? null : false);
    _modalResolve = null;
  }
  return new Promise(resolve => {
    _modalResolve = resolve;
    _modalIsPrompt = !!inputMode;
    _modalPrevFocus = document.activeElement;
    const overlay = document.getElementById('lcc-modal-overlay');
    const msgEl = document.getElementById('lcc-modal-msg');
    const inputWrap = document.getElementById('lcc-modal-input-wrap');
    const inputEl = document.getElementById('lcc-modal-input');
    const okBtn = document.getElementById('lcc-modal-ok');
    if (!overlay) { resolve(inputMode ? null : false); return; }
    msgEl.textContent = msg;
    okBtn.textContent = okLabel || 'Confirm';
    if (inputMode) {
      inputWrap.style.display = 'block';
      inputEl.value = defaultVal || '';
    } else {
      inputWrap.style.display = 'none';
    }
    overlay.style.display = 'flex';
    // Focus: input for prompts, OK button for confirms
    setTimeout(() => {
      if (inputMode) { inputEl.focus(); inputEl.select(); }
      else { okBtn.focus(); }
    }, 50);
  });
}

function _closeModal(val) {
  const overlay = document.getElementById('lcc-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  if (_modalResolve) { _modalResolve(val); _modalResolve = null; }
  // Restore focus to previous element
  if (_modalPrevFocus && typeof _modalPrevFocus.focus === 'function') {
    try { _modalPrevFocus.focus(); } catch (_) {}
    _modalPrevFocus = null;
  }
}

function _modalCancel() {
  _closeModal(_modalIsPrompt ? null : false);
}

document.addEventListener('DOMContentLoaded', () => {
  const okBtn = document.getElementById('lcc-modal-ok');
  const cancelBtn = document.getElementById('lcc-modal-cancel');
  const inputEl = document.getElementById('lcc-modal-input');
  const overlay = document.getElementById('lcc-modal-overlay');

  okBtn?.addEventListener('click', () => {
    if (_modalIsPrompt) {
      _closeModal(document.getElementById('lcc-modal-input')?.value ?? '');
    } else {
      _closeModal(true);
    }
  });
  cancelBtn?.addEventListener('click', _modalCancel);
  overlay?.addEventListener('click', e => {
    if (e.target.id === 'lcc-modal-overlay') _modalCancel();
  });

  // Keyboard: Enter to submit, Escape to cancel, Tab focus trap
  const modalEl = document.getElementById('lcc-modal');
  modalEl?.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      _modalCancel();
      return;
    }
    if (e.key === 'Enter' && e.target.id !== 'lcc-modal-cancel') {
      e.preventDefault();
      okBtn?.click();
      return;
    }
    // Focus trap: Tab wraps between Cancel and OK (and input if visible)
    if (e.key === 'Tab') {
      const focusable = (_modalIsPrompt ? [document.getElementById('lcc-modal-input')].filter(Boolean) : [])
        .concat(Array.from(modalEl.querySelectorAll('button'))).filter(el => !el.disabled);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });
});

function lccConfirm(msg, okLabel) { return _showModal(msg, false, null, okLabel); }
function lccPrompt(msg, defaultVal) { return _showModal(msg, true, defaultVal, 'OK'); }

function getGreeting() {
  const h = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Chicago' }), 10);
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
    const targetPage = btn.dataset.page;
    // Dialysis, Government, Marketing primary nav shortcuts — navigate to pageBiz with domain tab
    const domainShortcuts = { pageDia: 'dialysis', pageGov: 'government' };
    if (domainShortcuts[targetPage]) {
      document.querySelectorAll('.bnav').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.more-drawer-item').forEach(i => i.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const bizPage_ = document.getElementById('pageBiz');
      if (bizPage_) bizPage_.classList.add('active');
      _setDisplay('bizSubTabs', 'flex');
      switchBizTab(domainShortcuts[targetPage]);
      handlePageLoad('pageBiz');
      return;
    }
    document.querySelectorAll('.bnav').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.more-drawer-item').forEach(i => i.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(targetPage);
    if (page) page.classList.add('active');
    // Hide all secondary tab bars unless on Biz page
    _setDisplay('bizSubTabs', targetPage === 'pageBiz' ? 'flex' : 'none');
    _setDisplay('govTabGroups', 'none');
    _setDisplay('diaTabGroups', 'none');
    _setDisplay('govInnerTabs', 'none');
    _setDisplay('diaInnerTabs', 'none');
    handlePageLoad(targetPage);
  });
});

document.getElementById('bizSubTabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.sub-tab');
  if (!tab) return;
  // Ensure pageBiz is the active page (prevents overlay from pageHome/pageMyWork/etc.)
  const bizPage_ = document.getElementById('pageBiz');
  if (bizPage_ && !bizPage_.classList.contains('active')) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    bizPage_.classList.add('active');
  }
  // Sync primary nav active state for domain shortcuts
  const tabBiz = tab.dataset.biz;
  document.querySelectorAll('.bnav').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.more-drawer-item').forEach(i => i.classList.remove('active'));
  const primaryNavMap = { dialysis: 'pageDia', government: 'pageGov' };
  if (primaryNavMap[tabBiz]) {
    const navBtn = document.querySelector('.bnav[data-page="' + primaryNavMap[tabBiz] + '"]');
    if (navBtn) navBtn.classList.add('active');
  } else {
    // Other biz tabs (prospects, etc.) — highlight Business in More
    const moreItem = document.querySelector('.more-drawer-item[data-page="pageBiz"]');
    if (moreItem) moreItem.classList.add('active');
  }
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  currentBizTab = tab.dataset.biz;
  bizPage = 0;
  bizSearch = '';

  // Immediately clear the content area to prevent stale DOM from previous tab
  const innerEl = document.getElementById('bizPageInner');
  if (innerEl) innerEl.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading...</p></div>';

  _setDisplay('govTabGroups', currentBizTab === 'government' ? 'flex' : 'none');
  _setDisplay('diaTabGroups', currentBizTab === 'dialysis' ? 'flex' : 'none');
  _setDisplay('govInnerTabs', currentBizTab === 'government' ? 'flex' : 'none');
  _setDisplay('diaInnerTabs', currentBizTab === 'dialysis' ? 'flex' : 'none');

  if (currentBizTab === 'marketing') {
    _setDisplay('govTabGroups', 'none');
    _setDisplay('diaTabGroups', 'none');
    _setDisplay('govInnerTabs', 'none');
    _setDisplay('diaInnerTabs', 'none');
    loadMarketing();
  } else if (currentBizTab === 'prospects') {
    const el = document.getElementById('bizPageInner');
    if (el) el.innerHTML = renderProspects();
    setTimeout(() => { if (typeof initProspectsSearch === 'function') initProspectsSearch(); }, 0);
  } else if (currentBizTab === 'government') {
    if (!govConnected) showGovConnectionForm();
    else {
      syncDomainTabGroup('government', currentGovTab);
      if (typeof govDataLoaded !== 'undefined' && govDataLoaded) {
        renderGovTab();
      } else {
        loadGovData();
      }
    }
  } else if (currentBizTab === 'dialysis') {
    if (!diaConnected) {
      currentDiaTab = 'activity';
      currentDiaGroup = groupForTab('activity', DIA_TAB_GROUPS, 'pipeline');
      syncDomainTabGroup('dialysis', currentDiaTab);
      renderBizContent();
    } else {
      syncDomainTabGroup('dialysis', currentDiaTab);
      if (typeof diaDataLoaded !== 'undefined' && diaDataLoaded) {
        renderDiaTab();
      } else {
        loadDiaData();
      }
    }
  } else if (currentBizTab === 'other') {
    // All Other tab — show domain prospects if loaded, else trigger load first
    if (_mktOpportunitiesLoaded) {
      renderDomainProspects('all_other');
    } else if (typeof loadMarketing === 'function') {
      const el = document.getElementById('bizPageInner');
      if (el) el.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading prospects...</p></div>';
      loadMarketing().then(() => renderDomainProspects('all_other'));
    } else {
      renderBizContent();
    }
  } else {
    renderBizContent();
  }
});

document.getElementById('govInnerTabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.gov-inner-tab');
  if (!tab) return;
  currentGovTab = tab.dataset.govTab;
  syncDomainTabGroup('government', currentGovTab);
  if (currentGovTab === 'prospects') {
    // Prospects tab uses marketing data, not gov data
    if (_mktOpportunitiesLoaded) {
      renderDomainProspects('government');
    } else if (typeof loadMarketing === 'function') {
      const el = document.getElementById('bizPageInner');
      if (el) el.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading prospects...</p></div>';
      loadMarketing().then(() => renderDomainProspects('government'));
    }
  } else {
    renderGovTab();
  }
});

/** Navigate to a specific Government inner tab programmatically */
function goToGovTab(tabName) {
  currentGovTab = tabName;
  syncDomainTabGroup('government', tabName);
  if (tabName === 'prospects') {
    if (_mktOpportunitiesLoaded) renderDomainProspects('government');
    else if (typeof loadMarketing === 'function') {
      const el = document.getElementById('bizPageInner');
      if (el) el.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading prospects...</p></div>';
      loadMarketing().then(() => renderDomainProspects('government'));
    }
  } else {
    renderGovTab();
  }
}
window.goToGovTab = goToGovTab;

/** Switch to a specific Business domain sub-tab programmatically */
function switchBizTab(tabName) {
  const btn = document.querySelector('.sub-tab[data-biz="' + tabName + '"]');
  if (btn) btn.click();
}
window.switchBizTab = switchBizTab;

document.getElementById('diaInnerTabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.gov-inner-tab');
  if (!tab) return;
  currentDiaTab = tab.dataset.diaTab;
  syncDomainTabGroup('dialysis', currentDiaTab);
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

document.getElementById('govTabGroups')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.domain-tab-group');
  if (!btn) return;
  currentGovGroup = btn.dataset.group;
  const nextTab = GOV_TAB_GROUPS[currentGovGroup]?.[0] || 'overview';
  currentGovTab = nextTab;
  syncDomainTabGroup('government', currentGovTab);
  if (currentGovTab === 'prospects') {
    if (_mktOpportunitiesLoaded) renderDomainProspects('government');
    else if (typeof loadMarketing === 'function') loadMarketing().then(() => renderDomainProspects('government'));
  } else {
    renderGovTab();
  }
});

document.getElementById('diaTabGroups')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.domain-tab-group');
  if (!btn) return;
  currentDiaGroup = btn.dataset.group;
  const nextTab = DIA_TAB_GROUPS[currentDiaGroup]?.[0] || 'overview';
  currentDiaTab = nextTab;
  syncDomainTabGroup('dialysis', currentDiaTab);
  if (currentDiaTab === 'activity') {
    renderBizContent();
  } else if (currentDiaTab === 'prospects') {
    if (_mktOpportunitiesLoaded) renderDomainProspects('dialysis');
    else if (typeof loadMarketing === 'function') loadMarketing().then(() => renderDomainProspects('dialysis'));
  } else if (typeof diaDataLoaded !== 'undefined' && diaDataLoaded) {
    renderDiaTab();
  } else if (typeof loadDiaData === 'function') {
    loadDiaData();
  }
});

// Auto-resolve credentials from Vercel env vars
async function autoConnectCredentials() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) { console.warn('Config endpoint returned', res.status); return; }
    const cfg = await res.json();
    console.debug('Auto-connect config:', cfg);
    // Keys stay server-side in proxy endpoints — we just track connection status
    if (cfg.gov && cfg.gov.connected) {
      govConnected = true;
    }
    if (cfg.dia && cfg.dia.connected) {
      diaConnected = true;
    }
    console.debug('Auto-connect result:', { govConnected, diaConnected });
  } catch(e) {
    console.debug('Auto-connect: config endpoint unavailable', e);
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
  console.debug('renderBizContent:', { currentBizTab, currentDiaTab, govConnected, govDataLoaded, diaConnected, diaDataLoaded });
  // If marketing tab, just return — loadMarketing() is already called by setBizTab
  if (currentBizTab === 'marketing') {
    return;
  }
  // If prospects tab, render cross-project view
  if (currentBizTab === 'prospects') {
    const el = document.getElementById('bizPageInner');
    if (el) el.innerHTML = renderProspects();
    setTimeout(() => { if (typeof initProspectsSearch === 'function') initProspectsSearch(); }, 0);
    return;
  }
  // If "other" tab — show domain prospects if loaded, trigger load if not
  if (currentBizTab === 'other') {
    if (_mktOpportunitiesLoaded) {
      renderDomainProspects('all_other');
      return;
    } else if (typeof loadMarketing === 'function') {
      const innerEl = document.getElementById('bizPageInner');
      if (innerEl) innerEl.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading prospects...</p></div>';
      loadMarketing().then(() => renderDomainProspects('all_other'));
      return;
    }
  }
  // If government tab, route to gov.js
  if (currentBizTab === 'government') {
    if (!govConnected) { console.debug('→ showGovConnectionForm'); showGovConnectionForm(); return; }
    if (!govDataLoaded) { console.debug('→ loadGovData from renderBiz'); loadGovData(); return; }
    console.debug('→ renderGovTab'); renderGovTab();
    return;
  }
  // If dialysis tab with a data inner tab, route to dialysis.js
  if (currentBizTab === 'dialysis' && currentDiaTab !== 'activity') {
    if (!diaConnected) { console.debug('→ showDiaConnectionForm'); showDiaConnectionForm(); return; }
    if (!diaDataLoaded) { console.debug('→ loadDiaData from renderBiz'); loadDiaData(); return; }
    console.debug('→ renderDiaTab'); renderDiaTab();
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
      html += `<span class="pill" onclick="toggleBizCatFilter(this,decodeURIComponent('${encodeURIComponent(cat)}'))">${esc(cat)}<span class="pill-ct">${ct}</span></span>`;
    }
    html += '</div>';
  }

  html += `<div class="search-bar"><input class="search-input" type="text" placeholder="Search activities..." value="${esc(bizSearch)}" oninput="debounceBizSearch(this.value)"></div>`;

  if (pageItems.length === 0) {
    html += '<div style="text-align:center;padding:32px;color:var(--text2)">No activities match your filters.</div>';
  } else {
    for (const a of pageItems) {
      const sfBtn = a.sf_link ? `<a href="${safeHref(a.sf_link)}" target="_blank" rel="noopener" class="act-btn" onclick="event.stopPropagation()">&#x2197; Salesforce</a>` : '';
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
    const sfBtn = a.sf_link ? `<a href="${safeHref(a.sf_link)}" target="_blank" rel="noopener" class="act-btn" onclick="event.stopPropagation()">&#x2197; Salesforce</a>` : '';
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
let mktSource = 'all';    // 'all' | 'sf_deal' | 'rcm' | 'crexi' | 'loopnet' | 'leads' | 'unified'
let mktFilter = 'new';    // 'all' | 'upcoming' | 'overdue' | 'starred' | 'new' | 'unmatched'
let mktSort = 'date';     // 'date' | 'deal' — sort by recent activity or group by deal
let mktOwner = 'mine';    // 'mine' | 'all' | specific name
let mktDomain = 'all';    // 'all' | 'government' | 'dialysis' | 'all_other'
let mktSearch = '';
let mktPage = 0;
let mktShowArchived = false;   // Show archived/snoozed deals
let mktCallHistoryCache = {};  // sf_contact_id → [{date, notes, type}]
let mktExpandedDeal = null;    // deal name currently expanded to show call history

// Client-side domain classifier — mirrors SQL regex from v_opportunity_domain_classified
function classifyTaskDomain(subject, notes) {
  var text = ((subject || '') + ' ' + (notes || '')).trim();
  if (!text) return 'all_other';
  // Government patterns
  if (/(\bVA\b|veterans affairs|\bGSA\b|USDA|\bFBI\b|\bCBP\b|\bIRS\b|\bSSA\b|\bDOJ\b|\bDEA\b|\bUSPS\b|\bHHS\b|\bHUD\b|\bDOL\b|\bEPA\b|\bFAA\b|\bFEMA\b|\bFWS\b|Army|Navy|Air Force|Coast Guard|\bDHS\b|Homeland Security|\bACOE\b|Bureau of|Census|Customs|Federal |USCIS|\bICE\b|Secret Service|Marshal|Corps of Eng|Reclamation|\bBLM\b|Fish.*Wildlife|Forest Service|National Guard|National Preserve|\bNPS\b)/i.test(text)) return 'government';
  if (/(Dept\.?\s*of|Department of|County\s|City of\s|State of\s|Municipal|Probation|Corrections|\bDMV\b|Motor Vehicles|State Police|\bDOT\b|Dept of Health|\bDCFS\b|Public Safety|Sheriff|District Attorney)/i.test(text)) return 'government';
  if (/^[A-Z]{2}\s+Dept/i.test(subject || '')) return 'government';
  // Dialysis patterns
  if (/(dialysis|DaVita|Fresenius|\bFMC\b|kidney|renal|nephrology|Innovative Renal|\bDCI\b|Satellite Dial|U\.?S\.?\s*Renal|American Renal|Greenfield Renal)/i.test(text)) return 'dialysis';
  return 'all_other';
}

// ============================================================
// MARKETING — Archive/Snooze Management
// ============================================================

function getArchivedDeals() {
  try {
    const archived = localStorage.getItem('mkt-archived-deals');
    return archived ? JSON.parse(archived) : {};
  } catch (e) {
    console.warn('[Marketing] Failed to get archived deals:', e.message);
    return {};
  }
}

function archiveDeal(dealId) {
  try {
    const archived = getArchivedDeals();
    archived[dealId] = Date.now();
    localStorage.setItem('mkt-archived-deals', JSON.stringify(archived));
  } catch (e) {
    console.warn('[Marketing] Failed to archive deal:', e.message);
  }
}

function unarchiveDeal(dealId) {
  try {
    const archived = getArchivedDeals();
    delete archived[dealId];
    localStorage.setItem('mkt-archived-deals', JSON.stringify(archived));
  } catch (e) {
    console.warn('[Marketing] Failed to unarchive deal:', e.message);
  }
}

function isArchivedDeal(dealId) {
  const archived = getArchivedDeals();
  return !!archived[dealId];
}

async function bulkArchiveStaleDeals() {
  const today = localToday();
  const sixMonthsAgo = new Date(new Date(today + 'T00:00:00').getTime() - 180 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  const staleDeals = mktData.filter(d =>
    d.due_date && d.due_date < sixMonthsAgo && !isArchivedDeal(d.deal_name || d.item_id)
  );

  if (staleDeals.length === 0) {
    showToast('No deals older than 6 months to archive.', 'info');
    return;
  }

  const message = `Archive ${staleDeals.length} deal${staleDeals.length !== 1 ? 's' : ''} older than 6 months? They will be hidden from the list but can be revealed with "Show Archived".`;
  if (!(await lccConfirm(message, 'Archive'))) return;

  const btn = document.querySelector('[onclick*="bulkArchiveStaleDeals"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Archiving\u2026'; btn.style.opacity = '0.6'; }

  const dealIds = new Set();
  staleDeals.forEach(d => {
    const dealId = d.deal_name || d.item_id;
    if (dealId) dealIds.add(dealId);
  });

  dealIds.forEach(dealId => archiveDeal(dealId));

  showToast(`Archived ${dealIds.size} deal${dealIds.size !== 1 ? 's' : ''}.`, 'success');
  mktPage = 0;
  renderMarketing();
}

function getDaysOverdue(dueDate) {
  if (!dueDate) return 0;
  const due = new Date(dueDate + 'T00:00:00');
  const today = new Date(localToday() + 'T00:00:00');
  const diffMs = today.getTime() - due.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function formatDaysOverdue(days) {
  if (days < 30) return days + 'd overdue';
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months + 'mo overdue';
  }
  const years = Math.floor(days / 365);
  return years + 'y overdue';
}

// Classify a contact by looking at all their tasks + company name
function classifyContactDomain(contact) {
  var tasks = contact.open_tasks || [];
  // Check each task subject + notes
  for (var i = 0; i < tasks.length; i++) {
    var d = classifyTaskDomain(tasks[i].subject, tasks[i].notes);
    if (d !== 'all_other') return d;
  }
  // Also check company name as fallback
  var compDomain = classifyTaskDomain(contact.company_name, null);
  if (compDomain !== 'all_other') return compDomain;
  // Check from opportunity domain map if available
  return contact._opp_domain || 'all_other';
}
// Detect prospect/deal tasks by subject pattern even when nm_type is null
// Matches: "4 - DaVita MOB - City, ST", "ASC - Endoscopy Center - Pensacola, FL", etc.
function looksLikeProspectTask(t) {
  var subj = (t.subject || '').trim();
  if (!subj) return false;
  // Numbered pipeline stage: "4 - DaVita MOB - Charlottesville, VA"
  if (/^\d+\s*-\s/.test(subj)) return true;
  // "Tenant - City, ST" pattern: ends with " - City, XX" (2-letter state)
  if (/\s-\s[^-]+,\s*[A-Z]{2}\s*$/.test(subj)) return true;
  // Sold deals: "FMC Portfolio (9) - TN & AR - SOLD"
  if (/\bSOLD\s*$/i.test(subj)) return true;
  return false;
}

const MKT_PAGE = 20;

// Unified Contact Hub state
let ucLoaded = false;
let ucData = [];               // unified_contacts from Gov DB
let ucPage = 0;
let ucSearch = '';
let ucTotal = 0;
let ucDataQuality = null;      // {total_contacts, stale_emails, stale_phones, pending_merges}
let mktSearchTimeout;

// Domain-classified opportunities stored globally for domain tabs
window._mktOpportunities = { government: [], dialysis: [], all_other: [] };
// Contact cards with Opportunity-type tasks, routed to domain prospecting sections
window._mktProspectContacts = { government: [], dialysis: [], all_other: [] };
let _mktOpportunitiesLoaded = false;

// Prospect tab state per domain
let prospectPage = { government: 0, dialysis: 0, all_other: 0 };
let prospectOwner = { government: 'mine', dialysis: 'mine', all_other: 'mine' };
let prospectFilter = { government: 'all', dialysis: 'all', all_other: 'all' };
let prospectSearch = { government: '', dialysis: '', all_other: '' };
let prospectSearchTimeout = {};
const PROSPECT_PAGE = 20;

let _mktLoading = false;
async function loadMarketing() {
  if (_mktLoading) return; // Prevent double-load
  if (mktLoaded) { _mktLoading = false; renderMarketing(); return; } // Already loaded, just re-render
  const el = document.getElementById('bizPageInner');
  if (!el) return;
  _mktLoading = true;

  // Fire RCM backfill once per session — re-parses any raw leads and creates SF activities
  if (!window._rcmBackfillFired && currentBizTab === 'marketing') {
    window._rcmBackfillFired = true;
    fetch('/api/rcm-backfill', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(d) {
        if (d.ok && (d.reparsed > 0 || d.sf_activities_created > 0)) {
          console.debug('[RCM Backfill] reparsed=' + d.reparsed + ' sfCreated=' + d.sf_activities_created + ' matched=' + d.sf_matched);
          // Silently reload marketing data to pick up newly parsed leads
          mktLoaded = false;
          loadMarketing();
        } else {
          console.debug('[RCM Backfill] Nothing to backfill', d);
        }
      })
      .catch(function(e) {
        console.warn('[RCM Backfill] Skipped:', e.message);
        showToast('RCM backfill skipped: ' + e.message, 'warning');
      });
  }

  // If called just for domain prospects (not Marketing tab), only load opportunities
  if (currentBizTab !== 'marketing' && _mktOpportunitiesLoaded) {
    _mktLoading = false;
    return; // opportunities already loaded, nothing else needed
  }

  if (!mktLoaded) {
    if (currentBizTab === 'marketing') {
      el.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px" id="mktLoadStatus">Loading your CRM activity hub...</p></div>';
    }
    try {
      // Fetch domain-classified opportunities (for routing to domain tabs)
      // Fetch CRM tasks (calls, follow-ups — NOT opportunities)
      // Fetch inbound leads
      // Load CRM client rollup — paginated fetch (Supabase caps at 1000 rows per request)
      const userName = LCC_USER.display_name || 'Scott Briggs';
      const leanFields = 'sf_contact_id,sf_company_id,first_name,last_name,contact_name,company_name,email,phone,assigned_to,open_task_count,last_activity_date,completed_activity_count,last_call_notes';
      const BATCH_SIZE = 1000;

      function buildRollupUrl(selectFields, extraFilter, batchOffset) {
        var url = new URL('/api/dia-query', window.location.origin);
        url.searchParams.set('table', 'v_crm_client_rollup');
        url.searchParams.set('select', selectFields);
        url.searchParams.set('order', 'last_activity_date.desc.nullslast');
        url.searchParams.set('limit', String(BATCH_SIZE));
        url.searchParams.set('count', 'false');
        if (batchOffset > 0) url.searchParams.set('offset', String(batchOffset));
        if (extraFilter) {
          url.searchParams.set('filter', extraFilter);
        } else if (mktOwner === 'mine') {
          url.searchParams.set('filter', 'assigned_to=eq.' + userName);
        } else if (mktOwner !== 'all') {
          url.searchParams.set('filter', 'assigned_to=eq.' + mktOwner);
        }
        return url;
      }

      // Fetch with auto-retry: Supabase often returns 57014 timeout during initial load burst
      // Each attempt uses a 15-second AbortController timeout to prevent hanging forever
      async function fetchRollupWithRetry(url, retries) {
        for (var attempt = 0; attempt <= retries; attempt++) {
          try {
            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, 15000);
            var r = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!r.ok && attempt < retries) {
              console.warn('[Marketing] Rollup attempt ' + (attempt+1) + ' HTTP ' + r.status + ', retrying in 3s...');
              await new Promise(function(ok) { setTimeout(ok, 3000); });
              continue;
            }
            var d = await r.json();
            if (d.data && d.data.length > 0) return d.data;
            if (d.error && attempt < retries) {
              console.warn('[Marketing] Rollup attempt ' + (attempt+1) + ' failed: ' + (d.error || d.detail) + ', retrying in 3s...');
              await new Promise(function(ok) { setTimeout(ok, 3000); });
              continue;
            }
            return d.data || [];
          } catch(e) {
            if (e.name === 'AbortError') {
              console.warn('[Marketing] Rollup attempt ' + (attempt+1) + ' timed out after 15s');
            }
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
      let sfDealTasks = [];
      if (currentBizTab === 'marketing') {
        // Paginated fetch: load all contacts in batches of BATCH_SIZE
        async function fetchAllPages(selectFields, extraFilter) {
          var allRows = [];
          var batchOffset = 0;
          for (var page = 0; page < 50; page++) { // safety cap: 50 pages = 25,000 rows max
            var url = buildRollupUrl(selectFields, extraFilter, batchOffset);
            var batch = await fetchRollupWithRetry(url.toString(), 2);
            if (!batch || batch.length === 0) break;
            allRows = allRows.concat(batch);
            console.debug('[Marketing] Loaded page ' + (page + 1) + ': ' + batch.length + ' rows (total: ' + allRows.length + ')');
            var statusEl = document.getElementById('mktLoadStatus');
            if (statusEl) statusEl.textContent = 'Loading contacts... ' + allRows.length.toLocaleString() + ' rows';
            if (batch.length < BATCH_SIZE) break; // last page
            batchOffset += BATCH_SIZE;
          }
          return allRows;
        }

        const results = await Promise.all([
          fetchAllPages(leanFields, null),
          diaQuery('marketing_leads', '*', { filter: 'status=not.in.(archived,duplicate)', order: 'ingested_at.desc.nullslast', limit: 500 })
        ]);
        clientRollupRaw = results[0];
        leadsRaw = results[1];
        // v_sf_tasks_contact_rollup disabled — salesforce_tasks contains only stale
        // Data Loader bulk records from May 2020 (10k+ rows, all same owner_id).
        // Real open tasks come from v_crm_client_rollup (salesforce_activities).
        sfDealTasks = [];
        console.debug('[Marketing] Total contacts loaded: ' + clientRollupRaw.length);
        // Enrich contacts with open_tasks JSON via paginated fetch
        // No owner filter needed — we only merge into contacts already in the owner-filtered clientRollupRaw
        if (clientRollupRaw && clientRollupRaw.length > 0) {
          try {
            var statusEl = document.getElementById('mktLoadStatus');
            if (statusEl) statusEl.textContent = 'Enriching contacts with tasks...';
            const tasksData = await fetchAllPages('sf_contact_id,open_tasks', 'open_task_count=gt.0');
            if (tasksData && tasksData.length > 0) {
              const taskMap = {};
              tasksData.forEach(function(t) {
                var parsed = t.open_tasks;
                if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch(e) { parsed = []; } }
                taskMap[t.sf_contact_id] = parsed || [];
              });
              clientRollupRaw.forEach(function(c) {
                if (taskMap[c.sf_contact_id]) c.open_tasks = taskMap[c.sf_contact_id];
              });
              console.debug('[Marketing] Enriched ' + tasksData.length + ' contacts with open_tasks');
            }
          } catch(e) {
            console.warn('[Marketing] open_tasks enrichment failed, tasks will load on-demand:', e.message);
          }
        }
      }

      // Load opportunities separately — paginated to capture all rows (DB has 11K+)
      let opportunitiesRaw = [];
      try {
        let oppOffset = 0;
        const OPP_PAGE = 1000; // Must match PostgREST max-rows (1000)
        for (let pg = 0; pg < 15; pg++) { // safety cap: 15 pages = 15,000 rows max
          const batch = await diaQuery('v_opportunity_domain_classified', '*', { limit: OPP_PAGE, offset: oppOffset });
          if (!batch || batch.length === 0) break;
          opportunitiesRaw = opportunitiesRaw.concat(batch);
          console.debug('[Marketing] Opportunities page ' + (pg + 1) + ': ' + batch.length + ' rows (total: ' + opportunitiesRaw.length + ')');
          var statusEl = document.getElementById('mktLoadStatus');
          if (statusEl) statusEl.textContent = 'Loading opportunities... ' + opportunitiesRaw.length.toLocaleString() + ' rows';
          if (batch.length < OPP_PAGE) break;
          oppOffset += OPP_PAGE;
        }
      } catch (e) {
        console.warn('Opportunity domain query failed, will retry in 10s:', e.message);
      }
      // If empty (timeout), schedule a deferred retry with pagination
      if (!opportunitiesRaw || opportunitiesRaw.length === 0) {
        setTimeout(async () => {
          try {
            let retry = [], retryOffset = 0;
            const RETRY_PAGE = 1000; // Must match PostgREST max-rows (1000)
            for (let pg = 0; pg < 15; pg++) {
              const batch = await diaQuery('v_opportunity_domain_classified', '*', { limit: RETRY_PAGE, offset: retryOffset });
              if (!batch || batch.length === 0) break;
              retry = retry.concat(batch);
              if (batch.length < RETRY_PAGE) break;
              retryOffset += RETRY_PAGE;
            }
            if (retry && retry.length > 0) {
              const retryOpps = retry.map(d => {
                var te = { subject: d.deal_display_name || d.deal_name || 'Opportunity', date: d.activity_date, notes: d.nm_notes, type: 'Opportunity' };
                return {
                  pipeline_source: 'sf_deal', item_id: String(d.activity_id || ''), deal_name: d.deal_name,
                  deal_display_name: d.deal_display_name || d.deal_name, deal_priority: d.deal_priority,
                  contact_name: d.contact_name, first_name: d.first_name, last_name: d.last_name,
                  company_name: d.company_name, email: d.email, phone: d.phone,
                  sf_contact_id: d.sf_contact_id, sf_company_id: d.sf_company_id,
                  due_date: d.activity_date, notes: d.nm_notes, status: d.status,
                  assigned_to: d.assigned_to, activity_type: 'opportunity',
                  lead_source: null, sf_match_status: null, touchpoint_count: null,
                  ingested_at: d.created_at, domain: d.domain, prospect_domain: d.prospect_domain,
                  open_task_count: 1, open_tasks: [te]
                };
              });
              window._mktOpportunities = {
                government: retryOpps.filter(d => d.domain === 'government'),
                dialysis: retryOpps.filter(d => d.domain === 'dialysis'),
                all_other: retryOpps.filter(d => d.domain === 'all_other')
              };
              _mktOpportunitiesLoaded = true;
              console.debug('[Marketing] Deferred opportunity load succeeded:', retryOpps.length, 'records');
            }
          } catch (e2) { console.warn('Deferred opportunity retry also failed:', e2.message); }
        }, 10000);
      }

      // Store domain-classified opportunities globally for domain tabs
      const opps = (opportunitiesRaw || []).map(d => {
        var taskEntry = { subject: d.deal_display_name || d.deal_name || 'Opportunity', date: d.activity_date, notes: d.nm_notes, type: 'Opportunity' };
        return {
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
          prospect_domain: d.prospect_domain,
          open_task_count: 1,
          open_tasks: [taskEntry]
        };
      });
      window._mktOpportunities = {
        government: opps.filter(d => d.domain === 'government'),
        dialysis: opps.filter(d => d.domain === 'dialysis'),
        all_other: opps.filter(d => d.domain === 'all_other')
      };
      _mktOpportunitiesLoaded = true;

      // Build sf_contact_id → domain map from domain-classified opportunities
      const contactDomainMap = {};
      opps.forEach(function(o) {
        if (o.sf_contact_id && o.domain) contactDomainMap[o.sf_contact_id] = o.domain;
      });

      // Normalize client rollup to pipeline schema and split by task type:
      // - Opportunity-type tasks → route to domain prospect sections
      // - Non-Opportunity tasks → stay on marketing tab
      window._mktProspectContacts = { government: [], dialysis: [], all_other: [] };
      const tasks = [];
      (clientRollupRaw || []).forEach(function(d) {
        // Skip contacts with no name or placeholder — these show as "(Unknown)" and clutter the list
        if (!d.contact_name || !d.contact_name.trim() || d.contact_name.trim() === '(Unknown)') return;

        var allTasks = d.open_tasks || [];
        // Detect opportunity/prospect tasks: explicit type, deal_name, OR subject pattern
        var oppTasks = allTasks.filter(function(t) { return t.type === 'Opportunity' || (t.deal_name && t.deal_name.trim()) || looksLikeProspectTask(t); });
        var nonOppTasks = allTasks.filter(function(t) { return t.type !== 'Opportunity' && (!t.deal_name || !t.deal_name.trim()) && !looksLikeProspectTask(t); });

        // Base contact fields shared by both routes
        var base = {
          pipeline_source: 'sf_deal',
          item_id: d.sf_contact_id || '',
          deal_name: d.contact_name,
          deal_display_name: d.contact_name,
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
          assigned_to: d.assigned_to || 'Unassigned',
          activity_type: 'CRM',
          lead_source: null,
          sf_match_status: null,
          ingested_at: d.first_activity_date,
          opportunity_deals: d.opportunity_deals,
          total_deal_count: d.total_deal_count || 0,
          completed_activity_count: d.completed_activity_count || 0,
          last_call_notes: d.last_call_notes
        };

        // Determine contact's domain from opportunities or keyword classification
        var domain = contactDomainMap[d.sf_contact_id] || null;
        // If no domain from opportunities, classify from task subjects/notes/company
        if (!domain) {
          var tempContact = Object.assign({}, base, { open_tasks: allTasks, _opp_domain: null });
          domain = classifyContactDomain(tempContact);
        }

        // Route Opportunity tasks to domain prospecting sections
        if (oppTasks.length > 0) {
          var prospectContact = Object.assign({}, base, {
            open_task_count: oppTasks.length,
            open_tasks: oppTasks,
            touchpoint_count: oppTasks.length
          });
          window._mktProspectContacts[domain || 'all_other'].push(prospectContact);
        }

        // Route non-Opportunity tasks: gov/dialysis → domain sections, all_other → marketing
        // Only include contacts that have actionable open tasks (skip completed-history-only contacts)
        if (nonOppTasks.length > 0) {
          var contactRecord = Object.assign({}, base, {
            open_task_count: nonOppTasks.length,
            open_tasks: nonOppTasks,
            touchpoint_count: nonOppTasks.length,
            _opp_domain: domain,
            task_domain: domain || 'all_other'
          });
          // All non-Opportunity open tasks belong on the Marketing tab
          // Only Opportunity-type tasks route to domain prospect sections
          tasks.push(contactRecord);
        }
      });

      // Normalize leads to pipeline schema
      // Exclude leads already promoted to salesforce_activities (they show as CRM tasks instead)
      // Exclude leads with no identifiable name (show as Unknown)
      const leads = (leadsRaw || []).filter(l => !l.sf_activity_id).filter(l => {
        const name = l.lead_name || [l.lead_first_name, l.lead_last_name].filter(Boolean).join(' ');
        return name && name.trim();
      }).map(l => ({
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
        ingested_at: l.ingested_at,
        task_domain: 'all_other'
      }));

      // Merge deal-linked contacts from v_sf_tasks_contact_rollup
      // This view pre-joins salesforce_tasks (18-char who_id truncated to 15) with
      // salesforce_activities Opportunity contacts, enriching names/company/deal info.
      const sfTasksMerged = [];
      if (sfDealTasks && sfDealTasks.length > 0) {
        // Build set of contacts already in clientRollupRaw to avoid duplicates
        // Both sources use 15-char sf_contact_id (the view normalizes this)
        const existingContactIds = new Set();
        (clientRollupRaw || []).forEach(function(c) { if (c.sf_contact_id) existingContactIds.add(c.sf_contact_id); });

        sfDealTasks.forEach(function(c) {
          if (!c.sf_contact_id || existingContactIds.has(c.sf_contact_id)) return;
          // Skip contacts with no name or placeholder
          if (!c.contact_name || !c.contact_name.trim() || c.contact_name.trim() === '(Unknown)') return;
          var openTaskEntries = [];
          try {
            var ot = typeof c.open_tasks === 'string' ? JSON.parse(c.open_tasks) : c.open_tasks;
            if (Array.isArray(ot) && ot.length > 0) openTaskEntries = ot;
          } catch(e) { /* ignore parse errors */ }

          // Split tasks: deal_name, type, OR subject pattern → prospect; else → marketing
          var oppTasks = openTaskEntries.filter(function(t) {
            return t.type === 'Opportunity' || (t.deal_name && t.deal_name.trim()) || looksLikeProspectTask(t);
          });
          var nonOppTasks = openTaskEntries.filter(function(t) {
            return t.type !== 'Opportunity' && (!t.deal_name || !t.deal_name.trim()) && !looksLikeProspectTask(t);
          });

          var sfBase = {
            pipeline_source: 'sf_deal',
            item_id: c.sf_contact_id,
            deal_priority: null,
            contact_name: c.contact_name,
            first_name: c.first_name || '',
            last_name: c.last_name || '',
            company_name: c.company_name || '',
            email: c.email || '',
            phone: c.phone || '',
            sf_contact_id: c.sf_contact_id,
            sf_company_id: c.sf_company_id || null,
            due_date: c.last_activity_date,
            notes: '',
            status: 'Open',
            assigned_to: c.assigned_to || 'Unassigned',
            activity_type: 'CRM',
            lead_source: null,
            sf_match_status: null,
            ingested_at: null,
            _source: 'sf_tasks'
          };

          // Route opportunity-linked tasks to domain prospect sections
          if (oppTasks.length > 0) {
            var oppDealName = oppTasks[0].deal_name || '';
            var prospectContact = Object.assign({}, sfBase, {
              deal_name: oppDealName,
              deal_display_name: oppDealName || c.contact_name,
              open_task_count: oppTasks.length,
              open_tasks: oppTasks,
              touchpoint_count: oppTasks.length
            });
            var domain = contactDomainMap[c.sf_contact_id] || classifyContactDomain(prospectContact) || 'all_other';
            window._mktProspectContacts[domain].push(prospectContact);
          }

          // Non-opportunity tasks stay on marketing tab
          if (nonOppTasks.length > 0) {
            sfTasksMerged.push(Object.assign({}, sfBase, {
              deal_name: c.contact_name,
              deal_display_name: c.contact_name,
              open_task_count: nonOppTasks.length,
              open_tasks: nonOppTasks,
              touchpoint_count: nonOppTasks.length,
              task_domain: 'all_other'
            }));
          }
        });
        console.debug('[Marketing] Merged ' + sfTasksMerged.length + ' deal-linked contacts from v_sf_tasks_contact_rollup');
      }

      // Marketing tab only renders CRM tasks + leads + deal-linked tasks (NOT opportunities)
      mktData = [...tasks, ...sfTasksMerged, ...leads].sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return b.due_date.localeCompare(a.due_date); // DESC — most recent first
      });
      mktLoaded = true;

      // Preload unified contact data quality stats for badge display
      if (!ucDataQuality) {
        try {
          const ucHeaders = { 'Content-Type': 'application/json' };
          if (LCC_USER.workspace_id) ucHeaders['x-lcc-workspace'] = LCC_USER.workspace_id;
          const ucR = await fetch('/api/contacts?action=data_quality', { headers: ucHeaders });
          if (ucR.ok) ucDataQuality = await ucR.json();
        } catch (e) { console.warn('[Marketing] Data quality check failed:', e.message); }
      }

      // Badge: actionable CRM tasks due (calls due today + overdue follow-ups)
      const today = localToday();
      const actionableCount = mktData.filter(d => d.pipeline_source === 'sf_deal' && d.due_date && d.due_date <= today).length;
      const badge = document.getElementById('bizBadgeMkt');
      if (badge) badge.textContent = actionableCount || mktData.length;
      // Update domain badges with combined prospect + opportunity counts
      const otherBadge = document.getElementById('bizBadgeOther');
      if (otherBadge) otherBadge.textContent = ((window._mktOpportunities?.all_other?.length || 0) + (window._mktProspectContacts?.all_other?.length || 0)) || '—';
    } catch (e) {
      console.error('Marketing load error:', e);
      _mktLoading = false;
      // Show retry UI instead of permanent error so the tab isn't stuck
      el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text2)">'
        + '<div style="font-size:14px;color:var(--red);margin-bottom:12px">Unable to load CRM data</div>'
        + '<div style="font-size:12px;margin-bottom:16px">' + esc(e.message || 'Request timed out') + '</div>'
        + '<button onclick="mktLoaded=false;_mktLoading=false;loadMarketing()" style="padding:8px 20px;border-radius:8px;background:var(--accent);color:#fff;border:none;cursor:pointer;font-size:13px">Retry</button>'
        + '</div>';
      return;
    }
  }
  _mktLoading = false;

  renderMarketing();

  // Update home page stats now that CRM data is available (fixes "Open Activities: 0" on first load)
  if (document.getElementById('statActivities')) renderHomeStats();
  var ptEl = document.getElementById('priorityTasks');
  if (ptEl) ptEl.innerHTML = renderPriorityTasks();

  // If gov or dialysis prospects tab is currently visible, populate now that marketing data is ready
  // Guard with currentBizTab check to avoid overwriting marketing/other tab content
  if (currentBizTab === 'government' && typeof currentGovTab !== 'undefined' && currentGovTab === 'prospects') {
    renderDomainProspects('government');
  }
  if (currentBizTab === 'dialysis' && typeof currentDiaTab !== 'undefined' && currentDiaTab === 'prospects') {
    renderDomainProspects('dialysis');
  }
}

function renderMarketing() {
  const el = document.getElementById('bizPageInner');
  if (!el) return;

  const today = localToday();
  const userName = LCC_USER.display_name || 'Scott Briggs';

  // Filter out archived deals unless showing archived
  let filtered = mktData.filter(d => mktShowArchived || !isArchivedDeal(d.deal_name || d.item_id));

  // Owner filter
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

  // Domain filter
  if (mktDomain !== 'all') {
    filtered = filtered.filter(d => d.task_domain === mktDomain);
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

  // Domain prospect counts for quick reference (opportunities + prospect contacts)
  const govCount = (window._mktOpportunities?.government?.length || 0) + (window._mktProspectContacts?.government?.length || 0);
  const diaCount = (window._mktOpportunities?.dialysis?.length || 0) + (window._mktProspectContacts?.dialysis?.length || 0);
  const otherCount = (window._mktOpportunities?.all_other?.length || 0) + (window._mktProspectContacts?.all_other?.length || 0);

  // Task domain counts (from classified marketing contacts)
  const domainCounts = { government: 0, dialysis: 0, all_other: 0 };
  ownerFiltered.forEach(d => { if (d.task_domain) domainCounts[d.task_domain] = (domainCounts[d.task_domain] || 0) + 1; });

  let html = '';

  // Header
  html += '<div style="margin-bottom:12px"><h3 style="margin:0;color:var(--text)">Marketing</h3><div style="font-size:12px;color:var(--text3)">Calls, follow-ups & marketing tasks — Prospecting calls routed to domain tabs</div></div>';

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

  
  // Archive Stale button + Show Archived toggle
  const archivedCount = Object.keys(getArchivedDeals()).length;
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">';
  html += '<button class="btn btn-sm" style="font-size:11px;padding:4px 10px;cursor:pointer;background:var(--red);color:#fff" onclick="bulkArchiveStaleDeals()">Archive Stale (6mo+)</button>';
  if (archivedCount > 0) {
    html += '<span class="pill" style="cursor:pointer" onclick="mktShowArchived=!mktShowArchived;mktPage=0;renderMarketing()" title="Toggle archived deals">' + (mktShowArchived ? '✓ Show Archived' : 'Show Archived') + ' <span class="pill-ct">' + archivedCount + '</span></span>';
  }
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
  html += `<span class="pill ${mktSource==='unified'?'active':''}" onclick="mktSource='unified';ucPage=0;loadAndRenderUC()">Unified Contacts <span class="pill-ct">${ucDataQuality ? ucDataQuality.total_contacts || '—' : '—'}</span></span>`;
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

  // Domain filter
  html += '<div class="pills" style="margin-bottom:4px">';
  html += '<span style="font-size:11px;color:var(--text3);margin-right:6px">Domain:</span>';
  html += `<span class="pill ${mktDomain==='all'?'active':''}" onclick="mktDomain='all';mktPage=0;renderMarketing()">All</span>`;
  if (domainCounts.government > 0) html += `<span class="pill ${mktDomain==='government'?'active':''}" onclick="mktDomain='government';mktPage=0;renderMarketing()" style="${mktDomain==='government'?'':'border-color:var(--blue)'}">Gov <span class="pill-ct" style="background:var(--blue);color:#fff">${domainCounts.government}</span></span>`;
  if (domainCounts.dialysis > 0) html += `<span class="pill ${mktDomain==='dialysis'?'active':''}" onclick="mktDomain='dialysis';mktPage=0;renderMarketing()" style="${mktDomain==='dialysis'?'':'border-color:var(--green)'}">Dialysis <span class="pill-ct" style="background:var(--green);color:#fff">${domainCounts.dialysis}</span></span>`;
  if (domainCounts.all_other > 0) html += `<span class="pill ${mktDomain==='all_other'?'active':''}" onclick="mktDomain='all_other';mktPage=0;renderMarketing()">Other <span class="pill-ct">${domainCounts.all_other}</span></span>`;
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
    // Group contacts by their open task subjects (non-Opportunity tasks only on marketing tab)
    var dealGroups = {};
    filtered.forEach(function(c) {
      var tasks = c.open_tasks || [];
      if (tasks.length > 0) {
        tasks.forEach(function(t) {
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
      html += '<div style="text-align:center;padding:32px;color:var(--text2)">No contacts with open tasks found. Try "Recent Activity" sort.</div>';
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
          var sfLnk = c.sf_contact_id ? '<a href="https://northmarqcapital.lightning.force.com/lightning/r/Contact/' + encodeURIComponent(c.sf_contact_id) + '/view" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open in Salesforce" style="color:var(--text);text-decoration:none;border-bottom:1px dashed var(--text3)">' + esc(c.contact_name || '—') + '</a>' : esc(c.contact_name || '—');
          html += '<div style="font-size:13px;font-weight:500">' + sfLnk + '</div>';
          html += '<div style="font-size:12px;color:var(--text2)">' + esc(c.company_name || '');
          if (c.email) html += ' · <a href="mailto:' + encodeURIComponent(c.email) + '">' + esc(c.email) + '</a>';
          html += '</div>';
          if (c.phone) html += '<div style="font-size:12px;color:var(--text3)">' + esc(c.phone) + '</div>';
          html += '</div>';
          html += '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">';
          if (c.email) html += '<a href="mailto:' + encodeURIComponent(c.email) + '" class="act-btn" style="font-size:11px;padding:4px 8px">&#x2709;</a>';
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
// UNIFIED CONTACT HUB — load, render, classify
// ============================================================

async function loadUnifiedContacts(search) {
  const params = new URLSearchParams({
    action: 'list',
    contact_class: 'business',
    limit: '50',
    offset: String(ucPage * 50)
  });
  if (search) params.set('search', search);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    const r = await fetch('/api/contacts?' + params.toString(), { headers });
    if (r.ok) {
      const d = await r.json();
      ucData = d.contacts || [];
      ucTotal = d.total || 0;
      ucLoaded = true;
      window._ucLoadError = null;
    } else {
      const errData = await r.json().catch(() => ({}));
      console.warn('[UnifiedContacts] API error:', r.status, errData);
      ucData = [];
      ucLoaded = true;
      window._ucLoadError = errData.error || `API returned ${r.status}`;
    }
  } catch (e) {
    console.warn('[UnifiedContacts] Load error:', e.message);
    ucData = [];
    ucLoaded = true;
    window._ucLoadError = 'Network error: ' + e.message;
  }
  // Load data quality stats once
  if (!ucDataQuality) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
      const r2 = await fetch('/api/contacts?action=data_quality', { headers });
      if (r2.ok) ucDataQuality = await r2.json();
    } catch (e) { console.warn('[Contacts] Data quality stats failed:', e.message); }
  }
}

function renderUnifiedContacts() {
  let html = '';
  html += '<div style="margin-bottom:12px"><h3 style="margin:0;color:var(--text)">Unified Contact Hub</h3>';
  html += '<div style="font-size:12px;color:var(--text3)">Contacts synced across Salesforce, Outlook, Calendar, WebEx, iPhone — business contacts only</div></div>';

  // Data quality + engagement widget
  if (ucDataQuality) {
    html += '<div class="widget-grid" style="margin-bottom:12px">';
    html += '<div class="stat-card"><div class="stat-label">Total Contacts</div><div class="stat-value" style="color:var(--accent)">' + (ucDataQuality.total_contacts || 0) + '</div></div>';
    html += '<div class="stat-card" style="cursor:pointer" onclick="loadHotLeads()"><div class="stat-label">Hot Leads</div><div class="stat-value" style="color:var(--red)">' + (ucDataQuality.hot_leads || 0) + '</div><div class="stat-sub">Score &ge; 60</div></div>';
    html += '<div class="stat-card"><div class="stat-label">WebEx Linked</div><div class="stat-value" style="color:var(--green)">' + (ucDataQuality.webex_linked || 0) + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Stale Data</div><div class="stat-value" style="color:' + (((ucDataQuality.stale_emails || 0) + (ucDataQuality.stale_phones || 0)) > 0 ? 'var(--orange)' : 'var(--green)') + '">' + ((ucDataQuality.stale_emails || 0) + (ucDataQuality.stale_phones || 0)) + '</div><div class="stat-sub">' + (ucDataQuality.stale_emails || 0) + ' email · ' + (ucDataQuality.stale_phones || 0) + ' phone</div></div>';
    html += '<div class="stat-card" style="cursor:pointer" onclick="loadMergeQueue()"><div class="stat-label">Merge Queue</div><div class="stat-value" style="color:' + (ucDataQuality.pending_merges > 0 ? 'var(--red)' : 'var(--green)') + '">' + (ucDataQuality.pending_merges || 0) + '</div><div class="stat-sub">Click to review</div></div>';
    html += '</div>';
    // Sync action buttons
    html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
    html += '<button class="btn btn-sm" onclick="runCalendarContactSync()" id="btn-cal-sync" style="font-size:11px;padding:4px 10px;cursor:pointer">Sync Calendar Contacts</button>';
    html += '<button class="btn btn-sm" onclick="runDuplicateDetection()" id="btn-dedup" style="font-size:11px;padding:4px 10px;cursor:pointer">Run Duplicate Detection</button>';
    html += '</div>';
  }

  // Search
  html += '<div class="search-bar" style="margin-bottom:8px"><input class="search-input" type="text" autocomplete="off" placeholder="Search unified contacts by name, email, company, phone..." value="' + esc(ucSearch) + '" oninput="debounceUcSearch(this.value)"></div>';

  if (!ucLoaded) {
    html += '<div style="text-align:center;padding:32px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading unified contacts...</p></div>';
    return html;
  }

  if (window._ucLoadError) {
    html += '<div style="text-align:center;padding:32px;color:var(--red)">';
    html += '<div style="font-size:14px;font-weight:600;margin-bottom:8px">Failed to load contacts</div>';
    html += '<div style="font-size:12px;color:var(--text3);margin-bottom:12px">' + esc(window._ucLoadError) + '</div>';
    html += '<button class="btn btn-sm" onclick="ucLoaded=false;window._ucLoadError=null;loadAndRenderUC()" style="font-size:11px;padding:4px 12px;cursor:pointer">Retry</button>';
    html += '</div>';
    return html;
  }

  if (ucData.length === 0) {
    html += '<div style="text-align:center;padding:32px;color:var(--text2)">No contacts found.' + (ucSearch ? ' Try a different search.' : '') + '</div>';
    return html;
  }

  // Contact cards
  ucData.forEach(function(c) {
    var sources = [];
    if (c.sf_contact_id) sources.push('<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#1a73e8;color:#fff">SF</span>');
    if (c.outlook_contact_id) sources.push('<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#0078d4;color:#fff">Outlook</span>');
    if (c.last_synced_calendar) sources.push('<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#0b8043;color:#fff">Calendar</span>');
    if (c.webex_person_id) sources.push('<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#00b140;color:#fff">WebEx</span>');
    if (c.teams_user_id) sources.push('<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#6264a7;color:#fff">Teams</span>');
    if (c.icloud_contact_id) sources.push('<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#a2aaad;color:#fff">iPhone</span>');
    if (c.gov_contact_id) sources.push('<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#5f6368;color:#fff">Gov</span>');
    var staleFlags = [];
    if (c.email_stale) staleFlags.push('<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:var(--orange);color:#fff">Email Stale</span>');
    if (c.phone_stale) staleFlags.push('<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:var(--orange);color:#fff">Phone Stale</span>');

    // Engagement score heat badge
    var engScore = c.engagement_score || 0;
    var heatBadge = '';
    if (engScore >= 60) heatBadge = '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#d32f2f;color:#fff;font-weight:700" title="Engagement: ' + engScore + '/100">HOT ' + engScore + '</span>';
    else if (engScore >= 30) heatBadge = '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#f57c00;color:#fff;font-weight:700" title="Engagement: ' + engScore + '/100">WARM ' + engScore + '</span>';
    else if (engScore > 0) heatBadge = '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#1565c0;color:#fff" title="Engagement: ' + engScore + '/100">COOL ' + engScore + '</span>';

    html += '<div class="widget" style="padding:12px">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between">';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-size:14px;font-weight:500;display:flex;align-items:center;gap:6px">' + esc(c.full_name || c.first_name || c.last_name || '—');
    if (heatBadge) html += ' ' + heatBadge;
    if (c.title) html += ' <span style="font-size:11px;color:var(--text3)">' + esc(c.title) + '</span>';
    html += '</div>';
    html += '<div style="font-size:12px;color:var(--text2)">' + esc(c.company_name || '');
    if (c.email) html += ' · <a href="mailto:' + encodeURIComponent(c.email) + '">' + esc(c.email) + '</a>';
    html += '</div>';
    if (c.phone) html += '<div style="font-size:12px;color:var(--text3)">' + esc(c.phone) + (c.mobile_phone && c.mobile_phone !== c.phone ? ' · Mobile: ' + esc(c.mobile_phone) : '') + '</div>';
    if (c.city || c.state) html += '<div style="font-size:11px;color:var(--text3)">' + esc([c.city, c.state].filter(Boolean).join(', ')) + '</div>';
    // Source badges + stale flags
    if (sources.length > 0 || staleFlags.length > 0) {
      html += '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">' + sources.join('') + staleFlags.join('') + '</div>';
    }
    // Engagement activity summary
    if (c.total_calls > 0 || c.total_emails_sent > 0 || c.last_meeting_date) {
      html += '<div style="font-size:11px;color:var(--text3);margin-top:3px">';
      var engParts = [];
      if (c.total_calls > 0) engParts.push(c.total_calls + ' call' + (c.total_calls > 1 ? 's' : '') + (c.last_call_date ? ' (last: ' + c.last_call_date.split('T')[0] + ')' : ''));
      if (c.total_emails_sent > 0) engParts.push(c.total_emails_sent + ' email' + (c.total_emails_sent > 1 ? 's' : ''));
      if (c.last_meeting_date) engParts.push('Last meeting: ' + c.last_meeting_date.split('T')[0]);
      html += engParts.join(' · ');
      html += '</div>';
    }
    // Contact type / entity type
    if (c.contact_type || c.entity_type) {
      html += '<div style="font-size:11px;color:var(--text3);margin-top:2px">';
      if (c.contact_type) html += esc(c.contact_type);
      if (c.contact_type && c.entity_type) html += ' · ';
      if (c.entity_type) html += esc(c.entity_type);
      html += '</div>';
    }
    html += '</div>';

    // Actions
    html += '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px;flex-wrap:wrap;justify-content:flex-end;align-items:center">';
    // Personal/Business toggle
    html += '<button class="act-btn" style="font-size:10px;padding:3px 6px" onclick="ucToggleClass(decodeURIComponent(\'' + encodeURIComponent(c.unified_id) + '\'),\'' + (c.contact_class === 'business' ? 'personal' : 'business') + '\')" title="Reclassify">' + (c.contact_class === 'business' ? 'Move to Personal' : 'Move to Business') + '</button>';
    if (c.email) html += '<a href="mailto:' + encodeURIComponent(c.email) + '" class="act-btn" style="font-size:11px;padding:4px 8px">&#x2709;</a>';
    if (c.phone) {
      var cleanPhone = (c.phone || '').replace(/[^+0-9]/g, '');
      html += '<a href="webexteams://call?uri=' + encodeURIComponent(cleanPhone) + '" class="act-btn" style="font-size:11px;padding:4px 8px" title="Call via WebEx">&#x1F4DE;</a>';
    }
    if (c.sf_contact_id) {
      var logData = safeJSON({sf_contact_id:c.sf_contact_id||'',sf_company_id:c.sf_account_id||'',name:c.full_name||c.company_name||''});
      html += '<button class="act-btn primary" style="font-size:11px;padding:4px 8px" onclick="openLogCall(' + logData + ')">Log</button>';
    }
    html += '</div></div>';

    // Messaging section — expandable, loads on demand
    var hasTeams = !!(c.email || c.teams_user_id);
    var hasWebex = !!(c.email || c.webex_person_id);
    var hasSms = !!(c.phone || c.mobile_phone);
    if (hasTeams || hasWebex || hasSms) {
      html += '<div style="border-top:1px solid var(--border);margin-top:8px;padding-top:6px">';
      html += '<div style="display:flex;align-items:center;gap:6px;cursor:pointer" onclick="ucToggleMessages(decodeURIComponent(\'' + encodeURIComponent(c.unified_id) + '\'))">';
      html += '<span style="font-size:11px;color:var(--text2);font-weight:500">Messages</span>';
      html += '<span id="ucMsgArrow_' + esc(c.unified_id) + '" style="font-size:9px;color:var(--text3);transition:transform .2s">&#x25B6;</span>';
      // Channel tabs (shown as small badges)
      if (hasTeams) html += '<span style="font-size:8px;padding:1px 4px;border-radius:2px;background:#6264a7;color:#fff;opacity:0.7">Teams</span>';
      if (hasWebex) html += '<span style="font-size:8px;padding:1px 4px;border-radius:2px;background:#00b140;color:#fff;opacity:0.7">WebEx</span>';
      if (hasSms) html += '<span style="font-size:8px;padding:1px 4px;border-radius:2px;background:#555;color:#fff;opacity:0.7">SMS</span>';
      html += '</div>';
      html += '<div id="ucMsgPanel_' + esc(c.unified_id) + '" style="display:none;margin-top:6px" data-loaded="false" data-channel="" data-teams="' + (hasTeams?1:0) + '" data-webex="' + (hasWebex?1:0) + '" data-sms="' + (hasSms?1:0) + '" data-email="' + esc(c.email||'') + '" data-phone="' + esc(c.mobile_phone||c.phone||'') + '" data-name="' + esc(c.first_name||'') + '"></div>';
      html += '</div>';
    }

    html += '</div>';
  });

  // Pager
  var totalPages = Math.ceil(ucTotal / 50);
  if (totalPages > 1) {
    html += '<div class="pager"><button onclick="ucPage--;loadAndRenderUC()" ' + (ucPage === 0 ? 'disabled' : '') + '>&#x2190; Prev</button><span>Page ' + (ucPage + 1) + ' of ' + totalPages + ' · ' + ucTotal + ' contacts</span><button onclick="ucPage++;loadAndRenderUC()" ' + (ucPage >= totalPages - 1 ? 'disabled' : '') + '>Next &#x2192;</button></div>';
  }

  return html;
}

// Debounce for unified contacts search
let ucSearchTimeout;
function debounceUcSearch(val) {
  ucSearch = val;
  ucPage = 0;
  clearTimeout(ucSearchTimeout);
  ucSearchTimeout = setTimeout(function() { loadAndRenderUC(); }, 300);
}

// Load and render unified contacts into the marketing panel
async function loadAndRenderUC() {
  const el = document.getElementById('bizPageInner');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading unified contacts...</p></div>';
  await loadUnifiedContacts(ucSearch);
  try {
    el.innerHTML = renderUnifiedContacts();
  } catch (e) {
    console.error('[UnifiedContacts] Render error:', e);
    el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--red)"><div style="font-size:14px;font-weight:600;margin-bottom:8px">Render error</div><div style="font-size:12px;color:var(--text3)">' + esc(e.message) + '</div><button class="btn btn-sm" onclick="ucLoaded=false;window._ucLoadError=null;loadAndRenderUC()" style="margin-top:12px;font-size:11px;padding:4px 12px;cursor:pointer">Retry</button></div>';
  }
}

// Reclassify a contact between personal and business
async function ucToggleClass(unifiedId, newClass) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    const r = await fetch('/api/contacts?action=classify&id=' + unifiedId, {
      method: 'POST', headers, body: JSON.stringify({ contact_class: newClass })
    });
    if (r.ok) {
      // Refresh the list
      await loadAndRenderUC();
    } else {
      console.error('Classify failed:', await r.text());
    }
  } catch (e) {
    console.error('Classify error:', e.message);
  }
}

// ============================================================
// CONTACT MESSAGING — in-app Teams, WebEx, SMS
// ============================================================

// Cached message templates
let ucMsgTemplates = null;

function ucToggleMessages(unifiedId) {
  var panel = document.getElementById('ucMsgPanel_' + unifiedId);
  var arrow = document.getElementById('ucMsgArrow_' + unifiedId);
  if (!panel) return;
  var isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (arrow) arrow.style.transform = isHidden ? 'rotate(90deg)' : '';
  // Load on first expand
  if (isHidden && panel.dataset.loaded === 'false') {
    // Determine default channel
    var ch = panel.dataset.teams === '1' ? 'teams' : panel.dataset.webex === '1' ? 'webex' : 'sms';
    ucLoadChannelMessages(unifiedId, ch);
  }
}

async function ucLoadChannelMessages(unifiedId, channel) {
  var panel = document.getElementById('ucMsgPanel_' + unifiedId);
  if (!panel) return;
  panel.dataset.channel = channel;
  panel.dataset.loaded = 'true';

  // Load templates if not cached
  if (!ucMsgTemplates) {
    try {
      var headers = { 'Content-Type': 'application/json' };
      if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
      var tr = await fetch('/api/contacts?action=message_templates', { headers });
      if (tr.ok) { var td = await tr.json(); ucMsgTemplates = td.templates || []; }
    } catch(e) { ucMsgTemplates = []; }
  }

  // Render channel tabs + loading state
  var hasTeams = panel.dataset.teams === '1';
  var hasWebex = panel.dataset.webex === '1';
  var hasSms = panel.dataset.sms === '1';
  var contactName = panel.dataset.name || '';

  var tabsHtml = '<div style="display:flex;gap:4px;margin-bottom:6px">';
  var encId = encodeURIComponent(unifiedId);
  if (hasTeams) tabsHtml += '<button class="act-btn' + (channel === 'teams' ? ' primary' : '') + '" style="font-size:10px;padding:2px 8px" onclick="ucLoadChannelMessages(decodeURIComponent(\'' + encId + '\'),\'teams\')">Teams</button>';
  if (hasWebex) tabsHtml += '<button class="act-btn' + (channel === 'webex' ? ' primary' : '') + '" style="font-size:10px;padding:2px 8px" onclick="ucLoadChannelMessages(decodeURIComponent(\'' + encId + '\'),\'webex\')">WebEx</button>';
  if (hasSms) tabsHtml += '<button class="act-btn' + (channel === 'sms' ? ' primary' : '') + '" style="font-size:10px;padding:2px 8px" onclick="ucLoadChannelMessages(decodeURIComponent(\'' + encId + '\'),\'sms\')">SMS</button>';
  tabsHtml += '</div>';

  panel.innerHTML = tabsHtml + '<div style="text-align:center;padding:12px;color:var(--text3);font-size:11px"><span class="spinner" style="width:14px;height:14px"></span> Loading messages...</div>';

  // Fetch messages
  try {
    var headers = { 'Content-Type': 'application/json' };
    if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    var action = channel === 'teams' ? 'messages_teams' : channel === 'webex' ? 'messages_webex' : 'messages_sms';
    var r = await fetch('/api/contacts?action=' + action + '&id=' + encodeURIComponent(unifiedId) + '&limit=10', { headers });
    var data = r.ok ? await r.json() : { messages: [], error: 'Failed to load' };
    var msgs = data.messages || [];

    var msgsHtml = tabsHtml;

    // Message list
    if (msgs.length === 0) {
      msgsHtml += '<div style="text-align:center;padding:8px;color:var(--text3);font-size:11px">' + esc(data.note || data.error || 'No messages yet') + '</div>';
    } else {
      msgsHtml += '<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:6px;margin-bottom:6px;background:var(--bg2)">';
      // Reverse to show oldest first (API returns newest first)
      msgs.reverse().forEach(function(m) {
        var isMe = m.is_from_me || m.direction === 'outbound';
        var time = m.created_at ? new Date(m.created_at).toLocaleString(undefined, {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
        var content = m.content_type === 'html' ? (m.content || '').replace(/<[^>]+>/g, '') : (m.content || '');
        if (content.length > 200) content = content.substring(0, 200) + '...';
        msgsHtml += '<div style="margin-bottom:4px;text-align:' + (isMe ? 'right' : 'left') + '">';
        msgsHtml += '<div style="display:inline-block;max-width:80%;padding:4px 8px;border-radius:8px;font-size:11px;background:' + (isMe ? 'var(--accent)' : 'var(--bg3)') + ';color:' + (isMe ? '#fff' : 'var(--text)') + '">' + esc(content) + '</div>';
        msgsHtml += '<div style="font-size:9px;color:var(--text3);margin-top:1px">' + (isMe ? 'You' : esc(m.from || '')) + ' · ' + time + '</div>';
        msgsHtml += '</div>';
      });
      msgsHtml += '</div>';
    }

    // Compose area with template selector
    var channelTemplates = (ucMsgTemplates || []).filter(function(t) { return t && t.channels && t.channels.indexOf(channel) >= 0; });
    msgsHtml += '<div style="display:flex;gap:4px;align-items:flex-end">';
    if (channelTemplates.length > 0) {
      msgsHtml += '<select style="font-size:10px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);max-width:120px" onchange="ucApplyTemplate(decodeURIComponent(\'' + encId + '\'),this.value,decodeURIComponent(\'' + encodeURIComponent(contactName) + '\'))">';
      msgsHtml += '<option value="">Template...</option>';
      channelTemplates.forEach(function(t) {
        msgsHtml += '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
      });
      msgsHtml += '</select>';
    }
    msgsHtml += '<input id="ucMsgInput_' + esc(unifiedId) + '" type="text" placeholder="Type a message..." style="flex:1;font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)" onkeydown="if(event.key===\'Enter\')ucSendMessage(decodeURIComponent(\'' + encId + '\'),\'' + channel + '\')">';
    var sendLabel = channel === 'teams' ? 'Send via Teams' : channel === 'webex' ? 'Send via WebEx' : 'Send SMS';
    msgsHtml += '<button class="act-btn primary" style="font-size:10px;padding:4px 8px;white-space:nowrap" onclick="ucSendMessage(decodeURIComponent(\'' + encId + '\'),\'' + channel + '\')">' + sendLabel + '</button>';
    msgsHtml += '</div>';

    panel.innerHTML = msgsHtml;
  } catch (e) {
    panel.innerHTML = tabsHtml + '<div style="color:var(--red);font-size:11px;padding:8px">Error loading messages: ' + esc(e.message) + '</div>';
  }
}

function ucApplyTemplate(unifiedId, templateId, contactName) {
  if (!templateId) return;
  var tpl = (ucMsgTemplates || []).find(function(t) { return t.id === templateId; });
  if (!tpl) return;
  var input = document.getElementById('ucMsgInput_' + unifiedId);
  if (!input) return;
  // Simple token replacement
  var msg = tpl.template
    .replace('{first_name}', contactName || 'there')
    .replace('{deal_name}', 'your property')
    .replace('{rate}', '4.25')
    .replace('{deal_type}', 'multifamily');
  input.value = msg;
  input.focus();
}

async function ucSendMessage(unifiedId, channel) {
  var input = document.getElementById('ucMsgInput_' + unifiedId);
  if (!input || !input.value.trim()) return;
  var message = input.value.trim();
  input.value = '';
  input.disabled = true;

  try {
    var headers = { 'Content-Type': 'application/json' };
    if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    var action = channel === 'teams' ? 'send_teams' : channel === 'webex' ? 'send_webex' : 'send_sms';
    var r = await fetch('/api/contacts?action=' + action + '&id=' + unifiedId, {
      method: 'POST', headers, body: JSON.stringify({ message: message })
    });
    if (r.ok) {
      // Reload messages to show the sent message
      ucLoadChannelMessages(unifiedId, channel);
    } else {
      var err = await r.json().catch(function() { return {}; });
      showToast('Send failed: ' + (err.error || 'Unknown error'), 'error');
      input.value = message;
    }
  } catch (e) {
    showToast('Send error: ' + e.message, 'error');
    input.value = message;
  }
  input.disabled = false;
}

async function runCalendarContactSync() {
  const btn = document.getElementById('btn-cal-sync');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    const r = await fetch('/api/contacts?action=ingest_calendar_contacts', {
      method: 'POST', headers, body: JSON.stringify({ days_back: 90 })
    });
    if (!r.ok) { const err = await r.json().catch(() => ({})); showToast('Calendar sync failed: ' + (err.error || 'HTTP ' + r.status), 'error'); }
    else {
      const data = await r.json();
      showToast('Calendar sync: ' + (data.created || 0) + ' new, ' + (data.matched || 0) + ' updated, ' + (data.skipped || 0) + ' skipped', 'success');
      ucDataQuality = null;
      loadAndRenderUC();
    }
  } catch (e) { showToast('Calendar sync error: ' + e.message, 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Sync Calendar Contacts'; }
}

async function runDuplicateDetection() {
  const btn = document.getElementById('btn-dedup');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    const r = await fetch('/api/contacts?action=detect_duplicates', {
      method: 'POST', headers, body: JSON.stringify({ batch_size: 200 })
    });
    if (!r.ok) { const err = await r.json().catch(() => ({})); showToast('Duplicate detection failed: ' + (err.error || 'HTTP ' + r.status), 'error'); }
    else {
      const data = await r.json();
      showToast('Duplicate scan: ' + (data.duplicates_found || 0) + ' found, ' + (data.contacts_scanned || 0) + ' scanned', 'success');
      ucDataQuality = null;
      loadAndRenderUC();
    }
  } catch (e) { showToast('Duplicate detection error: ' + e.message, 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Run Duplicate Detection'; }
}

// Placeholder for merge queue viewer
async function loadMergeQueue() {
  const el = document.getElementById('bizPageInner');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading merge queue...</p></div>';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    const r = await fetch('/api/contacts?action=merge_queue', { headers });
    if (r.ok) {
      const d = await r.json();
      const queue = d.queue || [];
      let html = '<div style="margin-bottom:12px"><h3 style="margin:0;color:var(--text)">Merge Queue</h3><div style="font-size:12px;color:var(--text3)">Review and resolve potential duplicate contacts</div></div>';
      html += '<button class="act-btn" style="margin-bottom:12px" onclick="mktSource=\'unified\';ucPage=0;loadAndRenderUC()">&#x2190; Back to Contacts</button>';
      if (queue.length === 0) {
        html += '<div style="text-align:center;padding:32px;color:var(--text2)">No pending merge suggestions. Great data hygiene!</div>';
      } else {
        queue.forEach(function(item) {
          html += '<div class="widget" style="padding:12px">';
          html += '<div style="font-size:13px;font-weight:500">Score: ' + (item.match_score || 0).toFixed(2) + ' — ' + esc(item.match_reason || 'Unknown') + '</div>';
          html += '<div style="font-size:12px;color:var(--text2)">Contact A: ' + esc(item.contact_a) + ' · Contact B: ' + esc(item.contact_b) + '</div>';
          html += '<div style="display:flex;gap:6px;margin-top:8px">';
          html += '<button class="act-btn primary" style="font-size:11px;padding:4px 10px" onclick="ucMerge(decodeURIComponent(\'' + encodeURIComponent(item.contact_a) + '\'),decodeURIComponent(\'' + encodeURIComponent(item.contact_b) + '\'),decodeURIComponent(\'' + encodeURIComponent(item.queue_id) + '\'))">Merge (keep A)</button>';
          html += '<button class="act-btn" style="font-size:11px;padding:4px 10px" onclick="ucDismissMerge(decodeURIComponent(\'' + encodeURIComponent(item.queue_id) + '\'))">Dismiss</button>';
          html += '</div></div>';
        });
      }
      el.innerHTML = html;
    }
  } catch (e) {
    el.innerHTML = '<div style="color:var(--red);padding:24px">Error loading merge queue: ' + esc(e.message) + '</div>';
  }
}

// Load hot leads (sorted by engagement score)
async function loadHotLeads() {
  const el = document.getElementById('bizPageInner');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading hot leads...</p></div>';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    const r = await fetch('/api/contacts?action=hot_leads&limit=50', { headers });
    if (r.ok) {
      const d = await r.json();
      const leads = d.hot_leads || [];
      hotLeadsCache = leads; // cache for Copilot context
      let html = '<div style="margin-bottom:12px"><h3 style="margin:0;color:var(--text)">Hot Leads</h3><div style="font-size:12px;color:var(--text3)">Business contacts ranked by engagement score (calls + emails + meetings)</div></div>';
      html += '<button class="act-btn" style="margin-bottom:12px" onclick="mktSource=\'unified\';ucPage=0;loadAndRenderUC()">&#x2190; Back to Contacts</button>';
      if (leads.length === 0) {
        html += '<div style="text-align:center;padding:32px;color:var(--text2)">No engaged contacts yet. WebEx call history and email activity will populate this view.</div>';
      } else {
        leads.forEach(function(c) {
          var heatColor = c.heat === 'hot' ? '#d32f2f' : c.heat === 'warm' ? '#f57c00' : '#1565c0';
          var heatLabel = c.heat.toUpperCase();
          html += '<div class="widget" style="padding:12px;border-left:3px solid ' + heatColor + '">';
          html += '<div style="display:flex;align-items:center;justify-content:space-between">';
          html += '<div style="flex:1;min-width:0">';
          html += '<div style="font-size:14px;font-weight:500">' + esc(c.full_name || '—') + ' <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:' + heatColor + ';color:#fff;font-weight:700">' + heatLabel + ' ' + (c.engagement_score || 0) + '</span></div>';
          html += '<div style="font-size:12px;color:var(--text2)">' + esc(c.company_name || '') + (c.title ? ' · ' + esc(c.title) : '') + '</div>';
          var stats = [];
          if (c.total_calls > 0) stats.push(c.total_calls + ' calls' + (c.last_call_date ? ' (last: ' + c.last_call_date.split('T')[0] + ')' : ''));
          if (c.total_emails_sent > 0) stats.push(c.total_emails_sent + ' emails');
          if (c.last_meeting_date) stats.push('Meeting: ' + c.last_meeting_date.split('T')[0]);
          if (stats.length) html += '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + stats.join(' · ') + '</div>';
          html += '</div>';
          html += '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">';
          if (c.email) html += '<a href="mailto:' + encodeURIComponent(c.email) + '" class="act-btn" style="font-size:11px;padding:4px 8px">&#x2709;</a>';
          if (c.phone) {
            var cleanPhone = (c.phone || '').replace(/[^+0-9]/g, '');
            html += '<a href="webexteams://call?uri=' + encodeURIComponent(cleanPhone) + '" class="act-btn" style="font-size:11px;padding:4px 8px">&#x1F4DE;</a>';
          }
          if (c.sf_contact_id) {
            var logData = safeJSON({sf_contact_id:c.sf_contact_id||'',sf_company_id:'',name:c.full_name||''});
            html += '<button class="act-btn primary" style="font-size:11px;padding:4px 8px" onclick="openLogCall(' + logData + ')">Log</button>';
          }
          html += '</div></div></div>';
        });
      }
      el.innerHTML = html;
    }
  } catch (e) {
    el.innerHTML = '<div style="color:var(--red);padding:24px">Error loading hot leads: ' + esc(e.message) + '</div>';
  }
}

async function ucMerge(keepId, mergeId, queueId) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    const r = await fetch('/api/contacts?action=merge', {
      method: 'POST', headers,
      body: JSON.stringify({ keep_id: keepId, merge_id: mergeId, queue_id: queueId })
    });
    if (!r.ok) { showToast('Merge failed (HTTP ' + r.status + ')', 'error'); return; }
    showToast('Contacts merged', 'success');
    loadMergeQueue();
  } catch (e) { showToast('Merge error: ' + e.message, 'error'); }
}

async function ucDismissMerge(queueId) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    const r = await fetch('/api/contacts?action=dismiss_merge', {
      method: 'POST', headers,
      body: JSON.stringify({ queue_id: queueId })
    });
    if (!r.ok) { showToast('Dismiss failed (HTTP ' + r.status + ')', 'error'); return; }
    loadMergeQueue();
  } catch (e) { showToast('Dismiss error: ' + e.message, 'error'); }
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
  const today = localToday();

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
    const daysOverdue = getDaysOverdue(first.due_date);
    const isOverdue = daysOverdue > 0;
    const isStale = daysOverdue > 180;
    const isArchivedDealCheck = isArchivedDeal(first.deal_name || first.item_id);
    const isStarred = first.deal_name && first.deal_name.startsWith('****');
    const isLead = first.pipeline_source !== 'sf_deal';

    const priorityBadge = first.deal_priority ? `<span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:50%;background:${first.deal_priority <= 3 ? 'var(--red)' : first.deal_priority <= 4 ? 'var(--yellow)' : 'var(--text3)'};color:#fff;font-size:11px;font-weight:700;margin-right:6px">${first.deal_priority}</span>` : '';
    const dueBadge = isOverdue ? (isStale ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--orange);color:#fff;margin-left:6px">Stale — ' + formatDaysOverdue(daysOverdue) + '</span>' : '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--red);color:#fff;margin-left:6px">OVERDUE</span>') : ''
    const sourceBadge = isLead ? `<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--purple);color:#fff;margin-left:6px">${esc(first.pipeline_source.toUpperCase())}</span>` : '';
    const matchBadge = isLead && first.sf_match_status === 'unmatched' ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--orange);color:#fff;margin-left:6px">UNMATCHED</span>' : '';

    html += `<div class="widget" style="padding:14px${isLead ? ';border-left:3px solid var(--purple)' : ''}${isStale ? ';opacity:0.65;background:rgba(255,255,255,0.03)' : ''}">`;
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
      html += `<select style="background:var(--card);color:var(--text2);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:11px" title="Reclassify domain" onchange="mktReclassifyDeal(decodeURIComponent('${encodeURIComponent(first.item_id)}'),this.value)">`;
      html += `<option value="government" ${curDomain==='government'?'selected':''}>Government</option>`;
      html += `<option value="dialysis" ${curDomain==='dialysis'?'selected':''}>Dialysis</option>`;
      html += `<option value="all_other" ${curDomain==='all_other'?'selected':''}>All Other</option>`;
      html += '</select>';
    }
    if (showReassign) {
      html += '<select style="background:var(--card);color:var(--text2);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:11px" title="Reassign deal" onchange="mktReassignDeal(decodeURIComponent(\'' + encodeURIComponent(first.item_id) + '\'),this.value,decodeURIComponent(\'' + encodeURIComponent(first.sf_contact_id || '') + '\'))">';
      html += `<option value="">Assign to...</option>`;
      owners.forEach(o => { html += `<option value="${esc(o)}" ${first.assigned_to===o?'selected':''}>${esc(o)}</option>`; });
      html += '</select>';
    }
    html += '</div>';
    html += '</div>';

    // Contact rows
    contacts.forEach(c => {
      const cId = c.sf_contact_id || c.item_id || '';
      const logData = safeJSON({sf_contact_id:c.sf_contact_id||'',sf_company_id:c.sf_company_id||'',name:c.contact_name||c.company_name||''});
      // Clickable contact row — expands to show deals + history
      html += `<div style="cursor:pointer;padding:8px 0;border-top:1px solid var(--border)" onclick="toggleContactDetail(decodeURIComponent('${encodeURIComponent(cId)}'))">`;
      html += `<div style="display:flex;align-items:center;justify-content:space-between">`;
      html += `<div style="flex:1;min-width:0">`;
      var domainBadge = '';
      if (c.task_domain === 'government') domainBadge = ' <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:var(--blue);color:#fff;font-weight:600;vertical-align:middle">GOV</span>';
      else if (c.task_domain === 'dialysis') domainBadge = ' <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:var(--green);color:#fff;font-weight:600;vertical-align:middle">DIA</span>';
      var sfLink = c.sf_contact_id ? `<a href="https://northmarqcapital.lightning.force.com/lightning/r/Contact/${encodeURIComponent(c.sf_contact_id)}/view" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open in Salesforce" style="color:var(--text);text-decoration:none;border-bottom:1px dashed var(--text3)">${esc(c.contact_name || '—')}</a>` : esc(c.contact_name || '—');
      html += `<div style="font-size:14px;font-weight:500">${sfLink}${domainBadge} <span style="font-size:11px;color:var(--text3);margin-left:4px">&#9660;</span></div>`;
      html += `<div style="font-size:12px;color:var(--text2)">${esc(c.company_name || '')}`;
      if (c.email) html += ` · <a href="mailto:${encodeURIComponent(c.email)}" onclick="event.stopPropagation()">${esc(c.email)}</a>`;
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
          // Task action buttons: complete, log & reschedule, dismiss
          html += '<div style="display:flex;gap:3px;flex-shrink:0">';
          html += '<button class="act-btn" style="font-size:10px;padding:2px 5px" onclick="completeTask(decodeURIComponent(\'' + encodeURIComponent(c.sf_contact_id || '') + '\'),decodeURIComponent(\'' + encodeURIComponent(subj) + '\'))" title="Mark complete">&#x2713;</button>';
          html += '<button class="act-btn" style="font-size:10px;padding:2px 5px" onclick="openLogAndReschedule(decodeURIComponent(\'' + encodeURIComponent(c.sf_contact_id || '') + '\'),decodeURIComponent(\'' + encodeURIComponent(c.sf_company_id || '') + '\'),decodeURIComponent(\'' + encodeURIComponent(c.contact_name || c.company_name || '') + '\'),decodeURIComponent(\'' + encodeURIComponent(subj) + '\'),decodeURIComponent(\'' + encodeURIComponent(t.date || '') + '\'))" title="Log touchpoint &amp; reschedule">&#x1F4C5;</button>';
          html += '<button class="act-btn" style="font-size:10px;padding:2px 5px" onclick="dismissTask(decodeURIComponent(\'' + encodeURIComponent(c.sf_contact_id || '') + '\'),decodeURIComponent(\'' + encodeURIComponent(subj) + '\'))" title="Dismiss/archive">&#x2715;</button>';
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
        html += `<div style="padding:6px 12px;cursor:pointer;color:var(--text)" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background=''" onclick="event.stopPropagation();closeEmailMenus();openMktEmail(decodeURIComponent('${encodeURIComponent(c.email)}'),decodeURIComponent('${encodeURIComponent(c.contact_name||'')}'),decodeURIComponent('${encodeURIComponent(group.displayName)}'))">Initial Outreach</div>`;
        html += `<div style="padding:6px 12px;cursor:pointer;color:var(--text)" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background=''" onclick="event.stopPropagation();closeEmailMenus();openMktFollowUp(decodeURIComponent('${encodeURIComponent(c.email)}'),decodeURIComponent('${encodeURIComponent(c.contact_name||'')}'),decodeURIComponent('${encodeURIComponent(group.displayName)}'))">Follow-Up</div>`;
        html += `<div style="padding:6px 12px;cursor:pointer;color:var(--text)" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background=''" onclick="event.stopPropagation();closeEmailMenus();openMktMarketUpdate(decodeURIComponent('${encodeURIComponent(c.email)}'),decodeURIComponent('${encodeURIComponent(c.contact_name||'')}'),decodeURIComponent('${encodeURIComponent(group.displayName)}'))">Market Update</div>`;
        html += `<div style="padding:6px 12px;cursor:pointer;color:var(--text)" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background=''" onclick="event.stopPropagation();closeEmailMenus();openMktMeetingReq(decodeURIComponent('${encodeURIComponent(c.email)}'),decodeURIComponent('${encodeURIComponent(c.contact_name||'')}'),decodeURIComponent('${encodeURIComponent(group.displayName)}'))">Meeting Request</div>`;
        html += '</div></div>';
      }
      if (c.phone) {
        const cleanPhone = (c.phone || '').replace(/[^+0-9]/g, '');
        html += `<a href="webexteams://call?uri=${encodeURIComponent(cleanPhone)}" class="act-btn" style="font-size:11px;padding:4px 8px" onclick="event.stopPropagation()" title="Call via WebEx">&#x1F4DE; WebEx</a>`;
        html += `<a href="tel:${encodeURIComponent(c.phone)}" class="act-btn" style="font-size:11px;padding:4px 8px" onclick="event.stopPropagation()" title="Direct dial">&#x260E;</a>`;
      }
      html += `<button class="act-btn primary" style="font-size:11px;padding:4px 8px" onclick="event.stopPropagation();openLogCall(${logData})">Log</button>`;
      // Lead management buttons
      if (c.pipeline_source !== 'sf_deal' && c.sf_match_status === 'unmatched') {
        html += `<button class="act-btn" style="font-size:11px;padding:4px 8px;background:var(--orange);color:#fff" onclick="event.stopPropagation();mktMatchLead(decodeURIComponent('${encodeURIComponent(c.item_id)}'))">Match</button>`;
      }
      if (c.pipeline_source !== 'sf_deal') {
        html += `<button class="act-btn" style="font-size:11px;padding:4px 8px" onclick="event.stopPropagation();mktUpdateStatus(decodeURIComponent('${encodeURIComponent(c.item_id)}'),'contacted')">&#x2713;</button>`;
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

  const today = localToday();
  const userName = LCC_USER.display_name || 'Scott Briggs';
  const prospects = window._mktOpportunities[domain] || [];
  const prospectContacts = window._mktProspectContacts[domain] || [];

  // Merge opportunity deals with prospect contacts for a unified view
  // De-duplicate by sf_contact_id — prefer prospect contacts (have richer data)
  const seenContacts = new Set();
  prospectContacts.forEach(function(c) { if (c.sf_contact_id) seenContacts.add(c.sf_contact_id); });
  const combinedProspects = [].concat(prospectContacts, prospects.filter(function(d) {
    return !d.sf_contact_id || !seenContacts.has(d.sf_contact_id);
  }));

  // Apply filters to combined list
  let filtered = combinedProspects;
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

  // Collect owners from combined list
  const ownerSet = new Set();
  combinedProspects.forEach(d => { if (d.assigned_to) ownerSet.add(d.assigned_to); });
  const owners = Array.from(ownerSet).sort();
  const overdueItems = combinedProspects.filter(d => d.due_date && d.due_date < today);
  const overdue = new Set(overdueItems.map(d => d.deal_name)).size;
  const totalDeals = new Set(combinedProspects.map(d => d.deal_name)).size;
  const totalContacts = combinedProspects.length;
  const domainLabel = domain === 'government' ? 'Government' : domain === 'dialysis' ? 'Dialysis' : 'All Other';
  const renderCall = `renderDomainProspects('${domain}')`;

  let html = '';
  html += `<div style="margin-bottom:12px"><h3 style="margin:0;color:var(--text)">${domainLabel} Prospecting</h3><div style="font-size:12px;color:var(--text3)">${totalDeals} deals · ${totalContacts} contacts</div></div>`;

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
  html += `<div class="stat-card"><div class="stat-label">Total Deals</div><div class="stat-value" style="color:var(--accent)">${totalDeals}</div><div class="stat-sub">${totalContacts} contacts</div></div>`;
  html += `<div class="stat-card" style="cursor:pointer" onclick="prospectFilter['${domain}']='overdue';prospectPage['${domain}']=0;${renderCall}"><div class="stat-label">Overdue</div><div class="stat-value" style="color:var(--red)">${overdue}</div><div class="stat-sub">${overdueItems.length} contacts past due</div></div>`;
  html += '</div>';

  // Status filters
  html += '<div class="pills" style="margin-bottom:8px">';
  html += `<span class="pill ${prospectFilter[domain]==='all'?'active':''}" onclick="prospectFilter['${domain}']='all';prospectPage['${domain}']=0;${renderCall}">All</span>`;
  html += `<span class="pill ${prospectFilter[domain]==='upcoming'?'active':''}" onclick="prospectFilter['${domain}']='upcoming';prospectPage['${domain}']=0;${renderCall}">Upcoming</span>`;
  html += `<span class="pill ${prospectFilter[domain]==='overdue'?'active':''}" onclick="prospectFilter['${domain}']='overdue';prospectPage['${domain}']=0;${renderCall}">Overdue</span>`;
  html += `<span class="pill ${prospectFilter[domain]==='starred'?'active':''}" onclick="prospectFilter['${domain}']='starred';prospectPage['${domain}']=0;${renderCall}">Starred</span>`;
  html += '</div>';

  // Search
  html += `<div class="search-bar"><input class="search-input" type="text" placeholder="Search prospects..." value="${esc(prospectSearch[domain] || '')}" oninput="clearTimeout(prospectSearchTimeout['${domain}']);prospectSearchTimeout['${domain}']=setTimeout(()=>{prospectSearch['${domain}']=this.value;prospectPage['${domain}']=0;${renderCall}},250)"></div>`;

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
  const menu = btn?.parentElement?.querySelector('.email-tpl-menu');
  if (!menu) return;
  const wasOpen = menu.style.display !== 'none';
  closeEmailMenus();
  if (!wasOpen) menu.style.display = 'block';
}
function closeEmailMenus() {
  document.querySelectorAll('.email-tpl-menu').forEach(m => m.style.display = 'none');
}
document.addEventListener('click', closeEmailMenus);

function openMktFollowUp(email, name, deal) {
  const first = (name || '').split(' ')[0] || 'there';
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
  const first = (name || '').split(' ')[0] || 'there';
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
  const first = (name || '').split(' ')[0] || 'there';
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
    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'salesforce_activities',
      idColumn: 'activity_id',
      idValue: activityId,
      data: { assigned_to: newOwner },
      source_surface: 'marketing_reassign_deal',
      notes: sfContactId || null,
      propagation_scope: 'salesforce_activity_assignment'
    });
    if (!result.ok) {
      throw new Error((result.errors || ['Unable to reassign deal']).join('; '));
    }
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

// ── Shared task store helpers (works across marketing + domain prospect views) ──
function _updateTaskInAllStores(sfContactId, subject, action, newDate) {
  // Update a task across mktData and all _mktProspectContacts domains
  var stores = [mktData];
  ['government', 'dialysis', 'all_other'].forEach(function(dom) {
    if (window._mktProspectContacts && window._mktProspectContacts[dom]) {
      stores.push(window._mktProspectContacts[dom]);
    }
  });

  stores.forEach(function(store) {
    for (var i = store.length - 1; i >= 0; i--) {
      var d = store[i];
      if (d.sf_contact_id !== sfContactId || !d.open_tasks) continue;

      if (action === 'complete') {
        // Remove only the FIRST task matching this subject (not all with same subject)
        var removed = false;
        d.open_tasks = d.open_tasks.filter(function(t) {
          if (!removed && t.subject === subject) { removed = true; return false; }
          return true;
        });
        d.open_task_count = d.open_tasks.length;
        d.completed_activity_count = (d.completed_activity_count || 0) + 1;
        // Remove from active view when no open tasks remain
        if (d.open_tasks.length === 0) store.splice(i, 1);
      } else if (action === 'reschedule') {
        // Only reschedule the FIRST matching task
        var rescheduled = false;
        d.open_tasks.forEach(function(t) {
          if (!rescheduled && t.subject === subject) { t.date = newDate; rescheduled = true; }
        });
        d.due_date = newDate;
      } else if (action === 'dismiss') {
        // Remove only the FIRST task matching this subject
        var dismissed = false;
        d.open_tasks = d.open_tasks.filter(function(t) {
          if (!dismissed && t.subject === subject) { dismissed = true; return false; }
          return true;
        });
        d.open_task_count = d.open_tasks.length;
        // Remove from active view when no open tasks remain
        if (d.open_tasks.length === 0) store.splice(i, 1);
      }
    }
  });
}

function _rerenderCurrentView() {
  if (typeof currentBizTab !== 'undefined') {
    if (currentBizTab === 'marketing') { renderMarketing(); return; }
    if (currentBizTab === 'other') { renderDomainProspects('all_other'); return; }
  }
  // Check if we're on a domain sub-tab (prospects)
  if (typeof currentGovTab !== 'undefined' && currentGovTab === 'prospects') {
    renderDomainProspects('government'); return;
  }
  if (typeof currentDiaTab !== 'undefined' && currentDiaTab === 'prospects') {
    renderDomainProspects('dialysis'); return;
  }
  // Fallback: re-render marketing
  renderMarketing();
}

// ── Salesforce outbound sync helper ──
// Fire-and-forget: log task action to Salesforce via the outbound sync pipeline
function _syncTaskToSalesforce(sfContactId, subject, action) {
  // Look up sf_company_id and deal context from local stores
  var sfCompanyId = null;
  var dealName = '';
  var stores = [mktData];
  ['government', 'dialysis', 'all_other'].forEach(function(dom) {
    if (window._mktProspectContacts && window._mktProspectContacts[dom]) stores.push(window._mktProspectContacts[dom]);
  });
  for (var s = 0; s < stores.length; s++) {
    for (var i = 0; i < stores[s].length; i++) {
      if (stores[s][i].sf_contact_id === sfContactId) {
        sfCompanyId = stores[s][i].sf_company_id;
        // Find the deal_name from the matching task
        var tasks = stores[s][i].open_tasks || [];
        for (var j = 0; j < tasks.length; j++) {
          if (tasks[j].subject === subject && tasks[j].deal_name) {
            dealName = tasks[j].deal_name;
            break;
          }
        }
        break;
      }
    }
    if (sfCompanyId) break;
  }

  var today = localToday();
  var actionLabel = action === 'complete' ? 'Completed' : action === 'dismiss' ? 'Dismissed' : 'Updated';
  // Map action to appropriate SF activity_type
  var activityType = action === 'complete' ? 'Call' : 'Follow-up';
  var payload = {
    sf_contact_id: sfContactId,
    sf_company_id: sfCompanyId || undefined,
    activity_type: activityType,
    activity_date: today,
    subject: subject,
    deal_name: dealName || undefined,
    notes: '[' + actionLabel + '] ' + subject + (dealName ? ' | Deal: ' + dealName : ''),
    force: true
  };

  // Non-blocking: fire the sync, log errors but don't block UI
  fetch('/api/sync?action=outbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'log_to_sf',
      payload
    })
  }).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function(data) {
    if (data.status === 'completed' || data.success) {
      console.debug('[SF Sync] ' + actionLabel + ' logged for ' + sfContactId + ': ' + subject);
    } else if (data.warning) {
      console.warn('[SF Sync] Warning: ' + (data.message || 'Recent activity detected'));
    } else {
      console.error('[SF Sync] Error: ' + (data.error || 'Unknown'));
    }
  }).catch(function(e) {
    console.error('[SF Sync] Network error:', e.message);
    showToast('SF activity sync failed', 'error');
  });
}

// Fire-and-forget: close the original open SF task via Power Automate
function _closeOriginalSfTask(sfContactId, subject) {
  fetch('/api/sync?action=complete_sf_task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sf_contact_id: sfContactId, subject: subject })
  }).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function(data) {
    if (data.success) {
      var action = data.pa_response && data.pa_response.action;
      if (action === 'completed') {
        console.debug('[SF Complete] Original task closed for ' + sfContactId + ': ' + subject);
      } else {
        console.debug('[SF Complete] Original task not found (already closed?) for ' + sfContactId);
      }
    } else {
      console.error('[SF Complete] Error: ' + (data.error || 'Unknown'));
    }
  }).catch(function(e) {
    console.error('[SF Complete] Network error:', e.message);
  });
}

// Fire-and-forget: push new task date to SF via Power Automate
function _updateSfTaskDate(sfContactId, subject, newDate) {
  fetch('/api/sync?action=complete_sf_task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sf_contact_id: sfContactId, subject: subject, action: 'reschedule', new_date: newDate })
  }).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function(data) {
    if (data.success) {
      var action = data.pa_response && data.pa_response.action;
      if (action === 'rescheduled') {
        console.debug('[SF Reschedule] Task date updated to ' + newDate + ' for ' + sfContactId + ': ' + subject);
      } else {
        console.debug('[SF Reschedule] Original task not found for ' + sfContactId + ' (may need manual update in SF)');
      }
    } else {
      console.error('[SF Reschedule] Error: ' + (data.error || 'Unknown'));
    }
  }).catch(function(e) {
    console.error('[SF Reschedule] Network error:', e.message);
  });
}

// ── Task management: complete, reschedule, dismiss ──
async function completeTask(sfContactId, subject) {
  showToast('Marking task complete...', 'success');
  try {
    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'salesforce_activities',
      idColumn: 'sf_contact_id',
      idValue: sfContactId,
      matchFilters: [{ column: 'subject', value: subject }],
      data: { status: 'Completed' },
      source_surface: 'marketing_task_complete',
      notes: subject,
      propagation_scope: 'salesforce_activity_status'
    });
    if (!result.ok) {
      throw new Error((result.errors || ['Unable to complete task']).join('; '));
    }
    showToast('Task completed!', 'success');
    // Sync completion to Salesforce (non-blocking) — includes deal context
    _syncTaskToSalesforce(sfContactId, subject, 'complete');
    // Close the ORIGINAL open task in SF via Power Automate (non-blocking)
    _closeOriginalSfTask(sfContactId, subject);
    // Remove from local data (marketing + prospect contacts) and re-render
    _updateTaskInAllStores(sfContactId, subject, 'complete');
    _rerenderCurrentView();
  } catch (e) {
    showToast('Error completing task: ' + e.message, 'error');
  }
}

async function rescheduleTask(sfContactId, subject, newDate) {
  if (!newDate) return;
  showToast('Rescheduling to ' + newDate + '...', 'success');
  try {
    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'salesforce_activities',
      idColumn: 'sf_contact_id',
      idValue: sfContactId,
      matchFilters: [{ column: 'subject', value: subject }],
      data: { activity_date: newDate },
      source_surface: 'marketing_task_reschedule',
      notes: subject,
      propagation_scope: 'salesforce_activity_date'
    });
    if (!result.ok) {
      throw new Error((result.errors || ['Unable to reschedule task']).join('; '));
    }
    showToast('Rescheduled to ' + newDate, 'success');
    // Push new date to SF via Power Automate (non-blocking)
    _updateSfTaskDate(sfContactId, subject, newDate);
    // Update local data (marketing + prospect contacts)
    _updateTaskInAllStores(sfContactId, subject, 'reschedule', newDate);
    _rerenderCurrentView();
  } catch (e) {
    showToast('Error rescheduling: ' + e.message, 'error');
  }
}

async function dismissTask(sfContactId, subject) {
  if (!(await lccConfirm('Dismiss "' + subject + '"? This will mark it as Abandoned.', 'Dismiss'))) return;
  showToast('Dismissing task...', 'success');
  try {
    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'salesforce_activities',
      idColumn: 'sf_contact_id',
      idValue: sfContactId,
      matchFilters: [{ column: 'subject', value: subject }],
      data: { status: 'Abandoned' },
      source_surface: 'marketing_task_dismiss',
      notes: subject,
      propagation_scope: 'salesforce_activity_status'
    });
    if (!result.ok) {
      throw new Error((result.errors || ['Unable to dismiss task']).join('; '));
    }
    showToast('Task dismissed', 'success');
    // Sync dismissal to Salesforce (non-blocking) — includes deal context
    _syncTaskToSalesforce(sfContactId, subject, 'dismiss');
    // Remove from local data (marketing + prospect contacts)
    _updateTaskInAllStores(sfContactId, subject, 'dismiss');
    _rerenderCurrentView();
  } catch (e) {
    showToast('Error dismissing task: ' + e.message, 'error');
  }
}

// ── Reclassify deal domain ──
async function mktReclassifyDeal(activityId, newDomain) {
  if (!activityId || !newDomain) return;
  showToast('Reclassifying deal to ' + newDomain + '...', 'success');
  try {
    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'salesforce_activities',
      idColumn: 'activity_id',
      idValue: activityId,
      data: { prospect_domain: newDomain },
      source_surface: 'marketing_reclassify_deal',
      propagation_scope: 'salesforce_activity_domain'
    });
    if (!result.ok) {
      throw new Error((result.errors || ['Unable to reclassify deal']).join('; '));
    }
    // Move item between domain buckets locally
    let movedItem = null;
    ['government', 'dialysis', 'all_other'].forEach(dom => {
      const arr = window._mktOpportunities?.[dom];
      if (!Array.isArray(arr)) return;
      const idx = arr.findIndex(d => d.item_id === activityId);
      if (idx !== -1) {
        movedItem = arr.splice(idx, 1)[0];
      }
    });
    if (movedItem) {
      movedItem.domain = newDomain;
      movedItem.prospect_domain = newDomain;
      const targetArr = window._mktOpportunities?.[newDomain];
      if (Array.isArray(targetArr)) targetArr.push(movedItem);
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
    const result = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'marketing_leads',
      idColumn: 'lead_id',
      idValue: leadId,
      data: { status: newStatus },
      source_surface: 'marketing_update_status',
      propagation_scope: 'marketing_lead_status'
    });
    if (!result.ok) {
      console.error('mktUpdateStatus error:', result.errors || []);
      showToast('Error updating status — ' + ((result.errors || ['unknown error'])[0]), 'error');
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
  const first = (contactName || '').split(' ')[0] || 'there';
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
          const clickAttr = r._source ? ' onclick=\'showDetail(' + safeJSON(r) + ', &quot;' + esc(r._source) + '&quot;)\'' : '';
          html += '<div class="search-card"' + clickAttr + '>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(r._title || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: ' + esc(r._badgeBg || '') + '; color: ' + esc(r._badgeColor || '') + ';">' + esc(r._badge) + '</span></div>';
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

  // Sanitize for PostgREST ilike filter — strip syntax-breaking characters
  const safeTerm = term.replace(/[*()',\\]/g, '');
  if (!safeTerm) { prospectsSearching = false; if (el) el.innerHTML = renderProspects(); return; }
  const like = '*' + safeTerm + '*';
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
      diaClinics = (Array.isArray(dc) ? dc : dc?.data || []).map(r => ({ ...r, _title: norm(r.facility_name) || '—', _badge: 'Dia Clinic', _badgeBg: 'rgba(167,139,250,0.15)', _badgeColor: '#a78bfa', _source: 'dia-clinic', _meta: [r.city && r.state ? norm(r.city) + ', ' + r.state : '', r.ccn ? 'CCN: ' + r.ccn : '', r.operator_name ? 'Op: ' + normalizeOperatorName(r.operator_name) : '', r.latest_total_patients ? 'Patients: ' + r.latest_total_patients : ''].filter(Boolean) }));
      diaNpi = (Array.isArray(dn) ? dn : dn?.data || []).map(r => ({ ...r, _title: norm(r.facility_name) || r.npi || '—', _badge: 'NPI Signal', _badgeBg: 'rgba(248,113,113,0.15)', _badgeColor: '#f87171', _source: 'dia-clinic', _meta: [r.city && r.state ? norm(r.city) + ', ' + r.state : '', r.signal_type ? cleanLabel(r.signal_type) : '', r.npi ? 'NPI: ' + r.npi : ''].filter(Boolean) }));
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
    showToast('Search failed: ' + (err.message || 'Unknown error'), 'error');
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

function showDetail(record, source = 'activity', initialTab) {
  // Route gov/dia property sources to unified detail page
  if (source === 'gov-ownership' || source === 'gov-lead' || source === 'gov-listing' ||
      source === 'dia-clinic') {
    if (typeof showUnifiedDetail === 'function') {
      showUnifiedDetail(record, source, initialTab);
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
  _setHTML('detailHeader', header);

  // Render tabs
  const tabs = renderDetailTabs(source);
  _setHTML('detailTabs', tabs);

  // Render initial body
  const body = renderDetailBody(record, source, window._detailTab);
  _setHTML('detailBody', body);

  if (panel) panel.style.display = 'block';
  if (overlay) overlay.classList.add('open');
}

function closeDetail() {
  window._detailRecord = null;
  window._detailSource = null;
  window._detailTab = null;
  window._saleRecord = null;
  window._saleCurrentTab = null;

  const panel = document.getElementById('detailPanel');
  if (panel) {
    panel.style.display = 'none';
    panel.classList.remove('open');
  }
  const overlay = document.getElementById('detailOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.style.display = '';  // clear inline display so CSS takes over
  }
  _setHTML('detailHeader', '');
  _setHTML('detailTabs', '');
  _setHTML('detailBody', '');
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
  const bodyEl = document.getElementById('detailBody');
  if (bodyEl) bodyEl.innerHTML = body;
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
    subtitle = `${esc(record.city || '')}${record.city && record.state ? ', ' : ''}${esc(record.state || '')} · ${esc(normalizeOperatorName(record.operator_name) || 'Clinic')}`;
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
    if (phone) keyFields += `<div><span style="color:var(--text3)">Phone:</span> <a href="tel:${encodeURIComponent(phone)}" style="color:var(--accent)">${esc(phone)}</a></div>`;
    if (email) keyFields += `<div><span style="color:var(--text3)">Email:</span> <a href="mailto:${encodeURIComponent(email)}" style="color:var(--accent)">${esc(email)}</a></div>`;
    keyFields += '</div>';
  } else if (source === 'dia-clinic') {
    const ccn = record.ccn || '';
    const npi = record.npi || '';
    const loc = (record.city || '') + (record.city && record.state ? ', ' : '') + (record.state || '');
    const op = normalizeOperatorName(record.operator_name || '');
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
    if (label === 'Phone') display = `<a href="tel:${encodeURIComponent(val)}" style="color:var(--accent)">${esc(val)}</a>`;
    if (label === 'Email') display = `<a href="mailto:${encodeURIComponent(val)}" style="color:var(--accent)">${esc(val)}</a>`;
    html += `<div style="color:var(--text3);font-weight:500">${label}</div><div style="color:var(--text)">${display}</div>`;
  }
  html += '</div>';
  // Action buttons
  html += '<div style="display:flex;gap:8px;margin-top:20px">';
  if (record.phone) html += `<a href="tel:${encodeURIComponent(record.phone)}" class="act-btn primary" style="text-decoration:none;font-size:13px;padding:8px 16px">&#x260E; Call</a>`;
  if (record.email) html += `<a href="mailto:${encodeURIComponent(record.email)}" class="act-btn" style="text-decoration:none;font-size:13px;padding:8px 16px">&#x2709; Email</a>`;
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
  if(record.email) html += `<div class="detail-row"><span class="detail-lbl">Email:</span> <span class="detail-val"><a href="mailto:${encodeURIComponent(record.email)}">${esc(record.email)}</a></span></div>`;
  if(record.phone) html += `<div class="detail-row"><span class="detail-lbl">Phone:</span> <span class="detail-val"><a href="tel:${encodeURIComponent(record.phone)}">${esc(record.phone)}</a></span></div>`;
  if(record.activity_date) html += `<div class="detail-row"><span class="detail-lbl">Date:</span> <span class="detail-val">${esc(record.activity_date)}</span></div>`;
  if(record.status) html += `<div class="detail-row"><span class="detail-lbl">Status:</span> <span class="detail-val">${esc(record.status)}</span></div>`;
  if(record.nm_type || record.task_subtype) html += `<div class="detail-row"><span class="detail-lbl">Type:</span> <span class="detail-val">${esc(record.nm_type || record.task_subtype)}</span></div>`;
  
  if(record.nm_notes) {
    html += `<div class="detail-notes"><strong>Notes:</strong><br>${esc(record.nm_notes)}</div>`;
  }
  
  html += '<div class="detail-actions">';
  html += `<button class="act-btn primary" onclick="closeDetail();openLogCall(${safeJSON({sf_contact_id:record.sf_contact_id||'',sf_company_id:record.sf_company_id||'',name:record.contact_name||record.company_name||''})})">&#x260E; Log Call</button>`;
  if(record.sf_link) html += `<a href="${safeHref(record.sf_link)}" target="_blank" rel="noopener" class="act-btn">&#x2197; Salesforce</a>`;
  if(record.phone) html += `<a href="tel:${encodeURIComponent(record.phone)}" class="act-btn">&#x1F4DE; Call</a>`;
  if(record.email) html += `<a href="mailto:${encodeURIComponent(record.email)}" class="act-btn">&#x2709; Email</a>`;
  html += '</div>';
  
  html += '</div>';
  return html;
}

// ============================================================
// LOG CALL
// ============================================================
function openLogCall(data) {
  logCallData = data;
  const dateEl = document.getElementById('logCallDate');
  const notesEl = document.getElementById('logCallNotes');
  const ctxEl = document.getElementById('logCallContext');
  const btnEl = document.getElementById('logCallSubmit');
  const modalEl = document.getElementById('logCallModal');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  if (notesEl) notesEl.value = '';
  if (ctxEl) ctxEl.textContent = `Logging activity for: ${data.name || 'Unknown'}`;
  if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Log Activity'; }
  if (modalEl) modalEl.classList.add('open');
}

function closeLogCall() {
  document.getElementById('logCallModal')?.classList.remove('open');
}

async function submitLogCall() {
  const btn = document.getElementById('logCallSubmit');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'Logging...';
  const typeEl = document.getElementById('logCallType');
  const dateEl = document.getElementById('logCallDate');
  const notesEl = document.getElementById('logCallNotes');
  const payload = {
    sf_contact_id: logCallData.sf_contact_id || undefined,
    sf_company_id: logCallData.sf_company_id || undefined,
    activity_type: typeEl ? typeEl.value : 'Call',
    activity_date: dateEl ? dateEl.value : new Date().toISOString().split('T')[0],
    notes: notesEl ? (notesEl.value || undefined) : undefined,
    force: true,
  };
  if (!payload.sf_contact_id && !payload.sf_company_id) {
    showToast('No SF contact or company ID available for this activity.', 'error');
    btn.disabled = false; btn.textContent = 'Log Activity';
    return;
  }
  try {
    const res = await fetch('/api/sync?action=outbound', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'log_to_sf', payload }),
    });
    if (!res.ok) { showToast('Server error (' + res.status + ')', 'error'); btn.disabled = false; btn.textContent = 'Log Activity'; return; }
    const data = await res.json();
    if (data.status === 'completed' || data.success) {
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

// ── Log & Reschedule: log today's touchpoint + push task date out ──
var _lrData = {};

function openLogAndReschedule(sfContactId, sfCompanyId, contactName, taskSubject, currentDate) {
  _lrData = { sfContactId: sfContactId, sfCompanyId: sfCompanyId, contactName: contactName, taskSubject: taskSubject, currentDate: currentDate };
  const ctxEl = document.getElementById('lrContext');
  const infoEl = document.getElementById('lrTaskInfo');
  const notesEl = document.getElementById('lrNotes');
  const dateEl = document.getElementById('lrNextDate');
  const btnEl = document.getElementById('lrSubmit');
  const modalEl = document.getElementById('logRescheduleModal');
  if (ctxEl) ctxEl.textContent = 'Contact: ' + (contactName || 'Unknown');
  if (infoEl) infoEl.innerHTML = 'Task: <strong>' + (taskSubject || '—') + '</strong>' + (currentDate ? ' (current date: ' + currentDate + ')' : '');
  if (notesEl) notesEl.value = '';
  // Default next date: 2 weeks from today
  var next = new Date();
  next.setDate(next.getDate() + 14);
  if (dateEl) dateEl.value = next.toISOString().split('T')[0];
  if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Log & Reschedule'; }
  if (modalEl) modalEl.classList.add('open');
}

function closeLogReschedule() {
  document.getElementById('logRescheduleModal')?.classList.remove('open');
}

async function submitLogReschedule() {
  var btn = document.getElementById('lrSubmit');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'Logging...';

  var nextDateEl = document.getElementById('lrNextDate');
  var notesEl = document.getElementById('lrNotes');
  var actTypeEl = document.getElementById('lrType');
  var nextDate = nextDateEl ? nextDateEl.value : '';
  var notes = notesEl ? (notesEl.value || '') : '';
  var actType = actTypeEl ? actTypeEl.value : 'Call';

  if (!nextDate) {
    showToast('Please pick a next touchpoint date.', 'error');
    btn.disabled = false; btn.textContent = 'Log & Reschedule';
    return;
  }

  try {
    // 1. Log the activity to Salesforce (non-blocking but we await for feedback)
    var logPayload = {
      sf_contact_id: _lrData.sfContactId || undefined,
      sf_company_id: _lrData.sfCompanyId || undefined,
      activity_type: actType,
      activity_date: new Date().toISOString().split('T')[0],
      notes: (_lrData.taskSubject ? '[' + _lrData.taskSubject + '] ' : '') + notes,
      force: true
    };

    var logRes = await fetch('/api/sync?action=outbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'log_to_sf', payload: logPayload })
    });
    if (!logRes.ok) { showToast('Server error (' + logRes.status + ')', 'error'); btn.disabled = false; btn.textContent = 'Log & Reschedule'; return; }
    var logData = await logRes.json();

    if (logData.warning) {
      showToast('Warning: ' + (logData.message || 'Recent activity detected'), 'error');
      btn.disabled = false; btn.textContent = 'Log & Reschedule';
      return;
    }
    if (!(logData.status === 'completed' || logData.success) && logData.error) {
      showToast('SF log error: ' + logData.error, 'error');
      btn.disabled = false; btn.textContent = 'Log & Reschedule';
      return;
    }

    // 2. Reschedule the task date in Supabase (task stays open with new date)
    var rescheduleResult = await applyChangeWithFallback({
      proxyBase: '/api/dia-query',
      table: 'salesforce_activities',
      idColumn: 'sf_contact_id',
      idValue: _lrData.sfContactId,
      matchFilters: [{ column: 'subject', value: _lrData.taskSubject }],
      data: { activity_date: nextDate },
      source_surface: 'log_reschedule_modal',
      notes: _lrData.taskSubject,
      propagation_scope: 'salesforce_activity_date'
    });
    if (!rescheduleResult.ok) {
      throw new Error((rescheduleResult.errors || ['Unable to reschedule task']).join('; '));
    }

    // 3. Push the new date to the original SF task via Power Automate (non-blocking)
    _updateSfTaskDate(_lrData.sfContactId, _lrData.taskSubject, nextDate);

    // 4. Remove this task from the current view (it'll reappear on next load with future date)
    _updateTaskInAllStores(_lrData.sfContactId, _lrData.taskSubject, 'complete');
    _rerenderCurrentView();

    showToast('Logged to SF & rescheduled to ' + nextDate, 'success');
    closeLogReschedule();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = 'Log & Reschedule';
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
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;

  const staleThresholdMs = 15 * 60 * 1000;
  fetch('/api/sync?action=health', { headers })
    .then(r => r.ok ? r.json() : null)
    .then(health => {
      const connectors = health?.connectors || [];
      const isStale = connectors.length === 0 || connectors.some(conn => {
        if (conn.status === 'error' || conn.status === 'degraded' || !conn.last_sync_at) return true;
        return (Date.now() - new Date(conn.last_sync_at).getTime()) > staleThresholdMs;
      });
      if (!isStale) return;

      fetch('/api/sync?action=ingest_emails', { method: 'POST', headers }).catch(e => { console.warn('[BackgroundSync] Email ingest failed:', e.message); showToast('Email sync failed', 'error'); });
      fetch('/api/sync?action=ingest_calendar', { method: 'POST', headers }).catch(e => { console.warn('[BackgroundSync] Calendar ingest failed:', e.message); showToast('Calendar sync failed', 'error'); });
      fetch('/api/sync?action=ingest_sf_activities', { method: 'POST', headers }).catch(e => { console.warn('[BackgroundSync] SF activities ingest failed:', e.message); showToast('SF sync failed', 'error'); });
    })
    .catch(e => console.warn('[BackgroundSync] Health check failed:', e.message));
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
  _setHTML('priorityTasks', renderPriorityTasks());
  _setHTML('recentEmails', renderRecentEmails());
  _setHTML('categoryMetrics', renderCategoryMetrics());
  renderTeamPulse();
}

// ============================================================
// CANONICAL BRIDGE — call from legacy domain save functions
// to keep canonical model in sync with domain writes.
// Usage: canonicalBridge('log_activity', { title, domain, ... })
// ============================================================
function canonicalBridge(action, payload) {
  if (!LCC_USER._loaded) return Promise.resolve(null);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  return fetch(`/api/bridge?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal
  }).then(r => {
    clearTimeout(timeout);
    if (!r.ok) { console.warn('canonicalBridge(' + action + ') HTTP ' + r.status); return null; }
    return r.json();
  }).catch(err => { clearTimeout(timeout); console.warn('canonicalBridge(' + action + ') ' + (err.name === 'AbortError' ? 'timed out (10s)' : 'error: ' + err.message)); return null; });
}

// ============================================================
// MUTATION SERVICE — closed-loop change application
// Routes business table writes through /api/apply-change for
// audit trail, pending resolution, and propagation.
//
// Usage: const result = await applyManualChange({ ... });
//        if (!result.ok) handle errors...
//
// Falls back to direct Supabase write if bridge is unavailable.
// ============================================================

/**
 * Apply a manual change through the mutation service.
 * @param {object} payload
 * @param {string} payload.actor - Who is making the change
 * @param {string} payload.source_surface - UI surface originating the change
 * @param {string} payload.target_table - Table to update
 * @param {string} payload.target_source - 'gov' or 'dia'
 * @param {string} payload.record_identifier - Value of the ID column
 * @param {string} payload.id_column - Column name to filter on
 * @param {object} payload.changed_fields - Fields to update
 * @param {string|null} [payload.notes] - Optional notes
 * @param {string|null} [payload.linked_pending_id] - Optional linked pending_updates row
 * @param {string|null} [payload.propagation_scope] - Optional propagation scope
 * @returns {Promise<{ok: boolean, applied_mode: string, errors?: string[]}>}
 */
async function applyManualChange(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('/api/apply-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, errors: ['http_' + res.status] };
    const data = await res.json();
    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') return { ok: false, errors: ['timeout', 'Request timed out (15s)'] };
    return { ok: false, errors: ['bridge_unavailable', err.message] };
  }
}

/**
 * Apply a change via mutation service, falling back to direct proxy PATCH
 * if the bridge is unavailable.
 * @param {object} opts
 * @param {string} opts.proxyBase - '/api/gov-query' or '/api/dia-query'
 * @param {string} opts.table - Target table name
 * @param {string} opts.idColumn - Column to filter on
 * @param {string} opts.idValue - Value of that column
 * @param {object} opts.data - Fields to update
 * @param {string} opts.source_surface - UI surface name
 * @param {string|null} [opts.notes]
 * @param {string|null} [opts.linked_pending_id]
 * @param {string|null} [opts.propagation_scope]
 * @param {Array<{column: string, value: string}>|null} [opts.matchFilters]
 * @returns {Promise<{ok: boolean, applied_mode: string, errors?: string[]}>}
 */
async function applyChangeWithFallback(opts) {
  const targetSource = opts.proxyBase.includes('gov') ? 'gov' : 'dia';
  const actor = (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'lcc_analyst';

  // Try mutation service first
  const result = await applyManualChange({
    actor,
    source_surface: opts.source_surface || 'workspace',
    target_table: opts.table,
    target_source: targetSource,
    record_identifier: String(opts.idValue),
    id_column: opts.idColumn,
    changed_fields: opts.data,
    notes: opts.notes || null,
    linked_pending_id: opts.linked_pending_id || null,
    propagation_scope: opts.propagation_scope || null,
    match_filters: Array.isArray(opts.matchFilters) ? opts.matchFilters : []
  });

  // If bridge is unavailable, fall back to direct proxy PATCH
  if (!result.ok && result.errors && result.errors.includes('bridge_unavailable')) {
    if (!checkFlag('mutation_fallback_enabled')) {
      return result;
    }
    console.warn('[applyChange] Bridge unavailable, falling back to direct PATCH');
    try {
      const url = new URL(opts.proxyBase, window.location.origin);
      url.searchParams.set('table', opts.table);
      url.searchParams.set('filter', `${opts.idColumn}=eq.${opts.idValue}`);
      (Array.isArray(opts.matchFilters) ? opts.matchFilters : []).forEach(function(filter, idx) {
        url.searchParams.set(`filter${idx + 2}`, `${filter.column}=eq.${filter.value}`);
      });
      const fc = new AbortController();
      const ft = setTimeout(() => fc.abort(), 15000);
      const res = await fetch(url.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.data),
        signal: fc.signal
      });
      clearTimeout(ft);
      if (!res.ok) {
        const errText = await res.text();
        return { ok: false, applied_mode: 'fallback_failed', errors: [`Direct PATCH failed (${res.status}): ${errText}`] };
      }
      return { ok: true, applied_mode: 'direct_fallback' };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, applied_mode: 'fallback_failed', errors: ['Fallback PATCH timed out (15s)'] };
      return { ok: false, applied_mode: 'fallback_failed', errors: [err.message] };
    }
  }

  return result;
}

async function applyInsertWithFallback(opts) {
  const targetSource = opts.proxyBase.includes('gov') ? 'gov' : 'dia';
  const actor = (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'lcc_analyst';

  const result = await applyManualChange({
    actor,
    source_surface: opts.source_surface || 'workspace',
    target_table: opts.table,
    target_source: targetSource,
    mutation_mode: 'insert',
    record_identifier: opts.recordIdentifier != null ? String(opts.recordIdentifier) : null,
    id_column: opts.idColumn || null,
    changed_fields: opts.data,
    notes: opts.notes || null,
    linked_pending_id: opts.linked_pending_id || null,
    propagation_scope: opts.propagation_scope || null
  });

  if (!result.ok && result.errors && result.errors.includes('bridge_unavailable')) {
    if (!checkFlag('mutation_fallback_enabled')) {
      return result;
    }
    console.warn('[applyInsert] Bridge unavailable, falling back to direct POST');
    try {
      const url = new URL(opts.proxyBase, window.location.origin);
      url.searchParams.set('table', opts.table);
      const fc = new AbortController();
      const ft = setTimeout(() => fc.abort(), 15000);
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.data),
        signal: fc.signal
      });
      clearTimeout(ft);
      if (!res.ok) {
        const errText = await res.text();
        return { ok: false, applied_mode: 'fallback_failed', errors: [`Direct POST failed (${res.status}): ${errText}`] };
      }
      let rows = [];
      try {
        rows = await res.json();
      } catch (_) { /* ignore */ }
      return { ok: true, applied_mode: 'direct_fallback_insert', rows: Array.isArray(rows) ? rows : [] };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, applied_mode: 'fallback_failed', errors: ['Fallback POST timed out (15s)'] };
      return { ok: false, applied_mode: 'fallback_failed', errors: [err.message] };
    }
  }

  return result;
}

let activitiesLoaded = false;
async function loadActivities() {
  try {
    const res = await fetch(`${API}/sync/sf-activities?limit=2000&sort_dir=desc&assigned_to=all`);
    if (!res.ok) { console.warn('Activities API returned', res.status); return; }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (_) { console.warn('Activities API returned non-JSON'); return; }
    const raw = (data && data.activities) || [];
    // Deduplicate — API returns ~2x duplicates
    const seen = new Set();
    activities = raw.filter(a => {
      const key = `${a.subject}|${a.contact_name||a.first_name}|${a.company_name}|${a.activity_date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    activitiesLoaded = true;
    console.debug(`Activities: ${raw.length} raw → ${activities.length} unique`);
    updateBizBadges();
    renderHomeStats();
    _setHTML('priorityTasks', renderPriorityTasks());
    _setHTML('categoryMetrics', renderCategoryMetrics());
    // Refresh gov outreach section if it's visible (it renders a placeholder while activities load)
    const govOutEl = document.getElementById('govOutreachInner');
    if (govOutEl && typeof renderGovOutreachInner === 'function') govOutEl.innerHTML = renderGovOutreachInner();
  } catch (e) {
    console.error('Activities load error:', e);
    activitiesLoaded = true;
    // Clear loading spinners even on error
    _setHTML('categoryMetrics', renderCategoryMetrics());
    _setHTML('priorityTasks', renderPriorityTasks());
  }
}

async function loadEmails() {
  try {
    // Use the Vercel API which reads from inbox_items (accurate total count,
    // not capped by edge function pagination limits)
    const res = await fetch('/api/sync?action=flagged_emails&limit=2000');
    if (!res.ok) throw new Error('API returned ' + res.status);
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (_) { console.warn('Emails API returned non-JSON'); return; }
    let rawEmails = (data && data.emails) || [];
    // Deduplicate by internet_message_id (DB already filters archived/resolved)
    const seen = new Set();
    rawEmails = rawEmails.filter(e => {
      if (e.flag_removed_at || e.status === 'archived' || e.status === 'dismissed') return false;
      const key = e.internet_message_id || e.external_id || `${e.subject||''}|${e.sender_email||e.sender_name||''}|${e.received_date||''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    emails = rawEmails;
    emailTotalCount = (data && data.total) || emails.length;
    renderHomeStats();
    _setHTML('recentEmails', renderRecentEmails());
  } catch (e) {
    console.error('Emails load error:', e);
    _setHTML('recentEmails', '<div class="widget-error"><div class="err-msg">Unable to load emails</div><button class="retry-btn" onclick="loadEmails()">Retry</button></div>');
  }
}

async function loadCalendar() {
  try {
    const res = await fetch(`${API}/sync/calendar-events?days_back=1&days_forward=14&limit=200`);
    if (!res.ok) throw new Error('API returned ' + res.status);
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (_) { throw new Error('Calendar API returned non-JSON'); }
    calEvents = (data && data.events) || [];
    renderHomeStats();
    const schedEl = document.getElementById('todaySchedule');
    if (schedEl) schedEl.innerHTML = renderTodaySchedule();
  } catch (e) {
    console.error('Calendar load error:', e);
    const schedEl = document.getElementById('todaySchedule');
    if (schedEl) schedEl.innerHTML = '<div class="widget-error"><div class="err-msg">Unable to load schedule</div><button class="retry-btn" onclick="loadCalendar()">Retry</button></div>';
  }
}

async function loadHealth() {
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error(res.status);
    const text = await res.text();
    const data = JSON.parse(text);
    const dot = document.getElementById('statusDot');
    if (dot) dot.className = data.status === 'ok' ? 'dot' : 'dot offline';
  } catch (_) { const dot = document.getElementById('statusDot'); if (dot) dot.className = 'dot offline'; }
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
    _setText('wxTemp', `${temp}°F`);
    _setHTML('wxDetails', `${emoji} ${desc}<br>High ${hi}° / Low ${lo}° · Humidity ${hum}% · Wind ${wind} mph`);
  } catch (e) {
    console.error('Weather load error:', e);
    _setText('wxTemp', '--°');
    _setHTML('wxDetails', '<div class="widget-error"><div class="err-msg">Weather unavailable</div><button class="retry-btn" onclick="loadWeather()">Retry</button></div>');
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

// Wire up chart range buttons
document.addEventListener('DOMContentLoaded', () => {
  // Hash-based deep linking for PWA shortcuts (e.g. #page=pageMyWork)
  try {
    const hash = location.hash;
    if (hash && hash.startsWith('#page=')) {
      const pageId = hash.slice(6);
      if (/^[a-zA-Z]+$/.test(pageId) && document.getElementById(pageId)) {
        setTimeout(function() { navTo(pageId); }, 0);
      }
    }
  } catch (_) { /* ignore hash parse errors */ }

  document.getElementById('yieldChartControls')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-range]');
    if (btn) loadYieldChart(btn.dataset.range);
  });

  // Eager-load gov overview stats so buildCopilotContext() always has them
  try {
    if (typeof loadGovOverviewStats === 'function') {
      loadGovOverviewStats();
    }
  } catch (e) {
    console.warn('[App] Failed to eager-load gov overview stats:', e.message);
  }
});

function renderHomeStats() {
  const elAct = document.getElementById('statActivities');
  const elEmails = document.getElementById('statEmails');
  const elDue = document.getElementById('statDue');
  const elEvents = document.getElementById('statEvents');

  // --- Activities stat ---
  // Prefer canonical work_counts when non-zero
  if (elAct) {
    if (canonicalCounts) {
      elAct.textContent = (canonicalCounts.open_actions || canonicalCounts.my_actions || 0).toLocaleString();
    } else if (mktLoaded && mktData.length > 0) {
      const userName = LCC_USER.display_name || 'Scott Briggs';
      const myTasks = mktData.filter(d => d.assigned_to === userName);
      const allProspects = ((window._mktOpportunities?.government?.length || 0) + (window._mktOpportunities?.dialysis?.length || 0) + (window._mktOpportunities?.all_other?.length || 0))
        + ((window._mktProspectContacts?.government?.length || 0) + (window._mktProspectContacts?.dialysis?.length || 0) + (window._mktProspectContacts?.all_other?.length || 0));
      elAct.textContent = (myTasks.length + allProspects).toLocaleString();
    } else if (activitiesLoaded && activities.length > 0) {
      elAct.textContent = activities.length.toLocaleString();
    }
  }
  // Don't write 0 — keep the "-" placeholder until real data arrives

  // --- Emails stat — always use edge function count when available ---
  if (elEmails) {
    if (emailTotalCount > 0 || emails.length > 0) {
      elEmails.textContent = (emailTotalCount || emails.length).toLocaleString();
    } else if (canonicalCounts && canonicalCounts.inbox_new > 0) {
      elEmails.textContent = canonicalCounts.inbox_new.toLocaleString();
    }
  }

  // --- Due This Week stat ---
  if (elDue) {
    if (canonicalCounts) {
      elDue.textContent = (canonicalCounts.due_this_week || 0).toLocaleString();
    } else if (mktLoaded && mktData.length > 0) {
      const now = Date.now(); const week = 7 * 86400000;
      const due = mktData.filter(d => { if (!d.due_date) return false; var t = new Date(d.due_date).getTime(); return t >= now && t <= now + week; });
      elDue.textContent = due.length;
    } else if (activitiesLoaded && activities.length > 0) {
      const now = Date.now(); const week = 7 * 86400000;
      const due = activities.filter(a => { if (!a.activity_date) return false; const d = new Date(a.activity_date).getTime(); return d >= now && d <= now + week; });
      elDue.textContent = due.length;
    }
  }

  // Calendar events always from edge function (individual calendar)
  if (elEvents) {
    const today = tzDateStr(new Date());
    const todayEvents = calEvents.filter(e => tzDateStr(e.start_time) === today && !isCanceled(e));
    elEvents.textContent = todayEvents.length;
  }
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

  // CRM rollup fallback — show overdue/due-today tasks from marketing pipeline
  if (mktLoaded && mktData.length > 0) {
    const today = localToday();
    const userName = LCC_USER.display_name || 'Scott Briggs';
    // Show overdue first, then due today, then upcoming — across all sources
    const allTasks = mktData.filter(d => d.assigned_to === userName);
    const overdue = allTasks.filter(d => d.due_date && d.due_date < today).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
    const dueToday = allTasks.filter(d => d.due_date === today);
    const upcoming = allTasks.filter(d => d.due_date && d.due_date > today).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
    const items = [...overdue, ...dueToday, ...upcoming].slice(0, 5);
    if (items.length === 0) return '<div style="color:var(--text2);font-size:13px">No tasks assigned to you.</div>';
    let html = '';
    for (const d of items) {
      const isOverdue = d.due_date && d.due_date < today;
      const dueLabel = d.due_date ? (d.due_date === today ? 'Today' : d.due_date) : '';
      html += `<div class="act-item${isOverdue ? ' overdue' : ''}" onclick="navTo('pageBiz');setTimeout(function(){switchBizTab('marketing')},100)">
        <div class="act-top"><div class="act-subject">${esc(d.contact_name || d.deal_display_name || '—')}</div></div>
        <div class="act-meta"><span class="act-company">${esc(d.company_name || '')}</span>${dueLabel ? `<span class="act-due${isOverdue ? ' text-overdue' : ''}">${dueLabel}</span>` : ''}</div>
      </div>`;
    }
    if (allTasks.length > 5) {
      html += `<div class="widget-more" onclick="navTo('pageBiz');setTimeout(function(){switchBizTab('marketing')},100)">View all ${allTasks.length} tasks</div>`;
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
  // Prefer canonical counts when available (zero is valid — means no open work)
  if (canonicalCounts) {
    let html = '<div class="cat-metrics">';
    html += `<div class="cat-metric clickable" onclick="navTo('pageMyWork')"><div class="cat-metric-val" style="color:var(--accent)">${canonicalCounts.my_actions || 0}</div><div class="cat-metric-lbl">My Actions</div></div>`;
    html += `<div class="cat-metric clickable" onclick="navTo('pageTeamQueue')"><div class="cat-metric-val" style="color:var(--cyan)">${canonicalCounts.open_actions || 0}</div><div class="cat-metric-lbl">Team Open</div></div>`;
    html += `<div class="cat-metric"><div class="cat-metric-val" style="color:var(--green)">${canonicalCounts.completed_week || 0}</div><div class="cat-metric-lbl">Done This Week</div></div>`;
    html += `<div class="cat-metric${(canonicalCounts.overdue || 0) > 0 ? ' overdue' : ''}"><div class="cat-metric-val" style="color:${(canonicalCounts.overdue || 0) > 0 ? 'var(--red)' : 'var(--yellow)'}">${canonicalCounts.overdue || 0}</div><div class="cat-metric-lbl">Overdue</div></div>`;
    html += '</div>';
    return html;
  }

  // CRM rollup fallback (same data source as renderHomeStats)
  if (mktLoaded && mktData.length > 0) {
    const userName = LCC_USER.display_name || 'Scott Briggs';
    const myTasks = mktData.filter(d => d.assigned_to === userName && d.open_task_count > 0);
    const allOpen = mktData.filter(d => d.open_task_count > 0);
    const now = Date.now();
    const overdue = mktData.filter(d => d.due_date && new Date(d.due_date).getTime() < now);
    let html = '<div class="cat-metrics">';
    html += `<div class="cat-metric clickable" onclick="navTo('pageBiz')"><div class="cat-metric-val" style="color:var(--accent)">${myTasks.length}</div><div class="cat-metric-lbl">My Actions</div></div>`;
    html += `<div class="cat-metric"><div class="cat-metric-val" style="color:var(--cyan)">${allOpen.length}</div><div class="cat-metric-lbl">Team Open</div></div>`;
    html += `<div class="cat-metric"><div class="cat-metric-val" style="color:var(--green)">0</div><div class="cat-metric-lbl">Done This Week</div></div>`;
    html += `<div class="cat-metric${overdue.length > 0 ? ' overdue' : ''}"><div class="cat-metric-val" style="color:${overdue.length > 0 ? 'var(--red)' : 'var(--yellow)'}">${overdue.length}</div><div class="cat-metric-lbl">Overdue</div></div>`;
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
    // Filter resolved flags and deduplicate by external_id or title+source composite
    const _inboxSeen = new Set();
    const _dedupedInbox = canonicalInbox.items.filter(item => {
      if (item.flag_removed_at || item.status === 'archived' || item.status === 'dismissed') return false;
      const key = item.external_id || `${item.title||''}|${item.source_ref||item.source_type||''}|${(item.received_at||'').substring(0,10)}`;
      if (_inboxSeen.has(key)) return false;
      _inboxSeen.add(key);
      return true;
    });
    let html = '';
    for (const item of _dedupedInbox) {
      const title = esc(item.title || '(No subject)');
      const source = esc(item.source_ref || item.source_type || '');
      const date = item.received_at ? formatDate(item.received_at) : '';
      const bodyPreview = (item.body || item.body_preview || '').substring(0, 120).replace(/\n/g, ' ');
      const link = outlookWebLink(item);
      html += `<div class="email-card canonical-inbox-item" onclick="navTo('pageInbox')">
        <div class="email-subj">${title}</div>
        <div class="email-from"><span>${source}</span><span>${date}</span></div>
        ${bodyPreview ? `<div class="email-preview" style="font-size:11px;color:var(--text3);margin-top:4px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(bodyPreview)}</div>` : ''}
        ${link ? `<a href="${safeHref(link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-block;margin-top:6px;font-size:11px;color:var(--accent);text-decoration:none">Open in Outlook ↗</a>` : ''}
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
    const link = outlookWebLink(e);
    const preview = (e.body_preview || '').substring(0, 120);
    html += `<div class="email-card">
      <div class="email-subj">${esc(e.subject || '(No subject)')}</div>
      <div class="email-from"><span>${esc(e.sender_name || e.sender_email || '')}</span><span>${formatDate(e.received_date)}</span></div>
      ${preview ? `<div class="email-preview" style="font-size:11px;color:var(--text3);margin-top:4px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(preview)}</div>` : ''}
      ${link ? `<a href="${safeHref(link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-block;margin-top:6px;font-size:11px;color:var(--accent);text-decoration:none">Open in Outlook ↗</a>` : ''}
    </div>`;
  }
  return html;
}

function getDefaultDailyBriefingRoleView() {
  const role = (LCC_USER.role || '').toLowerCase();
  if (role === 'operator' || role === 'viewer') return 'analyst_ops';
  return 'broker';
}

function getDailyBriefingRoleView() {
  try {
    const saved = localStorage.getItem('lcc-daily-briefing-role-view');
    if (saved === 'broker' || saved === 'analyst_ops') return saved;
  } catch (_) { /* ignore storage errors */ }
  return getDefaultDailyBriefingRoleView();
}

function setDailyBriefingRoleSwitchActive(roleView) {
  const root = document.getElementById('dailyBriefingRoleSwitch');
  if (!root) return;
  root.querySelectorAll('.db-role-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.roleView === roleView);
  });
}

function setDailyBriefingRoleView(roleView) {
  if (roleView !== 'broker' && roleView !== 'analyst_ops') return;
  dailyBriefingRoleView = roleView;
  try { localStorage.setItem('lcc-daily-briefing-role-view', roleView); } catch (_) { /* ignore */ }
  setDailyBriefingRoleSwitchActive(roleView);
  loadDailyBriefingData(true);
}
window.setDailyBriefingRoleView = setDailyBriefingRoleView;

function sanitizeBriefingHtml(rawHtml) {
  if (!rawHtml) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(rawHtml), 'text/html');
    doc.querySelectorAll('script, iframe, object, embed, style, link').forEach((node) => node.remove());
    doc.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '');
        if (name.startsWith('on') || name === 'style') {
          el.removeAttribute(attr.name);
          return;
        }
        if ((name === 'href' || name === 'src') && !/^https?:\/\//i.test(value) && !value.startsWith('#')) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return doc.body.innerHTML || '';
  } catch (_) {
    return '';
  }
}

function formatBriefingAsOf(asOf) {
  if (!asOf) return 'Unknown';
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return asOf;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago'
  });
}

function renderBriefingItems(items, emptyLabel, limit = 5) {
  const list = Array.isArray(items) ? items.slice(0, limit) : [];
  if (list.length === 0) return `<div class="db-empty">${esc(emptyLabel)}</div>`;
  return '<ul class="db-list">' + list.map((item) => {
    if (typeof item === 'string') return `<li>${esc(item)}</li>`;
    const title = item?.title || item?.label || item?.id || '(Untitled)';
    const meta = [item?.status, item?.priority, item?.domain].filter(Boolean).join(' · ');
    return `<li><span class="db-li-title">${esc(title)}</span>${meta ? `<span class="db-li-meta">${esc(meta)}</span>` : ''}</li>`;
  }).join('') + '</ul>';
}

function renderDailyBriefingPanel() {
  const el = document.getElementById('dailyBriefingContent');
  if (!el) return;

  const roleView = dailyBriefingRoleView || getDailyBriefingRoleView();
  setDailyBriefingRoleSwitchActive(roleView);

  if (!dailyBriefingLoaded) {
    el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    return;
  }
  if (!dailyBriefingSnapshot) {
    el.innerHTML = '<div class="widget-error"><div class="err-msg">Daily briefing unavailable.</div><button class="retry-btn" onclick="loadDailyBriefingData(true)">Retry</button></div>';
    return;
  }

  const snap = dailyBriefingSnapshot;
  const status = snap.status || {};
  const degraded = status.completeness === 'degraded';
  const missing = Array.isArray(status.missing_sections) ? status.missing_sections : [];
  const gmi = snap.global_market_intelligence || {};
  const usp = snap.user_specific_priorities || {};
  const team = snap.team_level_production_signals || {};
  const wc = team.work_counts || {};
  const domain = snap.domain_specific_alerts_highlights || {};
  const actions = Array.isArray(snap.actions) ? snap.actions : [];

  let html = '';
  html += '<div class="db-meta-row">';
  html += `<span class="db-asof">As of ${esc(formatBriefingAsOf(snap.as_of))}</span>`;
  html += `<span style="margin:0 6px;color:var(--text3)">·</span>`;
  html += `<span class="db-status ${degraded ? 'degraded' : 'full'}">${degraded ? 'Partial' : 'Complete'}</span>`;
  html += '</div>';

  if (degraded && missing.length > 0) {
    html += `<div class="db-missing" style="font-size:11px;color:var(--text3);margin-top:2px">Some briefing sections are still loading</div>`;
  }

  html += '<div class="db-section">';
  html += '<div class="db-section-title">Market Intelligence</div>';
  html += `<div class="db-summary">${esc(gmi.summary || 'No market summary available yet.')}</div>`;
  html += renderBriefingItems(gmi.highlights || [], 'No market highlights.', 3);
  if (gmi.html_fragment) {
    html += '<details class="db-more-market"><summary>More market detail</summary>';
    html += `<div class="db-market-html">${sanitizeBriefingHtml(gmi.html_fragment)}</div>`;
    html += '</details>';
  }
  html += '</div>';

  html += '<div class="db-grid">';
  html += '<div class="db-section">';
  html += '<div class="db-section-title">My Priorities</div>';
  html += renderBriefingItems(usp.today_top_5 || [], 'No priority items.', 5);
  html += '</div>';
  html += '<div class="db-section">';
  html += '<div class="db-section-title">Team Signals</div>';
  html += '<div class="db-kpis">';
  html += `<div class="db-kpi"><span>Open</span><strong>${Number(wc.open_actions || 0).toLocaleString()}</strong></div>`;
  html += `<div class="db-kpi"><span>Inbox New</span><strong>${Number(wc.inbox_new || 0).toLocaleString()}</strong></div>`;
  html += `<div class="db-kpi"><span>Sync Errors</span><strong>${Number(wc.sync_errors || 0).toLocaleString()}</strong></div>`;
  html += `<div class="db-kpi"><span>Overdue</span><strong>${Number(wc.overdue || 0).toLocaleString()}</strong></div>`;
  html += '</div>';
  html += '</div>';
  html += '</div>';

  const gov = domain.government || {};
  const dia = domain.dialysis || {};
  html += '<div class="db-grid">';
  html += '<div class="db-section">';
  html += '<div class="db-section-title">Government Highlights</div>';
  html += renderBriefingItems(gov.highlights || [], 'No government highlights.', 3);
  html += '</div>';
  html += '<div class="db-section">';
  html += '<div class="db-section-title">Dialysis Highlights</div>';
  html += renderBriefingItems(dia.highlights || [], 'No dialysis highlights.', 3);
  html += '</div>';
  html += '</div>';

  html += '<div class="db-section">';
  html += '<div class="db-section-title">Action Links</div>';
  if (actions.length === 0) {
    html += '<div class="db-empty">No action links.</div>';
  } else {
    html += '<div class="db-actions">';
    actions.slice(0, 6).forEach((action) => {
      const label = esc(action.label || 'Open');
      const target = String(action.target || '').trim();
      if (!target) return;
      if (action.type === 'nav') {
        html += `<a class="db-action" href="#" onclick="event.preventDefault();navTo('${esc(target)}')">${label}</a>`;
      } else if (target.startsWith('/')) {
        html += `<a class="db-action" href="${esc(target)}">${label}</a>`;
      } else if (target.startsWith('http://') || target.startsWith('https://')) {
        html += `<a class="db-action" href="${safeHref(target)}" target="_blank" rel="noopener">${label}</a>`;
      } else {
        html += `<span class="db-action disabled">${label}</span>`;
      }
    });
    html += '</div>';
  }
  html += '</div>';

  el.innerHTML = html;
}

async function loadDailyBriefingData(force = false) {
  const roleView = getDailyBriefingRoleView();
  dailyBriefingRoleView = roleView;
  setDailyBriefingRoleSwitchActive(roleView);

  if (!force && dailyBriefingLoaded && dailyBriefingSnapshot) {
    renderDailyBriefingPanel();
    return;
  }

  dailyBriefingLoaded = false;
  renderDailyBriefingPanel();

  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;

  try {
    const res = await fetch(`/api/daily-briefing?action=snapshot&role_view=${encodeURIComponent(roleView)}`, { headers });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    dailyBriefingSnapshot = await res.json();
  } catch (e) {
    console.warn('[DailyBriefing] Load failed:', e.message);
    dailyBriefingSnapshot = null;
  } finally {
    dailyBriefingLoaded = true;
    renderDailyBriefingPanel();
  }
}
window.loadDailyBriefingData = loadDailyBriefingData;

// ============================================================
// TEAM PULSE — manager/owner widget showing team health at a glance
// ============================================================
function renderTeamPulse() {
  const widget = document.getElementById('teamPulseWidget');
  const el = document.getElementById('teamPulseContent');
  if (!widget || !el) return;

  // Only show for managers/owners with meaningful canonical data
  const isManager = LCC_USER.role === 'owner' || LCC_USER.role === 'manager';
  const hasData = canonicalCounts && (
    (canonicalCounts.open_actions || 0) > 0 || (canonicalCounts.open_escalations || 0) > 0 ||
    (canonicalCounts.sync_errors || 0) > 0 || (canonicalCounts.in_progress || 0) > 0
  );
  if (!isManager || !hasData) {
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
  const calEl = document.getElementById('calendarFull');
  if (!calEl) return;
  if (calEvents.length === 0) { calEl.innerHTML = '<div style="color:var(--text2)">No events loaded.</div>'; return; }
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
  calEl.innerHTML = html;
}

// ============================================================
// KEYBOARD
// ============================================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Custom modal handles its own Escape via stopPropagation — safety net
    if (_isModalOpen()) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
      e.target.blur();
      return;
    }
    closeDetail();
    closeLogCall();
    if (typeof closeLogReschedule === 'function') closeLogReschedule();
    if (typeof closeAssignModal === 'function') closeAssignModal();
    if (typeof closeEscalateModal === 'function') closeEscalateModal();
    if (typeof closeFollowupModal === 'function') closeFollowupModal();
  }
});

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
    if (!res.ok) throw new Error('HTTP ' + res.status);
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
      const linkAttr = ev.web_link ? ` data-href="${encodeURIComponent(ev.web_link)}" onclick="var _u=decodeURIComponent(this.dataset.href);if(_u.match(/^https?:\\/\\//i))window.open(_u,'_blank','noopener')"` : '';
      html += `<div style="padding:8px 16px;border-bottom:1px solid var(--s2);cursor:pointer"${linkAttr}>
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
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    // Use flagged emails as the primary message source
    if (emails.length > 0) {
      msgData.flagged = emails;
    } else {
      const res = await fetch('/api/sync?action=flagged_emails&limit=500');
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
  if (!el) return;
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
      link: outlookWebLink(e),
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
    html += `<div class="msg-item${m.unread ? ' unread' : ''}">
      <div class="msg-header">
        <div class="msg-sender">${esc(m.sender)}</div>
        <div class="msg-time">${formatDate(m.time)}</div>
      </div>
      <div class="msg-subject">${esc(m.subject)}</div>
      ${m.preview ? `<div class="msg-preview">${esc(m.preview)}</div>` : ''}
      ${m.link ? `<a href="${safeHref(m.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-block;margin-top:6px;font-size:11px;color:var(--accent);text-decoration:none">Open in Outlook ↗</a>` : ''}
    </div>`;
  }
  if (items.length > 50) html += `<div style="text-align:center;padding:12px;color:var(--text3);font-size:12px">Showing 50 of ${items.length} messages</div>`;
  el.innerHTML = html;
}

function filterMessages() { renderMessages(); }

// Message tab click handler
document.getElementById('msgTabs')?.addEventListener('click', (e) => {
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
  } catch (e) { console.warn('[Settings] Load failed:', e.message); }
}
function saveSettings() {
  try { localStorage.setItem(LCC_SETTINGS_KEY, JSON.stringify(appSettings)); } catch (e) { console.warn('[Settings] Save failed:', e.message); }
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
        <div class="settings-val" style="color:${(emailTotalCount || emails.length) > 0 ? 'var(--green)' : 'var(--yellow)'}">${emailTotalCount > 0 ? emailTotalCount.toLocaleString() + ' emails' : emails.length > 0 ? emails.length + ' emails' : 'No data'}</div>
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
async function clearCacheAndReload() {
  if (await lccConfirm('Clear all cached data and reload the app?', 'Clear & Reload')) {
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
let hotLeadsCache = []; // populated by loadHotLeads, used by buildCopilotContext
let copilotHistory = [];

function toggleCopilot() {
  copilotOpen = !copilotOpen;
  document.getElementById('copilotPanel')?.classList.toggle('open', copilotOpen);
  document.getElementById('copilotFab')?.classList.toggle('hidden', copilotOpen);
  if (copilotOpen) {
    setTimeout(() => document.getElementById('copilotInput')?.focus(), 300);
  }
}

function sendCopilotSuggestion(text) {
  const input = document.getElementById('copilotInput');
  if (input) { input.value = text; sendCopilotMessage(); }
}

/**
 * Invoke a structured Copilot action via the action dispatcher.
 * Used by UI buttons, suggestion chips, and programmatic triggers.
 * @param {string} actionName - registered action from copilot_action_registry.json
 * @param {object} params - action parameters
 * @param {boolean} confirmed - if true, bypasses confirmation prompt for write actions
 */
async function sendCopilotAction(actionName, params = {}, confirmed = false) {
  if (!copilotOpen) toggleCopilot();

  const label = actionName.replace(/_/g, ' ');
  appendCopilotMsg(`Run action: ${label}`, 'user');

  const typingId = 'typing-' + Date.now();
  appendCopilotMsg('Running...', 'bot typing', typingId);

  try {
    const res = await fetch(CHAT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LCC-Workspace': LCC_USER.workspace_id || '',
      },
      body: JSON.stringify({
        copilot_action: actionName,
        params: { ...params, _confirmed: confirmed },
      }),
    });

    const data = await res.json().catch(() => ({}));
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();

    if (data.requires_confirmation) {
      const msg = data.message || `Action "${actionName}" requires confirmation.`;
      appendCopilotMsg(msg, 'bot');
      appendCopilotMsg(
        `<div class="copilot-suggestions" style="margin-top:6px"><button class="copilot-suggestion" onclick="sendCopilotAction('${actionName}', ${JSON.stringify(params).replace(/'/g, '\\\'')}, true)">Confirm and execute</button></div>`,
        'bot html'
      );
      return;
    }

    // Render structured result
    renderCopilotActionResult(actionName, data);

  } catch (e) {
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();
    appendCopilotMsg(`Action failed: ${e.message}`, 'bot');
  }
}

/**
 * Render structured action results with rich formatting and follow-up chips.
 */
function renderCopilotActionResult(actionName, data) {
  // AI-generated text response
  if (data.response) {
    appendCopilotMsg(data.response, 'bot');
    copilotHistory.push({ role: 'assistant', content: data.response });
  }

  // Briefing snapshot stats card
  if (data.snapshot && data.snapshot.work_counts) {
    const s = data.snapshot;
    const wc = s.work_counts;
    let html = '<div style="font-size:12px;margin-top:4px">';
    html += '<div style="font-weight:600;margin-bottom:6px;color:var(--text2)">Today\'s Snapshot</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    if (s.strategic_count > 0) html += _statChip('Strategic', s.strategic_count, '#d32f2f');
    if (s.important_count > 0) html += _statChip('Important', s.important_count, '#f57c00');
    if (s.urgent_count > 0) html += _statChip('Urgent', s.urgent_count, 'var(--accent)');
    html += _statChip('Inbox', s.inbox_total || 0, 'var(--text2)');
    if (wc.overdue > 0) html += _statChip('Overdue', wc.overdue, '#d32f2f');
    if (wc.due_this_week > 0) html += _statChip('Due This Week', wc.due_this_week, '#f57c00');
    html += '</div></div>';
    appendCopilotMsg(html, 'bot html');
  }

  // Contact list card (prospecting brief)
  if (data.contacts && data.contacts.length) {
    let html = '<div style="font-size:12px;margin-top:4px">';
    html += '<div style="font-weight:600;margin-bottom:6px;color:var(--text2)">Top Contacts</div>';
    data.contacts.slice(0, 5).forEach(function(c) {
      const heatColor = c.heat === 'hot' ? '#d32f2f' : c.heat === 'warm' ? '#f57c00' : '#1565c0';
      html += '<div style="padding:6px 0;border-bottom:1px solid var(--border)">';
      html += '<div style="display:flex;justify-content:space-between"><strong>' + esc(c.name) + '</strong><span style="color:' + heatColor + ';font-size:11px;font-weight:600">' + (c.heat || '').toUpperCase() + ' (' + (c.score || 0) + ')</span></div>';
      if (c.company) html += '<div style="color:var(--text3);font-size:11px">' + esc(c.company) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    appendCopilotMsg(html, 'bot html');
  }

  // Relationship context card
  if (data.contact && data.contact.relationship_health) {
    const c = data.contact;
    const healthColor = c.relationship_health.score >= 80 ? 'var(--green)' : c.relationship_health.score >= 50 ? '#f57c00' : '#d32f2f';
    let html = '<div style="font-size:12px;background:var(--s2);border-radius:8px;padding:10px;margin-top:4px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center"><strong>' + esc(c.name) + '</strong><span style="color:' + healthColor + ';font-size:11px;font-weight:600">' + (c.relationship_health.label || '').toUpperCase() + ' (' + c.relationship_health.score + ')</span></div>';
    if (c.company) html += '<div style="color:var(--text3);font-size:11px">' + esc(c.company) + (c.title ? ' &middot; ' + esc(c.title) : '') + '</div>';
    html += '<div style="display:flex;gap:12px;margin-top:6px;font-size:11px;color:var(--text2)">';
    html += '<span>Calls: ' + c.total_calls + '</span><span>Emails: ' + c.total_emails + '</span>';
    if (c.days_since_last_touch !== null) html += '<span>Last touch: ' + c.days_since_last_touch + 'd ago</span>';
    html += '</div></div>';
    appendCopilotMsg(html, 'bot html');
  }

  // Pipeline stats card
  if (data.pipeline) {
    const p = data.pipeline;
    let html = '<div style="font-size:12px;margin-top:4px">';
    html += '<div style="font-weight:600;margin-bottom:6px;color:var(--text2)">Pipeline Snapshot</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += _statChip('Active', p.total_active, 'var(--accent)');
    html += _statChip('Completed (30d)', p.total_completed_30d, 'var(--green)');
    html += _statChip('Overdue', p.overdue?.count || 0, p.overdue?.count > 0 ? '#d32f2f' : 'var(--text3)');
    html += _statChip('Stale', p.stale?.count || 0, p.stale?.count > 0 ? '#f57c00' : 'var(--text3)');
    html += _statChip('Escalations', p.escalations?.open_count || 0, p.escalations?.open_count > 0 ? '#d32f2f' : 'var(--text3)');
    if (p.avg_days_to_complete !== null) html += _statChip('Avg Days', p.avg_days_to_complete, 'var(--text2)');
    html += '</div></div>';
    appendCopilotMsg(html, 'bot html');
  }

  // Entity merge results
  if (data.entity_duplicates || data.contact_merge_queue) {
    let html = '<div style="font-size:12px;margin-top:4px">';
    if (data.entity_duplicates?.groups > 0) {
      html += '<div style="font-weight:600;color:var(--text2)">Entity Duplicates: ' + data.entity_duplicates.groups + ' group(s)</div>';
    }
    if (data.contact_merge_queue?.pending > 0) {
      html += '<div style="font-weight:600;color:var(--text2);margin-top:4px">Contact Merges Pending: ' + data.contact_merge_queue.pending + '</div>';
    }
    html += '</div>';
    appendCopilotMsg(html, 'bot html');
  }

  // To Do task created
  if (data.task && data.task.id) {
    let html = '<div style="font-size:12px;background:var(--s2);border-radius:8px;padding:10px;margin-top:4px">';
    html += '<div style="font-weight:600;color:var(--green)">Task Created in Microsoft To Do</div>';
    html += '<div style="margin-top:4px">' + esc(data.task.title) + '</div>';
    html += '<div style="color:var(--text3);font-size:11px;margin-top:2px">List: ' + esc(data.task.list) + ' &middot; Status: ' + (data.task.status || 'notStarted') + '</div>';
    html += '</div>';
    appendCopilotMsg(html, 'bot html');
  }

  // Document assembly result
  if (data.saved_file) {
    let html = '<div style="font-size:12px;background:var(--s2);border-radius:8px;padding:10px;margin-top:4px">';
    html += '<div style="font-weight:600;color:var(--green)">Document Saved to OneDrive</div>';
    html += '<div style="margin-top:4px">' + esc(data.title || data.saved_file.name) + '</div>';
    html += '<div style="color:var(--text3);font-size:11px;margin-top:2px">Folder: ' + esc(data.saved_file.folder) + '</div>';
    if (data.saved_file.web_url) {
      html += '<div style="margin-top:6px"><a href="' + data.saved_file.web_url + '" target="_blank" style="color:var(--accent);font-size:12px;text-decoration:none">Open in OneDrive &rarr;</a></div>';
    }
    html += '</div>';
    appendCopilotMsg(html, 'bot html');
  } else if (data.doc_type && data.html_available && !data.saved_file) {
    let html = '<div style="font-size:12px;background:var(--s2);border-radius:8px;padding:10px;margin-top:4px">';
    html += '<div style="font-weight:600;color:var(--text2)">Document Generated</div>';
    html += '<div style="margin-top:4px">' + esc(data.title || '') + '</div>';
    html += '<div style="color:var(--text3);font-size:11px;margin-top:2px">Configure MS_GRAPH_TOKEN with Files.ReadWrite scope to auto-save to OneDrive.</div>';
    html += '</div>';
    appendCopilotMsg(html, 'bot html');
  }

  // Fallback for unstructured data results
  if (!data.response && data.data && !data.contacts && !data.pipeline && !data.contact) {
    const count = Array.isArray(data.data) ? data.data.length : 1;
    appendCopilotMsg(`Retrieved ${count} result(s).`, 'bot');
  }

  // Contextual follow-up suggestions
  const followUps = getFollowUpSuggestions(actionName, data);
  if (followUps.length) {
    let html = '<div class="copilot-suggestions" style="margin-top:4px">';
    followUps.forEach(function(f) {
      if (f.action) {
        html += '<button class="copilot-suggestion" onclick="sendCopilotAction(\'' + f.action + '\', ' + JSON.stringify(f.params || {}).replace(/'/g, "\\'") + ')">' + esc(f.label) + '</button>';
      } else {
        html += '<button class="copilot-suggestion" onclick="sendCopilotSuggestion(\'' + f.text.replace(/'/g, "\\'") + '\')">' + esc(f.label) + '</button>';
      }
    });
    html += '</div>';
    appendCopilotMsg(html, 'bot html');
  }
}

function _statChip(label, value, color) {
  return '<div style="background:var(--s2);border-radius:6px;padding:4px 8px;text-align:center"><div style="font-size:16px;font-weight:700;color:' + color + '">' + value + '</div><div style="font-size:10px;color:var(--text3)">' + label + '</div></div>';
}

function getFollowUpSuggestions(actionName, data) {
  switch (actionName) {
    case 'generate_prospecting_brief':
      if (data.contacts?.length) {
        const top = data.contacts[0];
        return [
          { label: 'Draft email to ' + (top.name || 'top contact'), action: 'draft_outreach_email', params: { contact_name: top.name, intent: 'reconnect and explore opportunities' } },
          { label: 'Relationship context', action: 'get_relationship_context', params: { contact_name: top.name } },
          { label: 'Pipeline health', action: 'get_pipeline_intelligence' }
        ];
      }
      return [];
    case 'draft_outreach_email':
    case 'draft_seller_update_email':
      return [
        { label: 'Create To Do follow-up', action: 'create_todo_task', params: { title: 'Follow up on email draft', list_name: 'Work' } },
        { label: 'Back to call sheet', action: 'generate_prospecting_brief' }
      ];
    case 'get_relationship_context':
      return [
        { label: 'Draft outreach', action: 'draft_outreach_email', params: { contact_name: data.contact?.name } },
        { label: 'Pursuit dossier', action: 'generate_listing_pursuit_dossier', params: { entity_name: data.contact?.company } },
        { label: 'Pipeline health', action: 'get_pipeline_intelligence' }
      ];
    case 'get_pipeline_intelligence':
      return [
        { label: 'Daily briefing', action: 'get_daily_briefing_snapshot' },
        { label: 'Check sync health', text: 'Any sync issues?' },
        { label: 'Review duplicates', action: 'guided_entity_merge' }
      ];
    case 'generate_listing_pursuit_dossier':
      return [
        { label: 'Create follow-up task', action: 'create_listing_pursuit_followup_task', params: { title: 'Pursuit follow-up: ' + (data.entity?.name || ''), action_type: 'follow_up' } },
        { label: 'Draft outreach to owner', action: 'draft_outreach_email', params: { intent: 'listing pursuit introduction' } }
      ];
    case 'generate_document':
      return [
        { label: 'Create follow-up task', action: 'create_todo_task', params: { title: 'Review and finalize ' + (data.doc_type || 'document'), list_name: 'Work' } },
        { label: 'Draft email to client', action: 'draft_outreach_email', params: { intent: 'share ' + (data.doc_type || 'document') + ' for review' } },
        { label: 'Pursuit dossier', action: 'generate_listing_pursuit_dossier', params: { entity_name: data.entity?.name } }
      ];
    case 'guided_entity_merge':
      return [
        { label: 'Data quality report', text: 'Show me data quality issues' },
        { label: 'Pipeline health', action: 'get_pipeline_intelligence' }
      ];
    case 'get_daily_briefing_snapshot':
      return [
        { label: 'Prospecting call sheet', action: 'generate_prospecting_brief' },
        { label: 'Check inbox', text: 'What needs triage in the inbox?' },
        { label: 'Pipeline health', action: 'get_pipeline_intelligence' }
      ];
    default:
      return [];
  }
}

async function sendCopilotMessage() {
  const input = document.getElementById('copilotInput');
  if (!input) return;
  const sendBtn = document.getElementById('copilotSend');
  const msg = input.value.trim();
  if (!msg) return;

  // Disable input during request to prevent double-submission
  if (sendBtn) sendBtn.disabled = true;
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
    const reply = await invokeLccAssistant({
      message: msg,
      context,
      history: copilotHistory.slice(-6),
      feature: 'global_copilot',
    });

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
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

function appendCopilotMsg(text, cls, id) {
  const container = document.getElementById('copilotMessages');
  if (!container) return;
  const div = document.createElement('div');
  const isRawHtml = cls && cls.includes('html');
  div.className = 'copilot-msg ' + cls.replace('html', '').trim();
  if (id) div.id = id;
  div.innerHTML = isRawHtml ? text : formatCopilotText(text);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function formatCopilotText(text) {
  // Escape HTML first to prevent XSS, then apply markdown-like formatting
  const safe = esc(text);
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
    .replace(/`(.+?)`/g, '<code style="background:var(--s2);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>');
}

async function invokeLccAssistant({ message, context = {}, history = [], attachments = [], feature = 'embedded_assistant' }) {
  const res = await fetch(CHAT_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LCC-Workspace': LCC_USER.workspace_id || '',
    },
    body: JSON.stringify({
      message,
      context: {
        ...context,
        assistant_feature: feature,
      },
      history: Array.isArray(history) ? history : [],
      attachments: Array.isArray(attachments) ? attachments : [],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `AI request failed (${res.status})`);
  }
  return data.response || data.message || data.reply || '';
}

function buildCopilotContext() {
  const ctx = {};
  const now = new Date();
  const today = tzDateStr(now);
  const weekAgo = new Date(now - 7 * 86400000);
  const userName = LCC_USER.display_name || 'User';

  ctx.user_name = userName;
  ctx.current_date = today;
  ctx.total_activities = activities.length;
  ctx.total_flagged_emails = emailTotalCount || emails.length;
  ctx.gov_connected = govConnected;
  ctx.dia_connected = diaConnected;

  // Today's calendar events with details (not just count)
  const todayEvents = calEvents.filter(e => tzDateStr(e.start_time) === today && !isCanceled(e));
  ctx.today_events = todayEvents.slice(0, 10).map(e => ({
    subject: e.subject || '(No title)',
    time: e.is_all_day ? 'All day' : new Date(e.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    attendees: (e.attendees || []).length
  }));

  // Overdue CRM tasks
  if (typeof mktLoaded !== 'undefined' && mktLoaded && typeof mktData !== 'undefined' && mktData.length > 0) {
    const overdue = mktData.filter(d => d.due_date && d.due_date < today && d.assigned_to === userName);
    ctx.overdue_tasks = overdue.slice(0, 5).map(d => ({
      contact: d.contact_name || d.deal_display_name,
      company: d.company_name,
      due: d.due_date
    }));
    ctx.overdue_count = overdue.length;

    // Due today
    const dueToday = mktData.filter(d => d.due_date === today && d.assigned_to === userName);
    ctx.due_today = dueToday.slice(0, 5).map(d => ({
      contact: d.contact_name || d.deal_display_name,
      company: d.company_name
    }));
    ctx.due_today_count = dueToday.length;
  }

  // Recent activities with details
  const thisWeek = activities.filter(a => a.activity_date && new Date(a.activity_date) >= weekAgo);
  ctx.activities_this_week = thisWeek.length;
  ctx.recent_activities = thisWeek.slice(0, 8).map(a => ({
    subject: a.subject,
    contact: a.contact_name || a.first_name,
    company: a.company_name,
    category: a.computed_category || 'General',
    date: a.activity_date
  }));

  // Category breakdown
  const cats = {};
  for (const a of activities) {
    const c = a.computed_category || 'General';
    cats[c] = (cats[c] || 0) + 1;
  }
  ctx.category_breakdown = cats;

  // Flagged email senders (top 5)
  if (emails.length > 0) {
    ctx.recent_emails = emails.slice(0, 5).map(e => ({
      from: e.sender_name || e.sender_email,
      subject: e.subject
    }));
  }

  // Pipeline summary
  if (typeof window !== 'undefined' && window._mktOpportunities) {
    ctx.pipeline = {
      government: (window._mktOpportunities.government || []).length,
      dialysis: (window._mktOpportunities.dialysis || []).length,
      all_other: (window._mktOpportunities.all_other || []).length
    };
  }

  // Gov portfolio stats from materialized view (loaded by gov.js)
  if (typeof govOverviewStats !== 'undefined' && govOverviewStats) {
    ctx.gov_portfolio = {
      total_properties: govOverviewStats.total_properties,
      total_sf_leased: govOverviewStats.total_sf_leased,
      total_gross_rent: govOverviewStats.total_gross_rent,
      avg_rent_per_sf: govOverviewStats.avg_rent_per_sf,
      agencies_tracked: govOverviewStats.agencies_tracked,
      expiring_lt_1yr: govOverviewStats.expiring_lt_1yr,
      expiring_lt_2yr: govOverviewStats.expiring_lt_2yr,
      term_2_5yr: govOverviewStats.term_2_5yr,
      term_5plus: govOverviewStats.term_5plus,
      total_noi: govOverviewStats.total_noi,
      total_contacts: govOverviewStats.total_contacts,
      top_agencies_by_count: govOverviewStats.top_agencies_by_count,
      top_states_by_count: govOverviewStats.top_states_by_count
    };
  }

  // Dialysis portfolio stats (loaded by dialysis.js)
  if (typeof diaData !== 'undefined' && diaData && diaData.freshness) {
    ctx.dia_portfolio = {
      freshness: diaData.freshness,
      inventory_summary: diaData.inventorySummary,
      property_review_queue_count: (diaData.propertyReviewQueue || []).length,
      lease_backfill_count: (diaData.leaseBackfillRows || []).length,
      research_outcomes_count: (diaData.researchOutcomes || []).length,
      movers_up_count: (diaData.moversUp || []).length,
      movers_down_count: (diaData.moversDown || []).length
    };
  }

  // Hot leads summary for prospecting context (loaded by contacts tab)
  if (typeof hotLeadsCache !== 'undefined' && Array.isArray(hotLeadsCache) && hotLeadsCache.length) {
    ctx.hot_leads_summary = {
      count: hotLeadsCache.length,
      top_5: hotLeadsCache.slice(0, 5).map(c => ({
        name: c.full_name,
        company: c.company_name,
        score: c.engagement_score,
        heat: c.heat || (c.engagement_score >= 60 ? 'hot' : c.engagement_score >= 30 ? 'warm' : 'cool'),
        last_call: c.last_call_date || 'never',
        last_email: c.last_email_date || 'never'
      }))
    };
  }

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
const _greetEl = document.getElementById('greeting');
const _greetDateEl = document.getElementById('greetingDate');
if (_greetEl) _greetEl.textContent = getGreeting();
if (_greetDateEl) _greetDateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });

// Initialize auth module, then load user context, flags, and data
// IMPORTANT: Auth init must complete BEFORE data loading begins.
// In production mode, unauthenticated users see a login modal instead of spinners.
function bootApp() {
  loadUserContext().then(() => {
    loadFeatureFlags().then(() => {
      applyFeatureFlags();
      autoConnectCredentials().then(() => {
        Promise.all([loadActivities(), loadEmails(), loadCalendar(), loadHealth(), loadWeather(), loadMarket(), loadPersonalCalendar(), loadPersonalTasks(), loadCanonicalData(), loadDailyBriefingData()])
          .then(() => { updateGreeting(); if (checkFlag('auto_sync_on_load')) triggerCanonicalSync(); })
          .catch(() => { updateGreeting(); if (checkFlag('auto_sync_on_load')) triggerCanonicalSync(); });
      });
    });
  });
}

(typeof LCC_AUTH !== 'undefined' ? LCC_AUTH.init() : Promise.resolve()).then(() => {
  const mode = typeof LCC_AUTH !== 'undefined' ? LCC_AUTH.authMode : 'no-auth-module';
  console.info('[App] Auth mode:', mode);

  if (mode === 'unauthenticated') {
    // Production/staging with no session — show login, don't load data
    console.info('[App] No session — showing login modal');
    LCC_AUTH.showLoginModal();
    // Listen for successful sign-in to boot the app
    const _origRender = LCC_AUTH._onAuthBoot;
    const checkBoot = setInterval(() => {
      if (LCC_AUTH.isAuthenticated || LCC_AUTH.isDevMode) {
        clearInterval(checkBoot);
        bootApp();
      }
    }, 500);
    return;
  }

  // Authenticated (JWT) or dev-fallback — proceed normally
  bootApp();
}).catch(e => {
  console.warn('[App] Auth init error:', e.message);
  // On auth init failure, still try to load (dev mode safety net)
  bootApp();
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
    console.debug('Auto-refresh triggered');
    loadActivities();
    loadEmails();
    loadCalendar();
    loadHealth();
    loadWeather();
    loadMarket();
    loadCanonicalData();
    loadDailyBriefingData(true);
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
      loadDailyBriefingData(true);
      updateGreeting();
    }
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(function(reg) {
    // ── SW update notification ──
    reg.addEventListener('updatefound', function() {
      var newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', function() {
        if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
          showToast('Update available — tap to refresh', 'info');
          var t = document.getElementById('toast');
          if (t) { t.style.cursor = 'pointer'; t.onclick = function() { window.location.reload(); }; }
        }
      });
    });
  }).catch(function(err) {
    console.warn('[SW] Registration failed:', err.message);
  });
}

// ── Online / Offline detection ──
window.addEventListener('offline', function() { showToast('You are offline — changes may not save', 'error'); });
window.addEventListener('online', function() { showToast('Back online', 'success'); });

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

// ============================================================
// LIVE INGEST WORKBENCH
// Shared multimodal intake for Government + Dialysis research
// ============================================================

const LIVE_INGEST_ALLOWED_TABLES = {
  government: ['properties', 'prospect_leads', 'ownership_history', 'sales_transactions', 'loans', 'research_queue_outcomes'],
  dialysis: ['properties', 'ownership_history', 'sales_transactions', 'research_queue_outcomes']
};

const liveIngestState = {
  government: createLiveIngestDomainState(),
  dialysis: createLiveIngestDomainState()
};

function createLiveIngestDomainState() {
  return {
    sourceLabel: '',
    notes: '',
    attachments: [],
    lookupQuery: '',
    lookupLoading: false,
    lookupResults: [],
    boundTarget: null,
    entityLoading: false,
    entityResults: [],
    selectedEntity: null,
    proposal: null,
    extractionDocs: [],
    preparedTextDocs: [],
    preparedImageAttachments: [],
    lowConfidenceOcrAcknowledged: false,
    citationRiskAcknowledged: false,
    worsenedRetryAcknowledged: false,
    provenanceTrustFilter: 'all',
    loadingSnapshots: false,
    extracting: false,
    applying: false,
    error: '',
    lastAppliedAt: '',
    rawResponse: ''
  };
}

function getLiveIngestState(domainKey) {
  if (!liveIngestState[domainKey]) liveIngestState[domainKey] = createLiveIngestDomainState();
  return liveIngestState[domainKey];
}

/** Toggle Live Intake collapsed/expanded and re-render current tab */
window.toggleLiveIntake = function() {
  window._liveIntakeCollapsed = !(window._liveIntakeCollapsed == null ? true : window._liveIntakeCollapsed);
  // Re-render current tab to reflect toggle
  if (typeof currentBizTab !== 'undefined') {
    if (currentBizTab === 'dialysis' && typeof renderDiaTab === 'function') renderDiaTab();
    else if (currentBizTab === 'government' && typeof renderGovTab === 'function') renderGovTab();
  }
};

function renderLiveIngestWorkbench(domainKey) {
  const state = getLiveIngestState(domainKey);
  const prefix = `live-ingest-${domainKey}`;
  const attachmentHtml = state.attachments.length
    ? state.attachments.map((item) => {
        const meta = item.kind === 'image' ? 'Image' : 'Text';
        return `<div class="live-ingest-chip" title="${esc(item.name || meta)}">
          <span>${esc(item.name || meta)}</span>
          <button type="button" data-live-ingest-remove="${esc(item.id)}" data-domain="${domainKey}">&times;</button>
        </div>`;
      }).join('')
    : '<div class="live-ingest-empty">No attachments yet. Drop screenshots, paste clipboard images, or attach text/HTML/email files.</div>';

  const proposal = state.proposal;
  const ops = Array.isArray(proposal?.operations) ? proposal.operations : [];
  const visibleOpIndices = filterLiveIngestOperationIndexesByTrust(ops, state.provenanceTrustFilter);
  const effectiveContext = getLiveIngestEffectiveContext(domainKey);
  const extractionDocsHtml = renderLiveIngestExtractionDocs(state.extractionDocs || []);
  const hasLowConfidenceOcr = liveIngestHasLowConfidenceOcr(state.extractionDocs || []);
  const hasCitationRisk = liveIngestHasCitationRisk(proposal?.operations || [], true);
  const hasWorsenedRetryRisk = liveIngestHasWorsenedRetryRisk(proposal?.operations || [], true);
  const toolbarSummaryHtml = renderLiveIngestToolbarSummary(ops, state);
  const proposalHtml = proposal
    ? `<div class="live-ingest-results">
        <div class="live-ingest-results-head">
          <div>
            <div class="live-ingest-results-title">Proposed Writeback</div>
            <div class="live-ingest-results-sub">${esc(proposal.summary || 'No summary returned')}</div>
          </div>
          <div class="live-ingest-results-meta">${ops.length} op${ops.length === 1 ? '' : 's'}</div>
        </div>
        ${proposal.missing_information?.length ? `<div class="live-ingest-callout warn">${proposal.missing_information.map(esc).join('<br>')}</div>` : ''}
        ${proposal.notes_for_user?.length ? `<div class="live-ingest-callout">${proposal.notes_for_user.map(esc).join('<br>')}</div>` : ''}
        ${extractionDocsHtml}
        ${state.loadingSnapshots ? '<div class="live-ingest-callout">Loading current record snapshots for before/after review...</div>' : ''}
        ${toolbarSummaryHtml}
        ${ops.length ? `<div class="live-ingest-actions" style="margin-bottom:12px">
          <button class="btn-secondary" type="button" data-live-ingest-select-all="${domainKey}">Select All</button>
          <button class="btn-secondary" type="button" data-live-ingest-select-cited="${domainKey}">Select Cited Only</button>
          ${hasWorsenedRetryRisk ? `<button class="btn-secondary" type="button" data-live-ingest-select-worsened="${domainKey}">Select Worsened Only</button>
          <button class="btn-secondary" type="button" data-live-ingest-clear-worsened="${domainKey}">Clear Worsened</button>` : ''}
          <button class="btn-secondary" type="button" data-live-ingest-select-none="${domainKey}">Select None</button>
          <button class="btn-secondary" type="button" data-live-ingest-refresh-snapshots="${domainKey}" ${state.loadingSnapshots ? 'disabled' : ''}>${state.loadingSnapshots ? 'Refreshing...' : 'Refresh Snapshots'}</button>
        </div>` : ''}
        ${ops.length ? renderLiveIngestTrustFilterBar(domainKey, state.provenanceTrustFilter, visibleOpIndices.length, ops.length) : ''}
        ${visibleOpIndices.length ? `<div class="live-ingest-actions" style="margin-bottom:12px">
          <button class="btn-secondary" type="button" data-live-ingest-select-visible="${domainKey}">Select Visible</button>
          <button class="btn-secondary" type="button" data-live-ingest-clear-visible="${domainKey}">Clear Visible</button>
          <button class="btn-secondary" type="button" data-live-ingest-ack-visible="${domainKey}">Acknowledge Visible Risk</button>
        </div>` : ''}
        <div class="live-ingest-op-list">
          ${visibleOpIndices.length ? renderLiveIngestOperationGroups(domainKey, ops, state, visibleOpIndices) : '<div class="live-ingest-empty">No operations match the current trust filter.</div>'}
        </div>
        <div class="live-ingest-actions">
          ${hasLowConfidenceOcr ? `<label class="live-ingest-ack">
            <input type="checkbox" data-live-ingest-ack="${domainKey}" ${state.lowConfidenceOcrAcknowledged ? 'checked' : ''}>
            <span>I reviewed the low-confidence OCR transcript before applying.</span>
          </label>` : ''}
          ${hasCitationRisk ? `<label class="live-ingest-ack">
            <input type="checkbox" data-live-ingest-citation-ack="${domainKey}" ${state.citationRiskAcknowledged ? 'checked' : ''}>
            <span>I reviewed operations that rely on low-confidence OCR without model-cited sources.</span>
          </label>` : ''}
          ${hasWorsenedRetryRisk ? `<label class="live-ingest-ack">
            <input type="checkbox" data-live-ingest-worsened-ack="${domainKey}" ${state.worsenedRetryAcknowledged ? 'checked' : ''}>
            <span>I reviewed operations tied to OCR sources that got worse after retry.</span>
          </label>` : ''}
          <button class="btn-primary" type="button" data-live-ingest-apply="${domainKey}" ${(state.applying || (hasLowConfidenceOcr && !state.lowConfidenceOcrAcknowledged) || (hasCitationRisk && !state.citationRiskAcknowledged) || (hasWorsenedRetryRisk && !state.worsenedRetryAcknowledged)) ? 'disabled' : ''}>${state.applying ? 'Applying...' : 'Apply Selected'}</button>
          <button class="btn-secondary" type="button" data-live-ingest-clear-proposal="${domainKey}">Clear Proposal</button>
          ${state.lastAppliedAt ? `<div class="live-ingest-stamp">Last applied ${esc(state.lastAppliedAt)}</div>` : ''}
        </div>
      </div>`
    : '';

  const isCollapsed = window._liveIntakeCollapsed == null ? true : window._liveIntakeCollapsed;
  const attachCount = state.attachments.length;
  const hasProposal = !!proposal;
  const collapsedSummary = attachCount ? `${attachCount} file${attachCount > 1 ? 's' : ''} loaded` : (hasProposal ? 'Proposal ready' : 'Drag files, paste screenshots, route extracted facts');

  return `<section class="live-ingest-card${isCollapsed ? ' collapsed' : ''}">
    <div class="live-ingest-head" style="${isCollapsed ? 'align-items:center' : ''}">
      <div>
        <div class="live-ingest-kicker"${isCollapsed ? ' style="margin-bottom:0"' : ''}>Live Intake${isCollapsed && attachCount ? ` · ${attachCount} file${attachCount > 1 ? 's' : ''}` : ''}${isCollapsed && hasProposal ? ' · proposal ready' : ''}</div>
        <h3>${isCollapsed ? collapsedSummary : `Drag files, paste screenshots, and route extracted facts into ${domainKey === 'government' ? 'Government' : 'Dialysis'}`}</h3>
        ${isCollapsed ? '' : '<p>Use this for emails, web pages, screenshots, and saved text exports. The model proposes audited updates before anything is written.</p>'}
      </div>
      <div style="display:flex;align-items:${isCollapsed ? 'center' : 'flex-start'};gap:12px;flex-shrink:0">
        ${isCollapsed ? '' : `<div class="live-ingest-context">${renderLiveIngestContextSummary(effectiveContext)}</div>`}
        <button class="live-ingest-toggle" onclick="toggleLiveIntake()" type="button">${isCollapsed ? '▼ Expand' : '▲ Collapse'}</button>
      </div>
    </div>
    <div class="live-ingest-grid">
      <div class="live-ingest-pane">
        <div class="live-ingest-dropzone" id="${prefix}-dropzone" tabindex="0">
          <input id="${prefix}-file" type="file" multiple accept="image/*,.txt,.md,.csv,.json,.html,.htm,.eml,.doc,.docx,.xls,.xlsx,.ppt,.pptx" style="display:none">
          <div class="live-ingest-drop-title">Drop screenshots or source files here</div>
          <div class="live-ingest-drop-sub">Click to browse, paste from clipboard, or capture a screen snapshot.</div>
          <div class="live-ingest-button-row">
            <button class="btn-secondary" type="button" data-live-ingest-pick="${domainKey}">Add Files</button>
            <button class="btn-secondary" type="button" data-live-ingest-paste="${domainKey}">Paste Clipboard</button>
            <button class="btn-secondary" type="button" data-live-ingest-capture="${domainKey}">Capture Screen</button>
            <button class="btn-secondary" type="button" data-live-ingest-clear-files="${domainKey}">Clear</button>
          </div>
        </div>
        <div class="live-ingest-chip-row">${attachmentHtml}</div>
      </div>
      <div class="live-ingest-pane">
        <div class="form-group">
          <label for="${prefix}-lookup">Target record lookup</label>
          <div class="live-ingest-lookup-row">
            <input id="${prefix}-lookup" type="text" placeholder="${domainKey === 'government' ? 'Search address, owner, lease, tenant...' : 'Search facility, operator, clinic ID, address...'}" value="${esc(state.lookupQuery)}">
            <button class="btn-secondary" type="button" data-live-ingest-search="${domainKey}" ${state.lookupLoading ? 'disabled' : ''}>${state.lookupLoading ? 'Searching...' : 'Find'}</button>
            ${state.boundTarget ? `<button class="btn-secondary" type="button" data-live-ingest-clear-target="${domainKey}">Clear</button>` : ''}
          </div>
          ${renderLiveIngestLookupResults(domainKey, state)}
        </div>
        <div class="form-group">
          <label for="${prefix}-source">Source label</label>
          <input id="${prefix}-source" type="text" placeholder="Example: broker email, LoopNet page, county recorder site" value="${esc(state.sourceLabel)}">
        </div>
        <div class="form-group">
          <label>Canonical entity context</label>
          <div class="live-ingest-lookup-row">
            <input id="${prefix}-entity" type="text" placeholder="Search canonical entities..." value="${esc(state.selectedEntity?.name || '')}" ${state.selectedEntity ? 'disabled' : ''}>
            <button class="btn-secondary" type="button" data-live-ingest-search-entity="${domainKey}" ${state.entityLoading ? 'disabled' : ''}>${state.entityLoading ? 'Searching...' : 'Find'}</button>
            ${state.selectedEntity ? `<button class="btn-secondary" type="button" data-live-ingest-clear-entity="${domainKey}">Clear</button>` : ''}
          </div>
          ${renderLiveIngestEntityResults(domainKey, state)}
        </div>
        <div class="form-group">
          <label for="${prefix}-notes">Instructions / context</label>
          <textarea id="${prefix}-notes" placeholder="Describe what should be extracted or where the data should land.">${esc(state.notes)}</textarea>
        </div>
        ${state.error ? `<div class="live-ingest-callout warn">${esc(state.error)}</div>` : ''}
        <div class="live-ingest-actions">
          <button class="btn-primary" type="button" data-live-ingest-extract="${domainKey}" ${state.extracting ? 'disabled' : ''}>${state.extracting ? 'Extracting...' : 'Extract + Map Changes'}</button>
          <div class="live-ingest-stamp">Allowed tables: ${LIVE_INGEST_ALLOWED_TABLES[domainKey].map(esc).join(', ')}</div>
        </div>
      </div>
    </div>
    ${proposalHtml}
  </section>`;
}

function renderLiveIngestExtractionDocs(docs) {
  const items = (Array.isArray(docs) ? docs : []).filter((doc) => doc && doc.normalized_text);
  if (!items.length) return '';
  const lowConfidenceItems = items.filter((doc) => String(doc.metadata?.ocr_confidence || '').toLowerCase() === 'low');
  return `<div class="live-ingest-source-block">
    <div class="live-ingest-editor-head" style="margin-top:0">
      <span>Extraction Inputs</span>
      <span>${items.length} source${items.length === 1 ? '' : 's'}</span>
    </div>
    ${lowConfidenceItems.length ? `<div class="live-ingest-callout warn">
      Low-confidence OCR detected in ${lowConfidenceItems.length} source${lowConfidenceItems.length === 1 ? '' : 's'}.
      Review these transcript${lowConfidenceItems.length === 1 ? '' : 's'} before applying writebacks:<br>${lowConfidenceItems.map((doc) => esc(doc.metadata?.source_image_name || doc.name || 'OCR source')).join('<br>')}
    </div>` : ''}
    <div class="live-ingest-source-list">
      ${items.map((doc, idx) => {
        const sourceKind = String(doc.source_kind || 'text');
        const label = sourceKind === 'ocr' ? 'OCR transcript' : sourceKind;
        const meta = [];
        if (doc.metadata?.generated_from_images) meta.push(`${doc.metadata.generated_from_images} image${doc.metadata.generated_from_images === 1 ? '' : 's'}`);
        if (doc.metadata?.attachment_preview_count) meta.push(`${doc.metadata.attachment_preview_count} attachment preview${doc.metadata.attachment_preview_count === 1 ? '' : 's'}`);
        if (doc.metadata?.source_image_name) meta.push(`source: ${doc.metadata.source_image_name}`);
        if (doc.metadata?.ocr_confidence) meta.push(`confidence: ${doc.metadata.ocr_confidence}`);
        const lowConfidence = String(doc.metadata?.ocr_confidence || '').toLowerCase() === 'low';
        const retryComparison = renderLiveIngestOcrRetryComparison(doc);
        return `<details class="live-ingest-source-item ${lowConfidence ? 'low-confidence' : ''}" ${(sourceKind === 'ocr' || lowConfidence) ? 'open' : ''}>
          <summary>
            <strong>${esc(doc.name || 'Source document')}</strong>
            <span>${esc([label, ...meta].filter(Boolean).join(' | '))}</span>
          </summary>
          ${lowConfidence ? `<div class="live-ingest-source-actions"><button class="live-ingest-inline-btn" type="button" data-live-ingest-retry-ocr="${idx}">Retry OCR</button></div>` : ''}
          ${retryComparison}
          <pre>${esc(String(doc.normalized_text || '').slice(0, 4000))}</pre>
        </details>`;
      }).join('')}
    </div>
  </div>`;
}

function renderLiveIngestOcrRetryComparison(doc) {
  const history = Array.isArray(doc?.metadata?.ocr_retry_history)
    ? doc.metadata.ocr_retry_history.filter((entry) => entry && typeof entry === 'object')
    : [];
  if (!history.length) {
    const previousText = String(doc?.metadata?.ocr_retry_previous_text || '').trim();
    const previousConfidence = String(doc?.metadata?.ocr_retry_previous_confidence || '').trim();
    const currentConfidence = String(doc?.metadata?.ocr_confidence || '').trim();
    if (!previousText && !previousConfidence) return '';
    history.push({
      previous_text: previousText,
      previous_confidence: previousConfidence,
      next_text: String(doc.normalized_text || '').trim(),
      next_confidence: currentConfidence,
      retried_at: null
    });
  }
  const entries = history.slice().reverse();
  return `<div class="live-ingest-retry-compare">
    <div class="live-ingest-editor-head" style="margin-top:0">
      <span>Retry History</span>
      <span>${entries.length} attempt${entries.length === 1 ? '' : 's'}</span>
    </div>
    <div class="live-ingest-retry-history">
      ${entries.map((entry, idx) => {
        const labelBits = [
          entry.retried_at ? formatLiveIngestRetryTimestamp(entry.retried_at) : null,
          entry.previous_confidence ? `was ${entry.previous_confidence}` : null,
          entry.next_confidence ? `now ${entry.next_confidence}` : null
        ].filter(Boolean);
        return `<div class="live-ingest-retry-entry">
          <div class="live-ingest-editor-head" style="margin-top:0">
            <span>Retry ${entries.length - idx}</span>
            <span>${esc(labelBits.join(' | ') || 'updated transcript')}</span>
          </div>
          <div class="live-ingest-retry-grid">
            <div>
              <div class="live-ingest-retry-label">Before Retry</div>
              <pre>${esc(String(entry.previous_text || '').slice(0, 2000) || 'No prior transcript saved.')}</pre>
            </div>
            <div>
              <div class="live-ingest-retry-label">After Retry</div>
              <pre>${esc(String(entry.next_text || '').slice(0, 2000) || 'No refreshed transcript saved.')}</pre>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function formatLiveIngestRetryTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function liveIngestHasLowConfidenceOcr(docs) {
  return (Array.isArray(docs) ? docs : []).some((doc) => String(doc?.metadata?.ocr_confidence || '').toLowerCase() === 'low');
}

function liveIngestHasCitationRisk(operations, selectedOnly = false) {
  return (Array.isArray(operations) ? operations : []).some((op) => {
    if (!op?._citationRisk) return false;
    if (!selectedOnly) return true;
    return op._selected !== false;
  });
}

function liveIngestHasWorsenedRetryRisk(operations, selectedOnly = false) {
  return (Array.isArray(operations) ? operations : []).some((op) => {
    if (!op?._worsenedRetry) return false;
    if (!selectedOnly) return true;
    return op._selected !== false;
  });
}

function renderLiveIngestOperation(domainKey, op, idx) {
  const opType = esc(op.kind || 'update');
  const table = esc(op.table || op.action || 'operation');
  const target = op.kind === 'bridge'
    ? `Bridge: ${table}`
    : `${esc(op.target_source || domainKey)}.${table}${op.record_identifier != null ? `#${esc(String(op.record_identifier))}` : ''}`;
  const bodyObj = op.kind === 'bridge' ? (op.payload || {}) : (op.fields || {});
  const fields = esc(JSON.stringify(bodyObj, null, 2));
  const fieldEntries = Object.entries(bodyObj || {});
  const fieldProvenance = renderLiveIngestFieldProvenance(domainKey, op);
  const diffHtml = op.kind === 'update'
    ? renderLiveIngestDiffTable(op, fieldEntries)
    : (fieldEntries.length ? `<div class="live-ingest-field-grid">
        ${fieldEntries.map(([key, value]) => `<div class="live-ingest-field-row"><span>${esc(key)}</span><strong>${esc(renderLiveIngestFieldValue(value))}</strong></div>`).join('')}
      </div>` : '<div class="live-ingest-empty" style="margin-top:8px">No fields on this operation.</div>');
  return `<label class="live-ingest-op">
    <input type="checkbox" data-live-ingest-op="${domainKey}:${idx}" ${op._selected === false ? '' : 'checked'}>
    <div class="live-ingest-op-body">
      <div class="live-ingest-op-head">
        <span class="live-ingest-op-kind">${opType}</span>
        <span class="live-ingest-op-target">${target}</span>
        ${op._lowConfidenceOcr ? `<span class="live-ingest-op-flag warn">Low-confidence OCR</span>` : ''}
        ${op._citationRisk ? `<span class="live-ingest-op-flag warn">No cited source</span>` : ''}
        ${op._worsenedRetryRisk ? `<span class="live-ingest-op-flag warn">Retry Worsened</span>` : ''}
        ${op._sourceLineage?.label ? `<span class="live-ingest-op-flag">${esc(op._sourceLineage.label)}</span>` : ''}
        ${op.kind === 'update' ? `<button class="live-ingest-inline-btn" type="button" data-live-ingest-refresh-op="${domainKey}:${idx}">Refresh</button>` : ''}
      </div>
      ${op.reason ? `<div class="live-ingest-op-reason">${esc(op.reason)}</div>` : ''}
      ${op._lowConfidenceOcr ? `<div class="live-ingest-callout warn" style="margin-top:8px">This operation was proposed while low-confidence OCR text was part of the extraction input. Review the related transcript before applying.</div>` : ''}
      ${op._citationRisk ? `<div class="live-ingest-callout warn" style="margin-top:8px">This operation does not include a model-cited source reference even though low-confidence OCR was present in the extraction run.</div>` : ''}
      ${op._worsenedRetryRisk ? `<div class="live-ingest-callout warn" style="margin-top:8px">This operation points to a source whose OCR confidence decreased after retry. Reconfirm the source transcript before applying.</div>` : ''}
      ${op._sourceLineage?.detail ? `<div class="live-ingest-op-reason">${esc(op._sourceLineage.detail)}</div>` : ''}
      ${fieldProvenance}
      ${op._sourceLineage?.evidence ? `<div class="live-ingest-source-evidence">
        <div class="live-ingest-retry-label">Source Evidence</div>
        <blockquote>${esc(op._sourceLineage.evidence)}</blockquote>
      </div>` : ''}
      ${diffHtml}
      <div class="live-ingest-editor-head">
        <span>Edit JSON</span>
        <span>${fieldEntries.length} field${fieldEntries.length === 1 ? '' : 's'}</span>
      </div>
      <textarea class="live-ingest-json-editor" data-live-ingest-json="${domainKey}:${idx}" spellcheck="false">${fields}</textarea>
      ${op._parseError ? `<div class="live-ingest-callout warn" style="margin-top:8px">${esc(op._parseError)}</div>` : ''}
    </div>
  </label>`;
}

function renderLiveIngestFieldProvenance(domainKey, op) {
  const rows = buildLiveIngestFieldProvenanceRows(domainKey, op);
  if (!rows.length) return '';
  const trust = getLiveIngestTrustBadge(scoreLiveIngestOperationConfidence(op));
  return `<div class="live-ingest-field-provenance">
    <div class="live-ingest-editor-head">
      <span>Field Provenance</span>
      <span class="live-ingest-op-flag ${trust.tone}">${esc(trust.label)}</span>
    </div>
    <div class="live-ingest-field-provenance-list">
      ${rows.map((row) => `<div class="live-ingest-field-provenance-row">
        <strong>${esc(row.field)}</strong>
        <span>${esc(row.source)}</span>
        ${row.quote ? `<blockquote>${esc(row.quote)}</blockquote>` : ''}
      </div>`).join('')}
    </div>
  </div>`;
}

function buildLiveIngestFieldProvenanceRows(domainKey, op) {
  if (!op || typeof op !== 'object') return [];
  const fields = Object.keys(op.kind === 'bridge' ? (op.payload || {}) : (op.fields || {})).filter(Boolean).slice(0, 8);
  if (!fields.length) return [];
  const docs = getLiveIngestState(domainKey)?.extractionDocs || [];
  const refs = Array.isArray(op.source_refs) ? op.source_refs : [];
  const refLabel = refs.slice(0, 2).map((ref) => {
    const idx = Number(ref?.source_index);
    const doc = Number.isInteger(idx) && idx >= 0 && idx < docs.length ? docs[idx] : null;
    const source = String(doc?.metadata?.source_image_name || doc?.name || `Source ${idx + 1}`).trim();
    const quote = String(ref?.quote || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return { source, quote };
  }).filter((item) => item.source);
  const lineageSource = String(op._sourceLineage?.source_name || op._sourceLineage?.label || '').trim();
  const lineageQuote = String(op._sourceLineage?.evidence || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return fields.map((field, idx) => {
    const ref = refLabel[idx % refLabel.length] || refLabel[0] || null;
    if (ref) {
      return { field, source: ref.source, quote: ref.quote };
    }
    return {
      field,
      source: lineageSource || 'Unattributed source',
      quote: lineageQuote
    };
  });
}

function renderLiveIngestOperationGroups(domainKey, operations, state, visibleIndices = null) {
  const groups = buildLiveIngestOperationGroups(operations, visibleIndices);
  return groups.map((group, groupIdx) => {
    const statuses = [];
    if (group.lowConfidenceCount) statuses.push(`<span class="live-ingest-op-flag warn">Low-confidence OCR ${group.lowConfidenceCount}</span>`);
    if (group.citationCount) statuses.push(`<span class="live-ingest-op-flag warn">No cited source ${group.citationCount}</span>`);
    if (group.worsenedCount) statuses.push(`<span class="live-ingest-op-flag warn">Retry worsened ${group.worsenedCount}</span>`);
    if (!group.lowConfidenceCount && !group.citationCount && !group.worsenedCount) statuses.push('<span class="live-ingest-op-flag">No source risk</span>');
    statuses.push(renderLiveIngestGroupAckIndicator(group, state));
    const countBits = [
      `${group.indices.length} op${group.indices.length === 1 ? '' : 's'}`,
      group.selectedCount ? `${group.selectedCount} selected` : null,
      group.worsenedCount ? `${group.worsenedCount} worsened` : null
    ].filter(Boolean).join(' | ');
    return `<section class="live-ingest-op-group">
      <div class="live-ingest-op-group-head">
        <div>
          <strong>${esc(group.label)}</strong>
          <div>${esc(countBits)}</div>
        </div>
        <div class="live-ingest-op-group-controls">
          <button class="live-ingest-inline-btn" type="button" data-live-ingest-group-select="${domainKey}:${groupIdx}">Select Group</button>
          ${group.worsenedCount ? `<button class="live-ingest-inline-btn" type="button" data-live-ingest-group-select-risk="${domainKey}:${groupIdx}">Include Worsened</button>` : ''}
          <button class="live-ingest-inline-btn" type="button" data-live-ingest-group-clear="${domainKey}:${groupIdx}">Clear Group</button>
          ${group.canAcknowledgeShortcut ? `<button class="live-ingest-inline-btn" type="button" data-live-ingest-group-ack="${domainKey}:${groupIdx}">Acknowledge Group Risk</button>` : ''}
        </div>
      </div>
      <div class="live-ingest-op-group-status">${statuses.join('')}</div>
      ${group.detail ? `<div class="live-ingest-op-reason">${esc(group.detail)}</div>` : ''}
      ${group.worsenedCount ? `<div class="live-ingest-callout warn">Group selection keeps worsened-retry operations deselected by default. Use "Include Worsened" to opt them back in for this source.</div>` : ''}
      ${group.indices.map((opIdx) => renderLiveIngestOperation(domainKey, operations[opIdx], opIdx)).join('')}
    </section>`;
  }).join('');
}

function renderLiveIngestGroupAckIndicator(group, state) {
  const labels = [];
  const pending = [];
  if (group.pendingLowConfidenceAck && !state?.lowConfidenceOcrAcknowledged) pending.push('OCR ack pending');
  else if (group.selectedLowConfidenceCount) labels.push('OCR acknowledged');
  if (group.pendingCitationAck && !state?.citationRiskAcknowledged) pending.push('Citation ack pending');
  else if (group.selectedCitationCount) labels.push('Citation acknowledged');
  if (group.pendingWorsenedAck && !state?.worsenedRetryAcknowledged) pending.push('Retry ack pending');
  else if (group.selectedWorsenedCount) labels.push('Retry acknowledged');
  if (pending.length) {
    return `<span class="live-ingest-op-flag warn">${esc(pending.join(' | '))}</span>`;
  }
  if (labels.length) {
    return `<span class="live-ingest-op-flag ok">${esc(labels.join(' | '))}</span>`;
  }
  return '<span class="live-ingest-op-flag">No active group gate</span>';
}

function renderLiveIngestToolbarSummary(operations, state) {
  const selected = (Array.isArray(operations) ? operations : []).filter((op) => op?._selected !== false);
  if (!selected.length) return '';
  const chips = [];
  const lowConfidenceCount = selected.filter((op) => op?._lowConfidenceOcr).length;
  const citationCount = selected.filter((op) => op?._citationRisk).length;
  const worsenedCount = selected.filter((op) => op?._worsenedRetryRisk).length;

  chips.push(`<span class="live-ingest-op-flag">${selected.length} selected</span>`);
  if (lowConfidenceCount) {
    chips.push(`<span class="live-ingest-op-flag ${state?.lowConfidenceOcrAcknowledged ? 'ok' : 'warn'}">${esc(`${lowConfidenceCount} OCR ${state?.lowConfidenceOcrAcknowledged ? 'acknowledged' : 'pending'}`)}</span>`);
  }
  if (citationCount) {
    chips.push(`<span class="live-ingest-op-flag ${state?.citationRiskAcknowledged ? 'ok' : 'warn'}">${esc(`${citationCount} citation ${state?.citationRiskAcknowledged ? 'acknowledged' : 'pending'}`)}</span>`);
  }
  if (worsenedCount) {
    chips.push(`<span class="live-ingest-op-flag ${state?.worsenedRetryAcknowledged ? 'ok' : 'warn'}">${esc(`${worsenedCount} retry ${state?.worsenedRetryAcknowledged ? 'acknowledged' : 'pending'}`)}</span>`);
  }
  if (!lowConfidenceCount && !citationCount && !worsenedCount) {
    chips.push('<span class="live-ingest-op-flag ok">No active apply gate</span>');
  }
  return `<div class="live-ingest-toolbar-summary">${chips.join('')}</div>`;
}

function buildLiveIngestOperationGroups(operations, visibleIndices = null) {
  const groups = [];
  const byKey = new Map();
  const rows = getLiveIngestOperationRows(operations, visibleIndices);
  rows.forEach(({ op, idx }) => {
    const sourceName = String(op?._sourceLineage?.source_name || '').trim();
    const label = sourceName || 'Unattributed source';
    const detail = op?._sourceLineage?.detail || (sourceName ? `Source: ${sourceName}` : 'Operations without clear source lineage');
    const key = `${label}__${detail}`;
    if (!byKey.has(key)) {
      const group = {
        key,
        label,
        detail,
        indices: [],
        selectedCount: 0,
        worsenedCount: 0,
        lowConfidenceCount: 0,
        citationCount: 0,
        selectedLowConfidenceCount: 0,
        selectedCitationCount: 0,
        selectedWorsenedCount: 0,
        pendingLowConfidenceAck: false,
        pendingCitationAck: false,
        pendingWorsenedAck: false,
        canAcknowledgeShortcut: false
      };
      byKey.set(key, group);
      groups.push(group);
    }
    const group = byKey.get(key);
    group.indices.push(idx);
    if (op?._selected !== false) {
      group.selectedCount += 1;
      if (op?._lowConfidenceOcr) group.selectedLowConfidenceCount += 1;
      if (op?._citationRisk) group.selectedCitationCount += 1;
      if (op?._worsenedRetryRisk) group.selectedWorsenedCount += 1;
    }
    if (op?._lowConfidenceOcr) group.lowConfidenceCount += 1;
    if (op?._citationRisk) group.citationCount += 1;
    if (op?._worsenedRetryRisk) group.worsenedCount += 1;
  });
  const selectedOps = rows.filter(({ op }) => op?._selected !== false);
  groups.forEach((group) => {
    const groupIndexSet = new Set(group.indices);
    const selectedInGroup = selectedOps.filter(({ idx }) => groupIndexSet.has(idx));
    if (!selectedInGroup.length) {
      group.canAcknowledgeShortcut = false;
      return;
    }
    const outsideGroup = selectedOps.filter(({ idx }) => !groupIndexSet.has(idx));
    const lowConfidenceOnlyInGroup = selectedInGroup.some(({ op }) => op?._lowConfidenceOcr) && !outsideGroup.some(({ op }) => op?._lowConfidenceOcr);
    const citationOnlyInGroup = selectedInGroup.some(({ op }) => op?._citationRisk) && !outsideGroup.some(({ op }) => op?._citationRisk);
    const worsenedOnlyInGroup = selectedInGroup.some(({ op }) => op?._worsenedRetryRisk) && !outsideGroup.some(({ op }) => op?._worsenedRetryRisk);
    group.pendingLowConfidenceAck = lowConfidenceOnlyInGroup;
    group.pendingCitationAck = citationOnlyInGroup;
    group.pendingWorsenedAck = worsenedOnlyInGroup;
    group.canAcknowledgeShortcut = lowConfidenceOnlyInGroup || citationOnlyInGroup || worsenedOnlyInGroup;
  });
  return groups;
}

function getLiveIngestOperationRows(operations, visibleIndices = null) {
  const list = Array.isArray(operations) ? operations : [];
  if (!Array.isArray(visibleIndices)) {
    return list.map((op, idx) => ({ op, idx }));
  }
  return visibleIndices
    .map((idx) => {
      const op = list[idx];
      return Number.isInteger(idx) && op ? { op, idx } : null;
    })
    .filter(Boolean);
}

function renderLiveIngestFieldValue(value) {
  if (value == null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function renderLiveIngestDiffTable(op, fieldEntries) {
  if (!fieldEntries.length) {
    return '<div class="live-ingest-empty" style="margin-top:8px">No fields on this operation.</div>';
  }
  if (op._snapshotError) {
    return `<div class="live-ingest-callout warn" style="margin-top:8px">${esc(op._snapshotError)}</div>`;
  }
  const currentFields = op._currentFields && typeof op._currentFields === 'object' ? op._currentFields : null;
  const rows = fieldEntries.map(([key, value]) => {
    const currentValue = currentFields ? currentFields[key] : undefined;
    const changed = JSON.stringify(currentValue) !== JSON.stringify(value);
    return `<div class="live-ingest-diff-row ${changed ? 'changed' : ''}">
      <span class="live-ingest-diff-key">${esc(key)}</span>
      <span class="live-ingest-diff-old">${esc(renderLiveIngestFieldValue(currentValue))}</span>
      <span class="live-ingest-diff-arrow">→</span>
      <span class="live-ingest-diff-new">${esc(renderLiveIngestFieldValue(value))}</span>
    </div>`;
  }).join('');
  return `<div class="live-ingest-editor-head">
      <span>Before / After</span>
      <span>${currentFields ? 'Current snapshot loaded' : 'Snapshot unavailable'}</span>
    </div>
    <div class="live-ingest-diff-table">${rows}</div>`;
}

function renderLiveIngestContextSummary(context) {
  if (!context || !context.current_record) {
    return '<div><strong>No record bound</strong><span>Will only apply operations that include valid IDs.</span></div>';
  }
  const rec = context.current_record;
  const label = rec.address || rec.facility_name || rec.property_name || rec.lease_number || rec.clinic_id || rec.lead_id || rec.property_id || rec.ownership_id || 'Current record';
  const idBits = [];
  ['lead_id', 'property_id', 'ownership_id', 'clinic_id', 'medicare_id'].forEach((key) => {
    if (rec[key] != null && rec[key] !== '') idBits.push(`${key}: ${rec[key]}`);
  });
  const prefix = context.manual_target ? 'Bound target' : 'Current context';
  const sourceTable = context.source_table ? ` | ${context.source_table}` : '';
  return `<div><strong>${esc(prefix + ': ' + label)}</strong><span>${esc(idBits.join(' | ') || context.mode || 'Research context')}${esc(sourceTable)}</span></div>`;
}

function renderLiveIngestLookupResults(domainKey, state) {
  if (state.boundTarget) {
    return `<div class="live-ingest-bound-target">
      <strong>Using target</strong>
      <span>${esc(state.boundTarget.label || 'Bound record')}</span>
      <span>${esc(state.boundTarget.subtitle || state.boundTarget.source_table || '')}</span>
    </div>`;
  }
  if (state.lookupLoading) {
    return '<div class="live-ingest-empty" style="margin-top:8px">Searching records...</div>';
  }
  if (!state.lookupResults.length) {
    return '';
  }
  return `<div class="live-ingest-lookup-results">
    ${state.lookupResults.map((item, idx) => `<button class="live-ingest-lookup-result" type="button" data-live-ingest-target="${domainKey}:${idx}">
      <strong>${esc(item.label || 'Record')}</strong>
      <span>${esc(item.subtitle || item.source_table || '')}</span>
    </button>`).join('')}
  </div>`;
}

function renderLiveIngestEntityResults(domainKey, state) {
  if (state.selectedEntity) {
    return `<div class="live-ingest-bound-target entity">
      <strong>Using canonical entity</strong>
      <span>${esc(state.selectedEntity.name || 'Entity')}</span>
      <span>${esc([
        state.selectedEntity.entity_type,
        state.selectedEntity.domain,
        state.selectedEntity.city,
        state.selectedEntity.state
      ].filter(Boolean).join(' | '))}</span>
      <span>${esc(state.selectedEntity._autoSelected ? `Auto-selected (${state.selectedEntity._confidenceLabel || 'high confidence'})` : 'Manually selected')}</span>
    </div>`;
  }
  if (state.entityLoading) {
    return '<div class="live-ingest-empty" style="margin-top:8px">Searching canonical entities...</div>';
  }
  if (!state.entityResults.length) {
    return '<div class="live-ingest-empty" style="margin-top:8px">Optional: bind a canonical entity to improve `update_entity` and follow-up bridge suggestions.</div>';
  }
  return `<div class="live-ingest-lookup-results">
    ${state.entityResults.map((item, idx) => `<button class="live-ingest-lookup-result" type="button" data-live-ingest-entity="${domainKey}:${idx}">
      <strong>${esc(item.name || 'Entity')}</strong>
      <span>${esc([item.entity_type, item.domain, item.city, item.state].filter(Boolean).join(' | '))}</span>
    </button>`).join('')}
  </div>`;
}

function bindLiveIngestWorkbench(domainKey) {
  const state = getLiveIngestState(domainKey);
  const visibleOpIndices = filterLiveIngestOperationIndexesByTrust(state.proposal?.operations || [], state.provenanceTrustFilter);
  const prefix = `live-ingest-${domainKey}`;
  const fileInput = document.getElementById(`${prefix}-file`);
  const dropzone = document.getElementById(`${prefix}-dropzone`);
  const lookupEl = document.getElementById(`${prefix}-lookup`);
  const entityEl = document.getElementById(`${prefix}-entity`);
  const sourceEl = document.getElementById(`${prefix}-source`);
  const notesEl = document.getElementById(`${prefix}-notes`);

  if (lookupEl) {
    lookupEl.oninput = () => { state.lookupQuery = lookupEl.value; };
    lookupEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchLiveIngestRecords(domainKey);
      }
    };
  }
  if (sourceEl) {
    sourceEl.oninput = () => { state.sourceLabel = sourceEl.value; };
  }
  if (entityEl && !state.selectedEntity) {
    entityEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchLiveIngestEntities(domainKey, entityEl.value);
      }
    };
  }
  if (notesEl) {
    notesEl.oninput = () => { state.notes = notesEl.value; };
  }

  if (fileInput) {
    fileInput.onchange = async () => {
      await ingestLiveIngestFiles(domainKey, fileInput.files);
      fileInput.value = '';
    };
  }

  if (dropzone) {
    dropzone.onclick = (e) => {
      if (e.target.closest('button')) return;
      fileInput?.click();
    };
    dropzone.ondragover = (e) => {
      e.preventDefault();
      dropzone.classList.add('dragging');
    };
    dropzone.ondragleave = () => dropzone.classList.remove('dragging');
    dropzone.ondrop = async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragging');
      await ingestLiveIngestFiles(domainKey, e.dataTransfer?.files || []);
    };
    dropzone.onpaste = async (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      if (!items.length) return;
      e.preventDefault();
      await ingestLiveIngestClipboardItems(domainKey, items);
    };
  }

  document.querySelectorAll(`[data-live-ingest-remove][data-domain="${domainKey}"]`).forEach((btn) => {
    btn.onclick = () => {
      state.attachments = state.attachments.filter((item) => item.id !== btn.dataset.liveIngestRemove);
      rerenderLiveIngestDomain(domainKey);
    };
  });

  document.querySelector(`[data-live-ingest-pick="${domainKey}"]`)?.addEventListener('click', () => fileInput?.click());
  document.querySelector(`[data-live-ingest-paste="${domainKey}"]`)?.addEventListener('click', () => pasteLiveIngestClipboard(domainKey));
  document.querySelector(`[data-live-ingest-capture="${domainKey}"]`)?.addEventListener('click', () => captureLiveIngestScreen(domainKey));
  document.querySelector(`[data-live-ingest-clear-files="${domainKey}"]`)?.addEventListener('click', () => {
    state.attachments = [];
    state.preparedTextDocs = [];
    state.preparedImageAttachments = [];
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-search="${domainKey}"]`)?.addEventListener('click', () => searchLiveIngestRecords(domainKey));
  document.querySelector(`[data-live-ingest-clear-target="${domainKey}"]`)?.addEventListener('click', () => {
    state.boundTarget = null;
    state.lookupResults = [];
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-search-entity="${domainKey}"]`)?.addEventListener('click', () => {
    const term = state.selectedEntity ? '' : (entityEl?.value || deriveLiveIngestEntityQuery(domainKey));
    searchLiveIngestEntities(domainKey, term);
  });
  document.querySelector(`[data-live-ingest-clear-entity="${domainKey}"]`)?.addEventListener('click', () => {
    state.selectedEntity = null;
    state.entityResults = [];
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-select-all="${domainKey}"]`)?.addEventListener('click', () => {
    (state.proposal?.operations || []).forEach((op) => { op._selected = true; });
    state.worsenedRetryAcknowledged = false;
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-select-cited="${domainKey}"]`)?.addEventListener('click', () => {
    (state.proposal?.operations || []).forEach((op) => { op._selected = !op._citationRisk; });
    state.citationRiskAcknowledged = false;
    state.worsenedRetryAcknowledged = false;
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-select-worsened="${domainKey}"]`)?.addEventListener('click', () => {
    (state.proposal?.operations || []).forEach((op) => { op._selected = !!op._worsenedRetryRisk; });
    state.worsenedRetryAcknowledged = false;
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-clear-worsened="${domainKey}"]`)?.addEventListener('click', () => {
    (state.proposal?.operations || []).forEach((op) => {
      if (op._worsenedRetryRisk) op._selected = false;
    });
    state.worsenedRetryAcknowledged = false;
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-select-none="${domainKey}"]`)?.addEventListener('click', () => {
    (state.proposal?.operations || []).forEach((op) => { op._selected = false; });
    state.worsenedRetryAcknowledged = false;
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelectorAll(`[data-live-ingest-trust-filter^="${domainKey}:"]`).forEach((button) => {
    button.onclick = () => {
      const [, filterMode] = button.dataset.liveIngestTrustFilter.split(':');
      state.provenanceTrustFilter = String(filterMode || 'all');
      rerenderLiveIngestDomain(domainKey);
    };
  });
  document.querySelector(`[data-live-ingest-select-visible="${domainKey}"]`)?.addEventListener('click', () => {
    visibleOpIndices.forEach((idx) => {
      const op = state.proposal?.operations?.[idx];
      if (op) op._selected = true;
    });
    state.lowConfidenceOcrAcknowledged = false;
    state.citationRiskAcknowledged = false;
    state.worsenedRetryAcknowledged = false;
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-clear-visible="${domainKey}"]`)?.addEventListener('click', () => {
    visibleOpIndices.forEach((idx) => {
      const op = state.proposal?.operations?.[idx];
      if (op) op._selected = false;
    });
    state.lowConfidenceOcrAcknowledged = false;
    state.citationRiskAcknowledged = false;
    state.worsenedRetryAcknowledged = false;
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-ack-visible="${domainKey}"]`)?.addEventListener('click', () => {
    acknowledgeLiveIngestVisibleRisk(state, visibleOpIndices);
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelectorAll(`[data-live-ingest-group-select^="${domainKey}:"]`).forEach((button) => {
    button.onclick = () => {
      const [, idxText] = button.dataset.liveIngestGroupSelect.split(':');
      const groupIdx = parseInt(idxText, 10);
      const groups = buildLiveIngestOperationGroups(state.proposal?.operations || [], visibleOpIndices);
      const group = groups[groupIdx];
      if (!group) return;
      group.indices.forEach((opIdx) => {
        const op = state.proposal?.operations?.[opIdx];
        if (op) op._selected = !op._worsenedRetryRisk;
      });
      state.worsenedRetryAcknowledged = false;
      rerenderLiveIngestDomain(domainKey);
    };
  });
  document.querySelectorAll(`[data-live-ingest-group-select-risk^="${domainKey}:"]`).forEach((button) => {
    button.onclick = () => {
      const [, idxText] = button.dataset.liveIngestGroupSelectRisk.split(':');
      const groupIdx = parseInt(idxText, 10);
      const groups = buildLiveIngestOperationGroups(state.proposal?.operations || [], visibleOpIndices);
      const group = groups[groupIdx];
      if (!group) return;
      group.indices.forEach((opIdx) => {
        const op = state.proposal?.operations?.[opIdx];
        if (op) op._selected = true;
      });
      state.worsenedRetryAcknowledged = false;
      rerenderLiveIngestDomain(domainKey);
    };
  });
  document.querySelectorAll(`[data-live-ingest-group-clear^="${domainKey}:"]`).forEach((button) => {
    button.onclick = () => {
      const [, idxText] = button.dataset.liveIngestGroupClear.split(':');
      const groupIdx = parseInt(idxText, 10);
      const groups = buildLiveIngestOperationGroups(state.proposal?.operations || [], visibleOpIndices);
      const group = groups[groupIdx];
      if (!group) return;
      group.indices.forEach((opIdx) => {
        const op = state.proposal?.operations?.[opIdx];
        if (op) op._selected = false;
      });
      state.worsenedRetryAcknowledged = false;
      rerenderLiveIngestDomain(domainKey);
    };
  });
  document.querySelectorAll(`[data-live-ingest-group-ack^="${domainKey}:"]`).forEach((button) => {
    button.onclick = () => {
      const [, idxText] = button.dataset.liveIngestGroupAck.split(':');
      const groupIdx = parseInt(idxText, 10);
      const groups = buildLiveIngestOperationGroups(state.proposal?.operations || [], visibleOpIndices);
      const group = groups[groupIdx];
      if (!group) return;
      const groupIndexSet = new Set(group.indices);
      const selectedOps = (state.proposal?.operations || []).map((op, idx) => ({ op, idx })).filter(({ op }) => op?._selected !== false);
      const selectedInGroup = selectedOps.filter(({ idx }) => groupIndexSet.has(idx));
      const outsideGroup = selectedOps.filter(({ idx }) => !groupIndexSet.has(idx));
      if (selectedInGroup.some(({ op }) => op?._lowConfidenceOcr) && !outsideGroup.some(({ op }) => op?._lowConfidenceOcr)) {
        state.lowConfidenceOcrAcknowledged = true;
      }
      if (selectedInGroup.some(({ op }) => op?._citationRisk) && !outsideGroup.some(({ op }) => op?._citationRisk)) {
        state.citationRiskAcknowledged = true;
      }
      if (selectedInGroup.some(({ op }) => op?._worsenedRetryRisk) && !outsideGroup.some(({ op }) => op?._worsenedRetryRisk)) {
        state.worsenedRetryAcknowledged = true;
      }
      rerenderLiveIngestDomain(domainKey);
    };
  });
  document.querySelector(`[data-live-ingest-refresh-snapshots="${domainKey}"]`)?.addEventListener('click', async () => {
    if (!state.proposal?.operations?.length) return;
    state.loadingSnapshots = true;
    rerenderLiveIngestDomain(domainKey);
    try {
      await hydrateLiveIngestSnapshots(domainKey, state.proposal.operations || []);
    } finally {
      state.loadingSnapshots = false;
      rerenderLiveIngestDomain(domainKey);
    }
  });
  document.querySelector(`[data-live-ingest-extract="${domainKey}"]`)?.addEventListener('click', () => runLiveIngestExtraction(domainKey));
  document.querySelector(`[data-live-ingest-clear-proposal="${domainKey}"]`)?.addEventListener('click', () => {
    state.proposal = null;
    state.extractionDocs = [];
    state.preparedTextDocs = [];
    state.preparedImageAttachments = [];
    state.lowConfidenceOcrAcknowledged = false;
    state.citationRiskAcknowledged = false;
    state.worsenedRetryAcknowledged = false;
    state.error = '';
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-ack="${domainKey}"]`)?.addEventListener('change', (e) => {
    state.lowConfidenceOcrAcknowledged = !!e.target.checked;
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-citation-ack="${domainKey}"]`)?.addEventListener('change', (e) => {
    state.citationRiskAcknowledged = !!e.target.checked;
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-worsened-ack="${domainKey}"]`)?.addEventListener('change', (e) => {
    state.worsenedRetryAcknowledged = !!e.target.checked;
    rerenderLiveIngestDomain(domainKey);
  });
  document.querySelector(`[data-live-ingest-apply="${domainKey}"]`)?.addEventListener('click', () => applyLiveIngestProposal(domainKey));
  document.querySelectorAll('[data-live-ingest-retry-ocr]').forEach((button) => {
    button.onclick = async (e) => {
      e.preventDefault();
      if (button.disabled) return;
      const idx = parseInt(button.dataset.liveIngestRetryOcr, 10);
      if (Number.isNaN(idx)) return;
      const orig = button.textContent;
      button.disabled = true; button.textContent = 'Retrying\u2026'; button.style.opacity = '0.6';
      try { await retryLiveIngestOcrSource(domainKey, idx); } catch (err) { showToast('OCR retry failed: ' + err.message, 'error'); } finally { button.disabled = false; button.textContent = orig; button.style.opacity = ''; }
    };
  });
  document.querySelectorAll(`[data-live-ingest-op^="${domainKey}:"]`).forEach((checkbox) => {
    checkbox.onchange = () => {
      const [, idxText] = checkbox.dataset.liveIngestOp.split(':');
      const idx = parseInt(idxText, 10);
      if (!Array.isArray(state.proposal?.operations) || Number.isNaN(idx) || !state.proposal.operations[idx]) return;
      state.proposal.operations[idx]._selected = checkbox.checked;
      if (!liveIngestHasCitationRisk(state.proposal.operations || [], true)) {
        state.citationRiskAcknowledged = false;
      }
    };
  });
  document.querySelectorAll(`[data-live-ingest-json^="${domainKey}:"]`).forEach((editor) => {
    editor.onchange = () => {
      const [, idxText] = editor.dataset.liveIngestJson.split(':');
      const idx = parseInt(idxText, 10);
      if (!Array.isArray(state.proposal?.operations) || Number.isNaN(idx) || !state.proposal.operations[idx]) return;
      const op = state.proposal.operations[idx];
      try {
        const parsed = JSON.parse(editor.value);
        if (op.kind === 'bridge') {
          op.payload = parsed;
        } else {
          op.fields = parsed;
        }
        op._parseError = '';
      } catch (err) {
        op._parseError = err.message || 'Invalid JSON';
      }
      rerenderLiveIngestDomain(domainKey);
    };
  });
  document.querySelectorAll(`[data-live-ingest-target^="${domainKey}:"]`).forEach((button) => {
    button.onclick = () => {
      const [, idxText] = button.dataset.liveIngestTarget.split(':');
      const idx = parseInt(idxText, 10);
      if (Number.isNaN(idx) || !state.lookupResults[idx]) return;
      state.boundTarget = state.lookupResults[idx];
      state.lookupResults = [];
      state.selectedEntity = null;
      state.entityResults = [];
      rerenderLiveIngestDomain(domainKey);
      searchLiveIngestEntities(domainKey);
    };
  });
  document.querySelectorAll(`[data-live-ingest-entity^="${domainKey}:"]`).forEach((button) => {
    button.onclick = () => {
      const [, idxText] = button.dataset.liveIngestEntity.split(':');
      const idx = parseInt(idxText, 10);
      if (Number.isNaN(idx) || !state.entityResults[idx]) return;
      state.selectedEntity = state.entityResults[idx];
      state.entityResults = [];
      rerenderLiveIngestDomain(domainKey);
    };
  });
  document.querySelectorAll(`[data-live-ingest-refresh-op^="${domainKey}:"]`).forEach((button) => {
    button.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (button.disabled) return;
      const [, idxText] = button.dataset.liveIngestRefreshOp.split(':');
      const idx = parseInt(idxText, 10);
      if (Number.isNaN(idx) || !state.proposal?.operations?.[idx]) return;
      const op = state.proposal.operations[idx];
      op._snapshotError = '';
      button.disabled = true; button.style.opacity = '0.6';
      state.loadingSnapshots = true;
      rerenderLiveIngestDomain(domainKey);
      try {
        const fields = await fetchLiveIngestCurrentFields(domainKey, op);
        op._currentFields = fields;
      } catch (err) {
        op._snapshotError = err.message || 'Unable to refresh current values';
        showToast('Snapshot refresh failed', 'error');
      } finally {
        button.disabled = false; button.style.opacity = '';
        state.loadingSnapshots = false;
        rerenderLiveIngestDomain(domainKey);
      }
    };
  });
}

function rerenderLiveIngestDomain(domainKey) {
  if (domainKey === 'government') {
    renderGovTab();
  } else {
    renderDiaTab();
  }
}

function getLiveIngestCurrentContext(domainKey) {
  if (domainKey === 'government') {
    const rec = Array.isArray(researchQueue) ? researchQueue[researchIdx] : null;
    return {
      domain: 'government',
      mode: typeof researchMode === 'string' ? researchMode : 'research',
      allowed_tables: LIVE_INGEST_ALLOWED_TABLES.government,
      current_record: rec ? {
        lead_id: rec.lead_id || null,
        property_id: rec.property_id || rec.matched_property_id || null,
        ownership_id: rec.ownership_id || null,
        lease_number: rec.lease_number || null,
        address: rec.address || null,
        city: rec.city || null,
        state: rec.state || null,
        facility_name: rec.facility_name || null,
        property_name: rec.property_name || null
      } : null
    };
  }

  const rec = getCurrentDiaResearchRecord();
  return {
    domain: 'dialysis',
    mode: typeof diaResearchMode === 'string' ? diaResearchMode : 'research',
    allowed_tables: LIVE_INGEST_ALLOWED_TABLES.dialysis,
    current_record: rec ? {
      clinic_id: rec.clinic_id || rec.medicare_id || null,
      medicare_id: rec.medicare_id || rec.ccn || null,
      property_id: rec.property_id || null,
      ownership_id: rec.ownership_id || null,
      facility_name: rec.facility_name || null,
      address: rec.address || null,
      city: rec.city || null,
      state: rec.state || null,
      operator_name: rec.operator_name || rec.chain_organization || null
    } : null
  };
}

function getLiveIngestEffectiveContext(domainKey) {
  const state = getLiveIngestState(domainKey);
  if (state.boundTarget?.current_record) {
    return enrichLiveIngestContextWithEntity({
      domain: domainKey,
      mode: 'manual_target',
      allowed_tables: LIVE_INGEST_ALLOWED_TABLES[domainKey],
      source_table: state.boundTarget.source_table || null,
      manual_target: true,
      current_record: state.boundTarget.current_record
    }, state.selectedEntity);
  }
  return enrichLiveIngestContextWithEntity(getLiveIngestCurrentContext(domainKey), state.selectedEntity);
}

function enrichLiveIngestContextWithEntity(context, entity) {
  if (!entity) return context;
  return {
    ...context,
    selected_entity: {
      id: entity.id || null,
      entity_type: entity.entity_type || null,
      name: entity.name || null,
      domain: entity.domain || null,
      city: entity.city || null,
      state: entity.state || null,
      email: entity.email || null,
      phone: entity.phone || null,
      address: entity.address || null
    }
  };
}

function getCurrentDiaResearchRecord() {
  if (typeof diaResearchMode === 'undefined') return null;
  if (diaResearchMode === 'property') {
    const filtered = (diaData?.propertyReviewQueue || []).filter((row) => !diaPropertyFilter?.review_type || row.review_type === diaPropertyFilter.review_type);
    return filtered[diaPropertyFilter?.selectedIdx];
  }
  if (diaResearchMode === 'lease') {
    const filtered = (diaData?.leaseBackfillRows || []).filter((row) => !diaLeaseFilter?.priority || row.lease_backfill_priority === diaLeaseFilter.priority);
    return filtered[diaLeaseFilter?.selectedIdx];
  }
  if (diaResearchMode === 'clinic_leads') {
    let filtered = Array.isArray(diaClinicLeadQueue) ? diaClinicLeadQueue.slice() : [];
    const resolvedIds = new Set(((diaData?.researchOutcomes) || []).filter((o) => o.queue_type === 'clinic_lead').map((o) => o.clinic_id));
    if (diaClinicLeadFilter?.hideResolved) filtered = filtered.filter((row) => !resolvedIds.has(row.medicare_id));
    if (diaClinicLeadFilter?.category) filtered = filtered.filter((row) => row.research_category === diaClinicLeadFilter.category);
    if (diaClinicLeadFilter?.tier) filtered = filtered.filter((row) => row.priority_tier === diaClinicLeadFilter.tier);
    if (diaClinicLeadFilter?.state) filtered = filtered.filter((row) => row.state === diaClinicLeadFilter.state);
    return filtered[diaClinicLeadFilter?.selectedIdx];
  }
  return null;
}

async function ingestLiveIngestFiles(domainKey, fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const state = getLiveIngestState(domainKey);
  for (const file of files.slice(0, 6)) {
    try {
      const items = await normalizeLiveIngestFile(file);
      if (Array.isArray(items)) state.attachments.push(...items);
    } catch (err) {
      showToast(`Skipped ${file.name}: ${err.message}`, 'error');
    }
  }
  rerenderLiveIngestDomain(domainKey);
}

async function ingestLiveIngestClipboardItems(domainKey, items) {
  const files = [];
  items.forEach((item) => {
    const file = item.getAsFile?.();
    if (file) files.push(file);
  });
  if (!files.length) {
    showToast('Clipboard does not contain an image file', 'warning');
    return;
  }
  await ingestLiveIngestFiles(domainKey, files);
}

async function pasteLiveIngestClipboard(domainKey) {
  if (!navigator.clipboard?.read) {
    showToast('Click the drop area and paste with Ctrl+V', 'warning');
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of items) {
      for (const type of item.types) {
        if (!type.startsWith('image/')) continue;
        const blob = await item.getType(type);
        files.push(new File([blob], `clipboard-${Date.now()}.png`, { type }));
      }
    }
    if (!files.length) {
      showToast('Clipboard does not contain an image', 'warning');
      return;
    }
    await ingestLiveIngestFiles(domainKey, files);
  } catch (err) {
    showToast(`Clipboard read failed: ${err.message}`, 'error');
  }
}

async function captureLiveIngestScreen(domainKey) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast('Screen capture is not supported in this browser', 'warning');
    return;
  }
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    if (!stream.getVideoTracks().length) throw new Error('No video track available');
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1920;
    canvas.height = video.videoHeight || 1080;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Unable to capture image');
    await ingestLiveIngestFiles(domainKey, [new File([blob], `screen-${Date.now()}.png`, { type: 'image/png' })]);
  } catch (err) {
    showToast(`Screen capture failed: ${err.message}`, 'error');
  } finally {
    (stream?.getTracks?.() || []).forEach((track) => track.stop());
  }
}

async function normalizeLiveIngestFile(file) {
  // Reject files over 25MB to prevent browser freezing
  const MAX_FILE_SIZE = 25 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 25MB.`);
  }
  const lowerName = String(file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return await convertPdfToImageAttachments(file);
  }
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')) {
    return await convertDocxToTextAttachment(file);
  }
  if (file.type === 'application/msword' || lowerName.endsWith('.doc')) {
    return await convertLegacyDocToTextAttachment(file);
  }
  if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || lowerName.endsWith('.xlsx')) {
    return await convertXlsxToTextAttachment(file);
  }
  if (file.type === 'application/vnd.ms-excel' || lowerName.endsWith('.xls')) {
    return await convertLegacyXlsToTextAttachment(file);
  }
  if (file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || lowerName.endsWith('.pptx')) {
    return await convertPptxToTextAttachment(file);
  }
  if (file.type === 'application/vnd.ms-powerpoint' || lowerName.endsWith('.ppt')) {
    return await convertLegacyPptToTextAttachment(file);
  }
  if (file.type.startsWith('image/')) {
    const dataUrl = await readFileAsDataUrl(file);
    return [{
      id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'image',
      name: file.name || 'image',
      mime_type: file.type,
      data_url: dataUrl
    }];
  }

  const isTextLike = file.type.startsWith('text/')
    || ['.txt', '.md', '.csv', '.json', '.html', '.htm', '.eml'].some((ext) => lowerName.endsWith(ext))
    || ['application/json', 'message/rfc822'].includes(file.type);
  if (!isTextLike) {
    throw new Error('Only images, PDFs, DOC/DOCX/XLS/XLSX/PPT/PPTX files, and text-based exports are supported directly.');
  }
  const text = await readFileAsText(file);
  return [{
    id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    name: file.name || 'text',
    mime_type: file.type || 'text/plain',
    text: String(text || '').slice(0, 30000)
  }];
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

async function convertPdfToImageAttachments(file) {
  if (typeof window.pdfjsLib === 'undefined') {
    throw new Error('PDF renderer not available');
  }

  if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.js';
  }

  const buffer = await readFileAsArrayBuffer(file);
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  const pageCount = Math.min(pdf.numPages || 0, 3);
  const items = [];
  const textPages = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    try {
      const textContent = await page.getTextContent();
      const pageText = (textContent.items || [])
        .map((item) => item?.str || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (pageText) {
        textPages.push(`Page ${pageNum}\n${pageText}`);
      }
    } catch (_) {
      // Ignore text extraction failures and keep visual rendering path.
    }
    const viewport = page.getViewport({ scale: 1.35 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/png');
    items.push({
      id: `li-${Date.now()}-${pageNum}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'image',
      name: `${file.name || 'document.pdf'} - page ${pageNum}`,
      mime_type: 'image/png',
      data_url: dataUrl
    });
  }

  if (textPages.length) {
    items.push({
      id: `li-${Date.now()}-pdftext-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'text',
      name: `${file.name || 'document.pdf'} - extracted text`,
      mime_type: 'text/plain',
      text: textPages.join('\n\n').slice(0, 30000)
    });
  }

  if (!items.length) {
    throw new Error('PDF did not contain renderable pages');
  }

  return items;
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

async function convertDocxToTextAttachment(file) {
  if (typeof window.JSZip === 'undefined') {
    throw new Error('DOCX extractor not available');
  }

  const buffer = await readFileAsArrayBuffer(file);
  const zip = await window.JSZip.loadAsync(buffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('DOCX is missing word/document.xml');
  }

  const [xml, commentsXml, footnotesXml, endnotesXml] = await Promise.all([
    docXmlFile.async('string'),
    zip.file('word/comments.xml')?.async('string') || Promise.resolve(''),
    zip.file('word/footnotes.xml')?.async('string') || Promise.resolve(''),
    zip.file('word/endnotes.xml')?.async('string') || Promise.resolve('')
  ]);
  const text = extractTextFromDocxPackage({
    documentXml: xml,
    commentsXml,
    footnotesXml,
    endnotesXml
  });
  if (!text.trim()) {
    throw new Error('DOCX did not contain readable text');
  }

  return [{
    id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    name: file.name || 'document.docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    text: text.slice(0, 30000)
  }];
}

async function convertLegacyDocToTextAttachment(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const text = extractLegacyOfficeTextFromArrayBuffer(buffer, 'doc');
  if (!text.trim()) {
    throw new Error('DOC did not contain readable text');
  }
  return [{
    id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    name: file.name || 'document.doc',
    mime_type: 'application/msword',
    text: text.slice(0, 30000)
  }];
}

async function convertXlsxToTextAttachment(file) {
  if (typeof window.JSZip === 'undefined') {
    throw new Error('XLSX extractor not available');
  }

  const buffer = await readFileAsArrayBuffer(file);
  const zip = await window.JSZip.loadAsync(buffer);
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  if (!workbookXml) {
    throw new Error('XLSX is missing xl/workbook.xml');
  }

  const [relsXml, sharedStringsXml] = await Promise.all([
    zip.file('xl/_rels/workbook.xml.rels')?.async('string') || Promise.resolve(''),
    zip.file('xl/sharedStrings.xml')?.async('string') || Promise.resolve('')
  ]);
  const sheetEntries = await extractTextFromXlsxPackage({
    workbookXml,
    relsXml,
    sharedStringsXml,
    getSheetXml: (path) => zip.file(path)?.async('string') || Promise.resolve('')
  });
  const text = sheetEntries.join('\n\n').trim();
  if (!text) {
    throw new Error('XLSX did not contain readable cells');
  }

  return [{
    id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    name: file.name || 'workbook.xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    text: text.slice(0, 30000)
  }];
}

async function convertLegacyXlsToTextAttachment(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const text = extractLegacyOfficeTextFromArrayBuffer(buffer, 'xls');
  if (!text.trim()) {
    throw new Error('XLS did not contain readable text');
  }
  return [{
    id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    name: file.name || 'workbook.xls',
    mime_type: 'application/vnd.ms-excel',
    text: text.slice(0, 30000)
  }];
}

async function convertPptxToTextAttachment(file) {
  if (typeof window.JSZip === 'undefined') {
    throw new Error('PPTX extractor not available');
  }

  const buffer = await readFileAsArrayBuffer(file);
  const zip = await window.JSZip.loadAsync(buffer);
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presentationXml) {
    throw new Error('PPTX is missing ppt/presentation.xml');
  }

  const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string') || '';
  const slideEntries = await extractTextFromPptxPackage({
    presentationXml,
    relsXml,
    getSlideXml: (path) => zip.file(path)?.async('string') || Promise.resolve(''),
    getNotesXml: (path) => zip.file(path)?.async('string') || Promise.resolve('')
  });
  const text = slideEntries.join('\n\n').trim();
  if (!text) {
    throw new Error('PPTX did not contain readable slide text');
  }

  return [{
    id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    name: file.name || 'deck.pptx',
    mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    text: text.slice(0, 30000)
  }];
}

async function convertLegacyPptToTextAttachment(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const text = extractLegacyOfficeTextFromArrayBuffer(buffer, 'ppt');
  if (!text.trim()) {
    throw new Error('PPT did not contain readable text');
  }
  return [{
    id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    name: file.name || 'deck.ppt',
    mime_type: 'application/vnd.ms-powerpoint',
    text: text.slice(0, 30000)
  }];
}

function extractLegacyOfficeTextFromArrayBuffer(arrayBuffer, label = 'office') {
  const bytes = new Uint8Array(arrayBuffer || new ArrayBuffer(0));
  if (!bytes.length) return '';
  const ascii = extractLegacyOfficeAsciiRuns(bytes, label);
  const utf16 = extractLegacyOfficeUtf16Runs(bytes, label);
  const merged = Array.from(new Set([...ascii, ...utf16]))
    .map((value) => normalizeLegacyOfficePreviewLine(value, label))
    .filter((value) => isUsefulLegacyOfficeLine(value, label));
  if (!merged.length) return '';
  const header = label === 'xls'
    ? 'Legacy Excel text preview'
    : label === 'ppt'
      ? 'Legacy PowerPoint text preview'
      : 'Legacy Word text preview';
  return `${header}\n${merged.slice(0, 120).join('\n')}`.trim();
}

function extractLegacyOfficeAsciiRuns(bytes, label = 'office') {
  const text = Array.from(bytes, (value) => {
    if (value === 9) return '\t';
    if (value === 10 || value === 13) return '\n';
    return value >= 32 && value <= 126 ? String.fromCharCode(value) : ' ';
  }).join('');
  return extractLegacyOfficeLinesFromText(text, label);
}

function extractLegacyOfficeUtf16Runs(bytes, label = 'office') {
  let text = '';
  let current = '';
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = bytes[index] | (bytes[index + 1] << 8);
    if (code === 9) {
      current += '\t';
      continue;
    }
    if (code === 10 || code === 13) {
      if (current.trim()) text += `${current}\n`;
      current = '';
      continue;
    }
    if (code >= 32 && code <= 126) {
      current += String.fromCharCode(code);
      continue;
    }
    if (current.trim()) text += `${current}\n`;
    current = '';
  }
  if (current.trim()) text += current;
  return extractLegacyOfficeLinesFromText(text, label);
}

function extractLegacyOfficeLinesFromText(text, label = 'office') {
  return Array.from(new Set(
    String(text || '')
      .split(/\n+/)
      .map((line) => normalizeLegacyOfficePreviewLine(line, label))
      .filter((line) => isUsefulLegacyOfficeLine(line, label))
  ));
}

function normalizeLegacyOfficePreviewLine(value, label = 'office') {
  const raw = String(value || '')
    .replace(/[^\S\r\n\t]+/g, ' ')
    .replace(/ ?\t ?/g, '\t')
    .trim();
  if (label === 'xls') {
    return raw
      .split('\t')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\t');
  }
  return raw.replace(/\s+/g, ' ');
}

function isUsefulLegacyOfficeLine(value, label = 'office') {
  const line = String(value || '').trim();
  if (line.length < 4) return false;
  if (!/[A-Za-z]{3,}/.test(line)) return false;
  if (/^[A-Z0-9_\/\\.-]{12,}$/.test(line)) return false;
  if (/^(root entry|objectpool|compobj|summaryinformation|documentsummaryinformation)$/i.test(line)) return false;
  if (label === 'xls') {
    return line.includes('\t') || /[A-Za-z]{3,}.*\d{2,}/.test(line) || /\d{2,}.*[A-Za-z]{3,}/.test(line);
  }
  return true;
}

function extractTextFromDocxPackage(pkg) {
  const commentsMap = buildDocxCommentsMap(pkg.commentsXml || '');
  const bodyText = extractTextFromDocxXml(pkg.documentXml || '', commentsMap);
  const footnotes = extractDocxNoteSection(pkg.footnotesXml || '', 'Footnotes');
  const endnotes = extractDocxNoteSection(pkg.endnotesXml || '', 'Endnotes');
  return [bodyText, footnotes, endnotes].filter(Boolean).join('\n\n').trim();
}

function extractTextFromDocxXml(xmlText, commentsMap = {}) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(String(xmlText || ''), 'application/xml');
  const paragraphs = Array.from(xml.getElementsByTagName('w:p'));
  const lines = paragraphs.map((p) => {
    return extractDocxParagraphText(p, commentsMap);
  });
  const combined = lines.join('\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return combined;
}

function extractDocxParagraphText(paragraph, commentsMap = {}) {
  const commentIds = [];

  function revisionMeta(node) {
    const author = String(node?.getAttribute?.('w:author') || node?.getAttribute?.('author') || '').trim();
    const date = String(node?.getAttribute?.('w:date') || node?.getAttribute?.('date') || '').trim();
    const bits = [];
    if (author) bits.push(`by ${author}`);
    if (date) bits.push(`on ${date}`);
    return bits.length ? ` ${bits.join(' ')}` : '';
  }

  function walk(node, revisionContext = '') {
    if (!node || node.nodeType !== 1) return;
    const name = docxNodeName(node);
    if (name === 't' || name === 'instrText') {
      return node.textContent || '';
    }
    if (name === 'delText') {
      const text = String(node.textContent || '').trim();
      if (!text) return '';
      return revisionContext === 'del' ? text : `[Deleted: ${text}]`;
    }
    if (name === 'tab') {
      return '\t';
    }
    if (name === 'br' || name === 'cr') {
      return '\n';
    }
    if (name === 'commentReference') {
      const commentId = node.getAttribute('w:id') || node.getAttribute('id');
      if (commentId != null) commentIds.push(String(commentId));
      return '';
    }
    if (name === 'ins' || name === 'del') {
      const content = Array.from(node.childNodes || [])
        .map((child) => walk(child, name))
        .join('')
        .replace(/\n{2,}/g, '\n')
        .trim();
      if (!content) return '';
      const label = name === 'ins' ? 'Inserted' : 'Deleted';
      return `[${label}${revisionMeta(node)}: ${content}]`;
    }
    return Array.from(node.childNodes || []).map((child) => walk(child, revisionContext)).join('');
  }

  const text = Array.from(paragraph.childNodes || [])
    .map((child) => walk(child))
    .join('')
    .replace(/\n{2,}/g, '\n')
    .trim();
  const uniqueComments = Array.from(new Set(commentIds))
    .map((id) => commentsMap[id])
    .filter(Boolean);
  if (!uniqueComments.length) return text;
  const commentText = uniqueComments.map((comment) => `[Comment: ${comment}]`).join(' ');
  return [text, commentText].filter(Boolean).join(' ').trim();
}

function buildDocxCommentsMap(xmlText) {
  if (!xmlText) return {};
  const parser = new DOMParser();
  const xml = parser.parseFromString(String(xmlText || ''), 'application/xml');
  const comments = Array.from(xml.getElementsByTagName('w:comment'));
  const map = {};
  comments.forEach((comment) => {
    const id = comment.getAttribute('w:id') || comment.getAttribute('id');
    if (id == null) return;
    const paragraphs = Array.from(comment.getElementsByTagName('w:p'))
      .map((p) => extractDocxParagraphText(p, {}))
      .filter(Boolean);
    map[String(id)] = paragraphs.join(' ').trim();
  });
  return map;
}

function extractDocxNoteSection(xmlText, label) {
  if (!xmlText) return '';
  const parser = new DOMParser();
  const xml = parser.parseFromString(String(xmlText || ''), 'application/xml');
  const noteTag = label === 'Footnotes' ? 'w:footnote' : 'w:endnote';
  const notes = Array.from(xml.getElementsByTagName(noteTag))
    .filter((note) => {
      const id = note.getAttribute('w:id') || note.getAttribute('id');
      return id !== '-1' && id !== '0';
    })
    .map((note) => {
      const lines = Array.from(note.getElementsByTagName('w:p'))
        .map((p) => extractDocxParagraphText(p, {}))
        .filter(Boolean);
      return lines.join(' ').trim();
    })
    .filter(Boolean);
  if (!notes.length) return '';
  return `${label}:\n${notes.join('\n')}`;
}

function docxNodeName(node) {
  return String(node.localName || node.nodeName || '').replace(/^.*:/, '');
}

async function extractTextFromXlsxPackage(pkg) {
  const parser = new DOMParser();
  const workbookXml = parser.parseFromString(String(pkg.workbookXml || ''), 'application/xml');
  const relsXml = parser.parseFromString(String(pkg.relsXml || ''), 'application/xml');
  const sharedStrings = extractXlsxSharedStrings(parser.parseFromString(String(pkg.sharedStringsXml || ''), 'application/xml'));
  const relMap = new Map(Array.from(relsXml.getElementsByTagName('Relationship')).map((rel) => [
    rel.getAttribute('Id'),
    `xl/${String(rel.getAttribute('Target') || '').replace(/^\/+/, '')}`
  ]));
  const sheets = Array.from(workbookXml.getElementsByTagName('sheet')).map((sheet, index) => ({
    name: sheet.getAttribute('name') || `Sheet ${index + 1}`,
    path: relMap.get(sheet.getAttribute('r:id')) || `xl/worksheets/sheet${index + 1}.xml`
  }));
  const outputs = [];
  for (const sheet of sheets.slice(0, 6)) {
    const xmlText = await pkg.getSheetXml(sheet.path);
    if (!xmlText) continue;
    const rows = extractXlsxSheetRows(parser.parseFromString(String(xmlText || ''), 'application/xml'), sharedStrings);
    if (!rows.length) continue;
    outputs.push(`${sheet.name}\n${rows.join('\n')}`);
  }
  return outputs;
}

function extractXlsxSharedStrings(xml) {
  return Array.from(xml?.getElementsByTagName?.('si') || []).map((item) => {
    return Array.from(item.getElementsByTagName('t'))
      .map((node) => node.textContent || '')
      .join('')
      .trim();
  });
}

function extractXlsxSheetRows(xml, sharedStrings = []) {
  const rows = Array.from(xml?.getElementsByTagName?.('row') || []);
  return rows.map((row) => {
    const cells = Array.from(row.getElementsByTagName('c')).map((cell) => {
      const type = cell.getAttribute('t') || '';
      if (type === 'inlineStr') {
        return Array.from(cell.getElementsByTagName('t')).map((node) => node.textContent || '').join('').trim();
      }
      const value = cell.getElementsByTagName('v')[0]?.textContent || '';
      if (type === 's') {
        const idx = parseInt(value, 10);
        return Number.isNaN(idx) ? '' : (sharedStrings[idx] || '');
      }
      return String(value || '').trim();
    }).filter((value) => value !== '');
    return cells.join('\t').trim();
  }).filter(Boolean);
}

async function extractTextFromPptxPackage(pkg) {
  const parser = new DOMParser();
  const relsXml = parser.parseFromString(String(pkg.relsXml || ''), 'application/xml');
  const relMap = new Map(Array.from(relsXml.getElementsByTagName('Relationship')).map((rel) => [
    rel.getAttribute('Id'),
    `ppt/${String(rel.getAttribute('Target') || '').replace(/^\/+/, '')}`
  ]));
  const presentationXml = parser.parseFromString(String(pkg.presentationXml || ''), 'application/xml');
  const slides = Array.from(presentationXml.getElementsByTagName('p:sldId')).map((slide, index) => ({
    name: `Slide ${index + 1}`,
    path: relMap.get(slide.getAttribute('r:id')) || `ppt/slides/slide${index + 1}.xml`,
    notesPath: `ppt/notesSlides/notesSlide${index + 1}.xml`
  }));
  const outputs = [];
  for (const slide of slides.slice(0, 10)) {
    const [slideXml, notesXml] = await Promise.all([
      pkg.getSlideXml(slide.path),
      pkg.getNotesXml(slide.notesPath)
    ]);
    const slideText = extractPptxTextFromXml(parser.parseFromString(String(slideXml || ''), 'application/xml'));
    const notesText = extractPptxTextFromXml(parser.parseFromString(String(notesXml || ''), 'application/xml'));
    const combined = [
      slideText ? `${slide.name}\n${slideText}` : '',
      notesText ? `Notes\n${notesText}` : ''
    ].filter(Boolean).join('\n');
    if (combined) outputs.push(combined.trim());
  }
  return outputs;
}

function extractPptxTextFromXml(xml) {
  const paragraphs = Array.from(xml?.getElementsByTagName?.('a:p') || []);
  return paragraphs.map((paragraph) => {
    return Array.from(paragraph.getElementsByTagName('a:t'))
      .map((node) => node.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }).filter(Boolean).join('\n').trim();
}

async function runLiveIngestExtraction(domainKey) {
  const state = getLiveIngestState(domainKey);
  const imageAttachments = state.attachments.filter((item) => item.kind === 'image').slice(0, 3).map((item) => ({
    type: 'image',
    mime_type: item.mime_type || 'image/png',
    name: item.name || 'image',
    data_url: item.data_url
  }));
  const textDocs = state.attachments.filter((item) => item.kind === 'text').map((item) => ({
    name: item.name,
    mime_type: item.mime_type,
    text: item.text
  }));

  if (!imageAttachments.length && !textDocs.length) {
    state.error = 'Add at least one screenshot or text-based source file before extracting.';
    rerenderLiveIngestDomain(domainKey);
    return;
  }

  state.extracting = true;
  state.loadingSnapshots = false;
  state.error = '';
  state.extractionDocs = [];
  state.lowConfidenceOcrAcknowledged = false;
  state.citationRiskAcknowledged = false;
  rerenderLiveIngestDomain(domainKey);

  try {
    const context = getLiveIngestEffectiveContext(domainKey);
    const normalizedDocs = await normalizeLiveIngestTextDocuments(textDocs);
    const normalizedImageAttachments = normalizedDocs
      .flatMap((doc) => Array.isArray(doc.extracted_attachments) ? doc.extracted_attachments : [])
      .filter((item) => item && item.kind === 'image' && item.data_url)
      .slice(0, Math.max(0, 3 - imageAttachments.length))
      .map((item) => ({
        type: 'image',
        mime_type: item.mime_type || 'image/png',
        name: item.name || 'email image',
        data_url: item.data_url
      }));
    const ocrDocs = await extractLiveIngestOcrDocuments({
      domainKey,
      sourceLabel: state.sourceLabel,
      imageAttachments: [...imageAttachments, ...normalizedImageAttachments]
    });
    state.preparedTextDocs = normalizedDocs;
    state.preparedImageAttachments = [...imageAttachments, ...normalizedImageAttachments];
    state.extractionDocs = [...normalizedDocs, ...ocrDocs];
    const lowConfidenceOcrSources = state.extractionDocs
      .filter((doc) => String(doc?.metadata?.ocr_confidence || '').toLowerCase() === 'low')
      .map((doc) => String(doc?.metadata?.source_image_name || doc?.name || 'OCR source'));
    const response = await invokeLccAssistant({
      feature: `${domainKey}_live_ingest`,
      context: {
        ...context,
        source_label: state.sourceLabel || null,
        user_notes: state.notes || null,
        text_documents: [...normalizedDocs, ...ocrDocs]
      },
      attachments: [...imageAttachments, ...normalizedImageAttachments],
      message: buildLiveIngestPrompt(domainKey, state, context)
    });

    state.rawResponse = response;
    const proposal = parseLiveIngestProposal(response, domainKey, {
      lowConfidenceOcrSources,
      extractionDocs: state.extractionDocs
    });
    proposal.operations = sortLiveIngestOperationsByConfidence((proposal.operations || []).map((op) => ({
      ...op,
      _selected: op._citationRisk ? false : op._selected !== false
    })));
    if ((proposal.operations || []).some((op) => op._citationRisk)) {
      proposal.notes_for_user = [
        'Uncited operations from a low-confidence OCR run were deselected by default. Use `Select Cited Only` to keep the safer subset selected, or review and re-enable individual risky operations manually.',
        ...(proposal.notes_for_user || [])
      ];
    }
    state.proposal = proposal;
    state.loadingSnapshots = true;
    rerenderLiveIngestDomain(domainKey);
    await hydrateLiveIngestSnapshots(domainKey, proposal.operations || []);
  } catch (err) {
    state.error = err.message || 'Extraction failed';
  } finally {
    state.extracting = false;
    state.loadingSnapshots = false;
    rerenderLiveIngestDomain(domainKey);
  }
}

async function retryLiveIngestOcrSource(domainKey, docIndex) {
  const state = getLiveIngestState(domainKey);
  const doc = state.extractionDocs?.[docIndex];
  if (!doc || String(doc.source_kind || '') !== 'ocr') return;
  const sourceName = String(doc.metadata?.source_image_name || '').trim();
  const previousText = String(doc.normalized_text || '');
  const previousConfidence = String(doc.metadata?.ocr_confidence || '').trim();
  const image = (state.preparedImageAttachments || []).find((item) => String(item?.name || '').trim() === sourceName);
  if (!image?.data_url) {
    showToast('Could not find the original image for this OCR source', 'warning');
    return;
  }

  state.extracting = true;
  state.error = '';
  rerenderLiveIngestDomain(domainKey);
  try {
    const refreshedDocs = await extractLiveIngestOcrDocuments({
      domainKey,
      sourceLabel: state.sourceLabel,
      imageAttachments: [image]
    });
    if (!refreshedDocs.length) {
      showToast('OCR retry did not return usable text', 'warning');
      return;
    }
    const nextDoc = {
      ...refreshedDocs[0],
      metadata: {
        ...(refreshedDocs[0].metadata || {}),
        source_image_name: sourceName || refreshedDocs[0].metadata?.source_image_name || null,
        ocr_retry_previous_text: previousText,
        ocr_retry_previous_confidence: previousConfidence || null,
        ocr_retry_history: [
          ...((Array.isArray(doc?.metadata?.ocr_retry_history) ? doc.metadata.ocr_retry_history : []).filter((entry) => entry && typeof entry === 'object')),
          {
            previous_text: previousText,
            previous_confidence: previousConfidence || null,
            next_text: String(refreshedDocs[0].normalized_text || ''),
            next_confidence: String(refreshedDocs[0].metadata?.ocr_confidence || '').trim() || null,
            retried_at: new Date().toISOString()
          }
        ]
      }
    };
    state.extractionDocs = (state.extractionDocs || []).map((item, idx) => idx === docIndex ? nextDoc : item);
    await rerunLiveIngestProposalFromPreparedInputs(domainKey);
    showToast('OCR retried and proposal refreshed', 'success');
  } catch (err) {
    state.error = err.message || 'OCR retry failed';
  } finally {
    state.extracting = false;
    rerenderLiveIngestDomain(domainKey);
  }
}

async function rerunLiveIngestProposalFromPreparedInputs(domainKey) {
  const state = getLiveIngestState(domainKey);
  const context = getLiveIngestEffectiveContext(domainKey);
  const preparedTextDocs = Array.isArray(state.preparedTextDocs) ? state.preparedTextDocs : [];
  const preparedImageAttachments = Array.isArray(state.preparedImageAttachments) ? state.preparedImageAttachments : [];
  const lowConfidenceOcrSources = (state.extractionDocs || [])
    .filter((doc) => String(doc?.metadata?.ocr_confidence || '').toLowerCase() === 'low')
    .map((doc) => String(doc?.metadata?.source_image_name || doc?.name || 'OCR source'));
  const response = await invokeLccAssistant({
    feature: `${domainKey}_live_ingest`,
    context: {
      ...context,
      source_label: state.sourceLabel || null,
      user_notes: state.notes || null,
      text_documents: state.extractionDocs || []
    },
    attachments: preparedImageAttachments,
    message: buildLiveIngestPrompt(domainKey, state, context)
  });
  state.rawResponse = response;
  const proposal = parseLiveIngestProposal(response, domainKey, {
    lowConfidenceOcrSources,
    extractionDocs: state.extractionDocs
  });
  proposal.operations = sortLiveIngestOperationsByConfidence((proposal.operations || []).map((op) => ({
    ...op,
    _selected: op._citationRisk ? false : op._selected !== false
  })));
  if ((proposal.operations || []).some((op) => op._citationRisk)) {
    proposal.notes_for_user = [
      'Uncited operations from a low-confidence OCR run were deselected by default. Use `Select Cited Only` to keep the safer subset selected, or review and re-enable individual risky operations manually.',
      ...(proposal.notes_for_user || [])
    ];
  }
  state.lowConfidenceOcrAcknowledged = false;
  state.citationRiskAcknowledged = false;
  state.proposal = proposal;
  state.loadingSnapshots = true;
  rerenderLiveIngestDomain(domainKey);
  try {
    await hydrateLiveIngestSnapshots(domainKey, proposal.operations || []);
  } catch (snapshotErr) {
    console.error('hydrateLiveIngestSnapshots error:', snapshotErr);
  } finally {
    state.loadingSnapshots = false;
  }
}

async function extractLiveIngestOcrDocuments({ domainKey, sourceLabel, imageAttachments = [] }) {
  const images = (Array.isArray(imageAttachments) ? imageAttachments : [])
    .filter((item) => item && item.data_url)
    .slice(0, 3);
  if (!images.length) return [];

  try {
    const response = await invokeLccAssistant({
      feature: 'detail_intake_assistant',
      context: {
        domain: domainKey,
        source_label: sourceLabel || null,
        task: 'ocr_transcription'
      },
      attachments: images,
      message: [
        'Read the attached images and transcribe visible text for downstream data ingestion.',
        'Return JSON only with schema: {"pages":[{"name":string,"text":string,"confidence":"high"|"medium"|"low"}],"notes":[string]}.',
        'Keep layout hints for tables/lists when visible, but do not infer missing text.',
        'If an image is mostly non-text, return an empty text string for that page.',
        'Use low confidence when text is partial, obstructed, or visually ambiguous.'
      ].join('\n')
    });
    const payload = parseLiveIngestJsonPayload(response);
    const pages = Array.isArray(payload?.pages) ? payload.pages : [];
    const docs = pages
      .map((page, index) => {
        const sourceImageName = String(images[index]?.name || `Image ${index + 1}`).trim();
        const name = String(page?.name || sourceImageName).trim();
        const text = String(page?.text || '').trim();
        const confidence = String(page?.confidence || '').toLowerCase();
        if (!text) return null;
        return {
          name: `${sourceLabel || `${domainKey} intake`} - OCR - ${name}`,
          mime_type: 'text/plain',
          source_kind: 'ocr',
          normalized_text: `${name}\n${text}`.slice(0, 30000),
          metadata: {
            source_image_name: sourceImageName,
            ocr_page_name: name,
            ocr_confidence: ['high', 'medium', 'low'].includes(confidence) ? confidence : null,
            ocr_page_index: index + 1,
            generated_from_images: 1
          }
        };
      })
      .filter(Boolean);
    return docs;
  } catch (err) {
    console.warn('Live ingest OCR fallback failed:', err);
    return [];
  }
}

function parseLiveIngestJsonPayload(raw) {
  const text = String(raw || '').trim();
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('The AI response did not include valid JSON.');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function hydrateLiveIngestSnapshots(domainKey, operations) {
  const updates = (Array.isArray(operations) ? operations : []).filter((op) =>
    op.kind === 'update' && op.table && op.id_column && op.record_identifier != null
  );
  await Promise.all(updates.map(async (op) => {
    try {
      op._currentFields = await fetchLiveIngestCurrentFields(domainKey, op);
      op._snapshotError = '';
    } catch (err) {
      op._snapshotError = err.message || 'Unable to load current values';
    }
  }));
}

async function fetchLiveIngestCurrentFields(domainKey, op) {
  const proxyBase = domainKey === 'government' ? '/api/gov-query' : '/api/dia-query';
  const fields = Object.keys(op.fields || {}).filter(Boolean);
  if (!fields.length) return {};
  const primaryRows = await fetchLiveIngestSnapshotRows(proxyBase, op, fields, true);
  if (primaryRows.length) return primaryRows[0] || {};
  const fallbackRows = await fetchLiveIngestSnapshotRows(proxyBase, op, fields, false);
  if (fallbackRows.length) return fallbackRows[0] || {};
  throw new Error('Snapshot lookup returned no matching rows');
}

async function fetchLiveIngestSnapshotRows(proxyBase, op, fields, includeMatchFilters) {
  const url = new URL(proxyBase, window.location.origin);
  url.searchParams.set('table', op.table);
  url.searchParams.set('select', fields.join(','));
  url.searchParams.set('filter', `${op.id_column}=eq.${op.record_identifier}`);
  if (includeMatchFilters) {
    (Array.isArray(op.match_filters) ? op.match_filters : []).forEach((filter, idx) => {
      if (!filter?.column) return;
      url.searchParams.set(`filter${idx + 2}`, `${filter.column}=eq.${filter.value}`);
    });
  }
  url.searchParams.set('limit', '1');
  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Snapshot lookup failed (${res.status})`);
  }
  return Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
}

async function normalizeLiveIngestTextDocuments(textDocs) {
  if (!Array.isArray(textDocs) || !textDocs.length) return [];
  try {
    const res = await fetch('/api/live-ingest?action=normalize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LCC-Workspace': LCC_USER.workspace_id || ''
      },
      body: JSON.stringify({ action: 'normalize', documents: textDocs })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Normalize failed (${res.status})`);
    return Array.isArray(data.documents) ? data.documents : [];
  } catch (err) {
    console.warn('Live ingest normalization fallback:', err);
    return textDocs.map((doc) => ({
      ...doc,
      source_kind: 'text',
      normalized_text: doc.text || ''
    }));
  }
}

async function searchLiveIngestRecords(domainKey) {
  const state = getLiveIngestState(domainKey);
  const term = String(state.lookupQuery || '').trim();
  if (!term) {
    state.lookupResults = [];
    rerenderLiveIngestDomain(domainKey);
    return;
  }

  state.lookupLoading = true;
  state.error = '';
  rerenderLiveIngestDomain(domainKey);

  // Sanitize for PostgREST ilike filter — strip syntax-breaking characters
  const safeTerm = term.replace(/[*()',\\]/g, '');
  if (!safeTerm) { state.lookupLoading = false; rerenderLiveIngestDomain(domainKey); return; }
  const like = `*${safeTerm}*`;
  try {
    let results = [];
    if (domainKey === 'government') {
      const [leads, properties, ownership] = await Promise.all([
        govQuery('prospect_leads', 'lead_id,lease_number,address,city,state,tenant_agency,lessor_name,matched_property_id,property_id', { filter: `or=(address.ilike.${like},tenant_agency.ilike.${like},lessor_name.ilike.${like},lease_number.ilike.${like})`, limit: 8 }),
        govQuery('properties', 'property_id,address,city,state,property_name,agency', { filter: `or=(address.ilike.${like},city.ilike.${like},state.ilike.${like},agency.ilike.${like},property_name.ilike.${like})`, limit: 8 }),
        govQuery('ownership_history', 'ownership_id,property_id,address,city,state,new_owner,prior_owner,recorded_owner_name', { filter: `or=(address.ilike.${like},new_owner.ilike.${like},prior_owner.ilike.${like},recorded_owner_name.ilike.${like})`, limit: 8 })
      ]);
      results = [
        ...(leads.data || []).map((row) => ({
          source_table: 'prospect_leads',
          label: row.address || row.lease_number || `Lead ${row.lead_id}`,
          subtitle: [row.city, row.state, row.tenant_agency, row.lead_id ? `lead ${row.lead_id}` : ''].filter(Boolean).join(' | '),
          current_record: {
            lead_id: row.lead_id || null,
            property_id: row.matched_property_id || row.property_id || null,
            lease_number: row.lease_number || null,
            address: row.address || null,
            city: row.city || null,
            state: row.state || null
          }
        })),
        ...(properties.data || []).map((row) => ({
          source_table: 'properties',
          label: row.address || row.property_name || `Property ${row.property_id}`,
          subtitle: [row.city, row.state, row.agency, row.property_id ? `property ${row.property_id}` : ''].filter(Boolean).join(' | '),
          current_record: {
            property_id: row.property_id || null,
            property_name: row.property_name || null,
            address: row.address || null,
            city: row.city || null,
            state: row.state || null
          }
        })),
        ...(ownership.data || []).map((row) => ({
          source_table: 'ownership_history',
          label: row.address || `Ownership ${row.ownership_id}`,
          subtitle: [row.city, row.state, row.new_owner || row.prior_owner || row.recorded_owner_name, row.ownership_id ? `ownership ${row.ownership_id}` : ''].filter(Boolean).join(' | '),
          current_record: {
            ownership_id: row.ownership_id || null,
            property_id: row.property_id || null,
            address: row.address || null,
            city: row.city || null,
            state: row.state || null
          }
        }))
      ];
    } else {
      const [clinics, properties, queue] = await Promise.all([
        diaQuery('v_cms_data', 'clinic_id,facility_name,address,city,state,operator_name,ccn', { filter: `or=(facility_name.ilike.${like},operator_name.ilike.${like},address.ilike.${like},city.ilike.${like},state.ilike.${like},ccn.ilike.${like},clinic_id.ilike.${like})`, limit: 8 }),
        diaQuery('properties', 'property_id,address,city,state,property_name,tenant_operator', { filter: `or=(address.ilike.${like},city.ilike.${like},state.ilike.${like},property_name.ilike.${like},tenant_operator.ilike.${like})`, limit: 8 }),
        diaQuery('v_clinic_property_link_review_queue', 'clinic_id,facility_name,operator_name,state,property_id,review_type', { filter: `or=(facility_name.ilike.${like},operator_name.ilike.${like},state.ilike.${like},clinic_id.ilike.${like})`, limit: 8 }).catch(() => [])
      ]);
      results = [
        ...(clinics || []).map((row) => ({
          source_table: 'v_cms_data',
          label: row.facility_name || `Clinic ${row.clinic_id}`,
          subtitle: [row.city, row.state, normalizeOperatorName(row.operator_name), row.clinic_id ? `clinic ${row.clinic_id}` : row.ccn ? `ccn ${row.ccn}` : ''].filter(Boolean).join(' | '),
          current_record: {
            clinic_id: row.clinic_id || null,
            medicare_id: row.ccn || null,
            facility_name: row.facility_name || null,
            address: row.address || null,
            city: row.city || null,
            state: row.state || null,
            operator_name: row.operator_name || null
          }
        })),
        ...(properties || []).map((row) => ({
          source_table: 'properties',
          label: row.address || row.property_name || `Property ${row.property_id}`,
          subtitle: [row.city, row.state, row.tenant_operator, row.property_id ? `property ${row.property_id}` : ''].filter(Boolean).join(' | '),
          current_record: {
            property_id: row.property_id || null,
            property_name: row.property_name || null,
            address: row.address || null,
            city: row.city || null,
            state: row.state || null
          }
        })),
        ...(queue || []).map((row) => ({
          source_table: 'v_clinic_property_link_review_queue',
          label: row.facility_name || `Clinic ${row.clinic_id}`,
          subtitle: [row.state, normalizeOperatorName(row.operator_name), row.review_type, row.clinic_id ? `clinic ${row.clinic_id}` : ''].filter(Boolean).join(' | '),
          current_record: {
            clinic_id: row.clinic_id || null,
            property_id: row.property_id || null,
            facility_name: row.facility_name || null,
            state: row.state || null,
            operator_name: row.operator_name || null
          }
        }))
      ];
    }

    state.lookupResults = results.slice(0, 12);
  } catch (err) {
    state.error = `Record lookup failed: ${err.message}`;
    state.lookupResults = [];
  } finally {
    state.lookupLoading = false;
    rerenderLiveIngestDomain(domainKey);
  }
}

function deriveLiveIngestEntityQuery(domainKey) {
  const state = getLiveIngestState(domainKey);
  const context = getLiveIngestEffectiveContext(domainKey);
  if (state.boundTarget?.label) return state.boundTarget.label;
  const rec = context?.current_record || {};
  return rec.facility_name || rec.property_name || rec.address || rec.lease_number || rec.operator_name || rec.city || '';
}

async function searchLiveIngestEntities(domainKey, rawTerm) {
  const state = getLiveIngestState(domainKey);
  const context = getLiveIngestEffectiveContext(domainKey);
  const queries = buildLiveIngestEntityQueries(domainKey, rawTerm, context);
  if (!queries.length) {
    state.entityResults = [];
    rerenderLiveIngestDomain(domainKey);
    return;
  }

  state.entityLoading = true;
  rerenderLiveIngestDomain(domainKey);
  try {
    const results = await Promise.all(queries.map((query) => fetchLiveIngestEntityCandidates(domainKey, query, context)));
    const merged = mergeLiveIngestEntityCandidates(results.flat(), context, domainKey);
    const suggestions = merged.slice(0, 8);
    const autoSelected = pickLiveIngestAutoEntity(suggestions);
    if (autoSelected) {
      state.selectedEntity = autoSelected;
      state.entityResults = [];
    } else {
      state.entityResults = suggestions;
    }
  } catch (err) {
    state.error = `Entity search failed: ${err.message}`;
    state.entityResults = [];
  } finally {
    state.entityLoading = false;
    rerenderLiveIngestDomain(domainKey);
  }
}

function buildLiveIngestEntityQueries(domainKey, rawTerm, context) {
  const rec = context?.current_record || {};
  const candidates = [
    rawTerm,
    rec.facility_name,
    rec.property_name,
    rec.operator_name,
    rec.address,
    rec.lease_number,
    deriveLiveIngestEntityQuery(domainKey)
  ]
    .map((value) => String(value || '').trim())
    .filter((value) => value.length >= 2);

  return Array.from(new Set(candidates)).slice(0, 4);
}

async function fetchLiveIngestEntityCandidates(domainKey, query, context) {
  const url = new URL('/api/entities', window.location.origin);
  url.searchParams.set('action', 'search');
  url.searchParams.set('q', query);
  if (domainKey === 'government') {
    url.searchParams.set('domain', 'government');
  } else if (domainKey === 'dialysis') {
    url.searchParams.set('domain', 'dialysis');
  }
  if (context?.current_record?.property_id) {
    url.searchParams.set('entity_type', 'asset');
  }
  const res = await fetch(url.toString(), {
    headers: { 'X-LCC-Workspace': LCC_USER.workspace_id || '' }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Entity search failed (${res.status})`);
  return Array.isArray(data.entities)
    ? data.entities.map((entity) => ({ ...entity, _query: query }))
    : [];
}

function mergeLiveIngestEntityCandidates(candidates, context, domainKey) {
  const byId = new Map();
  for (const entity of candidates) {
    const key = entity.id || `${entity.name}|${entity.entity_type}|${entity.domain}`;
    const scored = { ...entity, _score: scoreLiveIngestEntity(entity, context, domainKey) };
    const existing = byId.get(key);
    if (!existing || scored._score > existing._score) {
      byId.set(key, scored);
    }
  }
  return Array.from(byId.values()).sort((a, b) => (b._score || 0) - (a._score || 0) || String(a.name || '').localeCompare(String(b.name || '')));
}

function pickLiveIngestAutoEntity(candidates) {
  const ranked = Array.isArray(candidates) ? candidates : [];
  if (!ranked.length) return null;
  const top = ranked[0];
  const second = ranked[1];
  const topScore = Number(top?._score || 0);
  const secondScore = Number(second?._score || 0);
  const scoreGap = topScore - secondScore;
  if (topScore >= 85 && (ranked.length === 1 || scoreGap >= 20)) {
    return {
      ...top,
      _autoSelected: true,
      _confidenceLabel: scoreGap >= 35 ? 'very high confidence' : 'high confidence'
    };
  }
  return null;
}

function scoreLiveIngestEntity(entity, context, domainKey) {
  const rec = context?.current_record || {};
  const name = String(entity.name || '').toLowerCase();
  const query = String(entity._query || '').toLowerCase();
  let score = 0;
  if (entity.domain === domainKey) score += 20;
  if (query && name === query) score += 40;
  if (query && name.includes(query)) score += 18;
  if (rec.city && entity.city && String(rec.city).toLowerCase() === String(entity.city).toLowerCase()) score += 10;
  if (rec.state && entity.state && String(rec.state).toLowerCase() === String(entity.state).toLowerCase()) score += 8;
  if (rec.property_id && entity.entity_type === 'asset') score += 12;
  if (rec.clinic_id && (entity.entity_type === 'asset' || entity.entity_type === 'org')) score += 8;

  const identities = Array.isArray(entity.external_identities) ? entity.external_identities : [];
  const expectedIds = [rec.property_id, rec.lead_id, rec.ownership_id, rec.clinic_id, rec.medicare_id].filter((value) => value != null).map(String);
  identities.forEach((identity) => {
    if (expectedIds.includes(String(identity.external_id))) score += 60;
    if (domainKey === 'government' && identity.source_system === 'gov_supabase') score += 8;
    if (domainKey === 'dialysis' && identity.source_system === 'dialysis') score += 8;
    if (identity.source_system === 'salesforce') score += 4;
  });

  const assetType = String(entity.asset_type || '').toLowerCase();
  const orgType = String(entity.org_type || '').toLowerCase();
  const operatorName = String(rec.operator_name || '').toLowerCase();
  const address = String(rec.address || '').toLowerCase();
  const facilityName = String(rec.facility_name || '').toLowerCase();
  const propertyName = String(rec.property_name || '').toLowerCase();

  if (domainKey === 'government') {
    if (rec.property_id && entity.entity_type === 'asset') score += 16;
    if (rec.lead_id && entity.entity_type === 'asset') score += 10;
    if (address && name.includes(address)) score += 20;
    if (propertyName && name.includes(propertyName)) score += 14;
    if (orgType.includes('owner') || orgType.includes('landlord')) score += 6;
    if (assetType.includes('government')) score += 10;
  }

  if (domainKey === 'dialysis') {
    if (facilityName && name.includes(facilityName)) score += 18;
    if (operatorName && name.includes(operatorName)) score += 14;
    if (rec.clinic_id && entity.entity_type === 'org' && operatorName) score += 8;
    if (rec.property_id && entity.entity_type === 'asset') score += 14;
    if (assetType.includes('medical') || assetType.includes('dialysis')) score += 10;
    if (orgType.includes('operator') || orgType.includes('healthcare')) score += 8;
  }

  return score;
}

function buildLiveIngestPrompt(domainKey, state, context) {
  const allowedTables = LIVE_INGEST_ALLOWED_TABLES[domainKey];
  const sourceCatalog = buildLiveIngestSourceCatalog(state.extractionDocs || []);
  return [
    `You are mapping multimodal source material into audited ${domainKey} database updates for Life Command Center.`,
    'Return JSON only. Do not wrap it in markdown.',
    'Never invent record IDs, table names, or values not supported by the source material or provided context.',
    'If a change cannot be safely targeted, put it in missing_information instead of making an operation.',
    `Allowed target tables: ${allowedTables.join(', ')}.`,
    'Allowed operation kinds:',
    '- update: { kind, target_source, table, id_column, record_identifier, fields, reason, propagation_scope?, match_filters?, source_refs? }',
    '- insert: { kind, target_source, table, id_column?, record_identifier?, fields, reason, propagation_scope?, source_refs? }',
    '- bridge: { kind, action, payload, reason, source_refs? }',
    'Allowed bridge actions: update_entity, complete_research, save_ownership, log_activity.',
    'JSON schema:',
    '{ "summary": string, "confidence": "high"|"medium"|"low", "notes_for_user": string[], "missing_information": string[], "operations": [] }',
    `Source label: ${state.sourceLabel || 'not provided'}.`,
    `User instructions: ${state.notes || 'Extract facts and map them to the right writes.'}.`,
    `Current context: ${JSON.stringify(context.current_record || null)}`,
    'If possible, include source_refs on each operation using the provided source indexes.',
    'source_refs format: [{ source_index: number, quote?: string }]. Keep quotes short and only when directly supported.',
    `Extraction source catalog: ${JSON.stringify(sourceCatalog)}`
  ].join('\n');
}

function buildLiveIngestSourceCatalog(docs) {
  return (Array.isArray(docs) ? docs : []).map((doc, index) => ({
    source_index: index,
    name: doc?.name || `Source ${index + 1}`,
    source_kind: doc?.source_kind || 'text',
    source_image_name: doc?.metadata?.source_image_name || null,
    ocr_confidence: doc?.metadata?.ocr_confidence || null
  }));
}

function parseLiveIngestProposal(raw, domainKey, options = {}) {
  const text = String(raw || '').trim();
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('The AI response did not include valid JSON.');
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The AI response JSON was empty.');
  }
  parsed.summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  parsed.notes_for_user = Array.isArray(parsed.notes_for_user) ? parsed.notes_for_user : [];
  parsed.missing_information = Array.isArray(parsed.missing_information) ? parsed.missing_information : [];
  const lowConfidenceOcrSources = Array.isArray(options.lowConfidenceOcrSources) ? options.lowConfidenceOcrSources : [];
  const hasLowConfidenceOcr = lowConfidenceOcrSources.length > 0;
  const extractionDocs = Array.isArray(options.extractionDocs) ? options.extractionDocs : [];
  if (hasLowConfidenceOcr) {
    parsed.notes_for_user.unshift(`Low-confidence OCR was part of this extraction: ${lowConfidenceOcrSources.join(', ')}`);
  }
  parsed.operations = Array.isArray(parsed.operations) ? parsed.operations.filter((op) => {
    if (!op || typeof op !== 'object' || !op.kind) return false;
    if (op.kind === 'bridge') return !!op.action;
    return op.target_source === domainKey && LIVE_INGEST_ALLOWED_TABLES[domainKey].includes(op.table);
  }).map((op) => ({
    ...op,
    _lowConfidenceOcr: hasLowConfidenceOcr,
    _sourceLineage: deriveLiveIngestOperationSourceLineage(op, extractionDocs),
    source_refs: normalizeLiveIngestSourceRefs(op.source_refs, extractionDocs)
  })) : [];
  parsed.operations = parsed.operations.map((op) => ({
    ...op,
    _sourceLineage: deriveLiveIngestDisplayLineage(op, extractionDocs),
    _citationRisk: hasLowConfidenceOcr && (!Array.isArray(op.source_refs) || !op.source_refs.length)
  }));
  return parsed;
}

function normalizeLiveIngestSourceRefs(sourceRefs, extractionDocs) {
  const docs = Array.isArray(extractionDocs) ? extractionDocs : [];
  return (Array.isArray(sourceRefs) ? sourceRefs : [])
    .map((ref) => {
      const idx = Number(ref?.source_index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= docs.length) return null;
      return {
        source_index: idx,
        quote: String(ref?.quote || '').trim().slice(0, 220)
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

function sortLiveIngestOperationsByConfidence(operations) {
  return (Array.isArray(operations) ? operations.slice() : []).sort((a, b) => {
    const scoreDiff = scoreLiveIngestOperationConfidence(b) - scoreLiveIngestOperationConfidence(a);
    if (scoreDiff) return scoreDiff;
    return String(a?.table || a?.action || '').localeCompare(String(b?.table || b?.action || ''));
  });
}

function scoreLiveIngestOperationConfidence(op) {
  let score = 0;
  if (Array.isArray(op?.source_refs) && op.source_refs.length) score += 40;
  if (op?._sourceLineage?.label === 'Model cited source') score += 20;
  if (op?._sourceLineage?.label === 'Source matched OCR' || op?._sourceLineage?.label === 'Source matched') score += 10;
  if (op?._citationRisk) score -= 50;
  if (op?._lowConfidenceOcr) score -= 10;
  return score;
}

function acknowledgeLiveIngestVisibleRisk(state, visibleIndices) {
  const visibleSet = new Set(Array.isArray(visibleIndices) ? visibleIndices : []);
  const selectedOps = (state?.proposal?.operations || []).map((op, idx) => ({ op, idx })).filter(({ op }) => op?._selected !== false);
  const selectedVisible = selectedOps.filter(({ idx }) => visibleSet.has(idx));
  const selectedOutside = selectedOps.filter(({ idx }) => !visibleSet.has(idx));
  if (!selectedVisible.length) return;
  if (selectedVisible.some(({ op }) => op?._lowConfidenceOcr) && !selectedOutside.some(({ op }) => op?._lowConfidenceOcr)) {
    state.lowConfidenceOcrAcknowledged = true;
  }
  if (selectedVisible.some(({ op }) => op?._citationRisk) && !selectedOutside.some(({ op }) => op?._citationRisk)) {
    state.citationRiskAcknowledged = true;
  }
  if (selectedVisible.some(({ op }) => op?._worsenedRetryRisk) && !selectedOutside.some(({ op }) => op?._worsenedRetryRisk)) {
    state.worsenedRetryAcknowledged = true;
  }
}

function filterLiveIngestOperationsByTrust(operations, filterMode = 'all') {
  const list = Array.isArray(operations) ? operations : [];
  if (filterMode === 'high') return list.filter((op) => scoreLiveIngestOperationConfidence(op) >= 60);
  if (filterMode === 'medium') return list.filter((op) => {
    const score = scoreLiveIngestOperationConfidence(op);
    return score >= 20 && score < 60;
  });
  if (filterMode === 'cited') return list.filter((op) => Array.isArray(op?.source_refs) && op.source_refs.length);
  if (filterMode === 'uncited') return list.filter((op) => !!op?._citationRisk);
  if (filterMode === 'low_ocr') return list.filter((op) => !!op?._lowConfidenceOcr);
  if (filterMode === 'review') return list.filter((op) => scoreLiveIngestOperationConfidence(op) < 20);
  return list;
}

function filterLiveIngestOperationIndexesByTrust(operations, filterMode = 'all') {
  return (Array.isArray(operations) ? operations : [])
    .map((op, idx) => ({ op, idx }))
    .filter(({ op }) => {
      const score = scoreLiveIngestOperationConfidence(op);
      if (filterMode === 'high') return score >= 60;
      if (filterMode === 'medium') return score >= 20 && score < 60;
      if (filterMode === 'cited') return Array.isArray(op?.source_refs) && op.source_refs.length;
      if (filterMode === 'uncited') return !!op?._citationRisk;
      if (filterMode === 'low_ocr') return !!op?._lowConfidenceOcr;
      if (filterMode === 'review') return score < 20;
      return true;
    })
    .map(({ idx }) => idx);
}

function renderLiveIngestTrustFilterBar(domainKey, filterMode, visibleCount, totalCount) {
  const current = String(filterMode || 'all');
  const options = [
    { key: 'all', label: 'All' },
    { key: 'high', label: 'High Trust' },
    { key: 'medium', label: 'Medium Trust' },
    { key: 'cited', label: 'Cited Only' },
    { key: 'uncited', label: 'Uncited Only' },
    { key: 'low_ocr', label: 'Low OCR Only' },
    { key: 'review', label: 'Needs Review' }
  ];
  return `<div class="live-ingest-trust-filters">
    <span class="live-ingest-retry-label">View</span>
    ${options.map((option) => `<button class="live-ingest-inline-btn ${current === option.key ? 'active' : ''}" type="button" data-live-ingest-trust-filter="${domainKey}:${option.key}">${esc(option.label)}</button>`).join('')}
    <span class="live-ingest-trust-count">${esc(`${visibleCount} of ${totalCount}`)}</span>
  </div>`;
}

function scoreLiveIngestProvenanceEntry(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  let score = 0;
  if (entry.refs) score += 60;
  if (/source matched ocr/i.test(String(entry.lineage || ''))) score += 25;
  else if (/source matched/i.test(String(entry.lineage || ''))) score += 20;
  else if (entry.lineage) score += 10;
  return score;
}

function getLiveIngestTrustBadge(score) {
  if (score >= 60) return { label: 'High trust', tone: 'ok' };
  if (score >= 20) return { label: 'Medium trust', tone: '' };
  return { label: 'Needs review', tone: 'warn' };
}

function deriveLiveIngestDisplayLineage(op, extractionDocs) {
  if (Array.isArray(op?.source_refs) && op.source_refs.length) {
    const docs = Array.isArray(extractionDocs) ? extractionDocs : [];
    const refs = op.source_refs
      .map((ref) => {
        const doc = docs[ref.source_index];
        if (!doc) return null;
        const sourceName = String(doc.metadata?.source_image_name || doc.name || `Source ${ref.source_index + 1}`).trim();
        const confidence = String(doc.metadata?.ocr_confidence || '').toLowerCase();
        return {
          sourceName,
          confidence,
          quote: ref.quote || ''
        };
      })
      .filter(Boolean);
    if (refs.length) {
      const first = refs[0];
      return {
        label: 'Model cited source',
        detail: `Model-cited source: ${first.sourceName}${first.confidence ? ` | OCR confidence: ${first.confidence}` : ''}${first.quote ? ` | Quote: ${first.quote}` : ''}`,
        source_name: first.sourceName,
        source_kind: 'model_citation',
        ocr_confidence: first.confidence || null,
        evidence: first.quote || ''
      };
    }
  }
  return deriveLiveIngestOperationSourceLineage(op, extractionDocs);
}

function deriveLiveIngestOperationSourceLineage(op, extractionDocs) {
  const docs = (Array.isArray(extractionDocs) ? extractionDocs : []).filter((doc) => doc && doc.normalized_text);
  if (!docs.length) return null;
  const opText = buildLiveIngestOperationSearchText(op);
  if (!opText) return null;
  const opTokens = tokenizeLiveIngestText(opText);
  if (!opTokens.length) return null;
  let bestDoc = null;
  let bestScore = 0;
  docs.forEach((doc) => {
    const docTokens = tokenizeLiveIngestText(String(doc.normalized_text || '').slice(0, 4000));
    if (!docTokens.length) return;
    const docSet = new Set(docTokens);
    let overlap = 0;
    opTokens.forEach((token) => {
      if (docSet.has(token)) overlap += token.length > 8 ? 2 : 1;
    });
    if (overlap > bestScore) {
      bestScore = overlap;
      bestDoc = doc;
    }
  });
  if (!bestDoc || bestScore < 2) return null;
  const sourceKind = String(bestDoc.source_kind || 'text');
  const sourceName = String(bestDoc.metadata?.source_image_name || bestDoc.name || 'source').trim();
  const confidence = String(bestDoc.metadata?.ocr_confidence || '').toLowerCase();
  const label = sourceKind === 'ocr' ? 'Source matched OCR' : 'Source matched';
  const evidence = extractLiveIngestEvidenceSnippet(String(bestDoc.normalized_text || ''), opTokens);
  const detailBits = [sourceName];
  if (confidence) detailBits.push(`OCR confidence: ${confidence}`);
  return {
    label,
    detail: `Most likely source: ${detailBits.join(' | ')}`,
    source_name: sourceName,
    source_kind: sourceKind,
    ocr_confidence: confidence || null,
    score: bestScore,
    evidence
  };
}

function buildLiveIngestOperationSearchText(op) {
  const parts = [
    op?.table,
    op?.action,
    op?.reason,
    JSON.stringify(op?.fields || {}),
    JSON.stringify(op?.payload || {})
  ].filter(Boolean);
  return parts.join(' ');
}

function tokenizeLiveIngestText(text) {
  const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'your', 'their', 'will', 'have', 'has', 'had', 'are', 'was', 'were', 'but', 'not', 'can', 'could', 'should', 'would', 'about', 'after', 'before', 'table', 'update', 'insert', 'bridge', 'action', 'reason', 'field', 'value', 'null', 'true', 'false']);
  return Array.from(new Set(
    String(text || '')
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g) || []
  )).filter((token) => !STOPWORDS.has(token));
}

function extractLiveIngestEvidenceSnippet(text, tokens) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const searchTokens = (Array.isArray(tokens) ? tokens : []).filter(Boolean).slice(0, 12);
  if (!searchTokens.length) return source.slice(0, 180);
  let bestIndex = -1;
  let bestToken = '';
  searchTokens.forEach((token) => {
    const idx = source.toLowerCase().indexOf(String(token).toLowerCase());
    if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
      bestToken = token;
    }
  });
  if (bestIndex === -1) return source.slice(0, 180);
  const start = Math.max(0, bestIndex - 60);
  const end = Math.min(source.length, bestIndex + Math.max(120, bestToken.length + 80));
  const snippet = source.slice(start, end).trim();
  return `${start > 0 ? '...' : ''}${snippet}${end < source.length ? '...' : ''}`.slice(0, 220);
}

async function applyLiveIngestProposal(domainKey) {
  const state = getLiveIngestState(domainKey);
  const ops = (state.proposal?.operations || []).filter((op) => op._selected !== false);
  if (!ops.length) {
    showToast('Select at least one proposed operation', 'warning');
    return;
  }
  const invalidOp = ops.find((op) => op._parseError);
  if (invalidOp) {
    showToast('Fix invalid JSON in the selected operations before applying', 'error');
    return;
  }
  if (liveIngestHasLowConfidenceOcr(state.extractionDocs || []) && !state.lowConfidenceOcrAcknowledged) {
    showToast('Review and acknowledge the low-confidence OCR transcript before applying', 'warning');
    return;
  }
  if (liveIngestHasCitationRisk(ops || [], false) && !state.citationRiskAcknowledged) {
    showToast('Acknowledge operations without model-cited sources before applying', 'warning');
    return;
  }

  state.applying = true;
  state.error = '';
  rerenderLiveIngestDomain(domainKey);

  const proxyBase = domainKey === 'government' ? '/api/gov-query' : '/api/dia-query';
  const sourceSurface = domainKey === 'government' ? 'gov_live_ingest' : 'dia_live_ingest';
  const effectiveContext = getLiveIngestEffectiveContext(domainKey);

  try {
    for (const op of ops) {
      if (op.kind === 'update') {
        const result = await applyChangeWithFallback({
          proxyBase,
          table: op.table,
          idColumn: op.id_column,
          idValue: op.record_identifier,
          data: op.fields || {},
          source_surface: sourceSurface,
          notes: op.reason || state.notes || null,
          propagation_scope: op.propagation_scope || 'live_ingest',
          matchFilters: Array.isArray(op.match_filters) ? op.match_filters : []
        });
        if (!result.ok) throw new Error((result.errors || []).join(', ') || `Failed to update ${op.table}`);
      } else if (op.kind === 'insert') {
        const result = await applyInsertWithFallback({
          proxyBase,
          table: op.table,
          idColumn: op.id_column || null,
          recordIdentifier: op.record_identifier || null,
          data: op.fields || {},
          source_surface: sourceSurface,
          notes: op.reason || state.notes || null,
          propagation_scope: op.propagation_scope || 'live_ingest'
        });
        if (!result.ok) throw new Error((result.errors || []).join(', ') || `Failed to insert ${op.table}`);
      } else if (op.kind === 'bridge') {
        await canonicalBridge(op.action, op.payload || {});
      }
    }

    await logLiveIngestProvenance({
      domainKey,
      proxyBase,
      sourceSurface,
      state,
      effectiveContext,
      appliedCount: ops.length,
      appliedOps: ops
    });

    state.lastAppliedAt = new Date().toLocaleString();
    showToast(`Applied ${ops.length} ingest operation${ops.length === 1 ? '' : 's'}`, 'success');
    if (domainKey === 'government') {
      await loadGovData();
    } else {
      await loadDiaData();
    }
  } catch (err) {
    state.error = err.message || 'Failed to apply proposed changes';
    showToast(state.error, 'error');
  } finally {
    state.applying = false;
    rerenderLiveIngestDomain(domainKey);
  }
}

async function logLiveIngestProvenance({ domainKey, proxyBase, sourceSurface, state, effectiveContext, appliedCount, appliedOps }) {
  const record = effectiveContext?.current_record || {};
  const notes = buildLiveIngestProvenanceNotes(state, effectiveContext, appliedCount, appliedOps);
  const payload = {
    queue_type: 'live_ingest',
    status: 'applied',
    notes,
    assigned_at: new Date().toISOString()
  };

  if (record.property_id != null && record.property_id !== '') {
    payload.selected_property_id = record.property_id;
  }
  if (domainKey === 'dialysis' && (record.clinic_id != null && record.clinic_id !== '')) {
    payload.clinic_id = record.clinic_id;
  }

  // Provenance should never block the underlying writeback flow.
  try {
    await applyInsertWithFallback({
      proxyBase,
      table: 'research_queue_outcomes',
      idColumn: domainKey === 'dialysis' ? 'clinic_id' : 'selected_property_id',
      recordIdentifier: domainKey === 'dialysis'
        ? (payload.clinic_id != null ? payload.clinic_id : null)
        : (payload.selected_property_id != null ? payload.selected_property_id : null),
      data: payload,
      source_surface: sourceSurface,
      notes: 'Automatic live ingest provenance log',
      propagation_scope: 'research_queue_outcome'
    });
  } catch (err) {
    console.error('Live ingest provenance log failed:', err);
  }
}

function buildLiveIngestProvenanceNotes(state, effectiveContext, appliedCount, appliedOps) {
  const record = effectiveContext?.current_record || {};
  const attachmentNames = (state.attachments || []).map((item) => item.name || item.kind || 'attachment').slice(0, 8);
  const fieldProvenance = buildLiveIngestFieldProvenanceSummary(appliedOps, state.extractionDocs || []);
  const bits = [
    '[live_ingest]',
    state.sourceLabel ? `source=${state.sourceLabel}` : null,
    `applied_ops=${appliedCount}`,
    state.proposal?.summary ? `summary=${state.proposal.summary}` : null,
    attachmentNames.length ? `attachments=${attachmentNames.join(', ')}` : null,
    record.lead_id ? `lead_id=${record.lead_id}` : null,
    record.ownership_id ? `ownership_id=${record.ownership_id}` : null,
    record.property_id ? `property_id=${record.property_id}` : null,
    record.clinic_id ? `clinic_id=${record.clinic_id}` : null,
    state.notes ? `notes=${state.notes}` : null,
    fieldProvenance ? `field_provenance=${fieldProvenance}` : null
  ].filter(Boolean);
  return bits.join(' | ').slice(0, 4000);
}

function buildLiveIngestFieldProvenanceSummary(appliedOps, extractionDocs) {
  const docs = Array.isArray(extractionDocs) ? extractionDocs : [];
  const summaries = (Array.isArray(appliedOps) ? appliedOps : [])
    .slice(0, 12)
    .map((op) => buildLiveIngestOperationProvenanceSummary(op, docs))
    .filter(Boolean);
  if (!summaries.length) return '';
  return summaries.join(' || ').slice(0, 1800);
}

function buildLiveIngestOperationProvenanceSummary(op, extractionDocs) {
  if (!op || typeof op !== 'object') return '';
  const target = op.kind === 'bridge'
    ? `bridge:${String(op.action || 'action')}`
    : `${String(op.kind || 'op')}:${String(op.table || 'table')}`;
  const fieldNames = Object.keys(op.kind === 'bridge' ? (op.payload || {}) : (op.fields || {}))
    .filter(Boolean)
    .slice(0, 8);
  const refs = Array.isArray(op.source_refs) ? op.source_refs : [];
  const refSummary = refs.slice(0, 2).map((ref) => {
    const doc = extractionDocs[ref.source_index];
    const label = String(doc?.metadata?.source_image_name || doc?.name || `source_${Number(ref.source_index) + 1}`).trim();
    const quote = String(ref?.quote || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return quote ? `${label}:"${quote}"` : label;
  }).filter(Boolean).join(',');
  const lineage = !refSummary && op._sourceLineage
    ? `${String(op._sourceLineage.source_name || op._sourceLineage.label || 'source').trim()}${op._sourceLineage.evidence ? `:"${String(op._sourceLineage.evidence).replace(/\s+/g, ' ').trim().slice(0, 80)}"` : ''}`
    : '';
  const flags = [];
  if (op._citationRisk || !refSummary) flags.push('uncited');
  if (op._lowConfidenceOcr || String(op?._sourceLineage?.ocr_confidence || '').toLowerCase() === 'low') flags.push('low_ocr');
  const bits = [
    target,
    fieldNames.length ? `fields=${fieldNames.join(',')}` : '',
    refSummary ? `refs=${refSummary}` : '',
    lineage ? `lineage=${lineage}` : '',
    flags.length ? `flags=${flags.join(',')}` : ''
  ].filter(Boolean);
  return bits.join('|');
}

function parseLiveIngestOutcomeNotes(notes) {
  const text = String(notes || '').trim();
  if (!text.includes('[live_ingest]')) return null;
  const segments = text.split(' | ').map((part) => String(part || '').trim()).filter(Boolean);
  const parsed = {
    raw: text,
    fieldProvenance: []
  };
  segments.forEach((segment) => {
    if (segment === '[live_ingest]') return;
    const idx = segment.indexOf('=');
    if (idx === -1) return;
    const key = segment.slice(0, idx).trim();
    const value = segment.slice(idx + 1).trim();
    if (!key) return;
    if (key === 'field_provenance') {
      parsed.fieldProvenance = value
        .split(' || ')
        .map((item) => item.trim())
        .filter(Boolean)
        .map(parseLiveIngestFieldProvenanceEntry)
        .filter(Boolean);
      return;
    }
    parsed[key] = value;
  });
  return parsed;
}

function parseLiveIngestFieldProvenanceEntry(entryText) {
  const parts = String(entryText || '').split('|').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const entry = { target: parts[0], fields: [], refs: '', lineage: '', flags: [] };
  parts.slice(1).forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 'fields') entry.fields = value.split(',').map((field) => field.trim()).filter(Boolean);
    else if (key === 'refs') entry.refs = value;
    else if (key === 'lineage') entry.lineage = value;
    else if (key === 'flags') entry.flags = value.split(',').map((flag) => flag.trim()).filter(Boolean);
  });
  if (!entry.flags.length) {
    if (!entry.refs) entry.flags.push('uncited');
    if (/ocr confidence:\s*low/i.test(String(entry.lineage || ''))) entry.flags.push('low_ocr');
  }
  return entry;
}

function renderLiveIngestOutcomeProvenance(parsed, options = {}) {
  if (!parsed?.fieldProvenance?.length) return '';
  const limit = Number.isInteger(options.limit) ? options.limit : 6;
  const filterMode = String(options.filterMode || window._liveIngestHistoryTrustFilter || 'all');
  const filteredEntries = filterLiveIngestProvenanceEntries(parsed.fieldProvenance, filterMode);
  const rows = parsed.fieldProvenance
    .slice()
    .sort((a, b) => {
      const diff = scoreLiveIngestProvenanceEntry(b) - scoreLiveIngestProvenanceEntry(a);
      if (diff) return diff;
      return String(a?.target || '').localeCompare(String(b?.target || ''));
    })
    .filter((entry) => filteredEntries.includes(entry))
    .slice(0, limit)
    .map((entry) => {
      const source = entry.refs || entry.lineage || '';
      const trust = getLiveIngestTrustBadge(scoreLiveIngestProvenanceEntry(entry));
      return `<div class="live-ingest-history-row">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
          <strong>${esc(entry.target || 'operation')}</strong>
          <span class="live-ingest-op-flag ${trust.tone}">${esc(trust.label)}</span>
        </div>
        ${entry.fields?.length ? `<span>${esc(entry.fields.join(', '))}</span>` : ''}
        ${source ? `<div class="live-ingest-history-source">${esc(source)}</div>` : ''}
      </div>`;
    }).join('');
  return `<div class="live-ingest-history-block">
    ${renderLiveIngestHistoryTrustFilterBar(filterMode, filteredEntries.length, parsed.fieldProvenance.length)}
    <div class="live-ingest-history-list">${rows}</div>
  </div>`;
}

function filterLiveIngestProvenanceEntries(entries, filterMode = 'all') {
  const list = Array.isArray(entries) ? entries : [];
  if (filterMode === 'high') return list.filter((entry) => scoreLiveIngestProvenanceEntry(entry) >= 60);
  if (filterMode === 'medium') return list.filter((entry) => {
    const score = scoreLiveIngestProvenanceEntry(entry);
    return score >= 20 && score < 60;
  });
  if (filterMode === 'cited') return list.filter((entry) => !!entry?.refs);
  if (filterMode === 'uncited') return list.filter((entry) => Array.isArray(entry?.flags) && entry.flags.includes('uncited'));
  if (filterMode === 'low_ocr') return list.filter((entry) => Array.isArray(entry?.flags) && entry.flags.includes('low_ocr'));
  if (filterMode === 'review') return list.filter((entry) => scoreLiveIngestProvenanceEntry(entry) < 20);
  return list;
}

function renderLiveIngestHistoryTrustFilterBar(filterMode, visibleCount, totalCount) {
  const current = String(filterMode || 'all');
  const options = [
    { key: 'all', label: 'All' },
    { key: 'high', label: 'High Trust' },
    { key: 'medium', label: 'Medium Trust' },
    { key: 'cited', label: 'Cited Only' },
    { key: 'uncited', label: 'Uncited Only' },
    { key: 'low_ocr', label: 'Low OCR Only' },
    { key: 'review', label: 'Needs Review' }
  ];
  return `<div class="live-ingest-trust-filters">
    <span class="live-ingest-retry-label">Field Provenance</span>
    ${options.map((option) => `<button class="live-ingest-inline-btn ${current === option.key ? 'active' : ''}" type="button" onclick="setLiveIngestHistoryTrustFilter('${option.key}')">${esc(option.label)}</button>`).join('')}
    <span class="live-ingest-trust-count">${esc(`${visibleCount} of ${totalCount}`)}</span>
  </div>`;
}

function setLiveIngestHistoryTrustFilter(filterMode) {
  window._liveIngestHistoryTrustFilter = String(filterMode || 'all');
  if (window._detailRecord && window._detailSource) {
    if (typeof showDetail === 'function') showDetail(window._detailRecord, window._detailSource);
  }
}

window.renderLiveIngestWorkbench = renderLiveIngestWorkbench;
window.bindLiveIngestWorkbench = bindLiveIngestWorkbench;
window.parseLiveIngestOutcomeNotes = parseLiveIngestOutcomeNotes;
window.renderLiveIngestOutcomeProvenance = renderLiveIngestOutcomeProvenance;

// === Export Comps to Excel (Briggs CRE Template) ===
function exportCompsToXlsx(data, type) {
  if (typeof XLSX === 'undefined') { showToast('Excel export library not loaded yet — please try again', 'error'); return; }
  if (!data || data.length === 0) { showToast('No data to export', 'error'); return; }

  var sheetName = type === 'lease' ? 'Lease Comps' : 'Sales Comps';
  var fileType = type === 'lease' ? 'Lease' : 'Sales';

  var rows = data.map(function(r) {
    return {
      'Address': r.address || '',
      'City': r.city || '',
      'State': r.state || '',
      'Sale Date': r.sold_date || r.sale_date || '',
      'Sale Price': r.price || r.sale_price || r.ask_price || null,
      'Price/SF': r.price_psf || r.price_per_sf || null,
      'Cap Rate': r.cap_rate || r.ask_cap || null,
      'SF': r.rba || r.building_sf || r.sf || null,
      'Year Built': r.year_built || null,
      'Buyer': r.buyer || r.buyer_name || '',
      'Seller': r.seller || r.seller_name || '',
      'Tenant': r.agency || r.tenant_operator || r.tenant || r.tenant_name || '',
      'Property Type': r.property_type || '',
      'Source': r.source || r.data_source || ''
    };
  });

  var ws = XLSX.utils.json_to_sheet(rows);

  // Column widths for readability
  ws['!cols'] = [
    { wch: 30 }, // Address
    { wch: 15 }, // City
    { wch: 8 },  // State
    { wch: 12 }, // Sale Date
    { wch: 15 }, // Sale Price
    { wch: 12 }, // Price/SF
    { wch: 10 }, // Cap Rate
    { wch: 10 }, // SF
    { wch: 10 }, // Year Built
    { wch: 25 }, // Buyer
    { wch: 25 }, // Seller
    { wch: 25 }, // Tenant
    { wch: 15 }, // Property Type
    { wch: 15 }  // Source
  ];

  // Apply number formats to data cells
  var range = XLSX.utils.decode_range(ws['!ref']);
  for (var R = range.s.r + 1; R <= range.e.r; R++) {
    // Sale Price (col 4) — currency
    var priceCell = ws[XLSX.utils.encode_cell({ r: R, c: 4 })];
    if (priceCell && typeof priceCell.v === 'number') { priceCell.t = 'n'; priceCell.z = '$#,##0'; }
    // Price/SF (col 5) — currency
    var psfCell = ws[XLSX.utils.encode_cell({ r: R, c: 5 })];
    if (psfCell && typeof psfCell.v === 'number') { psfCell.t = 'n'; psfCell.z = '$#,##0.00'; }
    // Cap Rate (col 6) — percentage
    var capCell = ws[XLSX.utils.encode_cell({ r: R, c: 6 })];
    if (capCell && typeof capCell.v === 'number') { capCell.t = 'n'; capCell.z = '0.00%'; }
    // SF (col 7) — comma-separated number
    var sfCell = ws[XLSX.utils.encode_cell({ r: R, c: 7 })];
    if (sfCell && typeof sfCell.v === 'number') { sfCell.t = 'n'; sfCell.z = '#,##0'; }
  }

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  var today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'LCC_' + fileType + '_Comps_' + today + '.xlsx');
  showToast('Exported ' + data.length + ' records to Excel', 'success');
}
window.exportCompsToXlsx = exportCompsToXlsx;

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
