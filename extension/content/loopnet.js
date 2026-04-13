// ============================================================================
// LCC Assistant — Content Script: LoopNet
// Detects property listing pages and extracts CRE data
// ============================================================================

(function () {
  'use strict';

  let lastDetectedAddress = null;

  const observer = new MutationObserver(() => {
    const url = window.location.href;

    // LoopNet listing pages: /Listing/*, /commercial-real-estate/*
    if (
      !url.includes('/Listing/') &&
      !url.includes('/commercial-real-estate') &&
      !url.includes('/property/') &&
      !url.includes('/for-sale/') &&
      !url.includes('/for-lease/')
    ) return;

    const address = extractAddress();
    if (!address || address === lastDetectedAddress) return;
    lastDetectedAddress = address;

    // --- Property Facts map ---
    const facts = extractPropertyFacts();
    const get = (...keys) => {
      for (const k of keys) {
        const v = facts[k.toLowerCase()];
        if (v) return v;
      }
      return null;
    };

    const asking_price   = get('price', 'asking price', 'sale price');
    const cap_rate       = get('cap rate');
    const noi            = get('noi', 'net operating income');
    const price_per_sf   = get('price per sf', 'price / sf', 'price/sf');
    const building_size  = get('building size', 'total bldg. size', 'rentable sf');
    const lot_size       = get('lot size', 'land area', 'acres');
    const year_built     = get('year built');
    const building_class = get('building class', 'class');
    const parking        = get('parking', 'parking spaces', 'parking ratio');
    const zoning         = get('zoning');
    const occupancy      = get('occupancy', 'percent leased');
    const stories        = get('stories', 'building height', 'number of stories');
    const property_type  = get('property type', 'sale type');
    const tenancy_type   = get('tenancy');
    const building_far   = get('building far');
    const opportunity_zone = get('opportunity zone');

    const { city, state, zip } = extractCityStateZip();
    const parcel   = extractParcel();
    const saleData = extractLastSale();
    const brokers  = extractBrokers();
    const tenant   = extractTenantName();

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain:            'loopnet',
        entity_type:       'property',
        address,
        page_url:          url,
        city,
        state,
        zip_code:          zip,
        asking_price,
        cap_rate,
        noi,
        price_per_sf,
        property_type,
        building_class,
        year_built,
        square_footage:    building_size,
        lot_size,
        stories,
        parking,
        zoning,
        occupancy,
        tenancy_type,
        building_far,
        opportunity_zone,
        tenant_name:       tenant,
        parcel_number:     parcel.parcel_number,
        land_value:        parcel.land_value,
        improvement_value: parcel.improvement_value,
        assessed_value:    parcel.assessed_value,
        sale_price:        saleData.sale_price,
        sale_date:         saleData.sale_date,
        listing_id:        saleData.listing_id,
        date_on_market:    saleData.date_on_market,
        last_updated:      saleData.last_updated,
        contacts:          brokers,
        tenants:           tenant ? [{ name: tenant, sf: building_size }] : [],
      },
    });

    // Inject LCC button next to the heading
    const headingEl = document.querySelector('h1');
    injectLccButton(headingEl);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ==========================================================================
  // Extraction helpers
  // ==========================================================================

  /** 1. ADDRESS — street address only, not the full h1 block */
  function extractAddress() {
    // Try specific address element first
    const addrEl =
      document.querySelector('[data-testid="listing-address"]') ||
      document.querySelector('.listing-hero-address') ||
      document.querySelector('[class*="listingAddress"]') ||
      document.querySelector('[class*="listing-address"]');
    if (addrEl) return addrEl.textContent.trim();

    // Fall back: get h1 text but take only the line that looks like
    // a street address (starts with a number or known street pattern)
    const h1 = document.querySelector('h1');
    if (!h1) return null;
    const lines = h1.textContent.split('\n')
      .map(l => l.trim()).filter(Boolean);
    // Street address = line starting with a number
    const streetLine = lines.find(l => /^\d+\s+\w/.test(l));
    if (streetLine) return streetLine;
    // Last fallback: return first line only
    return lines[0] || null;
  }

  /** 2. CITY / STATE / ZIP — parse from address block or breadcrumbs */
  function extractCityStateZip() {
    const BUILDING_NOISE = /\b(sf|office|building|industrial|retail|medical|warehouse|flex|mixed|suite|floor|sq\s*ft|sqft|story|stories|class|bldg|gross|net|leasable)\b/i;

    // Look for "City, ST XXXXX" pattern anywhere in the header area
    const headerArea =
      document.querySelector('[class*="listingHero"]') ||
      document.querySelector('[class*="listing-hero"]') ||
      document.querySelector('[class*="profile-hero"]') ||
      document.querySelector('header') ||
      document.body;

    const text = headerArea.textContent || '';
    // Match "Tulsa, OK 74131" pattern
    const match = text.match(/([A-Za-z][A-Za-z\s]{0,40}),\s*([A-Z]{2})\s+(\d{5})/);
    if (match && !BUILDING_NOISE.test(match[1])) {
      return { city: match[1].trim(), state: match[2], zip: match[3] };
    }

    // If the body-level match had noise, do a targeted scan — look only
    // in elements that are small (< 50 chars) and match City, ST ZIP:
    const allText = document.querySelectorAll('p, span, div, h2, h3, li');
    for (const el of allText) {
      const t = el.textContent?.trim() || '';
      if (t.length > 50 || t.length < 5) continue;
      const m = t.match(/^([A-Za-z][A-Za-z\s]{1,30}),\s*([A-Z]{2})\s+(\d{5})$/);
      if (m && !BUILDING_NOISE.test(m[1])) {
        return { city: m[1].trim(), state: m[2], zip: m[3] };
      }
    }

    // Fallback: check breadcrumbs
    const crumbs = document.querySelectorAll('[class*="breadcrumb"] a, nav a');
    for (const crumb of crumbs) {
      const m = crumb.textContent.match(/([A-Za-z\s]+),\s*([A-Z]{2})/);
      if (m) return { city: m[1].trim(), state: m[2], zip: null };
    }
    return { city: null, state: null, zip: null };
  }

  /** 3. PROPERTY FACTS — scrape as key→value map */
  function extractPropertyFacts() {
    const facts = {};

    // LoopNet Property Facts: try definition list, table rows, or
    // adjacent label/value div pairs
    const containers = document.querySelectorAll(
      '[class*="propertyFact"], [class*="property-fact"], ' +
      '[class*="PropertyFact"], [class*="dataPoint"], ' +
      'dl, table.property-details, [class*="details-table"]'
    );

    for (const container of containers) {
      // Definition list pattern
      const dts = container.querySelectorAll('dt');
      for (const dt of dts) {
        const dd = dt.nextElementSibling;
        if (dd?.tagName === 'DD') {
          facts[dt.textContent.trim().toLowerCase()] = dd.textContent.trim();
        }
      }
      // Table row pattern
      const rows = container.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td, th');
        if (cells.length === 2) {
          facts[cells[0].textContent.trim().toLowerCase()] =
            cells[1].textContent.trim();
        }
      }
    }

    // Also scan adjacent div pairs in the page (LoopNet's SPA layout)
    const KNOWN_LABELS = [
      'price', 'cap rate', 'noi', 'price per sf',
      'building size', 'lot size', 'year built', 'building class',
      'parking', 'zoning', 'occupancy', 'tenancy', 'stories',
      'sale type', 'property type', 'building far', 'opportunity zone',
    ];
    const allDivs = document.querySelectorAll('div, span');
    for (const el of allDivs) {
      const elText = el.textContent?.trim() || '';
      if (elText.length < 2 || elText.length > 60 || el.children.length > 1) continue;
      const lower = elText.toLowerCase();
      if (!KNOWN_LABELS.some(l => lower.includes(l))) continue;
      const next = el.nextElementSibling;
      if (next && next.textContent?.trim()) {
        facts[lower] = next.textContent.trim();
      }
    }

    // Also pull from the legacy findTextElement approach for any remaining gaps
    const LEGACY_MAPPINGS = [
      ['price', 'Price', 'Asking Price', 'Sale Price'],
      ['cap rate', 'Cap Rate'],
      ['noi', 'NOI', 'Net Operating Income'],
      ['price per sf', 'Price/SF', 'Price / SF', 'Price Per SF'],
      ['property type', 'Property Type', 'Property Subtype', 'Type'],
      ['building class', 'Building Class', 'Class'],
      ['year built', 'Year Built', 'Year Renovated'],
      ['building size', 'Building Size', 'Total Bldg. Size', 'Rentable SF', 'GLA', 'Total SF', 'Square Feet'],
      ['lot size', 'Lot Size', 'Land Area', 'Acres'],
      ['stories', 'Number of Stories', 'Stories', 'Floors'],
      ['parking', 'Parking Spaces', 'Parking Ratio', 'Parking'],
      ['zoning', 'Zoning', 'Zone'],
      ['occupancy', 'Occupancy', 'Percent Leased', '% Leased'],
      ['tenancy', 'Tenancy', 'Tenant'],
    ];
    for (const [key, ...keywords] of LEGACY_MAPPINGS) {
      if (!facts[key]) {
        const el = findTextElement(...keywords);
        if (el?.textContent?.trim()) {
          facts[key] = el.textContent.trim();
        }
      }
    }

    return facts;
  }

  /** 4. TENANT NAME — from listing title or Major Tenants data table only */
  function extractTenantName() {
    // Primary: listing title "DaVita Dialysis | Tulsa, OK"
    const h1 = document.querySelector('h1');
    if (h1) {
      const firstLine = (h1.textContent.split('\n')[0] || '').trim();
      const pipeIdx = firstLine.indexOf('|');
      if (pipeIdx > 0) {
        const candidate = firstLine.substring(0, pipeIdx).trim();
        if (candidate.length > 2 &&
            candidate.length < 80 &&
            !/^\d/.test(candidate) &&
            !/https?:/.test(candidate) &&
            !/public\s+record|more\s+(public|information)|nearby|neighborhood|properties\s+in/i.test(candidate)) {
          return candidate;
        }
      }
    }

    // Secondary: look ONLY inside an element whose text is exactly
    // "Major Tenants" for a non-link text value
    const headers = document.querySelectorAll('h2, h3, h4');
    for (const h of headers) {
      if (!/^major\s+tenants$/i.test(h.textContent.trim())) continue;
      // Walk the next sibling or parent's next sibling for tenant rows
      let block = h.nextElementSibling ||
                  h.parentElement?.nextElementSibling;
      if (!block) continue;
      // Reject blocks that are large sections (neighborhood content)
      if (block.textContent.length > 500) continue;
      // Look for a short non-link text that's a company name
      const els = block.querySelectorAll('td, strong, [class*="tenant"]');
      for (const el of els) {
        const t = el.textContent?.trim();
        if (!t || t.length < 2 || t.length > 80) continue;
        if (/nearby|neighborhood|office\s+properties|public\s+record|more\s+info|health\s+care|industry|sf\s+occupied|rent\/sf|lease\s+end/i.test(t)) continue;
        if (!/^\d/.test(t)) return t;
      }
    }
    return null;
  }

  /** 5. PARCEL / APN — from Property Taxes section */
  function extractParcel() {
    const taxSection = Array.from(document.querySelectorAll('h2,h3,h4,div,p'))
      .find(el => /property\s+tax/i.test(el.textContent?.trim() || ''));
    if (!taxSection) return {};

    const block = taxSection.parentElement || taxSection.nextElementSibling;
    if (!block) return {};
    const text = block.textContent || '';
    const parcelMatch = text.match(/Parcel\s+Number\s*[:\s]+([0-9A-Z-]+)/i);
    const landMatch   = text.match(/Land\s+Assessment\s*[:\s]+\$?([\d,]+)/i);
    const imprvMatch  = text.match(/Improvements?\s+Assessment\s*[:\s]+\$?([\d,]+)/i);
    const totalMatch  = text.match(/Total\s+Assessment\s*[:\s]+\$?([\d,]+)/i);

    return {
      parcel_number:     parcelMatch?.[1] || null,
      land_value:        landMatch?.[1]   ? '$' + landMatch[1] : null,
      improvement_value: imprvMatch?.[1]  ? '$' + imprvMatch[1] : null,
      assessed_value:    totalMatch?.[1]  ? '$' + totalMatch[1] : null,
    };
  }

  /** 6. BROKERS / CONTACTS — from the Contacts section */
  function extractBrokers() {
    const contacts = [];
    // Find the contacts section — take FIRST match only (LoopNet duplicates
    // its DOM for desktop/mobile rendering)
    const contactSection = Array.from(document.querySelectorAll(
      'h2, h3, h4, [class*="contactSection"], [class*="contact-section"]'
    )).find(el => /^contacts?$/i.test(el.textContent?.trim() || ''));
    if (!contactSection) return contacts;

    const block = contactSection.nextElementSibling ||
                  contactSection.parentElement?.nextElementSibling;
    if (!block) return contacts;

    // Try to find the listing company for all brokers
    const brokerageEl = findTextElement('Brokerage', 'Listing Company',
                                        'Listed By', 'Company');
    let brokerageName = brokerageEl?.textContent?.trim() || null;

    // Also try extracting from "Presented by" text near the contacts section
    if (!brokerageName) {
      const presentedBy = Array.from(document.querySelectorAll('p,span,div'))
        .find(el => /^presented\s+by/i.test(el.textContent?.trim() || ''));
      if (presentedBy) {
        const firmEl = presentedBy.nextElementSibling ||
                       presentedBy.parentElement?.querySelector('a, strong');
        if (firmEl) brokerageName = firmEl.textContent.trim();
      }
    }

    // Each broker is in a list item or card
    const items = block.querySelectorAll(
      'li, [class*="contact"], [class*="agent"], [class*="broker"]'
    );
    for (const item of items) {
      const nameEl = item.querySelector(
        '[class*="name"], strong, a, h3, h4, [class*="agent-name"]'
      );
      const name = nameEl?.textContent?.trim();
      if (!name || name.length < 3 || name.length > 80) continue;
      const phoneEl = item.querySelector('[href^="tel:"], [class*="phone"]');
      const emailEl = item.querySelector('[href^="mailto:"], [class*="email"]');
      contacts.push({
        role: 'listing_broker',
        type: 'person',
        name,
        company: brokerageName,
        phone: phoneEl?.textContent?.trim() || phoneEl?.href?.replace('tel:', '') || null,
        email: emailEl?.textContent?.trim() || emailEl?.href?.replace('mailto:', '') || null,
      });
    }

    // Fallback: simple single-broker layout via findTextElement
    if (contacts.length === 0) {
      const brokerNameEl = findTextElement('Listing Agent', 'Broker', 'Listed By');
      if (brokerNameEl) {
        contacts.push({
          role: 'listing_broker',
          type: 'person',
          name:    brokerNameEl.textContent.trim(),
          company: brokerageName,
        });
      }
    }

    // Dedup by name and detect firm entries
    const FIRM_PATTERN = /\b(LLC|Inc|Corp|Ltd|LP|LLP|Group|Partners|Associates|Advisors|Realty|Properties|Capital|Investments|Commercial|Retail|Real\s+Estate|Investment|Brokerage|CBRE|Colliers|Marcus|Cushman|JLL|Northmarq|Hanley|Marcus\s+&\s+Millichap|Trinity|Avison|Newmark|KW|Keller)\b/i;
    const seen = new Set();
    const deduped = [];
    let firmName = null;

    for (const c of contacts) {
      // Detect firm entries
      if (FIRM_PATTERN.test(c.name)) {
        firmName = c.name;  // capture firm, don't add as person
        continue;
      }
      if (seen.has(c.name.toLowerCase())) continue;
      seen.add(c.name.toLowerCase());
      deduped.push(c);
    }

    // Assign the firm to all people
    if (firmName) {
      for (const c of deduped) {
        c.company = c.company || firmName;
      }
    }

    return deduped;
  }

  /** 7. LAST SALE — sale history and listing metadata */
  function extractLastSale() {
    const salePriceEl   = findTextElement('Sale Price', 'Last Sale Price');
    const saleDateEl    = findTextElement('Sale Date', 'Last Sale Date');
    // Note: explicitly exclude 'Last Updated' and 'Date on Market'
    // from sale_date — those are listing metadata, not transaction dates
    const listingIdEl   = findTextElement('Listing ID');
    const dateOnMarket  = findTextElement('Date on Market');
    const lastUpdatedEl = findTextElement('Last Updated');

    return {
      sale_price:     salePriceEl?.textContent?.trim()    || null,
      sale_date:      saleDateEl?.textContent?.trim()     || null,
      listing_id:     listingIdEl?.textContent?.trim()    || null,
      date_on_market: dateOnMarket?.textContent?.trim()   || null,
      last_updated:   lastUpdatedEl?.textContent?.trim()  || null,
    };
  }

  // ==========================================================================
  // Shared utilities
  // ==========================================================================

  function findTextElement(...keywords) {
    const kwLower = keywords.map((k) => k.toLowerCase());

    // Strategy 1: Semantic label elements
    const labelEls = document.querySelectorAll(
      'label, dt, th, .label, [class*="label"], [class*="Label"], ' +
      '.data-points-label, .detail-label'
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
            'dd, td, .value, [class*="value"], [class*="Value"], ' +
            '.data-points-value, .detail-value'
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
