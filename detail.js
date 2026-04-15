// ============================================================================
// UNIFIED PROPERTY DETAIL PAGE
// Shared across Gov and Dialysis — fetches from normalized Supabase views
// Loaded after index.html, gov.js, dialysis.js
// ============================================================================

// Cache for the current detail data (avoids re-fetch on tab switch)
let _udCache = null;
// Helper: update the cache and mirror to window so cross-file consumers
// (e.g. renderDiaDetailOwnership in dialysis.js) can read chain/ownership.
function _setUdCache(v) { _udCache = v; window._udCache = v; }
let _udFormDirty = false; // track unsaved form edits for beforeunload guard

// Helper for safe parseFloat: converts empty strings to null instead of NaN
function _dpf(v) { return v && v.trim() ? parseFloat(v) : null; }

/**
 * Generic async button guard — disables button during operation, shows "Saving…",
 * re-enables on completion or error. Prevents double-clicks on any async save.
 * Usage: onclick="_udBtnGuard(this, _intelSavePriorSale)"
 */
async function _udBtnGuard(btn, fn, ...args) {
  if (!btn || btn.disabled) return;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving\u2026'; btn.style.opacity = '0.6';
  try { await fn(...args); _udFormDirty = false; } finally { btn.disabled = false; btn.textContent = orig; btn.style.opacity = ''; }
}

/**
 * Action button guard — same pattern but shows "Working…" instead of "Saving…"
 */
async function _udActionBtnGuard(btn, fn, ...args) {
  if (!btn || btn.disabled) return;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Working\u2026'; btn.style.opacity = '0.6';
  try { await fn(...args); } finally { btn.disabled = false; btn.textContent = orig; btn.style.opacity = ''; }
}

// ── beforeunload guard: warn if user navigates away with unsaved edits ──
window.addEventListener('beforeunload', function (e) {
  if (_udFormDirty) { e.preventDefault(); e.returnValue = ''; }
});
// Mark form dirty on input within the detail panel
document.addEventListener('input', function (e) {
  if (e.target.closest('#detailBody')) _udFormDirty = true;
});
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
async function openUnifiedDetail(db, ids, fallback, initialTab) {
  _setUdCache(null);
  _opsExtraCache = null; // reset operations extra data for new clinic
  _salesCache = null; // reset sales data for new property
  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');
  if (!panel || !overlay) return;

  fallback = fallback || {};  // guard against null/undefined callers

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

  const headerEl = document.getElementById('detailHeader');
  const tabsEl = document.getElementById('detailTabs');
  const bodyEl = document.getElementById('detailBody');

  if (headerEl) headerEl.innerHTML = `
    <button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>
    <div class="detail-header-info">
      <div style="flex:1;min-width:0">
        <div class="detail-title">${esc(title)}</div>
        <div class="detail-subtitle">${esc(loc)}</div>
      </div>
      <span class="detail-badge" style="background:${db === 'gov' ? 'var(--gov-green)' : 'var(--purple)'};color:#fff">${db === 'gov' ? 'GOV' : 'DIA'}</span>
    </div>
    <button class="detail-close" onclick="closeDetail()">&times;</button>`;

  // Render tab bar — highlight initialTab if provided, else first tab
  const tabs = ['Property', 'Lease', 'Operations', 'Ownership', 'Sales', 'Intel', 'History'];
  const activeTab = (initialTab && tabs.includes(initialTab)) ? initialTab : tabs[0];
  if (tabsEl) tabsEl.innerHTML = tabs.map(t =>
    `<button class="detail-tab ${t === activeTab ? 'active' : ''}" onclick="switchUnifiedTab('${t}')">${t}</button>`
  ).join('');
  // Store requested initial tab for use after data loads
  window._udInitialTab = activeTab;

  // Show spinner in body
  if (bodyEl) bodyEl.innerHTML =
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
    _setUdCache({ db, ids, property: null, leases: [], ownership: null, chain: [], rankings: null, fallback, _fallbackOnly: true });
    _udRenderFallbackHeader(db, fallback);
    if (bodyEl) bodyEl.innerHTML = _udRenderTab(activeTab);
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

    const settled = await Promise.allSettled(promises);
    let _partialFail = false;

    // Normalize results — govQuery returns {data,count}, diaQuery returns array
    const extract = (r) => {
      if (Array.isArray(r)) return r;
      if (r && r.data) return r.data;
      return [];
    };
    const safeExtract = (idx) => {
      if (settled[idx].status === 'fulfilled') return extract(settled[idx].value);
      console.warn('Detail load partial failure [' + idx + ']:', settled[idx].reason);
      _partialFail = true;
      return [];
    };

    const property = safeExtract(0)[0] || null;
    const leasesRaw = safeExtract(1) || [];
    const ownership = safeExtract(2)[0] || null;
    const chain = safeExtract(3) || [];
    const rankings = safeExtract(4)[0] || null;

    // Strip buyer-side stubs and duplicate rows. The DB unique index prevents
    // new duplicates, but historical rows may still arrive from v_lease_detail
    // until the backfill ships. See supabase/migrations/20260414213000_*.sql.
    const leases = _udFilterAndDedupeLeases(leasesRaw);

    if (_partialFail) showToast('Some detail sections failed to load — showing available data', 'error');

    // If all views returned empty, use the fallback record's fields as a synthetic property
    const allEmpty = !property && leases.length === 0 && !ownership && chain.length === 0;
    const synthProperty = allEmpty ? _udSynthPropertyFromFallback(fallback, db) : property;

    // Fetch LCC entity metadata (CoStar estimates) for this property by address.
    // These supplement v_lease_detail on the Lease tab when no executed lease
    // document is on file. Best-effort only — never blocks the detail render.
    let entityMeta = null;
    try {
      const lookupAddr = (synthProperty && synthProperty.address) || fallback.address;
      const lookupState = (synthProperty && synthProperty.state) || fallback.state;
      const lookupCity = (synthProperty && synthProperty.city) || fallback.city;
      if (lookupAddr) {
        const params = new URLSearchParams({ action: 'lookup_asset', address: lookupAddr });
        if (lookupCity) params.set('city', lookupCity);
        if (lookupState) params.set('state', lookupState);
        const entRes = await _entityApiFetch('/api/entities?' + params.toString());
        const ent = entRes?.entity || null;
        entityMeta = ent?.metadata || null;
      }
    } catch (e) {
      console.warn('entity metadata lookup failed', e);
    }

    _setUdCache({ db, ids, property: synthProperty, leases, ownership, chain, rankings, fallback, entityMeta, _fallbackOnly: allEmpty });

    // ── Dialysis Operations tab: auto-match CMS facility when rankings is empty ──
    // Uses the /api/cms-match?action=resolve endpoint to fuzzy-match the property's
    // address to medicare_clinics.medicare_id, cache the match in property_cms_link,
    // and return a compact CMS snapshot (rankings/quality/patient/payer/operator).
    if (db === 'dia' && propertyId && !rankings) {
      try {
        await _udResolveCmsFacility(propertyId);
      } catch (e) {
        console.warn('cms-match resolve failed:', e);
      }
    } else if (db === 'dia' && rankings && !_udCache.cms) {
      // Even when rankings exist (linked via medicare_clinics), derive operator/QIP/etc
      // for the enriched Operations tab from the medicare_id on the rankings row.
      if (rankings.medicare_id) {
        _udCache.cms = {
          medicare_id: rankings.medicare_id,
          match_score: 1.0,
          match_method: 'auto:medicare_clinics',
          source: 'rankings',
          operator: _udDetectOperator(rankings),
        };
      }
    }

    // Kick off a best-effort fetch for lease extensions + rent schedule.
    // These fill in the "No. of Extensions / Last Extension" and the Rent Roll
    // sub-view on the Lease tab. Never blocks the main render; on failure the
    // Lease tab simply renders without the enriched values.
    if (db === 'dia' && Array.isArray(leases) && leases.length > 0) {
      _udFetchLeaseEnrichment(leases).then((enrichment) => {
        if (!_udCache) return;
        _setUdCache({ ..._udCache, leaseExtensions: enrichment.extensions, leaseRentSchedule: enrichment.schedule });
        // Re-render if the Lease tab is currently active
        const activeTabEl = document.querySelector('#detailTabs .detail-tab.active');
        if (activeTabEl && activeTabEl.textContent.trim() === 'Lease') {
          const bodyEl = document.getElementById('detailBody');
          if (bodyEl) bodyEl.innerHTML = _udRenderTab('Lease');
        }
      }).catch((e) => { console.warn('lease enrichment fetch failed', e); });
    }

    // Update header with real data (page_title or fallback to tenant/address)
    if (synthProperty) {
      const realTitle = synthProperty.page_title || synthProperty.facility_name || fallback.tenant_operator || fallback.agency || synthProperty.address || fallback.address || '(Unknown)';
      const loc2 = (synthProperty.city || '') + (synthProperty.state ? ', ' + synthProperty.state : '');
      // "Not a Lead" button for dia-clinic records (dismiss from clinic lead pipeline)
      const dismissBtn = (db === 'dia' && (fallback.clinic_id || fallback.medicare_id))
        ? `<button onclick="_udDismissLead()" style="background:rgba(239,68,68,0.12);color:var(--red,#ef4444);border:1px solid rgba(239,68,68,0.25);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:Outfit,sans-serif;margin-right:6px" title="Mark as not a viable lead (hospital campus, etc.)">Not a Lead</button>`
        : '';
      if (headerEl) headerEl.innerHTML = `
        <div class="detail-header-info">
          <div style="flex:1">
            <div class="detail-title">${esc(realTitle)}</div>
            <div class="detail-subtitle">${esc(loc2)}${synthProperty.county ? ' · ' + esc(synthProperty.county) + ' County' : ''}</div>
            ${_udKeyFields(db, synthProperty, ownership)}
          </div>
          ${dismissBtn}
          <span class="detail-badge" style="background:${db === 'gov' ? 'var(--gov-green)' : 'var(--purple)'};color:#fff">${db === 'gov' ? 'GOV' : 'DIA'}</span>
          <button class="detail-close" onclick="closeDetail()">&times;</button>
        </div>`;
    }

    // Render active tab (preserve on refresh) or default to Property
    const activeTabEl = document.querySelector('#detailTabs .detail-tab.active');
    const activeTab = activeTabEl ? activeTabEl.textContent.trim() : 'Property';
    // Operations and Sales tabs need async data loading
    if (activeTab === 'Operations' && db === 'dia') {
      _udRenderOperationsAsync(bodyEl);
    } else if (activeTab === 'Sales') {
      _udRenderSalesAsync(bodyEl);
    } else {
      if (bodyEl) bodyEl.innerHTML = _udRenderTab(activeTab);
      if (activeTab === 'Intel') _intelRenderPriorSaleSummaryAsync();
    }

  } catch (err) {
    console.error('Unified detail load error:', err);
    showToast('Error loading details: ' + (err.message || 'unknown'), 'error');
    if (bodyEl) bodyEl.innerHTML =
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
        <button onclick="var _df=document.getElementById('ud-dismiss-form');if(_df)_df.remove()" style="padding:6px 14px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text2);font-size:12px;cursor:pointer;font-family:Outfit,sans-serif">Cancel</button>
        <button onclick="_udBtnGuard(this, _udSubmitDismiss)" style="padding:6px 14px;border:none;border-radius:6px;background:var(--red,#ef4444);color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:Outfit,sans-serif">Dismiss Lead</button>
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

  if (!(await lccConfirm('Dismiss this lead as not viable? This will remove it from the clinic leads queue.'))) return;

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
      if (rba) propPayload.building_sf = parseInt(rba, 10);
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
      } catch (e) { console.warn('Owner record save warning:', e); showToast('Warning: owner record not saved — ' + (e.message || 'unknown error'), 'warning'); }
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
  const bodyEl = document.getElementById('detailBody');
  // Operations tab may need async data loading
  if (tabName === 'Operations' && _udCache.db === 'dia') {
    _udRenderOperationsAsync(bodyEl);
  } else if (tabName === 'Sales') {
    _udRenderSalesAsync(bodyEl);
  } else {
    if (bodyEl) bodyEl.innerHTML = _udRenderTab(tabName);
    if (tabName === 'Intel') _intelRenderPriorSaleSummaryAsync();
  }
}

// ─── CMS FACILITY MATCH (property ↔ medicare_id) ─────────────────────────────
// Backs the Operations tab. When v_property_rankings has no row for a property,
// we call /api/cms-match?action=resolve to fuzzy-match the property address to
// a CMS medicare_id and cache the link in the Dialysis DB (property_cms_link).

function _udDetectOperator(row) {
  const raw = (row && (row.chain_organization || row.operator_name || row.facility_name)) || '';
  const name = String(raw).toLowerCase();
  if (!name) return { label: 'Unknown', key: 'unknown', color: 'var(--text3)' };
  if (/davita/.test(name))                   return { label: 'DaVita',          key: 'davita',  color: '#dc2626' };
  if (/fresenius|fmc|fkc/.test(name))        return { label: 'Fresenius (FMC)', key: 'fmc',     color: '#f59e0b' };
  if (/u\.?s\.?\s*renal|usrc/.test(name))    return { label: 'US Renal',        key: 'usrenal', color: '#3b82f6' };
  if (/satellite/.test(name))                return { label: 'Satellite',       key: 'satellite', color: '#8b5cf6' };
  if (/dialyze\s*direct/.test(name))         return { label: 'Dialyze Direct',  key: 'dialyzedirect', color: '#10b981' };
  return { label: 'Independent', key: 'indy', color: 'var(--text2)' };
}

/** Call /api/cms-match?action=resolve and merge the snapshot into _udCache. */
async function _udResolveCmsFacility(propertyId) {
  if (!_udCache) return null;
  const url = new URL('/api/cms-match', window.location.origin);
  url.searchParams.set('action', 'resolve');
  url.searchParams.set('property_id', propertyId);
  const headers = {};
  if (window._lccApiKey) headers['X-LCC-Key'] = window._lccApiKey;
  let resp;
  try {
    const r = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(25000) });
    if (!r.ok) { console.warn('cms-match resolve http', r.status); resp = { match: null, candidates: [] }; }
    else resp = await r.json();
  } catch (err) {
    console.warn('cms-match resolve fetch failed', err);
    return null;
  }
  // Populate cache
  _udCache.cms = {
    medicare_id: resp.medicare_id || null,
    match_score: resp.match_score || null,
    match_method: resp.match_method || null,
    source: resp.source || null,
    facility: resp.facility || null,
    quality: resp.quality || null,
    patient: resp.patient || null,
    trends: resp.trends || null,
    payer: resp.payer || null,
    cost: resp.cost || null,
    operator: resp.operator || _udDetectOperator(resp.facility || resp.rankings || {}),
    candidates: resp.candidates || [],
  };
  // If the resolver returned a rankings row, use it so Operations tab renders normally.
  if (resp.rankings) _udCache.rankings = resp.rankings;
  _setUdCache(_udCache);
  return resp;
}

/** Show the Match-facility typeahead card (fallback when auto-match fails). */
function _udRenderMatchFacilityCard() {
  const fb = _udCache?.fallback || {};
  const p  = _udCache?.property || {};
  const cms = _udCache?.cms || {};
  const candidates = cms.candidates || [];
  const addr   = p.address || fb.address || '';
  const city   = p.city || fb.city || '';
  const state  = p.state || fb.state || '';
  const zip    = p.zip_code || p.zip || fb.zip || fb.zip_code || '';

  let html = '<div class="detail-empty" style="text-align:left;padding:24px;background:var(--s2);border-radius:12px">';
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">';
  html += '<div style="font-size:24px">&#x1F50D;</div>';
  html += '<div><div style="font-weight:700;color:var(--text)">No CMS facility linked to this property</div>';
  html += '<div style="font-size:12px;color:var(--text2);margin-top:2px">Auto-match tried <strong>' + esc(addr || '—') + '</strong>' + (zip ? ' (' + esc(zip) + ')' : '') + ' — no confident match found.</div>';
  html += '</div></div>';

  // Candidate suggestions (from fuzzy match, score ≥ 0.55)
  if (candidates.length > 0) {
    html += '<div style="font-size:11px;color:var(--text3);margin-top:8px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Suggested matches</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">';
    candidates.forEach(c => {
      const scorePct = Math.round((Number(c.match_score) || 0) * 100);
      html += '<div style="display:flex;gap:10px;padding:10px 12px;background:var(--s1);border-radius:8px;border:1px solid var(--border)">';
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-weight:600;color:var(--text);font-size:13px">' + esc(c.facility_name || '(unnamed)') + '</div>';
      html += '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + esc(c.address || '') + (c.city ? ', ' + esc(c.city) : '') + (c.state ? ', ' + esc(c.state) : '') + (c.zip ? ' ' + esc(c.zip) : '') + '</div>';
      html += '<div style="font-size:10px;color:var(--text3);margin-top:3px">CCN ' + esc(c.medicare_id) + (c.chain_organization ? ' · ' + esc(c.chain_organization) : '') + '</div>';
      html += '</div>';
      html += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">';
      html += '<span style="font-size:10px;padding:2px 6px;border-radius:8px;background:' + (scorePct >= 70 ? 'rgba(16,185,129,0.18);color:#10b981' : 'rgba(251,191,36,0.18);color:#f59e0b') + ';font-weight:700">' + scorePct + '% match</span>';
      html += '<button onclick="_udCmsLinkCandidate(\'' + esc(c.medicare_id) + '\', \'auto:address_zip\')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-weight:600;cursor:pointer">Use this</button>';
      html += '</div></div>';
    });
    html += '</div>';
  }

  // Typeahead search
  html += '<div style="margin-top:12px">';
  html += '<div style="font-size:11px;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Search the CMS facility registry</div>';
  html += '<div style="position:relative">';
  html += '<input id="cmsMatchQuery" type="text" placeholder="Facility name, CCN, or street address…" oninput="_udCmsTypeahead(this.value)" ';
  html += 'style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--s1);color:var(--text);font-size:13px;box-sizing:border-box" />';
  html += '<div id="cmsMatchResults" style="margin-top:6px;display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto"></div>';
  html += '</div>';
  if (state || zip) {
    html += '<div style="font-size:10px;color:var(--text3);margin-top:6px">Search scoped to ' + (state ? 'state ' + esc(state) : '') + (state && zip ? ', ' : '') + (zip ? 'zip ' + esc(String(zip).substring(0,5)) : '') + '.</div>';
  }
  html += '</div></div>';
  return html;
}

// Debounced typeahead search against /api/cms-match?action=search
let _cmsTypeaheadTimer = null;
function _udCmsTypeahead(q) {
  clearTimeout(_cmsTypeaheadTimer);
  const resultsEl = document.getElementById('cmsMatchResults');
  if (!q || q.length < 2) { if (resultsEl) resultsEl.innerHTML = ''; return; }
  _cmsTypeaheadTimer = setTimeout(async () => {
    const p = _udCache?.property || {};
    const fb = _udCache?.fallback || {};
    const state = p.state || fb.state || '';
    const zip = p.zip_code || p.zip || fb.zip || fb.zip_code || '';
    const url = new URL('/api/cms-match', window.location.origin);
    url.searchParams.set('action', 'search');
    url.searchParams.set('q', q);
    if (state) url.searchParams.set('state', state);
    // Scope by zip only when the user's query looks like a facility name (letters)
    if (zip && !/^\d/.test(q)) url.searchParams.set('zip', String(zip).substring(0,5));
    url.searchParams.set('limit', '10');
    const headers = {};
    if (window._lccApiKey) headers['X-LCC-Key'] = window._lccApiKey;
    try {
      const r = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) });
      const data = await r.json();
      const rows = (data && data.candidates) || [];
      if (!resultsEl) return;
      if (rows.length === 0) { resultsEl.innerHTML = '<div style="padding:8px;font-size:12px;color:var(--text3)">No facilities found.</div>'; return; }
      resultsEl.innerHTML = rows.map(c => {
        const line2 = [c.address, c.city, c.state, c.zip_code || c.zip].filter(Boolean).map(esc).join(', ');
        return '<div style="display:flex;gap:10px;padding:8px 10px;background:var(--s1);border-radius:6px;border:1px solid var(--border);align-items:center">' +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;color:var(--text);font-size:12px">' + esc(c.facility_name || '(unnamed)') + '</div>' +
          '<div style="font-size:11px;color:var(--text2)">' + line2 + '</div>' +
          '<div style="font-size:10px;color:var(--text3);margin-top:1px">CCN ' + esc(c.medicare_id) + (c.chain_organization ? ' · ' + esc(c.chain_organization) : '') + '</div>' +
          '</div>' +
          '<button onclick="_udCmsLinkCandidate(\'' + esc(c.medicare_id) + '\', \'manual:typeahead\')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-weight:600;cursor:pointer">Link</button>' +
        '</div>';
      }).join('');
    } catch (err) {
      console.warn('cms typeahead failed', err);
      if (resultsEl) resultsEl.innerHTML = '<div style="padding:8px;font-size:12px;color:var(--red)">Search failed.</div>';
    }
  }, 250);
}

