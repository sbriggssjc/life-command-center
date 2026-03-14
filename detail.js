// ============================================================================
// UNIFIED PROPERTY DETAIL PAGE
// Shared across Gov and Dialysis — fetches from normalized Supabase views
// Loaded after index.html, gov.js, dialysis.js
// ============================================================================

// Cache for the current detail data (avoids re-fetch on tab switch)
let _udCache = null;

/**
 * Open the unified detail panel for any property/clinic.
 * @param {'gov'|'dia'} db - which Supabase project to query
 * @param {object} ids - { property_id, lease_number } lookup keys
 * @param {object} fallback - the raw record from the list (shown while loading)
 */
async function openUnifiedDetail(db, ids, fallback) {
  _udCache = null;
  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');

  // Show panel immediately with loading state
  panel.style.display = 'block';
  overlay.classList.add('open');

  // Render loading header from fallback record
  const title = fallback.page_title ||
    fallback.facility_name ||
    fallback.address ||
    fallback.tenant_agency ||
    fallback.lessor_name ||
    '(Loading...)';
  const loc = (fallback.city || '') + (fallback.city && fallback.state ? ', ' : '') + (fallback.state || '');

  document.getElementById('detailHeader').innerHTML = `
    <div class="detail-header-info">
      <div style="flex:1">
        <div class="detail-title">${esc(title)}</div>
        <div class="detail-subtitle">${esc(loc)}</div>
      </div>
      <span class="detail-badge" style="background:${db === 'gov' ? 'var(--gov-green)' : 'var(--purple)'};color:#fff">${db === 'gov' ? 'GOV' : 'DIA'}</span>
      <button class="detail-close" onclick="closeDetail()">&times;</button>
    </div>`;

  // Render tab bar
  const tabs = ['Property', 'Lease', 'Operations', 'Ownership', 'History'];
  document.getElementById('detailTabs').innerHTML = tabs.map((t, i) =>
    `<button class="detail-tab ${i === 0 ? 'active' : ''}" onclick="switchUnifiedTab('${t}')">${t}</button>`
  ).join('');

  // Show spinner in body
  document.getElementById('detailBody').innerHTML =
    '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading details...</p></div>';

  // Determine query function
  const qFn = db === 'gov' ? govQuery : diaQuery;
  const propertyId = ids.property_id;
  const leaseNumber = ids.lease_number;

  // Build filter — prefer property_id, fall back to lease_number
  const propFilter = propertyId ? `property_id=eq.${propertyId}` : null;
  const leaseFilter = leaseNumber ? `lease_number=eq.${encodeURIComponent(leaseNumber)}` : null;
  const mainFilter = propFilter || leaseFilter;

  if (!mainFilter) {
    document.getElementById('detailBody').innerHTML =
      '<div class="detail-empty">No property identifier available</div>';
    return;
  }

  try {
    // Fetch all views in parallel
    const promises = [
      qFn('v_property_detail', '*', { filter: mainFilter, limit: 1 }),
      qFn('v_lease_detail', '*', { filter: mainFilter, limit: 5 }),
      qFn('v_ownership_current', '*', { filter: propFilter || mainFilter, limit: 1 }),
    ];

    // Ownership chain — Gov uses lease_number, Dia uses property_id
    if (db === 'gov') {
      const chainFilter = leaseNumber ? `lease_number=eq.${encodeURIComponent(leaseNumber)}` : mainFilter;
      promises.push(qFn('v_ownership_chain', '*', { filter: chainFilter, order: 'transfer_date.desc', limit: 50 }));
    } else {
      promises.push(qFn('v_ownership_chain', '*', { filter: propFilter || mainFilter, order: 'transfer_date.desc', limit: 50 }));
    }

    // Rankings only exist in Dia DB
    if (db === 'dia') {
      promises.push(qFn('v_property_rankings', '*', { filter: propFilter || mainFilter, limit: 1 }));
    } else {
      promises.push(Promise.resolve(db === 'gov' ? { data: [], count: 0 } : []));
    }

    const results = await Promise.all(promises);

    // Normalize results — govQuery returns {data,count}, diaQuery returns array
    const extract = (r) => {
      if (Array.isArray(r)) return r;
      if (r && r.data) return r.data;
      return [];
    };

    const property = extract(results[0])[0] || null;
    const leases = extract(results[1]) || [];
    const ownership = extract(results[2])[0] || null;
    const chain = extract(results[3]) || [];
    const rankings = extract(results[4])[0] || null;

    _udCache = { db, ids, property, leases, ownership, chain, rankings, fallback };

    // Update header with real page_title
    if (property && property.page_title) {
      const loc2 = (property.city || '') + (property.state ? ', ' + property.state : '');
      document.getElementById('detailHeader').innerHTML = `
        <div class="detail-header-info">
          <div style="flex:1">
            <div class="detail-title">${esc(property.page_title)}</div>
            <div class="detail-subtitle">${esc(loc2)}${property.county ? ' · ' + esc(property.county) + ' County' : ''}</div>
            ${_udKeyFields(db, property, ownership)}
          </div>
          <span class="detail-badge" style="background:${db === 'gov' ? 'var(--gov-green)' : 'var(--purple)'};color:#fff">${db === 'gov' ? 'GOV' : 'DIA'}</span>
          <button class="detail-close" onclick="closeDetail()">&times;</button>
        </div>`;
    }

    // Render first tab
    document.getElementById('detailBody').innerHTML = _udRenderTab('Property');

  } catch (err) {
    console.error('Unified detail load error:', err);
    document.getElementById('detailBody').innerHTML =
      `<div class="detail-empty">Error loading details: ${esc(err.message)}</div>`;
  }
}

