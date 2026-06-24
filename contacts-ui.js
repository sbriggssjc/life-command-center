// ============================================================
// CONTACTS UI — Unified Contact Hub frontend
// Life Command Center
//
// Renders the Contacts page with:
//   - Contact list with search, filters, pagination
//   - Contact detail slide panel with engagement badges
//   - Inline messaging (Teams/WebEx/SMS tabs)
//   - Merge queue review panel
//   - Data quality widget
// ============================================================

// ---- State ----
let _cui = {
  contacts: [],
  total: 0,
  offset: 0,
  limit: 40,
  search: '',
  classFilter: 'business',
  orderBy: 'engagement_score.desc',
  minEngagement: 0,
  loading: false,
  loaded: false,
  // Detail state
  selectedContact: null,
  selectedSources: [],
  selectedEngagement: null,
  selectedHistory: [],
  detailTab: 'overview',
  // Messaging state
  messages: [],
  messagesLoading: false,
  messageChannel: 'teams',
  messageText: '',
  // Merge queue
  mergeQueue: [],
  mergeQueueTotal: 0,
  // Data quality
  dataQuality: null,
  // UI Phase 5 — "Owners Missing a Contact" BD worklist
  worklist: [],
  worklistActionable: 0,
  worklistUniverse: 0,
  worklistMinValue: 1000000,   // default to the workable ≥$1M set; toggle = show all
  worklistLimit: 50,
  worklistLoading: false,
  worklistLoaded: false,
  // Sub-tab — the page LEADS with the owner BD worklist (its primary job)
  subTab: 'worklist'  // 'worklist' | 'list' | 'hot_leads' | 'merge_queue' | 'data_quality'
};

// ---- API helpers ----
async function contactsApi(method, action, params = {}, body = null) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (LCC_USER.workspace_id) opts.headers['x-lcc-workspace'] = LCC_USER.workspace_id;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api/contacts?${qs}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ---- Main page render ----
function renderContactsPage() {
  // The worklist tab loads from a different endpoint than the contacts list.
  if (_cui.subTab === 'worklist') {
    if (!_cui.worklistLoaded && !_cui.worklistLoading) {
      loadOwnersWorklist();
      return; // loadOwnersWorklist re-renders when done
    }
  } else if (!_cui.loaded && !_cui.loading) {
    loadContactsList();
    return; // loadContactsList will call renderContactsPage when done
  }
  const el = document.getElementById('contactsContent');
  if (!el) return;
  el.innerHTML = buildContactsPage();
  bindContactsEvents();
}

// Single source of truth for the sub-tab bar (reused by the spinner states).
function ucTabsBar() {
  let h = '<div class="uc-tabs">';
  h += ucTab('worklist', 'Owners Missing a Contact');
  h += ucTab('list', 'All Contacts');
  h += ucTab('hot_leads', 'Hot Leads');
  h += ucTab('merge_queue', 'Merge Queue');
  h += ucTab('data_quality', 'Data Quality');
  h += '</div>';
  return h;
}

function buildContactsPage() {
  let h = ucTabsBar();

  switch (_cui.subTab) {
    case 'worklist':   h += buildOwnersWorklist(); break;
    case 'list':       h += buildContactsList(); break;
    case 'hot_leads':  h += buildContactsList(); break;
    case 'merge_queue': h += buildMergeQueue(); break;
    case 'data_quality': h += buildDataQuality(); break;
  }

  return h;
}

function ucTab(id, label) {
  const active = _cui.subTab === id ? ' uc-tab-active' : '';
  return `<button class="uc-tab${active}" onclick="switchContactsTab('${id}')">${esc(label)}</button>`;
}

function switchContactsTab(tab) {
  _cui.subTab = tab;
  if (tab === 'worklist' && !_cui.worklistLoaded) loadOwnersWorklist();
  if (tab === 'merge_queue' && _cui.mergeQueue.length === 0) loadMergeQueue();
  if (tab === 'data_quality' && !_cui.dataQuality) loadDataQuality();
  if (tab === 'hot_leads' && _cui.orderBy !== 'engagement_score.desc') {
    _cui.orderBy = 'engagement_score.desc';
    _cui.minEngagement = 1;
    _cui.offset = 0;
    loadContactsList();
  }
  if (tab === 'list' && _cui.minEngagement > 0) {
    _cui.minEngagement = 0;
    _cui.offset = 0;
    loadContactsList();
  }
  renderContactsPage();
}

// ============================================================
// OWNERS MISSING A CONTACT — value-ranked BD worklist (UI Phase 5)
//
// Surfaces valued owners (current portfolio rollup rent > 0) with no one to call
// (no linked person, no Salesforce Contact). Value-gated, value-ranked, capped,
// honest counts. Each row opens the 4B owner detail Contacts tab where the
// EXISTING CONTACT-SELECTION picker (acquire CTA) lives — no duplicate engine.
// Acquiring/linking a contact retires the owner from the worklist (the view
// drops it on the next read).
// ============================================================

