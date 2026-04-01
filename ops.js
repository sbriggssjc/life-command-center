// ============================================================================
// ops.js — Operational UI Module
// Life Command Center — Phase 5/6: UX Redesign + Performance Optimization
//
// Renders: My Work, Team Queue, Inbox Triage, Entities, Research,
//          Metrics, Sync Health
//
// Depends on: LCC_USER (from index.html), queue/inbox/entity/sync APIs
// Uses queue-v2 endpoints (paginated) when available, falls back to queue v1
// ============================================================================

// --- Performance instrumentation ---
const opsPerfLog = [];

function opsPerf(label) {
  const t0 = performance.now();
  return {
    end() {
      const dur = Math.round(performance.now() - t0);
      opsPerfLog.push({ label, dur, ts: Date.now() });
      if (opsPerfLog.length > 200) opsPerfLog.shift();
      if (dur > 500) console.warn(`[ops perf] ${label}: ${dur}ms`);
      // Report to server (fire-and-forget)
      if (LCC_USER.workspace_id && dur > 100) {
        navigator.sendBeacon?.('/api/queue-v2?view=_perf', JSON.stringify({
          metric_type: 'page_load', endpoint: label, duration_ms: dur
        }));
      }
      return dur;
    }
  };
}

// --- State ---
let opsMyWorkData = null;
let opsTeamQueueData = null;
let opsInboxData = null;
let opsEntitiesData = null;
let opsResearchData = null;
let opsMetricsData = null;
let opsSyncData = null;

let opsMyWorkFilter = 'all';      // all | open | in_progress | waiting | overdue
let opsInboxFilter = 'new';       // new | triaged | all
let opsEntityFilter = 'all';      // all | person | company | property | clinic
let opsResearchFilter = 'active'; // active | completed | all
let opsEntitiesPage = 1;
let opsResearchPage = 1;
let opsInboxSelected = new Set();
let opsWorkspaceMembers = [];
let opsAssignModalState = null;
let opsEscalateModalState = null;
let opsFollowupModalState = null;
let opsResearchAssistantState = {};

// Advanced team queue filters
let opsTeamDomainFilter = '';       // '' = all domains
let opsTeamAssigneeFilter = '';     // '' = all, 'unassigned', or user_id
let opsTeamVisFilter = '';          // '' = all, 'private', 'assigned', 'shared'

// --- V2 endpoint preference (uses paginated queue-v2 when flag is on) ---
const V2_MAP = {
  '/api/queue?view=my_work': '/api/queue-v2?view=my_work',
  '/api/queue?view=team_queue': '/api/queue-v2?view=team_queue',
  '/api/queue?view=inbox': '/api/queue-v2?view=inbox',
  '/api/queue?view=research': '/api/queue-v2?view=research',
  '/api/queue?view=research_queue': '/api/queue-v2?view=research',
  '/api/queue?view=work_counts': '/api/queue-v2?view=work_counts'
};
let useV2 = false; // Controlled by queue_v2_enabled flag; auto-degrades to v1 if v2 returns 404

// --- Pagination state for infinite scroll / page navigation ---
let opsPagination = {};

function refreshActiveOpsPage() {
  const activePage = document.querySelector('.page.active');
  if (activePage && typeof handlePageLoad === 'function') {
    handlePageLoad(activePage.id);
  }
}

// --- API helper ---
async function opsApi(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;

  // Try v2 endpoint first (paginated, instrumented)
  const basePath = path.split('&')[0];
  const v2Path = useV2 ? V2_MAP[basePath] : null;
  const extraParams = path.includes('&') ? '&' + path.split('&').slice(1).join('&') : '';
  const finalPath = v2Path ? v2Path + extraParams : path;

  const _ac = new AbortController();
  const _at = setTimeout(() => _ac.abort(), 30000);
  try {
    const perf = opsPerf(`api:${finalPath.split('?')[1]?.substring(0, 40) || finalPath}`);
    const mergedOpts = { headers, ...opts };
    if (!mergedOpts.signal) mergedOpts.signal = _ac.signal;
    const res = await fetch(finalPath, mergedOpts);
    clearTimeout(_at);

    // If v2 returned 404, fall back to v1
    if (v2Path && res.status === 404) {
      useV2 = false;
      console.debug('[ops] queue-v2 not available, falling back to v1');
      perf.end();
      return opsApi(path, opts);
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      perf.end();
      return { ok: false, status: res.status, error: err.error || res.statusText };
    }
    const data = await res.json();
    const dur = perf.end();

    // Store pagination metadata if present
    if (data.pagination) opsPagination[basePath] = data.pagination;

    // Extract server timing
    const serverTiming = res.headers.get('X-Response-Time');
    if (serverTiming) data._serverTime = serverTiming;
    data._clientTime = dur + 'ms';

    return { ok: true, data };
  } catch (e) {
    clearTimeout(_at);
    if (e.name === 'AbortError') return { ok: false, error: 'Request timed out (30s)' };
    return { ok: false, error: e.message };
  }
}

async function opsPost(path, body) {
  return opsApi(path, { method: 'POST', body: JSON.stringify(body) });
}

async function opsPatch(path, body) {
  return opsApi(path, { method: 'PATCH', body: JSON.stringify(body) });
}

async function loadWorkspaceMembers() {
  if (opsWorkspaceMembers.length) return opsWorkspaceMembers;
  const res = await opsApi('/api/members');
  if (res.ok) opsWorkspaceMembers = res.data?.members || [];
  return opsWorkspaceMembers;
}

// --- Freshness helpers ---
function freshnessLabel(isoDate) {
  if (!isoDate) return { cls: 'unknown', text: 'Unknown' };
  const mins = (Date.now() - new Date(isoDate).getTime()) / 60000;
  if (mins < 5) return { cls: 'fresh', text: 'Just now' };
  if (mins < 60) return { cls: 'fresh', text: `${Math.round(mins)}m ago` };
  if (mins < 360) return { cls: 'stale', text: `${Math.round(mins / 60)}h ago` };
  if (mins < 1440) return { cls: 'old', text: `${Math.round(mins / 60)}h ago` };
  return { cls: 'old', text: `${Math.round(mins / 1440)}d ago` };
}

function freshnessHTML(isoDate) {
  if (typeof checkFlag === 'function' && !checkFlag('freshness_indicators')) return '';
  const f = freshnessLabel(isoDate);
  return `<span class="freshness"><span class="freshness-dot ${f.cls}"></span>${f.text}</span>`;
}

function relDate(d) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const diff = Math.floor((date - now) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < -1) return `${Math.abs(diff)}d overdue`;
  if (diff < 7) return `In ${diff}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isOverdue(dueDate) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

// --- Priority/status display helpers ---
function priBadge(pri) {
  if (!pri || pri === 'normal') return '';
  if (pri === 'urgent') return '<span class="q-badge pri-urgent">Urgent</span>';
  if (pri === 'high') return '<span class="q-badge pri-high">High</span>';
  return '';
}

function statusBadge(status) {
  const cls = `status-${(status || '').replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const label = (status || 'unknown').replace(/_/g, ' ');
  return `<span class="q-badge ${cls}">${esc(label)}</span>`;
}

function typeBadge(type) {
  if (!type) return '';
  return `<span class="q-badge type">${esc(type.replace(/_/g, ' '))}</span>`;
}

function domainBadge(domain) {
  if (!domain) return '';
  return `<span class="q-badge domain">${esc(domain)}</span>`;
}

function researchAssistantPanelHTML(itemId) {
  const state = opsResearchAssistantState[itemId] || { open: false, loading: false, reply: '', error: '' };
  if (!state.open) return '';
  const body = state.loading
    ? '<div class="assistant-status"><span class="spinner" style="width:14px;height:14px"></span> Analyzing task...</div>'
    : state.error
      ? `<div class="assistant-status assistant-error">${esc(state.error)}</div>`
      : state.reply
        ? `<div class="assistant-copy">${typeof formatCopilotText === 'function' ? formatCopilotText(state.reply) : esc(state.reply)}</div>
           <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
             <button class="q-action" onclick="copyResearchAssistantReply(decodeURIComponent('${encodeURIComponent(itemId)}'))">Copy</button>
             <button class="q-action primary" onclick="useResearchAssistantFollowup(decodeURIComponent('${encodeURIComponent(itemId)}'))">Use as Follow-up Draft</button>
           </div>`
        : '<div class="assistant-status">No response yet.</div>';

  return `<div class="assistant-panel">${body}</div>`;
}

// --- Sync warning banner ---
function syncBannerHTML(connectors) {
  if (!connectors || !connectors.length) return '';
  const unhealthy = connectors.filter(c => c.status === 'error' || c.status === 'degraded');
  if (!unhealthy.length) return '';
  const isError = unhealthy.some(c => c.status === 'error');
  const names = unhealthy.map(c => c.connector_type).join(', ');
  return `<div class="sync-banner ${isError ? 'error' : ''}">
    <span class="sync-icon">${isError ? '!' : '~'}</span>
    <span class="sync-msg">${unhealthy.length} connector${unhealthy.length > 1 ? 's' : ''} ${isError ? 'failing' : 'degraded'}: ${names}</span>
    <span class="sync-action" onclick="navTo('pageSyncHealth')">View</span>
  </div>`;
}

// --- Workspace context bar ---
function workspaceContextHTML() {
  if (!LCC_USER || !LCC_USER._loaded) return '';
  const name = LCC_USER.display_name || 'Unknown User';
  const role = LCC_USER.role || 'viewer';
  const ws = LCC_USER.workspace_name || LCC_USER.workspace_id || '';
  return `<div class="ws-context">
    <span class="ws-context-name">${esc(name)}</span>
    <span class="ws-context-role ${role}">${role}</span>
    ${ws ? `<span class="ws-context-sep">&middot;</span><span>${esc(ws)}</span>` : ''}
    <div class="ws-context-sync" id="wsContextSync"></div>
  </div>`;
}

// --- Degraded state banners ---
function degradedBannerHTML(type, detail) {
  const configs = {
    no_workspace: {
      icon: '!', title: 'No workspace configured',
      desc: 'Create or join a workspace to enable team features.',
      action: 'Go to Settings', onclick: "navTo('pageSettings')"
    },
    no_connectors: {
      icon: '~', title: 'No connectors configured',
      desc: 'Set up Outlook, Salesforce, or calendar connectors to populate your queues.',
      action: 'Set up connectors', onclick: "navTo('pageSyncHealth')"
    },
    sync_unhealthy: {
      icon: '!', title: 'Sync issues detected',
      desc: detail || 'One or more connectors are failing. Data may be stale.',
      action: 'View sync health', onclick: "navTo('pageSyncHealth')"
    },
    auth_warning: {
      icon: '!', title: 'Development mode',
      desc: 'Running with transitional auth. Some features may be limited.',
      action: null, onclick: null
    }
  };
  const cfg = configs[type];
  if (!cfg) return '';
  return `<div class="degraded-banner">
    <span class="degraded-icon">${cfg.icon}</span>
    <div class="degraded-body">
      <div class="degraded-title">${cfg.title}</div>
      <div>${cfg.desc}</div>
      ${cfg.action ? `<span class="degraded-action" onclick="${cfg.onclick}">${cfg.action}</span>` : ''}
    </div>
  </div>`;
}

