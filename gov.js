// Government Dashboard Module for Life Command Center
// Loaded after index.html, has access to global variables and functions

// Module state variables
let govCharts = {};
let researchQueue = [];
let researchIdx = 0;
let researchCompleted = 0;
let researchMode = "leads";
let researchFilter = "pending";
let countyCache = {};
let acTimeout = null;
let govEvidenceState = {
  contextKey: '',
  review: null,
  artifactId: null,
  loading: false,
  queue: [],
  queueLoading: false,
  queueLoaded: false,
  queueError: '',
  healthLoading: false,
  health: null
};

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

// Paginated fetch — loops with offset to get ALL rows past PostgREST 1000-row cap
async function govQueryAll(table, select, params = {}) {
  let all = [], offset = 0;
  const pageSize = 1000;
  while (true) {
    const result = await govQuery(table, select, { ...params, limit: pageSize, offset });
    all = all.concat(result.data || []);
    if ((result.data || []).length < pageSize) break;
    offset += pageSize;
  }
  return { data: all, count: all.length };
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
  govData.portfolioProperties = [];
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
    // Load ALL ownership changes (paginated past PostgREST cap — 4500+ rows)
    const ownershipRes = await govQueryAll('ownership_history',
      'ownership_id, lease_number, address, city, state, prior_owner, new_owner, transfer_date, square_feet, annual_rent, estimated_value, sale_price, cap_rate, research_status, recorded_owner_name, true_owner_name, principal_names, state_of_incorporation',
      { order: 'estimated_value.desc' }
    );
    govData.ownership = ownershipRes.data || [];
    
    // Load ALL prospect leads (paginated to overcome PostgREST 1000-row cap)
    const leadsRes = await govQueryAll('prospect_leads',
      'lead_id, lease_number, location_code, address, city, state, lessor_name, annual_rent, estimated_value, square_feet, year_built, agency_full_name, tenant_agency, lease_effective, lease_expiration, firm_term_remaining, priority_score, lead_temperature, lead_source, pipeline_status, research_status, contact_name, contact_phone, contact_email, contact_company, contact_title, recorded_owner, true_owner, owner_type, research_notes, matched_property_id, matched_contact_id, sf_lead_id, sf_contact_id, sf_opportunity_id, sf_sync_status, state_of_incorporation, phone_2, mailing_address, mailing_address_2, principal_names, rba, land_acres, year_renovated',
      {
        order: 'priority_score.desc'
      }
    );
    govData.leads = leadsRes.data || [];
    
    // Load active listings
    // Load ALL available listings (paginated past PostgREST cap)
    const listingsRes = await govQueryAll('available_listings',
      'listing_id, address, city, state, asking_price, asking_cap_rate, listing_source, listing_status, url_status, days_on_market, tenant_agency',
      {
        order: 'asking_price.desc'
      }
    );
    govData.listings = listingsRes.data || [];
    
    // Load ALL contacts (paginated past PostgREST cap — 4600+ rows)
    const contactsRes = await govQueryAll('contacts',
      'contact_id, name, contact_type, total_volume, phone, email',
      {}
    );
    govData.contacts = contactsRes.data || [];
    
    // Load GSA lease events
    const gsaEventsRes = await govQuery('gsa_lease_events',
      'lease_number, location_code, event_type, event_date, annual_rent, lease_rsf, lessor_name, changed_fields',
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
    // FRPP: 20K+ records — load count + first 1000 for overview stats
    const frppRes = await govQuery('frpp_records',
      'using_agency, using_bureau, street_address, city_name, state_name, square_feet, annual_rent_to_lessor, lease_expiration_date, property_type',
      {
        limit: 1000
      }
    );
    govData.frppRecords = frppRes.data || [];
    govData.frppCount = frppRes.count || govData.frppRecords.length;
    
    // Load county authorities
    // Paginate county authorities — 4400+ rows
    {
      let all = [], offset = 0;
      while (true) {
        const batch = await govQuery('county_authorities',
          'county_name, state_code, netronline_url, assessor_url, recorder_url, treasurer_url, tax_url, gis_url, clerk_url, other_urls',
          { limit: 1000, offset }
        );
        all = all.concat(batch.data || []);
        if (!batch.data || batch.data.length < 1000) break;
        offset += 1000;
      }
      govData.countyAuth = all;
    }
    
    // Load loans
    const loansRes = await govQuery('loans',
      'property_id, index_name, loan_amount, loan_type, status',
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

    // Load property portfolio data for overview analytics (agency, lease term, rent, SF)
    // Pull lightweight columns only — paginate to get all ~16K rows
    // NOTE: PostgREST caps at 1000 rows per request regardless of limit param
    try {
      let allProps = [], offset = 0;
      const pageSize = 1000;
      while (true) {
        const batch = await govQuery('properties',
          'agency,agency_full_name,firm_term_remaining,gross_rent,gross_rent_psf,sf_leased,noi,lease_expiration,state,agency_risk_level,investment_score,deal_grade,government_type',
          { limit: pageSize, offset }
        );
        allProps = allProps.concat(batch.data || []);
        if (!batch.data || batch.data.length < pageSize) break;
        offset += pageSize;
      }
      govData.portfolioProperties = allProps;
    } catch (e) { console.warn('Portfolio properties load error:', e); govData.portfolioProperties = []; }

    // Load sales transactions
    // Paginate sales — 2600+ rows
    {
      let all = [], offset = 0;
      while (true) {
        const batch = await govQuery('sales_transactions',
          '*',
          { order: 'sale_date.desc', limit: 1000, offset }
        );
        all = all.concat(batch.data || []);
        if (!batch.data || batch.data.length < 1000) break;
        offset += 1000;
      }
      govData.salesComps = all;
    }
    
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
      inner.innerHTML = '<div style="text-align:center;padding:32px;color:var(--red)"><p style="font-size:16px;margin-bottom:8px">Failed to load government data</p><p style="color:var(--text2);font-size:13px">' + esc(err.message || 'Unknown error') + '</p><button class="gov-btn" onclick="loadGovData()" style="margin-top:12px">Retry</button></div>';
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

    html += `<tr class="clickable-tr" onclick='showDetail(${safeJSON(r)}, "gov-ownership")'>`;
    html += `<td><code>${esc(r.lease_number || '')}</code></td>`;
    html += `<td class="truncate">${esc(norm(r.address) || '—')}</td>`;
    html += `<td>${esc(norm(r.city) || '')}, ${esc(r.state || '')}</td>`;
    html += `<td class="truncate">${esc(norm(r.prior_owner) || '')}</td>`;
    html += `<td class="truncate">${esc(norm(r.new_owner) || '')}</td>`;
    html += `<td>${r.transfer_date ? r.transfer_date.substring(0, 10) : ''}</td>`;
    html += `<td>${fmt(r.estimated_value || 0)}</td>`;
    html += `<td><span class="status-dot ${statusDot}"></span>${cleanLabel(status)}</td>`;
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

    html += `<tr class="clickable-tr" onclick='showDetail(${safeJSON(r)}, "gov-lead")'>`;
    html += `<td><strong>${r.priority_score || 0}</strong></td>`;
    html += `<td><span style="color:${tempColor};">${r.lead_temperature || 'cool'}</span></td>`;
    html += `<td class="truncate">${esc(norm(r.address) || '—')}</td>`;
    html += `<td>${esc(norm(r.city) || '')}, ${esc(r.state || '')}</td>`;
    html += `<td class="truncate">${esc(norm(r.tenant_agency || r.agency_full_name) || '—')}</td>`;
    html += `<td class="truncate">${esc(norm(r.lessor_name) || '')}</td>`;
    html += `<td>${fmt(r.annual_rent || 0)}/yr</td>`;
    html += `<td>${fmt(r.estimated_value || 0)}</td>`;
    html += `<td><span class="pill">${cleanLabel(pipelineStatus)}</span></td>`;
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

    html += `<tr class="clickable-tr" onclick='showDetail(${safeJSON(r)}, "gov-listing")'>`;
    html += `<td class="truncate" style="font-weight:500">${esc(norm(r.tenant_agency) || '—')}</td>`;
    html += `<td class="truncate">${esc(norm(r.address) || '')}</td>`;
    html += `<td>${esc(norm(r.city) || '')}${r.state ? ', ' + esc(r.state) : ''}</td>`;
    html += `<td>${fmt(r.asking_price || 0)}</td>`;
    html += `<td>${capRate}</td>`;
    html += `<td>${r.days_on_market || '-'}</td>`;
    html += `<td><span class="pill">${cleanLabel(status)}</span></td>`;
    html += `<td>${esc(cleanLabel(r.listing_source || ''))}</td>`;
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

  // Search local contacts
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

  // Search canonical entities (includes SF-linked records)
  if (query.length >= 3) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
      const res = await fetch(`/api/entities?action=search&q=${encodeURIComponent(query)}&limit=15`, { headers });
      if (res.ok) {
        const data = await res.json();
        for (const ent of (data.entities || [])) {
          const sfIds = (ent.external_identities || []).filter(x => x.source_system === 'salesforce');
          const sfTag = sfIds.length > 0 ? ' \u2022 SF' : '';
          const typeTag = ent.entity_type === 'person' ? 'Contact' : ent.entity_type === 'organization' ? 'Company' : 'Asset';
          results.push({
            type: 'canonical',
            label: `${ent.name} (${typeTag}${sfTag})`,
            value: ent.name,
            data: {
              canonical_id: ent.id,
              name: ent.name,
              email: ent.email,
              phone: ent.phone,
              address: ent.address,
              city: ent.city,
              state: ent.state,
              entity_type: ent.entity_type,
              sf_ids: sfIds
            }
          });
        }
      }
    } catch (e) {
      // Canonical search is best-effort; local results still show
    }
  }

  // Deduplicate and limit
  const seen = new Set();
  results = results.filter(r => {
    const key = `${r.type}:${r.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 15);

  const dropEl = q(`#${dropId}`);

  if (results.length === 0) {
    dropEl.style.display = 'none';
    return;
  }

  // Store results for selection lookup
  window._acResults = window._acResults || {};
  window._acResults[dropId] = results;

  dropEl.innerHTML = results.map((r, i) => {
    const cls = r.type === 'canonical' ? 'ac-item ac-canonical' : 'ac-item';
    return `<div class="${cls}" onclick='selectAC(${safeJSON(inputId)}, ${safeJSON(r.value)}, ${safeJSON(dropId)}, ${i})'>${esc(r.label)}</div>`;
  }).join('');

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
    }, 250); // 250ms delay to allow mousedown on dropdown items to fire first
  });
}