/** Key fields bar under the header */
function _udKeyFields(db, prop, own) {
  let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-top:8px;font-size:12px;">';
  if (prop.address) html += `<div><span style="color:var(--text3)">Address:</span> <span style="color:var(--text)">${esc(prop.address)}</span></div>`;
  if (prop.lease_number) html += `<div><span style="color:var(--text3)">Lease:</span> <span style="color:var(--text);font-family:monospace">${esc(prop.lease_number)}</span></div>`;
  if (prop.agency_short || prop.agency_full) html += `<div><span style="color:var(--text3)">Agency:</span> <span style="color:var(--text)">${esc(prop.agency_short || prop.agency_full)}</span></div>`;
  if (own) {
    const ownerName = own.true_owner || own.recorded_owner || '';
    if (ownerName) html += `<div><span style="color:var(--text3)">Owner:</span> <span style="color:var(--text)">${esc(ownerName)}</span></div>`;
  }
  if (prop.estimated_value) html += `<div><span style="color:var(--text3)">Est. Value:</span> <span style="color:var(--green);font-weight:600">${fmt(prop.estimated_value)}</span></div>`;
  if (prop.deal_grade) html += `<div><span style="color:var(--text3)">Grade:</span> <span style="color:var(--accent);font-weight:600">${esc(prop.deal_grade)}</span></div>`;
  html += '</div>';
  return html;
}

/** Switch tabs without re-fetching data */
function switchUnifiedTab(tabName) {
  if (!_udCache) return;
  document.querySelectorAll('#detailTabs .detail-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.trim() === tabName);
  });
  document.getElementById('detailBody').innerHTML = _udRenderTab(tabName);
}

// ============================================================================
// TAB RENDERERS
// ============================================================================

function _udRenderTab(tab) {
  if (!_udCache) return '<div class="detail-empty">No data loaded</div>';
  switch (tab) {
    case 'Property': return _udTabProperty();
    case 'Lease': return _udTabLease();
    case 'Operations': return _udTabOperations();
    case 'Ownership': return _udTabOwnership();
    case 'History': return _udTabHistory();
    default: return '<div class="detail-empty">Unknown tab</div>';
  }
}

