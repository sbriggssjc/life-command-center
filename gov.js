// Government Dashboard Module for Life Command Center
// Loaded after index.html, has access to global variables and functions

// Module state variables
let govCharts = {};
let researchQueue = [];
let researchIdx = 0;
let researchCompleted = 0;
let researchMode = "ownership";
let countyCache = {};
let acTimeout = null;

// State code to full name mapping
const STATE_FULL = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia'
};

// ============================================================================
// CORE API FUNCTION
// ============================================================================

async function govQuery(table, select, params) {
  const url = new URL(`${GOV_SUPABASE_URL}/rest/v1/${table}`, 'https://localhost');
  url.searchParams.append('select', select);
  
  if (params.filter) {
    const eqIdx = params.filter.indexOf('=');
    if (eqIdx > 0) {
      const col = params.filter.substring(0, eqIdx);
      const val = params.filter.substring(eqIdx + 1);
      url.searchParams.append(col, val);
    }
  }
  if (params.order) {
    url.searchParams.append('order', params.order);
  }
  if (params.limit !== undefined) {
    url.searchParams.append('limit', params.limit);
  }
  if (params.offset !== undefined) {
    url.searchParams.append('offset', params.offset);
  }
  
  const headers = {
    'apikey': govApiKey,
    'Authorization': `Bearer ${govApiKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'count=exact'
  };
  
  try {
    const response = await fetch(url.toString(), { method: 'GET', headers });
    
    if (!response.ok) {
      console.error(`Query error: ${response.status}`, await response.text());
      return { data: [], count: 0 };
    }
    
    const data = await response.json();
    let count = data.length || 0;
    
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\d+\/(\d+)/);
      if (match) {
        count = parseInt(match[1], 10);
      }
    }
    
    return { data: Array.isArray(data) ? data : [], count };
  } catch (err) {
    console.error('govQuery error:', err);
    return { data: [], count: 0 };
  }
}

// ============================================================================
// METRIC CARD HTML
// ============================================================================

function metricHTML(label, value, sub, color) {
  const colorMap = {
    'blue': '#6c8cff',
    'green': '#34d399',
    'yellow': '#fbbf24',
    'red': '#f87171',
    'purple': '#a78bfa',
    'cyan': '#22d3ee'
  };
  
  const bgColor = colorMap[color] || '#6c8cff';
  
  return `
    <div class="metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value" style="color: ${bgColor};">${value}</div>
      ${sub ? `<div class="metric-sub">${sub}</div>` : ''}
    </div>
  `;
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadGovData() {
  // Show loading indicator
  const inner = document.getElementById('bizPageInner');
  if (inner) {
    inner.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading government data...</p></div>';
  }

  govData.properties = [];
  govData.salesComps = [];
  govData.leads = [];
  govData.contacts = [];
  govData.listings = [];
  govData.ownership = [];
  govData.gsaEvents = [];
  govData.gsaSnapshots = [];
  govData.frppRecords = [];
  govData.countyAuth = [];
  govData.loans = [];
  
  showToast('Loading government data...', 'info');
  
  try {
    // Load ownership changes with optimized query
    const ownershipRes = await govQuery('ownership_history', 
      'ownership_id, lease_number, address, city, state, prior_owner, new_owner, transfer_date, square_feet, annual_rent, estimated_value, sale_price, cap_rate, research_status, recorded_owner_name, true_owner_name, principal_names, state_of_incorporation',
      {
        order: 'estimated_value.desc',
        limit: 500
      }
    );
    govData.ownership = ownershipRes.data || [];
    
    // Load prospect leads
    const leadsRes = await govQuery('prospect_leads',
      'lead_id, lease_number, address, city, state, lessor_name, annual_rent, estimated_value, square_feet, year_built, agency_full_name, tenant_agency, lease_effective, lease_expiration, firm_term_remaining, priority_score, lead_temperature, lead_source, pipeline_status, research_status, contact_name, contact_phone, contact_email, contact_company, contact_title, recorded_owner, true_owner, owner_type, research_notes, matched_property_id, matched_contact_id, sf_lead_id, sf_contact_id, sf_opportunity_id, sf_sync_status, state_of_incorporation, phone_2, mailing_address, mailing_address_2, principal_names, rba, land_acres, year_renovated',
      {
        order: 'priority_score.desc',
        limit: 500
      }
    );
    govData.leads = leadsRes.data || [];
    
    // Load active listings
    const listingsRes = await govQuery('available_listings',
      'listing_id, address, city, state, asking_price, asking_cap_rate, listing_source, listing_status, url_status, days_on_market, tenant_agency',
      {
        order: 'asking_price.desc',
        limit: 500
      }
    );
    govData.listings = listingsRes.data || [];
    
    // Load contacts
    const contactsRes = await govQuery('contacts',
      'contact_id, name, contact_type, total_volume, phone, email',
      {
        limit: 500
      }
    );
    govData.contacts = contactsRes.data || [];
    
    // Load GSA lease events
    const gsaEventsRes = await govQuery('gsa_lease_events',
      'lease_number, event_type, event_date, annual_rent, lease_rsf, lessor_name, changed_fields',
      {
        order: 'event_date.desc',
        limit: 500
      }
    );
    govData.gsaEvents = gsaEventsRes.data || [];
    
    // Load GSA snapshots
    const gsaSnapshotsRes = await govQuery('gsa_snapshots',
      'snapshot_date, lease_number, address, city, state, lease_rsf, annual_rent, lessor_name, lease_effective, lease_expiration, field_office_name',
      {
        order: 'snapshot_date.desc',
        limit: 500
      }
    );
    govData.gsaSnapshots = gsaSnapshotsRes.data || [];
    
    // Load FRPP records
    const frppRes = await govQuery('frpp_records',
      'using_agency, using_bureau, street_address, city_name, state_name, square_feet, annual_rent_to_lessor, lease_expiration_date, property_type',
      {
        limit: 500
      }
    );
    govData.frppRecords = frppRes.data || [];
    
    // Load county authorities
    const countyRes = await govQuery('county_authorities',
      'county_name, state_code, netronline_url, assessor_url, recorder_url, treasurer_url, tax_url, gis_url, clerk_url, other_urls',
      {
        limit: 500
      }
    );
    govData.countyAuth = countyRes.data || [];
    
    // Load loans
    const loansRes = await govQuery('loans',
      'property_id, lender_name, loan_amount, loan_type, status',
      {
        limit: 500
      }
    );
    govData.loans = loansRes.data || [];
    
    // Load properties count
    const propsRes = await govQuery('properties',
      'count()',
      { limit: 0 }
    );
    govData.properties = [{ count: propsRes.count || 0 }];
    
    // Load sales comps count
    const salesRes = await govQuery('sales_transactions',
      'count()',
      { limit: 0 }
    );
    govData.salesComps = [{ count: salesRes.count || 0 }];
    
    govConnected = true;
    govDataLoaded = true;
    showToast('Government data loaded', 'success');
    renderGovTab();

  } catch (err) {
    console.error('Error loading government data:', err);
    govConnected = false;
    showToast('Error loading data', 'error');
    const inner = document.getElementById('bizPageInner');
    if (inner) {
      inner.innerHTML = '<div style="text-align:center;padding:32px;color:var(--red)"><p style="font-size:16px;margin-bottom:8px">Failed to load government data</p><p style="color:var(--text2);font-size:13px">' + (err.message || 'Unknown error') + '</p><button class="gov-btn" onclick="loadGovData()" style="margin-top:12px">Retry</button></div>';
    }
  }
}

// ============================================================================
// CHART HELPERS
// ============================================================================

function destroyChart(id) {
  if (govCharts[id]) {
    govCharts[id].destroy();
    delete govCharts[id];
  }
}

function renderBarChart(id, labels, datasets, isMoney) {
  destroyChart(id);
  
  const canvas = document.getElementById(id);
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  
  govCharts[id] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: ['#6c8cff', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee'][i % 6],
        borderColor: 'transparent',
        borderRadius: 4
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      indexAxis: 'x',
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: {
            color: '#9498a8',
            font: { size: 12 }
          }
        },
        tooltip: {
          backgroundColor: '#1f2937',
          titleColor: '#fff',
          bodyColor: '#fff',
          callbacks: {
            label: function(context) {
              let val = context.parsed.y || 0;
              if (isMoney) val = fmt(val);
              return context.dataset.label + ': ' + val;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#9498a8', font: { size: 11 } },
          grid: { color: '#2e3345' }
        },
        y: {
          ticks: {
            color: '#9498a8',
            font: { size: 11 },
            callback: function(val) {
              if (isMoney) return fmt(val);
              return fmtN(val);
            }
          },
          grid: { color: '#2e3345' }
        }
      }
    }
  });
}

function renderPieChart(id, labels, data) {
  destroyChart(id);
  
  const canvas = document.getElementById(id);
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  
  const colors = ['#6c8cff', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee', '#06b6d4', '#8b5cf6'];
  
  govCharts[id] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors.slice(0, data.length),
        borderColor: '#0f172a',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#9498a8',
            font: { size: 12 },
            padding: 15
          }
        },
        tooltip: {
          backgroundColor: '#1f2937',
          titleColor: '#fff',
          bodyColor: '#fff'
        }
      }
    }
  });
}

function renderHBarChart(id, labels, data, colors) {
  destroyChart(id);
  
  const canvas = document.getElementById(id);
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  
  if (!colors) {
    colors = labels.map(() => '#6c8cff');
  }
  
  govCharts[id] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderColor: 'transparent',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1f2937',
          titleColor: '#fff',
          bodyColor: '#fff'
        }
      },
      scales: {
        x: {
          ticks: { color: '#9498a8', font: { size: 11 } },
          grid: { color: '#2e3345' }
        },
        y: {
          ticks: { color: '#9498a8', font: { size: 11 } },
          grid: { display: false }
        }
      }
    }
  });
}

function renderGovCharts() {
  // Charts will be rendered by individual tab functions
}

// ============================================================================
// TABLE RENDERING
// ============================================================================

function ownershipTable(rows) {
  if (!rows || rows.length === 0) {
    return '<div class="table-empty">No ownership changes yet</div>';
  }
  
  let html = '<div class="table-wrapper"><table class="data-table"><thead><tr>';
  html += '<th>Lease</th><th>Location</th><th>From</th><th>To</th><th>Date</th><th>Est. Value</th><th>Sale Price</th><th>Status</th>';
  html += '</tr></thead><tbody>';
  
  rows.slice(0, 50).forEach(r => {
    const status = r.research_status || 'pending';
    const statusDot = dotClass(status);
    
    html += '<tr class="table-row">';
    html += `<td><code>${esc(r.lease_number || '')}</code></td>`;
    html += `<td>${esc(r.city || '')}, ${esc(r.state || '')}</td>`;
    html += `<td class="truncate">${esc(r.prior_owner || '')}</td>`;
    html += `<td class="truncate">${esc(r.new_owner || '')}</td>`;
    html += `<td>${r.transfer_date ? r.transfer_date.substring(0, 10) : ''}</td>`;
    html += `<td>${fmt(r.estimated_value || 0)}</td>`;
    html += `<td>${r.sale_price ? fmt(r.sale_price) : '-'}</td>`;
    html += `<td><span class="status-dot ${statusDot}"></span>${status}</td>`;
    html += '</tr>';
  });
  
  html += '</tbody></table></div>';
  return html;
}

function leadsTable(rows) {
  if (!rows || rows.length === 0) {
    return '<div class="table-empty">No leads yet</div>';
  }
  
  let html = '<div class="table-wrapper"><table class="data-table"><thead><tr>';
  html += '<th>Score</th><th>Temp</th><th>Location</th><th>Lessor</th><th>Rent</th><th>Value</th><th>Source</th><th>Pipeline</th><th>Research</th>';
  html += '</tr></thead><tbody>';
  
  rows.slice(0, 50).forEach(r => {
    const tempColor = {
      'hot': '#f87171',
      'warm': '#fbbf24',
      'cool': '#6c8cff'
    }[r.lead_temperature] || '#9498a8';
    
    const pipelineStatus = r.pipeline_status || 'new';
    const researchStatus = r.research_status || 'pending';
    
    html += '<tr class="table-row">';
    html += `<td><strong>${r.priority_score || 0}</strong></td>`;
    html += `<td><span style="color:${tempColor};">${r.lead_temperature || 'cool'}</span></td>`;
    html += `<td>${esc(r.city || '')}, ${esc(r.state || '')}</td>`;
    html += `<td class="truncate">${esc(r.lessor_name || '')}</td>`;
    html += `<td>${fmt(r.annual_rent || 0)}/yr</td>`;
    html += `<td>${fmt(r.estimated_value || 0)}</td>`;
    html += `<td>${esc(r.lead_source || '')}</td>`;
    html += `<td><span class="pill">${pipelineStatus}</span></td>`;
    html += `<td><span class="pill">${researchStatus}</span></td>`;
    html += '</tr>';
  });
  
  html += '</tbody></table></div>';
  return html;
}

function listingsTable(rows) {
  if (!rows || rows.length === 0) {
    return '<div class="table-empty">No listings yet</div>';
  }
  
  let html = '<div class="table-wrapper"><table class="data-table"><thead><tr>';
  html += '<th>Address</th><th>City</th><th>Asking</th><th>Cap Rate</th><th>Source</th><th>DOM</th><th>Status</th><th>URL</th><th>Tenant</th>';
  html += '</tr></thead><tbody>';
  
  rows.slice(0, 50).forEach(r => {
    const capRate = r.asking_cap_rate ? pct(r.asking_cap_rate) : '-';
    const status = r.listing_status || 'active';
    const urlStatus = r.url_status || 'unknown';
    
    html += '<tr class="table-row">';
    html += `<td class="truncate">${esc(r.address || '')}</td>`;
    html += `<td>${esc(r.city || '')}</td>`;
    html += `<td>${fmt(r.asking_price || 0)}</td>`;
    html += `<td>${capRate}</td>`;
    html += `<td>${esc(r.listing_source || '')}</td>`;
    html += `<td>${r.days_on_market || '-'}</td>`;
    html += `<td><span class="pill">${status}</span></td>`;
    html += `<td>${urlStatus}</td>`;
    html += `<td>${esc(r.tenant_agency || '')}</td>`;
    html += '</tr>';
  });
  
  html += '</tbody></table></div>';
  return html;
}

// ============================================================================
// COUNTY AUTHORITY SYSTEM
// ============================================================================

async function loadCountyAuthorities(states) {
  const uniqueStates = [...new Set(states)];
  
  for (const state of uniqueStates) {
    if (countyCache[state]) continue;
    
    const res = await govQuery('county_authorities',
      'county_name, state_code, netronline_url, assessor_url, recorder_url, treasurer_url, tax_url, gis_url, clerk_url, other_urls',
      { filter: `state_code=eq.${state}` }
    );
    
    countyCache[state] = {};
    res.data.forEach(c => {
      countyCache[state][c.county_name.toLowerCase()] = c;
    });
  }
}

function findCountyAuth(city, state) {
  if (!countyCache[state]) return null;
  
  const cityLower = city.toLowerCase();
  const counties = countyCache[state];
  
  // Direct match
  if (counties[cityLower]) return counties[cityLower];
  
  // Partial match
  for (const key in counties) {
    if (key.includes(cityLower)) return counties[key];
  }
  
  // Word-level match
  const cityWords = cityLower.split(/\s+/);
  for (const key in counties) {
    const keyWords = key.split(/\s+/);
    for (const cw of cityWords) {
      for (const kw of keyWords) {
        if (cw === kw && cw.length > 3) return counties[key];
      }
    }
  }
  
  // Prefix match
  for (const key in counties) {
    if (key.startsWith(cityLower.substring(0, 4))) return counties[key];
  }
  
  return null;
}

function countyBtns(city, state) {
  const auth = findCountyAuth(city, state);
  if (!auth) return '';
  
  let html = '<div class="county-btns">';
  
  if (auth.assessor_url) {
    html += linkBtn('Assessor', auth.assessor_url);
  }
  if (auth.recorder_url) {
    html += linkBtn('Recorder', auth.recorder_url);
  }
  if (auth.netronline_url) {
    html += linkBtn('NetRonline', auth.netronline_url);
  }
  if (auth.tax_url) {
    html += linkBtn('Taxes', auth.tax_url);
  }
  if (auth.gis_url) {
    html += linkBtn('GIS', auth.gis_url);
  }
  
  html += '</div>';
  return html;
}

// ============================================================================
// SEARCH & LINK BUTTONS
// ============================================================================

function searchBtn(label, query) {
  const encoded = encodeURIComponent(query);
  return `<a href="https://www.google.com/search?q=${encoded}" target="_blank" class="btn-search">${label}</a>`;
}

function sosBtns(propState, incorpState) {
  let html = '<div class="sos-btns">';
  
  const states = new Set();
  if (propState) states.add(propState);
  if (incorpState) states.add(incorpState);
  states.add('DE');
  
  states.forEach(state => {
    const url = SOS_URLS[state];
    if (url) {
      html += `<a href="${url}" target="_blank" class="btn-sos">${state} SOS</a>`;
    }
  });
  
  html += '</div>';
  return html;
}

function linkBtn(label, url) {
  if (!url) return '';
  return `<a href="${url}" target="_blank" class="btn-link">${label}</a>`;
}

function linkBtnGreen(label, url) {
  if (!url) return '';
  return `<a href="${url}" target="_blank" class="btn-link-green">${label}</a>`;
}

// ============================================================================
// AUTOCOMPLETE SYSTEM
// ============================================================================

async function searchEntities(query, dropId, inputId, onSelect) {
  if (!query || query.length < 2) {
    q(`#${dropId}`).style.display = 'none';
    return;
  }
  
  const q_lower = query.toLowerCase();
  let results = [];
  
  // Search contacts
  for (const contact of govData.contacts) {
    if (contact.name.toLowerCase().includes(q_lower)) {
      results.push({
        type: 'contact',
        label: contact.name,
        value: contact.name,
        data: contact
      });
    }
  }
  
  // Search ownership history (true owners, new owners/SPEs)
  for (const own of govData.ownership) {
    if (own.true_owner_name && own.true_owner_name.toLowerCase().includes(q_lower)) {
      results.push({
        type: 'owner',
        label: `${own.true_owner_name} (Owner)`,
        value: own.true_owner_name,
        data: own
      });
    }
    if (own.new_owner && own.new_owner.toLowerCase().includes(q_lower)) {
      results.push({
        type: 'spe',
        label: `${own.new_owner} (SPE)`,
        value: own.new_owner,
        data: own
      });
    }
  }
  
  // Search prospect leads
  for (const lead of govData.leads) {
    if (lead.true_owner && lead.true_owner.toLowerCase().includes(q_lower)) {
      results.push({
        type: 'lead_owner',
        label: `${lead.true_owner} (Lead Owner)`,
        value: lead.true_owner,
        data: lead
      });
    }
  }
  
  // Deduplicate and limit
  const seen = new Set();
  results = results.filter(r => {
    const key = `${r.type}:${r.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
  
  const dropEl = q(`#${dropId}`);
  
  if (results.length === 0) {
    dropEl.style.display = 'none';
    return;
  }
  
  dropEl.innerHTML = results.map((r, i) => `
    <div class="ac-item" onclick="selectAC('${inputId}', '${r.value.replace(/'/g, "\\'")}', '${dropId}')">${esc(r.label)}</div>
  `).join('');
  
  dropEl.style.display = 'block';
}

function setupAutocomplete(inputId, onSelect) {
  const inp = q(`#${inputId}`);
  if (!inp) return;
  
  const dropId = `${inputId}-drop`;
  
  // Create dropdown
  let drop = q(`#${dropId}`);
  if (!drop) {
    drop = document.createElement('div');
    drop.id = dropId;
    drop.className = 'ac-dropdown';
    inp.parentNode.insertBefore(drop, inp.nextSibling);
  }
  
  inp.addEventListener('input', () => {
    clearTimeout(acTimeout);
    acTimeout = setTimeout(() => {
      searchEntities(inp.value, dropId, inputId, onSelect);
    }, 150);
  });
  
  inp.addEventListener('blur', () => {
    setTimeout(() => {
      drop.style.display = 'none';
    }, 100);
  });
}

function selectAC(inputId, value, dropId) {
  q(`#${inputId}`).value = value;
  q(`#${dropId}`).style.display = 'none';
}

function attachAutocomplete() {
  setupAutocomplete('res-recorded-owner', null);
  setupAutocomplete('res-true-owner', null);
  setupAutocomplete('res-principal-names', null);
  setupAutocomplete('res-lender', null);
}

// ============================================================================
// RESEARCH WORKBENCH
// ============================================================================

async function loadResearchQueue() {
  researchQueue = [];
  researchIdx = 0;
  researchCompleted = 0;
  
  if (researchMode === 'ownership') {
    // Load ownership changes with research_status = pending or 'needs_research'
    const pending = govData.ownership.filter(o => !o.sale_price && !o.research_status || o.research_status === 'pending');
    
    for (const rec of pending.slice(0, 50)) {
      // Enrich with GSA snapshots
      const snapshot = govData.gsaSnapshots.find(s => s.lease_number === rec.lease_number);
      if (snapshot) {
        rec.gsa_snapshot = snapshot;
      }
      
      // Enrich with GSA events
      rec.gsa_events = govData.gsaEvents.filter(e => e.lease_number === rec.lease_number).slice(0, 10);
      
      // Enrich with FRPP
      const frpp = govData.frppRecords.find(f => 
        f.street_address && f.street_address.includes(rec.address) &&
        f.city_name === rec.city &&
        f.state_name === STATE_FULL[rec.state]
      );
      if (frpp) {
        rec.frpp = frpp;
      }
      
      researchQueue.push(rec);
    }
  } else {
    // Load leads with research_status = pending
    const pending = govData.leads.filter(l => !l.research_status || l.research_status === 'pending');
    
    for (const rec of pending.slice(0, 50)) {
      // Enrich with GSA snapshots
      const snapshot = govData.gsaSnapshots.find(s => s.lease_number === rec.lease_number);
      if (snapshot) {
        rec.gsa_snapshot = snapshot;
      }
      
      // Enrich with GSA events
      rec.gsa_events = govData.gsaEvents.filter(e => e.lease_number === rec.lease_number).slice(0, 10);
      
      // Enrich with FRPP
      const frpp = govData.frppRecords.find(f =>
        f.street_address && f.street_address.includes(rec.address) &&
        f.city_name === rec.city &&
        f.state_name === STATE_FULL[rec.state]
      );
      if (frpp) {
        rec.frpp = frpp;
      }
      
      researchQueue.push(rec);
    }
  }
}

function renderOwnershipResearchCard(rec) {
  const snapshot = rec.gsa_snapshot || {};
  const frpp = rec.frpp || {};
  const loan = govData.loans.find(l => l.property_id === rec.property_id) || {};
  
  let html = '<div class="research-card">';
  
  // Context panel
  html += '<div class="research-context">';
  html += `<div class="context-block">
    <div class="context-label">Property</div>
    <div class="context-value">${esc(rec.address || '')}</div>
    <div class="context-sub">${esc(rec.city || '')}, ${esc(rec.state || '')}</div>
  </div>`;
  
  html += `<div class="context-block">
    <div class="context-label">Lease / Annual Rent</div>
    <div class="context-value"><code>${esc(rec.lease_number || '')}</code></div>
    <div class="context-sub">${fmt(rec.annual_rent || 0)}/yr</div>
  </div>`;
  
  html += `<div class="context-block">
    <div class="context-label">Prior Owner → New Owner</div>
    <div class="context-value">${esc(rec.prior_owner || '')}</div>
    <div class="context-sub">→ ${esc(rec.new_owner || '')}</div>
  </div>`;
  
  html += `<div class="context-block">
    <div class="context-label">Transfer Date</div>
    <div class="context-value">${rec.transfer_date ? rec.transfer_date.substring(0, 10) : 'Unknown'}</div>
  </div>`;
  
  if (snapshot.lease_effective) {
    html += `<div class="context-block">
      <div class="context-label">GSA Lease Term</div>
      <div class="context-value">${snapshot.lease_effective.substring(0, 10)} - ${snapshot.lease_expiration.substring(0, 10)}</div>
      <div class="context-sub">${fmtN(snapshot.lease_rsf || 0)} SF @ ${fmt(snapshot.annual_rent || 0)}/yr</div>
    </div>`;
  }
  
  if (frpp.street_address) {
    html += `<div class="context-block">
      <div class="context-label">FRPP Property Type</div>
      <div class="context-value">${esc(frpp.property_type || '')}</div>
      <div class="context-sub">${fmtN(frpp.square_feet || 0)} SF</div>
    </div>`;
  }
  
  html += '</div>';
  
  // Research form
  html += '<div class="research-form">';
  
  html += '<div class="form-group">';
  html += '<label>Sale Price</label>';
  html += `<input type="number" id="res-sale-price" value="${rec.sale_price || ''}" placeholder="e.g. 5000000">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Cap Rate (%)</label>';
  html += `<input type="number" id="res-cap-rate" value="${rec.cap_rate || ''}" placeholder="e.g. 4.5" step="0.1">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Price Source</label>';
  html += `<input type="text" id="res-price-source" value="" placeholder="CoStar, CBRE, etc.">`;
  html += '</div>';
  
  html += '<div class="form-divider">Entity Details</div>';
  
  html += '<div class="form-group">';
  html += '<label>Recorded Owner Name</label>';
  html += `<input type="text" id="res-recorded-owner" value="${esc(rec.recorded_owner_name || '')}" placeholder="From deed">`;
  html += '<div id="res-recorded-owner-drop" class="ac-dropdown"></div>';
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>State of Incorporation</label>';
  html += `<input type="text" id="res-incorporation" value="${esc(rec.state_of_incorporation || '')}" placeholder="e.g. DE">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Phone</label>';
  html += `<input type="text" id="res-phone" value="${esc(rec.recorded_owner_phone || '')}" placeholder="(555) 123-4567">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Mailing Address</label>';
  html += `<input type="text" id="res-mailing" value="${esc(rec.mailing_address || '')}" placeholder="">`;
  html += '</div>';
  
  html += '<div class="form-divider">True Owner / Parents</div>';
  
  html += '<div class="form-group">';
  html += '<label>True Owner / Parent Company</label>';
  html += `<input type="text" id="res-true-owner" value="${esc(rec.true_owner_name || '')}" placeholder="">`;
  html += '<div id="res-true-owner-drop" class="ac-dropdown"></div>';
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Principal Names</label>';
  html += `<input type="text" id="res-principal-names" value="${esc(rec.principal_names || '')}" placeholder="CEO, Owner, etc.">`;
  html += '<div id="res-principal-names-drop" class="ac-dropdown"></div>';
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Contact Email</label>';
  html += `<input type="email" id="res-principal-email" value="" placeholder="contact@example.com">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Phone 2</label>';
  html += `<input type="text" id="res-phone-2" value="${esc(rec.phone_2 || '')}" placeholder="">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Mailing Address 2</label>';
  html += `<input type="text" id="res-mailing-2" value="${esc(rec.mailing_address_2 || '')}" placeholder="">`;
  html += '</div>';
  
  html += '<div class="form-divider">Property Details</div>';
  
  html += '<div class="form-group">';
  html += '<label>RBA (Rentable Building Area)</label>';
  html += `<input type="number" id="res-rba" value="${rec.rba || ''}" placeholder="">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Land Acres</label>';
  html += `<input type="number" id="res-land-acres" value="${rec.land_acres || ''}" placeholder="" step="0.01">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Year Built</label>';
  html += `<input type="number" id="res-year-built" value="${rec.year_built || ''}" placeholder="YYYY">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Year Renovated</label>';
  html += `<input type="number" id="res-year-renovated" value="${rec.year_renovated || ''}" placeholder="YYYY">`;
  html += '</div>';
  
  html += '<div class="form-divider">Loan / Financing</div>';
  
  html += '<div class="form-group">';
  html += '<label>Lender Name</label>';
  html += `<input type="text" id="res-lender" value="${esc(loan.lender_name || '')}" placeholder="">`;
  html += '<div id="res-lender-drop" class="ac-dropdown"></div>';
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Loan Amount</label>';
  html += `<input type="number" id="res-loan-amount" value="${loan.loan_amount || ''}" placeholder="">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Loan Type</label>';
  html += `<input type="text" id="res-loan-type" value="${esc(loan.loan_type || '')}" placeholder="Refinance, Construction, etc.">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Loan Status</label>';
  html += `<input type="text" id="res-loan-status" value="${esc(loan.status || '')}" placeholder="">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Research Notes</label>';
  html += `<textarea id="res-notes" placeholder="Key findings..." rows="4">${esc(rec.research_notes || '')}</textarea>`;
  html += '</div>';
  
  html += '<div class="form-divider">Quick Actions</div>';
  
  html += '<div class="quick-actions">';
  html += searchBtn('Google Search', `${rec.address} ${rec.city} ${rec.state} sale`);
  html += sosBtns(rec.state, rec.state_of_incorporation);
  html += countyBtns(rec.city, rec.state);
  html += '</div>';
  
  html += '</div>';
  
  html += '<div class="research-actions">';
  html += `<button class="btn-primary" onclick="researchSave()">Save & Next</button>`;
  html += `<button class="btn-secondary" onclick="researchNav(-1)">Back</button>`;
  html += `<button class="btn-secondary" onclick="researchNav(1)">Skip</button>`;
  html += `<button class="btn-secondary" onclick="researchMark('spe_rename')">SPE Rename</button>`;
  html += `<button class="btn-secondary" onclick="researchMark('na')">N/A</button>`;
  html += '</div>';
  
  html += '</div>';
  
  return html;
}

function renderLeadResearchCard(rec) {
  const snapshot = rec.gsa_snapshot || {};
  const frpp = rec.frpp || {};
  const loan = govData.loans.find(l => l.property_id === rec.matched_property_id) || {};
  
  let html = '<div class="research-card">';
  
  // Context panel
  html += '<div class="research-context">';
  html += `<div class="context-block">
    <div class="context-label">Property</div>
    <div class="context-value">${esc(rec.address || '')}</div>
    <div class="context-sub">${esc(rec.city || '')}, ${esc(rec.state || '')}</div>
  </div>`;
  
  html += `<div class="context-block">
    <div class="context-label">Lease / Annual Rent</div>
    <div class="context-value"><code>${esc(rec.lease_number || '')}</code></div>
    <div class="context-sub">${fmt(rec.annual_rent || 0)}/yr</div>
  </div>`;
  
  html += `<div class="context-block">
    <div class="context-label">Lessor / Owner</div>
    <div class="context-value">${esc(rec.lessor_name || '')}</div>
    <div class="context-sub">True Owner: ${esc(rec.true_owner || '')}</div>
  </div>`;
  
  html += `<div class="context-block">
    <div class="context-label">Lead Temperature</div>
    <div class="context-value">${rec.lead_temperature || 'cool'}</div>
    <div class="context-sub">Score: ${rec.priority_score || 0}</div>
  </div>`;
  
  if (snapshot.lease_effective) {
    html += `<div class="context-block">
      <div class="context-label">GSA Lease Term</div>
      <div class="context-value">${snapshot.lease_effective.substring(0, 10)} - ${snapshot.lease_expiration.substring(0, 10)}</div>
      <div class="context-sub">Firm: ${rec.firm_term_remaining || 'TBD'}</div>
    </div>`;
  }
  
  if (frpp.street_address) {
    html += `<div class="context-block">
      <div class="context-label">FRPP Type</div>
      <div class="context-value">${esc(frpp.property_type || '')}</div>
      <div class="context-sub">${fmtN(frpp.square_feet || 0)} SF</div>
    </div>`;
  }
  
  html += '</div>';
  
  // Research form
  html += '<div class="research-form">';
  
  html += '<div class="form-group">';
  html += '<label>Sale Price</label>';
  html += `<input type="number" id="res-sale-price" value="" placeholder="e.g. 5000000">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Cap Rate (%)</label>';
  html += `<input type="number" id="res-cap-rate" value="" placeholder="e.g. 4.5" step="0.1">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Price Source</label>';
  html += `<input type="text" id="res-price-source" value="" placeholder="CoStar, CBRE, etc.">`;
  html += '</div>';
  
  html += '<div class="form-divider">Ownership Research</div>';
  
  html += '<div class="form-group">';
  html += '<label>Recorded Owner</label>';
  html += `<input type="text" id="res-recorded-owner" value="${esc(rec.recorded_owner || '')}" placeholder="">`;
  html += '<div id="res-recorded-owner-drop" class="ac-dropdown"></div>';
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>True Owner / Parent</label>';
  html += `<input type="text" id="res-true-owner" value="${esc(rec.true_owner || '')}" placeholder="">`;
  html += '<div id="res-true-owner-drop" class="ac-dropdown"></div>';
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>State of Incorporation</label>';
  html += `<input type="text" id="res-incorporation" value="${esc(rec.state_of_incorporation || '')}" placeholder="">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Principal Names</label>';
  html += `<input type="text" id="res-principal-names" value="${esc(rec.principal_names || '')}" placeholder="">`;
  html += '<div id="res-principal-names-drop" class="ac-dropdown"></div>';
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Contact Email</label>';
  html += `<input type="email" id="res-principal-email" value="" placeholder="">`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Phone</label>';
  html += `<input type="text" id="res-phone" value="${esc(rec.phone_2 || '')}" placeholder="">`;
  html += '</div>';
  
  html += '<div class="form-divider">Pipeline Status</div>';
  
  html += '<div class="form-group">';
  html += '<label>Quick Status</label>';
  html += `<select id="res-quick-status">
    <option value="">Select status...</option>
    <option value="contacted">Contacted</option>
    <option value="meeting_set">Meeting Set</option>
    <option value="proposal_sent">Proposal Sent</option>
    <option value="not_for_sale">Not For Sale</option>
    <option value="dead">Dead</option>
  </select>`;
  html += '</div>';
  
  html += '<div class="form-group">';
  html += '<label>Research Notes</label>';
  html += `<textarea id="res-notes" placeholder="Key findings..." rows="4">${esc(rec.research_notes || '')}</textarea>`;
  html += '</div>';
  
  html += '<div class="form-divider">Quick Actions</div>';
  
  html += '<div class="quick-actions">';
  html += searchBtn('Google Search', `${rec.lessor_name} ${rec.address} ${rec.city}`);
  html += sosBtns(rec.state, rec.state_of_incorporation);
  html += countyBtns(rec.city, rec.state);
  html += '</div>';
  
  html += '</div>';
  
  html += '<div class="research-actions">';
  html += `<button class="btn-primary" onclick="researchSave()">Save & Next</button>`;
  html += `<button class="btn-secondary" onclick="researchNav(-1)">Back</button>`;
  html += `<button class="btn-secondary" onclick="researchNav(1)">Skip</button>`;
  html += `<button class="btn-secondary" onclick="researchMark('na')">N/A</button>`;
  html += '</div>';
  
  html += '</div>';
  
  return html;
}

function renderResearch() {
  if (researchQueue.length === 0) {
    return `<div class="research-empty">
      <div class="empty-icon">✓</div>
      <div class="empty-title">Research Complete!</div>
      <div class="empty-desc">All ${researchMode} items researched</div>
      <button class="btn-primary" onclick="location.reload()">Reload</button>
    </div>`;
  }
  
  const rec = researchQueue[researchIdx];
  const progress = Math.round((researchIdx / researchQueue.length) * 100);
  
  let html = '<div class="research-workbench">';
  
  // Progress bar
  html += `<div class="research-progress">
    <div class="progress-bar" style="width: ${progress}%"></div>
    <div class="progress-text">${researchIdx + 1} / ${researchQueue.length}</div>
  </div>`;
  
  // Mode toggle
  html += `<div class="research-mode-toggle">
    <button class="mode-btn ${researchMode === 'ownership' ? 'active' : ''}" onclick="setResearchMode('ownership')">Ownership Changes</button>
    <button class="mode-btn ${researchMode === 'leads' ? 'active' : ''}" onclick="setResearchMode('leads')">Leads</button>
  </div>`;
  
  // Render card
  if (researchMode === 'ownership') {
    html += renderOwnershipResearchCard(rec);
  } else {
    html += renderLeadResearchCard(rec);
  }
  
  html += '</div>';
  
  return html;
}

async function researchSave() {
  const rec = researchQueue[researchIdx];
  if (!rec) return;
  
  if (researchMode === 'ownership') {
    await saveOwnership(rec);
  } else {
    await saveLead(rec);
  }
  
  researchCompleted++;
  researchIdx++;
  
  if (researchIdx >= researchQueue.length) {
    renderGovTab();
    showToast('Research complete!', 'success');
  } else {
    renderGovTab();
  }
}

async function saveOwnership(rec) {
  const salePrice = parseFloat(q('#res-sale-price').value) || null;
  const capRate = parseFloat(q('#res-cap-rate').value) || null;
  
  const data = {
    sale_price: salePrice,
    cap_rate: capRate,
    recorded_owner_name: q('#res-recorded-owner').value || null,
    state_of_incorporation: q('#res-incorporation').value || null,
    recorded_owner_phone: q('#res-phone').value || null,
    mailing_address: q('#res-mailing').value || null,
    true_owner_name: q('#res-true-owner').value || null,
    principal_names: q('#res-principal-names').value || null,
    phone_2: q('#res-phone-2').value || null,
    mailing_address_2: q('#res-mailing-2').value || null,
    rba: parseFloat(q('#res-rba').value) || null,
    land_acres: parseFloat(q('#res-land-acres').value) || null,
    year_built: parseInt(q('#res-year-built').value) || null,
    year_renovated: parseInt(q('#res-year-renovated').value) || null,
    research_notes: q('#res-notes').value || null,
    research_status: 'completed'
  };
  
  await patchRecord('ownership_history', 'ownership_id', rec.ownership_id, data);
  
  if (salePrice || capRate) {
    await saveLoanFields(rec);
  }
}

async function saveLead(rec) {
  const salePrice = parseFloat(q('#res-sale-price').value) || null;
  const capRate = parseFloat(q('#res-cap-rate').value) || null;
  const quickStatus = q('#res-quick-status').value;
  
  const data = {
    recorded_owner: q('#res-recorded-owner').value || null,
    true_owner: q('#res-true-owner').value || null,
    state_of_incorporation: q('#res-incorporation').value || null,
    principal_names: q('#res-principal-names').value || null,
    phone_2: q('#res-phone').value || null,
    research_notes: q('#res-notes').value || null,
    research_status: 'completed'
  };
  
  if (quickStatus) {
    data.pipeline_status = quickStatus;
  }
  
  await patchRecord('prospect_leads', 'lead_id', rec.lead_id, data);
  
  if (salePrice || capRate) {
    await saveLoanFields(rec);
  }
}

async function patchRecord(table, idCol, idVal, data) {
  const url = `${GOV_SUPABASE_URL}/rest/v1/${table}?${idCol}=eq.${idVal}`;
  
  const headers = {
    'apikey': govApiKey,
    'Authorization': `Bearer ${govApiKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };
  
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      console.error(`PATCH error: ${response.status}`, await response.text());
      showToast('Error saving data', 'error');
      return;
    }
    
    showToast('Saved', 'success');
  } catch (err) {
    console.error('patchRecord error:', err);
    showToast('Error saving', 'error');
  }
}