function selectAC(inputId, value, dropId, resultIdx) {
  q(`#${inputId}`).value = value;
  q(`#${dropId}`).style.display = 'none';

  // Auto-fill related fields from canonical entity data
  const results = window._acResults && window._acResults[dropId];
  if (results && resultIdx != null && results[resultIdx] && results[resultIdx].type === 'canonical') {
    const d = results[resultIdx].data;
    // Fill email if available and field exists
    const emailEl = q('#res-principal-email');
    if (emailEl && d.email && !emailEl.value) emailEl.value = d.email;
    // Fill phone
    const phoneEl = q('#res-phone');
    if (phoneEl && d.phone && !phoneEl.value) phoneEl.value = d.phone;
    // Fill state of incorporation from entity state
    const incEl = q('#res-incorporation');
    if (incEl && d.state && !incEl.value) incEl.value = d.state;

    // Show SF link badge if SF IDs exist
    if (d.sf_ids && d.sf_ids.length > 0) {
      const sfTypes = d.sf_ids.map(s => `${s.source_type}:${s.external_id}`).join(', ');
      showToast(`Linked to Salesforce: ${sfTypes}`, 'success');
    }
  }
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

  let filtered;
  if (researchMode === 'ownership') {
    if (researchFilter === 'all') {
      filtered = govData.ownership.slice();
    } else {
      filtered = govData.ownership.filter(o => !o.sale_price && (!o.research_status || o.research_status === 'pending'));
    }
  } else if (researchMode === 'intel') {
    // Intel queue: portfolio properties missing key financial/physical details
    const portfolio = govData.portfolioProperties || [];
    if (researchFilter === 'all') {
      filtered = portfolio.slice();
    } else {
      filtered = portfolio.filter(p =>
        !p.intel_status || p.intel_status === 'pending' ||
        (!p.sale_price && !p.last_known_rent && !p.current_value_estimate)
      );
    }
  } else {
    if (researchFilter === 'all') {
      filtered = govData.leads.slice();
    } else {
      filtered = govData.leads.filter(l => !l.research_status || l.research_status === 'pending');
    }
  }

  for (const rec of filtered.slice(0, 50)) {
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

    // Enrich with loan data for intel mode
    if (researchMode === 'intel') {
      const loan = govData.loans.find(l => l.property_id === rec.property_id);
      if (loan) rec._loan = loan;
    }

    researchQueue.push(rec);
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
    <div class="context-sub">${rec.location_code ? 'Loc: ' + esc(rec.location_code) + ' · ' : ''}${fmt(rec.annual_rent || 0)}/yr</div>
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
  
  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Sale Date</label>';
  html += `<input type="date" id="res-sale-date" value="${rec.sale_date ? rec.sale_date.substring(0, 10) : ''}">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Sale Price</label>';
  html += `<input type="number" id="res-sale-price" value="${rec.sale_price || ''}" placeholder="e.g. 5000000">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Cap Rate (%)</label>';
  html += `<input type="number" id="res-cap-rate" value="${rec.cap_rate || ''}" placeholder="e.g. 4.5" step="0.1">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Price Source</label>';
  html += `<input type="text" id="res-price-source" value="" placeholder="CoStar, CBRE, etc.">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Buyer</label>';
  html += `<input type="text" id="res-buyer" value="${esc(rec.new_owner || '')}" placeholder="Purchasing entity">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Seller</label>';
  html += `<input type="text" id="res-seller" value="${esc(rec.prior_owner || '')}" placeholder="Selling entity">`;
  html += '</div>';
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
  html += `<input type="text" id="res-lender" value="${esc(loan.index_name || '')}" placeholder="">`;
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
    <div class="context-sub">${rec.location_code ? 'Loc: ' + esc(rec.location_code) + ' · ' : ''}${fmt(rec.annual_rent || 0)}/yr</div>
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

  if (loan.index_name) {
    html += `<div class="context-block">
      <div class="context-label">Known Lender</div>
      <div class="context-value">${esc(loan.index_name)}</div>
      <div class="context-sub">${loan.loan_amount ? fmt(loan.loan_amount) : ''} ${loan.loan_type ? '· ' + esc(loan.loan_type) : ''}</div>
    </div>`;
  }

  html += '</div>';

  // Research form
  html += '<div class="research-form">';

  // ── PRIOR SALE / TRANSACTION ──
  html += '<div class="form-divider">Prior Sale / Transaction</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Sale Date</label>';
  html += `<input type="date" id="res-sale-date" value="">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Sale Price ($)</label>';
  html += `<input type="number" id="res-sale-price" value="" placeholder="e.g. 5000000">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Cap Rate at Sale (%)</label>';
  html += `<input type="number" id="res-cap-rate" value="" placeholder="e.g. 6.25" step="0.01">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Price Source</label>';
  html += `<input type="text" id="res-price-source" value="" placeholder="CoStar, County Records, etc.">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Buyer</label>';
  html += `<input type="text" id="res-buyer" value="" placeholder="Purchasing entity">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Seller</label>';
  html += `<input type="text" id="res-seller" value="${esc(rec.lessor_name || '')}" placeholder="Selling entity">`;
  html += '</div>';
  html += '</div>';

  // ── OWNERSHIP RESEARCH ──
  html += '<div class="form-divider">Ownership Research</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Recorded Owner</label>';
  html += `<input type="text" id="res-recorded-owner" value="${esc(rec.recorded_owner || '')}" placeholder="From deed / public records">`;
  html += '<div id="res-recorded-owner-drop" class="ac-dropdown"></div>';
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>True Owner / Parent</label>';
  html += `<input type="text" id="res-true-owner" value="${esc(rec.true_owner || '')}" placeholder="Beneficial owner">`;
  html += '<div id="res-true-owner-drop" class="ac-dropdown"></div>';
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>State of Incorporation</label>';
  html += `<input type="text" id="res-incorporation" value="${esc(rec.state_of_incorporation || '')}" placeholder="e.g. DE">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Owner Type</label>';
  html += `<select id="res-owner-type">
    <option value="">—</option>
    <option value="Private">Private</option>
    <option value="Institutional">Institutional</option>
    <option value="REIT">REIT</option>
    <option value="Government">Government</option>
    <option value="Non-Profit">Non-Profit</option>
    <option value="SPE / LLC">SPE / LLC</option>
  </select>`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-group">';
  html += '<label>Principal Names</label>';
  html += `<input type="text" id="res-principal-names" value="${esc(rec.principal_names || '')}" placeholder="CEO, Managing Member, etc.">`;
  html += '<div id="res-principal-names-drop" class="ac-dropdown"></div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Contact Email</label>';
  html += `<input type="email" id="res-principal-email" value="" placeholder="contact@example.com">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Phone</label>';
  html += `<input type="text" id="res-phone" value="${esc(rec.phone_2 || '')}" placeholder="(555) 123-4567">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Mailing Address</label>';
  html += `<input type="text" id="res-mailing" value="" placeholder="">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Mailing Address 2</label>';
  html += `<input type="text" id="res-mailing-2" value="" placeholder="">`;
  html += '</div>';
  html += '</div>';

  // ── PROPERTY DETAILS ──
  html += '<div class="form-divider">Property Details</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>RBA (Rentable Building Area)</label>';
  html += `<input type="number" id="res-rba" value="${rec.square_feet || ''}" placeholder="SF">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Land Size (Acres)</label>';
  html += `<input type="number" id="res-land-acres" value="" placeholder="" step="0.01">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Year Built</label>';
  html += `<input type="number" id="res-year-built" value="" placeholder="YYYY">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Year Renovated</label>';
  html += `<input type="number" id="res-year-renovated" value="" placeholder="YYYY">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Building Class</label>';
  html += `<select id="res-building-class">
    <option value="">—</option>
    <option value="A">Class A</option>
    <option value="B">Class B</option>
    <option value="C">Class C</option>
  </select>`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Stories / Floors</label>';
  html += `<input type="number" id="res-stories" value="" placeholder="">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Parking Spaces</label>';
  html += `<input type="number" id="res-parking" value="" placeholder="">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Zoning</label>';
  html += `<input type="text" id="res-zoning" value="" placeholder="e.g. C-2, Industrial">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-group">';
  html += '<label>Property Condition</label>';
  html += `<select id="res-condition">
    <option value="">—</option>
    <option value="Excellent">Excellent</option>
    <option value="Good">Good</option>
    <option value="Average">Average</option>
    <option value="Fair">Fair</option>
    <option value="Poor">Poor</option>
  </select>`;
  html += '</div>';

  // ── LOAN / DEBT ──
  html += '<div class="form-divider">Loan / Debt</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Lender</label>';
  html += `<input type="text" id="res-lender" value="${esc(loan.index_name || '')}" placeholder="Bank or fund name">`;
  html += '<div id="res-lender-drop" class="ac-dropdown"></div>';
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Loan Amount ($)</label>';
  html += `<input type="number" id="res-loan-amount" value="${loan.loan_amount || ''}" placeholder="">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Interest Rate (%)</label>';
  html += `<input type="number" id="res-interest-rate" value="${loan.interest_rate_percent || ''}" placeholder="" step="0.01">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Loan Type</label>';
  html += `<select id="res-loan-type">
    <option value="">—</option>
    ${['Fixed', 'Variable', 'Bridge', 'CMBS', 'Agency', 'Construction', 'SBA', 'Other'].map(t =>
      `<option value="${t}" ${(loan.loan_type || '') === t ? 'selected' : ''}>${t}</option>`
    ).join('')}
  </select>`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Origination Date</label>';
  html += `<input type="date" id="res-loan-orig" value="${loan.origination_date ? loan.origination_date.substring(0, 10) : ''}">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Maturity Date</label>';
  html += `<input type="date" id="res-loan-maturity" value="${loan.maturity_date ? loan.maturity_date.substring(0, 10) : ''}">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>LTV (%)</label>';
  html += `<input type="number" id="res-ltv" value="${loan.loan_to_value || ''}" placeholder="" step="0.01">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Recourse</label>';
  html += `<select id="res-recourse">
    <option value="">—</option>
    ${['Recourse', 'Non-Recourse', 'Partial'].map(t =>
      `<option value="${t}" ${(loan.recourse || '') === t ? 'selected' : ''}>${t}</option>`
    ).join('')}
  </select>`;
  html += '</div>';
  html += '</div>';

  // ── CASH FLOW / VALUATION ──
  html += '<div class="form-divider">Cash Flow / Valuation</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Annual Rent / NOI ($)</label>';
  html += `<input type="number" id="res-annual-rent" value="${rec.annual_rent || ''}" placeholder="">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Rent Per SF ($/SF)</label>';
  html += `<input type="number" id="res-rent-psf" value="" placeholder="" step="0.01">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Expense Type</label>';
  html += `<select id="res-expense-type">
    <option value="">—</option>
    ${['NNN', 'Modified Gross', 'Full Service Gross', 'Industrial Gross', 'Ground Lease'].map(t =>
      `<option value="${t}">${t}</option>`
    ).join('')}
  </select>`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Estimated Property Value ($)</label>';
  html += `<input type="number" id="res-est-value" value="${rec.estimated_value || ''}" placeholder="">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-group">';
  html += '<label>Current Cap Rate (%)</label>';
  html += `<input type="number" id="res-current-cap" value="" placeholder="" step="0.01">`;
  html += '</div>';

  // ── PIPELINE STATUS ──
  html += '<div class="form-divider">Pipeline Status</div>';

  html += '<div class="form-group">';
  html += '<label>Quick Status</label>';
  html += `<select id="res-quick-status">
    <option value="">Select status...</option>
    <option value="new_lead">New Lead</option>
    <option value="researching">Researching</option>
    <option value="contacted">Contacted</option>
    <option value="meeting_set">Meeting Set</option>
    <option value="proposal_sent">Proposal Sent</option>
    <option value="not_for_sale">Not For Sale</option>
    <option value="dead">Dead</option>
  </select>`;
  html += '</div>';

  // ── RESEARCH NOTES ──
  html += '<div class="form-divider">Research Notes</div>';

  html += '<div class="form-group">';
  html += `<textarea id="res-notes" placeholder="Key findings, data sources, observations..." rows="4">${esc(rec.research_notes || '')}</textarea>`;
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Research Source</label>';
  html += `<input type="text" id="res-source" value="" placeholder="CoStar, County, Call, Loopnet">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Research Date</label>';
  html += `<input type="date" id="res-date" value="${new Date().toISOString().substring(0, 10)}">`;
  html += '</div>';
  html += '</div>';

  // ── QUICK ACTIONS ──
  html += '<div class="form-divider">Quick Actions</div>';

  html += '<div class="quick-actions">';
  html += searchBtn('Google Search', `${rec.lessor_name} ${rec.address} ${rec.city}`);
  html += searchBtn('Property Search', `${rec.address} ${rec.city} ${rec.state} sale owner`);
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

function renderIntelResearchCard(rec) {
  const snapshot = rec.gsa_snapshot || {};
  const frpp = rec.frpp || {};
  const loan = rec._loan || govData.loans.find(l => l.property_id === rec.property_id) || {};

  let html = '<div class="research-card">';

  // ── CONTEXT PANEL ──
  html += '<div class="research-context">';
  html += `<div class="context-block">
    <div class="context-label">Property</div>
    <div class="context-value">${esc(rec.address || '')}</div>
    <div class="context-sub">${esc(rec.city || '')}, ${esc(rec.state || '')} ${esc(rec.zip_code || '')}</div>
  </div>`;

  html += `<div class="context-block">
    <div class="context-label">Lease / Annual Rent</div>
    <div class="context-value"><code>${esc(rec.lease_number || '')}</code></div>
    <div class="context-sub">${rec.location_code ? 'Loc: ' + esc(rec.location_code) + ' · ' : ''}${fmt(rec.gross_rent || rec.annual_rent || 0)}/yr</div>
  </div>`;

  if (rec.agency) {
    html += `<div class="context-block">
      <div class="context-label">Agency / Tenant</div>
      <div class="context-value">${esc(rec.agency || '')}</div>
      <div class="context-sub">${rec.sf_leased ? fmtN(rec.sf_leased) + ' SF leased' : ''}</div>
    </div>`;
  }

  if (snapshot.lease_effective) {
    html += `<div class="context-block">
      <div class="context-label">GSA Lease Term</div>
      <div class="context-value">${snapshot.lease_effective.substring(0, 10)} – ${snapshot.lease_expiration.substring(0, 10)}</div>
      <div class="context-sub">${fmtN(snapshot.lease_rsf || 0)} SF @ ${fmt(snapshot.annual_rent || 0)}/yr</div>
    </div>`;
  }

  if (rec.firm_term_remaining !== null && rec.firm_term_remaining !== undefined) {
    html += `<div class="context-block">
      <div class="context-label">Firm Term Remaining</div>
      <div class="context-value">${Number(rec.firm_term_remaining).toFixed(1)} yrs</div>
    </div>`;
  }

  if (frpp.street_address) {
    html += `<div class="context-block">
      <div class="context-label">FRPP Property Type</div>
      <div class="context-value">${esc(frpp.property_type || '')}</div>
      <div class="context-sub">${fmtN(frpp.square_feet || 0)} SF</div>
    </div>`;
  }

  if (loan.index_name) {
    html += `<div class="context-block">
      <div class="context-label">Known Lender</div>
      <div class="context-value">${esc(loan.index_name)}</div>
      <div class="context-sub">${loan.loan_amount ? fmt(loan.loan_amount) : ''} ${loan.loan_type ? '· ' + esc(loan.loan_type) : ''}</div>
    </div>`;
  }

  html += '</div>';

  // ── RESEARCH FORM ──
  html += '<div class="research-form">';

  // ── PRIOR SALE / TRANSACTION ──
  html += '<div class="form-divider">Prior Sale / Transaction</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Sale Date</label>';
  html += `<input type="date" id="res-intel-sale-date" value="">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Sale Price ($)</label>';
  html += `<input type="number" id="res-intel-sale-price" value="" placeholder="e.g. 5000000">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Cap Rate at Sale (%)</label>';
  html += `<input type="number" id="res-intel-cap-rate" value="" placeholder="e.g. 6.25" step="0.01">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Price Source</label>';
  html += `<input type="text" id="res-intel-price-source" value="" placeholder="CoStar, County Records, etc.">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Buyer</label>';
  html += `<input type="text" id="res-intel-buyer" value="" placeholder="Purchasing entity">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Seller</label>';
  html += `<input type="text" id="res-intel-seller" value="" placeholder="Selling entity">`;
  html += '</div>';
  html += '</div>';

  // ── PROPERTY PHYSICAL DETAILS ──
  html += '<div class="form-divider">Property Details</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>RBA (Rentable Building Area)</label>';
  html += `<input type="number" id="res-intel-rba" value="${rec.rba || ''}" placeholder="SF">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Land Size (Acres)</label>';
  html += `<input type="number" id="res-intel-land-acres" value="${rec.land_acres || ''}" placeholder="" step="0.01">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Year Built</label>';
  html += `<input type="number" id="res-intel-year-built" value="${rec.year_built || ''}" placeholder="YYYY">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Year Renovated</label>';
  html += `<input type="number" id="res-intel-year-renovated" value="${rec.year_renovated || ''}" placeholder="YYYY">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Building Class</label>';
  html += `<select id="res-intel-building-class">
    <option value="">—</option>
    <option value="A">Class A</option>
    <option value="B">Class B</option>
    <option value="C">Class C</option>
  </select>`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Stories / Floors</label>';
  html += `<input type="number" id="res-intel-stories" value="${rec.stories || ''}" placeholder="">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Parking Spaces</label>';
  html += `<input type="number" id="res-intel-parking" value="${rec.parking_spaces || ''}" placeholder="">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Zoning</label>';
  html += `<input type="text" id="res-intel-zoning" value="${esc(rec.zoning || '')}" placeholder="e.g. C-2, Industrial">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-group">';
  html += '<label>Property Condition</label>';
  html += `<select id="res-intel-condition">
    <option value="">—</option>
    <option value="Excellent">Excellent</option>
    <option value="Good">Good</option>
    <option value="Average">Average</option>
    <option value="Fair">Fair</option>
    <option value="Poor">Poor</option>
  </select>`;
  html += '</div>';

  // ── OWNERSHIP / ENTITY ──
  html += '<div class="form-divider">Ownership / Entity</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Recorded Owner</label>';
  html += `<input type="text" id="res-intel-recorded-owner" value="${esc(rec.recorded_owner || rec.lessor_name || '')}" placeholder="From deed / public records">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>True Owner / Parent</label>';
  html += `<input type="text" id="res-intel-true-owner" value="${esc(rec.true_owner || '')}" placeholder="Beneficial owner">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>State of Incorporation</label>';
  html += `<input type="text" id="res-intel-incorp-state" value="" placeholder="e.g. DE">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Owner Type</label>';
  html += `<select id="res-intel-owner-type">
    <option value="">—</option>
    <option value="Private">Private</option>
    <option value="Institutional">Institutional</option>
    <option value="REIT">REIT</option>
    <option value="Government">Government</option>
    <option value="Non-Profit">Non-Profit</option>
    <option value="SPE / LLC">SPE / LLC</option>
  </select>`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-group">';
  html += '<label>Principal Names</label>';
  html += `<input type="text" id="res-intel-principals" value="" placeholder="CEO, Managing Member, etc.">`;
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Contact Email</label>';
  html += `<input type="email" id="res-intel-email" value="" placeholder="contact@example.com">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Contact Phone</label>';
  html += `<input type="text" id="res-intel-phone" value="" placeholder="(555) 123-4567">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-group">';
  html += '<label>Mailing Address</label>';
  html += `<input type="text" id="res-intel-mailing" value="" placeholder="">`;
  html += '</div>';

  // ── LOAN / DEBT ──
  html += '<div class="form-divider">Loan / Debt</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Lender</label>';
  html += `<input type="text" id="res-intel-lender" value="${esc(loan.index_name || '')}" placeholder="Bank or fund name">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Loan Amount ($)</label>';
  html += `<input type="number" id="res-intel-loan-amount" value="${loan.loan_amount || ''}" placeholder="">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Interest Rate (%)</label>';
  html += `<input type="number" id="res-intel-interest-rate" value="${loan.interest_rate_percent || ''}" placeholder="" step="0.01">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Loan Type</label>';
  html += `<select id="res-intel-loan-type">
    <option value="">—</option>
    ${['Fixed', 'Variable', 'Bridge', 'CMBS', 'Agency', 'Construction', 'SBA', 'Other'].map(t =>
      `<option value="${t}" ${(loan.loan_type || '') === t ? 'selected' : ''}>${t}</option>`
    ).join('')}
  </select>`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Origination Date</label>';
  html += `<input type="date" id="res-intel-loan-orig" value="${loan.origination_date ? loan.origination_date.substring(0, 10) : ''}">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Maturity Date</label>';
  html += `<input type="date" id="res-intel-loan-maturity" value="${loan.maturity_date ? loan.maturity_date.substring(0, 10) : ''}">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>LTV (%)</label>';
  html += `<input type="number" id="res-intel-ltv" value="${loan.loan_to_value || ''}" placeholder="" step="0.01">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Recourse</label>';
  html += `<select id="res-intel-recourse">
    <option value="">—</option>
    ${['Recourse', 'Non-Recourse', 'Partial'].map(t =>
      `<option value="${t}" ${(loan.recourse || '') === t ? 'selected' : ''}>${t}</option>`
    ).join('')}
  </select>`;
  html += '</div>';
  html += '</div>';

  // ── CASH FLOW / VALUATION ──
  html += '<div class="form-divider">Cash Flow / Valuation</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Annual Rent / NOI ($)</label>';
  html += `<input type="number" id="res-intel-annual-rent" value="${rec.last_known_rent || rec.gross_rent || ''}" placeholder="">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Rent Per SF ($/SF)</label>';
  html += `<input type="number" id="res-intel-rent-psf" value="${rec.gross_rent_psf || ''}" placeholder="" step="0.01">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Expense Type</label>';
  html += `<select id="res-intel-expense-type">
    <option value="">—</option>
    ${['NNN', 'Modified Gross', 'Full Service Gross', 'Industrial Gross', 'Ground Lease'].map(t =>
      `<option value="${t}">${t}</option>`
    ).join('')}
  </select>`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Estimated Property Value ($)</label>';
  html += `<input type="number" id="res-intel-est-value" value="${rec.current_value_estimate || ''}" placeholder="">`;
  html += '</div>';
  html += '</div>';

  html += '<div class="form-group">';
  html += '<label>Current Cap Rate (%)</label>';
  html += `<input type="number" id="res-intel-current-cap" value="" placeholder="" step="0.01">`;
  html += '</div>';

  // ── RESEARCH NOTES ──
  html += '<div class="form-divider">Research Notes</div>';

  html += '<div class="form-group">';
  html += '<label>Notes</label>';
  html += `<textarea id="res-intel-notes" placeholder="Key findings, observations, data sources..." rows="4"></textarea>`;
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div class="form-group">';
  html += '<label>Research Source</label>';
  html += `<input type="text" id="res-intel-source" value="" placeholder="CoStar, County, Call, etc.">`;
  html += '</div>';
  html += '<div class="form-group">';
  html += '<label>Research Date</label>';
  html += `<input type="date" id="res-intel-date" value="${new Date().toISOString().substring(0, 10)}">`;
  html += '</div>';
  html += '</div>';

  // ── QUICK ACTIONS ──
  html += '<div class="form-divider">Quick Actions</div>';

  html += '<div class="quick-actions">';
  html += searchBtn('Google Search', `${rec.address} ${rec.city} ${rec.state} owner`);
  html += searchBtn('CoStar Search', `${rec.address} ${rec.city} ${rec.state}`);
  html += sosBtns(rec.state, null);
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

function renderResearchInner() {
  const rec = researchQueue[researchIdx];
  const progress = Math.round((researchIdx / researchQueue.length) * 100);

  let html = '';

  // Progress bar
  html += `<div class="research-progress">
    <div class="progress-bar" style="width: ${progress}%"></div>
    <div class="progress-text">${researchIdx + 1} / ${researchQueue.length}</div>
  </div>`;

  // Render card
  if (researchMode === 'ownership') {
    html += renderOwnershipResearchCard(rec);
  } else if (researchMode === 'intel') {
    html += renderIntelResearchCard(rec);
  } else {
    html += renderLeadResearchCard(rec);
  }

  return html;
}

async function researchSave() {
  const rec = researchQueue[researchIdx];
  if (!rec) return;
  
  if (researchMode === 'ownership') {
    await saveOwnership(rec);
  } else if (researchMode === 'intel') {
    await saveIntel(rec);
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
  const saleDate = q('#res-sale-date')?.value || null;
  const salePrice = parseFloat(q('#res-sale-price')?.value) || null;
  const capRate = parseFloat(q('#res-cap-rate')?.value) || null;
  const buyer = q('#res-buyer')?.value || null;
  const seller = q('#res-seller')?.value || null;

  const recordedOwner = q('#res-recorded-owner')?.value || null;
  const trueOwner = q('#res-true-owner')?.value || null;
  const researchNotes = q('#res-notes')?.value || null;

  // Use Gov write service for ownership updates
  const propertyId = rec.matched_property_id || rec.property_id;
  let writeResult = null;
  if (propertyId) {
    try {
      writeResult = await govWriteService('ownership', {
        property_id: propertyId,
        recorded_owner: recordedOwner,
        true_owner: trueOwner,
        owner_type: null
      });
    } catch (err) {
      console.error('Gov ownership write service error:', err);
      showToast('Error saving ownership via write service: ' + err.message, 'error');
    }
  }

  // ownership_history is not a write-service-protected table — patch directly for
  // sale price, cap rate, and other research fields that live on the history row
  await patchRecord('ownership_history', 'ownership_id', rec.ownership_id, {
    sale_date: saleDate,
    sale_price: salePrice,
    cap_rate: capRate,
    buyer: buyer,
    seller: seller,
    recorded_owner_name: recordedOwner,
    state_of_incorporation: q('#res-incorporation')?.value || null,
    recorded_owner_phone: q('#res-phone')?.value || null,
    recorded_owner_address: q('#res-mailing')?.value || null,
    true_owner_name: trueOwner,
    principal_names: q('#res-principal-names')?.value || null,
    phone_2: q('#res-phone-2')?.value || null,
    mailing_address_2: q('#res-mailing-2')?.value || null,
    rba: parseFloat(q('#res-rba')?.value) || null,
    land_acres: parseFloat(q('#res-land-acres')?.value) || null,
    year_built: parseInt(q('#res-year-built')?.value) || null,
    year_renovated: parseInt(q('#res-year-renovated')?.value) || null,
    research_notes: researchNotes,
    research_status: 'completed'
  });

  // Bridge to canonical model with gov change metadata
  canonicalBridge('save_ownership', {
    domain: 'government',
    external_id: String(propertyId || rec.ownership_id),
    source_system: 'gov_supabase',
    source_type: 'asset',
    owner_name: recordedOwner,
    true_owner_name: trueOwner,
    notes: researchNotes,
    gov_change_event_id: writeResult?.change_event_id || null,
    gov_correlation_id: writeResult?.correlation_id || null,
    source_record_id: propertyId,
    source_table: 'properties'
  });

  // Ensure canonical entity link exists for this gov property
  if (propertyId) {
    canonicalBridge('update_entity', {
      external_id: String(propertyId),
      source_system: 'gov_supabase',
      source_type: 'asset',
      fields: {
        name: rec.address || rec.property_name || `Government Property ${propertyId}`,
        address: rec.address || null,
        city: rec.city || null,
        state: rec.state || null,
        asset_type: 'government_leased'
      }
    });
  }

  if (salePrice || capRate) {
    await saveLoanFields(rec);
  }
}

async function saveLead(rec) {
  const saleDate = q('#res-sale-date')?.value || null;
  const salePrice = parseFloat(q('#res-sale-price')?.value) || null;
  const capRate = parseFloat(q('#res-cap-rate')?.value) || null;
  const buyer = q('#res-buyer')?.value || null;
  const seller = q('#res-seller')?.value || null;
  const quickStatus = q('#res-quick-status')?.value || null;

  const leadData = {
    lead_id: rec.lead_id,
    lease_number: rec.lease_number || null,
    recorded_owner: q('#res-recorded-owner')?.value || null,
    true_owner: q('#res-true-owner')?.value || null,
    owner_type: q('#res-owner-type')?.value || null,
    contact_email: q('#res-principal-email')?.value || null,
    contact_phone: q('#res-phone')?.value || null,
    contact_mailing: q('#res-mailing')?.value || null,
    research_notes: q('#res-notes')?.value || null,
    research_status: 'completed'
  };

  if (quickStatus) {
    leadData.pipeline_status = quickStatus;
  }

  // Use Gov write service for lead research updates
  let writeResult = null;
  try {
    writeResult = await govWriteService('lead-research', leadData);
  } catch (err) {
    console.error('Gov lead-research write service error:', err);
    showToast('Error saving lead via write service: ' + err.message, 'error');
  }

  // ── Prior Sale → sales_transactions ──
  const propertyId = rec.matched_property_id || rec.property_id;
  if ((saleDate || salePrice || buyer || seller) && propertyId) {
    try {
      await applyInsertWithFallback({
        proxyBase: '/api/gov-query',
        table: 'sales_transactions',
        idColumn: 'property_id',
        recordIdentifier: propertyId,
        data: {
          property_id: propertyId,
          sale_date: saleDate,
          sold_price: salePrice,
          cap_rate: capRate,
          buyer_name: buyer,
          seller_name: seller
        },
        source_surface: 'gov_lead_research',
        propagation_scope: 'prior_sale_record'
      });
    } catch (err) {
      console.error('Error saving sale transaction from lead:', err);
    }
  }

  // ── Property Details → properties table ──
  if (propertyId) {
    const propPatch = {};
    const rba = parseFloat(q('#res-rba')?.value) || null;
    const landAcres = parseFloat(q('#res-land-acres')?.value) || null;
    const yearBuilt = parseInt(q('#res-year-built')?.value) || null;
    const yearRenovated = parseInt(q('#res-year-renovated')?.value) || null;
    const buildingClass = q('#res-building-class')?.value || null;
    const stories = parseInt(q('#res-stories')?.value) || null;
    const parking = parseInt(q('#res-parking')?.value) || null;
    const zoning = q('#res-zoning')?.value || null;
    const condition = q('#res-condition')?.value || null;
    const annualRent = parseFloat(q('#res-annual-rent')?.value) || null;
    const estValue = parseFloat(q('#res-est-value')?.value) || null;

    if (rba) propPatch.rba = rba;
    if (landAcres) propPatch.land_acres = landAcres;
    if (yearBuilt) propPatch.year_built = yearBuilt;
    if (yearRenovated) propPatch.year_renovated = yearRenovated;
    if (buildingClass) propPatch.building_class = buildingClass;
    if (stories) propPatch.stories = stories;
    if (parking) propPatch.parking_spaces = parking;
    if (zoning) propPatch.zoning = zoning;
    if (condition) propPatch.property_condition = condition;
    if (annualRent) propPatch.last_known_rent = annualRent;
    if (estValue) propPatch.current_value_estimate = estValue;

    if (Object.keys(propPatch).length > 0) {
      await patchRecord('properties', 'property_id', propertyId, propPatch);
    }
  }

  // ── Loan / Debt ──
  const lender = q('#res-lender')?.value || null;
  const loanAmount = parseFloat(q('#res-loan-amount')?.value) || null;
  const interestRate = parseFloat(q('#res-interest-rate')?.value) || null;
  const loanType = q('#res-loan-type')?.value || null;
  const loanOrig = q('#res-loan-orig')?.value || null;
  const loanMaturity = q('#res-loan-maturity')?.value || null;
  const ltv = parseFloat(q('#res-ltv')?.value) || null;
  const recourse = q('#res-recourse')?.value || null;

  if ((lender || loanAmount) && propertyId) {
    const loanData = {
      property_id: propertyId,
      index_name: lender,
      loan_amount: loanAmount,
      interest_rate_percent: interestRate,
      loan_type: loanType,
      origination_date: loanOrig,
      maturity_date: loanMaturity,
      loan_to_value: ltv,
      recourse: recourse
    };

    const existingLoan = govData.loans.find(l => l.property_id === propertyId);
    if (existingLoan) {
      await patchRecord('loans', 'property_id', propertyId, loanData);
    } else {
      try {
        await applyInsertWithFallback({
          proxyBase: '/api/gov-query',
          table: 'loans',
          idColumn: 'property_id',
          recordIdentifier: propertyId,
          data: loanData,
          source_surface: 'gov_lead_research',
          propagation_scope: 'loan_record'
        });
      } catch (err) {
        console.error('Error saving loan from lead:', err);
      }
    }
  }

  // Bridge to canonical model with gov change metadata
  canonicalBridge('complete_research', {
    domain: 'government',
    research_type: 'ownership',
    external_id: String(rec.property_id || rec.lead_id),
    source_system: 'gov_supabase',
    source_type: 'lead',
    outcome: quickStatus === 'not_applicable' ? 'not_applicable' : 'completed',
    notes: leadData.research_notes,
    gov_change_event_id: writeResult?.change_event_id || null,
    gov_correlation_id: writeResult?.correlation_id || null,
    source_record_id: rec.lead_id,
    source_table: 'prospect_leads',
    title: rec.address || rec.lease_number || `Lead ${rec.lead_id}`,
    entity_fields: {
      name: rec.address || leadData.true_owner || leadData.recorded_owner || `Lead ${rec.lead_id}`,
      email: leadData.contact_email || null,
      phone: leadData.contact_phone || null,
      address: rec.address || null,
      city: rec.city || null,
      state: rec.state || null,
      asset_type: 'government_leased'
    }
  });

  // Ensure canonical entity link exists for this gov lead
  if (rec.lead_id) {
    canonicalBridge('update_entity', {
      external_id: String(rec.lead_id),
      source_system: 'gov_supabase',
      source_type: 'lead',
      fields: {
        name: rec.address || leadData.true_owner || leadData.recorded_owner || `Lead ${rec.lead_id}`,
        email: leadData.contact_email || null,
        phone: leadData.contact_phone || null,
        address: rec.address || null,
        city: rec.city || null,
        state: rec.state || null,
        asset_type: 'government_leased'
      }
    });
  }
}

async function saveIntel(rec) {
  const propertyId = rec.property_id;
  if (!propertyId) {
    showToast('No property ID — cannot save intel', 'error');
    return;
  }

  // ── Prior Sale → sales_transactions table ──
  const saleDate = q('#res-intel-sale-date')?.value || null;
  const salePrice = parseFloat(q('#res-intel-sale-price')?.value) || null;
  const capRate = parseFloat(q('#res-intel-cap-rate')?.value) || null;
  const buyer = q('#res-intel-buyer')?.value || null;
  const seller = q('#res-intel-seller')?.value || null;

  if (saleDate || salePrice || buyer || seller) {
    const salePayload = {
      property_id: propertyId,
      sale_date: saleDate,
      sold_price: salePrice,
      cap_rate: capRate,
      buyer_name: buyer,
      seller_name: seller
    };
    try {
      await applyInsertWithFallback({
        proxyBase: '/api/gov-query',
        table: 'sales_transactions',
        idColumn: 'property_id',
        recordIdentifier: propertyId,
        data: salePayload,
        source_surface: 'gov_intel_research',
        propagation_scope: 'prior_sale_record'
      });
    } catch (err) {
      console.error('Error saving sale transaction:', err);
    }
  }

  // ── Property Details → properties table ──
  const propertyPatch = {};
  const rba = parseFloat(q('#res-intel-rba')?.value) || null;
  const landAcres = parseFloat(q('#res-intel-land-acres')?.value) || null;
  const yearBuilt = parseInt(q('#res-intel-year-built')?.value) || null;
  const yearRenovated = parseInt(q('#res-intel-year-renovated')?.value) || null;
  const buildingClass = q('#res-intel-building-class')?.value || null;
  const stories = parseInt(q('#res-intel-stories')?.value) || null;
  const parking = parseInt(q('#res-intel-parking')?.value) || null;
  const zoning = q('#res-intel-zoning')?.value || null;
  const condition = q('#res-intel-condition')?.value || null;
  const annualRent = parseFloat(q('#res-intel-annual-rent')?.value) || null;
  const estValue = parseFloat(q('#res-intel-est-value')?.value) || null;
  const recordedOwner = q('#res-intel-recorded-owner')?.value || null;
  const trueOwner = q('#res-intel-true-owner')?.value || null;

  if (rba) propertyPatch.rba = rba;
  if (landAcres) propertyPatch.land_acres = landAcres;
  if (yearBuilt) propertyPatch.year_built = yearBuilt;
  if (yearRenovated) propertyPatch.year_renovated = yearRenovated;
  if (buildingClass) propertyPatch.building_class = buildingClass;
  if (stories) propertyPatch.stories = stories;
  if (parking) propertyPatch.parking_spaces = parking;
  if (zoning) propertyPatch.zoning = zoning;
  if (condition) propertyPatch.property_condition = condition;
  if (annualRent) propertyPatch.last_known_rent = annualRent;
  if (estValue) propertyPatch.current_value_estimate = estValue;
  propertyPatch.intel_status = 'completed';

  if (Object.keys(propertyPatch).length > 1) {
    await patchRecord('properties', 'property_id', propertyId, propertyPatch);
  }

  // ── Ownership → write service ──
  if (recordedOwner || trueOwner) {
    try {
      await govWriteService('ownership', {
        property_id: propertyId,
        recorded_owner: recordedOwner,
        true_owner: trueOwner,
        owner_type: q('#res-intel-owner-type')?.value || null
      });
    } catch (err) {
      console.error('Gov ownership write error (intel):', err);
    }
  }

  // ── Loan → loans table ──
  const lender = q('#res-intel-lender')?.value || null;
  const loanAmount = parseFloat(q('#res-intel-loan-amount')?.value) || null;
  const interestRate = parseFloat(q('#res-intel-interest-rate')?.value) || null;
  const loanType = q('#res-intel-loan-type')?.value || null;
  const loanOrig = q('#res-intel-loan-orig')?.value || null;
  const loanMaturity = q('#res-intel-loan-maturity')?.value || null;
  const ltv = parseFloat(q('#res-intel-ltv')?.value) || null;
  const recourse = q('#res-intel-recourse')?.value || null;

  if (lender || loanAmount) {
    const loanData = {
      property_id: propertyId,
      index_name: lender,
      loan_amount: loanAmount,
      interest_rate_percent: interestRate,
      loan_type: loanType,
      origination_date: loanOrig,
      maturity_date: loanMaturity,
      loan_to_value: ltv,
      recourse: recourse
    };

    const existingLoan = govData.loans.find(l => l.property_id === propertyId);
    if (existingLoan) {
      await patchRecord('loans', 'property_id', propertyId, loanData);
    } else {
      try {
        await applyInsertWithFallback({
          proxyBase: '/api/gov-query',
          table: 'loans',
          idColumn: 'property_id',
          recordIdentifier: propertyId,
          data: loanData,
          source_surface: 'gov_intel_research',
          propagation_scope: 'loan_record'
        });
      } catch (err) {
        console.error('Error saving loan (intel):', err);
      }
    }
  }

  // ── Research Notes → research_queue_outcomes ──
  const notes = q('#res-intel-notes')?.value || null;
  const source = q('#res-intel-source')?.value || null;
  const researchDate = q('#res-intel-date')?.value || null;

  if (notes || source) {
    try {
      const result = await applyInsertWithFallback({
        proxyBase: '/api/gov-query',
        table: 'research_queue_outcomes',
        idColumn: 'selected_property_id',
        recordIdentifier: propertyId,
        data: {
          queue_type: 'intel_research',
          status: 'completed',
          notes: [source ? `[${source}]` : '', notes].filter(Boolean).join(' '),
          selected_property_id: propertyId,
          assigned_at: researchDate || new Date().toISOString()
        },
        source_surface: 'gov_intel_research',
        propagation_scope: 'research_queue_outcome'
      });
      if (!result.ok) {
        console.error('Error saving intel research notes:', result.errors || []);
      }
    } catch (err) {
      console.error('Error saving intel research notes:', err);
    }
  }

  // ── Bridge to canonical model ──
  canonicalBridge('complete_research', {
    domain: 'government',
    research_type: 'intel',
    external_id: String(propertyId),
    source_system: 'gov_supabase',
    source_type: 'asset',
    outcome: 'completed',
    notes: notes,
    source_record_id: propertyId,
    source_table: 'properties',
    title: rec.address || rec.property_name || `Property ${propertyId}`,
    entity_fields: {
      name: rec.address || rec.property_name || `Property ${propertyId}`,
      address: rec.address || null,
      city: rec.city || null,
      state: rec.state || null,
      asset_type: 'government_leased'
    }
  });

  if (recordedOwner || trueOwner) {
    canonicalBridge('update_entity', {
      external_id: String(propertyId),
      source_system: 'gov_supabase',
      source_type: 'asset',
      fields: {
        name: rec.address || rec.property_name || `Property ${propertyId}`,
        address: rec.address || null,
        city: rec.city || null,
        state: rec.state || null,
        asset_type: 'government_leased'
      }
    });
  }
}

async function patchRecord(table, idCol, idVal, data) {
  // Route through closed-loop mutation service with fallback to direct PATCH
  try {
    const result = await applyChangeWithFallback({
      proxyBase: '/api/gov-query',
      table,
      idColumn: idCol,
      idValue: idVal,
      data,
      source_surface: 'gov_workspace'
    });

    if (!result.ok) {
      console.error(`patchRecord error: ${(result.errors || []).join(', ')}`);
      showToast('Error saving data', 'error');
      return false;
    }

    return true;
  } catch (err) {
    console.error('patchRecord error:', err);
    showToast('Error saving', 'error');
    return false;
  }
}

async function saveLoanFields(rec) {
  const lenderName = q('#res-lender')?.value || null;
  const loanAmount = parseFloat(q('#res-loan-amount')?.value) || null;
  const loanType = q('#res-loan-type')?.value || null;
  const loanStatus = q('#res-loan-status')?.value || null;
  
  if (!lenderName && !loanAmount) return;
  
  const propertyId = rec.matched_property_id || rec.property_id;
  if (!propertyId) return;
  
  // Find existing loan
  const existingLoan = govData.loans.find(l => l.property_id === propertyId);
  
  const loanData = {
    property_id: propertyId,
    index_name: lenderName || null,
    loan_amount: loanAmount || null,
    loan_type: loanType || null,
    status: loanStatus || null
  };
  
  if (existingLoan) {
    await patchRecord('loans', 'property_id', propertyId, loanData);
  } else {
    try {
      const response = await applyInsertWithFallback({
        proxyBase: '/api/gov-query',
        table: 'loans',
        idColumn: 'property_id',
        recordIdentifier: propertyId,
        data: loanData,
        source_surface: 'gov_research_resolution',
        propagation_scope: 'loan_record'
      });
      
      if (!response.ok) {
        console.error('Error creating loan record:', response.errors || []);
      }
    } catch (err) {
      console.error('Error creating loan record:', err);
    }
  }
}

async function researchMark(mark) {
  const rec = researchQueue[researchIdx];
  if (!rec) return;

  let status = 'marked';
  if (mark === 'spe_rename') status = 'spe_rename';
  if (mark === 'na') status = 'not_applicable';

  if (researchMode === 'ownership') {
    // ownership_history is not write-service-protected — patch directly
    const ok = await patchRecord('ownership_history', 'ownership_id', rec.ownership_id, { research_status: status });
    if (!ok) return;
  } else if (researchMode === 'intel') {
    // Intel marks go to properties table
    const propertyId = rec.property_id;
    if (propertyId) {
      const ok = await patchRecord('properties', 'property_id', propertyId, { intel_status: status });
      if (!ok) return;
    }
  } else {
    // prospect_leads must use Gov write service
    try {
      await govWriteService('lead-research', {
        lead_id: rec.lead_id,
        research_status: status
      });
    } catch (err) {
      console.error('Error marking lead via write service:', err);
      showToast('Error saving: ' + err.message, 'error');
      return;
    }
  }

  researchIdx++;
  renderGovTab();
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

function setResearchFilter(filter) {
  researchFilter = filter;
  researchIdx = 0;
  loadResearchQueue().then(() => {
    renderGovTab();
  });
}

function getGovEvidenceActor() {
  if (typeof LCC_USER !== 'undefined') {
    return LCC_USER.email || LCC_USER.display_name || LCC_USER.id || 'lcc_user';
  }
  return 'lcc_user';
}

function getGovEvidenceContextRecord() {
  return Array.isArray(researchQueue) ? (researchQueue[researchIdx] || null) : null;
}

function getGovEvidenceContextKey(rec) {
  if (!rec) return 'none';
  return [researchMode || 'research', rec.lead_id || '', rec.property_id || rec.matched_property_id || '', rec.ownership_id || '', rec.lease_number || ''].join(':');
}

function getGovEvidenceSourceAttachment() {
  if (typeof getLiveIngestState !== 'function') return null;
  const state = getLiveIngestState('government');
  const attachments = Array.isArray(state?.attachments) ? state.attachments : [];
  const images = attachments.filter((item) => item && item.kind === 'image' && item.data_url);
  return images.length ? images[images.length - 1] : null;
}

function getGovEvidenceSourceLabel() {
  const attachment = getGovEvidenceSourceAttachment();
  return attachment?.name || 'No screenshot uploaded in Live Intake yet';
}
function getGovEvidenceBinding(rec) {
  return {
    lead_id: rec?.lead_id || null,
    property_id: rec?.property_id || rec?.matched_property_id || null,
    ownership_id: rec?.ownership_id || null
  };
}

function syncGovEvidenceContext() {
  const rec = getGovEvidenceContextRecord();
  const nextKey = getGovEvidenceContextKey(rec);
  if (govEvidenceState.contextKey === nextKey) return rec;
  govEvidenceState = {
    contextKey: nextKey,
    screenshotName: '',
    screenshotDataUrl: '',
    review: null,
    artifactId: null,
    loading: false,
    queue: [],
    queueLoading: false,
    queueLoaded: false,
    queueError: ''
  };
  return rec;
}

function getGovEvidenceNotesEl() {
  return document.getElementById(researchMode === 'intel' ? 'res-intel-notes' : 'res-notes');
}

function appendGovEvidenceNote(note) {
  const el = getGovEvidenceNotesEl();
  if (!el || !note) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `[EVIDENCE ${stamp}] ${note}`;
  el.value = el.value ? `${el.value}\n${line}` : line;
}

function setGovEvidenceField(selectors, value) {
  if (value == null || value === '') return;
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el) continue;
    el.value = value;
    return;
  }
}

function pickGovEvidenceValue(...values) {
  for (const value of values) {
    if (value != null && value !== '') return value;
  }
  return null;
}

function normalizeGovEvidenceCompareValue(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function readGovEvidenceCurrentField(kind, rec) {
  const selectors = {
    owner: ['#res-true-owner', '#res-intel-true-owner', '#res-recorded-owner', '#res-intel-recorded-owner'],
    lender: ['#res-lender', '#res-intel-lender'],
    rba: ['#res-rba', '#res-intel-rba'],
    year_built: ['#res-year-built', '#res-intel-year-built']
  };
  for (const selector of (selectors[kind] || [])) {
    const el = document.querySelector(selector);
    const value = el?.value;
    if (value != null && String(value).trim() !== '') return value;
  }
  if (!rec) return '';
  if (kind === 'owner') return rec.true_owner || rec.recorded_owner || rec.new_owner || rec.prior_owner || '';
  if (kind === 'lender') return rec._loan?.index_name || '';
  if (kind === 'rba') return rec.rba || rec.square_feet || '';
  if (kind === 'year_built') return rec.year_built || '';
  return '';
}

function buildGovEvidenceConflictList(review, rec) {
  if (!review || typeof review !== 'object') return [];
  const candidates = [
    {
      key: 'owner',
      label: 'Owner',
      currentValue: readGovEvidenceCurrentField('owner', rec),
      evidenceValue: pickGovEvidenceValue(review.ownership?.true_owner, review.ownership?.current_owner, review.property?.owner_name)
    },
    {
      key: 'lender',
      label: 'Lender',
      currentValue: readGovEvidenceCurrentField('lender', rec),
      evidenceValue: pickGovEvidenceValue(review.loan?.lender, review.loan?.index_name)
    },
    {
      key: 'rba',
      label: 'RBA',
      currentValue: readGovEvidenceCurrentField('rba', rec),
      evidenceValue: pickGovEvidenceValue(review.property?.rba, review.property?.building_sf, review.building?.rba)
    },
    {
      key: 'year_built',
      label: 'Year Built',
      currentValue: readGovEvidenceCurrentField('year_built', rec),
      evidenceValue: pickGovEvidenceValue(review.property?.year_built, review.building?.year_built)
    }
  ];
  return candidates.filter((item) => {
    if (item.currentValue == null || item.currentValue === '') return false;
    if (item.evidenceValue == null || item.evidenceValue === '') return false;
    return normalizeGovEvidenceCompareValue(item.currentValue) !== normalizeGovEvidenceCompareValue(item.evidenceValue);
  }).map((item, idx) => ({
    id: `${item.key}:${idx}`,
    resolution: '',
    ...item
  }));
}

function applyGovEvidenceConflictResolution(conflictId, resolution) {
  const conflict = govEvidenceState.conflicts.find((item) => item.id === conflictId);
  if (!conflict || !govEvidenceState.review) return;
  conflict.resolution = resolution;
  if (resolution !== 'keep_current') return;

  if (conflict.key === 'owner') {
    govEvidenceState.review.ownership = govEvidenceState.review.ownership || {};
    govEvidenceState.review.property = govEvidenceState.review.property || {};
    govEvidenceState.review.ownership.true_owner = conflict.currentValue;
    govEvidenceState.review.ownership.current_owner = conflict.currentValue;
    govEvidenceState.review.property.owner_name = conflict.currentValue;
  }
  if (conflict.key === 'lender') {
    govEvidenceState.review.loan = govEvidenceState.review.loan || {};
    govEvidenceState.review.loan.lender = conflict.currentValue;
    govEvidenceState.review.loan.index_name = conflict.currentValue;
  }
  if (conflict.key === 'rba') {
    govEvidenceState.review.property = govEvidenceState.review.property || {};
    govEvidenceState.review.building = govEvidenceState.review.building || {};
    govEvidenceState.review.property.rba = conflict.currentValue;
    govEvidenceState.review.property.building_sf = conflict.currentValue;
    govEvidenceState.review.building.rba = conflict.currentValue;
  }
  if (conflict.key === 'year_built') {
    govEvidenceState.review.property = govEvidenceState.review.property || {};
    govEvidenceState.review.building = govEvidenceState.review.building || {};
    govEvidenceState.review.property.year_built = conflict.currentValue;
    govEvidenceState.review.building.year_built = conflict.currentValue;
  }
}

function unresolvedGovEvidenceConflicts() {
  return (govEvidenceState.conflicts || []).filter((item) => !item.resolution);
}

function renderGovEvidenceConflictPanel() {
  if (!govEvidenceState.conflicts?.length) return '';
  const unresolved = unresolvedGovEvidenceConflicts();
  return `<div class="live-ingest-callout warn" style="margin-top:12px">
    <div style="font-weight:700;margin-bottom:8px">Conflict Review Required</div>
    <div style="margin-bottom:10px">The screenshot evidence disagrees with current research values on ${unresolved.length} field${unresolved.length === 1 ? '' : 's'}. Choose whether to keep the current value or trust the screenshot before safe apply.</div>
    <div style="display:grid;gap:8px">
      ${govEvidenceState.conflicts.map((conflict) => `<div style="border:1px solid rgba(248,113,113,0.25);border-radius:8px;padding:10px;background:rgba(248,113,113,0.04)">
        <div style="font-size:12px;font-weight:700;color:var(--text)">${esc(conflict.label)}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:4px">Current: ${esc(String(conflict.currentValue || ''))}</div>
        <div style="font-size:12px;color:var(--text2)">Evidence: ${esc(String(conflict.evidenceValue || ''))}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button class="btn-secondary" type="button" data-gov-evidence-conflict="${esc(conflict.id)}:keep_current">Keep Current${conflict.resolution === 'keep_current' ? ' ✓' : ''}</button>
          <button class="btn-secondary" type="button" data-gov-evidence-conflict="${esc(conflict.id)}:use_evidence">Use Evidence${conflict.resolution === 'use_evidence' ? ' ✓' : ''}</button>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}
function applyGovEvidenceReviewToForm(review) {
  if (!review || typeof review !== 'object') return;
  const owner = pickGovEvidenceValue(
    review.ownership?.true_owner,
    review.ownership?.current_owner,
    review.property?.owner_name,
    review.owner?.name
  );
  const recordedOwner = pickGovEvidenceValue(
    review.ownership?.recorded_owner,
    review.property?.owner_name,
    owner
  );
  const lender = pickGovEvidenceValue(review.loan?.lender, review.loan?.index_name);
  const loanAmount = pickGovEvidenceValue(review.loan?.current_balance, review.loan?.loan_amount);
  const rba = pickGovEvidenceValue(review.property?.rba, review.property?.building_sf, review.building?.rba);
  const yearBuilt = pickGovEvidenceValue(review.property?.year_built, review.building?.year_built);
  setGovEvidenceField(['#res-true-owner', '#res-intel-true-owner'], owner);
  setGovEvidenceField(['#res-recorded-owner', '#res-intel-recorded-owner'], recordedOwner);
  setGovEvidenceField(['#res-lender', '#res-intel-lender'], lender);
  setGovEvidenceField(['#res-loan-amount', '#res-intel-loan-amount'], loanAmount);
  setGovEvidenceField(['#res-rba', '#res-intel-rba'], rba);
  setGovEvidenceField(['#res-year-built', '#res-intel-year-built'], yearBuilt);
}

function renderGovEvidenceWorkbench() {
  const rec = syncGovEvidenceContext();
  const binding = getGovEvidenceBinding(rec);
  const queueHtml = govEvidenceState.queueLoading
    ? '<div class="live-ingest-empty" style="margin-top:8px">Loading pending evidence rows...</div>'
    : govEvidenceState.queue.length
      ? `<div style="display:grid;gap:8px;margin-top:10px">${govEvidenceState.queue.map((row, idx) => `
          <div style="border:1px solid var(--border);border-radius:10px;padding:10px;background:rgba(255,255,255,0.02)">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
              <div>
                <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.08em">${esc(row.observation_type || 'observation')}</div>
                <div style="font-size:13px;color:var(--text);margin-top:4px">${esc(row.summary || row.observation_value || 'Pending evidence row')}</div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                <button class="btn-secondary" type="button" data-gov-evidence-note="${idx}">Note</button>
                <button class="btn-secondary" type="button" data-gov-evidence-review="${idx}">Review</button>
                <button class="btn-secondary" type="button" data-gov-evidence-dismiss="${idx}">Dismiss</button>
                <button class="btn-primary" type="button" data-gov-evidence-promote="${idx}">Promote</button>
              </div>
            </div>
          </div>`).join('')}</div>`
      : '<div class="live-ingest-empty" style="margin-top:8px">No pending observation rows for this record.</div>';

  return `<section class="live-ingest-card" style="margin-top:16px">
    <div class="live-ingest-head">
      <div>
        <div class="live-ingest-kicker">Gov Evidence</div>
        <h3>Extract CoStar screenshots into reviewed government evidence</h3>
        <p>This is the LCC runtime bridge for the GovernmentProject evidence workflow. It saves artifacts, applies low-risk actions, and queues tenant or lease rows for review.</p>
      </div>
      <div class="live-ingest-context">${rec ? `<div><strong>${esc(rec.address || rec.property_name || rec.lease_number || 'Current record')}</strong><span>${esc([binding.lead_id ? `lead ${binding.lead_id}` : '', binding.property_id ? `property ${binding.property_id}` : '', binding.ownership_id ? `ownership ${binding.ownership_id}` : ''].filter(Boolean).join(' | '))}</span></div>` : '<div><strong>No record bound</strong><span>Move to a government research row to use evidence actions.</span></div>'}</div>
    </div>
    <div class="live-ingest-grid">
      <div class="live-ingest-pane">
        <div class="form-group">
          <label>Evidence Source</label>
          <div class="live-ingest-stamp" style="margin-top:8px">Using latest image from Live Intake: ${esc(getGovEvidenceSourceLabel())}</div>
          <div class="live-ingest-stamp" style="margin-top:6px">Upload once in the shared Live Intake panel above. The government evidence workflow will auto-use the latest screenshot image from that queue.</div>
        </div>
        <div class="live-ingest-actions">
          <button class="btn-primary" type="button" data-gov-evidence-extract ${govEvidenceState.loading || !rec || !getGovEvidenceSourceAttachment() ? 'disabled' : ''}>${govEvidenceState.loading ? 'Extracting...' : 'Extract Latest Screenshot'}</button>
          <button class="btn-secondary" type="button" data-gov-evidence-clear ${govEvidenceState.loading ? 'disabled' : ''}>Clear Review</button>
        </div>
        ${govEvidenceState.review ? `<div class="live-ingest-callout" style="margin-top:12px">${esc(buildGovEvidenceSummary(govEvidenceState.review))}</div>` : ''}
        ${renderGovEvidenceConflictPanel()}
        ${govEvidenceState.queueError ? `<div class="live-ingest-callout warn" style="margin-top:12px">${esc(govEvidenceState.queueError)}</div>` : ''}
      </div>
      <div class="live-ingest-pane">
        <div class="live-ingest-actions" style="margin-bottom:8px;flex-wrap:wrap">
          <button class="btn-secondary" type="button" data-gov-evidence-save ${govEvidenceState.loading || !govEvidenceState.review ? 'disabled' : ''}>Save Artifact</button>
          <button class="btn-primary" type="button" data-gov-evidence-safe ${govEvidenceState.loading || !govEvidenceState.review || unresolvedGovEvidenceConflicts().length ? 'disabled' : ''}>${unresolvedGovEvidenceConflicts().length ? 'Resolve Conflicts First' : 'Apply Safe Evidence'}</button>
          <button class="btn-secondary" type="button" data-gov-evidence-promote-rows ${govEvidenceState.loading || !govEvidenceState.review ? 'disabled' : ''}>Promote Rows</button>
          <button class="btn-secondary" type="button" data-gov-evidence-refresh-queue ${govEvidenceState.queueLoading || !rec ? 'disabled' : ''}>${govEvidenceState.queueLoading ? 'Refreshing...' : 'Refresh Queue'}</button>
          <button class="btn-secondary" type="button" data-gov-evidence-health ${govEvidenceState.healthLoading ? 'disabled' : ''}>${govEvidenceState.healthLoading ? 'Checking...' : 'Check Evidence Health'}</button>
        </div>
        <div class="live-ingest-stamp">Artifact: ${esc(govEvidenceState.artifactId || 'not saved yet')}</div>
        <div class="live-ingest-stamp" style="margin-top:6px">Source detection: auto-routed from shared intake image</div>
        ${govEvidenceState.health ? `<div class="live-ingest-callout ${govEvidenceState.health.status === 'ok' ? '' : 'warn'}" style="margin-top:10px">${esc(buildGovEvidenceHealthSummary(govEvidenceState.health))}</div>` : ''}
        <div style="margin-top:10px">
          <div class="live-ingest-results-title">Pending Observation Queue</div>
          ${queueHtml}
        </div>
      </div>
    </div>
  </section>`;
}

function buildGovEvidenceHealthSummary(health) {
  if (!health || typeof health !== 'object') return 'Evidence health unavailable.';
  const bits = [];
  bits.push(`status: ${health.status || 'unknown'}`);
  if (health.configuration) {
    bits.push(`openai: ${health.configuration.openai_api_key_configured ? 'ok' : 'missing'}`);
    bits.push(`supabase: ${health.configuration.supabase_service_role_configured ? 'ok' : 'missing'}`);
  }
  if (health.database) {
    bits.push(`db: ${health.database.connected ? 'ok' : 'down'}`);
    bits.push(`artifacts: ${health.database.research_artifacts_table ? 'ok' : 'missing'}`);
    bits.push(`observations: ${health.database.research_artifact_observations_table ? 'ok' : 'missing'}`);
    if (health.database.error) bits.push(`error: ${health.database.error}`);
  }
  return bits.join(' | ');
}

async function checkGovEvidenceHealth() {
  govEvidenceState.healthLoading = true;
  rerenderGovEvidenceOnly();
  try {
    govEvidenceState.health = await govEvidenceApi('evidence-health');
    showToast(govEvidenceState.health.status === 'ok' ? 'Evidence health check passed' : 'Evidence health check degraded', govEvidenceState.health.status === 'ok' ? 'success' : 'warning');
  } catch (err) {
    govEvidenceState.health = { status: 'error', database: { connected: false, error: err.message } };
    showToast(`Evidence health check failed: ${err.message}`, 'error');
  } finally {
    govEvidenceState.healthLoading = false;
    rerenderGovEvidenceOnly();
  }
}
function buildGovEvidenceSummary(review) {
  const bits = [];
  const address = pickGovEvidenceValue(review.property?.address, review.property?.property_name);
  const owner = pickGovEvidenceValue(review.ownership?.true_owner, review.ownership?.current_owner, review.property?.owner_name);
  const lender = pickGovEvidenceValue(review.loan?.lender, review.loan?.index_name);
  const avail = pickGovEvidenceValue(review.property?.available_sf, review.building?.available_sf);
  if (address) bits.push(address);
  if (owner) bits.push(`owner: ${owner}`);
  if (lender) bits.push(`lender: ${lender}`);
  if (avail) bits.push(`available: ${avail}`);
  const tenantCount = Array.isArray(review.tenants) ? review.tenants.length : 0;
  const leaseCount = Array.isArray(review.lease_activity) ? review.lease_activity.length : 0;
  if (tenantCount) bits.push(`${tenantCount} tenant row${tenantCount === 1 ? '' : 's'}`);
  if (leaseCount) bits.push(`${leaseCount} lease row${leaseCount === 1 ? '' : 's'}`);
  return bits.join(' | ') || 'Evidence extracted. Review and save if it looks correct.';
}

async function govEvidenceApi(endpoint, options = {}) {
  const query = new URLSearchParams({ endpoint });
  if (options.query && typeof options.query === 'object') {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value != null && value !== '') query.set(key, value);
    });
  }
  const response = await fetch(`/api/gov-evidence?${query.toString()}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.detail?.detail || payload?.detail?.error || payload?.error || 'Request failed';
    throw new Error(detail);
  }
  return payload;
}

async function ensureGovEvidenceArtifactSaved() {
  if (govEvidenceState.artifactId) return govEvidenceState.artifactId;
  const rec = getGovEvidenceContextRecord();
  if (!rec || !govEvidenceState.review) throw new Error('No evidence review payload to save');
  const binding = getGovEvidenceBinding(rec);
  const result = await govEvidenceApi('research-artifacts', {
    method: 'POST',
    body: {
      artifact_type: 'costar_screenshot',
      source_platform: 'costar',
      payload: govEvidenceState.review,
      file_name: govEvidenceState.screenshotName || 'lcc-screenshot.png',
      lead_id: binding.lead_id,
      property_id: binding.property_id,
      ownership_id: binding.ownership_id,
      actor: getGovEvidenceActor()
    }
  });
  govEvidenceState.artifactId = result?.artifact?.artifact_id || result?.artifact?.id || null;
  return govEvidenceState.artifactId;
}

async function loadGovEvidenceObservations(force = false) {
  const rec = syncGovEvidenceContext();
  if (!rec) return;
  if (govEvidenceState.queueLoaded && !force) return;
  govEvidenceState.queueLoading = true;
  govEvidenceState.queueError = '';
  rerenderGovEvidenceOnly();
  try {
    const binding = getGovEvidenceBinding(rec);
    const result = await govEvidenceApi('research-observations', {
      query: {
        status: 'pending_review',
        lead_id: binding.lead_id,
        property_id: binding.property_id,
        ownership_id: binding.ownership_id
      }
    });
    govEvidenceState.queue = Array.isArray(result?.observations) ? result.observations : [];
    govEvidenceState.queueLoaded = true;
  } catch (err) {
    govEvidenceState.queueError = err.message || 'Could not load evidence queue';
  } finally {
    govEvidenceState.queueLoading = false;
    rerenderGovEvidenceOnly();
  }
}

function rerenderGovEvidenceOnly() {
  renderGovTab();
}

async function extractGovEvidenceScreenshot() {
  const rec = syncGovEvidenceContext();
  if (!rec || !govEvidenceState.screenshotDataUrl) return;
  govEvidenceState.loading = true;
  rerenderGovEvidenceOnly();
  try {
    const context = [rec.address, rec.city, rec.state, rec.lease_number].filter(Boolean).join(' | ');
    const result = await govEvidenceApi('extract-screenshot-json', {
      method: 'POST',
      body: {
        image_data_url: govEvidenceState.screenshotDataUrl,
        file_name: govEvidenceState.screenshotName || 'lcc-screenshot.png',
        source: 'costar',
        extra_context: context
      }
    });
    govEvidenceState.review = result?.data || null;
    govEvidenceState.artifactId = null;
    applyGovEvidenceReviewToForm(govEvidenceState.review);
    appendGovEvidenceNote(`Extracted screenshot evidence from ${govEvidenceState.screenshotName || 'screenshot'}.`);
    showToast('Screenshot evidence extracted', 'success');
  } catch (err) {
    showToast(`Evidence extraction failed: ${err.message}`, 'error');
  } finally {
    govEvidenceState.loading = false;
    rerenderGovEvidenceOnly();
  }
}

async function applyGovEvidenceSafeBundle() {
  if (!govEvidenceState.review) return;
  govEvidenceState.loading = true;
  rerenderGovEvidenceOnly();
  const applied = [];
  const skipped = [];
  const endpoints = [
    ['apply-ownership', 'owner'],
    ['apply-listing', 'listing'],
    ['apply-activity-note', 'activity'],
    ['apply-loan', 'loan']
  ];
  try {
    const artifactId = await ensureGovEvidenceArtifactSaved();
    for (const [endpoint, label] of endpoints) {
      try {
        await govEvidenceApi(endpoint, {
          method: 'POST',
          query: { artifact_id: artifactId, actor: getGovEvidenceActor() },
          body: { actor: getGovEvidenceActor() }
        });
        applied.push(label);
      } catch (err) {
        skipped.push(`${label}: ${err.message}`);
      }
    }
    applyGovEvidenceReviewToForm(govEvidenceState.review);
    appendGovEvidenceNote(`Safe evidence applied. Applied: ${applied.join(', ') || 'none'}. ${skipped.length ? `Skipped: ${skipped.join(' | ')}` : ''}`.trim());
    showToast(`Safe evidence applied: ${applied.join(', ') || 'none'}`, applied.length ? 'success' : 'warning');
  } catch (err) {
    showToast(`Safe evidence apply failed: ${err.message}`, 'error');
  } finally {
    govEvidenceState.loading = false;
    rerenderGovEvidenceOnly();
  }
}

async function promoteGovEvidenceRows() {
  if (!govEvidenceState.review) return;
  govEvidenceState.loading = true;
  rerenderGovEvidenceOnly();
  try {
    const artifactId = await ensureGovEvidenceArtifactSaved();
    const result = await govEvidenceApi('promote-observations', {
      method: 'POST',
      query: { artifact_id: artifactId, actor: getGovEvidenceActor() },
      body: { actor: getGovEvidenceActor() }
    });
    const count = result?.promoted_count || 0;
    appendGovEvidenceNote(`Promoted ${count} screenshot observation row${count === 1 ? '' : 's'} into the review queue.`);
    showToast(`Promoted ${count} evidence row${count === 1 ? '' : 's'}`, 'success');
    govEvidenceState.queueLoaded = false;
    await loadGovEvidenceObservations(true);
  } catch (err) {
    govEvidenceState.loading = false;
    rerenderGovEvidenceOnly();
    showToast(`Promote rows failed: ${err.message}`, 'error');
  }
}

async function reviewGovEvidenceObservation(idx, action) {
  const row = govEvidenceState.queue[idx];
  if (!row) return;
  try {
    await govEvidenceApi('review-observation', {
      method: 'POST',
      query: { observation_id: row.observation_id, actor: getGovEvidenceActor() },
      body: { action, actor: getGovEvidenceActor(), resolution_note: `LCC ${action}` }
    });
    showToast(`Observation ${action}`, 'success');
    await loadGovEvidenceObservations(true);
  } catch (err) {
    showToast(`Observation update failed: ${err.message}`, 'error');
  }
}

async function promoteGovEvidenceObservation(idx) {
  const row = govEvidenceState.queue[idx];
  if (!row) return;
  try {
    await govEvidenceApi('promote-observation', {
      method: 'POST',
      query: { observation_id: row.observation_id, actor: getGovEvidenceActor() },
      body: { actor: getGovEvidenceActor(), resolution_note: 'Promoted from LCC evidence queue' }
    });
    appendGovEvidenceNote(`Promoted evidence row: ${row.summary || row.observation_value || row.observation_type || 'observation'}`);
    showToast('Observation promoted', 'success');
    await loadGovEvidenceObservations(true);
  } catch (err) {
    showToast(`Observation promotion failed: ${err.message}`, 'error');
  }
}

function bindGovEvidenceWorkbench() {
  syncGovEvidenceContext();
  const fileInput = document.getElementById('gov-evidence-file');
  if (fileInput) {
    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      govEvidenceState.screenshotName = file.name || 'screenshot.png';
      govEvidenceState.screenshotDataUrl = await readFileAsDataUrl(file);
      govEvidenceState.review = null;
      govEvidenceState.artifactId = null;
      rerenderGovEvidenceOnly();
    };
  }
  document.querySelector('[data-gov-evidence-extract]')?.addEventListener('click', () => extractGovEvidenceScreenshot());
  document.querySelector('[data-gov-evidence-clear]')?.addEventListener('click', () => {
    govEvidenceState.screenshotName = '';
    govEvidenceState.screenshotDataUrl = '';
    govEvidenceState.review = null;
    govEvidenceState.artifactId = null;
    rerenderGovEvidenceOnly();
  });
  document.querySelector('[data-gov-evidence-save]')?.addEventListener('click', async () => {
    try {
      govEvidenceState.loading = true;
      rerenderGovEvidenceOnly();
      await ensureGovEvidenceArtifactSaved();
      appendGovEvidenceNote(`Saved evidence artifact ${govEvidenceState.artifactId}.`);
      showToast('Evidence artifact saved', 'success');
    } catch (err) {
      showToast(`Artifact save failed: ${err.message}`, 'error');
    } finally {
      govEvidenceState.loading = false;
      rerenderGovEvidenceOnly();
    }
  });
  document.querySelector('[data-gov-evidence-safe]')?.addEventListener('click', () => applyGovEvidenceSafeBundle());
  document.querySelector('[data-gov-evidence-promote-rows]')?.addEventListener('click', () => promoteGovEvidenceRows());
  document.querySelector('[data-gov-evidence-refresh-queue]')?.addEventListener('click', () => loadGovEvidenceObservations(true));
  document.querySelector('[data-gov-evidence-health]')?.addEventListener('click', () => checkGovEvidenceHealth());
  document.querySelectorAll('[data-gov-evidence-conflict]').forEach((button) => {
    button.onclick = () => {
      const raw = button.dataset.govEvidenceConflict || '';
      const splitAt = raw.lastIndexOf(':');
      if (splitAt <= 0) return;
      const conflictId = raw.slice(0, splitAt);
      const resolution = raw.slice(splitAt + 1);
      applyGovEvidenceConflictResolution(conflictId, resolution);
      if (resolution === 'keep_current') {
        applyGovEvidenceReviewToForm(govEvidenceState.review);
      }
      appendGovEvidenceNote(`[SAFE EVIDENCE CONFLICT] ${conflictId} -> ${resolution}`);
      rerenderGovEvidenceOnly();
    };
  });
  document.querySelectorAll('[data-gov-evidence-note]').forEach((button) => {
    button.onclick = () => {
      const idx = Number(button.dataset.govEvidenceNote);
      const row = govEvidenceState.queue[idx];
      if (!row) return;
      appendGovEvidenceNote(`Evidence row: ${row.summary || row.observation_value || row.observation_type || 'observation'}`);
      showToast('Evidence row appended to notes', 'success');
    };
  });
  document.querySelectorAll('[data-gov-evidence-review]').forEach((button) => {
    button.onclick = () => reviewGovEvidenceObservation(Number(button.dataset.govEvidenceReview), 'reviewed');
  });
  document.querySelectorAll('[data-gov-evidence-dismiss]').forEach((button) => {
    button.onclick = () => reviewGovEvidenceObservation(Number(button.dataset.govEvidenceDismiss), 'dismissed');
  });
  document.querySelectorAll('[data-gov-evidence-promote]').forEach((button) => {
    button.onclick = () => promoteGovEvidenceObservation(Number(button.dataset.govEvidencePromote));
  });
  if (!govEvidenceState.queueLoaded && !govEvidenceState.queueLoading && getGovEvidenceContextRecord()) {
    loadGovEvidenceObservations(false);
  }
}

// ============================================================================
// TAB RENDERERS
// ============================================================================


function renderGovOverview() {
  // ── Kick off lazy-loading sales comps for overview metrics ──
  if (!govSalesComps && !govSalesLoading) {
    govSalesLoading = true;
    (async () => {
      try {
        let all = [], offset = 0;
        while (true) {
          const res = await govQuery('v_sales_comps', '*', { order: 'sale_date.desc.nullslast', limit: 1000, offset });
          const rows = res.data || [];
          all = all.concat(rows);
          if (rows.length < 1000) break;
          offset += 1000;
        }
        govSalesComps = all;
      } catch(e) { govSalesComps = []; }
      govSalesLoading = false;
      const el = document.getElementById('govOverviewSales');
      if (el) el.innerHTML = renderGovSalesMetrics();
      const nmEl = document.getElementById('govOverviewNM');
      if (nmEl) nmEl.innerHTML = renderGovNorthmarqMetrics();
    })();
  }

  let html = '<div style="padding:4px 0">';

  // ── STYLE ──
  html += `<style>
    .gov-info-card { background: var(--s2); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; transition: all 0.15s; position: relative; overflow: hidden; }
    .gov-info-card:hover { border-color: var(--accent); transform: translateY(-1px); box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
    .gov-info-card[onclick] { cursor: pointer; }
    .gov-info-card[onclick]::after { content: '→'; position: absolute; top: 12px; right: 14px; font-size: 14px; color: var(--text3); opacity: 0; transition: opacity 0.15s; }
    .gov-info-card[onclick]:hover::after { opacity: 1; color: var(--accent); }
    .gov-grid { display: grid; gap: 10px; }
    .gov-grid-3 { grid-template-columns: repeat(3, 1fr); }
    .gov-grid-4 { grid-template-columns: repeat(4, 1fr); }
    .gov-grid-5 { grid-template-columns: repeat(5, 1fr); }
    @media (max-width: 700px) {
      .gov-grid-3, .gov-grid-4, .gov-grid-5 { grid-template-columns: repeat(2, 1fr); }
    }
  </style>`;

  // ── Helpers ──
  const _colors = { blue: '#60a5fa', green: '#34d399', cyan: '#22d3ee', purple: '#a78bfa', yellow: '#fbbf24', orange: '#fb923c', red: '#f87171' };
  function govCard(opts) {
    const c = _colors[opts.color] || _colors.blue;
    const clickAttr = opts.tab ? ` onclick="goToGovTab('${opts.tab}')"` : '';
    return `<div class="gov-info-card"${clickAttr}>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:6px">${opts.title}</div>
      <div style="font-size:24px;font-weight:800;color:${c};margin-bottom:4px">${opts.value}</div>
      ${opts.sub ? `<div style="font-size:11px;color:var(--text2)">${opts.sub}</div>` : ''}
    </div>`;
  }
  function govSectionHeader(title, icon, tab) {
    const viewLink = tab ? `<span onclick="goToGovTab('${tab}')" style="cursor:pointer;font-size:11px;color:var(--accent);font-weight:500">View Details →</span>` : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;margin:20px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--border)">
      <div style="font-size:13px;font-weight:700;color:var(--text1)">${icon} ${title}</div>${viewLink}</div>`;
  }
  function inlineBar(items, maxVal) {
    let out = '';
    items.forEach(item => {
      const barW = maxVal > 0 ? Math.round((item.value / maxVal) * 100) : 0;
      out += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div title="${esc(item.label)}" style="width:${item.labelWidth || 100}px;font-size:11px;color:var(--text2);text-align:right;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.label)}</div>
        <div style="flex:1;height:8px;background:var(--s3);border-radius:4px;overflow:hidden"><div style="width:${barW}%;height:100%;background:${item.barColor || '#60a5fa'};border-radius:4px"></div></div>
        <div style="width:${item.valueWidth || 50}px;font-size:10px;color:var(--text2);text-align:right">${item.display}</div>
      </div>`;
    });
    return out;
  }

  // ──────────────────────────────────────
  // DATA COMPUTATIONS
  // ──────────────────────────────────────
  const portfolio = govData.portfolioProperties || [];
  const propCount = govData.properties[0]?.count || portfolio.length;
  const ownership = govData.ownership || [];
  const leads = govData.leads || [];
  const contacts = govData.contacts || [];
  const listings = govData.listings || [];
  const gsaEvents = govData.gsaEvents || [];
  const gsaSnapshots = govData.gsaSnapshots || [];
  const frpp = govData.frppRecords || [];
  const loans = govData.loans || [];
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // Portfolio aggregates
  const withSF = portfolio.filter(p => p.sf_leased > 0);
  const totalSF = withSF.reduce((s, p) => s + (p.sf_leased || 0), 0);
  const totalGrossRent = portfolio.reduce((s, p) => s + (p.gross_rent || 0), 0);
  const withRentPSF = portfolio.filter(p => p.gross_rent_psf > 0);
  const avgRentPSF = withRentPSF.length > 0 ? (withRentPSF.reduce((s,p) => s + p.gross_rent_psf, 0) / withRentPSF.length).toFixed(2) : '—';
  const totalNOI = portfolio.reduce((s, p) => s + (p.noi || 0), 0);
  const distinctAgencies = new Set(portfolio.map(p => p.agency).filter(Boolean)).size;

  // Lease expiration analysis
  const withTerm = portfolio.filter(p => p.firm_term_remaining !== null && p.firm_term_remaining !== undefined);
  const expiring1yr = withTerm.filter(p => p.firm_term_remaining <= 1).length;
  const expiring2yr = withTerm.filter(p => p.firm_term_remaining <= 2).length;
  const expiring5yr = withTerm.filter(p => p.firm_term_remaining > 2 && p.firm_term_remaining <= 5).length;
  const longTerm = withTerm.filter(p => p.firm_term_remaining > 5).length;
  const avgFirmTerm = withTerm.length > 0 ? (withTerm.reduce((s,p) => s + p.firm_term_remaining, 0) / withTerm.length).toFixed(1) : '—';

  // Agency breakdown (top 10 by count)
  const agencyMap = {};
  portfolio.forEach(p => {
    const a = p.agency || 'Unknown';
    if (!agencyMap[a]) agencyMap[a] = { count: 0, rent: 0, sf: 0, termSum: 0, termCount: 0 };
    agencyMap[a].count++;
    agencyMap[a].rent += (p.gross_rent || 0);
    agencyMap[a].sf += (p.sf_leased || 0);
    if (p.firm_term_remaining !== null) { agencyMap[a].termSum += p.firm_term_remaining; agencyMap[a].termCount++; }
  });
  const topAgencies = Object.entries(agencyMap).sort((a,b) => b[1].count - a[1].count).slice(0, 12);
  const topAgenciesByRent = Object.entries(agencyMap).sort((a,b) => b[1].rent - a[1].rent).slice(0, 10);

  // State breakdown
  const stateMap = {};
  portfolio.forEach(p => {
    const s = p.state || 'UNK';
    if (!stateMap[s]) stateMap[s] = { count: 0, rent: 0, sf: 0 };
    stateMap[s].count++;
    stateMap[s].rent += (p.gross_rent || 0);
    stateMap[s].sf += (p.sf_leased || 0);
  });
  const topStates = Object.entries(stateMap).sort((a,b) => b[1].count - a[1].count).slice(0, 10);

  // ═══════════════════════════════════════════════
  // SECTION 1: PORTFOLIO AT A GLANCE
  // ═══════════════════════════════════════════════
  html += govSectionHeader('Portfolio at a Glance', '🏛️', 'search');
  html += '<div class="gov-grid gov-grid-5">';
  html += govCard({ title: 'Total Properties', value: fmtN(propCount), sub: 'government-leased nationwide', color: 'blue', tab: 'search' });
  html += govCard({ title: 'Total SF Leased', value: fmtN(Math.round(totalSF / 1e6)) + 'M', sub: fmtN(withSF.length) + ' properties with data', color: 'green', tab: 'search' });
  html += govCard({ title: 'Total Gross Rent', value: '$' + fmtN(Math.round(totalGrossRent / 1e9)) + 'B', sub: 'annual government rent', color: 'cyan', tab: 'search' });
  html += govCard({ title: 'Avg Rent / SF', value: '$' + avgRentPSF, sub: fmtN(withRentPSF.length) + ' properties', color: 'purple', tab: 'search' });
  html += govCard({ title: 'Agencies Tracked', value: fmtN(distinctAgencies), sub: 'distinct tenants', color: 'yellow', tab: 'search' });
  html += '</div>';

  // Total NOI row
  if (totalNOI > 0) {
    html += '<div class="gov-grid gov-grid-3" style="margin-top:10px">';
    html += govCard({ title: 'Total NOI', value: '$' + fmtN(Math.round(totalNOI / 1e6)) + 'M', sub: 'net operating income', color: 'green', tab: 'search' });
    const avgNOI = withSF.length > 0 ? totalNOI / withSF.length : 0;
    html += govCard({ title: 'Avg NOI / Property', value: avgNOI > 0 ? '$' + fmtN(Math.round(avgNOI / 1000)) + 'K' : '—', sub: 'across portfolio', color: 'blue', tab: 'search' });
    html += govCard({ title: 'Contacts', value: fmtN(contacts.length), sub: 'owners & principals', color: 'purple', tab: 'search' });
    html += '</div>';
  }

  // ═══════════════════════════════════════════════
  // SECTION 2: LEASE EXPIRATION RISK
  // ═══════════════════════════════════════════════
  html += govSectionHeader('Lease Expiration Risk', '⏰', 'pipeline');
  html += '<div class="gov-grid gov-grid-5">';
  html += govCard({ title: 'Expiring < 1 Year', value: fmtN(expiring1yr), sub: withTerm.length > 0 ? (expiring1yr/withTerm.length*100).toFixed(1) + '% of portfolio' : '', color: 'red', tab: 'pipeline' });
  html += govCard({ title: 'Expiring < 2 Years', value: fmtN(expiring2yr), sub: withTerm.length > 0 ? (expiring2yr/withTerm.length*100).toFixed(1) + '% of portfolio' : '', color: 'orange', tab: 'pipeline' });
  html += govCard({ title: '2–5 Year Term', value: fmtN(expiring5yr), sub: 'mid-range leases', color: 'yellow', tab: 'search' });
  html += govCard({ title: '5+ Year Term', value: fmtN(longTerm), sub: 'long-term secured', color: 'green', tab: 'search' });
  html += govCard({ title: 'Avg Firm Term', value: avgFirmTerm + ' yrs', sub: fmtN(withTerm.length) + ' with term data', color: 'blue', tab: 'search' });
  html += '</div>';

  // Expiration timeline bar
  if (withTerm.length > 0) {
    html += '<div class="gov-info-card" style="padding:14px 16px;margin-top:10px">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">Lease Expiration Distribution</div>';
    const buckets = [
      { label: 'Expired / < 0 yrs', count: withTerm.filter(p => p.firm_term_remaining < 0).length, color: '#ef4444' },
      { label: '0 – 1 years', count: withTerm.filter(p => p.firm_term_remaining >= 0 && p.firm_term_remaining <= 1).length, color: '#f87171' },
      { label: '1 – 2 years', count: withTerm.filter(p => p.firm_term_remaining > 1 && p.firm_term_remaining <= 2).length, color: '#fb923c' },
      { label: '2 – 3 years', count: withTerm.filter(p => p.firm_term_remaining > 2 && p.firm_term_remaining <= 3).length, color: '#fbbf24' },
      { label: '3 – 5 years', count: withTerm.filter(p => p.firm_term_remaining > 3 && p.firm_term_remaining <= 5).length, color: '#34d399' },
      { label: '5 – 10 years', count: withTerm.filter(p => p.firm_term_remaining > 5 && p.firm_term_remaining <= 10).length, color: '#22d3ee' },
      { label: '10+ years', count: withTerm.filter(p => p.firm_term_remaining > 10).length, color: '#60a5fa' },
    ];
    const maxBucket = Math.max(...buckets.map(b => b.count));
    html += inlineBar(buckets.map(b => ({
      label: b.label, value: b.count, display: fmtN(b.count), barColor: b.color, labelWidth: 100, valueWidth: 40
    })), maxBucket);
    html += '</div>';
  }

  // ═══════════════════════════════════════════════
  // SECTION 3: AGENCY BREAKDOWN
  // ═══════════════════════════════════════════════
  html += govSectionHeader('Agency Breakdown', '🏢', 'search');

  if (topAgencies.length > 0) {
    // Top agencies by property count
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    html += '<div class="gov-info-card" onclick="goToGovTab(\'search\')" style="cursor:pointer;padding:14px 16px">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">Top Agencies by Property Count</div>';
    const maxAgCount = topAgencies[0][1].count;
    html += inlineBar(topAgencies.map(([name, d]) => ({
      label: name, value: d.count, display: fmtN(d.count), barColor: '#60a5fa', labelWidth: 140, valueWidth: 40
    })), maxAgCount);
    html += '</div>';

    // Top agencies by rent
    html += '<div class="gov-info-card" onclick="goToGovTab(\'search\')" style="cursor:pointer;padding:14px 16px">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">Top Agencies by Annual Rent</div>';
    const maxAgRent = topAgenciesByRent[0][1].rent;
    html += inlineBar(topAgenciesByRent.map(([name, d]) => ({
      label: name, value: d.rent, display: '$' + fmtN(Math.round(d.rent / 1e6)) + 'M', barColor: '#34d399', labelWidth: 140, valueWidth: 56
    })), maxAgRent);
    html += '</div>';
    html += '</div>';

    // Agency avg term remaining
    html += '<div class="gov-info-card" style="padding:14px 16px;margin-top:10px">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">Avg Firm Term Remaining by Major Agency</div>';
    const agencyTerms = topAgencies.filter(([, d]) => d.termCount > 0).map(([name, d]) => ({
      name, avgTerm: d.termSum / d.termCount, count: d.count
    })).sort((a,b) => a.avgTerm - b.avgTerm);
    const maxTerm = Math.max(...agencyTerms.map(a => Math.max(a.avgTerm, 0)), 1);
    html += inlineBar(agencyTerms.map(a => ({
      label: a.name,
      value: Math.max(a.avgTerm, 0),
      display: a.avgTerm.toFixed(1) + ' yrs',
      barColor: a.avgTerm < 1 ? '#f87171' : a.avgTerm < 2 ? '#fb923c' : a.avgTerm < 5 ? '#fbbf24' : '#34d399',
      labelWidth: 140, valueWidth: 50
    })), maxTerm);
    html += '</div>';
  }

  // ═══════════════════════════════════════════════
  // SECTION 4: GEOGRAPHIC DISTRIBUTION
  // ═══════════════════════════════════════════════
  if (topStates.length > 0) {
    html += govSectionHeader('Geographic Distribution', '🗺️', 'search');
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';

    // By count
    html += '<div class="gov-info-card" style="padding:14px 16px">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">Top States by Property Count</div>';
    const maxStCount = topStates[0][1].count;
    html += inlineBar(topStates.map(([st, d]) => ({
      label: STATE_FULL[st] || st, value: d.count, display: fmtN(d.count), barColor: '#a78bfa', labelWidth: 110, valueWidth: 40
    })), maxStCount);
    html += '</div>';

    // By rent
    const topStatesByRent = Object.entries(stateMap).sort((a,b) => b[1].rent - a[1].rent).slice(0, 10);
    html += '<div class="gov-info-card" style="padding:14px 16px">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">Top States by Annual Rent</div>';
    const maxStRent = topStatesByRent[0][1].rent;
    html += inlineBar(topStatesByRent.map(([st, d]) => ({
      label: STATE_FULL[st] || st, value: d.rent, display: '$' + fmtN(Math.round(d.rent / 1e6)) + 'M', barColor: '#22d3ee', labelWidth: 110, valueWidth: 56
    })), maxStRent);
    html += '</div>';
    html += '</div>';
  }

  // ═══════════════════════════════════════════════
  // SECTION 5: OWNERSHIP INTELLIGENCE
  // ═══════════════════════════════════════════════
  const totalOwnershipChanges = ownership.length;
  const withSalePrice = ownership.filter(o => o.sale_price > 0);
  const confirmedValue = withSalePrice.reduce((s, o) => s + (o.sale_price || 0), 0);
  const needsResearch = ownership.filter(o => !o.research_status || o.research_status === 'pending').length;
  const ownershipCaps = withSalePrice.filter(o => o.cap_rate > 0.01 && o.cap_rate < 0.25).map(o => parseFloat(o.cap_rate)).sort((a,b) => a - b);
  const avgOwnershipCap = ownershipCaps.length > 0 ? (ownershipCaps.reduce((s,v) => s+v, 0) / ownershipCaps.length * 100).toFixed(2) + '%' : '—';

  html += govSectionHeader('Ownership Intelligence', '🔍', 'ownership');
  html += '<div class="gov-grid gov-grid-5">';
  html += govCard({ title: 'Ownership Changes', value: fmtN(totalOwnershipChanges), sub: 'transfers tracked', color: 'blue', tab: 'ownership' });
  html += govCard({ title: 'Confirmed Sales', value: fmtN(withSalePrice.length), sub: '$' + fmtN(Math.round(confirmedValue / 1e6)) + 'M total value', color: 'green', tab: 'ownership' });
  html += govCard({ title: 'Avg Sale Cap Rate', value: avgOwnershipCap, sub: fmtN(ownershipCaps.length) + ' with cap data', color: 'cyan', tab: 'ownership' });
  html += govCard({ title: 'Needs Research', value: fmtN(needsResearch), sub: 'pending investigation', color: 'yellow', tab: 'research' });
  html += govCard({ title: 'Research Coverage', value: totalOwnershipChanges > 0 ? ((totalOwnershipChanges - needsResearch) / totalOwnershipChanges * 100).toFixed(1) + '%' : '—', sub: 'changes researched', color: 'purple', tab: 'research' });
  html += '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 6: PROSPECT PIPELINE
  // ═══════════════════════════════════════════════
  const hotLeads = leads.filter(l => l.lead_temperature === 'hot').length;
  const warmLeads = leads.filter(l => l.lead_temperature === 'warm').length;
  const pipelineValue = leads.reduce((s, l) => s + (l.estimated_value || 0), 0);

  html += govSectionHeader('Prospect Pipeline', '🎯', 'pipeline');
  html += '<div class="gov-grid gov-grid-5">';
  const leadsAtCap = leads.length >= 1000;
  const capSuffix = leadsAtCap ? '+' : '';
  html += govCard({ title: 'Total Leads', value: fmtN(leads.length) + capSuffix, sub: 'in pipeline', color: 'blue', tab: 'pipeline' });
  html += govCard({ title: 'Hot Leads', value: fmtN(hotLeads) + capSuffix, sub: 'high priority', color: 'red', tab: 'pipeline' });
  html += govCard({ title: 'Warm Leads', value: fmtN(warmLeads) + capSuffix, sub: 'active prospects', color: 'orange', tab: 'pipeline' });
  html += govCard({ title: 'Pipeline Value', value: '$' + fmtN(Math.round(pipelineValue / 1e6)) + 'M' + capSuffix, sub: 'estimated total', color: 'green', tab: 'pipeline' });
  const avgLeadValue = leads.length > 0 ? pipelineValue / leads.length : 0;
  html += govCard({ title: 'Avg Lead Value', value: avgLeadValue > 0 ? '$' + fmtN(Math.round(avgLeadValue / 1000)) + 'K' : '—', sub: 'per prospect', color: 'purple', tab: 'pipeline' });
  html += '</div>';

  // Pipeline by agency
  const leadsByAgency = {};
  leads.forEach(l => { const a = l.tenant_agency || l.agency_full_name || 'Unknown'; leadsByAgency[a] = (leadsByAgency[a] || 0) + 1; });
  const topLeadAgencies = Object.entries(leadsByAgency).sort((a,b) => b[1] - a[1]).slice(0, 8);
  if (topLeadAgencies.length > 1) {
    html += '<div class="gov-info-card" onclick="goToGovTab(\'pipeline\')" style="cursor:pointer;padding:14px 16px;margin-top:10px">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">Leads by Tenant Agency</div>';
    const maxLead = topLeadAgencies[0][1];
    html += inlineBar(topLeadAgencies.map(([name, cnt]) => ({
      label: name.length > 20 ? name.substring(0,18) + '…' : name,
      value: cnt, display: fmtN(cnt), barColor: '#fb923c', labelWidth: 130, valueWidth: 35
    })), maxLead);
    html += '</div>';
  }

  // Deal grade breakdown
  const gradeMap = {};
  leads.forEach(l => { if (l.deal_grade) gradeMap[l.deal_grade] = (gradeMap[l.deal_grade] || 0) + 1; });
  if (Object.keys(gradeMap).length > 0) {
    const gradeColors = { A: '#34d399', B: '#60a5fa', C: '#fbbf24', D: '#fb923c', F: '#f87171' };
    html += '<div class="gov-grid gov-grid-' + Math.min(Object.keys(gradeMap).length, 5) + '" style="margin-top:10px">';
    Object.entries(gradeMap).sort((a,b) => a[0].localeCompare(b[0])).forEach(([grade, cnt]) => {
      html += govCard({ title: 'Grade ' + grade, value: fmtN(cnt), sub: 'leads', color: grade === 'A' ? 'green' : grade === 'B' ? 'blue' : grade === 'C' ? 'yellow' : 'orange', tab: 'pipeline' });
    });
    html += '</div>';
  }

  // ═══════════════════════════════════════════════
  // SECTION 7: OUTREACH & TOUCHPOINTS
  // ═══════════════════════════════════════════════
  const allActivities = (typeof activities !== 'undefined' ? activities : []);
  const govCategories = ['government', 'gsa', 'va', 'ssa', 'usps', 'federal', 'state/local'];
  const govActivities = allActivities.filter(a => {
    const cat = (a.computed_category || '').toLowerCase();
    return govCategories.some(c => cat.includes(c));
  });
  const touchpointsYTD = govActivities.filter(a => a.activity_date && new Date(a.activity_date) >= yearStart).length;
  const sixMonthsAgo = new Date(now); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const touchpoints6mo = govActivities.filter(a => a.activity_date && new Date(a.activity_date) >= sixMonthsAgo).length;
  const oneMonthAgo = new Date(now); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const touchpoints1mo = govActivities.filter(a => a.activity_date && new Date(a.activity_date) >= oneMonthAgo).length;
  const uniqueGovAccounts = new Set(govActivities.map(a => a.company_name).filter(Boolean)).size;

  html += govSectionHeader('Government Outreach', '📞', 'search');
  html += '<div class="gov-grid gov-grid-4">';
  html += govCard({ title: 'Touchpoints YTD', value: fmtN(touchpointsYTD), sub: now.getFullYear() + ' year to date', color: 'blue' });
  html += govCard({ title: 'Last 6 Months', value: fmtN(touchpoints6mo), sub: 'gov contacts', color: 'green' });
  html += govCard({ title: 'Last 30 Days', value: fmtN(touchpoints1mo), sub: 'recent contacts', color: 'cyan' });
  html += govCard({ title: 'Unique Accounts', value: fmtN(uniqueGovAccounts), sub: 'gov entities touched', color: 'purple' });
  html += '</div>';

  // Per-category breakdown
  const catCounts = {};
  govActivities.forEach(a => { const c = a.computed_category || 'Uncategorized'; catCounts[c] = (catCounts[c] || 0) + 1; });
  if (Object.keys(catCounts).length > 1) {
    html += '<div class="gov-info-card" style="padding:14px 16px;margin-top:10px">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">Touchpoints by Category</div>';
    const maxCat = Math.max(...Object.values(catCounts));
    html += inlineBar(Object.entries(catCounts).sort((a,b) => b[1] - a[1]).map(([cat, count]) => ({
      label: cat, value: count, display: fmtN(count), barColor: '#60a5fa', labelWidth: 120, valueWidth: 35
    })), maxCat);
    html += '</div>';
  }

  // ═══════════════════════════════════════════════
  // SECTION 8: TTM SALES
  // ═══════════════════════════════════════════════
  html += govSectionHeader('TTM Sales Activity', '💰', 'sales');
  html += '<div id="govOverviewSales">' + renderGovSalesMetrics() + '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 9: NORTHMARQ PERFORMANCE
  // ═══════════════════════════════════════════════
  html += govSectionHeader('Northmarq Performance', '🏆', 'sales');
  html += '<div id="govOverviewNM">' + renderGovNorthmarqMetrics() + '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 10: ON MARKET
  // ═══════════════════════════════════════════════
  const activeListings = listings.filter(l => l.listing_status === 'active');
  const underContract = listings.filter(l => l.listing_status === 'under_contract');
  const totalAsking = activeListings.reduce((s, l) => s + (l.asking_price || 0), 0);
  const listingCaps = activeListings.filter(l => l.asking_cap_rate > 0.01 && l.asking_cap_rate < 0.25).map(l => parseFloat(l.asking_cap_rate)).sort((a,b) => a-b);
  const avgAskingCap = listingCaps.length > 0 ? (listingCaps.reduce((s,v)=>s+v,0)/listingCaps.length*100).toFixed(2)+'%' : '—';
  const avgDom = activeListings.filter(l => l.days_on_market > 0);
  const avgDomVal = avgDom.length > 0 ? Math.round(avgDom.reduce((s,l) => s + l.days_on_market, 0) / avgDom.length) : '—';

  html += govSectionHeader('On Market', '🏢', 'listings');
  html += '<div class="gov-grid gov-grid-5">';
  html += govCard({ title: 'Active Listings', value: fmtN(activeListings.length), sub: 'currently on market', color: 'blue', tab: 'listings' });
  html += govCard({ title: 'Under Contract', value: fmtN(underContract.length), sub: 'pending close', color: 'green', tab: 'listings' });
  html += govCard({ title: 'Total Asking', value: totalAsking > 0 ? '$' + fmtN(Math.round(totalAsking / 1e6)) + 'M' : '—', sub: 'active asking value', color: 'cyan', tab: 'listings' });
  html += govCard({ title: 'Avg Ask Cap', value: avgAskingCap, sub: fmtN(listingCaps.length) + ' with cap data', color: 'purple', tab: 'listings' });
  html += govCard({ title: 'Avg DOM', value: avgDomVal, sub: 'days on market', color: 'yellow', tab: 'listings' });
  html += '</div>';

  // ═══════════════════════════════════════════════
  // SECTION 11: GSA LEASE INTEL
  // ═══════════════════════════════════════════════
  const gsaEventsYTD = gsaEvents.filter(e => e.event_date && new Date(e.event_date) >= yearStart).length;
  const gsaEventTypes = {};
  gsaEvents.forEach(e => { gsaEventTypes[e.event_type] = (gsaEventTypes[e.event_type] || 0) + 1; });
  const totalGsaRent = gsaSnapshots.reduce((s, s2) => s + (s2.annual_rent || 0), 0);
  const frppTotalSF = frpp.reduce((s, r) => s + (r.square_feet || 0), 0);
  const frppTotalRent = frpp.reduce((s, r) => s + (r.annual_rent_to_lessor || 0), 0);
  const frppAgencies = new Set(frpp.map(r => r.using_agency).filter(Boolean)).size;

  html += govSectionHeader('GSA Lease Intelligence', '📋', 'search');
  html += '<div class="gov-grid gov-grid-4">';
  html += govCard({ title: 'GSA Events YTD', value: fmtN(gsaEventsYTD), sub: now.getFullYear() + ' lease events', color: 'blue' });
  html += govCard({ title: 'GSA Total Rent', value: '$' + fmtN(Math.round(totalGsaRent / 1e6)) + 'M', sub: fmtN(gsaSnapshots.length) + ' leases tracked', color: 'green' });
  html += govCard({ title: 'FRPP Square Feet', value: fmtN(Math.round(frppTotalSF / 1e6)) + 'M', sub: fmtN(govData.frppCount || frpp.length) + ' federal properties', color: 'cyan' });
  html += govCard({ title: 'FRPP Agencies', value: fmtN(frppAgencies), sub: '$' + fmtN(Math.round(frppTotalRent / 1e6)) + 'M annual rent', color: 'purple' });
  html += '</div>';

  // GSA event type breakdown
  if (Object.keys(gsaEventTypes).length > 0) {
    html += '<div class="gov-info-card" style="padding:14px 16px;margin-top:10px">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:10px">GSA Event Types</div>';
    const maxEvt = Math.max(...Object.values(gsaEventTypes));
    html += inlineBar(Object.entries(gsaEventTypes).sort((a,b) => b[1] - a[1]).map(([type, count]) => ({
      label: type, value: count, display: fmtN(count), barColor: '#22d3ee', labelWidth: 120, valueWidth: 35
    })), maxEvt);
    html += '</div>';
  }

  html += '</div>'; // end wrapper
  return html;
}