// ─── PROPERTY TAB ────────────────────────────────────────────────────────────

function _udTabProperty() {
  const p = _udCache.property;
  if (!p) return '<div class="detail-empty">No property data available</div>';

  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Property Information</div>';
  html += '<div class="detail-grid">';

  html += _row('Address', p.address);
  html += _row('City / State', (p.city || '') + (p.state ? ', ' + p.state : ''));
  html += _row('County', p.county);
  html += _row('Zip Code', p.zip_code);
  html += _row('Building Size', p.building_sf ? fmtN(p.building_sf) + ' SF' : null);
  html += _row('Land Size', p.land_acres ? Number(p.land_acres).toFixed(2) + ' acres' : null);
  html += _row('Occupancy Type', p.is_single_tenant === true ? 'Single-Tenant' : p.is_single_tenant === false ? 'Multi-Tenant' : null);
  html += _row('Year Built', p.year_built);
  html += _row('Building Type', p.building_type);
  html += _row('Building Condition', p.building_condition);

  // Dialysis-specific
  if (p.number_of_chairs) html += _row('No. of Chairs', fmtN(p.number_of_chairs));
  if (p.stations) html += _row('Stations', fmtN(p.stations));

  html += '</div></div>';

  // Investment section
  if (p.investment_score || p.deal_grade || p.estimated_value) {
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">Investment Summary</div>';
    html += '<div class="detail-grid">';
    html += _row('Investment Score', p.investment_score ? Number(p.investment_score).toFixed(1) : null);
    html += _row('Deal Grade', p.deal_grade);
    html += _rowMoney('Estimated Value', p.estimated_value);
    html += '</div></div>';
  }

  // Government-specific
  if (p.agency_short || p.agency_full || p.government_type) {
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">Government Agency</div>';
    html += '<div class="detail-grid">';
    html += _row('Agency', p.agency_full || p.agency_short);
    html += _row('Short Name', p.agency_short);
    html += _row('Government Type', p.government_type);
    html += '</div></div>';
  }

  // Location risk
  if (p.flood_zone_desc || p.flood_risk_level) {
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">Site Risk</div>';
    html += '<div class="detail-grid">';
    html += _row('Flood Zone', p.flood_zone_desc);
    html += _row('Flood Risk', p.flood_risk_level);
    html += '</div></div>';
  }

  return html;
}

// ─── LEASE TAB ───────────────────────────────────────────────────────────────

function _udTabLease() {
  const leases = _udCache.leases;
  if (!leases || leases.length === 0) return '<div class="detail-empty">No lease data available</div>';

  let html = '';

  leases.forEach((l, idx) => {
    const isOnly = leases.length === 1;
    html += '<div class="detail-section">';
    html += `<div class="detail-section-title">${isOnly ? 'Lease Details' : 'Lease ' + (idx + 1)}</div>`;
    html += '<div class="detail-grid">';

    html += _row('Tenant', l.tenant);
    html += _row('Guarantor', l.guarantor);
    html += _row('Guarantor Type', l.guarantor_type);
    html += _row('Original Occupancy', _fmtDate(l.original_occupancy));
    html += _row('Lease Start', _fmtDate(l.lease_start));
    html += _row('Last Extension', _fmtDate(l.last_extension_date));
    html += _row('No. of Extensions', l.extension_count != null ? fmtN(Number(l.extension_count)) : null);
    html += _row('Expiration', _fmtDate(l.lease_expiration));
    html += _row('Termination', _fmtDate(l.termination_date));
    html += _row('Initial Term', l.initial_term_years ? Number(l.initial_term_years).toFixed(1) + ' yrs' : null);
    html += _row('Total Term', l.total_term_years ? Number(l.total_term_years).toFixed(1) + ' yrs' : null);
    html += _row('Term Remaining', l.term_remaining_years != null ? Number(l.term_remaining_years).toFixed(1) + ' yrs' : null);
    html += _row('No. of Renewals', l.num_renewals);
    html += _rowMoney('Annual Rent', l.annual_rent);
    html += _rowMoney('Rent / SF', l.rent_psf);
    html += _rowMoney('Future Rent / SF', l.future_rent_psf);
    html += _row('Rent CAGR', l.rent_cagr ? (Number(l.rent_cagr) * 100).toFixed(2) + '%' : null);
    html += _row('Expense Structure', l.expense_structure);
    html += _row('Lease Structure', l.lease_structure);
    html += _row('Renewal Options', l.renewal_options);

    // Flags
    const flags = [];
    if (l.is_renewed) flags.push('Renewed');
    if (l.is_first_generation) flags.push('1st Gen');
    if (l.is_superseding) flags.push('Superseding');
    if (flags.length) html += _row('Flags', flags.join(' · '));

    html += _row('Data Source', l.data_source);
    html += '</div></div>';
  });

  return html;
}

