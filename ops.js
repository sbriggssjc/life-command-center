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
let opsInboxSelected = new Set();

// Advanced team queue filters
let opsTeamDomainFilter = '';       // '' = all domains
let opsTeamAssigneeFilter = '';     // '' = all, 'unassigned', or user_id
let opsTeamVisFilter = '';          // '' = all, 'private', 'assigned', 'shared'

// --- V2 endpoint preference (uses paginated queue-v2 when available) ---
const V2_MAP = {
  '/api/queue?view=my_work': '/api/queue-v2?view=my_work',
  '/api/queue?view=team_queue': '/api/queue-v2?view=team_queue',
  '/api/queue?view=inbox': '/api/queue-v2?view=inbox',
  '/api/queue?view=research_queue': '/api/queue-v2?view=research',
  '/api/queue?view=work_counts': '/api/queue-v2?view=work_counts'
};
let useV2 = true; // Auto-degrades to v1 if v2 returns 404

// --- Pagination state for infinite scroll / page navigation ---
let opsPagination = {};

// --- API helper ---
async function opsApi(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;

  // Try v2 endpoint first (paginated, instrumented)
  const basePath = path.split('&')[0];
  const v2Path = useV2 ? V2_MAP[basePath] : null;
  const extraParams = path.includes('&') ? '&' + path.split('&').slice(1).join('&') : '';
  const finalPath = v2Path ? v2Path + extraParams : path;

  try {
    const perf = opsPerf(`api:${finalPath.split('?')[1]?.substring(0, 40) || finalPath}`);
    const res = await fetch(finalPath, { headers, ...opts });

    // If v2 returned 404, fall back to v1
    if (v2Path && res.status === 404) {
      useV2 = false;
      console.log('[ops] queue-v2 not available, falling back to v1');
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
    return { ok: false, error: e.message };
  }
}

async function opsPost(path, body) {
  return opsApi(path, { method: 'POST', body: JSON.stringify(body) });
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
  const cls = `status-${(status || '').replace(/ /g, '_')}`;
  const label = (status || 'unknown').replace(/_/g, ' ');
  return `<span class="q-badge ${cls}">${label}</span>`;
}

function typeBadge(type) {
  if (!type) return '';
  return `<span class="q-badge type">${type.replace(/_/g, ' ')}</span>`;
}

function domainBadge(domain) {
  if (!domain) return '';
  return `<span class="q-badge domain">${domain}</span>`;
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

  const pageParam = page ? `&page=${page}&per_page=25` : '&limit=100';
  const [qRes, cRes] = await Promise.all([
    opsApi(`/api/queue?view=my_work${pageParam}`),
    opsApi('/api/connectors?action=list')
  ]);

  if (!qRes.ok) {
    el.innerHTML = `<div class="ops-empty">Could not load your work queue.<br><small>${qRes.error}</small></div>`;
    return;
  }

  opsMyWorkData = qRes.data?.items || qRes.data || [];
  const connectors = cRes.ok ? (cRes.data?.connectors || cRes.data || []) : [];

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
    html += emptyStateHTML(
      '<path d="M9 14l2 2 4-4"/><circle cx="12" cy="12" r="10"/>',
      'No work items yet',
      connectors.length ? 'Sync your connectors or promote inbox items to populate your queue.' : 'Set up connectors to start receiving work items.',
      connectors.length ? 'Go to Inbox' : 'Set up connectors',
      connectors.length ? "navTo('pageInbox')" : "navTo('pageSyncHealth')"
    );
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
    el.innerHTML = `<div class="ops-empty">Could not load team queue.<br><small>${qRes.error}</small></div>`;
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
    el.innerHTML = `<div class="ops-empty">Could not load inbox.<br><small>${res.error}</small></div>`;
    return;
  }

  opsInboxData = res.data?.items || res.data || [];
  opsInboxSelected.clear();

  let html = '';
  html += `<div class="ops-header">
    <h2>Inbox <span style="font-size:13px;color:var(--text2);font-weight:400">${opsInboxData.length} items</span></h2>
    <div class="ops-controls">${freshnessHTML(new Date().toISOString())}</div>
  </div>`;

  // Filter pills
  html += '<div class="ops-filters">';
  html += filterPill('new', 'New', opsInboxFilter, 'opsInboxFilter', 'renderInboxTriage');
  html += filterPill('triaged', 'Triaged', opsInboxFilter, 'opsInboxFilter', 'renderInboxTriage');
  html += filterPill('all', 'All', opsInboxFilter, 'opsInboxFilter', 'renderInboxTriage');
  html += '</div>';

  // Triage bar with select-all and bulk actions
  if (opsInboxData.length > 0) {
    html += `<div class="triage-bar" id="triageBar">
      <input type="checkbox" id="triageSelectAll" onchange="toggleInboxSelectAll(this.checked)">
      <span>Select all</span>
      <span class="triage-count" id="triageCount">0 selected</span>
      <div class="triage-actions">
        <button class="q-action" onclick="bulkTriageInbox('triaged')" title="Mark as triaged">Triage</button>
        <button class="q-action primary" onclick="bulkPromoteInbox()" title="Promote selected to shared actions">Promote</button>
        <button class="q-action danger" onclick="bulkTriageInbox('dismissed')" title="Dismiss selected">Dismiss</button>
      </div>
    </div>`;
  }

  if (!opsInboxData.length) {
    html += emptyStateHTML(
      '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
      opsInboxFilter === 'new' ? 'Inbox is clear' : 'No items match this filter',
      opsInboxFilter === 'new' ? 'All caught up! New items from connectors will appear here.' : 'Try changing your filter to see more items.',
      null, null
    );
  } else {
    opsInboxData.forEach((item, idx) => { html += inboxItemHTML(item, idx); });
  }

  el.innerHTML = html;
  perf.end();
}

