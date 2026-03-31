// ============================================================================
// UNIFIED PROPERTY DETAIL PAGE
// Shared across Gov and Dialysis — fetches from normalized Supabase views
// Loaded after index.html, gov.js, dialysis.js
// ============================================================================

// Cache for the current detail data (avoids re-fetch on tab switch)
let _udCache = null;
let _udAssistantState = {
  ownership: { loading: false, reply: '', error: '' },
  intel: { loading: false, reply: '', error: '' },
};
let _udIntakeState = {
  fileName: '',
  fileType: '',
  notice: '',
  text: '',
  imageDataUrl: '',
  loading: false,
  analysis: '',
  error: '',
};

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
  const tabs = ['Property', 'Lease', 'Operations', 'Ownership', 'Intel', 'History'];
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
  const clinicIdent = fallback.clinic_id || fallback.medicare_id || fallback.ccn;
  if (!propertyId && db === 'dia' && (clinicIdent || fallback.npi || fallback.medicare_npi)) {
    try {
      // Try medicare_id first, then NPI
      const lookupField = clinicIdent ? 'medicare_id' : 'npi';
      const lookupVal = clinicIdent || fallback.npi || fallback.medicare_npi;
      const mcRes = await diaQuery('medicare_clinics', 'property_id,medicare_id', {
        filter: `${lookupField}=eq.${encodeURIComponent(lookupVal)}`,
        limit: 1
      });
      const mcArr = Array.isArray(mcRes) ? mcRes : (mcRes?.data || []);
      if (mcArr.length && mcArr[0].property_id) {
        propertyId = mcArr[0].property_id;
      }
      // Backfill clinic_id on fallback so downstream tabs work
      if (mcArr.length && mcArr[0].medicare_id && !fallback.clinic_id) {
        fallback.clinic_id = mcArr[0].medicare_id;
      }
    } catch (e) { console.warn('clinic→property lookup failed', e); }
  }

  // Build filter — prefer property_id, fall back to lease_number
  const propFilter = propertyId ? `property_id=eq.${propertyId}` : null;
  const leaseFilter = leaseNumber ? `lease_number=eq.${encodeURIComponent(leaseNumber)}` : null;
  const mainFilter = propFilter || leaseFilter;

  if (!mainFilter) {
    // No property_id or lease_number — render a fallback detail panel
    // using the fields already present on the search card record
    _udCache = { db, ids, property: null, leases: [], ownership: null, chain: [], rankings: null, fallback, _fallbackOnly: true };
    _udRenderFallbackHeader(db, fallback);
    document.getElementById('detailBody').innerHTML = _udRenderTab('Property');
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

    // If all views returned empty, use the fallback record's fields as a synthetic property
    const allEmpty = !property && leases.length === 0 && !ownership && chain.length === 0;
    const synthProperty = allEmpty ? _udSynthPropertyFromFallback(fallback, db) : property;

    _udCache = { db, ids, property: synthProperty, leases, ownership, chain, rankings, fallback, _fallbackOnly: allEmpty };

    // Update header with real data (page_title or fallback to tenant/address)
    if (synthProperty) {
      const realTitle = synthProperty.page_title || synthProperty.facility_name || fallback.tenant_operator || fallback.agency || synthProperty.address || fallback.address || '(Unknown)';
      const loc2 = (synthProperty.city || '') + (synthProperty.state ? ', ' + synthProperty.state : '');
      // "Not a Lead" button for dia-clinic records (dismiss from clinic lead pipeline)
      const dismissBtn = (db === 'dia' && (fallback.clinic_id || fallback.medicare_id))
        ? `<button onclick="_udDismissLead()" style="background:rgba(239,68,68,0.12);color:var(--red,#ef4444);border:1px solid rgba(239,68,68,0.25);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:Outfit,sans-serif;margin-right:6px" title="Mark as not a viable lead (hospital campus, etc.)">Not a Lead</button>`
        : '';
      document.getElementById('detailHeader').innerHTML = `
        <div class="detail-header-info">
          <div style="flex:1">
            <div class="detail-title">${esc(realTitle)}</div>
            <div class="detail-subtitle">${esc(loc2)}${property.county ? ' · ' + esc(property.county) + ' County' : ''}</div>
            ${_udKeyFields(db, property, ownership)}
          </div>
          ${dismissBtn}
          <span class="detail-badge" style="background:${db === 'gov' ? 'var(--gov-green)' : 'var(--purple)'};color:#fff">${db === 'gov' ? 'GOV' : 'DIA'}</span>
          <button class="detail-close" onclick="closeDetail()">&times;</button>
        </div>`;
    }

    // Render active tab (preserve on refresh) or default to Property
    const activeTabEl = document.querySelector('#detailTabs .detail-tab.active');
    const activeTab = activeTabEl ? activeTabEl.textContent.trim() : 'Property';
    document.getElementById('detailBody').innerHTML = _udRenderTab(activeTab);

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
  if (db === 'dia') {
    // Dialysis: show operator, not agency — check property data then fallback record
    const fb = _udCache?.fallback || {};
    const opName = prop.operator_name || fb.operator_name || fb.chain_organization || prop.facility_name || fb.facility_name || '';
    if (opName) html += `<div><span style="color:var(--text3)">Operator:</span> <span style="color:var(--text)">${esc(opName)}</span></div>`;
  } else {
    if (prop.agency_short || prop.agency_full) html += `<div><span style="color:var(--text3)">Agency:</span> <span style="color:var(--text)">${esc(prop.agency_short || prop.agency_full)}</span></div>`;
  }
  if (own) {
    const ownerName = own.true_owner || own.recorded_owner || '';
    if (ownerName) html += `<div><span style="color:var(--text3)">Owner:</span> <span style="color:var(--text)">${esc(ownerName)}</span></div>`;
  }
  if (prop.estimated_value) html += `<div><span style="color:var(--text3)">Est. Value:</span> <span style="color:var(--green);font-weight:600">${fmt(prop.estimated_value)}</span></div>`;
  if (prop.deal_grade) html += `<div><span style="color:var(--text3)">Grade:</span> <span style="color:var(--accent);font-weight:600">${esc(prop.deal_grade)}</span></div>`;
  html += '</div>';
  return html;
}

/** Show the dismiss form inline at the top of the detail body */
function _udDismissLead() {
  if (!_udCache || _udCache.db !== 'dia') return;
  const existing = document.getElementById('ud-dismiss-form');
  if (existing) { existing.remove(); return; } // toggle off

  const prop = _udCache.property || {};
  const currentSF = prop.building_sf || prop.building_size || '';

  const formHTML = `
    <div id="ud-dismiss-form" style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:10px;padding:14px 16px;margin:0 0 16px 0;font-size:12px;">
      <div style="font-weight:700;color:var(--red,#ef4444);font-size:13px;margin-bottom:10px">Dismiss Lead — Not Viable</div>

      <div style="margin-bottom:8px">
        <label style="color:var(--text3);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Reason</label>
        <select id="ud-dismiss-reason" style="display:block;width:100%;margin-top:3px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);font-size:12px">
          <option value="hospital_campus">Hospital Campus / Medical Complex</option>
          <option value="multi_tenant">Multi-Tenant Building (not single-tenant NNN)</option>
          <option value="government_owned">Government-Owned Property</option>
          <option value="too_small">Too Small / Not Institutional Grade</option>
          <option value="no_property_match">Cannot Match to Property</option>
          <option value="closed">Clinic Closed / Relocated</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div style="margin-bottom:8px">
        <label style="color:var(--text3);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Notes</label>
        <input type="text" id="ud-dismiss-notes" placeholder="e.g. In 1.4M SF hospital, owned by Hartford Healthcare" style="display:block;width:100%;margin-top:3px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);font-size:12px;box-sizing:border-box" />
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <label style="color:var(--text3);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Building Size (SF)</label>
          <input type="number" id="ud-dismiss-rba" value="${currentSF}" placeholder="e.g. 1400000" style="display:block;width:100%;margin-top:3px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);font-size:12px;box-sizing:border-box" />
        </div>
        <div>
          <label style="color:var(--text3);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Occupancy</label>
          <select id="ud-dismiss-occupancy" style="display:block;width:100%;margin-top:3px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);font-size:12px">
            <option value="">— no change —</option>
            <option value="multi">Multi-Tenant</option>
            <option value="single">Single-Tenant</option>
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <label style="color:var(--text3);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">True Owner</label>
          <input type="text" id="ud-dismiss-owner" placeholder="e.g. Hartford Healthcare" style="display:block;width:100%;margin-top:3px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);font-size:12px;box-sizing:border-box" />
        </div>
        <div>
          <label style="color:var(--text3);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Owner Type</label>
          <select id="ud-dismiss-owner-type" style="display:block;width:100%;margin-top:3px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);font-size:12px">
            <option value="">— not specified —</option>
            <option value="hospital_system">Hospital System</option>
            <option value="university">University / Academic Medical Center</option>
            <option value="government">Government Entity</option>
            <option value="reit">REIT / Institutional</option>
            <option value="private_equity">Private Equity</option>
            <option value="individual">Individual / Family</option>
            <option value="operator">Operator-Owned</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button onclick="document.getElementById('ud-dismiss-form').remove()" style="padding:6px 14px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text2);font-size:12px;cursor:pointer;font-family:Outfit,sans-serif">Cancel</button>
        <button onclick="_udSubmitDismiss()" style="padding:6px 14px;border:none;border-radius:6px;background:var(--red,#ef4444);color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:Outfit,sans-serif">Dismiss Lead</button>
      </div>
    </div>`;

  const body = document.getElementById('detailBody');
  if (body) body.insertAdjacentHTML('afterbegin', formHTML);
}
window._udDismissLead = _udDismissLead;

