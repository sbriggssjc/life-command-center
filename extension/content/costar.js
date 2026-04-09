// ============================================================================
// LCC Assistant — Content Script: CoStar
// Detects property detail pages and injects "LCC Context" button
// ============================================================================

(function () {
  'use strict';

  let lastDetectedAddress = null;

  const observer = new MutationObserver(() => {
    // CoStar property detail pages typically have /property/ or /lease/ in URL
    const url = window.location.href;
    if (
      !url.includes('/property') &&
      !url.includes('/lease') &&
      !url.includes('/detail') &&
      !url.includes('/comp') &&
      !url.includes('/listing') &&
      !url.includes('/asset')
    ) return;

    // Extract property address from heading or page title
    const headingEl =
      document.querySelector('h1[class*="property"]') ||
      document.querySelector('[data-testid="property-name"]') ||
      document.querySelector('.property-header h1') ||
      document.querySelector('h1');

    const address = headingEl?.textContent?.trim();
    if (!address || address === lastDetectedAddress) return;
    lastDetectedAddress = address;

    // Extract financial data
    const priceEl = document.querySelector('[data-testid="asking-price"]') ||
      document.querySelector('.asking-price') ||
      findTextElement('Price', 'Asking');
    const capRateEl = document.querySelector('[data-testid="cap-rate"]') ||
      document.querySelector('.cap-rate') ||
      findTextElement('Cap Rate');
    const leaseTermEl = findTextElement('Lease Term', 'Remaining Term');

    // Property details
    const propertyTypeEl = findTextElement('Property Type', 'Property Subtype', 'Asset Type');
    const buildingClassEl = findTextElement('Building Class');
    const yearBuiltEl = findTextElement('Year Built');
    const sqftEl = findTextElement('Building Size', 'Rentable SF', 'RSF', 'GLA', 'Total SF', 'Square Feet');
    const lotSizeEl = findTextElement('Land Area', 'Lot Size', 'Acres');
    const storiesEl = findTextElement('Number of Stories', 'Stories', 'Floors');
    const unitsEl = findTextElement('Number of Units', 'Total Units');
    const parkingEl = findTextElement('Parking Spaces', 'Parking Ratio', 'Parking');
    const zoningEl = findTextElement('Zoning', 'Zone');

    // Additional financial
    const noiEl = findTextElement('NOI', 'Net Operating Income');
    const psfEl = findTextElement('Price/SF', 'Price Per SF');
    const occupancyEl = findTextElement('Occupancy', 'Percent Leased');

    // Tenancy, ownership, broker
    const tenantEl = findTextElement('Tenant', 'Primary Tenant', 'Major Tenant');
    const ownerEl = findTextElement('True Owner', 'Record Owner', 'Owner');
    const brokerEl = findTextElement('Listing Agent', 'Broker', 'Listed By');
    const brokerCoEl = findTextElement('Brokerage', 'Listing Company');

    // Sale history
    const salePriceEl = findTextElement('Sale Price', 'Last Sale Price');
    const saleDateEl = findTextElement('Sale Date', 'Last Sale Date');

    // Location (if shown separately from heading)
    const cityEl = findTextElement('City', 'Municipality');
    const stateEl = findTextElement('State');

    const val = (el) => el?.textContent?.trim() || null;

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'costar',
        entity_type: 'property',
        address,
        page_url: url,
        asking_price: val(priceEl),
        cap_rate: val(capRateEl),
        lease_term: val(leaseTermEl),
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
        tenant_name: val(tenantEl),
        owner_name: val(ownerEl),
        broker_name: val(brokerEl),
        broker_company: val(brokerCoEl),
        sale_price: val(salePriceEl),
        sale_date: val(saleDateEl),
        city: val(cityEl),
        state: val(stateEl),
      },
    });

    injectLccButton(headingEl);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  function findTextElement(...keywords) {
    const labels = document.querySelectorAll('label, dt, th, .label, [class*="label"]');
    for (const el of labels) {
      const text = el.textContent?.toLowerCase() || '';
      if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
        // Return the adjacent value element
        const sibling = el.nextElementSibling;
        if (sibling) return sibling;
        const parent = el.parentElement;
        if (parent) {
          const value = parent.querySelector('dd, td, .value, [class*="value"]');
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