// ─── OPERATIONS TAB ──────────────────────────────────────────────────────────

function _udTabOperations() {
  const db = _udCache.db;
  const rankings = _udCache.rankings;

  // Gov properties don't have operational metrics
  if (db === 'gov') {
    return '<div class="detail-empty" style="text-align:center;padding:32px">' +
      '<div style="font-size:32px;margin-bottom:12px">&#x1F3DB;</div>' +
      '<div style="color:var(--text2)">Government properties do not have clinic operational metrics.</div>' +
      '<div style="color:var(--text3);margin-top:8px;font-size:13px">Lease performance data is available on the Lease tab.</div>' +
      '</div>';
  }

  if (!rankings) return '<div class="detail-empty">No operational data available</div>';

  const r = rankings;
  let html = '';

  // Patient metrics
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Patient Metrics</div>';
  html += '<div class="detail-grid">';
  html += _row('Current Patients', r.latest_estimated_patients ? fmtN(r.latest_estimated_patients) : null);
  html += _row('Last Year', r.patients_last_year ? fmtN(r.patients_last_year) : null);
  html += _row('Two Years Ago', r.patients_two_years_ago ? fmtN(r.patients_two_years_ago) : null);
  html += _row('3-Yr Trend', r.patient_trend_3yr != null ? (Number(r.patient_trend_3yr) > 0 ? '+' : '') + Number(r.patient_trend_3yr).toFixed(1) + '%' : null);
  html += _row('Max Capacity', r.max_patient_capacity ? fmtN(r.max_patient_capacity) : null);
  html += _row('Utilization', r.capacity_utilization_pct != null ? Number(r.capacity_utilization_pct).toFixed(1) + '%' : null);
  html += _row('Chairs', r.number_of_chairs ? fmtN(r.number_of_chairs) : null);
  html += _row('Stations', r.stations ? fmtN(r.stations) : null);
  html += '</div></div>';

  // Financial metrics
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Financial (TTM)</div>';
  html += '<div class="detail-grid">';
  html += _rowMoney('Revenue', r.ttm_revenue);
  html += _rowMoney('Operating Costs', r.ttm_operating_costs);
  html += _rowMoney('Operating Profit', r.ttm_operating_profit);
  html += _row('Operating Margin', r.ttm_operating_margin != null ? Number(r.ttm_operating_margin).toFixed(1) + '%' : null);
  html += '</div></div>';

  // Treatment mix
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Treatment Mix (TTM)</div>';
  html += '<div class="detail-grid">';
  html += _row('Total Treatments', r.ttm_total_treatments ? fmtN(r.ttm_total_treatments) : null);
  html += _row('Medicare Treatments', r.ttm_medicare_treatments ? fmtN(r.ttm_medicare_treatments) : null);
  html += _row('Commercial Treatments', r.ttm_commercial_treatments ? fmtN(r.ttm_commercial_treatments) : null);
  html += '</div></div>';

  // Payer mix
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Payer Mix</div>';
  html += '<div class="detail-grid">';
  html += _row('Medicare %', r.payer_mix_medicare_pct != null ? Number(r.payer_mix_medicare_pct).toFixed(1) + '%' : null);
  html += _row('Medicaid %', r.payer_mix_medicaid_pct != null ? Number(r.payer_mix_medicaid_pct).toFixed(1) + '%' : null);
  html += _row('Private %', r.payer_mix_private_pct != null ? Number(r.payer_mix_private_pct).toFixed(1) + '%' : null);
  html += '</div></div>';

  // Quality
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Quality & Compliance</div>';
  html += '<div class="detail-grid">';
  html += _row('Star Rating', r.star_rating != null ? _stars(Number(r.star_rating)) : null);
  html += _row('Deficiency Count', r.deficiency_count != null ? fmtN(r.deficiency_count) : null);
  html += _row('Profit/Non-Profit', r.profit_nonprofit);
  html += '</div></div>';

  // Operator
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Operator</div>';
  html += '<div class="detail-grid">';
  html += _row('Operator', r.operator_name);
  html += _row('Chain Organization', r.chain_organization);
  html += '</div></div>';

  // Rankings
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Comparative Rankings</div>';
  html += _rankingBar('County (Patients)', r.county_patient_rank, r.county_total, r.county);
  html += _rankingBar('State (Patients)', r.state_patient_rank, r.state_total, r.state);
  html += _rankingBar('National (Patients)', r.national_patient_rank, r.national_total);
  html += _rankingBar('Operator (Patients)', r.operator_patient_rank, r.operator_total, r.operator_name);
  if (r.state_revenue_rank) {
    html += _rankingBar('State (Revenue)', r.state_revenue_rank, r.state_total, r.state);
  }
  html += '</div>';

  return html;
}

