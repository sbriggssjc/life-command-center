// ============================================================================
// LCC Assistant — Side Panel Logic
// Manages 4 tabs: Briefing, Search, Context, Chat
// API calls made directly via fetch (no background.js dependency)
// ============================================================================

// ── Helpers ─────────────────────────────────────────────────────────────────

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function domainBadge(domain) {
  if (!domain) return '';
  const d = domain.toLowerCase();
  if (d === 'government' || d === 'gov') return '<span class="domain-badge gov">GOV</span>';
  if (d === 'dialysis' || d === 'dia') return '<span class="domain-badge dia">DIA</span>';
  return '';
}

function scoreBadge(score) {
  if (score == null) return '—';
  const cls = score > 70 ? 'score-green' : score >= 40 ? 'score-yellow' : 'score-red';
  return `<span class="score-badge ${cls}">${score}</span>`;
}

function touchColor(days) {
  if (days == null) return '';
  if (days < 30) return 'touch-green';
  if (days <= 90) return 'touch-yellow';
  return 'touch-red';
}

async function getLCCConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['LCC_RAILWAY_URL', 'LCC_API_KEY'], resolve);
  });
}

async function apiCall(endpoint, body) {
  try {
    const config = await getLCCConfig();
    const baseUrl = config.LCC_RAILWAY_URL;
    const apiKey = config.LCC_API_KEY;

    if (!baseUrl) {
      return { ok: false, error: 'LCC URL not configured. Click ⚙ to open Settings.' };
    }

    const url = `${baseUrl.replace(/\/+$/, '')}${endpoint}`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-LCC-Key'] = apiKey;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });

    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

async function getPageContext() {
  return new Promise((resolve) => {
    chrome.storage.session.get(['pageContext'], (result) => {
      resolve(result.pageContext || null);
    });
  });
}

// ── State ───────────────────────────────────────────────────────────────────

let currentTab = 'briefing';
let chatHistory = [];
let selectedEntity = null;

// ── Tab switching ───────────────────────────────────────────────────────────

$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    switchTab(tab);
  });
});

function switchTab(tab) {
  currentTab = tab;
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));

  if (tab === 'briefing' && !$('#briefingContent .priority-section')) {
    loadBriefing();
  }
  if (tab === 'context') {
    loadContextTab();
  }
}

// ── Settings ────────────────────────────────────────────────────────────────

$('#openSettings').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
});

// ── Connection check ────────────────────────────────────────────────────────

async function checkConnection() {
  try {
    const config = await getLCCConfig();
    const baseUrl = config.LCC_RAILWAY_URL;
    const apiKey = config.LCC_API_KEY;

    if (!baseUrl) {
      $('#statusDot').className = 'status-dot offline';
      $('#statusText').textContent = 'Not configured — click ⚙';
      return;
    }

    const headers = {};
    if (apiKey) headers['X-LCC-Key'] = apiKey;

    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, { headers });
    if (res.ok) {
      $('#statusDot').className = 'status-dot online';
      $('#statusText').textContent = 'Connected';
    } else {
      $('#statusDot').className = 'status-dot offline';
      $('#statusText').textContent = `Error ${res.status}`;
    }
  } catch (err) {
    $('#statusDot').className = 'status-dot offline';
    $('#statusText').textContent = 'LCC offline';
  }
}

// ── Page context badge ──────────────────────────────────────────────────────