async function loadOwnersWorklist() {
  _cui.worklistLoading = true;
  const el = document.getElementById('contactsContent');
  if (el) el.innerHTML = ucTabsBar() + '<div class="loading"><span class="spinner"></span></div>';
  try {
    const params = { action: 'owner_worklist', limit: _cui.worklistLimit };
    if (_cui.worklistMinValue > 0) params.min_value = _cui.worklistMinValue;
    const qs = new URLSearchParams(params).toString();
    const opts = { headers: { 'Content-Type': 'application/json' } };
    if (LCC_USER.workspace_id) opts.headers['x-lcc-workspace'] = LCC_USER.workspace_id;
    const res = await fetch(`/api/entities?${qs}`, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    const data = await res.json();
    _cui.worklist = data.rows || [];
    _cui.worklistActionable = data.actionable_count || 0;
    _cui.worklistUniverse = data.universe_count || 0;
    _cui.worklistLoaded = true;
  } catch (e) {
    console.error('Failed to load owner worklist:', e);
    if (typeof showToast === 'function') showToast('Failed to load worklist: ' + e.message, 'error');
    _cui.worklist = [];
  }
  _cui.worklistLoading = false;
  renderContactsPage();
}

function buildOwnersWorklist() {
  const showingAll = _cui.worklistMinValue <= 0;
  let h = '';

  // Header + honest counts + scope toggle
  h += '<div class="uc-filters">';
  h += `<div class="uc-section-header" style="margin:0 0 4px">Owners Missing a Contact</div>`;
  h += `<div class="uc-card-meta" style="margin-bottom:8px">Valued owners with no one to call — value-ranked. Open one to pick a contact; that retires the row.</div>`;
  h += '<div class="uc-filter-row">';
  const label = showingAll ? 'owners need a contact' : 'valued owners ≥ $1M need a contact';
  const total = _cui.worklistUniverse ? ` · ${_cui.worklistUniverse.toLocaleString()} total contactless` : '';
  h += `<span class="uc-count">${(_cui.worklistActionable || 0).toLocaleString()} ${label}${total}</span>`;
  h += `<button class="btn-cancel" onclick="toggleWorklistScope()">${showingAll ? 'Show ≥ $1M only' : 'Show all'}</button>`;
  h += '</div></div>';

  if (_cui.worklistLoading) {
    h += '<div class="loading"><span class="spinner"></span></div>';
    return h;
  }
  if (_cui.worklist.length === 0) {
    h += '<div class="uc-empty">No owners missing a contact in this range.</div>';
    return h;
  }

  h += '<div class="uc-list">';
  _cui.worklist.forEach(o => { h += buildWorklistCard(o); });
  h += '</div>';

  if (_cui.worklist.length < (_cui.worklistActionable || 0)) {
    h += `<div class="uc-pagination"><span>Showing top ${_cui.worklist.length} of ${(_cui.worklistActionable || 0).toLocaleString()}</span></div>`;
  }
  return h;
}

function buildWorklistCard(o) {
  const val = (o.rank_value != null && Number(o.rank_value) > 0)
    ? '$' + Math.round(Number(o.rank_value)).toLocaleString() : '—';
  const pc = Number(o.property_count) || 0;
  const props = pc ? `${pc} propert${pc === 1 ? 'y' : 'ies'}` : '';
  const dom = (o.primary_domain || '').toUpperCase();
  const xv = o.is_cross_vertical ? 'cross-vertical' : '';
  const meta = [dom, xv, props].filter(Boolean).join(' · ');
  return `<div class="uc-card" onclick="openWorklistOwner(decodeURIComponent('${encodeURIComponent(o.entity_id)}'))">
    <div class="uc-card-center">
      <div class="uc-card-name">${esc(o.owner_name || 'Unnamed owner')}</div>
      <div class="uc-card-meta">${esc(meta)}</div>
      <div class="uc-card-badges">${worklistHint(o)}</div>
    </div>
    <div class="uc-card-right">
      <div class="uc-score uc-heat-hot">${val}</div>
      <div class="uc-card-activity">portfolio value</div>
    </div>
  </div>`;
}

function worklistHint(o) {
  const map = {
    sos_manager_lookup: 'SOS manager lookup',
    address_reverse_lookup: 'Address reverse lookup',
    public_company_ir: 'Public-company IR',
    find_person_at_manager: 'Find person at manager',
    parse_deed_signatory: 'Deed signatory',
    manual_research: 'Manual research'
  };
  const a = o.enrichment_action;
  const label = (a && map[a]) ? map[a] : 'Select contact →';
  const title = (a && map[a]) ? 'Suggested enrichment' : 'Open to acquire a contact';
  return `<span class="uc-src-badge" style="background:var(--accent);color:#fff" title="${esc(title)}">${esc(label)}</span>`;
}

// Open the 4B owner detail on the Contacts tab — where the existing
// CONTACT-SELECTION acquire CTA lives. Mark the worklist stale so it re-reads
// (and retires the row) when the operator returns.
function openWorklistOwner(entityId) {
  _cui.worklistLoaded = false;
  if (typeof openEntityDetail === 'function') {
    openEntityDetail(entityId, 'Contacts');
  } else if (typeof showToast === 'function') {
    showToast('Owner detail is unavailable here', 'error');
  }
}
if (typeof window !== 'undefined') window.openWorklistOwner = openWorklistOwner;

function toggleWorklistScope() {
  _cui.worklistMinValue = _cui.worklistMinValue > 0 ? 0 : 1000000;
  _cui.worklistLoaded = false;
  loadOwnersWorklist();
}
if (typeof window !== 'undefined') window.toggleWorklistScope = toggleWorklistScope;

// ============================================================
// CONTACTS LIST
// ============================================================

function buildContactsList() {
  let h = '';

  // Search + filters bar
  h += '<div class="uc-filters">';
  h += `<div class="search-bar">`;
  h += `<input type="text" id="ucSearchInput" placeholder="Search name, email, company, phone..." value="${esc(_cui.search)}" />`;
  h += `<button onclick="execContactsSearch()">Search</button>`;
  h += `</div>`;
  h += '<div class="uc-filter-row">';
  h += `<select id="ucClassFilter" onchange="changeContactsClass(this.value)">`;
  h += `<option value="business"${_cui.classFilter === 'business' ? ' selected' : ''}>Business</option>`;
  h += `<option value="personal"${_cui.classFilter === 'personal' ? ' selected' : ''}>Personal</option>`;
  h += `</select>`;
  h += `<select id="ucOrderBy" onchange="changeContactsOrder(this.value)">`;
  h += orderOpt('engagement_score.desc', 'Engagement (High)');
  h += orderOpt('updated_at.desc', 'Recently Updated');
  h += orderOpt('full_name.asc', 'Name (A-Z)');
  h += orderOpt('company_name.asc', 'Company (A-Z)');
  h += orderOpt('last_activity_date.desc.nullslast', 'Last Activity');
  h += orderOpt('total_touches.desc', 'Most Touches');
  h += `</select>`;
  h += `<span class="uc-count">${_cui.total != null ? _cui.total.toLocaleString() + ' contacts' : ''}</span>`;
  h += '</div>';
  h += '</div>';

  // Loading
  if (_cui.loading) {
    h += '<div class="loading"><span class="spinner"></span></div>';
    return h;
  }

  // Contact cards
  if (_cui.contacts.length === 0) {
    h += '<div class="uc-empty">No contacts found.</div>';
    return h;
  }

  h += '<div class="uc-list">';
  _cui.contacts.forEach(c => {
    h += buildContactCard(c);
  });
  h += '</div>';

  // Pagination
  const totalPages = Math.ceil((_cui.total || 0) / _cui.limit);
  const currentPage = Math.floor(_cui.offset / _cui.limit) + 1;
  if (totalPages > 1) {
    h += '<div class="uc-pagination">';
    if (currentPage > 1) h += `<button onclick="contactsPageNav(${_cui.offset - _cui.limit})">Prev</button>`;
    h += `<span>Page ${currentPage} of ${totalPages}</span>`;
    if (currentPage < totalPages) h += `<button onclick="contactsPageNav(${_cui.offset + _cui.limit})">Next</button>`;
    h += '</div>';
  }

  return h;
}

function orderOpt(val, label) {
  return `<option value="${val}"${_cui.orderBy === val ? ' selected' : ''}>${label}</option>`;
}

function buildContactCard(c) {
  // Estimate engagement from total_touches + last_activity_date when engagement_score is 0
  const rawScore = c.engagement_score || 0;
  const score = rawScore > 0 ? Math.round(rawScore) : estimateEngagement(c);
  const heat = engagementHeat(score);
  const heatClass = `uc-heat-${heat}`;
  const company = c.company_name || '';
  const title = c.title || '';
  const meta = [title, company].filter(Boolean).join(' at ');
  const lastActivity = c.last_activity_date ? relativeDate(c.last_activity_date) : '';
  const touches = c.total_touches || 0;

  // C5 (2026-06-06): a nameless contact should still be identifiable. Fall back
  // to company / email / phone for the display line and flag it with a
  // "needs name" chip instead of rendering bare punctuation ("? / —").
  const hasName = !!((c.full_name && c.full_name.trim())
    || (c.first_name && c.first_name.trim()) || (c.last_name && c.last_name.trim()));
  const fallbackIdent = company || c.email || c.phone || c.mobile_phone || '';
  const builtName = (c.full_name && c.full_name.trim())
    || [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  const displayName = hasName ? builtName : (fallbackIdent || 'Unnamed contact');
  const needsNameChip = hasName ? ''
    : ' <span class="uc-src-badge" style="background:var(--yellow);color:#191919" title="No name on file — from a connector/import">needs name</span>';

  let badges = '';
  if (c.sf_contact_id) badges += '<span class="uc-src-badge uc-src-sf" title="Salesforce">SF</span>';
  if (c.webex_person_id) badges += '<span class="uc-src-badge uc-src-webex" title="WebEx">WX</span>';
  if (c.teams_user_id) badges += '<span class="uc-src-badge uc-src-teams" title="Teams">TM</span>';
  if (c.outlook_contact_id) badges += '<span class="uc-src-badge uc-src-outlook" title="Outlook">OL</span>';

  return `<div class="uc-card" onclick="openContactDetail(decodeURIComponent('${encodeURIComponent(c.unified_id)}'))">
    <div class="uc-card-left">
      <div class="uc-avatar ${heatClass}">${initials(c.first_name, c.last_name)}</div>
    </div>
    <div class="uc-card-center">
      <div class="uc-card-name">${esc(displayName)}${needsNameChip}</div>
      <div class="uc-card-meta">${esc(meta)}</div>
      <div class="uc-card-badges">${badges}</div>
    </div>
    <div class="uc-card-right">
      <div class="uc-score ${heatClass}">${score}</div>
      ${touches > 0 ? `<div class="uc-card-touches">${touches} touch${touches !== 1 ? 'es' : ''}</div>` : ''}
      ${lastActivity ? `<div class="uc-card-activity">${lastActivity}</div>` : ''}
    </div>
  </div>`;
}

function initials(first, last) {
  const f = (first || '?')[0].toUpperCase();
  const l = (last || '')[0]?.toUpperCase() || '';
  return f + l;
}

function engagementHeat(score) {
  if (score >= 60) return 'hot';
  if (score >= 30) return 'warm';
  if (score > 0) return 'cool';
  return 'cold';
}

/** Estimate engagement from total_touches + last_activity_date when the real score is 0 */
function estimateEngagement(c) {
  var score = 0;
  var touches = c.total_touches || 0;
  // Touch frequency (max 40)
  if (touches > 10) score += 40;
  else if (touches > 5) score += 30;
  else if (touches > 2) score += 20;
  else if (touches > 0) score += 10;
  // Recency (max 35)
  if (c.last_activity_date) {
    var days = (Date.now() - new Date(c.last_activity_date).getTime()) / 86400000;
    if (days < 7) score += 35;
    else if (days < 30) score += 25;
    else if (days < 90) score += 15;
    else if (days < 365) score += 5;
  }
  // Multi-source bonus (max 15)
  var sources = 0;
  if (c.sf_contact_id) sources++;
  if (c.webex_person_id) sources++;
  if (c.teams_user_id) sources++;
  if (c.outlook_contact_id) sources++;
  if (sources >= 3) score += 15;
  else if (sources >= 2) score += 10;
  else if (sources >= 1) score += 5;
  return Math.min(score, 100);
}

function relativeDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const days = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  // QA-21 (2026-05-18): clamp negative deltas. Sync glitches (Salesforce
  // bridge writing a future modified_date, etc.) produced 12+ "-123d ago"
  // / "-189d ago" displays on the Contacts page. Treat them as "Recent"
  // rather than confusing the operator with a negative day count.
  if (days < 0) return 'Recent';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return days + 'd ago';
  if (days < 30) return Math.floor(days / 7) + 'w ago';
  if (days < 365) return Math.floor(days / 30) + 'mo ago';
  return Math.floor(days / 365) + 'y ago';
}

// ---- List actions ----
async function loadContactsList() {
  _cui.loading = true;
  // Show spinner without re-entering renderContactsPage
  const el = document.getElementById('contactsContent');
  if (el) el.innerHTML = ucTabsBar() + '<div class="loading"><span class="spinner"></span></div>';
  try {
    const params = {
      contact_class: _cui.classFilter,
      limit: _cui.limit,
      offset: _cui.offset,
      order: _cui.orderBy
    };
    if (_cui.search) params.search = _cui.search;
    if (_cui.minEngagement > 0) params.min_engagement = _cui.minEngagement;

    const data = await contactsApi('GET', 'list', params);
    _cui.contacts = data.contacts || [];
    _cui.total = data.total ?? _cui.contacts.length;
    _cui.loaded = true;
  } catch (e) {
    console.error('Failed to load contacts:', e);
    if (typeof showToast === 'function') showToast('Failed to load contacts: ' + e.message, 'error');
    _cui.contacts = [];
  }
  _cui.loading = false;
  renderContactsPage();
}

function execContactsSearch() {
  const input = document.getElementById('ucSearchInput');
  _cui.search = input ? input.value.trim() : '';
  _cui.offset = 0;
  loadContactsList();
}

function changeContactsClass(val) {
  _cui.classFilter = val;
  _cui.offset = 0;
  loadContactsList();
}

function changeContactsOrder(val) {
  _cui.orderBy = val;
  _cui.offset = 0;
  loadContactsList();
}

function contactsPageNav(newOffset) {
  _cui.offset = Math.max(0, newOffset);
  loadContactsList();
}

function _cuiSearchKeydown(e) { if (e.key === 'Enter') execContactsSearch(); }
function bindContactsEvents() {
  const input = document.getElementById('ucSearchInput');
  if (input) {
    input.removeEventListener('keydown', _cuiSearchKeydown);
    input.addEventListener('keydown', _cuiSearchKeydown);
  }
}

// ============================================================
// CONTACT DETAIL — slide panel
// ============================================================

async function openContactDetail(id) {
  // Use the existing detail panel infrastructure
  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');
  if (!panel || !overlay) return;

  // Show loading state
  const cHeaderEl = document.getElementById('detailHeader');
  const cTabsEl = document.getElementById('detailTabs');
  const cBodyEl = document.getElementById('detailBody');
  if (cHeaderEl) cHeaderEl.innerHTML = '<div class="loading" style="padding:20px"><span class="spinner"></span></div>';
  if (cTabsEl) cTabsEl.innerHTML = '';
  if (cBodyEl) cBodyEl.innerHTML = '';
  panel.style.display = 'block';
  overlay.classList.add('open');

  try {
    const data = await contactsApi('GET', 'get', { id });
    _cui.selectedContact = data.contact;
    _cui.selectedSources = data.sources;
    _cui.selectedEngagement = data.engagement;
    _cui.detailTab = 'overview';

    // Also load history in background
    contactsApi('GET', 'history', { id }).then(h => {
      _cui.selectedHistory = h.history || [];
      if (_cui.detailTab === 'history') renderContactDetailBody();
    }).catch(e => console.warn('[Contacts] History load failed:', e.message));

    renderContactDetailFull();
  } catch (e) {
    if (cHeaderEl) cHeaderEl.innerHTML = `<div style="padding:20px;color:var(--red)">Error loading contact: ${esc(e.message)}</div>`;
  }
}

function renderContactDetailFull() {
  const c = _cui.selectedContact;
  if (!c) return;

  const heat = engagementHeat(_cui.selectedEngagement?.score || 0);

  // Header
  let hdr = `<div class="detail-header-info">
    <div class="uc-avatar-lg uc-heat-${heat}">${initials(c.first_name, c.last_name)}</div>
    <div>
      <div class="detail-title">${esc(c.full_name || '—')}</div>
      <div class="detail-subtitle">${esc([c.title, c.company_name].filter(Boolean).join(' at '))}</div>
      <div class="uc-detail-badges">
        <span class="uc-heat-pill uc-heat-${heat}">${heat.toUpperCase()} (${Math.round(_cui.selectedEngagement?.score || 0)})</span>
        <span class="uc-class-pill uc-class-${c.contact_class}">${c.contact_class}</span>
      </div>
    </div>
  </div>`;
  const dHdrEl = document.getElementById('detailHeader');
  if (dHdrEl) dHdrEl.innerHTML =
    `<button class="detail-close" onclick="closeDetail()">&times;</button>` + hdr;

  // Tabs
  const tabs = ['Overview', 'Messages', 'History', 'Edit'];
  let tabsHtml = '';
  tabs.forEach(t => {
    const active = _cui.detailTab === t.toLowerCase() ? ' active' : '';
    tabsHtml += `<button class="detail-tab${active}" onclick="switchContactDetailTab('${t.toLowerCase()}')">${t}</button>`;
  });
  const dTabsEl = document.getElementById('detailTabs');
  if (dTabsEl) dTabsEl.innerHTML = tabsHtml;

  renderContactDetailBody();
}

function switchContactDetailTab(tab) {
  _cui.detailTab = tab;
  // Update tab highlights
  document.querySelectorAll('#detailTabs .detail-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.trim().toLowerCase() === tab);
  });
  if (tab === 'messages' && _cui.messages.length === 0) {
    loadContactMessages();
  }
  renderContactDetailBody();
}