// ── Gov Overview inner renderers (lazy-loaded sections) ──

function renderGovSalesMetrics() {
  const sales = govSalesComps || govData.salesComps || [];
  if (!govSalesComps && govSalesLoading) {
    return '<div class="gov-grid gov-grid-5"><div class="gov-info-card" style="grid-column:span 5;text-align:center;padding:24px"><span class="spinner"></span><div style="margin-top:8px;font-size:12px;color:var(--text2)">Loading sales data...</div></div></div>';
  }
  const _c = { blue: '#60a5fa', green: '#34d399', cyan: '#22d3ee', purple: '#a78bfa', yellow: '#fbbf24' };
  function card(opts) {
    const c = _c[opts.color] || _c.blue;
    const clickAttr = opts.tab ? ` onclick="goToGovTab('${opts.tab}')"` : '';
    return `<div class="gov-info-card"${clickAttr}><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:6px">${opts.title}</div><div style="font-size:24px;font-weight:800;color:${c};margin-bottom:4px">${opts.value}</div>${opts.sub ? `<div style="font-size:11px;color:var(--text2)">${opts.sub}</div>` : ''}</div>`;
  }

  const now = new Date();
  const ttmStart = new Date(now); ttmStart.setFullYear(ttmStart.getFullYear() - 1);
  const ttmSales = sales.filter(r => r.sale_date && new Date(r.sale_date) >= ttmStart);
  const ttmWithPrice = ttmSales.filter(r => (r.sold_price || r.sale_price) > 0);
  const ttmVolume = ttmWithPrice.reduce((s, r) => s + parseFloat(r.sold_price || r.sale_price || 0), 0);
  const validCaps = ttmSales.filter(r => { const v = parseFloat(r.sold_cap_rate || r.cap_rate); return v > 0.01 && v < 0.25; }).map(r => parseFloat(r.sold_cap_rate || r.cap_rate)).sort((a,b) => a - b);
  const avgCap = validCaps.length > 0 ? (validCaps.reduce((s,v) => s+v, 0) / validCaps.length * 100).toFixed(2) + '%' : '—';
  const q1 = validCaps.length > 4 ? (validCaps[Math.floor(validCaps.length * 0.25)] * 100).toFixed(2) + '%' : '—';
  const q3 = validCaps.length > 4 ? (validCaps[Math.floor(validCaps.length * 0.75)] * 100).toFixed(2) + '%' : '—';

  let h = '<div class="gov-grid gov-grid-5">';
  h += card({ title: 'TTM Volume', value: '$' + fmtN(Math.round(ttmVolume / 1e6)) + 'M', sub: fmtN(ttmWithPrice.length) + ' priced transactions', color: 'green', tab: 'sales' });
  h += card({ title: 'TTM Transactions', value: fmtN(ttmSales.length), sub: 'trailing 12 months', color: 'blue', tab: 'sales' });
  h += card({ title: 'Avg Cap Rate', value: avgCap, sub: fmtN(validCaps.length) + ' with cap data', color: 'cyan', tab: 'sales' });
  h += card({ title: 'Lower Quartile', value: q1, sub: '25th percentile', color: 'purple', tab: 'sales' });
  h += card({ title: 'Upper Quartile', value: q3, sub: '75th percentile', color: 'yellow', tab: 'sales' });
  h += '</div>';

  // All-time
  const allWithPrice = sales.filter(r => (r.sold_price || r.sale_price) > 0);
  const totalVolume = allWithPrice.reduce((s,r) => s + parseFloat(r.sold_price || r.sale_price || 0), 0);
  h += '<div class="gov-grid gov-grid-3" style="margin-top:10px">';
  h += card({ title: 'All-Time Comps', value: fmtN(sales.length), sub: 'total in database', color: 'blue', tab: 'sales' });
  h += card({ title: 'All-Time Volume', value: '$' + fmtN(Math.round(totalVolume / 1e6)) + 'M', sub: fmtN(allWithPrice.length) + ' priced sales', color: 'green', tab: 'sales' });
  h += card({ title: 'Avg Sale Price', value: allWithPrice.length > 0 ? '$' + fmtN(Math.round(totalVolume / allWithPrice.length)) : '—', sub: 'across all comps', color: 'purple', tab: 'sales' });
  h += '</div>';
  return h;
}