/** Render a ranking bar with visual indicator */
function _rankingBar(label, rank, total, context) {
  if (!rank || !total) return '';
  const pct = ((total - rank + 1) / total * 100).toFixed(0);
  const color = pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : pct >= 25 ? 'var(--orange)' : 'var(--red)';
  return `
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:12px;color:var(--text2)">${esc(label)}${context ? ' · ' + esc(String(context)) : ''}</span>
        <span style="font-size:13px;font-weight:600;color:${color}">#${fmtN(Number(rank))} of ${fmtN(Number(total))}</span>
      </div>
      <div style="background:var(--s2);border-radius:4px;height:6px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s"></div>
      </div>
      <div style="text-align:right;font-size:11px;color:var(--text3);margin-top:2px">Top ${100 - Number(pct)}%</div>
    </div>`;
}

// ─── OWNERSHIP + CRM TAB ────────────────────────────────────────────────────

function _udTabOwnership() {
  const own = _udCache.ownership;
  const db = _udCache.db;

  let html = '';

  if (!own) {
    html += '<div class="detail-empty">No ownership data available</div>';
  } else {
    // Current ownership
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">Current Ownership</div>';
    html += '<div class="detail-grid">';

    if (db === 'dia') {
      html += _row('Recorded Owner', own.recorded_owner);
      html += _row('True Owner', own.true_owner);
      html += _row('Owner Type', own.owner_type);
      html += _row('Address', own.recorded_owner_address);
      html += _row('City', own.recorded_owner_city);
      html += _row('State', own.recorded_owner_state);
      html += _row('True Owner City', own.true_owner_city);
      html += _row('True Owner State', own.true_owner_state);
      html += _row('Contact 1', own.contact_1_name);
      html += _row('Contact 2', own.contact_2_name);
      html += _rowLink('Email', own.contact_email, own.contact_email ? 'mailto:' + own.contact_email : null);
      html += _rowLink('Phone', own.contact_phone, own.contact_phone ? 'tel:' + own.contact_phone : null);
      html += _row('Priority', own.priority_level);
      html += _row('Developer', own.developer_flag ? 'Yes' + (own.developer_tier ? ' · Tier ' + own.developer_tier : '') : null);
      html += _row('Total Properties', own.total_properties_owned ? fmtN(own.total_properties_owned) : null);
      html += _row('Current Count', own.current_property_count ? fmtN(own.current_property_count) : null);
      html += _row('Is Prospect', own.is_prospect ? 'Yes' : 'No');
    } else {
      // Gov
      html += _row('Recorded Owner', own.recorded_owner);
      html += _row('Type', own.recorded_owner_type);
      html += _row('State', own.recorded_owner_state);
      html += _row('True Owner', own.true_owner);
      html += _row('True Owner Type', own.true_owner_type);
      html += _row('True Owner State', own.true_owner_state);
      html += _row('Contact', own.contact_name);
      html += _rowLink('Email', own.contact_email, own.contact_email ? 'mailto:' + own.contact_email : null);
      html += _rowLink('Phone', own.contact_phone, own.contact_phone ? 'tel:' + own.contact_phone : null);
    }
    html += '</div></div>';

    // Notes
    if (own.latest_note_summary) {
      html += '<div class="detail-section">';
      html += '<div class="detail-section-title">Latest Notes</div>';
      html += `<div class="detail-notes">${esc(own.latest_note_summary)}</div>`;
      html += '</div>';
    }
  }

  // CRM Actions
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">CRM Actions</div>';
  html += '<div class="detail-actions">';

  const logCallData = {
    sf_contact_id: own?.salesforce_id || own?.sf_contact_id || '',
    sf_company_id: own?.sf_company_id || '',
    name: own?.true_owner || own?.recorded_owner || own?.contact_1_name || ''
  };
  html += `<button class="act-btn primary" onclick="closeDetail();openLogCall(${JSON.stringify(logCallData).replace(/'/g,"&#39;")})">&#x260E; Log Call</button>`;
  if (own?.contact_phone) html += `<a href="tel:${esc(own.contact_phone)}" class="act-btn">&#x1F4DE; Call</a>`;
  if (own?.contact_email) html += `<a href="mailto:${esc(own.contact_email)}" class="act-btn">&#x2709; Email</a>`;
  html += '</div></div>';

  // Salesforce Activity Feed
  _loadActivityFeed(own);

  html += '<div id="udActivityFeed"><div style="text-align:center;padding:24px;color:var(--text3)"><span class="spinner"></span> Loading activity feed...</div></div>';

  return html;
}