function renderContactDetailBody() {
  const body = document.getElementById('detailBody');
  if (!body) return;

  switch (_cui.detailTab) {
    case 'overview':  body.innerHTML = buildContactOverview(); break;
    case 'messages':  body.innerHTML = buildContactMessages(); break;
    case 'history':   body.innerHTML = buildContactHistory(); break;
    case 'edit':      body.innerHTML = buildContactEdit(); break;
  }
}

// ---- Overview tab ----
function buildContactOverview() {
  const c = _cui.selectedContact;
  const eng = _cui.selectedEngagement;
  if (!c) return '';

  let h = '';

  // Engagement summary
  h += '<div class="detail-section">';
  h += '<div class="detail-section-title">Engagement</div>';
  h += '<div class="detail-grid">';
  h += engagementStat('Score', Math.round(eng?.score || 0), engagementHeat(eng?.score));
  h += engagementStat('Touchpoints', eng?.touchpoint_count || 0);
  h += engagementStat('Calls', eng?.total_calls || 0);
  h += engagementStat('Emails', eng?.total_emails || 0);
  h += engagementStat('Last Call', eng?.last_call ? relativeDate(eng.last_call) : 'Never');
  h += engagementStat('Last Email', eng?.last_email ? relativeDate(eng.last_email) : 'Never');
  h += engagementStat('Last Meeting', eng?.last_meeting ? relativeDate(eng.last_meeting) : 'Never');
  h += '</div></div>';

  // Contact info
  h += '<div class="detail-section">';
  h += '<div class="detail-section-title">Contact Info</div>';
  if (c.email) h += detailRow('Email', `<a href="mailto:${encodeURIComponent(c.email)}">${esc(c.email)}</a>`);
  if (c.email_secondary) h += detailRow('Email 2', esc(c.email_secondary));
  if (c.phone) h += detailRow('Phone', `<a href="tel:${encodeURIComponent(c.phone)}">${esc(c.phone)}</a>`);
  if (c.mobile_phone) h += detailRow('Mobile', `<a href="tel:${encodeURIComponent(c.mobile_phone)}">${esc(c.mobile_phone)}</a>`);
  if (c.city || c.state) h += detailRow('Location', esc([c.city, c.state].filter(Boolean).join(', ')));
  if (c.website) h += detailRow('Website', `<a href="${safeHref(c.website)}" target="_blank" rel="noopener">${esc(c.website)}</a>`);
  h += '</div>';

  // Business info
  if (c.contact_class === 'business') {
    h += '<div class="detail-section">';
    h += '<div class="detail-section-title">Business</div>';
    if (c.company_name) h += detailRow('Company', esc(c.company_name));
    if (c.title) h += detailRow('Title', esc(c.title));
    if (c.industry) h += detailRow('Industry', esc(c.industry));
    if (c.entity_type) h += detailRow('Entity Type', esc(c.entity_type));
    if (c.contact_type) h += detailRow('Contact Type', esc(c.contact_type));
    if (c.total_transactions) h += detailRow('Transactions', c.total_transactions);
    if (c.total_volume) h += detailRow('Volume', '$' + Number(c.total_volume).toLocaleString());
    if (c.is_1031_buyer) h += detailRow('1031 Buyer', 'Yes');
    h += '</div>';
  }

  // Sources
  if (_cui.selectedSources?.length > 0) {
    h += '<div class="detail-section">';
    h += '<div class="detail-section-title">Connected Sources</div>';
    h += '<div class="uc-sources-list">';
    _cui.selectedSources.forEach(s => {
      const syncLabel = s.synced ? 'Synced ' + relativeDate(s.synced) : '';
      h += `<div class="uc-source-row">
        <span class="uc-src-badge uc-src-${s.system}">${sourceLabel(s.system)}</span>
        <span class="uc-source-sync">${syncLabel}</span>
      </div>`;
    });
    h += '</div></div>';
  }

  // Quick actions — advance the ball: outreach, log the touch, jump to CRM.
  h += '<div class="detail-actions">';
  h += `<button class="btn-submit" onclick="switchContactDetailTab('messages')">Send Message</button>`;
  if (c.sf_contact_id) {
    h += `<button class="btn-cancel" onclick="_cuiLogTouch()">Log a touch</button>`;
    const _sfb = (typeof _SF_BASE !== 'undefined') ? _SF_BASE : 'https://northmarqcapital.lightning.force.com/lightning/r';
    h += `<a class="btn-cancel" href="${_sfb}/Contact/${esc(c.sf_contact_id)}/view" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center">View in Salesforce \u2192</a>`;
  }
  const toggleClass = c.contact_class === 'business' ? 'personal' : 'business';
  h += `<button class="btn-cancel" onclick="classifyContactAction(decodeURIComponent('${encodeURIComponent(c.unified_id)}'), '${toggleClass}')">Move to ${toggleClass}</button>`;
  h += '</div>';

  return h;
}

