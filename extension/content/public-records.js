// ============================================================================
// LCC Assistant — Content Script: Public Records Scanner
// Heuristic scanner for county assessor, SOS, recorder of deeds, and other
// government / public records sites. Injected on-demand via SCAN_PAGE message.
//
// The CA Secretary of State (bizfileonline.sos.ca.gov) entity DETAIL modal is a
// clean `table.details-list` (label→value drawer) — parsed by an anchored,
// bizfile-specific path (`scanBizfileFromRoot`) that targets the detail table
// explicitly and NEVER the search-results grid. Everything else uses the generic
// `findValue` heuristic.
//
// This file is injected as a classic content script (isolated world). The pure
// bizfile parse functions live at top level so a Node test can eval this file in
// a `vm` sandbox and import them (`module.exports`, no-op in the browser); the
// live "scan the page" logic is wrapped in a guarded IIFE that only runs when a
// real `document`/`chrome.runtime` is present.
// ============================================================================

'use strict';

// ── Standing-label guard (shared) ─────────────────────────────────────────────
// A label beginning with "Standing -" (e.g. "Standing - Agent", "Standing - SOS")
// is a compliance FLAG, not the field it appears to name. On CA bizfile the
// "Standing - Agent: Good" row otherwise false-matched the "Agent" keyword and
// populated the Registered Agent field with "Good". This guard keeps a Standing-*
// label from ever populating the agent / officer / name fields on ANY SOS site.
function isStandingLabel(text) {
  return /^\s*standing\s*[-–—]/i.test(text || '');
}

// ── CA Secretary of State (bizfileonline) parser — DOM-anchored ──────────────
// The bizfile entity detail renders as `table.details-list` with one
// `tr.detail` per field: `td.label` → `td.value`. We select THAT table
// explicitly (never the results grid) and map by EXACT label. Ground-truth DOM
// (626 L Street LLC): Initial Filing Date · Status · Standing - SOS/FTB/Agent/
// VCFCF · Formed In · Entity Type · Principal Address · Mailing Address ·
// Statement of Info Due Date · Agent · CA Registered Corporate (1505) Agent
// Authorized Employee(s). The entity name + number live in the modal title
// (`NAME (NUMBER)`), NOT in the details table.

function isBizfileHost(host) {
  return /(^|\.)bizfileonline\.sos\.ca\.gov$/i.test(host || '');
}

// Does a line look like a US street/mailing-address line (so it belongs in an
// ADDRESS, not a NAME)? Used to split the Agent block (name vs address) and to
// pair Authorized-Employee name/address lines. Deliberately conservative — a
// leading house/registration NUMBER ("1505 Corporation") is NOT an address.
function looksLikeAddressLine(line) {
  const s = String(line || '');
  if (/\b\d{5}(-\d{4})?\b/.test(s)) return true; // ZIP
  if (/\b(suite|ste|floor|fl|unit|apt|room|rm|po box|p\.o\. box|#)\b/i.test(s)) return true;
  if (/\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|way|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|sq|square)\b/i.test(s)) return true;
  if (/,\s*[A-Z]{2}\b/.test(s) && /\d/.test(s)) return true; // "…, CA 90012"-shaped with a number
  return false;
}

// A multi-line address value ("626 L STREET\nCHULA VISTA, CA 91910") →
// { joined: "626 L STREET, CHULA VISTA, CA 91910", parts:{street,city,state,zip} }.
function splitAddressLines(value) {
  const lines = String(value || '')
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { joined: lines.join(', '), parts: parseAddressParts(lines) };
}

function parseAddressParts(lines) {
  const parts = { street: '', city: '', state: '', zip: '' };
  if (!lines || !lines.length) return parts;
  parts.street = lines[0] || '';
  const tail = lines.slice(1).join(', ');
  if (!tail) return parts;
  const m = tail.match(/^(.*?),?\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$/);
  if (m) {
    parts.city = (m[1] || '').replace(/,\s*$/, '').trim();
    parts.state = m[2] || '';
    parts.zip = m[3] || '';
  } else {
    parts.city = tail;
  }
  return parts;
}

// The Agent value block. A commercial registered-agent service reads as one or
// more FIRM lines with no address ("1505 Corporation\nLEGALZOOM.COM, INC.") →
// registered_agent is the whole block joined by " / ", no address. An individual
// agent reads name + address ("KAI HUNG LIN\n123 Main St\nLA, CA 90012") →
// name = the pre-address lines, address = the address lines.
function parseAgentBlock(value) {
  const lines = String(value || '')
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) return { name: '', address: '' };
  const addrIdx = lines.findIndex(looksLikeAddressLine);
  if (addrIdx > 0) {
    return {
      name: lines.slice(0, addrIdx).join(' ').trim(),
      address: lines.slice(addrIdx).join(', ').trim(),
    };
  }
  // No address lines (commercial service) OR the very first line already looks
  // like an address (no name to split off) → treat every line as the agent name.
  return { name: lines.join(' / '), address: '' };
}

// The "CA Registered Corporate (1505) Agent Authorized Employee(s)" block:
// alternating name / address lines. → { list:[{name,address}], text:"name — addr\n…" }.
function parseAuthorizedEmployees(value) {
  const lines = String(value || '')
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const list = [];
  let cur = null;
  for (const line of lines) {
    if (looksLikeAddressLine(line)) {
      if (cur) cur.address = cur.address ? `${cur.address}, ${line}` : line;
      // an address with no preceding name is dropped (rare / malformed)
    } else {
      cur = { name: line, address: '' };
      list.push(cur);
    }
  }
  const text = list.map((e) => (e.address ? `${e.name} — ${e.address}` : e.name)).join('\n');
  return { list, text };
}

