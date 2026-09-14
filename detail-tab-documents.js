// ─────────────────────────────────────────────────────────────────────────────
// detail-tab-documents.js — W6.5 Stage 2, Unit 2 (extracted from detail.js
// 2026-08-20). Moved VERBATIM from detail.js lines 9240-9452.
//
// The property slide-over's DOCUMENTS tab: the OM / BOV / lease / PSA-DD / comp /
// master-sheet list ingested for a property, plus the client-dossier builders
// that render alongside it (the tab surfaces both, so they are one cohesive
// region despite the name).
//
//   _UD_DOC_SECTIONS             the 7 document sections + icons
//   _udRenderDocumentsAsync      async loader — the switchUnifiedTab entry point
//   _udRenderDossiers            stored-dossier list
//   _udRenderDocuments           the document list itself
//   _udBuildPropertyDossierHTML  client-facing dossier HTML
//   _udOpenClientDossier         build + open in a new tab
//
// CLASSIC script loaded BEFORE detail.js — one shared global scope, so nothing
// needed rewiring. Callers stay in detail.js (lines 708, 993) and resolve at
// CALL time. _reEsc and showToast deliberately stayed behind for the same reason.
//
// Guarded by test/detail-tab-registry.test.mjs (which asserts the Documents tab
// still dispatches to a renderer that EXISTS, reading detail.js + every
// detail-*.js as one source) and test/frontend-module-load-order.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

// ── Documents tab — OMs / BOVs / leases / comps ingested for THIS property.
// Sourced from staged_intake_artifacts via the asset entity (documents endpoint);
// each opens in a new tab through a freshly-minted signed/sharing URL. Property
// data — lives on the property page (per the separation-of-concerns split).
const _UD_DOC_SECTIONS = [
  { key: 'om',     title: 'Offering Memorandums', icon: '\u{1F4C4}' },
  { key: 'bov',    title: 'BOVs',                 icon: '\u{1F4CA}' },
  { key: 'lease',  title: 'Leases',               icon: '\u{1F4DD}' },
  { key: 'psa_dd', title: 'PSA / Due Diligence',  icon: '\u{1F4CB}' },
  { key: 'comp',   title: 'Comps',                icon: '\u{1F4C8}' },
  { key: 'master', title: 'Master Sheets',        icon: '\u{1F5C2}️' },
  { key: 'other',  title: 'Other Documents',      icon: '\u{1F4CE}' },
];

async function _udRenderDocumentsAsync(bodyEl) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div style="text-align:center;padding:44px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading documents…</p></div>';
  const eid = _udCache.lccEntityId
    || (_udCache.entityMeta && (_udCache.entityMeta.entity_id || _udCache.entityMeta.id))
    || (_udCache.ownership && _udCache.ownership.owner_entity_id)
    || null;
  if (!eid) {
    bodyEl.innerHTML = '<div class="detail-empty">This property isn’t linked to an LCC entity yet, so its documents can’t be looked up. Documents are keyed to the property’s entity.</div>';
    return;
  }
  let data = null, dossiers = null;
  try {
    [data, dossiers] = await Promise.all([
      _entityApiFetch('/api/entities?action=documents&id=' + encodeURIComponent(eid)),
      _entityApiFetch('/api/entities?action=dossiers&id=' + encodeURIComponent(eid)).catch(() => null),
    ]);
  } catch (_e) { data = null; }
  bodyEl.innerHTML = _udRenderDossiers(dossiers) + _udRenderDocuments(data);
}

