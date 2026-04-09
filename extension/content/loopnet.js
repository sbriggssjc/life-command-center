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

    // Extract address from heading
    const headingEl =
      document.querySelector('[data-testid="property-title"]') ||
      document.querySelector('.profile-hero-header h1') ||
      document.querySelector('.placard-header h1') ||
      document.querySelector('h1.listing-address') ||
      document.querySelector('h1');

    const address = headingEl?.textContent?.trim();
    if (!address || address === lastDetectedAddress) return;
    lastDetectedAddress = address;

    const val = (el) => el?.textContent?.trim() || null;

    // Financial
    const priceEl = findTextElement('Price', 'Asking Price', 'Sale Price') ||
      document.querySelector('[data-testid="price"]') ||
      document.querySelector('.price');
    const capRateEl = findTextElement('Cap Rate');
    const noiEl = findTextElement('NOI', 'Net Operating Income');
    const psfEl = findTextElement('Price/SF', 'Price / SF', 'Price Per SF');

    // Property details
    const propertyTypeEl = findTextElement('Property Type', 'Property Subtype', 'Type');
    const buildingClassEl = findTextElement('Building Class', 'Class');
    const yearBuiltEl = findTextElement('Year Built', 'Year Renovated');
    const sqftEl = findTextElement('Building Size', 'Total Bldg. Size', 'Rentable SF', 'GLA', 'Total SF', 'Square Feet');
    const lotSizeEl = findTextElement('Lot Size', 'Land Area', 'Acres');
    const storiesEl = findTextElement('Number of Stories', 'Stories', 'Floors');
    const unitsEl = findTextElement('Number of Units', 'Total Units', 'No. Units');
    const parkingEl = findTextElement('Parking Spaces', 'Parking Ratio', 'Parking');
    const zoningEl = findTextElement('Zoning', 'Zone');
    const occupancyEl = findTextElement('Occupancy', 'Percent Leased', '% Leased');

    // Lease
    const leaseTermEl = findTextElement('Lease Term', 'Remaining Term', 'Lease Type');
    const tenantEl = findTextElement('Tenant', 'Primary Tenant', 'Tenancy');

    // Broker
    const brokerEl = findTextElement('Listing Agent', 'Broker', 'Listed By', 'Contact');
    const brokerCoEl = findTextElement('Brokerage', 'Listing Company', 'Company');

    // Sale history
    const salePriceEl = findTextElement('Sale Price', 'Last Sale Price');
    const saleDateEl = findTextElement('Sale Date', 'Last Sale Date');

    // Location
    const cityStateEl = document.querySelector('.profile-hero-header h2') ||
      document.querySelector('.listing-city-state');
    let city = null;
    let state = null;
    const csText = cityStateEl?.textContent?.trim();
    if (csText) {
      const parts = csText.split(',').map((s) => s.trim());
      if (parts.length >= 2) {
        city = parts[0];
        state = parts[1].split(/\s+/)[0]; // "CA 90210" → "CA"
      }
    }
    if (!city) city = val(findTextElement('City', 'Municipality'));
    if (!state) state = val(findTextElement('State'));

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'loopnet',
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
    const labels = document.querySelectorAll('label, dt, th, .label, [class*="label"], [class*="Label"], .data-points-label, .detail-label');
    for (const el of labels) {
      const text = el.textContent?.toLowerCase() || '';
      if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
        const sibling = el.nextElementSibling;
        if (sibling) return sibling;
        const parent = el.parentElement;
        if (parent) {
          const value = parent.querySelector('dd, td, .value, [class*="value"], [class*="Value"], .data-points-value, .detail-value');
          if (value) return value;
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