function engagementStat(label, value, heat) {
  const cls = heat ? ` uc-heat-${heat}` : '';
  return `<div class="uc-eng-stat">
    <div class="uc-eng-val${cls}">${value}</div>
    <div class="uc-eng-lbl">${label}</div>
  </div>`;
}

function detailRow(label, value) {
  return `<div class="detail-row"><div class="detail-lbl">${label}</div><div class="detail-val">${value}</div></div>`;
}

function sourceLabel(system) {
  const map = { salesforce: 'SF', outlook: 'OL', calendar: 'Cal', webex: 'WX', teams: 'TM', icloud: 'iC', gov_db: 'Gov', dia_db: 'Dia' };
  return map[system] || system;
}

// ---- Log a touch (advance-the-ball forward action) ----
function _cuiLogTouch() {
  const c = _cui.selectedContact;
  if (!c || !c.sf_contact_id) { if (typeof showToast === 'function') showToast('No Salesforce contact linked', 'error'); return; }
  if (typeof openLogCall === 'function') openLogCall({ name: c.full_name, sf_contact_id: c.sf_contact_id });
  else if (typeof showToast === 'function') showToast('Activity logging is unavailable here', 'error');
}
window._cuiLogTouch = _cuiLogTouch;

// ---- Classify contact ----
async function classifyContactAction(id, newClass) {
  try {
    await contactsApi('POST', 'classify', { id }, { contact_class: newClass });
    if (typeof showToast === 'function') showToast(`Moved to ${newClass}`, 'ok');
    // Refresh detail
    openContactDetail(id);
    // Refresh list
    _cui.loaded = false;
  } catch (e) {
    if (typeof showToast === 'function') showToast('Failed: ' + e.message, 'error');
  }
}