// Modal title `NAME (NUMBER)` → { name, number }. NUMBER is the CA entity number
// (12-digit LLC "201911310222" / corp "C1234567"): ≥6 chars, no internal spaces,
// so a phone fragment like "(916) 768-5544" never matches. The exact title
// element/class is uncertain across bizfile skins, so we scan a set of
// header-ish candidates; a miss returns nulls (the caller falls back to the
// worklist's active owner name). NEVER pulls from the results grid.
function bizfileTitle(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return { name: null, number: null };
  const re = /^(.+?)\s*\(\s*([A-Za-z0-9][A-Za-z0-9-]{5,})\s*\)\s*$/;
  const sels = [
    '.transaction-header',
    '.detail-header',
    '.entity-title',
    '[class*="EntityName"]',
    '[class*="entity-name"]',
    '[class*="title"]',
    '[class*="Title"]',
    '[class*="header"]',
    'h1',
    'h2',
    'h3',
  ];
  for (const sel of sels) {
    let els;
    try {
      els = root.querySelectorAll(sel);
    } catch (_e) {
      continue;
    }
    for (const el of els) {
      const t = (el.textContent || '').trim();
      const m = t.match(re);
      if (m) return { name: m[1].trim(), number: m[2] };
    }
  }
  return { name: null, number: null };
}

// Read the entity DETAIL table (`table.details-list`) into [{label,value}].
// Explicitly targets the detail table so the search-results grid is never read.
function readBizfileDetailRows(root) {
  if (!root || typeof root.querySelector !== 'function') return [];
  const table = root.querySelector('table.details-list');
  if (!table) return [];
  const rows = [];
  for (const tr of table.querySelectorAll('tr.detail')) {
    const labelEl = tr.querySelector('td.label');
    if (!labelEl) continue;
    const valueEl = tr.querySelector('td.value');
    const label = (labelEl.textContent || '').trim();
    // Keep internal newlines (multi-line address / agent / employee cells),
    // trim only the outer whitespace.
    const value = (valueEl ? valueEl.textContent || '' : '').replace(/\r/g, '').replace(/^\s+|\s+$/g, '');
    if (label) rows.push({ label, value });
  }
  return rows;
}

// Map the exact bizfile labels → the SOS capture form fields. Standing-* rows
// are skipped so no field is ever "Good". Never returns a value read from the
// results grid (only `table.details-list` rows are input).
function mapBizfileFields(rows, title, fallbackName) {
  const map = new Map();
  let employeesRaw = '';
  for (const row of rows || []) {
    const rawLabel = (row.label || '').trim();
    if (!rawLabel || isStandingLabel(rawLabel)) continue; // Standing-* guard
    const key = rawLabel.toLowerCase().replace(/\s+/g, ' ').replace(/:$/, '').trim();
    if (/authorized employee/.test(key)) {
      if (!employeesRaw) employeesRaw = row.value || '';
      continue;
    }
    if (!map.has(key)) map.set(key, row.value || ''); // first wins
  }
  const get = (label) => map.get(label) || '';
  const t = title || {};
  const agent = parseAgentBlock(get('agent'));
  const employees = parseAuthorizedEmployees(employeesRaw);
  const principal = splitAddressLines(get('principal address'));
  const mailing = splitAddressLines(get('mailing address'));

  return {
    entity_type: 'organization',
    // Name/number come from the modal title, else the worklist active owner
    // (fallbackName); the number is left blank when the title wasn't captured —
    // never pulled from the results grid.
    name: t.name || fallbackName || '',
    filing_number: t.number || '',
    status: get('status'),
    formation_date: get('initial filing date') || get('formation date'),
    entity_type_detail: get('entity type'),
    state_of_formation: get('formed in'),
    registered_agent: agent.name,
    agent_address: agent.address,
    principal_address: principal.joined || mailing.joined,
    principal_address_parts: principal.parts,
    mailing_address: mailing.joined,
    officers: employees.text,
    agent_authorized_employees: employees.list,
  };
}

// Orchestrator: read the detail table + title from a root (document / modal
// element) and return the mapped SOS fields. `fallbackName` = the worklist's
// active owner name (used for the entity name when the title wasn't captured).
function scanBizfileFromRoot(root, fallbackName) {
  return mapBizfileFields(
    readBizfileDetailRows(root),
    bizfileTitle(root),
    fallbackName || '',
  );
}

// ── Browser run (guarded so a Node test can import this file without executing) ─
(function () {
  if (
    typeof document === 'undefined' ||
    typeof window === 'undefined' ||
    typeof chrome === 'undefined' ||
    !chrome.runtime
  ) {
    return;
  }

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
    // CA Secretary of State (bizfileonline.sos.ca.gov) — anchored to the entity
    // detail modal's `table.details-list`. The content script can't reach the
    // sidepanel worklist, so the name-fallback is applied there (loadOrgView).
    data = scanBizfileFromRoot(document, null);
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

  // ── Secretary of State / Business Entity scanner (generic) ───────────────

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

// ── Test export (no-op in the browser: `module` is undefined in the isolated world) ─
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isStandingLabel,
    isBizfileHost,
    looksLikeAddressLine,
    splitAddressLines,
    parseAddressParts,
    parseAgentBlock,
    parseAuthorizedEmployees,
    bizfileTitle,
    readBizfileDetailRows,
    mapBizfileFields,
    scanBizfileFromRoot,
  };
}
