// ============================================================================
// LCC Assistant — Content Script: CoStar
// Extracts property data from sale comp / property detail pages.
// Uses page-text scanning (innerText) because CoStar's React DOM is too
// deeply nested for reliable sibling/parent traversal.
// ============================================================================

(function () {
  'use strict';

  let lastDetectedId = null;
  let extractionTimer = null;

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
    const pageId = identifier + '|' + url;
    if (pageId === lastDetectedId) return;
    lastDetectedId = pageId;

    if (!lines) lines = getPageLines();
    const data = extractFields(lines);
    const contacts = extractContacts(lines);
    const salesHistory = extractSalesHistory(lines);
    const location = findLocationInLines(lines);

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'costar',
        entity_type: 'property',
        address: address || document.title,
        page_url: url,
        city: location.city,
        state: location.state,
        contacts,
        sales_history: salesHistory,
        ...data,
      },
    });

    if (headingEl) injectLccButton(headingEl);
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
    }

    return data;
  }

  // ── Contact extraction ────────────────────────────────────────────────
  //
  // Parses people from sections like "Listing Broker", "Seller",
  // "Buyer Broker", "Buyer", etc. Each person block has:
  //   Name, Title, phone(s), email, then sometimes company info.

  function extractContacts(lines) {
    const contacts = [];
    const sectionPatterns = [
      { re: /^listing\s+broker$/i, role: 'listing_broker' },
      { re: /^buyer\s+broker$/i, role: 'buyer_broker' },
      { re: /^recorded\s+seller$/i, role: 'seller' },
      { re: /^seller$/i, role: 'seller' },
      { re: /^buyer$/i, role: 'buyer' },
      { re: /^lender$/i, role: 'lender' },
      { re: /^listing\s+agent$/i, role: 'listing_broker' },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const { re, role } of sectionPatterns) {
        if (!re.test(line)) continue;

        // Special: "Recorded Seller" → single entity name on next line
        if (role === 'seller' && /^recorded\s+seller$/i.test(line)) {
          const next = lines[i + 1];
          if (next && next.length > 2 && next.length < 80) {
            contacts.push({ role: 'seller', name: next, type: 'entity' });
          }
          break;
        }

        // Skip "No Buyer Broker on Deal" etc.
        const peek = lines[i + 1];
        if (peek && /^no\s+/i.test(peek)) break;
        if (peek && /not\s+available/i.test(peek)) break;

        // Parse person blocks after section header
        const people = parsePersonBlocks(lines, i + 1);
        for (const person of people) {
          person.role = role;
          contacts.push(person);
        }
        break;
      }
    }

    return contacts;
  }

  function parsePersonBlocks(lines, startIdx) {
    const people = [];
    let current = null;

    for (let j = startIdx; j < lines.length; j++) {
      const line = lines[j];

      // Stop at next major section
      if (/^(transaction\s+details|building|land|market|tenants?\s+at|public\s+record|my\s+notes|sources|sale\s+comp|comparable)/i.test(line)) break;

      // Skip "logo" lines
      if (/^logo$/i.test(line)) {
        // If we have a current person, push it and start fresh
        if (current) { people.push(current); current = null; }
        continue;
      }

      // Detect email
      if (/@/.test(line) && /\.\w{2,}$/.test(line)) {
        if (current) current.email = line.trim();
        continue;
      }

      // Detect phone: (XXX) XXX-XXXX or XXX-XXX-XXXX with optional suffix
      if (/^\(?\d{3}\)?\s*[-.]?\s*\d{3}[-.]?\d{4}/.test(line)) {
        if (current) {
          if (!current.phones) current.phones = [];
          current.phones.push(line.replace(/\s*\([pmw]\)\s*$/i, '').trim());
        }
        continue;
      }

      // Detect URL (company website) — skip
      if (/^https?:\/\//i.test(line)) continue;

      // Detect company address pattern (city, state zip) — skip
      if (/^[A-Z][a-z]+.*,\s*[A-Z]{2}\s+\d{5}/.test(line)) continue;
      if (/^United States$/i.test(line)) continue;

      // Detect a person name: short line, no special chars, not a section header
      if (!current && line.length > 2 && line.length < 60 &&
          !/^\(/.test(line) && !/@/.test(line) && !/^https?:/i.test(line) &&
          !/^(logo|no\s+|source:|name$)/i.test(line)) {
        current = { name: line, type: 'person' };
        continue;
      }

      // Detect title (comes right after name): contains keywords or is short
      if (current && !current.title && line.length > 3 && line.length < 80 &&
          !/^\(/.test(line) && !/@/.test(line)) {
        // Likely a title: "Senior Managing Director", "Research Analyst", etc.
        if (/director|manager|analyst|advisor|associate|vp|president|officer|agent|broker|partner|principal/i.test(line) ||
            (line.length < 60 && !/^\d/.test(line) && !/^[A-Z]{2}\s+\d/.test(line))) {
          current.title = line;
          continue;
        }
      }

      // If we hit a company name (often after contacts block)
      if (current && line.length > 3 && line.length < 80 &&
          /^[A-Z]/.test(line) && !/^\(/.test(line) && !/@/.test(line)) {
        // Could be a company name — check if next line is an address
        const nextLine = j + 1 < lines.length ? lines[j + 1] : '';
        if (/^\d+\s/.test(nextLine) || /^[A-Z][a-z]+.*,\s*[A-Z]{2}/.test(nextLine)) {
          if (current) current.company = line;
          continue;
        }
      }
    }

    if (current) people.push(current);
    return people;
  }

  // ── Sales history extraction ──────────────────────────────────────────
  //
  // CoStar shows sale history in various formats. We look for repeated
  // patterns of Sale Date + Sale Price entries.

  function extractSalesHistory(lines) {
    const sales = [];
    let inSalesSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect sales history section headers
      if (/^(sales?\s+history|prior\s+sales?|transaction\s+history|comparable\s+sales)/i.test(line)) {
        inSalesSection = true;
        continue;
      }

      // Also capture the current/primary transaction from Transaction Details
      if (/^transaction\s+details$/i.test(line)) {
        const sale = parseTransactionBlock(lines, i + 1);
        if (sale && (sale.sale_date || sale.sale_price)) {
          sale.is_current = true;
          sales.push(sale);
        }
        continue;
      }

      // In sales history section, look for individual sale entries
      if (inSalesSection) {
        // Stop at next major section
        if (/^(building|land|market|tenants?|public\s+record|my\s+notes|sources)/i.test(line)) {
          inSalesSection = false;
          continue;
        }

        // Date pattern starts a new sale entry
        if (/[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}/.test(line) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) {
          const sale = { sale_date: line };
          // Look ahead for price and details
          for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
            const sl = lines[j];
            if (/^\$[\d,]+/.test(sl) && !sale.sale_price) sale.sale_price = sl;
            if (/[\d.]+%/.test(sl) && !sale.cap_rate) sale.cap_rate = sl;
            if (/^(investment|owner.?user|1031|build.?to.?suit)/i.test(sl)) sale.sale_type = sl;
          }
          if (sale.sale_price || sale.sale_date) sales.push(sale);
        }
      }
    }

    return sales;
  }

  function parseTransactionBlock(lines, startIdx) {
    const sale = {};
    for (let j = startIdx; j < Math.min(startIdx + 30, lines.length); j++) {
      const line = lines[j];
      const next = j + 1 < lines.length ? lines[j + 1] : '';

      // Stop at next major section
      if (/^(public\s+record|building|land|market|tenants?|seller|buyer|listing)/i.test(line)) break;

      if (/^sale\s+date$/i.test(line) && /\w{3}\s+\d/.test(next)) sale.sale_date = next;
      if (/^sale\s+price$/i.test(line) && next) sale.sale_price = next;
      if (/^asking\s+price$/i.test(line) && /^\$/.test(next)) sale.asking_price = next;
      if (/^(actual\s+)?cap\s+rate$/i.test(line) && /[\d.]+%/.test(next)) sale.cap_rate = next;
      if (/^sale\s+type$/i.test(line) && next) sale.sale_type = next;
      if (/^sale\s+condition$/i.test(line) && next) sale.sale_condition = next;
      if (/^hold\s+period$/i.test(line) && next) sale.hold_period = next;
    }
    return sale;
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