/** Apply a manual link (from the typeahead or a suggested candidate) and re-render. */
async function _udCmsLinkCandidate(medicareId, method) {
  if (!_udCache) return;
  const propertyId = _udCache.ids?.property_id || _udCache.property?.property_id;
  if (!propertyId) { showToast('Property ID not available', 'error'); return; }
  const bodyEl = document.getElementById('detailBody');
  if (bodyEl) bodyEl.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Linking CMS facility…</p></div>';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (window._lccApiKey) headers['X-LCC-Key'] = window._lccApiKey;
    const r = await fetch('/api/cms-match?action=link', {
      method: 'POST', headers,
      body: JSON.stringify({ property_id: propertyId, medicare_id: medicareId, match_method: method || 'manual' }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    // Merge response into cache and re-render
    _udCache.cms = {
      medicare_id: medicareId,
      match_score: data.link?.match_score || null,
      match_method: data.link?.match_method || method,
      source: 'manual',
      facility: data.facility || null,
      quality: data.quality || null,
      patient: data.patient || null,
      trends: data.trends || null,
      payer: data.payer || null,
      cost: data.cost || null,
      operator: data.operator || _udDetectOperator(data.facility || {}),
      candidates: [],
    };
    if (data.rankings) _udCache.rankings = data.rankings;
    _opsExtraCache = null; // invalidate extra cache so next render refetches
    _setUdCache(_udCache);
    showToast('Linked CMS facility ' + medicareId, 'success');
    if (bodyEl) _udRenderOperationsAsync(bodyEl);
  } catch (err) {
    console.error('link failed', err);
    showToast('Link failed: ' + (err.message || 'unknown'), 'error');
    if (bodyEl) bodyEl.innerHTML = _udTabOperations();
  }
}

/** Remove a cached link (admin / correction path). */
async function _udCmsClearLink() {
  if (!_udCache) return;
  const propertyId = _udCache.ids?.property_id || _udCache.property?.property_id;
  if (!propertyId) return;
  if (!confirm('Remove the CMS facility link for this property? The Operations tab will re-run auto-match next open.')) return;
  try {
    const headers = {};
    if (window._lccApiKey) headers['X-LCC-Key'] = window._lccApiKey;
    const r = await fetch('/api/cms-match?action=link&property_id=' + encodeURIComponent(propertyId), {
      method: 'DELETE', headers, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    _udCache.cms = null;
    _udCache.rankings = null;
    _opsExtraCache = null;
    _setUdCache(_udCache);
    showToast('CMS link removed', 'success');
    const bodyEl = document.getElementById('detailBody');
    if (bodyEl) _udRenderOperationsAsync(bodyEl);
  } catch (err) {
    showToast('Unlink failed: ' + err.message, 'error');
  }
}

/** Lazy-load additional clinic data for the Operations tab, then render */
let _opsExtraCache = null; // { medicare_id, patientHistory, trends, quality, financialDetail, costReports, payerMix, lease }
async function _udRenderOperationsAsync(bodyEl) {
  const fb = _udCache.fallback || {};
  // Resolve the medicare_id in priority order:
  //   1) cached/resolved CMS facility match (property_cms_link)
  //   2) rankings row (v_property_rankings.medicare_id)
  //   3) fallback/search-card clinic identifier
  let clinicId = (_udCache.cms && _udCache.cms.medicare_id)
    || (_udCache.rankings && _udCache.rankings.medicare_id)
    || fb.clinic_id || fb.medicare_id || fb.ccn;

  // If we have no clinicId and no rankings yet, try to auto-match now.
  // This covers the case where the user opens the Operations tab directly
  // on a property that hasn't been resolved yet.
  const propertyId = _udCache.ids?.property_id || _udCache.property?.property_id;
  if (!clinicId && !_udCache.rankings && _udCache.db === 'dia' && propertyId) {
    if (bodyEl) bodyEl.innerHTML = _opsLoadingSkeleton();
    try { await _udResolveCmsFacility(propertyId); } catch (e) { console.warn(e); }
    clinicId = (_udCache.cms && _udCache.cms.medicare_id)
      || (_udCache.rankings && _udCache.rankings.medicare_id)
      || clinicId;
  }

  // If we already loaded extra data for this clinic, just render
  if (_opsExtraCache && _opsExtraCache.medicare_id === clinicId) {
    if (bodyEl) bodyEl.innerHTML = _udTabOperations();
    return;
  }

  // Show loading skeleton
  if (bodyEl) bodyEl.innerHTML = _opsLoadingSkeleton();

  // Fetch additional tables in parallel (graceful — empty array on failure)
  const extras = {};
  try {
    const promises = [];
    if (clinicId) {
      const mFilter = `medicare_id=eq.${encodeURIComponent(clinicId)}`;
      promises.push(diaQuery('facility_patient_counts', '*', { filter: mFilter, order: 'snapshot_date.asc', limit: 100 }).catch(() => []));
      promises.push(diaQuery('clinic_trends', '*', { filter: mFilter, limit: 1 }).catch(() => []));
      promises.push(diaQuery('clinic_quality_metrics', '*', { filter: mFilter, order: 'snapshot_date.desc', limit: 1 }).catch(() => []));
      promises.push(diaQuery('clinic_financial_estimates', '*', { filter: mFilter + '&is_primary=eq.true', limit: 1 }).catch(() => []));
      promises.push(diaQuery('facility_cost_reports', '*', { filter: mFilter, order: 'fiscal_year.desc', limit: 1 }).catch(() => []));
      promises.push(diaQuery('v_clinic_payer_mix', '*', { filter: mFilter, limit: 1 }).catch(() => []));
      promises.push(diaQuery('v_payer_mix_geo_averages', '*', { filter: mFilter, limit: 1 }).catch(() => []));
      // Lease via property_id
      const propId = _udCache.ids?.property_id || _udCache.property?.property_id;
      if (propId) {
        promises.push(diaQuery('leases', '*', { filter: `property_id=eq.${encodeURIComponent(propId)}`, limit: 5 }).catch(() => []));
      } else {
        promises.push(Promise.resolve([]));
      }
    }
    const [patientHistory, trends, quality, financialDetail, costReports, payerMixData, geoPayerData, leaseData] = clinicId
      ? await Promise.all(promises)
      : [[], [], [], [], [], [], [], []];

    _opsExtraCache = {
      medicare_id: clinicId,
      patientHistory: patientHistory || [],
      trends: (trends || [])[0] || null,
      quality: (quality || [])[0] || null,
      financialDetail: (financialDetail || [])[0] || null,
      costReports: (costReports || [])[0] || null,
      payerMix: (payerMixData || [])[0] || null,
      geoPayerMix: (geoPayerData || [])[0] || null,
      lease: (leaseData || [])[0] || null,
    };
  } catch (err) {
    console.warn('Operations extra data load error:', err);
    _opsExtraCache = { medicare_id: clinicId, patientHistory: [], trends: null, quality: null, financialDetail: null, costReports: null, payerMix: null, geoPayerMix: null, lease: null };
  }

  if (bodyEl) bodyEl.innerHTML = _udTabOperations();
}

/** Loading skeleton for Operations tab */
function _opsLoadingSkeleton() {
  const skeletonCard = '<div style="background:var(--s2);border-radius:10px;padding:16px;animation:pulse 1.5s ease-in-out infinite"><div style="height:12px;background:var(--s3);border-radius:4px;width:60%;margin-bottom:8px"></div><div style="height:24px;background:var(--s3);border-radius:4px;width:40%"></div></div>';
  return '<style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}</style>' +
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">' +
    skeletonCard + skeletonCard + skeletonCard +
    '</div>' +
    '<div style="background:var(--s2);border-radius:10px;padding:20px;margin-bottom:12px;animation:pulse 1.5s ease-in-out infinite"><div style="height:14px;background:var(--s3);border-radius:4px;width:30%;margin-bottom:12px"></div><div style="height:10px;background:var(--s3);border-radius:4px;width:90%;margin-bottom:8px"></div><div style="height:10px;background:var(--s3);border-radius:4px;width:75%;margin-bottom:8px"></div><div style="height:10px;background:var(--s3);border-radius:4px;width:80%"></div></div>' +
    '<div style="background:var(--s2);border-radius:10px;padding:20px;animation:pulse 1.5s ease-in-out infinite"><div style="height:14px;background:var(--s3);border-radius:4px;width:25%;margin-bottom:12px"></div><div style="height:80px;background:var(--s3);border-radius:4px;width:100%"></div></div>';
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
  const el = document.getElementById('detailHeader');
  if (!el) return;
  el.innerHTML = `
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
    case 'Sales': return _udTabSales();
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
  // Year Built: treat 0 / null / non-positive as "unknown" and offer a
  // ChromeConnector resolve affordance. DB-level the 0 backfill already ran
  // (see sql/20260415_properties_year_built_null_zero.sql), but older cached
  // rows or race conditions can still surface 0 so we guard here too.
  const yb = Number(p.year_built);
  if (p.year_built != null && p.year_built !== '' && yb >= 1600 && yb <= 2100) {
    html += _row('Year Built', yb);
  } else {
    html += _rowResolve('Year Built', 'year_built');
  }
  html += _row('Building Type', p.building_type);
  html += _row('Building Condition', p.building_condition);

  // Dialysis-specific — canonical field is `stations`. `number_of_chairs` is
  // a legacy alias kept around for compatibility with older CMS-derived rows.
  const stationsValue = p.stations || p.number_of_chairs;
  if (stationsValue) html += _row('Stations', fmtN(stationsValue));

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
  html += _rowHtml('Agency / Tenant', fb.tenant_agency || fb.agency || fb.tenant_operator ? entityLink(fb.tenant_agency || fb.agency || fb.tenant_operator, 'operator', null) : '—');
  html += _row('Lease Number', fb.lease_number);
  html += _row('Building Size', fb.building_sf || fb.rsf || fb.usable_sf || fb.sq_ft ? fmtN(fb.building_sf || fb.rsf || fb.usable_sf || fb.sq_ft) + ' SF' : null);

  // Dialysis-specific fields from search results
  if (fb.facility_name) html += _row('Facility', fb.facility_name);
  if (fb.operator_name) html += _rowHtml('Operator', entityLink(fb.operator_name, 'operator', null));
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

// ── Placeholder-tenant + dedup helpers ────────────────────────────────────
//
// Mirrors the public.is_placeholder_tenant() SQL function from the
// 20260414213000 migration. Keep the two in sync — a placeholder tenant here
// must also be flagged in SQL so the dedup + unique index stays coherent.
const _UD_PLACEHOLDER_TENANTS = new Set([
  'buyerest.', 'buyer est.', 'buyer est', 'buyerest',
  'est.', 'est', 'tbd', 'tbd.', 'unknown', 'n/a', 'na'
]);
const _UD_PLACEHOLDER_DATA_SOURCES = new Set([
  'buyer_est', 'sales_comp_est'
]);

function _udIsPlaceholderTenant(t) {
  if (t == null) return true;
  const s = String(t).trim();
  if (!s) return true;
  const lo = s.toLowerCase();
  if (_UD_PLACEHOLDER_TENANTS.has(lo)) return true;
  if (lo.startsWith('buyer est')) return true;
  if (lo.startsWith('buyerest')) return true;
  return false;
}

/**
 * Filter out buyer-estimate / placeholder leases and dedupe remaining rows by
 * (property_id, normalized tenant, lease_start). Mirrors the DB unique index
 * so stale rows in v_lease_detail don't slip through to the UI.
 */
function _udFilterAndDedupeLeases(leases) {
  if (!Array.isArray(leases) || leases.length === 0) return [];

  const kept = [];
  const seen = new Map(); // key -> index into kept[]

  // Sort so that higher-authority rows come first (kept on collision).
  const ranked = leases.slice().sort((a, b) => {
    const tierA = _udIsPlaceholderTenant(a?.tenant) ? 2
                : _UD_PLACEHOLDER_DATA_SOURCES.has(String(a?.data_source || '').toLowerCase()) ? 1 : 0;
    const tierB = _udIsPlaceholderTenant(b?.tenant) ? 2
                : _UD_PLACEHOLDER_DATA_SOURCES.has(String(b?.data_source || '').toLowerCase()) ? 1 : 0;
    if (tierA !== tierB) return tierA - tierB;

    const confRank = (c) => ({ documented: 0, estimated: 1, inferred: 2 })[c] ?? 3;
    const cA = confRank(a?.source_confidence);
    const cB = confRank(b?.source_confidence);
    if (cA !== cB) return cA - cB;

    const aHasRent = (a?.annual_rent != null || a?.rent_psf != null) ? 0 : 1;
    const bHasRent = (b?.annual_rent != null || b?.rent_psf != null) ? 0 : 1;
    if (aHasRent !== bHasRent) return aHasRent - bHasRent;

    return (a?.lease_id || 0) - (b?.lease_id || 0);
  });

  for (const l of ranked) {
    // Filter 1: explicit buyer-estimate data_source
    const ds = String(l?.data_source || '').toLowerCase();
    if (_UD_PLACEHOLDER_DATA_SOURCES.has(ds)) continue;
    // Filter 2: placeholder tenant string
    if (_udIsPlaceholderTenant(l?.tenant)) continue;

    const tenantKey = String(l.tenant).trim().toLowerCase();
    const startKey = l.lease_start || '1900-01-01';
    const key = `${l.property_id || ''}|${tenantKey}|${startKey}`;
    if (seen.has(key)) continue;
    seen.set(key, kept.length);
    kept.push(l);
  }
  return kept;
}

/**
 * Best-effort fetch of lease_extensions + lease_rent_schedule for the leases
 * currently in the cache. Returns {extensions, schedule} keyed by lease_id.
 * Tolerates missing views (returns empty maps) so the Lease tab still renders
 * before the migration is applied.
 */
async function _udFetchLeaseEnrichment(leases) {
  const extensions = new Map();
  const schedule = new Map();
  if (!Array.isArray(leases) || leases.length === 0) return { extensions, schedule };

  const leaseIds = leases.map(l => l.lease_id).filter(id => id != null);
  if (leaseIds.length === 0) return { extensions, schedule };

  const idList = leaseIds.join(',');
  const filter = `lease_id=in.(${idList})`;

  const [extRes, schRes] = await Promise.allSettled([
    diaQuery('v_lease_extensions_summary', '*', { filter, limit: 100 }).catch(() => []),
    diaQuery('lease_rent_schedule', '*', { filter, order: 'lease_year.asc', limit: 500 }).catch(() => []),
  ]);

  const extract = (r) => {
    if (r.status !== 'fulfilled') return [];
    const v = r.value;
    if (Array.isArray(v)) return v;
    if (v && v.data) return v.data;
    return [];
  };

  for (const row of extract(extRes)) {
    extensions.set(row.lease_id, {
      extension_count: Number(row.extension_count_live ?? 0),
      last_extension_date: row.last_extension_date_live || null,
    });
  }
  for (const row of extract(schRes)) {
    if (!schedule.has(row.lease_id)) schedule.set(row.lease_id, []);
    schedule.get(row.lease_id).push(row);
  }
  return { extensions, schedule };
}

// ── Rent escalation parser ────────────────────────────────────────────────
//
// Parses freeform rent-escalation strings into a structured schedule.
// Supported phrasings (case-insensitive):
//   "2% annually"            → { stepPct: 0.02, intervalYears: 1 }
//   "2% per year"            → same
//   "3.5% yearly"            → { stepPct: 0.035, intervalYears: 1 }
//   "10% every 5 years"      → { stepPct: 0.10, intervalYears: 5 }
//   "$0.50/sf per year"      → { stepPsf: 0.50, intervalYears: 1 }
//   "CPI" / "FMV" / unparsed → null (caller falls back to flat rent)
function _udParseRentEscalation(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/\bcpi\b/.test(s) || /\bfmv\b/.test(s) || /\bmarket\b/.test(s)) {
    // Index-linked or FMV reset — not a deterministic step, skip.
    return null;
  }

  // "X% every N years"
  let m = s.match(/(\d+(?:\.\d+)?)\s*%\s*every\s*(\d+)\s*year/);
  if (m) return { stepPct: parseFloat(m[1]) / 100, intervalYears: parseInt(m[2], 10) };

  // "X% annually" / "X% per year" / "X% yearly" / "X% / year"
  m = s.match(/(\d+(?:\.\d+)?)\s*%\s*(?:annually|per\s*year|yearly|\/\s*year|a\s*year|p\.?a\.?)/);
  if (m) return { stepPct: parseFloat(m[1]) / 100, intervalYears: 1 };

  // "$X/sf per year" (rent/psf bump in dollars, e.g. "$0.50/SF annually")
  m = s.match(/\$?(\d+(?:\.\d+)?)\s*\/\s*sf\s*(?:annually|per\s*year|yearly)/);
  if (m) return { stepPsf: parseFloat(m[1]), intervalYears: 1 };

  // Bare "X%" with no interval — assume annual (safe default for triple-net).
  m = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (m) return { stepPct: parseFloat(m[1]) / 100, intervalYears: 1 };

  return null;
}

/**
 * Build a structured rent schedule for a lease. Prefers rows from
 * lease_rent_schedule when present; otherwise synthesizes one from the
 * parsed escalation string + base rent + term.
 * Returns an array of { year, period_start, period_end, base_rent, rent_psf,
 * bump_pct, cumulative_rent, is_option_window }.
 */
function _udBuildRentSchedule(lease, storedRows, em) {
  // Case 1: DB-sourced rows — use as-is (authoritative).
  if (Array.isArray(storedRows) && storedRows.length > 0) {
    let cum = 0;
    return storedRows
      .slice()
      .sort((a, b) => (a.lease_year || 0) - (b.lease_year || 0))
      .map(r => {
        const base = r.base_rent != null ? Number(r.base_rent) : null;
        cum += base || 0;
        return {
          year: r.lease_year,
          period_start: r.period_start,
          period_end: r.period_end,
          base_rent: base,
          rent_psf: r.rent_psf != null ? Number(r.rent_psf) : null,
          bump_pct: r.bump_pct != null ? Number(r.bump_pct) : null,
          cumulative_rent: r.cumulative_rent != null ? Number(r.cumulative_rent) : cum,
          is_option_window: !!r.is_option_window,
          source: r.source || 'db',
        };
      });
  }

  // Case 2: synthesize from base rent + escalation string.
  const baseRent =
    (lease?.annual_rent != null ? Number(lease.annual_rent) : null) ??
    (em?.annual_rent != null ? Number(em.annual_rent) : null);
  if (!baseRent || baseRent <= 0) return [];

  const start = lease?.lease_start || em?.lease_commencement;
  const end   = lease?.lease_expiration || em?.lease_expiration;
  if (!start) return [];
  const startD = new Date(start);
  const endD   = end ? new Date(end) : null;
  if (isNaN(startD)) return [];
  let termYears;
  if (endD && !isNaN(endD)) {
    termYears = Math.max(1, Math.round((endD - startD) / (365.25 * 24 * 3600 * 1000)));
  } else if (lease?.initial_term_years) {
    termYears = Math.round(Number(lease.initial_term_years));
  } else {
    termYears = 10; // reasonable default for NNN single-tenant
  }
  termYears = Math.min(termYears, 40); // cap runaway synthesis

  // Prefer verified rent_cagr; else parse escalation strings; else 0%.
  let stepPct = 0;
  let intervalYears = 1;
  let stepPsf = 0;
  if (lease?.rent_cagr != null) {
    stepPct = Number(lease.rent_cagr);
    intervalYears = 1;
  } else {
    const parsed =
      _udParseRentEscalation(lease?.renewal_options) ||
      _udParseRentEscalation(em?.rent_escalations);
    if (parsed) {
      stepPct = parsed.stepPct || 0;
      stepPsf = parsed.stepPsf || 0;
      intervalYears = parsed.intervalYears || 1;
    }
  }

  const leasedSF = lease?.leased_area != null ? Number(lease.leased_area)
                 : (em?.sf_leased != null ? Number(em.sf_leased) : null);

  const rows = [];
  let rent = baseRent;
  let cum = 0;
  for (let y = 1; y <= termYears; y++) {
    // Apply step at each interval boundary (y > 1 and (y-1) % interval === 0)
    if (y > 1 && (y - 1) % intervalYears === 0) {
      if (stepPct) rent = rent * (1 + stepPct);
      else if (stepPsf && leasedSF) rent = rent + (stepPsf * leasedSF);
    }
    const yearStart = new Date(startD);
    yearStart.setFullYear(startD.getFullYear() + (y - 1));
    const yearEnd = new Date(startD);
    yearEnd.setFullYear(startD.getFullYear() + y);
    yearEnd.setDate(yearEnd.getDate() - 1);
    cum += rent;
    rows.push({
      year: y,
      period_start: yearStart.toISOString().slice(0, 10),
      period_end:   yearEnd.toISOString().slice(0, 10),
      base_rent: Math.round(rent * 100) / 100,
      rent_psf:  leasedSF ? Math.round((rent / leasedSF) * 100) / 100 : null,
      bump_pct:  (y > 1 && (y - 1) % intervalYears === 0) ? stepPct : 0,
      cumulative_rent: Math.round(cum * 100) / 100,
      is_option_window: false,
      source: 'parsed_estimate',
    });
  }
  return rows;
}

/**
 * Render a stepped-line SVG chart of annual rent vs lease year.
 * Pure SVG — no external chart library.
 */
function _udRenderRentChart(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const W = 560, H = 200, PAD_L = 60, PAD_R = 20, PAD_T = 20, PAD_B = 36;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const rents = rows.map(r => r.base_rent || 0);
  const minR = Math.min(...rents);
  const maxR = Math.max(...rents);
  const yMin = Math.max(0, minR - (maxR - minR) * 0.1);
  const yMax = maxR + (maxR - minR) * 0.1 || maxR + 1;
  const xFor = (i) => PAD_L + (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
  const yFor = (v) => PAD_T + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  // Build stepped path: move to first point, then for each subsequent year,
  // draw horizontal to the new x, then vertical to the new y.
  let d = '';
  rows.forEach((r, i) => {
    const x = xFor(i);
    const y = yFor(r.base_rent || 0);
    if (i === 0) d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    else          d += ` H ${x.toFixed(1)} V ${y.toFixed(1)}`;
  });

  // Y-axis ticks (3 levels)
  const ticks = [yMin, (yMin + yMax) / 2, yMax];
  const yAxisLabels = ticks.map(v => {
    const y = yFor(v);
    const label = '$' + Math.round(v).toLocaleString();
    return `<text x="${PAD_L - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text3,#888)">${label}</text>` +
           `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" stroke="var(--border,#2a2a2a)" stroke-dasharray="2,3" stroke-width="1"/>`;
  }).join('');

  // X-axis labels (every few years)
  const xStep = rows.length <= 10 ? 1 : Math.ceil(rows.length / 10);
  const xAxisLabels = rows.map((r, i) => {
    if (i % xStep !== 0 && i !== rows.length - 1) return '';
    const x = xFor(i);
    return `<text x="${x.toFixed(1)}" y="${(H - PAD_B + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--text3,#888)">Y${r.year}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="max-width:100%;background:var(--s2,#141414);border:1px solid var(--border,#2a2a2a);border-radius:8px">
    ${yAxisLabels}
    <path d="${d}" stroke="var(--purple,#a78bfa)" stroke-width="2" fill="none" stroke-linejoin="miter"/>
    ${rows.map((r, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(r.base_rent || 0).toFixed(1)}" r="3" fill="var(--purple,#a78bfa)"><title>Year ${r.year}: $${Math.round(r.base_rent || 0).toLocaleString()}</title></circle>`).join('')}
    ${xAxisLabels}
  </svg>`;
}

/**
 * Render the Rent Roll sub-view: stepped line chart + tabular schedule.
 */
function _udRenderRentRoll(leases, storedScheduleMap, em) {
  if (!Array.isArray(leases) || leases.length === 0) {
    return '<div class="detail-empty">No lease data available for Rent Roll</div>';
  }

  let html = '';
  leases.forEach((l, idx) => {
    const title = leases.length === 1 ? 'Rent Schedule' : `Rent Schedule — ${esc(l.tenant || ('Lease ' + (idx + 1)))}`;
    const storedRows = storedScheduleMap?.get(l.lease_id) || null;
    const rows = _udBuildRentSchedule(l, storedRows, em);

    html += '<div class="detail-section">';
    html += `<div class="detail-section-title">${title}</div>`;

    if (rows.length === 0) {
      html += '<div class="detail-empty" style="padding:12px">Not enough data to build a schedule. Need base rent, commencement, and either an escalation term (e.g., "2% annually") or a documented rent_cagr.</div>';
      html += '</div>';
      return;
    }

    const sourceNote = storedRows && storedRows.length
      ? 'Source: lease_rent_schedule (documented)'
      : 'Source: parsed from escalation string — estimate';
    html += `<div style="color:var(--text3,#888);font-size:11px;margin-bottom:8px">${esc(sourceNote)}</div>`;

    html += _udRenderRentChart(rows);

    html += '<div style="overflow-x:auto;margin-top:12px"><table class="detail-table" style="width:100%;border-collapse:collapse;font-size:12px">';
    html += '<thead><tr>' +
      ['Year','Period','Base Rent','Rent / SF','Bump %','Cumulative','Option'].map(h =>
        `<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border,#2a2a2a);color:var(--text3,#888);font-weight:600">${h}</th>`
      ).join('') + '</tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr>' +
        `<td style="padding:6px 8px;border-bottom:1px solid var(--border,#2a2a2a)">Y${r.year}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid var(--border,#2a2a2a)">${r.period_start ? _fmtDate(r.period_start) : '—'}${r.period_end ? ' → ' + _fmtDate(r.period_end) : ''}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid var(--border,#2a2a2a)">${r.base_rent != null ? '$' + Math.round(r.base_rent).toLocaleString() : '—'}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid var(--border,#2a2a2a)">${r.rent_psf != null ? '$' + r.rent_psf.toFixed(2) : '—'}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid var(--border,#2a2a2a)">${r.bump_pct ? (r.bump_pct * 100).toFixed(2) + '%' : '—'}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid var(--border,#2a2a2a)">${r.cumulative_rent != null ? '$' + Math.round(r.cumulative_rent).toLocaleString() : '—'}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid var(--border,#2a2a2a)">${r.is_option_window ? 'Option' : ''}</td>` +
        '</tr>';
    });
    html += '</tbody></table></div>';
    html += '</div>';
  });
  return html;
}

/** Switch the active sub-view on the Lease tab (Details | Rent Roll). */
function switchLeaseSubView(view) {
  if (!_udCache) return;
  _udCache.leaseSubView = view;
  const body = document.getElementById('detailBody');
  if (body) body.innerHTML = _udRenderTab('Lease');
}
window.switchLeaseSubView = switchLeaseSubView;

/**
 * Compute a friendly term-remaining string from an expiration date.
 * Used on the Lease tab when v_lease_detail has no computed term_remaining_years
 * (e.g. CoStar-sourced estimates on properties with no executed lease document).
 */