/** Async load of SF activity feed (inserted into DOM after tab renders) */
async function _loadActivityFeed(own) {
  // Small delay to ensure DOM is ready
  await new Promise(r => setTimeout(r, 50));

  const feedEl = document.getElementById('udActivityFeed');
  if (!feedEl) return;

  const db = _udCache.db;

  try {
    let activities = [];

    if (db === 'dia') {
      // Direct query — Dia DB has the SF tables
      const sfId = own?.salesforce_id;
      const toId = own?.true_owner_id;
      const cId = own?.contact_id;

      // Try sf_contact_id first, then true_owner_id
      if (sfId) {
        activities = await diaQuery('v_sf_activity_feed', '*', {
          filter: `sf_contact_id=eq.${sfId}`,
          order: 'activity_date.desc',
          limit: 25
        });
      } else if (toId) {
        activities = await diaQuery('v_sf_activity_feed', '*', {
          filter: `true_owner_id=eq.${toId}`,
          order: 'activity_date.desc',
          limit: 25
        });
      } else if (cId) {
        activities = await diaQuery('v_sf_activity_feed', '*', {
          filter: `contact_id=eq.${cId}`,
          order: 'activity_date.desc',
          limit: 25
        });
      }
    } else {
      // Gov cross-DB bridge: use sf_contact_id from v_ownership_current to query Dia DB
      const sfId = own?.sf_contact_id;
      if (sfId) {
        activities = await diaQuery('v_sf_activity_feed', '*', {
          filter: `sf_contact_id=eq.${sfId}`,
          order: 'activity_date.desc',
          limit: 25
        });
      }
    }

    if (!activities || activities.length === 0) {
      feedEl.innerHTML = '<div class="detail-section"><div class="detail-section-title">Salesforce Activity Feed</div><div class="detail-empty">No CRM activity found for this owner</div></div>';
      return;
    }

    let html = '<div class="detail-section">';
    html += `<div class="detail-section-title">Salesforce Activity Feed <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:8px">${activities.length} activities</span></div>`;

    activities.forEach(a => {
      const typeColor = a.feed_type === 'task' ? 'var(--yellow)' :
                        a.feed_type === 'call_outcome' ? 'var(--green)' : 'var(--accent)';
      html += '<div class="detail-card">';
      html += '<div class="detail-card-header">';
      html += `<div class="detail-card-title">${esc(a.subject || a.activity_type || 'Activity')}</div>`;
      html += `<div class="detail-card-date">${esc(_fmtDate(a.activity_date))}</div>`;
      html += '</div>';
      html += '<div class="detail-card-body">';
      html += `<span style="display:inline-block;font-size:10px;padding:2px 6px;border-radius:4px;background:${typeColor};color:#fff;margin-bottom:4px">${esc(a.feed_type || '')}</span>`;
      if (a.activity_type) html += ` <span style="font-size:12px;color:var(--text2)">${esc(a.activity_type)}</span>`;
      if (a.status) html += `<br><span style="font-size:12px;color:var(--text3)">Status: ${esc(a.status)}</span>`;
      if (a.assigned_to) html += `<br><span style="font-size:12px;color:var(--text3)">Assigned: ${esc(a.assigned_to)}</span>`;
      if (a.notes) html += `<br><span style="font-size:12px;color:var(--text2);white-space:pre-wrap">${esc(a.notes.substring(0, 200))}${a.notes.length > 200 ? '...' : ''}</span>`;
      html += '</div></div>';
    });

    html += '</div>';
    feedEl.innerHTML = html;

  } catch (err) {
    console.error('Activity feed error:', err);
    feedEl.innerHTML = '<div class="detail-section"><div class="detail-section-title">Salesforce Activity Feed</div><div class="detail-empty">Error loading activity feed</div></div>';
  }
}

