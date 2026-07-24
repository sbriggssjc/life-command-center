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

  // ---- section loaders (Slice 3a: scaffold; wired to real endpoints in 3b/3c) ----
  function mktLoadEngagement(i) {
    const body = document.getElementById('mktSecBody-engagement-' + i);
    if (!body) return;
    body.innerHTML = '<div class="mkt-empty mkt-empty-sm">Engagement loads in Slice 3b.</div>';
  }
  function mktLoadBd(i) {
    ['b1', 'b2', 'b3'].forEach(k => {
      const body = document.getElementById('mktSecBody-' + k + '-' + i);
      if (body) body.innerHTML = '<div class="mkt-empty mkt-empty-sm">Prospects load in Slice 3c.</div>';
    });
  }

  window.mktReload = function () { renderMarketingWorkspace(true); };

  // Exported for app.js handlePageLoad('pageMarketing').
  window.renderMarketingWorkspace = renderMarketingWorkspace;
})();