async function saveLoanFields(rec) {
  const lenderName = q('#res-lender').value;
  const loanAmount = parseFloat(q('#res-loan-amount').value);
  const loanType = q('#res-loan-type').value;
  const loanStatus = q('#res-loan-status').value;
  
  if (!lenderName && !loanAmount) return;
  
  const propertyId = rec.matched_property_id || rec.property_id;
  if (!propertyId) return;
  
  // Find existing loan
  const existingLoan = govData.loans.find(l => l.property_id === propertyId);
  
  const loanData = {
    property_id: propertyId,
    lender_name: lenderName || null,
    loan_amount: loanAmount || null,
    loan_type: loanType || null,
    status: loanStatus || null
  };
  
  if (existingLoan) {
    await patchRecord('loans', 'property_id', propertyId, loanData);
  } else {
    // POST new loan
    const url = `${GOV_SUPABASE_URL}/rest/v1/loans`;
    const headers = {
      'apikey': govApiKey,
      'Authorization': `Bearer ${govApiKey}`,
      'Content-Type': 'application/json'
    };
    
    try {
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(loanData)
      });
    } catch (err) {
      console.error('Error creating loan record:', err);
    }
  }
}

function researchMark(mark) {
  const rec = researchQueue[researchIdx];
  if (!rec) return;
  
  let status = 'marked';
  if (mark === 'spe_rename') status = 'spe_rename';
  if (mark === 'na') status = 'not_applicable';
  
  const table = researchMode === 'ownership' ? 'ownership_history' : 'prospect_leads';
  const idCol = researchMode === 'ownership' ? 'ownership_id' : 'lead_id';
  
  patchRecord(table, idCol, rec[idCol], { research_status: status });
  
  researchIdx++;
  if (researchIdx >= researchQueue.length) {
    renderGovTab();
  } else {
    renderGovTab();
  }
}