/** Submit the dismiss form — save outcome + update property data */
async function _udSubmitDismiss() {
  if (!_udCache || _udCache.db !== 'dia') return;
  const clinicId = _udCache.fallback?.clinic_id || _udCache.fallback?.medicare_id;
  const propertyId = _udCache.ids?.property_id;
  if (!clinicId) { showToast('No clinic ID — cannot dismiss', 'error'); return; }

  const reason = document.getElementById('ud-dismiss-reason')?.value || 'other';
  const notes = document.getElementById('ud-dismiss-notes')?.value?.trim() || '';
  const rba = document.getElementById('ud-dismiss-rba')?.value;
  const occupancy = document.getElementById('ud-dismiss-occupancy')?.value;
  const trueOwner = document.getElementById('ud-dismiss-owner')?.value?.trim() || '';
  const ownerType = document.getElementById('ud-dismiss-owner-type')?.value || '';

  const reasonLabels = {
    hospital_campus: 'Hospital Campus / Medical Complex',
    multi_tenant: 'Multi-Tenant Building',
    government_owned: 'Government-Owned Property',
    too_small: 'Too Small / Not Institutional',
    no_property_match: 'Cannot Match to Property',
    closed: 'Clinic Closed / Relocated',
    other: 'Other'
  };
  const fullNotes = [
    'Reason: ' + (reasonLabels[reason] || reason),
    notes || null,
    rba ? 'Building SF: ' + Number(rba).toLocaleString() : null,
    occupancy === 'multi' ? 'Multi-tenant building' : null,
    trueOwner ? 'Owner: ' + trueOwner : null,
    ownerType ? 'Owner type: ' + ownerType : null
  ].filter(Boolean).join(' | ');

  // Disable the submit button to prevent double-clicks
  const btn = document.querySelector('#ud-dismiss-form button:last-child');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    // 1. Save research_queue_outcomes
    const outPayload = {
      queue_type: 'clinic_lead',
      clinic_id: clinicId,
      status: 'not_applicable',
      notes: fullNotes,
      selected_property_id: propertyId || null,
      assigned_at: new Date().toISOString()
    };
    const outResult = await applyInsertWithFallback({
      proxyBase: '/api/dia-query',
      table: 'research_queue_outcomes',
      idColumn: 'clinic_id',
      recordIdentifier: clinicId,
      data: outPayload,
      source_surface: 'detail_clinic_dismiss',
      propagation_scope: 'research_queue_outcome'
    });
    if (!outResult.ok) {
      console.error('Dismiss outcome error:', outResult.errors || []);
      showToast('Error saving dismiss outcome', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Dismiss Lead'; }
      return;
    }

    // 2. Update property record via mutation service if we have a property_id and any property data
    if (propertyId && (rba || occupancy || trueOwner)) {
      const propPayload = {};
      if (rba) propPayload.building_sf = parseInt(rba);
      if (occupancy === 'multi') propPayload.is_single_tenant = false;
      if (occupancy === 'single') propPayload.is_single_tenant = true;
      if (trueOwner) propPayload.tenant = trueOwner; // tenant field used for owner display

      const propResult = await applyChangeWithFallback({
        proxyBase: '/api/dia-query',
        table: 'properties',
        idColumn: 'property_id',
        idValue: propertyId,
        data: propPayload,
        source_surface: 'clinic_workspace',
        notes: 'Property update during lead dismiss'
      });
      if (!propResult.ok) {
        console.warn('Property update warning:', (propResult.errors || []).join(', '));
        // Non-fatal — the lead is still dismissed
      }
    }

    // 3. If true owner entered, also save to ownership records
    if (propertyId && trueOwner) {
      try {
        const owPayload = { name: trueOwner, owner_type: ownerType || 'other' };
        await applyInsertWithFallback({
          proxyBase: '/api/dia-query',
          table: 'true_owners',
          data: owPayload,
          source_surface: 'detail_clinic_dismiss',
          propagation_scope: 'ownership_helper_record'
        });
      } catch (e) { console.warn('Owner record save warning:', e); }
    }

    // Refresh local outcomes cache
    if (typeof diaData !== 'undefined' && diaData.researchOutcomes) {
      diaData.researchOutcomes.push(outPayload);
    }

    showToast('Lead dismissed — research saved', 'success');
    closeDetail();
    if (typeof renderDiaTab === 'function') renderDiaTab();
  } catch (e) {
    console.error('Dismiss error:', e);
    showToast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Dismiss Lead'; }
  }
}
window._udSubmitDismiss = _udSubmitDismiss;

/** Switch tabs without re-fetching data */
function switchUnifiedTab(tabName) {
  if (!_udCache) return;
  document.querySelectorAll('#detailTabs .detail-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.trim() === tabName);
  });
  document.getElementById('detailBody').innerHTML = _udRenderTab(tabName);
}

// ============================================================================
// FALLBACK HELPERS — render detail from search card record fields
// ============================================================================

/** Build a synthetic property object from the raw search card record */
function _udSynthPropertyFromFallback(fb, db) {
  if (!fb) return null;
  return {
    address: fb.address || fb.property_address || null,
    city: fb.city || fb.property_city || null,
    state: fb.state || fb.property_state || null,
    zip_code: fb.zip || fb.zip_code || null,
    county: fb.county || null,
    page_title: fb.page_title || fb.tenant_operator || fb.tenant_agency || fb.facility_name || fb.agency || null,
    facility_name: fb.facility_name || null,
    agency_short: fb.tenant_agency || fb.agency || null,
    agency_full: fb.tenant_agency || fb.agency_full || null,
    building_sf: fb.building_sf || fb.rsf || fb.usable_sf || fb.sq_ft || null,
    lease_number: fb.lease_number || null,
    estimated_value: fb.value || fb.estimated_value || fb.annual_rent || null,
    // Gov-specific fields from prospect_leads / ownership_history
    rent_per_sf: fb.rent_per_sf || fb.shell_rent || null,
    annual_rent: fb.annual_rent || null,
    lease_start: fb.lease_start || fb.firm_term_start || null,
    lease_end: fb.lease_end || fb.firm_term_end || null,
    term_remaining: fb.term_remaining || null,
    owner_name: fb.owner_name || fb.lessor_name || fb.grantor || null,
    buyer_name: fb.buyer_name || fb.grantee || null,
    sale_date: fb.sale_date || fb.transfer_date || null,
    sale_price: fb.sale_price || fb.price || null,
    operator_name: fb.operator_name || null,
    _synthetic: true
  };
}

/** Render header for fallback-only records (no property_id) */
function _udRenderFallbackHeader(db, fb) {
  const title = fb.page_title || fb.tenant_operator || fb.tenant_agency || fb.agency || fb.facility_name || fb.address || '(Unknown)';
  const loc = (fb.city || '') + (fb.city && fb.state ? ', ' : '') + (fb.state || '');
  document.getElementById('detailHeader').innerHTML = `
    <div class="detail-header-info">
      <div style="flex:1">
        <div class="detail-title">${esc(title)}</div>
        <div class="detail-subtitle">${esc(loc)}${fb.county ? ' &middot; ' + esc(fb.county) + ' County' : ''}</div>
      </div>
      <span class="detail-badge" style="background:${db === 'gov' ? 'var(--gov-green)' : 'var(--purple)'};color:#fff">${db === 'gov' ? 'GOV' : 'DIA'}</span>
      <button class="detail-close" onclick="closeDetail()">&times;</button>
    </div>`;
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
    case 'Intel': return _udTabIntel();
    case 'History': return _udTabHistory();
    default: return '<div class="detail-empty">Unknown tab</div>';
  }
}

// ─── PROPERTY TAB ────────────────────────────────────────────────────────────

