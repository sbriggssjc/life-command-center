// ─────────────────────────────────────────────────────────────────────────────
// detail-entity-tabs.js — W6.5 Stage 2, Unit 4 (extracted from detail.js
// 2026-08-20). Moved VERBATIM from detail.js lines 13846-14615.
//
// The entity slide-over's TAB BODIES — the content _renderEntityTab dispatches
// INTO. The dispatcher itself (_renderEntityTab / switchEntityTab /
// openEntityDetail / ENTITY_DETAIL_TABS) deliberately STAYS in detail.js: same
// shell-vs-content split the tab-registry guard enforces for the property panel.
//
//   Relationships  _ENTITY_REL_SECTIONS, _entityTab/Load/RenderRelationships
//   History        _ENTITY_HISTORY_SECTIONS, _entityTab/Load/RenderHistory
//   Activity       _entityTabActivity, _entityCadenceCockpit,
//                  _renderEmailRelationshipCard, _cortexPullHistory
//   Engagement/ROE _entityTabEngagement, _entityTabRoe
//   Deal           _entityTabDeal + the _deal* formatter/section family,
//                  _entityTabPropertyRef
//
// This region only became contiguous once Unit 3 lifted the panel shell out from
// the MIDDLE of the entity tabs — which is why the map's single
// "detail-entity.js (13363-15267)" was never one region-move. See the CORRECTION
// in w6-5-frontend-decomposition-map.md §2b.
//
// CLASSIC script loaded BEFORE detail.js. 3 window.* exports
// (_cortexPullHistory, _dealOpenSource, _dealInspectSource) back onclick /
// ondblclick handlers this file's own output emits (lines ~14340, ~14402 in the
// pre-move numbering) — they resolve off `window` at CLICK time.
// ─────────────────────────────────────────────────────────────────────────────

// ── Entity Relationships Tab (Scott ask #2) ──
// Working-relationship intelligence from lcc_party_relationships: the party's
// counterparties across shared assets, grouped (buyers sold-to / sellers
// bought-from / co-brokers / lenders), REIT/institution-flagged. Lazy-loaded
// (heavy graph rollup) and cached on the panel cache after first open.
const _ENTITY_REL_SECTIONS = [
  { key: 'sold_to',        title: 'Buyers they’ve sold to',        note: 'principals this party sold assets to' },
  { key: 'bought_from',    title: 'Sellers they’ve bought from',    note: 'principals this party acquired assets from' },
  { key: 'co_broker',      title: 'Co-brokers',                         note: 'brokers on the same deals' },
  { key: 'brokered_for',   title: 'Brokerage clients',                  note: 'principals this party brokered for' },
  { key: 'broker_on_deal', title: 'Brokers on their deals',             note: 'brokers who worked this party’s assets' },
  { key: 'financed_by',    title: 'Lenders',                            note: 'financed this party’s assets' },
  { key: 'lent_to',        title: 'Borrowers',                          note: 'this party financed their assets' },
  { key: 'co_owner',       title: 'Co-owners',                          note: 'shared ownership on the same assets' },
];

function _entityTabRelationships() {
  const c = _entityDetailCache || {};
  if (c.relationships) return _entityRenderRelationships(c.relationships);
  const eid = c.entityId || (c.entity && c.entity.id) || '';
  if (!eid) return '<div class="detail-empty">No entity for relationship lookup.</div>';
  // Kick the async load; the sync return is a spinner host.
  setTimeout(function(){ _entityLoadRelationships(eid); }, 0);
  return '<div id="entityRelHost"><div style="text-align:center;padding:40px;color:var(--text3)"><span class="spinner"></span><p style="margin-top:10px">Loading working relationships…</p></div></div>';
}

async function _entityLoadRelationships(eid) {
  let data = null;
  try {
    data = await _entityApiFetch('/api/entities?action=relationships&id=' + encodeURIComponent(eid) + '&limit=60');
  } catch (_e) { data = null; }
  // Guard: the panel may have moved on to another entity while we loaded.
  const c = _entityDetailCache || {};
  const stillHere = (c.entityId || (c.entity && c.entity.id)) === eid;
  if (stillHere) c.relationships = data || { rows: [], groups: {} };
  const host = document.getElementById('entityRelHost');
  if (host && stillHere) host.innerHTML = _entityRenderRelationships(c.relationships);
}

function _entityRenderRelationships(data) {
  const groups = (data && data.groups) || {};
  const total = (data && data.count) || 0;
  if (!total) {
    return '<div class="detail-empty">No working relationships found in the ownership/transaction graph for this party.</div>';
  }
  let html = '<div style="font-size:11px;color:var(--text3);margin:0 0 10px">' + total + ' counterpart' + (total === 1 ? 'y' : 'ies') + ' across shared assets · ranked by deals in common.</div>';
  for (const sec of _ENTITY_REL_SECTIONS) {
    const rows = groups[sec.key];
    if (!rows || !rows.length) continue;
    html += '<div class="detail-section"><div class="detail-section-title">' + esc(sec.title) + ' (' + rows.length + ')</div>';
    html += '<div style="font-size:10px;color:var(--text3);margin:-2px 0 8px">' + esc(sec.note) + '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px">';
    for (const r of rows) {
      const nm = r.counterparty_name || '(unknown)';
      const inst = !!r.is_institution;
      const onclick = r.counterparty_id ? 'openContact360(\'' + esc(String(r.counterparty_id)) + '\', {kind:\'entity\'})' : '';
      html += '<div style="padding:9px 11px;background:var(--s2);border:1px solid var(--border);border-radius:8px' + (onclick ? ';cursor:pointer' : '') + '"' + (onclick ? ' onclick="' + onclick + '"' : '') + '>';
      html += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">';
      html += '<div style="font-weight:600;font-size:13px;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(nm);
      if (inst) html += ' <span style="font-size:9px;padding:1px 6px;border-radius:9px;background:rgba(99,102,241,0.14);color:var(--purple,#6366f1);border:1px solid rgba(99,102,241,0.3);font-weight:700;margin-left:4px">REIT / INSTITUTION</span>';
      html += '</div>';
      html += '<div style="font-size:11px;color:var(--text3);white-space:nowrap;flex-shrink:0">' + Number(r.shared_assets || 0) + ' deal' + (Number(r.shared_assets) === 1 ? '' : 's') + '</div>';
      html += '</div>';
      if (r.last_date) html += '<div style="font-size:10px;color:var(--text3);margin-top:3px">last: ' + esc(_fmtDate(r.last_date)) + '</div>';
      html += '</div>';
    }
    html += '</div></div>';
  }
  return html;
}

// ── Entity History Tab (Scott ask #1: Portfolio & History) ──
// Every role the party has played on every asset over time (owner / buyer /
// seller / broker / lender / developer), current-first, via lcc_party_history.
// Complements the economics-rich Ownership tab (this is the all-roles timeline).
const _ENTITY_HISTORY_SECTIONS = [
  { key: 'owns',       title: 'As owner',      note: 'current & prior ownership' },
  { key: 'purchases',  title: 'As buyer',      note: 'assets acquired' },
  { key: 'sells',      title: 'As seller',     note: 'assets sold' },
  { key: 'brokers',    title: 'As broker',     note: 'listings & sales brokered' },
  { key: 'finances',   title: 'As lender',     note: 'assets financed' },
  { key: 'developed',  title: 'As developer',  note: 'assets developed' },
];

function _entityTabHistory() {
  const c = _entityDetailCache || {};
  if (c.history) return _entityRenderHistory(c.history);
  const eid = c.entityId || (c.entity && c.entity.id) || '';
  if (!eid) return '<div class="detail-empty">No entity for history lookup.</div>';
  setTimeout(function(){ _entityLoadHistory(eid); }, 0);
  return '<div id="entityHistHost"><div style="text-align:center;padding:40px;color:var(--text3)"><span class="spinner"></span><p style="margin-top:10px">Loading portfolio & history…</p></div></div>';
}

async function _entityLoadHistory(eid) {
  let data = null;
  try {
    data = await _entityApiFetch('/api/entities?action=history&id=' + encodeURIComponent(eid) + '&per_role=25');
  } catch (_e) { data = null; }
  const c = _entityDetailCache || {};
  const stillHere = (c.entityId || (c.entity && c.entity.id)) === eid;
  if (stillHere) c.history = data || { rows: [], groups: {}, totals: {} };
  const host = document.getElementById('entityHistHost');
  if (host && stillHere) host.innerHTML = _entityRenderHistory(c.history);
}

function _entityRenderHistory(data) {
  const groups = (data && data.groups) || {};
  const totals = (data && data.totals) || {};
  const total = (data && data.count) || 0;
  if (!total) {
    return '<div class="detail-empty">No ownership/transaction history in the graph for this party.</div>';
  }
  let html = '';
  for (const sec of _ENTITY_HISTORY_SECTIONS) {
    const rows = groups[sec.key];
    if (!rows || !rows.length) continue;
    const roleTotal = totals[sec.key] != null ? Number(totals[sec.key]) : rows.length;
    let hdr = esc(sec.title) + ' (' + roleTotal + ')';
    html += '<div class="detail-section"><div class="detail-section-title">' + hdr + '</div>';
    html += '<div style="font-size:10px;color:var(--text3);margin:-2px 0 8px">' + esc(sec.note) + '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px">';
    for (const r of rows) {
      const nm = r.asset_name || '(asset)';
      const loc = (r.city || '') + (r.city && r.state ? ', ' : '') + (r.state || '');
      const cur = !!r.is_current;
      const onclick = r.asset_id ? 'openContact360(\'' + esc(String(r.asset_id)) + '\', {kind:\'entity\'})' : '';
      html += '<div style="padding:9px 11px;background:var(--s2);border:1px solid var(--border);border-radius:8px' + (onclick ? ';cursor:pointer' : '') + '"' + (onclick ? ' onclick="' + onclick + '"' : '') + '>';
      html += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">';
      html += '<div style="font-weight:600;font-size:13px;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(nm) + '</div>';
      html += '<div style="flex-shrink:0"><span style="font-size:9px;padding:1px 7px;border-radius:9px;font-weight:700;' + (cur ? 'background:rgba(34,197,94,0.12);color:var(--green,#22c55e);border:1px solid rgba(34,197,94,0.3)' : 'background:var(--s3);color:var(--text3);border:1px solid var(--border)') + '">' + (cur ? 'CURRENT' : 'PRIOR') + '</span></div>';
      html += '</div>';
      const meta = [];
      if (loc) meta.push(loc);
      if (r.sub_role && r.sub_role !== sec.key && String(r.sub_role).replace(/_/g,' ') !== sec.title.replace(/^As /,'')) meta.push(String(r.sub_role).replace(/_/g, ' '));
      if (r.effective_from) meta.push(esc(_fmtDate(r.effective_from)));
      if (r.effective_to) meta.push('ended ' + esc(_fmtDate(r.effective_to)));
      if (meta.length) html += '<div style="font-size:10px;color:var(--text3);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap">' + meta.map(function(m){return '<span>' + m + '</span>';}).join('') + '</div>';
      html += '</div>';
    }
    if (roleTotal > rows.length) html += '<div style="font-size:10px;color:var(--text3);margin-top:6px">showing ' + rows.length + ' of ' + roleTotal + '</div>';
    html += '</div></div>';
  }
  return html;
}

