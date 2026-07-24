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
  if (isBizfileHost(hostname)) {
    // CA Secretary of State (bizfileonline.sos.ca.gov) — a JSON SPA whose detail
    // modal renders a clean label→value drawer that the generic findValue
    // heuristic mis-maps. Use a bizfile-specific parser instead (2026-07-24).
    data = scanBizfile();
  } else if (siteType === 'assessor') {
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

  // ── CA Secretary of State (bizfileonline) parser ─────────────────────────
  // bizfileonline.sos.ca.gov renders the entity detail as a modal with a
  // `NAME (NUMBER)` title + a clean label→value drawer. The generic findValue
  // heuristic mis-maps it (grabbed the entity number as the name, "Standing -
  // Agent: Good" as the Registered Agent, the Principal Address block as the
  // Officers, etc.). This host-specific parser anchors on the exact bizfile
  // label text so the SOS capture form auto-populates correctly.
  //
  // The bizfile drawer labels (ground truth from a live record):
  //   Initial Filing Date · Status · Standing - SOS/FTB/Agent/VCFCF · Formed In
  //   · Entity Type · Principal Address · Mailing Address · Statement of Info
  //   Due Date · Agent  (Agent is a multi-line block: type, then the agent NAME,
  //   then the agent ADDRESS). "Standing - Agent" is a compliance flag, NOT the
  //   registered agent.

  function isBizfileHost(host) {
    return /(^|\.)bizfileonline\.sos\.ca\.gov$/i.test(host || '');
  }

  // Known bizfile drawer labels — used to delimit a label's value block (the
  // value runs from the label line to the next known label line). Any
  // "Standing - *" line is treated as a label (via isStandingLabel). Declared
  // as a hoisted function (not a module-scope const) because the top-of-file
  // dispatch calls scanBizfile before a const would be initialized (TDZ).
  function bizfileLabelSet() {
    return [
      'initial filing date', 'status', 'formed in', 'entity type',
      'principal address', 'mailing address', 'statement of info due date',
      'agent', 'entity name', 'entity number', 'formation date', 'jurisdiction',
      'registered agent', 'history', 'filings', 'document type',
    ];
  }

  function isBizfileLabelLine(line) {
    const l = (line || '').trim().toLowerCase().replace(/:\s*$/, '');
    if (!l) return false;
    if (isStandingLabel(l)) return true;
    return bizfileLabelSet().includes(l);
  }

  // Find the detail drawer/modal container that holds the entity detail (has the
  // `(NUMBER)` title AND detail labels), so we don't scan a search-results table.
  function bizfileRoot() {
    // The parenthesized entity number is alphanumeric — LLC "201022910090",
    // corp "C1234567" — but ≥6 chars with no spaces, so a phone fragment like
    // "(916)" (3 chars) never matches.
    const titleRe = /\(\s*[A-Za-z0-9][A-Za-z0-9-]{5,}\s*\)/;
    const detailRe = /agent|principal address|formed in|entity type/i;
    const sels = [
      '[role="dialog"]', '.modal', '[class*="drawer"]', '[class*="Drawer"]',
      '[class*="Detail"]', '[class*="detail"]', '[class*="Record"]', 'main',
    ];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const t = el.innerText || el.textContent || '';
        if (titleRe.test(t) && detailRe.test(t)) return el;
      }
    }
    return document.body;
  }

  function bizfileLines() {
    const root = bizfileRoot();
    const raw = root.innerText || root.textContent || '';
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && s.length < 300);
  }

  // Title: `NAME (NUMBER)` → { name, number }. NUMBER is alphanumeric
  // (LLC 12-digit, corp "C1234567"), ≥6 chars, no spaces.
  function bizfileTitle(lines) {
    const re = /^(.+?)\s*\(\s*([A-Za-z0-9][A-Za-z0-9-]{5,})\s*\)\s*$/;
    for (const line of lines) {
      const m = line.match(re);
      if (m) return { name: m[1].trim(), number: m[2] };
    }
    return { name: null, number: null };
  }

  // Value for an EXACT bizfile label: the following line(s) up to the next known
  // label line. `multi` returns the array of value lines; otherwise the first.
  // Also handles an inline "Label: value" on the same line. Never matches a
  // "Standing - *" line.
  function bizfileValue(lines, label, opts) {
    const multi = opts && opts.multi;
    const target = label.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isStandingLabel(line)) continue;
      const lower = line.toLowerCase().replace(/:\s*$/, '');
      if (lower === target) {
        const vals = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (isBizfileLabelLine(lines[j])) break;
          vals.push(lines[j]);
        }
        if (vals.length) return multi ? vals : vals[0];
      } else if (lower.startsWith(target + ':')) {
        const rest = line.slice(line.indexOf(':') + 1).trim();
        if (rest && !isBizfileLabelLine(rest)) return multi ? [rest] : rest;
      }
    }
    return multi ? [] : null;
  }

  // The Agent block: an optional type token (Individual / Corporation), then the
  // agent NAME, then the agent ADDRESS (one or more lines, ending at a ZIP).
  function bizfileAgent(lines) {
    const block = bizfileValue(lines, 'Agent', { multi: true });
    if (!block.length) return { name: null, address: null };
    let i = 0;
    if (/^(individual|corporation|corporate|entity|person|business|trust)$/i.test(block[i])) i++;
    const name = block[i] || null;
    const rest = block.slice(i + 1);
    const addrParts = [];
    for (const ln of rest) {
      addrParts.push(ln);
      if (/\b\d{5}(-\d{4})?\s*$/.test(ln)) break; // stop at a 5-digit ZIP
    }
    if (!addrParts.length && rest.length) addrParts.push(rest[0]);
    const address = addrParts.join(', ').trim() || null;
    return { name, address };
  }

  function scanBizfile() {
    const lines = bizfileLines();
    const title = bizfileTitle(lines);
    const agent = bizfileAgent(lines);

    // Scalar fields fall back to the (now Standing-guarded) generic matcher only
    // when the bizfile-specific parse comes up empty — the agent NEVER falls
    // back (its value is a multi-line block the generic matcher would flatten).
    const biz = (label) => bizfileValue(lines, label);

    return {
      entity_type: 'organization',
      name: title.name || findValue('Entity Name', 'Business Name', 'Company Name'),
      filing_number: title.number || biz('Entity Number') || findValue('Filing Number', 'Entity Number', 'Entity ID'),
      status: biz('Status') || findValue('Status', 'Entity Status'),
      formation_date: biz('Initial Filing Date') || biz('Formation Date') || findValue('Formation Date', 'Filing Date', 'Date Filed'),
      entity_type_detail: biz('Entity Type') || findValue('Entity Type', 'Business Type'),
      state_of_formation: biz('Formed In') || findValue('State of Formation', 'Jurisdiction'),
      registered_agent: agent.name,
      agent_address: agent.address,
      principal_address: biz('Principal Address') || biz('Mailing Address'),
      // bizfile's basic detail modal does NOT separately list members/officers
      // (that needs the Statement of Information PDF, out of scope) — leave it
      // blank-but-editable rather than mis-fill it with the address block.
      officers: null,
    };
  }

  // ── Generic field extraction ─────────────────────────────────────────────

  // A label beginning with "Standing -" (e.g. "Standing - Agent",
  // "Standing - SOS") is a compliance FLAG, not the field it appears to name.
  // On CA bizfile the "Standing - Agent: Good" row otherwise false-matched the
  // "Agent" keyword and populated the Registered Agent field with "Good".
  // Guard the generic heuristic so a Standing-* label can never populate the
  // agent / officer / name fields on ANY SOS site (defense-in-depth).
  function isStandingLabel(text) {
    return /^\s*standing\s*[-–—]/i.test(text || '');
  }

  // Central label matcher used by every findValue strategy: excludes Standing-*
  // flags, then does the existing case-insensitive substring keyword match.
  function labelMatches(labelText, keywords) {
    const t = (labelText || '').trim();
    if (!t || isStandingLabel(t)) return false;
    const lower = t.toLowerCase();
    return keywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  function findValue(...keywords) {
    // Strategy 1: label/value pairs in tables
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td');
        if (cells.length >= 2) {
          const labelText = cells[0].textContent?.trim().toLowerCase() || '';
          if (labelMatches(labelText, keywords)) {
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
      if (labelMatches(text, keywords)) {
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
      if (labelMatches(text, keywords)) {
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
      if (labelMatches(text, keywords)) {
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
