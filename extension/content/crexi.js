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
    // CREXi shows both "Lease Term" (original term) and "Remaining Term"
    // (years left). Capture them as distinct fields so cap-rate / hold-period
    // analysis can use the correct one.
    const leaseTerm = get('Lease Term');
    const remainingTerm = get('Remaining Term');
    const leaseExpiration = get('Lease Expiration', 'Lease Exp', 'Expiration');
    const leaseOptions = get('Lease Options', 'Renewal Options', 'Options');
    const tenancy = get('Tenancy');
    const tenantBrand = get('Brand/Tenant', 'Tenant', 'Primary Tenant');

    // Investment
    const investmentType = get('Investment Type');
    const tenantCredit = get('Tenant Credit');
    const apn = get('APN', 'Parcel Number');
    const acreage = get('Acreage');

    // Header banner: "$X | N days on market | Updated M days ago"
    const header = extractCrexiHeader();

    // Marketing description / headline (free-text body the broker writes)
    const marketing = extractCrexiMarketing();

    // OM (Offering Memorandum) availability + link
    const om = extractCrexiOm();

    // Broker contact cards (often multiple per listing)
    const contacts = extractCrexiContacts();
    const primaryContact = contacts && contacts[0];

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
        remaining_term: remainingTerm,
        lease_expiration: leaseExpiration,
        renewal_options: leaseOptions,
        tenancy: tenancy,
        tenant_name: tenantBrand,
        brand_tenant: tenantBrand,
        investment_type: investmentType,
        tenant_credit: tenantCredit,
        apn: apn,
        acreage: acreage,
        broker_name: primaryContact?.name || val(brokerEl),
        broker_company: primaryContact?.company || val(brokerCoEl),
        // Sidebar expects these listing_* fields (see buildMetadata).
        listing_broker: primaryContact?.name || null,
        listing_firm: primaryContact?.company || null,
        listing_phone: primaryContact?.phones?.[0] || null,
        listing_email: primaryContact?.email || null,
        contacts: contacts || [],
        sale_price: val(salePriceEl),
        sale_date: val(saleDateEl),
        days_on_market: header.days_on_market,
        updated_days_ago: header.updated_days_ago,
        marketing_headline: marketing.headline,
        marketing_description: marketing.description,
        om_available: om.available,
        om_url: om.url,
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

  function extractCrexiHeader() {
    // Matches "$2,045,000 | 67 days on market | Updated 28 days ago".
    // Returns days_on_market and updated_days_ago (both as strings, or null).
    const text = document.body?.innerText || '';
    const m = text.match(
      /\$[\d,]+(?:\.\d+)?\s*\|\s*(\d+)\s+days?\s+on\s+market\s*\|\s*Updated\s+(\d+)\s+days?\s+ago/i
    );
    if (m) return { days_on_market: m[1], updated_days_ago: m[2] };
    const dom = text.match(/(\d+)\s+days?\s+on\s+market/i);
    const upd = text.match(/Updated\s+(\d+)\s+days?\s+ago/i);
    return {
      days_on_market: dom ? dom[1] : null,
      updated_days_ago: upd ? upd[1] : null,
    };
  }

  function extractCrexiMarketing() {
    // CREXi renders a section like:
    //   <h2>7.75% CAP DAVITA DIALYSIS LOCATED IN STRONG MEDICAL HUB</h2>
    //   <h3>Marketing description</h3>
    //   <div>Davita Inc. is a major U.S. healthcare provider...</div>
    // We anchor on the "Marketing description" label, then walk siblings.
    const out = { headline: null, description: null };
    const all = document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p');
    let labelEl = null;
    for (const el of all) {
      if (el.children.length > 2) continue;
      const t = el.textContent?.trim() || '';
      if (t.length > 60) continue;
      if (/^marketing\s+description$/i.test(t)) { labelEl = el; break; }
    }
    if (!labelEl) return out;

    // Headline = previous heading-like sibling within the same section that
    // looks like an ALL-CAPS marketing tagline (broker headlines on CREXi
    // are uppercase by convention).
    let prev = labelEl.previousElementSibling;
    while (prev) {
      const pt = prev.textContent?.trim() || '';
      if (pt && pt.length >= 10 && pt.length <= 200) {
        const letters = pt.replace(/[^A-Za-z]/g, '');
        if (letters.length >= 8 && letters === letters.toUpperCase()) {
          out.headline = pt;
          break;
        }
      }
      prev = prev.previousElementSibling;
    }
    // Fallback: search nearby ancestor for any uppercase heading.
    if (!out.headline) {
      const section = labelEl.closest('section, article, div');
      if (section) {
        const headings = section.querySelectorAll('h1, h2, h3, h4');
        for (const h of headings) {
          const ht = h.textContent?.trim() || '';
          if (ht.length < 10 || ht.length > 200) continue;
          if (/^marketing\s+description$/i.test(ht)) continue;
          const letters = ht.replace(/[^A-Za-z]/g, '');
          if (letters.length >= 8 && letters === letters.toUpperCase()) {
            out.headline = ht;
            break;
          }
        }
      }
    }

    // Description = collected text from siblings AFTER the label until the
    // next named section (Investment Highlights, Location, etc.).
    const SECTION_BREAK = /^(details|location|gallery|photos?|contacts?|brokers?|map|highlights?|investment\s+highlights?|in\s+the\s+area|demographics?|nearby|similar\s+(properties|listings)|property\s+overview|tax(?:es)?|public\s+records?|comparables?|sale\s+comp|lease\s+data|record)$/i;
    let cursor = labelEl.nextElementSibling;
    let collected = '';
    while (cursor && collected.length < 5000) {
      const ct = cursor.textContent?.trim() || '';
      const firstLine = (ct.split('\n')[0] || '').trim();
      if (firstLine && SECTION_BREAK.test(firstLine)) break;
      if (ct) collected += (collected ? '\n\n' : '') + ct;
      cursor = cursor.nextElementSibling;
    }
    if (collected) out.description = collected.slice(0, 5000);
    return out;
  }

  function extractCrexiOm() {
    // CREXi exposes OMs via a "View OM" / "Download OM" button. The actual
    // PDF lives behind an auth modal, so we capture the button's href when
    // present and otherwise just record availability + the listing URL.
    const candidates = document.querySelectorAll('a, button');
    for (const el of candidates) {
      const t = el.textContent?.trim() || '';
      if (!/^(view|download)\s+om\b|offering\s+memorandum/i.test(t)) continue;
      let href = null;
      if (el.tagName === 'A' && el.href) href = el.href;
      if (!href) {
        const anchor = el.closest('a');
        if (anchor && anchor.href) href = anchor.href;
      }
      if (!href) {
        href = el.getAttribute('data-href') || el.getAttribute('data-url') || null;
      }
      return { available: true, url: href || window.location.href };
    }
    return { available: false, url: null };
  }

  function extractCrexiContacts() {
    // CREXi broker cards are rendered one per agent. Each card contains
    // name, license id ("MI 6501461017"), "View phone number" / "View email"
    // buttons, and the firm name/logo. Anchoring on "View phone number"
    // gives one DOM node per card; we then climb to a stable container.
    const phoneMarkers = [];
    const emailMarkers = [];
    document.querySelectorAll('a, button, span, div').forEach((el) => {
      if (el.children.length > 1) return;
      const t = el.textContent?.trim() || '';
      if (/^view\s+phone\s+number$/i.test(t)) phoneMarkers.push(el);
      else if (/^view\s+email$/i.test(t)) emailMarkers.push(el);
    });

    const cards = new Set();
    const seen = new WeakSet();
    const collectCard = (marker) => {
      let node = marker;
      for (let i = 0; i < 7 && node.parentElement; i += 1) {
        node = node.parentElement;
        if (seen.has(node)) return;
        const text = node.innerText || node.textContent || '';
        // Card heuristic: contains name-like + license-like text and is
        // small enough to be a single broker card (not the whole page).
        if (text.length < 60 || text.length > 600) continue;
        if (!/view\s+(phone|email)/i.test(text)) continue;
        if (!/[A-Z][a-z]+\s+[A-Z][a-z]+/.test(text)) continue;
        seen.add(node);
        cards.add(node);
        return;
      }
    };
    phoneMarkers.forEach(collectCard);
    emailMarkers.forEach(collectCard);

    const NAME_BLACKLIST = /^(view\s+(phone|email|om)|listed\s+by|brokerage|real\s+estate)$/i;
    const COMPANY_RE = /(real\s+estate|realty|capital|group|advisors|partners|properties|brokerage|\bllc\b|\binc\.?$|\bco\.?$|cushman|cbre|jll|colliers|marcus|newmark|friedman|kidder|stream|avison|berkadia|matthews)/i;

    const contacts = [];
    for (const card of cards) {
      const text = (card.innerText || card.textContent || '');
      const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);

      let name = null;
      for (const l of lines) {
        if (l.length > 60) continue;
        if (NAME_BLACKLIST.test(l)) continue;
        if (COMPANY_RE.test(l)) continue;
        // Strip "PRO" badge that CREXi appends to verified agents.
        const cleaned = l.replace(/\s+PRO$/i, '').trim();
        if (/^[A-Z][a-zA-Z'.\-]+(?:\s+[A-Z][a-zA-Z'.\-]+){1,3}$/.test(cleaned)) {
          name = cleaned;
          break;
        }
      }

      let license = null;
      for (const l of lines) {
        const m = l.match(/^([A-Z]{2})\s+([A-Z]{0,3}\d{5,})$/);
        if (m) { license = `${m[1]} ${m[2]}`; break; }
      }

      let company = null;
      for (const l of lines) {
        if (l.length > 80) continue;
        if (COMPANY_RE.test(l)) { company = l; break; }
      }

      const phoneMatch = text.match(/(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/);
      const emailMatch = text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);

      if (!name && !phoneMatch && !emailMatch) continue;
      contacts.push({
        role: 'listing_broker',
        name: name || null,
        company: company || null,
        license: license || null,
        phones: phoneMatch ? [phoneMatch[0].trim()] : [],
        email: emailMatch ? emailMatch[0] : null,
      });
    }

    // De-dupe by name (CREXi sometimes renders a compact summary alongside
    // the full card).
    const byName = new Map();
    for (const c of contacts) {
      const key = (c.name || c.email || '').toLowerCase();
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, c);
    }
    return Array.from(byName.values());
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