// ============================================================
// MESSAGES TAB
// ============================================================

function buildContactMessages() {
  const c = _cui.selectedContact;
  if (!c) return '';

  let h = '';

  // Channel selector
  h += '<div class="uc-msg-channels">';
  h += msgChannelBtn('teams', 'Teams');
  h += msgChannelBtn('webex', 'WebEx');
  h += msgChannelBtn('sms', 'SMS');
  h += '</div>';

  // Messages list
  if (_cui.messagesLoading) {
    h += '<div class="loading"><span class="spinner"></span></div>';
  } else if (_cui.messages.length === 0) {
    h += '<div class="uc-empty" style="padding:24px 0">No messages yet. Send the first one below.</div>';
  } else {
    h += '<div class="uc-msg-list">';
    _cui.messages.forEach(msg => {
      const isMe = msg.from_me || msg.direction === 'sent';
      h += `<div class="uc-msg ${isMe ? 'uc-msg-sent' : 'uc-msg-received'}">
        <div class="uc-msg-body">${esc(msg.content || msg.text || '')}</div>
        <div class="uc-msg-time">${msg.created_at ? new Date(msg.created_at).toLocaleString() : ''}</div>
      </div>`;
    });
    h += '</div>';
  }

  // Compose
  h += `<div class="uc-msg-compose">
    <textarea id="ucMsgInput" rows="2" placeholder="Type a message...">${esc(_cui.messageText)}</textarea>
    <button class="btn-submit" onclick="sendContactMessage()">Send</button>
  </div>`;

  return h;
}