function researchNav(dir) {
  researchIdx += dir;
  
  if (researchIdx < 0) researchIdx = 0;
  if (researchIdx >= researchQueue.length) researchIdx = researchQueue.length - 1;
  
  renderGovTab();
}

function setResearchMode(mode) {
  researchMode = mode;
  researchIdx = 0;
  loadResearchQueue().then(() => {
    renderGovTab();
  });
}

// ============================================================================
// TAB RENDERERS
// ============================================================================

function renderGovOverview() {
  const propCount = govData.properties[0]?.count || 0;
  const saleCount = govData.salesComps[0]?.count || 0;
  const leadCount = govData.leads.length;
  const contactCount = govData.contacts.length;
  
  // Ownership by year aggregation
  const ownByYear = {};
  govData.ownership.forEach(o => {
    if (o.transfer_date) {
      const year = o.transfer_date.substring(0, 4);
      ownByYear[year] = (ownByYear[year] || 0) + 1;
    }
  });
  
  const yearLabels = Object.keys(ownByYear).sort();
  const yearData = yearLabels.map(y => ownByYear[y]);
  
  let html = '<div class="gov-metrics">';
  html += metricHTML('Properties', fmtN(propCount), 'Government-leased', 'blue');
  html += metricHTML('Sales Comps', fmtN(saleCount), 'Completed sales', 'green');
  html += metricHTML('Active Leads', fmtN(leadCount), 'Pipeline prospects', 'yellow');
  html += metricHTML('Contacts', fmtN(contactCount), 'In database', 'purple');
  html += '</div>';
  
  if (yearLabels.length > 0) {
    html += `<div class="chart-container">
      <h3>Ownership Changes by Year</h3>
      <canvas id="chart-ov-year" height="80"></canvas>
    </div>`;
  }
  
  html += '<div class="table-section">';
  html += '<h3>Top Ownership Changes</h3>';
  html += ownershipTable(govData.ownership.slice(0, 50));
  html += '</div>';
  
  // Render chart after DOM update
  setTimeout(() => {
    if (yearLabels.length > 0) {
      renderBarChart('chart-ov-year', yearLabels, [{ label: 'Changes', data: yearData }], false);
    }
  }, 100);
  
  return html;
}

