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

// --- Async button guard (prevents double-clicks, shows Working… state) ---
async function _opsBtnGuard(btn, fn, ...args) {
  if (!btn || btn.disabled) return;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Working\u2026'; btn.style.opacity = '0.6';
  try { await fn(...args); } catch (e) { console.error('_opsBtnGuard error:', e); showToast(e.message || 'Action failed', 'error'); } finally { btn.disabled = false; btn.textContent = orig; btn.style.opacity = ''; }
}

// --- Detail-panel readiness gate (B10, 2026-06-06) ---
// showDetail() lives in detail.js, which can finish loading after ops.js wires
// up its click handlers (script-order race). Rather than dead-toast "Detail
// panel unavailable" on an early click, queue the open and run it the moment
// detail.js is ready. Resolves immediately when showDetail already exists.
function _opsWhenDetailReady(fn, opts) {
  opts = opts || {};
  const timeoutMs = opts.timeoutMs || 8000;
  const intervalMs = 120;
  if (typeof showDetail === 'function') { fn(); return; }
  const started = Date.now();
  // One-time "loading" hint so the user knows the click registered.
  if (typeof showToast === 'function') showToast('Opening detail panel…', 'info');
  const timer = setInterval(function () {
    if (typeof showDetail === 'function') {
      clearInterval(timer);
      try { fn(); } catch (e) { console.error('_opsWhenDetailReady fn error:', e); if (typeof showToast === 'function') showToast('Could not open detail: ' + (e?.message || e), 'error'); }
    } else if (Date.now() - started > timeoutMs) {
      clearInterval(timer);
      if (typeof showToast === 'function') showToast('Detail panel failed to load — reload the page (Ctrl+Shift+R) and try again.', 'error');
    }
  }, intervalMs);
}

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
      // Report to server (fire-and-forget). sendBeacon can't attach auth
      // headers, so the receiver treats this as anonymous ingest and reads
      // workspace_id / user_id from the body. Sent as application/json so the
      // server's body parser hands it back as an object.
      if (LCC_USER.workspace_id && dur > 100) {
        try {
          const payload = JSON.stringify({
            metric_type: label.startsWith('render:') ? 'client_render' : 'page_load',
            endpoint: label,
            duration_ms: dur,
            workspace_id: LCC_USER.workspace_id,
            user_id: LCC_USER.id || null
          });
          const blob = new Blob([payload], { type: 'application/json' });
          navigator.sendBeacon?.('/api/queue-v2?view=_perf', blob);
        } catch (e) {
          // Beacons are best-effort; never let telemetry break the UI.
        }
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
let opsEntityFilter = 'all';      // all | person | organization | asset (server-side filter)
let opsEntitySearch = '';         // backend name search term (B6, 2026-06-06)
let opsResearchFilter = 'active'; // active | completed | all
let opsEntitiesPage = 1;
let opsResearchPage = 1;
let opsInboxSelected = new Set();
// Render-side windowing: cap the DOM render to N rows; "Load more" grows it.
// opsInboxData stays the full in-memory backlog so counts and selection work
// over the complete dataset.
let opsInboxWindow = 50;
const OPS_INBOX_WINDOW_STEP = 50;
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

// --- Standardized error state (B7, 2026-06-06) ---
// One component for widget + page-level + lane load failures: states WHAT
// failed (label + status + short detail), offers Retry, and — when retry is
// hopeless (4xx config/permission errors) — says so instead of looping a
// button that can't succeed. `res` is an opsApi result ({ok,status,error}).
function opsErrorState(res, retryExpr, label) {
  const status = res && typeof res.status === 'number' ? res.status : null;
  const detail = (res && res.error) || 'Unknown error';
  // 4xx is a config/permission/not-found problem retrying won't fix (408/429
  // are transient and DO warrant a retry).
  const hopeless = status != null && status >= 400 && status < 500 && status !== 408 && status !== 429;
  let h = '<div class="widget-error" role="alert">';
  h += '<div class="err-msg">' + esc(label || 'Could not load') + (status ? ' (HTTP ' + status + ')' : '') + '</div>';
  if (detail) h += '<div class="err-detail" style="font-size:12px;color:var(--text2);margin-top:4px">' + esc(String(detail).slice(0, 240)) + '</div>';
  if (hopeless) {
    h += '<div style="font-size:12px;color:var(--text3);margin-top:6px">This looks like a configuration or permission error — retrying won\'t help. Check your workspace / sign-in, or contact an admin.</div>';
  } else if (retryExpr) {
    h += '<button class="retry-btn" onclick="' + esc(retryExpr) + '">Retry</button>';
  }
  h += '</div>';
  return h;
}
window.opsErrorState = opsErrorState;

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

  // NOTE: canonicalMyWork is a 5-item dashboard preview — always fetch the full
  // list below so the Pipeline tab shows all items, not just the preview subset.

  const pageParam = page ? `&page=${page}&per_page=25` : '&limit=100';
  const [qRes, cRes, fRes] = await Promise.all([
    opsApi(`/api/queue?view=my_work${pageParam}`),
    opsApi('/api/connectors?action=list'),
    // True flagged-email total for the empty-state hint — same source the Today
    // "Flagged Emails" stat uses (data.total = accurate inbox count, not the
    // per-page subset the server now excludes via item_type=neq.inbox). QA4.
    opsApi('/api/sync?action=flagged_emails&limit=1')
  ]);

  if (!qRes.ok) {
    el.innerHTML = opsErrorState(qRes, 'renderMyWork()', 'Could not load your work queue');
    perf.end();
    return;
  }

  opsMyWorkData = qRes.data?.items || qRes.data || [];
  // QA-09 (2026-05-18): exclude raw flagged-email / inbox triage rows from
  // "My Work". They belong on the Inbox page, not in the action queue —
  // mixing them here is why Pipeline ("23 items") used to disagree with
  // Home ("Open Activities: 0") and Metrics ("INBOX: 7,402 needs triage").
  // Track the dropped count so the empty state can surface it.
  const inboxDropped = opsMyWorkData.filter(item =>
    item.source_type === 'flagged_email' || item.item_type === 'inbox'
  ).length;
  opsMyWorkData = opsMyWorkData.filter(item =>
    item.source_type !== 'flagged_email' && item.item_type !== 'inbox'
  );
  window._opsMyWorkInboxDropped = inboxDropped;
  // True flagged/inbox total (≈3,004) — the server now excludes inbox rows via
  // item_type=neq.inbox so inboxDropped is ~0 per page; the honest hint count
  // comes from the flagged_emails endpoint's data.total. QA4.
  window._opsMyWorkFlaggedTotal = (fRes && fRes.ok && fRes.data && fRes.data.total) || 0;
  // Deduplicate remaining items by title + source_type + date composite key
  {
    const seen = new Set();
    opsMyWorkData = opsMyWorkData.filter(item => {
      const key = (item.title || '') + '|' + (item.source_type || '') + '|' + (item.received_at || '').substring(0, 10);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
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
      // QA-09 / QA4: surface the TRUE flagged/inbox total so the empty state
      // doesn't look like data is missing. "Open Activities: 0" on Home is
      // the same definition — they don't include raw flagged emails. The count
      // comes from the flagged_emails endpoint (same source as the Today
      // "Flagged Emails" stat, ≈3,004), not the per-page subset — the server
      // now excludes inbox rows at the source so the dropped count is ~0.
      const flaggedTotal = window._opsMyWorkFlaggedTotal || window._opsMyWorkInboxDropped || 0;
      const inboxHint = flaggedTotal > 0
        ? `${flaggedTotal.toLocaleString()} flagged email${flaggedTotal === 1 ? '' : 's'} waiting in Inbox — triage to promote them into actions.`
        : (connectors.length ? 'Sync your connectors or promote inbox items to populate your queue.' : 'Set up connectors to start receiving work items.');
      html += emptyStateHTML(
        '<path d="M9 14l2 2 4-4"/><circle cx="12" cy="12" r="10"/>',
        'No action items assigned to you',
        inboxHint,
        connectors.length ? 'Open Inbox' : 'Set up connectors',
        connectors.length ? "navTo('pageInbox')" : "navTo('pageSyncHealth')"
      );
    }
  } else if (!items.length) {
    html += '<div class="ops-empty">No items match this filter</div>';
  } else {
    // Self-propelling contract: surface the most urgent item first and
    // elevate it as 'do this first'. Completing it re-renders and re-elevates
    // the next-most-urgent automatically (quickTransition reloads the page).
    const _mwSorted = items.slice().sort(_myWorkUrgencyCmp);
    _mwSorted.forEach(function (item, _ix) { html += queueItemHTML(item, 'my_work', { hero: _ix === 0 }); });
  }

  // Pagination controls (if using v2).
  // QA-22 (2026-05-18): renderMyWork's actual fetch URL is
  // '/api/queue?view=my_work&limit=100' (or '&page=N&per_page=25' when
  // paginating) — those are the keys that get pagination metadata stored
  // in opsPagination[]. The previous bare '/api/queue?view=my_work' key
  // pulled stale data populated by a different load path, displaying
  // "Page 1 of 298 (7432 items)" alongside a "0 items" list. Suppress the
  // pager entirely when there are no items to page through (the
  // my_work canonical queue is < 100 items in practice so the &limit=100
  // path returns the full set in one shot).
  if (opsMyWorkData.length >= 100) {
    html += paginationHTML('/api/queue?view=my_work&limit=100', 'renderMyWork');
  }

  el.innerHTML = html;
}

function _myWorkUrgencyCmp(a, b) {
  var ao = isOverdue(a.due_date) ? 0 : 1, bo = isOverdue(b.due_date) ? 0 : 1;
  if (ao !== bo) return ao - bo;
  var pr = function (p) { return p === 'urgent' ? 0 : p === 'high' ? 1 : 2; };
  var ap = pr(a.priority), bp = pr(b.priority);
  if (ap !== bp) return ap - bp;
  return String(a.due_date || '9999-12-31').localeCompare(String(b.due_date || '9999-12-31'));
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
    el.innerHTML = opsErrorState(qRes, 'renderTeamQueue()', 'Could not load team queue');
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

  // QA-18 (2026-05-18): fetch work_counts in parallel so the header can show
  // "Showing 100 of 7,420" instead of just "100 items". Without this the
  // Inbox header disagreed with the Metrics page (which uses inbox_new
  // from work_counts) by ~7,000.
  const [res, countsRes] = await Promise.all([
    opsApi(`/api/inbox?action=list&status=${opsInboxFilter === 'all' ? '' : opsInboxFilter}&limit=100`),
    opsApi('/api/queue-v2?view=work_counts'),
  ]);
  const workCounts = countsRes.ok ? (countsRes.data || {}) : {};
  // Choose the right total based on the current filter.
  const filterToCountKey = { new: 'inbox_new', triaged: 'inbox_triaged', all: 'inbox_new' };
  // 'all' shows everything; we don't have a single field for "new + triaged"
  // so approximate by inbox_new + inbox_triaged when filter is 'all'.
  const totalForFilter = opsInboxFilter === 'all'
    ? ((workCounts.inbox_new || 0) + (workCounts.inbox_triaged || 0))
    : (workCounts[filterToCountKey[opsInboxFilter]] || 0);
  window._inboxCanonicalTotal = totalForFilter;

  if (!res.ok) {
    el.innerHTML = opsErrorState(res, 'renderInboxTriage()', 'Could not load inbox');
    perf.end();
    return;
  }

  opsInboxData = res.data?.items || res.data || [];

  // Fallback: if canonical inbox is empty, load flagged emails from inbox_items DB
  if (opsInboxData.length === 0 && opsInboxFilter !== 'triaged') {
    try {
        const emailRes = await fetch('/api/sync?action=flagged_emails&limit=100');
        if (emailRes.ok) {
          const emailData = await emailRes.json();
          const flaggedEmails = emailData.emails || [];
          if (flaggedEmails.length > 0) {
            opsInboxData = flaggedEmails
              .filter(function(e) { return !e.flag_removed_at && e.status !== 'archived' && e.status !== 'dismissed'; })
              .map(function(e) {
              return {
                id: e.internet_message_id || e.id || ('email-' + Math.random().toString(36).slice(2)),
                external_id: e.internet_message_id || e.id || null,
                title: e.subject || '(No subject)',
                body: e.body_preview || '',
                sender: e.sender_name || e.sender_email || '',
                source_type: 'flagged_email',
                status: 'new',
                priority: e.importance === 'high' ? 'high' : 'normal',
                created_at: e.received_date || e.received_datetime || new Date().toISOString(),
                received_at: e.received_date || e.received_datetime || new Date().toISOString(),
                external_url: e.web_link || e.outlook_link || '',
                metadata: { graph_rest_id: e.id || null, internet_message_id: e.internet_message_id || null },
                domain: null,
                _edge_source: true
              };
            });
            window._inboxEmailTotal = emailData.total || flaggedEmails.length;
          }
        }
    } catch (emailErr) {
      console.warn('[Inbox] Flagged email fallback failed:', emailErr.message);
    }
  }

  opsInboxSelected.clear();

  // QA-18 (2026-05-18): prefer canonical total from work_counts, fall back
  // to the edge-source-fallback total, fall back to just the page count.
  const onPage = opsInboxData.length;
  const canonicalTotal = window._inboxCanonicalTotal || 0;
  const edgeTotal = window._inboxEmailTotal || 0;
  let displayCount;
  if (canonicalTotal > onPage) {
    displayCount = `Showing ${onPage.toLocaleString()} of ${canonicalTotal.toLocaleString()}`;
  } else if (edgeTotal > onPage && opsInboxData.length > 0 && opsInboxData[0]._edge_source) {
    displayCount = `${onPage} of ${edgeTotal.toLocaleString()}`;
  } else {
    displayCount = String(onPage);
  }
  let html = '';
  html += `<div class="ops-header">
    <h2>Inbox <span style="font-size:13px;color:var(--text2);font-weight:400">${displayCount} items</span></h2>
    <div class="ops-controls">${freshnessHTML(new Date().toISOString())}</div>
  </div>`;

  // Show notice when displaying edge function emails
  if (opsInboxData.length > 0 && opsInboxData[0]._edge_source) {
    html += '<div style="padding:8px 12px;margin-bottom:8px;background:var(--bg2);border-radius:8px;font-size:12px;color:var(--text2)">Showing flagged emails from Outlook. Run a sync to promote these to your triage queue.</div>';
  }

  // Filter pills — switching filter resets the windowed render
  html += '<div class="ops-filters">';
  html += filterPill('new', 'New', opsInboxFilter, 'opsInboxFilter', 'opsInboxSetFilter');
  html += filterPill('triaged', 'Triaged', opsInboxFilter, 'opsInboxFilter', 'opsInboxSetFilter');
  html += filterPill('all', 'All', opsInboxFilter, 'opsInboxFilter', 'opsInboxSetFilter');
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
        ` : ''}
        <button class="q-action danger" onclick="bulkTriageInbox('dismissed')" title="Dismiss selected">Dismiss</button>
        ${opsInboxFilter !== 'new' ? `<button class="q-action" onclick="bulkTriageInbox('archived')" title="Archive selected">Archive</button>` : ''}
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
    const shown = Math.min(opsInboxWindow, opsInboxData.length);
    for (let i = 0; i < shown; i++) {
      html += inboxItemHTML(opsInboxData[i], i);
    }
    if (shown < opsInboxData.length) {
      const remaining = opsInboxData.length - shown;
      const nextStep = Math.min(OPS_INBOX_WINDOW_STEP, remaining);
      html += `<div style="padding:12px;text-align:center;color:var(--text3);font-size:12px;background:var(--s2);border-radius:8px;margin-top:10px">
        <span>Showing ${shown.toLocaleString()} of ${opsInboxData.length.toLocaleString()} loaded</span>
        <button class="q-action" style="margin-left:12px;font-size:11px;padding:6px 14px;font-weight:600" onclick="opsInboxLoadMore(${OPS_INBOX_WINDOW_STEP})">Load ${nextStep} more</button>
        <button class="q-action" style="margin-left:6px;font-size:11px;padding:6px 14px" onclick="opsInboxLoadMore(${opsInboxData.length})">Show all</button>
      </div>`;
    }
  }

  el.innerHTML = html;
  perf.end();
}

function opsInboxLoadMore(step) {
  opsInboxWindow = Math.min(opsInboxWindow + (step || OPS_INBOX_WINDOW_STEP), opsInboxData ? opsInboxData.length : opsInboxWindow);
  renderInboxTriage();
}

function opsInboxSetFilter() {
  opsInboxWindow = 50;
  renderInboxTriage();
}

function _intakeDomShort(d) {
  d = String(d || '').toLowerCase();
  return d === 'government' ? 'gov' : d === 'dialysis' ? 'dia' : d;
}
// Render the pipeline verdict for an inbox row from its joined intake outcome
// (R4-C §1). Three classes: processed (matched/finalized), review
// (review_required/failed), archived (discarded non-deal). Each carries the
// REAL next action for that state instead of a generic Triage/Promote.
function _intakeVerdictBanner(item) {
  var io = item.intake_outcome;
  if (!io) return '';
  var enc = encodeURIComponent(io.intake_id);
  var viewBtn = '<button class="q-link" onclick="event.stopPropagation();(window.openIntakeFromInbox?window.openIntakeFromInbox(decodeURIComponent(\'' + enc + '\')):(location.hash=\'#intake/\'+decodeURIComponent(\'' + enc + '\')))" style="background:transparent;border:0;color:var(--accent);cursor:pointer;font-size:11px;text-decoration:underline;padding:0">View extraction →</button>';
  if (io.verdict === 'processed') {
    var dom = _intakeDomShort(io.matched_domain);
    var propLink = '';
    if ((dom === 'dia' || dom === 'gov') && io.matched_property_id != null) {
      propLink = ' — <button class="q-link" onclick="event.stopPropagation();openUnifiedDetail(\'' + esc(dom) + '\', {property_id: ' + esc(String(io.matched_property_id)) + '}, {}, \'Ownership &amp; CRM\')" style="background:transparent;border:0;color:var(--accent);cursor:pointer;font-size:11px;text-decoration:underline;padding:0">matched to ' + esc(dom) + ' property #' + esc(String(io.matched_property_id)) + ' →</button>';
    }
    return '<div class="inbox-verdict ok">✓ Processed — the intake pipeline handled this' + propLink + ' · ' + viewBtn + '</div>';
  }
  if (io.verdict === 'review') {
    var actions = '';
    if (item.metadata && item.metadata.extraction_quality === 'ocr_needed') {
      actions += '<button class="q-link" title="Re-extract via vision/OCR" onclick="event.stopPropagation();ocrReextractIntake(decodeURIComponent(\'' + enc + '\'), this)" style="background:transparent;border:0;color:var(--accent);cursor:pointer;font-size:11px;text-decoration:underline;padding:0;margin-right:8px">Re-extract (OCR) ↻</button>';
    }
    if (!item.entity_id) {
      actions += '<button class="q-link" title="Create a new property from this extraction and promote" onclick="event.stopPropagation();createPropertyFromIntakeUI(decodeURIComponent(\'' + enc + '\'), this)" style="background:transparent;border:0;color:var(--accent);cursor:pointer;font-size:11px;text-decoration:underline;padding:0;margin-right:8px">Create property →</button>';
    }
    actions += viewBtn;
    return '<div class="inbox-verdict warn">⚠ Needs review · ' + actions + '</div>';
  }
  if (io.verdict === 'archived') {
    return '<div class="inbox-verdict muted">Auto-archived: not a deal doc · ' + viewBtn + '</div>';
  }
  return '<div class="inbox-verdict muted">⏳ In intake pipeline (' + esc(io.status || '') + ') · ' + viewBtn + '</div>';
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

  // Body preview — show excerpt when available
  const bodyText = item.body || item.body_preview || '';
  if (bodyText) {
    const previewText = bodyText.substring(0, 160).replace(/\n/g, ' ');
    html += `<div class="q-item-preview" style="font-size:12px;color:var(--text3);margin:4px 0 6px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(previewText)}</div>`;
  }

  // Open in Outlook link — prefer web URL (outlook.office.com). See
  // window.openOutlookEmail in app.js for why we no longer try the
  // `ms-outlook://` desktop protocol first.
  const emailLinks = typeof outlookLinks === 'function'
    ? outlookLinks(item)
    : { desktop: '', web: (typeof outlookWebLink === 'function' ? outlookWebLink(item) : (item.external_url || '')) };
  if (emailLinks.desktop || emailLinks.web) {
    const hrefSafe = typeof safeHref === 'function'
      ? safeHref(emailLinks.web || emailLinks.desktop)
      : (emailLinks.web || emailLinks.desktop);
    const jsonSafe = typeof safeJSON === 'function'
      ? safeJSON
      : (v) => JSON.stringify(v).replace(/"/g, '&quot;');
    html += `<a href="${hrefSafe}" target="_blank" rel="noopener" onclick="event.stopPropagation();return (window.openOutlookEmail ? window.openOutlookEmail(event, ${jsonSafe(emailLinks.desktop)}, ${jsonSafe(emailLinks.web)}) : true)" style="display:inline-block;margin-bottom:6px;font-size:11px;color:var(--accent);text-decoration:none">Open in Outlook ↗</a>`;
  }

  // Bug L fix (2026-04-25): when a flagged-email inbox row was bridged to a
  // staged_intake (i.e. the OM intake pipeline ran on it), surface that
  // bridge so triage doesn't have to leave the inbox to know what got
  // matched/promoted. Reads metadata.bridged_to_intake_id (set by
  // handleOutlookMessage after stageOmIntake completes).
  // R4-C §1: when the API joined this row to its intake outcome, show the
  // pipeline verdict + the real next action for that state. Fall back to the
  // legacy bridge affordances only when the join didn't resolve.
  const io = item.intake_outcome || null;
  const bridgedIntakeId = io ? io.intake_id : (item?.metadata?.bridged_to_intake_id || null);
  if (io) {
    html += _intakeVerdictBanner(item);
  } else if (bridgedIntakeId) {
    const intakeShort = String(bridgedIntakeId).slice(0, 8);
    // Zero-text PDF (scanned OM) badge (F8, 2026-06-04) — set on the inbox row
    // metadata when extraction parked the artifact as ocr_needed. Surfaces the
    // OM-named scans instead of letting them hide among newsletters.
    if (item?.metadata?.extraction_quality === 'ocr_needed') {
      html += `<div style="display:inline-flex;align-items:center;gap:6px;margin:0 6px 6px 0;padding:3px 8px;border-radius:10px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.40);font-size:11px;color:var(--text2)">`;
      html += `<span style="color:#fbbf24;font-weight:600">⚠ OCR needed</span>`;
      html += `<span style="color:var(--text3)">scanned PDF — no embedded text</span>`;
      html += `<button class="q-link" title="Re-extract via vision/OCR" onclick="event.stopPropagation();ocrReextractIntake(decodeURIComponent('${encodeURIComponent(bridgedIntakeId)}'), this)" style="background:transparent;border:0;color:var(--accent);cursor:pointer;font-size:11px;text-decoration:underline;padding:0">Re-extract (OCR) ↻</button>`;
      html += `</div>`;
    }
    html += `<div style="display:inline-flex;align-items:center;gap:6px;margin:0 0 6px;padding:3px 8px;border-radius:10px;background:rgba(52,211,153,0.10);border:1px solid rgba(52,211,153,0.35);font-size:11px;color:var(--text2)">`;
    html += `<span style="color:#34d399;font-weight:600">⚙ Staged</span>`;
    html += `<span style="color:var(--text3)">intake ${esc(intakeShort)}…</span>`;
    html += `<button class="q-link" onclick="event.stopPropagation();(window.openIntakeFromInbox ? window.openIntakeFromInbox(decodeURIComponent('${encodeURIComponent(bridgedIntakeId)}')) : (location.hash='#intake/' + encodeURIComponent(decodeURIComponent('${encodeURIComponent(bridgedIntakeId)}'))))" style="background:transparent;border:0;color:var(--accent);cursor:pointer;font-size:11px;text-decoration:underline;padding:0">View match →</button>`;
    // Re-promote button (Bug Z follow-up, 2026-04-27): re-runs the
    // promotion step from the existing extraction snapshot. No new AI
    // call, no new PDF parsing — just replays the propagation pipeline.
    // Useful after a promoter bug fix to clear stalled review_required
    // intakes without re-flagging the email in Outlook.
    html += `<button class="q-link" title="Re-run promotion from existing extraction" onclick="event.stopPropagation();repromoteIntake(decodeURIComponent('${encodeURIComponent(bridgedIntakeId)}'), this)" style="background:transparent;border:0;color:var(--accent);cursor:pointer;font-size:11px;text-decoration:underline;padding:0;margin-left:4px">Re-promote ↻</button>`;
    // Create-from-intake button (2026-06-04): for an unmatched staged item
    // (no entity_id) whose extraction has an address, create the new property
    // in its domain and run the full promotion path. The route re-runs the
    // matcher first, so a no-address item just returns an error toast.
    if (!item.entity_id) {
      html += `<button class="q-link" title="Create a new property from this extraction and promote" onclick="event.stopPropagation();createPropertyFromIntakeUI(decodeURIComponent('${encodeURIComponent(bridgedIntakeId)}'), this)" style="background:transparent;border:0;color:var(--accent);cursor:pointer;font-size:11px;text-decoration:underline;padding:0;margin-left:4px">Create property →</button>`;
    }
    html += `</div>`;
  }

  // Normalized quick actions — outcome-aware (R4-C §1). Processed/archived rows
  // don't re-offer Triage/Promote (the pipeline already acted); OM-sourced rows
  // route Promote to the OM re-promotion path instead of the generic
  // shared-action promotion.
  html += '<div class="q-actions">';
  const _encId = encodeURIComponent(item.id);
  const _assignBtn = `<button class="q-action" onclick="quickReassign(decodeURIComponent('${_encId}'),'inbox',${jsStringArg(item.title || item.subject || 'Untitled')})">Assign</button>`;
  const _dismissBtn = `<button class="q-action danger" onclick="_opsBtnGuard(this, dismissSingle, decodeURIComponent('${_encId}'))">Dismiss</button>`;
  const _isOmSource = item.source_type === 'email_om' || item.source_type === 'copilot_chat_om';
  if (io && io.verdict === 'processed') {
    html += _assignBtn + _dismissBtn;
  } else if (io && io.verdict === 'archived') {
    html += _dismissBtn;
  } else {
    if (item.status === 'new') {
      html += `<button class="q-action" onclick="_opsBtnGuard(this, triageSingle, decodeURIComponent('${_encId}'))">Triage</button>`;
    }
    if (io && _isOmSource) {
      html += `<button class="q-action primary" title="Re-run OM promotion from the extraction" onclick="event.stopPropagation();repromoteIntake(decodeURIComponent('${encodeURIComponent(io.intake_id)}'), this)">Promote (OM) ↻</button>`;
    } else {
      html += `<button class="q-action primary" onclick="_opsBtnGuard(this, promoteSingle, decodeURIComponent('${_encId}'))">Promote</button>`;
    }
    html += _assignBtn + _dismissBtn;
  }
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
  const statusLabel = status === 'dismissed' ? 'Dismissing' : status === 'archived' ? 'Archiving' : 'Triaging';
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

// Re-run promotion for a staged-intake row using its existing extraction
// snapshot. Calls /api/intake?_route=promote which pulls from
// staged_intake_extractions + staged_intake_items.raw_payload, builds the
// metadata, and re-runs the sidebar pipeline. Free in API tokens (no new
// AI calls, no PDF re-parse). Used to clear stalled review_required
// intakes after a promoter-side bug fix.
async function repromoteIntake(intakeId, btn) {
  if (!intakeId) return;
  const origText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Re-promoting…'; }
  try {
    const res = await opsPost('/api/intake?_route=promote', { intake_id: intakeId });
    if (res.ok && res.data?.propagated !== false) {
      const dom = res.data?.domain || '?';
      const pid = res.data?.domain_property_id || '?';
      showToast(`Re-promoted (${dom} property ${pid})`, 'success');
      renderInboxTriage();
    } else {
      const why = res.error || res.data?.pipeline_summary?.reason || 'Re-promote failed';
      showToast(why, 'error');
      if (btn) { btn.disabled = false; btn.textContent = origText || 'Re-promote ↻'; }
    }
  } catch (err) {
    showToast('Re-promote error: ' + (err?.message || err), 'error');
    if (btn) { btn.disabled = false; btn.textContent = origText || 'Re-promote ↻'; }
  }
}

// Create a NEW property from a staged-intake extraction and run the full
// promotion path. Calls /api/intake?_route=create-property, which re-runs the
// matcher first (so an item that now matches just promotes), then creates the
// property in its routed domain (source=om_intake) and promotes. Used to clear
// the "valid extraction, no existing property" review pile.
async function createPropertyFromIntakeUI(intakeId, btn) {
  if (!intakeId) return;
  const origText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  try {
    const res = await opsPost('/api/intake?_route=create-property', { intake_id: intakeId });
    if (res.ok && res.data?.ok) {
      const created = (res.data.created || []).filter(c => c.ok);
      const first = created[0];
      if (res.data.note === 'already_matched_no_create') {
        showToast('Already matched — promoted to existing property', 'success');
      } else if (first) {
        showToast(`Created ${first.domain} property ${first.property_id}` +
          (created.length > 1 ? ` (+${created.length - 1} more)` : '') +
          (res.data.matched ? ' — promoted' : ''), 'success');
      } else {
        showToast('Property created', 'success');
      }
      renderInboxTriage();
    } else {
      const why = res.data?.error || res.error || 'Create property failed';
      showToast(why, 'error');
      if (btn) { btn.disabled = false; btn.textContent = origText || 'Create property →'; }
    }
  } catch (err) {
    showToast('Create property error: ' + (err?.message || err), 'error');
    if (btn) { btn.disabled = false; btn.textContent = origText || 'Create property →'; }
  }
}

// Re-extract a zero-text (scanned) PDF through the vision/OCR fallback. Calls
// /api/intake?_route=ocr-reextract which forces a full re-extraction; the
// extractor's OCR path runs because pdf-parse yields 0 chars on the scan.
async function ocrReextractIntake(intakeId, btn) {
  if (!intakeId) return;
  const origText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Re-extracting…'; }
  try {
    const res = await opsPost('/api/intake?_route=ocr-reextract', { intake_id: intakeId });
    if (res.ok && res.data?.ok !== false) {
      showToast('Re-extracted via OCR — refresh to see results', 'success');
      renderInboxTriage();
    } else {
      showToast(res.data?.error || res.error || 'OCR re-extract failed', 'error');
      if (btn) { btn.disabled = false; btn.textContent = origText || 'Re-extract (OCR) ↻'; }
    }
  } catch (err) {
    showToast('OCR re-extract error: ' + (err?.message || err), 'error');
    if (btn) { btn.disabled = false; btn.textContent = origText || 'Re-extract (OCR) ↻'; }
  }
}

// ============================================================================
// ENTITIES — canonical model browser
// ============================================================================
// B6 (2026-06-06): the header used to read "All (25)" — the fetch slice
// presented as the universe. Now: the entity_type filter + the optional name
// search run SERVER-side, and the header shows the loaded count against the
// real (estimated) total ("25 of ~16,400 — search to narrow"). Search hits
// /api/entities?action=search&q= (name/canonical_name across the workspace).
async function renderEntitiesPage(page = opsEntitiesPage) {
  const el = document.getElementById('entitiesContent');
  if (!el) return;
  opsEntitiesPage = Math.max(parseInt(page, 10) || 1, 1);
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:entities');

  const term = (opsEntitySearch || '').trim();
  const typeParam = (opsEntityFilter && opsEntityFilter !== 'all') ? '&entity_type=' + encodeURIComponent(opsEntityFilter) : '';
  const searching = term.length >= 2;
  const reqPath = searching
    ? `/api/entities?action=search&q=${encodeURIComponent(term)}${typeParam}`
    : `/api/entities?page=${opsEntitiesPage}&per_page=25${typeParam}`;

  const res = await opsApi(reqPath);
  if (!res.ok) {
    el.innerHTML = opsErrorState(res, 'renderEntitiesPage()', 'Could not load entities');
    perf.end();
    return;
  }

  opsEntitiesData = res.data?.entities || res.data || [];
  opsPagination['/api/entities'] = searching ? null : (res.data?.pagination || null);
  const shown = opsEntitiesData.length;
  const total = res.data?.pagination?.total ?? res.data?.count ?? null;
  const totalLabel = total != null
    ? (searching ? `${shown} match${shown === 1 ? '' : 'es'}` : `${shown} of ~${Number(total).toLocaleString()}`)
    : `${shown}`;

  let html = '';
  html += `<div class="ops-header">
    <h2>Entities <span style="font-size:13px;color:var(--text2);font-weight:400">${esc(totalLabel)}${(!searching && total != null && shown < total) ? ' — search to narrow' : ''}</span></h2>
  </div>`;

  // Search box (server-side). Enter or the button runs the search; Clear resets.
  html += '<div class="ops-filters" style="gap:8px;align-items:center">';
  html += `<input id="opsEntitySearchInput" type="text" value="${esc(term)}" placeholder="Search entities by name…"
      onkeydown="if(event.key==='Enter'){opsEntityRunSearch();return false;}"
      style="flex:1;min-width:200px;max-width:360px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--s3);color:var(--text1);font-size:13px">`;
  html += `<button class="ops-filter" onclick="opsEntityRunSearch()">Search</button>`;
  if (searching) html += `<button class="ops-filter" onclick="opsEntityClearSearch()">Clear</button>`;
  html += '</div>';

  // Type filter — server-side over the FULL universe (not the loaded page).
  html += '<div class="ops-filters">';
  const TYPES = ['all', 'person', 'organization', 'asset'];
  TYPES.forEach(function (t) {
    const lbl = t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1);
    html += `<button class="ops-filter ${opsEntityFilter === t ? 'active' : ''}" onclick="opsEntityFilter='${t}';opsEntitiesPage=1;renderEntitiesPage()">${lbl}</button>`;
  });
  html += '</div>';

  const filtered = opsEntitiesData; // filtering is server-side now

  if (!filtered.length) {
    html += emptyStateHTML(
      '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
      searching ? 'No matches' : (opsEntityFilter === 'all' ? 'No entities yet' : 'No matching entities'),
      searching ? 'No entities match “' + esc(term) + '”' + (opsEntityFilter !== 'all' ? ' in ' + esc(opsEntityFilter) : '') + '. Try a different term or Clear the search.'
        : (opsEntityFilter === 'all' ? 'Entities are created when you sync connectors or import data.' : 'Try a different entity type.'),
      null, null
    );
  } else {
    // Tier 3 Phase 3: entity merge is reachable from the Entities surface via the
    // ONE shared modal (find-target search picks the duplicate). Gated on
    // `unified_merge_modal` — flag OFF restores the legacy no-merge-here behavior.
    const canMerge = (typeof checkFlag !== 'function') || checkFlag('unified_merge_modal');
    filtered.forEach(entity => {
      const mergeBtn = canMerge
        ? `<button class="dq-deeplink" style="margin-top:6px" onclick="event.stopPropagation(); entityMergeFrom(decodeURIComponent('${encodeURIComponent(entity.id)}'), decodeURIComponent('${encodeURIComponent(entity.name || '')}'))">Merge…</button>`
        : '';
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
        ${mergeBtn}
      </div>`;
    });
  }

  // Pagination only applies to the unfiltered/paginated list; search returns a
  // single capped result set (top 50 by name), so no pager there.
  if (!searching) html += paginationHTML('/api/entities', 'renderEntitiesPage');

  el.innerHTML = html;
  // Keep focus in the search box after a search re-render.
  if (searching) { const si = document.getElementById('opsEntitySearchInput'); if (si) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); } }
  perf.end();
}

// B6 search helpers — read the input, validate (≥2 chars), re-render.
function opsEntityRunSearch() {
  const si = document.getElementById('opsEntitySearchInput');
  const v = si ? String(si.value || '').trim() : '';
  if (v && v.length < 2) { if (typeof showToast === 'function') showToast('Type at least 2 characters to search.', 'warn'); return; }
  opsEntitySearch = v;
  opsEntitiesPage = 1;
  renderEntitiesPage();
}
window.opsEntityRunSearch = opsEntityRunSearch;
function opsEntityClearSearch() {
  opsEntitySearch = '';
  opsEntitiesPage = 1;
  renderEntitiesPage();
}
window.opsEntityClearSearch = opsEntityClearSearch;

// ── Review Console (UX move #2b, 2026-05-31) ───────────────────────────────
// Unified work-type review lanes. Reads /api/review-counts (one batched call)
// and renders a lane card per work type with a live count + deep-link into the
// surface that currently owns that work, until each lane gets its own view.
// ── Ops Health (2026-05-31) ────────────────────────────────────────────────
// Surfaces failing crons, stalled workers, open alerts, flow failures, and
// write-failure pile-ups in-app. Reads /api/ops-health (one batched call).
// Built because the stuck-LLC-worker regression degraded silently for days,
// visible only via a manual DB sweep — this makes that class of problem self-evident.
async function renderOpsHealthPage() {
  const el = document.getElementById('opsHealthContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = (typeof opsPerf === 'function') ? opsPerf('render:ops_health') : { end() {} };

  const res = await opsApi('/api/ops-health');
  if (!res.ok) {
    el.innerHTML = opsErrorState(res, 'renderOpsHealthPage()', 'Could not load Ops Health');
    perf.end();
    return;
  }
  const d = res.data || {};
  const s = d.summary || {};
  const sevClass = (sev) => {
    const v = String(sev || '').toLowerCase();
    return v === 'critical' || v === 'error' ? 'red' : v === 'warning' || v === 'warn' ? 'yellow' : '';
  };

  let html = '<div class="ops-header"><h2>Ops Health</h2></div>';
  html += '<div class="oh-intro">System self-monitoring: failing jobs, stalled workers, open alerts. If this page is all-clear, the pipelines are healthy.</div>';

  // Summary KPI row.
  html += '<div class="metrics-grid">';
  html += metricCardHTML('Open Alerts', s.open_alerts == null ? '—' : s.open_alerts, 'health alerts', (s.open_alerts > 0) ? 'red' : 'green');
  html += metricCardHTML('Workers Stuck', s.workers_stuck == null ? '—' : s.workers_stuck, 'queues degrading', (s.workers_stuck > 0) ? 'red' : 'green');
  html += metricCardHTML('Flow Failures', s.open_flow_failures == null ? '—' : s.open_flow_failures, 'Power Automate', (s.open_flow_failures > 0) ? 'yellow' : 'green');
  html += metricCardHTML('Cron Issues', s.open_cron_issues == null ? '—' : s.open_cron_issues, 'unresolved', (s.open_cron_issues > 0) ? 'yellow' : 'green');
  const wf24 = s.write_failures_24h;
  const wfSub = (s.write_failures_7d != null) ? ('last 24h · ' + Number(s.write_failures_7d).toLocaleString() + ' in 7d') : 'last 24h';
  html += metricCardHTML('Write Failures', wf24 == null ? '—' : Number(wf24).toLocaleString(), wfSub, (wf24 > 0) ? 'yellow' : 'green');
  html += '</div>';

  // Top write-failure offender (24h) — names the single worst path so a storm
  // can't hide in a 7-day total (the LLC 23514 regression signature).
  if (s.write_failures_top && s.write_failures_top.count_24h) {
    const t = s.write_failures_top;
    html += '<div class="widget"><div class="widget-title">Top write-failure path (24h)</div>'
      + '<div class="q-item"><div class="q-item-header"><span class="q-item-title">'
      + esc((t.domain || '?') + ' ' + (t.method || '') + ' ' + (t.path || '')) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge pri-high">' + Number(t.count_24h).toLocaleString() + '</span>'
      + (t.http_status ? '<span class="q-badge">http ' + esc(String(t.http_status)) + '</span>' : '') + '</div></div>'
      + (t.sample_error ? '<div class="q-item-meta">' + esc(String(t.sample_error).slice(0, 200)) + '</div>' : '')
      + '</div></div>';
  }

  // Workers.
  html += '<div class="widget"><div class="widget-title">Background Workers</div>';
  (d.workers || []).forEach(function (w) {
    const stuck = w.status === 'stuck';
    const badge = stuck ? '<span class="q-badge pri-high">STUCK</span>'
      : (w.status === 'idle_backlog' ? '<span class="q-badge">backlog</span>' : '<span class="q-badge" style="background:var(--okbg);color:var(--green)">ok</span>');
    html += '<div class="q-item"><div class="q-item-header"><span class="q-item-title">' + esc(w.label) + '</span><div class="q-item-badges">' + badge + '</div></div>'
          + '<div class="q-item-meta">queued: ' + (w.queued == null ? '—' : w.queued.toLocaleString())
          + ' · in&nbsp;progress: ' + (w.in_progress == null ? '—' : w.in_progress.toLocaleString())
          + (stuck ? ' — rows accumulating in_progress; check the reclaim/handler' : '') + '</div></div>';
  });
  if (!(d.workers || []).length) html += '<div class="ops-empty">No worker data.</div>';
  html += '</div>';

  // Open alerts.
  html += '<div class="widget"><div class="widget-title">Open Alerts</div>';
  if (!(d.alerts || []).length) {
    html += '<div class="ops-empty">No open alerts.</div>';
  } else {
    d.alerts.forEach(function (a) {
      html += '<div class="q-item oh-' + sevClass(a.severity) + '"><div class="q-item-header"><span class="q-item-title">' + esc(a.alert_kind || 'alert') + '</span>'
            + '<div class="q-item-badges"><span class="q-badge ' + (sevClass(a.severity) === 'red' ? 'pri-high' : '') + '">' + esc(a.severity || '') + '</span></div></div>'
            + '<div class="q-item-meta">' + esc(a.summary || '') + (a.source ? ' · <span style="color:var(--text3)">' + esc(a.source) + '</span>' : '')
            + (a.age_hours != null ? ' · ' + Math.round(a.age_hours) + 'h old' : '') + '</div></div>';
    });
  }
  html += '</div>';

  // Flow failures.
  html += '<div class="widget"><div class="widget-title">Flow Failures (Power Automate)</div>';
  if (!(d.flow_failures || []).length) {
    html += '<div class="ops-empty">No open flow failures.</div>';
  } else {
    d.flow_failures.forEach(function (f) {
      html += '<div class="q-item oh-' + sevClass(f.severity) + '"><div class="q-item-header"><span class="q-item-title">' + esc(f.flow_name || 'flow') + '</span></div>'
            + '<div class="q-item-meta">' + esc(f.failed_action || '') + (f.error_detail_short ? ' — ' + esc(f.error_detail_short) : '') + '</div></div>';
    });
  }
  html += '</div>';

  el.innerHTML = html;
  perf.end();
}
window.renderOpsHealthPage = renderOpsHealthPage;

// ── Decision Center (R7 Phase 1, Slice 2 — 2026-06-07) ─────────────────────
// The Review Console becomes the Decision Center: lanes keyed by the QUESTION
// being asked. Decision lanes (backed by lcc_decisions) render on top; the
// legacy review-count lanes follow under "More review work" until Phase 2
// converts them. Each decision lane: question → subject+context card → 2-4
// one-click verdicts → workable top-N by $ value, self-propelling.
function _dcMoney(n) { n = Number(n); return (isFinite(n) && n > 0) ? '$' + Math.round(n).toLocaleString() : ''; }
function _dcLaneCard(count, label, sub, onclick, tone) {
  const countStr = (typeof count === 'number') ? count.toLocaleString() : '—';
  return '<button type="button" class="rc-lane ' + (tone || '') + '" onclick="' + onclick + '">'
    + '<div class="rc-lane-count">' + countStr + '</div>'
    + '<div class="rc-lane-label">' + esc(label) + '</div>'
    + (sub ? '<div class="rc-lane-parts">' + esc(sub) + '</div>' : '')
    + '<div class="rc-lane-cta">Decide →</div></button>';
}

async function renderReviewConsolePage() {
  const el = document.getElementById('reviewConsoleContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = (typeof opsPerf === 'function') ? opsPerf('render:review_console') : { end() {} };

  // R7 Phase 2: every lane is now a real decision lane (no more "More review
  // work" deep-links). Decision-lane counts (seeded + federated, each labeled
  // with its mode) + the SOS owner-contact count, in parallel.
  const [decR, res] = await Promise.all([
    opsApi('/api/decisions?summary=1'),
    opsApi('/api/review-counts'),
  ]);

  let html = '<div class="ops-header"><h2>Decision Center</h2></div>';
  html += '<div class="rc-intro">Every manual decision in one place, grouped by the question being asked. Most work is auto-resolved by the pipeline — each lane shows the genuine residue that needs you. Pick a lane, work the top items by value, and record a verdict.</div>';

  // Per-decision_type counts: residue (needs-you), handled (decided+superseded),
  // auto-resolved (superseded). Counts come straight from /api/decisions?summary=1
  // so they match the underlying views exactly.
  const dc = {}, dcRes = {}, dcAuto = {};
  if (decR.ok && decR.data && Array.isArray(decR.data.lanes)) {
    decR.data.lanes.forEach(function (l) {
      dc[l.decision_type] = Number(l.n) || 0;
      dcRes[l.decision_type] = Number(l.resolved) || 0;
      dcAuto[l.decision_type] = Number(l.auto_resolved) || 0;
    });
  }
  // SOS owner-contact links keep their own (already-decision-shaped) worklist.
  let sosN = 0;
  if (res.ok && res.data && Array.isArray(res.data.lanes)) {
    const s = res.data.lanes.find(function (l) { return l.key === 'sos_owner_links'; });
    if (s && typeof s.count === 'number') sosN = s.count;
  }
  dc['sos_owner_links'] = sosN;

  // Every sub-lane (decision_type) with its existing renderer — NOTHING lost.
  // Grouped into the 8 logical lanes via the Tier 3 lane map (review-shared.js).
  const SUBLANES = [
    { dt: 'confirm_true_owner', label: 'Confirm the true owner', open: "renderDecisionLane('confirm_true_owner')" },
    { dt: 'confirm_buyer_parent', label: 'Buyer parents & SF mapping', open: 'renderBuyerParentLane()', extra: 'map_sf_parent_account' },
    { dt: 'resolve_owner_parent', label: 'Owner → ultimate parent', open: "renderFederatedLane('resolve_owner_parent')" },
    { dt: 'owner_source_conflict', label: 'Owner vs deed — who took title', open: "renderFederatedLane('owner_source_conflict')" },
    { dt: 'suspected_sale', label: 'Suspected unrecorded sales', open: "renderFederatedLane('suspected_sale')" },
    { dt: 'loan_maturity', label: 'Loan maturities → refi or sell', open: "renderFederatedLane('loan_maturity')" },
    { dt: 'listing_event_action', label: 'New sales → act', open: "renderFederatedLane('listing_event_action')" },
    { dt: 'sf_link_conflict', label: 'Salesforce link conflicts', open: "renderDecisionLane('sf_link_conflict')" },
    { dt: 'sf_link_collision', label: 'Salesforce link — merge candidates', open: "renderDecisionLane('sf_link_collision')" },
    { dt: 'merge_duplicate_entities', label: 'Duplicate entities — merge', open: "renderFederatedLane('merge_duplicate_entities')" },
    { dt: 'junk_entity_name', label: 'Junk entity names', open: "renderDecisionLane('junk_entity_name')" },
    { dt: 'property_merge', label: 'Property merges & duplicates', open: "renderFederatedLane('property_merge')" },
    { dt: 'provenance_conflict', label: 'Data conflicts & provenance', open: "renderFederatedLane('provenance_conflict')" },
    { dt: 'pending_update', label: 'Pending updates (Gov)', open: "renderFederatedLane('pending_update')" },
    { dt: 'caprate_review', label: 'Cap-rate review — suspect movers', open: "renderFederatedLane('caprate_review')" },
    { dt: 'bad_rent_lease', label: 'Bad-rent leases — fix at source', open: "renderFederatedLane('bad_rent_lease')" },
    { dt: 'intake_disposition', label: 'Staged intake — needs review', open: "renderFederatedLane('intake_disposition')" },
    { dt: 'match_disambiguation', label: 'Intake match disambiguation', open: "renderDecisionLane('match_disambiguation')" },
    { dt: 'cms_link_suspect', label: 'CMS ↔ property link suspects', open: "renderFederatedLane('cms_link_suspect')" },
    { dt: 'sos_owner_links', label: 'Owner-contact links to confirm', open: 'renderSosLinkWorklist()' },
    { dt: 'implausible_value', label: 'Implausible values', open: "renderFederatedLane('implausible_value')" },
    { dt: 'llc_research_dead', label: 'LLC research dead-letters', open: "renderDecisionLane('llc_research_dead')" },
    { dt: 'availability_checker_botblock', label: 'Availability bot-blocks', open: "renderDecisionLane('availability_checker_botblock')" },
  ];
  const subN = function (s) { return (dc[s.dt] || 0) + (s.extra ? (dc[s.extra] || 0) : 0); };
  const subHandled = function (s) { return (dcRes[s.dt] || 0) + (s.extra ? (dcRes[s.extra] || 0) : 0); };

  const laneOf = (typeof laneForDecisionType === 'function') ? laneForDecisionType : function () { return 'automation'; };
  const lanesDef = (typeof LCC_REVIEW_LANES !== 'undefined' && LCC_REVIEW_LANES) ? LCC_REVIEW_LANES : [];
  const grouped = {};
  SUBLANES.forEach(function (s) { const k = laneOf(s.dt) || 'automation'; (grouped[k] = grouped[k] || []).push(s); });

  let totalOpen = 0;
  html += '<div class="rc-lanes-grouped">';
  // Render in lane-map order; fall back to a single flat group if the map didn't load.
  (lanesDef.length ? lanesDef : [{ lane: '_all', title: 'Decisions', question: '' }]).forEach(function (L) {
    const subs = (L.lane === '_all') ? SUBLANES : (grouped[L.lane] || []);
    if (!subs.length) return;
    const need = subs.reduce(function (a, s) { return a + subN(s); }, 0);
    const handled = subs.reduce(function (a, s) { return a + subHandled(s); }, 0);
    totalOpen += need;
    html += '<div class="rc-glane' + (need > 0 ? '' : ' rc-lane-clear') + '">'
      + '<div class="rc-glane-head"><div class="rc-glane-title">' + esc(L.title) + '</div>'
      + '<div class="rc-glane-counts">'
      + (need > 0 ? '<span class="rc-need">' + need + ' need you</span>' : '<span class="rc-clear">✓ clear</span>')
      + (handled > 0 ? ' <span class="rc-handled">' + handled + ' handled</span>' : '')
      + '</div></div>'
      + (L.question ? '<div class="rc-glane-q">' + esc(L.question) + '</div>' : '')
      + '<div class="rc-sublanes">';
    subs.forEach(function (s) {
      const n = subN(s);
      html += '<button class="rc-sublane' + (n > 0 ? ' has-work' : '') + '" onclick="' + esc(s.open) + '">'
        + '<span class="rc-sublane-label">' + esc(s.label) + '</span>'
        + '<span class="rc-sublane-n">' + n + '</span></button>';
    });
    html += '</div></div>';
  });
  html += '</div>';

  if (typeof setReviewNavBadge === 'function') setReviewNavBadge(totalOpen);

  // C3 (2026-06-06): cache sub-lane counts so an emptied lane can point the user
  // at the next busiest lane instead of dead-ending on a celebration.
  _dcLaneSummary = SUBLANES.map(function (s) { return { label: s.label, open: s.open, n: subN(s) }; });

  el.innerHTML = html;
  perf.end();
}
window.renderReviewConsolePage = renderReviewConsolePage;

// Decision Center nav badge — total residue (needs-you) across all lanes.
function setReviewNavBadge(n) {
  const el = document.getElementById('reviewNavBadge');
  if (!el) return;
  if (n && n > 0) { el.textContent = n > 999 ? '999+' : String(n); el.hidden = false; }
  else { el.textContent = ''; el.hidden = true; }
}
window.setReviewNavBadge = setReviewNavBadge;

// Proactively populate the nav badge once on load (cheap summary read) so the
// operator sees how much review work is waiting without opening the page.
async function refreshReviewNavBadge() {
  try {
    const [r, rc] = await Promise.all([opsApi('/api/decisions?summary=1'), opsApi('/api/review-counts')]);
    let total = (r.ok && r.data && typeof r.data.total === 'number') ? r.data.total : 0;
    if (rc.ok && rc.data && Array.isArray(rc.data.lanes)) {
      const s = rc.data.lanes.find(function (l) { return l.key === 'sos_owner_links'; });
      if (s && typeof s.count === 'number') total += s.count;
    }
    setReviewNavBadge(total);
  } catch (_e) { /* best-effort */ }
}
window.refreshReviewNavBadge = refreshReviewNavBadge;
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(refreshReviewNavBadge, 2500); });
  } else { setTimeout(refreshReviewNavBadge, 2500); }
}

// C3 helper: "Next: <busiest other lane> →" CTA for empty / cleared lane states.
let _dcLaneSummary = [];
let _dcCurrentOpenExpr = ''; // open-expr of the lane currently being worked
function _dcNextLaneCTA(currentOpenExpr) {
  const lanes = (_dcLaneSummary || []).filter(function (l) { return l.n > 0 && l.open !== currentOpenExpr; });
  if (!lanes.length) return '';
  lanes.sort(function (a, b) { return b.n - a.n; });
  const top = lanes[0];
  return '<div style="margin-top:12px"><button class="q-action primary" onclick="' + esc(top.open) + '">Next: '
    + esc(top.label) + ' (' + top.n + ') →</button>'
    + ' <button class="q-action" onclick="renderReviewConsolePage()">All lanes</button></div>';
}

// ── SOS owner-contact link worklist (Review Console lane, 2026-05-31) ───────
// Opens inline in the Review Console: lists weak FL SOS->contact links with
// the evidence + Confirm/Reject buttons calling /api/resolve-owner-link.
async function renderSosLinkWorklist() {
  const el = document.getElementById('reviewConsoleContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const res = await opsApi('/api/resolve-owner-link?limit=100');
  if (!res.ok) { el.innerHTML = opsErrorState(res, 'renderSosLinkWorklist()', 'Could not load owner-contact links'); return; }
  const items = (res.data && Array.isArray(res.data.items)) ? res.data.items : [];
  let html = '<div class="ops-header"><h2>Owner-contact links to confirm</h2>'
    + '<button class="q-action" onclick="renderReviewConsolePage()">\u2190 Back to Review Console</button></div>';
  html += '<div class="rc-intro">Weak (single-signal) links between SOS-enriched FL recorded owners and CRM contacts. Confirm to link into the contact structure, or reject. Strong (entity-identity) links were auto-applied.</div>';
  if (!items.length) { html += '<div class="ops-empty">No links awaiting review. \u2713</div>'; el.innerHTML = html; return; }
  html += '<div class="rc-progress"><span id="soslinkRemaining">' + items.length + '</span> to confirm</div>';
  items.forEach(function (it, _ix) {
    const sig = Array.isArray(it.match_signals) ? it.match_signals.join(', ') : '';
    html += '<div class="q-item' + (_ix === 0 ? ' pq-next' : '') + '" id="soslink-' + it.link_id + '">'
      + '<div class="q-item-header"><span class="q-item-title">' + esc(it.recorded_owner_name || 'Owner') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(sig) + '</span></div></div>'
      + '<div class="q-item-meta">Matched contact: <b>' + esc(it.contact_name || it.contact_company || '\u2014') + '</b>'
      + (it.contact_company ? ' \u00b7 ' + esc(it.contact_company) : '')
      + (it.registered_agent_name ? ' \u00b7 agent: ' + esc(it.registered_agent_name) : '')
      + (it.manager_name ? ' \u00b7 officer: ' + esc(it.manager_name) : '') + '</div>'
      + (it.source_property_address ? '<div class="q-item-meta">Property: <b>' + esc(it.source_property_address) + '</b></div>' : '')
      + '<div class="q-actions">'
      + '<button class="q-action primary" onclick="resolveOwnerLink(' + it.link_id + ', \'confirm\', ' + (it.source_property_id != null ? it.source_property_id : 'null') + ')">Confirm link</button>'
      + '<button class="q-action" onclick="resolveOwnerLink(' + it.link_id + ', \'reject\')">Reject</button>'
      + '</div></div>';
  });
  el.innerHTML = html;
}
window.renderSosLinkWorklist = renderSosLinkWorklist;

async function resolveOwnerLink(linkId, decision, propId) {
  const res = await opsApi('/api/resolve-owner-link', { method: 'POST', body: JSON.stringify({ link_id: linkId, decision: decision }) });
  const row = document.getElementById('soslink-' + linkId);
  if (res.ok && res.data && res.data.ok) {
    // Carry-forward: after a confirm, the owner is now CRM-linked — offer a
    // one-click hop to that property's Ownership & CRM tab to act on it
    // (create lead / cadence) instead of stranding the user in the worklist.
    const pid = (res.data && res.data.source_property_id != null) ? res.data.source_property_id : propId;
    if (row) {
      row.style.opacity = '0.5';
      const fwd = (decision === 'confirm' && pid != null && typeof openUnifiedDetail === 'function')
        ? '<button class="q-action primary" onclick="openUnifiedDetail(\'gov\', {property_id: ' + pid + '}, {}, \'Ownership &amp; CRM\')">Open property \u2192</button>'
        : '';
      row.querySelector('.q-actions').innerHTML = '<span class="q-badge">' + (decision === 'confirm' ? 'Confirmed \u2713' : 'Rejected') + '</span>' + fwd;
    }
    if (typeof showToast === 'function') showToast(decision === 'confirm' ? 'Link confirmed' : 'Link rejected', 'success');
    // Self-propelling contract: mark done, decrement the remaining counter, and
    // advance focus to the next pending link so the work pulls itself forward.
    if (row) row.classList.add('resolved');
    _sosAdvanceToNext();
  } else {
    if (typeof showToast === 'function') showToast('Action failed: ' + ((res.data && res.data.error) || res.error || 'unknown'), 'error');
  }
}
function _sosAdvanceToNext() {
  var scope = document.getElementById('reviewConsoleContent');
  if (!scope) return;
  var pending = scope.querySelectorAll('.q-item[id^="soslink-"]:not(.resolved)');
  var remEl = document.getElementById('soslinkRemaining');
  if (remEl) remEl.textContent = pending.length;
  scope.querySelectorAll('.q-item.pq-next').forEach(function (n) { n.classList.remove('pq-next'); });
  if (pending.length) {
    var next = pending[0];
    next.classList.add('pq-next');
    next.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    var prog = scope.querySelector('.rc-progress');
    if (prog) prog.innerHTML = 'All links reviewed \u2713';
    if (typeof showToast === 'function') showToast('All owner-contact links reviewed \u2713', 'success');
  }
}
window.resolveOwnerLink = resolveOwnerLink;

// ── Decision Center lanes (R7 Phase 1, Slice 2 — 2026-06-07) ───────────────
// Inline worklists for the lcc_decisions lanes. Card anatomy: subject+context,
// then one-click verdicts that record + move the subject forward (the SOS-lane
// self-propelling model). Verdicts ride existing machinery via
// /api/decision-verdict; the surface is a router + recorder.
let _dcItems = {};

function _dcCardHTML(it, isNext) {
  const c = it.context || {};
  const id = it.id;
  let body = '', actions = '';
  if (it.decision_type === 'confirm_true_owner') {
    const rent = _dcMoney(c.annual_rent);
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.entity_name || 'Entity') + '</span>'
      + (rent ? '<div class="q-item-badges"><span class="q-badge">' + rent + '/yr</span></div>' : '') + '</div>'
      + '<div class="q-item-meta">Domain true owner: <b>' + esc(c.true_owner_name || '—') + '</b> — current, or stale (pre-acquisition)?</div>'
      + (c.source_property_address ? '<div class="q-item-meta">Property: ' + esc(c.source_property_address)
          + (c.source_property_state ? ', ' + esc(c.source_property_state) : '') + '</div>' : '');
    actions = '<button class="q-action primary" onclick="dcVerdict(' + id + ',\'correct\')">Correct — connect</button>'
      + '<button class="q-action" onclick="dcStale(' + id + ')">Stale — new owner…</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'research\')">Research</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'skip\')">Skip</button>';
  } else if (it.decision_type === 'confirm_buyer_parent') {
    const rent = _dcMoney(c.rollup_annual_rent);
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.parent_name || 'Buyer parent') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + (Number(c.spe_count) || 0) + ' SPEs</span>'
      + (rent ? '<span class="q-badge">' + rent + '/yr</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">Confirm the controlling sponsor before any buy-side opportunity is opened on the parent.</div>';
    actions = '<button class="q-action primary" onclick="dcVerdict(' + id + ',\'confirm_sponsor\')">Confirm sponsor</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'research\')">Research</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'skip\')">Skip</button>';
  } else if (it.decision_type === 'map_sf_parent_account') {
    const rent = _dcMoney(c.rollup_annual_rent);
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.parent_name || 'Buyer parent') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + (Number(c.spe_count) || 0) + ' SPEs</span>'
      + (rent ? '<span class="q-badge">' + rent + '/yr</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">Map to the Salesforce <b>parent</b> account (never a subsidiary SPE). Held government-buyer syncs release once mapped.</div>'
      + '<div class="dcsf" id="dcsf-' + id + '">'
      +   '<div class="dcsf-row"><input class="dcsf-input" id="dcsfq-' + id + '" type="text" value="' + esc(c.parent_name || '') + '" placeholder="Search Salesforce accounts" onkeydown="if(event.key===\'Enter\'){dcSfSearch(' + id + ');return false;}">'
      +   '<button class="q-action" onclick="dcSfSearch(' + id + ')">Search</button></div>'
      +   '<div class="dcsf-results" id="dcsfr-' + id + '"></div>'
      +   '<div class="dcsf-row dcsf-manual"><input class="dcsf-input" id="dcsfid-' + id + '" type="text" placeholder="…or paste SF Account ID / record URL">'
      +   '<button class="q-action" onclick="dcSfManual(' + id + ')">Validate &amp; map</button></div>'
      + '</div>';
    actions = '<button class="q-action primary" onclick="dcSfSearch(' + id + ')">Search Salesforce →</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'create_later\')">No account — hold</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'skip\')">Skip</button>';
  } else if (it.decision_type === 'junk_entity_name') {
    const idc = Number(c.identity_count) || 0;
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.entity_name || 'Entity') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.entity_type || '?') + '</span>'
      + (idc ? '<span class="q-badge">' + idc + ' identit' + (idc === 1 ? 'y' : 'ies') + '</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">Structural-garbage name flagged at the entity boundary. Rename it, merge it into the real entity, or leave it flagged.</div>';
    actions = '<button class="q-action primary" onclick="dcJunkRename(' + id + ')">Rename…</button>'
      + '<button class="q-action" onclick="dcJunkMerge(' + id + ')">Merge into…</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'leave_flagged\')">Leave flagged</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'research\')">Research</button>';
  } else if (it.decision_type === 'match_disambiguation') {
    const cands = Array.isArray(c.candidates) ? c.candidates : [];
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Intake ' + (c.intake_id || ''))) + '</span>'
      + (c.tenant ? '<div class="q-item-badges"><span class="q-badge">' + esc(c.tenant) + '</span></div>' : '') + '</div>'
      + '<div class="q-item-meta">The matcher found ' + cands.length + ' candidate propert' + (cands.length === 1 ? 'y' : 'ies')
      + ' above threshold. Pick the right one, or create a new property.</div>';
    cands.forEach(function (cand) {
      const pid = String(cand.property_id == null ? '' : cand.property_id);
      body += '<div class="q-item-meta">• <b>' + esc(cand.domain || '') + '</b> #' + esc(pid)
        + ' — ' + esc(cand.address || '') + (cand.tenant ? ' (' + esc(cand.tenant) + ')' : '')
        + ' <button class="q-action" onclick="dcPickCandidate(' + id + ',\'' + esc(cand.domain || '') + '\',\'' + esc(pid) + '\')">Pick this →</button></div>';
    });
    actions = '<button class="q-action" onclick="dcVerdict(' + id + ',\'create_property\')">None — create property</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'research\')">Research</button>';
  } else if (it.decision_type === 'llc_research_dead') {
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.search_name || c.recorded_owner_id || 'Owner LLC') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '?') + '</span>'
      + (c.attempts != null ? '<span class="q-badge">' + (Number(c.attempts) || 0) + ' attempts</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">Automated LLC research dead-lettered' + (c.last_error ? ' (' + esc(c.last_error) + ')' : '')
      + '.' + (c.guessed_state ? ' State: ' + esc(c.guessed_state) + '.' : '') + ' Resolve via the Secretary of State, retry, or park.</div>';
    actions = '<button class="q-action primary" onclick="dcVerdict(' + id + ',\'resolve_manually\')">Resolve manually (SOS)</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'retry\')">Retry</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'park\')">Park</button>';
  } else if (it.decision_type === 'availability_checker_botblock') {
    body = '<div class="q-item-header"><span class="q-item-title">Bot-block: ' + esc(c.domain || 'listings') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(String(c.unreachable == null ? '?' : c.unreachable))
      + '/' + esc(String(c.scanned == null ? '?' : c.scanned)) + ' unreachable</span></div></div>'
      + '<div class="q-item-meta">' + esc(c.summary || 'The availability-checker is being bot-blocked. Verify the top listings manually, or acknowledge.') + '</div>';
    actions = '<button class="q-action primary" onclick="dcVerdict(' + id + ',\'verify\')">Verify top 5 manually</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'acknowledge\')">Acknowledge</button>';
  } else if (it.decision_type === 'sf_link_conflict') {
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.owner_entity_name || 'Owner entity') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '?') + '</span></div></div>'
      + '<div class="q-item-meta">LCC entity is linked to SF Account <b>' + esc(c.lcc_sf_id || '—') + '</b>, '
      + 'but the domain owner carries <b>' + esc(c.domain_sf_id || '—') + '</b>. Which is canonical?</div>';
    actions = '<button class="q-action primary" onclick="dcVerdict(' + id + ',\'keep_current\')">Keep current (LCC)</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'accept_domain\')">Accept domain id</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'research\')">Research</button>';
  } else if (it.decision_type === 'sf_link_collision') {
    const ents = Array.isArray(c.entities) ? c.entities : [];
    const kindLabel = c.kind === 'dup_sfid' ? 'One Salesforce Account is on ' + ents.length + ' domain owners'
      : 'This Salesforce Account is already on another entity';
    body = '<div class="q-item-header"><span class="q-item-title">SF Account ' + esc(c.sf_account_id || '') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '?') + '</span></div></div>'
      + '<div class="q-item-meta">' + esc(kindLabel) + ' — same owner, ' + ents.length + ' entities. Keep one and merge the rest in, or keep separate.</div>';
    ents.forEach(function (e) {
      body += '<div class="q-item-meta">• <b>' + esc(e.name || e.entity_id) + '</b>'
        + (e.source ? ' <span class="q-badge">' + esc(e.source === 'sf_linked' ? 'SF-linked' : 'domain owner') + '</span>' : '')
        + ' <button class="q-action" onclick="dcVerdict(' + id + ',\'merge\',{winner_entity_id:\'' + esc(e.entity_id) + '\'})">Keep this — merge others in →</button></div>';
    });
    actions = '<button class="q-action" onclick="dcVerdict(' + id + ',\'keep_separate\')">Keep separate</button>'
      + '<button class="q-action" onclick="dcVerdict(' + id + ',\'research\')">Research</button>';
  }
  return '<div class="q-item' + (isNext ? ' pq-next' : '') + '" id="dc-' + id + '">' + body
    + '<div class="q-actions">' + actions + '</div></div>';
}
// A3 (2026-06-06): styled, validating modal (lccPrompt) instead of native
// prompt() — shows the current flagged name as context + validates before POST.
async function dcJunkRename(id) {
  const it = _dcItems[id]; const cur = (it && it.context && it.context.entity_name) || '';
  const ask = typeof lccPrompt === 'function'
    ? await lccPrompt('Rename this flagged entity.\n\nCurrent (flagged) name: ' + (cur || '—') + '\n\nEnter the real name:', cur || '')
    : (typeof prompt === 'function' ? prompt('New entity name:', cur || '') : '');
  if (ask == null) return;
  const v = String(ask || '').trim();
  if (!v) { if (typeof showToast === 'function') showToast('Name cannot be empty.', 'error'); return; }
  if (v === cur) { if (typeof showToast === 'function') showToast('Name unchanged — nothing to rename.', 'warn'); return; }
  dcVerdict(id, 'rename', { new_name: v });
}
window.dcJunkRename = dcJunkRename;
async function dcJunkMerge(id) {
  const it = _dcItems[id]; const cur = (it && it.context && it.context.entity_name) || '';
  const ask = typeof lccPrompt === 'function'
    ? await lccPrompt('Merge "' + (cur || 'this entity') + '" INTO the real entity it duplicates.\n\nPaste the target entity UUID (the entity to KEEP):', '')
    : (typeof prompt === 'function' ? prompt('Merge INTO entity id (UUID of the real entity to keep):') : '');
  if (ask == null) return;
  const v = String(ask || '').trim();
  if (!v) return;
  // Validate UUID shape before POST so a fat-fingered id doesn't reach the merge RPC.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    if (typeof showToast === 'function') showToast('That is not a valid entity UUID.', 'error');
    return;
  }
  dcVerdict(id, 'merge', { target_entity_id: v });
}
window.dcJunkMerge = dcJunkMerge;

// R8: match_disambiguation — pick a specific candidate property. Rides dcVerdict
// with the chosen {domain, property_id} payload (the verdict handler writes the
// confirmed match so the existing promoter takes over).
function dcPickCandidate(id, domain, propertyId) {
  dcVerdict(id, 'pick', { domain: domain, property_id: propertyId });
}
window.dcPickCandidate = dcPickCandidate;

async function renderDecisionLane(type) {
  const el = document.getElementById('reviewConsoleContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const res = await opsApi('/api/decisions?type=' + encodeURIComponent(type) + '&limit=50');
  if (!res.ok) { el.innerHTML = opsErrorState(res, "renderDecisionLane('" + type + "')", 'Could not load decisions'); return; }
  const items = (res.data && Array.isArray(res.data.items)) ? res.data.items : [];
  const total = res.data ? res.data.total : null;
  const titles = { confirm_true_owner: 'Confirm the true owner', junk_entity_name: 'Junk entity names',
    match_disambiguation: 'Intake match disambiguation', llc_research_dead: 'LLC research dead-letters',
    availability_checker_botblock: 'Availability bot-blocks',
    sf_link_conflict: 'Salesforce link conflicts', sf_link_collision: 'Salesforce link — same owner, two entities' };
  const intros = {
    confirm_true_owner: 'The domain true owner may be stale (pre-acquisition). Confirm it’s current and connect, mark it stale with the new owner (recorded now; write-back ships in Slice 3), or send to research.',
    junk_entity_name: 'Entities soft-flagged with structural-garbage names (phone/email/panel-header bleed-through). Rename to the real name, merge into the correct entity, or leave flagged.',
    match_disambiguation: 'The intake matcher found multiple candidate properties above threshold (rather than auto-attaching the wrong one). Pick the right property, or create a new one.',
    llc_research_dead: 'Automated owner-LLC research dead-lettered after the attempt cap. Resolve it via the Secretary of State (research task), retry the lookup, or park it.',
    availability_checker_botblock: 'The availability-checker is being bot-blocked (high unreachable share). Verify the top listings by hand, or acknowledge the alert (resolves it).',
    sf_link_conflict: 'The bridged owner entity already has a Salesforce Account link that disagrees with the domain’s. Keep the current LCC link, accept the domain id, or research. Never auto-overwritten.',
    sf_link_collision: 'The same Salesforce Account resolves to two entities (a collision, or one SF id on multiple domain owners). Same owner, two entities — keep one and merge the rest in, or keep separate.',
  };
  let html = '<div class="ops-header"><h2>' + esc(titles[type] || type) + '</h2>'
    + '<button class="q-action" onclick="renderReviewConsolePage()">← Back to Decision Center</button></div>';
  html += '<div class="rc-intro">' + esc(intros[type] || '') + '</div>';
  _dcCurrentOpenExpr = "renderDecisionLane('" + type + "')";
  // B9 (2026-06-06): the junk lane has ~1,050 rows — too many to work one at a
  // time. Mount a bulk-by-bucket panel above the per-item cards.
  if (type === 'junk_entity_name') html += '<div id="exactMergePanel"></div><div id="junkBucketPanel"></div>';
  if (!items.length) {
    html += '<div class="ops-empty">Nothing to decide here. ✓' + _dcNextLaneCTA(_dcCurrentOpenExpr) + '</div>';
    el.innerHTML = html;
    if (type === 'junk_entity_name') { renderExactMergePanel(); renderJunkBucketPanel(); }
    return;
  }
  html += '<div class="rc-progress"><span id="dcRemaining">' + items.length + '</span> shown'
    + (total != null ? ' · ' + total.toLocaleString() + ' in this lane' : '') + '</div>';
  _dcItems = {};
  items.forEach(function (it, ix) { _dcItems[it.id] = it; html += _dcCardHTML(it, ix === 0); });
  el.innerHTML = html;
  if (type === 'junk_entity_name') { renderExactMergePanel(); renderJunkBucketPanel(); }
}
window.renderDecisionLane = renderDecisionLane;

// B9 bulk-by-bucket panel: classify the flagged set, preview each bucket with
// samples, and apply ONE verdict to a bucket at a time. 'other' (possibly-real
// orgs) has no bulk button — those stay manual in the per-item cards below.
async function renderJunkBucketPanel() {
  const host = document.getElementById('junkBucketPanel');
  if (!host) return;
  host.innerHTML = '<div class="ops-empty" style="padding:8px">Classifying junk buckets…</div>';
  const res = await opsApi('/api/junk-bucket');
  if (!res.ok) { host.innerHTML = opsErrorState(res, 'renderJunkBucketPanel()', 'Could not classify junk buckets'); return; }
  const buckets = (res.data && Array.isArray(res.data.buckets)) ? res.data.buckets : [];
  const LABELS = {
    phone_or_email: 'Phone/email embedded', deal_string: 'Deal / attribution strings',
    by_brokerage: '“… by <Broker>” suffix', trust_placeholder: 'Trust placeholder codes',
    other: 'Other (possibly real — manual)',
  };
  const VERB = { dismiss: 'Dismiss', clean_rename: 'Clean rename', parse_contact: 'Parse contacts' };
  let h = '<div class="widget" style="margin-bottom:14px"><div class="widget-title">⚡ Bulk by bucket ('
    + Number(res.data.total_flagged || 0).toLocaleString() + ' flagged)</div>'
    + '<div class="q-item-meta" style="padding:0 0 8px">Capture artifacts can be cleared in bulk. “Parse contacts” turns phone/email rows into clean people (name + phone + role); “Dismiss” soft-marks reviewed (reversible, never deleted); “Clean rename” strips the broker suffix. “Other” stays manual.</div>';
  buckets.forEach(function (b) {
    const samples = (b.samples || []).map(function (s) {
      if (b.bucket === 'by_brokerage' && s.cleaned_name) {
        return esc(s.name) + ' <span style="color:var(--text3)">→</span> ' + esc(s.cleaned_name);
      }
      if (b.bucket === 'phone_or_email' && s.parsed) {
        return esc(s.name) + ' <span style="color:var(--text3)">→</span> ' + esc(s.parsed.name)
          + (s.parsed.phone ? ' <span style="color:var(--text3)">' + esc(s.parsed.phone) + '</span>' : '');
      }
      return esc(s.name);
    }).join(' · ');
    h += '<div class="q-item" style="margin-bottom:8px"><div class="q-item-header">'
      + '<span class="q-item-title">' + esc(LABELS[b.bucket] || b.bucket) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + Number(b.count || 0).toLocaleString() + '</span></div></div>'
      + '<div class="q-item-meta" style="opacity:.8">' + samples + '</div>'
      + '<div class="q-actions">'
      + (b.verdict
          ? '<button class="q-action primary" onclick="applyJunkBucket(decodeURIComponent(\'' + encodeURIComponent(b.bucket) + '\'),decodeURIComponent(\'' + encodeURIComponent(b.verdict) + '\'),this)">'
            + (VERB[b.verdict] || b.verdict) + ' top ' + Math.min(Number(b.count || 0), 200) + ' →</button>'
          : '<span class="q-item-meta">Manual only — work the cards below.</span>')
      + '</div></div>';
  });
  h += '</div>';
  host.innerHTML = h;
}
window.renderJunkBucketPanel = renderJunkBucketPanel;

async function applyJunkBucket(bucket, verdict, btn) {
  const verb = verdict === 'clean_rename' ? 'clean-rename' : verdict === 'parse_contact' ? 'parse contacts in' : 'dismiss';
  const detail = verdict === 'dismiss'
    ? 'They will be soft-marked reviewed (reversible) and drop out of the junk lane.'
    : verdict === 'parse_contact'
      ? 'Each row becomes a clean person (name + phone + role). Rows the parser can’t confidently split stay flagged.'
      : 'Each name will have its broker-attribution suffix stripped.';
  const ok = typeof lccConfirm === 'function'
    ? await lccConfirm('Bulk ' + verb + ' up to 200 entities in the “' + bucket + '” bucket?\n\n' + detail, 'Apply')
    : true;
  if (!ok) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
  const res = await opsApi('/api/junk-bucket', { method: 'POST', body: JSON.stringify({ bucket: bucket, verdict: verdict, limit: 200 }) });
  if (res.ok && res.data) {
    const d = res.data;
    if (typeof showToast === 'function') showToast('Bucket “' + bucket + '”: ' + (d.succeeded || 0) + ' applied'
      + (d.failed ? ', ' + d.failed + ' failed' : '') + (d.attempted > d.succeeded + (d.failed || 0) ? '' : '') + '.', d.failed ? 'warn' : 'success');
    renderDecisionLane('junk_entity_name'); // refresh lane + panel (drains the bucket)
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
    if (typeof showToast === 'function') showToast('Bulk apply failed: ' + (res.error || (res.data && res.data.error) || 'unknown'), 'error');
  }
}
window.applyJunkBucket = applyJunkBucket;

// Unit-1: exact-name auto-merge panel (the clean-rename aftermath). Renames
// often collide exactly with an established entity; SAFE collisions auto-merge
// junk → canonical via lcc_merge_entity. REVIEW collisions stay for the per-item
// "Merge into…" cards below.
async function renderExactMergePanel() {
  const host = document.getElementById('exactMergePanel');
  if (!host) return;
  host.innerHTML = '<div class="ops-empty" style="padding:8px">Finding exact-name collisions…</div>';
  const res = await opsApi('/api/exact-merge');
  if (!res.ok) { host.innerHTML = opsErrorState(res, 'renderExactMergePanel()', 'Could not load exact-name candidates'); return; }
  const d = res.data || {};
  const safe = Number(d.safe_count || 0), review = Number(d.review_count || 0);
  if (!safe && !review) { host.innerHTML = ''; return; } // nothing to show
  const samples = (d.safe_samples || []).slice(0, 6).map(function (s) {
    return esc(s.junk_name) + ' <span style="color:var(--text3)">→ merge into</span> ' + esc(s.tgt_name);
  }).join(' · ');
  const rb = d.review_breakdown || {};
  const rbStr = Object.keys(rb).map(function (k) { return rb[k] + ' ' + k.replace(/_/g, ' '); }).join(', ');
  let h = '<div class="widget" style="margin-bottom:14px"><div class="widget-title">⚡ Exact-name auto-merge</div>'
    + '<div class="q-item-meta" style="padding:0 0 8px">A clean-renamed artifact now shares an exact name with an established entity. SAFE = single match, domain-compatible, no SF conflict — merges the artifact INTO the canonical entity (never the reverse). REVIEW collisions stay for the “Merge into…” cards below.</div>'
    + '<div class="q-item"><div class="q-item-header"><span class="q-item-title">Exact-name collisions</span>'
    + '<div class="q-item-badges"><span class="q-badge">' + safe + ' safe</span>'
    + (review ? '<span class="q-badge">' + review + ' review</span>' : '') + '</div></div>'
    + (samples ? '<div class="q-item-meta" style="opacity:.8">' + samples + '</div>' : '')
    + (review ? '<div class="q-item-meta">' + esc(rbStr) + ' → work below</div>' : '')
    + '<div class="q-actions">'
    + (safe ? '<button class="q-action primary" onclick="applyExactMerge(this)">Merge ' + Math.min(safe, 200) + ' safe →</button>'
            : '<span class="q-item-meta">No safe auto-merges right now.</span>')
    + '</div></div></div>';
  host.innerHTML = h;
}
window.renderExactMergePanel = renderExactMergePanel;

async function applyExactMerge(btn) {
  const ok = typeof lccConfirm === 'function'
    ? await lccConfirm('Apply up to 200 SAFE exact-name merges?\n\nEach renamed artifact is merged INTO its established canonical entity (portfolio facts + identities move to the canonical; the artifact is retired). Idempotent.', 'Merge safe')
    : true;
  if (!ok) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Merging…'; }
  const res = await opsApi('/api/exact-merge', { method: 'POST', body: JSON.stringify({ limit: 200 }) });
  if (res.ok && res.data) {
    const d = res.data;
    if (typeof showToast === 'function') showToast('Exact-merge: ' + (d.merged || 0) + ' merged'
      + (d.failed ? ', ' + d.failed + ' failed' : '') + '.', d.failed ? 'warn' : 'success');
    renderDecisionLane('junk_entity_name'); // refresh (merged losers drop out)
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
    if (typeof showToast === 'function') showToast('Exact-merge failed: ' + (res.error || (res.data && res.data.error) || 'unknown'), 'error');
  }
}
window.applyExactMerge = applyExactMerge;

async function renderBuyerParentLane() {
  const el = document.getElementById('reviewConsoleContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const [a, b] = await Promise.all([
    opsApi('/api/decisions?type=confirm_buyer_parent&limit=50'),
    opsApi('/api/decisions?type=map_sf_parent_account&limit=50'),
  ]);
  const items = [].concat(
    (a.ok && a.data && a.data.items) || [],
    (b.ok && b.data && b.data.items) || []);
  let html = '<div class="ops-header"><h2>Buyer parents &amp; SF mapping</h2>'
    + '<button class="q-action" onclick="renderReviewConsolePage()">← Back to Decision Center</button></div>';
  html += '<div class="rc-intro">Confirm controlling sponsors and map each repeat-buyer parent to its Salesforce parent account. One buyer, one account — the opportunity routes to the parent, never a subsidiary SPE.</div>';
  _dcCurrentOpenExpr = 'renderBuyerParentLane()';
  if (!items.length) { html += '<div class="ops-empty">All buyer parents mapped &amp; confirmed. ✓</div>'; el.innerHTML = html; return; }
  html += '<div class="rc-progress"><span id="dcRemaining">' + items.length + '</span> to decide</div>';
  _dcItems = {};
  items.forEach(function (it, ix) { _dcItems[it.id] = it; html += _dcCardHTML(it, ix === 0); });
  el.innerHTML = html;
}
window.renderBuyerParentLane = renderBuyerParentLane;

// ── Federated decision lanes (R7 Phase 2) ─────────────────────────────────
// List-federated lanes read top-N straight from a source view; a decision row
// is minted at verdict time. Same card anatomy + self-propelling advance as the
// seeded lanes; verdicts post {type, subject, verdict} to /api/decision-verdict.
let _dcFedArr = [];
let _dcFedType = null;
const _DC_FED_META = {
  intake_disposition: { title: 'Staged intake — needs review',
    intro: 'Staged-intake items awaiting review, top by extracted asking price. Create the property, re-extract (OCR), dismiss, or send to research.' },
  property_merge: { title: 'Property merges & duplicates',
    intro: 'Properties sharing a normalized address. Are they the same property? Compare & merge via the consolidate flow, mark “Not a duplicate”, or send to research.' },
  provenance_conflict: { title: 'Data conflicts & provenance',
    intro: 'Cross-table field-write conflicts (price/rent/cap fields first) + sales-price xref conflicts. Keep the current value, accept the attempted value (queued to the manual-edit path), or research.' },
  pending_update: { title: 'Pending updates (Gov)',
    intro: 'Proposed gov field updates awaiting a decision. Apply (→ approved, the gov pipeline applies it) or reject (→ rejected), or send to research.' },
  cms_link_suspect: { title: 'CMS ↔ property link suspects',
    intro: 'Clinic↔property links the un-truncation pass flagged (state mismatch worst-first). Confirm the link is correct, break it (via the cms-match unlink), or research.' },
  implausible_value: { title: 'Implausible values',
    intro: 'Sales over the per-domain magnitude soft-ceiling, retained for review. Confirm the price as real, correct it, void it (queued), or research.' },
  merge_duplicate_entities: { title: 'Duplicate entities — merge',
    intro: 'High-confidence duplicate-entity groups (same normalized name). Merge collapses the duplicates into the surviving entity (carries portfolio + identities + relationships); keep separate if they are genuinely distinct, or research.' },
  caprate_review: { title: 'Cap-rate review — suspect movers',
    intro: 'Parked cap-rate recomputes (low-confidence or out-of-band), ranked by $ impact = price × |old − recomputed cap|. Apply the recompute (bounded, reversible), keep the original, route to the bad-rent lane (the cap is wrong because the rent is), or research.' },
  bad_rent_lease: { title: 'Bad-rent leases — fix at source',
    intro: 'Cap-review rows flagged as bad RENT (implausible gross yield), ranked by $ value, with the plausible rent band + the offending lease. Fix the rent AT SOURCE (never auto-corrected) — the recompute then refreshes the caps. Mark fixed, confirm the rent is genuinely right, or research.' },
  resolve_owner_parent: { title: 'Owner → ultimate parent',
    intro: 'Sponsor clusters mined from UNRESOLVED current-owner LLC/LP shells (gov + dia), ranked by $ rent. “high” = a fund numeral varies across the shells (SPUS6/7/8…). Confirm the controlling parent (registers it + rolls the shells up to it), name the parent yourself, or mark the owner a genuine independent. Never auto-merged — you confirm.' },
  listing_event_action: { title: 'New sales → act',
    intro: 'A closed sale is the next BD action, value-ranked by sale price. Nurture the seller (past/known owner — seed a relationship cadence, never auto-send), open the new-owner relationship (the buyer is a future seller; if a registered buyer parent, use the P-BUYER path), pursue the cohort fan-out (same-owner / recent-buyer / geographic neighbors), flag a sale-leaseback advisory angle, or dismiss. Each verdict marks the event processed.' },
  owner_source_conflict: { title: 'Owner vs deed — who took title',
    intro: 'The recorded deed grantee (legal title) disagrees with the recorded owner (gov + dia), value-ranked by rent. Accept the deed (it wins through the priority gate; true owner re-resolves), clear a broker-as-owner, keep the current owner (a legit parent-vs-SPE), or research. spe_vs_parent is excluded (default keep).' },
  suspected_sale: { title: 'Suspected unrecorded sales',
    intro: 'An ownership CHANGE we never recorded as a sale (gov), value-ranked by rent — a NEW GSA lessor with no recorded sale, or a deed grantee that disagrees with the prior owner with no recorded sale. Each is a LEAD, not a fact: confirm the sale (you supply the price — it writes a real sales row, cap rate computes), mark “not a sale” (refinance / name correction — stops asking), or send to research to find the price/date/buyer. We never fabricate a price.' },
  loan_maturity: { title: 'Loan maturities → refi or sell',
    intro: 'A property whose CURRENT debt matures within 24 months — or is already matured — (gov + dia), value-ranked by rent; a DISTRESSED loan (watchlist / special servicing / delinquent / DSCR<1) ranks first. A maturity wall forces the owner to refinance or sell — that is the BD opening. Pursue refi (advisory/refi outreach on the owner), pursue disposition (the owner may sell), mark not relevant (stops asking), or research. No domain write — this is a BD signal.' },
};

function _fedMoney(n) { n = Number(n); return (isFinite(n) && n > 0) ? '$' + Math.round(n).toLocaleString() : ''; }

function _fedCardHTML(it, i, isNext) {
  const c = it.context || {};
  let body = '', actions = '';
  if (_dcFedType === 'intake_disposition') {
    const ask = _fedMoney(c.asking_price);
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.tenant || c.address || ('Intake ' + (c.intake_id || '').slice(0, 8))) + '</span>'
      + '<div class="q-item-badges">' + (ask ? '<span class="q-badge">' + ask + '</span>' : '')
      + '<span class="q-badge">' + esc(c.status || '') + '</span></div></div>'
      + '<div class="q-item-meta">' + esc(c.doctype || 'unknown doctype') + (c.address ? ' · ' + esc(c.address) : '')
      + ' · source ' + esc(c.source_type || '') + '</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'create_property\')">Create property →</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'reextract\')">Re-extract (OCR)</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'dismiss\')">Dismiss</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'property_merge') {
    const dom = c.domain, pid = c.property_id;
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Property ' + pid)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(dom || '') + '</span>'
      + (c.cluster_size ? '<span class="q-badge">' + c.cluster_size + ' share this address</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc(c.state || '') + (c.label ? ' · ' + esc(c.label) : '')
      + ' · property ' + esc(String(pid)) + ' — same property as its address-mates, or distinct?</div>';
    // Merge is destructive (keep/drop is a BD judgment) → route to the existing
    // consolidate surface; the inline verdicts are the safe ones.
    const openDetail = (dom && pid != null && typeof openUnifiedDetail === 'function')
      ? '<button class="q-action primary" onclick="openUnifiedDetail(\'' + esc(dom) + '\', {property_id: ' + esc(String(pid)) + '}, {}, \'Overview\')">Compare &amp; merge →</button>' : '';
    actions = openDetail
      + '<button class="q-action" onclick="dcFed(' + i + ',\'not_duplicate\')">Not a duplicate</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'owner_source_conflict') {
    const dom = c.domain, pid = c.property_id;
    const kind = c.conflict_kind || '';
    const rent = _fedMoney(c.annual_rent);
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Property ' + pid)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(dom || '') + '</span>'
      + '<span class="q-badge' + (kind === 'broker_as_owner' ? ' pri-high' : '') + '">' + esc(kind) + '</span>'
      + (rent ? '<span class="q-badge">' + rent + '</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc((c.city || '') + (c.state ? ', ' + c.state : '')) + ' · property ' + esc(String(pid)) + '</div>'
      + '<div class="q-item-meta">Recorded owner: <b>' + esc(c.recorded_owner_name || '?') + '</b></div>'
      + '<div class="q-item-meta">Deed grantee (title): <b>' + esc(c.latest_deed_grantee || '?') + '</b>'
        + (c.latest_deed_date ? ' · ' + esc(String(c.latest_deed_date)) : '') + '</div>'
      + (c.true_owner_name ? '<div class="q-item-meta">True owner: ' + esc(c.true_owner_name) + '</div>' : '');
    const acceptLabel = (kind === 'broker_as_owner')
      ? '<button class="q-action primary" onclick="dcFed(' + i + ',\'broker_not_owner\')">Clear broker → set deed owner</button>'
      : '<button class="q-action primary" onclick="dcFed(' + i + ',\'accept_deed\')">Accept deed owner →</button>';
    actions = acceptLabel
      + '<button class="q-action" onclick="dcFed(' + i + ',\'keep_current\')">Keep current</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'provenance_conflict') {
    if (c.kind === 'sales_price_xref') {
      body = '<div class="q-item-header"><span class="q-item-title">Sales-price xref conflict</span>'
        + '<div class="q-item-badges"><span class="q-badge">dia</span></div></div>'
        + '<div class="q-item-meta">' + esc(c.detail_1 || '') + (c.detail_2 ? ' vs ' + esc(c.detail_2) : '')
        + (c.detail_3 ? ' · ' + esc(c.detail_3) : '') + '</div>';
      actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'keep_current\')">Keep current</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'accept_attempted\')">Accept attempted</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
    } else {
      body = '<div class="q-item-header"><span class="q-item-title">' + esc((c.target_table || '') + '.' + (c.field_name || '')) + '</span>'
        + '<div class="q-item-badges"><span class="q-badge">' + esc(c.target_database || '') + '</span>'
        + '<span class="q-badge">' + esc(c.enforce_mode || '') + '</span></div></div>'
        + '<div class="q-item-meta">record ' + esc(String(c.record_pk_value || '')) + '</div>'
        + '<div class="q-item-meta">Current (<b>' + esc(c.current_source || '?') + '</b>): ' + esc(JSON.stringify(c.current_value)) + '</div>'
        + '<div class="q-item-meta">Attempted (<b>' + esc(c.attempted_source || '?') + '</b>): ' + esc(JSON.stringify(c.attempted_value)) + '</div>';
      actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'keep_current\')">Keep current</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'accept_attempted\')">Accept attempted</button>'
        + '<button class="q-action" onclick="dcFed(' + i + ',\'skip\')">Skip</button>';
    }
  } else if (_dcFedType === 'pending_update') {
    body = '<div class="q-item-header"><span class="q-item-title">' + esc((c.table_name || '') + '.' + (c.field_name || '')) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">gov</span>'
      + (c.confidence != null ? '<span class="q-badge">conf ' + esc(String(c.confidence)) + '</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">property ' + esc(String(c.property_id || '')) + (c.reason ? ' · ' + esc(c.reason) : '') + '</div>'
      + '<div class="q-item-meta">' + esc(JSON.stringify(c.old_value)) + ' → <b>' + esc(JSON.stringify(c.new_value)) + '</b></div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'apply\')">Apply</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'reject\')">Reject</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'cms_link_suspect') {
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.cms_facility_name || ('Clinic ' + c.medicare_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.suspect_kind || '') + '</span>'
      + (c.street_looks_unrelated ? '<span class="q-badge pri-high">street differs</span>' : '')
      + (c.zip5_matches ? '<span class="q-badge">zip matches</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">CMS: ' + esc(c.cms_address || '') + ', ' + esc(c.cms_city || '') + ' ' + esc(c.cms_state || '') + '</div>'
      + '<div class="q-item-meta">Property ' + esc(String(c.property_id)) + ': ' + esc(c.property_address || '') + ', ' + esc(c.property_city || '') + ' ' + esc(c.property_state || '') + '</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'link_correct\')">Link is correct</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'break_link\')">Break link</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'implausible_value') {
    body = '<div class="q-item-header"><span class="q-item-title">' + _fedMoney(c.sold_price) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge">ceiling ' + _fedMoney(c.ceiling) + '</span></div></div>'
      + '<div class="q-item-meta">' + esc(c.address || '') + (c.city ? ', ' + esc(c.city) : '') + (c.state ? ' ' + esc(c.state) : '')
      + (c.label ? ' · ' + esc(c.label) : '') + ' · ' + esc(String(c.sale_date || '')) + '</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm_as_is\')">Confirm as-is</button>'
      + '<button class="q-action" onclick="dcImplausibleCorrect(' + i + ')">Correct value…</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'void\')">Void</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'merge_duplicate_entities') {
    const n = c.member_count || ((c.loser_ids || []).length + 1);
    // Tier-4 Unit 3: flag the SF-link-inheritance bonus so the operator can
    // prioritize duplicates of an already-SF-linked entity (merge dedups AND
    // inherits the Salesforce account onto the survivor).
    const sfBadge = c.sf_inheritance
      ? '<span class="q-badge type" title="One duplicate already carries a Salesforce account — merging inherits the SF link onto the survivor.">↪ inherits SF link</span>'
      : '';
    const sfMeta = c.sf_inheritance
      ? ' One of these is already linked to a Salesforce account, so the merge also inherits that SF link.'
      : '';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.winner_name || c.norm_name || 'Duplicate group') + '</span>'
      + '<div class="q-item-badges">' + sfBadge + '<span class="q-badge">' + n + ' duplicates</span></div></div>'
      + '<div class="q-item-meta">' + ((c.loser_ids || []).length) + ' duplicate(s) collapse into this survivor (portfolio + identities + relationships carry over).' + sfMeta + '</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'merge\')">Merge duplicates →</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'keep_separate\')">Keep separate</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'caprate_review') {
    const pct = (v) => (v != null && isFinite(Number(v))) ? (Number(v) * 100).toFixed(2) + '%' : '?';
    const openDetail = (c.domain && c.property_id != null && typeof openUnifiedDetail === 'function')
      ? '<button class="q-action" onclick="openUnifiedDetail(\'' + esc(c.domain) + '\', {property_id: ' + esc(String(c.property_id)) + '}, {}, \'Overview\')">Open property →</button>' : '';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || c.label || ('Property ' + c.property_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge pri-high">' + _fedMoney(c.dollar_impact) + ' impact</span>'
      + '<span class="q-badge">' + esc(c.reason || '') + '</span></div></div>'
      + '<div class="q-item-meta">' + esc(c.label || '') + (c.city ? ' · ' + esc(c.city) : '') + (c.state ? ' ' + esc(c.state) : '')
      + ' · ' + esc(c.event_type || '') + ' ' + _fedMoney(c.price) + ' · ' + esc(c.income_confidence || '') + ' conf</div>'
      + '<div class="q-item-meta">Cap <b>' + pct(c.old_cap) + '</b> → <b>' + pct(c.recomputed_cap) + '</b></div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'apply\')">Apply recompute →</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'keep_old\')">Keep old</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'needs_rent_fix\')">Bad rent →</button>'
      + openDetail
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'bad_rent_lease') {
    const yld = (c.implied_gross_yield != null && isFinite(Number(c.implied_gross_yield)))
      ? (Number(c.implied_gross_yield) * 100).toFixed(1) + '%' : '?';
    const openDetail = (c.domain && c.property_id != null && typeof openUnifiedDetail === 'function')
      ? '<button class="q-action primary" onclick="openUnifiedDetail(\'' + esc(c.domain) + '\', {property_id: ' + esc(String(c.property_id)) + '}, {}, \'Overview\')">Open property / lease →</button>' : '';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || c.label || ('Property ' + c.property_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge pri-high">' + yld + ' yield</span></div></div>'
      + '<div class="q-item-meta">' + esc(c.label || '') + (c.city ? ' · ' + esc(c.city) : '') + (c.state ? ' ' + esc(c.state) : '') + '</div>'
      + '<div class="q-item-meta">Rent <b>' + _fedMoney(c.rent_used) + '</b> on ' + esc(c.event_type || '') + ' ' + _fedMoney(c.price)
      + ' · plausible rent <b>' + _fedMoney(c.plausible_rent_low) + '–' + _fedMoney(c.plausible_rent_high) + '</b></div>';
    actions = openDetail
      + '<button class="q-action" onclick="dcFed(' + i + ',\'mark_fixed\')">Mark rent fixed</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'confirm_rent\')">Rent is correct</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'resolve_owner_parent') {
    const samples = (c.sample_owner_names || []).slice(0, 4).join(' · ');
    const confBadge = c.confidence === 'high'
      ? '<span class="q-badge type" title="A fund numeral varies across these shells — almost certainly one sponsor.">↪ numeral family</span>'
      : '<span class="q-badge">review</span>';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.suggested_parent_name || c.cluster_token) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>' + confBadge
      + '<span class="q-badge">' + (c.shells || 0) + ' shells</span>'
      + '<span class="q-badge pri-high">' + _fedMoney(c.annual_rent) + ' rent</span></div></div>'
      + '<div class="q-item-meta">token <b>' + esc(c.cluster_token || '') + '</b> · ' + (c.props || 0) + ' properties</div>'
      + (samples ? '<div class="q-item-meta">' + esc(samples) + '</div>' : '');
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'confirm_parent\')">Confirm parent: ' + esc(c.suggested_parent_name || c.cluster_token) + ' →</button>'
      + '<button class="q-action" onclick="dcOwnerParentSet(' + i + ')">Name parent…</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'mark_independent\')">Independent</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'listing_event_action') {
    const slb = c.is_sale_leaseback;
    const loc = (c.city ? esc(c.city) : '') + (c.state ? ' ' + esc(c.state) : '');
    const buyer = c.buyer_entity_name || c.buyer_name;
    const seller = c.seller_entity_name || c.seller_name;
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Property ' + c.property_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge pri-high">' + _fedMoney(c.sale_price) + '</span>'
      + (slb ? '<span class="q-badge type" title="Heuristic: seller &amp; buyer names share a leading core — likely an affiliate sale / sale-leaseback. Confirm.">↪ sale-leaseback?</span>' : '')
      + '</div></div>'
      + '<div class="q-item-meta">' + (loc ? loc + ' · ' : '') + 'sold ' + esc(String(c.event_date || '')) + '</div>'
      + '<div class="q-item-meta">Seller: <b>' + esc(seller || 'unresolved') + '</b>' + (c.seller_entity_id ? '' : ' <span class="q-badge">no entity</span>')
      + ' → Buyer: <b>' + esc(buyer || 'unresolved') + '</b>' + (c.buyer_entity_id ? '' : ' <span class="q-badge">no entity</span>') + '</div>';
    actions = (seller ? '<button class="q-action primary" onclick="dcFed(' + i + ',\'nurture_seller\')">Nurture seller →</button>' : '')
      + (buyer ? '<button class="q-action" onclick="dcFed(' + i + ',\'new_buyer_relationship\')">New owner relationship →</button>' : '')
      + '<button class="q-action" onclick="dcFed(' + i + ',\'pursue_cohort\')">Pursue cohort →</button>'
      + (slb ? '<button class="q-action" onclick="dcFed(' + i + ',\'flag_sale_leaseback\')">Flag sale-leaseback</button>' : '')
      + '<button class="q-action" onclick="dcFed(' + i + ',\'dismiss\')">Dismiss</button>';
  } else if (_dcFedType === 'suspected_sale') {
    const rent = _fedMoney(c.annual_rent);
    const sig = c.signal_source === 'gsa_lessor_change' ? 'GSA lessor changed'
      : c.signal_source === 'deed_conflict' ? 'deed ≠ prior owner' : (c.signal_source || '');
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Property ' + c.property_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">gov</span>'
      + '<span class="q-badge type">' + esc(sig) + '</span>'
      + (rent ? '<span class="q-badge pri-high">' + rent + ' rent</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc((c.city || '') + (c.state ? ', ' + c.state : '')) + ' · property ' + esc(String(c.property_id)) + '</div>'
      + '<div class="q-item-meta">Was: <b>' + esc(c.suspected_grantor || '?') + '</b></div>'
      + '<div class="q-item-meta">Now: <b>' + esc(c.suspected_grantee || '?') + '</b>'
        + (c.suspected_sale_date ? ' · seen ' + esc(String(c.suspected_sale_date)) : '') + '</div>'
      + '<div class="q-item-meta" style="opacity:.7">Suspected unrecorded sale — confirm only with a real price.</div>';
    actions = '<button class="q-action primary" onclick="dcConfirmSuspectedSale(' + i + ')">Confirm sale (enter price) →</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'not_a_sale\')">Not a sale</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  } else if (_dcFedType === 'loan_maturity') {
    const rent = _fedMoney(c.annual_rent);
    const bal = _fedMoney(c.loan_balance);
    const matured = (typeof c.months_to_maturity === 'number' && c.months_to_maturity < 0);
    const matLbl = c.maturity_band === 'matured' ? 'MATURED'
      : (typeof c.months_to_maturity === 'number' ? 'matures in ' + c.months_to_maturity + 'mo' : (c.maturity_band || 'maturing'));
    const who = c.owner_name || c.true_owner_name || c.recorded_owner_name || '?';
    body = '<div class="q-item-header"><span class="q-item-title">' + esc(c.address || ('Property ' + c.property_id)) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(c.domain || '') + '</span>'
      + '<span class="q-badge ' + (matured ? 'pri-high' : 'type') + '">' + esc(matLbl) + '</span>'
      + (c.is_distressed ? '<span class="q-badge pri-high">⚠ ' + esc(c.distress_reason || 'distressed') + '</span>' : '')
      + (rent ? '<span class="q-badge pri-high">' + rent + ' rent</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc((c.city || '') + (c.state ? ', ' + c.state : '')) + ' · property ' + esc(String(c.property_id))
      + (c.agency ? ' · ' + esc(c.agency) : '') + (c.tenant ? ' · ' + esc(c.tenant) : '') + '</div>'
      + '<div class="q-item-meta">Owner: <b>' + esc(who) + '</b></div>'
      + '<div class="q-item-meta">Debt ' + (bal ? '<b>' + bal + '</b> · ' : '') + esc(c.maturity_date ? String(c.maturity_date).slice(0, 10) : '')
        + (c.servicer ? ' · ' + esc(c.servicer) : '') + '</div>'
      + '<div class="q-item-meta" style="opacity:.7">Loan maturity = refi or sell. Reach the owner.</div>';
    actions = '<button class="q-action primary" onclick="dcFed(' + i + ',\'pursue_refi\')">Pursue refi →</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'pursue_disposition\')">Pursue disposition</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'not_relevant\')">Not relevant</button>'
      + '<button class="q-action" onclick="dcFed(' + i + ',\'research\')">Research</button>';
  }
  return '<div class="q-item' + (isNext ? ' pq-next' : '') + '" id="dc-f' + i + '">' + body
    + '<div class="q-actions">' + actions + '</div></div>';
}

async function renderFederatedLane(type) {
  const el = document.getElementById('reviewConsoleContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const meta = _DC_FED_META[type] || { title: type, intro: '' };
  const res = await opsApi('/api/decisions?type=' + encodeURIComponent(type) + '&limit=50');
  if (!res.ok) { el.innerHTML = opsErrorState(res, "renderFederatedLane('" + type + "')", 'Could not load this lane'); return; }
  const items = (res.data && Array.isArray(res.data.items)) ? res.data.items : [];
  const total = res.data ? res.data.total : null;
  let html = '<div class="ops-header"><h2>' + esc(meta.title) + '</h2>'
    + '<button class="q-action" onclick="renderReviewConsolePage()">← Back to Decision Center</button></div>';
  html += '<div class="rc-intro">' + esc(meta.intro) + '</div>';
  _dcCurrentOpenExpr = "renderFederatedLane('" + type + "')";
  if (!items.length) { html += '<div class="ops-empty">Nothing to decide here. ✓' + _dcNextLaneCTA(_dcCurrentOpenExpr) + '</div>'; el.innerHTML = html; return; }
  html += '<div class="rc-progress"><span id="dcRemaining">' + items.length + '</span> shown'
    + (total != null ? ' · ' + total.toLocaleString() + ' workable in this lane' : '') + '</div>';
  // R59 Unit 3 — bulk-handle the SAFE (record-only / non-destructive) verdict
  // across all shown items, so an oversized lane is workable, not 999 clicks.
  // Destructive verdicts (merge/apply/break-link/correct/confirm_sale) are NEVER
  // bulked — they keep their per-card gate.
  var bulk = _DC_BULK_SAFE[type];
  if (bulk) {
    html += '<div class="triage-bar" style="margin:6px 0"><span class="q-item-meta">Bulk action (safe only)</span>'
      + '<div class="triage-actions"><button class="q-action" onclick="dcFedBulkSafe()">' + esc(bulk.label) + '</button></div></div>';
  }
  _dcFedType = type;
  _dcFedArr = items.slice();
  items.forEach(function (it, ix) { html += _fedCardHTML(it, ix, ix === 0); });
  el.innerHTML = html;
}
window.renderFederatedLane = renderFederatedLane;

// R59 Unit 3 — per-lane SAFE bulk verdict (record-only / non-destructive only).
var _DC_BULK_SAFE = {
  intake_disposition: { verdict: 'dismiss', label: 'Dismiss all shown' },
  property_merge: { verdict: 'not_duplicate', label: 'Mark all "not a duplicate"' },
  owner_source_conflict: { verdict: 'keep_current', label: 'Keep current owner on all' },
  provenance_conflict: { verdict: 'keep_current', label: 'Keep current on all' },
  cms_link_suspect: { verdict: 'link_correct', label: 'Confirm all links correct' },
  implausible_value: { verdict: 'confirm_as_is', label: 'Confirm all as-is' },
  merge_duplicate_entities: { verdict: 'keep_separate', label: 'Keep all separate' },
};

async function dcFedBulkSafe() {
  var bulk = _DC_BULK_SAFE[_dcFedType];
  if (!bulk) return;
  var pending = (_dcFedArr || []).map(function (it, ix) { return { it: it, ix: ix }; })
    .filter(function (p) { var r = document.getElementById('dc-f' + p.ix); return r && !r.classList.contains('resolved'); });
  if (!pending.length) { showToast('Nothing to bulk-handle', 'info'); return; }
  var ok = (typeof lccConfirm === 'function')
    ? await lccConfirm('Apply "' + bulk.label + '" to ' + pending.length + ' shown item' + (pending.length === 1 ? '' : 's') + '?\n\nThis is a safe, record-only verdict (no merges / no domain writes).')
    : (typeof confirm === 'function' ? confirm(bulk.label + ' — ' + pending.length + ' items?') : true);
  if (!ok) return;
  var done = 0, failed = 0;
  for (var k = 0; k < pending.length; k++) {
    var p = pending[k];
    var res = await opsApi('/api/decision-verdict', {
      method: 'POST', body: JSON.stringify({ type: _dcFedType, subject: p.it, verdict: bulk.verdict, payload: {} }),
    });
    var row = document.getElementById('dc-f' + p.ix);
    if (res.ok && res.data && res.data.ok) {
      done++;
      if (row) { row.classList.add('resolved'); row.style.opacity = '0'; }
    } else { failed++; }
  }
  document.querySelectorAll('#reviewConsoleContent .q-item.resolved[id^="dc-f"]').forEach(function (n) { if (n.parentNode) n.remove(); });
  _dcAdvanceFed();
  showToast('Bulk: ' + done + ' handled' + (failed ? ' · ' + failed + ' failed' : ''), failed ? 'error' : 'success');
}
window.dcFedBulkSafe = dcFedBulkSafe;

async function dcImplausibleCorrect(i) {
  const it = _dcFedArr[i]; if (!it) return;
  const c = it.context || {};
  const curStr = (isFinite(Number(c.sold_price)) && Number(c.sold_price) > 0)
    ? '$' + Math.round(Number(c.sold_price)).toLocaleString() : '(none)';
  const ceil = (isFinite(Number(c.ceiling)) && Number(c.ceiling) > 0)
    ? '$' + Math.round(Number(c.ceiling)).toLocaleString() : '';
  const ctx = (c.address ? c.address + (c.state ? ' ' + c.state : '') + ' — ' : '')
    + 'recorded ' + curStr + (ceil ? ' (over the ' + ceil + ' ceiling)' : '');
  const v = typeof lccPrompt === 'function'
    ? await lccPrompt('Correct this sale price.\n\n' + ctx + '\n\nEnter the corrected price (numbers only):', '')
    : (typeof prompt === 'function' ? prompt('Corrected sale price (number):') : '');
  if (v == null) return;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) { if (typeof showToast === 'function') showToast('Enter a valid price', 'error'); return; }
  dcFed(i, 'correct', { corrected_price: n });
}
window.dcImplausibleCorrect = dcImplausibleCorrect;

// R47: name the controlling parent for an owner cluster, then register it.
async function dcOwnerParentSet(i) {
  const it = _dcFedArr[i]; if (!it) return;
  const c = it.context || {};
  const samples = (c.sample_owner_names || []).slice(0, 4).join('\n  ');
  const def = c.suggested_parent_name || '';
  const msg = 'Name the controlling parent for these shells (token "' + (c.cluster_token || '') + '"):'
    + (samples ? '\n\n  ' + samples : '') + '\n\nParent account name:';
  const v = typeof lccPrompt === 'function' ? await lccPrompt(msg, def)
    : (typeof prompt === 'function' ? prompt(msg, def) : '');
  if (v == null) return;
  const name = String(v).trim();
  if (!name) { if (typeof showToast === 'function') showToast('Enter a parent name', 'error'); return; }
  dcFed(i, 'set_parent', { parent_name: name });
}
window.dcOwnerParentSet = dcOwnerParentSet;

// R53: confirm a suspected sale → a REAL sales row. The operator MUST supply a
// price (we never fabricate); the date defaults to when the change was seen.
async function dcConfirmSuspectedSale(i) {
  const it = _dcFedArr[i]; if (!it) return;
  const c = it.context || {};
  const ctx = (c.address ? c.address + (c.state ? ' ' + c.state : '') + ' — ' : '')
    + '"' + (c.suspected_grantor || '?') + '" → "' + (c.suspected_grantee || '?') + '"';
  const pv = typeof lccPrompt === 'function'
    ? await lccPrompt('Confirm this sale.\n\n' + ctx + '\n\nEnter the SALE PRICE (numbers only — we never guess):', '')
    : (typeof prompt === 'function' ? prompt('Sale price (number):') : '');
  if (pv == null) return;
  const price = Number(String(pv).replace(/[^0-9.]/g, ''));
  if (!isFinite(price) || price < 50000) { if (typeof showToast === 'function') showToast('Enter a real price (≥ $50k)', 'error'); return; }
  const defDate = c.suspected_sale_date ? String(c.suspected_sale_date).slice(0, 10) : '';
  const dv = typeof lccPrompt === 'function'
    ? await lccPrompt('Sale date (YYYY-MM-DD):', defDate)
    : (typeof prompt === 'function' ? prompt('Sale date (YYYY-MM-DD):', defDate) : defDate);
  if (dv == null) return;
  const saleDate = String(dv).trim() || defDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) { if (typeof showToast === 'function') showToast('Enter a valid date (YYYY-MM-DD)', 'error'); return; }
  dcFed(i, 'confirm_sale', {
    sold_price: price, sale_date: saleDate,
    buyer: c.suspected_grantee || null, seller: c.suspected_grantor || null,
  });
}
window.dcConfirmSuspectedSale = dcConfirmSuspectedSale;

async function dcFed(i, verdict, payload) {
  const it = _dcFedArr[i]; if (!it) return;
  const res = await opsApi('/api/decision-verdict', {
    method: 'POST', body: JSON.stringify({ type: _dcFedType, subject: it, verdict: verdict, payload: payload || {} }),
  });
  const row = document.getElementById('dc-f' + i);
  if (res.ok && res.data && res.data.ok) {
    let fwd = '';
    const nx = res.data.next;
    if (nx && nx.action === 'cms_unlink') {
      fwd = ' <button class="q-action primary" onclick="dcCmsUnlink(' + esc(String(nx.property_id)) + ')">Break link in cms-match →</button>';
    } else if (nx && (nx.action === 'intake_create_property' || nx.action === 'intake_reextract')) {
      fwd = ' <button class="q-action primary" onclick="navTo(\'pageInbox\')">Finish in Inbox →</button>';
    } else if (nx && nx.action === 'bad_rent_lane') {
      fwd = ' <button class="q-action primary" onclick="renderFederatedLane(\'bad_rent_lease\')">Open bad-rent lane →</button>';
    }
    if (typeof showToast === 'function') showToast('Recorded', 'success');
    if (row) {
      row.classList.add('resolved');
      row.innerHTML = '<div class="dc-collapsed">✓ ' + esc(res.data.verdict || verdict) + fwd + '</div>';
      if (fwd) {
        _dcAdvanceFed();                    // keep the collapsed row (has a CTA)
      } else {
        row.style.transition = 'opacity .4s ease';
        row.style.opacity = '0';
        setTimeout(function () { if (row.parentNode) row.remove(); _dcAdvanceFed(); }, 420);
      }
    } else {
      _dcAdvanceFed();
    }
  } else {
    const err = (res.data && (res.data.error || res.data.message)) || res.error || 'unknown';
    if (typeof showToast === 'function') showToast('Action failed: ' + err, 'error');
  }
}
window.dcFed = dcFed;

// cms break-link hands off to the existing cms-match DELETE route (Scott's call).
async function dcCmsUnlink(propertyId) {
  const res = await opsApi('/api/cms-match?action=link&property_id=' + encodeURIComponent(propertyId), { method: 'DELETE' });
  if (res.ok) { if (typeof showToast === 'function') showToast('CMS link broken', 'success'); }
  else { if (typeof showToast === 'function') showToast('Unlink failed: ' + (res.error || 'unknown'), 'error'); }
}
window.dcCmsUnlink = dcCmsUnlink;

function _dcAdvanceFed() {
  const scope = document.getElementById('reviewConsoleContent');
  if (!scope) return;
  const pending = scope.querySelectorAll('.q-item[id^="dc-f"]:not(.resolved)');
  const rem = document.getElementById('dcRemaining');
  if (rem) rem.textContent = pending.length;
  scope.querySelectorAll('.q-item.pq-next').forEach(function (n) { n.classList.remove('pq-next'); });
  if (pending.length) {
    pending[0].classList.add('pq-next');
    pending[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    const prog = scope.querySelector('.rc-progress');
    if (prog) prog.innerHTML = 'All decided in this lane ✓' + _dcNextLaneCTA(_dcCurrentOpenExpr);
    if (typeof showToast === 'function') showToast('Lane cleared ✓', 'success');
  }
}

async function dcStale(id) {
  const it = _dcItems[id]; const stale = (it && it.context && it.context.true_owner_name) || '';
  const name = typeof lccPrompt === 'function'
    ? await lccPrompt('Mark the domain owner as stale (pre-acquisition).\n\nStale owner on file: ' + (stale || '—')
        + '\n\nEnter the CURRENT (new) owner name. Recorded now; the gov true_owner write-back applies once DECISION_GOV_WRITEBACK is enabled:', '')
    : (typeof prompt === 'function' ? prompt('Current (new) owner name:') : '');
  if (name == null) return;
  const v = String(name || '').trim();
  if (!v) { if (typeof showToast === 'function') showToast('Enter the new owner name (or Cancel).', 'error'); return; }
  dcVerdict(id, 'stale', { proposed_owner_name: v });
}
window.dcStale = dcStale;

// SF-mapping card: editable search → scored candidate pick-list, plus a
// manual "paste the Account ID / URL" path. Candidates are stashed per card so
// the "Map to this account" buttons never have to embed arbitrary account names
// in onclick (escaping hazard). "No account — hold" stays as the explicit
// fallback, but is never the only option after a search returns candidates.
let _dcSfCand = {};

function _sfIdFromInput(raw) {
  const s = String(raw || '').trim();
  // Prefer an Account-prefixed (001) token; else any 18- or 15-char alnum Id.
  const m = s.match(/\b001[A-Za-z0-9]{12}([A-Za-z0-9]{3})?\b/)
    || s.match(/\b[A-Za-z0-9]{18}\b/) || s.match(/\b[A-Za-z0-9]{15}\b/);
  return m ? m[0] : null;
}

async function dcSfSearch(id) {
  const input = document.getElementById('dcsfq-' + id);
  const q = input ? input.value.trim() : '';
  const slot = document.getElementById('dcsfr-' + id);
  if (!q) { if (slot) slot.textContent = 'Type a name to search.'; return; }
  if (slot) slot.innerHTML = '<span class="spinner"></span> searching Salesforce…';
  const res = await opsApi('/api/decision-sf-search?name=' + encodeURIComponent(q));
  if (!res.ok || !res.data) { if (slot) slot.textContent = 'SF search failed: ' + ((res.data && res.data.error) || res.error || 'unknown'); return; }
  const cands = Array.isArray(res.data.candidates) ? res.data.candidates : (res.data.account ? [res.data.account] : []);
  _dcSfCand[id] = cands;
  if (!cands.length) {
    slot.innerHTML = '<div class="dcsf-empty">No accounts matched “' + esc(q) + '”. Try a variant name (e.g. add “Asset Management”) or paste the Account ID below.</div>';
    return;
  }
  let html = '<div class="dcsf-hint">' + cands.length + ' candidate' + (cands.length === 1 ? '' : 's') + ' — pick the parent account:</div>';
  cands.forEach(function (cn, ix) {
    const meta = [cn.Type, cn.Industry].filter(Boolean).join(' · ');
    const pct = Math.round((Number(cn.score) || 0) * 100);
    html += '<div class="dcsf-cand"><div class="dcsf-cand-main"><b>' + esc(cn.Name) + '</b>'
      + (meta ? ' <span class="dcsf-cand-meta">' + esc(meta) + '</span>' : '')
      + ' <span class="q-badge">' + pct + '%</span></div>'
      + '<button class="q-action primary" onclick="dcSfPick(' + id + ',' + ix + ')">Map to this account</button></div>';
  });
  slot.innerHTML = html;
}
window.dcSfSearch = dcSfSearch;

function dcSfPick(id, ix) {
  const cn = (_dcSfCand[id] || [])[ix];
  if (!cn || !cn.Id) return;
  dcMap(id, cn.Id, cn.Name || '');
}
window.dcSfPick = dcSfPick;

async function dcSfManual(id) {
  const input = document.getElementById('dcsfid-' + id);
  const slot = document.getElementById('dcsfr-' + id);
  const sfId = _sfIdFromInput(input ? input.value : '');
  if (!sfId) { if (slot) slot.innerHTML = '<div class="dcsf-empty">That doesn’t look like a Salesforce Account ID (15 or 18 characters). Paste the ID or the record URL.</div>'; return; }
  if (slot) slot.innerHTML = '<span class="spinner"></span> validating ' + esc(sfId) + '…';
  const res = await opsApi('/api/decision-sf-search?id=' + encodeURIComponent(sfId));
  if (res.ok && res.data && res.data.ok && res.data.account && res.data.account.Id) {
    const acct = res.data.account;
    _dcSfCand[id] = [acct];
    slot.innerHTML = '<div class="dcsf-cand"><div class="dcsf-cand-main">Confirmed: <b>' + esc(acct.Name || acct.Id) + '</b>'
      + (acct.Type ? ' <span class="dcsf-cand-meta">' + esc(acct.Type) + '</span>' : '') + '</div>'
      + '<button class="q-action primary" onclick="dcSfPick(' + id + ',0)">Map to this account</button></div>';
  } else {
    // Flow can't confirm by-id (or doesn't implement it) — allow an explicit
    // unverified map so the user with Salesforce open in another tab isn't stuck.
    _dcSfCand[id] = [{ Id: sfId, Name: null }];
    slot.innerHTML = '<div class="dcsf-empty">Couldn’t confirm the name for <b>' + esc(sfId) + '</b>'
      + ((res.data && res.data.reason) ? ' (' + esc(res.data.reason) + ')' : '') + '. '
      + '<button class="q-action" onclick="dcSfPick(' + id + ',0)">Map by ID anyway</button></div>';
  }
}
window.dcSfManual = dcSfManual;

function dcMap(id, sfId, sfName) { dcVerdict(id, 'map', { sf_account_id: sfId, sf_account_name: sfName }); }
window.dcMap = dcMap;

async function dcVerdict(id, verdict, payload) {
  const res = await opsApi('/api/decision-verdict', {
    method: 'POST', body: JSON.stringify({ decision_id: id, verdict: verdict, payload: payload || {} }),
  });
  const row = document.getElementById('dc-' + id);
  if (res.ok && res.data && res.data.ok) {
    const v = res.data.verdict || verdict;
    // One-line confirmation. The whole card (body included — the SF candidate
    // list lives in the body, not the action row) must collapse out of the lane.
    let label;
    if (res.data.deferred) label = 'Recorded — gov write-back pending';
    else if (v === 'map') label = '✓ Mapped to ' + esc((payload && payload.sf_account_name) || 'Salesforce account');
    else if (v === 'confirm_sponsor') label = '✓ Sponsor confirmed';
    else if (v === 'create_later') label = '✓ Held — no Salesforce account yet';
    else if (v === 'rename') label = '✓ Renamed';
    else if (v === 'merge') label = '✓ Merged';
    else if (v === 'leave_flagged') label = '✓ Left flagged';
    else label = '✓ ' + esc(v);
    // Preserve a follow-up CTA (e.g. the connect ladder) when the verdict hands off.
    let fwd = '';
    const nx = res.data.next;
    if (nx && nx.action === 'connect' && nx.source_property_id != null && typeof openUnifiedDetail === 'function') {
      fwd = ' <button class="q-action primary" onclick="openUnifiedDetail(\'' + esc(nx.source_domain || 'gov')
        + '\', {property_id: ' + nx.source_property_id + '}, {}, \'Ownership &amp; CRM\')">Connect →</button>';
    }
    if (typeof showToast === 'function') showToast('Recorded', 'success');
    if (row) {
      row.classList.add('resolved');
      row.innerHTML = '<div class="dc-collapsed">' + label + fwd + '</div>';
      if (fwd) {
        _dcAdvance();                       // keep the collapsed row (has a CTA)
      } else {
        row.style.transition = 'opacity .4s ease';
        row.style.opacity = '0';
        setTimeout(function () { if (row.parentNode) row.remove(); _dcAdvance(); }, 420);
      }
    } else {
      _dcAdvance();
    }
  } else {
    if (typeof showToast === 'function') showToast('Action failed: ' + ((res.data && res.data.error) || res.error || 'unknown'), 'error');
  }
}
window.dcVerdict = dcVerdict;

function _dcAdvance() {
  const scope = document.getElementById('reviewConsoleContent');
  if (!scope) return;
  const pending = scope.querySelectorAll('.q-item[id^="dc-"]:not(.resolved)');
  const rem = document.getElementById('dcRemaining');
  if (rem) rem.textContent = pending.length;
  scope.querySelectorAll('.q-item.pq-next').forEach(function (n) { n.classList.remove('pq-next'); });
  if (pending.length) {
    pending[0].classList.add('pq-next');
    pending[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    const prog = scope.querySelector('.rc-progress');
    if (prog) prog.innerHTML = 'All decided in this lane ✓' + _dcNextLaneCTA(_dcCurrentOpenExpr);
    if (typeof showToast === 'function') showToast('Lane cleared ✓', 'success');
  }
}

// ── Priority Queue (BD front door, 2026-06-03) ─────────────────────────────
// The 'start here' worklist. Renders the doctrinal priority bands from
// v_priority_queue_enriched, most-urgent first, each row routing into the
// BD spine (property -> owner -> link -> lead -> cadence).
function _pqBandColor(band) {
  var b = String(band || '').toUpperCase();
  // R62: P0/P6/P7 (cadence-touch bands) no longer appear in the queue — outreach
  // cadence moved to the Cadence Dashboard.
  if (b === 'P0.4') return '#B5651D';
  if (b === 'P0.5') return 'var(--red)';
  if (b === 'P-BUYER') return 'var(--purple)';
  if (b === 'P-CONTACT') return '#8A6D1D';
  if (b === 'P1') return 'var(--yellow)';
  if (b === 'P2' || b === 'P3') return 'var(--purple)';
  if (b === 'P5') return 'var(--accent2)';
  if (b === 'P8') return 'var(--green)';
  return 'var(--text3)';
}
function _pqReason(reason) {
  var r = String(reason || '');
  var m = r.match(/^agency_active_solicitations:(\d+)$/);
  if (m) return m[1] + ' active agency solicitation' + (m[1] === '1' ? '' : 's');
  // P6 onboarding steps arrive as onboarding_step_due_<N> — keep them plain.
  var ob = r.match(/^onboarding_step_due_?(\d+)?$/);
  if (ob) return 'Onboarding touch overdue' + (ob[1] ? ' (step ' + ob[1] + ')' : '');
  // P-BUYER lane: repeat buyer, SPE portfolio rolled up to the parent.
  var rb = r.match(/^repeat_buyer_relationship:(\d+)$/);
  if (rb) return 'Repeat buyer · ' + rb[1] + ' SPE' + (rb[1] === '1' ? '' : 's') + ' rolled up';
  // Plain-language map — no doctrine jargon ("Developer Overdue") leaking to
  // the operator (R4-C §2).
  var map = {
    developer_overdue: 'Onboarding touch overdue (developer)',
    lease_expiry_24mo: 'Lease expires within 24 months',
    resolve_ownership_control: 'Resolve ownership & control',
    open_bd_opportunity_needed: 'Needs a BD opportunity opened',
    select_prospecting_contact: 'No reachable contact — select one',
    onboarding_cadence_due: 'Onboarding touch due',
    onboarding_step_due: 'Onboarding touch overdue',
    steady_state_cadence_due: 'Steady-state touch overdue',
    steady_state_touch_due: 'Steady-state touch due',
    recent_acquisition_streak: 'Active acquirer (recent buying streak)',
    aging_building: 'Aging building (replacement candidate)'
  };
  if (map[r]) return map[r];
  return r ? r.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : 'BD priority';
}
// State-aware CTA resolution (R4-C §2). Returns one of:
//   'open_opp'  — no open opportunity yet → "Open opportunity →"
//   'log_touch' — open opportunity + a cadence touch due/overdue → "Log touch →"
//   'view_opp'  — open opportunity, nothing due → "View opportunity →"
// Uses the open_opportunity flag the list now attaches; falls back to band/
// cadence inference when the flag is absent (older payloads / soft-fail).
function _pqCtaState(it) {
  var band = String(it.priority_band || '').toUpperCase();
  var reason = String(it.reason || '');
  var hasOpp = (it.open_opportunity === true);
  var oppResolved = (typeof it.open_opportunity === 'boolean');
  var dueNow = false;
  if (it.next_touch_due) { try { dueNow = new Date(it.next_touch_due).getTime() <= Date.now(); } catch (_e) {} }
  // R6 doctrine: P0.4 owners aren't resolved+connected yet — resolve FIRST, the
  // opportunity is not the next action.
  if (band === 'P0.4' || reason === 'resolve_ownership_control') return 'resolve';
  // R10 Unit 3: a cadence with no reachable contact is contact-resolution work,
  // not a touch — find the person FIRST (the true next action).
  if (band === 'P-CONTACT' || reason === 'select_prospecting_contact') return 'select_contact';
  // P0.5 doctrine: explicitly needs an opportunity opened (resolution-complete).
  if (band === 'P0.5' || reason === 'open_bd_opportunity_needed') return 'open_opp';
  // R62: the cadence-touch bands (P0/P6/P7) were removed from the queue — outreach
  // cadence is worked on the Cadence Dashboard, not here. No band-specific "Log
  // touch" CTA remains; the generic open-opportunity states handle the rest.
  if (oppResolved) {
    if (!hasOpp) return 'open_opp';
    return dueNow ? 'log_touch' : 'view_opp';
  }
  // Unresolved payload: infer from the cadence signal.
  if (dueNow) return 'log_touch';
  if (it.next_touch_due) return 'view_opp';
  return 'open_opp';
}
function _pqMoney(v) {
  var n = Number(v);
  if (!isFinite(n) || n <= 0) return null;
  return '$' + Math.round(n).toLocaleString('en-US');
}
// R14 hybrid drill-down: the rolled-up trigger card (P1/P3/P5/P8) is one row per
// owner; this expands the per-property detail via the lcc_trigger_band_properties
// fan-out (the queue row stays one-per-owner). Toggles open/closed; loads once.
async function pqTriggerDrill(entityId, band, domain, btn) {
  var card = btn && btn.closest ? btn.closest('.q-item') : null;
  var box = card ? card.querySelector('.pq-trigger-detail') : null;
  if (!box) return;
  if (box.dataset.loaded === '1') {
    box.style.display = (box.style.display === 'none' ? '' : 'none');
    return;
  }
  btn.disabled = true;
  var _label = btn.textContent;
  btn.textContent = 'Loading…';
  var qs = '/api/priority-trigger-properties?entity_id=' + encodeURIComponent(entityId)
    + '&band=' + encodeURIComponent(band)
    + (domain ? '&domain=' + encodeURIComponent(domain) : '');
  var res = await opsApi(qs);
  btn.disabled = false;
  btn.textContent = _label;
  if (!res.ok) {
    box.innerHTML = '<div class="q-item-meta">Could not load properties.</div>';
    box.dataset.loaded = '1'; box.style.display = '';
    return;
  }
  var props = (res.data && res.data.properties) || [];
  var rows = props.map(function (p) {
    var a = [p.address, p.city, p.state].filter(Boolean).join(', ');
    var bits = [];
    if (p.trigger_fact) bits.push(p.trigger_fact);
    var rent = _pqMoney(p.annual_rent);
    if (rent) bits.push(rent);
    var dom = p.source_domain === 'government' ? 'gov' : p.source_domain === 'dialysis' ? 'dia' : (p.source_domain || '');
    var open = (p.source_property_id != null && dom)
      ? '<button class="q-action" onclick="openUnifiedDetail(\'' + esc(dom) + '\', {property_id: ' + esc(String(p.source_property_id)) + '}, {}, \'Ownership &amp; CRM\')">Open →</button>'
      : '';
    return '<div class="pq-trigger-row">'
      + '<span class="pq-trigger-addr">' + esc(a || ('Property ' + (p.source_property_id || ''))) + '</span>'
      + (bits.length ? '<span class="pq-trigger-fact">' + esc(bits.join(' · ')) + '</span>' : '')
      + open + '</div>';
  }).join('');
  box.innerHTML = rows || '<div class="q-item-meta">No properties.</div>';
  box.dataset.loaded = '1';
  box.style.display = '';
}
// ============================================================================
// R60 Unit 2 — render-side row pagination. The big list surfaces (Priority
// Queue, Top BD Actions) build one rich card per row; injecting 100-150 at
// once is what made them feel heavy and time out mid-render. We cap how many
// rows hit the DOM at once and reveal the rest via "Show more". This is a
// RENDER cap only — band/signal filters still run against the full in-memory
// set, and selecting a filter re-renders the row array from scratch, so the
// cap re-pages within the filtered subset.
// ============================================================================
var OPS_ROW_PAGE = 50;
var _opsRowStore = {};

// Build the initial (capped) row HTML for a list + a "Show more" control.
// `rows` is an array of per-row HTML strings (order preserved).
function opsPagedRows(key, rows, pageSize) {
  pageSize = pageSize || OPS_ROW_PAGE;
  var shown = Math.min(pageSize, rows.length);
  _opsRowStore[key] = { rows: rows, shown: shown, size: pageSize };
  var html = '<div class="ops-row-list" id="ops-rows-' + key + '">' + rows.slice(0, shown).join('') + '</div>';
  return html + _opsShowMoreBtn(key);
}

function _opsShowMoreBtn(key) {
  var st = _opsRowStore[key];
  if (!st || st.shown >= st.rows.length) return '';
  var remaining = st.rows.length - st.shown;
  var next = Math.min(st.size, remaining);
  return '<button class="q-action ops-show-more" id="ops-more-' + key + '" onclick="opsShowMore(' + jsStringArg(key) + ')">Show ' + next + ' more (' + remaining + ' remaining)</button>';
}

// Reveal the next chunk, appending to the existing list (no full re-render).
function opsShowMore(key) {
  var st = _opsRowStore[key];
  if (!st) return;
  var wrap = document.getElementById('ops-rows-' + key);
  if (!wrap) return;
  var to = Math.min(st.shown + st.size, st.rows.length);
  wrap.insertAdjacentHTML('beforeend', st.rows.slice(st.shown, to).join(''));
  st.shown = to;
  var btn = document.getElementById('ops-more-' + key);
  if (!btn) return;
  if (st.shown >= st.rows.length) { btn.remove(); return; }
  var remaining = st.rows.length - st.shown;
  btn.textContent = 'Show ' + Math.min(st.size, remaining) + ' more (' + remaining + ' remaining)';
}
window.opsShowMore = opsShowMore;

async function renderPriorityQueuePage(band) {
  var el = document.getElementById('priorityQueueContent');
  if (!el) return;
  window._pqCurrentBand = band || null;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  var perf = opsPerf('render:priority_queue');
  var qs = '/api/priority-queue?limit=150' + (band ? '&band=' + encodeURIComponent(band) : '');
  var res = await opsApi(qs);
  if (!res.ok) { el.innerHTML = opsErrorState(res, 'renderPriorityQueuePage()', 'Could not load the priority queue'); perf.end(); return; }
  var data = res.data || {};
  var items = Array.isArray(data.items) ? data.items : [];
  var counts = Array.isArray(data.counts) ? data.counts : [];
  var total = data.total || 0;
  var html = '<div class="ops-header"><h2>Priority Queue</h2>'
    + '<button class="q-action" onclick="renderNextBestTouchpoint()">Next best touchpoint →</button>'
    + '<button class="q-action primary" onclick="renderCadenceDashboard()">Cadence dashboard →</button>'
    + '<button class="q-action" onclick="renderBdWorklist()">Top BD actions →</button>'
    + '<button class="q-action" onclick="renderContactQualifyWorklist()">Qualify contacts →</button></div>';
  html += '<div class="rc-intro">Start here. Your highest-leverage BD targets, most urgent band first. Each row routes straight to the property so you can resolve the owner, confirm the CRM link, and open a lead.</div>';
  // Band filter chips.
  html += '<div class="pq-chips">';
  html += '<button class="pq-chip' + (!band ? ' active' : '') + '" onclick="renderPriorityQueuePage()">All <b>' + total + '</b></button>';
  counts.forEach(function (c) {
    html += '<button class="pq-chip' + (band === c.band ? ' active' : '') + '" onclick="renderPriorityQueuePage(\'' + esc(c.band) + '\')">'
      + '<span class="pq-chip-dot" style="background:' + _pqBandColor(c.band) + '"></span>' + esc(c.band) + ' <b>' + c.n + '</b></button>';
  });
  html += '</div>';
  if (!items.length) { html += '<div class="ops-empty">Nothing in this band. \u2713</div>'; el.innerHTML = html; perf.end(); return; }
  // Collect entities still needing an opportunity opened, for the bulk
  // "Open top N" action (R4-C \u00A72). Reset per render.
  var _openOppCandidates = [];
  var _rowChunks = [];
  items.forEach(function (it, _ix) {
    var domShort = it.source_domain === 'government' ? 'gov' : it.source_domain === 'dialysis' ? 'dia' : (it.source_domain || '');
    var hasProp = it.source_property_id != null && domShort;
    // Self-propelling contract: elevate the single top item as 'do this first'.
    var _itemCls = 'q-item' + (_ix === 0 ? ' pq-hero' : '');
    var _heroFlag = _ix === 0 ? '<div class="pq-hero-flag">\u25B6 Do this first</div>' : '';
    var _bandU = String(it.priority_band || '').toUpperCase();
    var isBuyerLane = _bandU === 'P-BUYER';
    // R14: the four property-trigger bands now arrive ONE row per owner with the
    // band portfolio rolled up (count + rollup rent + top property fact), the
    // same shape P-BUYER uses. Render the rollup, not a single property.
    var isTriggerLane = !isBuyerLane && (_bandU === 'P1' || _bandU === 'P3' || _bandU === 'P5' || _bandU === 'P8') && it.trigger_property_count != null;
    var ctx = [];
    if (isBuyerLane) {
      // Parent rollup of the whole SPE portfolio (R5).
      if (it.buyer_spe_count != null) ctx.push(esc(String(it.buyer_spe_count)) + ' SPE' + (Number(it.buyer_spe_count) === 1 ? '' : 's'));
      if (it.buyer_rollup_property_count) ctx.push(esc(String(it.buyer_rollup_property_count)) + ' properties');
      var bmoney = _pqMoney(it.buyer_rollup_annual_rent);
      if (bmoney) ctx.push(bmoney + ' rent');
      ctx.push(it.buyer_sf_account_id ? 'SF account mapped' : 'SF mapping needed');
    } else if (isTriggerLane) {
      // R14 rollup card: "{count} propert(y|ies) in this band · $X total".
      // Single-property owners read naturally ("1 property"), never "1 properties".
      var _tc = Number(it.trigger_property_count) || 0;
      ctx.push(_tc + (_tc === 1 ? ' property' : ' properties') + ' in this band');
      var tmoney = _pqMoney(it.trigger_rollup_annual_rent);
      if (tmoney) ctx.push(tmoney + ' total');
    } else {
      if (it.total_property_count) ctx.push(esc(String(it.total_property_count)) + (Number(it.total_property_count) === 1 ? ' property' : ' properties'));
      var money = _pqMoney(it.current_annual_rent_total);
      if (money) {
        ctx.push(money + ' rent');
      } else {
        // R11 Unit 2: no portfolio rollup (P0.4 resolution rows, the dia book) —
        // fall back to the subject/representative property's rent, labeled so it
        // isn't read as portfolio rent.
        var smoney = _pqMoney(it.source_property_rent);
        if (smoney) {
          ctx.push(smoney + ' rent (subject property)');
        } else {
          // R17: connect bands (P0.4 / P-CONTACT) with no portfolio edge and no
          // subject property — fall back to the value of property the owner
          // CONTROLS via owns/purchases/leases edges (what rank_annual_rent now
          // ranks on), so a high-value owner reads as high-value, not blank.
          var cmoney = _pqMoney(it.connected_property_value);
          if (cmoney) {
            var ccount = Number(it.connected_property_count) || 0;
            ctx.push(cmoney + ' rent (' + ccount + (ccount === 1 ? ' connected property' : ' connected properties') + ')');
          }
        }
      }
      if (it.is_cross_vertical) ctx.push('cross-vertical');
    }
    // R6 P0.4: surface the resolution state so the row is truthful about WHY the
    // CTA is "Resolve owner" instead of "Open opportunity".
    if (String(it.priority_band || '').toUpperCase() === 'P0.4') {
      if (it.resolve_true_owner_name) ctx.push('True owner: ' + esc(it.resolve_true_owner_name) + ' — connect');
      else if (it.resolve_reason === 'recorded_owner_shell_true_owner_unresolved') ctx.push('Recorded owner shell — true owner unresolved');
      else ctx.push('Owner known — connect SF account / contact');
    }
    var addr = hasProp ? (it.source_property_address || '') + (it.source_property_city ? ', ' + it.source_property_city : '') + (it.source_property_state ? ', ' + it.source_property_state : '') : '';
    // R14: on a rolled-up trigger card the representative property is the MOST
    // urgent one — label it as "Top:" and fold in its fact (e.g. "built 1925").
    if (isTriggerLane) {
      var _tparts = [];
      if (addr) _tparts.push(addr);
      if (it.trigger_top_fact) _tparts.push(it.trigger_top_fact);
      if (_tparts.length) addr = 'Top: ' + _tparts.join(' — ');
    }
    // data-q-id keys the self-propelling row-advance (entity_id is the natural
    // PQ row key); reused by _opsAdvanceAfterComplete after open_opportunity.
    var _qid = it.entity_id == null ? '' : String(it.entity_id);
    // State-aware CTA (R4-C \u00A72): the action reflects the row's CURRENT state
    // instead of always offering "Open opportunity". Owner-level rows (no
    // property to open) act directly on the entity; property rows route to the
    // detail banner, which is itself state-aware.
    var _state = _qid ? _pqCtaState(it) : null;
    var _ownerAction;
    if (isBuyerLane && _qid) {
      // R5: repeat buyers are buy-side relationships. The only opportunity they
      // may carry is a Government Buyer opportunity on the PARENT account. No
      // standard prospect opportunity \u2014 keep this row OUT of the bulk "Open top
      // N" candidate set.
      var _gbLabel = it.buyer_needs_sf_mapping ? 'Open Government Buyer (map SF) \u2192' : 'Open Government Buyer opportunity \u2192';
      _ownerAction = '<button class="q-action primary" onclick="pqOpenGovernmentBuyer(' + jsStringArg(_qid) + ', ' + jsStringArg(it.name || '') + ', this)">' + _gbLabel + '</button>';
    } else if (_state === 'resolve' && _qid) {
      // R6: the control structure isn't resolved + connected yet. Route into the
      // property resolution ladder (Owner \u203a Link \u2192 Lead) when we have a
      // representative property; otherwise act on the owner entity directly.
      if (hasProp) {
        _ownerAction = '<button class="q-action primary" onclick="openUnifiedDetail(\'' + esc(domShort) + '\', {property_id: ' + esc(String(it.source_property_id)) + '}, {}, \'Ownership &amp; CRM\')">Resolve owner \u2192</button>';
      } else {
        _ownerAction = '<button class="q-action primary" onclick="pqResolveOwner(' + jsStringArg(_qid) + ', ' + jsStringArg(it.name || '') + ', this)">Resolve owner \u2192</button>';
      }
    } else if (_state === 'select_contact' && _qid) {
      // R10 Unit 3: P-CONTACT \u2014 the cadence has no reachable contact. The next
      // action is finding the person, not "email a shell". Opens the same
      // contact picker the P-BUYER lane uses (generalized), and on select links
      // the contact so the row leaves P-CONTACT and re-enters the cadence bands.
      _ownerAction = '<button class="q-action primary" onclick="pqSelectProspectingContact(' + jsStringArg(_qid) + ', ' + jsStringArg(it.name || '') + ', this)">Select prospecting contact \u2192</button>';
    } else if (!_qid) {
      _ownerAction = '<span class="q-badge" title="Owner-level priority \u2014 no single property to open">owner-level</span>';
    } else if (_state === 'log_touch') {
      _ownerAction = '<button class="q-action primary" onclick="pqLogTouch(' + jsStringArg(_qid) + ', ' + jsStringArg(it.vertical || '') + ', this)">Log touch \u2192</button>';
    } else if (_state === 'view_opp') {
      _ownerAction = '<button class="q-action" onclick="pqLogTouch(' + jsStringArg(_qid) + ', ' + jsStringArg(it.vertical || '') + ', this)">View opportunity \u2192</button>';
    } else {
      _openOppCandidates.push({ id: _qid, vertical: it.vertical || '' });
      _ownerAction = '<button class="q-action primary" onclick="pqOpenOpportunity(' + jsStringArg(_qid) + ', ' + jsStringArg(it.vertical || '') + ', this)">Open opportunity \u2192</button>';
    }
    _rowChunks.push('<div class="' + _itemCls + '" data-q-id="' + esc(_qid) + '">' + _heroFlag
      + '<div class="q-item-header">'
      + '<span class="pq-band" style="background:' + _pqBandColor(it.priority_band) + '">' + esc(it.priority_band || '\u2014') + '</span>'
      + '<span class="q-item-title">' + esc(it.name || 'Owner') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(_pqReason(it.reason)) + '</span></div></div>'
      + (ctx.length ? '<div class="q-item-meta">' + esc(ctx.join(' \u00b7 ')) + '</div>' : '')
      + (addr ? '<div class="q-item-meta">' + esc(addr) + '</div>' : '')
      + '<div class="q-actions">'
      + ((hasProp && _state !== 'resolve')
          ? '<button class="q-action primary" onclick="openUnifiedDetail(\'' + esc(domShort) + '\', {property_id: ' + esc(String(it.source_property_id)) + '}, {}, \'Ownership &amp; CRM\')">Open property \u2192</button>'
          : _ownerAction)
      // R14 hybrid: the per-property detail stays reachable on a drill-down that
      // calls the fan-out function. Only when there's more than one to expand.
      + ((isTriggerLane && Number(it.trigger_property_count) > 1 && _qid)
          ? '<button class="q-action" onclick="pqTriggerDrill(' + jsStringArg(_qid) + ', ' + jsStringArg(it.priority_band || '') + ', ' + jsStringArg(domShort) + ', this)">View ' + Number(it.trigger_property_count) + ' properties \u2192</button>'
          : '')
      + '</div>'
      + (isTriggerLane && Number(it.trigger_property_count) > 1 ? '<div class="pq-trigger-detail" style="display:none"></div>' : '')
      + '</div>');
  });
  // Bulk "Open top N" action (R4-C §2): when a band (esp. P0.5) holds many rows
  // that all just need an opportunity opened, let the operator clear the top
  // slice in one idempotent click instead of 488 individual ones.
  window._pqOpenOppCandidates = _openOppCandidates;
  if (_openOppCandidates.length > 1) {
    var _bulkN = Math.min(20, _openOppCandidates.length);
    html += '<div class="pq-bulkbar">'
      + '<span class="pq-bulkbar-label">' + _openOppCandidates.length + ' rows just need an opportunity opened.</span> '
      + '<button class="q-action primary" onclick="pqOpenTopN(' + _bulkN + ')">⚡ Open top ' + _bulkN + ' opportunities</button>'
      + '</div>';
  }
  html += opsPagedRows('pq', _rowChunks);
  el.innerHTML = html;
  perf.end();
}
window.renderPriorityQueuePage = renderPriorityQueuePage;

// Bulk-open the top N owner opportunities still needing one (R4-C §2). Reuses
// the idempotent open_opportunity path, so re-clicks and overlaps are safe.
async function pqOpenTopN(n) {
  var list = (window._pqOpenOppCandidates || []).slice(0, Math.max(1, n || 10));
  if (!list.length) { showToast('No opportunities to open', 'info'); return; }
  showToast('Opening ' + list.length + ' opportunities…', 'info');
  var opened = 0, already = 0, failed = 0, skippedBuyers = 0;
  for (var i = 0; i < list.length; i++) {
    try {
      var res = await opsPost('/api/operations?action=open_opportunity', { entity_id: list[i].id, vertical: list[i].vertical || null });
      // R5: repeat-buyer SPEs are skipped-and-reported, never failed — they are
      // buy-side relationships handled in the P-BUYER lane, not prospects.
      if (res.ok && res.data && res.data.blocked === 'repeat_buyer_spe') { skippedBuyers++; }
      else if (res.ok && res.data && res.data.ok) { if (res.data.already_open) already++; else opened++; }
      else failed++;
    } catch (_e) { failed++; }
  }
  showToast('Opened ' + opened
    + (already ? ' · ' + already + ' already open' : '')
    + (skippedBuyers ? ' · ' + skippedBuyers + ' repeat buyers skipped (see P-BUYER)' : '')
    + (failed ? ' · ' + failed + ' failed' : ''), failed ? 'error' : 'success');
  renderPriorityQueuePage(window._pqCurrentBand || undefined);
}
window.pqOpenTopN = pqOpenTopN;

// Log a cadence touch for an owner-level priority-queue row, then advance the
// row in place so the queue self-propels (R4-C §2 state-aware CTA). Used by the
// "Log touch →" / "View opportunity →" CTAs (open opp + cadence present).
async function pqLogTouch(entityId, vertical, btn) {
  if (!entityId) { showToast('No entity to log a touch for', 'error'); return; }
  const origText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Logging…'; }
  try {
    const res = await opsPost('/api/operations?action=advance_cadence', {
      entity_id: entityId,
      type: 'touch',
      outcome: 'logged_from_priority_queue',
    });
    if (res.ok && res.data && (res.data.ok || res.data.cadence_id || res.data.next_touch_due)) {
      showToast('Touch logged', 'success');
      if (!_opsAdvanceAfterComplete(entityId)) renderPriorityQueuePage(window._pqCurrentBand || undefined);
    } else {
      showToast((res.data && res.data.error) || res.error || 'Could not log touch', 'error');
      if (btn) { btn.disabled = false; btn.textContent = origText || 'Log touch →'; }
    }
  } catch (err) {
    showToast('Log touch error: ' + (err && err.message ? err.message : err), 'error');
    if (btn) { btn.disabled = false; btn.textContent = origText || 'Log touch →'; }
  }
}
window.pqLogTouch = pqLogTouch;

// QA#2 — open a BD opportunity for an owner-level priority-queue row, then
// advance the row in place so the queue self-propels.
async function pqOpenOpportunity(entityId, vertical, btn) {
  if (!entityId) { showToast('No entity to open an opportunity for', 'error'); return; }
  const origText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
  try {
    const res = await opsPost('/api/operations?action=open_opportunity', {
      entity_id: entityId,
      vertical: vertical || null,
    });
    // R5 refusal: this owner reconciles to a repeat-buyer parent. Offer the
    // buy-side path instead of a prospect opportunity.
    if (res.ok && res.data && res.data.blocked === 'repeat_buyer_spe') {
      const pn = res.data.parent_name || 'a top repeat buyer';
      showToast('SPE of ' + pn + ' — buyers are prospected buy-side. Opening Government Buyer on the parent…', 'info');
      if (res.data.parent_entity_id) {
        await pqOpenGovernmentBuyer(res.data.parent_entity_id, pn, null);
      } else {
        renderPriorityQueuePage(window._pqCurrentBand || undefined);
      }
      return;
    }
    if (res.ok && res.data && res.data.ok) {
      showToast(res.data.already_open ? 'Opportunity already open' : 'Opportunity opened', 'success');
      if (!_opsAdvanceAfterComplete(entityId)) renderPriorityQueuePage();
    } else {
      showToast(res.error || 'Could not open opportunity', 'error');
      if (btn) { btn.disabled = false; btn.textContent = origText || 'Open opportunity →'; }
    }
  } catch (err) {
    showToast('Open opportunity error: ' + (err && err.message ? err.message : err), 'error');
    if (btn) { btn.disabled = false; btn.textContent = origText || 'Open opportunity →'; }
  }
}
window.pqOpenOpportunity = pqOpenOpportunity;

// R5 — open (or reuse) the single Government Buyer opportunity on a repeat-buyer
// PARENT account. Idempotent server-side; when the parent has no Salesforce
// account mapped, the server logs a research task and the opportunity sync
// holds (never routes to a subsidiary SPE).
async function pqOpenGovernmentBuyer(entityId, parentName, btn) {
  if (!entityId) { showToast('No parent account to open a Government Buyer opportunity for', 'error'); return; }
  const card = (btn && btn.closest) ? btn.closest('.q-item') : null;
  const origText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
  try {
    const res = await opsPost('/api/operations?action=open_government_buyer', { entity_id: entityId });
    if (res.ok && res.data && res.data.ok) {
      const d = res.data;
      const pname = d.parent_name || parentName || 'the parent';
      const needsMap = !!d.needs_sf_mapping;
      const base = d.already_open ? 'Government Buyer already open' : 'Government Buyer opportunity opened';
      const tail = needsMap ? ' · finish the SF parent mapping' : '';
      showToast(base + ' on ' + pname + tail, 'success');
      // Self-propelling contract: advance the card to its mapped/working state in
      // place instead of leaving it identical. On already_open a full re-render
      // would just redraw the same row (the parent stays in P-BUYER), so the
      // operator would see no progress — mutate the card instead. When the parent
      // still needs a Salesforce mapping, route straight to the Decision Center
      // map card so it can be finished now, not only logged for later. When
      // mapped, advance to the CONTACT step (select prospecting contact → buy-side
      // cadence) — the account-level opp is open; the next action is the person.
      _pqAdvanceGovBuyerCard(card, pname, needsMap, entityId, d.bd_opportunity_id || null);
    } else {
      showToast((res.data && res.data.error) || res.error || 'Could not open Government Buyer opportunity', 'error');
      if (btn) { btn.disabled = false; btn.textContent = origText || 'Open Government Buyer opportunity →'; }
    }
  } catch (err) {
    showToast('Open Government Buyer error: ' + (err && err.message ? err.message : err), 'error');
    if (btn) { btn.disabled = false; btn.textContent = origText || 'Open Government Buyer opportunity →'; }
  }
}
window.pqOpenGovernmentBuyer = pqOpenGovernmentBuyer;

// Advance a P-BUYER row to its post-open state (self-propelling contract). A
// mapped parent settles to "open · SF mapped"; an unmapped parent advances to a
// "finish SF mapping" state whose CTA jumps to the Decision Center map lane
// (map_sf_parent_account), where the mapping can be completed immediately.
function _pqAdvanceGovBuyerCard(card, parentName, needsMap, entityId, oppId) {
  if (!card) { renderPriorityQueuePage(window._pqCurrentBand || undefined); return; }
  card.classList.add('resolved');
  const actions = card.querySelector('.q-actions');
  if (needsMap) {
    const meta = document.createElement('div');
    meta.className = 'q-item-meta';
    meta.innerHTML = '✓ Government Buyer opportunity open on <b>' + esc(parentName)
      + '</b> — map its Salesforce parent account to release the sync.';
    if (actions) card.insertBefore(meta, actions); else card.appendChild(meta);
    if (actions) actions.innerHTML =
      '<button class="q-action primary" onclick="navTo(\'pageReviewConsole\');setTimeout(renderBuyerParentLane,400)">Map SF parent now →</button>';
  } else if (actions) {
    // Mapped: the next action is selecting the prospecting contact (the opp is
    // account-level; opportunities are tied to a specific person at the company).
    const safeName = String(parentName || '').replace(/'/g, '’');
    actions.innerHTML = '<span class="q-badge">✓ Government Buyer open · SF mapped</span>'
      + ' <button class="q-action primary" onclick="pqSelectBuyerContact('
      + (entityId ? '\'' + esc(String(entityId)) + '\'' : 'null') + ', '
      + (oppId ? '\'' + esc(String(oppId)) + '\'' : 'null') + ', \'' + esc(safeName) + '\', this)">Select prospecting contact →</button>';
  }
}
window._pqAdvanceGovBuyerCard = _pqAdvanceGovBuyerCard;

// Buy-side contact step: pick the prospecting contact for a mapped buyer parent,
// then seed the buy-side cadence. Sources: person entities related to the
// parent, Salesforce contacts on the mapped account, name-matched persons, or a
// new contact. On select → POST select_buyer_contact → the card settles to
// "On buy-side cadence with <name> — next touch <date>" (the parent then lives
// in the cadence bands like any relationship).
let _pqBuyerCtx = {};
async function pqSelectBuyerContact(entityId, oppId, parentName, btn) {
  if (!entityId) { showToast('No parent entity for the contact step', 'error'); return; }
  const card = (btn && btn.closest) ? btn.closest('.q-item') : null;
  _pqBuyerCtx = { entityId: entityId, oppId: oppId, parentName: parentName, card: card };
  let host = card ? card.querySelector('.pq-buyer-contact') : null;
  if (card && !host) {
    host = document.createElement('div');
    host.className = 'pq-buyer-contact';
    const actions = card.querySelector('.q-actions');
    if (actions) card.insertBefore(host, actions); else card.appendChild(host);
  }
  if (host) host.innerHTML = '<div class="q-item-meta"><span class="spinner"></span> loading contacts…</div>';
  const res = await opsApi('/api/operations?action=buyer_contacts&entity_id=' + encodeURIComponent(entityId));
  if (!res.ok || !res.data || !res.data.ok) {
    if (host) host.innerHTML = '<div class="q-item-meta">Could not load contacts: ' + esc((res.data && res.data.error) || res.error || 'unknown') + '</div>';
    return;
  }
  _pqBuyerCtx.candidates = res.data;
  if (host) host.innerHTML = _pqBuyerContactHTML(res.data);
}
window.pqSelectBuyerContact = pqSelectBuyerContact;

// R10 Unit 3 — generalize the buyer-contact picker for the P-CONTACT lane: a
// prospecting cadence with no reachable contact. Same candidate loader + picker
// UI; on select it attaches the contact to the EXISTING prospecting cadence
// (not a buy-side one), so the row becomes reachable and leaves P-CONTACT.
async function pqSelectProspectingContact(entityId, name, btn) {
  if (!entityId) { showToast('No entity for the contact step', 'error'); return; }
  const card = (btn && btn.closest) ? btn.closest('.q-item') : null;
  _pqBuyerCtx = { entityId: entityId, oppId: null, parentName: name, card: card, mode: 'prospecting' };
  let host = card ? card.querySelector('.pq-buyer-contact') : null;
  if (card && !host) {
    host = document.createElement('div');
    host.className = 'pq-buyer-contact';
    const actions = card.querySelector('.q-actions');
    if (actions) card.insertBefore(host, actions); else card.appendChild(host);
  }
  if (host) host.innerHTML = '<div class="q-item-meta"><span class="spinner"></span> loading contacts…</div>';
  const res = await opsApi('/api/operations?action=buyer_contacts&entity_id=' + encodeURIComponent(entityId));
  if (!res.ok || !res.data || !res.data.ok) {
    if (host) host.innerHTML = '<div class="q-item-meta">Could not load contacts: ' + esc((res.data && res.data.error) || res.error || 'unknown') + '</div>';
    return;
  }
  _pqBuyerCtx.candidates = res.data;
  if (host) host.innerHTML = _pqBuyerContactHTML(res.data);
}
window.pqSelectProspectingContact = pqSelectProspectingContact;

function _pqBuyerContactHTML(d) {
  let h = '<div class="pq-bc-head">Who is the prospecting contact at ' + esc(d.parent_name || 'this account') + '?</div>';
  const sec = (title, rows, kind) => {
    if (!rows || !rows.length) return '';
    let s = '<div class="pq-bc-sec">' + esc(title) + '</div>';
    rows.forEach(function (c, i) {
      const sub = [c.title, c.email].filter(Boolean).join(' · ');
      s += '<div class="pq-bc-row"><div class="pq-bc-main"><b>' + esc(c.name || 'Unnamed') + '</b>'
        + (sub ? ' <span class="pq-bc-meta">' + esc(sub) + '</span>' : '') + '</div>'
        + '<button class="q-action primary" onclick="pqBuyerContactPick(\'' + kind + '\',' + i + ')">Select</button></div>';
    });
    return s;
  };
  h += sec('Linked to this account', d.related, 'related');
  // Salesforce section — honest about why it's empty (never a silent blank).
  if (d.sf_contacts && d.sf_contacts.length) {
    h += sec('Salesforce contacts on the account', d.sf_contacts, 'sf');
  } else {
    const msg = {
      no_account: 'Parent not yet mapped to a Salesforce account — map it first to pull its contacts.',
      not_configured: 'Salesforce lookup not configured in this environment.',
      unavailable: 'Salesforce contact lookup unavailable (flow op <code>find_contacts_by_account</code> not implemented) — search SF manually, or add the contact here.',
      no_contacts: 'No Salesforce contacts on this account yet.',
    }[d.sf_status];
    if (msg) h += '<div class="pq-bc-sec">Salesforce contacts on the account</div>'
               + '<div class="q-item-meta">' + msg + '</div>';
  }
  h += sec('Name-matched humans (link on select)', d.name_matches, 'name');
  if (!(d.related && d.related.length) && !(d.sf_contacts && d.sf_contacts.length) && !(d.name_matches && d.name_matches.length)) {
    h += '<div class="q-item-meta">No existing contacts to pick — add one below.</div>';
  }
  h += '<div class="pq-bc-row pq-bc-new"><button class="q-action" onclick="pqBuyerContactAddNew()">+ Add new contact…</button></div>';
  return h;
}

function pqBuyerContactPick(kind, i) {
  const d = _pqBuyerCtx.candidates || {};
  const arr = kind === 'related' ? d.related : kind === 'sf' ? d.sf_contacts : d.name_matches;
  const c = (arr || [])[i];
  if (!c) return;
  const payload = (kind === 'sf')
    ? { sf_contact_id: c.sf_contact_id, contact_name: c.name }
    : { contact_entity_id: c.entity_id, contact_name: c.name };
  _pqBuyerContactSubmit(payload, c.name);
}
window.pqBuyerContactPick = pqBuyerContactPick;

async function pqBuyerContactAddNew() {
  const nm = typeof lccPrompt === 'function'
    ? await lccPrompt('Add a new prospecting contact at this buyer parent.\n\nFull name:', '')
    : (typeof prompt === 'function' ? prompt('New contact name:') : '');
  if (nm == null) return;
  const v = String(nm || '').trim();
  if (!v) { if (typeof showToast === 'function') showToast('Enter the contact name.', 'error'); return; }
  _pqBuyerContactSubmit({ new_contact_name: v }, v);
}
window.pqBuyerContactAddNew = pqBuyerContactAddNew;

async function _pqBuyerContactSubmit(payload, displayName) {
  const ctx = _pqBuyerCtx;
  // R10 Unit 3: the P-CONTACT lane attaches the contact to the existing
  // prospecting cadence; P-BUYER seeds a buy-side cadence. Same picker, two
  // endpoints — both ride the Unit-1 single advance owner downstream.
  const isProspecting = ctx.mode === 'prospecting';
  const action = isProspecting ? 'select_prospecting_contact' : 'select_buyer_contact';
  const body = Object.assign({ entity_id: ctx.entityId }, isProspecting ? {} : { bd_opportunity_id: ctx.oppId }, payload);
  const res = await opsPost('/api/operations?action=' + action, body);
  if (res.ok && res.data && res.data.ok) {
    const name = res.data.contact_name || displayName || 'contact';
    const card = ctx.card;
    if (card) {
      const host = card.querySelector('.pq-buyer-contact'); if (host) host.remove();
      const actions = card.querySelector('.q-actions');
      if (actions) {
        if (isProspecting) {
          actions.innerHTML = '<span class="q-badge">✓ Contact ' + esc(name) + ' linked — back in the cadence</span>';
        } else {
          const due = res.data.next_touch_due ? new Date(res.data.next_touch_due).toLocaleDateString() : 'now';
          actions.innerHTML = '<span class="q-badge">✓ On buy-side cadence with ' + esc(name) + ' — next touch ' + esc(due) + '</span>';
        }
      }
      card.classList.add('resolved');
    }
    showToast(isProspecting ? ('Contact ' + name + ' linked — cadence is now actionable') : ('Buy-side cadence started with ' + name), 'success');
  } else {
    showToast('Could not select contact: ' + ((res.data && res.data.error) || res.error || 'unknown'), 'error');
  }
}

// R6 — owner-level "Resolve owner →" for a P0.4 row that has no representative
// property to route through. The control structure must be resolved + connected
// (true owner / parent identified, Salesforce account or contact linked) BEFORE
// an opportunity is the next action. Routes to the entities surface where that
// linkage is done; the queue re-bands the owner out of P0.4 once connected.
function pqResolveOwner(entityId, name) {
  if (!entityId) { showToast('No owner entity to resolve', 'error'); return; }
  showToast('Resolve ' + (name || 'this owner') + ': identify the true owner/parent and link a Salesforce account or contact, then the opportunity becomes the next action.', 'info');
  try { if (typeof navTo === 'function') navTo('pageEntities'); } catch (_e) {}
}
window.pqResolveOwner = pqResolveOwner;

// ============================================================================
// R10 Unit 4 — Cadence dashboard + minimum outreach surface
// Renders v_bd_cadence_dashboard (one row per active cadence) and gives each a
// next action: "Draft email →" (generate inline → copy / open in mail / Mark
// sent → record_send) for email-next rows, or "Log touch →" (the Unit-1 single
// advance path) for call/vm-next rows. No sending integration — copy + mailto.
// ============================================================================
async function renderCadenceDashboard() {
  var el = document.getElementById('priorityQueueContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  var res = await opsApi('/api/operations?action=cadence_dashboard&limit=200');
  if (!res.ok || !res.data || !res.data.ok) {
    el.innerHTML = opsErrorState(res, 'renderCadenceDashboard()', 'Could not load the cadence dashboard');
    return;
  }
  var items = Array.isArray(res.data.items) ? res.data.items : [];
  var total = res.data.total != null ? res.data.total : items.length;
  var html = '<div class="ops-header"><h2>Cadence Dashboard</h2>'
    + '<button class="q-action" onclick="renderPriorityQueuePage(window._pqCurrentBand || undefined)">← Back to queue</button></div>';
  html += '<div class="rc-intro">Every active outreach cadence — phase, touch count, what is due, and the last outcome. '
    + 'Work the overdue rows top-down: draft the next email or log the call; either advances the cadence.</div>';
  if (!items.length) { html += '<div class="ops-empty">No active cadences. ✓</div>'; el.innerHTML = html; return; }
  html += '<div class="q-item-meta" style="margin:6px 0">' + esc(String(total)) + ' active cadence' + (total === 1 ? '' : 's') + '</div>';
  items.forEach(function (it, ix) {
    var cid = it.cadence_id == null ? '' : String(it.cadence_id);
    var eid = it.entity_id == null ? '' : String(it.entity_id);
    var overdue = Number(it.days_overdue);
    var dueLbl = it.next_touch_due
      ? (isFinite(overdue) && overdue > 0 ? esc(String(overdue)) + 'd overdue' : 'due ' + new Date(it.next_touch_due).toLocaleDateString())
      : 'no next touch';
    var nt = String(it.next_touch_type || '').toLowerCase();
    var isEmail = (nt === 'email' || nt === '');
    var stats = [];
    if (it.emails_sent) stats.push(it.emails_sent + ' email' + (it.emails_sent === 1 ? '' : 's'));
    if (it.calls_made) stats.push(it.calls_made + ' call' + (it.calls_made === 1 ? '' : 's'));
    if (it.meetings_scheduled) stats.push(it.meetings_scheduled + ' mtg');
    var lastOutcome = it.last_touch_type ? ('last: ' + esc(it.last_touch_type) + (it.last_touch_at ? ' ' + new Date(it.last_touch_at).toLocaleDateString() : '')) : 'never touched';
    var ctx = [esc(it.phase || '—'), 'touch ' + esc(String(it.current_touch != null ? it.current_touch : 0)),
               esc(dueLbl), lastOutcome];
    if (stats.length) ctx.push(stats.join(', '));
    // R34 Unit 2: lead with relationship value (the dashboard is value-ranked).
    var valStr = _dcMoney(it.rank_value);
    if (valStr) {
      var pc = Number(it.rank_property_count);
      ctx.unshift(valStr + (isFinite(pc) && pc > 0 ? ' (' + pc + ' propert' + (pc === 1 ? 'y' : 'ies') + ')' : ''));
    } else if (it.total_property_count) {
      ctx.push(esc(String(it.total_property_count)) + ' props');
    }
    var tmpl = it.next_touch_template ? String(it.next_touch_template) : '';
    var action;
    if (isEmail && cid && eid && tmpl) {
      action = '<button class="q-action primary" onclick="cadDraft(' + jsStringArg(cid) + ',' + jsStringArg(eid)
        + ',' + jsStringArg(tmpl) + ',' + jsStringArg(it.entity_name || '') + ',' + jsStringArg(it.domain || '')
        + ',' + jsStringArg(it.contact_email || '') + ', this)">Draft email →</button>';
    } else if (cid && eid) {
      action = '<button class="q-action primary" onclick="cadLogTouch(' + jsStringArg(cid) + ',' + jsStringArg(eid)
        + ',' + jsStringArg(nt || 'call') + ', this)">Log touch →</button>';
    } else {
      action = '<span class="q-badge">no cadence id</span>';
    }
    // R34 Unit 3: surface the >90d-overdue staleness guard so a row can't
    // silently rot into another 1,314-day cadence (review / re-pace / expire).
    var reviewBadge = it.review_flag ? '<span class="q-badge pri-high" title="Active cadence > 90 days overdue — review, re-pace, or pause">⚠ review</span>' : '';
    html += '<div class="q-item' + (ix === 0 ? ' pq-hero' : '') + '" data-cad-id="' + esc(cid) + '">'
      + '<div class="q-item-header"><span class="q-item-title">' + esc(it.entity_name || 'Cadence') + '</span>'
      + '<div class="q-item-badges">' + reviewBadge + '<span class="q-badge">' + esc(it.next_touch_type || 'email') + '</span></div></div>'
      + '<div class="q-item-meta">' + esc(ctx.join(' · ')) + '</div>'
      + '<div class="q-actions">' + action + '</div></div>';
  });
  el.innerHTML = html;
}
window.renderCadenceDashboard = renderCadenceDashboard;

// ============================================================================
// R55 Unit 2 — Top BD actions: the one unified, value-ranked BD worklist.
// Merges loan_maturity / suspected_sale / owner_source_conflict / contact_writeback
// / ownership_chain into one list, highest $ value first. Each row routes to the
// property (or the Decision Center lane) for the actual action.
// ============================================================================
var _bdSignalLabel = {
  loan_maturity: 'Loan maturity',
  suspected_sale: 'Suspected sale',
  owner_source_conflict: 'Owner conflict',
  contact_writeback: 'Push to CRM',
  ownership_chain: 'Ownership chain',
};
async function renderBdWorklist(type) {
  var el = document.getElementById('priorityQueueContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  var qs = '/api/operations?action=bd_worklist&limit=100' + (type ? '&type=' + encodeURIComponent(type) : '');
  var res = await opsApi(qs);
  if (!res.ok || !res.data || !res.data.ok) {
    el.innerHTML = opsErrorState(res, 'renderBdWorklist()', 'Could not load the BD worklist');
    return;
  }
  var items = Array.isArray(res.data.worklist) ? res.data.worklist : [];
  var html = '<div class="ops-header"><h2>Top BD Actions</h2>'
    + '<button class="q-action" onclick="renderPriorityQueuePage(window._pqCurrentBand || undefined)">← Back to queue</button></div>';
  html += '<div class="rc-intro">One unified worklist across every BD signal — loan maturities, suspected sales, owner conflicts, contacts to push, and ownership chains — ranked highest $ value first. Work it top-down; each row routes to where you take the action.</div>';
  // signal-type filter chips
  var chips = ['', 'loan_maturity', 'suspected_sale', 'owner_source_conflict', 'contact_writeback', 'ownership_chain'];
  html += '<div class="pq-chips">' + chips.map(function (c) {
    var active = (type || '') === c ? ' active' : '';
    return '<button class="pq-chip' + active + '" onclick="renderBdWorklist(' + (c ? jsStringArg(c) : '') + ')">'
      + (c ? esc(_bdSignalLabel[c] || c) : 'All') + '</button>';
  }).join('') + '</div>';
  if (!items.length) { html += '<div class="ops-empty">No BD actions in this view. ✓</div>'; el.innerHTML = html; return; }
  window._bdWorklistItems = items; // R59 Unit 1 — index-based open carries the signal
  var _bdRows = [];
  items.forEach(function (it, ix) {
    var val = _dcMoney(it.rank_value);
    var dom = String(it.domain || '');
    var pid = it.property_id == null ? '' : String(it.property_id);
    var meta = [];
    if (val) meta.push(val + ' rent');
    if (dom) meta.push(dom);
    if (it.who) meta.push(esc(it.who));
    if (it.city || it.state) meta.push(esc([it.city, it.state].filter(Boolean).join(', ')));
    var dl = it.deep_link || {};
    var action;
    if (pid && dom && (dl.surface === 'property' || dl.surface === 'decision_center')) {
      // Open the property AND carry the signal so the detail's NEXT STEP becomes
      // the signal's action (R59 Unit 1) — not the generic "Create the lead".
      action = '<button class="q-action primary" onclick="bdOpenWorklistItem(' + ix + ')">Open property →</button>';
    } else if (dl.surface === 'decision_center') {
      action = '<button class="q-action primary" onclick="renderReviewConsolePage()">Open in Decision Center →</button>';
    } else {
      action = '<span class="q-badge">' + esc(_bdSignalLabel[it.signal_type] || it.signal_type) + '</span>';
    }
    var lane = (dl.surface === 'decision_center')
      ? '<button class="q-action" onclick="renderReviewConsolePage()">Decision Center →</button>' : '';
    _bdRows.push('<div class="q-item' + (ix === 0 ? ' pq-hero' : '') + '">'
      + '<div class="q-item-header"><span class="q-item-title">' + esc(it.what || '—') + '</span>'
      + '<div class="q-item-badges"><span class="q-badge type">' + esc(_bdSignalLabel[it.signal_type] || it.signal_type) + '</span>'
      + (it.is_distressed ? '<span class="q-badge pri-high" title="Distressed loan">⚠ distressed</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc(meta.join(' · ')) + '</div>'
      + '<div class="q-actions">' + action + lane + '</div></div>');
  });
  html += opsPagedRows('bd', _bdRows);
  el.innerHTML = html;
}
window.renderBdWorklist = renderBdWorklist;

// R59 Unit 1 — open a worklist row's property, carrying the BD signal forward as
// a route hint so the detail's NEXT STEP leads with the signal's action. The
// detail re-fetches the authoritative signal regardless, so this is an instant
// hint, not the source of truth.
function bdOpenWorklistItem(ix) {
  var it = (window._bdWorklistItems || [])[ix];
  if (!it || typeof openUnifiedDetail !== 'function') return;
  var dom = String(it.domain || '');
  var pid = it.property_id == null ? '' : String(it.property_id);
  if (!dom || !pid) return;
  var hint = { type: it.signal_type, context: Object.assign({}, it.detail || {}, { owner_name: it.who || null }) };
  openUnifiedDetail(dom, { property_id: pid }, { _bdSignal: hint }, 'Ownership & CRM');
}
window.bdOpenWorklistItem = bdOpenWorklistItem;

// ============================================================================
// NBT #1 Slice 1c — Next best touchpoint surface
//
// Points the operator at v_next_best_touchpoint: Scott's real SF book ∪ open
// BD-opp accounts, value-ranked by rank_value, each row showing its state-aware
// next_action. The honest truth grounded live: ~98% of the valued book is
// CONTACTLESS, so most rows route to "Acquire contact" — not a dead row, the
// real next step. Rows render as .q-item cards so the EXISTING contact-pick
// pickers (pqSelectProspectingContact / pqSelectBuyerContact) attach inline.
// ============================================================================
async function renderNextBestTouchpoint() {
  var el = document.getElementById('priorityQueueContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  var res = await opsApi('/api/operations?action=next_best_touchpoint&limit=200');
  if (!res.ok || !res.data || !res.data.ok) {
    el.innerHTML = opsErrorState(res, 'renderNextBestTouchpoint()', 'Could not load next best touchpoint');
    return;
  }
  var items = Array.isArray(res.data.items) ? res.data.items : [];
  var total = res.data.total != null ? res.data.total : items.length;
  var html = '<div class="ops-header"><h2>Next Best Touchpoint</h2>'
    + '<button class="q-action" onclick="renderPriorityQueuePage(window._pqCurrentBand || undefined)">← Back to queue</button></div>';
  html += '<div class="rc-intro">Your real Salesforce book ∪ open opportunities, value-ranked. '
    + 'Each row shows its next step: <b>acquire the contact</b> (most of the book is contactless — that is the real bottleneck), '
    + 'open a <b>buy-side</b> relationship, or <b>work the cadence</b>.</div>';
  if (!items.length) { html += '<div class="ops-empty">No accounts. ✓</div>'; el.innerHTML = html; return; }
  html += '<div class="q-item-meta" style="margin:6px 0">' + esc(String(total)) + ' account' + (total === 1 ? '' : 's') + ', highest value first</div>';
  items.forEach(function (it, ix) {
    var eid = it.entity_id == null ? '' : String(it.entity_id);
    var nm = it.name || 'Account';
    var na = String(it.next_action || 'acquire_contact');
    var ctx = [];
    var valStr = _dcMoney(it.rank_value);
    if (valStr) {
      var pc = Number(it.rank_property_count);
      ctx.push(valStr + (isFinite(pc) && pc > 0 ? ' (' + pc + ' propert' + (pc === 1 ? 'y' : 'ies') + ')' : ''));
    }
    if (it.priority_band) ctx.push('band ' + esc(String(it.priority_band)));
    if (it.has_open_opportunity) ctx.push('open opportunity');
    var dst = Number(it.days_since_touch);
    ctx.push(it.last_touch_at && isFinite(dst) ? esc(String(dst)) + 'd since last touch' : 'never contacted');
    var naLabel = { open_buy_side: 'buy-side', cadence_touch: 'cadence', acquire_contact: 'acquire contact' }[na] || na;
    var action;
    if (!eid) {
      action = '<span class="q-badge">no entity</span>';
    } else if (na === 'open_buy_side') {
      action = '<button class="q-action primary" onclick="pqSelectBuyerContact(' + jsStringArg(eid) + ', \'\', ' + jsStringArg(nm) + ', this)">Open buy-side →</button>';
    } else if (na === 'cadence_touch') {
      action = '<button class="q-action primary" onclick="renderCadenceDashboard()">Work cadence →</button>';
    } else {
      // acquire_contact (the dominant state) — the existing contact-pick path.
      action = '<button class="q-action primary" onclick="pqSelectProspectingContact(' + jsStringArg(eid) + ', ' + jsStringArg(nm) + ', this)">Acquire contact →</button>';
    }
    html += '<div class="q-item' + (ix === 0 ? ' pq-hero' : '') + '" data-entity-id="' + esc(eid) + '">'
      + '<div class="q-item-header"><span class="q-item-title">' + esc(nm) + '</span>'
      + '<div class="q-item-badges"><span class="q-badge">' + esc(naLabel) + '</span></div></div>'
      + '<div class="q-item-meta">' + esc(ctx.join(' · ')) + '</div>'
      + '<div class="q-actions">' + action + '</div></div>';
  });
  el.innerHTML = html;
}
window.renderNextBestTouchpoint = renderNextBestTouchpoint;

// ============================================================================
// R28 Unit 2 — Contact-qualify worklist (activate captured contacts)
// Lists the value-ranked v_lcc_contact_qualify_worklist (junk excluded, persons-
// with-email first). "Qualify →" links the captured person to the property's
// owner and stamps a contactless cadence, feeding the outreach engine, then the
// row leaves the pile.
// ============================================================================
async function renderContactQualifyWorklist() {
  var el = document.getElementById('priorityQueueContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  var res = await opsApi('/api/operations?action=contact_qualify_worklist&limit=50');
  if (!res.ok || !res.data || !res.data.ok) {
    el.innerHTML = opsErrorState(res, 'renderContactQualifyWorklist()', 'Could not load the contact-qualify worklist');
    return;
  }
  var items = Array.isArray(res.data.items) ? res.data.items : [];
  var total = res.data.total != null ? res.data.total : items.length;
  var html = '<div class="ops-header"><h2>Qualify Captured Contacts</h2>'
    + '<button class="q-action" onclick="renderPriorityQueuePage(window._pqCurrentBand || undefined)">← Back to queue</button></div>';
  html += '<div class="rc-intro">Real captured contacts waiting to be activated. Highest-value first (by the property they were captured on). '
    + 'Qualifying links the contact to the property owner and feeds it to a cadence that lacked a recipient.</div>';
  if (!items.length) { html += '<div class="ops-empty">No contacts to qualify. ✓</div>'; el.innerHTML = html; return; }
  // R59 Unit 3 — bulk auto-qualify the high-confidence subset (real email +
  // plausible person name) in one pass; the ambiguous remainder stays per-item.
  var hiConf = items.filter(function (x) { return x && x.has_email; }).length;
  html += '<div class="triage-bar" style="margin:6px 0">'
    + '<span class="q-item-meta">' + esc(String(total)) + ' contact' + (total === 1 ? '' : 's') + ' to qualify</span>'
    + '<div class="triage-actions"><button class="q-action primary" id="bulkQualifyBtn" onclick="bulkQualifyContacts(this)" title="Auto-qualify every contact that has a real email + plausible person name">⚡ Auto-qualify high-confidence' + (hiConf ? ' (' + hiConf + '+)' : '') + ' →</button></div>'
    + '</div>';
  items.forEach(function (it, ix) {
    var iid = it.inbox_item_id == null ? '' : String(it.inbox_item_id);
    var ctx = [];
    if (it.role) ctx.push(esc(it.role));
    if (it.contact_company) ctx.push(esc(it.contact_company));
    if (it.contact_email) ctx.push(esc(it.contact_email));
    else ctx.push('no email');
    if (it.rank_value != null) {
      var v = Number(it.rank_value);
      if (isFinite(v) && v > 0) ctx.push('$' + Math.round(v).toLocaleString() + ' property' + (it.source_domain ? ' (' + esc(it.source_domain) + ')' : ''));
    }
    var action = iid
      ? '<button class="q-action primary" onclick="qualifyContact(' + jsStringArg(iid) + ', this)">Qualify →</button>'
      : '<span class="q-badge">no id</span>';
    html += '<div class="q-item' + (ix === 0 ? ' pq-hero' : '') + '" data-inbox-id="' + esc(iid) + '">'
      + '<div class="q-item-header"><span class="q-item-title">' + esc(it.contact_name || 'Contact') + '</span>'
      + '<div class="q-item-badges">' + (it.has_email ? '<span class="q-badge">email</span>' : '') + '</div></div>'
      + '<div class="q-item-meta">' + esc(ctx.join(' · ')) + '</div>'
      + '<div class="q-actions">' + action + '</div></div>';
  });
  el.innerHTML = html;
}
window.renderContactQualifyWorklist = renderContactQualifyWorklist;

// Qualify one captured contact → link to owner + stamp a contactless cadence.
async function qualifyContact(inboxItemId, btn) {
  var card = (btn && btn.closest) ? btn.closest('.q-item') : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Qualifying…'; }
  var res = await opsPost('/api/operations?action=qualify_contact', { inbox_item_id: inboxItemId });
  if (!res.ok || !res.data || !res.data.ok) {
    showToast('Could not qualify: ' + ((res.data && res.data.error) || res.error || 'unknown'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Qualify →'; }
    return;
  }
  var d = res.data;
  var msg = '✓ Qualified';
  if (d.cadence_stamped) {
    msg += d.cadence_stamped.target === 'owner' ? ' — stamped onto the owner’s cadence' : ' — stamped as its own cadence contact';
  } else if (d.linked) {
    msg += ' — linked to the owner';
  }
  if (card) {
    var act = card.querySelector('.q-actions');
    if (act) act.innerHTML = '<span class="q-badge success">' + esc(msg) + '</span>';
    card.classList.add('q-item-resolved');
  }
  showToast(msg, 'success');
}
window.qualifyContact = qualifyContact;

// R59 Unit 3 — bulk-drain the high-confidence captured contacts in one pass.
async function bulkQualifyContacts(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Qualifying…'; }
  var res = await opsPost('/api/operations?action=qualify_contacts_bulk', { limit: 100 });
  if (!res.ok || !res.data || !res.data.ok) {
    showToast('Bulk qualify failed: ' + ((res.data && res.data.error) || res.error || 'unknown'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Auto-qualify high-confidence →'; }
    return;
  }
  var d = res.data;
  showToast('Qualified ' + d.qualified + (d.failed ? ' (' + d.failed + ' failed)' : '')
    + (d.remaining ? ' · ' + d.remaining + ' more remain' : ''), 'success');
  renderContactQualifyWorklist();
}
window.bulkQualifyContacts = bulkQualifyContacts;

// Generate the next-touch email inline (no sending — copy / mailto / mark sent).
async function cadDraft(cadenceId, entityId, templateId, name, domain, contactEmail, btn) {
  var card = (btn && btn.closest) ? btn.closest('.q-item') : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Drafting…'; }
  var body = {
    template_id: templateId,
    context: { contact: { name: name || '' }, domain: domain || '' },
    cadence_ids: { entity_id: entityId },
    strict: false
  };
  var res = await opsPost('/api/operations?_route=draft&action=generate', body);
  if (!res.ok || !res.data || !res.data.ok) {
    showToast('Could not generate draft: ' + ((res.data && res.data.error) || res.error || 'unknown'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Draft email →'; }
    return;
  }
  var subject = res.data.subject || res.data.rendered_subject || '';
  var bodyText = res.data.body || res.data.rendered_body || res.data.text || '';
  if (!card) { showToast('Draft ready (no card to render into)', 'info'); return; }
  var host = card.querySelector('.cad-draft');
  if (!host) { host = document.createElement('div'); host.className = 'cad-draft'; card.appendChild(host); }
  // Stash the rendered draft on the card for record_send + edit capture.
  card._cadDraft = { templateId: templateId, entityId: entityId, domain: domain || '', subject: subject, body: bodyText };
  // R20: resolve the recipient from the cadence's contact entity (= the person,
  // incl. a person who is their own contact). Falls back to an empty to: when
  // the contact carries no email (phone-only persons / unresolved contacts).
  var to = (contactEmail || '').trim();
  var mailto = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(bodyText);
  var recipientLine = to
    ? '<div class="cad-draft-to"><b>To:</b> ' + esc(to) + '</div>'
    : '<div class="cad-draft-to q-item-meta">No recipient email on file — add a "To:" in your mail client.</div>';
  host.innerHTML = recipientLine
    + '<div class="cad-draft-subj"><b>Subject:</b> ' + esc(subject) + '</div>'
    + '<textarea class="cad-draft-body" rows="8" style="width:100%;margin:6px 0">' + esc(bodyText) + '</textarea>'
    + '<div class="q-actions">'
    + '<button class="q-action" onclick="cadCopyDraft(this)">Copy</button>'
    + '<a class="q-action" href="' + esc(mailto) + '" target="_blank" rel="noopener">Open in mail</a>'
    + '<button class="q-action primary" onclick="cadMarkSent(' + jsStringArg(String(cadenceId)) + ', this)">Mark sent →</button>'
    + '</div>';
  if (btn) { btn.disabled = false; btn.textContent = 'Re-draft'; }
}
window.cadDraft = cadDraft;

function cadCopyDraft(btn) {
  var card = btn.closest('.q-item');
  var ta = card ? card.querySelector('.cad-draft-body') : null;
  var d = card ? card._cadDraft : null;
  var text = (d ? (d.subject ? d.subject + '\n\n' : '') : '') + (ta ? ta.value : '');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast('Draft copied', 'success'); });
    } else if (ta) { ta.select(); document.execCommand('copy'); showToast('Draft copied', 'success'); }
  } catch (e) { showToast('Copy failed: ' + e.message, 'error'); }
}
window.cadCopyDraft = cadCopyDraft;

// Mark sent → record_send (which advances via the Unit-1 single advance path).
async function cadMarkSent(cadenceId, btn) {
  var card = btn.closest('.q-item');
  var d = card ? card._cadDraft : null;
  if (!d) { showToast('No draft to record', 'error'); return; }
  var ta = card ? card.querySelector('.cad-draft-body') : null;
  var finalBody = ta ? ta.value : d.body;
  if (btn) { btn.disabled = true; btn.textContent = 'Recording…'; }
  var res = await opsPost('/api/operations?_route=draft&action=record_send', {
    template_id: d.templateId, entity_id: d.entityId, domain: d.domain || null,
    cadence_id: cadenceId,
    rendered_subject: d.subject, rendered_body: d.body,
    final_subject: d.subject, final_body: finalBody,
    original_draft: d.body, sent_text: finalBody
  });
  if (res.ok && res.data) {
    var advanced = res.data.cadence_advanced;
    var host = card ? card.querySelector('.cad-draft') : null; if (host) host.remove();
    var actions = card ? card.querySelector('.q-actions') : null;
    if (actions) actions.innerHTML = '<span class="q-badge">✓ Sent & recorded' + (advanced ? ' — cadence advanced' : '') + '</span>';
    if (card) card.classList.add('resolved');
    showToast(advanced ? 'Sent — cadence advanced' : 'Sent & recorded', 'success');
  } else {
    showToast('Could not record send: ' + ((res.data && res.data.error) || res.error || 'unknown'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Mark sent →'; }
  }
}
window.cadMarkSent = cadMarkSent;

// Log a non-email touch from the dashboard — routes through the Unit-1 advance
// endpoint (single advance owner), so the cadence advances + reschedules.
async function cadLogTouch(cadenceId, entityId, touchType, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Logging…'; }
  var res = await opsPost('/api/operations?action=advance_cadence', {
    cadence_id: cadenceId, entity_id: entityId, type: touchType || 'call', outcome: 'logged_from_cadence_dashboard'
  });
  if (res.ok && res.data && (res.data.ok || res.data.next_touch_due)) {
    var card = btn ? btn.closest('.q-item') : null;
    var actions = card ? card.querySelector('.q-actions') : null;
    if (actions) actions.innerHTML = '<span class="q-badge">✓ Touch logged — cadence advanced</span>';
    if (card) card.classList.add('resolved');
    showToast('Touch logged', 'success');
  } else {
    showToast('Could not log touch: ' + ((res.data && res.data.error) || res.error || 'unknown'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Log touch →'; }
  }
}
window.cadLogTouch = cadLogTouch;

// Tier 3 Phase 2: deep-link from the read-only Data Quality dashboard into the
// relevant Decision Center lane. Navigates to the Decision Center, then runs the
// lane renderer once the page is shown.
function dqDeepLink(fnName, arg) {
  if (typeof navTo === 'function') navTo('pageReviewConsole');
  setTimeout(function () { if (typeof window[fnName] === 'function') window[fnName](arg); }, 180);
}
window.dqDeepLink = dqDeepLink;

async function renderDataQualityPage() {
  const el = document.getElementById('dataQualityContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:data_quality');

  const [summaryRes, detailRes, decR] = await Promise.all([
    opsApi('/api/entities?action=quality'),
    opsApi('/api/entities?action=quality_details'),
    opsApi('/api/decisions?summary=1')   // unified review-work counts (same source as Decision Center)
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
  // Tier 3 Phase 2: Data Quality is a read-only HEALTH DASHBOARD. Every work
  // item resolves in the Decision Center — the cards below deep-link there.
  html += '<div class="rc-intro">Read-only health dashboard. Metrics and coverage live here; the actual review work — merges, links, precedence, follow-ups — is worked in the <button class="dq-deeplink" onclick="navTo(\'pageReviewConsole\')">Decision Center →</button>.</div>';

  // B8 (2026-05-27): Domain Health Summary tile — hydrated async below.
  // Renders side-by-side dia/gov values + 30-day sparklines for the
  // sales / ownership / entities / SF-link metrics that the last 7
  // rounds of back-end remediation have been moving.
  html += '<div id="domainHealthSummary"><div class="widget"><div class="widget-title">Domain Health Summary</div><div class="loading"><span class="spinner"></span></div></div></div>';

  html += '<div class="metrics-grid">';
  html += metricCardHTML('Unlinked', summary.unlinked || 0, 'entities needing links', (summary.unlinked || 0) > 0 ? 'yellow' : 'green');
  html += metricCardHTML('Stale Links', summary.stale_identities || 0, '7+ days old', (summary.stale_identities || 0) > 0 ? 'yellow' : 'green');
  html += metricCardHTML('Orphaned Actions', summary.orphaned_actions || 0, 'entity missing', (summary.orphaned_actions || 0) > 0 ? 'red' : 'green');
  html += metricCardHTML('Aliases', summary.total_aliases || 0, 'dedup coverage');
  html += '</div>';

  // Unified review-work counts — read from /api/decisions?summary=1, the SAME
  // source the Decision Center and nav badge use, so the three never diverge.
  if (decR.ok && decR.data && Array.isArray(decR.data.lanes)) {
    const groups = (typeof rollupLaneCounts === 'function')
      ? rollupLaneCounts(decR.data.lanes.map(function (l) { return { decision_type: l.decision_type, n: l.n }; }))
      : [];
    const totalOpen = Number(decR.data.total) || 0;
    html += '<div class="widget"><div class="widget-title">Review work — Decision Center'
      + ' <span class="rc-handled">' + totalOpen + ' open</span></div>';
    if (groups.length) {
      html += '<div class="rc-sublanes">';
      groups.forEach(function (g) {
        if (!g.n) return;
        html += '<button class="rc-sublane has-work" onclick="dqDeepLink(\'renderReviewConsolePage\')" title="'
          + esc(g.question) + '"><span class="rc-sublane-label">' + esc(g.title)
          + '</span><span class="rc-sublane-n">' + g.n + '</span></button>';
      });
      html += '</div>';
    }
    html += '<div class="dq-readonly-note">Counts match the Decision Center exactly (same source view). Click a lane to work it there.</div></div>';
  }

  // QA-12 (2026-05-18): Title-case the cluster label, and suppress clusters
  // where the canonical name is missing AND the member names look like state
  // abbreviations or other parse-failure debris (e.g. "Unnamed · CO · CO · CO").
  const _qaTitleCase = (s) => String(s || '')
    .replace(/\b([a-z])([a-z]*)/gi, (_, a, b) => a.toUpperCase() + b.toLowerCase());
  const _qaIsParseDebris = (members) => {
    const m = Array.isArray(members) ? members : [];
    if (m.length === 0) return false;
    // All entries are 2-letter state-ish strings — almost certainly debris.
    return m.every(x => x && /^[A-Z]{2}$/.test(String(x).trim()));
  };
  const _qaFilteredDupes = (detail.duplicate_candidates || []).filter(item => {
    const hasName = item.canonical_name && String(item.canonical_name).trim().length > 0;
    if (!hasName && _qaIsParseDebris(item.entity_names)) return false;
    return true;
  });
  const sections = [
    { title: 'Duplicate Candidates', items: _qaFilteredDupes, render: item => `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(_qaTitleCase(item.canonical_name || '') || 'Unnamed')}</span><div class="q-item-badges"><span class="q-badge pri-high">${item.duplicate_count || item.count || 0} matches</span></div></div><div class="q-item-meta">${(item.entity_names || []).map(esc).join(' · ')}</div><div class="q-actions"><button class="dq-deeplink" onclick="dqDeepLink('renderFederatedLane','merge_duplicate_entities')">Merge in Decision Center → Duplicate entities →</button></div></div>` },
    { title: 'Unlinked Entities', items: detail.unlinked_entities || [], render: item => `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(item.name)}</span><div class="q-item-badges">${item.entity_type ? typeBadge(item.entity_type) : ''}${item.domain ? domainBadge(item.domain) : ''}</div></div><div class="q-item-meta">${esc([item.city, item.state].filter(Boolean).join(', '))}</div><div class="q-actions"><button class="dq-deeplink" onclick="navTo('pageEntities')">Link in Entities →</button></div></div>` },
    { title: 'Stale Identities', items: detail.stale_identities || [], render: item => `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(item.entity_name || item.external_id)}</span><div class="q-item-badges">${item.source_system ? typeBadge(item.source_system) : ''}</div></div><div class="q-item-meta">${freshnessHTML(item.last_synced_at)}</div><div class="q-actions"><button class="dq-deeplink" onclick="dqDeepLink('renderFederatedLane','provenance_conflict')">Resolve in Decision Center → Data conflicts →</button></div></div>` },
    { title: 'Low Completeness', items: detail.low_completeness || [], render: item => `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(item.name)}</span><div class="q-item-badges"><span class="q-badge pri-high">${item.completeness_score || 0}% complete</span></div></div><div class="q-item-meta">${item.entity_type ? typeBadge(item.entity_type) : ''}${item.domain ? domainBadge(item.domain) : ''}</div><div class="q-actions"><button class="dq-deeplink" onclick="navTo('pageEntities')">Enrich in Entities →</button></div></div>` },
    { title: 'Orphaned Actions', items: detail.orphaned_actions || [], render: item => `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(item.title)}</span><div class="q-item-badges">${statusBadge(item.status)}${item.domain ? domainBadge(item.domain) : ''}</div></div><div class="q-actions"><button class="dq-deeplink" onclick="navTo('pageTeamQueue')">Review in Team Queue →</button></div></div>` }
  ];

  html += '<div class="widget"><div class="widget-title">Source Precedence</div>';
  html += `<div class="q-item"><div class="q-item-meta">Field-source precedence is set when you resolve a provenance conflict.</div><div class="q-actions"><button class="dq-deeplink" onclick="dqDeepLink('renderFederatedLane','provenance_conflict')">Resolve conflicts in Decision Center →</button></div></div>`;
  if (!precedenceRows.length) {
    html += '<div class="ops-empty">No overrides configured</div>';
  } else {
    precedenceRows.slice(0, 10).forEach(row => {
      html += `<div class="q-item"><div class="q-item-header"><span class="q-item-title">${esc(row.field_name || '*')}</span><div class="q-item-badges"><span class="q-badge pri-high">${Number(row.precedence || 0)}</span></div></div><div class="q-item-meta">${esc(row.source_system || 'unknown')}</div></div>`;
    });
  }
  html += '</div>';

  sections.forEach(section => {
    html += `<div class="widget"><div class="widget-title">${section.title}</div>`;
    if (!section.items.length) html += '<div class="ops-empty">No current issues</div>';
    else section.items.slice(0, 10).forEach(item => { html += section.render(item); });
    html += '</div>';
  });

  // ── Domain DB data quality (dialysis v_data_quality_*) ───────────────────
  // Anchor element rendered immediately so the page paints; the dia data
  // quality widget hydrates asynchronously via diaQuery (loaded by
  // dialysis.js as a global).
  html += '<div id="diaDataQualityWidgets"><div class="widget"><div class="widget-title">Domain Data Quality (dialysis)</div><div class="loading"><span class="spinner"></span></div></div></div>';

  // ── Domain DB data quality (government v_data_quality_*) ─────────────────
  html += '<div id="govDataQualityWidgets"><div class="widget"><div class="widget-title">Domain Data Quality (government)</div><div class="loading"><span class="spinner"></span></div></div></div>';

  // ── Ops DB data quality (LCC ops v_data_quality_*) — multi-tenant, scoped
  //    to the active workspace. Sources from /api/queue?view=data_quality.
  html += '<div id="opsDataQualityWidgets"><div class="widget"><div class="widget-title">Ops Data Quality</div><div class="loading"><span class="spinner"></span></div></div></div>';

  // ── Provenance conflicts (Phase 3 enforce-mode panel) ────────────────────
  // Hits /api/entities?action=quality_provenance which surfaces
  // v_field_provenance_actionable. Also lazy-loaded.
  html += '<div id="provenanceConflictWidgets"><div class="widget"><div class="widget-title">Provenance Conflicts</div><div class="loading"><span class="spinner"></span></div></div></div>';

  el.innerHTML = html;
  perf.end();

  // B8: Hydrate the Domain Health Summary tile.
  if (typeof renderDomainHealthSummary === 'function') {
    renderDomainHealthSummary().catch(err => {
      console.error('[renderDomainHealthSummary] failed:', err);
    });
  }
  // Hydrate the dia data quality widget out-of-band.
  if (typeof renderDiaDataQualityWidgets === 'function') {
    renderDiaDataQualityWidgets().catch(err => {
      console.error('[renderDiaDataQualityWidgets] failed:', err);
    });
  }
  // Hydrate the gov data quality widget out-of-band.
  if (typeof renderGovDataQualityWidgets === 'function') {
    renderGovDataQualityWidgets().catch(err => {
      console.error('[renderGovDataQualityWidgets] failed:', err);
    });
  }
  // Hydrate the ops DB data quality widget out-of-band.
  if (typeof renderOpsDataQualityWidgets === 'function') {
    renderOpsDataQualityWidgets().catch(err => {
      console.error('[renderOpsDataQualityWidgets] failed:', err);
    });
  }
  // Hydrate the provenance conflicts widget too.
  if (typeof renderProvenanceConflictWidgets === 'function') {
    renderProvenanceConflictWidgets().catch(err => {
      console.error('[renderProvenanceConflictWidgets] failed:', err);
    });
  }
}

// ─── Provenance Review Queue (Phase 4 Tier A) ─────────────────────────────
// Surfaces v_field_provenance_review_queue rows for human resolution, plus
// the legacy "unranked fields" surface. Replaces the older read-only
// conflicts panel: each row has Keep current / Use incoming / Defer / Junk
// / Custom buttons that call POST /api/entities?action=resolve_provenance_conflict.
// Buckets default to the 212 actionable items (still_tied +
// conflicting_source_now_wins); warn/strict skip rows are accessible via
// the chip filter but not surfaced first.
const _provDefaultBuckets = new Set(['still_tied','conflicting_source_now_wins','current_source_now_wins']);
let _provBucket = 'actionable';  // 'actionable' (the default set) | 'all' | <bucket_name>

async function renderProvenanceConflictWidgets() {
  const host = document.getElementById('provenanceConflictWidgets');
  if (!host) return;

  // Pull both surfaces in parallel: the new review queue + the legacy
  // unranked-fields summary (still useful as a schema-drift indicator).
  const [queueRes, legacyRes] = await Promise.all([
    opsApi('/api/entities?action=quality_provenance_review_queue&limit=200'),
    opsApi('/api/entities?action=quality_provenance&limit=1'),  // only need .unranked
  ]);

  if (!queueRes.ok) {
    host.innerHTML = `<div class="widget"><div class="widget-title">Provenance Review Queue</div><div class="ops-empty">Could not load review queue.<br><small>${esc(queueRes.error)}</small></div></div>`;
    return;
  }
  const rows           = queueRes.data?.rows || [];
  const bucket_counts  = queueRes.data?.bucket_counts || {};
  const unranked       = legacyRes.data?.unranked || [];

  // Compute the "actionable" total (the buckets that need human action)
  const actionableTotal = (bucket_counts.still_tied || 0)
    + (bucket_counts.conflicting_source_now_wins || 0)
    + (bucket_counts.current_source_now_wins || 0);
  const allTotal = Object.values(bucket_counts).reduce((a,b) => a+b, 0);

  // Filter the loaded rows by the active bucket selector
  let filtered;
  if (_provBucket === 'actionable') {
    filtered = rows.filter(r => _provDefaultBuckets.has(r.bucket));
  } else if (_provBucket === 'all') {
    filtered = rows;
  } else {
    filtered = rows.filter(r => r.bucket === _provBucket);
  }

  let html = '<div class="widget"><div class="widget-title">Provenance Review Queue ' +
    '<span style="font-size:12px;color:var(--text2);font-weight:400;margin-left:8px">' +
    'Pick a winner for each open conflict — the change is written to the live dia/gov DB and recorded in field_provenance_resolutions.</span></div>';

  if (allTotal === 0) {
    html += '<div class="ops-empty" style="color:var(--green)">Nothing to review. No open conflicts or warn/strict skips.</div>';
    html += '</div>';
    host.innerHTML = html;
    return;
  }

  // Bucket-filter chips. Default (Actionable) covers the 212 conflicts the
  // R4 round opened; the other chips surface the warn/strict skip set
  // and any unranked-either-side rows so they're still findable.
  const chip = (key, label, count, tone) =>
    `<button class="ops-filter ${_provBucket === key ? 'active' : ''}" onclick="_provBucket='${key}';renderProvenanceConflictWidgets()">${label}${count != null ? ' ('+count+')' : ''}</button>`;
  // Warn/strict skip rows moved to a separate surface (Tier B). The actionable
  // conflict buckets are what the queue is for; skip events are observation,
  // not action, and were tanking the query (10k-row PostgREST scan).
  html += '<div class="ops-filters" style="margin-bottom:12px">';
  html += chip('actionable',  'Actionable',  actionableTotal);
  html += chip('still_tied',  'Still tied',  bucket_counts.still_tied);
  html += chip('conflicting_source_now_wins', 'Needs backfill', bucket_counts.conflicting_source_now_wins);
  html += chip('current_source_now_wins',    'Keep current OK', bucket_counts.current_source_now_wins);
  html += chip('all',         'All',          allTotal);
  html += '</div>';

  // Hint when on default
  if (_provBucket === 'actionable' && actionableTotal === 0) {
    html += '<div class="ops-empty" style="color:var(--green)">All actionable items resolved. Switch chips above to inspect warn/strict skip rows.</div>';
  }

  const truncate = (v) => {
    if (v == null) return '—';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
  };

  for (const r of filtered.slice(0, 50)) {
    const ago = freshnessHTML(r.recorded_at);
    const decisionBadge = r.decision === 'conflict' ? 'pri-high' : (r.attempted_enforce_mode === 'strict' ? 'pri-high' : 'pri-med');
    const bucketBadge = r.bucket === 'still_tied' ? 'pri-high'
                     : r.bucket === 'conflicting_source_now_wins' ? 'pri-med'
                     : '';

    // Per-row actions. The data-pid attribute is the field_provenance row id
    // (the "attempted" side); the resolver always references that and looks
    // up the current side server-side.
    const pid = Number(r.provenance_id);
    const hasCurrent = r.current_provenance_id != null;
    const actions = [
      hasCurrent ? `<button class="ops-filter" onclick="resolveProvConflict(${pid},'current',null,this)">Keep current</button>` : '',
      `<button class="ops-filter" onclick="resolveProvConflict(${pid},'attempted',null,this)">Use incoming</button>`,
      `<button class="ops-filter" onclick="resolveProvConflictCustom(${pid},this)">Custom…</button>`,
      `<button class="ops-filter" onclick="resolveProvConflict(${pid},'defer',null,this)">Defer 7d</button>`,
      `<button class="ops-filter" onclick="resolveProvConflict(${pid},'junk',null,this)">Mark junk</button>`,
    ].filter(Boolean).join('');

    // Entity-context line: address / tenant / file_name attached by
    // enrichReviewQueueContext on the API side. Renders directly under
    // the field title so the reviewer sees what record this is about
    // before reading attempted/current values.
    const ctx = r.record_context;
    const ctxHtml = ctx
      ? `<div class="q-item-context" style="font-size:13px;color:var(--text);margin-top:2px">
           ${esc(ctx.label || '')}${ctx.sub ? ` <span style="color:var(--text2)">· ${esc(ctx.sub)}</span>` : ''}
         </div>`
      : '';

    html += `<div class="q-item" data-prov-row="${pid}">
      <div class="q-item-header">
        <span class="q-item-title">${esc(r.target_table)}.${esc(r.field_name)}</span>
        <div class="q-item-badges">
          <span class="q-badge ${decisionBadge}">${esc(r.decision)}</span>
          ${r.attempted_enforce_mode ? `<span class="q-badge">${esc(r.attempted_enforce_mode)}</span>` : ''}
          ${r.bucket ? `<span class="q-badge ${bucketBadge}">${esc(r.bucket)}</span>` : ''}
          <span class="q-badge">record ${esc(r.record_pk_value)}</span>
        </div>
      </div>
      ${ctxHtml}
      <div class="q-item-meta">
        <span><b>incoming:</b> ${esc(r.attempted_source)} (priority ${esc(String(r.attempted_priority))}) → ${esc(truncate(r.attempted_value))}</span>
        ${r.current_source ? `<span><b>current:</b> ${esc(r.current_source)} (priority ${esc(String(r.current_priority))}) → ${esc(truncate(r.current_value))}</span>` : '<span style="color:var(--text2)"><b>current:</b> none</span>'}
        <span style="color:var(--text2);font-style:italic">${esc(r.decision_reason || '')}</span>
        ${ago}
      </div>
      <div class="ops-filters" style="margin-top:8px;gap:4px">${actions}</div>
    </div>`;
  }
  if (filtered.length > 50) {
    html += `<div class="q-item-meta" style="padding:8px 12px">Showing first 50 of ${filtered.length}.</div>`;
  }
  html += '</div>';

  // ── Phase 4: Unranked fields (schema-drift detector) ──────────────────
  html += '<div class="widget"><div class="widget-title">Unranked Fields ' +
    '<span style="font-size:12px;color:var(--text2);font-weight:400;margin-left:8px">' +
    'Field writes seen in the last 30 days that have no priority rule. Add one to govern future writes.</span></div>';

  if (unranked.length === 0) {
    html += '<div class="ops-empty" style="color:var(--green)">All field writes are governed by priority rules. No drift detected.</div>';
  } else {
    html += `<div style="margin-bottom:12px;font-size:13px;color:var(--text2)">${unranked.length} unranked (table.field, source) triple${unranked.length === 1 ? '' : 's'} seen in the last 30 days:</div>`;
    for (const u of unranked.slice(0, 30)) {
      const conflictBadge = u.distinct_sources_seen > 1 ? '<span class="q-badge pri-high">multi-source</span>' : '';
      html += `<div class="q-item">
        <div class="q-item-header">
          <span class="q-item-title">${esc(u.target_table)}.${esc(u.field_name)}</span>
          <div class="q-item-badges">
            <span class="q-badge">${esc(u.source)}</span>
            <span class="q-badge">${u.writes_30d} writes</span>
            <span class="q-badge">${u.distinct_records} records</span>
            ${conflictBadge}
          </div>
        </div>
        <div class="q-item-meta">
          <span><b>writes:</b> ${u.writes_succeeded || 0} ok / ${u.writes_skipped || 0} skipped / ${u.writes_conflicted || 0} conflicts</span>
          <span><b>first seen:</b> ${freshnessHTML(u.first_seen)}</span>
          <span><b>last seen:</b> ${freshnessHTML(u.last_seen)}</span>
          <span style="color:var(--text2);font-style:italic">→ Add a priority rule via INSERT INTO field_source_priority</span>
        </div>
      </div>`;
    }
    if (unranked.length > 30) {
      html += `<div class="q-item-meta" style="padding:8px 12px">Showing first 30 of ${unranked.length}.</div>`;
    }
  }
  html += '</div>';

  host.innerHTML = html;
}

// Resolution action handlers — POST to /api/entities?action=resolve_provenance_conflict
// and refresh the widget on success. Errors are toasted; the row stays in place.
async function resolveProvConflict(provenance_id, chosen, custom_value, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  const body = { provenance_id, chosen };
  if (custom_value !== null && custom_value !== undefined) body.custom_value = custom_value;
  const res = await opsPost('/api/entities?action=resolve_provenance_conflict', body);
  if (res.ok) {
    if (typeof toast === 'function') {
      toast(chosen === 'defer' ? 'Deferred 7 days.'
          : chosen === 'junk'  ? 'Marked as junk.'
          : chosen === 'current' ? 'Kept current value.'
          : 'Domain DB updated.');
    }
    renderProvenanceConflictWidgets();
  } else {
    const detail = res.error || 'Resolution failed';
    if (typeof toast === 'function') toast(detail, 'error');
    else alert(detail);
    if (btn) { btn.disabled = false; btn.textContent = chosen; }
  }
}

async function resolveProvConflictCustom(provenance_id, btn) {
  // Find the row to show its current values in the prompt
  const card = btn?.closest('[data-prov-row]');
  const helper = card ? card.querySelector('.q-item-meta')?.textContent : '';
  const msg = 'Enter the value to write. Numbers will be parsed as JSON (e.g. 3690000 not "3690000").'
    + (helper ? '\n\nContext:\n' + helper.slice(0, 200) : '');
  const v = typeof lccPrompt === 'function'
    ? await lccPrompt(msg, '')
    : (typeof prompt === 'function' ? prompt(msg, '') : null);
  if (v === null || v === undefined) return;  // cancelled
  let parsed;
  try { parsed = JSON.parse(v); }
  catch { parsed = v; }   // fall back to raw string
  resolveProvConflict(provenance_id, 'custom', parsed, btn);
}

// ─── Domain (dialysis) data quality — pulls v_data_quality_summary +
// v_data_quality_issues from dia Supabase via /api/dia-query and renders
// a grouped triage panel. Each row links to property detail when possible.
let _diaQualityFilter = 'all'; // 'all' | <issue_kind>
async function renderDiaDataQualityWidgets() {
  const host = document.getElementById('diaDataQualityWidgets');
  if (!host) return;
  if (typeof diaQuery !== 'function') {
    host.innerHTML = '<div class="widget"><div class="widget-title">Domain Data Quality (dialysis)</div><div class="ops-empty">diaQuery helper not loaded</div></div>';
    return;
  }

  const [summary, issues] = await Promise.all([
    diaQuery('v_data_quality_summary', '*', { order: 'total_severity.desc', limit: 50 }),
    diaQuery(
      'v_data_quality_issues', '*',
      _diaQualityFilter === 'all'
        ? { order: 'severity.desc', limit: 50 }
        : { filter: 'issue_kind=eq.' + encodeURIComponent(_diaQualityFilter), order: 'severity.desc', limit: 50 }
    )
  ]);

  // Pretty-name each issue_kind so the cards stay scannable.
  const KIND_LABELS = {
    duplicate_property:                 'Duplicate property (real address)',
    missing_address:                    'Missing / placeholder address',
    duplicate_property_address:         'Duplicate property address',
    multi_active_lease:                 'Multi-active lease (one property, multiple active leases)',
    listing_after_sale:                 'Listing after sale',
    orphan_listing:                     'Orphan listing (property missing)',
    lease_no_dates:                     'Lease with no dates',
    listing_active_no_verification_due: 'Active listing missing verification_due_at',
  };
  const KIND_HINTS = {
    duplicate_property:                 'Genuine duplicates: same REAL address+state under multiple property_ids — the clean input to the gated auto-merge.',
    missing_address:                    'Placeholder/empty address ("Dialysis Unit", "TBD") shared by several rows — NOT a merge. Backfill the real street address (geocode / CMS / county).',
    duplicate_property_address:         'Auto-merge cron handles 5/min. Remaining are placeholder addresses needing manual review.',
    multi_active_lease:                 'Auto-supersede only resolves cleanly disjoint terms — these have overlapping or unclear chains.',
    listing_after_sale:                 'Closed-on-sale trigger missed; flip status to Sold.',
    orphan_listing:                     'Property was deleted — listing should be removed or repointed.',
    lease_no_dates:                     'Active lease without lease_start or lease_expiration. Source data missing dates.',
    listing_active_no_verification_due: 'BEFORE-INSERT trigger drift. Cron auto-picks these up; spike means trigger or replication path needs review.',
  };

  let html = '';

  // Summary metric cards
  html += '<div class="widget"><div class="widget-title">Domain Data Quality (dialysis)</div>';
  if (!summary || summary.length === 0) {
    html += '<div class="ops-empty" style="color:var(--green)">No issues — dialysis data is clean.</div>';
  } else {
    html += '<div class="metrics-grid" style="margin-bottom:12px">';
    for (const row of summary) {
      const tone = row.worst_severity >= 5 ? 'red' : row.worst_severity >= 3 ? 'yellow' : 'green';
      const label = KIND_LABELS[row.issue_kind] || row.issue_kind;
      const sub = `worst severity ${row.worst_severity}`;
      html += metricCardHTML(label, row.issue_count || 0, sub, tone);
    }
    html += '</div>';

    // Filter buttons
    html += '<div class="ops-filters" style="margin-bottom:12px">';
    html += `<button class="ops-filter ${_diaQualityFilter === 'all' ? 'active' : ''}" onclick="_diaQualityFilter='all';renderDiaDataQualityWidgets()">All issues</button>`;
    for (const row of summary) {
      const active = _diaQualityFilter === row.issue_kind ? 'active' : '';
      html += `<button class="ops-filter ${active}" onclick="_diaQualityFilter=${jsStringArg(row.issue_kind)};renderDiaDataQualityWidgets()">${esc(KIND_LABELS[row.issue_kind] || row.issue_kind)} (${row.issue_count})</button>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // Detail rows for the active filter
  if (summary && summary.length > 0) {
    html += '<div class="widget">';
    const detailTitle = _diaQualityFilter === 'all' ? 'Top issues by severity' : (KIND_LABELS[_diaQualityFilter] || _diaQualityFilter);
    html += `<div class="widget-title">${esc(detailTitle)}`;
    if (_diaQualityFilter !== 'all' && KIND_HINTS[_diaQualityFilter]) {
      html += `<span style="font-size:12px;color:var(--text2);font-weight:400;margin-left:8px">${esc(KIND_HINTS[_diaQualityFilter])}</span>`;
    }
    html += '</div>';

    if (!issues || issues.length === 0) {
      html += '<div class="ops-empty">No rows for this filter.</div>';
    } else {
      for (const item of issues.slice(0, 50)) {
        // record_id is a property_id for property-scoped issues (most kinds)
        // or a listing_id for orphan_listing. Wire a "Open property" button
        // that uses the existing showDetail(record, source) flow when
        // record_id parses as a numeric property_id.
        const propLikePid = /^\d+$/.test(String(item.record_id)) ? Number(item.record_id) : null;
        const sevTone = item.severity >= 5 ? 'pri-high' : item.severity >= 3 ? 'pri-med' : 'pri-low';

        html += `<div class="q-item">
          <div class="q-item-header">
            <span class="q-item-title">${esc(item.detail_1 || '(no detail)')}</span>
            <div class="q-item-badges">
              <span class="q-badge ${sevTone}">severity ${item.severity ?? '-'}</span>
              ${item.issue_kind ? `<span class="q-badge">${esc(KIND_LABELS[item.issue_kind] || item.issue_kind)}</span>` : ''}
            </div>
          </div>
          <div class="q-item-meta">
            ${item.detail_2 ? `<span>${esc(item.detail_2)}</span>` : ''}
            ${item.detail_3 ? `<span>${esc(item.detail_3)}</span>` : ''}
            ${item.suggested_action ? `<span style="color:var(--text2);font-style:italic">→ ${esc(item.suggested_action)}</span>` : ''}
          </div>
          <div class="q-actions">
            ${propLikePid != null && item.issue_kind !== 'orphan_listing' ? `<button class="q-action primary" onclick="opsOpenDiaProperty(${propLikePid})">Open property ${propLikePid}</button>` : ''}
            <button class="q-action" onclick="createQualityFollowup(${jsStringArg('Resolve ' + (KIND_LABELS[item.issue_kind] || item.issue_kind) + ' — ' + (item.detail_1 || item.record_id))})">Create Follow-up</button>
          </div>
        </div>`;
      }
      if (issues.length >= 50) {
        html += '<div class="q-item-meta" style="padding:8px 12px">Showing first 50. Filter to a kind for the full list within that kind.</div>';
      }
    }
    html += '</div>';
  }

  host.innerHTML = html;
}

