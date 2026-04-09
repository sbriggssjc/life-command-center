// ============================================================================
// LCC Assistant — Content Script: CREXi
// Detects property listing pages and extracts CRE data
// ============================================================================

(function () {
  'use strict';

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

    // Financial
    const priceEl = findTextElement('Price', 'Asking Price', 'List Price') ||
      document.querySelector('[data-cy="price"]') ||
      document.querySelector('.property-price');
    const capRateEl = findTextElement('Cap Rate');
    const noiEl = findTextElement('NOI', 'Net Operating Income');
    const psfEl = findTextElement('Price/SF', 'Price / SF', 'Price Per SF', '$/SF');

    // Property details
    const propertyTypeEl = findTextElement('Property Type', 'Type', 'Asset Class');
    const buildingClassEl = findTextElement('Building Class', 'Class');
    const yearBuiltEl = findTextElement('Year Built');
    const sqftEl = findTextElement('Building Size', 'SF', 'Square Feet', 'Total SF', 'GLA', 'Rentable Area');
    const lotSizeEl = findTextElement('Lot Size', 'Land Area', 'Acres', 'Land SF');
    const storiesEl = findTextElement('Stories', 'Floors', 'Number of Stories');
    const unitsEl = findTextElement('Units', 'Total Units', 'Number of Units');
    const parkingEl = findTextElement('Parking', 'Parking Spaces', 'Parking Ratio');
    const zoningEl = findTextElement('Zoning', 'Zone');
    const occupancyEl = findTextElement('Occupancy', 'Leased %', 'Percent Leased');

    // Lease
    const leaseTermEl = findTextElement('Lease Term', 'Lease Type', 'Remaining Term');
    const tenantEl = findTextElement('Tenant', 'Primary Tenant', 'Tenancy');

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

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'crexi',
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
        broker_name: val(brokerEl),
        broker_company: val(brokerCoEl),
        sale_price: val(salePriceEl),
        sale_date: val(saleDateEl),
        city,
        state,
      },
    });

    injectLccButton(headingEl);
  });

  observer.observe(document.body, { childList: true, subtree: true });

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
