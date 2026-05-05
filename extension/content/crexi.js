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

    // Round 76ej.i (2026-05-04): detect closed/withdrawn listings.
    // CREXi strips the structured Details panel when a listing flips to
    // "No Longer For Sale" / "Sold" / "Closed" — only the marketing
    // description and broker cards remain. The Tailwind label/value map
    // ends up empty, and the legacy findTextElement() heuristic happily
    // grabs section headings ("Valuation Metrics", "About This Property
    // Description Highlights") and marketing prose as if they were
    // field values. Detect the closed badge up front so we can degrade
    // extraction gracefully (no garbage values) and tag the snapshot
    // with the right listing_status.
    const bodyText = document.body?.innerText || '';
    const CLOSED_BADGES = /(no\s+longer\s+for\s+sale|off\s+market|withdrawn|sold|closed|deal\s+closed)/i;
    let listingStatus = 'active';
    // Look at small badge-like elements first to avoid false positives
    // from the marketing description (which may legitimately use words
    // like "sold" in body copy).
    document.querySelectorAll('span, div, em, strong, [class*="badge"], [class*="status"], [class*="banner"]').forEach((el) => {
      if (listingStatus !== 'active') return;
      if (el.children.length > 1) return;
      const t = (el.textContent || '').trim();
      if (t.length < 3 || t.length > 40) return;
      if (!CLOSED_BADGES.test(t)) return;
      if (/^no\s+longer\s+for\s+sale$/i.test(t)) listingStatus = 'no_longer_for_sale';
      else if (/^off\s+market$/i.test(t))         listingStatus = 'off_market';
      else if (/^withdrawn$/i.test(t))            listingStatus = 'withdrawn';
      else if (/^sold$/i.test(t))                 listingStatus = 'sold';
      else if (/^closed$/i.test(t))               listingStatus = 'closed';
    });
    const isClosedListing = listingStatus !== 'active';

    // ── Strategy 0 (Round 76df): build CREXi flex-row label→value map ────
    const crexiMap = buildCrexiDataMap();
    // Round 76ej.l (2026-05-05): the heuristic findTextElement() fallback
    // is structurally unsafe — it scans the whole document for any
    // element whose text contains a keyword and returns adjacent text.
    // On the Mast One / 1040 University Boulevard listing it stamped
    //   tenant_name = "Quality Construction and new HVAC systems"
    //   cap_rate    = "Valuation Metrics"
    // because the marketing description contains the word "tenants" and
    // a sidebar section is titled "Valuation Metrics" with a Cap Rate
    // child. Earlier fix (76ej.i) only disabled the heuristic when the
    // structured panel was empty (closed listings); rendered open
    // listings are just as poisonable when the requested field happens
    // not to be in the panel. The structured map is now treated as the
    // sole source of truth for `get()` consumers — fields absent from
    // it stay null instead of being fabricated from prose.
    const allowHeuristicFallback = false;
    const get = (...keywords) => {
      const mapped = lookupCrexiField(crexiMap, ...keywords);
      if (mapped) return mapped;
      if (!allowHeuristicFallback) return null;
      return val(findTextElement(...keywords));
    };

    // Financial
    let askingPrice = get('Asking Price', 'Price', 'List Price') || extractCrexiAskingPrice();
    // Round 76ej.e: hard-reject degenerate values like "$" with no digits
    // so they don't propagate into seed_data and confuse the AI extractor.
    if (askingPrice && !/\d/.test(askingPrice)) askingPrice = null;
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
    const tenantBrandRaw = get('Brand/Tenant', 'Tenant', 'Primary Tenant');
    // Round 76ej.d: CREXi shows the brand label ("DaVita"), but every
    // other intake source (CSV import, OM extraction) uses the legal
    // entity name ("DaVita Kidney Care") which collides on conflict
    // resolution. Map the most common single-word brands forward to
    // their canonical legal name so writes don't bounce. Keep the
    // map small and only for unambiguous brand-only tenants.
    const TENANT_BRAND_ALIASES = {
      'davita':              'DaVita Kidney Care',
      'fresenius':           'Fresenius Medical Care',
      'us renal':            'U.S. Renal Care',
      'us renal care':       'U.S. Renal Care',
      'satellite healthcare':'Satellite Healthcare',
    };
    const tenantBrand = tenantBrandRaw && TENANT_BRAND_ALIASES[tenantBrandRaw.toLowerCase().trim()]
      ? TENANT_BRAND_ALIASES[tenantBrandRaw.toLowerCase().trim()]
      : tenantBrandRaw;

    // Investment
    const investmentType = get('Investment Type');
    const tenantCredit = get('Tenant Credit');
    const apn = get('APN', 'Parcel Number');
    const acreage = get('Acreage');

    // Header banner: "$X | N days on market | Updated M days ago"
    const header = extractCrexiHeader();

    // Listing subtitle (CREXi shows the building/listing name between the
    // price banner and the action buttons — e.g. "GSA EPA Laboratory" or
    // "Athens VA Clinic, 9249 US-29, Athens, GA 30601"). Domain
    // classification depends on tenant-flavored text, and CREXi's
    // structured Details panel rarely names the tenant for govt-leased
    // properties — the subtitle is often the only place that "GSA" /
    // "VA" / "EPA" appears as a structured field.
    const buildingName = extractCrexiBuildingName(address);

    // Marketing description / headline (free-text body the broker writes)
    const marketing = extractCrexiMarketing();

    // Round 76ej.k (2026-05-04): mine the prose for lease facts CREXi's
    // structured Details panel doesn't carry (expense_structure,
    // remaining_term_years, lease_expiration_text, renewal_options_text,
    // rent_escalations_pct). Used as a fallback only — never overwrites
    // a structured value below. Tagged at lower trust in the priority
    // registry so OM extraction always wins when both are present.
    const descLease = extractCrexiLeaseFromDescription(marketing.description);

    // OM (Offering Memorandum) availability + link
    const om = extractCrexiOm();

    // Broker contact cards (often multiple per listing)
    const contacts = extractCrexiContacts();
    const primaryContact = contacts && contacts[0];

    // Broker
    const brokerEl = findTextElement('Listing Agent', 'Broker', 'Listed By', 'Contact');
    const brokerCoElRaw = findTextElement('Brokerage', 'Listing Company', 'Company');

    // Round 76ej.n (2026-05-04): reject license-format strings from
    // becoming the brokerage/firm name. The Tampa Berlin Group capture
    // (intake 31802a9d) showed broker_company="License BK3317434"
    // because findTextElement('Brokerage', ...) returned the line
    // adjacent to the CREXi 'Brokerage' label, which is the agent's
    // license id rather than the firm name. License formats:
    //   "License BK3317434"   (verbose)
    //   "BK3317434"           (license id alone)
    //   "FL BK3317434" / "MI 6501461017" (state-code prefix)
    //   "License #BK3317434"  (with hash)
    const isLicenseLikeString = (s) => {
      if (!s || typeof s !== 'string') return false;
      const t = s.trim();
      if (t.length < 3) return false;
      // Verbose forms: "License BK3317434" / "Lic. #BK..."
      if (/^license[\s#:]/i.test(t)) return true;
      if (/^lic[.\s#:]/i.test(t))    return true;
      // Bare license id, with optional 2-letter state prefix:
      //   "BK3317434" — 0-3 letters then 4+ digits
      //   "FL BK3317434" — state, space, license body
      //   "MI 6501461017" — state, space, no letters, 10 digits
      if (/^(?:[A-Z]{2}\s+)?[A-Z]{0,3}\d{4,}\s*$/.test(t)) return true;
      // Bare digit run
      if (/^\d{4,}\s*$/.test(t)) return true;
      return false;
    };
    const cleanCompany = (raw) => {
      if (!raw) return null;
      const t = String(raw).trim();
      if (isLicenseLikeString(t)) return null;
      return t;
    };
    // Try the "Listed by <Firm>" text near the property image footer
    // first — that's where CREXi consistently shows the brokerage name
    // (separate from the broker card which only carries the license).
    const listedByText = (() => {
      const text = document.body?.innerText || '';
      const m = text.match(/listed\s+by[:\s]+([A-Z][^\n,]{2,80}?)(?=\s*(?:\n|·|•|\||$))/i);
      if (!m) return null;
      const raw = m[1].trim().replace(/[,;]+$/, '').trim();
      return isLicenseLikeString(raw) ? null : raw;
    })();

    const brokerCoEl = brokerCoElRaw;
    const brokerCoFallback = cleanCompany(val(brokerCoElRaw)) || listedByText;

    // Sale
    const salePriceEl = findTextElement('Sale Price', 'Last Sale Price');
    const saleDateEl = findTextElement('Sale Date', 'Last Sale Date');

    // Location — CREXi headings typically already encode city/state/zip:
    //   "109 Harrison Ave & 1601 Spring St, Jeffersonville, IN 47130"
    // Parse out of the address string FIRST (most reliable). Falling back to
    // findTextElement('City') was producing junk on this page because the
    // heuristic was matching broker-card text containing "View phone".
    let city = null;
    let state = null;
    const addrMatch = address.match(/,\s*([^,]+),\s*([A-Z]{2})\s+\d{5}/);
    if (addrMatch) {
      city = addrMatch[1].trim();
      state = addrMatch[2];
    } else {
      // Legacy fallback: explicit subtitle element on older CREXi layouts.
      const subHeadingEl =
        document.querySelector('.property-location') ||
        document.querySelector('.pdp-location') ||
        document.querySelector('.listing-subtitle');
      const subText = subHeadingEl?.textContent?.trim();
      if (subText && subText.length < 120 && !/view\s+(phone|email)/i.test(subText)) {
        const parts = subText.split(',').map((s) => s.trim());
        if (parts.length >= 2) {
          city = parts[0];
          state = parts[1].split(/\s+/)[0];
        }
      }
    }

    // Round 76df: capture linked property-records URLs (sale comps / lease
    // data / public record) so the LCC sidebar can offer one-click follow-ups.
    const linkedPages = extractCrexiLinkedPages();

    // Round 76ej: surface what the new extractors actually picked up so the
    // user can spot missing-field regressions in DevTools without round-
    // tripping through the sidebar.
    console.debug('[lcc-crexi] extracted', {
      lease_expiration: leaseExpiration,
      remaining_term: remainingTerm,
      lease_options: leaseOptions,
      acreage,
      days_on_market: header.days_on_market,
      contacts_found: contacts ? contacts.length : 0,
      marketing_headline: marketing.headline ? '✓' : null,
      marketing_description_chars: marketing.description ? marketing.description.length : 0,
      desc_lease_extracted: descLease,
      om_available: om.available,
      crexi_map_size: crexiMap.size,
    });

    // Round 76ej.i: extract canonical CREXi listing id from the URL path.
    // /properties/<id>/<slug> is stable even when query/tracking params
    // drift, so this gives the lookup_asset call a fingerprint that
    // doesn't break when CREXi rewrites the eblast URL.
    let crexiListingId = null;
    let crexiCanonicalUrl = null;
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/properties\/(\d+)\b/);
      if (m) {
        crexiListingId    = m[1];
        crexiCanonicalUrl = `${u.origin}${u.pathname}`;
      }
    } catch (_) { /* non-fatal */ }

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'crexi',
        entity_type: 'property',
        _version: 2,
        address,
        page_url: url,
        // Canonical / stable identifiers — used by lookup_asset to
        // recognise this listing even when the address normalization
        // or tracking query params don't match exactly.
        crexi_listing_id: crexiListingId,
        canonical_url:    crexiCanonicalUrl,
        listing_status:   listingStatus,
        is_closed_listing: isClosedListing,
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
        // Round 76ej.k: marketing-description fallbacks. Structured
        // Details-panel value wins — only use the prose-mined value
        // when the structured field is empty. Never overwrites.
        remaining_term: remainingTerm
          || (descLease.remaining_term_years != null ? String(descLease.remaining_term_years) : null),
        lease_expiration: leaseExpiration || descLease.lease_expiration_text || null,
        renewal_options: leaseOptions || descLease.renewal_options_text || null,
        expense_structure: descLease.expense_structure || null,
        rent_escalations: descLease.rent_escalations_pct != null
          ? String(descLease.rent_escalations_pct) + '%'
          : null,
        // Provenance hint: which fields came from prose vs the
        // structured panel. Backend can decide whether to write or
        // skip based on this. Stays separate from the value fields
        // so a future consumer can compute a confidence score.
        lease_facts_from_description: {
          expense_structure:    descLease.expense_structure,
          remaining_term_years: descLease.remaining_term_years,
          lease_expiration:     descLease.lease_expiration_text,
          renewal_options:      descLease.renewal_options_text,
          rent_escalations_pct: descLease.rent_escalations_pct,
        },
        tenancy: tenancy,
        tenant_name: tenantBrand,
        brand_tenant: tenantBrand,
        investment_type: investmentType,
        tenant_credit: tenantCredit,
        apn: apn,
        acreage: acreage,
        broker_name: primaryContact?.name || val(brokerEl),
        broker_company: cleanCompany(primaryContact?.company) || brokerCoFallback,
        // Sidebar expects these listing_* fields (see buildMetadata).
        listing_broker: primaryContact?.name || null,
        listing_firm: cleanCompany(primaryContact?.company) || brokerCoFallback,
        listing_phone: primaryContact?.phones?.[0] || null,
        listing_email: primaryContact?.email || null,
        contacts: contacts || [],
        sale_price: val(salePriceEl),
        sale_date: val(saleDateEl),
        days_on_market: header.days_on_market,
        updated_days_ago: header.updated_days_ago,
        building_name: buildingName,
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
    // Pass 2/3: fuzzy prefix and substring matching is restricted to
    // multi-word keywords. Single-word keywords (e.g. 'Price', 'Tenant',
    // 'NOI') would otherwise poach values from compound labels —
    // 'price' matched 'price per sqft' and returned $/SF as the asking
    // price; 'tenant' matched 'tenant credit' and returned 'Credit
    // Rated' as the tenant name. Multi-word keywords are specific
    // enough that the same false-positive class doesn't apply.
    for (const kw of keywords) {
      if (!kw.includes(' ')) continue;
      const kwLower = kw.toLowerCase();
      for (const [label, value] of map) {
        if (label === kwLower) return value;
        if (label.length > kwLower.length &&
            label.startsWith(kwLower) &&
            /[\s/]/.test(label.charAt(kwLower.length))) {
          return value;
        }
      }
    }
    for (const kw of keywords) {
      if (!kw.includes(' ')) continue;
      const kwLower = kw.toLowerCase();
      for (const [label, value] of map) {
        if (label.includes(kwLower)) return value;
      }
    }
    return null;
  }

  function extractCrexiAskingPrice() {
    // Round 76ej.e (2026-05-04): the body-innerText regex kept missing
    // the price banner on real CREXi pages — sending '$' with no digits
    // through to the synthesized text and confusing the AI extractor.
    // Switch to a DOM-first strategy: scan small banner-area elements
    // for one whose trimmed text is exactly a price string. Return null
    // (not '$') when no number follows so the synthetic text and seed
    // data omit the field entirely.
    const PRICE_RE  = /^\$\s?[\d,]+(?:\.\d+)?$/;
    const PRICE_TXT = /\$\s?[\d,]+(?:\.\d+)?/;

    // 1. Try a known-stable selector first (CREXi has used data-cy='price'
    //    for years; .property-price / .pdp-price are older fallbacks).
    const direct = document.querySelector(
      '[data-cy="price"], [data-cy="askingPrice"], .property-price, .pdp-price'
    );
    if (direct) {
      const t = direct.textContent?.trim() || '';
      const m = t.match(PRICE_TXT);
      if (m && /\d/.test(m[0])) return m[0].replace(/\s+/g, '');
    }

    // 2. Walk small near-the-top elements (h1-h4, span, div, p) and
    //    return the first whose trimmed text is exactly a price.
    //    Stop after 200 candidates — the banner is always near the top.
    const cands = document.querySelectorAll('h1, h2, h3, h4, span, div, p');
    let scanned = 0;
    for (const el of cands) {
      if (scanned++ > 200) break;
      const t = el.textContent?.trim() || '';
      if (t.length < 4 || t.length > 24) continue;
      if (!PRICE_RE.test(t)) continue;
      // Exclude the "$" with no digits case and tiny dollar values
      // (e.g. "$3" cents-of-something widgets).
      const digits = t.replace(/\D/g, '');
      if (digits.length < 4) continue;
      return t.replace(/\s+/g, '');
    }

    // 3. Last resort: anchor on "days on market" / "Cap Rate" within
    //    160 chars of a $ in body innerText. Require ≥4 digits so
    //    bare "$" won't slip through.
    const text = document.body?.innerText || '';
    const m = text.match(
      /\$\s?([\d,]{4,}(?:\.\d+)?)(?=[^$\n]{0,160}?(?:days?\s+on\s+market|cap\s+rate))/i
    );
    if (m && m[1].replace(/,/g, '').length >= 4) return '$' + m[1];

    return null;
  }

  function extractCrexiHeader() {
    // Pulls days_on_market and updated_days_ago from the price-banner area.
    // The banner separator varies (pipe, bullet, en-dash, just whitespace),
    // so we use independent regexes on body innerText.
    const text = document.body?.innerText || '';
    const dom = text.match(/(\d+)\s+days?\s+on\s+market/i);
    const upd = text.match(/Updated\s+(\d+)\s+days?\s+ago/i);
    return {
      days_on_market: dom ? dom[1] : null,
      updated_days_ago: upd ? upd[1] : null,
    };
  }

  function extractCrexiBuildingName(address) {
    // CREXi places a small subtitle line between the price banner and the
    // Request Info button. For govt-leased properties this is where the
    // tenant identity actually appears as structured copy — "GSA EPA
    // Laboratory", "Athens VA Clinic, 9249 US-29, Athens, GA 30601",
    // etc. Without this, the domain classifier sees only generic labels
    // ("Office", "Medical Office") and falls back to no_domain.
    const text = document.body?.innerText || '';
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const PRICE_BANNER = /\$\d[\d,]*\s*\|\s*\d+\s*days?\s+on\s+market/i;
    const SKIP_LINE = /^(opportunity\s+zone|request\s+info|view\s+om|details|share|save|print|notes|lcc\s+context|street\s+view|view\s+map|\d+\s+photos?)$/i;
    const STOP_LINE = /^(details|marketing\s+description|investment\s+highlights?|location|property\s+overview|in\s+the\s+area)$/i;
    for (let i = 0; i < lines.length - 1; i++) {
      if (!PRICE_BANNER.test(lines[i])) continue;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const candidate = lines[j];
        if (!candidate) continue;
        if (STOP_LINE.test(candidate)) return null;
        if (SKIP_LINE.test(candidate)) continue;
        if (/^\$[\d,]+(?:\.\d+)?$/.test(candidate)) continue;
        if (candidate.length < 4 || candidate.length > 200) continue;
        // CREXi often renders "<Building Name>, <full address>". Strip the
        // address and return the building name on its own.
        if (address && candidate.includes(address)) {
          const name = candidate.replace(address, '').replace(/[,\s]+$/, '').replace(/^[,\s]+/, '').trim();
          if (name.length >= 3 && name.length <= 120) return name;
          continue;
        }
        return candidate;
      }
      break;
    }
    return null;
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
      // Allow up to 4 children so a heading with a tooltip / icon doesn't
      // disqualify the label.
      if (el.children.length > 4) continue;
      const t = (el.textContent || '').trim();
      if (t.length > 60) continue;
      if (/^marketing\s+description$/i.test(t)) { labelEl = el; break; }
    }
    if (!labelEl) {
      // Fallback: try to find a long descriptive paragraph after a known
      // CREXi heading like "Property Overview" or "Investment Highlights".
      const headings = document.querySelectorAll('h1, h2, h3, h4');
      for (const h of headings) {
        const ht = (h.textContent || '').trim();
        if (!/^(property\s+overview|investment\s+highlights?|description|overview)$/i.test(ht)) continue;
        labelEl = h;
        break;
      }
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
    // next named section (Investment Highlights, Location, etc.). When the
    // label has no useful next siblings (markup wraps each block in its
    // own div), climb to the label's parent and walk its next siblings.
    const SECTION_BREAK = /^(details|location|gallery|photos?|contacts?|brokers?|map|highlights?|investment\s+highlights?|in\s+the\s+area|demographics?|nearby|similar\s+(properties|listings)|property\s+overview|tax(?:es)?|public\s+records?|comparables?|sale\s+comp|lease\s+data|record)$/i;
    const collect = (start) => {
      let cursor = start;
      let collected = '';
      while (cursor && collected.length < 5000) {
        const ct = (cursor.textContent || '').trim();
        const firstLine = (ct.split('\n')[0] || '').trim();
        if (firstLine && SECTION_BREAK.test(firstLine)) break;
        if (ct) collected += (collected ? '\n\n' : '') + ct;
        cursor = cursor.nextElementSibling;
      }
      return collected;
    };
    let collected = collect(labelEl.nextElementSibling);
    if (collected.length < 100 && labelEl.parentElement) {
      // Try one level up — CREXi often wraps each section in its own div.
      const parentCollected = collect(labelEl.parentElement.nextElementSibling);
      if (parentCollected.length > collected.length) collected = parentCollected;
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

  // Round 76ej.k (2026-05-04): light text-pattern extractor for facts
  // that brokers describe in prose but CREXi's structured Details panel
  // doesn't surface — expense_structure (Triple-Net), remaining_term,
  // lease_expiration year/month, renewal_options, and rent escalation
  // percentage. Conservative: emits null when patterns don't match
  // cleanly. Used as a fallback only — never overwrites a structured
  // value. Tagged in provenance as `crexi_sidebar_description` at lower
  // trust than the structured Details panel.
  function extractCrexiLeaseFromDescription(desc) {
    const out = {
      expense_structure:    null,
      remaining_term_years: null,
      lease_expiration_text:null,
      renewal_options_text: null,
      rent_escalations_pct: null,
    };
    if (!desc || typeof desc !== 'string' || desc.length < 50) return out;
    // Cap how much we scan — marketing descriptions are normally ≤5K
    // chars, but if a section accidentally bled into our description we
    // don't want to regex against the whole page.
    const text = desc.length > 8000 ? desc.slice(0, 8000) : desc;

    // Expense structure: "Triple-Net (NNN)" / "Double-Net (NN)" /
    // "Absolute Net" / bare "NNN" / "Modified Gross". Order matters —
    // longer, more specific phrases first so "NNN" doesn't shadow
    // "Triple-Net (NNN)".
    const expensePats = [
      [/\babsolute\s*(?:triple\s*)?net\b/i, 'Absolute NNN'],
      [/\btriple[-\s]?net\s*\(?\s*nnn\s*\)?\b/i, 'NNN'],
      [/\bdouble[-\s]?net\s*\(?\s*nn\s*\)?\b/i, 'NN'],
      [/\bmodified\s+gross\b/i, 'Modified Gross'],
      [/\b(?:full\s+service\s+)?gross\s+lease\b/i, 'Gross'],
      [/\bnnn\b/i, 'NNN'],
      [/\bnn\b/i, 'NN'],
    ];
    for (const [re, canonical] of expensePats) {
      if (re.test(text)) { out.expense_structure = canonical; break; }
    }

    // Remaining term: "9.5 years remaining" / "13+ years of remaining
    // lease term" / "approximately 5 years left on the lease".
    const remTerm = text.match(
      /(\d+(?:\.\d+)?)\s*\+?\s*years?\s+(?:of\s+)?(?:remaining|left)\s+(?:on\s+the\s+)?(?:lease(?:\s+term)?)?/i
    );
    if (remTerm) {
      const n = parseFloat(remTerm[1]);
      if (Number.isFinite(n) && n > 0 && n < 50) out.remaining_term_years = n;
    }

    // Lease expiration: "extending the firm term through October 2035" /
    // "expires in 2035" / "lease expires October 2035" / "through 2035".
    // Anchor on lease/expir/term/through to avoid grabbing arbitrary
    // years from the description ("built in 2014", etc.).
    const expDate = text.match(
      /(?:lease\s+(?:expir|end|term)|expir(?:ing|es|ation)?|firm\s+term|through(?:\s+October|\s+\w+)?)\s*[a-z\s,]{0,30}?\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d{2}|(?:19|20)\d{2})\b/i
    );
    if (expDate) {
      const parsed = String(expDate[1]).trim();
      // Sanity-check: year should be in [current_year - 1, current_year + 50]
      const yearMatch = parsed.match(/(19|20)\d{2}/);
      if (yearMatch) {
        const y = parseInt(yearMatch[0], 10);
        const nowY = new Date().getFullYear();
        if (y >= nowY - 1 && y <= nowY + 50) out.lease_expiration_text = parsed;
      }
    }

    // Renewal options: "one five-year renewal option" / "(2) 5-year
    // renewal options" / "two 5-year options". Return the matched
    // phrase verbatim so downstream parsers see broker phrasing.
    const renewalPhrase = text.match(
      /(?:\(?\b(\d+|one|two|three|four|five)\b\)?\s+)?\b(\d+|five|ten|seven|three)\b[-\s]?year\s+(?:renewal\s+)?options?/i
    );
    if (renewalPhrase) {
      const phrase = renewalPhrase[0].trim().replace(/\s+/g, ' ');
      if (phrase.length < 80) out.renewal_options_text = phrase;
    }

    // Rent escalations: "10% increase" / "2% annual bumps" / "rent
    // escalations of 10%". Reject percentages over 50% (probably not
    // a rent bump — could be cap rate or occupancy).
    const escalation = text.match(
      /(\d+(?:\.\d+)?)\s*%\s*(?:annual\s+)?(?:rent\s+)?(?:increase|bump|escalation|step[-\s]?up)/i
    );
    if (escalation) {
      const n = parseFloat(escalation[1]);
      if (Number.isFinite(n) && n > 0 && n <= 50) out.rent_escalations_pct = n;
    }

    return out;
  }

  function extractCrexiContacts() {
    // CREXi broker cards are rendered one per agent. Each card contains
    // name, license id ("MI 6501461017"), "View phone number" / "View email"
    // buttons, and the firm name/logo. Anchoring on "View phone number"
    // gives one DOM node per card; we then climb to a stable container.
    //
    // CREXi wraps each "View phone number" / "View email" label in a button
    // that ALSO contains an icon SVG. We accept up to 4 children so the icon
    // doesn't disqualify the marker — what matters is the trimmed text.
    const phoneMarkers = [];
    const emailMarkers = [];
    document.querySelectorAll('a, button, span, div').forEach((el) => {
      if (el.children.length > 4) return;
      const t = (el.textContent || '').trim();
      if (t.length > 40) return;
      if (/view\s+phone\s+number/i.test(t)) phoneMarkers.push(el);
      else if (/view\s+email/i.test(t)) emailMarkers.push(el);
    });

    const cards = new Set();
    const seen = new WeakSet();
    const collectCard = (marker) => {
      let node = marker;
      for (let i = 0; i < 8 && node.parentElement; i += 1) {
        node = node.parentElement;
        if (seen.has(node)) continue;
        const text = node.innerText || node.textContent || '';
        // Card heuristic: contains name-like + view-action text and is
        // small enough to be a single broker card (not the whole page).
        if (text.length < 30 || text.length > 800) continue;
        if (!/view\s+(phone|email)/i.test(text)) continue;
        if (!/[A-Z][a-zA-Z'.\-]+\s+[A-Z][a-zA-Z'.\-]+/.test(text)) continue;
        seen.add(node);
        cards.add(node);
        return;
      }
    };
    phoneMarkers.forEach(collectCard);
    emailMarkers.forEach(collectCard);

    // Final fallback: any card-like container that mentions "Listed by",
    // "Brokerage", or carries a known broker firm name in its text. Helps
    // when CREXi A/B-tests the card markup and removes "View phone" labels.
    if (cards.size === 0) {
      document.querySelectorAll('div, section, article').forEach((node) => {
        if (seen.has(node)) return;
        const text = (node.innerText || node.textContent || '').trim();
        if (text.length < 30 || text.length > 800) return;
        if (!/^(listed\s+by|brokerage|listing\s+agent)\b/im.test(text)) return;
        seen.add(node);
        cards.add(node);
      });
    }

    // Round 76ej.j (2026-05-04): added Submit LOI / Make Offer /
    // Submit Offer / Schedule Tour — Tampa listing test (intake
    // 6eb9f765, 2205 W Kennedy) showed "Submit LOI" landing as a
    // second listing broker. Anchored ^...$ so legitimate names that
    // contain these words (rare) aren't false-positived.
    const NAME_BLACKLIST = /^(view\s+(phone|email|om|map|photos?|virtual\s+tour|street\s+view)|listed\s+by|brokerage|real\s+estate|street\s+view|virtual\s+tour|request\s+(info|tour)|contact\s+broker|save|share|print|listing\s+contacts?|no\s+longer\s+for\s+sale|off\s+market|closed|submit\s+(loi|offer)|make\s+offer|schedule\s+(a\s+)?tour|add\s+(to\s+)?favorites?|sign\s+(in|up)|see\s+more|read\s+more|view\s+(more|all|details))$/i;
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

      // Phone: CREXi gates the actual phone behind a "View phone number"
      // click, so the only digit string visible in the card text is usually
      // the agent's license id ("MI 6501461017"). Reject any 10-digit run
      // that's adjacent to a 2-letter state code (license format) or that
      // matches the digits we already extracted as `license`. Require the
      // formatted shape with at least one separator — bare 10-digit runs
      // are almost always license numbers on CREXi.
      let phoneRaw = null;
      const phoneScan = text.match(
        /(?:^|[^A-Z\d])(\(?(\d{3})\)?[\s.\-]\d{3}[\s.\-]\d{4})(?!\d)/
      );
      if (phoneScan) phoneRaw = phoneScan[1].trim();
      if (phoneRaw && license) {
        const licDigits = (license.match(/\d+/g) || []).join('');
        const phoneDigits = phoneRaw.replace(/\D/g, '');
        if (licDigits && phoneDigits && licDigits.includes(phoneDigits)) {
          phoneRaw = null;
        }
      }
      const emailMatch = text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);

      if (!name && !phoneRaw && !emailMatch) continue;
      contacts.push({
        role: 'listing_broker',
        name: name || null,
        company: company || null,
        license: license || null,
        phones: phoneRaw ? [phoneRaw] : [],
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
