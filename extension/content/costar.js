// ============================================================================
// LCC Assistant — Content Script: CoStar
// Detects property detail / sale comp pages and extracts CRE data
// ============================================================================

(function () {
  'use strict';

  let lastDetectedId = null;

  const observer = new MutationObserver(() => {
    const url = window.location.href;

    // Find the property heading — this is our entry signal
    const headingEl = findHeading();
    if (!headingEl) return;

    const rawTitle = headingEl.textContent?.trim();
    if (!rawTitle || rawTitle.length < 3) return;

    // Parse address from heading (handles "586 Rice St - Fresenius Medical Care")
    const address = parseAddress(rawTitle);
    if (!address) return;

    // De-duplicate using address + URL
    const pageId = address + '|' + url;
    if (pageId === lastDetectedId) return;
    lastDetectedId = pageId;

    // Extract city/state from subtitle near heading
    const locationInfo = findLocation(headingEl);

    const val = (el) => el?.textContent?.trim() || null;

    // Financial
    const priceEl = findField('Asking Price', 'Sale Price', 'Price', 'List Price');
    const capRateEl = findField('Cap Rate', 'Actual Cap Rate');
    const noiEl = findField('NOI', 'Net Operating Income');
    const psfEl = findField('Price/SF', 'Price Per SF', 'Price / SF');

    // Property details
    const propertyTypeEl = findField('Property Type', 'Property Subtype', 'Asset Type');
    const buildingClassEl = findField('Building Class', 'Class');
    const yearBuiltEl = findField('Year Built', 'Built');
    const sqftEl = findField('RBA', 'SF RBA', 'Building Size', 'Rentable SF', 'GLA', 'Total SF');
    const lotSizeEl = findField('Land Acres', 'Land Area', 'Lot Size', 'Acres', 'Land SF');
    const storiesEl = findField('Stories', 'Number of Stories', 'Floors');
    const unitsEl = findField('Number of Units', 'Total Units');
    const parkingEl = findField('Parking Spaces', 'Parking Ratio', 'Parking');
    const zoningEl = findField('Zoning', 'Zone');

    // Occupancy
    const occupancyEl = findField('Leased at Sale', 'Occupancy', 'Percent Leased', '% Leased');
    const leaseTermEl = findField('Lease Term', 'Remaining Term');

    // Tenancy, ownership, broker
    const tenantEl = findField('Tenants at Sale', 'Tenant', 'Primary Tenant', 'Major Tenant');
    const ownerEl = findField('Recorded Seller', 'Seller', 'True Owner', 'Record Owner', 'Owner');
    const brokerEl = findField('Listing Broker', 'Listing Agent', 'Broker', 'Listed By');
    const brokerCoEl = findField('Brokerage', 'Listing Company');

    // Sale
    const salePriceEl = findField('Sale Price', 'Last Sale Price');
    const saleDateEl = findField('Sale Date', 'Last Sale Date');

    // Location fallback
    const cityEl = findField('City', 'Municipality');
    const stateEl = findField('State');

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'costar',
        entity_type: 'property',
        address,
        page_url: url,
        asking_price: val(priceEl),
        cap_rate: val(capRateEl),
        noi: val(noiEl),
        price_per_sf: val(psfEl),
        property_type: val(propertyTypeEl),
        building_class: val(buildingClassEl),
        year_built: val(yearBuiltEl),
        square_footage: val(sqftEl),
        lot_size: val(lotSizeEl),
        stories: val(storiesEl),
        units: val(unitsEl),
        parking: val(parkingEl),
        zoning: val(zoningEl),
        occupancy: val(occupancyEl),
        lease_term: val(leaseTermEl),
        tenant_name: val(tenantEl),
        owner_name: val(ownerEl),
        broker_name: val(brokerEl),
        broker_company: val(brokerCoEl),
        sale_price: val(salePriceEl),
        sale_date: val(saleDateEl),
        city: locationInfo.city || val(cityEl),
        state: locationInfo.state || val(stateEl),
      },
    });

    injectLccButton(headingEl);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ── Heading & address extraction ──────────────────────────────────────

  function findHeading() {
    // Try CoStar-specific selectors first, then fall back to generic h1
    return document.querySelector('h1[class*="property"]') ||
      document.querySelector('[data-testid="property-name"]') ||
      document.querySelector('.property-header h1') ||
      document.querySelector('[class*="propertyName"]') ||
      document.querySelector('[class*="address"]') ||
      document.querySelector('h1');
  }

  function parseAddress(rawTitle) {
    if (!rawTitle) return null;

    // Split on " - " or " – " to separate "586 Rice St - Fresenius Medical Care"
    let addr = rawTitle.split(/\s+[-–—]\s+/)[0].trim();

    // Validate: looks like a street address (starts with number, or has street words)
    if (/^\d+\s/.test(addr) ||
      /\b(st|ave|blvd|dr|rd|ln|ct|pl|way|hwy|pkwy|pike|cir|loop|terr?)\b/i.test(addr)) {
      return addr;
    }

    // Fallback: use the full title if short enough
    if (rawTitle.length < 100) return rawTitle;
    return null;
  }

  function findLocation(headingEl) {
    const result = { city: null, state: null };

    // Gather candidates: siblings and nearby elements
    const candidates = [];
    let sibling = headingEl.nextElementSibling;
    for (let i = 0; i < 5 && sibling; i++) {
      candidates.push(sibling);
      sibling = sibling.nextElementSibling;
    }
    if (headingEl.parentElement) {
      for (const child of headingEl.parentElement.children) {
        if (child !== headingEl) candidates.push(child);
      }
    }

    for (const el of candidates) {
      const text = el.textContent?.trim() || '';
      // Match "Saint Paul, MN 55103" or "Saint Paul, MN"
      const match = text.match(/^([A-Za-z\s.]+),\s*([A-Z]{2})\s*(\d{5})?/);
      if (match) {
        result.city = match[1].trim();
        result.state = match[2];
        break;
      }
    }

    return result;
  }

  // ── Field extraction (multi-strategy) ─────────────────────────────────
  //
  // CoStar uses multiple layout patterns:
  //   1. Label-above-value: "Sale Date" / "Mar 27, 2026"
  //   2. Value-above-label (stat cards): "6.76%" / "Cap Rate"
  //   3. Inline label/value in table cells or definition lists
  //
  // The function tries all patterns and returns the first match.

  function findField(...keywords) {
    const kwLower = keywords.map((k) => k.toLowerCase());

    // Strategy 1: Semantic label elements (dt, th, label, .label, etc.)
    const labelSelectors = 'label, dt, th, .label, [class*="label"], [class*="Label"]';
    const labelEls = document.querySelectorAll(labelSelectors);
    for (const el of labelEls) {
      const text = el.textContent?.trim().toLowerCase() || '';
      if (text.length > 80) continue;
      if (kwLower.some((kw) => text.includes(kw))) {
        const sibling = el.nextElementSibling;
        if (sibling?.textContent?.trim()) return sibling;
        const parent = el.parentElement;
        if (parent) {
          const value = parent.querySelector('dd, td, .value, [class*="value"], [class*="Value"]');
          if (value && value !== el) return value;
        }
      }
    }

    // Strategy 2: Scan all compact elements (handles SPA card/tile layouts)
    // This catches both label-above-value AND value-above-label patterns.
    const allEls = document.querySelectorAll('div, span, p, td, li');
    for (const el of allEls) {
      const text = el.textContent?.trim() || '';
      if (text.length < 2 || text.length > 60) continue;
      // Skip containers with many children (those hold sections, not labels)
      if (el.children.length > 3) continue;

      const textLower = text.toLowerCase();
      if (!kwLower.some((kw) => textLower.includes(kw))) continue;

      // Label-above-value: next sibling holds the value
      const next = el.nextElementSibling;
      if (next) {
        const nText = next.textContent?.trim();
        if (nText && nText.length < 200 && nText.length > 0) return next;
      }

      // Value-above-label (stat cards): previous sibling holds the value
      const prev = el.previousElementSibling;
      if (prev) {
        const pText = prev.textContent?.trim();
        if (pText && pText.length < 200 && pText.length > 0) return prev;
      }

      // Parent's other children (card with 2-3 children: icon, value, label)
      const parent = el.parentElement;
      if (parent && parent.children.length <= 5) {
        for (const child of parent.children) {
          if (child === el) continue;
          const cText = child.textContent?.trim();
          if (cText && cText.length < 200 && cText.toLowerCase() !== textLower) {
            return child;
          }
        }
      }
    }

    return null;
  }

  // ── LCC Button injection ──────────────────────────────────────────────

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