function msgChannelBtn(channel, label) {
  const active = _cui.messageChannel === channel ? ' uc-tab-active' : '';
  return `<button class="uc-tab uc-tab-sm${active}" onclick="switchMessageChannel('${channel}')">${label}</button>`;
}

function switchMessageChannel(channel) {
  _cui.messageChannel = channel;
  _cui.messages = [];
  loadContactMessages();
  renderContactDetailBody();
}

async function loadContactMessages() {
  const c = _cui.selectedContact;
  if (!c) return;
  _cui.messagesLoading = true;
  renderContactDetailBody();

  try {
    const action = `messages_${_cui.messageChannel}`;
    const data = await contactsApi('GET', action, { id: c.unified_id });
    _cui.messages = data.messages || [];
  } catch (e) {
    _cui.messages = [];
    console.warn('Failed to load messages:', e);
  }
  _cui.messagesLoading = false;
  renderContactDetailBody();
}

async function sendContactMessage() {
  const c = _cui.selectedContact;
  const input = document.getElementById('ucMsgInput');
  const text = input?.value?.trim();
  if (!c || !text) return;

  try {
    const action = `send_${_cui.messageChannel}`;
    await contactsApi('POST', action, { id: c.unified_id }, { message: text });
    _cui.messageText = '';
    if (input) input.value = '';
    if (typeof showToast === 'function') showToast('Message sent', 'ok');
    // Reload messages
    loadContactMessages();
  } catch (e) {
    if (typeof showToast === 'function') showToast('Send failed: ' + e.message, 'error');
  }
}