function renderGovNorthmarqMetrics() {
  const sales = govSalesComps || govData.salesComps || [];
  if (!govSalesComps && govSalesLoading) {
    return '<div class="gov-grid gov-grid-4"><div class="gov-info-card" style="grid-column:span 4;text-align:center;padding:24px"><span class="spinner"></span><div style="margin-top:8px;font-size:12px;color:var(--text2)">Loading...</div></div></div>';
  }
  const _c = { blue: '#60a5fa', green: '#34d399', cyan: '#22d3ee', yellow: '#fbbf24' };
  function card(opts) {
    const c = _c[opts.color] || _c.blue;
    const clickAttr = opts.tab ? ` onclick="goToGovTab('${opts.tab}')"` : '';
    return `<div class="gov-info-card"${clickAttr}><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:6px">${opts.title}</div><div style="font-size:24px;font-weight:800;color:${c};margin-bottom:4px">${opts.value}</div>${opts.sub ? `<div style="font-size:11px;color:var(--text2)">${opts.sub}</div>` : ''}</div>`;
  }

  const now = new Date();
  const ttmStart = new Date(now); ttmStart.setFullYear(ttmStart.getFullYear() - 1);
  const ttmSales = sales.filter(r => r.sale_date && new Date(r.sale_date) >= ttmStart);
  const isNM = r => r.is_northmarq || ((r.listing_broker||'')+(r.purchasing_broker||'')).toLowerCase().match(/northmarq|sjc[;:]|briggs|hellwig|corriston/);
  const nmSales = ttmSales.filter(isNM);
  const nmWithPrice = nmSales.filter(r => (r.sold_price || r.sale_price) > 0);
  const nmVolume = nmWithPrice.reduce((s,r) => s + parseFloat(r.sold_price || r.sale_price || 0), 0);
  const marketShareTxn = ttmSales.length > 0 ? (nmSales.length / ttmSales.length * 100).toFixed(1) + '%' : '—';
  const nmCaps = nmSales.filter(r => { const v = parseFloat(r.sold_cap_rate || r.cap_rate); return v > 0.01 && v < 0.25; }).map(r => parseFloat(r.sold_cap_rate || r.cap_rate));
  const mktCaps = ttmSales.filter(r => { const v = parseFloat(r.sold_cap_rate || r.cap_rate); return v > 0.01 && v < 0.25; }).map(r => parseFloat(r.sold_cap_rate || r.cap_rate));
  const nmAvgCap = nmCaps.length > 0 ? (nmCaps.reduce((s,v)=>s+v,0)/nmCaps.length*100).toFixed(2) + '%' : '—';
  const mktAvgCap = mktCaps.length > 0 ? (mktCaps.reduce((s,v)=>s+v,0)/mktCaps.length*100).toFixed(2) + '%' : '—';
  const capAdv = (nmCaps.length > 0 && mktCaps.length > 0) ?
    ((mktCaps.reduce((s,v)=>s+v,0)/mktCaps.length - nmCaps.reduce((s,v)=>s+v,0)/nmCaps.length) * 10000).toFixed(0) : null;

  let h = '<div class="gov-grid gov-grid-4">';
  h += card({ title: 'NM TTM Sales', value: fmtN(nmSales.length), sub: '$' + fmtN(Math.round(nmVolume / 1e6)) + 'M volume', color: 'green', tab: 'sales' });
  h += card({ title: 'Market Share', value: marketShareTxn, sub: fmtN(nmSales.length) + ' of ' + fmtN(ttmSales.length) + ' TTM deals', color: 'blue', tab: 'sales' });
  h += card({ title: 'NM Avg Cap Rate', value: nmAvgCap, sub: 'vs ' + mktAvgCap + ' market avg', color: 'cyan', tab: 'sales' });
  h += card({ title: 'Seller Value Add', value: capAdv ? capAdv + ' bps tighter' : '—', sub: capAdv && parseInt(capAdv) > 0 ? 'tighter caps = higher proceeds' : 'vs market average', color: parseInt(capAdv) > 0 ? 'green' : 'yellow', tab: 'sales' });
  h += '</div>';
  return h;
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
  // Deduplicate leads by lead_id (data may contain duplicate rows from JOINs)
  const seenIds = new Set();
  const dedupedLeads = govData.leads.filter(l => {
    const key = l.lead_id || (l.address + '|' + l.city + '|' + l.tenant_agency);
    if (seenIds.has(key)) return false;
    seenIds.add(key);
    return true;
  });
  const totalLeads = dedupedLeads.length;
  const atCap = govData.leads.length >= 1000;
  const hotCount = dedupedLeads.filter(l => l.lead_temperature === 'hot').length;
  const warmCount = dedupedLeads.filter(l => l.lead_temperature === 'warm').length;

  const pipelineValue = dedupedLeads.reduce((sum, l) => sum + (l.estimated_value || 0), 0);
  
  // Leads by source
  const bySource = {};
  dedupedLeads.forEach(l => {
    const source = cleanLabel(l.lead_source || 'Unknown');
    bySource[source] = (bySource[source] || 0) + 1;
  });

  const sourceLabels = Object.keys(bySource).sort((a, b) => bySource[b] - bySource[a]).slice(0, 8);
  const sourceData = sourceLabels.map(s => bySource[s]);
  
  // Temperature breakdown
  const tempLabels = ['Hot', 'Warm', 'Cool'];
  const tempData = [hotCount, warmCount, totalLeads - hotCount - warmCount];
  const tempColors = ['#f87171', '#fbbf24', '#6c8cff'];
  
  let html = '<div class="gov-metrics">';
  html += metricHTML('Total Leads', fmtN(totalLeads) + (atCap ? '+' : ''), 'in pipeline' + (atCap ? ' (showing first 1,000)' : ''), 'blue');
  html += metricHTML('Hot', fmtN(hotCount) + (atCap ? '+' : ''), 'high priority', 'red');
  html += metricHTML('Warm', fmtN(warmCount) + (atCap ? '+' : ''), 'active prospects', 'yellow');
  html += metricHTML('Pipeline Value', fmt(pipelineValue) + (atCap ? '+' : ''), 'estimated total', 'purple');
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
  html += leadsTable(dedupedLeads.slice(0, 100));
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
  html += metricHTML('All Listings', fmtN(govData.listings.length), 'All statuses', 'yellow');
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

  let html = '<div class="research-workbench">';
  html += renderLiveIngestWorkbench('government');
  html += renderGovEvidenceWorkbench();

  // Mode toggle — always visible so user can switch modes
  html += `<div class="research-mode-toggle">
    <button class="mode-btn ${researchMode === 'ownership' ? 'active' : ''}" onclick="setResearchMode('ownership')">Ownership Changes</button>
    <button class="mode-btn ${researchMode === 'leads' ? 'active' : ''}" onclick="setResearchMode('leads')">Leads</button>
    <button class="mode-btn ${researchMode === 'intel' ? 'active' : ''}" onclick="setResearchMode('intel')">Intel</button>
  </div>`;

  // Filter toggle — pending vs all
  const portfolio = govData.portfolioProperties || [];
  let totalRecords, pendingCount;
  if (researchMode === 'ownership') {
    totalRecords = govData.ownership.length;
    pendingCount = govData.ownership.filter(o => !o.sale_price && (!o.research_status || o.research_status === 'pending')).length;
  } else if (researchMode === 'intel') {
    totalRecords = portfolio.length;
    pendingCount = portfolio.filter(p =>
      !p.intel_status || p.intel_status === 'pending' ||
      (!p.sale_price && !p.last_known_rent && !p.current_value_estimate)
    ).length;
  } else {
    totalRecords = govData.leads.length;
    pendingCount = govData.leads.filter(l => !l.research_status || l.research_status === 'pending').length;
  }

  html += `<div class="research-mode-toggle" style="margin-top:4px">
    <button class="mode-btn ${researchFilter === 'pending' ? 'active' : ''}" onclick="setResearchFilter('pending')">Pending (${pendingCount})</button>
    <button class="mode-btn ${researchFilter === 'all' ? 'active' : ''}" onclick="setResearchFilter('all')">All (${totalRecords})</button>
  </div>`;

  if (researchQueue.length === 0) {
    html += `<div class="research-empty">
      <div class="empty-icon">${researchFilter === 'pending' ? '✓' : '∅'}</div>
      <div class="empty-title">${researchFilter === 'pending' ? 'No pending ' + researchMode + ' items' : 'No ' + researchMode + ' records loaded'}</div>
      <div class="empty-desc">${totalRecords} total records · ${pendingCount} pending</div>
      ${researchFilter === 'pending' && totalRecords > 0 ? `<button class="btn-primary" onclick="setResearchFilter('all')">Show All ${totalRecords} Records</button>` : ''}
      <button class="btn-secondary" style="margin-top:8px" onclick="researchQueue=[];loadResearchQueue();renderGovTab()">Refresh Queue</button>
    </div>`;
    html += '</div>';
    setTimeout(() => bindLiveIngestWorkbench('government'), 0);
    setTimeout(() => bindGovEvidenceWorkbench(), 0);
    return html;
  }

  // Render the research card (progress + card)
  html += renderResearchInner();
  html += '</div>';
  setTimeout(() => bindLiveIngestWorkbench('government'), 0);
  setTimeout(() => bindGovEvidenceWorkbench(), 0);
  return html;
}