// Stored, generated dossiers (property/deal) for this property — newest first.
function _udRenderDossiers(data) {
  const rows = (data && Array.isArray(data.dossiers)) ? data.dossiers : [];
  if (!rows.length) return '';
  let html = '<div class="detail-section"><div class="detail-section-title">Dossiers'
    + ' <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:8px">' + rows.length + '</span></div>';
  html += '<div style="font-size:11px;color:var(--text3);margin:-4px 0 8px">Generated property/deal briefs. Opens in a new tab.</div>';
  html += '<div style="display:flex;flex-direction:column;gap:6px">';
  for (const d of rows) {
    const label = (d.dossier_type === 'deal' ? 'Deal Dossier' : 'Property Dossier') + ' · v' + (d.version || 1);
    const sp = d.metadata && d.metadata.sharepoint_url ? ' · SharePoint' : '';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 11px;background:var(--s2);border:1px solid var(--border);border-radius:8px">';
    html += '<div style="min-width:0"><div style="font-size:12.5px;font-weight:600;color:var(--text)">' + esc(label) + '</div>';
    html += '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + (d.generated_at ? esc(_fmtDate(d.generated_at)) : '') + esc(sp) + '</div></div>';
    html += '<button class="dns-cta" style="flex-shrink:0" onclick="_udOpenDossier(' + JSON.stringify(String(d.id)) + ', this)">Open ↗</button>';
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

// Mint a signed/sharing URL for a stored dossier and open it in a new tab.
async function _udOpenDossier(dossierId, btn) {
  if (!dossierId) return;
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
  const w = (typeof window !== 'undefined') ? window.open('', '_blank') : null;
  try {
    const d = await _entityApiFetch('/api/entities?action=dossier_url&dossier_id=' + encodeURIComponent(dossierId));
    if (d && d.ok && d.signed_url) {
      if (w) w.location.href = d.signed_url; else window.open(d.signed_url, '_blank');
    } else {
      if (w) w.close();
      if (typeof showToast === 'function') showToast('Could not open dossier', 'error');
    }
  } catch (_e) {
    if (w) w.close();
    if (typeof showToast === 'function') showToast('Could not open dossier', 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = orig; }
}
window._udOpenDossier = _udOpenDossier;

function _udRenderDocuments(data) {
  const groups = (data && data.groups) || {};
  const total = (data && data.count) || 0;
  let html = '<div class="detail-section"><div class="detail-section-title">Documents'
    + (total ? ' <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:8px">' + total + '</span>' : '') + '</div>';
  html += '<div style="font-size:11px;color:var(--text3);margin:-4px 0 8px">Offering memos, BOVs, leases &amp; comps we’ve ingested for this property. Opens in a new tab.</div>';
  if (!total) {
    html += '<div class="detail-empty">No documents ingested for this property yet. OMs pulled via the sidebar or emailed to intake will appear here.</div></div>';
    return html;
  }
  for (const sec of _UD_DOC_SECTIONS) {
    const rows = groups[sec.key];
    if (!rows || !rows.length) continue;
    html += '<div style="margin-top:10px"><div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.03em;margin-bottom:5px">' + sec.icon + ' ' + esc(sec.title) + ' (' + rows.length + ')</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px">';
    for (const d of rows) {
      const badge = d.backend === 'sharepoint_pa' ? 'SharePoint' : 'Supabase';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 11px;background:var(--s2);border:1px solid var(--border);border-radius:8px">';
      html += '<div style="min-width:0"><div style="font-size:12.5px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.file_name || '(document)') + '</div>';
      html += '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + esc(badge) + (d.created_at ? ' · ' + esc(_fmtDate(d.created_at)) : '') + '</div></div>';
      html += '<button class="dns-cta" style="flex-shrink:0" onclick="_udOpenDocument(' + JSON.stringify(String(d.id)) + ', this)">Open ↗</button>';
      html += '</div>';
    }
    html += '</div></div>';
  }
  html += '</div>';
  return html;
}

// Mint a signed URL for the artifact and open it in a new tab. Opens the blank
// tab synchronously first (before the await) so the browser doesn't block it.
async function _udOpenDocument(artifactId, btn) {
  if (!artifactId) return;
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
  const w = (typeof window !== 'undefined') ? window.open('', '_blank') : null;
  try {
    const d = await _entityApiFetch('/api/entities?action=document_url&artifact_id=' + encodeURIComponent(artifactId));
    if (d && d.ok && d.signed_url) {
      if (w) w.location.href = d.signed_url; else window.open(d.signed_url, '_blank');
    } else {
      if (w) w.close();
      if (typeof showToast === 'function') showToast('Could not open document: ' + ((d && (d.detail || d.error)) || 'unavailable'), 'error');
    }
  } catch (_e) {
    if (w) w.close();
    if (typeof showToast === 'function') showToast('Could not open document', 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = orig; }
}
window._udOpenDocument = _udOpenDocument;

// Property Dossier v1 (data-only) - a print-ready brief built from the already-
// loaded property data (_udCache). Opens in a new tab. Uses the corrected owner
// (recorded deed owner when the true owner is an operator). LLM prose + storage/
// versioning (lcc_dossiers) are later phases.
function _udBuildPropertyDossierHTML(c){
  c = c || _udCache || {};
  const p = c.property || {};
  const own = c.ownership || {};
  const db = c.db || 'dia';
  const leases = Array.isArray(c.leases) ? c.leases : [];
  const chain = Array.isArray(c.chain) ? c.chain : [];
  const cms = (c.cms && (c.cms.facility || c.cms)) || null;
  const addr = p.address || p.property_name || (c.fallback && c.fallback.address) || 'Property';
  const loc = [p.city || (c.fallback && c.fallback.city), p.state || (c.fallback && c.fallback.state)].filter(Boolean).join(', ');
  const domLabel = db === 'gov' ? 'Government' : 'Dialysis';
  const trueIsOp = !!own.true_owner_is_operator;
  const ownerName = (!trueIsOp && (own.true_owner_canonical || own.true_owner)) || own.recorded_owner_canonical || own.recorded_owner || 'Unresolved';
  const recorded = own.recorded_owner_canonical || own.recorded_owner || null;
  const lease = leases[0] || {};
  const tenant = lease.tenant || own.operator_name || p.tenant || p.operator || null;
  const rent = lease.annual_rent != null ? lease.annual_rent : (lease.rent != null ? lease.rent : (p.annual_rent != null ? p.annual_rent : null));
  const gen = (new Date()).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const E = function(v){ return esc(v==null?'':String(v)); };
  const money = function(v){ return (v==null||v==='')?'&mdash;':(typeof fmt==='function'?fmt(v):('$'+v)); };
  const dt = function(v){ return v?(typeof _fmtDate==='function'?_fmtDate(v):String(v)):'&mdash;'; };
  const row = function(k,v){ return `<tr><td class='k'>${E(k)}</td><td class='v'>${(v==null||v==='')?'&mdash;':v}</td></tr>`; };
  let s = '';
  s += `<h2>Snapshot</h2><table class='kv'>`;
  s += row('Property', E(addr) + (loc?` &middot; ${E(loc)}`:''));
  s += row('Type', `${domLabel} net-lease`);
  if (p.estimated_value) s += row('Estimated value', money(p.estimated_value));
  if (p.building_size || p.rba) s += row('Building size', `${E(p.building_size||p.rba)} SF`);
  if (p.year_built) s += row('Year built', E(p.year_built));
  s += `</table>`;
  s += `<h2>Ownership</h2><table class='kv'>`;
  s += row('Owner of record', E(ownerName));
  if (recorded && recorded !== ownerName) s += row('Recorded deed owner', E(recorded));
  if (trueIsOp && (own.true_owner_canonical||own.true_owner)) s += row('Operator / tenant', `${E(own.true_owner_canonical||own.true_owner)} (not the owner)`);
  if (own.owner_type||own.true_owner_type) s += row('Owner type', E(own.owner_type||own.true_owner_type));
  s += `</table>`;
  s += `<h2>Tenancy &amp; Lease</h2><table class='kv'>`;
  s += row('Tenant / Operator', E(tenant));
  s += row('Annual rent', money(rent));
  if (lease.lease_start||lease.lease_expiration) s += row('Lease term', `${dt(lease.lease_start)} &ndash; ${dt(lease.lease_expiration)}`);
  if (lease.expense_structure) s += row('Expense structure', E(lease.expense_structure));
  s += `</table>`;
  if (db==='dia' && cms){
    s += `<h2>Operations (CMS)</h2><table class='kv'>`;
    if (cms.facility_name||cms.provider_name) s += row('Facility', E(cms.facility_name||cms.provider_name));
    if (cms.medicare_id||cms.ccn) s += row('CCN / Medicare ID', E(cms.medicare_id||cms.ccn));
    if (cms.stations||cms.number_of_stations) s += row('Stations', E(cms.stations||cms.number_of_stations));
    if (cms.last_survey_date) s += row('Last CMS survey', dt(cms.last_survey_date));
    s += `</table>`;
  }
  if (chain.length){
    s += `<h2>Ownership &amp; Sales History</h2><table class='hist'><thead><tr><th>Date</th><th>Owner / Buyer</th><th>Price</th></tr></thead><tbody>`;
    for (const h of chain.slice(0,25)){
      const who = h.recorded_owner_name||h.true_owner_name||h.buyer||h.new_owner||h.owner_name||'';
      s += `<tr><td>${dt(h.transfer_date)}</td><td>${E(who)}</td><td>${h.sale_price?money(h.sale_price):'&mdash;'}</td></tr>`;
    }
    s += `</tbody></table>`;
  }
  const css = `body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a;margin:0;background:#f4f5f7} .doc{max-width:820px;margin:24px auto;background:#fff;padding:40px 48px;box-shadow:0 1px 6px rgba(0,0,0,.12)} header{border-bottom:3px solid #4f46e5;padding-bottom:16px;margin-bottom:8px} .brand{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4f46e5} .type{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-top:2px} h1{font-size:24px;margin:10px 0 2px} .loc{color:#555;font-size:14px} .meta{color:#999;font-size:11px;margin-top:8px} h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#4f46e5;border-bottom:1px solid #eee;padding-bottom:5px;margin:26px 0 10px} table.kv{width:100%;border-collapse:collapse} table.kv td{padding:6px 0;vertical-align:top;border-bottom:1px solid #f0f0f0;font-size:13px} td.k{color:#777;width:200px} td.v{color:#1a1a1a;font-weight:500} table.hist{width:100%;border-collapse:collapse;font-size:12.5px} table.hist th{text-align:left;color:#777;font-weight:600;border-bottom:2px solid #eee;padding:6px 8px 6px 0} table.hist td{padding:6px 8px 6px 0;border-bottom:1px solid #f2f2f2} footer{margin-top:32px;padding-top:14px;border-top:1px solid #eee;color:#999;font-size:10.5px} @media print{body{background:#fff}.doc{box-shadow:none;margin:0;max-width:none}}`;
  return `<!doctype html><html><head><meta charset='utf-8'><title>${E(addr)} - Property Dossier</title><style>${css}</style></head><body><div class='doc'><header><div class='brand'>Team Briggs &middot; Northmarq</div><div class='type'>Property Dossier</div><h1>${E(addr)}</h1>${loc?`<div class='loc'>${E(loc)}</div>`:''}<div class='meta'>${domLabel} &middot; Generated ${E(gen)} &middot; Life Command Center</div></header>${s}<footer>Generated by the Life Command Center from the LCC data spine. Verify against source documents before external distribution.</footer></div></body></html>`;
}
window._udBuildPropertyDossierHTML = _udBuildPropertyDossierHTML;

// Open the client-built, data-only dossier in the given (or a new) tab. This is
// the offline fallback used when the server generator is unreachable or the
// property isn't linked to an LCC entity.
function _udOpenClientDossier(w){
  try{
    const html = _udBuildPropertyDossierHTML(_udCache);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    if (w) { w.location.href = url; } else { w = window.open(url, '_blank'); }
    if(!w && typeof showToast==='function') showToast('Popup blocked - allow popups to view the dossier', 'error');
    setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(_e){} }, 120000);
  }catch(e){
    if(typeof showToast==='function') showToast('Could not build dossier', 'error');
    console.warn('dossier build failed', e);
  }
}