// ── Entity Activity Tab ──
// Cadence cockpit (Scott ask #3): the NEXT scheduled touchpoint + the SUGGESTED
// touchpoint, above the call/email history, with a one-click Draft touchpoint
// email that runs the existing draft_and_log closed loop (draft, log SF, advance
// cadence). Renders only when the contact is on a cadence.
function _entityCadenceCockpit(cad) {
  if (!cad || !cad.on_cadence) return '';
  const overdue = !!cad.overdue;
  const dueTxt = cad.next_touch_due ? _fmtDate(cad.next_touch_due) : null;
  const nType = (cad.next_touch_type || 'touch');
  const dcolor = overdue ? 'var(--red,#ef4444)' : 'var(--accent)';
  let whenTxt;
  if (dueTxt == null) whenTxt = 'unscheduled';
  else if (cad.days_until_due === 0) whenTxt = 'due today';
  else if (overdue) whenTxt = Math.abs(cad.days_until_due) + 'd overdue · ' + dueTxt;
  else whenTxt = 'in ' + cad.days_until_due + 'd · ' + dueTxt;

  let html = '<div class="detail-section">';
  html += '<div class="detail-section-title">\u{1F4C5} Next touchpoint</div>';
  html += '<div style="padding:12px 14px;background:var(--s2);border:1px solid var(--border);border-left:3px solid ' + dcolor + ';border-radius:8px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">';
  html += '<div style="font-weight:700;font-size:13px;color:var(--text);text-transform:capitalize">' + esc(nType) + '</div>';
  html += '<div style="font-size:12px;font-weight:600;color:' + dcolor + '">' + esc(whenTxt) + '</div>';
  html += '</div>';
  const bits = [];
  if (cad.phase) bits.push('Phase: ' + String(cad.phase).replace(/_/g, ' '));
  if (cad.priority_tier) bits.push('Tier ' + cad.priority_tier);
  if (cad.current_touch != null) bits.push('Touch #' + cad.current_touch);
  if (cad.next_touch_template) bits.push('Suggested: ' + cad.next_touch_template);
  if (bits.length) html += '<div style="font-size:11px;color:var(--text3);margin-top:6px;display:flex;gap:10px;flex-wrap:wrap">' + bits.map(function(b){return '<span>' + esc(b) + '</span>';}).join('') + '</div>';
  const eng = [];
  if (cad.emails_sent != null) eng.push(cad.emails_sent + ' sent');
  if (cad.emails_replied != null) eng.push(cad.emails_replied + ' replied');
  if (cad.calls_connected != null) eng.push(cad.calls_connected + ' calls');
  if (eng.length) html += '<div style="font-size:11px;color:var(--text3);margin-top:4px">' + esc(eng.join(' · ')) + '</div>';
  const unsub = String(cad.unsubscribe_status || '').toLowerCase();
  if (unsub && unsub !== 'subscribed' && unsub !== 'none' && unsub !== 'active') {
    html += '<div style="font-size:11px;color:var(--red,#ef4444);margin-top:6px;font-weight:600">⚠️ ' + esc(cad.unsubscribe_status) + ' — do not email</div>';
  } else {
    html += '<button class="dns-cta" style="margin-top:10px" onclick="_entityDraftAndLog(this)">✍️ Draft touchpoint email →</button>';
    html += '<div id="entityDraftHost" style="margin-top:10px"></div>';
  }
  html += '</div></div>';
  return html;
}

function _entityTabActivity() {
  const cache = _entityDetailCache || {};
  const timeline = cache.timeline || cache.activities || [];
  const activities = timeline;
  const entityId = cache.entityId || (cache.entity && cache.entity.id) || '';
  const _cockpit = _entityCadenceCockpit(cache.cadence);

  // Cortex W3 \u2014 unified relationship: email summary + recent thread sits ABOVE the
  // structured activity_events timeline (which carries calls/SF/meetings/etc.).
  let html = _cockpit + _renderEmailRelationshipCard(cache.emailRel, entityId);

  // Open Tasks (non-completed SF tasks) \u2014 Contact 360 refinement. dia carries no
  // WhatId, so the account (company_name) is the link; the opportunity/deal shows
  // under Marketing follow-ups (Engagement tab).
  const openTasks = cache.openTasks || [];
  if (openTasks.length) {
    html += '<div class="detail-section"><div class="detail-section-title">\u{1F4CC} Open Tasks (' + openTasks.length + ')</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">';
    for (const t of openTasks) {
      html += '<div style="padding:8px 10px;background:var(--s2);border:1px solid var(--border);border-radius:8px">';
      html += '<div style="display:flex;justify-content:space-between;gap:8px"><div style="font-weight:600;font-size:12px;color:var(--text)">' + esc(t.subject || '(task)') + '</div><div style="font-size:10px;color:var(--text3)">' + esc(_fmtDate(t.date)) + '</div></div>';
      html += '<div style="font-size:10px;color:var(--text3);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap">';
      if (t.status) html += '<span style="padding:1px 6px;border-radius:8px;background:var(--s3)">' + esc(t.status) + '</span>';
      if (t.account) html += '<span>Account: ' + esc(t.account) + '</span>';
      if (t.assigned_to) html += '<span>' + esc(t.assigned_to) + '</span>';
      html += '</div></div>';
    }
    html += '</div></div>';
  }

  if (!activities.length) {
    // Broker mode: a broker outside our firm often has no logged LCC/SF touch \u2014
    // surface their brokered-deal intelligence as the activity (item #4).
    if (cache.role === 'broker' && cache.brokerIntel && Number(cache.brokerIntel.total_deals)) {
      const bi = cache.brokerIntel;
      html += '<div class="detail-section"><div class="detail-section-title">Brokered-deal activity</div>';
      html += '<div style="font-size:12px;color:var(--text2);margin:4px 0 8px">No logged LCC / Salesforce touches \u2014 this broker\u2019s activity in our markets is the '
        + Number(bi.total_deals) + ' deal' + (Number(bi.total_deals) === 1 ? '' : 's') + ' they brokered ('
        + Number(bi.represents_sellers || 0) + ' seller-side \u00b7 ' + Number(bi.represents_buyers || 0) + ' buyer-side).</div>';
      html += '<button class="dns-cta" onclick="switchEntityTab(\'Deals\')">See brokered deals \u2192</button></div>';
      return html;
    }
    html += '<div class="detail-empty">No activity yet \u2014 LCC or Salesforce.</div>';
    return html;
  }

  const catIcon = { call: '\u{1F4DE}', email: '\u{1F4E7}', meeting: '\u{1F4C5}', note: '\u{1F4DD}', status_change: '\u{1F504}', assignment: '\u{1F464}', sync: '\u{1F500}', research: '\u{1F50D}', system: '\u{2699}\uFE0F' };

  html += '<div class="detail-section"><div class="detail-section-title">Activity Timeline (' + activities.length + ')</div>';
  html += '<div style="display:flex;flex-direction:column;gap:2px;margin-top:4px">';

  for (const a of activities) {
    // Unified rows carry {source,ts,category,title,body,broker,via,status}; a
    // legacy activity_events row (fallback) carries {occurred_at,category,users,source_type}.
    const date = _fmtDate(a.ts || a.occurred_at || a.created_at);
    const cat = a.category || '';
    const icon = catIcon[cat] || '\u{1F4CB}';
    const isSf = a.source === 'sf';
    const srcColor = isSf ? 'var(--purple)' : 'var(--accent)';
    const catLabel = cat ? cat.replace(/_/g, ' ') : '';
    const broker = a.broker || a.users?.display_name || '';
    // Highlight non-Team-Briggs (other NM broker) activity in amber \u2014 the ROE tell.
    const isTeam = /\b(briggs|sjc)\b/i.test(broker);
    const brokerColor = broker ? (isTeam ? 'var(--green)' : 'var(--amber, #d98c00)') : '';
    const via = a.via || a.source_type || '';

    html += '<div style="padding:10px 12px;border-left:3px solid ' + srcColor + ';margin-left:8px;position:relative">';
    html += '<div style="position:absolute;left:-10px;top:12px;width:14px;height:14px;border-radius:50%;background:var(--s1);border:2px solid ' + srcColor + ';font-size:8px;display:flex;align-items:center;justify-content:center">' + icon + '</div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-weight:600;font-size:13px;color:var(--text)">' + esc(a.title || '(untitled)') + '</div>';
    if (a.body) html += '<div style="font-size:12px;color:var(--text2);margin-top:2px;white-space:pre-wrap;max-height:80px;overflow:hidden">' + esc(a.body) + '</div>';
    html += '<div style="font-size:10px;color:var(--text3);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
    html += '<span style="padding:1px 6px;border-radius:8px;background:' + (isSf ? 'rgba(150,90,220,.16)' : 'var(--s3)') + ';font-weight:600">' + (isSf ? 'SF' : 'LCC') + '</span>';
    if (catLabel) html += '<span style="padding:1px 6px;border-radius:8px;background:var(--s3);text-transform:capitalize">' + esc(catLabel) + '</span>';
    if (broker) html += '<span style="padding:1px 6px;border-radius:8px;background:' + (isTeam ? 'rgba(60,170,90,.16)' : 'rgba(217,140,0,.16)') + ';color:' + brokerColor + ';font-weight:600">' + esc(broker) + '</span>';
    if (a.status) html += '<span>' + esc(a.status) + '</span>';
    if (via && via !== 'manual') html += '<span>via ' + esc(via) + '</span>';
    html += '</div></div>';
    html += '<div style="flex-shrink:0;font-size:11px;color:var(--text3);white-space:nowrap">' + esc(date) + '</div>';
    html += '</div></div>';
  }

  html += '</div></div>';
  return html;
}

