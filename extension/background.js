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
    // Store detected page context for the sidepanel to read
    chrome.storage.session.set({ pageContext: msg.data });
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
