// ============================================================================
// LCC Assistant — Side Panel Logic
// Manages 3 tabs: Property, Search, Chat
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

function domainBadge(domain) {
  if (!domain) return '';
  const d = domain.toLowerCase();
  if (d === 'government' || d === 'gov') return '<span class="domain-badge gov">GOV</span>';
  if (d === 'dialysis' || d === 'dia') return '<span class="domain-badge dia">DIA</span>';
  return '';
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

let currentTab = 'property';
let chatHistory = [];
let selectedEntity = null;

// ── Tab switching ───────────────────────────────────────────────────────────

$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

function switchTab(tab) {
  currentTab = tab;
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));

  if (tab === 'property') {
    loadPropertyTab();
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

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1: PROPERTY
// ══════════════════════════════════════════════════════════════════════════════

// Field display config: [costarKey, label, lccEntityKey]
const PROPERTY_FIELDS = [
  ['asking_price', 'Asking Price', 'asking_price'],
  ['cap_rate', 'Cap Rate', 'cap_rate'],
  ['noi', 'NOI', 'noi'],
  ['price_per_sf', 'Price/SF', 'price_per_sf'],
  ['property_type', 'Property Type', 'asset_type'],
  ['building_class', 'Building Class', 'building_class'],
  ['year_built', 'Year Built', 'year_built'],
  ['square_footage', 'Square Footage', 'square_footage'],
  ['lot_size', 'Lot Size', 'lot_size'],
  ['stories', 'Stories', 'stories'],
  ['units', 'Units', 'units'],
  ['parking', 'Parking', 'parking'],
  ['zoning', 'Zoning', 'zoning'],
  ['occupancy', 'Occupancy', 'occupancy'],
  ['lease_term', 'Lease Term', 'lease_term'],
  ['tenant_name', 'Tenant', 'tenant_name'],
  ['owner_name', 'Owner', 'owner_name'],
  ['broker_name', 'Broker', 'broker_name'],
  ['broker_company', 'Brokerage', 'broker_company'],
  ['sale_price', 'Last Sale Price', 'sale_price'],
  ['sale_date', 'Last Sale Date', 'sale_date'],
];

async function loadPropertyTab() {
  const header = $('#propertyHeader');
  const body = $('#propertyBody');
  const actions = $('#propertyActions');

  // Determine data source: page context or selected entity from search
  const ctx = await getPageContext();
  const source = ctx && ctx.address ? ctx : selectedEntity;

  if (!source) {
    header.innerHTML = '<div class="empty-state">Browse a property on CoStar to see details here, or search for one.</div>';
    body.innerHTML = '';
    actions.innerHTML = '';
    return;
  }

  const address = source.address || source.name || '';
  const city = source.city || '';
  const state = source.state || '';
  const domain = source.domain || '';

  header.innerHTML = `
    <div class="property-title">${escapeHtml(address)}</div>
    ${city || state ? `<div class="property-subtitle">${escapeHtml([city, state].filter(Boolean).join(', '))}</div>` : ''}
    ${domain ? `<div class="property-source">Detected from ${escapeHtml(domain)}</div>` : ''}
  `;

  body.innerHTML = '<div class="loading"><div class="spinner"></div><br>Looking up property...</div>';
  actions.innerHTML = '';

  // Query LCC to see if this property exists
  const result = await apiCall('/api/chat', {
    copilot_action: 'fetch_listing_activity_context',
    params: { address },
  });

  const responseData = result.ok ? (result.data?.data || result.data || {}) : {};
  const lccEntity = responseData.entity || null;
  const matched = lccEntity && lccEntity.id;

  let html = '';

  // Match status banner
  if (result.ok) {
    html += `<div class="match-status ${matched ? 'found' : 'not-found'}">
      <span class="match-dot ${matched ? 'found' : 'not-found'}"></span>
      ${matched ? 'Found in LCC database' : 'Not yet in LCC database'}
    </div>`;
  }

  // Render fields — compare table if matched, simple list if not
  if (matched && ctx && ctx.address) {
    html += renderCompareTable(ctx, lccEntity);
  } else if (ctx && ctx.address) {
    html += renderDetectedFields(ctx);
  } else if (matched) {
    html += renderLccFields(lccEntity, responseData);
  }

  // Related data from LCC (leases, ownership, tasks)
  if (matched) {
    const govData = responseData.gov_data || {};

    // GSA Leases
    const leases = govData.gsa_leases || [];
    if (leases.length) {
      html += '<div class="section-label">Lease Details</div>';
      const lease = leases[0];
      if (lease.tenant || lease.agency) {
        html += `<div class="context-field"><span class="context-label">Tenant</span><span class="context-value">${escapeHtml(lease.tenant || lease.agency)}</span></div>`;
      }
      if (lease.lease_expiration || lease.expiration_date) {
        html += `<div class="context-field"><span class="context-label">Lease Expires</span><span class="context-value">${formatDate(lease.lease_expiration || lease.expiration_date)}</span></div>`;
      }
      if (lease.annual_rent) {
        html += `<div class="context-field"><span class="context-label">Annual Rent</span><span class="context-value">$${Number(lease.annual_rent).toLocaleString()}</span></div>`;
      }
    }

    // Ownership
    const ownership = govData.ownership_history || [];
    if (ownership.length) {
      html += '<div class="section-label">Ownership</div>';
      const latest = ownership[0];
      html += `<div class="context-field"><span class="context-label">Owner</span><span class="context-value">${escapeHtml(latest.owner_name || latest.grantee || '—')}</span></div>`;
      if (latest.entity_type || latest.owner_type) {
        html += `<div class="context-field"><span class="context-label">Entity Type</span><span class="context-value">${escapeHtml(latest.entity_type || latest.owner_type)}</span></div>`;
      }
    }

    // Active tasks
    const tasks = (responseData.active_tasks || []).slice(0, 5);
    if (tasks.length) {
      html += '<div class="section-label">Active Tasks</div>';
      tasks.forEach((task) => {
        html += `<div class="related-entity">
          <div><span style="font-weight:600;">${escapeHtml(task.title || '')}</span>
          <div class="related-type">${escapeHtml(task.status || '')}</div></div>
        </div>`;
      });
    }

    // Research status
    if (lccEntity.research_status) {
      html += `<div class="context-field" style="margin-top:8px;"><span class="context-label">Research Status</span><span class="context-value">${escapeHtml(lccEntity.research_status)}</span></div>`;
    }
  }

  body.innerHTML = html;

  // Action buttons
  if (ctx && ctx.address) {
    if (matched) {
      actions.innerHTML = `<button class="btn btn-sm btn-confirm" id="updateLccBtn">Update LCC with CoStar Data</button>`;
    } else {
      actions.innerHTML = `<button class="btn btn-sm btn-success" id="saveLccBtn">Save Property to LCC</button>`;
    }
    wirePropertyActions(ctx, lccEntity);
  }

  $('#lastUpdated').textContent = `Property: ${new Date().toLocaleTimeString()}`;
}

function renderDetectedFields(ctx) {
  let html = '<div class="section-label">Detected Data</div>';
  for (const [key, label] of PROPERTY_FIELDS) {
    const val = ctx[key];
    if (val) {
      html += `<div class="context-field">
        <span class="context-label">${escapeHtml(label)}</span>
        <span class="context-value compare-new">${escapeHtml(val)}</span>
      </div>`;
    }
  }
  return html;
}

function renderCompareTable(ctx, lccEntity) {
  // Only show fields that have data from either source
  const rows = PROPERTY_FIELDS.filter(([costarKey, , lccKey]) =>
    ctx[costarKey] || lccEntity[lccKey]
  );

  if (!rows.length) return '<div class="empty-state">No comparable fields found</div>';

  let html = '<table class="compare-table">';
  html += '<tr><th>Field</th><th>CoStar</th><th>LCC</th></tr>';

  for (const [costarKey, label, lccKey] of rows) {
    const costarVal = ctx[costarKey] || '';
    const lccVal = lccEntity[lccKey] || '';
    const costarDisplay = costarVal || '—';
    const lccDisplay = lccVal || '—';

    // Highlight differences
    let costarCls = '';
    if (costarVal && !lccVal) costarCls = 'compare-new';
    else if (costarVal && lccVal && costarVal !== lccVal) costarCls = 'compare-diff';

    html += `<tr>
      <td class="field-label">${escapeHtml(label)}</td>
      <td class="${costarCls}">${escapeHtml(costarDisplay)}</td>
      <td>${escapeHtml(lccDisplay)}</td>
    </tr>`;
  }

  html += '</table>';
  return html;
}

function renderLccFields(entity, data) {
  let html = '';
  const fields = [
    ['address', 'Address'], ['city', 'City'], ['state', 'State'],
    ['asset_type', 'Asset Type'], ['building_class', 'Building Class'],
    ['year_built', 'Year Built'], ['square_footage', 'Square Footage'],
  ];
  for (const [key, label] of fields) {
    const val = entity[key];
    if (val) {
      html += `<div class="context-field">
        <span class="context-label">${escapeHtml(label)}</span>
        <span class="context-value">${escapeHtml(String(val))}</span>
      </div>`;
    }
  }
  return html;
}

function wirePropertyActions(ctx, lccEntity) {
  const updateBtn = $('#updateLccBtn');
  const saveBtn = $('#saveLccBtn');

  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      updateBtn.disabled = true;
      updateBtn.textContent = 'Updating...';

      const result = await apiCall('/api/chat', {
        copilot_action: 'update_entity',
        params: {
          entity_id: lccEntity.id,
          source: 'costar',
          fields: extractCostarFields(ctx),
        },
      });

      if (result.ok) {
        updateBtn.className = 'btn btn-sm btn-success';
        updateBtn.textContent = 'Updated!';
        const toast = document.createElement('div');
        toast.className = 'update-toast updated';
        toast.textContent = 'Property data synced from CoStar';
        $('#propertyActions').prepend(toast);
      } else {
        updateBtn.disabled = false;
        updateBtn.textContent = 'Update Failed — Retry';
        updateBtn.className = 'btn btn-sm btn-danger';
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const result = await apiCall('/api/chat', {
        copilot_action: 'create_entity',
        params: {
          entity_type: 'asset',
          source: 'costar',
          address: ctx.address,
          city: ctx.city,
          state: ctx.state,
          fields: extractCostarFields(ctx),
        },
      });

      if (result.ok) {
        saveBtn.className = 'btn btn-sm btn-success';
        saveBtn.textContent = 'Saved!';
        const toast = document.createElement('div');
        toast.className = 'update-toast updated';
        toast.textContent = 'Property added to LCC';
        $('#propertyActions').prepend(toast);
        // Reload to show matched state
        setTimeout(() => loadPropertyTab(), 1500);
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Failed — Retry';
        saveBtn.className = 'btn btn-sm btn-danger';
      }
    });
  }
}

function extractCostarFields(ctx) {
  const fields = {};
  for (const [key] of PROPERTY_FIELDS) {
    if (ctx[key]) fields[key] = ctx[key];
  }
  return fields;
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
        switchTab('property');
      } catch {
        // Invalid entity data
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3: CHAT
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

  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();

  chatHistory.push({ role, content: text });

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg ${role}`;
  msgDiv.innerHTML = `<div class="chat-bubble">${escapeHtml(text)}</div>`;
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;

  chrome.storage.session.set({ chatHistory });
}

function clearChat() {
  chatHistory = [];
  const container = $('#chatMessages');
  container.innerHTML = '<div class="empty-state">Ask about this property or anything in your pipeline.</div>';
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
    if (currentTab === 'property') {
      loadPropertyTab();
    }
  }
});

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  const prefs = await chrome.storage.sync.get(['defaultTab']);
  if (prefs.defaultTab && prefs.defaultTab !== 'property') {
    switchTab(prefs.defaultTab);
  }

  requestAnimationFrame(async () => {
    await Promise.all([
      checkConnection(),
      updatePageContextBadge(),
      restoreChatHistory(),
    ]);

    if (currentTab === 'property') {
      loadPropertyTab();
    }
  });
}

init();