function renderGovTab() {
  const el = document.getElementById('bizPageInner');
  if (!el) return;
  
  let html = '';
  switch (currentGovTab) {
    case 'overview':
      html = renderGovOverview();
      break;
    case 'search':
      html = renderGovSearch();
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
    case 'sales':
      renderGovSales(); // async — renders directly to DOM
      return;
    case 'leases':
      renderGovLeases(); // async — renders directly to DOM
      return;
    case 'loans':
      renderGovLoans(); // async — renders directly to DOM
      return;
    case 'players':
      html = renderGovPlayers();
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
  if (record.location_code) html += createDetailRow('Location Code', esc(record.location_code));
  html += createDetailRow('Address', esc(norm(record.address) || '—'));
  html += createDetailRow('City / State',
    esc((norm(record.city) || '') + (record.state ? ', ' + record.state : '') || '—'));
  html += createDetailRow('Estimated Value', `<span class="detail-val money">${value}</span>`);
  html += createDetailRow('Sale Price', `<span class="detail-val money">${salePrice}</span>`);
  html += createDetailRow('Cap Rate', capRate);
  html += createDetailRow('Square Feet', sqft);
  html += createDetailRow('Annual Rent', `<span class="detail-val money">${rent}</span>`);
  html += createDetailRow('Transfer Date', esc(record.transfer_date || '—'));
  html += createDetailRow('Research Status',
    `<span class="detail-badge">${esc(cleanLabel(record.research_status || 'pending'))}</span>`);
  
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
  html += createDetailRow('Lessor Name', esc(norm(snapshot.lessor_name) || '—'));
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
  html += createDetailRow('Lead Source', esc(cleanLabel(record.lead_source || '—')));
  
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
  
  html += createDetailRow('Address', esc(norm(record.address) || '—'));
  html += createDetailRow('City / State',
    esc((norm(record.city) || '') + (record.state ? ', ' + record.state : '') || '—'));
  if (record.location_code) html += createDetailRow('Location Code', esc(record.location_code));
  html += createDetailRow('Agency', esc(norm(record.agency_full_name) || '—'));
  html += createDetailRow('Tenant', esc(norm(record.tenant_agency) || '—'));
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
  html += createDetailRow('Listing Source', esc(cleanLabel(record.listing_source || '—')));
  html += createDetailRow('Listing Status',
    `<span class="detail-badge">${esc(cleanLabel(record.listing_status || 'active'))}</span>`);
  html += createDetailRow('Days on Market', record.days_on_market || '—');
  html += createDetailRow('URL Status', esc(cleanLabel(record.url_status || '—')));
  html += createDetailRow('Tenant Agency', esc(norm(record.tenant_agency) || '—'));
  
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
    
    html += `<tr class="clickable-row" style="border-bottom: 1px solid #eee;cursor:pointer" onclick='showDetail(${safeJSON(comp)}, "gov-ownership")'>`;
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
 * Updates pipeline_status, research_status, and research_notes via Gov write service
 */
function saveGovDetailLead(leadId) {
  const pipelineStatus = document.getElementById('govDetailPipeline')?.value;
  const researchStatus = document.getElementById('govDetailResearch')?.value;
  const researchNotes = document.getElementById('govDetailNotes')?.value;

  if (!pipelineStatus || !researchStatus) {
    showToast('Please select pipeline and research status');
    return;
  }

  // Use Gov write service instead of direct prospect_leads PATCH
  govWriteService('lead-research', {
    lead_id: leadId,
    pipeline_status: pipelineStatus,
    research_status: researchStatus,
    research_notes: researchNotes || null
  })
    .then((writeResult) => {
      showToast('Lead updated successfully', 'success');
      // Bridge with gov change metadata
      canonicalBridge('complete_research', {
        domain: 'government',
        research_type: 'ownership',
        external_id: String(leadId),
        source_system: 'gov_supabase',
        outcome: researchStatus === 'complete' ? 'completed' : researchStatus,
        notes: researchNotes,
        gov_change_event_id: writeResult?.change_event_id || null,
        gov_correlation_id: writeResult?.correlation_id || null,
        source_record_id: leadId,
        source_table: 'prospect_leads'
      });
    })
    .catch(err => {
      console.error('Error saving lead:', err);
      showToast('Error updating lead: ' + err.message, 'error');
    });
}

// ============================================================================
// GOVERNMENT SALES (Comps + Available)
// ============================================================================

let govSalesView = 'comps'; // 'comps' | 'available'
let govSalesComps = null;   // lazy-loaded from v_sales_comps
let govAvailListings = null; // lazy-loaded from v_available_listings
let govSalesLoading = false;
let govSalesSearch = '';
let govSalesPage = 0;
const GOV_SALES_PAGE_SIZE = 50;

async function renderGovSales() {
  const inner = document.getElementById('bizPageInner');
  if (!inner) return;

  const isComps = govSalesView === 'comps';

  // Lazy-load data on first render
  if (isComps && govSalesComps === null && !govSalesLoading) {
    govSalesLoading = true;
    inner.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading sales comps...</p></div>';
    try {
      let all = [], offset = 0;
      while (true) {
        const res = await govQuery('v_sales_comps', '*', { order: 'sale_date.desc.nullslast', limit: 1000, offset });
        const rows = res.data || [];
        all = all.concat(rows);
        if (rows.length < 1000) break;
        offset += 1000;
      }
      govSalesComps = all;
    } catch (e) { console.error('Gov sales comps load error:', e); govSalesComps = []; }
    govSalesLoading = false;
  }
  if (!isComps && govAvailListings === null && !govSalesLoading) {
    govSalesLoading = true;
    inner.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading available listings...</p></div>';
    try {
      const res = await govQuery('v_available_listings', '*', { order: 'listing_date.desc.nullslast', limit: 1000 });
      govAvailListings = res.data || [];
    } catch (e) { console.error('Gov available load error:', e); govAvailListings = []; }
    govSalesLoading = false;
  }

  const data = isComps ? (govSalesComps || []) : (govAvailListings || []);

  // Normalize for unified rendering
  const normalized = data.map(r => {
    if (isComps) {
      return {
        property_id: r.property_id,
        lease_number: r.lease_number,
        agency: r.agency || r.agency_full || '',
        address: r.address,
        city: r.city,
        state: r.state,
        land_acres: r.land_acres,
        year_built: r.year_built,
        rba: r.rba,
        noi: r.noi ? parseFloat(r.noi) : null,
        noi_psf: r.noi_psf ? parseFloat(r.noi_psf) : null,
        lease_expiration: r.lease_expiration,
        firm_term_remaining: r.firm_term_remaining != null ? parseFloat(r.firm_term_remaining) : null,
        term_remaining: r.term_remaining != null ? parseFloat(r.term_remaining) : null,
        expenses: r.expenses,
        bumps: r.bumps,
        price: r.sold_price ? parseFloat(r.sold_price) : null,
        price_psf: r.sold_price_psf ? parseFloat(r.sold_price_psf) : null,
        cap_rate: r.sold_cap_rate ? parseFloat(r.sold_cap_rate) : null,
        sold_date: r.sale_date,
        seller: r.seller,
        listing_broker: r.listing_broker,
        buyer: r.buyer,
        procuring_broker: r.purchasing_broker,
        bid_ask_spread: r.bid_ask_spread != null ? parseFloat(r.bid_ask_spread) : null,
        dom: r.days_on_market != null ? parseInt(r.days_on_market) : null
      };
    } else {
      return {
        property_id: r.property_id,
        lease_number: r.lease_number,
        agency: r.agency || r.agency_full || '',
        address: r.address,
        city: r.city,
        state: r.state,
        land_acres: r.land_acres,
        year_built: r.year_built,
        rba: r.rba,
        noi: r.noi ? parseFloat(r.noi) : null,
        noi_psf: r.noi_psf ? parseFloat(r.noi_psf) : null,
        lease_expiration: r.lease_expiration,
        firm_term_remaining: r.firm_term_remaining != null ? parseFloat(r.firm_term_remaining) : null,
        term_remaining: r.term_remaining != null ? parseFloat(r.term_remaining) : null,
        expenses: r.expenses,
        bumps: r.bumps,
        ask_price: r.asking_price ? parseFloat(r.asking_price) : null,
        price_psf: r.asking_price_psf ? parseFloat(r.asking_price_psf) : null,
        ask_cap: r.asking_cap_rate ? parseFloat(r.asking_cap_rate) : null,
        seller: r.seller,
        listing_broker: r.listing_broker,
        dom: r.days_on_market != null ? parseInt(r.days_on_market) : null
      };
    }
  });

  // Filter by search
  const q = govSalesSearch.toLowerCase();
  const filtered = q ? normalized.filter(r =>
    (r.agency || '').toLowerCase().includes(q) ||
    (r.address || '').toLowerCase().includes(q) ||
    (r.city || '').toLowerCase().includes(q) ||
    (r.state || '').toLowerCase().includes(q) ||
    (r.seller || '').toLowerCase().includes(q) ||
    (r.buyer || '').toLowerCase().includes(q) ||
    (r.listing_broker || '').toLowerCase().includes(q)
  ) : normalized;

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / GOV_SALES_PAGE_SIZE));
  if (govSalesPage >= totalPages) govSalesPage = totalPages - 1;
  const pageRows = filtered.slice(govSalesPage * GOV_SALES_PAGE_SIZE, (govSalesPage + 1) * GOV_SALES_PAGE_SIZE);

  // Cap rate helper (filter outliers 1-25%)
  const avgCapRate = (arr, field) => {
    const valid = arr.filter(r => { const v = r[field]; return v != null && v > 0.01 && v < 0.25; });
    if (valid.length === 0) return { val: '—', n: 0 };
    return { val: (valid.reduce((s, r) => s + r[field], 0) / valid.length * 100).toFixed(2) + '%', n: valid.length };
  };

  let html = '<div class="biz-section">';

  // Sub-tab toggle
  html += '<div class="pills" style="margin-bottom: 16px;">';
  html += '<button class="pill' + (isComps ? ' active' : '') + '" data-gov-sales-view="comps">Sales Comps (' + (govSalesComps ? fmtN(govSalesComps.length) : '…') + ')</button>';
  html += '<button class="pill' + (!isComps ? ' active' : '') + '" data-gov-sales-view="available">Available (' + (govAvailListings ? fmtN(govAvailListings.length) : '…') + ')</button>';
  html += '</div>';

  // Metrics
  html += '<div class="gov-metrics">';
  if (isComps) {
    const withPrice = filtered.filter(r => r.price > 0);
    const cap = avgCapRate(filtered, 'cap_rate');
    const avgPrice = withPrice.length > 0 ? '$' + fmtN(Math.round(withPrice.reduce((s, r) => s + r.price, 0) / withPrice.length)) : '—';
    html += metricHTML('Total Sales', fmtN(filtered.length), 'gov comps', 'blue');
    html += metricHTML('Avg Cap Rate', cap.val, cap.n + ' with cap data', 'green');
    html += metricHTML('Avg Sale Price', avgPrice, withPrice.length + ' with price data', 'purple');
    const curYear = new Date().getFullYear();
    let thisYear = filtered.filter(r => r.sold_date && r.sold_date >= curYear + '-01-01').length;
    let ytdLabel = 'sales YTD';
    if (thisYear === 0 && filtered.length > 0) {
      // Fallback to most recent year with data
      const prevYear = curYear - 1;
      thisYear = filtered.filter(r => r.sold_date && r.sold_date >= prevYear + '-01-01' && r.sold_date < curYear + '-01-01').length;
      ytdLabel = prevYear + ' sales';
    }
    html += metricHTML('This Year', fmtN(thisYear), ytdLabel, 'yellow');
  } else {
    const withPrice = filtered.filter(r => r.ask_price > 0);
    const cap = avgCapRate(filtered, 'ask_cap');
    const avgAsk = withPrice.length > 0 ? '$' + fmtN(Math.round(withPrice.reduce((s, r) => s + r.ask_price, 0) / withPrice.length)) : '—';
    html += metricHTML('Active Listings', fmtN(filtered.length), 'on market', 'blue');
    html += metricHTML('Avg Ask Cap', cap.val, cap.n + ' with cap data', 'green');
    html += metricHTML('Avg Ask Price', avgAsk, withPrice.length + ' priced', 'purple');
    const avgDom = filtered.filter(r => r.dom > 0);
    const avgDomVal = avgDom.length > 0 ? Math.round(avgDom.reduce((s, r) => s + r.dom, 0) / avgDom.length) : '—';
    html += metricHTML('Avg DOM', avgDomVal, avgDom.length + ' with dates', 'yellow');
  }
  html += '</div>';

  // Search bar
  html += '<div style="margin: 16px 0; display: flex; gap: 8px; align-items: center;">';
  html += '<input type="text" id="govSalesSearchInput" placeholder="Search agency, address, city, broker..." value="' + esc(govSalesSearch) + '" style="flex:1; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--s2); color: var(--text); font-size: 13px;" />';
  html += '<span style="font-size: 12px; color: var(--text3);">' + fmtN(filtered.length) + ' results</span>';
  html += '</div>';

  // Scrollable table
  html += '<div style="overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--border); border-radius: 10px; max-height: 70vh;">';
  html += '<table style="width: max-content; min-width: 2200px; border-collapse: collapse; font-size: 12px;">';

  // Header
  html += '<thead><tr style="background: var(--s2); position: sticky; top: 0; z-index: 1;">';
  const th = (label, w) => '<th style="padding: 10px 8px; text-align: left; font-weight: 600; font-size: 11px; letter-spacing: 0.3px; text-transform: uppercase; color: var(--text2); border-bottom: 2px solid var(--border); white-space: nowrap; min-width: ' + w + 'px;">' + label + '</th>';
  const thr = (label, w) => '<th style="padding: 10px 8px; text-align: right; font-weight: 600; font-size: 11px; letter-spacing: 0.3px; text-transform: uppercase; color: var(--text2); border-bottom: 2px solid var(--border); white-space: nowrap; min-width: ' + w + 'px;">' + label + '</th>';

  if (isComps) {
    html += th('Agency', 160);
    html += th('Address', 140);
    html += th('City', 90);
    html += th('State', 40);
    html += thr('Land', 55);
    html += thr('Built', 45);
    html += thr('RBA', 60);
    html += thr('NOI', 75);
    html += thr('NOI/SF', 60);
    html += th('Expiration', 85);
    html += thr('Firm Term Rem', 80);
    html += thr('Lease Term Rem', 80);
    html += th('Expenses', 70);
    html += th('Bumps', 90);
    html += thr('Price', 85);
    html += thr('Price/SF', 65);
    html += thr('Cap', 55);
    html += th('Sold Date', 80);
    html += th('Seller', 110);
    html += th('Listing Broker', 100);
    html += th('Buyer', 110);
    html += th('Procuring Broker', 110);
    html += thr('Bid-Ask', 55);
    html += thr('DOM', 45);
  } else {
    html += th('Agency', 160);
    html += th('Address', 140);
    html += th('City', 90);
    html += th('State', 40);
    html += thr('Land', 55);
    html += thr('Built', 45);
    html += thr('RBA', 60);
    html += thr('NOI', 75);
    html += thr('NOI/SF', 60);
    html += th('Expiration', 85);
    html += thr('Firm Term Rem', 80);
    html += thr('Lease Term Rem', 80);
    html += th('Expenses', 70);
    html += th('Bumps', 90);
    html += thr('Ask Price', 85);
    html += thr('Price/SF', 65);
    html += thr('Ask Cap', 55);
    html += th('Seller', 110);
    html += th('Listing Broker', 100);
    html += thr('DOM', 45);
  }
  html += '</tr></thead>';

  // Body
  html += '<tbody>';
  const td = (val, trunc) => '<td style="padding: 8px; border-bottom: 1px solid var(--border); white-space: nowrap;' + (trunc ? ' max-width: 180px; overflow: hidden; text-overflow: ellipsis;' : '') + '">' + esc(val || '—') + '</td>';
  const tdr = (val) => '<td style="padding: 8px; border-bottom: 1px solid var(--border); white-space: nowrap; text-align: right; font-family: \'JetBrains Mono\', monospace; font-size: 11px;">' + (val || '—') + '</td>';
  const fmtMoney = (v) => v != null && v > 0 ? '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
  const fmtCap = (v) => v != null && v > 0 ? (v < 1 ? (v * 100).toFixed(2) : parseFloat(v).toFixed(2)) + '%' : '—';
  const fmtPSF = (v) => v != null && v > 0 ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const fmtAcres = (v) => v != null && v > 0 ? parseFloat(v).toFixed(2) + ' ac' : '—';
  const fmtSF = (v) => v != null && v > 0 ? Number(Math.round(v)).toLocaleString('en-US') + ' SF' : '—';
  const fmtTerm = (v) => v != null ? (parseFloat(v) < 0 ? 'Exp.' : parseFloat(v).toFixed(1) + ' yr') : '—';
  const fmtDate = (v) => v || '—';

  pageRows.forEach(r => {
    const rowData = JSON.stringify({ property_id: r.property_id, lease_number: r.lease_number, agency: r.agency, address: r.address, city: r.city, state: r.state }).replace(/'/g, '&#39;');
    html += '<tr class="clickable-row" onclick=\'showDetail(' + rowData + ', "gov-ownership")\' style="cursor: pointer;">';
    html += td(r.agency, true);
    html += td(r.address, true);
    html += td(r.city);
    html += td(r.state);
    html += tdr(fmtAcres(r.land_acres));
    html += tdr(r.year_built || '—');
    html += tdr(fmtSF(r.rba));
    html += tdr(fmtMoney(r.noi));
    html += tdr(fmtPSF(r.noi_psf));
    html += td(fmtDate(r.lease_expiration));
    html += tdr(fmtTerm(r.firm_term_remaining));
    html += tdr(fmtTerm(r.term_remaining));
    html += td(r.expenses);
    html += td(r.bumps, true);
    if (isComps) {
      html += tdr(fmtMoney(r.price));
      html += tdr(fmtPSF(r.price_psf));
      html += tdr(fmtCap(r.cap_rate));
      html += td(fmtDate(r.sold_date));
      html += td(r.seller, true);
      html += td(r.listing_broker, true);
      html += td(r.buyer, true);
      html += td(r.procuring_broker, true);
      html += tdr(r.bid_ask_spread != null ? r.bid_ask_spread + '%' : '—');
      html += tdr(r.dom != null ? r.dom + 'd' : '—');
    } else {
      html += tdr(fmtMoney(r.ask_price));
      html += tdr(fmtPSF(r.price_psf));
      html += tdr(fmtCap(r.ask_cap));
      html += td(r.seller, true);
      html += td(r.listing_broker, true);
      html += tdr(r.dom != null ? r.dom + 'd' : '—');
    }
    html += '</tr>';
  });

  if (pageRows.length === 0) {
    const colSpan = isComps ? 24 : 20;
    html += '<tr><td colspan="' + colSpan + '" style="text-align: center; padding: 32px; color: var(--text3);">No ' + (isComps ? 'sales comps' : 'available listings') + ' to display</td></tr>';
  }
  html += '</tbody></table></div>';

  // Pagination
  if (totalPages > 1) {
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 13px; color: var(--text2);">';
    html += '<span>Page ' + (govSalesPage + 1) + ' of ' + totalPages + ' (' + fmtN(filtered.length) + ' total)</span>';
    html += '<div style="display: flex; gap: 6px;">';
    html += '<button class="pill' + (govSalesPage === 0 ? '' : ' active') + '" data-gov-sales-page="prev"' + (govSalesPage === 0 ? ' disabled style="opacity:0.4;pointer-events:none"' : '') + '>&laquo; Prev</button>';
    html += '<button class="pill' + (govSalesPage >= totalPages - 1 ? '' : ' active') + '" data-gov-sales-page="next"' + (govSalesPage >= totalPages - 1 ? ' disabled style="opacity:0.4;pointer-events:none"' : '') + '>Next &raquo;</button>';
    html += '</div></div>';
  }

  html += '</div>';

  // Render to DOM
  inner.innerHTML = html;

  // Bind events
  document.querySelectorAll('[data-gov-sales-view]').forEach(btn => {
    btn.addEventListener('click', e => {
      govSalesView = e.target.dataset.govSalesView;
      govSalesPage = 0;
      govSalesSearch = '';
      renderGovSales();
    });
  });
  document.querySelectorAll('[data-gov-sales-page]').forEach(btn => {
    btn.addEventListener('click', e => {
      if (e.target.dataset.govSalesPage === 'prev' && govSalesPage > 0) govSalesPage--;
      else if (e.target.dataset.govSalesPage === 'next') govSalesPage++;
      renderGovSales();
    });
  });
  const searchInput = document.getElementById('govSalesSearchInput');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', e => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        govSalesSearch = e.target.value.trim();
        govSalesPage = 0;
        renderGovSales();
      }, 300);
    });
    searchInput.focus();
    searchInput.selectionStart = searchInput.selectionEnd = searchInput.value.length;
  }
}


