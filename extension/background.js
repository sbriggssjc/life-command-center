// ============================================================================
// LCC Assistant — Background Service Worker (Manifest V3)
// Proxies API calls, manages page context detection, badge updates
// ============================================================================

// Suppress stale-tab promise rejections from Chrome APIs (tab closed between
// event dispatch and async API call). Our code already has .catch() guards,
// but Chrome sometimes rejects internally before our handler runs.
self.addEventListener('unhandledrejection', (event) => {
  const msg = String(event.reason?.message || event.reason || '');
  if (msg.includes('No tab with id') || msg.includes('No current window')) {
    event.preventDefault();
  }
});

// ── Install / startup ───────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'settings.html' });
  }

  // Open side panel on action click instead of popup
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // Side panel API not available — popup fallback will work
    });

  // Register the "Send to LCC" context menu item for links and pages
  chrome.contextMenus.create({
    id: 'send-to-lcc',
    title: 'Send to LCC',
    contexts: ['link', 'page'],
  });
});

// ── Context menu: Send to LCC ───────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'send-to-lcc') return;

  const url = info.linkUrl || info.pageUrl;
  const subject = tab.title || url;
  const from = 'browser-extension@lcc';

  // POST to intake as a URL-sourced item
  const settings = await chrome.storage.local.get(['lccApiKey', 'lccWorkspace', 'lccHost']);
  const host = settings.lccHost || 'https://life-command-center-nine.vercel.app';

  const resp = await fetch(`${host}/api/intake-outlook-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-lcc-key': settings.lccApiKey,
      'x-lcc-workspace': settings.lccWorkspace,
    },
    body: JSON.stringify({
      message_id: `browser-${Date.now()}`,
      subject,
      from,
      received_date_time: new Date().toISOString(),
      has_attachments: true,
      body_preview: url,        // URL goes here for the fetch-URL pipeline
      source: 'browser_extension',
    }),
  });

  const result = await resp.json();
  if (result.ok) {
    chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 3000);
  }
});

// ── Domain detection ────────────────────────────────────────────────────────

function detectDomainHint(url) {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes('outlook.office')) {
      return { badge: 'OL', domain: 'outlook', label: 'Outlook' };
    }
    if (hostname.includes('costar.com')) {
      return { badge: 'CS', domain: 'costar', label: 'CoStar' };
    }
    if (hostname.includes('salesforce.com')) {
      return { badge: 'SF', domain: 'salesforce', label: 'Salesforce' };
    }
    if (hostname.includes('loopnet.com')) {
      return { badge: 'LN', domain: 'loopnet', label: 'LoopNet' };
    }
    if (hostname.includes('crexi.com')) {
      return { badge: 'CX', domain: 'crexi', label: 'Crexi' };
    }
  } catch {
    // Invalid URL
  }
  return null;
}

// ── Badge updates on tab change ─────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const hint = detectDomainHint(tab.url);
  if (hint) {
    chrome.action.setBadgeText({ text: hint.badge, tabId }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#1F3864', tabId }).catch(() => {});
  } else {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const hint = detectDomainHint(tab.url);
    if (hint) {
      await chrome.action.setBadgeText({ text: hint.badge, tabId: tab.id });
      await chrome.action.setBadgeBackgroundColor({ color: '#1F3864', tabId: tab.id });
    } else {
      await chrome.action.setBadgeText({ text: '', tabId: tab.id });
    }
  } catch {
    // Tab may have been closed
  }
});

// ── LCC API proxy ───────────────────────────────────────────────────────────

async function callLCCApi(endpoint, body) {
  const config = await chrome.storage.sync.get(['LCC_RAILWAY_URL', 'LCC_API_KEY']);
  const baseUrl = config.LCC_RAILWAY_URL;
  const apiKey = config.LCC_API_KEY;

  if (!baseUrl) {
    return { ok: false, error: 'LCC Railway URL not configured. Open Settings to set it up.' };
  }

  const url = `${baseUrl.replace(/\/+$/, '')}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-LCC-Key'] = apiKey;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });

    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

async function testConnection() {
  const config = await chrome.storage.sync.get(['LCC_RAILWAY_URL', 'LCC_API_KEY']);
  const baseUrl = config.LCC_RAILWAY_URL;
  const apiKey = config.LCC_API_KEY;

  if (!baseUrl) {
    return { ok: false, error: 'LCC Railway URL not configured' };
  }

  const headers = {};
  if (apiKey) {
    headers['X-LCC-Key'] = apiKey;
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
      method: 'GET',
      headers,
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, error: `Connection failed: ${err.message}` };
  }
}

// ── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === 'CONTEXT_DETECTED') {
    // Merge detected page context with any existing context for the same
    // property, so tenant/sales data captured on one CoStar sub-tab (e.g.
    // main detail) isn't overwritten when the user switches to Contacts or
    // Public Records and that tab emits a fresh CONTEXT_DETECTED.
    chrome.storage.session.get(['pageContext'], (result) => {
      const existing = result.pageContext || {};
      const incoming = msg.data || {};

      const sameProperty = existing.address &&
        incoming.address &&
        existing.address.toLowerCase().trim() ===
        incoming.address.toLowerCase().trim();

      const INVALID_TENANT = /^(public\s+record|building|land|market|sources|assessment|investment|not\s+disclosed|none|vacant|available|owner.occupied|confirmed|verified|research)$/i;

      let merged = incoming;
      if (sameProperty) {
        // Merge tenants — preserve from either source, dedupe by name
        const mergedTenants = [...(existing.tenants || [])];
        for (const t of (incoming.tenants || [])) {
          if (!mergedTenants.some(e => e.name === t.name)) {
            mergedTenants.push(t);
          }
        }

        const cleanIncomingTenant = incoming.tenant_name &&
          !INVALID_TENANT.test(incoming.tenant_name)
          ? incoming.tenant_name : null;
        const cleanExistingTenant = existing.tenant_name &&
          !INVALID_TENANT.test(existing.tenant_name)
          ? existing.tenant_name : null;

        const cleanIncomingPrimary = incoming.primary_tenant &&
          !INVALID_TENANT.test(incoming.primary_tenant)
          ? incoming.primary_tenant : null;
        const cleanExistingPrimary = existing.primary_tenant &&
          !INVALID_TENANT.test(existing.primary_tenant)
          ? existing.primary_tenant : null;

        merged = {
          ...existing,
          ...incoming,
          tenants: mergedTenants,
          tenant_name:    cleanIncomingTenant || cleanExistingTenant || null,
          primary_tenant: cleanIncomingPrimary || cleanExistingPrimary || null,
          // Also preserve sales history — take the longer array
          sales_history: (incoming.sales_history || []).length >=
                         (existing.sales_history || []).length
            ? incoming.sales_history
            : existing.sales_history,
        };
      }

      chrome.storage.session.set({ pageContext: merged });
    });
    respond({ ok: true });
    return false;
  }

  if (msg.type === 'LCC_API_CALL') {
    callLCCApi(msg.endpoint, msg.body).then(respond);
    return true; // async response
  }

  if (msg.type === 'TEST_CONNECTION') {
    testConnection().then(respond);
    return true;
  }

  if (msg.type === 'GET_PAGE_CONTEXT') {
    chrome.storage.session.get(['pageContext'], (result) => {
      respond(result.pageContext || null);
    });
    return true;
  }

  if (msg.type === 'OPEN_SIDE_PANEL') {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.sidePanel.open({ tabId }).catch(() => {});
    }
    respond({ ok: true });
    return false;
  }

  if (msg.type === 'SCAN_PAGE') {
    // Inject the public-records scanner into the active tab on demand
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) { respond({ ok: false, error: 'No active tab' }); return; }
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/public-records.js'],
        });
        respond({ ok: true });
      } catch (err) {
        respond({ ok: false, error: err.message });
      }
    })();
    return true; // async response
  }
});
