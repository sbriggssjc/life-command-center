// ============================================================================
// LCC Assistant — Content Script: CoStar
// Extracts property data from sale comp / property detail pages.
// Uses page-text scanning (innerText) because CoStar's React DOM is too
// deeply nested for reliable sibling/parent traversal.
// ============================================================================

(function () {
  'use strict';

  let lastDetectedId = null;
  let lastContentLen = 0;
  let extractionTimer = null;

  // Accumulated data: merges across CoStar tab switches and popups
  let accumulated = { contacts: [], sales_history: [], tenants: [] };

  const observer = new MutationObserver(() => {
    clearTimeout(extractionTimer);
    extractionTimer = setTimeout(extract, 500);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(extract, 1500);
  setTimeout(extract, 4000);

  // ── Main extraction ───────────────────────────────────────────────────

  function extract() {
    const url = window.location.href;

    let address = null;
    let headingEl = null;

    for (const sel of ['h1', 'h2', 'h3']) {
      const el = document.querySelector(sel);
      if (el) {
        const parsed = parseAddress(el.textContent?.trim());
        if (parsed) {
          address = parsed;
          headingEl = el;
          break;
        }
      }
    }

    let lines = null;
    if (!address) {
      lines = getPageLines();
      address = findAddressInLines(lines);
    }

    if (!address) {
      address = parseAddress(document.title);
    }

    const identifier = address || document.title || url;

    // Detect if page content actually changed (tab switch, popup, etc.)
    const contentLen = document.body.textContent.length;
    const contentChanged = Math.abs(contentLen - lastContentLen) > 50;
    const pageId = identifier + '|' + url;

    // Skip if same page and content hasn't changed
    if (pageId === lastDetectedId && !contentChanged) return;
    lastDetectedId = pageId;
    lastContentLen = contentLen;

    // If address changed (navigated to different property), reset accumulation
    if (accumulated._address && accumulated._address !== identifier) {
      accumulated = { contacts: [], sales_history: [] };
    }
    accumulated._address = identifier;

    if (!lines) lines = getPageLines();
    const data = extractFields(lines);
    const contacts = extractContacts(lines);
    const salesHistory = extractSalesHistory(lines);
    const tenants = extractTenants(lines);
    const location = findLocationInLines(lines);

    // Merge new data into accumulated (preserves data from prior tab views)
    for (const [key, val] of Object.entries(data)) {
      if (val) accumulated[key] = val;
    }
    mergeContacts(accumulated.contacts, contacts);
    mergeSales(accumulated.sales_history, salesHistory);
    mergeTenants(accumulated.tenants, tenants);
    if (location.city) accumulated.city = location.city;
    if (location.state) accumulated.state = location.state;

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'costar',
        entity_type: 'property',
        _version: 11,
        address: address || document.title,
        page_url: url,
        city: accumulated.city,
        state: accumulated.state,
        ...accumulated,
        contacts: accumulated.contacts,
        sales_history: accumulated.sales_history,
        tenants: accumulated.tenants,
      },
    });

    if (headingEl) injectLccButton(headingEl);
  }

  function mergeContacts(existing, newContacts) {
    for (const c of newContacts) {
      const dup = existing.some((e) =>
        e.name === c.name && e.role === c.role
      );
      if (!dup) existing.push(c);
    }
  }

  function mergeSales(existing, newSales) {
    for (const s of newSales) {
      const dup = existing.some((e) =>
        e.sale_date === s.sale_date && e.sale_price === s.sale_price &&
        e.buyer === s.buyer && e.seller === s.seller
      );
      if (!dup) existing.push(s);
    }
  }

  function mergeTenants(existing, newTenants) {
    for (const t of newTenants) {
      const dup = existing.some((e) => e.name === t.name);
      if (!dup) existing.push(t);
    }
  }

  // ── Page text helpers ─────────────────────────────────────────────────

  function getPageLines() {
    try {
      return document.body.innerText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }

  function parseAddress(raw) {
    if (!raw || raw.length < 3) return null;
    let addr = raw.split(/\s+[-–—|]\s+/)[0].trim();
    // Reject pagination patterns like "1 of 2,000 Records"
    if (/^\d+\s+of\s+[\d,]+/i.test(addr)) return null;
    // Must start with a number AND contain a street-type word
    if (/^\d+\s/.test(addr) &&
      /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|pl|place|way|hwy|highway|pkwy|parkway|pike|cir|circle|loop|terr|trail)\b/i.test(addr)) {
      return addr;
    }
    return null;
  }

  function findAddressInLines(lines) {
    for (const line of lines) {
      if (line.length > 120 || line.length < 5) continue;
      const parsed = parseAddress(line);
      if (parsed) return parsed;
    }
    return null;
  }

  function findLocationInLines(lines) {
    for (const line of lines) {
      const m = line.match(/^([A-Za-z][A-Za-z\s.]{1,35}),\s*([A-Z]{2})\s*(\d{5})?/);
      if (m) return { city: m[1].trim(), state: m[2] };
    }
    return { city: null, state: null };
  }

  // ── Property field extraction ─────────────────────────────────────────

  function extractFields(lines) {
    const data = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = i > 0 ? lines[i - 1] : '';
      const next = i < lines.length - 1 ? lines[i + 1] : '';

      if (!data.cap_rate && /^(actual\s+)?cap\s+rate$/i.test(line)) {
        if (/[\d.]+%/.test(prev)) data.cap_rate = prev;
        else if (/[\d.]+%/.test(next)) data.cap_rate = next;
        else if (i < lines.length - 2 && /[\d.]+%/.test(lines[i + 2])) data.cap_rate = lines[i + 2];
      }

      if (!data.sale_date && /^sale\s+date$/i.test(line)) {
        if (/[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}/.test(prev)) data.sale_date = prev;
        else if (/[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}/.test(next)) data.sale_date = next;
      }

      if (!data.asking_price && /^asking\s+price$/i.test(line)) {
        if (/^\$[\d,]+/.test(next)) data.asking_price = next;
        else if (/^\$[\d,]+/.test(prev)) data.asking_price = prev;
      }

      if (!data.sale_price && /^sale\s+price$/i.test(line)) {
        if (next && next.length < 60) data.sale_price = next;
      }

      if (!data.square_footage) {
        if (/^sf\s+rba$/i.test(line) && /^[\d,]+$/.test(prev)) data.square_footage = prev + ' SF';
        if (/^rba$/i.test(line) && /^[\d,]+\s*sf/i.test(next)) data.square_footage = next;
      }

      if (!data.year_built && /^(year\s+)?built$/i.test(line)) {
        if (/^\d{4}$/.test(prev)) data.year_built = prev;
        else if (/^\d{4}$/.test(next)) data.year_built = next;
      }

      if (!data.stories && /^stories$/i.test(line)) {
        if (/^\d+$/.test(next)) data.stories = next;
        else if (/^\d+$/.test(prev)) data.stories = prev;
      }

      if (!data.building_class && /^class$/i.test(line)) {
        if (/^[A-C]$/i.test(next)) data.building_class = next;
        else if (/^[A-C]$/i.test(prev)) data.building_class = prev;
      }

      if (!data.occupancy && (/^leased(\s+at\s+sale)?$/i.test(line) || /^occupancy$/i.test(line))) {
        if (/^\d+%$/.test(prev)) data.occupancy = prev;
        else if (/^\d+%$/.test(next)) data.occupancy = next;
      }

      if (!data.zoning && /^zoning$/i.test(line)) {
        if (next && next.length < 20 && !/^(market|land|parking)/i.test(next)) data.zoning = next;
      }

      if (!data.lot_size) {
        if (/^land\s+acres$/i.test(line) && /[\d.]+\s*ac/i.test(next)) data.lot_size = next;
        else if (/^land\s+sf$/i.test(line) && /[\d,]+\s*sf/i.test(next)) data.lot_size = next;
      }

      if (!data.parking && /^parking\s+ratio$/i.test(line) && next) data.parking = next;

      if (!data.property_type && /^type$/i.test(line)) {
        if (next && next.length < 50 && !/^\d/.test(next) && !/^(investment|sale)/i.test(next)) data.property_type = next;
      }

      if (!data.noi && /^noi$/i.test(line)) {
        if (/^\$?[\d,]+/.test(next)) data.noi = next;
        else if (/^\$?[\d,]+/.test(prev)) data.noi = prev;
      }

      if (!data.price_per_sf && (/^price\/?sf$/i.test(line) || /^price\s+per\s+sf$/i.test(line))) {
        if (/^\$?[\d,.]+/.test(next)) data.price_per_sf = next;
        else if (/^\$?[\d,.]+/.test(prev)) data.price_per_sf = prev;
      }

      // Tab-separated assessment table
      if (line.includes('\t')) {
        const parts = line.split('\t').map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const label = parts[0].toLowerCase();
          const value = parts[1];
          if (!data.improvement_value && label === 'improvements') data.improvement_value = value;
          if (!data.assessed_value && label === 'total value') data.assessed_value = value;
          if (!data.land_value && label === 'land') data.land_value = value;
        }
      }

      if (!data.parcel_number && /^parcels?\t?$/i.test(line)) {
        if (next && /[\d-]{5,}/.test(next)) data.parcel_number = next;
      }

      // Ownership type from Owner tab
      if (!data.ownership_type && /^ownership\s+type$/i.test(line) && next) {
        data.ownership_type = next;
      }

      // ── Tenant / Lease fields ─────────────────────────────────
      if (!data.tenancy_type && /^tenancy$/i.test(line)) {
        if (next && next.length < 30) data.tenancy_type = next;
      }

      if (!data.owner_occupied && /^owner\s+occup(ied)?$/i.test(line)) {
        if (next && /^(yes|no)$/i.test(next)) data.owner_occupied = next;
      }

      if (!data.est_rent && /^costar\s+est\.?\s+rent$/i.test(line)) {
        if (next && next.length < 40) data.est_rent = next;
      }

      if (!data.lease_type && /^lease\s+type$/i.test(line)) {
        if (next && next.length < 40) data.lease_type = next;
      }

      if (!data.lease_term && /^lease\s+term$/i.test(line)) {
        if (next && next.length < 40) data.lease_term = next;
      }

      if (!data.lease_expiration && /^lease\s+expir(ation|es)$/i.test(line)) {
        if (next && next.length < 30) data.lease_expiration = next;
      }

      if (!data.rent_per_sf && /^rent\/?sf$/i.test(line)) {
        if (next && /^\$?[\d,.]+/.test(next)) data.rent_per_sf = next;
      }

      if (!data.annual_rent && /^annual\s+rent$/i.test(line)) {
        if (next && /^\$?[\d,.]+/.test(next)) data.annual_rent = next;
      }
    }

    return data;
  }

  // ── Tenant extraction ──────────────────────────────────────────────────
  //
  // Parses tenant data from:
  //   "Tenants at Sale" section: Name, SF, lease dates
  //   "Tenants" / "Tenant Detail" tabs: more detailed lease info
  //   "Stacking Plan" tabs: floor-by-floor tenant breakdown

  function extractTenants(lines) {
    const tenants = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // ── "Tenants at Sale" section ─────────────────────────────
      if (/^tenants?\s+at\s+sale$/i.test(line)) {
        parseTenantSection(lines, i + 1, tenants);
        continue;
      }

      // ── "Tenant Detail" or "Tenants" section on lease tab ─────
      if (/^tenant\s+detail$/i.test(line) || /^tenants?$/i.test(line)) {
        // Make sure this isn't "Tenancy" (building field) — must be standalone
        if (/^tenants?$/i.test(line) && i + 1 < lines.length) {
          const next = lines[i + 1];
          // If next line is a short value like "Single", this is the building field
          if (next && /^(single|multi|none)$/i.test(next)) continue;
        }
        parseTenantSection(lines, i + 1, tenants);
        continue;
      }

      // ── Stacking plan entries ─────────────────────────────────
      // Format: "Floor X" then tenant names with SF
      if (/^(suite|floor|unit)\s+/i.test(line)) {
        const next = i + 1 < lines.length ? lines[i + 1] : '';
        if (next && next.length > 2 && next.length < 80 && !/^(suite|floor|unit)\s/i.test(next)) {
          const tenant = { name: next, location: line };
          // Look for SF on the line after name
          const sfLine = i + 2 < lines.length ? lines[i + 2] : '';
          if (/^[\d,]+\s*sf/i.test(sfLine)) tenant.sf = sfLine;
          else if (/^[\d,]+$/.test(sfLine)) tenant.sf = sfLine + ' SF';
          if (!tenants.some((t) => t.name === tenant.name)) tenants.push(tenant);
        }
      }
    }

    return tenants;
  }

  function parseTenantSection(lines, startIdx, tenants) {
    let current = null;

    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];

      // Stop at next major section
      if (/^(seller|buyer|listing|building|land\b|market|public\s+record|my\s+notes|sources|sale\s+comp|©)/i.test(line)) break;

      // Skip headers
      if (/^(name|source:|costar\s+research)$/i.test(line)) continue;

      // SF value (often follows tenant name): "8,750" or "8,750 SF"
      if (/^[\d,]+(\s*sf)?$/i.test(line)) {
        if (current) current.sf = line.replace(/\s*sf\s*$/i, '').trim() + ' SF';
        continue;
      }

      // Lease dates
      if (/^lease\s+(start|commenced?)$/i.test(line) && lines[j + 1]) {
        if (current) current.lease_start = lines[j + 1];
        j++; continue;
      }
      if (/^lease\s+expir(ation|es)$/i.test(line) && lines[j + 1]) {
        if (current) current.lease_expiration = lines[j + 1];
        j++; continue;
      }
      if (/^lease\s+(type|term)$/i.test(line) && lines[j + 1]) {
        if (current) current.lease_type = lines[j + 1];
        j++; continue;
      }
      if (/^rent\/?sf$/i.test(line) && lines[j + 1]) {
        if (current) current.rent_per_sf = lines[j + 1];
        j++; continue;
      }

      // Tenant name: anything else that's a reasonable-length text line
      if (line.length > 2 && line.length < 80 && /^[A-Z]/.test(line) &&
          !/^\d/.test(line) && !/@/.test(line) && !/^https?:/i.test(line)) {
        // Push previous tenant
        if (current && current.name) {
          if (!tenants.some((t) => t.name === current.name)) tenants.push(current);
        }
        current = { name: line };
        continue;
      }
    }

    if (current && current.name) {
      if (!tenants.some((t) => t.name === current.name)) tenants.push(current);
    }
  }

  // ── Contact extraction ────────────────────────────────────────────────
  //
  // CoStar page structure:
  //   Seller section:      "Seller" → "Recorded Seller" → "Entity Name"
  //   Buyer section:       "Buyer" → info or "Buyer information not available"
  //   Listing Broker:      "Listing Broker" → [logo, Name, Title, phones, email] × N
  //   Buyer Broker:        "Buyer Broker" → people or "No Buyer Broker on Deal"
  //   After brokers:       "My Notes" / "Sources & Research" (STOP here)

  function extractContacts(lines) {
    const contacts = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // ── STOP at end-of-content sections ───────────────────────
      if (/^(my\s+notes|sources|verification|sale\s+comp\s+id|©\s*\d{4}|by\s+using\s+this|costar\s+comp|last\s+updated|report\s+an\s+error|publication\s+date)/i.test(line)) break;

      // ── Recorded Owner → entity with mailing address ────────
      if (/^recorded\s+owner$/i.test(line)) {
        const next = lines[i + 1];
        if (next && next.length > 2 && next.length < 80) {
          const owner = { role: 'owner', name: next, type: 'entity' };
          // Look ahead for ownership type and mailing address
          for (let k = i + 2; k < Math.min(i + 8, lines.length); k++) {
            const ol = lines[k];
            if (/^ownership\s+type$/i.test(ol) && lines[k + 1]) { owner.ownership_type = lines[k + 1]; }
            if (/^mailing\s+address$/i.test(ol)) {
              owner.address = findEntityAddress(lines, k + 1);
            }
          }
          contacts.push(owner);
        }
        continue;
      }

      // ── Recorded Seller → entity name ─────────────────────────
      if (/^recorded\s+seller$/i.test(line)) {
        const next = lines[i + 1];
        if (next && next.length > 2 && next.length < 80 && !/^buyer/i.test(next)) {
          contacts.push({ role: 'seller', name: next, type: 'entity' });
        }
        continue;
      }

      // ── Recorded Buyer → entity name ──────────────────────────
      if (/^recorded\s+buyer$/i.test(line)) {
        const next = lines[i + 1];
        if (next && next.length > 2 && next.length < 80 && !/^(buyer|no\s+|not\s+)/i.test(next)) {
          contacts.push({ role: 'buyer', name: next, type: 'entity' });
        }
        continue;
      }

      // ── Listing Broker section → parse person blocks ──────────
      if (/^listing\s+broker$/i.test(line)) {
        const peek = lines[i + 1];
        if (peek && /^(no\s+|not\s+available)/i.test(peek)) continue;
        const people = parsePersonBlocks(lines, i + 1);
        for (const p of people) { p.role = 'listing_broker'; contacts.push(p); }
        continue;
      }

      // ── Buyer Broker section → parse person blocks ────────────
      if (/^buyer\s+broker$/i.test(line)) {
        const peek = lines[i + 1];
        if (peek && /^(no\s+|not\s+available)/i.test(peek)) continue;
        const people = parsePersonBlocks(lines, i + 1);
        for (const p of people) { p.role = 'buyer_broker'; contacts.push(p); }
        continue;
      }

      // ── Lender section ────────────────────────────────────────
      if (/^lender$/i.test(line)) {
        const peek = lines[i + 1];
        if (peek && /^(no\s+|not\s+available)/i.test(peek)) continue;
        const people = parsePersonBlocks(lines, i + 1);
        for (const p of people) { p.role = 'lender'; contacts.push(p); }
        continue;
      }
    }

    return contacts;
  }

  // Parse person/company blocks. Does NOT rely on "logo" separators (they
  // get concatenated in innerText). Instead detects a new person when a
  // name-like line appears after the current person already has contact info.
  function parsePersonBlocks(lines, startIdx) {
    const people = [];
    let current = null;

    function pushCurrent() {
      if (current && current.name) people.push(current);
      current = null;
    }

    function isPhone(s) { return /^\(?\d{3}\)?\s*[-.]?\s*\d{3}[-.]?\d{4}/.test(s); }
    function isEmail(s) { return /@/.test(s) && /\.\w{2,}$/.test(s) && !s.startsWith('http'); }
    function isURL(s) { return /^https?:\/\//i.test(s) || /^www\./i.test(s); }
    function isAddress(s) { return /^[A-Z][a-z]+.*,\s*[A-Z]{2}\s+\d{5}/.test(s); }
    function isStreet(s) { return /^\d+\s+\w+.*\b(st|street|ave|blvd|rd|dr|suite|ste|pkwy)\b/i.test(s); }
    function hasContactInfo(p) { return p && (p.email || (p.phones && p.phones.length)); }

    function isNameLine(s) {
      if (s.length < 3 || s.length > 60) return false;
      if (/^\(/.test(s) || /@/.test(s) || /^\d/.test(s)) return false;
      if (isURL(s) || isPhone(s) || isEmail(s)) return false;
      if (/^(no\s+|source:|add\s+notes|name$|united states)/i.test(s)) return false;
      if (/^[a-z]/.test(s)) return false; // must start with capital
      // Reject page footer / CoStar chrome
      if (/^(©|by\s+using|costar\s+(comp|group|est)|last\s+updated|report\s+an|publication|verification|all\s+rights|terms\s+of)/i.test(s)) return false;
      return true;
    }

    function isTitleLine(s) {
      return /director|manager|analyst|advisor|associate|vp\b|president|officer|agent|broker|partner|principal|senior|managing|consultant/i.test(s);
    }

    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];

      // Stop at section boundaries and page footer content
      if (/^(transaction\s+details|building|land\b|market|tenants?\s+at|public\s+record|my\s+notes|sources|verification|sale\s+comp|comparable|recorded\s+(seller|buyer)|lender|©\s*\d{4}|by\s+using\s+this|costar\s+comp|last\s+updated|report\s+an\s+error|publication\s+date)/i.test(line)) break;
      // Stop at other contact section headers (but not sub-labels within)
      if (/^(seller|buyer\s+broker|listing\s+(broker|agent))$/i.test(line) && j > startIdx) break;

      // Handle "logo" as separator — both standalone and concatenated
      if (/^logo$/i.test(line)) { pushCurrent(); continue; }
      if (/^logo[A-Z]/i.test(line)) {
        pushCurrent();
        const afterLogo = line.replace(/^logo\s*/i, '').trim();
        if (afterLogo.length > 2) current = { name: afterLogo, type: 'person' };
        continue;
      }

      // Skip non-content lines
      if (isURL(line)) { if (current) current.website = line.trim(); continue; }
      if (/^United States$/i.test(line)) continue;
      if (isAddress(line)) continue;
      if (isStreet(line)) continue;

      // Email — assign to current person
      if (isEmail(line)) {
        if (current && !current.email) current.email = line.trim();
        continue;
      }

      // Phone — assign to current person
      if (isPhone(line)) {
        if (current) {
          if (!current.phones) current.phones = [];
          current.phones.push(line.replace(/\s*\([pmwf]\)\s*$/i, '').trim());
        }
        continue;
      }

      // Name-like line
      if (isNameLine(line)) {
        // Current person already has contact info → they're complete, start new
        if (hasContactInfo(current)) {
          pushCurrent();
          current = { name: line, type: 'person' };
          continue;
        }

        // No current person → start new
        if (!current) {
          current = { name: line, type: 'person' };
          continue;
        }

        // Current person has name but no contact info yet → title or new person?
        if (!current.title && isTitleLine(line)) {
          current.title = line;
          continue;
        }

        // Has name + title already → probably a new person (or company)
        if (current.title) {
          pushCurrent();
          current = { name: line, type: 'person' };
          continue;
        }

        // Name but no title, and this line doesn't look like a title → new person
        pushCurrent();
        current = { name: line, type: 'person' };
        continue;
      }
    }

    pushCurrent();
    return people;
  }

  // ── Sales history extraction ──────────────────────────────────────────

  function extractSalesHistory(lines) {
    const sales = [];

    // Parse Transaction Details block (current sale)
    for (let i = 0; i < lines.length; i++) {
      if (/^transaction\s+details$/i.test(lines[i])) {
        const sale = parseTransactionBlock(lines, i + 1);
        if (sale && (sale.sale_date || sale.sale_price)) {
          sale.is_current = true;
          sales.push(sale);
        }
        break;
      }
    }

    // Parse Sale/Loan History from Public Records popup
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/^sale\/?loan\s+history/i.test(line) || /historic\s+sale\s+loan\s+records/i.test(line)) {
        const deedSales = parseDeedHistory(lines, i + 1);
        sales.push(...deedSales);
        break;
      }
    }

    // Also check for Prior Sales / Sales History section
    for (let i = 0; i < lines.length; i++) {
      if (/^(sales?\s+history|prior\s+sales?|transaction\s+history)$/i.test(lines[i])) {
        // Skip if we already captured deed history
        if (sales.some((s) => !s.is_current)) break;
        const historicSales = parseHistoricSalesSection(lines, i + 1);
        sales.push(...historicSales);
        break;
      }
    }

    return sales;
  }

  function parseTransactionBlock(lines, startIdx) {
    const sale = {};
    for (let j = startIdx; j < Math.min(startIdx + 30, lines.length); j++) {
      const line = lines[j];
      const next = j + 1 < lines.length ? lines[j + 1] : '';

      if (/^(public\s+record|building|land\b|market|tenants?|seller|buyer|listing)/i.test(line)) break;

      if (/^sale\s+date$/i.test(line) && next) sale.sale_date = next;
      if (/^sale\s+price$/i.test(line) && next) sale.sale_price = next;
      if (/^asking\s+price$/i.test(line) && /^\$/.test(next)) sale.asking_price = next;
      if (/^(actual\s+)?cap\s+rate$/i.test(line) && /[\d.]+%/.test(next)) sale.cap_rate = next;
      if (/^sale\s+type$/i.test(line) && next) sale.sale_type = next;
      if (/^sale\s+condition$/i.test(line) && next) sale.sale_condition = next;
      if (/^hold\s+period$/i.test(line) && next) sale.hold_period = next;
    }
    return sale;
  }

  // Parse deed/loan history from CoStar's Public Records popup/tab.
  // Structure per record:
  //   Transaction → Transaction Date, Sale Price, Transaction Type, Deed Type, ...
  //   Sale Contact Details → Buyer (+ Address), Seller (+ Address), Title Company
  //   Loan Details → Origination Date, Loan Amount, Loan Type, Originator, ...
  function parseDeedHistory(lines, startIdx) {
    const sales = [];
    let current = null;

    function pushCurrent() {
      if (current && (current.sale_date || current.sale_price || current.loan_amount)) {
        sales.push(current);
      }
      current = null;
    }

    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];
      const next = j + 1 < lines.length ? lines[j + 1] : '';

      // "Transaction" or truncated "ransaction" marks new record
      if (/^r?transaction$/i.test(line) && !/date|type|details/i.test(next || '____')) {
        pushCurrent();
        current = {};
        continue;
      }

      if (!current) current = {};

      // ── Core transaction fields ───────────────────────────────
      if (/^transaction\s+date$/i.test(line) && next) { current.sale_date = next; continue; }
      if (/^recordation\s+date$/i.test(line) && next) { current.recordation_date = next; continue; }
      if (/^sale\s+price$/i.test(line) && next) { current.sale_price = next; continue; }
      if (/^transaction\s+type$/i.test(line) && next) { current.transaction_type = next; continue; }
      if (/^deed\s+type$/i.test(line) && next) { current.deed_type = next; continue; }
      if (/^sale\s+type$/i.test(line) && next) { current.sale_type = next; continue; }
      if (/^document\s+#$/i.test(line) && next) { current.document_number = next; continue; }

      // ── Sale Contact Details sub-section ──────────────────────
      if (/^sale\s+contact\s+details$/i.test(line)) continue; // just a header

      if (/^buyer$/i.test(line)) {
        // Next line could be the buyer name or "Address"
        if (next && next.length < 80 && !/^(address|seller|title|loan|originator)/i.test(next)) {
          current.buyer = next;
          current.buyer_address = findEntityAddress(lines, j + 2);
        }
        continue;
      }
      if (/^(borrower)$/i.test(line)) {
        if (next && next.length < 80) current.buyer = next;
        continue;
      }
      if (/^seller$/i.test(line)) {
        if (next && next.length < 80 && !/^(title|buyer|address|lender|loan|originator)/i.test(next)) {
          current.seller = next;
          current.seller_address = findEntityAddress(lines, j + 2);
        }
        continue;
      }
      if (/^title\s+company$/i.test(line) && next && next.length < 80) {
        current.title_company = next;
        continue;
      }

      // ── Loan Details sub-section ──────────────────────────────
      if (/^loan\s+details$/i.test(line)) continue; // just a header
      if (/^(last\s+loan)$/i.test(line)) continue; // section label on owner tab

      if (/^origination\s+date$/i.test(line) && next) { current.loan_origination_date = next; continue; }
      if (/^loan\s+amount$/i.test(line) && next) { current.loan_amount = next; continue; }
      if (/^loan\s+type$/i.test(line) && next) { current.loan_type = next; continue; }
      if (/^originator$/i.test(line) && next && next.length < 80) { current.lender = next; continue; }
      if (/^interest\s+rate$/i.test(line) && next) { current.interest_rate = next; continue; }
      if (/^loan\s+term$/i.test(line) && next) { current.loan_term = next; continue; }
      if (/^maturity\s+date$/i.test(line) && next) { current.maturity_date = next; continue; }
    }

    pushCurrent();
    return sales;
  }

  // Look ahead from a position for an address block (street + city/state)
  function findEntityAddress(lines, startIdx) {
    const parts = [];
    for (let k = startIdx; k < Math.min(startIdx + 5, lines.length); k++) {
      const l = lines[k];
      // Skip "Address" label if present
      if (/^address$/i.test(l)) continue;
      // Stop at next section label
      if (/^(seller|buyer|title\s+company|lender|loan|transaction|sale\s+contact|originator|borrower|document)/i.test(l)) break;
      // Collect address lines (street, city/state/zip)
      if (/^\d+\s+\w+/.test(l) || /^[A-Z][a-z]+.*,\s*[A-Z]{2}\s+\d{4,5}/.test(l) ||
          /^(po\s+box|p\.?o\.?\s+box)/i.test(l)) {
        parts.push(l);
      }
    }
    return parts.length ? parts.join(', ') : null;
  }

  function parseHistoricSalesSection(lines, startIdx) {
    const sales = [];
    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];
      if (/^(building|land\b|market|tenants?|public\s+record|my\s+notes)/i.test(line)) break;

      // Date pattern starts a new sale entry
      if (/[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}/.test(line) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) {
        const sale = { sale_date: line };
        for (let k = j + 1; k < Math.min(j + 8, lines.length); k++) {
          const sl = lines[k];
          if (/^\$[\d,]+/.test(sl) && !sale.sale_price) sale.sale_price = sl;
          if (/[\d.]+%/.test(sl) && !sale.cap_rate) sale.cap_rate = sl;
          if (/^(investment|owner.?user|1031|build.?to.?suit)/i.test(sl)) sale.sale_type = sl;
        }
        sales.push(sale);
      }
    }
    return sales;
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