function inboxItemHTML(item, idx) {
  const overdue = item.status === 'new' && item.created_at && (Date.now() - new Date(item.created_at).getTime()) > 86400000 * 2;
  let html = `<div class="q-item ${overdue ? 'overdue' : ''}" data-inbox-id="${item.id}">`;
  html += '<div class="q-item-header">';
  html += `<input type="checkbox" style="margin-right:6px;accent-color:var(--accent)" onchange="toggleInboxItem('${item.id}', this.checked)">`;
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
    html += `<button class="q-action" onclick="triageSingle('${item.id}')">Triage</button>`;
  }
  html += `<button class="q-action primary" onclick="promoteSingle('${item.id}')">Promote</button>`;
  html += `<button class="q-action" onclick="quickReassign('${item.id}','inbox')">Assign</button>`;
  html += `<button class="q-action danger" onclick="dismissSingle('${item.id}')">Dismiss</button>`;
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

async function bulkTriageInbox(status) {
  if (!opsInboxSelected.size) { showToast('Select items first', 'error'); return; }
  const ids = Array.from(opsInboxSelected);
  const statusLabel = status === 'dismissed' ? 'Dismissing' : 'Triaging';
  showToast(`${statusLabel} ${ids.length} items...`, 'info');
  const res = await opsPost('/api/workflows?action=bulk_triage', { item_ids: ids, status });
  if (res.ok) {
    showToast(`${ids.length} item${ids.length > 1 ? 's' : ''} ${status}`, 'success');
    renderInboxTriage();
  } else {
    showToast(res.error || 'Bulk triage failed', 'error');
  }
}

async function bulkPromoteInbox() {
  if (!opsInboxSelected.size) { showToast('Select items first', 'error'); return; }
  showToast(`Promoting ${opsInboxSelected.size} items...`, 'info');
  let promoted = 0, failed = 0;
  for (const id of opsInboxSelected) {
    const res = await opsPost('/api/workflows?action=promote_to_shared', { inbox_item_id: id });
    if (res.ok) promoted++; else failed++;
  }
  if (failed) showToast(`${promoted} promoted, ${failed} failed`, promoted ? 'success' : 'error');
  else showToast(`${promoted} item${promoted > 1 ? 's' : ''} promoted to shared actions`, 'success');
  renderInboxTriage();
}

async function triageSingle(id) {
  await opsPost('/api/inbox?action=triage', { id, status: 'triaged' });
  showToast('Triaged', 'success');
  renderInboxTriage();
}

async function promoteSingle(id) {
  const res = await opsPost('/api/workflows?action=promote_to_shared', { inbox_item_id: id });
  if (res.ok) showToast('Promoted to shared action', 'success');
  else showToast(res.error || 'Promotion failed', 'error');
  renderInboxTriage();
}

async function dismissSingle(id) {
  await opsPost('/api/inbox?action=triage', { id, status: 'dismissed' });
  showToast('Dismissed', 'success');
  renderInboxTriage();
}