// ============================================================================
// GOVERNMENT LEASES TAB
// ============================================================================
let govLeasesData = null; // lazy-loaded

function renderGovLeases() {
  const el = document.getElementById('bizPageInner');
  if (!el) return '';

  // Show loading if data not yet available
  if (!govData.portfolioProperties || govData.portfolioProperties.length === 0) {
    el.innerHTML = '<div class="loading"><span class="spinner"></span> Loading lease data...</div>';
    // Trigger portfolio load if not done
    (async () => {
      try {
        let allProps = [], pg = 0;
        while (true) {
          const batch = await govQuery('properties',
            'property_id,agency,agency_full_name,address,city,state,firm_term_remaining,gross_rent,gross_rent_psf,sf_leased,noi,lease_expiration,lease_commencement,government_type',
            { limit: 2000, offset: pg * 2000 }
          );
          allProps = allProps.concat(batch.data || []);
          if (!batch.data || batch.data.length < 2000) break;
          pg++;
        }
        govData.portfolioProperties = allProps;
        el.innerHTML = buildGovLeasesHTML();
      } catch (e) {
        el.innerHTML = '<div class="widget-error"><div class="err-msg">Failed to load lease data</div><button class="retry-btn" onclick="renderGovLeases()">Retry</button></div>';
      }
    })();
    return '';
  }

  el.innerHTML = buildGovLeasesHTML();
  return '';
}