// --- Improved empty states ---
function emptyStateHTML(icon, title, desc, actionLabel, actionFn) {
  return `<div class="ops-empty-detailed">
    ${icon ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icon}</svg>` : ''}
    <div class="empty-title">${title}</div>
    <div class="empty-desc">${desc}</div>
    ${actionLabel ? `<button class="empty-action" onclick="${actionFn}">${actionLabel}</button>` : ''}
  </div>`;
}

// --- Visibility badge ---
function visBadge(item) {
  if (!item) return '';
  if (item.visibility === 'private' || item.is_private) return '<span class="q-badge vis-private">Private</span>';
  if (item.visibility === 'shared' || item.shared) return '<span class="q-badge vis-shared">Shared</span>';
  if (item.assigned_to) return '<span class="q-badge vis-assigned">Assigned</span>';
  return '';
}

// ============================================================================
// MY WORK — personal queue of assigned/owned items
// ============================================================================
async function renderMyWork(page) {
  const el = document.getElementById('myWorkContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:my_work');

  // SYNC FIX: Use canonicalMyWork if available (same source as Dashboard widget)
  // This ensures consistency between Dashboard and My Work page
  if (typeof canonicalMyWork !== 'undefined' && canonicalMyWork && canonicalMyWork.items && canonicalMyWork.items.length > 0) {
    opsMyWorkData = canonicalMyWork.items || [];
    const cRes = await opsApi('/api/connectors?action=list');
    const connectors = cRes.ok ? (cRes.data?.connectors || cRes.data || []) : [];
    renderMyWorkList(el, connectors);
    perf.end();
    return;
  }

  const pageParam = page ? `&page=${page}&per_page=25` : '&limit=100';
  const [qRes, cRes] = await Promise.all([
    opsApi(`/api/queue?view=my_work${pageParam}`),
    opsApi('/api/connectors?action=list')
  ]);

  if (!qRes.ok) {
    el.innerHTML = `<div class="ops-empty">Could not load your work queue.<br><small>${esc(qRes.error)}</small></div>`;
    perf.end();
    return;
  }

  opsMyWorkData = qRes.data?.items || qRes.data || [];
  const connectors = cRes.ok ? (cRes.data?.connectors || cRes.data || []) : [];

  // Fallback: if canonical queue is empty, show CRM tasks from mktData
  // (same data source the Today sidebar uses for the My Work widget)
  if (opsMyWorkData.length === 0 && typeof mktLoaded !== 'undefined' && mktLoaded && typeof mktData !== 'undefined' && mktData.length > 0) {
    const userName = (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) ? LCC_USER.display_name : 'Scott Briggs';
    const today = new Date().toISOString().split('T')[0];
    const myTasks = mktData.filter(function(d) { return d.assigned_to === userName; });
    if (myTasks.length > 0) {
      opsMyWorkData = myTasks.map(function(d) {
        var isOverdueTask = d.due_date && d.due_date < today;
        return {
          id: d.item_id || d.sf_contact_id || ('crm-' + Math.random().toString(36).slice(2)),
          title: d.contact_name || d.deal_display_name || '(Untitled)',
          status: isOverdueTask ? 'open' : (d.status || 'open').toLowerCase(),
          due_date: d.due_date || null,
          domain: d.task_domain || d._opp_domain || null,
          priority: d.deal_priority ? (d.deal_priority <= 3 ? 'high' : 'normal') : 'normal',
          assigned_to: d.assigned_to,
          source_type: d.pipeline_source || 'crm',
          entity_name: d.company_name || '',
          _crm_fallback: true
        };
      });
      window._myWorkCrmFallback = true;
    }
  }

  renderMyWorkList(el, connectors);
  perf.end();
}

function renderMyWorkList(el, connectors) {
  const items = filterMyWork(opsMyWorkData);
  const counts = countByStatus(opsMyWorkData);
  const unhealthyConns = (connectors || []).filter(c => c.status === 'error' || c.status === 'degraded');

  let html = '';
  html += workspaceContextHTML();
  html += syncBannerHTML(connectors);

  // Degraded states
  if (!LCC_USER.workspace_id) html += degradedBannerHTML('no_workspace');
  else if (!connectors.length) html += degradedBannerHTML('no_connectors');

  // CRM fallback notice
  if (window._myWorkCrmFallback && opsMyWorkData.length > 0) {
    html += '<div style="padding:8px 12px;margin-bottom:8px;background:var(--bg2);border-radius:8px;font-size:12px;color:var(--text2)">Showing CRM tasks from Salesforce. Promote items from Inbox to build your canonical work queue.</div>';
  }

  html += `<div class="ops-header">
    <h2>My Work <span style="font-size:13px;color:var(--text2);font-weight:400">${opsMyWorkData.length} items</span></h2>
    <div class="ops-controls">${freshnessHTML(new Date().toISOString())}</div>
  </div>`;

  // Filter pills
  html += '<div class="ops-filters">';
  html += filterPill('all', `All (${opsMyWorkData.length})`, opsMyWorkFilter, 'opsMyWorkFilter', 'renderMyWork');
  html += filterPill('open', `Open (${counts.open || 0})`, opsMyWorkFilter, 'opsMyWorkFilter', 'renderMyWork');
  html += filterPill('in_progress', `In Progress (${counts.in_progress || 0})`, opsMyWorkFilter, 'opsMyWorkFilter', 'renderMyWork');
  html += filterPill('waiting', `Waiting (${counts.waiting || 0})`, opsMyWorkFilter, 'opsMyWorkFilter', 'renderMyWork');
  html += filterPill('overdue', `Overdue (${countOverdue(opsMyWorkData)})`, opsMyWorkFilter, 'opsMyWorkFilter', 'renderMyWork');
  html += '</div>';

  if (!items.length && opsMyWorkData.length === 0) {
    // Show CRM tasks fallback if marketing data is loaded
    if (typeof mktData !== 'undefined' && mktData && mktData.length > 0) {
      const userName = (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) ? LCC_USER.display_name : 'Scott Briggs';
      const today = new Date().toISOString().split('T')[0];
      const myTasks = mktData.filter(d => d.assigned_to === userName);
      const overdueTasks = myTasks.filter(d => d.due_date && d.due_date < today);
      const dueSoon = myTasks.filter(d => d.due_date && d.due_date >= today).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
      const crmItems = [...overdueTasks, ...dueSoon].slice(0, 25);
      if (crmItems.length > 0) {
        html += `<div style="padding:8px 12px;background:var(--s2);border-radius:8px;margin-bottom:12px;font-size:12px;color:var(--text2)">Showing ${myTasks.length} CRM tasks assigned to you</div>`;
        crmItems.forEach(d => {
          const isOD = d.due_date && d.due_date < today;
          const dueLabel = d.due_date ? (d.due_date === today ? 'Today' : d.due_date) : '';
          html += `<div class="q-item${isOD ? ' overdue' : ''}" onclick="navTo('pageBiz');setTimeout(function(){switchBizTab('marketing')},100)">
            <div class="q-title">${typeof esc === 'function' ? esc(d.contact_name || d.deal_display_name || d.company_name || '—') : (d.contact_name || d.deal_display_name || d.company_name || '—')}</div>
            <div class="q-meta">${typeof esc === 'function' ? esc(d.company_name || '') : (d.company_name || '')}${dueLabel ? ` · <span style="color:${isOD ? 'var(--red)' : 'var(--text2)'}">${dueLabel}</span>` : ''}</div>
          </div>`;
        });
      } else {
        html += emptyStateHTML(
          '<path d="M9 14l2 2 4-4"/><circle cx="12" cy="12" r="10"/>',
          'No tasks assigned to you',
          'Check the Marketing tab for all CRM activity.',
          'Go to Marketing',
          "navTo('pageBiz');setTimeout(function(){switchBizTab('marketing')},100)"
        );
      }
    } else {
      html += emptyStateHTML(
        '<path d="M9 14l2 2 4-4"/><circle cx="12" cy="12" r="10"/>',
        'No work items yet',
        connectors.length ? 'Sync your connectors or promote inbox items to populate your queue.' : 'Set up connectors to start receiving work items.',
        connectors.length ? 'Go to Inbox' : 'Set up connectors',
        connectors.length ? "navTo('pageInbox')" : "navTo('pageSyncHealth')"
      );
    }
  } else if (!items.length) {
    html += '<div class="ops-empty">No items match this filter</div>';
  } else {
    items.forEach(item => { html += queueItemHTML(item, 'my_work'); });
  }

  // Pagination controls (if using v2)
  html += paginationHTML('/api/queue?view=my_work', 'renderMyWork');

  el.innerHTML = html;
}

function filterMyWork(items) {
  if (opsMyWorkFilter === 'all') return items;
  if (opsMyWorkFilter === 'overdue') return items.filter(i => isOverdue(i.due_date));
  return items.filter(i => i.status === opsMyWorkFilter);
}

// ============================================================================
// TEAM QUEUE — shared queue, unassigned items, team visibility
// ============================================================================
async function renderTeamQueue() {
  const el = document.getElementById('teamQueueContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:team_queue');

  const [qRes, uRes] = await Promise.all([
    opsApi('/api/queue?view=team_queue&limit=100'),
    opsApi('/api/workflows?action=unassigned')
  ]);

  if (!qRes.ok) {
    el.innerHTML = `<div class="ops-empty">Could not load team queue.<br><small>${esc(qRes.error)}</small></div>`;
    perf.end();
    return;
  }

  opsTeamQueueData = qRes.data?.items || qRes.data || [];
  const unassigned = uRes.ok ? (uRes.data?.items || []) : [];

  // Collect unique domains and assignees for filter dropdowns
  const allTeamItems = [...opsTeamQueueData, ...unassigned];
  const domains = [...new Set(allTeamItems.map(i => i.domain).filter(Boolean))].sort();
  const assignees = [...new Set(allTeamItems.filter(i => i.assignee_name).map(i => ({ id: i.assigned_to, name: i.assignee_name })).map(a => JSON.stringify(a)))].map(s => JSON.parse(s));

  let html = '';
  html += workspaceContextHTML();

  html += `<div class="ops-header">
    <h2>Team Queue</h2>
    <div class="ops-controls">${freshnessHTML(new Date().toISOString())}</div>
  </div>`;

  // Advanced filter row
  html += '<div class="ops-filters-row">';
  html += '<span class="ops-filter-label">Filter:</span>';
  html += `<select class="ops-filter-select" onchange="opsTeamDomainFilter=this.value;renderTeamQueue()">
    <option value="">All domains</option>
    ${domains.map(d => `<option value="${esc(d)}" ${opsTeamDomainFilter === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
  </select>`;
  html += `<select class="ops-filter-select" onchange="opsTeamAssigneeFilter=this.value;renderTeamQueue()">
    <option value="">All assignees</option>
    <option value="unassigned" ${opsTeamAssigneeFilter === 'unassigned' ? 'selected' : ''}>Unassigned only</option>
    ${assignees.map(a => `<option value="${esc(a.id)}" ${opsTeamAssigneeFilter === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
  </select>`;
  html += `<select class="ops-filter-select" onchange="opsTeamVisFilter=this.value;renderTeamQueue()">
    <option value="">All visibility</option>
    <option value="private" ${opsTeamVisFilter === 'private' ? 'selected' : ''}>Private</option>
    <option value="assigned" ${opsTeamVisFilter === 'assigned' ? 'selected' : ''}>Assigned</option>
    <option value="shared" ${opsTeamVisFilter === 'shared' ? 'selected' : ''}>Shared</option>
  </select>`;
  html += '</div>';

  // Apply advanced filters
  const filterTeamItem = (item) => {
    if (opsTeamDomainFilter && item.domain !== opsTeamDomainFilter) return false;
    if (opsTeamAssigneeFilter === 'unassigned' && item.assigned_to) return false;
    if (opsTeamAssigneeFilter && opsTeamAssigneeFilter !== 'unassigned' && item.assigned_to !== opsTeamAssigneeFilter) return false;
    if (opsTeamVisFilter === 'private' && !item.is_private && item.visibility !== 'private') return false;
    if (opsTeamVisFilter === 'shared' && !item.shared && item.visibility !== 'shared') return false;
    if (opsTeamVisFilter === 'assigned' && !item.assigned_to) return false;
    return true;
  };
  const filteredUnassigned = unassigned.filter(filterTeamItem);
  const filteredTeam = opsTeamQueueData.filter(filterTeamItem);

  // Unassigned section
  if (filteredUnassigned.length > 0) {
    html += `<div class="widget" style="border-color:var(--yellow)">
      <div class="widget-title">Unassigned <span style="color:var(--yellow)">${filteredUnassigned.length} items need assignment</span></div>`;
    filteredUnassigned.slice(0, 10).forEach(item => {
      html += queueItemHTML(item, 'team_queue', { showAssign: true });
    });
    if (filteredUnassigned.length > 10) {
      html += `<div style="text-align:center;padding:8px;font-size:12px;color:var(--text2)">+ ${filteredUnassigned.length - 10} more unassigned</div>`;
    }
    html += '</div>';
  }

  // Team queue items
  if (filteredTeam.length === 0 && filteredUnassigned.length === 0) {
    if (opsTeamQueueData.length === 0 && unassigned.length === 0) {
      html += emptyStateHTML(
        '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>',
        'Team queue is empty',
        'No shared work items yet. Promote inbox items or create actions to get started.',
        'Go to Inbox', "navTo('pageInbox')"
      );
    } else {
      html += '<div class="ops-empty">No items match the selected filters</div>';
    }
  } else {
    filteredTeam.forEach(item => { html += queueItemHTML(item, 'team_queue'); });
  }

  el.innerHTML = html;
  perf.end();
}

// ============================================================================
// INBOX TRIAGE — bulk triage with select-all, promote, dismiss
// ============================================================================
async function renderInboxTriage() {
  const el = document.getElementById('inboxContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:inbox_triage');

  const res = await opsApi(`/api/inbox?action=list&status=${opsInboxFilter === 'all' ? '' : opsInboxFilter}&limit=100`);

  if (!res.ok) {
    el.innerHTML = `<div class="ops-empty">Could not load inbox.<br><small>${esc(res.error)}</small></div>`;
    perf.end();
    return;
  }

  opsInboxData = res.data?.items || res.data || [];

  // Fallback: if canonical inbox is empty, load flagged emails from the edge function
  // (same source the Today dashboard uses to show 1,050+ emails)
  if (opsInboxData.length === 0 && opsInboxFilter !== 'triaged') {
    try {
      const edgeApi = typeof API !== 'undefined' ? API : '';
      if (edgeApi) {
        const emailRes = await fetch(`${edgeApi}/sync/flagged-emails?limit=100`);
        if (emailRes.ok) {
          const emailData = await emailRes.json();
          const flaggedEmails = emailData.emails || [];
          if (flaggedEmails.length > 0) {
            opsInboxData = flaggedEmails.map(function(e) {
              return {
                id: e.id || e.internet_message_id || ('email-' + Math.random().toString(36).slice(2)),
                title: e.subject || '(No subject)',
                body: e.body_preview || '',
                sender: e.sender_name || e.sender_email || '',
                source_type: 'flagged_email',
                status: 'new',
                priority: e.importance === 'high' ? 'high' : 'normal',
                created_at: e.received_date || e.received_datetime || new Date().toISOString(),
                received_at: e.received_date || e.received_datetime || new Date().toISOString(),
                external_url: e.web_link || e.outlook_link || '',
                domain: null,
                _edge_source: true
              };
            });
            window._inboxEmailTotal = emailData.total || flaggedEmails.length;
          }
        }
      }
    } catch (emailErr) {
      console.warn('[Inbox] Flagged email fallback failed:', emailErr.message);
    }
  }

  opsInboxSelected.clear();

  const displayCount = opsInboxData.length + (window._inboxEmailTotal && opsInboxData.length > 0 && opsInboxData[0]._edge_source ? ` of ${window._inboxEmailTotal}` : '');
  let html = '';
  html += `<div class="ops-header">
    <h2>Inbox <span style="font-size:13px;color:var(--text2);font-weight:400">${displayCount} items</span></h2>
    <div class="ops-controls">${freshnessHTML(new Date().toISOString())}</div>
  </div>`;

  // Show notice when displaying edge function emails
  if (opsInboxData.length > 0 && opsInboxData[0]._edge_source) {
    html += '<div style="padding:8px 12px;margin-bottom:8px;background:var(--bg2);border-radius:8px;font-size:12px;color:var(--text2)">Showing flagged emails from Outlook. Run a sync to promote these to your triage queue.</div>';
  }

  // Filter pills
  html += '<div class="ops-filters">';
  html += filterPill('new', 'New', opsInboxFilter, 'opsInboxFilter', 'renderInboxTriage');
  html += filterPill('triaged', 'Triaged', opsInboxFilter, 'opsInboxFilter', 'renderInboxTriage');
  html += filterPill('all', 'All', opsInboxFilter, 'opsInboxFilter', 'renderInboxTriage');
  html += '</div>';

  // Triage bar with select-all and bulk actions
  if (opsInboxData.length > 0 && !opsInboxData[0]._edge_source) {
    html += `<div class="triage-bar" id="triageBar">
      <input type="checkbox" id="triageSelectAll" onchange="toggleInboxSelectAll(this.checked)">
      <span>Select all</span>
      <span class="triage-count" id="triageCount">0 selected</span>
      <div class="triage-actions">
        ${checkFlag('bulk_operations_enabled') ? `
        <button class="q-action" onclick="bulkTriageInbox('triaged')" title="Mark as triaged">Triage</button>
        <button class="q-action primary" onclick="bulkPromoteInbox()" title="Promote selected to shared actions">Promote</button>
        <button class="q-action danger" onclick="bulkTriageInbox('dismissed')" title="Dismiss selected">Dismiss</button>
        ` : '<span style="font-size:11px;color:var(--text3)">Bulk ops disabled</span>'}
      </div>
    </div>`;
  }

  if (!opsInboxData.length) {
    // Show flagged emails fallback if available
    if (typeof emails !== 'undefined' && emails && emails.length > 0 && opsInboxFilter !== 'triaged') {
      html += `<div style="padding:8px 12px;background:var(--s2);border-radius:8px;margin-bottom:12px;font-size:12px;color:var(--text2)">Showing ${emails.length} flagged emails from sync</div>`;
      const inboxEmails = emails.slice(0, 25);
      inboxEmails.forEach(e => {
        const sender = typeof esc === 'function' ? esc(e.sender_name || e.sender_email || '—') : (e.sender_name || e.sender_email || '—');
        const subj = typeof esc === 'function' ? esc(e.subject || '(No subject)') : (e.subject || '(No subject)');
        const dateStr = e.received_at ? new Date(e.received_at).toLocaleDateString() : '';
        html += `<div class="q-item" style="cursor:default">
          <div class="q-title">${subj}</div>
          <div class="q-meta">${sender}${dateStr ? ` · ${dateStr}` : ''}</div>
        </div>`;
      });
    } else {
      html += emptyStateHTML(
        '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
        opsInboxFilter === 'new' ? 'Inbox is clear' : 'No items match this filter',
        opsInboxFilter === 'new' ? 'All caught up! New items from connectors will appear here.' : 'Try changing your filter to see more items.',
        null, null
      );
    }
  } else {
    opsInboxData.forEach((item, idx) => { html += inboxItemHTML(item, idx); });
  }

  el.innerHTML = html;
  perf.end();
}

function inboxItemHTML(item, idx) {
  const overdue = item.status === 'new' && item.created_at && (Date.now() - new Date(item.created_at).getTime()) > 86400000 * 2;
  let html = `<div class="q-item ${overdue ? 'overdue' : ''}" data-inbox-id="${esc(item.id)}">`;
  html += '<div class="q-item-header">';
  html += `<input type="checkbox" style="margin-right:6px;accent-color:var(--accent)" onchange="toggleInboxItem(decodeURIComponent('${encodeURIComponent(item.id)}'), this.checked)">`;
  html += `<span class="q-item-title">${esc(item.title || item.subject || 'Untitled')}</span>`;
  html += '<div class="q-item-badges">';
  html += statusBadge(item.status);
  if (item.priority && item.priority !== 'normal') html += priBadge(item.priority);
  html += visBadge(item);
  if (item.source_type) html += typeBadge(item.source_type);
  if (item.domain) html += domainBadge(item.domain);
  html += '</div></div>';

  html += '<div class="q-item-meta">';
  if (item.sender || item.source_label) html += `<span>${esc(item.sender || item.source_label)}</span>`;
  html += `<span>${freshnessHTML(item.created_at)}</span>`;
  html += '</div>';

  // Normalized quick actions
  html += '<div class="q-actions">';
  if (item.status === 'new') {
    html += `<button class="q-action" onclick="triageSingle(decodeURIComponent('${encodeURIComponent(item.id)}'))">Triage</button>`;
  }
  html += `<button class="q-action primary" onclick="promoteSingle(decodeURIComponent('${encodeURIComponent(item.id)}'))">Promote</button>`;
  html += `<button class="q-action" onclick="quickReassign(decodeURIComponent('${encodeURIComponent(item.id)}'),'inbox',${jsStringArg(item.title || item.subject || 'Untitled')})">Assign</button>`;
  html += `<button class="q-action danger" onclick="dismissSingle(decodeURIComponent('${encodeURIComponent(item.id)}'))">Dismiss</button>`;
  html += '</div>';

  html += '</div>';
  return html;
}

// Inbox triage actions
function toggleInboxSelectAll(checked) {
  opsInboxSelected.clear();
  if (checked) opsInboxData.forEach(i => opsInboxSelected.add(i.id));
  document.querySelectorAll('[data-inbox-id] input[type="checkbox"]').forEach(cb => cb.checked = checked);
  updateTriageCount();
}

function toggleInboxItem(id, checked) {
  if (checked) opsInboxSelected.add(id);
  else opsInboxSelected.delete(id);
  updateTriageCount();
}

function updateTriageCount() {
  const el = document.getElementById('triageCount');
  if (el) el.textContent = `${opsInboxSelected.size} selected`;
}

async function bulkTriageInbox(status, btn) {
  if (!opsInboxSelected.size) { showToast('Select items first', 'error'); return; }
  const ids = Array.from(opsInboxSelected);
  const statusLabel = status === 'dismissed' ? 'Dismissing' : 'Triaging';
  // Disable all bulk action buttons during operation
  const bulkBtns = document.querySelectorAll('[onclick*="bulkTriageInbox"], [onclick*="bulkPromoteInbox"]');
  bulkBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });
  showToast(`${statusLabel} ${ids.length} items...`, 'info');
  try {
    const res = await opsPost('/api/workflows?action=bulk_triage', { item_ids: ids, status });
    if (res.ok) {
      showToast(`${ids.length} item${ids.length > 1 ? 's' : ''} ${status}`, 'success');
      renderInboxTriage();
    } else {
      showToast(res.error || 'Bulk triage failed', 'error');
    }
  } catch (e) {
    showToast('Bulk triage error: ' + e.message, 'error');
  } finally {
    bulkBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
  }
}

async function bulkPromoteInbox() {
  if (!opsInboxSelected.size) { showToast('Select items first', 'error'); return; }
  const bulkBtns = document.querySelectorAll('[onclick*="bulkTriageInbox"], [onclick*="bulkPromoteInbox"]');
  bulkBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });
  showToast(`Promoting ${opsInboxSelected.size} items...`, 'info');
  let promoted = 0, failed = 0;
  try {
    for (const id of opsInboxSelected) {
      const res = await opsPost('/api/workflows?action=promote_to_shared', { inbox_item_id: id });
      if (res.ok) promoted++; else failed++;
    }
    if (failed) showToast(`${promoted} promoted, ${failed} failed`, promoted ? 'success' : 'error');
    else showToast(`${promoted} item${promoted > 1 ? 's' : ''} promoted to shared actions`, 'success');
    renderInboxTriage();
  } catch (e) {
    showToast('Promote error: ' + e.message, 'error');
  } finally {
    bulkBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
  }
}

async function triageSingle(id) {
  const res = await opsPatch(`/api/inbox?id=${id}`, { status: 'triaged' });
  if (res.ok) showToast('Triaged', 'success');
  else showToast(res.error || 'Triage failed', 'error');
  renderInboxTriage();
}

async function promoteSingle(id) {
  const res = await opsPost('/api/workflows?action=promote_to_shared', { inbox_item_id: id });
  if (res.ok) showToast('Promoted to shared action', 'success');
  else showToast(res.error || 'Promotion failed', 'error');
  renderInboxTriage();
}

async function dismissSingle(id) {
  const res = await opsPatch(`/api/inbox?id=${id}`, { status: 'dismissed' });
  if (res.ok) showToast('Dismissed', 'success');
  else showToast(res.error || 'Dismiss failed', 'error');
  renderInboxTriage();
}

// ============================================================================
// ENTITIES — canonical model browser
// ============================================================================
async function renderEntitiesPage(page = opsEntitiesPage) {
  const el = document.getElementById('entitiesContent');
  if (!el) return;
  opsEntitiesPage = Math.max(parseInt(page, 10) || 1, 1);
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:entities');

  const res = await opsApi(`/api/entities?page=${opsEntitiesPage}&per_page=25`);
  if (!res.ok) {
    el.innerHTML = `<div class="ops-empty">Could not load entities.<br><small>${esc(res.error)}</small></div>`;
    perf.end();
    return;
  }

  opsEntitiesData = res.data?.entities || res.data || [];
  opsPagination['/api/entities'] = res.data?.pagination || null;
  const counts = {};
  opsEntitiesData.forEach(e => { counts[e.entity_type] = (counts[e.entity_type] || 0) + 1; });

  let html = '';
  html += `<div class="ops-header">
    <h2>Entities <span style="font-size:13px;color:var(--text2);font-weight:400">${opsEntitiesData.length}</span></h2>
  </div>`;

  html += '<div class="ops-filters">';
  html += `<button class="ops-filter ${opsEntityFilter === 'all' ? 'active' : ''}" onclick="opsEntityFilter='all';opsEntitiesPage=1;renderEntitiesPage()">All (${opsEntitiesData.length})</button>`;
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([type, ct]) => {
    html += `<button class="ops-filter ${opsEntityFilter === type ? 'active' : ''}" onclick="opsEntityFilter=decodeURIComponent('${encodeURIComponent(type)}');opsEntitiesPage=1;renderEntitiesPage()">${esc(type)} (${ct})</button>`;
  });
  html += '</div>';

  const filtered = opsEntityFilter === 'all' ? opsEntitiesData : opsEntitiesData.filter(e => e.entity_type === opsEntityFilter);

  if (!filtered.length) {
    html += emptyStateHTML(
      '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
      opsEntityFilter === 'all' ? 'No entities yet' : 'No matching entities',
      opsEntityFilter === 'all' ? 'Entities are created when you sync connectors or import data.' : 'Try selecting a different entity type.',
      null, null
    );
  } else {
    filtered.forEach(entity => {
      html += `<div class="entity-card" onclick="viewEntity(decodeURIComponent('${encodeURIComponent(entity.id)}'))">
        <div class="entity-card-header">
          <span class="entity-card-name">${esc(entity.name)}</span>
          <span class="entity-card-type">${esc(entity.entity_type || 'unknown')}</span>
        </div>
        <div class="entity-card-meta">
          ${entity.domain ? `<span>${esc(entity.domain)}</span>` : ''}
          ${entity.status ? `<span>${esc(entity.status)}</span>` : ''}
          ${entity.city || entity.state ? `<span>${esc([entity.city, entity.state].filter(Boolean).join(', '))}</span>` : ''}
          ${freshnessHTML(entity.updated_at)}
        </div>
      </div>`;
    });
  }

  html += paginationHTML('/api/entities', 'renderEntitiesPage');

  el.innerHTML = html;
  perf.end();
}

async function renderDataQualityPage() {
  const el = document.getElementById('dataQualityContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:data_quality');

  const [summaryRes, detailRes] = await Promise.all([
    opsApi('/api/entities?action=quality'),
    opsApi('/api/entities?action=quality_details')
  ]);

  if (!summaryRes.ok) {
    el.innerHTML = `<div class="ops-empty">Could not load data quality.<br><small>${esc(summaryRes.error)}</small></div>`;
    perf.end();
    return;
  }

  const summary = summaryRes.data || {};
  const detail = detailRes.ok ? (detailRes.data || {}) : {};
  const precedenceRows = detail.source_precedence || [];

  let html = '<div class="ops-header"><h2>Data Quality</h2></div>';
  html += '<div class="metrics-grid">';
  html += metricCardHTML('Unlinked', summary.unlinked || 0, 'entities needing links', (summary.unlinked || 0) > 0 ? 'yellow' : 'green');
  html += metricCardHTML('Stale Links', summary.stale_identities || 0, '7+ days old', (summary.stale_identities || 0) > 0 ? 'yellow' : 'green');
  html += metricCardHTML('Orphaned Actions', summary.orphaned_actions || 0, 'entity missing', (summary.orphaned_actions || 0) > 0 ? 'red' : 'green');
  html += metricCardHTML('Aliases', summary.total_aliases || 0, 'dedup coverage');
  html += '</div>';

  const sections = [
    { title: 'Duplicate Candidates', items: detail.duplicate_candidates || [], render: item => `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(item.canonical_name || 'Unnamed')}</span><div class="q-item-badges"><span class="q-badge pri-high">${item.duplicate_count || item.count || 0} matches</span></div></div><div class="q-item-meta">${(item.entity_names || []).map(esc).join(' · ')}</div><div class="q-actions"><button class="q-action" onclick="qualityAddAlias(${jsStringArg(item.entity_ids?.[0])}, ${jsStringArg(item.canonical_name || item.entity_names?.[0] || '')})">Add Alias</button><button class="q-action" onclick="qualityMergeDuplicate(${jsStringArg(JSON.stringify(item.entity_ids || []))}, ${jsStringArg(JSON.stringify(item.entity_names || []))})">Merge First Pair</button><button class="q-action primary" onclick="createQualityFollowup(${jsStringArg(`Review duplicate entity group: ${item.canonical_name || 'unnamed'}`)})">Create Follow-up</button></div></div>` },
    { title: 'Unlinked Entities', items: detail.unlinked_entities || [], render: item => `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(item.name)}</span><div class="q-item-badges">${item.entity_type ? typeBadge(item.entity_type) : ''}${item.domain ? domainBadge(item.domain) : ''}</div></div><div class="q-item-meta">${esc([item.city, item.state].filter(Boolean).join(', '))}</div><div class="q-actions"><button class="q-action" onclick="navTo('pageEntities')">Review</button><button class="q-action" onclick="qualityLinkIdentity(${jsStringArg(item.id)}, ${jsStringArg(item.name || 'entity')})">Link Identity</button><button class="q-action primary" onclick="createQualityFollowup(${jsStringArg(`Link external identity for ${item.name || 'entity'}`)})">Create Follow-up</button></div></div>` },
    { title: 'Stale Identities', items: detail.stale_identities || [], render: item => `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(item.entity_name || item.external_id)}</span><div class="q-item-badges">${item.source_system ? typeBadge(item.source_system) : ''}</div></div><div class="q-item-meta">${freshnessHTML(item.last_synced_at)}</div><div class="q-actions"><button class="q-action" onclick="qualitySetPrecedence('*', ${jsStringArg(item.source_system || '')}, 60)">Prefer Source</button><button class="q-action primary" onclick="createQualityFollowup(${jsStringArg(`Refresh stale identity for ${item.entity_name || item.external_id || 'entity'}`)})">Create Follow-up</button></div></div>` },
    { title: 'Low Completeness', items: detail.low_completeness || [], render: item => `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(item.name)}</span><div class="q-item-badges"><span class="q-badge pri-high">${item.completeness_score || 0}% complete</span></div></div><div class="q-item-meta">${item.entity_type ? typeBadge(item.entity_type) : ''}${item.domain ? domainBadge(item.domain) : ''}</div><div class="q-actions"><button class="q-action" onclick="qualityAddAlias(${jsStringArg(item.id)}, ${jsStringArg(item.name || '')})">Add Alias</button><button class="q-action primary" onclick="createQualityFollowup(${jsStringArg(`Enrich low-completeness entity: ${item.name || 'entity'}`)})">Create Follow-up</button></div></div>` },
    { title: 'Orphaned Actions', items: detail.orphaned_actions || [], render: item => `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(item.title)}</span><div class="q-item-badges">${statusBadge(item.status)}${item.domain ? domainBadge(item.domain) : ''}</div></div><div class="q-actions"><button class="q-action primary" onclick="navTo('pageTeamQueue')">Review Queue</button></div></div>` }
  ];

  html += '<div class="widget"><div class="widget-title">Source Precedence</div>';
  html += `<div class="q-item"><div class="q-item-meta">Use this to prefer a source for a field during manual reconciliation.</div><div class="q-actions"><button class="q-action primary" onclick="qualitySetPrecedence()">Set Precedence</button></div></div>`;
  if (!precedenceRows.length) {
    html += '<div class="ops-empty">No overrides configured</div>';
  } else {
    precedenceRows.slice(0, 10).forEach(row => {
      html += `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(row.field_name || '*')}</span><div class="q-item-badges"><span class="q-badge pri-high">${Number(row.precedence || 0)}</span></div></div><div class="q-item-meta">${esc(row.source_system || 'unknown')}</div><div class="q-actions"><button class="q-action" onclick="qualitySetPrecedence(${jsStringArg(row.field_name || '*')}, ${jsStringArg(row.source_system || '')}, ${Number(row.precedence || 50)})">Edit</button></div></div>`;
    });
  }
  html += '</div>';

  sections.forEach(section => {
    html += `<div class="widget"><div class="widget-title">${section.title}</div>`;
    if (!section.items.length) html += '<div class="ops-empty">No current issues</div>';
    else section.items.slice(0, 10).forEach(item => { html += section.render(item); });
    html += '</div>';
  });

  el.innerHTML = html;
  perf.end();
}

function viewEntity(entityId) {
  // Navigate to entity detail (leverages existing detail panel)
  if (typeof openEntityDetail === 'function') {
    openEntityDetail(entityId);
  } else {
    showToast('Entity detail view coming soon');
  }
}

// ============================================================================
// RESEARCH — research task queue
// ============================================================================
async function renderResearchPage(page = opsResearchPage) {
  const el = document.getElementById('researchContent');
  if (!el) return;
  opsResearchPage = Math.max(parseInt(page, 10) || 1, 1);
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:research');

  const statusParam = opsResearchFilter === 'active' ? 'active'
    : opsResearchFilter === 'completed' ? 'completed'
    : '';
  const res = await opsApi(`/api/queue?view=research&page=${opsResearchPage}&per_page=25${statusParam ? `&status=${statusParam}` : ''}`);
  if (!res.ok) {
    el.innerHTML = `<div class="ops-empty">Could not load research tasks.<br><small>${esc(res.error)}</small></div>`;
    perf.end();
    return;
  }

  opsResearchData = res.data?.items || res.data || [];

  let html = '';
  html += `<div class="ops-header">
    <h2>Research <span style="font-size:13px;color:var(--text2);font-weight:400">${opsResearchData.length} tasks</span></h2>
  </div>`;

  html += '<div class="ops-filters">';
  html += `<button class="ops-filter ${opsResearchFilter === 'active' ? 'active' : ''}" onclick="opsResearchFilter='active';opsResearchPage=1;renderResearchPage()">Active</button>`;
  html += `<button class="ops-filter ${opsResearchFilter === 'completed' ? 'active' : ''}" onclick="opsResearchFilter='completed';opsResearchPage=1;renderResearchPage()">Completed</button>`;
  html += `<button class="ops-filter ${opsResearchFilter === 'all' ? 'active' : ''}" onclick="opsResearchFilter='all';opsResearchPage=1;renderResearchPage()">All</button>`;
  html += '</div>';

  const filtered = opsResearchFilter === 'all' ? opsResearchData
    : opsResearchFilter === 'active' ? opsResearchData.filter(r => ['queued', 'in_progress'].includes(r.status))
    : opsResearchData.filter(r => r.status === 'completed');

  if (!filtered.length) {
    html += '<div class="ops-empty">No research tasks match this filter</div>';
  } else {
    filtered.forEach(item => {
      html += `<div class="q-item">
        <div class="q-item-header">
          <span class="q-item-title">${esc(item.title)}</span>
          <div class="q-item-badges">
            ${statusBadge(item.status)}
            ${item.research_type ? typeBadge(item.research_type) : ''}
            ${item.domain ? domainBadge(item.domain) : ''}
          </div>
        </div>
        <div class="q-item-meta">
          ${item.assignee_name ? `<span class="q-assignee">${esc(item.assignee_name)}</span>` : '<span style="color:var(--yellow)">Unassigned</span>'}
          ${freshnessHTML(item.updated_at || item.created_at)}
        </div>
        <div class="q-actions">
          ${item.status !== 'completed' ? `<button class="q-action primary" onclick="completeResearch(decodeURIComponent('${encodeURIComponent(item.id)}'))">Complete</button>` : ''}
          ${item.status !== 'completed' ? `<button class="q-action" onclick="createFollowup(decodeURIComponent('${encodeURIComponent(item.id)}'))">Follow-up</button>` : ''}
          <button class="q-action" onclick="runResearchAssistant(decodeURIComponent('${encodeURIComponent(item.id)}'))">Assist</button>
          <button class="q-action" onclick="exportResearchTaskBrief(decodeURIComponent('${encodeURIComponent(item.id)}'),'chatgpt')">ChatGPT</button>
          <button class="q-action" onclick="exportResearchTaskBrief(decodeURIComponent('${encodeURIComponent(item.id)}'),'claude')">Claude</button>
        </div>
        ${researchAssistantPanelHTML(item.id)}
      </div>`;
    });
  }

  html += paginationHTML('/api/queue?view=research', 'renderResearchPage');

  el.innerHTML = html;
  perf.end();
}

async function completeResearch(id) {
  const res = await opsPost('/api/workflows?action=research_followup', {
    research_task_id: id
  });
  if (res.ok) showToast('Research completed', 'success');
  else showToast(res.error || 'Failed', 'error');
  refreshActiveOpsPage();
}

async function createFollowup(id) {
  const members = await loadWorkspaceMembers();
  const select = document.getElementById('followupUserSelect');
  if (!select) return;
  select.innerHTML = members
    .filter(m => m.is_active !== false)
    .map(m => `<option value="${esc(m.user_id)}">${esc(m.display_name || m.email || m.user_id)}</option>`)
    .join('');
  const titleInput = document.getElementById('followupTitleInput');
  const dueInput = document.getElementById('followupDueInput');
  const notesInput = document.getElementById('followupNotesInput');
  const ctxEl = document.getElementById('followupContext');
  const modalEl = document.getElementById('followupModal');
  if (titleInput) titleInput.value = '';
  if (dueInput) dueInput.value = '';
  if (notesInput) notesInput.value = '';
  if (ctxEl) ctxEl.textContent = 'Create a follow-up action and complete this research task.';
  opsFollowupModalState = { researchTaskId: id };
  if (modalEl) modalEl.classList.add('open');
}

async function qualityMergeDuplicate(entityIdsJson, entityNamesJson) {
  let entityIds = [];
  let entityNames = [];
  try { entityIds = JSON.parse(entityIdsJson || '[]'); } catch (_) {}
  try { entityNames = JSON.parse(entityNamesJson || '[]'); } catch (_) {}
  if (!entityIds || entityIds.length < 2) {
    showToast('Need at least two entities to merge', 'error');
    return;
  }
  const targetId = entityIds[0];
  const sourceId = entityIds[1];
  const label = `${entityNames[1] || sourceId} -> ${entityNames[0] || targetId}`;
  if (!(await lccConfirm('Merge duplicate pair ' + label + '?', 'Merge'))) return;
  const res = await opsPost('/api/entities?action=merge', { target_id: targetId, source_id: sourceId });
  if (!res.ok) {
    showToast('Merge failed: ' + (res.error || 'unknown error'), 'error');
    return;
  }
  showToast('Entities merged', 'success');
  refreshActiveOpsPage();
}

async function qualityAddAlias(entityId, suggestedAlias) {
  if (!entityId) {
    showToast('No entity selected', 'error');
    return;
  }
  const alias = await lccPrompt('Alias name', suggestedAlias || '');
  if (!alias) return;
  const res = await opsPost('/api/entities?action=add_alias', {
    entity_id: entityId,
    alias_name: alias,
    source: 'data_quality'
  });
  if (!res.ok) {
    showToast('Alias save failed: ' + (res.error || 'unknown error'), 'error');
    return;
  }
  showToast('Alias saved', 'success');
  refreshActiveOpsPage();
}

async function qualityLinkIdentity(entityId, entityName) {
  if (!entityId) {
    showToast('No entity selected', 'error');
    return;
  }
  const sourceSystem = await lccPrompt('Source system for ' + (entityName || 'entity'), 'gov_supabase');
  if (!sourceSystem) return;
  const sourceType = await lccPrompt('Source type', 'asset');
  if (!sourceType) return;
  const externalId = await lccPrompt('External ID');
  if (!externalId) return;
  const externalUrl = (await lccPrompt('External URL (optional)', '')) || null;
  const res = await opsPost('/api/entities?action=link', {
    entity_id: entityId,
    source_system: sourceSystem,
    source_type: sourceType,
    external_id: externalId,
    external_url: externalUrl,
    metadata: { source: 'data_quality' }
  });
  if (!res.ok) {
    showToast('Identity link failed: ' + (res.error || 'unknown error'), 'error');
    return;
  }
  showToast('Identity linked', 'success');
  refreshActiveOpsPage();
}

async function qualitySetPrecedence(defaultField, defaultSource, defaultPrecedence) {
  const fieldName = await lccPrompt('Field name ("*" for default)', defaultField || '*');
  if (!fieldName) return;
  const sourceSystem = await lccPrompt('Source system', defaultSource || 'manual');
  if (!sourceSystem) return;
  const precedence = await lccPrompt('Precedence (0-100)', String(defaultPrecedence != null ? defaultPrecedence : 80));
  if (precedence === null) return;
  const parsed = Number(precedence);
  if (Number.isNaN(parsed)) {
    showToast('Precedence must be numeric', 'error');
    return;
  }
  const res = await opsPost('/api/entities?action=set_precedence', {
    field_name: fieldName,
    source_system: sourceSystem,
    precedence: parsed
  });
  if (!res.ok) {
    showToast('Precedence save failed: ' + (res.error || 'unknown error'), 'error');
    return;
  }
  showToast('Source precedence saved', 'success');
  refreshActiveOpsPage();
}

function buildResearchTaskBrief(item) {
  if (!item) return '';
  return [
    'You are helping complete a commercial real estate research task in Life Command Center.',
    'Use the task details below and produce a compact analyst-ready brief.',
    '',
    'Task',
    `- Title: ${item.title || 'Untitled'}`,
    `- Research type: ${item.research_type || 'Unknown'}`,
    `- Domain: ${item.domain || 'Unknown'}`,
    `- Status: ${item.status || 'Unknown'}`,
    `- Assignee: ${item.assignee_name || 'Unassigned'}`,
    '',
    'Instructions',
    item.instructions || 'No additional instructions provided.',
    '',
    'Return in this format:',
    '1. What this task is asking for',
    '2. Best next steps',
    '3. Risks / missing data',
    '4. Draft completion note',
    '5. Draft follow-up action if needed',
  ].join('\n');
}

async function exportResearchTaskBrief(id, provider) {
  const item = (opsResearchData || []).find(r => r.id === id);
  if (!item) {
    showToast('Research task not found', 'error');
    return;
  }

  const brief = buildResearchTaskBrief(item);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(brief);
    }
  } catch (e) {
    console.warn('Research brief clipboard warning:', e);
  }

  window.open(provider === 'claude' ? 'https://claude.ai/chats' : 'https://chatgpt.com/', '_blank', 'noopener');
  showToast(`Research brief copied. Paste it into ${provider === 'claude' ? 'Claude' : 'ChatGPT'}.`, 'success');
}

function buildResearchAssistantPrompt(item) {
  if (!item) return '';
  return [
    'You are assisting with a commercial real estate research task inside Life Command Center.',
    'Provide a concise workflow answer focused on execution.',
    '',
    'Task Context',
    `- Title: ${item.title || 'Untitled'}`,
    `- Research type: ${item.research_type || 'Unknown'}`,
    `- Domain: ${item.domain || 'Unknown'}`,
    `- Status: ${item.status || 'Unknown'}`,
    `- Assignee: ${item.assignee_name || 'Unassigned'}`,
    '',
    'Instructions',
    item.instructions || 'No additional instructions.',
    '',
    'Return in this format:',
    '1. What this task is really asking for',
    '2. Best next 3 steps',
    '3. Missing data or blockers',
    '4. Draft completion note',
    '5. Draft follow-up action if needed',
  ].join('\n');
}

function extractAssistantSection(text, headingNumber) {
  if (!text) return '';
  const pattern = new RegExp(`(?:^|\\n)${headingNumber}\\.\\s+[^\\n]*\\n([\\s\\S]*?)(?=\\n\\d+\\.\\s+|$)`, 'i');
  const match = text.match(pattern);
  return (match?.[1] || '').trim();
}

async function runResearchAssistant(id) {
  const item = (opsResearchData || []).find(r => r.id === id);
  if (!item) {
    showToast('Research task not found', 'error');
    return;
  }

  opsResearchAssistantState[id] = { open: true, loading: true, reply: '', error: '' };
  renderResearchPage();

  try {
    const reply = await invokeLccAssistant({
      message: buildResearchAssistantPrompt(item),
      context: {
        feature: 'ops_research_assistant',
        task_id: item.id,
        research_type: item.research_type || null,
        domain: item.domain || null,
      },
      feature: 'ops_research_assistant',
    });
    opsResearchAssistantState[id] = { open: true, loading: false, reply, error: '' };
  } catch (e) {
    opsResearchAssistantState[id] = { open: true, loading: false, reply: '', error: e.message };
  }

  renderResearchPage();
}

async function copyResearchAssistantReply(id) {
  const reply = opsResearchAssistantState[id]?.reply || '';
  if (!reply) {
    showToast('No assistant reply to copy', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(reply);
    showToast('Assistant reply copied', 'success');
  } catch {
    showToast('Copy failed', 'error');
  }
}

async function useResearchAssistantFollowup(id) {
  const item = (opsResearchData || []).find(r => r.id === id);
  const reply = opsResearchAssistantState[id]?.reply || '';
  if (!item || !reply) {
    showToast('No assistant draft available', 'error');
    return;
  }

  await createFollowup(id);

  const titleInput = document.getElementById('followupTitleInput');
  const notesInput = document.getElementById('followupNotesInput');
  const followupDraft = extractAssistantSection(reply, 5);
  const completionDraft = extractAssistantSection(reply, 4);

  if (titleInput) {
    const firstLine = (followupDraft || '').split('\n')[0].replace(/^[-*]\s*/, '').trim();
    titleInput.value = firstLine || `Follow up: ${item.title || 'research task'}`;
  }
  if (notesInput) {
    notesInput.value = [
      completionDraft ? `Completion note:\n${completionDraft}` : '',
      followupDraft ? `Follow-up draft:\n${followupDraft}` : ''
    ].filter(Boolean).join('\n\n');
  }
  const ctxEl = document.getElementById('followupContext');
  if (ctxEl) ctxEl.textContent = 'Assistant draft loaded. Review and create the follow-up action.';
  showToast('Follow-up draft loaded', 'success');
}

function closeAssignModal() {
  opsAssignModalState = null;
  document.getElementById('assignModal')?.classList.remove('open');
}

let _submitAssigning = false;
async function submitAssignModal() {
  if (!opsAssignModalState || _submitAssigning) return;
  const assigned_to = document.getElementById('assignUserSelect')?.value;
  if (!assigned_to) { showToast('Please select a user to assign to', 'error'); return; }
  _submitAssigning = true;
  const btn = document.querySelector('#assignModal .modal-actions button.primary, #assignModal button[onclick*="submitAssignModal"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Assigning...'; }
  try {
    showToast('Assigning...', 'info');
    const res = await opsPost('/api/workflows?action=reassign', {
      item_type: opsAssignModalState.itemType || 'action',
      item_id: opsAssignModalState.itemId,
      assigned_to
    });
    if (res.ok) {
      closeAssignModal();
      showToast('Assigned successfully', 'success');
      const activePage = document.querySelector('.page.active');
      if (activePage) handlePageLoad(activePage.id);
    } else {
      showToast(res.error || 'Assign failed', 'error');
    }
  } finally {
    _submitAssigning = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Assign'; }
  }
}

function closeEscalateModal() {
  opsEscalateModalState = null;
  document.getElementById('escalateModal')?.classList.remove('open');
}

let _submitEscalating = false;
async function submitEscalateModal() {
  if (!opsEscalateModalState || _submitEscalating) return;
  const escalate_to = document.getElementById('escalateUserSelect')?.value;
  const reason = document.getElementById('escalateReason')?.value?.trim();
  if (!escalate_to || !reason) {
    showToast('Select a manager and provide a reason', 'error');
    return;
  }
  _submitEscalating = true;
  const btn = document.querySelector('#escalateModal .modal-actions button.primary, #escalateModal button[onclick*="submitEscalateModal"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Escalating...'; }
  try {
    showToast('Escalating...', 'info');
    const res = await opsPost('/api/workflows?action=escalate', {
      action_item_id: opsEscalateModalState.itemId,
      escalate_to,
      reason
    });
    if (res.ok) {
      closeEscalateModal();
      showToast('Escalated successfully', 'success');
      const activePage = document.querySelector('.page.active');
      if (activePage) handlePageLoad(activePage.id);
    } else {
      showToast(res.error || 'Escalation failed', 'error');
    }
  } finally {
    _submitEscalating = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Escalate'; }
  }
}

function closeFollowupModal() {
  opsFollowupModalState = null;
  document.getElementById('followupModal')?.classList.remove('open');
}

let _submitFollowingUp = false;
async function submitFollowupModal() {
  if (!opsFollowupModalState || _submitFollowingUp) return;
  const followup_title = document.getElementById('followupTitleInput')?.value?.trim();
  const followup_description = document.getElementById('followupNotesInput')?.value?.trim() || null;
  const assigned_to = document.getElementById('followupUserSelect')?.value;
  const due_date = document.getElementById('followupDueInput')?.value || null;
  if (!followup_title) {
    showToast('Follow-up title is required', 'error');
    return;
  }
  _submitFollowingUp = true;
  const btn = document.querySelector('#followupModal .modal-actions button.primary, #followupModal button[onclick*="submitFollowupModal"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
  try {
    showToast('Creating follow-up...', 'info');
    const res = await opsPost('/api/workflows?action=research_followup', {
      research_task_id: opsFollowupModalState.researchTaskId,
      followup_title,
      followup_description,
      followup_type: 'follow_up',
      assigned_to,
      due_date
    });
    if (res.ok) {
      closeFollowupModal();
      showToast('Research completed + follow-up created', 'success');
      refreshActiveOpsPage();
    } else {
      showToast(res.error || 'Failed', 'error');
    }
  } finally {
    _submitFollowingUp = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Create Follow-up'; }
  }
}

async function createQualityFollowup(title) {
  const res = await opsPost('/api/actions', {
    title,
    action_type: 'follow_up',
    priority: 'normal',
    visibility: 'shared',
    metadata: { source: 'data_quality' }
  });
  if (res.ok) {
    showToast('Follow-up created', 'success');
    refreshActiveOpsPage();
  } else {
    showToast(res.error || 'Could not create follow-up', 'error');
  }
}

// ============================================================================
// METRICS — work counts, team performance
// ============================================================================
async function renderMetricsPage() {
  const el = document.getElementById('metricsContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:metrics');

  const [countsRes, oversightRes, syncHealthRes] = await Promise.all([
    opsApi('/api/queue?view=work_counts'),
    opsApi('/api/workflows?action=oversight'),
    opsApi('/api/sync?action=health')
  ]);

  let html = '';
  html += workspaceContextHTML();
  html += '<div class="ops-header"><h2>Metrics</h2></div>';

  // Work counts - SYNC FIX: Use canonicalCounts as fallback when available
  // This ensures consistency between Dashboard stats and Metrics page
  let countsData = countsRes.ok ? (countsRes.data || {}) : {};
  if (!countsRes.ok && typeof canonicalCounts !== 'undefined' && canonicalCounts) {
    countsData = canonicalCounts;
  }

  if (countsRes.ok || (typeof canonicalCounts !== 'undefined' && canonicalCounts)) {
    const c = countsData;
    html += '<div class="metrics-grid">';
    html += metricCardHTML('My Actions', c.my_actions || c.my_open || 0, 'assigned to me');
    html += metricCardHTML('Team Actions', c.team_actions || c.team_open || 0, 'shared queue');
    html += metricCardHTML('Inbox', c.inbox_new || 0, 'needs triage', c.inbox_new > 10 ? 'yellow' : '');
    html += metricCardHTML('Overdue', c.overdue || 0, 'past due date', c.overdue > 0 ? 'red' : 'green');
    html += metricCardHTML('In Progress', c.in_progress || 0, 'active work');
    html += metricCardHTML('Completed (7d)', c.completed_week || 0, 'this week', 'green');
    html += metricCardHTML('Research', c.research_active || 0, 'active tasks');
    html += metricCardHTML('Sync Errors', c.sync_errors || 0, 'connectors', c.sync_errors > 0 ? 'red' : 'green');
    html += '</div>';
    if (c.refreshed_at) {
      html += `<div class="widget" style="margin-top:12px"><div class="q-item-meta">Counts refreshed ${freshnessHTML(c.refreshed_at)}</div></div>`;
    }
  }

  if (syncHealthRes.ok && syncHealthRes.data) {
    const summary = syncHealthRes.data.summary || {};
    const drift = syncHealthRes.data.queue_drift || {};
    html += '<div class="widget"><div class="widget-title">Operational Signals</div>';
    html += '<div class="metrics-grid">';
    html += metricCardHTML(
      'Outbound Success',
      summary.outbound_success_rate_24h != null ? Math.round(summary.outbound_success_rate_24h * 100) + '%' : '--',
      'last 24h',
      summary.outbound_success_rate_24h != null && summary.outbound_success_rate_24h < 0.9 ? 'red' : 'green'
    );
    html += metricCardHTML('Degraded Connectors', summary.degraded || 0, 'need attention', (summary.degraded || 0) > 0 ? 'yellow' : 'green');
    html += metricCardHTML('Queue Drift Gap', drift.estimated_gap || 0, 'Salesforce open-task delta', drift.drift_flag ? 'red' : 'green');
    html += metricCardHTML('Drift Status', drift.drift_flag ? 'Review' : 'Stable', drift.source || 'sync health', drift.drift_flag ? 'red' : 'green');
    html += '</div></div>';
  }

  // Team overview (manager only)
  if (oversightRes.ok && oversightRes.data?.team?.length) {
    html += '<div class="widget"><div class="widget-title">Team Overview</div>';
    oversightRes.data.team.forEach(member => {
      const initials = (member.display_name || '??').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      html += `<div class="team-row">
        <div class="team-avatar">${esc(initials)}</div>
        <div class="team-info">
          <div class="team-name">${esc(member.display_name)}</div>
          <div class="team-role">${esc(member.role || 'viewer')}</div>
        </div>
        <div class="team-stats">
          <div class="stat"><span class="stat-n">${member.active_actions || 0}</span>Active</div>
          <div class="stat"><span class="stat-n" style="${member.overdue_actions > 0 ? 'color:var(--red)' : ''}">${member.overdue_actions || 0}</span>Overdue</div>
          <div class="stat"><span class="stat-n" style="color:var(--green)">${member.completed_this_week || 0}</span>Done/wk</div>
          <div class="stat"><span class="stat-n">${member.untriaged_inbox || 0}</span>Inbox</div>
        </div>
      </div>`;
    });
    html += '</div>';
  }

  // Open escalations
  if (oversightRes.ok && oversightRes.data?.open_escalations?.length) {
    html += '<div class="widget" style="border-color:var(--orange)"><div class="widget-title">Open Escalations</div>';
    oversightRes.data.open_escalations.forEach(escalation => {
      html += `<div class="q-item high-pri">
        <div class="q-item-title">${esc(escalation.action_items?.title || 'Unknown action')}</div>
        <div class="q-item-meta">
          <span>From: ${esc(escalation.users?.display_name || 'unknown')}</span>
          <span>Reason: ${esc(escalation.reason || '')}</span>
          ${freshnessHTML(escalation.created_at)}
        </div>
      </div>`;
    });
    html += '</div>';
  }

  el.innerHTML = html;
  perf.end();
}

function metricCardHTML(label, value, sub, colorClass) {
  return `<div class="metric-card-ops">
    <div class="mc-label">${label}</div>
    <div class="mc-value ${colorClass || ''}">${typeof value === 'number' ? value.toLocaleString() : value}</div>
    <div class="mc-sub">${sub}</div>
  </div>`;
}

// ============================================================================
// SYNC HEALTH — connector status and sync job monitoring
// ============================================================================
async function renderSyncHealthPage() {
  const el = document.getElementById('syncHealthContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:sync_health');

  const [connRes, healthRes] = await Promise.all([
    opsApi('/api/connectors?action=list'),
    opsApi('/api/sync?action=health')
  ]);

  let html = '<div class="ops-header"><h2>Sync Health</h2></div>';

  // Connector status cards
  const connectors = connRes.ok ? (connRes.data?.connectors || connRes.data || []) : [];

  if (connectors.length === 0) {
    html += emptyStateHTML(
      '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
      'No connectors configured',
      'Connect Outlook, Salesforce, or calendar to start syncing data into your workspace.',
      null, null
    );
  } else {
    connectors.forEach(conn => {
      const statusCls = conn.status === 'active' ? 'healthy' : conn.status === 'degraded' ? 'degraded' : conn.status === 'error' ? 'error' : 'healthy';
      const icon = conn.connector_type === 'email' ? 'E'
        : conn.connector_type === 'calendar' ? 'C'
        : conn.connector_type === 'salesforce' ? 'SF'
        : conn.connector_type?.substring(0, 2).toUpperCase() || '?';

      html += `<div class="sync-card ${statusCls}">
        <div class="sync-card-icon">${icon}</div>
        <div class="sync-card-info">
          <div class="sync-card-name">${esc(conn.connector_type || 'Unknown')} ${conn.label ? '(' + esc(conn.label) + ')' : ''}</div>
          <div class="sync-card-status">
            Status: ${esc(conn.status || 'unknown')}
            ${conn.last_synced_at ? ' \u00b7 Last sync: ' + freshnessHTML(conn.last_synced_at) : ''}
            ${conn.error_message ? ' \u00b7 <span style="color:var(--red)">' + esc(conn.error_message) + '</span>' : ''}
          </div>
        </div>
        <div class="sync-card-actions">
          <button class="q-action" onclick="triggerSync(decodeURIComponent('${encodeURIComponent(conn.connector_type)}'))">Sync Now</button>
        </div>
      </div>`;
    });
  }

  const health = healthRes.ok ? (healthRes.data || {}) : {};
  const summary = health.summary || {};
  const unresolvedErrors = health.unresolved_errors || [];
  const queueDrift = health.queue_drift || null;

  // Sync health summary
  if (healthRes.ok && healthRes.data) {
    html += '<div class="widget" style="margin-top:16px"><div class="widget-title">Sync Summary</div>';
    html += '<div class="metrics-grid">';
    html += metricCardHTML('Healthy', summary.healthy || 0, 'connectors');
    html += metricCardHTML('Degraded', summary.degraded || 0, 'connectors', (summary.degraded || 0) > 0 ? 'yellow' : 'green');
    html += metricCardHTML('Errors', unresolvedErrors.length, 'unresolved sync issues', unresolvedErrors.length > 0 ? 'red' : 'green');
    html += metricCardHTML(
      'Outbound Success',
      summary.outbound_success_rate_24h != null ? Math.round(summary.outbound_success_rate_24h * 100) + '%' : '--',
      'completed outbound jobs, 24h',
      summary.outbound_success_rate_24h != null && summary.outbound_success_rate_24h < 0.9 ? 'red' : 'green'
    );
    html += '</div></div>';
  }

  if (queueDrift) {
    html += '<div class="widget" style="margin-top:16px"><div class="widget-title">Queue Drift</div>';
    html += '<div class="metrics-grid">';
    html += metricCardHTML('Open SF Tasks', queueDrift.salesforce_open_task_count || 0, 'inbox items');
    html += metricCardHTML('Last SF Pull', queueDrift.last_sf_records_processed || 0, 'records processed');
    html += metricCardHTML('Estimated Gap', queueDrift.estimated_gap || 0, 'open tasks vs last pull', queueDrift.drift_flag ? 'red' : 'green');
    html += metricCardHTML('Drift Flag', queueDrift.drift_flag ? 'Review' : 'Stable', queueDrift.last_inbound_completed_at ? `last inbound ${freshnessHTML(queueDrift.last_inbound_completed_at)}` : 'no inbound timestamp', queueDrift.drift_flag ? 'red' : 'green');
    html += '</div>';
    html += `<div class="q-item" style="margin-top:12px">
      <div class="q-item-meta">
        <span>Source: ${esc(queueDrift.source || 'unknown')}</span>
        ${queueDrift.last_inbound_job_id ? `<span>Job: ${esc(queueDrift.last_inbound_job_id)}</span>` : ''}
      </div>
    </div>`;
    html += '</div>';
  }

  // Unresolved sync errors
  if (unresolvedErrors.length) {
    html += '<div class="widget" style="border-color:var(--red)"><div class="widget-title">Recent Errors</div>';
    unresolvedErrors.forEach(err => {
      html += `<div class="q-item overdue">
        <div class="q-item-header">
          <span class="q-item-title">${esc(err.error_code || 'Sync Error')}</span>
          ${freshnessHTML(err.created_at)}
        </div>
        <div class="q-item-meta"><span style="color:var(--red)">${esc(err.error_message || '')}</span></div>
        <div class="q-actions">
          <button class="q-action" onclick="retrySync(decodeURIComponent('${encodeURIComponent(err.id)}'))">Retry</button>
        </div>
      </div>`;
    });
    html += '</div>';
  }

  el.innerHTML = html;
  perf.end();

  // Append perf dashboard for managers
  setTimeout(appendPerfToSyncHealth, 100);
}

async function triggerSync(connectorType) {
  const actionMap = { email: 'ingest_emails', outlook: 'ingest_emails', calendar: 'ingest_calendar', salesforce: 'ingest_sf_activities' };
  const action = actionMap[connectorType] || 'ingest_' + connectorType;
  const res = await opsPost(`/api/sync?action=${action}`, {});
  if (res.ok) showToast(`Sync triggered for ${connectorType}`, 'success');
  else showToast(res.error || 'Sync trigger failed', 'error');
}

async function retrySync(errorId) {
  const res = await opsPost(`/api/sync?action=retry&error_id=${errorId}`, {});
  if (res.ok) showToast('Retry triggered', 'success');
  else showToast(res.error || 'Retry failed', 'error');
}

// ============================================================================
// QUICK ACTIONS on queue items
// ============================================================================

let _quickTransitioning = false;
async function quickTransition(itemId, newStatus, itemType) {
  if (_quickTransitioning) return;
  _quickTransitioning = true;
  try {
    const statusLabels = { in_progress: 'Started', completed: 'Completed', waiting: 'Set to waiting', open: 'Reopened' };
    const path = itemType === 'inbox' ? `/api/inbox?id=${itemId}` : `/api/actions?id=${itemId}`;
    showToast(`Updating...`, 'info');
    const res = await opsPatch(path, { status: newStatus });
    if (res.ok) {
      showToast(statusLabels[newStatus] || `Status → ${newStatus}`, 'success');
      const activePage = document.querySelector('.page.active');
      if (activePage) handlePageLoad(activePage.id);
    } else {
      showToast(res.error || 'Transition failed', 'error');
    }
  } finally {
    _quickTransitioning = false;
  }
}

async function quickReassign(itemId, itemType, itemTitle = 'this item') {
  const members = await loadWorkspaceMembers();
  if (!members.length) {
    showToast('No workspace members available', 'error');
    return;
  }
  const select = document.getElementById('assignUserSelect');
  if (!select) return;
  select.innerHTML = members
    .filter(m => m.is_active !== false)
    .map(m => `<option value="${esc(m.user_id)}">${esc(m.display_name || m.email || m.user_id)} (${esc(m.role || 'member')})</option>`)
    .join('');
  const assignCtx = document.getElementById('assignContext');
  if (assignCtx) assignCtx.textContent = `Assign: ${itemTitle}`;
  opsAssignModalState = { itemId, itemType: itemType || 'action' };
  const assignModal = document.getElementById('assignModal');
  if (assignModal) assignModal.classList.add('open');
}

async function quickEscalate(itemId, itemTitle = 'this item') {
  const members = await loadWorkspaceMembers();
  if (!members.length) {
    showToast('No workspace members available', 'error');
    return;
  }
  const select = document.getElementById('escalateUserSelect');
  if (!select) return;
  select.innerHTML = members
    .filter(m => ['owner', 'manager'].includes(m.role))
    .map(m => `<option value="${esc(m.user_id)}">${esc(m.display_name || m.email || m.user_id)} (${esc(m.role)})</option>`)
    .join('');
  const escCtx = document.getElementById('escalateContext');
  if (escCtx) escCtx.textContent = `Escalate: ${itemTitle}`;
  const escReason = document.getElementById('escalateReason');
  if (escReason) escReason.value = '';
  opsEscalateModalState = { itemId };
  const escModal = document.getElementById('escalateModal');
  if (escModal) escModal.classList.add('open');
}

// ============================================================================
// SHARED RENDERING HELPERS
// ============================================================================

function queueItemHTML(item, context, opts = {}) {
  const overdueCls = isOverdue(item.due_date) ? 'overdue' : '';
  const priCls = item.priority === 'urgent' ? 'urgent' : item.priority === 'high' ? 'high-pri' : '';

  let html = `<div class="q-item ${overdueCls} ${priCls}">`;
  html += '<div class="q-item-header">';
  html += `<span class="q-item-title">${esc(item.title || 'Untitled')}</span>`;
  html += '<div class="q-item-badges">';
  html += statusBadge(item.status);
  html += priBadge(item.priority);
  html += visBadge(item);
  if (item.action_type || item.item_type || item.sub_type) html += typeBadge(item.action_type || item.item_type || item.sub_type);
  if (item.domain) html += domainBadge(item.domain);
  html += '</div></div>';

  html += '<div class="q-item-meta">';
  if (item.entity_name) html += `<span class="q-entity" onclick="viewEntity(decodeURIComponent('${encodeURIComponent(item.entity_id)}'))">${esc(item.entity_name)}</span>`;
  if (item.assignee_name || item.owner_name) {
    const name = item.assignee_name || item.owner_name;
    html += `<span class="q-assignee">${esc(name)}</span>`;
  } else if (opts.showAssign) {
    html += '<span style="color:var(--yellow)">Unassigned</span>';
  }
  if (item.due_date) {
    const dueCls = isOverdue(item.due_date) ? 'overdue' : '';
    html += `<span class="q-due ${dueCls}">${relDate(item.due_date)}</span>`;
  }
  html += freshnessHTML(item.updated_at || item.created_at);
  html += '</div>';

  // Normalized quick actions — consistent across all contexts
  html += '<div class="q-actions">';
  if (item.status === 'open') html += `<button class="q-action primary" onclick="quickTransition(decodeURIComponent('${encodeURIComponent(item.id)}'),'in_progress','action')">Start</button>`;
  if (item.status === 'in_progress') html += `<button class="q-action primary" onclick="quickTransition(decodeURIComponent('${encodeURIComponent(item.id)}'),'completed','action')">Complete</button>`;
  if (item.status === 'open' || item.status === 'in_progress') {
    html += `<button class="q-action" onclick="quickTransition(decodeURIComponent('${encodeURIComponent(item.id)}'),'waiting','action')">Wait</button>`;
  }
  if (item.status === 'waiting') html += `<button class="q-action" onclick="quickTransition(decodeURIComponent('${encodeURIComponent(item.id)}'),'in_progress','action')">Resume</button>`;
  // Reassign available on all contexts for items that support it
  if (!item.assigned_to || opts.showAssign || context === 'team_queue') {
    html += `<button class="q-action" onclick="quickReassign(decodeURIComponent('${encodeURIComponent(item.id)}'),'action',${jsStringArg(item.title || 'Untitled')})">Assign</button>`;
  } else if (context !== 'my_work') {
    html += `<button class="q-action" onclick="quickReassign(decodeURIComponent('${encodeURIComponent(item.id)}'),'action',${jsStringArg(item.title || 'Untitled')})">Reassign</button>`;
  }
  // Escalate on all non-completed items (gated by flag)
  if (item.status !== 'completed' && item.status !== 'cancelled' && checkFlag('escalations_enabled')) {
    html += `<button class="q-action" onclick="quickEscalate(decodeURIComponent('${encodeURIComponent(item.id)}'),${jsStringArg(item.title || 'Untitled')})">Escalate</button>`;
  }
  html += '</div>';

  html += '</div>';
  return html;
}

function filterPill(value, label, currentVar, varName, refreshFn) {
  const active = value === currentVar ? 'active' : '';
  return `<button class="ops-filter ${active}" onclick="${varName}='${value}';${refreshFn}()">${label}</button>`;
}

function countByStatus(items) {
  const counts = {};
  items.forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1; });
  return counts;
}

function countOverdue(items) {
  return items.filter(i => isOverdue(i.due_date) && !['completed', 'cancelled'].includes(i.status)).length;
}

// --- Pagination controls HTML ---
function paginationHTML(paginationKey, refreshFn) {
  const p = opsPagination[paginationKey];
  if (!p || p.total_pages <= 1) return '';
  return `<div class="pager">
    <button ${p.has_prev ? `onclick="${refreshFn}(${p.page - 1})"` : 'disabled'}>Prev</button>
    <span>Page ${p.page} of ${p.total_pages} (${p.total} items)</span>
    <button ${p.has_next ? `onclick="${refreshFn}(${p.page + 1})"` : 'disabled'}>Next</button>
  </div>`;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function jsStringArg(s) {
  return `'${String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// ============================================================================
