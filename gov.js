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

async function govQuery(table, select, params = {}) {
  // Query via serverless proxy — keeps secret key server-side
  const url = new URL('/api/gov-query', window.location.origin);
  url.searchParams.set('table', table);
  url.searchParams.set('select', select);
  if (params.filter) url.searchParams.set('filter', params.filter);
  if (params.order) url.searchParams.set('order', params.order);
  if (params.limit !== undefined) url.searchParams.set('limit', params.limit);
  if (params.offset !== undefined) url.searchParams.set('offset', params.offset);

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`govQuery ${table}: HTTP ${response.status}`, errBody);
      return { data: [], count: 0 };
    }

    const result = await response.json();
    return { data: result.data || [], count: result.count || 0 };
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
    
    // Load properties count (using Prefer: count=exact header + limit=0)
    const propsRes = await govQuery('properties',
      'property_id',
      { limit: 0 }
    );
    govData.properties = [{ count: propsRes.count || 0 }];

    // Load sales comps count
    const salesRes = await govQuery('sales_transactions',
      'sale_id',
      { limit: 0 }
    );
    govData.salesComps = [{ count: salesRes.count || 0 }];
    
    govConnected = true;
    govDataLoaded = true;
    console.log('GOV DATA LOADED:', {
      properties: govData.properties,
      salesComps: govData.salesComps,
      leads: govData.leads.length,
      contacts: govData.contacts.length,
      ownership: govData.ownership.length,
      listings: govData.listings.length,
      gsaEvents: govData.gsaEvents.length,
      frpp: govData.frppRecords.length,
      county: govData.countyAuth.length
    });
    showToast(`Gov: ${govData.leads.length} leads, ${govData.ownership.length} ownership, ${govData.listings.length} listings loaded`, 'success');
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
  html += '<th>Lease</th><th>Address</th><th>City, State</th><th>From</th><th>To</th><th>Date</th><th>Est. Value</th><th>Status</th>';
  html += '</tr></thead><tbody>';

  rows.slice(0, 50).forEach(r => {
    const status = r.research_status || 'pending';
    const statusDot = dotClass(status);

    html += `<tr class="table-row clickable-row" onclick='showDetail(${JSON.stringify(r).replace(/'/g,"&#39;")}, "gov-ownership")'>`;
    html += `<td><code>${esc(r.lease_number || '')}</code></td>`;
    html += `<td class="truncate">${esc(r.address || '—')}</td>`;
    html += `<td>${esc(r.city || '')}, ${esc(r.state || '')}</td>`;
    html += `<td class="truncate">${esc(r.prior_owner || '')}</td>`;
    html += `<td class="truncate">${esc(r.new_owner || '')}</td>`;
    html += `<td>${r.transfer_date ? r.transfer_date.substring(0, 10) : ''}</td>`;
    html += `<td>${fmt(r.estimated_value || 0)}</td>`;
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
  html += '<th>Score</th><th>Temp</th><th>Address</th><th>City, State</th><th>Tenant</th><th>Lessor</th><th>Rent</th><th>Value</th><th>Pipeline</th>';
  html += '</tr></thead><tbody>';

  rows.slice(0, 50).forEach(r => {
    const tempColor = {
      'hot': '#f87171',
      'warm': '#fbbf24',
      'cool': '#6c8cff'
    }[r.lead_temperature] || '#9498a8';

    const pipelineStatus = r.pipeline_status || 'new';

    html += `<tr class="table-row clickable-row" onclick='showDetail(${JSON.stringify(r).replace(/'/g,"&#39;")}, "gov-lead")'>`;
    html += `<td><strong>${r.priority_score || 0}</strong></td>`;
    html += `<td><span style="color:${tempColor};">${r.lead_temperature || 'cool'}</span></td>`;
    html += `<td class="truncate">${esc(r.address || '—')}</td>`;
    html += `<td>${esc(r.city || '')}, ${esc(r.state || '')}</td>`;
    html += `<td class="truncate">${esc(r.tenant_agency || r.agency_full_name || '—')}</td>`;
    html += `<td class="truncate">${esc(r.lessor_name || '')}</td>`;
    html += `<td>${fmt(r.annual_rent || 0)}/yr</td>`;
    html += `<td>${fmt(r.estimated_value || 0)}</td>`;
    html += `<td><span class="pill">${pipelineStatus}</span></td>`;
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
  html += '<th>Tenant</th><th>Address</th><th>City, State</th><th>Asking</th><th>Cap Rate</th><th>DOM</th><th>Status</th><th>Source</th>';
  html += '</tr></thead><tbody>';

  rows.slice(0, 50).forEach(r => {
    const capRate = r.asking_cap_rate ? pct(r.asking_cap_rate) : '-';
    const status = r.listing_status || 'active';

    html += `<tr class="table-row clickable-row" onclick='showDetail(${JSON.stringify(r).replace(/'/g,"&#39;")}, "gov-listing")'>`;
    html += `<td class="truncate" style="font-weight:500">${esc(r.tenant_agency || '—')}</td>`;
    html += `<td class="truncate">${esc(r.address || '')}</td>`;
    html += `<td>${esc(r.city || '')}${r.state ? ', ' + esc(r.state) : ''}</td>`;
    html += `<td>${fmt(r.asking_price || 0)}</td>`;
    html += `<td>${capRate}</td>`;
    html += `<td>${r.days_on_market || '-'}</td>`;
    html += `<td><span class="pill">${status}</span></td>`;
    html += `<td>${esc(r.listing_source || '')}</td>`;
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
  // Use proxy endpoint instead of direct Supabase connection
  const url = new URL('/api/gov-query', window.location.origin);
  url.searchParams.set('table', table);
  url.searchParams.set('filter', `${idCol}=eq.${idVal}`);
  
  try {
    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
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
    // POST new loan using proxy endpoint
    const url = new URL('/api/gov-query', window.location.origin);
    url.searchParams.set('table', 'loans');
    
    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(loanData)
      });
      
      if (!response.ok) {
        console.error('Error creating loan record:', response.status, await response.text());
      }
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


// ============================================================================
// DETAIL PANEL RENDERER
// ============================================================================

/**
 * Main detail panel renderer - handles all three source types
 * Called from index.html via showDetail(record, source)
 */
function renderGovDetailBody(record, source, tab) {
  switch (source) {
    case 'gov-ownership':
      return renderOwnershipDetail(record, tab || 'Overview');
    case 'gov-lead':
      return renderLeadDetail(record, tab || 'Overview');
    case 'gov-listing':
      return renderListingDetail(record, tab || 'Overview');
    default:
      return '<div class="detail-empty">Unknown detail source</div>';
  }
}

// ============================================================================
// GOV-OWNERSHIP DETAIL PANEL
// ============================================================================

function renderOwnershipDetail(record, tab) {
  let html = '';
  
  switch (tab) {
    case 'Overview':
      html = renderOwnershipOverview(record);
      break;
    case 'Lease':
      html = renderOwnershipLease(record);
      break;
    case 'Ownership':
      html = renderOwnershipOwnership(record);
      break;
    case 'Activity':
      html = renderOwnershipActivity(record);
      break;
  }
  
  return html;
}

function renderOwnershipOverview(record) {
  const value = fmt(record.estimated_value);
  const salePrice = fmt(record.sale_price);
  const capRate = record.cap_rate ? pct(record.cap_rate / 100) : '—';
  const sqft = record.square_feet ? fmtN(record.square_feet) : '—';
  const rent = fmt(record.annual_rent);
  
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Key Information</div>';
  html += '<div class="detail-grid">';
  
  html += createDetailRow('Lease Number', esc(record.lease_number || '—'));
  html += createDetailRow('Address', esc(record.address || '—'));
  html += createDetailRow('City / State', 
    esc((record.city || '') + (record.state ? ', ' + record.state : '') || '—'));
  html += createDetailRow('Estimated Value', `<span class="detail-val money">${value}</span>`);
  html += createDetailRow('Sale Price', `<span class="detail-val money">${salePrice}</span>`);
  html += createDetailRow('Cap Rate', capRate);
  html += createDetailRow('Square Feet', sqft);
  html += createDetailRow('Annual Rent', `<span class="detail-val money">${rent}</span>`);
  html += createDetailRow('Transfer Date', esc(record.transfer_date || '—'));
  html += createDetailRow('Research Status', 
    `<span class="detail-badge">${esc(record.research_status || 'Pending')}</span>`);
  
  html += '</div>';
  html += '</div>';
  
  html += '<div class="detail-actions">';
  html += '<button class="gov-btn" onclick="showToast(\'Edit status - coming soon\')">Edit Status</button>';
  html += '<button class="gov-btn" onclick="showToast(\'View on map - coming soon\')">View on Map</button>';
  html += '</div>';
  
  return html;
}

function renderOwnershipLease(record) {
  // Find matching GSA snapshot by lease_number
  const snapshot = govData.gsaSnapshots && govData.gsaSnapshots.find(
    s => s.lease_number === record.lease_number
  );
  
  if (!snapshot) {
    return '<div class="detail-empty">No lease data available</div>';
  }
  
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Lease Details</div>';
  html += '<div class="detail-grid">';
  
  html += createDetailRow('Lease Effective', esc(snapshot.lease_effective || '—'));
  html += createDetailRow('Lease Expiration', esc(snapshot.lease_expiration || '—'));
  html += createDetailRow('RSF (Lease)', snapshot.lease_rsf ? fmtN(snapshot.lease_rsf) : '—');
  html += createDetailRow('Lessor Name', esc(snapshot.lessor_name || '—'));
  html += createDetailRow('Field Office', esc(snapshot.field_office_name || '—'));
  html += createDetailRow('Annual Rent', fmt(snapshot.annual_rent));
  
  html += '</div>';
  html += '</div>';
  
  return html;
}

function renderOwnershipOwnership(record) {
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Ownership Transfer</div>';
  html += '<div class="detail-grid">';
  
  html += createDetailRow('Prior Owner', esc(record.prior_owner || '—'));
  html += createDetailRow('New Owner', esc(record.new_owner || '—'));
  html += createDetailRow('Transfer Date', esc(record.transfer_date || '—'));
  
  html += '</div>';
  html += '</div>';
  
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Legal Ownership</div>';
  html += '<div class="detail-grid">';
  
  html += createDetailRow('Recorded Owner', esc(record.recorded_owner_name || '—'));
  html += createDetailRow('True Owner', esc(record.true_owner_name || '—'));
  html += createDetailRow('State of Incorporation', esc(record.state_of_incorporation || '—'));
  
  if (record.principal_names) {
    html += createDetailRow('Principals', 
      `<span class="detail-val">${esc(record.principal_names)}</span>`);
  }
  
  html += '</div>';
  html += '</div>';
  
  return html;
}

function renderOwnershipActivity(record) {
  // Filter gsaEvents by lease_number
  const events = govData.gsaEvents && govData.gsaEvents.filter(
    e => e.lease_number === record.lease_number
  );
  
  if (!events || events.length === 0) {
    return '<div class="detail-empty">No activity recorded</div>';
  }
  
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Activity Timeline</div>';
  html += '<div class="detail-timeline">';
  
  events.forEach((event, idx) => {
    const statusClass = event.event_type === 'renewal' ? 'green' : 
                       event.event_type === 'termination' ? 'red' : 'yellow';
    
    html += `<div class="detail-timeline-item ${statusClass}">`;
    html += `<div class="detail-card-date">${esc(event.event_date || '—')}</div>`;
    html += `<div class="detail-card-title">${esc(event.event_type || 'Event')}</div>`;
    html += `<div class="detail-card-body">`;
    html += `<strong>${esc(event.lessor_name || '—')}</strong><br>`;
    html += `Annual Rent: ${fmt(event.annual_rent)}<br>`;
    html += `RSF: ${event.lease_rsf ? fmtN(event.lease_rsf) : '—'}`;
    if (event.changed_fields) {
      html += `<br><span class="detail-val muted">Changed: ${esc(event.changed_fields)}</span>`;
    }
    html += `</div>`;
    html += `</div>`;
  });
  
  html += '</div>';
  html += '</div>';
  
  return html;
}

// ============================================================================
// GOV-LEAD DETAIL PANEL
// ============================================================================

function renderLeadDetail(record, tab) {
  let html = '';
  
  switch (tab) {
    case 'Overview':
      html = renderLeadOverview(record);
      break;
    case 'Property':
      html = renderLeadProperty(record);
      break;
    case 'Pipeline':
      html = renderLeadPipeline(record);
      break;
    case 'Contacts':
      html = renderLeadContacts(record);
      break;
    case 'Activity':
      html = renderLeadActivity(record);
      break;
  }
  
  return html;
}

function renderLeadOverview(record) {
  const tempColor = record.lead_temperature === 'Hot' ? 'red' : 
                    record.lead_temperature === 'Warm' ? 'yellow' : 'cyan';
  
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Priority & Temperature</div>';
  html += '<div class="detail-grid">';
  
  html += createDetailRow('Priority Score', 
    `<span class="detail-badge" style="background: ${tempColor === 'red' ? '#f87171' : tempColor === 'yellow' ? '#fbbf24' : '#22d3ee'}">${record.priority_score || '—'}</span>`);
  html += createDetailRow('Lead Temperature', 
    `<span class="detail-badge">${esc(record.lead_temperature || 'Cold')}</span>`);
  html += createDetailRow('Lead Source', esc(record.lead_source || '—'));
  
  html += '</div>';
  html += '</div>';
  
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Key Metrics</div>';
  html += '<div class="detail-grid">';
  
  const value = fmt(record.estimated_value);
  const rent = fmt(record.annual_rent);
  const sqft = record.square_feet ? fmtN(record.square_feet) : '—';
  
  html += createDetailRow('Estimated Value', `<span class="detail-val money">${value}</span>`);
  html += createDetailRow('Annual Rent', `<span class="detail-val money">${rent}</span>`);
  html += createDetailRow('Square Feet', sqft);
  html += createDetailRow('Year Built', record.year_built || '—');
  html += createDetailRow('Firm Term Remaining', 
    record.firm_term_remaining ? fmtN(record.firm_term_remaining) + ' months' : '—');
  
  html += '</div>';
  html += '</div>';
  
  return html;
}

function renderLeadProperty(record) {
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Property Information</div>';
  html += '<div class="detail-grid">';
  
  html += createDetailRow('Address', esc(record.address || '—'));
  html += createDetailRow('City / State', 
    esc((record.city || '') + (record.state ? ', ' + record.state : '') || '—'));
  html += createDetailRow('Agency', esc(record.agency_full_name || '—'));
  html += createDetailRow('Tenant', esc(record.tenant_agency || '—'));
  html += createDetailRow('Lease Effective', esc(record.lease_effective || '—'));
  html += createDetailRow('Lease Expiration', esc(record.lease_expiration || '—'));
  html += createDetailRow('RBA', record.rba || '—');
  html += createDetailRow('Land Acres', record.land_acres ? fmtN(record.land_acres) : '—');
  html += createDetailRow('Year Renovated', record.year_renovated || '—');
  
  html += '</div>';
  html += '</div>';
  
  return html;
}

function renderLeadPipeline(record) {
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">CRM Pipeline</div>';
  
  html += '<div class="detail-form">';
  
  html += '<div class="detail-row">';
  html += '<label class="detail-lbl">Pipeline Status</label>';
  html += '<select id="govDetailPipeline" class="detail-val">';
  html += '<option value="new" ' + (record.pipeline_status === 'new' ? 'selected' : '') + '>New</option>';
  html += '<option value="contacted" ' + (record.pipeline_status === 'contacted' ? 'selected' : '') + '>Contacted</option>';
  html += '<option value="qualified" ' + (record.pipeline_status === 'qualified' ? 'selected' : '') + '>Qualified</option>';
  html += '<option value="proposal" ' + (record.pipeline_status === 'proposal' ? 'selected' : '') + '>Proposal</option>';
  html += '<option value="closed-won" ' + (record.pipeline_status === 'closed-won' ? 'selected' : '') + '>Closed Won</option>';
  html += '<option value="closed-lost" ' + (record.pipeline_status === 'closed-lost' ? 'selected' : '') + '>Closed Lost</option>';
  html += '</select>';
  html += '</div>';
  
  html += '<div class="detail-row">';
  html += '<label class="detail-lbl">Research Status</label>';
  html += '<select id="govDetailResearch" class="detail-val">';
  html += '<option value="pending" ' + (record.research_status === 'pending' ? 'selected' : '') + '>Pending</option>';
  html += '<option value="in-progress" ' + (record.research_status === 'in-progress' ? 'selected' : '') + '>In Progress</option>';
  html += '<option value="complete" ' + (record.research_status === 'complete' ? 'selected' : '') + '>Complete</option>';
  html += '<option value="archived" ' + (record.research_status === 'archived' ? 'selected' : '') + '>Archived</option>';
  html += '</select>';
  html += '</div>';
  
  if (record.sf_sync_status) {
    html += '<div class="detail-row">';
    html += '<label class="detail-lbl">Salesforce Sync</label>';
    html += '<span class="detail-badge">' + esc(record.sf_sync_status) + '</span>';
    html += '</div>';
  }
  
  html += '<div class="detail-row">';
  html += '<label class="detail-lbl">Research Notes</label>';
  html += '<textarea id="govDetailNotes" class="detail-val" style="min-height: 100px; font-family: monospace; font-size: 12px; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">' + esc(record.research_notes || '') + '</textarea>';
  html += '</div>';
  
  html += '<div class="detail-row" style="margin-top: 16px;">';
  html += '<button class="act-btn primary" onclick="saveGovDetailLead(' + JSON.stringify(record.lead_id) + ')">Save Changes</button>';
  html += '</div>';
  
  html += '</div>';
  html += '</div>';
  
  return html;
}

function renderLeadContacts(record) {
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Contact Information</div>';
  html += '<div class="detail-grid">';
  
  html += createDetailRow('Name', esc(record.contact_name || '—'));
  html += createDetailRow('Title', esc(record.contact_title || '—'));
  html += createDetailRow('Company', esc(record.contact_company || '—'));
  html += createDetailRow('Phone', esc(record.contact_phone || '—'));
  html += createDetailRow('Email', esc(record.contact_email || '—'));
  
  if (record.phone_2) {
    html += createDetailRow('Phone 2', esc(record.phone_2));
  }
  
  if (record.mailing_address) {
    html += createDetailRow('Mailing Address', esc(record.mailing_address));
    if (record.mailing_address_2) {
      html += createDetailRow('Address 2', esc(record.mailing_address_2));
    }
  }
  
  html += '</div>';
  html += '</div>';
  
  html += '<div class="detail-actions">';
  html += '<button class="gov-btn" onclick="showToast(\'Log call - coming soon\')">Log Call</button>';
  html += '<button class="gov-btn" onclick="showToast(\'Send email - coming soon\')">Send Email</button>';
  html += '</div>';
  
  return html;
}

function renderLeadActivity(record) {
  // Filter gsaEvents by lease_number
  const events = govData.gsaEvents && govData.gsaEvents.filter(
    e => e.lease_number === record.lease_number
  );
  
  if (!events || events.length === 0) {
    return '<div class="detail-empty">No activity recorded</div>';
  }
  
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Activity Timeline</div>';
  html += '<div class="detail-timeline">';
  
  events.forEach((event, idx) => {
    const statusClass = event.event_type === 'renewal' ? 'green' : 
                       event.event_type === 'termination' ? 'red' : 'yellow';
    
    html += `<div class="detail-timeline-item ${statusClass}">`;
    html += `<div class="detail-card-date">${esc(event.event_date || '—')}</div>`;
    html += `<div class="detail-card-title">${esc(event.event_type || 'Event')}</div>`;
    html += `<div class="detail-card-body">`;
    html += `<strong>${esc(event.lessor_name || '—')}</strong><br>`;
    html += `Annual Rent: ${fmt(event.annual_rent)}<br>`;
    html += `RSF: ${event.lease_rsf ? fmtN(event.lease_rsf) : '—'}`;
    if (event.changed_fields) {
      html += `<br><span class="detail-val muted">Changed: ${esc(event.changed_fields)}</span>`;
    }
    html += `</div>`;
    html += `</div>`;
  });
  
  html += '</div>';
  html += '</div>';
  
  return html;
}

// ============================================================================
// GOV-LISTING DETAIL PANEL
// ============================================================================

function renderListingDetail(record, tab) {
  let html = '';
  
  switch (tab) {
    case 'Overview':
      html = renderListingOverview(record);
      break;
    case 'Property':
      html = renderListingProperty(record);
      break;
    case 'Market':
      html = renderListingMarket(record);
      break;
    case 'Activity':
      html = renderListingActivity(record);
      break;
  }
  
  return html;
}

function renderListingOverview(record) {
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Listing Details</div>';
  html += '<div class="detail-grid">';
  
  const price = fmt(record.asking_price);
  const capRate = record.asking_cap_rate ? pct(record.asking_cap_rate / 100) : '—';
  
  html += createDetailRow('Asking Price', `<span class="detail-val money">${price}</span>`);
  html += createDetailRow('Asking Cap Rate', capRate);
  html += createDetailRow('Listing Source', esc(record.listing_source || '—'));
  html += createDetailRow('Listing Status', 
    `<span class="detail-badge">${esc(record.listing_status || 'Active')}</span>`);
  html += createDetailRow('Days on Market', record.days_on_market || '—');
  html += createDetailRow('URL Status', esc(record.url_status || '—'));
  html += createDetailRow('Tenant Agency', esc(record.tenant_agency || '—'));
  
  html += '</div>';
  html += '</div>';
  
  return html;
}

function renderListingProperty(record) {
  // Find matching FRPP record by city
  const frpp = govData.frppRecords && govData.frppRecords.find(
    f => f.city_name === record.city && f.state_name === record.state
  );
  
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Property Information</div>';
  html += '<div class="detail-grid">';
  
  html += createDetailRow('Address', esc(record.address || '—'));
  html += createDetailRow('City / State', 
    esc((record.city || '') + (record.state ? ', ' + record.state : '') || '—'));
  
  if (frpp) {
    html += createDetailRow('Property Type', esc(frpp.property_type || '—'));
    html += createDetailRow('Square Feet', frpp.square_feet ? fmtN(frpp.square_feet) : '—');
    html += createDetailRow('Annual Rent', fmt(frpp.annual_rent_to_lessor));
    html += createDetailRow('Lease Expiration', esc(frpp.lease_expiration_date || '—'));
  }
  
  html += '</div>';
  html += '</div>';
  
  return html;
}

function renderListingMarket(record) {
  // Find comparable sales/ownership transfers in same city/state
  const comps = govData.ownership && govData.ownership.filter(
    o => o.city === record.city && o.state === record.state && o.sale_price
  );
  
  if (!comps || comps.length === 0) {
    return '<div class="detail-empty">No comparable sales found in this market</div>';
  }
  
  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Comparable Sales</div>';
  
  html += '<div style="overflow-x: auto;">';
  html += '<table style="width: 100%; font-size: 12px; border-collapse: collapse;">';
  html += '<thead><tr style="border-bottom: 2px solid #ccc;">';
  html += '<th style="text-align: left; padding: 8px;">Address</th>';
  html += '<th style="text-align: right; padding: 8px;">Sale Price</th>';
  html += '<th style="text-align: right; padding: 8px;">Cap Rate</th>';
  html += '<th style="text-align: right; padding: 8px;">Sq Ft</th>';
  html += '<th style="text-align: center; padding: 8px;">Transfer Date</th>';
  html += '</tr></thead>';
  html += '<tbody>';
  
  comps.slice(0, 10).forEach(comp => {
    const price = fmt(comp.sale_price);
    const capRate = comp.cap_rate ? pct(comp.cap_rate / 100) : '—';
    const sqft = comp.square_feet ? fmtN(comp.square_feet) : '—';
    
    html += `<tr class="clickable-row" style="border-bottom: 1px solid #eee;cursor:pointer" onclick='showDetail(${JSON.stringify(comp).replace(/'/g,"&#39;")}, "gov-ownership")'>`;
    html += `<td style="padding: 8px;">${esc(comp.address || '—')}</td>`;
    html += `<td style="text-align: right; padding: 8px; font-weight: 600;">${price}</td>`;
    html += `<td style="text-align: right; padding: 8px;">${capRate}</td>`;
    html += `<td style="text-align: right; padding: 8px;">${sqft}</td>`;
    html += `<td style="text-align: center; padding: 8px;">${esc(comp.transfer_date || '—')}</td>`;
    html += '</tr>';
  });
  
  html += '</tbody>';
  html += '</table>';
  html += '</div>';
  html += '</div>';
  
  return html;
}

function renderListingActivity(record) {
  return '<div class="detail-empty">Activity timeline coming soon</div>';
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createDetailRow(label, value) {
  return `<div class="detail-row">
    <span class="detail-lbl">${esc(label)}</span>
    <span class="detail-val">${value}</span>
  </div>`;
}

/**
 * Save changes to a gov lead record
 * Updates pipeline_status, research_status, and research_notes
 */
function saveGovDetailLead(leadId) {
  const pipelineStatus = document.getElementById('govDetailPipeline')?.value;
  const researchStatus = document.getElementById('govDetailResearch')?.value;
  const researchNotes = document.getElementById('govDetailNotes')?.value;
  
  if (!pipelineStatus || !researchStatus) {
    showToast('Please select pipeline and research status');
    return;
  }
  
  const data = {
    pipeline_status: pipelineStatus,
    research_status: researchStatus,
    research_notes: researchNotes || null
  };
  
  // Patch the prospect_leads table
  patchRecord('prospect_leads', { lead_id: leadId }, data)
    .then(() => {
      showToast('Lead updated successfully');
      // Refresh the detail view
      setTimeout(() => {
        if (window.refreshDetailPanel) {
          window.refreshDetailPanel();
        }
      }, 500);
    })
    .catch(err => {
      console.error('Error saving lead:', err);
      showToast('Error updating lead: ' + err.message);
    });
}

// ============================================================================
// EXPORTS
// ============================================================================

window.renderGovDetailBody = renderGovDetailBody;
window.saveGovDetailLead = saveGovDetailLead;