// Open a dialysis property by ID via the same showDetail() flow used elsewhere.
async function opsOpenDiaProperty(propertyId) {
  if (!propertyId) return;
  try {
    const rows = await diaQuery('properties', 'property_id,address,city,state,tenant',
      { filter: 'property_id=eq.' + propertyId, limit: 1 });
    const prop = rows?.[0];
    if (!prop) { showToast('Property ' + propertyId + ' not found in dialysis DB', 'error'); return; }
    _opsWhenDetailReady(function () {
      showDetail({
        property_id: prop.property_id,
        address:     prop.address || '',
        city:        prop.city || '',
        state:       prop.state || '',
        tenant:      prop.tenant || '',
      }, 'dia-clinic');
    });
  } catch (err) {
    console.error('opsOpenDiaProperty error:', err);
    showToast('Could not open property: ' + (err?.message || err), 'error');
  }
}

// ─── Domain (government) data quality — same pattern as the dia panel,
//     but reads gov v_data_quality_summary / v_data_quality_issues via
//     govQuery and uses gov-flavored issue_kind labels.
let _govQualityFilter = 'all';
async function renderGovDataQualityWidgets() {
  const host = document.getElementById('govDataQualityWidgets');
  if (!host) return;
  if (typeof govQuery !== 'function') {
    host.innerHTML = '<div class="widget"><div class="widget-title">Domain Data Quality (government)</div><div class="ops-empty">govQuery helper not loaded</div></div>';
    return;
  }

  const [summaryRes, issuesRes] = await Promise.all([
    govQuery('v_data_quality_summary', '*', { order: 'total_severity.desc', limit: 50 }),
    govQuery(
      'v_data_quality_issues', '*',
      _govQualityFilter === 'all'
        ? { order: 'severity.desc', limit: 50 }
        : { filter: 'issue_kind=eq.' + encodeURIComponent(_govQualityFilter), order: 'severity.desc', limit: 50 }
    )
  ]);
  const summary = summaryRes?.data || [];
  const issues  = issuesRes?.data  || [];

  const KIND_LABELS = {
    duplicate_property:                 'Duplicate property (real address)',
    missing_address:                    'Missing / placeholder address',
    duplicate_property_address:         'Duplicate property address',
    listing_after_sale:                 'Listing after sale',
    orphan_listing:                     'Orphan listing (property missing)',
    lease_no_dates:                     'Lease with no dates',
    listing_active_no_verification_due: 'Active listing missing verification_due_at',
  };
  const KIND_HINTS = {
    duplicate_property:                 'Genuine duplicates: same REAL address+state under multiple property_ids — the clean input to the gated auto-merge.',
    missing_address:                    'Placeholder/empty address shared by several rows — NOT a merge. Backfill the real street address.',
    duplicate_property_address:         'Same normalized address+state under multiple property_ids — manual merge needed.',
    listing_after_sale:                 'Active listing on a property that already has a sale recorded. Run the listing-close backfill or flip status to Sold.',
    orphan_listing:                     'Property was deleted — listing should be removed or repointed.',
    lease_no_dates:                     'Active lease without commencement_date or expiration_date. Source data missing dates.',
    listing_active_no_verification_due: 'BEFORE-INSERT trigger drift. Cron auto-picks these up; spike means trigger or replication path needs review.',
  };

  let html = '';
  html += '<div class="widget"><div class="widget-title">Domain Data Quality (government)</div>';
  if (!summary || summary.length === 0) {
    html += '<div class="ops-empty" style="color:var(--green)">No issues — government data is clean.</div>';
  } else {
    html += '<div class="metrics-grid" style="margin-bottom:12px">';
    for (const row of summary) {
      const tone = row.worst_severity >= 5 ? 'red' : row.worst_severity >= 3 ? 'yellow' : 'green';
      const label = KIND_LABELS[row.issue_kind] || row.issue_kind;
      const sub = `worst severity ${row.worst_severity}`;
      html += metricCardHTML(label, row.issue_count || 0, sub, tone);
    }
    html += '</div>';

    html += '<div class="ops-filters" style="margin-bottom:12px">';
    html += `<button class="ops-filter ${_govQualityFilter === 'all' ? 'active' : ''}" onclick="_govQualityFilter='all';renderGovDataQualityWidgets()">All issues</button>`;
    for (const row of summary) {
      const active = _govQualityFilter === row.issue_kind ? 'active' : '';
      html += `<button class="ops-filter ${active}" onclick="_govQualityFilter=${jsStringArg(row.issue_kind)};renderGovDataQualityWidgets()">${esc(KIND_LABELS[row.issue_kind] || row.issue_kind)} (${row.issue_count})</button>`;
    }
    html += '</div>';
  }
  html += '</div>';

  if (summary && summary.length > 0) {
    html += '<div class="widget">';
    const detailTitle = _govQualityFilter === 'all' ? 'Top issues by severity' : (KIND_LABELS[_govQualityFilter] || _govQualityFilter);
    html += `<div class="widget-title">${esc(detailTitle)}`;
    if (_govQualityFilter !== 'all' && KIND_HINTS[_govQualityFilter]) {
      html += `<span style="font-size:12px;color:var(--text2);font-weight:400;margin-left:8px">${esc(KIND_HINTS[_govQualityFilter])}</span>`;
    }
    html += '</div>';

    if (!issues || issues.length === 0) {
      html += '<div class="ops-empty">No rows for this filter.</div>';
    } else {
      for (const item of issues.slice(0, 50)) {
        const propLikePid = /^\d+$/.test(String(item.record_id)) ? Number(item.record_id) : null;
        const sevTone = item.severity >= 5 ? 'pri-high' : item.severity >= 3 ? 'pri-med' : 'pri-low';

        html += `<div class="q-item">
          <div class="q-item-header">
            <span class="q-item-title">${esc(item.detail_1 || '(no detail)')}</span>
            <div class="q-item-badges">
              <span class="q-badge ${sevTone}">severity ${item.severity ?? '-'}</span>
              ${item.issue_kind ? `<span class="q-badge">${esc(KIND_LABELS[item.issue_kind] || item.issue_kind)}</span>` : ''}
            </div>
          </div>
          <div class="q-item-meta">
            ${item.detail_2 ? `<span>${esc(item.detail_2)}</span>` : ''}
            ${item.detail_3 ? `<span>${esc(item.detail_3)}</span>` : ''}
            ${item.suggested_action ? `<span style="color:var(--text2);font-style:italic">→ ${esc(item.suggested_action)}</span>` : ''}
          </div>
          <div class="q-actions">
            ${propLikePid != null && item.issue_kind !== 'orphan_listing' ? `<button class="q-action primary" onclick="opsOpenGovProperty(${propLikePid})">Open property ${propLikePid}</button>` : ''}
            <button class="q-action" onclick="createQualityFollowup(${jsStringArg('Resolve ' + (KIND_LABELS[item.issue_kind] || item.issue_kind) + ' — ' + (item.detail_1 || item.record_id))})">Create Follow-up</button>
          </div>
        </div>`;
      }
      if (issues.length >= 50) {
        html += '<div class="q-item-meta" style="padding:8px 12px">Showing first 50. Filter to a kind for the full list within that kind.</div>';
      }
    }
    html += '</div>';
  }

  host.innerHTML = html;
}