// \u2500\u2500 Entity Engagement Tab (Contact 360) \u2500\u2500
// unified_contacts engagement summary + this contact's marketing_leads signals
// (aggregated onto the entity). marketing_leads has no viewed/clicked columns \u2014
// we surface source / activity_type / touchpoint_count / status honestly.
function _entityTabEngagement() {
  const c = _entityDetailCache || {};
  const eng = c.engagement || null;
  const marketing = c.marketing || [];

  let html = '';

  if (eng) {
    const score = eng.score != null ? Number(eng.score) : (eng.engagement_score != null ? Number(eng.engagement_score) : null);
    const touches = eng.total_touches != null ? Number(eng.total_touches) : (eng.total_touchpoints != null ? Number(eng.total_touchpoints) : null);
    const lastAct = eng.last_activity || eng.last_activity_at || eng.last_email || eng.last_call || null;
    const txns = eng.total_transactions != null ? Number(eng.total_transactions) : null;
    const vol = eng.total_volume != null ? Number(eng.total_volume) : null;
    html += '<div class="detail-section"><div class="detail-section-title">\u{1F4CA} Engagement</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:8px 0">';
    html += '<div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px"><div style="font-size:18px;font-weight:700;color:var(--accent)">' + (score != null ? score : '\u2014') + '</div><div class="t-meta3">Score</div></div>';
    html += '<div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px"><div style="font-size:18px;font-weight:700;color:var(--text)">' + (touches != null ? touches : '\u2014') + '</div><div class="t-meta3">Touchpoints</div></div>';
    html += '<div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px"><div style="font-size:13px;font-weight:600;color:var(--text)">' + (lastAct ? esc(_fmtDate(lastAct)) : '\u2014') + '</div><div class="t-meta3">Last activity</div></div>';
    html += '</div>';
    if (txns != null || vol != null) {
      html += '<div style="display:flex;gap:16px;font-size:11px;color:var(--text3)">';
      if (txns != null) html += '<span>Transactions: <strong style="color:var(--text2)">' + txns + '</strong></span>';
      if (vol != null) html += '<span>Volume: <strong style="color:var(--text2)">' + _entityFmtMoney(vol) + '</strong></span>';
      html += '</div>';
    }
    html += '</div>';
  }

  html += '<div class="detail-section"><div class="detail-section-title">\u{1F4E3} Marketing signals (' + marketing.length + ')</div>';
  if (!marketing.length) {
    html += '<div class="detail-empty" style="margin-top:6px">No marketing_leads signals on this contact.</div>';
  } else {
    html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">';
    for (const m of marketing) {
      html += '<div style="padding:8px 10px;background:var(--s2);border-radius:8px">';
      html += '<div style="display:flex;justify-content:space-between;gap:8px"><div style="font-weight:600;font-size:12px;color:var(--text)">' + esc(m.deal_name || m.activity_type || m.source || '(signal)') + '</div><div style="font-size:10px;color:var(--text3)">' + esc(_fmtDate(m.lead_date)) + '</div></div>';
      html += '<div style="font-size:10px;color:var(--text3);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap">';
      if (m.source) html += '<span style="padding:1px 6px;border-radius:8px;background:var(--s3)">' + esc(m.source) + '</span>';
      if (m.activity_type) html += '<span style="padding:1px 6px;border-radius:8px;background:var(--s3)">' + esc(m.activity_type) + '</span>';
      if (m.status) html += '<span>' + esc(m.status) + '</span>';
      if (m.touchpoint_count != null) html += '<span>' + Number(m.touchpoint_count) + ' touches</span>';
      if (m.assigned_to) html += '<span>' + esc(m.assigned_to) + '</span>';
      html += '</div>';
      if (m.activity_detail) html += '<div style="font-size:11px;color:var(--text2);margin-top:3px;max-height:40px;overflow:hidden">' + esc(m.activity_detail) + '</div>';
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// \u2500\u2500 Entity Rules-of-Engagement Tab (Contact 360, Slice 2) \u2500\u2500
// The full ROE verdict + the assessment grid + the "why" reasons, from the
// contact360 endpoint's roe block (computed in api/_shared/roe.js).
function _entityTabRoe() {
  const c = _entityDetailCache || {};
  const roe = c.roe || null;

  if (!roe) {
    return '<div class="detail-empty">Rules of Engagement not available for this contact.</div>';
  }

  const col = _entityRoeColors(roe.verdict);
  let html = '';

  // The headline banner (same colours as the top-of-panel ROE banner).
  html += '<div class="detail-section">';
  html += '<div style="padding:14px 16px;border-radius:10px;background:' + col.bg + ';border:1px solid ' + col.bd + '">';
  html += '<div style="font-size:16px;font-weight:800;color:' + col.fg + '">' + esc(roe.headline || '') + '</div>';
  if (roe.assigned_broker) html += '<div style="font-size:12px;color:var(--text2);margin-top:4px">Assigned broker: <strong>' + esc(roe.assigned_broker) + '</strong>' + (roe.assigned_broker_source ? ' <span style="color:var(--text3)">(' + esc(roe.assigned_broker_source) + ')</span>' : '') + '</div>';
  html += '</div></div>';

  // Assessment grid.
  html += '<div class="detail-section"><div class="detail-section-title">Assessment</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px">';
  const cell = (label, val) => '<div style="padding:10px;background:var(--s2);border-radius:8px"><div class="t-meta3">' + label + '</div><div style="font-size:13px;font-weight:600;color:var(--text);margin-top:2px">' + (val ? esc(val) : '\u2014') + '</div></div>';
  html += cell('Verdict', roe.verdict);
  html += cell('Account status', roe.account_status);
  html += cell('Assigned broker', roe.assigned_broker);
  html += cell('Broker class', roe.assigned_broker_class);
  if (roe.last_firm_touch) {
    const lt = roe.last_firm_touch;
    html += cell('Most recent firm touch', (lt.broker ? lt.broker + ' \u00B7 ' : '') + (lt.date ? _fmtDate(lt.date) : ''));
  }
  html += '</div></div>';

  // The "why" reasons.
  if (Array.isArray(roe.reasons) && roe.reasons.length) {
    html += '<div class="detail-section"><div class="detail-section-title">Why</div>';
    html += '<ul style="margin:6px 0 0 0;padding-left:18px;color:var(--text2);font-size:12px;line-height:1.7">';
    for (const r of roe.reasons) html += '<li>' + esc(r) + '</li>';
    html += '</ul></div>';
  }

  // Honest tip when there is no captured SF OwnerId (verdict rests on the
  // inferred deal-level / classifier signal, not a hard account assignment).
  if (roe.assigned_broker_source !== 'sf_owner') {
    html += '<div class="detail-section"><div style="font-size:11px;color:var(--text3);padding:8px 10px;background:var(--s2);border-radius:8px">No Salesforce account OwnerId on file for this contact yet \u2014 the verdict is inferred from deal-level activity. It sharpens once OwnerId is captured on the SF sync.</div></div>';
  }

  return html;
}

// ── Cortex W3 — Email Relationship card (corrected direction + recent thread) ──
function _renderEmailRelationshipCard(rel, entityId) {
  if (!rel || !rel.email) return '';  // no email on file → nothing to show
  const s = rel.summary || {};
  const total = Number(s.total || 0);
  const sent = Number(s.sent || 0);
  const received = Number(s.received || 0);
  const span = (s.first_at && s.last_at)
    ? _fmtDate(s.first_at) + ' → ' + _fmtDate(s.last_at) : '';

  let html = '<div class="detail-section"><div class="detail-section-title">\u{1F4E7} Email Relationship</div>';

  if (total > 0) {
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:8px 0">';
    html += '<div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px"><div style="font-size:18px;font-weight:700;color:var(--accent)">' + total + '</div><div class="t-meta3">Total</div></div>';
    html += '<div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px"><div style="font-size:18px;font-weight:700;color:var(--green)">' + sent + '</div><div class="t-meta3">You sent</div></div>';
    html += '<div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px"><div style="font-size:18px;font-weight:700;color:var(--purple)">' + received + '</div><div class="t-meta3">Received</div></div>';
    html += '</div>';
    if (span) html += '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">' + esc(rel.email) + ' · ' + esc(span) + '</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--text2);margin:6px 0">No email history pulled yet for ' + esc(rel.email) + '.</div>';
  }

  html += '<button id="cortexPullBtn" onclick="_cortexPullHistory(\'' + esc(entityId) + '\')" style="font-size:11px;padding:6px 12px;border-radius:8px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-weight:600">\u{1F50D} Pull more from Outlook</button>';

  const recent = rel.recent || [];
  if (recent.length) {
    html += '<div style="display:flex;flex-direction:column;gap:1px;margin-top:10px">';
    for (const m of recent) {
      const out = m.dir === 'out';
      const arrow = out ? '<span style="color:var(--green)">↗ sent</span>' : '<span style="color:var(--purple)">↙ recv</span>';
      html += '<div style="padding:8px 10px;border-left:3px solid ' + (out ? 'var(--green)' : 'var(--purple)') + ';margin-left:6px">';
      html += '<div style="display:flex;justify-content:space-between;gap:8px"><div style="font-weight:600;font-size:12px;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.subject || '(no subject)') + '</div><div style="font-size:10px;color:var(--text3);white-space:nowrap">' + esc(_fmtDate(m.received_at)) + '</div></div>';
      html += '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + arrow + (m.from_name ? ' · ' + esc(m.from_name) : '') + '</div>';
      if (m.preview) html += '<div style="font-size:11px;color:var(--text2);margin-top:3px;max-height:34px;overflow:hidden">' + esc(m.preview) + '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

async function _cortexPullHistory(entityId) {
  const btn = document.getElementById('cortexPullBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Queuing…'; }
  try {
    const fetchFn = (typeof LCC_AUTH !== 'undefined' && LCC_AUTH.isAuthenticated) ? LCC_AUTH.apiFetch : fetch;
    const res = await fetchFn('/api/email-relationship?entity_id=' + encodeURIComponent(entityId), { method: 'POST', headers: _entityApiHeaders() });
    const d = await res.json().catch(() => ({}));
    if (btn) btn.textContent = d.queued ? '✓ Queued — pulls on next sync' : (d.error || 'Unable to queue');
  } catch (e) {
    if (btn) { btn.textContent = 'Error — try again'; btn.disabled = false; }
  }
}
window._cortexPullHistory = _cortexPullHistory;

// -- Entity Deal Tab (asset-level living transaction record) ------------------
function _tagVal(x) {
  if (x && typeof x === 'object' && Object.prototype.hasOwnProperty.call(x, 'v')) return x.v;
  return x;
}
function _tagSource(x, fallback) {
  if (x && typeof x === 'object') return x.source || x.derived || x.method || fallback || '';
  return fallback || '';
}
function _dealText(x, fallback) {
  const v = _tagVal(x);
  if (v == null || v === '') return fallback || 'Not on file';
  return String(v);
}
function _dealMoney(x) {
  const v = _tagVal(x);
  if (v == null || v === '') return 'Not on file';
  const n = Number(v);
  return Number.isFinite(n) ? _entityFmtMoney(n) : String(v);
}
function _dealPct(x) {
  const v = _tagVal(x);
  if (v == null || v === '') return 'Not on file';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return (Math.abs(n) <= 1 ? n * 100 : n).toFixed(2).replace(/\.00$/, '') + '%';
}
function _dealDate(x) {
  const v = _tagVal(x);
  return v ? _fmtDate(v) : 'Not on file';
}
function _dealSourceNote(x, fallback) {
  const s = _tagSource(x, fallback);
  return s ? '<span style="font-size:10px;color:var(--text3);font-weight:400"> · ' + esc(s) + '</span>' : '';
}
function _dealMetric(label, value, source, tone) {
  const col = tone || 'var(--accent)';
  return '<div style="min-width:118px;flex:1;padding:12px;background:var(--s2);border:1px solid var(--border);border-radius:8px">'
    + '<div style="font-size:10px;text-transform:uppercase;font-weight:800;color:' + col + '">' + esc(label) + '</div>'
    + '<div style="font-size:20px;font-weight:800;color:var(--text);margin-top:3px">' + esc(value || 'Not on file') + '</div>'
    + (source ? '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + esc(source) + '</div>' : '')
    + '</div>';
}
function _dealSourcePayload(ref, source, label) {
  return encodeURIComponent(JSON.stringify({ ref: ref || null, source: source || null, label: label || null }));
}
function _dealLine(attrs, html) {
  const ref = attrs && (attrs.detail_ref || attrs.source_url || attrs.web_url || attrs.url || attrs.id);
  const src = attrs && (attrs.source || attrs.source_type || attrs.backend);
  const label = attrs && (attrs.title || attrs.subject || attrs.name || attrs.summary || attrs.role || src);
  return '<div ondblclick="_dealOpenSource(decodeURIComponent(\'' + _dealSourcePayload(ref, src, label) + '\'))"'
    + ' title="Double-click to inspect the source"'
    + ' style="padding:9px 11px;background:var(--s2);border:1px solid var(--border);border-radius:8px;cursor:zoom-in">'
    + html + '</div>';
}
function _dealSection(title, body, count) {
  return '<div class="detail-section"><div class="detail-section-title">' + esc(title)
    + (count != null ? ' <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:6px">' + Number(count) + '</span>' : '')
    + '</div>' + body + '</div>';
}
/**
 * O-5 (redesign 2026-08-15 §3.1): a ONE-LINE pointer, not a second snapshot.
 * This used to repeat tenant · guarantor · term · SF — the exact four fields the
 * Property tab already shows two clicks away, on the same panel. A property
 * fact now renders once, on the surface that owns it; the Deal tab names the
 * asset and links across.
 */
function _dealPropertyRef(packet) {
  const meta = packet?.meta || {};
  const ident = packet?.identity || {};
  const label = _dealText(meta.property_label, '') || _dealText(ident.address, '') || '';
  const loc = [_dealText(ident.city, ''), _dealText(ident.state, '')].filter(Boolean).join(', ');
  if (label) return label + (loc ? ' · ' + loc : '');
  return 'Property intelligence lives on the Property tab.';
}
function _dealWhatNext(packet) {
  const ms = packet?.deal?.milestones || [];
  const next = ms.find(m => String(m.status || '').toLowerCase() === 'next') || ms.find(m => /next/i.test(String(m.name || m.summary || '')));
  if (next) {
    const title = next.name || next.summary || 'Next milestone';
    return _dealLine(next, '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--green)">What is next</div>'
      + '<div style="font-size:13px;font-weight:700;color:var(--text);margin-top:2px">' + esc(title) + '</div>'
      + (next.summary && next.summary !== title ? '<div style="font-size:12px;color:var(--text2);margin-top:2px">' + esc(next.summary) + '</div>' : '')
      + '<div style="font-size:10px;color:var(--text3);margin-top:3px">' + esc(_dealDate(next.date)) + _dealSourceNote(next) + '</div>');
  }
  const cad = packet?.deal?.cadence || {};
  const due = _tagVal(cad.next_touch_due);
  return _dealLine({ source: 'touchpoint_cadence', title: 'Next touch' },
    '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--green)">What is next</div>'
    + '<div style="font-size:13px;font-weight:700;color:var(--text);margin-top:2px">'
    + esc(_dealText(cad.next_touch_type, 'Confirm next transaction step')) + '</div>'
    + '<div style="font-size:10px;color:var(--text3);margin-top:3px">' + esc(due ? _fmtDate(due) : 'No due date on file') + '</div>');
}
function _dealSourceStatusClass(status) {
  const s = String(status || '').toLowerCase();
  if (/linked|source|entity/.test(s)) return { bg: 'rgba(34,197,94,0.12)', fg: 'var(--green,#22c55e)', bd: 'rgba(34,197,94,0.35)' };
  if (/no_|not|gap|none/.test(s)) return { bg: 'rgba(239,68,68,0.10)', fg: 'var(--red,#ef4444)', bd: 'rgba(239,68,68,0.28)' };
  return { bg: 'var(--s3)', fg: 'var(--text2)', bd: 'var(--border)' };
}
function _dealConnectedSources(packet) {
  const srcs = packet?.deal?.connected_sources || {};
  const labels = [
    ['costar', 'CoStar'],
    ['salesforce', 'Salesforce'],
    ['outlook', 'Outlook'],
    ['sharefile', 'Sharefile'],
    ['deal_spine', 'Deal spine'],
  ];
  let html = '<div style="display:flex;flex-wrap:wrap;gap:8px">';
  for (const pair of labels) {
    const key = pair[0], label = pair[1], status = srcs[key] || 'not_linked';
    const col = _dealSourceStatusClass(status);
    html += '<button onclick="_dealInspectSource(\'' + esc(key) + '\')"'
      + ' style="border:1px solid ' + col.bd + ';background:' + col.bg + ';color:' + col.fg + ';border-radius:8px;padding:8px 10px;cursor:pointer;text-align:left;min-width:118px">'
      + '<div style="font-size:10px;font-weight:800;text-transform:uppercase">' + esc(label) + '</div>'
      + '<div style="font-size:11px;margin-top:2px">' + esc(String(status).replace(/_/g, ' ')) + '</div></button>';
  }
  html += '</div>';
  return html;
}
function _entityTabPropertyRef() {
  const c = _entityDetailCache || {};
  const packet = c.dealPacket || null;
  if (!packet) return _entityTabPortfolio();
  const meta = packet.meta || {};
  const ident = packet.identity || {};
  const tenancy = packet.tenancy_lease || {};
  const valuation = packet.valuation || {};
  const loc = packet.location || {};
  const propClick = meta.domain && meta.property_id != null
    ? "openUnifiedDetail('" + esc(meta.domain) + "', {property_id:'" + esc(String(meta.property_id)) + "'})"
    : '';
  let html = '';
  html += '<div class="detail-section"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">';
  html += '<div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:800;color:var(--text)">' + esc(meta.property_label || meta.title || 'Property') + '</div>';
  html += '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + esc([meta.domain && meta.domain.toUpperCase(), meta.property_id != null && ('property ' + meta.property_id), meta.subtitle].filter(Boolean).join(' · ')) + '</div></div>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
  html += '<button class="dns-cta" onclick="switchEntityTab(\'Deal\')">See Deal</button>';
  if (propClick) html += '<button class="dns-cta" onclick="' + propClick + '">Open full property</button>';
  html += '</div></div></div>';

  html += _dealSection('Property Snapshot',
    '<div class="detail-grid">'
    + _row('Address', _dealText(loc.address, meta.title || meta.property_label))
    + _row('Tenant', _dealText(tenancy.tenant, 'Not on file'))
    + _row('Guarantor', _dealText(tenancy.guarantor, 'Not on file'))
    + _row('Building SF', _dealText(ident.building_sf, 'Not on file'))
    + _row('Current rent', _dealMoney(tenancy.current_base_rent || tenancy.annual_base_rent))
    + _row('Term remaining', _dealText(tenancy.term_remaining_years, 'Not on file'))
    + _row('Estimated value', _dealMoney(valuation.estimated_value || valuation.value))
    + '</div>');

  const parties = Array.isArray(packet?.deal?.parties) ? packet.deal.parties : [];
  if (parties.length) {
    const byRole = {};
    parties.forEach(p => {
      const k = p.role || p.side || 'party';
      (byRole[k] = byRole[k] || []).push(p);
    });
    html += _dealSection('Contacts by Role',
      Object.keys(byRole).map(role => '<div style="margin-bottom:10px">'
        + '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:5px">' + esc(String(role).replace(/_/g, ' ')) + '</div>'
        + '<div style="display:flex;flex-direction:column;gap:6px">'
        + byRole[role].map(p => {
          const pid = p.party_entity_id || p.entity_id || null;
          const click = pid ? "openContact360('" + esc(String(pid)) + "', {kind:'entity'})" : '';
          return '<div style="padding:9px 11px;background:var(--s2);border:1px solid var(--border);border-radius:8px' + (click ? ';cursor:pointer' : '') + '"' + (click ? ' onclick="' + click + '"' : '') + '>'
            + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">'
            + '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.company?.v || p.company || p.name || 'Party') + '</div>'
            + '<div style="font-size:11px;color:var(--text2)">' + esc([p.side, p.flag, p.source].filter(Boolean).join(' · ') || 'Not on file') + '</div></div>'
            + (pid ? '<span style="font-size:10px;color:var(--accent);white-space:nowrap">Contact</span>' : '<span style="font-size:10px;color:var(--text3);white-space:nowrap">Not on file</span>')
            + '</div></div>';
        }).join('')
        + '</div></div>').join(''));
  } else {
    html += _dealSection('Contacts by Role', '<div class="detail-empty">No owner, broker, attorney, title, or lender contacts are linked to this property yet.</div>');
  }

  const docs = Array.isArray(packet.documents) ? packet.documents : [];
  if (docs.length) {
    html += _dealSection('Property Documents',
      '<div style="display:flex;flex-direction:column;gap:6px">' + docs.slice(0, 6).map(d => _dealLine(d,
        '<div style="font-size:12px;font-weight:700;color:var(--text)">' + esc(d.name || d.file_name || d.type || 'Document') + '</div>'
        + '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + esc([d.type, d.source, d.date && _fmtDate(d.date), d.reconciled_status].filter(Boolean).join(' · ')) + '</div>')).join('') + '</div>', docs.length);
  }
  html += _dealSection('Dossiers',
    '<div style="display:flex;gap:8px;flex-wrap:wrap">'
    + '<button class="dns-cta" onclick="_entityGenerateDossier(\'property\', this)">Property Dossier</button>'
    + '<button class="dns-cta" onclick="_entityGenerateDossier(\'deal\', this)">Deal Dossier</button>'
    + '</div>');
  return html;
}
function _entityTabDeal() {
  const c = _entityDetailCache || {};
  const packet = c.dealPacket || null;
  if (!packet) return '<div class="detail-empty">No deal packet is linked to this entity yet.</div>';
  const deal = packet.deal || {};
  const meta = packet.meta || {};
  const txns = Array.isArray(packet.transactions) ? packet.transactions : [];
  const latestTxn = txns.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0] || {};
  const timeline = Array.isArray(packet.transaction_marketing_timeline) ? packet.transaction_marketing_timeline : [];
  const latestListing = timeline.slice().reverse().find(x => x && x.kind === 'listing') || {};
  const stage = _dealText(deal.stage, latestTxn.date ? 'Closed' : 'Deal');
  const price = latestTxn.price != null ? latestTxn.price : latestListing.asking_price;
  const cap = latestTxn.calculated_cap_rate || latestTxn.stated_cap_rate || latestListing.cap_rate || packet?.valuation?.cap_rate;
  const fee = deal.commission && deal.commission.length ? (deal.commission[0].fee_on_transaction || deal.commission[0].fee || deal.commission[0].amount) : null;
  const freshness = deal.correspondence_summary?.as_of || latestTxn.date || latestListing.date || meta.generated_at || null;
  const propClick = meta.domain && meta.property_id != null
    ? "openUnifiedDetail('" + esc(meta.domain) + "', {property_id:'" + esc(String(meta.property_id)) + "'})"
    : '';

  let html = '';
  html += '<div class="detail-section"><div style="display:flex;gap:10px;flex-wrap:wrap">';
  html += _dealMetric('Stage', stage, _tagSource(deal.stage, latestTxn.date ? 'sales_transactions' : ''), 'var(--green)');
  html += _dealMetric('Price', _dealMoney(price), _tagSource(price, latestTxn.source || 'sales/listing'), 'var(--accent)');
  html += _dealMetric('In-place cap', _dealPct(cap), _tagSource(cap, 'derived'), 'var(--purple)');
  html += _dealMetric('Team Briggs fee', fee ? _dealMoney(fee) : 'Not on file', fee ? _tagSource(fee, 'commission') : 'from ELA/SF', 'var(--yellow,#d98c00)');
  html += '</div><div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:10px">';
  html += '<span style="font-size:11px;color:var(--text3);padding:3px 8px;border:1px solid var(--border);border-radius:12px;background:var(--s2)">freshness: ' + esc(freshness ? _fmtDate(freshness) : 'Not on file') + '</span>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
  html += '<button class="dns-cta" onclick="switchEntityTab(\'Property\')">See property</button>';
  html += '<button class="dns-cta" onclick="_entityGenerateDossier(\'deal\', this)">Deal Dossier</button>';
  html += '</div></div></div>';

  html += _dealSection('Transaction Story & Milestones',
    _dealWhatNext(packet)
    + '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">'
    + (Array.isArray(deal.milestones) && deal.milestones.length
      ? deal.milestones.map(m => _dealLine(m,
          '<div style="display:flex;justify-content:space-between;gap:8px"><div style="font-size:12px;font-weight:700;color:var(--text)">' + esc(m.name || m.summary || 'Milestone') + '</div>'
          + '<div style="font-size:10px;color:var(--text3);white-space:nowrap">' + esc(_dealDate(m.date)) + '</div></div>'
          + (m.summary && m.name !== m.summary ? '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + esc(m.summary) + '</div>' : '')
          + '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + esc(m.status || '') + _dealSourceNote(m) + '</div>')).join('')
      : timeline.slice(-4).reverse().map(m => _dealLine(m,
          '<div style="display:flex;justify-content:space-between;gap:8px"><div style="font-size:12px;font-weight:700;color:var(--text)">' + esc(m.event || m.kind || 'Transaction event') + '</div>'
          + '<div style="font-size:10px;color:var(--text3);white-space:nowrap">' + esc(_dealDate(m.date)) + '</div></div>'
          + '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + esc([_dealMoney(m.price || m.asking_price), _dealPct(m.calculated_cap_rate || m.stated_cap_rate || m.cap_rate), m.broker && _dealText(m.broker, '')].filter(Boolean).join(' · ')) + '</div>')).join(''))
    + '</div>');

  const comm = Array.isArray(deal.commission) ? deal.commission : [];
  html += _dealSection('Commission',
    comm.length ? '<div style="display:flex;flex-direction:column;gap:6px">' + comm.map(r => _dealLine(r,
      '<div style="font-size:12px;font-weight:700;color:var(--text)">' + esc(r.stage_basis || r.basis || r.name || 'Commission basis') + '</div>'
      + '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + esc([r.direct_pct != null && 'Direct ' + _dealPct(r.direct_pct), r.co_broker_pct != null && 'Co-broker ' + _dealPct(r.co_broker_pct), r.split && 'Split ' + _dealText(r.split, '')].filter(Boolean).join(' · ') || 'Structure Not on file') + '</div>'
      + '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + esc(r.source || 'commission spine') + '</div>')).join('') + '</div>'
      : '<div class="detail-empty">Commission structure is Not on file until the ELA/Salesforce record is linked.</div>');

  const parties = Array.isArray(deal.parties) ? deal.parties : [];
  const bySide = {};
  parties.forEach(p => { const k = p.side || 'other'; (bySide[k] = bySide[k] || []).push(p); });
  html += _dealSection('Parties by Company',
    parties.length ? Object.keys(bySide).map(side => '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--text3);margin-bottom:5px">' + esc(side.replace(/_/g, ' ')) + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:6px">' + bySide[side].map(p => {
        const pid = p.party_entity_id || p.entity_id || null;
        const contactBtn = pid ? '<button class="dns-cta" style="padding:3px 8px;font-size:10px" onclick="event.stopPropagation();openContact360(\'' + esc(String(pid)) + '\', {kind:\'entity\'})">Contact</button>' : '';
        return _dealLine(p,
          '<div style="display:flex;justify-content:space-between;gap:8px"><div style="font-size:12px;font-weight:700;color:var(--text)">' + esc(p.company?.v || p.company || p.name || 'Party') + '</div>'
          + '<div style="display:flex;gap:6px;align-items:center"><span style="font-size:10px;color:var(--text3);white-space:nowrap">' + esc(p.role || 'party') + '</span>' + contactBtn + '</div></div>'
          + '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + esc([p.flag, p.effective_from && ('from ' + _fmtDate(p.effective_from)), p.source].filter(Boolean).join(' · ') || 'Role source Not on file') + '</div>');
      }).join('') + '</div></div>').join('')
      : '<div class="detail-empty">No parties sourced from Salesforce, Outlook, Sharefile, or the deal spine yet.</div>');

  const diligence = Array.isArray(deal.diligence) ? deal.diligence : [];
  html += _dealSection('Diligence & Vendors',
    diligence.length ? '<div style="display:flex;flex-direction:column;gap:6px">' + diligence.map(d => _dealLine(d,
      '<div style="display:flex;justify-content:space-between;gap:8px"><div style="font-size:12px;font-weight:700;color:var(--text)">' + esc(d.vendor || d.type || 'Vendor') + '</div>'
      + '<div style="font-size:10px;color:' + (d.lender_required ? 'var(--yellow,#d98c00)' : 'var(--text3)') + ';white-space:nowrap">' + esc(d.lender_required ? 'lender required' : (d.status || 'tracked')) + '</div></div>'
      + '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + esc([d.type, d.ordered_date && ('ordered ' + _fmtDate(d.ordered_date)), d.site_visit_date && ('site ' + _fmtDate(d.site_visit_date)), d.report_eta && ('ETA ' + _fmtDate(d.report_eta)), d.completed_date && ('done ' + _fmtDate(d.completed_date))].filter(Boolean).join(' · ') || 'Dates Not on file') + '</div>')).join('') + '</div>'
      : '<div class="detail-empty">Survey, PCA, Phase I, appraisal, and lender report tracking are Not on file.</div>');

  const corr = Array.isArray(deal.correspondence) ? deal.correspondence : [];
  const summary = deal.correspondence_summary && (_tagVal(deal.correspondence_summary.summary) || deal.correspondence_summary.summary || deal.correspondence_summary.v);
  html += _dealSection('Correspondence Summary',
    (summary ? _dealLine(deal.correspondence_summary, '<div style="font-size:12px;color:var(--text2);line-height:1.5">' + esc(summary) + '</div>') : '<div class="detail-empty">No living correspondence rollup is linked yet.</div>')
    + (corr.length ? '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">' + corr.slice(0, 8).map(m => _dealLine(m,
      '<div style="display:flex;justify-content:space-between;gap:8px"><div style="font-size:12px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.subject || '(no subject)') + '</div>'
      + '<div style="font-size:10px;color:var(--text3);white-space:nowrap">' + esc(_dealDate(m.date)) + '</div></div>'
      + '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + esc([m.direction, m.source].filter(Boolean).join(' · ')) + '</div>')).join('') + '</div>' : ''));

  html += _dealSection('Connected Sources', _dealConnectedSources(packet));

  const docs = Array.isArray(deal.documents) ? deal.documents : [];
  if (docs.length) html += _dealSection('Documents', '<div style="display:flex;flex-direction:column;gap:6px">' + docs.slice(0, 10).map(d => _dealLine(d,
    '<div style="font-size:12px;font-weight:700;color:var(--text)">' + esc(d.name || d.file_name || d.type || 'Document') + '</div>'
    + '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + esc([d.type, d.source, d.date && _fmtDate(d.date), d.reconciled === true ? 'reconciled' : 'not reconciled'].filter(Boolean).join(' · ')) + '</div>')).join('') + '</div>', docs.length);

  const issues = [];
  if (Array.isArray(deal.conflicts)) issues.push(...deal.conflicts.map(x => ({ topic: x.field || 'Conflict', summary: x.summary || x.note || 'Source conflict is open', source: x.source || 'lcc_deal_conflict' })));
  if (Array.isArray(packet?.valuation?._conflicts)) issues.push(...packet.valuation._conflicts.map(x => ({ topic: x.field || 'Valuation conflict', summary: 'Reconciled value differs across sources', source: 'valuation' })));
  const srcs = deal.connected_sources || {};
  Object.keys(srcs).forEach(k => { if (/no_|not_linked|none/.test(String(srcs[k]))) issues.push({ topic: k, summary: String(srcs[k]).replace(/_/g, ' '), source: 'connected_sources' }); });
  html += _dealSection('Open Issues',
    issues.length ? '<div style="display:flex;flex-direction:column;gap:6px">' + issues.map(i => _dealLine(i,
      '<div style="font-size:12px;font-weight:700;color:var(--text)">' + esc(i.topic || 'Issue') + '</div>'
      + '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + esc(i.summary || 'Open') + '</div>'
      + '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + esc(i.owner || i.source || '') + '</div>')).join('') + '</div>'
      : '<div class="detail-empty">No open deal issues on file.</div>');

  html += _dealSection('Property Reference',
    '<div style="font-size:12px;color:var(--text2);line-height:1.5">' + esc(_dealPropertyRef(packet)) + '</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="dns-cta" onclick="switchEntityTab(\'Property\')">Open Property tab</button>'
    + (propClick ? '<button class="dns-cta" onclick="' + propClick + '">Open full property</button>' : '') + '</div>');
  return html;
}

function _dealOpenSource(payloadJson) {
  let p = {};
  try { p = JSON.parse(payloadJson || '{}'); } catch (_e) { p = {}; }
  const ref = p.ref || '';
  if (/^https?:\/\//i.test(ref)) { window.open(ref, '_blank', 'noopener'); return; }
  if (/^mailto:/i.test(ref)) { window.location.href = ref; return; }
  const msg = [p.source || 'source', ref || p.label || 'No direct link on file'].filter(Boolean).join(': ');
  if (typeof showToast === 'function') showToast(msg, 'info');
}
window._dealOpenSource = _dealOpenSource;

function _dealInspectSource(key) {
  const packet = _entityDetailCache && _entityDetailCache.dealPacket;
  const status = packet && packet.deal && packet.deal.connected_sources ? packet.deal.connected_sources[key] : null;
  if (key === 'salesforce') {
    const sf = _tagVal(packet?.deal?.sf_opportunity_id);
    if (sf) { window.open(_SF_BASE + '/lightning/r/Opportunity/' + encodeURIComponent(sf) + '/view', '_blank', 'noopener'); return; }
  }
  if (typeof showToast === 'function') showToast(key + ': ' + (status || 'not linked'), 'info');
}
window._dealInspectSource = _dealInspectSource;


// ═════════════════════════════════════════════════════════════════════════════
// W6.5 Stage 2, Unit 5 (2026-08-20) — the REST of the entity tab bodies.
// Moved VERBATIM from detail.js lines 13854-14198.
//
// Unit 4 took 7 tab bodies; a second block sat further down the file and was
// left behind — found by asking the file, not the map, which _entityTab*
// renderers were still in detail.js. This closes that gap:
//   _entityGenerateDossier / _entityOpenDossierMenu  (the dossier menu these
//                                                     tabs render)
//   _entityTabContactDeals · _entityTabBrokerDeals
//   _entityTabPortfolio    · _entityTabContacts
//
// The shared completeness-rail / Next-Step chrome that follows it in detail.js
// deliberately did NOT come: it writes the SAME persistent DOM nodes as the
// property panel (#detailCompletenessRail / #detailNextStep) and so belongs
// with the shell, not with tab content.
// ═════════════════════════════════════════════════════════════════════════════

async function _entityGenerateDossier(kind, btn) {
  const c = _entityDetailCache || {};
  const eid = c.entityId || (c.entity && c.entity.id);
  if (!eid) return;
  const w = (typeof window !== 'undefined') ? window.open('', '_blank') : null;
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Building...'; }
  try {
    const d = await _udApiPost('/api/entities?action=generate_dossier', { entity_id: eid, kind: kind === 'deal' ? 'deal' : 'property' });
    if (d && d.ok && d.signed_url) {
      if (w) w.location.href = d.signed_url; else window.open(d.signed_url, '_blank');
    } else {
      if (w) w.close();
      if (typeof showToast === 'function') showToast('Could not build ' + kind + ' dossier', 'error');
    }
  } catch (_e) {
    if (w) w.close();
    if (typeof showToast === 'function') showToast('Could not build ' + kind + ' dossier', 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = orig; }
}
window._entityGenerateDossier = _entityGenerateDossier;

function _entityOpenDossierMenu(btn) {
  const old = document.getElementById('entityDossierMenu');
  if (old) { old.remove(); return; }
  const c = _entityDetailCache || {};
  const hasDeal = !!c.dealPacket;
  const menu = document.createElement('div');
  menu.id = 'entityDossierMenu';
  menu.style.cssText = 'position:fixed;z-index:10000;background:var(--s1);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.22);padding:6px;min-width:170px';
  const add = function(label, kind) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'display:block;width:100%;text-align:left;background:transparent;border:0;color:var(--text);padding:8px 10px;border-radius:6px;cursor:pointer;font-size:12px';
    b.onclick = function() { menu.remove(); _entityGenerateDossier(kind, btn); };
    menu.appendChild(b);
  };
  add('Property Dossier', 'property');
  if (hasDeal) add('Deal Dossier', 'deal');
  document.body.appendChild(menu);
  const r = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 20, bottom: 60 };
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 190)) + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  setTimeout(function() {
    const close = function(e) { if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener('mousedown', close); } };
    document.addEventListener('mousedown', close);
  }, 0);
}
window._entityOpenDossierMenu = _entityOpenDossierMenu;

// Contact/org Deals tab — reverse read from lcc_contact_deals plus Northmarq
// closed-sale augmentation from domain sales_transactions. Every row is backed
// by an asset identity or a bd_opportunities/sales_transactions record.
function _entityTabContactDeals() {
  const c = _entityDetailCache || {};
  const rows = Array.isArray(c.contactDeals) ? c.contactDeals : [];
  let html = '';

  if (c.role === 'broker' && c.brokerIntel && Number(c.brokerIntel.total_deals || 0)) {
    html += _entityTabBrokerDeals();
  }

  if (!rows.length) {
    return html || '<div class="detail-empty">No active or closed deals are linked to this contact yet.</div>';
  }

  const active = (c.contactDealsByStatus && Array.isArray(c.contactDealsByStatus.active)) ? c.contactDealsByStatus.active : rows.filter(d => d.is_open);
  const closed = (c.contactDealsByStatus && Array.isArray(c.contactDealsByStatus.closed)) ? c.contactDealsByStatus.closed : rows.filter(d => !d.is_open);

  html += '<div class="detail-section"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">';
  const tile = (v, l, col) => '<div style="text-align:center;padding:12px;background:var(--s2);border-radius:8px"><div style="font-size:20px;font-weight:700;color:' + col + '">' + v + '</div><div class="t-meta3">' + l + '</div></div>';
  html += tile(rows.length, 'Linked deals', 'var(--accent)');
  html += tile(active.length, 'Active', 'var(--green)');
  html += tile(closed.length, 'Closed', 'var(--text2)');
  html += '</div></div>';

  const renderGroup = function(label, arr) {
    if (!arr.length) return '';
    let out = '<div class="detail-section"><div class="detail-section-title">' + esc(label) + ' (' + arr.length + ')</div>';
    out += '<div style="display:flex;flex-direction:column;gap:6px">';
    for (const d of arr) {
      const click = _entityContactDealClick(d);
      const title = d.deal_name || d.asset_name || d.address || 'Deal';
      const prop = [d.domain && d.domain.toUpperCase(), d.property_id, d.address].filter(Boolean).join(' · ');
      const status = d.is_open ? (d.stage || 'Active') : (d.sale_date || d.closed_at ? 'Closed ' + _fmtDate(d.sale_date || d.closed_at) : 'Closed');
      out += '<div style="padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px' + (click ? ';cursor:pointer' : '') + '"' + (click ? ' onclick="' + click + '"' : '') + '>';
      out += '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">';
      out += '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(title) + '</div>';
      out += '<div style="font-size:11px;color:var(--text2)">' + esc([d.role_label || d.role, prop, d.via_relationship && d.via_relationship !== 'direct' ? ('via ' + (d.subject_name || 'company')) : ''].filter(Boolean).join(' · ') || 'Not on file') + '</div>';
      if (d.next_action) out += '<div style="font-size:11px;color:var(--accent);margin-top:3px">Next: ' + esc(d.next_action) + '</div>';
      out += '</div><div style="text-align:right;flex-shrink:0"><div style="font-size:10px;color:' + (d.is_open ? 'var(--green)' : 'var(--text3)') + '">' + esc(status) + '</div>';
      if (d.amount != null) out += '<div style="font-size:10px;color:var(--accent);margin-top:2px">' + esc(_entityFmtMoney(d.amount)) + '</div>';
      out += '<div style="font-size:9px;color:var(--text3);margin-top:2px">' + esc(d.source || '') + '</div></div></div></div>';
    }
    out += '</div></div>';
    return out;
  };

  html += renderGroup('Active deals', active);
  html += renderGroup('Closed deals', closed);
  return html;
}

// ── Entity Deals Tab (Broker mode) ──
// Replaces owner-portfolio for a broker: how many deals brokered in our target
// markets + who they represent (SELLERS via listing_broker / BUYERS via
// buyer_broker — the signal is on the LCC `brokers` edge, no cross-DB name-match).
function _entityTabBrokerDeals() {
  const c = _entityDetailCache || {};
  const bi = c.brokerIntel || null;
  if (!bi || !Number(bi.total_deals)) {
    return '<div class="detail-empty">No brokered deals linked to this broker in our target markets yet.</div>';
  }

  let html = '';

  // Headline tiles: total deals + representation split.
  html += '<div class="detail-section"><div class="detail-section-title">Deals brokered — our markets</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:4px">';
  const tile = (v, l, col) => '<div style="text-align:center;padding:12px;background:var(--s2);border-radius:8px"><div style="font-size:20px;font-weight:700;color:' + col + '">' + v + '</div><div class="t-meta3">' + l + '</div></div>';
  html += tile(Number(bi.total_deals || 0), 'Deals', 'var(--accent)');
  html += tile(Number(bi.represents_sellers || 0), 'Represents sellers', 'var(--green)');
  html += tile(Number(bi.represents_buyers || 0), 'Represents buyers', 'var(--purple)');
  html += '</div>';
  if (Number(bi.represents_unknown)) {
    html += '<div style="font-size:11px;color:var(--text3);margin-top:6px">' + Number(bi.represents_unknown) + ' deal(s) with unrecorded side.</div>';
  }
  html += '</div>';

  // Target markets (states of the brokered assets).
  const markets = Array.isArray(bi.markets) ? bi.markets : [];
  if (markets.length) {
    html += '<div class="detail-section"><div class="detail-section-title">Target markets</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">';
    for (const m of markets) {
      html += '<span style="font-size:11px;padding:3px 9px;border-radius:8px;background:var(--s3);color:var(--text2);border:1px solid var(--border)">'
        + esc(m.state) + ' <strong style="color:var(--text)">' + Number(m.count) + '</strong></span>';
    }
    html += '</div></div>';
  }

  // Recent brokered deals.
  const recent = Array.isArray(bi.recent_deals) ? bi.recent_deals : [];
  if (recent.length) {
    html += '<div class="detail-section"><div class="detail-section-title">Recent deals (' + recent.length + ')</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">';
    for (const d of recent) {
      const loc = (d.city || '') + (d.city && d.state ? ', ' : '') + (d.state || '');
      const sideColor = d.role === 'seller' ? 'var(--green)' : d.role === 'buyer' ? 'var(--purple)' : 'var(--text3)';
      const sideLabel = d.role === 'seller' ? 'listing (seller)' : d.role === 'buyer' ? 'procuring (buyer)' : 'side n/a';
      html += '<div style="padding:9px 11px;background:var(--s2);border:1px solid var(--border);border-radius:8px">';
      html += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">';
      html += '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(d.name || '(property)') + '</div>';
      if (loc) html += '<div style="font-size:11px;color:var(--text2)">' + esc(loc) + '</div>';
      html += '</div>';
      html += '<span style="font-size:10px;padding:1px 7px;border-radius:8px;background:var(--s3);color:' + sideColor + ';font-weight:600;white-space:nowrap">' + esc(sideLabel) + '</span>';
      html += '</div></div>';
    }
    html += '</div></div>';
  }

  return html;
}

// ── Entity Portfolio Tab (UI Phase 4B — authoritative BD-spine portfolio) ──
// Sourced from lcc_entity_portfolio_facts ⋈ lcc_property_attributes (via
// /api/entities?action=portfolio), NOT a fuzzy v_ownership_current name-match.
// A rollup header (count / Σ rent / domains) over a per-property list where each
// row is a 4A zoom target — openUnifiedDetail PUSHes onto the back-stack.
function _entityTabPortfolio() {
  const c = _entityDetailCache;
  const portfolio = c?.portfolio || [];
  const rollup = c?.rollup || null;

  let html = '';

  // Rollup header (matches the queue/P-BUYER rollup the owner ranks on).
  if (rollup) {
    const total = rollup.total_property_count != null ? Number(rollup.total_property_count) : portfolio.length;
    const current = rollup.current_property_count != null ? Number(rollup.current_property_count) : null;
    const rent = rollup.current_annual_rent_total != null ? Number(rollup.current_annual_rent_total) : null;
    const domains = [];
    if (rollup.dia_property_count) domains.push(Number(rollup.dia_property_count) + ' DIA');
    if (rollup.gov_property_count) domains.push(Number(rollup.gov_property_count) + ' GOV');
    html += '<div class="detail-section"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">';
    html += '<div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px"><div style="font-size:18px;font-weight:700;color:var(--accent)">' + total + '</div><div class="t-meta3">Properties' + (current != null && current !== total ? ' (' + current + ' current)' : '') + '</div></div>';
    html += '<div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px"><div style="font-size:16px;font-weight:700;color:var(--green)">' + _entityFmtMoney(rent) + '</div><div class="t-meta3">Annual Rent</div></div>';
    html += '<div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px"><div style="font-size:13px;font-weight:600;color:var(--text)">' + (domains.length ? esc(domains.join(' · ')) : '—') + '</div><div class="t-meta3">Mix</div></div>';
    html += '</div></div>';
  }

  // Developed section (Contact 360) — properties this owner is recorded as having
  // DEVELOPED (the `developed` relationship / ownership-chain / owner_parent),
  // resolved to names by the contact360 endpoint. Distinct from current ownership.
  const developed = c?.developed || [];
  if (developed.length) {
    html += '<div class="detail-section"><div class="detail-section-title">\u{1F3D7}️ Developed (' + developed.length + ')</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">';
    for (let di = 0; di < developed.length; di++) {
      const d = developed[di];
      const db = (d.source_domain === 'gov' || d.source_domain === 'government') ? 'gov' : (d.source_domain === 'dia' || d.source_domain === 'dialysis' ? 'dia' : '');
      const pid = d.property_id != null ? d.property_id : d.source_property_id;
      const nm = d.name || d.address || d.label || '(property)';
      // Prefer opening the linked entity (developed edges resolve to entities);
      // fall back to a companion property dock when a property id is present.
      let onclick = '';
      if (d.entity_id) onclick = 'openContact360(\'' + esc(String(d.entity_id)) + '\', {kind:\'entity\'})';
      else if (db && pid != null) onclick = '_entityDrillProperty(\'' + esc(db) + '\', \'' + esc(String(pid)) + '\', \'developed\', ' + di + ')';
      const clickable = !!onclick;
      html += '<div style="padding:8px 10px;background:var(--s2);border:1px solid var(--border);border-radius:8px;' + (clickable ? 'cursor:pointer' : '') + '"';
      if (clickable) html += ' onclick="' + onclick + '"';
      html += '>';
      html += '<div style="font-weight:600;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(nm) + '</div>';
      if (d.city || d.state) html += '<div style="font-size:11px;color:var(--text2)">' + esc((d.city || '') + (d.city && d.state ? ', ' : '') + (d.state || '')) + '</div>';
      html += '</div>';
    }
    html += '</div></div>';
  }

  // Person-level ownership / linked properties (Contact 360 refinement) — a person
  // usually owns via their affiliated org, not directly. Show direct owner edges +
  // the affiliated org's BD portfolio (resolved by the contact360 endpoint).
  const owned = c?.ownedProperties || null;
  if (owned && ((owned.direct && owned.direct.length) || (owned.affiliated && owned.affiliated.properties && owned.affiliated.properties.length))) {
    if (owned.direct && owned.direct.length) {
      html += '<div class="detail-section"><div class="detail-section-title">\u{1F511} Owns directly (' + owned.direct.length + ')</div>';
      html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">';
      for (const d of owned.direct) {
        const onclick = d.entity_id ? 'openContact360(\'' + esc(String(d.entity_id)) + '\', {kind:\'entity\'})' : '';
        html += '<div style="padding:8px 10px;background:var(--s2);border:1px solid var(--border);border-radius:8px' + (onclick ? ';cursor:pointer' : '') + '"' + (onclick ? ' onclick="' + onclick + '"' : '') + '>';
        html += '<div style="font-weight:600;font-size:12px;color:var(--text)">' + esc(d.name || '(property)') + '</div>';
        if (d.city || d.state) html += '<div style="font-size:11px;color:var(--text2)">' + esc((d.city || '') + (d.city && d.state ? ', ' : '') + (d.state || '')) + '</div>';
        html += '</div>';
      }
      html += '</div></div>';
    }
    const aff = owned.affiliated;
    if (aff && aff.properties && aff.properties.length) {
      const orgClick = aff.org_entity_id ? ' onclick="openContact360(\'' + esc(String(aff.org_entity_id)) + '\', {kind:\'entity\'})" style="cursor:pointer"' : '';
      html += '<div class="detail-section"><div class="detail-section-title"' + orgClick + '>\u{1F3E2} Via ' + esc(aff.org_name || 'affiliated company') + ' (' + aff.properties.length + ')</div>';
      html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">';
      for (const p of aff.properties) {
        const db = (p.source_domain === 'gov' || p.source_domain === 'government') ? 'gov' : 'dia';
        const pid = p.source_property_id;
        const nm = p.address || p.tenant_label || p.tenant_short || '(property)';
        const onclick = pid != null ? 'openUnifiedDetail(\'' + db + '\', {property_id:\'' + esc(String(pid)) + '\'})' : '';
        html += '<div style="padding:8px 10px;background:var(--s2);border:1px solid var(--border);border-radius:8px' + (onclick ? ';cursor:pointer' : '') + '"' + (onclick ? ' onclick="' + onclick + '"' : '') + '>';
        html += '<div style="font-weight:600;font-size:12px;color:var(--text)">' + esc(nm) + '</div>';
        if (p.city || p.state) html += '<div style="font-size:11px;color:var(--text2)">' + esc((p.city || '') + (p.city && p.state ? ', ' : '') + (p.state || '')) + '</div>';
        html += '</div>';
      }
      html += '</div></div>';
    }
  }

  // Prompt 13: for a plain contact/broker/lender/attorney, the reverse graph
  // read is their property context even when they are not the recorded owner.
  const contactPropHtml = _entityContactPropertiesSection(null);
  if (contactPropHtml) html += contactPropHtml;

  if (!portfolio.length) {
    // A person with no BD-portfolio rollup still shows their direct/affiliated
    // ownership above; only show the empty note when there's truly nothing.
    if (!contactPropHtml && (!owned || (!(owned.direct && owned.direct.length) && !(owned.affiliated && owned.affiliated.properties && owned.affiliated.properties.length)))) {
      html += '<div class="detail-empty">No properties in the BD portfolio yet.</div>';
    }
    return html;
  }

  html += '<div class="detail-section"><div class="detail-section-title">Properties (' + portfolio.length + ')</div>';
  html += '<div style="display:flex;flex-direction:column;gap:6px">';

  for (let pi = 0; pi < portfolio.length; pi++) {
    const p = portfolio[pi];
    const addr = p.address || '(No address)';
    const loc = (p.city || '') + (p.city && p.state ? ', ' : '') + (p.state || '');
    const db = (p.source_domain === 'gov' || p.source_domain === 'government') ? 'gov' : 'dia';
    const pid = p.source_property_id;
    const tenant = p.tenant || '';
    const rent = p.annual_rent != null ? _entityFmtMoney(p.annual_rent) : '';
    const badge = db.toUpperCase();
    const dim = p.is_current === false ? 'opacity:0.6;' : '';

    html += '<div style="padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px;' + dim + (pid != null ? 'cursor:pointer' : '') + '"';
    // Dual-dock the property BESIDE this contact panel (item #6); narrow screens
    // fall back to the full single-panel open inside _entityDrillProperty.
    if (pid != null) html += ' onclick="_entityDrillProperty(\'' + esc(db) + '\', \'' + esc(String(pid)) + '\', \'portfolio\', ' + pi + ')"';
    html += '>';
    html += '<div style="display:flex;gap:12px;align-items:flex-start">';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(addr) + '</div>';
    html += '<div style="font-size:11px;color:var(--text2)">' + esc(loc) + (tenant ? ' · ' + esc(tenant) : '') + (p.is_current === false ? ' · former' : '') + '</div>';
    html += '</div>';
    html += '<div style="text-align:right;font-size:11px;flex-shrink:0">';
    html += '<div><span style="font-size:9px;padding:1px 6px;border-radius:8px;background:' + (db === 'gov' ? 'var(--gov-green)' : 'var(--purple)') + ';color:#fff">' + badge + '</span></div>';
    if (rent) html += '<div style="color:var(--green);margin-top:3px">' + rent + '</div>';
    html += '</div></div></div>';
  }

  html += '</div></div>';
  return html;
}

// ── Entity Contacts Tab (UI Phase 4B) ──
// Lists the people at this owner; when there are none, surfaces the
// acquire-contact CTA that reuses the P-CONTACT / buyer picker endpoints
// (?action=buyer_contacts → select_prospecting_contact). This is where Phase 5's
// "owner missing a contact" gets resolved.
function _entityTabContacts() {
  const c = _entityDetailCache;
  const contacts = c?.contacts || [];

  let html = '';
  if (contacts.length) {
    html += '<div class="detail-section"><div class="detail-section-title">Contacts (' + contacts.length + ')</div>';
    html += '<div style="display:flex;flex-direction:column;gap:8px">';
    for (const ct of contacts) {
      html += '<div style="padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px;cursor:pointer" onclick="openContact360(\'' + esc(ct.id) + '\')">';
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
    html += '</div>';
    html += '<div style="margin-top:10px"><button class="dns-cta" onclick="_entityAcquireContact()">+ Add / acquire contact →</button></div>';
    html += '</div>';
  } else {
    html += '<div class="detail-section"><div class="detail-section-title">Contacts</div>';
    html += '<div style="color:var(--text3);font-size:12px;padding:8px 0 12px">No contacts linked to this owner yet — acquire one to make outreach actionable.</div>';
    html += '<button class="dns-cta" onclick="_entityAcquireContact()">Select / acquire contact →</button>';
    html += '</div>';
  }
  // Host for the inline picker (rendered by _entityAcquireContact).
  html += '<div id="entityContactPickerHost"></div>';
  return html;
}


// ═════════════════════════════════════════════════════════════════════════════
// W6.5 Stage 2, Unit 6 (2026-08-20) — the Overview tab and its helper cluster.
// Moved VERBATIM from detail.js lines 13435-13836.
//
// _entityTabOverview could not travel with Units 4/5: it sits wedged among the
// helpers that build it, and moving the tab alone would have stranded them in
// detail.js — a tab body in one file, its own hero/CTA/section builders in
// another. So the whole cluster moves as ONE region:
//   _entityRoeColors · _entityRoeBanner        shared ROE verdict banner
//   _ENTITY_ROLE_META · _entityRoleMeta        role chrome
//   _nextActionForContact · _entityHeroHTML    the hero + its next-action CTA
//   _entityContactProperty/DealClick           row click routing
//   _entityContact{Properties,Deals}Section    the Overview body sections
//   _entityTabOverview                         the tab itself
//   _entityDraftAndLog · _entityCopyDraft      the draft CTA it renders
//   _entityFmtMoney                            money formatter used throughout
//
// WITH THIS, EVERY entity tab body lives here — so the load-order guard drops
// its _entityTabOverview exclusion and now asserts, with no carve-out beyond the
// dispatcher's own _entityTabsForRole, that NO _entityTab* body remains in
// detail.js. The guard got stricter as a RESULT of the move, which is the point.
// ═════════════════════════════════════════════════════════════════════════════

// ── ROE verdict banner (shared across tabs) ──
function _entityRoeColors(verdict) {
  if (verdict === 'do_not_call') return { bg: 'rgba(239,68,68,0.12)', bd: 'var(--red,#ef4444)', fg: 'var(--red,#ef4444)', icon: '\u{1F6D1}' };
  if (verdict === 'caution') return { bg: 'rgba(234,179,8,0.12)', bd: 'var(--yellow,#eab308)', fg: 'var(--yellow,#eab308)', icon: '\u{26A0}️' };
  return { bg: 'rgba(34,197,94,0.10)', bd: 'var(--green,#22c55e)', fg: 'var(--green,#22c55e)', icon: '\u{2705}' };
}
function _entityRoeBanner() {
  const roe = _entityDetailCache && _entityDetailCache.roe;
  if (!roe) return '';
  const col = _entityRoeColors(roe.verdict);
  const clickable = 'onclick="switchEntityTab(&quot;ROE&quot;)" style="cursor:pointer;';
  return '<div ' + clickable
    + 'display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:8px 12px;border-radius:8px;'
    + 'background:' + col.bg + ';border:1px solid ' + col.bd + '">'
    + '<span style="font-size:15px">' + col.icon + '</span>'
    + '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:12px;color:' + col.fg + '">'
    + esc(roe.headline || 'Rules of Engagement') + '</div>'
    + (roe.reasons && roe.reasons.length
        ? '<div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(roe.reasons[0]) + '</div>'
        : '')
    + '</div><span style="font-size:10px;color:var(--text3)">details ›</span></div>';
}

// Plain-language label + colour for a detected BD role (item #1 — the panel
// says what KIND of contact this is, prominently).
const _ENTITY_ROLE_META = {
  owner:   { label: 'Owner',   color: 'var(--accent)' },
  broker:  { label: 'Broker',  color: 'var(--amber, #d98c00)' },
  buyer:   { label: 'Buyer',   color: 'var(--purple)' },
  contact: { label: 'Contact', color: 'var(--text3)' },
};
function _entityRoleMeta(role) { return _ENTITY_ROLE_META[role] || _ENTITY_ROLE_META.contact; }

// ── Hero next-action (the "direct the user by design" element) ──
// Deterministic ladder over the contact360 payload: picks the SINGLE highest-
// priority next move for this party, first match wins. Role-agnostic; renders as
// one primary CTA at the top of Overview. Pure function of the cache — no fetch,
// documented + testable. Returns {key,tone,label,sub,cta,onclick} | null.
function _nextActionForContact(c) {
  if (!c) return null;
  const e = c.entity || {};
  const cad = c.cadence || null;
  const emailRel = c.emailRel || null;
  const email = (c.subject && c.subject.email) || e.email || (emailRel && emailRel.email) || null;
  const phone = e.phone || null;
  // Prompt 114 Unit 2 — the org has no contact detail of its own, but a LINKED
  // PERSON does. Kept as a separate signal, never folded into `email`: the org
  // does not have that address, we reach the org THROUGH that human. The hero
  // says exactly that rather than implying the org is directly contactable.
  const via = (c.subject && c.subject.reachable_via) || null;
  const sfIds = (c.subject && Array.isArray(c.subject.sf_contact_ids)) ? c.subject.sf_contact_ids : [];
  const sfLinked = sfIds.length > 0 || (Array.isArray(e.external_identities) && e.external_identities.some(function(x){
    return String(x.source_system || '').toLowerCase() === 'salesforce' && String(x.source_type || '').toLowerCase() === 'contact';
  }));
  const unsub = cad && cad.unsubscribe_status ? String(cad.unsubscribe_status).toLowerCase() : '';
  const suppressed = unsub && unsub !== 'subscribed' && unsub !== 'none' && unsub !== 'active';
  const recent = (emailRel && Array.isArray(emailRel.recent)) ? emailRel.recent : [];
  const lastInboundUnanswered = recent.length > 0 && recent[0].dir !== 'out';

  // 1. Suppressed — hard stop, no outreach CTA.
  if (suppressed) return { key: 'suppressed', tone: 'stop', label: 'Do not contact',
    sub: 'Marked ' + cad.unsubscribe_status + ' — suppressed from outreach.', cta: null, onclick: null };
  // 2. No contact method on file — acquire one first, UNLESS a linked person
  //    already carries one. Before Prompt 114 this branch fired even then, so 47
  //    owners that the graph could reach read "Find a contact" and the operator
  //    was sent to acquire a contact we already held.
  if (!email && !phone && via) {
    const whoRole = via.role ? ' (' + String(via.role).replace(/_/g, ' ') + ')' : '';
    const chan = via.email || via.phone || '';
    return { key: 'reach_via_person', tone: 'go',
      label: 'Reach via ' + via.name + whoRole,
      sub: 'No contact on file for this entity itself — ' + via.name + ' is linked to it and is reachable'
        + (chan ? ' at ' + chan : '')
        + (via.via_count > 1 ? ' (' + (via.via_count - 1) + ' other linked contact' + (via.via_count === 2 ? '' : 's') + ').' : '.'),
      cta: 'Open contact →', onclick: '_entityOpenReachableVia()' };
  }
  if (!email && !phone) return { key: 'find_contact', tone: 'warn', label: 'Find a contact',
    sub: 'No email or phone on file — acquire a reachable contact before outreach.', cta: 'Select contact →', onclick: '_entityAcquireContact()' };
  // 3. Not linked in Salesforce — connect to log activity + mark ROE territory.
  if (!sfLinked) return { key: 'connect_sf', tone: 'accent', label: 'Connect in Salesforce',
    sub: 'Not linked to a CRM contact — link to log activity and mark territory (ROE).', cta: 'Select contact →', onclick: '_entityAcquireContact()' };
  // 4. Cadence touch overdue — the due move, now.
  if (cad && cad.overdue) return { key: 'log_overdue', tone: 'stop', label: 'Log the overdue ' + (cad.next_touch_type || 'touch'),
    sub: (cad.next_touch_type || 'Touch') + ' was due ' + _fmtDate(cad.next_touch_due) + ' (' + Math.abs(Number(cad.days_until_due)) + 'd overdue).', cta: 'Draft touchpoint →', onclick: '_entityDraftAndLog(this)' };
  // 5. Unanswered inbound — they emailed us last; reply.
  if (lastInboundUnanswered) return { key: 'reply', tone: 'warn', label: 'Reply — they emailed last',
    sub: 'Last message was inbound' + (recent[0].received_at ? ' (' + _fmtDate(recent[0].received_at) + ')' : '') + ' and awaits your reply.', cta: 'Draft reply →', onclick: '_entityDraftAndLog(this)' };
  // 6. Cadence due (not yet overdue) — the suggested next touch.
  if (cad && cad.on_cadence && cad.next_touch_due) return { key: 'touch_due', tone: 'accent', label: 'Next touch: ' + (cad.next_touch_type || 'touch'),
    sub: 'Due ' + _fmtDate(cad.next_touch_due) + (cad.next_touch_template ? ' · suggested: ' + cad.next_touch_template : '') + '.', cta: 'Draft touchpoint →', onclick: '_entityDraftAndLog(this)' };
  // 7. Default — start/continue the relationship.
  return { key: 'log_touch', tone: 'go', label: 'Log a touchpoint',
    sub: 'Start or continue the relationship with a logged touch.', cta: 'Draft & Log →', onclick: '_entityDraftAndLog(this)' };
}
window._nextActionForContact = _nextActionForContact;

function _entityHeroHTML(c) {
  const a = _nextActionForContact(c);
  if (!a) return '';
  const tones = { stop: 'var(--red,#ef4444)', warn: 'var(--amber,#d98c00)', accent: 'var(--accent)', go: 'var(--green,#22c55e)' };
  const col = tones[a.tone] || 'var(--accent)';
  let h = '<div class="detail-section"><div style="padding:14px 16px;border-radius:10px;background:var(--s2);border:1px solid var(--border);border-left:4px solid ' + col + '">';
  h += '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:' + col + ';margin-bottom:4px">Next best action</div>';
  h += '<div style="font-size:15px;font-weight:700;color:var(--text)">' + esc(a.label) + '</div>';
  if (a.sub) h += '<div style="font-size:12px;color:var(--text2);margin-top:3px">' + esc(a.sub) + '</div>';
  if (a.cta && a.onclick) h += '<button class="dns-cta" style="margin-top:10px" onclick="event.stopPropagation();' + a.onclick + '">' + esc(a.cta) + '</button>';
  h += '</div></div>';
  return h;
}

function _entityOpenContactProperty(db, propertyId, encodedSummary) {
  let summary = {};
  try { summary = JSON.parse(decodeURIComponent(encodedSummary || '')); } catch (_e) { summary = {}; }
  if (_dualCapable()) { openCompanionProperty(db, propertyId, summary); return; }
  if (typeof openUnifiedDetail === 'function') openUnifiedDetail(db, { property_id: propertyId });
}
window._entityOpenContactProperty = _entityOpenContactProperty;

function _entityContactPropertyClick(row) {
  const db = row && (row.domain === 'gov' || row.domain === 'government') ? 'gov' : (row && row.domain ? 'dia' : '');
  const pid = row && row.property_id != null ? String(row.property_id) : '';
  if (db && pid) {
    const summary = encodeURIComponent(JSON.stringify({
      address: row.address || row.asset_name || null,
      city: row.city || null,
      state: row.state || null,
      tenant: row.tenant || null,
      is_current: row.is_current,
    }));
    return "_entityOpenContactProperty('" + esc(db) + "', '" + esc(pid) + "', '" + summary + "')";
  }
  if (row && row.asset_entity_id) return "openContact360('" + esc(String(row.asset_entity_id)) + "', {kind:'entity', tab:'Property'})";
  return '';
}

function _entityContactDealClick(row) {
  if (row && row.asset_entity_id) return "openContact360('" + esc(String(row.asset_entity_id)) + "', {kind:'entity', tab:'Deal'})";
  if (row && row.domain && row.property_id != null) {
    const db = row.domain === 'gov' || row.domain === 'government' ? 'gov' : 'dia';
    return "openUnifiedDetail('" + esc(db) + "', {property_id:'" + esc(String(row.property_id)) + "'}, {}, 'Deal')";
  }
  return '';
}

function _entityContactPropertiesSection(limit) {
  const c = _entityDetailCache || {};
  const rows = Array.isArray(c.contactProperties) ? c.contactProperties : [];
  if (!rows.length) return '';
  const byRole = c.contactPropertiesByRole || {};
  const roles = Object.keys(byRole).sort((a, b) => {
    const order = ['Owner','Operator','Listing broker','Procuring broker','Broker','Attorney','Title','Lender'];
    const ai = order.indexOf(a), bi = order.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
  });
  let html = '<div class="detail-section"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center">'
    + '<div class="detail-section-title">Properties touched</div>'
    + ((c.tabs || []).includes('Ownership') ? '<button class="dns-cta" onclick="switchEntityTab(\'Ownership\')">View all</button>' : '')
    + '</div>';
  let rendered = 0;
  for (const role of roles) {
    const group = Array.isArray(byRole[role]) ? byRole[role] : [];
    if (!group.length) continue;
    html += '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--text3);margin:10px 0 5px">' + esc(role) + '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px">';
    for (const p of group) {
      if (limit && rendered >= limit) break;
      const click = _entityContactPropertyClick(p);
      const title = p.address || p.asset_name || (p.property_id ? ('Property ' + p.property_id) : 'Property');
      const loc = [p.city, p.state].filter(Boolean).join(', ');
      const via = p.via_relationship && p.via_relationship !== 'direct' ? 'via ' + (p.subject_name || 'company') : '';
      html += '<div style="padding:9px 11px;background:var(--s2);border:1px solid var(--border);border-radius:8px' + (click ? ';cursor:pointer' : '') + '"' + (click ? ' onclick="' + click + '"' : '') + '>';
      html += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">';
      html += '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(title) + '</div>';
      html += '<div style="font-size:11px;color:var(--text2)">' + esc([loc, p.tenant, via].filter(Boolean).join(' · ') || 'Not on file') + '</div></div>';
      html += '<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:var(--s3);color:var(--text3);white-space:nowrap">' + esc([p.domain && p.domain.toUpperCase(), p.property_id].filter(Boolean).join(' ')) + '</span>';
      html += '</div></div>';
      rendered++;
    }
    html += '</div>';
    if (limit && rendered >= limit) break;
  }
  if (limit && rows.length > rendered) html += '<div style="font-size:11px;color:var(--text3);margin-top:8px">' + (rows.length - rendered) + ' more graph-linked propert' + (rows.length - rendered === 1 ? 'y' : 'ies') + ' on file.</div>';
  html += '</div>';
  return html;
}

function _entityContactDealsSection(limit) {
  const c = _entityDetailCache || {};
  const rows = Array.isArray(c.contactDeals) ? c.contactDeals : [];
  if (!rows.length) return '';
  const active = (c.contactDealsByStatus && Array.isArray(c.contactDealsByStatus.active)) ? c.contactDealsByStatus.active : rows.filter(d => d.is_open);
  const closed = (c.contactDealsByStatus && Array.isArray(c.contactDealsByStatus.closed)) ? c.contactDealsByStatus.closed : rows.filter(d => !d.is_open);
  const ordered = active.concat(closed);
  let html = '<div class="detail-section"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center">'
    + '<div class="detail-section-title">Deals</div>'
    + ((c.tabs || []).includes('Deals') ? '<button class="dns-cta" onclick="switchEntityTab(\'Deals\')">View all</button>' : '')
    + '</div>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'
    + '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s3);color:var(--text2)">' + active.length + ' active</span>'
    + '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s3);color:var(--text2)">' + closed.length + ' closed</span>'
    + '</div>';
  html += '<div style="display:flex;flex-direction:column;gap:6px">';
  const show = limit ? ordered.slice(0, limit) : ordered;
  for (const d of show) {
    const click = _entityContactDealClick(d);
    const title = d.deal_name || d.asset_name || d.address || 'Deal';
    const status = d.is_open ? (d.stage || 'Active') : (d.sale_date || d.closed_at ? 'Closed ' + _fmtDate(d.sale_date || d.closed_at) : 'Closed');
    html += '<div style="padding:9px 11px;background:var(--s2);border:1px solid var(--border);border-radius:8px' + (click ? ';cursor:pointer' : '') + '"' + (click ? ' onclick="' + click + '"' : '') + '>';
    html += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">';
    html += '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(title) + '</div>';
    html += '<div style="font-size:11px;color:var(--text2)">' + esc([d.role_label || d.role, d.address, d.next_action && ('next: ' + d.next_action)].filter(Boolean).join(' · ') || 'Not on file') + '</div></div>';
    html += '<div style="text-align:right;flex-shrink:0"><div style="font-size:10px;color:' + (d.is_open ? 'var(--green)' : 'var(--text3)') + '">' + esc(status) + '</div>';
    if (d.amount != null) html += '<div style="font-size:10px;color:var(--accent);margin-top:2px">' + esc(_entityFmtMoney(d.amount)) + '</div>';
    html += '</div></div></div>';
  }
  html += '</div>';
  if (limit && ordered.length > show.length) html += '<div style="font-size:11px;color:var(--text3);margin-top:8px">' + (ordered.length - show.length) + ' more deal' + (ordered.length - show.length === 1 ? '' : 's') + ' on file.</div>';
  html += '</div>';
  return html;
}

// ── Entity Overview Tab ──
function _entityTabOverview() {
  const c = _entityDetailCache;
  const e = c.entity;
  const role = c.role || 'contact';
  const rm = _entityRoleMeta(role);
  const contacts = c.contacts || [];
  const rollup = c.rollup || null;
  const propCount = rollup && rollup.total_property_count != null
    ? Number(rollup.total_property_count) : (c.portfolio?.length || 0);

  let html = '';

  // Role banner — the panel is no longer owner-framed; it states the role.
  html += '<div style="display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:8px 12px;border-radius:8px;background:var(--s2);border-left:3px solid ' + rm.color + '">'
    + '<span style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:' + rm.color + '">' + esc(rm.label) + '</span>';
  if (role === 'broker' && c.brokerIntel) {
    const bi = c.brokerIntel;
    html += '<span style="font-size:11px;color:var(--text2)">' + Number(bi.total_deals || 0) + ' deal' + (Number(bi.total_deals) === 1 ? '' : 's') + ' brokered in our markets</span>';
  } else if ((role === 'owner' || role === 'buyer') && propCount) {
    html += '<span style="font-size:11px;color:var(--text2)">' + propCount + ' propert' + (propCount === 1 ? 'y' : 'ies') + ' in the BD portfolio</span>';
  }
  html += '</div>';

  // Hero next-action (Scott: "direct the user by design") — the single highest-
  // priority move, right below the role banner, above the reference detail.
  html += _entityHeroHTML(c);

  // Entity info section
  html += '<div class="detail-section"><div class="detail-section-title">Entity Information</div><div class="detail-grid">';
  html += _row('Name', e.name);
  html += _row('Role', rm.label);
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

  // Quick stats — role-aware. A broker shows deal-intelligence tiles (deals +
  // buyers/sellers represented), NOT owner-portfolio + the 50 unrelated contacts.
  const stat = (val, label, color, onclick) =>
    '<div style="text-align:center;padding:12px;background:var(--s2);border-radius:8px' + (onclick ? ';cursor:pointer' : '') + '"'
    + (onclick ? ' onclick="' + onclick + '"' : '') + '>'
    + '<div style="font-size:' + (String(val).length > 6 ? 16 : 20) + 'px;font-weight:700;color:' + color + '">' + val + '</div>'
    + '<div class="t-meta3">' + label + '</div></div>';
  const actTile = stat(c.timeline?.length || 0, 'Activities', 'var(--yellow, #eab308)', 'switchEntityTab(\'Activity\')');
  html += '<div class="detail-section"><div class="detail-section-title">Summary</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-top:4px">';
  if (role === 'broker') {
    const bi = c.brokerIntel || {};
    html += stat(Number(bi.total_deals || 0), 'Deals brokered', 'var(--accent)', 'switchEntityTab(\'Deals\')');
    html += stat(Number(bi.represents_sellers || 0), 'Repr. sellers', 'var(--green)', 'switchEntityTab(\'Deals\')');
    html += stat(Number(bi.represents_buyers || 0), 'Repr. buyers', 'var(--purple)', 'switchEntityTab(\'Deals\')');
    html += actTile;
  } else {
    const rollupRent = rollup && rollup.current_annual_rent_total != null ? Number(rollup.current_annual_rent_total) : null;
    html += stat(propCount, 'Properties', 'var(--accent)', 'switchEntityTab(\'Ownership\')');
    html += stat(rollupRent ? _entityFmtMoney(rollupRent) : '—', 'Portfolio Rent', 'var(--green)', null);
    // Contacts tile only when the Contacts tab exists (org entities).
    if ((c.tabs || []).includes('Contacts')) html += stat(contacts.length, 'Contacts', 'var(--purple)', 'switchEntityTab(\'Contacts\')');
    html += actTile;
  }
  html += '</div></div>';

  // Prompt 13 connectivity: contact/org -> graph-backed properties + deals,
  // grouped by role and cross-linked back to Property/Deal surfaces.
  html += _entityContactPropertiesSection(6);
  html += _entityContactDealsSection(5);

  // Open Tasks + Marketing follow-ups (Contact 360 refinement) — mirror the
  // Pipeline card "Open Tasks (N)" pattern; each links to its detail tab. The
  // linked deal/opportunity shows in the marketing follow-ups (deal_name).
  const _openN = (c.openTasks || []).length;
  const _mktN = (c.marketing || []).length;
  if (_openN || _mktN) {
    html += '<div class="detail-section"><div style="display:flex;gap:10px;flex-wrap:wrap">';
    html += '<div onclick="switchEntityTab(\'Activity\')" style="flex:1;min-width:130px;cursor:pointer;padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px">'
      + '<div style="font-size:16px;font-weight:700;color:var(--accent)">' + _openN + '</div>'
      + '<div class="t-meta3">Open Tasks →</div></div>';
    html += '<div onclick="switchEntityTab(\'Engagement\')" style="flex:1;min-width:130px;cursor:pointer;padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px">'
      + '<div style="font-size:16px;font-weight:700;color:var(--purple)">' + _mktN + '</div>'
      + '<div class="t-meta3">Marketing follow-ups →</div></div>';
    html += '</div></div>';
  }

  // Row-level action — Draft & Log (Topic F engine: renders a draft to Outlook,
  // logs a completed SF activity, advances the cadence — one call, honest status).
  const em = (c.subject && c.subject.email) || e.email || '';
  html += '<div class="detail-section"><div class="detail-section-title">Outreach</div>';
  html += '<button class="dns-cta" onclick="_entityDraftAndLog(this)">\u{270D}️ Draft &amp; Log →</button>';
  if (!em) html += '<div style="font-size:11px;color:var(--text3);margin-top:6px">No email on file — the draft opens without a recipient for you to fill.</div>';
  html += '<div id="entityDraftHost" style="margin-top:10px"></div>';
  html += '</div>';

  return html;
}

// Row-level Draft & Log for the panel subject — the Topic F engine
// (?action=draft_and_log), NOT the older _draftFromPipeline / log_to_sf split.
async function _entityDraftAndLog(btn) {
  const c = _entityDetailCache;
  if (!c || !c.entityId) return;
  const em = (c.subject && c.subject.email) || (c.entity && c.entity.email) || '';
  const name = (c.entity && c.entity.name) || '';
  const domain = (c.entity && c.entity.domain) || '';
  if (btn) { btn.disabled = true; btn.textContent = 'Drafting & logging…'; }
  const res = await _udApiPost('/api/operations?action=draft_and_log', {
    template_id: 'T-001',
    entity_id: c.entityId,
    context: { contact: { name: name, full_name: name }, property: { domain: domain }, domain: domain },
    domain: domain || null,
    name: name || null,
    to: em || null,
    mode: 'bd'
  });
  if (btn) { btn.disabled = false; btn.textContent = '\u{270D}️ Draft & Log →'; }
  const host = document.getElementById('entityDraftHost');
  if (!res || res.ok === false || !res.ok && res.error) {
    if (host) host.innerHTML = '<div style="color:var(--red,#ef4444);font-size:12px">Draft & Log failed: ' + esc((res && res.error) || 'unknown') + '</div>';
    return;
  }
  const d = res.draft || {};
  const sf = res.sf || {};
  const subject = d.subject || '';
  const bodyText = d.body || '';
  const status = [];
  if (d.created) status.push('✓ Draft in Outlook');
  else if (d.reason === 'no_recipient') status.push('⚠ add a recipient to draft in Outlook');
  else status.push('Draft ready — copy/paste below');
  if (sf.logged) status.push('✓ logged to Salesforce');
  else if (sf.reason === 'no_sf_contact') status.push('no SF contact — SF log skipped');
  else if (sf.reason === 'sf_not_configured') status.push('SF logging not configured yet');
  else status.push('SF log pending');
  if (res.cadence && res.cadence.advanced) status.push('cadence advanced');
  const mailto = 'mailto:' + encodeURIComponent(em) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(bodyText);
  const openDraftBtn = d.web_link ? '<a class="dns-cta" href="' + esc(d.web_link) + '" target="_blank" rel="noopener">Open Outlook draft</a>' : '';
  if (host) host.innerHTML =
    (em ? '<div style="font-size:12px;margin-bottom:4px"><b>To:</b> ' + esc(em) + '</div>' : '')
    + '<div style="font-size:12px;margin-bottom:4px"><b>Subject:</b> ' + esc(subject) + '</div>'
    + '<textarea rows="8" style="width:100%;margin:4px 0;font-size:12px" id="entityDraftBody">' + esc(bodyText) + '</textarea>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
    + '<button class="dns-cta" onclick="_entityCopyDraft()">Copy</button>'
    + '<a class="dns-cta" href="' + esc(mailto) + '" target="_blank" rel="noopener">Open in mail</a>'
    + openDraftBtn + '</div>'
    + '<div style="font-size:11px;color:var(--text3);margin-top:6px">' + esc(status.join(' · ')) + '</div>';
}
window._entityDraftAndLog = _entityDraftAndLog;

function _entityCopyDraft() {
  const ta = document.getElementById('entityDraftBody');
  if (ta && navigator.clipboard) navigator.clipboard.writeText(ta.value).then(() => {
    if (typeof showToast === 'function') showToast('Draft copied', 'success');
  }).catch(() => {});
}
window._entityCopyDraft = _entityCopyDraft;

// Compact $ formatter for the entity rollup figures.
function _entityFmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 10e6 ? 0 : 1) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}