// PERFORMANCE DASHBOARD — manager-only operational perf view
// Accessible from Sync Health page or via navTo('pagePerfDashboard')
// ============================================================================

async function renderPerfDashboard(container) {
  // Render inside sync health page as a collapsible section, or standalone
  const el = container || document.getElementById('perfDashboardContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  const [summaryRes, slowRes, aiRes] = await Promise.all([
    opsApi('/api/queue-v2?view=_perf&section=summary'),
    opsApi('/api/queue-v2?view=_perf&section=slow'),
    opsApi('/api/queue-v2?view=_perf&section=ai')
  ]);

  if (!summaryRes.ok) {
    el.innerHTML = `<div class="ops-empty">${esc(summaryRes.data?.error || summaryRes.error || 'Could not load performance data')}</div>`;
    return;
  }

  const data = summaryRes.data;
  const slowData = slowRes.ok ? slowRes.data : {};
  const aiData = aiRes.ok ? aiRes.data : {};
  let html = '';

  html += '<div class="ops-header"><h2>Performance Dashboard</h2></div>';

  // MV freshness check
  if (data.mv_freshness) {
    const mv = data.mv_freshness;
    const staleClass = mv.freshness_status === 'fresh' ? 'green'
      : mv.freshness_status === 'acceptable' ? ''
      : mv.freshness_status === 'stale' ? 'yellow' : 'red';
    html += `<div class="degraded-banner" style="margin-bottom:12px">
      <span class="degraded-icon">~</span>
      <div class="degraded-body">
        <div class="degraded-title">Materialized Views: <span class="${staleClass}">${mv.freshness_status}</span></div>
        <div>Last refreshed ${Math.round(mv.minutes_stale)}m ago</div>
      </div>
    </div>`;
  }

  // Target compliance grid
  if (data.compliance?.length) {
    html += '<div class="widget"><div class="widget-title">Performance Target Compliance</div>';
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
    html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
      + '<th style="padding:6px">Endpoint</th>'
      + '<th style="padding:6px;text-align:right">Requests</th>'
      + '<th style="padding:6px;text-align:right">p50</th>'
      + '<th style="padding:6px;text-align:right">p95</th>'
      + '<th style="padding:6px;text-align:right">Target p95</th>'
      + '<th style="padding:6px;text-align:center">Status</th>'
      + '</tr></thead><tbody>';
    data.compliance.forEach(c => {
      const statusColor = c.compliance_status === 'passing' ? 'var(--green)'
        : c.compliance_status === 'warning' ? 'var(--yellow)'
        : c.compliance_status === 'failing' ? 'var(--red)' : 'var(--text3)';
      const statusLabel = c.compliance_status === 'no_data' ? '--' : c.compliance_status;
      html += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${esc(c.description || '')}">${esc(c.endpoint_pattern || '')}</td>
        <td style="padding:6px;text-align:right">${c.request_count != null ? c.request_count : '--'}</td>
        <td style="padding:6px;text-align:right">${c.actual_p50_ms != null ? Math.round(c.actual_p50_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right">${c.actual_p95_ms != null ? Math.round(c.actual_p95_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right">${c.target_p95_ms != null ? c.target_p95_ms + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:center;color:${statusColor};font-weight:600">${statusLabel}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  // Endpoint summary
  if (data.endpoints?.length) {
    html += '<div class="widget"><div class="widget-title">Endpoint Latency (24h)</div>';
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
    html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
      + '<th style="padding:6px">Endpoint</th>'
      + '<th style="padding:6px;text-align:right">Count</th>'
      + '<th style="padding:6px;text-align:right">Avg</th>'
      + '<th style="padding:6px;text-align:right">p95</th>'
      + '<th style="padding:6px;text-align:right">Max</th>'
      + '<th style="padding:6px;text-align:right">Slow%</th>'
      + '</tr></thead><tbody>';
    data.endpoints.forEach(ep => {
      const slowColor = ep.slow_pct > 10 ? 'color:var(--red)' : ep.slow_pct > 5 ? 'color:var(--yellow)' : '';
      html += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px;max-width:240px;overflow:hidden;text-overflow:ellipsis">${esc(ep.endpoint || '')}</td>
        <td style="padding:6px;text-align:right">${ep.request_count != null ? ep.request_count : '--'}</td>
        <td style="padding:6px;text-align:right">${ep.avg_ms != null ? Math.round(ep.avg_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right">${ep.p95_ms != null ? Math.round(ep.p95_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right">${ep.max_ms != null ? Math.round(ep.max_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right;${slowColor}">${ep.slow_pct != null ? ep.slow_pct + '%' : '--'}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  // Slow requests
  if (slowData.slow_requests?.length) {
    html += `<div class="widget" style="border-color:var(--orange)"><div class="widget-title">Slow Requests (24h) — ${slowData.slow_requests.length} found</div>`;
    slowData.slow_requests.slice(0, 20).forEach(sr => {
      html += `<div class="q-item">
        <div class="q-item-header">
          <span class="q-item-title">${esc(sr.endpoint)}</span>
          <div class="q-item-badges">
            <span class="q-badge pri-high">${sr.duration_ms != null ? sr.duration_ms : '?'}ms</span>
            <span class="q-badge type">${esc(sr.metric_type || '')}</span>
          </div>
        </div>
        <div class="q-item-meta">
          <span>Threshold: ${sr.threshold_ms != null ? sr.threshold_ms : '?'}ms</span>
          ${freshnessHTML(sr.recorded_at)}
        </div>
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<div class="widget"><div class="widget-title">Slow Requests (24h)</div><div class="ops-empty">No slow requests detected</div></div>';
  }

  if (aiData.summary) {
    const aiSummary = aiData.summary || {};
    const routeConfig = aiData.route_config || {};
    const rollout = aiData.rollout || {};
    const missingModel = Math.max(0, (aiSummary.total_calls || 0) - (aiSummary.calls_with_model || 0));
    const missingUsage = Math.max(0, (aiSummary.total_calls || 0) - (aiSummary.calls_with_usage || 0));
    const missingCache = Math.max(0, (aiSummary.total_calls || 0) - (aiSummary.calls_with_cache_data || 0));
    html += '<div class="widget"><div class="widget-title">AI Usage (Recent 200 Calls)</div>';
    const rolloutBadge = rollout.status === 'active' ? 'pri-low' : 'pri-high';
    const rolloutText = rollout.status === 'active'
      ? `Routing active · ${fmtN(rollout.override_count || 0)} override entries`
      : 'Routing still manual/default-only';
    html += `<div class="q-item" style="margin-bottom:12px">
      <div class="q-item-header">
        <span class="q-item-title">Rollout Readiness</span>
        <div class="q-item-badges">
          <span class="q-badge ${rolloutBadge}">${esc(rolloutText)}</span>
        </div>
      </div>
      <div class="q-item-meta">
        <span>${rollout.status === 'active' ? 'Feature routing config is present and should be observable below.' : 'Set AI_CHAT_POLICY or feature overrides to start a staged routing rollout.'}</span>
      </div>
    </div>`;
    if (rollout.suggestion) {
      html += `<div class="q-item" style="margin-bottom:12px;border-color:var(--accent)">
        <div class="q-item-header">
          <span class="q-item-title">Suggested Next Step</span>
        </div>
        <div class="q-item-meta">
          <span>${esc(rollout.suggestion)}</span>
        </div>
      </div>`;
    }
    if (aiData.presets?.length) {
      html += '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:12px">';
      html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
        + '<th style="padding:6px">Preset</th>'
        + '<th style="padding:6px">Artifact</th>'
        + '<th style="padding:6px">Use Case</th>'
        + '</tr></thead><tbody>';
      aiData.presets.forEach((preset) => {
        html += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px">${esc(preset.name || '')}</td>
          <td style="padding:6px">${esc(preset.file || '')}</td>
          <td style="padding:6px">${esc(preset.recommended_for || preset.description || '')}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += `<div class="q-item" style="margin-bottom:12px">
      <div class="q-item-header">
        <span class="q-item-title">Routing Policy</span>
        <div class="q-item-badges">
          <span class="q-badge type">${esc(routeConfig.policy || 'manual')}</span>
          <span class="q-badge type">${esc(routeConfig.default_provider || 'edge')}</span>
          <span class="q-badge type">${esc(routeConfig.default_model || 'gpt-5-mini')}</span>
        </div>
      </div>
      <div class="q-item-meta">
        <span>Default route for features without overrides</span>
      </div>
    </div>`;
    const featureProviderEntries = Object.entries(routeConfig.feature_providers || {});
    const featureModelEntries = Object.entries(routeConfig.feature_models || {});
    if (featureProviderEntries.length || featureModelEntries.length) {
      const featureKeys = [...new Set([...featureProviderEntries.map(([key]) => key), ...featureModelEntries.map(([key]) => key)])];
      html += '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:12px">';
      html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
        + '<th style="padding:6px">Feature</th>'
        + '<th style="padding:6px">Provider</th>'
        + '<th style="padding:6px">Model</th>'
        + '</tr></thead><tbody>';
      featureKeys.sort().forEach((feature) => {
        html += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px">${esc(feature)}</td>
          <td style="padding:6px">${esc(routeConfig.feature_providers?.[feature] || routeConfig.default_provider || 'edge')}</td>
          <td style="padding:6px">${esc(routeConfig.feature_models?.[feature] || routeConfig.default_model || 'gpt-5-mini')}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    if (aiData.mismatches?.length) {
      html += '<div class="q-item" style="margin-bottom:12px;border-color:var(--orange)">';
      html += '<div class="q-item-header"><span class="q-item-title">Routing Mismatches Detected</span>';
      html += `<div class="q-item-badges"><span class="q-badge pri-high">${fmtN(aiData.mismatches.length)}</span></div></div>`;
      html += '<div class="q-item-meta"><span>Configured routes differ from recent observed telemetry for these features.</span></div>';
      html += '</div>';
      html += '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:12px">';
      html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
        + '<th style="padding:6px">Feature</th>'
        + '<th style="padding:6px">Expected</th>'
        + '<th style="padding:6px">Observed</th>'
        + '<th style="padding:6px;text-align:right">Calls</th>'
        + '</tr></thead><tbody>';
      aiData.mismatches.forEach((row) => {
        const observed = `${(row.seen_providers || []).join(', ') || 'unknown'} / ${(row.seen_models || []).join(', ') || 'unknown'}`;
        const expected = `${row.expected_provider || 'edge'} / ${row.expected_model || 'gpt-5-mini'}`;
        html += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px">${esc(row.feature)}</td>
          <td style="padding:6px">${esc(expected)}</td>
          <td style="padding:6px">${esc(observed)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.calls || 0)}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += `<div class="q-item" style="margin-bottom:12px">
      <div class="q-item-header">
        <span class="q-item-title">Telemetry Quality</span>
        <div class="q-item-badges">
          <span class="q-badge type">Model ${fmtN(aiSummary.model_coverage_pct || 0)}%</span>
          <span class="q-badge type">Usage ${fmtN(aiSummary.usage_coverage_pct || 0)}%</span>
          <span class="q-badge type">Cache ${fmtN(aiSummary.cache_coverage_pct || 0)}%</span>
        </div>
      </div>
      <div class="q-item-meta">
        <span>Missing model: ${fmtN(missingModel)}</span>
        <span>Missing usage: ${fmtN(missingUsage)}</span>
        <span>Missing cache data: ${fmtN(missingCache)}</span>
      </div>
    </div>`;
    html += '<div class="metrics-grid">';
    html += `<div class="metric-card"><div class="metric-label">Calls</div><div class="metric-val">${fmtN(aiSummary.total_calls || 0)}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Avg Latency</div><div class="metric-val">${fmtN(aiSummary.avg_duration_ms || 0)}ms</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Input Tokens</div><div class="metric-val">${fmtN(aiSummary.total_input_tokens || 0)}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Output Tokens</div><div class="metric-val">${fmtN(aiSummary.total_output_tokens || 0)}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Total Tokens</div><div class="metric-val">${fmtN(aiSummary.total_tokens || 0)}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Attachments</div><div class="metric-val">${fmtN(aiSummary.total_attachments || 0)}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Cache Hits</div><div class="metric-val">${fmtN(aiSummary.cache_hits || 0)}</div></div>`;
    html += '</div>';

    if (aiData.features?.length) {
      html += '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-top:12px">';
      html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
        + '<th style="padding:6px">Feature</th>'
        + '<th style="padding:6px;text-align:right">Calls</th>'
        + '<th style="padding:6px;text-align:right">Avg</th>'
        + '<th style="padding:6px;text-align:right">Tokens</th>'
        + '<th style="padding:6px;text-align:right">Attachments</th>'
        + '<th style="padding:6px;text-align:right">Cache Hits</th>'
        + '<th style="padding:6px;text-align:right">Last Call</th>'
        + '</tr></thead><tbody>';
      aiData.features.slice(0, 12).forEach((row) => {
        html += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px">${esc(row.feature)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.calls || 0)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.avg_duration_ms || 0)}ms</td>
          <td style="padding:6px;text-align:right">${fmtN(row.total_tokens || 0)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.attachments || 0)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.cache_hits || 0)}</td>
          <td style="padding:6px;text-align:right">${row.last_called_at ? freshnessHTML(row.last_called_at) : '--'}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    html += '<div class="widget"><div class="widget-title">AI Providers And Recent Calls</div>';
    if (aiData.providers?.length) {
      html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
      html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
        + '<th style="padding:6px">Provider</th>'
        + '<th style="padding:6px">Model</th>'
        + '<th style="padding:6px;text-align:right">Calls</th>'
        + '<th style="padding:6px;text-align:right">Avg</th>'
        + '<th style="padding:6px;text-align:right">Tokens</th>'
        + '<th style="padding:6px;text-align:right">Cache Hits</th>'
        + '</tr></thead><tbody>';
      aiData.providers.forEach((row) => {
        html += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px">${esc(row.provider)}</td>
          <td style="padding:6px">${esc(row.model || 'unknown')}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.calls || 0)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.avg_duration_ms || 0)}ms</td>
          <td style="padding:6px;text-align:right">${fmtN(row.total_tokens || 0)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.cache_hits || 0)}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    } else {
      html += '<div class="ops-empty">No provider data available</div>';
    }

    if (aiData.statuses?.length) {
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">';
      aiData.statuses.forEach((row) => {
        html += `<span class="q-badge type">${esc(row.status)}: ${fmtN(row.calls || 0)}</span>`;
      });
      html += '</div>';
    }

    if (aiData.recent?.length) {
      aiData.recent.slice(0, 10).forEach((row) => {
        const usage = row.usage || {};
        const totalTokens = usage.total_tokens || ((usage.input_tokens || usage.prompt_tokens || 0) + (usage.output_tokens || usage.completion_tokens || 0));
        html += `<div class="q-item">
          <div class="q-item-header">
            <span class="q-item-title">${esc(row.feature || 'unknown')}</span>
            <div class="q-item-badges">
              <span class="q-badge type">${esc(row.provider || 'unknown')}</span>
              <span class="q-badge type">${esc(row.model || 'unknown')}</span>
              <span class="q-badge">${fmtN(row.duration_ms || 0)}ms</span>
              <span class="q-badge">${fmtN(totalTokens || 0)} tok</span>
              ${row.cache_hit ? '<span class="q-badge pri-low">cache</span>' : ''}
            </div>
          </div>
          <div class="q-item-meta">
            <span>${esc(row.endpoint || 'chat')}</span>
            <span>${esc(String(row.status || 'unknown'))}</span>
            ${row.attachment_count ? `<span>${fmtN(row.attachment_count)} attachment${row.attachment_count === 1 ? '' : 's'}</span>` : ''}
            <span>${row.created_at ? freshnessHTML(row.created_at) : '--'}</span>
          </div>
        </div>`;
      });
    } else {
      html += '<div class="ops-empty">No recent AI calls found</div>';
    }
    html += '</div>';
  }

  // Client-side perf log
  if (opsPerfLog.length > 0) {
    html += '<div class="widget"><div class="widget-title">Client-Side Timing (this session)</div>';
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
    html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
      + '<th style="padding:6px">Label</th>'
      + '<th style="padding:6px;text-align:right">Duration</th>'
      + '<th style="padding:6px;text-align:right">When</th>'
      + '</tr></thead><tbody>';
    [...opsPerfLog].reverse().slice(0, 30).forEach(entry => {
      const color = entry.dur > 500 ? 'color:var(--red)' : entry.dur > 200 ? 'color:var(--yellow)' : '';
      html += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px">${esc(entry.label)}</td>
        <td style="padding:6px;text-align:right;${color}">${entry.dur}ms</td>
        <td style="padding:6px;text-align:right">${freshnessHTML(new Date(entry.ts).toISOString())}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  el.innerHTML = html;
}

// Wire perf dashboard into sync health page (append as collapsible section)
function appendPerfToSyncHealth() {
  const syncEl = document.getElementById('syncHealthContent');
  if (!syncEl) return;
  // Only show for manager+ roles
  const role = LCC_USER?.role || 'viewer';
  if (!['owner', 'manager'].includes(role)) return;

  const perfSection = document.createElement('div');
  perfSection.id = 'perfDashboardContent';
  perfSection.style.marginTop = '24px';
  syncEl.appendChild(perfSection);
  renderPerfDashboard(perfSection);
}

// ============================================================================
// HOME PAGE INTEGRATION — update stat cards with canonical model data
// ============================================================================
async function updateHomeStats() {
  try {
    const res = await opsApi('/api/queue?view=work_counts');
    if (res.ok) {
      const c = res.data || {};
      // Only overwrite stat cards when canonical queue has real data —
      // prevents clobbering edge-function values with zeros
      const hasData = (c.my_actions || 0) + (c.my_open || 0) + (c.inbox_new || 0) + (c.due_this_week || 0) + (c.overdue || 0) > 0;
      if (hasData) {
        const el = id => document.getElementById(id);
        if (el('statActivities')) el('statActivities').textContent = c.my_actions || c.my_open || 0;
        if (el('statEmails')) el('statEmails').textContent = c.inbox_new || 0;
        if (el('statDue')) el('statDue').textContent = c.due_this_week || c.overdue || 0;
      }
    }
  } catch (e) {
    console.warn('Home stats update failed:', e);
  }
  // Always re-apply edge-function stats so they get the last word
  if (typeof renderHomeStats === 'function') renderHomeStats();
}

// Run on load — update home stats from canonical model
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(updateHomeStats, 2000));
} else {
  setTimeout(updateHomeStats, 2000);
}