// Open a government property by ID via the same showDetail() flow.
async function opsOpenGovProperty(propertyId) {
  if (!propertyId) return;
  try {
    // getRows() normalizes diaQuery/govQuery's divergent return shapes
    // (see app.js).
    const prop = getRows(await govQuery('properties', 'property_id,address,city,state,agency',
      { filter: 'property_id=eq.' + propertyId, limit: 1 }))[0];
    if (!prop) { showToast('Property ' + propertyId + ' not found in government DB', 'error'); return; }
    _opsWhenDetailReady(function () {
      showDetail({
        property_id: prop.property_id,
        address:     prop.address || '',
        city:        prop.city || '',
        state:       prop.state || '',
        tenant:      prop.agency || '',
      }, 'gov-asset');
    });
  } catch (err) {
    console.error('opsOpenGovProperty error:', err);
    showToast('Could not open property: ' + (err?.message || err), 'error');
  }
}

// ─── LCC ops (multi-tenant) data quality — reads
//     /api/queue?view=data_quality which surfaces the workspace-scoped
//     v_data_quality_issues view. No domain filter; severity is days-old
//     for time-based issues.
let _opsQualityFilter = 'all';
async function renderOpsDataQualityWidgets() {
  const host = document.getElementById('opsDataQualityWidgets');
  if (!host) return;
  if (!LCC_USER.workspace_id) {
    host.innerHTML = '<div class="widget"><div class="widget-title">Ops Data Quality</div><div class="ops-empty">No workspace selected.</div></div>';
    return;
  }

  const filterParam = _opsQualityFilter === 'all' ? '' : `&issue_kind=${encodeURIComponent(_opsQualityFilter)}`;
  const res = await opsApi(`/api/queue?view=data_quality${filterParam}`);
  const summary = res?.summary || [];
  const issues  = res?.items   || [];

  const KIND_LABELS = {
    stuck_sync_job:        'Stuck sync job',
    unresolved_sync_error: 'Unresolved sync error',
    stuck_research:        'Stuck research task',
    stale_open_action:     'Stale open action',
    unassigned_action:     'Unassigned action',
    orphan_inbox_entity:   'Orphan inbox entity FK',
    orphan_action_entity:  'Orphan action entity FK',
    escalation_overdue:    'Escalation overdue',
  };
  const KIND_HINTS = {
    stuck_sync_job:        'Sync job has been pending/running > 24h. Likely hung — check connector and retry/fail manually.',
    unresolved_sync_error: 'Sync error open > 30 days. Either resolve or mark non-retryable.',
    stuck_research:        'Research task in_progress > 30 days. Check with assignee or reassign.',
    stale_open_action:     'Action item not updated in > 90 days. Likely forgotten — close or reassign.',
    unassigned_action:     'Action item open > 7 days with no assignee. Assign or downgrade visibility.',
    orphan_inbox_entity:   'Inbox item references a non-existent entity. Set entity_id NULL or relink.',
    orphan_action_entity:  'Action references a non-existent entity. Set entity_id NULL or relink.',
    escalation_overdue:    'Escalation open > 14 days. Escalator should follow up or close.',
  };

  let html = '';
  html += '<div class="widget"><div class="widget-title">Ops Data Quality</div>';
  if (!summary || summary.length === 0) {
    html += '<div class="ops-empty" style="color:var(--green)">No issues — ops data is clean.</div>';
  } else {
    html += '<div class="metrics-grid" style="margin-bottom:12px">';
    for (const row of summary) {
      const tone = row.worst_severity >= 30 ? 'red' : row.worst_severity >= 7 ? 'yellow' : 'green';
      const label = KIND_LABELS[row.issue_kind] || row.issue_kind;
      const sub = `worst severity ${row.worst_severity}`;
      html += metricCardHTML(label, row.issue_count || 0, sub, tone);
    }
    html += '</div>';

    html += '<div class="ops-filters" style="margin-bottom:12px">';
    html += `<button class="ops-filter ${_opsQualityFilter === 'all' ? 'active' : ''}" onclick="_opsQualityFilter='all';renderOpsDataQualityWidgets()">All issues</button>`;
    for (const row of summary) {
      const active = _opsQualityFilter === row.issue_kind ? 'active' : '';
      html += `<button class="ops-filter ${active}" onclick="_opsQualityFilter=${jsStringArg(row.issue_kind)};renderOpsDataQualityWidgets()">${esc(KIND_LABELS[row.issue_kind] || row.issue_kind)} (${row.issue_count})</button>`;
    }
    html += '</div>';
  }
  html += '</div>';

  if (summary && summary.length > 0) {
    html += '<div class="widget">';
    const detailTitle = _opsQualityFilter === 'all' ? 'Top issues by severity' : (KIND_LABELS[_opsQualityFilter] || _opsQualityFilter);
    html += `<div class="widget-title">${esc(detailTitle)}`;
    if (_opsQualityFilter !== 'all' && KIND_HINTS[_opsQualityFilter]) {
      html += `<span style="font-size:12px;color:var(--text2);font-weight:400;margin-left:8px">${esc(KIND_HINTS[_opsQualityFilter])}</span>`;
    }
    html += '</div>';

    if (!issues || issues.length === 0) {
      html += '<div class="ops-empty">No rows for this filter.</div>';
    } else {
      for (const item of issues.slice(0, 50)) {
        const sevTone = item.severity >= 30 ? 'pri-high' : item.severity >= 7 ? 'pri-med' : 'pri-low';
        html += `<div class="q-item">
          <div class="q-item-header">
            <span class="q-item-title">${esc(item.detail_2 || item.detail_1 || item.record_id)}</span>
            <div class="q-item-badges">
              <span class="q-badge ${sevTone}">severity ${item.severity ?? '-'}</span>
              ${item.issue_kind ? `<span class="q-badge">${esc(KIND_LABELS[item.issue_kind] || item.issue_kind)}</span>` : ''}
            </div>
          </div>
          <div class="q-item-meta">
            ${item.detail_1 ? `<span>${esc(item.detail_1)}</span>` : ''}
            ${item.detail_3 ? `<span>${esc(item.detail_3)}</span>` : ''}
            ${item.suggested_action ? `<span style="color:var(--text2);font-style:italic">→ ${esc(item.suggested_action)}</span>` : ''}
          </div>
        </div>`;
      }
      if (issues.length >= 50) {
        html += '<div class="q-item-meta" style="padding:8px 12px">Showing first 50. Filter to a kind for the full list within that kind.</div>';
      }
    }
    html += '</div>';
  }

  host.innerHTML = html;
}