function termRemaining(expirationDate) {
  if (!expirationDate) return null;
  const exp = new Date(expirationDate);
  const now = new Date();
  const years = ((exp - now) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
  return parseFloat(years) > 0 ? years + ' yrs remaining' : 'Expired';
}

/** Small amber "Est." badge marking a field as a CoStar estimate. */
function _udEstBadge() {
  return '<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:4px;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.35);font-size:10px;font-weight:600;letter-spacing:0.3px;vertical-align:middle" title="Estimated from CoStar metadata — no executed lease document on file">Est.</span>';
}

/** Render a lease row whose value may be a raw-HTML string, with an optional Est. badge. */
function _udLeaseRowH(label, valueHtml, isEst) {
  if (valueHtml == null || valueHtml === '' || valueHtml === '—') return '';
  const badge = isEst ? _udEstBadge() : '';
  return `<div class="detail-row">
    <div class="detail-lbl">${esc(label)}</div>
    <div class="detail-val">${valueHtml}${badge}</div>
  </div>`;
}

function _udTabLease() {
  const leases = _udCache.leases || [];
  const em = _udCache.entityMeta || {};
  const extMap = _udCache.leaseExtensions instanceof Map ? _udCache.leaseExtensions : new Map();
  const schedMap = _udCache.leaseRentSchedule instanceof Map ? _udCache.leaseRentSchedule : new Map();
  const hasEntityMeta = !!(em && (em.tenant_name || em.lease_commencement ||
    em.lease_expiration || em.annual_rent || em.rent_per_sf ||
    em.expense_structure || em.renewal_options || em.guarantor ||
    em.rent_escalations));

  // Sub-view toggle (Details | Rent Roll). Default to Details.
  const subView = _udCache.leaseSubView === 'rentroll' ? 'rentroll' : 'details';
  const subTabBar = `
    <div style="display:flex;gap:8px;padding:8px 0 12px;border-bottom:1px solid var(--border,#2a2a2a);margin-bottom:12px">
      <button class="detail-subtab" onclick="switchLeaseSubView('details')" style="padding:6px 12px;border-radius:6px;border:1px solid ${subView === 'details' ? 'var(--purple,#a78bfa)' : 'var(--border,#2a2a2a)'};background:${subView === 'details' ? 'rgba(167,139,250,0.12)' : 'transparent'};color:${subView === 'details' ? 'var(--purple,#a78bfa)' : 'var(--text,#e5e5e5)'};font-size:12px;font-weight:600;cursor:pointer">Details</button>
      <button class="detail-subtab" onclick="switchLeaseSubView('rentroll')" style="padding:6px 12px;border-radius:6px;border:1px solid ${subView === 'rentroll' ? 'var(--purple,#a78bfa)' : 'var(--border,#2a2a2a)'};background:${subView === 'rentroll' ? 'rgba(167,139,250,0.12)' : 'transparent'};color:${subView === 'rentroll' ? 'var(--purple,#a78bfa)' : 'var(--text,#e5e5e5)'};font-size:12px;font-weight:600;cursor:pointer">Rent Roll</button>
    </div>`;

  if (subView === 'rentroll') {
    if (leases.length === 0 && !hasEntityMeta) {
      return subTabBar + '<div class="detail-empty">No lease data available for Rent Roll</div>';
    }
    const leasesForRoll = leases.length > 0 ? leases : [{}];
    return subTabBar + _udRenderRentRoll(leasesForRoll, schedMap, em);
  }

  // If no lease view data AND no CoStar metadata, try the search fallback record
  if (leases.length === 0 && !hasEntityMeta) {
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

  // If we only have entity metadata (no v_lease_detail rows), synthesize one
  // empty lease so the renderer produces a single estimates-only section.
  const leasesToRender = leases.length > 0 ? leases : [{}];
  const estimatesOnly = leases.length === 0;

  // Details sub-view always prefixed by the sub-tab bar.
  let _outHtml = subTabBar;

  // Pick verified lease field if present, else fall through to the CoStar
  // estimate from entity metadata. Returns { html, est } where est=true when
  // the value came from metadata and should get an "Est." badge.
  const pick = (verified, estimate, format) => {
    if (verified != null && verified !== '') {
      return { html: format ? format(verified) : esc(String(verified)), est: false };
    }
    if (estimate != null && estimate !== '') {
      return { html: format ? format(estimate) : esc(String(estimate)), est: true };
    }
    return { html: null, est: false };
  };
  const dateFmt = (v) => esc(_fmtDate(v));
  const moneyFmt = (v) => esc(fmt(v));

  let html = '';

  leasesToRender.forEach((l, idx) => {
    const isOnly = leasesToRender.length === 1;
    html += '<div class="detail-section">';
    html += `<div class="detail-section-title">${isOnly ? 'Lease Details' : 'Lease ' + (idx + 1)}</div>`;
    html += '<div class="detail-grid">';

    // Term Remaining: prefer verified term_remaining_years from the view,
    // else compute from whichever expiration date we have (verified or estimate).
    let termRow;
    if (l.term_remaining_years != null) {
      const n = Number(l.term_remaining_years);
      termRow = {
        html: n < 0 ? '<span style="color:var(--red)">Expired</span>' : esc(n.toFixed(1) + ' yrs remaining'),
        est: false
      };
    } else {
      const exp = l.lease_expiration || em.lease_expiration;
      const tr = termRemaining(exp);
      termRow = {
        html: tr == null ? null : (tr === 'Expired' ? '<span style="color:var(--red)">Expired</span>' : esc(tr)),
        est: !l.lease_expiration && !!em.lease_expiration
      };
    }

    // Escalations: verified rent_cagr from v_lease_detail takes priority;
    // otherwise fall through to the freeform CoStar escalations string.
    const esc_row = (l.rent_cagr != null)
      ? { html: esc((Number(l.rent_cagr) * 100).toFixed(2) + '%'), est: false }
      : pick(null, em.rent_escalations);

    const dataSourceRow = l.data_source
      ? { html: esc(l.data_source), est: false }
      : (estimatesOnly ? { html: esc('costar_estimate'), est: true } : { html: null, est: false });

    const leaseSections = [
      { label: 'Tenant',            row: pick(l.tenant, em.tenant_name) },
      { label: 'Commencement',      row: pick(l.lease_start, em.lease_commencement, dateFmt) },
      { label: 'Expiration',        row: pick(l.lease_expiration, em.lease_expiration, dateFmt) },
      { label: 'Term Remaining',    row: termRow },
      { label: 'Annual Rent',       row: pick(l.annual_rent, em.annual_rent, moneyFmt) },
      { label: 'Rent PSF',          row: pick(l.rent_psf, em.rent_per_sf, moneyFmt) },
      { label: 'Expense Structure', row: pick(l.expense_structure, em.expense_structure) },
      { label: 'Renewal Options',   row: pick(l.renewal_options, em.renewal_options) },
      { label: 'Guarantor',         row: pick(l.guarantor, em.guarantor) },
      { label: 'Escalations',       row: esc_row },
      { label: 'Data Source',       row: dataSourceRow },
    ];

    for (const s of leaseSections) {
      html += _udLeaseRowH(s.label, s.row.html, s.row.est);
    }

    // Preserve secondary verified-lease fields when we have a real lease record.
    if (!estimatesOnly) {
      html += _row('Guarantor Type', l.guarantor_type);
      html += _row('Original Occupancy', _fmtDate(l.original_occupancy));

      // Extension count + last extension — prefer the LIVE values from
      // v_lease_extensions_summary. Fall back only when the enrichment fetch
      // hasn't landed yet (still loading). Never display a value derived from
      // v_lease_detail's stale columns (which defaulted to 3 and/or the
      // commencement date when unknown).
      const live = extMap.get(l.lease_id);
      if (live) {
        // Authoritative: 0 shows as "0"; date is null when no rows exist,
        // which _row() filters out entirely (no row rendered).
        html += _row('Last Extension', live.last_extension_date ? _fmtDate(live.last_extension_date) : null);
        html += _row('No. of Extensions', fmtN(Number(live.extension_count)));
      } else {
        // Enrichment still loading — leave both rows empty rather than
        // render the stale v_lease_detail values.
      }

      html += _row('Termination', _fmtDate(l.termination_date));
      html += _row('Initial Term', l.initial_term_years ? Number(l.initial_term_years).toFixed(1) + ' yrs' : null);
      html += _row('Total Term', l.total_term_years ? Number(l.total_term_years).toFixed(1) + ' yrs' : null);
      html += _row('No. of Renewals', l.num_renewals);
      html += _rowMoney('Future Rent / SF', l.future_rent_psf);
      html += _row('Lease Structure', l.lease_structure);

      // Flags
      const flags = [];
      if (l.is_renewed) flags.push('Renewed');
      if (l.is_first_generation) flags.push('1st Gen');
      if (l.is_superseding) flags.push('Superseding');
      if (flags.length) html += _row('Flags', flags.join(' · '));
    }

    html += '</div></div>';
  });

  return _outHtml + html;
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

  // When v_property_rankings has no row but we have a resolved CMS link, build
  // a synthetic rankings object from the snapshot the resolver returned.
  const cmsLink = _udCache.cms || null;
  let effectiveRankings = rankings;
  if (!effectiveRankings && cmsLink && cmsLink.medicare_id) {
    const f = cmsLink.facility || {};
    const q = cmsLink.quality || {};
    const pm = cmsLink.payer || {};
    const pt = cmsLink.patient || {};
    effectiveRankings = {
      medicare_id:                cmsLink.medicare_id,
      latest_estimated_patients:  pt.total_patients || pt.patient_count || null,
      number_of_chairs:           f.number_of_chairs || f.stations || null,
      stations:                   f.stations || f.number_of_chairs || null,
      star_rating:                q.star_rating != null ? q.star_rating : null,
      payer_mix_medicare_pct:     pm.medicare_pct != null ? pm.medicare_pct : null,
      payer_mix_medicaid_pct:     pm.medicaid_pct != null ? pm.medicaid_pct : null,
      payer_mix_private_pct:      pm.private_pct != null ? pm.private_pct : null,
      chain_organization:         f.chain_organization || null,
      operator_name:              f.operator_name || null,
      offers_in_center_hemodialysis:    f.offers_in_center_hemodialysis || false,
      offers_home_hemodialysis_training: f.offers_home_hemodialysis_training || false,
      offers_peritoneal_dialysis:       f.offers_peritoneal_dialysis || false,
      state:                      f.state || null,
      county:                     f.county || null,
      _synthetic_from_cms_link:   true,
    };
  }

  // If we still have nothing, show the "Match facility" fallback card.
  if (!effectiveRankings) {
    return _udRenderMatchFacilityCard();
  }

  const r = effectiveRankings;
  const ext = _opsExtraCache || {};
  const trends = ext.trends || (cmsLink && cmsLink.trends) || {};
  const quality = ext.quality || (cmsLink && cmsLink.quality) || {};
  const finDetail = ext.financialDetail || {};
  const costRpt = ext.costReports || (cmsLink && cmsLink.cost) || {};
  const payerMixHcris = ext.payerMix || (cmsLink && cmsLink.payer) || null;
  const geoPayerMix = ext.geoPayerMix || null;
  const lease = ext.lease || {};
  const patientHistory = ext.patientHistory || [];
  const operator = (cmsLink && cmsLink.operator) || _udDetectOperator(r);
  let html = '';

  // ── Link provenance banner (only shown when we resolved via cms-match) ──
  if (cmsLink && cmsLink.match_method) {
    const pct = cmsLink.match_score != null ? Math.round(Number(cmsLink.match_score) * 100) + '%' : '—';
    const methodLabel = {
      'auto:address_zip':       'Auto (address + zip)',
      'auto:medicare_clinics':  'Auto (medicare_clinics)',
      'manual':                 'Manually linked',
      'manual:typeahead':       'Manually selected',
    }[cmsLink.match_method] || cmsLink.match_method;
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:6px 10px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;font-size:11px">';
    html += '<span style="color:#3b82f6;font-weight:600">&#x1F517; CMS link:</span>';
    html += '<span style="color:var(--text)">CCN ' + esc(String(cmsLink.medicare_id)) + '</span>';
    html += '<span style="color:var(--text3)">·</span>';
    html += '<span style="color:var(--text2)">' + esc(methodLabel) + (cmsLink.match_score != null ? ' · ' + pct + ' confidence' : '') + '</span>';
    html += '<span style="flex:1"></span>';
    html += '<button onclick="_udCmsClearLink()" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer">Change</button>';
    html += '</div>';
  }

  // ── Reconcile patient census: prefer latest snapshot over rankings aggregate ──
  const latestSnapshotPt = patientHistory.length > 0
    ? Number(patientHistory[patientHistory.length - 1].total_patients || patientHistory[patientHistory.length - 1].patient_count || 0)
    : 0;
  const bestPatientCount = latestSnapshotPt > 0 ? latestSnapshotPt : (r.latest_estimated_patients ? Number(r.latest_estimated_patients) : null);

  // ── Reconcile operating margin ──
  // Always prefer computing margin from profit / revenue for consistency,
  // since ttm_operating_margin may be stored as a raw ratio (0.008) instead of a percentage (0.8)
  const bestProfit = finDetail.estimated_operating_profit || r.ttm_operating_profit;
  const bestRevenue = finDetail.estimated_annual_revenue || r.estimated_annual_revenue || r.ttm_revenue;
  let margin = null;
  if (bestProfit && bestRevenue && Number(bestRevenue) > 0) {
    margin = (Number(bestProfit) / Number(bestRevenue)) * 100;
  } else if (r.ttm_operating_margin != null) {
    // Fallback: use stored value, converting ratio to percentage if needed
    margin = Number(r.ttm_operating_margin);
    if (Math.abs(margin) > 0 && Math.abs(margin) < 1) margin = margin * 100;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 1. KEY METRICS BANNER — always visible at top
  // ════════════════════════════════════════════════════════════════════════════

  const kpis = [];

  // Revenue KPI
  const estRevenue = finDetail.estimated_annual_revenue || r.estimated_annual_revenue || r.ttm_revenue;
  kpis.push({
    label: 'Est. Annual Revenue',
    value: estRevenue ? '$' + _fmtCompact(estRevenue) : 'N/A',
    color: estRevenue ? '' : 'var(--text3)',
    info: 'Revenue estimated using 4-payer treatment model'
  });

  // Operating Margin KPI
  const marginColor = margin != null ? (margin > 12 ? 'var(--green)' : margin >= 5 ? 'var(--yellow)' : 'var(--red)') : 'var(--text3)';
  kpis.push({
    label: 'Operating Margin',
    value: margin != null ? margin.toFixed(1) + '%' : 'N/A',
    color: marginColor,
    info: margin != null ? (margin > 12 ? 'Healthy' : margin >= 5 ? 'Caution' : 'Below target') : ''
  });

  // Patient Census KPI — use reconciled best count
  kpis.push({
    label: 'Patient Census',
    value: bestPatientCount ? fmtN(bestPatientCount) : 'N/A',
    color: '',
    trend: _trendArrow(r.patient_yoy_pct, 'YoY'),
    info: latestSnapshotPt > 0 ? 'From latest CMS snapshot' : 'From rankings aggregate'
  });

  // Star Rating KPI
  const starVal = quality.star_rating != null ? Number(quality.star_rating) : (r.star_rating != null ? Number(r.star_rating) : null);
  kpis.push({
    label: 'Star Rating',
    value: starVal != null ? _starsCompact(starVal) : 'N/A',
    color: '',
    info: 'CMS Dialysis Facility Compare star rating (1-5)'
  });

  // Trend KPI
  const trendDir = trends.trend_direction || (r.patient_yoy_pct > 2 ? 'growth' : r.patient_yoy_pct < -2 ? 'decline' : 'stable');
  const trendArrowIcon = trendDir === 'growth' ? '&#9650;' : trendDir === 'decline' ? '&#9660;' : '&#9654;';
  const trendColor = trendDir === 'growth' ? 'var(--green)' : trendDir === 'decline' ? 'var(--red)' : 'var(--text3)';
  const trendLabel = trendDir === 'growth' ? 'Growth' : trendDir === 'decline' ? 'Decline' : 'Stable';
  kpis.push({
    label: 'Trend',
    value: '<span style="color:' + trendColor + '">' + trendArrowIcon + ' ' + esc(trendLabel) + '</span>',
    color: '',
    info: trends.trend_confidence ? 'Confidence: ' + trends.trend_confidence : ''
  });

  // Lease Expiration KPI
  let leaseMonths = null;
  if (lease.expiration_date) {
    const expDate = new Date(lease.expiration_date);
    const now = new Date();
    leaseMonths = Math.round((expDate - now) / (1000 * 60 * 60 * 24 * 30.44));
  } else if (_udCache.leases && _udCache.leases.length > 0) {
    const primaryLease = _udCache.leases[0];
    if (primaryLease.expiration_date || primaryLease.lease_expiration) {
      const expDate = new Date(primaryLease.expiration_date || primaryLease.lease_expiration);
      const now = new Date();
      leaseMonths = Math.round((expDate - now) / (1000 * 60 * 60 * 24 * 30.44));
    }
  }
  const leaseColor = leaseMonths != null ? (leaseMonths < 24 ? 'var(--red)' : leaseMonths < 60 ? 'var(--yellow)' : 'var(--green)') : 'var(--text3)';
  kpis.push({
    label: 'Lease Expiration',
    value: leaseMonths != null ? (leaseMonths > 0 ? leaseMonths + ' mo' : 'Expired') : 'N/A',
    color: leaseColor,
    info: leaseMonths != null && leaseMonths < 24 ? 'Less than 24 months remaining' : ''
  });

  // Render KPI cards
  html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">';
  kpis.forEach(k => {
    html += '<div style="background:var(--s2);border-radius:10px;padding:10px 12px;text-align:center;position:relative">';
    if (k.info) html += '<span title="' + esc(k.info) + '" style="position:absolute;top:6px;right:8px;font-size:10px;color:var(--text3);cursor:help;width:14px;height:14px;border:1px solid var(--text3);border-radius:50%;display:inline-flex;align-items:center;justify-content:center">i</span>';
    html += '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">' + esc(k.label) + '</div>';
    html += '<div style="font-size:18px;font-weight:700;' + (k.color ? 'color:' + k.color : 'color:var(--text1)') + '">' + k.value + '</div>';
    if (k.trend) html += '<div style="margin-top:2px">' + k.trend + '</div>';
    html += '</div>';
  });
  html += '</div>';

  // ════════════════════════════════════════════════════════════════════════════
  // 1b. CMS FACILITY PROFILE — operator, CCN, QIP, last survey, staffing, treatment count
  // ════════════════════════════════════════════════════════════════════════════

  const facility = (cmsLink && cmsLink.facility) || {};
  const latestPt = (cmsLink && cmsLink.patient) || {};
  const qipScore = quality.quality_incentive_program_score
                ?? quality.qip_total_score
                ?? quality.qip_score
                ?? r.qip_total_score
                ?? r.quality_incentive_program_score
                ?? null;
  const lastSurveyDate = quality.last_survey_date
                      || quality.survey_date
                      || facility.last_survey_date
                      || facility.last_inspection_date
                      || r.last_survey_date
                      || null;
  const totalStaff = facility.total_employees
                  || facility.staff_total
                  || costRpt.total_employees
                  || costRpt.staff_total
                  || r.total_employees
                  || null;
  const latestTreatments = (costRpt.total_medicare_treatments != null ? costRpt.total_medicare_treatments : null)
                        || r.ttm_total_treatments
                        || r.estimated_annual_treatments
                        || null;
  const treatmentYoYPct = r.treatment_yoy_pct != null ? Number(r.treatment_yoy_pct)
                        : (r.patient_yoy_pct != null ? Number(r.patient_yoy_pct) : null);
  const ccn = r.medicare_id || (cmsLink && cmsLink.medicare_id) || facility.medicare_id || '';
  const npi = facility.npi || r.npi || '';
  const stationsVal = r.number_of_chairs || r.stations || facility.number_of_chairs || facility.stations || null;

  html += '<div class="detail-section">';
  html += '<div class="detail-section-title" style="display:flex;align-items:center;gap:8px">';
  html += 'CMS Facility Profile';
  html += '<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:' + operator.color + '22;color:' + operator.color + ';font-size:10px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase">' + esc(operator.label) + '</span>';
  html += '</div>';
  html += '<div class="detail-grid">';
  if (ccn) html += _row('Medicare ID (CCN)', ccn);
  if (npi) html += _row('NPI', npi);
  html += _row('Operator / Chain', r.chain_organization || r.operator_name || facility.chain_organization || facility.operator_name);
  html += _row('Stations', stationsVal != null ? fmtN(stationsVal) : null);
  html += _row('Total Staff', totalStaff != null ? fmtN(totalStaff) : null);
  if (latestTreatments != null) {
    const txTrend = treatmentYoYPct != null
      ? ' <span style="font-size:11px;color:' + (treatmentYoYPct >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (treatmentYoYPct >= 0 ? '&#9650; +' : '&#9660; ') + treatmentYoYPct.toFixed(1) + '% YoY</span>'
      : '';
    html += _rowHtml('Treatments (latest)', fmtN(latestTreatments) + txTrend);
  }
  if (qipScore != null) {
    const qipNum = Number(qipScore);
    const qipColor = qipNum >= 80 ? 'var(--green)' : qipNum >= 60 ? 'var(--yellow)' : 'var(--red)';
    html += _rowHtml('QIP Total Score', '<span style="color:' + qipColor + ';font-weight:600">' + qipNum.toFixed(0) + '</span> <span style="font-size:10px;color:var(--text3)">/ 100</span>');
  }
  const starVal2 = quality.star_rating != null ? Number(quality.star_rating) : (r.star_rating != null ? Number(r.star_rating) : null);
  if (starVal2 != null) html += _rowHtml('5-Star Rating', _starsCompact(starVal2));
  if (lastSurveyDate) html += _row('Last CMS Survey', _fmtDate(lastSurveyDate));
  html += '</div>';
  html += '</div>';

  // ════════════════════════════════════════════════════════════════════════════
  // 2. FINANCIAL SUMMARY
  // ════════════════════════════════════════════════════════════════════════════

  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Financial Summary</div>';

  // Source badge
  const revSource = finDetail.estimate_source || r.revenue_calc_method || 'CMS Patient Count';
  html += '<div style="margin-bottom:10px"><span style="display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;background:var(--purple);color:#fff;font-weight:600;letter-spacing:0.3px">' + esc(revSource) + '</span></div>';

  html += '<div class="detail-grid">';
  html += _rowMoney('Est. Annual Revenue', finDetail.estimated_annual_revenue || r.estimated_annual_revenue);
  html += _rowMoney('Total Operating Costs', r.ttm_operating_costs);
  html += _rowMoney('Operating Profit', finDetail.estimated_operating_profit || r.ttm_operating_profit);
  html += _rowHtml('Operating Margin', margin != null ? _marginBadge(margin) : null);

  // Revenue & cost per treatment — use model treatments (patients×156) when HCRIS data looks partial
  const rawTx = r.estimated_annual_treatments || r.ttm_total_treatments;
  const modelTx = bestPatientCount ? bestPatientCount * 156 : null; // 3 tx/week × 52 weeks
  const txLooksPartial = rawTx && modelTx && (rawTx / modelTx < 0.5);
  const annualTx = txLooksPartial ? modelTx : (rawTx || modelTx);
  if (annualTx && estRevenue) {
    const revPerTx = Number(estRevenue) / Number(annualTx);
    html += _rowHtml('Revenue / Treatment', '$' + fmtN(Math.round(revPerTx)));
  }
  if (annualTx && r.ttm_operating_costs) {
    const costPerTx = Number(r.ttm_operating_costs) / Number(annualTx);
    html += _rowHtml('Cost / Treatment', '$' + fmtN(Math.round(costPerTx)));
  }
  html += _rowHtml('Treatments / Year', annualTx ? fmtN(annualTx) + (txLooksPartial ? ' <span style="font-size:10px;color:var(--text3)">(modeled)</span>' : '') : null);
  html += '</div>';

  // Payer Mix — 4-level comparison: Clinic → County Avg → State Avg → National (smallest to largest)
  const payerBars = [];
  const _natl = { label: 'National Default', med: 65, mcd: 20, pvt: 11 };
  _natl.oth = Math.max(0, 100 - _natl.med - _natl.mcd - _natl.pvt);

  const clinicState = geoPayerMix ? (geoPayerMix.state || r.state || '') : (r.state || '');
  const clinicCounty = geoPayerMix ? (geoPayerMix.county || r.county || '') : (r.county || '');

  // 1. This Clinic (HCRIS actual or rankings fallback) — first/smallest
  let clinicBar = null;
  if (payerMixHcris && payerMixHcris.medicare_pct != null) {
    const hMed = Number(payerMixHcris.medicare_pct);
    const hMcd = Number(payerMixHcris.medicaid_pct || 0);
    const hPvt = Number(payerMixHcris.private_pct || 0);
    clinicBar = { label: 'This Clinic (HCRIS)', med: hMed, mcd: hMcd, pvt: hPvt, oth: Math.max(0, 100 - hMed - hMcd - hPvt), source: 'revenue' };
  } else if (r.payer_mix_medicare_pct != null) {
    const rMed = Number(r.payer_mix_medicare_pct);
    const rMcd = Number(r.payer_mix_medicaid_pct || 0);
    const rPvt = Number(r.payer_mix_private_pct || 0);
    clinicBar = { label: 'This Clinic', med: rMed, mcd: rMcd, pvt: rPvt, oth: Math.max(0, 100 - rMed - rMcd - rPvt) };
  }
  if (clinicBar) payerBars.push(clinicBar);

  // 2. County average (from geo view)
  if (geoPayerMix && geoPayerMix.county_medicare_pct != null) {
    const cMed = Number(geoPayerMix.county_medicare_pct);
    const cMcd = Number(geoPayerMix.county_medicaid_pct || 0);
    const cPvt = Number(geoPayerMix.county_private_pct || 0);
    const cCount = Number(geoPayerMix.county_clinic_count || 0);
    payerBars.push({ label: clinicCounty ? clinicCounty + ' Co. Avg' : 'County Avg', med: cMed, mcd: cMcd, pvt: cPvt, oth: Math.max(0, 100 - cMed - cMcd - cPvt), note: cCount + ' clinic' + (cCount !== 1 ? 's' : '') });
  }

  // 3. State average (from geo view)
  if (geoPayerMix && geoPayerMix.state_medicare_pct != null) {
    const sMed = Number(geoPayerMix.state_medicare_pct);
    const sMcd = Number(geoPayerMix.state_medicaid_pct || 0);
    const sPvt = Number(geoPayerMix.state_private_pct || 0);
    const sCount = Number(geoPayerMix.state_clinic_count || 0);
    payerBars.push({ label: clinicState ? clinicState + ' State Avg' : 'State Avg', med: sMed, mcd: sMcd, pvt: sPvt, oth: Math.max(0, 100 - sMed - sMcd - sPvt), note: sCount + ' clinics' });
  }

  // 4. National Default — last/largest
  payerBars.push(_natl);

  // Determine the "active" payer mix for revenue estimates (prefer clinic-specific > national)
  const activePayer = clinicBar || _natl;
  const payerIsDefault = activePayer === _natl;

  html += '<div style="margin-top:14px">';
  html += '<div style="font-size:12px;color:var(--text2);margin-bottom:8px;font-weight:600">Payer Mix Comparison</div>';

  // Render each bar
  payerBars.forEach(bar => {
    const isNatl = bar === _natl;
    html += '<div style="margin-bottom:10px">';
    html += '<div style="font-size:10px;color:var(--text3);margin-bottom:3px;display:flex;justify-content:space-between">';
    html += '<span>' + esc(bar.label) + (bar.source === 'revenue' ? ' <span style="font-size:9px;opacity:0.7">revenue-based</span>' : '') + (bar.note ? ' <span style="font-size:9px;opacity:0.6">(' + esc(bar.note) + ')</span>' : '') + '</span>';
    if (bar === activePayer && payerIsDefault) html += '<span style="font-size:9px;padding:1px 5px;border-radius:6px;background:var(--text3);color:var(--bg);font-weight:700">In Use</span>';
    if (bar === activePayer && !payerIsDefault) html += '<span style="font-size:9px;padding:1px 5px;border-radius:6px;background:var(--green);color:var(--bg);font-weight:700">In Use</span>';
    html += '</div>';
    html += '<div style="display:flex;height:14px;border-radius:3px;overflow:hidden;font-size:0">';
    if (bar.med) html += '<div style="width:' + bar.med + '%;background:#3b82f6" title="Medicare ' + bar.med.toFixed(1) + '%"></div>';
    if (bar.mcd) html += '<div style="width:' + bar.mcd + '%;background:#8b5cf6" title="Medicaid ' + bar.mcd.toFixed(1) + '%"></div>';
    if (bar.pvt) html += '<div style="width:' + bar.pvt + '%;background:#10b981" title="Commercial ' + bar.pvt.toFixed(1) + '%"></div>';
    if (bar.oth > 0.5) html += '<div style="width:' + bar.oth + '%;background:var(--text3)" title="Other ' + bar.oth.toFixed(1) + '%"></div>';
    html += '</div>';
    // Inline percentages
    html += '<div style="display:flex;gap:8px;font-size:10px;color:var(--text3);margin-top:2px">';
    html += '<span>Med ' + bar.med.toFixed(0) + '%</span>';
    html += '<span>Mcd ' + bar.mcd.toFixed(0) + '%</span>';
    html += '<span>Pvt ' + bar.pvt.toFixed(0) + '%</span>';
    if (bar.oth > 0.5) html += '<span>Oth ' + bar.oth.toFixed(0) + '%</span>';
    html += '</div>';
    html += '</div>';
  });

  // Legend (shared)
  html += '<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;margin-top:4px">';
  html += '<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#3b82f6;margin-right:3px"></span>Medicare</span>';
  html += '<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#8b5cf6;margin-right:3px"></span>Medicaid</span>';
  html += '<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#10b981;margin-right:3px"></span>Commercial</span>';
  html += '<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--text3);margin-right:3px"></span>Other</span>';
  html += '</div>';

  // Payer mix dollar estimates using active payer
  if (estRevenue) {
    const rev = Number(estRevenue);
    html += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px 12px;margin-top:8px;font-size:12px;color:var(--text2)">';
    html += '<div>Medicare</div><div style="text-align:right;font-weight:600">$' + _fmtCompact(rev * activePayer.med / 100) + '</div>';
    html += '<div>Medicaid</div><div style="text-align:right;font-weight:600">$' + _fmtCompact(rev * activePayer.mcd / 100) + '</div>';
    html += '<div>Commercial</div><div style="text-align:right;font-weight:600">$' + _fmtCompact(rev * activePayer.pvt / 100) + '</div>';
    if (activePayer.oth > 0.5) html += '<div>Other</div><div style="text-align:right;font-weight:600">$' + _fmtCompact(rev * activePayer.oth / 100) + '</div>';
    html += '</div>';
  }
  html += '</div>';

  // HCRIS Modeled vs Actual comparison callout
  if (costRpt && costRpt.total_patient_revenue && estRevenue) {
    const actual = Number(costRpt.total_patient_revenue);
    const modeled = Number(estRevenue);
    const variance = ((modeled - actual) / actual * 100).toFixed(1);
    html += '<div style="margin-top:14px;padding:10px 12px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px">&#x1F4CA; Modeled vs. HCRIS Actual (FY' + (costRpt.fiscal_year || '?') + ')</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px">';
    html += '<div style="color:var(--text3)">Modeled Revenue</div><div style="text-align:right;font-weight:600">$' + _fmtCompact(modeled) + '</div>';
    html += '<div style="color:var(--text3)">HCRIS Actual</div><div style="text-align:right;font-weight:600">$' + _fmtCompact(actual) + '</div>';
    html += '<div style="color:var(--text3)">Variance</div><div style="text-align:right;font-weight:600;color:' + (Math.abs(variance) < 10 ? 'var(--green)' : 'var(--yellow)') + '">' + (variance > 0 ? '+' : '') + variance + '%</div>';
    html += '</div></div>';
  }

  html += '</div>';

  // ════════════════════════════════════════════════════════════════════════════
  // 3. PATIENT CENSUS & TRENDS
  // ════════════════════════════════════════════════════════════════════════════

  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Patient Census & Trends</div>';

  // Sparkline chart from patient history
  if (patientHistory.length >= 2) {
    html += _opsSparkline(patientHistory);
  }

  // Trend direction badge
  const trendConf = trends.trend_confidence || '';
  html += '<div style="display:flex;gap:8px;align-items:center;margin:10px 0">';
  html += '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:' + trendColor + '22;color:' + trendColor + '">' + trendArrowIcon + ' ' + esc(trendLabel) + '</span>';
  if (trendConf) html += '<span style="font-size:11px;color:var(--text3)">Confidence: ' + esc(String(trendConf)) + '</span>';
  html += '</div>';

  html += '<div class="detail-grid">';
  html += _row('Current Patients', bestPatientCount ? fmtN(bestPatientCount) : null);
  if (r.patients_last_year) html += _rowTrend('Last Year', fmtN(r.patients_last_year), r.patient_yoy_pct);
  if (r.patients_two_years_ago) html += _row('Two Years Ago', fmtN(r.patients_two_years_ago));
  if (r.patient_3yr_avg) html += _rowTrend('3-Year Average', fmtN(r.patient_3yr_avg), r.patient_vs_3yr_avg_pct);

  // Annualized growth rate (CAGR)
  const cagr = trends.annualized_growth_rate;
  if (cagr != null) {
    const cagrColor = Number(cagr) > 0 ? 'var(--green)' : Number(cagr) < 0 ? 'var(--red)' : 'var(--text3)';
    html += _rowHtml('Annualized Growth (CAGR)', '<span style="color:' + cagrColor + ';font-weight:600">' + (Number(cagr) > 0 ? '+' : '') + Number(cagr).toFixed(1) + '%</span>');
  }
  // Regression slope
  if (trends.regression_slope != null) {
    const slope = Number(trends.regression_slope);
    html += _row('Regression Slope', (slope > 0 ? '+' : '') + slope.toFixed(1) + ' patients/yr');
  }
  if (trends.regression_r_squared != null) {
    html += _row('R\u00B2', Number(trends.regression_r_squared).toFixed(3));
  }
  // Projections — recalculate revenue from projected patients × per-patient revenue
  // (database projected_revenue can be inconsistent with flat/declining patient trends)
  const projPt1 = trends.projected_patients_1yr != null ? Math.round(Number(trends.projected_patients_1yr)) : null;
  const projPt3 = trends.projected_patients_3yr != null ? Math.round(Number(trends.projected_patients_3yr)) : null;
  if (projPt1 != null) html += _row('Projected Patients (1yr)', fmtN(projPt1));
  if (projPt3 != null) html += _row('Projected Patients (3yr)', fmtN(projPt3));
  // Revenue projections: derive from patient projections × current per-patient revenue (+ 3% annual inflation)
  if (estRevenue && bestPatientCount && bestPatientCount > 0) {
    const revenuePerPatient = Number(estRevenue) / bestPatientCount;
    if (projPt1 != null) {
      const projRev1 = projPt1 * revenuePerPatient * 1.03;
      html += _rowMoney('Projected Revenue (1yr)', projRev1);
    }
    if (projPt3 != null) {
      const projRev3 = projPt3 * revenuePerPatient * Math.pow(1.03, 3);
      html += _rowMoney('Projected Revenue (3yr)', projRev3);
    }
  }
  html += '</div>';

  // Modality breakdown (if data available from rankings or medicare_clinics)
  const hasModality = r.offers_in_center_hemodialysis || r.offers_home_hemodialysis_training || r.offers_peritoneal_dialysis;
  if (hasModality) {
    html += '<div style="margin-top:12px;font-size:12px;color:var(--text2);font-weight:600;margin-bottom:6px">Treatment Modalities</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    if (r.offers_in_center_hemodialysis) html += '<span style="padding:3px 8px;border-radius:6px;background:rgba(59,130,246,0.12);color:#3b82f6;font-size:11px;font-weight:600">In-Center HD</span>';
    if (r.offers_home_hemodialysis_training) html += '<span style="padding:3px 8px;border-radius:6px;background:rgba(16,185,129,0.12);color:#10b981;font-size:11px;font-weight:600">Home HD</span>';
    if (r.offers_peritoneal_dialysis) html += '<span style="padding:3px 8px;border-radius:6px;background:rgba(139,92,246,0.12);color:#8b5cf6;font-size:11px;font-weight:600">Peritoneal</span>';
    html += '</div>';
  }

  html += '</div>';

  // ════════════════════════════════════════════════════════════════════════════
  // 4. CAPACITY & UTILIZATION
  // ════════════════════════════════════════════════════════════════════════════

  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Capacity & Utilization</div>';
  html += '<div class="detail-grid">';
  html += _row('Dialysis Stations/Chairs', r.number_of_chairs ? fmtN(r.number_of_chairs) : (r.stations ? fmtN(r.stations) : null));
  html += _row('Estimated Capacity', r.estimated_capacity ? fmtN(r.estimated_capacity) + ' patients' : (r.max_patient_capacity ? fmtN(r.max_patient_capacity) + ' patients' : null));
  html += _rowHtml('Capacity Utilization', r.capacity_utilization_pct != null ? _utilBar(Number(r.capacity_utilization_pct)) : null);
  if (bestPatientCount && r.number_of_chairs) {
    html += _row('Patients / Chair', (bestPatientCount / Number(r.number_of_chairs)).toFixed(1));
  }
  html += _row('Operator', r.operator_name);
  html += _row('Chain', r.chain_organization);
  html += '</div></div>';

  // ════════════════════════════════════════════════════════════════════════════
  // 5. QUALITY & RISK — two panels side by side
  // ════════════════════════════════════════════════════════════════════════════

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:4px">';

  // ── Quality Metrics Panel ──
  html += '<div class="detail-section" style="margin-bottom:0">';
  html += '<div class="detail-section-title">Quality Metrics</div>';
  html += '<div class="detail-grid">';
  html += _rowHtml('CMS Star Rating', starVal != null ? _stars(starVal) : null);
  // Quality metrics with national benchmarks (per 100 patient-years, CMS DFC benchmarks)
  const mortRate = quality.mortality_rate != null ? Number(quality.mortality_rate) : (r.mortality_rate != null ? Number(r.mortality_rate) : null);
  html += _rowHtml('Mortality Rate', mortRate != null ? _qualityBenchmark(mortRate, 15.0, 'lower') : null);
  const hospRate = quality.hospitalization_rate != null ? Number(quality.hospitalization_rate) : null;
  html += _rowHtml('Hospitalization Rate', hospRate != null ? _qualityBenchmark(hospRate, 150.0, 'lower') : null);
  const readmRate = quality.readmission_rate != null ? Number(quality.readmission_rate) : null;
  html += _rowHtml('Readmission Rate', readmRate != null ? _qualityBenchmark(readmRate, 25.0, 'lower') : null);
  html += _row('Infection Ratio', quality.infection_ratio != null ? Number(quality.infection_ratio).toFixed(2) : null);
  html += _row('Transplant Waitlist', quality.transplant_waitlist_ratio != null ? Number(quality.transplant_waitlist_ratio).toFixed(2) : null);
  html += _row('Deficiency Count', r.deficiency_count != null ? fmtN(r.deficiency_count) : null);
  html += '</div></div>';

  // ── Risk Assessment Panel ──
  html += '<div class="detail-section" style="margin-bottom:0">';
  html += '<div class="detail-section-title">Risk Assessment</div>';

  // Compute composite lease risk score (0-100)
  const riskScores = _computeLeaseRisk(r, trends, quality, lease, leaseMonths, margin);
  const riskLevel = riskScores.total <= 25 ? 'Low' : riskScores.total <= 50 ? 'Moderate' : riskScores.total <= 75 ? 'High' : 'Critical';
  const riskColor = riskScores.total <= 25 ? 'var(--green)' : riskScores.total <= 50 ? 'var(--yellow)' : riskScores.total <= 75 ? 'var(--orange)' : 'var(--red)';

  // Gauge visual
  html += '<div style="text-align:center;margin-bottom:10px">';
  html += '<div style="position:relative;width:80px;height:40px;margin:0 auto;overflow:hidden">';
  html += '<div style="width:80px;height:80px;border-radius:50%;border:6px solid var(--s3);border-bottom-color:transparent;border-left-color:transparent;transform:rotate(225deg);box-sizing:border-box"></div>';
  html += '<div style="position:absolute;top:0;left:0;width:80px;height:80px;border-radius:50%;border:6px solid ' + riskColor + ';border-bottom-color:transparent;border-left-color:transparent;transform:rotate(' + (225 + riskScores.total * 1.8) + 'deg);box-sizing:border-box;clip-path:inset(0 0 50% 0)"></div>';
  html += '<div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);font-size:16px;font-weight:700;color:' + riskColor + '">' + riskScores.total + '</div>';
  html += '</div>';
  html += '<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;background:' + riskColor + '22;color:' + riskColor + '">' + riskLevel + ' Risk</span>';
  html += '</div>';

  // Component breakdown
  html += '<div style="font-size:11px;color:var(--text3)">';
  const riskComponents = [
    { label: 'Patient Trend', value: riskScores.patientTrend, weight: '30%' },
    { label: 'Financial', value: riskScores.financial, weight: '25%' },
    { label: 'Quality', value: riskScores.quality, weight: '20%' },
    { label: 'Lease Expiration', value: riskScores.leaseExp, weight: '15%' },
    { label: 'Market', value: riskScores.market, weight: '10%' }
  ];
  riskComponents.forEach(rc => {
    const rcColor = rc.value <= 25 ? 'var(--green)' : rc.value <= 50 ? 'var(--yellow)' : rc.value <= 75 ? 'var(--orange)' : 'var(--red)';
    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
    html += '<span style="width:90px;flex-shrink:0">' + rc.label + ' (' + rc.weight + ')</span>';
    html += '<div style="flex:1;height:4px;background:var(--s3);border-radius:2px;overflow:hidden"><div style="width:' + rc.value + '%;height:100%;background:' + rcColor + ';border-radius:2px"></div></div>';
    html += '<span style="width:20px;text-align:right;font-weight:600;color:' + rcColor + '">' + rc.value + '</span>';
    html += '</div>';
  });
  html += '</div>';

  html += '</div>';
  html += '</div>'; // end side-by-side grid

  // ── COMPARATIVE RANKINGS ──
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Comparative Rankings</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">';
  html += '<div style="font-size:11px;color:var(--text3);font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">By Patients</div>';
  html += '<div style="font-size:11px;color:var(--text3);font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">By Revenue</div>';
  html += '</div>';
  const rankScopes = [
    { label: 'County', patRank: r.county_patient_rank, revRank: r.county_revenue_rank, total: r.county_total, ctx: r.county },
    { label: 'State', patRank: r.state_patient_rank, revRank: r.state_revenue_rank, total: r.state_total, ctx: r.state },
    { label: 'Operator', patRank: r.operator_patient_rank, revRank: r.operator_revenue_rank, total: r.operator_total, ctx: r.operator_name },
    { label: 'National', patRank: r.national_patient_rank, revRank: r.national_revenue_rank, total: r.national_total, ctx: null }
  ];
  rankScopes.forEach(rs => {
    if (!rs.patRank && !rs.revRank) return;
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">';
    html += '<div>' + _rankingBar(rs.label, rs.patRank, rs.total, rs.ctx) + '</div>';
    html += '<div>' + (rs.revRank ? _rankingBar(rs.label, rs.revRank, rs.total, rs.ctx) : '<div style="color:var(--text3);font-size:11px;padding:8px 0">N/A</div>') + '</div>';
    html += '</div>';
  });
  html += '</div>';

  // ════════════════════════════════════════════════════════════════════════════
  // 6. METHODOLOGY & SOURCES FOOTER
  // ════════════════════════════════════════════════════════════════════════════

  html += '<div class="detail-section" style="border-top:1px solid var(--s3);padding-top:12px">';
  html += '<div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\';this.querySelector(\'span\').textContent=this.nextElementSibling.style.display===\'none\'?\'\\u25B6\':\'\\u25BC\'" style="cursor:pointer;font-size:12px;font-weight:700;color:var(--text2);display:flex;align-items:center;gap:6px">';
  html += '<span>&#x25B6;</span> Methodology & Data Sources</div>';
  html += '<div style="display:none;margin-top:10px;font-size:11px;color:var(--text3);line-height:1.6">';

  html += '<p style="margin:0 0 8px">Revenue estimates use a 4-payer model: Medicare $279/tx, Medicaid $225/tx, Commercial $1,100/tx, Other $250/tx, at 156 treatments/year (3x/week). State-level payer mix baselines with demographic adjustments.</p>';

  html += '<p style="margin:0 0 8px"><strong style="color:var(--text2)">Risk Score Components:</strong></p>';
  html += '<p style="margin:0 0 4px;padding-left:8px"><strong style="color:var(--text2)">Patient Trend (30%):</strong> Measures YoY patient growth/decline and regression trend direction. Declining census signals potential revenue erosion and operator dissatisfaction.</p>';
  html += '<p style="margin:0 0 4px;padding-left:8px"><strong style="color:var(--text2)">Financial Health (25%):</strong> Based on operating margin. Margins above 15% are healthy; below 3% indicate financial stress and higher risk of closure or relocation.</p>';
  html += '<p style="margin:0 0 4px;padding-left:8px"><strong style="color:var(--text2)">Quality Metrics (20%):</strong> CMS star rating (1-5). Lower ratings correlate with regulatory scrutiny, patient attrition, and potential operator exit.</p>';
  html += '<p style="margin:0 0 4px;padding-left:8px"><strong style="color:var(--text2)">Lease Expiration (15%):</strong> Remaining months on lease. Shorter terms increase vacancy risk and reduce investor certainty.</p>';
  html += '<p style="margin:0 0 8px;padding-left:8px"><strong style="color:var(--text2)">Market Conditions (10%):</strong> Uses capacity utilization as a demand proxy. High utilization (85%+) signals strong market demand; low utilization suggests oversupply.</p>';

  html += '<p style="margin:0 0 8px"><strong style="color:var(--text2)">Quality Benchmarks:</strong> Mortality, hospitalization, and readmission rates are per 100 patient-years. Figures are compared against national CMS Dialysis Facility Compare averages (mortality ~15, hospitalization ~150, readmission ~25). Lower is better for all three metrics.</p>';

  // Data freshness
  const latestSnapshot = patientHistory.length > 0 ? patientHistory[patientHistory.length - 1].snapshot_date : null;
  const qualityDate = quality.snapshot_date || null;
  html += '<p style="margin:0 0 8px"><strong style="color:var(--text2)">Data Freshness:</strong> ';
  html += 'Patient data as of ' + (latestSnapshot ? _fmtDate(latestSnapshot) : 'N/A') + '. ';
  html += 'Quality metrics as of ' + (qualityDate ? _fmtDate(qualityDate) : 'N/A') + '.</p>';

  html += '<p style="margin:0"><strong style="color:var(--text2)">Sources:</strong> CMS Dialysis Facility Compare, USRDS, DaVita 10-K, MedPAC Reports, Census ACS, CDC PLACES.</p>';
  html += '</div>';
  html += '</div>';

  return html;
}

/** Compact star display for KPI card */
function _starsCompact(n) {
  if (n == null) return 'N/A';
  const full = Math.floor(n);
  const color = n >= 4 ? 'var(--green)' : n >= 3 ? 'var(--yellow)' : 'var(--red)';
  return '<span style="color:' + color + ';letter-spacing:1px">' +
    '&#9733;'.repeat(full) +
    '<span style="color:var(--text3)">' + '&#9734;'.repeat(5 - full) + '</span>' +
    '</span>';
}

/** Patient history sparkline (inline SVG) */
function _opsSparkline(history) {
  if (!history || history.length < 2) return '';
  const pts = history.map(h => Number(h.total_patients || h.patient_count || 0)).filter(v => v > 0);
  if (pts.length < 2) return '';

  const w = 280, h = 50, pad = 4;
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = max - min || 1;

  const points = pts.map((v, i) => {
    const x = pad + (i / (pts.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });

  const lastVal = pts[pts.length - 1];
  const firstVal = pts[0];
  const trendColor = lastVal >= firstVal ? 'var(--green)' : 'var(--red)';

  let svg = '<div style="margin-bottom:8px">';
  svg += '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-bottom:2px">';
  svg += '<span>' + (history[0].snapshot_date ? _fmtDate(history[0].snapshot_date) : '') + '</span>';
  svg += '<span>Patient Census History</span>';
  svg += '<span>' + (history[history.length - 1].snapshot_date ? _fmtDate(history[history.length - 1].snapshot_date) : '') + '</span>';
  svg += '</div>';
  svg += '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="display:block">';
  // Fill area
  svg += '<polygon points="' + pad + ',' + h + ' ' + points.join(' ') + ' ' + (w - pad) + ',' + h + '" fill="' + trendColor + '" fill-opacity="0.08"/>';
  // Line
  svg += '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + trendColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
  // Endpoint dot
  const lastPt = points[points.length - 1].split(',');
  svg += '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="3" fill="' + trendColor + '"/>';
  svg += '</svg>';
  svg += '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2)">';
  svg += '<span>' + fmtN(firstVal) + ' patients</span>';
  svg += '<span style="font-weight:600;color:' + trendColor + '">' + fmtN(lastVal) + ' patients</span>';
  svg += '</div>';
  svg += '</div>';
  return svg;
}

/** Compute composite lease risk score (0-100) */
function _computeLeaseRisk(r, trends, quality, lease, leaseMonths, margin) {
  // Patient Trend Risk (30%)
  let ptRisk = 50; // default moderate
  if (r.patient_yoy_pct != null) {
    const yoy = Number(r.patient_yoy_pct);
    ptRisk = yoy > 5 ? 10 : yoy > 0 ? 25 : yoy > -5 ? 60 : yoy > -10 ? 80 : 95;
  }
  if (trends.trend_direction === 'growth') ptRisk = Math.min(ptRisk, 20);
  if (trends.trend_direction === 'decline') ptRisk = Math.max(ptRisk, 70);

  // Financial Risk (25%)
  let finRisk = 50;
  if (margin != null) {
    finRisk = margin > 15 ? 10 : margin > 8 ? 25 : margin > 3 ? 50 : margin > 0 ? 75 : 95;
  }

  // Quality Risk (20%)
  let qRisk = 50;
  const stars = quality.star_rating != null ? Number(quality.star_rating) : (r.star_rating != null ? Number(r.star_rating) : null);
  if (stars != null) {
    qRisk = stars >= 4 ? 15 : stars >= 3 ? 35 : stars >= 2 ? 65 : 90;
  }

  // Lease Expiration Risk (15%)
  let leaseRisk = 50;
  if (leaseMonths != null) {
    leaseRisk = leaseMonths > 84 ? 10 : leaseMonths > 60 ? 20 : leaseMonths > 36 ? 40 : leaseMonths > 24 ? 60 : leaseMonths > 12 ? 80 : 95;
  }

  // Market Risk (10%) — use utilization as proxy
  let mktRisk = 50;
  if (r.capacity_utilization_pct != null) {
    const util = Number(r.capacity_utilization_pct);
    mktRisk = util >= 85 ? 15 : util >= 70 ? 35 : util >= 50 ? 60 : 85;
  }

  const total = Math.round(ptRisk * 0.30 + finRisk * 0.25 + qRisk * 0.20 + leaseRisk * 0.15 + mktRisk * 0.10);
  return {
    total: Math.min(100, Math.max(0, total)),
    patientTrend: Math.round(ptRisk),
    financial: Math.round(finRisk),
    quality: Math.round(qRisk),
    leaseExp: Math.round(leaseRisk),
    market: Math.round(mktRisk)
  };
}

/** Quality metric with national benchmark comparison */
function _qualityBenchmark(value, natlAvg, direction) {
  // direction: 'lower' = lower is better, 'higher' = higher is better
  const v = Number(value);
  const ratio = v / natlAvg;
  let color, label;
  if (direction === 'lower') {
    color = ratio <= 0.9 ? 'var(--green)' : ratio <= 1.15 ? 'var(--yellow)' : 'var(--red)';
    label = ratio <= 0.9 ? 'Better' : ratio <= 1.15 ? 'Near Avg' : 'Above Avg';
  } else {
    color = ratio >= 1.1 ? 'var(--green)' : ratio >= 0.85 ? 'var(--yellow)' : 'var(--red)';
    label = ratio >= 1.1 ? 'Better' : ratio >= 0.85 ? 'Near Avg' : 'Below Avg';
  }
  return '<span style="font-weight:600">' + v.toFixed(1) + '</span>' +
    ' <span style="font-size:10px;color:var(--text3)">vs ' + natlAvg.toFixed(0) + ' avg</span>' +
    ' <span style="font-size:9px;padding:1px 5px;border-radius:6px;background:' + color + '22;color:' + color + ';font-weight:600">' + label + '</span>';
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

/**
 * Dedup ownership_history rows for the chain timeline.
 * Merges entries that point at the same owner_entity (recorded_owner_id,
 * true_owner_id, or normalized recorded_owner_name) so that the same shell
 * LLC doesn't appear as both the current owner AND a historical owner.
 * Earliest transfer_date wins; latest ownership_end wins; counts how many
 * source rows were merged so the UI can surface it.
 */
function _udDedupChain(chain, currentOwn) {
  if (!Array.isArray(chain) || chain.length === 0) return [];

  const _key = (h) => {
    if (h.owner_entity_id) return 'oe:' + h.owner_entity_id;
    if (h.recorded_owner_id) return 'ro:' + h.recorded_owner_id;
    if (h.true_owner_id) return 'to:' + h.true_owner_id;
    const name = (h.recorded_owner_name || h.to_owner || h.true_owner_name || '').trim().toLowerCase();
    return name ? 'nm:' + name.replace(/[\s,.]+/g, ' ') : null;
  };

  const _ts = (s) => { if (!s) return null; const t = new Date(s).getTime(); return isNaN(t) ? null : t; };

  const groups = new Map();
  const order = [];
  for (const h of chain) {
    const k = _key(h) || ('row:' + order.length);
    if (!groups.has(k)) {
      const cloned = Object.assign({}, h);
      cloned._merged_count = 1;
      groups.set(k, cloned);
      order.push(k);
    } else {
      const g = groups.get(k);
      g._merged_count = (g._merged_count || 1) + 1;
      // Earliest transfer_date wins
      const t1 = _ts(g.transfer_date), t2 = _ts(h.transfer_date);
      if (t2 != null && (t1 == null || t2 < t1)) g.transfer_date = h.transfer_date;
      // Latest ownership_end wins; if any row is still open (null), prefer null
      if (h.ownership_end == null) {
        g.ownership_end = null;
      } else if (g.ownership_end != null) {
        const e1 = _ts(g.ownership_end), e2 = _ts(h.ownership_end);
        if (e2 != null && (e1 == null || e2 > e1)) g.ownership_end = h.ownership_end;
      }
      // Backfill any missing fields from later rows
      ['sale_price','cap_rate','ownership_type','ownership_source','principal_names',
       'true_owner_name','true_owner_id','recorded_owner_name','recorded_owner_id',
       'sf_account_id','sf_company_id','sf_contact_id','from_owner','to_owner',
       'state_of_incorporation','recorded_owner_state','annual_rent','square_feet',
       'research_status'].forEach(function(f) {
        if (g[f] == null && h[f] != null) g[f] = h[f];
      });
    }
  }

  // If the current owner (from v_ownership_current) matches a chain entry,
  // mark that entry as "is open" so the timeline shows "Present" correctly.
  if (currentOwn) {
    const curKey = currentOwn.recorded_owner_id ? 'ro:' + currentOwn.recorded_owner_id
      : currentOwn.true_owner_id ? 'to:' + currentOwn.true_owner_id
      : (currentOwn.recorded_owner ? 'nm:' + String(currentOwn.recorded_owner).trim().toLowerCase().replace(/[\s,.]+/g, ' ') : null);
    if (curKey && groups.has(curKey)) {
      const g = groups.get(curKey);
      g.ownership_end = null;
    }
  }

  // Re-sort by transfer_date desc (most recent first)
  return order.map(function(k) { return groups.get(k); }).sort(function(a, b) {
    const ta = _ts(a.transfer_date) || 0;
    const tb = _ts(b.transfer_date) || 0;
    return tb - ta;
  });
}

/**
 * One-click resolver for Data Gap chips on the Ownership tab.
 * Routes the chip's action to the appropriate input or workflow.
 */
function _udResolveGap(action) {
  if (!action) return;
  if (action.indexOf('focus:') === 0) {
    const id = action.slice('focus:'.length);
    const el = document.getElementById(id);
    if (el) {
      // Make sure the Resolve Ownership form is on screen
      const sec = el.closest('.detail-section');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function() { try { el.focus(); el.select && el.select(); } catch (e) {} }, 280);
    } else {
      showToast('Open the Resolve Ownership section to fill this in', 'info');
    }
    return;
  }
  if (action === 'sf-lookup') {
    // Open the SF account lookup for the current owner name in a new tab
    const own = _udCache && _udCache.ownership;
    const name = (own && (own.true_owner || own.recorded_owner)) || '';
    if (!name) { showToast('Enter the owner name first', 'info'); return; }
    const url = _SF_BASE + '/lightning/o/Account/list?filterName=Recent&searchKey=' + encodeURIComponent(name);
    window.open(url, '_blank', 'noopener');
    showToast('Searching Salesforce for "' + name + '"', 'info');
    return;
  }
  if (action === 'research-history') {
    // Jump the user to the Research Quick Links section if present
    const ql = document.querySelector('.ql-grid');
    if (ql) {
      ql.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('Use Research Quick Links to fetch ownership history (CoStar, Reonomy, county recorder)', 'info');
    } else {
      showToast('No research links available for this property', 'info');
    }
    return;
  }
  console.warn('_udResolveGap: unknown action', action);
}

window._udResolveGap = _udResolveGap;

/**
 * Dedup ownership_history rows for the chain timeline.
 * Merges entries that point at the same owner_entity (recorded_owner_id,
 * true_owner_id, or normalized recorded_owner_name) so that the same shell
 * LLC doesn't appear as both the current owner AND a historical owner.
 * Earliest transfer_date wins; latest ownership_end wins; counts how many
 * source rows were merged so the UI can surface it.
 */
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
            html += _rowHtml('Buyer / Grantee', (fb.buyer_name || fb.grantee) && fb.buyer_id ? entityLink(fb.buyer_name || fb.grantee, 'contact', fb.buyer_id, db) : esc(fb.buyer_name || fb.grantee || ''));
      html += _row('Transfer Date', _fmtDate(fb.sale_date || fb.transfer_date));
      html += _rowMoney('Sale Price', fb.sale_price || fb.price);
      html += _row('Cap Rate', fb.cap_rate ? Number(fb.cap_rate).toFixed(2) + '%' : null);
      html += '</div></div>';
      return html;
    }
  }

  // ── DATA GAP INDICATOR ──────────────────────────────────────────────
  // Each gap badge is a one-click resolver that focuses the relevant input
  // or triggers a lookup action.
  const gaps = [];
  if (!own) gaps.push({ label: 'ownership record', action: 'focus:udOwnRecorded' });
  else {
    if (!own.true_owner && !own.recorded_owner) gaps.push({ label: 'owner name', action: 'focus:udOwnRecorded' });
    if (!own.contact_email) gaps.push({ label: 'contact email', action: 'focus:udOwnEmail' });
    if (!own.contact_phone) gaps.push({ label: 'contact phone', action: 'focus:udOwnPhone' });
    if (!own.contact_name && !own.contact_1_name) gaps.push({ label: 'contact name', action: 'focus:udOwnContact' });
    if (!own.sf_contact_id && !own.salesforce_id) gaps.push({ label: 'Salesforce link', action: 'sf-lookup' });
    if (db === 'gov' && !own.true_owner) gaps.push({ label: 'true owner (behind LLC)', action: 'focus:udOwnTrue' });
    if (db === 'gov' && !own.true_owner_state) gaps.push({ label: 'true owner state', action: 'focus:udOwnState' });
  }
  if (chain.length === 0) gaps.push({ label: 'ownership history', action: 'research-history' });

  if (gaps.length > 0) {
    html += '<div style="background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.3); border-radius: 10px; padding: 12px 16px; margin-bottom: 16px;">';
    html += '<div style="font-size: 12px; font-weight: 600; color: var(--yellow); margin-bottom: 4px;">Data Gaps (' + gaps.length + ') <span style="font-weight:400;color:var(--text3);font-size:11px">\u2014 click to resolve</span></div>';
    html += '<div style="font-size: 12px; color: var(--text2); line-height: 1.6;">';
    html += gaps.map(function(g) {
      const safeAction = String(g.action).replace(/'/g, "\\'");
      return '<span class="gap-chip" onclick="_udResolveGap(\'' + safeAction + '\')" style="display:inline-block;background:var(--s2);padding:2px 8px;border-radius:4px;margin:2px 4px 2px 0;font-size:11px;cursor:pointer;border:1px solid transparent;transition:all 0.15s" onmouseover="this.style.background=\'var(--s3)\';this.style.borderColor=\'var(--yellow)\'" onmouseout="this.style.background=\'var(--s2)\';this.style.borderColor=\'transparent\'" title="Click to resolve this gap">' + esc(g.label) + ' \u2192</span>';
    }).join('');
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
      html += _rowHtml('Recorded Owner', own.recorded_owner ? _ownerLink(own.recorded_owner, _ownerCtxFromCurrent(own, db, 'recorded')) : '');
      html += _rowHtml('True Owner', own.true_owner ? _ownerLink(own.true_owner, _ownerCtxFromCurrent(own, db, 'true')) : '');
      html += _row('Owner Type', own.owner_type);
      html += _row('Address', own.recorded_owner_address);
      html += _row('City', own.recorded_owner_city);
      html += _row('State', own.recorded_owner_state);
      html += _row('True Owner City', own.true_owner_city);
      html += _row('True Owner State', own.true_owner_state);
      html += _rowHtml('Contact 1', own.contact_1_name && own.contact_1_id ? entityLink(own.contact_1_name, 'contact', own.contact_1_id, db) : esc(own.contact_1_name || ''));
      html += _rowHtml('Contact 2', own.contact_2_name && own.contact_2_id ? entityLink(own.contact_2_name, 'contact', own.contact_2_id, db) : esc(own.contact_2_name || ''));
      html += _rowLink('Email', own.contact_email, own.contact_email ? _outlookSearchUrl(own.contact_email) : null);
      html += _rowLink('Phone', own.contact_phone, own.contact_phone ? 'tel:' + own.contact_phone : null);
      html += _row('Priority', own.priority_level);
      html += _row('Developer', own.developer_flag ? 'Yes' + (own.developer_tier ? ' · Tier ' + own.developer_tier : '') : null);
      html += _row('Total Properties', own.total_properties_owned ? fmtN(own.total_properties_owned) : null);
      html += _row('Current Count', own.current_property_count ? fmtN(own.current_property_count) : null);
      html += _row('Is Prospect', own.is_prospect ? 'Yes' : 'No');
    } else {
      // Gov
      html += _rowHtml('Recorded Owner', own.recorded_owner ? _ownerLink(own.recorded_owner, _ownerCtxFromCurrent(own, db, 'recorded')) : '');
      html += _row('Type', own.recorded_owner_type);
      html += _row('State', own.recorded_owner_state);
      html += _rowHtml('True Owner', own.true_owner ? _ownerLink(own.true_owner, _ownerCtxFromCurrent(own, db, 'true')) : '');
      html += _row('True Owner Type', own.true_owner_type);
      html += _row('True Owner State', own.true_owner_state);
      html += _rowHtml('Contact', own.contact_name && own.contact_id ? entityLink(own.contact_name, 'contact', own.contact_id, db) : esc(own.contact_name || ''));
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

  html += `<button onclick="_udBtnGuard(this, _udSaveOwnership)" style="margin-top:10px;width:100%;padding:10px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer">Save Ownership Resolution</button>`;
  html += '</div>';

  // ── OWNERSHIP HISTORY (CHAIN) ──────────────────────────────────────
  // Dedup: collapse repeat rows that point at the same owner_entity_id /
  // recorded_owner_id / true_owner_id. This prevents "Mds Dv Victorville"
  // from appearing as both the current owner AND a 2015–2016 historical
  // owner. Earliest transfer_date and latest ownership_end win.
  const dedupedChain = _udDedupChain(chain, own);
  html += '<div class="detail-section">';
  html += `<div class="detail-section-title">Ownership History <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:8px">${dedupedChain.length} records</span></div>`;

  if (dedupedChain.length === 0) {
    html += '<div class="detail-empty" style="font-size:13px">No ownership transfer history found for this property. Check the History tab or use Research Quick Links to trace prior owners.</div>';
  } else {
    // Determine if the most recent chain entry should be treated as "current".
    // An entry is current when its ownership_end is NULL, OR (fallback) when the
    // ownership_end is within 90 days of today and no more recent entry exists.
    // This guards against stale ownership_end dates on the current record.
    const _NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const _nowMs = Date.now();
    const _isChainEntryCurrent = (entry, isMostRecent) => {
      if (!isMostRecent) return false;
      if (!entry.ownership_end) return true;
      const endMs = new Date(entry.ownership_end).getTime();
      if (isNaN(endMs)) return true;
      return Math.abs(_nowMs - endMs) <= _NINETY_DAYS_MS;
    };

    html += '<div class="detail-timeline">';
    dedupedChain.forEach((h, idx) => {
      const isFirst = idx === 0;

      if (db === 'gov') {
        const statusClass = isFirst ? 'green' : '';
        const govOwnerName = h.to_owner || h.recorded_owner_name || h.true_owner_name || '';
        html += `<div class="detail-timeline-item ${statusClass}">`;
        html += `<div class="detail-card-date">${esc(_fmtDate(h.transfer_date) || 'Unknown date')}</div>`;
        html += `<div class="detail-card-title">${govOwnerName ? _ownerLink(govOwnerName, _ownerCtxFromChain(h, db)) : '\u2014'}</div>`;
        html += '<div class="detail-card-body">';
        if (h.from_owner) html += `<span style="font-size:12px;color:var(--text3)">From:</span> ${esc(h.from_owner)}<br>`;
        if (h.sale_price) html += `Sale: <span class="mono" style="color:var(--green)">${fmt(h.sale_price)}</span><br>`;
        if (h.cap_rate) html += `Cap Rate: ${Number(h.cap_rate).toFixed(2)}%<br>`;
        if (h.annual_rent) html += `Rent: ${fmt(h.annual_rent)}<br>`;
        if (h.square_feet) html += `SF: ${fmtN(h.square_feet)}<br>`;
        if (h.recorded_owner_name && h.recorded_owner_name !== govOwnerName) html += `<span style="font-size:12px;color:var(--text3)">Recorded:</span> ${_ownerLink(h.recorded_owner_name, _ownerCtxFromChain(h, db))}<br>`;
        if (h.true_owner_name && h.true_owner_name !== govOwnerName) html += `<span style="font-size:12px;color:var(--text3)">True Owner:</span> ${_ownerLink(h.true_owner_name, Object.assign(_ownerCtxFromChain(h, db), { name: h.true_owner_name }))}<br>`;
        if (h.principal_names) html += `<span style="font-size:12px;color:var(--text3)">Principals:</span> ${esc(h.principal_names)}<br>`;
        if (h._merged_count > 1) html += `<span class="detail-badge" style="background:var(--s3);color:var(--text2);margin-top:4px">${h._merged_count} entries merged</span>`;
        if (h.research_status) html += `<span class="detail-badge">${esc(cleanLabel(h.research_status))}</span>`;
        html += '</div>';
        html += '</div>';
      } else {
        // Dia: timeline row — [Owner]  start → end | sale price | cap rate
        const ownerLabel = h.recorded_owner_name || h.true_owner_name || '\u2014';
        const isCurrent = _isChainEntryCurrent(h, isFirst);
        const statusClass = isCurrent ? 'green' : '';
        const startStr = _fmtDate(h.transfer_date) || 'Unknown';
        const endStr = isCurrent ? 'Present' : (_fmtDate(h.ownership_end) || 'Unknown');
        const priceStr = h.sale_price
          ? '$' + Number(h.sale_price).toLocaleString(undefined, { maximumFractionDigits: 0 })
          : 'Not Disclosed';
        const capStr = h.cap_rate ? Number(h.cap_rate).toFixed(2) + '%' : '\u2014';

        html += `<div class="detail-timeline-item ${statusClass}">`;
        html += `<div class="detail-card-date">${esc(startStr)} \u2192 ${esc(endStr)}${isCurrent ? ' <span class="detail-badge" style="background:var(--green);color:#fff;margin-left:6px">Current</span>' : ''}</div>`;
        html += `<div class="detail-card-title">${_ownerLink(ownerLabel, _ownerCtxFromChain(h, db))}</div>`;
        html += '<div class="detail-card-body">';
        if (h.true_owner_name && h.recorded_owner_name && h.true_owner_name !== h.recorded_owner_name) {
          html += `<span style="font-size:12px;color:var(--text3)">True Owner:</span> ${_ownerLink(h.true_owner_name, Object.assign(_ownerCtxFromChain(h, db), { name: h.true_owner_name }))}<br>`;
        }
        html += `<div style="font-size:12px">Sale price: <span class="mono" style="color:var(--green)">${esc(priceStr)}</span> <span style="color:var(--text3)">|</span> Cap rate: ${esc(capStr)}</div>`;
        if (h.ownership_type) html += `<div style="font-size:11px;color:var(--text3);margin-top:2px">Type: ${esc(h.ownership_type)}</div>`;
        if (h.ownership_source) html += `<div style="font-size:11px;color:var(--text3)">Source: ${esc(h.ownership_source)}</div>`;
        if (h._merged_count > 1) html += `<div style="margin-top:4px"><span class="detail-badge" style="background:var(--s3);color:var(--text2)">${h._merged_count} entries merged</span></div>`;
        html += '</div>';
        html += '</div>';
      }
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
  html += `<button class="act-btn primary" id="udLogSubmit" onclick="_udSubmitLogCall(decodeURIComponent('${encodeURIComponent(sfCid)}'),decodeURIComponent('${encodeURIComponent(sfCoId)}'))">&#x260E; Log Activity</button>`;
  if (own?.contact_phone) html += `<a href="tel:${encodeURIComponent(own.contact_phone)}" class="act-btn">&#x1F4DE; Call</a>`;
  if (own?.contact_email) html += `<a href="mailto:${encodeURIComponent(own.contact_email)}" class="act-btn">&#x2709; Quick Email</a>`;
  html += '</div>';
  html += '</div></div>';

  // ── DRAFT EMAIL SECTION (LCC Template Engine) ──────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Draft Email</div>';
  html += '<div class="detail-form">';

  // Template selector + Draft button row
  html += '<div style="display:flex;gap:8px;align-items:flex-end">';
  html += '<div style="flex:1">';
  html += '<label>Template</label>';
  html += '<select id="udDraftTemplate">';
  html += '<option value="auto">Auto-select best template</option>';
  html += '<option value="T-001">First Touch (intro + report + BOV offer)</option>';
  html += '<option value="T-002">Follow-Up (cadence touchpoint)</option>';
  html += '<option value="T-003">Capital Markets Update (quarterly)</option>';
  html += '<option value="T-013">GSA Lease Award Congratulations</option>';
  html += '</select>';
  html += '</div>';
  html += '<button class="act-btn primary" id="udDraftBtn" onclick="_udGenerateDraft()" style="white-space:nowrap;height:36px">Draft Email</button>';
  html += '</div>';

  // Draft preview area (hidden until generated)
  html += '<div id="udDraftPreview" style="display:none;margin-top:16px">';
  html += '<label>Subject</label>';
  html += '<input type="text" id="udDraftSubject" style="font-size:13px;width:100%;margin-bottom:8px">';
  html += '<label>Body <span style="font-size:11px;color:var(--text3)">(editable — your changes will be tracked for template improvement)</span></label>';
  html += '<textarea id="udDraftBody" style="font-size:12px;min-height:240px;line-height:1.6;font-family:inherit;width:100%"></textarea>';
  html += '<div style="font-size:11px;color:var(--text3);margin-top:4px" id="udDraftMeta"></div>';
  html += '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">';
  if (own?.contact_email) {
    html += `<button class="act-btn primary" onclick="_udSendDraft()">Open in Email Client</button>`;
  }
  html += '<button class="act-btn" onclick="_udActionBtnGuard(this, _udCopyDraft)">Copy to Clipboard</button>';
  html += '<button class="act-btn" onclick="_udRecordDraftSend()" id="udRecordSendBtn" style="display:none">Log as Sent</button>';
  html += '</div>';
  html += '</div>';

  // Legacy template fallback (hidden, loads from Dia DB)
  html += '<div id="udLegacyTemplates" style="margin-top:16px;display:none">';
  html += '<div style="font-size:11px;color:var(--text3);margin-bottom:4px">Legacy templates (Dialysis DB)</div>';
  html += '<select id="udTemplateSelect" onchange="_udPreviewTemplate()" style="font-size:12px">';
  html += '<option value="">— Select —</option>';
  html += '</select>';
  html += '<div id="udTemplatePreview" style="display:none;margin-top:8px">';
  html += '<div id="udTemplateSubject" style="font-size:12px;padding:6px 10px;background:var(--s2);border-radius:6px;color:var(--text);margin-bottom:6px"></div>';
  html += '<div id="udTemplateBody" style="font-size:11px;padding:10px;background:var(--s2);border-radius:6px;color:var(--text2);max-height:160px;overflow-y:auto;line-height:1.4"></div>';
  html += '<div style="display:flex;gap:8px;margin-top:8px">';
  html += '<button class="act-btn" style="font-size:11px" onclick="_udSendTemplate()">Open in Client</button>';
  html += '<button class="act-btn" style="font-size:11px" onclick="_udActionBtnGuard(this, _udCopyTemplate)">Copy</button>';
  html += '</div></div></div>';

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
    let resolvedAccountId = own?.sf_account_id || own?.sf_company_id || null;
    let resolvedAccountName = null;

    // Step 1: Resolve to a Salesforce Account ID. Shell LLC owners
    // (e.g. "Mds Dv Victorville") have no direct sf_contact_id, but their
    // parent (Davita Inc.) is reachable via unified_contacts.true_owner_id.
    if (!resolvedAccountId && own) {
      try {
        if (own.true_owner_id) {
          const ucRes = await _entityApiFetch('/api/data-query?_source=gov&table=unified_contacts&select=sf_account_id,company_name&filter=true_owner_id%3Deq.' + encodeURIComponent(own.true_owner_id) + '&limit=5');
          const hit = ((ucRes && ucRes.data) || []).find(function(r) { return r.sf_account_id; });
          if (hit) { resolvedAccountId = hit.sf_account_id; resolvedAccountName = hit.company_name || null; }
        }
        if (!resolvedAccountId && own.recorded_owner_id) {
          const ucRes = await _entityApiFetch('/api/data-query?_source=gov&table=unified_contacts&select=sf_account_id,company_name&filter=recorded_owner_id%3Deq.' + encodeURIComponent(own.recorded_owner_id) + '&limit=5');
          const hit = ((ucRes && ucRes.data) || []).find(function(r) { return r.sf_account_id; });
          if (hit) { resolvedAccountId = hit.sf_account_id; resolvedAccountName = hit.company_name || null; }
        }
        if (!resolvedAccountId) {
          const lookupName = own.true_owner || own.recorded_owner;
          if (lookupName) {
            const like = encodeURIComponent('*' + lookupName + '*');
            const ucRes = await _entityApiFetch('/api/data-query?_source=gov&table=unified_contacts&select=sf_account_id,company_name&filter=company_name%3Dilike.' + like + '&limit=5');
            const hit = ((ucRes && ucRes.data) || []).find(function(r) { return r.sf_account_id; });
            if (hit) { resolvedAccountId = hit.sf_account_id; resolvedAccountName = hit.company_name || null; }
          }
        }
      } catch (e) { console.warn('activity feed: sf_account_id resolution failed', e); }
    }

    // Step 2: Query v_sf_activity_feed by SF Account ID first (covers all
    // contacts on that account, even when the recorded owner is a shell LLC).
    if (resolvedAccountId) {
      try {
        activities = await diaQuery('v_sf_activity_feed', '*', {
          filter: 'sf_account_id=eq.' + encodeURIComponent(resolvedAccountId),
          order: 'activity_date.desc',
          limit: 25
        });
        if (Array.isArray(activities) && activities.length === 0) {
          // Some deployments expose the SF Account FK as sf_company_id
          activities = await diaQuery('v_sf_activity_feed', '*', {
            filter: 'sf_company_id=eq.' + encodeURIComponent(resolvedAccountId),
            order: 'activity_date.desc',
            limit: 25
          });
        }
      } catch (e) { console.warn('activity feed: sf_account_id query failed', e); }
    }

    // Step 3: Legacy fallback paths — sf_contact_id, true_owner_id, contact_id
    if (!activities || activities.length === 0) {
      const sfId = own?.sf_contact_id || own?.salesforce_id;
      const toId = own?.true_owner_id;
      const cId = own?.contact_id;
      if (sfId) {
        activities = await diaQuery('v_sf_activity_feed', '*', { filter: 'sf_contact_id=eq.' + encodeURIComponent(sfId), order: 'activity_date.desc', limit: 25 });
      } else if (toId) {
        activities = await diaQuery('v_sf_activity_feed', '*', { filter: 'true_owner_id=eq.' + encodeURIComponent(toId), order: 'activity_date.desc', limit: 25 });
      } else if (cId && db === 'dia') {
        activities = await diaQuery('v_sf_activity_feed', '*', { filter: 'contact_id=eq.' + encodeURIComponent(cId), order: 'activity_date.desc', limit: 25 });
      }
    }

    if (!activities || activities.length === 0) {
      let emptyHtml = '<div class="detail-section"><div class="detail-section-title">Salesforce Activity Feed</div>';
      emptyHtml += '<div class="detail-empty">No CRM activity found for this owner';
      if (resolvedAccountName) emptyHtml += ' <span style="color:var(--text3)">(searched ' + esc(resolvedAccountName) + ')</span>';
      emptyHtml += '</div>';
      if (!resolvedAccountId) {
        emptyHtml += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">';
        emptyHtml += '<button class="act-btn primary" onclick="_udFeedCreateSfAccount()">+ Create Salesforce Account</button>';
        emptyHtml += '<button class="act-btn" onclick="_udFeedAddContact()">+ Add Contact</button>';
        emptyHtml += '</div>';
      }
      emptyHtml += '</div>';
      feedEl.innerHTML = emptyHtml;
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
    showToast('Failed to load activity feed', 'error');
    feedEl.innerHTML = '<div class="detail-section"><div class="detail-section-title">Salesforce Activity Feed</div><div class="detail-empty">Error loading activity feed</div></div>';
  }
}

/** Empty-state action: open the SF "New Account" form prefilled with the current owner. */
function _udFeedCreateSfAccount() {
  const own = _udCache && _udCache.ownership;
  const name = (own && (own.true_owner || own.recorded_owner)) || '';
  const url = _SF_BASE + '/lightning/o/Account/new?defaultFieldValues=Name=' + encodeURIComponent(name);
  window.open(url, '_blank', 'noopener');
  showToast('Opening Salesforce \u2014 New Account (' + (name || 'Owner') + ')', 'info');
}

/** Empty-state action: open the OwnerDrawer's Add Contact prompt scoped to the current owner. */
function _udFeedAddContact() {
  const own = _udCache && _udCache.ownership;
  const db = _udCache && _udCache.db;
  if (!own) { showToast('No owner record loaded', 'error'); return; }
  const ctx = _ownerCtxFromCurrent(own, db, 'recorded') || _ownerCtxFromCurrent(own, db, 'true');
  if (!ctx) return;
  // Stash a temporary cache so _ownerDrawerAddContact() can reuse its prompts
  _ownerDrawerCache = Object.assign({ contacts: [], open_activities: [], activity_history: [] }, ctx);
  _ownerDrawerAddContact();
}

window._udFeedCreateSfAccount = _udFeedCreateSfAccount;
window._udFeedAddContact = _udFeedAddContact;

// ─── INTEL TAB ────────────────────────────────────────────────────────────────

function _udTabIntel() {
  if (!_udCache) return '<div class="detail-empty">No data loaded</div>';
  const propertyId = _udCache.ids?.property_id;
  if (!propertyId) return '<div class="detail-empty">No property ID</div>';

  let html = '';

  html += _udAssistantSection('intel', 'Research Assistant', 'Turn the current notes and property context into a clean analyst summary and recommended next actions.');
  html += _udResearchIntakeSection();

  // ── PRIOR SALE SECTION ──────────────────────────────────────────────────────
  // Read-only summary. The editable form was removed — property_sale_events
  // is now the single source of truth. To record a new sale, use the Sales
  // tab "+ Add" form, which writes directly to property_sale_events and lets
  // the DB trigger mark concurrent listings Sold.
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title" style="cursor:pointer;user-select:none" onclick="var _el=this.parentElement.querySelector(\'.intel-prior-sale\');if(_el)_el.style.display=_el.style.display===\'none\'?\'block\':\'none\'">Prior Sale</div>';
  html += '<div class="intel-prior-sale" style="display:block">';
  html += '<div id="intelPriorSaleSummary" style="font-size:12px;color:var(--text2)"><span class="spinner"></span> Loading latest sale…</div>';
  html += '<div style="margin-top:10px;font-size:11px;color:var(--text3);font-style:italic">Sale details are managed on the Sales tab. Open Sales → “+ Add” to record a new transaction.</div>';
  html += '</div></div>';

  // ── LOAN / DEBT SECTION ─────────────────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title" style="cursor:pointer;user-select:none" onclick="var _el=this.parentElement.querySelector(\'.intel-loan\');if(_el)_el.style.display=_el.style.display===\'none\'?\'block\':\'none\'">Loan / Debt</div>';
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
  html += '<button onclick="_udBtnGuard(this, _intelSaveLoan)" style="margin-top:10px;width:100%;padding:8px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer">Save Loan Info</button>';
  html += '</div></div>';

  // ── CASH FLOW / VALUATION SECTION ───────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title" style="cursor:pointer;user-select:none" onclick="var _el=this.parentElement.querySelector(\'.intel-cashflow\');if(_el)_el.style.display=_el.style.display===\'none\'?\'block\':\'none\'">Cash Flow / Valuation</div>';
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
  html += '<button onclick="_udBtnGuard(this, _intelSaveCashFlow)" style="margin-top:10px;width:100%;padding:8px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer">Save Cash Flow</button>';
  html += '</div></div>';

  // ── RESEARCH NOTES SECTION ──────────────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title" style="cursor:pointer;user-select:none" onclick="var _el=this.parentElement.querySelector(\'.intel-notes\');if(_el)_el.style.display=_el.style.display===\'none\'?\'block\':\'none\'">Research Notes</div>';
  html += '<div class="intel-notes" style="display:block">';
  html += '<textarea id="intelResearchNotes" rows="4" placeholder="Free-form research notes..." style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);resize:vertical;font-family:inherit;box-sizing:border-box;margin-bottom:8px"></textarea>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Source / Date</label>';
  html += '<input id="intelResearchSource" type="text" placeholder="e.g., Website, Call, Loopnet" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '<div><label style="font-size:11px;font-weight:600;color:var(--text2)">Date Found</label>';
  html += '<input id="intelResearchDate" type="date" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>';
  html += '</div>';
  html += '<button onclick="_udBtnGuard(this, _intelSaveNotes)" style="margin-top:10px;width:100%;padding:8px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer">Save Notes</button>';
  html += '</div></div>';

  return html;
}

// ─── SALES TAB ──────────────────────────────────────────────────────────────
//
// Canonical data source: property_sale_events
//   - Sales tab, Ownership History, and Intel → Prior Sale summary all read
//     from this table. sales_transactions remains as a legacy compat source
//     that the backfill migration has already mirrored into
//     property_sale_events. Going forward new writes land in the canonical
//     table and a DB trigger marks any concurrent active listings Sold.

let _salesCache = null; // { property_id, db, transactions: [], listings: [] }
let _salesFilter = 'all'; // 'all' | 'listings' | 'sales'

async function _udRenderSalesAsync(bodyEl) {
  const propertyId = _udCache.ids?.property_id || _udCache.property?.property_id;
  const db = _udCache.db;

  // If already loaded for this property, just render
  if (_salesCache && _salesCache.property_id === propertyId && _salesCache.db === db) {
    if (bodyEl) bodyEl.innerHTML = _udTabSales();
    return;
  }

  // Show loading spinner
  if (bodyEl) bodyEl.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading sales history...</p></div>';

  const qFn = db === 'gov' ? govQuery : diaQuery;
  let transactions = [];
  let listings = [];

  if (propertyId) {
    try {
      const propId = encodeURIComponent(propertyId);
      // Prefer the canonical property_sale_events table. If it isn't yet
      // reachable (older environments), fall back to sales_transactions so
      // the tab never goes empty during rollout.
      const saleRes = await qFn('property_sale_events', '*', {
        filter: `property_id=eq.${propId}`,
        order: 'sale_date.desc.nullslast',
        limit: 100
      }).catch(() => null);
      const [listRes, txnRes] = await Promise.all([
        qFn('available_listings', '*', {
          filter: `property_id=eq.${propId}`,
          order: 'listing_date.desc.nullslast',
          limit: 50
        }).catch(() => []),
        saleRes != null
          ? Promise.resolve(saleRes)
          : qFn('sales_transactions', '*', {
              filter: `property_id=eq.${propId}`,
              order: 'sale_date.desc',
              limit: 100
            }).catch(() => [])
      ]);
      listings = Array.isArray(listRes) ? listRes : (listRes?.data || []);
      const rawTxns = Array.isArray(txnRes) ? txnRes : (txnRes?.data || []);
      // Normalize both sources to a common shape so renderers don't care
      // which table the row came from.
      transactions = rawTxns.map(_salesNormalizeSaleRow);
    } catch (e) {
      console.warn('Sales history fetch error:', e);
    }
  }

  _salesCache = { property_id: propertyId, db, transactions, listings };
  if (bodyEl) bodyEl.innerHTML = _udTabSales();
}

// Normalize rows from either property_sale_events OR sales_transactions into
// a single shape: { sale_date, price, cap_rate, buyer_name, seller_name,
// broker_name, source, notes, sale_event_id?, sale_id? }. This is what all
// _salesRender* helpers expect.
function _salesNormalizeSaleRow(r) {
  if (!r || typeof r !== 'object') return r;
  const price = r.price != null ? r.price : (r.sold_price != null ? r.sold_price : r.sale_price);
  return Object.assign({}, r, {
    price,
    buyer_name: r.buyer_name || r.buyer || null,
    seller_name: r.seller_name || r.seller || null,
    broker_name: r.broker_name || r.listing_broker || null,
  });
}

function _udTabSales() {
  const txns = _salesCache ? (_salesCache.transactions || []) : [];
  const listings = _salesCache ? (_salesCache.listings || []) : [];
  const propertyId = _udCache.ids?.property_id || _udCache.property?.property_id;

  // Build a unified chronological timeline that pairs listings with their
  // corresponding sale where off_market_date ≈ sale_date (±30 days).
  const allEvents = _salesBuildTimeline(listings, txns);

  let html = '';

  if (allEvents.length === 0) {
    html += '<div class="detail-empty" style="text-align:center;padding:40px 20px">';
    html += '<div style="font-size:18px;margin-bottom:8px;color:var(--text2)">No listing or sales history</div>';
    html += '<div style="font-size:13px;color:var(--text3);margin-bottom:16px">Add a sales comp to start building the transaction history.</div>';
    if (propertyId) {
      html += `<button class="btn-accent" onclick="_salesToggleForm()" style="padding:8px 18px;border-radius:8px;font-size:13px;cursor:pointer;border:none;background:var(--accent);color:#fff">+ Add Transaction</button>`;
    }
    html += '</div>';
    html += `<div id="salesAddForm" style="display:none">${_salesFormHtml()}</div>`;
    return html;
  }

  // Filter chips replace the old "X listings · Y sales" counter.
  const filter = _salesFilter || 'all';
  const events = allEvents.filter((e) => {
    if (filter === 'listings') return !!e.listing;
    if (filter === 'sales') return !!e.sale;
    return true;
  });

  html += '<div class="detail-section">';
  html += `<div class="detail-section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">`;
  html += `<span>Sales &amp; Listing History</span>`;
  if (propertyId) {
    html += `<button class="btn-accent" onclick="_salesToggleForm()" style="padding:5px 14px;border-radius:6px;font-size:12px;cursor:pointer;border:none;background:var(--accent);color:#fff">+ Add</button>`;
  }
  html += '</div>';

  // Filter chips row
  const chips = [
    { key: 'all',      label: 'All' },
    { key: 'listings', label: 'Listings' },
    { key: 'sales',    label: 'Sales' },
  ];
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px 0">';
  chips.forEach((c) => {
    const isActive = filter === c.key;
    const bg = isActive ? 'var(--accent)' : 'var(--s2)';
    const fg = isActive ? '#fff' : 'var(--text2)';
    const border = isActive ? 'var(--accent)' : 'var(--border)';
    html += `<button onclick="_salesSetFilter('${c.key}')" style="padding:4px 12px;border-radius:14px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ${border};background:${bg};color:${fg};text-transform:uppercase;letter-spacing:0.4px">${esc(c.label)}</button>`;
  });
  html += '</div>';

  if (events.length === 0) {
    html += `<div class="detail-empty" style="font-size:13px;padding:16px 8px">No ${filter === 'sales' ? 'sales' : 'listings'} match this filter.</div>`;
    html += '</div>';
    html += `<div id="salesAddForm" style="display:none">${_salesFormHtml()}</div>`;
    return html;
  }

  // Timeline
  html += '<div style="position:relative;padding-left:24px">';
  html += '<div style="position:absolute;left:8px;top:4px;bottom:4px;width:2px;background:var(--border);border-radius:1px"></div>';

  events.forEach((ev, idx) => {
    const isFirst = idx === 0;
    const dotColor = ev.sale ? 'var(--green)' : (ev.listing && _salesListingIsActive(ev.listing) ? 'var(--accent)' : 'var(--text3)');

    html += '<div style="position:relative;margin-bottom:16px">';
    html += `<div style="position:absolute;left:-20px;top:4px;width:10px;height:10px;border-radius:50%;background:${dotColor};border:2px solid var(--bg)${isFirst ? ';box-shadow:0 0 0 3px rgba(46,204,113,0.15)' : ''}"></div>`;
    html += '<div style="background:var(--s2);border-radius:10px;padding:14px;border:1px solid var(--border)">';

    if (ev.listing && ev.sale) {
      html += _salesRenderCombined(ev.listing, ev.sale);
    } else if (ev.sale) {
      html += _salesRenderSale(ev.sale);
    } else if (ev.listing) {
      html += _salesRenderListing(ev.listing);
    }

    html += '</div></div>';
  });

  html += '</div></div>';

  html += `<div id="salesAddForm" style="display:none">${_salesFormHtml()}</div>`;
  return html;
}

function _salesSetFilter(f) {
  _salesFilter = (f === 'listings' || f === 'sales') ? f : 'all';
  const bodyEl = document.getElementById('detailBody');
  if (bodyEl) bodyEl.innerHTML = _udTabSales();
}

// ─── Sales tab helpers ──────────────────────────────────────────────────────

function _salesParseDate(d) {
  if (!d) return null;
  const t = Date.parse(d);
  return isNaN(t) ? null : t;
}

function _salesListingIsActive(l) {
  if (l.is_active === true) return true;
  if (l.is_active === false) return false;
  // Fallback: active if no off_market_date
  return !l.off_market_date;
}

function _salesListingStatus(l, matchedSale) {
  const raw = (l && l.status ? String(l.status) : '').toLowerCase();
  if (matchedSale || raw === 'sold') return { label: 'Sold',      color: 'var(--green)' };
  if (raw === 'withdrawn')           return { label: 'Withdrawn', color: 'var(--yellow)' };
  if (raw === 'expired')             return { label: 'Expired',   color: 'var(--text3)' };
  if (_salesListingIsActive(l))      return { label: 'Active',    color: 'var(--accent)' };
  if (l.off_market_date)             return { label: 'Withdrawn', color: 'var(--yellow)' };
  return { label: 'Inactive', color: 'var(--text3)' };
}

function _salesBuildTimeline(listings, txns) {
  const listingArr = Array.isArray(listings) ? listings.slice() : [];
  const saleArr = Array.isArray(txns) ? txns.slice() : [];
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const usedSaleIdx = new Set();
  const events = [];

  listingArr.forEach(listing => {
    const offMs = _salesParseDate(listing.off_market_date);
    let matchIdx = -1;
    let matchDiff = Infinity;

    if (offMs != null) {
      saleArr.forEach((sale, i) => {
        if (usedSaleIdx.has(i)) return;
        const saleMs = _salesParseDate(sale.sale_date);
        if (saleMs == null) return;
        const diff = Math.abs(saleMs - offMs);
        if (diff <= THIRTY_DAYS && diff < matchDiff) {
          matchIdx = i;
          matchDiff = diff;
        }
      });
    }

    if (matchIdx >= 0) {
      usedSaleIdx.add(matchIdx);
      const sale = saleArr[matchIdx];
      events.push({
        listing,
        sale,
        sortKey: _salesParseDate(sale.sale_date) || offMs || _salesParseDate(listing.listing_date) || 0
      });
    } else {
      events.push({
        listing,
        sale: null,
        sortKey: offMs || _salesParseDate(listing.listing_date) || 0
      });
    }
  });

  saleArr.forEach((sale, i) => {
    if (usedSaleIdx.has(i)) return;
    events.push({
      listing: null,
      sale,
      sortKey: _salesParseDate(sale.sale_date) || 0
    });
  });

  events.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
  return events;
}

function _salesRenderListing(l) {
  const status = _salesListingStatus(l, null);
  let html = '';

  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
  html += `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${status.color};padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid ${status.color}">${esc(status.label)}</span>`;
  html += `<span style="font-size:11px;color:var(--text3)">Listing</span>`;
  html += '</div>';

  // Dates row
  const dateBits = [];
  if (l.listing_date) dateBits.push(`<span style="color:var(--text3)">On Market:</span> <span style="color:var(--text)">${esc(_fmtDate(l.listing_date))}</span>`);
  if (l.off_market_date) dateBits.push(`<span style="color:var(--text3)">Off Market:</span> <span style="color:var(--text)">${esc(_fmtDate(l.off_market_date))}</span>`);
  if (dateBits.length) {
    html += `<div style="font-size:12px;margin-bottom:8px;display:flex;gap:14px;flex-wrap:wrap">${dateBits.join('')}</div>`;
  }

  // Asking prices
  const initial = l.initial_price != null ? l.initial_price : l.asking_price;
  const last = l.last_price != null ? l.last_price : null;
  if (initial != null || last != null) {
    html += '<div style="display:flex;gap:16px;margin-bottom:8px;flex-wrap:wrap">';
    if (initial != null) {
      html += `<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Original Ask</div><div style="font-size:16px;font-weight:700;color:var(--accent)">${fmt(initial)}</div></div>`;
    }
    if (last != null && Number(last) !== Number(initial)) {
      html += `<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Final Ask</div><div style="font-size:16px;font-weight:700;color:var(--accent)">${fmt(last)}</div></div>`;
    }
    html += '</div>';
  }

  if (l.listing_broker) {
    html += `<div style="font-size:12px;margin-bottom:2px"><span style="color:var(--text3)">Broker:</span> <span style="color:var(--text)">${esc(l.listing_broker)}</span></div>`;
  }

  return html;
}

function _salesRenderSale(s) {
  let html = '';

  const txnType = s.transaction_type ? String(s.transaction_type) : 'Sale';
  const isLand = s.exclude_from_market_metrics === true;
  const price = s.price != null ? s.price : (s.sold_price != null ? s.sold_price : s.sale_price);

  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;flex-wrap:wrap">';
  html += `<div style="display:flex;gap:6px;flex-wrap:wrap">`;
  html += `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--green);padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--green)">${esc(txnType)}</span>`;
  if (isLand) {
    html += `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--yellow);padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--yellow)">Land Sale</span>`;
  }
  html += `</div>`;
  if (s.sale_date) {
    html += `<span style="font-size:11px;color:var(--text3)">${esc(_fmtDate(s.sale_date))}</span>`;
  }
  html += '</div>';

  if (price != null) {
    html += `<div style="font-size:18px;font-weight:700;color:var(--green);margin-bottom:6px">${fmt(price)}</div>`;
  }

  const metrics = [];
  if (s.cap_rate != null) metrics.push(`${Number(s.cap_rate).toFixed(2)}% Cap`);
  if (s.price_psf != null) metrics.push(`$${Number(s.price_psf).toFixed(0)}/SF`);
  if (metrics.length) {
    html += `<div style="font-size:13px;color:var(--text2);margin-bottom:8px">${esc(metrics.join(' · '))}</div>`;
  }

  const buyer = s.buyer_name || s.buyer;
  const seller = s.seller_name || s.seller;
  const broker = s.broker_name || s.listing_broker;
  if (buyer)  html += `<div style="font-size:12px;margin-bottom:2px"><span style="color:var(--text3)">Buyer:</span> <span style="color:var(--text)">${esc(buyer)}</span></div>`;
  if (seller) html += `<div style="font-size:12px;margin-bottom:2px"><span style="color:var(--text3)">Seller:</span> <span style="color:var(--text)">${esc(seller)}</span></div>`;
  if (broker) html += `<div style="font-size:12px;margin-bottom:2px"><span style="color:var(--text3)">Listing Broker:</span> <span style="color:var(--text)">${esc(broker)}</span></div>`;
  if (s.source) {
    html += `<div style="font-size:11px;color:var(--text3);margin-top:6px;font-style:italic">${esc(s.source)}</div>`;
  }
  if (s.notes) {
    html += `<div style="font-size:12px;color:var(--text2);margin-top:4px;border-top:1px solid var(--border);padding-top:6px">${esc(s.notes)}</div>`;
  }

  return html;
}

function _salesRenderCombined(l, s) {
  const initial = l.initial_price != null ? l.initial_price : l.asking_price;
  const last = l.last_price != null ? l.last_price : null;
  const soldPrice = s.price != null ? s.price : (s.sold_price != null ? s.sold_price : s.sale_price);
  const txnType = s.transaction_type ? String(s.transaction_type) : 'Sale';
  const isLand = s.exclude_from_market_metrics === true;

  let html = '';

  // Header: Sold badge + transaction type + land tag + sale date
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;flex-wrap:wrap">';
  html += `<div style="display:flex;gap:6px;flex-wrap:wrap">`;
  html += `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--green);padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--green)">Sold</span>`;
  if (txnType && txnType.toLowerCase() !== 'sale') {
    html += `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text2);padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)">${esc(txnType)}</span>`;
  }
  if (isLand) {
    html += `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--yellow);padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--yellow)">Land Sale</span>`;
  }
  html += '</div>';
  if (s.sale_date) {
    html += `<span style="font-size:11px;color:var(--text3)">${esc(_fmtDate(s.sale_date))}</span>`;
  }
  html += '</div>';

  // Narrative line: "Listed → [price] → Sold [date] at [price]/[cap rate]"
  const parts = [];
  if (l.listing_date) {
    parts.push(`<span style="color:var(--text2)">Listed ${esc(_fmtDate(l.listing_date))}</span>`);
  } else {
    parts.push(`<span style="color:var(--text2)">Listed</span>`);
  }
  if (initial != null) {
    parts.push(`<span style="color:var(--accent);font-weight:600">${fmt(initial)}</span>`);
  }
  if (last != null && Number(last) !== Number(initial)) {
    parts.push(`<span style="color:var(--accent);font-weight:600">${fmt(last)}</span>`);
  }
  const soldBits = ['Sold'];
  if (s.sale_date) soldBits.push(esc(_fmtDate(s.sale_date)));
  let soldTail = soldBits.join(' ');
  if (soldPrice != null) soldTail += ` at ${fmt(soldPrice)}`;
  if (s.cap_rate != null) soldTail += ` / ${Number(s.cap_rate).toFixed(2)}% Cap`;
  parts.push(`<span style="color:var(--green);font-weight:600">${soldTail}</span>`);

  html += `<div style="font-size:13px;margin-bottom:10px;line-height:1.7">${parts.join(' <span style="color:var(--text3)">→</span> ')}</div>`;

  // Price grid
  html += '<div style="display:flex;gap:16px;margin-bottom:8px;flex-wrap:wrap">';
  if (initial != null) {
    html += `<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Original Ask</div><div style="font-size:14px;font-weight:600;color:var(--text)">${fmt(initial)}</div></div>`;
  }
  if (last != null && Number(last) !== Number(initial)) {
    html += `<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Final Ask</div><div style="font-size:14px;font-weight:600;color:var(--text)">${fmt(last)}</div></div>`;
  }
  if (soldPrice != null) {
    html += `<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Sold Price</div><div style="font-size:16px;font-weight:700;color:var(--green)">${fmt(soldPrice)}</div></div>`;
  }
  if (s.cap_rate != null) {
    html += `<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Cap Rate</div><div style="font-size:14px;font-weight:600;color:var(--text)">${Number(s.cap_rate).toFixed(2)}%</div></div>`;
  }
  html += '</div>';

  // Dates row (on/off market)
  const dateBits = [];
  if (l.listing_date) dateBits.push(`<span style="color:var(--text3)">On Market:</span> <span style="color:var(--text)">${esc(_fmtDate(l.listing_date))}</span>`);
  if (l.off_market_date) dateBits.push(`<span style="color:var(--text3)">Off Market:</span> <span style="color:var(--text)">${esc(_fmtDate(l.off_market_date))}</span>`);
  if (dateBits.length) {
    html += `<div style="font-size:12px;margin-bottom:6px;display:flex;gap:14px;flex-wrap:wrap">${dateBits.join('')}</div>`;
  }

  // Parties
  const buyer = s.buyer_name || s.buyer;
  const seller = s.seller_name || s.seller;
  if (buyer) {
    html += `<div style="font-size:12px;margin-bottom:2px"><span style="color:var(--text3)">Buyer:</span> <span style="color:var(--text)">${esc(buyer)}</span></div>`;
  }
  if (seller) {
    html += `<div style="font-size:12px;margin-bottom:2px"><span style="color:var(--text3)">Seller:</span> <span style="color:var(--text)">${esc(seller)}</span></div>`;
  }

  // Broker: prefer sale record, fall back to listing
  const broker = s.broker_name || s.listing_broker || l.listing_broker;
  if (broker) {
    html += `<div style="font-size:12px;margin-bottom:2px"><span style="color:var(--text3)">Listing Broker:</span> <span style="color:var(--text)">${esc(broker)}</span></div>`;
  }

  if (s.source) {
    html += `<div style="font-size:11px;color:var(--text3);margin-top:6px;font-style:italic">${esc(s.source)}</div>`;
  }
  if (s.notes) {
    html += `<div style="font-size:12px;color:var(--text2);margin-top:4px;border-top:1px solid var(--border);padding-top:6px">${esc(s.notes)}</div>`;
  }

  return html;
}

function _salesFormHtml() {
  return `
  <div class="detail-section" style="margin-top:12px">
    <div class="detail-section-title">Add Transaction</div>
    <div class="detail-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div><label style="font-size:11px;color:var(--text3)">Sale Date</label><input id="salesFDate" type="date" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:13px"></div>
      <div><label style="font-size:11px;color:var(--text3)">Sale Price ($)</label><input id="salesFPrice" type="number" placeholder="0" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:13px"></div>
      <div><label style="font-size:11px;color:var(--text3)">Buyer</label><input id="salesFBuyer" type="text" placeholder="Buyer name" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:13px"></div>
      <div><label style="font-size:11px;color:var(--text3)">Seller</label><input id="salesFSeller" type="text" placeholder="Seller name" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:13px"></div>
      <div><label style="font-size:11px;color:var(--text3)">Price/SF</label><input id="salesFPsf" type="number" step="0.01" placeholder="0.00" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:13px"></div>
      <div><label style="font-size:11px;color:var(--text3)">Cap Rate (%)</label><input id="salesFCap" type="number" step="0.01" placeholder="0.00" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:13px"></div>
      <div><label style="font-size:11px;color:var(--text3)">Source</label><input id="salesFSource" type="text" placeholder="CoStar, County Records, etc." style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:13px"></div>
      <div style="grid-column:1/-1"><label style="font-size:11px;color:var(--text3)">Notes</label><textarea id="salesFNotes" rows="2" placeholder="Optional notes" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:13px;resize:vertical"></textarea></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
      <button onclick="_salesToggleForm()" style="padding:7px 16px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid var(--border);background:var(--s2);color:var(--text)">Cancel</button>
      <button onclick="_udBtnGuard(this, _salesSaveTransaction)" style="padding:7px 16px;border-radius:6px;font-size:12px;cursor:pointer;border:none;background:var(--accent);color:#fff">Save Transaction</button>
    </div>
  </div>`;
}

function _salesToggleForm() {
  const el = document.getElementById('salesAddForm');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function _salesSaveTransaction() {
  const propertyId = _udCache.ids?.property_id || _udCache.property?.property_id;
  if (!propertyId) { alert('No property ID — cannot save transaction.'); return; }

  const db = _udCache.db;

  // Writes land in the canonical property_sale_events table. The DB trigger
  // then flips any concurrent active listings to status='Sold' automatically,
  // so the Sales tab filter chips and Ownership History stay in sync.
  const payload = {
    property_id: String(propertyId),
    sale_date:  document.getElementById('salesFDate')?.value || null,
    price:      _dpf(document.getElementById('salesFPrice')?.value),
    cap_rate:   _dpf(document.getElementById('salesFCap')?.value),
    buyer_name: document.getElementById('salesFBuyer')?.value?.trim() || null,
    seller_name:document.getElementById('salesFSeller')?.value?.trim() || null,
    source:     document.getElementById('salesFSource')?.value?.trim() || null,
    notes:      document.getElementById('salesFNotes')?.value?.trim() || null,
  };

  const proxyBase = db === 'gov' ? '/api/gov-query' : '/api/dia-query';
  const url = `${proxyBase}?table=property_sale_events&method=POST`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('Save transaction failed:', errText);
    alert('Failed to save transaction. Check console for details.');
    return;
  }

  // Invalidate cache and reload
  _salesCache = null;
  const bodyEl = document.getElementById('detailBody');
  _udRenderSalesAsync(bodyEl);
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
  return `<a href="${esc(url).replace(/"/g, '&quot;')}" target="_blank" rel="noopener" class="ql-btn" style="--ql-color:${color}" title="${esc(label)}">
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
        <button class="q-action" onclick="_udActionBtnGuard(this, _udCopyAssistantReply, '${mode}')">Copy</button>
        ${mode === 'ownership' ? `<button class="q-action" onclick="_udActionBtnGuard(this, _udApplyAssistantFields, '${mode}')">Apply Extracted Facts to Fields</button>` : ''}
        ${mode === 'ownership' ? `<button class="q-action primary" onclick="_udBtnGuard(this, _udSaveReviewedOwnership)">Save Reviewed Ownership</button>` : ''}
        <button class="q-action primary" onclick="_udActionBtnGuard(this, _udApplyAssistantReply, '${mode}')">${mode === 'ownership' ? 'Apply to Ownership Notes' : 'Apply to Research Notes'}</button>
      </div>`;
  }

  return `<div class="detail-section">
    <div class="detail-section-title">${esc(title)}</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px">${esc(subtitle)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="q-action primary" onclick="_udActionBtnGuard(this, _udAskAssistant, '${mode}')">Assist</button>
      <button class="q-action" onclick="_udActionBtnGuard(this, ${mode === 'ownership' ? 'openResearchInChatGPT' : 'openResearchInClaude'})">${mode === 'ownership' ? 'Export to ChatGPT' : 'Export to Claude'}</button>
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
        <button class="q-action primary" onclick="_intelAnalyzeIntake()"${intake.loading ? ' disabled style="opacity:0.6"' : ''}>
          ${intake.loading ? '<span class="spinner" style="width:12px;height:12px;margin-right:4px"></span>Analyzing\u2026' : 'Analyze Intake'}
        </button>
        <button class="q-action" onclick="_intelClearIntake()"${intake.loading ? ' disabled' : ''}>Clear</button>
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
        <button class="q-action" onclick="_udActionBtnGuard(this, _intelCopyIntakeAnalysis)">Copy</button>
        <button class="q-action" onclick="_udActionBtnGuard(this, _intelApplyIntakeFields)">Apply Extracted Facts</button>
        <button class="q-action primary" onclick="_udBtnGuard(this, _intelSaveReviewed)">Save Reviewed Intel</button>
        <button class="q-action primary" onclick="_udActionBtnGuard(this, _intelApplyIntakeAnalysis)">Apply to Notes</button>
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
  _udFormDirty = true;
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

  _udFormDirty = true;
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
    html += `<button class="q-action primary" onclick="_udActionBtnGuard(this, _udAction, 'add_to_pipeline')" style="padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Add to Pipeline</button>`;
    html += `<button class="q-action" onclick="_udActionBtnGuard(this, _udAction, 'log_touchpoint')" style="padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">Log Touchpoint</button>`;
    html += `<button class="q-action" onclick="_udActionBtnGuard(this, _udAction, 'create_task')" style="padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">Create Task</button>`;
  } else if (db === 'dia') {
    html += `<button class="q-action primary" onclick="_udActionBtnGuard(this, _udAction, 'mark_lead')" style="padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Mark as Lead</button>`;
    html += `<button class="q-action" onclick="_udActionBtnGuard(this, _udAction, 'add_to_pipeline')" style="padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">Add to Pipeline</button>`;
    html += `<button class="q-action" onclick="_udActionBtnGuard(this, _udAction, 'log_touchpoint')" style="padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">Log Touchpoint</button>`;
    html += `<button class="q-action" onclick="_udActionBtnGuard(this, _udAction, 'create_task')" style="padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">Create Task</button>`;
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
      if (res.ok) { showToast('Added to pipeline!', 'success'); return; }
      const err = await res.json().catch(() => ({}));
      showToast('Could not add: ' + (err.error || res.status), 'error');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    return;
  }

  if (action === 'mark_lead' && db === 'dia') {
    try {
      const qFn = typeof diaQuery === 'function' ? diaQuery : null;
      if (!qFn) { showToast('Dialysis query not available', 'error'); return; }
      await qFn('research_queue_outcomes', null, {
        method: 'POST',
        body: { clinic_id: fb.clinic_id || fb.medicare_id, queue_type: 'lead', status: 'prospect', source_bucket: 'manual', notes: 'Marked as lead from detail panel' }
      });
      showToast('Marked as lead!', 'success');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    return;
  }

  if (action === 'log_touchpoint') {
    const notes = await lccPrompt('Touchpoint notes:');
    if (!notes) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (typeof LCC_USER !== 'undefined' && LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
      const res = await fetch('/api/actions', {
        method: 'POST', headers,
        body: JSON.stringify({ action_type: 'log_activity', title: 'Touchpoint: ' + title, domain: db === 'gov' ? 'government' : 'dialysis', notes, entity_id: id })
      });
      if (!res.ok) throw new Error('Server returned ' + res.status);
      showToast('Touchpoint logged!', 'success');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    return;
  }

  if (action === 'create_task') {
    const taskTitle = await lccPrompt('Task description:', 'Follow up on ' + title);
    if (!taskTitle) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (typeof LCC_USER !== 'undefined' && LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
      const res = await fetch('/api/actions', {
        method: 'POST', headers,
        body: JSON.stringify({ action_type: 'create_task', title: taskTitle, domain: db === 'gov' ? 'government' : 'dialysis', entity_id: id, status: 'open' })
      });
      if (!res.ok) throw new Error('Server returned ' + res.status);
      showToast('Task created!', 'success');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
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

async function openResearchInChatGPT() {
  await exportResearchToAssistant('chatgpt');
}

async function openResearchInClaude() {
  await exportResearchToAssistant('claude');
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

/**
 * Row that renders an em-dash placeholder with an inline "Resolve via
 * ChromeConnector" link. Used for fields like year_built that CoStar
 * sometimes omits — lets the user jump back to the source page so the
 * extension can repopulate the missing field.
 */
function _rowResolve(label, field) {
  const handler = `_udResolveViaConnector('${esc(field)}')`;
  return `<div class="detail-row">
    <div class="detail-lbl">${esc(label)}</div>
    <div class="detail-val" style="color:var(--text3)">—
      <a href="#" onclick="event.preventDefault();${handler}" style="margin-left:8px;font-size:11px;color:var(--accent);text-decoration:none;border-bottom:1px dashed var(--accent)">Resolve via ChromeConnector</a>
    </div>
  </div>`;
}

/**
 * Deep-link to CoStar (or the last-known source URL) for the current
 * property so the ChromeConnector extension's content script can re-extract
 * a missing field. Extension auto-POSTs back into the sidebar pipeline.
 */
function _udResolveViaConnector(field) {
  const p = _udCache && _udCache.property || {};
  const fb = _udCache && _udCache.fallback || {};
  const sourceUrl = p.costar_url || p.source_url || p.page_url || fb.costar_url || fb.source_url || null;
  const addr = p.address || fb.address || '';
  const target = sourceUrl
    || (addr ? 'https://product.costar.com/home/search?q=' + encodeURIComponent(addr) : null);

  if (!target) {
    if (typeof showToast === 'function') showToast('No source URL on file — open CoStar/LoopNet manually to resolve ' + field, 'warn');
    return;
  }
  if (typeof showToast === 'function') showToast('Opening source — ChromeConnector will re-extract ' + field, 'info');
  window.open(target, '_blank', 'noopener');
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
  const link = href ? `<a href="${esc(href).replace(/"/g, '&quot;')}">${display}</a>` : display;
  return `<div class="detail-row">
    <div class="detail-lbl">${esc(label)}</div>
    <div class="detail-val">${link}</div>
  </div>`;
}

// ============================================================================
// CROSS-ENTITY NAVIGATION HELPERS
// Turn entity references into clickable links that open detail views
// ============================================================================

/**
 * Navigate to a property detail view
 * @param {number} propertyId - Property ID to navigate to
 * @param {string} db - Database: 'dialysis' or 'gov' (default: 'dialysis')
 */
window.navToProperty = function(propertyId, db) {
  db = db || 'dialysis';
  openUnifiedDetail(db, { property_id: propertyId });
};

/**
 * Navigate to a contact/owner detail view
 * @param {number} contactId - Contact ID to navigate to
 * @param {string} db - Database: 'dialysis' or 'gov' (default: 'dialysis')
 */
window.navToContact = function(contactId, db) {
  openContactDetail(String(contactId));
};

/**
 * Navigate to a transaction/sale detail view
 * @param {number} saleId - Sale ID to navigate to
 */
window.navToTransaction = function(saleId) {
  // Find sale record and open sale detail
  if (typeof renderSaleDetailBody === 'function' && window.diaSalesComps) {
    const rec = window.diaSalesComps.find(r => r.sale_id === saleId);
    if (rec) {
      window._saleRecord = rec;
      renderSaleDetailBody(rec);
      return;
    }
  }
  showToast('Transaction not found in current data', 'info');
};

/**
 * Navigate to operator view
 * @param {string} operatorName - Operator name to filter by
 */
window.navToOperator = function(operatorName) {
  openEntityDetailByName(operatorName);
};

/**
 * Navigate to state view
 * @param {string} stateName - State name to filter by
 */
window.navToState = function(stateName) {
  window._pendingOpFilter = { type: 'state', value: stateName };
  if (typeof goToDiaTab === 'function') {
    window.diaPlayersView = 'operators';
    goToDiaTab('players');
  } else {
    showToast('Navigate to Dialysis → Players tab to view state: ' + stateName, 'info');
  }
};

/**
 * Generate a clickable entity link
 * Renders as styled span with onclick handler to navigate to entity detail view
 * @param {string} text - Display text (will be escaped)
 * @param {string} type - Entity type: 'property', 'contact', 'transaction', 'operator', 'state'
 * @param {number|string} id - Entity ID (for property/contact/transaction)
 * @param {string} db - Database context: 'dialysis' or 'gov'
 * @returns {string} HTML span element with onclick handler
 */
window.entityLink = function(text, type, id, db) {
  if (!text) return '—';
  var style = 'color:var(--accent);cursor:pointer;text-decoration:underline;text-decoration-style:dotted;';
  switch (type) {
    case 'property':
      if (!id) return esc(text);
      return '<span style="' + style + '" onclick="navToProperty(' + id + ',\'' + (db || 'dialysis') + '\')" title="View property details">' + esc(text) + '</span>';
    case 'contact':
      if (!id) return '<span style="' + style + '" onclick="openContactDetailByName(\'' + esc(text).replace(/'/g, "\\'") + '\')" title="View contact">' + esc(text) + '</span>';
      return '<span style="' + style + '" onclick="openContactDetail(' + JSON.stringify(String(id)) + ')" title="View contact details">' + esc(text) + '</span>';
    case 'entity':
      if (!id) return '<span style="' + style + '" onclick="openEntityDetailByName(\'' + esc(text).replace(/'/g, "\\'") + '\')" title="View entity">' + esc(text) + '</span>';
      return '<span style="' + style + '" onclick="openEntityDetail(' + JSON.stringify(String(id)) + ')" title="View entity details">' + esc(text) + '</span>';
    case 'transaction':
      if (!id) return esc(text);
      return '<span style="' + style + '" onclick="navToTransaction(' + id + ')" title="View transaction details">' + esc(text) + '</span>';
    case 'operator':
    case 'owner':
    case 'buyer':
    case 'seller':
    case 'broker':
    case 'investor':
      return '<span style="' + style + '" onclick="openEntityDetailByName(\'' + esc(text).replace(/'/g, "\\'") + '\')" title="View entity">' + esc(text) + '</span>';
    case 'state':
      return '<span style="' + style + '" onclick="navToState(\'' + esc(text).replace(/'/g, "\\'") + '\')" title="View state properties">' + esc(text) + '</span>';
    default:
      return esc(text);
  }
};



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
function showUnifiedDetail(record, source, initialTab) {
  const db = source.startsWith('gov') ? 'gov' : 'dia';

  const ids = {
    property_id: record.property_id || null,
    lease_number: record.lease_number || null
  };

  openUnifiedDetail(db, ids, record, initialTab);
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
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();

    if (data.status === 'completed' || data.success) {
      showToast('Activity logged (SF generic + private notes saved)', 'success');
      const udNotesEl = document.getElementById('udLogNotes');
      if (udNotesEl) udNotesEl.value = '';
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
  try {
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
  } catch (e) {
    console.warn('_udLogOutbound error:', e);
  }
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
    showToast('Failed to load email templates', 'error');
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

  // Escape field values before merging into HTML templates to prevent XSS
  const contactName = esc(own.contact_1_name || own.contact_name || own.true_owner || own.recorded_owner || 'there');
  const propertyName = esc(prop.page_title || prop.address || 'the property');
  const cityState = esc((prop.city || '') + (prop.state ? ', ' + prop.state : ''));
  const annualRent = prop.annual_rent ? esc(fmt(prop.annual_rent)) : '';
  const askingPrice = prop.asking_price ? esc(fmt(prop.asking_price)) : '';
  const capRate = prop.cap_rate ? esc(Number(prop.cap_rate).toFixed(2) + '%') : '';
  const agency = esc(prop.agency_full || prop.agency_short || '');
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
  window.open(mailto, '_blank', 'noopener');
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
// DRAFT EMAIL ENGINE — LCC Template System (v3)
// ============================================================================

/** Current draft state — holds the API response for record_send tracking */
let _udCurrentDraft = null;

/** Cached cadence state for current property — avoids re-fetching on each draft */
let _udCadenceCache = null;

/**
 * Generate a draft email using the LCC template engine.
 * Reads property/ownership from _udCache, fetches cadence state from the server,
 * uses the cadence recommendation for auto-select, builds context, calls the API,
 * and populates the editable preview area.
 */
async function _udGenerateDraft() {
  const btn = document.getElementById('udDraftBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Drafting…'; btn.style.opacity = '0.6'; }

  try {
    const prop = _udCache?.property || {};
    const own = _udCache?.ownership || {};
    const chain = _udCache?.chain || [];
    const db = _udCache?.db || '';

    // Determine domain from DB source
    const domain = db === 'gov' ? 'government' : db === 'dia' ? 'dialysis' : '';

    // Resolve contact name — owner, not tenant
    const contactName = own.contact_1_name || own.contact_name || own.true_owner
      || own.recorded_owner || chain[0]?.contact_name || '';

    // Resolve tenant (the government agency or dialysis operator)
    const tenant = prop.agency_full || prop.agency_short || prop.tenant
      || prop.facility_name || prop.operator || '';

    // City, State
    const city = prop.city || '';
    const state = prop.state || '';
    const cityState = city + (state ? ', ' + state : '');

    // Contact identifiers for cadence lookup
    const cadenceIds = {
      entity_id: own.entity_id || null,
      sf_contact_id: own.salesforce_id || own.sf_contact_id || null,
      contact_id: own.contact_id || null
    };

    const propertyId = _udCache?.ids?.property_id || prop.property_id || null;

    // ── Fetch cadence state (server-side) ────────────────────────────────
    let cadenceInfo = null;
    if (cadenceIds.entity_id || cadenceIds.sf_contact_id || cadenceIds.contact_id) {
      try {
        const fetchFn = (typeof LCC_AUTH !== 'undefined' && LCC_AUTH.isAuthenticated) ? LCC_AUTH.apiFetch : fetch;
        const cadResp = await fetchFn('/api/operations?_route=draft&action=cadence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...cadenceIds,
            property_id: propertyId,
            property_address: prop.address || '',
            domain
          })
        });
        cadenceInfo = await cadResp.json();
        if (cadenceInfo.ok) {
          _udCadenceCache = cadenceInfo;
          _udRenderCadenceStatus(cadenceInfo);
        }
      } catch (err) {
        console.warn('[DraftEmail] Cadence lookup failed (non-blocking):', err.message);
      }
    }

    // Build context payload matching server-side enrichDraftContext expectations
    const context = {
      contact: {
        full_name: contactName,
        first_name: (contactName || '').split(' ')[0] || '',
        company: own.company_name || own.owner_entity || chain[0]?.company_name || '',
        email: own.contact_email || ''
      },
      property: {
        tenant,
        address: prop.address || '',
        city,
        state,
        city_state: cityState,
        domain,
        property_id: propertyId,
        sf_leased: prop.sf_leased || prop.rba || prop.building_size || '',
        annual_rent: prop.annual_rent || prop.noi || '',
        asking_price: prop.asking_price || '',
        cap_rate: prop.cap_rate || '',
        lease_expiration: prop.lease_expiration || prop.firm_term_expiry || '',
        page_title: prop.page_title || '',
        agency_short: prop.agency_short || '',
        agency_full: prop.agency_full || '',
        facility_name: prop.facility_name || '',
        government_type: prop.government_type || ''
      },
      domain
    };

    // Template selection — use cadence recommendation if auto
    let templateId = document.getElementById('udDraftTemplate')?.value || 'auto';

    if (templateId === 'auto') {
      if (cadenceInfo?.ok && cadenceInfo.recommendation?.template) {
        // Server-side cadence engine recommends the template
        templateId = cadenceInfo.recommendation.template;
        // If recommended type is 'phone', show guidance instead of generating email
        if (cadenceInfo.recommendation.type === 'phone') {
          _udShowPhoneGuidance(cadenceInfo.recommendation, contactName, tenant, cityState, domain);
          return;
        }
      } else {
        // Fallback to local heuristic if cadence unavailable
        templateId = _udAutoSelectTemplate(prop, own, domain);
      }
    }

    // Call the LCC draft API with cadence IDs for context flag injection
    const fetchFn = (typeof LCC_AUTH !== 'undefined' && LCC_AUTH.isAuthenticated) ? LCC_AUTH.apiFetch : fetch;
    const resp = await fetchFn('/api/operations?_route=draft&action=generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        context,
        cadence_ids: cadenceIds
      })
    });

    const result = await resp.json();

    if (!result.ok) {
      showToast(result.error || 'Failed to generate draft', 'error');
      console.error('[DraftEmail] API error:', result);
      return;
    }

    // Store draft state for record_send (includes cadence info + report attachment)
    _udCurrentDraft = {
      template_id: result.draft.template_id,
      template_version: result.draft.template_version,
      template_name: result.draft.template_name,
      rendered_subject: result.draft.subject,
      rendered_body: result.draft.body,
      entity_id: own.salesforce_id || own.sf_contact_id || own.contact_id || null,
      domain,
      unresolved: result.draft.unresolved_variables || [],
      cadence_id: result.cadence?.id || _udCadenceCache?.cadence?.id || null,
      report_attachment: result.report_attachment || null,
      context: context  // Stored so _udSendDraft can re-render via Graph with attachment
    };

    // Populate the preview
    const previewEl = document.getElementById('udDraftPreview');
    const subjectEl = document.getElementById('udDraftSubject');
    const bodyEl = document.getElementById('udDraftBody');
    const metaEl = document.getElementById('udDraftMeta');
    const recordBtn = document.getElementById('udRecordSendBtn');

    if (subjectEl) subjectEl.value = result.draft.subject || '';
    if (bodyEl) bodyEl.value = result.draft.body || '';
    if (previewEl) previewEl.style.display = 'block';
    if (recordBtn) recordBtn.style.display = 'inline-flex';

    // Show metadata with cadence context
    if (metaEl) {
      const unresolvedCount = _udCurrentDraft.unresolved.length;
      let meta = `Template: ${esc(result.draft.template_name)} (${result.draft.template_id} v${result.draft.template_version})`;
      if (result.cadence) {
        const c = result.cadence;
        meta += ` · Touch ${c.current_touch + 1}/7 · Tier ${esc(c.priority_tier)}`;
        if (c.phase === 'maintenance') meta += ' · Quarterly';
      }
      if (unresolvedCount > 0) {
        meta += ` · <span style="color:var(--yellow,#f59e0b)">${unresolvedCount} unresolved var${unresolvedCount > 1 ? 's' : ''}</span>`;
      }
      if (result.report_attachment?.filename) {
        meta += ` · <span style="color:var(--accent,#2563eb)">📎 Attach: ${esc(result.report_attachment.filename)}</span>`;
      }
      metaEl.innerHTML = meta;
    }

    showToast('Draft generated — review and edit before sending', 'success');

  } catch (err) {
    console.error('[DraftEmail] Error:', err);
    showToast('Error generating draft: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Draft Email'; btn.style.opacity = ''; }
  }
}

/**
 * Render cadence status bar above the draft preview.
 * Shows current phase, touch position, tier, and next recommendation.
 */
function _udRenderCadenceStatus(cadenceInfo) {
  let statusEl = document.getElementById('udCadenceStatus');
  if (!statusEl) {
    // Create it above the draft preview
    const previewEl = document.getElementById('udDraftPreview');
    if (!previewEl) return;
    statusEl = document.createElement('div');
    statusEl.id = 'udCadenceStatus';
    statusEl.style.cssText = 'margin-top:12px;padding:10px 12px;background:var(--s2);border-radius:8px;font-size:11px;line-height:1.6;color:var(--text2)';
    previewEl.parentNode.insertBefore(statusEl, previewEl);
  }

  const c = cadenceInfo.cadence;
  const rec = cadenceInfo.recommendation;
  if (!c) { statusEl.style.display = 'none'; return; }

  // Build progress bar for prospecting phase
  let progressHtml = '';
  if (c.phase === 'prospecting') {
    const pct = Math.round((c.current_touch / 7) * 100);
    progressHtml = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">` +
      `<div style="flex:1;height:4px;background:var(--s3);border-radius:2px;overflow:hidden">` +
      `<div style="width:${pct}%;height:100%;background:var(--accent);border-radius:2px"></div></div>` +
      `<span style="font-size:10px;font-weight:600;white-space:nowrap">${c.current_touch}/7 touches</span></div>`;
  }

  // Tier badge colors
  const tierColors = { A: 'var(--red,#ef4444)', B: 'var(--accent,#3b82f6)', C: 'var(--text3)' };
  const tierColor = tierColors[c.priority_tier] || 'var(--text3)';

  // Next action
  let nextHtml = '';
  if (rec && !rec.blocked) {
    const typeIcon = rec.type === 'phone' ? '&#x1F4DE;' : '&#x2709;';
    const overdue = rec.is_overdue ? ` <span style="color:var(--red,#ef4444);font-weight:600">(${rec.overdue_days}d overdue)</span>` : '';
    nextHtml = `<div style="margin-top:4px">${typeIcon} Next: <strong>${esc(rec.label)}</strong>${overdue}</div>`;
    if (rec.is_escalation) {
      nextHtml = `<div style="margin-top:4px;color:var(--yellow,#f59e0b)">&#x26A0; Escalation: <strong>${esc(rec.label)}</strong></div>`;
    }
  } else if (rec?.blocked) {
    nextHtml = `<div style="margin-top:4px;color:var(--text3)">&#x23F8; ${esc(rec.reason || rec.label)}</div>`;
  }

  // Engagement stats
  let statsHtml = '';
  const stats = [];
  if (c.emails_sent > 0) stats.push(`${c.emails_sent} sent`);
  if (c.emails_opened > 0) stats.push(`${c.emails_opened} opened`);
  if (c.emails_replied > 0) stats.push(`${c.emails_replied} replied`);
  if (c.calls_made > 0) stats.push(`${c.calls_made} calls`);
  if (stats.length > 0) statsHtml = `<div style="margin-top:4px;color:var(--text3)">${stats.join(' · ')}</div>`;

  statusEl.innerHTML =
    progressHtml +
    `<div><span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;color:white;background:${tierColor}">Tier ${esc(c.priority_tier)}</span> ` +
    `<span style="margin-left:6px">${esc(c.phase === 'prospecting' ? 'Prospecting' : c.phase === 'maintenance' ? 'Quarterly Maintenance' : c.phase)}</span></div>` +
    nextHtml + statsHtml;

  statusEl.style.display = 'block';
}

/**
 * Show phone call guidance when cadence recommends a phone touch instead of email.
 */
function _udShowPhoneGuidance(recommendation, contactName, tenant, cityState, domain) {
  const previewEl = document.getElementById('udDraftPreview');
  const subjectEl = document.getElementById('udDraftSubject');
  const bodyEl = document.getElementById('udDraftBody');
  const metaEl = document.getElementById('udDraftMeta');

  const firstName = (contactName || '').split(' ')[0] || 'there';
  const domainLabel = domain === 'government' ? 'government-leased' : 'dialysis/medical';

  // Generate voicemail script based on touch number
  let script = '';
  if (recommendation.touch_number === 2) {
    script = `Hi ${firstName}, this is Scott Briggs from Northmarq. I sent you an email last week with our latest capital markets update for ${domainLabel} properties — wanted to make sure you received it. I'm specifically interested in your ${tenant}-leased asset in ${cityState} and would love to share some recent comps and market insights. Could we grab 15 minutes on the phone this week? Let me know what works best — I'm flexible.`;
  } else if (recommendation.touch_number === 4) {
    script = `Hi ${firstName}, Scott Briggs again from Northmarq. Following up on that quarterly report I sent about a week and a half ago — it includes some really relevant comp data for ${domainLabel} properties like yours. If you've had a chance to look at it, I'd love to walk through a few of the highlights. Do you have 20 minutes on your calendar this month?`;
  } else if (recommendation.touch_number === 6) {
    script = `Hi ${firstName}, Scott from Northmarq. Just wanted to follow up on that recent close I sent you last week — it's a solid comp for your portfolio in ${cityState}. Cap rates have shifted in that market, and I think a conversation about your positioning might be timely. Can we grab 20 minutes? I'm flexible with scheduling.`;
  } else {
    script = `Hi ${firstName}, this is Scott Briggs from Northmarq. I wanted to follow up regarding your ${tenant}-leased property in ${cityState}. Would you have 15–20 minutes for a quick call this week?`;
  }

  if (subjectEl) subjectEl.value = `Phone Touch ${recommendation.touch_number}: ${contactName}`;
  if (bodyEl) bodyEl.value = `VOICEMAIL SCRIPT\n${'─'.repeat(40)}\n\n${script}\n\n${'─'.repeat(40)}\nCALL TIPS\n• Call between 9am–11am or 2pm–4pm local time\n• Keep under 30 seconds\n• Leave your direct number\n• Log the outcome after the call`;
  if (previewEl) previewEl.style.display = 'block';
  if (metaEl) metaEl.innerHTML = `<span style="color:var(--yellow,#f59e0b)">&#x1F4DE; Cadence recommends a phone touch</span> · ${esc(recommendation.label)}`;

  showToast('Cadence recommends a phone call — voicemail script ready', 'info');
}

/**
 * Fallback auto-select when cadence API is unavailable.
 * Uses local DOM heuristics (prior touchpoint rows) + property signals.
 */
function _udAutoSelectTemplate(prop, own, domain) {
  // T-013: GSA Lease Award congratulations
  if (domain === 'government' && prop.government_type === 'Federal') {
    const leaseStart = prop.lease_commencement || prop.lease_start;
    if (leaseStart) {
      const startDate = new Date(leaseStart);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      if (startDate >= sixMonthsAgo) return 'T-013';
    }
  }

  // Check DOM for prior touchpoints
  const touchpointEl = document.getElementById('udTouchpoints');
  const hasPriorTouches = touchpointEl && touchpointEl.querySelector('.detail-card');

  if (hasPriorTouches) {
    const touchCards = touchpointEl.querySelectorAll('.detail-card');
    if (touchCards.length >= 6) return 'T-003';
    return 'T-002';
  }

  return 'T-001';
}

/**
 * Open the draft in the user's email client via mailto: link.
 * Uses the (potentially edited) subject and body from the preview fields.
 */
async function _udSendDraft() {
  const subject = document.getElementById('udDraftSubject')?.value || '';
  const body = document.getElementById('udDraftBody')?.value || '';
  const own = _udCache?.ownership || {};
  const toEmail = own.contact_email || '';

  if (!body.trim()) {
    showToast('Generate a draft first', 'error');
    return;
  }

  const recordBtn = document.getElementById('udRecordSendBtn');

  // Try Graph-based Outlook draft first — real attachment + signature
  if (toEmail && _udCurrentDraft?.template_id) {
    try {
      const fetchFn = (typeof LCC_AUTH !== 'undefined' && LCC_AUTH.isAuthenticated) ? LCC_AUTH.apiFetch : fetch;
      // Re-use the already-rendered (and possibly user-edited) subject/body by
      // sending them as the context's pre_rendered override. For now we just
      // kick off create_outlook_draft which re-renders from the template —
      // the attachment path is the main win.
      const graphResp = await fetchFn('/api/operations?_route=draft&action=create_outlook_draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: _udCurrentDraft.template_id,
          context: _udCurrentDraft.context || {},
          to: toEmail
        })
      });
      const gj = await graphResp.json();
      if (gj.ok && gj.web_link) {
        window.open(gj.web_link, '_blank');
        const attachNote = gj.has_attachment
          ? ' with ' + (gj.report_attachment?.filename || 'attachment')
          : (gj.attachment_error ? ' (no attachment: ' + gj.attachment_error + ')' : '');
        showToast('✅ Draft created in Outlook' + attachNote, 'success', 10000);
        if (recordBtn) recordBtn.style.display = 'inline-flex';
        return;
      }
      console.warn('[detail._udSendDraft] Graph unavailable, falling back to mailto:', gj.error);
    } catch (e) {
      console.warn('[detail._udSendDraft] Graph attempt failed, falling back:', e.message);
    }
  }

  // Fallback: mailto with attachment reminder
  const mailto = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(mailto, '_blank', 'noopener');

  if (_udCurrentDraft?.report_attachment?.filename) {
    const rpt = _udCurrentDraft.report_attachment;
    if (typeof _showAttachmentReminder === 'function') {
      _showAttachmentReminder(rpt);
    } else {
      showToast('Attach: ' + rpt.filename + ' (' + (rpt.quarter || '') + ')', 'info', 15000);
    }
  }

  if (recordBtn) recordBtn.style.display = 'inline-flex';
}

/**
 * Copy the draft body to clipboard.
 */
async function _udCopyDraft() {
  const body = document.getElementById('udDraftBody')?.value || '';
  if (!body.trim()) {
    showToast('Generate a draft first', 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(body);
    showToast('Draft copied to clipboard!', 'success');
  } catch (e) {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = body;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Draft copied!', 'success');
  }
}

/**
 * Record that the draft was sent — tracks template performance.
 * Captures the final (edited) version so we can measure edit distance
 * and improve templates over time.
 */
async function _udRecordDraftSend() {
  if (!_udCurrentDraft) {
    showToast('No draft to record — generate one first', 'error');
    return;
  }

  const btn = document.getElementById('udRecordSendBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Logging…'; btn.style.opacity = '0.6'; }

  try {
    const finalSubject = document.getElementById('udDraftSubject')?.value || '';
    const finalBody = document.getElementById('udDraftBody')?.value || '';

    const payload = {
      template_id: _udCurrentDraft.template_id,
      template_version: _udCurrentDraft.template_version,
      entity_id: _udCurrentDraft.entity_id,
      domain: _udCurrentDraft.domain,
      rendered_subject: _udCurrentDraft.rendered_subject,
      rendered_body: _udCurrentDraft.rendered_body,
      final_subject: finalSubject,
      final_body: finalBody,
      original_draft: _udCurrentDraft.rendered_body,
      sent_text: finalBody,
      cadence_id: _udCurrentDraft.cadence_id || null
    };

    const fetchFn = (typeof LCC_AUTH !== 'undefined' && LCC_AUTH.isAuthenticated) ? LCC_AUTH.apiFetch : fetch;
    const resp = await fetchFn('/api/operations?_route=draft&action=record_send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await resp.json();

    if (result.ok) {
      // Show next recommendation if cadence advanced
      let toastMsg = 'Send recorded — template performance tracked';
      if (result.cadence_advanced && result.next_recommendation) {
        const next = result.next_recommendation;
        const typeIcon = next.type === 'phone' ? '📞' : '✉️';
        toastMsg += `. Next: ${typeIcon} ${next.label}`;
      }
      showToast(toastMsg, 'success');
      // Reset draft state
      _udCurrentDraft = null;
      _udCadenceCache = null;
      if (btn) btn.style.display = 'none';
      // Hide cadence status
      const statusEl = document.getElementById('udCadenceStatus');
      if (statusEl) statusEl.style.display = 'none';
      // Refresh touchpoints to show the new activity
      const own = _udCache?.ownership || {};
      _loadTouchpoints(own);
    } else {
      showToast(result.error || 'Failed to record send', 'error');
    }
  } catch (err) {
    console.error('[DraftEmail] Record send error:', err);
    showToast('Error recording send: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Log as Sent'; btn.style.opacity = ''; }
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
    showToast('Failed to load touchpoints', 'error');
    el.innerHTML = '';
  }
}

/**
 * Refresh the current detail panel without re-opening.
 * Re-fetches data and re-renders the active tab.
 */
function refreshDetailPanel() {
  if (!_udCache) return;
  // Clear dirty flag on refresh (data is being reloaded — edits are either saved or intentionally discarded)
  _udFormDirty = false;
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

  const _anyOwnField = [recordedOwner, trueOwner, ownerType, contactName, contactPhone, contactEmail, incState, notes].some(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (!_anyOwnField) { showToast('Please fill in at least one ownership field', 'info'); return; }

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
      _udFormDirty = false;

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
    let _ownPartialWarns = [];
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
        if (!patchResult.ok) { console.error('Error patching recorded_owner:', (patchResult.errors || []).join(', ')); _ownPartialWarns.push('recorded owner'); }
      } else {
        const res = await applyInsertWithFallback({
          proxyBase,
          table: 'recorded_owners',
          data: recordedOwnerPayload,
          source_surface: 'ownership_detail',
          propagation_scope: 'ownership_helper_record'
        });
        if (res.ok) {
          const created = Array.isArray(res.rows) && res.rows.length > 0 ? res.rows[0] : null;
          if (created) recordedOwnerId = created.recorded_owner_id;
        } else {
          console.error('Error creating recorded_owner:', res.errors || []); _ownPartialWarns.push('recorded owner');
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
        if (!patchResult.ok) { console.error('Error patching true_owner:', (patchResult.errors || []).join(', ')); _ownPartialWarns.push('true owner'); }
      } else {
        const res = await applyInsertWithFallback({
          proxyBase,
          table: 'true_owners',
          data: trueOwnerPayload,
          source_surface: 'ownership_detail',
          propagation_scope: 'ownership_helper_record'
        });
        if (res.ok) {
          const created = Array.isArray(res.rows) && res.rows.length > 0 ? res.rows[0] : null;
          if (created) trueOwnerId = created.true_owner_id;
        } else {
          console.error('Error creating true_owner:', res.errors || []); _ownPartialWarns.push('true owner');
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
        if (!patchResult.ok) { console.error('Error patching contact:', (patchResult.errors || []).join(', ')); _ownPartialWarns.push('contact'); }
      } else {
        const res = await applyInsertWithFallback({
          proxyBase,
          table: 'contacts',
          data: contactPayload,
          source_surface: 'ownership_detail',
          propagation_scope: 'ownership_contact_record'
        });
        if (res.ok) {
          const created = Array.isArray(res.rows) && res.rows.length > 0 ? res.rows[0] : null;
          if (created) contactId = created.contact_id;
        } else {
          console.error('Error creating contact:', res.errors || []); _ownPartialWarns.push('contact');
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
      if (!propResult.ok) { console.error('Error patching property owner links:', (propResult.errors || []).join(', ')); _ownPartialWarns.push('property links'); }
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
      if (!res.ok) { console.error('Error creating research_queue_outcome:', res.errors || []); _ownPartialWarns.push('outcome log'); }
    }

    if (_ownPartialWarns.length) {
      if (!silent) showToast('Saved with warnings — failed: ' + _ownPartialWarns.join(', '), 'error');
    } else {
      if (!silent) showToast('Ownership resolution saved!', 'success');
    }
    _udFormDirty = false;
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

// Read-only summary of the most recent sale for this property. Renders into
// the #intelPriorSaleSummary slot on the Intel tab. Data source is the
// canonical property_sale_events table (falls back to v_property_latest_sale
// if the row already got there via a view).
async function _intelRenderPriorSaleSummaryAsync() {
  const slot = document.getElementById('intelPriorSaleSummary');
  if (!slot) return;
  const propertyId = _udCache?.ids?.property_id || _udCache?.property?.property_id;
  if (!propertyId) {
    slot.innerHTML = '<span style="color:var(--text3)">No property ID — cannot load sale history.</span>';
    return;
  }
  const db = _udCache.db;
  const qFn = db === 'gov' ? govQuery : diaQuery;
  const propId = encodeURIComponent(propertyId);

  let latest = null;
  try {
    const res = await qFn('property_sale_events', '*', {
      filter: `property_id=eq.${propId}`,
      order: 'sale_date.desc.nullslast',
      limit: 1,
    }).catch(() => null);
    const rows = Array.isArray(res) ? res : (res?.data || []);
    latest = rows[0] || null;
  } catch (e) {
    console.warn('Prior sale summary fetch error:', e);
  }

  if (!latest) {
    slot.innerHTML = '<span style="color:var(--text3)">No sale recorded for this property yet.</span>';
    return;
  }

  const price = latest.price != null ? latest.price : latest.sold_price;
  const bits = [];
  if (latest.sale_date) bits.push(`<span style="color:var(--text3)">Date:</span> <span style="color:var(--text)">${esc(_fmtDate(latest.sale_date))}</span>`);
  if (price != null)    bits.push(`<span style="color:var(--text3)">Price:</span> <span class="mono" style="color:var(--green);font-weight:600">${fmt(price)}</span>`);
  if (latest.cap_rate != null) bits.push(`<span style="color:var(--text3)">Cap:</span> <span style="color:var(--text);font-weight:600">${Number(latest.cap_rate).toFixed(2)}%</span>`);
  if (latest.buyer_name)  bits.push(`<span style="color:var(--text3)">Buyer:</span> <span style="color:var(--text)">${esc(latest.buyer_name)}</span>`);
  if (latest.seller_name) bits.push(`<span style="color:var(--text3)">Seller:</span> <span style="color:var(--text)">${esc(latest.seller_name)}</span>`);
  if (latest.broker_name) bits.push(`<span style="color:var(--text3)">Broker:</span> <span style="color:var(--text)">${esc(latest.broker_name)}</span>`);

  let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;font-size:12px">';
  html += bits.map(b => `<div>${b}</div>`).join('');
  html += '</div>';
  if (latest.source) {
    html += `<div style="font-size:11px;color:var(--text3);margin-top:6px;font-style:italic">Source: ${esc(latest.source)}</div>`;
  }
  if (latest.notes) {
    html += `<div style="font-size:12px;color:var(--text2);margin-top:4px;border-top:1px solid var(--border);padding-top:6px">${esc(latest.notes)}</div>`;
  }
  slot.innerHTML = html;
}

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

  const _anySaleField = [saleDate, salePrice, capRate, buyer, seller].some(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (!_anySaleField) { showToast('Please fill in at least one sale field', 'info'); return; }

  try {
    // Canonical target: property_sale_events. The legacy sales_transactions
    // sink has been retired for write paths — the backfill migration mirrors
    // old rows forward and new rows always land in property_sale_events so
    // the DB trigger can mark concurrent listings Sold.
    const payload = {
      property_id: String(propertyId),
      sale_date: saleDate || null,
      price: _dpf(salePrice),
      cap_rate: _dpf(capRate),
      buyer_name: buyer,
      seller_name: seller
    };
    const res = await applyInsertWithFallback({
      proxyBase,
      table: 'property_sale_events',
      idColumn: 'property_id',
      recordIdentifier: propertyId,
      data: payload,
      source_surface: db === 'gov' ? 'gov_intel_detail' : 'dialysis_intel_detail',
      propagation_scope: 'prior_sale_record'
    });
    if (!res.ok) { console.error('Sale save error:', res.errors || []); showToast('Error saving sale', 'error'); return; }
    _udFormDirty = false;
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

  const _anyLoanField = [lender, loanAmount, interestRate, loanType, origDate, matDate, amortization, recourse, ltv].some(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (!_anyLoanField) { showToast('Please fill in at least one loan field', 'info'); return; }

  try {
    const payload = {
      property_id: propertyId,
      lender_name: lender,
      loan_amount: _dpf(loanAmount),
      interest_rate_percent: _dpf(interestRate),
      loan_type: loanType || null,
      origination_date: origDate || null,
      maturity_date: matDate || null,
      loan_term: amortization ? parseInt(amortization, 10) : null,
      recourse: recourse || null,
      loan_to_value: _dpf(ltv)
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
    _udFormDirty = false;
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

  const _anyCfField = [annualRent, rentPerSF, expenseType, estValue, currentCapRate].some(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (!_anyCfField) { showToast('Please fill in at least one cash flow field', 'info'); return; }

  try {
    const payload = {
      last_known_rent: _dpf(annualRent),
      current_value_estimate: _dpf(estValue)
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
    _udFormDirty = false;
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
    _udFormDirty = false;
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
window._udBtnGuard = _udBtnGuard;
window._udActionBtnGuard = _udActionBtnGuard;
window.openUnifiedDetail = openUnifiedDetail;
window.switchUnifiedTab = switchUnifiedTab;
window.showUnifiedDetail = showUnifiedDetail;
window.refreshDetailPanel = refreshDetailPanel;
window._udSubmitLogCall = _udSubmitLogCall;
window._udPreviewTemplate = _udPreviewTemplate;
window._udSendTemplate = _udSendTemplate;
window._udCopyTemplate = _udCopyTemplate;
window._udGenerateDraft = _udGenerateDraft;
window._udSendDraft = _udSendDraft;
window._udCopyDraft = _udCopyDraft;
window._udRecordDraftSend = _udRecordDraftSend;
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

// ============================================================================
// ENTITY & CONTACT DETAIL VIEWS
// ============================================================================

let _entityDetailCache = null;

/** Helper: build headers for ops API calls */
function _entityApiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (typeof LCC_USER !== 'undefined' && LCC_USER.workspace_id) h['x-lcc-workspace'] = LCC_USER.workspace_id;
  return h;
}

/** Helper: fetch JSON from ops API with error handling */
async function _entityApiFetch(url) {
  const fetchFn = (typeof LCC_AUTH !== 'undefined' && LCC_AUTH.isAuthenticated) ? LCC_AUTH.apiFetch : fetch;
  const res = await fetchFn(url, { headers: _entityApiHeaders() });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Open entity detail panel by entity ID (from ops DB).
 */
async function openEntityDetail(entityId) {
  _entityDetailCache = null;
  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');
  if (!panel || !overlay) return;

  panel.style.display = 'block';
  overlay.classList.add('open');

  const headerEl = document.getElementById('detailHeader');
  const tabsEl = document.getElementById('detailTabs');
  const bodyEl = document.getElementById('detailBody');

  // Loading state
  if (headerEl) headerEl.innerHTML = `
    <button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>
    <div class="detail-header-info">
      <div style="flex:1;min-width:0">
        <div class="detail-title">Loading entity...</div>
        <div class="detail-subtitle"></div>
      </div>
      <span class="detail-badge" style="background:var(--accent);color:#fff">ENTITY</span>
    </div>
    <button class="detail-close" onclick="closeDetail()">&times;</button>`;
  if (bodyEl) bodyEl.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading entity details...</p></div>';

  try {
    // Fetch entity + contacts in parallel
    const [entityData, contactsData] = await Promise.all([
      _entityApiFetch('/api/entities?id=' + encodeURIComponent(entityId)),
      _entityApiFetch('/api/contacts?action=list&entity_id=' + encodeURIComponent(entityId) + '&limit=50')
    ]);

    const entity = entityData?.entity || null;
    if (!entity) {
      if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">Entity not found</div>';
      return;
    }

    const contacts = contactsData?.contacts || [];

    // Fetch activities for this entity
    const activitiesPromise = _entityApiFetch('/api/activities?entity_id=' + encodeURIComponent(entityId) + '&order=occurred_at.desc&limit=20')
      .then(d => d?.activities || []).catch(() => []);

    // Fetch portfolio and transactions in parallel (from Gov and Dia DBs)
    const portfolioPromises = [];
    const transactionPromises = [];
    const entityName = entity.name || '';

    // Search both DBs for properties owned by this entity
    if (typeof govQuery === 'function') {
      portfolioPromises.push(
        govQuery('v_ownership_current', '*', { filter: 'true_owner=ilike.*' + encodeURIComponent(entityName) + '*', limit: 50 }).catch(() => ({ data: [] }))
      );
      transactionPromises.push(
        govQuery('v_sales_comps', '*', { filter: 'or=(buyer_name.ilike.*' + encodeURIComponent(entityName) + '*,seller_name.ilike.*' + encodeURIComponent(entityName) + '*)', order: 'sale_date.desc', limit: 30 }).catch(() => ({ data: [] }))
      );
    }
    if (typeof diaQuery === 'function') {
      portfolioPromises.push(
        diaQuery('v_ownership_current', '*', { filter: 'true_owner=ilike.*' + encodeURIComponent(entityName) + '*', limit: 50 }).catch(() => [])
      );
      transactionPromises.push(
        diaQuery('v_sales_comps', '*', { filter: 'or=(buyer_name.ilike.*' + encodeURIComponent(entityName) + '*,seller_name.ilike.*' + encodeURIComponent(entityName) + '*)', order: 'sale_date.desc', limit: 30 }).catch(() => [])
      );
    }

    const [portfolioResults, transactionResults, activities] = await Promise.all([
      Promise.allSettled(portfolioPromises),
      Promise.allSettled(transactionPromises),
      activitiesPromise
    ]);

    // Normalize results
    const extractArr = (r) => {
      if (!r || r.status !== 'fulfilled') return [];
      const v = r.value;
      return Array.isArray(v) ? v : (v?.data || []);
    };

    let portfolio = [];
    for (const r of portfolioResults) portfolio = portfolio.concat(extractArr(r));
    let transactions = [];
    for (const r of transactionResults) transactions = transactions.concat(extractArr(r));

    _entityDetailCache = { entity, contacts, portfolio, transactions, activities, type: 'entity' };

    // Render header
    const typeBadge = (entity.entity_type || 'org').toUpperCase();
    const statusColor = entity.status === 'active' ? 'var(--green)' : 'var(--text3)';
    if (headerEl) headerEl.innerHTML = `
      <div class="detail-header-info">
        <div style="flex:1;min-width:0">
          <div class="detail-title">${esc(entity.name)}</div>
          <div class="detail-subtitle">${esc((entity.city || '') + (entity.city && entity.state ? ', ' : '') + (entity.state || ''))}</div>
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
            <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--accent);color:#fff;font-weight:600">${esc(typeBadge)}</span>
            ${entity.domain ? '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s3);color:var(--text2)">' + esc(entity.domain) + '</span>' : ''}
            <span style="font-size:10px;padding:2px 8px;border-radius:10px;color:${statusColor};border:1px solid ${statusColor}">${esc(entity.status || 'active')}</span>
          </div>
        </div>
        <span class="detail-badge" style="background:var(--accent);color:#fff">ENTITY</span>
        <button class="detail-close" onclick="closeDetail()">&times;</button>
      </div>`;

    // Render tabs
    const tabs = ['Overview', 'Activity', 'Portfolio', 'Transactions'];
    if (tabsEl) tabsEl.innerHTML = tabs.map(t =>
      '<button class="detail-tab ' + (t === 'Overview' ? 'active' : '') + '" onclick="_switchEntityTab(\'' + t + '\')">' + t + '</button>'
    ).join('');

    if (bodyEl) bodyEl.innerHTML = _renderEntityTab('Overview');
  } catch (err) {
    console.error('Entity detail error:', err);
    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">Error loading entity: ' + esc(err.message) + '</div>';
  }
}

/** Open entity detail by name search (when only name is available) */
async function openEntityDetailByName(name) {
  if (!name) return;
  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');
  if (!panel || !overlay) return;

  panel.style.display = 'block';
  overlay.classList.add('open');

  const headerEl = document.getElementById('detailHeader');
  const bodyEl = document.getElementById('detailBody');
  const tabsEl = document.getElementById('detailTabs');

  if (headerEl) headerEl.innerHTML = `
    <button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>
    <div class="detail-header-info">
      <div style="flex:1;min-width:0">
        <div class="detail-title">${esc(name)}</div>
        <div class="detail-subtitle">Searching...</div>
      </div>
      <span class="detail-badge" style="background:var(--accent);color:#fff">ENTITY</span>
    </div>
    <button class="detail-close" onclick="closeDetail()">&times;</button>`;
  if (bodyEl) bodyEl.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Looking up entity...</p></div>';
  if (tabsEl) tabsEl.innerHTML = '';

  try {
    const data = await _entityApiFetch('/api/entities?action=search&q=' + encodeURIComponent(name));
    const entities = data?.entities || [];

    if (entities.length === 1) {
      // Exact single match — open it
      openEntityDetail(entities[0].id);
      return;
    }

    if (entities.length > 1) {
      // Multiple matches — show list to pick from
      let html = '<div class="detail-section"><div class="detail-section-title">Multiple entities found for "' + esc(name) + '"</div>';
      html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">';
      for (const e of entities) {
        const loc = (e.city || '') + (e.city && e.state ? ', ' : '') + (e.state || '');
        html += '<div onclick="openEntityDetail(\'' + esc(e.id) + '\')" style="padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px;cursor:pointer;display:flex;gap:12px;align-items:center">';
        html += '<div style="flex:1;min-width:0"><div style="font-weight:600;color:var(--text)">' + esc(e.name) + '</div>';
        html += '<div style="font-size:11px;color:var(--text2)">' + esc(e.entity_type || '') + (loc ? ' · ' + esc(loc) : '') + '</div></div>';
        html += '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s3);color:var(--text2)">' + esc(e.entity_type || 'org') + '</span>';
        html += '</div>';
      }
      html += '</div></div>';
      if (bodyEl) bodyEl.innerHTML = html;
      return;
    }

    // No matches — show not found with helpful message
    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">No entity found matching "' + esc(name) + '".<br><span style="font-size:12px;color:var(--text3)">Try the Entities page to search or create one.</span></div>';
  } catch (err) {
    console.error('Entity lookup error:', err);
    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">Error searching entities: ' + esc(err.message) + '</div>';
  }
}

/** Open contact detail panel by contact ID */
async function openContactDetail(contactId) {
  _entityDetailCache = null;
  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');
  if (!panel || !overlay) return;

  panel.style.display = 'block';
  overlay.classList.add('open');

  const headerEl = document.getElementById('detailHeader');
  const tabsEl = document.getElementById('detailTabs');
  const bodyEl = document.getElementById('detailBody');

  if (headerEl) headerEl.innerHTML = `
    <button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>
    <div class="detail-header-info">
      <div style="flex:1;min-width:0">
        <div class="detail-title">Loading contact...</div>
      </div>
      <span class="detail-badge" style="background:var(--purple);color:#fff">CONTACT</span>
    </div>
    <button class="detail-close" onclick="closeDetail()">&times;</button>`;
  if (bodyEl) bodyEl.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading contact details...</p></div>';

  try {
    const data = await _entityApiFetch('/api/contacts?action=get&id=' + encodeURIComponent(contactId));
    const contact = data?.contact || null;
    if (!contact) {
      if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">Contact not found</div>';
      return;
    }

    // Fetch activities if contact has a linked entity
    let activities = [];
    if (contact.entity_id) {
      try {
        const actData = await _entityApiFetch('/api/activities?entity_id=' + encodeURIComponent(contact.entity_id) + '&order=occurred_at.desc&limit=20');
        activities = actData?.activities || [];
      } catch (_) { /* ignore */ }
    }

    _entityDetailCache = { contact, activities, type: 'contact' };

    // Render header
    if (headerEl) headerEl.innerHTML = `
      <div class="detail-header-info">
        <div style="flex:1;min-width:0">
          <div class="detail-title">${esc(contact.full_name || contact.display_name || 'Unknown')}</div>
          <div class="detail-subtitle">${esc(contact.title || '')}${contact.title && contact.company_name ? ' at ' : ''}${esc(contact.company_name || '')}</div>
        </div>
        <span class="detail-badge" style="background:var(--purple);color:#fff">CONTACT</span>
        <button class="detail-close" onclick="closeDetail()">&times;</button>
      </div>`;

    // Tabs for contacts
    if (tabsEl) tabsEl.innerHTML = '<button class="detail-tab active" onclick="_switchContactTab(\'Details\')">Details</button><button class="detail-tab" onclick="_switchContactTab(\'Activity\')">Activity</button>';

    if (bodyEl) bodyEl.innerHTML = _renderContactTab(contact);
  } catch (err) {
    console.error('Contact detail error:', err);
    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">Error loading contact: ' + esc(err.message) + '</div>';
  }
}

/** Open contact detail by name search */
async function openContactDetailByName(name) {
  if (!name) return;
  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');
  if (!panel || !overlay) return;

  panel.style.display = 'block';
  overlay.classList.add('open');

  const headerEl = document.getElementById('detailHeader');
  const bodyEl = document.getElementById('detailBody');
  const tabsEl = document.getElementById('detailTabs');

  if (headerEl) headerEl.innerHTML = `
    <button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>
    <div class="detail-header-info">
      <div style="flex:1;min-width:0">
        <div class="detail-title">${esc(name)}</div>
        <div class="detail-subtitle">Searching...</div>
      </div>
      <span class="detail-badge" style="background:var(--purple);color:#fff">CONTACT</span>
    </div>
    <button class="detail-close" onclick="closeDetail()">&times;</button>`;
  if (bodyEl) bodyEl.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Looking up contact...</p></div>';
  if (tabsEl) tabsEl.innerHTML = '';

  try {
    const data = await _entityApiFetch('/api/contacts?action=list&q=' + encodeURIComponent(name) + '&limit=10');
    const contacts = data?.contacts || [];

    if (contacts.length === 1) {
      openContactDetail(contacts[0].id);
      return;
    }

    if (contacts.length > 1) {
      let html = '<div class="detail-section"><div class="detail-section-title">Multiple contacts found for "' + esc(name) + '"</div>';
      html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">';
      for (const c of contacts) {
        html += '<div onclick="openContactDetail(\'' + esc(c.id) + '\')" style="padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px;cursor:pointer">';
        html += '<div style="font-weight:600;color:var(--text)">' + esc(c.full_name || c.display_name || 'Unknown') + '</div>';
        html += '<div style="font-size:11px;color:var(--text2)">' + esc(c.title || '') + (c.company_name ? ' · ' + esc(c.company_name) : '') + '</div>';
        html += '</div>';
      }
      html += '</div></div>';
      if (bodyEl) bodyEl.innerHTML = html;
      return;
    }

    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">No contact found matching "' + esc(name) + '"</div>';
  } catch (err) {
    console.error('Contact lookup error:', err);
    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">Error searching contacts: ' + esc(err.message) + '</div>';
  }
}

// ── Entity Tab Switching ──
function _switchEntityTab(tabName) {
  if (!_entityDetailCache || _entityDetailCache.type !== 'entity') return;
  document.querySelectorAll('#detailTabs .detail-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.trim() === tabName);
  });
  const bodyEl = document.getElementById('detailBody');
  if (bodyEl) bodyEl.innerHTML = _renderEntityTab(tabName);
}

function _renderEntityTab(tab) {
  if (!_entityDetailCache) return '<div class="detail-empty">No data loaded</div>';
  switch (tab) {
    case 'Overview': return _entityTabOverview();
    case 'Activity': return _entityTabActivity();
    case 'Portfolio': return _entityTabPortfolio();
    case 'Transactions': return _entityTabTransactions();
    default: return '<div class="detail-empty">Unknown tab</div>';
  }
}

// ── Entity Overview Tab ──
function _entityTabOverview() {
  const c = _entityDetailCache;
  const e = c.entity;
  const contacts = c.contacts || [];

  let html = '';

  // Entity info section
  html += '<div class="detail-section"><div class="detail-section-title">Entity Information</div><div class="detail-grid">';
  html += _row('Name', e.name);
  html += _row('Type', e.entity_type);
  html += _row('Domain', e.domain);
  html += _row('Org Type', e.org_type);
  if (e.email) html += _rowLink('Email', e.email, 'mailto:' + e.email);
  if (e.phone) html += _rowLink('Phone', e.phone, 'tel:' + e.phone);
  if (e.address) html += _row('Address', e.address);
  html += _row('City / State', (e.city || '') + (e.city && e.state ? ', ' : '') + (e.state || ''));
  html += '</div></div>';

  // External identities
  const extIds = e.external_identities || [];
  if (extIds.length) {
    html += '<div class="detail-section"><div class="detail-section-title">Linked Systems</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
    for (const ext of extIds) {
      html += '<span style="font-size:10px;padding:3px 8px;border-radius:6px;background:var(--s3);color:var(--text2);border:1px solid var(--border)">';
      html += esc(ext.source_system || '') + (ext.source_type ? ' · ' + esc(ext.source_type) : '');
      html += '</span>';
    }
    html += '</div></div>';
  }

  // Contacts section
  if (contacts.length) {
    html += '<div class="detail-section"><div class="detail-section-title">Contacts (' + contacts.length + ')</div>';
    html += '<div style="display:flex;flex-direction:column;gap:8px">';
    for (const ct of contacts) {
      html += '<div style="padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px;cursor:pointer" onclick="openContactDetail(\'' + esc(ct.id) + '\')">';
      html += '<div style="display:flex;align-items:center;gap:8px">';
      html += '<div style="width:32px;height:32px;border-radius:50%;background:var(--purple);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600">';
      html += esc((ct.full_name || ct.display_name || '?')[0].toUpperCase());
      html += '</div>';
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-weight:600;color:var(--text)">' + esc(ct.full_name || ct.display_name || 'Unknown') + '</div>';
      html += '<div style="font-size:11px;color:var(--text2)">' + esc(ct.title || '') + '</div>';
      html += '</div>';
      html += '<div style="text-align:right;font-size:11px;color:var(--text3)">';
      if (ct.email) html += '<div>' + esc(ct.email) + '</div>';
      if (ct.phone) html += '<div>' + esc(ct.phone) + '</div>';
      html += '</div></div></div>';
    }
    html += '</div></div>';
  } else {
    html += '<div class="detail-section"><div class="detail-section-title">Contacts</div>';
    html += '<div style="color:var(--text3);font-size:12px;padding:8px 0">No contacts linked to this entity.</div></div>';
  }

  // Quick stats
  html += '<div class="detail-section"><div class="detail-section-title">Summary</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-top:4px">';
  html += '<div style="text-align:center;padding:12px;background:var(--s2);border-radius:8px"><div style="font-size:20px;font-weight:700;color:var(--accent)">' + (c.portfolio?.length || 0) + '</div><div style="font-size:11px;color:var(--text3)">Properties</div></div>';
  html += '<div style="text-align:center;padding:12px;background:var(--s2);border-radius:8px"><div style="font-size:20px;font-weight:700;color:var(--purple)">' + contacts.length + '</div><div style="font-size:11px;color:var(--text3)">Contacts</div></div>';
  html += '<div style="text-align:center;padding:12px;background:var(--s2);border-radius:8px"><div style="font-size:20px;font-weight:700;color:var(--green)">' + (c.transactions?.length || 0) + '</div><div style="font-size:11px;color:var(--text3)">Transactions</div></div>';
  html += '<div style="text-align:center;padding:12px;background:var(--s2);border-radius:8px"><div style="font-size:20px;font-weight:700;color:var(--yellow, #eab308)">' + (c.activities?.length || 0) + '</div><div style="font-size:11px;color:var(--text3)">Activities</div></div>';
  html += '</div></div>';

  return html;
}

// ── Entity Activity Tab ──
function _entityTabActivity() {
  const activities = _entityDetailCache?.activities || [];
  if (!activities.length) return '<div class="detail-empty">No activity history for this entity.</div>';

  const catIcon = { call: '\u{1F4DE}', email: '\u{1F4E7}', meeting: '\u{1F4C5}', note: '\u{1F4DD}', status_change: '\u{1F504}', assignment: '\u{1F464}', sync: '\u{1F500}', research: '\u{1F50D}', system: '\u{2699}\uFE0F' };

  let html = '<div class="detail-section"><div class="detail-section-title">Activity Timeline (' + activities.length + ')</div>';
  html += '<div style="display:flex;flex-direction:column;gap:2px;margin-top:4px">';

  for (const a of activities) {
    const date = _fmtDate(a.occurred_at || a.created_at);
    const icon = catIcon[a.category] || '\u{1F4CB}';
    const actor = a.users?.display_name || '';
    const cat = a.category ? a.category.replace(/_/g, ' ') : '';

    html += '<div style="padding:10px 12px;border-left:3px solid var(--accent);margin-left:8px;position:relative">';
    html += '<div style="position:absolute;left:-10px;top:12px;width:14px;height:14px;border-radius:50%;background:var(--s1);border:2px solid var(--accent);font-size:8px;display:flex;align-items:center;justify-content:center">' + icon + '</div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-weight:600;font-size:13px;color:var(--text)">' + esc(a.title || '(untitled)') + '</div>';
    if (a.body) html += '<div style="font-size:12px;color:var(--text2);margin-top:2px;white-space:pre-wrap;max-height:80px;overflow:hidden">' + esc(a.body) + '</div>';
    html += '<div style="font-size:10px;color:var(--text3);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap">';
    if (cat) html += '<span style="padding:1px 6px;border-radius:8px;background:var(--s3);text-transform:capitalize">' + esc(cat) + '</span>';
    if (actor) html += '<span>' + esc(actor) + '</span>';
    if (a.source_type && a.source_type !== 'manual') html += '<span>via ' + esc(a.source_type) + '</span>';
    html += '</div></div>';
    html += '<div style="flex-shrink:0;font-size:11px;color:var(--text3);white-space:nowrap">' + esc(date) + '</div>';
    html += '</div></div>';
  }

  html += '</div></div>';
  return html;
}

// ── Entity Portfolio Tab ──
function _entityTabPortfolio() {
  const portfolio = _entityDetailCache?.portfolio || [];
  if (!portfolio.length) return '<div class="detail-empty">No properties found for this entity.</div>';

  let html = '<div class="detail-section"><div class="detail-section-title">Ownership Portfolio (' + portfolio.length + ')</div>';
  html += '<div style="display:flex;flex-direction:column;gap:6px">';

  for (const p of portfolio) {
    const addr = p.address || p.property_address || '(No address)';
    const loc = (p.city || '') + (p.city && p.state ? ', ' : '') + (p.state || '');
    const propType = p.property_type || p.asset_type || '';
    const tenant = p.tenant_name || p.tenant_operator || p.facility_name || '';
    const db = p.domain === 'government' ? 'gov' : 'dia';
    const pid = p.property_id;

    html += '<div style="padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px;' + (pid ? 'cursor:pointer' : '') + '"';
    if (pid) html += ' onclick="openUnifiedDetail(\'' + esc(db) + '\', {property_id:' + pid + '})"';
    html += '>';
    html += '<div style="display:flex;gap:12px;align-items:flex-start">';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(addr) + '</div>';
    html += '<div style="font-size:11px;color:var(--text2)">' + esc(loc) + '</div>';
    html += '</div>';
    html += '<div style="text-align:right;font-size:11px;flex-shrink:0">';
    if (propType) html += '<div style="color:var(--text3)">' + esc(propType) + '</div>';
    if (tenant) html += '<div style="color:var(--accent)">' + esc(tenant) + '</div>';
    html += '</div></div></div>';
  }

  html += '</div></div>';
  return html;
}

// ── Entity Transactions Tab ──
function _entityTabTransactions() {
  const transactions = _entityDetailCache?.transactions || [];
  const entityName = _entityDetailCache?.entity?.name || '';
  if (!transactions.length) return '<div class="detail-empty">No transactions found for this entity.</div>';

  let html = '<div class="detail-section"><div class="detail-section-title">Transaction History (' + transactions.length + ')</div>';

  // Table header
  html += '<div style="display:flex;gap:8px;padding:6px 12px;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--text3);letter-spacing:0.5px">';
  html += '<div style="flex:0.7">Date</div>';
  html += '<div style="flex:1.5">Address</div>';
  html += '<div style="flex:0.8;text-align:right">Price</div>';
  html += '<div style="flex:0.5;text-align:center">Role</div>';
  html += '</div>';

  for (const t of transactions) {
    const date = _fmtDate(t.sale_date || t.transfer_date);
    const addr = t.address || t.property_address || '(Unknown)';
    const price = t.sale_price || t.price;
    const buyerName = (t.buyer_name || '').toLowerCase();
    const sellerName = (t.seller_name || '').toLowerCase();
    const nameL = entityName.toLowerCase();
    const role = buyerName.includes(nameL) ? 'Buyer' : (sellerName.includes(nameL) ? 'Seller' : '—');
    const roleColor = role === 'Buyer' ? 'var(--green)' : (role === 'Seller' ? 'var(--red, #ef4444)' : 'var(--text3)');

    html += '<div style="display:flex;gap:8px;padding:8px 12px;border-top:1px solid var(--border);font-size:12px;align-items:center">';
    html += '<div style="flex:0.7;color:var(--text2)">' + esc(date) + '</div>';
    html += '<div style="flex:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">' + esc(addr) + '</div>';
    html += '<div style="flex:0.8;text-align:right;color:var(--green);font-weight:600">' + (price ? fmt(price) : '—') + '</div>';
    html += '<div style="flex:0.5;text-align:center"><span style="font-size:10px;padding:2px 6px;border-radius:8px;background:' + roleColor + '22;color:' + roleColor + ';font-weight:600">' + esc(role) + '</span></div>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// ── Contact Detail Tab ──
function _renderContactTab(contact) {
  const c = contact;
  let html = '';

  // Contact info card
  html += '<div class="detail-section"><div class="detail-section-title">Contact Information</div><div class="detail-grid">';
  html += _row('Name', c.full_name || c.display_name);
  html += _row('Title', c.title);
  html += _row('Company', c.company_name);
  if (c.contact_class) html += _row('Type', c.contact_class);
  html += '</div></div>';

  // Communication details
  html += '<div class="detail-section"><div class="detail-section-title">Communication</div><div class="detail-grid">';
  if (c.email) html += _rowLink('Email', c.email, 'mailto:' + c.email);
  if (c.phone) html += _rowLink('Phone', c.phone, 'tel:' + c.phone);
  if (c.mobile_phone) html += _rowLink('Mobile', c.mobile_phone, 'tel:' + c.mobile_phone);
  if (c.linkedin_url) html += _rowLink('LinkedIn', 'Profile', c.linkedin_url);
  html += '</div></div>';

  // Address
  if (c.city || c.state || c.address) {
    html += '<div class="detail-section"><div class="detail-section-title">Address</div><div class="detail-grid">';
    if (c.address) html += _row('Street', c.address);
    html += _row('City / State', (c.city || '') + (c.city && c.state ? ', ' : '') + (c.state || ''));
    if (c.zip) html += _row('Zip', c.zip);
    html += '</div></div>';
  }

  // Linked entity
  if (c.entity_id) {
    html += '<div class="detail-section"><div class="detail-section-title">Linked Entity</div>';
    html += '<div onclick="openEntityDetail(\'' + esc(c.entity_id) + '\')" style="padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:8px">';
    html += '<span style="color:var(--accent);font-size:16px">🏢</span>';
    html += '<div><div style="font-weight:600;color:var(--accent)">' + esc(c.company_name || c.entity_id) + '</div>';
    html += '<div style="font-size:11px;color:var(--text3)">Click to view entity details</div></div>';
    html += '</div></div>';
  }

  // Source info
  if (c.source_system || c.created_at) {
    html += '<div class="detail-section"><div class="detail-section-title">Source</div><div class="detail-grid">';
    if (c.source_system) html += _row('Source', c.source_system);
    if (c.created_at) html += _row('Created', _fmtDate(c.created_at));
    if (c.updated_at) html += _row('Updated', _fmtDate(c.updated_at));
    if (c.last_activity_date) html += _row('Last Activity', _fmtDate(c.last_activity_date));
    html += '</div></div>';
  }

  return html;
}

// ── Contact Tab Switching ──
function _switchContactTab(tabName) {
  if (!_entityDetailCache || _entityDetailCache.type !== 'contact') return;
  document.querySelectorAll('#detailTabs .detail-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.trim() === tabName);
  });
  const bodyEl = document.getElementById('detailBody');
  if (!bodyEl) return;
  if (tabName === 'Activity') {
    bodyEl.innerHTML = _contactTabActivity();
  } else {
    bodyEl.innerHTML = _renderContactTab(_entityDetailCache.contact);
  }
}

// ── Contact Activity Tab ──
function _contactTabActivity() {
  const activities = _entityDetailCache?.activities || [];
  if (!activities.length) {
    const hasEntity = _entityDetailCache?.contact?.entity_id;
    return '<div class="detail-empty">' + (hasEntity ? 'No activity history found.' : 'No linked entity — activity tracking requires an entity association.') + '</div>';
  }

  const catIcon = { call: '\u{1F4DE}', email: '\u{1F4E7}', meeting: '\u{1F4C5}', note: '\u{1F4DD}', status_change: '\u{1F504}', assignment: '\u{1F464}', sync: '\u{1F500}', research: '\u{1F50D}', system: '\u{2699}\uFE0F' };

  let html = '<div class="detail-section"><div class="detail-section-title">Activity Timeline (' + activities.length + ')</div>';
  html += '<div style="display:flex;flex-direction:column;gap:2px;margin-top:4px">';

  for (const a of activities) {
    const date = _fmtDate(a.occurred_at || a.created_at);
    const icon = catIcon[a.category] || '\u{1F4CB}';
    const actor = a.users?.display_name || '';
    const cat = a.category ? a.category.replace(/_/g, ' ') : '';

    html += '<div style="padding:10px 12px;border-left:3px solid var(--purple);margin-left:8px;position:relative">';
    html += '<div style="position:absolute;left:-10px;top:12px;width:14px;height:14px;border-radius:50%;background:var(--s1);border:2px solid var(--purple);font-size:8px;display:flex;align-items:center;justify-content:center">' + icon + '</div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-weight:600;font-size:13px;color:var(--text)">' + esc(a.title || '(untitled)') + '</div>';
    if (a.body) html += '<div style="font-size:12px;color:var(--text2);margin-top:2px;white-space:pre-wrap;max-height:80px;overflow:hidden">' + esc(a.body) + '</div>';
    html += '<div style="font-size:10px;color:var(--text3);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap">';
    if (cat) html += '<span style="padding:1px 6px;border-radius:8px;background:var(--s3);text-transform:capitalize">' + esc(cat) + '</span>';
    if (actor) html += '<span>' + esc(actor) + '</span>';
    if (a.source_type && a.source_type !== 'manual') html += '<span>via ' + esc(a.source_type) + '</span>';
    html += '</div></div>';
    html += '<div style="flex-shrink:0;font-size:11px;color:var(--text3);white-space:nowrap">' + esc(date) + '</div>';
    html += '</div></div>';
  }

  html += '</div></div>';
  return html;
}

// Window exports for entity/contact detail functions
window.openEntityDetail = openEntityDetail;
window.openEntityDetailByName = openEntityDetailByName;
window.openContactDetail = openContactDetail;
window.openContactDetailByName = openContactDetailByName;
window._switchEntityTab = _switchEntityTab;

// ============================================================================
// OWNER DRAWER — Click-through panel for ownership_history / current owner
// ============================================================================
//
// Opens over the existing detail panel and shows the unified owner profile:
// - Company: address, state of incorp, entity type, parent (true owner)
// - Contacts: name, title, phone, email
// - Open Activities: incomplete SF tasks for this owner's SF Account
// - Activity History: completed SF activities for this owner's SF Account
// - Begin Prospecting: creates SF task + scrolls Log Activity / Draft Email
//
// Resolves shell LLCs ("Mds Dv Victorville") to their parent SF Account
// (Davita Inc.) by walking true_owner_id -> unified_contacts.sf_account_id.
//
// Empty state (no SF match): shows "Create Salesforce Account" + "Add Contact".

let _ownerDrawerCache = null;

/**
 * Build a clickable owner-name link that opens the OwnerDrawer.
 * Accepts a context object with whatever owner identity hints we have.
 * Always renders the display text — only the click handler differs.
 */
function _ownerLink(displayName, ctx) {
  if (!displayName) return '<span style="color:var(--text3)">\u2014</span>';
  const payload = encodeURIComponent(JSON.stringify(ctx || { name: displayName }));
  const style = 'color:var(--accent);cursor:pointer;text-decoration:underline;text-decoration-style:dotted;font-weight:600';
  return '<span class="owner-link" style="' + style + '" onclick="openOwnerDrawer(decodeURIComponent(\'' + payload + '\'))" title="View owner profile, contacts, and SF activity">' + esc(displayName) + '</span>';
}

/**
 * Build an owner context object from a v_ownership_chain row.
 * Standardizes fields across gov/dia rows and current ownership.
 */
function _ownerCtxFromChain(h, db) {
  const recordedName = h.recorded_owner_name || h.to_owner || h.new_owner || '';
  const trueName = h.true_owner_name || '';
  return {
    name: recordedName || trueName,
    recorded_owner_name: recordedName,
    recorded_owner_id: h.recorded_owner_id || null,
    true_owner_name: trueName,
    true_owner_id: h.true_owner_id || null,
    sf_account_id: h.sf_account_id || h.sf_company_id || null,
    sf_contact_id: h.sf_contact_id || null,
    state_of_incorporation: h.state_of_incorporation || h.recorded_owner_state || null,
    entity_type: h.ownership_type || h.owner_type || null,
    transfer_date: h.transfer_date || null,
    ownership_end: h.ownership_end || null,
    db: db || null
  };
}

/** Build owner context from a v_ownership_current row (own object). */
function _ownerCtxFromCurrent(own, db, which) {
  if (!own) return null;
  if (which === 'true' && own.true_owner) {
    return {
      name: own.true_owner,
      recorded_owner_name: null,
      recorded_owner_id: null,
      true_owner_name: own.true_owner,
      true_owner_id: own.true_owner_id || null,
      sf_account_id: own.sf_account_id || own.sf_company_id || null,
      sf_contact_id: own.sf_contact_id || own.salesforce_id || null,
      state_of_incorporation: own.true_owner_state || null,
      entity_type: own.true_owner_type || own.owner_type || null,
      address: own.recorded_owner_address || null,
      city: own.true_owner_city || null,
      is_current: true,
      db: db || null
    };
  }
  return {
    name: own.recorded_owner || own.true_owner,
    recorded_owner_name: own.recorded_owner,
    recorded_owner_id: own.recorded_owner_id || null,
    true_owner_name: own.true_owner || null,
    true_owner_id: own.true_owner_id || null,
    sf_account_id: own.sf_account_id || own.sf_company_id || null,
    sf_contact_id: own.sf_contact_id || own.salesforce_id || null,
    state_of_incorporation: own.recorded_owner_state || own.true_owner_state || null,
    entity_type: own.owner_type || own.recorded_owner_type || null,
    address: own.recorded_owner_address || null,
    city: own.recorded_owner_city || null,
    contact_name: own.contact_1_name || own.contact_name || null,
    contact_email: own.contact_email || null,
    contact_phone: own.contact_phone || null,
    is_current: true,
    db: db || null
  };
}

/**
 * Public entry: open the OwnerDrawer for a given owner context.
 * ctxJson may be a JSON string (from the inline onclick) or an object.
 */
async function openOwnerDrawer(ctxJson) {
  let ctx;
  try {
    ctx = (typeof ctxJson === 'string') ? JSON.parse(ctxJson) : ctxJson;
  } catch (e) {
    console.error('OwnerDrawer: bad ctx', e);
    return;
  }
  if (!ctx) return;

  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');
  if (!panel || !overlay) return;

  panel.style.display = 'block';
  overlay.classList.add('open');

  const headerEl = document.getElementById('detailHeader');
  const tabsEl = document.getElementById('detailTabs');
  const bodyEl = document.getElementById('detailBody');

  if (headerEl) headerEl.innerHTML =
    '<button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>' +
    '<div class="detail-header-info">' +
      '<div style="flex:1;min-width:0">' +
        '<div class="detail-title">' + esc(ctx.name || 'Owner') + '</div>' +
        '<div class="detail-subtitle">Loading owner profile...</div>' +
      '</div>' +
      '<span class="detail-badge" style="background:#a55eea;color:#fff">OWNER</span>' +
    '</div>' +
    '<button class="detail-close" onclick="closeDetail()">&times;</button>';
  if (tabsEl) tabsEl.innerHTML = '';
  if (bodyEl) bodyEl.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Resolving owner &amp; loading Salesforce activity...</p></div>';

  try {
    const resolved = await _resolveOwnerProfile(ctx);
    _ownerDrawerCache = resolved;

    const parentNote = (resolved.parent_account_name && resolved.parent_account_name !== resolved.name)
      ? '<div style="font-size:11px;color:var(--text3);margin-top:2px">Shell LLC \u2192 ' + esc(resolved.parent_account_name) + '</div>'
      : '';
    const sfBadge = resolved.sf_account_id
      ? '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#00a1e0;color:#fff;margin-left:6px">SF linked</span>'
      : '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s3);color:var(--text2);margin-left:6px">No SF match</span>';
    if (headerEl) headerEl.innerHTML =
      '<button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>' +
      '<div class="detail-header-info">' +
        '<div style="flex:1;min-width:0">' +
          '<div class="detail-title">' + esc(resolved.name || 'Owner') + sfBadge + '</div>' +
          '<div class="detail-subtitle">' + esc((resolved.entity_type || 'Owner Entity').toString().toUpperCase()) +
            (resolved.state_of_incorporation ? ' &middot; ' + esc(resolved.state_of_incorporation) : '') +
          '</div>' +
          parentNote +
        '</div>' +
        '<span class="detail-badge" style="background:#a55eea;color:#fff">OWNER</span>' +
      '</div>' +
      '<button class="detail-close" onclick="closeDetail()">&times;</button>';

    const tabs = ['Overview', 'Contacts', 'Open Activities', 'Activity History'];
    if (tabsEl) tabsEl.innerHTML = tabs.map(function(t, i) {
      return '<button class="detail-tab ' + (i === 0 ? 'active' : '') + '" onclick="_switchOwnerDrawerTab(\'' + t + '\')">' + t + '</button>';
    }).join('');

    if (bodyEl) bodyEl.innerHTML = _renderOwnerDrawerTab('Overview');
  } catch (err) {
    console.error('OwnerDrawer error:', err);
    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">Error loading owner profile: ' + esc(err.message || String(err)) + '</div>';
  }
}

/**
 * Resolve the owner identity into a single profile bundle:
 * walks shell LLC -> true_owner -> unified_contacts.sf_account_id, then
 * loads contacts, open activities, and activity history scoped to that
 * SF Account id.
 */
async function _resolveOwnerProfile(ctx) {
  const out = Object.assign({}, ctx);
  out.contacts = [];
  out.open_activities = [];
  out.activity_history = [];
  out.parent_account_name = null;

  // Step 1: Resolve sf_account_id
  if (!out.sf_account_id) {
    try {
      if (out.true_owner_id) {
        const ucRes = await _entityApiFetch('/api/data-query?_source=gov&table=unified_contacts&select=sf_account_id,company_name,sf_contact_id&filter=true_owner_id%3Deq.' + encodeURIComponent(out.true_owner_id) + '&limit=5');
        const rows = (ucRes && ucRes.data) || [];
        const hit = rows.find(function(r) { return r.sf_account_id; });
        if (hit) {
          out.sf_account_id = hit.sf_account_id;
          out.parent_account_name = hit.company_name || null;
        }
      }
      if (!out.sf_account_id && out.recorded_owner_id) {
        const ucRes = await _entityApiFetch('/api/data-query?_source=gov&table=unified_contacts&select=sf_account_id,company_name,sf_contact_id&filter=recorded_owner_id%3Deq.' + encodeURIComponent(out.recorded_owner_id) + '&limit=5');
        const rows = (ucRes && ucRes.data) || [];
        const hit = rows.find(function(r) { return r.sf_account_id; });
        if (hit) {
          out.sf_account_id = hit.sf_account_id;
          out.parent_account_name = hit.company_name || null;
        }
      }
      if (!out.sf_account_id) {
        const lookupName = out.true_owner_name || out.recorded_owner_name || out.name;
        if (lookupName) {
          const like = encodeURIComponent('*' + lookupName + '*');
          const ucRes = await _entityApiFetch('/api/data-query?_source=gov&table=unified_contacts&select=sf_account_id,company_name,sf_contact_id&filter=company_name%3Dilike.' + like + '&limit=5');
          const rows = (ucRes && ucRes.data) || [];
          const hit = rows.find(function(r) { return r.sf_account_id; });
          if (hit) {
            out.sf_account_id = hit.sf_account_id;
            out.parent_account_name = hit.company_name || null;
          }
        }
      }
    } catch (e) { console.warn('OwnerDrawer: sf_account_id resolution failed', e); }
  }

  // Step 2: Activity feed by sf_account_id
  if (out.sf_account_id) {
    try {
      const actRes = await diaQuery('v_sf_activity_feed', '*', {
        filter: 'sf_account_id=eq.' + encodeURIComponent(out.sf_account_id),
        order: 'activity_date.desc',
        limit: 100
      });
      const all = Array.isArray(actRes) ? actRes : (actRes && actRes.data) || [];
      out.open_activities = all.filter(function(a) {
        return a.is_completed === false || a.status === 'Open' || a.status === 'open' || a.status === 'In Progress';
      });
      out.activity_history = all.filter(function(a) {
        return !(a.is_completed === false || a.status === 'Open' || a.status === 'open' || a.status === 'In Progress');
      });
    } catch (e) { console.warn('OwnerDrawer: activity feed by sf_account_id failed', e); }
  }
  // Fallback: legacy by sf_contact_id / true_owner_id
  if (out.activity_history.length === 0 && out.open_activities.length === 0) {
    try {
      let actRes = [];
      if (out.sf_contact_id) {
        actRes = await diaQuery('v_sf_activity_feed', '*', { filter: 'sf_contact_id=eq.' + encodeURIComponent(out.sf_contact_id), order: 'activity_date.desc', limit: 100 });
      } else if (out.true_owner_id) {
        actRes = await diaQuery('v_sf_activity_feed', '*', { filter: 'true_owner_id=eq.' + encodeURIComponent(out.true_owner_id), order: 'activity_date.desc', limit: 100 });
      }
      const all = Array.isArray(actRes) ? actRes : (actRes && actRes.data) || [];
      out.open_activities = all.filter(function(a) {
        return a.is_completed === false || a.status === 'Open' || a.status === 'open' || a.status === 'In Progress';
      });
      out.activity_history = all.filter(function(a) {
        return !(a.is_completed === false || a.status === 'Open' || a.status === 'open' || a.status === 'In Progress');
      });
    } catch (e) { console.warn('OwnerDrawer: legacy activity fallback failed', e); }
  }

  // Step 3: Contacts
  if (out.sf_account_id) {
    try {
      const cRes = await _entityApiFetch('/api/data-query?_source=gov&table=unified_contacts&select=unified_id,full_name,first_name,last_name,title,email,phone,mobile_phone,sf_contact_id,company_name&filter=sf_account_id%3Deq.' + encodeURIComponent(out.sf_account_id) + '&order=engagement_score.desc.nullslast&limit=25');
      out.contacts = (cRes && cRes.data) || [];
    } catch (e) { console.warn('OwnerDrawer: contacts load failed', e); }
  }
  if (out.contacts.length === 0) {
    try {
      const lookupName = out.parent_account_name || out.true_owner_name || out.recorded_owner_name || out.name;
      if (lookupName) {
        const like = encodeURIComponent('*' + lookupName + '*');
        const cRes = await _entityApiFetch('/api/data-query?_source=gov&table=unified_contacts&select=unified_id,full_name,first_name,last_name,title,email,phone,mobile_phone,sf_contact_id,company_name&filter=company_name%3Dilike.' + like + '&limit=25');
        out.contacts = (cRes && cRes.data) || [];
      }
    } catch (e) { console.warn('OwnerDrawer: contacts company_name fallback failed', e); }
  }

  // Step 4: Recorded owner address / state of incorp / entity type backfill
  if ((!out.address || !out.state_of_incorporation || !out.entity_type) && out.recorded_owner_id) {
    try {
      const src = (out.db === 'gov') ? 'gov' : 'dia';
      const roRes = await _entityApiFetch('/api/data-query?_source=' + src + '&table=recorded_owners&select=*&filter=recorded_owner_id%3Deq.' + encodeURIComponent(out.recorded_owner_id) + '&limit=1');
      const ro = ((roRes && roRes.data) || [])[0];
      if (ro) {
        out.address = out.address || ro.address || ro.recorded_owner_address || null;
        out.city = out.city || ro.city || null;
        out.state_of_incorporation = out.state_of_incorporation || ro.state || ro.recorded_owner_state || null;
        out.entity_type = out.entity_type || ro.type || ro.owner_type || null;
      }
    } catch (e) { /* ignore */ }
  }

  return out;
}

function _renderOwnerDrawerTab(tab) {
  const c = _ownerDrawerCache;
  if (!c) return '<div class="detail-empty">No owner data loaded</div>';
  switch (tab) {
    case 'Overview': return _ownerDrawerOverview(c);
    case 'Contacts': return _ownerDrawerContacts(c);
    case 'Open Activities': return _ownerDrawerActivities(c, 'open');
    case 'Activity History': return _ownerDrawerActivities(c, 'history');
    default: return '<div class="detail-empty">Unknown tab</div>';
  }
}

function _switchOwnerDrawerTab(tabName) {
  if (!_ownerDrawerCache) return;
  document.querySelectorAll('#detailTabs .detail-tab').forEach(function(t) {
    t.classList.toggle('active', t.textContent.trim() === tabName);
  });
  const bodyEl = document.getElementById('detailBody');
  if (bodyEl) bodyEl.innerHTML = _renderOwnerDrawerTab(tabName);
}

function _ownerDrawerOverview(c) {
  let html = '';

  html += '<div class="detail-section"><div class="detail-section-title">Company Profile</div><div class="detail-grid">';
  html += _row('Name', c.name);
  if (c.parent_account_name && c.parent_account_name !== c.name) html += _row('Parent (SF Account)', c.parent_account_name);
  html += _row('Entity Type', c.entity_type);
  html += _row('State of Incorporation', c.state_of_incorporation);
  html += _row('Address', c.address);
  if (c.city) html += _row('City', c.city);
  if (c.transfer_date) html += _row('Owned Since', _fmtDate(c.transfer_date));
  if (c.ownership_end) html += _row('Owned Through', _fmtDate(c.ownership_end));
  html += '</div></div>';

  if (!c.sf_account_id) {
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">Salesforce</div>';
    html += '<div style="background:rgba(0,161,224,0.08);border:1px solid rgba(0,161,224,0.3);border-radius:10px;padding:14px 16px">';
    html += '<div style="font-size:13px;color:var(--text);margin-bottom:8px">No Salesforce match found for <strong>' + esc(c.name || 'this owner') + '</strong>.</div>';
    html += '<div style="font-size:12px;color:var(--text2);margin-bottom:12px">Create the SF Account so future activities and contacts can be tracked here.</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="act-btn primary" onclick="_ownerDrawerCreateSfAccount()">+ Create Salesforce Account</button>';
    html += '<button class="act-btn" onclick="_ownerDrawerAddContact()">+ Add Contact</button>';
    html += '</div></div></div>';
  } else {
    html += '<div class="detail-section"><div class="detail-section-title">Salesforce</div>';
    html += '<div class="ql-grid">';
    html += _qlBtn('SF Account', _SF_BASE + '/Account/' + c.sf_account_id + '/view', '\uD83C\uDFEC', '#a55eea');
    html += '</div></div>';
  }

  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Prospecting</div>';
  html += '<div style="background:linear-gradient(135deg,rgba(165,94,234,0.12),rgba(0,161,224,0.08));border:1px solid rgba(165,94,234,0.25);border-radius:10px;padding:14px 16px">';
  html += '<div style="font-size:13px;color:var(--text);margin-bottom:6px;font-weight:600">Begin Prospecting</div>';
  html += '<div style="font-size:12px;color:var(--text2);margin-bottom:12px">Creates a Salesforce task on this account, then jumps to Log Activity / Draft Email scoped to <strong>' + esc(c.name) + '</strong>.</div>';
  html += '<button class="act-btn primary" onclick="_ownerDrawerBeginProspecting()" style="background:#a55eea;color:#fff">\u2192 Begin Prospecting</button>';
  html += '</div></div>';

  html += '<div class="detail-section"><div class="detail-section-title">Engagement Snapshot</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">';
  html += '<div style="text-align:center;padding:12px;background:var(--s2);border-radius:8px"><div style="font-size:20px;font-weight:700;color:var(--purple)">' + (c.contacts ? c.contacts.length : 0) + '</div><div style="font-size:11px;color:var(--text3)">Contacts</div></div>';
  html += '<div style="text-align:center;padding:12px;background:var(--s2);border-radius:8px"><div style="font-size:20px;font-weight:700;color:var(--accent)">' + c.open_activities.length + '</div><div style="font-size:11px;color:var(--text3)">Open Tasks</div></div>';
  html += '<div style="text-align:center;padding:12px;background:var(--s2);border-radius:8px"><div style="font-size:20px;font-weight:700;color:var(--green)">' + c.activity_history.length + '</div><div style="font-size:11px;color:var(--text3)">Activities Logged</div></div>';
  html += '</div></div>';

  return html;
}

function _ownerDrawerContacts(c) {
  if (!c.contacts || c.contacts.length === 0) {
    let html = '<div class="detail-section"><div class="detail-section-title">Contacts</div>';
    html += '<div class="detail-empty">No contacts linked to this owner yet.</div>';
    html += '<div style="margin-top:12px"><button class="act-btn primary" onclick="_ownerDrawerAddContact()">+ Add Contact</button></div>';
    html += '</div>';
    return html;
  }
  let html = '<div class="detail-section"><div class="detail-section-title">Contacts (' + c.contacts.length + ')</div>';
  html += '<div style="display:flex;flex-direction:column;gap:6px">';
  c.contacts.forEach(function(ct) {
    const name = ct.full_name || ((ct.first_name || '') + ' ' + (ct.last_name || '')).trim() || 'Unknown';
    const initial = (name[0] || '?').toUpperCase();
    html += '<div style="padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px;cursor:pointer" onclick="openContactDetail(decodeURIComponent(\'' + encodeURIComponent(ct.unified_id || ct.sf_contact_id || '') + '\'))">';
    html += '<div style="display:flex;align-items:center;gap:10px">';
    html += '<div style="width:32px;height:32px;border-radius:50%;background:var(--purple);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600">' + esc(initial) + '</div>';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-weight:600;color:var(--text)">' + esc(name) + '</div>';
    html += '<div style="font-size:11px;color:var(--text3)">' + esc(ct.title || '') + '</div>';
    html += '</div>';
    html += '<div style="text-align:right;font-size:11px">';
    if (ct.email) html += '<div><a href="mailto:' + esc(ct.email) + '" onclick="event.stopPropagation()" style="color:var(--accent)">' + esc(ct.email) + '</a></div>';
    if (ct.phone || ct.mobile_phone) html += '<div><a href="tel:' + esc(ct.phone || ct.mobile_phone) + '" onclick="event.stopPropagation()" style="color:var(--text2)">' + esc(ct.phone || ct.mobile_phone) + '</a></div>';
    html += '</div></div></div>';
  });
  html += '</div></div>';
  html += '<div style="margin-top:12px"><button class="act-btn" onclick="_ownerDrawerAddContact()">+ Add Contact</button></div>';
  return html;
}

function _ownerDrawerActivities(c, mode) {
  const list = (mode === 'open') ? c.open_activities : c.activity_history;
  const title = (mode === 'open') ? 'Open Activities' : 'Activity History';
  if (!list || list.length === 0) {
    let html = '<div class="detail-section"><div class="detail-section-title">' + title + '</div>';
    if (!c.sf_account_id) {
      html += '<div class="detail-empty">No SF Account linked yet \u2014 create one to see activities.</div>';
      html += '<div style="margin-top:12px"><button class="act-btn primary" onclick="_ownerDrawerCreateSfAccount()">+ Create Salesforce Account</button></div>';
    } else {
      html += '<div class="detail-empty">No ' + title.toLowerCase() + ' for this owner.</div>';
    }
    html += '</div>';
    return html;
  }
  let html = '<div class="detail-section"><div class="detail-section-title">' + title + ' (' + list.length + ')</div>';
  list.forEach(function(a) {
    const typeColor = (a.feed_type === 'task' || mode === 'open') ? 'var(--yellow)'
      : (a.feed_type === 'call_outcome') ? 'var(--green)' : 'var(--accent)';
    html += '<div class="detail-card">';
    html += '<div class="detail-card-header">';
    html += '<div class="detail-card-title">' + esc(a.subject || a.activity_type || 'Activity') + '</div>';
    html += '<div class="detail-card-date">' + esc(_fmtDate(a.activity_date)) + '</div>';
    html += '</div>';
    html += '<div class="detail-card-body">';
    html += '<span style="display:inline-block;font-size:10px;padding:2px 6px;border-radius:4px;background:' + typeColor + ';color:#fff;margin-bottom:4px">' + esc(a.feed_type || a.activity_type || '') + '</span>';
    if (a.activity_type) html += ' <span style="font-size:12px;color:var(--text2)">' + esc(a.activity_type) + '</span>';
    if (a.status) html += '<br><span style="font-size:12px;color:var(--text3)">Status: ' + esc(a.status) + '</span>';
    if (a.assigned_to) html += '<br><span style="font-size:12px;color:var(--text3)">Assigned: ' + esc(a.assigned_to) + '</span>';
    if (a.contact_name) html += '<br><span style="font-size:12px;color:var(--text3)">Contact: ' + esc(a.contact_name) + '</span>';
    if (a.notes) html += '<br><span style="font-size:12px;color:var(--text2);white-space:pre-wrap">' + esc(String(a.notes).substring(0, 220)) + (a.notes.length > 220 ? '...' : '') + '</span>';
    html += '</div></div>';
  });
  html += '</div>';
  return html;
}

/** Begin Prospecting: create a SF task on this owner's account + scroll to Log Activity. */
async function _ownerDrawerBeginProspecting() {
  const c = _ownerDrawerCache;
  if (!c) return;

  if (!c.sf_account_id) {
    showToast('No SF Account linked yet \u2014 create the account first.', 'info');
    return;
  }

  try {
    const payload = {
      sf_company_id: c.sf_account_id,
      sf_contact_id: c.sf_contact_id || undefined,
      activity_type: 'Client Outreach',
      activity_date: new Date().toISOString().split('T')[0],
      outcome: 'no_answer',
      notes: 'Investment Sales - Prospecting opened',
      force: true
    };
    const res = await fetch('/api/sync?action=outbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'log_to_sf', payload })
    });
    if (!res.ok) throw new Error('Server returned ' + res.status);
    showToast('Prospecting task created on ' + (c.parent_account_name || c.name), 'success');
  } catch (e) {
    console.warn('Begin Prospecting: SF task creation failed', e);
    showToast('Could not create SF task: ' + e.message, 'error');
  }

  closeDetail();
  setTimeout(function() {
    const logForm = document.getElementById('udLogCallForm');
    if (logForm) {
      logForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const notes = document.getElementById('udLogNotes');
      if (notes) {
        notes.value = 'Prospecting ' + (c.parent_account_name || c.name) + ' \u2014 ';
        notes.focus();
      }
    }
  }, 250);
}

/** Open SF account creation in a new tab, prefilled with this owner's name. */
function _ownerDrawerCreateSfAccount() {
  const c = _ownerDrawerCache;
  if (!c) return;
  const name = c.parent_account_name || c.true_owner_name || c.recorded_owner_name || c.name || '';
  const sfNewUrl = _SF_BASE + '/lightning/o/Account/new?defaultFieldValues=Name=' + encodeURIComponent(name);
  window.open(sfNewUrl, '_blank', 'noopener');
  showToast('Opening Salesforce \u2014 New Account form (' + name + ')', 'info');
}

/** Inline Add Contact: writes to unified_contacts via /api/data-query. */
async function _ownerDrawerAddContact() {
  const c = _ownerDrawerCache;
  if (!c) return;
  const fullName = window.prompt('Contact full name:', '');
  if (!fullName) return;
  const email = window.prompt('Email (optional):', '') || '';
  const phone = window.prompt('Phone (optional):', '') || '';
  const title = window.prompt('Title (optional):', '') || '';

  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';
  const companyName = c.parent_account_name || c.true_owner_name || c.recorded_owner_name || c.name || '';

  try {
    const body = {
      first_name: firstName,
      last_name: lastName,
      email: email || null,
      phone: phone || null,
      title: title || null,
      company_name: companyName,
      contact_class: 'business',
      contact_type: 'owner',
      sf_account_id: c.sf_account_id || null,
      true_owner_id: c.true_owner_id || null,
      recorded_owner_id: c.recorded_owner_id || null,
      match_method: 'manual',
      match_confidence: 1.0
    };
    const res = await fetch('/api/data-query?_source=gov&table=unified_contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showToast('Contact added to ' + companyName, 'success');
    openOwnerDrawer(c);
  } catch (e) {
    console.error('Add Contact failed', e);
    showToast('Add Contact failed: ' + e.message, 'error');
  }
}

window.openOwnerDrawer = openOwnerDrawer;
window._switchOwnerDrawerTab = _switchOwnerDrawerTab;
window._ownerDrawerBeginProspecting = _ownerDrawerBeginProspecting;
window._ownerDrawerCreateSfAccount = _ownerDrawerCreateSfAccount;
window._ownerDrawerAddContact = _ownerDrawerAddContact;
window._ownerLink = _ownerLink;
window._ownerCtxFromCurrent = _ownerCtxFromCurrent;
window._ownerCtxFromChain = _ownerCtxFromChain;
window._switchContactTab = _switchContactTab;