// ─── HISTORY TAB ─────────────────────────────────────────────────────────────

function _udTabHistory() {
  const chain = _udCache.chain;
  const db = _udCache.db;

  if (!chain || chain.length === 0) {
    return '<div class="detail-empty">No ownership history available</div>';
  }

  let html = '<div class="detail-section">';
  html += `<div class="detail-section-title">Ownership History <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:8px">${chain.length} records</span></div>`;
  html += '<div class="detail-timeline">';

  chain.forEach((h, idx) => {
    const isFirst = idx === 0;
    const statusClass = isFirst ? 'green' : '';

    html += `<div class="detail-timeline-item ${statusClass}">`;
    html += `<div class="detail-card-date">${esc(_fmtDate(h.transfer_date) || 'Unknown date')}</div>`;

    if (db === 'gov') {
      html += `<div class="detail-card-title">${esc(h.to_owner || '—')}</div>`;
      html += '<div class="detail-card-body">';
      if (h.from_owner) html += `<span style="font-size:12px;color:var(--text3)">From:</span> ${esc(h.from_owner)}<br>`;
      if (h.sale_price) html += `Sale: <span class="mono" style="color:var(--green)">${fmt(h.sale_price)}</span><br>`;
      if (h.cap_rate) html += `Cap Rate: ${Number(h.cap_rate).toFixed(2)}%<br>`;
      if (h.annual_rent) html += `Rent: ${fmt(h.annual_rent)}<br>`;
      if (h.square_feet) html += `SF: ${fmtN(h.square_feet)}<br>`;
      if (h.recorded_owner_name) html += `<span style="font-size:12px;color:var(--text3)">Recorded:</span> ${esc(h.recorded_owner_name)}<br>`;
      if (h.true_owner_name) html += `<span style="font-size:12px;color:var(--text3)">True Owner:</span> ${esc(h.true_owner_name)}<br>`;
      if (h.principal_names) html += `<span style="font-size:12px;color:var(--text3)">Principals:</span> ${esc(h.principal_names)}<br>`;
      if (h.research_status) html += `<span class="detail-badge">${esc(cleanLabel(h.research_status))}</span>`;
      html += '</div>';
    } else {
      // Dia
      const ownerLabel = h.recorded_owner_name || h.true_owner_name || '—';
      html += `<div class="detail-card-title">${esc(ownerLabel)}</div>`;
      html += '<div class="detail-card-body">';
      if (h.true_owner_name && h.recorded_owner_name && h.true_owner_name !== h.recorded_owner_name) {
        html += `<span style="font-size:12px;color:var(--text3)">True Owner:</span> ${esc(h.true_owner_name)}<br>`;
      }
      if (h.sale_price) html += `Sale: <span class="mono" style="color:var(--green)">${fmt(h.sale_price)}</span><br>`;
      if (h.cap_rate) html += `Cap Rate: ${Number(h.cap_rate).toFixed(2)}%<br>`;
      if (h.rent) html += `Rent: ${fmt(h.rent)}<br>`;
      if (h.ownership_type) html += `<span style="font-size:12px;color:var(--text3)">Type:</span> ${esc(h.ownership_type)}<br>`;
      if (h.ownership_source) html += `<span style="font-size:12px;color:var(--text3)">Source:</span> ${esc(h.ownership_source)}<br>`;
      if (h.ownership_end) html += `<span style="font-size:12px;color:var(--text3)">End:</span> ${esc(_fmtDate(h.ownership_end))}<br>`;
      html += '</div>';
    }
    html += '</div>';
  });

  html += '</div></div>';
  return html;
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

function _row(label, value) {
  if (value == null || value === '' || value === '—') return '';
  return `<div class="detail-row">
    <div class="detail-lbl">${esc(label)}</div>
    <div class="detail-val">${esc(String(value))}</div>
  </div>`;
}

function _rowMoney(label, value) {
  if (value == null) return '';
  return `<div class="detail-row">
    <div class="detail-lbl">${esc(label)}</div>
    <div class="detail-val money">${fmt(value)}</div>
  </div>`;
}

function _rowLink(label, text, href) {
  if (!text) return '';
  const display = esc(String(text));
  const link = href ? `<a href="${esc(href)}">${display}</a>` : display;
  return `<div class="detail-row">
    <div class="detail-lbl">${esc(label)}</div>
    <div class="detail-val">${link}</div>
  </div>`;
}

function _fmtDate(d) {
  if (!d) return '—';
  try {
    const date = new Date(d);
    if (isNaN(date)) return String(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) { return String(d); }
}

function _stars(n) {
  if (n == null) return '—';
  const full = Math.floor(n);
  const half = n - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '<span style="color:var(--yellow);letter-spacing:2px">' +
    '&#9733;'.repeat(full) +
    (half ? '&#9734;' : '') +
    '<span style="color:var(--text3)">' + '&#9734;'.repeat(empty) + '</span>' +
    '</span> <span style="font-size:12px;color:var(--text2)">' + n.toFixed(1) + '</span>';
}

// ============================================================================
// BRIDGE: Extract IDs from existing record objects and open unified detail
// ============================================================================

/**
 * Called from existing onclick handlers.
 * Extracts property_id and lease_number from any record shape and opens unified detail.
 */
function showUnifiedDetail(record, source) {
  const db = source.startsWith('gov') ? 'gov' : 'dia';

  const ids = {
    property_id: record.property_id || null,
    lease_number: record.lease_number || null
  };

  openUnifiedDetail(db, ids, record);
}

// Expose to global scope
window.openUnifiedDetail = openUnifiedDetail;
window.switchUnifiedTab = switchUnifiedTab;
window.showUnifiedDetail = showUnifiedDetail;