// Tier 3 Phase 3: open the ONE shared merge modal from the Entities surface in
// find-target mode (side A = this entity; search picks the duplicate). Routes
// through the canonical lcc_merge_entity path (planMerge → /api/entities?action=merge).
function entityMergeFrom(entityId, entityName) {
  if (typeof openMergeModal !== 'function') { showToast('Merge unavailable', 'error'); return; }
  openMergeModal({
    kind: 'entity',
    a: { id: entityId, name: entityName || entityId },
    findTarget: true,
    searchEndpoint: '/api/entities?action=search&q=',
    onDone: function () { if (typeof renderEntitiesPage === 'function') renderEntitiesPage(); },
  });
}
window.entityMergeFrom = entityMergeFrom;

async function viewEntity(entityId) {
  if (!entityId) { showToast('No entity ID', 'error'); return; }
  try {
    const res = await opsApi('/api/entities?id=' + encodeURIComponent(entityId));
    const entity = res?.data || res;
    if (!entity || (!entity.name && !entity.id)) { showToast('Entity not found', 'error'); return; }
    // Route to unified detail based on domain
    const db = (entity.domain || '').toLowerCase().includes('gov') ? 'gov' : 'dia';
    const source = db === 'gov' ? 'gov-lead' : 'dia-clinic';
    // Build a fallback record from entity fields
    const record = {
      property_id: entity.property_id || null,
      address: entity.address || entity.name || '',
      city: entity.city || '',
      state: entity.state || '',
      entity_type: entity.entity_type || '',
      entity_id: entity.id
    };
    _opsWhenDetailReady(function () { showDetail(record, source); });
  } catch (err) {
    console.error('viewEntity error:', err);
    showToast('Could not load entity: ' + err.message, 'error');
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

  // QA-15 (2026-05-18): the previous wiring (calling
  // renderLlcResearchQueueWidget + renderAgencyDriftQueueWidget BEFORE
  // assembling the rest of the page) was ineffective — the widgets
  // prepended themselves to `el`, but then `el.innerHTML = html;` at the
  // end of this function wiped them out. The Research page therefore
  // rendered as just "0 tasks / No research tasks match this filter"
  // even though the queues had hundreds of rows. Widget renders are now
  // hoisted to a separate container above the queue list and re-fired
  // AFTER the queue list innerHTML assignment so they survive.

  const statusParam = opsResearchFilter === 'active' ? 'active'
    : opsResearchFilter === 'completed' ? 'completed'
    : '';
  const res = await opsApi(`/api/queue?view=research&page=${opsResearchPage}&per_page=25${statusParam ? `&status=${statusParam}` : ''}`);
  if (!res.ok) {
    el.innerHTML = opsErrorState(res, 'renderResearchPage()', 'Could not load research tasks');
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

  if (filtered.length) {
    html += `<div class="rc-progress"><span>${filtered.length}</span> ${opsResearchFilter === 'completed' ? 'completed' : 'to work'}</div>`;
  }
  if (!filtered.length) {
    html += '<div class="ops-empty">No research tasks match this filter</div>';
  } else {
    filtered.forEach((item, _ix) => {
      // Self-propelling contract: elevate the first actionable task. On
      // Complete the page reloads and the next task re-elevates automatically.
      const _isHero = _ix === 0 && item.status !== 'completed';
      html += `<div class="q-item${_isHero ? ' pq-hero' : ''}" data-q-id="${esc(String(item.id == null ? '' : item.id))}">
        ${_isHero ? '<div class="pq-hero-flag">\u25B6 Do this first</div>' : ''}
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
          ${item.status !== 'completed' ? `<button class="q-action primary" onclick="_opsBtnGuard(this, completeResearch, decodeURIComponent('${encodeURIComponent(item.id)}'))">Complete</button>` : ''}
          ${item.status !== 'completed' ? `<button class="q-action" onclick="_opsBtnGuard(this, createFollowup, decodeURIComponent('${encodeURIComponent(item.id)}'))">Follow-up</button>` : ''}
          <button class="q-action" onclick="_opsBtnGuard(this, runResearchAssistant, decodeURIComponent('${encodeURIComponent(item.id)}'))">Assist</button>
          <button class="q-action" onclick="_opsBtnGuard(this, exportResearchTaskBrief, decodeURIComponent('${encodeURIComponent(item.id)}'),'chatgpt')">ChatGPT</button>
          <button class="q-action" onclick="_opsBtnGuard(this, exportResearchTaskBrief, decodeURIComponent('${encodeURIComponent(item.id)}'),'claude')">Claude</button>
        </div>
        ${researchAssistantPanelHTML(item.id)}
      </div>`;
    });
  }

  html += paginationHTML('/api/queue?view=research', 'renderResearchPage');

  // QA-15 (2026-05-18): wrap the research queue content in an inner div
  // so we can prepend the LLC + Agency Drift widgets without conflicting
  // with subsequent re-renders.
  el.innerHTML = '<div class="lcc-research-widgets"></div>' +
                 '<div class="lcc-research-queue">' + html + '</div>';

  // Now fire the widget renders into the dedicated wrapper. They use
  // `parentEl.insertBefore(widget, parentEl.firstChild)` to prepend each
  // widget into the wrapper, so order is preserved (LLC first, then
  // Agency Drift below).
  const widgetsEl = el.querySelector('.lcc-research-widgets');
  if (widgetsEl) {
    try {
      if (typeof renderLlcResearchQueueWidget === 'function') {
        await renderLlcResearchQueueWidget(widgetsEl);
      }
    } catch (e) { console.warn('[ResearchPage] LLC widget render failed:', e?.message); }
    try {
      if (typeof renderAgencyDriftQueueWidget === 'function') {
        await renderAgencyDriftQueueWidget(widgetsEl);
      }
    } catch (e) { console.warn('[ResearchPage] agency-drift widget render failed:', e?.message); }
  }
  perf.end();
}

async function completeResearch(id) {
  const res = await opsPost('/api/workflows?action=research_followup', {
    research_task_id: id
  });
  if (res.ok) {
    showToast('Research completed', 'success');
    if (!_opsAdvanceAfterComplete(id)) refreshActiveOpsPage();
  } else {
    showToast(res.error || 'Failed', 'error');
    refreshActiveOpsPage();
  }
}

async function createFollowup(id) {
  const members = await loadWorkspaceMembers() || [];
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

// Tier 3 Phase 2: route the known-pair entity merge through the ONE shared merge
// modal (review-shared.js → planMerge → /api/entities?action=merge, which now
// rides lcc_merge_entity and carries portfolio_facts + identities — no orphans).
// Falls back to the legacy confirm+post only if the shared modal didn't load.
async function qualityMergeDuplicate(entityIdsJson, entityNamesJson) {
  let entityIds = [];
  let entityNames = [];
  try { entityIds = JSON.parse(entityIdsJson || '[]'); } catch (_) {}
  try { entityNames = JSON.parse(entityNamesJson || '[]'); } catch (_) {}
  if (!entityIds || entityIds.length < 2) {
    showToast('Need at least two entities to merge', 'error');
    return;
  }
  if (typeof openMergeModal === 'function') {
    openMergeModal({
      kind: 'entity',
      a: { id: entityIds[0], name: entityNames[0] || entityIds[0] },
      b: { id: entityIds[1], name: entityNames[1] || entityIds[1] },
      onDone: function () { if (typeof refreshActiveOpsPage === 'function') refreshActiveOpsPage(); },
    });
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
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(brief);
      copied = true;
    }
  } catch (e) {
    console.warn('Research brief clipboard warning:', e);
  }

  window.open(provider === 'claude' ? 'https://claude.ai/chats' : 'https://chatgpt.com/', '_blank', 'noopener');
  if (copied) {
    showToast(`Research brief copied. Paste it into ${provider === 'claude' ? 'Claude' : 'ChatGPT'}.`, 'success');
  } else {
    showToast(`Clipboard unavailable — manually copy the brief into ${provider === 'claude' ? 'Claude' : 'ChatGPT'}.`, 'warning');
  }
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

// Tier 3 Phase 2: route through the ONE shared follow-up component
// (review-shared.js → planFollowup → /api/actions). The modal captures
// assignee/due/notes consistently with the other follow-up triggers. Falls back
// to the legacy fire-and-forget post only if the shared modal didn't load.
async function createQualityFollowup(title) {
  if (typeof openFollowupModal === 'function') {
    openFollowupModal({
      title: title || '',
      contextLabel: 'Create a follow-up for this data-quality item.',
      source: 'data_quality',
      onDone: function () { if (typeof refreshActiveOpsPage === 'function') refreshActiveOpsPage(); },
    });
    return;
  }
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
    // QA-10 (2026-05-18): prefer the live connector-status error count
    // (summary.error from /api/sync?action=health) over the stale-prone
    // work_counts.sync_errors row count. Reason: a connector can be in
    // status='error' (failing right now) without any rows in the
    // sync_errors log table, and vice-versa. The connector-status count
    // is what the Pipeline banner uses, so this makes Metrics agree with
    // it. Falls back to c.sync_errors if sync-health endpoint failed.
    const liveSyncErrors = (syncHealthRes.ok && syncHealthRes.data?.summary)
      ? (syncHealthRes.data.summary.error || 0)
      : (c.sync_errors || 0);
    html += metricCardHTML('Sync Errors', liveSyncErrors, 'connectors in error state', liveSyncErrors > 0 ? 'red' : 'green');
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
// B8 — DOMAIN HEALTH SUMMARY (2026-05-27)
// ============================================================================
//
// Side-by-side dia + gov summary of the v_data_health_* + completeness
// + SF-link queue state. Hydrates into the #domainHealthSummary anchor
// rendered by renderDataQualityPage(). Surfaces the last 7 rounds of
// back-end remediation in one operator-visible tile.

// Render a tiny inline-SVG sparkline. `series` is an array of numbers
// (null entries are gaps); width/height in px. Empty/all-null series
// returns a small "no data" badge.
function _opsSparkline(series, opts = {}) {
  const w = opts.width  || 110;
  const h = opts.height || 24;
  const pad = 2;
  const nums = (series || []).map(v => v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const real = nums.filter(v => v != null);
  if (real.length < 2) {
    return `<span style="font-size:11px;color:var(--text2);font-style:italic">no trend</span>`;
  }
  const min = Math.min(...real);
  const max = Math.max(...real);
  const span = max - min || 1;
  const stepX = (w - 2 * pad) / Math.max(1, nums.length - 1);
  const points = [];
  nums.forEach((v, i) => {
    if (v == null) return;
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / span) * (h - 2 * pad);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  const last = real[real.length - 1];
  const first = real[0];
  const tone = last > first ? 'var(--green)' : last < first ? 'var(--red)' : 'var(--text2)';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle">
    <polyline points="${points.join(' ')}" fill="none" stroke="${tone}" stroke-width="1.5" />
  </svg>`;
}

// Pull last-30-day series for a single metric out of v_data_health_trend
// rows. trendRows have shape [{day, view_name, payload, ...}]. Selects
// matching view_name + extracts payload[metricKey] over time (asc).
function _opsTrendSeries(trendRows, viewName, metricKey) {
  if (!Array.isArray(trendRows)) return [];
  return trendRows
    .filter(r => r && r.view_name === viewName)
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .map(r => {
      const v = r.payload && r.payload[metricKey];
      const n = v == null ? null : Number(v);
      return Number.isFinite(n) ? n : null;
    });
}

async function renderDomainHealthSummary() {
  const host = document.getElementById('domainHealthSummary');
  if (!host) return;
  if (typeof diaQuery !== 'function' || typeof govQuery !== 'function') {
    host.innerHTML = '<div class="widget"><div class="widget-title">Domain Health Summary</div><div class="ops-empty">diaQuery / govQuery helper not loaded</div></div>';
    return;
  }

  // Parallel pulls. Each helper has slightly different return shape:
  //   diaQuery returns the array directly
  //   govQuery returns {data: [...]}
  const unwrap = (r) => Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);
  const [
    diaSales, diaOwn, diaEnt, diaComp, diaSf, diaTrend,
    govSales, govOwn, govEnt, govComp, govSf, govTrend,
  ] = await Promise.all([
    diaQuery('v_data_health_sales', '*', { limit: 1 }),
    diaQuery('v_data_health_ownership', '*', { limit: 1 }),
    diaQuery('v_data_health_entities', '*', { limit: 1 }),
    diaQuery('v_sales_completeness_summary', '*', { limit: 1 }),
    diaQuery('v_sf_link_queue_summary', 'status,n', { limit: 20 }),
    diaQuery('v_data_health_trend', 'day,view_name,payload',
      { order: 'day.asc', limit: 200 }),
    govQuery('v_data_health_sales', '*', { limit: 1 }),
    govQuery('v_data_health_ownership', '*', { limit: 1 }),
    govQuery('v_data_health_entities', '*', { limit: 1 }),
    govQuery('v_sales_completeness_summary', '*', { limit: 1 }),
    govQuery('v_sf_link_queue_summary', 'status,n', { limit: 20 }),
    govQuery('v_data_health_trend', 'day,view_name,payload',
      { order: 'day.asc', limit: 200 }),
  ]);

  const ds  = unwrap(diaSales)[0]  || {};
  const doh = unwrap(diaOwn)[0]    || {};
  const de  = unwrap(diaEnt)[0]    || {};
  const dc  = unwrap(diaComp)[0]   || {};
  const dt  = unwrap(diaTrend);
  const gs  = unwrap(govSales)[0]  || {};
  const goh = unwrap(govOwn)[0]    || {};
  const ge  = unwrap(govEnt)[0]    || {};
  const gc  = unwrap(govComp)[0]   || {};
  const gt  = unwrap(govTrend);

  // SF-link queue rollup. v_sf_link_queue_summary returns one row per
  // status with column `n` (server-side aggregated to avoid pulling all
  // 30K queue rows on every page-load).
  const sfCount = (rows) => {
    const c = { queued: 0, in_progress: 0, linked: 0, needs_review: 0, no_match: 0, failed: 0, unsupported: 0 };
    for (const r of unwrap(rows)) {
      if (r && r.status && c.hasOwnProperty(r.status)) c[r.status] = Number(r.n) || 0;
    }
    return c;
  };
  const dsf = sfCount(diaSf);
  const gsf = sfCount(govSf);
  const sfTotal = (c) => c.queued + c.in_progress + c.linked + c.needs_review + c.no_match + c.failed;

  // Pick out 30d series for the key metrics from v_data_health_trend.
  // Available payload keys (from migration): sales_live, duplicate_groups_live,
  // sales_needs_review, redundant_owner_rows, pct_property_to_recorded_owner.
  const trendOf = (rows, view, key) => _opsTrendSeries(rows, view, key);

  // Render — three rows of cards (Sales, Ownership, Entities + SF link),
  // each with side-by-side dia/gov values + a 30d sparkline below the value.
  const num = (v) => v == null || v === '' ? '—' : Number(v).toLocaleString();
  const pct = (v) => v == null || v === '' ? '—' : (Number(v).toFixed(1) + '%');
  const pctOf = (n, d) => (d > 0 ? (100 * n / d).toFixed(1) + '%' : '—');

  // Mini card builder: a single domain's value + sparkline for one metric.
  const cellHTML = (value, sparkSeries, sub) => `
    <div style="display:flex;flex-direction:column;gap:2px">
      <div style="font-size:18px;font-weight:600;line-height:1.1">${value}</div>
      <div>${_opsSparkline(sparkSeries)}</div>
      <div style="font-size:11px;color:var(--text2)">${sub || ''}</div>
    </div>`;

  const rowHTML = (label, diaCell, govCell) => `
    <div style="display:grid;grid-template-columns:170px 1fr 1fr;gap:12px;padding:10px 12px;border-bottom:1px solid var(--border)">
      <div style="font-weight:500;color:var(--text2);align-self:center">${label}</div>
      <div>${diaCell}</div>
      <div>${govCell}</div>
    </div>`;

  let html = '<div class="widget"><div class="widget-title">Domain Health Summary <span style="font-weight:400;color:var(--text2);font-size:12px">— values today, sparkline = last 30d</span></div>';
  html += `<div style="display:grid;grid-template-columns:170px 1fr 1fr;gap:12px;padding:10px 12px;border-bottom:2px solid var(--border);font-size:12px;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">
    <div>Metric</div><div>Dialysis</div><div>Government</div>
  </div>`;

  // ── Sales
  html += rowHTML('Live sales',
    cellHTML(num(ds.sales_live), trendOf(dt, 'v_data_health_sales', 'sales_live'), 'curated sales rows'),
    cellHTML(num(gs.sales_live), trendOf(gt, 'v_data_health_sales', 'sales_live'), 'curated sales rows'));
  html += rowHTML('Sales completeness',
    cellHTML((dc.avg_score == null ? '—' : Number(dc.avg_score).toFixed(1)) + ' avg',
             trendOf(dt, 'v_sales_completeness_summary', 'avg_score'),
             `median ${dc.p50_score ?? '—'} · ${dc.perfect ?? 0} perfect · ${dc.critical_lt_40 ?? 0} critical`),
    cellHTML((gc.avg_score == null ? '—' : Number(gc.avg_score).toFixed(1)) + ' avg',
             trendOf(gt, 'v_sales_completeness_summary', 'avg_score'),
             `median ${gc.p50_score ?? '—'} · ${gc.perfect ?? 0} perfect · ${gc.critical_lt_40 ?? 0} critical`));
  html += rowHTML('Needs-review sales',
    cellHTML(num(ds.sales_needs_review), trendOf(dt, 'v_data_health_sales', 'sales_needs_review'), 'awaiting triage'),
    cellHTML(num(gs.sales_needs_review), trendOf(gt, 'v_data_health_sales', 'sales_needs_review'), 'awaiting triage'));
  html += rowHTML('Live dupe groups',
    cellHTML(num(ds.duplicate_groups_live), trendOf(dt, 'v_data_health_sales', 'duplicate_groups_live'), 'should be 0 (C1+C4)'),
    cellHTML(num(gs.duplicate_groups_live), trendOf(gt, 'v_data_health_sales', 'duplicate_groups_live'), 'should be 0 (C1+C4)'));

  // ── Ownership
  html += rowHTML('Property → recorded_owner',
    cellHTML(pct(doh.pct_property_to_recorded_owner),
             trendOf(dt, 'v_data_health_ownership', 'pct_property_to_recorded_owner'),
             `${num(doh.prop_with_recorded_owner)} of ${num(doh.prop_total)}`),
    cellHTML(pct(goh.pct_property_to_recorded_owner),
             trendOf(gt, 'v_data_health_ownership', 'pct_property_to_recorded_owner'),
             `${num(goh.prop_with_recorded_owner)} of ${num(goh.prop_total)}`));
  html += rowHTML('Ownership history (active)',
    cellHTML(num(doh.oh_active), trendOf(dt, 'v_data_health_ownership', 'oh_active'),
             `${num(doh.oh_superseded)} superseded · ${num(doh.oh_orphan)} orphans`),
    cellHTML(num(goh.oh_active), trendOf(gt, 'v_data_health_ownership', 'oh_active'),
             `${num(goh.oh_superseded)} superseded · ${num(goh.oh_orphan)} orphans`));

  // ── Entities
  html += rowHTML('Recorded owners',
    cellHTML(num(de.total_recorded_owners), [],
             `${num(de.redundant_owner_groups)} redundant groups (${num(de.redundant_owner_rows)} rows)`),
    cellHTML(num(ge.total_recorded_owners), [],
             `${num(ge.redundant_owner_groups)} redundant groups (${num(ge.redundant_owner_rows)} rows)`));
  html += rowHTML('True owners',
    cellHTML(num(de.total_true_owners), [], 'canonical owners'),
    cellHTML(num(ge.total_true_owners), [], 'canonical owners'));

  // ── SF link (A7)
  const sfCellHTML = (c) => {
    const total = sfTotal(c);
    const linkedPct = total > 0 ? Math.round(100 * c.linked / total) : 0;
    const tone = c.queued > 100 ? 'red' : c.queued > 10 ? 'yellow' : 'green';
    return `<div style="display:flex;flex-direction:column;gap:2px">
      <div style="font-size:18px;font-weight:600;line-height:1.1" class="${tone}">${num(c.linked)}<span style="font-size:13px;font-weight:400;color:var(--text2)"> / ${num(total)} (${linkedPct}%)</span></div>
      <div style="font-size:11px;color:var(--text2)">queued ${c.queued} · review ${c.needs_review} · no_match ${c.no_match} · failed ${c.failed}</div>
    </div>`;
  };
  html += rowHTML('SF-link backfill (A7)', sfCellHTML(dsf), sfCellHTML(gsf));

  html += '</div>';
  host.innerHTML = html;
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
    // A5 (2026-06-06): a disconnected/errored connector can't be fixed by
    // "Sync Now" (it'll just fail). Give it the real next action \u2014 Reconnect
    // (honest guidance, since auth is provisioned outside the app) \u2014 and let a
    // stale duplicate be removed. Field names match the connector_accounts list
    // payload (display_name / last_sync_at / last_error).
    const _healthyStatuses = ['active', 'healthy', 'degraded'];
    connectors.forEach(conn => {
      const status = conn.status || 'unknown';
      const isUsable = _healthyStatuses.indexOf(status) !== -1;
      const statusCls = (status === 'active' || status === 'healthy') ? 'healthy'
        : status === 'degraded' ? 'degraded'
        : 'error';
      const icon = conn.connector_type === 'email' ? 'E'
        : conn.connector_type === 'calendar' ? 'C'
        : conn.connector_type === 'salesforce' ? 'SF'
        : conn.connector_type?.substring(0, 2).toUpperCase() || '?';
      const label = conn.display_name || conn.label || '';
      const lastSync = conn.last_sync_at || conn.last_synced_at || null;
      const errMsg = conn.last_error || conn.error_message || '';
      const cidEnc = encodeURIComponent(conn.id || '');
      const typeEnc = encodeURIComponent(conn.connector_type || '');
      const nameEnc = encodeURIComponent((conn.connector_type || 'connector') + (label ? ' (' + label + ')' : ''));

      const actions = isUsable
        ? `<button class="q-action" onclick="_opsBtnGuard(this, triggerSync, decodeURIComponent('${typeEnc}'))">Sync Now</button>`
        : `<button class="q-action primary" onclick="reconnectConnector(decodeURIComponent('${typeEnc}'))">Reconnect \u2192</button>`
          + (conn.id ? `<button class="q-action" onclick="removeConnector(decodeURIComponent('${cidEnc}'),decodeURIComponent('${nameEnc}'))">Remove</button>` : '');

      html += `<div class="sync-card ${statusCls}">
        <div class="sync-card-icon">${icon}</div>
        <div class="sync-card-info">
          <div class="sync-card-name">${esc(conn.connector_type || 'Unknown')} ${label ? '(' + esc(label) + ')' : ''}</div>
          <div class="sync-card-status">
            Status: ${esc(status)}
            ${lastSync ? ' \u00b7 Last sync: ' + freshnessHTML(lastSync) : ''}
            ${errMsg ? ' \u00b7 <span style="color:var(--red)">' + esc(errMsg) + '</span>' : ''}
            ${!isUsable ? ' \u00b7 <span style="color:var(--red)">needs reconnect</span>' : ''}
          </div>
        </div>
        <div class="sync-card-actions">${actions}</div>
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
    // QA-10 (2026-05-18): show connector-status errors here (matches Pipeline
    // banner). Sync-log row count (unresolvedErrors.length) lives in the
    // "Recent Errors" widget below — keeping both as a single tile conflated
    // two different concepts and made every surface disagree with itself.
    html += metricCardHTML('Errors', summary.error || 0, 'connectors in error state', (summary.error || 0) > 0 ? 'red' : 'green');
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
          <button class="q-action" onclick="_opsBtnGuard(this, retrySync, decodeURIComponent('${encodeURIComponent(err.id)}'))">Retry</button>
        </div>
      </div>`;
    });
    html += '</div>';
  }

  el.innerHTML = html;
  perf.end();

  // Append perf dashboard for managers
  setTimeout(appendPerfToSyncHealth, 100);

  // Phase C (2026-05-18): mount the silent-write-failures widget at the
  // bottom of the Sync Health page. Surfaces ingest_write_failures
  // rollup so silent failures are visible in-app instead of only in Studio.
  try {
    if (typeof renderWriteFailuresWidget === 'function') {
      await renderWriteFailuresWidget(el);
    }
  } catch (e) { console.warn('[SyncHealth] write-failures widget render failed:', e?.message); }
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

// A5 (2026-06-06): reconnect path for a disconnected/errored connector. Auth is
// provisioned outside the app (Outlook/SF via Power Automate + admin setup),
// so there is no in-app OAuth handshake to launch — give the user honest,
// specific guidance instead of a button that silently does nothing.
function reconnectConnector(connectorType) {
  const t = (connectorType || 'this connector');
  const how = t === 'salesforce'
    ? 'Salesforce reconnects through the Power Automate flow + the SF connected app — re-authorize there, then the next sync will turn this green.'
    : (t === 'email' || t === 'outlook')
      ? 'Outlook reconnects through the Power Automate flow that owns the mailbox connection — re-authorize the flow, then run Sync Now.'
      : 'Re-authorize this connector at its source (the Power Automate flow / admin setup that provisioned it), then run Sync Now.';
  if (typeof showToast === 'function') showToast('Reconnect ' + t + ': ' + how, 'warn');
}
window.reconnectConnector = reconnectConnector;

// Remove a connector account (used for stale/duplicate disconnected rows). The
// API DELETE is owner-gated server-side; confirm first since it drops the row.
async function removeConnector(connectorId, displayName) {
  if (!connectorId) return;
  const ok = typeof lccConfirm === 'function'
    ? await lccConfirm('Remove the connector "' + (displayName || connectorId) + '"?\n\nThis deletes the connector account row. Use this for a stale duplicate — an active connector should be reconnected, not removed.', 'Remove')
    : (typeof confirm === 'function' ? confirm('Remove connector "' + (displayName || connectorId) + '"?') : false);
  if (!ok) return;
  const res = await opsApi('/api/connectors?id=' + encodeURIComponent(connectorId), { method: 'DELETE' });
  if (res.ok) {
    if (typeof showToast === 'function') showToast('Connector removed.', 'success');
    if (typeof renderSyncHealthPage === 'function') renderSyncHealthPage();
  } else {
    if (typeof showToast === 'function') showToast('Could not remove connector: ' + (res.error || 'unknown'), 'error');
  }
}
window.removeConnector = removeConnector;

// ============================================================================
// QUICK ACTIONS on queue items
// ============================================================================

let _quickTransitioning = false;
// Self-propelling: optimistic in-place advance after completing a queue item.
// Removes the completed row, re-elevates the next as 'do this first', decrements
// the remaining counter, and keeps the in-memory list consistent so a filter
// re-render won't resurrect it. Returns false (caller falls back to a full
// reload) when the row can't be located, so it degrades safely.
function _opsAdvanceAfterComplete(itemId) {
  try {
    const active = document.querySelector('.page.active');
    if (!active || itemId == null) return false;
    let sel;
    try { sel = '.q-item[data-q-id="' + CSS.escape(String(itemId)) + '"]'; }
    catch (_e) { sel = '.q-item[data-q-id="' + String(itemId).replace(/"/g, '\\"') + '"]'; }
    const row = active.querySelector(sel);
    if (!row) return false;
    const container = row.parentNode;
    const wasHero = row.classList.contains('pq-hero');
    try { if (typeof opsMyWorkData !== 'undefined' && Array.isArray(opsMyWorkData)) opsMyWorkData = opsMyWorkData.filter(function (i) { return String(i.id) !== String(itemId); }); } catch (_e) {}
    try { if (typeof opsResearchData !== 'undefined' && Array.isArray(opsResearchData)) opsResearchData = opsResearchData.filter(function (i) { return String(i.id) !== String(itemId); }); } catch (_e) {}
    row.style.transition = 'opacity .18s ease';
    row.style.opacity = '0';
    setTimeout(function () {
      row.remove();
      if (container) {
        if (!container.querySelector('.q-item')) { refreshActiveOpsPage(); return; }
        if (wasHero) {
          const next = container.querySelector('.q-item');
          if (next && !next.classList.contains('pq-hero')) {
            next.classList.add('pq-hero');
            if (!next.querySelector('.pq-hero-flag')) next.insertAdjacentHTML('afterbegin', '<div class="pq-hero-flag">\u25B6 Do this first</div>');
          }
        }
      }
      const prog = active.querySelector('.rc-progress span');
      if (prog) { const n = parseInt(prog.textContent, 10); if (!isNaN(n)) prog.textContent = Math.max(0, n - 1); }
    }, 180);
    return true;
  } catch (_e) { return false; }
}
window._opsAdvanceAfterComplete = _opsAdvanceAfterComplete;

async function quickTransition(itemId, newStatus, itemType) {
  if (_quickTransitioning) return;
  _quickTransitioning = true;
  try {
    if (newStatus === 'completed') {
      const ok = await lccConfirm('Mark this item as completed? This cannot be undone.', 'Complete');
      if (!ok) {
        _quickTransitioning = false;
        return;
      }
    }
    const statusLabels = { in_progress: 'Started', completed: 'Completed', waiting: 'Set to waiting', open: 'Reopened' };
    const path = itemType === 'inbox' ? `/api/inbox?id=${itemId}` : `/api/actions?id=${itemId}`;
    showToast(`Updating...`, 'info');
    const res = await opsPatch(path, { status: newStatus });
    if (res.ok) {
      showToast(statusLabels[newStatus] || `Status → ${newStatus}`, 'success');
      if (newStatus === 'completed' && _opsAdvanceAfterComplete(itemId)) {
        // advanced in place — no reload flash
      } else {
        const activePage = document.querySelector('.page.active');
        if (activePage) handlePageLoad(activePage.id);
      }
    } else {
      showToast(res.error || 'Transition failed', 'error');
    }
  } catch (e) {
    console.error('quickTransition error:', e);
    showToast('Transition failed: ' + (e.message || 'Network error'), 'error');
  } finally {
    _quickTransitioning = false;
  }
}

async function quickReassign(itemId, itemType, itemTitle = 'this item') {
  const members = await loadWorkspaceMembers() || [];
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
  const ok = await lccConfirm('Escalate this item? A manager will be notified.', 'Escalate');
  if (!ok) return;

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

  let html = `<div class="q-item ${overdueCls} ${priCls}${opts.hero ? ' pq-hero' : ''}" data-q-id="${esc(String(item.id == null ? '' : item.id))}">`;
  if (opts.hero) html += '<div class="pq-hero-flag">\u25B6 Do this first</div>';
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