async function updatePageContextBadge() {
  const ctx = await getPageContext();
  const badge = $('#pageContextBadge');
  if (ctx && ctx.domain) {
    badge.textContent = ctx.domain.charAt(0).toUpperCase() + ctx.domain.slice(1);
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

// ── Markdown rendering ─────────────────────────────────────────────────────

function inlineBold(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function renderBriefingMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let html = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // ## Headers
    if (trimmed.startsWith('## ')) {
      html += `<div style="font-weight:700;font-size:13px;margin:8px 0 6px;">${inlineBold(trimmed.slice(3))}</div>`;
      continue;
    }

    // Standalone bold line as section header (e.g. **STRATEGIC:**)
    const sectionMatch = trimmed.match(/^\*\*(.+?)\*\*\s*$/);
    if (sectionMatch) {
      const label = sectionMatch[1].toLowerCase();
      let cls = '';
      if (label.includes('strategic')) cls = 'strategic';
      else if (label.includes('important')) cls = 'important';
      else if (label.includes('urgent')) cls = 'urgent';
      const color = cls ? `var(--${cls})` : 'var(--navy)';
      html += `<div style="font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:10px 0 4px;color:${color};">${escapeHtml(sectionMatch[1])}</div>`;
      continue;
    }

    // Bullet list items
    if (/^[-*]\s/.test(trimmed)) {
      html += `<div style="font-size:12px;padding:3px 0 3px 10px;">${inlineBold(trimmed.replace(/^[-*]\s+/, '\u2022 '))}</div>`;
      continue;
    }

    // Numbered list items
    if (/^\d+\.\s/.test(trimmed)) {
      html += `<div style="font-size:12px;padding:3px 0 3px 10px;">${inlineBold(trimmed)}</div>`;
      continue;
    }

    // Regular text
    html += `<div style="font-size:12px;padding:2px 0;">${inlineBold(trimmed)}</div>`;
  }

  return html;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1: BRIEFING
// ══════════════════════════════════════════════════════════════════════════════

$('#refreshBriefing').addEventListener('click', loadBriefing);

async function loadBriefing() {
  const container = $('#briefingContent');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><br>Loading briefing...</div>';

  const result = await apiCall('/api/chat', { copilot_action: 'get_daily_briefing_snapshot' });

  if (!result.ok) {
    container.innerHTML = `<div class="error-state">${escapeHtml(result.error || result.data?.error || 'Failed to load briefing')}</div>`;
    return;
  }

  const data = result.data;

  // Handle AI text response format (markdown string from copilot_action dispatch)
  if (data?.response) {
    container.innerHTML = renderBriefingMarkdown(data.response);
    $('#briefingTimestamp').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    $('#lastUpdated').textContent = `Briefing: ${new Date().toLocaleTimeString()}`;
    return;
  }

  // Fallback: structured priority arrays
  const briefing = data?.briefing || data?.data?.briefing || data;
  const payload = briefing?.payload || briefing;

  const strategic = payload?.strategic_items || payload?.strategic || [];
  const important = payload?.important_items || payload?.important || [];
  const urgent = payload?.urgent_items || payload?.urgent || [];

  let html = '';

  if (strategic.length) {
    html += renderPrioritySection('strategic', 'Strategic', strategic);
  }
  if (important.length) {
    html += renderPrioritySection('important', 'Important', important);
  }
  if (urgent.length) {
    html += renderPrioritySection('urgent', 'Urgent', urgent);
  }

  if (!html) {
    html = '<div class="empty-state">No briefing items found. Try refreshing.</div>';
  }

  container.innerHTML = html;
  $('#briefingTimestamp').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  $('#lastUpdated').textContent = `Briefing: ${new Date().toLocaleTimeString()}`;
}

function renderPrioritySection(cls, label, items) {
  let html = `<div class="priority-section ${cls}">`;
  html += `<div class="priority-label">${escapeHtml(label)}</div>`;
  items.forEach((item) => {
    const title = item.title || item.entity_name || 'Untitled';
    const desc = item.context || item.status || '';
    const domain = item.domain || '';
    html += `<div class="priority-item">
      <div class="priority-item-title">${escapeHtml(title)}${domainBadge(domain)}</div>
      ${desc ? `<div class="priority-item-desc">${escapeHtml(desc)}</div>` : ''}
    </div>`;
  });
  html += '</div>';
  return html;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2: SEARCH
// ══════════════════════════════════════════════════════════════════════════════

$('#searchBtn').addEventListener('click', doSearch);
$('#searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

async function doSearch() {
  const query = $('#searchInput').value.trim();
  if (!query) return;

  const container = $('#searchResults');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><br>Searching...</div>';

  const result = await apiCall('/api/chat', {
    copilot_action: 'search_entity_targets',
    params: { query },
  });

  if (!result.ok) {
    container.innerHTML = `<div class="error-state">${escapeHtml(result.error || 'Search failed')}</div>`;
    return;
  }

  const data = result.data;
  const entities = data?.entities || data?.data?.entities || data?.results || [];

  if (!entities.length) {
    container.innerHTML = '<div class="empty-state">No results found</div>';
    return;
  }

  let html = '';
  entities.forEach((entity) => {
    const type = entity.entity_type || 'unknown';
    html += `<div class="result-card" data-entity='${escapeHtml(JSON.stringify(entity))}'>`;

    if (type === 'person') {
      html += `<div class="result-name">${escapeHtml(entity.name || '')}${domainBadge(entity.domain)}</div>`;
      html += `<div class="result-meta">${escapeHtml([entity.title, entity.company || entity.org_name].filter(Boolean).join(' at '))}</div>`;
      if (entity.email) html += `<div class="result-meta">${escapeHtml(entity.email)}</div>`;
    } else if (type === 'asset') {
      html += `<div class="result-name">${escapeHtml(entity.address || entity.name || '')}${domainBadge(entity.domain)}</div>`;
      html += `<div class="result-meta">${escapeHtml([entity.city, entity.state].filter(Boolean).join(', '))} ${escapeHtml(entity.asset_type || '')}</div>`;
    } else {
      html += `<div class="result-name">${escapeHtml(entity.name || '')}${domainBadge(entity.domain)}</div>`;
      html += `<div class="result-meta">${escapeHtml(entity.org_type || entity.entity_type || '')}</div>`;
    }

    html += '</div>';
  });

  container.innerHTML = html;

  // Click handlers for result cards
  container.querySelectorAll('.result-card').forEach((card) => {
    card.addEventListener('click', () => {
      try {
        selectedEntity = JSON.parse(card.dataset.entity);
        switchTab('context');
      } catch {
        // Invalid entity data
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3: CONTEXT
// ══════════════════════════════════════════════════════════════════════════════

async function loadContextTab() {
  const header = $('#contextHeader');
  const body = $('#contextBody');

  // Check for page context first, then selected entity
  const pageCtx = await getPageContext();

  if (pageCtx && pageCtx.domain) {
    header.innerHTML = `<div class="context-detected">Detected on this page:</div>
      <div class="card-title">${escapeHtml(pageCtx.email || pageCtx.address || pageCtx.name || pageCtx.domain)}</div>
      <div class="card-subtitle">${escapeHtml(pageCtx.entity_type || '')} via ${escapeHtml(pageCtx.domain)}</div>`;

    body.innerHTML = '<div class="loading"><div class="spinner"></div><br>Loading context...</div>';

    if (pageCtx.entity_type === 'contact' || pageCtx.email) {
      await loadContactContext({ email: pageCtx.email, name: pageCtx.name }, body);
    } else if (pageCtx.entity_type === 'property' || pageCtx.address) {
      await loadPropertyContext({ address: pageCtx.address }, body);
    } else {
      body.innerHTML = '<div class="empty-state">Unable to resolve entity from page context</div>';
    }
    return;
  }

  if (selectedEntity) {
    const type = selectedEntity.entity_type || 'unknown';
    header.innerHTML = `<div class="card-title">${escapeHtml(selectedEntity.name || selectedEntity.address || '')}</div>
      <div class="card-subtitle">${escapeHtml(type)}${domainBadge(selectedEntity.domain)}</div>`;

    body.innerHTML = '<div class="loading"><div class="spinner"></div><br>Loading context...</div>';

    if (type === 'person') {
      await loadContactContext({ entity_id: selectedEntity.id, email: selectedEntity.email }, body);
    } else if (type === 'asset') {
      await loadPropertyContext({ entity_id: selectedEntity.id, address: selectedEntity.address }, body);
    } else {
      await loadGenericContext(selectedEntity, body);
    }
    return;
  }

  header.innerHTML = '<div class="empty-state">No context loaded. Search for an entity or browse a supported site.</div>';
  body.innerHTML = '';
}

async function loadContactContext(params, body) {
  const result = await apiCall('/api/chat', {
    copilot_action: 'get_relationship_context',
    params,
  });

  if (!result.ok) {
    body.innerHTML = `<div class="error-state">${escapeHtml(result.error || 'Failed to load contact')}</div>`;
    return;
  }

  const data = result.data?.data || result.data || {};
  const entity = data.entity || {};
  const daysSince = data.days_since_contact;
  const touchClass = touchColor(daysSince);

  let html = '<div>';

  // Contact details
  html += `<div class="context-field"><span class="context-label">Name</span><span class="context-value">${escapeHtml(entity.name || '—')}</span></div>`;
  if (entity.company || entity.org_name) {
    html += `<div class="context-field"><span class="context-label">Company</span><span class="context-value">${escapeHtml(entity.company || entity.org_name)}</span></div>`;
  }
  if (entity.title) {
    html += `<div class="context-field"><span class="context-label">Title</span><span class="context-value">${escapeHtml(entity.title)}</span></div>`;
  }

  // Touch data
  html += `<div class="context-field"><span class="context-label">Last Touch</span>
    <span class="context-value touch-badge ${touchClass}">${formatDate(data.last_touch_date)}${daysSince != null ? ` (${daysSince}d)` : ''}</span></div>`;
  html += `<div class="context-field"><span class="context-label">Touchpoints</span><span class="context-value">${data.touchpoint_count || 0}</span></div>`;

  // Recommendation
  if (data.recommended_next_action) {
    html += `<div class="card" style="margin-top:8px;background:#FFFBEB;border-color:#FCD34D;">
      <div class="card-title" style="font-size:11px;color:#92400E;">Recommendation</div>
      <div style="font-size:12px;margin-top:2px;">${escapeHtml(data.recommended_next_action)}</div>
    </div>`;
  }

  // Active deals
  const deals = data.active_deals || [];
  if (deals.length) {
    html += '<div style="margin-top:10px;font-weight:600;font-size:12px;margin-bottom:4px;">Active Pursuits</div>';
    deals.forEach((deal) => {
      html += `<div class="card"><div class="card-title">${escapeHtml(deal.title || '')}</div>
        <div class="card-subtitle">${escapeHtml(deal.status || '')} &middot; ${escapeHtml(deal.priority_class || '')}</div></div>`;
    });
  }

  // Recent events
  const events = (data.recent_events || []).slice(0, 5);
  if (events.length) {
    html += '<div style="margin-top:10px;font-weight:600;font-size:12px;margin-bottom:4px;">Recent Activity</div>';
    html += '<ul class="activity-list">';
    events.forEach((evt) => {
      html += `<li class="activity-item">
        <span class="activity-date">${formatDate(evt.occurred_at)}</span> —
        ${escapeHtml(evt.title || evt.category || '')}
      </li>`;
    });
    html += '</ul>';
  }

  html += '</div>';
  body.innerHTML = html;
}

async function loadPropertyContext(params, body) {
  const result = await apiCall('/api/chat', {
    copilot_action: 'fetch_listing_activity_context',
    params,
  });

  if (!result.ok) {
    body.innerHTML = `<div class="error-state">${escapeHtml(result.error || 'Failed to load property')}</div>`;
    return;
  }

  const data = result.data?.data || result.data || {};
  const entity = data.entity || {};
  const govData = data.gov_data || {};

  let html = '<div>';

  // Property details
  html += `<div class="context-field"><span class="context-label">Address</span><span class="context-value">${escapeHtml(entity.address || entity.name || '—')}</span></div>`;
  if (entity.city || entity.state) {
    html += `<div class="context-field"><span class="context-label">Location</span><span class="context-value">${escapeHtml([entity.city, entity.state].filter(Boolean).join(', '))}</span></div>`;
  }
  if (entity.asset_type) {
    html += `<div class="context-field"><span class="context-label">Asset Type</span><span class="context-value">${escapeHtml(entity.asset_type)}</span></div>`;
  }

  // GSA lease details
  const leases = govData.gsa_leases || [];
  if (leases.length) {
    const lease = leases[0];
    html += '<div style="margin-top:10px;font-weight:600;font-size:12px;margin-bottom:4px;">Lease Details</div>';
    if (lease.tenant || lease.agency) {
      html += `<div class="context-field"><span class="context-label">Tenant</span><span class="context-value">${escapeHtml(lease.tenant || lease.agency || '')}</span></div>`;
    }
    if (lease.lease_expiration || lease.expiration_date) {
      html += `<div class="context-field"><span class="context-label">Lease Expires</span><span class="context-value">${formatDate(lease.lease_expiration || lease.expiration_date)}</span></div>`;
    }
    if (lease.annual_rent) {
      html += `<div class="context-field"><span class="context-label">Annual Rent</span><span class="context-value">$${Number(lease.annual_rent).toLocaleString()}</span></div>`;
    }
  }

  // Investment score from context packet
  const packet = data.context_packet?.payload || {};
  if (packet.valuation || entity.investment_score != null) {
    const score = entity.investment_score ?? packet.priority_score;
    if (score != null) {
      html += `<div class="context-field"><span class="context-label">Investment Score</span><span class="context-value">${scoreBadge(score)}</span></div>`;
    }
  }

  // Research status
  if (entity.research_status) {
    html += `<div class="context-field"><span class="context-label">Research Status</span><span class="context-value">${escapeHtml(entity.research_status)}</span></div>`;
  }

  // Ownership
  const ownership = govData.ownership_history || [];
  if (ownership.length) {
    const latest = ownership[0];
    html += '<div style="margin-top:10px;font-weight:600;font-size:12px;margin-bottom:4px;">Ownership</div>';
    html += `<div class="context-field"><span class="context-label">Owner</span><span class="context-value">${escapeHtml(latest.owner_name || latest.grantee || '—')}</span></div>`;
    if (latest.entity_type || latest.owner_type) {
      html += `<div class="context-field"><span class="context-label">Entity Type</span><span class="context-value">${escapeHtml(latest.entity_type || latest.owner_type)}</span></div>`;
    }
  }

  // Active tasks
  const tasks = (data.active_tasks || []).slice(0, 5);
  if (tasks.length) {
    html += '<div style="margin-top:10px;font-weight:600;font-size:12px;margin-bottom:4px;">Active Tasks</div>';
    html += '<ul class="activity-list">';
    tasks.forEach((task) => {
      html += `<li class="activity-item">
        ${escapeHtml(task.title || '')}
        <span class="activity-date">${escapeHtml(task.status || '')}</span>
      </li>`;
    });
    html += '</ul>';
  }

  // Research button
  html += `<div style="margin-top:12px;">
    <button class="btn btn-sm btn-primary" id="researchOwnershipBtn">Research Ownership</button>
  </div>`;

  html += '</div>';
  body.innerHTML = html;

  // Wire up research button
  const researchBtn = body.querySelector('#researchOwnershipBtn');
  if (researchBtn) {
    researchBtn.addEventListener('click', () => {
      chrome.storage.sync.get(['LCC_RAILWAY_URL'], (config) => {
        const base = config.LCC_RAILWAY_URL || '';
        if (base) {
          chrome.tabs.create({ url: base });
        }
      });
    });
  }
}

async function loadGenericContext(entity, body) {
  let html = '<div>';
  Object.entries(entity).forEach(([key, value]) => {
    if (value && typeof value !== 'object') {
      html += `<div class="context-field">
        <span class="context-label">${escapeHtml(key.replace(/_/g, ' '))}</span>
        <span class="context-value">${escapeHtml(String(value))}</span>
      </div>`;
    }
  });
  html += '</div>';
  body.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4: CHAT
// ══════════════════════════════════════════════════════════════════════════════

$('#chatSend').addEventListener('click', sendChat);
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});
$('#chatClear').addEventListener('click', clearChat);

async function sendChat() {
  const input = $('#chatInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  appendChatMessage('user', message);

  // Determine action from keywords
  const action = routeMessage(message);

  const result = await apiCall('/api/chat', {
    copilot_action: action,
    message,
    history: chatHistory.slice(-8),
  });

  if (!result.ok) {
    appendChatMessage('assistant', result.error || 'Sorry, I could not process that request. Check your connection settings.');
    return;
  }

  const data = result.data;
  const reply = data?.response || data?.data?.response || data?.message || JSON.stringify(data, null, 2);
  appendChatMessage('assistant', reply);
}

function routeMessage(msg) {
  const lower = msg.toLowerCase();
  if (lower.includes('briefing') || lower.includes('morning') || lower.includes('today')) return 'get_daily_briefing_snapshot';
  if (lower.includes('search') || lower.includes('find') || lower.includes('look up')) return 'search_entity_targets';
  if (lower.includes('pipeline') || lower.includes('health') || lower.includes('bottleneck')) return 'get_pipeline_intelligence';
  if (lower.includes('queue') || lower.includes('task') || lower.includes('execution')) return 'get_my_execution_queue';
  if (lower.includes('inbox') || lower.includes('triage')) return 'list_staged_intake_inbox';
  if (lower.includes('contact') || lower.includes('call') || lower.includes('outreach')) return 'get_hot_business_contacts';
  if (lower.includes('sync') || lower.includes('connector')) return 'get_sync_run_health';
  return 'chat';
}

function appendChatMessage(role, text) {
  const container = $('#chatMessages');

  // Clear empty state
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();

  chatHistory.push({ role, content: text });

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg ${role}`;
  msgDiv.innerHTML = `<div class="chat-bubble">${escapeHtml(text)}</div>`;
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;

  // Persist to session storage
  chrome.storage.session.set({ chatHistory });
}

function clearChat() {
  chatHistory = [];
  const container = $('#chatMessages');
  container.innerHTML = '<div class="empty-state">Ask anything about your pipeline, contacts, or deals.</div>';
  chrome.storage.session.remove('chatHistory');
}

// Restore chat history on load
async function restoreChatHistory() {
  const stored = await chrome.storage.session.get(['chatHistory']);
  if (stored.chatHistory && stored.chatHistory.length) {
    chatHistory = stored.chatHistory;
    const container = $('#chatMessages');
    container.innerHTML = '';
    chatHistory.forEach((msg) => {
      const msgDiv = document.createElement('div');
      msgDiv.className = `chat-msg ${msg.role}`;
      msgDiv.innerHTML = `<div class="chat-bubble">${escapeHtml(msg.content)}</div>`;
      container.appendChild(msgDiv);
    });
    container.scrollTop = container.scrollHeight;
  }
}

// ── Storage listener for live context updates ───────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.pageContext) {
    updatePageContextBadge();
    if (currentTab === 'context') {
      loadContextTab();
    }
  }
});

// ── Init (deferred to after first paint) ────────────────────────────────────

async function init() {
  // Load default tab preference
  const prefs = await chrome.storage.sync.get(['defaultTab']);
  if (prefs.defaultTab && prefs.defaultTab !== 'briefing') {
    switchTab(prefs.defaultTab);
  }

  // These are deferred — UI renders instantly, then data loads
  requestAnimationFrame(async () => {
    await Promise.all([
      checkConnection(),
      updatePageContextBadge(),
      restoreChatHistory(),
    ]);

    // Auto-load briefing if on briefing tab
    if (currentTab === 'briefing') {
      loadBriefing();
    }
  });
}

init();