function renderGovOwnership() {
  const totalChanges = govData.ownership.length;
  const withSalePrice = govData.ownership.filter(o => o.sale_price).length;
  const needsResearch = govData.ownership.filter(o => !o.research_status || o.research_status === 'pending').length;
  const confirmedValue = govData.ownership.filter(o => o.sale_price).reduce((sum, o) => sum + (o.sale_price || 0), 0);
  
  // Value by year
  const valByYear = {};
  govData.ownership.forEach(o => {
    if (o.transfer_date && o.sale_price) {
      const year = o.transfer_date.substring(0, 4);
      valByYear[year] = (valByYear[year] || 0) + o.sale_price;
    }
  });
  
  const yearLabels = Object.keys(valByYear).sort();
  const yearData = yearLabels.map(y => valByYear[y]);
  
  let html = '<div class="gov-metrics">';
  html += metricHTML('Total Changes', fmtN(totalChanges), 'Ownership transfers', 'blue');
  html += metricHTML('With Sale Price', fmtN(withSalePrice), 'Confirmed value', 'green');
  html += metricHTML('Needs Research', fmtN(needsResearch), 'Pending', 'yellow');
  html += metricHTML('Confirmed Value', fmt(confirmedValue), 'Total', 'purple');
  html += '</div>';
  
  if (yearLabels.length > 0) {
    html += `<div class="chart-container">
      <h3>Value by Year</h3>
      <canvas id="chart-own-year" height="80"></canvas>
    </div>`;
  }
  
  html += '<div class="table-section">';
  html += '<h3>Ownership History</h3>';
  html += ownershipTable(govData.ownership.slice(0, 100));
  html += '</div>';
  
  setTimeout(() => {
    if (yearLabels.length > 0) {
      renderBarChart('chart-own-year', yearLabels, [{ label: 'Sale Value', data: yearData }], true);
    }
  }, 100);
  
  return html;
}