// ============================================================================
// ENTITIES — canonical model browser
// ============================================================================
async function renderEntitiesPage() {
  const el = document.getElementById('entitiesContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:entities');

  const res = await opsApi('/api/entities?action=list&limit=100');
  if (!res.ok) {
    el.innerHTML = `<div class="ops-empty">Could not load entities.<br><small>${res.error}</small></div>`;
    return;
  }

  opsEntitiesData = res.data?.entities || res.data || [];
  const counts = {};
  opsEntitiesData.forEach(e => { counts[e.entity_type] = (counts[e.entity_type] || 0) + 1; });

  let html = '';
  html += `<div class="ops-header">
    <h2>Entities <span style="font-size:13px;color:var(--text2);font-weight:400">${opsEntitiesData.length}</span></h2>
  </div>`;

  html += '<div class="ops-filters">';
  html += filterPill('all', `All (${opsEntitiesData.length})`, opsEntityFilter, 'opsEntityFilter', 'renderEntitiesPage');
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([type, ct]) => {
    html += filterPill(type, `${type} (${ct})`, opsEntityFilter, 'opsEntityFilter', 'renderEntitiesPage');
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
      html += `<div class="entity-card" onclick="viewEntity('${entity.id}')">
        <div class="entity-card-header">
          <span class="entity-card-name">${esc(entity.name)}</span>
          <span class="entity-card-type">${entity.entity_type || 'unknown'}</span>
        </div>
        <div class="entity-card-meta">
          ${entity.domain ? `<span>${entity.domain}</span>` : ''}
          ${entity.status ? `<span>${entity.status}</span>` : ''}
          ${entity.city || entity.state ? `<span>${[entity.city, entity.state].filter(Boolean).join(', ')}</span>` : ''}
          ${freshnessHTML(entity.updated_at)}
        </div>
      </div>`;
    });
  }

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
async function renderResearchPage() {
  const el = document.getElementById('researchContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:research');

  const res = await opsApi('/api/queue?view=research_queue&limit=100');
  if (!res.ok) {
    el.innerHTML = `<div class="ops-empty">Could not load research tasks.<br><small>${res.error}</small></div>`;
    return;
  }

  opsResearchData = res.data?.items || res.data || [];

  let html = '';
  html += `<div class="ops-header">
    <h2>Research <span style="font-size:13px;color:var(--text2);font-weight:400">${opsResearchData.length} tasks</span></h2>
  </div>`;

  html += '<div class="ops-filters">';
  html += filterPill('active', 'Active', opsResearchFilter, 'opsResearchFilter', 'renderResearchPage');
  html += filterPill('completed', 'Completed', opsResearchFilter, 'opsResearchFilter', 'renderResearchPage');
  html += filterPill('all', 'All', opsResearchFilter, 'opsResearchFilter', 'renderResearchPage');
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
          ${item.status !== 'completed' ? `<button class="q-action primary" onclick="completeResearch('${item.id}')">Complete</button>` : ''}
          ${item.status !== 'completed' ? `<button class="q-action" onclick="createFollowup('${item.id}')">Follow-up</button>` : ''}
        </div>
      </div>`;
    });
  }

  el.innerHTML = html;
  perf.end();
}

async function completeResearch(id) {
  const res = await opsPost('/api/workflows?action=research_followup', {
    research_task_id: id
  });
  if (res.ok) showToast('Research completed', 'success');
  else showToast(res.error || 'Failed', 'error');
  renderResearchPage();
}

async function createFollowup(id) {
  const title = prompt('Follow-up action title:');
  if (!title) return;
  const res = await opsPost('/api/workflows?action=research_followup', {
    research_task_id: id,
    followup_title: title,
    followup_type: 'follow_up'
  });
  if (res.ok) showToast('Research completed + follow-up created', 'success');
  else showToast(res.error || 'Failed', 'error');
  renderResearchPage();
}

// ============================================================================
// METRICS — work counts, team performance
// ============================================================================
async function renderMetricsPage() {
  const el = document.getElementById('metricsContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:metrics');

  const [countsRes, oversightRes] = await Promise.all([
    opsApi('/api/queue?view=work_counts'),
    opsApi('/api/workflows?action=oversight')
  ]);

  let html = '';
  html += workspaceContextHTML();
  html += '<div class="ops-header"><h2>Metrics</h2></div>';

  // Work counts
  if (countsRes.ok) {
    const c = countsRes.data || {};
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
  }

  // Team overview (manager only)
  if (oversightRes.ok && oversightRes.data?.team?.length) {
    html += '<div class="widget"><div class="widget-title">Team Overview</div>';
    oversightRes.data.team.forEach(member => {
      const initials = (member.display_name || '??').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      html += `<div class="team-row">
        <div class="team-avatar">${initials}</div>
        <div class="team-info">
          <div class="team-name">${esc(member.display_name)}</div>
          <div class="team-role">${member.role || 'viewer'}</div>
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
    oversightRes.data.open_escalations.forEach(esc => {
      html += `<div class="q-item high-pri">
        <div class="q-item-title">${esc.action_items?.title || 'Unknown action'}</div>
        <div class="q-item-meta">
          <span>From: ${esc.users?.display_name || 'unknown'}</span>
          <span>Reason: ${esc.reason}</span>
          ${freshnessHTML(esc.created_at)}
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
            Status: ${conn.status || 'unknown'}
            ${conn.last_synced_at ? ' \u00b7 Last sync: ' + freshnessHTML(conn.last_synced_at) : ''}
            ${conn.error_message ? ' \u00b7 <span style="color:var(--red)">' + esc(conn.error_message) + '</span>' : ''}
          </div>
        </div>
        <div class="sync-card-actions">
          <button class="q-action" onclick="triggerSync('${conn.connector_type}')">Sync Now</button>
        </div>
      </div>`;
    });
  }

  // Sync health summary
  if (healthRes.ok && healthRes.data) {
    const h = healthRes.data;
    html += '<div class="widget" style="margin-top:16px"><div class="widget-title">Sync Summary</div>';
    html += '<div class="metrics-grid">';
    html += metricCardHTML('Total Jobs', h.total_jobs || h.jobs_24h || 0, 'last 24h');
    html += metricCardHTML('Success Rate', h.success_rate ? Math.round(h.success_rate * 100) + '%' : '--', 'last 24h', h.success_rate < 0.9 ? 'red' : 'green');
    html += metricCardHTML('Errors', h.error_count || 0, 'last 24h', h.error_count > 0 ? 'red' : 'green');
    html += metricCardHTML('Avg Duration', h.avg_duration ? h.avg_duration + 's' : '--', 'per job');
    html += '</div></div>';
  }

  // Recent sync errors
  if (healthRes.ok && healthRes.data?.recent_errors?.length) {
    html += '<div class="widget" style="border-color:var(--red)"><div class="widget-title">Recent Errors</div>';
    healthRes.data.recent_errors.forEach(err => {
      html += `<div class="q-item overdue">
        <div class="q-item-header">
          <span class="q-item-title">${esc(err.connector_type || 'Unknown')} — ${esc(err.error_category || 'Error')}</span>
          ${freshnessHTML(err.occurred_at)}
        </div>
        <div class="q-item-meta"><span style="color:var(--red)">${esc(err.message || '')}</span></div>
        <div class="q-actions">
          <button class="q-action" onclick="retrySync('${err.id}')">Retry</button>
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
  const actionMap = { email: 'ingest_emails', calendar: 'ingest_calendar', salesforce: 'ingest_sf_activities' };
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

async function quickTransition(itemId, newStatus, itemType) {
  const statusLabels = { in_progress: 'Started', completed: 'Completed', waiting: 'Set to waiting', open: 'Reopened' };
  const table = itemType === 'inbox' ? 'inbox' : 'actions';
  showToast(`Updating...`, 'info');
  const res = await opsPost(`/api/${table}?action=transition`, { id: itemId, status: newStatus });
  if (res.ok) {
    showToast(statusLabels[newStatus] || `Status → ${newStatus}`, 'success');
    const activePage = document.querySelector('.page.active');
    if (activePage) handlePageLoad(activePage.id);
  } else {
    showToast(res.error || 'Transition failed', 'error');
  }
}

async function quickReassign(itemId, itemType) {
  const assignee = prompt('Enter user ID to assign to:');
  if (!assignee) return;
  showToast('Assigning...', 'info');
  const res = await opsPost('/api/workflows?action=reassign', {
    item_type: itemType || 'action',
    item_id: itemId,
    assigned_to: assignee
  });
  if (res.ok) {
    showToast('Reassigned successfully', 'success');
    const activePage = document.querySelector('.page.active');
    if (activePage) handlePageLoad(activePage.id);
  } else {
    showToast(res.error || 'Reassign failed', 'error');
  }
}

async function quickEscalate(itemId) {
  const reason = prompt('Escalation reason:');
  if (!reason) return;
  const target = prompt('Escalate to (user ID):');
  if (!target) return;
  showToast('Escalating...', 'info');
  const res = await opsPost('/api/workflows?action=escalate', {
    action_item_id: itemId,
    escalate_to: target,
    reason
  });
  if (res.ok) showToast('Escalated successfully — assignee notified', 'success');
  else showToast(res.error || 'Escalation failed', 'error');
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
  if (item.entity_name) html += `<span class="q-entity" onclick="viewEntity('${item.entity_id}')">${esc(item.entity_name)}</span>`;
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
  if (item.status === 'open') html += `<button class="q-action primary" onclick="quickTransition('${item.id}','in_progress','action')">Start</button>`;
  if (item.status === 'in_progress') html += `<button class="q-action primary" onclick="quickTransition('${item.id}','completed','action')">Complete</button>`;
  if (item.status === 'open' || item.status === 'in_progress') {
    html += `<button class="q-action" onclick="quickTransition('${item.id}','waiting','action')">Wait</button>`;
  }
  if (item.status === 'waiting') html += `<button class="q-action" onclick="quickTransition('${item.id}','in_progress','action')">Resume</button>`;
  // Reassign available on all contexts for items that support it
  if (!item.assigned_to || opts.showAssign || context === 'team_queue') {
    html += `<button class="q-action" onclick="quickReassign('${item.id}','action')">Assign</button>`;
  } else if (context !== 'my_work') {
    html += `<button class="q-action" onclick="quickReassign('${item.id}','action')">Reassign</button>`;
  }
  // Escalate on all non-completed items
  if (item.status !== 'completed' && item.status !== 'cancelled') {
    html += `<button class="q-action" onclick="quickEscalate('${item.id}')">Escalate</button>`;
  }
  html += '</div>';

  html += '</div>';
  return html;
}

function filterPill(value, label, currentVar, varName, refreshFn) {
  const active = value === eval(varName) ? 'active' : '';
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
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  const [summaryRes, slowRes] = await Promise.all([
    opsApi('/api/queue-v2?view=_perf&section=summary'),
    opsApi('/api/queue-v2?view=_perf&section=slow')
  ]);

  if (!summaryRes.ok) {
    el.innerHTML = `<div class="ops-empty">${summaryRes.data?.error || summaryRes.error || 'Could not load performance data'}</div>`;
    return;
  }

  const data = summaryRes.data;
  const slowData = slowRes.ok ? slowRes.data : {};
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
        <td style="padding:6px;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${esc(c.description || '')}">${esc(c.endpoint_pattern)}</td>
        <td style="padding:6px;text-align:right">${c.request_count}</td>
        <td style="padding:6px;text-align:right">${c.actual_p50_ms != null ? Math.round(c.actual_p50_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right">${c.actual_p95_ms != null ? Math.round(c.actual_p95_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right">${c.target_p95_ms}ms</td>
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
        <td style="padding:6px;max-width:240px;overflow:hidden;text-overflow:ellipsis">${esc(ep.endpoint)}</td>
        <td style="padding:6px;text-align:right">${ep.request_count}</td>
        <td style="padding:6px;text-align:right">${ep.avg_ms}ms</td>
        <td style="padding:6px;text-align:right">${ep.p95_ms != null ? Math.round(ep.p95_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right">${ep.max_ms}ms</td>
        <td style="padding:6px;text-align:right;${slowColor}">${ep.slow_pct}%</td>
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
            <span class="q-badge pri-high">${sr.duration_ms}ms</span>
            <span class="q-badge type">${sr.metric_type}</span>
          </div>
        </div>
        <div class="q-item-meta">
          <span>Threshold: ${sr.threshold_ms}ms</span>
          ${freshnessHTML(sr.recorded_at)}
        </div>
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<div class="widget"><div class="widget-title">Slow Requests (24h)</div><div class="ops-empty">No slow requests detected</div></div>';
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
      const el = id => document.getElementById(id);
      if (el('statActivities')) el('statActivities').textContent = c.my_actions || c.my_open || 0;
      if (el('statEmails')) el('statEmails').textContent = c.inbox_new || 0;
      if (el('statDue')) el('statDue').textContent = c.due_this_week || c.overdue || 0;
    }
  } catch (e) {
    console.log('Home stats update failed:', e);
  }
}

// Run on load — update home stats from canonical model
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(updateHomeStats, 2000));
} else {
  setTimeout(updateHomeStats, 2000);
}
