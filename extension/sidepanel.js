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
  if (d === 'costar') return '<span class="domain-badge" style="background:#1A5276;color:white;">CS</span>';
  if (d === 'loopnet') return '<span class="domain-badge" style="background:#E67E22;color:white;">LN</span>';
  if (d === 'crexi') return '<span class="domain-badge" style="background:#27AE60;color:white;">CX</span>';
  if (d === 'salesforce') return '<span class="domain-badge" style="background:#00A1E0;color:white;">SF</span>';
  if (d === 'public-records') return '<span class="domain-badge" style="background:#7D3C98;color:white;">PR</span>';
  return '';
}

const DOMAIN_LABELS = {
  costar: 'CoStar',
  loopnet: 'LoopNet',
  crexi: 'CREXi',
  salesforce: 'Salesforce',
  outlook: 'Outlook',
  'public-records': 'Public Records',
};

async function getLCCConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['LCC_RAILWAY_URL', 'LCC_API_KEY'], resolve);
  });
}

async function pollPipelineStatus(entityId, container) {
  try {
    await new Promise((r) => setTimeout(r, 3500));
    const config = await getLCCConfig();
    const baseUrl = config.LCC_RAILWAY_URL;
    if (!baseUrl) return;
    const url = `${baseUrl.replace(/\/+$/, '')}/api/entities?id=${entityId}&fields=metadata`;
    const headers = {};
    if (config.LCC_API_KEY) headers['X-LCC-Key'] = config.LCC_API_KEY;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    const meta = data?.entity?.metadata || data?.metadata || {};
    const summary = meta._pipeline_summary;
    const status = meta._pipeline_status;
    const lastError = meta._pipeline_last_error;

    const line = document.createElement('div');
    if (status === 'failed') {
      line.className = 'update-toast';
      line.textContent = `→ Pipeline error: ${lastError || 'unknown'}`;
    } else if (summary) {
      line.className = 'update-toast updated';
      line.textContent = `→ ${summary}`;
    } else {
      line.className = 'update-toast';
      line.style.background = '#F3F4F6';
      line.style.color = '#6B7280';
      line.style.borderColor = '#D1D5DB';
      line.textContent = '→ Domain: not matched (dialysis/government keywords not found)';
    }
    container.prepend(line);
  } catch (_) {
    // best-effort — silently skip on failure
  }
}

