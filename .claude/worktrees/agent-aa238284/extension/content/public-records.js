// ============================================================================
// LCC Assistant — Content Script: Public Records Scanner
// Heuristic scanner for county assessor, SOS, recorder of deeds, and other
// government / public records sites. Injected on-demand via SCAN_PAGE message.
// ============================================================================

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__lccPublicRecordsScanned) return;
  window.__lccPublicRecordsScanned = true;

  const url = window.location.href;
  const hostname = window.location.hostname.toLowerCase();

  // Classify the type of public records site
  const siteType = classifySite(hostname, url, document.title);

  // Scan the page based on type
  let data;
  if (siteType === 'assessor') {
    data = scanAssessor();
  } else if (siteType === 'recorder') {
    data = scanRecorder();
  } else if (siteType === 'sos') {
    data = scanSOS();
  } else {
    // Generic: try property first, fall back to business entity
    data = scanAssessor();
    if (!data.address && !data.parcel_number) {
      data = scanSOS();
    }
  }

  // Only send if we found something useful
  const hasData = Object.values(data).some((v) => v != null && v !== '');
  if (!hasData) {
    // Notify sidepanel that scan found nothing
    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'public-records',
        entity_type: 'unknown',
        scan_result: 'empty',
        site_type: siteType,
        page_url: url,
        page_title: document.title,
      },
    });
    return;
  }

  chrome.runtime.sendMessage({
    type: 'CONTEXT_DETECTED',
    data: {
      domain: 'public-records',
      site_type: siteType,
      page_url: url,
      page_title: document.title,
      ...data,
    },
  });

  // ── Site classification ──────────────────────────────────────────────────

  function classifySite(host, pageUrl, title) {
    const combined = (host + ' ' + pageUrl + ' ' + title).toLowerCase();

    if (/assessor|appraiser|property.?tax|parcel|cama|tax.?assess/.test(combined)) return 'assessor';
    if (/recorder|deed|document.?search|record.?search|grantor|grantee/.test(combined)) return 'recorder';
    if (/secretary.?of.?state|sos\.|business.?search|entity.?search|corp.?search|business.?filings/.test(combined)) return 'sos';

    return 'unknown';
  }

  // ── Assessor / Property Tax scanner ──────────────────────────────────────

  function scanAssessor() {
    return {
      entity_type: 'property',
      parcel_number: findValue('Parcel', 'APN', 'Parcel ID', 'Parcel Number', 'PIN', 'Tax ID', 'Parcel No', 'Account Number'),
      address: findValue('Property Address', 'Situs Address', 'Situs', 'Location', 'Site Address', 'Address') || extractAddressFromHeading(),
      owner_name: findValue('Owner', 'Owner Name', 'Property Owner', 'Taxpayer', 'Record Owner', 'Deed Owner'),
      mailing_address: findValue('Mailing Address', 'Mail Address', 'Owner Address'),
      assessed_value: findValue('Assessed Value', 'Total Assessed', 'Assessment', 'Total Value', 'Total Assessment'),
      market_value: findValue('Market Value', 'Fair Market Value', 'Appraised Value', 'Total Market', 'FMV'),
      land_value: findValue('Land Value', 'Land Assessed', 'Land Appraisal'),
      improvement_value: findValue('Improvement Value', 'Building Value', 'Improvements', 'Structure Value'),
      property_type: findValue('Property Type', 'Property Class', 'Class', 'Land Use', 'Use Code', 'Property Use'),
      year_built: findValue('Year Built', 'Yr Built', 'Year Constructed', 'Built'),
      square_footage: findValue('Building Size', 'Living Area', 'Square Feet', 'Sq Ft', 'Building SF', 'Total Area', 'Gross Area', 'Heated Area'),
      lot_size: findValue('Lot Size', 'Land Area', 'Lot Area', 'Acres', 'Acreage', 'Land Size'),
      zoning: findValue('Zoning', 'Zone', 'Zoning Code', 'Zoning Class'),
      tax_amount: findValue('Tax Amount', 'Annual Tax', 'Total Tax', 'Taxes', 'Tax Bill', 'Tax Due'),
      sale_price: findValue('Sale Price', 'Last Sale Price', 'Transfer Price', 'Sale Amount'),
      sale_date: findValue('Sale Date', 'Last Sale Date', 'Transfer Date', 'Date of Sale', 'Deed Date'),
      city: findValue('City', 'Municipality', 'Township'),
      state: findValue('State', 'County'),
    };
  }

  // ── Recorder of Deeds scanner ────────────────────────────────────────────

  function scanRecorder() {
    return {
      entity_type: 'property',
      document_type: findValue('Document Type', 'Instrument Type', 'Doc Type', 'Type'),
      grantor: findValue('Grantor', 'Seller', 'From'),
      grantee: findValue('Grantee', 'Buyer', 'To'),
      sale_price: findValue('Sale Price', 'Consideration', 'Amount', 'Transfer Tax', 'Value'),
      sale_date: findValue('Recording Date', 'Record Date', 'Filed Date', 'Sale Date', 'Date'),
      address: findValue('Property Address', 'Situs', 'Address', 'Location') || extractAddressFromHeading(),
      parcel_number: findValue('Parcel', 'APN', 'PIN', 'Parcel Number', 'Tax ID'),
      book_page: findValue('Book/Page', 'Book', 'Page', 'Instrument Number', 'Document Number'),
      legal_description: findValue('Legal Description', 'Legal', 'Description'),
    };
  }

  // ── Secretary of State / Business Entity scanner ─────────────────────────

  function scanSOS() {
    return {
      entity_type: 'organization',
      name: findValue('Entity Name', 'Business Name', 'Company Name', 'Corporation Name', 'Name', 'LLC Name', 'Filing Name'),
      filing_number: findValue('Filing Number', 'Entity Number', 'Entity ID', 'File Number', 'Charter Number', 'Registration Number'),
      status: findValue('Status', 'Entity Status', 'Filing Status', 'Standing'),
      formation_date: findValue('Formation Date', 'Date of Formation', 'Filing Date', 'Date Filed', 'Incorporation Date', 'Date Created'),
      entity_type_detail: findValue('Entity Type', 'Business Type', 'Filing Type', 'Organization Type', 'Structure'),
      state_of_formation: findValue('State of Formation', 'Jurisdiction', 'State of Incorporation', 'Domestic State'),
      registered_agent: findValue('Registered Agent', 'Agent', 'Agent Name', 'Statutory Agent'),
      agent_address: findValue('Agent Address', 'Registered Office', 'Office Address'),
      principal_address: findValue('Principal Address', 'Principal Office', 'Business Address', 'Mailing Address'),
      officers: findValue('Officers', 'Members', 'Directors', 'Managers', 'Principal'),
    };
  }

  // ── Generic field extraction ─────────────────────────────────────────────

  function findValue(...keywords) {
    // Strategy 1: label/value pairs in tables
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td');
        if (cells.length >= 2) {
          const labelText = cells[0].textContent?.trim().toLowerCase() || '';
          if (keywords.some((kw) => labelText.includes(kw.toLowerCase()))) {
            const value = cells[1].textContent?.trim();
            if (value && value.length < 500) return value;
          }
        }
      }
    }

    // Strategy 2: label/value in definition lists
    const dts = document.querySelectorAll('dt');
    for (const dt of dts) {
      const text = dt.textContent?.trim().toLowerCase() || '';
      if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
        const dd = dt.nextElementSibling;
        if (dd?.tagName === 'DD') {
          const value = dd.textContent?.trim();
          if (value && value.length < 500) return value;
        }
      }
    }

    // Strategy 3: label elements with adjacent values
    const labelEls = document.querySelectorAll('label, .label, [class*="label"], [class*="Label"], strong, b, span[class*="field"], span[class*="caption"]');
    for (const el of labelEls) {
      const text = el.textContent?.trim().toLowerCase().replace(/:$/, '') || '';
      if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
        // Check next sibling
        const sibling = el.nextElementSibling;
        if (sibling) {
          const value = sibling.textContent?.trim();
          if (value && value.length < 500 && value !== text) return value;
        }
        // Check parent for value child
        const parent = el.parentElement;
        if (parent) {
          const valueEl = parent.querySelector('.value, [class*="value"], [class*="Value"], span:last-child, td:last-child');
          if (valueEl && valueEl !== el) {
            const value = valueEl.textContent?.trim();
            if (value && value.length < 500) return value;
          }
        }
        // Check text node after label (common in gov sites: "Owner: John Smith")
        const parentText = el.parentElement?.textContent?.trim() || '';
        const afterColon = parentText.split(':').slice(1).join(':').trim();
        if (afterColon && afterColon.length < 500) return afterColon;
      }
    }

    // Strategy 4: div/span pairs with class hints
    const containers = document.querySelectorAll('[class*="detail"], [class*="field"], [class*="row"], [class*="item"], [class*="info"]');
    for (const container of containers) {
      const labelEl = container.querySelector('[class*="label"], [class*="key"], [class*="name"], [class*="caption"], strong, b, th');
      if (!labelEl) continue;
      const text = labelEl.textContent?.trim().toLowerCase().replace(/:$/, '') || '';
      if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
        const valueEl = container.querySelector('[class*="value"], [class*="data"], [class*="content"], dd, td:last-child');
        if (valueEl && valueEl !== labelEl) {
          const value = valueEl.textContent?.trim();
          if (value && value.length < 500) return value;
        }
      }
    }

    return null;
  }

  function extractAddressFromHeading() {
    // Many assessor sites put the address in h1/h2
    const headings = document.querySelectorAll('h1, h2, h3');
    for (const h of headings) {
      const text = h.textContent?.trim() || '';
      // Match common street address patterns (123 Main St)
      if (/^\d+\s+\w+/.test(text) && text.length < 200) {
        return text;
      }
    }
    return null;
  }
})();
