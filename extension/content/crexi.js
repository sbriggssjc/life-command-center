// ============================================================================
// LCC Assistant — Content Script: CREXi
// Detects property listing pages and extracts CRE data.
//
// Round 76df: rewrote primary extraction strategy. CREXi's React DOM uses
// Tailwind utility classes (ctw: prefix) and renders each label/value pair
// as a single flex row:
//   <div class="ctw:flex ctw:flex-row ctw:items-center ctw:justify-between">
//     <span class="ctw:text-body ctw:mr-7 ctw:whitespace-nowrap">Label</span>
//     <span ...>Value</span>
//   </div>
// We now build a label→value map from those rows ONCE per extract call,
// then look up known fields by exact + fuzzy match. The previous heuristic
// findTextElement() was returning wrong adjacent siblings (e.g. Cap Rate's
// value picked up the NOI row's text). The map-based approach is precise
// and orders of magnitude faster.
//
// Asking Price is special-cased: it lives in a header banner like
// "$6,994,109 | 126 days on market | Updated 8 days ago", not in a flex
// row. We extract it via regex from body innerText.
//
// Also captures: linked property-records URLs (Sale Comp / Lease / Record).
// ============================================================================

(function () {
  'use strict';

  // Round 76dg: idempotency guard — see costar.js for rationale.
  if (window.__lccCrexiLoaded) return;
  window.__lccCrexiLoaded = true;

  let lastDetectedAddress = null;

  const observer = new MutationObserver(() => {
    const url = window.location.href;

    // CREXi property pages: /properties/*, /listing/*
    if (
      !url.includes('/properties/') &&
      !url.includes('/listing/') &&
      !url.includes('/commercial-real-estate/')
    ) return;

    // Extract address from heading
    const headingEl =
      document.querySelector('[data-cy="property-title"]') ||
      document.querySelector('.property-name') ||
      document.querySelector('.listing-title') ||
      document.querySelector('.pdp-address') ||
      document.querySelector('h1');

    const address = headingEl?.textContent?.trim();
    if (!address || address === lastDetectedAddress) return;
    lastDetectedAddress = address;

    const val = (el) => el?.textContent?.trim() || null;

    // ── Strategy 0 (Round 76df): build CREXi flex-row label→value map ────
    const crexiMap = buildCrexiDataMap();
    const get = (...keywords) => lookupCrexiField(crexiMap, ...keywords)
      || val(findTextElement(...keywords));

    // Financial
    const askingPrice = get('Asking Price', 'Price', 'List Price') || extractCrexiAskingPrice();
    const capRate = get('Cap Rate');
    const noi = get('NOI', 'Net Operating Income');
    const psf = get('Price per SqFt', 'Price/SF', 'Price / SF', 'Price Per SF', '$/SF');

    // Property details
    const propertyType = get('Property Type', 'Type', 'Asset Class');
    const subType = get('Sub Type', 'Subtype');
    const buildingClass = get('Class', 'Building Class');
    const yearBuilt = get('Year Built');
    const sqft = get('Square Footage', 'Building Size', 'SF', 'Square Feet', 'Total SF', 'GLA', 'Rentable Area');
    const netRentable = get('Net Rentable');
    const lotSize = get('Lot Size', 'Land Area', 'Acres', 'Land SF');
    const stories = get('Stories', 'Floors', 'Number of Stories');
    const buildings = get('Buildings');
    const units = get('Units', 'Total Units', 'Number of Units');
    const parking = get('Parking', 'Parking Spaces', 'Parking Ratio');
    const zoning = get('Zoning', 'Zone');
    const occupancy = get('Occupancy', 'Leased %', 'Percent Leased');

    // Lease
    const leaseType = get('Lease Type');
    const leaseTerm = get('Lease Term', 'Remaining Term');
    const tenancy = get('Tenancy');
    const tenantBrand = get('Brand/Tenant', 'Tenant', 'Primary Tenant');

    // Investment
    const investmentType = get('Investment Type');
    const tenantCredit = get('Tenant Credit');
    const apn = get('APN', 'Parcel Number');

    // Broker
    const brokerEl = findTextElement('Listing Agent', 'Broker', 'Listed By', 'Contact');
    const brokerCoEl = findTextElement('Brokerage', 'Listing Company', 'Company');

    // Sale
    const salePriceEl = findTextElement('Sale Price', 'Last Sale Price');
    const saleDateEl = findTextElement('Sale Date', 'Last Sale Date');

    // Location — CREXi often shows city/state below address
    const subHeadingEl =
      document.querySelector('.property-location') ||
      document.querySelector('.pdp-location') ||
      document.querySelector('.listing-subtitle');
    let city = null;
    let state = null;
    const subText = subHeadingEl?.textContent?.trim();
    if (subText) {
      const parts = subText.split(',').map((s) => s.trim());
      if (parts.length >= 2) {
        city = parts[0];
        state = parts[1].split(/\s+/)[0];
      }
    }
    if (!city) city = val(findTextElement('City'));
    if (!state) state = val(findTextElement('State'));

    // Round 76df: capture linked property-records URLs (sale comps / lease
    // data / public record) so the LCC sidebar can offer one-click follow-ups.
    const linkedPages = extractCrexiLinkedPages();

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'crexi',
        entity_type: 'property',
        _version: 2,
        address,
        page_url: url,
        asking_price: askingPrice,
        cap_rate: capRate,
        noi: noi,
        price_per_sf: psf,
        property_type: propertyType,
        sub_type: subType,
        building_class: buildingClass,
        year_built: yearBuilt,
        square_footage: sqft,
        net_rentable_sf: netRentable,
        lot_size: lotSize,
        stories: stories,
        buildings: buildings,
        units: units,
        parking: parking,
        zoning: zoning,
        occupancy: occupancy,
        lease_type: leaseType,
        lease_term: leaseTerm,
        tenancy: tenancy,
        tenant_name: tenantBrand,
        investment_type: investmentType,
        tenant_credit: tenantCredit,
        apn: apn,
        broker_name: val(brokerEl),
        broker_company: val(brokerCoEl),
        sale_price: val(salePriceEl),
        sale_date: val(saleDateEl),
        city,
        state,
        linked_pages: linkedPages,
      },
    });

    injectLccButton(headingEl);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ── Round 76df helpers ──────────────────────────────────────────────────

  function buildCrexiDataMap() {
    // Match by class fragments to avoid coupling to the entire utility-class
    // soup. CREXi rows always carry these three flex modifiers together.
    const rows = document.querySelectorAll(
      'div[class*="ctw:flex"][class*="ctw:flex-row"][class*="ctw:justify-between"]'
    );
    const map = new Map();
    rows.forEach((row) => {
      const first = row.firstElementChild;
      const last = row.lastElementChild;
      if (!first || !last || first === last) return;
      const label = first.textContent?.trim();
      const value = last.textContent?.trim();
      if (!label || !value) return;
      if (label.length > 80 || value.length > 200) return;
      // "Lot Size (SqFt)" → "lot size" so labels with parenthetical
      // unit suffixes are still found by the canonical name.
      const normalized = label.replace(/\s*\([^)]+\)\s*$/, '').toLowerCase();
      // Don't overwrite if a row appears twice (e.g. summary + detail card);
      // the first occurrence is typically the primary detail panel.
      if (!map.has(normalized)) map.set(normalized, value);
    });
    return map;
  }

  function lookupCrexiField(map, ...keywords) {
    if (!map || map.size === 0) return null;
    // Pass 1: exact match (after parenthetical-suffix normalization).
    for (const kw of keywords) {
      const v = map.get(kw.toLowerCase());
      if (v) return v;
    }
    // Pass 2: prefix / contains match for legacy or renamed labels.
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      for (const [label, value] of map) {
        if (label === kwLower || label.startsWith(kwLower)) return value;
      }
    }
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      for (const [label, value] of map) {
        if (label.includes(kwLower)) return value;
      }
    }
    return null;
  }

  function extractCrexiAskingPrice() {
    // CREXi shows the asking price in a header banner like
    // "$6,994,109 | 126 days on market | Updated 8 days ago".
    // Anchor the regex on the "days on market" text so we don't pick up
    // tax / NOI / valuation-tool dollar values elsewhere on the page.
    const text = document.body?.innerText || '';
    const m = text.match(/\$[\d,]+(?:\.\d+)?(?=\s*\|\s*\d+\s+days?\s+on\s+market)/i);
    if (m) return m[0];
    // Fallback: a price-prominent element near the page top.
    const big = document.querySelector('[data-cy="price"], .property-price, .pdp-price');
    if (big) {
      const t = big.textContent?.trim();
      if (t && /^\$[\d,]+/.test(t)) return t;
    }
    return null;
  }

  function extractCrexiLinkedPages() {
    const out = {};
    document.querySelectorAll('a[href*="/property-records/"]').forEach((a) => {
      const href = a.href;
      if (!href) return;
      if (/[?&]tab=sale\b/i.test(href) && !out.sale_comp_url) out.sale_comp_url = href;
      if (/[?&]tab=lease\b/i.test(href) && !out.lease_data_url) out.lease_data_url = href;
      if (/[?&]tab=record\b/i.test(href) && !out.record_url) out.record_url = href;
    });
    // The /properties/<id>/<slug> URL is the canonical For Sale listing.
    const listing = document.querySelector('a[href*="/properties/"]');
    if (listing && listing.href) out.listing_url = listing.href;
    return Object.keys(out).length ? out : null;
  }

  function findTextElement(...keywords) {
    const kwLower = keywords.map((k) => k.toLowerCase());

    // Strategy 1: Semantic label elements
    const labelEls = document.querySelectorAll(
      'label, dt, th, .label, [class*="label"], [class*="Label"], ' +
      'span[class*="key"], span[class*="title"]'
    );
    for (const el of labelEls) {
      const text = el.textContent?.trim().toLowerCase() || '';
      if (text.length > 80) continue;
      if (kwLower.some((kw) => text.includes(kw))) {
        const sibling = el.nextElementSibling;
        if (sibling?.textContent?.trim()) return sibling;
        const parent = el.parentElement;
        if (parent) {
          const value = parent.querySelector(
            'dd, td, .value, [class*="value"], [class*="Value"], span:last-child'
          );
          if (value && value !== el) return value;
        }
      }
    }

    // Strategy 2: Scan compact elements (SPA card/tile layouts)
    const allEls = document.querySelectorAll('div, span, p, td, li');
    for (const el of allEls) {
      const text = el.textContent?.trim() || '';
      if (text.length < 2 || text.length > 60 || el.children.length > 3) continue;
      if (!kwLower.some((kw) => text.toLowerCase().includes(kw))) continue;

      const next = el.nextElementSibling;
      if (next?.textContent?.trim()?.length > 0 && next.textContent.trim().length < 200) return next;

      const prev = el.previousElementSibling;
      if (prev?.textContent?.trim()?.length > 0 && prev.textContent.trim().length < 200) return prev;

      const parent = el.parentElement;
      if (parent && parent.children.length <= 5) {
        for (const child of parent.children) {
          if (child !== el) {
            const ct = child.textContent?.trim();
            if (ct && ct.length < 200 && ct.toLowerCase() !== text.toLowerCase()) return child;
          }
        }
      }
    }

    return null;
  }

  function injectLccButton(headingEl) {
    if (!headingEl) return;
    if (headingEl.parentElement?.querySelector('.lcc-inject-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'lcc-inject-btn';
    btn.textContent = 'LCC Context \u25B8';
    btn.title = 'Open LCC context for this property';
    Object.assign(btn.style, {
      marginLeft: '12px',
      padding: '4px 12px',
      fontSize: '12px',
      fontWeight: '600',
      color: '#1F3864',
      background: '#EBF0FA',
      border: '1px solid #B8C9E8',
      borderRadius: '4px',
      cursor: 'pointer',
      verticalAlign: 'middle',
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    });

    headingEl.parentElement?.appendChild(btn);
  }
})();
