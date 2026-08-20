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