async function apiCall(endpoint, body, method = 'POST') {
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
      method,
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
    badge.textContent = DOMAIN_LABELS[ctx.domain] || ctx.domain.charAt(0).toUpperCase() + ctx.domain.slice(1);
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

// Extra fields from county assessor / recorder sites
const ASSESSOR_FIELDS = [
  ['parcel_number', 'Parcel / APN'],
  ['assessed_value', 'Assessed Value'],
  ['market_value', 'Market Value'],
  ['land_value', 'Land Value'],
  ['improvement_value', 'Improvement Value'],
  ['tax_amount', 'Tax Amount'],
  ['mailing_address', 'Mailing Address'],
  ['document_type', 'Document Type'],
  ['grantor', 'Grantor'],
  ['grantee', 'Grantee'],
  ['book_page', 'Book/Page'],
  ['legal_description', 'Legal Description'],
];

// Fields for SOS / business entity lookups
const ORG_FIELDS = [
  ['name', 'Entity Name'],
  ['filing_number', 'Filing Number'],
  ['status', 'Status'],
  ['entity_type_detail', 'Entity Type'],
  ['formation_date', 'Formation Date'],
  ['state_of_formation', 'Jurisdiction'],
  ['registered_agent', 'Registered Agent'],
  ['agent_address', 'Agent Address'],
  ['principal_address', 'Principal Address'],
  ['officers', 'Officers / Members'],
];

async function loadPropertyTab() {
  const header = $('#propertyHeader');
  const body = $('#propertyBody');
  const actions = $('#propertyActions');

  // Determine data source: page context or selected entity from search
  const ctx = await getPageContext();
  const source = ctx && (ctx.address || ctx.name) ? ctx : selectedEntity;

  if (!source) {
    header.innerHTML = '';
    body.innerHTML = `<div class="empty-state">
      Browse a property on CoStar, LoopNet, CREXi, or any supported site.<br><br>
      On an unsupported site?<br>
      <button class="btn btn-sm btn-primary" id="scanPageBtn" style="margin-top:8px;">Scan This Page</button>
      <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">
        Works on county assessors, recorders, SOS sites, and more
      </div>
    </div>`;
    actions.innerHTML = '';
    wireScanButton();
    return;
  }

  // Handle scan-result-empty (scanner found nothing)
  if (source.scan_result === 'empty') {
    header.innerHTML = `<div class="property-title">${escapeHtml(source.page_title || 'Unknown Page')}</div>
      <div class="property-source">Scanned page — no structured data detected</div>`;
    body.innerHTML = `<div class="empty-state">
      The scanner couldn't find structured property or entity data on this page.<br><br>
      <button class="btn btn-sm btn-primary" id="scanPageBtn" style="margin-top:6px;">Retry Scan</button>
    </div>`;
    actions.innerHTML = '';
    wireScanButton();
    return;
  }

  const entityType = source.entity_type || 'property';
  const domain = source.domain || '';
  const domainLabel = DOMAIN_LABELS[domain] || domain || 'Page';
  const siteType = source.site_type || '';

  // Organization entities (SOS / business search)
  if (entityType === 'organization') {
    loadOrgView(source, domainLabel);
    return;
  }

  // Property entities (CRE sites, assessor, recorder, search results)
  const address = source.address || source.name || '';
  const city = source.city || '';
  const state = source.state || '';

  header.innerHTML = `
    <div class="property-title">${escapeHtml(address)}</div>
    ${city || state ? `<div class="property-subtitle">${escapeHtml([city, state].filter(Boolean).join(', '))}</div>` : ''}
    <div class="property-source">${domainBadge(domain)} ${escapeHtml(domainLabel)}${siteType ? ` (${escapeHtml(siteType)})` : ''}${source._version ? ` v${source._version}` : ''}</div>
  `;

  body.innerHTML = '<div class="loading"><div class="spinner"></div><br>Looking up property...</div>';
  actions.innerHTML = '';

  // Query LCC to see if this property already exists (search by address)
  const searchResult = await apiCall('/api/chat', {
    copilot_action: 'search_entity_targets',
    params: { query: address, entity_type: 'asset' },
  });

  const entities = searchResult.ok
    ? (searchResult.data?.entities || searchResult.data?.data?.entities || searchResult.data?.results || [])
    : [];
  const lccEntity = entities.length ? entities[0] : null;
  const matched = lccEntity && lccEntity.id;

  // If matched, fetch full context for that entity
  let responseData = {};
  if (matched) {
    const ctxResult = await apiCall('/api/chat', {
      copilot_action: 'fetch_listing_activity_context',
      params: { entity_id: lccEntity.id },
    });
    responseData = ctxResult.ok ? (ctxResult.data?.data || ctxResult.data || {}) : {};
  }

  let html = '';

  // Match status banner
  if (searchResult.ok) {
    html += `<div class="match-status ${matched ? 'found' : 'not-found'}">
      <span class="match-dot ${matched ? 'found' : 'not-found'}"></span>
      ${matched ? 'Found in LCC database' : 'Not yet in LCC database'}
    </div>`;
  } else if (searchResult.error) {
    html += `<div class="match-status not-found">
      <span class="match-dot not-found"></span>
      LCC lookup: ${escapeHtml(searchResult.error)}
    </div>`;
  }

  // ── SECTION 1: Existing LCC data (shown first when matched) ───────
  if (matched) {
    html += '<div class="lcc-section">';
    html += '<div class="lcc-section-header">In LCC Database</div>';
    html += renderLccFields(lccEntity, responseData);
    html += renderRelatedLccData(responseData, lccEntity);
    html += '</div>';
  }

  // ── SECTION 2: Source data / proposed changes ─────────────────────
  if (ctx && ctx.address) {
    if (matched) {
      html += renderCompareTable(ctx, lccEntity, domainLabel);
    } else {
      html += renderDetectedFields(ctx, domainLabel);
    }
  }

  // Assessor/recorder extra fields
  if (ctx && ASSESSOR_FIELDS.some(([key]) => ctx[key])) {
    html += renderAssessorFields(ctx);
  }

  // ── SECTION 3: Tenants from source ──────────────────────────────
  const tenants = ctx?.tenants || [];
  if (tenants.length) {
    html += renderTenants(tenants, ctx);
  }

  // ── SECTION 4: Contacts from source ───────────────────────────────
  const contacts = ctx?.contacts || [];
  if (contacts.length) {
    html += renderContacts(contacts);
  }

  // ── SECTION 4: Sales history from source ──────────────────────────
  const salesHistory = ctx?.sales_history || [];
  if (salesHistory.length) {
    html += renderSalesHistory(salesHistory, ctx);
  }

  body.innerHTML = html;

  // Action buttons
  if (ctx && ctx.address) {
    const sourceLabel = escapeHtml(domainLabel);
    if (matched) {
      actions.innerHTML = `<button class="btn btn-sm btn-confirm" id="updateLccBtn">Update LCC with ${sourceLabel} Data</button>`;
    } else {
      actions.innerHTML = `<button class="btn btn-sm btn-success" id="saveLccBtn">Save Property to LCC</button>`;
    }
    wirePropertyActions(ctx, lccEntity);
  }

  // Re-run Pipeline button for assets that failed or were never processed
  if (matched && lccEntity.entity_type === 'asset') {
    const meta = lccEntity.metadata || {};
    if (meta._pipeline_status === 'failed' || !meta._pipeline_processed_at) {
      const rerunBtn = document.createElement('button');
      rerunBtn.className = 'btn btn-sm btn-secondary';
      rerunBtn.id = 'rerunPipelineBtn';
      rerunBtn.textContent = 'Re-run Pipeline';
      actions.appendChild(rerunBtn);

      rerunBtn.addEventListener('click', async () => {
        rerunBtn.disabled = true;
        rerunBtn.textContent = 'Running...';

        const result = await apiCall('/api/entities?action=process_sidebar_extraction', {
          entity_id: lccEntity.id,
        });

        if (result.ok) {
          const toast = document.createElement('div');
          toast.className = 'update-toast updated';
          toast.textContent = 'Pipeline re-ran successfully';
          actions.prepend(toast);
          pollPipelineStatus(lccEntity.id, actions).then(() => {
            rerunBtn.textContent = 'Re-run Pipeline';
            rerunBtn.disabled = false;
          });
        } else {
          const errMsg = result.data?.error || result.error || 'Unknown error';
          const toast = document.createElement('div');
          toast.className = 'update-toast';
          toast.textContent = errMsg;
          actions.prepend(toast);
          rerunBtn.textContent = 'Re-run Pipeline';
          rerunBtn.disabled = false;
        }
      });
    }
  }

  $('#lastUpdated').textContent = `Property: ${new Date().toLocaleTimeString()}`;
}

function renderDetectedFields(ctx, sourceLabel) {
  let html = `<div class="section-label">${escapeHtml(sourceLabel || 'Detected')} Data</div>`;
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

function renderCompareTable(ctx, lccEntity, sourceLabel) {
  // Only show fields where source has data that's new or different from LCC
  const rows = PROPERTY_FIELDS.filter(([srcKey, , lccKey]) =>
    ctx[srcKey] && (!lccEntity[lccKey] || ctx[srcKey] !== String(lccEntity[lccKey]))
  );

  if (!rows.length) return `<div class="section-label">No new data from ${escapeHtml(sourceLabel || 'source')}</div>`;

  let html = `<div class="section-label">Proposed Updates from ${escapeHtml(sourceLabel || 'Source')}</div>`;
  html += '<table class="compare-table">';
  html += `<tr><th>Field</th><th>${escapeHtml(sourceLabel || 'Source')}</th><th>Current LCC</th></tr>`;

  for (const [srcKey, label, lccKey] of rows) {
    const srcVal = ctx[srcKey] || '';
    const lccVal = lccEntity[lccKey] || '';
    const srcDisplay = srcVal || '—';
    const lccDisplay = lccVal || '—';

    let srcCls = '';
    if (srcVal && !lccVal) srcCls = 'compare-new';
    else if (srcVal && lccVal && srcVal !== lccVal) srcCls = 'compare-diff';

    html += `<tr>
      <td class="field-label">${escapeHtml(label)}</td>
      <td class="${srcCls}">${escapeHtml(srcDisplay)}</td>
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
  const domain = ctx.domain || 'source';
  const domainLabel = DOMAIN_LABELS[domain] || domain;

  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      updateBtn.disabled = true;
      updateBtn.textContent = 'Updating...';

      // PATCH the existing entity — merge new CRE data into metadata
      const fields = extractSourceFields(ctx);
      const metadata = { ...(lccEntity.metadata || {}), ...buildMetadata(ctx, domain) };
      const result = await apiCall(`/api/entities?id=${lccEntity.id}`, {
        ...fields,
        metadata,
        description: `Updated from ${domainLabel} on ${new Date().toLocaleDateString()}`,
      }, 'PATCH');

      if (result.ok) {
        updateBtn.className = 'btn btn-sm btn-success';
        updateBtn.textContent = 'Updated! Checking pipeline...';
        const toast = document.createElement('div');
        toast.className = 'update-toast updated';
        toast.textContent = `Property data synced from ${domainLabel}`;
        $('#propertyActions').prepend(toast);
        pollPipelineStatus(lccEntity.id, $('#propertyActions')).then(() => {
          updateBtn.textContent = 'Updated!';
        });
      } else {
        updateBtn.disabled = false;
        updateBtn.textContent = 'Update Failed — Retry';
        updateBtn.className = 'btn btn-sm btn-danger';
        const errMsg = result.error || result.data?.error || result.data?.message || `HTTP ${result.status || 'error'}`;
        const toast = document.createElement('div');
        toast.className = 'update-toast';
        toast.textContent = errMsg;
        $('#propertyActions').prepend(toast);
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const fields = extractSourceFields(ctx);
      const metadata = buildMetadata(ctx, domain);

      const result = await apiCall('/api/entities', {
        entity_type: 'asset',
        name: ctx.address,
        address: ctx.address,
        city: ctx.city,
        state: ctx.state,
        zip: ctx.zip || null,
        county: ctx.county || null,
        asset_type: fields.property_type || ctx.property_subtype || 'property',
        description: `Imported from ${domainLabel}`,
        metadata,
      });

      // If created, link the external identity (CoStar parcel/URL)
      const newEntityId = result.data?.entity?.id;
      if (result.ok && newEntityId) {
        const extId = ctx.parcel_number || ctx.page_url || ctx.address;
        await apiCall('/api/entities?action=link', {
          entity_id: newEntityId,
          source_system: domain || 'extension',
          source_type: 'property',
          external_id: extId,
          external_url: ctx.page_url || null,
        }).catch(() => {}); // linking is best-effort
      }

      if (result.ok) {
        saveBtn.className = 'btn btn-sm btn-success';
        saveBtn.textContent = 'Saved! Checking pipeline...';
        const toast = document.createElement('div');
        toast.className = 'update-toast updated';
        toast.textContent = 'Property added to LCC';
        $('#propertyActions').prepend(toast);
        pollPipelineStatus(newEntityId, $('#propertyActions')).then(() => {
          saveBtn.textContent = 'Saved!';
          setTimeout(() => loadPropertyTab(), 1500);
        });
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Failed — Retry';
        saveBtn.className = 'btn btn-sm btn-danger';
        const errMsg = result.error || result.data?.error || result.data?.message || `HTTP ${result.status || 'error'}`;
        const toast = document.createElement('div');
        toast.className = 'update-toast';
        toast.textContent = errMsg;
        $('#propertyActions').prepend(toast);
      }
    });
  }
}

function extractSourceFields(ctx) {
  const fields = {};
  for (const [key] of PROPERTY_FIELDS) {
    if (ctx[key]) fields[key] = ctx[key];
  }
  for (const [key] of ASSESSOR_FIELDS) {
    if (ctx[key]) fields[key] = ctx[key];
  }
  return fields;
}

function buildMetadata(ctx, domain) {
  // Capture ALL extracted data for the cleaning/propagation pipeline.
  // Keys match database column names where possible.
  const m = {
    source: domain || 'extension',
    source_url: ctx.page_url || null,
    extracted_at: new Date().toISOString(),
    // Financials
    asking_price: ctx.asking_price || null,
    cap_rate: ctx.cap_rate || null,
    noi: ctx.noi || null,
    price_per_sf: ctx.price_per_sf || null,
    sale_price: ctx.sale_price || null,
    sale_date: ctx.sale_date || null,
    // Building
    building_class: ctx.building_class || null,
    year_built: ctx.year_built || null,
    year_renovated: ctx.year_renovated || null,
    construction_start: ctx.construction_start || null,
    square_footage: ctx.square_footage || null,
    typical_floor_sf: ctx.typical_floor_sf || null,
    lot_size: ctx.lot_size || null,
    land_sf: ctx.land_sf || null,
    far: ctx.far || null,
    stories: ctx.stories || null,
    parking: ctx.parking || null,
    zoning: ctx.zoning || null,
    occupancy: ctx.occupancy || null,
    ownership_type: ctx.ownership_type || null,
    location_type: ctx.location_type || null,
    building_name: ctx.building_name || null,
    property_subtype: ctx.property_subtype || null,
    days_on_market: ctx.days_on_market || null,
    comp_status: ctx.comp_status || null,
    price_status: ctx.price_status || null,
    // Public records
    parcel_number: ctx.parcel_number || null,
    county: ctx.county || null,
    assessed_value: ctx.assessed_value || null,
    land_value: ctx.land_value || null,
    improvement_value: ctx.improvement_value || null,
    // Tenant / Lease
    tenancy_type: ctx.tenancy_type || null,
    owner_occupied: ctx.owner_occupied || null,
    est_rent: ctx.est_rent || null,
    lease_type: ctx.lease_type || null,
    lease_term: ctx.lease_term || null,
    lease_expiration: ctx.lease_expiration || null,
    lease_commencement: ctx.lease_commencement || null,
    rent_per_sf: ctx.rent_per_sf || null,
    annual_rent: ctx.annual_rent || null,
    expense_structure: ctx.expense_structure || null,
    renewal_options: ctx.renewal_options || null,
    guarantor: ctx.guarantor || null,
    rent_escalations: ctx.rent_escalations || null,
    sf_leased: ctx.sf_leased || null,
    // Market data
    subject_vacancy: ctx.subject_vacancy || null,
    submarket_vacancy: ctx.submarket_vacancy || null,
    market_vacancy: ctx.market_vacancy || null,
    subject_rent_psf: ctx.subject_rent_psf || null,
    market_rent_psf: ctx.market_rent_psf || null,
    submarket_12mo_leased: ctx.submarket_12mo_leased || null,
    submarket_avg_months_on_market: ctx.submarket_avg_months_on_market || null,
    submarket_12mo_sales_volume: ctx.submarket_12mo_sales_volume || null,
    market_sale_price_psf: ctx.market_sale_price_psf || null,
    // Arrays
    tenants: ctx.tenants || [],
    contacts: ctx.contacts || [],
    sales_history: ctx.sales_history || [],
  };
  // Strip null values to keep metadata clean
  for (const key of Object.keys(m)) {
    if (m[key] === null) delete m[key];
  }
  return m;
}

// ── Assessor / public records extra fields ──────────────────────────────────

function renderAssessorFields(ctx) {
  const hasAssessor = ASSESSOR_FIELDS.some(([key]) => ctx[key]);
  if (!hasAssessor) return '';

  let html = '<div class="section-label">Public Records Data</div>';
  for (const [key, label] of ASSESSOR_FIELDS) {
    const val = ctx[key];
    if (val) {
      html += `<div class="context-field">
        <span class="context-label">${escapeHtml(label)}</span>
        <span class="context-value">${escapeHtml(val)}</span>
      </div>`;
    }
  }
  return html;
}

// ── Related LCC data (leases, ownership, tasks) ────────────────────────────

function renderRelatedLccData(responseData, lccEntity) {
  let html = '';
  const govData = responseData.gov_data || {};

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

  const ownership = govData.ownership_history || [];
  if (ownership.length) {
    html += '<div class="section-label">Ownership</div>';
    const latest = ownership[0];
    html += `<div class="context-field"><span class="context-label">Owner</span><span class="context-value">${escapeHtml(latest.owner_name || latest.grantee || '—')}</span></div>`;
    if (latest.entity_type || latest.owner_type) {
      html += `<div class="context-field"><span class="context-label">Entity Type</span><span class="context-value">${escapeHtml(latest.entity_type || latest.owner_type)}</span></div>`;
    }
  }

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

  if (lccEntity.research_status) {
    html += `<div class="context-field" style="margin-top:8px;"><span class="context-label">Research Status</span><span class="context-value">${escapeHtml(lccEntity.research_status)}</span></div>`;
  }

  return html;
}

// ── Contacts display ────────────────────────────────────────────────────────

function renderTenants(tenants, ctx) {
  if (!tenants.length) return '';
  let html = '<div class="section-label">Tenants</div>';

  // Show tenancy summary fields if available
  const summaryFields = [];
  if (ctx?.tenancy_type) summaryFields.push(`Tenancy: ${ctx.tenancy_type}`);
  if (ctx?.owner_occupied) summaryFields.push(`Owner Occupied: ${ctx.owner_occupied}`);
  if (ctx?.est_rent) summaryFields.push(`Est. Rent: ${ctx.est_rent}`);
  if (ctx?.lease_type) summaryFields.push(`Lease Type: ${ctx.lease_type}`);
  if (ctx?.lease_term) summaryFields.push(`Term: ${ctx.lease_term}`);
  if (ctx?.lease_expiration) summaryFields.push(`Expires: ${ctx.lease_expiration}`);
  if (ctx?.annual_rent) summaryFields.push(`Annual Rent: ${ctx.annual_rent}`);
  if (ctx?.rent_per_sf) summaryFields.push(`Rent/SF: ${ctx.rent_per_sf}`);
  if (summaryFields.length) {
    html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;">${summaryFields.map((f) => escapeHtml(f)).join(' · ')}</div>`;
  }

  for (const t of tenants) {
    html += '<div class="contact-card">';
    html += `<div class="contact-name">${escapeHtml(t.name || '')}</div>`;
    const details = [];
    if (t.sf) details.push(t.sf);
    if (t.location) details.push(t.location);
    if (t.lease_type) details.push(t.lease_type);
    if (t.rent_per_sf) details.push(`${t.rent_per_sf}/SF`);
    if (t.lease_start && t.lease_expiration) details.push(`${t.lease_start} — ${t.lease_expiration}`);
    else if (t.lease_expiration) details.push(`Exp: ${t.lease_expiration}`);
    if (details.length) {
      html += `<div class="contact-detail">${details.map((d) => escapeHtml(d)).join(' · ')}</div>`;
    }
    html += '</div>';
  }
  return html;
}

function renderContacts(contacts) {
  if (!contacts.length) return '';
  const roleLabels = {
    listing_broker: 'Listing Broker',
    buyer_broker: 'Buyer Broker',
    seller: 'Seller',
    buyer: 'Buyer',
    lender: 'Lender',
    owner: 'Current Owner',
  };

  let html = '<div class="section-label">Contacts</div>';
  for (const c of contacts) {
    html += '<div class="contact-card">';
    html += `<div class="contact-role">${escapeHtml(roleLabels[c.role] || c.role || '')}</div>`;
    html += `<div class="contact-name">${escapeHtml(c.name || '')}</div>`;
    if (c.ownership_type) html += `<div class="contact-detail">${escapeHtml(c.ownership_type)}</div>`;
    if (c.title) html += `<div class="contact-detail">${escapeHtml(c.title)}</div>`;
    if (c.company) html += `<div class="contact-detail">${escapeHtml(c.company)}</div>`;
    if (c.address) html += `<div class="contact-detail" style="color:var(--text-secondary);">${escapeHtml(c.address)}</div>`;
    if (c.email) html += `<div class="contact-detail"><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></div>`;
    if (c.phones && c.phones.length) {
      html += `<div class="contact-detail">${c.phones.map((p) => escapeHtml(p)).join(' &middot; ')}</div>`;
    }
    if (c.website) html += `<div class="contact-detail" style="color:var(--text-secondary);font-size:10px;">${escapeHtml(c.website)}</div>`;
    html += '</div>';
  }
  return html;
}

// ── Sales history display ───────────────────────────────────────────────────

function classifySale(sale, ctx) {
  // Infer sale classification from available data
  const tags = [];
  const yearBuilt = parseInt(ctx?.year_built);
  const saleYear = parseSaleYear(sale.sale_date);

  if (yearBuilt && saleYear && saleYear < yearBuilt) {
    tags.push('Pre-development (land sale)');
  }
  if (sale.transaction_type === 'Construction Loan' || /construction/i.test(sale.loan_type || '')) {
    tags.push('Construction financing');
  }
  if (sale.sale_price && sale.sale_price !== 'Not Disclosed') {
    const price = parseFloat(sale.sale_price.replace(/[$,]/g, ''));
    const sqft = parseFloat((ctx?.square_footage || '').replace(/[^0-9.]/g, ''));
    if (price && sqft && price / sqft < 50 && yearBuilt && saleYear && saleYear < yearBuilt) {
      tags.push('Likely vacant land');
    }
  }
  return tags;
}

function parseSaleYear(dateStr) {
  if (!dateStr) return null;
  // "2/28/2019" or "Mar 27, 2026"
  const m = dateStr.match(/\d{4}/);
  return m ? parseInt(m[0]) : null;
}

function renderSalesHistory(sales, ctx) {
  if (!sales.length) return '';
  let html = '<div class="section-label">Sales History</div>';
  for (const s of sales) {
    const tags = classifySale(s, ctx);
    html += '<div class="sale-row">';
    html += '<div class="sale-row-header">';
    html += `<span class="sale-date">${escapeHtml(s.sale_date || '—')}</span>`;
    html += `<span class="sale-price">${escapeHtml(s.sale_price || s.asking_price || '—')}</span>`;
    html += '</div>';

    // Classification tags (land sale, construction, etc.)
    if (tags.length) {
      html += `<div style="margin:2px 0;"><span style="background:#FEF3C7;color:#92400E;font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;">${tags.map((t) => escapeHtml(t)).join(' · ')}</span></div>`;
    }

    // Transaction details line
    const details = [];
    if (s.cap_rate) details.push(`Cap: ${s.cap_rate}`);
    if (s.sale_type) details.push(s.sale_type);
    if (s.sale_condition) details.push(s.sale_condition);
    if (s.transaction_type) details.push(s.transaction_type);
    if (s.deed_type) details.push(s.deed_type);
    if (s.hold_period) details.push(`Hold: ${s.hold_period}`);
    if (details.length) {
      html += `<div class="sale-detail">${details.map((d) => escapeHtml(d)).join(' &middot; ')}</div>`;
    }

    // Buyer/Seller with addresses
    if (s.seller) {
      html += `<div class="sale-detail"><strong>Seller:</strong> ${escapeHtml(s.seller)}${s.seller_address ? ` — ${escapeHtml(s.seller_address)}` : ''}</div>`;
    }
    if (s.buyer) {
      html += `<div class="sale-detail"><strong>Buyer:</strong> ${escapeHtml(s.buyer)}${s.buyer_address ? ` — ${escapeHtml(s.buyer_address)}` : ''}</div>`;
    }

    // Lender/Loan
    if (s.lender || s.loan_amount) {
      let lenderLine = s.lender ? `<strong>Lender:</strong> ${escapeHtml(s.lender)}` : '<strong>Loan:</strong>';
      if (s.loan_amount) lenderLine += ` — ${escapeHtml(s.loan_amount)}`;
      if (s.loan_type) lenderLine += ` (${escapeHtml(s.loan_type)})`;
      if (s.interest_rate) lenderLine += ` @ ${escapeHtml(s.interest_rate)}`;
      if (s.loan_origination_date) lenderLine += ` — originated ${escapeHtml(s.loan_origination_date)}`;
      if (s.maturity_date) lenderLine += `, matures ${escapeHtml(s.maturity_date)}`;
      if (s.lender_address) lenderLine += `<br><span style="color:var(--text-secondary);font-size:10px;">${escapeHtml(s.lender_address)}</span>`;
      html += `<div class="sale-detail">${lenderLine}</div>`;
    }

    // Title company & document
    if (s.title_company) html += `<div class="sale-detail" style="color:var(--text-secondary);">Title: ${escapeHtml(s.title_company)}</div>`;
    if (s.document_number) html += `<div class="sale-detail" style="color:var(--text-secondary);">Doc #${escapeHtml(s.document_number)}</div>`;

    html += '</div>';
  }
  return html;
}

// ── Organization view (SOS / business entity lookups) ───────────────────────

function loadOrgView(source, domainLabel) {
  const header = $('#propertyHeader');
  const body = $('#propertyBody');
  const actions = $('#propertyActions');

  const name = source.name || 'Unknown Entity';
  const siteType = source.site_type || 'business-search';

  header.innerHTML = `
    <div class="property-title">${escapeHtml(name)}</div>
    <div class="property-source">${domainBadge(source.domain)} ${escapeHtml(domainLabel)} (${escapeHtml(siteType)})</div>
  `;

  let html = '<div class="section-label">Entity Details</div>';
  for (const [key, label] of ORG_FIELDS) {
    const val = source[key];
    if (val) {
      html += `<div class="context-field">
        <span class="context-label">${escapeHtml(label)}</span>
        <span class="context-value">${escapeHtml(val)}</span>
      </div>`;
    }
  }

  if (!ORG_FIELDS.some(([key]) => source[key])) {
    html += '<div class="empty-state">No entity details found</div>';
  }

  body.innerHTML = html;

  // Action: save org to LCC or search for it
  actions.innerHTML = `
    <button class="btn btn-sm btn-primary" id="searchOrgBtn">Search in LCC</button>
    <button class="btn btn-sm btn-success" id="saveOrgBtn" style="margin-left:6px;">Save to LCC</button>
  `;

  const searchBtn = $('#searchOrgBtn');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      $('#searchInput').value = name;
      switchTab('search');
      doSearch();
    });
  }

  const saveBtn = $('#saveOrgBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const fields = {};
      for (const [key] of ORG_FIELDS) {
        if (source[key]) fields[key] = source[key];
      }

      const result = await apiCall('/api/entities', {
        entity_type: 'organization',
        name,
        org_type: fields.entity_type_detail || null,
        description: `Imported from ${source.domain || 'public-records'}`,
      });

      if (result.ok) {
        saveBtn.className = 'btn btn-sm btn-success';
        saveBtn.textContent = 'Saved!';
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Failed — Retry';
        saveBtn.className = 'btn btn-sm btn-danger';
        const errMsg = result.error || result.data?.error || result.data?.message || `HTTP ${result.status || 'error'}`;
        const toast = document.createElement('div');
        toast.className = 'update-toast';
        toast.textContent = errMsg;
        saveBtn.parentElement?.prepend(toast);
      }
    });
  }

  $('#lastUpdated').textContent = `Entity: ${new Date().toLocaleTimeString()}`;
}

// ── Scan This Page ──────────────────────────────────────────────────────────

function wireScanButton() {
  const scanBtn = $('#scanPageBtn');
  if (!scanBtn) return;

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'SCAN_PAGE' }, resolve);
      });

      if (!response?.ok) {
        scanBtn.textContent = 'Scan Failed';
        scanBtn.className = 'btn btn-sm btn-danger';
        setTimeout(() => {
          scanBtn.disabled = false;
          scanBtn.textContent = 'Scan This Page';
          scanBtn.className = 'btn btn-sm btn-primary';
        }, 2000);
      }
      // If successful, the scanner will send CONTEXT_DETECTED → storage update
      // → storage listener will call loadPropertyTab() automatically
    } catch {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan This Page';
    }
  });
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
