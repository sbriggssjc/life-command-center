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

      const INVALID_TENANT = /^(public\s+record|building|land|market|submarket|sources|assessment|investment|not\s+disclosed|none|vacant|available|owner.occupied|confirmed|verified|research|industry|sector|property\s+type|property\s+subtype|building\s+class|tenancy|single\s+tenant|multi.tenant|net\s+lease|gross\s+lease|nnn|modified\s+gross|buyer|seller|broker|listing\s+broker|buyer\s+broker|lender|owner|recorded\s+buyer|recorded\s+seller|true\s+buyer|true\s+seller|current\s+owner)$/i;

      // Reject garbage contact names — defense-in-depth (also filtered in costar.js)
      const INVALID_CONTACT = /^(since\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|since\s+\d|seller\s*$|buyer\s*$|buyer\s+contacts?|seller\s+contacts?|investment\s+manager|research\s+consultant|other\s*[-–—]\s*private|president|vice\s+president|officer|director|manager|analyst|consultant|partner|principal|agent|broker|owner|lender|not\s+disclosed|not\s+available|confirmed|verified|research\s+complete|comp\s+status|united\s+states|logo|source|add\s+notes|name$)$/i;
      const isGarbageContact = (name) => {
        if (!name || name.length <= 2) return true;
        if (INVALID_CONTACT.test(name.trim())) return true;
        if (/^[A-Z][a-z]+.*,\s*[A-Z]{2}\s+\d{4,5}/.test(name)) return true;
        if (/\d{5}[A-Z]/.test(name)) return true;
        if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d/i.test(name)) return true;
        return false;
      };

      let merged = incoming;
      if (sameProperty) {
        // Deep-merge arrays: preserve data from ALL tabs, not just the latest
        // Helper: merge two arrays by deduping on a key field (or by value)
        const mergeArrays = (a, b, keyFn) => {
          const result = [...(a || [])];
          for (const item of (b || [])) {
            const key = keyFn ? keyFn(item) : JSON.stringify(item);
            if (!result.some(r => (keyFn ? keyFn(r) : JSON.stringify(r)) === key)) {
              result.push(item);
            }
          }
          return result;
        };

        // Merge tenants by name
        const mergedTenants = mergeArrays(existing.tenants, incoming.tenants, t => t.name);

        // Merge contacts by name (listing brokers from Summary, buyer brokers from Sale tab)
        const mergedContacts = mergeArrays(existing.contacts, incoming.contacts, c => (c.name || '') + '|' + (c.role || ''))
          .filter(c => !isGarbageContact(c.name));

        // Merge sales_history by normalized date (combine deed records from different tabs).
        // When two sales share the same date and similar price, keep the one with more fields.
        const normPrice = (s) => {
          if (!s) return 0;
          const c = s.replace(/[^0-9.kmb]/gi, '');
          let n = parseFloat(c) || 0;
          if (/[Mm]/.test(s)) n *= 1e6;
          else if (/[Kk]/.test(s)) n *= 1e3;
          return n;
        };
        const normDate = (s) => {
          if (!s) return '';
          const d = new Date(s);
          return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : (s || '').toLowerCase().trim();
        };
        const fieldCount = (o) => Object.keys(o).filter(k => o[k] != null && o[k] !== '').length;
        const mergedSales = [...(existing.sales_history || [])];
        for (const s of (incoming.sales_history || [])) {
          const sd = normDate(s.sale_date || s.date || s.sold_date);
          const sp = normPrice(s.sale_price || s.price);
          const matchIdx = mergedSales.findIndex(e => {
            const ed = normDate(e.sale_date || e.date || e.sold_date);
            if (ed !== sd) return false;
            const ep = normPrice(e.sale_price || e.price);
            if (ep === 0 && sp === 0) return true;
            if (ep === 0 || sp === 0) return false;
            return Math.abs(ep - sp) / Math.max(ep, sp) < 0.05;
          });
          if (matchIdx === -1) {
            mergedSales.push(s);
          } else if (fieldCount(s) > fieldCount(mergedSales[matchIdx])) {
            mergedSales[matchIdx] = s;
          }
        }

        // Merge documents (deeds, OMs, brochures from different tabs)
        const mergedDocs = mergeArrays(existing.documents, incoming.documents, d => d.url || d.title);

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

        // Merge: existing first, incoming overwrites scalars, but arrays are deep-merged
        // For scalar fields, prefer incoming non-null over existing non-null
        const mergedScalars = {};
        for (const key of Object.keys({ ...existing, ...incoming })) {
          if (['tenants', 'contacts', 'sales_history', 'documents',
               'tenant_name', 'primary_tenant'].includes(key)) continue;
          const eVal = existing[key];
          const iVal = incoming[key];
          // Keep existing value if incoming is null/undefined/empty-array
          if (iVal == null || (Array.isArray(iVal) && iVal.length === 0)) {
            mergedScalars[key] = eVal;
          } else {
            mergedScalars[key] = iVal;
          }
        }

        merged = {
          ...mergedScalars,
          tenants: mergedTenants,
          contacts: mergedContacts,
          sales_history: mergedSales,
          documents: mergedDocs,
          tenant_name:    cleanIncomingTenant || cleanExistingTenant || null,
          primary_tenant: cleanIncomingPrimary || cleanExistingPrimary || null,
          // Preserve sale_notes_raw from whichever tab captured it
          sale_notes_raw: incoming.sale_notes_raw || existing.sale_notes_raw || null,
        };
      }

      // Final sanitization: filter garbage contacts on all paths
      if (merged.contacts && Array.isArray(merged.contacts)) {
        merged.contacts = merged.contacts.filter(c => !isGarbageContact(c.name));
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