function renderGovPipeline() {
  const totalLeads = govData.leads.length;
  const hotCount = govData.leads.filter(l => l.lead_temperature === 'hot').length;
  const warmCount = govData.leads.filter(l => l.lead_temperature === 'warm').length;
  
  const pipelineValue = govData.leads.reduce((sum, l) => sum + (l.estimated_value || 0), 0);
  
  // Leads by source
  const bySource = {};
  govData.leads.forEach(l => {
    const source = l.lead_source || 'Unknown';
    bySource[source] = (bySource[source] || 0) + 1;
  });
  
  const sourceLabels = Object.keys(bySource).sort((a, b) => bySource[b] - bySource[a]).slice(0, 8);
  const sourceData = sourceLabels.map(s => bySource[s]);
  
  // Temperature breakdown
  const tempLabels = ['Hot', 'Warm', 'Cool'];
  const tempData = [hotCount, warmCount, totalLeads - hotCount - warmCount];
  const tempColors = ['#f87171', '#fbbf24', '#6c8cff'];
  
  let html = '<div class="gov-metrics">';
  html += metricHTML('Total Leads', fmtN(totalLeads), 'In pipeline', 'blue');
  html += metricHTML('Hot', fmtN(hotCount), 'Ready to move', 'red');
  html += metricHTML('Warm', fmtN(warmCount), 'Engaged', 'yellow');
  html += metricHTML('Pipeline Value', fmt(pipelineValue), 'Est. annual rent', 'purple');
  html += '</div>';
  
  html += `<div class="charts-row">`;
  
  if (sourceLabels.length > 0) {
    html += `<div class="chart-container half">
      <h3>Leads by Source</h3>
      <canvas id="chart-leads-source" height="200"></canvas>
    </div>`;
  }
  
  html += `<div class="chart-container half">
    <h3>Temperature</h3>
    <canvas id="chart-leads-temp" height="200"></canvas>
  </div>`;
  
  html += '</div>';
  
  html += '<div class="table-section">';
  html += '<h3>Top Prospects</h3>';
  html += leadsTable(govData.leads.slice(0, 100));
  html += '</div>';
  
  setTimeout(() => {
    if (sourceLabels.length > 0) {
      renderPieChart('chart-leads-source', sourceLabels, sourceData);
    }
    renderHBarChart('chart-leads-temp', tempLabels, tempData, tempColors);
  }, 100);
  
  return html;
}