// ============================================================
// HISTORY TAB
// ============================================================

function buildContactHistory() {
  if (_cui.selectedHistory.length === 0) {
    return '<div class="uc-empty" style="padding:24px 0">No history recorded yet.</div>';
  }

  let h = '<div class="uc-timeline">';
  _cui.selectedHistory.forEach(entry => {
    const icon = historyIcon(entry.change_type);
    const time = entry.changed_at ? new Date(entry.changed_at).toLocaleString() : '';
    const fields = entry.fields_changed ? Object.keys(entry.fields_changed).join(', ') : '';

    h += `<div class="uc-timeline-item">
      <div class="uc-timeline-icon">${icon}</div>
      <div class="uc-timeline-content">
        <div class="uc-timeline-type">${esc(entry.change_type)} <span class="uc-timeline-src">via ${esc(entry.source || '?')}</span></div>
        ${fields ? `<div class="uc-timeline-fields">${esc(fields)}</div>` : ''}
        <div class="uc-timeline-time">${time}</div>
      </div>
    </div>`;
  });
  h += '</div>';
  return h;
}

function historyIcon(type) {
  const map = { create: '+', merge: '&harr;', update: '&#9998;', classify: '&#9873;', delete: '&times;', stale_flag: '&#9888;', engagement: '&#9829;' };
  return map[type] || '&bull;';
}

// ============================================================
// EDIT TAB
// ============================================================

function buildContactEdit() {
  const c = _cui.selectedContact;
  if (!c) return '';

  let h = '<form id="ucEditForm" onsubmit="saveContactEdit(event)">';
  h += editField('first_name', 'First Name', c.first_name);
  h += editField('last_name', 'Last Name', c.last_name);
  h += editField('email', 'Email', c.email);
  h += editField('phone', 'Phone', c.phone);
  h += editField('mobile_phone', 'Mobile', c.mobile_phone);
  h += editField('title', 'Title', c.title);
  h += editField('company_name', 'Company', c.company_name);
  h += editField('city', 'City', c.city);
  h += editField('state', 'State', c.state);
  h += editField('website', 'Website', c.website);
  h += editField('industry', 'Industry', c.industry);
  h += `<div class="detail-actions" style="margin-top:16px">
    <button type="submit" class="btn-submit">Save Changes</button>
  </div>`;
  h += '</form>';
  return h;
}

function editField(name, label, value) {
  return `<div class="detail-row">
    <label class="detail-lbl" for="uce_${name}">${label}</label>
    <input class="uc-edit-input" id="uce_${name}" name="${name}" value="${esc(value || '')}" />
  </div>`;
}

async function saveContactEdit(e) {
  e.preventDefault();
  const c = _cui.selectedContact;
  if (!c) return;

  const form = document.getElementById('ucEditForm');
  if (!form) return;
  const body = {};
  const fields = ['first_name', 'last_name', 'email', 'phone', 'mobile_phone', 'title', 'company_name', 'city', 'state', 'website', 'industry'];
  fields.forEach(f => {
    const input = form.querySelector(`[name="${f}"]`);
    if (input) {
      const val = input.value.trim() || null;
      if (val !== (c[f] || null)) body[f] = val;
    }
  });

  if (Object.keys(body).length === 0) {
    if (typeof showToast === 'function') showToast('No changes', '');
    return;
  }

  try {
    await contactsApi('PATCH', 'update', { id: c.unified_id }, body);
    if (typeof showToast === 'function') showToast('Contact updated', 'ok');
    openContactDetail(c.unified_id);
    _cui.loaded = false;
  } catch (e) {
    if (typeof showToast === 'function') showToast('Update failed: ' + e.message, 'error');
  }
}

// ============================================================
// MERGE QUEUE
// ============================================================

function buildMergeQueue() {
  if (_cui.mergeQueue.length === 0) {
    return '<div class="uc-empty">No pending merge suggestions.</div>';
  }

  let h = `<div class="uc-section-header">${_cui.mergeQueueTotal || _cui.mergeQueue.length} pending merge suggestions</div>`;
  h += '<div class="uc-merge-list">';
  _cui.mergeQueue.forEach(m => {
    const score = Math.round((m.match_score || 0) * 100);
    h += `<div class="uc-merge-card">
      <div class="uc-merge-header">
        <span class="uc-merge-score" title="Match confidence">${score}%</span>
        <span class="uc-merge-method">${esc(m.match_method || 'unknown')}</span>
      </div>
      <div class="uc-merge-pair">
        <div class="uc-merge-contact" onclick="openContactDetail(decodeURIComponent('${encodeURIComponent(m.contact_a_id)}'))">
          ${esc(m.contact_a_name || m.contact_a_id)}
        </div>
        <span class="uc-merge-arrow">&harr;</span>
        <div class="uc-merge-contact" onclick="openContactDetail(decodeURIComponent('${encodeURIComponent(m.contact_b_id)}'))">
          ${esc(m.contact_b_name || m.contact_b_id)}
        </div>
      </div>
      <div class="uc-merge-actions">
        <button class="btn-submit" onclick="cuiMergePair(decodeURIComponent('${encodeURIComponent(m.queue_id)}'),decodeURIComponent('${encodeURIComponent(m.contact_a_id)}'),decodeURIComponent('${encodeURIComponent(m.contact_a_name || m.contact_a_id)}'),decodeURIComponent('${encodeURIComponent(m.contact_b_id)}'),decodeURIComponent('${encodeURIComponent(m.contact_b_name || m.contact_b_id)}'))">Merge</button>
        <button class="btn-cancel" onclick="dismissMergeAction(decodeURIComponent('${encodeURIComponent(m.queue_id)}'))">Dismiss</button>
      </div>
    </div>`;
  });
  h += '</div>';
  return h;
}