function _udTabProperty() {
  const p = _udCache.property;
  if (!p) {
    // Last resort: render raw fallback fields if available
    const fb = _udCache.fallback;
    if (fb) return _udTabFallbackSummary(fb);
    return '<div class="detail-empty">No property data available</div>';
  }

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

  // Government-specific (only show for gov database)
  if (_udCache.db === 'gov' && (p.agency_short || p.agency_full || p.government_type)) {
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

  // ── ACTION BUTTONS ─────────────────────────────────────────────────────────
  html += _udActionButtons();

  // ── RESEARCH QUICK LINKS ──────────────────────────────────────────────────
  html += _udResearchLinks();

  return html;
}

/** Render a summary from the raw fallback record when detail views return empty */
function _udTabFallbackSummary(fb) {
  let html = '';
  if (_udCache._fallbackOnly) {
    html += '<div style="padding:8px 12px;margin-bottom:12px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;font-size:12px;color:var(--text2)">Showing summary from search record. Detailed views are not yet available for this property.</div>';
  }
  html += '<div class="detail-section"><div class="detail-section-title">Property Summary</div><div class="detail-grid">';
  html += _row('Address', fb.address || fb.property_address);
  html += _row('City / State', (fb.city || '') + (fb.state ? ', ' + fb.state : ''));
  html += _row('County', fb.county);
  html += _row('Zip', fb.zip || fb.zip_code);
  html += _row('Agency / Tenant', fb.tenant_agency || fb.agency || fb.tenant_operator);
  html += _row('Lease Number', fb.lease_number);
  html += _row('Building Size', fb.building_sf || fb.rsf || fb.usable_sf || fb.sq_ft ? fmtN(fb.building_sf || fb.rsf || fb.usable_sf || fb.sq_ft) + ' SF' : null);

  // Dialysis-specific fields from search results
  if (fb.facility_name) html += _row('Facility', fb.facility_name);
  if (fb.operator_name) html += _row('Operator', fb.operator_name);
  if (fb.medicare_npi || fb.npi) html += _row('NPI', fb.medicare_npi || fb.npi);
  if (fb.ccn || fb.clinic_id || fb.medicare_id) html += _row('CCN / Medicare ID', fb.ccn || fb.clinic_id || fb.medicare_id);
  if (fb.latest_total_patients) html += _row('Patients', typeof fmtN === 'function' ? fmtN(fb.latest_total_patients) : fb.latest_total_patients);
  if (fb.stations || fb.number_of_chairs) html += _row('Stations', fb.stations || fb.number_of_chairs);
  if (fb.change_type) html += _row('Inventory Status', fb.change_type);
  if (fb.signal_type) html += _row('NPI Signal', fb.signal_type);
  if (fb.review_type) html += _row('Review Type', fb.review_type);
  html += '</div></div>';

  // Financial section
  if (fb.annual_rent || fb.rent_per_sf || fb.value || fb.estimated_value || fb.sale_price) {
    html += '<div class="detail-section"><div class="detail-section-title">Financial</div><div class="detail-grid">';
    html += _rowMoney('Annual Rent', fb.annual_rent);
    html += _rowMoney('Rent / SF', fb.rent_per_sf || fb.shell_rent);
    html += _rowMoney('Estimated Value', fb.value || fb.estimated_value);
    html += _rowMoney('Sale Price', fb.sale_price || fb.price);
    html += '</div></div>';
  }

  // Lease section
  if (fb.lease_start || fb.lease_end || fb.firm_term_start || fb.firm_term_end || fb.term_remaining) {
    html += '<div class="detail-section"><div class="detail-section-title">Lease Terms</div><div class="detail-grid">';
    html += _row('Lease Start', _fmtDate(fb.lease_start || fb.firm_term_start));
    html += _row('Lease End', _fmtDate(fb.lease_end || fb.firm_term_end));
    html += _row('Term Remaining', fb.term_remaining ? fb.term_remaining + ' years' : null);
    html += '</div></div>';
  }

  // Ownership section
  if (fb.owner_name || fb.lessor_name || fb.grantor || fb.grantee) {
    html += '<div class="detail-section"><div class="detail-section-title">Ownership</div><div class="detail-grid">';
    html += _row('Owner / Lessor', fb.owner_name || fb.lessor_name || fb.grantor);
    html += _row('Buyer / Grantee', fb.buyer_name || fb.grantee);
    html += _row('Transfer Date', _fmtDate(fb.sale_date || fb.transfer_date));
    html += '</div></div>';
  }

  html += _udActionButtons();
  html += _udResearchLinks();
  return html;
}

// ─── LEASE TAB ───────────────────────────────────────────────────────────────

function _udTabLease() {
  const leases = _udCache.leases;
  // If no lease view data, try to show lease info from the fallback record
  if (!leases || leases.length === 0) {
    const fb = _udCache.fallback;
    if (fb && (fb.lease_start || fb.lease_end || fb.firm_term_start || fb.annual_rent || fb.lease_number)) {
      let html = '<div class="detail-section"><div class="detail-section-title">Lease Details (from search record)</div><div class="detail-grid">';
      html += _row('Lease Number', fb.lease_number);
      html += _row('Tenant', fb.tenant_agency || fb.tenant_operator);
      html += _row('Lease Start', _fmtDate(fb.lease_start || fb.firm_term_start));
      html += _row('Lease End', _fmtDate(fb.lease_end || fb.firm_term_end));
      html += _row('Term Remaining', fb.term_remaining ? fb.term_remaining + ' years' : null);
      html += _rowMoney('Annual Rent', fb.annual_rent);
      html += _rowMoney('Rent / SF', fb.rent_per_sf || fb.shell_rent);
      html += _row('Lessor', fb.lessor_name);
      html += '</div></div>';
      return html;
    }
    return '<div class="detail-empty">No lease data available</div>';
  }

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
    html += _rowHtml('Term Remaining', l.term_remaining_years != null ? (Number(l.term_remaining_years) < 0 ? '<span style="color:var(--red)">Expired</span>' : Number(l.term_remaining_years).toFixed(1) + ' yrs') : null);
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
  html += _rowHtml('Utilization', r.capacity_utilization_pct != null ? _utilBar(Number(r.capacity_utilization_pct)) : null);
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
  if (r.patient_trend_3yr != null) html += _rowHtml('3-Yr Trend', _trendArrow(r.patient_trend_3yr));
  html += '</div></div>';

  // ── FINANCIAL (TTM) ──
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Financial Performance (TTM)</div>';
  html += '<div class="detail-grid">';
  html += _rowMoney('Revenue', r.ttm_revenue);
  html += _rowMoney('Operating Costs', r.ttm_operating_costs);
  html += _rowMoney('Operating Profit', r.ttm_operating_profit);
  html += _rowHtml('Operating Margin', r.ttm_operating_margin != null ? _marginBadge(Number(r.ttm_operating_margin)) : null);
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
      html += _rowHtml('TTM vs Estimate', _trendArrow(pctDiff, 'variance'));
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
  html += _rowHtml('Star Rating', r.star_rating != null ? _stars(Number(r.star_rating)) : null);
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

  // ── COMPARATIVE RANKINGS (PATIENTS) ──
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Comparative Rankings (Patients)</div>';
  html += _rankingBar('County', r.county_patient_rank, r.county_total, r.county);
  html += _rankingBar('State', r.state_patient_rank, r.state_total, r.state);
  html += _rankingBar('Operator', r.operator_patient_rank, r.operator_total, r.operator_name);
  html += _rankingBar('National', r.national_patient_rank, r.national_total);
  html += '</div>';

  // ── COMPARATIVE RANKINGS (REVENUE) ──
  if (r.state_revenue_rank || r.county_revenue_rank || r.national_revenue_rank) {
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">Comparative Rankings (Revenue)</div>';
    html += _rankingBar('County', r.county_revenue_rank, r.county_total, r.county);
    html += _rankingBar('State', r.state_revenue_rank, r.state_total, r.state);
    html += _rankingBar('Operator', r.operator_revenue_rank, r.operator_revenue_total || r.operator_total, r.operator_name);
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

  // If no ownership data but fallback has ownership fields, show them
  if (!own && chain.length === 0) {
    const fb = _udCache.fallback;
    if (fb && (fb.owner_name || fb.lessor_name || fb.grantor || fb.grantee || fb.buyer_name)) {
      html += '<div class="detail-section"><div class="detail-section-title">Ownership (from search record)</div><div class="detail-grid">';
      html += _row('Owner / Lessor', fb.owner_name || fb.lessor_name || fb.grantor);
      html += _row('Buyer / Grantee', fb.buyer_name || fb.grantee);
      html += _row('Transfer Date', _fmtDate(fb.sale_date || fb.transfer_date));
      html += _rowMoney('Sale Price', fb.sale_price || fb.price);
      html += _row('Cap Rate', fb.cap_rate ? Number(fb.cap_rate).toFixed(2) + '%' : null);
      html += '</div></div>';
      return html;
    }
  }

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

  html += _udAssistantSection('ownership', 'Ownership Assistant', 'Summarize the ownership picture, identify the likely owner or decision-maker, and suggest the next research steps.');

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

// ─── INTEL TAB ────────────────────────────────────────────────────────────────

function _udTabIntel() {
  if (!_udCache) return '<div class="detail-empty">No data loaded</div>';
  const propertyId = _udCache.ids?.property_id;
  if (!propertyId) return '<div class="detail-empty">No property ID</div>';

  let html = '';

  html += _udAssistantSection('intel', 'Research Assistant', 'Turn the current notes and property context into a clean analyst summary and recommended next actions.');
  html += _udResearchIntakeSection();

  // ── PRIOR SALE SECTION ──────────────────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title" style="cursor:pointer;user-select:none" onclick="this.parentElement.querySelector(\'.intel-prior-sale\').style.display = this.parentElement.querySelector(\'.intel-prior-sale\').style.display === \'none\' ? \'block\' : \'none\'">Prior Sale</div>';
  html += '<div class="intel-prior-sale" style="display:block">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Sale Date</label>';
  html += '<input id="intelSaleDate" type="date" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Sale Price ($)</label>';
  html += '<input id="intelSalePrice" type="number" placeholder="0" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Cap Rate at Sale (%)</label>';
  html += '<input id="intelCapRateSale" type="number" placeholder="0.00" step="0.01" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Buyer</label>';
  html += '<input id="intelBuyer" type="text" placeholder="Entity name" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Seller</label>';
  html += '<input id="intelSeller" type="text" placeholder="Entity name" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '</div>';
  html += '<button onclick="_intelSavePriorSale()" style="margin-top:10px;width:100%;padding:8px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer">Save Prior Sale</button>';
  html += '</div></div>';

  // ── LOAN / DEBT SECTION ─────────────────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title" style="cursor:pointer;user-select:none" onclick="this.parentElement.querySelector(\'.intel-loan\').style.display = this.parentElement.querySelector(\'.intel-loan\').style.display === \'none\' ? \'block\' : \'none\'">Loan / Debt</div>';
  html += '<div class="intel-loan" style="display:block">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Lender</label>';
  html += '<input id="intelLender" type="text" placeholder="Bank or fund name" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Loan Amount ($)</label>';
  html += '<input id="intelLoanAmount" type="number" placeholder="0" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Interest Rate (%)</label>';
  html += '<input id="intelInterestRate" type="number" placeholder="0.00" step="0.01" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Loan Type</label>';
  html += '<select id="intelLoanType" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)">';
  html += '<option value="">—</option>';
  ['Fixed', 'Variable', 'Bridge', 'CMBS', 'Agency', 'Other'].forEach(t => {
    html += `<option value="${t}">${t}</option>`;
  });
  html += '</select></div>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Origination Date</label>';
  html += '<input id="intelOrigDate" type="date" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Maturity Date</label>';
  html += '<input id="intelMatDate" type="date" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Amortization (years)</label>';
  html += '<input id="intelAmortization" type="number" placeholder="0" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Recourse</label>';
  html += '<select id="intelRecourse" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)">';
  html += '<option value="">—</option>';
  ['Recourse', 'Non-Recourse', 'Partial'].forEach(t => {
    html += `<option value="${t}">${t}</option>`;
  });
  html += '</select></div>';
  html += '</div>';
  html += '<div style="margin-top:8px"><label style="font-size:11px;font-weight:600;color:var(--text2)">LTV (%)</label>';
  html += '<input id="intelLTV" type="number" placeholder="0.00" step="0.01" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<button onclick="_intelSaveLoan()" style="margin-top:10px;width:100%;padding:8px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer">Save Loan Info</button>';
  html += '</div></div>';

  // ── CASH FLOW / VALUATION SECTION ───────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title" style="cursor:pointer;user-select:none" onclick="this.parentElement.querySelector(\'.intel-cashflow\').style.display = this.parentElement.querySelector(\'.intel-cashflow\').style.display === \'none\' ? \'block\' : \'none\'">Cash Flow / Valuation</div>';
  html += '<div class="intel-cashflow" style="display:block">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Annual Rent / NOI ($)</label>';
  html += '<input id="intelAnnualRent" type="number" placeholder="0" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Rent Per SF ($/SF)</label>';
  html += '<input id="intelRentPerSF" type="number" placeholder="0.00" step="0.01" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '</div>';
  html += '<div style="margin-top:8px"><label style="font-size:11px;font-weight:600;color:var(--text2)">Expense Type (NNN, Gross, etc.)</label>';
  html += '<input id="intelExpenseType" type="text" placeholder="e.g., NNN, Modified Gross" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Estimated Value ($)</label>';
  html += '<input id="intelEstValue" type="number" placeholder="0" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Current Cap Rate (%)</label>';
  html += '<input id="intelCurrentCapRate" type="number" placeholder="0.00" step="0.01" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '</div>';
  html += '<button onclick="_intelSaveCashFlow()" style="margin-top:10px;width:100%;padding:8px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer">Save Cash Flow</button>';
  html += '</div></div>';

  // ── RESEARCH NOTES SECTION ──────────────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title" style="cursor:pointer;user-select:none" onclick="this.parentElement.querySelector(\'.intel-notes\').style.display = this.parentElement.querySelector(\'.intel-notes\').style.display === \'none\' ? \'block\' : \'none\'">Research Notes</div>';
  html += '<div class="intel-notes" style="display:block">';
  html += '<textarea id="intelResearchNotes" rows="4" placeholder="Free-form research notes..." style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);resize:vertical;font-family:inherit;box-sizing:border-box;margin-bottom:8px"></textarea>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Source / Date</label>';
  html += '<input id="intelResearchSource" type="text" placeholder="e.g., Website, Call, Loopnet" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Date Found</label>';
  html += '<input id="intelResearchDate" type="date" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '</div>';
  html += '<button onclick="_intelSaveNotes()" style="margin-top:10px;width:100%;padding:8px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer">Save Notes</button>';
  html += '</div></div>';

  return html;
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
const _SF_BASE = 'https://northmarqcapital.lightning.force.com/lightning/r';

/** Build a styled quick-link button */
function _qlBtn(label, url, icon, color) {
  if (!url) return '';
  return `<a href="${esc(url)}" target="_blank" rel="noopener" class="ql-btn" style="--ql-color:${color}" title="${esc(label)}">
    <span class="ql-icon">${icon}</span>
    <span class="ql-label">${esc(label)}</span>
  </a>`;
}

function _udAssistantSection(mode, title, subtitle) {
  const state = _udAssistantState[mode] || { loading: false, reply: '', error: '' };
  let body = '<div class="assistant-status">No analysis generated yet.</div>';
  if (state.loading) {
    body = '<div class="assistant-status"><span class="spinner" style="width:14px;height:14px"></span> Working...</div>';
  } else if (state.error) {
    body = `<div class="assistant-status assistant-error">${esc(state.error)}</div>`;
  } else if (state.reply) {
    body = `<div class="assistant-copy">${typeof formatCopilotText === 'function' ? formatCopilotText(state.reply) : esc(state.reply)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="q-action" onclick="_udCopyAssistantReply('${mode}')">Copy</button>
        ${mode === 'ownership' ? `<button class="q-action" onclick="_udApplyAssistantFields('${mode}')">Apply Extracted Facts to Fields</button>` : ''}
        ${mode === 'ownership' ? `<button class="q-action primary" onclick="_udSaveReviewedOwnership()">Save Reviewed Ownership</button>` : ''}
        <button class="q-action primary" onclick="_udApplyAssistantReply('${mode}')">${mode === 'ownership' ? 'Apply to Ownership Notes' : 'Apply to Research Notes'}</button>
      </div>`;
  }

  return `<div class="detail-section">
    <div class="detail-section-title">${esc(title)}</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px">${esc(subtitle)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="q-action primary" onclick="_udAskAssistant('${mode}')">Assist</button>
      <button class="q-action" onclick="${mode === 'ownership' ? 'openResearchInChatGPT()' : 'openResearchInClaude()'}">${mode === 'ownership' ? 'Export to ChatGPT' : 'Export to Claude'}</button>
    </div>
    <div id="udAssistantPanel_${mode}" class="assistant-panel">${body}</div>
  </div>`;
}

function _udBuildAssistantPrompt(mode) {
  if (!_udCache || !_udCache.property) return '';
  const p = _udCache.property || {};
  const own = _udCache.ownership || {};
  const fallback = _udCache.fallback || {};
  const ownNotes = document.getElementById('udOwnNotes')?.value?.trim() || '';
  const intelNotes = document.getElementById('intelResearchNotes')?.value?.trim() || '';

  if (mode === 'ownership') {
    return [
      'You are assisting with an ownership resolution workflow in commercial real estate.',
      'Focus on who likely owns the asset, who to contact, and what remains unresolved.',
      '',
      `Property: ${p.page_title || p.facility_name || p.address || 'Unknown property'}`,
      `Address: ${p.address || 'N/A'}, ${p.city || 'N/A'}, ${p.state || 'N/A'}`,
      `County: ${p.county || 'Unknown'}`,
      `Recorded owner: ${own.recorded_owner || fallback.recorded_owner || 'Unknown'}`,
      `True owner: ${own.true_owner || fallback.true_owner || 'Unknown'}`,
      `Owner type: ${own.owner_type || fallback.owner_type || 'Unknown'}`,
      `Contact name: ${own.contact_1_name || own.contact_name || 'Unknown'}`,
      `Contact email: ${own.contact_email || 'Unknown'}`,
      `Contact phone: ${own.contact_phone || 'Unknown'}`,
      `Research notes: ${ownNotes || 'None entered'}`,
      '',
      'Return in this format:',
      '1. Ownership summary',
      '2. Likely best contact',
      '3. Evidence and gaps',
      '4. Recommended next 3 actions',
      '5. Draft ownership note to save',
      '6. Structured ownership facts JSON',
      'For section 6, return only valid JSON inside a ```json fenced block with this shape:',
      '{',
      '  "ownership": {',
      '    "recorded_owner": "string or null",',
      '    "true_owner": "string or null",',
      '    "owner_type": "individual|llc|reit|developer|fund|operator|other|null",',
      '    "contact_name": "string or null",',
      '    "contact_phone": "string or null",',
      '    "contact_email": "string or null",',
      '    "state_of_incorporation": "string or null"',
      '  }',
      '}',
    ].join('\n');
  }

  return [
    'You are assisting with a property research workflow in commercial real estate.',
    'Use the current property context and notes to produce a concise analyst update.',
    '',
    `Property: ${p.page_title || p.facility_name || p.address || 'Unknown property'}`,
    `Address: ${p.address || 'N/A'}, ${p.city || 'N/A'}, ${p.state || 'N/A'}`,
    `Domain: ${_udCache.db || 'unknown'}`,
    `Lease number: ${p.lease_number || fallback.lease_number || 'Unknown'}`,
    `Estimated value: ${p.estimated_value || 'Unknown'}`,
    `Current notes: ${intelNotes || 'None entered'}`,
    '',
    'Return in this format:',
    '1. Executive summary',
    '2. Key facts captured',
    '3. Missing facts still needed',
    '4. Recommended next 3 actions',
    '5. Draft research note to save',
  ].join('\n');
}

function _udRenderAssistantState(mode) {
  const panel = document.getElementById(`udAssistantPanel_${mode}`);
  if (!panel) return;
  const state = _udAssistantState[mode] || { loading: false, reply: '', error: '' };
  if (state.loading) {
    panel.innerHTML = '<div class="assistant-status"><span class="spinner" style="width:14px;height:14px"></span> Working...</div>';
    return;
  }
  if (state.error) {
    panel.innerHTML = `<div class="assistant-status assistant-error">${esc(state.error)}</div>`;
    return;
  }
  if (state.reply) {
    panel.innerHTML = `<div class="assistant-copy">${typeof formatCopilotText === 'function' ? formatCopilotText(state.reply) : esc(state.reply)}</div>`;
    return;
  }
  panel.innerHTML = '<div class="assistant-status">No analysis generated yet.</div>';
}

function _udResearchIntakeSection() {
  const intake = _udIntakeState || {};
  const meta = [intake.fileName, intake.fileType].filter(Boolean).join(' • ');
  return `<div class="detail-section">
    <div class="detail-section-title">Research Intake</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px">Paste copied research text or load a text-based file, then generate a clean analyst readout before saving notes.</div>
    <div class="intake-box">
      <div class="intake-meta">${esc(meta || 'No file loaded. Text-based files can be read locally in-browser.')}</div>
      ${intake.notice ? `<div class="intake-notice">${esc(intake.notice)}</div>` : ''}
      <input type="file" accept=".txt,.md,.csv,.json,.log,.html,.htm,.xml,.yaml,.yml,.rtf,.pdf,image/*" onchange="_intelHandleIntakeFile(this)" style="width:100%;margin-bottom:10px">
      ${intake.imageDataUrl ? `<div class="intake-preview"><img src="${esc(intake.imageDataUrl)}" alt="Research intake screenshot preview"></div>` : ''}
      <textarea id="intelIntakeText" rows="8" placeholder="Paste copied text, OCR output, broker notes, call notes, listing text, or extracted document text. You can also paste a screenshot directly into this box." oninput="_intelUpdateIntakeText(this.value)" onpaste="_intelHandleIntakePaste(event)" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);resize:vertical;font-family:inherit;box-sizing:border-box">${esc(intake.text || '')}</textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="q-action primary" onclick="_intelAnalyzeIntake()">Analyze Intake</button>
        <button class="q-action" onclick="_intelClearIntake()">Clear</button>
      </div>
    </div>
    ${_intelRenderIntakeAnalysis()}
  </div>`;
}

function _intelRenderIntakeAnalysis() {
  const intake = _udIntakeState || {};
  let body = '<div class="assistant-status">No intake analysis generated yet.</div>';
  if (intake.loading) {
    body = '<div class="assistant-status"><span class="spinner" style="width:14px;height:14px"></span> Working...</div>';
  } else if (intake.error) {
    body = `<div class="assistant-status assistant-error">${esc(intake.error)}</div>`;
  } else if (intake.analysis) {
    body = `<div class="assistant-copy">${typeof formatCopilotText === 'function' ? formatCopilotText(intake.analysis) : esc(intake.analysis)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="q-action" onclick="_intelCopyIntakeAnalysis()">Copy</button>
        <button class="q-action" onclick="_intelApplyIntakeFields()">Apply Extracted Facts to Fields</button>
        <button class="q-action primary" onclick="_intelSaveReviewed()">Save Reviewed Intel</button>
        <button class="q-action primary" onclick="_intelApplyIntakeAnalysis()">Apply to Research Notes</button>
      </div>`;
  }
  return `<div id="intelIntakeAnalysisPanel" class="assistant-panel" style="margin-top:12px">${body}</div>`;
}

function _intelUpdateIntakeText(value) {
  _udIntakeState.text = value || '';
}

function _intelReadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function _intelHandleIntakeFile(input) {
  const file = input?.files?.[0];
  if (!file) return;

  _udIntakeState.fileName = file.name || '';
  _udIntakeState.fileType = file.type || '';
  _udIntakeState.notice = '';
  _udIntakeState.error = '';

  const lowerName = (file.name || '').toLowerCase();
  const textExtensions = ['.txt', '.md', '.csv', '.json', '.log', '.html', '.htm', '.xml', '.yaml', '.yml', '.rtf'];
  const isTextFile = textExtensions.some((ext) => lowerName.endsWith(ext)) || (file.type && file.type.startsWith('text/'));
  const isPdf = lowerName.endsWith('.pdf') || file.type === 'application/pdf';
  const isImage = (file.type || '').startsWith('image/');

  if (isPdf) {
    _udIntakeState.notice = 'This file type is not extracted in-browser yet. Paste OCR or copied text into the box below, then analyze.';
    _udIntakeState.imageDataUrl = '';
    refreshDetailPanel();
    return;
  }

  if (isImage) {
    try {
      _udIntakeState.imageDataUrl = await _intelReadFileAsDataUrl(file);
      _udIntakeState.notice = 'Screenshot loaded for review-first analysis. Add any copied text below if you want the assistant to combine both.';
      _udIntakeState.error = '';
    } catch (e) {
      _udIntakeState.imageDataUrl = '';
      _udIntakeState.error = `Could not read ${file.name}: ${e.message}`;
    }
    refreshDetailPanel();
    return;
  }

  if (!isTextFile) {
    _udIntakeState.notice = 'This file type is not supported for local extraction yet. Paste copied text into the box below to continue.';
    _udIntakeState.imageDataUrl = '';
    refreshDetailPanel();
    return;
  }

  try {
    _udIntakeState.text = await file.text();
    _udIntakeState.notice = `Loaded ${file.name} for local review.`;
    _udIntakeState.imageDataUrl = '';
  } catch (e) {
    _udIntakeState.notice = '';
    _udIntakeState.error = `Could not read ${file.name}: ${e.message}`;
  }

  refreshDetailPanel();
}

async function _intelHandleIntakePaste(event) {
  const items = Array.from(event?.clipboardData?.items || []);
  const imageItem = items.find((item) => item.type && item.type.startsWith('image/'));
  if (!imageItem) return;

  const file = imageItem.getAsFile();
  if (!file) return;
  event.preventDefault();

  _udIntakeState.fileName = file.name || 'clipboard-image.png';
  _udIntakeState.fileType = file.type || 'image/png';
  _udIntakeState.error = '';

  try {
    _udIntakeState.imageDataUrl = await _intelReadFileAsDataUrl(file);
    _udIntakeState.notice = 'Pasted screenshot loaded for review-first analysis. Add copied text below if you want the assistant to combine both.';
  } catch (e) {
    _udIntakeState.imageDataUrl = '';
    _udIntakeState.error = `Could not read pasted screenshot: ${e.message}`;
  }

  refreshDetailPanel();
}

function _intelBuildIntakePrompt() {
  if (!_udCache?.property) return '';
  const p = _udCache.property || {};
  const fallback = _udCache.fallback || {};
  const intakeText = (_udIntakeState.text || '').trim();
  const hasImage = !!_udIntakeState.imageDataUrl;
  if (!intakeText && !hasImage) return '';

  return [
    'You are assisting with a research intake workflow in commercial real estate.',
    'Review the provided intake material and turn it into a concise analyst-ready output.',
    'Do not invent facts. Call out uncertainty clearly.',
    '',
    `Property: ${p.page_title || p.facility_name || p.address || 'Unknown property'}`,
    `Address: ${p.address || 'N/A'}, ${p.city || 'N/A'}, ${p.state || 'N/A'}`,
    `Domain: ${_udCache.db || 'unknown'}`,
    `Lease number: ${p.lease_number || fallback.lease_number || 'Unknown'}`,
    `Loaded file: ${_udIntakeState.fileName || 'None'}`,
    `Screenshot attached: ${hasImage ? 'Yes' : 'No'}`,
    '',
    hasImage ? 'A screenshot is attached. Use it as a review artifact, but note any ambiguity caused by image quality or missing context.' : '',
    intakeText ? 'Intake material:' : '',
    intakeText || '',
    '',
    'Return in this format:',
    '1. Executive summary',
    '2. Key extracted facts',
    '3. Potentially unreliable or unclear items',
    '4. Recommended next 3 actions',
    '5. Draft research note to save',
    '6. Structured facts JSON',
    'For section 6, return only valid JSON inside a ```json fenced block with this shape:',
    '{',
    '  "prior_sale": {',
    '    "sale_date": "YYYY-MM-DD or null",',
    '    "sale_price": number or null,',
    '    "cap_rate_sale": number or null,',
    '    "buyer": "string or null",',
    '    "seller": "string or null"',
    '  },',
    '  "loan": {',
    '    "lender": "string or null",',
    '    "loan_amount": number or null,',
    '    "interest_rate": number or null,',
    '    "loan_type": "Fixed|Variable|Bridge|CMBS|Agency|Other|null",',
    '    "origination_date": "YYYY-MM-DD or null",',
    '    "maturity_date": "YYYY-MM-DD or null",',
    '    "amortization_years": integer or null,',
    '    "recourse": "Recourse|Non-Recourse|Partial|null",',
    '    "ltv": number or null',
    '  },',
    '  "cash_flow": {',
    '    "annual_rent": number or null,',
    '    "rent_per_sf": number or null,',
    '    "expense_type": "string or null",',
    '    "estimated_value": number or null,',
    '    "current_cap_rate": number or null',
    '  }',
    '}',
  ].join('\n');
}

async function _intelAnalyzeIntake() {
  const prompt = _intelBuildIntakePrompt();
  if (!prompt) {
    showToast('Add intake text before analyzing', 'error');
    return;
  }

  _udIntakeState.loading = true;
  _udIntakeState.analysis = '';
  _udIntakeState.error = '';
  refreshDetailPanel();

  try {
    const reply = await invokeLccAssistant({
      message: prompt,
      context: {
        feature: 'detail_intake_assistant',
        property_id: _udCache.ids?.property_id || null,
        lease_number: _udCache.ids?.lease_number || null,
        domain: _udCache.db || null,
        file_name: _udIntakeState.fileName || null,
      },
      attachments: _udIntakeState.imageDataUrl ? [{
        type: 'image',
        mime_type: _udIntakeState.fileType || 'image/png',
        name: _udIntakeState.fileName || 'research-intake.png',
        data_url: _udIntakeState.imageDataUrl,
      }] : [],
      feature: 'detail_intake_assistant',
    });
    _udIntakeState.analysis = reply;
  } catch (e) {
    _udIntakeState.error = e.message;
  }

  _udIntakeState.loading = false;
  refreshDetailPanel();
}

async function _intelCopyIntakeAnalysis() {
  const analysis = _udIntakeState.analysis || '';
  if (!analysis) {
    showToast('No intake analysis to copy', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(analysis);
    showToast('Intake analysis copied', 'success');
  } catch {
    showToast('Copy failed', 'error');
  }
}

function _intelApplyIntakeAnalysis() {
  const analysis = _udIntakeState.analysis || '';
  if (!analysis) {
    showToast('No intake analysis to apply', 'error');
    return;
  }
  const target = document.getElementById('intelResearchNotes');
  if (!target) {
    showToast('Research notes field not available', 'error');
    return;
  }
  const draft = _udExtractAssistantSection(analysis, 5) || _udExtractAssistantSection(analysis, 1) || analysis;
  target.value = [target.value?.trim(), draft].filter(Boolean).join(target.value?.trim() ? '\n\n' : '');
  showToast('Research notes updated from intake analysis', 'success');
}

function _intelExtractStructuredFacts(text) {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function _intelSetFieldValue(id, value) {
  if (value === null || value === undefined || value === '') return false;
  const el = document.getElementById(id);
  if (!el) return false;
  el.value = String(value);
  return true;
}

function _intelApplyIntakeFields() {
  const analysis = _udIntakeState.analysis || '';
  if (!analysis) {
    showToast('No intake analysis to apply', 'error');
    return;
  }

  const facts = _intelExtractStructuredFacts(analysis);
  if (!facts) {
    showToast('No structured facts found in intake analysis', 'error');
    return;
  }

  let updated = 0;
  const priorSale = facts.prior_sale || {};
  const loan = facts.loan || {};
  const cashFlow = facts.cash_flow || {};

  updated += _intelSetFieldValue('intelSaleDate', priorSale.sale_date) ? 1 : 0;
  updated += _intelSetFieldValue('intelSalePrice', priorSale.sale_price) ? 1 : 0;
  updated += _intelSetFieldValue('intelCapRateSale', priorSale.cap_rate_sale) ? 1 : 0;
  updated += _intelSetFieldValue('intelBuyer', priorSale.buyer) ? 1 : 0;
  updated += _intelSetFieldValue('intelSeller', priorSale.seller) ? 1 : 0;

  updated += _intelSetFieldValue('intelLender', loan.lender) ? 1 : 0;
  updated += _intelSetFieldValue('intelLoanAmount', loan.loan_amount) ? 1 : 0;
  updated += _intelSetFieldValue('intelInterestRate', loan.interest_rate) ? 1 : 0;
  updated += _intelSetFieldValue('intelLoanType', loan.loan_type) ? 1 : 0;
  updated += _intelSetFieldValue('intelOrigDate', loan.origination_date) ? 1 : 0;
  updated += _intelSetFieldValue('intelMatDate', loan.maturity_date) ? 1 : 0;
  updated += _intelSetFieldValue('intelAmortization', loan.amortization_years) ? 1 : 0;
  updated += _intelSetFieldValue('intelRecourse', loan.recourse) ? 1 : 0;
  updated += _intelSetFieldValue('intelLTV', loan.ltv) ? 1 : 0;

  updated += _intelSetFieldValue('intelAnnualRent', cashFlow.annual_rent) ? 1 : 0;
  updated += _intelSetFieldValue('intelRentPerSF', cashFlow.rent_per_sf) ? 1 : 0;
  updated += _intelSetFieldValue('intelExpenseType', cashFlow.expense_type) ? 1 : 0;
  updated += _intelSetFieldValue('intelEstValue', cashFlow.estimated_value) ? 1 : 0;
  updated += _intelSetFieldValue('intelCurrentCapRate', cashFlow.current_cap_rate) ? 1 : 0;

  if (!updated) {
    showToast('Structured facts were present but no fields were populated', 'error');
    return;
  }

  showToast(`Applied ${updated} extracted field${updated === 1 ? '' : 's'} for review`, 'success');
}

function _intelClearIntake() {
  _udIntakeState = {
    fileName: '',
    fileType: '',
    notice: '',
    text: '',
    imageDataUrl: '',
    loading: false,
    analysis: '',
    error: '',
  };
  refreshDetailPanel();
}

function _udExtractAssistantSection(text, headingNumber) {
  if (!text) return '';
  const pattern = new RegExp(`(?:^|\\n)${headingNumber}\\.\\s+[^\\n]*\\n([\\s\\S]*?)(?=\\n\\d+\\.\\s+|$)`, 'i');
  const match = text.match(pattern);
  return (match?.[1] || '').trim();
}

function _udExtractStructuredFacts(text) {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function _udSetFieldValue(id, value) {
  if (value === null || value === undefined || value === '') return false;
  const el = document.getElementById(id);
  if (!el) return false;
  el.value = String(value);
  return true;
}

async function _udAskAssistant(mode) {
  // Guard against double-submit while request is in flight
  if (_udAssistantState[mode]?.loading) return;

  const prompt = _udBuildAssistantPrompt(mode);
  if (!prompt) {
    showToast('No record loaded', 'error');
    return;
  }

  _udAssistantState[mode] = { loading: true, reply: '', error: '' };
  _udRenderAssistantState(mode);

  try {
    const reply = await invokeLccAssistant({
      message: prompt,
      context: {
        feature: mode === 'ownership' ? 'detail_ownership_assistant' : 'detail_intel_assistant',
        property_id: _udCache.ids?.property_id || null,
        lease_number: _udCache.ids?.lease_number || null,
        domain: _udCache.db || null,
      },
      feature: mode === 'ownership' ? 'detail_ownership_assistant' : 'detail_intel_assistant',
    });
    _udAssistantState[mode] = { loading: false, reply, error: '' };
  } catch (e) {
    _udAssistantState[mode] = { loading: false, reply: '', error: e.message };
  }

  _udRenderAssistantState(mode);
}

async function _udCopyAssistantReply(mode) {
  const reply = _udAssistantState[mode]?.reply || '';
  if (!reply) {
    showToast('No assistant reply to copy', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(reply);
    showToast('Assistant reply copied', 'success');
  } catch {
    showToast('Copy failed', 'error');
  }
}

function _udApplyAssistantReply(mode) {
  const reply = _udAssistantState[mode]?.reply || '';
  if (!reply) {
    showToast('No assistant reply to apply', 'error');
    return;
  }

  const draft = _udExtractAssistantSection(reply, 5) || _udExtractAssistantSection(reply, 1) || reply;
  if (mode === 'ownership') {
    const target = document.getElementById('udOwnNotes');
    if (!target) {
      showToast('Ownership notes field not available', 'error');
      return;
    }
    target.value = [target.value?.trim(), draft].filter(Boolean).join(target.value?.trim() ? '\n\n' : '');
    showToast('Ownership notes updated from assistant', 'success');
    return;
  }

  const target = document.getElementById('intelResearchNotes');
  if (!target) {
    showToast('Research notes field not available', 'error');
    return;
  }
  target.value = [target.value?.trim(), draft].filter(Boolean).join(target.value?.trim() ? '\n\n' : '');
  showToast('Research notes updated from assistant', 'success');
}

function _udApplyAssistantFields(mode) {
  const reply = _udAssistantState[mode]?.reply || '';
  if (!reply) {
    showToast('No assistant reply to apply', 'error');
    return;
  }

  const facts = _udExtractStructuredFacts(reply);
  if (!facts) {
    showToast('No structured facts found in assistant reply', 'error');
    return;
  }

  if (mode !== 'ownership') {
    showToast('Structured field apply is not configured for this workflow', 'error');
    return;
  }

  const ownership = facts.ownership || {};
  let updated = 0;
  updated += _udSetFieldValue('udOwnRecorded', ownership.recorded_owner) ? 1 : 0;
  updated += _udSetFieldValue('udOwnTrue', ownership.true_owner) ? 1 : 0;
  updated += _udSetFieldValue('udOwnType', ownership.owner_type) ? 1 : 0;
  updated += _udSetFieldValue('udOwnContact', ownership.contact_name) ? 1 : 0;
  updated += _udSetFieldValue('udOwnPhone', ownership.contact_phone) ? 1 : 0;
  updated += _udSetFieldValue('udOwnEmail', ownership.contact_email) ? 1 : 0;
  updated += _udSetFieldValue('udOwnState', ownership.state_of_incorporation) ? 1 : 0;

  if (!updated) {
    showToast('Structured facts were present but no fields were populated', 'error');
    return;
  }

  showToast(`Applied ${updated} ownership field${updated === 1 ? '' : 's'} for review`, 'success');
}

function _qlActionBtn(label, onclick, icon, color) {
  if (!onclick) return '';
  return `<button type="button" class="ql-btn" style="--ql-color:${color};cursor:pointer" title="${esc(label)}" onclick="${esc(onclick)}">
    <span class="ql-icon">${icon}</span>
    <span class="ql-label">${esc(label)}</span>
  </button>`;
}

/** Research Quick Links — property-level research shortcuts */
/** Action buttons for advancing records through the pipeline */
function _udActionButtons() {
  if (!_udCache) return '';
  const db = _udCache.db;
  const fb = _udCache.fallback || {};
  const p = _udCache.property || {};

  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">Actions</div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">';

  if (db === 'gov') {
    html += `<button class="q-action primary" onclick="_udAction('add_to_pipeline')" style="padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Add to Pipeline</button>`;
    html += `<button class="q-action" onclick="_udAction('log_touchpoint')" style="padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">Log Touchpoint</button>`;
    html += `<button class="q-action" onclick="_udAction('create_task')" style="padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">Create Task</button>`;
  } else if (db === 'dia') {
    html += `<button class="q-action primary" onclick="_udAction('mark_lead')" style="padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Mark as Lead</button>`;
    html += `<button class="q-action" onclick="_udAction('add_to_pipeline')" style="padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">Add to Pipeline</button>`;
    html += `<button class="q-action" onclick="_udAction('log_touchpoint')" style="padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">Log Touchpoint</button>`;
    html += `<button class="q-action" onclick="_udAction('create_task')" style="padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">Create Task</button>`;
  }

  html += '</div></div>';
  return html;
}

async function _udAction(action) {
  if (!_udCache) return;
  const db = _udCache.db;
  const fb = _udCache.fallback || {};
  const p = _udCache.property || {};
  const id = p.property_id || fb.property_id || fb.clinic_id || fb.lead_id || fb.id;
  const title = p.page_title || p.facility_name || fb.tenant_operator || fb.tenant_agency || fb.facility_name || fb.address || 'Unknown';

  if (action === 'add_to_pipeline' && db === 'gov') {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (typeof LCC_USER !== 'undefined' && LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
      const res = await fetch('/api/gov-write?endpoint=lead-research', {
        method: 'POST', headers,
        body: JSON.stringify({ property_id: id, pipeline_status: 'prospect', address: p.address || fb.address, source_app: 'lcc' })
      });
      if (res.ok) { alert('Added to pipeline!'); return; }
      const err = await res.json().catch(() => ({}));
      alert('Could not add: ' + (err.error || res.status));
    } catch (e) { alert('Error: ' + e.message); }
    return;
  }

  if (action === 'mark_lead' && db === 'dia') {
    try {
      const qFn = typeof diaQuery === 'function' ? diaQuery : null;
      if (!qFn) { alert('Dialysis query not available'); return; }
      await qFn('research_queue_outcomes', null, {
        method: 'POST',
        body: { clinic_id: fb.clinic_id || fb.medicare_id, queue_type: 'lead', status: 'prospect', source_bucket: 'manual', notes: 'Marked as lead from detail panel' }
      });
      alert('Marked as lead!');
    } catch (e) { alert('Error: ' + e.message); }
    return;
  }

  if (action === 'log_touchpoint') {
    const notes = prompt('Touchpoint notes:');
    if (!notes) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (typeof LCC_USER !== 'undefined' && LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
      await fetch('/api/actions', {
        method: 'POST', headers,
        body: JSON.stringify({ action_type: 'log_activity', title: 'Touchpoint: ' + title, domain: db === 'gov' ? 'government' : 'dialysis', notes, entity_id: id })
      });
      alert('Touchpoint logged!');
    } catch (e) { alert('Error: ' + e.message); }
    return;
  }

  if (action === 'create_task') {
    const taskTitle = prompt('Task description:', 'Follow up on ' + title);
    if (!taskTitle) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (typeof LCC_USER !== 'undefined' && LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
      await fetch('/api/actions', {
        method: 'POST', headers,
        body: JSON.stringify({ action_type: 'create_task', title: taskTitle, domain: db === 'gov' ? 'government' : 'dialysis', entity_id: id, status: 'open' })
      });
      alert('Task created!');
    } catch (e) { alert('Error: ' + e.message); }
    return;
  }
}
window._udAction = _udAction;

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

  html += _qlActionBtn('ChatGPT Brief', 'openResearchInChatGPT()', '🤖', '#10a37f');
  html += _qlActionBtn('Claude Brief', 'openResearchInClaude()', '✦', '#d97706');

  html += '</div></div>';
  return html;
}

function buildResearchAssistantPrompt(provider = 'chatgpt') {
  if (!_udCache || !_udCache.property) return '';

  const p = _udCache.property || {};
  const own = _udCache.ownership || {};
  const fallback = _udCache.fallback || {};
  const ownershipNotes = document.getElementById('udOwnNotes')?.value?.trim() || '';
  const intelNotes = document.getElementById('intelResearchNotes')?.value?.trim() || '';
  const lines = [
    `You are helping with commercial real estate research inside Life Command Center.`,
    `Create a concise analyst-ready output for this property.`,
    '',
    'Property',
    `- Address: ${p.address || 'N/A'}`,
    `- City/State: ${p.city || 'N/A'}, ${p.state || 'N/A'}`,
    `- County: ${p.county || 'Unknown'}`,
    `- Domain: ${_udCache.db || 'unknown'}`,
    `- Property ID: ${p.property_id || fallback.property_id || 'N/A'}`,
    `- Lease Number: ${p.lease_number || fallback.lease_number || 'N/A'}`,
    '',
    'Ownership Context',
    `- Recorded owner: ${own.recorded_owner || fallback.recorded_owner || 'Unknown'}`,
    `- True owner: ${own.true_owner || fallback.true_owner || 'Unknown'}`,
    `- Owner type: ${own.recorded_owner_type || own.owner_type || fallback.owner_type || 'Unknown'}`,
    `- State of incorporation: ${fallback.state_of_incorporation || own.true_owner_state || own.recorded_owner_state || 'Unknown'}`,
    '',
    'Existing Notes',
    `- Ownership notes: ${ownershipNotes || 'None entered'}`,
    `- Research notes: ${intelNotes || 'None entered'}`,
    '',
    'Return in this format:',
    '1. Executive summary',
    '2. Most likely owner / decision-maker',
    '3. Evidence and unresolved questions',
    '4. Recommended next 3 research steps',
    '5. Draft CRM-safe follow-up note',
  ];

  if (provider === 'claude') {
    lines.push('Keep the output direct and analyst-friendly. Avoid filler.');
  }

  return lines.join('\n');
}

async function exportResearchToAssistant(provider) {
  const prompt = buildResearchAssistantPrompt(provider);
  if (!prompt) {
    showToast('No property loaded', 'error');
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(prompt);
    }
  } catch (e) {
    console.warn('Clipboard export warning:', e);
  }

  const target = provider === 'claude' ? 'https://claude.ai/chats' : 'https://chatgpt.com/';
  window.open(target, '_blank', 'noopener');
  showToast(`Research brief copied. Paste it into ${provider === 'claude' ? 'Claude' : 'ChatGPT'}.`, 'success');
}

function openResearchInChatGPT() {
  exportResearchToAssistant('chatgpt');
}

function openResearchInClaude() {
  exportResearchToAssistant('claude');
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

/** Row with raw HTML value (for utilization bars, trend arrows, margin badges, etc.) */
function _rowHtml(label, value) {
  if (value == null || value === '') return '';
  return `<div class="detail-row">
    <div class="detail-lbl">${esc(label)}</div>
    <div class="detail-val">${value}</div>
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
    const res = await fetch('/api/sync?action=outbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'log_to_sf', payload })
    });
    const data = await res.json();

    if (data.status === 'completed' || data.success) {
      showToast('Activity logged (SF generic + private notes saved)', 'success');
      document.getElementById('udLogNotes').value = '';
      // 2. Log FULL details to outbound_activities in Supabase (private)
      try {
        await _udLogOutbound(sfContactId, sfCompanyId, actType, actDate, outcome, notes);
      } catch (e) { console.warn('Outbound log fallback error:', e); }
      // 3. Bridge to canonical model
      canonicalBridge('log_call', {
        subject: actType,
        notes,
        outcome,
        domain: _udCache?.db || null,
        external_id: _udCache?.property?.property_id ? String(_udCache.property.property_id) : null,
        source_system: _udCache?.db === 'gov' ? 'gov_supabase' : 'dia_supabase',
        sf_contact_id: sfContactId,
        sf_company_id: sfCompanyId,
        activity_date: actDate
      });
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
  await applyInsertWithFallback({
    proxyBase: '/api/dia-query',
    table: 'outbound_activities',
    data: {
      sf_contact_id: sfContactId || null,
      sf_company_id: sfCompanyId || null,
      activity_type: actType,
      activity_date: actDate,
      status: outcome,
      notes: notes || null,
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      ref_id: _udCache?.property?.property_id ? String(_udCache.property.property_id) : null
    },
    source_surface: 'detail_outbound_activity',
    propagation_scope: 'outbound_activity'
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

  const subjectEl = document.getElementById('udTemplateSubject');
  const bodyEl = document.getElementById('udTemplateBody');
  if (subjectEl) subjectEl.textContent = merged.subject;
  if (bodyEl) bodyEl.innerHTML = merged.bodyHtml;
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
    // Brief flash to signal data refresh
    const body = document.getElementById('detailBody');
    if (body) {
      body.style.opacity = '0.3';
      body.style.transition = 'opacity 0.15s ease-out';
      setTimeout(() => { body.style.opacity = '1'; }, 150);
    }
    openUnifiedDetail(db, ids, fallback);
  }
}

/**
 * Save ownership resolution from the unified detail Ownership tab form
 * Upserts to: recorded_owners, true_owners, contacts, research_queue_outcomes
 * Patches properties to link the owner IDs
 */
async function _udSaveOwnership(options = {}) {
  const refresh = options.refresh !== false;
  const silent = options.silent === true;
  if (!_udCache) { showToast('No record loaded', 'error'); return; }
  const db = _udCache.db;
  const propertyId = _udCache.ids?.property_id;
  if (!propertyId) { showToast('No property ID — cannot save ownership', 'error'); return; }

  const recordedOwner = document.getElementById('udOwnRecorded')?.value?.trim() || null;
  const trueOwner = document.getElementById('udOwnTrue')?.value?.trim() || null;
  const ownerType = document.getElementById('udOwnType')?.value || null;
  const contactName = document.getElementById('udOwnContact')?.value?.trim() || null;
  const contactPhone = document.getElementById('udOwnPhone')?.value?.trim() || null;
  const contactEmail = document.getElementById('udOwnEmail')?.value?.trim() || null;
  const incState = document.getElementById('udOwnState')?.value?.trim() || null;
  const notes = document.getElementById('udOwnNotes')?.value?.trim() || null;

  const proxyBase = db === 'gov' ? '/api/gov-query' : '/api/dia-query';
  let recordedOwnerId = _udCache.ids?.recorded_owner_id || null;
  let trueOwnerId = _udCache.ids?.true_owner_id || null;
  let contactId = _udCache.ids?.contact_id || null;

  try {
    // ── Government domain: use closed-loop write service ──
    if (db === 'gov') {
      const writeResult = await govWriteService('ownership', {
        property_id: propertyId,
        recorded_owner: recordedOwner,
        true_owner: trueOwner,
        owner_type: ownerType
      });

      if (!silent) showToast('Ownership resolution saved!', 'success');

      // Bridge to canonical model with gov change metadata
      canonicalBridge('save_ownership', {
        domain: 'government',
        external_id: String(propertyId),
        source_system: 'gov_supabase',
        source_type: 'asset',
        user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
        owner_name: recordedOwner,
        true_owner_name: trueOwner,
        owner_type: ownerType,
        contact_name: contactName,
        notes: notes,
        gov_change_event_id: writeResult.change_event_id,
        gov_correlation_id: writeResult.correlation_id,
        source_record_id: propertyId,
        source_table: 'properties'
      });

      // Ensure canonical entity link exists for this gov property
      canonicalBridge('update_entity', {
        external_id: String(propertyId),
        source_system: 'gov_supabase',
        source_type: 'asset',
        fields: {
          name: _udCache.property?.address || _udCache.property?.page_title || `Property ${propertyId}`,
          address: _udCache.property?.address || null,
          city: _udCache.property?.city || null,
          state: _udCache.property?.state || null,
          asset_type: 'government_leased'
        }
      });

      if (refresh) refreshDetailPanel();
      return;
    }

    // ── Dialysis domain: keep existing direct-write flow ──
    // 1. Upsert recorded_owners table
    if (recordedOwner) {
      const recordedOwnerPayload = {
        name: recordedOwner,
        state_of_incorporation: incState || null,
        normalized_name: recordedOwner.toLowerCase()
      };

      if (recordedOwnerId) {
        // PATCH existing via mutation service
        const patchResult = await applyChangeWithFallback({
          proxyBase,
          table: 'recorded_owners',
          idColumn: 'recorded_owner_id',
          idValue: recordedOwnerId,
          data: recordedOwnerPayload,
          source_surface: 'clinic_workspace'
        });
        if (!patchResult.ok) console.error('Error patching recorded_owner:', (patchResult.errors || []).join(', '));
      } else {
        const res = await applyInsertWithFallback({
          proxyBase,
          table: 'recorded_owners',
          data: recordedOwnerPayload,
          source_surface: 'ownership_detail',
          propagation_scope: 'ownership_helper_record'
        });
        if (res.ok) {
          const created = Array.isArray(res.rows) ? res.rows[0] : null;
          recordedOwnerId = created.recorded_owner_id;
        } else {
          console.error('Error creating recorded_owner:', res.errors || []);
        }
      }
    }

    // 2. Upsert true_owners table
    if (trueOwner) {
      const trueOwnerPayload = {
        name: trueOwner,
        owner_type: ownerType || null,
        contact_1_name: contactName || null,
        notes: notes || null
      };

      if (trueOwnerId) {
        // PATCH existing via mutation service
        const patchResult = await applyChangeWithFallback({
          proxyBase,
          table: 'true_owners',
          idColumn: 'true_owner_id',
          idValue: trueOwnerId,
          data: trueOwnerPayload,
          source_surface: 'clinic_workspace'
        });
        if (!patchResult.ok) console.error('Error patching true_owner:', (patchResult.errors || []).join(', '));
      } else {
        const res = await applyInsertWithFallback({
          proxyBase,
          table: 'true_owners',
          data: trueOwnerPayload,
          source_surface: 'ownership_detail',
          propagation_scope: 'ownership_helper_record'
        });
        if (res.ok) {
          const created = Array.isArray(res.rows) ? res.rows[0] : null;
          trueOwnerId = created.true_owner_id;
        } else {
          console.error('Error creating true_owner:', res.errors || []);
        }
      }
    }

    // 3. Upsert contacts table for contact info
    if (contactName || contactEmail || contactPhone) {
      const contactPayload = {
        name: contactName || null,
        email: contactEmail || null,
        phone: contactPhone || null,
        contact_type: 'owner'
      };

      if (contactId) {
        // PATCH existing via mutation service
        const patchResult = await applyChangeWithFallback({
          proxyBase,
          table: 'contacts',
          idColumn: 'contact_id',
          idValue: contactId,
          data: contactPayload,
          source_surface: 'clinic_workspace'
        });
        if (!patchResult.ok) console.error('Error patching contact:', (patchResult.errors || []).join(', '));
      } else {
        const res = await applyInsertWithFallback({
          proxyBase,
          table: 'contacts',
          data: contactPayload,
          source_surface: 'ownership_detail',
          propagation_scope: 'ownership_contact_record'
        });
        if (res.ok) {
          const created = Array.isArray(res.rows) ? res.rows[0] : null;
          contactId = created.contact_id;
        } else {
          console.error('Error creating contact:', res.errors || []);
        }
      }
    }

    // 4. PATCH properties to link the owner IDs via mutation service
    if (recordedOwnerId || trueOwnerId) {
      const propertyPayload = {};
      if (recordedOwnerId) propertyPayload.recorded_owner_id = recordedOwnerId;
      if (trueOwnerId) propertyPayload.true_owner_id = trueOwnerId;

      const propResult = await applyChangeWithFallback({
        proxyBase,
        table: 'properties',
        idColumn: 'property_id',
        idValue: propertyId,
        data: propertyPayload,
        source_surface: 'clinic_workspace',
        notes: 'Ownership resolution — linking owner IDs'
      });
      if (!propResult.ok) console.error('Error patching property owner links:', (propResult.errors || []).join(', '));
    }

    // 5. Save to research_queue_outcomes as a log entry
    const clinicId = _udCache.fallback?.clinic_id || _udCache.fallback?.medicare_id || null;
    if (clinicId) {
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
      const res = await applyInsertWithFallback({
        proxyBase,
        table: 'research_queue_outcomes',
        idColumn: 'clinic_id',
        recordIdentifier: clinicId,
        data: payload,
        source_surface: db === 'gov' ? 'gov_ownership_detail' : 'dialysis_ownership_detail',
        propagation_scope: 'research_queue_outcome'
      });
      if (!res.ok) console.error('Error creating research_queue_outcome:', res.errors || []);
    }

    if (!silent) showToast('Ownership resolution saved!', 'success');
    canonicalBridge('save_ownership', {
      domain: 'dialysis',
      external_id: String(propertyId),
      source_system: 'dia_supabase',
      source_type: 'asset',
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      owner_name: recordedOwner,
      true_owner_name: trueOwner,
      owner_type: ownerType,
      contact_name: contactName,
      notes: notes
    });
    if (refresh) refreshDetailPanel();
  } catch (e) {
    console.error('Ownership save error:', e);
    showToast('Error saving ownership: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTEL TAB SAVE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function _intelSavePriorSale(options = {}) {
  const refresh = options.refresh !== false;
  const silent = options.silent === true;
  if (!_udCache) { showToast('No record loaded', 'error'); return; }
  const propertyId = _udCache.ids?.property_id;
  if (!propertyId) { showToast('No property ID', 'error'); return; }
  const db = _udCache.db;
  const proxyBase = db === 'gov' ? '/api/gov-query' : '/api/dia-query';

  const saleDate = document.getElementById('intelSaleDate')?.value || null;
  const salePrice = document.getElementById('intelSalePrice')?.value || null;
  const capRate = document.getElementById('intelCapRateSale')?.value || null;
  const buyer = document.getElementById('intelBuyer')?.value?.trim() || null;
  const seller = document.getElementById('intelSeller')?.value?.trim() || null;

  try {
    const payload = {
      property_id: propertyId,
      sale_date: saleDate || null,
      sold_price: salePrice ? parseFloat(salePrice) : null,
      cap_rate: capRate ? parseFloat(capRate) : null,
      buyer_name: buyer,
      seller_name: seller
    };
    const res = await applyInsertWithFallback({
      proxyBase,
      table: 'sales_transactions',
      idColumn: 'property_id',
      recordIdentifier: propertyId,
      data: payload,
      source_surface: db === 'gov' ? 'gov_intel_detail' : 'dialysis_intel_detail',
      propagation_scope: 'prior_sale_record'
    });
    if (!res.ok) { console.error('Sale save error:', res.errors || []); showToast('Error saving sale', 'error'); return; }
    if (!silent) showToast('Prior sale saved!', 'success');
    canonicalBridge('log_activity', {
      title: 'Prior sale recorded',
      domain: db === 'gov' ? 'government' : 'dialysis',
      source_system: db === 'gov' ? 'gov_supabase' : 'dia_supabase',
      external_id: String(propertyId),
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      property_name: _udCache.property?.page_title || _udCache.property?.facility_name || _udCache.property?.address || null,
      metadata: { sale_date: saleDate, sale_price: salePrice, buyer: buyer, seller: seller }
    });
    if (refresh) refreshDetailPanel();
  } catch (e) {
    console.error('Prior sale save error:', e);
    showToast('Error: ' + e.message, 'error');
  }
}

async function _intelSaveLoan(options = {}) {
  const refresh = options.refresh !== false;
  const silent = options.silent === true;
  if (!_udCache) { showToast('No record loaded', 'error'); return; }
  const propertyId = _udCache.ids?.property_id;
  if (!propertyId) { showToast('No property ID', 'error'); return; }
  const db = _udCache.db;
  const proxyBase = db === 'gov' ? '/api/gov-query' : '/api/dia-query';

  const lender = document.getElementById('intelLender')?.value?.trim() || null;
  const loanAmount = document.getElementById('intelLoanAmount')?.value || null;
  const interestRate = document.getElementById('intelInterestRate')?.value || null;
  const loanType = document.getElementById('intelLoanType')?.value || null;
  const origDate = document.getElementById('intelOrigDate')?.value || null;
  const matDate = document.getElementById('intelMatDate')?.value || null;
  const amortization = document.getElementById('intelAmortization')?.value || null;
  const recourse = document.getElementById('intelRecourse')?.value || null;
  const ltv = document.getElementById('intelLTV')?.value || null;

  try {
    const payload = {
      property_id: propertyId,
      lender_name: lender,
      loan_amount: loanAmount ? parseFloat(loanAmount) : null,
      interest_rate_percent: interestRate ? parseFloat(interestRate) : null,
      loan_type: loanType || null,
      origination_date: origDate || null,
      maturity_date: matDate || null,
      loan_term: amortization ? parseInt(amortization) : null,
      recourse: recourse || null,
      loan_to_value: ltv ? parseFloat(ltv) : null
    };
    const res = await applyInsertWithFallback({
      proxyBase,
      table: 'loans',
      idColumn: 'property_id',
      recordIdentifier: propertyId,
      data: payload,
      source_surface: db === 'gov' ? 'gov_intel_detail' : 'dialysis_intel_detail',
      propagation_scope: 'loan_record'
    });
    if (!res.ok) { console.error('Loan save error:', res.errors || []); showToast('Error saving loan', 'error'); return; }
    if (!silent) showToast('Loan info saved!', 'success');
    canonicalBridge('log_activity', {
      title: 'Loan recorded',
      domain: db === 'gov' ? 'government' : 'dialysis',
      source_system: db === 'gov' ? 'gov_supabase' : 'dia_supabase',
      external_id: String(propertyId),
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      property_name: _udCache.property?.page_title || _udCache.property?.facility_name || _udCache.property?.address || null,
      metadata: { lender: lender, loan_amount: loanAmount, loan_type: loanType, maturity_date: matDate }
    });
    if (refresh) refreshDetailPanel();
  } catch (e) {
    console.error('Loan save error:', e);
    showToast('Error: ' + e.message, 'error');
  }
}

async function _intelSaveCashFlow(options = {}) {
  const refresh = options.refresh !== false;
  const silent = options.silent === true;
  if (!_udCache) { showToast('No record loaded', 'error'); return; }
  const propertyId = _udCache.ids?.property_id;
  if (!propertyId) { showToast('No property ID', 'error'); return; }
  const db = _udCache.db;
  const proxyBase = db === 'gov' ? '/api/gov-query' : '/api/dia-query';

  const annualRent = document.getElementById('intelAnnualRent')?.value || null;
  const rentPerSF = document.getElementById('intelRentPerSF')?.value || null;
  const expenseType = document.getElementById('intelExpenseType')?.value?.trim() || null;
  const estValue = document.getElementById('intelEstValue')?.value || null;
  const currentCapRate = document.getElementById('intelCurrentCapRate')?.value || null;

  try {
    const payload = {
      last_known_rent: annualRent ? parseFloat(annualRent) : null,
      current_value_estimate: estValue ? parseFloat(estValue) : null
    };
    const result = await applyChangeWithFallback({
      proxyBase,
      table: 'properties',
      idColumn: 'property_id',
      idValue: propertyId,
      data: payload,
      source_surface: 'clinic_workspace',
      notes: 'Cash flow / valuation update'
    });
    if (!result.ok) { console.error('Cash flow update error:', (result.errors || []).join(', ')); showToast('Error saving cash flow', 'error'); return; }
    if (!silent) showToast('Cash flow / valuation saved!', 'success');
    canonicalBridge('log_activity', {
      title: 'Cash flow estimate saved',
      domain: db === 'gov' ? 'government' : 'dialysis',
      source_system: db === 'gov' ? 'gov_supabase' : 'dia_supabase',
      external_id: String(propertyId),
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      property_name: _udCache.property?.page_title || _udCache.property?.facility_name || _udCache.property?.address || null,
      metadata: { annual_rent: annualRent, estimated_value: estValue, cap_rate: currentCapRate }
    });
    if (refresh) refreshDetailPanel();
  } catch (e) {
    console.error('Cash flow save error:', e);
    showToast('Error: ' + e.message, 'error');
  }
}

async function _intelSaveNotes(options = {}) {
  const refresh = options.refresh !== false;
  const silent = options.silent === true;
  if (!_udCache) { showToast('No record loaded', 'error'); return; }
  const propertyId = _udCache.ids?.property_id;
  if (!propertyId) { showToast('No property ID', 'error'); return; }
  const db = _udCache.db;
  const proxyBase = db === 'gov' ? '/api/gov-query' : '/api/dia-query';

  const notes = document.getElementById('intelResearchNotes')?.value?.trim() || null;
  const source = document.getElementById('intelResearchSource')?.value?.trim() || null;
  const dateFound = document.getElementById('intelResearchDate')?.value || null;

  if (!notes) { showToast('Please enter some research notes', 'error'); return; }

  try {
    const clinicId = _udCache.fallback?.clinic_id || _udCache.fallback?.medicare_id || null;
    const payload = {
      queue_type: 'intel_research',
      clinic_id: clinicId || null,
      status: 'completed',
      notes: [
        notes,
        source ? 'Source: ' + source : null,
        dateFound ? 'Date: ' + dateFound : null
      ].filter(Boolean).join(' | '),
      selected_property_id: propertyId,
      assigned_at: new Date().toISOString()
    };
    const res = await applyInsertWithFallback({
      proxyBase,
      table: 'research_queue_outcomes',
      idColumn: clinicId ? 'clinic_id' : 'selected_property_id',
      recordIdentifier: clinicId || propertyId,
      data: payload,
      source_surface: db === 'gov' ? 'gov_intel_detail' : 'dialysis_intel_detail',
      propagation_scope: 'research_queue_outcome'
    });
    if (!res.ok) { console.error('Notes save error:', res.errors || []); showToast('Error saving notes', 'error'); return; }
    if (!silent) showToast('Research notes saved!', 'success');
    canonicalBridge('log_activity', {
      title: 'Research notes updated',
      domain: db === 'gov' ? 'government' : 'dialysis',
      source_system: db === 'gov' ? 'gov_supabase' : 'dia_supabase',
      external_id: String(propertyId),
      user_name: (typeof LCC_USER !== 'undefined' && LCC_USER.display_name) || 'unknown',
      property_name: _udCache.property?.page_title || _udCache.property?.facility_name || _udCache.property?.address || null,
      metadata: { notes: notes, source: source, date_found: dateFound }
    });
    if (refresh) refreshDetailPanel();
  } catch (e) {
    console.error('Notes save error:', e);
    showToast('Error: ' + e.message, 'error');
  }
}

function _intelHasReviewedSectionValues() {
  return {
    priorSale: ['intelSaleDate', 'intelSalePrice', 'intelCapRateSale', 'intelBuyer', 'intelSeller'].some((id) => document.getElementById(id)?.value?.trim()),
    loan: ['intelLender', 'intelLoanAmount', 'intelInterestRate', 'intelLoanType', 'intelOrigDate', 'intelMatDate', 'intelAmortization', 'intelRecourse', 'intelLTV'].some((id) => document.getElementById(id)?.value?.trim()),
    cashFlow: ['intelAnnualRent', 'intelRentPerSF', 'intelExpenseType', 'intelEstValue', 'intelCurrentCapRate'].some((id) => document.getElementById(id)?.value?.trim()),
    notes: ['intelResearchNotes'].some((id) => document.getElementById(id)?.value?.trim()),
  };
}

async function _intelSaveReviewed() {
  const sections = _intelHasReviewedSectionValues();
  const planned = [
    sections.priorSale ? 'prior sale' : null,
    sections.loan ? 'loan' : null,
    sections.cashFlow ? 'cash flow' : null,
    sections.notes ? 'notes' : null,
  ].filter(Boolean);

  if (!planned.length) {
    showToast('No reviewed Intel fields to save', 'error');
    return;
  }

  try {
    if (sections.priorSale) await _intelSavePriorSale({ refresh: false, silent: true });
    if (sections.loan) await _intelSaveLoan({ refresh: false, silent: true });
    if (sections.cashFlow) await _intelSaveCashFlow({ refresh: false, silent: true });
    if (sections.notes) await _intelSaveNotes({ refresh: false, silent: true });
    showToast(`Saved reviewed Intel: ${planned.join(', ')}`, 'success');
    refreshDetailPanel();
  } catch (e) {
    console.error('Reviewed Intel save error:', e);
    showToast('Error saving reviewed Intel: ' + e.message, 'error');
  }
}

async function _udSaveReviewedOwnership() {
  const hasOwnershipValues = ['udOwnRecorded', 'udOwnTrue', 'udOwnType', 'udOwnContact', 'udOwnPhone', 'udOwnEmail', 'udOwnState', 'udOwnNotes']
    .some((id) => document.getElementById(id)?.value?.trim());
  if (!hasOwnershipValues) {
    showToast('No reviewed ownership fields to save', 'error');
    return;
  }
  await _udSaveOwnership({ refresh: true, silent: false });
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
window._intelSavePriorSale = _intelSavePriorSale;
window._intelSaveLoan = _intelSaveLoan;
window._intelSaveCashFlow = _intelSaveCashFlow;
window._intelSaveNotes = _intelSaveNotes;
window._intelSaveReviewed = _intelSaveReviewed;
window._intelHandleIntakeFile = _intelHandleIntakeFile;
window._intelUpdateIntakeText = _intelUpdateIntakeText;
window._intelAnalyzeIntake = _intelAnalyzeIntake;
window._intelHandleIntakePaste = _intelHandleIntakePaste;
window._intelCopyIntakeAnalysis = _intelCopyIntakeAnalysis;
window._intelApplyIntakeFields = _intelApplyIntakeFields;
window._intelApplyIntakeAnalysis = _intelApplyIntakeAnalysis;
window._intelClearIntake = _intelClearIntake;
window._udAskAssistant = _udAskAssistant;
window._udCopyAssistantReply = _udCopyAssistantReply;
window._udApplyAssistantFields = _udApplyAssistantFields;
window._udApplyAssistantReply = _udApplyAssistantReply;
window._udSaveReviewedOwnership = _udSaveReviewedOwnership;
