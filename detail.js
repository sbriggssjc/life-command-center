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
    fallback.tenant_operator ||
    fallback.agency ||
    fallback.address ||
    fallback.tenant_agency ||
    fallback.lessor_name ||
    '(Loading...)';
  const loc = (fallback.city || '') + (fallback.city && fallback.state ? ', ' : '') + (fallback.state || '');

  document.getElementById('detailHeader').innerHTML = `
    <button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>
    <div class="detail-header-info">
      <div style="flex:1;min-width:0">
        <div class="detail-title">${esc(title)}</div>
        <div class="detail-subtitle">${esc(loc)}</div>
      </div>
      <span class="detail-badge" style="background:${db === 'gov' ? 'var(--gov-green)' : 'var(--purple)'};color:#fff">${db === 'gov' ? 'GOV' : 'DIA'}</span>
    </div>
    <button class="detail-close" onclick="closeDetail()">&times;</button>`;

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
  let propertyId = ids.property_id;
  const leaseNumber = ids.lease_number;

  // For Dialysis clinics without property_id, resolve via medicare_clinics
  if (!propertyId && db === 'dia' && fallback.clinic_id) {
    try {
      const mcRes = await diaQuery('medicare_clinics', 'property_id', {
        filter: `medicare_id=eq.${encodeURIComponent(fallback.clinic_id)}`,
        limit: 1
      });
      const mcArr = Array.isArray(mcRes) ? mcRes : (mcRes?.data || []);
      if (mcArr.length && mcArr[0].property_id) {
        propertyId = mcArr[0].property_id;
      }
    } catch (e) { console.warn('clinic→property lookup failed', e); }
  }

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
      propFilter ? qFn('v_ownership_current', '*', { filter: propFilter, limit: 1 }) : Promise.resolve({ data: [], count: 0 }),
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

    // Update header with real data (page_title or fallback to tenant/address)
    if (property) {
      const realTitle = property.page_title || property.facility_name || fallback.tenant_operator || fallback.agency || property.address || fallback.address || '(Unknown)';
      const loc2 = (property.city || '') + (property.state ? ', ' + property.state : '');
      document.getElementById('detailHeader').innerHTML = `
        <div class="detail-header-info">
          <div style="flex:1">
            <div class="detail-title">${esc(realTitle)}</div>
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

  // ── RESEARCH QUICK LINKS ──────────────────────────────────────────────────
  html += _udResearchLinks();

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
    html += _row('Term Remaining', l.term_remaining_years != null ? (Number(l.term_remaining_years) < 0 ? '<span style="color:var(--red)">Expired</span>' : Number(l.term_remaining_years).toFixed(1) + ' yrs') : null);
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

  // ── KPI SUMMARY CARDS ──
  const kpis = [];
  if (r.latest_estimated_patients) kpis.push({ label: 'Patients', value: fmtN(r.latest_estimated_patients), trend: _trendArrow(r.patient_yoy_pct, 'YoY'), sub: r.patient_vs_3yr_avg_pct != null ? _trendBadge(r.patient_vs_3yr_avg_pct, 'vs 3yr avg') : '' });
  if (r.ttm_revenue) kpis.push({ label: 'Revenue (TTM)', value: '$' + _fmtCompact(r.ttm_revenue), trend: r.estimated_annual_revenue ? _trendCompare(r.ttm_revenue, r.estimated_annual_revenue, 'vs Est') : '', sub: '' });
  if (r.ttm_operating_profit) kpis.push({ label: 'Oper. Profit', value: '$' + _fmtCompact(r.ttm_operating_profit), trend: r.ttm_operating_margin != null ? '<span style="font-size:11px;color:' + (Number(r.ttm_operating_margin) >= 12 ? 'var(--green)' : Number(r.ttm_operating_margin) >= 0 ? 'var(--yellow)' : 'var(--red)') + '">' + Number(r.ttm_operating_margin).toFixed(1) + '% margin</span>' : '', sub: '' });
  if (r.capacity_utilization_pct != null) kpis.push({ label: 'Utilization', value: Number(r.capacity_utilization_pct).toFixed(0) + '%', trend: '<span style="font-size:11px;color:' + (Number(r.capacity_utilization_pct) >= 85 ? 'var(--green)' : Number(r.capacity_utilization_pct) >= 65 ? 'var(--yellow)' : 'var(--red)') + '">' + (Number(r.capacity_utilization_pct) >= 85 ? 'High' : Number(r.capacity_utilization_pct) >= 65 ? 'Moderate' : 'Low') + '</span>', sub: '' });

  if (kpis.length > 0) {
    html += '<div style="display:grid;grid-template-columns:repeat(' + Math.min(kpis.length, 4) + ',1fr);gap:10px;margin-bottom:16px">';
    kpis.forEach(k => {
      html += '<div style="background:var(--s2);border-radius:10px;padding:12px 14px;text-align:center">';
      html += '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">' + esc(k.label) + '</div>';
      html += '<div style="font-size:20px;font-weight:700;color:var(--text1)">' + k.value + '</div>';
      if (k.trend) html += '<div style="margin-top:4px">' + k.trend + '</div>';
      if (k.sub) html += '<div style="margin-top:2px">' + k.sub + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  // ── CLINIC INFRASTRUCTURE ──
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Clinic Infrastructure</div>';
  html += '<div class="detail-grid">';
  html += _row('Chairs', r.number_of_chairs ? fmtN(r.number_of_chairs) : null);
  html += _row('Stations', r.stations ? fmtN(r.stations) : null);
  html += _row('Estimated Capacity', r.estimated_capacity ? fmtN(r.estimated_capacity) + ' patients' : (r.max_patient_capacity ? fmtN(r.max_patient_capacity) + ' patients' : null));
  html += _row('Current Patients', r.latest_estimated_patients ? fmtN(r.latest_estimated_patients) : null);
  html += _row('Utilization', r.capacity_utilization_pct != null ? _utilBar(Number(r.capacity_utilization_pct)) : null);
  // Derived KPIs
  if (r.latest_estimated_patients && r.number_of_chairs) {
    html += _row('Patients / Chair', (Number(r.latest_estimated_patients) / Number(r.number_of_chairs)).toFixed(1));
  }
  html += '</div></div>';

  // ── PATIENT TRENDS ──
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Patient Trends</div>';
  html += '<div class="detail-grid">';
  html += _row('Current Patients', r.latest_estimated_patients ? fmtN(r.latest_estimated_patients) : null);
  if (r.patients_last_year) html += _rowTrend('Last Year', fmtN(r.patients_last_year), r.patient_yoy_pct);
  if (r.patients_two_years_ago) html += _row('Two Years Ago', fmtN(r.patients_two_years_ago));
  if (r.patient_3yr_avg) html += _rowTrend('3-Year Average', fmtN(r.patient_3yr_avg), r.patient_vs_3yr_avg_pct);
  if (r.patient_trend_3yr != null) html += _row('3-Yr Trend', _trendArrow(r.patient_trend_3yr));
  html += '</div></div>';

  // ── FINANCIAL (TTM) ──
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Financial Performance (TTM)</div>';
  html += '<div class="detail-grid">';
  html += _rowMoney('Revenue', r.ttm_revenue);
  html += _rowMoney('Operating Costs', r.ttm_operating_costs);
  html += _rowMoney('Operating Profit', r.ttm_operating_profit);
  html += _row('Operating Margin', r.ttm_operating_margin != null ? _marginBadge(Number(r.ttm_operating_margin)) : null);
  // Revenue per patient & per chair
  if (r.ttm_revenue && r.latest_estimated_patients) {
    html += _rowMoney('Revenue / Patient', Math.round(Number(r.ttm_revenue) / Number(r.latest_estimated_patients)));
  }
  if (r.ttm_revenue && r.number_of_chairs) {
    html += _rowMoney('Revenue / Chair', Math.round(Number(r.ttm_revenue) / Number(r.number_of_chairs)));
  }
  html += '</div></div>';

  // ── FINANCIAL ESTIMATES ──
  if (r.estimated_annual_revenue || r.estimated_annual_profit || r.estimated_weekly_revenue) {
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">Financial Estimates</div>';
    html += '<div class="detail-grid">';
    html += _rowMoney('Est. Annual Revenue', r.estimated_annual_revenue);
    html += _rowMoney('Est. Annual Profit', r.estimated_annual_profit);
    html += _rowMoney('Est. Weekly Revenue', r.estimated_weekly_revenue);
    html += _rowMoney('Est. Weekly Profit', r.estimated_weekly_profit);
    html += _rowMoney('Max Annual Revenue', r.max_annual_revenue);
    if (r.ttm_revenue && r.estimated_annual_revenue) {
      const pctDiff = ((Number(r.ttm_revenue) - Number(r.estimated_annual_revenue)) / Number(r.estimated_annual_revenue) * 100).toFixed(1);
      html += _row('TTM vs Estimate', _trendArrow(pctDiff, 'variance'));
    }
    if (r.revenue_calc_method) html += _row('Calc Method', r.revenue_calc_method);
    html += '</div></div>';
  }

  // ── TREATMENT MIX ──
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Treatment Mix (TTM)</div>';
  html += '<div class="detail-grid">';
  html += _row('Total Treatments', r.ttm_total_treatments ? fmtN(r.ttm_total_treatments) : null);
  html += _row('Medicare Treatments', r.ttm_medicare_treatments ? fmtN(r.ttm_medicare_treatments) : null);
  html += _row('Commercial Treatments', r.ttm_commercial_treatments ? fmtN(r.ttm_commercial_treatments) : null);
  if (r.estimated_annual_treatments) html += _row('Est. Annual Treatments', fmtN(r.estimated_annual_treatments));
  if (r.estimated_treatments_per_week) html += _row('Est. Treatments/Week', fmtN(r.estimated_treatments_per_week));
  html += '</div></div>';

  // ── PAYER MIX ──
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Payer Mix</div>';
  html += '<div class="detail-grid">';
  html += _row('Medicare %', r.payer_mix_medicare_pct != null ? Number(r.payer_mix_medicare_pct).toFixed(1) + '%' : null);
  html += _row('Medicaid %', r.payer_mix_medicaid_pct != null ? Number(r.payer_mix_medicaid_pct).toFixed(1) + '%' : null);
  html += _row('Private %', r.payer_mix_private_pct != null ? Number(r.payer_mix_private_pct).toFixed(1) + '%' : null);
  html += '</div></div>';

  // ── QUALITY ──
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Quality & Compliance</div>';
  html += '<div class="detail-grid">';
  html += _row('Star Rating', r.star_rating != null ? _stars(Number(r.star_rating)) : null);
  html += _row('Deficiency Count', r.deficiency_count != null ? fmtN(r.deficiency_count) : null);
  html += _row('Profit/Non-Profit', r.profit_nonprofit);
  html += '</div></div>';

  // ── OPERATOR ──
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Operator</div>';
  html += '<div class="detail-grid">';
  html += _row('Operator', r.operator_name);
  html += _row('Chain Organization', r.chain_organization);
  html += '</div></div>';

  // ── COMPARATIVE RANKINGS ──
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Comparative Rankings (Patients)</div>';
  html += _rankingBar('County', r.county_patient_rank, r.county_total, r.county);
  html += _rankingBar('State', r.state_patient_rank, r.state_total, r.state);
  html += _rankingBar('National', r.national_patient_rank, r.national_total);
  html += _rankingBar('Operator', r.operator_patient_rank, r.operator_total, r.operator_name);
  html += '</div>';

  // Revenue rankings
  if (r.state_revenue_rank || r.county_revenue_rank) {
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">Comparative Rankings (Revenue)</div>';
    html += _rankingBar('County', r.county_revenue_rank, r.county_total, r.county);
    html += _rankingBar('State', r.state_revenue_rank, r.state_total, r.state);
    html += _rankingBar('National', r.national_revenue_rank, r.national_total);
    html += '</div>';
  }

  return html;
}

/** Format large numbers compactly ($1.2M, $450K) */
function _fmtCompact(n) {
  const v = Number(n);
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return fmtN(v);
}

/** Trend arrow with optional label */
function _trendArrow(pct, label) {
  if (pct == null) return '';
  const v = Number(pct);
  const arrow = v > 0 ? '&#9650;' : v < 0 ? '&#9660;' : '&#9654;';
  const color = v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text3)';
  return '<span style="font-size:12px;color:' + color + '">' + arrow + ' ' + (v > 0 ? '+' : '') + v.toFixed(1) + '%' + (label ? ' <span style="color:var(--text3)">' + esc(label) + '</span>' : '') + '</span>';
}

/** Trend badge (colored pill) */
function _trendBadge(pct, label) {
  if (pct == null) return '';
  const v = Number(pct);
  const color = v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text3)';
  return '<span style="display:inline-block;font-size:10px;padding:1px 6px;border-radius:8px;background:' + color + '22;color:' + color + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '% ' + esc(label) + '</span>';
}

/** Compare TTM to estimated with trend arrow */
function _trendCompare(actual, estimate, label) {
  const diff = ((Number(actual) - Number(estimate)) / Number(estimate) * 100).toFixed(1);
  return _trendArrow(diff, label);
}

/** Row with trend indicator */
function _rowTrend(label, value, pctChange) {
  if (!value) return '';
  return '<div class="detail-row"><span class="detail-label">' + esc(label) + '</span><span class="detail-value">' + value + (pctChange != null ? ' ' + _trendArrow(pctChange) : '') + '</span></div>';
}

/** Utilization bar with color coding */
function _utilBar(pct) {
  const color = pct >= 85 ? 'var(--green)' : pct >= 65 ? 'var(--yellow)' : 'var(--red)';
  return '<span style="display:inline-flex;align-items:center;gap:8px">' + pct.toFixed(1) + '%' +
    '<span style="display:inline-block;width:60px;height:6px;background:var(--s2);border-radius:3px;overflow:hidden;vertical-align:middle">' +
    '<span style="display:block;width:' + Math.min(pct, 100) + '%;height:100%;background:' + color + ';border-radius:3px"></span></span></span>';
}

/** Margin badge with color */
function _marginBadge(margin) {
  const color = margin >= 12 ? 'var(--green)' : margin >= 0 ? 'var(--yellow)' : 'var(--red)';
  return '<span style="color:' + color + ';font-weight:600">' + margin.toFixed(1) + '%</span>';
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
  const chain = _udCache.chain || [];
  const db = _udCache.db;

  let html = '';

  // ── DATA GAP INDICATOR ──────────────────────────────────────────────
  const gaps = [];
  if (!own) gaps.push('ownership record');
  else {
    if (!own.true_owner && !own.recorded_owner) gaps.push('owner name');
    if (!own.contact_email) gaps.push('contact email');
    if (!own.contact_phone) gaps.push('contact phone');
    if (!own.contact_name && !own.contact_1_name) gaps.push('contact name');
    if (!own.sf_contact_id && !own.salesforce_id) gaps.push('Salesforce link');
    if (db === 'gov' && !own.true_owner) gaps.push('true owner (behind LLC)');
    if (db === 'gov' && !own.true_owner_state) gaps.push('true owner state');
  }
  if (chain.length === 0) gaps.push('ownership history');

  if (gaps.length > 0) {
    html += '<div style="background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.3); border-radius: 10px; padding: 12px 16px; margin-bottom: 16px;">';
    html += '<div style="font-size: 12px; font-weight: 600; color: var(--yellow); margin-bottom: 4px;">Data Gaps (' + gaps.length + ')</div>';
    html += '<div style="font-size: 12px; color: var(--text2); line-height: 1.6;">';
    html += gaps.map(g => '<span style="display:inline-block;background:var(--s2);padding:2px 8px;border-radius:4px;margin:2px 4px 2px 0;font-size:11px;">' + esc(g) + '</span>').join('');
    html += '</div></div>';
  }

  // ── CURRENT OWNERSHIP ──────────────────────────────────────────────
  if (!own) {
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">Current Ownership</div>';
    html += '<div class="detail-empty">No ownership record found. Use Research Quick Links to identify the owner and log it below.</div>';
    html += '</div>';
  } else {
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
      html += _rowLink('Email', own.contact_email, own.contact_email ? _outlookSearchUrl(own.contact_email) : null);
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
      html += _rowLink('Email', own.contact_email, own.contact_email ? _outlookSearchUrl(own.contact_email) : null);
      html += _rowLink('Phone', own.contact_phone, own.contact_phone ? 'tel:' + own.contact_phone : null);
    }
    html += '</div></div>';

    // ── SALESFORCE + SYSTEM LINKS ──────────────────────────────────────────
    html += _udSystemLinks(own);

    // Notes
    if (own.latest_note_summary) {
      html += '<div class="detail-section">';
      html += '<div class="detail-section-title">Latest Notes</div>';
      html += `<div class="detail-notes">${esc(own.latest_note_summary)}</div>`;
      html += '</div>';
    }
  }

  // ── RESOLVE OWNERSHIP FORM ──────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Resolve Ownership</div>';
  html += '<div style="font-size:11px;color:var(--text3);margin-bottom:10px">Update or create the ownership record for this property. Traces the chain back to the developer.</div>';

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Recorded Owner</label>';
  html += `<input id="udOwnRecorded" type="text" value="${esc(own?.recorded_owner || '')}" placeholder="Entity name on deed" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>`;
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">True Owner / Developer</label>';
  html += `<input id="udOwnTrue" type="text" value="${esc(own?.true_owner || '')}" placeholder="Parent entity, developer, fund" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>`;
  html += '</div>';

  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Owner Type</label>';
  html += '<select id="udOwnType" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)">';
  html += '<option value="">—</option>';
  ['individual','llc','reit','developer','fund','operator','other'].forEach(t => {
    html += `<option value="${t}" ${own?.owner_type === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`;
  });
  html += '</select></div>';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Contact Name</label>';
  html += `<input id="udOwnContact" type="text" value="${esc(own?.contact_1_name || own?.contact_name || '')}" placeholder="" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>`;
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Contact Phone</label>';
  html += `<input id="udOwnPhone" type="tel" value="${esc(own?.contact_phone || '')}" placeholder="" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>`;
  html += '</div>';

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Contact Email</label>';
  html += `<input id="udOwnEmail" type="email" value="${esc(own?.contact_email || '')}" placeholder="" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>`;
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">State of Incorporation</label>';
  html += `<input id="udOwnState" type="text" value="${esc(own?.recorded_owner_state || own?.true_owner_state || '')}" placeholder="" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>`;
  html += '</div>';

  html += '<div style="margin-top:8px"><label style="font-size:11px;font-weight:600;color:var(--text2)">Notes</label>';
  html += '<textarea id="udOwnNotes" rows="2" placeholder="Research notes..." style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);resize:vertical;font-family:inherit;box-sizing:border-box"></textarea></div>';

  html += `<button onclick="_udSaveOwnership()" style="margin-top:10px;width:100%;padding:10px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer">Save Ownership Resolution</button>`;
  html += '</div>';

  // ── OWNERSHIP HISTORY (CHAIN) ──────────────────────────────────────
  html += '<div class="detail-section">';
  html += `<div class="detail-section-title">Ownership History <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:8px">${chain.length} records</span></div>`;

  if (chain.length === 0) {
    html += '<div class="detail-empty" style="font-size:13px">No ownership transfer history found for this property. Check the History tab or use Research Quick Links to trace prior owners.</div>';
  } else {
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
    html += '</div>';
  }
  html += '</div>';

  // ── RECENT TOUCHPOINTS (loaded async) ─────────────────────────────
  html += '<div id="udTouchpoints"><div style="text-align:center;padding:16px;color:var(--text3)"><span class="spinner"></span> Loading touchpoints...</div></div>';

  // ── SALESFORCE ACTIVITY FEED (loaded async) ────────────────────────
  html += '<div id="udActivityFeed"><div style="text-align:center;padding:24px;color:var(--text3)"><span class="spinner"></span> Loading activity feed...</div></div>';

  // ── INLINE LOG CALL FORM ──────────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Log Call / Activity</div>';

  const sfCid = own?.salesforce_id || own?.sf_contact_id || '';
  const sfCoId = own?.sf_company_id || '';
  const ownerName = own?.true_owner || own?.recorded_owner || own?.contact_1_name || '';

  html += '<div class="detail-form" id="udLogCallForm">';
  html += `<div style="font-size:12px;color:var(--text2);margin-bottom:8px">Logging for: <strong>${esc(ownerName || 'Unknown')}</strong></div>`;

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html += '<div>';
  html += '<label>Activity Type</label>';
  html += '<select id="udLogType">';
  html += '<option value="Client Outreach">Client Outreach</option>';
  html += '<option value="Introduction Call">Introduction Call</option>';
  html += '<option value="Follow-up">Follow-up</option>';
  html += '<option value="Property Discussion">Property Discussion</option>';
  html += '<option value="Email Correspondence">Email Correspondence</option>';
  html += '<option value="Market Update">Market Update</option>';
  html += '</select>';
  html += '</div>';

  html += '<div>';
  html += '<label>Outcome</label>';
  html += '<select id="udLogOutcome">';
  html += '<option value="connected">Connected</option>';
  html += '<option value="voicemail">Voicemail</option>';
  html += '<option value="no_answer">No Answer</option>';
  html += '<option value="email_sent">Email Sent</option>';
  html += '<option value="meeting_set">Meeting Set</option>';
  html += '</select>';
  html += '</div>';
  html += '</div>';

  html += '<label>Date</label>';
  html += `<input type="date" id="udLogDate" value="${new Date().toISOString().split('T')[0]}">`;

  html += '<label>Notes</label>';
  html += '<textarea id="udLogNotes" placeholder="Call notes, key takeaways, next steps..." style="min-height:80px"></textarea>';

  html += '<div style="display:flex;gap:8px;margin-top:12px">';
  html += `<button class="act-btn primary" id="udLogSubmit" onclick="_udSubmitLogCall('${esc(sfCid)}','${esc(sfCoId)}')">&#x260E; Log Activity</button>`;
  if (own?.contact_phone) html += `<a href="tel:${esc(own.contact_phone)}" class="act-btn">&#x1F4DE; Call</a>`;
  if (own?.contact_email) html += `<a href="mailto:${esc(own.contact_email)}" class="act-btn">&#x2709; Quick Email</a>`;
  html += '</div>';
  html += '</div></div>';

  // ── EMAIL TEMPLATE SECTION ──────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Email Templates</div>';
  html += '<div class="detail-form">';
  html += '<label>Template</label>';
  html += '<select id="udTemplateSelect" onchange="_udPreviewTemplate()">';
  html += '<option value="">— Select a template —</option>';
  html += '</select>';
  html += '<div id="udTemplatePreview" style="display:none;margin-top:12px">';
  html += '<label>Subject</label>';
  html += '<div id="udTemplateSubject" style="font-size:13px;padding:8px 12px;background:var(--s2);border-radius:8px;color:var(--text);margin-bottom:8px"></div>';
  html += '<label>Body Preview</label>';
  html += '<div id="udTemplateBody" style="font-size:12px;padding:12px;background:var(--s2);border-radius:8px;color:var(--text2);max-height:200px;overflow-y:auto;line-height:1.5"></div>';
  html += '<div style="display:flex;gap:8px;margin-top:12px">';
  html += '<button class="act-btn primary" onclick="_udSendTemplate()">&#x2709; Open in Email Client</button>';
  html += '<button class="act-btn" onclick="_udCopyTemplate()">&#x1F4CB; Copy to Clipboard</button>';
  html += '</div>';
  html += '</div>';
  html += '</div></div>';

  // Async loads after DOM renders
  _loadEmailTemplates(own);
  _loadTouchpoints(own);
  _loadActivityFeed(own);

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
// RESEARCH QUICK LINKS
// ============================================================================

/** State Secretary of State business entity search URLs */
const _SOS_URLS = {
  AL: 'https://arc-sos.state.al.us/cgi/corpname.mbr/output',
  AK: 'https://www.commerce.alaska.gov/cbp/main/search/entities',
  AZ: 'https://ecorp.azcc.gov/EntitySearch/Index',
  AR: 'https://www.sos.arkansas.gov/corps/search_all.php',
  CA: 'https://bizfileonline.sos.ca.gov/search/business',
  CO: 'https://www.sos.state.co.us/biz/BusinessEntityCriteriaExt.do',
  CT: 'https://service.ct.gov/business/s/onlinebusinesssearch',
  DE: 'https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx',
  FL: 'https://search.sunbiz.org/Inquiry/CorporationSearch/ByName',
  GA: 'https://ecorp.sos.ga.gov/BusinessSearch',
  HI: 'https://hbe.ehawaii.gov/documents/search.html',
  ID: 'https://sosbiz.idaho.gov/search/business',
  IL: 'https://www.ilsos.gov/corporatellc/',
  IN: 'https://bsd.sos.in.gov/publicbusinesssearch',
  IA: 'https://sos.iowa.gov/search/business/(S(0))/search.aspx',
  KS: 'https://www.sos.ks.gov/business/business-entities.html',
  KY: 'https://web.sos.ky.gov/bussearchnprofile/(S(0))/search.aspx',
  LA: 'https://coraweb.sos.la.gov/commercialsearch/CommercialSearchAnon.aspx',
  ME: 'https://icrs.informe.org/nei-sos-icrs/ICRS',
  MD: 'https://egov.maryland.gov/BusinessExpress/EntitySearch',
  MA: 'https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx',
  MI: 'https://cofs.lara.state.mi.us/SearchApi/Search/Search',
  MN: 'https://mblsportal.sos.state.mn.us/Business/Search',
  MS: 'https://corp.sos.ms.gov/corp/portal/c/page/corpBusinessIdSearch/portal.aspx',
  MO: 'https://bsd.sos.mo.gov/BusinessEntity/BESearch.aspx',
  MT: 'https://biz.sosmt.gov/search',
  NE: 'https://www.nebraska.gov/sos/corp/corpsearch.cgi',
  NV: 'https://esos.nv.gov/EntitySearch/OnlineEntitySearch',
  NH: 'https://quickstart.sos.nh.gov/online/BusinessInquire',
  NJ: 'https://www.njportal.com/DOR/BusinessNameSearch',
  NM: 'https://portal.sos.state.nm.us/BFS/online/CorporationBusinessSearch',
  NY: 'https://appext20.dos.ny.gov/corp_public/CORPSEARCH.ENTITY_SEARCH_ENTRY',
  NC: 'https://www.sosnc.gov/online_services/search/by_title/_Business_Registration',
  ND: 'https://firststop.sos.nd.gov/search/business',
  OH: 'https://www.sos.state.oh.us/businesses/information-on-a-business/',
  OK: 'https://www.sos.ok.gov/corp/corpInquiryFind.aspx',
  OR: 'https://sos.oregon.gov/business/pages/find.aspx',
  PA: 'https://www.corporations.pa.gov/search/corpsearch',
  RI: 'https://business.sos.ri.gov/CorpWeb/CorpSearch/CorpSearch.aspx',
  SC: 'https://search.scsos.com/search',
  SD: 'https://sosenterprise.sd.gov/BusinessServices/Business/FilingSearch.aspx',
  TN: 'https://tnbear.tn.gov/Ecommerce/FilingSearch.aspx',
  TX: 'https://mycpa.cpa.state.tx.us/coa/coaSearchBtn',
  UT: 'https://secure.utah.gov/bes/index.html',
  VT: 'https://bizfilings.vermont.gov/online/BusinessInquire',
  VA: 'https://cis.scc.virginia.gov/EntitySearch/Index',
  WA: 'https://ccfs.sos.wa.gov/#/AdvancedSearch',
  WV: 'https://apps.wv.gov/SOS/BusinessEntity/',
  WI: 'https://www.wdfi.org/apps/CorpSearch/Search.aspx',
  WY: 'https://wyobiz.wyo.gov/Business/FilingSearch.aspx',
  DC: 'https://corponline.dcra.dc.gov/BizEntity.aspx/Search'
};

/** Full state names for display */
const _STATE_NAMES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
  CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',
  IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',
  ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',
  MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
  OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',
  TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',
  WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'
};

/** Salesforce Lightning base URL */
const _SF_BASE = 'https://northmarq.lightning.force.com/lightning/r';

/** Build a styled quick-link button */
function _qlBtn(label, url, icon, color) {
  if (!url) return '';
  return `<a href="${esc(url)}" target="_blank" rel="noopener" class="ql-btn" style="--ql-color:${color}" title="${esc(label)}">
    <span class="ql-icon">${icon}</span>
    <span class="ql-label">${esc(label)}</span>
  </a>`;
}

/** Research Quick Links — property-level research shortcuts */
function _udResearchLinks() {
  if (!_udCache || !_udCache.property) return '';
  const p = _udCache.property;
  const own = _udCache.ownership;
  const db = _udCache.db;

  const county = p.county || '';
  const state = (p.state || '').toUpperCase().trim();
  const city = p.city || '';
  const address = p.address || '';
  const fullAddr = address + (city ? ', ' + city : '') + (state ? ', ' + state : '');

  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Research Quick Links</div>';
  html += '<div class="ql-grid">';

  // ── COUNTY RESEARCH ──
  if (county && state) {
    const countyQ = encodeURIComponent(county + ' County ' + (_STATE_NAMES[state] || state));
    html += _qlBtn(
      county + ' Co. Appraiser',
      'https://www.google.com/search?q=' + countyQ + '+property+appraiser+records&btnI=1',
      '🏛', '#6c8cff'
    );
    html += _qlBtn(
      county + ' Co. GIS',
      'https://www.google.com/search?q=' + countyQ + '+GIS+parcel+map&btnI=1',
      '🗺', '#4ecdc4'
    );
  }

  // ── PROPERTY STATE SOS ──
  if (state && _SOS_URLS[state]) {
    html += _qlBtn(
      state + ' Sec. of State',
      _SOS_URLS[state],
      '📋', '#f7b731'
    );
  }

  // ── OWNER HOME STATE SOS (LLC/SPE) ──
  let ownerState = null;
  if (own) {
    // Gov has recorded_owner_state / true_owner_state; Dia has recorded_owner_state / true_owner_state
    ownerState = (own.true_owner_state || own.recorded_owner_state || '').toUpperCase().trim();
  }
  // Also check ownership_history state_of_incorporation from fallback
  const incorpState = (_udCache.fallback?.state_of_incorporation || '').toUpperCase().trim();
  const sosState = incorpState || ownerState;

  if (sosState && sosState !== state && _SOS_URLS[sosState]) {
    html += _qlBtn(
      sosState + ' SOS (Owner)',
      _SOS_URLS[sosState],
      '🏢', '#e056a0'
    );
  }

  // ── GOOGLE MAPS / STREET VIEW ──
  if (address && city) {
    const mapsQ = encodeURIComponent(fullAddr);
    html += _qlBtn(
      'Google Maps',
      'https://www.google.com/maps/search/' + mapsQ,
      '📍', '#34a853'
    );
    if (p.latitude && p.longitude) {
      html += _qlBtn(
        'Street View',
        `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.latitude},${p.longitude}`,
        '👁', '#4285f4'
      );
    }
  }

  // ── SALESFORCE LINKS ──
  const sfContactId = own?.sf_contact_id || own?.salesforce_id || '';
  const sfOppId = own?.sf_opportunity_id || '';
  const sfCompanyId = own?.sf_company_id || '';

  if (sfContactId) {
    html += _qlBtn('SF Contact', `${_SF_BASE}/Contact/${sfContactId}/view`, '👤', '#00a1e0');
  }
  if (sfOppId) {
    html += _qlBtn('SF Opportunity', `${_SF_BASE}/Opportunity/${sfOppId}/view`, '💰', '#ff9f43');
  }
  if (sfCompanyId) {
    html += _qlBtn('SF Account', `${_SF_BASE}/Account/${sfCompanyId}/view`, '🏬', '#a55eea');
  }

  // ── THIRD PARTY SEARCH ──
  if (address && city) {
    const costarQ = encodeURIComponent(fullAddr);
    html += _qlBtn(
      'CoStar Lookup',
      'https://www.costar.com/search?q=' + costarQ,
      '⭐', '#ff6348'
    );
    html += _qlBtn(
      'LoopNet',
      'https://www.loopnet.com/search/commercial-real-estate/' + encodeURIComponent(city + '-' + state) + '/for-sale/',
      '🔄', '#1e90ff'
    );
  }

  // ── OWNER WEBSITE / GOOGLE LOOKUP ──
  const ownerName = own?.true_owner || own?.recorded_owner || '';
  if (ownerName) {
    html += _qlBtn(
      'Owner Search',
      'https://www.google.com/search?q=' + encodeURIComponent('"' + ownerName + '" real estate'),
      '🔍', '#95afc0'
    );
  }

  html += '</div></div>';
  return html;
}

/** System links — Salesforce records + email for the Ownership tab */
function _udSystemLinks(own) {
  if (!own) return '';

  const sfContactId = own.sf_contact_id || own.salesforce_id || '';
  const sfOppId = own.sf_opportunity_id || '';
  const sfCompanyId = own.sf_company_id || '';
  const contactEmail = own.contact_email || '';

  // Only show if we have at least one link
  if (!sfContactId && !sfOppId && !sfCompanyId && !contactEmail) return '';

  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">System Links</div>';
  html += '<div class="ql-grid">';

  if (sfContactId) {
    html += _qlBtn('SF Contact', `${_SF_BASE}/Contact/${sfContactId}/view`, '👤', '#00a1e0');
  }
  if (sfOppId) {
    html += _qlBtn('SF Opportunity', `${_SF_BASE}/Opportunity/${sfOppId}/view`, '💰', '#ff9f43');
  }
  if (sfCompanyId) {
    html += _qlBtn('SF Account', `${_SF_BASE}/Account/${sfCompanyId}/view`, '🏬', '#a55eea');
  }

  // Email — open in Outlook Web (search for contact)
  if (contactEmail) {
    const owlSearch = `https://outlook.office.com/mail/search/id//?query=${encodeURIComponent(contactEmail)}`;
    html += _qlBtn('Email History', owlSearch, '📧', '#0078d4');
  }

  html += '</div></div>';
  return html;
}

/** Build Outlook Web App search URL for email history with a contact */
function _outlookSearchUrl(email) {
  return `https://outlook.office.com/mail/search/id//?query=${encodeURIComponent(email)}`;
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

// ============================================================================
// CRM: INLINE LOG CALL
// ============================================================================

async function _udSubmitLogCall(sfContactId, sfCompanyId) {
  const btn = document.getElementById('udLogSubmit');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Logging...';

  const actType = document.getElementById('udLogType')?.value || 'Client Outreach';
  const outcome = document.getElementById('udLogOutcome')?.value || 'connected';
  const actDate = document.getElementById('udLogDate')?.value || new Date().toISOString().split('T')[0];
  const notes = document.getElementById('udLogNotes')?.value || '';

  if (!sfContactId && !sfCompanyId) {
    showToast('No Salesforce contact or company ID available.', 'error');
    btn.disabled = false;
    btn.textContent = '\u260E Log Activity';
    return;
  }

  const API = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot';

  try {
    // ── GENERIC SF PAYLOAD ──
    // Salesforce gets only a generic activity description — no deal-specific
    // notes, no client engagement details. This ensures compliance with rules
    // of engagement while keeping proprietary intel in Supabase only.
    const _SF_GENERIC_MAP = {
      'Client Outreach': 'Investment Sales - Client Touch',
      'Introduction Call': 'Investment Sales - Introduction',
      'Follow-up': 'Investment Sales - Follow-up',
      'Property Discussion': 'Investment Sales - Property Research',
      'Email Correspondence': 'Investment Sales - Email Correspondence',
      'Market Update': 'Investment Sales - Market Update'
    };
    const sfSubject = _SF_GENERIC_MAP[actType] || 'Investment Sales - Activity';

    const payload = {
      sf_contact_id: sfContactId || undefined,
      sf_company_id: sfCompanyId || undefined,
      activity_type: actType,
      activity_date: actDate,
      outcome: outcome,
      // Redacted: SF only sees generic subject, no notes
      notes: sfSubject,
      force: true
    };

    // 1. Log to Salesforce (generic)
    const res = await fetch(`${API}/sync/log-to-sf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      showToast('Activity logged (SF generic + private notes saved)', 'success');
      document.getElementById('udLogNotes').value = '';
      // 2. Log FULL details to outbound_activities in Supabase (private)
      try {
        await _udLogOutbound(sfContactId, sfCompanyId, actType, actDate, outcome, notes);
      } catch (e) { console.warn('Outbound log fallback error:', e); }
    } else if (data.warning) {
      showToast(`Warning: ${data.message || 'Recent activity detected'}`, 'error');
    } else {
      showToast(`Error: ${data.error || 'Unknown error'}`, 'error');
    }
  } catch (e) {
    showToast(`Network error: ${e.message}`, 'error');
  }

  btn.disabled = false;
  btn.textContent = '\u260E Log Activity';
}

/** Write FULL private activity details to outbound_activities (Supabase only — never SF) */
async function _udLogOutbound(sfContactId, sfCompanyId, actType, actDate, outcome, notes) {
  const url = new URL('/api/dia-query', window.location.origin);
  url.searchParams.set('table', 'outbound_activities');

  await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sf_contact_id: sfContactId || null,
      sf_company_id: sfCompanyId || null,
      activity_type: actType,
      activity_date: actDate,
      status: outcome,
      notes: notes || null,
      user_name: 'scott',
      ref_id: _udCache?.property?.property_id ? String(_udCache.property.property_id) : null
    })
  });
}

// ============================================================================
// CRM: EMAIL TEMPLATES
// ============================================================================

let _udTemplates = [];

async function _loadEmailTemplates(own) {
  await new Promise(r => setTimeout(r, 80));
  const sel = document.getElementById('udTemplateSelect');
  if (!sel) return;

  try {
    _udTemplates = await diaQuery('bd_email_templates', '*', { order: 'name.asc', limit: 20 });

    if (!_udTemplates || _udTemplates.length === 0) {
      sel.innerHTML = '<option value="">No templates available</option>';
      return;
    }

    let opts = '<option value="">— Select a template —</option>';
    _udTemplates.forEach((t, i) => {
      opts += `<option value="${i}">${esc(t.name)} (${esc(t.template_type)})</option>`;
    });
    sel.innerHTML = opts;
  } catch (e) {
    console.error('Template load error:', e);
    sel.innerHTML = '<option value="">Error loading templates</option>';
  }
}

function _udPreviewTemplate() {
  const sel = document.getElementById('udTemplateSelect');
  const preview = document.getElementById('udTemplatePreview');
  if (!sel || !preview) return;

  const idx = sel.value;
  if (idx === '' || !_udTemplates[idx]) {
    preview.style.display = 'none';
    return;
  }

  const tmpl = _udTemplates[idx];
  const merged = _udMergeFields(tmpl);

  document.getElementById('udTemplateSubject').textContent = merged.subject;
  document.getElementById('udTemplateBody').innerHTML = merged.bodyHtml;
  preview.style.display = 'block';
}

function _udMergeFields(tmpl) {
  const prop = _udCache?.property || {};
  const own = _udCache?.ownership || {};

  const contactName = own.contact_1_name || own.contact_name || own.true_owner || own.recorded_owner || 'there';
  const propertyName = prop.page_title || prop.address || 'the property';
  const cityState = (prop.city || '') + (prop.state ? ', ' + prop.state : '');
  const annualRent = prop.annual_rent ? fmt(prop.annual_rent) : '';
  const askingPrice = prop.asking_price ? fmt(prop.asking_price) : '';
  const capRate = prop.cap_rate ? Number(prop.cap_rate).toFixed(2) + '%' : '';
  const agency = prop.agency_full || prop.agency_short || '';
  const leaseTerm = '';

  const merge = (str) => {
    if (!str) return '';
    return str
      .replace(/\{\{contact_name\}\}/g, contactName)
      .replace(/\{\{property_name\}\}/g, propertyName)
      .replace(/\{\{city_state\}\}/g, cityState)
      .replace(/\{\{annual_rent\}\}/g, annualRent)
      .replace(/\{\{asking_price\}\}/g, askingPrice)
      .replace(/\{\{cap_rate\}\}/g, capRate)
      .replace(/\{\{agency\}\}/g, agency)
      .replace(/\{\{lease_term\}\}/g, leaseTerm);
  };

  return {
    subject: merge(tmpl.subject_template),
    bodyHtml: merge(tmpl.html_body_template),
    bodyText: _htmlToText(merge(tmpl.html_body_template))
  };
}

/** Strip HTML to plain text for mailto body */
function _htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function _udSendTemplate() {
  const sel = document.getElementById('udTemplateSelect');
  const idx = sel?.value;
  if (idx === '' || !_udTemplates[idx]) { showToast('Select a template first'); return; }

  const tmpl = _udTemplates[idx];
  const merged = _udMergeFields(tmpl);
  const own = _udCache?.ownership || {};
  const toEmail = own.contact_email || '';

  const mailto = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(merged.subject)}&body=${encodeURIComponent(merged.bodyText)}`;
  window.open(mailto, '_blank');
}

async function _udCopyTemplate() {
  const sel = document.getElementById('udTemplateSelect');
  const idx = sel?.value;
  if (idx === '' || !_udTemplates[idx]) { showToast('Select a template first'); return; }

  const tmpl = _udTemplates[idx];
  const merged = _udMergeFields(tmpl);

  try {
    await navigator.clipboard.writeText(merged.bodyText);
    showToast('Template copied to clipboard!', 'success');
  } catch (e) {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = merged.bodyText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Template copied!', 'success');
  }
}

// ============================================================================
// CRM: TOUCHPOINT HISTORY
// ============================================================================

async function _loadTouchpoints(own) {
  await new Promise(r => setTimeout(r, 60));
  const el = document.getElementById('udTouchpoints');
  if (!el) return;

  const sfId = own?.salesforce_id || own?.sf_contact_id || '';
  const sfCoId = own?.sf_company_id || '';

  if (!sfId && !sfCoId) {
    el.innerHTML = '';
    return;
  }

  try {
    const filter = sfId ? `sf_contact_id=eq.${sfId}` : `sf_company_id=eq.${sfCoId}`;
    const rows = await diaQuery('outbound_activities', '*', {
      filter: filter,
      order: 'activity_date.desc',
      limit: 10
    });

    if (!rows || rows.length === 0) {
      el.innerHTML = '';
      return;
    }

    let html = '<div class="detail-section">';
    html += `<div class="detail-section-title">Recent Touchpoints <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:8px">${rows.length} logged</span></div>`;

    rows.forEach(r => {
      const statusColors = {
        connected: 'var(--green)',
        voicemail: 'var(--yellow)',
        no_answer: 'var(--red)',
        email_sent: 'var(--accent)',
        meeting_set: 'var(--purple)'
      };
      const color = statusColors[r.status] || 'var(--text3)';

      html += '<div class="detail-card">';
      html += '<div class="detail-card-header">';
      html += `<div class="detail-card-title" style="display:flex;align-items:center;gap:6px">`;
      html += `<span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>`;
      html += `${esc(r.activity_type || 'Activity')}`;
      html += '</div>';
      html += `<div class="detail-card-date">${esc(_fmtDate(r.activity_date))}</div>`;
      html += '</div>';
      html += '<div class="detail-card-body">';
      html += `<span style="font-size:11px;color:${color}">${esc(cleanLabel(r.status || ''))}</span>`;
      if (r.user_name) html += ` <span style="font-size:11px;color:var(--text3)">by ${esc(r.user_name)}</span>`;
      html += '</div></div>';
    });

    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    console.error('Touchpoints load error:', e);
    el.innerHTML = '';
  }
}

/**
 * Refresh the current detail panel without re-opening.
 * Re-fetches data and re-renders the active tab.
 */
function refreshDetailPanel() {
  if (!_udCache) return;
  const db = _udCache.db;
  const ids = _udCache.ids;
  const fallback = _udCache.fallback || _udCache;
  if (db && ids) {
    openUnifiedDetail(db, ids, fallback);
  }
}

/**
 * Save ownership resolution from the unified detail Ownership tab form
 */
async function _udSaveOwnership() {
  if (!_udCache) { showToast('No record loaded', 'error'); return; }
  const db = _udCache.db;
  const propertyId = _udCache.ids?.property_id;
  if (!propertyId) { showToast('No property ID — cannot save ownership', 'error'); return; }

  const recordedOwner = (document.getElementById('udOwnRecorded') || {}).value?.trim() || null;
  const trueOwner = (document.getElementById('udOwnTrue') || {}).value?.trim() || null;
  const ownerType = (document.getElementById('udOwnType') || {}).value || null;
  const contactName = (document.getElementById('udOwnContact') || {}).value?.trim() || null;
  const contactPhone = (document.getElementById('udOwnPhone') || {}).value?.trim() || null;
  const contactEmail = (document.getElementById('udOwnEmail') || {}).value?.trim() || null;
  const incState = (document.getElementById('udOwnState') || {}).value?.trim() || null;
  const notes = (document.getElementById('udOwnNotes') || {}).value?.trim() || null;

  const proxyBase = db === 'gov' ? '/api/gov-query' : '/api/dia-query';

  // Check if ownership record exists
  const own = _udCache.ownership;
  if (own && own.ownership_id) {
    // PATCH existing
    const url = new URL(proxyBase, window.location.origin);
    url.searchParams.set('table', 'ownership_history');
    url.searchParams.set('filter', `ownership_id=eq.${own.ownership_id}`);
    const data = { owner_type: ownerType, notes: notes };
    try {
      const res = await fetch(url.toString(), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!res.ok) { showToast('Error updating ownership: ' + res.status, 'error'); return; }
    } catch (e) { showToast('Network error: ' + e.message, 'error'); return; }
  }

  // Update or create v_ownership_current via the correct tables
  // For now, save the contact/owner info to research_queue_outcomes as a clinic_lead
  const clinicId = _udCache.fallback?.clinic_id || _udCache.fallback?.medicare_id || null;
  if (clinicId) {
    try {
      const url = new URL(proxyBase, window.location.origin);
      url.searchParams.set('table', 'research_queue_outcomes');
      const payload = {
        queue_type: 'ownership_resolution',
        clinic_id: clinicId,
        status: 'completed',
        notes: [
          recordedOwner ? 'Recorded Owner: ' + recordedOwner : null,
          trueOwner ? 'True Owner: ' + trueOwner : null,
          ownerType ? 'Type: ' + ownerType : null,
          contactName ? 'Contact: ' + contactName : null,
          contactPhone ? 'Phone: ' + contactPhone : null,
          contactEmail ? 'Email: ' + contactEmail : null,
          incState ? 'Inc. State: ' + incState : null,
          notes ? 'Notes: ' + notes : null
        ].filter(Boolean).join(' | '),
        selected_property_id: propertyId,
        assigned_at: new Date().toISOString()
      };
      const res = await fetch(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const err = await res.text(); console.error('Ownership save error:', err); }
    } catch (e) { console.error('Ownership resolution save error:', e); }
  }

  showToast('Ownership resolution saved!', 'success');
  // Refresh the detail panel
  refreshDetailPanel();
}

// Expose to global scope
window.openUnifiedDetail = openUnifiedDetail;
window.switchUnifiedTab = switchUnifiedTab;
window.showUnifiedDetail = showUnifiedDetail;
window.refreshDetailPanel = refreshDetailPanel;
window._udSubmitLogCall = _udSubmitLogCall;
window._udPreviewTemplate = _udPreviewTemplate;
window._udSendTemplate = _udSendTemplate;
window._udCopyTemplate = _udCopyTemplate;
window._udSaveOwnership = _udSaveOwnership;