async function loadMergeQueue() {
  try {
    const data = await contactsApi('GET', 'merge_queue');
    _cui.mergeQueue = data.queue || [];
    _cui.mergeQueueTotal = data.total || _cui.mergeQueue.length;
  } catch (e) {
    console.error('Failed to load merge queue:', e);
  }
  renderContactsPage();
}

// Tier 3 Phase 3: route the contact merge through the ONE shared merge modal
// (review-shared.js → planMerge → /api/contacts?action=merge) so the operator
// can pick the survivor consistently with entity/property merges. Flag-gated +
// reversible: with `unified_merge_modal` OFF (or the modal unavailable) it falls
// back to the legacy immediate merge. The merge-queue LIST + search/browse are
// unchanged — only the ACTION consolidates.
function cuiMergePair(queueId, aId, aName, bId, bName) {
  var flagOn = (typeof checkFlag !== 'function') || checkFlag('unified_merge_modal');
  if (flagOn && typeof openMergeModal === 'function') {
    openMergeModal({
      kind: 'contact',
      queueId: queueId,
      a: { id: aId, name: aName || aId },
      b: { id: bId, name: bName || bId },
      onDone: function () { _cui.loaded = false; loadMergeQueue(); },
    });
    return;
  }
  executeMerge(queueId, aId, bId); // legacy path (flag off)
}
if (typeof window !== 'undefined') window.cuiMergePair = cuiMergePair;

async function executeMerge(queueId, contactA, contactB) {
  try {
    await contactsApi('POST', 'merge', {}, { keep_id: contactA, merge_id: contactB, queue_id: queueId });
    if (typeof showToast === 'function') showToast('Contacts merged', 'ok');
    loadMergeQueue();
    _cui.loaded = false;
  } catch (e) {
    if (typeof showToast === 'function') showToast('Merge failed: ' + e.message, 'error');
  }
}

async function dismissMergeAction(queueId) {
  try {
    await contactsApi('POST', 'dismiss_merge', {}, { queue_id: queueId });
    _cui.mergeQueue = _cui.mergeQueue.filter(m => m.queue_id !== queueId);
    renderContactsPage();
  } catch (e) {
    if (typeof showToast === 'function') showToast('Dismiss failed: ' + e.message, 'error');
  }
}

// ============================================================
// DATA QUALITY
// ============================================================

function buildDataQuality() {
  const dq = _cui.dataQuality;
  if (!dq) return '<div class="loading"><span class="spinner"></span></div>';

  let h = '<div class="uc-dq-grid">';
  h += dqCard('Total Contacts', dq.total_contacts, '--accent');
  h += dqCard('Hot Leads', dq.hot_leads, '--red');
  h += dqCard('WebEx Linked', dq.webex_linked, '--cyan');
  h += dqCard('Pending Merges', dq.pending_merges, '--yellow');
  h += dqCard('Stale Emails', dq.stale_emails, '--orange');
  h += dqCard('Stale Phones', dq.stale_phones, '--orange');
  h += '</div>';

  // Health bar
  const staleTotal = (dq.stale_emails || 0) + (dq.stale_phones || 0);
  const healthPct = dq.total_contacts > 0 ? Math.round(((dq.total_contacts - staleTotal) / dq.total_contacts) * 100) : 100;
  const healthColor = healthPct >= 90 ? 'var(--green)' : healthPct >= 70 ? 'var(--yellow)' : 'var(--red)';

  h += '<div class="widget" style="margin-top:16px">';
  h += '<div class="widget-title">Data Health</div>';
  h += `<div class="uc-health-bar"><div class="uc-health-fill" style="width:${healthPct}%;background:${healthColor}"></div></div>`;
  h += `<div style="text-align:center;margin-top:8px;font-size:14px;color:var(--text2)">${healthPct}% clean</div>`;
  h += '</div>';

  return h;
}

function dqCard(label, value, colorVar) {
  return `<div class="uc-dq-card">
    <div class="uc-dq-val" style="color:var(${esc(colorVar)})">${(value || 0).toLocaleString()}</div>
    <div class="uc-dq-lbl">${esc(label)}</div>
  </div>`;
}

async function loadDataQuality() {
  try {
    _cui.dataQuality = await contactsApi('GET', 'data_quality');
  } catch (e) {
    console.error('Failed to load data quality:', e);
    _cui.dataQuality = { total_contacts: 0, stale_emails: 0, stale_phones: 0, pending_merges: 0, hot_leads: 0, webex_linked: 0 };
  }
  renderContactsPage();
}

// ---- Utility (reuse app.js esc if available) ----
if (typeof esc !== 'function') {
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
}
