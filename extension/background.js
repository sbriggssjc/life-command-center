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
            // Same date: match if either price is missing (0) or within 5%.
            // Missing price = same sale captured from a different CoStar tab.
            if (ep === 0 || sp === 0) return true;
            return Math.abs(ep - sp) / Math.max(ep, sp) < 0.05;
          });
          if (matchIdx === -1) {
            mergedSales.push(s);
          } else {
            // Always merge: add new fields from incoming without overwriting
            // existing enriched fields (om_extracted, om_url, annual_rent, etc.)
            const existing_sale = mergedSales[matchIdx];
            for (const [k, v] of Object.entries(s)) {
              if (v != null && v !== '' && (existing_sale[k] == null || existing_sale[k] === '')) {
                existing_sale[k] = v;
              }
            }
          }
        }

        // Merge documents (deeds, OMs, brochures from different tabs)
        const mergedDocs = mergeArrays(existing.documents, incoming.documents, d => d.url || d.title);

        // Merge document_links (accumulated from comp pages + summary)
        const mergedDocLinks = mergeArrays(existing.document_links, incoming.document_links, d => d.url);

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
               'document_links', 'tenant_name', 'primary_tenant'].includes(key)) continue;
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
          document_links: mergedDocLinks,
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

  if (msg.type === 'FETCH_PDF_AS_BASE64') {
    // Fetch a PDF by URL and return its base64 body so the sidepanel can
    // POST it to /api/intake/stage-om as inline bytes. Runs here (not in
    // sidepanel) to bypass CORS restrictions on the listing sites' PDFs.
    (async () => {
      try {
        const r = await fetch(msg.url);
        if (!r.ok) { respond({ ok: false, error: `HTTP ${r.status}` }); return; }
        const buffer = await r.arrayBuffer();
        // Chunked base64 conversion — avoids "Maximum call stack size
        // exceeded" on large PDFs when using btoa(String.fromCharCode(...)).
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        const base64 = btoa(binary);
        const mimeType = r.headers.get('content-type') || 'application/pdf';
        respond({ ok: true, base64, mimeType, sizeBytes: buffer.byteLength });
      } catch (err) {
        respond({ ok: false, error: err.message });
      }
    })();
    return true; // async response
  }

  if (msg.type === 'STAGE_PDF_TO_LCC') {
    // Three-path dispatch (most-preferred first):
    //  Path C — /api/intake/prepare-upload → client PUT to Supabase Storage
    //           → /api/intake/stage-om { storage_path }. No size cap (100 MB
    //           bucket limit), no Vercel body cap, no Power Automate. This is
    //           the preferred path whenever the LCC API is reachable.
    //  Path A — Power Automate Flow A at `lccIntakeFlowUrl`. Legacy; kept as
    //           a fallback so non-browser intake sources (SharePoint drop,
    //           email-to-flow, mobile shortcuts) keep working. Only used if
    //           Path C fails AND a flow URL is configured.
    //  Path B — direct inline POST to /api/intake/stage-om with
    //           `bytes_base64`. Subject to Vercel's ~4.5 MB body cap; last
    //           resort when Path C is misconfigured and Flow A isn't wired.
    (async () => {
      // ---- Shared setup ---------------------------------------------------
      let buffer, mimeType, sizeBytes;
      try {
        const r = await fetch(msg.url);
        if (!r.ok) { respond({ ok: false, error: `PDF fetch HTTP ${r.status}` }); return; }
        buffer    = await r.arrayBuffer();
        mimeType  = r.headers.get('content-type') || 'application/pdf';
        sizeBytes = buffer.byteLength;
      } catch (fetchErr) {
        respond({ ok: false, error: `PDF fetch threw: ${fetchErr.message}` });
        return;
      }

      const settings = await chrome.storage.local.get([
        'lccApiKey', 'lccWorkspace', 'lccHost', 'lccIntakeFlowUrl'
      ]);
      const host = settings.lccHost || 'https://life-command-center-nine.vercel.app';
      const apiHeaders = {
        'X-LCC-Key': settings.lccApiKey || '',
        ...(settings.lccWorkspace ? { 'X-LCC-Workspace': settings.lccWorkspace } : {}),
      };

      const fileName =
        (msg.fileName && msg.fileName.trim()) ||
        (msg.url.split('/').pop() || 'upload.pdf').split('?')[0];

      const seedTags = ['sidebar_intake', msg.hostname || 'browser'].filter(Boolean);
      const intent   = msg.intent || `Staged from ${msg.sourceUrl || msg.url}`;

      // Only compute base64 when a fallback path actually needs it.
      let base64 = null;
      const getBase64 = () => {
        if (base64 !== null) return base64;
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        base64 = btoa(binary);
        return base64;
      };

      // Track each path's failure so the final response can surface *why*
      // we fell all the way through, not just the last error.
      const trail = [];

      // ── Path C: prepare-upload → client PUT → stage-om(storage_path) ────
      try {
        const prepRes = await fetch(`${host}/api/intake/prepare-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...apiHeaders },
          body: JSON.stringify({
            file_name:      fileName,
            mime_type:      mimeType,
            intake_channel: 'sidebar',
          }),
        });
        const prepText = await prepRes.text();
        let prepBody = null;
        try { prepBody = JSON.parse(prepText); } catch { /* non-json */ }

        if (!prepRes.ok || !prepBody?.ok || !prepBody.upload_url || !prepBody.storage_path) {
          trail.push({
            path: 'prepare_upload',
            step: 'mint_signed_url',
            status: prepRes.status,
            detail: prepBody?.error || prepBody?.detail || prepText.slice(0, 200),
          });
          throw new Error('prepare-upload refused');
        }

        // MV3 service workers sometimes send `Content-Length: 0` when the
        // body is a bare ArrayBuffer. Wrapping in a Blob is the reliable way
        // to force the correct body size and MIME type. See:
        //   https://bugs.chromium.org/p/chromium/issues/detail?id=1141986
        const putBody = new Blob([buffer], { type: mimeType });
        console.log('[STAGE_PDF_TO_LCC] Path C PUT', {
          url_host:   (() => { try { return new URL(prepBody.upload_url).host; } catch { return 'unknown'; } })(),
          object:     prepBody.storage_path,
          body_bytes: putBody.size,
          expected:   buffer.byteLength,
        });
        const putRes = await fetch(prepBody.upload_url, {
          method: prepBody.upload_method || 'PUT',
          headers: {
            'Content-Type': mimeType,
            ...(prepBody.upload_headers || {}),
          },
          body: putBody,
        });
        const putRespText = await putRes.text().catch(() => '');
        console.log('[STAGE_PDF_TO_LCC] Path C PUT response', {
          status: putRes.status,
          ok:     putRes.ok,
          body:   putRespText.slice(0, 300),
        });
        if (!putRes.ok) {
          trail.push({
            path:        'prepare_upload',
            step:        'storage_put',
            status:      putRes.status,
            detail:      putRespText.slice(0, 200),
            body_bytes:  putBody.size,
          });
          throw new Error('storage PUT failed');
        }

        const stageRes = await fetch(`${host}/api/intake/stage-om`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...apiHeaders },
          body: JSON.stringify({
            intake_source:  'copilot',
            intake_channel: 'sidebar',
            intent,
            artifacts: {
              primary_document: {
                storage_path: prepBody.storage_path,
                file_name:    fileName,
                mime_type:    mimeType,
              },
            },
            seed_data: { tags: seedTags },
          }),
        });
        const stageText = await stageRes.text();
        let stageBody = null;
        try { stageBody = JSON.parse(stageText); } catch { /* non-json */ }

        if (stageRes.ok && stageBody?.ok) {
          respond({
            ok:        true,
            status:    stageRes.status,
            body:      stageBody,
            sizeBytes,
            fileName,
            path:      'prepare_upload',
          });
          return;
        }
        trail.push({
          path:   'prepare_upload',
          step:   'stage_om_ref',
          status: stageRes.status,
          detail: stageBody?.error || stageBody?.detail || stageText.slice(0, 200),
        });
        throw new Error('stage-om (storage_path) refused');
      } catch (pcErr) {
        console.warn('[STAGE_PDF_TO_LCC] Path C failed, falling back', pcErr.message, trail);
        // fall through to Path A / Path B
      }

      // ── Path A: Power Automate flow (legacy, only if configured) ────────
      if (settings.lccIntakeFlowUrl) {
        try {
          const flowRes = await fetch(settings.lccIntakeFlowUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file_name:    fileName,
              mime_type:    mimeType,
              bytes_base64: getBase64(),
              source_url:   msg.sourceUrl || msg.url,
              hostname:     msg.hostname || null,
              intent,
            }),
          });
          const flowText = await flowRes.text();
          let flowBody = null;
          try { flowBody = JSON.parse(flowText); } catch { /* non-json */ }
          if (flowRes.ok && flowBody?.ok) {
            respond({
              ok:        true,
              status:    flowRes.status,
              body:      flowBody,
              sizeBytes,
              fileName,
              path:      'power_automate_flow',
            });
            return;
          }
          trail.push({
            path:   'power_automate_flow',
            status: flowRes.status,
            detail: flowText.slice(0, 200),
          });
          console.error('[STAGE_PDF_TO_LCC] Flow A returned non-ok', {
            flowUrl: settings.lccIntakeFlowUrl.replace(/\?.*$/, '?<redacted>'),
            status: flowRes.status,
            bodySnippet: flowText.slice(0, 400),
          });
        } catch (flowErr) {
          trail.push({ path: 'power_automate_flow', error: flowErr.message });
          console.error('[STAGE_PDF_TO_LCC] Flow A fetch threw', flowErr);
        }
      }

      // ── Path B: direct inline POST (Vercel ~4.5MB cap) ──────────────────
      try {
        const stageUrl = `${host}/api/intake/stage-om`;
        const postRes = await fetch(stageUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...apiHeaders },
          body: JSON.stringify({
            intake_source:  'copilot',
            intake_channel: 'sidebar',
            intent,
            artifacts: {
              primary_document: {
                bytes_base64: getBase64(),
                file_name:    fileName,
                mime_type:    mimeType,
              },
            },
            seed_data: { tags: seedTags },
          }),
        });
        const rawBody = await postRes.text();
        let payload = null;
        let parseErr = null;
        try { payload = JSON.parse(rawBody); }
        catch (e) { parseErr = e.message; }

        if (!postRes.ok || parseErr) {
          console.error('[STAGE_PDF_TO_LCC] Path B non-success', {
            stageUrl,
            status: postRes.status,
            statusText: postRes.statusText,
            contentType: postRes.headers.get('content-type'),
            bodySnippet: rawBody.slice(0, 400),
            parseErr,
          });
          trail.push({
            path:   'inline_post',
            status: postRes.status,
            detail: parseErr
              ? `non-JSON response (first 200b): ${rawBody.slice(0, 200).replace(/\s+/g, ' ')}`
              : rawBody.slice(0, 200),
          });
        }

        respond({
          ok:          postRes.ok && (payload?.ok !== false) && !parseErr,
          status:      postRes.status,
          statusText:  postRes.statusText,
          contentType: postRes.headers.get('content-type'),
          body: payload || {
            error:  parseErr ? 'non_json_response' : 'all_paths_failed',
            detail: parseErr
              ? `Server returned ${postRes.status} ${postRes.statusText}. First 200 bytes: ${rawBody.slice(0, 200).replace(/\s+/g, ' ')}`
              : rawBody.slice(0, 200),
            trail,
          },
          sizeBytes,
          fileName,
          path: 'inline_post',
        });
      } catch (err) {
        respond({
          ok:    false,
          error: err.message,
          body:  { error: 'all_paths_failed', detail: err.message, trail },
          path:  'inline_post',
          sizeBytes,
          fileName,
        });
      }
    })();
    return true; // async response
  }
});