function renderGovListings() {
  const activeListings = govData.listings.filter(l => l.listing_status === 'active').length;
  const totalAsking = govData.listings.reduce((sum, l) => sum + (l.asking_price || 0), 0);
  const underContract = govData.listings.filter(l => l.listing_status === 'under_contract').length;
  
  let html = '<div class="gov-metrics">';
  html += metricHTML('Active Listings', fmtN(activeListings), 'Currently on market', 'blue');
  html += metricHTML('Total Asking', fmt(totalAsking), 'Combined value', 'green');
  html += metricHTML('Count', fmtN(govData.listings.length), 'All listings', 'yellow');
  html += metricHTML('Under Contract', fmtN(underContract), 'Pending', 'purple');
  html += '</div>';
  
  html += '<div class="table-section">';
  html += '<h3>Available Listings</h3>';
  html += listingsTable(govData.listings.slice(0, 100));
  html += '</div>';
  
  return html;
}

function renderGovResearch() {
  // Load queue if empty
  if (researchQueue.length === 0) {
    loadResearchQueue();
  }
  
  return renderResearch();
}

function renderGovTab() {
  const el = document.getElementById('bizPageInner');
  if (!el) return;
  
  let html = '';
  switch (currentGovTab) {
    case 'overview':
      html = renderGovOverview();
      break;
    case 'ownership':
      html = renderGovOwnership();
      break;
    case 'pipeline':
      html = renderGovPipeline();
      break;
    case 'listings':
      html = renderGovListings();
      break;
    case 'research':
      html = renderGovResearch();
      break;
  }
  
  el.innerHTML = html;
  
  // Attach autocomplete and event listeners
  setTimeout(() => {
    if (currentGovTab === 'research') {
      attachAutocomplete();
    }
    renderGovCharts();
  }, 100);
}
