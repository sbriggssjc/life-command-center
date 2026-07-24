// marketing.js — Marketing tab (Slice 3): an owner-centric BD workspace built on
// Team Briggs' active listings. Each listing expands to (a) live engagement on
// that listing and (b) three auto-populated BD prospect sections. Reuses the
// existing Contact 360 (openContact360), the Draft & Log engine (draft_and_log),
// and the ROE guard — this file is a renderer, it does not fork those.
//
// Server contract (api/operations.js):
//   GET  ?action=marketing_listings            → { listings: [...] }   (3a)
//   GET  ?action=marketing_engagement&...       → { contacts: [...] }   (3b)
//   GET  ?action=marketing_bd&...               → { b1, b2, b3 }        (3c)
//
// Data policy: blank, never fabricated. An empty source renders an honest empty
// state, never placeholder numbers.
// ============================================================================
(function () {
  'use strict';

  // ---- state ----
  window._mktState = window._mktState || { loaded: false, loading: false, listings: [], open: {} };
  const S = window._mktState;

  // ---- tiny helpers (self-contained so marketing.js has no hard dep on esc()) ----
  function mktEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function mktMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n).toLocaleString();
  }
  function mktCap(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '';
    // deal book stores cap as a percent number (e.g. 6.85) OR a decimal (0.0685)
    const pct = n < 1 ? n * 100 : n;
    return pct.toFixed(2) + '%';
  }
  function mktDate(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function mktStageLabel(stage) {
    return ({
      active_listing: 'Active Listing',
      under_loi: 'Under LOI',
      in_escrow: 'In Escrow',
    })[stage] || (stage || '');
  }
  function mktStageClass(stage) {
    return ({
      active_listing: 'mkt-badge-active',
      under_loi: 'mkt-badge-loi',
      in_escrow: 'mkt-badge-escrow',
    })[stage] || 'mkt-badge-active';
  }
  // A field with no source renders as a muted em-dash — never a fabricated value.
  function mktField(label, value) {
    const v = (value == null || value === '') ? '<span class="mkt-blank">—</span>' : mktEsc(value);
    return '<div class="mkt-fact"><div class="mkt-fact-label">' + mktEsc(label) + '</div>'
      + '<div class="mkt-fact-value">' + v + '</div></div>';
  }

  // ---- data load ----
  async function mktLoadListings(force) {
    if (S.loading) return;
    if (S.loaded && !force) return;
    S.loading = true;
    const r = await opsApi('/api/operations?action=marketing_listings').catch(() => ({ ok: false }));
    S.loading = false;
    if (!r || !r.ok || !r.data || !r.data.ok) {
      S.loadError = (r && r.data && r.data.error) || (r && r.error) || 'load_failed';
      S.loaded = true;
      return;
    }
    S.listings = Array.isArray(r.data.listings) ? r.data.listings : [];
    S.loadError = null;
    S.loaded = true;
  }

  // ---- render: the page ----
  async function renderMarketingWorkspace(force) {
    const host = document.getElementById('marketingContent');
    if (!host) return;
    if (!S.loaded || force) {
      host.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
      await mktLoadListings(force);
    }
    if (S.loadError) {
      host.innerHTML = '<div class="mkt-header"><h2>Marketing</h2></div>'
        + '<div class="mkt-empty">Could not load active listings ('
        + mktEsc(S.loadError) + '). '
        + '<button class="mkt-btn" onclick="mktReload()">Retry</button></div>';
      return;
    }
    const listings = S.listings;
    let html = '<div class="mkt-header">'
      + '<div><h2>Marketing</h2>'
      + '<div class="mkt-subtitle">Active Team Briggs listings — expand for engagement + BD prospects</div></div>'
      + '<div class="mkt-header-meta">' + listings.length + ' active</div>'
      + '</div>';

    if (!listings.length) {
      html += '<div class="mkt-empty">No active Team Briggs listings.</div>';
      host.innerHTML = html;
      return;
    }

    html += '<div class="mkt-list">';
    listings.forEach((l, i) => { html += mktListingCardHTML(l, i); });
    html += '</div>';
    host.innerHTML = html;

    // Re-open any listing that was open before a re-render.
    Object.keys(S.open).forEach(i => { if (S.open[i]) mktRenderDetail(Number(i)); });
  }

  function mktListingTitle(l) {
    return l.deal_name || l.property_address || 'Untitled listing';
  }
  function mktListingLocation(l) {
    const parts = [l.city, l.state].filter(Boolean);
    return parts.join(', ');
  }

  function mktListingCardHTML(l, i) {
    const open = !!S.open[i];
    const cap = mktCap(l.cap_rate);
    const ask = mktMoney(l.asking_price);
    const loc = mktListingLocation(l);
    return '<div class="mkt-listing' + (open ? ' open' : '') + '" id="mktListing' + i + '" data-idx="' + i + '">'
      + '<div class="mkt-listing-head" onclick="mktToggle(' + i + ')" role="button" tabindex="0">'
      + '<span class="mkt-caret">' + (open ? '▾' : '▸') + '</span>'
      + '<div class="mkt-listing-title">'
      + '<div class="mkt-listing-name">' + mktEsc(mktListingTitle(l)) + '</div>'
      + '<div class="mkt-listing-sub">'
      + (loc ? mktEsc(loc) + ' · ' : '')
      + mktEsc(l.primary_use || '')
      + '</div></div>'
      + '<div class="mkt-listing-chips">'
      + (ask ? '<span class="mkt-chip">' + ask + '</span>' : '')
      + (cap ? '<span class="mkt-chip">' + cap + ' cap</span>' : '')
      + '<span class="mkt-badge ' + mktStageClass(l.deal_stage) + '">' + mktEsc(mktStageLabel(l.deal_stage)) + '</span>'
      + '</div></div>'
      + '<div class="mkt-listing-body" id="mktBody' + i + '">'
      + (open ? '' : '')
      + '</div></div>';
  }

  window.mktToggle = function (i) {
    S.open[i] = !S.open[i];
    const card = document.getElementById('mktListing' + i);
    const caret = card && card.querySelector('.mkt-caret');
    if (card) card.classList.toggle('open', !!S.open[i]);
    if (caret) caret.textContent = S.open[i] ? '▾' : '▸';
    if (S.open[i]) mktRenderDetail(i);
    else { const b = document.getElementById('mktBody' + i); if (b) b.innerHTML = ''; }
  };

  // ---- render: one listing's expanded detail ----
  function mktRenderDetail(i) {
    const l = S.listings[i];
    const body = document.getElementById('mktBody' + i);
    if (!l || !body) return;

    const hasProp = l.linked_property_id != null && l.linked_property_id !== '';

    let html = '';

    // Deal summary — real facts only; unsourced cells render blank (—).
    html += '<div class="mkt-section mkt-summary">'
      + '<div class="mkt-facts">'
      + mktField('Address', l.property_address)
      + mktField('Asking Price', mktMoney(l.asking_price))
      + mktField('Cap Rate', mktCap(l.cap_rate))
      + mktField('NOI', mktMoney(l.noi))
      + mktField('Primary Use', l.primary_use)
      + mktField('Marketing Status', l.marketing_status)
      + mktField('On Market', mktDate(l.first_broadcast_date))
      + mktField('Broker', l.broker_name)
      + '</div></div>';

    // Engagement section (filled in Slice 3b).
    html += mktSectionShell('engagement', 'Engagement', 'Live activity on this listing', i);

    // Three BD prospect sections (filled in Slice 3c). Anchored on the linked
    // property; if there's no linked property we say so honestly.
    if (hasProp) {
      html += mktSectionShell('b1', 'Area Ownership', 'Owners of nearby properties', i);
      html += mktSectionShell('b2', 'Regional Like-Asset Owners', 'Owners of the same asset class in this market', i);
      html += mktSectionShell('b3', 'Owners in Market', 'Active BD prospects in this market', i);
    } else {
      html += '<div class="mkt-section">'
        + '<div class="mkt-section-head"><div class="mkt-section-title">BD Prospects</div></div>'
        + '<div class="mkt-empty mkt-empty-sm">No linked property on this listing yet — '
        + 'area / like-asset / in-market prospects unavailable until the deal is linked to a property.</div>'
        + '</div>';
    }

    body.innerHTML = html;

    // Kick off the async section loaders.
    mktLoadEngagement(i);
    if (hasProp) mktLoadBd(i);
  }

  function mktSectionShell(key, title, subtitle, i) {
    return '<div class="mkt-section" id="mktSec-' + key + '-' + i + '">'
      + '<div class="mkt-section-head">'
      + '<div><div class="mkt-section-title">' + mktEsc(title) + '</div>'
      + '<div class="mkt-section-sub">' + mktEsc(subtitle) + '</div></div></div>'
      + '<div class="mkt-section-body" id="mktSecBody-' + key + '-' + i + '">'
      + '<div class="mkt-loading-sm"><span class="spinner"></span></div>'
      + '</div></div>';
  }

  // ---- Slice 3b: engagement ----
  S.eng = S.eng || {};

  const MKT_EVENT_LABEL = {
    om_download: 'OM download',
    exec_summary_view: 'Viewed summary',
    loopnet_inquiry: 'LoopNet inquiry',
    rcm_inquiry: 'RCM inquiry',
    loopnet_favorite: 'LoopNet favorite',
    website_hit: 'Website visit',
  };
  function mktRelDate(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + 'd ago';
    return mktDate(v);
  }

  async function mktLoadEngagement(i) {
    const body = document.getElementById('mktSecBody-engagement-' + i);
    if (!body) return;
    const l = S.listings[i];
    const qs = [];
    if (l.sf_listing_id) qs.push('listing_id=' + encodeURIComponent(l.sf_listing_id));
    if (l.sf_deal_id) qs.push('opp_id=' + encodeURIComponent(l.sf_deal_id));
    if (!qs.length) { body.innerHTML = '<div class="mkt-empty mkt-empty-sm">No Salesforce listing/deal id on this record — engagement unavailable.</div>'; return; }

    const r = await opsApi('/api/operations?action=marketing_engagement&' + qs.join('&')).catch(() => ({ ok: false }));
    if (!r || !r.ok || !r.data || !r.data.ok) {
      body.innerHTML = '<div class="mkt-empty mkt-empty-sm">Could not load engagement.</div>';
      return;
    }
    const contacts = Array.isArray(r.data.contacts) ? r.data.contacts : [];
    S.eng[i] = contacts;
    // Update the section subtitle count.
    const sec = document.getElementById('mktSec-engagement-' + i);
    const sub = sec && sec.querySelector('.mkt-section-sub');
    if (sub) sub.textContent = contacts.length + ' engaged contact' + (contacts.length === 1 ? '' : 's');

    if (!contacts.length) {
      body.innerHTML = '<div class="mkt-empty mkt-empty-sm">No engagement recorded on this listing yet.</div>';
      return;
    }
    body.innerHTML = '<div class="mkt-eng-list">' + contacts.map((c, j) => mktEngRowHTML(c, i, j)).join('') + '</div>';
  }

  function mktEngRowHTML(c, i, j) {
    const name = c.lead_name || '';
    const company = c.lead_company || '';
    const primary = name || company || '(unknown contact)';
    const secondary = name && company ? company : '';
    const events = (Array.isArray(c.event_types) ? c.event_types : [])
      .map(t => '<span class="mkt-ev">' + mktEsc(MKT_EVENT_LABEL[t] || t) + '</span>').join('');
    const count = Number(c.event_count) > 1 ? '<span class="mkt-ev-count">×' + c.event_count + '</span>' : '';
    const when = mktRelDate(c.last_activity);
    const owner = c.assigned_to ? '<span class="mkt-eng-owner" id="mktEngOwner-' + i + '-' + j + '">' + mktEsc(c.assigned_to) + '</span>' : '<span class="mkt-eng-owner" id="mktEngOwner-' + i + '-' + j + '"></span>';
    const canLog = !!c.entity_id;

    const actions = []
      .concat('<button class="mkt-act" onclick="mktOpenContact(' + i + ',' + j + ')" title="Open Contact 360">Contact 360</button>')
      .concat(c.lead_phone ? '<a class="mkt-act" href="tel:' + mktEsc(String(c.lead_phone).replace(/[^0-9+]/g, '')) + '">Call</a>' : '')
      .concat('<button class="mkt-act' + (canLog ? '' : ' mkt-act-off') + '" ' + (canLog ? 'onclick="mktLog(' + i + ',' + j + ',\'call\')"' : 'disabled title="No linked contact — open Contact 360 to link first"') + '>Log Call</button>')
      .concat('<button class="mkt-act' + (canLog ? '' : ' mkt-act-off') + '" ' + (canLog ? 'onclick="mktLog(' + i + ',' + j + ',\'attempt\')"' : 'disabled title="No linked contact"') + '>Log Attempt</button>')
      .concat(c.sf_contact_id ? '<button class="mkt-act" onclick="mktReassign(' + i + ',' + j + ')">Reassign</button>' : '')
      .filter(Boolean).join('');

    return '<div class="mkt-eng-row" id="mktEng-' + i + '-' + j + '">'
      + '<div class="mkt-eng-main" onclick="mktOpenContact(' + i + ',' + j + ')" role="button" tabindex="0">'
      + '<div class="mkt-eng-name">' + mktEsc(primary) + (secondary ? ' <span class="mkt-eng-co">· ' + mktEsc(secondary) + '</span>' : '') + '</div>'
      + '<div class="mkt-eng-meta">' + events + count + (when ? '<span class="mkt-eng-when">' + mktEsc(when) + '</span>' : '') + owner + '</div>'
      + '</div>'
      + '<div class="mkt-eng-actions">' + actions + '</div>'
      + '</div>';
  }

  // Contact 360 — reuse the ONE canonical trigger. entity_id → open directly;
  // else fall back to a name search so a broker still resolves.
  window.mktOpenContact = function (i, j) {
    const c = (S.eng[i] || [])[j];
    if (!c) return;
    if (c.entity_id && typeof openContact360 === 'function') { openContact360(c.entity_id, { kind: 'entity', tab: 'Overview' }); return; }
    const nm = c.lead_name || c.lead_company;
    if (nm && typeof openEntityDetailByName === 'function') { openEntityDetailByName(nm); return; }
    if (typeof showToast === 'function') showToast('No linked contact record for this engagement', '');
  };

  window.mktLog = async function (i, j, kind) {
    const c = (S.eng[i] || [])[j];
    if (!c || !c.entity_id) { showToast('No linked contact to log against', ''); return; }
    const l = S.listings[i];
    const who = c.lead_name || c.lead_company || 'contact';
    const subject = (kind === 'attempt' ? 'Outreach attempt — ' : 'Call — ') + who;
    const notes = 'Marketing: ' + (l.deal_name || l.property_address || '');
    const r = await opsPost('/api/operations?action=log_call', {
      entity_id: c.entity_id, domain: 'dia', subject: subject, notes: notes,
      outcome: kind === 'attempt' ? 'no_answer' : 'connected',
    }).catch(() => ({ ok: false }));
    if (r && r.ok) showToast(kind === 'attempt' ? 'Attempt logged' : 'Call logged', 'success');
    else showToast('Log failed', 'error');
  };

  window.mktReassign = async function (i, j) {
    const c = (S.eng[i] || [])[j];
    if (!c || !c.sf_contact_id) { showToast('No Salesforce contact id — cannot reassign', ''); return; }
    const l = S.listings[i];
    const cur = c.assigned_to || '';
    const to = window.prompt('Reassign this engaged contact to which broker?', cur);
    if (to == null) return;
    const owner = String(to).trim();
    if (!owner || owner === cur) return;
    const r = await opsPost('/api/operations?action=marketing_reassign', {
      listing_id: l.sf_listing_id || null,
      opp_id: l.sf_deal_id || null,
      sf_contact_id: c.sf_contact_id,
      new_owner: owner,
    }).catch(() => ({ ok: false }));
    if (r && r.ok && r.data && r.data.ok) {
      c.assigned_to = owner;
      const el = document.getElementById('mktEngOwner-' + i + '-' + j);
      if (el) el.textContent = owner;
      const sfReason = r.data.sf && r.data.sf.reason;
      showToast('Reassigned to ' + owner + (sfReason === 'sf_reassign_not_configured' ? ' (SF Task owner update pending — Slice 4)' : ''), 'success');
    } else {
      showToast('Reassign failed: ' + ((r.data && r.data.error) || r.error || 'unknown'), 'error');
    }
  };

  // ---- Slice 3c: the three BD prospect sections ----
  S.bd = S.bd || {};

  async function mktLoadBd(i) {
    const l = S.listings[i];
    const qs = [];
    if (l.linked_property_id != null && l.linked_property_id !== '') qs.push('property_id=' + encodeURIComponent(l.linked_property_id));
    if (l.state) qs.push('state=' + encodeURIComponent(l.state));
    ['b1', 'b2', 'b3'].forEach(k => {
      const b = document.getElementById('mktSecBody-' + k + '-' + i);
      if (b) b.innerHTML = '<div class="mkt-loading-sm"><span class="spinner"></span></div>';
    });
    const r = await opsApi('/api/operations?action=marketing_bd&' + qs.join('&')).catch(() => ({ ok: false }));
    if (!r || !r.ok || !r.data || !r.data.ok) {
      ['b1', 'b2', 'b3'].forEach(k => {
        const b = document.getElementById('mktSecBody-' + k + '-' + i);
        if (b) b.innerHTML = '<div class="mkt-empty mkt-empty-sm">Could not load prospects.</div>';
      });
      return;
    }
    S.bd[i] = { b1: r.data.b1 || [], b2: r.data.b2 || [], b3: r.data.b3 || [] };
    ['b1', 'b2', 'b3'].forEach(k => mktRenderBdSection(i, k));
  }

  function mktRenderBdSection(i, k) {
    const body = document.getElementById('mktSecBody-' + k + '-' + i);
    if (!body) return;
    const rows = (S.bd[i] && S.bd[i][k]) || [];
    const sec = document.getElementById('mktSec-' + k + '-' + i);
    const sub = sec && sec.querySelector('.mkt-section-sub');
    if (sub && rows.length) sub.textContent = rows.length + ' owner' + (rows.length === 1 ? '' : 's');
    if (!rows.length) {
      const msg = k === 'b1'
        ? 'No geocoded nearby owners for this listing.'
        : 'No matching owners in this market.';
      body.innerHTML = '<div class="mkt-empty mkt-empty-sm">' + msg + '</div>';
      return;
    }
    body.innerHTML = '<div class="mkt-bd-list">' + rows.map((row, j) => mktBdRowHTML(row, i, k, j)).join('') + '</div>';
  }

  function mktRoeBadge(roe) {
    if (!roe) return '';
    const v = roe.verdict || 'safe';
    const cls = v === 'do_not_call' ? 'mkt-roe-red' : v === 'caution' ? 'mkt-roe-amber' : 'mkt-roe-green';
    const icon = v === 'do_not_call' ? '⛔' : v === 'caution' ? '⚠' : '✓';
    return '<span class="mkt-roe ' + cls + '" title="' + mktEsc(roe.headline || '') + '">' + icon + ' ' + mktEsc(roe.headline || v) + '</span>';
  }

  function mktResearchLinks(owner, state) {
    const g = q => 'https://www.google.com/search?q=' + encodeURIComponent(q);
    const o = owner || '';
    const st = state || '';
    return '<div class="mkt-research">'
      + '<span class="mkt-research-label">Research:</span>'
      + '<a class="mkt-rlink" href="' + g('"' + o + '" ' + st + ' real estate') + '" target="_blank" rel="noopener">Web</a>'
      + '<a class="mkt-rlink" href="' + g(o + ' costar') + '" target="_blank" rel="noopener">CoStar</a>'
      + '<a class="mkt-rlink" href="' + g(o + ' ' + st + ' secretary of state business search') + '" target="_blank" rel="noopener">County/SOS</a>'
      + '</div>';
  }

  function mktBdRowHTML(row, i, k, j) {
    const canOpen = !!(row.entity_id || row.owner_name);
    const canDraft = !!row.entity_id;
    const note = row.note ? '<div class="mkt-bd-note">' + mktEsc(row.note) + '</div>' : '';
    const actions = []
      .concat(canOpen ? '<button class="mkt-act" onclick="mktOpenBdContact(\'' + i + '\',\'' + k + '\',' + j + ')" title="Open Contact 360 (SF-aware)">Contact 360</button>' : '')
      .concat(canDraft ? '<button class="mkt-act" onclick="mktBdDraft(\'' + i + '\',\'' + k + '\',' + j + ',this)">Draft &amp; Log</button>' : '')
      .filter(Boolean).join('');
    return '<div class="mkt-bd-row">'
      + '<div class="mkt-bd-main">'
      + '<div class="mkt-bd-name">' + mktEsc(row.owner_name || '(unknown owner)') + '</div>'
      + '<div class="mkt-bd-ctx">' + mktEsc(row.context || '') + (row.in_pipeline ? ' <span class="mkt-bd-inpipe">· in your pipeline</span>' : '') + '</div>'
      + note
      + '<div class="mkt-bd-foot">' + mktRoeBadge(row.roe) + mktResearchLinks(row.owner_name, S.listings[i].state) + '</div>'
      + '</div>'
      + '<div class="mkt-bd-actions">' + actions + '</div>'
      + '</div>';
  }

  window.mktOpenBdContact = function (i, k, j) {
    const row = ((S.bd[i] || {})[k] || [])[j];
    if (!row) return;
    if (row.entity_id && typeof openContact360 === 'function') { openContact360(row.entity_id, { kind: 'entity', tab: 'Overview' }); return; }
    if (row.owner_name && typeof openEntityDetailByName === 'function') { openEntityDetailByName(row.owner_name); return; }
    if (typeof showToast === 'function') showToast('No linked owner record', '');
  };

  // Outreach on a BD prospect routes through the Draft & Log engine (BD mode).
  window.mktBdDraft = function (i, k, j, btn) {
    const row = ((S.bd[i] || {})[k] || [])[j];
    if (!row || !row.entity_id) { showToast('No linked owner to draft against', ''); return; }
    if (row.roe && row.roe.verdict === 'do_not_call') {
      if (!window.confirm((row.roe.headline || 'Do not call') + '\n\nDraft anyway?')) return;
    }
    if (typeof cadDraftAndLog === 'function') {
      // (cadenceId, entityId, templateId, name, domain, contactEmail, contactId, btn)
      cadDraftAndLog(null, row.entity_id, null, row.owner_name || '', 'dia', '', null, btn);
    } else {
      showToast('Draft & Log unavailable', 'error');
    }
  };

  function mktLoadBdLegacyNoop() {}

  window.mktReload = function () { renderMarketingWorkspace(true); };

  // Exported for app.js handlePageLoad('pageMarketing').
  window.renderMarketingWorkspace = renderMarketingWorkspace;
})();