function buildGovLeasesHTML() {
  const props = govData.portfolioProperties || [];
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // Parse lease data
  const withLease = props.filter(p => p.lease_expiration || p.firm_term_remaining != null);
  const withTerm = props.filter(p => p.firm_term_remaining != null && p.firm_term_remaining !== undefined);

  // Expiration buckets
  const expired = withTerm.filter(p => p.firm_term_remaining < 0);
  const under1yr = withTerm.filter(p => p.firm_term_remaining >= 0 && p.firm_term_remaining <= 1);
  const yr1to2 = withTerm.filter(p => p.firm_term_remaining > 1 && p.firm_term_remaining <= 2);
  const yr2to5 = withTerm.filter(p => p.firm_term_remaining > 2 && p.firm_term_remaining <= 5);
  const yr5to10 = withTerm.filter(p => p.firm_term_remaining > 5 && p.firm_term_remaining <= 10);
  const over10 = withTerm.filter(p => p.firm_term_remaining > 10);
  const avgTerm = withTerm.length > 0 ? (withTerm.reduce((s, p) => s + (p.firm_term_remaining || 0), 0) / withTerm.length) : 0;
  const totalRent = props.reduce((s, p) => s + (p.gross_rent || 0), 0);

  let html = '<div style="margin-bottom:24px">';
  html += '<div style="font-size:16px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px"><span style="font-size:20px">📋</span> Lease Intelligence</div>';

  // ── Summary Stats ──
  html += '<div class="dia-grid dia-grid-4" style="margin-bottom:20px">';
  html += metricHTML('Total Properties', fmtN(props.length), 'With lease data', 'blue');
  html += metricHTML('Avg Firm Term', avgTerm.toFixed(1) + ' yrs', withTerm.length + ' properties', 'cyan');
  html += metricHTML('Expiring < 2 Years', fmtN(expired.length + under1yr.length + yr1to2.length), 'High-priority targets', 'red');
  html += metricHTML('Total Gross Rent', fmt(totalRent), fmtN(props.filter(p => p.gross_rent).length) + ' properties', 'green');
  html += '</div>';

  // ── Expiration Distribution Chart ──
  html += '<div class="widget" style="margin-bottom:16px">';
  html += '<div class="widget-title">Lease Expiration Distribution</div>';
  const buckets = [
    { label: 'Expired', count: expired.length, color: '#ef4444', rent: expired.reduce((s, p) => s + (p.gross_rent || 0), 0) },
    { label: '0–1 Years', count: under1yr.length, color: '#f87171', rent: under1yr.reduce((s, p) => s + (p.gross_rent || 0), 0) },
    { label: '1–2 Years', count: yr1to2.length, color: '#fb923c', rent: yr1to2.reduce((s, p) => s + (p.gross_rent || 0), 0) },
    { label: '2–5 Years', count: yr2to5.length, color: '#fbbf24', rent: yr2to5.reduce((s, p) => s + (p.gross_rent || 0), 0) },
    { label: '5–10 Years', count: yr5to10.length, color: '#34d399', rent: yr5to10.reduce((s, p) => s + (p.gross_rent || 0), 0) },
    { label: '10+ Years', count: over10.length, color: '#60a5fa', rent: over10.reduce((s, p) => s + (p.gross_rent || 0), 0) },
  ];
  const maxBucket = Math.max(...buckets.map(b => b.count), 1);
  html += '<div style="display:flex;flex-direction:column;gap:6px">';
  for (const b of buckets) {
    const pct = ((b.count / maxBucket) * 100).toFixed(0);
    html += `<div style="display:flex;align-items:center;gap:8px">
      <div style="width:90px;font-size:12px;color:var(--text2);text-align:right;flex-shrink:0">${b.label}</div>
      <div style="flex:1;background:var(--s2);border-radius:4px;height:22px;overflow:hidden">
        <div style="width:${pct}%;background:${b.color};height:100%;border-radius:4px;min-width:${b.count > 0 ? '2px' : '0'}"></div>
      </div>
      <div style="width:40px;font-size:12px;font-weight:600;color:var(--text)">${fmtN(b.count)}</div>
      <div style="width:70px;font-size:11px;color:var(--text3)">${fmt(b.rent)}</div>
    </div>`;
  }
  html += '</div></div>';

  // ── Expiring Soon — Prospecting Targets ──
  // Sort: soonest-to-expire first (small positive values), then expired leases at the end
  const urgentLeases = [...under1yr, ...yr1to2, ...expired]
    .sort((a, b) => {
      const aT = a.firm_term_remaining ?? -999;
      const bT = b.firm_term_remaining ?? -999;
      // Positive terms first (ascending), then negative/expired last
      if (aT >= 0 && bT >= 0) return aT - bT;
      if (aT >= 0) return -1;
      if (bT >= 0) return 1;
      return bT - aT; // among expired, most recently expired first
    });

  html += '<div class="widget" style="margin-bottom:16px">';
  html += `<div class="widget-title">Expiring Soon — Prospecting Targets <span style="font-size:12px;font-weight:400;color:var(--text3)">(${urgentLeases.length} properties)</span></div>`;

  if (urgentLeases.length === 0) {
    html += '<div style="color:var(--text2);font-size:13px;padding:12px 0">No leases expiring within 2 years.</div>';
  } else {
    html += '<div class="gov-table-card"><table class="gov-table"><thead><tr>';
    html += '<th>Agency</th><th>Address</th><th>City</th><th>State</th><th style="text-align:right">Firm Term</th><th>Expiration</th><th style="text-align:right">Rent</th><th style="text-align:right">SF</th>';
    html += '</tr></thead><tbody>';
    for (const p of urgentLeases.slice(0, 50)) {
      const termColor = (p.firm_term_remaining || 0) < 0 ? 'var(--red)' : (p.firm_term_remaining || 0) <= 1 ? '#f87171' : '#fb923c';
      const termLabel = p.firm_term_remaining != null ? (p.firm_term_remaining < 0 ? 'Expired' : p.firm_term_remaining.toFixed(1) + ' yrs') : '—';
      const expDate = p.lease_expiration ? new Date(p.lease_expiration).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—';
      html += `<tr class="clickable-row" onclick="goToGovTab('pipeline')">`;
      html += `<td>${esc(p.agency || p.agency_full_name || '—')}</td>`;
      html += `<td>${esc(p.address || '—')}</td>`;
      html += `<td>${esc(p.city || '—')}</td>`;
      html += `<td>${esc(p.state || '—')}</td>`;
      html += `<td style="text-align:right;color:${termColor};font-weight:600">${termLabel}</td>`;
      html += `<td>${expDate}</td>`;
      html += `<td style="text-align:right">${p.gross_rent ? fmt(p.gross_rent) : '—'}</td>`;
      html += `<td style="text-align:right">${p.sf_leased ? fmtN(Math.round(p.sf_leased)) : '—'}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    if (urgentLeases.length > 50) {
      html += `<div style="text-align:center;font-size:12px;color:var(--text3);padding:8px">Showing 50 of ${urgentLeases.length} expiring leases</div>`;
    }
  }
  html += '</div>';

  // ── New Leases (Recent) ──
  const recentLeases = props.filter(p => p.lease_commencement).sort((a, b) => (b.lease_commencement || '').localeCompare(a.lease_commencement || '')).slice(0, 25);

  html += '<div class="widget" style="margin-bottom:16px">';
  html += `<div class="widget-title">Recent / New Leases <span style="font-size:12px;font-weight:400;color:var(--text3)">(by lease effective date)</span></div>`;
  if (recentLeases.length === 0) {
    html += '<div style="color:var(--text2);font-size:13px;padding:12px 0">No lease effective dates available.</div>';
  } else {
    html += '<div class="gov-table-card"><table class="gov-table"><thead><tr>';
    html += '<th>Agency</th><th>Address</th><th>State</th><th>Effective</th><th>Expiration</th><th style="text-align:right">Firm Term</th><th style="text-align:right">Rent</th>';
    html += '</tr></thead><tbody>';
    for (const p of recentLeases) {
      const eff = p.lease_commencement ? new Date(p.lease_commencement).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
      const exp = p.lease_expiration ? new Date(p.lease_expiration).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—';
      const term = p.firm_term_remaining != null ? p.firm_term_remaining.toFixed(1) + ' yrs' : '—';
      html += '<tr>';
      html += `<td>${esc(p.agency || '—')}</td><td>${esc(p.address || '—')}</td><td>${esc(p.state || '—')}</td>`;
      html += `<td>${eff}</td><td>${exp}</td><td style="text-align:right">${term}</td><td style="text-align:right">${p.gross_rent ? fmt(p.gross_rent) : '—'}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table></div>';
  }
  html += '</div>';

  // ── Agency Lease Analysis ──
  html += '<div class="widget">';
  html += '<div class="widget-title">Lease Exposure by Agency</div>';
  const agencyMap = {};
  for (const p of withTerm) {
    const a = p.agency || p.agency_full_name || 'Unknown';
    if (!agencyMap[a]) agencyMap[a] = { count: 0, rent: 0, termSum: 0, expiring: 0 };
    agencyMap[a].count++;
    agencyMap[a].rent += (p.gross_rent || 0);
    agencyMap[a].termSum += (p.firm_term_remaining || 0);
    if (p.firm_term_remaining <= 2) agencyMap[a].expiring++;
  }
  const topAgencies = Object.entries(agencyMap).sort((a, b) => b[1].count - a[1].count).slice(0, 15);
  if (topAgencies.length > 0) {
    html += '<div class="gov-table-card"><table class="gov-table"><thead><tr>';
    html += '<th>Agency</th><th style="text-align:right">Properties</th><th style="text-align:right">Total Rent</th><th style="text-align:right">Avg Term</th><th style="text-align:right">Expiring &lt;2yr</th>';
    html += '</tr></thead><tbody>';
    for (const [name, data] of topAgencies) {
      const avgT = data.count > 0 ? (data.termSum / data.count).toFixed(1) : '—';
      html += `<tr><td>${esc(name)}</td><td style="text-align:right">${fmtN(data.count)}</td><td style="text-align:right">${fmt(data.rent)}</td><td style="text-align:right">${avgT} yrs</td><td style="text-align:right;color:${data.expiring > 0 ? 'var(--red)' : 'var(--text2)'}">${fmtN(data.expiring)}</td></tr>`;
    }
    html += '</tbody></table></div>';
  }
  html += '</div>';

  html += '</div>';
  return html;
}

// ============================================================================
// GOVERNMENT LOANS TAB
// ============================================================================
let govLoansData = null; // lazy-loaded

function renderGovLoans() {
  const el = document.getElementById('bizPageInner');
  if (!el) return '';

  // Lazy-load loans
  if (!govLoansData) {
    el.innerHTML = '<div class="loading"><span class="spinner"></span> Loading loan data...</div>';
    (async () => {
      try {
        let allLoans = [], pg = 0;
        while (true) {
          const batch = await govQuery('loans',
            'loan_id,property_id,index_name,loan_amount,loan_type,status,maturity_date,interest_rate,origination_date,lender_id,rate_type,term_years',
            { limit: 2000, offset: pg * 2000 }
          );
          allLoans = allLoans.concat(batch.data || []);
          if (!batch.data || batch.data.length < 2000) break;
          pg++;
        }
        govLoansData = allLoans;
        el.innerHTML = buildGovLoansHTML();
      } catch (e) {
        console.error('Loans load error:', e);
        el.innerHTML = '<div class="widget-error"><div class="err-msg">Failed to load loan data</div><button class="retry-btn" onclick="govLoansData=null;renderGovLoans()">Retry</button></div>';
      }
    })();
    return '';
  }

  el.innerHTML = buildGovLoansHTML();
  return '';
}

function buildGovLoansHTML() {
  const loans = govLoansData || [];

  let html = '<div style="margin-bottom:24px">';
  html += '<div style="font-size:16px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px"><span style="font-size:20px">🏦</span> Loan Intelligence</div>';

  if (loans.length === 0) {
    // Empty state — scaffold for future data
    html += '<div class="widget" style="text-align:center;padding:40px 20px">';
    html += '<div style="font-size:48px;margin-bottom:12px;opacity:0.3">🏦</div>';
    html += '<div style="font-size:16px;font-weight:600;margin-bottom:8px;color:var(--text)">Loan Data Coming Soon</div>';
    html += '<div style="font-size:13px;color:var(--text2);max-width:400px;margin:0 auto;line-height:1.6">';
    html += 'This tab will show loan-level intelligence including maturity schedules, lender breakdown, LTV analysis, and refinancing opportunities once loan data is ingested into Supabase.';
    html += '</div>';
    html += '<div style="margin-top:20px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">';
    html += '<div class="stat-card" style="min-width:120px"><div class="stat-label">Total Loans</div><div class="stat-value" style="color:var(--text3)">0</div></div>';
    html += '<div class="stat-card" style="min-width:120px"><div class="stat-label">Total Volume</div><div class="stat-value" style="color:var(--text3)">$0</div></div>';
    html += '<div class="stat-card" style="min-width:120px"><div class="stat-label">Maturing &lt;1yr</div><div class="stat-value" style="color:var(--text3)">0</div></div>';
    html += '</div>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  // Stats
  const totalVolume = loans.reduce((s, l) => s + (parseFloat(l.loan_amount) || 0), 0);
  const withMaturity = loans.filter(l => l.maturity_date);
  const now = new Date();
  const oneYr = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  const twoYr = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate());
  const maturingUnder1 = withMaturity.filter(l => new Date(l.maturity_date) <= oneYr).length;
  const maturingUnder2 = withMaturity.filter(l => new Date(l.maturity_date) <= twoYr).length;

  // Lender breakdown
  const lenderMap = {};
  for (const l of loans) {
    const lender = l.index_name || l.rate_type || 'Unknown';
    if (!lenderMap[lender]) lenderMap[lender] = { count: 0, volume: 0 };
    lenderMap[lender].count++;
    lenderMap[lender].volume += (parseFloat(l.loan_amount) || 0);
  }
  const topLenders = Object.entries(lenderMap).sort((a, b) => b[1].volume - a[1].volume).slice(0, 10);

  // Type breakdown
  const typeMap = {};
  for (const l of loans) {
    const t = l.loan_type || 'Unknown';
    if (!typeMap[t]) typeMap[t] = { count: 0, volume: 0 };
    typeMap[t].count++;
    typeMap[t].volume += (parseFloat(l.loan_amount) || 0);
  }

  html += '<div class="dia-grid dia-grid-4" style="margin-bottom:20px">';
  html += metricHTML('Total Loans', fmtN(loans.length), 'In database', 'blue');
  html += metricHTML('Total Volume', fmt(totalVolume), fmtN(loans.length) + ' loans', 'green');
  html += metricHTML('Maturing < 1yr', fmtN(maturingUnder1), 'Refi opportunities', 'red');
  html += metricHTML('Maturing < 2yr', fmtN(maturingUnder2), 'Watch list', 'orange');
  html += '</div>';

  // Lender Breakdown
  if (topLenders.length > 0) {
    html += '<div class="widget" style="margin-bottom:16px">';
    html += '<div class="widget-title">Lender Breakdown</div>';
    html += '<div class="gov-table-card"><table class="gov-table"><thead><tr>';
    html += '<th>Lender</th><th style="text-align:right">Loans</th><th style="text-align:right">Volume</th><th style="text-align:right">Avg Loan</th>';
    html += '</tr></thead><tbody>';
    for (const [name, data] of topLenders) {
      const avg = data.count > 0 ? data.volume / data.count : 0;
      html += `<tr><td>${esc(name)}</td><td style="text-align:right">${fmtN(data.count)}</td><td style="text-align:right">${fmt(data.volume)}</td><td style="text-align:right">${fmt(avg)}</td></tr>`;
    }
    html += '</tbody></table></div></div>';
  }

  // Loan Type Breakdown
  if (Object.keys(typeMap).length > 0) {
    html += '<div class="widget" style="margin-bottom:16px">';
    html += '<div class="widget-title">By Loan Type</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    for (const [type, data] of Object.entries(typeMap).sort((a, b) => b[1].volume - a[1].volume)) {
      html += `<div class="stat-card" style="min-width:120px;flex:1"><div class="stat-label">${esc(type)}</div><div class="stat-value" style="font-size:18px">${fmtN(data.count)}</div><div class="stat-sub">${fmt(data.volume)}</div></div>`;
    }
    html += '</div></div>';
  }

  // Maturity Schedule
  if (withMaturity.length > 0) {
    const maturing = withMaturity.sort((a, b) => (a.maturity_date || '').localeCompare(b.maturity_date || ''));
    html += '<div class="widget">';
    html += `<div class="widget-title">Maturity Schedule <span style="font-size:12px;font-weight:400;color:var(--text3)">(${withMaturity.length} loans)</span></div>`;
    html += '<div class="gov-table-card"><table class="gov-table"><thead><tr>';
    html += '<th>Lender</th><th>Type</th><th style="text-align:right">Amount</th><th>Maturity</th><th>Status</th>';
    html += '</tr></thead><tbody>';
    for (const l of maturing.slice(0, 50)) {
      const mat = l.maturity_date ? new Date(l.maturity_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—';
      const isPastDue = l.maturity_date && new Date(l.maturity_date) < now;
      html += `<tr><td>${esc(l.index_name || '—')}</td><td>${esc(l.loan_type || '—')}</td><td style="text-align:right">${l.loan_amount ? fmt(parseFloat(l.loan_amount)) : '—'}</td><td style="color:${isPastDue ? 'var(--red)' : 'var(--text)'}">${mat}${isPastDue ? ' (past due)' : ''}</td><td>${esc(l.status || '—')}</td></tr>`;
    }
    html += '</tbody></table></div></div>';
  }

  html += '</div>';
  return html;
}
// ============================================================================
// GOVERNMENT PLAYERS (Top Buyers, Sellers, Brokers)
// ============================================================================

let govPlayersView = 'buyers';

function renderGovPlayers() {
  let html = '<div class="biz-section">';

  // View toggle pills
  html += '<div class="pills" style="margin-bottom: 20px;">';
  ['buyers', 'sellers', 'brokers'].forEach(view => {
    const active = govPlayersView === view ? ' active' : '';
    html += '<button class="pill' + active + '" onclick="govPlayersView=\'' + view + '\';renderGovTab()">' + view.charAt(0).toUpperCase() + view.slice(1) + '</button>';
  });
  html += '</div>';

  // Normalize entity names to merge variants (e.g., "Boyd Watterson" + "Boyd Watterson Global")
  function normalizeEntity(name) {
    if (!name) return '';
    let n = name.trim().toUpperCase()
      .replace(/,?\s*(LLC|LP|INC\.?|CORP\.?|L\.?P\.?|L\.?L\.?C\.?|LTD\.?|CO\.?)$/i, '')
      .replace(/\s+/g, ' ').trim();
    // Merge known entity families
    if (n.startsWith('BOYD WATTERSON')) return 'BOYD WATTERSON';
    if (n.startsWith('EASTERLY')) return 'EASTERLY';
    if (n.startsWith('TANENBAUM') || n.startsWith('GARDNER-TANNENBAUM') || n.startsWith('GARDNER TANNENBAUM')) return 'TANENBAUM / GARDNER-TANNENBAUM';
    if (n.startsWith('NGP')) return 'NGP CAPITAL';
    if (n.startsWith('RMR')) return 'RMR';
    return n;
  }

  // Prefer the full lazy-loaded v_sales_comps (2155 rows) over govData.salesComps (500-row limit)
  const sales = (govSalesComps && govSalesComps.length > 0) ? govSalesComps : (govData.salesComps || []);
  const ownership = govData.ownership || [];
  const listings = govData.listings || [];

  if (govPlayersView === 'buyers') {
    // Aggregate buyers from sales + ownership transfers
    const buyerMap = {};
    sales.forEach(r => {
      const buyer = r.buyer || r.purchasing_broker;
      if (buyer) {
        const key = normalizeEntity(buyer);
        if (!buyerMap[key]) buyerMap[key] = { name: buyer, deals: 0, volume: 0, records: [] };
        buyerMap[key].deals++;
        buyerMap[key].volume += (r.sold_price || r.price || r.sold_price_psf || 0);
        buyerMap[key].records.push(r);
      }
    });
    ownership.forEach(r => {
      if (r.new_owner) {
        const key = normalizeEntity(r.new_owner);
        if (!buyerMap[key]) buyerMap[key] = { name: r.new_owner, deals: 0, volume: 0, records: [] };
        buyerMap[key].deals++;
        buyerMap[key].volume += (r.sale_price || r.estimated_value || 0);
        buyerMap[key].records.push(r);
      }
    });

    const topBuyers = Object.values(buyerMap).sort((a, b) => b.deals - a.deals).slice(0, 50);
    html += renderPlayersTable(topBuyers, 'Buyer', 'gov');

  } else if (govPlayersView === 'sellers') {
    const sellerMap = {};
    sales.forEach(r => {
      if (r.seller) {
        const key = normalizeEntity(r.seller);
        if (!sellerMap[key]) sellerMap[key] = { name: r.seller, deals: 0, volume: 0, records: [] };
        sellerMap[key].deals++;
        sellerMap[key].volume += (r.sold_price || r.price || 0);
        sellerMap[key].records.push(r);
      }
    });
    ownership.forEach(r => {
      if (r.prior_owner) {
        const key = normalizeEntity(r.prior_owner);
        if (!sellerMap[key]) sellerMap[key] = { name: r.prior_owner, deals: 0, volume: 0, records: [] };
        sellerMap[key].deals++;
        sellerMap[key].volume += (r.sale_price || r.estimated_value || 0);
        sellerMap[key].records.push(r);
      }
    });

    const topSellers = Object.values(sellerMap).sort((a, b) => b.deals - a.deals).slice(0, 50);
    html += renderPlayersTable(topSellers, 'Seller', 'gov');

  } else {
    // Brokers from sales + listings
    const brokerMap = {};
    sales.forEach(r => {
      const broker = r.listing_broker;
      if (broker) {
        const key = normalizeEntity(broker);
        if (!brokerMap[key]) brokerMap[key] = { name: broker, deals: 0, volume: 0, records: [] };
        brokerMap[key].deals++;
        brokerMap[key].volume += (r.sold_price || r.price || 0);
        brokerMap[key].records.push(r);
      }
    });
    listings.forEach(r => {
      const broker = r.broker || r.listing_agent || r.source;
      if (broker) {
        const key = normalizeEntity(broker);
        if (!brokerMap[key]) brokerMap[key] = { name: broker, deals: 0, volume: 0, records: [] };
        brokerMap[key].deals++;
        brokerMap[key].volume += (r.asking_price || 0);
        brokerMap[key].records.push(r);
      }
    });

    const topBrokers = Object.values(brokerMap).sort((a, b) => b.deals - a.deals).slice(0, 50);
    html += renderPlayersTable(topBrokers, 'Broker', 'gov');
  }

  html += '</div>';
  return html;
}

function renderPlayersTable(players, roleLabel, project) {
  let html = '<div class="gov-metrics">';
  html += metricHTML('Total ' + roleLabel + 's', fmtN(players.length), 'unique entities', 'blue');
  const topDealCount = players[0]?.deals || 0;
  const topVolume = players.reduce((s, p) => s + p.volume, 0);
  html += metricHTML('Top ' + roleLabel, players[0]?.name?.substring(0, 25) || '—', topDealCount + ' deals', 'green');
  html += metricHTML('Total Volume', fmt(topVolume), 'across all ' + roleLabel.toLowerCase() + 's', 'yellow');
  html += '</div>';

  html += '<div class="table-wrapper"><div class="data-table">';
  html += '<div class="table-row" style="font-weight: 600; border-bottom: 2px solid var(--border);">';
  html += '<div style="flex: 3;">' + roleLabel + '</div>';
  html += '<div style="flex: 1; text-align: right;">Deals</div>';
  html += '<div style="flex: 2; text-align: right;">Total Volume</div>';
  html += '<div style="flex: 2;">Most Recent</div>';
  html += '</div>';

  players.forEach((p, idx) => {
    const latestRecord = p.records[0] || {};
    const source = project === 'gov' ? (latestRecord.lead_id ? 'gov-lead' : 'gov-ownership') : 'dia-clinic';

    html += '<div class="table-row clickable-row" onclick=\'showDetail(' + safeJSON(latestRecord) + ', "' + source + '")\'>';
    html += '<div style="flex: 3;"><span style="color: var(--text2); margin-right: 8px;">#' + (idx + 1) + '</span>' + esc(p.name) + '</div>';
    html += '<div style="flex: 1; text-align: right; color: var(--accent);">' + p.deals + '</div>';
    html += '<div style="flex: 2; text-align: right;">' + fmt(p.volume) + '</div>';
    html += '<div style="flex: 2; color: var(--text2);">' + esc(latestRecord.address || latestRecord.facility_name || '—') + '</div>';
    html += '</div>';
  });

  if (players.length === 0) {
    html += '<div class="table-empty">No ' + roleLabel.toLowerCase() + ' data available</div>';
  }

  html += '</div></div>';
  return html;
}

// ============================================================================
// GOVERNMENT SEARCH
// ============================================================================

let govSearchTerm = '';
let govSearchResults = null;
let govSearching = false;

function renderGovSearch() {
  let html = '<div class="biz-section">';
  html += '<div class="search-bar">';
  html += '<input type="text" id="govSearchInput" placeholder="Search by address, tenant, city, state, lessor, contact..." value="' + esc(govSearchTerm) + '" />';
  html += '<button onclick="execGovSearch()">Search</button>';
  html += '</div>';

  if (govSearching) {
    html += '<div class="search-loading">Searching across all government records...</div>';
  } else if (govSearchResults === null) {
    html += '<div class="search-empty">';
    html += '<div class="search-empty-icon">&#128269;</div>';
    html += '<p>Search across ownership records, prospect leads, listings, contacts, and properties</p>';
    html += '</div>';
  } else {
    const { ownership, leads, listings, contacts, properties } = govSearchResults;
    const total = ownership.length + leads.length + listings.length + contacts.length + properties.length;

    if (total === 0) {
      html += '<div class="search-empty"><p>No results found for "' + esc(govSearchTerm) + '"</p></div>';
    } else {
      html += '<div style="color: var(--text2); font-size: 13px; margin-bottom: 16px;">' + total + ' result' + (total !== 1 ? 's' : '') + ' found</div>';

      if (leads.length > 0) {
        html += '<div class="search-results-section"><h4>Prospect Leads (' + leads.length + ')</h4>';
        leads.forEach(r => {
          html += '<div class="search-card" onclick=\'showDetail(' + safeJSON(r) + ', "gov-lead")\'>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(norm(r.address) || norm(r.tenant_agency) || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(52,211,153,0.15); color: #34d399;">Lead</span></div>';
          html += '<div class="search-card-meta">';
          if (r.city || r.state) html += '<span>' + esc((norm(r.city) || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</span>';
          if (r.tenant_agency) html += '<span>Tenant: ' + esc(norm(r.tenant_agency)) + '</span>';
          if (r.lessor_name) html += '<span>Owner: ' + esc(norm(r.lessor_name)) + '</span>';
          if (r.recorded_owner) html += '<span>Recorded: ' + esc(norm(r.recorded_owner)) + '</span>';
          if (r.asking_price) html += '<span>Asking: ' + fmt(r.asking_price) + '</span>';
          if (r.pipeline_status) html += '<span>Stage: ' + esc(cleanLabel(r.pipeline_status)) + '</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      if (ownership.length > 0) {
        html += '<div class="search-results-section"><h4>Ownership Records (' + ownership.length + ')</h4>';
        ownership.forEach(r => {
          html += '<div class="search-card" onclick=\'showDetail(' + safeJSON(r) + ', "gov-ownership")\'>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(norm(r.address) || r.lease_number || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(108,140,255,0.15); color: #6c8cff;">Ownership</span></div>';
          html += '<div class="search-card-meta">';
          if (r.city || r.state) html += '<span>' + esc((norm(r.city) || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</span>';
          if (r.prior_owner) html += '<span>From: ' + esc(norm(r.prior_owner)) + '</span>';
          if (r.new_owner) html += '<span>To: ' + esc(norm(r.new_owner)) + '</span>';
          if (r.estimated_value) html += '<span>Value: ' + fmt(r.estimated_value) + '</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      if (listings.length > 0) {
        html += '<div class="search-results-section"><h4>Listings (' + listings.length + ')</h4>';
        listings.forEach(r => {
          html += '<div class="search-card" onclick=\'showDetail(' + safeJSON(r) + ', "gov-listing")\'>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(norm(r.address) || norm(r.tenant_agency) || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(251,191,36,0.15); color: #fbbf24;">Listing</span></div>';
          html += '<div class="search-card-meta">';
          if (r.city || r.state) html += '<span>' + esc((norm(r.city) || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</span>';
          if (r.tenant_agency) html += '<span>Tenant: ' + esc(norm(r.tenant_agency)) + '</span>';
          if (r.seller_name) html += '<span>Owner: ' + esc(norm(r.seller_name)) + '</span>';
          if (r.asking_price) html += '<span>Asking: ' + fmt(r.asking_price) + '</span>';
          if (r.listing_status) html += '<span>Status: ' + esc(cleanLabel(r.listing_status)) + '</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      if (contacts.length > 0) {
        html += '<div class="search-results-section"><h4>Contacts (' + contacts.length + ')</h4>';
        contacts.forEach(r => {
          html += '<div class="search-card">';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(norm(r.name) || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(167,139,250,0.15); color: #a78bfa;">Contact</span></div>';
          html += '<div class="search-card-meta">';
          if (r.contact_type) html += '<span>' + esc(norm(r.contact_type)) + '</span>';
          if (r.total_volume) html += '<span>Volume: ' + fmt(r.total_volume) + '</span>';
          if (r.phone) html += '<span>' + esc(r.phone) + '</span>';
          if (r.email) html += '<span>' + esc(r.email) + '</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      if (properties.length > 0) {
        html += '<div class="search-results-section"><h4>Properties (' + properties.length + ')</h4>';
        properties.forEach(r => {
          html += '<div class="search-card" onclick=\'showDetail(' + safeJSON(r) + ', "gov-ownership")\'>';
          html += '<div class="search-card-header"><span class="search-card-title">' + esc(norm(r.address) || norm(r.property_name) || '—') + '</span>';
          html += '<span class="search-card-badge" style="background: rgba(34,211,238,0.15); color: #22d3ee;">Property</span></div>';
          html += '<div class="search-card-meta">';
          if (r.city || r.state) html += '<span>' + esc((norm(r.city) || '') + (r.city && r.state ? ', ' : '') + (r.state || '')) + '</span>';
          if (r.property_type) html += '<span>Type: ' + esc(norm(r.property_type)) + '</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }
    }
  }

  html += '</div>';

  // Attach enter-key handler after render
  setTimeout(() => {
    const input = document.getElementById('govSearchInput');
    if (input) {
      input.addEventListener('keydown', e => { if (e.key === 'Enter') execGovSearch(); });
      input.focus();
    }
  }, 0);

  return html;
}

async function execGovSearch() {
  const input = document.getElementById('govSearchInput');
  if (!input) return;
  const term = input.value.trim();
  if (!term) return;

  govSearchTerm = term;
  govSearching = true;
  renderGovTab();

  const like = '*' + term + '*';
  try {
    const [ownership, leads, listings, contacts, properties] = await Promise.all([
      govQuery('ownership_history', '*', { filter: 'or=(address.ilike.' + like + ',city.ilike.' + like + ',state.ilike.' + like + ',new_owner.ilike.' + like + ',prior_owner.ilike.' + like + ',recorded_owner_name.ilike.' + like + ')', limit: 25 }),
      govQuery('prospect_leads', '*', { filter: 'or=(address.ilike.' + like + ',city.ilike.' + like + ',tenant_agency.ilike.' + like + ',lessor_name.ilike.' + like + ',recorded_owner.ilike.' + like + ',contact_name.ilike.' + like + ')', limit: 25 }),
      govQuery('available_listings', '*', { filter: 'or=(address.ilike.' + like + ',city.ilike.' + like + ',tenant_agency.ilike.' + like + ')', limit: 25 }),
      govQuery('contacts', '*', { filter: 'or=(name.ilike.' + like + ',contact_type.ilike.' + like + ',phone.ilike.' + like + ',email.ilike.' + like + ')', limit: 25 }),
      govQuery('properties', '*', { filter: 'or=(address.ilike.' + like + ',city.ilike.' + like + ',state.ilike.' + like + ',agency.ilike.' + like + ')', limit: 25 })
    ]);

    govSearchResults = {
      ownership: ownership.data || [],
      leads: leads.data || [],
      listings: listings.data || [],
      contacts: contacts.data || [],
      properties: properties.data || []
    };
  } catch (err) {
    console.error('Gov search error:', err);
    govSearchResults = { ownership: [], leads: [], listings: [], contacts: [], properties: [] };
  }

  govSearching = false;
  renderGovTab();
}

// ============================================================================
// EXPORTS
// ============================================================================

// Helper to programmatically navigate to gov sub-tabs
function goToGovTab(tabName) {
  currentGovTab = tabName;
  if (typeof window.syncDomainTabGroup === 'function') {
    window.syncDomainTabGroup('government', tabName);
  } else {
    document.querySelectorAll('#govInnerTabs .gov-inner-tab').forEach(t => t.classList.remove('active'));
    const btn = document.querySelector('[data-gov-tab="' + tabName + '"]');
    if (btn) btn.classList.add('active');
  }
  if (typeof govDataLoaded !== 'undefined' && govDataLoaded) {
    renderGovTab();
  }
}

window.goToGovTab = goToGovTab;
window.renderGovDetailBody = renderGovDetailBody;
window.saveGovDetailLead = saveGovDetailLead;
window.renderGovSearch = renderGovSearch;
window.execGovSearch = execGovSearch;
window.renderGovSales = renderGovSales;
window.renderGovLeases = renderGovLeases;
window.renderGovLoans = renderGovLoans;
window.renderGovPlayers = renderGovPlayers;
window.renderPlayersTable = renderPlayersTable;
window.renderGovOverview = renderGovOverview;









